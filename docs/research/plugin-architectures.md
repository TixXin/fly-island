# 同类插件架构：VS Code、Obsidian、Raycast、Koishi / Cordis 等怎么做

> 日期：2026-11-14。问题：浮屿要做「万物皆插件」（插件平台第 3 版），可比的系统是怎么搭的、清单里有哪些字段、踩过哪些坑。范围：VS Code、Obsidian、Raycast、Koishi 与 Cordis（读了 `cordiverse/cordis`、`koishijs/webui` 源码）、DeepSeek Harness、Zed、Figma、Logseq、Joplin、几个 Tauri 应用，以及 Grafana、Backstage、JupyterLab、Theia 的界面扩展点；官方文档、仓库源码和 issue。相关方案：[v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)。结论在最后两节「清单字段对照表」和「经验和坑」，方案已按它们修改。

调研日期：2026-11-14。方括号数字指向文末来源表。标「未核实」的是这次没能在一手来源里读到原文、只凭记忆或二手资料的说法，用之前要再查。

目标设计（对照用）：Tauri 2 桌面应用，内置功能全部做成插件；插件同进程、完全信任、没有权限表；内核用 Cordis；界面用带类型的 slot 拼；服务按名字可替换；清单写在 package.json 的 `fuyu` 键下；市场是精选加签名。

---

## 1. VS Code

**扩展宿主进程。** 扩展不在界面进程里跑，而在单独的 Extension Host 里。宿主有三种：本地 Node.js、Web（WebWorker）、远程 Node.js；桌面版同时有本地和 Web 两个宿主。官方给的理由是「行为不端的扩展不应影响用户体验」：不能拖慢启动、不能拖慢界面操作、不能改界面 [1]。extension bisect 那篇博客也说，因为扩展在另一个进程里，坏扩展不该卡住编辑器或妨碍保存 [5]。

**贡献点（contribution points）。** 在 package.json 的 `contributes` 下用 JSON 静态声明，当前有约 38 个：commands、menus、keybindings、configuration、views、viewsContainers、themes、languages、grammars、snippets、walkthroughs、authentication、languageModelTools 等 [3]。关键性质：不运行扩展代码就能知道它往哪里加了什么，菜单、设置页、命令面板都能在扩展激活前画出来。

**激活事件。** 扩展声明 `activationEvents`，宿主按事件懒加载：`onLanguage`、`onCommand`、`onView`、`onUri`、`workspaceContains`、`onStartupFinished`、`*` 等 [4]。要点：
- `*` 是每次启动都激活，文档明说只在别的组合都不行时才用；`onStartupFinished` 类似 `*` 但不拖慢启动，在所有 `*` 扩展激活完之后才触发 [4]。
- 1.74 起，贡献了命令、语言、视图、自定义编辑器、认证提供方的扩展不用再手写对应激活事件，由贡献点隐式推出 [4]。这是「清单里的静态声明既用于展示，也用于推导何时加载」的例子。

**Proposed API 通道。** 新 API 先以 proposal 形式出，理由是「API 一旦发布就很难再改」。扩展在 package.json 的 `enabledApiProposals` 里按名字逐个声明；只在 Insiders 可用，用了 proposal 的扩展不能发布到市场；类型定义是单独的 `vscode.proposed.<name>.d.ts`，用 `npx @vscode/dts dev` 拉 [6]。

**内置扩展用公开 API。** microsoft/vscode 仓库的 `extensions/` 目录下有约 104 个条目（本次用 GitHub API 数的）[7]；内置的 git 扩展自己的 package.json 里就有一长串 `enabledApiProposals`（contribSourceControlHistoryItemMenu 等）[8]。也就是说内置扩展走同一套扩展 API，但可以先用还没稳定的 proposal，等于拿自己当第一批用户。扩展之间互相提供 API 的方式是 `activate()` 的返回值，消费方在 `extensionDependencies` 里声明，再 `extensions.getExtension(id).exports` 取 [9]。
- 未核实：product.json 里用 `extensionEnabledApiProposals` 给指定的第三方扩展（如微软自己的扩展）开白名单。本次在 product.json 里没搜到这个键，可能在别的构建配置里。

**Extension bisect。** `Help: Start Extension Bisect`：像 git bisect 一样每轮禁用一半扩展，问用户「现在好了」还是「还是坏的」，步数是 log2(N)+1；第一轮先禁用全部，用来区分是 VS Code 自己的问题还是扩展的问题。博客里的背景数字：用户常装 50 个以上扩展，市场当时有 28000 多个 [5]。

**性能归因。** `Developer: Show Running Extensions` 打开一个编辑器，列出运行中的扩展，可以在这里开始/停止对扩展宿主的 CPU profile，并有「Report Issue」按钮把问题直接报给对应扩展；`Startup Performance` 命令给出启动各阶段计时；`code --prof-startup` 写启动 CPU profile [10]。社区资料说这个视图会显示每个扩展的激活耗时（毫秒）和触发它的激活事件 [11]（二手来源）。
- 未核实：扩展宿主无响应时自动抓 profile 并指出是哪个扩展（「extension host unresponsive」提示）。官方 wiki 的这一页没写 [10]。

**市场用到的清单字段。** 必填只有 `name`、`version`、`publisher`、`engines.vscode`（不能是 `*`）。市场展示用：`displayName`、`description`、`categories`（固定列表）、`keywords`（最多 30 个）、`icon`（至少 128×128）、`galleryBanner`、`preview`、`badges`（只允许受信的地址前缀）、`markdown`、`qna`、`sponsor`、`pricing`（Free/Trial）、`license`。加载器用：`main`、`browser`、`contributes`、`activationEvents`、`extensionDependencies`、`extensionPack`、`extensionKind`（ui/workspace）、`capabilities`（untrustedWorkspaces、virtualWorkspaces）、`enabledApiProposals` [2][6]。

---

## 2. Obsidian

**同进程、完全信任。** 官方原话：因为技术限制，Obsidian 无法可靠地把插件限制在特定权限或访问级别内；插件拥有和 Obsidian 本体一样的访问能力，能读电脑上的文件、联网、装别的程序 [12]。这是和本设计最接近的信任模型。

**受限模式（Restricted mode）。** 默认开着，用来阻止第三方代码运行；开着的时候插件文件还留在库里，只是不加载 [12]。它也是事实上的「安全模式」：有用户靠临时开受限模式把移动端启动从约 30 秒降到 5 秒 [16]（二手）。

**审核。** 现在的说法：每个插件版本都会被自动扫描（漏洞、代码质量、恶意代码），结果以「安全评分卡」显示在插件目录页；热门、精选和被举报的插件另有人工审核 [12]。提交流程：在 community.obsidian.md 登录、关联 GitHub 验证仓库归属、添加插件；目录读默认分支 HEAD 上的 manifest.json；自动审核的错误没解决前，插件不能在应用内安装 [13]。
- 未核实（历史做法）：早先是给 obsidianmd/obsidian-releases 仓库的 `community-plugins.json` 提 PR（id、name、author、description、repo），机器人加人工首次审核，后续版本不再审。当前文档已不这么写 [13]，什么时候换的没查到。
- 未核实：Developer policies 的具体条款（禁止混淆、禁止自更新、禁止客户端遥测等）。文档页这次打不开。

**发布物。** GitHub release，tag 必须和 manifest 的 `version` 完全一致；附件是 `main.js`、`manifest.json`，可选 `styles.css`；用户更新就是应用内从 GitHub release 下载 [13]。即：一个打包好的单文件 JS，加清单，加一个样式表。

**manifest.json 字段。** `id`（只能小写字母和连字符，不能含 `obsidian`，不能以 `plugin` 结尾）、`name`、`version`（x.y.z）、`minAppVersion`、`description`、`author`、`isDesktopOnly` 必填；`authorUrl`、`fundingUrl`（字符串或「标签→地址」对象）可选 [14]。

**versions.json / minAppVersion。** `versions.json` 是「插件版本 → 该版本要求的最低应用版本」的表。用户的应用比 manifest 里的 `minAppVersion` 旧时，Obsidian 去查这张表，装能用的最新那个旧版本。只有改 `minAppVersion` 时才需要更新它 [15]。

**已知痛点。**
- 启动：Obsidian 在用户能操作之前加载完全部插件，所以每个插件的 `onload` 都直接算进启动时间。官方指南要求 `onload` 只做注册（命令、视图类型、后处理器），重活放进 `workspace.onLayoutReady`；自定义视图要做成可延迟的；还有个坑是库初始化时会给每个已有文件发一次 `create` 事件 [17]。
- 1.7.x 加了启动耗时调试视图（设置 → 通用 → 高级），并会在启动时提示某插件加载太久、建议禁用 [16]（二手，来自论坛和插件 issue）。
- 归因不准：有用户报告 Android 上约 1.3 秒插件启动时间落在「Other」里，说不清属于哪个插件 [16]（二手）。
- 社区自己做了「按需加载插件」的插件来补官方没有的懒加载 [16]（二手）。
- 未核实：插件互相打补丁（monkey-patch 内部对象）导致的冲突、依赖未公开内部 API 在升级时坏掉。这是常见说法，这次没找到一手来源。

---

## 3. Raycast

**架构。** 不嵌 Node，而是自己下载并管理一个外部 Node 运行时，作为单独进程跑；Node 进程崩了（基本）不会带崩 Raycast。每个扩展在一个 worker thread 里，也就是各有一个 V8 isolate 和事件循环；可以设内存上限，worker 崩了只显示错误页 [18]。

**界面在进程外渲染。** 开发者写 React 加 Raycast 的组件，Raycast 自己实现 reconciler，产出一份 JSON 描述的界面树，和上一次渲染做 JSON Patch 比较，再通过标准文件描述符上的 JSON-RPC 发给原生端更新 AppKit 视图。扩展只能发已注册的消息，调不到任意 Raycast 代码 [18]。结果是扩展只能用宿主给的那几种界面形态（List、Form、Detail 等），换来的是所有扩展看起来一致。

**不做沙箱。** 考虑过进程级和 JS 引擎级沙箱，都放弃了，改成尽量不让坏扩展被装上：扩展开源，放在一个公开的单仓库里，每次提交走 PR，先过自动检查（清单、lint、商店素材），再人工审核和试用 [18]。

**清单（package.json 顶层）。** 扩展级：`name`、`title`、`description`、`icon`（512×512 PNG，可有 `@dark` 版）、`author`（商店账号）、`platforms`（macOS/Windows）、`categories` 必填；`commands`、`tools`、`ai`、`owner`、`access`、`contributors`、`pastContributors`、`keywords`、`preferences`、`external` 可选 [19]。
- 命令：`name`（对应入口文件 `src/<name>.ts`）、`title`、`description`、`mode`（`view` / `no-view` / `menu-bar`）必填；`subtitle`、`icon`、`interval`（后台运行间隔，最小 1m）、`keywords`、`arguments`、`preferences`、`disabledByDefault` 可选 [19]。
- 偏好设置：`name`、`title`、`description`、`type`（textfield / password / checkbox / dropdown / appPicker / file / directory）、`required` 必填；`placeholder`、`default`（可按平台给）可选。命令级偏好继承扩展级的，同名覆盖 [19]。宿主据此自动生成设置界面，扩展不用自己画。

**商店要求。** MIT 许可、带 package-lock.json、图标不能用默认的、最多 6 张 2000×1250 截图、根目录要有 CHANGELOG.md、不许外部统计、申请钥匙串访问的会被拒、二进制依赖只能从自己不控制的服务器下载并校验哈希、只支持美式英语且不许自己做本地化 [20]。

---

## 4. Koishi 与 Cordis（最接近的先例）

### 4.1 Cordis 4 的概念

状态：`cordis` 包当前是 `4.0.0-rc.13`，README 明说「正在积极开发，API 还不稳定，可能不经通知就变」，官方文档指向 DeepSeek Harness 仓库里的 Cordis primer [21]。下面的行为是直接读源码和 DSH 的文档得到的。

- **Context。** 是个 Proxy；`ctx.<名字>` 的访问会被拦截去找服务。插件运行时拿到的是自己的 context，访问没在 `inject` 里声明的服务会抛 `cannot get property "x" without inject` [22]。所以依赖是强制声明的，不是约定。
- **插件。** 一个带可选 `inject` 和 `apply(ctx)` 的函数/对象，或一个 `Service` 子类 [23]。
- **inject。** 类型是 `(keyof M)[] | { [K in keyof M]?: M[K] }`：数组，或「服务名 → 给该服务的配置」的对象 [24]。插件等到声明的服务都存在才加载，「加载顺序用服务依赖表达，不靠手工排启动顺序」[23]。注意这和 Koishi 4 的 `{ required, optional }` 写法不同（见 4.2）。
- **Service。** `class X extends Service`，构造时用 `ctx.reflect.provide(name, self)` 登记；名字可来自类的静态 `provide` 字段 [25]。
- **effect / dispose。** `ctx.effect(() => 清理函数)`；effect 可以返回函数、Promise、同步或异步迭代器（迭代器形式可以逐步登记多个可撤销的副作用）；清理按登记的相反顺序执行 [26]。DSH 的规矩：每个注册都要有清理函数；清理顺序有讲究的，放进同一个 effect [23]。
- **Fiber 状态。** `PENDING`、`LOADING`、`ACTIVE`、`FAILED`、`DISPOSED`、`UNLOADING` [26]。
- **同名服务冲突。** `provide` 时如果同一个隔离域里已经有这个名字，直接抛 `service "x" has been registered at <某插件>` [22]。也就是说 Cordis 没有「后来的覆盖先来的」或优先级；同一时刻一个名字只有一个提供者，要替换就得先卸掉原来的，或者用 isolate。
- **isolate。** `ctx.isolate(name)` 给这个名字换一个新的 symbol，于是这棵子树里看到的是另一份服务实例 [27]。配置里一个 group 可以 isolate 某个服务名，两个 group 各看到配置不同的同名提供者 [28]。
- **intercept。** `ctx.intercept(name, config)` 给子树里对某个服务的使用附加配置，服务端用 `resolveIntercept` 合并 [25][27]。
- **提供者卸载时。** `provide` 的清理函数会通知所有 inject 了这个名字的 fiber 重新检查，并等依赖方清理完再真正移除 [22]。Koishi 文档的说法：必需服务变了，依赖它的插件回滚（卸载并清理副作用），服务回来再重新加载 [29]。
- **事件。** 五种派发方式，是事件公开契约的一部分：`emit`（不等、无返回值）、`waterfall`（环绕式中间件，监听器拿到 `next`，可以包住或短路）、`parallel`、`serial`、`bail`（到第一个有返回值的为止）；`prepend: true` 让监听器排到前面 [23]。
- **加载器与 HMR。** 插件树由配置文件（cordis.yml）描述，条目有 `id`、`name`、`config`、`disabled`；加载器按 `id` 做差异，只挂载、卸载或重新配置变了的条目；没写 `id` 的条目每次读配置都会被当成删了再加。HMR 就是卸载旧实例（副作用全部撤销）再加载新代码 [28]。
- **坑：PENDING 是静默的。** inject 了一个没人提供的服务，插件就一直等，不报错不打印，因为提供者可能晚点才来。DSH 教程专门有一节教怎么遍历 `ctx.registry` 看各 fiber 的状态 [28]。
- **Cordis 自己的清单键。** `@cordisjs/fs` 的 package.json 里有 `"cordis": { "service": { "implements": ["fs"] } }` [30]，沿用了 Koishi 的形状。

### 4.2 Koishi 的服务模型

- 服务分三类：内置的（`ctx.model`、`ctx.i18n`）、只定义不实现的（`ctx.database`、`ctx.assets`，由 `database-mysql` 这类插件实现，习惯上用服务名做前缀）、由插件定义并实现的（`ctx.console`、`ctx.puppeteer`）[29]。「只定义不实现」正是「服务按名字可替换」的做法：接口归核心或一个中立的包，实现是可换的插件。
- `inject = { required: ['database'], optional: ['assets'] }`：必需服务没有就不加载、变了就回滚重载；可选服务不等待也不回滚，用时自己判断 [29]。
- 局部依赖：`ctx.inject(['console'], (ctx) => { ... })` 建一个子插件，只有那一段功能依赖 console，主体不受影响；回调里必须用回调自己的 `ctx`，否则热重载时泄漏 [29]。
- 服务方法替调用方产生的副作用，要挂到调用方 context 的 dispose 上清理 [29]。
- 类型：服务通过 `declare module 'koishi' { interface Context { console: Console } }` 做声明合并 [29]。

### 4.3 Koishi 的 package.json 字段（精确清单）

文档里写的 [31]：

```json
{
  "name": "koishi-plugin-example",
  "version": "1.0.0",
  "contributors": ["Alice <alice@gmail.com>"],
  "license": "MIT",
  "homepage": "https://example.com",
  "repository": { "type": "git", "url": "git+https://github.com/alice/koishi-plugin-example.git" },
  "keywords": ["example"],
  "peerDependencies": { "koishi": "^4.3.2" },
  "koishi": {
    "description": { "en": "English Description", "zh": "中文描述" },
    "service": {
      "required": ["database"],
      "optional": ["assets"],
      "implements": ["dialogue"]
    },
    "preview": true,
    "hidden": true
  }
}
```
（以上按文档字段拼的示意，值是文档里的例子。）

- 包名必须是 `koishi-plugin-*`、`@scope/koishi-plugin-*` 或 `@koishijs/plugin-*`（仅官方），`*` 只能是数字、小写字母、连字符 [31]。
- `peerDependencies` 必须含 `koishi`；`private` 不能是 true [31]。
- `koishi.description`：按语言代码分的描述。`koishi.service.required / optional / implements`：必需、可选、本插件实现的服务。`koishi.preview: true` 显示为「开发中」。`koishi.hidden: true` 不在市场显示 [31]。
- `keywords` 用于市场搜索 [31]。

扫描器源码里的 `Manifest` 类型比文档多 [32]：

| `koishi.*` 字段 | 类型 | 说明 |
|---|---|---|
| `description` | `string \| Dict<string>` | 每条截断到 1024 字符；没有就用 package.json 的 `description` |
| `service.required / optional / implements` | `string[]` | 同上 |
| `locales` | `string[]` | 插件自带的界面语言 |
| `preview` | `boolean` | 开发中 |
| `hidden` | `boolean` | 不上市场 |
| `insecure` | `boolean` | 不安全标记；扫描器直接读清单里的这个值 |
| `browser` | `boolean` | 能否在浏览器（Koishi Online）跑 |
| `category` | `string` | 分类 |
| `public` | `string[]` | 文档未说明，未核实其用途 |
| `exports` | `Dict<string>` | 文档未说明，未核实其用途 |
| `icon` | `{ type: 'svg', viewBox, pathData }` | 类型里有，但 `conclude()` 没读它，未核实是否生效 |

另有一套写在 `keywords` 里的旧式等价写法，扫描器仍然识别：`market:hidden`、`required:<服务>`、`optional:<服务>`、`impl:<服务>`、`locale:<语言>` [33]。

### 4.4 Koishi 市场怎么运作

- **基于 npm，靠扫描。** 没有提交流程：发到 npm 且名字和字段合规，约 15 分钟后出现在市场 [31]。扫描器按名字正则认插件（`^@koishijs/plugin-…` 或 `koishi-plugin-…`）[34]。
- **兼容性**看 `peerDependencies.koishi` 是否满足；被 deprecate 的版本会被滤掉；`npm deprecate` 掉最新版就等于下架，再发新版就恢复 [31][34]。
- **verified** 就是「包名以 `@koishijs/plugin-` 开头」，即官方 scope [34]。
- **每个条目带的数据**：`shortname`、`verified`、`insecure`、`deprecated`、`category`、`portable`、`ignored`、`license`、`manifest`、`createdAt`、`updatedAt`、`publishSize`、`installSize`、`downloads.lastMonth`、`score`（quality / popularity / maintenance）、`rating` [32]。
- **不安全标记对用户的含义**：官方不为非官方插件的安全性担保，装了带「不安全」标记的插件就得不到官方群的支持 [35]。
- **安装后不自动启用**，要去「插件配置」页配置并启用；更新和卸载在「依赖管理」页 [35]。
- 未核实：扫描器除了读清单的 `insecure`，是否还根据依赖（比如带原生模块）自动打这个标记。在 `index.ts` 里只看到 `object.insecure = manifest.insecure` [34]，但没通读全文件。

### 4.5 DeepSeek Harness（同样基于 Cordis、同样「一切皆插件」）

- **兼容性声明从 peerDependencies 改成 `engines.dsh`。** 原先只看对 `@deepseek-ai/dsh*` 的 peer 范围，后来改为 `engines.dsh` 有就只看它，没有才退回 peer；`engines` 格式不对的包直接拒装；拒装记录里写明是哪条要求没满足 [36]。这是一次带升级指南的破坏性变更，说明一开始借用 peerDependencies 表达宿主版本后来不够用。
- **展示信息不放在子路径的 package.json 里。** 子路径插件的标题和描述改从 `locale/*.json` 的 `meta.title` / `meta.description` 读，图标从导出的 `<子路径>/icon` 读 [37]。
- **市场是去中心的索引文件。** 一个索引就是一份 JSON（`format: 1`），列出插件的 `name`、`title`、`description`、`icon`、`author`、`homepage`、`repository`、`versions[]`（每个版本有 `version`、`publishTimestamp`、`source`（npm，或 git 的 url + commit + path）、`engines`）；应用不自带任何索引源；卡片显示的推荐版本是「与当前宿主兼容的最高非预发布版」；安装前有确认框显示来源；文档明说索引里的标题、作者、来源等说法应用不验证 [38]。
- **服务分类。** 文档把服务分成核心主干、可替换的能力接缝（capability seam）、组合点、独立服务，并用脚本从源码生成「谁声明、谁实现、谁消费」的图 [39]。
- **Slots。** 见第 6 节。

---

## 5. Zed、Figma、Logseq、Joplin、Tauri 应用

**Zed。** 扩展是编译成 WebAssembly 的 Rust，用 Wasmtime 跑；接口用 WIT 定义，两边生成绑定；选 Wasm 的原因之一是团队想用 Rust 而不是 JS 写扩展 [40]。清单是 `extension.toml`：`id`、`name`、`version`、`schema_version`、`authors`、`description`、`repository` [41]。注册表是 zed-industries/extensions 仓库，CI 把每个扩展编译成 archive.tar.gz 加 manifest.json 传到存储桶，用户安装时不编译 [40]。
- **API 版本：** 每个扩展的编译产物记录它用的 `wasm_api_version`，Zed 按这个版本选对应的 WIT 接口实例化；WIT 目录按版本分（如 `since_v0.2.0`），旧接口并存 [40]。
- **没有界面扩展：** 博客原话是不支持改界面、建新面板，也不支持任意 HTTP 请求和不受限的文件访问 [40]。能做的是语言、调试器、主题、图标主题、片段、MCP 服务器 [41]。原因 Zed 没在这两页里展开；可以确定的只是它的界面是自研 GPU 框架，没有现成的、可给第三方的界面边界（这句是推断，未核实）。
- 有能力表：`process:exec`、`download_file`、`npm:install`，用户在 `granted_extension_capabilities` 里能收窄 [42]。

**Figma。** 试过三种 [43]：
1. 跨域 iframe 加消息传递：否决。所有读写文档的调用都变成异步，对设计师不友好；大文件光序列化就要约 14 秒。
2. 把 JS 解释器（Duktape）编译成 Wasm 在主线程跑：能直接改文档，但慢、调试差、只支持 ES5，当时留作备用。
3. Realms shim（with 加 Proxy 藏全局对象）：当时上线的方案，主线程、有 JIT。
- 最终结构是两半：逻辑在主线程的沙箱里跑，能同步访问文档；需要浏览器 API 和界面的部分在一个 null-origin iframe 里，两半用消息通信。并且把沙箱藏在一个很小的底层接口后面，方便以后换实现 [43]。
- 后来 Realms shim 被私下报告了漏洞，换成「C 写的 JS 虚拟机编译到 Wasm」[43]（文章顶部的编者注）。未核实：这个虚拟机是 QuickJS（后续那篇安全更新文章这次超时没读到）。
- 教训：在同一个 JS 环境里做语言级隔离是会被绕过的；要么真隔离（另一个虚拟机/进程），要么明说不隔离。

**Logseq。** 市场是 logseq/marketplace 仓库，给 `packages/` 下加一个目录和 manifest.json 提 PR；字段：`title`、`description`、`author`、`repo`、`icon`、`theme`、`sponsors`、`effect`、`web`、`supportsDB`、`supportsDBOnly`。release 必须附带构建出的 zip。`effect: true` 表示插件沙箱和宿主同源运行，官方不建议开，开了审核更严，以后可能不再允许 [44]。
- 未核实：默认情况下插件跑在 iframe 沙箱里，另有 shadow DOM 模式；package.json 的 `logseq` 键（id、main、icon、title）。这次没读到一手文档。

**Joplin。** manifest 字段：`manifest_version`、`name`、`version`、`app_min_version` 必填；`app_min_version_mobile`、`platforms`、`description`、`author`、`keywords`、`homepage_url`、`repository_url`、`categories`、`screenshots`、`icons`（16/32/48/128）、`promo_tile` 可选 [45]。
- 未核实：打包成 `.jpl`、发布到 npm 后由 joplin/plugins 仓库收录、插件在独立的渲染进程里通过消息调用 API。

**基于 Tauri 的应用。**
- **Yaak**（Tauri + Rust + React 的 API 客户端）：插件用 TypeScript 写，「在一个 NodeJS 运行时里与 Yaak 并行执行」，即旁挂一个 Node 进程，不在 WebView 里；类型包是 `@yaakapp/api` [46]。
- **Kunkun**（Tauri 的启动器）：三种扩展：模板界面命令（在 web worker 里跑，只能用预定义的 List / Form / Markdown 模板）、无界面命令、自定义界面命令（任意前端应用被加载进来）[47]。未核实：自定义界面是 iframe、清单在 package.json 的 `kunkun` 键下、有权限表。
- **tauri-plugin-js**：一个社区 Tauri 2 插件，从应用里启动并管理 Bun / Node / Deno 子进程来跑 JS，运行时可以作为 sidecar 随应用分发 [48]（二手：搜索摘要）。
- Tauri 官方的「插件」是编译期的 Rust crate 加 npm 包，不是运行时加载第三方代码的机制 [48]（二手）。
- **小结：** 这次没找到一个把第三方 JS 直接加载进主 WebView、完全信任的知名 Tauri 应用；找到的都是旁挂运行时或 worker/iframe。本设计在 Tauri 生态里没有现成先例可抄，最接近的先例是 Obsidian（Electron）和 DeepSeek Harness。SiYuan 是 Electron 应用，不算。

---

## 6. Slot / 扩展点式的界面组合

**Grafana。** 两种方向 [49][50]：
- `add`：把链接、组件或函数推到一个扩展点（一对多）。宿主事先不知道谁会来，由宿主决定怎么显示。API：`addLink`、`addComponent`、`addFunction`；宿主侧用 `usePluginLinks`、`usePluginComponents`、`usePluginFunctions` 取，可传 `limitPerPlugin` 限制每个插件能放几个。`addLink` 有 `configure(context)`，显示前可按上下文改写或隐藏。
- `expose`：把一个组件以唯一 ID 暴露出去，别的插件自己决定在哪渲染（`exposeComponent` / `usePluginComponent`）。被暴露的组件不在提供方的 React 树里渲染，所以要自己包好需要的 Provider。
- **命名带版本：** 扩展点 ID 必须以插件 ID 为前缀，核心的以 `grafana/` 开头，如 `grafana/dashboard/panel/menu/v1`；暴露组件的 ID 也要带版本 [50][51]。改了 props 契约就出 `v2`，旧的并存。
- **清单里必须声明：** plugin.json 的 `extensions.addedLinks / addedComponents / addedFunctions / exposedComponents / extensionPoints`，没列的不生效；依赖别人的暴露组件写在 `dependencies.extensions.exposedComponents`。`preload: true` 表示启动时就加载而不是首次使用时 [51]。

**Backstage 新前端系统。** 扩展是一棵树 [52]：
- 每个扩展有 ID（`[<kind>:][<namespace>][/][<name>]`，一个应用里每个 ID 只能有一个）、`attachTo`（父扩展 ID 加父的某个 input）、`inputs`（接受子扩展的哪些数据，可标 `singleton`、`optional`、`internal`）、`output`、配置 schema、`disabled`、`factory`。
- **类型靠「扩展数据引用」：** `createExtensionDataRef<T>()` 把一个 ID 和一个 TS 类型绑在一起，父的 input 和子的 output 用同一个引用，编译期对上。文档要求引用要具体，不要用泛泛的 `string`。
- 一个扩展只挂到一个父的一个 input，所以没有环；工厂从叶子往根执行；被禁用的扩展不实例化，父看不到它。
- **顺序：** 把禁用的扩展打开，它会排到列表末尾；所以对顺序敏感的扩展建议默认禁用，由配置里的顺序决定位置。
- **出错隔离：** 扩展包在 `ExtensionBoundary`（含错误边界）里。
- 工厂要轻，重活放进输出的回调里让父稍后执行。
- 迁移史：1.30 用 blueprint 取代 extension creator；1.31 用 `createFrontendModule` 取代 `createExtensionOverrides`，替换别人的扩展要包成 module 并写明被替换的 `pluginId`；旧 API 先标废弃、给出替代，再在后面的版本删除 [53]。

**JupyterLab。** 插件对象：`id`（惯例 `包名:插件名`）、`autoStart`、`requires`、`optional`、`provides`、`activate`、可选 `deactivate` [54]。
- **服务用 Token 标识，不是字符串：** Token 是唯一对象，避免重名并带类型；提供方 `provides: token`，`activate` 的返回值就是服务；缺 `requires` 的插件不激活，缺 `optional` 的传 `null` [54]。
- **懒激活：** `autoStart` 为假的插件，等别的插件要它提供的 token 时才激活 [54]。
- **一个 token 只能注册一次** [54]；要替换内置实现，用 package.json 的 `jupyterlab.disabledExtensions` 在安装自己时把内置的那个禁掉 [54]。这是「替换 = 禁用原来的 + 提供同一个 token」，和 Cordis 的行为一致。
- **Token 必须是同一个对象：** 所以定义 token 的包要作为 singleton 共享（module federation 的 `sharedPackages`：`bundled`、`singleton`、`strictVersion`）；核心包常把 token 单独放一个包导出，换提供者时消费方不用改 [54]。
- `package.json` 的 `jupyterlab` 键：`extension`、`mimeExtension`、`schemaDir`（设置 schema 目录，插件 X 的 schema 是 `<schemaDir>/X.json`）、`sharedPackages`、`disabledExtensions` [54]。
- 语义化版本：大版本可能破坏扩展，文档建议扩展给兼容的 JupyterLab 版本写上限 [54]。

**Theia。** 四种机制：VS Code 扩展（运行时装、受限 API、独立进程）、Theia 扩展（编译期、通过依赖注入拿到几乎全部内部、是应用本身的一部分）、Theia 插件、无界面插件 [55]。Theia 扩展就是「完全信任、同进程」的那一档，代价是必须编进产品。
- 贡献点是一个接口（如 `CommandContribution`），`bindContributionProvider(bind, X)` 收集所有绑定到 X 的实现 [56]。
- 可替换的服务：声明接口加同名 Symbol，`bind(Impl).toSelf().inSingletonScope(); bind(Sym).toService(Impl)`；别人用 `rebind(Sym).to(Mine)` 换掉 [56]。
- 坑：直接拿类当注入标识的话，带 private/protected 成员的类在 TS 里是名义类型，别人只能继承不能从零重写；所以打算给人换的服务一律用 Symbol 加接口，注入的字段保持 `protected` [56]。

**DeepSeek Harness 的 Slots（React + Cordis，最贴近本设计）[57]。**
- `SlotMap` 是编译期的登记表，各包用声明合并往里加一行：键、基数（cardinality）、作用域、宿主给的 props、按键区分的 props。插件用 `ctx.slots.register({ name, id, order }, Component)` 贡献，不导入别的功能插件的组件。
- **基数五种：** `single`（一个格子，优先级最高者渲染）、`list`（按 `id` 寻址，`order` 再注册顺序排序）、`keyed`（宿主给 `entryKey`，匹配的渲染）、`chain`（每个条目给一个纯函数 `select(owner)`，第一个返回非空的渲染，否则用宿主的兜底）、`hoc`（一层层包在宿主内容外面）。
- **覆盖内置的方式是复用同一个 `id`：** 普通的追加用新 id；故意用已有的 id 就是替换那一格的呈现，由 `priority` 决定谁赢。
- **slot 要先被声明才能注册：** 往没声明的 slot 注册、或声明一个别人已经拥有的子 slot，在插件激活时就失败，不是静默。
- **生命周期跟 Cordis effect 走：** 往别的包的 slot 贡献要用 `ctx.slots.inject(key, callback)`，宿主组件每次挂载回调跑一次，宿主卸了贡献自动撤，宿主再挂回调再跑。
- **组件拿不到 `ctx`：** 宿主的即时值从 `renderSlot` 的参数进来；共享视图状态走声明的 store；服务和模型对象留在 `apply` 闭包里，只投影成回调或可观察的数据源。props 类型从 `PropsRuntime<'slot.name'>` 推出来，不手抄。
- **出错：** hoc 层崩了就报错并直接渲染它的 children，其余位置不受影响。

**哪些「带类型的 slot」设计站得住（跨系统的共性）。**
1. slot 的契约（props、基数）在一个地方用类型定义，贡献方从 slot 名推出 props（DSH 的 `PropsRuntime<K>`、Backstage 的数据引用、JupyterLab 的 Token）。
2. slot 名带命名空间，契约变了出新版本名（Grafana 的 `…/v1`）。
3. 基数是 slot 的属性而不是贡献方的选择：单个、列表、按键、包裹，各有明确的冲突规则（DSH、Backstage 的 `singleton`）。
4. 顺序用显式的 `order` 加稳定的次级规则（注册顺序），并允许用户/配置覆盖（Backstage、DSH）。
5. 每个贡献单独包错误边界（Backstage、DSH）。
6. 宿主可以限制每个插件的贡献数量（Grafana 的 `limitPerPlugin`）。
7. 贡献随插件卸载自动撤回（DSH 靠 Cordis effect）。

---

## (a) 清单字段对照表

「展示」是市场或设置页要显示的，「加载」是加载器或兼容性判断要用的。空格表示该系统没有对应字段或这次没查到。

| 用途 | VS Code [2][6] | Obsidian [14][15] | Raycast [19] | Koishi [31][32] | DSH 索引 [36][38] | Joplin [45] | Grafana [51] | JupyterLab [54] | Zed [41] |
|---|---|---|---|---|---|---|---|---|---|
| 标识 | `publisher`.`name` | `id` | `name` + `author` | npm 包名（命名规则强制） | npm 包名 | 清单外的包 id | `id` | npm 包名；插件 `id` | `id` |
| 显示名 | `displayName` | `name` | `title` | 由包名得 shortname | `title`（可多语言） | `name` | `name` | | `name` |
| 版本 | `version` | `version` | （商店管理） | `version` | `versions[].version` | `version` | `info.version` | `version` | `version` |
| 描述 | `description` | `description` | `description` | `koishi.description`（按语言） | `description` | `description` | `info.description` | `description` | `description` |
| 多语言 | package.nls.*.json（未核实） | 无 | 不允许 | `koishi.description` 的键、`koishi.locales` | locale/*.json 的 meta | | | | |
| 作者 | `publisher` | `author`、`authorUrl` | `author`、`contributors`、`pastContributors`、`owner` | `contributors`、npm maintainers | `author` | `author` | `info.author` | `author` | `authors` |
| 图标 | `icon` | 无 | `icon` | `koishi.icon`（未核实生效） | `icon`（地址或 data:） | `icons` | `info.logos` | | |
| 分类 / 关键词 | `categories`、`keywords` | 无 | `categories`、`keywords` | `koishi.category`、`keywords` | categories、labels、keywords | `categories`、`keywords` | `info.keywords` | `keywords` | 按提供的功能自动归类 |
| 截图 / 横幅 | `galleryBanner`、README | README | 商店素材目录 | README | | `screenshots`、`promo_tile` | `info.screenshots` | | |
| 赞助 | `sponsor` | `fundingUrl` | | | | | | | |
| 链接 | `repository`、`homepage`、`bugs`、`qna` | | | `homepage`、`repository` | `homepage`、`repository` | `homepage_url`、`repository_url` | `info.links` | | `repository` |
| 状态标记 | `preview`、`pricing` | | `access` | `koishi.preview`、`hidden`、`insecure`；verified 由 scope 推出 | | | | | |
| 宿主版本 | `engines.vscode` | `minAppVersion` + versions.json | API 版本依赖 | `peerDependencies.koishi` | `engines.dsh`（先于 peer） | `app_min_version`、`app_min_version_mobile` | `dependencies.grafanaDependency` | 依赖范围 | `schema_version`、编译时记录的 API 版本 |
| 平台 | `extensionKind`、`browser` | `isDesktopOnly` | `platforms` | `koishi.browser`、npm `os`/`cpu` | | `platforms` | | | |
| 入口 | `main`、`browser` | 固定 `main.js` | 命令名对应 `src/<name>` | `main` / `exports` | 包入口、子路径 | 固定 | `module`（未核实） | `jupyterlab.extension` | 固定 |
| 何时加载 | `activationEvents`（多数可由 `contributes` 推出） | 无（全部启动时加载） | 命令触发；`interval` | 由 inject 的服务决定 | 同 Cordis | | `preload` | `autoStart` / 被请求时 | |
| 静态贡献 | `contributes.*` | 无 | `commands`、`preferences`、`tools`、`arguments` | 无（运行时注册） | 无（运行时注册） | 无 | `extensions.*` | `schemaDir` | 各类目录 |
| 服务依赖 / 提供 | `extensionDependencies`；`exports` | 无 | 无 | `koishi.service.required / optional / implements` | 同 Cordis | | `dependencies.plugins`、`dependencies.extensions.exposedComponents`、`extensions.exposedComponents` | 插件对象的 `requires / optional / provides` | |
| 替换内置 | 无 | 无 | 无 | 实现同名服务 | slot 复用 id；同名服务 | | | `jupyterlab.disabledExtensions` | |
| 实验 API | `enabledApiProposals` | | | | | | | | |
| 来源 / 完整性 | 市场签名（未核实细节） | GitHub release，tag = 版本 | 单仓库的 PR | npm `dist.integrity`、`shasum` | `source`：npm 或 git url + commit + path | | 签名清单（未核实） | | 仓库 submodule + CI 构建 |
| 体积 / 热度（索引生成） | 安装数、评分 | 下载数 | | `installSize`、`publishSize`、`downloads`、`score`、`rating` | `publishTimestamp` | | | | |

对 `fuyu` 键的直接启示：Koishi 的 `service.required / optional / implements` 加 `description`（按语言）、`preview`、`hidden` 是可以照搬的最小集；Koishi 没有而别家普遍有的是：独立的宿主版本字段（`engines`）、图标、分类、平台限制、静态的贡献声明。

---

## (b) 与本设计最相关的经验和坑

**1. 加载顺序：用服务依赖表达，不要手工排。**
Cordis 和 JupyterLab 都是「声明要什么，框架决定先后」[23][54]。代价是 Cordis 的 PENDING 静默：依赖没人提供时插件永远等着，不报错 [28]。内置功能全是插件时，一个内置插件名字写错就是「某个功能悄悄没了」。需要一个诊断视图：列出每个插件的状态和它在等哪个服务；启动后一段时间仍 PENDING 的必需内置插件应当报出来。

**2. 两个插件提供同一个服务：Cordis 直接抛错。**
同一隔离域里第二个 `provide` 抛 `service "x" has been registered at <…>` [22]；JupyterLab 同样「一个 token 只能注册一次」[54]。所以「服务按名字可替换」实际要设计的是替换的流程，不是共存：
- JupyterLab 的做法：替换者在清单里声明要禁用谁（`disabledExtensions`）[54]。
- Theia 的做法：`rebind`，后绑定的赢，但那是编译期的 [56]。
- Koishi 的做法：核心只定义接口不带实现，实现都是插件，用户同时只启用一个 [29]。
建议：清单里的 `service.implements` 要在安装/启用时就用来查冲突（两个已启用的插件 implements 同一个名字，在启用时提示并让用户选），不要等运行时抛错。提供者被换掉时，所有依赖方会被卸载重载 [22][29]，所以依赖方的状态不能只放在内存里。

**3. 接口归谁：把「定义」和「实现」拆开。**
Koishi 的「只定义不实现的服务」[29]、JupyterLab 的「token 单独一个包」[54]、Theia 的「Symbol 加接口」[56] 是同一条经验：打算让人替换的服务，类型定义放在中立的地方（核心或单独的类型包），实现插件和消费插件都只依赖它。直接拿实现类当标识，别人就只能继承不能重写 [56]。

**4. 内置功能做成插件：让内置插件先用未稳定的 API。**
VS Code 的内置扩展走公开扩展 API，同时在自己的清单里开一批 proposal [8]；proposal 要逐个按名字声明，第三方不能带着 proposal 上市场 [6]。这给出一个分层：稳定 API（第三方可用，受版本承诺约束）和 proposal（内置插件和开发版可用，可以随时改）。本设计没有权限表，但「哪些 API 有稳定承诺」仍然需要一个显式的标记，否则内置插件用过的每个内部接口都会被第三方插件依赖上，变成事实上的公开 API。
Theia 的教训是反面：完全信任的 Theia 扩展能拿到「几乎全部内部」，结果是它只能编译期集成，升级靠使用者自己跟 [55]。

**5. API 版本和废弃。**
- 宿主版本要有独立字段。DSH 先用 peerDependencies，后来改成 `engines.dsh` 优先，并为此发了破坏性变更的升级指南 [36]。Koishi 至今用 `peerDependencies.koishi` [31]。建议一开始就用 `engines.fuyu`。
- 让旧应用装到能用的旧版插件。Obsidian 的 versions.json [15]、DSH 索引里每个版本各带 `engines` 并按「兼容的最高非预发布版」推荐 [38]。精选市场的索引应该保留每个版本各自的宿主版本范围，而不只是最新版。
- 接口并存而不是原地改。Zed 按 API 版本保留多份 WIT 接口，扩展记录自己编译时的版本 [40]；Grafana 的扩展点 ID 带 `/v1` [50]。对 slot 和服务名同样适用：契约变了就出新名字，旧的保留一段时间。
- 废弃要有节奏。Backstage 是先标废弃并指向替代、过几个版本再删，同时发迁移指南 [53]；DSH 每个破坏性变更一份升级指南，写明谁受影响、怎么改、怎么确认 [36][37]。
- Cordis 本身还在 4.0.0-rc，README 明说 API 不稳定 [21]。DSH 的做法是把 Cordis vendor 进仓库并用自己的包名（`@deepseek-ai/cordis`）导出 [23]。本设计应该把 Cordis 包一层再给插件用（插件 import 的是 `fuyu` 的包），否则 Cordis 的破坏性变更会直接传给所有第三方插件。

**6. 懒激活和启动成本。**
- Obsidian 是反例：所有插件在可交互前全部加载，每个 `onload` 都算进启动时间，官方只能靠文档要求作者自觉、事后加启动耗时视图和「加载太久」提示，社区自己做懒加载插件 [16][17]。
- VS Code 是正例：靠清单里的静态贡献，命令、菜单、设置在扩展激活前就能显示，第一次用到才加载代码；`*` 被明确劝阻，另给了 `onStartupFinished` [3][4]。
- Cordis/Koishi 没有激活事件，插件由配置挂载、依赖满足就跑 [23][28]。全部内置功能做成插件后，默认就是 Obsidian 式的「启动时全跑」。对一个常驻的悬浮岛，这直接是冷启动时间。可行的折中：(a) 清单里静态声明贡献（命令、设置项、slot 占位），宿主先画占位；(b) `apply` 只做注册，重活放到首次使用或空闲时；(c) 对每个插件的 `apply` 计时并记下来。Backstage 也要求工厂保持轻量，重活放进回调 [52]；Grafana 的 `preload` 默认是关的 [51]。

**7. 共享进程里的崩溃和卡顿隔离：做不到，只能靠归因和止损。**
- 同进程没有真隔离。Figma 在同一 JS 环境里做的语言级沙箱被找出漏洞后换成了独立虚拟机 [43]；Obsidian 明说无法可靠限制插件 [12]；Raycast 放弃沙箱但仍用独立进程加每扩展一个 worker 来挡崩溃和内存失控 [18]。本设计放弃隔离是一个明确的取舍，对应要补上的是下面这些。
- 界面：每个 slot 贡献单独包错误边界（Backstage 的 ExtensionBoundary、DSH 的 hoc 层崩溃后渲染 children）[52][57]。这只挡渲染期异常，挡不了死循环、主线程长任务、全局样式污染、未捕获的 Promise 拒绝。
- 卸载要干净：Cordis 的 effect 保证「注册的都能撤」[23][26]，但前提是插件所有副作用都走 effect。直接 `addEventListener`、`setInterval`、往 `document.head` 塞样式的不会被撤。需要 lint 或包装过的 API 来兜。
- 归因：VS Code 有运行中扩展视图、宿主 profile、bisect [5][10]。同进程下 CPU profile 仍可按调用栈里的脚本地址归到插件（每个插件一个独立的 bundle 文件就能分清），所以插件不要被打进同一个 chunk。
- 止损：需要等价于 Obsidian 受限模式的开关（不加载任何第三方插件启动）[12]，以及 bisect。内置功能也是插件时，「安全模式」要区分「内置」和「第三方」两档，否则安全模式下应用是空的。连续启动崩溃后自动进安全模式是常见做法（未核实哪家这么做）。
- Rust 一侧：WebView 里的插件能调的 Tauri 命令就是全部能力边界。没有权限表意味着所有命令对所有插件开放，命令本身要按「调用方不可信也不会破坏数据」来写。

**8. 完全信任加精选市场：审核是唯一防线，要设计它的成本。**
- Raycast：开源、单仓库、每次更新都走 PR 加人工审核 [18][20]。最严，也最费人。
- Obsidian：每个版本自动扫描出评分卡，人工审核只给热门、精选和被举报的 [12][13]。
- Koishi：不审核，npm 上合规就收录，靠 verified（官方 scope）和 insecure 标记加「不安全的不给支持」[34][35]。
- DSH：不运营市场，索引由第三方发布，安装前显示来源，明说不验证索引里的说法 [38]。
- 签名只证明「是谁发的、没被改过」，不证明代码无害。精选加签名时要定：是每个版本都审，还是只审首次；审的是源码还是构建产物（Obsidian 的 release 附件是作者自己传的 main.js，和源码是否一致没人保证；Zed 由官方 CI 从源码构建 [40]，这是更强的保证）。

**9. 静态清单和运行时注册要对得上。**
Grafana 要求扩展点和贡献都在 plugin.json 里列出，没列的运行时不生效 [51]；VS Code 的贡献点全是静态的 [3]；Koishi 的 `service.*` 只是给市场看的提示，运行时以代码里的 `inject` 为准，两边可以不一致 [29][31]。如果 `fuyu.service` 要用于安装时的冲突检查和依赖提示，就需要在打包或审核时校验它和代码一致，否则它会腐烂。

**10. 展示信息的本地化放哪。**
Koishi 把多语言描述直接写在清单里 [31]；DSH 后来把标题描述挪到 locale 文件的 `meta` 里，和插件的其他文案放一起 [37]；Raycast 干脆不允许本地化 [20]。应用要求中英双语，清单里的 `description: { zh, en }` 是最省事的做法，但标题、分类名、设置项文案多了以后会想挪到 locale 文件。

**11. Slot 的冲突规则要写进 slot 的定义。**
两个插件往同一个「单个」slot 注册时谁赢、列表怎么排、能不能替换内置的那一项，DSH 用基数加 `priority` 加「复用 id 即替换」回答 [57]，Backstage 用 `singleton` 加配置顺序 [52]，Grafana 用 `limitPerPlugin` 防一个插件占满 [50]。悬浮岛的空间极小（折叠态尤其），「每个 slot 最多显示几个、超出怎么办」比编辑器类应用更要紧，应当是 slot 契约的一部分。

**12. 一个名字只挂一处，替换内置界面用同一个 id。**
Backstage 每个扩展 ID 全应用唯一，替换别人的扩展要显式写明目标 `pluginId` [52][53]；DSH 复用内置格子的 id 即替换 [57]。两者都让「替换」成为显式动作并且可被工具列出，而不是靠加载顺序碰巧盖住。

---

## 来源

1. VS Code — Extension Host：https://code.visualstudio.com/api/advanced-topics/extension-host
2. VS Code — Extension Manifest：https://code.visualstudio.com/api/references/extension-manifest
3. VS Code — Contribution Points：https://code.visualstudio.com/api/references/contribution-points
4. VS Code — Activation Events：https://code.visualstudio.com/api/references/activation-events
5. VS Code 博客 — Resolving extension issues with bisect（2021-02-16）：https://code.visualstudio.com/blogs/2021/02/16/extension-bisect
6. VS Code — Using Proposed API：https://code.visualstudio.com/api/advanced-topics/using-proposed-api
7. microsoft/vscode 仓库 `extensions/` 目录（GitHub API 计数 104）：https://github.com/microsoft/vscode/tree/main/extensions
8. microsoft/vscode `extensions/git/package.json`（`enabledApiProposals`）：https://github.com/microsoft/vscode/blob/main/extensions/git/package.json
9. VS Code API — `extensions` 命名空间：https://code.visualstudio.com/api/references/vscode-api#extensions
10. microsoft/vscode wiki — Performance Issues：https://github.com/microsoft/vscode/wiki/Performance-Issues
11. （二手）John Papa — Is Your VS Code Extension Slow?：https://johnpapa.net/is-your-vs-code-extension-slow-heres-how-to-speed-it-up/
12. Obsidian Help — Plugin security：https://obsidian.md/help/plugin-security
13. Obsidian 开发文档 — Submit your plugin：https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
14. Obsidian 开发文档 — Manifest：https://docs.obsidian.md/Reference/Manifest
15. Obsidian 开发文档 — Versions：https://docs.obsidian.md/Reference/Versions
16. （二手，论坛与社区）https://forum.obsidian.md/t/android-1-318ms-of-plugin-startup-time-is-unattributed-other-and-2-8s-is-spent-before-any-plugin-loads/118720 ；https://github.com/hadynz/obsidian-kindle-plugin/issues/301 ；https://obsidian.rocks/fixing-slow-startup-on-obsidian-mobile/ ；https://community.obsidian.md/plugins/on-demand-plugins
17. Obsidian 开发文档 — Optimizing plugin load time：https://docs.obsidian.md/plugins/guides/load-time
18. Raycast 博客 — How the Raycast API and extensions work：https://www.raycast.com/blog/how-raycast-api-extensions-work
19. Raycast 开发文档 — Manifest：https://developers.raycast.com/information/manifest
20. Raycast 开发文档 — Prepare an Extension for Store：https://developers.raycast.com/basics/prepare-an-extension-for-store
21. cordiverse/cordis 仓库 README 与 `packages/core/package.json`：https://github.com/cordiverse/cordis
22. cordis 源码 `packages/core/src/reflect.ts`：https://github.com/cordiverse/cordis/blob/main/packages/core/src/reflect.ts
23. DeepSeek Harness — Cordis Primer：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/cordis-primer.md
24. cordis 源码 `packages/core/src/registry.ts`：https://github.com/cordiverse/cordis/blob/main/packages/core/src/registry.ts
25. cordis 源码 `packages/core/src/service.ts`：https://github.com/cordiverse/cordis/blob/main/packages/core/src/service.ts
26. cordis 源码 `packages/core/src/fiber.ts`：https://github.com/cordiverse/cordis/blob/main/packages/core/src/fiber.ts
27. cordis 源码 `packages/core/src/context.ts`：https://github.com/cordiverse/cordis/blob/main/packages/core/src/context.ts
28. DeepSeek Harness — Cordis 教程第 6 章 Composition and HMR：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/cordis-tutorial/06-composition-and-hmr.md
29. Koishi 文档 — 使用服务：https://koishi.chat/zh-CN/guide/plugin/service.html
30. cordis `packages/fs/package.json`（`cordis.service.implements`）：https://github.com/cordiverse/cordis/blob/main/packages/fs/package.json
31. Koishi 文档 — 发布插件：https://koishi.chat/zh-CN/guide/develop/publish.html
32. koishijs/webui `packages/registry/src/types.ts`：https://github.com/koishijs/webui/blob/main/packages/registry/src/types.ts
33. koishijs/webui `packages/registry/src/utils.ts`（`conclude`）：https://github.com/koishijs/webui/blob/main/packages/registry/src/utils.ts
34. koishijs/webui `packages/registry/src/index.ts`（扫描器）：https://github.com/koishijs/webui/blob/main/packages/registry/src/index.ts
35. Koishi 文档 — 安装和配置插件（插件市场）：https://koishi.chat/zh-CN/manual/usage/market.html
36. DeepSeek Harness 升级指南 — Plugin compatibility reads `engines.dsh` first：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md
37. DeepSeek Harness 升级指南 — Subpath plugin display manifest：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.md
38. DeepSeek Harness — Plugin indexes：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/user/guide/plugin-market.md
39. DeepSeek Harness — Capability Seams And Core Services：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/capability-seams.md
40. Zed 博客 — Zed Decoded: Extensions：https://zed.dev/blog/zed-decoded-extensions
41. Zed 文档 — Developing Extensions：https://zed.dev/docs/extensions/developing-extensions
42. Zed 文档 — Extension Capabilities：https://zed.dev/docs/extensions/capabilities
43. Figma 博客 — How to build a plugin system on the web and also sleep well at night：https://www.figma.com/blog/how-we-built-the-figma-plugin-system/ （后续安全更新 https://www.figma.com/blog/an-update-on-plugin-security/ 这次超时未读到）
44. logseq/marketplace README：https://github.com/logseq/marketplace
45. Joplin — Plugin Manifest：https://joplinapp.org/help/api/references/plugin_manifest/
46. mountain-loop/yaak `packages/plugin-runtime-types/README.md`：https://github.com/mountain-loop/yaak/blob/main/packages/plugin-runtime-types/README.md
47. Kunkun 文档 — Extensions：https://docs.kunkun.sh/extensions/
48. （二手，搜索摘要）tauri-plugin-js：https://docs.rs/crate/tauri-plugin-js/latest ；Tauri 插件开发：https://tauri.app/develop/plugins/
49. Grafana — UI extensions 概念：https://grafana.com/developers/plugin-tools/how-to-guides/ui-extensions/ui-extensions-concepts
50. Grafana — UI extensions API 参考：https://grafana.com/developers/plugin-tools/reference/ui-extensions-reference/ui-extensions
51. Grafana — plugin.json 参考：https://grafana.com/developers/plugin-tools/reference/plugin-json
52. Backstage — Frontend system: Extensions：https://backstage.io/docs/frontend-system/architecture/extensions
53. Backstage — Frontend system: Migrations：https://backstage.io/docs/frontend-system/architecture/migrations
54. JupyterLab — Extension Developer Guide：https://jupyterlab.readthedocs.io/en/stable/extension/extension_dev.html
55. Theia — Extensions and Plugins：https://theia-ide.org/docs/extensions/
56. Theia — Services and Contributions：https://theia-ide.org/docs/services_and_contributions/
57. DeepSeek Harness — Web Client Slots：https://github.com/deepseek-ai/deepseek-harness/blob/HEAD/docs/subsystems/slots.md

### 没读到或没核实的（汇总）

- VS Code：product.json 的 `extensionEnabledApiProposals` 白名单；扩展宿主无响应时的自动 profile 和归因；市场签名细节；package.nls 本地化。
- Obsidian：Developer policies 条款；旧的 community-plugins.json PR 流程及其切换时间；插件间 monkey-patch 冲突的一手记录。
- Koishi：`koishi.public`、`koishi.exports`、`koishi.icon` 的实际用途；`insecure` 是否还有自动判定；市场设计的专门文档（原链接 404）。
- Figma：替换 Realms 的虚拟机是否为 QuickJS。
- Logseq：默认 iframe 沙箱、shadow DOM 模式、package.json 的 `logseq` 键。
- Joplin：`.jpl` 打包与分发、运行隔离方式。
- Kunkun：iframe、`kunkun` 清单键、权限表。
- Zed 不做界面扩展的官方理由。
- JupyterLab 重复注册 token 时的具体报错。
- cordis.io 官网（重定向循环，未读到）；DSH 文档站 deepseek-harness.github.io（被拦截，改读仓库里的同一份 Markdown）。
