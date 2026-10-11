/**
 * Datum und Zeit: intern `YYYY-MM-DD` / `HH:mm` (wie die API), Anzeige `dd.mm.yyyy` / `hh:mm`.
 * Kalenderrechnung läuft über UTC, damit Zeitzonen und Sommerzeit nichts verschieben.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `2026-10-06` → `06.10.2026`. Unbekanntes bleibt unverändert, leer ergibt «–». */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Eingabe `6.10.2026`, `06.10.26`, `6/10/2026` → `2026-10-06`; ungültig → null. */
export function parseDisplayDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{2}|\d{4})\s*$/.exec(input);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (m[3]!.length === 2) y += 2000;
  const iso = `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Lokales Datum von heute als ISO (nicht UTC), z. B. für Vorgabewerte. */
export function todayIso(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function weekday(iso: string): string {
  if (!isValidIsoDate(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** «Dienstag, 06.10.2026» */
export function formatDayHeading(iso: string | null | undefined): string {
  if (!iso || !isValidIsoDate(iso)) return "Ohne Datum";
  return `${weekday(iso)}, ${formatDate(iso)}`;
}

/** `2026-10-06T16:30:00.000Z` (UTC) → `06.10.2026 18:30` in lokaler Zeit. */
export function formatTimestamp(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "–";
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${pad(d.getFullYear(), 4)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatClock(t: string | null | undefined): string {
  return t && CLOCK.test(t) ? t : "";
}

/** «06.10.2026 – 13.10.2026», «06.10.2026», «ab 06.10.2026», «bis 13.10.2026» oder «Ohne Datum». */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (start && end && start !== end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return end && end === start ? formatDate(start) : end ? formatDate(start) : `ab ${formatDate(start)}`;
  if (end) return `bis ${formatDate(end)}`;
  return "Ohne Datum";
}

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Ganze Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** «heute», «morgen», «in 5 Tagen», «vor 2 Tagen». */
export function relativeDays(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  if (n > 1) return `in ${n} Tagen`;
  return `vor ${-n} Tagen`;
}

/** Zeit-/Datums-Stempel zum Sortieren von Ereignissen. */
export function eventSortKey(date: string | null, time: string | null): string {
  return `${date ?? "9999-12-31"}T${time ?? "99:99"}`;
}

/** «9:30», «09.30», «0930», «930» → `09:30`; ungültig → null. */
export function parseClock(input: string): string | null {
  const s = input.trim();
  let h: string;
  let m: string;
  const sep = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  const compact = /^(\d{1,2})(\d{2})$/.exec(s);
  if (sep) [, h, m] = sep as unknown as [string, string, string];
  else if (compact) [, h, m] = compact as unknown as [string, string, string];
  else return null;
  const hh = Number(h);
  const mm = Number(m);
  if (hh > 23 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** «So 11.10.2026»: Wochentag kurz, Datum vollständig (Listen, Karten-Callouts). */
export function formatDateWithWeekday(iso: string | null | undefined): string {
  if (!iso || !isValidIsoDate(iso)) return formatDate(iso);
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${formatDate(iso)}`;
}

/**
 * «25.10.»: nur für Achsenbeschriftungen von Infografiken bei Platzmangel. Das Jahr muss dann im Titel oder
 * Untertitel der Grafik stehen (siehe `formatYearSpan`). In Listen, Überschriften und Karten nie verwenden.
 */
export function formatAxisDate(iso: string | null | undefined): string {
  if (!iso || !ISO_DATE.test(iso)) return "";
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/** «2026» oder «2026/2027»: Jahr(e) für den Untertitel einer Grafik mit Achsen ohne Jahr. */
export function formatYearSpan(from: string | null | undefined, to: string | null | undefined): string {
  const y1 = from && ISO_DATE.test(from) ? from.slice(0, 4) : "";
  const y2 = to && ISO_DATE.test(to) ? to.slice(0, 4) : "";
  if (y1 && y2 && y1 !== y2) return `${y1}/${y2}`;
  return y1 || y2;
}
