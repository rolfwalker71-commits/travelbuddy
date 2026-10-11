/** Dateityp anhand der ersten Bytes (Dateiname und Content-Type des Clients sind nicht verlässlich). */
export type UploadType = {
  ext: "pdf" | "jpg" | "png" | "heic" | "pkpass" | "ics";
  contentType: string;
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

const ascii = (b: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]!);
  return s;
};

export function sniffUpload(bytes: Uint8Array): UploadType | null {
  const at = (sig: number[], off = 0) => sig.every((v, i) => bytes[off + i] === v);
  if (bytes.length < 8) return null;
  // PDF: «%PDF-» innerhalb der ersten KiB (die Spezifikation erlaubt Vorspann).
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return { ext: "pdf", contentType: "application/pdf" };
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", contentType: "image/png" };
  if (at([0xff, 0xd8, 0xff])) return { ext: "jpg", contentType: "image/jpeg" };
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12))) return { ext: "heic", contentType: "image/heic" };
  // Wallet-Pass: ZIP mit pass.json (Dateinamen stehen unkomprimiert in den ZIP-Verzeichnissen).
  if (at([0x50, 0x4b, 0x03, 0x04])) {
    const latin = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    if (latin.includes("pass.json")) return { ext: "pkpass", contentType: "application/vnd.apple.pkpass" };
    return null;
  }
  // iCalendar
  const head = ascii(bytes, 0, 64).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toUpperCase();
  if (head.startsWith("BEGIN:VCALENDAR")) return { ext: "ics", contentType: "text/calendar" };
  return null;
}

/** Ungefährlicher Dateiname mit passender Endung. */
export function uploadFilename(raw: string | undefined, type: UploadType): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  let name = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"<>:|?*]/g, "")
    .trim()
    .slice(0, 120);
  if (!name) name = "Dokument";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const same = ext === type.ext || (type.ext === "jpg" && ext === "jpeg") || (type.ext === "heic" && ext === "heif");
  return same ? name : `${stem}.${type.ext}`;
}

export function titleFromFilename(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.replace(/[_]+/g, " ").trim() || fileName;
}
