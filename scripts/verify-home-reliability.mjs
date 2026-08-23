import { mkdir, writeFile } from "node:fs/promises";

const cdpPort = 9222;
const previewUrl = "http://127.0.0.1:5365/";
const outputDir = "/home/ubuntu/nya-nya-nya-preview-restored/evidence-home-v49.11.1";
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
const inspectHome = async () => evaluate(`(() => {
  const labels = [
    ["Trending", ".trending-section"],
    ["Latest Comments", ".community-highlights"],
    ["Most Popular", ".hot-this-week"],
    ["Recent Reviews", ".recent-reviews-section"],
    ["Latest Updates", ".latest-updates-block"],
    ["Editor's Pick", ".editors-pick-section"],
    ["Pinned Series", ".v481-pinned-section"],
    ["New Series", ".public-new-series"],
    ["Top Teams", ".public-teams"],
  ];
  const result = {};
  for (const [label, selector] of labels) {
    const node = document.querySelector(selector);
    result[label] = node ? {
      present: true,
      loading: Boolean(node.querySelector('[aria-busy="true"], [role="status"]')),
      retry: [...node.querySelectorAll('button')].some((button) => button.innerText.includes('Try again')),
      text: (node.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 220),
    } : { present: false };
  }
  return { viewport: { width: innerWidth, height: innerHeight }, sections: result };
})()`);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
const results = { previewUrl };

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${previewUrl}?home-reliability=${label}` });
  await sleep(8_000);
  results[label] = { home: await inspectHome(), topScreenshot: await screenshot(`${label}-home-top`) };
  if (label === "mobile") {
    await evaluate(`document.querySelector('.v481-pinned-section')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    results.mobile.pinnedScreenshot = await screenshot("mobile-home-pinned-reviews");
    await evaluate(`document.querySelector('.hot-this-week')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    results.mobile.popularScreenshot = await screenshot("mobile-home-popular");
  }
  if (label === "desktop") {
    await evaluate(`document.querySelector('.editors-pick-section')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    results.desktop.contentScreenshot = await screenshot("desktop-home-content");
  }
}

await send("Emulation.setDeviceMetricsOverride", { width: 892, height: 768, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${previewUrl}?home-reliability=menu` });
await sleep(12_000);
await evaluate(`document.querySelector('[aria-label="Open site menu"]')?.click()`);
await sleep(300);
const menu = await evaluate(`(() => {
  const node = document.querySelector('[role="menu"]');
  return node ? { text: (node.innerText || "").replace(/\\s+/g, " ").trim(), links: [...node.querySelectorAll('a')].map((link) => ({ text: link.innerText.trim(), href: link.getAttribute('href') })) } : null;
})()`);
results.loggedOutMenu = { menu, screenshot: await screenshot("desktop-logged-out-menu") };
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
const slowFetchSource = `(() => {
  const originalFetch = window.fetch.bind(window);
  const affected = ["/api/v1/catalog", "/api/v1/community-highlights", "/api/v1/hot-this-week", "/api/v1/recent-reviews", "/api/v1/latest-releases", "/api/v1/editor-picks", "/api/v1/pinned-series", "/api/v1/new-series", "/api/v1/public-teams"];
  window.fetch = (input, init = {}) => {
    const url = String(input);
    if (!affected.some((path) => url.includes(path))) return originalFetch(input, init);
    return new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };
})()`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: slowFetchSource });
await send("Page.navigate", { url: `${previewUrl}?home-reliability=slow` });
await sleep(14_000);
results.slowFailure = {
  home: await inspectHome(),
  screenshot: await screenshot("mobile-home-slow-failure-terminal-states"),
};
const emptyDataSource = `(() => {
  const originalFetch = window.fetch.bind(window);
  const affected = ["/api/v1/catalog", "/api/v1/community-highlights", "/api/v1/hot-this-week", "/api/v1/recent-reviews", "/api/v1/latest-releases", "/api/v1/editor-picks", "/api/v1/pinned-series", "/api/v1/new-series", "/api/v1/public-teams"];
  window.fetch = (input, init = {}) => {
    const url = String(input);
    if (!affected.some((path) => url.includes(path))) return originalFetch(input, init);
    let payload = { data: [] };
    if (url.includes("latest-releases")) payload = { data: [], pagination: { pageCount: 1, hasPrevious: false, hasNext: false }, availableLanguages: [] };
    if (url.includes("hot-this-week")) payload = { data: [], period: "weekly", windowDays: 7 };
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
  };
})()`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: emptyDataSource });
await send("Page.navigate", { url: `${previewUrl}?home-reliability=empty` });
await sleep(8_000);
results.emptyData = { home: await inspectHome(), screenshot: await screenshot("mobile-home-empty-data-terminal-states") };
await writeFile(`${outputDir}/verification.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
ws.close();
