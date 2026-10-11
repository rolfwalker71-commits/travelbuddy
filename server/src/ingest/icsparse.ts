/**
 * iCalendar (`.ics`) lesen: Termine (VEVENT) → Text für die KI und deterministische Kandidaten.
 * Zeiten mit `TZID` bleiben Ortszeit der Zone; UTC-Zeiten (`…Z`) werden in die angegebene Zone umgerechnet.
 */
import { isValidTimeZone, localDateTime } from "../lib/tz";
import { addDays } from "../lib/dates";
import type { Candidate } from "./types";
import { guessTypeFromText } from "./typeguess";

export type IcsTime = { date: string; time: string | null; tz: string | null; utcMs: number | null };
export type IcsEvent = {
  uid: string | null;
  summary: string;
  description: string;
  location: string;
  url: string;
  start: IcsTime;
  end: IcsTime | null;
  allDay: boolean;
};

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

const unescapeText = (s: string) =>
  s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");

function parseProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = (() => {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ":" && !inQuote) return i;
    }
    return -1;
  })();
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0]!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

function parseTime(value: string, params: Record<string, string>, defaultTz: string): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { date, time: null, tz: null, utcMs: null };
  const time = `${m[4]}:${m[5]}`;
  if (m[7] === "Z") {
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
    const tz = isValidTimeZone(defaultTz) ? defaultTz : "UTC";
    const local = localDateTime(ms, tz);
    return { date: local.date, time: local.time, tz, utcMs: ms };
  }
  const tzid = params.TZID;
  return { date, time, tz: tzid && isValidTimeZone(tzid) ? tzid : null, utcMs: null };
}

export function parseIcs(text: string, opts: { defaultTz: string }): IcsEvent[] {
  const lines = unfold(text);
  const out: IcsEvent[] = [];
  let cur: Record<string, { params: Record<string, string>; value: string }> | null = null;
  for (const line of lines) {
    const up = line.trim().toUpperCase();
    if (up === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (up === "END:VEVENT") {
      if (cur) {
        const startRaw = cur.DTSTART;
        const start = startRaw ? parseTime(startRaw.value, startRaw.params, opts.defaultTz) : null;
        if (start) {
          const endRaw = cur.DTEND;
          let end = endRaw ? parseTime(endRaw.value, endRaw.params, opts.defaultTz) : null;
          const allDay = start.time === null;
          if (allDay && end && end.time === null && end.date > start.date) end = { ...end, date: addDays(end.date, -1) };
          out.push({
            uid: cur.UID?.value ?? null,
            summary: unescapeText(cur.SUMMARY?.value ?? "").trim(),
            description: unescapeText(cur.DESCRIPTION?.value ?? "").trim(),
            location: unescapeText(cur.LOCATION?.value ?? "").trim(),
            url: (cur.URL?.value ?? "").trim(),
            start,
            end,
            allDay,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseProp(line);
    if (p && !(p.name in cur)) cur[p.name] = { params: p.params, value: p.value };
  }
  return out;
}

/** Lesbare Fassung (Text für die KI und `documents.text`). */
export function icsToText(events: IcsEvent[]): string {
  return events
    .map((e, i) => {
      const t = (x: IcsTime | null) => (x ? `${x.date}${x.time ? ` ${x.time}` : ""}${x.tz ? ` (${x.tz})` : ""}` : "");
      const lines = [`Termin ${i + 1}: ${e.summary}`, `Beginn: ${t(e.start)}`];
      if (e.end) lines.push(`Ende: ${t(e.end)}`);
      if (e.location) lines.push(`Ort: ${e.location}`);
      if (e.url) lines.push(`Link: ${e.url}`);
      if (e.description) lines.push(`Beschreibung: ${e.description}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function icsCandidates(events: IcsEvent[]): Candidate[] {
  return events.slice(0, 200).map((e, i) => {
    const fields: Candidate["fields"] = { title: e.summary.slice(0, 200) || "Termin", startDate: e.start.date };
    if (e.start.time) fields.startTime = e.start.time;
    if (e.start.tz) fields.startTz = e.start.tz;
    if (e.end) {
      fields.endDate = e.end.date;
      if (e.end.time) fields.endTime = e.end.time;
      if (e.end.tz) fields.endTz = e.end.tz;
    }
    if (e.location) fields.location = e.location.split("\n")[0]!.slice(0, 300);
    if (e.url) fields.website = e.url.slice(0, 300);
    const type = guessTypeFromText(`${e.summary}\n${e.location}\n${e.description.slice(0, 400)}`);
    return {
      origin: "ics" as const,
      type,
      fields,
      quote: `Termin ${i + 1}: ${e.summary}`.slice(0, 160),
      page: 1,
      confidence: 0.9,
      // UTC-Zeiten kennen die Ortszeit nicht (die Zone ist nur die Vorgabe der Reise): dann gewinnt eine
      // Zeit aus dem Dokument; mit TZID oder Ortszeit ist der Kalender verbindlich.
      authoritative: e.start.utcMs != null ? ["startDate"] : ["startDate", "startTime", "startTz", "endDate", "endTime", "endTz"],
      weak: false,
    };
  });
}
