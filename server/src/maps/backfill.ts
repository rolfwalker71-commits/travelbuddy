/**
 * Geokodierungs-Nachtrag im Hintergrund.
 *
 * Holt Koordinaten für Ereignisse nach, die Ort oder Adresse haben, aber kein `lat`/`lon` (typisch nach einem
 * Import): langsam (der Geokodierer begrenzt selbst auf 1 Anfrage/s bei Nominatim), mit Zwischenspeicher
 * (`geocode_cache`) und mit Gedächtnis (`geocode_backfill`): «nicht gefunden» wird nicht wiederholt, solange sich der
 * Suchbegriff nicht ändert, Dienstfehler mit Wartezeit (15 min, 30 min … höchstens 6 h, 5 Versuche).
 * Von Hand gesetzte Koordinaten werden nie überschrieben (das stellt `geocodeEvent` sicher; es werden ohnehin nur
 * Orte ohne Koordinaten bearbeitet). Ergebnis: `fieldsMeta.lat/lon = { source: "geocoded", … }`.
 *
 * Steuerung: `TRAVELBUDDY_GEOCODE_BACKFILL=auto|on|off` (Standard `auto` = an, wenn ein Geokodierer konfiguriert
 * ist). In Tests wird kein Nachtrag angelegt.
 */
import type { Db } from "../db/client";
import type { Geocoder } from "../geo/geocode";
import { geocodeEvent, type GeocodeResult } from "../geo/event-geocode";
import * as T from "../trips/service";

export type BackfillMode = "auto" | "on" | "off";

export function backfillModeFromEnv(env: Record<string, string | undefined>): BackfillMode {
  const v = (env.TRAVELBUDDY_GEOCODE_BACKFILL ?? "auto").trim().toLowerCase();
  if (["off", "0", "false", "aus", "nein"].includes(v)) return "off";
  if (["on", "1", "true", "an", "ja"].includes(v)) return "on";
  return "auto";
}

type Memory = {
  event_id: number;
  role: string;
  status: "resolved" | "not_found" | "failed";
  query: string | null;
  attempts: number;
  next_retry_at: string | null;
};

export type Candidate = { eventId: number; tripId: number; role: string; query: string; due: boolean };

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 15 * 60_000;
const MAX_DELAY_MS = 6 * 3_600_000;

/** Orte ohne Koordinaten mit Suchbegriff, die noch nicht aufgegeben wurden. `due` = jetzt an der Reihe. */
export function collectCandidates(db: Db, now: Date): Candidate[] {
  const memory = new Map<string, Memory>();
  for (const m of db.prepare("SELECT * FROM geocode_backfill").all() as Memory[]) memory.set(`${m.event_id}:${m.role}`, m);
  const trips = db.prepare("SELECT * FROM trips").all() as T.TripRow[];
  const out: Candidate[] = [];
  for (const trip of trips) {
    for (const row of T.eventRows(db, trip.id)) {
      for (const p of T.eventPlacesWithQuery(row, trip)) {
        if (p.lat != null || p.isAirport || !p.query) continue;
        const m = memory.get(`${row.id}:${p.role}`);
        let due = true;
        if (m && m.query === p.query) {
          if (m.status === "not_found") continue; // endgültig, bis sich der Suchbegriff ändert
          if (m.status === "failed") {
            if (m.next_retry_at == null) continue; // aufgegeben
            due = m.next_retry_at <= now.toISOString();
          }
        }
        out.push({ eventId: row.id, tripId: trip.id, role: p.role, query: p.query, due });
      }
    }
  }
  return out;
}

export type BackfillStats = {
  enabled: boolean;
  geocoder: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastRun: { attempted: number; resolved: number; notFound: number; failed: number } | null;
  /** noch offen (Ort ohne Koordinaten, nicht aufgegeben) */
  open: number;
  /** davon jetzt fällig */
  due: number;
  /** Zähler des Gedächtnisses */
  resolved: number;
  notFound: number;
  failed: number;
};

export function backfillCounts(db: Db, now: Date) {
  const c = db.prepare("SELECT status, COUNT(*) AS n FROM geocode_backfill GROUP BY status").all() as Array<{ status: string; n: number }>;
  const n = (s: string) => c.find((x) => x.status === s)?.n ?? 0;
  const cands = collectCandidates(db, now);
  return {
    open: cands.length,
    due: cands.filter((x) => x.due).length,
    resolved: n("resolved"),
    notFound: n("not_found"),
    failed: n("failed"),
  };
}

export class GeocodeBackfill {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRunAt: string | null = null;
  private lastRun: BackfillStats["lastRun"] = null;
  private warnedDown = false;
  private again = false;

  constructor(
    private readonly opts: {
      db: Db;
      geocoder: Geocoder | null;
      mode?: BackfillMode;
      now?: () => Date;
      log?: (msg: string) => void;
      /** Höchstzahl Orte je Lauf (Standard 25). */
      limit?: number;
      /** Wartezeit bis zu einem angestossenen Lauf (Standard 2 s). */
      debounceMs?: number;
    }
  ) {}

  get enabled(): boolean {
    return this.opts.mode !== "off" && this.opts.geocoder != null;
  }
  private now() {
    return this.opts.now ? this.opts.now() : new Date();
  }
  private log(msg: string) {
    (this.opts.log ?? console.log)(`[geocode-backfill] ${msg}`);
  }

  /** Stösst einen Lauf an (entprellt); nach Import oder Dokumentanalyse aufzurufen. */
  trigger(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.opts.debounceMs ?? 2000);
    this.timer.unref?.();
  }

  stats(): BackfillStats {
    const c = backfillCounts(this.opts.db, this.now());
    return {
      enabled: this.enabled,
      geocoder: this.opts.geocoder?.name ?? null,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastRun: this.lastRun,
      ...c,
    };
  }

  /** Ein Lauf: höchstens `limit` fällige Orte, ereignisweise. Wirft nie. */
  async run(): Promise<NonNullable<BackfillStats["lastRun"]>> {
    const summary = { attempted: 0, resolved: 0, notFound: 0, failed: 0 };
    if (!this.enabled || this.running) return summary;
    this.running = true;
    try {
      const { db, geocoder } = this.opts;
      const limit = this.opts.limit ?? 25;
      const byEvent = new Map<number, Candidate[]>();
      for (const c of collectCandidates(db, this.now())) {
        if (!c.due) continue;
        const list = byEvent.get(c.eventId) ?? [];
        list.push(c);
        byEvent.set(c.eventId, list);
      }
      let consecutiveDown = 0;
      outer: for (const [eventId, cands] of byEvent) {
        if (summary.attempted >= limit) break;
        const tripId = cands[0]!.tripId;
        let results: GeocodeResult[];
        try {
          results = await geocodeEvent(db, geocoder, tripId, eventId, { only: cands.map((c) => c.role) });
        } catch {
          continue; // Ereignis inzwischen gelöscht
        }
        for (const r of results) {
          const cand = cands.find((c) => c.role === r.role);
          if (!cand) continue;
          if (r.status === "resolved") {
            summary.attempted += 1;
            summary.resolved += 1;
            consecutiveDown = 0;
            this.remember(cand, "resolved", null);
          } else if (r.status === "not_found") {
            summary.attempted += 1;
            summary.notFound += 1;
            consecutiveDown = 0;
            this.remember(cand, "not_found", null);
          } else if (r.status === "unavailable") {
            summary.attempted += 1;
            summary.failed += 1;
            consecutiveDown += 1;
            this.remember(cand, "failed", null);
            if (consecutiveDown >= 3) {
              if (!this.warnedDown) this.log("Geokodierer nicht erreichbar; der Nachtrag pausiert und versucht es später erneut.");
              this.warnedDown = true;
              break outer;
            }
          }
        }
      }
      if (summary.resolved > 0) this.warnedDown = false;
      if (summary.attempted > 0) {
        this.log(`${summary.resolved} aufgelöst, ${summary.notFound} nicht gefunden, ${summary.failed} Fehler`);
      }
      this.lastRunAt = this.now().toISOString();
      this.lastRun = summary;
      // Grosse Rückstände (Import): gleich weitermachen statt auf den nächsten Wartungslauf zu warten.
      if (summary.attempted >= limit && !this.warnedDown) this.again = true;
      return summary;
    } catch (e) {
      this.log(`Fehler: ${e instanceof Error ? e.message : e}`);
      return summary;
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.trigger();
      }
    }
  }

  private remember(c: Candidate, status: Memory["status"], _x: null) {
    const { db } = this.opts;
    const nowIso = this.now().toISOString();
    const prev = db.prepare("SELECT attempts, query FROM geocode_backfill WHERE event_id = ? AND role = ?").get(c.eventId, c.role) as
      | { attempts: number; query: string | null }
      | undefined;
    const attempts = (prev && prev.query === c.query ? prev.attempts : 0) + 1;
    let next: string | null = null;
    if (status === "failed" && attempts < MAX_ATTEMPTS) {
      next = new Date(this.now().getTime() + Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS)).toISOString();
    }
    db.prepare(
      `INSERT INTO geocode_backfill (event_id, role, status, query, attempts, last_attempt_at, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, role) DO UPDATE SET status = excluded.status, query = excluded.query,
         attempts = excluded.attempts, last_attempt_at = excluded.last_attempt_at, next_retry_at = excluded.next_retry_at`
    ).run(c.eventId, c.role, status, c.query, attempts, nowIso, next);
  }
}
