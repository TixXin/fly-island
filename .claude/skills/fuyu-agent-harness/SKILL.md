---
name: fuyu-agent-harness
description: >
  ALWAYS invoke BEFORE adding a new AI agent harness to the Fuyu island, or before
  extending an agent feature (hooks, status light, waiting, approval, reply marker,
  usage ring, SSH remote, cc-connect, push, session list) to more harnesses, including
  a small fix where one harness is missing from a list. Do NOT change per-agent wiring
  in src/features/agent-status or src-tauri/src/agent_status without loading this
  skill first. 触发：接入新的 agent / harness、支持某个 AI 代理、给某家补钩子、某家没显示、
  只有 Claude Code 和 Codex、安装/修复漏了、远程侧适配、cc-connect 接入、用量环加一家。
---

# 接入或扩展一家 AI 代理（harness）

岛上「代理」的功能是一层层加的：会话列表、钩子、状态灯、等你、审批、回复标记、用量、SSH、cc-connect、推送。每加一家，或给一项功能多支持一家，都要把这些层过一遍，漏掉的就会像状态灯卡片那样只剩两家。现状记在 `docs/architecture/agent/harnesses.md`，开工前先读它和 `docs/research/agent-harnesses.md`。

## 1. 先摸清这一家（写进调研，不靠猜）

逐条查清楚并写进 `docs/research/`（规则见 `docs/research/README.md`），本机没装的标「按文档，未实测」：

- **形态**：CLI、桌面 App、IDE 扩展、服务器版各有没有。每种形态的会话、配置、钩子、全局提示词文件是共用一处还是各存各的；不共用的，每种分开列。
- **会话**：文件在哪、什么格式（JSONL、JSON 检查点、sqlite、压缩），标题、模型、目录、最近提问和回复、进行中 / 完成 / 出错从哪读，怎么判断会话已退出。
- **钩子**：配置文件在哪、格式像谁（Claude Code、自有格式、要装桥接插件）；有哪些事件能对上开始、结束、等授权、提问；能不能挂起等结果再回传 allow / deny（决定能不能在岛上审批）；改完配置要不要重启。
- **全局提示词文件**（回复标记写在这里）、**用量 / 额度**接口、**Linux CLI** 及其 glibc 要求、**cc-connect** 支不支持这一家。
- **跳转**：进程名、窗口，能不能定位到具体会话。

## 2. 定做法

- 每项功能优先复用同一套机制：会话按共同的会话结构接进 `session_scan`，钩子由「安装/修复」统一装，状态、等你、审批走同样的文件和接口。只在这家缺事件、缺数据的地方单独处理，并写明缺什么。
- 碰到把代理写死成固定几家的列表或分支（`AGENT_PROVIDERS`、`AgentHooksState`、`if codex || claude_code`、白名单），改成按一份代理列表走，不要只多加一个分支。
- **远程侧**只给能在 Linux 服务器上跑的 CLI 形态做。没有 CLI 的标「不适用」，不做。
- 做不到的功能在矩阵里标 ✗ 并开 issue（流程见 `docs/tasks/README.md`），不要静默跳过。

## 3. 逐层改（每层都要过，不适用的写明原因）

| 层 | 要动的地方 |
|---|---|
| 身份 | Rust 里这家的模块和 `PROVIDER` 常量；前端 `SessionProvider` / `AgentProvider`（`agent-status/api.ts`）、`AGENT_PROVIDERS` 和名称表（`status.ts`）、`AgentProviderIcon.tsx` 和 `src/assets/brands/`（来源写进同目录的 `README.md`）、`effortLabels.ts`；设置里的显示 / 隐藏开关（`appearance/types.ts`、`settingsDefaults.ts`、`normalizeAgentSettings.ts`、`AgentSettingsPage.tsx`、i18n，改完 `pnpm settings:index`） |
| 会话 | 读会话的函数，接进 `session_scan.rs`（本机和远程镜像两条路都要接）；标题、权限模式、待办、当前工具、已退出判断；`focus.rs` 的跳转 |
| 钩子 | `install_agent_status_hooks_now` 和 `reinstall_hooks_after_rename` 两处都调用这家的 `install_hooks`；`hooks/` 里 `.cmd` / `.ps1` / `.sh` 三份脚本都加这家的分支（脚本由 `include_str!` 编进二进制，按 Rust 改动验证）；`hooks_state.rs` 的钩子状态 |
| 状态灯 | 快照（`snapshot.rs`、`agent-status.json`）、`markers.rs`、`external.rs`；设置页状态灯卡片（`listAgentStatuses`、`getAgentHooksNotice`） |
| 等你 / 审批 | 等授权的钩子写进 `agent-notifications/<家>-*.json`（`notifications.rs` 认）；在岛上审批要加 `agent_approval/decision.rs` 的 `Agent` 和路由、审批脚本，并放宽前端 `approvals/api.ts` 的类型 |
| 回复标记 | `reply_marker.rs` 写这家的全局提示词文件，这家的会话解析里认出标记 |
| 用量环 | 读取命令、`UsageProviderId`（`claude-usage/usageRing.ts`）、`useAgentUsages.ts`、`AgentUsageBar.tsx`、内置插件的设置（`plugin_host/builtin.rs`） |
| 远程 | `remote_fetch.rs` 的拉取列表、`remote_sessions.rs` 的 `mirror_path` 白名单、`remote_setup.rs` 的远程安装、前端 `remoteSessions.ts` |
| cc-connect | `cc_connect/config_file.rs`、`src/features/cc-connect/` |
| 其他 | 推送（`push/pushText.ts`、`push_detail.rs`）、`plugin_host/effort_labels.rs`、`builtin.rs` 里的说明文字、实验台 `scripts/island-lab/`、引导和外观预览 |

找漏网的地方：`rg -il "<已有的一家，例如 workbuddy>" src src-tauri/src scripts packages/vscode-extension`，再和 `rg -il claudeCode` 的结果对比，Claude Code 有、这家没有的每个文件都要过一遍。

## 4. 验证和文档

- 这家的模块带单元测试（真实样本脱敏后做测试数据）；按改动范围跑 `AGENTS.md`「验证」表要求的检查，改了界面再跑 `pnpm test:regression`。
- 真机实测：每种形态各开一个会话，核对列表、三态、等你、审批、跳转，以及点「安装/修复」后状态灯卡片里有没有这一家。没测的列进实测清单的 issue。
- 同一个提交里更新：`docs/architecture/agent/harnesses.md` 的两张表、`docs/features/agent-status-hooks.md` 里这家的一节、`docs/architecture/platforms.md`；新增了文件或 key 的，再更新 `contracts.md` 和 `data-storage.md`。
