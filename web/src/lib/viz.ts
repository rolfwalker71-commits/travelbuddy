/**
 * Daten für die Infografiken (alles aus den Reisedaten berechnet, deterministisch):
 * Routenbogen, Zeitband, Reise in Zahlen, Kasse nach Kategorie und Tag, Salden mit Ausgleich.
 */
import type { Balance, EventPlace, Expense, Transfer, TripEvent } from "../api/types";
import { compareEvents, listDays, type TripSpan } from "./plan";
import { daysBetween } from "./dates";

/* ─ Orte eines Ereignisses ─ */

export type GeoPoint = { lat: number; lon: number };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Orte mit Koordinaten: `places[]`, sonst die Koordinaten des Ereignisses. */
export function eventPlaces(e: TripEvent): (EventPlace & { lat: number; lon: number })[] {
  const out: (EventPlace & { lat: number; lon: number })[] = [];
  for (const p of e.places ?? []) {
    if (finite(p.lat) && finite(p.lon)) out.push(p as EventPlace & { lat: number; lon: number });
  }
  if (out.length === 0 && finite(e.lat) && finite(e.lon)) {
    out.push({ role: "venue", label: e.location ?? e.title, address: e.address, lat: e.lat, lon: e.lon });
  }
  return out;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Farbschlüssel (`air`, `ship`, …) je Typ-ID; ohne Katalog die Standardzuordnung. */
export function colorKeyOf(type: string): string {
  switch (type) {
    case "Flug":
      return "air";
    case "Zugreisen":
      return "rail";
    case "Mietauto":
      return "car";
    case "Transfer":
      return "transfer";
    case "Hotel":
    case "Unterkunft":
      return "stay";
    case "Kreuzfahrt":
      return "ship";
    case "Ausflug":
      return "activity";
    case "Restaurant":
      return "food";
    case "Veranstaltung":
      return "ticket";
    case "Versicherung":
      return "safety";
    default:
      return "doc";
  }
}

/* ─ Routenbogen ─ */

export type RouteStop = { id: string; eventId: number; label: string; lat: number; lon: number; color: string; order: number };
export type RouteLeg = { from: number; to: number; color: string; kind: "air" | "ship" | "rail" | "road" | "other"; eventId: number };
export type RouteData = { stops: RouteStop[]; legs: RouteLeg[] };

function legKind(color: string): RouteLeg["kind"] {
  if (color === "air") return "air";
  if (color === "ship") return "ship";
  if (color === "rail") return "rail";
  if (color === "car" || color === "transfer") return "road";
  return "other";
}

/**
 * Stationen und Strecken der Reise in Reihenfolge. Ereignisse mit zwei Orten (Flug, Zug, Mietwagen, Transfer)
 * ergeben eine Strecke; aufeinanderfolgende Hafen-/Schiffseinträge werden zu Schiffsstrecken verbunden.
 */
export function buildRoute(events: TripEvent[], colorKey: (e: TripEvent) => string = (e) => colorKeyOf(e.type)): RouteData {
  const stops: RouteStop[] = [];
  const legs: RouteLeg[] = [];
  const same = (a: GeoPoint, b: GeoPoint) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  const addStop = (e: TripEvent, p: EventPlace & GeoPoint, order: number): number => {
    const prev = stops[stops.length - 1];
    if (prev && same(prev, p)) return stops.length - 1;
    stops.push({
      id: `${e.id}-${order}`,
      eventId: e.id,
      label: p.label || e.location || e.title,
      lat: p.lat,
      lon: p.lon,
      color: colorKey(e),
      order: stops.length + 1,
    });
    return stops.length - 1;
  };
  let lastShip: number | null = null;
  for (const e of [...events].sort(compareEvents)) {
    if (e.status && e.status !== "confirmed") continue;
    const places = eventPlaces(e);
    if (places.length === 0) continue;
    const color = colorKey(e);
    if (places.length >= 2 && ["air", "rail", "car", "transfer", "ship"].includes(color)) {
      const a = addStop(e, places[0]!, 0);
      const b = addStop(e, places[places.length - 1]!, 1);
      if (a !== b) legs.push({ from: a, to: b, color, kind: legKind(color), eventId: e.id });
      lastShip = color === "ship" ? b : null;
      continue;
    }
    const i = addStop(e, places[0]!, 0);
    if (color === "ship") {
      if (lastShip != null && lastShip !== i) legs.push({ from: lastShip, to: i, color, kind: "ship", eventId: e.id });
      lastShip = i;
    }
  }
  return { stops, legs };
}

export type ProjectedRoute = {
  width: number;
  height: number;
  stops: (RouteStop & { x: number; y: number })[];
  legs: (RouteLeg & { d: string; mx: number; my: number })[];
};

/** Abstand zweier Punkte in der Projektion. */
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Gleichrechteckige Projektion in eine Fläche `width × height` (Rand `pad`). Strecken sind quadratische Bögen,
 * deren Höhe mit der Länge wächst; Flüge bogen nach oben, Schiff und Strasse nur leicht.
 */
export function projectRoute(route: RouteData, width = 630, height = 232, pad = 36): ProjectedRoute {
  if (route.stops.length === 0) return { width, height, stops: [], legs: [] };
  const lats = route.stops.map((s) => s.lat);
  const lons = route.stops.map((s) => s.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // Längengrade schrumpfen mit der Breite (cos φ), damit die Form stimmt
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanX = Math.max((maxLon - minLon) * kx, 0.0001);
  const spanY = Math.max(maxLat - minLat, 0.0001);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offX = pad + (innerW - spanX * scale) / 2;
  const offY = pad + (innerH - spanY * scale) / 2;
  const stops = route.stops.map((s) => ({
    ...s,
    x: round1(offX + (s.lon - minLon) * kx * scale),
    y: round1(offY + (maxLat - s.lat) * scale),
  }));
  const legs = route.legs.map((l) => {
    const a = stops[l.from]!;
    const b = stops[l.to]!;
    const len = dist(a, b);
    const lift = l.kind === "air" ? Math.min(len * 0.28, 70) : Math.min(len * 0.08, 18);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Normale (nach oben)
    const nx = len === 0 ? 0 : (a.y - b.y) / len;
    const ny = len === 0 ? -1 : (b.x - a.x) / len;
    const sign = ny > 0 ? -1 : 1;
    const cx = round1(mx + nx * sign * lift);
    const cy = round1(my + ny * sign * lift);
    return { ...l, d: `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`, mx: round1((a.x + 2 * cx + b.x) / 4), my: round1((a.y + 2 * cy + b.y) / 4) };
  });
  return { width, height, stops, legs };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ─ Zeitband ─ */

export type BandLane = "away" | "ship" | "stay" | "car";
export type BandSegment = { id: string; eventId: number; lane: BandLane; from: number; to: number; label: string; color: string };
export type TimeBand = { days: string[]; segments: BandSegment[]; todayIndex: number | null; lanes: BandLane[] };

export const LANE_LABEL: Record<BandLane, string> = { away: "Unterwegs", ship: "Schiff", stay: "Unterkunft", car: "Mietwagen" };

function laneOf(type: string): BandLane | null {
  switch (type) {
    case "Flug":
    case "Zugreisen":
    case "Transfer":
      return "away";
    case "Kreuzfahrt":
      return "ship";
    case "Hotel":
    case "Unterkunft":
      return "stay";
    case "Mietauto":
      return "car";
    default:
      return null;
  }
}

/** Tage der Reise in Spuren: Unterwegs, Schiff, Unterkunft, Mietwagen. Aufeinanderfolgende Schiffstage werden vereint. */
export function buildTimeBand(events: TripEvent[], span: TripSpan | null, todayIso: string | null, colorKey = (e: TripEvent) => colorKeyOf(e.type)): TimeBand {
  if (!span) return { days: [], segments: [], todayIndex: null, lanes: [] };
  const days = listDays(span, 400);
  const segments: BandSegment[] = [];
  for (const e of [...events].sort(compareEvents)) {
    if (e.status && e.status !== "confirmed") continue;
    const lane = laneOf(e.type);
    if (!lane || !e.startDate) continue;
    const from = daysBetween(span.start, e.startDate);
    const endDate = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate;
    const to = daysBetween(span.start, endDate);
    if (to < 0 || from > span.days - 1) continue;
    segments.push({
      id: `s-${e.id}`,
      eventId: e.id,
      lane,
      from: Math.max(0, from),
      to: Math.min(span.days - 1, to),
      label: lane === "ship" ? String(e.details?.routeName || e.details?.ship || e.title) : e.title,
      color: colorKey(e),
    });
  }
  // Schiff: unmittelbar anschliessende Einträge zu einem Balken
  const merged: BandSegment[] = [];
  for (const s of segments) {
    const prev = [...merged].reverse().find((m) => m.lane === s.lane);
    if (s.lane === "ship" && prev && s.from <= prev.to + 1) {
      prev.to = Math.max(prev.to, s.to);
      continue;
    }
    merged.push({ ...s });
  }
  const used = (["away", "ship", "stay", "car"] as BandLane[]).filter((l) => merged.some((s) => s.lane === l));
  const ti = todayIso ? daysBetween(span.start, todayIso) : null;
  return { days, segments: merged, todayIndex: ti != null && ti >= 0 && ti < span.days ? ti : null, lanes: used };
}

/* ─ Reise in Zahlen ─ */

export type TripNumbers = {
  days: number;
  nights: number;
  events: number;
  travelKm: number;
  flightMinutes: number;
  ports: number;
  countries: number;
  stays: number;
};

const num = (e: TripEvent, k: string): number | null => {
  const v = e.details?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Zahl aus Start-/Endzeit des Ereignisses, wenn keine Dauer angegeben ist (gleiche Zone angenommen). */
function spanMinutes(e: TripEvent): number | null {
  if (!e.startTime || !e.endTime) return null;
  const [h1, m1] = e.startTime.split(":").map(Number) as [number, number];
  const [h2, m2] = e.endTime.split(":").map(Number) as [number, number];
  let d = h2 * 60 + m2 - (h1 * 60 + m1);
  if (e.endDate && e.startDate) d += daysBetween(e.startDate, e.endDate) * 1440;
  return d > 0 ? d : null;
}

/** Land aus einer Adresse: letzter Teil nach dem Komma, wenn er wie ein Ländername aussieht. */
export function countryOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const last = address.split(",").pop()?.trim() ?? "";
  if (last.length < 3 || last.length > 40 || /\d/.test(last)) return null;
  return last;
}

export function tripNumbers(events: TripEvent[], span: TripSpan | null): TripNumbers {
  const confirmed = events.filter((e) => !e.status || e.status === "confirmed");
  const route = buildRoute(confirmed);
  let km = 0;
  for (const l of route.legs) km += haversineKm(route.stops[l.from]!, route.stops[l.to]!);
  let flight = 0;
  for (const e of confirmed.filter((x) => x.type === "Flug")) flight += num(e, "durationMinutes") ?? spanMinutes(e) ?? 0;
  const ports = confirmed.filter((e) => e.type === "Kreuzfahrt" && String(e.details?.entryKind ?? "") === "Hafen").length;
  const countries = new Set<string>();
  for (const e of confirmed) {
    const c = countryOfAddress(e.address);
    if (c) countries.add(c.toLowerCase());
  }
  const stays = confirmed.filter((e) => e.type === "Hotel" || e.type === "Unterkunft");
  let nights = 0;
  for (const e of stays) {
    if (e.startDate && e.endDate && e.endDate > e.startDate) nights += daysBetween(e.startDate, e.endDate);
  }
  if (nights === 0 && span) nights = Math.max(0, span.days - 1);
  return {
    days: span?.days ?? 0,
    nights,
    events: confirmed.length,
    travelKm: Math.round(km),
    flightMinutes: flight,
    ports,
    countries: countries.size,
    stays: stays.length,
  };
}

/* ─ Kasse ─ */

export type CategorySlice = { key: string; label: string; minor: number; share: number; colorIndex: number };

/** Ausgaben nach Kategorie, grösste zuerst; ab der 6. Kategorie zu «Weitere» vereint. */
export function costsByCategory(expenses: Expense[], max = 6): CategorySlice[] {
  const sums = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    if (e.direction === "income") continue;
    const key = (e.category ?? "").trim() || "Ohne Kategorie";
    sums.set(key, (sums.get(key) ?? 0) + e.amountBaseMinor);
    total += e.amountBaseMinor;
  }
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"));
  let list = sorted;
  if (sorted.length > max) {
    const head = sorted.slice(0, max - 1);
    const rest = sorted.slice(max - 1).reduce((n, [, v]) => n + v, 0);
    list = [...head, ["Weitere", rest]];
  }
  return list.map(([label, minor], i) => ({
    key: label,
    label,
    minor,
    share: total > 0 ? minor / total : 0,
    colorIndex: (i % 6) + 1,
  }));
}

export type DayCost = { date: string; minor: number; byCategory: Record<string, number> };

/** Ausgaben je Tag (Basiswährung), aufsteigend; ohne Datum entfallen sie. */
export function costsByDay(expenses: Expense[]): DayCost[] {
  const map = new Map<string, DayCost>();
  for (const e of expenses) {
    if (e.direction === "income" || !e.expenseDate) continue;
    const d = map.get(e.expenseDate) ?? { date: e.expenseDate, minor: 0, byCategory: {} };
    d.minor += e.amountBaseMinor;
    const c = (e.category ?? "").trim() || "Ohne Kategorie";
    d.byCategory[c] = (d.byCategory[c] ?? 0) + e.amountBaseMinor;
    map.set(e.expenseDate, d);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type BalanceBar = { memberId: number; name: string; netMinor: number; x: number; w: number; side: "pos" | "neg" | "zero" };

/** Salden um die Mittelachse; Breite proportional zum grössten Betrag (`half` = Breite einer Seite). */
export function balanceBars(balances: Balance[], half = 150): BalanceBar[] {
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.netMinor)));
  return balances.map((b) => {
    const w = Math.round((Math.abs(b.netMinor) / max) * half);
    return {
      memberId: b.memberId,
      name: b.displayName,
      netMinor: b.netMinor,
      w,
      x: b.netMinor >= 0 ? 0 : -w,
      side: b.netMinor > 0 ? "pos" : b.netMinor < 0 ? "neg" : "zero",
    };
  });
}

/** Ausgleichspfeile «wer zahlt wem», grösste zuerst. */
export function settlementArrows(transfers: Transfer[]): Transfer[] {
  return [...transfers].sort((a, b) => b.amountMinor - a.amountMinor);
}
