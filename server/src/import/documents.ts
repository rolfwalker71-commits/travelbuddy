/**
 * Dokumente für den Import vorbereiten (lesend, asynchron): Dateien aus dem Dokumentenordner lesen, Typ am Dateikopf
 * prüfen, SHA-256 und Seitenzahl bestimmen und mit den HomeBuddy-Zeilen (OCR-Text, Altanalyse) zusammenführen.
 * In die Datenbank und auf die Platte schreibt erst der Import selbst.
 *
 * Ordnerlayout (von der Vorbereitung erzeugt): `manifest.json` und `paperless-<id>.<ext>`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sniffUpload, uploadFilename } from "../ingest/sniff";
import type { OpenedSource, Row } from "./source";

export type PreparedDoc = {
  /** HomeBuddy `documents.id` (null: nur im Manifest). */
  sourceId: number | null;
  paperlessId: number | null;
  title: string;
  fileName: string;
  contentType: string;
  ext: string;
  bytes: Uint8Array;
  sha256: string;
  pages: number | null;
  text: string | null;
  summary: string | null;
  analysisJson: string | null;
  analyzedAt: string | null;
  createdAt: string | null;
  /** Hängt in HomeBuddy an einem Ereignis (oder einer Ausgabe)? */
  linked: boolean;
  sourceMeta: Record<string, unknown>;
};

export type DocumentPlan = {
  docs: PreparedDoc[];
  /** Verknüpfte HomeBuddy-Dokumente (nur Ereignisse), unabhängig davon, ob die Datei da ist. */
  linkedInSource: number;
  /** Verknüpfte Dokumente ohne verwendbare Datei (HomeBuddy-IDs). */
  missing: number[];
  hashMismatches: number;
  folder: boolean;
  warnings: string[];
};

type ManifestFile = {
  paperlessId?: number;
  homebuddyDocumentId?: number;
  title?: string;
  fileName?: string;
  sha256?: string;
  originalFileName?: string;
};

function readManifest(folder: string): ManifestFile[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")) as { files?: ManifestFile[] };
    return Array.isArray(raw.files) ? raw.files : [];
  } catch {
    return [];
  }
}

async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

const EXTS = ["pdf", "jpg", "jpeg", "png", "heic"];

function locateFile(folder: string, paperlessId: number | null, manifestName: string | undefined): string | null {
  const names: string[] = [];
  if (manifestName) names.push(path.basename(manifestName));
  if (paperlessId != null) for (const e of EXTS) names.push(`paperless-${paperlessId}.${e}`);
  for (const n of names) {
    const p = path.join(folder, n);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* nächster Name */
    }
  }
  return null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function validJson(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

export async function prepareDocuments(
  src: OpenedSource,
  folder: string | null,
  opts: { includeUnlinked: boolean }
): Promise<DocumentPlan> {
  const d = src.data;
  const eventDocIds = [...new Set(d.trip_event_documents.map((l) => Number(l.document_id)))];
  const expenseDocIds = [...new Set(d.expenses.map((e) => e.document_id).filter((x) => x != null).map(Number))];
  const linkedIds = [...new Set([...eventDocIds, ...expenseDocIds])];
  const plan: DocumentPlan = {
    docs: [],
    linkedInSource: eventDocIds.length,
    missing: [],
    hashMismatches: 0,
    folder: folder != null,
    warnings: [],
  };
  if (!folder) return plan;
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    plan.folder = false;
    plan.warnings.push("Der angegebene Dokumentenordner existiert nicht; Dokumente werden nicht übernommen.");
    return plan;
  }

  const manifest = readManifest(folder);
  const byPaperless = new Map(manifest.filter((m) => m.paperlessId != null).map((m) => [Number(m.paperlessId), m]));
  const rows = src.documentsByIds(linkedIds);
  const rowById = new Map(rows.map((r) => [Number(r.id), r]));

  const wanted: Array<{ row: Row | null; manifest: ManifestFile | undefined; linked: boolean; sourceId: number | null; paperlessId: number | null }> = [];
  for (const id of linkedIds) {
    const row = rowById.get(id) ?? null;
    const pid = row?.paperless_id != null ? Number(row.paperless_id) : null;
    const m = pid != null ? byPaperless.get(pid) : manifest.find((x) => x.homebuddyDocumentId === id);
    wanted.push({ row, manifest: m, linked: true, sourceId: id, paperlessId: pid ?? (m?.paperlessId != null ? Number(m.paperlessId) : null) });
  }
  if (opts.includeUnlinked) {
    const have = new Set(wanted.map((w) => w.paperlessId).filter((x): x is number => x != null));
    const extra = manifest.filter((m) => m.paperlessId != null && !have.has(Number(m.paperlessId)));
    const extraRows = new Map(src.documentsByPaperlessIds(extra.map((m) => Number(m.paperlessId))).map((r) => [Number(r.paperless_id), r]));
    for (const m of extra) {
      const pid = Number(m.paperlessId);
      const row = extraRows.get(pid) ?? null;
      wanted.push({ row, manifest: m, linked: false, sourceId: row ? Number(row.id) : (m.homebuddyDocumentId ?? null), paperlessId: pid });
    }
  }

  for (const w of wanted) {
    const file = locateFile(folder, w.paperlessId, w.manifest?.fileName);
    if (!file) {
      if (w.linked && w.sourceId != null) plan.missing.push(w.sourceId);
      continue;
    }
    const bytes = new Uint8Array(fs.readFileSync(file));
    const type = sniffUpload(bytes);
    if (!type) {
      if (w.linked && w.sourceId != null) plan.missing.push(w.sourceId);
      plan.warnings.push(`Datei ${path.basename(file)} hat keinen unterstützten Dateityp und wird übersprungen.`);
      continue;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (w.manifest?.sha256 && w.manifest.sha256.toLowerCase() !== sha256) {
      plan.hashMismatches += 1;
      plan.warnings.push(`Datei ${path.basename(file)}: SHA-256 weicht vom Manifest ab; Datei wird übersprungen.`);
      if (w.linked && w.sourceId != null) plan.missing.push(w.sourceId);
      continue;
    }
    const row = w.row;
    const title =
      text(row?.suggested_title)?.trim() ?? text(row?.title)?.trim() ?? text(w.manifest?.title)?.trim() ?? path.basename(file);
    const analysisJson = row && row.analysis_status === "done" ? validJson(row.analysis_json) : null;
    const origName = text(row?.original_file_name) ?? text(w.manifest?.originalFileName) ?? path.basename(file);
    plan.docs.push({
      sourceId: w.sourceId,
      paperlessId: w.paperlessId,
      title,
      fileName: uploadFilename(origName, type),
      contentType: type.contentType,
      ext: type.ext,
      bytes,
      sha256,
      pages: type.ext === "pdf" ? await pdfPageCount(bytes) : type.ext === "jpg" || type.ext === "png" || type.ext === "heic" ? 1 : null,
      text: text(row?.content),
      summary: text(row?.summary),
      analysisJson,
      analyzedAt: text(row?.analyzed_at),
      createdAt: text(row?.added_at) ?? text(row?.created_at),
      linked: w.linked,
      sourceMeta: {
        importedFrom: "homebuddy",
        ...(w.paperlessId != null ? { paperlessId: w.paperlessId } : {}),
        ...(w.sourceId != null ? { homebuddyDocumentId: w.sourceId } : {}),
      },
    });
  }
  return plan;
}
