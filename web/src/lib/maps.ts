/** Orte für Karten: aus `places[]`, sonst abgeleitet aus Ort/Adresse und den Ortsfeldern des Typs. */
import type { EventPlace, EventPlaceRole, TripEvent } from "../api/types";
import { compareEvents } from "./plan";
import { colorKeyOf } from "./viz";

/** Ein Ort für die Karte: mit Koordinaten oder als Suchtext (wird im Browser aufgelöst). */
export type MapPoint = {
  id: string;
  eventId: number;
  /** Position in der Reihenfolge der Reise (1, 2, …), 0 = ohne. */
  order: number;
  role: EventPlaceRole;
  title: string;
  /** Beschriftung des Ortes («Abholung», «Abflug» …). */
  roleLabel: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Suchtext, wenn Koordinaten fehlen. */
  query: string | null;
  color: string;
  date: string | null;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export const ROLE_LABEL: Record<EventPlaceRole, string> = {
  start: "Start",
  end: "Ziel",
  pickup: "Abholung",
  return: "Rückgabe",
  venue: "Ort",
  stop: "Halt",
};

/** Reiner Flughafencode («BCN») wird für die Suche zu «BCN Airport». */
export function searchTextFor(label: string | null, address: string | null): string | null {
  const a = address?.trim();
  if (a) return a;
  const l = label?.trim();
  if (!l) return null;
  return /^[A-Z]{3}$/.test(l) ? `${l} Airport` : l;
}

const dtext = (e: TripEvent, k: string): string => {
  const v = e.details?.[k];
  return typeof v === "string" ? v.trim() : "";
};

/** Orte eines Ereignisses; `places[]` vom Server hat Vorrang. */
export function placesOfEvent(e: TripEvent): EventPlace[] {
  if (e.places && e.places.length > 0) return e.places;
  const out: EventPlace[] = [];
  const add = (role: EventPlaceRole, label: string, address: string | null, lat: number | null = null, lon: number | null = null) => {
    if (label || address) out.push({ role, label, address, lat, lon });
  };
  switch (e.type) {
    case "Flug":
      add("start", dtext(e, "departureAirport"), null);
      add("end", dtext(e, "arrivalAirport"), null);
      break;
    // Katalog Version 2: Adressfeld je Ort (`pickupAddress`, `returnAddress`, `originAddress`, …)
    case "Mietauto":
      add("pickup", dtext(e, "pickupPlace"), dtext(e, "pickupAddress") || e.address);
      add("return", dtext(e, "returnPlace"), dtext(e, "returnAddress") || null);
      break;
    case "Transfer":
    case "Zugreisen":
      add("start", dtext(e, "originPlace"), dtext(e, "originAddress") || null);
      add("end", dtext(e, "destinationPlace"), dtext(e, "destinationAddress") || null);
      break;
    case "Veranstaltung":
      add("venue", dtext(e, "venue") || e.location || "", dtext(e, "venueAddress") || e.address, e.lat, e.lon);
      break;
    case "Kreuzfahrt":
      add("venue", dtext(e, "terminal") || e.location || "", dtext(e, "terminalAddress") || e.address, e.lat, e.lon);
      break;
    default:
      add("venue", e.location ?? "", e.address, e.lat, e.lon);
  }
  if (out.length === 0 && (finite(e.lat) || e.address || e.location)) {
    add("venue", e.location ?? e.title, e.address, e.lat, e.lon);
  }
  // Koordinaten des Ereignisses gehören dem ersten Ort
  if (out.length > 0 && out[0]!.lat == null && finite(e.lat) && finite(e.lon)) {
    out[0] = { ...out[0]!, lat: e.lat, lon: e.lon };
  }
  return out;
}

/** Alle Orte der Ereignisse in Reihenfolge der Reise, mit Typfarbe als CSS-Wert. */
export function eventMapPoints(events: TripEvent[], colorOf: (e: TripEvent) => string = (e) => `var(--k-${colorKeyOf(e.type)})`): MapPoint[] {
  const out: MapPoint[] = [];
  let n = 0;
  for (const e of [...events].sort(compareEvents)) {
    if (e.status === "needs_review" || e.status === "proposed") continue;
    const color = colorOf(e);
    placesOfEvent(e).forEach((p, i) => {
      const hasCoords = finite(p.lat) && finite(p.lon);
      const query = searchTextFor(p.label, p.address);
      if (!hasCoords && !query) return;
      n += 1;
      out.push({
        id: `${e.id}-${i}`,
        eventId: e.id,
        order: n,
        role: p.role,
        title: e.title,
        roleLabel: ROLE_LABEL[p.role] ?? "Ort",
        address: p.address,
        lat: hasCoords ? p.lat : null,
        lon: hasCoords ? p.lon : null,
        query,
        color,
        date: e.startDate,
      });
    });
  }
  return out;
}

/** Link in die Karten-App (Apple-Geräte öffnen Apple Karten, sonst maps.apple.com im Browser). */
export function appleMapsUrl(p: Pick<MapPoint, "title" | "lat" | "lon" | "query" | "address">): string | null {
  const q = new URLSearchParams();
  if (finite(p.lat) && finite(p.lon)) {
    q.set("ll", `${p.lat},${p.lon}`);
    q.set("q", p.title || p.query || "Ort");
  } else if (p.query || p.address) {
    q.set("q", (p.address || p.query) as string);
  } else {
    return null;
  }
  return `https://maps.apple.com/?${q.toString()}`;
}

/** Wegbeschreibung zum Ort (Auto); Start ist der aktuelle Standort der Karten-App. */
export function appleDirectionsUrl(
  to: Pick<MapPoint, "lat" | "lon" | "query" | "address">,
  from?: Pick<MapPoint, "lat" | "lon" | "query" | "address"> | null
): string | null {
  const dest = finite(to.lat) && finite(to.lon) ? `${to.lat},${to.lon}` : to.address || to.query;
  if (!dest) return null;
  const q = new URLSearchParams();
  q.set("daddr", dest);
  if (from) {
    const src = finite(from.lat) && finite(from.lon) ? `${from.lat},${from.lon}` : from.address || from.query;
    if (src) q.set("saddr", src);
  }
  q.set("dirflg", "d");
  return `https://maps.apple.com/?${q.toString()}`;
}

/** Text der Adresse für «Kopieren». */
export function addressText(p: Pick<MapPoint, "title" | "address" | "query" | "lat" | "lon">): string {
  return p.address || p.query || (finite(p.lat) && finite(p.lon) ? `${p.lat}, ${p.lon}` : p.title);
}
