# MyGo 和 Tauri：做「万物皆插件」用哪个框架

> 日期：2026-11-14。问题：最近很火的 MyGo（Go + WebView，也能和原生界面共存）如果拿来从头做浮屿的「万物皆插件」架构（[v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)），和 Tauri 比各有什么优缺点。范围：`egoist/mygo` 仓库的 README、`docs/architecture.md`、`windows.md`、`plugins.md`、`native-modules.md`（main 分支，2026-11-14 读）、GitHub 上的仓库数据、`egoist/mygo-music` 的 README；Tauri 一侧用的是本仓库已有的调研和实测。**没有用 MyGo 写过一行代码**，下面关于它的说法都来自它自己的文档，没有实测。

## 结论

- **MyGo 是真的好，而且有几样正好是浮屿要的**：常驻后台页面不降速的开关（三个系统都做了）、Spotlight 式的面板窗口、按区域点击穿透、「不可信页面」这个内建概念、在任何一台电脑上交叉编译所有系统的安装包、以及不用 WebView 的原生界面（一个小窗口闲置约 44 MB，浮屿现在约 330 MB）。
- **但它太新**：仓库 2026-09-26 才建，到今天 7 周；v0.9.0，还没到 1.0；30 个贡献者里一个人写了绝大部分；109 个未关闭的 issue；原生模块标着「实验，任何版本都可能不兼容地改」。Tauri 2 已经稳定了两年。
- **换框架救不了「万物皆插件」里最难的部分**：插件是运行时加载的 JS，Go 和 Rust 一样不能热插拔原生代码，所以插件的宿主、服务、插槽、市场、审核这些都要照样自己做。MyGo 省的是框架层的麻烦（后台降速、通信、窗口），不是架构本身。
- **换过去的代价是重写**：约 6.8 万行 Rust（其中大量 Win32 / WinRT / macOS 接口）要改写成不用 cgo 的 Go，这部分在 Go 里比在 Rust 里难写。
- **建议：第 3 版继续用 Tauri**，把 MyGo 做对了的几样搬过来（见「能直接借鉴的」）。如果以后最在意的是内存，MyGo 的「原生界面的岛 + WebView 的插件页」是比 GPUI 更现实的一条路，值得等它到 1.0 后花两三天做个岛屿小样再评估。

## MyGo 是什么

| | |
|---|---|
| 仓库 | [egoist/mygo](https://github.com/egoist/mygo)，MIT |
| 一句话 | 用 Go 写桌面应用，窗口里可以是网页，也可以是它自己画的原生界面，两种能混用 |
| 热度 | 6236 star、388 fork（2026-11-14）；建于 2026-09-26 |
| 版本 | v0.9.0（2026-11-11）；v0.8.0 到 v0.9.0 隔了 5 天 |
| 维护 | 30 个贡献者，egoist 912 次提交，其次是 `claude` 91 次；109 个未关闭的 issue |
| 要求 | Go 1.27.3 以上；网页前端的项目另要 Bun（只在开发时用） |

要点（都来自它的文档 [1][2]）：

- **纯 Go，不用 cgo**：系统接口在运行时通过 purego（macOS、Linux）和 `syscall`（Windows）调用。好处是任何一台电脑都能交叉编译所有系统的版本。
- **两种窗口**：网页用系统自带的 WebView（WKWebView、WebView2、WebKitGTK）；原生界面由 MyGo 自己用 Metal / Direct3D 11 / OpenGL 画，写法是「界面是状态的函数」，全用 Go。原生界面里还能嵌网页。
- **类型化的通信**：前端调 Go 的代码是从 Go 代码生成的 TypeScript；有带流量控制的通道和类型化事件。
- **桌面接口很全**：窗口、菜单、托盘、对话框、通知、全局快捷键、深链接、文件关联、正在播放和媒体键、文件监视、系统强调色。
- **打包发布内建**：安装包、签名、公证、带增量的自动更新。
- **插件**：指的是「编译进应用的功能模块」（Go 一半、JS 一半，`mygo.Use(...)`），不是用户运行时安装的第三方插件 [3]。
- **原生模块**（实验）：用 Go 声明接口，用 Swift、Rust 或 Zig 实现，MyGo 生成两边的胶水 [4]。

## 逐项对比

对着第 3 版方案里的每个要求看：

| 方案里的要求 | Tauri 2 | MyGo | 谁更合适 |
|---|---|---|---|
| **隐藏的宿主窗口一直跑** | macOS 有 `backgroundThrottling`；Windows 没有开关，要自己给 WebView2 加启动参数，实际效果没人测过（方案第 0 阶段要测） | 内建 `BackgroundThrottling: ThrottlingOff`，三个系统都做了：macOS 关掉挂起和定时器降速，Windows 给 WebView2 加三个启动参数，Linux 关掉 WebKitGTK 的对应功能 [2] | **MyGo** |
| **宿主和窗口通信、不泄漏** | `emit` 和 `Channel` 都有收不回的泄漏；要绕到 `BroadcastChannel` 和 `invoke` 长轮询 | Go 发给页面的消息每轮主循环合并成一次 `__mygo.receive([...])` 执行；通道带流量控制 [1]。它在 WebView2 上会不会踩到同一个泄漏，文档没说，**未核实** | 不确定 |
| **插件界面的页面和应用隔开** | Tauri 给每个 webview 都注入命令通道，所以第 2 版只能自己另建 WebView2 | 内建「不可信页面」：`PageOptions.Untrusted` 的页面调不了 Go，文档写明是给「从自定义协议提供的插件界面」用的 [1] | **MyGo**（但第 3 版选了同权插件，用不上） |
| **悬浮岛的窗口** | 透明、无边框、置顶都有；不抢焦点的面板在 Mac 上要靠 `tauri-nspanel`；点击穿透是整窗的，浮屿自己用 12 ms 的循环判断鼠标位置 | 内建面板（浮在所有应用和全屏之上、不进任务栏、Mac 上不激活应用）；`SetInputRegion` 按矩形区域接收鼠标，其余穿透；飞出窗口、毛玻璃 [2] | **MyGo** |
| **内存** | 全在 WebView2：浮屿闲置约 330 MB | 网页窗口同样要 WebView 的内存；原生界面的窗口不起 WebView 进程，文档说小窗口闲置约 44 MB（macOS）[1] | **MyGo**，前提是岛屿用原生界面画 |
| **插件能往界面里加任何东西** | 界面是 React，插件直接往插槽里放组件 | 网页窗口同上。原生界面是编译进去的 Go，运行时加载的 JS 插件放不了组件，只能给数据让应用画（mygo-music 的插件就是这样 [5]），或者嵌一块网页 | **Tauri**（如果界面要「万物皆可改」） |
| **插件跑在哪** | 一个隐藏的 WebView（方案） | 同样需要一个 JS 运行时：隐藏的网页，或者在 Go 里嵌一个 JS 引擎（省掉一个 WebView 进程，但引擎的兼容性和速度要另外评估）。Go 自己的 `plugin` 包不支持 Windows，原生代码一样不能热插拔 | 平 |
| **调系统接口** | Rust 的 `windows` crate 和 `objc2` 是一等公民，浮屿 6.8 万行都建在上面 | 不用 cgo，Win32 要手写 `syscall`，WinRT（媒体控制、通知监听）和 COM 更费劲；或者用实验性的原生模块把 Rust 包进去 | **Tauri** |
| **打包和发版** | Windows 安装包要在 Windows 上构建（任务 D37 还没解决）；更新、签名有插件 | 任何电脑交叉编译全部系统；签名、公证、增量更新内建 [1] | **MyGo** |
| **自动化测试** | 回归页在浏览器里跑；真岛靠人看 | 有 Automation 插件：外部进程能驱动运行中的应用（窗口、输入、截图），给端到端测试和 AI 代理用 [3] | **MyGo** |
| **成熟度** | 2.x 稳定，生态大，做过安全审计，问题多半有现成答案 | 7 周，0.9，接口还在变，一个人主导 | **Tauri** |
| **Linux** | 支持，浮屿没做 | 支持 | 平（浮屿不需要） |

## 两种情形分开说

### 如果浮屿今天才开始做

MyGo 很有吸引力：岛屿这种小而常驻的窗口正是它的原生界面最擅长的（闲置内存约是 WebView 的七分之一），面板窗口、区域穿透、后台不降速都是现成的，发版不用第二台电脑。

但「万物皆插件」会被改成另一个样子：岛屿用原生界面的话，插件不能随意改界面，只能像 mygo-music 那样「插件给数据、应用来画」，或者插件的页面用嵌入的网页。那更像 VS Code 的贡献点，不是 DeepSeek Harness 的「什么都能换」。想要后者，就得整个界面都用网页，MyGo 的内存优势就没了，剩下的优势是框架层更省心。

还有一个不能忽略的风险：把一个要用很多年的产品建在 7 周大的框架上。它迭代很快（5 天一个小版本），这既是优点也是代价。

### 浮屿已经在 Tauri 上（实际情况）

| 要付出的 | 说明 |
|---|---|
| 重写 Rust | 约 6.8 万行，325 个命令。媒体控制（SMTC）、QQ 通知监听（WinRT）、UI 自动化、截图（ScreenCaptureKit）、剪贴板这些，在不用 cgo 的 Go 里都要手写调用，没有现成的绑定可靠到能直接用。或者用原生模块把现有 Rust 包进去，但那是实验功能 |
| 重做 Mac 适配 | G1 这一轮在 `objc2` 上做的全部重来 |
| 重做发布流程 | 更新端点、`latest.json`、签名都是对外契约 |
| 插件平台照样要做 | 宿主、服务、插槽、市场、审核一样不少 |

换来的是：第 0 阶段里两三项风险不用自己验证、发版更省事、以后有机会把岛屿换成原生界面省内存。这笔账现在不划算。

## 能直接借鉴的

不换框架也能拿来用的做法：

1. **Windows 上让隐藏窗口不降速**：给 WebView2 加 `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` [2]。Tauri 的窗口配置有 `additionalBrowserArgs`。注意 MyGo 文档里的提醒：这些参数属于整个 WebView2 环境，要在第一个窗口创建时就给，所有窗口必须一致。这直接回答了方案第 0 阶段的一项。
2. **macOS 上关掉的不只是挂起**：MyGo 还关了隐藏页面的定时器降速、CSS 动画暂停、进程抑制和窗口遮挡检测（部分是 WebKit 的私有设置）[2]。Tauri 的 `backgroundThrottling` 只管第一项，这可能就是「即使关了定时器仍是每秒一次」的原因，第 0 阶段可以照着试。
3. **事件等页面准备好再发**：发给窗口的事件在页面报告 DOM 就绪前先存着（每窗口上限 1024 条），每次导航重置 [1]。方案的通信协议可以照做，替代「握手 + 快照」里的一部分。
4. **通道的流量控制**：每半 MiB 要一次确认，超过 1 MiB 没确认就等 [1]。宿主往窗口推大量数据时用得上。
5. **每个窗口一个随机密钥**，消息带上它，防止页面里别的来源的 iframe 冒充 [1]。
6. **按区域穿透**（`SetInputRegion`）：浮屿现在用循环判断鼠标位置，可以改成把岛屿的形状作为输入区域交给系统（Windows 上是窗口区域，Mac 上要自己做命中测试）。这是独立于插件平台的优化。
7. **插件清单里的联网白名单**：mygo-music 的 `permissions.network` 列域名 [5]，和方案里的 `network` 字段是同一个思路。

## 什么时候重新评估

- MyGo 发 1.0，并且原生模块不再标「实验」。
- 浮屿的内存成了用户最主要的抱怨，而 WebView2 那边的优化（D47–D52）做完仍不够。
- 出现一个用 MyGo 做的、和浮屿同类（常驻、悬浮、多窗口、调很多系统接口）的成熟应用，可以对照。

到时先做两三天的小样：只做岛屿窗口（原生界面）加一个嵌入的插件网页，在 Windows 和 Mac 上量内存、看刘海贴合和展开动画。

## 未核实

- MyGo 在 WebView2 上往页面发消息用的是哪个接口、会不会有 `emit` 那样的泄漏。
- 文档里的内存、CPU、包大小数字都是它自己的测量，没有复测。
- mygo-music 的 JS 插件跑在什么引擎里（它没有 WebView）。
- MyGo 的 WebView2 和 WKWebView 封装在长时间运行下的稳定性。

## 来源

1. MyGo 架构文档：https://github.com/egoist/mygo/blob/main/docs/architecture.md
2. MyGo 窗口文档（面板、点击穿透、后台页面）：https://github.com/egoist/mygo/blob/main/docs/windows.md
3. MyGo 插件文档：https://github.com/egoist/mygo/blob/main/docs/plugins.md
4. MyGo 原生模块文档：https://github.com/egoist/mygo/blob/main/docs/native-modules.md
5. MyGo Music（插件的做法）：https://github.com/egoist/mygo-music
6. MyGo 仓库和 README：https://github.com/egoist/mygo
7. MyGo 网站：https://mygo.egoist.dev/
8. Tauri 一侧的依据：[技术可行性调研](plugin-host-feasibility.md)、[内存与性能](memory-and-performance.md)、[idle-usage.md](../investigations/idle-usage.md)
