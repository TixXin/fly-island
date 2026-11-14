import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mainCheckout, PUBLISH_DIR, targetDir } from "../build-dirs.mjs";
import { findCiRun } from "./ci-build.mjs";
import { MAC_WORKFLOW, startMacBuild } from "./mac-build.mjs";
import { readVersion, VERSION_FILES } from "./versions.mjs";
import { startWindowsBuild, WINDOWS_WORKFLOW } from "./windows-build.mjs";

const REPO = "TixXin/fuyu";
export const PREBUILD_FILE = join(targetDir(mainCheckout(), PUBLISH_DIR), "prebuild.json");

export function matchingPrebuild(record, { version, tree }) {
  if (!record || record.version !== version || record.tree !== tree) return null;
  return Number.isInteger(record.windows) ? record : null;
}

export function readPrebuild(file = PREBUILD_FILE) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

export function forgetPrebuild(file = PREBUILD_FILE) {
  rmSync(file, { force: true });
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function gh(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, stdio: options.capture ? "pipe" : "inherit" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function prebuild() {
  const versions = Object.entries(VERSION_FILES).map(([kind, path]) => readVersion(kind, readFileSync(path, "utf8")));
  const version = versions[0];
  if (!version || versions.some((found) => found !== version)) throw new Error("The four version files disagree; run pnpm release:version first.");
  const revision = git(["rev-parse", "HEAD"]);
  if (!git(["branch", "-r", "--contains", revision]).includes("origin/")) {
    throw new Error(`${revision} is not on GitHub yet: run pnpm mq:land --yes first, then this.`);
  }
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  const record = { version, revision, tree, at: new Date().toISOString() };
  for (const [key, start, workflow] of [["windows", startWindowsBuild, WINDOWS_WORKFLOW], ["mac", startMacBuild, MAC_WORKFLOW]]) {
    const started = start(gh, { repo: REPO, revision, version });
    if (started.problem) throw new Error(started.problem);
    const found = findCiRun(gh, { workflow, repo: REPO, since: started.since });
    if (!found) throw new Error(`${workflow} was started but its run did not show up within a minute`);
    record[key] = found.databaseId;
    console.log(`✓ ${workflow}: ${found.url}`);
  }
  mkdirSync(dirname(PREBUILD_FILE), { recursive: true });
  writeFileSync(PREBUILD_FILE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n✓ Prebuilding v${version} at ${revision.slice(0, 8)}. Once the PR is merged, pnpm release uses these runs if main has the same files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    prebuild();
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  }
}
