'use strict';
// Umgebungsobjekte für dichtere Szenen: Strassenmarkierungen, Schilder, Regale, Zäune, Geräte.
const { mix } = require('./util');
const P = require('./props');
const T = require('./things');

const lineOf = s => (s.pal.name === 'light' ? s.pal.ink : s.pal.bg);

/** Zebrastreifen: n Streifen entlang x (quer zur Fahrbahn) im Bereich y0..y1. */
function zebra(s, x, y0, y1, n = 6, w = 0.8, gap = 0.6) {
  const pal = s.pal, parts = [];
  for (let i = 0; i < n; i++) parts.push(s.flatPoly([[x + i * (w + gap), y0], [x + i * (w + gap) + w, y0], [x + i * (w + gap) + w, y1], [x + i * (w + gap), y1]], 0.03, pal.name === 'light' ? pal.surface : mix(pal.ink, pal.mute, 0.2), { stroke: null }));
  return parts;
}
function roadArrow(s, x, y, len = 3, dir = 1) {
  const pal = s.pal, c = pal.name === 'light' ? pal.surface : mix(pal.ink, pal.mute, 0.2);
  const d = dir;
  return s.flatPoly([[x, y - 0.3], [x + d * len * 0.55, y - 0.3], [x + d * len * 0.55, y - 0.8], [x + d * len, y], [x + d * len * 0.55, y + 0.8], [x + d * len * 0.55, y + 0.3], [x, y + 0.3]], 0.03, c, { stroke: null });
}
/** Bodentext (Strichschrift) auf Boden, Leserichtung +x. */
function groundText(s, x, y, text, h = 1.2, col) {
  const pal = s.pal, f = s.frame([x, y, 0.03], [1, 0, 0], [0, -1, 0], 1, 1);
  return { svg: s.fText(f, text, 0, 0, h, { stroke: col || (pal.name === 'light' ? pal.surface : mix(pal.ink, pal.mute, 0.2)), sw: 1.4 }), bbox: [x, y - h, 0.03, x + text.length * 1.2 * h, y, 0.05], sh: 0 };
}
/** Schilderpfosten mit runder oder eckiger Tafel und Text. */
function signPost(s, x, y, z, text, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const hgt = o.h || 3.4, r = o.r || 0.9;
  const parts = [s.cyl(x, y, z, 0.08, hgt, m.metal, { sh: 0, sw: 0.6, steps: 8 })];
  const f = s.frame([x - r, y + 0.1, z + hgt], [1, 0, 0], [0, 0, 1], 1, 1);
  const col = o.mat || m.accent;
  let svg = '';
  if (o.round === false) svg += s.fRect(f, 0, 0, r * 2, r * 1.3, { fill: col.left, stroke: L, sw: 1 });
  else svg += s.fCircle(f, r, r * 0.65, r, { fill: o.fill || pal.surface, stroke: o.ring || pal.accent, sw: 2.4 }, 20);
  const th = Math.min(r * 0.6, (r * 1.8) / (text.length * 0.84 + 0.2));
  svg += s.fText(f, text, r, r * 0.65 - th * 0.5, th, { align: 'center', stroke: o.ink || (o.round === false ? pal.onAccent : L), sw: 1.5 });
  parts.push({ svg, bbox: [x - r, y, z + hgt, x + r, y + 0.2, z + hgt + r * 1.6], sh: 0 });
  return s.group(parts, [x - r, y - 0.2, z, x + r, y + 0.3, z + hgt + r * 1.7]);
}
function flagPole(s, x, y, z, h = 7, mat) {
  const m = s.m, pal = s.pal;
  const parts = [s.cyl(x, y, z, 0.12, h, m.metal, { sh: 0, sw: 0.7, steps: 8 }),
    s.prismXZ([[x + 0.1, z + h], [x + 3.0, z + h - 0.4], [x + 3.0, z + h - 2.0], [x + 0.1, z + h - 2.0]], y - 0.05, y + 0.05, mat || m.accent, { sh: 0, sw: 0.9 })];
  const f = s.frame([0, y + 0.06, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  const cx = x + 1.5, cz = z + h - 1.1;
  parts.push({ svg: s.fPoly(f, [[cx - 0.2, cz - 0.7], [cx + 0.2, cz - 0.7], [cx + 0.2, cz + 0.7], [cx - 0.2, cz + 0.7]], { fill: pal.surface, stroke: null }) + s.fPoly(f, [[cx - 0.7, cz - 0.2], [cx + 0.7, cz - 0.2], [cx + 0.7, cz + 0.2], [cx - 0.7, cz + 0.2]], { fill: pal.surface, stroke: null }), bbox: [x, y, z + h - 2, x + 3, y + 0.1, z + h], sh: 0 });
  return s.group(parts, [x - 0.2, y - 0.2, z, x + 3.2, y + 0.2, z + h]);
}
/** Regal mit bunten Büchern/Ordnern (Front +y). */
function bookshelf(s, x, y, z, w, h, d = 0.9, rows = 3) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const cols = [m.type('rail'), m.type('stay'), m.type('car'), m.type('transfer'), m.type('activity'), m.accent, m.type('ship'), m.type('food')];
  const parts = [s.box(x, y, z, w, d, h, m.wood, { sw: 1, sh: 0.4,
    decor: (f, sc) => {
      let r = '';
      const rh = h / rows;
      for (let i = 0; i < rows; i++) {
        r += sc.fRect(f.L, 0.12, i * rh + 0.1, w - 0.12, (i + 1) * rh - 0.08, { fill: m.ink.right, stroke: null });
        let u = 0.25, k = i * 3;
        while (u < w - 0.5) {
          const bw = 0.22 + ((k * 7) % 3) * 0.08, bh = rh * (0.55 + ((k * 5) % 4) * 0.1);
          const c = cols[(k++) % cols.length];
          r += sc.fRect(f.L, u, i * rh + 0.1, u + bw, i * rh + 0.1 + bh, { fill: c.left, stroke: L, sw: 0.5 });
          u += bw + 0.04;
        }
      }
      return r;
    } })];
  return s.group(parts);
}
function cabinet(s, x, y, z, w, d, h, drawers = 3) {
  const m = s.m, L = lineOf(s);
  return s.box(x, y, z, w, d, h, m.metal, { sw: 1, sh: 0.5,
    decor: (f, sc) => {
      let r = '';
      const dh = h / drawers;
      for (let i = 0; i < drawers; i++) {
        r += sc.fRect(f.L, 0.12, i * dh + 0.1, w - 0.12, (i + 1) * dh - 0.06, { fill: 'none', stroke: L, sw: 0.8 });
        r += sc.fLine(f.L, [[w * 0.35, i * dh + dh * 0.62], [w * 0.65, i * dh + dh * 0.62]], { stroke: L, sw: 1.6, cap: 'round' });
        r += sc.fRect(f.L, w * 0.38, i * dh + dh * 0.2, w * 0.62, i * dh + dh * 0.4, { fill: m.paper.left, stroke: L, sw: 0.5 });
      }
      return r;
    } });
}
/** Zaun (Latten) entlang x bei y von x0 bis x1. */
function fenceX(s, x0, x1, y, h = 1.2, step = 0.9) {
  const pal = s.pal;
  let d = '';
  for (let x = x0; x <= x1 + 0.01; x += step) { const a = s.P(x, y, 0), b = s.P(x, y, h); d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }
  const a = s.P(x0, y, h * 0.8), b = s.P(x1, y, h * 0.8), c = s.P(x0, y, h * 0.3), e = s.P(x1, y, h * 0.3);
  d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}M${c[0].toFixed(1)} ${c[1].toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
  return { svg: s.path(d, { stroke: pal.mute, sw: 1.3, fill: 'none' }), bbox: [x0, y, 0, x1, y + 0.1, h], sh: 0 };
}
function fenceY(s, y0, y1, x, h = 1.2, step = 0.9) {
  const pal = s.pal;
  let d = '';
  for (let y = y0; y <= y1 + 0.01; y += step) { const a = s.P(x, y, 0), b = s.P(x, y, h); d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }
  const a = s.P(x, y0, h * 0.8), b = s.P(x, y1, h * 0.8), c = s.P(x, y0, h * 0.3), e = s.P(x, y1, h * 0.3);
  d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}M${c[0].toFixed(1)} ${c[1].toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
  return { svg: s.path(d, { stroke: pal.mute, sw: 1.3, fill: 'none' }), bbox: [x, y0, 0, x + 0.1, y1, h], sh: 0 };
}
function hedge(s, x, y, w, d, h = 1.4) {
  const m = s.m;
  return s.box(x, y, 0, w, d, h, m.green2, { sw: 1, sh: 0.6, decor: (f, sc) => {
    let r = '';
    for (let u = 0.4; u < w; u += 0.9) r += sc.fCircle(f.L, u, h * 0.55 + ((u * 7) % 3) * 0.1, 0.32, { fill: m.green.left, stroke: m.green.line, sw: 0.6 }, 8);
    return r;
  } });
}
function laptop(s, x, y, z, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const parts = [s.box(x, y, z, 2.4, 1.7, 0.14, m.metal, { sh: 0, sw: 0.8, decor: (f, sc) => sc.fRect(f.T, 0.3, 0.3, 2.1, 0.9, { fill: m.ink.left, stroke: null }) }),
    s.box(x, y, z + 0.14, 2.4, 0.1, 1.6, m.metal, { sh: 0, sw: 0.8, decor: (f, sc) => {
      let r = sc.fRect(f.L, 0.12, 0.12, 2.28, 1.5, { fill: m.glass.top, stroke: null });
      if (o.icon === 'nowifi') { r += sc.fLine(f.L, [[0.7, 0.6], [1.2, 0.95], [1.7, 0.6]], { stroke: L, sw: 1.2, cap: 'round' }) + sc.fLine(f.L, [[0.5, 1.2], [1.9, 0.3]], { stroke: pal.accent, sw: 1.8, cap: 'round' }); }
      else { r += sc.fLine(f.L, [[0.5, 1.1], [1.9, 1.1]], { stroke: pal.mute, sw: 1.2, cap: 'round' }) + sc.fLine(f.L, [[0.5, 0.75], [1.5, 0.75]], { stroke: pal.mute, sw: 1.2, cap: 'round' }) + sc.fLine(f.L, [[0.5, 0.4], [1.7, 0.4]], { stroke: pal.mute, sw: 1.2, cap: 'round' }); }
      return r;
    } })];
  return s.group(parts, [x, y, z, x + 2.4, y + 1.7, z + 1.8]);
}
function officeChair(s, x, y, z, mat) {
  const m = s.m, c = mat || m.ink;
  const parts = [s.cyl(x + 0.5, y + 0.5, z, 0.45, 0.1, m.metal, { sh: 0, sw: 0.6 }), s.cyl(x + 0.5, y + 0.5, z + 0.1, 0.07, 0.45, m.metal, { sh: 0, sw: 0.5, steps: 8 }),
    s.box(x, y, z + 0.55, 1.0, 1.0, 0.2, c, { sh: 0, sw: 0.8 }), s.box(x, y - 0.05, z + 0.75, 1.0, 0.18, 1.0, c, { sh: 0, sw: 0.8 })];
  return s.group(parts, [x, y - 0.05, z, x + 1.0, y + 1.0, z + 1.8]);
}
/** Gitterturm (Funkmast) mit Schüssel. */
function mast(s, x, y, z, h = 11) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const parts = [];
  const legs = [[0, 0], [1.2, 0], [0, 1.2], [1.2, 1.2]];
  legs.forEach(([a, b]) => parts.push(s.box(x + a, y + b, z, 0.14, 0.14, h, m.metal, { sh: 0, sw: 0.5 })));
  for (let k = 1; k < 6; k++) {
    const zz = z + (h * k) / 6;
    parts.push(s.box(x, y, zz, 1.34, 0.1, 0.1, m.metal, { sh: 0, sw: 0.4 }));
    parts.push(s.box(x + 1.24, y, zz, 0.1, 1.34, 0.1, m.metal, { sh: 0, sw: 0.4 }));
  }
  parts.push(s.dome(x + 0.7, y + 0.7, z + h, 1.1, m.white, { sh: 0 }));
  return s.group(parts, [x - 0.2, y - 0.2, z, x + 1.5, y + 1.5, z + h + 1.2]);
}
function deckLines(s, x0, y0, x1, y1, z, step = 1.1) {
  const pal = s.pal;
  let d = '';
  for (let y = y0 + step; y < y1; y += step) { const a = s.P(x0, y, z), b = s.P(x1, y, z); d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }
  return { svg: s.path(d, { stroke: s.m.wood.line, sw: 0.7, sop: 0.5, fill: 'none' }), bbox: [x0, y0, z - 0.01, x1, y1, z], sh: 0 };
}
function trafficLight(s, x, y, z = 0, h = 4.2) {
  const m = s.m, pal = s.pal;
  const f = s.frame([x - 0.35, y + 0.2, z + h - 1.5], [1, 0, 0], [0, 0, 1], 1, 1);
  const parts = [s.cyl(x, y, z, 0.1, h, m.metal, { sh: 0, sw: 0.6, steps: 8 }),
    s.box(x - 0.4, y - 0.15, z + h - 1.7, 0.8, 0.3, 1.7, m.ink, { sh: 0, sw: 0.8, decor: (fr, sc) => sc.fCircle(fr.L, 0.4, 1.35, 0.2, { fill: pal.accent, stroke: null }, 10) + sc.fCircle(fr.L, 0.4, 0.85, 0.2, { fill: pal.type.stay, stroke: null, op: 0.45 }, 10) + sc.fCircle(fr.L, 0.4, 0.35, 0.2, { fill: pal.positive, stroke: null, op: 0.35 }, 10) })];
  return s.group(parts, [x - 0.4, y - 0.2, z, x + 0.4, y + 0.3, z + h]);
}
module.exports = { zebra, roadArrow, groundText, signPost, flagPole, bookshelf, cabinet, fenceX, fenceY, hedge, laptop, officeChair, mast, deckLines, trafficLight };
