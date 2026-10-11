'use strict';
const { cropMarks, island, waves } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const SC = require('../lib/scenery');
const T = require('../lib/things');
const { mix } = require('../lib/util');

const def = (id, title, alt, usage, build, setup, extra = {}) => ({ id, kind: 'type', title, alt, usage, width: 1200, height: 800, build, setup, ...extra });
const lineOf = pal => (pal.name === 'light' ? pal.ink : pal.bg);

/** Gestreiftes Sonnensegel (schräge Ebene) mit Volant. */
function awning(s, pal, x0, x1, yWall, yFront, zHigh, zLow, n) {
  const m = s.m, L = lineOf(pal);
  let svg = '';
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w, b = a + w;
    const fill = i % 2 ? (pal.name === 'light' ? pal.surface : mix(pal.ink, pal.mute, 0.1)) : m.accent.left;
    svg += s.poly3([[a, yWall, zHigh], [b, yWall, zHigh], [b, yFront, zLow], [a, yFront, zLow]], { fill: i % 2 ? (pal.name === 'light' ? pal.surface : mix(pal.ink, pal.mute, 0.1)) : m.accent.top, stroke: L, sw: 0.8 });
    svg += s.poly3([[a, yFront, zLow], [b, yFront, zLow], [b, yFront, zLow - 0.5], [(a + b) / 2, yFront, zLow - 0.75], [a, yFront, zLow - 0.5]], { fill, stroke: L, sw: 0.8 });
  }
  return { svg, bbox: [x0, yWall, zLow - 0.8, x1, yFront, zHigh], sh: 0.2 };
}

// ---------------------------------------------------------------- Restaurant
function restaurant(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -18, -16, 18, 14, { th: 1.3, grid: 4 });
  const G = [];
  G.push(s.strip([[-18, 11], [18, 11]], 4.2, 0.02, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-18, 11], [18, 11]], 0.03, { stroke: pal.surface, sw: 1.2, dash: '6 5' }));
  s.add(G, 'ground');
  // Gebäude
  const b = [];
  b.push(s.box(-14, -14, 0, 24, 8, 5.2, m.paper, {
    decor: (f, sc) => {
      let r = '';
      for (const u of [1.2, 8.4]) {
        r += sc.fRect(f.L, u, 0.2, u + 5.6, 3.5, { fill: m.lit.left, stroke: L, sw: 1 });
        r += sc.fLine(f.L, [[u + 2.8, 0.2], [u + 2.8, 3.5]], { stroke: L, sw: 0.8 });
        r += sc.fLine(f.L, [[u, 1.9], [u + 5.6, 1.9]], { stroke: L, sw: 0.6, sop: 0.8 });
      }
      r += sc.fRect(f.L, 15.4, 0, 18, 3.3, { fill: m.wood.left, stroke: L, sw: 1 });
      r += sc.fRect(f.L, 16.0, 1.0, 17.4, 2.8, { fill: m.glass.top, stroke: L, sw: 0.8 });
      r += sc.fRect(f.L, 1, 4.1, 23, 4.9, { fill: pal.accent, stroke: L, sw: 0.9 });
      r += sc.fText(f.L, 'RESTAURANT', 12, 4.3, 0.55, { align: 'center', stroke: pal.onAccent, sw: 1.3 });
      return r;
    },
  }));
  b.push(s.box(-14.4, -14.4, 5.2, 24.8, 8.8, 0.4, m.metal, { sw: 0.9 }));
  b.push(s.box(-9, -12, 5.6, 2, 2, 1.8, m.metal, { sw: 0.8 }));
  s.add(b);
  s.add(awning(s, pal, -13, 9, -6, -3.4, 3.6, 2.7, 11));
  // Terrasse
  s.add(s.box(-14, -6, 0, 24, 11, 0.25, m.wood, { sw: 0.9, sh: 0 }));
  // Tische
  const tbl = [[-9, 0.5], [-3, 1.5], [3, 0], [7.6, 2.4]];
  tbl.forEach((t, i) => {
    s.add(T.roundTable(s, t[0], t[1], 0.25, 0.75, 0.75, { cloth: i % 2 ? m.type('stay') : m.accent }));
    s.add(T.chair(s, t[0] - 1.4, t[1] - 0.2, 0.25));
    s.add(T.chair(s, t[0] + 0.9, t[1] - 0.2, 0.25));
    s.add(s.cyl(t[0] + 0.1, t[1] - 0.1, 1.06, 0.2, 0.04, m.white, { sh: 0, sw: 0.6 }));
  });
  s.add(T.umbrellaParasol(s, -3, 1.5, 0.25, 2.4, 3.6, m.accent));
  s.add(T.umbrellaParasol(s, 7.6, 2.4, 0.25, 2.4, 3.6, m.type('stay')));
  // Gäste und Service
  s.add(P.person(s, -9.8, -1.6, 0.25, { shirt: m.type('rail') }));
  s.add(P.person(s, -2.0, -0.2, 0.25, { shirt: m.type('transfer'), h: 1.65 }));
  s.add(P.person(s, 4.6, 1.2, 0.25, { shirt: m.type('ship') }));
  s.add(P.person(s, 1.2, 3.4, 0.25, { shirt: m.white, pants: m.ink }));
  s.add(s.box(0.65, 3.0, 1.55, 0.7, 0.5, 0.06, m.metal, { sh: 0, sw: 0.5 }));
  // Menütafel
  const mt = [s.box(10.8, 4.6, 0.25, 0.1, 1.2, 1.5, m.ink, { sh: 0, sw: 0.8 }),
    s.box(11.0, 4.6, 0.25, 0.1, 1.2, 1.5, m.ink, { sh: 0, sw: 0.8, decor: (f, sc) => sc.fText(f.R, 'MENÜ', 0.6, 0.55, 0.33, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.1 }) })];
  s.add(s.group(mt, [10.8, 4.6, 0.25, 11.1, 5.8, 1.75]));
  // Pflanzkübel entlang der Terrassenkante
  for (const x of [-13, -6, 0, 6]) s.add(s.group([s.box(x, 4.4, 0.25, 1.6, 0.6, 0.6, m.stone, { sh: 0, sw: 0.7 }), s.sphere(x + 0.5, 4.7, 1.2, 0.5, m.green, { sh: 0, sw: 0.7 }), s.sphere(x + 1.2, 4.7, 1.1, 0.42, m.green2, { sh: 0, sw: 0.7 })]));
  // Lichterkette
  const sx = [-13.4, 9.4];
  for (const x of sx) s.add(s.cyl(x, 4.5, 0.25, 0.08, 4.3, m.metal, { sh: 0, sw: 0.6 }));
  const wire = [], bulbs = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; const x = -13.4 + t * 22.8; const z = 4.55 - Math.sin(t * Math.PI) * 0.9; wire.push(s.P(x, 4.5, z)); if (i % 2) bulbs.push(s.circle(...s.P(x, 4.5, z - 0.12), 2.0, { fill: pal.type.stay, stroke: L, sw: 0.5 })); }
  s.add({ svg: s.line(wire, { stroke: pal.mute, sw: 0.9 }) + bulbs.join(''), bbox: [-13.4, 4.4, 3.2, 9.4, 4.6, 4.6], sh: 0 });
  s.add(P.tree(s, 14.5, -8, 0, 6.6, { two: true }));
  s.add(P.tree(s, -16, 8, 0, 5.4));
  s.add(P.bush(s, 15, 7, 0, 1.2));
  s.add(P.lamp(s, -16, 9, 0, 5.5)); s.add(P.lamp(s, 16, 9, 0, 5.5));
}

// ---------------------------------------------------------------- Veranstaltung
function veranstaltung(s, pal) {
  const m = s.m, L = lineOf(pal);
  s.personLod = 0;
  cropMarks(s);
  island(s, -20, -18, 22, 18, { th: 1.3, grid: 4 });
  // Bühne
  s.add(s.box(-14, -16, 0, 28, 12, 1.5, m.wood, {
    sw: 1,
    decor: (f, sc) => sc.fRect(f.L, 0.4, 0.3, 27.6, 0.55, { fill: pal.accent, stroke: null }),
  }));
  s.add(s.box(-14, -16, 1.5, 28, 0.5, 9, m.ink, { sw: 1, decor: (f, sc) => sc.fText(f.L, 'KONZERT', 14, 3.3, 2.4, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 2.2 }) }));
  // Traversen-Bogen
  const tr = [];
  tr.push(s.box(-13, -6.5, 1.5, 0.5, 0.5, 9.4, m.metal, { sw: 0.8, sh: 0 }));
  tr.push(s.box(12.5, -6.5, 1.5, 0.5, 0.5, 9.4, m.metal, { sw: 0.8, sh: 0 }));
  tr.push(s.box(-13, -6.5, 10.4, 26.5, 0.5, 0.5, m.metal, { sw: 0.8, sh: 0 }));
  s.add(s.group(tr, [-13, -6.5, 1.5, 13.0, -6.0, 10.9]));
  const lamps = [];
  const beams = [];
  for (let i = 0; i < 6; i++) {
    const lx = -10 + i * 4.4;
    lamps.push(s.cyl(lx, -6.25, 9.3, 0.38, 1.1, m.ink, { sh: 0, sw: 0.7, steps: 14 }));
    const tx = -8 + i * 3.2, ty = -11;
    const a = s.P(lx, -6.25, 9.3), b1 = s.P(tx - 1.4, ty, 1.5), b2 = s.P(tx + 1.4, ty, 1.5);
    beams.push(s.poly([a, b1, b2], { fill: pal.name === 'light' ? pal.type.stay : pal.type.stay, op: pal.name === 'light' ? 0.2 : 0.22 }));
  }
  s.add({ svg: beams.join(''), bbox: [-14, -11, 1.5, 14, -6, 9.5], sh: 0 });
  s.add(s.group(lamps, [-11, -6.7, 9.3, 12, -5.8, 10.4]));
  // Lautsprecher
  for (const sx of [-17.5, 15]) {
    for (let k = 0; k < 3; k++) s.add(s.box(sx, -12 + (0), 0 + k * 1.5, 2.6, 2.4, 1.5, m.ink, { sw: 0.9, sh: k === 0 ? undefined : 0,
      decor: (f, sc) => sc.fCircle(f.L, 1.3, 0.75, 0.5, { fill: m.metal.right, stroke: pal.mute, sw: 0.7 }, 14) + sc.fCircle(f.R, 1.2, 0.75, 0.45, { fill: m.metal.right, stroke: pal.mute, sw: 0.7 }, 14) }));
  }
  // Künstler:in mit Mikrofon
  s.add(P.person(s, 0, -9, 1.5, { shirt: m.accent, h: 1.8 }));
  s.add(s.group([s.cyl(1.2, -8.2, 1.5, 0.05, 1.5, m.metal, { sh: 0, sw: 0.5 }), s.sphere(1.2, -8.2, 3.1, 0.13, m.ink, { sh: 0, sw: 0.5, flat: true })]));
  s.add(P.person(s, -5.5, -11, 1.5, { shirt: m.type('ship') }));
  s.add(P.person(s, 6, -11, 1.5, { shirt: m.type('transfer') }));
  // Absperrung und Publikum
  for (let i = 0; i < 15; i++) s.add(s.box(-14 + i * 2, -2.8, 0, 1.9, 0.2, 1.0, m.metal, { sw: 0.7, sh: 0 }));
  const cols = [m.type('stay'), m.type('rail'), m.type('car'), m.type('activity'), m.type('transfer'), m.type('ship'), m.type('food')];
  let k = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    if ((r + c) % 5 === 3) continue;
    s.add(P.person(s, -12 + c * 3.3 + (r % 2) * 1.2, 0.5 + r * 2.8, 0, { shirt: cols[(k++) % cols.length], h: 1.55 + ((c * 3 + r) % 4) * 0.06 }));
  }
  // Grosses Eintrittsticket
  const tw = 10, th = 5.6, tx = 7, ty = 12.5, tz = 0.0;
  const pts = [];
  pts.push([tx, tz + 0.4]);
  const arc = (cx, cz, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  pts.push([tx + tw, tz + 0.4]);
  pts.push([tx + tw, tz + 0.4 + th / 2 - 0.9]);
  arc(tx + tw, tz + 0.4 + th / 2, 0.9, -Math.PI / 2, -3 * Math.PI / 2, 8);
  pts.push([tx + tw, tz + 0.4 + th]);
  pts.push([tx, tz + 0.4 + th]);
  pts.push([tx, tz + 0.4 + th / 2 + 0.9]);
  arc(tx, tz + 0.4 + th / 2, 0.9, Math.PI / 2, -Math.PI / 2, 8);
  const tk = s.cutout ? null : null;
  const cut = T.cutout(s, pts, ty, 0.35, m.card, { sw: 1.1, sh: 1 });
  const tf = s.frame([0, ty, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  let tsvg = s.fPoly(tf, [[tx, tz + 0.4 + th - 1.4], [tx + tw, tz + 0.4 + th - 1.4], [tx + tw, tz + 0.4 + th], [tx, tz + 0.4 + th]], { fill: pal.accent, stroke: null });
  tsvg += s.fLine(tf, [[tx + tw * 0.72, tz + 0.7], [tx + tw * 0.72, tz + 0.4 + th - 0.3]], { stroke: pal.mute, sw: 1, dash: '3 3' });
  tsvg += s.fText(tf, 'EINTRITT', tx + tw * 0.36, tz + 2.1, 0.85, { align: 'center', stroke: pal.ink, sw: 1.6 });
  tsvg += s.fText(tf, '11.10.2026', tx + tw * 0.36, tz + 1.0, 0.5, { align: 'center', stroke: pal.mute, sw: 1.1 });
  for (let i = 0; i < 6; i++) tsvg += s.fLine(tf, [[tx + tw * (0.78 + i * 0.03), tz + 0.9], [tx + tw * (0.78 + i * 0.03), tz + 2.6]], { stroke: pal.ink, sw: i % 2 ? 0.8 : 1.5 });
  cut.svg += tsvg;
  // Ständer
  s.add(s.group([s.box(tx + 1.2, ty - 1.6, 0, 0.5, 1.8, 0.4, m.metal, { sh: 0, sw: 0.7 }), s.box(tx + tw - 1.7, ty - 1.6, 0, 0.5, 1.8, 0.4, m.metal, { sh: 0, sw: 0.7 })]));
  s.add(cut);
  s.add(P.tree(s, -18, 12, 0, 6)); s.add(P.tree(s, 19, -12, 0, 6.4, { two: true }));
  s.add(P.lamp(s, -18, 4, 0, 6.5));
}

// ---------------------------------------------------------------- Versicherung
function versicherung(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  s.add(s.cyl(0, 0, -1.2, 14, 1.2, m.ground, { sw: 1, sh: 0 }), 'ground');
  s.raw(s.ellipse(...s.P(0, 0, 0), 12 * s.k * 1.2247, 12 * s.k * 0.7071, { fill: 'none', stroke: pal.line, sw: 1, dash: '4 4' }), 'ground');
  // Mini-Welt: Haus, Auto, Koffer, Familie
  const hs = [];
  hs.push(s.box(1, -9, 0, 7, 6, 3.6, m.paper, {
    decor: (f, sc) => sc.windows(f.L, 0.6, 0.9, 3.0, 2.8, 1, 1, { inset: 0.0 }) + sc.fRect(f.L, 4.2, 0, 6, 2.5, { fill: m.wood.left, stroke: L, sw: 0.9 }) + sc.windows(f.R, 0.7, 0.9, 2.7, 2.8, 1, 1, { inset: 0.05 }) + sc.windows(f.R, 3.2, 0.9, 5.2, 2.8, 1, 1, { inset: 0.05 }),
  }));
  hs.push(s.gable(0.4, -9.6, 3.6, 8.2, 7.2, 2.8, m.type('activity'), { axis: 'x' }));
  s.add(hs);
  s.add(O.car(s, 3, -1.5, 0, { mat: m.type('ship'), suv: true, rails: true }));
  s.add(P.suitcase(s, 6.5, 3.2, 0, 2.0, 1.2, 1.6, m.type('stay')));
  s.add(P.suitcase(s, 9, 3.9, 0, 1.6, 1.0, 1.2, m.accent));
  s.add(P.person(s, -1.5, 3.5, 0, { shirt: m.type('rail') }));
  s.add(P.person(s, 0.1, 4.2, 0, { shirt: m.type('car'), h: 1.5 }));
  s.add(P.person(s, -0.8, 5.3, 0, { shirt: m.type('stay'), h: 1.1 }));
  s.add(P.tree(s, -9, 4, 0, 5, { r: 1.6 }));
  s.add(P.bush(s, 9, -4, 0, 1.0));
  // Schirm (Mast in der Mitte-links, Dach gross)
  const cx = -4.5, cy = -4.5, rr = 9.5, cz = 12.0, ch = 3.4;
  s.add(s.cyl(cx, cy, 0, 0.25, cz + ch - 0.3, m.metal, { sh: 0, sw: 0.8 }));
  const N = 10;
  const slabs = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    const nz = rr / Math.hypot(rr, ch), nh = ch / Math.hypot(rr, ch);
    const nx = Math.cos(am) * nh, ny = Math.sin(am) * nh;
    const pt = (a, r, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
    const edge = [];
    for (let j = 0; j <= 4; j++) { const a = a0 + (a1 - a0) * j / 4; edge.push(pt(a, rr * (1 - Math.sin((j / 4) * Math.PI) * 0.05), cz)); }
    slabs.push({ d: nx + ny, i, poly: [pt(0, 0, cz + ch)].concat(edge), am, vis: nx + ny + nz > 0 });
  }
  slabs.sort((a, b) => a.d - b.d);
  let um = '';
  for (const sl of slabs) {
    if (!sl.vis) continue;
    const base = sl.i % 2 ? m.paper : m.accent;
    const lit = (Math.cos(sl.am) * -0.45 + Math.sin(sl.am) * 0.8) * 0.5 + 0.5;
    um += s.poly3(sl.poly, { fill: mix(base.right, base.top, Math.max(0, Math.min(1, lit * 0.9 + 0.1))), stroke: L, sw: 1 });
  }
  um += s.circle(...s.P(cx, cy, cz + ch + 0.1), 2.6, { fill: m.metal.top, stroke: L, sw: 0.8 });
  s.add({ svg: um, bbox: [cx - rr, cy - rr, cz, cx + rr, cy + rr, cz + ch], sh: 0 });
  // Schild
  const sx = 8.5, sy = 8.5;
  const shield = [[-3.2, 8.2], [-1.6, 9.0], [0, 8.5], [1.6, 9.0], [3.2, 8.2], [3.2, 4.0], [1.9, 1.7], [0, 0.5], [-1.9, 1.7], [-3.2, 4.0]].map(p => [p[0] + sx, p[1] + 0.8]);
  s.add(s.box(sx - 2.2, sy - 1.2, 0, 4.4, 2.4, 0.8, m.stone, { sw: 1 }));
  const sc = T.cutout(s, shield, sy, 0.5, m.accent, { sw: 1.2, sh: 0.5 });
  const sf = s.frame([0, sy, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  const inner = [[-2.5, 7.6], [-1.4, 8.1], [0, 7.7], [1.4, 8.1], [2.5, 7.6], [2.5, 4.3], [1.5, 2.4], [0, 1.4], [-1.5, 2.4], [-2.5, 4.3]].map(p => [p[0] + sx, p[1] + 0.8]);
  sc.svg += s.fPoly(sf, inner, { fill: 'none', stroke: pal.onAccent, sw: 1.4, sop: 0.9 });
  sc.svg += s.fLine(sf, [[sx - 1.5, 5.0], [sx - 0.3, 3.6], [sx + 1.9, 6.9]], { stroke: pal.onAccent, sw: 4, cap: 'round' });
  s.add(sc);
}

// ---------------------------------------------------------------- Visum
function visum(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -18, -16, 20, 16, { th: 1.3, grid: 4 });
  // Rückwand mit Stempelabdruck
  const wall = s.box(-16, -15, 0, 34, 0.6, 9, m.paper, {
    sw: 1,
    decor: (f, sc) => {
      let r = sc.fCircle(f.L, 25, 5.2, 3.0, { fill: 'none', stroke: pal.accent, sw: 2.4 }, 32);
      r += sc.fCircle(f.L, 25, 5.2, 2.3, { fill: 'none', stroke: pal.accent, sw: 1.2 }, 32);
      r += sc.fText(f.L, 'EINREISE', 25, 5.5, 0.55, { align: 'center', stroke: pal.accent, sw: 1.3 });
      r += sc.fText(f.L, '11.10.2026', 25, 4.2, 0.5, { align: 'center', stroke: pal.accent, sw: 1.2 });
      r += sc.fRect(f.L, 2, 5.5, 13, 8.2, { fill: m.soft('safety').left, stroke: L, sw: 0.9 });
      r += sc.fText(f.L, 'PASSKONTROLLE', 7.5, 6.6, 0.6, { align: 'center', stroke: L, sw: 1.2 });
      return r;
    },
  });
  s.add(wall);
  // Schalter
  const bz = [];
  bz.push(s.box(-8, -10, 0, 14, 2.4, 1.2, m.type('safety'), { sw: 1, decor: (f, sc) => sc.fRect(f.L, 0.4, 0.3, 13.6, 0.5, { fill: pal.surface, stroke: null }) }));
  bz.push(s.box(-8, -10, 1.2, 14, 0.15, 3.0, m.glass, { sw: 0.9, sh: 0 }));
  s.add(bz);
  s.add(P.person(s, -2.5, -12.3, 0, { shirt: m.type('ship'), h: 1.8 }));
  s.add(P.person(s, 3.5, -12.3, 0, { shirt: m.type('ship'), h: 1.7 }));
  // Pass, Stempel, Tinte
  s.add(s.box(-2.2, -9.0, 1.2, 1.5, 1.1, 0.07, m.type('doc'), { sw: 0.8, sh: 0 }));
  s.add(s.box(-0.6, -9.0, 1.2, 1.5, 1.1, 0.07, m.white, { sw: 0.8, sh: 0, decor: (f, sc) => sc.fCircle(f.T, 0.7, 0.55, 0.38, { fill: 'none', stroke: pal.accent, sw: 1.1 }, 14) }));
  s.add(s.group([s.box(1.6, -9.2, 1.2, 1.3, 0.9, 0.2, m.ink, { sh: 0, sw: 0.7 }), s.cyl(2.25, -8.75, 1.4, 0.35, 0.3, m.accent, { sh: 0, sw: 0.7 }), s.cyl(2.25, -8.75, 1.7, 0.14, 0.5, m.wood, { sh: 0, sw: 0.6 }), s.sphere(2.25, -8.75, 2.35, 0.3, m.wood, { sh: 0, sw: 0.6 })]));
  // Warteschlange: Absperrpfosten und Bänder
  const posts = [[-10, 2], [-4, 2], [2, 2], [8, 2], [8, 7.5], [2, 7.5], [-4, 7.5], [-10, 7.5]];
  posts.forEach(p => s.add(s.group([s.cyl(p[0], p[1], 0, 0.45, 0.12, m.metal, { sh: 0, sw: 0.7 }), s.cyl(p[0], p[1], 0.12, 0.08, 1.0, m.metal, { sh: 0, sw: 0.6 }), s.sphere(p[0], p[1], 1.2, 0.16, m.accent, { sh: 0, sw: 0.6, flat: true })])));
  const belt = (a, b) => s.line([s.P(a[0], a[1], 1.05), s.P(b[0], b[1], 1.05)], { stroke: pal.accent, sw: 2.6, cap: 'round' });
  s.add({ svg: belt(posts[0], posts[1]) + belt(posts[1], posts[2]) + belt(posts[2], posts[3]) + belt(posts[3], posts[4]) + belt(posts[4], posts[5]) + belt(posts[5], posts[6]) + belt(posts[6], posts[7]), bbox: [-10, 2, 1, 8, 7.5, 1.1], sh: 0 });
  // Reisende
  const cols = [m.type('stay'), m.type('rail'), m.type('activity'), m.type('transfer'), m.type('car')];
  const q = [[-8, 4.5], [-5.5, 5.0], [-1, 3.4], [4, 4.8], [6.5, 3.4], [-6.5, 9.5]];
  q.forEach((p, i) => { s.add(P.person(s, p[0], p[1], 0, { shirt: cols[i % cols.length] })); if (i % 2 === 0) s.add(P.suitcase(s, p[0] + 0.8, p[1] - 0.1, 0, 0.8, 0.5, 0.7, cols[(i + 2) % cols.length])); });
  // Bodenmarkierung
  const gf = s.frame([-12, 12.4, 0.03], [1, 0, 0], [0, -1, 0], 1, 1);
  s.add({ svg: s.fRect(gf, 0, 0, 22, 1.2, { fill: pal.type.stay, stroke: null }) + s.fText(gf, 'BITTE WARTEN', 11, 0.28, 0.65, { align: 'center', stroke: pal.ink, sw: 1.3 }), bbox: [-12, 11.2, 0.03, 10, 12.4, 0.03], sh: 0 }, 'ground');
  // Grosser Pass als Hinweis
  const pw = 3.8, ph = 5.2, px = 12.5, py = 8;
  const pass = T.cutout(s, [[px, 0.6], [px + pw, 0.6], [px + pw, 0.6 + ph], [px, 0.6 + ph]], py, 0.45, m.type('doc'), { sw: 1.2, sh: 0.4 });
  const pf = s.frame([0, py, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  pass.svg += s.fCircle(pf, px + pw / 2, 4.4, 1.15, { fill: 'none', stroke: pal.surface, sw: 1.4 }, 20);
  pass.svg += s.fLine(pf, [[px + pw / 2 - 1.15, 4.4], [px + pw / 2 + 1.15, 4.4]], { stroke: pal.surface, sw: 1 });
  pass.svg += s.fLine(pf, [[px + pw / 2, 3.25], [px + pw / 2, 5.55]], { stroke: pal.surface, sw: 1 });
  pass.svg += s.fText(pf, 'PASS', px + pw / 2, 1.6, 0.55, { align: 'center', stroke: pal.surface, sw: 1.2 });
  s.add(s.group([s.box(px + 0.6, py - 1.1, 0, 2.6, 1.6, 0.6, m.stone, { sh: 0, sw: 0.8 })]));
  s.add(pass);
  s.add(P.lamp(s, -17, 12, 0, 6)); s.add(T.plant(s, 17, -12, 0, 2.2)); s.add(T.plant(s, -16, -10, 0, 2.2));
  // --- Verdichtung: Flaggen, E-Gates, Röntgengerät, Hängeschild, Kamera
  s.add(SC.flagPole(s, -17.2, -14.2, 0, 9.0, m.accent));
  s.add(SC.flagPole(s, -17.2, -10.8, 0, 9.0, m.type('ship')));
  for (const gx of [9, 13]) {
    s.add(s.box(gx, -7, 0, 1.0, 3.6, 1.3, m.type('safety'), { sw: 1, sh: 0.5 }));
    s.add(s.box(gx + 0.1, -5.6, 1.3, 0.2, 1.2, 1.3, m.glass, { sw: 0.8, sh: 0 }));
    s.add(s.box(gx + 0.1, -7.3, 1.3, 0.8, 0.5, 0.3, m.lit, { sw: 0.6, sh: 0 }));
  }
  s.add(s.box(9.4, -4.4, 1.3, 0.4, 0.3, 0.1, m.accent, { sw: 0.5, sh: 0 }));
  s.add(s.group([
    s.box(9, -1.0, 0, 8, 3.0, 2.4, m.type('doc'), { sw: 1, sh: 0.5, decor: (f, sc) => sc.fRect(f.L, 0.4, 0.2, 7.6, 1.6, { fill: m.ink.left, stroke: null }) + sc.fRect(f.L, 0.4, 1.9, 7.6, 2.1, { fill: pal.accent, stroke: null }) }),
    s.box(5.6, -0.6, 0, 3.0, 2.2, 0.7, m.metal, { sw: 0.9, sh: 0 }),
    P.suitcase(s, 6.0, -0.3, 0.7, 1.2, 0.8, 0.9, m.type('stay')), P.suitcase(s, 7.5, -0.2, 0.7, 1.0, 0.7, 0.8, m.type('car'))]));
  s.add(P.person(s, 11.5, 3.2, 0, { shirt: m.ink, jacket: m.ink, h: 1.85, hat: true, hatMat: m.ink, skin: 2 }));
  // Hängeschild
  const hs = [s.box(-6.4, 10.6, 0, 0.3, 0.3, 7.4, m.metal, { sw: 0.8, sh: 0 }), s.box(4.4, 10.6, 0, 0.3, 0.3, 7.4, m.metal, { sw: 0.8, sh: 0 }),
    s.box(-6.4, 10.5, 6.2, 11.2, 0.4, 1.8, m.accent, { sw: 1, sh: 0.3, decor: (f, sc) => sc.fText(f.L, 'EINREISE', 5.6, 0.5, 0.8, { align: 'center', stroke: pal.onAccent, sw: 1.6 }) })];
  s.add(s.group(hs, [-6.4, 10.4, 0, 4.8, 11, 8]));
  s.add(s.group([s.cyl(-13, -8, 0, 0.1, 5.0, m.metal, { sh: 0, sw: 0.6, steps: 8 }), s.dome(-13, -8, 5.0, 0.7, m.ink, { sh: 0 })]));
  s.add(s.group([s.box(-14, 5.6, 0.3, 1.8, 1.1, 0.1, m.metal, { sh: 0, sw: 0.7 }), s.box(-13.9, 5.65, 0.4, 0.1, 0.1, 1.4, m.metal, { sh: 0, sw: 0.5 }), P.suitcase(s, -13.8, 5.7, 0.4, 1.2, 0.8, 0.9, m.type('ship'))]));
  s.add(P.person(s, -1.8, 8.4, 0, { shirt: m.type('stay'), h: 1.8, bag: 'backpack', skin: 3 }));
  s.add(P.person(s, 0.2, 8.0, 0, { shirt: m.type('car'), h: 1.6, skirt: true, pants: m.type('rail'), hairI: 2 }));
  s.add(P.person(s, -0.8, 7.0, 0, { shirt: m.type('activity'), h: 1.1, skin: 1 }));
}

// ---------------------------------------------------------------- Aufgabe
function aufgabe(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -18, -14, 18, 14, { th: 1.3, grid: 4 });
  // Pinnwand-Rückwand
  s.add(s.box(-16, -13, 0, 30, 0.5, 8.5, m.paper, {
    sw: 1,
    decor: (f, sc) => {
      let r = sc.fRect(f.L, 1.5, 3.2, 28.5, 8.0, { fill: m.wood.left, stroke: L, sw: 1 });
      const notes = [[3, 4.4, 'stay'], [8.4, 5.5, 'ship'], [14, 4.2, 'car'], [19.4, 5.2, 'transfer'], [24.4, 4.4, 'activity']];
      notes.forEach(n => { r += sc.fRect(f.L, n[0], n[1], n[0] + 3.4, n[1] + 2.4, { fill: m.soft(n[2]).left, stroke: L, sw: 0.8 }); for (let i = 0; i < 3; i++) r += sc.fLine(f.L, [[n[0] + 0.4, n[1] + 0.5 + i * 0.6], [n[0] + 2.6 - (i % 2) * 0.6, n[1] + 0.5 + i * 0.6]], { stroke: pal.mute, sw: 0.9, cap: 'round' }); r += sc.fCircle(f.L, n[0] + 1.7, n[1] + 2.2, 0.17, { fill: pal.accent, stroke: L, sw: 0.5 }, 8); });
      return r;
    },
  }));
  // Schreibtisch
  const dk = [];
  dk.push(s.box(-14, -9, 3.6, 28, 9, 0.5, m.wood, { sw: 1 }));
  for (const [lx, ly] of [[-13.4, -8.4], [12.8, -8.4], [-13.4, -1.0], [12.8, -1.0]]) dk.push(s.box(lx, ly, 0, 0.6, 0.6, 3.6, m.wood, { sw: 0.9, sh: 0 }));
  dk.push(s.box(7, -8.6, 0.8, 5.6, 7.6, 2.8, m.wood, { sw: 0.9, sh: 0, decor: (f, sc) => sc.fLine(f.L, [[0, 1.4], [5.6, 1.4]], { stroke: m.wood.line, sw: 0.8 }) + sc.fLine(f.L, [[0, 0.8], [5.6, 0.8]], { stroke: m.wood.line, sw: 0.0 }) + sc.fLine(f.L, [[2.4, 2.1], [3.2, 2.1]], { stroke: m.wood.line, sw: 1.3, cap: 'round' }) + sc.fLine(f.L, [[2.4, 0.7], [3.2, 0.7]], { stroke: m.wood.line, sw: 1.3, cap: 'round' }) }));
  s.add(s.group(dk, [-14, -9, 0, 14, 0, 4.1]));
  const tz = 4.1;
  // Klemmbrett gross, an Notebook gelehnt
  const cb = s.box(-11, -5.6, tz, 9.6, 0.5, 11.2, m.wood, { sw: 1, sh: 0 });
  s.add(cb);
  const pp = s.box(-10.3, -5.1, tz + 0.7, 8.2, 0.12, 9.4, m.card, {
    sw: 0.9, sh: 0,
    decor: (f, sc) => {
      let r = sc.fRect(f.L, 2.2, 8.9, 6.0, 9.5, { fill: m.metal.right, stroke: L, sw: 0.9 });
      const rows = 5;
      for (let i = 0; i < rows; i++) {
        const v = 7.4 - i * 1.55;
        r += sc.fRect(f.L, 0.7, v, 1.5, v + 0.8, { fill: i < 3 ? 'none' : 'none', stroke: L, sw: 1.1 });
        if (i < 3) r += sc.fLine(f.L, [[0.85, v + 0.35], [1.1, v + 0.1], [1.65, v + 0.95]], { stroke: pal.positive, sw: 2.2, cap: 'round' });
        r += sc.fLine(f.L, [[2.2, v + 0.4], [2.2 + 3.6 - (i % 3) * 0.6, v + 0.4]], { stroke: i < 3 ? pal.mute : pal.ink, sw: 1.5, cap: 'round' });
        r += sc.fLine(f.L, [[2.2, v + 0.0], [2.2 + 2.2 - (i % 2) * 0.5, v + 0.0]], { stroke: pal.mute, sw: 1, cap: 'round', sop: 0.7 });
      }
      return r;
    },
  });
  s.add(pp);
  // Notebook
  s.add(s.group([s.box(2, -4, tz, 5, 3.6, 0.2, m.metal, { sh: 0, sw: 0.9, decor: (f, sc) => sc.fRect(f.T, 0.5, 0.4, 4.5, 1.3, { fill: m.ink.left, stroke: null }) }),
    s.box(2, -4, tz + 0.2, 5, 0.18, 3.3, m.metal, { sh: 0, sw: 0.9, decor: (f, sc) => sc.fRect(f.L, 0.25, 0.25, 4.75, 3.05, { fill: m.glass.top, stroke: null }) + sc.fLine(f.L, [[0.8, 2.4], [3.4, 2.4]], { stroke: pal.mute, sw: 1.2, cap: 'round' }) + sc.fLine(f.L, [[0.8, 1.7], [4.0, 1.7]], { stroke: pal.mute, sw: 1.2, cap: 'round' }) }),
  ]));
  // Becher, Stifte, Ordner, Pflanze, Lampe
  s.add(s.group([s.cyl(9.5, -3.5, tz, 0.55, 1.0, m.type('transfer'), { sh: 0, sw: 0.8 }), s.cyl(9.3, -3.5, tz + 1.0, 0.04, 1.2, m.accent, { sh: 0, sw: 0.5 }), s.cyl(9.7, -3.4, tz + 1.0, 0.04, 1.0, m.ink, { sh: 0, sw: 0.5 })]));
  s.add(T.sheet(s, 5.5, -1.2, tz, 3.0, 2.2, { lines: 4 }));
  s.add(s.box(10.4, -1.5, tz, 1.8, 2.4, 0.5, m.type('rail'), { sh: 0, sw: 0.8 }));
  s.add(s.box(10.4, -1.5, tz + 0.5, 1.8, 2.4, 0.5, m.type('stay'), { sh: 0, sw: 0.8 }));
  s.add(T.plant(s, -12.4, -4.4, tz, 2.0));
  s.add(s.group([s.box(7.2, -6.5, tz, 1.2, 1.2, 0.2, m.ink, { sh: 0, sw: 0.7 }), s.cyl(7.8, -5.9, tz + 0.2, 0.08, 2.4, m.metal, { sh: 0, sw: 0.6 }), s.frustum(8.4, -5.9, tz + 2.2, 1.6, 1.0, 0.7, 0.5, 0.8, m.lit, { sh: 0, sw: 0.7 })]));
  // Bürostuhl (davor) und Person
  s.add(s.group([s.box(-4.5, 1.5, 1.7, 3.0, 3.0, 0.3, m.ink, { sh: 0, sw: 0.8 }), s.cyl(-3, 3, 0, 0.18, 1.7, m.metal, { sh: 0, sw: 0.6 }), s.box(-4.5, 4.4, 2.0, 3.0, 0.3, 2.6, m.ink, { sh: 0, sw: 0.8 })]));
  s.add(P.person(s, 8, 6, 0, { shirt: m.accent, h: 1.8 }));
  // Bodenteppich, Papierkorb, Papierstapel
  s.add(T.rug(s, -10, 0.5, 14, 8, 0.02));
  s.add(s.cyl(12.5, 6, 0, 0.8, 1.4, m.metal, { sw: 0.8 }));
  s.add(T.plant(s, -15, 10, 0, 2.4));
  // --- Verdichtung: Raumecke mit Fenster, Regal, Schrank, Uhr
  s.add(s.box(-18, -14, 0, 0.5, 28, 8.5, m.paper, { sw: 1, decor: (f, sc) => sc.windows(f.R, 3, 2.6, 9, 7.4, 2, 1, { inset: 0.1, mullion: true }) + sc.windows(f.R, 14, 2.6, 20, 7.4, 2, 1, { inset: 0.1, mullion: true }) }));
  s.add(SC.bookshelf(s, 10, 7, 0, 6, 5.4, 1.2, 4));
  s.add(SC.cabinet(s, -14, 8.5, 0, 3.4, 2.0, 3.6, 3));
  s.add(s.box(-13.6, 8.9, 3.6, 2.2, 1.4, 0.8, m.white, { sw: 0.9, sh: 0.2 }));
  s.add(T.clockFace(s, 7.5, -12.4, 6.6, 1.5, 10, 10));
  s.add(P.lamp(s, -15, -3, 0, 6.5));
  s.add(s.group([s.cyl(15.5, -10, 0, 0.12, 6.0, m.metal, { sh: 0, sw: 0.7, steps: 8 }), s.box(14.6, -10.1, 5.2, 1.8, 0.2, 0.15, m.metal, { sh: 0, sw: 0.6 })]));
  s.add(P.person(s, -6.5, -9.2, 0, { shirt: m.type('ship'), jacket: m.type('ship'), h: 1.8, skin: 1, hairI: 1 }));
  s.add(SC.officeChair(s, 3.0, 3.0, 0, m.type('rail')));
}

module.exports = [
  def('type-Restaurant', 'Restaurant', 'Isometrische Darstellung eines Restaurants mit gestreiftem Sonnensegel, Terrasse mit gedeckten Tischen und Sonnenschirmen, Gästen, Servicekraft, Menütafel und Lichterkette.',
    'event-type:Restaurant', restaurant, {}),
  def('type-Veranstaltung', 'Veranstaltung', 'Isometrische Darstellung einer Konzertbühne mit Lichtkegeln, Lautsprechern und Publikum hinter einer Absperrung; im Vordergrund ein grosses Eintrittsticket auf einem Ständer.',
    'event-type:Veranstaltung', veranstaltung, {}),
  def('type-Versicherung', 'Versicherung', 'Isometrische Darstellung eines grossen Schirms über einem Sockel mit Haus, Auto, Koffern und Familie, davor ein Schutzschild mit Haken.',
    'event-type:Versicherung', versicherung, {}),
  def('type-Visum', 'Visum / Einreise', 'Isometrische Darstellung einer Passkontrolle: Schalter mit Glasscheibe, Pass und Stempel auf dem Tresen, Warteschlange mit Absperrbändern und Reisenden, Stempelabdruck mit Datum an der Wand, grosser Pass als Hinweis.',
    'event-type:Visum', visum, {}),
  def('type-Aufgabe', 'Aufgabe', 'Isometrische Darstellung eines Schreibtischs mit grossem Klemmbrett und Checkliste, Notebook, Pinnwand mit farbigen Notizzetteln, Pflanze, Lampe und Bürostuhl.',
    'event-type:Aufgabe', aufgabe, {}),
];
