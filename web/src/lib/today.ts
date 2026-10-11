/**
 * Aufbereitung für den Heute-Modus: Countdown, Ring, Tagesband (Check-in, Boarding, Abfahrt, Puffer).
 * Alle Zeitangaben sind Ortszeiten mit Zone; gerechnet wird über UTC.
 */
import type { TodayState, TripEvent } from "../api/types";
import { daysBetween } from "./dates";
import { effectiveZone, offsetMinutes, zonedToUtc } from "./timezones";

/* ─ Countdown ─ */

export function liveSeconds(state: Pick<TodayState, "nextInSeconds" | "generatedAt">, nowMs: number): number | null {
  if (state.nextInSeconds == null) return null;
  const gen = Date.parse(state.generatedAt);
  const elapsed = Number.isFinite(gen) ? Math.max(0, (nowMs - gen) / 1000) : 0;
  return Math.round(state.nextInSeconds - elapsed);
}

export type Countdown = { value: string; unit: string; text: string; past: boolean };

/** «1:40 Std.», «12 Min.», «3 Tage»; bereits begonnen: «läuft». */
export function countdown(seconds: number | null): Countdown | null {
  if (seconds == null) return null;
  if (seconds <= 0) return { value: "Jetzt", unit: "", text: "läuft jetzt", past: true };
  const min = Math.ceil(seconds / 60);
  if (min < 60) return { value: String(Math.max(1, min)), unit: "Min.", text: `in ${Math.max(1, min)} Min.`, past: false };
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const m = min % 60;
    return { value: `${hours}:${String(m).padStart(2, "0")}`, unit: "Std.", text: `in ${hours} Std. ${m} Min.`, past: false };
  }
  const days = Math.floor(hours / 24);
  return { value: String(days), unit: days === 1 ? "Tag" : "Tage", text: `in ${days} ${days === 1 ? "Tag" : "Tagen"}`, past: false };
}

/** Füllgrad des Rings: je näher der Termin, desto voller (Horizont 6 Stunden). */
export function ringProgress(seconds: number | null, horizonSeconds = 6 * 3600): number {
  if (seconds == null) return 0;
  if (seconds <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - seconds / horizonSeconds));
}

/* ─ Tagesband ─ */

export type BandKind = "checkin" | "boarding" | "event" | "buffer" | "point";
export type BandItem = {
  id: string;
  kind: BandKind;
  /** Minuten ab Mitternacht des Tages in Reisezeit. */
  from: number;
  to: number | null;
  label: string;
  color: string;
  eventId: number | null;
};
export type DayBand = { from: number; to: number; items: BandItem[]; hours: number[] };

const detail = (e: TripEvent, k: string): string => {
  const v = e.details?.[k];
  return v == null || typeof v === "object" ? "" : String(v);
};

/** Minuten ab Mitternacht von `date` in Reisezeit für eine Ortszeit mit Zone. */
export function minutesOnDay(date: string, time: string, tz: string, dayDate: string, tripTz: string): number | null {
  const utc = zonedToUtc(date, time, tz);
  if (!utc) return null;
  const tripLocal = utc.getTime() + offsetMinutes(tripTz, utc) * 60000;
  const [y, m, d] = dayDate.split("-").map(Number) as [number, number, number];
  return Math.round((tripLocal - Date.UTC(y, m - 1, d)) / 60000);
}

export function fmtMin(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h}:${String(m).padStart(2, "0")} Std.`;
}

/**
 * Band eines Tages. Flug: Check-in-Fenster, Boarding bis Abflug, Flug; Kreuzfahrt: «Alle an Bord»;
 * Hotel: Check-in und Check-out als Punkte; sonst Beginn (bis Ende). Dazwischen Pufferzeiten.
 */
export function buildDayBand(events: TripEvent[], dayDate: string, tripTz: string, colorOf: (e: TripEvent) => string): DayBand | null {
  const items: BandItem[] = [];
  const at = (date: string | null, time: string | null | undefined, tz: string): number | null =>
    date && time ? minutesOnDay(date, time, tz, dayDate, tripTz) : null;

  for (const e of events) {
    const sz = effectiveZone(e.startTz, tripTz);
    const ez = effectiveZone(e.endTz, tripTz);
    const color = colorOf(e);
    const start = at(e.startDate, e.startTime, sz);
    const end = at(e.endDate ?? e.startDate, e.endTime, ez);
    const base = { color, eventId: e.id };
    if (e.type === "Flug") {
      const ciOpen = at(e.startDate, detail(e, "checkInOpens"), sz);
      const ciClose = at(e.startDate, detail(e, "checkInCloses"), sz);
      const board = at(e.startDate, detail(e, "boardingTime"), sz);
      if (ciOpen != null) items.push({ ...base, id: `ci-${e.id}`, kind: "checkin", from: ciOpen, to: ciClose ?? start ?? ciOpen + 30, label: "Check-in" });
      if (board != null && start != null && board < start) items.push({ ...base, id: `bd-${e.id}`, kind: "boarding", from: board, to: start, label: "Boarding" });
      if (start != null) items.push({ ...base, id: `ev-${e.id}`, kind: "event", from: start, to: end != null && end > start ? end : null, label: e.title });
      continue;
    }
    if (e.type === "Kreuzfahrt") {
      const aboard = at(e.startDate, detail(e, "allAboard"), sz);
      if (start != null) items.push({ ...base, id: `ev-${e.id}`, kind: "event", from: start, to: end != null && end > start ? end : null, label: e.title });
      if (aboard != null) items.push({ ...base, id: `ab-${e.id}`, kind: "point", from: aboard, to: null, label: "Alle an Bord" });
      continue;
    }
    if (e.type === "Hotel" || e.type === "Unterkunft") {
      const ci = at(e.startDate, detail(e, "checkInFrom") || e.startTime, sz);
      const co = at(e.endDate, detail(e, "checkOutUntil") || e.endTime, ez);
      if (ci != null) items.push({ ...base, id: `hi-${e.id}`, kind: "point", from: ci, to: null, label: `Check-in ${e.title}` });
      if (co != null) items.push({ ...base, id: `ho-${e.id}`, kind: "point", from: co, to: null, label: `Check-out ${e.title}` });
      continue;
    }
    if (start != null) items.push({ ...base, id: `ev-${e.id}`, kind: "event", from: start, to: end != null && end > start && end - start < 1440 ? end : null, label: e.title });
  }

  // Nur, was auf diesen Tag fällt (0..1440 mit etwas Rand)
  const onDay = items.filter((i) => i.from >= -60 && i.from <= 1500);
  if (onDay.length === 0) return null;
  onDay.sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));

  // Puffer zwischen aufeinanderfolgenden Blöcken (ab dem Ende des vorherigen)
  const buffers: BandItem[] = [];
  let cursor: number | null = null;
  for (const i of onDay) {
    const endOf = i.to ?? i.from;
    if (cursor != null && i.from - cursor >= 20 && i.kind !== "point") {
      buffers.push({ id: `bf-${cursor}-${i.from}`, kind: "buffer", from: cursor, to: i.from, label: `Puffer ${fmtDuration(i.from - cursor)}`, color: "var(--mute)", eventId: null });
    }
    if (cursor == null || endOf > cursor) cursor = endOf;
  }

  const all = [...onDay, ...buffers].sort((a, b) => a.from - b.from);
  const minFrom = Math.min(...all.map((i) => i.from));
  const maxTo = Math.max(...all.map((i) => i.to ?? i.from));
  let from = Math.floor((minFrom - 30) / 60) * 60;
  let to = Math.ceil((maxTo + 30) / 60) * 60;
  if (to - from < 360) {
    const extra = 360 - (to - from);
    from -= Math.floor(extra / 120) * 60;
    to = from + Math.max(360, to - from);
  }
  from = Math.max(from, -120);
  const hours: number[] = [];
  for (let h = Math.ceil(from / 60) * 60; h <= to; h += 60) hours.push(h);
  return { from, to, items: all, hours };
}

/* ─ Tag ─ */

/** «Tag 3 von 29» oder `null`. */
export function dayLabel(trip: { dayIndex: number; dayCount: number } | null): string | null {
  if (!trip || trip.dayCount <= 0) return null;
  return `Tag ${trip.dayIndex} von ${trip.dayCount}`;
}

/** Tage bis zum Reisebeginn (negativ: bereits begonnen). */
export function daysUntil(startDate: string, today: string): number {
  return daysBetween(today, startDate);
}

/** Minuten ab Mitternacht in Zone `tz` zum Zeitpunkt `nowMs`. */
export function localMinutes(tz: string, nowMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return (h % 24) * 60 + m;
  } catch {
    const d = new Date(nowMs);
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** Ortszeit «hh:mm» in Zone `tz`. */
export function localClock(tz: string, nowMs: number): string {
  return fmtMin(localMinutes(tz, nowMs));
}

/** Ereignisse des Tages: vergangene (Ende vor jetzt), laufende, kommende. */
export function splitByNow(events: TripEvent[], nowMin: number): { past: TripEvent[]; rest: TripEvent[] } {
  const past: TripEvent[] = [];
  const rest: TripEvent[] = [];
  for (const e of events) {
    const end = e.endTime ?? e.startTime;
    const endMin = end ? Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) : null;
    // Ereignisse über mehrere Tage gelten nie als vergangen
    const multi = e.endDate && e.startDate && e.endDate !== e.startDate;
    if (!multi && endMin != null && endMin < nowMin - 30 && e.startTime) past.push(e);
    else rest.push(e);
  }
  return { past, rest };
}
