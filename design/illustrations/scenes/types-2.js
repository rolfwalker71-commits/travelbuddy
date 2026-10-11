'use strict';
const { cropMarks, island, track, waves } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const T = require('../lib/things');
const { mix } = require('../lib/util');

const def = (id, title, alt, usage, build, setup, extra = {}) => ({ id, kind: 'type', title, alt, usage, width: 1200, height: 800, build, setup, ...extra });

// ---------------------------------------------------------------- Hotel
function hotel(s, pal) {
  const m = s.m;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  cropMarks(s);
  island(s, -7, -4, 27, 21, { th: 1.2, grid: 4 });
  const G = [];
  G.push(s.strip([[-7, 18.5], [27, 18.5]], 5, 0.02, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-7, 18.5], [27, 18.5]], 0.03, { stroke: pal.surface, sw: 1.3, dash: '6 5' }));
  G.push(s.flatPoly([[7, 11.5], [11, 11.5], [11, 16], [7, 16]], 0.02, m.stone.top));
  s.add(G, 'ground');
  const W = 18, D = 11, H = 3.0, lv = [0, 6.4, 12.8];
  const slab = (z, accent) => s.box(0, 0, z - 0.45, W, D, 0.45, m.paper, {
    sw: 1,
    decor: (f, sc) => sc.fRect(f.L, 0, 0.0, W, 0.14, { fill: pal.accent, stroke: null }) + sc.fRect(f.R, 0, 0.0, D, 0.14, { fill: pal.accent, stroke: null }),
  });
  const backWalls = (z, sign) => {
    const out = [];
    out.push(s.box(0, 0, z, W, 0.35, H, m.paper, {
      sw: 1,
      decor: (f, sc) => {
        let r = sc.windows(f.L, 1.2, 0.8, 5.6, 2.5, 2, 1, { inset: 0.1, mullion: true });
        r += sc.windows(f.L, 12.4, 0.8, 16.8, 2.5, 2, 1, { inset: 0.1, mullion: true });
        r += sc.fRect(f.L, 7.6, 1.2, 9.6, 2.5, { fill: pal.surface2, stroke: line, sw: 0.8 });
        r += sc.fRect(f.L, 7.8, 1.4, 9.4, 2.3, { fill: m.soft('rail').left, stroke: null });
        return r;
      },
    }));
    out.push(s.box(0, 0, z, 0.35, D, H, m.paper, {
      sw: 1,
      decor: (f, sc) => sc.windows(f.R, 1.5, 0.8, 4.5, 2.5, 1, 1, { inset: 0.1 }) + sc.windows(f.R, 6.5, 0.8, 9.5, 2.5, 1, 1, { inset: 0.1 }),
    }));
    return out;
  };
  // Stützen zwischen den Ebenen
  for (let i = 0; i < 2; i++) {
    for (const [px, py] of [[W - 0.4, D - 0.4], [0.1, D - 0.4], [W - 0.4, 0.1]]) s.add(s.box(px, py, lv[i], 0.3, 0.3, lv[i + 1] - 0.45 - lv[i], m.metal, { sw: 0.8, sh: 0 }));
  }
  // ---- Ebene 0: Lobby
  s.add(slab(lv[0])); s.add(backWalls(lv[0]));
  s.add(T.rug(s, 10.5, 6.2, 5.5, 4.2, lv[0] + 0.02));
  s.add(T.counter(s, 1.8, 6.6, lv[0], 6.0, 0.9));
  s.add(T.monitor(s, 3.2, 6.9, lv[0] + 1.15));
  s.add(s.cyl(6.1, 7.0, lv[0] + 1.15, 0.14, 0.12, m.metal, { sh: 0, sw: 0.7 }));
  s.add(P.person(s, 4.2, 5.5, lv[0], { shirt: m.accent }));
  s.add(P.person(s, 3.6, 9.1, lv[0], { shirt: m.type('rail') }));
  s.add(P.suitcase(s, 4.6, 8.9, lv[0], 0.8, 0.5, 0.7, m.type('stay')));
  s.add(T.sofa(s, 11.2, 9.4, lv[0], 2.6, { mat: m.type('ship') }));
  s.add(T.roundTable(s, 13.4, 7.6, lv[0], 0.55, 0.5));
  s.add(T.plant(s, 16.8, 10.0, lv[0], 1.6));
  s.add(T.plant(s, 0.9, 10.0, lv[0], 1.3));
  s.add(s.box(8.0, 10.6, lv[0], 2.4, 0.2, 2.7, m.glass, { sw: 0.9, sh: 0 }));
  s.add(s.group([s.cyl(7.1, 3.4, lv[0], 0.05, 0.05, m.ink, { sh: 0, sw: 0.4 })]));
  // Schlüsselschrank an der Rückwand (Lobby)
  s.add(s.box(2.2, 0.35, lv[0] + 0.9, 4.4, 0.12, 1.5, m.wood, { sw: 0.8, sh: 0,
    decor: (f, sc) => { let r = ''; for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) r += sc.fCircle(f.L, 0.4 + i * 0.52, 0.4 + j * 0.6, 0.07, { fill: pal.accent, stroke: null }, 6); return r; } }));
  // ---- Ebene 1: Zimmer
  const z1 = lv[1];
  s.add(slab(z1)); s.add(backWalls(z1));
  s.add(s.box(9, 0.35, z1, 0.2, D - 0.35, 1.3, m.paper, { sw: 0.9, sh: 0 }));
  // Zimmer A
  s.add(T.rug(s, 1.0, 5.0, 4.8, 4.2, z1 + 0.02, mix(pal.type.rail, pal.name === 'light' ? pal.surface : pal.bg, 0.6)));
  s.add(T.bed(s, 0.8, 6.0, z1, { cover: m.type('rail') }));
  s.add(T.nightstand(s, 0.55, 4.8, z1));
  s.add(T.nightstand(s, 0.55, 7.8, z1));
  s.add(T.wardrobe(s, 4.0, 0.4, z1));
  s.add(T.desk(s, 5.2, 8.6, z1));
  s.add(T.chair(s, 5.8, 9.5, z1));
  s.add(P.person(s, 7.6, 6.0, z1, { shirt: m.type('stay') }));
  // Zimmer B
  s.add(T.rug(s, 10.0, 5.0, 4.8, 4.2, z1 + 0.02, mix(pal.type.stay, pal.name === 'light' ? pal.surface : pal.bg, 0.6)));
  s.add(T.bed(s, 9.9, 6.0, z1, { cover: m.accent }));
  s.add(T.nightstand(s, 9.65, 4.8, z1));
  s.add(T.nightstand(s, 9.65, 7.8, z1));
  s.add(T.wardrobe(s, 13.0, 0.4, z1));
  s.add(T.sofa(s, 14.0, 9.2, z1, 2.2, { mat: m.type('stay') }));
  s.add(P.suitcase(s, 13.2, 7.0, z1, 0.9, 0.55, 0.65, m.type('car')));
  // ---- Ebene 2: Dachterrasse mit Pool
  const z2 = lv[2];
  s.add(slab(z2)); s.add(backWalls(z2));
  s.add(s.box(1, 0.1, z2 + H, 16, 0.3, 2.2, m.accent, {
    sw: 1,
    decor: (f, sc) => sc.fText(f.L, 'HOTEL', 8, 0.5, 1.2, { align: 'center', stroke: pal.onAccent, sw: 2 }),
  }));
  s.add(s.box(9.5, 6.0, z2, 7.5, 4.2, 0.2, m.stone, { sw: 0.9, sh: 0 }));
  s.add(s.flatPoly([[10.2, 6.6], [16.3, 6.6], [16.3, 9.6], [10.2, 9.6]], z2 + 0.21, m.water.left, { stroke: line, sw: 0.9 }));
  s.add(s.flatPoly([[10.6, 7.2], [13.2, 7.2]], z2 + 0.22, 'none', { stroke: pal.surface, sw: 1.2 }));
  for (const [lx, ly] of [[1.5, 6.3], [1.5, 8.3]]) {
    s.add(s.group([s.box(lx, ly, z2, 2.0, 0.8, 0.3, m.white, { sh: 0, sw: 0.8 }), s.box(lx - 0.1, ly, z2 + 0.3, 0.6, 0.8, 0.5, m.white, { sh: 0, sw: 0.7 })]));
  }
  s.add(T.umbrellaParasol(s, 5.8, 8.0, z2, 1.6, 2.6, m.accent));
  s.add(T.plant(s, 17.0, 3.0, z2, 1.5)); s.add(T.plant(s, 17.0, 5.0, z2, 1.5));
  s.add(P.person(s, 12.0, 4.2, z2, { shirt: m.type('ship') }));
  // Umgebung
  s.add(P.tree(s, -3.5, 14, 0, 6.2, { two: true }));
  s.add(P.tree(s, 23.5, 6, 0, 6.5));
  s.add(P.bush(s, 21, 14, 0, 1.3)); s.add(P.bush(s, -4.5, 3, 0, 1.2));
  s.add(O.car(s, 14.5, 15.5, 0, { mat: m.type('car'), suv: true }));
  s.add(P.lamp(s, 6, 16.5, 0, 5)); s.add(P.lamp(s, 24, 16.5, 0, 5));
  s.add(P.person(s, 9, 14, 0, { shirt: m.type('activity') }));
  s.add(P.suitcase(s, 9.8, 13.7, 0, 0.8, 0.5, 0.7, m.type('rail')));
}

// ---------------------------------------------------------------- Unterkunft
function unterkunft(s, pal) {
  const m = s.m;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  cropMarks(s);
  island(s, -22, -20, 24, 20, { th: 1.4, grid: 4, mat: m.ground });
  // Rasenfläche
  const gr = pal.name === 'light' ? mix(pal.type.car, pal.surface, 0.62) : mix(pal.type.car, pal.bg, 0.72);
  s.add(s.flatPoly([[-21, -19], [23, -19], [23, 19], [-21, 19]], 0.01, gr), 'ground');
  // Haus
  const h = [];
  h.push(s.box(-14, -16, 0, 18, 9, 3.4, m.paper, {
    decor: (f, sc) => {
      let r = '';
      for (const u of [2, 7.2, 12.4]) {
        r += sc.fRect(f.L, u, 0.9, u + 2.2, 2.7, { fill: m.glass.left, stroke: line, sw: 0.9 });
        r += sc.fLine(f.L, [[u + 1.1, 0.9], [u + 1.1, 2.7]], { stroke: line, sw: 0.7 });
        r += sc.fRect(f.L, u - 0.5, 0.9, u, 2.7, { fill: m.green.left, stroke: line, sw: 0.8 });
        r += sc.fRect(f.L, u + 2.2, 0.9, u + 2.7, 2.7, { fill: m.green.left, stroke: line, sw: 0.8 });
      }
      r += sc.fRect(f.L, 15.4, 0, 17, 2.6, { fill: m.wood.left, stroke: line, sw: 0.9 });
      return r;
    },
  }));
  h.push(s.gable(-14.8, -16.8, 3.4, 19.6, 10.6, 3.2, m.type('activity'), { axis: 'x' }));
  h.push(s.box(-9.5, -14, 6.2, 1.1, 1.1, 2.2, m.stone, { sw: 0.9 }));
  s.add(h);
  // Anbau mit Glasfront
  const w2 = [];
  w2.push(s.box(4, -14, 0, 8, 8, 3.0, m.paper, { decor: (f, sc) => sc.windows(f.L, 0.6, 0.4, 7.4, 2.7, 3, 1, { inset: 0.06, mullion: true }) }));
  w2.push(s.box(3.5, -14.5, 3.0, 9, 9, 0.35, m.metal, { sw: 0.9 }));
  s.add(w2);
  // Terrasse
  s.add(s.box(-14, -7, 0, 26, 4.2, 0.3, m.wood, { sw: 0.9, sh: 0 }));
  // Pool
  const px = -10, py = 0, pw = 16, pd = 9;
  const cop = m.stone;
  const pg = [];
  pg.push(s.box(px - 1, py - 1, 0, pw + 2, pd + 2, 0.12, cop, { sh: 0, sw: 0.9 }));
  s.add(pg, 'ground');
  const poolCol = pal.name === 'light' ? mix(pal.type.ship, pal.surface, 0.5) : mix(pal.type.ship, pal.bg, 0.35);
  s.add(s.flatPoly([[px, py], [px + pw, py], [px + pw, py + pd], [px, py + pd]], 0.13, poolCol, { stroke: line, sw: 1 }), 'ground');
  s.add({ svg: s.poly3([[px, py, 0.13], [px + pw, py, 0.13], [px + pw, py, 0.0], [px, py, 0.0]], { fill: mix(pal.type.ship, pal.name === 'light' ? pal.ink : pal.bg, 0.25), stroke: null }), bbox: [px, py, 0, px + pw, py, 0.13], sh: 0 }, 'ground');
  // Wasserglanz
  let sh = '';
  for (let i = 0; i < 6; i++) { const a = s.P(px + 1.5 + i * 2.4, py + 1.5 + (i % 3) * 2.4, 0.14), b = s.P(px + 2.8 + i * 2.4, py + 1.5 + (i % 3) * 2.4, 0.14); sh += s.line([a, b], { stroke: pal.surface, sw: 1.4, cap: 'round' }); }
  s.add({ svg: sh, bbox: [px, py, 0.14, px + pw, py + pd, 0.14], sh: 0 }, 'ground');
  // Leiter
  s.add(s.group([s.cyl(px + 3, py + pd + 0.15, 0.1, 0.06, 1.2, m.metal, { sh: 0, sw: 0.6 }), s.cyl(px + 3.8, py + pd + 0.15, 0.1, 0.06, 1.2, m.metal, { sh: 0, sw: 0.6 })]));
  // Liegen und Schirm
  for (const lx of [-8, -4.5]) {
    s.add(s.group([s.box(lx, py + pd + 1.8, 0, 2.6, 0.9, 0.3, m.white, { sh: 0, sw: 0.8 }), s.box(lx + 1.8, py + pd + 1.8, 0.3, 0.9, 0.9, 0.5, m.white, { sh: 0, sw: 0.7 }), s.box(lx + 0.2, py + pd + 1.85, 0.32, 1.4, 0.8, 0.05, m.type('ship'), { sh: 0, sw: 0.5 })]));
  }
  s.add(T.umbrellaParasol(s, -1, py + pd + 2.4, 0, 1.8, 2.8, m.accent));
  // Sitzgruppe
  s.add(T.roundTable(s, 8, -5.2, 0.3, 0.7, 0.7, { cloth: m.type('stay') }));
  s.add(T.chair(s, 7.0, -4.2, 0.3)); s.add(T.chair(s, 9.0, -6.6, 0.3));
  s.add(P.person(s, 11, -4, 0.3, { shirt: m.type('activity') }));
  // Pflanzen, Weg, Zaun
  const path = [];
  path.push(s.strip([[16, 18], [16, 6], [3, 6]], 1.4, 0.03, m.stone.top, { round: false }));
  s.add(path, 'ground');
  s.add(P.palm(s, 14, 8, 0, 7.2));
  s.add(P.palm(s, -17, 10, 0, 6.5, { lean: [-0.5, 0.2] }));
  s.add(P.tree(s, 19, -12, 0, 6.8, { two: true }));
  s.add(P.tree(s, -19, -12, 0, 5.8));
  s.add(P.bush(s, -17, -3, 0, 1.2)); s.add(P.bush(s, 12.5, 12, 0, 1.3)); s.add(P.bush(s, 21, 4, 0, 1.4));
  s.add(P.conifer(s, 21, 16, 0, 5.2)); s.add(P.conifer(s, -19, 16, 0, 4.6));
  // Auto
  s.add(O.car(s, 11, 14.6, 0, { mat: m.white, suv: true, rails: true }));
  // Zaun (hinten)
  let fence = '';
  for (let x = -21; x <= 23; x += 2) fence += s.line([s.P(x, 19, 0), s.P(x, 19, 1.0)], { stroke: pal.mute, sw: 1.4 });
  s.add({ svg: fence + s.line([s.P(-21, 19, 0.8), s.P(23, 19, 0.8)], { stroke: pal.mute, sw: 1.2 }), bbox: [-21, 19, 0, 23, 19.2, 1], sh: 0 });
}

// ---------------------------------------------------------------- Kreuzfahrt
function kreuzfahrt(s, pal) {
  const m = s.m;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  cropMarks(s);
  const WZ = -1.2;
  s.add(s.plate(-34, -14, 34, 14, 1.2, m.water, { z: WZ }), 'ground');
  s.add(waves(s, -34, -14, 34, 14, WZ), 'ground');
  s.add(s.plate(-34, 14, 34, 28, 3.0, m.ground, { grid: 4 }), 'ground');
  s.raw(s.dim([34, -14], [34, 28], 2.2) + s.dim([-34, 28], [34, 28], 2.2), 'ground');
  const G = [];
  G.push(s.flatPoly([[-30, 17], [22, 17], [22, 21.5], [-30, 21.5]], 0.02, m.asphalt.top));
  G.push(s.groundLine([[-30, 19.25], [22, 19.25]], 0.03, { stroke: pal.surface, sw: 1.2, dash: '5 5' }));
  G.push(s.flatPoly([[-24, 23], [-14, 23], [-14, 26.5], [-24, 26.5]], 0.02, m.stone.top));
  s.add(G, 'ground');
  // Schiff
  s.add(O.ship(s, -28, 0, { len: 58, wid: 11, hull: 4.4, decks: 5, z: WZ }));
  // Gangway mit Gitter
  s.add(s.ramp(-6, 11.2, 0, 2.2, 5.8, 0.15, 2.6, m.accent, { dir: '-y', sw: 1 }));
  for (const x of [-12, -2, 8, 18]) s.add(s.cyl(x, 15.2, 0, 0.3, 0.7, m.ink, { sw: 0.8, sh: 0 }));
  // Portalkran
  const cr = [];
  cr.push(s.box(10, 21, 0, 0.5, 0.5, 9, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(10, 25, 0, 0.5, 0.5, 9, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(18, 21, 0, 0.5, 0.5, 9, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(18, 25, 0, 0.5, 0.5, 9, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(9.6, 20.6, 9, 9.3, 5.4, 0.7, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(9.8, 22.5, 9.7, 4.0, 1.6, 1.8, m.type('stay'), { sw: 0.9, sh: 0 }));
  cr.push(s.box(13.0, 14.5, 10.4, 0.5, 8.8, 0.5, m.type('stay'), { sw: 0.9, sh: 0 }));
  s.add(s.group(cr, [9.6, 14.5, 0, 18.9, 26, 11.5]));
  // Container
  const cc = [m.type('activity'), m.type('rail'), m.type('car'), m.accent, m.type('transfer'), m.type('ship')];
  let ci = 0;
  for (let i = 0; i < 4; i++) for (let k = 0; k < (i % 2 ? 2 : 3); k++) {
    s.add(s.box(23 + (i % 2) * 0, 18.5 + i * 2.4 - 0 + (i > 1 ? 0 : 0), k * 1.5, 6, 2.1, 1.4, cc[(ci++) % cc.length], { sw: 0.8,
      decor: (f, sc) => { let r = ''; for (let j = 1; j < 6; j++) r += sc.fLine(f.L, [[j, 0.1], [j, 1.3]], { stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.5, sop: 0.5 }); return r; } }));
  }
  // Terminal-Vordach
  const tv = [];
  tv.push(s.box(-28, 23, 0, 0.3, 0.3, 4, m.metal, { sw: 0.7, sh: 0 }));
  tv.push(s.box(-14, 23, 0, 0.3, 0.3, 4, m.metal, { sw: 0.7, sh: 0 }));
  tv.push(s.box(-28.5, 22.5, 4, 15, 4.5, 0.3, m.accent, { sw: 0.9, sh: 0, decor: (f, sc) => sc.fText(f.L, 'CRUISE', 7.5, 0.0, 0.0, {}) }));
  s.add(s.group(tv, [-28.5, 22.5, 0, -13, 27, 4.4]));
  // Reisende
  const cols = [m.type('stay'), m.type('rail'), m.accent, m.type('car'), m.type('transfer'), m.type('activity')];
  const pos = [[-6, 22.6], [-4.5, 20.4], [-1, 24], [-8, 19.2], [-5.5, 17.6], [2, 21.2], [-11, 22], [5, 18.2]];
  pos.forEach((p, i) => {
    s.add(P.person(s, p[0], p[1], 0, { shirt: cols[i % cols.length], h: 1.6 + (i % 3) * 0.08 }));
    if (i % 2 === 0) s.add(P.suitcase(s, p[0] + 0.9, p[1] - 0.2, 0, 0.8, 0.5, 0.65, cols[(i + 2) % cols.length]));
  });
  s.add(P.person(s, -6.4, 14.4, 0, { shirt: m.accent, h: 1.6 }));
  s.add(P.lamp(s, -30, 17, 0, 6)); s.add(P.lamp(s, 30, 17, 0, 6));
  s.add(P.palm(s, 28, 26, 0, 6.5, { lean: [-0.5, -0.2] }));
  s.add(P.bush(s, -31, 25, 0, 1.3));
}

// ---------------------------------------------------------------- Ausflug
function ausflug(s, pal) {
  const m = s.m;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  cropMarks(s);
  const gr = pal.name === 'light' ? mix(pal.type.car, pal.surface, 0.55) : mix(pal.type.car, pal.bg, 0.55);
  const rock = { top: gr, left: m.stone.left, right: m.stone.right, line };
  const rockD = pal.name === 'light'
    ? { top: mix(pal.type.car, pal.surface, 0.4), left: mix(m.stone.left, pal.mute, 0.15), right: mix(m.stone.right, pal.ink, 0.1), line }
    : { top: mix(pal.type.car, pal.bg, 0.4), left: m.stone.left, right: m.stone.right, line };
  island(s, -24, -20, 26, 20, { th: 1.4, grid: 4 });
  // Bergmassiv hinten
  const peak = (cx, cy, w, h, snow) => {
    const a = [s.frustum(cx, cy, 0, w, w, 1.0, 1.0, h, rockD, { sw: 1, oy: 0 })];
    if (snow) a.push(s.frustum(cx, cy, h * 0.74, w * (1 - 0.74) + 1.0, w * (1 - 0.74) + 1.0, 1.0, 1.0, h * 0.26, m.white, { sw: 0.9 }));
    return s.group(a, [cx - w / 2, cy - w / 2, 0, cx + w / 2, cy + w / 2, h]);
  };
  s.add(peak(-10, -14, 14, 16, true));
  s.add(peak(6, -15, 16, 20, true));
  s.add(peak(18, -11, 11, 11, false));
  // Terrassen
  s.add(s.box(-20, -6, 0, 40, 22, 1.6, rock, { sw: 1, sh: 0 }));
  s.add(s.box(-12, -5, 1.6, 26, 16, 3.0, rock, { sw: 1 }));
  s.add(s.box(-6, -4, 4.6, 16, 11, 3.0, rock, { sw: 1 }));
  s.add(s.box(-1, -2, 7.6, 9, 7, 1.4, m.stone, { sw: 1 }));
  // Treppe zur Plattform
  s.add(s.stairs(-1, 5, 7.6, 9, 3, 1.4, 1, m.stone, { axis: 'y' }));
  // Holzdeck und Reling
  const rail = [];
  rail.push(s.box(-0.6, -2.4, 9.0, 10.2, 7.8, 0.25, m.wood, { sw: 0.9, sh: 0 }));
  for (const [rx, ry] of [[-0.5, 5.2], [3, 5.2], [6.5, 5.2], [9.4, 5.2], [9.4, 1.5], [9.4, -2.2]]) rail.push(s.box(rx, ry, 9.25, 0.18, 0.18, 1.0, m.wood, { sh: 0, sw: 0.6 }));
  s.add(s.group(rail, [-0.6, -2.4, 9.0, 9.7, 5.4, 10.3]));
  rail.length = 0;
  s.add(s.box(-0.5, 5.15, 10.15, 10, 0.12, 0.1, m.wood, { sh: 0, sw: 0.6 }));
  s.add(s.box(9.35, -2.3, 10.15, 0.12, 7.6, 0.1, m.wood, { sh: 0, sw: 0.6 }));
  // Fernglas und Fahne
  s.add(s.group([s.cyl(7.5, 1.0, 9.25, 0.08, 1.3, m.metal, { sh: 0, sw: 0.6 }), s.box(7.2, 0.6, 10.55, 0.9, 0.5, 0.35, m.ink, { sh: 0, sw: 0.7 })]));
  const fl = [s.cyl(2.5, -0.8, 9.25, 0.07, 4.2, m.metal, { sh: 0, sw: 0.6 }), s.prismXZ([[2.57, 13.0], [4.8, 12.4], [4.8, 11.2], [2.57, 11.2]], -0.9, -0.7, m.accent, { sh: 0, sw: 0.8 })];
  s.add(s.group(fl, [2.4, -1.0, 9.25, 4.9, -0.6, 13.5]));
  // Wegweiser
  const wg = [s.cyl(-11, 12.5, 1.6, 0.1, 2.6, m.wood, { sh: 0, sw: 0.6 }),
    s.box(-12.2, 12.38, 3.7, 2.4, 0.15, 0.55, m.wood, { sh: 0, sw: 0.7, decor: (f, sc) => sc.fText(f.L, 'GIPFEL', 1.2, 0.12, 0.3, { align: 'center', stroke: line, sw: 0.9 }) }),
    s.box(-12.2, 12.38, 3.0, 2.4, 0.15, 0.55, m.wood, { sh: 0, sw: 0.7, decor: (f, sc) => sc.fText(f.L, '1:15', 1.2, 0.12, 0.3, { align: 'center', stroke: line, sw: 0.9 }) })];
  s.add(s.group(wg, [-12.4, 12.3, 1.6, -9.6, 12.8, 4.3]));
  // Wanderweg-Zickzack auf den Terrassen
  const wp = (pts, z, w) => s.strip(pts, w, z + 0.02, m.stone.top, { round: false });
  s.add({ ...wp([[-16, 14], [-16, 8], [-4, 8], [-4, 12], [6, 12]], 1.6, 1.2), bbox: [-16, 8, 1.62, 6, 14, 1.62] });
  s.add({ ...wp([[-9, 10], [-9, 6], [0, 6]], 4.6, 1.1), bbox: [-9, 6, 4.62, 0, 10, 4.62] });
  // Wandernde
  s.add(P.person(s, -4, 12, 1.6, { shirt: m.accent, h: 1.7 }));
  s.add(s.box(-4.35, 12.2, 2.9, 0.7, 0.3, 0.8, m.type('activity'), { sh: 0, sw: 0.7 }));
  s.add(P.person(s, -9, 6.8, 4.6, { shirt: m.type('rail') }));
  s.add(P.person(s, 4, 3, 9.25, { shirt: m.type('stay'), h: 1.7 }));
  s.add(P.person(s, 5.4, 2.4, 9.25, { shirt: m.type('ship'), h: 1.55 }));
  // Nadelbäume, Felsen
  s.add(P.conifer(s, -18, 4, 1.6, 6.5)); s.add(P.conifer(s, -17, -2, 1.6, 7.8)); s.add(P.conifer(s, -9.5, -1, 4.6, 5.8));
  s.add(P.conifer(s, 17, 8, 1.6, 6.2)); s.add(P.conifer(s, 19, 2, 1.6, 7.4)); s.add(P.conifer(s, 12, 4, 4.6, 5));
  s.add(P.conifer(s, 22, 15, 0, 6)); s.add(P.conifer(s, -21, 14, 0, 5.6));
  s.add(s.box(14, 13, 1.6, 2.2, 1.6, 1.2, m.stone, { sw: 0.9 }));
  s.add(s.box(15.3, 14.6, 1.6, 1.4, 1.3, 0.8, m.stone, { sw: 0.9 }));
  s.add(P.bush(s, -3, 13.5, 1.6, 0.9)); s.add(P.bush(s, 8, 14, 0, 1.2));
}

module.exports = [
  def('type-Hotel', 'Hotel', 'Isometrische Explosionszeichnung eines Hotels in drei Ebenen: Lobby mit Rezeption und Sofa, Zimmer mit Betten und Schränken, Dachterrasse mit Pool; davor Eingang, Auto und Gepäck.',
    'event-type:Hotel', hotel, {}),
  def('type-Unterkunft', 'Ferienwohnung', 'Isometrische Darstellung eines Ferienhauses mit Satteldach, Terrasse und Pool, Liegen mit Sonnenschirm, Palmen und Auto auf dem Grundstück.',
    'event-type:Unterkunft', unterkunft, {}),
  def('type-Kreuzfahrt', 'Kreuzfahrt', 'Isometrische Darstellung eines Kreuzfahrtschiffs mit fünf Decks, Schornstein und Rettungsbooten am Pier, mit Gangway, Hafenkran, Containern und einsteigenden Reisenden.',
    'event-type:Kreuzfahrt', kreuzfahrt, {}),
  def('type-Ausflug', 'Ausflug', 'Isometrische Darstellung eines Aussichtspunkts: terrassierter Berghang mit Wanderweg, Holzdeck mit Fernglas und Fahne, Wegweiser, Nadelbäume und Wandernde vor einem Bergmassiv.',
    'event-type:Ausflug', ausflug, {}),
];
