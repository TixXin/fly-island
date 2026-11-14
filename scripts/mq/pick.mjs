import { execFileSync } from "node:child_process";
import { mergeTree } from "./mergeTree.mjs";
import { git, tryGit } from "./settings.mjs";

const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

function resolve(name, local, upstream) {
  const found = tryGit(["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  if (!found.ok || !found.out) return { error: `找不到提交 ${name}。` };
  if (!local.includes(found.out)) return { error: `${name} 不在本地还没推的提交里（${upstream}..HEAD），--only 只能带这些提交。` };
  if (git(["rev-list", "--parents", "-n", "1", found.out]).split(/\s+/).length > 2) return { error: `${name} 是合并提交，不能单独带。` };
  return { sha: found.out };
}

function commitLike(sha, tree, parent) {
  const [name, email, date, message] = git(["log", "-1", "--format=%an%x1f%ae%x1f%aI%x1f%B", sha]).split("\x1f");
  const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date };
  return execFileSync("git", ["commit-tree", tree, "-p", parent, "-F", "-"], { encoding: "utf8", input: `${message.trimEnd()}\n`, env, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function describe(sha) {
  return git(["log", "-1", "--format=%h %s", sha]);
}

function leftBehind(files, local, carried, upstream) {
  if (!files.length) return [];
  const touching = lines(tryGit(["log", "--no-merges", "--format=%H", `${upstream}..HEAD`, "--", ...files]).out);
  return touching.filter((sha) => local.includes(sha) && !carried.includes(sha)).map(describe);
}

function refusal(sha, conflicts, others, upstream) {
  return [
    `${describe(sha)} 叠不到 ${upstream} 上，没有开 PR。`,
    conflicts.length ? `  冲突的文件：${conflicts.join("、")}` : "",
    others.length
      ? `  本地没带上、也改过这些文件的提交：\n${others.map((line) => `    ${line}`).join("\n")}\n  把它们一起写进 --only，或者整批 pnpm mq:land --yes。`
      : `  ${upstream} 上有人改了同一处：整批 pnpm mq:land --yes，按提示解决冲突。`,
  ].filter(Boolean).join("\n");
}

export function pickOnto(upstream, requested) {
  const local = lines(tryGit(["rev-list", "--reverse", `${upstream}..HEAD`]).out);
  if (!requested.length) return { error: "--only 后面要写提交号，例如 pnpm mq:land --yes --only abc1234 def5678。" };
  const wanted = [];
  for (const name of requested) {
    const { sha, error } = resolve(name, local, upstream);
    if (error) return { error };
    wanted.push(sha);
  }
  const ordered = local.filter((sha) => wanted.includes(sha));
  let tip = git(["rev-parse", upstream]);
  const picked = [];
  const skipped = [];
  for (const sha of ordered) {
    const { tree, conflicts } = mergeTree(tip, sha, `${sha}^`);
    if (!tree) return { error: refusal(sha, conflicts, leftBehind(conflicts, local, ordered, upstream), upstream) };
    if (tree === git(["rev-parse", `${tip}^{tree}`])) {
      skipped.push(describe(sha));
      continue;
    }
    tip = commitLike(sha, tree, tip);
    picked.push(sha);
  }
  return { tip, picked, skipped };
}
