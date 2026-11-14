import { mockIPC } from "@tauri-apps/api/mocks";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/tokens.css";
import { I18nProvider, LOCALE_STORAGE_KEY, TRANSLATIONS } from "../../src/i18n";

const savedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
window.addEventListener("beforeunload", () => {
  if (savedLocale === null) localStorage.removeItem(LOCALE_STORAGE_KEY);
  else localStorage.setItem(LOCALE_STORAGE_KEY, savedLocale);
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, isTauri: true });

const startupWrites: boolean[] = [];
mockIPC((command, payload) => {
  switch (command) {
    case "get_platform_support":
      return { os: "windows", unsupported: [], devBuild: true };
    case "updater_configured":
      return false;
    case "set_launch_at_startup":
      startupWrites.push(Boolean((payload as { enabled?: boolean } | undefined)?.enabled));
      return null;
    default:
      return null;
  }
}, { shouldMockEvents: true });

const { DevWatermark } = await import("../../src/components/DevWatermark");
const { BehaviorSettingsSection } = await import("../../src/features/appearance/BehaviorSettingsSection");
const { UpdatePanel } = await import("../../src/features/updater/UpdatePanel");

const text = TRANSLATIONS["zh-CN"].settings.devBuild;
const messages: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  messages.push(`PASS ${message}`);
};
const results = document.getElementById("results")!;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

try {
  await act(async () => {
    createRoot(document.getElementById("marks")!).render(
      <StrictMode><I18nProvider><DevWatermark place="collapsed" /><DevWatermark place="panel" /><DevWatermark place="settings" /></I18nProvider></StrictMode>,
    );
    createRoot(document.getElementById("rows")!).render(
      <StrictMode><I18nProvider>
        <BehaviorSettingsSection launchAtStartup={false} locale="zh-CN" onLaunchAtStartupChange={(enabled) => startupWrites.push(enabled)} onLocaleChange={() => {}} />
        <UpdatePanel />
      </I18nProvider></StrictMode>,
    );
  });
  await settle();

  const marks = [...document.querySelectorAll<HTMLElement>("#marks .dev-watermark")];
  check(marks.length === 3 && marks.every((mark) => mark.textContent === text.mark), "A development build shows the DEV mark in all three places");
  check(marks.every((mark) => mark.getAttribute("aria-hidden") === "true" && getComputedStyle(mark).pointerEvents === "none" && getComputedStyle(mark).position === "absolute"),
    "The marks take no clicks, no layout space and are hidden from screen readers");

  const startup = document.querySelector<HTMLInputElement>("#rows .settings-row input[role='switch']");
  check(startup?.disabled === true, "Launch at startup is switched off in a development build");
  startup?.click();
  await settle();
  check(startupWrites.length === 0, "Clicking the disabled switch changes nothing");
  check(document.getElementById("rows")!.textContent?.includes(text.launchAtStartupOff), "The row says why launch at startup is off");
  check(document.getElementById("rows")!.textContent?.includes(text.updateOff), "The update panel says a development build does not update");

  results.textContent = messages.join("\n");
  document.documentElement.dataset.testResult = "passed";
} catch (error) {
  results.textContent = [...messages, `FAIL ${error instanceof Error ? error.message : String(error)}`].join("\n");
  document.documentElement.dataset.testResult = "failed";
}
