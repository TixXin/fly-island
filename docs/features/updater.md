# 应用内更新

小岛在「设置 → 更新」里检查新版本，发现更新后可以在应用内下载、安装并自动重启。「关于」页只留一张跳到「更新」页的卡片。

- **自动检查**（默认开）：岛屿启动 20 秒后检查一次，之后按「检查频率」（每 1 / 6 / 12 / 24 小时，默认 1；D18 之前默认 6，已保存的值不变）检查，从上次**成功**检查起算；退出期间错过的检查在下次启动 20 秒后补上。检查失败时按 1、5、15 分钟重试，再回到常规频率。只有主窗口调度（`features/updater/useBackgroundUpdateCheck.ts`，下次时间由 `checkSchedule.ts` 算出），离线时暂停，回到在线或窗口获得焦点时重算。发现新版本时，折叠条上出现一个黄色的"↑"角标，展开态右上角的设置按钮也出现小圆点，点任意一个都直接打开「更新」页。跳过的版本两处都不再提示。
- **跳过这个版本**：跳过后岛上不再提醒这个版本，「更新」页仍可手动安装；更新的版本照常提醒。
- 打开「更新」页时也会检查一次；版本卡片下方显示上次成功检查的时间，以及下次检查、重试、离线、暂停（下载安装中）等状态。
- **更新提醒方式**：「仅岛上标记」（默认）或「岛上标记与系统通知」。系统通知是额外的提醒，岛上标记照常显示；同一通道的同一版本只通知一次（记在 `lastNotifiedKey`，切换通道后同一版本会再通知一次）。点通知打开关于页。没有正式安装的程序 Windows 可能不显示通知，这时关于页会说明，岛上标记不受影响。
- **自动更新**（D18）：「只提醒」「自动下载，手动安装」（默认）「自动下载，空闲时安装」。自动下载时主窗口在发现新版本后立刻下载（`updater_download`，下载时校验签名），按流量计费、漫游或超出流量上限的网络不下载，跳过的版本不下载，下载失败的版本这次运行里不再重试、仍可手动安装。下载好的安装包只在内存里，重启岛屿后要重新下载。下载好后关于页显示「已下载」和「立即安装」，点了直接安装，不再等进度条。
- **空闲时安装**：每 30 秒看一次，同时满足才安装：锁屏或 10 分钟没有键鼠操作；岛屿没有展开；没有 Agent 会话在运行或等你（安装会让岛屿重启，审批端口和提醒会中断）；前台没有全屏程序（`windows/island/useIslandAutoUpdate.ts`）。安装器装完会重新打开岛屿。
- **诊断信息**：关于页的链接区先预览、再复制一段白名单文本（应用版本、系统版本与架构、更新通道、自动检查与频率、上次成功检查、更新状态），用于反馈问题；不含路径、账号等信息。
- 以上偏好存在 `fuyu-update-preferences`。
实现基于 Tauri 2 的 `tauri-plugin-updater`，所有更新包都用 minisign 签名，App 内置公钥校验，签名不符的包不会被安装。

## 更新通道

「更新」页的「更新通道」可选**稳定版**或**测试版（beta）**，保存在 `fuyu-update-channel`。没选过时，beta 版本的程序默认测试版（是用户特意装的），其他版本默认稳定版，所以**不主动选测试版的用户永远收不到 beta**：

- **稳定版**读 `plugins.updater.endpoints`，即 `releases/latest/download/latest.json`。GitHub 的 latest 永远不会是 Pre-release，而 beta 版都发成 Pre-release。0.3.0 及更早的客户端没有通道设置，也只读这里。
- **测试版**读同一组镜像下的 `releases/download/beta-channel/latest.json`（由 `src-tauri/src/system/update_channel.rs` 从稳定端点换算），全部取不到时再退回稳定版端点，所以 beta 清单缺失或下载失败时，测试版用户仍能收到正式版。`beta-channel` 是一个固定的 Pre-release，只放这份清单，**不要删除**。
- 每次 `pnpm release`（正式版和 beta 版都算）发布后会刷新 `beta-channel` 上的清单，除非它已经指向更新的版本。所以测试版用户也会收到正式版；从测试版切回稳定版不会降级，要等稳定版追上当前版本才收到更新。

版本号带 `-`（如 `0.3.1-beta.1`）就算 beta：`release.mjs` 会把它发成 Pre-release、不设为 latest，判断与比较在 `scripts/release/channel.mjs`。

## 检查与安装流程

1. 设置页调用 `updater_check`（按通道选端点，`src-tauri/src/system/update_channel.rs`），依次尝试各端点：GitHub 直连、`ghfast.top`、`gh-proxy.com`，第一个能取到清单的胜出。
2. 清单里的 `version` 高于当前版本时，界面显示「发现新版本 vX.Y.Z」。
3. 点「下载并安装」后，安装包下载到本地临时目录，边下边用清单里的 `signature` 校验。
4. Windows 走 NSIS 安装模式 `passive`：显示安装进度条，装完由安装器拉起新版本，旧进程自动退出。

检查与下载的状态由原生进程统一保存（`src-tauri/src/system/update_runtime.rs`），每次变化广播 `updater-state-changed`，岛屿和设置窗口看到的是同一份：设置窗口关掉不会中断检查或下载，两个窗口不会同时检查（后来的那个收到 `updater.busy`，界面不当作错误显示）。安装时带上界面当时显示的版本和通道，候选版本在此期间变了就拒绝（`updater.targetChanged`）。切换到 beta 通道时，只有检查成功才保存新通道。前端 `features/updater/updaterController.ts` 只镜像这份状态，按 `revision` 丢弃迟到的旧快照。

相关代码：

- `src-tauri/tauri.conf.json`：`plugins.updater`（端点、安装模式）
- `src-tauri/capabilities/default.json`：`updater:default` 权限
- `src/features/updater/updaterController.ts`：检查 / 下载 / 安装状态机，跨页面存活
- `src/features/updater/UpdatePanel.tsx`：设置页里的检查更新面板，只负责渲染
- `scripts/release/prepare-release-config.mjs`：构建发布包时写入公钥与签名开关
- `scripts/release/make-latest-json.mjs`：根据构建产物生成 `latest.json`
- `scripts/release/release.mjs`：一键构建 + 签名 + 生成清单 + 上传 Release
- `scripts/release/release-signing.mjs`：优先使用显式环境变量，否则读取本机签名配置并通过 Windows DPAPI 解锁密码

## 网络、代理与镜像

GitHub 的 `github.com` 在国内经常连不上（`api.github.com` 往往还能通），所以检查更新做了两层兜底：

- **多端点**：`tauri.conf.json` 里配了 GitHub 直连和两个公共加速前缀，插件会按顺序尝试，任一成功即返回。面板失败时会显示「原因：…」方便判断是网络问题还是清单缺失。
- **系统代理**：前端启动时调用 `get_updater_proxy`（`src-tauri/src/system/updater.rs`），依次读 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量和 Windows 系统代理（`Internet Settings\ProxyServer`），把结果传给 `check()` / `downloadAndInstall()`。开了 Clash 之类的系统代理时，更新自动走代理。

清单同时提供 `windows-x86_64-nsis` 与 `windows-x86_64-msi`，客户端按当前安装格式选择对应包；通用 `windows-x86_64` 入口保留为 NSIS 回退。

清单里的下载地址由 `scripts/release/make-latest-json.mjs --base-url` 决定：

```powershell
# 默认：直连 GitHub，海外用户最稳
node scripts/release/make-latest-json.mjs

# 国内分发：安装包也走加速前缀（清单里额外的那两个端点会返回同一份清单）
node scripts/release/make-latest-json.mjs --base-url "https://ghfast.top/https://github.com/<owner>/<repo>/releases/download/v0.2.12"
```

公共加速前缀是第三方服务，可用性不由本项目保证；有条件时换成自己的对象存储或 CDN，把地址填进 `--base-url` 即可，代码无需改动。
镜像或自建分发要改清单地址时，也可以用环境变量 `TAURI_UPDATER_ENDPOINTS`（逗号或换行分隔）在构建时整组替换端点。

## 签名密钥

更新包必须用私钥签名，App 用内置的公钥验证。**私钥不进仓库**，归仓库维护者所有。

`tauri.conf.json` 的 `plugins.updater.pubkey` 里直接写着本仓库（TixXin/fuyu）的更新公钥。公钥本身不是秘密，写进仓库后，本地 `pnpm tauri build`、`pnpm tauri dev` 出来的程序也能检查和安装本仓库发布的更新。这个字段在插件配置里是必填项（没有默认值），删掉整个键会让应用在启动阶段报 `missing field \`pubkey\`` 并直接退出；改成空串不会影响启动，面板会显示「这里不能应用内更新」并禁用更新入口。别人 fork 本仓库做自己的发布线时，应把它换成自己的公钥或清空。

发布构建仍通过 `TAURI_UPDATER_PUBKEY` 传入公钥，`prepare-release-config.mjs` 会核对它和 `tauri.conf.json` 里的公钥一致，不一致就中止：用别的私钥签名的更新包，已装的 App 都会拒绝安装。

```powershell
# 只需在第一次启用应用内更新前生成一次
pnpm tauri signer generate -w $env:USERPROFILE\.tauri\fly-island.key
```

生成后同目录会有 `fly-island.key`（私钥）和 `fly-island.key.pub`（公钥）：

- 私钥：自己保管，放在密码管理器或发布机器的 `%USERPROFILE%\.tauri\` 下，不要提交、不要外传。
- 公钥：写进 `tauri.conf.json` 的 `plugins.updater.pubkey`，发布构建时也通过 `TAURI_UPDATER_PUBKEY` 传入并核对。

**私钥一旦丢失，已装上的旧版本就收不到更新**，只能让用户手动重装；换新密钥同样会让旧客户端拒绝新包。所以第一条发布线尽量只生成一次密钥，换机器时把私钥文件拷过去，不要重新生成。

普通 `pnpm tauri build` 带着公钥、能检查更新，但不产出签名包，任何机器都能直接编出来自测；只有发布构建（`pnpm release`）才要求私钥。

### Windows 本机自动读取

已配置的发布机器运行 `pnpm release` 即可，无需每次复制密钥内容或设置环境变量。本机配置路径为 `%USERPROFILE%\.tauri\fuyu\release.json`（这个目录不存在而改名前的 `%USERPROFILE%\.tauri\fly-island\` 存在时读旧目录，两个插件签名私钥也一样），格式如下（路径应为实际绝对路径）：

```json
{
  "schemaVersion": 1,
  "privateKeyPath": "C:\\Users\\<user>\\.tauri\\fuyu\\updater.key",
  "publicKeyPath": "C:\\Users\\<user>\\.tauri\\fuyu\\updater.key.pub",
  "passwordFile": "C:\\Users\\<user>\\.tauri\\fuyu\\password.dpapi"
}
```

私钥本身带密码；`password.dpapi` 是通过 `ConvertFrom-SecureString` 生成的 Windows 当前用户加密密码。密钥目录应只授予维护者账号访问。文件均位于仓库外，不能提交到 Git。可用 `FUYU_SIGNING_CONFIG` 指定其他本机配置路径（改名前的 `FOCUSD_SIGNING_CONFIG` 也认）。把旧目录整个改名成 `fuyu` 时，同时改 `release.json` 里的三个路径；`password.dpapi` 只认 Windows 账户，不认路径，挪过去照样能解开。

更换 Windows 用户或重装系统后，原 DPAPI 密码文件无法解密。恢复时使用受保护备份中的私钥及恢复密码重新创建 DPAPI 密码文件；同一条发布线继续使用原密钥，不重新生成。恢复密码与私钥都属于敏感文件。

显式提供公钥或私钥时，脚本不会混入本机的另一套密钥，CI 仍需完整提供下面三项环境变量。

## 发布一个可自动更新的版本

1. 改版本号并起草发布说明，在主工作区运行：

   ```powershell
   pnpm release:version 0.3.4          # 测试版写 0.3.4-beta.1
   ```

   它一次改好四处版本号（`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，以及 `src-tauri/Cargo.lock` 里岛屿自己那一项），先确认新版本号比已发布的都新。`docs/releases/vX.Y.Z.md` 还不存在时，它会写一份草稿：测试版或正式版固定的开头和下载说明，再加上一条注释，列出上一个版本以来面向用户的 feat / fix / perf 提交。测试版从上一个任意版本算起，正式版从上一个正式版算起，所以正式版的说明会包含它之前的几个测试版。不要再手动改版本号。这样的提交 land 时只跑 `pnpm check`：Rust 那几个文件除了岛屿版本号没有别的变化时，`land-check.mjs` 不跑 `cargo test`。
2. 把草稿改写成面向用户的中英文说明（写法见 [docs/releases/README.md](/docs/releases/README.md)），删掉开头的 `<!-- release-notes-draft -->` 标记和提交列表。标记还在时 `pnpm release` 会拒绝发布。发布说明会成为 `latest.json` 里的 `notes`，同时作为 Release 正文。
3. Windows 发布机器配置一次上述本机凭据即可；其他机器或 CI 设置发布环境变量：

   ```powershell
   $env:TAURI_UPDATER_PUBKEY = Get-Content -Raw $env:USERPROFILE\.tauri\fly-island.key.pub
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $env:USERPROFILE\.tauri\fly-island.key
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   ```

   私钥设了密码时把真实密码填进 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；没设密码也必须显式给空字符串，否则构建会停在 "Decrypting updater signing key" 等交互输入。

4. 一键发布：

   ```powershell
   pnpm release
   ```

   脚本会依次：

   - 校验四处版本号一致、`docs/releases/vX.Y.Z.md` 存在且不是草稿、版本号和发布说明没有未提交改动、当前提交已在 GitHub 上、`gh` 已登录。工作区里别的文件有改动不要紧：安装包不在本机工作区里编（F35）；
   - 触发 `.github/workflows/release-windows.yml` 和 `release-macos.yml`，在 GitHub 的 runner 上按当前提交编 Windows 的 NSIS、MSI 和 Mac 的 dmg（两边同时跑，构建时不碰任何 Secrets 里的 updater 私钥），本机等它们跑完，下载到主工作区的 `src-tauri/target/publish/release`，再用本机的 updater 私钥签出各自的 `.sig`。设计和密钥的取舍见 [release-ci.md](/docs/architecture/release-ci.md)；
   - 加 `--local` 时照旧在本机编 Windows 版：生成 `src-tauri/tauri.release.conf.json`（公钥 + `createUpdaterArtifacts`，该文件已被 git 忽略），`tauri build --config` 出带签名的 NSIS、MSI 安装包与各自 `.sig`，这时要求整个工作区没有未提交改动。GitHub Actions 不可用时用它兜底。不管在哪个 lane 发布，都编译到主工作区的 `src-tauri/target/publish`（D24，`scripts/build-dirs.mjs`），每次都是增量编译，lane 里不再各留一份几 GB 的产物；两个 lane 同时发布时后来的等前一个（`target/publish/.release.lock`）。`pnpm prune:target` 也清理这个目录；
   - 生成 `latest.json`；
   - 生成两种安装包的 `SHA256SUMS.txt`；
   - 创建指向当前提交的 Release 草稿，上传安装包、`.sig`、`latest.json` 与校验文件；
   - 比较 GitHub 上每个文件的 SHA-256 与本地产物；
   - 冒烟测试（D26）：触发 `.github/workflows/release-smoke.yml`，在干净的 Windows runner 上下载草稿里的 NSIS 安装包，静默安装，像新用户一样启动，确认进程活着、有可见窗口，再卸载（`scripts/release/smoke-test.ps1`），`pnpm release` 等它跑完。本机做不了：release 构建和你自己的岛屿用同一个应用标识、数据目录和单实例锁。没通过时 Release 留在草稿，不会公开。约 2–4 分钟，加 `--no-smoke-test` 跳过；
   - 以上都通过才公开并设为最新版本；已存在的版本会被拒绝，避免覆盖用户正在下载的更新包；
   - 把刚发布的 `fuyu.exe` 复制到主工作区的 `src-tauri/target/release`（和 `pnpm build:exe` 一样：正在运行的旧 exe 先改名挪开，等它的构建锁）；不改桌面快捷方式，设了 `FUYU_SYNC_SHORTCUT=1` 才改。本机跑的就是用户拿到的那一份，不用再花几分钟重编；复制失败只打印提示，不影响发布；
   - 刷新 beta 通道的清单；
   - 用 `gh` 读回两个通道的 `latest.json`（直接用 curl 访问下载地址，GitHub 有时返回 504），确认正式版两个通道都是新版本，测试版只有 beta 通道是新版本、稳定通道不是。GitHub 切换 Latest 可能要几秒，读不对时隔 5 秒重试，最多 4 次，还不对就报错并指向下面的「撤回有问题的版本」；
   - 找出这次发布的提交范围里完成的任务（任务文件的 `issue` 字段和「提交」列表），在对应的 GitHub issue 下留言「已随 vX.Y.Z 发布」，附 Release 地址和任务文档。每个 issue 每个版本只留一次（留言里有标记），所以重跑不会重复。不想留言时加 `--no-issue-comments`。

   只出包不上传用 `pnpm release --no-upload`；安装包走镜像分发用 `pnpm release --base-url "https://..."`。

5. 发布后已装「带更新功能」版本的用户点「检查更新」就能收到。更早的版本（v0.2.11 及以前）没有这段逻辑，需要手动下载安装一次。
6. 本机主工作区的 release 程序已由 `pnpm release` 换成新版本，不用再跑 `pnpm build:exe`；输出里提示复制失败时才手动跑一次。两个通道的清单已由 `pnpm release` 核对过，不用再手动检查；需要时也可以手动看：

   ```powershell
   gh release download --repo TixXin/fuyu --pattern latest.json --dir $env:TEMP\stable --clobber
   gh release download beta-channel --repo TixXin/fuyu --pattern latest.json --dir $env:TEMP\beta --clobber
   ```

版本号和发布说明的提交照常 `pnpm mq:land --yes` 到 `main`（D25：只改了四处版本号和 Markdown 时，land 只核对版本号一致并跑任务检查，不跑 `pnpm check`），合入后在主工作区运行 `pnpm release`；别的会话在工作区里有没提交的改动也不用等它们，也不用开临时 worktree。land 推上去之后马上 `pnpm release:prebuild`，两边的 CI 构建和 PR 的检查同时跑；合入后 `pnpm release` 看到合并提交的代码树和预构建一样就直接用（F37，见 [release-ci.md](/docs/architecture/release-ci.md)「提速」）。发布前先 `pnpm mq:sync` 跟上 `origin/main`，并确认本地 `main` 上没有还没合入的提交（`pnpm mq:pending`）：发出去的要和 `main` 一致。

### Mac 版（G1.13）

`pnpm release` 默认同时出 Mac 版（决定 M11、M12）：

- 检查完版本号后，触发 `.github/workflows/release-macos.yml`，在 GitHub 的 macOS runner 上按当前提交编 Apple 芯片的 `.app` 和 dmg（发布提交必须已经在 GitHub 上）；Windows 构建同时进行。
- runner 用 Environment `release` 的 Secrets 里的自签名证书签名（`MACOS_CERTIFICATE`、`MACOS_CERTIFICATE_PASSWORD`、`MACOS_SIGNING_IDENTITY`），并确认应用能启动；没有这三项时退回 ad hoc 签名并给出警告（那样用户每次更新后要重新授权）。证书用 `node scripts/macos/self-signed-cert.mjs` 在 `~/.tauri/fuyu/macos/` 生成一次，`--upload` 写进 Environment `release` 的 Secrets（这个 Environment 只允许 `main` 上的 workflow 读，F35）。**不要重新生成**：换证书后所有 Mac 用户要重新授权一次。证书和密码文件要备份。
- 本机等 runner 跑完，下载 `Fuyu_<版本>_aarch64.app.tar.gz` 和 dmg，用本机的 updater 私钥签出 `.sig`（私钥不上传到 GitHub），`latest.json` 加 `darwin-aarch64` 和 `darwin-aarch64-app` 两个键，和 Windows 的产物一起上传、核对 SHA-256，`SHA256SUMS.txt` 包含 dmg。
- Mac 构建失败时什么都不发布；要先只发 Windows 版，加 `--no-mac`（那样 Mac 用户检查更新会看不到 darwin 条目，之后要补发）。`--no-upload` 时不出 Mac 版。
- 打包时框架靠 `src-tauri/tauri.bundle-macos.conf.json` 加进去，工作流和 `pnpm build:exe` 都带了这个配置。
- 没有苹果开发者账号的公证，用户第一次打开要手动放行，步骤见 [macos-install.md](macos-install.md)。有了账号（G1.12）后在工作流里加上 Developer ID 证书和公证即可，其余不变。

updater 私钥不放进 GitHub Secrets（F35，见 [release-ci.md](/docs/architecture/release-ci.md)）：它泄露就等于能给所有用户推更新。签名始终在持有私钥的维护者电脑上做；`tauri signer sign` 在 Mac 上也能跑，把私钥经密码管理器拷过去、用上面三个环境变量提供，Mac 上也能签（还没实际试过；本机配置里的 DPAPI 密码只在 Windows 上能解开）。

## 撤回有问题的版本

已经装上的版本没法从远处卸载，能做的是让还没更新的人不再收到它，再尽快发一个修好的版本。客户端只会升级、不会降级，所以"退回上一版"对已更新的人无效，修复只能靠更高的版本号。

**测试版（beta）有问题**：把 beta 通道的清单换回上一个好的版本。

```powershell
$repo = "TixXin/fuyu"
# 取上一个好版本 Release 里的 latest.json，覆盖到 beta-channel 上
gh release download v0.3.1-beta.2 --repo $repo --pattern latest.json --dir $env:TEMP\rollback --clobber
gh release upload beta-channel "$env:TEMP\rollback\latest.json" --repo $repo --clobber
```

有问题的那个 Release 可以留着（已经在下载的人不会中途 404），也可以在说明里标注"请勿安装"。之后发下一个 beta（比如 `-beta.4`）修复，`pnpm release` 会再刷新 beta 通道。

**正式版有问题**：把 GitHub 的 Latest 指回上一个好版本，稳定版用户检查更新就会拿到它的清单（版本不比自己新，所以不会再提示）。

```powershell
gh release edit v0.3.0 --repo TixXin/fuyu --latest
gh release edit v0.3.2 --repo TixXin/fuyu --prerelease --latest=false   # 有问题的那个
```

把有问题的版本改成 Pre-release，是为了它不会被 GitHub 重新当成 Latest。修好后照常 `pnpm release` 一个更高的版本，它会重新成为 Latest。

**不要做的事**：不要删除已发布 Release 里的安装包或换成别的文件（正在下载的人会校验失败，签名也对不上）；不要删除 `beta-channel` 这个 Release，它是 beta 通道唯一的清单位置。

## 常见问题

- **构建提示缺少私钥**：只有发布构建需要签名。普通 `pnpm tauri build` 不会产出签名包，也不会要求私钥；要出正式包请走 `pnpm release` 并配好环境变量。
- **面板显示「这里不能应用内更新」**：浏览器预览页，或 `tauri.conf.json` 的公钥被清空的构建。更新入口会显示不可用提示并禁用。
- **点了检查提示失败**：面板会显示「原因：…」。`Could not fetch a valid release JSON from the remote` 表示三个端点都没拿到清单——最常见是这次 Release 没上传 `latest.json`，其次是本机到 GitHub 和镜像都不通；带 `error sending request` 字样的是网络或代理问题。
- **一直显示已是最新版本**：确认 release 里的 `latest.json` 的 `version` 高于客户端版本；同一版本号重发不会触发更新。
- **提示签名校验失败**：`latest.json` 里的 `signature` 必须来自本次安装包的 `.sig` 文件，且签名私钥与构建时注入的公钥配对。
- **发布后短时间内检查不到**：`releases/latest/download/` 走 CDN，通常几分钟内生效。
- **只想手动下载安装包**：直接访问 [GitHub Releases](https://github.com/TixXin/fuyu/releases/latest)；设置中的「查看最新版本」用于应用内检查、下载和安装。
