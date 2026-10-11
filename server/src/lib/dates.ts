/**
 * «Heute» ist ein Kalendertag in einer Zeitzone, nicht in UTC. Vorgabe ist die Zone des Servers
 * (`TRAVELBUDDY_TZ`, sonst Europe/Zurich); für Reisen gilt deren Zone (siehe `lib/tz.ts`).
 */
export function appTimeZone(): string {
  return process.env.TRAVELBUDDY_TZ || "Europe/Zurich";
}

export function todayLocal(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  // en-CA formatiert als YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `YYYY-MM-DD` plus Tage (reine Kalenderrechnung, ohne Zeitzone). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Ganze Tage von `a` bis `b` (b - a). */
export function diffDays(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** «25.10.2026» aus `2026-10-25` (Anzeige in Meldungen). */
export function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}
