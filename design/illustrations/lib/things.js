'use strict';
// Möbel, Dokumente, Symbole und andere kleine Objekte.
const { mix } = require('./util');

const lineOf = s => (s.pal.name === 'light' ? s.pal.ink : s.pal.bg);

function bed(s, x, y, z = 0, o = {}) {
  const m = s.m, P = [];
  const col = o.cover || m.accent;
  P.push(s.box(x, y, z, 2.3, 1.7, 0.35, m.wood, { sh: 0, sw: 0.9 }));
  P.push(s.box(x - 0.12, y - 0.05, z, 0.14, 1.8, 1.0, m.wood, { sh: 0, sw: 0.9 }));
  P.push(s.box(x + 0.1, y + 0.1, z + 0.35, 2.1, 1.5, 0.3, m.white, { sh: 0, sw: 0.9 }));
  P.push(s.box(x + 0.95, y + 0.08, z + 0.65, 1.2, 1.54, 0.12, col, { sh: 0, sw: 0.9 }));
  P.push(s.box(x + 0.2, y + 0.2, z + 0.65, 0.45, 0.55, 0.14, m.paper, { sh: 0, sw: 0.7 }));
  P.push(s.box(x + 0.2, y + 0.95, z + 0.65, 0.45, 0.55, 0.14, m.paper, { sh: 0, sw: 0.7 }));
  const g = s.group(P, [x - 0.12, y - 0.05, z, x + 2.3, y + 1.75, z + 1.0]);
  g.sh = 0.6;
  return g;
}
function tableLamp(s, x, y, z) {
  const m = s.m;
  const P = [s.cyl(x, y, z, 0.05, 0.35, m.metal, { sh: 0, sw: 0.6 }), s.frustum(x, y, z + 0.3, 0.46, 0.46, 0.28, 0.28, 0.32, m.lit, { sh: 0, sw: 0.7 })];
  return s.group(P, [x - 0.25, y - 0.25, z, x + 0.25, y + 0.25, z + 0.65]);
}
function nightstand(s, x, y, z = 0, lamp = true) {
  const m = s.m;
  const P = [s.box(x, y, z, 0.5, 0.5, 0.55, m.wood, { sh: 0, sw: 0.8 })];
  if (lamp) P.push(tableLamp(s, x + 0.25, y + 0.25, z + 0.55));
  const g = s.group(P, [x, y, z, x + 0.5, y + 0.5, z + 1.2]);
  g.sh = 0.3;
  return g;
}
function wardrobe(s, x, y, z = 0, w = 1.6, d = 0.6, h = 2.3) {
  const m = s.m;
  return s.box(x, y, z, w, d, h, m.wood, {
    sw: 0.9,
    decor: (f, sc) => sc.fLine(f.L, [[w / 2, 0.05], [w / 2, h - 0.05]], { stroke: m.wood.line, sw: 0.8 }) + sc.fLine(f.L, [[w / 2 - 0.15, h * 0.45], [w / 2 - 0.15, h * 0.55]], { stroke: m.wood.line, sw: 1.2, cap: 'round' }) + sc.fLine(f.L, [[w / 2 + 0.15, h * 0.45], [w / 2 + 0.15, h * 0.55]], { stroke: m.wood.line, sw: 1.2, cap: 'round' }),
  });
}
function chair(s, x, y, z = 0, o = {}) {
  const m = s.m, mat = o.mat || m.wood, P = [];
  P.push(s.box(x, y, z + 0.4, 0.45, 0.45, 0.07, mat, { sh: 0, sw: 0.7 }));
  for (const [a, b] of [[0, 0], [0.38, 0], [0, 0.38], [0.38, 0.38]]) P.push(s.box(x + a, y + b, z, 0.07, 0.07, 0.4, mat, { sh: 0, sw: 0.5 }));
  P.push(s.box(x - 0.02, y - 0.02, z + 0.47, 0.07, 0.49, 0.5, mat, { sh: 0, sw: 0.6 }));
  const g = s.group(P, [x - 0.02, y - 0.02, z, x + 0.45, y + 0.47, z + 0.97]);
  g.sh = 0.3;
  return g;
}
function desk(s, x, y, z = 0, w = 1.5, d = 0.75) {
  const m = s.m, P = [];
  P.push(s.box(x, y, z + 0.7, w, d, 0.07, m.wood, { sh: 0, sw: 0.8 }));
  for (const [a, b] of [[0.04, 0.04], [w - 0.11, 0.04], [0.04, d - 0.11], [w - 0.11, d - 0.11]]) P.push(s.box(x + a, y + b, z, 0.07, 0.07, 0.7, m.metal, { sh: 0, sw: 0.5 }));
  const g = s.group(P, [x, y, z, x + w, y + d, z + 0.78]);
  g.sh = 0.5;
  return g;
}
function sofa(s, x, y, z = 0, w = 2.4, o = {}) {
  const m = s.m, mat = o.mat || m.type('ship'), P = [];
  P.push(s.box(x, y, z, w, 0.9, 0.45, mat, { sh: 0, sw: 0.9 }));
  P.push(s.box(x, y - 0.1, z + 0.1, w, 0.28, 0.9, mat, { sh: 0, sw: 0.9 }));
  P.push(s.box(x - 0.12, y - 0.1, z, 0.28, 1.05, 0.65, mat, { sh: 0, sw: 0.9 }));
  P.push(s.box(x + w - 0.16, y - 0.1, z, 0.28, 1.05, 0.65, mat, { sh: 0, sw: 0.9 }));
  const g = s.group(P, [x - 0.12, y - 0.1, z, x + w + 0.12, y + 0.95, z + 1.0]);
  g.sh = 0.6;
  return g;
}
function roundTable(s, x, y, z = 0, r = 0.6, h = 0.75, o = {}) {
  const m = s.m, P = [];
  P.push(s.cyl(x, y, z, 0.07, h, m.metal, { sh: 0, sw: 0.6 }));
  P.push(s.cyl(x, y, z + h, r, 0.06, o.top || m.paper, { sh: 0, sw: 0.8 }));
  if (o.cloth) P.push(s.cyl(x, y, z + h - 0.15, r * 1.02, 0.2, o.cloth, { sh: 0, sw: 0.6 }));
  const g = s.group(P, [x - r, y - r, z, x + r, y + r, z + h + 0.1]);
  g.sh = 0.5;
  return g;
}
function plant(s, x, y, z = 0, h = 1.2) {
  const m = s.m;
  const P = [s.cyl(x, y, z, 0.28 * h / 1.2, 0.4 * h / 1.2, m.type('activity'), { sh: 0, sw: 0.7 }),
    s.sphere(x, y, z + 0.8 * h / 1.2, 0.42 * h / 1.2, m.green, { sh: 0, sw: 0.8 }),
    s.sphere(x + 0.15, y - 0.1, z + 1.05 * h / 1.2, 0.3 * h / 1.2, m.green2, { sh: 0, sw: 0.7 })];
  const g = s.group(P, [x - 0.4, y - 0.4, z, x + 0.5, y + 0.4, z + h + 0.5]);
  g.sh = 0.4;
  return g;
}
function counter(s, x, y, z, w, d, o = {}) {
  const m = s.m, pal = s.pal;
  const P = [];
  P.push(s.box(x, y, z, w, d, 1.05, o.mat || m.type('stay'), { sh: 0, sw: 0.9 }));
  P.push(s.box(x - 0.1, y - 0.1, z + 1.05, w + 0.2, d + 0.2, 0.1, m.paper, { sh: 0, sw: 0.9 }));
  return s.group(P, [x - 0.1, y - 0.1, z, x + w + 0.1, y + d + 0.1, z + 1.15]);
}
function monitor(s, x, y, z, w = 0.6) {
  const m = s.m;
  const P = [s.box(x + w / 2 - 0.05, y, z, 0.1, 0.1, 0.18, m.ink, { sh: 0, sw: 0.5 }), s.box(x, y - 0.02, z + 0.18, w, 0.06, w * 0.62, m.ink, { sh: 0, sw: 0.6, decor: (f, sc) => sc.fRect(f.L, 0.05, 0.05, w - 0.05, w * 0.62 - 0.05, { fill: m.glass.top, stroke: null }) })];
  return s.group(P, [x, y - 0.02, z, x + w, y + 0.1, z + 0.8]);
}
function rug(s, x, y, w, d, z = 0.02, col) {
  const pal = s.pal, m = s.m;
  const c = col || (pal.name === 'light' ? mix(pal.type.stay, pal.surface, 0.55) : mix(pal.type.stay, pal.bg, 0.55));
  let svg = s.flatPoly([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, c, { stroke: lineOf(s), sw: 0.8 }).svg;
  svg += s.flatPoly([[x + 0.3, y + 0.3], [x + w - 0.3, y + 0.3], [x + w - 0.3, y + d - 0.3], [x + 0.3, y + d - 0.3]], z, 'none', { stroke: pal.surface, sw: 0.8, dash: '3 3' }).svg;
  return { svg, bbox: [x, y, z - 0.04, x + w, y + d, z - 0.02], sh: 0 };
}
/** Flaches Blatt auf Fläche z mit Textzeilen. */
function sheet(s, x, y, z, w, d, o = {}) {
  const pal = s.pal, m = s.m;
  const mat = o.mat || m.card;
  const parts = [s.box(x, y, z, w, d, 0.05, mat, { sh: 0, sw: 0.8,
    decor: (f, sc) => {
      let r = '';
      const n = o.lines || 4;
      for (let i = 0; i < n; i++) {
        const v = d * 0.2 + (d * 0.6 * i) / Math.max(1, n - 1);
        const ln = i === 0 ? 0.55 : 0.8 - ((i * 37) % 3) * 0.12;
        r += sc.fLine(f.T, [[w * 0.12, v], [w * (0.12 + ln * 0.76), v]], { stroke: pal.mute, sw: 1.1, sop: 0.8, cap: 'round' });
      }
      if (o.stamp) r += sc.fCircle(f.T, w * 0.7, d * 0.3, Math.min(w, d) * 0.2, { fill: 'none', stroke: pal.accent, sw: 1.4 }, 20);
      return r;
    } })];
  const g = s.group(parts, [x, y, z, x + w, y + d, z + 0.05]);
  g.sh = 0;
  return g;
}
/** Stehende Tafel (Ebene xz bei Tiefe y) mit Dicke. */
function boardUp(s, x, y, z, w, h, mat, o = {}) {
  return s.box(x, y, z, w, o.t || 0.2, h, mat, { sw: o.sw || 1, sh: o.sh == null ? 0 : o.sh, decor: o.decor });
}
/** Ebene Figur mit Dicke (Silhouette in xz), z. B. Ticket, Schild: konkav erlaubt. */
function cutout(s, poly, y, t, mat, o = {}) {
  const line = mat.line;
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const back = poly.map(p => s.P(p[0], y, p[1]));
  const back2 = poly.map(p => s.P(p[0], y - t, p[1]));
  let svg = '';
  // Seitenfläche: Verbindung der beiden Silhouetten (Hülle über jede Kante)
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    svg += s.poly([back[i], back[j], back2[j], back2[i]], { fill: mat.right, stroke: line, sw: o.sw || 0.9 });
  }
  svg += s.poly(back2, { fill: mat.right, stroke: line, sw: o.sw || 0.9 });
  svg += s.poly(back, { fill: o.fill || mat.left, stroke: line, sw: o.sw || 1 });
  return { svg, bbox: [Math.min(...xs), y - t, Math.min(...zs), Math.max(...xs), y, Math.max(...zs)], sh: o.sh == null ? 0 : o.sh };
}
function check(s, x, y, z, size, col, o = {}) {
  // Haken in xz-Ebene bei y
  const f = s.frame([x, y, z], [1, 0, 0], [0, 0, 1], size, size);
  return s.fLine(f, [[size * 0.12, size * 0.5], [size * 0.4, size * 0.2], [size * 0.9, size * 0.85]], { stroke: col, sw: o.sw || 2.4, cap: 'round' });
}
function coin(s, x, y, z, r = 0.5, text) {
  const m = s.m, pal = s.pal;
  const c = s.cyl(x, y, z, r, 0.12, m.type('stay'), { sh: 0, sw: 0.8 });
  c.svg += s.fCircle(s.frame([x, y, z + 0.12], [1, 0, 0], [0, -1, 0], 1, 1), 0, 0, r * 0.72, { fill: 'none', stroke: mix(pal.type.stay, lineOf(s), 0.5), sw: 0.6 }, 18);
  return c;
}
function phone(s, x, y, z, w = 1.2, h = 2.4, o = {}) {
  // stehendes Telefon (Ebene xz bei y), Bildschirm zeigt Blatt + Teilen-Symbol
  const m = s.m, pal = s.pal;
  return s.box(x, y, z, w, 0.18, h, m.ink, {
    sw: 1, sh: o.sh,
    decor: (f, sc) => {
      let r = sc.fRect(f.L, 0.07, 0.1, w - 0.07, h - 0.1, { fill: pal.surface, stroke: null });
      r += sc.fRect(f.L, 0.2, h * 0.38, w - 0.2, h - 0.45, { fill: m.paper.left, stroke: pal.mute, sw: 0.7 });
      r += sc.fLine(f.L, [[0.3, h - 0.62], [w - 0.35, h - 0.62]], { stroke: pal.mute, sw: 1, cap: 'round' });
      r += sc.fLine(f.L, [[0.3, h - 0.82], [w - 0.5, h - 0.82]], { stroke: pal.mute, sw: 1, cap: 'round' });
      r += sc.fLine(f.L, [[0.3, h - 1.02], [w - 0.4, h - 1.02]], { stroke: pal.mute, sw: 1, cap: 'round' });
      // Teilen-Schaltfläche
      r += sc.fRect(f.L, w / 2 - 0.3, 0.2, w / 2 + 0.3, 0.55, { fill: pal.accent, stroke: null });
      r += sc.fLine(f.L, [[w / 2, 0.28], [w / 2, 0.47]], { stroke: pal.onAccent, sw: 1.3, cap: 'round' });
      r += sc.fLine(f.L, [[w / 2 - 0.1, 0.38], [w / 2, 0.48], [w / 2 + 0.1, 0.38]], { stroke: pal.onAccent, sw: 1.3, cap: 'round' });
      return r;
    },
  });
}
function serverRack(s, x, y, z, w = 1.6, d = 1.4, h = 3.2, o = {}) {
  const m = s.m, pal = s.pal;
  return s.box(x, y, z, w, d, h, m.ink, {
    sw: 1, sh: o.sh,
    decor: (f, sc) => {
      let r = '';
      const n = 5;
      for (let i = 0; i < n; i++) {
        const v = 0.2 + i * (h - 0.4) / n;
        r += sc.fRect(f.L, 0.12, v, w - 0.12, v + (h - 0.4) / n - 0.1, { fill: m.metal.right, stroke: pal.bg, sw: 0.6 });
        r += sc.fCircle(f.L, 0.3, v + (h - 0.4) / n / 2 - 0.05, 0.05, { fill: i % 2 ? pal.positive : pal.accent, stroke: null }, 8);
        r += sc.fLine(f.L, [[0.55, v + (h - 0.4) / n / 2 - 0.05], [w - 0.35, v + (h - 0.4) / n / 2 - 0.05]], { stroke: pal.mute, sw: 0.8, cap: 'round' });
      }
      return r;
    },
  });
}
/** Karte (Ticket) liegend oder stehend; Kopfband in Typfarbe, Perforation, Zeilen. */
function ticketCard(s, x, y, z, w, d, o = {}) {
  const m = s.m, pal = s.pal;
  const head = o.head || m.accent;
  const dashed = !!o.dashed;
  return s.box(x, y, z, w, d, o.t || 0.12, o.mat || m.card, {
    sw: 0.9, sh: o.sh == null ? 0 : o.sh,
    decor: (f, sc) => {
      const T = f.T;
      let r = '';
      r += sc.fRect(T, 0, d * 0.72, w, d, { fill: head.left, stroke: null });
      r += sc.fLine(T, [[w * 0.62, 0], [w * 0.62, d]], { stroke: pal.mute, sw: 0.8, dash: '2 2.5', sop: 0.9 });
      r += sc.fLine(T, [[w * 0.08, d * 0.5], [w * 0.5, d * 0.5]], { stroke: pal.ink, sw: 1.6, cap: 'round' });
      r += sc.fLine(T, [[w * 0.08, d * 0.32], [w * 0.4, d * 0.32]], { stroke: pal.mute, sw: 1.2, cap: 'round' });
      r += sc.fLine(T, [[w * 0.08, d * 0.16], [w * 0.46, d * 0.16]], { stroke: pal.mute, sw: 1.2, cap: 'round' });
      for (let i = 0; i < 5; i++) r += sc.fLine(T, [[w * (0.68 + i * 0.045), d * 0.14], [w * (0.68 + i * 0.045), d * 0.5]], { stroke: pal.ink, sw: i % 2 ? 0.8 : 1.4 });
      if (dashed) r += sc.fPoly(T, [[0.05, 0.05], [w - 0.05, 0.05], [w - 0.05, d - 0.05], [0.05, d - 0.05]], { fill: 'none', stroke: pal.accent, sw: 1.2, dash: '4 3' });
      return r;
    },
  });
}
function globe(s, x, y, z, r, o = {}) {
  const m = s.m, pal = s.pal;
  const P = [s.cyl(x, y, z, r * 0.5, 0.12, m.metal, { sh: 0, sw: 0.8 }), s.cyl(x, y, z + 0.12, 0.07, r * 0.9, m.metal, { sh: 0, sw: 0.6 })];
  const cz = z + 0.12 + r * 1.15;
  const sp = s.sphere(x, y, cz, r, m.water, { sh: 0, sw: 1 });
  // Meridiane und Kontinente (einfach)
  const c = s.P(x, y, cz), R = r * s.k * 1.2247;
  let det = s.circle(c[0], c[1], R * 0.999, { fill: 'none', stroke: pal.name === 'light' ? mix(pal.type.ship, pal.surface, 0.1) : pal.bg, sw: 0.6, sop: 0.5 });
  det += s.path(`M${(c[0] - R * 0.55).toFixed(1)} ${(c[1] - R * 0.4).toFixed(1)}q${(R * 0.4).toFixed(1)} ${(-R * 0.35).toFixed(1)} ${(R * 0.7).toFixed(1)} ${(R * 0.05).toFixed(1)}q${(-R * 0.1).toFixed(1)} ${(R * 0.5).toFixed(1)} ${(-R * 0.45).toFixed(1)} ${(R * 0.45).toFixed(1)}q${(-R * 0.35).toFixed(1)} ${(-R * 0.2).toFixed(1)} ${(-R * 0.25).toFixed(1)} ${(-R * 0.5).toFixed(1)}z`, { fill: m.green.left, stroke: m.green.line, sw: 0.7 });
  det += s.path(`M${(c[0] + R * 0.2).toFixed(1)} ${(c[1] + R * 0.3).toFixed(1)}q${(R * 0.35).toFixed(1)} ${(-R * 0.1).toFixed(1)} ${(R * 0.4).toFixed(1)} ${(R * 0.25).toFixed(1)}q${(-R * 0.2).toFixed(1)} ${(R * 0.25).toFixed(1)} ${(-R * 0.45).toFixed(1)} ${(R * 0.1).toFixed(1)}z`, { fill: m.green2.left, stroke: m.green.line, sw: 0.7 });
  P.push(sp, { svg: det, bbox: sp.bbox, sh: 0 });
  const g = s.group(P, [x - r, y - r, z, x + r, y + r, cz + r]);
  g.sh = 0.5;
  return g;
}
/** Uhr (Zifferblatt stehend an Ebene xz bei y), Zeiger gem. h:m */
function clockFace(s, x, y, z, r, hh, mm, o = {}) {
  const pal = s.pal, m = s.pal && s.m;
  const f = s.frame([x, y, z], [1, 0, 0], [0, 0, 1], 1, 1);
  let svg = s.fCircle(f, 0, 0, r, { fill: pal.surface, stroke: lineOf(s), sw: 1.2 }, 28);
  svg += s.fCircle(f, 0, 0, r * 0.88, { fill: 'none', stroke: pal.mute, sw: 0.6 }, 28);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; svg += s.fLine(f, [[Math.sin(a) * r * 0.74, Math.cos(a) * r * 0.74], [Math.sin(a) * r * 0.86, Math.cos(a) * r * 0.86]], { stroke: pal.ink, sw: i % 3 === 0 ? 1.5 : 0.8 }); }
  const ah = ((hh % 12) + mm / 60) / 12 * Math.PI * 2, am = mm / 60 * Math.PI * 2;
  svg += s.fLine(f, [[0, 0], [Math.sin(ah) * r * 0.5, Math.cos(ah) * r * 0.5]], { stroke: pal.ink, sw: 2.2, cap: 'round' });
  svg += s.fLine(f, [[0, 0], [Math.sin(am) * r * 0.75, Math.cos(am) * r * 0.75]], { stroke: o.hand || pal.accent, sw: 1.6, cap: 'round' });
  return { svg, bbox: [x - r, y, z - r, x + r, y + 0.05, z + r], sh: 0 };
}
function umbrellaParasol(s, x, y, z, r, h, mat, o = {}) {
  const m = s.m, P = [];
  P.push(s.cyl(x, y, z, 0.07, h, m.metal, { sh: 0, sw: 0.6 }));
  P.push(s.tube('z', z + h - 0.45, z + h + 0.55, x, y, r, 0.12, mat, { sh: 0, sw: 0.9, steps: 28 }));
  const g = s.group(P, [x - r, y - r, z, x + r, y + r, z + h + 0.6]);
  g.sh = 0.8; g.fp = [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  return g;
}

module.exports = { bed, tableLamp, nightstand, wardrobe, chair, desk, sofa, roundTable, plant, counter, monitor, rug, sheet, boardUp, cutout, check, coin, phone, serverRack, ticketCard, globe, clockFace, umbrellaParasol };
