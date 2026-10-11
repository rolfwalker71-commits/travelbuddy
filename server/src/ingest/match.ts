/**
 * Dubletten und Zusammenführen: Wann sind zwei Ereignisse dieselbe Buchung?
 * Schlüssel: `bookingReference + Typ + Beginn`, `flightNumber + Beginn`, bei Hotels Name + Check-in.
 * Der Vergleich ist bewusst tolerant bei fehlenden Angaben (eine Seite ohne Datum passt zu jedem Datum),
 * aber nie bei widersprüchlichen (zwei verschiedene Daten sind zwei Ereignisse).
 */
import type { EventRow } from "../trips/service";
import { nameSimilarity } from "./crosscheck";
import type { ProposedEvent } from "./types";
import { compact } from "./values";

export type EventSig = {
  type: string;
  family: string;
  ref: string | null;
  startDate: string | null;
  startTime: string | null;
  flightNumber: string | null;
  trainNumber: string | null;
  dep: string | null;
  arr: string | null;
  name: string | null;
  title: string | null;
  entryKind: string | null;
  loc: string | null;
  origin: string | null;
  dest: string | null;
};

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const c = (v: unknown): string | null => {
  const t = s(v);
  return t ? compact(t) || null : null;
};
const familyOf = (type: string) => (type === "Hotel" || type === "Unterkunft" ? "stay" : type);

function sig(type: string, common: Record<string, unknown>, details: Record<string, unknown>, extraRef?: unknown): EventSig {
  return {
    type,
    family: familyOf(type),
    ref: c(common.bookingReference) ?? c(extraRef),
    startDate: s(common.startDate),
    startTime: s(common.startTime),
    flightNumber: c(details.flightNumber),
    trainNumber: c(details.trainNumber),
    dep: c(details.departureAirport),
    arr: c(details.arrivalAirport),
    name: s(common.provider) ?? s(common.title) ?? s(common.location),
    title: s(common.title),
    entryKind: s(details.entryKind),
    loc: s(common.location),
    origin: s(details.originPlace),
    dest: s(details.destinationPlace),
  };
}

export const sigOfProposed = (e: ProposedEvent): EventSig => sig(e.type, e.common, e.details, e.details.confirmationNumber);

export function sigOfRow(row: EventRow): EventSig {
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(row.details) as Record<string, unknown>;
  } catch {
    /* leer */
  }
  return sig(
    row.event_type,
    {
      bookingReference: row.booking_reference, startDate: row.start_date, startTime: row.start_time,
      provider: row.provider, title: row.title, location: row.location,
    },
    details,
    details.confirmationNumber
  );
}

export function sameEvent(a: EventSig, b: EventSig): boolean {
  if (a.family !== b.family) return false;
  const dateEq = Boolean(a.startDate && b.startDate && a.startDate === b.startDate);
  const dateCompat = !a.startDate || !b.startDate || dateEq;
  const timeCompat = !a.startTime || !b.startTime || a.startTime === b.startTime;
  const refEq = Boolean(a.ref && b.ref && a.ref === b.ref);
  const refCompat = !a.ref || !b.ref || refEq;

  switch (a.family) {
    case "Flug": {
      if (a.flightNumber && b.flightNumber) return a.flightNumber === b.flightNumber && dateCompat;
      if (a.dep && a.arr && b.dep && b.arr) return a.dep === b.dep && a.arr === b.arr && dateCompat && refCompat;
      return refEq && dateEq && timeCompat;
    }
    case "Zugreisen": {
      if (a.trainNumber && b.trainNumber) return a.trainNumber === b.trainNumber && dateCompat && timeCompat;
      const place = (x: string | null, y: string | null) => !x || !y || nameSimilarity(x, y) >= 0.6;
      if (refEq) return dateEq && timeCompat && place(a.origin, b.origin) && place(a.dest, b.dest);
      if (a.origin && b.origin && a.dest && b.dest) {
        return place(a.origin, b.origin) && place(a.dest, b.dest) && dateEq && timeCompat;
      }
      return false;
    }
    case "stay": {
      if (refEq && dateCompat) return true;
      if (a.name && b.name && nameSimilarity(a.name, b.name) >= 0.6 && dateEq) return true;
      return false;
    }
    case "Kreuzfahrt": {
      const kindOk = !a.entryKind || !b.entryKind || a.entryKind === b.entryKind;
      const locOk = !a.loc || !b.loc || nameSimilarity(a.loc, b.loc) >= 0.6;
      return kindOk && dateEq && locOk && refCompat;
    }
    default: {
      if (refEq && dateEq && timeCompat) return true;
      if (a.title && b.title && dateEq && timeCompat && nameSimilarity(a.title, b.title) >= 0.8) return true;
      return false;
    }
  }
}

/** Zwei Vorschläge derselben Buchung zu einem vereinen (Mehrfachtreffer aus Textteilen, Barcode + KI). */
export function mergeProposed(into: ProposedEvent, from: ProposedEvent): void {
  const take = <T extends Record<string, unknown>>(dst: T, src: T, meta: ProposedEvent["meta"], srcMeta: ProposedEvent["meta"]) => {
    for (const [k, v] of Object.entries(src)) {
      if (v == null || v === "") continue;
      const cur = dst[k];
      const cm = meta[k];
      const sm = srcMeta[k];
      if (cur == null || cur === "" || ((sm?.confidence ?? 0) > (cm?.confidence ?? 0) + 0.15 && cur !== v)) {
        (dst as Record<string, unknown>)[k] = v;
        if (sm) meta[k] = sm;
      }
    }
  };
  take(into.common, from.common, into.meta, from.meta);
  take(into.details, from.details, into.meta, from.meta);
  for (const [k, v] of Object.entries(from.placeAddresses)) if (!into.placeAddresses[k]) into.placeAddresses[k] = v;
  for (const p of from.passengers) {
    const known = into.passengers.find((q) => q.name && p.name && compact(q.name) === compact(p.name));
    if (known) known.values = { ...p.values, ...known.values };
    else into.passengers.push(p);
  }
  into.addressParts ??= from.addressParts;
  into.confidence = Math.max(into.confidence, from.confidence);
  for (const o of from.origins) if (!into.origins.includes(o)) into.origins.push(o);
  for (const i of from.issues) {
    if (!into.issues.some((j) => j.code === i.code && j.field === i.field && j.message === i.message)) into.issues.push(i);
  }
}

export function dedupeProposed(events: ProposedEvent[]): ProposedEvent[] {
  const out: ProposedEvent[] = [];
  const sigs: EventSig[] = [];
  for (const e of events) {
    const sg = sigOfProposed(e);
    const i = sigs.findIndex((x) => sameEvent(x, sg));
    if (i >= 0) {
      mergeProposed(out[i]!, e);
      sigs[i] = sigOfProposed(out[i]!);
    } else {
      out.push(e);
      sigs.push(sg);
    }
  }
  return out;
}
