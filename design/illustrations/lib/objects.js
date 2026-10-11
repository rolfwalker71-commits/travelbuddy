'use strict';
// Grössere Objekte: Fahrzeuge, Gebäude, Möbel, Symbole. Alle liefern Teile (parts) für s.add().
const { mix } = require('./util');
const P = require('./props');

/** Personenwagen. Länge entlang x, Front +x. */
function car(s, x, y, z = 0, o = {}) {
  const m = s.m, pal = s.pal;
  const L = o.len || 4.7, W = o.wid || 1.95, mat = o.mat || m.type('car');
  const h0 = o.suv ? 0.45 : 0.35, bh = o.suv ? 0.95 : 0.8;
  const parts = [];
  const wr = o.suv ? 0.42 : 0.37;
  // Räder Fernseite
  parts.push(P.wheel(s, x + L * 0.22, y + 0.05, z + wr, wr, 0.22));
  parts.push(P.wheel(s, x + L * 0.78, y + 0.05, z + wr, wr, 0.22));
  // Karosserie
  parts.push(s.box(x, y, z + h0, L, W, bh, mat, {
    sh: 0, sw: 0.9,
    decor: (f, sc) => {
      let r = '';
      // Türfugen und Griffe an der Seite
      r += sc.fLine(f.L, [[L * 0.46, 0.05], [L * 0.46, bh - 0.05]], { stroke: mat.line, sw: 0.7, sop: 0.8 });
      r += sc.fLine(f.L, [[L * 0.72, 0.05], [L * 0.72, bh - 0.05]], { stroke: mat.line, sw: 0.7, sop: 0.8 });
      r += sc.fLine(f.L, [[L * 0.4, bh - 0.22], [L * 0.43, bh - 0.22]], { stroke: mat.line, sw: 1, cap: 'round' });
      r += sc.fLine(f.L, [[L * 0.66, bh - 0.22], [L * 0.69, bh - 0.22]], { stroke: mat.line, sw: 1, cap: 'round' });
      // Front: Scheinwerfer, Kühlergrill, Kennzeichen
      r += sc.fRect(f.R, 0.12, bh - 0.4, 0.5, bh - 0.12, { fill: m.lit.top, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.7 });
      r += sc.fRect(f.R, W - 0.5, bh - 0.4, W - 0.12, bh - 0.12, { fill: m.lit.top, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.7 });
      r += sc.fRect(f.R, 0.6, bh - 0.42, W - 0.6, bh - 0.18, { fill: m.ink.left, stroke: m.ink.line, sw: 0.7 });
      r += sc.fRect(f.R, W / 2 - 0.3, 0.1, W / 2 + 0.3, 0.28, { fill: pal.surface, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.6 });
      return r;
    },
  }));
  // Fahrgastzelle
  const cz = z + h0 + bh, ch = o.suv ? 0.85 : 0.7;
  const x0 = x + L * 0.2, x1 = x + L * 0.82, xa = x + L * 0.3, xb = x + L * 0.7;
  const y0 = y + 0.1, y1 = y + W - 0.1;
  parts.push(s.prismXZ([[x0, cz], [x1, cz], [xb, cz + ch], [xa, cz + ch]], y0, y1, mat, { sh: 0, sw: 0.9 }));
  // Fensterflächen (Seite + Frontscheibe + Heck angedeutet)
  const gl = m.glass;
  let win = '';
  const ins = 0.09;
  win += s.poly3([[x0 + 0.28, y1 + 0.01, cz + ins], [x1 - 0.28, y1 + 0.01, cz + ins], [xb - 0.12, y1 + 0.01, cz + ch - ins], [xa + 0.12, y1 + 0.01, cz + ch - ins]], { fill: gl.left, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.7 });
  win += s.line3([[(x0 + x1) / 2 + 0.02, y1 + 0.02, cz + ins], [(x0 + x1) / 2 + 0.02, y1 + 0.02, cz + ch - ins]], { stroke: mat.line, sw: 0.9 });
  win += s.poly3([[x1 + 0.0, y0 + 0.12, cz + 0.06], [x1, y1 - 0.12, cz + 0.06], [xb + 0.0, y1 - 0.14, cz + ch - 0.06], [xb, y0 + 0.14, cz + ch - 0.06]], { fill: gl.right, stroke: pal.name === 'light' ? pal.ink : pal.bg, sw: 0.7 });
  parts.push({ svg: win, bbox: [x0, y0, cz, x1, y1, cz + ch], sh: 0 });
  if (o.rails) parts.push(s.box(xa, y0 + 0.15, cz + ch, xb - xa, 0.06, 0.07, m.ink, { sh: 0, sw: 0.5 }), s.box(xa, y1 - 0.2, cz + ch, xb - xa, 0.06, 0.07, m.ink, { sh: 0, sw: 0.5 }));
  // Räder Nahseite
  parts.push(P.wheel(s, x + L * 0.22, y + W - 0.17, z + wr, wr, 0.22));
  parts.push(P.wheel(s, x + L * 0.78, y + W - 0.17, z + wr, wr, 0.22));
  const g = s.group(parts, [x, y, z, x + L, y + W, cz + ch + 0.1]);
  g.sh = 1.2;
  return g;
}

/** Bus / Shuttle: Länge entlang x, Front +x. */
function bus(s, x, y, z = 0, o = {}) {
  const m = s.m, pal = s.pal, mat = o.mat || m.white, acc = o.accent || m.accent;
  const L = o.len || 11.5, W = 2.6, H = 3.2;
  const parts = [];
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  parts.push(P.wheel(s, x + L * 0.2, y + 0.05, z + 0.5, 0.5, 0.3));
  parts.push(P.wheel(s, x + L * 0.78, y + 0.05, z + 0.5, 0.5, 0.3));
  parts.push(s.box(x, y, z + 0.3, L, W, H, mat, {
    sh: 0, sw: 1,
    decor: (f, sc) => {
      let r = '';
      r += sc.fRect(f.L, 0, 0.55, L, 1.0, { fill: acc.left, stroke: null });
      // Fensterband mit Pfosten
      const n = Math.max(4, Math.round(L / 1.7));
      const doorAt = 3;
      for (let i = 0; i < n; i++) {
        const a = 0.35 + i * (L - 1.7) / n, b = a + (L - 1.7) / n - 0.12;
        if (i === doorAt) r += sc.fRect(f.L, a, 0.55, b + 0.0, 2.5, { fill: m.glass.top, stroke: line, sw: 0.9 }) + sc.fLine(f.L, [[(a + b) / 2, 0.55], [(a + b) / 2, 2.5]], { stroke: line, sw: 0.8 });
        else r += sc.fRect(f.L, a, 1.25, b, 2.5, { fill: m.glass.left, stroke: line, sw: 0.8 });
      }
      r += sc.fRect(f.L, L - 1.3, 1.25, L - 0.12, 2.5, { fill: m.glass.left, stroke: line, sw: 0.8 });
      // Front
      r += sc.fRect(f.R, 0.15, 1.2, W - 0.15, 2.7, { fill: m.glass.right, stroke: line, sw: 0.9 });
      r += sc.fRect(f.R, 0.15, 0.2, 0.55, 0.5, { fill: m.lit.top, stroke: line, sw: 0.7 });
      r += sc.fRect(f.R, W - 0.55, 0.2, W - 0.15, 0.5, { fill: m.lit.top, stroke: line, sw: 0.7 });
      r += sc.fRect(f.R, 0.7, 0.2, W - 0.7, 0.5, { fill: m.ink.left, stroke: line, sw: 0.7 });
      return r;
    },
  }));
  parts.push(s.box(x + 1.5, y + 0.4, z + 0.3 + H, L - 3.5, W - 0.8, 0.28, m.metal, { sh: 0, sw: 0.8 }));
  parts.push(P.wheel(s, x + L * 0.2, y + W - 0.2, z + 0.5, 0.5, 0.3));
  parts.push(P.wheel(s, x + L * 0.78, y + W - 0.2, z + 0.5, 0.5, 0.3));
  const g = s.group(parts, [x, y, z, x + L, y + W, z + H + 0.6]);
  g.sh = 2.6;
  return g;
}

/** Schienenfahrzeug-Wagen entlang x. nose: Front +x (abgeschrägt). */
function railCar(s, x, y, z = 0, o = {}) {
  const m = s.m, pal = s.pal, mat = o.mat || m.white, acc = o.accent || m.type('rail');
  const L = o.len || 14, W = 3.0, H = 3.6;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  const parts = [];
  const zb = z + 0.7;
  // Drehgestelle (Räder an der Fernseite zuerst)
  const bog = [L * 0.17, L * 0.83];
  bog.forEach(bx => { parts.push(P.wheel(s, x + bx - 0.8, y + 0.4, z + 0.45, 0.45, 0.2)); parts.push(P.wheel(s, x + bx + 0.8, y + 0.4, z + 0.45, 0.45, 0.2)); });
  parts.push(s.box(x + L * 0.3, y + 0.5, z + 0.3, L * 0.4, W - 1, 0.42, m.ink, { sh: 0, sw: 0.7 }));
  const decor = (f, sc) => {
    let r = '';
    r += sc.fRect(f.L, 0, 0.35, L, 0.85, { fill: acc.left, stroke: null });
    const nWin = Math.round((L - 2) / 1.9);
    const step = (L - 2.4) / nWin;
    for (let i = 0; i < nWin; i++) {
      const a = 1.2 + i * step, b = a + step - 0.28;
      r += sc.fRect(f.L, a, 1.3, b, 2.8, { fill: m.glass.left, stroke: line, sw: 0.8 });
    }
    // Türen
    for (const d of [0.4, L - 1.6]) {
      r += sc.fRect(f.L, d, 0.2, d + 1.2, 3.05, { fill: acc.top, stroke: line, sw: 0.9 });
      r += sc.fRect(f.L, d + 0.2, 1.2, d + 1.0, 2.8, { fill: m.glass.top, stroke: line, sw: 0.7 });
    }
    r += sc.fLine(f.L, [[0, H - 0.25], [L, H - 0.25]], { stroke: line, sw: 0.7, sop: 0.8 });
    return r;
  };
  if (!o.nose) {
    parts.push(s.box(x, y, zb, L, W, H, mat, { sh: 0, sw: 1, decor }));
  } else {
    // Front mit Schrägen
    const poly = [[x, y], [x + L - 3.2, y], [x + L, y + 0.7], [x + L, y + W - 0.7], [x + L - 3.2, y + W], [x, y + W]];
    const body = s.extrude(poly, zb, zb + H, mat, { sh: 0, sw: 1 });
    parts.push(body);
    const f = s.frame([x, y + W, zb], [1, 0, 0], [0, 0, 1], L, H);
    parts.push({ svg: decor({ L: f }, s), bbox: [x, y + W, zb, x + L, y + W, zb + H], sh: 0 });
    // Frontscheibe + Scheinwerfer auf der Front (x = x+L)
    let fr = s.poly3([[x + L + 0.01, y + 0.9, zb + 1.5], [x + L + 0.01, y + W - 0.9, zb + 1.5], [x + L + 0.01, y + W - 0.9, zb + 3.1], [x + L + 0.01, y + 0.9, zb + 3.1]], { fill: m.glass.right, stroke: line, sw: 0.9 });
    fr += s.poly3([[x + L + 0.01, y + 0.9, zb + 0.5], [x + L + 0.01, y + 1.4, zb + 0.5], [x + L + 0.01, y + 1.4, zb + 0.9], [x + L + 0.01, y + 0.9, zb + 0.9]], { fill: m.lit.top, stroke: line, sw: 0.7 });
    fr += s.poly3([[x + L + 0.01, y + W - 1.4, zb + 0.5], [x + L + 0.01, y + W - 0.9, zb + 0.5], [x + L + 0.01, y + W - 0.9, zb + 0.9], [x + L + 0.01, y + W - 1.4, zb + 0.9]], { fill: m.lit.top, stroke: line, sw: 0.7 });
    fr += s.poly3([[x + L + 0.01, y + 0.7, zb + 0.0], [x + L + 0.01, y + W - 0.7, zb + 0.0], [x + L + 0.01, y + W - 0.7, zb + 0.35], [x + L + 0.01, y + 0.7, zb + 0.35]], { fill: acc.left, stroke: null });
    parts.push({ svg: fr, bbox: [x + L, y, zb, x + L + 0.1, y + W, zb + H], sh: 0 });
  }
  // Dachaufbauten
  parts.push(s.box(x + 1.5, y + 0.7, zb + H, L - (o.nose ? 5 : 3), W - 1.4, 0.3, m.metal, { sh: 0, sw: 0.8 }));
  bog.forEach(bx => { parts.push(P.wheel(s, x + bx - 0.8, y + W - 0.6, z + 0.45, 0.45, 0.2)); parts.push(P.wheel(s, x + bx + 0.8, y + W - 0.6, z + 0.45, 0.45, 0.2)); });
  const g = s.group(parts, [x, y, z, x + L + 0.1, y + W, zb + H + 0.4]);
  g.sh = H + 0.7;
  return g;
}

function pantograph(s, x, y, z) {
  const m = s.m, c = s.pal.name === 'light' ? s.pal.ink : s.pal.mute;
  const a = [x - 1.0, y, z], b = [x + 0.2, y, z + 1.3], c2 = [x - 0.8, y, z + 2.2], d = [x + 0.7, y, z + 2.2];
  return { svg: s.line3([a, b, c2], { stroke: c, sw: 1.6 }) + s.line3([[x - 0.5, y - 0.8, z + 2.25], [x - 0.5, y + 0.8, z + 2.25]], { stroke: c, sw: 2 }), bbox: [x - 1, y - 1, z, x + 1, y + 1, z + 2.3], sh: 0 };
}

/** Wandsegment mit Fenster für Gebäude (Rohbau-Hilfe). */
function sign3(s, x, y, z, w, h, mat, text, o = {}) {
  // Tafel stehend in yz? Standard: an Wand +y gerichtet (Ebene xz bei Tiefe y)
  const pal = s.pal;
  const f = s.frame([x, y, z], [1, 0, 0], [0, 0, 1], w, h);
  let svg = s.fRect(f, 0, 0, w, h, { fill: mat.left, stroke: o.line || mat.line, sw: 1.2 });
  if (text) svg += s.fText(f, text, w / 2, h * 0.28, h * 0.44, { align: 'center', stroke: o.ink || pal.onAccent, sw: 1.5 });
  return { svg, bbox: [x, y, z, x + w, y + 0.1, z + h], sh: 0 };
}

/** Schiff entlang x, Bug +x. (x0,y0) = Heck links hinten; Wasserlinie bei z = o.z (Standard 0). */
function ship(s, x0, y0, o = {}) {
  const m = s.m, pal = s.pal;
  const Z = o.z || 0;
  const L = o.len || 52, W = o.wid || 9, hh = o.hull || 3.6;
  const hullMat = o.hullMat || m.type('ship'), white = o.white || m.white, acc = m.accent;
  const line = pal.name === 'light' ? pal.ink : pal.bg;
  const parts = [];
  const bow = 0.74;
  const poly = () => [[x0, y0], [x0 + L * bow, y0], [x0 + L, y0 + W / 2], [x0 + L * bow, y0 + W], [x0, y0 + W]];
  const foam = [[x0 - 1.2, y0 - 1.2], [x0 + L * bow + 0.2, y0 - 1.2], [x0 + L + 1.4, y0 + W / 2], [x0 + L * bow + 0.2, y0 + W + 1.2], [x0 - 1.2, y0 + W + 1.2]];
  parts.push(s.flatPoly(foam, Z + 0.02, pal.name === 'light' ? pal.surface : mix(pal.line, pal.mute, 0.3), { op: 0.7 }));
  parts.push(s.extrude(poly(), Z, Z + 0.55, m.ink, { sh: 0, sw: 0.8 }));
  parts.push(s.extrude(poly(), Z + 0.55, Z + hh, hullMat, { sh: 0, faceFill: { 0: m.wood.top } }));
  const sf = s.frame([x0, y0 + W, Z], [1, 0, 0], [0, 0, 1], L * bow, hh);
  let det = s.fRect(sf, 0, hh - 0.8, L * bow, hh - 0.5, { fill: acc.left, stroke: null });
  for (let u = 3; u < L * bow - 2; u += 2.4) det += s.fRect(sf, u, hh - 2.0, u + 0.7, hh - 1.4, { fill: m.glass.left, stroke: line, sw: 0.6 });
  parts.push({ svg: det, bbox: [x0, y0 + W, Z, x0 + L * bow, y0 + W, Z + hh], sh: 0 });
  const decks = o.decks || 4;
  let z = Z + hh;
  const dh = 2.3;
  for (let i = 0; i < decks; i++) {
    const ins = 0.5 + i * 0.35;
    const xa = x0 + 0.8 + i * 2.2, xb = x0 + L * bow - i * 1.8;
    const ya = y0 + ins, yb = y0 + W - ins;
    const tip = i === 0 ? [x0 + L - 2.4, y0 + W / 2] : [xb + 3.2 - i * 0.6, y0 + W / 2];
    const poly2 = [[xa, ya], [xb, ya], tip, [xb, yb], [xa, yb]];
    parts.push(s.extrude(poly2, z, z + dh, white, { sh: 0, faceFill: { 0: m.stone.top } }));
    const wlen = xb - xa;
    const f = s.frame([xa, yb, z], [1, 0, 0], [0, 0, 1], wlen, dh);
    let dsvg = s.windows(f, 1.2, 0.55, wlen - 1.2, dh - 0.55, Math.max(2, Math.round((wlen - 2.4) / 1.55)), 1, { inset: 0.12, sw: 0.7 });
    dsvg += s.fLine(f, [[0, dh - 0.05], [wlen, dh - 0.05]], { stroke: line, sw: 0.7 });
    parts.push({ svg: dsvg, bbox: [xa, yb, z, xa + wlen, yb, z + dh], sh: 0 });
    // Rettungsboote am zweiten Deck
    if (i === 0) for (let k = 0; k < 4; k++) parts.push(s.box(xa + 3 + k * ((wlen - 8) / 3), yb - 0.1, z + dh - 0.9, 3.0, 0.9, 0.9, m.type('activity'), { sh: 0, sw: 0.8 }));
    z += dh;
  }
  const zt = z;
  parts.push(s.box(x0 + L * 0.46, y0 + W * 0.3, zt, 7, W * 0.4, 1.8, white, { sh: 0, sw: 0.9 }));
  parts.push(s.cyl(x0 + L * 0.34, y0 + W / 2, zt, 1.55, 3.4, acc, { sh: 0, sw: 1 }));
  parts.push(s.cyl(x0 + L * 0.34, y0 + W / 2, zt + 2.0, 1.57, 0.5, m.white, { sh: 0, sw: 0.8 }));
  parts.push(s.cyl(x0 + L * 0.34, y0 + W / 2, zt + 3.4, 1.57, 0.25, m.ink, { sh: 0, sw: 0.8 }));
  parts.push(s.cyl(x0 + L * 0.58, y0 + W / 2, zt + 1.8, 0.1, 3.4, m.ink, { sh: 0, sw: 0.7 }));
  parts.push(s.box(x0 + L * 0.58 - 0.9, y0 + W / 2 - 0.15, zt + 4.4, 1.8, 0.3, 0.2, m.ink, { sh: 0, sw: 0.6 }));
  const g = s.group(parts, [x0 - 1.2, y0 - 1.2, Z, x0 + L + 1.4, y0 + W + 1.2, zt + 6]);
  g.sh = 0;
  return g;
}

module.exports = { car, bus, railCar, pantograph, sign3, ship };
