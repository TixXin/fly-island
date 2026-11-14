# 各家 AI 代理的接入现状

岛接了五家 AI 代理（harness）：Claude Code、Codex、WorkBuddy（国内版）、Antigravity、DeepSeek Harness（DSH）。这张表记每家有哪些形态、数据在哪，以及每项功能做到哪一步。改了哪家的哪一项，就在同一个提交里改这里。接入新的一家或给已有功能扩一家，按 `.claude/skills/fuyu-agent-harness/SKILL.md` 的清单走。

核对日期：2026-11-14（按 `main` 上的代码）。各家的调研和来源见 [agent-harnesses.md](../../research/agent-harnesses.md)，用户可见的行为见 [agent-status-hooks.md](../../features/agent-status-hooks.md)。

## 形态和数据位置

| | CLI | 桌面 App | IDE 扩展 | 几种形态是不是一套数据 | 岛读哪里 |
|---|---|---|---|---|---|
| Claude Code | 有 | 有（Code 页、Cowork） | VS Code | CLI、VS Code 扩展、SDK 共用 `~/.claude`（会话里的 `entrypoint` 区分）；App 的 Code 页另存在 `%APPDATA%\Claude\claude-code-sessions`，Cowork 每个会话一个独立的 `.claude`，不读 `~/.claude/settings.json` | `~/.claude/projects`、`~/.claude/sessions`；App 的两种都没读（#180） |
| Codex | 有 | 有 | VS Code | 共用 `~/.codex`（或 `CODEX_HOME`），形态看会话的 `originator`（`session_host.rs`）；2026-11-12 起历史迁进 sqlite，老会话的 rollout 文件已不在（#180） | `~/.codex/sessions` 的 rollout、`session_index.jsonl`；不读 sqlite |
| WorkBuddy | 无 | 有（国内版） | 无 | 只有桌面版；国际版 `~/.workbuddy-ai` 是另一个产品，不读 | `~/.workbuddy/projects`、`~/.workbuddy/sessions` |
| Antigravity | 有（`agy`） | 有 | 有（IDE） | 三种共用钩子配置 `~/.gemini/config/hooks.json`；数据目录分开（`antigravity`、`antigravity-ide`、`antigravity-cli`），岛只看它们在不在；只有 CLI 实测过（#179） | 钩子存下的输入 `agent-antigravity/` |
| DSH | 无（Node 程序，能跑在服务器上） | 有（官方版、anywhere-labs、DSH Desktop 等） | 无 | 三处存储按会话 id 合并，新的为准；分不出会话属于哪个桌面版 | `~/.dsh`、`~/.dsh-beta`、`%APPDATA%\dsh-desktop\harness` 的投影检查点 |

远程（SSH）只考虑有 CLI、能在 Linux 服务器上跑的形态：Claude Code、Codex、Antigravity CLI（要 glibc ≥ 2.28，未核实）、DSH。WorkBuddy 没有服务器版，不做远程。

## 功能矩阵

✓ 已做，◐ 部分，✗ 没做，— 不适用。括号里是跟进的 issue。

| 功能 | Claude Code | Codex | WorkBuddy | Antigravity | DSH |
|---|---|---|---|---|---|
| 会话列表、标题、品牌图标 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 设置里单独显示 / 隐藏 | ✓ | ✓ | ✗ | ✗ | ✗ |
| 「安装/修复」装钩子 | ✓ | ✓ | ◐ 只装 `PermissionRequest`（#175） | ◐ 开始和结束（#175） | ✗ 要用户挂桥接插件（#175） |
| 状态灯卡片的一行、钩子是否装好 | ✓ | ✓ | ✗（#175） | ✗（#175） | ✗（#175） |
| 改名后自动重装钩子 | ✓ | ✓ | ✗ 只装了这家时不会触发（#175） | ✗ 同左 | — |
| 运行中 / 完成亮灯 | ✓ | ✓ | ◐ 只靠会话数 | ◐ 只靠会话数 | ◐ 只靠会话数 |
| 「等你」 | ✓ | ✓ | ✓ 钩子没实测（#179） | ✗ 钩子没有这类事件 | ◐ 只认打开的提问 |
| 在岛上审批 | ✓ | ✓ | ✗（#175） | ✗（#175） | ✗ 只能拒绝（#175） |
| 在岛上回答提问 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 权限模式、待办、当前工具 | ✓ | ✓ | ◐ 只有当前工具 | ✗ | ✗ |
| 判断会话已退出 | ✓ | ✓ | ✓ | ✗ | ✗ |
| 点会话跳过去 | ✓ 终端 / 编辑器标签 | ✓ 终端 / 编辑器 / App | ◐ 只到 App 窗口 | ◐ 只到窗口 | ◐ 只到窗口 |
| 回复标记 | ✓ | ✗（#176） | ✗（#176） | ✗（#176） | ✗（#176） |
| 用量环 | ✓ | ✓ | ✗（#170） | ✗（#170） | ✗（#170） |
| SSH 远程会话 | ✓ 含远程钩子 | ◐ 只读会话 | — | ✗（#171） | ✗（#171） |
| cc-connect | ✓ | ✓ | ✗ 未调研 | ✗ 未调研 | ✗ 未调研 |
| 手机推送的详情、接管命令 | ✓ / ✓ | ✗ / ✓ | ✗ | ✗ | ✗ |
| 只读桌面 App 的会话 | ✗（#180） | ✓ 共用存储 | ✓ | ◐ 没实测（#179） | ✓ |

## 为什么后来的三家缺得多

Claude Code 和 Codex 是最早接的，很多地方把「代理」写死成这两家，后来的三家只接进了会话列表。写死的地方有：

- 前端 `AGENT_PROVIDERS`（`src/features/agent-status/status.ts`）、`AgentProvider` 类型（`api.ts`），状态灯卡片和钩子提示都按它列；
- Rust 的 `AgentHooksState`（`hooks_state.rs`）、快照 `agent-status.json`（`snapshot.rs`，只由 `fuyu-agent-status.*` 写）、`external.rs` 收的 `agent` 字段；
- `reinstall_hooks_after_rename` 只看 Codex 和 Claude Code 的钩子在不在；
- 远程：拉取脚本（`remote_fetch.rs`）、镜像白名单（`remote_sessions.rs` 的 `mirror_path`）、远程安装（`remote_setup.rs`）；`session_scan.rs` 只在读本机时才追加 Antigravity 和 DSH 的会话；
- 审批的 `Agent` 枚举（`agent_approval/decision.rs`）、cc-connect 的配置（`cc_connect/config_file.rs`）、推送接管命令（`push/pushText.ts`）。

改这些地方时，优先改成按一份代理列表走，而不是再加一个分支。
