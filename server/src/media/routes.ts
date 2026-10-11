import { Hono, type Context } from "hono";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppEnv } from "../app";
import type { ModuleDeps } from "../lib/module-deps";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseWith } from "../lib/validate";
import { clearMedia, GENERATABLE_KINDS, getMedia, MAX_MEDIA_BYTES, saveMedia, sniffImage, isMediaKind, mediaFilePath, mediaUrl, ownerExists, TRAVELER_KINDS, tripIdOfOwner, type MediaKind, type MediaRow } from "./store";
import { DEFAULT_PER_RUN, MAX_IMAGE_ATTEMPTS, MediaService } from "./generate";

const ownerSchema = z.coerce.number().int().positive();

function serializeMedia(row: MediaRow) {
  return {
    kind: row.kind,
    ownerId: row.owner_id,
    url: row.file_name ? mediaUrl(row.kind, row.owner_id, row.updated_at) : null,
    contentType: row.content_type,
    bytes: row.bytes,
    source: row.source,
    prompt: row.prompt,
    error: row.error,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    updatedAt: row.updated_at,
  };
}

const etagOf = (row: MediaRow) => `"${(row.sha256 ?? `${row.id}-${row.updated_at}`).slice(0, 40)}"`;

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(etag);
}

/** KI-Bilder: Auslieferung, Betriebsansicht und Neuerzeugung. */
export function mediaRoutes(deps: ModuleDeps) {
  const r = new Hono<AppEnv>();
  const { db } = deps;
  const service = new MediaService({
    db,
    mediaDir: deps.mediaDir,
    images: deps.images ?? null,
    now: deps.now,
    background: deps.background,
    perRun: deps.imagesPerRun,
  });

  const admin = (c: Context<AppEnv>) => {
    if (!c.get("user").isAdmin) throw forbidden("Nur für Administratoren");
  };
  const target = (c: Context<AppEnv>): { kind: MediaKind; ownerId: number } => {
    const rawKind = c.req.param("kind") ?? "";
    if (!isMediaKind(rawKind)) throw notFound("Bild");
    const owner = ownerSchema.safeParse(c.req.param("ownerId"));
    if (!owner.success) throw badRequest("Ungültiger Parameter ownerId");
    return { kind: rawKind, ownerId: owner.data };
  };

  /** Betrieb: aktiv ja/nein, Modell, Zähler je Art. */
  r.get("/v1/media/status", (c) => {
    admin(c);
    const trash = (db.prepare("SELECT COUNT(*) AS n FROM media_trash").get() as { n: number }).n;
    return c.json({
      enabled: service.enabled,
      model: service.model,
      perRun: service.perRun || DEFAULT_PER_RUN,
      reason: service.enabled
        ? null
        : "Kein KI-Schlüssel (OPENAI_API_KEY) hinterlegt oder per TRAVELBUDDY_AI_IMAGES=0 abgeschaltet",
      kinds: service.counts(),
      trashPending: trash,
    });
  });

  /**
   * Mitteilungsillustrationen (`imageKey` der Push-Nutzlast, PNG 600×300, Bearer). Erweiterungspunkt: Die
   * Dateien `<mediaDir>/notification/<imageKey>.png` legt die zweite Welle (Mitteilungs-Scheduler) ab bzw.
   * erzeugt sie aus `shared/illustrations`; solange sie fehlen, antwortet die Route mit 404.
   */
  r.get("/v1/media/notification/:imageKey", async (c) => {
    const key = c.req.param("imageKey") ?? "";
    if (!/^notif-[a-z]{2,20}$/.test(key)) throw notFound("Bild");
    const file = path.join(deps.mediaDir, "notification", `${key}.png`);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(await fs.promises.readFile(file));
    } catch {
      throw new HttpError(404, "image_not_available", "Mitteilungsbild nicht verfügbar");
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  });

  /** Bild ausliefern (GET und HEAD). */
  r.get("/v1/media/:kind/:ownerId", async (c) => {
    const { kind, ownerId } = target(c);
    const user = c.get("user");
    if (!user.isAdmin) {
      // Reiseteilnehmer: nur Reisebilder der eigenen Reisen. Unbekannte und fremde Besitzer sind nicht unterscheidbar.
      if (!TRAVELER_KINDS.includes(kind)) throw forbidden("Kein Zugriff auf dieses Bild");
      const tripId = tripIdOfOwner(db, kind, ownerId);
      const member =
        tripId != null &&
        db.prepare("SELECT 1 FROM participants WHERE trip_id = ? AND user_id = ?").get(tripId, user.id);
      if (!member) throw forbidden("Kein Zugriff auf dieses Bild");
    }
    const row = getMedia(db, kind, ownerId);
    if (!row?.file_name || !row.content_type) throw notFound("Bild");
    const etag = etagOf(row);
    const headers: Record<string, string> = {
      etag,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    };
    if (matchesEtag(c.req.header("if-none-match"), etag)) return new Response(null, { status: 304, headers });
    const full = mediaFilePath(deps.mediaDir, kind, row.file_name);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      if (!full) throw new Error("ungültiger Name");
      bytes = new Uint8Array(await fs.promises.readFile(full));
    } catch {
      throw notFound("Bilddatei");
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers,
        "content-type": row.content_type,
        "content-length": String(bytes.length),
        "content-disposition": "inline",
      },
    });
  });

  /** Bild neu erzeugen (Admin). Ersetzt ein vorhandenes Bild; 409, wenn die Erzeugung nicht aktiv ist. */
  r.post("/v1/media/:kind/:ownerId/regenerate", async (c) => {
    admin(c);
    const { kind, ownerId } = target(c);
    const text = await c.req.text();
    let prompt: string | null = null;
    let extra: string | null = null;
    if (text.trim()) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new HttpError(400, "invalid_json", "Ungültiger JSON-Body");
      }
      const body = parseWith(
        raw,
        z.object({ prompt: z.string().trim().min(1).max(4000).nullish(), extra: z.string().trim().max(1000).nullish() })
      );
      prompt = body.prompt ?? null;
      extra = body.extra || null;
    }
    if (!service.enabled) {
      throw new HttpError(409, "images_disabled", "Die KI-Bilderzeugung ist nicht aktiv (kein Schlüssel oder abgeschaltet)");
    }
    if (!GENERATABLE_KINDS.includes(kind)) {
      throw new HttpError(409, "not_generatable", "Dieses Bild wird nicht erzeugt, nur importiert");
    }
    if (!ownerExists(db, kind, ownerId)) throw notFound("Besitzer des Bildes");
    const row = await service.generate(kind, ownerId, { force: true, prompt, extra });
    return c.json({ media: serializeMedia(row) });
  });

  /** Eigenes Bild hochladen (Admin, multipart `file`): ersetzt ein vorhandenes, wird nie automatisch überschrieben. */
  r.put("/v1/media/:kind/:ownerId", async (c) => {
    admin(c);
    const { kind, ownerId } = target(c);
    if (!ownerExists(db, kind, ownerId)) throw notFound("Besitzer des Bildes");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("Erwartet multipart/form-data mit dem Feld «file»");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Datei fehlt (Feld «file»)");
    if (file.size === 0) throw badRequest("Die Datei ist leer");
    if (file.size > MAX_MEDIA_BYTES) throw new HttpError(413, "too_large", "Das Bild ist grösser als 20 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!sniffImage(bytes)) throw new HttpError(415, "unsupported_image", "Nur JPEG, PNG, WebP oder GIF sind möglich");
    const row = saveMedia(db, deps.mediaDir, { kind, ownerId, bytes, source: "uploaded", prompt: null, now: deps.now() });
    return c.json({ media: serializeMedia(row) });
  });

  /** Bild entfernen; es wird dafür nicht automatisch neu erzeugt (nur auf Wunsch). */
  r.delete("/v1/media/:kind/:ownerId", (c) => {
    admin(c);
    const { kind, ownerId } = target(c);
    if (!ownerExists(db, kind, ownerId)) throw notFound("Besitzer des Bildes");
    const row = clearMedia(db, kind, ownerId, MAX_IMAGE_ATTEMPTS, deps.now());
    return c.json({ media: serializeMedia(row) });
  });

  return r;
}
