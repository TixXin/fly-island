# 桌面框架调研（原生界面类）：Qt、React Native 桌面、Avalonia、Flutter、Slint 等

> 日期：2026-11-14。问题：不用 WebView 的桌面框架（Windows、macOS）里，哪些能做浮屿的「万物皆插件」架构；「插件描述界面、宿主原生渲染」这条中间路线行不行。范围：Flutter、Qt 6 / QML、Avalonia 等 .NET 方案、Compose Multiplatform、JavaFX、两套原生壳加共享 JS 引擎、React Native Windows / macOS、Slint、Dioxus、egui、Iced、Lynx 的官方文档和仓库；Raycast、Zed、JetBrains、Figma 等的插件界面做法。**没有实测**，内存数字多数陈旧。这是 [desktop-frameworks.md](desktop-frameworks.md) 的详细材料之一。

调研日期：2026-11-14。范围：只看 Windows + macOS，只看不靠 WebView / Chromium 的原生 UI 方案。Tauri 2、MyGo、GPUI、Electron 等已在别处调研，这里不重复。

版本号和发布日期大多直接取自各项目的 GitHub Releases（2026-11-14 用 `gh api` 读取）。正文里的 `[n]` 对应文末来源。没能找到一手来源、或只有二手说法的地方，标「未核实」。

---

## 0. 结论先行

1. **没有哪个非 WebView 方案能同时满足全部条件**（运行时加载 JS/TS 插件、插件能改任意 UI、原生渲染、低内存、两个系统都成熟）。每个方案都要放弃至少一项。
2. **能完整保留「插件可以改任意 UI」的只有三类**：Qt 6 + QML（插件写 QML + JS）、React Native Windows + macOS（插件写 React，原生渲染）、.NET 的 Avalonia / WPF（插件是 .NET 程序集，JS 是二等公民）。
3. **「插件描述 UI，宿主原生渲染」（Raycast 旧版、PowerToys 命令面板、Cash App Treehouse 的做法）是真实可行的中间路线，但它和「内置功能也是插件、插件能换掉任何界面」有根本冲突**：要想不受限，宿主的组件集就得做到 View / Text / Image / 输入框 / 滚动 / 动画这一层，那等于自己写一套 React Native，而且要写两遍。
4. **最重要的一条反面证据**：这条路线的开创者 Raycast 在 2026-05 的 2.0 里放弃了原生渲染，改成「Swift/AppKit 壳 + C#/WPF 壳 + 系统 WebView + 常驻 Node 后端」，内存从 200–300 MB 涨到 350–450 MB，他们认为值得 [68]。这个结构和浮屿现在的 Tauri 结构几乎一样，而且比浮屿现在的 330 MB 还高。
5. **内存收益要算清楚**：能找到的实测很少而且旧。按现有数字，Qt / Flutter / Slint 的空应用在 45–110 MB，Compose 在 108–150 MB，Raycast 原生版（带 Node）在 200–300 MB [10][19][60][68]。也就是说整套重写换来的大约是 150–250 MB，而且一旦插件宿主用 Node，这部分收益会被吃掉一大半（Raycast 2.0 里 Node 后端单独占 150–200 MB）[68]。

**针对本项目的排名**（详细理由见第 6 节）：

| 名次 | 方案 | 一句话 |
|---|---|---|
| 1 | Qt 6 + QML | 唯一成熟、且天生支持「运行时加载声明式 UI + JS、改任意界面」的原生方案；代价是全部重写、插件作者写 QML 不写 React |
| 2 | React Native Windows + macOS | 唯一能让「JS/React 插件 + 任意 UI + 原生渲染」同时成立的；平台风险最高，窗口层要两边各写原生代码 |
| 3 | Avalonia（.NET，JIT 模式） | .NET 插件能改任意 UI，JS 可以经 Jint / ClearScript 直接操作控件对象；macOS 原生接口弱，不能用 NativeAOT |
| 4 | 两套原生壳 + 共享 JS 核心（Raycast 旧版模式） | 原生手感和内存理论上最好；UI 工作量翻倍，只能做到「插件描述 UI」；Raycast 自己已经退出 |
| 5 | Slint + Rust | 现有 Rust 原生层能留下；`.slint` 可运行时解释；桌面功能和富文本还有缺口，只能「描述 UI」 |
| 6 | Flutter | 不能运行时加载 Dart；多窗口到 3.50 仍是实验；只能「描述 UI」 |
| 7 | Compose Multiplatform 桌面 | JVM 内存不比 WebView 省多少；原生 API 调用最别扭 |
| 观察 | Lynx / Lynxtron、Dioxus Native、Vercel Native SDK、Sciter | 方向对口但太早期或风险集中在单点 |
| 排除 | .NET MAUI、单用 WinUI 3 / WPF、Uno、JavaFX、egui、Iced、Valdi、NodeGUI、Theia / Code-OSS | 见 6.4 |

---

## 1. 评估口径

需求拆成七条，后面每个方案都按这七条看：

- **R1 运行时加载**：第三方插件不重新编译应用就能装上，最好是 JS/TS，进程内、完全信任。
- **R2 服务注册**：插件按名字注册和取用服务。这条所有方案都能做，不再单独讨论。
- **R3 任意 UI**：插件能在任何窗口的类型化插槽里加界面或换掉界面；内置功能本身也是插件。
- **R4 常驻插件宿主**：窗口全关了宿主还在后台跑。
- **R5 原生 API**：WinRT 媒体会话、通知监听、UI Automation、剪贴板、截屏；AppKit、ScreenCaptureKit、辅助功能。
- **R6 悬浮岛窗口**：透明、无边框、置顶到全屏应用之上、macOS 上不抢焦点的 panel、点击穿透或输入区域、多窗口、托盘、刘海定位。
- **R7 空闲内存**：现在约 330 MB，几乎都在 WebView2。

R3 是分水岭。业界有两种做法：

- **A. 插件注入真实 UI 组件**：插件代码和宿主 UI 在同一个对象模型里，能拿到真实控件。例子：Krita（PyQt）[24]、JetBrains 平台（Swing，类加载器）[74]、Theia 的编译期扩展 [72]、Obsidian（未核实，Electron，不在本次范围）。
- **B. 插件描述 UI，宿主渲染**：插件只产出一棵描述树，宿主决定怎么画。例子：Raycast 旧版 [67]、PowerToys 命令面板 [70]、VS Code 的贡献点 [71]、Blender 的 `draw()` 布局 [76]、Cash App Treehouse [47]、Sublime [75]、Zed [73]、Figma（文档操作在沙箱里，界面在 iframe 里）[77]。

---

## 2. 先看「围绕插件设计的壳」各自怎么做 UI 扩展

### 2.1 Raycast：从原生渲染退回 WebView（最关键的参照）

**旧版（2023 年的官方说明）**[67]：
- 扩展跑在 Raycast 管理的一个 Node 子进程里，每个扩展一个 worker 线程（等于一个 V8 isolate），有堆内存上限，超了直接停掉。
- 开发者用 React 写，但只能用 Raycast 提供的组件。自写的 React reconciler 把每次渲染变成 JSON「渲染树」，和上一次做 JSON Patch 差分，没变化就什么都不发；树大时 gzip。
- 通过标准流走 JSON-RPC。扩展只能发已登记的消息（如 `render`、`setClipboard`），不能任意调宿主代码。
- Swift 侧把渲染树变成轻量视图模型，交给自写的 AppKit 组件用命令式代码更新。选 AppKit 不选 SwiftUI 是担心崩溃率和性能。
- 不给任意 UI 的理由是产品上的：不想要「二等的 WebView 小应用」，扩展要和原生界面一致。
- 先试过 JavaScriptCore（每个扩展一个引擎，经 XPC 放进程外），后来放弃：JSC 只是裸引擎，网络、文件都得自己补，很多 npm 包用不了，影响开发者采用。
- 开发时 `npm run dev` 用 esbuild 监听并热部署，Raycast 重新加载扩展。

**2.0（2026-05-14 公测；更新日志显示 2026-08-21 结束测试）**[68][69]：
- macOS 壳是 Swift + AppKit，装 WKWebView；Windows 壳是 C# + .NET 8 + WPF，装 WebView2。评估过 WinUI 3，认为风险太大。
- 界面是一份 React + TypeScript 前端，两个系统共用，每个窗口一个入口。
- 一个常驻 Node 后端进程管数据库、扩展运行时等；Rust 写文件索引和同步。
- 明确评估并否决了 Electron、Tauri、Flutter、Qt、React Native 桌面、两边都用 Swift。
- 内存：旧版用一阵后 200–300 MB；新版 350–450 MB。主窗口隐藏时的大致构成：WebView 内容进程 120–200 MB、Node 后端 150–200 MB、Swift 壳约 40 MB、WebKit GPU 进程约 18 MB、网络进程约 12 MB。他们测的基线：空 WebView 约 50 MB，空 Node 进程约 12 MB。不活动的窗口会被销毁来省内存，代价是再打开有短暂延迟。
- 给出的理由：两套原生 UI 是「两倍的工作，却不会更快」；AppKit 开始碍事、编译越来越慢、深度 macOS 人才难招；富文本、Markdown、AI 对话这类界面 WebKit 做得好。
- 新版里扩展界面具体怎么渲染，文章没说（未核实）。扩展 API 仍是那套 React 组件，官方说大多数扩展两个系统通用 [69]。

**对本项目的含义**：
1. 「JS 插件 + React 写法 + 原生渲染」确实做出来过，而且跑了好几年。
2. 但它带 Node 时内存并不低（200–300 MB），要低就得换成进程内的 JSC / QuickJS / Hermes，那就没有 npm 和 Node API。
3. 有全职团队的公司都嫌两套原生 UI 太贵。

### 2.2 其他几个参照

- **Vicinae**（C++ + Qt 的启动器，v0.30.0，2026-11-07，GPL-3.0，1 万多星）：自写 React reconciler，把扩展渲染成 Qt 原生界面，并尽量兼容 Raycast 扩展。官方文档对兼容程度的说法前后不一，一处说「不少扩展能用，简单的效果好」，另一处说「非常初级，大多数扩展因为缺 API 或写死了 macOS 的东西跑不了」[22]。它证明「React reconciler → Qt」这条路能走通。
- **PowerToys 命令面板**（Windows）：每个扩展是独立的 .NET 应用、独立进程，经进程外 COM 服务器和 WinRT 接口通信，凡是能实现 WinRT 接口的语言都能写。扩展只能提供列表页、详情页、表单页、Markdown 页、网格页，界面全由宿主画 [70]。这是 Windows 上「B 模式」的官方样板，没有 JS。
- **VS Code**：扩展跑在独立的扩展宿主进程，不能碰 DOM。官方理由是稳定性、启动性能，以及「以后还能继续改 VS Code 的 DOM 而不弄坏扩展」。界面靠清单里的贡献点声明，逃生口是 WebView（等于 iframe，只能消息通信）[71]。
- **Eclipse Theia**（v1.77.0，2026-11-05，EPL-2.0）：三种扩展方式。VS Code 扩展只能用 API；Theia 扩展在**编译期**加入、成为应用的一部分，能完全控制界面；Theia 插件介于两者之间，官方现在建议用前两种 [72]。也就是说「能改任意 UI」的那种不是运行时加载的。Theia 和 Code-OSS 都是 Electron 上的 IDE 外壳，体量和形态都不适合悬浮岛，内存只会更高（具体数字未核实）。
- **Zed**（GPUI + WASM）：扩展是编译成 WebAssembly 组件的 Rust，跑在 Wasmtime 里，接口用 WIT 描述。目前只能加语言支持、调试器、MCP 服务器、主题、图标主题，官方说以后会放开界面定制但还没有；有开发者为了做自定义面板只能 fork Zed [73]。
- **JetBrains 平台**（JVM）：每个插件一个 `PluginClassLoader`，通过扩展点接入。动态插件可以不重启装卸，但有一串限制：只能用标成动态的扩展点、不能有组件、不能覆盖服务、用了原生库就必须重启；卸载失败（通常是类加载器泄漏）时 IDE 会要求重启 [74]。插件拿到的是真实 Swing 组件，属于 A 模式。
- **Sublime Text**（Python）：插件跑在独立的 `plugin_host` 进程，用内嵌的 Python 3.3 / 3.8，宿主崩了不影响编辑器 [75]。界面只能用 minihtml 弹层、phantom 这类受限接口（这一句未核实）。
- **Blender / Krita**（Python）：Blender 的面板是继承 `bpy.types.Panel` 的类，Blender 在需要时给它一个上下文让它画，类要先注册，属于 B 模式 [76]。Krita 默认用 PyQt，插件直接继承 `DockWidget`、用完整的 Qt 控件，属于 A 模式 [24]。
- **Figma**：插件逻辑在主线程的沙箱里（先是 Realms，出过漏洞后换成编译到 WebAssembly 的 C 写的 JS 虚拟机），界面在无源 iframe 里，两边只能消息通信；插件改不了 Figma 自己的界面 [77]。
- **Cash App Treehouse**（Redwood + Zipline）：Kotlin 编译成 JS，放进 QuickJS（Zipline）里跑，用 Compose 的写法产出界面描述，宿主映射成各平台原生控件；代码带 Ed25519 签名，宿主校验；可以不发版就更新界面 [47]。Zipline 还在更新（1.28.0，2026-09-29），Redwood 最后一个版本是 0.19.0（2025-11-06），仓库 2026-01 之后没有推送，活跃度在降。

**小结**：进程内、完全信任、能改任意 UI 的（A 模式）几乎都建立在解释型或带类加载的 UI 栈上（Python + Qt、JVM + Swing、浏览器 DOM）。原生编译型 UI 栈上的产品几乎全是 B 模式。

---

## 3. 各方案逐项

每个方案按 8 项写：① 版本、背景、许可、成熟度、代表应用；② 运行时加载插件；③ 嵌 JS 引擎并把 UI 暴露给它；④ 悬浮岛窗口；⑤ 原生 API；⑥ 内存、体积、启动；⑦ 打包、签名、更新；⑧ 已上线团队报告的痛点。

### 3.1 Flutter 桌面

1. **现状**：3.44（2026-05-20）、3.47（2026-08-12）、3.50（文档站已写「3.50 is live」，日期未核实，原计划 11 月）[1][2][3]。Google 主导，BSD-3。Canonical 从 3.44 起是桌面端的牵头维护方 [1]。3.47 起桌面默认用 Impeller 渲染，macOS 最低 12，Intel Mac 在逐步退出 [2]。代表桌面应用：RustDesk [11]；LocalSend、AppFlowy、Rive、Ubuntu 安装器等（未核实）。
2. **运行时加载**：发布版是 AOT 编译，官方没有运行时加载 Dart 的办法。社区的 `dart_eval` / `flutter_eval` 是一个 Dart 字节码解释器，能从文件或网络加载界面，但不支持全部 Dart 和 Flutter 特性，现有代码要改 [5]。热重载只在调试模式。
3. **JS 引擎**：有 `flutter_qjs`、`quickjs_engine`（QuickJS-NG，经 FFI，全桌面平台）[12]。但 JS 拿不到 Widget，只能自己做「JS 描述树 → Dart 侧建 Widget」的桥。WebF（在 Flutter 上跑 HTML/CSS/JS，GPL-3.0，最后一个版本 2026-03）是同类思路的现成项目（其内部结构未核实）[13]。没找到有影响力的桌面先例。
4. **悬浮岛窗口**：这是最大的短板。多窗口 API 到 3.44 还标着「实验性，不用于生产」，只在 main 通道；3.47 加了 Windows / Linux 的弹出窗口、按内容定尺寸的窗口、暴露原生窗口句柄；3.50 加了 Win32 上的附属窗口，改了一批名字，仍在频繁改 API [1][2][3]。2026-08 的一篇实测说稳定通道上没有公开的多窗口 API，要用第三方的 `desktop_multi_window` [4]。macOS 上的 NSPanel、不抢焦点、透明要靠社区包（`macos_window_utils`、`floating_palette` 0.1.0、`macos_floating_panel` 0.0.2），版本号都很小 [6]。
5. **原生 API**：FFIgen 能给 C 和 Apple 框架生成绑定，可以从 Dart 同步调用；Swift 互操作是实验性的，多线程是已知的最大限制 [8]。Windows 上 `win32` 包管 Win32，WinRT 交给 `windows_*` 系列包，后者自称「高度实验性」且覆盖有限 [9]。实际做法多半是写 C++ / Swift 插件走平台通道。
6. **内存**：只找到一份 2021 年的非正式对比：Flutter 空应用 macOS 59.9 MB、Linux 113 MB [10]。近年的可靠数字未核实。
7. **打包更新**：没有内置更新器，靠社区方案 [14]；Windows 上 MSIX。Flutter 团队自己承认桌面发布步骤太多 [11]。
8. **痛点**：RustDesk 团队说桌面版「仍然有不少 bug」，头一个问题就是多窗口，只能用社区包绕 [11]。移动端插件在桌面上常常不可用（未核实）。

**判断**：R1、R3 只能做到 B 模式，R6 的多窗口还不稳。对一个有 7 个窗口、内置功能要当插件的应用，不合适。

### 3.2 Qt 6 + QML

1. **现状**：6.11（2026-03-23）[15]；搜索结果显示 6.12 LTS 于 2026-09-30 发布（未打开原页核实）。Qt Group 主导。大多数模块 LGPLv3，少数模块只有 GPL 或商业许可；动态链接、并让用户能替换 Qt 库，就可以保持应用闭源 [18]。商业许可有小企业方案（年收入上限 100 万欧元 / 美元，价格各页面不一致）[18]。两个系统上都是老牌方案。代表应用：Telegram Desktop、VLC、OBS、Krita、KDE 全家桶（多为 Qt Widgets，未逐个核实）；QML 类的有 Vicinae [22]。
2. **运行时加载**：这是 QML 的本职。`Qt.createComponent()` 从文件建组件，`Qt.createQmlObject()` 从字符串建对象，`Loader` 声明式加载文件或组件 [16]。插件可以带一包 `.qml` + `.js`，宿主用 `Loader` / `Repeater` 当插槽。QML 对象树是开放的，同进程的代码能找到任何对象、改属性、换掉子树，属于 A 模式。C++ 侧另有 Qt 插件系统（`QPluginLoader`，未展开核实）。改了文件后重新加载要处理引擎缓存 [16]。
3. **JS 引擎**：QML 自带 JS 引擎。`QJSEngine` 可以单独用：`newQObject()` 把 C++ 对象包成 JS 代理（属性、信号、槽都可见），`importModule()` 加载 ES 模块，`registerModule()` 从 C++ 提供具名模块；`console` 之类要用 `installExtensions()` 手动装 [17]。**没有 Node API，没有 npm 解析**，TypeScript 要先转译。想要 React 写法，可以像 Vicinae 那样写 reconciler [22]（它的扩展跑在什么运行时里未核实）。NodeGUI 是另一个「Node + Qt」项目，但它的 React 绑定的 README 写着不再维护、基于 Qt 5 [23]。
4. **悬浮岛窗口**：无边框、透明、置顶、`Qt::Tool`（macOS 上会建成 NSPanel，浮动层级）、`WindowDoesNotAcceptFocus`、`WindowTransparentForInput` 都有。已知的坑：`Qt::Tool` 窗口会压在所有应用之上而不只是父窗口（QTBUG-57581）；`WindowDoesNotAcceptFocus` 有人报告只在 Linux 上按预期工作；全屏空间上的行为要自己调 [20]。苹果论坛确认：要盖在全屏应用上且不把它挤出空间，必须是带 `nonactivatingPanel` 的 NSPanel，普通 NSWindow 不行 [7]。Qt 能拿到原生句柄，这些都可以用一小段 Objective-C++ 补，但要自己写、自己测（具体配方未核实）。多窗口、托盘（`QSystemTrayIcon`）是成熟功能。
5. **原生 API**：C++ 直接调 Win32 / COM / C++/WinRT，Objective-C++ 直接调 AppKit、ScreenCaptureKit、辅助功能。没有额外的桥，但语言是 C++。Rust 可以经 Qt Bridges（Rust 版 2026-07 进 beta，文档里仍写技术预览）或 KDAB 的 cxx-qt（未核实）接入；C# 版 Qt Bridge 0.4.0 beta（2026-09），Swift / Kotlin / Python 版处于早期且文档写着「目前没有积极开发」[21]。
6. **内存**：数字不一致。2013–2014 年 Qt 5 时代论坛上「什么都不做的 QML 应用」约 30–50 MB，带较多控件的示例 60–100 MB；2021 年一份对比里 Qt Widgets 应用 MultiMC 在 macOS 上 58 MB；2026 年一份 Linux 实测里，带 5000 项滚动容器时 Qt Widgets 约 44 MB、Qt Quick 约 183 MB [10][19]。合理预期是实际应用 80–180 MB，需要自己测。所有窗口在一个进程里。体积和启动时间未核实。
7. **打包更新**：`windeployqt` / `macdeployqt` 收集依赖，签名公证走各系统的标准流程；没有内置自动更新，通常接 Sparkle / WinSparkle（未核实）。
8. **痛点**：许可和商业价格是长期抱怨点；有人认为 Qt 在通用应用框架上的吸引力在下降，优势在嵌入式和工业；不少桌面开发者觉得 QML 做「像原生」的桌面界面不如 Widgets（这几条来自论坛和第三方评述，未逐条核实）。QML 控件在两个系统上都不是系统原生控件，是自绘的。

**判断**：R1、R3、R4、R5、R6 都能满足，而且是靠框架本来的设计而不是外挂。代价是界面和原生层全部重写，插件作者要学 QML。

### 3.3 .NET 系

#### Avalonia

1. **现状**：12.0（2026-04）、12.1（2026-07-08）、12.1.6（2026-11-09）；MIT；AvaloniaUI 公司主导。12 起只支持 .NET 8 及以上，建议 .NET 10，编译绑定默认开启 [25]。自绘（Skia），不用系统控件。厂商列出的用户：JetBrains（dotMemory / dotTrace 的 macOS、Linux 独立版）、Unity、GitHub、Schneider Electric、Autodesk、Devolutions、Lunacy；这些都是厂商自述 [32]。
2. **运行时加载**：标准做法是自定义 `AssemblyLoadContext` + `AssemblyDependencyResolver` 加载插件 DLL；可回收的上下文能卸载 [29]。插件拿到的是真实控件和可视树，A 模式。XAML 可以运行时加载：`AvaloniaRuntimeXamlLoader.Load / LoadGroup` 从字符串或流建界面；这些接口标着「需要未被引用的代码」，和裁剪、AOT 冲突 [28]。社区的 HotAvalonia 做热重载 [28]。`AssemblyLoadContext` 不是沙箱，插件有完整 CLR 权限，正好符合「完全信任」。
3. **JS 引擎**：Jint 是纯托管的 JS 解释器，支持到 ES2025，宿主调用不跨原生边界；ClearScript 包了 V8，快但每次互操作要过托管 / 原生边界；Microsoft 的 node-api-dotnet（0.9.36，2026-10-31）能把 libnode 嵌进 .NET 进程、在同一进程里 `import` npm 包，但官方仍标「实验性」，依赖一个 Node 上游的嵌入 API 改动 [35][36]。这几个引擎都能把 .NET 对象直接交给 JS，所以 JS 插件理论上能直接 `new` 控件、挂到插槽上。没找到把这当产品级插件模型的先例；要 React 写法得自己写 reconciler。
4. **悬浮岛窗口**：Windows 上透明度选项最全；macOS 只支持 `Transparent` 一种 [30]。置顶、无系统装饰、显示时不激活都有属性（逐项行为未核实）。「透明像素点击穿透」是已知缺口，有人从 WPF 移植时做不到 [30]。macOS 后端是 Avalonia 自己写的 Objective-C++，里面有 `AvnPanelWindow`（用了 NSPanel），但官方说它的绑定只覆盖框架自己要用的部分，不暴露完整的 macOS API [31]。不抢焦点、盖过全屏这些要自己拿句柄做原生互操作。
5. **原生 API**：Windows 上 C# 调 WinRT / COM 是第一等的（CsWinRT、CsWin32，未展开核实）。macOS 上要么用 .NET 的 macOS 绑定，要么 P/Invoke 自己的原生库（现有的 Rust 层可以编成动态库继续用）。
6. **内存与启动**：厂商数字：NativeAOT 启动从 v11 的 1960 ms 降到 v12 的 460 ms，空闲 CPU 从 0.20% 降到 0.01% 以下 [26]。社区模板称 NativeAOT 下约 18 MB 体积、约 20 MB 内存 [27]。**但 NativeAOT 不能动态加载程序集、和运行时 XAML 冲突，插件应用只能用 JIT**；JIT 模式空窗口的内存没找到实测（未核实，按经验在 80–150 MB）。
7. **打包更新**：Velopack（1.2.161）一条命令出安装包、增量包、自更新包，支持 Windows / macOS / Linux；macOS 上装在 `/Applications` 时用 AppleScript 提权 [34]。
8. **痛点**：Avalonia 自己的博客都说「对大多数在产的 WPF 应用，留在 WPF 往往才是对的」[33]。独立团队的 2025–2026 上线复盘没找到（未核实）。

#### WinUI 3 / WPF（只有 Windows）

- **WinUI 3**：随 Windows App SDK 发布，2.0 于 2026-04-29 正式发布，现在是 2.6.5（2026-11-03），MIT；微软 2025-07 宣布分阶段开源，2026-08 主线开发搬到 GitHub [37][38]。透明窗口没有直接的属性，官方问答给的办法是去掉边框标题栏后用 Win32 的 `SetLayeredWindowAttributes`；`SwapChainPanel`、WebView2 这类外部内容不支持透明；透明且点击穿透的问题在官方问答里没有被采纳的答案 [39]。性能上长期被抱怨比 WPF、UWP 慢，微软 2026 年在补（文件资源管理器启动时 WinUI 代码执行时间降 25% 等，没给内存数字）[40]。Raycast 评估后认为它风险太大，选了 WPF [68]。
- **WPF**：仍在随 .NET 更新，MIT。`AllowsTransparency` + `WindowStyle=None` 做透明无边框是老办法（未核实文档）。插件用 `AssemblyLoadContext` 或 MEF，运行时 XAML 用 `XamlReader`；有报告说 XAML 解析器不认识加载上下文，把 XAML 加载到非默认上下文会出怪错 [28 引用的 dotnet/wpf#1700]。
- 两者都只能作为「两套原生壳」方案里 Windows 那一半。

#### .NET MAUI

- 11.0.10（2026-11-11），MIT [41]。macOS 走 Mac Catalyst，只能用到 AppKit 的一部分 [41]，NSPanel、任意窗口层级这些拿不到（据此推断，未逐项核实）。有社区 / 预览性质的原生 AppKit 后端包（`Microsoft.Maui.Platforms.MacOS` 0.1.0 预览、`Platform.Maui.MacOS` 0.3.0），采用很少 [41]。**对悬浮岛不可用。**

#### Uno Platform

- 7.0 于 2026-11-12 发布（与 .NET 11 同期），Apache-2.0；默认 SkiaSharp 4，Windows / Linux 上默认走 Vulkan；**去掉了 Mac Catalyst**，macOS 用 Skia 桌面头；Windows App SDK 升到 2.4；自称比 6.7 快约 2 倍、包小 83% [42]。NativeAOT 下示例应用启动从约 1.6 s 降到约 0.82 s [42]。窗口管理接口（透明、无边框、置顶）发布说明里没提（未核实）。API 是 WinUI 的，插件思路同 Avalonia。成熟度和桌面窗口控制不如 Avalonia，不单独推荐。

### 3.4 Kotlin Compose Multiplatform 桌面、JavaFX

**Compose Multiplatform 桌面**
1. 1.12.2（2026-10-15），1.13 在 beta；JetBrains 主导，Apache-2.0；跑在 JVM 上，Skia 自绘 [43]。代表应用：JetBrains Toolbox [10]。
2. 插件可以是 JAR，用类加载器或 PF4J（3.16.1，Apache-2.0）加载 [45]。Kotlin 论坛上有人建议用 PF4J 起步，但指出 Composable 函数跨反射边界是难点；没找到成熟范例 [44]。Compose Hot Reload 在 1.10.0（2026-01）转为稳定并默认启用，只用于开发 [43]。
3. JS：GraalJS（未核实）或 Zipline（QuickJS）。Treehouse 正是「JS 里跑界面逻辑 → 宿主原生控件」，属于 B 模式 [47]。
4. 窗口：`undecorated`、`transparent`、`alwaysOnTop` 都有，有现成示例 [79]。没有点击穿透的参数；有人报告 `focusable=false` 和透明、无装饰组合时窗口变成一片白 [44]。macOS 的 NSPanel 行为要经 JNA 之类调 AppKit（未核实）。
5. 原生 API：要走 JNI / JNA / FFM，调 WinRT 和 AppKit 是所有方案里最别扭的。
6. 内存：2021 年的 issue：Compose 空应用 macOS 108 MB、Linux 146 MB；JetBrains Toolbox macOS 153 MB、Linux 253 MB；把 Java 堆压到 30 MB 后仍是 109 MB，说明主要是堆外（Skia 等）[10]。启动：AOT 缓存的 PR 称 macOS 上启动快 2–5 倍、Windows 快 1.5 倍，但启动初期内存更高 [44]。
7. 打包：Gradle 插件出各系统的原生安装包（基于 jpackage）[43]；自动更新要另找方案（未核实）。
8. 痛点：内存和启动；JetBrains 表示原生（非 JVM）桌面 Compose 只是可能的长期目标 [44]。

**JavaFX**：26（2026-03），25 是 LTS [46]。同一份对比里空应用在 Linux 上 209 MB [10]。透明窗口、置顶有（未核实）。内存、原生 API、生态都不如上面几个，排除。

**判断**：内存比现在省不了多少，原生 API 最难用，R3 对 JS 只能 B 模式。

### 3.5 两套原生壳 + 共享 JS 核心（Swift/AppKit + C#/WinUI 或 WPF）

这不是一个框架，是 Raycast 旧版的结构推广开来。

1. **成熟度**：各自的壳都是所在系统最成熟的技术。先例：Raycast 旧版（只有 macOS）[67]、PowerToys 命令面板（只有 Windows，没有 JS）[70]。**没找到「两个系统各一套原生渲染器 + 同一套 JS 插件」并且还在这么做的产品**；Raycast 做到跨平台时改成了 WebView [68]。
2. **运行时加载**：JS 包直接加载，开发时可热重载 [67]。
3. **JS 引擎怎么选**：
   - Node 子进程：生态完整，Raycast 的选择；但 Raycast 2.0 里 Node 后端占 150–200 MB，不是进程内 [68]。
   - 进程内引擎：macOS 自带 JavaScriptCore；Windows 上 ClearScript（V8）、Jint、node-api-dotnet 嵌 libnode（实验性）[35][36]；或两边都嵌 QuickJS-NG（v0.18.0，2026-11-01，MIT）/ Hermes。Raycast 放弃 JSC 的原因是「裸引擎什么都没有，网络文件都要自己补，npm 包用不了」[67]。
   - 界面桥：自写 React reconciler，产出渲染树，差分后发给壳 [67]。
4. **悬浮岛窗口**：最好。NSPanel + `nonactivatingPanel` + 窗口层级 + `collectionBehavior`、`ignoresMouseEvents`、刘海区域都是直接可用的 AppKit；Windows 上分层窗口、`WS_EX_NOACTIVATE`、`WS_EX_TRANSPARENT` 直接可用。苹果论坛和第三方博客都说明：要盖住全屏应用又不激活自己，NSPanel 是正路 [7][78]。
5. **原生 API**：最好，没有任何桥。Swift 直接用 ScreenCaptureKit、AX；C# 直接用 WinRT、UI Automation。
6. **内存**：理论上最低。Raycast 2.0 测得 Swift 壳约 40 MB、空 Node 约 12 MB [68]。但 Raycast 旧版实际用起来 200–300 MB [68]，说明总量取决于装了多少东西，而不只是渲染方式。
7. **打包更新**：macOS 用 Sparkle，Windows 用 MSIX 或 Velopack [34]（Sparkle 未核实）。两条发布线。
8. **痛点**：Raycast 的原话是两套原生 UI「两倍的工作，却不会更快」；富文本、Markdown、动画在原生里更难；AppKit 人才难招 [68]。

**能不能保留 R3**：只能 B 模式，而且有个硬约束：宿主提供什么组件，插件才能画什么。
- 组件做成高层的（列表、详情、表单，像 Raycast、命令面板）：工作量可控，但插件画不出任意界面，内置功能（歌词、日历、截图标注、笔记编辑）大部分表达不了。
- 组件做成低层的（盒子、文字、图片、输入、滚动、弹性布局、动画）：插件自由了，但这就是在 AppKit 和 WinUI 上各实现一遍 React Native 的宿主组件。

### 3.6 React Native for Windows + React Native macOS（微软）

1. **现状**：RNW 0.85.0（2026-10-20），要求 Visual Studio 2026、.NET 10、Windows App SDK 1.8；从 0.80 起新架构默认开启，0.82 起彻底去掉旧的 Paper 渲染器，只剩 Fabric [48]。新架构下应用是基于 Windows App SDK 的 Win32 应用，Fabric 组件用 C++ 写，经 `Microsoft.UI.Composition` 渲染，可以托管 XAML 岛 [50]。RN-macOS 0.83.0（2026-09-30），是 `facebook/react-native` 的分叉，支持 macOS 11 及以上，README 自己说文档还在补 [49]。两个仓库都是 MIT、微软维护。**版本不同步**：现在能对齐的最高公共版本是 0.83。代表应用：微软说 Office 里有 40 多处用了 React Native，包括功能区和文档之间的 Copilot 面板；Xbox 应用 [51]。Messenger 桌面版曾迁到 React Native 桌面，后来换成 Catalyst，2024-09 改成 PWA，2025-12-15 整个下线 [52]。
2. **运行时加载**：JS 包本来就是运行时加载的。Re.Pack（Callstack）用 Rspack / Webpack 的 Module Federation 在运行时加载远程包，`react` / `react-native` 作为单例共享，支持给远程包签名；带原生代码的依赖必须和宿主对齐 [53]。它在 Windows / macOS 上是否可用未核实。插件就是 React 组件，和宿主组件在同一棵树里，**A 模式，而且写法就是 React**。开发时有 Fast Refresh。
3. **JS 引擎**：自带 Hermes，不用另嵌。没有 Node API，需要的文件、网络能力由宿主以原生模块提供。
4. **悬浮岛窗口**：框架本身不管窗口，全部要在原生层写。macOS：有人问过用 RN-macOS 做 Spotlight 式 NSPanel 的置顶问题，没有看到解决 [社区问答，未核实]；新架构在 RN-macOS 0.81 上有第三方项目跑通（Fabric、bridgeless、Hermes），并提到几处要绕的差异（例如重载通知不同、新窗口要等 Fabric 的内容通知再显示）[54]。Windows：内容画在 Composition 岛里，而 WinUI / Windows App SDK 做透明窗口本身就要用 Win32 手段 [39]；RN 内容能不能在透明分层窗口里正确合成未核实。多窗口（一个 JS 运行时、多个根视图）在两个平台上的官方文档都没找到（未核实）。
5. **原生 API**：TurboModule 用 C++、Objective-C / Swift、C# 写。现有 Rust 代码可以编成库从这些模块里调。
6. **内存**：没找到任何实测（未核实）。结构上是 Hermes + 原生视图 + Yoga 布局，没有浏览器进程。
7. **打包更新**：Windows 走 MSIX 或非打包部署，macOS 走 Xcode；JS 层可以单独热更新（Re.Pack 之类）[53]。
8. **痛点**：两个分叉都主要服务 Office 的需要；macOS 文档薄；Meta 自己已经没有桌面 RN 产品 [52]；Raycast 评估后否决了「React Native for Desktop」，没写具体原因 [68]。

**判断**：这是唯一把 R1（JS）、R3（任意 UI）、原生渲染三件事天然合在一起的方案，现有的「React 组件放进类型化插槽」的思路几乎能原样保留（但 DOM、CSS、现有组件都用不了，要用 RN 的基础组件重写）。风险集中在平台层：窗口行为没有先例可抄，两个分叉的节奏不由自己掌握。

### 3.7 Slint

1. **现状**：1.18.1（2026-09-21）。SixtyFPS GmbH 主导。三选一许可：GPLv3、免版税许可（可用于闭源的桌面、移动、Web 应用，条件是声明使用了 Slint；不含嵌入式）、商业许可 [59]。许可文本和价格页对「署名是否必须」说法不一，以许可文本为准 [59]。Rust 写的，自绘。代表应用：LibrePCB 2.0 正在从 Qt 迁到 Slint [58]。
2. **运行时加载**：有解释器。Rust 的 `slint-interpreter` crate 能运行时加载 `.slint` 并显示 [57]。能不能把动态加载的组件嵌进已有组件树（`ComponentContainer` 之类）未核实；没找到做插件系统的先例。
3. **JS**：有 Node.js 绑定（也支持 Deno、Bun），`loadFile()` / `loadSource()` 运行时编译加载 `.slint`，JS 能实例化导出的组件、读写属性、挂回调、给模型；**官方标为 beta，说明接口会变、重要功能还在做** [57]。1.17 起 Node 版在 Linux / macOS 上空闲 CPU 接近零，Windows 上还没做到 [55]。
4. **悬浮岛窗口**：`Window` 有 `always-on-top`、`no-frame`、`background`；参考页没有点击穿透、不抢焦点、跳过任务栏之类的属性 [56]。1.17（2026-06）加了系统托盘图标、工具提示、拖放 [55]。2025-10 官方自己列的桌面缺口：弹出层多数还画在主窗口里而不是真窗口、模态对话框要等 winit、拖放只能在单窗口内、快捷键支持有限、富文本还在讨论 [58]。底层是 winit，NSPanel 之类要自己拿原生句柄改。
5. **原生 API**：就是 Rust，现有的 `win32/`、`macos/` 层可以直接留下。这是它对本项目最大的吸引力。
6. **内存**：「运行时不到 300 KiB」是单片机上的数字，Slint 开发者自己澄清过；桌面上空应用有人测到约 45 MB、用 Qt 后端约 54 MB；一位开发者把监控工具从 egui 的约 135 MB 换成 Slint 软件渲染后约 30 MB [60]。都是个例。
7. **打包更新**：按 Rust 应用处理，没有内置更新器（未核实）。
8. **痛点**：界面表现力（复杂动画、模糊、富文本）不如 CSS；桌面功能还在补 [58]。

**判断**：B 模式，且「运行时拼装别人的组件」这一步有没有都没核实。适合「只换悬浮岛这一个窗口」的局部用法，不适合当全应用的插件 UI 底座。

### 3.8 Dioxus（原生渲染器）、egui、Iced

- **Dioxus Native / Blitz**：Dioxus 0.7.10（2026-07-30），0.8 在 alpha；0.7 引入了 Dioxus Native，一个基于 WGPU 的 HTML/CSS 渲染器（Blitz）；Blitz 自述仍是 pre-alpha / alpha，CSS 支持不全 [61]。它没有 JS 引擎，React 跑不了。值得观察（保留 CSS、不要浏览器），现在不能用。
- **egui**：0.37.0（2026-10-15）。即时模式。`ViewportBuilder` 有 `with_transparent`、`with_always_on_top`、`with_mouse_passthrough`、`with_decorations`，支持多个原生窗口 [62]。有过全屏尺寸置顶窗口透明失效的问题（0.27 时期，是否已修未核实）[62]。没有运行时 UI 插件的办法。个例里内存约 135 MB（带 GPU）[60]。
- **Iced**：0.14.0（2025-12-07），之后近一年没有发新版本，仓库仍在提交 [62]。Elm 式架构。多窗口、窗口层级等未核实。
- 三者都没有第三方 JS 插件加界面的路径，排除。

### 3.9 Lynx（字节跳动）

1. **现状**：2025-03 开源，Apache-2.0。3.7（2026-04-16）起官方把 macOS 和 Windows 列为一等平台；4.0（2026-06-08）、4.2.0（2026-10-27）[63]。
2. **桌面怎么画**：用 Lynx 自己的渲染引擎，不是系统控件；319 个 CSS 属性里 311 个可用，246 个元素属性里 179 个可用（约 73%），两个系统一致；加了鼠标、键盘、滚轮事件和 `cursor` [63]。
3. **Lynxtron**：一个「像 Electron 的桌面应用框架，把 Chromium 换成 Lynx 渲染器，配 Node.js」，可以用 C 接口和 Node-API 扩展原生能力。仓库 2026-06-04 建立，Apache-2.0，现在 46 星，文档指向 lynxjs.org/lynxtron [63]。
4. 窗口管理接口（多窗口、透明、无边框、置顶、托盘）、内存数字、桌面上的已知产品都没找到（未核实）。
5. **判断**：方向几乎完全对口（React 写法、CSS 子集、JS 运行时加载、轻量自绘、带 Node）。但桌面支持才半年，Lynxtron 刚起步。现在押上去风险太大，值得每季度看一次。

### 3.10 2025–2026 的新面孔

- **Valdi（Snapchat）**：beta-0.2.1（2026-10-19），MIT。TypeScript 编译到 iOS、Android、macOS 的原生视图，有「多语言模块」可以用 C++ / Swift / Kotlin / Objective-C 写原生部分；在 Snap 内部用了 8 年 [64]。路线图明说：1.0 不包含对 macOS 的完整支持（macOS 保持 beta），只支持 Apple Silicon，**Windows 不支持作为开发环境**，也没有 Windows 目标 [64]。排除。
- **Vercel Labs 的 Native SDK**：2026-05-08 建仓，v0.11.1（2026-11-09），Apache-2.0，约 7800 星。用 TypeScript（一个受检查的子集）和自己的标记语言写，编译成原生可执行文件，界面不经浏览器或 WebView 渲染，核心是 Zig；自述「实验性」，各平台能力不一 [65]。因为是提前编译，没有运行时加载第三方代码的路径。排除，但值得知道。
- **Sciter**：一个约 5 MB 的单 DLL 的 HTML / CSS / 脚本引擎，不是 Chromium；有免费版，起价约 310 美元；据称 Norton、BitDefender 等杀毒软件界面在用 [66]。脚本引擎是否为 QuickJS、当前许可条款、2026 年的维护状态都未核实；公开的 `sciter-js-sdk` GitHub 仓库 2022 年后已归档。它算「不是 WebView 但能让插件改任意界面」的冷门选项，风险在闭源核心和单一作者。
- **NodeGUI**：Node + Qt，v0.74.2（2026-05）；React 绑定的 README 写着不再维护、基于 Qt 5；自称空应用内存低于 20 MB（自述）[23]。排除。

---

## 4. 对比表

符号：✔ 框架本身支持；△ 能做但要自己写不少代码或有明显限制；✘ 做不到或不现实；？ 未核实。

| 方案 | 最新版本（日期） | 插件语言 / 运行时加载 | JS 插件能改任意 UI | 悬浮岛窗口 | 原生 API | 空闲内存（来源质量） | 成熟度 Win / Mac |
|---|---|---|---|---|---|---|---|
| Qt 6 + QML | 6.11（2026-03）；6.12 LTS 未核实 | QML + JS，文件直接加载 ✔ | ✔（QML 的 JS，无 npm / React） | ✔，macOS 细节要补 ObjC++ | C++ / ObjC++ 直接调 ✔ | 45–180 MB（零散、偏旧） | 高 / 高 |
| RN Windows + macOS | 0.85（2026-10）/ 0.83（2026-09） | JS 包 ✔ | ✔（React，原生渲染） | △，全靠原生代码，无先例 | C++ / ObjC / C# 模块 ✔ | ？ | 中 / 中低 |
| Avalonia | 12.1.6（2026-11） | .NET 程序集 ✔；XAML 文本 ✔ | △（Jint / ClearScript 直接操作控件，无先例） | Win ✔；Mac △ | Win ✔；Mac △ | AOT 约 20 MB（自述，但插件不能用 AOT）；JIT ？ | 高 / 中 |
| 两套原生壳 + JS 核心 | — | JS ✔ | ✘（只能描述，宿主渲染） | ✔ 最好 | ✔ 最好 | 壳约 40 MB；整体 200–300 MB（Raycast 旧版） | 高 / 高（但要做两遍） |
| Slint | 1.18.1（2026-09） | `.slint` 解释器 ✔；Node 绑定 beta | ✘（描述；动态嵌入 ？） | △ | Rust ✔ | 30–54 MB（个例） | 中 / 中 |
| Flutter | 3.50（2026-11，日期未核实） | 官方 ✘；`dart_eval` 子集 | ✘（描述） | △，多窗口仍实验 | FFI △ | 60–113 MB（2021 个例） | 中 / 中 |
| Compose 桌面 | 1.12.2（2026-10） | JAR / PF4J △ | ✘（Zipline 描述） | △ | JNI / JNA ✘ | 108–153 MB（2021） | 中 / 中 |
| WinUI 3 / WPF | WASDK 2.6.5（2026-11） | .NET 程序集 ✔ | △ | WPF ✔；WinUI △ | ✔ | ？ | 只有 Windows |
| .NET MAUI | 11.0.10（2026-11） | .NET 程序集 | △ | ✘（Catalyst） | Mac ✘ | ？ | 中 / 低 |
| Uno | 7.0（2026-11-12） | .NET 程序集 | △ | ？ | Win ✔；Mac △ | ？ | 中 / 中低 |
| JavaFX | 26（2026-03） | JAR | ✘ | △ | ✘ | 209 MB（2021，Linux） | 中 / 中 |
| Dioxus Native | 0.7.10；Blitz alpha | ✘ | ✘ | ？ | Rust ✔ | ？ | 低 / 低 |
| egui / Iced | 0.37 / 0.14 | ✘ | ✘ | egui ✔ | Rust ✔ | 约 135 MB（egui 个例） | 中 / 中 |
| Lynx / Lynxtron | 4.2（2026-10）/ 刚起步 | JS ✔ | ？（双线程模型） | ？ | C 接口 + Node-API | ？ | 低 / 低 |
| Valdi | beta-0.2.1（2026-10） | TS | ？ | ？ | 多语言模块 | ？ | 无 / beta |

---

## 5. 「插件描述 UI，宿主原生渲染」这条中间路线，认真算一遍

它许诺四件事：JS 插件、React 写法、原生渲染、低内存。逐条看：

1. **JS 插件 + React 写法**：成立。Raycast 的 reconciler → 渲染树 → JSON Patch → 原生视图模型这套机制是公开的，Vicinae 用 Qt 复刻了一遍 [22][67]。
2. **原生渲染**：成立，但要在两个系统上各写一套组件。
3. **低内存**：只有在不用 Node 时才成立。Raycast 旧版原生渲染 + Node，用起来 200–300 MB；2.0 里 Node 后端单独 150–200 MB [68]。换成进程内的 JSC / QuickJS / Hermes 才能压下来，代价是没有 npm 生态和 Node API，Raycast 当年正是因为这个放弃了 JSC [67]。对浮屿这种完全信任的插件，文件、网络、子进程都得由宿主自己提供接口。
4. **和「一切皆插件」的关系**：这是真正的矛盾点。
   - 插槽里的东西如果限定为一小套语义组件（岛上的胶囊、行、图标按钮、进度条、列表、详情、表单），这条路线很合适：一致、快、省。Raycast、命令面板都证明了。
   - 但需求写的是「内置功能也是插件」「在任何窗口加或换界面」。歌词滚动、日历、截图标注、笔记编辑器、剪贴板的富内容预览，用语义组件表达不了。要表达就得把组件降到盒子、文字、图片、手势、动画这一层，那就是 React Native 的宿主组件层。与其自己在 AppKit 和 WinUI 上各写一遍，不如直接用微软的两个分叉（3.6）。
   - 富文本和编辑是自写原生渲染器最容易栽的地方。Raycast 2.0 把「富文本、Markdown、AI 对话用 WebKit 做得好」列为换架构的好处 [68]。

**是否可以接受**：
- 如果愿意把目标改成「悬浮岛和其他小窗口里的插槽是描述式的；内置功能优先用同一套描述式组件，表达不了的允许用宿主内置实现」，可以接受，而且是内存和手感最好的做法。但那不再是「插件能改任意 UI」。
- 如果「任意 UI」不能让，这条路线就等价于 React Native，或者退回到某种能跑 DOM 的东西（不在本次范围）。

VS Code 的做法是把两者并排：贡献点（描述式）+ WebView（任意，但隔离）[71]。对浮屿来说对应的折中是：常驻的悬浮岛用原生描述式渲染，偶尔打开的重界面（设置、笔记编辑、插件自带的复杂界面）按需开、用完销毁。这已经跨到 WebView 方案那边了，这里只指出有这个可能；Raycast 2.0 也是靠「不活动的窗口直接销毁」来控制内存的 [68]。

---

## 6. 针对本项目的评估与排名

### 6.1 能完整保留「插件可以改任意 UI」的

1. **Qt 6 + QML**。QML 本来就是运行时加载的声明式语言，JS 是内建的，对象树开放。插槽用 `Loader` / `Repeater` 配一个组件登记表就是了；内置功能做成插件没有任何障碍。悬浮岛需要的窗口标志都有，macOS 上不抢焦点、盖过全屏要补一小段 Objective-C++。原生 API 用 C++ / Objective-C++ 直接调。许可上 LGPL 动态链接可以闭源发布。
   - 要放弃的：TypeScript + React 的插件写法（除非再加一层 reconciler，像 Vicinae）；npm 生态；现有的 React 界面和大部分 Rust 原生层（Rust 可以经 cxx-qt 或 Qt Bridges 留一部分，后者还在 beta）。
   - 不确定的：实际内存。零散数字从 45 到 180 MB 都有，必须做一个带悬浮岛和两三个窗口的原型实测。
2. **React Native Windows + macOS**。插件是 React 组件，和宿主在同一个 Hermes 运行时、同一棵树里，现有的插槽模型和 React 经验都能带过来。
   - 要放弃的：DOM 和 CSS（全部界面用 RN 基础组件重写）、Node API、两个系统上现成的窗口封装。
   - 不确定的：透明、无边框、不抢焦点的窗口在 Fabric + Composition 岛上能不能正确合成；一个运行时带七个窗口怎么组织；内存没有任何公开数字；两个分叉版本不同步，且命运系于 Office。Raycast 评估后否决了它 [68]。
   - 建议的判定方式：先只做「悬浮岛 + 一个插件包运行时加载」的原型，两个系统都跑通再谈。
3. **Avalonia（JIT）**。.NET 插件拿到真实控件，能换任何界面；JS 可以经 Jint（纯托管、最省）或 ClearScript（V8）直接操作这些控件对象，技术上也是「任意 UI」，但没有先例、没有 JSX，体验要自己搭。Windows 侧的原生接口是所有跨平台方案里最顺的；macOS 侧 Avalonia 自己的绑定很薄，悬浮岛的 panel 行为和 ScreenCaptureKit 之类要另接（现有 Rust 层编成库来调是可行的做法）。
   - 要放弃的：NativeAOT（所以厂商宣传的启动和内存数字不适用）、React 写法。
   - 不确定的：JIT 模式的实际内存。

### 6.2 会降成「插件描述 UI，宿主渲染」的

4. **两套原生壳 + 共享 JS 核心**。窗口行为和原生 API 最好，内存理论上最低；UI 工作量翻倍，R3 做不全。见第 5 节。只有在接受描述式插槽时才成立。
5. **Slint + Rust**。保住现有 Rust 层是独有优势；`.slint` 可以运行时解释，JS 绑定是 beta；桌面功能和富文本有缺口；动态拼装第三方组件未核实。
6. **Flutter**。不能运行时加载 Dart，JS 只能描述；多窗口到 3.50 仍是实验性接口并在改名。
7. **Compose Multiplatform 桌面**。Kotlin 插件可以做 A 模式但范例缺失，JS 只能走 Zipline 描述；JVM 内存 108–153 MB 起，原生 API 最难用。

### 6.3 观察名单

- **Lynx / Lynxtron**：如果它的桌面窗口接口和内存数字出来且不错，会直接进前三。
- **Dioxus Native（Blitz）**：不要浏览器的 HTML/CSS 渲染器，等它出 alpha。
- **Vercel Native SDK**：看它会不会加运行时加载。
- **Sciter**：冷门但技术上对口，先核实许可和维护状态。

### 6.4 排除的和原因

- **.NET MAUI**：macOS 走 Mac Catalyst，拿不到完整 AppKit，做不了悬浮岛 [41]。
- **只用 WinUI 3 或 WPF**：没有 macOS。只能当 6.2 第 4 项的一半。
- **Uno Platform**：能做的 Avalonia 都能做，桌面窗口控制和成熟度不如 Avalonia。
- **JavaFX**：内存最高的一档，原生 API 难用。
- **egui、Iced**：没有第三方 JS 插件加界面的路径。
- **Valdi**：没有 Windows [64]。
- **NodeGUI**：React 绑定停止维护 [23]。
- **Theia、Code-OSS 当底座**：Electron 上的 IDE 外壳，形态不对，内存只会更高；Theia 里能改任意界面的扩展还是编译期的 [72]。

### 6.5 老实话

- 这次调研里找到的内存数字普遍陈旧、零散、口径不一。**任何「换框架能省多少」的结论都应该先用两三天做原型实测**：同样的悬浮岛 + 一个隐藏窗口 + 一个插件，在候选方案上量空闲内存。优先量 Qt/QML 和 RN。
- 「非 WebView」换来的不只是内存，还有每个窗口不再有独立的渲染进程；但失去的是 CSS 的表现力、现成的 React 组件、以及 Web 生态。Raycast 这种把「原生」当卖点的产品都在 2026 年做了相反的选择 [68]，这一点在做决定时分量很重。
- 如果「插件用 JS/TS + React、能改任意 UI」是不能让的两条，本次范围内只有 React Native 满足；如果「能改任意 UI」不能让但语言可以换，Qt/QML 最稳；如果两条都能松一点，描述式中间路线才真正划算。

---

## 7. 没能核实的清单

- Flutter 3.50 的确切发布日期；Flutter 桌面近两年的空应用内存；`auto_updater` 等更新方案。
- Qt 6.12 LTS 的发布日期（只见于搜索摘要）；Qt Quick 6 空应用在 Windows / macOS 上的内存；Qt 应用的典型安装包体积；在 macOS 上把 Qt 窗口做成不抢焦点、盖过全屏的完整配方；cxx-qt 的现状。
- Avalonia JIT 模式空窗口内存；`ShowActivated=false` + `Topmost` + 无装饰在 macOS 上的实际行为；用 Jint / ClearScript 操作 Avalonia 控件的可行性细节。
- WPF 透明窗口的官方文档引用；WinUI 3 / WPF 空应用内存。
- Uno 7 的窗口管理接口。
- Compose 桌面在 macOS 上做 NSPanel 的办法；GraalVM native image 下的内存；自动更新方案。
- React Native Windows / macOS 的空闲内存；多窗口的官方做法；RN-macOS 上新架构是否默认开启；Re.Pack 在桌面两端是否可用；RN 内容在透明分层窗口里的合成。
- Slint 的 `ComponentContainer` 动态嵌入；Slint 的不抢焦点和点击穿透。
- Iced 0.14 的多窗口和窗口层级。
- Lynx 桌面的窗口接口、内存、已上线产品；Lynxtron 的可用程度。
- Sciter 的脚本引擎、许可、维护状态。
- Sublime 的界面扩展接口限制；Blender 当前版本的注册接口细节。
- Raycast 2.0 里扩展界面的具体渲染路径。
- 各方案的安装包体积和冷启动时间（只找到 Avalonia 和 Uno 的厂商数字）。

---

## 8. 来源

1. Flutter 3.44 发布说明（2026-05-20）：https://flutter.dev/blog/whats-new-in-flutter-3-44
2. Flutter 3.47 发布说明（2026-08-12）：https://flutter.dev/blog/whats-new-in-flutter-3-47
3. Flutter 3.50.0 release notes：https://docs.flutter.dev/release/release-notes/release-notes-3.50.0
4. How to enable multi-window support in a Flutter desktop app（2026-08）：https://startdebugging.net/2026/08/how-to-enable-multi-window-support-in-a-flutter-desktop-app/
5. flutter_eval：https://pub.dev/packages/flutter_eval ；dart_eval：https://github.com/ethanblake4/dart_eval
6. macos_window_utils：https://github.com/Adrian-Samoticha/macos_window_utils.dart ；floating_palette：https://pub.dev/packages/floating_palette ；macos_floating_panel：https://pub.dev/packages/macos_floating_panel
7. Apple Developer Forums，Overlay window above all windows, even when moving spaces：https://developer.apple.com/forums/thread/826308
8. Flutter 文档，FFIgen 与 Objective-C / Swift 互操作：https://docs.flutter.dev/interop/ffigen
9. dartwinrt：https://github.com/halildurmus/dartwinrt ；win32 包：https://pub.dev/packages/win32
10. JetBrains/compose-multiplatform#1632，Memory usage seems surprisingly high（2021-12，含各框架空应用内存表）：https://github.com/JetBrains/compose-multiplatform/issues/1632
11. RustDesk，Flutter desktop development practice：https://dev.to/rustdesk/flutter-desktop-development-practice-4c7a ；Flutter 官方，How can we improve the Flutter experience for desktop：https://flutter.dev/blog/how-can-we-improve-the-flutter-experience-for-desktop
12. flutter_qjs：https://pub.dev/packages/flutter_qjs ；quickjs_engine：https://pub.dev/packages/quickjs_engine
13. WebF：https://github.com/openwebf/webf
14. Elanis/web-to-desktop-framework-comparison：https://github.com/Elanis/web-to-desktop-framework-comparison
15. Qt 6.11 Release：https://wiki.qt.io/Qt_6.11_Release ；Qt latest releases：https://www.qt.io/development/qt-framework/latest-releases
16. Qt 文档，Dynamic QML Object Creation from JavaScript：https://doc.qt.io/qt-6/qtqml-javascript-dynamicobjectcreation.html
17. Qt 文档，QJSEngine：https://doc.qt.io/qt-6/qjsengine.html
18. Qt，Obligations of the GPL and LGPL：https://www.qt.io/licensing/open-source-lgpl-obligations ；Qt for Small Business：https://www.qt.io/pricing/qt-for-small-business
19. Qt 论坛，QApplication with QtQuick memory problem：https://forum.qt.io/topic/40267/qapplication-with-qtquick-memory-problem ；glyh/qimgv#12，GUI stack weight（2026）：https://github.com/glyh/qimgv/issues/12
20. QTBUG-57581：https://bugreports.qt.io/browse/QTBUG-57581 ；Qt 论坛，QWidget across the desktop space in macOS：https://forum.qt.io/topic/143510/qwidget-across-the-desktop-space-in-macos/1
21. Qt Bridges：https://www.qt.io/qt-bridges ；文档：https://doc.qt.io/qtbridges/
22. Vicinae：https://github.com/vicinaehq/vicinae ；Raycast 兼容说明：https://docs.vicinae.com/extensions/raycast 与 https://docs.vicinae.com/raycast-extension
23. NodeGUI：https://github.com/nodegui/nodegui ；React NodeGUI：https://github.com/nodegui/react-nodegui
24. Krita，How to make a Krita Python plugin：https://docs.krita.org/user_manual/python_scripting/krita_python_plugin_howto.html
25. Avalonia 12：https://avaloniaui.net/blog/avalonia-12 ；12.1：https://avaloniaui.net/blog/release-12-1 ；Releases：https://github.com/AvaloniaUI/Avalonia/releases
26. Avalonia 产品页（启动和 CPU 数字，厂商自述）：https://avaloniaui.net/avalonia
27. Avalonia Native AOT 文档：https://docs.avaloniaui.net/docs/deployment/native-aot ；社区 AOT 模板：https://github.com/lixinyang123/AvaloniaAOT
28. AvaloniaRuntimeXamlLoader：https://docs.avaloniaui.net/api/avalonia/markup/xaml/avaloniaruntimexamlloader ；HotAvalonia：https://nuget.org/packages/HotAvalonia.Core ；dotnet/wpf#1700：https://github.com/dotnet/wpf/issues/1700
29. Microsoft Learn，Create a .NET Core application with plugins：https://learn.microsoft.com/dotnet/core/tutorials/creating-app-with-plugin-support
30. Avalonia Windows 平台指南（透明度）：https://docs.avaloniaui.net/docs/platform-specific-guides/windows ；Pass-through transparency 讨论：https://github.com/AvaloniaUI/Avalonia/discussions/11911
31. Avalonia macOS 平台指南：https://docs.avaloniaui.net/docs/platform-specific-guides/macos ；AvnPanelWindow.mm：https://github.com/AvaloniaUI/Avalonia/blob/master/native/Avalonia.Native/src/OSX/AvnPanelWindow.mm
32. Built with Avalonia：https://avaloniaui.net/showcase ；Platforms：https://avaloniaui.net/Platforms
33. Avalonia，WPF Modernization in 2026：https://avaloniaui.net/blog/wpf-modernization-in-2026
34. Velopack：https://github.com/velopack/velopack ；macOS 打包：https://docs.velopack.io/packaging/operating-systems/macos
35. node-api-dotnet：https://microsoft.github.io/node-api-dotnet/scenarios ；NuGet：https://www.nuget.org/packages/Microsoft.JavaScript.NodeApi/
36. Jint：https://github.com/sebastienros/jint ；ClearScript：https://www.nuget.org/packages/Microsoft.ClearScript.Complete
37. Windows App SDK 2.0 release notes：https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-2-0 ；Releases：https://github.com/microsoft/WindowsAppSDK/releases
38. Windows Latest，WinUI 开源时间线（2026-10-31）：https://www.windowslatest.com/2026/10/31/one-reason-windows-11-has-so-many-web-apps-winui-still-lacked-basic-features-and-thats-finally-changing/
39. Microsoft Q&A，How to make WinUI 3 window transparent：https://learn.microsoft.com/en-sg/answers/questions/1463839/how-to-make-winui-3-window-transparent ；Semi Transparent Window + Click through Window：https://learn.microsoft.com/en-us/answers/questions/1418063/(winui3)-semi-transparent-window-click-through-win ；Visual layer 文档：https://learn.microsoft.com/windows/apps/windows-app-sdk/composition
40. WinUI 3 / WPF 空应用启动对比（日文）：https://zenn.dev/suusanex/articles/f642d91df412c9 ；Neowin，微软测试原生应用性能：https://www.neowin.net/news/microsoft-testing-native-windows-11-app-performance-with-impressive-early-results/ ；PCWorld，Microsoft admits its Windows 11 apps hog RAM：https://www.pcworld.com/article/3199779/microsoft-admits-its-windows-11-apps-hog-ram-a-fix-is-coming.html
41. Microsoft Q&A，Xamarin.Mac 到 MAUI Mac Catalyst 的差异：https://learn.microsoft.com/en-us/answers/questions/1080318/going-from-xamarin-mac-to-net-maui-mac-catalyst-di ；dotnet/maui Releases：https://github.com/dotnet/maui/releases ；Microsoft.Maui.Platforms.MacOS：https://www.nuget.org/packages/Microsoft.Maui.Platforms.MacOS/
42. Uno Platform 7.0（2026-11-12）：https://platform.uno/blog/uno-platform-7-0/ ；Native AOT：https://platform.uno/docs/articles/features/native-aot.html
43. Compose Multiplatform Releases：https://github.com/JetBrains/compose-multiplatform/releases ；1.10.0 发布（Hot Reload 稳定）：https://blog.jetbrains.com/kotlin/2026/01/compose-multiplatform-1-10-0/
44. Kotlin Slack 存档：Compose 写插件 https://slack-chats.kotlinlang.org/t/2932344/can-i-write-plugins-using-compose-like-being-able-to-add-a-j ；AOT 缓存 PR 讨论 https://slack-chats.kotlinlang.org/t/34186722/https-github-com-jetbrains-compose-multiplatform-pull-5644-p ；透明 / focusable 窗口 https://slack-chats.kotlinlang.org/t/18879114/hey-i-m-building-a-desktop-application-that-i-want-to-displa
45. PF4J：https://github.com/pf4j/pf4j
46. JavaFX 26：https://inside.java/2026/03/25/javaone-javafx/ ；https://jdk.java.net/javafx26/
47. Zipline：https://github.com/cashapp/zipline ；Redwood：https://github.com/cashapp/redwood ；Native UI and multiplatform Compose with Redwood：https://code.cash.app/native-ui-and-multiplatform-compose-with-redwood
48. React Native Windows v0.85：https://devblogs.microsoft.com/react-native/react-native-windows-v0-85-is-here/ ；Visual Studio Magazine（2026-10-27）：https://visualstudiomagazine.com/articles/2026/10/27/react-native-windows-0-85-removes-legacy-architecture.aspx ；Releases：https://github.com/microsoft/react-native-windows/releases
49. React Native macOS：https://github.com/microsoft/react-native-macos ；Releases：https://github.com/microsoft/react-native-macos/releases
50. React Native Windows，New vs. Old Architecture：https://microsoft.github.io/react-native-windows/docs/new-architecture
51. Who's using React Native for Desktop：https://microsoft.github.io/react-native-windows/resources-showcase ；Office 与 React Native（2025-05-09）：https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize
52. TechCrunch，Facebook Messenger's desktop app is no more（2025-12-15）：https://techcrunch.com/2025/12/15/facebook-messengers-desktop-app-is-no-more/ ；AppleInsider：https://appleinsider.com/articles/25/12/15/facebook-messenger-for-macos-departs-the-desktop
53. Re.Pack 5：https://www.callstack.com/blog/announcing-re-pack-5-with-rspack-module-federation
54. 第三方项目把 macOS 应用迁到 RN 新架构的 PR：https://github.com/krishkalaria12/bay/pull/2
55. Slint Releases：https://github.com/slint-ui/slint/releases ；Slint 1.17：https://slint.dev/blog/slint-1.17-released
56. Slint Window 参考：https://docs.slint.dev/latest/docs/slint/reference/window/window/ ；SystemTrayIcon：https://docs.slint.dev/latest/docs/slint/reference/window/systemtrayicon/
57. Slint Node.js 文档：https://docs.slint.dev/latest/docs/node/ ；slint-interpreter：https://docs.rs/slint-interpreter/
58. Slint，Making Slint Desktop-Ready（2025-10-09）：https://slint.dev/blog/making-slint-desktop-ready
59. Slint LICENSE：https://github.com/slint-ui/slint/blob/master/LICENSE.md ；价格页：https://slint.dev/pricing
60. How I took my Rust GUI from 135 MB to 30 MB by ditching the GPU：https://dev.to/trystan_sarrade/how-i-took-my-rust-gui-from-135-mb-to-30-mb-by-ditching-the-gpu-2i7d ；Slint 讨论 #6718：https://github.com/slint-ui/slint/discussions/6718
61. Dioxus Releases：https://github.com/DioxusLabs/dioxus/releases ；Blitz：https://github.com/DioxusLabs/blitz
62. egui ViewportBuilder：https://docs.rs/egui/latest/egui/viewport/struct.ViewportBuilder.html ；egui#4458：https://github.com/emilk/egui/issues/4458 ；iced Releases：https://github.com/iced-rs/iced/releases
63. Lynx 3.7：https://lynxjs.org/blog/lynx-3-7 ；InfoQ 开源报道（2025-03）：https://www.infoq.com/news/2025/03/tiktok-lynx-cross-platform-apps ；Lynx Releases：https://github.com/lynx-family/lynx/releases ；Lynxtron：https://github.com/lynx-family/lynxtron
64. Valdi：https://github.com/Snapchat/Valdi ；ROADMAP：https://github.com/Snapchat/Valdi/blob/main/ROADMAP.md
65. Vercel Labs Native SDK：https://github.com/vercel-labs/native
66. Sciter 列表页：https://sourceforge.net/software/product/Sciter/ ；已归档的 SDK 仓库：https://github.com/c-smile/sciter-js-sdk
67. Raycast，How the Raycast API and extensions work（2023-05-31）：https://www.raycast.com/blog/how-raycast-api-extensions-work
68. Raycast，A Technical Deep Dive Into the New Raycast（2026-05-14）：https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
69. Raycast 开发者 FAQ：https://developers.raycast.com/faq ；安全说明：https://developers.raycast.com/information/security ；Windows 2.0 更新日志：https://www.raycast.com/changelog/windows/2-0
70. Microsoft Learn，How Command Palette extensions work：https://learn.microsoft.com/en-us/windows/powertoys/command-palette/extensibility-overview
71. VS Code，Extension Capabilities Overview：https://code.visualstudio.com/api/extension-capabilities/overview ；Webview API：https://code.visualstudio.com/api/extension-guides/webview
72. Theia，Extensions and Plugins：https://theia-ide.org/docs/extensions ；Releases：https://github.com/eclipse-theia/theia/releases
73. Zed 扩展体系说明（转述页）：https://www.plushcap.com/content/zed/blog/life-of-a-zed-extension-rust-wit-wasm ；开发者评述：https://dev.to/tunadev0/zed-is-amazing-i-hate-it-5aob
74. IntelliJ Platform，Dynamic Plugins：https://plugins.jetbrains.com/docs/intellij/dynamic-plugins.html
75. Sublime Text，API Environments：https://www.sublimetext.com/docs/api_environments.html
76. Blender，Python API Overview：https://docs.blender.org/api/3.2/info_overview.html
77. Figma，How to build a plugin system on the web and also sleep well at night：https://www.figma.com/blog/how-we-built-the-figma-plugin-system/ ；How Plugins Run：https://developers.figma.com/docs/plugins/how-plugins-run
78. Multi，Nailing the activation behavior of a Spotlight / Raycast-like command palette：https://multi.app/blog/nailing-the-activation-behavior-of-a-spotlight-raycast-like-command-palette
79. KMPClock（Compose 透明、无装饰、置顶窗口示例）：https://github.com/CostaFot/KMPClock
