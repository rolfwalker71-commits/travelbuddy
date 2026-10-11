'use strict';
const { cropMarks, island, badge } = require('../lib/common');
const P = require('../lib/props');
const O = require('../lib/objects');
const T = require('../lib/things');
const I = require('../lib/icons');
const { mix } = require('../lib/util');

const def = (id, title, alt, usage, build, setup = {}) => ({ id, kind: 'help', title, alt, usage, width: 1200, height: 800, build, setup: { pad: [50, 40, 50, 50], ...setup } });
const Z = 0.7; // Oberkante der Stationsplattform

/** Gemeinsame Bühne: Inselplatte, Förderband als durchgehender Ring, vier Plattformen. */
function stage(s, pal, mode = 'belt') {
  cropMarks(s);
  const K = 9.6, H = 4.9;
  island(s, -K - H - 1.4, -K - H - 1.4, K + H + 1.4, K + H + 1.4, { th: 1.3, grid: 4, dims: false });
  const C = [[-K, -K], [K, -K], [K, K], [-K, K]];
  const seg = (p, q) => {
    const dx = Math.sign(q[0] - p[0]), dy = Math.sign(q[1] - p[1]);
    return [[p[0] + dx * H, p[1] + dy * H], [q[0] - dx * H, q[1] - dy * H]];
  };
  for (let i = 0; i < 3; i++) { const [p, q] = seg(C[i], C[i + 1]); s.add(I.belt(s, p, q, { mode, w: 2.6 })); }
  C.forEach(c => s.add(I.plinth(s, c[0], c[1], H * 2)));
  return C;
}
const BZ = 0.45; // Oberkante Band

// ---------------------------------------------------------------- Teilen und Hochladen
function helpShare(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal);
  const [a, b, c, d] = C;
  // Dokumente wandern auf dem Band: PDF -> Vorschlag -> bestätigt
  for (const x of [-4, 0, 4]) s.add(T.sheet(s, x - 1.2, a[1] - 1.1, BZ, 2.4, 2.2, { lines: 3 }));
  for (const y of [-4, 0, 4]) s.add(T.ticketCard(s, b[0] - 1.1, y - 1.2, BZ, 2.2, 2.4, { dashed: true, head: m.type('stay'), t: 0.1 }));
  for (const x of [4, 0, -4]) s.add(T.ticketCard(s, x - 1.2, c[1] - 1.1, BZ, 2.4, 2.2, { head: m.accent, t: 0.1 }));
  // 1 TEILEN
  s.add(T.phone(s, a[0] - 2.8, a[1] + 0.3, Z, 3.8, 7.2));
  s.add(P.person(s, a[0] + 2.4, a[1] + 1.4, Z, { shirt: m.type('stay'), jacket: m.type('ship'), bag: 'shoulder', h: 1.8, hairI: 1 }));
  s.add(T.sheet(s, a[0] - 0.4, a[1] - 2.6, Z + 4.4, 3.2, 3.6, { lines: 4 }));
  s.add({ svg: s.line([s.P(a[0] + 1.2, a[1] - 0.8, Z + 4.4), s.P(a[0] + 1.2, a[1] - 0.8, Z + 1.0)], { stroke: pal.accent, sw: 1.6, dash: '2 4', cap: 'round' }), bbox: [a[0] + 1.2, a[1] - 0.8, Z + 1, a[0] + 1.3, a[1] - 0.7, Z + 4.4], sh: 0 });
  I.labelSign(s, a[0], a[1], Z, 'TEILEN', 1);
  // 2 AUSWERTEN
  s.add(T.serverRack(s, b[0] - 4.1, b[1] - 3.6, Z, 2.4, 2.2, 5.6));
  s.add(T.serverRack(s, b[0] - 1.4, b[1] - 3.6, Z, 2.4, 2.2, 4.2));
  s.add(T.desk(s, b[0] - 3.6, b[1] + 0.9, Z, 5.4, 2.0));
  s.add(T.sheet(s, b[0] - 2.6, b[1] + 1.2, Z + 0.78, 3.0, 1.5, { lines: 3 }));
  s.add(I.magnifier(s, b[0] - 0.6, b[1] + 3.1, Z + 2.6, 1.9));
  s.add(I.upCard(s, b[0] + 3.0, b[1] - 1.8, Z + 1.6, 2.6, 1.1, m.card, (f, sc, w, h) => sc.fLine(f, [[0.4, h * 0.5], [w - 0.4, h * 0.5]], { stroke: pal.accent, sw: 2.2, cap: 'round' }), { sh: 0 }));
  s.add(I.upCard(s, b[0] + 3.4, b[1] - 1.8, Z + 3.0, 2.6, 1.1, m.card, (f, sc, w, h) => sc.fLine(f, [[0.4, h * 0.5], [w - 0.9, h * 0.5]], { stroke: pal.mute, sw: 2.2, cap: 'round' }), { sh: 0 }));
  I.labelSign(s, b[0], b[1], Z, 'AUSWERTEN', 2);
  // 3 PRÜFEN
  s.add(T.desk(s, c[0] - 4.2, c[1] - 0.2, Z, 6.6, 2.2));
  [[-3.6, 'air', true], [-1.0, 'stay', true], [1.6, 'car', false]].forEach(([dx, h, ok]) => s.add(I.dashedCard(s, c[0] + dx, c[1] + 0.9, Z + 0.78, 2.2, 3.0, m.type(h), { check: ok })));
  s.add(s.group([s.cyl(c[0] + 2.2, c[1] + 0.3, Z + 0.78, 0.6, 0.22, m.ink, { sh: 0, sw: 0.7 }), s.cyl(c[0] + 2.2, c[1] + 0.3, Z + 1.0, 0.16, 0.9, m.accent, { sh: 0, sw: 0.7 }), s.sphere(c[0] + 2.2, c[1] + 0.3, Z + 2.1, 0.45, m.accent, { sh: 0, sw: 0.7 })]));
  s.add(P.person(s, c[0] + 3.4, c[1] - 1.8, Z, { shirt: m.accent, h: 1.85, hair: m.wood, skin: 2 }));
  I.labelSign(s, c[0], c[1], Z, 'PRÜFEN', 3);
  // 4 ÜBERNOMMEN
  s.add(s.box(d[0] - 3.4, d[1] - 1.8, Z, 6.0, 4.2, 0.4, m.type('doc'), { sw: 1, decor: (f, sc) => sc.fRect(f.L, 0.4, 0.05, 2.2, 0.35, { fill: pal.accent, stroke: null }) }));
  s.add(T.ticketCard(s, d[0] - 3.0, d[1] - 1.3, Z + 0.4, 5.0, 2.4, { head: m.accent }));
  s.add(T.ticketCard(s, d[0] - 2.4, d[1] + 1.0, Z + 0.4, 5.0, 2.0, { head: m.type('stay') }));
  s.add(s.box(d[0] - 4.2, d[1] + 3.1, Z, 8.4, 0.9, 0.25, m.paper, { sw: 0.9, sh: 0.2 }));
  [[-3.8, 1.8, 'air'], [-1.6, 2.6, 'stay'], [1.6, 1.4, 'car'], [3.0, 1.8, 'activity']].forEach(([dx, w, h], i) => s.add(s.box(d[0] + dx, d[1] + 3.2, Z + 0.25, w, 0.7, 0.5 + (i % 2) * 0.4, m.type(h), { sh: 0, sw: 0.8 })));
  s.add(I.checkBadge(s, d[0] + 3.2, d[1] - 3.0, Z + 3.8, 1.9));
  s.add(s.group([s.cyl(d[0] - 3.8, d[1] - 3.2, Z, 0.1, 5.0, m.metal, { sh: 0, sw: 0.7 }), s.prismXZ([[d[0] - 3.7, Z + 5.0], [d[0] - 1.6, Z + 4.4], [d[0] - 3.7, Z + 3.7]], d[1] - 3.3, d[1] - 3.1, m.accent, { sh: 0, sw: 0.8 })]));
  I.labelSign(s, d[0], d[1], Z, 'ÜBERNOMMEN', 4, { h: 0.62 });
}

// ---------------------------------------------------------------- Reisekasse ausgleichen
function helpSettle(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal);
  const [a, b, c, d] = C;
  for (const x of [-4, 0, 4]) s.add(T.sheet(s, x - 1.0, a[1] - 1.1, BZ, 2.0, 2.4, { lines: 3 }));
  for (const y of [-4, 0, 4]) s.add(T.coin(s, b[0], y, BZ, 0.9));
  for (const x of [4, 0, -4]) s.add(T.coin(s, x, c[1], BZ, 0.9));
  // 1 ERFASSEN: drei Personen mit Münzstapeln und Belegen
  const pcol = [m.type('rail'), m.type('stay'), m.type('transfer')];
  [[-3.2, 0.8, 6], [0.2, -1.4, 3], [3.4, 0.8, 9]].forEach(([dx, dy, n], i) => {
    s.add(P.person(s, a[0] + dx, a[1] + dy - 1.0, Z, { shirt: pcol[i], h: 1.6 + i * 0.12, bag: i === 1 ? 'backpack' : null, hairI: i, skin: i, hat: i === 2, hatMat: m.accent }));
    s.add(I.coinStack(s, a[0] + dx + 0.6, a[1] + dy + 0.9, Z, n, 0.6));
  });
  s.add(T.sheet(s, a[0] - 1.0, a[1] + 2.2, Z, 2.2, 1.8, { lines: 3 }));
  I.labelSign(s, a[0], a[1], Z, 'ERFASSEN', 1);
  // 2 SALDO: Waage (nicht im Gleichgewicht) und Balken mit Vorzeichen
  s.add(I.scaleBalance(s, b[0] - 1.8, b[1] - 0.6, Z, 6.4, 5.4));
  [[2.4, 4.4, 'car', '+'], [4.0, 2.4, 'car', '+'], [5.6, -1, 'food', '-']].forEach(([dx, h, col, sg]) => {
    if (h > 0) s.add(s.box(b[0] + dx - 0.5, b[1] - 1.0, Z, 1.4, 2.0, h, m.type(col), { sw: 1, sh: 0.4, decor: (f, sc) => sc.fText(f.L, sg, 0.7, h - 1.0, 0.7, { align: 'center', stroke: '#FFFFFF', sw: 1.6 }) }));
    else s.add(s.box(b[0] + dx - 0.5, b[1] - 1.0, Z, 1.4, 2.0, 0.4, m.type(col), { sw: 1, sh: 0.3 }));
  });
  s.add({ svg: s.line([s.P(b[0] + 1.4, b[1] - 1.9, Z + 0.45), s.P(b[0] + 6.4, b[1] - 1.9, Z + 0.45)], { stroke: pal.mute, sw: 1.2 }), bbox: [b[0] + 1.4, b[1] - 2, Z + 0.4, b[0] + 7.4, b[1] - 1.8, Z + 0.5], sh: 0 });
  s.add(P.person(s, b[0] - 3.8, b[1] + 2.8, Z, { shirt: m.type('car'), h: 1.7 }));
  I.labelSign(s, b[0], b[1], Z, 'SALDO', 2);
  // 3 AUSGLEICH: zwei Personen, minimale Überweisung
  s.add(P.person(s, c[0] - 3.4, c[1] - 1.6, Z, { shirt: m.type('food'), h: 1.7, skin: 1 }));
  s.add(P.person(s, c[0] + 3.4, c[1] + 1.4, Z, { shirt: m.type('car'), h: 1.8, bag: 'shoulder', hairI: 2, skin: 3 }));
  s.add(I.groundArrow(s, [c[0] - 2.2, c[1] - 0.8], [c[0] + 2.4, c[1] + 0.9], { w: 0.4, head: 1.1, hl: 1.5 }), 'ground');
  s.add(s.box(c[0] - 4.2, c[1] + 2.2, Z + 0.001, 2.4, 0.2, 0.01, m.paper, { sh: 0, sw: 0.1 }));
  for (let i = 0; i < 3; i++) s.add(T.coin(s, c[0] - 1.1 + i * 1.1, c[1] - 0.5 + i * 0.5, Z + 0.3, 0.55));
  s.add(I.upCard(s, c[0] - 3.2, c[1] + 2.6, Z, 2.8, 1.3, m.card, (f, sc, w, h) => sc.fText(f, '-45', w / 2, 0.32, 0.65, { align: 'center', stroke: pal.negative, sw: 1.4 }), { sh: 0 }));
  s.add(I.upCard(s, c[0] + 3.2, c[1] - 2.6, Z, 2.8, 1.3, m.card, (f, sc, w, h) => sc.fText(f, '+45', w / 2, 0.32, 0.65, { align: 'center', stroke: pal.positive, sw: 1.4 }), { sh: 0 }));
  I.labelSign(s, c[0], c[1], Z, 'AUSGLEICH', 3);
  // 4 BEGLICHEN: Waage im Gleichgewicht, Haken, Null
  s.add(I.scaleBalance(s, d[0] - 0.8, d[1] - 0.2, Z, 6.4, 5.4));
  s.add(I.checkBadge(s, d[0] + 3.2, d[1] - 2.0, Z + 4.6, 1.8));
  s.add(I.upCard(s, d[0] + 2.6, d[1] + 2.6, Z, 3.2, 1.6, m.card, (f, sc, w, h) => sc.fText(f, '0.00', w / 2, 0.4, 0.8, { align: 'center', stroke: pal.ink, sw: 1.5 }), { sh: 0 }));
  s.add(P.person(s, d[0] - 3.8, d[1] + 2.2, Z, { shirt: m.type('rail'), h: 1.75, hairI: 1 }));
  s.add(P.person(s, d[0] + 3.8, d[1] - 0.2, Z, { shirt: m.type('stay'), h: 1.6, skirt: true, pants: m.type('transfer'), skin: 2 }));
  I.labelSign(s, d[0], d[1], Z, 'BEGLICHEN', 4);
}

// ---------------------------------------------------------------- Heute
function helpToday(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal, 'time');
  const [a, b, c, d] = C;
  // «Jetzt»-Marke auf dem Band
  s.add(s.group([s.cyl(a[0] + 9.5, a[1], BZ, 0.1, 3.0, m.accent, { sh: 0, sw: 0.7 }), s.sphere(a[0] + 9.5, a[1], BZ + 3.1, 0.5, m.accent, { sh: 0, sw: 0.8 })]));
  // 1 NÄCHSTES
  s.add(I.upCard(s, a[0] - 0.4, a[1] + 0.2, Z + 0.6, 8.2, 5.2, m.ink, (f, sc, w, h) => {
    let r = sc.fRect(f, 0, h - 1.1, w, h, { fill: pal.accent, stroke: null });
    r += sc.fCircle(f, 2.0, 2.2, 1.55, { fill: 'none', stroke: pal.mute, sw: 3, sop: 0.6 }, 28);
    const arc = [];
    for (let i = 0; i <= 18; i++) { const t = Math.PI / 2 - (i / 18) * Math.PI * 1.35; arc.push([2.0 + Math.cos(t) * 1.55, 2.2 + Math.sin(t) * 1.55]); }
    r += sc.fLine(f, arc, { stroke: pal.accent, sw: 3.2, cap: 'round' });
    r += sc.fText(f, '14:05', 5.6, 2.5, 0.95, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.7 });
    r += sc.fLine(f, [[3.8, 1.5], [7.2, 1.5]], { stroke: pal.mute, sw: 1.3, cap: 'round' });
    return r;
  }, { sh: 0.8 }));
  s.add(T.ticketCard(s, a[0] - 4.2, a[1] + 1.6, Z, 4.6, 2.4, { head: m.type('air') }));
  s.add(I.clockTower(s, a[0] + 3.8, a[1] + 1.4, Z, 14, 5, 1.5, 3.0));
  I.labelSign(s, a[0], a[1], Z, 'NÄCHSTES', 1);
  // 2 TAGESBAND: Ereignisse als Leiste
  s.add(s.box(b[0] - 4.4, b[1] - 0.4, Z, 8.8, 1.8, 0.3, m.paper, { sw: 1, sh: 0.3 }));
  [[-4.0, 1.8, 'air', 2.4], [-1.9, 1.4, 'car', 1.2], [-0.2, 2.2, 'stay', 3.4], [2.3, 1.2, 'food', 1.8], [3.7, 0.7, 'ticket', 2.8]].forEach(([dx, w, h, hh]) => s.add(s.box(b[0] + dx, b[1] - 0.2, Z + 0.3, w, 1.4, hh, m.type(h), { sw: 0.9, sh: 0.3 })));
  s.add(s.group([s.cyl(b[0] + 1.4, b[1] + 2.4, Z, 0.1, 4.8, m.accent, { sh: 0, sw: 0.7 }), s.prismXZ([[b[0] + 1.5, Z + 4.8], [b[0] + 3.6, Z + 4.2], [b[0] + 1.5, Z + 3.6]], b[1] + 2.3, b[1] + 2.5, m.accent, { sh: 0, sw: 0.8 })]));
  s.add(P.person(s, b[0] - 3.6, b[1] + 2.8, Z, { shirt: m.type('rail'), h: 1.8, bag: 'backpack', hat: true }));
  s.add(P.person(s, b[0] + 4.0, b[1] + 2.6, Z, { shirt: m.type('stay'), h: 1.6, skirt: true, pants: m.type('car'), skin: 1 }));
  I.labelSign(s, b[0], b[1], Z, 'TAGESBAND', 2);
  // 3 FRISTEN: Checkliste und Kalenderblatt
  s.add(I.upCard(s, c[0] - 2.2, c[1] + 0.2, Z, 5.6, 6.6, m.card, (f, sc, w, h) => {
    let r = '';
    for (let i = 0; i < 4; i++) {
      const v = h - 1.5 - i * 1.3;
      r += sc.fRect(f, 0.6, v, 1.3, v + 0.7, { fill: 'none', stroke: L, sw: 1 });
      if (i < 2) r += sc.fLine(f, [[0.7, v + 0.3], [0.95, v + 0.1], [1.45, v + 0.9]], { stroke: pal.positive, sw: 2.2, cap: 'round' });
      r += sc.fLine(f, [[1.9, v + 0.35], [w - 0.8 - (i % 2) * 0.8, v + 0.35]], { stroke: pal.mute, sw: 1.5, cap: 'round' });
    }
    return r;
  }));
  s.add(I.upCard(s, c[0] + 3.0, c[1] + 1.8, Z, 3.4, 3.6, m.card, (f, sc, w, h) => sc.fRect(f, 0, h - 1.0, w, h, { fill: pal.accent, stroke: null }) + sc.fText(f, '25', w / 2, 0.7, 1.5, { align: 'center', stroke: pal.ink, sw: 2 }), { sh: 0.4 }));
  s.add(T.clockFace(s, c[0] + 3.4, c[1] - 1.2, Z + 5.4, 1.5, 11, 55, { hand: pal.accent }));
  I.labelSign(s, c[0], c[1], Z, 'FRISTEN', 3);
  // 4 PRÜFEN: Vorschlagskarten mit Zähler
  s.add(I.dashedCard(s, d[0] - 3.4, d[1] + 0.6, Z, 2.8, 3.8, m.type('transfer')));
  s.add(I.dashedCard(s, d[0] - 0.4, d[1] - 0.4, Z, 2.8, 3.8, m.type('activity')));
  s.add(I.dashedCard(s, d[0] + 2.6, d[1] + 0.6, Z, 2.8, 3.8, m.type('car'), { check: true }));
  s.add(P.person(s, d[0] - 1.6, d[1] + 3.0, Z, { shirt: m.accent, h: 1.8, hairI: 3, skin: 2 }));
  { const q = s.P(d[0] + 4.2, d[1] - 1.4, Z + 4.6); badge(s, q[0], q[1], 3, { r: 16 }); }
  I.labelSign(s, d[0], d[1], Z, 'PRÜFEN', 4);
}

// ---------------------------------------------------------------- Zeiten und Zeitzonen
function helpTimezones(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal);
  const [a, b, c, d] = C;
  s.add(I.upCard(s, 0, a[1] - 0.1, BZ, 2.6, 1.0, m.accent, (f, sc, w, h) => sc.fText(f, '14:05', w / 2, 0.22, 0.55, { align: 'center', stroke: pal.onAccent, sw: 1.2 }), { sh: 0, t: 0.2, chamfer: 0.1 }));
  // 1 ABFLUG
  s.add(I.clockTower(s, a[0] - 2.8, a[1] + 0.4, Z, 14, 5, 2.4, 4.4));
  s.add(I.upCard(s, a[0] + 2.2, a[1] + 1.6, Z, 5.2, 1.8, m.ink, (f, sc, w, h) => sc.fText(f, '14:05', w / 2, 0.45, 0.9, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.7 }), { sh: 0.2 }));
  s.add(I.toyPlane(s, a[0] + 2.8, a[1] - 1.6, Z + 3.4, 1.2));
  s.add(P.suitcase(s, a[0] + 0.8, a[1] + 3.0, Z, 1.6, 1.0, 1.4, m.type('stay')));
  s.add(P.person(s, a[0] - 0.4, a[1] + 3.0, Z, { shirt: m.type('rail'), h: 1.7, bag: 'backpack' }));
  I.labelSign(s, a[0], a[1], Z, 'ABFLUG', 1);
  // 2 ZEITVERSATZ: Weltkugel mit Zonenband, Versatz-Pfeil
  s.add(T.globe(s, b[0] - 1.6, b[1] - 0.4, Z, 3.5));
  { const g = s.P(b[0] - 1.6, b[1] - 0.4, Z + 0.12 + 3.5 * 1.15), R = 3.5 * s.k * 1.2247;
    const band = `M${(g[0] - R * 0.28).toFixed(1)} ${(g[1] - R * 0.96).toFixed(1)}Q${(g[0] - R * 0.66).toFixed(1)} ${g[1].toFixed(1)} ${(g[0] - R * 0.28).toFixed(1)} ${(g[1] + R * 0.96).toFixed(1)}L${(g[0] + R * 0.18).toFixed(1)} ${(g[1] + R * 0.98).toFixed(1)}Q${(g[0] - R * 0.2).toFixed(1)} ${g[1].toFixed(1)} ${(g[0] + R * 0.18).toFixed(1)} ${(g[1] - R * 0.98).toFixed(1)}Z`;
    s.add({ svg: s.path(band, { fill: pal.accent, op: 0.5, stroke: pal.accent, sw: 1.2 }) + s.path(`M${(g[0] - R * 1.25).toFixed(1)} ${(g[1] + R * 0.25).toFixed(1)}Q${g[0].toFixed(1)} ${(g[1] - R * 1.75).toFixed(1)} ${(g[0] + R * 1.25).toFixed(1)} ${(g[1] + R * 0.25).toFixed(1)}`, { stroke: L, sw: 1.6, dash: '3 5', cap: 'round', fill: 'none' }), bbox: [b[0] - 5, b[1] - 3, Z + 1, b[0] + 2, b[1] + 3, Z + 8], sh: 0 }, 'top'); }
  s.add(I.upCard(s, b[0] + 3.6, b[1] + 1.6, Z, 3.4, 1.8, m.accent, (f, sc, w, h) => sc.fText(f, '-6 H', w / 2, 0.5, 0.8, { align: 'center', stroke: pal.onAccent, sw: 1.5 }), { sh: 0.2 }));
  s.add(I.toyPlane(s, b[0] + 3.2, b[1] - 2.2, Z + 5.2, 1.0));
  I.labelSign(s, b[0], b[1], Z, 'ZEITVERSATZ', 2, { h: 0.62 });
  // 3 ANKUNFT
  s.add(I.clockTower(s, c[0] - 2.8, c[1] + 0.4, Z, 5, 35, 2.4, 4.4));
  s.add(I.upCard(s, c[0] + 2.2, c[1] + 1.6, Z, 5.2, 1.8, m.ink, (f, sc, w, h) => sc.fText(f, '17:35', w / 2, 0.45, 0.9, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.7 }), { sh: 0.2 }));
  s.add(P.palm(s, c[0] + 3.6, c[1] - 2.0, Z, 6.0, { lean: [-0.4, -0.1] }));
  s.add(P.person(s, c[0] - 0.6, c[1] + 3.0, Z, { shirt: m.type('car'), h: 1.7, hat: true, bag: 'shoulder', hairI: 1, skin: 1 }));
  s.add(P.suitcase(s, c[0] + 1.0, c[1] + 3.1, Z, 1.6, 1.0, 1.4, m.type('ship')));
  I.labelSign(s, c[0], c[1], Z, 'ANKUNFT', 3);
  // 4 ORTSZEIT
  s.add(T.ticketCard(s, d[0] - 3.6, d[1] - 1.4, Z, 7.2, 3.6, { head: m.type('air') }));
  s.add(I.upCard(s, d[0] + 0.6, d[1] + 2.6, Z, 6.0, 1.6, m.card, (f, sc, w, h) => sc.fText(f, 'ORTSZEIT', w / 2, 0.42, 0.7, { align: 'center', stroke: pal.ink, sw: 1.4 }), { sh: 0.2 }));
  s.add(T.clockFace(s, d[0] - 3.4, d[1] - 2.4, Z + 3.4, 1.5, 17, 35));
  s.add(I.checkBadge(s, d[0] + 3.2, d[1] - 2.8, Z + 3.4, 1.6));
  I.labelSign(s, d[0], d[1], Z, 'ORTSZEIT', 4);
}

// ---------------------------------------------------------------- Mitreisende einladen
function helpInvite(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal);
  const [a, b, c, d] = C;
  for (const x of [-4, 0, 4]) s.add(I.envelope(s, x - 1.3, a[1] - 0.9, BZ, 2.6, 1.8));
  // 1 EINLADEN: Wegweiser Link/Konto und Telefon
  s.add(s.cyl(a[0] + 2.4, a[1] + 0.2, Z, 0.2, 6.4, m.metal, { sw: 0.8, sh: 0.5 }));
  s.add(I.upCard(s, a[0] + 4.0, a[1] + 0.8, Z + 4.5, 4.6, 1.3, m.accent, (f, sc, w, h) => sc.fText(f, 'LINK', w / 2, 0.38, 0.55, { align: 'center', stroke: pal.onAccent, sw: 1.3 }), { sh: 0 }));
  s.add(I.upCard(s, a[0] + 0.8, a[1] + 0.8, Z + 2.8, 4.6, 1.3, m.type('ship'), (f, sc, w, h) => sc.fText(f, 'KONTO', w / 2, 0.38, 0.55, { align: 'center', stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.3 }), { sh: 0 }));
  s.add(T.phone(s, a[0] - 4.2, a[1] + 0.6, Z, 3.0, 5.8));
  s.add(P.person(s, a[0] - 1.0, a[1] + 3.0, Z, { shirt: m.type('stay'), jacket: m.type('car'), h: 1.75, hairI: 1 }));
  I.labelSign(s, a[0], a[1], Z, 'EINLADEN', 1);
  // 2 LINK: Kettenglied, QR, Brief
  s.add(I.upCard(s, b[0] - 2.4, b[1] + 0.4, Z, 4.6, 5.8, m.card, (f, sc, w, h) => {
    let r = sc.fRect(f, 0, h - 1.1, w, h, { fill: pal.accent, stroke: null });
    r += sc.fLine(f, [[1.0, h - 0.55], [2.2, h - 0.55]], { stroke: pal.onAccent, sw: 2.2, cap: 'round' });
    r += sc.fLine(f, [[2.6, h - 0.55], [3.6, h - 0.55]], { stroke: pal.onAccent, sw: 2.2, cap: 'round' });
    r += I.qrCode(s, f, 0.7, 0.7, 3.2);
    return r;
  }));
  s.add(I.envelope(s, b[0] + 1.2, b[1] - 0.6, Z, 4.2, 2.8));
  { const f = s.frame([0, b[1] + 2.4, 0], [1, 0, 0], [0, 0, 1], 1, 1);
    const ring = (cx, cz) => { const pts = []; for (let i = 0; i < 20; i++) { const t = i / 20 * Math.PI * 2; pts.push([cx + Math.cos(t) * 1.3, cz + Math.sin(t) * 0.8]); } return pts; };
    s.add({ svg: s.fPoly(f, ring(b[0] + 2.6, Z + 3.0), { fill: 'none', stroke: L, sw: 4.6 }) + s.fPoly(f, ring(b[0] + 4.0, Z + 3.0), { fill: 'none', stroke: L, sw: 4.6 }) + s.fPoly(f, ring(b[0] + 2.6, Z + 3.0), { fill: 'none', stroke: pal.accent, sw: 2.6 }) + s.fPoly(f, ring(b[0] + 4.0, Z + 3.0), { fill: 'none', stroke: pal.accent, sw: 2.6 }), bbox: [b[0] + 1, b[1] + 2.3, Z + 2, b[0] + 6, b[1] + 2.5, Z + 4], sh: 0 }); }
  s.add(P.person(s, b[0] + 3.6, b[1] + 3.2, Z, { shirt: m.type('rail'), h: 1.7, skirt: true, pants: m.type('transfer'), skin: 1, hairI: 2 }));
  I.labelSign(s, b[0], b[1], Z, 'LINK', 2);
  // 3 KONTO: Profilkarte, Schlüssel, Schloss
  s.add(I.upCard(s, c[0] - 1.4, c[1] + 0.2, Z, 6.2, 5.2, m.card, (f, sc, w, h) => {
    let r = I.avatar(s, f, 1.9, 2.5, 1.7, pal.type.car);
    r += sc.fLine(f, [[3.9, 3.6], [5.6, 3.6]], { stroke: L, sw: 1.8, cap: 'round' });
    r += sc.fLine(f, [[3.9, 2.7], [5.2, 2.7]], { stroke: pal.mute, sw: 1.4, cap: 'round' });
    r += sc.fRect(f, 0.6, 0.5, 5.6, 1.2, { fill: pal.accent, stroke: null });
    return r;
  }));
  s.add(I.keyFlat(s, c[0] + 1.6, c[1] + 2.8, Z, 0.9));
  s.add(I.padlock(s, c[0] + 3.4, c[1] - 0.8, Z, 1.8));
  s.add(P.person(s, c[0] - 4.0, c[1] + 2.6, Z, { shirt: m.type('stay'), h: 1.7, bag: 'shoulder' }));
  I.labelSign(s, c[0], c[1], Z, 'KONTO', 3);
  // 4 DABEI: Gruppe um die Reisekarte
  s.add(T.ticketCard(s, d[0] - 2.8, d[1] - 1.2, Z + 0.55, 5.6, 2.8, { head: m.accent }));
  s.add(s.box(d[0] - 3.4, d[1] - 1.8, Z, 6.8, 4.0, 0.55, m.wood, { sw: 1, sh: 0.4 }));
  [[-4.2, 2.8, 'rail', 1.7, 0], [-1.4, 3.4, 'stay', 1.5, 1], [2.0, 3.2, 'car', 1.8, 2], [4.2, -0.4, 'transfer', 1.2, 3]].forEach(([dx, dy, col, h, sk], i) => s.add(P.person(s, d[0] + dx, d[1] + dy, Z, { shirt: m.type(col), h, skin: sk, hairI: i, bag: i === 0 ? 'backpack' : null, hat: i === 3, hatMat: m.accent })));
  s.add(I.checkBadge(s, d[0] + 0.2, d[1] - 3.6, Z + 3.2, 1.7));
  I.labelSign(s, d[0], d[1], Z, 'DABEI', 4);
}

// ---------------------------------------------------------------- Vorschläge prüfen
function helpReview(s, pal) {
  const m = s.m, L = I.lineOf(s);
  const C = stage(s, pal);
  const [a, b, c, d] = C;
  for (const x of [-4, 0, 4]) s.add(I.dashedCard(s, x, a[1] - 0.2, BZ, 1.8, 2.0, m.type('air')));
  // 1 FUNDSTELLE
  s.add(I.upCard(s, a[0] - 1.2, a[1] + 0.2, Z, 6.4, 6.6, m.card, (f, sc, w, h) => {
    let r = '';
    for (let i = 0; i < 7; i++) r += sc.fLine(f, [[0.7, h - 1.0 - i * 0.82], [w - 0.7 - (i % 3) * 1.0, h - 1.0 - i * 0.82]], { stroke: pal.mute, sw: 1.3, cap: 'round', sop: 0.8 });
    for (const [i, col] of [[1, pal.type.stay], [3, pal.type.car], [5, pal.type.air]]) r += sc.fRect(f, 0.4, h - 1.0 - i * 0.82 - 0.3, w - 0.4 - (i % 3), h - 1.0 - i * 0.82 + 0.3, { fill: col, op: 0.35, stroke: col, sw: 1 });
    return r;
  }));
  s.add(I.magnifier(s, a[0] + 3.4, a[1] + 2.8, Z + 3.0, 1.7));
  I.labelSign(s, a[0], a[1], Z, 'FUNDSTELLE', 1, { h: 0.62 });
  // 2 HERKUNFT: Feldzeilen mit Herkunftspunkten und Legende
  s.add(I.upCard(s, b[0] - 0.8, b[1] + 0.2, Z, 7.4, 5.8, m.card, (f, sc, w, h) => {
    let r = sc.fRect(f, 0, h - 1.1, w, h, { fill: m.type('air').left, stroke: null });
    [['d', 3.2], ['d', 2.6], ['h', 2.0], ['d', 1.4]].forEach((row, i) => {
      const v = h - 2.1 - i * 1.2;
      r += sc.fLine(f, [[0.5, v], [3.0, v]], { stroke: pal.mute, sw: 1.4, cap: 'round', sop: 0.8 });
      r += sc.fLine(f, [[3.5, v], [w - 1.5, v]], { stroke: L, sw: 1.9, cap: 'round' });
      if (row[0] === 'd') r += sc.fCircle(f, w - 0.8, v, 0.3, { fill: pal.accent, stroke: null }, 10);
      else r += sc.fCircle(f, w - 0.8, v, 0.3, { fill: 'none', stroke: pal.accent, sw: 1.8 }, 10);
    });
    return r;
  }));
  s.add(I.upCard(s, b[0] + 3.8, b[1] + 2.6, Z, 3.2, 1.2, m.card, (f, sc, w, h) => sc.fCircle(f, 0.7, h / 2, 0.28, { fill: pal.accent, stroke: null }, 10) + sc.fLine(f, [[1.3, h / 2], [w - 0.3, h / 2]], { stroke: pal.mute, sw: 1.5, cap: 'round' }), { sh: 0 }));
  s.add(I.upCard(s, b[0] + 3.8, b[1] + 4.0, Z, 3.2, 1.2, m.card, (f, sc, w, h) => sc.fCircle(f, 0.7, h / 2, 0.28, { fill: 'none', stroke: pal.accent, sw: 1.8 }, 10) + sc.fLine(f, [[1.3, h / 2], [w - 0.7, h / 2]], { stroke: pal.mute, sw: 1.5, cap: 'round' }), { sh: 0 }));
  I.labelSign(s, b[0], b[1], Z, 'HERKUNFT', 2);
  // 3 GESPERRT: Felder mit Schloss, ein offenes Feld
  s.add(I.upCard(s, c[0] - 0.6, c[1] + 0.2, Z, 7.0, 5.0, m.card, (f, sc, w, h) => {
    let r = '';
    [0, 1, 2].forEach(i => {
      const v = h - 1.6 - i * 1.4;
      r += sc.fRect(f, 0.5, v - 0.35, w - 2.0, v + 0.45, { fill: i === 1 ? pal.surface : pal.surface2, stroke: i === 1 ? L : pal.mute, sw: 1, dash: i === 1 ? null : '4 3' });
      r += sc.fLine(f, [[0.9, v + 0.05], [w - 3.2, v + 0.05]], { stroke: i === 1 ? L : pal.mute, sw: 1.8, cap: 'round' });
    });
    return r;
  }));
  s.add(I.padlock(s, c[0] + 3.6, c[1] + 1.3, Z + 2.2, 1.5));
  s.add(I.padlock(s, c[0] + 3.6, c[1] + 1.3, Z + 0.6, 1.5));
  s.add(s.group([s.cyl(c[0] + 2.8, c[1] + 3.2, Z, 0.16, 2.6, m.wood, { sh: 0, sw: 0.6 }), s.frustum(c[0] + 2.8, c[1] + 3.2, Z + 2.6, 0.32, 0.32, 0.04, 0.04, 0.5, m.ink, { sh: 0, sw: 0.5 })]));
  I.labelSign(s, c[0], c[1], Z, 'GESPERRT', 3);
  // 4 BESTÄTIGT
  s.add(T.ticketCard(s, d[0] - 3.6, d[1] - 1.8, Z, 6.8, 3.4, { head: m.accent }));
  s.add(s.group([s.cyl(d[0] + 1.4, d[1] + 2.0, Z, 1.2, 0.4, m.ink, { sh: 0, sw: 0.8 }), s.cyl(d[0] + 1.4, d[1] + 2.0, Z + 0.4, 0.28, 1.5, m.accent, { sh: 0, sw: 0.7 }), s.sphere(d[0] + 1.4, d[1] + 2.0, Z + 2.3, 0.75, m.accent, { sh: 0, sw: 0.8 })]));
  s.add(I.checkBadge(s, d[0] + 3.4, d[1] - 2.4, Z + 3.4, 1.9));
  s.add(P.person(s, d[0] - 3.2, d[1] + 2.8, Z, { shirt: m.type('rail'), h: 1.8, bag: 'shoulder', skin: 1 }));
  I.labelSign(s, d[0], d[1], Z, 'BESTÄTIGT', 4);
}

module.exports = [
  def('help-share', 'So kommt ein PDF in die Reise', 'Förderband-Ring mit vier Stationen: 1 Telefon mit Teilen-Schaltfläche und schwebendem PDF, 2 Server und Lesegerät mit Lupe über dem Dokument, 3 Tisch mit gestrichelten Vorschlagskarten und Haken, 4 Reisemappe mit bestätigten Tickets und Zeitleiste.', 'help:share', helpShare),
  def('help-settle', 'So wird in der Reisekasse ausgeglichen', 'Förderband-Ring mit vier Stationen: 1 Personen mit Münzstapeln und Belegen, 2 Waage aus dem Gleichgewicht und Balken mit Vorzeichen, 3 zwei Personen mit minimalem Überweisungspfeil, 4 Waage im Gleichgewicht mit Haken und Saldo null.', 'help:settle', helpSettle),
  def('help-today', 'So funktioniert Heute', 'Zeitleiste als Förderband mit Stundenstrichen und vier Stationen: 1 dunkle Karte mit Countdown, 2 Tagesband mit farbigen Ereignissen und Jetzt-Marke, 3 Checkliste und Fristenkalender, 4 Vorschlagskarten mit Zähler.', 'help:today', helpToday),
  def('help-timezones', 'Zeiten und Zeitzonen', 'Förderband-Ring mit vier Stationen: 1 Uhrenturm mit Abflugzeit 14:05, 2 Weltkugel mit Zonenband und Versatz -6 h, 3 Uhrenturm mit Ankunftszeit 17:35 in Ortszeit, 4 Ticket mit Kennzeichnung Ortszeit.', 'help:timezones', helpTimezones),
  def('help-invite', 'Mitreisende einladen', 'Förderband-Ring mit vier Stationen: 1 Wegweiser mit den Wegen Link oder Konto und Telefon, 2 QR-Karte, Kettenglied und Brief, 3 Profilkarte mit Schlüssel und Schloss, 4 Gruppe von Mitreisenden um die Reisekarte.', 'help:invite', helpInvite),
  def('help-review', 'Vorschläge prüfen', 'Förderband-Ring mit vier Stationen: 1 Dokument mit markierten Fundstellen und Lupe, 2 Feldzeilen mit gefülltem Punkt und Ring für die Herkunft, 3 gesperrte Felder mit Schlössern und ein offenes Feld, 4 Stempel, Ticket und Haken.', 'help:review', helpReview),
];
