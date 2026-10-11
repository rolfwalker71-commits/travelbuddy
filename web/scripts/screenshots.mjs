// Screenshots der Web-Oberfläche (Hell/Dunkel, Desktop/Handy) mit den Fixture-Mocks, über das DevTools-Protokoll.
//   npm run dev &            (Port 5174)
//   node scripts/screenshots.mjs [outDir] [baseUrl]
// Braucht einen Chromium-Browser (Standard: Microsoft Edge; CHROME_BIN übersteuert). Ausgabe: docs/screenshots/web/
// (git-ignoriert). Es werden nur Beispieldaten der Mocks gezeigt.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "../docs/screenshots/web");
const base = process.argv[3] ?? "http://127.0.0.1:5174";
const chrome = process.env.CHROME_BIN ?? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const port = 9400 + Math.floor(Math.random() * 100);
mkdirSync(out, { recursive: true });

const PAGES = [
  ["heute", "/"],
  ["reisen", "/trips"],
  ["plan", "/trips/1"],
  ["ereignis-flug", "/trips/1/events/101"],
  ["ereignis-hotel", "/trips/1/events/102"],
  ["dokumente", "/trips/1/documents"],
  ["kasse", "/trips/1/ledger"],
  ["team", "/trips/1/team"],
  ["karte", "/trips/1/map"],
  ["konto", "/settings"],
  ["gast-reise", "/t/tok_valentyna_demo"],
  ["gast-kasse", "/g/tok_valentyna_demo"],
];
const DEVICES = [
  ["desktop", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "tb-shots-"));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Browser startet nicht");
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);
await s("Page.enable");

let n = 0;
for (const theme of ["light", "dark"]) {
  for (const [dev, metrics] of DEVICES) {
    await s("Emulation.setDeviceMetricsOverride", metrics);
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [name, path] of PAGES) {
      await s("Page.navigate", { url: `${base}${path}?mock=1&autologin=1&theme=${theme}` });
      await sleep(900);
      // warten, bis nichts mehr lädt
      for (let i = 0; i < 40; i++) {
        const r = await s("Runtime.evaluate", {
          expression: "!document.querySelector('.skeleton, .spinner-row, .spinner, .map-card__status') && !!document.querySelector('.page, .guest__main, .login')",
          returnByValue: true,
        });
        if (r.result.value) break;
        await sleep(250);
      }
      await sleep(400);
      const lm = await s("Page.getLayoutMetrics");
      const height = Math.min(Math.ceil(lm.cssContentSize.height), 3200);
      const shot = await s("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: metrics.width, height: Math.max(height, metrics.height), scale: 1 },
      });
      writeFileSync(join(out, `${name}-${theme}-${dev}.png`), Buffer.from(shot.data, "base64"));
      n++;
    }
  }
}
console.log(`${n} Screenshots in ${out}`);
ws.close();
proc.kill();
process.exit(0);
