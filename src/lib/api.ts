import { invoke } from "@tauri-apps/api/core";

export type PlatformFeature = "clipboard" | "screenshot" | "translation" | "music" | "qq" | "wechat" | "agentConnect" | "agentRemote";

export type PlatformSupport = { os: "windows" | "macos"; unsupported: PlatformFeature[]; devBuild?: boolean };

export function readPlatformSupport() {
  return invoke<PlatformSupport>("get_platform_support");
}
