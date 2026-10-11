#!/usr/bin/env node
'use strict';
// Erzeugt alle Illustrationen: SVG (hell/dunkel), PNG (2x), Manifest, Hilfekarten, Kontaktbogen.
// Aufruf: node build.js [id ...] [--no-png] [--out <dir>]
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const { Scene } = require('./lib/iso');
const { LIGHT, DARK } = require('./lib/palette');
const { toPng8 } = require('./tools/png8');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const noPng = argv.includes('--no-png');
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(ROOT, 'shared', 'illustrations');
const scIdx = argv.indexOf('--scale');
const SCALE_OVERRIDE = scIdx >= 0 ? Number(argv[scIdx + 1]) : null;
const only = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--scale');

function loadScenes() {
  const dir = path.join(__dirname, 'scenes');
  let all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue;
    all = all.concat(require(path.join(dir, f)));
  }
  return all;
}

function fileset(def) {
  const base = def.kind === 'notification' ? 'notifications/' : '';
  return {
    lightSvg: `${base}light/${def.id}.svg`, darkSvg: `${base}dark/${def.id}.svg`,
    lightPng: `${base}png/light/${def.id}.png`, darkPng: `${base}png/dark/${def.id}.png`,
  };
}

function buildSvg(def, pal) {
  const st = def.setup || {};
  const W = def.width, H = def.height;
  const mk = (scale, ox, oy) => new Scene({ w: W, h: H, pal, scale, ox, oy, seed: st.seed || 7, bg: st.bg && st.bg(pal) });
  let s;
  if (st.fit === false) {
    s = mk(st.scale || 10, st.ox != null ? st.ox : W / 2, st.oy != null ? st.oy : H / 2);
    def.build(s, pal);
  } else {
    // Automatische Einpassung: erst mit Probemassstab bauen, Ausdehnung messen, dann skaliert neu bauen.
    const probe = mk(10, 0, 0);
    def.build(probe, pal);
    const e = probe.extent();
    const pad = st.pad || [70, 60, 70, 70]; // links, oben, rechts, unten
    const aw = W - pad[0] - pad[2], ah = H - pad[1] - pad[3];
    let f = Math.min(aw / (e.x1 - e.x0), ah / (e.y1 - e.y0));
    if (st.maxScale) f = Math.min(f, st.maxScale / 10);
    const cx = pad[0] + aw / 2 + (st.dx || 0), cy = pad[1] + ah / 2 + (st.dy || 0);
    const ox = cx - f * (e.x0 + e.x1) / 2, oy = cy - f * (e.y0 + e.y1) / 2;
    s = mk(10 * f, ox, oy);
    def.build(s, pal);
  }
  return s.svg();
}

function compileRenderer() {
  const src = path.join(__dirname, 'tools', 'render.swift');
  const bin = path.join(os.tmpdir(), 'travelbuddy-illustration-render');
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
    cp.execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: 'inherit' });
  }
  return bin;
}

function main() {
  let defs = loadScenes();
  const everything = defs;
  if (only.length) defs = defs.filter(d => only.includes(d.id));
  const jobs = [];
  const t0 = Date.now();
  for (const def of defs) {
    const fs_ = fileset(def);
    for (const [pal, svgKey, pngKey] of [[LIGHT, 'lightSvg', 'lightPng'], [DARK, 'darkSvg', 'darkPng']]) {
      const svg = buildSvg(def, pal);
      const svgPath = path.join(OUT, fs_[svgKey]);
      fs.mkdirSync(path.dirname(svgPath), { recursive: true });
      fs.writeFileSync(svgPath, svg);
      const scale = SCALE_OVERRIDE || (def.kind === 'notification' ? 1 : 2);
      const pngPath = path.join(OUT, fs_[pngKey]);
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });
      jobs.push([svgPath, pngPath, def.width * scale, def.height * scale]);
      if (svg.length > 150000) console.warn(`WARNUNG: ${fs_[svgKey]} ${(svg.length / 1024).toFixed(0)} KB`);
    }
  }
  if (!noPng && jobs.length) {
    const bin = compileRenderer();
    const jf = path.join(os.tmpdir(), 'travelbuddy-illustration-jobs.tsv');
    fs.writeFileSync(jf, jobs.map(j => j.join('\t')).join('\n'));
    // Rohpixel liegen neben dem Ziel als .raw; hier zu indizierten PNG wandeln
    const jobsRaw = jobs.map(j => [j[0], j[1] + '.raw', j[2], j[3]]);
    fs.writeFileSync(jf, jobsRaw.map(j => j.join('\t')).join('\n'));
    cp.execFileSync(bin, [jf], { stdio: 'inherit' });
    for (const j of jobs) {
      const rawPath = j[1] + '.raw';
      fs.writeFileSync(j[1], toPng8(fs.readFileSync(rawPath), j[2], j[3], 256));
      fs.unlinkSync(rawPath);
    }
    // Server liefert Mitteilungsbilder flach aus: <imageKey>.png und <imageKey>-dark.png
    for (const def of defs.filter(d => d.kind === 'notification')) {
      const f = fileset(def);
      const flat = path.join(OUT, 'notifications', 'png');
      if (fs.existsSync(path.join(OUT, f.lightPng))) fs.copyFileSync(path.join(OUT, f.lightPng), path.join(flat, `${def.id}.png`));
      if (fs.existsSync(path.join(OUT, f.darkPng))) fs.copyFileSync(path.join(OUT, f.darkPng), path.join(flat, `${def.id}-dark.png`));
    }
  }
  console.log(`${defs.length} Szenen, ${jobs.length} SVG${noPng ? '' : ' + PNG'} in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${OUT}`);
  if (!only.length) {
    try { require('./tools/manifest').write(everything, OUT, fileset); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
}
main();
