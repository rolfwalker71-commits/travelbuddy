/**
 * Rohe KI-Ausgabe → normalisierte Vorschläge (`ProposedEvent`): Typ auflösen, Werte nach Katalog umformen und
 * prüfen (Datum, Zeit, Beträge in Minor Units, Auswahlwerte mit Synonymen, IATA, Flugnummer-Muster), Adressen
 * getrennt vom Ortsnamen führen. Unbrauchbare Felder entfallen und bekommen einen Hinweis; der Server prüft den
 * Katalog später streng, daher wird hier jedes Detail einzeln gegen `validateDetails` gehalten.
 */
import type { Catalog, FieldDef } from "../catalog/catalog";
import { isValidTimeZone } from "../lib/tz";
import { findAirport } from "../meta/airports";
import type { AddressParts, ExtractedEvent, Extraction, FieldOrigin, Issue, ProposedEvent } from "./types";
import { extractionKeys, type KeyInfo } from "./schema";
import {
  currencyOf, normBool, normDate, normFlightNumber, normIata, normInt, normSelect, normTime, parseAmountMinor,
} from "./values";

export const MIN_FIELD_CONFIDENCE = 0.5;
export const REVIEW_FIELD_CONFIDENCE = 0.75;

const keyCache = new WeakMap<Catalog, Map<string, KeyInfo>>();
export function keysOf(cat: Catalog): Map<string, KeyInfo> {
  let k = keyCache.get(cat);
  if (!k) {
    k = extractionKeys(cat);
    keyCache.set(cat, k);
  }
  return k;
}

const clamp01 = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const pct = (n: number) => `${Math.round(n * 100)} %`;

export function cleanQuote(q: string | null | undefined): string | null {
  const s = (q ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 200) : null;
}

const validPage = (p: number | null | undefined): number | null => (typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 5000 ? p : null);

/** Ortsfelder, deren Adresse in `address` des Ereignisses steht (der erste Ort). */
const PRIMARY_PLACE_KEYS = new Set(["location", "pickupPlace", "originPlace", "venue"]);
/** Ortsfeld → Adressfeld des Typs (Katalog Version 2). */
const ADDRESS_KEY: Record<string, string> = {
  pickupPlace: "pickupAddress", returnPlace: "returnAddress", originPlace: "originAddress",
  destinationPlace: "destinationAddress", venue: "venueAddress", terminal: "terminalAddress",
};
const MAIN_ADDRESS_KEYS = ["pickupAddress", "originAddress", "venueAddress", "terminalAddress"];

export function addressLine(p: AddressParts | null | undefined): string | null {
  if (!p) return null;
  const cityLine = [p.postalCode, p.city].filter(Boolean).join(" ");
  const line = [p.street, cityLine, p.region, p.country].filter((x): x is string => Boolean(x && x.trim())).join(", ");
  return line || null;
}

function convert(
  info: KeyInfo,
  f: { value: string; currency: string | null },
  issues: Issue[],
  side: { currency: string | null }
): string | number | boolean | null {
  const d: FieldDef = info.def;
  const raw = f.value.trim();
  const bad = (what: string) => {
    issues.push({ field: info.apiKey, code: "invalid_value", message: `${d.label}: «${raw.slice(0, 60)}» ${what}`, needsReview: true });
    return null;
  };
  switch (info.kind) {
    case "date": {
      const v = normDate(raw);
      return v ?? bad("ist kein gültiges Datum");
    }
    case "time": {
      const v = normTime(raw);
      return v ?? bad("ist keine gültige Uhrzeit");
    }
    case "number": {
      const v = normInt(raw);
      return v ?? bad("ist keine ganze Zahl");
    }
    case "bool": {
      const v = normBool(raw);
      return v ?? bad("ist kein Ja/Nein");
    }
    case "money": {
      const minor = parseAmountMinor(raw);
      if (minor == null || minor < 0) return bad("ist kein gültiger Betrag");
      side.currency = currencyOf(f.currency) ?? currencyOf(raw);
      return minor;
    }
    case "airport": {
      const v = normIata(raw);
      return v ?? bad("ist kein IATA-Code");
    }
    case "select": {
      if (d.options === "iana") return isValidTimeZone(raw) ? raw : bad("ist keine gültige IANA-Zeitzone");
      const v = normSelect(d, raw);
      return v ?? bad("passt zu keiner Auswahl des Katalogs (Wert bleibt im Zitat)");
    }
    default: {
      let s = raw.replace(/\s+/g, " ");
      if (info.apiKey === "flightNumber") s = normFlightNumber(s) ?? s.toUpperCase();
      if (info.apiKey === "website" && /^www\./i.test(s)) s = `https://${s}`;
      const max = d.maxLength ?? (info.kind === "longtext" ? 10_000 : 300);
      if (info.kind === "longtext") s = raw.slice(0, max);
      else if (s.length > max) s = s.slice(0, max);
      return s || null;
    }
  }
}

export function normalizeEvent(ev: ExtractedEvent, cat: Catalog): ProposedEvent {
  const keys = keysOf(cat);
  const issues: Issue[] = [];
  let type = cat.resolveTypeId(ev.type);
  if (!type) {
    type = "Ausflug";
    issues.push({ code: "unknown_type", message: `Unbekannter Typ «${ev.type}», als Ausflug übernommen`, needsReview: true });
  }
  const resolved = cat.type(type)!;
  const common: ProposedEvent["common"] = {};
  const details: ProposedEvent["details"] = {};
  const meta: Record<string, FieldOrigin> = {};
  const detailCurrencies: Record<string, string | null> = {};
  let eventCurrency: string | null = null;

  // Je Schlüssel gewinnt der Eintrag mit der höchsten Sicherheit.
  const best = new Map<string, (typeof ev.fields)[number]>();
  for (const f of ev.fields) {
    if (!f || typeof f.key !== "string" || typeof f.value !== "string" || !f.value.trim()) continue;
    const prev = best.get(f.key);
    if (!prev || clamp01(f.confidence) > clamp01(prev.confidence)) best.set(f.key, f);
  }

  for (const [schemaKey, f] of best) {
    const info = keys.get(schemaKey);
    if (!info) {
      issues.push({ field: schemaKey, code: "unknown_key", message: `Unbekanntes Feld «${schemaKey}» ignoriert`, needsReview: false });
      continue;
    }
    if (!info.common && !resolved.fields.has(info.apiKey)) {
      issues.push({ field: info.apiKey, code: "field_not_for_type", message: `${info.def.label} gehört nicht zum Typ «${resolved.label}»`, needsReview: false });
      continue;
    }
    const conf = clamp01(f.confidence);
    if (conf < MIN_FIELD_CONFIDENCE) {
      issues.push({
        field: info.apiKey, code: "low_confidence",
        message: `${info.def.label}: zu unsicher (${pct(conf)}), nicht übernommen`, needsReview: true,
      });
      continue;
    }
    const side = { currency: null as string | null };
    const value = convert(info, f, issues, side);
    if (value === null) continue;
    if (info.common) common[info.apiKey] = value as string | number;
    else details[info.apiKey] = value;
    meta[info.apiKey] = {
      source: "document", confidence: conf, page: validPage(f.page), quote: cleanQuote(f.quote),
      ...(conf < REVIEW_FIELD_CONFIDENCE ? { needsReview: true } : {}),
    };
    if (info.kind === "money") {
      if (info.common && info.apiKey === "priceMinor") {
        eventCurrency = side.currency;
        if (!side.currency) {
          issues.push({ field: "priceMinor", code: "currency_missing", message: "Preis: Währung nicht erkennbar", needsReview: true });
        }
      } else detailCurrencies[info.apiKey] = side.currency;
    }
  }

  // Beträge in Detail-Feldern gelten in der Währung des Ereignisses.
  for (const [key, cur] of Object.entries(detailCurrencies)) {
    if (cur && eventCurrency && cur !== eventCurrency) {
      delete details[key];
      delete meta[key];
      issues.push({ field: key, code: "currency_mismatch", message: `${key}: Währung ${cur} weicht vom Preis (${eventCurrency}) ab, nicht übernommen`, needsReview: true });
    } else if (cur && !eventCurrency) {
      eventCurrency = cur;
    }
  }
  if (eventCurrency) common.currency = eventCurrency;

  // Adressen: Hauptadresse in `address`; Adressen weiterer Orte in den eigenen Adressfeldern des Typs.
  const placeAddresses: Record<string, string> = {};
  for (const pa of ev.placeAddresses ?? []) {
    const a = (pa.address ?? "").replace(/\s+/g, " ").trim();
    if (!a || !pa.field) continue;
    const addrKey = ADDRESS_KEY[pa.field];
    if (addrKey && resolved.fields.has(addrKey)) {
      if (details[addrKey] === undefined) {
        details[addrKey] = a.slice(0, 300);
        meta[addrKey] = { source: "document", confidence: clamp01(ev.confidence), page: null, quote: null };
      }
      placeAddresses[pa.field] = a;
    } else if (PRIMARY_PLACE_KEYS.has(pa.field) && !common.address) {
      common.address = a.slice(0, 300);
    }
  }
  if (!common.address) {
    // Die Adresse des Haupt-Ortes steht auch in `address` (Karte, Kalender, Listen).
    for (const k of MAIN_ADDRESS_KEYS) {
      const v = details[k];
      if (typeof v === "string" && v) {
        common.address = v;
        meta.address = { ...(meta[k] ?? { source: "document", confidence: clamp01(ev.confidence), page: null, quote: null }) };
        break;
      }
    }
  }
  if (!common.address) {
    const line = addressLine(ev.addressParts);
    if (line) {
      common.address = line.slice(0, 300);
      meta.address = { source: "document", confidence: clamp01(ev.confidence), page: null, quote: null };
    }
  }

  // Jedes Detail einzeln gegen den Katalog halten (ein Fehler darf nicht das ganze Ereignis kippen).
  for (const [k, v] of Object.entries(details)) {
    try {
      const clean = cat.validateDetails(type, { [k]: v });
      if (clean[k] === undefined) {
        delete details[k];
      } else {
        details[k] = clean[k] as string | number | boolean;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ungültig";
      delete details[k];
      delete meta[k];
      issues.push({ field: k, code: "catalog_invalid", message: `${msg}`, needsReview: true });
    }
  }

  const passengers = (ev.passengers ?? [])
    .map((p) => ({
      name: p.name?.replace(/\s+/g, " ").trim() || null,
      values: Object.fromEntries(Object.entries(p.values ?? {}).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v)) as Record<string, string>,
      page: validPage(p.page),
      quote: cleanQuote(p.quote),
    }))
    .filter((p) => p.name || Object.keys(p.values).length);

  const core = ["title", "startDate", "bookingReference", "flightNumber", "trainNumber"].map((k) => meta[k]?.confidence).filter((c): c is number => c != null);
  const confidence = Math.min(clamp01(ev.confidence), ...core);

  return {
    type,
    common,
    details,
    meta,
    passengers,
    addressParts: ev.addressParts ?? null,
    placeAddresses,
    confidence,
    issues,
    origins: ["llm"],
    status: "proposed",
  };
}

export function normalizeExtraction(ex: Extraction, cat: Catalog): ProposedEvent[] {
  return ex.events.map((e) => normalizeEvent(e, cat));
}

/* ───────────── Flughäfen ───────────── */

/** Für eine bekannte IATA: Stadt (für Zielortvermutung und Gegenprüfung). */
export function airportCity(iata: unknown): string | null {
  return typeof iata === "string" ? findAirport(iata)?.city ?? null : null;
}
