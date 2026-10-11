import { createHash } from "node:crypto";
import type { Db } from "../db/client";
import { HttpError, notFound } from "../lib/errors";
import * as T from "../trips/service";
import { sniffUpload, titleFromFilename, uploadFilename, MAX_UPLOAD_BYTES, type UploadType } from "./sniff";
import { documentFilePath, removeDocumentFiles, writeDocumentFile, thumbnailPossible } from "./store";

export type DocumentRow = {
  id: number;
  title: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  pages: number | null;
  text: string | null;
  text_source: string | null;
  analysis_status: "pending" | "processing" | "done" | "failed" | "skipped";
  analysis_attempts: number;
  analysis_next_retry_at: string | null;
  analysis_error: string | null;
  analysis_json: string | null;
  analysis_model: string | null;
  analyzed_at: string | null;
  summary: string | null;
  source: "upload" | "share" | "mail";
  source_meta: string;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

export function getDocumentRow(db: Db, id: number): DocumentRow {
  const d = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
  if (!d) throw notFound("Dokument");
  return d;
}

export function extOf(row: Pick<DocumentRow, "file_name" | "content_type">): string {
  switch (row.content_type) {
    case "application/pdf": return "pdf";
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/heic": return "heic";
    case "application/vnd.apple.pkpass": return "pkpass";
    case "text/calendar": return "ics";
    default: return "bin";
  }
}

/** Seitenzahl eines PDFs (best effort; verschlüsselte oder defekte Dateien ergeben null). */
async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

export type IngestResult = { document: DocumentRow; duplicate: boolean };

/**
 * Datei annehmen: Typ am Dateikopf prüfen, SHA-256 gegen Dubletten (gleiche Datei = bestehendes Dokument),
 * Original ablegen, Zeile anlegen, an Reise/Ereignis hängen. Die Analyse stösst der Aufrufer an.
 */
export async function ingestFile(
  db: Db,
  documentsDir: string,
  input: {
    bytes: Uint8Array;
    fileName?: string;
    source: "upload" | "share" | "mail";
    sourceMeta?: Record<string, unknown>;
    userId: number | null;
    tripId?: number | null;
    eventId?: number | null;
  }
): Promise<IngestResult> {
  const { bytes } = input;
  if (bytes.length === 0) throw new HttpError(422, "empty_file", "Die Datei ist leer");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "payload_too_large", "Die Datei ist grösser als 25 MB");
  const type: UploadType | null = sniffUpload(bytes);
  if (!type) {
    throw new HttpError(415, "unsupported_media_type", "Dateityp nicht unterstützt (erlaubt: PDF, JPG, PNG, HEIC, .pkpass, .ics)");
  }
  if (input.tripId != null) T.getTrip(db, input.tripId);
  if (input.eventId != null) {
    if (input.tripId == null) throw new HttpError(422, "trip_required", "eventId braucht eine Reise");
    T.getEventRow(db, input.tripId, input.eventId);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = uploadFilename(input.fileName, type);
  let row = db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(sha256) as DocumentRow | undefined;
  let duplicate = true;
  if (!row) {
    duplicate = false;
    const pages = type.ext === "pdf" ? await pdfPageCount(bytes) : type.ext === "jpg" || type.ext === "png" || type.ext === "heic" ? 1 : null;
    writeDocumentFile(documentsDir, sha256, type.ext, bytes);
    const ts = now();
    // Gleichzeitiger Upload derselben Datei: UNIQUE(sha256) entscheidet, der Zweite bekommt die bestehende Zeile.
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO documents (title, file_name, content_type, size_bytes, sha256, pages, analysis_status, source,
                                          source_meta, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .run(
        titleFromFilename(fileName), fileName, type.contentType, bytes.length, sha256, pages, input.source,
        JSON.stringify(input.sourceMeta ?? {}), input.userId, ts, ts
      );
    row = db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(sha256) as DocumentRow;
    if (res.changes === 0) duplicate = true;
  }
  const documentId = row.id;
  db.transaction(() => {
    if (input.tripId != null) {
      db.prepare("INSERT OR IGNORE INTO trip_documents (trip_id, document_id, created_at) VALUES (?, ?, ?)").run(
        input.tripId, documentId, now()
      );
    }
    if (input.tripId != null && input.eventId != null) T.linkDocument(db, input.tripId, input.eventId, documentId);
  })();
  return { document: getDocumentRow(db, documentId), duplicate };
}

/** Datei und Verknüpfungen entfernen; Ereignisse bleiben (ihr `source_document_id` wird geleert). */
export function deleteDocument(db: Db, documentsDir: string, id: number): void {
  const row = getDocumentRow(db, id);
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  removeDocumentFiles(documentsDir, row.sha256, extOf(row));
}

export function documentLinks(db: Db, id: number): { tripIds: number[]; eventIds: number[] } {
  const events = db
    .prepare(
      `SELECT d.trip_event_id, e.trip_id FROM trip_event_documents d JOIN trip_events e ON e.id = d.trip_event_id
        WHERE d.document_id = ? ORDER BY d.trip_event_id`
    )
    .all(id) as { trip_event_id: number; trip_id: number }[];
  const trips = db.prepare("SELECT trip_id FROM trip_documents WHERE document_id = ? ORDER BY trip_id").all(id) as { trip_id: number }[];
  const tripIds = [...new Set([...trips.map((t) => t.trip_id), ...events.map((e) => e.trip_id)])].sort((a, b) => a - b);
  return { tripIds, eventIds: events.map((e) => e.trip_event_id) };
}

/** Dokument-Objekt der API. */
export function serializeDocument(db: Db, d: DocumentRow, opts: { popplerOk: boolean }) {
  const { tripIds, eventIds } = documentLinks(db, d.id);
  let proposedTrip: unknown = null;
  if (d.analysis_json) {
    try {
      proposedTrip = (JSON.parse(d.analysis_json) as { proposedTrip?: unknown }).proposedTrip ?? null;
    } catch {
      proposedTrip = null;
    }
  }
  return {
    id: d.id,
    title: d.title,
    fileName: d.file_name,
    contentType: d.content_type,
    sizeBytes: d.size_bytes,
    pages: d.pages,
    sha256: d.sha256,
    createdAt: d.created_at,
    analysisStatus: d.analysis_status,
    ...(d.analysis_error ? { analysisError: d.analysis_error } : {}),
    ...(d.summary ? { summary: d.summary } : {}),
    tripIds,
    eventIds,
    // null: keine Vorschau vom Server (HEIC, .pkpass, .ics, PDF ohne poppler) – der Client zeichnet selbst.
    thumbnailUrl: thumbnailPossible(extOf(d), opts.popplerOk) ? `/v1/documents/${d.id}/thumbnail` : null,
    fileUrl: `/v1/documents/${d.id}/file`,
    source: d.source,
    proposedTrip,
  };
}

/** Pfad der Originaldatei auf der Platte. */
export function originalPath(documentsDir: string, d: DocumentRow): string {
  return documentFilePath(documentsDir, d.sha256, extOf(d));
}
