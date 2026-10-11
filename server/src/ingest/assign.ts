/**
 * Reise-Zuordnung für Dokumente ohne Reise («Einwurf»): nach Buchungsnummer, Datumsüberlappung und Zielort der
 * bestehenden Reisen. Ist das Ergebnis nicht eindeutig, bleibt es bei einem Reisevorschlag (`proposedTrip`).
 */
import type { Db } from "../db/client";
import { addDays } from "../lib/dates";
import { airportCity } from "./normalize";
import type { Extraction, ProposedEvent } from "./types";
import { compact, foldText } from "./values";

export type TripSignals = {
  refs: string[];
  start: string | null;
  end: string | null;
  places: string[];
};

export type TripCandidate = { tripId: number; score: number; reasons: string[] };

export function signalsOf(events: ProposedEvent[], hint: Extraction["trip"] | null): TripSignals {
  const refs = new Set<string>();
  const places = new Set<string>();
  const dates: string[] = [];
  for (const e of events) {
    for (const v of [e.common.bookingReference, e.details.confirmationNumber, e.details.policyNumber]) {
      if (typeof v === "string" && compact(v).length >= 5) refs.add(compact(v));
    }
    for (const k of ["startDate", "endDate"]) {
      const v = e.common[k];
      if (typeof v === "string") dates.push(v);
    }
    if (e.type !== "Versicherung" && e.type !== "Visum") {
      for (const v of [e.common.location, e.addressParts?.city, e.details.pickupPlace, e.details.destinationPlace, e.details.venue]) {
        if (typeof v === "string" && v.trim()) places.add(v.trim());
      }
      const city = airportCity(e.details.arrivalAirport);
      if (city) places.add(city);
    }
  }
  if (hint?.destination) places.add(hint.destination);
  for (const d of [hint?.startDate, hint?.endDate]) if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
  dates.sort();
  return { refs: [...refs], start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, places: [...places] };
}

type TripRow = { id: number; title: string; destination: string | null; start_date: string | null; end_date: string | null };

export function rankTrips(db: Db, sig: TripSignals, toleranceDays = 3): TripCandidate[] {
  const trips = db.prepare("SELECT id, title, destination, start_date, end_date FROM trips").all() as TripRow[];
  const refTrips = new Set<number>();
  if (sig.refs.length) {
    const rows = db
      .prepare("SELECT trip_id, booking_reference, details FROM trip_events WHERE booking_reference IS NOT NULL OR details != '{}'")
      .all() as Array<{ trip_id: number; booking_reference: string | null; details: string }>;
    const want = new Set(sig.refs);
    for (const r of rows) {
      if (r.booking_reference && want.has(compact(r.booking_reference))) refTrips.add(r.trip_id);
      else if (r.details && r.details !== "{}") {
        try {
          const d = JSON.parse(r.details) as Record<string, unknown>;
          for (const k of ["confirmationNumber", "policyNumber"]) {
            if (typeof d[k] === "string" && want.has(compact(d[k] as string))) refTrips.add(r.trip_id);
          }
        } catch {
          /* ignorieren */
        }
      }
    }
  }
  const places = sig.places.map(foldText);
  const out: TripCandidate[] = [];
  for (const t of trips) {
    let score = 0;
    const reasons: string[] = [];
    if (refTrips.has(t.id)) {
      score += 100;
      reasons.push("Buchungsnummer");
    }
    if (sig.start && t.start_date) {
      const lo = addDays(t.start_date, -toleranceDays);
      const hi = addDays(t.end_date ?? t.start_date, toleranceDays);
      const dEnd = sig.end ?? sig.start;
      if (sig.start <= hi && dEnd >= lo) {
        score += 40;
        reasons.push("Datum");
        if (sig.start >= t.start_date && dEnd <= (t.end_date ?? t.start_date)) score += 20;
      }
    }
    const names = [t.destination, ...(t.title ? t.title.split(/[\s,;:–-]+/) : [])]
      .filter((x): x is string => Boolean(x))
      .map(foldText)
      .filter((x) => x.length >= 4);
    if (names.some((n) => places.some((p) => p.includes(n) || (p.length >= 4 && n.includes(p))))) {
      score += 25;
      reasons.push("Zielort");
    }
    if (score > 0) out.push({ tripId: t.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.tripId - b.tripId);
}

/** Eindeutiger Treffer oder null (dann bleibt es beim Vorschlag). */
export function pickTrip(c: TripCandidate[]): number | null {
  const [a, b] = c;
  if (!a) return null;
  if (a.score >= 100 && (!b || b.score < a.score)) return a.tripId;
  if (a.score >= 60 && (!b || b.score <= a.score - 25)) return a.tripId;
  return null;
}
