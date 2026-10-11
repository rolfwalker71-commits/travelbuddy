// Layout-Prüfung im echten Browser (DevTools-Protokoll): kein horizontaler Überlauf der Seite, nichts ragt aus dem
// Fenster, Textspalten werden nicht schmaler als 160 px. Mit den Fixture-Mocks, hell und dunkel, mehrere Breiten.
//   npm run dev &                      (Port 5174)
//   node scripts/layout-check.mjs [baseUrl] [--shots dir]
// Beendet mit Exit-Code 1, wenn etwas auffällt. Braucht einen Chromium-Browser (CHROME_BIN, Standard Microsoft Edge).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:5174";
const shotsAt = args.indexOf("--shots");
const shotsDir = shotsAt >= 0 ? resolve(args[shotsAt + 1]) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const chrome = process.env.CHROME_BIN ?? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const port = 9500 + Math.floor(Math.random() * 100);

const WIDTHS = (process.env.WIDTHS ?? "360,390,525,768,1024,1440").split(",").map(Number);
const THEMES = ["light", "dark"];
const PAGES = [
  ["heute", "/"],
  ["tag", "/trips/1/day/" + new Date().toISOString().slice(0, 10)],
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "tb-layout-"));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
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

/** Läuft im Seitenkontext: liefert Auffälligkeiten als Liste von Texten. */
const CHECK = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const de = document.scrollingElement;
  if (de.scrollWidth > vw + 1) out.push("Seite scrollt horizontal: scrollWidth " + de.scrollWidth + " > " + vw);
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  const seen = new Set();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("dialog:not([open])")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.classList.contains("sr-only") || el.closest(".sr-only") || el.closest(".skip-link")) continue;
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
      const k = name(el);
      if (!seen.has(k)) { seen.add(k); out.push("ragt aus dem Fenster: " + k + " (links " + Math.round(r.left) + ", rechts " + Math.round(r.right) + ", Fenster " + vw + ")"); }
    }
    // Text in schmalen Spalten
    if (["P", "SPAN", "DD", "LI", "H1", "H2", "H3"].includes(el.tagName) && el.children.length === 0 && el.textContent.trim().length > 14 && r.width > 0 && r.width < 90 && cs.whiteSpace !== "nowrap") {
      const k = "schmal:" + name(el);
      if (!seen.has(k)) { seen.add(k); out.push("Textspalte nur " + Math.round(r.width) + " px breit: " + name(el) + " «" + el.textContent.trim().slice(0, 30) + "»"); }
    }
    // Inhalt läuft über den eigenen Rahmen hinaus (sichtbarer Überlauf, z. B. nowrap-Text)
    if (cs.overflowX === "visible" && el.clientWidth > 40 && el.scrollWidth > el.clientWidth + 1 && !(el instanceof SVGElement) && !clipped(el)) {
      const k = "ueberlauf:" + name(el);
      if (!seen.has(k)) { seen.add(k); out.push("Inhalt läuft über: " + name(el) + " (" + el.scrollWidth + " > " + el.clientWidth + ")"); }
    }
    // Hilfekarten: Textspalte nie schmaler als 200 px
    if (el.matches(".help__text") && r.width < 200) {
      out.push("Hilfekarte: Textspalte nur " + Math.round(r.width) + " px breit");
    }
    // abgeschnittener Text (Auslassungspunkte nur dort, wo gewollt: .truncate, Titelzeilen)
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== "visible" && cs.textOverflow === "ellipsis" && !el.classList.contains("truncate") && !el.closest(".truncate")) {
      const k = "gekuerzt:" + name(el);
      if (!seen.has(k)) { seen.add(k); out.push("Text abgeschnitten: " + name(el) + " «" + el.textContent.trim().slice(0, 40) + "»"); }
    }
  }
  // SVG-Beschriftungen ausserhalb der viewBox
  for (const svg of document.querySelectorAll("svg.viz__svg")) {
    const vb = svg.viewBox.baseVal; if (!vb || !vb.width) continue;
    for (const t of svg.querySelectorAll("text")) {
      let b; try { b = t.getBBox(); } catch { continue; }
      if (b.x < -1 || b.x + b.width > vb.x + vb.width + 1) {
        out.push("SVG-Text ausserhalb der Zeichenfläche: «" + t.textContent.trim().slice(0, 30) + "» (" + Math.round(b.x) + ".." + Math.round(b.x + b.width) + " von " + Math.round(vb.width) + ")");
        break;
      }
    }
  }
  return out;
})()`;

let problems = 0;
let n = 0;
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    await s("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [name, path] of PAGES) {
      await s("Page.navigate", { url: `${base}${path}?mock=1&autologin=1&theme=${theme}` });
      await sleep(700);
      for (let i = 0; i < 40; i++) {
        const r = await s("Runtime.evaluate", {
          expression: "!document.querySelector('.skeleton, .spinner-row, .spinner, .map-card__status') && !!document.querySelector('.page, .guest__main, .login')",
          returnByValue: true,
        });
        if (r.result.value) break;
        await sleep(250);
      }
      // Hilfekarten und Einklappbares öffnen, damit sie mitgeprüft werden
      await s("Runtime.evaluate", { expression: "document.querySelectorAll('.help__head[aria-expanded=false]').forEach((b) => b.click())" });
      await sleep(350);
      const res = await s("Runtime.evaluate", { expression: CHECK, returnByValue: true });
      const issues = res.result.value ?? [];
      n++;
      if (issues.length > 0) {
        problems += issues.length;
        console.log(`✗ ${theme} ${w}px ${name}`);
        for (const i of issues) console.log(`    ${i}`);
      }
      if (shotsDir) {
        const lm = await s("Page.getLayoutMetrics");
        const height = Math.min(Math.ceil(lm.cssContentSize.height), 2600);
        const shot = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.max(height, 400), scale: 1 } });
        writeFileSync(join(shotsDir, `${name}-${theme}-${w}.png`), Buffer.from(shot.data, "base64"));
      }
    }
  }
}
console.log(problems === 0 ? `Layout in Ordnung (${n} Ansichten).` : `${problems} Auffälligkeit(en) in ${n} Ansichten.`);
ws.close();
proc.kill();
process.exit(problems === 0 ? 0 : 1);
