# 桌面框架调研（网页技术类）：Electron、Wails、Electrobun、NW.js、Deno 等

> 日期：2026-11-14。问题：除了 Tauri、MyGo、GPUI，还有哪些用网页技术的桌面框架（Windows、macOS）能做浮屿的「万物皆插件」架构。范围：Electron、Wails v2 / v3、Neutralinojs、Electrobun、NW.js、Deno 的桌面方案、Socket Runtime、Photino、Sciter、CEF、Saucer、webview/webview、React Native 桌面、Lynx 等的官方文档、仓库和 issue，以及几份第三方内存基准；读了 `cordiverse/cordis` 的加载器源码。**没有实测**。这是 [desktop-frameworks.md](desktop-frameworks.md) 的详细材料之一。

- 调研日期：2026-11-14。版本号、星数、发布日期取自当天的 GitHub API 和各项目官网。
- 目标平台：只看 Windows 和 macOS。
- 不在本文范围：Tauri 2、MyGo、GPUI（已在别处调研）。文中只在对比数字里出现 Tauri。
- 标注约定：`[n]` 对应文末来源；**未核实** 表示没有找到一手来源或只有二手转述；**推断** 表示是我根据已核实事实做的推理，不是来源原话。

## 0. 结论先行

1. **Electron 是唯一一个把这套架构的每一条需求都做成了正式功能、并且有同类产品在生产环境验证过的框架。** Node 主进程和 utility 进程可以直接跑 Cordis；隐藏窗口的定时器节流是一个开关；macOS 有 `panel` 窗口类型；原生能力走 N-API。DeepSeek Harness 官方桌面版就是这么做的（Electron 44，用 `ELECTRON_RUN_AS_NODE` 子进程跑 Cordis 宿主）[18][19]。
2. **换 Electron 不会降低内存。** 在 Windows 上 Electron 和 WebView2 系框架（Tauri、Wails）的空应用内存在同一量级（实测互有高低）[24]；在 macOS 上 Electron 明显比 WKWebView 系重 [24][26]。当前 330 MB 主要来自 WebView2 的多进程，它本身就是 Chromium，换成自带的 Chromium 不会省。
3. **其余框架里没有一个同时满足「窗口外有长驻 JS 运行时」「Windows 10/11 + macOS 都成熟」「原生调用顺手」三条。** Electrobun 和 Deno desktop 方向对，但前者只支持 Windows 11、单人维护，后者官方标注实验性且缺 Windows 自动更新。Wails v3 窗口能力最强（内建 NSPanel 和刘海窗口），但宿主语言是 Go，没有 JS 运行时。
4. 直接出局：Socket Runtime（已废弃）、Neutralinojs、Photino、Sciter、直接用 CEF、Saucer、webview/webview、React Native for Windows + macOS、Lynx / Lynxtron、Vercel Native SDK。理由见第 3 节。

排名见第 4 节，Electron 相对 Tauri 的得失见第 5 节。

## 1. 两条跨框架的共性事实

这两条决定了大部分框架的内存和后台行为，先单独说。

### 1.1 系统 WebView 框架的内存下限就是 WebView2 / WKWebView

Wails、Neutralinojs、Electrobun（默认渲染器）、Photino、Saucer、webview/webview、Deno desktop（默认后端）在 Windows 上全部用 WebView2，在 macOS 上全部用 WKWebView [29][33][37][47][54][61][62]。所以它们在 Windows 上的常驻内存和 Tauri 是同一个来源，换框架不改变这部分。

Elanis 的持续基准（GitHub CI 上跑，空应用，release 构建，最后更新 2026-11）[24]：

| 平台 | 指标 | Electron | Tauri | NW.js | Wails | Neutralino |
|---|---|---|---|---|---|---|
| Windows x64 | 主进程 + 子进程内存之和 | ≈279 MB | ≈312 MB | ≈618 MB | ≈330 MB | ≈502 MB |
| Windows x64 | 启动前后系统空闲内存之差 | ≈110 MB | ≈187 MB | ≈218 MB | ≈193 MB | ≈327 MB |
| macOS arm64 | 主进程 + 子进程内存之和 | ≈370 MB | ≈96 MB | ≈657 MB | ≈101 MB | 无 release 数据 |
| macOS arm64 | 启动前后系统空闲内存之差 | ≈111 MB | ≈76 MB | ≈215 MB | ≈73 MB | 数据异常 |
| Windows x64 | 构建产物体积（未压缩） | ≈373 MB | ≈3 MB | ≈572 MB | ≈11 MB | ≈2 MB |
| macOS arm64 | 构建产物体积（未压缩） | ≈268 MB | ≈5 MB | ≈423 MB | ≈8 MB | ≈2 MB |

读法：作者自己注明这些数字跑在 CI 上、有误差，只适合同平台横向比较 [24]。「进程之和」会重复计算共享内存，所以绝对值偏大。能确定的只有趋势：**Windows 上 Electron 不比 WebView2 系重，macOS 上 Chromium 比 WKWebView 重得多。**

其他实测，口径各不相同：

- macOS，同一个录屏应用四种实现：Deno desktop 98 MB、Tauri 109 MB、Electron 128 MB、Electrobun（捆绑 CEF）208 MB；分发包 Tauri 57 MB、Deno 111 MB、Electron 323 MB、Electrobun 418 MB [25]。
- macOS，各开 6 个窗口：Tauri 约 172 MB，Electron 约 409 MB；`.app` 体积 8.6 MiB 对 244 MiB。作者说明只跑了一次 [26]。
- Windows 11，Dawloom 2026-10 的测试：Tauri 142 MB 对 Electron 149 MB 私有内存，安装包 1.05 MB 对 106.1 MB。**未核实**：只看到二手转述，原文没找到，转述页直接访问返回 410 [27]。

### 1.2 隐藏窗口的定时器节流是引擎行为，各家只是有没有把开关露出来

- **Chromium（Electron、NW.js、CEF）**：Electron 每个窗口有 `webPreferences.backgroundThrottling`，文档原文是 "Whether to throttle animations and timers when the page becomes background"，默认 `true` [6]；另有全局开关 `--disable-renderer-backgrounding`，"Prevents Chromium from lowering the priority of invisible pages' renderer processes" [14]。NW.js 可以在 manifest 的 `chromium-args` 里传 Chromium 命令行参数 [44]。
- **WebView2**：`CoreWebView2Settings` 有 `PreferredBackgroundTimerWakeInterval`、`PreferredIntensiveTimerWakeInterval`、`PreferredOverrideTimerWakeInterval`，用来调后台状态下 `setTimeout` / `setInterval` 的唤醒间隔 [72]。框架有没有把它暴露出来要逐个看：Wails v3 的窗口选项里没有相关字段（源码里搜不到）[29]，Electrobun、Deno desktop、Neutralino、Photino 的文档里也没有 [38][48][33][55]。
- **WKWebView**：macOS 14 起有 `WKPreferences.inactiveSchedulingPolicy`（`suspend` / `throttle` / `none`）；WebKit bug 270609 记录过设成 `none` 或 `throttle` 后进程仍可能被挂起，2024-03 修复，具体随哪个系统版本发布**未核实** [73]。

**对本项目的含义**：只要插件宿主放在隐藏的 webview 里，就要逐平台处理节流和挂起。把宿主放在窗口之外的 JS 运行时里（Electron 的 Node、Electrobun 的 Bun、Deno desktop 的 Deno）才是从结构上绕开这个问题。

### 1.3 Cordis 对运行时的真实要求

直接读 `cordiverse/cordis` 源码（v4.0.0-rc.13，2026-11-12，MIT，9.9k 星，README 写明 "under active development. The API is not yet stable"）[21]。它的概念（上下文是服务的容器、用 `inject` 声明依赖、注册是可撤销的副作用）见 [22]。运行时要求如下：

- **核心包 `cordis`**：依赖只有 `cosmokit` 和 `@standard-schema/spec`，`packages/core/src` 里没有 `node:` 导入。能在任何 JS 引擎里跑，包括 webview [21]。
- **`@cordisjs/loader`**：`packages/loader/src/internal.ts` 通过 `process.execArgv` 里的 `--expose-internals` 或原生插件 `node-addon-require-builtin` 去拿 Node 的内部模块 `internal/modules/esm/loader` [21][23]。这是 **Node 私有实现**。
- **`@cordisjs/hmr`**：导入 `node:async_hooks`、`node:fs`、`node:path`、`node:url`，并依赖同一套内部加载器 [21]。

由此得出：

- 在真正的 Node 里（包括 Electron 内嵌的 Node）loader 和 HMR 可以用，但 Electron 里有坑。DeepSeek Harness 官方记录：原生访问器 "cannot locate the required symbol in Electron 44"，所以他们给宿主进程显式加 `--expose-internals`，并保留 RunAsNode fuse [18]。社区包 `dsh-plugin-desktop` 走另一条路：Cordis 跑在 Electron 主进程里，因为 "packaged Electron doesn't expose Node's internal ESM loader"，自己写了一个窄的 resolve hook [20]。
- 在 Bun（Electrobun）和 Deno（Deno desktop）里，核心能跑，**但 loader / HMR 依赖的 Node 内部加载器不存在**，要自己重写这两个插件。**推断**：依据是上面的源码，没有实际跑过。
- 在 Go / C# / C++ 宿主的框架里（Wails、Photino、Saucer、webview、Neutralino、Sciter、CEF），窗口外没有 JS 运行时，Cordis 只能放进隐藏 webview，或另外带一个 Node / Bun 边车进程。

## 2. 逐个框架

### 2.1 Electron

**1. 现状。** v45.3.2，2026-11-12 发布，Chromium 156.0.8078.100，Node 24.22.2；v46 在 alpha [1][2]。每 8 周一个大版本，只支持最新 3 个大版本 [3]。MIT，123.9k 星 [1]。生产验证：VS Code、Cursor、Slack、Discord、Notion、Figma、1Password、Obsidian、Docker Desktop、Claude Desktop、ChatGPT for Windows 都在用；Teams 和 WhatsApp 已迁到 WebView2 [17]。

**2. 插件宿主放哪。** 三个位置，都是真 Node：

- 主进程："The main process runs in a Node.js environment" [7]。
- `utilityProcess`："creates a child process with Node.js and Message ports enabled"，由 Chromium 的 Services API 拉起，支持 `execArgv`、`serviceName`，可以和渲染进程直接建 MessagePort 通道 [5][7]。
- `ELECTRON_RUN_AS_NODE=1` 的子进程：DeepSeek Harness 官方桌面版的做法，复用 Electron 可执行文件当 Node，不另带一份 Node [18]。

Cordis 可以直接跑，loader / HMR 的坑见 1.3。`utilityProcess` 加 `--expose-internals` 是否生效**未核实**；RunAsNode 子进程这条路有 DeepSeek 的记录为证 [18]。

**3. 运行时加载第三方 JS、共享 React、热重载。** 宿主侧就是 Node 的 `import()`，npm 包和原生插件都能用。界面侧和任何 web 引擎一样：渲染进程里动态 `import()` 插件的客户端产物，React 通过 import map 或全局外部依赖共享，这部分不是 Electron 独有的优势。Electron 独有的一点：同站点的 `window.open` 子窗口和父窗口在同一个渲染进程，"enabling the parent to access the child window directly"，主进程用 `setWindowOpenHandler` 的 `overrideBrowserWindowOptions` 决定子窗口的原生选项 [9]。这意味着多个小窗口可以共用一个渲染进程和一个 React 实例。**推断**：用 React portal 渲染到子窗口文档是社区常见做法，官方文档没提 `createPortal` [9]。DeepSeek Harness 的做法更保守：界面不走 Electron IPC，宿主在回环地址上提供 HTTP + WebSocket，插件发布一个 `./client` 产物 [19][20]。

**4. 悬浮岛窗口能力** [4]：

- 透明：`transparent`；无边框：`frame: false`。
- 置顶：`setAlwaysOnTop(flag, level, relativeLevel)`，level 有 `floating`、`status`、`pop-up-menu`、`screen-saver` 等。
- 盖在全屏应用上：macOS `type: 'panel'`（文档说明该类型可浮在全屏应用之上并出现在所有 Space）；`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`。Apple 开发者论坛的结论是这类窗口需要非激活面板加 `screenSaver` 层级 [74]。
- 不抢焦点：`focusable: false`（Windows 上同时隐含 `skipTaskbar`）、`showInactive()`。
- 点击穿透：`setIgnoreMouseEvents(true, { forward: true })`，forward 让 `mouseleave` 之类事件仍能收到；`setShape(rects)` 可以定输入区域，但只支持 Windows / Linux 且标为实验性。
- 不进任务栏：`skipTaskbar`；不进 Mission Control：`hiddenInMissionControl`。
- 多窗口、托盘：都是基础能力。
- 刘海区域定位：没有内建 API，要自己按屏幕尺寸算坐标并配合窗口层级。**未核实**是否有现成且在维护的方案。

**5. 后台行为。** 见 1.2。宿主在 Node 进程里，不受渲染器节流影响；隐藏窗口单独设 `backgroundThrottling: false` [6]。

**6. IPC。** `ipcMain` / `ipcRenderer`（结构化克隆）加 MessagePort。MessagePort 可以让两个渲染进程、或渲染进程和 utility 进程直连，不经主进程中转 [7][8]。DeepSeek 在设计记录里提到他们最初用带帧的字节管道，理由是避免 Base64 膨胀和跨版本的 V8 序列化问题，后来为了复用 Web 实现改回 HTTP [19]。没有查到框架级的已知泄漏，**未核实**。

**7. 原生 API。** Node-API 原生插件，官方有 C++（Windows）、Swift（macOS）、Objective-C（macOS）教程，必须按 Electron 版本构建 [11]。DeepSeek 的打包验证里用到了 Koffi（FFI）、Sharp、node-pty 的预编译 N-API 二进制 [18][20]。**推断**：现有的 Rust 平台层（`windows` crate、AppKit 绑定）可以用 napi-rs 包成 `.node` 插件复用，不必重写成 C++；AppKit 的界面调用必须在主进程的主线程上，不能放 utility 进程。这条没有查来源验证。

**8. 内存和体积。** 见 1.1。Windows 安装包的二手数字在 85–106 MB [27]，未压缩产物 270–370 MB [24]。

**9. 打包、签名、更新。** 内建 `autoUpdater`：macOS 基于 Squirrel.Mac，"Your application must be signed for automatic updates on macOS"；Windows 按打包方式自动选 MSIX 更新器或 Squirrel.Windows；Linux 不支持 [12]。官方还提供 update.electronjs.org 和静态存储两种无服务器方案 [13]。Deno 文档的对比表把 Electron 列为可交叉编译（经 electron-builder）[49]。

**10. 安全。** 默认 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` [6]。官方清单 20 条，核心是「不要让远程内容拿到 Node」「验证每条 IPC 的发送方」「检查 fuses」[10]。对全信任插件：宿主侧插件拿到的就是用户权限，这和 VS Code、Obsidian 一样。Obsidian 官方明说 "cannot reliably restrict plugins to specific permissions or access levels"，靠默认开启的受限模式和上架扫描兜底 [16]。VS Code 把扩展放进独立的扩展宿主进程，目的是不让扩展拖慢或改动界面 [15]。DeepSeek 的记录里也写明 "The signed core runtime does not attest to user-installed plugin code" [19]。

### 2.2 Wails（v2 和 v3）

**1. 现状。** v3 已经不是 alpha / beta：**v3.0.0 于 2026-10-26 正式发布**，距 2023-01 第一个 alpha 近四年；v3.1.0 于 2026-11-01 发布，同日还有 v2.17.1 [28]。README 把 v2 和 v3 都列为 Stable [32]。MIT，37.1k 星。需要 Go 1.26+ [28]。知名生产应用**未核实**。

**2. 插件宿主。** 后端是 Go，窗口外没有 JS 运行时 [32]。Cordis 只能放 webview，或自带 Node / Bun 边车。

**3. 加载 JS、热重载。** `wails3 dev` 提供前端热重载和 Go 重建 [28]。运行时加载第三方 JS 只能在 webview 里做。

**4. 窗口能力，是本次调研里最完整的** [29][30][28]：

- `AlwaysOnTop`、`Frameless`、`BackgroundTypeTransparent` / `Translucent`、`IgnoreMouseEvents`（Windows + Mac）、`HiddenOnTaskbar`、Windows 的 `ExStyle`。
- macOS：`MacWindowLevel`（`floating` 到 `screenSaver`）、`MacWindowCollectionBehavior`（含 `CanJoinAllSpaces`、`FullScreenAuxiliary`）。
- **内建 NSPanel**：`MacWindowClassPanel` 加 `MacPanelPreferences{ FloatingPanel, BecomesKeyOnlyIfNeeded, NonActivating }`，`NonActivating` 对应 `NSWindowStyleMaskNonactivatingPanel`。
- **内建刘海窗口**：`NewNotchWindow(NotchWindowOptions)`，贴在摄像头开孔处，带滑入滑出动画，可以指定屏幕。
- 多窗口、托盘（可把窗口挂到托盘图标）都是 v3 的正式功能。

**5. 后台行为。** 没有节流相关选项 [29]，行为取决于 WebView2 / WKWebView，见 1.2。

**6. IPC。** Go 服务的导出方法生成 TS 绑定，另有事件系统、流式传输和自定义传输 [28]。2026-10-18 一次性公布了 9 条安全公告，其中多条是 IPC 来源校验问题（开发服务器 WebSocket 接受任意来源、`BindingsAllowedOrigins` 可被后缀匹配绕过、macOS 子框架能进入控制通道）；v3.0.0 说明里写除一条外都已修复 [31][28]。

**7. 原生 API。** Go 加 cgo / purego。Wails 自己的 macOS 层就是这么写的 [29]。WinRT / COM 在 Go 里要靠第三方绑定，**未核实**其完整度；现有 Rust 平台层要全部重写。

**8. 内存和体积。** Windows ≈330 MB / ≈193 MB，macOS ≈101 MB / ≈73 MB，产物 8–11 MB [24]。

**9. 打包。** NSIS、MSIX、DMG，签名，内建更新器（可插拔来源含 GitHub Releases、校验、原子替换加回滚），支持交叉编译 [28]。

**10. 安全。** 每窗口有摄像头、麦克风等权限表 [28]；没有「不可信页面」分级的说明，**未核实**。

**小结**：如果不需要窗口外的 JS 宿主，Wails v3 的窗口层比 Electron 还贴合悬浮岛。但它解决不了本项目最核心的那条需求，而且要把 Rust 换成 Go。

### 2.3 Electrobun

**1. 现状。** v2.0.6（2026-11-04），之后 10 天里 2.0.7 已经发到 beta.21 [37]。v1 在 2026-02 发布 [42][75]。MIT，13.1k 星。由 Blackboard 公司（Yoav Givati）开发，不是 Bun 官方项目 [41]；有评测文章误写成 "the team behind the Bun runtime" [25]。README 原话："Issues and PRs can be used to share ideas, but there should be no expectation that I will review, respond to, or merge them" [37]。已知应用是 Blackboard 自己的 Dash 和四十多个社区小工具 [37][41]。

**2. 插件宿主。** 主进程可以是 Bun（文档有的地方说默认，有的地方说默认是自研的 JavaScriptCore 运行时 Cottontail，自相矛盾）[39][40]，也可以是 Zig / Rust / Go / Odin 编译产物。"Cottontail and Bun run your application JavaScript on a worker while Electrobun Core owns the main-thread event loop" [39]。Cordis 核心能跑；loader / HMR 不行，见 1.3。

**3. 加载 JS。** Bun 的 `import()`；界面侧同其他 web 引擎。

**4. 窗口能力** [38]：`transparent`、`passthrough`（"Pass pointer input through transparent regions"）、`titleBarStyle: 'hidden'`、`hidden`、`activate: false` 加 `showInactive()`、`setAlwaysOnTop()`、`setVisibleOnAllWorkspaces()`、托盘。文档里**没有**：窗口层级、NSPanel、`skipTaskbar`。**平台支持是硬伤：官方只支持 Windows 11+ 和 macOS 14+** [37]。

**5. 后台行为。** 宿主在 Bun 里不受影响。webview 的节流没有文档 [38]，**未核实**。

**6. IPC。** 类型化 RPC 加事件桥，"page JavaScript never holds privileged APIs directly"；传输方式文档页没写 [39]，**未核实**。

**7. 原生 API。** Bun 主进程用 `bun:ffi`（框架自己的源码就大量使用 `dlopen`）[37]。WinRT / COM 和 AppKit 经 C ABI 的 FFI 调用很费劲。v2 允许主进程直接用 Rust 写，那样就没有 JS 宿主了 [40]。

**8. 内存和体积。** 官方称 hello world "about a megabyte"、差分更新 "as small as 4 KB" [41]；Deno 文档给的对比数字是约 61 MB [49]；v2 变更记录里解压后的可执行文件是 Cottontail 约 55–58 MB、Bun 约 63–118 MB [40]。内存没有官方数字；捆绑 CEF 的实测是 208 MB（macOS）[25]。

**9. 打包。** 自解压包（zstd）、bsdiff 差分更新、静态对象存储即可、带回滚 [37][39]。Deno 文档的对比表写它不能交叉编译 [49]。签名流程文档没有展开，**未核实**。

**10. 安全。** `sandbox: true` 可以对不可信内容关掉 RPC [38]。

### 2.4 NW.js

**1. 现状。** v0.120.0（2026-11-12，Chromium 157）；v0.119.2 带 Node 26.12.1 [43]。紧跟 Chromium，大约每月两到三个版本。MIT，41.1k 星 [24]。知名应用**未核实**。

**2. 插件宿主。** Node 和 DOM 在同一个进程。启动时有一个不可见的后台页；默认的分离上下文模式下 "all Node modules share one Node context"，`node-main` 在第一个窗口加载前于 Node 上下文执行 [44][45]。这是所有框架里「宿主 + 界面」距离最近的模型，Cordis（含真 Node 的 loader）理论上可以直接跑，是否受 Node 内部加载器差异影响**未核实**。

**3. 加载 JS。** 页面里直接 `require()`，浏览器上下文拿到的是 Node 对象的副本；混合上下文模式下两边 API 互通 [45]。

**4. 窗口能力** [44]：manifest 的 `transparent`、`frame: false`、`always_on_top`、`visible_on_all_workspaces`（Mac / Linux）、`show_in_taskbar`、`show: false`。没有 NSPanel、窗口层级、点击穿透的文档，**未核实**。

**5. 后台行为。** 通过 `chromium-args` 传 Chromium 开关 [44]；后台页常驻。

**6. IPC。** 基本不需要，同进程直接调用。

**7. 原生 API。** Node 原生插件，需要按 NW.js 的头文件重建，**未核实**当前工具链状态。

**8. 内存和体积。** 本次数据里最重：Windows ≈618 MB / ≈218 MB，产物 ≈572 MB [24]。

**9. 打包。** 自动更新是社区方案 [24]。

**10. 安全。** 没有隔离层，页面即 Node。对全信任模型不构成额外问题，但也没有任何可以收紧的余地。

**小结**：技术上能做，但在每一个维度上都被 Electron 压过（生态、工具链、窗口 API、内存）。

### 2.5 Deno 的桌面方案

**1. 现状。** 官方的 `deno desktop` 随 **Deno 2.9.0（2026-06-25）** 推出，发布文章原话是 "experimental in 2.9"、"some platform features are still landing" [52]。当前 Deno v2.9.8（2026-10-21）[52]。MIT，108.9k 星，Deno Land 公司。老的社区绑定 `webview/webview_deno` 最后一次提交在 2025-02，可以视为停滞。

**2. 插件宿主。** Deno 运行时和界面在同一个应用里，"Backend and UI communication goes through in-process channels, not socket-based IPC"；进程模型是 CEF 后端多线程、WebView 后端进程组 [46][49]。Deno 有完整的 Node 兼容层 [49]，Cordis 核心能跑；loader / HMR 见 1.3。

**3. 加载 JS、热重载。** `--hmr` 支持框架和非框架应用 [46]。

**4. 窗口能力** [48]：`Deno.BrowserWindow` 有 `alwaysOnTop`、`frameless`、`noActivate`（"a non-activating panel that doesn't steal focus"）、`transparentTitlebar`、多窗口、托盘和 `Tray.attachPanel`。**文档里没有**：透明窗口、点击穿透、`skipTaskbar`、窗口层级。

**5. 后台行为。** "the process keeps running until all windows are closed" [48]。一篇评测报告了隐藏窗口后运行时直接退出、只能把窗口挪到屏幕外的问题 [25]。这对「窗口隐藏时宿主长驻」是直接冲突。

**6. IPC。** 进程内通道，值仍然 JSON 编码；页面里用 `bindings.<name>()` 调 Deno [46][49]。

**7. 原生 API。** Deno FFI，**未核实**其对 COM / WinRT 的可用程度。官方承认还没有原生剪贴板和安全存储 API [49]。

**8. 内存和体积。** WebView 后端约 40 MB，`--compress` 后 hello world 从约 66 MB 降到 19 MB；CEF 后端约 150 MB [49][50][47]。macOS 实测内存 98 MB [25]。

**9. 打包。** 可以一台机器交叉编译全部目标 [46]。缺口都在 Windows：**自动更新 "Windows is not yet supported"**；Windows 签名要自己用 `signtool`；macOS 公证是单独一步 [49][50]。

**10. 安全。** 权限在构建时编进二进制，没有运行时权限提示 [51][49]。

### 2.6 Neutralinojs

v6.10.0（2026-10-06），约两个月一个版本，8.7k 星，MIT [36][24]。窗口外没有 JS 运行时；后端逻辑靠「扩展」，"an extension is just a separate process"，通过 WebSocket 和主程序通信，退出时框架不负责杀掉扩展 [34]。`window.create` 的文档原话是 "Neutralinojs spawns a new process for each native window"，窗口之间只能通过存储 API 通信 [35]。有 `alwaysOnTop`、`borderless`、`transparent`、`skipTaskbar`、`hidden`，没有点击穿透 [33][35]。模块生态一栏是「不支持」[24]。Windows 内存 ≈502 MB / ≈327 MB，比 Electron 还高 [24]。**出局**：每窗口一个进程，和「一个宿主、多个窗口共享插件注入」的模型相反。

### 2.7 Socket Runtime

仓库已从 `socketsupply/socket` 迁到 `heapwolf/socket`，README 全文只有一句 "This Project has been deprecated."，最后提交 2025-07-20，最后一个正式版 v0.5.4 在 2023-12 [53]。**出局**。

### 2.8 Photino（.NET）

Photino.NET v4.0.16（2025-01-23），仓库 2026-03 仍有提交；由 CODE Magazine 维护，2026-03-26 公告转向 AI 辅助维护；Apache-2.0，1.4k 星 [54][55]。宿主是 .NET，引擎是 WebView2 / WKWebView [54]。有 `SetChromeless`、`SetTransparent` [55]；置顶、多窗口、托盘的 API 名称**未核实**。C# 调 WinRT 很顺，但 macOS 的 AppKit 调用、JS 宿主、更新和签名都要自己补。**出局**：没有 JS 运行时，社区太小，发布节奏慢。

### 2.9 Sciter

6.0.5.5（2026-10-30），大约十天一个版本 [58]。自研的 HTML / CSS / 脚本引擎，单个 DLL "5+ Mb"，不是 Chromium 也不是 WebKit [56]。客户有 Norton、Avast、ESET、Bitdefender、TeamViewer 等 [56]。免费版只能用官方二进制，静态链接和源码要付费，从 310 美元到企业询价；该价格页最后更新于 2022 年 [57]。**出局**：不是标准 DOM，React DOM 和第三方 React 组件库不能直接用（**未核实**当前兼容程度，官网未说明支持）；闭源；单人主导。

### 2.10 直接用 CEF

BSD，Marshall Greenblatt 2008 年创建，构建产物由 Spotify 的 CDN 分发 [59]。当前分支：8127（Chromium 158，beta）、8078（Chromium 156）、7871（Chromium 150，LTS）；大约每 4 周一个新分支 [60]。只有 C / C++ 接口，其他语言靠外部绑定 [59]。CEF 里 JS 只存在于渲染进程，窗口外没有 JS 运行时。**出局**：等于自己重写 Electron 的外壳、Node 集成、打包和更新。想要「可选捆绑 Chromium」的话，Electrobun 的 `bundleCEF` 和 Deno desktop 的 `--backend cef` 已经把它包好了 [37][47]。

### 2.11 Saucer（C++）

v8.0.0（2025-12-28），仓库 2026-09 仍有提交；MIT，968 星 [61]。Win32 + WebView2、Cocoa + WKWebView，也可选 Qt WebEngine；有 `set_always_on_top`、`set_click_through`、`set_decorations`、透明背景；可以把 C++ 函数暴露给 JS；绑定都是社区维护（Java、PHP、Rust）[61]。**出局**：它是库不是框架，JS 宿主、多窗口管理、托盘、更新、签名全部自己写。

### 2.12 webview/webview

最新标签 0.12.0，仓库 2026-10 仍有提交；MIT，14.3k 星 [62]。一个头文件级的 C / C++ 库，只提供建窗口、导航、双向 JS 绑定 [62]。透明、无边框、置顶都要自己拿原生句柄做。**出局**，理由同 Saucer，而且功能更少。

### 2.13 React Native for Windows + macOS

RNW 0.85.0（2026-10-20），RN macOS 0.83.0（2026-09-30），macOS 侧落后两个小版本 [64][65]。微软维护。新架构（Fabric）从 0.80 起是新项目默认，基于 Windows App SDK 的 Composition 层；React Native 从 0.82 起弃用旧架构 [63]。官方承认 "not yet at 100% feature parity"，新架构不支持 C#，原生模块要用 C++ [63]。Office 用它做部分新界面 [69]；Meta 的 Messenger 桌面版已在 2026-04 下线 [66]。多窗口、透明窗口、置顶在官方文档里查不到，**未核实**。**出局**：界面不是 DOM，现有 React DOM 代码和第三方 web 组件全部不能用；插件注入的也只能是 RN 组件。

### 2.14 Lynx 和 Lynxtron

Lynx 4.2.0（2026-10-27），Apache-2.0，15.3k 星，字节跳动 [67]。3.7（2026-04-16）起官方支持 macOS 和 Windows，用自研渲染引擎，桌面端元素属性覆盖 179 / 246 [67]。Lynxtron 是 "Electron with the Chromium rendering layer replaced by Lynx"：Node 主线程、单进程、Electron 风格的 `app` / `Tray` / `Menu` API，打包工具基于 electron-builder [68]。文档目前挂在 `/next/` 下，3.8 的文档仍称它为 upcoming，正式发布状态**未核实** [68]。**出局**：界面要用 ReactLynx 重写，元素是 `<view>` / `<text>` 不是 HTML；太新。值得一年后再看，因为它是唯一一个「Node 宿主 + 非 Chromium 渲染」的方案。

### 2.15 2026 年的其他新面孔

- **Vercel Labs Native SDK**（`vercel-labs/native`，2026-05 建仓，v0.11.1，Apache-2.0，7.8k 星）：TypeScript 的受检子集加自有标记语言编译成原生可执行文件，README 自称 experimental [70]。应用逻辑是编译进去的，没有运行时加载第三方 JS 的位置。**出局**。
- **MōBrowser**（TeamDev）：TypeScript + Node + Chromium 的商业框架，"Free for non-commercial use"，有商业支持 [71]。闭源商业产品，没有理由优先于 Electron。
- Hacker News 2026 年高分帖里，桌面框架只有 Electrobun v1（2026-02-19，171 分）一条 [75]。

## 3. 对比表

列对应题目里的 10 个问题。「同 WebView2」指内存和节流行为由系统 WebView 决定，见第 1 节。

| 框架 | 1 版本 / 成熟度 | 2 窗口外的 JS 宿主 | 3 运行时加载 JS | 4 悬浮岛窗口 | 5 隐藏时节流 | 6 IPC | 7 原生 API | 8 内存 / 体积 | 9 打包更新 | 10 安全模型 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Electron** | v45.3.2，8 周一大版；VS Code 等 | **有**：Node 主进程、utility 进程、RunAsNode | Node `import()`；同站子窗口共用渲染进程 | 全：panel、层级、穿透、不抢焦点；刘海无内建 | `backgroundThrottling: false` | ipc + MessagePort 直连 | N-API | Win 与 WebView2 同级，mac 更重；安装包约 85–106 MB | 内建更新、MSIX、签名成熟 | 沙箱 + 上下文隔离，fuses |
| **Wails v3** | v3.1.0，2026-10 刚转正 | 无（Go） | 仅 webview 内 | **最全**：内建 NSPanel 和刘海窗口 | 同 WebView2，无开关 | 生成 TS 绑定；2026-10 修了 9 条公告 | Go + cgo | Win ≈330 MB；8–11 MB | 内建更新、NSIS / MSIX / DMG | 每窗口权限表 |
| **Electrobun** | v2.0.6，单人维护，日更 beta | **有**：Bun（或 Cottontail） | Bun `import()` | 透明、穿透、不激活；无层级 / panel；**仅 Win 11+** | 宿主不受影响；webview 未核实 | 类型化 RPC | `bun:ffi` | 约 55–118 MB 解压；内存无官方数 | bsdiff 更新；不能交叉编译 | 可对页面关 RPC |
| **NW.js** | v0.120.0，紧跟 Chromium | **有**：Node 与 DOM 同进程 | 页面里 `require()` | 透明、无边框、置顶；无 panel / 穿透文档 | Chromium 开关 | 不需要 | Node 原生插件 | **最重**：Win ≈618 MB | 更新靠社区 | 无隔离 |
| **Deno desktop** | Deno 2.9，**实验性** | **有**：Deno，进程内通道 | Deno `import()`，`--hmr` | 置顶、无边框、noActivate；**无透明 / 穿透文档** | 有隐藏即退出的报告 | 进程内，JSON 编码 | Deno FFI | 19–66 MB（WebView），约 150 MB（CEF） | **Windows 无自动更新、无签名集成** | 构建时权限 |
| Neutralino | v6.10.0 | 无；扩展是独立进程 | 仅 webview 内 | 基本项有；无穿透；**每窗口一个进程** | 同 WebView2 | WebSocket | 自带扩展进程 | Win ≈502 MB；2 MB | 只更新资源包 | token + 白名单 |
| Socket Runtime | **已废弃** | — | — | — | — | — | — | — | — | — |
| Photino | v4.0.16（2025-01） | 无（.NET） | 仅 webview 内 | 无边框、透明 | 同 WebView2 | 消息传递 | C#（WinRT 顺，AppKit 弱） | 未核实 | 自己做 | 未核实 |
| Sciter | 6.0.5.5，闭源 | 引擎内脚本，非 Node | 非标准 DOM | 未核实 | 不适用 | 原生绑定 | C / C++ | 引擎 5 MB+ | 自己做 | 未核实 |
| CEF 直接用 | 分支 8127 / 8078 | 无 | 仅渲染进程 | 全靠自己写 | Chromium 开关 | 自己写 | C++ | 同 Chromium；约 150 MB+ | 自己做 | Chromium 沙箱 |
| Saucer | v8.0.0 | 无（C++） | 仅 webview 内 | 置顶、穿透、无装饰 | 同 WebView2 | 暴露 C++ 函数 | C++ | 最小约 250 KB + 系统 WebView | 自己做 | 自己做 |
| webview/webview | 0.12.0 | 无（C / C++） | 仅 webview 内 | 无，拿句柄自己做 | 同 WebView2 | 双向绑定 | C / C++ | 极小 + 系统 WebView | 自己做 | 自己做 |
| RN Windows + macOS | 0.85 / 0.83 | Hermes，非 Node | 可加载 bundle，但不是 DOM | 未核实 | 不适用 | 原生模块 | C++ / ObjC | 未核实 | 各平台原生 | 原生应用模型 |
| Lynx / Lynxtron | 4.2.0；Lynxtron 未正式发布 | Node 主线程 | Node；界面非 DOM | 未核实 | 不适用 | bridge | Node 原生模块 | 未核实 | 基于 electron-builder | 未核实 |
| Vercel Native SDK | v0.11.1，实验性 | 无（编译型） | **不能** | 未核实 | 不适用 | — | Zig | 未核实 | 未核实 | 未核实 |

## 4. 针对本项目的排名

评分只看这六条硬需求：窗口外长驻的 JS 宿主；Cordis 连同 loader / HMR 能跑；透明无边框置顶且不抢焦点的岛加六个小窗口；Windows 10/11 和 macOS 都是正式支持；WinRT / COM / AppKit 调用可行；签名和自动更新成熟。

**第 1：Electron。** 六条全部满足，并且有同构产品可以抄作业（DeepSeek Harness：Electron + Cordis + 第三方插件 + 独立宿主进程）[18][19]。代价是安装包大约多 80–100 MB、macOS 上内存更高、每 8 周跟一次大版本，以及重写整个 Tauri 命令层。

**第 2：Electrobun（观望，不采用）。** 架构最接近「轻量版 Electron」：窗口外有 Bun，默认用系统 WebView，可选捆绑 CEF。不采用的原因有四个：只支持 Windows 11+ [37]；维护者明说不保证看 issue 和 PR [37]；v2.0.6 之后十天 2.0.7 就发到了 beta.21，接口还在快速变化 [37]；Cordis 的 loader / HMR 在 Bun 上要重写（推断，见 1.3）。

**第 3：Deno desktop（观望，不采用）。** 进程内通道、可选 CEF、单机交叉编译、Node 兼容，设计上很对路。但官方标实验性 [52]，Windows 没有自动更新和签名集成 [49][50]，透明窗口和点击穿透没有文档 [48]，还有隐藏窗口导致退出的报告 [25]。现在用它做常驻悬浮岛风险太高。

**第 4：NW.js。** 能做，Node 和 DOM 同进程的模型甚至比 Electron 更省事。但内存最高 [24]、生态和工具链明显弱于 Electron、没有 panel 之类的窗口 API。选了 Chromium 路线就没有理由不选 Electron。

**第 5：Wails v3。** 窗口层是所有框架里最贴合悬浮岛的（NSPanel、刘海窗口都是内建的）[29][30]。排在后面是因为它不解决核心问题：没有窗口外的 JS 宿主，插件宿主还是得进隐藏 webview 或边车进程，和现在的 Tauri 处境一样，还要把 Rust 平台层重写成 Go。如果将来决定不要窗口外 JS 宿主，它才值得重新评估。

**出局，以及各自的一句话原因：**

- Socket Runtime：项目已废弃 [53]。
- Neutralinojs：每个窗口一个进程，没有 JS 宿主，模块生态为零 [35][24]。
- Photino：.NET 宿主，没有 JS 运行时，社区小、发布慢 [54][55]。
- Sciter：非标准 DOM、闭源、React 生态用不上 [56][57]。
- 直接用 CEF、Saucer、webview/webview：是库不是框架，等于自己造 Electron [59][61][62]。
- React Native for Windows + macOS：不是 DOM，现有界面和第三方 web 组件全部作废 [63]。
- Lynx / Lynxtron：界面要用 ReactLynx 重写，Lynxtron 发布状态不明 [67][68]。
- Vercel Native SDK：编译型，不能在运行时加载第三方 JS [70]。

## 5. Electron 是否真的让这套架构明显更容易

VS Code、Obsidian、DeepSeek Harness 桌面版的插件系统都建在 Electron 上 [15][16][18]。下面分开说哪些是真的省事，哪些不是。

### 5.1 真的更容易的

1. **宿主进程是现成的。** Node 主进程或 utility 进程就是长驻宿主，不依赖任何窗口 [5][7]。Tauri 上要么把 JS 宿主塞进隐藏 webview，要么自带 Node / Bun 边车并自己做进程管理和 IPC。
2. **Cordis 是按 Node 写的。** loader 和 HMR 直接依赖 Node 内部加载器 [21]。在 Electron 里加一个 `--expose-internals` 就能用 [18]；在非 Node 运行时里要重写。
3. **没有隐藏 webview 被节流的问题。** 宿主不在渲染器里；需要后台跑的窗口加 `backgroundThrottling: false` [6]。
4. **插件的后端一半可以直接用 npm 生态和原生插件**（node-pty、sharp、koffi 这类）[18][20]。
5. **两个平台是同一个 Chromium。** 第三方插件作者不用同时适配 WebView2 和 WKWebView 的差异。对一个开放给外部开发者的插件平台，这一条的长期价值可能比前四条都大。**推断**。
6. **多窗口可以共用一个渲染进程。** 同站 `window.open` 子窗口与父窗口同进程 [9]，插件往「任意窗口的槽位」注入组件时不需要每个窗口各加载一遍插件代码。

### 5.2 没有变容易、或者更差的

1. **内存不会降。** Windows 上 Electron 与 WebView2 系同级 [24]；macOS 上会从 WKWebView 的水平涨到 Chromium 的水平 [24][26]。再加上 Node 宿主进程本身的占用（具体数字**未核实**）。330 MB 的问题要靠减少常驻的渲染进程数量来解决，换框架解决不了。
2. **体积涨一到两个数量级。** 安装包从几 MB 到约 85–106 MB [27]，未压缩 270–370 MB [24]。更新包也相应变大。
3. **界面侧的插件加载并没有因为 Electron 变简单。** 动态 `import()`、共享 React、类型化槽位，在任何 web 引擎里都是同一套做法。
4. **全信任插件的风险不变。** 宿主侧插件拥有用户权限，Obsidian 和 DeepSeek 都明确承认管不住 [16][19]。Electron 的沙箱和上下文隔离保护的是「页面拿不到 Node」，但插件组件注入到应用自己的渲染进程后，和应用界面共享同一个上下文和同一座通往宿主的桥。
5. **原生层要搬家。** 现有 Rust 平台层要包成 N-API 插件或者留作边车进程；所有 Tauri 命令要改成 IPC 处理器。按 Electron 版本重建原生插件是持续成本 [11]，DeepSeek 把它写成了 "release compatibility obligations" [18]。
6. **维护节奏更紧。** 每 8 周一个大版本，只支持最新 3 个 [3]；Chromium 安全更新要跟。
7. **刘海窗口没有内建支持**，Wails v3 反而有 [30]。
8. **现有用户的升级路径要另外设计。** 更新端点和 `latest.json` 是对外契约；从 Tauri 更新器跳到 Electron 更新器需要一个过渡版本。**推断**，没有查到现成的迁移案例。

### 5.3 一句话判断

如果「第三方插件在进程内全信任运行、宿主窗口隐藏时长驻、Cordis 连同 loader 和 HMR 原样可用」是不可让步的，Electron 让宿主这一半的工作量明显变小，并且有 DeepSeek Harness 这个可以逐条对照的先例。它不解决内存问题，还要付出体积和一次完整的原生层迁移。如果内存和体积的优先级高于宿主的便利，就不应该为了插件系统换到 Electron，而应该在现有框架上用边车 Node / Bun 进程做宿主。

## 6. 没有核实的事项汇总

- Electron `utilityProcess` 加 `--expose-internals` 能否让 Cordis loader 工作（只确认了 RunAsNode 子进程的做法）[18]。
- Electron 上刘海区域窗口的成熟方案。
- Dawloom 的 Windows 11 基准原文 [27]。
- Cordis loader / HMR 在 Bun、Deno、NW.js 上的实际表现（结论来自读源码）。
- Electrobun 的 RPC 传输方式、webview 节流行为、签名流程。
- Deno FFI 调 COM / WinRT 的可行性。
- NW.js、Photino、React Native 桌面端的知名生产应用，以及它们的点击穿透、非激活窗口支持。
- Sciter 对 React DOM 的兼容程度。
- Lynxtron 是否已正式发布。
- Node 宿主进程在 Electron 里的常驻内存。
- `WKPreferences.inactiveSchedulingPolicy` 的修复随哪个 macOS 版本发布。

## 来源

1. Electron 发布页（v45.3.2、v45.0.0 发布说明）与仓库元数据：https://github.com/electron/electron/releases
2. Electron 版本数据（Chromium / Node 版本）：https://releases.electronjs.org/releases.json
3. Electron 发布节奏与支持策略：https://www.electronjs.org/docs/latest/tutorial/electron-timelines
4. Electron BaseWindow API：https://www.electronjs.org/docs/latest/api/base-window
5. Electron utilityProcess API：https://www.electronjs.org/docs/latest/api/utility-process
6. Electron WebPreferences：https://www.electronjs.org/docs/latest/api/structures/web-preferences
7. Electron 进程模型：https://www.electronjs.org/docs/latest/tutorial/process-model
8. Electron MessagePorts 教程：https://www.electronjs.org/docs/latest/tutorial/message-ports
9. Electron window.open：https://www.electronjs.org/docs/latest/api/window-open
10. Electron 安全清单：https://www.electronjs.org/docs/latest/tutorial/security
11. Electron 原生代码教程：https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron
12. Electron autoUpdater API：https://www.electronjs.org/docs/latest/api/auto-updater
13. Electron 更新教程：https://www.electronjs.org/docs/latest/tutorial/updates
14. Electron 命令行开关：https://www.electronjs.org/docs/latest/api/command-line-switches
15. VS Code 扩展宿主：https://code.visualstudio.com/api/advanced-topics/extension-host
16. Obsidian 插件安全：https://obsidian.md/help/plugin-security
17. 2026 年知名 Electron 应用盘点（二手汇总）：https://codenote.net/en/posts/famous-electron-apps-2026-research/
18. DeepSeek Harness 设计记录「Use Electron as the Desktop Node runtime」：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/.agents/notes/archived/architecture/2026-09-11-desktop-electron-node-runtime.md
19. DeepSeek Harness 设计记录「Run Desktop through the shared Web application」：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.md
20. 社区包 dsh-plugin-desktop 的 README：https://unpkg.com/dsh-plugin-desktop@2.0.0/README.md
21. Cordis 仓库（README、`packages/core`、`packages/loader/src/internal.ts`、`packages/hmr/src/index.ts`、各包 package.json）：https://github.com/cordiverse/cordis
22. Cordis 入门（DeepSeek Harness 文档）：https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer
23. node-addon-require-builtin：https://www.npmjs.com/package/node-addon-require-builtin
24. Elanis，Web to Desktop framework comparison（持续基准）：https://github.com/Elanis/web-to-desktop-framework-comparison
25. Better Stack，Tauri vs Electron vs Deno Desktop vs Electrobun：https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/
26. Hopp，Tauri vs Electron 实测（2025-07）：https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4
27. tech-insider 对 Dawloom 基准的转述（直接访问返回 410，数字来自搜索摘要）：https://tech-insider.org/tauri-vs-electron-desktop-app-framework-2026/
28. Wails v3.0.0 发布说明：https://github.com/wailsapp/wails/releases/tag/v3.0.0
29. Wails v3 窗口选项源码：https://github.com/wailsapp/wails/blob/master/v3/pkg/application/webview_window_options.go
30. Wails v3 刘海窗口源码：https://github.com/wailsapp/wails/blob/master/v3/pkg/application/notch_window.go
31. Wails 安全公告：https://github.com/wailsapp/wails/security/advisories
32. Wails README：https://github.com/wailsapp/wails
33. Neutralinojs 配置文档：https://neutralino.js.org/docs/configuration/neutralino.config.json/
34. Neutralinojs 扩展概览：https://neutralino.js.org/docs/how-to/extensions-overview/
35. Neutralinojs window API：https://neutralino.js.org/docs/api/window/
36. Neutralinojs 发布页：https://github.com/neutralinojs/neutralinojs/releases
37. Electrobun 仓库（README、发布页、源码中的 `bun:ffi` 用法）：https://github.com/blackboardsh/electrobun
38. Electrobun BrowserWindow 文档：https://docs.electrobun.dev/electrobun/apis/browser-window/
39. Electrobun 架构概览：https://docs.electrobun.dev/electrobun/guides/architecture/overview/
40. Electrobun v2.x 变更记录：https://docs.electrobun.dev/electrobun/guides/changelog/v2-x/
41. Electrobun 官网：https://electrobun.dev/electrobun/
42. Electrobun v1 发布文章：https://electrobun.dev/blog/electrobun-v1/
43. NW.js 博客（版本列表）：https://nwjs.io/blog/
44. NW.js Manifest 格式：https://nwjs.readthedocs.io/en/latest/References/Manifest%20Format/
45. NW.js 的 JavaScript 上下文：https://nwjs.readthedocs.io/en/latest/For%20Users/Advanced/JavaScript%20Contexts%20in%20NW.js/
46. Deno desktop 概览：https://docs.deno.com/runtime/desktop/
47. Deno desktop 后端：https://docs.deno.com/runtime/desktop/backends/
48. Deno desktop 窗口：https://docs.deno.com/runtime/desktop/windows/
49. Deno desktop 与其他工具对比：https://docs.deno.com/runtime/desktop/comparison/
50. Deno desktop 分发：https://docs.deno.com/runtime/desktop/distribution/
51. `deno desktop` 命令参考：https://docs.deno.com/runtime/reference/cli/desktop/
52. Deno 2.9 发布文章与 Deno 发布页：https://deno.com/blog/v2.9 ，https://github.com/denoland/deno/releases
53. Socket Runtime 仓库：https://github.com/heapwolf/socket
54. Photino 官网：https://www.tryphotino.io/
55. Photino.NET 仓库：https://github.com/tryphotino/photino.NET
56. Sciter 官网：https://sciter.com/
57. Sciter 价格页：https://sciter.com/prices/
58. Sciter.JS SDK 仓库：https://gitlab.com/sciter-engine/sciter-js-sdk
59. CEF 仓库 README：https://github.com/chromiumembedded/cef
60. CEF 分支与构建：https://chromiumembedded.github.io/cef/branches_and_building
61. Saucer 仓库（README、`include/saucer/window.hpp`）：https://github.com/saucer/saucer
62. webview/webview 仓库：https://github.com/webview/webview
63. React Native for Windows 新架构：https://microsoft.github.io/react-native-windows/docs/new-architecture
64. React Native for Windows 发布页：https://github.com/microsoft/react-native-windows/releases
65. React Native macOS 发布页：https://github.com/microsoft/react-native-macos/releases
66. Messenger 桌面版下线的报道：https://dzrh.com.ph/post/meta-to-retire-messenger-desktop-app-and-messengercom-in-april-2026-users-shift-to-web-and-mobile-platforms
67. Lynx 3.7 发布文章与仓库：https://lynxjs.org/blog/lynx-3-7 ，https://github.com/lynx-family/lynx
68. Lynxtron 介绍：https://lynxjs.org/next/lynxtron/learn/what-is-lynxtron
69. 微软 React Native 博客（Office 的使用情况）：https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize
70. Vercel Labs Native SDK：https://github.com/vercel-labs/native
71. TeamDev，Top 5 Electron alternatives in 2026：https://teamdev.com/mobrowser/blog/top-5-electron-alternatives-in-2026/
72. WebView2 CoreWebView2Settings：https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings
73. WKPreferences.inactiveSchedulingPolicy 与 WebKit bug 270609：https://developer.apple.com/documentation/webkit/wkpreferences/inactiveschedulingpolicy-swift.enum ，https://bugs.webkit.org/show_bug.cgi?id=270609
74. Apple 开发者论坛，浮在全屏应用之上的窗口：https://developer.apple.com/forums/thread/826308
75. Hacker News 搜索（2026 年桌面框架相关高分帖）：https://hn.algolia.com/?query=desktop%20framework
