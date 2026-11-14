import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boardLines, blockers, index, jsonRows, nextLines, relationLines } from "./taskBoard.mjs";
import {
  CLOSED_STATUSES, OPEN_STATUSES, addLine, claimState, claimText, claimed, filesInScope, formatTask, isTaskId,
  scopeOverlap, splitList, unclaimed,
} from "./taskFile.mjs";
import { hostReminders, landingProblems } from "./taskLanding.mjs";
import {
  checkTasks, findTask, git, load, machineName, nowText, readAll, readGroups, save, staleOf, taskOnMain, taskPath, todayText, tryGit,
} from "./taskRepo.mjs";

export { checkTasks } from "./taskRepo.mjs";
export { staleReason } from "./taskRepo.mjs";

const FLAGS = ["--all", "--json", "--takeover", "--no-commit", "--claim", "--force"];

function parseArgs(argv) {
  const options = { _: [], commit: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) options._.push(arg);
    else if (FLAGS.includes(arg)) options[arg.slice(2)] = true;
    else if (arg === "--commit") options.commit.push(argv[(i += 1)] ?? "");
    else options[arg.slice(2)] = argv[(i += 1)] ?? "";
  }
  return options;
}

function run(command, args) {
  return spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
}

function fetchMain() {
  if (run("git", ["fetch", "-q", "origin", "main"]) !== 0) console.warn("取不到 origin/main，只按本地的任务文件判断");
}

function commitTasks(paths, message, options) {
  if (options["no-commit"]) return 0;
  git(["add", "-A", "--", ...paths]);
  git(["commit", "-q", "-m", message, "--", ...paths]);
  console.log(`已提交「${message}」（只含任务文件），随下一批 PR 推上去：pnpm mq:land --yes`);
  return 0;
}

function sessionName(options) {
  return options.as || process.env.FOCUSD_SESSION_NAME || "";
}

function me(options) {
  return { owner: sessionName(options), host: machineName() };
}

function claimOf(root, task) {
  const onMain = taskOnMain(root, task.fields.id);
  return claimState(task, {}) === "free" && onMain && claimState(onMain, {}) !== "free" ? onMain : task;
}

async function claim(root, options, added = []) {
  const ids = options._;
  if (ids.length === 0 || !ids.every(isTaskId)) throw new Error("用法：pnpm task:claim <编号...> [--as 会话名] [--scope a/,b.ts]");
  if (!added.length) fetchMain();
  const owner = sessionName(options);
  if (!owner) throw new Error("认领要写会话名：--as <会话名>（ListAgents 里自己的名字）");
  const self = { owner, host: machineName() };
  const scope = options.scope ? splitList(options.scope) : undefined;
  const all = readAll(root);
  const { byId, children } = index(all);
  const taking = [];
  for (const id of ids) {
    const task = load(root, id);
    if (CLOSED_STATUSES.includes(task.fields.status)) throw new Error(`${id} 的状态是「${task.fields.status}」，不能认领`);
    if ((children.get(id) ?? []).length) throw new Error(`${id} 有子任务，认领其中一项：pnpm tasks show ${id}`);
    const current = claimOf(root, task);
    const state = claimState(current, self);
    if (state === "mine") {
      console.log(`${id} 已经是你的（${claimText(current.fields)}），不用再认领`);
      continue;
    }
    if (state === "theirs") {
      const stale = staleOf(root, current);
      if (!stale) throw new Error(`${id} 正由 ${claimText(current.fields)} 进行中；换一项`);
      if (!options.takeover) throw new Error(`${id} 的认领已失效（${stale}）。先给 ${current.fields.owner} 发消息说明，再加 --takeover 接手`);
      console.log(`接手 ${id}：原认领 ${current.fields.owner} 已失效（${stale}）`);
    }
    const waiting = blockers(task, byId);
    if (waiting.length && !options.force) throw new Error(`${id} 还在等 ${waiting.join("、")} 完成；确实要先做，加 --force`);
    if (task.fields.needs === "user" && !options.force) throw new Error(`${id} 只有用户本人能做（needs: user）；用户让你做时加 --force`);
    for (const theirs of all) {
      if (theirs.fields.id === id || claimState(theirs, self) !== "theirs") continue;
      const overlap = scopeOverlap(scope ?? task.fields.scope, theirs.fields.scope);
      if (overlap.length) console.warn(`注意：${theirs.fields.id}（${theirs.fields.owner}）也在改 ${overlap.join("、")}`);
    }
    save(root, claimed(task, { owner, host: self.host, at: nowText(), scope }));
    taking.push(id);
    if (task.fields.issue) console.log(`${id} 对应 issue #${task.fields.issue}：动手前先在 issue 下回复认领、核实结果和打算怎么改（docs/tasks/README.md「GitHub issue」）`);
  }
  if (taking.length === 0) return 0;
  const verb = added.length ? "adds and takes" : "takes";
  return commitTasks(taking.map((id) => taskPath(id, false)), `docs(tasks): ${owner} ${verb} ${taking.join(", ")}`, options);
}

function add(root, options) {
  const [id] = options._;
  if (!isTaskId(id ?? "") || !options.title) throw new Error("用法：pnpm tasks add <编号> --title .. [--parent ..] [--depends a,b] [--needs user] [--issue 13] [--body ..] [--claim]");
  if (findTask(root, id)) throw new Error(`${id} 已经存在`);
  const codes = readGroups(root).map((group) => group.code);
  if (!codes.includes(id[0])) throw new Error(`编号的首字母是分组，只能是 ${codes.join(" / ")}（见 docs/tasks/README.md）`);
  if (options.parent && !findTask(root, options.parent)) throw new Error(`没有父任务 ${options.parent}`);
  const depends = splitList(options.depends);
  for (const other of depends) if (!findTask(root, other)) throw new Error(`没有任务 ${other}`);
  const status = options.status ?? "待做";
  if (!OPEN_STATUSES.includes(status)) throw new Error(`新任务的状态只能是 ${OPEN_STATUSES.join(" / ")}`);
  const fields = { id, title: options.title, status, scope: [], depends, parent: options.parent, needs: options.needs, issue: options.issue };
  if (options.claim) fetchMain();
  save(root, { fields, body: options.body ? `## 说明\n\n${options.body}` : "" });
  if (options.claim) return claim(root, { ...options, _: [id] }, [id]);
  console.log(`已建 ${taskPath(id, false)}；和其他改动一起提交（马上要做就用 --claim，建好、认领并提交）`);
  return 0;
}

function close(root, options, status) {
  const [id] = options._;
  const task = load(root, id);
  if (CLOSED_STATUSES.includes(task.fields.status)) throw new Error(`${id} 已经是「${task.fields.status}」`);
  const open = readAll(root).filter((child) => child.fields.parent === id && OPEN_STATUSES.includes(child.fields.status));
  if (open.length) throw new Error(`${id} 还有没结束的子任务：${open.map((child) => child.fields.id).join("、")}`);
  const { host: _host, lane: _lane, claimed: _claimed, ...fields } = task.fields;
  fields.scope = [];
  let body = task.body;
  if (status === "已完成") {
    const subjects = options.commit;
    if (subjects.length === 0) throw new Error("加 --commit \"<功能提交的标题>\"（或已有的提交号），然后和功能改动放在同一个提交里");
    for (const subject of subjects) body = addLine(body, "提交", /^[0-9a-f]{7,40}$/.test(subject) ? subject : `\`${subject}\``);
    fields.done = todayText();
  } else {
    if (!options.reason) throw new Error("用法：pnpm tasks drop <编号> --reason \"为什么不做\"");
    body = addLine(body, "备注", `${todayText()} 不做：${options.reason}`);
  }
  const { byId } = index(readAll(root));
  const waiting = blockers(task, byId);
  if (status === "已完成" && waiting.length) console.warn(`注意：${id} 依赖的 ${waiting.join("、")} 还没结束`);
  const file = save(root, { fields: { ...fields, status }, body });
  const when = status === "已完成" ? "和功能改动放在同一个提交里" : "提交它（可以单独提交，也可以随别的改动）";
  console.log(`${id} 已标为「${status}」并移到 ${file}；${when}`);
  return 0;
}

function release(root, options) {
  const [id] = options._;
  const task = load(root, id);
  if (claimState(task, me(options)) !== "mine") throw new Error(`${id} 不是你认领的（${claimText(task.fields)}）；用 --as <会话名> 说明你是谁`);
  let next = unclaimed(task, "待做");
  if (options.reason) next = { ...next, body: addLine(next.body, "交接", `${nowText()} ${task.fields.owner}：放回，${options.reason}`) };
  save(root, next);
  return commitTasks([taskPath(id, false)], `docs(tasks): ${task.fields.owner} gives back ${id}`, options);
}

function conflicts(root) {
  run("git", ["fetch", "-q", "origin"]);
  const result = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", "origin/main", "HEAD"], { encoding: "utf8" });
  const files = result.stdout.trim().split("\n").slice(1).filter(Boolean);
  if (result.status === 1) console.log(`和 origin/main 冲突的文件：\n  ${files.join("\n  ")}`);
  else if (result.status === 0) console.log("和 origin/main 没有冲突。");
  else console.error(result.stderr.trim());
  const changed = (tryGit(["diff", "--name-only", "origin/main...HEAD"]) ?? "").split("\n").filter(Boolean);
  const self = me({});
  let shared = 0;
  for (const task of readAll(root)) {
    if (claimState(task, self) !== "theirs") continue;
    const touched = filesInScope(changed, task.fields.scope);
    if (touched.length) {
      shared += 1;
      console.log(`${task.fields.id}（${claimText(task.fields)}）声明了这些文件：${touched.join("、")}`);
    }
  }
  return result.status === 1 || shared > 0 ? 1 : 0;
}

function show(root, id) {
  const file = findTask(root, id);
  if (!file) throw new Error(`没有任务 ${id}`);
  const task = load(root, id);
  console.log(`# ${path.relative(root, file).replaceAll("\\", "/")}\n`);
  console.log(formatTask(task));
  const lines = relationLines(task, readAll(root), { exists: (link) => existsSync(path.join(root, link)) });
  if (lines.length) console.log(lines.join("\n"));
  return 0;
}

function landing(root) {
  for (const line of hostReminders(root, machineName())) console.warn(`[tasks] ${line}`);
  const problems = landingProblems(root);
  for (const problem of problems) console.error(`[tasks] ${problem}`);
  return problems.length ? 1 : 0;
}

async function main(argv) {
  const root = git(["rev-parse", "--show-toplevel"]);
  const [command = "list", ...rest] = argv;
  const options = parseArgs(command.startsWith("--") ? argv : rest);
  const groups = () => readGroups(root);
  const stale = (task) => staleOf(root, task);
  switch (command.startsWith("--") ? "list" : command) {
    case "list":
      if (options.json) console.log(JSON.stringify(jsonRows(readAll(root), { stale, all: options.all }), null, 2));
      else console.log(boardLines(readAll(root), { groups: groups(), stale, all: options.all }).join("\n"));
      return 0;
    case "next":
      console.log(nextLines(readAll(root), { groups: groups(), stale }).join("\n"));
      return 0;
    case "show":
      return show(root, options._[0]);
    case "claim":
      return claim(root, options);
    case "add":
      return add(root, options);
    case "done":
      return close(root, options, "已完成");
    case "drop":
      return close(root, options, "不做");
    case "note": {
      const [id, ...words] = options._;
      const task = load(root, id);
      if (words.length === 0) throw new Error("用法：pnpm tasks note <编号> <进度和下一步>");
      const who = sessionName(options) || task.fields.owner || "";
      save(root, { ...task, body: addLine(task.body, "交接", `${nowText()}${who ? ` ${who}` : ""}：${words.join(" ")}`) });
      return 0;
    }
    case "release":
      return release(root, options);
    case "stale": {
      const list = readAll(root).filter((task) => stale(task));
      for (const task of list) console.log(`${task.fields.id}  ${task.fields.owner}：${stale(task)}`);
      if (list.length === 0) console.log("没有失效的认领。");
      return 0;
    }
    case "conflicts":
      return conflicts(root);
    case "check": {
      const problems = checkTasks(root);
      for (const problem of problems) console.error(problem);
      if (problems.length === 0) console.log(`[tasks] ${readAll(root).length} task files are fine`);
      return problems.length ? 1 : 0;
    }
    case "landing":
      return landing(root);
    default:
      throw new Error(`未知命令 ${command}；见 scripts/tasks/tasks.mjs 开头的说明`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
