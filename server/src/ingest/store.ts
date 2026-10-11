/**
 * Dateiablage der Dokumente: `<documentsDir>/<sha256[0:2]>/<sha256>.<ext>` (Inhalts-Hash = Name, daher
 * idempotent und dublettenfrei). Vorschaubilder liegen unter `<documentsDir>/thumbs/<sha256>.jpg`.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

const EXT_RE = /^[a-z0-9]{2,6}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export function documentFilePath(documentsDir: string, sha256: string, ext: string): string {
  if (!SHA_RE.test(sha256) || !EXT_RE.test(ext)) throw new Error("Ungültiger Dokument-Hash oder Dateityp");
  return path.join(documentsDir, sha256.slice(0, 2), `${sha256}.${ext}`);
}

export function writeDocumentFile(documentsDir: string, sha256: string, ext: string, bytes: Uint8Array): string {
  const dest = documentFilePath(documentsDir, sha256, ext);
  try {
    if (fs.statSync(dest).size === bytes.length) return dest;
  } catch {
    /* noch nicht vorhanden */
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, dest);
  return dest;
}

export function removeDocumentFiles(documentsDir: string, sha256: string, ext: string): void {
  try {
    fs.rmSync(documentFilePath(documentsDir, sha256, ext), { force: true });
    fs.rmSync(path.join(documentsDir, "thumbs", `${sha256}.jpg`), { force: true });
  } catch {
    /* beim nächsten Aufräumen */
  }
}

/* ───────────── Vorschaubilder ─────────────
 * Bilder (JPEG/PNG) dienen sich selbst als Vorschau. PDF: erste Seite mit `pdftoppm` (poppler-utils), sofern
 * installiert (im Docker-Image ja). Sonst, und für HEIC/.pkpass/.ics, gibt es keine Vorschau (404 beim
 * Abruf, `thumbnailUrl: null`): Die Clients zeichnen selbst (PDFKit/pdf.js, Wallet, Kalender). */

let popplerChecked: Promise<boolean> | null = null;
export function popplerAvailable(): Promise<boolean> {
  return (popplerChecked ??= new Promise((resolve) => {
    execFile("pdftoppm", ["-v"], { timeout: 5000 }, (err) => resolve(!err || (err as NodeJS.ErrnoException).code !== "ENOENT"));
  }));
}

export function thumbnailPossible(ext: string, popplerOk: boolean): boolean {
  return ext === "jpg" || ext === "png" || (ext === "pdf" && popplerOk);
}

export async function documentThumbnail(
  documentsDir: string,
  sha256: string,
  ext: string,
  contentType: string
): Promise<{ file: string; contentType: string } | null> {
  const original = documentFilePath(documentsDir, sha256, ext);
  if (ext === "jpg" || ext === "png") return fs.existsSync(original) ? { file: original, contentType } : null;
  if (ext !== "pdf" || !(await popplerAvailable())) return null;
  const dir = path.join(documentsDir, "thumbs");
  const out = path.join(dir, `${sha256}.jpg`);
  if (fs.existsSync(out)) return { file: out, contentType: "image/jpeg" };
  if (!fs.existsSync(original)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${sha256}.tmp-${randomBytes(3).toString("hex")}`);
  const ok = await new Promise<boolean>((resolve) => {
    execFile("pdftoppm", ["-jpeg", "-f", "1", "-l", "1", "-scale-to", "900", "-singlefile", original, base], { timeout: 30_000 }, (err) =>
      resolve(!err)
    );
  });
  if (!ok || !fs.existsSync(`${base}.jpg`)) return null;
  fs.renameSync(`${base}.jpg`, out);
  return { file: out, contentType: "image/jpeg" };
}
