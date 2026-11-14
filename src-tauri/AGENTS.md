# Rust / Tauri 规则（src-tauri/）

适用于 `src-tauri/` 下的所有文件，在根目录 [AGENTS.md](../AGENTS.md) 的基础上补充原生侧细则。各模块从旧位置迁到新位置的映射见 [docs/architecture/migration-map.md](../docs/architecture/migration-map.md)。

## 目标结构

```text
src-tauri/src/
├── main.rs                  # 只调用 fuyu_lib::run()
├── lib.rs                   # 只有 mod 声明和 run()：插件、setup、托盘、collect_commands!（汇总各模块的 tauri_commands!）
├── tray.rs                  # 托盘菜单与事件：文字跟随岛屿语言（命令 set_tray_language），显示 / 隐藏合成一项，按岛屿当前是否可见显示
├── tray_mark.rs             # 只在 macOS 上编译：菜单栏用的单色模板图，按 mark.svg 的胶囊在代码里画
├── island/                  # 主窗口：命令、窗口状态、几何计算、毛玻璃、鼠标穿透（banner_hit.rs：新消息横幅的可点区域）、贴边动画
├── todos/                   # 待办与每日笔记：todos.json 持久化、从旧版 localStorage 迁移、命令与插件/本地接口读写
├── agent_approval/          # 在岛上审批（B6 第 2 期）：127.0.0.1 上的审批端点（标准库 TcpListener，挂起时能发现 Agent 断开）、按会话排队、等待上限、agent-approval.json
├── agent_status/            # AI 代理状态：快照、运行标记、Codex / Claude Code hook 安装；hooks/ 为编入二进制的 hook 脚本；sound_packs.rs 为导入的音效包（应用数据目录的 sound-packs/）
│                            #   reply_marker.rs：可选的回复状态标记（B9），增删 CLAUDE.md 里岛屿自己的那段说明、识别回复末行的标记
├── phone_push.rs            # 手机推送（Bark）：设备 Key 凭据存取、发送推送、锁屏与空闲时间查询命令
├── claude_usage/            # 用量环可选的「直接向 Anthropic 查询」：只读 Claude Code 凭据、经 http(s) 代理（插件设置 → HTTPS_PROXY → Windows 系统代理，从不直连）请求 oauth/usage，后台轮询与退避；结果由 agent_status 的 get_agent_usage 合并（source.rs 为取数与解析）
├── ssh_tunnel/              # SSH 代理隧道（内置插件 focusd.ssh-proxy-tunnel）：ssh-tunnels.json（config.rs），每台主机一条常驻 ssh -R、作业对象、退避重连（tunnel.rs），服务器端口占用检查，本地代理端口自动检测（local_proxy.rs）
├── cc_connect/              # cc-connect 手机连接（内置插件 focusd.cc-connect）：找程序（插件设置 → 正在运行 → PATH → 岛下载的 → C/D 盘 Program Files，locate.rs）、下载并核对发布包（install.rs）、只读会话列表（chats.rs）、检查机器人 token（bots.rs）、往 config.toml 追加项目（config_file.rs）、飞书扫码（feishu.rs）、看护岛启动的 cc-connect（runner.rs）、经 cc-connect send 发消息
├── system/                  # 开机自启（注册表）、更新代理与配置、待办 Markdown 导出；update_runtime.rs 为跨窗口更新状态与互斥，update_notifications.rs 为更新系统通知与白名单诊断
├── rename_migration/        # 改名迁移（D17）：首次启动时把 com.focusd.island 的数据目录、凭据、开机自启、hook 迁移到 com.tixxin.fuyu，并静默卸载旧安装
├── clipboard_history/
├── file_shelf/              # 文件中转：路径列表（file-shelf.json）与命令；拖出调用 win32/ole.rs
├── screenshot/              # 截图（C41）：快捷键线程（hotkeys.rs，主键盘 RegisterHotKey、小键盘交给 win32/win_key_hook.rs），每个显示器先截图再给它一个常驻隐藏的选区窗口 screenshot-<n>（session.rs，截屏在 win32/screen_capture.rs），复制到剪贴板（output.rs、clipboard.rs）；系统调用经 capture.rs，Mac 上换成 `*_macos.rs`（ScreenCaptureKit、NSPanel、global-hotkey）
├── recording/               # 录屏（C41.11）：命令、倒计时、暂停计时和浮屿窗口排除在录像外（control.rs，状态在 state.rs，发 recording-state / recording-finished 给岛），录制线程（session.rs：WGC 帧经有界队列交给编码线程，满了丢帧计数）、帧节奏（pacing.rs，静止 3 个间隔才补重复帧，暂停扣时长）、尺寸码率和文件名（format.rs）、声音（audio.rs 接采集、按视频时间轴放；mixer.rs 混成 48 kHz 立体声）、GIF（gif.rs：每 1/15 秒挑一帧读回内存交给 gifski 线程）；声音采集在 win32/audio_capture.rs，画面采集在 win32/graphics_capture.rs，编码写 MP4 在 win32/video_writer.rs
├── pets/                    # Codex Pets（petdex）：只读列出 ~/.codex/pets 与 <app data>/pets，校验后以 data URL 返回图集
├── local_api/               # 本地接口：127.0.0.1 HTTP（tiny_http）、鉴权与路由、转给 main 窗口的桥、local-api.json；由内置插件开关
├── plugin_host/             # 插件：清单校验、plugins.json、子进程监督与 stdio JSON-RPC、权限表、设置页、市场与签名、撤销名单（revocations.rs）、后台检查与自动更新（updates.rs）、自定义界面页面（webviews.rs）、插件自己的窗口（windows/，实验接口，E34）、内置插件（builtin.rs）、按需启动与资源（activation.rs、lifecycle.rs）、开发模式（dev.rs）、清单里的 Agent 强度名称（effort_labels.rs）
├── media_control/
├── calendar/                # 日历：CalDAV（caldav.rs）和 ICS 订阅链接，iCalendar 解析和重复日程展开（ics.rs，rrule），会议链接识别（meeting_link.rs），来源配置与凭据（sources.rs）
├── lyrics/                  # 音乐页歌词：本地 .lrc 文件夹（local.rs）、LRCLIB（lrclib.rs，用户开启才联网）、按歌名歌手时长匹配（matching.rs），在线结果缓存在 lyrics-cache/
├── system_levels/           # 音量、亮度变化提示：后台线程读默认输出的音量和静音、笔记本屏幕亮度（win32/brightness.rs，WMI），变化时发 system-level-changed 事件
├── device_events/           # 设备提示：后台线程列出在用的耳机和蓝牙音频输出（win32/audio_outputs.rs）、读蓝牙电量（win32/devnode.rs）和电源（win32/power.rs），变化时发 device-alert 事件；判断规则在 tracker.rs
├── device_use.rs            # 摄像头、麦克风正在被哪些程序使用（读注册表 CapabilityAccessManager\ConsentStore），打开系统隐私设置
├── mail/                    # 邮箱（命令名仍为 *_qq_mail）：附件（attachments.rs）、命令、每个邮箱一个后台服务（accounts.rs）及其崩溃后重启（supervisor.rs）、IMAP 会话、正文与内嵌图片解析、凭据
├── qq_notifications/        # QQ 通知监听；repair-qq-notification-registration.ps1 编入二进制，也可手动运行
├── wechat_reminders/        # 提醒服务与命令；source.rs 为托盘闪烁监听（examples 通过 #[path] 复用）
├── translation/             # 快捷翻译：窗口、全局快捷键、凭据与翻译请求（mod.rs）
├── settings_window/         # 设置窗口：按需创建与显示（mod.rs）
├── onboarding_window/       # 新手引导：按需创建的透明遮罩，铺满岛所在屏幕的工作区（mod.rs）；跟着真岛发位置、只在卡片上接住鼠标（overlay.rs）
├── settings_file.rs         # 数据目录里的 settings.json（D30.2）：BACKUP_KEYS 设置的文件镜像，格式同设置备份；命令 read_settings_file / write_settings_file
├── shortcut_capture.rs      # 设置窗口录快捷键期间（命令 set_shortcut_capture）：浮屿自己的全局快捷键被按下不执行，改发 shortcut-captured 给录制按钮；Mac 在 macos/hotkeys.rs 的分发里拦，Windows 在各模块的 WM_HOTKEY 里拦
├── home_dir.rs              # 家目录（#50，D30）：浮屿的数据目录只从这里取 fuyu_home(app.path())，不要直接调 app_data_dir()；FUYU_HOME → home.json 指针 → ~/.fuyu；home_dir/migration.rs 为升级时复制旧数据、重装钩子、复制待办 Markdown，见 docs/features/data-home.md
├── fs_write.rs              # 整份替换应用数据目录里的文件：先写旁边的 .tmp 再改名；别的程序暂时占着（拒绝访问、共享冲突）时稍等重试
├── dev_lane.rs              # 和正式版并排跑的开发版（设了 FOCUSD_DEV_LANE 的调试版，`pnpm dev:side` 启动，F38）：独立应用标识、默认位置，不改用户的链接、自启和 hook；凭据服务名带后缀（`service`），dev_lane/seed.rs 在启动时复制一次正式版的凭据（F39.2）
├── messenger_activation.rs
├── notification_diagnostics.rs
├── user_error.rs            # 用户看到的错误：错误码、文案参数和外部原话（D15），前端按界面语言显示；凭据管理器的通用错误；
│                            #   Mac 上的 unsupported()（错误码 platform.unsupported）和批量生成「暂不支持」命令的 unsupported_commands!
├── platform_support.rs      # 命令 get_platform_support：当前系统和它还不支持的功能，前端据此在设置和岛上隐藏
├── platform.rs              # 两个平台都有的平台层模块（icon、job、process、process_env、process_times、process_tree）：Windows 上取 win32/，macOS 上取 macos/
├── macos/                   # macOS 平台层（G1，决定 M10），和 win32/ 一样是允许 unsafe 的地方；第 0 步只有和 win32/ 同名同签名的空实现
└── win32/                   # Win32 / COM 的安全封装，和 macos/ 一起是 crate 中允许 unsafe 的地方：window（窗口查询、枚举、前台切换）、
                             # message_window（隐藏消息窗口与安全的窗口过程）、hotkey、win_key_hook、clipboard、shell_hook、input、
                             # com（COM / WinRT 初始化守卫）、audio、ole（文件拖出）、process / process_times / process_env /
                             # process_memory / process_tree、registry、credentials、dwm、icon、ocr、chinese、screen_capture、
                             # capture_targets、taskbar、uia_list / uia_tabs、url_protocol、brightness、
                             # notification_state（前台是否有全屏程序）、webview_page（插件自定义界面的独立 WebView2 页面，P8）、
                             # plugin_window（插件窗口：不经过 Tauri 的顶层窗口、标题条、层级、透明、小组件不拿焦点、屏幕列表，E34）、
                             # job（插件进程的作业对象与挂起启动）、known_folder（下载文件夹等已知文件夹）、
                             # session_notifications（锁屏、睡眠唤醒通知与键鼠空闲时间）、audio_outputs（在用的音频输出及类型）、
                             # devnode（设备节点属性：容器、蓝牙电量）、power（电源与电池）、graphics_capture（D3D11 设备与 WGC 显示器采集，帧留在 GPU）、
                             # video_writer（Media Foundation Sink Writer：硬件 H.264 写 MP4，失败换软件；可带 AAC 声音）、
                             # audio_capture（WASAPI 录系统声音和麦克风，系统声音同时开一路静音播放流，防止没声音时断包）
```

## lib.rs 与模块组织

- `lib.rs` 只做组装：`mod` 声明、插件注册、`setup`、托盘创建、命令注册。不写业务逻辑、不定义命令。
- 命令清单不写在 `lib.rs`：每个有命令的模块在自己的 `mod.rs` 里用 `tauri_commands!` 宏列出命令（写 `crate::` 开头的完整路径，例如 `crate::mail::refresh_qq_mail`，子模块的命令也列在顶层模块里），`lib.rs` 的 `collect_commands!` 把各模块的清单串成一个 `generate_handler!`。新增命令只改所在模块的 `tauri_commands!`；新增一个有命令的模块时，才在 `collect_commands!([] ...)` 里加上模块名。`tauri_commands!` 要放在内联测试模块之前（clippy `items_after_test_module`）。
- 文件超过 800 行或承担多个职责时，改成目录模块 `foo/mod.rs` 加子文件。常见的拆法：

  | 文件 | 内容 |
  |---|---|
  | `mod.rs` | `#[tauri::command]` 薄层、`init()`、对外类型 |
  | `service.rs` / `state.rs` | 后台线程、全局状态、事件推送 |
  | 领域文件（如 `content.rs`、`geometry.rs`） | 纯逻辑，便于单测 |
  | `tests.rs` | 测试模块，超过 150 行时从源文件中移出 |

- 模块对外只暴露命令、`init()` 和前端需要的类型，其余用 `pub(crate)` 或保持私有。
- 不新建 `utils.rs`、`common.rs` 这类杂物模块。确实有通用代码时，按用途命名（例如 `win32/registry.rs`、`fs_write.rs`）。

## 命令

- 命令的错误用 `user_error::UserError`：`UserError::new("<模块>.<情况>", "英文原文")`，需要填值用 `.arg`，外部程序、服务、系统的原话用 `.detail`；新 code 同时在 `src/i18n/sections/errors.ts` 写中英文文案，测试断言 `code()` 而不是文字。还没迁移的模块返回 `Result<T, String>`（英文、让用户能读懂），`?` 会把字符串转成 `UserError`（code `plain`，前端原样显示）。
- 会阻塞的命令，或调用窗口、COM、Windows UI 的命令，声明为 `async`，避免阻塞 IPC 线程（在 Windows 上可能死锁，见 `settings_window/mod.rs`）。
- 命令函数保持薄：只做参数校验，然后调用服务或领域函数。
- 命令名就是函数名，属于对外契约。纯重构中可以移动函数所在模块，但不能改函数名或参数名。
- 事件名定义为模块内的 `const`，向特定窗口发事件时使用窗口 label 常量（例如 `settings_window::WINDOW_LABEL`），不写字面量。
- 新增命令后，同步更新前端对应的 `api.ts`；用到插件权限时更新 `capabilities/default.json`。新窗口的 label 必须加入 capabilities 的 `windows` 列表。
- **插件 API 的新能力先进实验通道**（2026-11-14 起，用户定，E30）：新方法、事件、贡献点或给已有方法加的行为，先放进 `plugin_host/dev.rs` 的 `EXPERIMENTAL_APIS`，只给开发模式的插件用；满足 [v2-platform.md](../docs/architecture/plugins/v2-platform.md) 3.1 节的转正条件后才进 `initialize.capabilities`。给已有方法加一个旧插件不会传的可选字段，不算新能力。

## 错误处理

- 生产代码禁止使用 `unwrap()` 和 `expect()`。只有在能证明不会失败时才允许使用（例如字面量常量的解析），用 `#[allow(clippy::unwrap_used)]` 放行，理由写在提交说明里，不写注释。测试代码不受此限。
- `Mutex` 加锁使用 `lock().map_err(...)` 或 `unwrap_or_else(PoisonError::into_inner)`，不要因为锁中毒导致整个应用崩溃。
- `let _ = ...` 忽略错误只用于尽力而为的操作，例如推送事件、清理临时文件。
- 错误转换就近写 `map_err(|error| error.to_string())` 或带上下文的 `format!`，不吞掉原始错误信息。

## 平台（Windows 与 macOS）

- 做法见 [overview.md](../docs/architecture/overview.md)「平台层」，计划与迁移表见 [macos-port-plan.md](../docs/architecture/macos-port-plan.md)。
- `windows`、`windows-future`、`webview2-com`、`clipboard-win` 在 `Cargo.toml` 的 `[target.'cfg(windows)'.dependencies]` 里，只在 Windows 上编译；用到它们的代码必须在 `cfg(windows)` 下。
- 只在 Windows 上有的模块（或子模块）用 `#[cfg_attr(not(windows), path = "<名字>_unsupported.rs")]`（目录模块用 `<目录>/unsupported.rs`）换成 Mac 上的空实现：保留同样的命令名和参数、`tauri_commands!` 清单，以及其他模块用到的函数；命令用 `crate::user_error::unsupported_commands!` 生成，返回 `platform.unsupported`；开关类命令写成空函数。Windows 上的原文件不为 Mac 改动。
- 两个平台都要用的系统能力放在 `win32/` 和 `macos/` 的同名模块里，签名一致，业务代码写 `crate::platform::<模块>`。
- 只在 Windows 上用到、Mac 上因此成了「未使用」的纯函数，用 `#[cfg(any(windows, test))]` 或 `#[cfg_attr(not(windows), allow(dead_code))]`；依赖 Windows 路径、程序或 API 的测试加 `#[cfg(windows)]`。
- 写的时候就避开这类「未使用」：只给 Windows 模块用的辅助函数放进那个 `cfg(windows)` 的模块里，不放在两个平台都编译的文件中；Mac 上的空实现（`unsupported.rs`）参数照旧，但不为它定义只有 Windows 才读字段的结构体，要共用的结构体定义在两边都用得到的地方，或在空实现里加上一条的属性。
- 改动后两个平台都要过 clippy：Windows 上照常跑；在 Mac 上跑 `cargo clippy --all-targets -- -D warnings` 和 `cargo test`，CI 的 `rust-macos` job 也会跑。在 Windows 上没法交叉检查 Mac（2026-11-14 试过 `--target aarch64-apple-darwin`：`objc2-exception-helper`、`aws-lc-sys` 要面向 macOS 的 C 编译器和苹果的 SDK），Mac 上的编译错误只能由 CI 的 `rust-macos` 发现。在 Mac 上交叉检查 Windows：`brew install mingw-w64`、`rustup target add x86_64-pc-windows-gnu` 后 `cargo clippy --target x86_64-pc-windows-gnu --all-targets -- -D warnings`（只检查，不能运行测试）。

## unsafe 与 Windows API

- **`unsafe` 只能写在 `win32/` 和 `macos/` 中**，对外暴露安全函数，参数尽量用 Rust 类型（`&str`、`u32`），不让调用方传裸指针。生产代码中这两个目录以外没有 `unsafe`；窗口过程实现 `win32::message_window::WindowMessages`，枚举窗口用 `win32::window::for_each_top_level_window` 的闭包。
- `wechat_reminders/source.rs` 及它用到的 `win32/` 文件也被 `examples/wechat_reminder_probe.rs` 通过 `#[path]` 编译，这些文件只能依赖 `windows` crate，不能引用 crate 内其他模块。
- `unsafe` 块不写 `// SAFETY:` 注释（代码不写注释，见根目录 AGENTS.md），前置条件靠 `win32/` 对外的安全函数签名保证，有特殊前提时写进提交说明。
- 句柄、COM 对象等资源用 RAII 类型包装，在 `Drop` 中释放，不手动配对 close。
- COM 初始化与反初始化在同一线程中配对完成。
- 开机自启只使用当前用户注册表路径 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，遵循最小权限。
- 写文件（例如 Markdown 导出）必须校验目录和文件名，禁止写入不受控的路径。
- 新增 `windows` crate feature 时只加实际需要的项，`dev-dependencies` 中同样如此。

## 状态与线程

- 全局状态（`OnceLock`、`static`）封装在所属模块内部，通过访问函数使用，不跨模块直接引用。
- 后台线程和 worker 在对应功能关闭时必须能退出或暂停；长循环要检查停止信号，不能空转轮询。
- 跨线程推送事件统一走 `AppHandle::emit` / `emit_to`，不在后台线程直接操作窗口，必要时切换到主线程执行。

## 测试

- 纯逻辑（几何计算、解析、状态机、配置合并）必须有单元测试。
- 测试模块超过 150 行时移到 `<模块>/tests.rs`，在 `mod.rs` 中通过 `#[cfg(test)] mod tests;` 引入。
- 依赖真实桌面环境（运行中的 QQ / 微信、通知权限）的测试必须标注 `#[ignore = "原因"]`，不得进入默认测试集。
- `examples/` 中的探测程序用 `cargo run --example <name>` 手动运行，用于排查兼容性问题，不放生产逻辑。

## 配置与构建

- 修改 `tauri.conf.json` 中的窗口配置时，同步检查 `capabilities/default.json`、前端 `main.tsx` 的窗口分发，以及 Rust 中的 label 常量。
- `agent_status/hooks/fuyu-agent-*.{cmd,ps1}` 和 `qq_notifications/repair-qq-notification-registration.ps1` 通过 `include_str!` 编入二进制，修改后需要完整的 Rust 验证。
- clippy lint 在 `Cargo.toml` 的 `[lints.clippy]` 中声明（`undocumented_unsafe_blocks`、`unwrap_used`、`expect_used` 为 deny），测试代码的放行写在 `clippy.toml`；不要在源文件中用 `#![warn]` / `#[allow]` 重复声明这些 lint。`cargo clippy --all-targets` 保持 0 告警；个别确实无法消除的默认 lint（例如参数即 IPC 契约的命令触发 `too_many_arguments`）在该项上用带 `reason` 的 `#[expect(...)]`。
- 验证：`cargo test --manifest-path src-tauri/Cargo.toml` + `pnpm build:exe`。涉及窗口、托盘、注册表行为的改动，在风险需要时请用户在 `pnpm tauri dev` 里手动检查折叠态、展开态、贴边收起和托盘隐藏。
- 成功生成 release 可执行文件后，桌面快捷方式按根目录规则处理（默认不动）。
