/**
 * Live Activities: Start per Push-to-Start, Aktualisierung per Activity-Push-Token an Übergängen, Ende mit
 * `dismissal-date`.
 *
 * Arten (`TravelActivityAttributes.Kind`):
 *  - `flight`: 3 h vor Flug, Zug oder Einschiffung bis zur Ankunft (bei Flügen mit Check-in Hotel bis zu dessen Beginn).
 *    Übergänge: Check-in offen, Boarding, Abflug/unterwegs (mit `progress`), Ankunft, Check-in Hotel.
 *  - `day`: Reisetag, ab dem Morgenbriefing; zeigt das nächste Ereignis und das danach. Während eine `flight`-
 *    Activity läuft, wird keine `day`-Activity gestartet (und eine laufende beendet).
 *  - `checkin`: Hotel-Check-in; wird nicht automatisch gestartet, nur gepflegt, wenn die App sie anmeldet.
 *
 * Ablauf: Der Plan (`planActivities`) beschreibt je Konto, was zu welchem Zeitpunkt gezeigt werden soll; der
 * Läufer (`LiveActivityService.run`) gleicht ihn mit den angemeldeten Activities (`live_activities`) ab. Welcher
 * Start schon gesendet und welcher Zustand zuletzt übermittelt wurde, steht in `kv` (`la:start:…`, `la:state:…`).
 *
 * `content-state` entspricht `ios/Shared/TravelActivityAttributes.swift` (`ContentState`); Zeitpunkte sind
 * Unix-Sekunden (Double).
 */
import type { Db } from "../db/client";
import type { ApnsMessage, ApnsResult, PushTransport } from "../push/apns";
import { apnsTopic, isNotConfigured } from "../push/apns";
import { addDays, diffDays } from "../lib/dates";
import { localDateTime, zonedToUtcMs } from "../lib/tz";
import { currentZone } from "../trips/today";
import { dayItems, loadPlanTrips, routeOf, type PlanEvent, type PlanTrip, type Recipient } from "./plan";
import { clip, joinDot, swiss, timeDe } from "./text";

const HOUR = 3_600_000;
const MIN = 60_000;

export type ActivityKind = "day" | "flight" | "checkin";
export type Stage = "upcoming" | "checkIn" | "boarding" | "underway" | "arrived" | "atStay" | "generic";

export type ContentState = {
  headline: string;
  detail?: string;
  icon: string;
  colorKey: string;
  stage: Stage;
  milestoneLabel?: string;
  milestoneAt?: number;
  progress?: number;
  nextHeadline?: string;
  nextAt?: number;
  updatedAt: number;
};

export type ActivityPlan = {
  /** Stabile Kennung: `flight:<trip>:<event>`, `day:<trip>:<datum>`, `checkin:<trip>:<event>`. */
  key: string;
  kind: ActivityKind;
  userId: number;
  tripId: number;
  tripTitle: string;
  eventId: number | null;
  deepLink: string;
  startAtMs: number;
  endAtMs: number;
  /** Anzeige nach dem Ende (Sekunden, `dismissal-date`). */
  dismissAfterSec: number;
  /** Per Push-to-Start starten (nicht bei `checkin`). */
  autoStart: boolean;
  alert: { title: string; body: string };
  state(nowMs: number): ContentState;
};

const sec = (ms: number) => Math.round(ms / 1000);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const hhmmOf = (v: unknown): string | null => {
  const s = str(v);
  return s && /^([01]?\d|2[0-3]):[0-5]\d/.test(s) ? timeDe(s) : null;
};

/* ───────────── Plan ───────────── */

function seatOf(ev: PlanEvent, participantId: number): string | null {
  const p = ev.details.passengers;
  if (!Array.isArray(p)) return null;
  const mine = p.find((x) => x && typeof x === "object" && (x as { participantId?: number }).participantId === participantId) as
    | { seat?: unknown }
    | undefined;
  return str(mine?.seat);
}

/** Ende eines kurzen Ereignisses (Ankunft): Endzeit, sonst Dauer, sonst eine Annahme je Art. */
function arrivalMs(ev: PlanEvent): number {
  const start = ev.startMs!;
  if (ev.hasEndTime && ev.endMs != null && ev.endMs > start) return ev.endMs;
  const dur = typeof ev.details.durationMinutes === "number" ? ev.details.durationMinutes : null;
  if (dur && dur > 0) return start + dur * MIN;
  return start + 2 * HOUR;
}

/** Beginn des Check-ins einer Unterkunft (Anreisetag, Uhrzeit aus `startTime` oder `checkInFrom`). */
function stayCheckInMs(ev: PlanEvent): number | null {
  const t = hhmmOf(ev.view.startTime) ?? hhmmOf(ev.details.checkInFrom);
  if (!ev.view.startDate || !t) return null;
  return zonedToUtcMs(ev.view.startDate, t, ev.startTz);
}

function stayAfter(pt: PlanTrip, arrival: number): { ev: PlanEvent; ms: number } | null {
  let best: { ev: PlanEvent; ms: number } | null = null;
  for (const e of pt.events) {
    if (e.type !== "Hotel" && e.type !== "Unterkunft") continue;
    const ms = stayCheckInMs(e);
    if (ms == null || ms < arrival - HOUR || ms > arrival + 14 * HOUR) continue;
    if (!best || ms < best.ms) best = { ev: e, ms };
  }
  return best;
}

function travelPlan(pt: PlanTrip, ev: PlanEvent, r: Recipient): ActivityPlan | null {
  if (ev.startMs == null || !ev.hasStartTime || !ev.view.startDate) return null;
  const cruise = ev.type === "Kreuzfahrt";
  if (cruise) {
    const k = str(ev.details.entryKind);
    if (k && k !== "Einschiffung" && k !== "Reise") return null;
  }
  const start = ev.startMs;
  const route = routeOf(ev);
  const flight = ev.type === "Flug";
  const train = ev.type === "Zugreisen";

  // Zeitpunkte der Übergänge
  const checkInT = flight ? hhmmOf(ev.details.checkInOpens) : null;
  let checkInMs: number | null = null;
  if (flight) {
    checkInMs = checkInT ? zonedToUtcMs(ev.view.startDate, checkInT, ev.startTz) : start - 24 * HOUR;
    if (checkInMs >= start) checkInMs = zonedToUtcMs(addDays(ev.view.startDate, -1), checkInT ?? "00:00", ev.startTz);
  }
  const boardT = flight ? hhmmOf(ev.details.boardingTime) : null;
  let boardMs: number | null = null;
  if (flight && boardT) {
    boardMs = zonedToUtcMs(ev.view.startDate, boardT, ev.startTz);
    if (boardMs > start) boardMs -= 24 * HOUR;
  } else if (train) {
    boardMs = start - 10 * MIN;
  } else if (cruise) {
    boardMs = start;
  }
  let endMs: number;
  if (cruise) {
    const aboard = hhmmOf(ev.details.allAboard);
    endMs = aboard ? zonedToUtcMs(ev.view.startDate, aboard, ev.startTz) : start + 2 * HOUR;
    if (endMs <= start) endMs = start + 2 * HOUR;
  } else {
    endMs = arrivalMs(ev);
  }
  const stay = flight || train ? stayAfter(pt, endMs) : null;
  const finalMs = (stay ? Math.max(stay.ms, endMs) : endMs) + 30 * MIN;

  const icon = ev.icon;
  const colorKey = ev.color;
  const label = cruise ? "Einschiffung" : flight ? "Abflug" : "Abfahrt";
  const seat = flight ? seatOf(ev, r.participantId) : null;
  const routeText = route.from && route.to ? `${route.from} → ${route.to}` : null;
  const number = str(ev.details.flightNumber) ?? str(ev.details.trainNumber);
  const gate = str(ev.details.departureGate);
  const terminal = str(ev.details.departureTerminal);
  const platform = str(ev.details.departurePlatform);
  const arrTime = ev.hasEndTime ? timeDe(localDateTime(endMs, ev.endTz).time) : null;

  const state = (now: number): ContentState => {
    const base = { icon, colorKey, updatedAt: sec(now) };
    let stage: Stage;
    if (now >= endMs) stage = stay && now >= stay.ms ? "atStay" : "arrived";
    else if (now >= start) stage = cruise ? "boarding" : "underway";
    else if (boardMs != null && now >= boardMs) stage = "boarding";
    else if (flight && checkInMs != null && now >= checkInMs) stage = "checkIn";
    else stage = "upcoming";
    if (cruise && now >= endMs) stage = "underway";

    const s: ContentState = { ...base, headline: "", stage };
    switch (stage) {
      case "upcoming":
      case "checkIn":
      case "boarding": {
        s.headline = routeText ? `${label} ${routeText}` : `${label} ${swiss(ev.title)}`;
        s.detail = cruise
          ? joinDot([str(ev.details.ship), str(ev.details.terminal), str(ev.details.cabin) && `Kabine ${str(ev.details.cabin)}`])
          : joinDot([number, gate ? `Gate ${gate}` : terminal ? `Terminal ${terminal}` : platform ? `Gleis ${platform}` : null, seat && `Sitz ${seat}`]);
        // nächster Meilenstein
        if (stage === "upcoming" && checkInT && checkInMs != null && checkInMs > now) {
          s.milestoneLabel = "Check-in öffnet";
          s.milestoneAt = sec(checkInMs);
        } else if (stage !== "boarding" && boardMs != null && boardMs > now && flight) {
          s.milestoneLabel = "Boarding";
          s.milestoneAt = sec(boardMs);
        } else if (cruise && stage === "boarding") {
          s.milestoneLabel = "Alle an Bord";
          s.milestoneAt = sec(endMs);
        } else {
          s.milestoneLabel = label;
          s.milestoneAt = sec(start);
        }
        s.progress = 0;
        if (!cruise) {
          s.nextHeadline = route.to ? `Ankunft ${route.to}` : "Ankunft";
          s.nextAt = sec(endMs);
        }
        break;
      }
      case "underway": {
        s.headline = routeText ?? swiss(ev.title);
        s.detail = joinDot([number, arrTime && `Ankunft ${arrTime}`]);
        s.milestoneLabel = cruise ? "Abfahrt des Schiffs" : "Ankunft";
        s.milestoneAt = sec(endMs);
        s.progress = cruise ? 1 : Math.min(1, Math.max(0, (now - start) / Math.max(MIN, endMs - start)));
        if (stay) {
          s.nextHeadline = `Check-in ${swiss(stay.ev.title)}`;
          s.nextAt = sec(stay.ms);
        }
        break;
      }
      case "arrived": {
        s.headline = route.to ? `Angekommen in ${route.to}` : "Angekommen";
        s.detail = joinDot([str(ev.details.baggageBelt) && `Gepäckband ${str(ev.details.baggageBelt)}`, str(ev.details.arrivalTerminal) && `Terminal ${str(ev.details.arrivalTerminal)}`]);
        s.progress = 1;
        if (stay) {
          s.nextHeadline = `Check-in ${swiss(stay.ev.title)}`;
          s.nextAt = sec(stay.ms);
          s.milestoneLabel = "Check-in";
          s.milestoneAt = sec(stay.ms);
        }
        break;
      }
      case "atStay": {
        s.headline = `Check-in ${swiss(stay!.ev.title)}`;
        s.detail = joinDot([stay!.ev.view.address ? swiss(stay!.ev.view.address) : null, hhmmOf(stay!.ev.details.checkInFrom) && `ab ${hhmmOf(stay!.ev.details.checkInFrom)}`]);
        s.icon = stay!.ev.icon;
        s.colorKey = stay!.ev.color;
        s.progress = 1;
        break;
      }
      default:
        break;
    }
    s.headline = swiss(clip(s.headline, 60));
    if (s.detail) s.detail = swiss(clip(s.detail, 80));
    else delete s.detail;
    if (s.nextHeadline) s.nextHeadline = swiss(clip(s.nextHeadline, 60));
    return s;
  };

  return {
    key: `flight:${pt.trip.id}:${ev.id}`,
    kind: "flight",
    userId: r.userId,
    tripId: pt.trip.id,
    tripTitle: swiss(pt.trip.title),
    eventId: ev.id,
    deepLink: `travelbuddy://event/${pt.trip.id}/${ev.id}`,
    startAtMs: start - 3 * HOUR,
    endAtMs: finalMs,
    dismissAfterSec: 600,
    autoStart: true,
    alert: {
      title: swiss(clip(routeText ? `${label} ${routeText}` : `${label} ${ev.title}`, 60)),
      body: swiss(clip(joinDot([number, `${timeDe(localDateTime(start, ev.startTz).time)} Uhr`]), 120)),
    },
    state,
  };
}

function checkinPlan(pt: PlanTrip, ev: PlanEvent, r: Recipient): ActivityPlan | null {
  const ms = stayCheckInMs(ev);
  if (ms == null) return null;
  const from = hhmmOf(ev.details.checkInFrom);
  return {
    key: `checkin:${pt.trip.id}:${ev.id}`,
    kind: "checkin",
    userId: r.userId,
    tripId: pt.trip.id,
    tripTitle: swiss(pt.trip.title),
    eventId: ev.id,
    deepLink: `travelbuddy://event/${pt.trip.id}/${ev.id}`,
    startAtMs: ms - 2 * HOUR,
    endAtMs: ms + 2 * HOUR,
    dismissAfterSec: 300,
    autoStart: false,
    alert: { title: swiss(clip(`Check-in ${ev.title}`, 60)), body: from ? `ab ${from} Uhr` : "" },
    state: (now) => ({
      headline: swiss(clip(`Check-in ${ev.title}`, 60)),
      detail: swiss(clip(joinDot([ev.view.address ?? ev.view.location, from && `ab ${from}`]), 80)) || undefined,
      icon: ev.icon,
      colorKey: ev.color,
      stage: now >= ms ? "atStay" : "upcoming",
      milestoneLabel: now >= ms ? undefined : "Check-in",
      milestoneAt: now >= ms ? undefined : sec(ms),
      updatedAt: sec(now),
    }),
  };
}

function dayPlan(pt: PlanTrip, r: Recipient, nowMs: number): ActivityPlan | null {
  const { trip } = pt;
  if (!trip.start_date) return null;
  const zone = currentZone(trip, pt.timed, nowMs);
  const date = localDateTime(nowMs, zone).date;
  const last = trip.end_date ?? trip.start_date;
  if (date < trip.start_date || date > last) return null;
  const items = dayItems(pt, date, r.participantId);
  if (items.length === 0) return null;
  const dayIndex = diffDays(trip.start_date, date) + 1;
  const dayText = `Tag ${dayIndex}${pt.dayCount ? ` von ${pt.dayCount}` : ""}`;

  const startAt = zonedToUtcMs(date, r.prefs.leadTimes.todayBriefing, zone);
  const lastMs = items.reduce((m, i) => Math.max(m, i.ms ?? 0, i.ev.endMs && i.ev.endMs - (i.ev.startMs ?? 0) < 24 * HOUR ? i.ev.endMs : 0), 0);
  const dayEnd = zonedToUtcMs(date, "23:59", zone);
  const endAt = lastMs > 0 ? Math.min(dayEnd, Math.max(lastMs + HOUR, startAt + 2 * HOUR)) : Math.min(dayEnd, zonedToUtcMs(date, "20:00", zone));

  const state = (now: number): ContentState => {
    const upcoming = items.filter((i) => i.ms != null && i.ms + 15 * MIN >= now);
    const next = upcoming[0];
    if (!next) {
      return {
        headline: swiss(clip(`${dayText} · ${trip.destination ?? trip.title}`, 60)),
        detail: items.length === 1 ? "1 Termin heute" : `${items.length} Termine heute`,
        icon: "map",
        colorKey: "activity",
        stage: "generic",
        updatedAt: sec(now),
      };
    }
    const after = upcoming[1];
    const atStay = next.ev.type === "Hotel" || next.ev.type === "Unterkunft";
    return {
      headline: swiss(clip(next.title, 60)),
      detail: swiss(clip(joinDot([dayText, next.ev.view.location ?? next.ev.view.address]), 80)),
      icon: next.ev.icon,
      colorKey: next.ev.color,
      stage: atStay ? "atStay" : "upcoming",
      milestoneLabel: next.ending ? next.ev.endLabel : next.ev.startLabel,
      milestoneAt: sec(next.ms!),
      ...(after ? { nextHeadline: swiss(clip(after.title, 60)), nextAt: sec(after.ms!) } : {}),
      updatedAt: sec(now),
    };
  };

  return {
    key: `day:${trip.id}:${date}`,
    kind: "day",
    userId: r.userId,
    tripId: trip.id,
    tripTitle: swiss(trip.title),
    eventId: null,
    deepLink: "travelbuddy://today",
    startAtMs: startAt,
    endAtMs: endAt,
    dismissAfterSec: 60,
    autoStart: true,
    alert: { title: swiss(clip(`${dayText} · ${trip.title}`, 60)), body: items.length === 1 ? "1 Termin heute" : `${items.length} Termine heute` },
    state,
  };
}

/** Pläne aller Konten mit Reisen im Umfeld von `nowMs`. */
export function planActivities(db: Db, nowMs: number, opts: { tripId?: number | null; trips?: PlanTrip[] } = {}): ActivityPlan[] {
  const trips = opts.trips ?? loadPlanTrips(db, nowMs, { tripId: opts.tripId, pastDays: 2, aheadDays: 2, deadlineDays: 0 });
  const plans: ActivityPlan[] = [];
  for (const pt of trips) {
    for (const r of pt.recipients) {
      if (r.devices === 0 && r.startTokens === 0) continue;
      for (const ev of pt.events) {
        if (ev.participantIds.length > 0 && !ev.participantIds.includes(r.participantId)) continue;
        if (ev.type === "Flug" || ev.type === "Zugreisen" || ev.type === "Kreuzfahrt") {
          const p = travelPlan(pt, ev, r);
          if (p) plans.push(p);
        } else if (ev.type === "Hotel" || ev.type === "Unterkunft") {
          const p = checkinPlan(pt, ev, r);
          if (p) plans.push(p);
        }
      }
      const d = dayPlan(pt, r, nowMs);
      if (d) plans.push(d);
    }
  }
  return plans;
}

/** Beispiel-Zustand für die Diagnose (`POST /v1/push/test`). */
export function sampleState(kind: ActivityKind, nowMs: number): ContentState {
  if (kind === "day") {
    return {
      headline: "Sagrada Familia",
      detail: "Tag 3 von 9 · Carrer de Mallorca 401",
      icon: "map",
      colorKey: "activity",
      stage: "upcoming",
      milestoneLabel: "Beginn",
      milestoneAt: sec(nowMs + 90 * MIN),
      nextHeadline: "Abendessen Cervecería",
      nextAt: sec(nowMs + 5 * HOUR),
      updatedAt: sec(nowMs),
    };
  }
  if (kind === "checkin") {
    return {
      headline: "Check-in Hotel Arts",
      detail: "Carrer de la Marina 19-21 · ab 15:00",
      icon: "bed",
      colorKey: "stay",
      stage: "atStay",
      updatedAt: sec(nowMs),
    };
  }
  return {
    headline: "Abflug ZRH → BCN",
    detail: "LX 1952 · Gate B42 · Sitz 12C",
    icon: "plane",
    colorKey: "air",
    stage: "boarding",
    milestoneLabel: "Abflug",
    milestoneAt: sec(nowMs + 40 * MIN),
    progress: 0,
    nextHeadline: "Ankunft BCN",
    nextAt: sec(nowMs + 2 * HOUR),
    updatedAt: sec(nowMs),
  };
}

/* ───────────── Zustand in kv ───────────── */

function kvGet(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}
function kvSet(db: Db, key: string, value: string, at: Date): void {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, at.toISOString());
}
const kvDel = (db: Db, key: string) => db.prepare("DELETE FROM kv WHERE key = ?").run(key);

type SentState = { sig: string; at: number; stage: Stage };

function signature(s: ContentState): string {
  return JSON.stringify([s.headline, s.detail ?? null, s.stage, s.milestoneLabel ?? null, s.milestoneAt ?? null, s.nextHeadline ?? null, s.nextAt ?? null, s.icon, s.colorKey]);
}

/* ───────────── Läufer ───────────── */

type ActivityRow = {
  activity_id: string;
  token_id: number;
  user_id: number;
  push_token: string;
  trip_id: number;
  kind: ActivityKind;
  event_id: number | null;
  created_at: string;
  updated_at: string;
  environment: "development" | "production" | null;
};

export type LiveReport = {
  started: number;
  updated: number;
  ended: number;
  failed: number;
  /** Nicht gesendet (kein APNs-Schlüssel); wird nachgeholt. */
  deferred: number;
  removedTokens: number;
};

export const emptyLiveReport = (): LiveReport => ({ started: 0, updated: 0, ended: 0, failed: 0, deferred: 0, removedTokens: 0 });

/** Periodische Aktualisierung während «unterwegs» (Fortschritt), Minuten. */
const PROGRESS_REFRESH_MIN = 10;
const START_MEMORY_DAYS = 3;

export class LiveActivityService {
  constructor(
    private readonly db: Db,
    private readonly transport: PushTransport | null,
    private readonly opts: { bundleId: string; log?: (m: string) => void } = { bundleId: "ch.rolfwalker.travelbuddy" }
  ) {}

  private async send(msg: Omit<ApnsMessage, "title" | "body" | "pushType" | "topic">): Promise<ApnsResult> {
    if (!this.transport) return { ok: false, status: 0, reason: "not_configured: kein Push-Transport", invalidToken: false };
    const full: ApnsMessage = {
      ...msg,
      title: "",
      body: "",
      pushType: "liveactivity",
      topic: apnsTopic(this.opts.bundleId, "liveactivity"),
    };
    try {
      return await this.transport.send(full);
    } catch (e) {
      return { ok: false, status: 0, reason: e instanceof Error ? e.message : "error", invalidToken: false };
    }
  }

  private rowsOf(userId: number): ActivityRow[] {
    return this.db
      .prepare(
        `SELECT a.*, t.apns_environment AS environment FROM live_activities a
           JOIN api_tokens t ON t.id = a.token_id
          WHERE a.user_id = ? AND t.revoked_at IS NULL ORDER BY a.created_at`
      )
      .all(userId) as ActivityRow[];
  }

  private devicesOf(userId: number): Array<{ id: number; token: string; environment: "development" | "production" }> {
    return (
      this.db
        .prepare(
          `SELECT id, push_to_start_token, apns_environment FROM api_tokens
            WHERE user_id = ? AND revoked_at IS NULL AND push_to_start_token IS NOT NULL ORDER BY id`
        )
        .all(userId) as Array<{ id: number; push_to_start_token: string; apns_environment: "development" | "production" | null }>
    ).map((d) => ({ id: d.id, token: d.push_to_start_token, environment: d.apns_environment ?? "production" }));
  }

  private matches(plan: ActivityPlan, row: ActivityRow): boolean {
    if (row.trip_id !== plan.tripId) return false;
    if (plan.kind === "day") return row.kind === "day";
    return row.kind === plan.kind && row.event_id === plan.eventId;
  }

  private dropRow(row: ActivityRow): void {
    this.db.prepare("DELETE FROM live_activities WHERE activity_id = ?").run(row.activity_id);
    kvDel(this.db, `la:state:${row.activity_id}`);
  }

  /**
   * Ein Durchlauf zum Zeitpunkt `now`. Sendet Starts, Aktualisierungen und Enden und räumt ungültige Token ab.
   * `plans` ist für Tests und die Simulation überschreibbar.
   */
  async run(now: Date, plans?: ActivityPlan[]): Promise<LiveReport> {
    const nowMs = now.getTime();
    const report = emptyLiveReport();
    const all = plans ?? planActivities(this.db, nowMs);
    const byUser = new Map<number, ActivityPlan[]>();
    for (const p of all) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
    // Konten mit angemeldeten Activities, aber ohne Plan, gehören auch durchgesehen (Aufräumen).
    const rowUsers = (this.db.prepare("SELECT DISTINCT user_id FROM live_activities").all() as { user_id: number }[]).map((r) => r.user_id);
    for (const u of rowUsers) if (!byUser.has(u)) byUser.set(u, []);

    for (const [userId, userPlans] of byUser) {
      await this.runUser(userId, userPlans, nowMs, now, report);
    }
    this.prune(now);
    return report;
  }

  private async runUser(userId: number, plans: ActivityPlan[], nowMs: number, now: Date, report: LiveReport): Promise<void> {
    const rows = this.rowsOf(userId);
    const devices = this.devicesOf(userId);
    const inWindow = (p: ActivityPlan) => p.startAtMs <= nowMs && nowMs < p.endAtMs;
    const flightRunning = plans.some((p) => p.kind === "flight" && inWindow(p));
    const claimed = new Set<string>();

    for (const plan of plans) {
      const mine = rows.filter((r) => this.matches(plan, r));
      mine.forEach((r) => claimed.add(r.activity_id));
      if (nowMs < plan.startAtMs) continue;

      // Ende des Fensters (oder Tagesaktivität, während ein Flug läuft)
      const over = nowMs >= plan.endAtMs;
      const yieldsToFlight = plan.kind === "day" && flightRunning;
      if (over || yieldsToFlight) {
        for (const row of mine) await this.endRow(row, plan, nowMs, report, over ? plan.dismissAfterSec : 0);
        continue;
      }

      const state = plan.state(nowMs);
      const sig = signature(state);
      for (const row of mine) {
        const last = this.lastState(row.activity_id) ?? this.lastState(`start:${row.token_id}:${plan.key}`, true);
        const transition = !last || last.sig !== sig;
        const periodic =
          !transition && state.stage === "underway" && last != null && nowMs - last.at * 1000 >= PROGRESS_REFRESH_MIN * MIN;
        if (!transition && !periodic) continue;
        const res = await this.send({
          deviceToken: row.push_token,
          environment: row.environment ?? "production",
          priority: transition ? 10 : 5,
          rawPayload: { aps: { timestamp: sec(nowMs), event: "update", "content-state": state } },
        });
        if (res.ok) {
          report.updated += 1;
          kvSet(this.db, `la:state:${row.activity_id}`, JSON.stringify({ sig, at: sec(nowMs), stage: state.stage } satisfies SentState), now);
        } else this.failure(res, report, () => this.dropRow(row));
      }

      // Start per Push-to-Start: je Gerät höchstens einmal je Plan
      if (plan.autoStart && !yieldsToFlight) {
        for (const d of devices) {
          if (rows.some((r) => r.token_id === d.id && this.matches(plan, r))) continue;
          const startKey = `la:start:${d.id}:${plan.key}`;
          if (kvGet(this.db, startKey) != null) continue;
          const res = await this.send({
            deviceToken: d.token,
            environment: d.environment,
            priority: 10,
            rawPayload: {
              aps: {
                timestamp: sec(nowMs),
                event: "start",
                "content-state": state,
                "attributes-type": "TravelActivityAttributes",
                attributes: {
                  tripId: plan.tripId,
                  tripTitle: plan.tripTitle,
                  kind: plan.kind,
                  ...(plan.eventId != null ? { eventId: plan.eventId } : {}),
                  deepLink: plan.deepLink,
                },
                alert: plan.alert,
              },
            },
          });
          if (res.ok) {
            report.started += 1;
            kvSet(this.db, startKey, JSON.stringify({ at: sec(nowMs), stage: state.stage, sig } satisfies SentState), now);
          } else {
            this.failure(res, report, () => {
              this.db.prepare("UPDATE api_tokens SET push_to_start_token = NULL WHERE id = ?").run(d.id);
            });
          }
        }
      }
    }

    // Angemeldete Activities ohne Plan: Tagesaktivitäten eines vergangenen Tages und ältere Reste beenden.
    for (const row of rows) {
      if (claimed.has(row.activity_id)) continue;
      const ageMs = nowMs - Date.parse(row.updated_at);
      const stale = row.kind === "day" ? true : ageMs > 18 * HOUR;
      if (!stale) continue;
      const state: ContentState = {
        headline: "Beendet",
        icon: "map",
        colorKey: "activity",
        stage: "generic",
        updatedAt: sec(nowMs),
      };
      await this.endRow(row, null, nowMs, report, 0, state);
    }
  }

  /** Zuletzt übermittelter Zustand einer Activity; `la:start:…` gilt, bis die Activity ihr eigenes Token meldet. */
  private lastState(id: string, rawKey = false): SentState | null {
    const raw = kvGet(this.db, rawKey ? `la:${id}` : `la:state:${id}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SentState;
    } catch {
      return null;
    }
  }

  private async endRow(row: ActivityRow, plan: ActivityPlan | null, nowMs: number, report: LiveReport, dismissSec: number, state?: ContentState) {
    const final = state ?? plan!.state(Math.min(nowMs, plan!.endAtMs));
    const res = await this.send({
      deviceToken: row.push_token,
      environment: row.environment ?? "production",
      priority: 10,
      rawPayload: {
        aps: { timestamp: sec(nowMs), event: "end", "content-state": { ...final, updatedAt: sec(nowMs) }, "dismissal-date": sec(nowMs) + dismissSec },
      },
    });
    if (res.ok) {
      report.ended += 1;
      this.dropRow(row);
    } else {
      this.failure(res, report, () => this.dropRow(row));
    }
  }

  private failure(res: Extract<ApnsResult, { ok: false }>, report: LiveReport, removeToken: () => void): void {
    if (isNotConfigured(res)) {
      report.deferred += 1;
      return;
    }
    report.failed += 1;
    if (res.invalidToken) {
      removeToken();
      report.removedTokens += 1;
    } else {
      this.opts.log?.(`[live-activity] APNs ${res.status} ${res.reason}`);
    }
  }

  /**
   * Diagnose: Beispiel-Zustand an die eigenen Geräte. `start` über Push-to-Start-Token, `update` und `end` an die
   * angemeldeten Activities des Kontos. Ignoriert Entdoppelung und Pläne; ohne Schlüssel `dryRun` mit Vorschau.
   */
  async sendSample(
    userId: number,
    o: { event: "start" | "update" | "end"; kind: ActivityKind; now: Date }
  ): Promise<Array<{ target: "push-to-start" | "activity"; tokenSuffix: string; environment: string; ok: boolean; dryRun?: boolean; status?: number; reason?: string; tokenRemoved?: boolean; payload: unknown }>> {
    const nowMs = o.now.getTime();
    const state = sampleState(o.kind, nowMs);
    const out: Awaited<ReturnType<LiveActivityService["sendSample"]>> = [];
    const attributes = {
      tripId: 0,
      tripTitle: "Beispielreise Barcelona",
      kind: o.kind,
      deepLink: "travelbuddy://today",
    };
    const targets: Array<{ target: "push-to-start" | "activity"; token: string; environment: "development" | "production"; row?: ActivityRow; tokenId?: number }> =
      o.event === "start"
        ? this.devicesOf(userId).map((d) => ({ target: "push-to-start" as const, token: d.token, environment: d.environment, tokenId: d.id }))
        : this.rowsOf(userId).map((r) => ({ target: "activity" as const, token: r.push_token, environment: r.environment ?? "production", row: r }));
    for (const t of targets) {
      const aps: Record<string, unknown> =
        o.event === "start"
          ? {
              timestamp: sec(nowMs),
              event: "start",
              "content-state": state,
              "attributes-type": "TravelActivityAttributes",
              attributes,
              alert: { title: state.headline, body: state.detail ?? "Testmeldung" },
            }
          : o.event === "end"
            ? { timestamp: sec(nowMs), event: "end", "content-state": state, "dismissal-date": sec(nowMs) + 60 }
            : { timestamp: sec(nowMs), event: "update", "content-state": state };
      const payload = { aps };
      const res = await this.send({ deviceToken: t.token, environment: t.environment, priority: 10, rawPayload: payload });
      const dry = !res.ok && isNotConfigured(res);
      let removed = false;
      if (!res.ok && !dry && res.invalidToken) {
        removed = true;
        if (t.row) this.dropRow(t.row);
        else if (t.tokenId != null) this.db.prepare("UPDATE api_tokens SET push_to_start_token = NULL WHERE id = ?").run(t.tokenId);
      } else if (res.ok && o.event === "end" && t.row) {
        this.dropRow(t.row);
      }
      out.push({
        target: t.target,
        tokenSuffix: t.token.slice(-6),
        environment: t.environment,
        ok: res.ok,
        ...(dry ? { dryRun: true, payload } : { payload: res.ok ? undefined : payload }),
        ...(res.ok ? {} : { status: res.status, reason: res.reason, ...(removed ? { tokenRemoved: true } : {}) }),
      });
    }
    return out;
  }

  private prune(now: Date): void {
    const cutoff = new Date(now.getTime() - START_MEMORY_DAYS * 24 * HOUR).toISOString();
    this.db.prepare("DELETE FROM kv WHERE key LIKE 'la:start:%' AND updated_at < ?").run(cutoff);
    this.db
      .prepare("DELETE FROM live_activities WHERE token_id IN (SELECT id FROM api_tokens WHERE revoked_at IS NOT NULL)")
      .run();
    this.db
      .prepare(
        `DELETE FROM kv WHERE key LIKE 'la:state:%'
           AND substr(key, 10) NOT IN (SELECT activity_id FROM live_activities)`
      )
      .run();
  }
}
