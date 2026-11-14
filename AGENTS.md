# AGENTS.md

本文件是仓库的总规则，面向在本仓库工作的 AI 编程代理和协作者。规则按目录就近生效：

- 修改 `src/` 时还须遵守 [src/AGENTS.md](src/AGENTS.md)（前端规则）。
- 修改 `src-tauri/` 时还须遵守 [src-tauri/AGENTS.md](src-tauri/AGENTS.md)（Rust / Tauri 规则）。
- 目标架构见 [docs/architecture/overview.md](docs/architecture/overview.md)，结构重构的分步记录、验证结果与待人工验收项见 [docs/architecture/history/refactor-plan.md](docs/architecture/history/refactor-plan.md)。

子目录规则比本文件更具体，两者冲突时以子目录规则为准。

## 项目概览

浮屿 / Fuyu（仓库 `TixXin/fuyu`，改名前叫 FocuSD Island，仓库名 fly-island）是 Windows 优先的桌面效率工具，以透明、无边框、始终置顶的 Tauri 悬浮岛形式运行。主要功能：待办、每日笔记与归档，日历与会议提醒，外观设置、预设与主题市场，媒体控制与同步歌词，剪贴板历史与文件中转，快捷翻译，截图与贴图，QQ 通知、多邮箱和微信提醒，音量亮度与摄像头麦克风提示，手机推送，AI 代理状态，以及自动更新。

应用有六个窗口，外加截图时每个显示器一个选区窗口、每张贴图一个窗口，前端通过同一入口的 `?window=` 参数分发：

| 窗口 label | 前端入口 | 说明 |
|---|---|---|
| `main` | 默认 | 悬浮岛本体，折叠态 / 展开态 / 贴边收起 |
| `translation` | `?window=translation` | 快捷翻译窗口，常驻、隐藏显示 |
| `clipboard` | `?window=clipboard` | 剪贴板独立窗口，常驻、隐藏显示，快捷键或 Win+V 弹出 |
| `clipboard-preview` | `?window=clipboard-preview` | 剪贴板的空格预览，贴在剪贴板窗口旁边；常驻、隐藏显示，不抢焦点 |
| `settings` | `?window=settings` | 设置窗口，`create: false`，按需创建 |
| `onboarding` | `?window=onboarding` | 新手引导，`create: false`；透明全屏遮罩，在真岛上演示；新装第一次启动时打开，设置 → 关于里能再打开 |
| `screenshot-<n>` | `?window=screenshot` | 截图的选区窗口，每个显示器一个；打开截图模块时创建，平时隐藏 |
| `pin-<n>` | `?window=pin` | 贴到屏幕上的截图，每张一个，按需创建 |

**结构重构已完成（Phase 0–6，收尾与待人工验收项见 [refactor-plan.md](docs/architecture/history/refactor-plan.md)）。** 代码已按 [overview.md](docs/architecture/overview.md) 的目标结构组织：Rust 侧的 `unsafe` 只在平台层 `src-tauri/src/win32/`、`src-tauri/src/macos/` 中，生产代码不用 `unwrap` / `expect`，clippy 与 ESLint 均为 0 告警。新代码沿用这套结构与子目录规则。

## 技术栈

- 前端：React 19、TypeScript（strict）、Vite 7，图标使用 lucide-react，HTML 清理使用 dompurify
- 桌面壳：Tauri 2（opener、updater、single-instance、dialog 插件；dialog 只用来选文件夹）
- 原生能力：Rust 2021，`windows` crate（Win32 / WinRT）
- 包管理器：pnpm；前端单元测试使用 Node 内置 `node:test`

## 目录总览

```text
.
├── src/                 # React 前端（规则见 src/AGENTS.md）
├── src-tauri/           # Tauri / Rust 桌面端（规则见 src-tauri/AGENTS.md）
│   ├── src/             # 原生命令、后台服务、窗口管理
│   ├── examples/        # 手动运行的 QQ / 微信探测程序，不进入发布产物
│   ├── capabilities/    # Tauri 权限能力配置
│   └── tauri.conf.json  # 窗口、更新、打包配置
├── tests/               # unit/ 前端单元测试、scripts/ 脚本测试（node:test，*.test.mjs）；regression/ 浏览器回归页（*.html + *.tsx）
├── packages/            # 插件开发者工具（pnpm workspace）：fuyu-plugin（Node SDK、CLI、模拟宿主）、create-fuyu-plugin（脚手架）、powershell/Fuyu.Plugin；vscode-extension（切到会话终端的 VS Code 扩展，不在 workspace 里，`pnpm dlx @vscode/vsce package --no-dependencies` 打包）；不进入岛屿的发布产物
├── plugins/             # 插件市场：examples/ 示例插件源码（PowerShell，含 lib/focusd.ps1），drafts/ 写好了、还没打包签名的官方插件（签名私钥只在 Windows 那台机器上，说明见 plugins/drafts/README.md），schema/ 协议描述，market/ 每个市场插件的元数据（发布者、分类，生成索引用），sdk/ 单文件 SDK（pnpm sdk:build 从 packages/ 生成），packages/ 打包好的 zip，index.json 与 index.json.sig 给切换前的旧版岛屿的市场索引（pnpm plugins:index 生成；新版岛屿读 TixXin/fuyu-plugins），signing-keys.json 可信公钥（编译进岛屿），revoked.json 与 revoked.json.sig 撤销名单，author-key.json 官方作者签名公钥；不进入发布产物
├── scripts/             # release/ 发布、签名与 latest.json 生成；readme/ 生成仓库首页 README 用的 SVG；plugins/ 插件索引、签名与 SDK 生成；mq/ 攒批开 PR 合入（`pnpm mq:*` 和 pre-push 检查）；island-lab/ 岛屿实验台（`pnpm lab`）；根目录放开发流程脚本：合并队列的检查（land-check.mjs）、Claude Code 的 PreToolUse 钩子（agent-harness-gate.mjs，改各家 AI 代理的接入点前要先加载 `fuyu-agent-harness` skill，登记在 `.claude/settings.json`）、行数检查、浏览器回归页运行器（run-regression.mjs）、dev 前停止运行中的岛屿
├── video/               # 宣传视频：真的前端加假后端在浏览器里跑，按时间表逐帧渲染成 MP4；自带 package.json，不在 workspace 里（用法见 video/README.md）；成片不进仓库
├── .githooks/           # pre-push：合并队列的推送保护与检查；pre-commit：在 main 上提交必须写文件名（`git commit -- <文件>`），免得带走别的会话暂存的改动；commit-msg：拒绝 Claude 署名行（只管本仓库自己的提交，合入的外部 PR 可以带；core.hooksPath 指向这里）
├── docs/                # 按文档性质分目录，索引和各目录放什么见 docs/README.md：features/ 功能说明，architecture/ 架构与契约（agent/、plugins/ 内部设计，history/ 做完的计划），design/ 界面约定，plugins/ 插件开发，investigations/ 自己应用的排查与验收，research/ 外部调研，reviews/ PR 评审，releases/ 发布说明，assets/ 演示视频与图片，tasks/ 任务（README.md 是规则，按编号首字母分文件夹，0-archive/ 放已结束的）
└── README*.md           # 中英文项目说明
```

注意：被 `include_str!` 编译进 Rust 二进制的脚本放在使用它们的模块旁边（`src-tauri/src/agent_status/hooks/`、`src-tauri/src/qq_notifications/`），修改它们按 Rust 改动验证。

## 常用命令

| 用途 | 命令 |
|---|---|
| 安装依赖 | `pnpm install` |
| 前端开发服务器 | `pnpm dev` |
| 桌面开发模式 | `pnpm tauri dev`（用户自己跑；所有会话都在主工作区改代码，改动马上能看到） |
| 开发版和正式版同时开 | `pnpm dev:side`（用户自己跑；开发版用独立身份 `com.tixxin.fuyu.lane-1`，数据是它自己的一套，启动时不停安装的正式版，见 workflow.md「开发版和正式版同时开」） |
| 类型检查并构建前端 | `pnpm build` |
| 前端单元测试 | `pnpm test`（即 `node --test "tests/**/*.test.mjs" "packages/*/test/**/*.test.mjs"`） |
| 前端静态检查 | `pnpm lint`（ESLint，配置见 `eslint.config.js`） |
| 文件行数检查 | `pnpm check:size` |
| 深色专用颜色检查 | `pnpm check:colors`（CSS 里写死的颜色要写成 `var(--变量, 原值)`；存量记在 `scripts/color-literal-allowlist.json`，只减不增，规则见 `src/AGENTS.md`） |
| 回归页类型检查 | `pnpm check:tests-types`（`tests/tsconfig.json`，检查 `tests/regression/*.tsx`） |
| 浏览器回归页 | `pnpm test:regression [页面名中的词]`（自带 Vite，用无头 Chrome / Edge 跑 `tests/regression/` 下全部回归页并汇总结果，约 20 秒；每页检查通过后再把页面切成浅色岛，文字对比度低于 3:1 就算失败；Mac 上找 /Applications 里的 Chrome、Edge 或 Chromium，都没有时设 `CHROME_PATH`） |
| 岛屿实验台 | `pnpm lab`（打开 http://127.0.0.1:5199/，点按钮让正在跑的 `pnpm tauri dev` 的岛弹消息、展开收起、模拟刘海、发起 Agent 审批；不用开本地接口，见 `docs/features/island-lab.md`） |
| README 的 SVG | `pnpm readme:assets`（重新生成 `docs/assets/readme/` 里的小岛和下载按钮；改它们改 `scripts/readme/assets.mjs`，不直接改 SVG） |
| 设置搜索索引 | `pnpm settings:index`（新增、删除或改名设置项后运行，重写 `src/windows/settings/searchIndex.json`；漏跑时 `settings-search` 回归页会失败） |
| 提交前总检查 | `pnpm check`（类型检查 + 回归页类型检查 + packages 类型检查 + lint + 行数检查 + 颜色检查 + 任务检查 + 单元测试） |
| Rust 单元测试 | `cargo test --manifest-path src-tauri/Cargo.toml` |
| 仅生成 release 可执行文件 | `pnpm build:exe`（写到 `src-tauri/target/release`，岛屿在运行也不用关；Mac 上打成 `Fuyu.app`） |
| 清理 Rust 构建缓存 | `pnpm prune:target [--dry-run]`（删 `src-tauri/target` 里 3 天没用的增量缓存、本应用的旧产物和 lane 时期留下的预览目录；`pnpm verify` 跑完 `cargo test` 后自动跑） |
| 完整打包 | `pnpm tauri build` |
| 改版本号、起草发布说明 | `pnpm release:version <版本号>`（四处版本号一起改，不要手动改） |
| 发布 | `pnpm release`（流程见 `docs/features/updater.md`） |
| 合入 main | `pnpm mq:pending`（本地还没推的提交，到没到该提 PR 的时候）；`pnpm mq:land --yes --body <中文 PR 正文文件>`（先把 `origin/main` merge 进来，推到 `land/…` 分支、开 PR 并开启自动合并，正文格式见 workflow.md「PR 的标题和正文」），再后台 `pnpm mq:wait` 等合入并把本地 `main` 跟上；只想先合入几个独立的提交用 `pnpm mq:land --yes --only <提交号…>`（单独的 PR，不碰工作区，见 workflow.md）；手动跟上 `pnpm mq:sync`（都在 `scripts/mq/`） |

如果运行环境禁止派生子进程（例如受限沙箱），`node --test` 需要加 `--test-isolation=none`。此时 `tests/scripts/release-manifest.test.mjs` 仍会因 `spawnSync` 被拦截而失败，这是环境限制，报告时应如实说明。如果 `vite build` 报错无法删除系统临时目录中的 esbuild 文件（Access is denied），可以把 `TEMP` / `TMP` 指向 `node_modules/.cache/` 下的目录后重试。

## 代码规模规则（全局）

单个文件的行数上限（按物理行计）：

| 文件类型 | 上限 |
|---|---|
| `.ts` / `.tsx` / `.mjs` | 400 行 |
| `.css` | 500 行 |
| `.rs` | 800 行，只计生产代码（不含内联测试模块）；内联测试模块上限 150 行，超过时移到同目录的 `tests.rs`，`tests.rs` 不设上限 |
| `.ps1` / `.cmd` | 400 行 |

- **豁免**：`src/i18n/locales/*.ts`、`src/i18n/sections/**/*.ts`、`src/i18n/types.ts`（文案字典），锁文件、二进制资源和生成产物。
- **存量白名单（只减不增）**：重构前已经超限的文件登记在 `scripts/file-size-allowlist.json` 中，并记录当前行数作为上限。白名单内的文件**不得变得更长**；变短后把记录值同步改小；降到上限以下或文件被移走后，必须删除对应条目。只允许调小或删除白名单记录，不得调大或新增。
- `pnpm check:size`（`scripts/check-file-size.mjs`）负责检查以上规则，扫描 `src/`、`src-tauri/src/`、`src-tauri/examples/`、`scripts/`、`tests/`、`packages/`。
- **不往超限文件里加新功能**。新功能写在目标结构的对应位置，再从旧文件中引用。
- 一个文件只承担一个职责。不新建 `helpers.ts`、`common.rs`、`misc.css` 这类没有明确领域的"杂物"文件。

## 对外契约（不得随意变更）

下列标识会被已安装用户的数据、配置或外部程序引用。纯重构提交中**一律不得改变**：

- `localStorage` key（`fuyu-*`，改名前是 `focusd-island-*`，完整清单见 [contracts.md](docs/architecture/contracts.md)）及其存储的数据格式
- Tauri 命令名（即 Rust 函数名）、参数名，以及事件名
- 窗口 label（`main` / `translation` / `clipboard` / `settings`）和 `?window=` 参数值
- 应用标识 `com.tixxin.fuyu`、开机自启注册表值 `Fuyu`（改名前是 `com.focusd.island`、`FocuSD Island`，D17）、凭据管理器条目、应用数据目录下的文件名（如 `agent-status.json`）
- 更新端点和 `latest.json` 格式

确实需要变更时，必须在同一个提交里同步修改前后端，提供旧数据的迁移或兼容读取，并在提交说明中写明。

## 重构约定

适用于所有结构性重构（移动、拆分、改名模块）。Phase 0–6 这一轮已经完成，其记录见 [refactor-plan.md](docs/architecture/history/refactor-plan.md)。

- **搬迁和改写分开提交。** 一个提交要么只移动或拆分代码（零行为变化），要么只修改行为，不能混在一起。
- 搬迁时不顺手改名、改格式、改逻辑；CSS class 名保持不变，避免视觉回归。
- 每个提交都能独立验证，提交信息使用 `refactor(<范围>): ...` 前缀。"分开提交"约束的是一个提交里不能混杂两类改动，不是要求提交越小越好：同一类改动若属于同一个步骤，放在一个提交里。
- 跨多个提交的大型重构，先在 `docs/architecture/` 写分步计划，按计划顺序推进，完成一步后勾选并更新基线数据。
- 重构提交中不升级依赖、不整仓格式化。引入格式化工具的那个专门提交除外。
- 目录或模块结构变化后，同步更新对应 `AGENTS.md` 中的目录地图和 `docs/architecture/overview.md`（迁移对照在 `migration-map.md`）。

## 通用开发约定

- 优先复用现有组件、类型、工具函数和 CSS class；不为小改动引入新的抽象层。
- 前端状态继续用 `localStorage` 持久化，除非需求明确要求迁移到文件、数据库或云同步。
- 新增 Tauri 命令时，同步更新 Rust handler、前端类型化封装和必要的权限配置（细则见子目录规则）。
- 修改窗口大小、定位、透明度、置顶、托盘或注册表逻辑时，要同时考虑折叠态、展开态、贴边收起和托盘隐藏。
- **代码和脚本不写注释**（2026-11-12 起，用户定）。适用于 `src/`、`src-tauri/`、`scripts/`、`tests/`、`packages/` 里的所有源码和脚本（TS/TSX/JS/MJS、CSS、Rust、PowerShell、cmd、HTML、shell）。要解释"为什么"，写进提交说明、`docs/` 或任务文件。例外只有工具要读的指令：`eslint-disable*`、`@ts-expect-error` / `@ts-ignore`、`/// <reference>`、脚本首行的 `#!`、PowerShell 的 `#Requires`、`@vite-ignore` 这类，以及发布给插件开发者的类型声明（`*.d.mts`）里的 JSDoc，它们是编辑器给第三方显示的接口说明。
- 用户可见文案必须支持中英文，并注意窄窗口下按钮、标签和标题不溢出。
- 避免与任务无关的改动和对生成产物的改动。

## 验证

验证范围必须覆盖改动范围。纯搬迁的重构提交同样需要完整验证。

| 改动范围 | 必须运行 |
|---|---|
| 仅文档 | 无需构建，确认 Markdown 可读 |
| 前端逻辑、样式、依赖或脚本 | `pnpm check` + `pnpm build` |
| Rust、Tauri 命令、窗口、托盘、注册表、Windows API、桌面配置 | `cargo test --manifest-path src-tauri/Cargo.toml` + `pnpm build:exe` |
| 发布相关 | 完整的 `pnpm tauri build` |

- 改动岛屿、消息、设置窗口等界面组件或它们的 `api.ts` 类型时，再运行 `pnpm test:regression`；回归页的 mock 落后于代码时页面会失败，要同步更新。其余界面或窗口行为在风险需要时用 `pnpm tauri dev` 手动检查。
- 不得因为构建耗时而跳过必要验证。必要构建失败或受环境阻塞时，必须明确报告原因，不得把未完成的验证描述为已验证。

## 本机更新与桌面快捷方式

- 每次完成应用更新后运行 `pnpm build:exe`，在主工作区的 `src-tauri/target/release/fuyu.exe` 生成最新程序；仅文档改动不需要重新构建。`pnpm release` 发布成功后也会把刚发布的 exe 复制到这里，发布之后不用再跑 `build:exe`。
- **不改桌面快捷方式**（2026-11-13 起，用户定）：用户桌面上的快捷方式指向安装的正式版，`build:exe` 和 `pnpm release` 默认都不碰它。只有用户明确要求时，才设环境变量 `FUYU_SYNC_SHORTCUT=1` 再跑，把名字含 FocuSD / fly-island / Fuyu、或目标是 `fuyu.exe` 的快捷方式指向本次构建（都没有时新建 `浮屿.lnk`），并重新读取确认。
- Mac 上 `pnpm build:exe` 打出 `src-tauri/target/release/bundle/macos/Fuyu.app`，默认不碰 `~/Applications`（那里是安装的正式版）；用户明确要求时设 `FUYU_SYNC_SHORTCUT=1`，先复制成 `~/Applications/Fuyu.app.new` 再换掉旧的 `Fuyu.app`。正在运行的岛屿不受影响，下次启动用新版。

## Git 与协作

- **谁怎么合入 `main`，看 GitHub 权限**。`main` 上有 GitHub 规则集 `main protection`（仓库 Settings → Rules）：必须通过 PR 合入，CI 的 `check` 必须通过，PR 必须基于最新的 `main`（落后时点 "Update branch" 或 rebase，CI 重跑），禁止强推和删除。仓库管理员（TixXin）只能在 PR 上绕过（`bypass_mode: pull_request`，2026-11-13 起，F30 第 8 步）：紧急时可以 `gh pr merge --admin` 不等 CI，但谁都不能直接推、强推或删除 `main`。
  - **仓库管理员和协作者的会话**：在本地 `main` 上提交，攒成一批后 `pnpm mq:land --yes`。land 先把最新的 `origin/main` merge 进来，推到自己的 `land/…` 分支，开 PR 并开启自动合并；CI 的 `check` 通过后由 GitHub 合入，所以要有本仓库的 Write 权限（2026-11-13 起，F30）。
  - **其他协作者（Write 权限，目前是 ShengLin1001）和外部贡献者**：在自己的分支上开发。协作者把分支直接推到本仓库（`TixXin/fuyu`）再提 PR；外部贡献者从本仓库 fork 后提 PR。本仓库 2026-11-10 起已脱离 `flyl1u/fly-island` 的 fork 网络，从上游 fork 出来的仓库不能再向本仓库提 PR。不要从上游同步或合并提交；CI 通过、分支跟上最新 `main` 后再合入。协作者可以自己合，也可以等仓库管理员按下面「外部 PR」的做法合。合入用 merge 或 squash，不改写别人已经推送的分支。
  - 开发期间不要求一直跟着 `origin/main`：开工前、land 前各同步一次（`pnpm mq:sync`）。合入那一刻都基于最新的 `main`，这一点由 land 的 merge 和规则集保证。
- **所有会话都在主工作区、本地 `main` 上工作，攒成一批再经 PR 合入**（2026-11-13 起去掉了 lane，F32）。做法、取舍和排障见 [docs/architecture/workflow.md](docs/architecture/workflow.md)。必须遵守的是这几条：
  - **不开 worktree、不切分支**：用户的 `pnpm tauri dev` 和别的会话都在这份代码上，切分支会冲掉别人正在改的文件。不要 `git stash`、`git reset`、`git checkout -- <文件>` 动别人的改动。
  - **只提交自己的文件**：`git add <具体文件>` 或 `git commit -- <文件>`，不用 `git add -A` / `git add .`。两个会话不同时改一个文件：认领时写 `--scope`，开工前可以 `pnpm tasks conflicts`。
  - **攒着提 PR，不是一个小改动一个 PR**。下面任一条满足时 `pnpm mq:land --yes --body <文件>`，不用问用户：一个任务做完；本地没推的提交有 5 个以上或最早的超过 6 小时（`pnpm mq:pending` 会说）；另一台机器或协作者要用、要发版、或用户说「推一下」。顺手的小修复、文案、文档先攒着。PR 标题用英文，正文用中文写在文件里，一批几样东西时按功能分节（格式见 workflow.md「PR 的标题和正文」）。land 之后在后台 `pnpm mq:wait`，PR 合入才算完成，冲突或检查没过都不算。别人提的 PR 不走 land，按 workflow.md「外部 PR」合入。
  - `main` 只经 land 或在 GitHub 上合入 PR 移动，不手动推送。
  - 代理的 Rust 构建用 `src-tauri/target/agents`，不要用用户 dev 的 `debug`；代理不跑 `pnpm tauri dev`，用户自己跑。
- 修改前先查看 `git status --short`，不要覆盖用户或别的会话已有的改动。
- 不要使用 `git reset --hard`、`git checkout --` 等破坏性命令，除非用户明确要求。
- 工作区里与当前任务无关的修改（多半是别的会话正在改的），保留它们，只提交本次任务相关的文件。
- 每完成一个**可验证的功能单元**（一个用户可感知的功能、一个完整的修复，或计划中的一个步骤），按改动范围执行必要验证，再主动创建 Git 提交，无需再次确认。不要每改一处就提交一次；同一功能单元内的多处改动合在一个提交里。只提交当前任务相关的文件，在最终说明中给出提交号和验证结果。
- 修补自己尚未推送的提交（漏掉的文案、测试、拼写、小 bug）时：`HEAD` 正好是自己刚做的那个提交，就 `git commit --amend -- <文件>`（只带自己的文件）；不是（别的会话在后面提交了），就新开一个小提交，标题写清补的是哪个提交。不要 `git rebase`：本地 `main` 上有别的会话的提交，工作区里还有它们没提交的文件。
- 改写历史只限于自己创建、尚未推送、也尚未合入 `main` 的提交（即本地 `main` 上还没 land 的自己的提交；别的会话的提交不动）。已经合入 `main` 的提交不再改写，有问题就新开修复提交。
  - 唯一的例外是用户明确要求去掉已推送提交里的 Claude 署名行：先通知其他会话；用 `git filter-branch --msg-filter` 按字节过滤（例如 Python 读 `sys.stdin.buffer`，否则 Windows 会把所有提交说明的换行改成 CRLF）；改写后核对每个提交的 tree 不变，用 `git update-ref` 切换；`main` 用 `--force-with-lease=main:<原提交>` 强推一次（要设 `CLAUDE_CODE_MERGE_QUEUE_EMERGENCY_PUSH=1`）。规则集不允许强推，所以要先经用户同意，把 `main protection` 里管理员的绕过方式临时改回 `always`，推完立刻改回 `pull_request`。
- 一个功能阶段（例如插件 API 的一期）通常对应 1–5 个提交，而不是十几个。修复提交只用于已推送内容的问题。
- 提交前尽量让改动范围保持聚焦，并在最终说明中列出已验证的命令。

## 文档

- 源码保持项目当前编码风格；中文文档使用 UTF-8。
- README 包含中英文说明，更新时不要破坏现有的双语结构。
- 界面方向的决定记录在 `docs/design/README.md`（全局方向）和 `docs/design/<区域>.md`（各区域，改哪块只改那一份）；新文档按 [docs/README.md](docs/README.md) 的表放进对应目录（功能说明放 `docs/features/`）；架构变化更新 `docs/architecture/overview.md`，数据存放位置写进 `data-storage.md`，对外契约（localStorage key、事件、命令、文件格式）写进 `contracts.md`。某个功能在 Windows 或 macOS 上的支持情况变了（含新增功能），在同一个提交里改 [docs/architecture/platforms.md](docs/architecture/platforms.md) 的对应行；macOS 适配的进度和决定记在 [macos-port-plan.md](docs/architecture/macos-port-plan.md)。
- **调研**：用户让你联网搜索、搜 GitHub、对比竞品或参考软件并整理时，结果写成 `docs/research/<主题>.md`，不只在对话里回答；格式和规则见 [docs/research/README.md](docs/research/README.md)。
- **任务**的规则、分组、字段和流程都在 [docs/tasks/README.md](docs/tasks/README.md)，开工前读它。查任务用命令，不逐个打开文件：`pnpm tasks next`（能认领的，按优先级）、`pnpm tasks show <编号>`（一项的全文和关系）、`pnpm tasks`（看板）。没结束的任务在 `docs/tasks/<分组>/`，已完成和不做的在 `docs/tasks/0-archive/<分组>/`，分组是编号的首字母。
- **认领看本地和 `origin/main`，不等其他会话回消息**：`pnpm task:claim <编号> --as <会话名> --scope <要改的目录/,文件>`，会话名用 ListAgents 里自己的名字；认领记会话名和机器名，在本地提交、随下一批推上去。任务带 issue 的，认领后、动手前先在 issue 下回复（谁接手、核实结果、打算怎么改；2026-11-14 起，用户定），自己提的 issue 也一样。做完 `pnpm tasks done <编号> --commit "<功能提交的标题>"`，和功能改动放在同一个提交里；land 时会核对已完成任务记下的提交。
- **新建任务也要有 issue**（2026-11-13 起，用户定）：自己发现、自己要记的任务，先 `gh issue create` 给本仓库提一个 issue，再 `pnpm tasks add <编号> --title .. --issue <N>`，之后按 issue 的流程做完回复、关闭。写法见 [docs/tasks/README.md](docs/tasks/README.md)「自己新建的任务」。
- **GitHub issue**：先核实、先回复，再建带 `--issue` 的任务；做完回复（引用任务文档、列出提交）后合入就关。顺序和回复格式见 [docs/tasks/README.md](docs/tasks/README.md)「GitHub issue」。
- **GitHub PR**（别人提的，由我们来合）：和 issue 一样，先检查、先回复看法和检查结果，再合入；要我们补的另建带 `--issue <PR 号>` 的任务；合完回复合并提交号，跟进任务做完再回复一次。顺序见 [docs/tasks/README.md](docs/tasks/README.md)「GitHub PR」。
- **交接写在任务文件里，不靠消息**：停下来、换会话或做到一半时，`pnpm tasks note <编号> "<进度和下一步>"` 并随下一次提交带上。接手的会话先读任务文件的「交接」。
- **会话之间的消息**（ListAgents / SendMessage）只用于告知和协商接口，不用来确认归属。对方正在跑的工具结束前读不到消息，所以构建、`cargo test` 这类长命令放到后台运行，让消息能及时读到；需要等某个会话时用 SendMessage 的 `notify_when_idle` 订阅它空闲，不要反复发消息询问。
