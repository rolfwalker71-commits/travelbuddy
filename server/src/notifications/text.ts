/**
 * Texte der Mitteilungen: Deutsch, Schweizer Rechtschreibung (nie «ß»), Datum `dd.mm.yyyy`, Zeit `hh:mm` (24 h).
 * Die Apps formatieren zusätzlich nach (`NotificationText.format`), die Nutzlast ist aber schon vollständig.
 */
import { displayDate } from "../lib/dates";
import { isValidTimeZone, localDateTime } from "../lib/tz";

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** Nie «ß»: Schweizer Rechtschreibung gilt auch für Texte, die aus Daten stammen. */
export const swiss = (s: string): string => s.replace(/ß/g, "ss").replace(/ẞ/g, "SS");

/** `2026-10-25` → `25.10.2026`. */
export const dateDe = (iso: string): string => displayDate(iso);

/** `7:05` / `07:05:30` → `07:05`. Ungültiges bleibt unverändert. */
export function timeDe(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : t;
}

/** `2026-10-25` → `Sonntag`. */
export function weekdayDe(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** `Sonntag, 25.10.2026` */
export const weekdayDateDe = (iso: string): string => `${weekdayDe(iso)}, ${dateDe(iso)}`;

/** `25.10.2026 17:00` aus einem UTC-Zeitpunkt in der Zone. */
export function dateTimeDe(utcMs: number, tz: string): string {
  const l = localDateTime(utcMs, isValidTimeZone(tz) ? tz : "UTC");
  return `${dateDe(l.date)} ${l.time}`;
}

/** UTC-ISO ohne Millisekunden (`2026-10-25T15:00:00Z`): So liest es `ISO8601DateFormatter` der Apps. */
export const isoUtc = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** «in 3 Stunden», «in 1 Stunde», «in 30 Minuten», «in 2 Tagen». */
export function inPhrase(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "jetzt";
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) {
    if (hours >= 48 && hours % 24 === 0) return `in ${hours / 24} Tagen`;
    return `in ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  }
  return `in ${hours} ${hours === 1 ? "Stunde" : "Stunden"} ${rest} Minuten`;
}

/** «in 3 Tagen», «morgen», «heute». */
export function daysPhrase(days: number): string {
  if (days <= 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

/** Text kürzen (an Wortgrenze, mit «…»). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max / 2 ? head.slice(0, cut) : head).trimEnd()}…`;
}

/** Zeilen mit « · » verbinden, Leeres weglassen. */
export const joinDot = (parts: Array<string | null | undefined | false>): string =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" · ");
