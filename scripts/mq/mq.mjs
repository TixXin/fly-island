import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommit } from "./checkCommit.mjs";
import { checkPush } from "./checkPush.mjs";
import { land, pendingCommits } from "./land.mjs";
import { INTEGRATION_BRANCH, tryGit } from "./settings.mjs";
import { sync } from "./sync.mjs";
import { waitCommand } from "./wait.mjs";

const BATCH_COMMITS = 5;
const BATCH_HOURS = 6;

export function batchAdvice(commits, now = Date.now()) {
  if (!commits.length) return { due: false, reason: "没有没推的提交" };
  const hours = (now - Math.min(...commits.map((commit) => commit.at))) / 3_600_000;
  if (commits.length >= BATCH_COMMITS) return { due: true, reason: `攒了 ${commits.length} 个提交` };
  if (hours >= BATCH_HOURS) return { due: true, reason: `最早的提交已经 ${Math.floor(hours)} 小时没推` };
  return { due: false, reason: `${commits.length} 个提交没推，最早的 ${Math.max(0, Math.round(hours * 60))} 分钟前` };
}

function pending() {
  tryGit(["fetch", "origin", INTEGRATION_BRANCH, "--quiet"]);
  const commits = pendingCommits();
  for (const { subject } of commits) console.log(`  ${subject}`);
  const { due, reason } = batchAdvice(commits);
  console.log(due ? `[pending] ${reason}，该提 PR 了：pnpm mq:land --yes --body <文件>` : `[pending] ${reason}；一个功能做完、要给另一台机器用或发版前再提 PR`);
  return 0;
}

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] ?? "" : null;
}

export function listOption(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const rest = args.slice(at + 1);
  const end = rest.findIndex((arg) => arg.startsWith("--"));
  return end < 0 ? rest : rest.slice(0, end);
}

const LAND_OPTIONS = ["--yes", "--wait", "--body", "--title", "--only"];

const HELP = [
  "用法：node scripts/mq/mq.mjs <命令> [参数]",
  "",
  "  pending                 列出本地还没推的提交，说到没到该提 PR 的时候",
  "  land --yes [参数]       把本地提交推到 land/ 分支、开 PR 并开启自动合并；不写 --yes 不会推",
  "      --body <文件>       中文 PR 正文",
  "      --title <标题>      英文 PR 标题，默认取第一个提交的标题",
  "      --only <提交号…>    只带这几个提交，开单独的 PR",
  "      --wait              在前台等到合入",
  "  wait [PR 号] [--update]  等 PR 合入，把本地 main 跟上；--update 在它落后时更新分支",
  "  sync                    把 origin/main 合进本地 main",
  "  check-push、check-commit  git 钩子用",
  "",
  "任何命令带 --help 或 -h，以及不带参数的 land，都只显示这份说明。",
].join("\n");

export function landRequest(args) {
  if (!args.length) return { help: true };
  const unknown = args.find((arg) => arg.startsWith("-") && !LAND_OPTIONS.includes(arg));
  if (unknown) return { error: `land 不认识参数 ${unknown}。` };
  if (!args.includes("--yes")) return { error: "land 会推送并开 PR，确认要推就加上 --yes。" };
  return { options: { wait: args.includes("--wait"), bodyFile: option(args, "--body"), title: option(args, "--title"), only: listOption(args, "--only") } };
}

function landCommand(args) {
  const request = landRequest(args);
  if (request.options) return land(request.options);
  if (request.error) console.error(`[land] ${request.error}\n`);
  console.log(HELP);
  return request.error ? 1 : 0;
}

const COMMANDS = {
  land: landCommand,
  wait: (args) => waitCommand(args),
  sync: () => sync(),
  pending,
  "check-push": () => checkPush(),
  "check-commit": () => checkCommit(),
};

export async function main(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const run = COMMANDS[argv[0]];
  if (!run) {
    console.error(`[mq] 没有 ${argv[0]} 这个命令。\n`);
    console.log(HELP);
    return 1;
  }
  return run(argv.slice(1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[mq] ${error.message}`);
    process.exitCode = 1;
  }
}
