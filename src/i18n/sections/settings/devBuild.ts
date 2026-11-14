export type SettingsDevBuildText = {
  mark: string;
  launchAtStartupOff: string;
  updateOff: string;
};

export const zhCN: SettingsDevBuildText = {
  mark: "DEV",
  launchAtStartupOff: "这是开发版，不改开机自启。请在安装的正式版里设置。",
  updateOff: "这是开发版，不检查也不安装更新。新版本请在安装的正式版里更新。",
};

export const en: SettingsDevBuildText = {
  mark: "DEV",
  launchAtStartupOff: "This is a development build, so it doesn't change launch at startup. Set it in the installed app.",
  updateOff: "This is a development build, so it doesn't check for or install updates. Update the installed app instead.",
};
