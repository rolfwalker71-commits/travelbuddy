/**
 * Darstellung von Ereignissen: Wichtiges je Typ (gross auf Ticket und Heute), Route, Zeitzeile, Teilnehmer.
 * Reine Logik; Beschriftungen kommen aus dem Katalog, soweit er sie kennt.
 */
import type { PassengerRow, Traveler, TripEvent } from "../api/types";
import { getType, optionLabel, resolveTypeId, findField, type Catalog } from "./catalog";
import { formatDate } from "./dates";
import { cityOf, effectiveZone, offsetMinutes, zonedToUtc } from "./timezones";

export type Fact = {
  label: string;
  value: string;
  /** Code, Zeit oder Nummer: Plex Mono. */
  mono?: boolean;
  /** Lange Texte (Adresse, Türcode) über die ganze Breite. */
  wide?: boolean;
};

const detailText = (e: TripEvent, key: string): string => {
  const v = e.details?.[key];
  if (v == null || typeof v === "object") return "";
  return String(v).trim();
};

/** Sitz für einen Teilnehmer aus `details.passengers` (bei nur einer Zeile gilt sie für alle). */
export function seatFor(e: TripEvent, participantId: number | null | undefined): string {
  const rows = Array.isArray(e.details?.passengers) ? (e.details.passengers as PassengerRow[]) : [];
  const own = participantId != null ? rows.find((r) => r.participantId === participantId) : undefined;
  const row = own ?? (rows.length === 1 ? rows[0] : undefined);
  const seat = row?.seat;
  if (typeof seat === "string" && seat) return seat;
  return detailText(e, "seat");
}

export function coachFor(e: TripEvent, participantId: number | null | undefined): string {
  const rows = Array.isArray(e.details?.passengers) ? (e.details.passengers as PassengerRow[]) : [];
  const own = participantId != null ? rows.find((r) => r.participantId === participantId) : undefined;
  const row = own ?? (rows.length === 1 ? rows[0] : undefined);
  const c = (row as Record<string, unknown> | undefined)?.coach;
  return typeof c === "string" ? c : "";
}

/** Alle Sitze «Name 12C · Name 12D» (für Detail und Heute, wenn mehrere reisen). */
export function seatList(e: TripEvent, travelers: Traveler[]): string {
  const rows = Array.isArray(e.details?.passengers) ? (e.details.passengers as PassengerRow[]) : [];
  return rows
    .filter((r) => typeof r.seat === "string" && r.seat)
    .map((r) => `${travelers.find((t) => t.id === r.participantId)?.displayName ?? "?"} ${r.seat}`)
    .join(" · ");
}

/** Wichtiges je Typ, in der Reihenfolge, in der es am Schalter gebraucht wird. Leere Werte entfallen. */
export function keyFacts(
  catalog: Catalog | null,
  e: TripEvent,
  opts: { meId?: number | null; travelers?: Traveler[]; max?: number } = {}
): Fact[] {
  const typeId = catalog ? resolveTypeId(catalog, e.type) : e.type;
  const d = (k: string) => detailText(e, k);
  const sel = (k: string): string => {
    const raw = d(k);
    const f = catalog ? findField(catalog, typeId, k) : null;
    return f ? optionLabel(f, raw) : raw;
  };
  const f = (label: string, value: string, extra: Partial<Fact> = {}): Fact | null =>
    value ? { label, value, ...extra } : null;
  let list: (Fact | null)[] = [];
  switch (typeId) {
    case "Flug":
      list = [
        f("Terminal", d("departureTerminal"), { mono: true }),
        f("Gate", d("departureGate"), { mono: true }),
        f("Sitz", seatFor(e, opts.meId), { mono: true }),
        f("Boarding", d("boardingTime"), { mono: true }),
        f("Check-in", d("checkInDesk"), { mono: true }),
        f("Buchung", e.bookingReference ?? "", { mono: true }),
      ];
      break;
    case "Zugreisen":
      list = [
        f("Gleis", d("departurePlatform"), { mono: true }),
        f("Wagen", coachFor(e, opts.meId), { mono: true }),
        f("Sitz", seatFor(e, opts.meId), { mono: true }),
        f("Zug", d("trainNumber"), { mono: true }),
      ];
      break;
    case "Hotel":
    case "Unterkunft":
      list = [
        f("Adresse", e.address ?? "", { wide: true }),
        f("Türcode", d("accessCode"), { wide: true }),
        f("Check-in ab", d("checkInFrom"), { mono: true }),
        f("Check-out bis", d("checkOutUntil"), { mono: true }),
        f("Buchung", d("confirmationNumber") || (e.bookingReference ?? ""), { mono: true }),
      ];
      break;
    case "Mietauto":
      list = [
        f("Abholort", d("pickupPlace") || (e.location ?? ""), { wide: true }),
        f("Öffnungszeiten", d("pickupHours")),
        f("Notfallnummer", d("emergencyPhone"), { mono: true }),
        f("Reservierung", e.bookingReference ?? "", { mono: true }),
      ];
      break;
    case "Kreuzfahrt":
      list = [
        f("Kabine", d("cabin"), { mono: true }),
        f("Terminal", d("terminal")),
        f("Alle an Bord", d("allAboard"), { mono: true }),
        f("Deck", d("deck"), { mono: true }),
        f("Notruf", d("emergencyPhone"), { mono: true }),
      ];
      break;
    case "Transfer":
      list = [
        f("Treffpunkt", d("meetingPoint"), { wide: true }),
        f("Fahrer", d("driverContact")),
        f("Fahrzeug", d("vehicle")),
        f("Art", sel("transferKind")),
      ];
      break;
    case "Ausflug":
      list = [
        f("Treffpunkt", d("meetingPoint"), { wide: true }),
        f("Voucher", d("voucher"), { mono: true }),
        f("Personen", d("participantsCount"), { mono: true }),
        f("Sprache", d("language")),
      ];
      break;
    case "Restaurant":
      list = [
        f("Name", d("reservationName")),
        f("Personen", d("partySize"), { mono: true }),
        f("Tisch", d("table"), { mono: true }),
        f("Dresscode", d("dressCode")),
      ];
      break;
    case "Veranstaltung":
      list = [
        f("Einlass", d("doorsOpen"), { mono: true }),
        f("Sitz", d("seat"), { mono: true }),
        f("Ticket", d("ticketNumber"), { mono: true }),
        f("Ort", d("venue") || (e.location ?? ""), { wide: true }),
      ];
      break;
    case "Versicherung":
      list = [
        f("Police", d("policyNumber"), { mono: true }),
        f("Notfallnummer", d("emergencyPhone"), { mono: true }),
        f("Versicherer", d("insurer")),
      ];
      break;
    case "Visum":
      list = [
        f("Land", d("country")),
        f("Nummer", d("authorizationNumber"), { mono: true }),
        f("Status", sel("applicationStatus")),
      ];
      break;
    case "Aufgabe":
      list = [f("Fällig", e.startDate ? formatDate(e.startDate) : "", { mono: true }), f("Link", d("link"), { wide: true })];
      break;
    default:
      list = [f("Buchung", e.bookingReference ?? "", { mono: true }), f("Ort", e.location ?? "", { wide: true })];
  }
  const out = list.filter((x): x is Fact => x !== null);
  return out.slice(0, opts.max ?? 4);
}

/** Route «ZRH → BCN», «Zürich HB → Bern», «Station → Station»; `null`, wenn nichts bekannt ist. */
export function routeOf(e: TripEvent): { from: string; to: string } | null {
  const d = (k: string) => detailText(e, k);
  const pairs: [string, string][] = [
    [d("departureAirport"), d("arrivalAirport")],
    [d("originPlace"), d("destinationPlace")],
    [d("pickupPlace"), d("returnPlace")],
  ];
  for (const [a, b] of pairs) if (a || b) return { from: a || "?", to: b || "?" };
  return null;
}

/** Kurzzeile unter dem Titel: Airline · Flugnummer, Zugnummer, Schiff … aus dem `summary` des Typs. */
export function summaryLine(catalog: Catalog | null, e: TripEvent): string {
  const t = catalog ? getType(catalog, e.type) : null;
  const keys = t?.summary ?? [];
  const parts: string[] = [];
  for (const k of keys) {
    const v = detailText(e, k);
    if (!v) continue;
    const f = catalog ? findField(catalog, t!.id, k) : null;
    const text = f ? optionLabel(f, v) : v;
    if (f?.kind === "bool") continue;
    else if (f?.kind === "number") parts.push(`${f.label} ${text}${f.unit ? ` ${f.unit}` : ""}`);
    else parts.push(text);
  }
  return parts.join(" · ");
}

/** Referenz fürs Kopfband: Buchungsreferenz, sonst Flug-/Zugnummer. */
export function referenceOf(e: TripEvent): string {
  return (
    (e.bookingReference ?? "").trim() ||
    detailText(e, "flightNumber") ||
    detailText(e, "trainNumber") ||
    detailText(e, "confirmationNumber") ||
    detailText(e, "policyNumber") ||
    ""
  );
}

/** Zeitzeile «12:20 → 14:05»; mit Zone nur, wenn sie von der Reisezone abweicht. */
export function timeLine(e: TripEvent, tripTz: string): { start: string; end: string; startZone: string | null; endZone: string | null } {
  const sz = effectiveZone(e.startTz, tripTz);
  const ez = effectiveZone(e.endTz, tripTz);
  return {
    start: e.startTime ?? "",
    end: e.endTime ?? "",
    startZone: e.startTime && zoneDiffers(sz, tripTz, e.startDate, e.startTime) ? cityOf(sz) : null,
    endZone: e.endTime && zoneDiffers(ez, tripTz, e.endDate ?? e.startDate, e.endTime) ? cityOf(ez) : null,
  };
}

/**
 * Weicht die Zone von der Reisezone ab? Zonen mit gleichem Versatz zum Zeitpunkt (Zürich und Madrid) gelten als gleich,
 * damit «Ortszeit Madrid» nur erscheint, wenn die Uhr tatsächlich anders geht.
 */
export function zoneDiffers(tz: string, tripTz: string, date: string | null, time: string | null): boolean {
  if (tz === tripTz) return false;
  const at = (date && time && zonedToUtc(date, time, tripTz)) || new Date();
  return offsetMinutes(tz, at) !== offsetMinutes(tripTz, at);
}

/** Namen der Beteiligten; leer = alle. */
export function participantsText(e: TripEvent, travelers: Traveler[]): string {
  const ids = e.participantIds ?? [];
  if (ids.length === 0 || ids.length >= travelers.length) return travelers.length > 0 ? "Alle" : "";
  return ids.map((id) => travelers.find((t) => t.id === id)?.displayName ?? `#${id}`).join(", ");
}

export function isProposal(e: TripEvent): boolean {
  return e.status === "proposed" || e.status === "needs_review";
}

/** Mittlere Sicherheit der erkannten Felder (0..1) oder `null`. */
export function confidenceOf(e: TripEvent): number | null {
  const vals = Object.values(e.fieldsMeta ?? {})
    .map((m) => m.confidence)
    .filter((c): c is number => typeof c === "number");
  if (vals.length === 0) return null;
  return Math.min(...vals);
}

/** Erster Quellenausschnitt der erkannten Felder. */
export function firstQuote(e: TripEvent): { quote: string; page?: number; documentId?: number } | null {
  for (const m of Object.values(e.fieldsMeta ?? {})) {
    if (m.quote) return { quote: m.quote, page: m.page, documentId: m.documentId ?? e.sourceDocumentId ?? undefined };
  }
  return null;
}

/* ─ Detailansicht: Buchungsdaten als Zeilen ─ */

export type DetailRow = { key: string; scope: "common" | "details"; label: string; value: string; mono?: boolean };
export type DetailSection = { id: string; title: string; rows: DetailRow[] };

const PAY_LABEL: Record<string, string> = { open: "Offen", paid: "Bezahlt", deposit: "Anzahlung", onsite: "Vor Ort" };

/** Alle ausgefüllten Felder eines Ereignisses nach Katalogabschnitten (für die Detailansicht). */
export function detailSections(catalog: Catalog, e: TripEvent, travelers: Traveler[], money: (minor: number, currency: string) => string, fmtDate: (iso: string) => string): DetailSection[] {
  const type = getType(catalog, e.type);
  const currency = e.currency || "CHF";
  const name = (id: number) => travelers.find((t) => t.id === id)?.displayName ?? `#${id}`;
  const out: DetailSection[] = [];
  const mkRow = (scope: "common" | "details", f: { key: string; label: string; kind: string; fields?: { key: string; label: string }[]; options?: unknown; optionLabels?: string[]; unit?: string }, raw: unknown): DetailRow | null => {
    if (raw == null || raw === "" || raw === false) return null;
    let value = "";
    let mono = false;
    switch (f.kind) {
      case "bool":
        value = "Ja";
        break;
      case "money":
        value = typeof raw === "number" ? money(raw, currency) : String(raw);
        mono = true;
        break;
      case "date":
        value = fmtDate(String(raw));
        mono = true;
        break;
      case "time":
      case "number":
        value = `${raw}${f.unit ? ` ${f.unit}` : ""}`;
        mono = true;
        break;
      case "airport":
        value = String(raw);
        mono = true;
        break;
      case "select": {
        const v = String(raw);
        const opts = Array.isArray(f.options) ? (f.options as string[]) : [];
        const i = opts.indexOf(v);
        value = i >= 0 ? f.optionLabels?.[i] ?? v : v;
        break;
      }
      case "participants": {
        const ids = raw as number[];
        value = ids.length === 0 ? "Alle" : ids.map(name).join(", ");
        break;
      }
      case "participant":
        value = name(Number(raw));
        break;
      case "passengers": {
        const rows = (raw as PassengerRow[]).map((r) => {
          const bits = (f.fields ?? [])
            .map((sf) => {
              const v = (r as Record<string, unknown>)[sf.key];
              return v ? `${sf.label} ${v}` : "";
            })
            .filter(Boolean);
          return `${name(r.participantId)}${bits.length ? `: ${bits.join(", ")}` : ""}`;
        });
        if (rows.length === 0) return null;
        value = rows.join("\n");
        break;
      }
      default:
        value = String(raw);
    }
    return { key: f.key, scope, label: f.label, value, mono };
  };

  // Zeit und Ort
  const base: DetailRow[] = [];
  const startLabel = type?.startLabel || "Beginn";
  const endLabel = type?.endLabel || "Ende";
  const push = (r: DetailRow | null) => r && base.push(r);
  const when = (date: string | null, time: string | null, tz: string | null | undefined) => {
    const parts = [date ? fmtDate(date) : "", time ?? ""].filter(Boolean).join(" · ");
    return parts ? (tz ? `${parts} (${cityOf(tz)})` : parts) : "";
  };
  const s = when(e.startDate, e.startTime, e.startTz);
  const en = type?.endLabel === "" ? "" : when(e.endDate, e.endTime, e.endTz);
  if (s) push({ key: "startDate", scope: "common", label: startLabel, value: s, mono: true });
  if (en) push({ key: "endDate", scope: "common", label: endLabel, value: en, mono: true });
  if (e.location) push({ key: "location", scope: "common", label: "Ort", value: e.location });
  if (e.address) push({ key: "address", scope: "common", label: "Adresse", value: e.address });
  if (base.length) out.push({ id: "zeit", title: "Zeit und Ort", rows: base });

  for (const sec of type?.sections ?? []) {
    const rows = sec.fields.map((f) => mkRow("details", f, e.details?.[f.key])).filter((r): r is DetailRow => r !== null);
    if (rows.length) out.push({ id: sec.id, title: sec.title, rows });
  }

  const booking: DetailRow[] = [];
  if (e.provider) booking.push({ key: "provider", scope: "common", label: "Anbieter", value: e.provider });
  if (e.bookingReference) booking.push({ key: "bookingReference", scope: "common", label: "Buchungsreferenz", value: e.bookingReference, mono: true });
  if (e.website) booking.push({ key: "website", scope: "common", label: "Website", value: e.website });
  if (e.phone) booking.push({ key: "phone", scope: "common", label: "Telefon", value: e.phone, mono: true });
  if (booking.length) out.push({ id: "buchung", title: "Anbieter und Kontakt", rows: booking });

  const people: DetailRow[] = [];
  const pids = e.participantIds ?? [];
  if (travelers.length > 0) people.push({ key: "participantIds", scope: "common", label: "Wer ist dabei", value: pids.length === 0 ? "Alle" : pids.map(name).join(", ") });
  if (people.length) out.push({ id: "personen", title: "Personen", rows: people });

  const cost: DetailRow[] = [];
  if (e.priceMinor != null) cost.push({ key: "priceMinor", scope: "common", label: "Preis", value: money(e.priceMinor, currency), mono: true });
  if (e.paymentStatus) cost.push({ key: "paymentStatus", scope: "common", label: "Zahlung", value: PAY_LABEL[e.paymentStatus] ?? e.paymentStatus });
  if (e.paidByParticipantId != null) cost.push({ key: "paidByParticipantId", scope: "common", label: "Bezahlt von", value: name(e.paidByParticipantId) });
  if (e.cancelUntil) cost.push({ key: "cancelUntil", scope: "common", label: "Kostenlos stornierbar bis", value: fmtDate(e.cancelUntil), mono: true });
  if (cost.length) out.push({ id: "kosten", title: "Preis und Zahlung", rows: cost });

  if (e.notes) out.push({ id: "notizen", title: "Notizen", rows: [{ key: "notes", scope: "common", label: "Notizen", value: e.notes }] });
  return out;
}
