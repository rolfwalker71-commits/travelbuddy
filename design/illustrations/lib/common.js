'use strict';
// Gemeinsame Szenenbausteine: Rahmenmarken, Inselplatte, Nummernmarken (Hilfskarten).
const { n } = require('./util');

/** Passermarken in den Ecken (technische Zeichnung). */
function cropMarks(s, inset = 26, len = 16) {
  const { w, h, pal } = s;
  const c = pal.line;
  const L = (x, y, dx, dy) => s.line([[x + dx * len, y], [x, y], [x, y + dy * len]], { stroke: c, sw: 1.2, cap: 'round' });
  s.raw(L(inset, inset, 1, 1) + L(w - inset, inset, -1, 1) + L(inset, h - inset, 1, -1) + L(w - inset, h - inset, -1, -1), 'bg');
}

/** Inselplatte mit Raster und Massmarken. */
function island(s, x0, y0, x1, y1, o = {}) {
  const th = o.th || 1.2;
  s.add(s.plate(x0, y0, x1, y1, th, o.mat || s.m.ground, { grid: o.grid || 4, gridOp: 0.85 }), 'ground');
  if (o.dims !== false) {
    s.raw(s.dim([x1, y0], [x1, y1], 2.2) + s.dim([x0, y1], [x1, y1], 2.2), 'ground');
  }
}

/** Nummernmarke (Kreis mit Ziffer, Bildschirmraum) mit Stiel zum Objekt. */
function badge(s, x, y, num, o = {}) {
  const r = o.r || 17;
  const pal = s.pal;
  let svg = '';
  if (o.stem) svg += s.line([[x, y + r - 1], [x, y + r + o.stem]], { stroke: pal.accent, sw: 1.6, cap: 'round' }) + s.circle(x, y + r + o.stem + 1, 2.2, { fill: pal.accent });
  svg += s.circle(x, y + 2.5, r, { fill: pal.ink, op: 0.12 }); // Schatten
  svg += s.circle(x, y, r, { fill: pal.accent, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 1.4 });
  svg += s.circle(x, y, r - 3.5, { fill: 'none', stroke: pal.onAccent, sw: 0.9, sop: 0.55 });
  const f = s.flat(x, y + r * 0.5);
  svg += s.fText(f, String(num), 0, 0, r * 1.0, { align: 'center', stroke: pal.onAccent, sw: 2.4 });
  s.raw(svg, 'top');
}

/** Gleise (Schotter, Schwellen, Schienen) entlang x bei y..y+3.2. */
function track(s, x0, x1, y) {
  const m = s.m, pal = s.pal;
  const parts = [];
  parts.push(s.strip([[x0, y + 1.6], [x1, y + 1.6]], 4.6, 0.02, pal.name === 'light' ? m.stone.top : m.stone.left, { round: false }));
  let d = '';
  for (let x = x0 + 0.5; x < x1; x += 1.1) { const a = s.P(x, y - 0.2, 0.05), b = s.P(x, y + 3.4, 0.05); d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }
  parts.push({ svg: s.path(d, { stroke: pal.name === 'light' ? m.wood.right : m.wood.right, sw: 1.8, fill: 'none' }), bbox: [x0, y, 0, x1, y + 3, 0], sh: 0 });
  parts.push(s.groundLine([[x0, y + 0.4], [x1, y + 0.4]], 0.08, { stroke: pal.name === 'light' ? pal.ink : pal.mute, sw: 1.4 }));
  parts.push(s.groundLine([[x0, y + 2.8], [x1, y + 2.8]], 0.08, { stroke: pal.name === 'light' ? pal.ink : pal.mute, sw: 1.4 }));
  return parts;
}

/** Wellenstriche auf Wasser. */
function waves(s, x0, y0, x1, y1, z = 0) {
  const r = s.rand;
  let d = '';
  const c = s.pal.name === 'light' ? s.pal.surface : s.pal.mute;
  const n = Math.round(((x1 - x0) * (y1 - y0)) / 22);
  for (let i = 0; i < n; i++) {
    const x = x0 + 2 + r() * (x1 - x0 - 4), y = y0 + 2 + r() * (y1 - y0 - 4), l = 1.5 + r() * 2.5;
    const a = s.P(x, y, z + 0.03), b = s.P(x + l, y, z + 0.03);
    d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return { svg: s.path(d, { stroke: c, sw: 1.3, cap: 'round', sop: s.pal.name === 'light' ? 0.85 : 0.35 }), bbox: [x0, y0, z, x1, y1, z], sh: 0 };
}

/** Himmel mit Verlauf, Sonne bzw. Mond und Wolken (Bildschirmraum, bg-Ebene). */
function sky(s, o = {}) {
  const pal = s.pal, L = pal.name === 'light';
  const top = L ? pal.surface : pal.surface2, bot = L ? pal.bg : pal.bg;
  const g = s.lin([[0, top], [1, bot]], [0, 0], [0, s.h]);
  let svg = `<rect width="${s.w}" height="${s.h}" fill="${g}" stroke="none"/>`;
  const sx = o.sunX != null ? o.sunX : s.w * 0.8, sy = o.sunY != null ? o.sunY : s.h * 0.2, sr = o.sunR || s.h * 0.1;
  if (L) {
    svg += s.circle(sx, sy, sr * 1.5, { fill: pal.accent, op: 0.1, stroke: null });
    svg += s.circle(sx, sy, sr * 1.2, { fill: pal.accent, op: 0.16, stroke: null });
    svg += s.circle(sx, sy, sr, { fill: pal.accent, stroke: null });
  } else {
    svg += s.circle(sx, sy, sr * 1.4, { fill: pal.ink, op: 0.06, stroke: null });
    svg += s.circle(sx, sy, sr, { fill: pal.ink, op: 0.9, stroke: null });
    svg += s.circle(sx + sr * 0.35, sy - sr * 0.15, sr * 0.88, { fill: pal.surface2, stroke: null });
  }
  const cloud = (x, y, w) => {
    const c = L ? pal.surface : pal.surface2;
    const ln = L ? pal.line : pal.line;
    const h = w * 0.16;
    return s.path(`M${x - w / 2} ${y}a${h} ${h} 0 0 1 ${h * 1.1} ${-h * 0.9}a${h * 1.3} ${h * 1.3} 0 0 1 ${h * 2.2} ${-h * 0.5}a${h * 1.0} ${h * 1.0} 0 0 1 ${h * 1.9} ${h * 0.6}a${h * 0.8} ${h * 0.8} 0 0 1 ${h * 0.8} ${h * 0.8}z`, { fill: c, stroke: ln, sw: 1.2 });
  };
  for (const c of (o.clouds || [[s.w * 0.18, s.h * 0.2, 150], [s.w * 0.62, s.h * 0.12, 120]])) svg += cloud(c[0], c[1], c[2]);
  s.raw(svg, 'bg');
}

module.exports = { cropMarks, island, badge, track, waves, sky };
