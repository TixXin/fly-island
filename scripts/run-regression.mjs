import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditLight, MIN_CONTRAST } from "./regression-contrast.mjs";

export const PAGES = [
  "agent-alert-card.html",
  "agent-alerts.html",
  "agent-approvals.html",
  "agent-sessions.html?test=1",
  "calendar.html",
  "center-pattern.html?test=1",
  "claude-usage.html?test=1",
  "session-ring.html?test=1",
  "collapsed-message-animation.html?test=1",
  "collapsed-slots.html?test=1",
  "dev-build.html",
  "notch-island.html?test=1",
  "message-banner.html?test=1",
  "message-panel.html?test=1",
  "i18n.html?test=1",
  "mail-reader.html?run=1",
  "music-lyrics.html",
  "notification-startup.html",
  "onboarding.html?test=1",
  "plugin-menus.html",
  "plugin-views.html?test=1",
  "settings.html?test=1",
  "settings-sidebar.html",
  "settings-search.html",
  "agent-remote.html",
  "ssh-tunnel.html",
  "tucked-hover.html",
  "update-reminder.html?test=1",
  "list-pages.html?test=1",
  "clipboard-popup.html?test=1",
  "clipboard-preview.html?test=1",
  "screenshot-overlay.html",
  "screenshot-pin.html",
  "screenshot-card.html",
  "screenshot-history.html",
  "screenshot-measure.html",
  "screenshot-record.html",
  "recording-notice.html",
  "timer.html",
  "todo-island.html",
];

const PAGE_TIMEOUT_MS = 120_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export function pageOutcome({ testResult = "", dataResult = "", text = "" }) {
  const marker = testResult || dataResult;
  if (marker === "passed" || marker === "failed") return marker;
  if (/^ALL PASS/m.test(text) || /全部 \d+ 项检查通过/.test(text)) return "passed";
  if (/^SOME FAILED/m.test(text) || /^FAIL /m.test(text)) return "failed";
  return null;
}

export function passedChecks(text) {
  return (text.match(/^PASS /gm) ?? []).length;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const browser = process.env.CHROME_PATH ?? BROWSERS.find((candidate) => existsSync(candidate));
  if (!browser) throw new Error("No Chrome or Edge found; set CHROME_PATH.");
  return browser;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000}s`);
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const BROWSER_START_MS = 60_000;

async function connect(port, browser, browserLog) {
  const deadline = Date.now() + BROWSER_START_MS;
  let page;
  while (!page && Date.now() < deadline && browser.exitCode === null) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((target) => target.type === "page");
    } catch {}
    if (!page) await sleep(250);
  }
  if (!page) {
    const why = browser.exitCode === null ? `its DevTools endpoint did not come up within ${BROWSER_START_MS / 1000}s` : `it exited with code ${browser.exitCode} before its DevTools endpoint came up`;
    throw new Error(`The browser did not start: ${why}. Browser output:\n${browserLog().trim() || "(none)"}`);
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result ?? {});
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: process.env.REGRESSION_REDUCED_MOTION ?? "no-preference" }],
  });
  return { send, errors, close: () => socket.close() };
}

const READ_STATE = `(() => {
  const results = document.getElementById("results");
  return JSON.stringify({
    testResult: document.documentElement.dataset.testResult ?? "",
    dataResult: results?.dataset.result ?? "",
    text: results?.textContent ?? "",
  });
})()`;

export async function runPage(session, url) {
  session.errors.length = 0;
  await session.send("Page.navigate", { url });
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  let state = {};
  while (Date.now() < deadline) {
    await sleep(500);
    const { result } = await session.send("Runtime.evaluate", { expression: READ_STATE, returnByValue: true });
    try { state = JSON.parse(result?.value ?? "{}"); } catch { state = {}; }
    const outcome = pageOutcome(state);
    if (outcome) return { outcome, state, errors: [...session.errors] };
  }
  return { outcome: "timed out", state, errors: [...session.errors] };
}

export async function withRegressionBrowser(root, firstPage, use) {
  const vitePort = Number(process.env.REGRESSION_PORT ?? await freePort());
  const debugPort = await freePort();
  const base = `http://127.0.0.1:${vitePort}/tests/regression/`;
  const profile = mkdtempSync(path.join(tmpdir(), "fly-regression-"));
  const vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--port", String(vitePort), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  let browser;
  try {
    await waitForHttp(`${base}${firstPage.split("?")[0]}`, 30_000);
    if (vite.exitCode !== null) throw new Error(`Vite exited (port ${vitePort} taken?); not testing whatever answers there.`);
    const language = process.env.REGRESSION_LANG ?? "zh-CN";
    browser = spawn(findBrowser(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, `--lang=${language}`, `--accept-lang=${language}`, `--user-agent=${USER_AGENT}`,"--window-size=1280,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    let browserLog = "";
    browser.stderr.on("data", (chunk) => { browserLog = (browserLog + chunk).slice(-4000); });
    const session = await connect(debugPort, browser, () => browserLog);
    const result = await use({ session, base });
    session.close();
    return result;
  } finally {
    browser?.kill();
    vite.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      console.warn(`Could not remove ${profile}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const filters = process.argv.slice(2);
  const pages = PAGES.filter((page) => filters.length === 0 || filters.some((word) => page.includes(word)));
  if (pages.length === 0) throw new Error(`No regression page matches ${filters.join(", ")}.`);
  let failed = 0;
  const contrastAllowlist = JSON.parse(readFileSync(path.join(root, "tests/regression/contrast-allowlist.json"), "utf8")).pages;
  await withRegressionBrowser(root, pages[0], async ({ session, base }) => {
    for (const page of pages) {
      const started = Date.now();
      const { outcome, state, errors } = await runPage(session, base + page);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${outcome === "passed" ? "✓" : "✗"} ${page}  ${outcome}, ${passedChecks(state.text ?? "")} checks, ${seconds}s`);
      if (outcome === "passed") {
        const findings = await auditLight(session, page, contrastAllowlist);
        if (findings.length > 0) {
          failed += 1;
          console.log(`✗ ${page}  light island: ${findings.length} text(s) under ${MIN_CONTRAST}:1`);
          for (const { key, ratio, text, color, background } of findings.slice(0, 8)) console.log(`    ${ratio} ${key} "${text}" ${color} on ${background}`);
        }
      } else {
        failed += 1;
        const lines = (state.text ?? "").split("\n").filter((line) => line.trim());
        for (const line of lines.filter((line) => !line.startsWith("PASS ")).slice(-5)) console.log(`    ${line}`);
        for (const error of errors.slice(0, 3)) console.log(`    ${error.split("\n")[0]}`);
      }
    }
  });
  console.log(failed === 0 ? `All ${pages.length} regression pages passed.` : `${failed} of ${pages.length} regression pages did not pass.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
