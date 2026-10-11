/**
 * Mitteilungsplan: Welche Mitteilungen aus den Ereignissen sind zu einem Zeitpunkt fällig?
 *
 * Reine Rechnung auf der Datenbank (kein Versand, kein Schreiben). Der Scheduler (`scheduler.ts`) liefert die
 * fälligen Mitteilungen über `Notifier.deliver` aus; die Entdoppelung (`notification_log`) liegt dort.
 *
 * Zeitzonen: Datum und Uhrzeit eines Ereignisses gelten in `startTz` bzw. `endTz`, ohne Angabe in der Zone der
 * Reise. Fällig-Zeitpunkte sind absolute UTC-Zeitpunkte (`zonedToUtcMs`), das Morgenbriefing läuft in der Zone,
 * in der sich die Reisenden gerade befinden (`currentZone`, wie «Heute»).
 *
 * Fälligkeit: Eine Mitteilung ist fällig, wenn `dueAt <= jetzt < validUntil`. Je Benutzer und Ereignis wird nur die
 * zuletzt fällig gewordene gesendet (eine neu angelegte Buchung 2 h vor Abflug löst nicht «24 h», «3 h» und «1 h»
 * auf einmal aus).
 */
import type { Db } from "../db/client";
import { getCatalog } from "../catalog/catalog";
import * as T from "../trips/service";
import type { EventView, TripRow } from "../trips/service";
import { currentZone, timeline, type Timed } from "../trips/today";
import { addDays, diffDays } from "../lib/dates";
import { isValidTimeZone, localDateTime, zonedToUtcMs } from "../lib/tz";
import { formatMoney } from "../lib/money";
import { getPrefs, IMAGE_KEYS, DEFAULT_RELEVANCE, PREF_KEYS, type Notice, type NotificationKind, type Prefs } from "../push/notifier";
import { clip, dateDe, daysPhrase, inPhrase, isoUtc, joinDot, swiss, timeDe, weekdayDateDe } from "./text";

const HOUR = 3_600_000;
const MIN = 60_000;

/* ───────────── Modell ───────────── */

export type Recipient = {
  userId: number;
  participantId: number;
  isAdmin: boolean;
  name: string;
  prefs: Prefs;
  /** Geräte mit APNs-Token (Mitteilungen). */
  devices: number;
  /** Geräte mit Push-to-Start-Token (Live Activities). */
  startTokens: number;
};

export type PlanEvent = {
  id: number;
  tripId: number;
  type: string;
  title: string;
  view: EventView;
  details: Record<string, unknown>;
  startTz: string;
  endTz: string;
  startMs: number | null;
  endMs: number | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  /** Leer = alle Teilnehmer. */
  participantIds: number[];
  icon: string;
  color: string;
  startLabel: string;
  endLabel: string;
};

export type PlanTrip = {
  trip: TripRow;
  events: PlanEvent[];
  recipients: Recipient[];
  timed: Timed[];
  dayCount: number | null;
};

export type PlannedNotice = {
  notice: Notice;
  /** Zeitpunkt, ab dem die Mitteilung gilt (UTC ms). */
  dueAtMs: number;
  /** Danach ist sie überholt und wird nicht mehr gesendet. */
  validUntilMs: number;
  /** Gruppe, aus der nur die zuletzt fällige gesendet wird. */
  group: string;
  /** Lesbare Kurzbezeichnung, z. B. `depart:3h`, `checkin`, `today`. */
  tag: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const hhmm = (v: unknown): string | null => {
  const s = str(v);
  return s && /^([01]?\d|2[0-3]):[0-5]\d/.test(s) ? timeDe(s) : null;
};

const compact = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))) as Partial<T>;

/* ───────────── Laden ───────────── */

/** UTC-Datum `YYYY-MM-DD` eines Zeitpunkts. */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type LoadOptions = { tripId?: number | null; pastDays?: number; aheadDays?: number; deadlineDays?: number };

/** Reisen, für die in der Nähe von `nowMs` etwas fällig sein kann (grob eingegrenzt), samt Ereignissen und Empfängern. */
export function loadPlanTrips(db: Db, nowMs: number, opts: LoadOptions = {}): PlanTrip[] {
  const today = utcDate(nowMs);
  const lo = addDays(today, -(opts.pastDays ?? 2));
  const hi = addDays(today, opts.aheadDays ?? 9);
  const dl = addDays(today, opts.deadlineDays ?? 62);
  const rows = db
    .prepare(
      `SELECT t.* FROM trips t
        WHERE t.status != 'cancelled'
          AND (? IS NULL OR t.id = ?)
          AND ((t.start_date IS NOT NULL AND t.start_date <= ? AND COALESCE(t.end_date, t.start_date) >= ?)
               OR EXISTS (SELECT 1 FROM trip_events e
                           WHERE e.trip_id = t.id AND e.status = 'confirmed'
                             AND (e.start_date BETWEEN ? AND ? OR COALESCE(e.end_date, e.start_date) BETWEEN ? AND ?
                                  OR e.cancel_until BETWEEN ? AND ?
                                  OR (e.payment_status IN ('open', 'deposit') AND e.start_date BETWEEN ? AND ?))))
        ORDER BY t.id`
    )
    .all(opts.tripId ?? null, opts.tripId ?? null, hi, lo, lo, hi, lo, hi, lo, dl, lo, dl) as TripRow[];

  const cat = getCatalog();
  return rows.map((trip) => {
    const tripTz = isValidTimeZone(trip.timezone) ? trip.timezone : "Europe/Zurich";
    const views = T.eventViews(db, trip, { withComments: false }).filter((v) => v.status === "confirmed");
    const timed = timeline(views, tripTz);
    const events: PlanEvent[] = timed.map((t) => {
      const v = t.view;
      const def = cat.type(v.type);
      const sTz = v.startTz && isValidTimeZone(v.startTz) ? v.startTz : tripTz;
      const eTz = v.endTz && isValidTimeZone(v.endTz) ? v.endTz : sTz;
      return {
        id: v.id,
        tripId: v.tripId,
        type: v.type,
        title: swiss(v.title),
        view: v,
        details: v.details,
        startTz: sTz,
        endTz: eTz,
        startMs: t.startMs,
        endMs: t.endMs,
        hasStartTime: Boolean(v.startTime),
        hasEndTime: Boolean(v.endTime),
        participantIds: v.participantIds,
        icon: def?.icon ?? "map",
        color: def?.color ?? "activity",
        startLabel: def?.startLabel ?? "Beginn",
        endLabel: def?.endLabel ?? "Ende",
      };
    });

    const recipientRows = db
      .prepare(
        `SELECT p.id AS participant_id, p.user_id, p.display_name, u.is_admin,
                (SELECT COUNT(*) FROM api_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL AND t.apns_token IS NOT NULL) AS devices,
                (SELECT COUNT(*) FROM api_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL AND t.push_to_start_token IS NOT NULL) AS start_tokens
           FROM participants p JOIN users u ON u.id = p.user_id
          WHERE p.trip_id = ? AND u.active = 1 ORDER BY p.id`
      )
      .all(trip.id) as Array<{ participant_id: number; user_id: number; display_name: string; is_admin: number; devices: number; start_tokens: number }>;
    const seen = new Set<number>();
    const recipients: Recipient[] = [];
    for (const r of recipientRows) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      recipients.push({
        userId: r.user_id,
        participantId: r.participant_id,
        isAdmin: r.is_admin === 1,
        name: r.display_name,
        prefs: getPrefs(db, r.user_id),
        devices: r.devices,
        startTokens: r.start_tokens,
      });
    }

    const last = trip.end_date ?? timed.map((t) => t.view.endDate ?? t.view.startDate).filter((d): d is string => Boolean(d)).sort().pop() ?? null;
    const dayCount = trip.start_date && last ? diffDays(trip.start_date, last) + 1 : null;
    return { trip, events, recipients, timed, dayCount };
  });
}

/** Empfänger eines Ereignisses: Teilnehmer mit Konto, bei eingeschränktem «Wer ist dabei» nur diese. */
export function eventRecipients(pt: PlanTrip, ev: PlanEvent): Recipient[] {
  return pt.recipients.filter((r) => ev.participantIds.length === 0 || ev.participantIds.includes(r.participantId));
}

/* ───────────── Ticket und Texte je Ereignis ───────────── */

const ROUTE_KEYS: Record<string, [string, string]> = {
  Flug: ["departureAirport", "arrivalAirport"],
  Zugreisen: ["originPlace", "destinationPlace"],
  Transfer: ["originPlace", "destinationPlace"],
  Mietauto: ["pickupPlace", "returnPlace"],
};

export function routeOf(ev: PlanEvent): { from: string | null; to: string | null } {
  const keys = ROUTE_KEYS[ev.type];
  if (!keys) return { from: null, to: null };
  return { from: str(ev.details[keys[0]]), to: str(ev.details[keys[1]]) };
}

/** Anzeigezeit eines Zeitpunkts in der Ortszeit des Ereignisses; weicht die Zone von der Reisezone ab, mit Hinweis. */
function localTimeText(ms: number, tz: string, tripTz: string): string {
  const t = localDateTime(ms, tz).time;
  return tz === tripTz ? t : `${t} Ortszeit`;
}

function eventFacts(ev: PlanEvent, extra: Array<{ label: string; value: string }> = []): Array<{ label: string; value: string }> {
  const cat = getCatalog();
  const routeKeys = new Set(Object.values(ROUTE_KEYS).flat());
  const rows = cat.summaryRows(ev.type, Object.fromEntries(Object.entries(ev.details).filter(([k]) => !routeKeys.has(k))));
  return [...extra, ...rows.map((r) => ({ label: r.label, value: swiss(r.value) }))].slice(0, 8);
}

export function ticketFor(pt: PlanTrip, ev: PlanEvent, extra: { facts?: Array<{ label: string; value: string }>; deadlineKind?: "cancel" | "payment" } = {}) {
  const { from, to } = routeOf(ev);
  const dayIndex = pt.trip.start_date && ev.view.startDate ? diffDays(pt.trip.start_date, ev.view.startDate) + 1 : null;
  const v = ev.view;
  return compact({
    type: ev.type,
    icon: ev.icon,
    color: ev.color,
    title: ev.title,
    startAt: ev.startMs != null && ev.hasStartTime ? isoUtc(ev.startMs) : null,
    startDate: v.startDate,
    startTime: v.startTime,
    endTime: v.endTime,
    tz: ev.startTz,
    from,
    to,
    place: v.location ? swiss(v.location) : null,
    address: v.address ? swiss(v.address) : null,
    lat: v.lat,
    lon: v.lon,
    reference: v.bookingReference,
    tripTitle: swiss(pt.trip.title),
    dayIndex: dayIndex != null && dayIndex >= 1 ? dayIndex : null,
    dayCount: pt.dayCount,
    facts: eventFacts(ev, extra.facts),
    deadlineKind: extra.deadlineKind ?? null,
  });
}

const eventLink = (ev: PlanEvent) => `travelbuddy://event/${ev.tripId}/${ev.id}`;

/* ───────────── Planung ───────────── */

type Ctx = { pt: PlanTrip; nowMs: number };

function make(
  r: Recipient,
  pt: PlanTrip,
  p: {
    kind: NotificationKind;
    tag: string;
    key: string;
    group: string;
    dueAtMs: number;
    validUntilMs: number;
    title: string;
    body: string;
    deepLink: string;
    eventId?: number;
    ticket?: Record<string, unknown>;
    interruption?: "active" | "time-sensitive";
    /** Verhalten in den Ruhezeiten; ohne Angabe gilt der Standard der Art (`push/quiet.ts`). */
    quiet?: "skip" | "queue" | false;
  }
): PlannedNotice {
  return {
    dueAtMs: p.dueAtMs,
    validUntilMs: p.validUntilMs,
    group: `${r.userId}|${p.group}`,
    tag: p.tag,
    notice: {
      userId: r.userId,
      kind: p.kind,
      dedupeKey: `sched:${p.key}`,
      title: swiss(clip(p.title, 60)),
      body: swiss(clip(p.body, 180)),
      deepLink: p.deepLink,
      tripId: pt.trip.id,
      ...(p.eventId != null ? { eventId: p.eventId } : {}),
      imageKey: IMAGE_KEYS[p.kind],
      interruption: p.interruption ?? "active",
      relevance: DEFAULT_RELEVANCE[p.kind],
      ...(p.ticket ? { ticket: p.ticket } : {}),
      threadId: `trip-${pt.trip.id}`,
      expiresAt: p.validUntilMs,
      ...(p.quiet !== undefined ? { quiet: p.quiet } : {}),
    },
  };
}

/**
 * «in 3 Stunden»: zur Vorlaufzeit selbst die Vorlaufzeit, bei Nachholen (die Mitteilung ist schon fällig) die
 * tatsächlich verbleibende Zeit, gerundet (5 Minuten bis 6 h, sonst 30 Minuten).
 */
function leadPhrase(leadMs: number, dueAtMs: number, targetMs: number, nowMs: number): string {
  if (dueAtMs > nowMs || nowMs - dueAtMs < 2 * MIN) return inPhrase(leadMs);
  const remaining = Math.max(0, targetMs - nowMs);
  const step = remaining < 6 * HOUR ? 5 * MIN : 30 * MIN;
  return inPhrase(Math.round(remaining / step) * step);
}

/** Beginn eines Ereignisses als Text («25.10.2026 17:00», bei abweichender Zone mit «Ortszeit»). */
function startText(pt: PlanTrip, ev: PlanEvent): string {
  const v = ev.view;
  if (!v.startDate) return "";
  if (ev.startMs == null || !ev.hasStartTime) return dateDe(v.startDate);
  const l = localDateTime(ev.startMs, ev.startTz);
  return `${dateDe(l.date)} ${localTimeText(ev.startMs, ev.startTz, pt.trip.timezone)}`;
}

/** `HH:mm` auf `date` in `tz` als UTC-ms; liegt der Zeitpunkt nicht vor `before`, einen Tag früher (Check-in-Zeiten). */
function localBefore(date: string, time: string, tz: string, before: number): number {
  let ms = zonedToUtcMs(date, time, tz);
  if (ms >= before) ms = zonedToUtcMs(addDays(date, -1), time, tz);
  return ms;
}

function departNotices(ctx: Ctx, ev: PlanEvent, r: Recipient, out: PlannedNotice[]): void {
  const { pt } = ctx;
  if (ev.startMs == null || !ev.hasStartTime) return;
  const cruise = ev.type === "Kreuzfahrt";
  if (cruise) {
    const k = str(ev.details.entryKind);
    if (k && k !== "Einschiffung" && k !== "Reise") return;
  }
  let hours = r.prefs.leadTimes.departHours;
  // Mietwagen: nur die frühe Vorankündigung als «Abfahrt», die Abholung kommt als `trip.pickup` (2 h vorher).
  if (ev.type === "Mietauto") hours = hours.filter((h) => h >= 12);
  const route = routeOf(ev);
  const dep = startText(pt, ev);
  const placeText = route.from && route.to ? `${route.from} → ${route.to}` : null;
  const ticket = ticketFor(pt, ev);
  const group = `depart:${ev.id}`;
  const validUntil = ev.startMs;

  const bodyFor = (extra?: string): string => {
    switch (ev.type) {
      case "Flug":
        return joinDot([
          placeText,
          str(ev.details.flightNumber),
          dep,
          str(ev.details.departureTerminal) && `Terminal ${str(ev.details.departureTerminal)}`,
          str(ev.details.departureGate) && `Gate ${str(ev.details.departureGate)}`,
          extra,
        ]);
      case "Zugreisen":
        return joinDot([
          placeText,
          str(ev.details.trainNumber),
          dep,
          str(ev.details.departurePlatform) && `Gleis ${str(ev.details.departurePlatform)}`,
          extra,
        ]);
      case "Mietauto":
        return joinDot([ev.title, route.from, dep, ev.view.bookingReference && `Buchung ${ev.view.bookingReference}`, extra]);
      case "Kreuzfahrt":
        return joinDot([str(ev.details.ship) ?? ev.title, str(ev.details.terminal), dep, extra]);
      default:
        return joinDot([ev.title, str(ev.details.meetingPoint) && `Treffpunkt ${str(ev.details.meetingPoint)}`, placeText, dep, extra]);
    }
  };
  const titleFor = (lead: string): string => {
    switch (ev.type) {
      case "Flug": return `Abflug ${lead}`;
      case "Zugreisen": return `Abfahrt ${lead}`;
      case "Mietauto": return `Mietwagen-Abholung ${lead}`;
      case "Kreuzfahrt": return `Einschiffung ${lead}`;
      default: return `Transfer ${lead}`;
    }
  };

  // Check-in öffnet (Flug): `checkInOpens`, sonst 24 h vorher. Fällt der Ersatzzeitpunkt mit der 24-h-Erinnerung
  // zusammen, trägt diese den Hinweis, damit nicht zwei Meldungen gleichzeitig kommen.
  let checkInMs: number | null = null;
  let checkInFallback = false;
  if (ev.type === "Flug") {
    const t = hhmm(ev.details.checkInOpens);
    if (t) checkInMs = localBefore(ev.view.startDate!, t, ev.startTz, ev.startMs);
    else {
      checkInMs = ev.startMs - 24 * HOUR;
      checkInFallback = true;
    }
  }
  const mergedCheckIn = checkInFallback && hours.some((h) => Math.abs(h * HOUR - 24 * HOUR) < MIN);

  for (const h of hours) {
    const dueAt = ev.startMs - h * HOUR;
    const merged = mergedCheckIn && Math.abs(h - 24) < 1e-9;
    const when = leadPhrase(h * HOUR, dueAt, ev.startMs, ctx.nowMs);
    out.push(
      make(r, pt, {
        kind: "trip.depart",
        tag: `depart:${h}h`,
        key: `depart:${ev.id}:${h}h:${Math.floor(ev.startMs / MIN)}`,
        group,
        dueAtMs: dueAt,
        validUntilMs: validUntil,
        title: titleFor(when),
        body: bodyFor(merged ? (ctx.nowMs - dueAt > 10 * MIN ? "Check-in ist offen" : "Check-in öffnet jetzt") : undefined),
        deepLink: eventLink(ev),
        eventId: ev.id,
        ticket,
        interruption: "time-sensitive",
        // Die frühe Vorankündigung (ab 12 h) wartet die Ruhezeit ab; 3 h, 1 h, Check-in und Boarding nie.
        quiet: h >= 12 ? "skip" : false,
      })
    );
  }

  if (ev.type === "Flug" && checkInMs != null && !mergedCheckIn) {
    out.push(
      make(r, pt, {
        kind: "trip.depart",
        tag: "checkin",
        key: `depart:${ev.id}:checkin:${Math.floor(ev.startMs / MIN)}`,
        group,
        dueAtMs: checkInMs,
        validUntilMs: validUntil,
        title: ctx.nowMs - checkInMs > 10 * MIN ? "Check-in ist offen" : "Check-in öffnet jetzt",
        body: joinDot([str(ev.details.flightNumber), placeText, `Abflug ${dep}`]),
        deepLink: eventLink(ev),
        eventId: ev.id,
        ticket,
        interruption: "time-sensitive",
      })
    );
  }

  const boarding = ev.type === "Flug" ? hhmm(ev.details.boardingTime) : null;
  if (boarding) {
    const dueAt = localBefore(ev.view.startDate!, boarding, ev.startTz, ev.startMs + 1);
    out.push(
      make(r, pt, {
        kind: "trip.depart",
        tag: "boarding",
        key: `depart:${ev.id}:boarding:${Math.floor(ev.startMs / MIN)}`,
        group,
        dueAtMs: dueAt,
        validUntilMs: validUntil,
        title: ctx.nowMs - dueAt > 10 * MIN ? "Boarding läuft" : "Boarding beginnt",
        body: joinDot([
          str(ev.details.flightNumber),
          placeText,
          str(ev.details.departureGate) && `Gate ${str(ev.details.departureGate)}`,
          `Abflug ${localTimeText(ev.startMs, ev.startTz, pt.trip.timezone)}`,
        ]),
        deepLink: eventLink(ev),
        eventId: ev.id,
        ticket,
        interruption: "time-sensitive",
      })
    );
  }
}

function pickupNotices(ctx: Ctx, ev: PlanEvent, r: Recipient, out: PlannedNotice[]): void {
  const { pt } = ctx;
  if (ev.type !== "Mietauto" || ev.startMs == null || !ev.hasStartTime) return;
  const route = routeOf(ev);
  const dueAt = ev.startMs - 2 * HOUR;
  out.push(
    make(r, pt, {
      kind: "trip.pickup",
      tag: "pickup:2h",
      key: `pickup:${ev.id}:2h:${Math.floor(ev.startMs / MIN)}`,
      group: `pickup:${ev.id}`,
      dueAtMs: dueAt,
      validUntilMs: ev.startMs,
      title: `Mietwagen abholen ${leadPhrase(2 * HOUR, dueAt, ev.startMs, ctx.nowMs)}`,
      body: joinDot([
        str(ev.view.provider) ?? ev.title,
        route.from ?? ev.view.location,
        startText(pt, ev),
        str(ev.details.pickupHours) && `Öffnungszeiten ${str(ev.details.pickupHours)}`,
        ev.view.bookingReference && `Buchung ${ev.view.bookingReference}`,
      ]),
      deepLink: eventLink(ev),
      eventId: ev.id,
      ticket: ticketFor(pt, ev),
      interruption: "time-sensitive",
    })
  );
}

function stayNotices(ctx: Ctx, ev: PlanEvent, r: Recipient, out: PlannedNotice[]): void {
  const { pt } = ctx;
  if (ev.type !== "Hotel" && ev.type !== "Unterkunft") return;
  const v = ev.view;
  const ticket = ticketFor(pt, ev);

  // Check-in: am Morgen des Anreisetags (Uhrzeit des Morgenbriefings, Ortszeit der Unterkunft)
  if (v.startDate) {
    const from = hhmm(v.startTime) ?? hhmm(ev.details.checkInFrom);
    const dueAt = zonedToUtcMs(v.startDate, r.prefs.leadTimes.todayBriefing, ev.startTz);
    const validUntil = zonedToUtcMs(v.startDate, "23:59", ev.startTz);
    out.push(
      make(r, pt, {
        kind: "trip.stay",
        tag: "checkin-day",
        key: `stay-in:${ev.id}:${v.startDate}`,
        group: `stay-in:${ev.id}`,
        dueAtMs: dueAt,
        validUntilMs: validUntil,
        title: "Check-in heute",
        body: joinDot([ev.title, from && `ab ${from}`, v.address ? swiss(v.address) : v.location ? swiss(v.location) : null]),
        deepLink: eventLink(ev),
        eventId: ev.id,
        ticket,
      })
    );
  }

  // Check-out: eine Stunde (Einstellung) vor der Auszugszeit
  const until = hhmm(v.endTime) ?? hhmm(ev.details.checkOutUntil);
  if (v.endDate && until) {
    const endMs = zonedToUtcMs(v.endDate, until, ev.endTz);
    const lead = r.prefs.leadTimes.checkoutMinutes;
    const dueAt = endMs - lead * MIN;
    out.push(
      make(r, pt, {
        kind: "trip.stay",
        tag: "checkout",
        key: `stay-out:${ev.id}:${Math.floor(endMs / MIN)}:${lead}`,
        group: `stay-out:${ev.id}`,
        dueAtMs: dueAt,
        validUntilMs: endMs,
        title: lead > 0 ? `Check-out ${leadPhrase(lead * MIN, dueAt, endMs, ctx.nowMs)}` : "Check-out jetzt",
        body: joinDot([ev.title, `bis ${until}`, `${dateDe(v.endDate)}`]),
        deepLink: eventLink(ev),
        eventId: ev.id,
        ticket: { ...ticket, startAt: isoUtc(endMs), startDate: v.endDate, startTime: until, tz: ev.endTz },
      })
    );
  }
}

function deadlineNotices(ctx: Ctx, ev: PlanEvent, r: Recipient, out: PlannedNotice[]): void {
  const { pt } = ctx;
  const v = ev.view;
  const n = r.prefs.leadTimes.deadlineDays;
  const days = [...new Set([n >= 1 ? n : 0, 1])].sort((a, b) => b - a);
  const briefing = r.prefs.leadTimes.todayBriefing;

  const push = (kind: "cancel" | "payment", date: string, title: (when: string) => string, body: string) => {
    const validUntil = zonedToUtcMs(date, "23:59", ev.startTz);
    const todayLocal = localDateTime(ctx.nowMs, ev.startTz).date;
    for (const d of days) {
      const dueAt = zonedToUtcMs(addDays(date, -d), briefing, ev.startTz);
      // Bei Nachholen zählt der tatsächliche Abstand in Tagen, sonst die Vorlaufzeit.
      const when = daysPhrase(dueAt > ctx.nowMs ? d : Math.max(0, diffDays(todayLocal, date)));
      out.push(
        make(r, pt, {
          kind: "trip.deadline",
          tag: `deadline:${kind}:${d}d`,
          key: `deadline:${ev.id}:${kind}:${date}:${d}d`,
          group: `deadline:${ev.id}:${kind}`,
          dueAtMs: dueAt,
          validUntilMs: validUntil,
          title: title(when),
          body,
          deepLink: eventLink(ev),
          eventId: ev.id,
          ticket: ticketFor(pt, ev, {
            deadlineKind: kind,
            facts: [{ label: kind === "cancel" ? "Kostenlos stornierbar bis" : "Fällig am", value: dateDe(date) }],
          }),
        })
      );
    }
  };

  if (v.cancelUntil) {
    push("cancel", v.cancelUntil, (when) => `Stornofrist ${when}`, `${ev.title}: kostenlos stornierbar bis ${dateDe(v.cancelUntil!)}.`);
  }
  if (v.priceMinor && (v.paymentStatus === "open" || v.paymentStatus === "deposit") && v.startDate) {
    const amount = formatMoney(v.priceMinor, v.currency ?? "CHF");
    push(
      "payment",
      v.startDate,
      (when) => `Zahlung fällig ${when}`,
      `${ev.title}: ${amount} ${v.paymentStatus === "deposit" ? "Restzahlung offen" : "offen"}, fällig bis ${dateDe(v.startDate!)}.`
    );
  }
}

/** Einträge der Tagesliste (Beginn heute, mehrtägige Ereignisse mit Ende heute als «Check-out» usw.). */
export function dayItems(
  pt: PlanTrip,
  date: string,
  /** Teilnehmer, für den die Liste gilt: Ereignisse, bei denen er nicht dabei ist, entfallen. */
  participantId?: number
): Array<{ ev: PlanEvent; ms: number | null; time: string | null; title: string; ending: boolean }> {
  const items: Array<{ ev: PlanEvent; ms: number | null; time: string | null; title: string; ending: boolean }> = [];
  for (const ev of pt.events) {
    if (ev.type === "Aufgabe") continue;
    if (participantId != null && ev.participantIds.length > 0 && !ev.participantIds.includes(participantId)) continue;
    const v = ev.view;
    if (v.startDate === date) {
      const time = hhmm(v.startTime) ?? (ev.type === "Hotel" || ev.type === "Unterkunft" ? hhmm(ev.details.checkInFrom) : null);
      items.push({ ev, ms: ev.startMs != null && ev.hasStartTime ? ev.startMs : null, time, title: ev.title, ending: false });
    } else if (v.endDate === date && v.startDate && v.startDate < date) {
      const time = hhmm(v.endTime) ?? (ev.type === "Hotel" || ev.type === "Unterkunft" ? hhmm(ev.details.checkOutUntil) : null);
      const ms = ev.endMs != null && ev.hasEndTime ? ev.endMs : null;
      items.push({ ev, ms, time, title: `${ev.endLabel}: ${ev.title}`, ending: true });
    }
  }
  return items.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.ev.id - b.ev.id);
}

function todayNotices(ctx: Ctx, r: Recipient, out: PlannedNotice[]): void {
  const { pt, nowMs } = ctx;
  const { trip } = pt;
  if (!trip.start_date) return;
  const zone = currentZone(trip, pt.timed, nowMs);
  const local = localDateTime(nowMs, zone);
  const date = local.date;
  const last = trip.end_date ?? trip.start_date;
  if (date < trip.start_date || date > last) return; // nur aktive Reisen
  const items = dayItems(pt, date, r.participantId);
  if (items.length === 0) return;

  const briefing = r.prefs.leadTimes.todayBriefing;
  const dueAt = zonedToUtcMs(date, briefing, zone);
  const validUntil = zonedToUtcMs(date, "12:00", zone);
  const dayIndex = diffDays(trip.start_date, date) + 1;
  const shown = items.slice(0, 3).map((i) => (i.time ? `${i.time} ${i.title}` : i.title));
  const more = items.length - shown.length;
  const first = items.find((i) => i.ms != null) ?? null;
  const title = joinDot([`Heute: Tag ${dayIndex}${pt.dayCount ? ` von ${pt.dayCount}` : ""}`, swiss(trip.destination ?? trip.title)]);

  out.push(
    make(r, pt, {
      kind: "trip.today",
      tag: "today",
      key: `today:${trip.id}:${date}`,
      group: `today:${trip.id}`,
      dueAtMs: dueAt,
      validUntilMs: validUntil,
      title,
      body: `${weekdayDateDe(date)}: ${shown.join(", ")}${more > 0 ? ` und ${more} weitere` : ""}`,
      deepLink: "travelbuddy://today",
      ticket: compact({
        title,
        startAt: first?.ms != null ? isoUtc(first.ms) : null,
        startDate: date,
        startTime: first?.time ?? null,
        tz: zone,
        tripTitle: swiss(trip.title),
        dayIndex,
        dayCount: pt.dayCount,
        count: items.length,
        items: items.slice(0, 8).map((i) =>
          compact({ time: i.time, title: swiss(clip(i.title, 60)), type: i.ev.type, icon: i.ev.icon, color: i.ev.color })
        ),
      }),
    })
  );
}

export type PlanOptions = LoadOptions & {
  /** Auch noch nicht fällige Mitteilungen der nächsten Stunden zurückgeben (Vorschau). */
  previewHours?: number;
};

export type PlanResult = {
  nowMs: number;
  /** Jetzt zu senden (je Gruppe die zuletzt fällige). */
  due: PlannedNotice[];
  /** Kommen in den nächsten `previewHours` Stunden. */
  upcoming: PlannedNotice[];
  trips: PlanTrip[];
};

/** Alle Mitteilungs-Kandidaten einer Reise (ohne Zeitfilter). */
export function candidatesFor(pt: PlanTrip, nowMs: number): PlannedNotice[] {
  const out: PlannedNotice[] = [];
  const ctx: Ctx = { pt, nowMs };
  for (const ev of pt.events) {
    if (ev.type === "Aufgabe") continue;
    for (const r of eventRecipients(pt, ev)) {
      if (r.devices === 0) continue;
      if (["Flug", "Zugreisen", "Transfer", "Mietauto", "Kreuzfahrt"].includes(ev.type)) departNotices(ctx, ev, r, out);
      pickupNotices(ctx, ev, r, out);
      stayNotices(ctx, ev, r, out);
      deadlineNotices(ctx, ev, r, out);
    }
  }
  for (const r of pt.recipients) {
    if (r.devices === 0) continue;
    todayNotices(ctx, r, out);
  }
  return out;
}

/** Fällige Mitteilungen zum Zeitpunkt `nowMs`. */
export function planNotices(db: Db, nowMs: number, opts: PlanOptions = {}): PlanResult {
  const trips = loadPlanTrips(db, nowMs, opts);
  const all = trips.flatMap((pt) => candidatesFor(pt, nowMs));
  // Nur, was der Empfänger nicht abgeschaltet hat (die Einstellung gilt zusätzlich in `Notifier.deliver`).
  const prefs = new Map<number, Prefs>();
  for (const pt of trips) for (const r of pt.recipients) prefs.set(r.userId, r.prefs);
  const enabled = all.filter((p) => prefs.get(p.notice.userId)?.[PREF_KEYS[p.notice.kind]] !== false);
  const latest = new Map<string, PlannedNotice>();
  for (const p of enabled) {
    if (p.dueAtMs > nowMs || nowMs >= p.validUntilMs) continue;
    const cur = latest.get(p.group);
    if (!cur || p.dueAtMs > cur.dueAtMs) latest.set(p.group, p);
  }
  const horizon = nowMs + (opts.previewHours ?? 24) * HOUR;
  const upcoming = enabled
    .filter((p) => p.dueAtMs > nowMs && p.dueAtMs <= horizon && p.validUntilMs > p.dueAtMs)
    .sort((a, b) => a.dueAtMs - b.dueAtMs);
  return { nowMs, due: [...latest.values()].sort((a, b) => a.dueAtMs - b.dueAtMs), upcoming, trips };
}
