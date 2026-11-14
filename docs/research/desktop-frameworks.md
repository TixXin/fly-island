# 哪些桌面框架能做「万物皆插件」

> 日期：2026-11-14。问题：除了现在用的 Tauri，还有哪些桌面框架（只看 Windows 和 macOS）能实现浮屿的「万物皆插件」架构（[v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)），各自的优缺点。范围：三十多个框架和做法，分两路调研，详细材料和全部来源在 [网页技术类](desktop-frameworks-web.md)（75 条来源）和 [原生界面类](desktop-frameworks-native.md)（79 条来源）；Tauri、MyGo、GPUI 用的是之前的调研（[技术可行性](plugin-host-feasibility.md)、[MyGo 和 Tauri](mygo-vs-tauri.md)）。**全部是读文档、源码和别人的测量，没有自己实测**；内存数字口径不一，只能看趋势。

## 结论

- **没有哪个框架能同时做到全部要求**：运行时加载 JS 插件、插件能改任何界面、常驻后台的插件宿主、悬浮岛窗口、顺手的系统接口、低内存、两个系统都成熟。每条路都要放弃至少一样。
- **真正可选的只有四条路**，按建议程度排：

| # | 路线 | 一句话 | 要放弃的 |
|---|---|---|---|
| 1 | **留在 Tauri**（现方案） | 不用重写；插件宿主放隐藏的 WebView | 要自己绕开隐藏窗口降速、自己写加载器 |
| 1b | **留在 Tauri，宿主改成独立的 Node 或 Bun 进程** | 这次调研新冒出来的选项：隐藏窗口降速的问题直接消失，Cordis 的加载器和热重载能原样用，插件的后台部分能用 npm | 多带一个运行时：安装包变大，多一份内存，多签一个程序 |
| 2 | **换 Electron** | 唯一把每条要求都做成了正式功能的框架，DeepSeek Harness 桌面版就是这么做的 | 内存不降（Mac 上更高）、安装包多约 80–100 MB、Rust 层全部搬家 |
| 3 | **换原生界面**（Qt / QML，或 React Native 桌面） | 可能省内存 | 整个应用重写；Qt 要放弃 React 和 npm，React Native 平台风险最高 |

- **建议**：留在 Tauri。第 0 阶段多加一项对照：同一个演示插件，分别用「隐藏 WebView 宿主」和「独立 Bun / Node 进程宿主」跑，量内存和稳定性，再决定宿主放哪。
- **两条对预期的修正**：
  - **换 Electron 省不了内存**。浮屿的 330 MB 来自 WebView2，而 WebView2 本身就是 Chromium。别人的空应用基准里，Windows 上 Electron 约 279 MB、Tauri 约 312 MB，在同一水平；macOS 上 Electron 约 370 MB，Tauri 约 96 MB。
  - **「原生渲染 + JS 插件」的开创者自己退出了**。Raycast 在 2026 年 5 月的 2.0 里放弃原生渲染，改成原生外壳加系统 WebView 加常驻 Node 后端，结构和浮屿现在几乎一样；它说内存从 200–300 MB 涨到 350–450 MB，认为值得，理由是两套原生界面「两倍的工作，却不会更快」。

## 用什么标准比

第 3 版方案的要求，拆成七条：

| # | 要求 | 为什么难 |
|---|---|---|
| R1 | 运行时加载第三方 JS / TS 插件 | 编译型的界面框架（Rust、Go、Dart）做不到 |
| R2 | 插件能往任何窗口加、换界面 | 需要界面本身是运行时可组合的（DOM、QML、React Native） |
| R3 | 窗口都隐藏时插件宿主照常运行 | 隐藏的 WebView 会被降速或挂起；窗口之外有 JS 运行时的框架没有这个问题 |
| R4 | 悬浮岛窗口：透明、无边框、置顶、不抢焦点、点击穿透、贴合刘海 | 多数框架要自己补原生代码 |
| R5 | 大量系统接口：WinRT 媒体和通知、UI 自动化、截屏、AppKit | 取决于宿主语言 |
| R6 | 闲置内存低 | 取决于渲染引擎 |
| R7 | 两个系统都成熟：有人长期维护、签名和自动更新现成 | 新框架普遍不满足 |

## 总表

✔ 框架本身支持；△ 能做但要自己写不少或有明显限制；✘ 做不到或不现实；？ 没查到可靠资料。

| 框架 | R1 运行时 JS 插件 | R2 改任何界面 | R3 窗口外的宿主 | R4 悬浮岛 | R5 系统接口 | R6 内存 | R7 成熟度 | 迁移代价 |
|---|---|---|---|---|---|---|---|---|
| **Tauri 2**（现在） | ✔ 在 WebView 里 | ✔ | ✘ 只有 WebView；或自带独立进程 | △ Mac 上靠第三方库 | ✔ Rust | Win 约 330 MB（实测）；Mac 低 | 高 | 无 |
| **Electron** 45 | ✔ | ✔ | ✔ Node 主进程 / 工具进程 | ✔ 有面板窗口、穿透；刘海要自己做 | △ N-API 原生扩展 | Win 同级；Mac 明显更高；安装包约 85–106 MB | 最高 | Rust 层搬到 N-API，命令全部改写 |
| **Wails** 3.1 | ✔ 在 WebView 里 | ✔ | ✘ Go | ✔ **最全**：内建面板和刘海窗口 | △ Go + cgo | 同 Tauri | 中：v3 2026-10 才转正 | Rust 改写成 Go |
| **MyGo** 0.9 | ✔ 在 WebView 里 | △ 原生界面部分不能 | ✘ Go | ✔ 面板、区域穿透 | △ 不用 cgo 的 Go | 原生界面约 44 MB（自述）；网页同 Tauri | 低：7 周 | Rust 改写成 Go |
| **Electrobun** 2.0 | ✔ | ✔ | ✔ Bun | △ 无面板；**只支持 Windows 11** | △ FFI | ？ | 低：一个人维护 | 全部 |
| **Deno 桌面** | ✔ | ✔ | ✔ Deno | △ 透明、穿透没文档 | △ FFI | 低（别人测的 Mac 约 98 MB） | 低：官方标实验；Windows 没有自动更新 | 全部 |
| **NW.js** | ✔ | ✔ | ✔ Node | △ | △ | 最高（Win 约 618 MB） | 中 | 全部 |
| **Qt 6 + QML** | △ QML 里的 JS，没有 npm 和 React | ✔ | ✔ 进程内 | ✔ Mac 上补一点原生代码 | ✔ C++ | 45–180 MB（零散、偏旧） | 高 | 整个应用重写 |
| **React Native** Windows + macOS | ✔ | ✔ 原生渲染 | ✔ 进程内的 Hermes，没有 Node 接口 | △ 全靠自己写，没有先例 | ✔ 原生模块 | ？ | 中 / 中低 | 界面全部重写，窗口层写两遍 |
| **Avalonia**（.NET） | △ .NET 插件为主，JS 没有先例 | △ | ✔ 进程内 | Win ✔；Mac △ | Win ✔；Mac △ | ？ | 高 / 中 | 整个应用重写 |
| **两套原生外壳 + 共享 JS 引擎** | ✔ | ✘ 只能「插件描述、宿主来画」 | ✔ | ✔ 最好 | ✔ 最好 | 外壳约 40 MB；带 Node 时 200–300 MB | 高，但要做两遍 | 整个应用重写两遍 |
| **Slint** | △ | ✘ 描述式 | — | △ | ✔ Rust，现有代码能留 | 30–54 MB（个例） | 中 | 界面重写 |
| **Flutter** | ✘ 不能运行时加载 Dart | ✘ | — | △ 多窗口还是实验 | △ | 60–113 MB（2021 年） | 中 | 整个应用重写 |
| **GPUI** | ✘ | ✘ | — | ？ | ✔ Rust | 低 | 中 | 界面重写 |

出局的（原因见两份详细材料）：Socket Runtime（已废弃）、Neutralinojs（每个窗口一个进程）、Photino、Sciter、直接用 CEF / Saucer / webview 库（是库不是框架）、.NET MAUI（Mac 上拿不到完整的 AppKit）、Uno、JavaFX、Compose 桌面（JVM 内存不省、系统接口最难用）、egui、Iced、Lynx（桌面版还没正式发布）、Theia / Code-OSS（是 IDE 外壳）。

## 四条路分别说

### 1. 留在 Tauri

好处是不用重写，现有的 Rust 层和 Mac 适配都留着。问题是它没有「窗口之外的 JS 运行时」，所以方案把插件宿主放在一个隐藏的 WebView 里，由此带来三件要自己解决的事（都在方案里了）：隐藏窗口被降速、通信不能用 `emit`、Cordis 的加载器用不了要自己写。

### 1b. 留在 Tauri，宿主改成独立的 Node 或 Bun 进程

这次调研最有用的一个发现：**Cordis 的加载器和热重载是照着 Node 写的**，要用到 Node 内部的模块加载器；放进 WebView 就得自己重写（方案里已经这么写了），放进真正的 Node 里就能原样用。DeepSeek Harness 的桌面版正是「Electron 外壳 + 一个按 Node 方式运行的子进程跑 Cordis 宿主」。

把同样的做法搬到 Tauri：浮屿带一个 Node 或 Bun，作为子进程跑插件宿主，窗口里只放界面。

| 好处 | 代价 |
|---|---|
| 宿主不在 WebView 里，降速和挂起的问题没有了，不需要看门狗去重建宿主窗口 | 安装包多几十 MB（一个运行时） |
| Cordis 的加载器、热重载原样用（Node 上；Bun 上要重写，这是从源码推断的） | 多一份内存：Raycast 说空的 Node 进程约 12 MB，但它们带着扩展用起来后是 150–200 MB |
| 插件的后台部分能用 npm 生态和 Node 接口（文件、进程、网络），不用我们逐个包成服务 | Mac 上多签名、公证一个程序；要自己管这个进程的启动、崩溃和通信 |
| 插件作者写的后台代码在两个系统上是同一个引擎 | 界面部分仍在 WebView 里，两个系统的 WebView 差异还在 |

方案里用户已经定了「宿主是隐藏的 WebView」（决定 4），当时没有「Cordis 加载器依赖 Node」和「隐藏窗口降速」这两条信息。建议不直接改决定，而是在第 0 阶段把两种宿主各跑一遍，看实测的内存和稳定性再定。

### 2. 换 Electron

它是唯一把七条要求都做成正式功能的：Node 主进程当宿主、隐藏窗口不降速是一个开关、Mac 上有面板窗口类型、有点击穿透、签名和自动更新成熟。VS Code、Obsidian、DeepSeek Harness 桌面版的插件系统都建在它上面。

真的省事的：宿主是现成的；Cordis 直接能跑；两个系统是同一个 Chromium，插件作者不用适配两种 WebView。

没省事或更差的：

- 内存不降，Mac 上会涨（见结论）。
- 安装包从几 MB 变成约 85–106 MB，更新包也跟着变大。
- 约 6.8 万行 Rust 要包成原生扩展或者留作子进程，325 个命令全部改写。
- 每 8 周一个大版本，要一直跟。
- 界面那一半（运行时加载、共用 React、插槽）并没有因为 Electron 变简单。
- 现有用户从 Tauri 的更新器换到 Electron 的更新器，要设计一个过渡版本。

值不值：如果最看重的是「插件平台做起来稳、有现成的先例可以对照」，Electron 是最稳的；如果看重内存和安装包大小，不该为了插件系统换过去。1b 能拿到 Electron 在宿主这一半的大部分好处，而不用搬家。

### 3. 换原生界面

三种做法：

- **Qt 6 + QML**：唯一成熟、而且天生支持「运行时加载声明式界面 + JS、改任何界面」的原生方案。代价是整个应用重写，插件作者写 QML 而不是 React，没有 npm。实际内存要做小样才知道。
- **React Native Windows + macOS**：唯一能让「JS / React 插件 + 任何界面 + 原生渲染」同时成立的。但悬浮岛的窗口层在两个系统上都要自己写原生代码，没有先例；两个分支版本不同步；找不到任何内存数据。Raycast 评估后否决了它。
- **插件描述界面、宿主来画**（Raycast 旧版的做法）：行得通，但和「内置功能也是插件、能换掉任何界面」冲突。歌词滚动、日历、截图标注、笔记编辑器用一小套固定组件表达不了；要表达就得把组件做到「盒子、文字、图片、手势、动画」这一层，等于自己写一套 React Native，还要写两遍。而且要省内存就不能带 Node，只能用嵌入的 JS 引擎，那就没有 npm。

## 建议

1. **框架不换**，第 3 版按现方案在 Tauri 上做。
2. **第 0 阶段加一项对照**：隐藏 WebView 宿主对独立进程宿主（Bun 和 Node 各试一下），量内存、冷启动和连续运行的稳定性。结果出来后再确认或修改决定 4。
3. **从别的框架搬三样东西**（不依赖换框架）：Wails v3 的刘海窗口和面板做法、MyGo 的后台不降速参数和按区域穿透、Electron 的「同站子窗口共用渲染进程」思路（少开渲染进程才是降内存的正路）。
4. **以下情况出现时重新评估**：Electrobun 或 Deno 桌面版成熟（它们是「有窗口外 JS 运行时、又用系统 WebView」的方向）；React Native 桌面有了可靠的窗口封装和内存数据；浮屿的内存成了用户最主要的抱怨。

## 没有核实的

- 所有内存数字都不是在浮屿上测的；Qt、Flutter、Slint 的数字是 2021 年前后的个例。
- Node 或 Bun 作为插件宿主时的常驻内存。
- Cordis 的加载器在 Bun、Deno 上是否真的不能用（结论来自读源码）。
- Electron 上贴合刘海的成熟做法；React Native 桌面上透明、不抢焦点的窗口能不能做。
- 两份详细材料的末尾各有一份完整的未核实清单。

## 来源

- 网页技术类的 75 条来源：[desktop-frameworks-web.md](desktop-frameworks-web.md)「来源」
- 原生界面类的 79 条来源：[desktop-frameworks-native.md](desktop-frameworks-native.md)「来源」
- Tauri 的依据：[plugin-host-feasibility.md](plugin-host-feasibility.md)、[memory-and-performance.md](memory-and-performance.md)、[idle-usage.md](../investigations/idle-usage.md)
- MyGo：[mygo-vs-tauri.md](mygo-vs-tauri.md)
- 最常引用的几条：
  - Elanis 的框架基准（空应用内存和体积，2026-11 更新）：https://github.com/Elanis/web-to-desktop-framework-comparison
  - Raycast 2.0 的技术说明（2026-05-14）：https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
  - DeepSeek Harness 桌面版用 Electron 当 Node 运行时的设计记录：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/.agents/notes/archived/architecture/2026-09-11-desktop-electron-node-runtime
  - Cordis 源码：https://github.com/cordiverse/cordis
