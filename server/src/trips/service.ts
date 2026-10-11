import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors";
import { getCatalog } from "../catalog/catalog";
import { buildIcsCalendar, type CalendarEvent } from "./ics";
import { mediaUrls, tripEventMediaUrls } from "../media/store";
import { appTimeZone, todayLocal } from "../lib/dates";
import { isValidTimeZone } from "../lib/tz";
import { findAirport } from "../meta/airports";
import { derivePlaces, publicPlaces, PLACE_ROLES, type PlaceCoords, type PlaceRole, type PlaceWithQuery } from "./places";
import { eventEmoji } from "./emoji";
import * as L from "../ledgers/service";

const now = () => new Date().toISOString();

/* ───────────── Typen ───────────── */

export const TRIP_STATUSES = ["planned", "active", "done", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const EVENT_STATUSES = ["confirmed", "proposed", "needs_review"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const PAYMENT_STATUSES = ["open", "paid", "deposit", "onsite"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type TripPhase = "upcoming" | "active" | "past";

export type TripRow = {
  id: number;
  title: string;
  status: TripStatus;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  summary: string | null;
  notes: string | null;
  home_currency: string;
  timezone: string;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
};

export type ParticipantRow = L.MemberRow;

export type EventRow = {
  id: number;
  trip_id: number;
  event_type: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  start_tz: string | null;
  end_tz: string | null;
  location: string | null;
  address: string | null;
  provider: string | null;
  booking_reference: string | null;
  website: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  place_coords: string;
  notes: string | null;
  details: string;
  status: EventStatus;
  price_minor: number | null;
  currency: string | null;
  payment_status: PaymentStatus | null;
  paid_by_participant_id: number | null;
  cancel_until: string | null;
  expense_id: number | null;
  fields_meta: string;
  source_document_id: number | null;
  sort_key: number;
  created_at: string;
  updated_at: string;
};

export type FieldMeta = {
  source: "manual" | "document" | "derived" | "geocoded";
  confidence?: number;
  documentId?: number;
  page?: number;
  quote?: string;
  locked?: boolean;
  /** Die Analyse ist sich bei diesem Feld nicht sicher oder hat einen Widerspruch gefunden: bitte prüfen. */
  needsReview?: boolean;
};
export type FieldsMeta = Record<string, FieldMeta>;

/** Schreibbare Felder eines Ereignisses (API-Namen). */
export type EventInput = {
  type?: string;
  title?: string;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  startTz?: string | null;
  endTz?: string | null;
  location?: string | null;
  address?: string | null;
  provider?: string | null;
  bookingReference?: string | null;
  website?: string | null;
  phone?: string | null;
  lat?: number | null;
  lon?: number | null;
  notes?: string | null;
  details?: Record<string, unknown> | null;
  status?: EventStatus;
  priceMinor?: number | null;
  currency?: string | null;
  paymentStatus?: PaymentStatus | null;
  paidByParticipantId?: number | null;
  cancelUntil?: string | null;
  participantIds?: number[];
  /** Nur Lesezugriff über die API; interne Aufrufer (Analyse) setzen es beim Anlegen. */
  sourceDocumentId?: number | null;
  /** Koordinaten weiterer Orte je Rolle von Hand setzen (null entfernt). */
  placeCoords?: Partial<Record<PlaceRole, { lat: number; lon: number } | null>>;
  /** Sperren auf einzelnen Feldern setzen/aufheben (`null` entfernt den Eintrag). */
  fieldsMeta?: Record<string, { locked?: boolean } | null>;
};

/* ───────────── Zugriff ───────────── */

export function getTrip(db: Db, tripId: number): TripRow {
  const t = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as TripRow | undefined;
  if (!t) throw notFound("Reise");
  return t;
}

export function assertTripAccess(db: Db, user: AuthUser, tripId: number): TripRow {
  const trip = getTrip(db, tripId);
  // Administratoren sehen alles; alle anderen nur Reisen, auf denen sie als Teilnehmer eingetragen sind.
  if (user.isAdmin) return trip;
  const hit = db.prepare("SELECT 1 FROM participants WHERE trip_id = ? AND user_id = ?").get(tripId, user.id);
  if (!hit) throw forbidden("Kein Zugriff auf diese Reise");
  return trip;
}

function resolveTraveler(db: Db, shareToken: string): { trip: TripRow; traveler: ParticipantRow } {
  const traveler = (db
    .prepare("SELECT * FROM participants WHERE share_token = ? AND share_revoked_at IS NULL AND trip_id IS NOT NULL")
    .get(shareToken) ??
    // Zweiter Token einer importierten Person (HomeBuddy kannte je Person zwei Links), siehe 020_import_map.sql.
    db
      .prepare(
        `SELECT p.* FROM participant_token_aliases a JOIN participants p ON p.id = a.participant_id
          WHERE a.alias_token = ? AND a.primary_token = p.share_token AND p.share_revoked_at IS NULL AND p.trip_id IS NOT NULL`
      )
      .get(shareToken)) as ParticipantRow | undefined;
  if (!traveler) throw notFound("Einladung");
  return { trip: getTrip(db, traveler.trip_id!), traveler };
}

export function ledgerIdOfTrip(db: Db, tripId: number): number | null {
  return (db.prepare("SELECT id FROM ledgers WHERE trip_id = ?").get(tripId) as { id: number } | undefined)?.id ?? null;
}

/* ───────────── Validierung ───────────── */

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function checkDates(start: string | null | undefined, end: string | null | undefined, label: string) {
  if (start != null && !isDate(start)) throw badRequest(`${label}: Startdatum erwartet YYYY-MM-DD`);
  if (end != null && !isDate(end)) throw badRequest(`${label}: Enddatum erwartet YYYY-MM-DD`);
  if (start && end && end < start) throw new HttpError(422, "invalid_range", `${label}: Ende liegt vor dem Start`);
}

function checkTimeZone(tz: string | null | undefined, label: string): string | null {
  if (tz == null || tz === "") return null;
  if (!isValidTimeZone(tz)) throw new HttpError(422, "invalid_timezone", `${label}: «${tz}» ist keine gültige Zeitzone (IANA, z. B. Europe/Zurich)`);
  return tz;
}

function checkCurrency(c: string | null | undefined): string | null {
  if (c == null || c === "") return null;
  if (!/^[A-Za-z]{3}$/.test(c)) throw badRequest("Währung erwartet einen dreistelligen Code (z. B. CHF)");
  return c.toUpperCase();
}

/* ───────────── Reisen ───────────── */

export type TripInput = {
  title: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  status?: TripStatus;
  homeCurrency?: string;
  timezone?: string;
  travelers?: { displayName: string; email?: string | null; userId?: number | null }[];
};

export function createTrip(db: Db, user: AuthUser, input: TripInput): number {
  const title = input.title.trim();
  if (!title) throw badRequest("Titel erforderlich");
  checkDates(input.startDate, input.endDate, "Reise");
  const tz = checkTimeZone(input.timezone, "Reisezone") ?? appTimeZone();
  const home = checkCurrency(input.homeCurrency) ?? "CHF";
  const ts = now();
  return db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO trips (title, status, destination, start_date, end_date, summary, notes, home_currency, timezone,
                            created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title, input.status ?? "planned", input.destination?.trim() || null,
        input.startDate ?? null, input.endDate ?? null, input.summary?.trim() || null,
        input.notes?.trim() || null, home, tz, user.id, ts, ts
      );
    const tripId = Number(res.lastInsertRowid);
    // Die Reisekasse entsteht mit der Reise (1:1).
    L.insertLedgerRow(db, { title: `Reisekasse: ${title}`, baseCurrency: home, tripId, userId: user.id });
    addTraveler(db, tripId, { displayName: user.displayName, email: user.email, userId: user.id }, 0);
    const linked = new Set<number>([user.id]);
    (input.travelers ?? []).forEach((t, i) => {
      if (t.userId != null) {
        if (linked.has(t.userId)) return;
        linked.add(t.userId);
      }
      addTraveler(db, tripId, t, i + 1);
    });
    return tripId;
  })();
}

export function updateTrip(
  db: Db,
  tripId: number,
  patch: Partial<Omit<TripInput, "travelers">> & { destination?: string | null; summary?: string | null; notes?: string | null }
): void {
  const t = getTrip(db, tripId);
  const start = patch.startDate !== undefined ? patch.startDate : t.start_date;
  const end = patch.endDate !== undefined ? patch.endDate : t.end_date;
  checkDates(start, end, "Reise");
  const title = patch.title !== undefined ? patch.title.trim() : t.title;
  if (!title) throw badRequest("Titel erforderlich");
  const tz = patch.timezone !== undefined ? checkTimeZone(patch.timezone, "Reisezone") ?? t.timezone : t.timezone;
  const home = patch.homeCurrency !== undefined ? checkCurrency(patch.homeCurrency) ?? t.home_currency : t.home_currency;
  const pick = <T>(n: T | undefined, p: T) => (n === undefined ? p : n);
  db.transaction(() => {
    db.prepare(
      `UPDATE trips SET title = ?, status = ?, destination = ?, start_date = ?, end_date = ?,
              summary = ?, notes = ?, home_currency = ?, timezone = ?, updated_at = ? WHERE id = ?`
    ).run(
      title, patch.status ?? t.status, pick(patch.destination, t.destination), start, end,
      pick(patch.summary, t.summary), pick(patch.notes, t.notes), home, tz, now(), tripId
    );
    const ledger = db.prepare("SELECT id, title, base_currency FROM ledgers WHERE trip_id = ?").get(tripId) as
      | { id: number; title: string; base_currency: string }
      | undefined;
    if (ledger) {
      // Titel der Reisekasse folgt dem der Reise, solange er noch die Vorgabe «Reisekasse: …» trägt.
      const follow = ledger.title === `Reisekasse: ${t.title}` ? { title: `Reisekasse: ${title}` } : {};
      // Die Basiswährung folgt der Heimwährung; 409 `currency_locked`, sobald Ausgaben existieren.
      const cur = home !== ledger.base_currency ? { baseCurrency: home } : {};
      if (Object.keys(follow).length || Object.keys(cur).length) L.updateLedger(db, ledger.id, { ...follow, ...cur });
    }
  })();
}

/**
 * Reise löschen. Die Reisekasse gehört dazu; hat sie Buchungen, ist `withLedger` nötig (409 `has_ledger_entries`),
 * damit nicht versehentlich Ausgaben verschwinden.
 */
export function deleteTrip(db: Db, tripId: number, opts: { withLedger?: boolean } = {}): void {
  getTrip(db, tripId);
  const ledgerId = ledgerIdOfTrip(db, tripId);
  if (ledgerId != null && !opts.withLedger) {
    const used =
      db.prepare("SELECT 1 FROM expenses WHERE ledger_id = ? LIMIT 1").get(ledgerId) ||
      db.prepare("SELECT 1 FROM settlements WHERE ledger_id = ? LIMIT 1").get(ledgerId);
    if (used) {
      throw conflict(
        "Die Reisekasse hat Buchungen. Zum Löschen der Reise samt Reisekasse «withLedger=1» angeben.",
        "has_ledger_entries"
      );
    }
  }
  db.prepare("DELETE FROM trips WHERE id = ?").run(tripId);
}

/* ───────────── Teilnehmer ───────────── */

export function addTraveler(
  db: Db,
  tripId: number,
  input: { displayName: string; email?: string | null; userId?: number | null },
  sortKey?: number
): ParticipantRow {
  const name = input.displayName.trim();
  if (!name) throw badRequest("Name erforderlich");
  if (input.userId != null) {
    const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(input.userId);
    if (!u) throw new HttpError(422, "invalid_user", "Benutzer nicht gefunden");
  }
  const id = L.insertParticipant(db, {
    tripId,
    ledgerId: ledgerIdOfTrip(db, tripId),
    displayName: name,
    email: input.email,
    userId: input.userId,
    sortKey,
  });
  return db.prepare("SELECT * FROM participants WHERE id = ?").get(id) as ParticipantRow;
}

function getTraveler(db: Db, tripId: number, travelerId: number): ParticipantRow {
  const t = db
    .prepare("SELECT * FROM participants WHERE id = ? AND trip_id = ?")
    .get(travelerId, tripId) as ParticipantRow | undefined;
  if (!t) throw notFound("Teilnehmer");
  return t;
}

/** Name, E-Mail oder verknüpftes Konto eines Teilnehmers ändern (userId null löst die Verknüpfung). */
export function updateTraveler(
  db: Db,
  tripId: number,
  travelerId: number,
  patch: { displayName?: string; email?: string | null; userId?: number | null; coupleId?: number | null }
): ParticipantRow {
  const t = getTraveler(db, tripId, travelerId);
  const displayName = patch.displayName !== undefined ? patch.displayName.trim() : t.display_name;
  if (!displayName) throw badRequest("Name erforderlich");
  const userId = patch.userId !== undefined ? patch.userId : t.user_id;
  if (userId != null && userId !== t.user_id) {
    const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId);
    if (!u) throw new HttpError(422, "invalid_user", "Benutzer nicht gefunden");
    const taken = db
      .prepare("SELECT 1 FROM participants WHERE trip_id = ? AND user_id = ? AND id <> ?")
      .get(tripId, userId, travelerId);
    if (taken) throw conflict("Dieses Konto ist bereits einem anderen Teilnehmer zugeordnet", "user_already_traveler");
  }
  const coupleId = patch.coupleId !== undefined ? patch.coupleId : t.couple_id;
  if (coupleId != null) {
    const ledgerId = ledgerIdOfTrip(db, tripId);
    const c = db.prepare("SELECT 1 FROM ledger_couples WHERE id = ? AND ledger_id = ?").get(coupleId, ledgerId);
    if (!c) throw new HttpError(422, "invalid_couple", "Paar gehört nicht zu dieser Reise");
  }
  db.prepare("UPDATE participants SET display_name = ?, email = ?, user_id = ?, couple_id = ? WHERE id = ?").run(
    displayName,
    patch.email !== undefined ? patch.email : t.email,
    userId,
    coupleId,
    travelerId
  );
  return getTraveler(db, tripId, travelerId);
}

/** Alle Reisen mit der Angabe, ob das Konto sie sehen darf (Verwaltung, nur für Administratoren). */
export function tripAssignmentsForUser(db: Db, userId: number) {
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.start_date, t.end_date,
              EXISTS (SELECT 1 FROM participants p WHERE p.trip_id = t.id AND p.user_id = ?) AS assigned
         FROM trips t
        ORDER BY COALESCE(t.start_date, '9999-12-31') DESC, t.id DESC`
    )
    .all(userId) as Array<{ id: number; title: string; status: string; start_date: string | null; end_date: string | null; assigned: number }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    assigned: r.assigned === 1,
  }));
}

/**
 * Legt fest, welche Reisen ein Konto sehen darf. Neu zugewiesen: Das Konto wird als Teilnehmer eingetragen.
 * Entzogen: Die Verknüpfung wird gelöst, der Teilnehmer bleibt als Gast ohne Konto in der Reise
 * (Name, Gäste-Link und bereits erfasste Kommentare bleiben erhalten).
 */
export function setTripsForUser(db: Db, userId: number, tripIds: number[]): void {
  const user = db.prepare("SELECT id, display_name, email FROM users WHERE id = ?").get(userId) as
    | { id: number; display_name: string; email: string | null }
    | undefined;
  if (!user) throw notFound("Benutzer");
  const wanted = new Set(tripIds);
  const known = new Set((db.prepare("SELECT id FROM trips").all() as { id: number }[]).map((r) => r.id));
  for (const id of wanted) {
    if (!known.has(id)) throw new HttpError(422, "invalid_trip", `Reise ${id} existiert nicht`);
  }
  db.transaction(() => {
    const links = db.prepare("SELECT id, trip_id FROM participants WHERE user_id = ? AND trip_id IS NOT NULL").all(userId) as {
      id: number;
      trip_id: number;
    }[];
    const linked = new Set(links.map((l) => l.trip_id));
    for (const l of links) {
      if (!wanted.has(l.trip_id)) db.prepare("UPDATE participants SET user_id = NULL WHERE id = ?").run(l.id);
    }
    for (const tripId of wanted) {
      if (linked.has(tripId)) continue;
      addTraveler(db, tripId, { displayName: user.display_name, email: user.email, userId });
    }
  })();
}

export function removeTraveler(db: Db, tripId: number, travelerId: number): void {
  getTraveler(db, tripId, travelerId);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM participants WHERE trip_id = ?").get(tripId) as { n: number }).n;
  if (count <= 1) throw conflict("Eine Reise braucht mindestens einen Teilnehmer", "last_traveler");
  L.deleteParticipant(db, travelerId);
}

/** Link erneuern oder widerrufen. Ein Token gilt für Reise (`/t/…`) und Reisekasse (`/g/…`) zugleich. */
export function rotateTravelerShare(db: Db, tripId: number, travelerId: number, revoke: boolean): ParticipantRow {
  getTraveler(db, tripId, travelerId);
  if (revoke) {
    db.prepare("UPDATE participants SET share_revoked_at = ? WHERE id = ?").run(now(), travelerId);
  } else {
    db.prepare("UPDATE participants SET share_token = ?, share_revoked_at = NULL WHERE id = ?").run(L.newShareToken(), travelerId);
  }
  return getTraveler(db, tripId, travelerId);
}

/* ───────────── Ereignisse: Zustand, Normalisierung, Schreiben ───────────── */

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** Skalare Felder: API-Name → Spalte. */
const SCALAR: Array<[keyof EventInput & string, keyof EventRow & string]> = [
  ["type", "event_type"],
  ["title", "title"],
  ["startDate", "start_date"],
  ["endDate", "end_date"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["startTz", "start_tz"],
  ["endTz", "end_tz"],
  ["location", "location"],
  ["address", "address"],
  ["provider", "provider"],
  ["bookingReference", "booking_reference"],
  ["website", "website"],
  ["phone", "phone"],
  ["lat", "lat"],
  ["lon", "lon"],
  ["notes", "notes"],
  ["status", "status"],
  ["priceMinor", "price_minor"],
  ["currency", "currency"],
  ["paymentStatus", "payment_status"],
  ["paidByParticipantId", "paid_by_participant_id"],
  ["cancelUntil", "cancel_until"],
];

type EventState = {
  type: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  startTz: string | null;
  endTz: string | null;
  location: string | null;
  address: string | null;
  provider: string | null;
  bookingReference: string | null;
  website: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  status: EventStatus;
  priceMinor: number | null;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  paidByParticipantId: number | null;
  cancelUntil: string | null;
  details: Record<string, unknown>;
  participantIds: number[];
  placeCoords: PlaceCoords;
};

function emptyState(): EventState {
  return {
    type: "Ausflug", title: "", startDate: null, endDate: null, startTime: null, endTime: null,
    startTz: null, endTz: null, location: null, address: null, provider: null, bookingReference: null,
    website: null, phone: null, lat: null, lon: null, notes: null, status: "confirmed", priceMinor: null,
    currency: null, paymentStatus: null, paidByParticipantId: null, cancelUntil: null, details: {},
    participantIds: [], placeCoords: {},
  };
}

function stateFromRow(db: Db, e: EventRow): EventState {
  const s = emptyState();
  for (const [api, col] of SCALAR) (s as Record<string, unknown>)[api] = e[col];
  s.details = parseJson(e.details, {});
  s.placeCoords = parseJson(e.place_coords, {});
  s.participantIds = (db.prepare("SELECT participant_id FROM event_participants WHERE event_id = ? ORDER BY participant_id").all(e.id) as {
    participant_id: number;
  }[]).map((r) => r.participant_id);
  return s;
}

const trimText = (v: string | null | undefined): string | null => (v == null ? null : v.trim() || null);

function tripParticipantIds(db: Db, tripId: number): Set<number> {
  return new Set(
    (db.prepare("SELECT id FROM participants WHERE trip_id = ?").all(tripId) as { id: number }[]).map((r) => r.id)
  );
}

/** Validiert den ganzen Zustand (Pflichtregeln, Katalog) und bereinigt Werte. */
function normalizeState(db: Db, trip: TripRow, s: EventState): EventState {
  const cat = getCatalog();
  const typeId = cat.resolveTypeId(s.type);
  if (!typeId) {
    throw new HttpError(422, "invalid_details", `Unbekannter Ereignistyp «${s.type}». Erlaubt: ${cat.typeIds.join(", ")}`, {
      fields: [{ field: "type", message: "unbekannt" }],
    });
  }
  const title = s.title.trim();
  if (!title) throw badRequest("Titel erforderlich");
  if (s.startTime != null && !isTime(s.startTime)) throw badRequest("Startzeit erwartet HH:mm");
  if (s.endTime != null && !isTime(s.endTime)) throw badRequest("Endzeit erwartet HH:mm");
  checkDates(s.startDate, s.endDate, "Ereignis");
  if (s.cancelUntil != null && !isDate(s.cancelUntil)) throw badRequest("Stornofrist erwartet YYYY-MM-DD");
  if (s.priceMinor != null && (!Number.isSafeInteger(s.priceMinor) || s.priceMinor < 0)) {
    throw badRequest("Preis: ganzzahliger Betrag in Minor Units (≥ 0) erwartet");
  }
  const participants = tripParticipantIds(db, trip.id);
  const ids = [...new Set(s.participantIds)];
  for (const id of ids) {
    if (!participants.has(id)) throw new HttpError(422, "invalid_participant", `Teilnehmer ${id} gehört nicht zu dieser Reise`);
  }
  if (s.paidByParticipantId != null && !participants.has(s.paidByParticipantId)) {
    throw new HttpError(422, "invalid_participant", "Zahler gehört nicht zu dieser Reise");
  }
  const bookingRef = trimText(s.bookingReference);
  const currency = checkCurrency(s.currency) ?? (s.priceMinor != null ? trip.home_currency : null);
  const out: EventState = {
    ...s,
    type: typeId,
    title,
    startTz: checkTimeZone(s.startTz, "Zeitzone Beginn"),
    endTz: checkTimeZone(s.endTz, "Zeitzone Ende"),
    location: trimText(s.location),
    address: trimText(s.address),
    provider: trimText(s.provider),
    bookingReference: bookingRef ? bookingRef.toUpperCase() : null,
    website: trimText(s.website),
    phone: trimText(s.phone),
    notes: trimText(s.notes),
    currency,
    participantIds: ids,
    details: cat.validateDetails(typeId, s.details, { participantIds: participants }),
  };
  if (out.paymentStatus != null && !(PAYMENT_STATUSES as readonly string[]).includes(out.paymentStatus)) {
    throw badRequest("Zahlungsstatus ungültig");
  }
  return out;
}

const isEmpty = (v: unknown) => v == null || v === "";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Flug: Zeitzonen und Koordinaten aus den IATA-Codes vorbelegen. Nur, wenn das Feld leer ist oder seine Herkunft
 * «derived» ist und nicht gesperrt (dann folgt es einem geänderten Flughafen).
 */
function prefillFromAirports(state: EventState, meta: FieldsMeta, touched: Set<string>): void {
  if (state.type !== "Flug") return;
  const dep = findAirport(state.details.departureAirport as string | undefined);
  const arr = findAirport(state.details.arrivalAirport as string | undefined);
  const mayFill = (field: string, current: unknown) =>
    isEmpty(current) || (meta[field]?.source === "derived" && !meta[field]?.locked);
  const setDerived = (field: keyof EventState & string, value: string | number, quote: string) => {
    (state as Record<string, unknown>)[field] = value;
    meta[field] = { source: "derived", quote };
    touched.add(field);
  };
  if (dep && mayFill("startTz", state.startTz)) setDerived("startTz", dep.tz, `IATA ${dep.iata}`);
  if (arr && mayFill("endTz", state.endTz)) setDerived("endTz", arr.tz, `IATA ${arr.iata}`);
  // Koordinaten des Ereignisses = Abflughafen (die Ankunft steht in places[] mit Koordinaten aus der Tabelle).
  if (dep && mayFill("lat", state.lat) && mayFill("lon", state.lon)) {
    setDerived("lat", dep.lat, `IATA ${dep.iata}`);
    setDerived("lon", dep.lon, `IATA ${dep.iata}`);
  }
}

function persistParticipants(db: Db, eventId: number, ids: number[]): void {
  db.prepare("DELETE FROM event_participants WHERE event_id = ?").run(eventId);
  const ins = db.prepare("INSERT INTO event_participants (event_id, participant_id) VALUES (?, ?)");
  for (const id of ids) ins.run(eventId, id);
}

function toColumns(s: EventState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [api, col] of SCALAR) o[col] = (s as Record<string, unknown>)[api] ?? null;
  return o;
}

export function getEventRow(db: Db, tripId: number, eventId: number): EventRow {
  const e = db
    .prepare("SELECT * FROM trip_events WHERE id = ? AND trip_id = ?")
    .get(eventId, tripId) as EventRow | undefined;
  if (!e) throw notFound("Ereignis");
  return e;
}

/** Felder, die ein Aufrufer in `input` gesetzt hat (ohne Sonderfelder). */
function providedKeys(input: EventInput): string[] {
  return Object.keys(input).filter((k) => !["details", "participantIds", "placeCoords", "fieldsMeta", "sourceDocumentId"].includes(k) && (input as Record<string, unknown>)[k] !== undefined);
}

function applyManualMeta(
  meta: FieldsMeta,
  before: EventState,
  after: EventState,
  input: EventInput
): Set<string> {
  const touched = new Set<string>();
  const lock = (field: string) => {
    meta[field] = { source: "manual", locked: true };
    touched.add(field);
  };
  for (const k of providedKeys(input)) {
    if (!same((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k])) lock(k);
  }
  if (input.participantIds !== undefined && !same(before.participantIds, after.participantIds)) lock("participantIds");
  if (input.details !== undefined) {
    const keys = new Set([...Object.keys(before.details), ...Object.keys(after.details)]);
    for (const k of keys) if (!same(before.details[k], after.details[k])) lock(k);
  }
  // Sind Koordinaten von Hand gesetzt, sind beide gesperrt.
  if (touched.has("lat") || touched.has("lon")) {
    lock("lat");
    lock("lon");
  }
  return touched;
}

function applyFieldsMetaPatch(meta: FieldsMeta, patch: EventInput["fieldsMeta"]) {
  if (!patch) return;
  for (const [field, v] of Object.entries(patch)) {
    if (field.length > 60) continue;
    if (v === null) {
      delete meta[field];
    } else if (typeof v.locked === "boolean") {
      const cur = meta[field];
      meta[field] = { ...(cur ?? { source: "manual" }), locked: v.locked };
    }
  }
}

function mergePlaceCoords(cur: PlaceCoords, patch: EventInput["placeCoords"]): PlaceCoords {
  if (!patch) return cur;
  const next: PlaceCoords = { ...cur };
  for (const [role, v] of Object.entries(patch)) {
    if (!(PLACE_ROLES as readonly string[]).includes(role)) {
      throw badRequest(`placeCoords: unbekannte Rolle «${role}»`);
    }
    if (v === null) delete next[role as PlaceRole];
    else if (v) {
      if (!(Math.abs(v.lat) <= 90 && Math.abs(v.lon) <= 180)) throw badRequest("placeCoords: ungültige Koordinaten");
      next[role as PlaceRole] = { lat: v.lat, lon: v.lon, source: "manual" };
    }
  }
  return next;
}

export function createEvent(
  db: Db,
  tripId: number,
  input: EventInput,
  opts: { fieldsMeta?: FieldsMeta; markManual?: boolean } = {}
): EventRow {
  const trip = getTrip(db, tripId);
  const base = emptyState();
  for (const k of providedKeys(input)) (base as Record<string, unknown>)[k] = (input as Record<string, unknown>)[k];
  if (input.details) base.details = input.details as Record<string, unknown>;
  if (input.participantIds) base.participantIds = input.participantIds;
  const state = normalizeState(db, trip, base);
  const meta: FieldsMeta = { ...(opts.fieldsMeta ?? {}) };
  if (opts.markManual !== false) {
    applyManualMeta(meta, emptyState(), state, input);
  }
  prefillFromAirports(state, meta, new Set());
  const placeCoords = mergePlaceCoords({}, input.placeCoords);
  applyFieldsMetaPatch(meta, input.fieldsMeta);
  const ts = now();
  const sort = (db.prepare("SELECT COALESCE(MAX(sort_key), 0) + 1 AS n FROM trip_events WHERE trip_id = ?").get(tripId) as { n: number }).n;
  const cols = toColumns(state);
  const names = Object.keys(cols);
  const res = db
    .prepare(
      `INSERT INTO trip_events (trip_id, ${names.join(", ")}, place_coords, details, fields_meta, source_document_id,
                                sort_key, created_at, updated_at)
       VALUES (?, ${names.map(() => "?").join(", ")}, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tripId, ...names.map((n) => cols[n]), JSON.stringify(placeCoords), JSON.stringify(state.details),
      JSON.stringify(meta), input.sourceDocumentId ?? null, sort, ts, ts
    );
  const id = Number(res.lastInsertRowid);
  persistParticipants(db, id, state.participantIds);
  widenTripDates(db, tripId);
  return getEventRow(db, tripId, id);
}

export function updateEvent(db: Db, tripId: number, eventId: number, patch: EventInput): EventRow {
  const trip = getTrip(db, tripId);
  const cur = getEventRow(db, tripId, eventId);
  const before = stateFromRow(db, cur);
  const merged: EventState = { ...before };
  for (const k of providedKeys(patch)) (merged as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
  if (patch.details !== undefined) merged.details = (patch.details ?? {}) as Record<string, unknown>;
  if (patch.participantIds !== undefined) merged.participantIds = patch.participantIds;
  // Typwechsel: Detail-Schlüssel, die der neue Typ nicht kennt, würden den Katalogtest sprengen.
  const after = normalizeState(db, trip, merged);
  const meta: FieldsMeta = parseJson(cur.fields_meta, {});
  applyManualMeta(meta, before, after, patch);
  prefillFromAirports(after, meta, new Set());
  after.placeCoords = mergePlaceCoords(before.placeCoords, patch.placeCoords);
  applyFieldsMetaPatch(meta, patch.fieldsMeta);
  writeEvent(db, cur.id, after, meta);
  persistParticipants(db, eventId, after.participantIds);
  widenTripDates(db, tripId);
  return getEventRow(db, tripId, eventId);
}

function writeEvent(db: Db, eventId: number, s: EventState, meta: FieldsMeta, extra: { status?: EventStatus } = {}): void {
  const cols = toColumns(s);
  if (extra.status) cols.status = extra.status;
  const names = Object.keys(cols);
  db.prepare(
    `UPDATE trip_events SET ${names.map((n) => `${n} = ?`).join(", ")}, place_coords = ?, details = ?, fields_meta = ?, updated_at = ?
      WHERE id = ?`
  ).run(...names.map((n) => cols[n]), JSON.stringify(s.placeCoords), JSON.stringify(s.details), JSON.stringify(meta), now(), eventId);
}

export function deleteEvent(db: Db, tripId: number, eventId: number): void {
  getEventRow(db, tripId, eventId);
  db.prepare("DELETE FROM trip_events WHERE id = ?").run(eventId);
}

/** Vorschlag bestätigen. */
export function confirmEvent(db: Db, tripId: number, eventId: number): EventRow {
  getEventRow(db, tripId, eventId);
  db.prepare("UPDATE trip_events SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now(), eventId);
  return getEventRow(db, tripId, eventId);
}

/**
 * Vorschlag in ein vorhandenes Ereignis einarbeiten: nur leere und nicht gesperrte Felder des Ziels werden
 * gefüllt (auch in `details`), Dokumente und «Wer ist dabei» wandern mit, der Vorschlag verschwindet.
 */
export function mergeEvent(db: Db, tripId: number, sourceId: number, intoId: number): EventRow {
  if (sourceId === intoId) throw new HttpError(422, "invalid_merge", "Ein Ereignis kann nicht in sich selbst eingearbeitet werden");
  const trip = getTrip(db, tripId);
  const src = getEventRow(db, tripId, sourceId);
  const dst = getEventRow(db, tripId, intoId);
  return db.transaction(() => {
    const a = stateFromRow(db, src);
    const target = stateFromRow(db, dst);
    const srcMeta: FieldsMeta = parseJson(src.fields_meta, {});
    const meta: FieldsMeta = parseJson(dst.fields_meta, {});
    const next: EventState = { ...target, details: { ...target.details }, placeCoords: { ...target.placeCoords } };
    const fillable = (field: string) => !meta[field]?.locked;
    const origin = (field: string): FieldMeta => {
      const m = srcMeta[field];
      if (m && m.source !== "manual") return { ...m, locked: undefined } as FieldMeta;
      return { source: "document", ...(src.source_document_id ? { documentId: src.source_document_id } : {}) };
    };
    const skip = new Set(["type", "status", "title"]);
    for (const [api] of SCALAR) {
      if (skip.has(api)) continue;
      const cur = (next as Record<string, unknown>)[api];
      const v = (a as Record<string, unknown>)[api];
      if (isEmpty(cur) && !isEmpty(v) && fillable(api)) {
        (next as Record<string, unknown>)[api] = v;
        meta[api] = origin(api);
      }
    }
    for (const [k, v] of Object.entries(a.details)) {
      if (target.details[k] === undefined && fillable(k)) {
        next.details[k] = v;
        meta[k] = origin(k);
      }
    }
    for (const [role, c] of Object.entries(a.placeCoords)) {
      if (!next.placeCoords[role as PlaceRole]) next.placeCoords[role as PlaceRole] = c;
    }
    if (next.participantIds.length === 0 && a.participantIds.length) next.participantIds = a.participantIds;
    if (isEmpty(next.notes) === false && !isEmpty(a.notes) && a.notes !== next.notes && fillable("notes")) {
      // Notizen nie überschreiben, aber anhängen, damit nichts verloren geht.
      next.notes = `${next.notes}\n\n${a.notes}`;
    }
    const normalized = normalizeState(db, trip, next);
    writeEvent(db, intoId, normalized, meta);
    persistParticipants(db, intoId, normalized.participantIds);
    db.prepare(
      `INSERT OR IGNORE INTO trip_event_documents (trip_event_id, document_id, created_at)
       SELECT ?, document_id, created_at FROM trip_event_documents WHERE trip_event_id = ?`
    ).run(intoId, sourceId);
    if (src.source_document_id != null && dst.source_document_id == null) {
      db.prepare("UPDATE trip_events SET source_document_id = ? WHERE id = ?").run(src.source_document_id, intoId);
    }
    if (src.expense_id != null && dst.expense_id == null) {
      db.prepare("UPDATE trip_events SET expense_id = NULL WHERE id = ?").run(sourceId);
      db.prepare("UPDATE trip_events SET expense_id = ? WHERE id = ?").run(src.expense_id, intoId);
      db.prepare("UPDATE expenses SET trip_event_id = ? WHERE id = ?").run(intoId, src.expense_id);
    }
    db.prepare("DELETE FROM trip_events WHERE id = ?").run(sourceId);
    widenTripDates(db, tripId);
    return getEventRow(db, tripId, intoId);
  })();
}

/**
 * Erweiterungspunkt für die Dokumentanalyse: schreibt Werte aus einem Dokument in ein Ereignis, **ohne gesperrte
 * Felder** anzufassen. Leere Felder werden gefüllt; bereits belegte, nicht gesperrte Felder werden nur ersetzt,
 * wenn `overwriteUnlocked` gesetzt ist. Gibt die tatsächlich geänderten Feldnamen zurück.
 */
export function applyExtraction(
  db: Db,
  tripId: number,
  eventId: number,
  fields: Omit<EventInput, "fieldsMeta" | "placeCoords" | "status" | "participantIds">,
  origin: { documentId: number; confidence?: number; page?: number; quotes?: Record<string, string> },
  opts: { overwriteUnlocked?: boolean } = {}
): string[] {
  const trip = getTrip(db, tripId);
  const cur = getEventRow(db, tripId, eventId);
  const state = stateFromRow(db, cur);
  const meta: FieldsMeta = parseJson(cur.fields_meta, {});
  const changed: string[] = [];
  const write = (field: string, curValue: unknown, value: unknown, set: (v: unknown) => void) => {
    if (isEmpty(value) || meta[field]?.locked || same(curValue, value)) return;
    if (!isEmpty(curValue) && !opts.overwriteUnlocked) return;
    set(value);
    meta[field] = {
      source: "document", documentId: origin.documentId,
      ...(origin.confidence != null ? { confidence: origin.confidence } : {}),
      ...(origin.page != null ? { page: origin.page } : {}),
      ...(origin.quotes?.[field] ? { quote: origin.quotes[field] } : {}),
    };
    changed.push(field);
  };
  for (const [api] of SCALAR) {
    if (api === "status" || !(api in fields)) continue;
    const v = (fields as Record<string, unknown>)[api];
    write(api, (state as Record<string, unknown>)[api], v, (x) => ((state as Record<string, unknown>)[api] = x));
  }
  if (fields.details) {
    for (const [k, v] of Object.entries(fields.details)) {
      write(k, state.details[k], v, (x) => (state.details[k] = x));
    }
  }
  if (changed.length === 0) return changed;
  const normalized = normalizeState(db, trip, state);
  prefillFromAirports(normalized, meta, new Set());
  writeEvent(db, eventId, normalized, meta);
  widenTripDates(db, tripId);
  return changed;
}

export function reorderEvents(db: Db, tripId: number, orderedIds: number[]): void {
  const own = new Set(
    (db.prepare("SELECT id FROM trip_events WHERE trip_id = ?").all(tripId) as { id: number }[]).map((r) => r.id)
  );
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !own.has(id))) {
    throw new HttpError(422, "invalid_order", "Ungültige Reihenfolge");
  }
  const upd = db.prepare("UPDATE trip_events SET sort_key = ? WHERE id = ?");
  db.transaction(() => orderedIds.forEach((id, i) => upd.run(i + 1, id)))();
}

/** Reisezeitraum wächst mit den Ereignissen mit, schrumpft aber nie von allein. */
function widenTripDates(db: Db, tripId: number): void {
  const r = db
    .prepare(
      `SELECT MIN(start_date) AS s, MAX(COALESCE(end_date, start_date)) AS e
         FROM trip_events WHERE trip_id = ? AND start_date IS NOT NULL`
    )
    .get(tripId) as { s: string | null; e: string | null };
  const t = getTrip(db, tripId);
  const s = r.s && (!t.start_date || r.s < t.start_date) ? r.s : t.start_date;
  const e = r.e && (!t.end_date || r.e > t.end_date) ? r.e : t.end_date;
  if (s !== t.start_date || e !== t.end_date) {
    db.prepare("UPDATE trips SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?").run(s, e, now(), tripId);
  }
}

/* ───────────── Dokumente & Kommentare ───────────── */

export function linkDocument(db: Db, tripId: number, eventId: number, documentId: number): void {
  getEventRow(db, tripId, eventId);
  const d = db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId);
  if (!d) throw new HttpError(422, "invalid_document", "Dokument nicht gefunden");
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO trip_event_documents (trip_event_id, document_id, created_at) VALUES (?, ?, ?)"
    ).run(eventId, documentId, now());
    db.prepare("INSERT OR IGNORE INTO trip_documents (trip_id, document_id, created_at) VALUES (?, ?, ?)").run(tripId, documentId, now());
  })();
}

export function unlinkDocument(db: Db, tripId: number, eventId: number, documentId: number): void {
  getEventRow(db, tripId, eventId);
  db.prepare("DELETE FROM trip_event_documents WHERE trip_event_id = ? AND document_id = ?").run(eventId, documentId);
}

export function addComment(
  db: Db,
  tripId: number,
  eventId: number,
  author: { userId: number | null; name: string },
  body: string
) {
  getEventRow(db, tripId, eventId);
  const text = body.trim();
  if (!text) throw badRequest("Kommentar darf nicht leer sein");
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO trip_event_comments (trip_event_id, user_id, author_name, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(eventId, author.userId, author.name, text, ts, ts);
  return serializeComment(
    db.prepare("SELECT * FROM trip_event_comments WHERE id = ?").get(Number(res.lastInsertRowid)) as CommentRow
  );
}

type CommentRow = {
  id: number;
  trip_event_id: number;
  user_id: number | null;
  author_name: string;
  body: string;
  created_at: string;
};

const serializeComment = (c: CommentRow) => ({
  id: c.id,
  eventId: c.trip_event_id,
  userId: c.user_id,
  author: c.author_name,
  body: c.body,
  createdAt: c.created_at,
});

export function deleteComment(db: Db, tripId: number, eventId: number, commentId: number, user: AuthUser): void {
  getEventRow(db, tripId, eventId);
  const c = db
    .prepare("SELECT * FROM trip_event_comments WHERE id = ? AND trip_event_id = ?")
    .get(commentId, eventId) as CommentRow | undefined;
  if (!c) throw notFound("Kommentar");
  if (!user.isAdmin && c.user_id !== user.id) throw forbidden("Nur eigene Kommentare können gelöscht werden");
  db.prepare("DELETE FROM trip_event_comments WHERE id = ?").run(commentId);
}

/* ───────────── Lesen ───────────── */

export type EventViewOpts = {
  /** Dokumenttitel mitliefern (nicht für Gäste). */
  withTitles?: boolean;
  /** Bild-URLs mitliefern (nur mit Token abrufbar). */
  withMedia?: boolean;
  withComments?: boolean;
};

/** Serialisierte Ereignisse einer Reise (alle, in Plan-Reihenfolge) oder der angegebenen Zeilen. */
export function eventViews(db: Db, trip: TripRow, opts: EventViewOpts = {}, only?: EventRow[]) {
  const rows =
    only ??
    (db
      .prepare(
        `SELECT * FROM trip_events WHERE trip_id = ?
          ORDER BY COALESCE(start_date, '9999-12-31'), COALESCE(start_time, '99:99'), sort_key, id`
      )
      .all(trip.id) as EventRow[]);
  const tripId = trip.id;
  const docs = db
    .prepare(
      `SELECT d.trip_event_id, d.document_id, doc.title FROM trip_event_documents d
         JOIN trip_events e ON e.id = d.trip_event_id
         JOIN documents doc ON doc.id = d.document_id
        WHERE e.trip_id = ? ORDER BY d.created_at, d.document_id`
    )
    .all(tripId) as { trip_event_id: number; document_id: number; title: string | null }[];
  const comments =
    opts.withComments === false
      ? []
      : (db
          .prepare(
            `SELECT c.* FROM trip_event_comments c JOIN trip_events e ON e.id = c.trip_event_id
              WHERE e.trip_id = ? ORDER BY c.created_at, c.id`
          )
          .all(tripId) as CommentRow[]);
  const people = db
    .prepare(
      `SELECT ep.event_id, ep.participant_id FROM event_participants ep
         JOIN trip_events e ON e.id = ep.event_id WHERE e.trip_id = ? ORDER BY ep.participant_id`
    )
    .all(tripId) as { event_id: number; participant_id: number }[];
  const media = opts.withMedia ? tripEventMediaUrls(db, tripId) : null;

  return rows.map((e) => {
    const details = parseJson<Record<string, unknown>>(e.details, {});
    const meta = parseJson<FieldsMeta>(e.fields_meta, {});
    const coords = parseJson<PlaceCoords>(e.place_coords, {});
    const places = derivePlaces(
      { type: e.event_type, title: e.title, location: e.location, address: e.address, lat: e.lat, lon: e.lon, details, placeCoords: coords, latSource: meta.lat?.source ?? null },
      { destination: trip.destination }
    );
    const eventDocs = docs.filter((d) => d.trip_event_id === e.id);
    return {
      id: e.id,
      tripId: e.trip_id,
      type: e.event_type,
      emoji: eventEmoji(e.event_type),
      title: e.title,
      startDate: e.start_date,
      endDate: e.end_date,
      startTime: e.start_time,
      endTime: e.end_time,
      startTz: e.start_tz,
      endTz: e.end_tz,
      location: e.location,
      address: e.address,
      provider: e.provider,
      bookingReference: e.booking_reference,
      website: e.website,
      phone: e.phone,
      lat: e.lat,
      lon: e.lon,
      notes: e.notes,
      details,
      sortKey: e.sort_key,
      status: e.status,
      participantIds: people.filter((p) => p.event_id === e.id).map((p) => p.participant_id),
      priceMinor: e.price_minor,
      currency: e.currency,
      paymentStatus: e.payment_status,
      paidByParticipantId: e.paid_by_participant_id,
      cancelUntil: e.cancel_until,
      expenseId: e.expense_id,
      fieldsMeta: meta,
      sourceDocumentId: e.source_document_id,
      places: publicPlaces(places),
      documentIds: eventDocs.map((d) => d.document_id),
      // Titel nur für angemeldete Benutzer: Gäste sehen die Dokumente nicht, nur die Anzahl.
      ...(opts.withTitles ? { documents: eventDocs.map((d) => ({ id: d.document_id, title: d.title })) } : {}),
      comments: comments.filter((c) => c.trip_event_id === e.id).map(serializeComment),
      // Medien-URLs nur für angemeldete Benutzer (Gäste haben kein Token, um sie zu öffnen).
      ...(media ? { imageUrl: media.images.get(e.id) ?? null, mapUrl: null } : {}),
    };
  });
}

export type EventView = ReturnType<typeof eventViews>[number];

/** Orte eines Ereignisses samt Suchbegriff (für die Geokodierung). */
export function eventPlacesWithQuery(row: EventRow, trip: TripRow): PlaceWithQuery[] {
  const meta = parseJson<FieldsMeta>(row.fields_meta, {});
  return derivePlaces(
    {
      type: row.event_type, title: row.title, location: row.location, address: row.address, lat: row.lat, lon: row.lon,
      details: parseJson(row.details, {}), placeCoords: parseJson(row.place_coords, {}), latSource: meta.lat?.source ?? null,
    },
    { destination: trip.destination }
  );
}

export function tripPhase(trip: Pick<TripRow, "start_date" | "end_date" | "timezone">, at: Date): TripPhase {
  const today = todayLocal(at, trip.timezone);
  if (trip.end_date && trip.end_date < today) return "past";
  if (trip.start_date && trip.start_date <= today) return "active";
  return "upcoming";
}

export function needsReviewCount(db: Db, tripId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM trip_events WHERE trip_id = ? AND status != 'confirmed'").get(tripId) as { n: number }).n;
}

function tripObject(db: Db, trip: TripRow, at: Date, withMedia: boolean) {
  return {
    id: trip.id,
    title: trip.title,
    status: trip.status,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    summary: trip.summary,
    notes: trip.notes,
    homeCurrency: trip.home_currency,
    timezone: trip.timezone,
    phase: tripPhase(trip, at),
    ledgerId: ledgerIdOfTrip(db, trip.id),
    needsReviewCount: needsReviewCount(db, trip.id),
    coverUrl: withMedia ? mediaUrls(db, "trip_cover", [trip.id]).get(trip.id) ?? null : null,
    createdAt: trip.created_at,
    updatedAt: trip.updated_at,
  };
}

export function serializeTraveler(p: ParticipantRow, includeShare: boolean) {
  return {
    id: p.id,
    displayName: p.display_name,
    // E-Mail-Adressen und Gäste-Links sieht nur, wer die Reise verwalten darf.
    email: includeShare ? p.email : null,
    userId: p.user_id,
    coupleId: p.couple_id,
    colorIndex: p.color_index,
    ...(includeShare ? { shareToken: p.share_revoked_at ? null : p.share_token } : {}),
  };
}

export function listTravelers(db: Db, tripId: number): ParticipantRow[] {
  return db.prepare("SELECT * FROM participants WHERE trip_id = ? ORDER BY sort_key, id").all(tripId) as ParticipantRow[];
}

export function tripDetail(
  db: Db,
  tripId: number,
  opts: { includeShareTokens?: boolean; includeDocumentTitles?: boolean; includeMedia?: boolean; now?: Date } = {}
) {
  // Medien-URLs: standardmässig mit, wenn die Antwort für Verwalter (Share-Token) bestimmt ist; Gäste bekommen keine.
  const withMedia = opts.includeMedia ?? opts.includeShareTokens ?? false;
  const withTitles = opts.includeDocumentTitles ?? opts.includeShareTokens ?? false;
  const trip = getTrip(db, tripId);
  return {
    trip: tripObject(db, trip, opts.now ?? new Date(), withMedia),
    travelers: listTravelers(db, tripId).map((t) => serializeTraveler(t, Boolean(opts.includeShareTokens))),
    events: eventViews(db, trip, { withTitles, withMedia }),
  };
}

export function listTrips(db: Db, user: AuthUser, at: Date, opts: { onlyMine?: boolean } = {}) {
  const rows = (
    user.isAdmin && !opts.onlyMine
      ? db.prepare("SELECT * FROM trips").all()
      : user.isAdmin
        ? // «Meine» Reisen eines Admins: selbst angelegt oder als Teilnehmer eingetragen.
          db
            .prepare(
              `SELECT DISTINCT t.* FROM trips t
                 LEFT JOIN participants p ON p.trip_id = t.id
                WHERE t.created_by_user_id = ? OR p.user_id = ?`
            )
            .all(user.id, user.id)
        : db
            .prepare(
              `SELECT DISTINCT t.* FROM trips t
                 JOIN participants p ON p.trip_id = t.id WHERE p.user_id = ?`
            )
            .all(user.id)
  ) as TripRow[];

  const covers = mediaUrls(db, "trip_cover", rows.map((t) => t.id));
  const out = rows.map((t) => {
    const n = (sql: string) => (db.prepare(sql).get(t.id) as { n: number }).n;
    const today = todayLocal(at, t.timezone);
    const next = db
      .prepare(
        `SELECT id, event_type, title, start_date, start_time, start_tz FROM trip_events
          WHERE trip_id = ? AND start_date >= ? ORDER BY start_date, COALESCE(start_time, '99:99') LIMIT 1`
      )
      .get(t.id, today) as
      | { id: number; event_type: string; title: string; start_date: string; start_time: string | null; start_tz: string | null }
      | undefined;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      destination: t.destination,
      startDate: t.start_date,
      endDate: t.end_date,
      homeCurrency: t.home_currency,
      timezone: t.timezone,
      coverUrl: covers.get(t.id) ?? null,
      eventCount: n("SELECT COUNT(*) AS n FROM trip_events WHERE trip_id = ?"),
      documentCount: (
        db
          .prepare(
            `SELECT COUNT(DISTINCT document_id) AS n FROM (
               SELECT d.document_id FROM trip_event_documents d JOIN trip_events e ON e.id = d.trip_event_id WHERE e.trip_id = ?
               UNION SELECT document_id FROM trip_documents WHERE trip_id = ?)`
          )
          .get(t.id, t.id) as { n: number }
      ).n,
      travelerCount: n("SELECT COUNT(*) AS n FROM participants WHERE trip_id = ?"),
      ledgerId: ledgerIdOfTrip(db, t.id),
      needsReviewCount: needsReviewCount(db, t.id),
      nextEvent: next
        ? { id: next.id, type: next.event_type, title: next.title, startDate: next.start_date, startTime: next.start_time, startTz: next.start_tz }
        : null,
      phase: tripPhase(t, at),
    };
  });
  const rank = { active: 0, upcoming: 1, past: 2 } as const;
  return out.sort((a, b) => {
    if (rank[a.phase] !== rank[b.phase]) return rank[a.phase] - rank[b.phase];
    const da = a.startDate ?? "9999";
    const dbb = b.startDate ?? "9999";
    return a.phase === "past" ? dbb.localeCompare(da) : da.localeCompare(dbb);
  });
}

/* ───────────── Kalender ───────────── */

export function tripIcs(db: Db, tripId: number, at = new Date()): string {
  const { trip, travelers, events } = tripDetail(db, tripId);
  const out: CalendarEvent[] = [];
  const cat = getCatalog();
  for (const e of events) {
    if (!e.startDate) continue;
    const d = e.details as Record<string, unknown>;
    const lines: string[] = [`Reise: ${trip.title}`];
    const add = (label: string, v: string | number | null | undefined) => {
      if (v != null && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`);
    };
    const s = (k: string) => (d[k] == null ? null : String(d[k]));
    add("Ziel", trip.destination);
    add("Ort", e.location);
    const route = s("departureAirport") || s("arrivalAirport")
      ? `${s("departureAirport") ?? "—"} → ${s("arrivalAirport") ?? "—"}`
      : s("originPlace") || s("destinationPlace")
        ? `${s("originPlace") ?? "—"} → ${s("destinationPlace") ?? "—"}`
        : s("pickupPlace") || s("returnPlace")
          ? `${s("pickupPlace") ?? "—"} → ${s("returnPlace") ?? "—"}`
          : null;
    add("Route", route);
    add("Adresse", e.address);
    add("Anbieter", e.provider);
    add("Buchung", e.bookingReference);
    add(e.type === "Zugreisen" ? "Zug" : "Flug", s("flightNumber") ?? s("trainNumber"));
    add("Klasse", s("cabinClass"));
    add("Airline", s("airline"));
    const dep = [s("departureTerminal") && `Terminal ${s("departureTerminal")}`, s("departureGate") && `Gate ${s("departureGate")}`, s("checkInDesk") && `Check-in ${s("checkInDesk")}`].filter(Boolean);
    if (dep.length) add("Abflug", dep.join(" · "));
    const arr = [s("arrivalTerminal") && `Terminal ${s("arrivalTerminal")}`, s("arrivalGate") && `Gate ${s("arrivalGate")}`, s("baggageBelt") && `Gepäck ${s("baggageBelt")}`].filter(Boolean);
    if (arr.length) add("Ankunft", arr.join(" · "));
    if (d.durationMinutes != null) add("Dauer", `${d.durationMinutes} Min.`);
    add("Telefon", e.phone);
    if (e.status !== "confirmed") lines.push("Status: Vorschlag, noch nicht bestätigt");
    if (e.notes?.trim()) lines.push(`Notizen:\n${e.notes.trim()}`);
    add("Mitreisende", travelers.map((t) => t.displayName).join(", "));

    const label = cat.type(e.type)?.label ?? e.type;
    out.push({
      uid: `travelbuddy-trip-${trip.id}-event-${e.id}@travelbuddy`,
      title: `${e.emoji} ${label}: ${e.title}`,
      description: lines.join("\n"),
      location: e.address || e.location || undefined,
      startDate: e.startDate,
      endDate: e.endDate || e.startDate,
      startTime: e.startTime || undefined,
      endTime: e.endTime || undefined,
      startTz: e.startTz ?? trip.timezone,
      endTz: e.endTz ?? e.startTz ?? trip.timezone,
      url: e.website || undefined,
      categories: [e.type],
      geo: e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : undefined,
    });
  }
  return buildIcsCalendar(out, { now: at, prodId: "-//TravelBuddy//CH//DE" });
}

/* ───────────── Gäste ───────────── */

export function guestTripView(db: Db, shareToken: string, at = new Date()) {
  const { trip, traveler } = resolveTraveler(db, shareToken);
  return { me: { travelerId: traveler.id, displayName: traveler.display_name }, ...tripDetail(db, trip.id, { now: at }) };
}

export function guestAddComment(db: Db, shareToken: string, eventId: number, body: string) {
  const { trip, traveler } = resolveTraveler(db, shareToken);
  return addComment(db, trip.id, eventId, { userId: traveler.user_id, name: traveler.display_name }, body);
}

/** Reise zum Gäste-Link (für Benachrichtigungen und Tests). */
export function tripOfShareToken(db: Db, shareToken: string): { trip: TripRow; traveler: ParticipantRow } {
  return resolveTraveler(db, shareToken);
}

/** «Meine» Reisen: Teilnehmer, bei Administratoren zusätzlich selbst angelegte. */
export function myTripRows(db: Db, user: AuthUser): TripRow[] {
  return (
    user.isAdmin
      ? db
          .prepare(
            `SELECT DISTINCT t.* FROM trips t LEFT JOIN participants p ON p.trip_id = t.id
              WHERE t.created_by_user_id = ? OR p.user_id = ?`
          )
          .all(user.id, user.id)
      : db
          .prepare(`SELECT DISTINCT t.* FROM trips t JOIN participants p ON p.trip_id = t.id WHERE p.user_id = ?`)
          .all(user.id)
  ) as TripRow[];
}

export function eventRows(db: Db, tripId: number): EventRow[] {
  return db.prepare("SELECT * FROM trip_events WHERE trip_id = ?").all(tripId) as EventRow[];
}

export function tripCoverUrl(db: Db, tripId: number): string | null {
  return mediaUrls(db, "trip_cover", [tripId]).get(tripId) ?? null;
}
