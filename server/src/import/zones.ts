/**
 * Zeitzonen für importierte Ereignisse (HomeBuddy kennt keine Zonen).
 *
 * Reihenfolge der Quellen je Ereignis, vom Sichersten zum Unsichersten:
 *  1. Flug: IATA-Codes über die Flughafentabelle (Abflug- und Ankunftszone).
 *  2. Koordinaten (`lat`/`lon`): Zeitzonen-Lookup (`tz-lookup`).
 *  3. Ortsnamen von Strecken (Bahnhof, Transfer, Mietauto): Stadtname gegen die Flughafentabelle, nur wenn alle
 *     Treffer dieselbe Zone haben.
 *  4. Endzone mehrtägiger Strecken (Kreuzfahrt, Zug, Transfer, Mietauto): Zone des Folgeereignisses am Endtag.
 *  5. Vorwärts-Übertragung: die zuletzt bekannte Zone entlang der Zeit (Reisezone, wenn nichts davor liegt).
 *
 * Was sich nicht sicher bestimmen lässt (Flug ohne auflösbaren Flughafen, Strecke mit Uhrzeit über einen
 * Zonenwechsel hinweg), bleibt ohne Zone und wird als `needs_review` gemeldet: nichts wird geraten.
 */
import tzlookup from "tz-lookup";
import { findAirport, searchAirports } from "../meta/airports";
import { isValidTimeZone } from "../lib/tz";

export type ZoneHow = "iata" | "coords" | "place" | "lookahead" | "carried" | "trip";

export type ZoneValue = { tz: string; how: ZoneHow; quote: string };

export type ZoneEventInput = {
  type: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  lat: number | null;
  lon: number | null;
  location: string | null;
  details: Record<string, unknown>;
};

export type ZoneResult = {
  startTz: ZoneValue | null;
  endTz: ZoneValue | null;
  /** Grund, wenn die Zone nicht sicher bestimmt werden konnte (Ereignis wird «zu prüfen»). */
  review: string | null;
};

/** Arten, bei denen Anfang und Ende in verschiedenen Zonen liegen können. */
const JOURNEY = new Set(["Zugreisen", "Transfer", "Mietauto", "Kreuzfahrt"]);
/** Arten, bei denen Orte aus dem Text gelesen werden (Bahnhof, Abholort …). */
const PLACE_TYPES = new Set(["Zugreisen", "Transfer", "Mietauto"]);

export const CONFIDENCE: Record<ZoneHow, number> = {
  iata: 1,
  coords: 0.95,
  place: 0.8,
  lookahead: 0.8,
  carried: 0.6,
  trip: 0.5,
};

export function zoneFromCoords(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  try {
    const tz = tzlookup(lat, lon);
    return tz && isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** Kleinschreibung ohne Akzente und Umlaute-Punkte («Zürich» → «zurich»), wie die Flughafensuche vergleicht. */
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
/** Umschrift «ue», «oe», «ae» → «u», «o», «a» («Zuerich» → «zurich»). */
const unUmlaut = (s: string) => s.replace(/ue/g, "u").replace(/oe/g, "o").replace(/ae/g, "a");

const cityCache = new Map<string, { tz: string; city: string } | null>();

function cityZone(phrase: string): { tz: string; city: string } | null {
  let hit = cityCache.get(phrase);
  if (hit === undefined) {
    const zones = new Set<string>();
    let city = "";
    for (const a of searchAirports(phrase, 50)) {
      if (plain(a.city) === phrase) {
        zones.add(a.tz);
        city = a.city;
      }
    }
    hit = zones.size === 1 ? { tz: [...zones][0]!, city } : null;
    cityCache.set(phrase, hit);
  }
  return hit;
}

/** Zone einer Stadt nach Ortsname («Budapest-Keleti», «Zürich HB»); nur wenn eindeutig. */
export function zoneFromPlaceName(name: string | null | undefined): { tz: string; city: string } | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  const words = text.split(/[\s,\-–—/()]+/).filter(Boolean);
  // Erst die längste Wortfolge am Anfang («San Juan», «Zürich Flughafen»), dann kürzere.
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const phrase = plain(words.slice(0, n).join(" "));
    if (phrase.length < 4) continue;
    const hit = cityZone(phrase) ?? cityZone(unUmlaut(phrase));
    if (hit) return hit;
  }
  return null;
}

const IATA_PAIR = /\b([A-Za-z]{3})\s*(?:→|->|–|—|-|nach|to)\s*([A-Za-z]{3})\b/;

function strOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** IATA-Codes (Abflug, Ankunft) eines Flugs aus `details`, sonst aus «ZRH → BCN». */
export function flightAirports(ev: Pick<ZoneEventInput, "details" | "location">): { dep: string | null; arr: string | null } {
  let dep = strOf(ev.details.departureAirport)?.toUpperCase() ?? null;
  let arr = strOf(ev.details.arrivalAirport)?.toUpperCase() ?? null;
  if ((!dep || !arr) && ev.location) {
    const m = IATA_PAIR.exec(ev.location);
    if (m) {
      dep ??= m[1]!.toUpperCase();
      arr ??= m[2]!.toUpperCase();
    }
  }
  return { dep, arr };
}

function placesOf(ev: ZoneEventInput): { from: string | null; to: string | null } {
  const d = ev.details;
  let from = strOf(d.originPlace) ?? strOf(d.pickupPlace);
  let to = strOf(d.destinationPlace) ?? strOf(d.returnPlace);
  if ((!from || !to) && ev.location && /→|->/.test(ev.location)) {
    const [a, b] = ev.location.split(/→|->/);
    from ??= a?.trim() || null;
    to ??= b?.trim() || null;
  }
  return { from, to };
}

const startKey = (e: ZoneEventInput) => (e.startDate ? `${e.startDate}T${e.startTime ?? "00:00"}` : null);
const endKey = (e: ZoneEventInput) => {
  const d = e.endDate ?? e.startDate;
  if (!d) return null;
  return `${d}T${e.endTime ?? "23:59"}`;
};

/** Zonen aller Ereignisse einer Reise. `events` in beliebiger Reihenfolge; das Ergebnis hat dieselbe Reihenfolge. */
export function deriveZones(events: ZoneEventInput[], opts: { tripTz: string }): ZoneResult[] {
  const n = events.length;
  const out: ZoneResult[] = events.map(() => ({ startTz: null, endTz: null, review: null }));
  const spans = events.map((e) => !!(e.endDate && e.startDate && e.endDate > e.startDate));
  const timed = events.map((e) => !!(e.startTime || e.endTime));

  // 1.–3. Eigene Hinweise
  const unresolvedFlight = new Set<number>();
  events.forEach((e, i) => {
    const r = out[i]!;
    if (e.type === "Flug") {
      const { dep, arr } = flightAirports(e);
      const a = findAirport(dep);
      const b = findAirport(arr);
      if (a) r.startTz = { tz: a.tz, how: "iata", quote: `IATA ${a.iata}` };
      if (b) r.endTz = { tz: b.tz, how: "iata", quote: `IATA ${b.iata}` };
      if (!a || !b) unresolvedFlight.add(i);
      return;
    }
    const z = zoneFromCoords(e.lat, e.lon);
    if (z) {
      r.startTz = { tz: z, how: "coords", quote: `Koordinaten ${e.lat!.toFixed(4)}, ${e.lon!.toFixed(4)}` };
      // Strecken über mehrere Tage können woanders enden; die Endzone folgt unten aus dem Folgeereignis.
      if (!(JOURNEY.has(e.type) && spans[i])) r.endTz = { ...r.startTz };
      return;
    }
    if (PLACE_TYPES.has(e.type)) {
      const { from, to } = placesOf(e);
      const a = zoneFromPlaceName(from);
      const b = zoneFromPlaceName(to);
      if (a) r.startTz = { tz: a.tz, how: "place", quote: `Ort ${a.city}` };
      if (b) r.endTz = { tz: b.tz, how: "place", quote: `Ort ${b.city}` };
    }
  });

  // 4. Endzone mehrtägiger Strecken aus dem Folgeereignis am Endtag
  events.forEach((e, i) => {
    const r = out[i]!;
    if (!r.startTz || r.endTz || !JOURNEY.has(e.type) || !spans[i]) return;
    let best: { j: number; time: string } | null = null;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = events[j]!;
      const cz = out[j]!.startTz;
      if (!cz || cz.how === "carried" || cz.how === "trip" || c.startDate !== e.endDate) continue;
      const t = c.startTime ?? "00:00";
      if (e.endTime && t < e.endTime) continue;
      if (!best || t < best.time) best = { j, time: t };
    }
    if (best) {
      const src = out[best.j]!.startTz!;
      r.endTz = { tz: src.tz, how: "lookahead", quote: `Folgeereignis am ${e.endDate}` };
    }
  });

  // 5. Vorwärts-Übertragung: Marker (Zeitpunkt in Ortszeit, Zone) aller bekannten Zonen
  type Marker = { key: string; tz: string; event: number };
  const markers: Marker[] = [];
  events.forEach((e, i) => {
    const r = out[i]!;
    const sk = startKey(e);
    const ek = endKey(e);
    if (r.startTz && sk) markers.push({ key: sk, tz: r.startTz.tz, event: i });
    if (r.endTz && ek) markers.push({ key: ek, tz: r.endTz.tz, event: i });
  });
  const before = (key: string, skip: number): Marker | null => {
    let best: Marker | null = null;
    for (const m of markers) {
      if (m.event === skip || m.key > key) continue;
      if (!best || m.key >= best.key) best = m;
    }
    return best;
  };
  const after = (key: string, skip: number): Marker | null => {
    let best: Marker | null = null;
    for (const m of markers) {
      if (m.event === skip || m.key < key) continue;
      if (!best || m.key < best.key) best = m;
    }
    return best;
  };
  /** Zeitpunkt, an dem die Zone gelten soll: ohne Uhrzeit das Tagesende (die zuletzt bekannte Zone des Tages). */
  const probe = (e: ZoneEventInput, which: "start" | "end"): string | null => {
    const d = which === "start" ? e.startDate : e.endDate ?? e.startDate;
    if (!d) return null;
    const t = which === "start" ? e.startTime : e.endTime;
    return `${d}T${t ?? "23:59"}`;
  };

  events.forEach((e, i) => {
    const r = out[i]!;
    if (r.startTz && r.endTz) return;
    if (!e.startDate) return; // ohne Datum gilt die Reisezone (NULL)

    // Flug mit unbekanntem Flughafen: Zone nicht übertragen, die Zone wechselt ja gerade.
    if (unresolvedFlight.has(i)) {
      r.review = `Flughafen nicht in der Tabelle: ${[flightAirports(e).dep, flightAirports(e).arr].filter(Boolean).join(" → ") || "ohne IATA-Code"}`;
      return;
    }
    const kStart = probe(e, "start")!;
    const kEnd = probe(e, "end")!;
    const prev = before(kStart, i);
    const next = after(kEnd, i);

    // Strecke mit Uhrzeit, deren Endzone unbekannt ist und zwischen zwei verschiedenen Zonen liegt.
    if (!r.endTz && JOURNEY.has(e.type) && timed[i] && r.startTz && next && next.tz !== r.startTz.tz) {
      r.review = "Zonenwechsel während der Strecke, Zone am Ende nicht bestimmbar";
    }
    if (!r.startTz && JOURNEY.has(e.type) && timed[i] && prev && next && prev.tz !== next.tz && spans[i]) {
      r.review = "Zonenwechsel zwischen Vorgänger- und Folgeereignis, Zone nicht bestimmbar";
      return;
    }

    const carry = (m: Marker | null): ZoneValue =>
      m ? { tz: m.tz, how: "carried", quote: "übernommen vom vorherigen Ereignis" } : { tz: opts.tripTz, how: "trip", quote: "Zone der Reise" };

    if (!r.startTz) r.startTz = carry(prev);
    if (!r.endTz && !r.review) {
      // Ende gleich Anfang, solange das Ereignis am selben Tag endet; sonst die zuletzt bekannte Zone zum Ende.
      r.endTz = spans[i] ? carry(before(kEnd, i) ?? prev) : { ...r.startTz };
    }
  });

  return out;
}
