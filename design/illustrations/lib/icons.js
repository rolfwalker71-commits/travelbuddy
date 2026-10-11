'use strict';
// Stationsobjekte für die Hilfekarten (stehende Karten, Symbole, Diagramme).
const { mix } = require('./util');
const T = require('./things');
const P = require('./props');
const { badge } = require('./common');

const lineOf = s => (s.pal.name === 'light' ? s.pal.ink : s.pal.bg);

/** Stehende Karte (Ebene xz), vorn bei y. decorFn(f, s, w, h) liefert SVG im Rahmen (u nach rechts, v nach oben). */
function upCard(s, cx, cy, z, w, h, mat, decorFn, o = {}) {
  const c = o.chamfer == null ? 0.35 : o.chamfer;
  const x0 = cx - w / 2;
  const poly = [[x0 + c, z], [x0 + w - c, z], [x0 + w, z + c], [x0 + w, z + h - c], [x0 + w - c, z + h], [x0 + c, z + h], [x0, z + h - c], [x0, z + c]];
  const part = T.cutout(s, poly, cy, o.t || 0.4, mat, { sw: o.sw || 1.1, sh: o.sh == null ? 0.6 : o.sh });
  const f = s.frame([x0, cy, z], [1, 0, 0], [0, 0, 1], w, h);
  if (decorFn) part.svg += decorFn(f, s, w, h) || '';
  return part;
}
/** Sockel (Plinthe) für eine Station. */
function plinth(s, cx, cy, size = 9, o = {}) {
  const m = s.m, pal = s.pal;
  const x0 = cx - size / 2, y0 = cy - size / 2;
  const parts = [];
  parts.push(s.box(x0, y0, 0, size, size, 0.7, o.mat || m.paper, {
    sw: 1.1, sh: 0,
    decor: (f, sc) => sc.fPoly(f.T, [[0.7, 0.7], [size - 0.7, 0.7], [size - 0.7, size - 0.7], [0.7, size - 0.7]], { fill: 'none', stroke: pal.line, sw: 1, dash: '3 3' }),
  }));
  return s.group(parts);
}
/** Flacher Pfeil am Boden von a nach b (Weltpunkte). */
function groundArrow(s, a, b, o = {}) {
  const pal = s.pal;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const w = o.w || 0.6, hw = o.head || 1.6, hl = o.hl || 2.2;
  const e = [b[0] - ux * hl, b[1] - uy * hl];
  const pts = [[a[0] + nx * w, a[1] + ny * w], [e[0] + nx * w, e[1] + ny * w], [e[0] + nx * hw, e[1] + ny * hw], [b[0], b[1]], [e[0] - nx * hw, e[1] - ny * hw], [e[0] - nx * w, e[1] - ny * w], [a[0] - nx * w, a[1] - ny * w]];
  return s.flatPoly(pts, 0.02, o.fill || pal.accent, { stroke: null });
}
function checkBadge(s, x, y, z, r = 1.1, col) {
  const pal = s.pal, L = lineOf(s);
  const c = s.P(x, y, z), R = r * s.k * 1.2;
  let svg = s.circle(c[0], c[1], R, { fill: col || pal.positive, stroke: L, sw: 1.2 });
  svg += s.line([[c[0] - R * 0.45, c[1] + R * 0.02], [c[0] - R * 0.1, c[1] + R * 0.38], [c[0] + R * 0.5, c[1] - R * 0.35]], { stroke: pal.name === 'light' ? '#FFFFFF' : pal.bg, sw: Math.max(2.2, R * 0.18), cap: 'round' });
  return { svg, bbox: [x - r, y - r, z - r, x + r, y + r, z + r], sh: 0 };
}
function padlock(s, x, y, z, size = 2.4, open = false) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const w = size, h = size * 0.8;
  const body = s.box(x - w / 2, y - 0.3, z, w, 0.6, h, m.type('stay'), {
    sw: 1.1, sh: 0.4,
    decor: (fr, sc) => sc.fCircle(fr.L, w / 2, h / 2 + 0.05, w * 0.1, { fill: m.ink.left, stroke: null }, 10) + sc.fLine(fr.L, [[w / 2, h / 2 - 0.05], [w / 2, h * 0.22]], { stroke: m.ink.left, sw: 1.6, cap: 'round' }),
  });
  const arc = [];
  const r = w * 0.3;
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI; arc.push([x + Math.cos(a) * r, z + h + 0.1 + Math.sin(a) * r * 1.3]); }
  const sf = s.frame([0, y + 0.31, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  let sh = s.fLine(sf, [[x - r, z + h], ...arc, [x + r, z + h]], { stroke: L, sw: Math.max(4.4, size * 2.0), cap: 'butt' });
  sh += s.fLine(sf, [[x - r, z + h], ...arc, [x + r, z + h]], { stroke: m.metal.top, sw: Math.max(2.4, size * 1.2), cap: 'butt' });
  return s.group([body, { svg: sh, bbox: [x - w, y, z + h, x + w, y + 0.4, z + h + w], sh: 0 }], [x - w, y - 0.4, z, x + w, y + 0.4, z + h + w * 0.8]);
}
function qrCode(s, f, u0, v0, size) {
  const pal = s.pal;
  const n = 9, c = size / n;
  let svg = s.fRect(f, u0, v0, u0 + size, v0 + size, { fill: pal.surface, stroke: lineOf(s), sw: 0.8 });
  const pattern = ['111111111', '100010001', '101110101', '101110101', '100010001', '111011111', '001101010', '110100111', '101011001'];
  let d = '';
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) {
    const finder = (r < 3 && q < 3) || (r < 3 && q > n - 4) || (r > n - 4 && q < 3);
    const on = finder ? !(r % 2 === 1 && q % 2 === 1 && false) : pattern[r][q] === '1';
    if (!on) continue;
    const a = f.pt(u0 + q * c + c * 0.1, v0 + size - (r + 1) * c + c * 0.1), b = f.pt(u0 + (q + 1) * c - c * 0.1, v0 + size - (r + 1) * c + c * 0.1), cc = f.pt(u0 + (q + 1) * c - c * 0.1, v0 + size - r * c - c * 0.1), dd = f.pt(u0 + q * c + c * 0.1, v0 + size - r * c - c * 0.1);
    d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${cc[0].toFixed(1)} ${cc[1].toFixed(1)}L${dd[0].toFixed(1)} ${dd[1].toFixed(1)}Z`;
  }
  svg += s.path(d, { fill: pal.ink, stroke: null });
  return svg;
}
function avatar(s, f, u, v, r, col) {
  const L = lineOf(s);
  const body = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI - (i / 12) * Math.PI; body.push([u + Math.cos(a) * r * 0.85, v - r * 0.55 + Math.sin(a) * r * 0.7]); }
  let svg = s.fPoly(f, body, { fill: col, stroke: L, sw: 1 });
  svg += s.fCircle(f, u, v + r * 0.42, r * 0.36, { fill: col, stroke: L, sw: 1 }, 16);
  return svg;
}
function envelope(s, x, y, z, w, d, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const parts = [s.box(x, y, z, w, d, 0.25, m.card, {
    sw: 1, sh: 0.2,
    decor: (f, sc) => sc.fLine(f.T, [[0, d], [w / 2, d * 0.35], [w, d]], { stroke: L, sw: 1 }) + sc.fLine(f.T, [[0, 0], [w * 0.38, d * 0.5]], { stroke: pal.line, sw: 1 }) + sc.fLine(f.T, [[w, 0], [w * 0.62, d * 0.5]], { stroke: pal.line, sw: 1 }),
  })];
  return s.group(parts);
}
function scaleBalance(s, x, y, z, w = 6, h = 5.4) {
  const m = s.m;
  const P_ = [];
  P_.push(s.box(x - 1.6, y - 1.0, z, 3.2, 2.0, 0.5, m.metal, { sw: 1, sh: 0.5 }));
  P_.push(s.cyl(x, y, z + 0.5, 0.22, h, m.metal, { sw: 0.8, sh: 0 }));
  P_.push(s.box(x - w / 2, y - 0.2, z + h + 0.4, w, 0.4, 0.3, m.metal, { sw: 0.9, sh: 0 }));
  for (const sx of [x - w / 2 + 0.3, x + w / 2 - 0.3]) {
    P_.push(s.cyl(sx, y, z + h - 1.5, 0.06, 1.9, m.ink, { sw: 0.5, sh: 0 }));
    P_.push(s.tube('z', z + h - 2.1, z + h - 1.5, sx, y, 1.3, 1.6, m.type('stay'), { sw: 0.9, sh: 0, steps: 18 }));
  }
  P_.push(T.coin(s, x - w / 2 + 0.3, y, z + h - 1.5, 0.6));
  P_.push(T.coin(s, x + w / 2 - 0.3, y, z + h - 1.5, 0.6));
  return s.group(P_, [x - w / 2 - 1.5, y - 1.2, z, x + w / 2 + 1.5, y + 1.2, z + h + 1]);
}
function stationBadge(s, cx, cy, zTop, num, o = {}) {
  const p = s.P(cx, cy, zTop);
  badge(s, p[0] + (o.dx || 0), p[1] + (o.dy || 0), num, { r: o.r || 22 });
}

/** Förderband-Abschnitt (achsenparallel von a nach b). mode: 'belt' (Rollen + Pfeile) | 'time' (Zeitstriche). */
function belt(s, a, b, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const w = o.w || 2.4, h = 0.45;
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const body = alongX ? s.box(x0, a[1] - w / 2, 0, x1 - x0, w, h, o.mat || m.ink, { sw: 1, sh: 0.3 })
    : s.box(a[0] - w / 2, y0, 0, w, y1 - y0, h, o.mat || m.ink, { sw: 1, sh: 0.3 });
  const dir = alongX ? [Math.sign(b[0] - a[0]), 0] : [0, Math.sign(b[1] - a[1])];
  const nrm = [-dir[1], dir[0]];
  const len = alongX ? x1 - x0 : y1 - y0;
  const c0 = alongX ? [x0, a[1]] : [a[0], y0];
  const along = [alongX ? 1 : 0, alongX ? 0 : 1];
  let svg = '';
  const P3 = (t, u) => s.P(c0[0] + along[0] * t + nrm[0] * u, c0[1] + along[1] * t + nrm[1] * u, h + 0.02);
  if ((o.mode || 'belt') === 'belt') {
    let d = '';
    for (let t = 0.6; t < len - 0.3; t += 1.2) { const p = P3(t, -w / 2 + 0.2), q = P3(t, w / 2 - 0.2); d += `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }
    svg += s.path(d, { stroke: pal.mute, sw: 1, sop: 0.55, fill: 'none' });
    for (let t = 3; t < len - 1.5; t += 6) {
      const sgn = dir[0] + dir[1];
      const pts = [[-0.6, 0.8], [0.5, 0], [-0.6, -0.8], [-0.1, 0]].map(([tt, uu]) => P3(t + sgn * tt, uu));
      svg += s.poly(pts, { fill: pal.accent, stroke: null });
    }
  } else {
    let d = '', d2 = '';
    for (let t = 0.0; t <= len + 0.01; t += 1.0) {
      const big = Math.round(t) % 4 === 0;
      const p = P3(t, -w / 2 + (big ? 0.15 : 0.5)), q = P3(t, w / 2 - (big ? 0.15 : 0.5));
      const seg = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      if (big) d2 += seg; else d += seg;
    }
    svg += s.path(d, { stroke: pal.mute, sw: 1, sop: 0.8, fill: 'none' }) + s.path(d2, { stroke: pal.name === 'light' ? pal.surface : pal.ink, sw: 1.6, fill: 'none' });
  }
  return s.group([body, { svg, bbox: [x0, y0, h, x1, y1, h + 0.03], sh: 0 }]);
}

/** Beschriftungstafel auf zwei Pfosten am hinteren Plattformrand; Nummernmarke sitzt am linken Ende. */
function labelSign(s, cx, cy, z, text, num, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const hgt = o.h || 0.7, adv = 4.2 * hgt / 5;
  const w = Math.max(4.6, text.length * adv + 1.8);
  const x0 = cx - w / 2 + (o.dx || 0), y = cy - 4.5, zz = z + (o.z || 4.9);
  const parts = [];
  parts.push(s.box(x0 + 0.3, y, z, 0.22, 0.22, zz - z, m.metal, { sh: 0, sw: 0.7 }));
  parts.push(s.box(x0 + w - 0.5, y, z, 0.22, 0.22, zz - z, m.metal, { sh: 0, sw: 0.7 }));
  parts.push(s.box(x0, y - 0.05, zz, w, 0.3, 1.35, o.mat || m.accent, {
    sw: 1.1, sh: 0.4,
    decor: (f, sc) => sc.fText(f.L, text, w / 2, 0.33, hgt, { align: 'center', stroke: (o.ink || pal.onAccent), sw: 1.5 }),
  }));
  s.add(s.group(parts, [x0, y - 0.1, z, x0 + w, y + 0.3, zz + 1.35]));
  const q = s.P(x0 + 0.05, y + 0.25, zz + 1.4);
  badge(s, q[0] - 4, q[1] - 4, num, { r: 15 });
}

/** Lupe: Linse als Ausschnitt in der xz-Ebene bei y, Griff schräg nach rechts unten. */
function magnifier(s, x, y, z, r, o = {}) {
  const m = s.m, pal = s.pal, L = lineOf(s);
  const ring = [];
  for (let i = 0; i < 26; i++) { const t = i / 26 * Math.PI * 2; ring.push([x + Math.cos(t) * r, z + Math.sin(t) * r]); }
  const fill = pal.name === 'light' ? mix(pal.type.ship, pal.surface, 0.78) : mix(pal.type.ship, pal.bg, 0.5);
  const lens = T.cutout(s, ring, y, 0.4, m.ink, { sw: 1.3, sh: 0.4, fill });
  const f = s.frame([0, y, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  lens.svg += s.fCircle(f, x, z, r * 0.8, { fill: 'none', stroke: pal.surface, sw: 1.4, sop: 0.8 }, 24) + s.fLine(f, [[x - r * 0.55, z + r * 0.35], [x - r * 0.25, z + r * 0.62]], { stroke: pal.surface, sw: 2.6, cap: 'round' });
  const hx = x + r * 0.75, hz = z - r * 0.75;
  const handle = s.prismXZ([[hx, hz], [hx + 0.6, hz + 0.1], [hx + r * 1.1 + 0.4, hz - r * 1.1], [hx + r * 1.1 - 0.3, hz - r * 1.1 - 0.3]], y - 0.35, y + 0.05, m.wood, { sh: 0, sw: 1 });
  return s.group([handle, lens], [x - r, y - 0.5, z - r * 1.9, x + r * 2, y + 0.2, z + r]);
}

/** Gestapelte Münzen. */
function coinStack(s, x, y, z, n, r = 0.55) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(T.coin(s, x, y, z + i * 0.14, r));
  const g = s.group(parts, [x - r, y - r, z, x + r, y + r, z + n * 0.14 + 0.1]);
  g.sh = n * 0.1;
  return g;
}

/** Stehende Karte mit gestricheltem Rand (Vorschlag), optional Kopfband. */
function dashedCard(s, cx, cy, z, w, h, head, o = {}) {
  const pal = s.pal, L = lineOf(s);
  return upCard(s, cx, cy, z, w, h, s.m.card, (f, sc, ww, hh) => {
    let r = sc.fRect(f, 0, hh - hh * 0.26, ww, hh, { fill: head.left, stroke: null });
    r += sc.fLine(f, [[ww * 0.1, hh * 0.5], [ww * 0.7, hh * 0.5]], { stroke: L, sw: 1.8, cap: 'round' });
    r += sc.fLine(f, [[ww * 0.1, hh * 0.32], [ww * 0.55, hh * 0.32]], { stroke: pal.mute, sw: 1.3, cap: 'round' });
    r += sc.fPoly(f, [[0.25, 0.25], [ww - 0.25, 0.25], [ww - 0.25, hh - 0.25], [0.25, hh - 0.25]], { fill: 'none', stroke: pal.accent, sw: 1.3, dash: '4 3' });
    if (o.check) r += sc.fLine(f, [[ww * 0.74, hh * 0.18], [ww * 0.82, hh * 0.1], [ww * 0.94, hh * 0.32]], { stroke: pal.positive, sw: 3, cap: 'round' });
    return r;
  }, { sh: 0.2, t: 0.3, chamfer: 0.2 });
}

/** Spielzeugflugzeug (klein, für Weltkugel/Podest). Nase nach -x. */
function toyPlane(s, x, y, z, k = 1) {
  const m = s.m, P_ = [];
  P_.push(s.extrude([[x - 1.3 * k, y + 0.2 * k], [x + 1.0 * k, y + 2.4 * k], [x + 1.5 * k, y + 2.4 * k], [x + 0.6 * k, y + 0.2 * k]], z, z + 0.12 * k, m.metal, { sh: 0, sw: 0.8 }));
  P_.push(s.extrude([[x - 1.3 * k, y - 0.2 * k], [x + 1.0 * k, y - 2.4 * k], [x + 1.5 * k, y - 2.4 * k], [x + 0.6 * k, y - 0.2 * k]], z, z + 0.12 * k, m.metal, { sh: 0, sw: 0.8 }));
  P_.push(s.tube('x', x - 2.4 * k, x + 2.2 * k, y, z + 0.1 * k, 0.4 * k, 0.4 * k, m.white, { sh: 0, sw: 0.9, steps: 16 }));
  P_.push(s.prismXZ([[x + 1.4 * k, z + 0.3 * k], [x + 2.2 * k, z + 0.3 * k], [x + 2.0 * k, z + 1.3 * k], [x + 1.6 * k, z + 1.3 * k]], y - 0.07 * k, y + 0.07 * k, m.accent, { sh: 0, sw: 0.8 }));
  return s.group(P_, [x - 2.4 * k, y - 2.5 * k, z - 0.4 * k, x + 2.2 * k, y + 2.5 * k, z + 1.4 * k]);
}

/** Uhrenturm: Säule mit Zifferblatt (Ebene xz). */
function clockTower(s, x, y, z, hh, mm, r = 2.3, h = 4.6) {
  const m = s.m;
  const P_ = [s.box(x - 0.45, y - 0.45, z, 0.9, 0.9, h, m.metal, { sw: 0.9, sh: 0.4 }), T.clockFace(s, x, y + 0.5, z + h + r * 0.85, r, hh, mm)];
  return s.group(P_, [x - r, y - 0.6, z, x + r, y + 0.7, z + h + r * 1.8]);
}

/** Schlüssel (liegend, entlang +x). */
function keyFlat(s, x, y, z, k = 1) {
  const m = s.m, L = lineOf(s), pal = s.pal;
  const ring = [];
  for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2; ring.push([x + Math.cos(t) * 1.3 * k, y + Math.sin(t) * 1.3 * k]); }
  const parts = [s.extrude(ring, z, z + 0.4 * k, m.type('stay'), { sh: 0, sw: 1 }),
    s.box(x + 1.2 * k, y - 0.28 * k, z, 4.8 * k, 0.56 * k, 0.4 * k, m.type('stay'), { sh: 0, sw: 1 }),
    s.box(x + 4.0 * k, y + 0.28 * k, z, 0.6 * k, 1.0 * k, 0.4 * k, m.type('stay'), { sh: 0, sw: 0.9 }),
    s.box(x + 5.1 * k, y + 0.28 * k, z, 0.6 * k, 0.8 * k, 0.4 * k, m.type('stay'), { sh: 0, sw: 0.9 })];
  const hole = [];
  for (let i = 0; i < 12; i++) { const t = i / 12 * Math.PI * 2; hole.push(s.P(x + Math.cos(t) * 0.5 * k, y + Math.sin(t) * 0.5 * k, z + 0.41 * k)); }
  parts.push({ svg: s.poly(hole, { fill: pal.surface, stroke: L, sw: 0.8 }), bbox: [x - 0.6, y - 0.6, z + 0.4, x + 0.6, y + 0.6, z + 0.43], sh: 0 });
  return s.group(parts, [x - 1.3 * k, y - 1.3 * k, z, x + 5.7 * k, y + 1.3 * k, z + 0.5 * k]);
}

module.exports = { upCard, plinth, groundArrow, checkBadge, padlock, qrCode, avatar, envelope, scaleBalance, stationBadge, lineOf, belt, labelSign, magnifier, coinStack, dashedCard, toyPlane, clockTower, keyFlat };
