/**
 * Minimaler ZIP-Leser (nur Lesen, nur «stored» und «deflate») für `.pkpass`-Dateien. Gelesen wird über das
 * zentrale Verzeichnis am Dateiende; Grössen sind begrenzt (Schutz vor ZIP-Bomben).
 */
import zlib from "node:zlib";

const MAX_ENTRIES = 500;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export type ZipEntry = { name: string; data: Uint8Array };

export function listZipNames(bytes: Uint8Array): string[] {
  return centralDirectory(bytes).map((e) => e.name);
}

type CdEntry = { name: string; method: number; compSize: number; size: number; offset: number };

function centralDirectory(bytes: Uint8Array): CdEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // «End of central directory» (PK\x05\x06) von hinten suchen (Kommentar höchstens 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: CdEntry[] = [];
  for (let n = 0; n < Math.min(total, MAX_ENTRIES); n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Inhalt der Datei `name` (Gross-/Kleinschreibung egal) oder null. */
export function readZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const e = centralDirectory(bytes).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!e || e.size > MAX_ENTRY_BYTES) return null;
  const p = e.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  try {
    if (e.method === 0) return new Uint8Array(raw);
    if (e.method === 8) return new Uint8Array(zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }));
  } catch {
    return null;
  }
  return null;
}
