'use strict';
// Schreibt manifest.json, help-cards.json und index.html (Kontaktbogen) nach shared/illustrations.
const fs = require('fs');
const path = require('path');
const helpcards = require('./helpcards');

const KIND_TITLES = { type: 'Ereignistypen', empty: 'Leere Zustände', help: 'Hilfekarten', cover: 'Reise-Cover', notification: 'Mitteilungsbilder' };
const KIND_ORDER = ['type', 'empty', 'help', 'cover', 'notification'];

function usageOf(def) {
  if (def.kind === 'type') return def.usage.split(':')[1];
  return def.usage;
}

function write(defs, out, fileset) {
  const entries = [];
  for (const kind of KIND_ORDER) {
    for (const d of defs.filter(x => x.kind === kind)) {
      const files = fileset(d);
      const bytes = {};
      for (const k of ['lightSvg', 'darkSvg']) { try { bytes[k] = fs.statSync(path.join(out, files[k])).size; } catch (e) { bytes[k] = null; } }
      const e = { id: d.id, kind: d.kind, title: d.title, alt: d.alt, files, width: d.width, height: d.height, pngScale: d.kind === 'notification' ? 1 : 2, usage: usageOf(d), bytes };
      if (d.kind === 'notification') { e.imageKey = d.id; e.serverFiles = { png: `notifications/png/${d.id}.png`, pngDark: `notifications/png/${d.id}-dark.png` }; }
      entries.push(e);
    }
  }
  const manifest = {
    version: 1,
    doc: 'Illustrationen für TravelBuddy (isometrisch, hell «Papier» und dunkel «Nachtpapier»). Dateipfade relativ zu diesem Verzeichnis. Quelle: design/illustrations (node build.js).',
    kinds: KIND_TITLES,
    items: entries,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const cards = helpcards.map(c => ({ id: c.id, title: c.title, summary: c.summary, steps: c.steps, illustration: c.id }));
  fs.writeFileSync(path.join(out, 'help-cards.json'), JSON.stringify({ version: 1, cards }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'index.html'), indexHtml(manifest));
  console.log(`manifest.json (${entries.length} Einträge), help-cards.json (${cards.length}), index.html`);
}

function indexHtml(manifest) {
  const data = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TravelBuddy · Illustrationen</title>
<style>
:root{--bg:#ECE5D7;--surface:#FBF8F1;--surface2:#F1EBDD;--line:#D4C9B4;--ink:#1D1B18;--mute:#6F675A;--accent:#D8452B;--onAccent:#FFFFFF}
:root[data-theme="dark"]{--bg:#151412;--surface:#1F1D1A;--surface2:#2A2723;--line:#3A362F;--ink:#F1EBDD;--mute:#A59C8B;--accent:#F0653F;--onAccent:#1A0E0A}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.45 "Barlow","Helvetica Neue",Helvetica,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;padding:12px 20px}
h1{font:600 20px/1.2 "Barlow Semi Condensed","Helvetica Neue",Arial,sans-serif;letter-spacing:.02em;margin:0 12px 0 0}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.seg button{appearance:none;border:0;background:transparent;color:var(--ink);font:inherit;padding:6px 12px;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--onAccent)}
.hint{color:var(--mute);font-size:13px}
main{padding:20px;max-width:1500px;margin:0 auto}
section{margin:0 0 36px}
h2{font:600 13px/1.2 "Barlow Semi Condensed","Helvetica Neue",Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin:0 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
figure img{display:block;width:100%;height:auto;background:var(--surface)}
figcaption{padding:8px 12px 10px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}
figcaption b{font-weight:600}
figcaption code{font:500 12px/1.3 "IBM Plex Mono",ui-monospace,Menlo,monospace;color:var(--mute)}
figcaption .alt{flex-basis:100%;color:var(--mute);font-size:13px}
</style>
</head>
<body>
<header>
  <h1>TravelBuddy · Illustrationen</h1>
  <span class="seg" role="group" aria-label="Darstellung"><button id="bLight" aria-pressed="true">Hell</button><button id="bDark" aria-pressed="false">Dunkel</button></span>
  <span class="seg" role="group" aria-label="Format"><button id="bSvg" aria-pressed="true">SVG</button><button id="bPng" aria-pressed="false">PNG</button></span>
  <span class="hint" id="count"></span>
</header>
<main id="main"></main>
<script>
const M = ${data};
const S = { theme: 'light', fmt: 'svg' };
try { if (matchMedia('(prefers-color-scheme: dark)').matches) S.theme = 'dark'; } catch (e) {}
const main = document.getElementById('main');
const kb = n => (n / 1024).toFixed(0).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '’') + ' KB';
function src(it) { const f = it.files; return S.theme === 'dark' ? (S.fmt === 'png' ? f.darkPng : f.darkSvg) : (S.fmt === 'png' ? f.lightPng : f.lightSvg); }
function render() {
  document.documentElement.dataset.theme = S.theme;
  document.getElementById('bLight').setAttribute('aria-pressed', S.theme === 'light');
  document.getElementById('bDark').setAttribute('aria-pressed', S.theme === 'dark');
  document.getElementById('bSvg').setAttribute('aria-pressed', S.fmt === 'svg');
  document.getElementById('bPng').setAttribute('aria-pressed', S.fmt === 'png');
  main.innerHTML = '';
  let n = 0;
  for (const kind of Object.keys(M.kinds)) {
    const items = M.items.filter(i => i.kind === kind);
    if (!items.length) continue;
    const sec = document.createElement('section');
    sec.innerHTML = '<h2>' + M.kinds[kind] + ' (' + items.length + ')</h2>';
    const g = document.createElement('div'); g.className = 'grid';
    for (const it of items) {
      n++;
      const f = document.createElement('figure');
      const size = S.theme === 'dark' ? it.bytes.darkSvg : it.bytes.lightSvg;
      f.innerHTML = '<img loading="lazy" src="' + src(it) + '" width="' + it.width + '" height="' + it.height + '" alt="' + it.alt.replace(/"/g, '&quot;') + '">' +
        '<figcaption><b>' + it.title + '</b><code>' + it.id + '</code><code>' + it.width + ' × ' + it.height + '</code><code>' + (size ? kb(size) : '') + '</code><span class="alt">' + it.alt + '</span></figcaption>';
      g.appendChild(f);
    }
    sec.appendChild(g);
    main.appendChild(sec);
  }
  document.getElementById('count').textContent = n + ' Illustrationen';
}
document.getElementById('bLight').onclick = () => { S.theme = 'light'; render(); };
document.getElementById('bDark').onclick = () => { S.theme = 'dark'; render(); };
document.getElementById('bSvg').onclick = () => { S.fmt = 'svg'; render(); };
document.getElementById('bPng').onclick = () => { S.fmt = 'png'; render(); };
render();
</script>
</body>
</html>
`;
}

module.exports = { write };
