/**
 * Medien-Speicher: Tabelle `media` plus Dateien unter `<mediaDir>/<kind>/<file_name>`.
 *
 * Sicherheit: Der Pfad wird nie aus Nutzereingaben gebaut. `kind` stammt aus einer festen Liste, `file_name`
 * aus der Datenbank und wird beim Schreiben wie beim Lesen gegen ein enges Muster geprüft; zusätzlich muss der
 * aufgelöste Pfad im Ordner der Art liegen.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";

export const MEDIA_KINDS = ["trip_cover", "event_image"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const isMediaKind = (v: string): v is MediaKind => (MEDIA_KINDS as readonly string[]).includes(v);

export const MEDIA_SOURCES = ["imported", "generated", "uploaded"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

/** Arten, die der Server selbst erzeugt. */
export const AUTO_KINDS: readonly MediaKind[] = ["trip_cover", "event_image"];
export const GENERATABLE_KINDS: readonly MediaKind[] = AUTO_KINDS;

/** Arten, die Reiseteilnehmer ohne Adminrechte für ihre Reisen sehen dürfen. */
export const TRAVELER_KINDS: readonly MediaKind[] = ["trip_cover", "event_image"];

export type MediaRow = {
  id: number;
  kind: MediaKind;
  owner_id: number;
  file_name: string | null;
  content_type: string | null;
  bytes: number | null;
  sha256: string | null;
  prompt: string | null;
  source: MediaSource;
  error: string | null;
  attempts: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Medienordner: `TRAVELBUDDY_MEDIA_DIR`, sonst `media/` neben der Datenbank. */
export function defaultMediaDir(dbPath: string, env: Record<string, string | undefined> = process.env): string {
  return env.TRAVELBUDDY_MEDIA_DIR || path.join(path.dirname(path.resolve(dbPath)), "media");
}

/** Erlaubte Bildformate, erkannt an den ersten Bytes (nie am Dateinamen oder an Kopfzeilen des Absenders). */
export function sniffImage(bytes: Uint8Array): { contentType: string; ext: string } | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { contentType: "image/png", ext: "png" };
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { contentType: "image/gif", ext: "gif" };
  return null;
}

/** Absoluter Pfad einer Mediendatei oder null, wenn der Name nicht dem Muster entspricht. */
export function mediaFilePath(mediaDir: string, kind: MediaKind, fileName: string): string | null {
  if (!isMediaKind(kind) || !FILE_NAME_RE.test(fileName) || fileName.includes("..")) return null;
  const dir = path.resolve(mediaDir, kind);
  const full = path.resolve(dir, fileName);
  return full.startsWith(dir + path.sep) ? full : null;
}

const iso = (d: Date) => d.toISOString();
export const unixOf = (updatedAt: string): number => {
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

/** `/v1/media/<kind>/<ownerId>?v=<unix(updated_at)>`; `v` ändert sich mit dem Bild und umgeht den Cache. */
export function mediaUrl(kind: MediaKind, ownerId: number, updatedAt: string): string {
  return `/v1/media/${kind}/${ownerId}?v=${unixOf(updatedAt)}`;
}

/** URLs vorhandener Bilder (nur Zeilen mit Datei) je Besitzer. */
export function mediaUrls(db: Db, kind: MediaKind, ownerIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const ids = [...new Set(ownerIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT owner_id, updated_at FROM media
          WHERE kind = ? AND file_name IS NOT NULL AND owner_id IN (${chunk.map(() => "?").join(",")})`
      )
      .all(kind, ...chunk) as Array<{ owner_id: number; updated_at: string }>;
    for (const r of rows) out.set(r.owner_id, mediaUrl(kind, r.owner_id, r.updated_at));
  }
  return out;
}

/** Bild-URLs aller Ereignisse einer Reise (Illustration). */
export function tripEventMediaUrls(db: Db, tripId: number): { images: Map<number, string> } {
  const rows = db
    .prepare(
      `SELECT m.owner_id, m.updated_at FROM media m
        WHERE m.kind = 'event_image' AND m.file_name IS NOT NULL
          AND m.owner_id IN (SELECT id FROM trip_events WHERE trip_id = ?)`
    )
    .all(tripId) as Array<{ owner_id: number; updated_at: string }>;
  const images = new Map<number, string>();
  for (const r of rows) images.set(r.owner_id, mediaUrl("event_image", r.owner_id, r.updated_at));
  return { images };
}

export function getMedia(db: Db, kind: MediaKind, ownerId: number): MediaRow | undefined {
  return db.prepare("SELECT * FROM media WHERE kind = ? AND owner_id = ?").get(kind, ownerId) as MediaRow | undefined;
}

/** Gibt es den Besitzer (Reise, Ereignis) noch? */
export function ownerExists(db: Db, kind: MediaKind, ownerId: number): boolean {
  const table = { trip_cover: "trips", event_image: "trip_events" }[kind];
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(ownerId));
}

/** Reise, zu der ein Reise-Bild gehört (für die Zugriffsprüfung), sonst null. */
export function tripIdOfOwner(db: Db, kind: MediaKind, ownerId: number): number | null {
  if (kind === "trip_cover") {
    return (db.prepare("SELECT id FROM trips WHERE id = ?").get(ownerId) as { id: number } | undefined)?.id ?? null;
  }
  if (kind === "event_image") {
    return (
      (db.prepare("SELECT trip_id FROM trip_events WHERE id = ?").get(ownerId) as { trip_id: number } | undefined)?.trip_id ?? null
    );
  }
  return null;
}

export type SaveInput = {
  kind: MediaKind;
  ownerId: number;
  bytes: Uint8Array;
  source: MediaSource;
  prompt?: string | null;
  now?: Date;
};

/**
 * Bild speichern: Datei atomar schreiben (Name enthält den Inhalts-Hash, daher idempotent), dann Zeile
 * anlegen oder ersetzen. Die alte Datei landet in `media_trash` und wird von `purgeTrash` entfernt.
 */
export function saveMedia(db: Db, mediaDir: string, input: SaveInput): MediaRow {
  const type = sniffImage(input.bytes);
  if (!type) throw new Error("Kein unterstütztes Bildformat (JPEG, PNG, WebP oder GIF erwartet)");
  if (input.bytes.length === 0 || input.bytes.length > MAX_MEDIA_BYTES) throw new Error("Bild leer oder zu gross");
  const sha = createHash("sha256").update(input.bytes).digest("hex");
  const fileName = `${input.ownerId}-${sha.slice(0, 16)}.${type.ext}`;
  const dest = mediaFilePath(mediaDir, input.kind, fileName);
  if (!dest) throw new Error("Ungültiger Dateiname");
  writeFileIfDifferent(dest, input.bytes);

  const ts = iso(input.now ?? new Date());
  db.prepare(
    `INSERT INTO media (kind, owner_id, file_name, content_type, bytes, sha256, prompt, source, error, attempts,
                        next_retry_at, created_at, updated_at)
     VALUES (@kind, @owner, @file, @type, @bytes, @sha, @prompt, @source, NULL, 0, NULL, @ts, @ts)
     ON CONFLICT (kind, owner_id) DO UPDATE SET
       file_name = excluded.file_name, content_type = excluded.content_type, bytes = excluded.bytes,
       sha256 = excluded.sha256, prompt = excluded.prompt, source = excluded.source, error = NULL,
       attempts = 0, next_retry_at = NULL, updated_at = excluded.updated_at`
  ).run({
    kind: input.kind,
    owner: input.ownerId,
    file: fileName,
    type: type.contentType,
    bytes: input.bytes.length,
    sha: sha,
    prompt: input.prompt ?? null,
    source: input.source,
    ts,
  });
  return getMedia(db, input.kind, input.ownerId)!;
}

function writeFileIfDifferent(dest: string, bytes: Uint8Array): void {
  try {
    if (fs.statSync(dest).size === bytes.length) return; // gleicher Name = gleicher Hash
  } catch {
    /* noch nicht vorhanden */
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, dest);
}

/** Fehlgeschlagene Erzeugung festhalten; ein vorhandenes Bild bleibt unberührt. */
export function recordFailure(
  db: Db,
  kind: MediaKind,
  ownerId: number,
  message: string,
  opts: { now: Date; maxAttempts: number }
): MediaRow {
  const ts = iso(opts.now);
  const cur = getMedia(db, kind, ownerId);
  const error = message.slice(0, 500);
  if (cur?.file_name) {
    db.prepare("UPDATE media SET error = ? WHERE id = ?").run(error, cur.id);
    return getMedia(db, kind, ownerId)!;
  }
  const attempts = (cur?.attempts ?? 0) + 1;
  // Exponentielles Zurückstellen: 5 min, 10 min, 20 min … maximal 6 h; danach endgültig (nur noch von Hand).
  const delayMs = Math.min(5 * 60_000 * 2 ** (attempts - 1), 6 * 3_600_000);
  const next = attempts >= opts.maxAttempts ? null : iso(new Date(opts.now.getTime() + delayMs));
  db.prepare(
    `INSERT INTO media (kind, owner_id, source, error, attempts, next_retry_at, created_at, updated_at)
     VALUES (?, ?, 'generated', ?, ?, ?, ?, ?)
     ON CONFLICT (kind, owner_id) DO UPDATE SET error = excluded.error, attempts = excluded.attempts,
       next_retry_at = excluded.next_retry_at, updated_at = excluded.updated_at`
  ).run(kind, ownerId, error, attempts, next, ts, ts);
  return getMedia(db, kind, ownerId)!;
}

/** Entfernt Dateien gelöschter oder ersetzter Bilder. Gibt die Zahl entfernter Dateien zurück. */
export function purgeTrash(db: Db, mediaDir: string): number {
  const rows = db.prepare("SELECT id, kind, file_name FROM media_trash ORDER BY id LIMIT 500").all() as Array<{
    id: number;
    kind: string;
    file_name: string;
  }>;
  const inUse = db.prepare("SELECT 1 FROM media WHERE kind = ? AND file_name = ?");
  const drop = db.prepare("DELETE FROM media_trash WHERE id = ?");
  let removed = 0;
  for (const r of rows) {
    if (isMediaKind(r.kind) && !inUse.get(r.kind, r.file_name)) {
      const full = mediaFilePath(mediaDir, r.kind, r.file_name);
      if (full) {
        try {
          fs.rmSync(full, { force: true });
          removed += 1;
        } catch {
          continue; // beim nächsten Lauf erneut versuchen
        }
      }
    }
    drop.run(r.id);
  }
  return removed;
}
