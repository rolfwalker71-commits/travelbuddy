/**
 * Zeitzonen-Rechnung ohne Fremdbibliothek (Intl genügt): Ortszeit einer IANA-Zone <-> UTC-Zeitpunkt.
 * Ereignisse speichern Datum und Uhrzeit in Ortszeit plus Zone (`start_tz`/`end_tz`); für Vergleiche
 * («was kommt als Nächstes?») braucht es den absoluten Zeitpunkt.
 */

const validCache = new Map<string, boolean>();

export function isValidTimeZone(tz: string): boolean {
  const hit = validCache.get(tz);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    if (tz && /^[A-Za-z0-9_+\-/]+$/.test(tz)) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = true;
    }
  } catch {
    ok = false;
  }
  validCache.set(tz, ok);
  return ok;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
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

/** Ortszeit-Bestandteile eines UTC-Zeitpunkts in der Zone. */
export function localParts(utcMs: number, tz: string): { date: string; time: string; y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = fmt(tz).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = g("year"), m = g("month"), d = g("day"), h = g("hour") % 24, min = g("minute"), s = g("second");
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { date: `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}`, time: `${p2(h)}:${p2(min)}`, y, m, d, h, min, s };
}

/** Abstand der Zone zu UTC (Minuten, Osten positiv) zu einem UTC-Zeitpunkt. */
export function offsetMinutes(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** UTC-Zeitpunkt (ms) einer Ortszeit `YYYY-MM-DD` + `HH:mm` in der Zone. Lücken (Sommerzeit) rücken vor. */
export function zonedToUtcMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, h, mi, 0);
  const off1 = offsetMinutes(naive, tz);
  let t = naive - off1 * 60_000;
  const off2 = offsetMinutes(t, tz);
  if (off2 !== off1) t = naive - off2 * 60_000;
  return t;
}

/** Datum (`YYYY-MM-DD`) und Uhrzeit (`HH:mm`) eines Zeitpunkts in der Zone. */
export function localDateTime(utcMs: number, tz: string): { date: string; time: string } {
  const p = localParts(utcMs, tz);
  return { date: p.date, time: p.time };
}
