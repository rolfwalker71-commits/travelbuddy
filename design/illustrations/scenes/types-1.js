'use strict';
const { cropMarks, island, track, waves } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const I_ = require('../lib/icons');
const SC = require('../lib/scenery');

const def = (id, title, alt, usage, build, setup, extra = {}) => ({ id, kind: 'type', title, alt, usage, width: 1200, height: 800, build, setup, ...extra });

// ---------------------------------------------------------------- Flug
function flug(s, pal) {
  const m = s.m;
  cropMarks(s);
  island(s, -28, -34, 26, 26, { th: 1.4, grid: 4 });
  // Vorfeld-Markierungen
  const G = [];
  G.push(s.groundLine([[-30, 0], [-21, 0]], 0.01, { stroke: pal.type.stay, sw: 2.4 }));
  G.push(s.groundLine([[-21, -4], [-21, 4]], 0.01, { stroke: pal.type.air, sw: 2 }));
  G.push(s.strip([[-30, -17.5], [26, -17.5]], 3.2, 0.01, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-30, -17.5], [26, -17.5]], 0.02, { stroke: pal.surface, sw: 1.3, dash: '7 6' }));
  G.push(s.flatPoly([[8, 21], [22, 21], [22, 26], [8, 26]], 0.01, m.asphalt.top));
  G.push(s.groundLine([[8, 21], [22, 21], [22, 26], [8, 26], [8, 21]], 0.02, { stroke: pal.surface, sw: 1.1, sop: 0.9 }));
  s.add(G, 'ground');

  // Terminal (Hintergrund)
  const term = [];
  term.push(s.box(-20, -32, 0, 40, 11, 5, m.paper, {
    decor: (f, sc) => {
      let r = sc.windows(f.L, 0.8, 0.5, 39.2, 4.2, 20, 1, { inset: 0.1, mullion: true });
      r += sc.fLine(f.L, [[0, 4.6], [40, 4.6]], { stroke: pal.ink, sw: 0.8 });
      // Eingangstüren
      r += sc.fRect(f.L, 17.2, 0, 22.8, 3.4, { fill: m.glass.top, stroke: pal.ink, sw: 1 });
      r += sc.fLine(f.L, [[20, 0], [20, 3.4]], { stroke: pal.ink, sw: 0.9 });
      return r;
    },
  }));
  term.push(s.box(-19, -31, 5, 38, 8, 3.6, m.paper, {
    decor: (f, sc) => {
      let r = sc.windows(f.L, 1, 0.7, 37, 2.9, 18, 1, { inset: 0.1 });
      r += sc.fRect(f.L, 13, 0.55, 25, 3.05, { fill: pal.accent, stroke: pal.ink, sw: 1 });
      r += sc.fText(f.L, 'ABFLUG', 19, 1.05, 1.5, { align: 'center', stroke: pal.onAccent, sw: 1.6 });
      return r;
    },
  }));
  term.push(s.box(-21, -22.5, 5, 42, 3.4, 0.45, m.metal, { sw: 1 }));
  for (let i = 0; i < 8; i++) term.push(s.cyl(-19.5 + i * 5.6, -19.5, 0, 0.22, 5, m.metal, { sw: 0.8, sh: 0 }));
  term.push(s.box(-15, -29, 8.6, 6, 4, 1.1, m.metal, { sw: 0.9 }));
  term.push(s.box(-6, -29.5, 8.6, 4, 3, 0.8, m.metal, { sw: 0.9 }));
  term.push(s.box(8, -30, 8.6, 7, 5, 1.2, m.metal, { sw: 0.9 }));
  // Kontrollturm
  term.push(s.cyl(-25.5, -28, 0, 1.3, 15, m.paper, { sw: 1 }));
  term.push(s.frustum(-25.5, -28, 15, 5.2, 5.2, 3.6, 3.6, 2.2, m.glass, { sw: 1 }));
  term.push(s.box(-27.1, -29.6, 17.2, 3.2, 3.2, 0.5, m.ink, { sw: 0.9 }));
  term.push(s.cyl(-25.5, -28, 17.7, 0.08, 2.6, m.ink, { sw: 0.7, sh: 0 }));
  s.add(term);

  // Fluggastbrücke
  const jb = [];
  jb.push(s.cyl(-13, -20.5, 0, 0.3, 3.0, m.metal, { sw: 0.8, sh: 0 }));
  jb.push(s.box(-14.7, -21.4, 3.0, 3.4, 1.8, 0.4, m.ink, { sw: 0.8, sh: 0 }));
  jb.push(s.cyl(-13, -17.2, 0, 0.3, 3.0, m.metal, { sw: 0.8, sh: 0 }));
  jb.push(s.cyl(-13, -20.4, 3.0, 2.3, 3.0, m.paper, { sw: 1, sh: 0 }));
  jb.push(s.box(-14.3, -20.2, 3.4, 2.6, 15.2, 2.4, m.paper, {
    sh: 0,
    decor: (f, sc) => sc.fRect(f.R, 1.2, 0.55, 14.3, 1.7, { fill: m.glass.right, stroke: pal.ink, sw: 0.8 }) + sc.fLine(f.R, Array.from({ length: 6 }, (_, i) => [1.2 + i * 2.62, 0.55]).map((p, i) => p), { stroke: pal.ink, sw: 0.5, sop: 0 }),
  }));
  jb.push(s.frustum(-13, -4.4, 3.5, 3.0, 2.6, 3.4, 3.0, 2.8, m.accent, { sw: 1, sh: 0 }));
  jb.push(s.box(-14.4, -23.2, 3.0, 2.8, 2.2, 3.2, m.paper, { sw: 1, sh: 0 }));
  s.add(s.group(jb, [-15, -24, 0, -11, -2, 6.4]), 'obj');

  s.add(P.airliner(s, 0, 0));

  // Gepäckzug
  const bx = -9, by = 18;
  s.add(P.tug(s, bx, by, 0));
  s.add(P.bagCart(s, bx + 3.2, by - 0.3, 0, { seed: 0 }));
  s.add(P.bagCart(s, bx + 7.0, by - 0.3, 0, { seed: 3 }));
  s.add(P.bagCart(s, bx + 10.8, by - 0.3, 0, { seed: 1 }));
  // Treppe, Kegel, Personen
  s.add(P.cone(s, -24, 4)); s.add(P.cone(s, -24, -4)); s.add(P.cone(s, 3, 19));
  s.add(P.person(s, 12, 23, 0, { shirt: m.type('ship') }));
  s.add(P.person(s, 14.2, 23.8, 0, { shirt: m.accent, h: 1.6 }));
  s.add(P.suitcase(s, 13.2, 22.4, 0, 0.8, 0.5, 0.6, m.type('stay')));
  s.add(P.person(s, -18, 12, 0, { shirt: m.type('stay') }));
  s.add(P.person(s, -16.5, 12.8, 0, { shirt: m.type('rail'), h: 1.7 }));
  s.add(P.suitcase(s, -17.8, 13.3, 0, 0.7, 0.45, 0.55, m.type('car')));
  s.add(P.lamp(s, 22, -10, 0, 7));
  s.add(P.lamp(s, -26, 14, 0, 7));
}

// ---------------------------------------------------------------- Zug
function zug(s, pal) {
  const m = s.m;
  cropMarks(s);
  island(s, -30, -20, 28, 15, { th: 1.4, grid: 4 });
  s.add(track(s, -30, 28, -7), 'ground');
  s.add(track(s, -30, 28, -0.2), 'ground');
  // Bahnhofsgebäude (hinten)
  const hall = [];
  hall.push(s.box(-8, -19, 0, 26, 7, 6.2, m.paper, {
    decor: (f, sc) => {
      let r = sc.windows(f.L, 1, 0.7, 25, 4.0, 9, 1, { inset: 0.12, mullion: true });
      r += sc.fRect(f.L, 10.5, 0, 15.5, 3.4, { fill: m.glass.top, stroke: pal.ink, sw: 1 });
      r += sc.fLine(f.L, [[13, 0], [13, 3.4]], { stroke: pal.ink, sw: 0.9 });
      r += sc.fRect(f.L, 6.0, 4.35, 20.0, 5.75, { fill: pal.accent, stroke: pal.ink, sw: 0.9 });
      r += sc.fText(f.L, 'BAHNHOF', 13, 4.65, 0.8, { align: 'center', stroke: pal.onAccent, sw: 1.3 });
      return r;
    },
  }));
  hall.push(s.gable(-9, -19.6, 6.2, 28, 8.2, 2.6, m.stone, { axis: 'x' }));
  hall.push(s.box(-14, -19, 0, 5, 5, 11, m.paper, { sw: 1,
    decor: (f, sc) => sc.fCircle(f.L, 2.5, 8.0, 1.55, { fill: pal.surface, stroke: pal.ink, sw: 1 }, 24) + sc.fLine(f.L, [[2.5, 8], [2.5, 9.2]], { stroke: pal.ink, sw: 1, cap: 'round' }) + sc.fLine(f.L, [[2.5, 8], [3.3, 7.6]], { stroke: pal.ink, sw: 1, cap: 'round' }) + sc.windows(f.L, 1, 1.0, 4, 5.5, 2, 1, { inset: 0.15 }),
  }));
  hall.push(s.frustum(-11.5, -16.5, 11, 5.4, 5.4, 0.3, 0.3, 3.4, m.accent, { sw: 1 }));
  s.add(hall);
  // Zug
  const zy = -0.2 + 0.0;
  s.add(O.railCar(s, -27, zy, 0.0, { len: 13.5, accent: m.type('rail') }));
  s.add(O.railCar(s, -13, zy, 0.0, { len: 13.5, accent: m.accent }));
  s.add(O.railCar(s, 1.0, zy, 0.0, { len: 17, nose: true, accent: m.accent }));
  s.add(O.pantograph(s, -6, zy + 1.5, 4.3));
  // Fahrleitung
  const wire = (y) => s.line([s.P(-26, y, 6.2), s.P(24, y, 6.2)], { stroke: pal.mute, sw: 0.9, sop: 0.8 });
  s.raw(wire(zy + 1.5) + wire(-5.4), 'top');
  for (const x of [-24, -6, 12, 26]) {
    s.add(s.group([
      s.box(x - 0.15, -3.9, 0, 0.3, 0.3, 6.8, m.metal, { sw: 0.7, sh: 0 }),
      s.box(x - 0.1, -4.6, 6.2, 0.2, 5.4, 0.2, m.metal, { sw: 0.6, sh: 0 }),
    ]));
  }
  // Bahnsteig
  const plat = [];
  plat.push(s.box(-24, 4.0, 0, 46, 8.5, 1.1, m.stone, {
    decor: (f, sc) => sc.fRect(f.T, 0, 7.6, 46, 8.2, { fill: pal.type.stay, stroke: null }) + sc.fLine(f.T, [[0, 6.9], [46, 6.9]], { stroke: pal.line, sw: 0.7, dash: '3 4' }) + sc.fLine(f.L, [[0, 0.55], [46, 0.55]], { stroke: m.stone.line, sw: 0.7, sop: 0.6 }),
  }));
  s.add(plat);
  // Möblierung des Bahnsteigs
  s.add(P.bench(s, -12, 9.2, 1.1, 2.2));
  s.add(P.bench(s, 10, 9.2, 1.1, 2.2));
  const shelter = [];
  shelter.push(s.box(-4, 9.6, 1.1, 0.2, 0.2, 2.6, m.metal, { sw: 0.7, sh: 0 }));
  shelter.push(s.box(5, 9.6, 1.1, 0.2, 0.2, 2.6, m.metal, { sw: 0.7, sh: 0 }));
  shelter.push(s.box(-4.5, 8.7, 3.7, 10, 2.2, 0.22, m.glass, { sw: 0.8, sh: 0 }));
  s.add(s.group(shelter, [-4.5, 8.7, 1.1, 5.5, 10.9, 3.9]));
  // Gleisschild
  const gs = [];
  gs.push(s.box(18.8, 11.2, 1.1, 0.2, 0.2, 3.3, m.metal, { sw: 0.7, sh: 0 }));
  gs.push(s.box(16.6, 11.15, 4.4, 4.6, 0.25, 1.5, m.accent, { sw: 0.9, sh: 0, decor: (f, sc) => sc.fText(f.L, 'GLEIS 3', 2.3, 0.35, 0.8, { align: 'center', stroke: pal.onAccent, sw: 1.4 }) }));
  s.add(s.group(gs, [16.6, 11.1, 1.1, 21.2, 11.5, 5.9]));
  // Uhr auf Mast
  const clk = [];
  clk.push(s.cyl(-6.2, 11.6, 1.1, 0.12, 4.6, m.metal, { sw: 0.7, sh: 0 }));
  clk.push(s.box(-7.4, 11.3, 5.7, 2.4, 0.5, 2.0, m.paper, { sw: 0.9, sh: 0, decor: (f, sc) => sc.fCircle(f.L, 1.2, 1.0, 0.8, { fill: pal.surface, stroke: pal.ink, sw: 0.9 }, 22) + sc.fLine(f.L, [[1.2, 1.0], [1.2, 1.55]], { stroke: pal.ink, sw: 0.9, cap: 'round' }) + sc.fLine(f.L, [[1.2, 1.0], [1.6, 0.8]], { stroke: pal.accent, sw: 0.9, cap: 'round' }) }));
  s.add(s.group(clk, [-7.4, 11.3, 1.1, -5, 11.8, 7.7]));
  s.add(P.lamp(s, -20, 11, 1.1, 5)); s.add(P.lamp(s, 0, 11, 1.1, 5)); s.add(P.lamp(s, 20, 11, 1.1, 5));
  // Reisende
  s.add(P.person(s, -9, 7, 1.1, { shirt: m.type('stay') }));
  s.add(P.suitcase(s, -8.1, 6.6, 1.1, 0.8, 0.5, 0.7, m.type('ship')));
  s.add(P.person(s, 2, 7.6, 1.1, { shirt: m.accent, h: 1.65 }));
  s.add(P.person(s, 3.2, 8.2, 1.1, { shirt: m.type('car'), h: 1.5 }));
  s.add(P.suitcase(s, 4.0, 7.0, 1.1, 0.9, 0.55, 0.75, m.type('transfer')));
  s.add(P.person(s, 12, 6.8, 1.1, { shirt: m.type('ship') }));
  s.add(P.person(s, -1.0, 6.0, 1.1, { shirt: m.type('rail') }));
  s.add(P.person(s, 17, 8, 1.1, { shirt: m.type('activity') }));
  s.add(P.person(s, -20, 6.4, 1.1, { shirt: m.type('doc') }));
  s.add(P.tree(s, 25, 10, 0, 6, { two: true }));
  s.add(P.tree(s, -27, 11, 0, 5.4));
  s.add(P.bush(s, 25, 13, 0, 1.2));
}

// ---------------------------------------------------------------- Mietauto
function mietauto(s, pal) {
  const m = s.m;
  cropMarks(s);
  island(s, -24, -20, 24, 14, { th: 1.4, grid: 4 });
  const G = [];
  // Strasse vorn, Parkreihen hinten
  G.push(s.strip([[-24, 8.5], [24, 8.5]], 6.4, 0.02, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-24, 8.5], [24, 8.5]], 0.03, { stroke: pal.surface, sw: 1.4, dash: '6 5' }));
  G.push(s.flatPoly([[-18, -13], [20, -13], [20, -1.4], [-18, -1.4]], 0.02, m.asphalt.top));
  for (let x = -18; x <= 20.01; x += 6) { G.push(s.groundLine([[x, -13], [x, -10]], 0.03, { stroke: pal.surface, sw: 1.2 })); G.push(s.groundLine([[x, -4.4], [x, -1.4]], 0.03, { stroke: pal.surface, sw: 1.2 })); }
  G.push(s.groundLine([[-18, -10], [20, -10]], 0.03, { stroke: pal.surface, sw: 1.2, sop: 0.9 }));
  G.push(s.groundLine([[-18, -4.4], [20, -4.4]], 0.03, { stroke: pal.surface, sw: 1.2, sop: 0.9 }));
  s.add(G, 'ground');
  // Mietstation
  const st = [];
  st.push(s.box(-16, -20, 0, 26, 6, 4.6, m.paper, {
    decor: (f, sc) => {
      let r = sc.windows(f.L, 0.8, 0.5, 18, 3.6, 8, 1, { inset: 0.1, mullion: true });
      r += sc.fRect(f.L, 19.2, 0, 24.2, 3.3, { fill: m.glass.top, stroke: pal.ink, sw: 1 });
      r += sc.fLine(f.L, [[21.7, 0], [21.7, 3.3]], { stroke: pal.ink, sw: 0.9 });
      return r;
    },
  }));
  st.push(s.box(-17, -14.6, 4.6, 28, 0.6, 1.6, m.accent, {
    sw: 1,
    decor: (f, sc) => sc.fText(f.L, 'MIETWAGEN', 14, 0.3, 1.0, { align: 'center', stroke: pal.onAccent, sw: 1.6 }),
  }));
  st.push(s.box(-14, -19, 4.6, 6, 3.5, 1.2, m.metal, { sw: 0.9 }));
  s.add(st);
  // Schlüssel-Wahrzeichen (Schaft = Mast)
  const key = [];
  const kx = 16, ky = -12;
  key.push(s.prismXZ([[kx - 0.25, 0], [kx + 0.25, 0], [kx + 0.25, 7.6], [kx - 0.25, 7.6]], ky - 0.25, ky + 0.25, m.metal, { sw: 0.9, sh: 0 }));
  key.push(s.prismXZ([[kx + 0.25, 1.0], [kx + 1.5, 1.0], [kx + 1.5, 1.9], [kx + 0.25, 1.9]], ky - 0.25, ky + 0.25, m.metal, { sw: 0.9, sh: 0 }));
  key.push(s.prismXZ([[kx + 0.25, 2.5], [kx + 1.1, 2.5], [kx + 1.1, 3.3], [kx + 0.25, 3.3]], ky - 0.25, ky + 0.25, m.metal, { sw: 0.9, sh: 0 }));
  const ring = [];
  for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2; ring.push([kx + Math.cos(t) * 1.7, 9.3 + Math.sin(t) * 1.7]); }
  key.push(s.prismXZ(ring, ky - 0.3, ky + 0.3, m.accent, { sw: 1, sh: 0 }));
  const kf = s.frame([0, ky + 0.3, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  const hole = []; for (let i = 0; i < 14; i++) { const t = i / 14 * Math.PI * 2; hole.push([kx + Math.cos(t) * 0.7, 9.3 + Math.sin(t) * 0.7]); }
  key.push({ svg: s.fPoly(kf, hole, { fill: pal.surface, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 1 }), bbox: [kx - 1, ky + 0.3, 8, kx + 1, ky + 0.3, 11], sh: 0 });
  s.add(s.group(key, [kx - 1.8, ky - 0.4, 0, kx + 1.8, ky + 0.4, 11.1]));
  // Autos
  s.add(O.car(s, -16, -12.2, 0, { mat: m.type('car'), suv: true, rails: true }));
  s.add(O.car(s, -4.6, -12.2, 0, { mat: m.white }));
  s.add(O.car(s, 8.2, -12.2, 0, { mat: m.type('ship'), suv: true }));
  s.add(O.car(s, -9.8, -4.2, 0, { mat: m.type('stay') }));
  s.add(O.car(s, 2.0, 5.4, 0, { mat: m.accent, suv: true, rails: true }));
  // Übergabe: Person mit Koffer vor dem grünen SUV
  s.add(P.person(s, -11.0, -8.2, 0, { shirt: m.type('rail') }));
  s.add(P.suitcase(s, -10.0, -8.4, 0, 0.8, 0.5, 0.65, m.type('stay')));
  s.add(P.person(s, -13.0, -7.6, 0, { shirt: m.type('activity'), h: 1.7 }));
  s.add(P.person(s, 12, -7.6, 0, { shirt: m.type('stay'), h: 1.6 }));
  s.add(P.person(s, 15.6, 12.6, 0, { shirt: m.type('transfer') }));
  // Bepflanzung, Laternen
  s.add(P.palm(s, -20, -17, 0, 7));
  s.add(P.palm(s, 21, -3, 0, 6.5, { lean: [-0.5, -0.2] }));
  s.add(P.bush(s, -21, 11, 0, 1.2)); s.add(P.bush(s, 20, 11.5, 0, 1.4));
  s.add(P.tree(s, 22, -17, 0, 5.4, { two: true }));
  s.add(P.lamp(s, -18, 4.2, 0, 6)); s.add(P.lamp(s, 12, 4.2, 0, 6));
  s.add(P.cone(s, 19, 5.5)); s.add(P.cone(s, 20, 3.5));
  // --- Verdichtung: Strasse, Schilder, Gepäck, Übergabe
  s.add(SC.zebra(s, -5, 5.4, 11.6, 6, 0.9, 0.7), 'ground');
  s.add(SC.roadArrow(s, -16, 7.0, 3.2, 1), 'ground'); s.add(SC.roadArrow(s, 18, 10.0, 3.2, -1), 'ground');
  for (let i = 0; i < 6; i++) { s.add(SC.groundText(s, -16 + i * 6 + 2.4, -4.8, String(i + 1), 1.1), 'ground'); s.add(SC.groundText(s, -16 + i * 6 + 2.4, -11.6, String(i + 7), 1.1), 'ground'); }
  s.add(SC.signPost(s, -19.5, -0.6, 0, 'P', { round: false, mat: m.type('rail'), r: 1.0, h: 3.0 }));
  s.add(SC.signPost(s, 21.5, 4.2, 0, '30', { h: 3.2, r: 0.9 }));
  s.add(SC.flagPole(s, -17.5, -13.6, 0, 8.5, m.accent));
  s.add(SC.hedge(s, -13, -13.6, 10, 0.9, 1.1));
  s.add(s.box(-8, -19, 4.6, 8, 3.4, 0.14, m.glass, { sw: 0.8, sh: 0 }));
  s.add(s.box(-8, -15.2, 4.6, 8, 0.2, 0.9, m.ink, { sw: 0.7, sh: 0 }));
  // Ladesäule und Mitarbeitende
  s.add(s.group([s.box(14.2, -1.0, 0, 0.9, 0.9, 2.2, m.type('car'), { sw: 0.9, sh: 0.4 }), s.box(14.3, 0.0, 1.3, 0.1, 0.5, 0.3, m.ink, { sw: 0.5, sh: 0 })]));
  s.add(P.person(s, -13.2, -6.8, 0, { shirt: m.type('ship'), jacket: m.type('ship'), h: 1.85, hat: true, hatMat: m.type('ship'), skin: 2 }));
  s.add(P.person(s, -10.6, -7.6, 0, { shirt: m.type('stay'), h: 1.75, bag: 'shoulder', hairI: 2, skirt: true, pants: m.type('transfer') }));
  s.add(P.person(s, -9.2, -6.4, 0, { shirt: m.type('rail'), h: 1.15, skin: 1 }));
  s.add(s.group([s.box(-6.6, -7.0, 0.25, 1.4, 1.0, 0.1, m.metal, { sh: 0, sw: 0.7 }), s.cyl(-6.4, -6.8, 0.0, 0.2, 0.25, m.ink, { sh: 0, sw: 0.5 }), s.box(-6.5, -7.0, 0.35, 0.1, 0.1, 1.3, m.metal, { sh: 0, sw: 0.5 }), s.box(-6.6, -6.95, 0.45, 1.4, 0.9, 0.8, m.type('stay'), { sh: 0, sw: 0.7 })]));
  s.add(O.car(s, -14.5, 9.2, 0, { mat: m.white, suv: true, len: 6.2, wid: 2.4 }));
  s.add(P.bench(s, 4, 12.4, 0, 2.6));
  s.add(s.cyl(8, 12.8, 0, 0.45, 1.0, m.green2, { sw: 0.8 }));
  s.add(P.tree(s, -6, 13, 0, 5.0)); s.add(P.tree(s, 10.5, 13, 0, 5.6, { two: true }));
}

// ---------------------------------------------------------------- Transfer
function transfer(s, pal) {
  const m = s.m;
  cropMarks(s);
  // Wasser hinten, Kai vorn
  s.add(s.plate(-24, -24, 24, -4, 1.4, m.water, { z: -1.2 }), 'ground');
  s.add(waves(s, -24, -24, 24, -4, -1.2), 'ground');
  s.add(s.plate(-24, -4, 24, 14, 3.4, m.ground, { grid: 4 }), 'ground');
  s.raw(s.dim([24, -24], [24, 14], 2.2) + s.dim([-24, 14], [24, 14], 2.2), 'ground');
  const G = [];
  G.push(s.strip([[-24, 7.5], [24, 7.5]], 5.4, 0.02, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-24, 7.5], [24, 7.5]], 0.03, { stroke: pal.surface, sw: 1.3, dash: '6 5' }));
  G.push(s.flatPoly([[-10, 0.6], [4, 0.6], [4, 3.6], [-10, 3.6]], 0.02, m.stone.top));
  s.add(G, 'ground');
  // Fähre am Kai
  s.add(O.ship(s, -14, -13.0, { len: 30, wid: 8.6, hull: 2.6, decks: 2, z: -1.2 }));
  // Poller
  for (const x of [-12, 0, 12]) s.add(s.cyl(x, -3.0, 0, 0.3, 0.6, m.ink, { sw: 0.8, sh: 0 }));
  // Gangway zur Fähre (Rampe)
  s.add(s.ramp(-2.5, -5.0, -0.2, 2.0, 4.0, 0.2, 2.2, m.accent, { dir: '-y', sw: 1 }));
  // Bus
  s.add(O.bus(s, -9, 3.8, 0, { len: 11.5 }));
  // Haltestelle
  const sh = [];
  sh.push(s.box(8.6, 1.2, 0, 0.25, 0.25, 3.2, m.metal, { sw: 0.7, sh: 0 }));
  sh.push(s.box(14.6, 1.2, 0, 0.25, 0.25, 3.2, m.metal, { sw: 0.7, sh: 0 }));
  sh.push(s.box(8.2, 0.8, 3.2, 7.2, 3.0, 0.3, m.accent, { sw: 0.9, sh: 0 }));
  sh.push(s.box(8.7, 0.9, 0.6, 6.0, 0.15, 2.6, m.glass, { sw: 0.7, sh: 0 }));
  s.add(s.group(sh, [8.2, 0.8, 0, 15.4, 3.8, 3.5]));
  s.add(P.bench(s, 10.2, 1.9, 0, 3));
  // Haltestellenschild
  const sg = [];
  sg.push(s.cyl(6.5, 2.8, 0, 0.1, 4.0, m.metal, { sw: 0.7, sh: 0 }));
  sg.push(s.cyl(6.5, 2.8, 4.0, 0.9, 0.12, m.accent, { sw: 0.9, sh: 0 }));
  s.add(s.group(sg, [5.5, 1.8, 0, 7.5, 3.8, 4.2]));
  // Gepäck und Reisende
  s.add(P.person(s, -11.5, 2.4, 0, { shirt: m.type('stay') }));
  s.add(P.suitcase(s, -10.6, 2.0, 0, 0.9, 0.55, 0.75, m.type('rail')));
  s.add(P.person(s, -4.5, 2.2, 0, { shirt: m.accent, h: 1.65 }));
  s.add(P.suitcase(s, -3.6, 1.8, 0, 0.8, 0.5, 0.65, m.type('car')));
  s.add(P.person(s, 11.6, 3.4, 0, { shirt: m.type('ship') }));
  s.add(P.person(s, 13.4, 3.0, 0, { shirt: m.type('transfer'), h: 1.55 }));
  s.add(P.person(s, 3.0, 10.4, 0, { shirt: m.type('activity') }));
  s.add(P.suitcase(s, 4.0, 10.0, 0, 0.9, 0.55, 0.7, m.type('doc')));
  s.add(P.tree(s, 20, 11, 0, 5.2));
  s.add(P.bush(s, -20, 11, 0, 1.2));
  s.add(P.lamp(s, -18, 3, 0, 5)); s.add(P.lamp(s, 19, 3, 0, 5));
  // --- Verdichtung: Geländer, Tafeln, Taxi, Gepäck, Personen
  s.add(SC.fenceX(s, -24, -3.6, -3.6, 1.1, 1.0)); s.add(SC.fenceX(s, -0.4, 24, -3.6, 1.1, 1.0));
  s.add(SC.signPost(s, -19, 1.4, 0, 'FÄHRE', { round: false, mat: m.type('ship'), r: 2.0, h: 3.4 }));
  s.add(SC.signPost(s, 17, 11.8, 0, 'BUS', { round: false, mat: m.accent, r: 1.4, h: 3.0 }));
  s.add(I_.upCard(s, 5.8, 1.0, 0, 3.4, 3.2, m.card, (f, sc, w, h) => {
    let r = sc.fRect(f, 0, h - 0.7, w, h, { fill: pal.accent, stroke: null });
    ['09:10', '09:40', '10:10'].forEach((tm, i) => { r += sc.fText(f, tm, 0.4, h - 1.5 - i * 0.7, 0.42, { stroke: pal.ink, sw: 1.1 }); });
    return r;
  }));
  s.add(O.car(s, 12.0, 5.5, 0, { mat: m.type('stay'), len: 4.8, wid: 2.0 }));
  s.add(s.box(13.6, 5.9, 2.35, 1.4, 0.7, 0.5, m.white, { sw: 0.8, sh: 0 }));
  s.add(s.group([s.box(-3.4, 2.6, 0.25, 1.6, 1.0, 0.1, m.metal, { sh: 0, sw: 0.7 }), s.box(-3.3, 2.65, 0.35, 0.1, 0.1, 1.4, m.metal, { sh: 0, sw: 0.5 }), P.suitcase(s, -3.3, 2.7, 0.35, 1.1, 0.7, 0.9, m.type('stay')), P.suitcase(s, -2.3, 2.7, 0.35, 0.8, 0.6, 0.7, m.accent)]));
  s.add(P.person(s, 9.4, 2.9, 0, { shirt: m.type('rail'), h: 1.8, bag: 'backpack', hat: true, hatMat: m.type('car') }));
  s.add(P.person(s, 12.2, 3.1, 0, { shirt: m.type('food'), h: 1.7, skirt: true, pants: m.type('stay'), skin: 1, hairI: 2 }));
  s.add(P.person(s, 11.0, 2.2, 0, { shirt: m.type('car'), h: 1.1, skin: 2 }));
  s.add(P.person(s, -0.5, -0.2, 0, { shirt: m.type('transfer'), h: 1.75, jacket: m.type('transfer'), bag: 'shoulder', skin: 3 }));
  s.add(P.person(s, 5.0, 11.2, 0, { shirt: m.ink, h: 1.8, jacket: m.type('ship'), hat: true, hatMat: m.type('ship') }));
  s.add(SC.hedge(s, -22, 12.4, 8, 1.0, 1.0));
  s.add(s.cyl(18, -16, -1.2, 0.7, 1.2, m.accent, { sh: 0, sw: 0.8 }));
  s.add(s.cyl(-8.5, -3.4, 0.3, 0.55, 0.12, m.accent, { sh: 0, sw: 0.8 }));
  { let gl = ''; for (const [gx, gy] of [[-6, -14], [12, -18], [4, -8]]) { const a = s.P(gx, gy, 9); gl += s.line([[a[0] - 8, a[1] + 3], [a[0] - 3, a[1] - 3], [a[0], a[1] + 1], [a[0] + 3, a[1] - 3], [a[0] + 8, a[1] + 3]], { stroke: pal.ink, sw: 1.2, cap: 'round' }); } s.raw(gl, 'top'); }
}

module.exports = [
  def('type-Flug', 'Flug', 'Isometrische Darstellung eines Verkehrsflugzeugs am Gate: Fluggastbrücke, Terminalgebäude mit Kontrollturm, Gepäckwagen und wartende Reisende.',
    'event-type:Flug', flug, {}),
  def('type-Zugreisen', 'Zug', 'Isometrische Darstellung eines Bahnhofs: Zug mit drei Wagen am Bahnsteig, Fahrleitung, Bahnhofsgebäude mit Uhrturm und Reisende mit Gepäck.',
    'event-type:Zugreisen', zug, {}),
  def('type-Mietauto', 'Mietauto', 'Isometrische Darstellung einer Mietwagenstation: Parkfeld mit Fahrzeugen, Stationsgebäude mit Schlüssel-Wahrzeichen, Palmen und Kundinnen mit Gepäck.',
    'event-type:Mietauto', mietauto, {}),
  def('type-Transfer', 'Transfer', 'Isometrische Darstellung eines Transfers: Shuttlebus an der Haltestelle am Kai, daneben eine Fähre am Anleger mit Gangway und Reisende mit Gepäck.',
    'event-type:Transfer', transfer, {}),
];
