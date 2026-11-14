# 同权插件的安全：事故、对策、隔离、提示和市场规则

> 日期：2026-11-14。问题：插件和应用同权、没有权限表时，真实发生过哪些事故，哪些保护有用、哪些只是看起来有用。范围：VS Code 市场、Obsidian、npm、浏览器扩展商店、JetBrains、Raycast、F-Droid 等的事故报告、官方政策和文档；可重现构建（esbuild、Rollup、Vite）；SES、ShadowRealm、QuickJS 等隔离手段。相关方案：[v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)。

调研日期：2026-11-14。方法：联网搜索加打开一手页面。每条结论后面的 `[n]` 对应文末来源。只从搜索摘要或二手报道得到、没有打开原文核对的，标了「未核实」。

被评估的方案（调用方给的）：插件在进程内运行、完全信任、没有权限表；保护措施是人工挑选的市场、首次上架时维护者读源码、Ed25519 签名的索引、作者签名加首次信任后固定公钥（TOFU）、撤销名单、「发布包必须和从 tag 源码构建出来的一致」（市场 CI 在无密钥的任务里重建并比对文件）、安装时提示「插件和应用权限相同」、安全模式、反复出错或 CPU 过高时自动停用。

---

## 0. 结论先行

1. **方案里最大的缺口是更新。** 近两年查到的大多数事故都不是「第一次上架就带毒」，而是先发一个干净版本、过了审核、攒了用户，再通过自动更新送恶意代码（ShadyPanda、SleepyDuck、SaassyCode、GlassWorm、event-stream、The Great Suspender、Cyberhaven）[4][5][6][7][18][21][22][23]。Obsidian 在 2026 年 5 月之前也是只审首次提交，现在改成每个版本都自动扫描 [12]。只审首次上架等于只防了最少见的那种攻击。
2. **「发布包和源码构建一致」证明的是「包 = 源码」，不是「源码无害」。** 作者本人作恶、作者账号被盗、依赖被投毒，这三种情况下重建结果都会一致。它真正防的是「源码干净、发布包被另外塞了东西」这一种（event-stream 的 flatmap-stream、xz 的发布包都是这种）[18][20]。这一条有价值，但不能在界面或文档里写成「已验证安全」。
3. **最便宜、收益最高的补充**：更新冷静期（新版本进索引后过几天才自动装）、每次更新都让维护者看一眼两个 tag 之间的 diff（尤其是锁文件和敏感 API）、禁止远程加载代码并用 CSP 强制、索引加过期时间和版本号防回滚、作者换钥匙或换人时当作重新上架。
4. **隔离**：SES、ShadowRealm、QuickJS-in-WASM 都和「插件可以改任何东西」冲突，成本高，Figma 和 Obsidian 的经验都指向「要么一开始就按沙箱设计 API，要么老实承认没有沙箱」[13][38]。现阶段不建议做，但有两件不需要沙箱的事值得做：密钥类数据不过 IPC 回到 JS；出网走 CSP 白名单。

---

## 1. 事故，以及平台事后改了什么

### 1.1 VS Code Marketplace 与 Open VSX

- **扩展和编辑器权限相同。** VS Code 官方文档写明扩展宿主以和 VS Code 相同的权限运行，扩展可以读写文件、发网络请求、起外部进程 [1]。一篇学术论文指出扩展宿主进程没有沙箱，可以访问 VS Code 数据和本机文件 [50]。
- **GlassWorm（2025 年 10 月起）。** Koi Security 报告 10 月 17 日 7 个 Open VSX 扩展被入侵，之后扩散到微软市场；恶意代码用不可见的 Unicode 变体选择符隐藏；偷 npm、GitHub、Open VSX 凭据后用受害者账号继续发布带毒扩展；因为扩展默认自动更新，用户不做任何操作就中招 [4]。之后几波里，攻击者改成「先让包被市场接受，再推一个带恶意代码的更新，并刷下载量」[5]。
- **先干净后带毒的更新。** `juan-bianco.solidity-vlang` 在 2025-10-31 以完全无害的 0.0.7 发布，11-01 更新到带毒的 0.0.8（SleepyDuck）[6]。Knostic 报告的 SaassyCode 行动里，至少一例是先发干净版本、再走正常更新通道送恶意更新 [7]。
- **泄露的发布令牌。** Wiz 在扩展包里找到一百多个泄露的 Marketplace 发布令牌，可以直接给已有扩展推更新 [3]。Open VSX 这边，Eclipse 基金会吊销了泄露的令牌，缩短令牌默认有效期，并和 MSRC 一起加了令牌前缀以便扫描 [8]。
- **源码仓库被注入。** 2025 年 7 月，有人用一个 pull request 把破坏性提示词合进了 Amazon Q Developer 的 VS Code 扩展仓库，随 1.84.0 发到市场，AWS 之后撤下并发了 1.85.0 [11]。这说明「从源码构建」挡不住源码本身被改。
- **微软事后做的**（官方文档 [1]）：每个扩展包发布前用多个杀毒引擎扫描，扫描通过才公开；阻止抢占官方发布者和热门扩展的名字；「已验证发布者」蓝勾要求证明域名归属且在市场信誉良好满 6 个月；市场给所有扩展签名，安装时校验；恶意扩展从市场移除并进黑名单，**已安装的会被 VS Code 自动卸载**；1.97 起首次安装第三方发布者的扩展时弹出「是否信任该发布者」。微软 2025-06-11 的博客说当年已审查 136 个扩展、移除 110 个，并提到沙箱动态扫描和全市场定期重扫 [2]（未核实：该页面本次无法直接打开，内容来自搜索摘要）。
- **Open VSX 事后做的**：2026 年 2 月起对新发布的扩展做发布前检查（名字或命名空间冒充、误带的密钥、已知恶意模式），先只监控不拦截，3 月起强制；可疑上传先隔离等人工看 [9][55]。评论指出发布前扫描挡不住「可信发布者账号被盗后走正常通道发的更新」[55]（二手评论）。
- **误杀。** 2025 年 2 月微软以「重度混淆代码」为由下架 Material Theme（约 900 万安装）并封禁发布者，约两周后承认判断有误、恢复并道歉 [10]。自动卸载加误判，后果是几百万用户的东西凭空消失。

### 1.2 Obsidian

- Obsidian 官方承认「由于技术限制，无法可靠地把插件限制在特定权限内」，插件继承 Obsidian 自己的访问级别：读写本机文件、联网、安装其他程序 [13]。
- **2026-05-12 的改动** [12]：以前只有首次提交有人工审核，队列越积越长（上线前清了 2300 多个排队提交）；现在自动审核系统「扫描每一个版本的安全和代码质量，而不只是首次提交」，含恶意软件扫描；新版本没通过审核的 24 小时内从搜索里移除；每个插件有一张公开的计分卡；人工审核只留给热门、精选和被举报的插件；现有插件全部重审。计划中（「未来几个月」）：权限披露标签（网络、文件系统、剪贴板）、「已验证作者」、构件证明（artifact attestation）。**暂不再接受闭源插件。** Obsidian 自己说计分卡会有误报和漏报 [12]。
- **开发者政策** [14]：禁止混淆代码、禁止客户端遥测、禁止插件自己安装或更新自己或依赖、禁止联网加载的动态广告；联网、访问库外文件、服务端遥测、收费必须在 README 里披露；必须带 LICENSE；可以因恶意行为、屡次违规、不合作、无人维护而移除，恶意的可立即移除。
- **实际被利用的方式**：2026 年 4 月 Elastic 报告的 PHANTOMPULSE 行动不是插件被投毒，而是攻击者让受害者打开一个共享库并启用社区插件同步，用正常的 Shell Commands 插件执行命令 [15]（未核实：Elastic 原文未直接打开，来自 The Hacker News 转述）。教训：全信任模型下，**合法插件的配置本身就是攻击面**，带有「执行任意命令」能力的插件被别人的配置文件驱动时尤其危险。

### 1.3 npm（与插件更新直接相关的部分）

- **event-stream（2018）**：原维护者把发布权交给主动提出接手的陌生人，对方加了依赖 flatmap-stream，随后发了 0.1.1，恶意代码只存在于 npm 上的压缩版里、GitHub 上没有；从加入到被发现约两个半月，下载近 800 万次 [18]。这正是「发布包和源码不一致」要防的情况，也是「维护者换人」的典型。
- **chalk / debug（2025-09-08）**：维护者被仿冒 npm 支持的钓鱼邮件骗走账号（含 2FA），约 18 到 20 个包被发了恶意版本，存活约两个多小时 [17]。
- **Shai-Hulud（2025-09）**：自我复制的蠕虫，用被盗的维护者账号给热门包加恶意 post-install 脚本。GitHub 事后宣布：本地发布必须 2FA、弃用 TOTP 改 FIDO、可发布的细粒度令牌有效期缩到 7 天、弃用经典令牌、推广可信发布（trusted publishing）；并移除了 500 多个包 [16]。
- **带有效来源证明的恶意包（2026-05-11，TanStack）**：攻击者利用 `pull_request_target` 在基础仓库上下文里跑 fork 的代码，毒化 pnpm 缓存，在正式发布工作流里从运行器内存读出 OIDC 令牌直接发布；84 个恶意构件带着**完全有效**的 npm 来源证明（指向正确的仓库、工作流、ref）。SLSA 官方博客的结论：来源证明记录的是「在哪、怎么构建的」，不能确认构建的是作者想发布的代码；独立重建者在可复现构建时能发现被毒化的构建 [19]。
- **冷静期的证据**：William Woodruff 分析 10 起知名供应链攻击，其中 8 起的可利用窗口不到一周，估计 7 天冷静期能挡住大部分 [34]（未核实：原文未打开，数字来自 Socket 和 Simon Willison 的转述）。pnpm 10.16（2025-09）加了 `minimumReleaseAge`，pnpm 11 默认开 1 天 [34]。

### 1.4 浏览器扩展

- **The Great Suspender**：2020 年 6 月原作者把扩展卖给身份不明的买家，随后的版本里出现跟踪代码；2021-02-04 Google 下架并在用户浏览器里强制停用，用户挂起的标签页一并丢失 [22]。
- **Cyberhaven（2024-12-24）**：员工被钓鱼，攻击者拿到 Chrome Web Store 账号，发布恶意版本 24.10.4；只有在约 25 小时窗口内自动更新的浏览器受影响 [21]。同一批行动波及至少十几个扩展 [21]。
- **ShadyPanda（2025-12 披露）**：一个团伙 7 年里上架看上去正常的扩展，攒到 30 万以上安装后在 2024 年中推送带后门的更新，扩展每小时向外部服务器要指令并执行任意 JS；打开开发者工具时切换成无害行为。Koi 把长期没被发现归因于审核主要发生在首次提交、之后的更新审得少 [23]。
- **收购后变恶意**：2025 到 2026 年有多起扩展转手后很快收到恶意更新的报告（QuickLens、ShotBird、Save Image as Type）；有厂商称 Chrome Web Store 对所有权转移没有专门审核 [24]（未核实：均为安全厂商博客，没有查到 Google 官方的转移政策）。
- **Chrome 的规则**：更新走和新上架基本相同的审核；可以分比例发布（超过 1 万周活的才有），调比例不触发重新审核；可选的「Verified CRX Uploads」要求之后每个更新包都用开发者自己提供的密钥签名 [25]。2018 年起禁止混淆代码（包括从网上取来的代码），并对远程托管代码重点审查 [26]。
- **Firefox AMO**：允许压缩和转译后的代码，但必须提交处理前的源码和复现构建的说明，构建工具必须开源或可免费使用、能在审核员的机器上跑；2019 年 6 月起禁止混淆 [28]。

### 1.5 JetBrains、Raycast、Koishi

- **JetBrains Marketplace**：每个新插件和**每个新版本**都要经过审核，自动检查之后人工逐个看，通过才公开；可以重审已通过的插件并撤回批准 [27]。
- **Raycast**：扩展通过给公开的 `raycast/extensions` 单仓库提 PR 提交，人工审核通过、合并后自动发布到商店，所以**商店里的包是 Raycast 从审过的源码构建的**，更新同样是 PR [29]。运行时每个扩展一个 V8 isolate、限堆内存，但官方明说文件、网络和其他 Node 能力**没有沙箱** [29]。
- **Koishi**：插件发到 npm、满足命名和元信息规范就出现在市场里，官方发布文档没有提到安全审核环节 [51]（未核实：没有找到官方对「不安全」标记机制的说明）。
- DeepSeek Harness 的市场机制本次没有查（调用方已有调研）。

---

## 2. 适合全信任模型的对策

### 2.1 审每次更新，还是只审首次

| 平台 | 首次 | 更新 | 来源 |
|---|---|---|---|
| JetBrains | 人工 | 人工，每个版本 | [27] |
| Raycast | 人工看 PR | 人工看 PR（看的就是 diff） | [29] |
| Chrome | 自动加部分人工 | 同首次 | [25] |
| Obsidian（2026-05 起） | 自动，热门的人工 | 自动扫描每个版本 | [12] |
| VS Code | 自动扫描 | 自动扫描，定期全量重扫 | [1][2] |
| Open VSX（2026 起） | 发布前检查 | 同 | [9] |

没有一家仍然只看首次。小市场能负担的做法是 Raycast 式的：**更新是一个 PR，审的是 diff**。本方案里市场 CI 已经要从 tag 源码重建，索引条目的更新自然就是一个 PR，把两个 tag 之间的源码 diff、锁文件 diff、新增依赖列在 PR 里，人工成本很低。

### 2.2 分批发布与更新延迟

- Chrome 支持按比例发布 [25]；pnpm、Yarn 已把「新版本发布后等一段时间再装」做成默认 [34]。
- 依据：多数恶意版本几小时到几天内被发现并撤下 [17][21][34]。延迟对「潜伏很久才被发现」的无效（event-stream 两个半月、ShadyPanda 数年）[18][23]，所以它是补充，不能替代 diff 审核。

### 2.3 签名与来源证明能证明什么

- **市场签名**（VS Code）：证明包从上传后没被改，不证明安全 [1]。
- **来源证明**（npm provenance、GitHub artifact attestations、Sigstore）：把构件绑定到仓库、工作流和提交，默认达到 SLSA Build L2；证明「在哪构建」，不证明「构建的内容无害」，工作流被攻破时证明依然有效 [19][33]。
- **Chrome Verified CRX Uploads**：开发者自己的密钥签更新包，防的是商店账号被盗（Cyberhaven 那种）[21][25]。本方案的作者签名加 TOFU 和它是同一类，防的是「市场或发布账号被攻破后替换内容」。
- **TOFU 的弱点**：(1) 作者的签名私钥和他的 GitHub 令牌通常在同一台机器上，GlassWorm、Shai-Hulud 这类偷凭据的恶意软件会一起拿走 [4][16]；(2) 钥匙丢了要有恢复流程，恢复流程本身就成了社会工程的入口；(3) 作者卖掉或交出插件时把钥匙一起交出去，用户端完全看不出换人了 [18][22][24]。
- **索引签名**：TUF 列出的两类攻击和本方案直接相关：回滚攻击（给客户端旧的、签名有效的元数据）和无限冻结攻击（一直给同一份旧元数据，客户端不知道有新版本或新的撤销）；对策是元数据带版本号和过期时间、角色分离、阈值签名 [48]。Ed25519 签名本身不防这两种，撤销名单同样会被冻结。

### 2.4 JS 打包产物能不能复现

- **esbuild**：项目自己把「确定性输出」当作保证，更新日志里多次把破坏确定性的情况当 bug 修：ppc64le 和 s390x 上 Go 编译器的 FMA 优化让 CSS 颜色计算结果不同；并行解析遇到符号链接时 tsconfig 查找结果取决于先后顺序；入口文件依赖临时父目录名 [35]。Windows 上出现过 source map 路径里是 `\` 而不是 `/` 的回归 [35]。Debian 的可复现构建测试把 esbuild 多个版本标为可复现 [35]。结论：**同一版本、同一输入、同一操作系统和架构下基本可复现；跨版本不保证；跨操作系统主要风险在路径分隔符和 source map**。（未核实：esbuild 官方 FAQ 关于发布构建可复现的原话，本次只看到镜像页。）
- **Rollup / Vite**：出过多次不确定性：并行 `emitFile` 遇到内容相同的资源时文件名取决于先后（rollup #4909）；Vite 的 vendor chunk 哈希在重复构建间交替（vite #13672，加 `strictRequires` 后稳定）；CSS 映射顺序依赖并行的 `renderChunk`（vite PR #16588 修复）；哈希里带绝对路径导致换目录就变 [36]。结论：能做到，但坑比 esbuild 多，带内容哈希的多 chunk 输出尤其容易出问题。
- **zip 本身**：不可复现的常见原因是条目的修改时间、文件权限位、条目顺序；做法是把时间固定（`SOURCE_DATE_EPOCH` 或 1980-01-01）、排序后再写入、统一权限 [37]。
- **依赖安装**：`npm ci` 按锁文件装，`--ignore-scripts` 不跑安装脚本（Shai-Hulud 靠的就是 post-install）[16]。注意打包器的配置文件和插件本身就是会执行的代码，「不跑安装脚本」不等于「构建过程不执行作者的代码」；TanStack 事故就是构建任务里跑了不可信代码后读走了令牌 [19]。
- **实际做法**：固定打包器的精确版本、固定 Node 版本、两边都在同一个 Linux 容器里构建、单文件输出不带内容哈希、不带 source map 或路径相对化、比对解包后的文件哈希而不是 zip 字节。

### 2.5 「市场自己构建、发布市场构建的包」

- **F-Droid**：构建服务器从源码编译，再下载开发者的 APK 比对，只有签名文件不同才算通过，通过后分发的是**开发者签名的** APK；签名证书哈希对不上就拒绝。到 2023 年 9 月约 191 个应用做到了可复现；做不到的由 F-Droid 自己签名分发 [30]。
- **Raycast**：只发布从单仓库里审过的源码构建的包，没有「作者上传的包」这个东西 [29]。
- **Homebrew**：bottle 由官方 CI 构建，2024 年起附带 GitHub 构件证明（提交和工作流运行 ID），达到 SLSA Build L2 [32]。
- **Flathub**：人工审核提交，审核员检查权限和商标并试跑；「已验证」是另一回事，只证明发布者控制该应用 ID（域名 TXT 记录或代码托管账号）[31]。
- **Firefox AMO**：要求提交源码和构建说明，审核员自己复现 [28]。
- 对比：F-Droid 的「重建后比对」保留了作者签名，但要求可复现，实践中只有一部分应用做得到 [30]；Raycast / Homebrew 的「只发市场构建的」不需要可复现，但信任集中在市场的 CI 上，CI 被攻破就全军覆没（TanStack）[19]。本方案选的是 F-Droid 路线，前提是把 2.4 的可复现做扎实，否则会变成大量误报后被迫放宽。

---

## 3. 轻量隔离：各自的代价，谁放弃了什么

| 方案 | 能挡什么 | 代价 | 现状 |
|---|---|---|---|
| SES / Hardened JavaScript（Agoric、Endo） | `lockdown()` 冻结内置原型防原型污染；Compartment 里只能拿到显式给的全局对象 | 所有 Compartment 共用一个 JS agent，不防 CPU 和内存耗尽；宿主给出去的任何对象都要仔细包装，给了 DOM 就等于给了全部 | MetaMask Snaps 实际是 SES 外面再套 sandbox iframe；2023 年 Osec 仍在其沙箱层找到属性伪造漏洞 [40] |
| Realms shim | 同上的前身 | 安全性依赖精细包装 | **Figma 放弃**：shim 被私下报告了漏洞，Figma 改用编译成 WASM 的 JS 解释器 [38] |
| ShadowRealm | 独立的全局对象和内置对象 | 只能传原始值和可调用对象；没有 DOM | **仍在 Stage 2.7**（2025 年 2 月从 Stage 3 退回后的状态），浏览器没有可用实现 [39] |
| null-origin iframe 加消息传递 | 浏览器保证的隔离 | 全部异步；Figma 测得大文档序列化一次 14 秒 | Figma 只把它用于插件的 UI 部分 [38] |
| QuickJS / Duktape 编译成 WASM | 默认没有任何浏览器 API，只有宿主注入的 | 没有 JIT，慢；要下载 WASM；调试工具得自己做；插件不能直接碰 DOM | Figma 现行方案，配合约 500 行的底层接口层 [38] |
| Web Worker（非 UI 部分） | 没有 DOM；崩溃和卡死不拖主线程 | 异步 API；Worker 里仍有 `fetch`，要靠 CSP 限制 | VS Code Web 的扩展宿主用的是 Worker [50]（未核实：二手描述） |
| 独立进程（VS Code 扩展宿主） | 稳定性：卡死的扩展不拖累编辑器 | 不是安全边界，进程本身没有沙箱 | [1][50] |
| Deno 式权限 | 运行时强制的文件、网络、子进程权限 | 需要 Deno 运行时；给了 `--allow-run` 或 FFI 基本等于全开 | 官方文档建议只对特定可执行文件授予 `--allow-run` [42] |
| Node 权限模型 | 防可信代码误操作 | 官方明说**不对恶意代码提供安全保证**，可被绕过 | [41] |
| Tauri capabilities / isolation pattern | 按窗口限制能调哪些 IPC 命令；isolation 模式在前端和核心之间放一个沙箱 iframe 校验 IPC 消息 | 粒度是窗口，不是「同一个窗口里的哪段脚本」；插件和应用同在主窗口时区分不了调用者 | [43]（未核实：isolation 模式的细节来自文档镜像） |

对本方案的判断：

- 「插件可以改任何东西」意味着插件拿到主窗口的 DOM 和全局对象。此时 SES、Compartment、Proxy 这类同一 realm 内的防护都能被绕开，做了反而给人「有沙箱」的错觉。Obsidian 的官方说法就是「无法可靠地限制」[13]。
- 真正的边界只有三种：浏览器的（iframe、Worker、CSP）、进程的、Rust 一侧的。能便宜用上的是 **CSP** 和 **Rust 一侧不把密钥交回 JS**。
- 能力传递（插件只能通过宿主给的 `ctx` 对象做事）在同一 realm 里不是安全边界，但它让源码审核容易得多（审核员只要找绕过 `ctx` 的地方），也给以后把非 UI 部分搬进 Worker 留了路。Figma 的经验是：API 一旦按同步、直接访问设计，之后再加沙箱几乎要重写 [38]。

---

## 4. 面向用户的信任界面

### 4.1 提示的写法

- **VS Code 发布者信任提示**（1.97 起）：第一次安装某个第三方发布者的扩展时问「是否信任该发布者」；信任的对象是发布者而不是单个扩展；装扩展包时连带信任其依赖的发布者；命令行安装不会自动信任 [1]。
- **VS Code Workspace Trust**：针对「打开的文件夹」而不是扩展；官方承认它挡不住恶意扩展无视受限模式执行代码 [52]。
- **Obsidian 受限模式**：默认开启，第三方代码不运行；官方建议「只有信任所装插件的作者时才关闭」；处理敏感数据的用户被建议自己做独立安全审计 [13]。关闭时的对话框原文本次没有查到（未核实）。
- 可借鉴的点：(1) 问的是「信不信这个作者」，并把作者是谁、是否验证过身份摆出来；(2) 用具体后果代替抽象说法，Obsidian 列的是「读写你电脑上的文件、联网、安装其他程序」[13]；(3) 一次性的全局开关（Obsidian）之后每个插件就没有任何阻力了，按作者提示（VS Code）更细一些。
- 风险：非开发者用户对「和应用权限相同」这句话没有概念。对本应用应直接写出插件能拿到什么：剪贴板历史、邮箱和通知内容、截图、本机文件。

### 4.2 安全模式与二分排查

- VS Code 的 Extension Bisect（1.52 起）：像 git bisect 一样每次停用一半扩展，问用户问题还在不在，直到剩一个；官方提醒结果取决于用户回答是否准确 [44]。
- Firefox 的 Troubleshoot Mode：重启后停用所有附加组件和部分自定义，退出后恢复原状；可以从菜单进，也可以按住 Shift 启动 [45]。
- Obsidian 的受限模式同时充当安全模式，插件留在库里但不加载 [13]。
- 要点：安全模式必须有**不依赖界面**的入口（启动参数或按键），因为全信任插件可以把界面弄到进不了设置。

### 4.3 不靠遥测发现坏插件

- **拉取式黑名单**：VS Code 客户端拉黑名单后自动卸载 [1]，不需要上报用户装了什么。本方案的撤销名单是同一做法。
- **每个版本的自动扫描加公开计分卡**（Obsidian）[12]：检测发生在市场一侧。
- **独立重建**：重建结果不一致本身就是信号 [19][30]。
- **举报渠道**：Obsidian 的流程是先在插件仓库开 issue，7 天没回应再找官方，严重的直接找官方 [14]。
- **本地可见性**（不出本机）：给用户看每个插件声明的联网域名、上次审核的版本和当前版本是否一致、最近一次更新改了什么。Obsidian 计划中的权限披露标签属于这类 [12]。
- 自动停用（出错多、CPU 高）抓的是写得差的插件。恶意插件通常很安静，ShadyPanda 还会在开发者工具打开时装无害 [23]。

### 4.4 远程撤销（kill switch）的设计与滥用顾虑

- **误杀**：Material Theme 被误判后从数百万台机器上自动卸载，两周后才恢复 [10]。The Great Suspender 被强制停用时用户丢了挂起的标签页 [22]。
- **基础设施故障变成全体停用**：2019-05-04 Firefox 用于附加组件签名的中间证书过期，所有附加组件被停用且无法安装，Mozilla 约 9 小时后通过 Normandy 推送修复 [46]。教训：签名或撤销检查的失败模式不能是「全部停用」。
- **被施压下架**：2024 年 6 月 Mozilla 应俄罗斯监管机构要求在俄区下架了几个反审查扩展，遭批评后恢复 [47]。有远程撤销能力就会收到这类要求。
- 设计建议：撤销是**停用并说明原因**，不是删除，数据保留；撤销名单在公开仓库里，每条有理由和链接，可申诉；区分「恶意」（强制停用）和「违规或无人维护」（只是不再分发、提示用户）；撤销名单取不到或签名过期时提示而不是停用全部；撤销名单的签名密钥和日常 CI 分开。

---

## 5. 市场通常有的规则

- **开发者政策**：禁止混淆、禁止远程加载代码、禁止自更新、禁止客户端遥测、联网和访问范围必须披露（Obsidian [14]，Chrome [26]，AMO [28]）。
- **源码与许可证**：Obsidian 要求 LICENSE 文件并遵守所用代码的许可证，暂不接受闭源 [12][14]；AMO 要求可复现的源码 [28]；Raycast 全部开源 [29]。
- **下架流程**：Obsidian 写明了理由（违规、恶意、不合作、屡犯、无人维护或严重损坏）和流程（先联系、给期限，恶意的立即移除）[14]；JetBrains 保留重审和撤回批准的权利 [27]。
- **抢注和仿冒名**：npm 2017 年起新包名去掉标点后和已有包相同就拒绝发布（`reactnative` 对 `react-native`）[49]；VS Code 阻止抢占官方发布者和热门扩展的名字 [1]；Open VSX 的发布前检查包含名字和命名空间冒充 [9]；Obsidian 禁止以让人误以为是官方的方式使用「Obsidian」商标 [14]。
- **保留命名空间与身份验证**：Flathub 用域名 TXT 记录或代码托管账号验证应用 ID 归属 [31]；VS Code 的蓝勾要求域名验证加 6 个月良好记录 [1]；Obsidian 的「Official」标签只有官方人员能加 [12]。
- **所有权转移**：没有查到哪家有成文且严格的规则，这正是反复出事的地方 [18][22][24]。
- **举报与安全联系**：Obsidian 要求通过插件的 security.md 或 README 报告漏洞，严重的同时联系官方 [13]。

---

## 6. 对本方案的建议（按「便宜且收益高」排序）

### 第一档：几乎不花成本，堵的是最常见的攻击

1. **更新也要过审，审 diff。** 索引条目的每次更新是给市场仓库的一个 PR；CI 在 PR 里自动贴出：两个 tag 之间的源码 compare 链接、锁文件 diff 和新增依赖、新出现的敏感调用（`fetch`、`eval`、`new Function`、动态 `import()`、`invoke` 到敏感命令、shell、写插件目录外的文件）。没有这些变化的更新可以快速通过，有的必须人看。依据：[6][7][12][23][27][29]。
2. **更新冷静期。** 新版本进索引后默认 3 到 7 天才自动安装；用户可以手动立即更新；维护者可以把某个版本标成「安全修复，立即推」。新安装也默认给上一个已过冷静期的版本。依据：[17][21][34]。
3. **禁止远程加载代码、混淆和自更新，写进政策并用 CSP 强制。** `script-src` 不给 `unsafe-eval`、不允许远程脚本。否则审过的包可以在运行时再去取真正的载荷（ShadyPanda 每小时取一次指令 [23]，GlassWorm 的加载器从 GitHub 取载荷 [4]），所有审核和重建比对都落空。依据：[14][26][28]。
4. **索引和撤销名单加版本号与过期时间。** 客户端拒绝版本号比已见过的小的索引，过期后提示「市场信息过期」。撤销名单取不到时不停用任何东西，但提示。依据：[46][48]。
5. **钉提交号，不钉 tag。** tag 可以被移动；索引里记完整的提交哈希，重建和 diff 都基于它。（xz 的教训是发布包和仓库之间差的那一点没人看 [20]。）
6. **作者换钥匙、换人、换仓库，一律当作重新上架。** 走维护者审核的 PR，客户端对已安装用户显示「此插件的作者或签名密钥已更换」并要求重新确认，这次更新不自动装。依据：[18][22][24]。

### 第二档：要写一些代码

7. **把重建 CI 当作在跑恶意代码来设计。** 重建任务：无任何密钥、无写权限的令牌、不恢复也不保存共享缓存、不用 `pull_request_target` 跑 fork 代码、`npm ci --ignore-scripts`、容器跑完即弃；**签名在另一个任务里做**，只接收重建任务产出的哈希。打包配置由市场提供（固定命令加固定配置），不执行作者仓库里的打包器配置和插件，否则「无安装脚本」形同虚设。依据：[16][19]。
8. **把可复现做扎实再上线强制比对。** 固定打包器精确版本和 Node 版本，作者和市场都在同一个 Linux 容器里构建（给作者一个可复用的 GitHub Actions 工作流），单文件输出、无内容哈希、source map 不带绝对路径，zip 固定时间戳并排序，比对解包后的逐文件哈希。先以「只告警」模式跑一段时间看误报率（Open VSX 就是先监控一个月再强制 [9]）。依据：[30][35][36][37]。
9. **密钥类数据不回到 JS。** 邮箱密码、令牌这类只在 Rust 一侧使用，没有任何 IPC 命令把明文返回给前端。这是全信任模型下少数真实有效的减损措施，因为它不依赖区分调用者。
10. **出网白名单。** 插件在 manifest 里声明要连的域名，审核时看，安装提示里显示；主窗口的 CSP `connect-src` 合并所有已启用插件声明的域名。同一 realm 里它拦不住走 Rust 命令出网的路，所以 Rust 一侧的通用 HTTP 命令也要按同一份白名单检查。它不是沙箱，但把「悄悄把剪贴板发到陌生服务器」从零成本变成需要在审核里露面。
11. **安全模式有界面之外的入口**（启动参数或启动时按住某个键），并提供二分排查。依据：[44][45]。
12. **撤销按第 4.4 节设计**：停用不删除、公开理由、分级、可申诉、签名密钥离线。依据：[10][22][46][47]。

### 第三档：以后再说，但现在别把路堵死

13. **插件 API 走宿主给的 `ctx` 对象**，不鼓励直接摸全局对象和内部模块；不是安全边界，但让审核可行，也给以后把非 UI 逻辑放进 Worker 留余地 [38]。
14. **市场仓库自身的防护**：维护者账号用 FIDO 2FA、分支保护、Actions 按提交哈希固定、索引签名密钥不放在会跑第三方代码的工作流里 [16][19]。
15. **成文的开发者政策**：照第 5 节列的项目写一页，含命名规则（去标点后不得与已有插件或官方名相同、保留官方前缀）、许可证要求、下架与申诉流程、所有权转移规则、漏洞报告方式。

### 容易给人虚假安全感的地方

- **「发布包与源码构建一致」**：只说明包里没有源码之外的东西。恶意作者、被盗账号、被投毒的依赖都会通过。界面上不要出现「已验证」这类不带限定的词，要写就写「此版本由市场从公开源码构建并比对一致」。依据：[11][19]。
- **「首次上架时读过源码」**：只对那一个版本成立。界面上若显示「已审核」，必须带版本号；当前安装的版本没被人看过时要如实显示。Obsidian 自己都说计分卡有误报和漏报 [12]。
- **作者签名加 TOFU**：防的是市场或分发渠道被攻破，不防作者机器被攻破（签名私钥和 GitHub 令牌会一起丢）[4][16]，也不防作者卖掉插件 [22][24]。
- **出错或 CPU 过高自动停用**：这是稳定性功能。恶意插件不会报错也不会占 CPU，在文档和界面里不要把它列为安全措施 [23]。
- **安装提示**：一次性的提示会被习惯性点掉，它的作用是告知和划清责任，不是防护。VS Code 加了发布者信任提示之后恶意扩展事故并没有停 [1][5][6]。
- **撤销名单**：只在事后有用，且依赖有人发现并上报；从恶意版本发布到被发现，短的几小时 [17]，长的几个月到几年 [18][23]。
- **Ed25519 签名的索引**：没有版本号和过期时间时不防回滚和冻结 [48]。

---

## 来源

1. VS Code 文档，Extension runtime security：https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security
2. Microsoft，Security and Trust in Visual Studio Marketplace（2025-06-11；页面本次未能直接打开，内容来自搜索摘要）：https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace/
3. Wiz，Dismantling a Critical Supply Chain Risk in VSCode Extension Marketplaces：https://www.wiz.io/blog/supply-chain-risk-in-vscode-extension-marketplaces
4. The Hacker News，Self-Spreading GlassWorm Infects VS Code Extensions：https://thehackernews.com/2025/10/self-spreading-glassworm-infects-vs.html ；Truesec：https://www.truesec.com/hub/blog/glassworm-self-propagating-vscode-extension
5. BleepingComputer，GlassWorm malware returns in third wave：https://www.bleepingcomputer.com/news/security/glassworm-malware-returns-in-third-wave-of-malicious-vs-code-packages/
6. The Hacker News，Malicious VSX Extension SleepyDuck：https://thehackernews.com/2025/11/malicious-vsx-extension-sleepyduck-uses.html
7. Knostic，Update and infect: how the SaassyCode campaign grew：https://www.knostic.ai/blog/update-and-infect-how-the-saassycode-campaign-grew-from-two-extensions-to-nineteen
8. Eclipse Foundation，Open VSX security update, October 2025：https://blogs.eclipse.org/post/mikaël-barbero/open-vsx-security-update-october-2025 ；The Hacker News：https://thehackernews.com/2025/10/eclipse-foundation-revokes-leaked-open.html
9. Eclipse Foundation，Strengthening supply-chain security in Open VSX：https://blogs.eclipse.org/post/christopher-guindon/strengthening-supply-chain-security-open-vsx
10. SC Media，Microsoft restores VS Code theme flagged as malicious：https://scworld.com/news/microsoft-restores-vs-code-theme-flagged-as-malicious-we-messed-up ；下架报道：https://scworld.com/news/vs-code-theme-with-nearly-4m-installs-removed-due-to-security-red-flags
11. The Register，Compromised Amazon Q extension told AI to delete everything：https://www.theregister.com/2025/07/24/amazon_q_ai_prompt/
12. Obsidian，The future of plugins（2026-05-12）：https://obsidian.md/blog/future-of-plugins/
13. Obsidian 帮助，Plugin security：https://obsidian.md/help/plugin-security
14. Obsidian 开发者文档，Developer policies：https://docs.obsidian.md/Community+directory/Developer+policies
15. The Hacker News，Obsidian Plugin Abuse Delivers PHANTOMPULSE：https://thehackernews.com/2026/04/obsidian-plugin-abuse-delivers.html ；Elastic 原文（未直接打开）：https://www.elastic.co/security-labs/phantom-in-the-vault
16. GitHub，Our plan for a more secure npm supply chain：https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/
17. The Hacker News，20 Popular npm Packages With 2 Billion Weekly Downloads Compromised：https://thehackernews.com/2025/09/20-popular-npm-packages-with-2-billion.html ；StepSecurity：https://www.stepsecurity.io/blog/20-popular-npm-packages-compromised-chalk-debug-strip-ansi-color-convert-wrap-ansi
18. Snyk，A post-mortem of the malicious event-stream backdoor：https://snyk.io/blog/a-post-mortem-of-the-malicious-event-stream-backdoor
19. SLSA，Mini Shai-Hulud: what SLSA can and cannot do（2026-05）：https://slsa.dev/blog/2026/05/mini-shai-hulud-what-slsa-can-and-cannot-do
20. xz 后门 FAQ（Sam James）：https://gist.github.com/thesamesam/223949d5a074ebc3dce9ee78baad9e27 ；debian-devel 讨论：https://lists.debian.org/debian-devel/2024/03/msg00367.html
21. Cyberhaven，Chrome extension security incident：https://cyberhaven.com/blog/cyberhavens-chrome-extension-security-incident-and-what-were-doing-about-it ；Security Affairs：https://securityaffairs.com/172491/hacking/chrome-browser-extensions-compromise.html
22. 9to5Google，The Great Suspender removed for containing malware：https://9to5google.com/2021/02/04/the-great-suspender-extension-has-been-removed-from-chrome-web-store-for-containing-malware/
23. The Register，Stealthy browser extensions waited years（ShadyPanda）：https://www.theregister.com/2025/12/01/chrome_edge_malicious_browser_extensions/ ；The Hacker News：https://thehackernews.com/2025/12/shadypanda-turns-popular-browser.html
24. Aviatrix，Chrome extension ownership transfer malware injection 2026：https://aviatrix.ai/threat-research-center/chrome-extension-ownership-transfer-malware-injection-2026 ；Spin.AI：https://spin.ai/blog/the-ownership-transfer-blind-spot/ （均为厂商博客）
25. Chrome 开发者文档，Update your Chrome Web Store item：https://developer.chrome.com/docs/webstore/update ；Review process：https://developer.chrome.com/docs/webstore/review-process
26. Chromium Blog，Trustworthy Chrome Extensions, by default（2018）：https://blog.chromium.org/2018/10/trustworthy-chrome-extensions-by-default.html
27. JetBrains Marketplace Approval Guidelines：https://plugins.jetbrains.com/docs/marketplace/jetbrains-marketplace-approval-guidelines.html
28. Mozilla，Add-on Policies：https://addons.mozilla.org/en-US/developers/docs/policies ；政策更新讨论：https://discourse.mozilla.org/t/add-ons-policies-changes-june-2025/144331
29. Raycast 开发者文档，Security：https://developers.raycast.com/information/security ；Publish an extension：https://developers.raycast.com/basics/publish-an-extension
30. F-Droid，Reproducible builds, signing keys, and binary repos：https://f-droid.org/en/2023/09/03/reproducible-builds-signing-keys-and-binary-repos.html
31. Flathub 文档，Verification：https://docs.flathub.org/docs/for-app-authors/verification ；Requirements：https://docs.flathub.org/docs/for-app-authors/requirements
32. Trail of Bits，A peek into build provenance for Homebrew：https://blog.trailofbits.com/2024/05/14/a-peek-into-build-provenance-for-homebrew/
33. GitHub 文档，Artifact attestations：https://docs.github.com/en/actions/concepts/security/artifact-attestations
34. Socket，Dependency Cooldown：https://socket.dev/glossary/dependency-cooldown ；Simon Willison 对 Woodruff 文章的摘录：https://simonwillison.net/2025/Nov/21/dependency-cooldowns ；pnpm：https://pnpm.io/blog/2025/12/05/newsroom-npm-supply-chain-security
35. esbuild CHANGELOG：https://github.com/evanw/esbuild/blob/main/CHANGELOG.md ；esbuild FAQ（未直接打开）：https://esbuild.github.io/faq/ ；Debian 可复现构建测试：https://tests.reproducible-builds.org/debian/rb-pkg/bookworm/amd64/golang-github-evanw-esbuild.html
36. Rollup issue #4909：https://github.com/rollup/rollup/issues/4909 ；Vite issue #13672：https://github.com/vitejs/vite/issues/13672 ；Vite PR #16588：https://github.com/vitejs/vite/pull/16588 ；复现仓库：https://github.com/ttionya/vite-non-deterministic-build-repro
37. Reproducible Builds，Archive metadata：https://reproducible-builds.org/docs/archives/ ；Timestamps：https://reproducible-builds.org/docs/timestamps/
38. Figma，How to build a plugin system on the web and also sleep well at night：https://www.figma.com/blog/how-we-built-the-figma-plugin-system/ ；An update on plugin security：https://madebyevan.com/figma/an-update-on-plugin-security/
39. TC39 proposal-shadowrealm：https://github.com/tc39/proposal-shadowrealm ；Igalia 2025 年 2 月全会纪要：https://blogs.igalia.com/compilers/2025/03/27/summary-of-the-february-2025-tc39-plenary/
40. SES README：https://github.com/endojs/endo/blob/HEAD/packages/ses/README.md ；LavaMoat：https://lavamoat.github.io/about/runtime-environment/ ；Osec，MetaMask Snaps: playing in the sand：https://osec.io/blog/2023-11-01-metamask-snaps/
41. Node.js 文档，Permissions：https://nodejs.org/api/permissions.html
42. Deno 文档，Security and permissions：https://docs.deno.com/runtime/fundamentals/security
43. Tauri 2 文档，Capability：https://v2.tauri.app/reference/acl/capability/ ；Isolation pattern（未直接打开）：https://v2.tauri.app/concept/inter-process-communication/isolation/
44. VS Code 博客，Resolving extension issues with bisect：https://code.visualstudio.com/blogs/2021/02/16/extension-bisect
45. Mozilla 支持，Troubleshoot Mode：https://support.mozilla.org/en-US/kb/diagnose-firefox-issues-using-troubleshoot-mode
46. Mozilla Wiki，Add-ons Expired Certificate Technical Report：https://wiki.mozilla.org/Add-ons/Expired-Certificate-Technical-Report
47. OSnews，Mozilla removes anti-censorship extensions：https://www.osnews.com/story/139928/under-pressure-from-russian-censors-mozilla-removes-anti-censorship-extensions/ ；恢复：https://www.osnews.com/story/139943/exclusive-mozilla-reverses-course-re-lists-extensions-it-removed-in-russia/
48. The Update Framework，Security：https://theupdateframework.io/security/
49. npm，New package moniker rules（2017）：https://blog.npmjs.org/post/168978377570/new-package-moniker-rules
50. Developers Are Victims Too: A Comprehensive Analysis of The VS Code Extension Ecosystem（arXiv 2411.07479）：https://arxiv.org/pdf/2411.07479
51. Koishi 文档，发布插件：https://koishi.chat/en-US/guide/develop/publish
52. VS Code 文档，Workspace Trust：https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
53. （并入 16）
54. （并入 25）
55. The Hacker News，Eclipse Foundation Mandates Pre-Publish Security Checks for Open VSX：https://thehackernews.com/2026/02/eclipse-foundation-mandates-pre-publish.html

## 未核实项汇总

- [2] 微软 2025-06 博客的细节（136 审查、110 移除、沙箱扫描、定期重扫）：页面打不开，来自搜索摘要。
- [15] PHANTOMPULSE 的细节：来自二手报道，Elastic 原文未打开。
- [24] Chrome 扩展所有权转移后的恶意更新案例和「转移无专门审核」的说法：均为安全厂商博客，没有 Google 官方政策佐证。
- [34] Woodruff「10 起里 8 起窗口不到一周」：原文未打开。pnpm 各版本的默认值在不同来源里说法不一。
- [35] esbuild 官方 FAQ 关于可复现的原话；「跨操作系统输出一致」没有找到官方的正式保证，结论是从更新日志里的修复记录推出来的。
- [39] ShadowRealm 2026 年的最新阶段：仓库页面显示 Stage 2.7，没有找到 2026 年的会议记录。
- [43] Tauri isolation 模式的细节来自文档镜像。
- [50] VS Code Web 扩展宿主运行在 Worker 里：二手描述。
- Obsidian 关闭受限模式时对话框的原文没有查到。
- Koishi 市场是否有安全标记或审核：官方发布文档未提及，没有找到正式说明。
- DeepSeek Harness 的市场机制本次没有调研。
