/**
 * KI-Bilder erzeugen: Schnittstelle `ImageGenerator`, OpenAI-kompatible Implementierung, Prompts (aus der
 * alten App sinngemäss portiert) und der `MediaService`, der nur erzeugt, was fehlt, begrenzt und mit Backoff.
 *
 * Nie überschreiben: Ein vorhandenes Bild wird nur auf ausdrücklichen Wunsch (`force`, Admin-Route) ersetzt.
 * Fehler dürfen Anfragen nie scheitern lassen: Der Hintergrundweg schluckt und protokolliert sie.
 */
import type { Db } from "../db/client";
import type { Background } from "../lib/background";
import { HttpError, conflict, notFound } from "../lib/errors";
import {
  AUTO_KINDS,
  GENERATABLE_KINDS,
  getMedia,
  MAX_MEDIA_BYTES,
  ownerExists,
  purgeTrash,
  recordFailure,
  saveMedia,
  sniffImage,
  type MediaKind,
  type MediaRow,
} from "./store";

/* ───────────── Schnittstelle ───────────── */

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export type ImageRequest = {
  prompt: string;
  size: ImageSize;
  /** Hinweis für Anbieter, die es kennen (gpt-image-*): Kosten und Qualität. */
  quality?: "low" | "medium" | "high";
  /** Gewünschtes Ausgabeformat; der Server erkennt das tatsächliche Format an den Bytes. */
  format?: "jpeg" | "png" | "webp";
};

export interface ImageGenerator {
  readonly model: string;
  generate(input: ImageRequest): Promise<{ bytes: Buffer; contentType: string }>;
}

export type OpenAiImagesConfig = {
  apiKey: string;
  /** Standard: https://api.openai.com/v1 */
  baseUrl?: string;
  /** Standard: gpt-image-1 */
  model?: string;
  timeoutMs?: number;
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

/** Echte Implementierung gegen `POST {baseUrl}/images/generations` (Antwort `b64_json`). */
export function openAiImages(cfg: OpenAiImagesConfig, doFetch: FetchFn = (url, init) => fetch(url, init)): ImageGenerator {
  const baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = cfg.model || DEFAULT_IMAGE_MODEL;
  const timeoutMs = cfg.timeoutMs ?? 180_000;
  const isDalle = /^dall-e/i.test(model);
  return {
    model,
    async generate(input) {
      const body: Record<string, unknown> = { model, prompt: input.prompt, size: input.size, n: 1 };
      if (isDalle) {
        // dall-e liefert sonst URLs; gpt-image-* kennt `response_format` nicht und liefert immer Base64.
        body.response_format = "b64_json";
        if (input.size === "1536x1024") body.size = "1792x1024";
        if (input.size === "1024x1536") body.size = "1024x1792";
      } else {
        if (input.quality) body.quality = input.quality;
        if (input.format) {
          body.output_format = input.format;
          if (input.format !== "png") body.output_compression = 80;
        }
      }
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new HttpError(502, "image_unavailable", "Bilddienst nicht erreichbar");
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new HttpError(502, "image_error", `Bilderzeugung fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json().catch(() => null)) as {
        data?: Array<{ b64_json?: string | null; url?: string | null }>;
      } | null;
      const first = data?.data?.[0];
      let bytes: Buffer | null = null;
      if (first?.b64_json) {
        bytes = Buffer.from(first.b64_json, "base64");
      } else if (first?.url) {
        try {
          const img = await doFetch(first.url, { signal: AbortSignal.timeout(timeoutMs) });
          if (img.ok) bytes = Buffer.from(await img.arrayBuffer());
        } catch {
          bytes = null;
        }
      }
      if (!bytes || bytes.length === 0) throw new HttpError(502, "image_error", "Bilderzeugung lieferte kein Bild");
      if (bytes.length > MAX_MEDIA_BYTES) throw new HttpError(502, "image_error", "Erzeugtes Bild ist zu gross");
      const type = sniffImage(bytes);
      if (!type) throw new HttpError(502, "image_error", "Bilderzeugung lieferte kein gültiges Bild");
      return { bytes, contentType: type.contentType };
    },
  };
}

/** Aktiv, sobald ein Schlüssel da ist; `TRAVELBUDDY_AI_IMAGES=0` schaltet ab. */
export function imageGeneratorFromEnv(env: Record<string, string | undefined>): ImageGenerator | null {
  const off = ["0", "false", "nein", "off", "aus"].includes((env.TRAVELBUDDY_AI_IMAGES ?? "").trim().toLowerCase());
  const key = env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY;
  if (off || !key) return null;
  return openAiImages({
    apiKey: key,
    baseUrl: env.OPENAI_IMAGE_BASE_URL || env.OPENAI_BASE_URL || undefined,
    model: env.OPENAI_IMAGE_MODEL || undefined,
  });
}

/* ───────────── Prompts ───────────── */

function clip(raw: string | null | undefined, max: number): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildTripCoverPrompt(input: { title: string; destination?: string | null }): string {
  return `Travel destination cover photo, cinematic, no text overlay: ${input.title}${
    input.destination ? `, ${input.destination}` : ""
  }. Photorealistic landscape or city atmosphere suitable as a trip header image.`;
}

export type EventPromptInput = {
  type: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  address: string | null;
  provider: string | null;
  bookingReference: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  details: Record<string, unknown>;
};

function sceneForType(type: string, cabinClass: string | null, allDay: boolean): string {
  switch (type) {
    case "Flug":
      return cabinClass
        ? `${cabinClass} cabin atmosphere on board or at the gate, travel day mood`
        : "airport terminal or aircraft cabin atmosphere, travel day mood";
    case "Hotel":
    case "Unterkunft":
      return "welcoming hotel exterior or lobby atmosphere";
    case "Kreuzfahrt":
      return "cruise ship deck or scenic port-of-call atmosphere";
    case "Mietauto":
      return "scenic road trip / rental car travel atmosphere";
    case "Transfer":
      return "transfer journey atmosphere (shuttle, taxi, or city transit)";
    case "Zugreisen":
      return "train journey atmosphere at a railway station or scenic rail travel";
    case "Ausflug":
      return allDay
        ? "memorable all-day sightseeing outing atmosphere, no clocks or timetable boards"
        : "memorable sightseeing or outdoor activity atmosphere";
    case "Restaurant":
      return "inviting restaurant table setting, evening atmosphere";
    case "Veranstaltung":
      return "concert hall, museum or show venue atmosphere";
    case "Versicherung":
    case "Visum":
    case "Aufgabe":
      return "calm travel preparation atmosphere with a passport and a map, no text";
    default:
      return allDay
        ? "authentic travel day atmosphere without clocks or departure boards"
        : "authentic travel moment atmosphere";
  }
}

function eventDetails(e: EventPromptInput): string {
  const d = e.details;
  const str = (k: string) => {
    const v = d[k];
    return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  };
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) parts.push(`${label}: ${v}`);
  };
  const hasClock = Boolean(e.startTime?.trim() || e.endTime?.trim());
  const datePart =
    e.startDate && e.endDate && e.endDate !== e.startDate ? `${e.startDate} – ${e.endDate}` : e.startDate || e.endDate || "";
  push("when", datePart);
  if (hasClock) {
    push("times", [e.startTime, e.endTime].filter(Boolean).join("–"));
  } else if (e.type === "Ausflug" || datePart) {
    // Ausdrücklich, damit das Bildmodell keine Abfahrts-/Ankunftszeiten erfindet.
    push("schedule", "Tagesausflug ohne Uhrzeit — no clock times, no Abfahrt, no Ankunft, no departure/arrival times on the image");
  }
  push("location", e.location);
  push("address", e.address);
  const route = [str("originPlace"), str("destinationPlace")].filter(Boolean).join(" → ");
  push("route", route);
  const dep = str("departureAirport");
  const arr = str("arrivalAirport");
  if (dep || arr) push("airports", dep && arr ? `${dep} → ${arr}` : dep || arr);
  push("provider", e.provider);
  push("booking", e.bookingReference);
  push("airline", str("airline"));
  push("flight", str("flightNumber") || str("trainNumber"));
  push("cabin", str("cabinClass"));
  push("aircraft", [str("aircraftType"), str("aircraftReg")].filter(Boolean).join(" · "));
  if (str("durationMinutes")) push("duration", `${str("durationMinutes")} min`);
  push(
    "departure",
    [
      str("departureTerminal") && `Terminal ${str("departureTerminal")}`,
      str("departureGate") && `Gate ${str("departureGate")}`,
      str("checkInDesk") && `Check-in ${str("checkInDesk")}`,
    ]
      .filter(Boolean)
      .join(" · ")
  );
  push(
    "arrival",
    [
      str("arrivalTerminal") && `Terminal ${str("arrivalTerminal")}`,
      str("arrivalGate") && `Gate ${str("arrivalGate")}`,
      str("baggageBelt") && `Baggage ${str("baggageBelt")}`,
    ]
      .filter(Boolean)
      .join(" · ")
  );
  push("phone", e.phone);
  push("website", e.website);
  return parts.join("; ");
}

/**
 * Vorlage der alten App (familybrain, `lib/trips/event-image-prompt.ts`), Platzhalter in `{{…}}`.
 * Abweichung auf Wunsch: Logos und Marken dürfen vorkommen (dort stand «No logos»).
 */
export const DEFAULT_EVENT_IMAGE_PROMPT = `Square travel illustration (not photorealistic) for a «{{type}}» activity.
Title: {{title}}.
Activity details: {{details}}.
Traveler notes: {{notes}}.
Receipt context: {{beleg}}.
Scene idea: {{scene}}.
Style: clean modern editorial illustration, soft flat colors with gentle shading, friendly travel poster vibe. Any text in the image must be spelled correctly and clearly readable. Logos and brand marks of airlines, hotels, ships and other providers may appear. No watermarks, prices, or UI chrome. Suitable as a small card thumbnail.
Timing rule: Only depict clock times, schedules, Abfahrt, Ankunft, departure or arrival times if Activity details explicitly list them. If details say Tagesausflug / all-day / no clock times, show NO times at all on the image.`;

function applyTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{{${key}}}`).join(value || "—");
  return out.replace(/\s+/g, " ").trim();
}

export function buildEventImagePrompt(e: EventPromptInput & { documentNotes?: string | null }, template: string = DEFAULT_EVENT_IMAGE_PROMPT): string {
  const allDay = !(e.startTime?.trim() || e.endTime?.trim());
  const cabin = typeof e.details.cabinClass === "string" ? e.details.cabinClass : null;
  const beleg = clip((e.documentNotes || "").replace(/[#|*_`>-]/g, " "), 160);
  return applyTemplate(template.trim() || DEFAULT_EVENT_IMAGE_PROMPT, {
    type: e.type,
    title: e.title,
    details: eventDetails(e),
    notes: clip(e.notes, 180),
    beleg,
    scene: sceneForType(e.type, cabin, allDay),
  });
}

/** Zusatzhinweise des Benutzers an einen erzeugten Prompt hängen. */
export function withExtraInstructions(prompt: string, extra: string | null | undefined): string {
  const t = (extra ?? "").replace(/\s+/g, " ").trim();
  return t ? `${prompt} Additional instructions from the user (take precedence): ${t}` : prompt;
}

/* ───────────── Erzeugung ───────────── */

export const MAX_IMAGE_ATTEMPTS = 5;
export const DEFAULT_PER_RUN = 5;

type Spec = { prompt: string; request: Omit<ImageRequest, "prompt"> };

const SQUARE: Omit<ImageRequest, "prompt"> = { size: "1024x1024", quality: "low" };
const COVER: Omit<ImageRequest, "prompt"> = { size: "1536x1024", quality: "medium" };

/** Prompt und Bildgrösse je Art aus den Daten des Besitzers; null, wenn der Besitzer nicht existiert. */
export function buildSpec(db: Db, kind: MediaKind, ownerId: number): Spec | null {
  switch (kind) {
    case "trip_cover": {
      const t = db.prepare("SELECT title, destination FROM trips WHERE id = ?").get(ownerId) as
        | { title: string; destination: string | null }
        | undefined;
      return t ? { prompt: buildTripCoverPrompt(t), request: COVER } : null;
    }
    case "event_image": {
      const e = db.prepare("SELECT * FROM trip_events WHERE id = ?").get(ownerId) as Record<string, any> | undefined;
      if (!e) return null;
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(e.details ?? "{}") as Record<string, unknown>;
      } catch {
        details = {};
      }
      const doc = db
        .prepare(
          `SELECT d.summary FROM documents d JOIN trip_event_documents x ON x.document_id = d.id
            WHERE x.trip_event_id = ? AND d.summary IS NOT NULL AND d.summary <> '' ORDER BY d.id LIMIT 1`
        )
        .get(ownerId) as { summary: string } | undefined;
      return {
        prompt: buildEventImagePrompt({
          documentNotes: doc?.summary ?? null,
          type: e.event_type,
          title: e.title,
          startDate: e.start_date,
          endDate: e.end_date,
          startTime: e.start_time,
          endTime: e.end_time,
          location: e.location,
          address: e.address,
          provider: e.provider,
          bookingReference: e.booking_reference,
          phone: e.phone,
          website: e.website,
          notes: e.notes,
          details,
        }),
        request: SQUARE,
      };
    }
    default:
      return null;
  }
}

export type BatchResult = { generated: number; failed: number; purged: number };

export type MediaServiceDeps = {
  db: Db;
  mediaDir: string;
  images: ImageGenerator | null;
  now?: () => Date;
  background?: Background;
  perRun?: number;
};

/** Laufende Erzeugungen je Datenbank, damit Wartungslauf und Anfrage dasselbe Bild nicht doppelt bestellen. */
const inflightByDb = new WeakMap<Db, Map<string, Promise<MediaRow>>>();

export class MediaService {
  constructor(private readonly deps: MediaServiceDeps) {}

  get enabled(): boolean {
    return this.deps.images != null;
  }
  get model(): string | null {
    return this.deps.images?.model ?? null;
  }
  get perRun(): number {
    return Math.max(1, this.deps.perRun ?? DEFAULT_PER_RUN);
  }
  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
  private inflight(): Map<string, Promise<MediaRow>> {
    let m = inflightByDb.get(this.deps.db);
    if (!m) inflightByDb.set(this.deps.db, (m = new Map()));
    return m;
  }

  /**
   * Bild für einen Besitzer erzeugen. Ohne `force` bleibt ein vorhandenes Bild unberührt.
   * Wirft bei Fehlern (und vermerkt sie in der Tabelle mit Backoff).
   */
  async generate(kind: MediaKind, ownerId: number, opts: { force?: boolean; prompt?: string | null; extra?: string | null } = {}): Promise<MediaRow> {
    const { db, mediaDir, images } = this.deps;
    if (!images) throw conflict("Die KI-Bilderzeugung ist nicht aktiv (kein Schlüssel oder abgeschaltet)", "images_disabled");
    if (!GENERATABLE_KINDS.includes(kind)) {
      throw conflict("Dieses Bild wird nicht erzeugt, nur importiert", "not_generatable");
    }
    const existing = getMedia(db, kind, ownerId);
    if (existing?.file_name && !opts.force) return existing;

    const key = `${kind}:${ownerId}`;
    const running = this.inflight().get(key);
    if (running) return running;

    const job = (async (): Promise<MediaRow> => {
      const spec = buildSpec(db, kind, ownerId);
      if (!spec) throw notFound("Besitzer des Bildes");
      const prompt = withExtraInstructions(opts.prompt?.trim() || spec.prompt, opts.extra);
      try {
        const out = await images.generate({ ...spec.request, prompt });
        if (!ownerExists(db, kind, ownerId)) throw notFound("Besitzer des Bildes"); // inzwischen gelöscht
        const current = getMedia(db, kind, ownerId);
        if (current?.file_name && !opts.force) return current; // jemand war schneller
        const row = saveMedia(db, mediaDir, {
          kind,
          ownerId,
          bytes: out.bytes,
          source: "generated",
          prompt,
          now: this.now(),
        });
        purgeTrash(db, mediaDir);
        return row;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) {
          const msg = e instanceof Error ? e.message : String(e);
          recordFailure(db, kind, ownerId, msg, { now: this.now(), maxAttempts: MAX_IMAGE_ATTEMPTS });
          if (!(e instanceof HttpError)) throw new HttpError(502, "image_error", `Bild konnte nicht gespeichert werden: ${msg}`);
        }
        throw e;
      }
    })();
    const map = this.inflight();
    map.set(key, job);
    const done = () => map.delete(key);
    job.then(done, done);
    return job;
  }

  /** Nach dem Anlegen im Hintergrund erzeugen; Fehler werden nie weitergereicht. */
  schedule(kind: MediaKind, ownerId: number): void {
    if (!this.deps.images || !this.deps.background) return;
    this.deps.background.run(this.generate(kind, ownerId).catch(() => undefined));
  }

  /**
   * Ein Wartungsdurchlauf: zuerst fällige Wiederholungen, dann fehlende Bilder (Reisen, Abrechnungen, Ereignisse,
   * Dokument-Icons). Höchstens `limit` Aufrufe, nacheinander.
   */
  async runBatch(opts: { limit?: number } = {}): Promise<BatchResult> {
    const out: BatchResult = { generated: 0, failed: 0, purged: 0 };
    const { db, mediaDir } = this.deps;
    out.purged += purgeTrash(db, mediaDir);
    if (!this.deps.images) return out;
    let budget = opts.limit ?? this.perRun;
    const todo = this.dueWork(budget);
    for (const [kind, ownerId] of todo) {
      if (budget <= 0) break;
      budget -= 1;
      try {
        await this.generate(kind, ownerId);
        out.generated += 1;
      } catch {
        out.failed += 1;
      }
    }
    return out;
  }

  private dueWork(limit: number): Array<[MediaKind, number]> {
    const { db } = this.deps;
    const nowIso = this.now().toISOString();
    const work: Array<[MediaKind, number]> = [];
    const seen = new Set<string>();
    const add = (kind: MediaKind, id: number) => {
      const k = `${kind}:${id}`;
      if (work.length < limit && !seen.has(k)) {
        seen.add(k);
        work.push([kind, id]);
      }
    };
    const retry = db
      .prepare(
        `SELECT kind, owner_id FROM media
          WHERE file_name IS NULL AND next_retry_at IS NOT NULL AND next_retry_at <= ? AND kind IN (${AUTO_KINDS.map(() => "?").join(",")})
          ORDER BY next_retry_at LIMIT ?`
      )
      .all(nowIso, ...AUTO_KINDS, limit) as Array<{ kind: MediaKind; owner_id: number }>;
    for (const r of retry) add(r.kind, r.owner_id);

    for (const kind of ["trip_cover", "event_image"] as const) {
      if (work.length >= limit) break;
      for (const r of db.prepare(missingIdsSql(kind)).all(limit) as Array<{ id: number }>) add(kind, r.id);
    }
    return work;
  }

  /** Zähler je Art für die Betriebsansicht. */
  counts(): Record<MediaKind, { present: number; missing: number | null; failed: number; retrying: number; auto: boolean }> {
    const { db } = this.deps;
    const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
    const out = {} as Record<MediaKind, { present: number; missing: number | null; failed: number; retrying: number; auto: boolean }>;
    for (const kind of ["trip_cover", "event_image"] as MediaKind[]) {
      const auto = AUTO_KINDS.includes(kind);
      out[kind] = {
        present: one("SELECT COUNT(*) AS n FROM media WHERE kind = ? AND file_name IS NOT NULL", kind),
        missing: auto ? one(missingCountSql(kind as keyof typeof MISSING)) : null,
        failed: one("SELECT COUNT(*) AS n FROM media WHERE kind = ? AND file_name IS NULL AND next_retry_at IS NULL", kind),
        retrying: one("SELECT COUNT(*) AS n FROM media WHERE kind = ? AND file_name IS NULL AND next_retry_at IS NOT NULL", kind),
        auto,
      };
    }
    return out;
  }
}

/** Besitzer ohne Medienzeile (weder Bild noch bisheriger Fehlversuch). */
const MISSING = {
  trip_cover: {
    from: "trips t",
    where: "NOT EXISTS (SELECT 1 FROM media m WHERE m.kind = 'trip_cover' AND m.owner_id = t.id)",
    id: "t.id",
    order: "t.id DESC",
  },
  event_image: {
    from: "trip_events e",
    where: "NOT EXISTS (SELECT 1 FROM media m WHERE m.kind = 'event_image' AND m.owner_id = e.id)",
    id: "e.id",
    order: "e.id DESC",
  },
} as const;

const missingIdsSql = (kind: keyof typeof MISSING) => {
  const m = MISSING[kind];
  return `SELECT ${m.id} AS id FROM ${m.from} WHERE ${m.where} ORDER BY ${m.order} LIMIT ?`;
};
const missingCountSql = (kind: keyof typeof MISSING) => {
  const m = MISSING[kind];
  return `SELECT COUNT(*) AS n FROM ${m.from} WHERE ${m.where}`;
};
