# 「万物皆插件」：DeepSeek Harness 和 Cordis 是怎么做的

> 日期：2026-11-14。问题：用户想让浮屿的插件系统做到 DeepSeek Harness 那样「万物皆插件」：插件什么都能改。DeepSeek Harness 实际是怎么做的，浮屿能借鉴什么。范围：`deepseek-ai/deepseek-harness` 仓库的 `docs/architecture`、`cordis-primer`、`capability-seams`、`subsystems/client-modules`、`subsystems/slots`、`packages/boot/plugin-manager`、`SAFETY`、`vendor/README`（main 分支，2026-11-14 读）；`cordiverse/cordis` 仓库和 npm 包 `cordis`。方案见 [v3-everything-plugin.md](../architecture/plugins/v3-everything-plugin.md)。

后续调研（2026-11-14）：[同类插件架构](plugin-architectures.md)、[同权插件的安全](plugin-security.md)、[技术可行性](plugin-host-feasibility.md)。

## 结论

- **DeepSeek Harness（dsh）的「万物皆插件」是字面意思**：仓库简介就是「Everything is a Plugin」。模型适配器、工具注册表、会话日志、连 agent 循环本身都是插件；没有「需要打补丁的特权内核」，扩展的方式是把插件挂到别的插件旁边 [1]。
- 它靠的是 **Cordis** 框架（Koishi 机器人框架的内核，MIT）[2][3]。Cordis 的五个概念撑起了全部：插件 = `apply(ctx)`；上下文是服务容器（`ctx.tools`、`ctx.llm`）；`inject` 声明依赖、自动按依赖顺序启动；类型化事件，五种分发方式（其中 `waterfall` 是可以改写结果的中间件链）；所有注册都是**可撤销的副作用**，插件卸载时自动清理，所以能热重载 [2]。
- **「能替换任何东西」来自三件事**：每项能力都是一个「接缝」（接口 + 提供者 + 使用者），换掉提供者就改变整个产品 [1]；启动时的插件树由 YAML 配置一层层叠出来，任何一行都能被用户的 patch 按 id 替换或关掉 [1]；界面也是插件，Web 端用类型化的「插槽」（slots）组合，功能插件只往插槽里注册，从不直接引用别的插件的组件 [5]。
- **代价是安全**：插件和程序在同一个进程里，完全互信。dsh 自己写明：已安装的宿主代码在宿主进程内运行，不受沙箱限制；它是未经安全审计的开发者预览版，不可信插件可能损坏电脑、泄露凭据，建议在虚拟机或容器里跑 [6][7]。它的保护只有「安装要用户批准」「依赖脚本单独批准」「版本兼容检查」[6]。
- **对浮屿**：整套照搬不现实，Rust 后端没法像 Node 那样热插拔。能学到的是**组织方式**：前端用 Cordis 式的上下文、服务、插槽和可撤销注册，把内置功能拆成插件；后端能力包成服务；插件可以替换或关闭任何内置功能。信任模型要明确分级。具体见方案文档。

## 详细

### 插件、上下文、服务

- 插件是带可选 `inject` 和 `apply(ctx)` 的函数，或 `Service` 的子类 [2]。
- 服务占据稳定的 `ctx.<key>`，别的插件按 key 找服务，不导入具体实现 [2]。这就是「可替换」的根：换一个注册到同一个 key 的插件，所有使用者跟着换。
- `inject` 声明依赖，服务就绪才启动；加载顺序靠依赖表达，不手动排 [2]。

### 事件的五种分发方式

| 方式 | 等待 | 返回值 | 用途 |
|---|---|---|---|
| `emit` | 否 | 否 | 通知 |
| `waterfall` | 否 | 是 | 中间件链：监听者拿到 `next()`，可以改写、包装或短路下游 |
| `parallel` | 是 | 否 | 并行扇出 |
| `serial` | 是 | 是 | 按序执行 |
| `bail` | 否 | 是 | 第一个给出结果的胜出 |

分发方式是事件公开约定的一部分 [2]。dsh 的拦截点（发请求前、执行工具前后）都是 `waterfall`，插件能改写、拒绝或替换 [1]。

### 可撤销的副作用和热重载

提示词片段、工具、适配器、监听器都通过 `ctx.effect()` / `ctx.on()` 注册，插件卸载或重载时按顺序撤销 [2]。dsh 用 `dsh-hmr` 监视配置，开关插件立刻生效；不开 HMR 时要重启 [1][6]。

### 配置即组装：profile、组合包、patch

运行中的 dsh 是一棵插件树：profile 列出叠放的组合包（bundle），组合包是「配置项 + 挂载代码」的分发格式；再叠用户的 `cordis.patch.yml`、home patch、命令行 `--patch`。patch 按条目 id 替换整份配置或插入新条目，`dsh --dump-config` 能打出整棵树，打印出的任何一行都能被替换 [1]。

### 界面也是插件：插槽

Web 端的 `ctx.slots` 是类型化的 React 组合系统：插槽由拥有那块界面的组件声明，别的插件 `ctx.slots.register()` / `inject()` 往里加东西；功能插件绝不导入别的功能插件的组件。插槽有基数、作用域和生命周期，拥有者卸载时，往里注册的东西一起撤掉 [5]。客户端插件由宿主扫描包里的 `dsh.client` 声明，组装成启动图后下发到浏览器 [4]。

### 安装、市场和信任

- 插件以 npm 组合包分发，`plugin-manager` 用 pnpm 安装、启停、更新；检查平台声明、`engines.dsh` 版本兼容，安装失败自动回滚 [6]。有插件市场服务 `ctx.pluginMarket` [8]。
- 市场是去中心化的：`ctx.pluginMarket` 读用户自己添加的索引地址，默认一个都没有；索引只列包名、版本和安装方式（npm 或固定到提交的 git），详细介绍从 npm CDN 或 git 仓库读 [11]。插件本身发在 npm 或 git 上，官方可选组合包按需从 npm 装，版本跟着 dsh。文档里没看到索引签名、作者签名或审核（2026-11-14）。
- 信任：工具操作要 `danger-full-access` 或单次审批；**已安装的宿主代码在宿主进程内运行，不受工作区沙箱限制**；依赖构建脚本要单独批准 [6]。安全说明里写明不可信插件可能损坏电脑、泄露数据 [7]。

### Cordis 本身

`cordiverse/cordis`，MIT，简介「Meta-Framework of Spatiotemporal Composability」，约 9.9k star（2026-11-14）[3]。npm 包 `cordis` 的 latest 是 `4.0.0-rc.13`，还没出正式版 [9]。dsh 把 cordis 及几个官方插件（loader、include、hmr、timer……）整份拷进 `vendor/`、改成自己的 scope，理由是「完全掌握框架层：可审计、可改、版本固定」[10]。

### 和 VS Code 的对比

VS Code 也被叫作「万物皆插件」，但做法不同：插件在单独的扩展宿主进程里，只能通过贡献点和提供者接口扩展，不能直接改编辑器界面；内置功能（Git、Markdown、语言支持）用的是同一套公开接口。它的「什么都能改」是「官方能做的，插件也能用同一套接口做」。dsh 更进一步：连核心都能整个替换，代价是完全互信。

## 来源

1. DeepSeek Harness 架构：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.zh.md
2. Cordis 入门：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.zh.md
3. Cordis 仓库：https://github.com/cordiverse/cordis
4. Client 模块：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/client-modules.zh.md
5. Web Client Slots：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/slots.zh.md
6. 插件管理器：https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/boot/plugin-manager/README.zh.md
7. 安全说明：https://github.com/deepseek-ai/deepseek-harness/blob/main/SAFETY.zh.md
8. 能力接缝图：https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/capability-seams.zh.md
9. npm 包 cordis：https://www.npmjs.com/package/cordis
10. dsh 的 vendor 说明：https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/README.md
11. 插件市场：https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/boot/plugin-market/README.zh.md
