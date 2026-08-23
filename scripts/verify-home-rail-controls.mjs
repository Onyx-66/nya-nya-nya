import { mkdir, writeFile } from "node:fs/promises";

const cdpPort = 9222;
const previewUrl = "http://127.0.0.1:5369/";
const outputDir = "/home/ubuntu/nya-nya-nya-preview-v49.11.2-evidence";
await mkdir(outputDir, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl) ?? targets[0];
if (!target?.webSocketDebuggerUrl) throw new Error("No browser CDP page target available");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const deferred = pending.get(message.id);
  if (!deferred) return;
  pending.delete(message.id);
  message.error ? deferred.reject(new Error(message.error.message)) : deferred.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
const screenshot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const path = `${outputDir}/${name}.png`;
  await writeFile(path, Buffer.from(shot.data, "base64"));
  return path;
};
const sectionSelectors = {
  Trending: ".trending-section",
  "Recent Reviews": ".recent-reviews-section",
  "New Series": ".public-new-series",
};
const inspectSection = (name) => evaluate(`(() => {
  const section = document.querySelector(${JSON.stringify(sectionSelectors[name])});
  const row = section?.querySelector(${JSON.stringify(name === "Trending" ? ".trending-viewport > .home-scroll-row" : ":scope > .home-scroll-row")});
  const rail = row?.querySelector(${JSON.stringify(name === "Trending" ? ":scope > .series-rail" : ":scope > .series-rail, :scope > .recent-reviews-rail, :scope > .new-series-grid")});
  const buttons = [...(row?.querySelectorAll(":scope > .home-rail-controls button") || [])];
  if (!section || !row || !rail) return { present: false };
  const style = getComputedStyle(row.querySelector(":scope > .home-rail-controls"));
  return {
    present: true,
    controlsDisplay: style.display,
    scrollLeft: Math.round(rail.scrollLeft),
    scrollWidth: Math.round(rail.scrollWidth),
    clientWidth: Math.round(rail.clientWidth),
    overflow: rail.scrollWidth > rail.clientWidth + 2,
    buttons: buttons.map((button) => ({ label: button.getAttribute("aria-label"), disabled: button.disabled })),
  };
})()`);
const sectionScroll = (name, mode) => evaluate(`(async () => {
  const section = document.querySelector(${JSON.stringify(sectionSelectors[name])});
  const row = section?.querySelector(${JSON.stringify(name === "Trending" ? ".trending-viewport > .home-scroll-row" : ":scope > .home-scroll-row")});
  const rail = row?.querySelector(${JSON.stringify(name === "Trending" ? ":scope > .series-rail" : ":scope > .series-rail, :scope > .recent-reviews-rail, :scope > .new-series-grid")});
  const button = row?.querySelector(${JSON.stringify(mode === "next" ? ".is-next" : ".is-previous")});
  if (!rail || !button || button.disabled) return { clicked: false, reason: button ? "disabled" : "missing" };
  const before = Math.round(rail.scrollLeft);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 850));
  return { clicked: true, before, after: Math.round(rail.scrollLeft) };
})()`);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${previewUrl}?rail-controls=desktop` });
await sleep(20_000);
const results = { previewUrl, desktop: {}, mobile: {} };
for (const name of Object.keys(sectionSelectors)) {
  await evaluate(`window.scrollTo({ top: document.querySelector(${JSON.stringify(sectionSelectors[name])})?.getBoundingClientRect().top + scrollY - 160, behavior: "auto" })`);
  await sleep(300);
  results.desktop[name] = { start: await inspectSection(name), startScreenshot: await screenshot(`${name.toLowerCase().replaceAll(" ", "-")}-desktop-start`) };
  results.desktop[name].nextScroll = await sectionScroll(name, "next");
  results.desktop[name].afterNext = await inspectSection(name);
  results.desktop[name].nextScreenshot = await screenshot(`${name.toLowerCase().replaceAll(" ", "-")}-desktop-after-next`);
  await evaluate(`(() => { const section = document.querySelector(${JSON.stringify(sectionSelectors[name])}); const rail = section?.querySelector(${JSON.stringify(name === "Trending" ? ".trending-viewport > .home-scroll-row > .series-rail" : ":scope > .home-scroll-row > .series-rail, :scope > .home-scroll-row > .recent-reviews-rail, :scope > .home-scroll-row > .new-series-grid")}); if (rail) { rail.style.scrollBehavior = "auto"; rail.scrollLeft = rail.scrollWidth; } })()`);
  await sleep(900);
  results.desktop[name].end = await inspectSection(name);
  await evaluate(`(() => { const section = document.querySelector(${JSON.stringify(sectionSelectors[name])}); const rail = section?.querySelector(${JSON.stringify(name === "Trending" ? ".trending-viewport > .home-scroll-row > .series-rail" : ":scope > .home-scroll-row > .series-rail, :scope > .home-scroll-row > .recent-reviews-rail, :scope > .home-scroll-row > .new-series-grid")}); if (rail) { rail.style.scrollBehavior = "auto"; rail.scrollLeft = 0; } })()`);
  await sleep(900);
  results.desktop[name].reset = await inspectSection(name);
  results.desktop[name].previousScroll = await sectionScroll(name, "previous");
  results.desktop[name].afterPrevious = await inspectSection(name);
}
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${previewUrl}?rail-controls=mobile` });
await sleep(20_000);
for (const name of Object.keys(sectionSelectors)) results.mobile[name] = await inspectSection(name);
results.mobile.screenshot = await screenshot("home-mobile-rails-unchanged");
await writeFile(`${outputDir}/verification.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
ws.close();
