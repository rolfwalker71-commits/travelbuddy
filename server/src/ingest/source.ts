/**
 * Quellen lesen: PDF-Textebene (seitenweise), Scans/Fotos (Bild bzw. PDF an das Vision-Modell), `.ics`, `.pkpass`.
 * Deterministische Kandidaten (BCBP, Kalender, Pass) entstehen hier; die KI ergänzt sie später.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { findBcbpInText } from "./bcbp";
import { icsCandidates, icsToText, parseIcs } from "./icsparse";
import { parsePkpass } from "./pkpass";
import type { Attachment, Candidate, PageText, SourceContent } from "./types";

/** Weniger Zeichen = Scan oder Foto (Vision). */
export const MIN_TEXT_CHARS_TOTAL = 120;
export const MIN_TEXT_CHARS_PER_PAGE = 40;
/** Obergrenze gerenderter Seiten (Kosten) und der PDF-Direkteingabe. */
export const MAX_VISION_PAGES = 8;
export const MAX_FILE_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 19 * 1024 * 1024;

export type PageRenderer = (pdfPath: string, opts: { maxPages: number }) => Promise<Buffer[] | null>;
export type HeicConverter = (bytes: Uint8Array) => Promise<Buffer | null>;

export type SourceDeps = {
  /** Zone für UTC-Zeiten aus Kalendern (Zone der Reise bzw. Servervorgabe). */
  defaultTz: string;
  /** Seiten als Bild rendern (poppler); null = nicht verfügbar. */
  render?: PageRenderer | null;
  heic?: HeicConverter | null;
};

export type SourceInput = {
  contentType: string;
  fileName: string;
  bytes: Uint8Array;
  /** Pfad der Originaldatei (für poppler). */
  filePath: string;
};

const clean = (s: string) =>
  s
    .replace(/[   ]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏⁠﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const nonWs = (s: string) => s.replace(/\s+/g, "").length;

export async function pdfPages(bytes: Uint8Array): Promise<{ pages: PageText[]; pageCount: number } | null> {
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    // `getDocumentProxy` übernimmt den Puffer; eine Kopie hält `bytes` für spätere Verwendung intakt.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const r = await extractText(pdf, { mergePages: false });
    const texts = Array.isArray(r.text) ? r.text : [String(r.text)];
    return { pages: texts.map((t, i) => ({ page: i + 1, text: clean(t) })), pageCount: r.totalPages ?? texts.length };
  } catch {
    return null;
  }
}

function bcbpCandidates(pages: PageText[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of pages) {
    for (const leg of findBcbpInText(p.text)) {
      out.push({
        origin: "bcbp",
        type: "Flug",
        fields: {
          flightNumber: leg.flightNumber,
          departureAirport: leg.from,
          arrivalAirport: leg.to,
          bookingReference: leg.pnr,
        },
        dayOfYear: leg.dayOfYear,
        passenger: { name: leg.passengerName, seat: leg.seat },
        quote: `BCBP ${leg.raw.trim().slice(0, 60)}`,
        page: p.page,
        confidence: 0.99,
        authoritative: ["flightNumber", "departureAirport", "arrivalAirport", "bookingReference", "startDate"],
        weak: true,
      });
    }
  }
  return out;
}

/** Zusammenfassen gleicher Flüge aus mehreren Quellen (Barcode im Text und im Pass). */
export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of list) {
    const key = [c.origin === "ics" ? c.quote : "", c.type, c.fields.flightNumber ?? "", c.dayOfYear ?? c.fields.startDate ?? "", c.passenger?.name ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function loadSource(input: SourceInput, deps: SourceDeps): Promise<SourceContent> {
  const { contentType, bytes } = input;
  const base: SourceContent = {
    kind: "pdf",
    textSource: "pdf_text",
    pages: [],
    pageCount: null,
    chars: 0,
    needsVision: false,
    attachments: [],
    candidates: [],
    notes: [],
  };

  if (contentType === "text/calendar") {
    const text = Buffer.from(bytes).toString("utf8");
    const events = parseIcs(text, { defaultTz: deps.defaultTz });
    const readable = icsToText(events);
    return {
      ...base,
      kind: "ics",
      textSource: "ics",
      pages: readable ? [{ page: 1, text: readable }] : [],
      pageCount: 1,
      chars: nonWs(readable),
      candidates: icsCandidates(events),
      notes: events.length === 0 ? ["Der Kalender enthält keine Termine"] : [],
    };
  }

  if (contentType === "application/vnd.apple.pkpass") {
    const pass = parsePkpass(bytes);
    if (!pass) return { ...base, kind: "pkpass", textSource: "pkpass", notes: ["pass.json nicht lesbar"] };
    const pages = pass.text ? [{ page: 1, text: pass.text }] : [];
    return {
      ...base,
      kind: "pkpass",
      textSource: "pkpass",
      pages,
      pageCount: 1,
      chars: nonWs(pass.text),
      candidates: dedupeCandidates(pass.candidates),
    };
  }

  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/heic") {
    let data: Uint8Array = bytes;
    let mime = contentType;
    if (contentType === "image/heic") {
      const converted = deps.heic ? await deps.heic(bytes).catch(() => null) : null;
      if (!converted) {
        return {
          ...base,
          kind: "image",
          textSource: "vision",
          needsVision: true,
          pageCount: 1,
          notes: ["HEIC kann dieser Server nicht umwandeln (sips, heif-convert oder ImageMagick fehlt); bitte als JPEG oder PDF hochladen"],
        };
      }
      data = converted;
      mime = "image/jpeg";
    }
    if (data.length > MAX_IMAGE_BYTES) {
      return { ...base, kind: "image", textSource: "vision", needsVision: true, pageCount: 1, notes: ["Das Bild ist zu gross für die Bilderkennung (über 19 MB)"] };
    }
    return {
      ...base,
      kind: "image",
      textSource: "vision",
      needsVision: true,
      pageCount: 1,
      attachments: [{ kind: "image", mime, base64: Buffer.from(data).toString("base64") }],
    };
  }

  // PDF
  const read = await pdfPages(bytes);
  const pages = read?.pages ?? [];
  const pageCount = read?.pageCount ?? null;
  const chars = pages.reduce((n, p) => n + nonWs(p.text), 0);
  const avg = pageCount ? chars / pageCount : 0;
  const sparse = !read || chars < MIN_TEXT_CHARS_TOTAL || avg < MIN_TEXT_CHARS_PER_PAGE;
  const out: SourceContent = {
    ...base,
    kind: "pdf",
    pages,
    pageCount,
    chars,
    needsVision: sparse,
    textSource: sparse ? "vision" : "pdf_text",
    candidates: dedupeCandidates(bcbpCandidates(pages)),
  };
  if (!read) out.notes.push("Die PDF-Textebene ist nicht lesbar (defekt oder verschlüsselt)");
  if (sparse) {
    const attachments: Attachment[] = [];
    const rendered = deps.render ? await deps.render(input.filePath, { maxPages: MAX_VISION_PAGES }).catch(() => null) : null;
    if (rendered && rendered.length) {
      for (const img of rendered) attachments.push({ kind: "image", mime: "image/jpeg", base64: img.toString("base64") });
      if (pageCount && pageCount > rendered.length) out.notes.push(`Nur die ersten ${rendered.length} von ${pageCount} Seiten wurden als Bild gelesen`);
    } else if (bytes.length <= MAX_FILE_INPUT_BYTES) {
      attachments.push({ kind: "pdf", fileName: input.fileName.replace(/[^\w.\- ]/g, "_") || "dokument.pdf", base64: Buffer.from(bytes).toString("base64") });
    } else {
      out.notes.push("Scan ist zu gross für die direkte Übergabe und pdftoppm (poppler-utils) fehlt");
    }
    out.attachments = attachments;
  }
  return out;
}

/* ───────────── Externe Werkzeuge ───────────── */

const run = (cmd: string, args: string[], timeout = 60_000) =>
  new Promise<boolean>((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err) => resolve(!err));
  });

/** PDF-Seiten mit `pdftoppm` als JPEG rendern (längste Seite 1600 px). */
export const pdftoppmRenderer: PageRenderer = async (pdfPath, { maxPages }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tb-render-${randomBytes(3).toString("hex")}-`));
  try {
    const ok = await run("pdftoppm", ["-jpeg", "-jpegopt", "quality=82", "-f", "1", "-l", String(maxPages), "-scale-to", "1600", pdfPath, path.join(dir, "p")]);
    if (!ok) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
    return files.map((f) => fs.readFileSync(path.join(dir, f)));
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** HEIC → JPEG mit dem ersten verfügbaren Werkzeug (macOS `sips`, `heif-convert`, ImageMagick). */
export const heicConverter: HeicConverter = async (bytes) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tb-heic-${randomBytes(3).toString("hex")}-`));
  try {
    const src = path.join(dir, "in.heic");
    const dst = path.join(dir, "out.jpg");
    fs.writeFileSync(src, bytes);
    const attempts: Array<[string, string[]]> = [
      ["sips", ["-s", "format", "jpeg", src, "--out", dst]],
      ["heif-convert", [src, dst]],
      ["magick", [src, dst]],
      ["convert", [src, dst]],
    ];
    for (const [cmd, args] of attempts) {
      if ((await run(cmd, args)) && fs.existsSync(dst)) return fs.readFileSync(dst);
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
