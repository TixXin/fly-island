# 插件平台第 3 版的技术可行性：隐藏宿主窗口、窗口间通信、运行时加载模块

> 日期：2026-11-14。问题：第 3 版方案里的技术假设成不成立：隐藏的 WebView 能不能一直跑、窗口之间不用 `emit` 怎么通信、运行时加载插件代码和共用 React、Cordis 能不能在 WebView 里跑、单个插件的资源怎么统计。范围：tauri 2.12.5、wry 0.57.2、cordis、koishi webui 的源码，Tauri / wry / WebView2 / WebKit 的官方 issue 和文档，少量第三方实测；**没有在真机上跑测试**，要实测的列在第 8 节。相关方案：[v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)。

> 日期：2026-11-14。环境假设：Tauri 2.12.5、wry 0.57.2、webview2-com 0.39.1（本机 `~/.cargo/registry` 里的源码就是这几个版本，下文「读源码」指它们），Windows 用 WebView2，macOS 15+ 用 WKWebView。
>
> 证据分四级，正文里逐条标注：
> - **源码**：直接读了 tauri / wry / cordis / koishi webui 的源码。
> - **官方**：官方文档、官方仓库的 issue / PR。
> - **第三方实测**：别的项目的 issue / PR 里写的测量结果，没有官方背书，要自己复测。
> - **未核实**：没找到可靠来源，或只有搜索摘要。
>
> 没有在真机上跑任何测试；所有「要实测」的地方在第 8 节汇总。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 隐藏的宿主窗口能一直跑 JS 吗 | macOS 14+ 必须设 `backgroundThrottling: "disabled"`，否则几分钟后整页被挂起；设了之后不挂起，但定时器仍可能被压到约 1 次/秒、`requestAnimationFrame` 不触发。Windows 上 Tauri 没有对应开关，默认行为未核实，要实测并准备浏览器启动参数 |
| 窗口之间用 BroadcastChannel | Windows 已在本仓库原型里实测可用；macOS 从 WebKit 的实现看应当可用，但没有找到 Tauri 上的正式确认，要实测。MessagePort 在互不相识的窗口之间建不起来；SharedWorker 不建议用 |
| `emit` 泄漏 | 仍未修（tauri#12724、wry#1489 都开着，已报给微软 WebView2Feedback#5780，微软没回复）。**`Channel` 同样会泄漏**（每条消息也是执行一段内容不同的脚本）。只有 `invoke` 的回应（走 `ipc://` 的 fetch）不执行脚本 |
| 运行时 `import()` 插件模块 | 可行，但插件协议和页面不同源，协议必须自己回 CORS 头和 JS 的 MIME；React 共享不要依赖 import map，用宿主提供的垫片模块更稳 |
| 热重载 | 浏览器的模块表删不掉，只能换 URL；每次重载留下一份旧模块，只在开发模式可接受 |
| Cordis 4 在浏览器里跑 | 内核可以（核心包没有 Node 内置模块）；loader / hmr / include 全是 Node 的，要自己写浏览器版加载器。API 明确写着不稳定 |
| 每个插件的 CPU | 包回调计时可行，是唯一两个平台都能用的办法；内存按插件分不出来 |
| React 插槽隔离 | 错误边界能隔离渲染期的崩溃，隔离不了事件处理、异步代码和死循环 |

## 1. 隐藏的、从不显示的 WebView 里 JS 还跑不跑

### 1.1 Tauri 的 `backgroundThrottling`

- 配置项 `backgroundThrottling`（窗口配置）和 `WebviewWindowBuilder::background_throttling`，取值 `disabled` / `throttle` / `suspend`，Tauri 2.3.0 加入 [8][10]。**源码**：`tauri-utils` 的注释写明「Linux / Windows / Android: Unsupported. Workarounds like a pending WebLock transaction might suffice」「macOS: Supported since version 14.0+」「iOS 17.0+」[10]。
- **源码**：wry 只在 `wkwebview/mod.rs` 里处理它，把三个值映射成 `WKInactiveSchedulingPolicy` 的 `None` / `Throttle` / `Suspend`，写进 `WKPreferences.inactiveSchedulingPolicy`，并且先判断系统版本（macOS ≥ 14）[17][11]。`webview2/mod.rs` 里没有任何对应代码 [16]。
- 关掉节流用的值是 **`"disabled"`**（对应 WebKit 的 `none`）。
- 默认行为：Tauri 文档原话是隐藏或最小化后浏览器会节流定时器，约 5 分钟后甚至卸载整个视图，暂停所有任务直到重新可见 [10]。wry 的 PR 里评审指出 macOS 上默认值是 `suspend` 而不是 `throttle` [9]。

### 1.2 macOS（WKWebView）

- **官方（issue）**：tauri#5250 里的报告：窗口隐藏到托盘、机器睡眠再唤醒后，WebSocket 不会重连，直到窗口重新显示；静音音频、WebRTC 心跳等办法都试过不行；改 `inactiveSchedulingPolicy` 后「resolves it perfectly」，于是有了上面的配置项 [7]。这是目前找到的唯一一条「Tauri 隐藏窗口在 macOS 上不跑 JS」的官方记录，issue 仍然开着（因为 Windows / Linux 没解决）。
- **第三方实测**（egoist/mygo#437 相关 PR、podsteer#210，测试环境写的是 macOS 27 / SDK 26.5）[18][19]：
  - 默认策略（Suspend）：窗口 `orderOut` 隐藏后，WebContent 进程跑 3.5–4 分钟后停掉。
  - 策略设为 None：6 分钟测试期内一直在跑。
  - **两种策略下**：主线程定时器都只有约 1 Hz，`requestAnimationFrame` 不触发，Worker 的吞吐降到可见时的 20–40%。
  - 被别的窗口完全盖住也算隐藏；要让它算可见得用私有方法 `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]`。
  - 有项目额外用 `NSProcessInfo` 的 activity 挡住 App Nap，和 `None` 一起用 [19]。只设 `None`、不拿 activity 够不够，没有找到来源（**未核实**）。Wails 的提案里也把「`none` 对隐藏的 NSWindow 是否真的不节流」列为待验证 [20]。
- 对宿主窗口的含义：
  1. 必须设 `backgroundThrottling: "disabled"`，否则宿主会被整页挂起，所有窗口失去后端逻辑。项目支持 macOS 15+，这个配置项在全部目标系统上有效。
  2. 即使设了，也**不能假设定时器精度**：按约 1 秒一次来设计。宿主里不用 `requestAnimationFrame`。需要准点的定时（歌词、倒计时）由 Rust 侧计时、或在可见窗口里计时。
  3. 消息到达（BroadcastChannel 的 `message`、`fetch` 回应）是任务不是定时器，不受定时器节流影响；但进程被挂起时一样收不到，所以第 1 条是前提。App Nap 对整个应用进程的影响要在实测里一起看（**未核实**）。

### 1.3 Windows（WebView2）

- **官方（规格）**：WebView2 的节流控制规格说，`CoreWebView2Controller.IsVisible` 为 `FALSE` 时 WebView 处于后台状态，定时器按后台间隔唤醒，另有「密集节流」子状态；规格给了隐藏 WebView 仍要跑定时器的例子：把后台和密集两类的间隔都设成 0 [12]。Chromium 自身的规则：页面隐藏后定时器每秒检查一次；隐藏超过 5 分钟、定时器链 ≥ 5、30 秒内没出声、没用 WebRTC 时，每分钟检查一次 [14]。文章里 WebSocket **不在**豁免名单内（只在一个测试开关名里出现）[14]。
- **源码**：wry 创建 WebView 时调用 `controller.SetIsVisible(attributes.visible)`，这个 `visible` 是 **WebView 的**属性，默认 `true`；Tauri 窗口的 `visible: false` 隐藏的是外层的 tao 窗口，不会把控制器的 `IsVisible` 设成 `false`；父窗口子类过程里也只处理 `WM_SIZE`（且跳过最小化）、焦点和移动 [16]。所以一个从不显示的 Tauri 窗口，按 WebView2 的 API 定义**不处于后台状态**。
- 但 Chromium 在 Windows 上还有原生窗口遮挡检测，被完全遮挡或隐藏的窗口按后台标签页处理 [44]。它对「隐藏的顶层窗口里的 WebView2」是否生效，没有找到说明（**未核实**；本仓库 `docs/research/memory-and-performance.md` 和任务 D51 也把这一点列为待实测）。
- Tauri 没有 Windows 的开关，可用的手段：
  1. `additional_browser_args` 传 `--disable-background-timer-throttling`（微软文档列出的开关 [13]），以及 `--disable-renderer-backgrounding`、`--disable-backgrounding-occluded-windows`（Chromium 开关，微软文档里没找到后两个，别的项目这样用 [18]，**未核实**）。注意两点：**源码**里写明自己传参数会替换掉 wry 默认的 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`，要自己补上 [16]；同一个用户数据目录下的所有 WebView 共用一个浏览器进程，环境选项不一致时后创建的会失败 [21]，所以这组参数要对全部窗口一致，等于全应用关掉节流（和任务 D51 想降 CPU 的方向相反，要权衡）。
  2. WebView2 新的节流间隔 API（规格里的 `PreferredBackgroundTimerWakeInterval` 等）[12]：在 webview2-com-sys 0.39.1 的绑定里搜不到这些方法（**源码**），当前版本用不了。
  3. 不调用 `TrySuspend`（它要求 `IsVisible` 为 false，会把页面像休眠标签页一样挂起）[15]；wry 只暴露了 `SetMemoryUsageTargetLevel`，没有调用 `TrySuspend` [16]。
  4. tauri#5250 里的土办法：把定时器放进 Worker（`worker-timers`）、持有一个不释放的 Web Lock [7][10]。有人反馈 WebSocket + Worker 的办法「不太管用」[7]。
- 最稳的做法和 macOS 一样：宿主不依赖页面定时器的精度，准点的事交给 Rust。

### 1.4 两个平台通用

- `requestAnimationFrame` 在隐藏页面里不触发（Chrome 文档：页面隐藏时 rAF 暂停 [14]；WKWebView 见上面的第三方实测）。React 的调度器用 `MessageChannel` 而不是 rAF，宿主里即使跑 React 也不受影响，但任何动画库、`ResizeObserver` 驱动的逻辑都别放宿主。
- 宿主窗口从不显示，就没有用户手势：自动播放音频、剪贴板写入、`window.open` 这类要手势的 API 在宿主里不可用（一般性的浏览器规则，没有专门去查 WebView2 / WKWebView 的例外，**未核实**）。

## 2. 窗口之间的 BroadcastChannel / MessagePort / SharedWorker / storage 事件

### 2.1 来源是否相同

- 打包后：macOS / Linux 的来源是 `tauri://localhost`，Windows 是 `http://tauri.localhost`（Tauri 2 默认 http，可配成 https）[22]。**源码**：wry 在 Windows 上把自定义协议改写成 `http(s)://<scheme>.localhost` [16]。同一个应用的所有窗口加载同一个 `index.html`，同平台内来源相同。开发模式全部是 `http://localhost:1420`。
- 推论：宿主窗口和各界面窗口同源，这一条成立。**但插件协议（比如 `fuyu-plugin://localhost` / `http://fuyu-plugin.localhost`）是另一个来源**，见第 4 节。

### 2.2 进程和存储是否共用

- **Windows，官方**：一个用户数据目录对应一个浏览器进程和一组渲染进程；用相同配置创建多个 `CoreWebView2Environment` 得到的是同一组进程；一个渲染进程可以服务同一用户数据目录下多个 WebView 里的同站页面 [21]。**源码**：Tauri 的 `WebContextStore` 以数据目录为键，不指定时所有窗口共用一个 [16]。
- **macOS，源码**：wry 不设 `processPool`，数据存储在不指定 `data_store_identifier`、不开隐身时用 `WKWebsiteDataStore::defaultDataStore` [17]，所以所有窗口共用默认数据存储。WebKit 的 BroadcastChannel 由网络进程里的 `NetworkBroadcastChannelRegistry` 在各 WebContent 进程之间转发，按来源登记；评审时明确要求按会话（数据存储）分隔，持久和临时存储之间不能互通 [23]。推论：同一数据存储、同源的两个 WKWebView 之间 BroadcastChannel 能通，不要求同一进程。最终落地的键是什么，bug 页面没有给出 ChangeLog 原文，这一步是推论。
- 注意反例：只要给宿主窗口单独设了 `data_directory`（Windows）、`data_store_identifier` 或 `incognito`（macOS），它就和别的窗口不在一个存储里，BroadcastChannel 和 storage 事件都会断。

### 2.3 各通道的结论

| 通道 | Windows | macOS | 说明 |
|---|---|---|---|
| BroadcastChannel | **可用**（本仓库 E32 原型实测：同源的几个页面互相收得到，WebView2 157，Tauri 2.12.5）[27] | **应当可用，未在 Tauri 上核实**。Tauri 讨论区 2022 年有一条「BC works OK between windows」，并提到 Mac 上需要 Safari 15.6+ [22]；WebKit 实现见上 [23] | 只能传可结构化克隆的数据，**不能转移 MessagePort / ArrayBuffer**（`postMessage` 没有 transfer 参数）[24]；没有送达确认，窗口没开着就丢；所有同源页面都能收发，包括跑在同一来源里的插件代码 |
| `storage` 事件 | **可用**，本应用已经在用（`useIslandSettings.ts` 等五处监听 `storage` 做跨窗口同步）[27] | 同上，已在用；macOS 版是否有人验收过要问项目里的记录（未核实） | 只适合小量设置同步，不适合做消息通道（同步写盘、5 MB 配额、值必须是字符串） |
| MessagePort | **建不起来** | **建不起来** | 两个窗口要交换端口，得先有一条能转移对象的通道：`window.open` 的返回值 / `opener`、iframe、SharedWorker 或 Service Worker。Tauri 的窗口是 Rust 各自创建的，互相没有引用；BroadcastChannel 又不能转移端口 [24]。所以「MessagePort 直连」只有借 SharedWorker 才行 |
| SharedWorker | 有，但 tauri#15896（2026-08，未解决）：WebView2 里页面 F5 重载后 SharedWorker 不再回应，重启应用才恢复 [25] | Safari 16 起支持 [26]；iOS 16.1 的 WKWebView 上没有浏览器 entitlement 的应用用 SharedWorker 会崩（WebKit bug 247087，状态未核实）[26]；macOS 上 WKWebView 是否可用**未核实** | 不建议作为基础。它也不能替代隐藏窗口：SharedWorker 里没有 DOM、没有 `__TAURI_INTERNALS__` |

- 没有找到 Tauri / wry 多窗口应用把 BroadcastChannel 当主通道并写了踩坑记录的案例；tauri-apps/tauri 和 wry 的 issue 里搜 BroadcastChannel 只有无关结果。Electron 生态里的说法是「窗口同一个根 URL 就能用 BroadcastChannel」（ToDesktop 文档，搜索摘要，**未核实原文**）。
- 设计上要补的东西（BroadcastChannel 本身不给）：
  - 握手和重放：窗口比宿主先起、或宿主重载时消息会丢。每个窗口启动后发 hello，宿主回全量快照，之后发增量并带序号，窗口发现跳号就重新要快照。
  - 定向：BroadcastChannel 是广播，窗口多（贴图、截图选区每个一个）时每条消息所有窗口都要反序列化一次。按窗口 label 开频道名，或消息里带目标再丢弃。
  - 宿主被挂起时（1.2）消息排在队列里不处理，窗口那边要有超时。

## 3. `emit` 泄漏的现状，`Channel` 和 `invoke` 躲不躲得开

- **tauri#12724**：仍然开着，标签 `platform: Windows`、`status: upstream`（2026-11-04 加）。2026-11-02 有人定位：增长跟「WebView 执行过多少段内容不同的脚本」成正比，不是跟事件数；同样负载反复 `emit` 不涨，内容每次不同就涨（JS 堆 25 MB → 177 MB，强制 GC 后不降）；只调 `webview.eval` 不发事件一样涨 [1]。
- **wry#1489**：仍然开着。维护者 2026-10-26 用纯 C++ 的 WebView2 示例复现，判断是上游问题，报给微软 **WebView2Feedback#5780**（WebView2 运行时 155，开着，微软没有回复；同版本的 Edge 浏览器里不复现）[2][3]。
- **修复**：tauri PR #16446（草稿，未合并，无评审）：事件按 WebView 排队，只执行一段不带数据的固定脚本通知页面，页面再用现有的 channel fetch 命令取队列；Windows 上 20 万条不同负载的事件，GC 后堆从 169 MB 降到 1 MB。副作用是事件多一次往返、和 `eval` 的相对顺序变了；只在 Windows 测过。维护者的态度是事件对时序敏感，排队方案算最后手段 [1][4]。结论：**没有任何已发布的 Tauri / WebView2 版本修了它**，短期内也别指望。
- **`Channel` 躲不开（源码）**：`ipc/channel.rs` 里，JSON 负载小于 8192 字节（原始字节小于 1024）时直接 `webview.eval(回调(负载))`，更大的先存起来再 `webview.eval` 一段带唯一编号的 fetch 脚本 [5]。两条路都是每条消息执行一段内容不同的脚本，和 `emit` 是同一个泄漏机制。所以「把 `emit` 换成 `Channel`」不解决问题。这一条是按源码推出来的，没有找到有人专门测 Channel 的泄漏量（未核实数值）。
- **`invoke` 的回应躲得开（源码）**：`scripts/ipc-protocol.js` 里 `invoke` 是 `fetch(ipc://localhost/<cmd>, {method: 'POST'})`，回应从 fetch 的响应体读，再在页面里调回调，不经过 `eval` [6]。**但有回退路径**：fetch 失败（WebView 拦了自定义协议，或 CSP 的 `connect-src` 没放行 `ipc:`）时，它会永久切到 `window.ipc.postMessage`，这条路的回应由 Rust `webview.eval` 送回 [6]，泄漏又回来了。控制台会打一条 `IPC custom protocol failed, Tauri will now use the postMessage interface instead`。要点：以后给应用加 CSP 时必须放行 `ipc:` 和 `http://ipc.localhost`；开发模式启动后看一眼控制台有没有这条警告。Android 上一律走 postMessage [6]，和本项目无关。
- **推荐的绕法**（按可靠程度）：
  1. 窗口之间直接用 BroadcastChannel（不经过 Rust，第 2 节）。
  2. Rust → 页面的数据用 `invoke` 长轮询或页面定时拉取；回应体走 fetch。
  3. 仍需 `emit` 的地方只发**内容固定**的通知（例如只发事件名，不带负载），页面收到后用 `invoke` 取数据。#12724 的定位说明同样内容的脚本不涨 [1]，这和 PR #16446 的思路一致 [4]。
- **`invoke` 的性能和大小**：
  - 没有找到文档写明的大小上限（**未核实**）。
  - 回调格式化时，JSON 超过 10 240 字节会改用 `JSON.parse` 包一层（`MIN_JSON_PARSE_LEN`，只影响 eval 路径）[5]；Channel 的阈值见上。
  - 大负载用 `tauri::ipc::Response`（原始字节）避免 JSON 编码；JSON 里放字节数组会变成一个数字一个字节 [43]。
  - 第三方基准（tauri-conduit 自己测的）：64 KB 往返 `invoke` 约 2.27 ms，自定义协议 + JSON 约 0.83 ms，二进制约 0.2 ms [43]。数字只能当量级参考。官方讨论里有人反映大结果集走 IPC 慢，维护者建议要极致性能就用 `register_uri_scheme_protocol` [43]。
  - 长轮询的隐患：每个窗口常驻一个挂起的请求。WebView2 / WKWebView 对自定义协议的并发请求数有没有上限，没有找到来源（**未核实**）；长轮询的命令必须是 async 的，否则占住 Tauri 的同步命令线程。窗口关闭或重载时挂起的请求要能在 Rust 侧取消，不然每次重载留一个永远等不到回应的任务。

## 4. 运行时加载第三方 ES 模块

### 4.1 能不能从自定义协议 `import()`

- **官方**：Tauri 维护者对「从文件系统加载 JS / CSS 做用户扩展」的答复就是用 `register_uri_scheme_protocol` 自己实现，核心不会内置 [28]。没有找到「WebView2 / WKWebView 不允许从自定义协议 `import()`」的报告。
- **来源不同是最大的坑**：页面在 `tauri://localhost`（Windows 是 `http://tauri.localhost`），插件协议在另一个来源。模块脚本一律按 CORS 模式取，所以协议的每个响应都要带 `Access-Control-Allow-Origin`。**源码**：Tauri 自己的 `asset` 协议和 `tauri` 协议就是这么做的，回 `Access-Control-Allow-Origin: <窗口来源>` [6]。WKWebView 上的佐证：Apple 论坛里有人给 `<script>` 加上 `type="module"` 之后才开始报 CORS 错 [30]；WebKit bug 201180 说自定义协议内部的请求也受 CORS 检查，WebKit 开发者不同意放开 [30]。
- **MIME**：模块脚本要求 JavaScript 的 MIME（`text/javascript`），否则直接拒绝。Tauri 自己踩过：资源缺失时回退成 `index.html`（200，`text/html`），于是 `import` 失败只报「'text/html' is not a valid JavaScript MIME type」，看不出是哪个文件、为什么（PR #15939 在修）[29]。插件协议里：文件不存在回 404 加纯文本，`.js` / `.mjs` 回 `text/javascript`，`.css` 回 `text/css`，`.json` 回 `application/json`，`.map` 回 `application/json`。
- **CSP**：本项目 `tauri.conf.json` 里 `csp` 现在是 `null`，没有限制。以后要加的话，`script-src` 得包含插件协议的来源（Windows 和 macOS 的写法不同：`http://fuyu-plugin.localhost` 和 `fuyu-plugin:`），`style-src`、`img-src`、`font-src` 同理，`connect-src` 要留着 `ipc:` `http://ipc.localhost`（第 3 节）。Tauri 构建时会给内置脚本注入 nonce / hash，运行时加载的插件脚本拿不到 nonce，只能靠来源放行（一般规则，**未逐条核实**）。
- **安全上的含义**（推论，不是来源里的结论）：插件模块 `import()` 进来以后运行在应用自己的来源里，拿得到 `window.__TAURI_INTERNALS__`，能直接 `invoke` 该窗口能力配置允许的所有命令，也能读写应用的 `localStorage` 和监听所有 BroadcastChannel。「typed slot」只是约定，不是隔离。Tauri 的能力是按窗口 label 配的，所以宿主窗口的 capability 就是所有插件的权限上限，要单独收紧；界面窗口里跑的插件组件同理。这和第 2 版（每个插件独立来源，E32 验证过隔离）是本质区别。

### 4.2 React 只有一份：import map 还是别的

- 插件的包把 `react`、`react-dom`、`react/jsx-runtime`（以及 `react/jsx-dev-runtime`、`react-dom/client`）标成 external。浏览器里裸说明符 `import "react"` 解析不了，必须有人把它映射到应用的那一份。两份 React 的后果是「Invalid hook call」[35]；最容易漏的是 `react/jsx-runtime`：只映射了 `react`，jsx-runtime 被打进插件包，就又带进一份（推论，搜索结果里只有同类案例没有官方说明）。
- **import map 的问题**：
  - 传统规则是 import map 必须出现在任何模块加载之前，而应用自己的入口就是模块，且 Vite 构建产物的 React 是带哈希的内部 chunk，不是一个能写进 map 的稳定 URL。
  - 「多个 import map / 动态追加」Chrome 133、Safari 18.4 才有 [31]。WebView2 是常青的没问题；**macOS 15.0–15.3 自带的 WebKit 早于 18.4**（WKWebView 跟系统走），项目支持 macOS 15+，所以不能依赖动态 import map。
  - W3C TAG 评审指出进行中的模块请求和新 import map 之间有竞态 [31]。
- **更稳的做法（建议）**：不用 import map，让插件的构建工具把 external 改写成指向宿主提供的垫片模块的**绝对 URL**，垫片由插件协议（或应用协议）提供，内容只是把应用已经加载的那一份再导出，例如 `export default globalThis.__FUYU_SHARED__.react; export const { useState, ... } = ...`。Koishi 控制台就是这个路子：插件的客户端构建把 `vue`、`vue-router`、`@vueuse/core`、`@koishijs/client` 标为 external，产物里引用的是 `../vue.js`、`../client.js` 这样的相对路径，由控制台服务端提供同一份文件（**源码**：`packages/client/src/index.ts` 的 `external` 列表和「for backward compatibility」的别名表）[33]。这样不依赖 WebKit 版本，也不怕加载顺序。垫片要写全具名导出（ESM 不能动态生成导出名），React 升级时垫片跟着更新。
- React 版本是对外契约：插件按宿主的 React 大版本编译（`react/jsx-runtime` 的内部形状在大版本之间变过），宿主升 React 大版本等于插件 API 破坏性变更。

### 4.3 CSS、source map

- CSS：Koishi 的做法是加载器按扩展名分流，`.css` 用 `<link rel="stylesheet">` 插到 `head`，并登记成副作用，插件卸载时自动移除（**源码**：`packages/client/client/plugins/loader.ts`）[33]。`<link>` 不需要 CORS（除非要读 `cssRules`）。样式没有作用域，插件的选择器会污染全局；每个窗口都要各插一次。
- CSS 里的 `url()` 相对路径按样式表的 URL 解析，落在插件协议上，协议要能回图片和字体；字体走 CORS，需要 `Access-Control-Allow-Origin`（一般规则）。
- source map：devtools 按脚本 URL 的相对路径去取 `.map`，协议把它当普通文件回就行。WebView2 的 devtools 和 Safari Web Inspector 取自定义协议上的 map 有没有额外限制，**未核实**。

### 4.4 热重载：模块表删不掉

- 浏览器的模块表以 URL 为键，规范里没有删除条目的办法；同一个 URL 再 `import()` 永远拿到第一次的结果。Vite 的做法是每次变更用 `?t=<时间戳>` 换一个 URL 重新导入 [32]。
- 代价：旧模块记录留在模块表里，它的导出和闭包引用的东西都回收不了。Vite 讨论区的结论是「ESM 没有办法清除模块记录，被导出的东西永远不会被清掉，要规范支持失效才能解决」[32]。只在开发时发生、刷新页面就清零，所以 Vite 认为可接受。
- 对本项目：
  - 开发模式的插件热重载用 `?v=<内容哈希或递增号>`，可以；长时间开发后宿主内存上涨是预期行为，重载宿主窗口（`location.reload()`）清零。**宿主窗口重载要设计成正常操作**：所有窗口重新握手拿快照（2.3）。
  - **生产环境里「停用再启用插件」「更新插件」也是同一个问题**：同一路径的新版本必须换 URL（把版本号或哈希放进路径，比放查询串好：相对导入会跟着变，子模块也一起换新）。只换入口的查询串时，入口里 `import "./chunk.js"` 的子模块仍然命中旧缓存，这是查询串方案最常见的坑（Vite 也出过查询参数不一致导致模块重复的 bug，vite#9773 [32]）。所以插件最好打成单文件，或者版本进路径。
  - 多次更新后的内存残留只能靠重载宿主回收；可以在「插件更新后空闲时」自动重载宿主。
- Cordis 的 HMR 插件做的是 Node 那一侧的事（清 Node 的 ESM 加载缓存和 `require.cache`、用 chokidar 监听文件），浏览器里用不上，见第 5 节。
- 状态保留：重载一个插件 = `scope.dispose()` 撤销它的全部副作用，再用新模块 `ctx.plugin()`。组件状态会丢（不是 React Fast Refresh）；要保留就得插件自己把状态放进宿主的服务里。

### 4.5 别人怎么加载插件界面

| 产品 | 做法 | 来源 |
|---|---|---|
| Koishi 控制台 | 服务端下发每个扩展的文件列表；浏览器端 `import(url)` 后 `ctx.plugin(模块默认导出)`，CSS 用 `<link>`；每个扩展一个 Cordis 作用域，服务端列表里没了就 `scope.dispose()`；后端实例 id 变了直接 `location.reload()`；Vue 等共享依赖走 external + 宿主提供的文件。**没有隔离**，插件界面和控制台同源同堆 | 源码 [33] |
| Obsidian | 插件是一个 CommonJS 的 `main.js`，`obsidian` 标成 external，由应用在运行时提供 `require('obsidian')`；npm 上的 `obsidian` 包只有类型。应用内部怎么求值没有文档，论坛里的堆栈显示是 `eval at (app.js:1)`（推断）。和应用同进程、同堆，无隔离 | 论坛、npm 包说明 [45] |
| Logseq | 插件默认跑在各自的沙箱 iframe 里，经 postMessage 的 RPC 调宿主；SDK 类型里有 `mode: 'shadow' | 'iframe'` 两种。2026 年有沙箱逃逸的 CVE（CVE-2026-47901：iframe 里的插件能往宿主 DOM 的容器注入任意属性，宿主没开 CSP 时可执行脚本）。两种模式的官方说明没找到（未核实） | 论坛、CVE [41] |
| VS Code | 扩展跑在独立的扩展宿主进程里，界面只能经声明式 API 或 webview（iframe）贡献；扩展之间在同一个宿主进程里不隔离 | 官方 wiki [39] |

本方案和 Koishi 控制台是同一类（同源、同堆、动态 import、作用域撤销），不是 Obsidian / Logseq 那类。

## 5. Cordis

- **许可证**：MIT [34]。
- **版本和节奏**：npm 上 `cordis` 的 `latest` 是 `4.0.0-rc.13`（2026-11-12）；rc.6 到 rc.13 是 2026-05 到 2026-11，约 2–6 周一个 rc，共 169 个已发布版本。仓库 README 首段：「Cordis is under active development. The API is not yet stable and may change without notice.」官方文档「still under construction」，指向的是 deepseek-harness 的一篇入门 [34]。**4.0 正式版还没有发布日期**（未找到）。配套包版本各走各的：`@cordisjs/loader` 1.0.0-rc.10、`@cordisjs/hmr` 2.0.0-rc.0、`@cordisjs/include` 2.0.0-rc.0、`@cordisjs/timer` 1.1.5 [34]。npm 的 dist-tag 有点乱（`next` 指向更旧的 beta.5），装的时候要写死版本号。
- **能不能在浏览器里跑（源码，main 分支，4.0.0-rc.13）**：
  - 核心包 `packages/core`（npm 名 `cordis`）：约 2055 行，`type: module`，运行时依赖只有 `cosmokit` 和 `@standard-schema/spec`，源码里没有任何 `node:` 导入，没有 `process`、`require`、`import.meta`、`AsyncLocalStorage`；对 `@cordisjs/loader`、`@cordisjs/fs`、`@cordisjs/fs-node`、`@cordisjs/include` 是**可选** peer 依赖 [34]。编译目标是 ES2024，WebView2 和 macOS 15 的 WebKit 都够。结论：内核可以直接进浏览器包。
  - 旁证：Koishi 控制台的浏览器端一直在用 Cordis（`@koishijs/client` 依赖 `cordis ^3.18.1`，`class Context extends cordis.Context`）[33]。注意那是 **3.x**；4.x 在浏览器里跑没有找到公开的先例，只有「源码里没有 Node 依赖」这一条依据，要自己跑一遍冒烟测试。
  - `@cordisjs/loader`：`node:module`（`createRequire`）、`node:fs`、`node:path`、`node:url`。`@cordisjs/hmr`：`node:async_hooks`、`node:fs`、`node:module`、`node:crypto`，改的是 Node 的模块解析。`@cordisjs/include`：`node:path`、`node:url`。**这三个都不能在浏览器里用** [34]。
- **浏览器宿主需要自己写的部分**：
  1. 加载器：读插件清单（由 Rust 命令或插件协议提供）→ 按依赖顺序 `import(url)` → `ctx.plugin(mod.default, config)`，保存返回的作用域；停用时 `dispose()`。照 Koishi 的 `LoaderService` 写，约百行 [33]。
  2. 配置：不用 `@cordisjs/include` 的 YAML 文件树，自己从 `localStorage` / Rust 读配置再传给 `ctx.plugin`。
  3. 热重载：Rust 侧监听 `~/.fuyu/plugins/`（notify crate），通知宿主（用内容固定的通知或长轮询回应，别用带负载的 `emit`），宿主 `dispose()` 旧作用域后用新 URL 重新导入（4.4）。
  4. 跨窗口：Cordis 的上下文树只在一个 JS 堆里。「宿主一棵、每个窗口一棵」之间的服务调用、事件转发、插槽注册同步都要自己做桥（第 2 节），Cordis 不提供。Koishi 的做法是浏览器端和 Node 端各一棵树，中间用 WebSocket 传数据（`receive('entry-data', ...)`）[33]，可以照这个分法：**组件代码只在窗口里加载，宿主只传可序列化的数据**。函数、React 元素过不了 BroadcastChannel。
- **风险**：API 明说不稳定；3.x → 4.x 改动很大（包名、服务声明方式、效果系统），4.0 的 rc 期间仍在变；文档基本没有，只能读源码。本项目把 Cordis 的 `ctx` 直接暴露给第三方插件的话，Cordis 的每次破坏性变更都变成本项目的插件 API 破坏。建议对插件暴露自己的一层薄接口，内部用 Cordis，并把版本钉死；内核只有两千行，最坏情况可以 fork。

## 6. 同一个 JS 堆里按插件统计资源

### 6.1 CPU

- **包回调计时**：可行，也是唯一两个平台都能用的办法。内核在每个登记点（事件监听、服务方法、定时器、插槽组件的渲染）外面包一层 `performance.now()` 计时。局限（都是一般性的技术限制，不是来源里的结论）：
  - 只算同步段。`async` 函数第一个 `await` 之后的续体、插件自己 `new Promise().then()`、自己调的 `setTimeout` / `addEventListener` / `MutationObserver` 都不经过内核，算不到。要么 API 里不给插件直接用这些（提供 `ctx.setTimeout` 等并在文档里约定），要么接受漏算。浏览器里没有 `AsyncLocalStorage`，TC39 的 AsyncContext 还没有可用实现，没法自动把续体归到插件名下（**未核实**当前各引擎状态）。
  - 嵌套要扣除：插件 A 的回调里调了插件 B 的服务，要用一个栈把 B 的时间从 A 里减掉。
  - React 渲染：组件函数本身可以包（给每个插槽组件套一层 `<Profiler>` 或者高阶组件），但 React 把多个组件的渲染、提交、effect 批在一起，`Profiler` 的 `actualDuration` 包含子树；插件组件里用到的宿主组件的时间也会算进去。只能算近似值。
  - 计时精度：`performance.now()` 在没有跨源隔离的页面里被降到 100 µs（Chromium）或 1 ms（WebKit）量级，很多回调会量出 0。按次数 + 累计时间一起看；大量极短回调的开销会被低估（**未核实**各 WebView 的具体精度）。
  - 死循环量不出来：回调不返回就没有结束时间，整个宿主卡死。同堆方案防不了，只能靠 Rust 侧的看门狗（宿主定期经 `invoke` 报心跳，超时就重建宿主窗口并把正在执行的插件标为嫌疑，所以进入回调前要先把「当前插件」写到 Rust 或 `localStorage`）。
- **Long Tasks（`PerformanceObserver` 的 `longtask`）**：Chromium 有，Safari / WKWebView 没有（MDN 兼容表，**本次没有打开核对，未核实**）。而且它的归因只到 frame / 容器级，不到函数，分不出插件。Long Animation Frames（LoAF）能给出脚本 URL，按插件协议的 URL 可以分出插件，但只有 Chromium（**未核实**）。可以在 Windows 上作为补充信号，不能作为跨平台方案。
- **JS Self-Profiling API**（`new Profiler(...)`）：只有 Chromium（Chrome / Edge 94+），Firefox 和 Safari 标为不支持；页面必须带响应头 `Document-Policy: js-profiling` [37]。它给的是采样调用栈，带脚本 URL，按 URL 前缀归到插件是最准的办法，而且不需要包回调、不漏异步续体。在 Tauri 里要让 `tauri://` 协议的 `index.html` 响应带上这个头，Tauri 有没有配置项加自定义响应头、WebView2 是否认自定义协议上的这个头，**未核实**。结论：只能当 Windows 上开发模式的增强。

### 6.2 内存

- `performance.measureUserAgentSpecificMemory()`：只有 Chromium（89+），Firefox、Safari 不支持；需要跨源隔离（COOP + COEP），不满足时不存在或抛 `SecurityError` [36]。它的分项是按 frame / worker（跨源 iframe）给的，不是按模块，同一个堆里的插件仍然分不开。跨源隔离还会让所有跨源子资源都要带 CORP / CORS 头，对加载插件资源、外部图片是额外负担。**不值得为它开跨源隔离。**
- WKWebView 没有任何页面内的内存 API（`performance.memory` 也是 Chromium 独有，一般知识，未核实）。
- 所以：每插件内存在同堆里拿不到，这是结构性的。能做的是 Rust 侧读宿主渲染进程的总内存，加上内核自己数的资源数（监听器、定时器、注册项、缓存条目）；开发模式下用 devtools 的堆快照人工看。这和本仓库 `v3-everything-plugin.md` 里已经写的判断一致。
- 想要「某个插件吃内存就能立刻还回来」，只有把它放进独立的 iframe / Worker / 进程才行。可以保留一条逃生通道：重的或不可信的插件仍走第 2 版的独立来源页面。

### 6.3 别人怎么给用户看

| 产品 | 给什么 | 怎么来的 |
|---|---|---|
| VS Code | 「Show Running Extensions」列出每个扩展的激活耗时，可以对扩展宿主进程录 CPU profile；扩展宿主没响应时自动短时间挂上 profiler，找出占用最多的扩展并提示用户向作者报告。官方说明里明说扩展共用一个进程、互相不隔离，所以靠采样归因 | 官方 wiki [39] |
| Chrome 扩展 | 任务管理器按进程给内存和 CPU：扩展的后台页 / Service Worker 是独立进程，所以能按扩展分 | 一般知识，本次未查来源（未核实） |
| Obsidian | 只给启动耗时：设置里的「Debug startup time」显示每个插件的加载耗时；开发文档有专门一页教作者优化加载时间。没有运行期的 CPU / 内存归因 | 官方开发文档、论坛 [40] |

规律：按进程分的（Chrome）能给准数；同进程的（VS Code、Obsidian）只给激活 / 启动耗时加采样归因，没有人在同一个堆里给出每插件内存。本方案能给的上限和 VS Code 相当，而且只有 Windows 上（Self-Profiling）才做得到采样归因。

## 7. React

- **错误边界**：每个插槽的每个注册项外面各包一个错误边界，一个组件渲染时抛错只卸掉它自己。React 文档明确错误边界**不捕获**：事件处理函数里的错、异步代码（`setTimeout`、Promise 回调）、服务端渲染、边界自身的错 [42]。所以：
  - 插件组件的事件处理抛错不会让界面崩，但也没人接；用 `window.onerror` / `unhandledrejection` 兜底，按堆栈里的脚本 URL 归到插件。
  - React 19 的 `createRoot` 有 `onCaughtError` / `onUncaughtError` / `onRecoverableError` 选项，可以在根上统一记账（react.dev 的 createRoot 页 [42]；这三个选项是按 React 19 文档的印象写的，**本次未打开核对**）。
  - 边界要有重置办法：插件热重载或用户点「重试」时换 `key`，否则出过错的插槽一直是降级界面。
  - 渲染死循环、`useEffect` 里的无限 `setState` 最终会被 React 的「Maximum update depth exceeded」抛出来，能被边界接住；纯同步死循环接不住（6.1）。
  - 边界防不了的还有：插件组件改全局样式、直接操作别的 DOM、往 `window` 上挂东西、调用 hooks 违规导致的错乱。
- **Suspense / lazy**：每个插槽项用 `React.lazy(() => import(url))` 加各自的 `<Suspense>`，这样一个插件的模块没下完不挡别的项。`lazy` 的 `import` 失败（404、MIME 不对、语法错）会作为渲染错误抛给最近的错误边界，所以顺序是 `ErrorBoundary > Suspense > 组件`。`lazy` 会缓存失败的 Promise，重试要新建 `lazy` 对象（配合 4.4 的换 URL）。React 19 里同一个 Suspense 边界下的兄弟不再并行预渲染，多个插件共用一个 Suspense 会变成串行瀑布，所以要一项一个边界（按 React 19 发布时的行为变化写的，**未核实**当前小版本的最终行为）。
- **多个小根 vs 一棵树**：react.dev 的建议是完全用 React 写的应用只建一个根；多根是给「页面里只有几块是 React」的情况用的；要把内容渲染到别处用 `createPortal`，它保持在同一棵树里，上下文和事件冒泡都还在 [42]。没有找到多根和单树的性能基准（**未核实**）。按机制推断的取舍：
  - 每个插槽项一个根：隔离最好（一个根崩了、卡了不拖别的根的提交；卸载干净），但拿不到宿主的 Context（主题、i18n、Cordis 上下文都要重新包一遍 Provider），根之间的更新不在同一批里（可能出现一帧的不同步），并发特性（transition、Suspense 协调）跨不了根。
  - 一棵树 + 错误边界：Context 自然可用，更新同批；代价是插件组件渲染慢会拖住整棵树的这一次提交，插件组件里高频 `setState` 会让宿主的祖先参与调和（用 `memo` 把插槽和宿主隔开）。
  - 建议：默认一棵树（每个窗口一个根）+ 每项一个错误边界和 Suspense；只有明确是「重的、独立的面板」才给独立根。Koishi 控制台也是单个 Vue 应用加具名插槽（`k-slot`）[33]。
- 插槽注册表做成外部存储，用 `useSyncExternalStore` 订阅，插件增删只重渲染对应插槽。
- 插件组件只能在窗口里加载（第 5 节），所以「插件注册组件」实际是：宿主里的插件声明「我往某个插槽放某个模块 URL 的某个导出」，各窗口的客户端上下文收到这条数据后自己 `import()`。同一个插件于是有两段代码（宿主里的逻辑、窗口里的组件），它们之间也只能传可序列化数据；插件 SDK 要把这一点做成显式的两个入口，像 Koishi 的 `index.ts`（Node）和 `client/index.ts`（浏览器）[33]。

## 8. 必须自己实测的清单

按风险从高到低：

1. **macOS，隐藏宿主窗口**：`visible: false` + `backgroundThrottling: "disabled"`，在 macOS 15 上放 30 分钟以上，记录 `setInterval(…, 100)` 的实际频率、BroadcastChannel 消息的延迟、`fetch` / WebSocket 是否存活；再测合盖睡眠唤醒、应用进入 App Nap（所有窗口都不可见、岛屿收起）之后。对照组：不设该选项。
2. **macOS，BroadcastChannel**：两个 Tauri 窗口（打包后的 `tauri://localhost`，不是 dev 服务器）之间收发；宿主隐藏时发给它的消息多久被处理。
3. **Windows，隐藏宿主窗口**：从不显示的窗口里 `document.visibilityState` 是什么、定时器频率、隐藏 5 分钟以上后是否进入每分钟一次的密集节流；再测加上 `--disable-background-timer-throttling` 等参数之后。
4. **两个平台，插件协议上的 `import()`**：跨源模块 + CORS 头 + MIME；模块里的相对导入、`import.meta.url`、CSS `<link>`、字体；devtools 里 source map 是否生效。
5. **React 垫片**：插件包 external 掉 `react`、`react/jsx-runtime`、`react-dom`，指向垫片 URL，确认 hooks 正常、只有一份 React。
6. **Cordis 4.0.0-rc.13 在 WebView 里的冒烟测试**：建上下文、服务、`inject`、`effect`、`dispose`，在 WebView2 和 macOS 15.0 自带的 WebKit 上各跑一遍（后者是最老的目标引擎）。
7. **`invoke` 长轮询**：确认控制台没有 `IPC custom protocol failed`；7 个以上窗口同时各挂一个请求时是否互相阻塞；窗口重载后 Rust 侧挂起的请求有没有清掉。
8. **Channel 的泄漏量**：按 #12724 的方法（内容不同的消息 N 万条，强制 GC 后看堆）测一次 `Channel`，把第 3 节的源码推断变成数字。

## 9. 风险表

| 方案里的假设 | 结论 | 改成什么 |
|---|---|---|
| 一个隐藏的、常驻的 WebView 窗口能当后台一直跑 | **有条件可行** | macOS 设 `backgroundThrottling: "disabled"`（14+ 有效，不设会被整页挂起）[7][10]；Windows 没有开关，先实测，不行再加浏览器启动参数 [13]。两边都按「定时器最多 1 次/秒、没有 rAF、没有用户手势」设计，准点的事放 Rust。Rust 侧加心跳看门狗，宿主卡死或被杀能重建 |
| 宿主里的 `setInterval` / `setTimeout` 是准的 | **不成立** | 第三方实测 macOS 上即使关了挂起也约 1 Hz [18]；Chromium 隐藏页面 1 次/秒到 1 次/分钟 [14]。定时由 Rust 发起，或放到可见窗口 |
| 宿主和窗口同源，BroadcastChannel 能通 | Windows **可行**（已实测 [27]）；macOS **应当可行，待实测** [23] | 加握手、快照 + 序号、按窗口分频道。任何窗口都不能设单独的数据目录 / data store / 隐身，否则断开。macOS 实测不通时退到 `invoke` 长轮询 |
| 窗口之间可以用 MessagePort 直连 | **不成立** | Tauri 的窗口互相没有引用，BroadcastChannel 不能转移端口 [24]。只用 BroadcastChannel |
| 可以用 SharedWorker 做中枢 | **不建议** | WebView2 上重载后失联的 bug 未修 [25]；WKWebView 上有过崩溃记录，macOS 现状未核实 [26] |
| 不用 `emit` 就没有泄漏；`Channel` 是安全的替代 | **部分不成立** | `Channel` 每条消息同样 `eval` 一段不同的脚本 [5]，同一个泄漏机制。安全的只有：窗口间直连、`invoke` 回应（fetch）、内容固定的通知。给应用加 CSP 时必须放行 `ipc:`，否则 `invoke` 会悄悄退回 eval 路径 [6] |
| 等上游修掉 #12724 | **别等** | Tauri、wry、WebView2 三处都开着，微软没回复；Tauri 的修复 PR 是草稿，维护者当作最后手段 [1][2][3][4] |
| `invoke` 长轮询可以作为后备通道 | **有条件可行** | 命令写成 async；窗口关闭 / 重载时取消挂起的请求；大负载用原始字节回应 [43]。并发上限未核实，要测 |
| 从 `~/.fuyu/plugins/` 经自定义协议 `import()` ES 模块 | **有条件可行** | 协议必须回 `Access-Control-Allow-Origin` 和正确的 MIME，缺文件回 404 而不是 HTML [29][30]。注意插件代码运行在应用来源里，拿得到 Tauri IPC：按窗口收紧 capability |
| 用 import map 让插件共用应用的 React | **不建议** | 动态 / 多个 import map 要 Safari 18.4，macOS 15.0–15.3 没有 [31]；Vite 产物里的 React 也没有稳定 URL。改用宿主提供的垫片模块 + 构建时把 external 改写成垫片 URL（Koishi 的做法 [33]）。`react/jsx-runtime` 必须一起 external |
| 插件可以热重载 / 更新而不重启 | **有条件可行** | 模块表删不掉，只能换 URL（版本进路径，或单文件包 + 查询串），每次留下一份旧模块 [32]。把「重载宿主窗口」做成正常、无感的操作，用来回收 |
| Cordis 4 能在 WebView 里跑 | 内核 **可行**（源码无 Node 依赖，3.x 在 Koishi 控制台里跑了多年）[33][34]；loader / hmr / include **不可用** | 自己写浏览器版加载器和热重载（照 Koishi 的 `LoaderService`）；4.x 在浏览器里没有公开先例，先做冒烟测试 |
| Cordis 的 API 可以直接当插件 API 暴露 | **风险高** | README 明说 API 不稳定，4.0 还在 rc，文档未完成 [34]。钉死版本，对插件暴露自己的薄封装 |
| 宿主一棵树、每个窗口一棵树，插件往插槽里注册 React 组件 | **有条件可行** | 组件过不了窗口边界：插件分两个入口（宿主逻辑 / 窗口组件），之间只传可序列化数据；窗口各自 `import()` 组件模块 [33] |
| 包住每个回调就能精确统计每个插件的 CPU | **近似可行，谈不上精确** | 只算得到经内核登记的同步段；`await` 之后的续体、插件自建的定时器和监听器漏算；死循环量不出来。API 里提供受管的定时器 / 监听器；Windows 开发模式可加 JS Self-Profiling 做采样对照 [37]；看门狗处理卡死 |
| 可以用 `measureUserAgentSpecificMemory` 之类拿到每插件内存 | **不成立** | 只有 Chromium、要跨源隔离、按 frame 分不按模块分 [36]；WKWebView 没有。只报宿主总内存和资源计数；要硬隔离的插件走独立来源页面（第 2 版的路） |
| 错误边界能隔离一个崩溃的插件组件 | **部分成立** | 只管渲染期和生命周期的错，不管事件处理、异步、死循环、全局副作用 [42]。再加全局错误监听按 URL 归因、可重置的边界、看门狗 |
| 每个插槽项一个 React 根来隔离 | **不建议作为默认** | 官方建议全 React 应用单根 [42]；多根拿不到 Context、更新不同批。默认单根 + 每项 `ErrorBoundary > Suspense`，重面板才单独建根 |

## 来源

1. tauri-apps/tauri#12724「Memory leak when emitting events」：https://github.com/tauri-apps/tauri/issues/12724
2. tauri-apps/wry#1489「Memory leak when executing JavaScript from Rust」：https://github.com/tauri-apps/wry/issues/1489
3. MicrosoftEdge/WebView2Feedback#5780「`ExecuteScript` memory leak」：https://github.com/MicrosoftEdge/WebView2Feedback/issues/5780
4. tauri-apps/tauri PR #16446「deliver events from a per-webview queue instead of one script per event」（草稿）：https://github.com/tauri-apps/tauri/pull/16446
5. Tauri 源码 `crates/tauri/src/ipc/channel.rs`、`ipc/format_callback.rs`（读的是本机 tauri 2.12.5）：https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs
6. Tauri 源码 `crates/tauri/scripts/ipc-protocol.js`、`src/ipc/protocol.rs`、`src/protocol/asset.rs`、`src/protocol/tauri.rs`（本机 tauri 2.12.5）：https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/scripts/ipc-protocol.js
7. tauri-apps/tauri#5250「Allow disable background throttling」：https://github.com/tauri-apps/tauri/issues/5250 （关键评论：https://github.com/tauri-apps/tauri/issues/5250#issuecomment-2569380578 ）
8. tauri-apps/tauri PR #12181「feat: disable background throttling」：https://github.com/tauri-apps/tauri/pull/12181
9. tauri-apps/wry PR #1445：https://github.com/tauri-apps/wry/pull/1445
10. Tauri 配置参考 `backgroundThrottling`（及本机 tauri-utils 2.10.2 `config.rs` 的注释）：https://v2.tauri.app/reference/config/#backgroundthrottling
11. Apple `WKPreferences.inactiveSchedulingPolicy`：https://developer.apple.com/documentation/webkit/wkpreferences/inactiveschedulingpolicy
12. WebView2 节流控制规格 ThrottlingControlScript.md（经搜索摘要读到，原文页面本次抓取 404）：https://github.com/MicrosoftEdge/WebView2Feedback/blob/a477d2022aaa84948c738f3b932747c386177123/specs/ThrottlingControlScript.md
13. WebView2 browser flags（经搜索摘要）：https://learn.microsoft.com/microsoft-edge/webview2/concepts/webview-features-flags
14. Chrome「Heavy throttling of chained JS timers beginning in Chrome 88」：https://developer.chrome.com/blog/timer-throttling-in-chrome-88
15. `ICoreWebView2_3::TrySuspend`（经搜索摘要）：https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_3
16. wry 源码 `src/webview2/mod.rs`（本机 wry 0.57.2）及 Tauri `webview_window.rs` 的 `additional_browser_args` 注释、`tauri-runtime-wry` 的 `WebContextStore`：https://github.com/tauri-apps/wry/blob/dev/src/webview2/mod.rs
17. wry 源码 `src/wkwebview/mod.rs`（本机 wry 0.57.2）：https://github.com/tauri-apps/wry/blob/dev/src/wkwebview/mod.rs
18. egoist/mygo#437「Keep a page running at full speed while its window is hidden or covered」（第三方，含各平台做法和实测）：https://github.com/egoist/mygo/issues/437 ；相关 PR：https://github.com/egoist/mygo/pull/847
19. podsteer/podsteer PR #210「keep refreshing while the window is hidden」（第三方）：https://github.com/podsteer/podsteer/pull/210
20. wailsapp/wails PR #5920「[WEP] keep WebViews running while hidden」（提案，未合并）：https://github.com/wailsapp/wails/pull/5920
21. WebView2 进程模型（经搜索摘要）：https://learn.microsoft.com/microsoft-edge/webview2/concepts/process-model
22. Tauri 讨论：来源在各平台的形式 https://github.com/orgs/tauri-apps/discussions/9174 ；窗口间通信（提到 BroadcastChannel 可用）https://github.com/orgs/tauri-apps/discussions/2650
23. WebKit bug 227924「Add initial support for BroadcastChannel behind a runtime flag」：https://bugs.webkit.org/show_bug.cgi?id=227924 ；实现文件 https://webkit.googlesource.com/WebKit/+/15e4da4b5ce83fcfe6de6863df44c60571019d5f/Source/WebKit/NetworkProcess/NetworkBroadcastChannelRegistry.cpp
24. MDN BroadcastChannel：https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
25. tauri-apps/tauri#15896「Shared Worker stops responding after F5 reload with WebView2」：https://github.com/tauri-apps/tauri/issues/15896
26. Safari 16 发布说明（SharedWorker）：https://developer.apple.com/documentation/safari-release-notes/safari-16-release-notes ；WebKit bug 247087（WKWebView 上 SharedWorker 崩溃）：https://bugs.webkit.org/show_bug.cgi?id=247087 ；Apple 论坛：https://developer.apple.com/forums/thread/718757
27. 本仓库：`/Users/tixxin/Desktop/projects/Fuyu/docs/investigations/e32-plugin-window-prototype.md`（第 6 节存储表）、`/Users/tixxin/Desktop/projects/Fuyu/docs/research/memory-and-performance.md`、`/Users/tixxin/Desktop/projects/Fuyu/src/features/appearance/useIslandSettings.ts`（`storage` 事件）
28. tauri-apps/tauri#5190「allow requiring js/css files from within the filesystem」：https://github.com/tauri-apps/tauri/issues/5190
29. tauri-apps/tauri PR #15939「return 404 for missing subresource assets instead of SPA index.html fallback」：https://github.com/tauri-apps/tauri/pull/15939
30. WebKit bug 201180（自定义协议内的 CORS）：https://bugs.webkit.org/show_bug.cgi?id=201180 ；Apple 论坛「Loading Angular project in WKWebView: Cors issues on JS files」：https://developer.apple.com/forums/thread/705380
31. caniuse「Multiple import maps」：https://caniuse.com/wf-import-maps-multiple ；Shopify「Resilient import maps」：https://shopify.engineering/resilient-import-maps ；W3C TAG 评审 #980：https://github.com/w3ctag/design-reviews/issues/980
32. Vite 讨论 #14438（HMR 的 `?t=` 与模块表无法清除）：https://github.com/vitejs/vite/discussions/14438 ；vite#9773：https://github.com/vitejs/vite/issues/9773
33. koishijs/webui 源码（main 分支）：加载器 https://github.com/koishijs/webui/blob/main/packages/client/client/plugins/loader.ts ；客户端构建（external 与别名）https://github.com/koishijs/webui/blob/main/packages/client/src/index.ts ；上下文 https://github.com/koishijs/webui/blob/main/packages/client/client/context.ts
34. cordiverse/cordis 仓库（README、`packages/core`、`packages/loader`、`packages/hmr`、`packages/include` 的 `package.json` 和源码，main 分支 2026-11-14）：https://github.com/cordiverse/cordis ；npm：https://www.npmjs.com/package/cordis
35. React「Invalid Hook Call Warning」：https://react.dev/warnings/invalid-hook-call-warning
36. web.dev「Monitor your web page's total memory usage with measureUserAgentSpecificMemory()」：https://web.dev/articles/monitor-total-page-memory-usage
37. MDN「JS Self-Profiling API」：https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API
38. （并入 14）
39. VS Code wiki「Performance Issues」：https://github.com/microsoft/vscode/wiki/Performance-Issues ；「Explain extension causes high cpu load」：https://github.com/microsoft/vscode/wiki/Explain-extension-causes-high-cpu-load
40. Obsidian 开发文档「Optimize plugin load time」：https://docs.obsidian.md/plugins/guides/load-time ；论坛（启动耗时）：https://forum.obsidian.md/t/startup-time-help/96844
41. Logseq 论坛（插件在各自 iframe 里）：https://discuss.logseq.com/t/need-help-resolving-a-plugin-issue-regarding-cross-frame-origin/5750 ；CVE-2026-47901：https://nvd.nist.gov/vuln/detail/CVE-2026-47901 ；插件文档站：https://plugins-doc.logseq.com/
42. React 文档：错误边界 https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary ；旧版说明（不捕获的情况）https://legacy.reactjs.org/docs/error-boundaries.html ；`createRoot` https://react.dev/reference/react-dom/client/createRoot ；`createPortal` https://react.dev/reference/react-dom/createPortal ；react-error-boundary https://github.com/bvaughn/react-error-boundary
43. Tauri 讨论 #11915（IPC 性能）：https://github.com/orgs/tauri-apps/discussions/11915 ；#5690：https://github.com/tauri-apps/tauri/discussions/5690 ；tauri-conduit（第三方基准）：https://github.com/userFRM/tauri-conduit
44. Chromium「Windows Native Window Occlusion Detection」：https://chromium.googlesource.com/chromium/src/+/master/docs/windows_native_window_occlusion_tracking.md
45. Obsidian 论坛（插件就是插件目录里的 `main.js`；`obsidian` 由应用提供）：https://forum.obsidian.md/t/the-import-of-third-party-module-is-failing-in-main-js-cannot-find-module/25180 ；https://forum.obsidian.md/t/expose-obsidian-module-to-be-used-outside-plugins/49988

### 没有核实、正文里已标出的项（汇总）

- Windows 上从不显示的 Tauri 窗口里页面是否被 Chromium 当作后台（遮挡检测是否生效、定时器实际频率）。
- macOS 上只设 `inactiveSchedulingPolicy = none`、不拿 `NSProcessInfo` activity 时 App Nap 的影响；第三方实测的 1 Hz 在 macOS 15 上是否一样。
- BroadcastChannel 在打包后的 Tauri macOS 应用（`tauri://localhost`）多窗口之间是否可用。
- macOS 的 WKWebView 上 SharedWorker 现在是否可用。
- `invoke` 负载的大小上限；自定义协议并发请求上限。
- `Channel` 的实际泄漏量（只有源码推断）。
- Long Tasks / LoAF 在各引擎的支持；`performance.now()` 在两种 WebView 里的精度；`Document-Policy: js-profiling` 在 Tauri 自定义协议上能否生效。
- React 19 `createRoot` 的三个错误回调、Suspense 兄弟不并行预渲染的现状（按记忆写的）。
- 多根 vs 单树的性能数据（没有找到基准）。
- Chrome 任务管理器按扩展进程统计（一般知识，没查来源）。
- Cordis 4.0 正式版的发布时间；4.x 在浏览器里的实际运行情况。
- 微软文档类链接（12、13、15、21）本次只读到了搜索摘要，没能打开原文。
