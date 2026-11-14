#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = "fuyu-agent-harness";

const WIRING = [
  "src/features/agent-status/status.ts",
  "src/features/agent-status/api.ts",
  "src/features/agent-status/effortLabels.ts",
  "src/features/agent-status/AgentProviderIcon.tsx",
  "src/features/agent-status/remoteSessions.ts",
  "src/features/agent-status/approvals/api.ts",
  "src/features/cc-connect/api.ts",
  "src-tauri/src/agent_status/mod.rs",
  "src-tauri/src/agent_status/session_scan.rs",
  "src-tauri/src/agent_status/hooks_state.rs",
  "src-tauri/src/agent_status/snapshot.rs",
  "src-tauri/src/agent_status/markers.rs",
  "src-tauri/src/agent_status/external.rs",
  "src-tauri/src/agent_status/focus.rs",
  "src-tauri/src/agent_status/reply_marker.rs",
  "src-tauri/src/agent_status/remote_fetch.rs",
  "src-tauri/src/agent_status/remote_sessions.rs",
  "src-tauri/src/agent_status/remote_setup.rs",
  "src-tauri/src/agent_status/hooks/",
  "src-tauri/src/agent_approval/decision.rs",
  "src-tauri/src/cc_connect/config_file.rs",
];
const AGENT_MODULE = /^src-tauri\/src\/agent_status\/[^/]+\.rs$/;
const FILE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const SHELL_TOOLS = ["Bash", "PowerShell"];
const SHELL_WRITE = /\bsed\s+-i|>|\btee\b|Set-Content|Add-Content|Out-File|\bmv\b|\bcp\b|Move-Item|Copy-Item/;

const isWiring = (path) => WIRING.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

export function repoPath(root, file) {
  const path = relative(root, resolve(root, file)).replaceAll("\\", "/");
  return path.startsWith("..") || isAbsolute(path) ? null : path;
}

export function touchesWiring(input, root, exists = existsSync) {
  const args = input.tool_input ?? {};
  if (FILE_TOOLS.includes(input.tool_name)) {
    const file = args.file_path ?? args.notebook_path;
    const path = file ? repoPath(root, file) : null;
    if (path === null) return null;
    const created = input.tool_name === "Write" && AGENT_MODULE.test(path) && !exists(resolve(root, file));
    return isWiring(path) || created ? path : null;
  }
  if (SHELL_TOOLS.includes(input.tool_name)) {
    const command = String(args.command ?? "").replaceAll("\\", "/");
    if (!SHELL_WRITE.test(command)) return null;
    return WIRING.find((entry) => command.includes(entry)) ?? null;
  }
  return null;
}

export function skillLoaded(transcript) {
  return [`"skill":"${SKILL}"`, `"skill": "${SKILL}"`, `<command-name>/${SKILL}</command-name>`].some((mark) => transcript.includes(mark));
}

export function gate(input, { root, exists = existsSync, readTranscript, marked, mark }) {
  const path = touchesWiring(input, root, exists);
  if (!path || marked() || skillLoaded(readTranscript())) return null;
  mark();
  return `改 ${path} 动的是各家 AI 代理的接入点。先用 Skill 工具加载 ${SKILL}，按里面的清单把每一层过一遍，再重做这次操作（这次会话只拦一次）。`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const marker = join(tmpdir(), `fuyu-agent-harness-gate-${String(input.session_id ?? "unknown").replace(/[^\w-]/g, "")}`);
  const message = gate(input, {
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    readTranscript: () => {
      try {
        return readFileSync(input.transcript_path, "utf8");
      } catch {
        return "";
      }
    },
    marked: () => existsSync(marker),
    mark: () => writeFileSync(marker, ""),
  });
  if (message) {
    process.stderr.write(`${message}\n`);
    process.exit(2);
  }
}
