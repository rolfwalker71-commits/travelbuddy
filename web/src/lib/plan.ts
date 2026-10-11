/** Plan einer Reise: Ereignisse nach Tagen, Sortierung, Tauschen innerhalb gleicher Zeit. */
import type { TripEvent } from "../api/types";
import { daysBetween, eventSortKey, isValidIsoDate } from "./dates";

export type DayGroup = { date: string | null; events: TripEvent[] };

export function compareEvents(a: TripEvent, b: TripEvent): number {
  const ka = eventSortKey(a.startDate, a.startTime);
  const kb = eventSortKey(b.startDate, b.startTime);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.sortKey - b.sortKey || a.id - b.id;
}

/** Nach Starttag gruppiert, Tage aufsteigend, «Ohne Datum» zuletzt. */
export function groupEventsByDay(events: TripEvent[]): DayGroup[] {
  const sorted = [...events].sort(compareEvents);
  const out: DayGroup[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === e.startDate) last.events.push(e);
    else out.push({ date: e.startDate, events: [e] });
  }
  return out;
}

/** Nur mit einem Nachbarn tauschen, der zur selben Zeit beginnt: sonst entscheidet die Uhrzeit. */
export function canSwap(a: TripEvent | undefined, b: TripEvent | undefined): boolean {
  if (!a || !b) return false;
  return a.startDate === b.startDate && a.startTime === b.startTime;
}

/** Neue Gesamtreihenfolge (IDs) nach dem Verschieben eines Ereignisses um eine Position. */
export function moveEvent(all: TripEvent[], eventId: number, dir: -1 | 1): number[] | null {
  const ordered = groupEventsByDay(all).flatMap((g) => g.events);
  const i = ordered.findIndex((e) => e.id === eventId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return null;
  if (!canSwap(ordered[i], ordered[j])) return null;
  const ids = ordered.map((e) => e.id);
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return ids;
}

export type TripSpan = { start: string; end: string; days: number };

/** Zeitraum der Reise: Reisedaten, sonst frühestes/spätestes Ereignis. */
export function tripSpan(trip: { startDate: string | null; endDate: string | null }, events: TripEvent[]): TripSpan | null {
  const dates: string[] = [];
  for (const d of [trip.startDate, trip.endDate]) if (d && isValidIsoDate(d)) dates.push(d);
  if (dates.length < 2) {
    for (const e of events) {
      for (const d of [e.startDate, e.endDate]) if (d && isValidIsoDate(d)) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Tage der Reise als ISO-Daten (höchstens `max`, damit eine fehlerhafte Reise die Seite nicht sprengt). */
export function listDays(span: TripSpan, max = 120): string[] {
  const out: string[] = [];
  const [y, m, d] = span.start.split("-").map(Number) as [number, number, number];
  for (let i = 0; i < Math.min(span.days, max); i++) {
    out.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  }
  return out;
}
