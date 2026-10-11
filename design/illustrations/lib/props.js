'use strict';
// Wiederverwendbare Bausteine: Figuren, Gepäck, Pflanzen, Fahrzeuge, Flugzeug, Fluggastbrücke.
const { mix } = require('./util');

const { tones } = require('./palette');

/** Hauttöne (aus der Palette gemischt). */
function skinTone(s, i = 0) {
  const pal = s.pal, T = pal.type;
  const bases = [mix(T.activity, pal.surface, 0.55), mix(T.activity, pal.surface2, 0.35), mix(T.food, pal.surface, 0.45), mix(T.activity, pal.ink, pal.name === 'light' ? 0.18 : 0.0)];
  return tones(pal, pal.name === 'light' ? bases[i % 4] : mix(bases[i % 4], pal.bg, 0.25), { lift: 0.25 });
}
const HAIR = ['ink', 'wood', 'mute', 'accent'];

/**
 * Gegliederte Figur (Kopf, Hals, Torso, Arme, Beine, Schuhe), Blick zum Betrachter (+y).
 * o: h, shirt, pants, jacket, hair, skin (0..3), bag ('backpack'|'shoulder'|'case'), hat, skirt, lod (0 = einfach).
 */
function person(s, x, y, z = 0, o = {}) {
  const m = s.m, pal = s.pal;
  const k = (o.h || 1.75) * 1.6, sc = k / 1.75;
  const lod = o.lod != null ? o.lod : (s.personLod != null ? s.personLod : 1);
  const shirt = o.shirt || m.type('rail'), pants = o.pants || m.ink;
  const skin = o.skinMat || skinTone(s, o.skin || 0);
  const hair = o.hair || m[HAIR[(o.hairI || 0) % 4]] || m.ink;
  const P_ = [];
  const sw = 0.7;
  const ls = 0.19 * sc;
  if (lod === 0) {
    P_.push(s.box(x - 0.2 * sc, y - 0.1 * sc, z, 0.4 * sc, 0.2 * sc, 0.8 * sc, pants, { sh: 0, sw }));
    P_.push(s.frustum(x, y, z + 0.8 * sc, 0.5 * sc, 0.3 * sc, 0.6 * sc, 0.34 * sc, 0.62 * sc, shirt, { sh: 0, sw }));
    P_.push(s.sphere(x, y, z + 1.62 * sc, 0.16 * sc, skin, { sh: 0, sw, flat: true }));
    P_.push(s.sphere(x - 0.02 * sc, y - 0.05 * sc, z + 1.69 * sc, 0.15 * sc, hair, { sh: 0, sw: 0.5, flat: true }));
  } else {
    const legH = (o.skirt ? 0.5 : 0.82) * sc;
    // Beine und Schuhe
    P_.push(s.box(x - 0.2 * sc, y - 0.09 * sc, z + 0.08 * sc, ls, 0.19 * sc, legH - 0.08 * sc + (o.skirt ? 0.3 * sc : 0), o.skirt ? skin : pants, { sh: 0, sw }));
    P_.push(s.box(x + 0.01 * sc, y - 0.09 * sc, z + 0.08 * sc, ls, 0.19 * sc, legH - 0.08 * sc + (o.skirt ? 0.3 * sc : 0), o.skirt ? skin : pants, { sh: 0, sw }));
    P_.push(s.box(x - 0.21 * sc, y - 0.09 * sc, z, 0.21 * sc, 0.3 * sc, 0.09 * sc, m.ink, { sh: 0, sw: 0.6 }));
    P_.push(s.box(x + 0.0 * sc, y - 0.09 * sc, z, 0.21 * sc, 0.3 * sc, 0.09 * sc, m.ink, { sh: 0, sw: 0.6 }));
    if (o.skirt) P_.push(s.frustum(x, y, z + 0.5 * sc, 0.46 * sc, 0.3 * sc, 0.56 * sc, 0.34 * sc, 0.4 * sc, o.pants || shirt, { sh: 0, sw }));
    const tz = z + (o.skirt ? 0.88 : 0.82) * sc;
    if (o.bag === 'backpack') P_.push(s.box(x - 0.2 * sc, y - 0.42 * sc, tz + 0.1 * sc, 0.4 * sc, 0.26 * sc, 0.5 * sc, o.bagMat || m.type('activity'), { sh: 0, sw }));
    // Torso (Schulter breiter als Taille), Jacke optional
    const torso = o.jacket || shirt;
    P_.push(s.frustum(x, y, tz, 0.44 * sc, 0.28 * sc, 0.58 * sc, 0.32 * sc, 0.64 * sc, torso, { sh: 0, sw }));
    if (o.jacket) P_.push(s.box(x - 0.1 * sc, y + 0.12 * sc, tz + 0.1 * sc, 0.2 * sc, 0.06 * sc, 0.5 * sc, shirt, { sh: 0, sw: 0.4 }));
    // Arme
    const arm = o.jacket || shirt;
    P_.push(s.box(x - 0.38 * sc, y - 0.08 * sc, tz + 0.02 * sc, 0.12 * sc, 0.16 * sc, 0.56 * sc, arm, { sh: 0, sw: 0.6 }));
    P_.push(s.box(x + 0.26 * sc, y - 0.08 * sc, tz + 0.02 * sc, 0.12 * sc, 0.16 * sc, 0.56 * sc, arm, { sh: 0, sw: 0.6 }));
    P_.push(s.box(x - 0.37 * sc, y - 0.06 * sc, tz - 0.08 * sc, 0.1 * sc, 0.12 * sc, 0.1 * sc, skin, { sh: 0, sw: 0.4 }));
    P_.push(s.box(x + 0.27 * sc, y - 0.06 * sc, tz - 0.08 * sc, 0.1 * sc, 0.12 * sc, 0.1 * sc, skin, { sh: 0, sw: 0.4 }));
    if (o.bag === 'shoulder') P_.push(s.box(x + 0.28 * sc, y - 0.12 * sc, tz - 0.2 * sc, 0.12 * sc, 0.34 * sc, 0.34 * sc, o.bagMat || m.accent, { sh: 0, sw: 0.6 }));
    // Hals, Kopf, Haar, Hut
    P_.push(s.cyl(x, y, tz + 0.64 * sc, 0.06 * sc, 0.12 * sc, skin, { sh: 0, sw: 0.4, steps: 8 }));
    P_.push(s.sphere(x, y, z + 1.62 * sc, 0.17 * sc, skin, { sh: 0, sw: 0.7, flat: lod === 0 }));
    P_.push(s.sphere(x - 0.02 * sc, y - 0.06 * sc, z + 1.69 * sc, 0.16 * sc, hair, { sh: 0, sw: 0.5, flat: true }));
    if (o.hat) P_.push(s.frustum(x, y, z + 1.76 * sc, 0.4 * sc, 0.4 * sc, 0.26 * sc, 0.26 * sc, 0.16 * sc, o.hatMat || m.accent, { sh: 0, sw: 0.5 }));
  }
  const g = s.group(P_, [x - 0.45 * sc, y - 0.45 * sc, z, x + 0.45 * sc, y + 0.3 * sc, z + k]);
  g.fp = [[x - 0.3, y - 0.2], [x + 0.3, y - 0.2], [x + 0.3, y + 0.2], [x - 0.3, y + 0.2]];
  g.sh = k * 0.9;
  return g;
}

function suitcase(s, x, y, z, w, d, h, mat, o = {}) {
  const P = [];
  P.push(s.box(x, y, z + 0.1, w, d, h, mat, {
    sh: 0, sw: 0.9,
    decor: (f, sc) => {
      let r = '';
      const n = Math.max(2, Math.round(w / 0.28));
      for (let i = 1; i < n; i++) r += sc.fLine(f.L, [[w * i / n, 0.1], [w * i / n, h - 0.1]], { stroke: mat.line, sw: 0.6, sop: 0.55 });
      return r;
    },
  }));
  P.push(s.box(x + w * 0.3, y + d * 0.35, z + 0.1 + h, w * 0.4, 0.05, 0.12, s.m.ink, { sh: 0, sw: 0.6 }));
  P.push(s.box(x + 0.1, y + 0.05, z, 0.1, 0.1, 0.1, s.m.ink, { sh: 0, sw: 0.5 }));
  P.push(s.box(x + w - 0.2, y + 0.05, z, 0.1, 0.1, 0.1, s.m.ink, { sh: 0, sw: 0.5 }));
  const g = s.group(P, [x, y, z, x + w, y + d, z + h + 0.25]);
  g.sh = o.sh != null ? o.sh : 0;
  return g;
}

function cone(s, x, y, z = 0) {
  const P = [];
  P.push(s.box(x - 0.3, y - 0.3, z, 0.6, 0.6, 0.06, s.m.ink, { sh: 0, sw: 0.6 }));
  P.push(s.frustum(x, y, z + 0.06, 0.4, 0.4, 0.1, 0.1, 0.6, s.m.accent, { sw: 0.7 }));
  return s.group(P, [x - 0.3, y - 0.3, z, x + 0.3, y + 0.3, z + 0.7]);
}

function tree(s, x, y, z, h, o = {}) {
  const m = s.m, P = [];
  const r = (o.r || h * 0.32);
  P.push(s.cyl(x, y, z, 0.12 * h / 3, h * 0.45, m.wood, { sw: 0.8, sh: 0 }));
  P.push(s.sphere(x, y, z + h * 0.62, r, o.mat || m.green, { sh: 0, sw: 0.9 }));
  if (o.two) P.push(s.sphere(x + r * 0.6, y - r * 0.5, z + h * 0.8, r * 0.7, o.mat2 || m.green2, { sh: 0, sw: 0.9 }));
  const g = s.group(P, [x - r, y - r, z, x + r, y + r, z + h]);
  g.sh = h * 0.8;
  g.fp = [[x - r * 0.5, y - r * 0.5], [x + r * 0.5, y - r * 0.5], [x + r * 0.5, y + r * 0.5], [x - r * 0.5, y + r * 0.5]];
  return g;
}
function conifer(s, x, y, z, h, o = {}) {
  const m = s.m, P = [];
  const w = o.w || h * 0.42;
  P.push(s.cyl(x, y, z, 0.1 * h / 3, h * 0.2, m.wood, { sw: 0.7, sh: 0 }));
  const tiers = o.tiers || 3;
  for (let i = 0; i < tiers; i++) {
    const t0 = z + h * 0.15 + (i * h * 0.85) / tiers;
    const rr = w * (1 - (i * 0.8) / tiers);
    P.push(s.tube('z', t0, t0 + (h * 0.85) / tiers * 1.5, x, y, rr, 0.02, i % 2 ? m.green2 : m.green, { sw: 0.8, noCap: true, sh: 0, steps: 24 }));
  }
  const g = s.group(P, [x - w, y - w, z, x + w, y + w, z + h]);
  g.sh = h * 0.8; g.fp = [[x - w * 0.5, y - w * 0.5], [x + w * 0.5, y - w * 0.5], [x + w * 0.5, y + w * 0.5], [x - w * 0.5, y + w * 0.5]];
  return g;
}
function bush(s, x, y, z, r, o = {}) {
  const P = [s.sphere(x, y, z + r * 0.8, r, o.mat || s.m.green, { sh: 0, sw: 0.8 })];
  if (o.two !== false) P.push(s.sphere(x + r * 0.9, y + r * 0.2, z + r * 0.6, r * 0.7, o.mat2 || s.m.green2, { sh: 0, sw: 0.8 }));
  const g = s.group(P, [x - r, y - r, z, x + r * 1.7, y + r, z + r * 1.8]);
  g.sh = r;
  return g;
}
function palm(s, x, y, z, h, o = {}) {
  const m = s.m, pal = s.pal;
  // Stamm als gebogene Linie, Wedel als flache Blätter (Bildschirmraum)
  const lean = o.lean || [0.5, -0.3];
  const top = [x + lean[0] * h * 0.3, y + lean[1] * h * 0.3, z + h];
  const mid = [x + lean[0] * h * 0.1, y + lean[1] * h * 0.1, z + h * 0.55];
  const a = s.P(x, y, z), b = s.P(...mid), c = s.P(...top);
  let svg = '';
  svg += s.path(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${b[0].toFixed(1)} ${b[1].toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`, { stroke: m.wood.right, sw: Math.max(3, h * 0.35), cap: 'round', fill: 'none' });
  svg += s.path(`M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${b[0].toFixed(1)} ${b[1].toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`, { stroke: m.wood.left, sw: Math.max(1.5, h * 0.18), cap: 'round', fill: 'none' });
  const L = h * s.k * 0.55;
  const fronds = o.fronds || 7;
  for (let i = 0; i < fronds; i++) {
    const ang = (-Math.PI * 0.95) + (i * Math.PI * 1.9) / (fronds - 1);
    const dx = Math.cos(ang), dy = Math.sin(ang) * 0.5;
    const ex = c[0] + dx * L, ey = c[1] + dy * L + L * 0.35 * (1 - Math.abs(dy) * 1);
    const mx = c[0] + dx * L * 0.5, my = c[1] + dy * L * 0.5 - L * 0.28;
    const px = -dy * L * 0.13, py = dx * L * 0.13;
    const d = `M${c[0].toFixed(1)} ${c[1].toFixed(1)}Q${(mx + px).toFixed(1)} ${(my + py).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}Q${(mx - px).toFixed(1)} ${(my - py).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}Z`;
    svg += s.path(d, { fill: i % 2 ? m.green.left : m.green2.left, stroke: m.green.line, sw: 0.8 });
  }
  svg += s.circle(c[0], c[1], 2.2, { fill: m.wood.right, stroke: m.wood.line, sw: 0.7 });
  return { svg, bbox: [x - 1, y - 1, z, x + 3, y + 3, z + h + 1], sh: 0 };
}
function lamp(s, x, y, z = 0, h = 3.2) {
  const m = s.m, P = [];
  P.push(s.cyl(x, y, z, 0.07, h, m.ink, { sw: 0.7, sh: 0 }));
  P.push(s.box(x - 0.25, y - 0.1, z + h, 0.5, 0.2, 0.1, m.lit, { sw: 0.7, sh: 0 }));
  const g = s.group(P, [x - 0.3, y - 0.2, z, x + 0.3, y + 0.2, z + h + 0.2]);
  g.sh = h * 0.5;
  return g;
}
function bench(s, x, y, z = 0, w = 1.6, axis = 'x') {
  const m = s.m, P = [];
  if (axis === 'x') {
    P.push(s.box(x, y, z + 0.4, w, 0.45, 0.07, m.wood, { sh: 0, sw: 0.7 }));
    P.push(s.box(x, y - 0.05, z + 0.47, w, 0.07, 0.4, m.wood, { sh: 0, sw: 0.7 }));
    P.push(s.box(x + 0.1, y + 0.05, z, 0.07, 0.35, 0.4, m.ink, { sh: 0, sw: 0.6 }));
    P.push(s.box(x + w - 0.17, y + 0.05, z, 0.07, 0.35, 0.4, m.ink, { sh: 0, sw: 0.6 }));
    return s.group(P, [x, y - 0.05, z, x + w, y + 0.45, z + 0.9]);
  }
  P.push(s.box(x, y, z + 0.4, 0.45, w, 0.07, m.wood, { sh: 0, sw: 0.7 }));
  P.push(s.box(x - 0.05, y, z + 0.47, 0.07, w, 0.4, m.wood, { sh: 0, sw: 0.7 }));
  P.push(s.box(x + 0.05, y + 0.1, z, 0.35, 0.07, 0.4, m.ink, { sh: 0, sw: 0.6 }));
  P.push(s.box(x + 0.05, y + w - 0.17, z, 0.35, 0.07, 0.4, m.ink, { sh: 0, sw: 0.6 }));
  return s.group(P, [x - 0.05, y, z, x + 0.45, y + w, z + 0.9]);
}

/** Rad (Achse y) */
function wheel(s, x, y, z, r, w, o = {}) {
  return s.tube('y', y, y + w, x, z, r, r, s.m.ink, { sw: 0.7, sh: 0, steps: 20, capFill: o.hub || s.m.metal.left });
}

function bagCart(s, x, y, z = 0, o = {}) {
  const m = s.m, P = [];
  const w = o.w || 3.4, d = o.d || 1.9;
  P.push(s.box(x, y, z + 0.45, w, d, 0.16, m.metal, { sh: 0, sw: 0.8 }));
  P.push(wheel(s, x + 0.55, y + d - 0.05, z + 0.25, 0.25, 0.14));
  P.push(wheel(s, x + w - 0.55, y + d - 0.05, z + 0.25, 0.25, 0.14));
  P.push(s.box(x + 0.05, y + 0.05, z + 0.61, w - 0.1, d - 0.1, 0.05, m.ink, { sh: 0, sw: 0.5 }));
  const cols = [m.type('rail'), m.type('stay'), m.type('car'), m.type('transfer'), m.type('activity'), m.type('ship')];
  let i = (o.seed || 0);
  const bag = (bx, by, bz, bw, bd, bh) => { P.push(suitcase(s, bx, by, bz, bw, bd, bh, cols[(i++) % cols.length])); };
  bag(x + 0.2, y + 0.2, z + 0.66, 1.0, 0.7, 0.55);
  bag(x + 1.35, y + 0.15, z + 0.66, 0.85, 0.6, 0.7);
  bag(x + 2.35, y + 0.25, z + 0.66, 0.9, 0.7, 0.5);
  bag(x + 0.35, y + 1.0, z + 0.66, 1.1, 0.7, 0.45);
  bag(x + 1.7, y + 1.0, z + 0.66, 0.8, 0.7, 0.6);
  bag(x + 0.55, y + 1.0 + 0.0, z + 1.11, 0.8, 0.55, 0.4);
  const g = s.group(P, [x, y, z, x + w, y + d, z + 1.7]);
  g.sh = 1.0;
  return g;
}

function tug(s, x, y, z = 0, o = {}) {
  const m = s.m, P = [];
  const col = o.mat || m.type('car');
  P.push(wheel(s, x + 0.5, y + 1.25, z + 0.3, 0.3, 0.2));
  P.push(wheel(s, x + 1.9, y + 1.25, z + 0.3, 0.3, 0.2));
  P.push(s.box(x, y, z + 0.25, 2.6, 1.3, 0.55, col, { sh: 0, sw: 0.9 }));
  P.push(s.box(x + 0.9, y + 0.05, z + 0.8, 1.3, 1.2, 0.9, col, {
    sh: 0, sw: 0.9,
    decor: (f, sc) => sc.fRect(f.L, 0.12, 0.2, 1.18, 0.78, { fill: m.glass.left, stroke: m.glass.line, sw: 0.7 }) + sc.fRect(f.R, 0.15, 0.2, 1.05, 0.78, { fill: m.glass.right, stroke: m.glass.line, sw: 0.7 }),
  }));
  P.push(s.box(x + 0.9, y + 0.05, z + 1.7, 1.3, 1.2, 0.08, m.ink, { sh: 0, sw: 0.6 }));
  P.push(s.box(x + 0.0, y + 0.1, z + 0.8, 0.8, 1.1, 0.5, m.ink, { sh: 0, sw: 0.6 }));
  const g = s.group(P, [x, y, z, x + 2.6, y + 1.3, z + 1.8]);
  g.sh = 1.2;
  return g;
}

/** Verkehrsflugzeug. Nase zeigt nach -x; sichtbar ist die Steuerbordseite (+y). Mitte (cx,cy), Bodenhöhe z. */
function airliner(s, cx, cy, o = {}) {
  const m = s.m, pal = s.pal;
  const body = o.body || m.white, wingM = o.wing || m.metal, acc = o.accent || m.accent;
  const zc = 4.4, r = 2.0, P = [];
  const wing = sg => [[cx - 2.0, cy + sg * 1.7], [cx + 6.5, cy + sg * 17.5], [cx + 9.0, cy + sg * 17.5], [cx + 7.0, cy + sg * 1.7]];
  const stab = sg => [[cx + 11.6, cy + sg * 1.2], [cx + 15.8, cy + sg * 7.0], [cx + 18.0, cy + sg * 7.0], [cx + 17.4, cy + sg * 1.2]];
  const engine = (sg) => {
    const y = cy + sg * 6.8, e = [];
    e.push(s.box(cx + 0.6, y - 0.12, zc - 1.1, 2.4, 0.24, 0.9, wingM, { sh: 0, sw: 0.8 }));
    e.push(s.tube('x', cx - 1.8, cx + 2.9, y, zc - 2.5, 1.1, 1.0, body, { sh: 0, sw: 1, capFill: m.ink.left }));
    e.push(s.tube('x', cx - 1.9, cx - 1.8, y, zc - 2.5, 0.8, 0.8, m.ink, { sh: 0, sw: 0.8, noCap: true }));
    return s.group(e, [cx - 2, y - 1.1, zc - 3.6, cx + 3, y + 1.1, zc - 1]);
  };
  // fernseite
  P.push(s.extrude(wing(-1), zc - 1.5, zc - 1.2, wingM, { sh: 0 }));
  P.push(engine(-1));
  P.push(s.extrude(stab(-1), zc + 0.6, zc + 0.8, wingM, { sh: 0 }));
  // Rumpf
  const x0 = cx - 18.5;
  const seg = [
    [x0, x0 + 1.4, 0.45, 1.05, 0], [x0 + 1.4, x0 + 3.4, 1.05, 1.6, 0], [x0 + 3.4, x0 + 5.6, 1.6, 1.95, 0],
  ];
  seg.forEach(sg => P.push(s.tube('x', sg[0], sg[1], cy, zc + sg[4], sg[2], sg[3], body, { sh: 0, steps: 30, capFill: body.left })));
  P.push(s.tube('x', cx - 12.9, cx + 9.0, cy, zc, r, r, body, { sh: 0, steps: 44, capFill: body.top }));
  P.push(s.tube('x', cx + 9.0, cx + 13.2, cy, zc + 0.15, r, 1.45, body, { sh: 0, steps: 36, capFill: body.top }));
  P.push(s.tube('x', cx + 13.2, cx + 18.0, cy, zc + 0.75, 1.45, 0.6, body, { sh: 0, steps: 30, capFill: body.left }));
  // Details auf dem Rumpf: Fensterreihe, Zierstreifen, Türen, Cockpit
  const F = s.frame([cx, cy + 1.86, zc], [1, 0, 0], [0, 0, 1], 1, 1);
  let det = '';
  det += s.fPoly(F, [[-12.9, -0.55], [9, -0.55], [9, -0.95], [-12.9, -0.95]], { fill: acc.left, stroke: null });
  det += s.fPoly(F, [[-12.9, -0.95], [13, -0.95], [14.5, -0.55], [9, -0.55]], { fill: acc.left, stroke: null, op: 0 });
  for (let u = -11.8; u < 8.4; u += 0.95) det += s.fRect(F, u, 0.55, u + 0.42, 1.05, { fill: m.glass.left, stroke: m.glass.line, sw: 0.7 });
  for (const du of [-12.5, -2.2, 5.6]) det += s.fRect(F, du, -0.8, du + 0.85, 1.55, { fill: null, stroke: body.line, sw: 0.8 });
  s.dummy = null;
  // Cockpitfenster (auf der Nase)
  const Fc = s.frame([cx - 15.7, cy + 1.42, zc], [1, 0, 0], [0, 0, 1], 1, 1);
  det += s.fPoly(Fc, [[0, 0.7], [0.7, 0.9], [1.5, 0.78], [1.4, 0.2], [0.6, 0.3]], { fill: m.ink.left, stroke: m.ink.line, sw: 0.7 });
  P.push({ svg: det, bbox: [cx - 13, cy, zc - 1, cx + 9, cy + 2, zc + 2], sh: 0 });
  // Leitwerk
  P.push(s.prismXZ([[cx + 8.6, zc + 1.7], [cx + 17.7, zc + 1.3], [cx + 17.0, zc + 8.4], [cx + 13.9, zc + 8.4]], cy - 0.14, cy + 0.14, acc, { sh: 0 }));
  P.push(s.extrude(stab(1), zc + 0.6, zc + 0.8, wingM, { sh: 0 }));
  // nahe Tragfläche und Triebwerk
  P.push(s.extrude(wing(1), zc - 1.5, zc - 1.2, wingM, { sh: 0 }));
  // Klappen-Linien (Detail) auf der nahen Tragfläche
  const wf = [wing(1)[0], wing(1)[1], wing(1)[2], wing(1)[3]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let wd = '';
  for (const t of [0.35, 0.7]) wd += s.line([s.P(...lerp(wf[3], wf[2], 0.0 + 0).concat(zc - 1.2)), s.P(...lerp(wf[3], wf[2], 0).concat(zc - 1.2))], { stroke: null });
  const tp = (u, v) => { // u entlang Spannweite 0..1, v Sehne 0..1 (0 = Vorderkante)
    const le = lerp(wf[0], wf[1], u), te = lerp(wf[3], wf[2], u);
    return s.P(le[0] + (te[0] - le[0]) * v, le[1] + (te[1] - le[1]) * v, zc - 1.2);
  };
  wd = s.line([tp(0.08, 0.72), tp(0.92, 0.78)], { stroke: wingM.line, sw: 0.7, sop: 0.8 }) + s.line([tp(0.5, 0.72), tp(0.5, 1.0)], { stroke: wingM.line, sw: 0.7, sop: 0.8 }) + s.line([tp(0.78, 0.76), tp(0.78, 1.0)], { stroke: wingM.line, sw: 0.7, sop: 0.8 });
  P.push({ svg: wd, bbox: [cx - 2, cy + 1.7, zc - 1.2, cx + 9, cy + 17.5, zc - 1.2], sh: 0 });
  P.push(engine(1));
  // Fahrwerk
  const gear = (x, y, wheels) => {
    const e = [];
    e.push(s.box(x - 0.1, y - 0.1, 0.7, 0.2, 0.2, zc - 2.1, m.metal, { sh: 0, sw: 0.7 }));
    wheels.forEach(w => e.push(wheel(s, w[0], w[1] - 0.25, 0.55, 0.55, 0.5)));
    return s.group(e, [x - 1.2, y - 0.4, 0, x + 1.2, y + 0.4, zc - 1]);
  };
  P.push(gear(cx - 12.6, cy, [[cx - 12.6, cy]]));
  P.push(gear(cx + 3.2, cy - 2.4, [[cx + 2.6, cy - 2.4], [cx + 3.9, cy - 2.4]]));
  P.push(gear(cx + 3.2, cy + 2.4, [[cx + 2.6, cy + 2.4], [cx + 3.9, cy + 2.4]]));
  const g = s.group(P, [cx - 18.5, cy - 17.5, 0, cx + 18, cy + 17.5, zc + 8.4]);
  g.sh = 0;
  // Schatten: Rumpf + Flügel auf dem Boden (niedrig, daher nur versetzt)
  s.shadowPoly([[cx - 18, cy - 1.8], [cx + 18, cy - 1.8], [cx + 18, cy + 1.8], [cx - 18, cy + 1.8]], 3.5);
  s.shadowPoly(wing(1), 3.2); s.shadowPoly(wing(-1), 3.2);
  s.shadowPoly(stab(1), 5.5); s.shadowPoly(stab(-1), 5.5);
  return g;
}

module.exports = { person, suitcase, cone, tree, conifer, bush, palm, lamp, bench, wheel, bagCart, tug, airliner };
