/**
 * Flughafentabelle (IATA) aus der öffentlichen OurAirports-Datenbasis, erzeugt mit `npm run airports:build`.
 * Einträge: [iata, name, city, country (ISO-2), lat, lon, tz]. Wird beim ersten Zugriff geladen.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Airport = {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
};

type Row = [string, string, string, string, number, number, string];

const here = path.dirname(fileURLToPath(import.meta.url));

let table: Airport[] | null = null;
let byIata: Map<string, Airport> | null = null;
let searchKeys: Array<{ a: Airport; iata: string; city: string; name: string; country: string }> | null = null;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function load(): Airport[] {
  if (table) return table;
  const candidates = [
    process.env.TRAVELBUDDY_AIRPORTS_PATH,
    path.join(here, "airports.json"), // Entwicklung (src/meta)
    path.join(here, "data/airports.json"), // Bundle (dist/data)
    path.join(here, "../data/airports.json"),
    path.resolve(process.cwd(), "src/meta/airports.json"),
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    try {
      const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
      table = rows.map(([iata, name, city, country, lat, lon, tz]) => ({ iata, name, city, country, lat, lon, tz }));
      byIata = new Map(table.map((a) => [a.iata, a]));
      searchKeys = table.map((a) => ({ a, iata: a.iata.toLowerCase(), city: fold(a.city), name: fold(a.name), country: a.country.toLowerCase() }));
      return table;
    } catch {
      /* nächster Kandidat */
    }
  }
  table = [];
  byIata = new Map();
  searchKeys = [];
  console.warn("[airports] Flughafentabelle nicht gefunden; Suche und Vorbelegung sind leer.");
  return table;
}

/** Flughafen zu einem IATA-Code (Gross-/Kleinschreibung egal) oder null. */
export function findAirport(iata: string | null | undefined): Airport | null {
  load();
  const code = (iata ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? byIata!.get(code) ?? null : null;
}

/** Suche nach IATA-Code, Stadt, Name oder Land. Treffer nach Güte sortiert (exakter Code zuerst). */
export function searchAirports(q: string, limit = 20): Airport[] {
  load();
  const term = fold(q.trim());
  if (!term) return [];
  const scored: Array<[number, Airport]> = [];
  for (const k of searchKeys!) {
    let score = 0;
    if (k.iata === term) score = 100;
    else if (k.iata.startsWith(term)) score = 80;
    else if (k.city === term) score = 70;
    else if (k.city.startsWith(term)) score = 60;
    else if (k.name.startsWith(term)) score = 50;
    else if (k.city.includes(term)) score = 40;
    else if (k.name.includes(term)) score = 30;
    else if (term.length === 2 && k.country === term) score = 10;
    if (score > 0) scored.push([score, k.a]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].iata.localeCompare(y[1].iata));
  return scored.slice(0, Math.max(1, Math.min(limit, 50))).map(([, a]) => a);
}

export function airportCount(): number {
  return load().length;
}
