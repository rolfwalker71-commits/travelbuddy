import { Hono, type Context } from "hono";
import fs from "node:fs";
import { z } from "zod";
import type { Db } from "../db/client";
import type { AppEnv } from "../app";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parseWith } from "../lib/validate";
import type { Background } from "../lib/background";
import * as T from "../trips/service";
import { runAnalysis, type DocumentAnalyzer } from "./analyzer";
import { MAX_UPLOAD_BYTES } from "./sniff";
import { deleteDocument, getDocumentRow, ingestFile, originalPath, serializeDocument, type DocumentRow } from "./service";
import { documentThumbnail, popplerAvailable } from "./store";
import { extOf } from "./service";

const id = z.coerce.number().int().positive();

/** Pfade, die Datei-Uploads annehmen (eigene, höhere Grenze statt 1 MB für JSON). */
export const isUploadPath = (method: string, p: string) =>
  method === "POST" && (p === "/v1/documents" || /^\/v1\/trips\/\d+\/documents$/.test(p));

export function documentRoutes(deps: {
  db: Db;
  documentsDir: string;
  analyzer: DocumentAnalyzer;
  background: Background;
  now: () => Date;
}) {
  const { db, documentsDir } = deps;
  const r = new Hono<AppEnv>();

  const admin = (c: Context<AppEnv>) => {
    if (!c.get("user").isAdmin) throw forbidden("Nur für Administratoren");
  };
  const param = (c: Context<AppEnv>, name: string) => {
    const v = id.safeParse(c.req.param(name));
    if (!v.success) throw badRequest(`Ungültiger Parameter ${name}`);
    return v.data;
  };
  const view = async (row: DocumentRow) => serializeDocument(db, row, { popplerOk: await popplerAvailable() });

  const upload = async (c: Context<AppEnv>, opts: { tripId: number | null; defaultSource: "upload" | "share" }) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
      throw new HttpError(413, "payload_too_large", "Die Datei ist grösser als 25 MB");
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("Erwartet multipart/form-data mit dem Feld «file»", "invalid_multipart");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw badRequest("Feld «file» fehlt", "file_required");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "payload_too_large", "Die Datei ist grösser als 25 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const rawEvent = form.get("eventId");
    let eventId: number | null = null;
    if (typeof rawEvent === "string" && rawEvent.trim()) {
      const v = id.safeParse(rawEvent.trim());
      if (!v.success) throw badRequest("eventId ungültig");
      eventId = v.data;
    }
    const rawSource = form.get("source");
    const source = rawSource === "share" || rawSource === "upload" ? rawSource : opts.defaultSource;

    const result = await ingestFile(db, documentsDir, {
      bytes,
      fileName: (file as File).name,
      source,
      userId: c.get("user").id,
      tripId: opts.tripId,
      eventId,
    });
    // Neue Dokumente (und noch nicht verarbeitete Dubletten) werden im Hintergrund analysiert.
    if (!result.duplicate || result.document.analysis_status === "pending") {
      deps.background.run(runAnalysis(db, deps.analyzer, result.document.id, deps.now));
    }
    return c.json({ document: await view(result.document), duplicate: result.duplicate }, 202);
  };

  /** Datei an Reise (und Ereignis) hängen. */
  r.post("/v1/trips/:id/documents", async (c) => {
    admin(c);
    const tripId = param(c, "id");
    T.getTrip(db, tripId);
    return upload(c, { tripId, defaultSource: "upload" });
  });

  /** «Einwurf» ohne Reise (Teilen-Menü): bleibt in der Inbox, bis die Analyse oder ein Mensch es zuordnet. */
  r.post("/v1/documents", async (c) => {
    admin(c);
    return upload(c, { tripId: null, defaultSource: "share" });
  });

  r.get("/v1/trips/:id/documents", async (c) => {
    admin(c);
    const tripId = param(c, "id");
    T.getTrip(db, tripId);
    const rows = db
      .prepare(
        `SELECT DISTINCT d.* FROM documents d
          WHERE d.id IN (SELECT document_id FROM trip_documents WHERE trip_id = ?)
             OR d.id IN (SELECT td.document_id FROM trip_event_documents td JOIN trip_events e ON e.id = td.trip_event_id WHERE e.trip_id = ?)
          ORDER BY d.created_at DESC, d.id DESC`
      )
      .all(tripId, tripId) as DocumentRow[];
    return c.json({ documents: await Promise.all(rows.map(view)) });
  });

  /** Alles, was Aufmerksamkeit braucht: Dokumente in Arbeit/fehlgeschlagen/ohne Zuordnung und Vorschläge zu prüfen. */
  r.get("/v1/inbox", async (c) => {
    admin(c);
    const docs = db
      .prepare(
        `SELECT * FROM documents d
          WHERE d.analysis_status IN ('pending', 'processing', 'failed')
             OR (NOT EXISTS (SELECT 1 FROM trip_documents t WHERE t.document_id = d.id)
                 AND NOT EXISTS (SELECT 1 FROM trip_event_documents e WHERE e.document_id = d.id))
          ORDER BY d.created_at DESC, d.id DESC LIMIT 200`
      )
      .all() as DocumentRow[];
    const review = db
      .prepare(
        `SELECT e.*, t.title AS trip_title FROM trip_events e JOIN trips t ON t.id = e.trip_id
          WHERE e.status != 'confirmed' ORDER BY t.start_date, e.start_date, e.id LIMIT 500`
      )
      .all() as Array<T.EventRow & { trip_title: string }>;
    const byTrip = new Map<number, ReturnType<typeof T.eventViews>>();
    const out: Array<{ tripId: number; tripTitle: string; event: ReturnType<typeof T.eventViews>[number] }> = [];
    for (const e of review) {
      let views = byTrip.get(e.trip_id);
      if (!views) {
        views = T.eventViews(db, T.getTrip(db, e.trip_id), { withTitles: true });
        byTrip.set(e.trip_id, views);
      }
      const ev = views.find((v) => v.id === e.id);
      if (ev) out.push({ tripId: e.trip_id, tripTitle: e.trip_title, event: ev });
    }
    return c.json({ documents: await Promise.all(docs.map(view)), review: out });
  });

  r.get("/v1/documents/:id", async (c) => {
    admin(c);
    return c.json({ document: await view(getDocumentRow(db, param(c, "id"))) });
  });

  /** Original: inline, mit Range-Anfragen (PDF-Anzeige, Streaming grosser Dateien). */
  r.get("/v1/documents/:id/file", (c) => {
    admin(c);
    const row = getDocumentRow(db, param(c, "id"));
    const file = originalPath(documentsDir, row);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      throw notFound("Dokumentdatei");
    }
    const ascii = row.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const headers: Record<string, string> = {
      "content-type": row.content_type,
      "content-disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      etag: `"${row.sha256.slice(0, 32)}"`,
      "x-content-type-options": "nosniff",
    };
    if (c.req.header("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
    const range = c.req.header("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start = 0;
      let end = size - 1;
      let ok = Boolean(m) && (m![1] !== "" || m![2] !== "");
      if (ok && m) {
        if (m[1] === "") {
          // «bytes=-N»: die letzten N Bytes
          start = Math.max(0, size - Number(m[2]));
        } else {
          start = Number(m[1]);
          if (m[2] !== "") end = Math.min(size - 1, Number(m[2]));
        }
        ok = start <= end && start < size;
      }
      if (!ok) {
        return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
      }
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(end - start + 1);
        fs.readSync(fd, buf, 0, buf.length, start);
        return new Response(new Uint8Array(buf), {
          status: 206,
          headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(buf.length) },
        });
      } finally {
        fs.closeSync(fd);
      }
    }
    const data = new Uint8Array(fs.readFileSync(file));
    return new Response(c.req.method === "HEAD" ? null : data, { status: 200, headers: { ...headers, "content-length": String(size) } });
  });

  /** Vorschau der ersten Seite (Bild selbst bzw. PDF per poppler); sonst 404 und der Client rendert selbst. */
  r.get("/v1/documents/:id/thumbnail", async (c) => {
    admin(c);
    const row = getDocumentRow(db, param(c, "id"));
    const t = await documentThumbnail(documentsDir, row.sha256, extOf(row), row.content_type);
    if (!t) throw new HttpError(404, "thumbnail_unavailable", "Keine Vorschau vom Server verfügbar");
    return new Response(new Uint8Array(fs.readFileSync(t.file)), {
      status: 200,
      headers: {
        "content-type": t.contentType,
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  });

  /** Analyse neu starten. */
  r.post("/v1/documents/:id/analyze", async (c) => {
    admin(c);
    const docId = param(c, "id");
    getDocumentRow(db, docId);
    db.prepare(
      `UPDATE documents SET analysis_status = 'pending', analysis_attempts = 0, analysis_next_retry_at = NULL,
              analysis_error = NULL, updated_at = ? WHERE id = ?`
    ).run(deps.now().toISOString(), docId);
    deps.background.run(runAnalysis(db, deps.analyzer, docId, deps.now));
    return c.json({ document: await view(getDocumentRow(db, docId)) }, 202);
  });

  /**
   * Reise aus dem Vorschlag eines Dokuments anlegen (`documents.proposedTrip`) und die erkannten Ereignisse
   * übernehmen. Optionaler Body überschreibt Titel/Ziel/Zeitraum/Zone oder ordnet mit `tripId` einer vorhandenen
   * Reise zu (z. B. bei mehreren Kandidaten).
   */
  r.post("/v1/documents/:id/adopt-trip", async (c) => {
    admin(c);
    const docId = param(c, "id");
    getDocumentRow(db, docId);
    if (!deps.analyzer.adopt) {
      throw conflict("Die Dokumentanalyse ist nicht aktiv; es gibt keinen Reisevorschlag", "analysis_unavailable");
    }
    let raw: unknown = {};
    const textBody = (await c.req.text()).trim();
    if (textBody) {
      try {
        raw = JSON.parse(textBody);
      } catch {
        throw badRequest("Ungültiger JSON-Body", "invalid_json");
      }
    }
    const body = parseWith(
      raw,
      z.object({
        tripId: id.optional(),
        title: z.string().trim().min(1).max(200).optional(),
        destination: z.string().max(200).nullable().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "erwartet YYYY-MM-DD").nullable().optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "erwartet YYYY-MM-DD").nullable().optional(),
        timezone: z.string().max(64).optional(),
        homeCurrency: z.string().trim().length(3).optional(),
      })
    );
    const res = await deps.analyzer.adopt(docId, c.get("user"), body);
    const detail = T.tripDetail(db, res.tripId, { includeShareTokens: true, now: deps.now() });
    return c.json({ ...detail, tripId: res.tripId, created: res.created, merged: res.merged, document: await view(getDocumentRow(db, docId)) }, 201);
  });

  r.delete("/v1/documents/:id", (c) => {
    admin(c);
    deleteDocument(db, documentsDir, param(c, "id"));
    return c.json({ ok: true });
  });

  return r;
}
