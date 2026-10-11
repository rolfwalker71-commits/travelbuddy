'use strict';
// Verlustarme Palettenquantisierung (Median Cut + k-Means) und indizierter PNG-Encoder, ohne Abhängigkeiten.
const zlib = require('zlib');

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** rgba: Buffer (w*h*4). Liefert { palette: Uint8Array(n*3), index: Uint8Array(w*h) }. */
function quantize(rgba, w, h, maxColors = 256) {
  const N = w * h;
  const BITS = 6, SH = 8 - BITS, SIZE = 1 << (BITS * 3);
  const cnt = new Uint32Array(SIZE), sr = new Float64Array(SIZE), sg = new Float64Array(SIZE), sb = new Float64Array(SIZE);
  const binOf = new Uint32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const k = ((r >> SH) << (2 * BITS)) | ((g >> SH) << BITS) | (b >> SH);
    binOf[i] = k; cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  const nb = [];
  for (let k = 0; k < SIZE; k++) if (cnt[k]) nb.push(k);
  const NB = nb.length;
  const bR = new Float64Array(NB), bG = new Float64Array(NB), bB = new Float64Array(NB), bN = new Float64Array(NB);
  for (let i = 0; i < NB; i++) { const k = nb[i]; bN[i] = cnt[k]; bR[i] = sr[k] / cnt[k]; bG[i] = sg[k] / cnt[k]; bB[i] = sb[k] / cnt[k]; }
  const chan = [bR, bG, bB];
  // Median Cut über Bin-Indizes
  const mkBox = idx => {
    let lo = [255, 255, 255], hi = [0, 0, 0], n = 0;
    for (let q = 0; q < idx.length; q++) {
      const i = idx[q]; n += bN[i];
      for (let j = 0; j < 3; j++) { const v = chan[j][i]; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; }
    }
    const range = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    return { idx, n, range, score: Math.max(...range) * Math.sqrt(n) };
  };
  let boxes = [mkBox(Int32Array.from({ length: NB }, (_, i) => i))];
  while (boxes.length < maxColors) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => { if (b.idx.length > 1 && b.score > best) { best = b.score; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi];
    const ch = b.range[0] >= b.range[1] && b.range[0] >= b.range[2] ? 0 : (b.range[1] >= b.range[2] ? 1 : 2);
    const arr = Array.from(b.idx).sort((x, y) => chan[ch][x] - chan[ch][y]);
    let acc = 0; const half = b.n / 2; let cut = 0;
    for (let i = 0; i < arr.length; i++) { acc += bN[arr[i]]; if (acc >= half) { cut = i + 1; break; } }
    cut = Math.max(1, Math.min(arr.length - 1, cut));
    boxes.splice(bi, 1, mkBox(Int32Array.from(arr.slice(0, cut))), mkBox(Int32Array.from(arr.slice(cut))));
  }
  const NP = boxes.length;
  const pr = new Float64Array(NP), pg = new Float64Array(NP), pb = new Float64Array(NP);
  boxes.forEach((bx, j) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let q = 0; q < bx.idx.length; q++) { const i = bx.idx[q]; r += bR[i] * bN[i]; g += bG[i] * bN[i]; bl += bB[i] * bN[i]; n += bN[i]; }
    pr[j] = r / n; pg[j] = g / n; pb[j] = bl / n;
  });
  // k-Means-Verfeinerung
  const assign = new Int32Array(NB);
  for (let it = 0; it < 2; it++) {
    const aR = new Float64Array(NP), aG = new Float64Array(NP), aB = new Float64Array(NP), aN = new Float64Array(NP);
    for (let i = 0; i < NB; i++) {
      let best = 0, bd = 1e18;
      const r = bR[i], g = bG[i], b = bB[i];
      for (let j = 0; j < NP; j++) { const dr = r - pr[j], dg = g - pg[j], db = b - pb[j]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = j; } }
      assign[i] = best; aR[best] += r * bN[i]; aG[best] += g * bN[i]; aB[best] += b * bN[i]; aN[best] += bN[i];
    }
    for (let j = 0; j < NP; j++) if (aN[j]) { pr[j] = aR[j] / aN[j]; pg[j] = aG[j] / aN[j]; pb[j] = aB[j] / aN[j]; }
  }
  const pal = Array.from({ length: NP }, (_, j) => [pr[j], pg[j], pb[j]]);
  const lut = new Uint8Array(SIZE);
  for (let i = 0; i < NB; i++) lut[nb[i]] = assign[i];
  const index = new Uint8Array(N);
  for (let i = 0; i < N; i++) index[i] = lut[binOf[i]];
  const palette = new Uint8Array(pal.length * 3);
  pal.forEach((p, j) => { palette[j * 3] = Math.round(p[0]); palette[j * 3 + 1] = Math.round(p[1]); palette[j * 3 + 2] = Math.round(p[2]); });
  return { palette, index };
}

function encodeIndexed(w, h, palette, index) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(w));
  for (let y = 0; y < h; y++) {
    const row = index.subarray(y * w, (y + 1) * w);
    const up = y ? index.subarray((y - 1) * w, y * w) : null;
    let bestF = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let s = 0;
      for (let x = 0; x < w; x++) {
        const a = x ? row[x - 1] : 0, b = up ? up[x] : 0, cc = up && x ? up[x - 1] : 0;
        let v;
        switch (f) {
          case 0: v = row[x]; break;
          case 1: v = row[x] - a; break;
          case 2: v = row[x] - b; break;
          case 3: v = row[x] - ((a + b) >> 1); break;
          default: { const p = a + b - cc; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? b : cc); v = row[x] - pr; }
        }
        v &= 255; c[x] = v; s += v < 128 ? v : 256 - v;
      }
      if (s < bestS) { bestS = s; bestF = f; }
    }
    raw[y * (w + 1)] = bestF;
    cand[bestF].copy(raw, y * (w + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(palette)), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** rgb32: Buffer mit w*h*4 Bytes (R,G,B,X). */
function toPng8(rgba, w, h, colors = 256) {
  const { palette, index } = quantize(rgba, w, h, colors);
  return encodeIndexed(w, h, palette, index);
}

module.exports = { toPng8, quantize, encodeIndexed };
