/**
 * «Heute», Tagesansicht und Zusammenfassung (Widgets).
 *
 * Zeitzonen: Ereignisse haben Datum und Uhrzeit in Ortszeit plus `startTz`/`endTz` (`null` = Zone der Reise).
 * «Jetzt» wird in der Zone gerechnet, in der sich die Reisenden gerade befinden: Vorgabe ist die Reisezone,
 * danach folgt die Zone des zuletzt begonnenen (bzw. beendeten) Ereignisses mit Zone (ein Flug nach Miami
 * schaltet auf America/New_York um). Ein Aufruf mit `tz` übersteuert das.
 */
import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";
import { HttpError } from "../lib/errors";
import { addDays, appTimeZone, diffDays, todayLocal } from "../lib/dates";
import { isValidTimeZone, localDateTime, zonedToUtcMs } from "../lib/tz";
import { getCatalog } from "../catalog/catalog";
import * as L from "../ledgers/service";
import * as T from "./service";
import type { EventView, TripRow } from "./service";

const MAX_TASKS = 20;
const LOOKAHEAD_DAYS = 14;

export type Timed = { view: EventView; startMs: number | null; endMs: number | null };

/** Absolute Zeitpunkte von Beginn und Ende eines Ereignisses (Ortszeit + Zone → UTC). */
export function timeline(views: EventView[], tripTz: string): Timed[] {
  return views.map((view) => {
    const sTz = view.startTz && isValidTimeZone(view.startTz) ? view.startTz : tripTz;
    const eTz = view.endTz && isValidTimeZone(view.endTz) ? view.endTz : view.startTz && isValidTimeZone(view.startTz) ? view.startTz : tripTz;
    let startMs: number | null = null;
    let endMs: number | null = null;
    if (view.startDate) {
      startMs = zonedToUtcMs(view.startDate, view.startTime ?? "00:00", sTz);
      const endDate = view.endDate ?? view.startDate;
      if (view.endTime) endMs = zonedToUtcMs(endDate, view.endTime, eTz);
      else if (view.endDate && view.endDate > view.startDate) endMs = zonedToUtcMs(endDate, "23:59", eTz);
      else endMs = startMs;
      if (endMs < startMs) endMs = startMs;
    }
    return { view, startMs, endMs };
  });
}

/** Zone, in der die Reisenden zum Zeitpunkt `nowMs` sind (siehe Kopfkommentar). */
export function currentZone(trip: Pick<TripRow, "timezone">, timed: Timed[], nowMs: number): string {
  let zone = trip.timezone;
  const started = timed
    .filter((t) => t.startMs != null && t.startMs <= nowMs && t.view.type !== "Aufgabe")
    .sort((a, b) => a.startMs! - b.startMs!);
  for (const t of started) {
    const ended = t.endMs != null && t.endMs <= nowMs;
    const tz = ended ? t.view.endTz ?? t.view.startTz : t.view.startTz;
    if (tz && isValidTimeZone(tz)) zone = tz;
  }
  return zone;
}

const covers = (v: EventView, date: string) => {
  if (!v.startDate) return false;
  const end = v.endDate ?? v.startDate;
  return v.startDate <= date && date <= end;
};

/* ───────────── Rolle eines Ereignisses an einem Tag ─────────────
 * Mehrtägige Ereignisse (Hotel, Ferienwohnung, Mietauto, Visum, Flug über Mitternacht …) erscheinen am ersten
 * Tag als `start`, am letzten als `end`, dazwischen als `middle`; eintägige sind `single`. `displayTime` ist die
 * Uhrzeit des angezeigten Endes in dessen Ortszeit (Beginn: `startTime`, Ende: `endTime`). Kreuzfahrten: Der
 * Eintrag «Reise» (Gesamtreise ohne Zeit) bleibt `middle`, Hafentage, Ein-/Ausschiffung und «Abfahrt …» sind `single`. */

export type DayRole = "single" | "start" | "middle" | "end";
export type DayInfo = { dayRole: DayRole; displayTime: string | null; displayLabel: string | null };

const isMultiDay = (v: EventView) => Boolean(v.startDate && v.endDate && v.endDate > v.startDate);
const isWholeCruise = (v: EventView) =>
  v.type === "Kreuzfahrt" && (v.details.entryKind === "Reise" || (v.details.entryKind == null && isMultiDay(v)));
/** Hat das Ereignis einen eigenen Beginn- und Ende-Zeitpunkt an verschiedenen Tagen (Check-in/Check-out)? */
const hasEndMoment = (v: EventView) => isMultiDay(v) && v.type !== "Kreuzfahrt";

export function dayRoleOn(v: EventView, date: string): DayRole {
  if (isWholeCruise(v)) return "middle";
  if (v.type === "Kreuzfahrt" || !isMultiDay(v)) return "single";
  if (date <= v.startDate!) return "start";
  if (date >= v.endDate!) return "end";
  return "middle";
}

/** `dayRole`, `displayTime`, `displayLabel` (Katalog: `startLabel` bei start, `endLabel` bei end). */
export function dayInfo(v: EventView, date: string): DayInfo {
  const role = dayRoleOn(v, date);
  const type = getCatalog().type(v.type);
  if (role === "single") return { dayRole: role, displayTime: v.startTime ?? null, displayLabel: null };
  if (role === "start") return { dayRole: role, displayTime: v.startTime ?? null, displayLabel: type?.startLabel || null };
  if (role === "end") return { dayRole: role, displayTime: v.endTime ?? null, displayLabel: type?.endLabel || null };
  const middle =
    v.type === "Visum" ? "Gültig" : v.type === "Versicherung" ? "Versichert" : type?.color === "stay" ? "Aufenthalt" : "Unterwegs";
  return { dayRole: role, displayTime: null, displayLabel: middle };
}

const withDay = (v: EventView, date: string) => ({ ...v, ...dayInfo(v, date) });

function eventsOfDate(timed: Timed[], date: string) {
  const entries = timed
    .filter((t) => covers(t.view, date))
    .map((t) => {
      const info = dayInfo(t.view, date);
      // Sortierzeitpunkt = angezeigtes Ende (absolut, damit Zonen stimmen); ohne Uhrzeit vor den Zeitpunkten,
      // `middle` gruppiert unten.
      const ms = info.dayRole === "end" ? t.endMs : t.startMs;
      const group = info.dayRole === "middle" ? 2 : info.displayTime == null ? 0 : 1;
      return { t, info, group, ms: group === 1 ? ms ?? 0 : 0 };
    });
  return entries
    .sort((a, b) => a.group - b.group || a.ms - b.ms || a.t.view.sortKey - b.t.view.sortKey || a.t.view.id - b.t.view.id)
    .map((e) => ({ ...e.t.view, ...e.info }));
}

/** Nächster Zeitpunkt eines Ereignisses ab `nowMs`: Beginn, bei mehrtägigen auch das Ende (Check-out). */
function nextMoment(t: Timed, nowMs: number, withShortOngoing = false): { ms: number; date: string } | null {
  const v = t.view;
  if (t.startMs == null || v.type === "Aufgabe") return null;
  if (t.startMs >= nowMs) return { ms: t.startMs, date: v.startDate! };
  if (t.endMs != null && t.endMs >= nowMs) {
    if (hasEndMoment(v)) return { ms: t.endMs, date: v.endDate! };
    // kurze, gerade laufende Ereignisse (Flug unterwegs) – nur für die Zusammenfassung
    if (withShortOngoing && t.endMs - t.startMs < 24 * 3_600_000) return { ms: t.endMs, date: v.startDate! };
  }
  return null;
}

function dayCountOf(trip: TripRow, timed: Timed[]): number | null {
  const last =
    trip.end_date ??
    timed
      .map((t) => t.view.endDate ?? t.view.startDate)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ??
    null;
  return trip.start_date && last ? diffDays(trip.start_date, last) + 1 : null;
}

function tripBrief(db: Db, trip: TripRow, timed: Timed[], date: string) {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    dayIndex: trip.start_date ? diffDays(trip.start_date, date) + 1 : null,
    dayCount: dayCountOf(trip, timed),
    coverUrl: T.tripCoverUrl(db, trip.id),
    timezone: trip.timezone,
  };
}

function ledgerBalance(db: Db, user: AuthUser, tripId: number) {
  // Mitreisende mit Konto dürfen die Reisekasse ihrer Reise lesen (auth/roles.ts); der Zugriff auf die Reise
  // ist durch die Aufrufer geprüft (`assertTripAccess` bzw. `myTripRows`).
  const ledgerId = T.ledgerIdOfTrip(db, tripId);
  if (ledgerId == null) return null;
  const ledger = L.getLedger(db, ledgerId);
  const mine = db.prepare("SELECT id FROM participants WHERE ledger_id = ? AND user_id = ?").get(ledgerId, user.id) as
    | { id: number }
    | undefined;
  const balances = L.participantBalances(db, ledgerId);
  return {
    id: ledgerId,
    title: ledger.title,
    currency: ledger.base_currency,
    balanceMinor: mine ? balances.find((b) => b.memberId === mine.id)?.netMinor ?? 0 : 0,
    myMemberId: mine?.id ?? null,
    balances,
  };
}

/** Frist-Einträge: Stornofristen und offene Zahlungen in den nächsten Tagen. */
function deadlinesOf(views: EventView[], date: string) {
  const until = addDays(date, LOOKAHEAD_DAYS);
  const out: Array<{ eventId: number; title: string; kind: "cancel" | "payment"; date: string }> = [];
  for (const v of views) {
    if (v.cancelUntil && v.cancelUntil >= date && v.cancelUntil <= until) {
      out.push({ eventId: v.id, title: v.title, kind: "cancel", date: v.cancelUntil });
    }
    // Zahlung: offener Betrag (offen/Anzahlung) wird spätestens mit dem Beginn fällig.
    if (v.priceMinor && (v.paymentStatus === "open" || v.paymentStatus === "deposit") && v.startDate && v.startDate >= date && v.startDate <= until) {
      out.push({ eventId: v.id, title: v.title, kind: "payment", date: v.startDate });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.eventId - b.eventId);
}

function tasksOf(views: EventView[], date: string) {
  const until = addDays(date, 7);
  return views
    .filter((v) => v.type === "Aufgabe" && v.details.done !== true && (!v.startDate || v.startDate <= until))
    .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.id - b.id)
    .slice(0, MAX_TASKS)
    .map((v) => ({ eventId: v.id, title: v.title, dueDate: v.startDate }));
}

/** Inhalt von `GET /v1/today` und `GET /v1/trips/:id/day/:date`, wenn eine Reise feststeht. */
function dayPayload(db: Db, user: AuthUser, trip: TripRow, date: string, zone: string, nowMs: number, now: Date) {
  const views = T.eventViews(db, trip, { withTitles: user.isAdmin, withMedia: true });
  const timed = timeline(views, trip.timezone);
  const upcoming = timed
    .map((t) => ({ t, m: nextMoment(t, nowMs) }))
    .filter((x): x is { t: Timed; m: { ms: number; date: string } } => x.m != null)
    .sort((a, b) => a.m.ms - b.m.ms || a.t.view.sortKey - b.t.view.sortKey);
  const next = upcoming[0] ?? null;
  const local = localDateTime(nowMs, zone);
  return {
    generatedAt: now.toISOString(),
    trip: tripBrief(db, trip, timed, date),
    date,
    now: { local: local.time, tz: zone },
    next: next ? withDay(next.t.view, next.m.date) : null,
    nextInSeconds: next ? Math.max(0, Math.round((next.m.ms - nowMs) / 1000)) : null,
    events: eventsOfDate(timed, date),
    tomorrow: eventsOfDate(timed, addDays(date, 1)),
    tasks: tasksOf(views, date),
    deadlines: deadlinesOf(views, date),
    review: T.needsReviewCount(db, trip.id),
    ledger: ledgerBalance(db, user, trip.id),
  };
}

/** `GET /v1/trips/:id/day/:date`: gleiche Form wie «Heute», aber für eine feste Reise und ein festes Datum. */
export function dayView(db: Db, user: AuthUser, p: { tripId: number; date: string; now: Date; tz?: string | null }) {
  const trip = T.assertTripAccess(db, user, p.tripId);
  const views = T.eventViews(db, trip, { withComments: false });
  const zone = p.tz && isValidTimeZone(p.tz) ? p.tz : currentZone(trip, timeline(views, trip.timezone), p.now.getTime());
  return dayPayload(db, user, trip, p.date, zone, p.now.getTime(), p.now);
}

/** `GET /v1/today?date=&tz=`. */
export function todayView(db: Db, user: AuthUser, p: { date?: string | null; tz?: string | null; tripId?: number | null; now: Date }) {
  const { now } = p;
  const nowMs = now.getTime();
  if (p.tz != null && p.tz !== "" && !isValidTimeZone(p.tz)) {
    throw new HttpError(400, "bad_request", "tz ist keine gültige Zeitzone (IANA, z. B. Europe/Zurich)");
  }
  if (p.date != null && p.date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    throw new HttpError(400, "bad_request", "date erwartet YYYY-MM-DD");
  }
  const tzParam = p.tz || null;
  const dateParam = p.date || null;
  const pinned = p.tripId != null ? T.assertTripAccess(db, user, p.tripId) : null;
  const trips = pinned ? [pinned] : T.myTripRows(db, user).filter((t) => t.start_date);
  const provisional = dateParam ?? todayLocal(now, tzParam ?? appTimeZone());

  // Reise, die an diesem Datum läuft; bei Zonenwechsel am Tagesrand ± 1 Tag Toleranz.
  const spans = (t: TripRow, slack: number) =>
    Boolean(t.start_date) && addDays(t.start_date!, -slack) <= provisional && provisional <= addDays(t.end_date ?? t.start_date!, slack);
  const pool = pinned
    ? [pinned]
    : trips.some((t) => spans(t, 0)) ? trips.filter((t) => spans(t, 0)) : trips.filter((t) => spans(t, 1));
  const trip = pool.sort((a, b) => b.start_date!.localeCompare(a.start_date!) || b.id - a.id)[0] ?? null;

  if (!trip) {
    const upcoming = trips
      .filter((t) => t.start_date && t.start_date > provisional)
      .sort((a, b) => a.start_date!.localeCompare(b.start_date!) || a.id - b.id)[0];
    return {
      generatedAt: now.toISOString(),
      trip: null,
      date: provisional,
      now: { local: localDateTime(nowMs, tzParam ?? appTimeZone()).time, tz: tzParam ?? appTimeZone() },
      next: null,
      nextInSeconds: null,
      events: [],
      tomorrow: [],
      tasks: [],
      deadlines: [],
      review: 0,
      ledger: null,
      upcoming: upcoming
        ? { id: upcoming.id, title: upcoming.title, startDate: upcoming.start_date, daysUntil: diffDays(provisional, upcoming.start_date!) }
        : null,
    };
  }
  const views = T.eventViews(db, trip, { withComments: false });
  const zone = tzParam ?? currentZone(trip, timeline(views, trip.timezone), nowMs);
  const date = dateParam ?? todayLocal(now, zone);
  return dayPayload(db, user, trip, date, zone, nowMs, now);
}

/* ───────────── Zusammenfassung (Widgets) ───────────── */

const COLOR_HEX: Record<string, string> = {
  air: "#D8452B", ship: "#1F4E5F", stay: "#B48A2B", car: "#5B8C5A", rail: "#3C6E8F", transfer: "#7A5C99",
  activity: "#C46A2D", food: "#A8433F", ticket: "#8A6F9E", safety: "#3F7A8C", doc: "#6F675A", task: "#6F675A",
};

const NEXT_EVENTS = 6;

/** «Von»/«Nach» für Strecken (Flug, Zug, Transfer, Mietauto); sonst die Katalog-Angaben des Typs. */
function summaryFor(cat: ReturnType<typeof getCatalog>, type: string, details: Record<string, unknown>) {
  const str = (k: string) => (typeof details[k] === "string" && (details[k] as string).trim() ? (details[k] as string).trim() : null);
  const from = str("departureAirport") ?? str("originPlace") ?? str("pickupPlace");
  const to = str("arrivalAirport") ?? str("destinationPlace") ?? str("returnPlace");
  const routeKeys = new Set(["departureAirport", "arrivalAirport", "originPlace", "destinationPlace", "pickupPlace", "returnPlace"]);
  const t = cat.type(type);
  const rest = t
    ? cat
        .summaryRows(type, Object.fromEntries(Object.entries(details).filter(([k]) => !routeKeys.has(k))))
    : [];
  const route: Array<{ label: string; value: string }> = [];
  if (from) route.push({ label: "Von", value: from });
  if (to) route.push({ label: "Nach", value: to });
  return [...route, ...rest];
}

export function summaryView(db: Db, user: AuthUser, now: Date, opts: { tripId?: number | null } = {}) {
  const nowMs = now.getTime();
  const cat = getCatalog();
  const pinned = opts.tripId != null ? T.assertTripAccess(db, user, opts.tripId) : null;
  const trips = T.myTripRows(db, user).filter((t) => t.start_date || t.end_date);
  const phaseOf = (t: TripRow) => T.tripPhase(t, now);
  const active = pinned
    ? phaseOf(pinned) === "active" ? pinned : null
    : trips.filter((t) => phaseOf(t) === "active").sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? "") || b.id - a.id)[0] ?? null;
  const nextTrip = pinned
    ? phaseOf(pinned) === "upcoming" ? pinned : null
    : trips
        .filter((t) => phaseOf(t) === "upcoming" && t.start_date)
        .sort((a, b) => a.start_date!.localeCompare(b.start_date!) || a.id - b.id)[0] ?? null;
  // Eine gewählte Reise, die schon vorbei ist, wird trotzdem gezeigt (als nextTrip-Platz mit phase «past»).
  const focus = active ?? nextTrip ?? pinned;

  const brief = (t: TripRow | null) =>
    t
      ? {
          id: t.id,
          title: t.title,
          destination: t.destination,
          startDate: t.start_date,
          endDate: t.end_date,
          phase: phaseOf(t),
          timezone: t.timezone,
          ledgerId: T.ledgerIdOfTrip(db, t.id),
          coverUrl: T.tripCoverUrl(db, t.id),
          needsReviewCount: T.needsReviewCount(db, t.id),
        }
      : null;

  let nextEvents: Array<Record<string, unknown>> = [];
  let today: { date: string; dayIndex: number | null; dayCount: number | null };
  let ledger: ReturnType<typeof ledgerBalance> | undefined;
  if (focus) {
    const views = T.eventViews(db, focus, { withComments: false });
    const timed = timeline(views, focus.timezone);
    const isActive = phaseOf(focus) === "active";
    const zone = isActive ? currentZone(focus, timed, nowMs) : focus.timezone;
    const date = todayLocal(now, zone);
    today = {
      date,
      dayIndex: isActive && focus.start_date ? diffDays(focus.start_date, date) + 1 : null,
      dayCount: dayCountOf(focus, timed),
    };
    nextEvents = timed
      .map((t) => ({ t, m: nextMoment(t, nowMs, true) }))
      .filter((x): x is { t: Timed; m: { ms: number; date: string } } => x.m != null)
      .sort((a, b) => a.m.ms - b.m.ms || a.t.view.sortKey - b.t.view.sortKey)
      .slice(0, NEXT_EVENTS)
      .map(({ t, m }) => {
        const v = t.view;
        const type = cat.type(v.type);
        return {
          id: v.id,
          tripId: v.tripId,
          type: v.type,
          title: v.title,
          startDate: v.startDate,
          startTime: v.startTime,
          startTz: v.startTz ?? focus.timezone,
          endDate: v.endDate ?? v.startDate,
          endTime: v.endTime,
          endTz: v.endTz ?? v.startTz ?? focus.timezone,
          location: v.location,
          address: v.address,
          lat: v.lat,
          lon: v.lon,
          provider: v.provider,
          bookingReference: v.bookingReference,
          icon: type?.icon ?? "map",
          color: type?.color ?? "activity",
          colorHex: COLOR_HEX[type?.color ?? "activity"] ?? "#6F675A",
          status: v.status,
          summary: summaryFor(cat, v.type, v.details),
          ...dayInfo(v, m.date),
        };
      });
    ledger = ledgerBalance(db, user, focus.id);
  } else {
    today = { date: todayLocal(now), dayIndex: null, dayCount: null };
  }
  return {
    generatedAt: now.toISOString(),
    activeTrip: brief(active),
    nextTrip: brief(nextTrip ?? (active ? null : pinned && !nextTrip ? pinned : null)),
    nextEvents,
    today,
    ...(ledger ? { ledger: { ...ledger, tripId: focus!.id } } : {}),
  };
}
