'use strict';
const { cropMarks, island, track, waves, sky } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const T = require('../lib/things');
const { tones } = require('../lib/palette');
const { mix } = require('../lib/util');

const def = (id, title, alt, usage, build, setup = {}) => ({ id, kind: 'cover', title, alt, usage, width: 1600, height: 900, build, setup: { pad: [120, 130, 120, 90], ...setup } });
const lineOf = pal => (pal.name === 'light' ? pal.ink : pal.bg);

// ---------------------------------------------------------------- Meer / Hafen
function coverSea(s, pal) {
  const m = s.m, L = lineOf(pal);
  sky(s, { sunX: 1330, sunY: 190, sunR: 84 });
  const WZ = -1.2;
  s.add(s.plate(-40, -22, 40, 20, 1.4, m.water, { z: WZ }), 'ground');
  s.add(waves(s, -40, -22, 40, 20, WZ), 'ground');
  // Mole und Leuchtturm
  s.add(s.plate(12, -22, 40, -10, 3.0, m.stone, { z: 0.4 }), 'ground');
  s.add(s.box(28, -18, 0.4, 4, 4, 0.4, m.stone, { sw: 1, sh: 0 }));
  const lt = [];
  lt.push(s.tube('z', 0.8, 9.2, 30, -16, 2.1, 1.3, m.white, { sh: 0, sw: 1 }));
  lt.push(s.tube('z', 3.4, 4.8, 30, -16, 1.82, 1.74, m.accent, { sh: 0, sw: 0.8, noCap: true }));
  lt.push(s.tube('z', 6.4, 7.8, 30, -16, 1.54, 1.42, m.accent, { sh: 0, sw: 0.8, noCap: true }));
  lt.push(s.box(28.4, -17.6, 9.2, 3.2, 3.2, 0.4, m.ink, { sh: 0, sw: 0.8 }));
  lt.push(s.cyl(30, -16, 9.6, 0.9, 1.5, m.lit, { sh: 0, sw: 0.8 }));
  lt.push(s.dome(30, -16, 11.1, 1.1, m.accent, { sh: 0 }));
  s.add(s.group(lt, [27.8, -18.2, 0.8, 32.2, -13.8, 12.3]));
  // Schiff
  s.add(O.ship(s, -32, -8, { len: 52, wid: 11, hull: 4.4, decks: 5, z: WZ }));
  // Segelboot
  const sb = [];
  sb.push(s.extrude([[2, 8], [10, 8], [12, 9.2], [10, 10.4], [2, 10.4]], WZ, WZ + 1.1, m.white, { sh: 0, sw: 0.9 }));
  sb.push(s.cyl(6.5, 9.2, WZ + 1.1, 0.12, 9.4, m.ink, { sh: 0, sw: 0.6 }));
  sb.push(s.prismXZ([[6.9, WZ + 2.0], [6.9, WZ + 9.6], [11.4, WZ + 2.0]], 9.1, 9.3, m.paper, { sh: 0, sw: 0.9 }));
  sb.push(s.prismXZ([[6.1, WZ + 2.4], [6.1, WZ + 8.4], [2.6, WZ + 2.4]], 9.1, 9.3, m.accent, { sh: 0, sw: 0.9 }));
  s.add(s.group(sb, [1.5, 7.5, WZ, 12.5, 10.8, WZ + 10]));
  // Bojen
  for (const [bx, by] of [[-14, 12], [20, 4], [-30, 14]]) s.add(s.group([s.cyl(bx, by, WZ, 0.7, 1.2, m.accent, { sh: 0, sw: 0.8 }), s.cyl(bx, by, WZ + 1.2, 0.12, 1.5, m.ink, { sh: 0, sw: 0.6 })]));
  // Möwen
  let gl = '';
  for (const [gx, gy] of [[-16, 3, ], [-5, -2], [8, -20]]) { const a = s.P(gx, gy, 14); gl += s.line([[a[0] - 10, a[1] + 3], [a[0] - 4, a[1] - 3], [a[0], a[1] + 1], [a[0] + 4, a[1] - 3], [a[0] + 10, a[1] + 3]], { stroke: L, sw: 1.3, cap: 'round' }); }
  s.raw(gl, 'top');
}

// ---------------------------------------------------------------- Stadt
function coverCity(s, pal) {
  const m = s.m, L = lineOf(pal);
  s.personLod = 0;
  sky(s, { sunX: 1380, sunY: 170, sunR: 78 });
  s.add(s.plate(-34, -24, 34, 24, 1.4, m.ground, { grid: 4 }), 'ground');
  // Fluss
  s.add(s.plate(-34, 4, 34, 12, 1.0, m.water, { z: -0.7 }), 'ground');
  s.add(waves(s, -34, 4, 34, 12, -0.7), 'ground');
  const G = [];
  G.push(s.strip([[-34, -3], [34, -3]], 3.2, 0.02, m.asphalt.top, { round: false }));
  G.push(s.groundLine([[-34, -3], [34, -3]], 0.03, { stroke: pal.surface, sw: 1.2, dash: '5 5' }));
  G.push(s.strip([[-30, -24], [-30, 4]], 3.0, 0.02, m.asphalt.top, { round: false }));
  G.push(s.strip([[6, -24], [6, 4]], 3.0, 0.02, m.asphalt.top, { round: false }));
  s.add(G, 'ground');
  // Brücke
  const br = [];
  br.push(s.box(-5, 3.6, 0.6, 12, 9, 0.5, m.stone, { sw: 1, sh: 0.2 }));
  for (const x of [-4.2, 6]) { br.push(s.box(x, 3.7, 0, 0.8, 0.8, 2.4, m.stone, { sh: 0, sw: 0.8 })); br.push(s.box(x, 12.5, 0, 0.8, 0.8, 2.4, m.stone, { sh: 0, sw: 0.8 })); }
  s.add(s.group(br, [-5, 3.6, 0, 7, 12.6, 3.4]));
  // Gebäude
  const bld = [
    [-28, -22, 8, 8, 13, 'paper', 6, 2], [-18, -22, 7, 8, 8, 'stone', 5, 2], [-9, -22, 9, 9, 18, 'glass', 8, 1], [2, -22, 6, 8, 11, 'paper', 6, 2],
    [10, -22, 8, 8, 24, 'type:rail', 8, 1], [20, -22, 9, 8, 9, 'stone', 7, 2], [-28, -12, 8, 6, 7, 'paper', 5, 2], [-18, -12, 7, 6, 15, 'type:stay', 6, 1],
    [-9, -12, 9, 6, 10, 'stone', 7, 2], [12, -12, 7, 6, 9, 'paper', 5, 2], [22, -12, 8, 6, 14, 'glass', 6, 1],
  ];
  const rm = (n) => (n.startsWith('type:') ? m.type(n.slice(5)) : m[n]);
  bld.forEach((b, i) => {
    const [x, y, w, d, h, mat, cols, rows] = b;
    const material = rm(mat);
    s.add(s.box(x, y, 0, w, d, h, material, {
      sw: 1,
      decor: (f, sc) => {
        let r = sc.windows(f.L, 0.8, 1.0, w - 0.8, h - 0.6, Math.max(2, Math.round((w - 1.6) / 1.5)), Math.max(1, Math.round((h - 1.6) / 2.2)), { inset: 0.2, seed: i, sw: 0.7 });
        r += sc.windows(f.R, 0.8, 1.0, d - 0.8, h - 0.6, Math.max(1, Math.round((d - 1.6) / 1.6)), Math.max(1, Math.round((h - 1.6) / 2.2)), { inset: 0.2, seed: i + 2, sw: 0.7 });
        return r;
      },
    }));
    if (i % 3 === 0) s.add(s.box(x + w * 0.3, y + d * 0.3, h, w * 0.4, d * 0.4, 1.4, m.metal, { sw: 0.8, sh: 0 }));
    if (i === 4) s.add(s.frustum(x + w / 2, y + d / 2, h, w, d, 0.4, 0.4, 7, m.metal, { sw: 0.9, sh: 0 }));
    if (i === 1) s.add(s.gable(x - 0.3, y - 0.3, h, w + 0.6, d + 0.6, 2.4, m.type('activity'), { axis: 'x' }));
  });
  // Turm mit Uhr
  const tw = [s.box(-2, -18, 0, 5, 5, 14, m.paper, { sw: 1, decor: (f, sc) => sc.fCircle(f.L, 2.5, 10.5, 1.5, { fill: pal.surface, stroke: L, sw: 1 }, 22) + sc.fLine(f.L, [[2.5, 10.5], [2.5, 11.6]], { stroke: L, sw: 1, cap: 'round' }) + sc.fLine(f.L, [[2.5, 10.5], [3.3, 10.1]], { stroke: pal.accent, sw: 1, cap: 'round' }) + sc.windows(f.L, 1, 1.5, 4, 7.5, 1, 2, { inset: 0.15 }) }),
    s.frustum(0.5, -15.5, 14, 5.4, 5.4, 0.3, 0.3, 6, m.accent, { sw: 1 })];
  s.add(s.group(tw, [-2, -18, 0, 3, -13, 20]));
  // Bäume, Autos, Menschen
  for (const [x, y] of [[-33, -8], [-14, -7], [0, -7], [17, -7], [32, -8], [-24, 0.5], [16, 0.5], [30, 0.5]]) s.add(P.tree(s, x, y, 0, 4.2 + ((x * 7) % 3) * 0.4));
  s.add(O.car(s, -22, -4.3, 0, { mat: m.type('stay') }));
  s.add(O.car(s, 14, -1.7, 0, { mat: m.accent, suv: true }));
  s.add(O.car(s, -2, -4.3, 0, { mat: m.white }));
  s.add(O.bus(s, 20, -1.9, 0, { len: 9 }));
  const cols = [m.type('rail'), m.type('stay'), m.type('car'), m.accent, m.type('transfer')];
  for (let i = 0; i < 7; i++) s.add(P.person(s, -26 + i * 8.3, 0.5 + (i % 2) * 0.8, 0, { shirt: cols[i % cols.length], h: 1.6 }));
  // Fähre auf dem Fluss
  s.add(O.ship(s, -24, 6.4, { len: 14, wid: 3.6, hull: 1.2, decks: 1, z: -0.7 }));
  for (const x of [-28, -12, 22, 30]) s.add(P.lamp(s, x, 1.5, 0, 5));
}

// ---------------------------------------------------------------- Berge
function coverMountain(s, pal) {
  const m = s.m, L = lineOf(pal);
  sky(s, { sunX: 1300, sunY: 180, sunR: 80 });
  const gr = pal.name === 'light' ? mix(pal.type.car, pal.surface, 0.55) : mix(pal.type.car, pal.bg, 0.55);
  const rockD = pal.name === 'light'
    ? { top: mix(pal.type.car, pal.surface, 0.4), left: mix(m.stone.left, pal.mute, 0.1), right: mix(m.stone.right, pal.ink, 0.1), line: L }
    : { top: mix(pal.type.car, pal.bg, 0.4), left: m.stone.left, right: m.stone.right, line: L };
  s.add(s.plate(-38, -24, 38, 24, 1.4, { top: gr, left: m.stone.left, right: m.stone.right, line: L }, { grid: 4, gridColor: pal.name === 'light' ? mix(gr, pal.ink, 0.1) : mix(gr, pal.ink, 0.1) }), 'ground');
  // See
  s.add(s.plate(-6, 4, 24, 22, 0.8, m.water, { z: 0.15 }), 'ground');
  s.add(waves(s, -6, 4, 24, 22, 0.15), 'ground');
  const peak = (cx, cy, w, h, snow, d) => {
    const dd = d || w;
    const a = [s.frustum(cx, cy, 0, w, dd, 1.4, 1.2, h, rockD, { sw: 1, ox: 0.6 })];
    if (snow) a.push(s.frustum(cx + 0.14 * 0.6, cy, h * 0.72, w * 0.28 + 1.4, dd * 0.28 + 1.2, 1.4, 1.2, h * 0.28, m.white, { sw: 0.9, ox: 0.1 }));
    return s.group(a, [cx - w / 2, cy - dd / 2, 0, cx + w / 2, cy + dd / 2, h]);
  };
  s.add(peak(-24, -16, 18, 22, true));
  s.add(peak(-6, -17, 22, 30, true));
  s.add(peak(14, -15, 18, 24, true));
  s.add(peak(30, -12, 14, 14, false));
  s.add(peak(-32, -2, 10, 10, false));
  // Chalet
  const ch = [];
  ch.push(s.box(-22, 6, 0, 10, 7, 4, m.paper, { decor: (f, sc) => sc.windows(f.L, 0.8, 1.2, 6, 3.4, 2, 1, { inset: 0.1, mullion: true }) + sc.fRect(f.L, 7, 0, 9, 3, { fill: m.wood.left, stroke: L, sw: 0.9 }) }));
  ch.push(s.gable(-23, 5.4, 4, 12, 8.2, 3.4, m.wood, { axis: 'x' }));
  ch.push(s.box(-14, 6.5, 0, 3.5, 3.5, 3.2, m.wood, { sw: 0.9 }));
  s.add(ch);
  s.add(s.group([s.box(-22, 13.2, 0, 10, 0.2, 1.0, m.wood, { sh: 0, sw: 0.7 })]));
  // Steg am See
  s.add(s.box(0, 12, 0.5, 8, 1.4, 0.2, m.wood, { sw: 0.8, sh: 0 }));
  s.add(s.group([s.extrude([[6, 14.4], [10, 14.4], [11.5, 15.4], [10, 16.4], [6, 16.4]], 0.2, 0.9, m.type('activity'), { sh: 0 })]));
  // Seilbahn: Masten und Seil
  const pylons = [[-30, 18], [-8, 0], [14, -8]];
  let cable = [];
  pylons.forEach(p => { s.add(s.box(p[0], p[1], 0, 0.8, 0.8, 9, m.metal, { sw: 0.8, sh: 0 })); cable.push(s.P(p[0] + 0.4, p[1] + 0.4, 9)); });
  s.add({ svg: s.line(cable, { stroke: pal.mute, sw: 1.6 }), bbox: [-30, -8, 9, 14, 18, 9.2], sh: 0 }, 'top');
  const g0 = s.P(3.4, -3.6, 8.9);
  s.raw(s.line([g0, [g0[0], g0[1] + 11]], { stroke: pal.mute, sw: 1.4 }) + s.poly([[g0[0] - 11, g0[1] + 11], [g0[0] + 11, g0[1] + 11], [g0[0] + 13, g0[1] + 30], [g0[0] - 13, g0[1] + 30]], { fill: pal.accent, stroke: L, sw: 1.2 }) + s.poly([[g0[0] - 8, g0[1] + 15], [g0[0] + 8, g0[1] + 15], [g0[0] + 9, g0[1] + 24], [g0[0] - 9, g0[1] + 24]], { fill: m.glass.left, stroke: L, sw: 0.9 }), 'top');
  // Nadelwald
  const trees = [[-30, 8, 7], [-28, 15, 6], [-26, 20, 7.4], [-14, 17, 6], [-9, 20, 5.4], [-33, 21, 6.2], [26, 8, 7], [30, 14, 6.4], [26, 20, 7.2], [32, 21, 5.6], [-3, -4, 5.8], [3, -2, 6.4], [8, 0, 5.4], [-12, -2, 5.4]];
  trees.forEach(t => s.add(P.conifer(s, t[0], t[1], 0, t[2])));
  s.add(P.person(s, 3.5, 10.7, 0.7, { shirt: m.accent }));
  s.add(P.person(s, -10, 11, 0, { shirt: m.type('rail') }));
  s.add(P.person(s, -9, 12.4, 0, { shirt: m.type('stay'), h: 1.5 }));
}

// ---------------------------------------------------------------- Insel
function coverIsland(s, pal) {
  const m = s.m, L = lineOf(pal);
  sky(s, { sunX: 1330, sunY: 180, sunR: 86 });
  const WZ = -1.0;
  s.add(s.plate(-27, -17, 27, 18, 1.6, m.water, { z: WZ }), 'ground');
  s.add(waves(s, -27, -17, 27, 18, WZ), 'ground');
  const sandBase = pal.name === 'light' ? mix(pal.type.stay, pal.surface, 0.62) : mix(pal.type.stay, pal.bg, 0.55);
  const sand = tones(pal, sandBase, { lift: 0.4 });
  // Lagune (heller)
  const lag = pal.name === 'light' ? mix(pal.type.ship, pal.surface, 0.72) : mix(pal.type.ship, pal.bg, 0.45);
  s.add(s.flatPoly([[-23, -13], [-6, -16], [9, -12], [24, -4], [22, 12], [6, 17], [-14, 16], [-25, 5]], WZ + 0.03, lag, { stroke: null }), 'ground');
  // Insel (Sandplatte, konvex)
  const isl = [[-16, -9], [-4, -12], [8, -9], [15, -1], [13, 8], [2, 12], [-10, 10], [-17, 2]];
  s.add(s.extrude(isl, WZ, 0.2, sand, { sh: 0, sw: 1 }));
  // Grüne Kuppe
  const hill = [[-9, -5], [0, -7], [6, -4], [8, 2], [3, 6], [-5, 5], [-10, 0]];
  s.add(s.extrude(hill, 0.2, 1.6, m.green, { sh: 0, sw: 1 }));
  s.add(s.extrude([[-6, -3], [0, -4], [4, -2], [5, 2], [1, 4], [-4, 3], [-7, 0]], 1.6, 2.6, m.green2, { sh: 0, sw: 1 }));
  // Hütte
  const hut = [s.box(-2.5, -1.5, 2.6, 5, 4, 2.6, m.wood, { sw: 1, decor: (f, sc) => sc.fRect(f.L, 1.8, 0, 3.4, 1.9, { fill: m.ink.left, stroke: L, sw: 0.8 }) + sc.fRect(f.L, 0.4, 0.9, 1.4, 1.9, { fill: m.glass.left, stroke: L, sw: 0.7 }) }),
    s.frustum(0, 0.5, 5.2, 6.4, 5.4, 1.0, 1.0, 2.4, m.type('stay'), { sw: 1 })];
  s.add(s.group(hut, [-3.2, -2.2, 2.6, 3.2, 3.2, 7.6]));
  // Palmen, Schirm, Liege
  const palms = [[-9, 4, 7.5, [0.4, -0.3]], [8, 6.5, 8.4, [-0.5, -0.2]], [-13, -2, 6.4, [0.6, 0.1]], [6, -7, 7.2, [-0.2, 0.5]], [12, 2.5, 6.8, [-0.5, 0.3]]];
  palms.forEach(p => s.add(P.palm(s, p[0], p[1], 0.2, p[2], { lean: p[3] })));
  s.add(T.umbrellaParasol(s, -4, 9, 0.2, 2.2, 3.4, m.accent));
  s.add(s.group([s.box(-1, 8.2, 0.2, 3.0, 1.1, 0.3, m.white, { sh: 0, sw: 0.8 }), s.box(1.4, 8.2, 0.5, 1.0, 1.1, 0.5, m.white, { sh: 0, sw: 0.7 })]));
  // Steg und Boot
  s.add(s.box(10, 4, -0.4, 10, 1.6, 0.4, m.wood, { sw: 0.9, sh: 0 }));
  for (let i = 0; i < 3; i++) s.add(s.box(12 + i * 3.4, 3.7, -1, 0.3, 0.3, 0.8, m.wood, { sw: 0.6, sh: 0 }));
  const bt = [s.extrude([[17, 7.5], [22, 7.5], [24, 8.7], [22, 9.9], [17, 9.9]], WZ, WZ + 1.0, m.accent, { sh: 0, sw: 0.9 }), s.cyl(19.5, 8.7, WZ + 1.0, 0.1, 5, m.ink, { sh: 0, sw: 0.6 }), s.prismXZ([[19.8, WZ + 1.8], [19.8, WZ + 5.4], [22.6, WZ + 1.8]], 8.6, 8.8, m.paper, { sh: 0, sw: 0.9 })];
  s.add(s.group(bt, [16.5, 7, WZ, 24.5, 10.3, WZ + 6]));
  // Riffringe
  let rf = '';
  for (const [rx, ry, rr] of [[-19, 12, 3.4], [20, -11, 2.8], [-22, -9, 2.4]]) {
    rf += s.circle(...s.P(rx, ry, WZ + 0.05), 1, { fill: 'none', stroke: null });
    const pts = []; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; pts.push(s.P(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr, WZ + 0.04)); }
    rf += s.poly(pts, { fill: pal.name === 'light' ? pal.surface : pal.mute, op: 0.55, stroke: null });
  }
  s.add({ svg: rf, bbox: [-30, -14, WZ, 28, 18, WZ + 0.05], sh: 0 }, 'ground');
}

module.exports = [
  def('cover-sea', 'Meer und Hafen', 'Reise-Cover: isometrischer Hafen mit grossem Kreuzfahrtschiff, Leuchtturm auf der Mole, Segelboot und Bojen unter einer grossen Sonne.', 'cover:sea', coverSea),
  def('cover-city', 'Stadt', 'Reise-Cover: isometrische Stadt mit Hochhäusern, Uhrturm, Strassen, Brücke über einen Fluss, Fähre, Bäumen und Fussgängern.', 'cover:city', coverCity),
  def('cover-mountain', 'Berge', 'Reise-Cover: isometrische Berglandschaft mit schneebedeckten Gipfeln, See mit Steg, Chalet, Seilbahn und Nadelwald.', 'cover:mountain', coverMountain),
  def('cover-island', 'Insel', 'Reise-Cover: isometrische Tropeninsel mit Palmen, Hütte, Sonnenschirm, Steg, Segelboot und heller Lagune im Meer.', 'cover:island', coverIsland),
];
