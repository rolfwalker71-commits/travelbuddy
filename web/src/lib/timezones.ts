/**
 * Zeitzonen (IANA): Auswahlliste, Städtenamen, Vorbelegung aus Flughafen/Ort, Rechnung Ortszeit ↔ UTC.
 * Anzeige immer `hh:mm`; eine Zone wird nur genannt, wenn sie von der Reisezone abweicht («14:05 Ortszeit Miami»).
 */

export const COMMON_ZONES = [
  "Europe/Zurich",
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Copenhagen",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Helsinki",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Prague",
  "Europe/Warsaw",
  "Europe/Budapest",
  "Atlantic/Reykjavik",
  "Atlantic/Azores",
  "Atlantic/Canary",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Puerto_Rico",
  "America/St_Thomas",
  "America/Nassau",
  "America/Havana",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Casablanca",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
] as const;

let allCache: string[] | null = null;

/** Alle IANA-Zonen, die der Browser kennt (sonst die kuratierte Liste). */
export function allZones(): string[] {
  if (allCache) return allCache;
  let list: string[] = [];
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    list = f ? f("timeZone") : [];
  } catch {
    list = [];
  }
  const set = new Set<string>([...COMMON_ZONES, ...list]);
  allCache = [...set].sort((a, b) => a.localeCompare(b));
  return allCache;
}

export function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("de-CH", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `America/New_York` → «New York», `America/Argentina/Buenos_Aires` → «Buenos Aires». */
export function cityOf(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Versatz in Minuten gegenüber UTC zum Zeitpunkt `at` (Sommerzeit berücksichtigt). */
export function offsetMinutes(tz: string, at: Date): number {
  try {
    const parts = formatterFor(tz).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/** «UTC+02:00» */
export function offsetLabel(tz: string, at: Date = new Date()): string {
  const m = offsetMinutes(tz, at);
  const sign = m < 0 ? "−" : "+";
  const a = Math.abs(m);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** Beschriftung in der Auswahl: «Miami · America/New_York · UTC−04:00». */
export function zoneOptionLabel(tz: string, at: Date = new Date()): string {
  return `${cityOf(tz)} · ${tz} · ${offsetLabel(tz, at)}`;
}

/** Ortszeit (`YYYY-MM-DD`, `HH:mm`) in Zone `tz` → UTC-Zeitpunkt. */
export function zonedToUtc(date: string, time: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  if (!isValidZone(tz)) return new Date(naive);
  // Zweimal iterieren: der Versatz hängt vom Zeitpunkt ab (Sommerzeitwechsel).
  let guess = naive - offsetMinutes(tz, new Date(naive)) * 60000;
  guess = naive - offsetMinutes(tz, new Date(guess)) * 60000;
  return new Date(guess);
}

/** Dauer zwischen zwei Ortszeiten in Minuten (mit Zonen), `null`, wenn etwas fehlt. */
export function durationMinutes(
  from: { date: string | null; time: string | null; tz: string },
  to: { date: string | null; time: string | null; tz: string }
): number | null {
  if (!from.date || !from.time || !to.date || !to.time) return null;
  const a = zonedToUtc(from.date, from.time, from.tz);
  const b = zonedToUtc(to.date, to.time, to.tz);
  if (!a || !b) return null;
  const min = Math.round((b.getTime() - a.getTime()) / 60000);
  return min >= 0 ? min : null;
}

/** `14:05` oder `14:05 Ortszeit Miami`, wenn die Zone von der Reisezone abweicht. */
export function timeWithZone(time: string | null | undefined, tz: string | null | undefined, tripTz: string | null | undefined): string {
  if (!time) return "";
  if (!tz || !tripTz || tz === tripTz) return time;
  return `${time} Ortszeit ${cityOf(tz)}`;
}

/** Zone, die für ein Ereignis gilt: eigene Angabe, sonst die Zone der Reise. */
export function effectiveZone(tz: string | null | undefined, tripTz: string | null | undefined): string {
  return (tz && isValidZone(tz) ? tz : tripTz && isValidZone(tripTz) ? tripTz : "Europe/Zurich") as string;
}

/* ─ Vorbelegung ─ */

/** Häufige Flughäfen, damit die Vorbelegung auch ohne Server funktioniert. */
const AIRPORT_TZ: Record<string, string> = {
  ZRH: "Europe/Zurich",
  GVA: "Europe/Zurich",
  BSL: "Europe/Zurich",
  BRN: "Europe/Zurich",
  BCN: "Europe/Madrid",
  MAD: "Europe/Madrid",
  PMI: "Europe/Madrid",
  AGP: "Europe/Madrid",
  LIS: "Europe/Lisbon",
  OPO: "Europe/Lisbon",
  FCO: "Europe/Rome",
  MXP: "Europe/Rome",
  VCE: "Europe/Rome",
  CDG: "Europe/Paris",
  NCE: "Europe/Paris",
  LHR: "Europe/London",
  LGW: "Europe/London",
  DUB: "Europe/Dublin",
  AMS: "Europe/Amsterdam",
  FRA: "Europe/Berlin",
  MUC: "Europe/Berlin",
  BER: "Europe/Berlin",
  VIE: "Europe/Vienna",
  ATH: "Europe/Athens",
  IST: "Europe/Istanbul",
  MIA: "America/New_York",
  JFK: "America/New_York",
  EWR: "America/New_York",
  BOS: "America/New_York",
  ORD: "America/Chicago",
  LAX: "America/Los_Angeles",
  SFO: "America/Los_Angeles",
  MCO: "America/New_York",
  FLL: "America/New_York",
  SJU: "America/Puerto_Rico",
  DXB: "Asia/Dubai",
  BKK: "Asia/Bangkok",
  SIN: "Asia/Singapore",
  HND: "Asia/Tokyo",
  NRT: "Asia/Tokyo",
  SYD: "Australia/Sydney",
};

const learned = new Map<string, string>();

/** Vom Server gelieferte Flughafen-Zonen merken (für spätere Vorbelegung). */
export function rememberAirportZone(iata: string, tz: string): void {
  if (iata && isValidZone(tz)) learned.set(iata.toUpperCase(), tz);
}

export function airportZone(iata: string | null | undefined): string | null {
  if (!iata) return null;
  const k = iata.trim().toUpperCase();
  return learned.get(k) ?? AIRPORT_TZ[k] ?? null;
}

/**
 * Zonenvorschlag für ein Ereignis: Flug nach Flughafen, sonst Zone der Reise.
 * `null` heisst «Zone der Reise» (kein eigener Wert nötig).
 */
export function suggestZones(
  typeId: string,
  details: Record<string, unknown>,
  tripTz: string
): { startTz: string | null; endTz: string | null } {
  if (typeId === "Flug") {
    const dep = airportZone(String(details.departureAirport ?? ""));
    const arr = airportZone(String(details.arrivalAirport ?? ""));
    return {
      startTz: dep && dep !== tripTz ? dep : null,
      endTz: arr && arr !== tripTz ? arr : null,
    };
  }
  return { startTz: null, endTz: null };
}
