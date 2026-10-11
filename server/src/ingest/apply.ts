/**
 * Vorschläge in eine Reise übernehmen: vorhandene Ereignisse ergänzen (nur leere, nicht gesperrte Felder,
 * `applyExtraction`) oder neue anlegen (`createEvent`, Status je Prüfergebnis), Dokument verknüpfen,
 * Adressen geokodieren, Zeitzonen aus Koordinaten ableiten und «Zu prüfen» melden.
 */
import type { Db } from "../db/client";
import type { Catalog } from "../catalog/catalog";
import type { Geocoder } from "../geo/geocode";
import { autoGeocodeEvent } from "../geo/event-geocode";
import { timezoneFor } from "../meta/routes";
import * as T from "../trips/service";
import type { EventInput, EventRow, FieldMeta, FieldsMeta } from "../trips/service";
import { nameTokens } from "./crosscheck";
import { sameEvent, sigOfProposed, sigOfRow } from "./match";
import type { ProposedEvent, ProposedPassenger } from "./types";
import { compact, foldText } from "./values";

/** Schnittstelle des Pakets «notify»; wird defensiv aufgerufen (fehlt sie, bleibt es bei einer Logzeile). */
export type ReviewNotifier = { review?: (tripId: number, count: number) => unknown };

export type ApplyDeps = {
  db: Db;
  catalog: Catalog;
  geocoder: Geocoder | null;
  notifier: ReviewNotifier | null;
  now: () => Date;
  log: (msg: string) => void;
};

export type ApplyResult = {
  created: Array<{ eventId: number; status: T.EventStatus }>;
  merged: Array<{ eventId: number; fields: string[] }>;
  conflicts: Array<{ eventId: number; field: string; existing: unknown; proposed: unknown }>;
  skipped: Array<{ index: number; error: string }>;
  reviewCount: number;
};

/* ───────────── Mitreisende zuordnen ───────────── */

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mstr", "mister", "herr", "frau", "dr", "prof", "herrn", "chd", "inf"]);
const personTokens = (name: string) => nameTokens(name.replace(/[/,]/g, " ")).filter((t) => !TITLES.has(t));

type Person = { id: number; name: string };

export function matchParticipant(name: string, people: Person[]): Person | null {
  const pt = personTokens(name);
  if (!pt.length) return null;
  const hits = people.filter((p) => {
    const t = personTokens(p.name);
    return t.length > 0 && t.every((x) => pt.includes(x));
  });
  if (hits.length === 1) return hits[0]!;
  // Mehrere Treffer (gleicher Vorname bei Einzelnamen): lieber keinen als einen falschen.
  return null;
}

/* ───────────── Eingabe bauen ───────────── */

const COMMON_INPUT_KEYS = [
  "title", "startDate", "endDate", "startTime", "endTime", "startTz", "endTz", "location", "address", "provider",
  "bookingReference", "website", "phone", "priceMinor", "currency", "paymentStatus", "cancelUntil", "notes",
] as const;

type Built = {
  fields: Record<string, unknown>;
  details: Record<string, unknown>;
  meta: Record<string, { confidence: number; page: number | null; quote: string | null; needsReview?: boolean; source: "document" | "derived" }>;
  participantIds: number[];
};

function build(p: ProposedEvent, people: Person[], cat: Catalog): Built {
  const fields: Record<string, unknown> = {};
  for (const k of COMMON_INPUT_KEYS) {
    const v = p.common[k];
    if (v != null && v !== "") fields[k] = v;
  }
  const details: Record<string, unknown> = { ...p.details };
  const meta: Built["meta"] = {};
  const flagged = new Set(p.issues.filter((i) => i.needsReview && i.field).map((i) => i.field!));
  for (const [k, m] of Object.entries(p.meta)) {
    if (k in fields || k in details) {
      meta[k] = { source: m.source, confidence: m.confidence, page: m.page, quote: m.quote, ...(m.needsReview || flagged.has(k) ? { needsReview: true } : {}) };
    }
  }
  // Passagiere: nur Zugeordnete gehören in `details.passengers`; der Rest steht lesbar in den Notizen.
  const matched: Array<Record<string, unknown>> = [];
  const unmatched: ProposedPassenger[] = [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const pax of p.passengers) {
    const person = pax.name ? matchParticipant(pax.name, people) : null;
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      ids.push(person.id);
      matched.push({ participantId: person.id, ...pax.values });
    } else {
      unmatched.push(pax);
    }
  }
  const supportsPassengers = [...(cat.type(p.type)?.fields.values() ?? [])].some((f) => f.kind === "passengers");
  if (matched.length && supportsPassengers) {
    details.passengers = matched;
    const first = p.passengers.find((x) => x.name && matchParticipant(x.name, people));
    meta.passengers = { source: "document", confidence: Math.min(p.confidence, 0.95), page: first?.page ?? null, quote: first?.quote ?? null };
  } else if (matched.length) {
    unmatched.push(...p.passengers.filter((x) => x.name && matchParticipant(x.name, people)));
  }
  if (unmatched.length) {
    const lines = unmatched.map((x) => {
      const extra = Object.entries(x.values).map(([k, v]) => `${k === "seat" ? "Sitz" : k === "ticketNumber" ? "Ticket" : k === "coach" ? "Wagen" : k} ${v}`).join(", ");
      return `${x.name ?? "Person"}${extra ? ` (${extra})` : ""}`;
    });
    const text = `Passagiere laut Dokument: ${lines.join("; ")}`;
    const cur = typeof fields.notes === "string" ? fields.notes : "";
    fields.notes = cur ? `${cur}\n${text}` : text;
    meta.notes = meta.notes ?? { source: "document", confidence: 0.8, page: unmatched[0]?.page ?? null, quote: unmatched[0]?.quote ?? null };
  }
  // «Wer ist dabei»: nur, wenn alle Personen des Dokuments Mitreisenden entsprechen und es weniger als alle sind.
  const allMatched = p.passengers.length > 0 && unmatched.length === 0 && ids.length < people.length;
  return { fields, details, meta, participantIds: allMatched ? ids : [] };
}

/* ───────────── Übernahme ───────────── */

const parse = <X>(s: string | null | undefined, fb: X): X => {
  try {
    return s ? (JSON.parse(s) as X) : fb;
  } catch {
    return fb;
  }
};

const eqVal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function applyProposals(
  deps: ApplyDeps,
  args: { tripId: number; documentId: number; proposals: ProposedEvent[]; hintEventIds?: number[] }
): Promise<ApplyResult> {
  const { db } = deps;
  const { tripId, documentId, proposals } = args;
  const result: ApplyResult = { created: [], merged: [], conflicts: [], skipped: [], reviewCount: 0 };
  const trip = T.getTrip(db, tripId);
  const people: Person[] = T.listTravelers(db, tripId).map((p) => ({ id: p.id, name: p.display_name }));
  let rows: EventRow[] = T.eventRows(db, tripId);
  const hints = new Set(args.hintEventIds ?? []);
  const touched = new Set<number>();
  const usedHints = new Set<number>();
  /** Neue Ereignisse mit Datum ausserhalb des Reisezeitraums: sie dürfen die Reise nicht von allein verbreitern. */
  const outside = new Set<number>();
  const initialRange = { start: trip.start_date, end: trip.end_date };

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    try {
      const b = build(p, people, deps.catalog);
      const psig = sigOfProposed(p);
      let target = rows.find((r) => sameEvent(psig, sigOfRow(r)));
      if (!target && hints.size) {
        const same = proposals.filter((q) => q.type === p.type).length === 1;
        target = rows.find(
          (r) => hints.has(r.id) && !usedHints.has(r.id) && same && sameFamily(r.event_type, p.type) && (!r.start_date || !p.common.startDate || r.start_date === p.common.startDate)
        );
      }

      if (target) {
        const changed = mergeInto(deps, tripId, target, b, p, documentId);
        T.linkDocument(db, tripId, target.id, documentId);
        usedHints.add(target.id);
        const after = T.getEventRow(db, tripId, target.id);
        rows = rows.map((r) => (r.id === after.id ? after : r));
        touched.add(after.id);
        result.merged.push({ eventId: after.id, fields: changed.fields });
        result.conflicts.push(...changed.conflicts.map((c) => ({ eventId: after.id, ...c })));
        continue;
      }

      const fieldsMeta: FieldsMeta = {};
      for (const [k, m] of Object.entries(b.meta)) {
        const fm: FieldMeta = {
          source: m.source, documentId, confidence: round2(m.confidence),
          ...(m.page != null ? { page: m.page } : {}),
          ...(m.quote ? { quote: m.quote } : {}),
          ...(m.needsReview ? { needsReview: true } : {}),
        };
        if (m.source === "derived") delete fm.documentId;
        fieldsMeta[k] = fm;
      }
      if (b.participantIds.length) fieldsMeta.participantIds = { source: "document", documentId, confidence: round2(p.confidence) };

      const input: EventInput = {
        ...(b.fields as EventInput),
        type: p.type,
        details: b.details,
        status: p.status,
        sourceDocumentId: documentId,
        ...(b.participantIds.length ? { participantIds: b.participantIds } : {}),
      };
      const row = T.createEvent(db, tripId, input, { markManual: false, fieldsMeta });
      if (p.issues.some((x) => x.code === "outside_trip")) outside.add(row.id);
      T.linkDocument(db, tripId, row.id, documentId);
      rows.push(row);
      touched.add(row.id);
      result.created.push({ eventId: row.id, status: row.status });
      if (row.status !== "confirmed") result.reviewCount++;
    } catch (e) {
      result.skipped.push({ index: i, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (outside.size) restoreTripRange(db, tripId, initialRange, outside, deps.now().toISOString());

  // Dokument an die Reise hängen, auch wenn nichts Neues entstand.
  db.prepare("INSERT OR IGNORE INTO trip_documents (trip_id, document_id, created_at) VALUES (?, ?, ?)").run(tripId, documentId, deps.now().toISOString());

  // Adressen → Koordinaten (Flughäfen kommen aus der IATA-Tabelle), dann Zone aus den Koordinaten.
  for (const id of touched) {
    if (deps.geocoder) await autoGeocodeEvent(db, deps.geocoder, tripId, id).catch(() => undefined);
    deriveZone(deps, tripId, id);
  }

  if (result.reviewCount > 0) await notifyReview(deps, tripId, result.reviewCount);
  return result;
}

/** Reisezeitraum = bisheriger Zeitraum, erweitert nur um Ereignisse, die nicht ausserhalb liegen. */
function restoreTripRange(
  db: Db,
  tripId: number,
  initial: { start: string | null; end: string | null },
  exclude: Set<number>,
  at: string
): void {
  const ids = [...exclude];
  const r = db
    .prepare(
      `SELECT MIN(start_date) AS s, MAX(COALESCE(end_date, start_date)) AS e FROM trip_events
        WHERE trip_id = ? AND start_date IS NOT NULL AND id NOT IN (${ids.map(() => "?").join(",") || "NULL"})`
    )
    .get(tripId, ...ids) as { s: string | null; e: string | null };
  const pick = (a: string | null, b: string | null, min: boolean) => (a && b ? (min ? (a < b ? a : b) : a > b ? a : b) : a ?? b);
  const start = pick(initial.start, r.s, true);
  const end = pick(initial.end, r.e, false);
  db.prepare("UPDATE trips SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?").run(start, end, at, tripId);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sameFamily = (a: string, b: string) => (a === b) || ((a === "Hotel" || a === "Unterkunft") && (b === "Hotel" || b === "Unterkunft"));

function mergeInto(
  deps: ApplyDeps,
  tripId: number,
  target: EventRow,
  b: Built,
  p: ProposedEvent,
  documentId: number
): { fields: string[]; conflicts: Array<{ field: string; existing: unknown; proposed: unknown }> } {
  const { db } = deps;
  // Gruppen mit gleicher Sicherheit und Seite: `applyExtraction` kennt beides nur je Aufruf.
  const groups = new Map<string, { confidence: number; page: number | null; common: Record<string, unknown>; details: Record<string, unknown>; quotes: Record<string, string> }>();
  const group = (k: string) => {
    const m = b.meta[k];
    const conf = round2(m?.confidence ?? p.confidence);
    const key = `${conf}|${m?.page ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { confidence: conf, page: m?.page ?? null, common: {}, details: {}, quotes: {} };
      groups.set(key, g);
    }
    if (m?.quote) g.quotes[k] = m.quote;
    return g;
  };
  for (const [k, v] of Object.entries(b.fields)) {
    if (k === "title") continue; // Titel eines vorhandenen Ereignisses bleibt
    group(k).common[k] = v;
  }
  for (const [k, v] of Object.entries(b.details)) group(k).details[k] = v;

  const changed: string[] = [];
  for (const g of groups.values()) {
    const fields = { ...g.common, ...(Object.keys(g.details).length ? { details: g.details } : {}) } as Parameters<typeof T.applyExtraction>[3];
    const done = T.applyExtraction(db, tripId, target.id, fields, {
      documentId, confidence: g.confidence, ...(g.page != null ? { page: g.page } : {}), quotes: g.quotes,
    });
    changed.push(...done);
  }

  // Markierung «needsReview» an den tatsächlich übernommenen Feldern.
  const flagged = changed.filter((k) => b.meta[k]?.needsReview);
  if (flagged.length) {
    const row = T.getEventRow(db, tripId, target.id);
    const meta = parse<FieldsMeta>(row.fields_meta, {});
    for (const k of flagged) if (meta[k]) meta[k]!.needsReview = true;
    db.prepare("UPDATE trip_events SET fields_meta = ? WHERE id = ?").run(JSON.stringify(meta), target.id);
  }

  // Abweichungen zu bestehenden (nicht überschriebenen) Werten melden.
  const conflicts: Array<{ field: string; existing: unknown; proposed: unknown }> = [];
  const after = T.getEventRow(db, tripId, target.id);
  const details = parse<Record<string, unknown>>(after.details, {});
  const colOf: Record<string, unknown> = {
    startDate: after.start_date, endDate: after.end_date, startTime: after.start_time, endTime: after.end_time,
    startTz: after.start_tz, endTz: after.end_tz, location: after.location, address: after.address, provider: after.provider,
    bookingReference: after.booking_reference, website: after.website, phone: after.phone, priceMinor: after.price_minor,
    currency: after.currency, paymentStatus: after.payment_status, cancelUntil: after.cancel_until,
  };
  const significant = new Set(["startDate", "startTime", "endDate", "endTime", "bookingReference", "priceMinor", "flightNumber", "departureAirport", "arrivalAirport", "trainNumber", "cabin"]);
  for (const [k, v] of Object.entries(b.fields)) {
    if (!significant.has(k) || changed.includes(k)) continue;
    const cur = colOf[k];
    if (cur != null && cur !== "" && !eqVal(typeof cur === "string" ? compact(cur) : cur, typeof v === "string" ? compact(v) : v)) conflicts.push({ field: k, existing: cur, proposed: v });
  }
  for (const [k, v] of Object.entries(b.details)) {
    if (!significant.has(k) || changed.includes(k)) continue;
    const cur = details[k];
    if (cur != null && cur !== "" && foldText(String(cur)) !== foldText(String(v))) conflicts.push({ field: k, existing: cur, proposed: v });
  }
  return { fields: changed, conflicts };
}

/** `startTz` aus geokodierten Koordinaten, wenn die Zone von der Reisezone abweicht (Flüge: IATA-Tabelle). */
function deriveZone(deps: ApplyDeps, tripId: number, eventId: number): void {
  const { db } = deps;
  try {
    const trip = T.getTrip(db, tripId);
    const row = T.getEventRow(db, tripId, eventId);
    if (row.event_type === "Flug" || row.start_tz || row.lat == null || row.lon == null) return;
    const meta = parse<FieldsMeta>(row.fields_meta, {});
    if (meta.lat?.source !== "geocoded" || meta.startTz?.locked) return;
    const tz = timezoneFor(row.lat, row.lon);
    if (!tz || tz === trip.timezone) return;
    meta.startTz = { source: "derived", quote: `Koordinaten ${row.lat.toFixed(3)}, ${row.lon.toFixed(3)}` };
    db.prepare("UPDATE trip_events SET start_tz = ?, fields_meta = ?, updated_at = ? WHERE id = ?").run(tz, JSON.stringify(meta), deps.now().toISOString(), eventId);
  } catch {
    /* Zone bleibt leer */
  }
}

async function notifyReview(deps: ApplyDeps, tripId: number, count: number): Promise<void> {
  const n = deps.notifier as { review?: unknown } | null;
  if (n && typeof n.review === "function") {
    try {
      await (n.review as (t: number, c: number) => unknown).call(n, tripId, count);
      return;
    } catch (e) {
      deps.log(`[ingest] Benachrichtigung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  }
  deps.log(`[ingest] ${count} neue Vorschläge zu prüfen (Reise ${tripId})`);
}
