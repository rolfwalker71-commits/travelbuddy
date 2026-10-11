'use strict';
// Isometrie-Toolkit (30°/30°). Welt: x nach rechts-unten, y nach links-unten, z nach oben. Licht von links oben.
const U = require('./util');
const { n, pts, hull, mix, clamp, sub, cross3, dot3, norm3, mulberry32 } = U;
const { materials } = require('./palette');
const font = require('./font');

const C30 = Math.cos(Math.PI / 6);

class Frame {
  constructor(s, o, u, v, w, h) { this.s = s; this.o = o; this.u = u; this.v = v; this.w = w; this.h = h; }
  pt(a, b) {
    const { o, u, v } = this;
    return this.s.P(o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b);
  }
}
/** Flacher Bildschirmrahmen: u nach rechts, v nach oben. */
class Flat {
  constructor(x, y) { this.x = x; this.y = y; }
  pt(a, b) { return [this.x + a, this.y - b]; }
}

let DEF_STROKE = '#000000';
/** Zahlenliste relativ, kompakt (".5-.3"). */
function rel(points, close) {
  let d = '';
  let px = 0, py = 0;
  const f = v => { let t = String(Math.round(v * 10) / 10); if (t === '-0') t = '0'; return t.replace(/^(-?)0\./, '$1.'); };
  points.forEach((p, i) => {
    const x = Math.round(p[0] * 10) / 10, y = Math.round(p[1] * 10) / 10;
    if (i === 0) d += 'M' + f(x) + ' ' + f(y);
    else {
      const a = f(x - px), b = f(y - py);
      d += (i === 1 ? 'l' : ' ') + a + (b[0] === '-' ? '' : ' ') + b;
    }
    px = x; py = y;
  });
  return d + (close ? 'z' : '');
}
function attrs(o = {}) {
  let a = '';
  a += ` fill="${o.fill || 'none'}"`;
  if (o.op != null && o.op < 1) a += ` fill-opacity="${n(o.op * 100) / 100}"`;
  if (!o.stroke) a += ' stroke="none"';
  else {
    if (o.stroke !== DEF_STROKE) a += ` stroke="${o.stroke}"`;
    a += ` stroke-width="${o.sw || 1.1}"`;
    if (o.cap) a += ` stroke-linecap="${o.cap}"`;
    a += ` stroke-linejoin="${o.join || 'round'}"`;
    if (o.dash) a += ` stroke-dasharray="${o.dash}"`;
    if (o.sop != null && o.sop < 1) a += ` stroke-opacity="${n(o.sop * 100) / 100}"`;
  }
  return a;
}

class Scene {
  constructor(o) {
    this.w = o.w; this.h = o.h; this.pal = o.pal;
    DEF_STROKE = o.pal.name === 'light' ? o.pal.ink : o.pal.bg;
    this.defStroke = DEF_STROKE; this.k = o.scale || 10; this.ox = o.ox; this.oy = o.oy;
    this.m = materials(o.pal);
    this.rand = mulberry32(o.seed || 7);
    this.defs = []; this.gid = 0;
    this.layers = { bg: [], ground: [], shadow: [], obj: [], top: [] };
    this.shadowPaths = [];
    this.shadowDir = [0.55, -0.28]; // Welt-Richtung pro Höheneinheit (nach rechts, leicht nach unten)
    this.bgFill = o.bg || o.pal.surface;
    this.lw = 1.1;
  }
  // ---------- Projektion ----------
  P(x, y, z = 0) { return [this.ox + (x - y) * C30 * this.k, this.oy + (x + y) * 0.5 * this.k - z * this.k]; }
  frame(o, u, v, w, h) { return new Frame(this, o, u, v, w, h); }
  flat(x, y) { return new Flat(x, y); }
  /** Verschiebt den Ursprung so, dass Weltpunkt (x,y,z) auf Bildpunkt (sx,sy) fällt. */
  centerOn(x, y, z, sx, sy) {
    this.ox = 0; this.oy = 0;
    const p = this.P(x, y, z);
    this.ox = sx - p[0]; this.oy = sy - p[1];
  }
  // ---------- Gradienten ----------
  lin(stops, a, b) {
    const id = 'g' + (++this.gid);
    const st = stops.map(s => `<stop offset="${n(s[0] * 100) / 100}" stop-color="${s[1]}"/>`).join('');
    this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}">${st}</linearGradient>`);
    return `url(#${id})`;
  }
  // ---------- Ebenen ----------
  add(part, layer = 'obj') {
    if (Array.isArray(part)) { part.forEach(p => this.add(p, layer)); return; }
    if (!part) return;
    if (layer === 'obj') {
      this.layers.obj.push(part);
      if (part.sh !== 0) this._shadow(part);
    } else this.layers[layer].push(part);
  }
  raw(svg, layer = 'top') { this.layers[layer].push({ svg }); }
  _shadow(part) {
    const b = part.bbox;
    const h = part.sh != null ? part.sh : b[5];
    if (h <= 0.05) return;
    const fp = part.fp || [[b[0], b[1]], [b[3], b[1]], [b[3], b[4]], [b[0], b[4]]];
    const [dx, dy] = this.shadowDir;
    const all = [];
    for (const p of fp) { all.push(this.P(p[0], p[1], 0)); all.push(this.P(p[0] + dx * h, p[1] + dy * h, 0)); }
    const hh = hull(all);
    if (hh.length >= 3) this.shadowPaths.push('M' + hh.map(p => n(p[0]) + ' ' + n(p[1])).join('L') + 'Z');
  }
  shadowPoly(points, h) { // Bodenpolygon mit Schattenwurf (Welt xy)
    const [dx, dy] = this.shadowDir;
    const all = [];
    for (const p of points) { all.push(this.P(p[0], p[1], 0)); all.push(this.P(p[0] + dx * h, p[1] + dy * h, 0)); }
    const hh = hull(all);
    this.shadowPaths.push('M' + hh.map(p => n(p[0]) + ' ' + n(p[1])).join('L') + 'Z');
  }
  group(parts, bboxOverride) {
    parts = parts.filter(Boolean);
    const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (const p of parts) for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], p.bbox[i]); bb[i + 3] = Math.max(bb[i + 3], p.bbox[i + 3]); }
    return { svg: parts.map(p => p.svg).join(''), bbox: bboxOverride || bb, sh: 0 };
  }
  // ---------- 2D-Bausteine (Bildschirm) ----------
  poly(points, o = {}) { return `<path d="${rel(points, true)}"${attrs(o)}/>`; }
  line(points, o = {}) { return `<path d="${rel(points, false)}"${attrs({ stroke: this.pal.ink, ...o, fill: 'none' })}/>`; }
  path(d, o = {}) { return `<path d="${d}"${attrs(o)}/>`; }
  circle(x, y, r, o = {}) { return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"${attrs(o)}/>`; }
  ellipse(x, y, rx, ry, o = {}) { return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${attrs(o)}/>`; }
  poly3(p3, o = {}) { return this.poly(p3.map(p => this.P(p[0], p[1], p[2])), o); }
  line3(p3, o = {}) { return this.line(p3.map(p => this.P(p[0], p[1], p[2])), o); }
  // ---------- Rahmen-Bausteine (Fläche im Raum) ----------
  fRect(f, u0, v0, u1, v1, o = {}) { return this.poly([f.pt(u0, v0), f.pt(u1, v0), f.pt(u1, v1), f.pt(u0, v1)], o); }
  fPoly(f, uv, o = {}) { return this.poly(uv.map(p => f.pt(p[0], p[1])), o); }
  fLine(f, uv, o = {}) { return this.line(uv.map(p => f.pt(p[0], p[1])), o); }
  fCircle(f, u, v, r, o = {}, steps = 20) {
    const a = [];
    for (let i = 0; i < steps; i++) { const t = (i / steps) * Math.PI * 2; a.push(f.pt(u + Math.cos(t) * r, v + Math.sin(t) * r)); }
    return this.poly(a, o);
  }
  fText(f, str, u, v, h, o = {}) {
    const L = font.layout(str, u, v, h, o);
    const d = L.strokes.map(s => 'M' + s.map(p => { const q = f.pt(p[0], p[1]); return n(q[0]) + ' ' + n(q[1]); }).join('L')).join('');
    return `<path d="${d}"${attrs({ stroke: o.stroke || this.pal.ink, sw: o.sw || 1.2, cap: 'round', join: 'round', fill: 'none' })}/>`;
  }
  // ---------- Körper ----------
  tone(mat, nrm) {
    const s = Math.abs(nrm[0]) + Math.abs(nrm[1]);
    let h;
    if (s < 1e-6) h = mat.left;
    else h = mix(mat.right, mat.left, clamp(((nrm[1] - nrm[0]) / s) * 0.5 + 0.5, 0, 1));
    const w = clamp(nrm[2], 0, 1);
    return w <= 0 ? h : mix(h, mat.top, Math.pow(w, 0.75));
  }
  /** Konvexer Körper aus Ecken und Flächen (Indexlisten). Zeichnet sichtbare Flächen. */
  solidS(verts, faces, mat, o = {}) {
    const c = [0, 0, 0];
    for (const v of verts) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
    c[0] /= verts.length; c[1] /= verts.length; c[2] /= verts.length;
    const out = [];
    faces.forEach((f, fi) => {
      const p = f.map(i => verts[i]);
      let nn = [0, 0, 0];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        nn[0] += (a[1] - b[1]) * (a[2] + b[2]);
        nn[1] += (a[2] - b[2]) * (a[0] + b[0]);
        nn[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      nn = norm3(nn);
      const fc = [0, 0, 0];
      for (const q of p) { fc[0] += q[0]; fc[1] += q[1]; fc[2] += q[2]; }
      fc[0] /= p.length; fc[1] /= p.length; fc[2] /= p.length;
      if (dot3(nn, sub(fc, c)) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      if (nn[0] + nn[1] + nn[2] < 1e-4) return;
      const fill = (o.faceFill && o.faceFill[fi]) || this.tone(mat, nn);
      out.push({ d: fc[0] + fc[1] + fc[2], svg: this.poly(p.map(q => this.P(q[0], q[1], q[2])), { fill, stroke: o.stroke === null ? null : (o.stroke || mat.line), sw: o.sw || this.lw }) });
    });
    out.sort((a, b) => a.d - b.d);
    return out.map(x => x.svg).join('');
  }
  _boxFrames(x, y, z, w, d, h) {
    return {
      L: this.frame([x, y + d, z], [1, 0, 0], [0, 0, 1], w, h),
      R: this.frame([x + w, y + d, z], [0, -1, 0], [0, 0, 1], d, h),
      T: this.frame([x, y + d, z + h], [1, 0, 0], [0, -1, 0], w, d),
    };
  }
  boxS(x, y, z, w, d, h, mat, o = {}) {
    const V = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z], [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
    const F = [[4, 5, 6, 7], [3, 2, 6, 7], [1, 2, 6, 5]];
    const fills = o.faces ? { 0: o.faces.top, 1: o.faces.left, 2: o.faces.right } : null;
    let s = this.solidS(V, F, mat, { faceFill: fills, sw: o.sw, stroke: o.stroke });
    if (o.decor) {
      const fr = this._boxFrames(x, y, z, w, d, h);
      const r = o.decor(fr, this);
      s += Array.isArray(r) ? r.join('') : (r || '');
    }
    return s;
  }
  box(x, y, z, w, d, h, mat, o = {}) {
    return { svg: this.boxS(x, y, z, w, d, h, mat, o), bbox: [x, y, z, x + w, y + d, z + h], sh: o.sh };
  }
  /** Prisma aus konvexem Grundriss (Welt xy), von z0 bis z1. */
  extrude(poly, z0, z1, mat, o = {}) {
    const k = poly.length;
    const V = poly.map(p => [p[0], p[1], z0]).concat(poly.map(p => [p[0], p[1], z1]));
    const F = [[...Array(k).keys()].map(i => i + k)];
    for (let i = 0; i < k; i++) F.push([i, (i + 1) % k, ((i + 1) % k) + k, i + k]);
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    return { svg: this.solidS(V, F, mat, o), bbox: [Math.min(...xs), Math.min(...ys), z0, Math.max(...xs), Math.max(...ys), z1], fp: poly, sh: o.sh };
  }
  /** Prisma aus konvexem Profil in der xz-Ebene (x, z), Dicke in y von y0 bis y1. */
  prismXZ(poly, y0, y1, mat, o = {}) {
    const k = poly.length;
    const V = poly.map(p => [p[0], y0, p[1]]).concat(poly.map(p => [p[0], y1, p[1]]));
    const F = [[...Array(k).keys()].map(i => i + k), [...Array(k).keys()]];
    for (let i = 0; i < k; i++) F.push([i, (i + 1) % k, ((i + 1) % k) + k, i + k]);
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    return { svg: this.solidS(V, F, mat, o), bbox: [Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs)], sh: o.sh == null ? 0 : o.sh };
  }
  /** Prisma aus konvexem Profil in der yz-Ebene (y, z), Dicke in x von x0 bis x1. */
  prismYZ(poly, x0, x1, mat, o = {}) {
    const k = poly.length;
    const V = poly.map(p => [x0, p[0], p[1]]).concat(poly.map(p => [x1, p[0], p[1]]));
    const F = [[...Array(k).keys()].map(i => i + k), [...Array(k).keys()]];
    for (let i = 0; i < k; i++) F.push([i, (i + 1) % k, ((i + 1) % k) + k, i + k]);
    const ys = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    return { svg: this.solidS(V, F, mat, o), bbox: [x0, Math.min(...ys), Math.min(...zs), x1, Math.max(...ys), Math.max(...zs)], sh: o.sh == null ? 0 : o.sh };
  }
  /** Pyramidenstumpf / Walmdach / Turm: unten w0 x d0 (zentriert um cx,cy), oben w1 x d1, versetzt (ox,oy). */
  frustum(cx, cy, z, w0, d0, w1, d1, h, mat, o = {}) {
    const ox = o.ox || 0, oy = o.oy || 0;
    const b = [[cx - w0 / 2, cy - d0 / 2], [cx + w0 / 2, cy - d0 / 2], [cx + w0 / 2, cy + d0 / 2], [cx - w0 / 2, cy + d0 / 2]];
    const t = [[cx + ox - w1 / 2, cy + oy - d1 / 2], [cx + ox + w1 / 2, cy + oy - d1 / 2], [cx + ox + w1 / 2, cy + oy + d1 / 2], [cx + ox - w1 / 2, cy + oy + d1 / 2]];
    const V = b.map(p => [p[0], p[1], z]).concat(t.map(p => [p[0], p[1], z + h]));
    const F = [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    return {
      svg: this.solidS(V, F, mat, o), bbox: [cx - w0 / 2, cy - d0 / 2, z, cx + w0 / 2, cy + d0 / 2, z + h], sh: o.sh,
    };
  }
  /** Satteldach: Grundfläche x,y,w,d auf Höhe z; First entlang `axis` ('x'|'y'), Firsthöhe rh. */
  gable(x, y, z, w, d, rh, mat, o = {}) {
    const axis = o.axis || 'x';
    let V, F;
    if (axis === 'x') {
      V = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z], [x, y + d / 2, z + rh], [x + w, y + d / 2, z + rh]];
      F = [[0, 1, 5, 4], [3, 2, 5, 4], [0, 3, 4], [1, 2, 5]];
    } else {
      V = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z], [x + w / 2, y, z + rh], [x + w / 2, y + d, z + rh]];
      F = [[0, 3, 5, 4], [1, 2, 5, 4], [0, 1, 4], [3, 2, 5]];
    }
    return { svg: this.solidS(V, F, mat, o), bbox: [x, y, z, x + w, y + d, z + rh], sh: o.sh == null ? 0 : o.sh };
  }
  /** Keil/Rampe: Box, deren Oberseite von Höhe h0 (bei `dir` Start) auf h1 ansteigt. dir: '+x','-x','+y','-y'. */
  ramp(x, y, z, w, d, h0, h1, mat, o = {}) {
    const dir = o.dir || '-x';
    let zt = [h0, h0, h0, h0];
    // Eckenreihenfolge: (x,y),(x+w,y),(x+w,y+d),(x,y+d)
    if (dir === '-x') zt = [h1, h0, h0, h1];
    if (dir === '+x') zt = [h0, h1, h1, h0];
    if (dir === '-y') zt = [h1, h1, h0, h0];
    if (dir === '+y') zt = [h0, h0, h1, h1];
    const V = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
      [x, y, z + zt[0]], [x + w, y, z + zt[1]], [x + w, y + d, z + zt[2]], [x, y + d, z + zt[3]]];
    const F = [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    return { svg: this.solidS(V, F, mat, o), bbox: [x, y, z, x + w, y + d, z + Math.max(h0, h1)], sh: o.sh };
  }
  /** Treppe: Volumen x,y,w,d,h mit `steps` Stufen, steigend nach -x (axis 'x') oder -y (axis 'y'). */
  stairs(x, y, z, w, d, h, steps, mat, o = {}) {
    const axis = o.axis || 'x';
    let s = '';
    for (let i = 0; i < steps; i++) {
      const hh = h * (i + 1) / steps;
      if (axis === 'x') { const dd = w / steps; s += this.boxS(x + w - dd * (i + 1), y, z, dd, d, hh, mat, { sw: o.sw }); } else { const dd = d / steps; s += this.boxS(x, y + d - dd * (i + 1), z, w, dd, hh, mat, { sw: o.sw }); }
    }
    // von hinten (hoch) nach vorn (niedrig) zeichnen
    return { svg: s, bbox: [x, y, z, x + w, y + d, z + h], sh: o.sh };
  }
  /** Gerades Rohr / Kegelstumpf entlang Achse. axis 'x'|'y'|'z'; a0..a1 Achsenbereich; (c1,c2) Mitte in den anderen Achsen. */
  tubeS(axis, a0, a1, c1, c2, r0, r1, mat, o = {}) {
    const N = o.steps || 40;
    const W = (a, r, t) => {
      const cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      if (axis === 'x') return [a, c1 + cs, c2 + sn];
      if (axis === 'y') return [c1 + cs, a, c2 + sn];
      return [c1 + cs, c2 + sn, a];
    };
    const ring0 = [], ring1 = [];
    for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2; ring0.push(this.P(...W(a0, r0, t))); ring1.push(this.P(...W(a1, r1, t))); }
    const hh = hull(ring0.concat(ring1));
    // Verlauf quer zur Achse (Licht oben links)
    const A0 = this.P(...W(a0, 0, 0)), A1 = this.P(...W(a1, 0, 0));
    let dx = A1[0] - A0[0], dy = A1[1] - A0[1];
    let px, py;
    if (Math.hypot(dx, dy) < 1e-3) { px = -1; py = -0.3; } else { px = -dy; py = dx; }
    const pl = Math.hypot(px, py); px /= pl; py /= pl;
    if (py > 0 || (Math.abs(py) < 1e-6 && px > 0)) { px = -px; py = -py; } // zeigt nach oben/links = Lichtseite
    const mid = [(A0[0] + A1[0]) / 2, (A0[1] + A1[1]) / 2];
    const R = Math.max(r0, r1) * this.k * 1.2247;
    const g = this.lin(o.stops || [[0, mix(mat.left, mat.top, 0.55)], [0.18, mat.left], [0.62, mat.left], [1, mat.right]],
      [mid[0] + px * R, mid[1] + py * R], [mid[0] - px * R, mid[1] - py * R]);
    let s = this.poly(hh, { fill: g, stroke: o.stroke === null ? null : (o.stroke || mat.line), sw: o.sw || this.lw });
    if (!o.noCap && r1 > 0.05) {
      s += this.poly(ring1, { fill: o.capFill || mat.top, stroke: o.stroke === null ? null : (o.stroke || mat.line), sw: o.sw || this.lw });
    }
    return s;
  }
  tube(axis, a0, a1, c1, c2, r0, r1, mat, o = {}) {
    const r = Math.max(r0, r1);
    let bb;
    if (axis === 'x') bb = [a0, c1 - r, c2 - r, a1, c1 + r, c2 + r];
    else if (axis === 'y') bb = [c1 - r, a0, c2 - r, c1 + r, a1, c2 + r];
    else bb = [c1 - r, c2 - r, a0, c1 + r, c2 + r, a1];
    return { svg: this.tubeS(axis, a0, a1, c1, c2, r0, r1, mat, o), bbox: bb, sh: o.sh };
  }
  cyl(cx, cy, z, r, h, mat, o = {}) { return this.tube('z', z, z + h, cx, cy, r, r, mat, o); }
  sphereS(cx, cy, cz, r, mat, o = {}) {
    const c = this.P(cx, cy, cz), R = r * this.k * 1.2247;
    const g = o.flat ? mat.left : this.lin([[0, mat.top], [0.45, mat.left], [1, mat.right]], [c[0] - R * 0.7, c[1] - R * 0.8], [c[0] + R * 0.7, c[1] + R * 0.8]);
    return this.circle(c[0], c[1], R, { fill: g, stroke: o.stroke === null ? null : (o.stroke || mat.line), sw: o.sw || this.lw });
  }
  sphere(cx, cy, cz, r, mat, o = {}) {
    return { svg: this.sphereS(cx, cy, cz, r, mat, o), bbox: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r], sh: o.sh };
  }
  dome(cx, cy, z, r, mat, o = {}) {
    const c = this.P(cx, cy, z), R = r * this.k * 1.2247, ry = R * 0.5774;
    const g = this.lin([[0, mat.top], [0.4, mat.left], [1, mat.right]], [c[0] - R * 0.7, c[1] - R], [c[0] + R * 0.7, c[1]]);
    const d = `M${n(c[0] - R)} ${n(c[1])}A${n(R)} ${n(R)} 0 0 1 ${n(c[0] + R)} ${n(c[1])}A${n(R)} ${n(ry)} 0 0 1 ${n(c[0] - R)} ${n(c[1])}Z`;
    return { svg: this.path(d, { fill: g, stroke: mat.line, sw: this.lw }), bbox: [cx - r, cy - r, z, cx + r, cy + r, z + r], sh: o.sh };
  }
  /** Bodenband entlang Polylinie (Welt xy), Breite w, Höhe z. Für Wege, Strassen, Gleise. */
  strip(points, w, z, fill, o = {}) {
    let d = '';
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy); dx /= L; dy /= L;
      const nx = -dy * w / 2, ny = dx * w / 2;
      const e = o.round === false ? 0 : w / 2;
      const a2 = [a[0] - dx * (i === 0 && !o.capStart ? 0 : e), a[1] - dy * (i === 0 && !o.capStart ? 0 : e)];
      const b2 = [b[0] + dx * (i === points.length - 2 && !o.capEnd ? 0 : e), b[1] + dy * (i === points.length - 2 && !o.capEnd ? 0 : e)];
      const q = [[a2[0] + nx, a2[1] + ny], [b2[0] + nx, b2[1] + ny], [b2[0] - nx, b2[1] - ny], [a2[0] - nx, a2[1] - ny]].map(p => this.P(p[0], p[1], z));
      d += 'M' + q.map(p => n(p[0]) + ' ' + n(p[1])).join('L') + 'Z';
    }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { svg: this.path(d, { fill, stroke: o.stroke || null, sw: o.sw || 1 }), bbox: [Math.min(...xs) - w, Math.min(...ys) - w, z - 0.04, Math.max(...xs) + w, Math.max(...ys) + w, z - 0.02], sh: 0 };
  }
  /** Bodenfläche (flaches Polygon) */
  flatPoly(points, z, fill, o = {}) {
    const q = points.map(p => this.P(p[0], p[1], z));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { svg: this.poly(q, { fill, stroke: o.stroke, sw: o.sw || 1, op: o.op, dash: o.dash }), bbox: [Math.min(...xs), Math.min(...ys), z - 0.04, Math.max(...xs), Math.max(...ys), z - 0.02], sh: 0 };
  }
  /** Bodenlinie (Welt xy) */
  groundLine(points, z, o = {}) {
    const q = points.map(p => this.P(p[0], p[1], z));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { svg: this.line(q, { stroke: o.stroke || this.pal.line, sw: o.sw || 1, dash: o.dash, cap: o.cap, op: undefined, sop: o.sop }), bbox: [Math.min(...xs), Math.min(...ys), z - 0.04, Math.max(...xs), Math.max(...ys), z - 0.02], sh: 0 };
  }
  /** Inselplatte: Quader mit Raster auf der Oberseite. */
  plate(x0, y0, x1, y1, th, mat, o = {}) {
    const parts = [];
    const zt = o.z || 0;
    parts.push(this.box(x0, y0, zt - th, x1 - x0, y1 - y0, th, mat, { sh: 0, sw: o.sw }));
    if (o.grid) {
      let d = '';
      const q = (x, y) => { const p = this.P(x, y, zt); return n(p[0]) + ' ' + n(p[1]); };
      for (let x = x0 + o.grid; x < x1 - 0.01; x += o.grid) d += 'M' + q(x, y0) + 'L' + q(x, y1);
      for (let y = y0 + o.grid; y < y1 - 0.01; y += o.grid) d += 'M' + q(x0, y) + 'L' + q(x1, y);
      const col = o.gridColor || (this.pal.name === 'light' ? this.pal.line : mix(this.pal.line, this.pal.mute, 0.2));
      parts.push({ svg: this.path(d, { stroke: col, sw: 0.8 }), bbox: [x0, y0, zt, x1, y1, zt], sh: 0 });
    }
    return this.group(parts);
  }
  /** Masslinie mit Endstrichen zwischen zwei Weltpunkten (Bodenebene), versetzt um off (Welt). */
  dim(a, b, off, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy); const nx = -dy / L * off, ny = dx / L * off;
    const p = this.P(a[0] + nx, a[1] + ny, o.z || 0), q = this.P(b[0] + nx, b[1] + ny, o.z || 0);
    const col = o.stroke || this.pal.mute;
    const t = (pt, w) => { // Endstrich in Richtung der Verschiebung
      const u = this.P(pt[0] + (nx ? Math.sign(nx) : 0) * 0, pt[1], 0); return u;
    };
    const e1 = this.P(a[0] + nx * 1.25, a[1] + ny * 1.25, o.z || 0), e2 = this.P(b[0] + nx * 1.25, b[1] + ny * 1.25, o.z || 0);
    const f1 = this.P(a[0] + nx * 0.75, a[1] + ny * 0.75, o.z || 0), f2 = this.P(b[0] + nx * 0.75, b[1] + ny * 0.75, o.z || 0);
    return this.line([p, q], { stroke: col, sw: 1 }) + this.line([e1, f1], { stroke: col, sw: 1 }) + this.line([e2, f2], { stroke: col, sw: 1 });
  }
  /** Fensterraster auf Rahmen. */
  windows(f, u0, v0, u1, v1, cols, rows, o = {}) {
    const pal = this.pal;
    const gw = (u1 - u0) / cols, gh = (v1 - v0) / rows;
    const ins = o.inset == null ? 0.18 : o.inset;
    let s = '';
    let i = 0;
    const lit = this.m.lit, gl = this.m.glass;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) {
      const a = u0 + c * gw + gw * ins, b = u0 + (c + 1) * gw - gw * ins;
      const v = v0 + r * gh + gh * ins, w = v0 + (r + 1) * gh - gh * ins;
      let fill;
      if (pal.name === 'dark') fill = ((i * 7 + r * 3 + (o.seed || 0)) % 5 < 2) ? lit.left : gl.left;
      else fill = o.fill || gl.left;
      if (pal.name === 'light' && o.litMix && ((i * 7 + r * 3) % 5 === 0)) fill = lit.top;
      s += this.fRect(f, a, v, b, w, { fill, stroke: o.stroke || this.pal.ink, sw: o.sw || 0.8 });
      if (o.mullion) s += this.fLine(f, [[(a + b) / 2, v], [(a + b) / 2, w]], { stroke: o.stroke || this.pal.ink, sw: 0.6 });
    }
    return s;
  }
  /** Bildschirm-Ausdehnung aller Teile (Boden und Objekte) bei aktuellem Massstab. */
  extent() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const L of [this.layers.ground, this.layers.obj]) {
      for (const p of L) {
        const b = p.bbox; if (!b) continue;
        for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
          const q = this.P(x, y, z);
          x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        }
      }
    }
    return { x0, y0, x1, y1 };
  }
  // ---------- Ausgabe ----------
  _sorted() {
    const items = this.layers.obj.map((p, i) => {
      const b = p.bbox;
      const xs = [], ys = [];
      for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) { const q = this.P(x, y, z); xs.push(q[0]); ys.push(q[1]); }
      return { p, i, b, sx0: Math.min(...xs) - 3, sx1: Math.max(...xs) + 3, sy0: Math.min(...ys) - 3, sy1: Math.max(...ys) + 3, cd: (b[0] + b[3] + b[1] + b[4] + b[2] + b[5]) / 2 };
    });
    const N = items.length;
    const succ = items.map(() => []); const indeg = new Array(N).fill(0);
    const eps = 1e-6;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const A = items[i], B = items[j];
      if (A.sx1 < B.sx0 || B.sx1 < A.sx0 || A.sy1 < B.sy0 || B.sy1 < A.sy0) continue;
      let ord = 0; // -1: A hinter B (A zuerst), 1: B zuerst
      const a = A.b, b = B.b;
      if (a[3] <= b[0] + eps) ord = -1; else if (b[3] <= a[0] + eps) ord = 1;
      else if (a[4] <= b[1] + eps) ord = -1; else if (b[4] <= a[1] + eps) ord = 1;
      else if (a[5] <= b[2] + eps) ord = -1; else if (b[5] <= a[2] + eps) ord = 1;
      else ord = A.cd <= B.cd ? -1 : 1;
      if (ord < 0) { succ[i].push(j); indeg[j]++; } else { succ[j].push(i); indeg[i]++; }
    }
    const done = new Array(N).fill(false); const out = [];
    for (let c = 0; c < N; c++) {
      let pick = -1;
      for (let i = 0; i < N; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || items[i].cd < items[pick].cd - 1e-9 || (Math.abs(items[i].cd - items[pick].cd) < 1e-9 && i < pick))) pick = i;
      if (pick < 0) { for (let i = 0; i < N; i++) if (!done[i] && (pick < 0 || items[i].cd < items[pick].cd)) pick = i; }
      done[pick] = true; out.push(items[pick].p);
      for (const j of succ[pick]) indeg[j]--;
    }
    return out;
  }
  svg() {
    const L = this.layers;
    const body = [];
    body.push(`<rect width="${this.w}" height="${this.h}" fill="${this.bgFill}" stroke="none"/>`);
    L.bg.forEach(p => body.push(p.svg));
    L.ground.forEach(p => body.push(p.svg));
    if (this.shadowPaths.length) body.push(`<path d="${this.shadowPaths.join('')}" fill="${this.pal.name === 'light' ? this.pal.ink : this.pal.bg}" fill-opacity="${this.pal.name === 'light' ? 0.13 : 0.6}" stroke="none"/>`);
    L.shadow.forEach(p => body.push(p.svg));
    this._sorted().forEach(p => body.push(p.svg));
    L.top.forEach(p => body.push(p.svg));
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    const inner = body.join('').replace(/ stroke-linejoin="round"/g, '').replace(/ stroke-width="1\.1"/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">${defs}<g stroke="${this.defStroke}" stroke-width="1.1" stroke-linejoin="round">${inner}</g></svg>\n`;
  }
}

module.exports = { Scene, Frame, Flat, attrs, C30 };
