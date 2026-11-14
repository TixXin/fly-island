# 参与贡献 / Contributing

[简体中文](#简体中文) · [English](#english)

## 简体中文

谢谢你愿意改进浮屿。代码怎么组织、有哪些规则，见 [AGENTS.md](AGENTS.md) 和 `src/`、`src-tauri/` 下各自的 `AGENTS.md`；这里只讲怎么把改动合进 `main`。

### 合入 `main` 的唯一途径：PR

`main` 受 GitHub 规则集保护，对所有人（包括仓库所有者）都一样：

- 只能通过 PR 合入，不能直接推送；
- CI 的 `check` 必须通过；
- PR 必须基于最新的 `main`。落后时不用自己处理：开着自动合并的 PR 会由工作流按先后顺序一个个更新。

### 本机准备

- `pnpm install` 会把 `core.hooksPath` 设成 `.githooks`：`pre-push` 拦住直接推 `main`，并检查提交里有没有 AI 署名行和任务文件；`pre-commit` 要求在 `main` 上提交时写清文件（`git commit -- <文件>`，自己的分支不受影响）；`commit-msg` 拒绝 Claude 署名行。已经设成别的路径时只提示不改。
- 仓库的 `.claude/settings.json` 关掉了 Claude Code 默认加的提交署名和 PR 尾注，不用自己配。
- 仓库管理员的代理会话都在主工作区的本地 `main` 上并行工作、攒批开 PR（见 [workflow.md](docs/architecture/workflow.md)）；协作者照常在自己的分支上开发。

### 有本仓库 Write 权限的协作者

1. 从最新的 `main` 开分支，提交。分支名随意，例如 `feat/<主题>`、`fix/<主题>`。
2. 推到本仓库（直接 clone `TixXin/fuyu`，不要 fork；从 fork 提的 PR，自动更新分支的工作流推不进去），开 PR，然后点 **Enable auto-merge**，合并方式选 **Create a merge commit**。
3. CI 通过后 GitHub 自动合入，分支自动删除。CI 失败时在同一个分支上修好再推，PR 自动更新。

仓库管理员的代理会话不用手动做这些：在本地 `main` 上攒一批提交后 `pnpm mq:land --yes` 会推分支、开 PR、开启自动合并，`pnpm mq:wait` 等它合入（见 [workflow.md](docs/architecture/workflow.md)）。

### 外部贡献者

没有 Write 权限时，fork 本仓库，在 fork 的分支上改，再向 `TixXin/fuyu` 的 `main` 提 PR。维护者看过后会回复，通过后开启自动合并。

### 提 PR 前

- 前端改动：`pnpm check` 和 `pnpm build`；改到界面组件再跑 `pnpm test:regression`。
- Rust 改动：`cargo test --manifest-path src-tauri/Cargo.toml`。
- 只改 Markdown 时 CI 只检查任务文件，半分钟左右。
- 一个 PR 做一件事。用户可见的文案要有中英文。代码里不写注释，原因写进提交说明或 `docs/`。
- 提交说明和 PR 描述里不加 AI 署名行（`Co-Authored-By: Claude ...` 之类）。

## English

Thanks for helping with Fuyu. How the code is laid out and the rules it follows are in [AGENTS.md](AGENTS.md) and the `AGENTS.md` files under `src/` and `src-tauri/`; this page only covers getting a change into `main`.

**Pull requests are the only way into `main`**, for everyone including the owner: no direct pushes, CI's `check` must pass, and the PR must be built on the latest `main`. You do not have to keep it current yourself: a workflow brings PRs on auto-merge up to date one at a time, in the order auto-merge was turned on.

- **Collaborators with Write access:** clone `TixXin/fuyu` itself rather than a fork (the workflow that keeps auto-merge PRs current cannot push to a fork's branch), branch from the latest `main`, push to this repository, open a PR and click **Enable auto-merge** (merge commit). GitHub merges it when CI passes and deletes the branch. If CI fails, push a fix to the same branch.
- **The maintainer's agent sessions:** they commit on local `main` and, once a batch is ready, `pnpm mq:land --yes` pushes it to a branch, opens the PR and turns on auto-merge; `pnpm mq:wait` follows it until it is merged (see [workflow.md](docs/architecture/workflow.md)).
- **Everyone else:** fork, work on a branch of your fork and open a PR against `TixXin/fuyu`'s `main`. A maintainer will reply and turn on auto-merge once it is ready.

**Setting up:** `pnpm install` points `core.hooksPath` at `.githooks` (pre-push blocks direct pushes to `main` and checks for AI attribution lines and task files; pre-commit asks for the files to be named when committing on `main`, `git commit -- <files>`, and leaves your own branches alone; commit-msg rejects Claude attribution lines), unless it is already set to another path. The repository's `.claude/settings.json` turns off Claude Code's commit and PR attribution. The maintainer's agent sessions work side by side on local `main` in the main checkout and land in batches (see [workflow.md](docs/architecture/workflow.md)); collaborators keep working on their own branches.

Before opening a PR, run `pnpm check` and `pnpm build` for frontend changes (plus `pnpm test:regression` for UI components) and `cargo test --manifest-path src-tauri/Cargo.toml` for Rust. Keep one change per PR, give user-facing text in both Chinese and English, leave comments out of the code (put the reasons in the commit message or `docs/`), and do not add AI attribution lines to commits or PR descriptions.
