/**
 * iCalendar-Export (RFC 5545), portiert aus FamilyBrain. Abweichungen vom Altcode:
 * Zeilen werden nach UTF-8-Bytes gefaltet (nicht nach Zeichen), URL ist kein TEXT, und Ereignisse mit
 * Zeitzone (`startTz`/`endTz`) werden als UTC-Zeitpunkte (`…Z`) ausgegeben, damit sie in jedem Kalender
 * zur richtigen Ortszeit erscheinen (ohne VTIMEZONE-Blöcke).
 */
import { isValidTimeZone, zonedToUtcMs } from "../lib/tz";

export type CalendarEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // inklusiv
  startTime?: string; // HH:mm
  endTime?: string;
  /** IANA-Zone der Uhrzeiten; ohne Angabe werden «schwebende» Ortszeiten ausgegeben. */
  startTz?: string;
  endTz?: string;
  url?: string;
  categories?: string[];
  geo?: { lat: number; lon: number };
};

const pad = (n: number) => String(n).padStart(2, "0");

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** «17:00», «5:30 PM», «17.00» → { h, m } */
export function parseClockTime(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw?.trim()) return null;
  const s = raw.trim().toUpperCase().replace(/\./g, ":");
  const ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/.exec(s);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    if (ampm[3] === "PM" && h < 12) h += 12;
    if (ampm[3] === "AM" && h === 12) h = 0;
    return h > 23 || m > 59 ? null : { h, m };
  }
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!t) return null;
  const h = Number(t[1]);
  const m = Number(t[2]);
  return h > 23 || m > 59 ? null : { h, m };
}

function dateTimeValue(isoDate: string, time: string): string | null {
  const p = parseIsoDate(isoDate);
  const t = parseClockTime(time);
  return p && t ? `${p.y}${pad(p.m)}${pad(p.d)}T${pad(t.h)}${pad(t.m)}00` : null;
}

function dateValue(isoDate: string): string | null {
  const p = parseIsoDate(isoDate);
  return p ? `${p.y}${pad(p.m)}${pad(p.d)}` : null;
}

function exclusiveEnd(isoDate: string): string | null {
  const p = parseIsoDate(isoDate);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

const utcStamp = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

/** UTC-Wert einer Ortszeit in Zone, oder null (ungültige Eingaben oder Zone). */
function zonedValue(isoDate: string, time: string, tz: string | undefined): string | null {
  if (!tz || !isValidTimeZone(tz)) return null;
  const p = parseIsoDate(isoDate);
  const t = parseClockTime(time);
  if (!p || !t) return null;
  return utcStamp(zonedToUtcMs(`${p.y}-${pad(p.m)}-${pad(p.d)}`, `${pad(t.h)}:${pad(t.m)}`, tz));
}

function plusOneHour(isoDate: string, time: string): string | null {
  const p = parseIsoDate(isoDate);
  const t = parseClockTime(time);
  if (!p || !t) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d, t.h + 1, t.m));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
}

const escapeText = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** Faltet auf höchstens 75 Oktette je Zeile, ohne Mehrbyte-Zeichen zu zerteilen. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += b;
  }
  out.push(current);
  return out.join("\r\n");
}

function stamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

export function buildIcsCalendar(events: CalendarEvent[], opts: { now?: Date; prodId?: string } = {}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${opts.prodId ?? "-//TravelBuddy//CH//DE"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const dtstamp = stamp(opts.now ?? new Date());

  const extras = (e: CalendarEvent) => {
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, "")}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
    if (e.geo && Number.isFinite(e.geo.lat) && Number.isFinite(e.geo.lon)) {
      lines.push(`GEO:${e.geo.lat};${e.geo.lon}`);
    }
  };

  for (const e of events) {
    if (e.startTime && parseClockTime(e.startTime)) {
      const zoned = e.startTz && isValidTimeZone(e.startTz);
      const start = zoned ? zonedValue(e.startDate, e.startTime, e.startTz) : dateTimeValue(e.startDate, e.startTime);
      if (!start) continue;
      let end: string | null = null;
      if (e.endTime && parseClockTime(e.endTime)) {
        end = zoned
          ? zonedValue(e.endDate || e.startDate, e.endTime, e.endTz && isValidTimeZone(e.endTz) ? e.endTz : e.startTz)
          : dateTimeValue(e.endDate || e.startDate, e.endTime);
      }
      if (!end || end === start) {
        if (zoned) {
          const ms = Date.parse(start.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
          end = utcStamp(ms + 3_600_000);
        } else {
          end = plusOneHour(e.startDate, e.startTime);
        }
      }
      if (!end) continue;
      lines.push("BEGIN:VEVENT", `UID:${escapeText(e.uid)}`, `DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escapeText(e.title)}`);
      extras(e);
      lines.push("END:VEVENT");
      continue;
    }
    const start = dateValue(e.startDate);
    const end = exclusiveEnd(e.endDate || e.startDate);
    if (!start || !end) continue;
    lines.push("BEGIN:VEVENT", `UID:${escapeText(e.uid)}`, `DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${escapeText(e.title)}`);
    extras(e);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
