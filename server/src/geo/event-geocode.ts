import type { Db } from "../db/client";
import { HttpError } from "../lib/errors";
import * as T from "../trips/service";
import type { FieldsMeta } from "../trips/service";
import type { PlaceCoords } from "../trips/places";
import type { Geocoder } from "./geocode";

export type GeocodeResultStatus =
  | "resolved" // neu aufgelöst und gespeichert
  | "kept" // hatte schon Koordinaten aus Geokodierung/Ableitung (mit `force` neu aufgelöst)
  | "airport" // Koordinaten stammen aus der IATA-Tabelle
  | "skipped_manual" // von Hand gesetzt, wird nie überschrieben
  | "not_found"
  | "no_query" // weder Adresse noch Ortsname
  | "unavailable"; // Dienst nicht erreichbar (Client löst per MapKit auf)

export type GeocodeResult = {
  role: string;
  status: GeocodeResultStatus;
  lat?: number;
  lon?: number;
  label?: string;
  provider?: string;
};

/**
 * Löst alle Orte eines Ereignisses auf. Der erste Ort schreibt `lat`/`lon` (mit `fieldsMeta.lat`/`lon` =
 * `{ source: "geocoded", confidence, quote }`), weitere Orte `place_coords[role]`. Von Hand gesetzte
 * Koordinaten (Herkunft «manual» oder ohne Herkunft, oder gesperrt) werden nie überschrieben.
 */
export async function geocodeEvent(
  db: Db,
  geocoder: Geocoder | null,
  tripId: number,
  eventId: number,
  opts: { force?: boolean } = {}
): Promise<GeocodeResult[]> {
  if (!geocoder) {
    throw new HttpError(409, "geocoder_not_configured", "Die Geokodierung ist nicht aktiv; Koordinaten bitte im Client auflösen");
  }
  const trip = T.getTrip(db, tripId);
  const row = T.getEventRow(db, tripId, eventId);
  const places = T.eventPlacesWithQuery(row, trip);
  const meta: FieldsMeta = JSON.parse(row.fields_meta || "{}");
  const coords: PlaceCoords = JSON.parse(row.place_coords || "{}");
  const results: GeocodeResult[] = [];
  let lat = row.lat;
  let lon = row.lon;
  let dirty = false;

  for (let i = 0; i < places.length; i++) {
    const p = places[i]!;
    const base = { role: p.role };
    if (p.isAirport && p.lat != null && p.source === "airport") {
      results.push({ ...base, status: "airport", lat: p.lat, lon: p.lon ?? undefined, label: p.label ?? undefined });
      continue;
    }
    const hasCoords = p.lat != null && p.lon != null;
    if (hasCoords) {
      const locked = i === 0 && Boolean(meta.lat?.locked);
      if (p.source === "manual" || locked) {
        results.push({ ...base, status: "skipped_manual", lat: p.lat!, lon: p.lon! });
        continue;
      }
      if (!opts.force) {
        results.push({ ...base, status: "kept", lat: p.lat!, lon: p.lon! });
        continue;
      }
    }
    if (!p.query) {
      results.push({ ...base, status: "no_query" });
      continue;
    }
    let hit;
    try {
      hit = await geocoder.geocode(p.query);
    } catch {
      results.push({ ...base, status: "unavailable" });
      continue;
    }
    if (!hit) {
      results.push({ ...base, status: "not_found" });
      continue;
    }
    if (i === 0) {
      lat = hit.lat;
      lon = hit.lon;
      meta.lat = { source: "geocoded", confidence: hit.confidence, quote: hit.label };
      meta.lon = { source: "geocoded", confidence: hit.confidence, quote: hit.label };
    } else {
      coords[p.role] = { lat: hit.lat, lon: hit.lon, source: "geocoded", confidence: hit.confidence, quote: hit.label };
    }
    dirty = true;
    results.push({ ...base, status: "resolved", lat: hit.lat, lon: hit.lon, label: hit.label, provider: hit.provider });
  }

  if (dirty) {
    db.prepare("UPDATE trip_events SET lat = ?, lon = ?, place_coords = ?, fields_meta = ?, updated_at = ? WHERE id = ?").run(
      lat, lon, JSON.stringify(coords), JSON.stringify(meta), new Date().toISOString(), eventId
    );
  }
  return results;
}

/** Hintergrundlauf nach dem Speichern: nur Orte ohne Koordinaten, Fehler werden verschluckt. */
export async function autoGeocodeEvent(db: Db, geocoder: Geocoder, tripId: number, eventId: number): Promise<void> {
  try {
    const trip = T.getTrip(db, tripId);
    const row = T.getEventRow(db, tripId, eventId);
    const places = T.eventPlacesWithQuery(row, trip);
    if (!places.some((p) => p.lat == null && p.query)) return;
    await geocodeEvent(db, geocoder, tripId, eventId);
  } catch {
    /* Ereignis oder Reise inzwischen gelöscht, Dienst nicht erreichbar: egal */
  }
}
