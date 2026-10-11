'use strict';
const { cropMarks, island } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const T = require('../lib/things');
const SC = require('../lib/scenery');
const I_toy = (s, x, y, z) => require('../lib/icons').toyPlane(s, x, y, z, 0.6);
const { mix } = require('../lib/util');

const def = (id, title, alt, usage, build, setup = {}) => ({ id, kind: 'empty', title, alt, usage, width: 1200, height: 800, build, setup: { pad: [190, 110, 190, 120], ...setup } });
const lineOf = pal => (pal.name === 'light' ? pal.ink : pal.bg);

// ---------------------------------------------------------------- Keine Reisen
function emptyTrips(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  // Koffer, offen
  const W = 10, D = 6.6, H = 2.4, x0 = -7, y0 = -2;
  const mat = m.type('ship');
  const parts = [];
  // Deckel (nach hinten aufgeklappt) zuerst
  const lid = [[0, H], [-0.55, H], [-3.2, 8.4], [-2.65, 8.4]].map(p => [y0 + p[0], p[1]]);
  parts.push(s.prismYZ(lid, x0, x0 + W, mat, { sh: 0, sw: 1 }));
  // Futter im Deckel (Innenseite, +y)
  const lp = (u, t) => [x0 + u, y0 - 2.65 * t, H + (8.4 - H) * t];
  let inner = s.poly3([lp(0.5, 0.06), lp(W - 0.5, 0.06), lp(W - 0.5, 0.94), lp(0.5, 0.94)], { fill: m.paper.left, stroke: L, sw: 0.9 });
  inner += s.poly3([lp(1.2, 0.12), lp(W - 1.2, 0.12), lp(W - 1.2, 0.5), lp(1.2, 0.5)], { fill: 'none', stroke: pal.mute, sw: 1, dash: '4 3' });
  for (let i = 0; i < 3; i++) inner += s.line3([lp(1.6 + i * 3.2, 0.62), lp(1.6 + i * 3.2, 0.9)], { stroke: pal.accent, sw: 2.2, cap: 'round' });
  parts.push({ svg: inner, bbox: [x0, y0 - 3.3, H, x0 + W, y0, 8.4], sh: 0 });
  // Schale
  parts.push(s.box(x0, y0, 0, W, D, H, mat, {
    sw: 1,
    decor: (f, sc) => {
      let r = sc.fRect(f.L, 0, H * 0.45, W, H * 0.62, { fill: pal.accent, stroke: null });
      r += sc.fRect(f.L, 1.2, 0.0, 1.7, H, { fill: m.metal.left, stroke: L, sw: 0.7 }) + sc.fRect(f.L, W - 1.7, 0.0, W - 1.2, H, { fill: m.metal.left, stroke: L, sw: 0.7 });
      // Innenfutter
      r += sc.fPoly(f.T, [[0.5, 0.5], [W - 0.5, 0.5], [W - 0.5, D - 0.5], [0.5, D - 0.5]], { fill: m.paper.top, stroke: L, sw: 0.9 });
      // Platzhalter für Kleidung
      r += sc.fPoly(f.T, [[1.2, 1.2], [4.6, 1.2], [4.6, 3.6], [1.2, 3.6]], { fill: 'none', stroke: pal.mute, sw: 1.1, dash: '4 3' });
      r += sc.fPoly(f.T, [[5.4, 1.2], [8.8, 1.2], [8.8, 2.6], [5.4, 2.6]], { fill: 'none', stroke: pal.mute, sw: 1.1, dash: '4 3' });
      r += sc.fPoly(f.T, [[5.4, 3.4], [7.2, 3.4], [7.2, 5.4], [5.4, 5.4]], { fill: 'none', stroke: pal.mute, sw: 1.1, dash: '4 3' });
      return r;
    },
  }));
  parts.push(s.box(x0 + 3.6, y0 + D - 0.08, 0.5, 2.8, 0.2, 0.8, m.ink, { sw: 0.7, sh: 0 }));
  s.add(s.group(parts, [x0, y0 - 3.3, 0, x0 + W, y0 + D, 8.4]));
  s.add(s.cyl(x0 + 1.0, y0 + D + 0.6, 0, 0.35, 0.2, m.ink, { sw: 0.7, sh: 0 }));
  // Globus, Pass, Ticket
  s.add(T.globe(s, -10, 6, 0, 2.1));
  s.add(s.box(5.8, 3.5, 0, 1.9, 2.6, 0.16, m.type('doc'), { sw: 0.9, decor: (f, sc) => sc.fCircle(f.T, 0.95, 1.5, 0.5, { fill: 'none', stroke: pal.surface, sw: 1.1 }, 14) }));
  s.add(T.ticketCard(s, 3.0, 6.5, 0, 5.2, 2.6, { dashed: true, head: m.type('rail') }));
  // Kartenmarker und gestrichelter Weg
  s.add({ svg: s.line([s.P(2, 0.5, 0.03), s.P(4.5, -3.5, 0.03), s.P(8, -6, 0.03), s.P(11, -6.5, 0.03)], { stroke: pal.accent, sw: 2, dash: '2 5', cap: 'round' }), bbox: [2, -6.5, 0, 11, 0.5, 0.03], sh: 0 });
  s.add(s.group([s.tube('z', 0.02, 2.2, 11, -6.5, 0.02, 0.8, m.accent, { sh: 0, sw: 1, noCap: true, steps: 18 }), s.sphere(11, -6.5, 2.7, 1.0, m.accent, { sh: 0, sw: 1 })], [10, -7.5, 0, 12, -5.5, 3.8]));
  s.add({ svg: s.circle(...s.P(11, -6.5, 2.7), 3.2, { fill: pal.onAccent, stroke: null }), bbox: [10.9, -6.5, 2.7, 11.1, -6.4, 2.8], sh: 0 });
  // --- Verdichtung: Zimmerecke mit Fenster, Plakaten, Beistelltisch, Kamera, Hut
  s.add(s.box(-13, -11.4, 0, 26, 0.4, 8.2, m.paper, { sw: 1, decor: (f, sc) => {
    let r = sc.windows(f.L, 2.0, 2.0, 8.0, 6.6, 2, 1, { inset: 0.1, mullion: true });
    r += sc.fRect(f.L, 11.5, 2.6, 15.5, 6.4, { fill: m.soft('ship').left, stroke: L, sw: 0.9 }) + sc.fLine(f.L, [[12.2, 3.6], [14, 5.4], [14.8, 4.0]], { stroke: pal.accent, sw: 1.5, cap: 'round' });
    r += sc.fRect(f.L, 17.5, 2.6, 21.5, 6.4, { fill: m.soft('stay').left, stroke: L, sw: 0.9 }) + sc.fCircle(f.L, 19.5, 4.5, 0.9, { fill: pal.accent, stroke: null }, 14);
    return r;
  } }));
  s.add(SC.deckLines(s, -13, -11, 13, 11, 0.01, 1.6), 'ground');
  s.add(T.roundTable(s, 9.4, -6.4, 0, 1.4, 1.6, { cloth: m.type('stay') }));
  s.add(T.tableLamp(s, 9.4, -6.4, 1.7));
  s.add(I_toy(s, 11.0, -5.0, 1.9));
  s.add(s.group([s.box(7.0, 5.0, 0, 2.2, 1.4, 1.2, m.ink, { sw: 0.9, sh: 0.3 }), s.cyl(8.1, 5.7, 1.2, 0.5, 0.4, m.metal, { sh: 0, sw: 0.7 })]));
  s.add(s.group([s.cyl(5.4, 8.4, 0, 1.5, 0.15, m.wood, { sh: 0, sw: 0.7 }), s.cyl(5.4, 8.4, 0.15, 0.8, 0.7, m.wood, { sh: 0, sw: 0.7 }), s.cyl(5.4, 8.4, 0.5, 0.82, 0.18, m.accent, { sh: 0, sw: 0.6 })]));
  s.add(P.palm(s, -12, -9, 0, 6.0, { lean: [0.3, 0.2] }));
}

// ---------------------------------------------------------------- Kein Programm für den Tag
function emptyDay(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  // Tageskalender
  const cw = 9, ch = 10.4, cx = -10, cy = -5;
  const cal = T.cutout(s, [[cx, 0.4], [cx + cw, 0.4], [cx + cw, 0.4 + ch], [cx, 0.4 + ch]], cy, 0.5, m.card, { sw: 1.1, sh: 1 });
  const f = s.frame([0, cy, 0.4], [1, 0, 0], [0, 0, 1], 1, 1);
  let r = s.fPoly(f, [[cx, ch - 2.2], [cx + cw, ch - 2.2], [cx + cw, ch], [cx, ch]], { fill: pal.accent, stroke: null });
  r += s.fText(f, 'SONNTAG', cx + cw / 2, ch - 1.5, 0.85, { align: 'center', stroke: pal.onAccent, sw: 1.7 });
  r += s.fText(f, '11', cx + cw / 2, ch - 5.7, 2.6, { align: 'center', stroke: pal.ink, sw: 2.6 });
  r += s.fText(f, 'OKTOBER', cx + cw / 2, 1.8, 0.7, { align: 'center', stroke: pal.mute, sw: 1.3 });
  for (let i = 0; i < 3; i++) r += s.fLine(f, [[cx + 0.9, 1.2 + i * 0.0], [cx + cw - 0.9, 1.2]], { stroke: pal.line, sw: 0.0 });
  r += s.fPoly(f, [[cx + 0.8, 3.0], [cx + cw - 0.8, 3.0], [cx + cw - 0.8, 4.0], [cx + 0.8, 4.0]], { fill: 'none', stroke: pal.mute, sw: 1.1, dash: '4 3' });
  cal.svg += r;
  s.add(s.group([s.box(cx + 1.2, cy - 1.8, 0, 1.0, 2.0, 0.4, m.metal, { sh: 0, sw: 0.7 }), s.box(cx + cw - 2.2, cy - 1.8, 0, 1.0, 2.0, 0.4, m.metal, { sh: 0, sw: 0.7 })]));
  s.add(cal);
  // Liegestuhl, Schirm, Tisch (gross)
  const lx = -1, ly = 1.5;
  const lg = [];
  lg.push(s.box(lx, ly, 1.0, 6.2, 2.3, 0.3, m.type('ship'), { sw: 1, sh: 0 }));
  lg.push(s.prismXZ([[lx + 6.2, 1.0], [lx + 7.4, 1.0], [lx + 9.4, 4.4], [lx + 8.2, 4.4]], ly + 0.05, ly + 2.25, m.type('ship'), { sw: 1, sh: 0 }));
  for (const [a_, b_] of [[0.1, 0.1], [0.1, 2.0], [5.8, 0.1], [5.8, 2.0]]) lg.push(s.box(lx + a_, ly + b_, 0, 0.3, 0.3, 1.0, m.wood, { sw: 0.7, sh: 0 }));
  lg.push(s.box(lx + 0.6, ly + 0.2, 1.3, 2.0, 1.9, 0.2, m.accent, { sw: 0.8, sh: 0 }));
  s.add(s.group(lg, [lx, ly, 0, lx + 9.4, ly + 2.4, 4.5]));
  s.add(T.umbrellaParasol(s, 5.5, -1.0, 0, 3.6, 6.2, m.accent));
  s.add(T.roundTable(s, 4.5, 7.5, 0, 1.2, 1.1, {}));
  s.add(s.cyl(4.0, 7.2, 1.16, 0.32, 0.9, m.glass, { sh: 0, sw: 0.8 }));
  s.add(s.cyl(5.1, 7.9, 1.16, 0.22, 0.16, m.type('stay'), { sh: 0, sw: 0.7 }));
  s.add(P.palm(s, 10.5, -6, 0, 8.5, { lean: [-0.3, 0.1] }));
  s.add(P.bush(s, -11, 7, 0, 1.5));
  s.add(s.cyl(-4, 6.5, 0, 2.4, 0.12, m.type('ship'), { sh: 0, sw: 0.8 }));
  // --- Verdichtung: Holzdeck, Geländer, Meer, Segelboot, Zubehör
  s.add(SC.deckLines(s, -13, -11, 13, 11, 0.01, 1.2), 'ground');
  s.add(s.plate(-13, -22, 13, -11, 1.2, m.water, { z: -0.8 }), 'ground');
  s.add(require('../lib/common').waves(s, -13, -22, 13, -11, -0.8), 'ground');
  s.add(SC.fenceX(s, -13, 13, -10.4, 1.2, 1.0));
  const sb = [s.extrude([[-2, -17], [4, -17], [5.6, -16], [4, -15], [-2, -15]], -0.8, 0.2, m.white, { sh: 0, sw: 0.9 }), s.cyl(1.2, -16, 0.2, 0.1, 5.4, m.ink, { sh: 0, sw: 0.6 }), s.prismXZ([[1.5, 0.6], [1.5, 5.4], [4.4, 0.6]], -16.1, -15.9, m.paper, { sh: 0, sw: 0.9 }), s.prismXZ([[0.9, 0.9], [0.9, 4.6], [-1.4, 0.9]], -16.1, -15.9, m.accent, { sh: 0, sw: 0.9 })];
  s.add(s.group(sb, [-2.5, -17.5, -0.8, 6, -14.5, 5.6]));
  s.add(s.group([s.box(3.6, 8.0, 0, 1.8, 1.2, 1.0, m.type('ship'), { sw: 0.9, sh: 0.3, decor: (f, sc) => sc.fRect(f.L, 0, 0.55, 1.8, 0.75, { fill: pal.surface, stroke: null }) }), s.box(3.5, 7.9, 1.0, 2.0, 1.4, 0.15, m.white, { sh: 0, sw: 0.7 })]));
  s.add(s.group([s.cyl(-4.2, 8.6, 0, 0.5, 0.12, m.type('stay'), { sh: 0, sw: 0.6 }), s.sphere(-4.2, 8.6, 0.5, 0.45, m.white, { sh: 0, sw: 0.6, flat: true })]));
  s.add(P.person(s, -1.6, 4.6, 0, { shirt: m.type('stay'), h: 1.7, hat: true, hatMat: m.accent, bag: 'shoulder', skin: 1 }));
}

// ---------------------------------------------------------------- Keine Dokumente
function emptyDocuments(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  // Eingangskorb (zwei Ebenen)
  const tray = (z, mat) => {
    const w = 13, d = 9, t = 0.4, h = 1.8;
    const a = [];
    a.push(s.box(-6.5, -4.5, z, w, d, t, mat, { sw: 1, sh: 0 }));
    a.push(s.box(-6.5, -4.5, z + t, w, t, h, mat, { sw: 1, sh: 0 }));
    a.push(s.box(-6.5, -4.5, z + t, t, d, h, mat, { sw: 1, sh: 0 }));
    a.push(s.box(-6.5 + w - t, -4.5, z + t, t, d, h * 0.55, mat, { sw: 1, sh: 0 }));
    a.push(s.box(-6.5, -4.5 + d - t, z + t, w, t, h * 0.55, mat, { sw: 1, sh: 0 }));
    return a;
  };
  const base = [];
  // Rückwand, Stützen, untere Ablage leer, obere Ablage mit Platzhalter
  base.push(s.box(-6.5, -4.5, 0, 0.5, 0.5, 6.4, m.metal, { sw: 0.8, sh: 0 }));
  base.push(s.box(6.0, -4.5, 0, 0.5, 0.5, 6.4, m.metal, { sw: 0.8, sh: 0 }));
  base.push(s.box(-6.5, 4.0, 0, 0.5, 0.5, 6.4, m.metal, { sw: 0.8, sh: 0 }));
  base.push(s.box(6.0, 4.0, 0, 0.5, 0.5, 6.4, m.metal, { sw: 0.8, sh: 0 }));
  s.add(s.group(base, [-6.5, -4.5, 0, 6.5, 4.5, 6.4]));
  const t0 = s.group(tray(0.6, m.type('ship')), [-6.5, -4.5, 0.6, 6.5, 4.5, 2.8]);
  s.add(t0);
  s.add({ svg: s.fPoly(s.frame([-6.0, 4.0, 1.0], [1, 0, 0], [0, -1, 0], 1, 1), [[0.8, 1], [11.2, 1], [11.2, 7.4], [0.8, 7.4]], { fill: 'none', stroke: pal.accent, sw: 1.4, dash: '5 4' }), bbox: [-6, -4, 1.0, 6, 4, 1.0], sh: 0 });
  const t1 = s.group(tray(4.6, m.type('ship')), [-6.5, -4.5, 4.6, 6.5, 4.5, 6.8]);
  s.add(t1);
  s.add({ svg: s.fPoly(s.frame([-6.0, 4.0, 5.0], [1, 0, 0], [0, -1, 0], 1, 1), [[0.8, 1], [11.2, 1], [11.2, 7.4], [0.8, 7.4]], { fill: 'none', stroke: pal.accent, sw: 1.4, dash: '5 4' }), bbox: [-6, -4, 5, 6, 4, 5], sh: 0 });
  // Schwebendes PDF
  const sz = 9.6;
  const sheet = s.box(-3.4, -3.0, sz, 6.4, 8.2, 0.14, m.card, {
    sw: 1, sh: 0.6,
    decor: (f, sc) => {
      const T_ = f.T;
      let r = sc.fRect(T_, 0.5, 6.0, 2.9, 7.6, { fill: pal.accent, stroke: null });
      r += sc.fText(T_, 'PDF', 1.7, 6.3, 0.8, { align: 'center', stroke: pal.onAccent, sw: 1.5 });
      for (let i = 0; i < 5; i++) r += sc.fLine(T_, [[0.7, 4.8 - i * 0.9], [5.7 - (i % 2) * 1.2, 4.8 - i * 0.9]], { stroke: pal.mute, sw: 1.3, cap: 'round', sop: 0.85 });
      r += sc.fPoly(T_, [[3.4, 6.0], [5.7, 6.0], [5.7, 7.6], [3.4, 7.6]], { fill: 'none', stroke: pal.line, sw: 1 });
      return r;
    },
  });
  s.add(sheet);
  // Fall-Linien
  let g = '';
  for (const [px, py] of [[-3.4, -3.0], [3.0, -3.0], [3.0, 5.2], [-3.4, 5.2]]) g += s.line([s.P(px, py, sz), s.P(px, py, 5.4)], { stroke: pal.accent, sw: 1.2, dash: '2 4', cap: 'round' });
  s.add({ svg: g, bbox: [-3.4, -3, 5.4, 3, 5.2, sz], sh: 0 });
  // Ordner und Stempel
  s.add(s.box(9.6, -2, 0, 1.0, 4.4, 3.4, m.type('doc'), { sw: 0.9, decor: (f, sc) => sc.fRect(f.R, 0.4, 1.0, 4.0, 2.4, { fill: m.paper.left, stroke: L, sw: 0.8 }) }));
  s.add(s.box(10.7, -2, 0, 1.0, 4.4, 3.4, m.type('stay'), { sw: 0.9 }));
  s.add(s.group([s.cyl(-9.5, 6.4, 0, 0.9, 0.3, m.ink, { sh: 0, sw: 0.7 }), s.cyl(-9.5, 6.4, 0.3, 0.2, 1.2, m.wood, { sh: 0, sw: 0.6 }), s.sphere(-9.5, 6.4, 1.8, 0.55, m.wood, { sh: 0, sw: 0.6 })]));
  s.add(P.bush(s, -11, -8, 0, 1.3)); s.add(P.bush(s, 11, -8, 0, 1.2));
  // --- Verdichtung: Büroecke mit Regal, Aktenschrank, Uhr, Lampe, Papierkorb
  s.add(s.box(-13, -11.4, 0, 26, 0.4, 8.6, m.paper, { sw: 1, decor: (f, sc) => sc.windows(f.L, 17, 2.4, 23, 7.4, 2, 1, { inset: 0.1, mullion: true }) }));
  s.add(SC.bookshelf(s, -11.5, -10.6, 0, 7, 6.4, 1.1, 4));
  s.add(SC.cabinet(s, -3, -10.6, 0, 3.4, 1.8, 3.8, 3));
  s.add(T.clockFace(s, 4.6, -11.0, 6.6, 1.5, 9, 40));
  s.add(s.cyl(10.6, -7.0, 0, 0.9, 1.6, m.metal, { sw: 0.9 }));
  s.add(T.sheet(s, 9.8, -6.2, 0, 1.6, 1.2, { lines: 2 }));
  s.add(P.person(s, 9.6, 5.0, 0, { shirt: m.type('stay'), jacket: m.type('car'), h: 1.8, bag: 'shoulder', hairI: 1 }));
  s.add(s.group([s.box(7.0, 7.4, 0, 2.4, 1.6, 0.3, m.wood, { sh: 0, sw: 0.7 })]));
  s.add(T.plant(s, 11.4, 7.2, 0, 2.2));
}

// ---------------------------------------------------------------- Keine Ausgaben
function emptyLedger(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  const mat = m.type('safety');
  const W = 11, D = 7.4, H = 3.2, x0 = -7, y0 = -3;
  const parts = [];
  const lid = [[0, H], [-0.5, H], [-2.9, 7.2], [-2.4, 7.2]].map(p => [y0 + p[0], p[1]]);
  parts.push(s.prismYZ(lid, x0, x0 + W, mat, { sh: 0, sw: 1 }));
  parts.push(s.box(x0, y0, 0, W, D, H, mat, {
    sw: 1,
    decor: (f, sc) => {
      let r = sc.fRect(f.L, W / 2 - 0.6, H - 1.6, W / 2 + 0.6, H - 0.5, { fill: m.metal.left, stroke: L, sw: 0.8 });
      r += sc.fCircle(f.L, W / 2, H - 1.05, 0.15, { fill: m.ink.left, stroke: null }, 8);
      r += sc.fPoly(f.T, [[0.5, 0.5], [W - 0.5, 0.5], [W - 0.5, D - 0.5], [0.5, D - 0.5]], { fill: m.paper.top, stroke: L, sw: 0.9 });
      r += sc.fPoly(f.T, [[0.9, 0.9], [4.2, 0.9], [4.2, D - 0.9], [0.9, D - 0.9]], { fill: 'none', stroke: pal.mute, sw: 1, dash: '4 3' });
      r += sc.fPoly(f.T, [[4.8, 0.9], [W - 0.9, 0.9], [W - 0.9, D - 0.9], [4.8, D - 0.9]], { fill: 'none', stroke: pal.mute, sw: 1, dash: '4 3' });
      return r;
    },
  }));
  s.add(s.group(parts, [x0, y0 - 2.9, 0, x0 + W, y0 + D, 7.2]));
  // Münzen: eine Reihe daneben, eine in der Luft
  s.add(T.coin(s, 6.4, 4.2, 0, 1.0));
  s.add(T.coin(s, 8.4, 3.2, 0, 1.0));
  s.add(T.coin(s, 8.6, 5.4, 0, 1.0));
  s.add(T.coin(s, 8.4, 3.2, 0.12, 1.0));
  const cf = s.frame([8.4, 3.2, 0.24], [1, 0, 0], [0, -1, 0], 1, 1);
  // Taschenrechner
  s.add(s.box(-12, 2.5, 0, 3.4, 5, 0.4, m.ink, {
    sw: 0.9,
    decor: (f, sc) => {
      let r = sc.fRect(f.T, 0.3, 3.4, 3.1, 4.7, { fill: m.glass.top, stroke: L, sw: 0.7 });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) r += sc.fRect(f.T, 0.35 + i * 0.95, 0.3 + j * 0.7, 1.05 + i * 0.95, 0.8 + j * 0.7, { fill: j === 0 && i === 2 ? pal.accent : m.metal.top, stroke: null });
      return r;
    },
  }));
  // Kassenzettel
  s.add(T.sheet(s, 1.5, 6.4, 0, 2.0, 5.4, { lines: 5 }));
  s.add(s.group([s.cyl(-1, 8.5, 0, 0.12, 3.2, m.accent, { sh: 0, sw: 0.6 })]));
  s.add(P.bush(s, -11, -8, 0, 1.2)); s.add(P.bush(s, 11, -8.4, 0, 1.3));
  // --- Verdichtung: Kontor mit Regal voller Hauptbücher, Tresor, Brieftasche, Spiess
  s.add(s.box(-13, -11.4, 0, 26, 0.4, 8.4, m.paper, { sw: 1 }));
  s.add(SC.bookshelf(s, -12.5, -10.6, 0, 8, 6.6, 1.1, 4));
  s.add(s.box(0.5, -10.4, 0, 4.2, 2.4, 4.2, m.ink, { sw: 1, sh: 0.5, decor: (f, sc) => sc.fCircle(f.L, 2.1, 2.1, 1.2, { fill: m.metal.left, stroke: L, sw: 1 }, 20) + sc.fLine(f.L, [[2.1, 2.1], [2.9, 2.7]], { stroke: L, sw: 1.8, cap: 'round' }) + sc.fRect(f.L, 3.6, 1.8, 3.9, 2.4, { fill: m.metal.top, stroke: L, sw: 0.7 }) }));
  s.add(s.box(9.4, -4.5, 0, 3.0, 2.0, 0.4, m.wood, { sw: 0.9, sh: 0.3 }));
  s.add(s.box(9.6, -4.3, 0.4, 2.6, 1.6, 0.2, m.type('car'), { sw: 0.8, sh: 0, decor: (f, sc) => sc.fLine(f.T, [[0.3, 0.8], [2.3, 0.8]], { stroke: pal.surface, sw: 1.2, cap: 'round' }) }));
  s.add(T.sheet(s, 5.2, 3.6, 0, 3.4, 2.6, { lines: 5 }));
  s.add(s.group([s.cyl(8.8, 6.4, 0, 0.35, 0.1, m.metal, { sh: 0, sw: 0.5 }), s.cyl(8.8, 6.4, 0.1, 0.07, 1.8, m.metal, { sh: 0, sw: 0.5, steps: 8 })]));
  s.add(T.coin(s, 9.8, 7.4, 0, 0.7)); s.add(T.coin(s, 11.0, 6.8, 0, 0.7)); s.add(T.coin(s, 4.2, 8.4, 0, 0.7));
  s.add(P.person(s, 10.5, 1.4, 0, { shirt: m.type('rail'), h: 1.8, jacket: m.type('ship'), hairI: 2, skin: 3 }));
}

// ---------------------------------------------------------------- Offline
function offline(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  // Tisch mit Router
  s.add(s.group([
    s.box(-8, -4, 2.2, 10, 6, 0.4, m.wood, { sw: 1, sh: 0 }),
    s.box(-7.6, -3.6, 0, 0.5, 0.5, 2.2, m.wood, { sw: 0.8, sh: 0 }), s.box(1.1, -3.6, 0, 0.5, 0.5, 2.2, m.wood, { sw: 0.8, sh: 0 }),
    s.box(-7.6, 1.1, 0, 0.5, 0.5, 2.2, m.wood, { sw: 0.8, sh: 0 }), s.box(1.1, 1.1, 0, 0.5, 0.5, 2.2, m.wood, { sw: 0.8, sh: 0 })], [-8, -4, 0, 2, 2, 2.6]));
  const rt = s.box(-5.5, -2.4, 2.6, 5.6, 3.2, 0.9, m.white, {
    sw: 1,
    decor: (f, sc) => { let r = ''; for (let i = 0; i < 4; i++) r += sc.fCircle(f.L, 0.7 + i * 0.5, 0.45, 0.12, { fill: i === 0 ? pal.accent : m.metal.right, stroke: L, sw: 0.5 }, 8); r += sc.fLine(f.L, [[3.2, 0.45], [5.0, 0.45]], { stroke: pal.mute, sw: 1, cap: 'round' }); return r; },
  });
  s.add(s.group([rt, s.cyl(-4.6, -1.8, 3.5, 0.1, 2.4, m.ink, { sh: 0, sw: 0.6 }), s.cyl(-1.2, -1.8, 3.5, 0.1, 2.4, m.ink, { sh: 0, sw: 0.6 })], [-5.5, -2.4, 2.6, 0.1, 0.8, 6]));
  // Funk-Tafel mit durchgestrichenem WLAN-Symbol (stehend)
  const bx = 5, by = -7, bw = 9, bh = 8.6;
  const board = T.cutout(s, [[bx, 0.4], [bx + bw, 0.4], [bx + bw, 0.4 + bh], [bx, 0.4 + bh]], by, 0.6, m.card, { sw: 1.2, sh: 1 });
  const f = s.frame([0, by, 0.4], [1, 0, 0], [0, 0, 1], 1, 1);
  const cx = bx + bw / 2, cz = 2.6;
  let r = '';
  for (const rad of [3.9, 2.8, 1.7]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = (-Math.PI / 4) + (i / 12) * (Math.PI / 2); pts.push([cx + Math.sin(a) * rad, cz + Math.cos(a) * rad]); }
    r += s.fLine(f, pts, { stroke: pal.ink, sw: 5, cap: 'round' });
  }
  r += s.fCircle(f, cx, cz, 0.55, { fill: pal.ink, stroke: null }, 12);
  r += s.fLine(f, [[bx + 1.3, 7.8], [bx + bw - 1.3, 1.0]], { stroke: pal.accent, sw: 6, cap: 'round' });
  board.svg += r;
  s.add(s.group([s.box(bx + 1.2, by - 1.6, 0, 1.2, 1.8, 0.4, m.metal, { sh: 0, sw: 0.7 }), s.box(bx + bw - 2.4, by - 1.6, 0, 1.2, 1.8, 0.4, m.metal, { sh: 0, sw: 0.7 })]));
  s.add(board);
  // Steckdose + Kabel mit getrenntem Stecker
  s.add(s.box(-12, 5, 0, 2.4, 1.6, 1.2, m.metal, { sw: 0.9, decor: (f, sc) => sc.fCircle(f.L, 0.8, 0.6, 0.18, { fill: m.ink.left, stroke: null }, 8) + sc.fCircle(f.L, 1.6, 0.6, 0.18, { fill: m.ink.left, stroke: null }, 8) }));
  const cab = [s.P(-4, 1.5, 2.6), s.P(-3.4, 3, 0.05), s.P(0, 5, 0.05), s.P(3, 4.2, 0.05), s.P(5, 6.5, 0.05), s.P(8.2, 7.4, 0.05)];
  s.add({ svg: s.line(cab, { stroke: m.ink.left, sw: 3, cap: 'round' }), bbox: [-4, 1.5, 0, 8.2, 7.4, 2.6], sh: 0 });
  s.add(s.group([s.box(8.2, 6.8, 0, 2.2, 1.4, 0.9, m.ink, { sw: 0.9 }), s.box(10.4, 7.0, 0.25, 1.0, 0.1, 0.12, m.metal, { sw: 0.5, sh: 0 }), s.box(10.4, 7.8, 0.25, 1.0, 0.1, 0.12, m.metal, { sw: 0.5, sh: 0 })], [8.2, 6.8, 0, 11.4, 8.4, 1]));
  // Funken
  const sp = [s.P(11.6, 7.4, 0.8), s.P(12.4, 6.6, 1.6), s.P(12.0, 7.4, 2.4)];
  s.add({ svg: s.line([s.P(12, 7.6, 0.5), s.P(12.7, 7.0, 1.3), s.P(12.2, 7.0, 1.3), s.P(13, 6.4, 2.2)], { stroke: pal.accent, sw: 1.8, cap: 'round' }), bbox: [12, 6.4, 0.5, 13, 7.6, 2.2], sh: 0 });
  s.add(P.bush(s, -11, -9, 0, 1.2));
  // --- Verdichtung: Funkmast, Laptop ohne Verbindung, Telefon, Steckerleiste
  s.add(SC.mast(s, -11.4, -8.4, 0, 7.5));
  s.add(SC.laptop(s, -2.6, -2.4, 2.6, { icon: 'nowifi' }));
  s.add(T.phone(s, -7.4, -1.4, 2.6, 1.2, 2.4));
  s.add(s.box(-5.2, 5.2, 0, 4.4, 1.0, 0.5, m.ink, { sw: 0.9, sh: 0.3, decor: (f, sc) => { let r = ''; for (let i = 0; i < 4; i++) r += sc.fRect(f.T, 0.4 + i * 1.0, 0.25, 1.0 + i * 1.0, 0.75, { fill: m.metal.right, stroke: null }); return r + sc.fCircle(f.T, 4.0, 0.5, 0.15, { fill: pal.accent, stroke: null }, 8); } }));
  s.add(P.tree(s, 11, 9, 0, 5.4)); s.add(P.bush(s, 3, 9.4, 0, 1.2));
  s.add(P.person(s, 5.6, 4.0, 0, { shirt: m.type('rail'), h: 1.75, bag: 'backpack', skin: 2 }));
  s.add(SC.signPost(s, 10, -3.5, 0, '?', { h: 3.0, r: 0.8 }));
}

// ---------------------------------------------------------------- Fehler
function error(s, pal) {
  const m = s.m, L = lineOf(pal);
  cropMarks(s);
  island(s, -13, -11, 13, 11, { th: 1.2, grid: 4 });
  // Strassensperre
  const bar = [];
  bar.push(s.box(-9, -1.2, 0, 0.5, 1.4, 3.0, m.metal, { sw: 0.9, sh: 0 }));
  bar.push(s.box(7.5, -1.2, 0, 0.5, 1.4, 3.0, m.metal, { sw: 0.9, sh: 0 }));
  s.add(s.group(bar, [-9, -1.2, 0, 8, 0.2, 3]));
  const stripes = [];
  const bw = 16.5, n = 11;
  for (let i = 0; i < n; i++) stripes.push(s.box(-8.6 + i * bw / n, -0.9, 1.6, bw / n, 0.5, 1.0, i % 2 ? m.white : m.accent, { sw: 0.9, sh: 0 }));
  s.add(s.group(stripes, [-8.6, -0.9, 1.6, 8, -0.4, 2.6]));
  s.add(s.group([s.box(-8.6, -0.9, 0.2, bw, 0.5, 0.9, m.paper, { sw: 0.9, sh: 0 })], [-8.6, -0.9, 0.2, 8, -0.4, 1.1]));
  // Warndreieck
  const tx = 0, ty = 5, th = 6.2;
  const tri = T.cutout(s, [[tx - 3.6, 3.6], [tx + 3.6, 3.6], [tx, 3.6 + th]], ty, 0.5, m.accent, { sw: 1.2, sh: 1 });
  const f = s.frame([0, ty, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  tri.svg += s.fPoly(f, [[tx - 2.4, 4.4], [tx + 2.4, 4.4], [tx, 4.4 + 4.2]], { fill: pal.name === 'light' ? pal.surface : pal.surface, stroke: L, sw: 1.0 });
  tri.svg += s.fText(f, '!', tx, 4.9, 2.4, { align: 'center', stroke: pal.ink, sw: 3 });
  s.add(s.group([s.cyl(tx, ty - 0.6, 0, 0.14, 3.6, m.metal, { sh: 0, sw: 0.7 }), s.box(tx - 1.2, ty - 1.3, 0, 2.4, 1.4, 0.3, m.stone, { sh: 0, sw: 0.8 })]));
  s.add(tri);
  // Pylonen
  for (const [cx, cy] of [[-11, 4], [-8.5, 7], [10, 4.5], [8, 8]]) s.add(P.cone(s, cx, cy));
  // Werkzeugkasten mit Schraubenschlüssel
  s.add(s.box(5, -8, 0, 4.4, 2.4, 1.4, m.type('activity'), { sw: 0.9, decor: (f, sc) => sc.fRect(f.L, 0.2, 0.9, 4.2, 1.1, { fill: m.ink.left, stroke: null }) + sc.fRect(f.L, 1.8, 0.7, 2.6, 1.3, { fill: m.metal.top, stroke: L, sw: 0.7 }) }));
  const wr = [s.P(-5.5, -7, 0.05), s.P(-9, -9.5, 0.05)];
  s.add({ svg: s.line(wr, { stroke: m.ink.left, sw: 7, cap: 'round' }) + s.line(wr, { stroke: m.metal.left, sw: 4.5, cap: 'round' }) + s.circle(wr[0][0], wr[0][1], 6, { fill: 'none', stroke: m.ink.left, sw: 4 }) + s.circle(wr[1][0], wr[1][1], 6.4, { fill: 'none', stroke: m.ink.left, sw: 4 }), bbox: [-9, -9.5, 0, -5.5, -7, 0.05], sh: 0 });
  // Zahnrad (kaputt) am Boden
  const gx = -3, gy = -7;
  s.add(s.cyl(gx, gy, 0, 1.8, 0.5, m.metal, { sw: 0.9 }));
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; if (i === 5) continue; s.add(s.box(gx + Math.cos(a) * 1.9 - 0.3, gy + Math.sin(a) * 1.9 - 0.3, 0, 0.6, 0.6, 0.5, m.metal, { sw: 0.7, sh: 0 })); }
  s.add(s.cyl(gx, gy, 0.5, 0.6, 0.02, m.ink, { sh: 0, sw: 0.7 }));
  s.add(P.lamp(s, -12, 8, 0, 6));
  // --- Verdichtung: Baustelle mit Strasse, Bagger, Ampel, Kies, Bauhelm
  s.add(s.flatPoly([[-13, 3.5], [13, 3.5], [13, 9.5], [-13, 9.5]], 0.02, m.asphalt.top, { stroke: null }), 'ground');
  s.add(s.groundLine([[-13, 6.5], [13, 6.5]], 0.03, { stroke: pal.surface, sw: 1.3, dash: '6 5' }), 'ground');
  s.add(s.groundLine([[-6, 3.5], [-4.8, 5.0], [-5.8, 6.2], [-4.4, 7.4]], 0.03, { stroke: pal.ink, sw: 1.1, sop: 0.6 }), 'ground');
  // Mini-Bagger
  const ex = [s.box(5.4, 5.0, 0, 4.8, 2.4, 0.9, m.ink, { sw: 0.9, sh: 0.3 }),
    s.box(6.2, 5.2, 0.9, 2.4, 2.0, 1.5, m.type('stay'), { sw: 0.9, sh: 0.2, decor: (f, sc) => sc.fRect(f.L, 0.2, 0.3, 1.5, 1.2, { fill: m.glass.left, stroke: L, sw: 0.7 }) }),
    s.prismXZ([[5.2, 1.6], [5.7, 1.6], [3.0, 3.8], [2.6, 3.4]], 5.8, 6.4, m.type('stay'), { sw: 0.9, sh: 0 }),
    s.prismXZ([[2.8, 3.6], [3.2, 3.2], [1.2, 1.8], [1.2, 2.4]], 5.8, 6.4, m.type('stay'), { sw: 0.9, sh: 0 })];
  s.add(s.group(ex, [1, 5, 0, 10.4, 7.6, 3.9]));
  s.add(s.frustum(-9.5, 7.0, 0, 3.4, 2.6, 1.0, 0.8, 1.7, m.stone, { sw: 0.9 }));
  s.add(SC.trafficLight(s, 12, 3.2, 0, 4.2));
  s.add(P.person(s, 3.4, 2.6, 0, { shirt: m.accent, jacket: m.accent, h: 1.8, hat: true, hatMat: m.type('stay'), skin: 2 }));
  s.add(P.person(s, -1.8, 1.8, 0, { shirt: m.type('rail'), h: 1.75, bag: 'backpack', hairI: 1 }));
  s.add(P.cone(s, -3, 3)); s.add(P.cone(s, 1.6, 9.8)); s.add(P.cone(s, 11, 9.6));
}

module.exports = [
  def('empty-trips', 'Noch keine Reisen', 'Offener, leerer Koffer mit gestrichelten Platzhaltern für Kleidung, daneben ein Globus, ein Reisepass, ein leeres Ticket und eine Kartenmarkierung am Ende eines gestrichelten Wegs.', 'empty-state:trips', emptyTrips),
  def('empty-day', 'Nichts geplant', 'Tageskalenderblatt mit leerem Stundenraster neben Liegestuhl, Sonnenschirm und einem Getränk auf einem Tisch unter einer Palme: ein freier Tag.', 'empty-state:day', emptyDay),
  def('empty-documents', 'Keine Dokumente', 'Zweistöckiger Eingangskorb mit gestrichelten Ablagefeldern; ein PDF-Blatt schwebt über dem Korb, daneben Ordner und ein Stempel.', 'empty-state:documents', emptyDocuments),
  def('empty-ledger', 'Keine Ausgaben', 'Leere offene Geldkassette mit gestrichelten Fächern, daneben einzelne Münzen, ein Taschenrechner und ein Kassenzettel.', 'empty-state:ledger', emptyLedger),
  def('offline', 'Offline', 'Router auf einem Tisch, dahinter eine Tafel mit durchgestrichenem WLAN-Symbol; das Netzkabel liegt abgezogen neben der Steckdose.', 'state:offline', offline),
  def('error', 'Fehler', 'Strassensperre mit rot-weissem Balken, Warndreieck mit Ausrufezeichen, Pylonen, Werkzeugkasten mit Schraubenschlüssel und ein defektes Zahnrad.', 'state:error', error),
];
