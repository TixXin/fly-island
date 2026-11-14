import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { gate, SKILL, touchesWiring } from "../../scripts/agent-harness-gate.mjs";

const ROOT = join("C:", "repo");
const edit = (file, tool = "Edit") => ({ tool_name: tool, tool_input: { file_path: file } });
const shell = (command) => ({ tool_name: "Bash", tool_input: { command } });

test("edits to the per-agent lists and new agent modules count as wiring; other files do not", () => {
  assert.equal(touchesWiring(edit(join(ROOT, "src", "features", "agent-status", "status.ts")), ROOT), "src/features/agent-status/status.ts");
  assert.equal(touchesWiring(edit("src-tauri/src/agent_status/hooks/fuyu-agent-running.cmd"), ROOT), "src-tauri/src/agent_status/hooks/fuyu-agent-running.cmd");
  assert.equal(touchesWiring(edit("src-tauri/src/agent_status/kimi.rs", "Write"), ROOT, () => false), "src-tauri/src/agent_status/kimi.rs");
  assert.equal(touchesWiring(edit("src-tauri/src/agent_status/title.rs", "Write"), ROOT, () => true), null);
  assert.equal(touchesWiring(edit("src/features/todo/TodoList.tsx"), ROOT), null);
  assert.equal(touchesWiring(edit(join("C:", "elsewhere", "src", "features", "agent-status", "status.ts")), ROOT), null);
});

test("shell commands count only when they write to a wiring file", () => {
  assert.equal(touchesWiring(shell("sed -i 's/a/b/' src-tauri/src/agent_status/session_scan.rs"), ROOT), "src-tauri/src/agent_status/session_scan.rs");
  assert.equal(touchesWiring(shell("grep -n codex src-tauri/src/agent_status/session_scan.rs"), ROOT), null);
  assert.equal(touchesWiring({ tool_name: "Read", tool_input: { file_path: "src/features/agent-status/status.ts" } }, ROOT), null);
});

test("the gate blocks once per session and lets through once the skill is loaded", () => {
  let marked = false;
  const options = (transcript) => ({ root: ROOT, readTranscript: () => transcript, marked: () => marked, mark: () => { marked = true; } });
  const input = edit("src/features/agent-status/status.ts");
  assert.equal(gate(input, options(`{"name":"Skill","input":{"skill":"${SKILL}"}}`)), null);
  assert.equal(gate(input, options(`<command-name>/${SKILL}</command-name>`)), null);
  assert.equal(marked, false);
  assert.match(gate(input, options(`skills listed: ${SKILL}`)), new RegExp(SKILL));
  assert.equal(marked, true);
  assert.equal(gate(input, options("")), null);
});
