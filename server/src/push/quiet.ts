/**
 * Ruhezeiten: Unkritische Mitteilungen werden nachts nicht gesendet, sondern verschoben.
 *
 * Als unkritisch gelten `trip.today`, `trip.deadline`, `trip.review`, `trip.comment`, `ledger.expense`,
 * `ledger.settlement` und die frühe Abflug-Vorankündigung (24 h). Abflug-Erinnerungen (3 h, 1 h, Check-in,
 * Boarding), `trip.pickup` und `trip.stay` sind zeitkritisch und gehen immer sofort.
 *
 * Ortszeit: Zone der Reise, in der sich die Reisenden gerade befinden (wie «Heute»); Meldungen ohne Reise nutzen
 * die Zone des Servers (`TRAVELBUDDY_TZ`).
 */
import type { Db } from "../db/client";
import { appTimeZone } from "../lib/dates";
import { isValidTimeZone, localDateTime } from "../lib/tz";
import * as T from "../trips/service";
import { currentZone, timeline } from "../trips/today";
import type { Notice, NotificationKind, Prefs } from "./notifier";

export type QuietMode = "skip" | "queue";

/** `skip`: nicht senden, die Planung liefert sie später erneut; `queue`: vormerken und nach der Ruhezeit senden. */
const KIND_DEFAULT: Partial<Record<NotificationKind, QuietMode>> = {
  "trip.today": "skip",
  "trip.deadline": "skip",
  "trip.review": "queue",
  "trip.comment": "queue",
  "ledger.expense": "queue",
  "ledger.settlement": "queue",
};

/** Wie mit der Meldung in der Ruhezeit zu verfahren ist; `false` = immer sofort. */
export function quietModeOf(n: Pick<Notice, "kind" | "quiet">): QuietMode | false {
  if (n.quiet !== undefined) return n.quiet;
  return KIND_DEFAULT[n.kind] ?? false;
}

/** Liegt `time` (HH:mm) in der Ruhezeit `[from, to)`? Über Mitternacht und gleiche Grenzen (= nie) werden behandelt. */
export function inQuietWindow(time: string, from: string, to: string): boolean {
  if (from === to) return false;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

/** Zone, in der die Reisenden der Reise zum Zeitpunkt `nowMs` sind. */
export function quietZone(db: Db, tripId: number | undefined, nowMs: number): string {
  const fallback = isValidTimeZone(appTimeZone()) ? appTimeZone() : "Europe/Zurich";
  if (tripId == null) return fallback;
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as T.TripRow | undefined;
  if (!trip) return fallback;
  const base = isValidTimeZone(trip.timezone) ? trip.timezone : fallback;
  const hasZones = db
    .prepare("SELECT 1 FROM trip_events WHERE trip_id = ? AND (start_tz IS NOT NULL OR end_tz IS NOT NULL) LIMIT 1")
    .get(tripId);
  if (!hasZones) return base;
  const views = T.eventViews(db, { ...trip, timezone: base }, { withComments: false });
  return currentZone({ timezone: base }, timeline(views, base), nowMs);
}

/** Ob die Meldung jetzt verschoben werden muss, und wie. `null` = jetzt senden. */
export function quietDeferral(db: Db, n: Pick<Notice, "kind" | "quiet" | "tripId">, prefs: Prefs, nowMs: number): QuietMode | null {
  const q = prefs.quietHours;
  if (!q.enabled) return null;
  const mode = quietModeOf(n);
  if (!mode) return null;
  const zone = quietZone(db, n.tripId, nowMs);
  const time = localDateTime(nowMs, zone).time;
  return inQuietWindow(time, q.from, q.to) ? mode : null;
}
