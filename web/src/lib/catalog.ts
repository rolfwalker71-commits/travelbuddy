/**
 * Ereignis-Katalog (`shared/event-types.json`, `GET /v1/meta/event-types`): daraus entstehen Typ-Kacheln,
 * Formularabschnitte und die Umwandlung zwischen Formularwerten und API-Eingabe. Reine Logik, ohne React.
 */
import type { EventDetails, EventInput, PassengerRow, PaymentStatus, TripEvent } from "../api/types";
import bundled from "../data/event-types.json";
import { isValidIsoDate } from "./dates";
import { CLOCK } from "./dates";
import { parseMinor, minorToInput } from "./money";

export type FieldKind =
  | "text"
  | "longtext"
  | "date"
  | "time"
  | "number"
  | "money"
  | "select"
  | "bool"
  | "airport"
  | "place"
  | "passengers"
  | "participants"
  | "participant";

export type CatalogField = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  important?: boolean;
  options?: string[] | "iana";
  optionLabels?: string[];
  placeholder?: string;
  maxLength?: number;
  transform?: "upper";
  pattern?: string;
  unit?: string;
  note?: string;
  fields?: CatalogField[];
};

export type CatalogSection = { id: string; title: string; fields: CatalogField[] };

export type CatalogType = {
  id: string;
  label: string;
  icon: string;
  color: string;
  extends?: string;
  startLabel: string;
  endLabel: string;
  titleHint: string;
  summary?: string[];
  sections?: CatalogSection[];
};

export type Catalog = {
  version: number;
  commonFields: CatalogField[];
  colors: string[];
  types: CatalogType[];
  aliases: Record<string, string>;
};

const KINDS = new Set<string>([
  "text", "longtext", "date", "time", "number", "money", "select", "bool", "airport", "place", "passengers",
  "participants", "participant",
]);

/** Prüft die Form des Katalogs defensiv; `null`, wenn er unbrauchbar ist (dann gilt die gebündelte Kopie). */
export function parseCatalog(raw: unknown): Catalog | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.commonFields) || !Array.isArray(r.types) || r.types.length === 0) return null;
  const okField = (f: unknown): f is CatalogField =>
    !!f && typeof f === "object" && typeof (f as CatalogField).key === "string" && KINDS.has((f as CatalogField).kind);
  const okType = (t: unknown): t is CatalogType =>
    !!t && typeof t === "object" && typeof (t as CatalogType).id === "string" && typeof (t as CatalogType).label === "string";
  if (!r.commonFields.every(okField)) return null;
  if (!r.types.every(okType)) return null;
  for (const t of r.types as CatalogType[]) {
    for (const s of t.sections ?? []) if (!Array.isArray(s.fields) || !s.fields.every(okField)) return null;
  }
  return {
    version: typeof r.version === "number" ? r.version : 1,
    commonFields: r.commonFields as CatalogField[],
    colors: Array.isArray(r.colors) ? (r.colors as string[]) : [],
    types: r.types as CatalogType[],
    aliases: r.aliases && typeof r.aliases === "object" ? (r.aliases as Record<string, string>) : {},
  };
}

/** Gebündelte Kopie von `shared/event-types.json` (Rückfall ohne Server). */
export const BUNDLED_CATALOG: Catalog = parseCatalog(bundled) as Catalog;

/** Alias (z. B. «Mietwagen») → Typ-ID des Katalogs; Unbekanntes bleibt. */
export function resolveTypeId(catalog: Catalog, id: string): string {
  if (catalog.types.some((t) => t.id === id)) return id;
  return catalog.aliases[id] ?? id;
}

/** Typ mit aufgelöstem `extends` (Abschnitte des Elterntyps), `null` bei unbekanntem Typ. */
export function getType(catalog: Catalog, id: string): (CatalogType & { sections: CatalogSection[] }) | null {
  const t = catalog.types.find((x) => x.id === resolveTypeId(catalog, id));
  if (!t) return null;
  if (t.sections && t.sections.length > 0) return { ...t, sections: t.sections };
  const parent = t.extends ? catalog.types.find((x) => x.id === t.extends) : undefined;
  return {
    ...t,
    sections: t.sections ?? parent?.sections ?? [],
    summary: t.summary ?? parent?.summary,
  };
}

/** Typen für die Kacheln: ohne Typen, die nur als Alias auftauchen, in Katalogreihenfolge. */
export function tileTypes(catalog: Catalog): CatalogType[] {
  return catalog.types;
}

/* ─ Formularaufbau ─ */

export type FormScope = "common" | "details";
export type FormField = { scope: FormScope; field: CatalogField; sectionId: string };
export type FormSection = { id: string; title: string; fields: FormField[]; hiddenCount: number };

/** Gruppen der gemeinsamen Felder in der Reihenfolge des Formulars. */
const COMMON_GROUPS: { id: string; title: string; keys: string[]; before: boolean }[] = [
  { id: "zeit", title: "Zeit und Ort", before: true, keys: ["title", "startDate", "startTime", "startTz", "endDate", "endTime", "endTz", "location", "address"] },
  { id: "buchung", title: "Anbieter und Kontakt", before: false, keys: ["provider", "bookingReference", "website", "phone"] },
  { id: "personen", title: "Personen", before: false, keys: ["participantIds"] },
  { id: "kosten", title: "Preis und Zahlung", before: false, keys: ["priceMinor", "paymentStatus", "paidByParticipantId", "cancelUntil"] },
  { id: "notizen", title: "Notizen", before: false, keys: ["notes"] },
];

/** Beschriftung der Zeitfelder aus `startLabel`/`endLabel` des Typs («Abflug», «Check-in», …). */
export function commonFieldLabel(field: CatalogField, type: CatalogType | null): string {
  if (!type) return field.label;
  const start = type.startLabel || "Beginn";
  const end = type.endLabel || "Ende";
  switch (field.key) {
    case "startDate":
      return start;
    case "startTime":
      return `${start} · Uhrzeit`;
    case "startTz":
      return `${start} · Zeitzone`;
    case "endDate":
      return end;
    case "endTime":
      return `${end} · Uhrzeit`;
    case "endTz":
      return `${end} · Zeitzone`;
    default:
      return field.label;
  }
}

/** Aufgaben haben kein Ende: `endLabel` ist leer. */
function hasEnd(type: CatalogType | null): boolean {
  return !type || type.endLabel !== "";
}

export type BuildOptions = {
  /** `important`: nur Wichtiges; mit Wert gefüllte Felder bleiben sichtbar. `all`: alles. */
  mode: "important" | "all";
  /** Felder, die schon einen Wert haben (nie ausblenden). */
  filled?: (scope: FormScope, key: string) => boolean;
};

/** Formularabschnitte eines Typs: Zeit und Ort · Typabschnitte · Buchung · Personen · Preis · Notizen. */
export function buildFormSections(catalog: Catalog, typeId: string, opts: BuildOptions): FormSection[] {
  const type = getType(catalog, typeId);
  const byKey = new Map(catalog.commonFields.map((f) => [f.key, f]));
  const used = new Set<string>();
  const show = (scope: FormScope, f: CatalogField) => {
    if (opts.mode === "all") return true;
    return Boolean(f.important) || Boolean(f.required) || Boolean(opts.filled?.(scope, f.key));
  };
  const make = (id: string, title: string, scope: FormScope, fields: CatalogField[]): FormSection => {
    const visible = fields.filter((f) => show(scope, f));
    return {
      id,
      title,
      fields: visible.map((field) => ({ scope, field, sectionId: id })),
      hiddenCount: fields.length - visible.length,
    };
  };
  const commonSection = (g: (typeof COMMON_GROUPS)[number]): FormSection => {
    const fields: CatalogField[] = [];
    for (const k of g.keys) {
      const f = byKey.get(k);
      if (!f) continue;
      if (!hasEnd(type) && ["endDate", "endTime", "endTz"].includes(k)) continue;
      used.add(k);
      fields.push({ ...f, label: commonFieldLabel(f, type) });
    }
    return make(g.id, g.title, "common", fields);
  };

  const out: FormSection[] = [];
  for (const g of COMMON_GROUPS.filter((x) => x.before)) out.push(commonSection(g));
  for (const s of type?.sections ?? []) out.push(make(s.id, s.title, "details", s.fields));
  for (const g of COMMON_GROUPS.filter((x) => !x.before)) out.push(commonSection(g));
  // Gemeinsame Felder, die der Katalog neu einführt und die oben nicht vorkommen
  const rest = catalog.commonFields.filter((f) => !used.has(f.key) && !COMMON_GROUPS.some((g) => g.keys.includes(f.key)));
  if (rest.length > 0) out.push(make("weitere", "Weitere Angaben", "common", rest));
  return out.filter((s) => s.fields.length > 0 || s.hiddenCount > 0);
}

/** Wie viele Felder blendet «Wichtiges» aus? */
export function hiddenFieldCount(sections: FormSection[]): number {
  return sections.reduce((n, s) => n + s.hiddenCount, 0);
}

/* ─ Werte ─ */

export type PassengerValue = { participantId: number; values: Record<string, string> };
export type FieldValue = string | boolean | number[] | PassengerValue[];
export type FormValues = {
  common: Record<string, FieldValue>;
  details: Record<string, FieldValue>;
  /** Preiswährung (Spalte `currency`). */
  currency: string;
};

export function emptyValues(currency: string): FormValues {
  return { common: {}, details: {}, currency };
}

function s(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Ereignis → Formularwerte (alle Katalogfelder des Typs). */
export function eventToValues(catalog: Catalog, event: TripEvent, fallbackCurrency: string): FormValues {
  const type = getType(catalog, event.type);
  const currency = event.currency || fallbackCurrency;
  const common: Record<string, FieldValue> = {
    title: s(event.title),
    startDate: s(event.startDate),
    startTime: s(event.startTime),
    startTz: s(event.startTz),
    endDate: s(event.endDate),
    endTime: s(event.endTime),
    endTz: s(event.endTz),
    location: s(event.location),
    address: s(event.address),
    provider: s(event.provider),
    bookingReference: s(event.bookingReference),
    website: s(event.website),
    phone: s(event.phone),
    participantIds: event.participantIds ?? [],
    priceMinor: event.priceMinor != null ? minorToInput(event.priceMinor, currency) : "",
    paymentStatus: s(event.paymentStatus),
    paidByParticipantId: event.paidByParticipantId != null ? String(event.paidByParticipantId) : "",
    cancelUntil: s(event.cancelUntil),
    notes: s(event.notes),
  };
  const details: Record<string, FieldValue> = {};
  for (const sec of type?.sections ?? []) {
    for (const f of sec.fields) {
      const raw = event.details?.[f.key];
      details[f.key] = detailToValue(f, raw, currency);
    }
  }
  return { common, details, currency };
}

function detailToValue(f: CatalogField, raw: unknown, currency: string): FieldValue {
  switch (f.kind) {
    case "bool":
      return raw === true;
    case "money":
      return typeof raw === "number" ? minorToInput(raw, currency) : "";
    case "passengers":
      if (!Array.isArray(raw)) return [];
      return (raw as PassengerRow[]).map((row) => ({
        participantId: Number(row.participantId),
        values: Object.fromEntries(
          (f.fields ?? []).map((sf) => [sf.key, s((row as Record<string, unknown>)[sf.key])])
        ),
      }));
    default:
      return s(raw);
  }
}

export function applyTransform(field: Pick<CatalogField, "transform">, value: string): string {
  if (field.transform === "upper") return value.toUpperCase();
  return value;
}

/** Fehlermeldung zu einem Feldwert oder `null`. Leere Werte sind gültig, ausser bei `required`. */
export function validateField(field: CatalogField, value: FieldValue | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (field.required && (typeof value === "string" ? text === "" : value == null)) return `${field.label} erforderlich`;
  if (typeof value !== "string" || text === "") return null;
  switch (field.kind) {
    case "date":
      return isValidIsoDate(text) ? null : `${field.label}: Datum als TT.MM.JJJJ eingeben`;
    case "time":
      return CLOCK.test(text) ? null : `${field.label}: Uhrzeit als hh:mm eingeben`;
    case "number": {
      const n = Number(text.replace(/[’'\s]/g, ""));
      return Number.isInteger(n) && n >= 0 ? null : `${field.label}: ganze Zahl erwartet`;
    }
    case "airport":
      return /^[A-Za-z]{3,4}$/.test(text) ? null : `${field.label}: dreistelliger IATA-Code erwartet (z. B. ZRH)`;
    default:
      break;
  }
  if (field.maxLength && text.length > field.maxLength) return `${field.label}: höchstens ${field.maxLength} Zeichen`;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(text)) {
        return `${field.label}: Format passt nicht${field.placeholder ? ` (z. B. ${field.placeholder})` : ""}`;
      }
    } catch {
      /* ungültiges Muster im Katalog: nicht prüfen */
    }
  }
  return null;
}

export type BuildResult = { input: EventInput; errors: Record<string, string> };

const PAYMENT: PaymentStatus[] = ["open", "paid", "deposit", "onsite"];

/**
 * Formularwerte → `EventInput`. Fehler stehen unter `common.<key>` / `details.<key>`.
 * `details` enthält nur Katalogschlüssel des Typs mit Wert (PATCH ersetzt `details` als Ganzes).
 */
export function valuesToInput(catalog: Catalog, typeId: string, values: FormValues): BuildResult {
  const type = getType(catalog, typeId);
  const errors: Record<string, string> = {};
  const commonFields = new Map(catalog.commonFields.map((f) => [f.key, f]));
  const str = (k: string): string => {
    const v = values.common[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const nul = (k: string): string | null => (str(k) === "" ? null : str(k));

  const normalized = (f: CatalogField, v: FieldValue | undefined): FieldValue | undefined =>
    typeof v === "string" ? applyTransform(f, v) : v;
  for (const [k, f] of commonFields) {
    const label = commonFieldLabel(f, type);
    const err = validateField({ ...f, label }, normalized(f, values.common[k]));
    if (err) errors[`common.${k}`] = err;
  }
  if (str("title") === "") errors["common.title"] = "Titel erforderlich";
  const sd = str("startDate");
  const ed = str("endDate");
  if (sd && ed && ed < sd) errors["common.endDate"] = "Das Ende liegt vor dem Beginn";

  let priceMinor: number | null = null;
  if (str("priceMinor") !== "") {
    const p = parseMinor(str("priceMinor"), values.currency, { allowZero: true });
    if (p.ok) priceMinor = p.minor;
    else errors["common.priceMinor"] = p.error;
  }

  const details: EventDetails = {};
  for (const sec of type?.sections ?? []) {
    for (const f of sec.fields) {
      const v = normalized(f, values.details[f.key]);
      const err = validateField(f, v);
      if (err) {
        errors[`details.${f.key}`] = err;
        continue;
      }
      switch (f.kind) {
        case "bool":
          if (v === true) details[f.key] = true;
          break;
        case "number":
          if (typeof v === "string" && v.trim() !== "") details[f.key] = Number(v.replace(/[’'\s]/g, ""));
          break;
        case "money":
          if (typeof v === "string" && v.trim() !== "") {
            const p = parseMinor(v, values.currency, { allowZero: true });
            if (p.ok) details[f.key] = p.minor;
            else errors[`details.${f.key}`] = `${f.label}: ${p.error}`;
          }
          break;
        case "passengers": {
          const rows = (Array.isArray(v) ? (v as PassengerValue[]) : [])
            .map((r) => {
              const row: PassengerRow = { participantId: r.participantId };
              for (const sf of f.fields ?? []) {
                const t = (r.values[sf.key] ?? "").trim();
                if (t) row[sf.key] = applyTransform(sf, t);
              }
              return row;
            })
            .filter((r) => Object.keys(r).length > 1);
          if (rows.length > 0) details[f.key] = rows;
          break;
        }
        default:
          if (typeof v === "string" && v.trim() !== "") details[f.key] = applyTransform(f, v.trim());
      }
    }
  }

  const paymentRaw = str("paymentStatus");
  const paidBy = str("paidByParticipantId");
  const pids = values.common.participantIds;
  const input: EventInput = {
    type: type?.id ?? typeId,
    title: str("title"),
    startDate: nul("startDate"),
    endDate: hasEnd(type) ? nul("endDate") : null,
    startTime: nul("startTime"),
    endTime: hasEnd(type) ? nul("endTime") : null,
    startTz: nul("startTz"),
    endTz: hasEnd(type) ? nul("endTz") : null,
    location: nul("location"),
    address: nul("address"),
    provider: nul("provider"),
    bookingReference: nul("bookingReference") ? applyTransform(commonFields.get("bookingReference") ?? {}, str("bookingReference")) : null,
    website: nul("website"),
    phone: nul("phone"),
    notes: nul("notes"),
    details,
    participantIds: Array.isArray(pids) ? (pids as number[]) : [],
    priceMinor,
    currency: priceMinor != null ? values.currency : null,
    paymentStatus: (PAYMENT as string[]).includes(paymentRaw) ? (paymentRaw as PaymentStatus) : null,
    paidByParticipantId: paidBy ? Number(paidBy) : null,
    cancelUntil: nul("cancelUntil"),
  };
  return { input, errors };
}

/** Beschriftung einer Auswahl: `optionLabels` hat Vorrang vor dem gespeicherten Wert. */
export function optionLabel(field: CatalogField, value: string): string {
  if (!Array.isArray(field.options)) return value;
  const i = field.options.indexOf(value);
  return i >= 0 ? field.optionLabels?.[i] ?? value : value;
}

/** Katalogfeld eines Typs per Schlüssel (für Detailansicht und Herkunftspunkte). */
export function findField(catalog: Catalog, typeId: string, key: string): CatalogField | null {
  const t = getType(catalog, typeId);
  for (const sec of t?.sections ?? []) {
    const f = sec.fields.find((x) => x.key === key);
    if (f) return f;
  }
  return catalog.commonFields.find((f) => f.key === key) ?? null;
}

/** Katalogfarbe eines Typs als CSS-Variable, z. B. `var(--k-air)`. */
export function typeColorVar(catalog: Catalog, typeId: string): string {
  const t = getType(catalog, typeId);
  return `var(--k-${t?.color ?? "doc"})`;
}
