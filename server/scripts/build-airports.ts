/**
 * Erzeugt `src/meta/airports.json` aus der öffentlichen OurAirports-Datenbasis (Public Domain,
 * https://ourairports.com/data/). Nur Flughäfen mit IATA-Code und Linienverkehr (grosse immer, alle
 * anderen nur mit scheduled_service). Zeitzone je Flughafen per `tz-lookup`.
 *
 *   npm run airports:build -- [pfad/zu/airports.csv]
 *
 * Ohne Argument wird die CSV von davidmegginson.github.io geladen. Das Ergebnis wird committet; der
 * Server liest zur Laufzeit nur die JSON-Datei.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tzlookup from "tz-lookup";

const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/meta/airports.json");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const arg = process.argv[2];
const csv = arg ? fs.readFileSync(arg, "utf8") : await (await fetch(SOURCE)).text();
const [head, ...rows] = parseCsv(csv);
const col = (name: string) => head!.indexOf(name);
const iType = col("type"), iName = col("name"), iLat = col("latitude_deg"), iLon = col("longitude_deg");
const iCountry = col("iso_country"), iCity = col("municipality"), iSched = col("scheduled_service"), iIata = col("iata_code");

const list: Array<[string, string, string, string, number, number, string]> = [];
const seen = new Set<string>();
for (const r of rows) {
  const iata = (r[iIata] ?? "").trim().toUpperCase();
  const type = r[iType] ?? "";
  if (!/^[A-Z]{3}$/.test(iata) || seen.has(iata)) continue;
  if (!["large_airport", "medium_airport", "small_airport", "seaplane_base"].includes(type)) continue;
  if (type !== "large_airport" && r[iSched] !== "yes") continue;
  const lat = Number(r[iLat]);
  const lon = Number(r[iLon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  let tz = "";
  try {
    tz = tzlookup(lat, lon);
  } catch {
    continue;
  }
  seen.add(iata);
  list.push([iata, (r[iName] ?? "").trim(), (r[iCity] ?? "").trim(), r[iCountry] ?? "", Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, tz]);
}
list.sort((a, b) => a[0].localeCompare(b[0]));
// Format: [iata, name, city, country (ISO-2), lat, lon, tz]; eine Zeile je Flughafen (gut diff-bar).
const body = list.map((a) => "  " + JSON.stringify(a)).join(",\n");
fs.writeFileSync(out, `[\n${body}\n]\n`);
console.log(`${list.length} Flughäfen nach ${out} geschrieben`);
