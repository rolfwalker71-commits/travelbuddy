/** KI-Ausgabe lesen und prüfen (Struktur), Text in Teile schneiden, Teilergebnisse vereinen. */
import type { Catalog } from "../catalog/catalog";
import { passengerSubfields } from "./schema";
import type { AddressParts, ExtractedEvent, ExtractedField, ExtractedPassenger, Extraction, PageText } from "./types";

export type ParseResult = { ok: true; value: Extraction } | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v.trim() || null : typeof v === "number" ? String(v) : null);
const num = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : dflt);
const pageOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

function stripFences(s: string): string {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1]! : t;
}

export function parseExtraction(content: string, cat: Catalog): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(stripFences(content));
  } catch (e) {
    return { ok: false, problems: [`Kein gültiges JSON: ${e instanceof Error ? e.message : "Syntaxfehler"}`] };
  }
  if (!isObj(root)) return { ok: false, problems: ["Die Wurzel muss ein Objekt sein"] };
  if (!Array.isArray(root.events)) return { ok: false, problems: ["`events` fehlt oder ist keine Liste"] };
  const problems: string[] = [];
  const paxKeys = passengerSubfields(cat);
  const events: ExtractedEvent[] = [];

  root.events.forEach((raw, i) => {
    const at = `events[${i}]`;
    if (!isObj(raw)) {
      problems.push(`${at} ist kein Objekt`);
      return;
    }
    if (typeof raw.type !== "string" || !raw.type.trim()) {
      problems.push(`${at}.type fehlt`);
      return;
    }
    const fieldsRaw = raw.fields === undefined ? [] : raw.fields;
    if (!Array.isArray(fieldsRaw)) {
      problems.push(`${at}.fields ist keine Liste`);
      return;
    }
    const fields: ExtractedField[] = [];
    fieldsRaw.forEach((f, j) => {
      if (!isObj(f) || typeof f.key !== "string") {
        problems.push(`${at}.fields[${j}] braucht key und value`);
        return;
      }
      const v = f.value;
      if (v === null || v === undefined || v === "") return;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        problems.push(`${at}.fields[${j}].value muss Text sein`);
        return;
      }
      fields.push({
        key: f.key,
        value: String(v),
        confidence: num(f.confidence, 0.5),
        page: pageOrNull(f.page),
        quote: strOrNull(f.quote),
        currency: strOrNull(f.currency),
      });
    });
    const ap = raw.addressParts;
    const addressParts: AddressParts | null = isObj(ap)
      ? {
          street: strOrNull(ap.street), postalCode: strOrNull(ap.postalCode), city: strOrNull(ap.city),
          region: strOrNull(ap.region), country: strOrNull(ap.country),
        }
      : null;
    const placeAddresses = (Array.isArray(raw.placeAddresses) ? raw.placeAddresses : [])
      .filter(isObj)
      .map((p) => ({ field: typeof p.field === "string" ? p.field : "", address: strOrNull(p.address) }))
      .filter((p) => p.field);
    const passengers: ExtractedPassenger[] = (Array.isArray(raw.passengers) ? raw.passengers : []).filter(isObj).map((p) => {
      const values: Record<string, string> = {};
      for (const k of paxKeys) {
        const s = strOrNull(p[k]);
        if (s) values[k] = s;
      }
      return { name: strOrNull(p.name), values, page: pageOrNull(p.page), quote: strOrNull(p.quote) };
    });
    events.push({ type: raw.type.trim(), confidence: num(raw.confidence, 0.5), fields, addressParts, placeAddresses, passengers });
  });

  if (problems.length) return { ok: false, problems };
  const t = isObj(root.trip) ? root.trip : {};
  return {
    ok: true,
    value: {
      summary: typeof root.summary === "string" ? root.summary.trim().slice(0, 600) : "",
      documentKind: strOrNull(root.documentKind),
      trip: { title: strOrNull(t.title), destination: strOrNull(t.destination), startDate: strOrNull(t.startDate), endDate: strOrNull(t.endDate) },
      events,
    },
  };
}

/** Seiten zu Teilen mit höchstens `maxChars` Zeichen (eine übergrosse Seite bleibt allein). */
export function chunkPages(pages: PageText[], maxChars: number): PageText[][] {
  const out: PageText[][] = [];
  let cur: PageText[] = [];
  let size = 0;
  for (const p of pages) {
    const n = p.text.length;
    if (cur.length && size + n > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function mergeExtractions(list: Extraction[]): Extraction {
  const first = list[0];
  if (!first) return { summary: "", documentKind: null, trip: { title: null, destination: null, startDate: null, endDate: null }, events: [] };
  const pick = <K extends keyof Extraction["trip"]>(k: K) => list.map((x) => x.trip[k]).find((v) => v) ?? null;
  return {
    summary: list.map((x) => x.summary).filter(Boolean)[0] ?? "",
    documentKind: list.map((x) => x.documentKind).find(Boolean) ?? null,
    trip: { title: pick("title"), destination: pick("destination"), startDate: pick("startDate"), endDate: pick("endDate") },
    events: list.flatMap((x) => x.events),
  };
}
