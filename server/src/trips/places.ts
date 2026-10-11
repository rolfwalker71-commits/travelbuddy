/**
 * Orte eines Ereignisses (`places[]`, abgeleitet und nur lesbar).
 *
 * Quelle: `address`, `location`, `lat`/`lon` des Ereignisses und die Orts-Felder in `details`
 * (`pickupPlace`, `returnPlace`, `originPlace`, `destinationPlace`, `venue`, Flughäfen) samt ihren Adressfeldern
 * (`pickupAddress`, `returnAddress`, `originAddress`, `destinationAddress`, `venueAddress`, `terminalAddress`;
 * Katalog Version 2). Der erste Ort trägt
 * die Koordinaten des Ereignisses (`lat`/`lon`), weitere Orte die gespeicherten Koordinaten je Rolle
 * (`trip_events.place_coords`) oder, bei Flughäfen, die IATA-Tabelle.
 */
import { findAirport } from "../meta/airports";

export type PlaceRole = "start" | "end" | "pickup" | "return" | "venue" | "stop";
export type CoordSource = "manual" | "geocoded" | "airport" | "derived";

export type PlaceCoord = { lat: number; lon: number; source: CoordSource; confidence?: number; quote?: string };
export type PlaceCoords = Partial<Record<PlaceRole, PlaceCoord>>;

export type EventPlace = {
  role: PlaceRole;
  label: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Herkunft der Koordinaten (null = keine). */
  source: CoordSource | null;
};

/** Ort samt Suchbegriff für die Geokodierung (nicht Teil der API-Antwort). */
export type PlaceWithQuery = EventPlace & { query: string | null; isAirport: boolean };

export type PlaceSource = {
  type: string;
  /** Titel des Ereignisses (Hafentage: Name des Hafens als Suchbegriff). */
  title?: string | null;
  location: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  details: Record<string, unknown>;
  placeCoords: PlaceCoords;
  /** `fieldsMeta.lat?.source` des Ereignisses (Herkunft von lat/lon). */
  latSource: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const PLACE_ROLES: readonly PlaceRole[] = ["start", "end", "pickup", "return", "venue", "stop"];

/** Reihenfolge und Rollen je nach Feldern; der erste Eintrag ist der «Haupt»-Ort des Ereignisses. */
export function derivePlaces(ev: PlaceSource, context: { destination?: string | null } = {}): PlaceWithQuery[] {
  const d = ev.details;
  const out: PlaceWithQuery[] = [];

  const fromText = (role: PlaceRole, label: string | null, address: string | null): PlaceWithQuery => {
    const query = address ?? (label ? (context.destination && !label.includes(context.destination) ? `${label}, ${context.destination}` : label) : null);
    return { role, label, address, lat: null, lon: null, source: null, query, isAirport: false };
  };
  const fromAirport = (role: PlaceRole, code: string | null): PlaceWithQuery | null => {
    const ap = findAirport(code);
    if (!ap && !code) return null;
    return {
      role,
      label: ap ? `${ap.name} (${ap.iata})` : code,
      address: ap ? [ap.city, ap.country].filter(Boolean).join(", ") : null,
      lat: ap?.lat ?? null,
      lon: ap?.lon ?? null,
      source: ap ? "airport" : null,
      query: ap ? null : code ? `${code} airport` : null,
      isAirport: Boolean(ap),
    };
  };

  const dep = str(d.departureAirport);
  const arr = str(d.arrivalAirport);
  const pickup = str(d.pickupPlace);
  const ret = str(d.returnPlace);
  const origin = str(d.originPlace);
  const dest = str(d.destinationPlace);
  const venue = str(d.venue);
  // Eigene Adressfelder je Ort (Katalog Version 2); ohne sie gilt für den ersten Ort die Adresse des Ereignisses.
  const pickupAddr = str(d.pickupAddress);
  const returnAddr = str(d.returnAddress);
  const originAddr = str(d.originAddress);
  const destAddr = str(d.destinationAddress);
  const venueAddr = str(d.venueAddress);
  const terminalAddr = str(d.terminalAddress);

  if (dep || arr) {
    const a = fromAirport("start", dep);
    const b = fromAirport("end", arr);
    if (a) out.push(a);
    if (b) out.push(b);
  } else if (pickup || ret || pickupAddr || returnAddr) {
    if (pickup || pickupAddr) out.push(fromText("pickup", pickup, pickupAddr ?? ev.address));
    if (ret || returnAddr) out.push(fromText("return", ret, returnAddr));
  } else if (origin || dest || originAddr || destAddr) {
    if (origin || originAddr) out.push(fromText("start", origin, originAddr ?? ev.address));
    if (dest || destAddr) out.push(fromText("end", dest, destAddr));
  } else if (venue || venueAddr) {
    out.push(fromText("venue", venue, venueAddr ?? ev.address));
  } else if (ev.type === "Kreuzfahrt" && (str(d.entryKind) === "Seetag" || str(d.entryKind) === "Reise")) {
    // Seetage und die Gesamtreise haben keinen Ort: nie geokodieren (vorhandene Koordinaten bleiben sichtbar).
    if (ev.lat != null && ev.lon != null) out.push({ ...fromText("stop", ev.location, ev.address), query: null });
  } else if (ev.type === "Kreuzfahrt" && str(d.entryKind) === "Hafen" && !ev.address && !ev.location && !terminalAddr && str(ev.title)) {
    // Hafentag: Suchbegriff aus Titel (ohne «Abfahrt/Ankunft …») und Ziel der Reise, z. B. «Palma de Mallorca, Spain».
    const title = str(ev.title)!;
    const name = title.replace(/^(Abfahrt|Ankunft|Ausschiffung|Einschiffung)(\s+(in|von|aus|nach))?\s+/i, "").trim() || title;
    out.push(fromText("stop", name, null));
  } else if (ev.address || ev.location || terminalAddr || (ev.lat != null && ev.lon != null)) {
    out.push(
      fromText(ev.type === "Kreuzfahrt" ? "stop" : "venue", ev.location, (ev.type === "Kreuzfahrt" ? terminalAddr : null) ?? ev.address)
    );
  }

  // Koordinaten: erster Ort = lat/lon des Ereignisses, weitere aus place_coords; Flughäfen aus der Tabelle.
  out.forEach((p, i) => {
    const stored = ev.placeCoords[p.role];
    if (stored) {
      p.lat = stored.lat;
      p.lon = stored.lon;
      p.source = stored.source;
    } else if (i === 0 && ev.lat != null && ev.lon != null && !(p.source === "airport" && normalizeSource(ev.latSource) !== "manual")) {
      p.lat = ev.lat;
      p.lon = ev.lon;
      p.source = normalizeSource(ev.latSource);
    }
  });
  return out;
}

function normalizeSource(s: string | null): CoordSource | null {
  if (s === "manual" || s === "geocoded" || s === "derived") return s;
  // Koordinaten ohne Herkunft (z. B. importiert) gelten als von Hand gesetzt.
  return "manual";
}

/** API-Form von `places[]`. */
export function publicPlaces(places: PlaceWithQuery[]): EventPlace[] {
  return places.map(({ role, label, address, lat, lon, source }) => ({ role, label, address, lat, lon, source }));
}
