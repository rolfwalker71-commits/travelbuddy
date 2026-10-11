/**
 * Extraktions-Schema und Schlüsselverzeichnis, erzeugt aus `shared/event-types.json` (über den Katalog).
 *
 * Je Ereignis liefert die KI eine Liste `fields[]` mit nur den im Dokument vorhandenen Feldern; jedes Feld trägt
 * `value`, `confidence`, `page` und `quote`. Adressen weiterer Orte sind eigene Textfelder des Typs
 * (`pickupAddress`, `returnAddress`, `originAddress`, `destinationAddress`, `venueAddress`, `terminalAddress`).
 * Das ist gleichwertig zu «alle Felder je Typ mit Wert/Sicherheit/Seite/
 * Zitat», spart aber Ausgabe (kein `null`-Block je Feld). Geldfelder heissen im Schema ohne «Minor» (`price`,
 * `deposit` …) und tragen Beträge als Dezimalzahl der Hauptwährung; der Code rechnet in Minor Units um.
 */
import type { Catalog, FieldDef, FieldKind } from "../catalog/catalog";

/** Gemeinsame Felder, die nicht aus Dokumenten kommen (Person-IDs gibt es nur im Server). */
const SKIP_COMMON = new Set(["participantIds", "paidByParticipantId"]);

export type KeyInfo = {
  /** Name im Schema (bei Geldfeldern ohne «Minor»). */
  schemaKey: string;
  /** Name im Ereignis (gemeinsames Feld oder `details`-Schlüssel). */
  apiKey: string;
  kind: FieldKind;
  def: FieldDef;
  common: boolean;
  /** Typen, in deren `details` der Schlüssel vorkommt (leer bei gemeinsamen Feldern). */
  types: string[];
};

export const stripMinor = (key: string) => key.replace(/Minor$/, "");

export function extractionKeys(cat: Catalog): Map<string, KeyInfo> {
  const out = new Map<string, KeyInfo>();
  for (const f of cat.file.commonFields) {
    if (SKIP_COMMON.has(f.key)) continue;
    const schemaKey = f.kind === "money" ? stripMinor(f.key) : f.key;
    out.set(schemaKey, { schemaKey, apiKey: f.key, kind: f.kind, def: f, common: true, types: [] });
  }
  for (const t of cat.types.values()) {
    for (const [key, def] of t.fields) {
      if (def.kind === "passengers") continue;
      const schemaKey = def.kind === "money" ? stripMinor(key) : key;
      const hit = out.get(schemaKey);
      if (hit) {
        if (!hit.common && !hit.types.includes(t.id)) hit.types.push(t.id);
        continue;
      }
      out.set(schemaKey, { schemaKey, apiKey: key, kind: def.kind, def, common: false, types: [t.id] });
    }
  }
  return out;
}

/** Felder je Passagier (Unterfelder der `passengers`-Felder im Katalog). */
export function passengerSubfields(cat: Catalog): string[] {
  const keys = new Set<string>();
  for (const t of cat.types.values()) {
    for (const def of t.fields.values()) {
      if (def.kind === "passengers") for (const s of def.fields ?? []) keys.add(s.key);
    }
  }
  return [...keys];
}

/** Schlüssel, die einen Ort (Name oder Adresse) bezeichnen und eine eigene Adresse tragen dürfen. */
export function placeKeys(cat: Catalog): string[] {
  const keys = new Set<string>(["location"]);
  for (const t of cat.types.values()) {
    for (const [key, def] of t.fields) if (def.kind === "place") keys.add(key);
  }
  return [...keys];
}

const nullable = (type: string | string[]) => ({ type: [...(Array.isArray(type) ? type : [type]), "null"] });

export function buildExtractionSchema(cat: Catalog): { name: string; schema: Record<string, unknown> } {
  const keys = [...extractionKeys(cat).keys()];
  const pax = passengerSubfields(cat);
  const addrParts = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["street", "postalCode", "city", "region", "country"],
    properties: {
      street: nullable("string"),
      postalCode: nullable("string"),
      city: nullable("string"),
      region: nullable("string"),
      country: nullable("string"),
    },
  };
  const passenger = {
    type: "object",
    additionalProperties: false,
    required: ["name", ...pax, "page", "quote"],
    properties: {
      name: nullable("string"),
      ...Object.fromEntries(pax.map((k) => [k, nullable("string")])),
      page: nullable("integer"),
      quote: nullable("string"),
    },
  };
  const field = {
    type: "object",
    additionalProperties: false,
    required: ["key", "value", "confidence", "page", "quote", "currency"],
    properties: {
      key: { type: "string", enum: keys },
      value: { type: "string" },
      confidence: { type: "number" },
      page: nullable("integer"),
      quote: nullable("string"),
      currency: nullable("string"),
    },
  };
  const event = {
    type: "object",
    additionalProperties: false,
    required: ["type", "confidence", "fields", "addressParts", "passengers"],
    properties: {
      type: { type: "string", enum: cat.typeIds },
      confidence: { type: "number" },
      fields: { type: "array", items: field },
      addressParts: addrParts,
      passengers: { type: "array", items: passenger },
    },
  };
  return {
    name: "travelbuddy_extraction",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "documentKind", "trip", "events"],
      properties: {
        summary: { type: "string" },
        documentKind: nullable("string"),
        trip: {
          type: "object",
          additionalProperties: false,
          required: ["title", "destination", "startDate", "endDate"],
          properties: {
            title: nullable("string"),
            destination: nullable("string"),
            startDate: nullable("string"),
            endDate: nullable("string"),
          },
        },
        events: { type: "array", items: event },
      },
    },
  };
}

const KIND_HELP: Record<string, string> = {
  text: "Text",
  longtext: "Text",
  date: "Datum YYYY-MM-DD",
  time: "Uhrzeit HH:mm (24 h, Ortszeit)",
  number: "ganze Zahl",
  money: "Betrag als Dezimalzahl der Hauptwährung, z. B. 1234.50",
  bool: "true oder false",
  airport: "IATA-Code, 3 Grossbuchstaben",
  place: "Ortsname (ohne Strasse), Adresse siehe placeAddresses",
};

function describe(info: KeyInfo): string {
  const d = info.def;
  let kind = KIND_HELP[info.kind] ?? "Text";
  if (info.kind === "select") {
    if (d.options === "iana") kind = "IANA-Zeitzone, z. B. Europe/Zurich (nur wenn aus dem Dokument ableitbar)";
    else if (Array.isArray(d.options)) {
      const labels = d.optionLabels ?? [];
      kind = `Auswahl: ${d.options.map((o, i) => (labels[i] && labels[i] !== o ? `${o} (${labels[i]})` : o)).join(" | ")}`;
    }
  }
  const unit = d.unit ? `, in ${d.unit}` : "";
  const ph = d.placeholder ? `, z. B. ${d.placeholder}` : "";
  return `${info.schemaKey}: ${d.label} – ${kind}${unit}${ph}`;
}

/** Schlüsselverzeichnis für den Prompt: gemeinsame Felder, dann je Typ die Detail-Felder. */
export function keyReference(cat: Catalog): string {
  const keys = extractionKeys(cat);
  const lines: string[] = ["GEMEINSAME FELDER (alle Typen):"];
  for (const k of keys.values()) if (k.common) lines.push(`- ${describe(k)}`);
  for (const t of cat.types.values()) {
    const own = [...t.fields.entries()].filter(([, def]) => def.kind !== "passengers");
    const startEnd = `Beginn = ${t.startLabel}${t.endLabel ? `, Ende = ${t.endLabel}` : ""}`;
    lines.push("", `TYP «${t.id}» (${t.label}; ${startEnd}) – Felder:`);
    for (const [key] of own) {
      const info = keys.get(key.endsWith("Minor") ? stripMinor(key) : key);
      if (info) lines.push(`- ${describe(info)}`);
    }
    if ([...t.fields.values()].some((f) => f.kind === "passengers")) {
      lines.push(`- passengers[] (separat): Name, ${passengerSubfields(cat).join(", ")} je Person`);
    }
  }
  return lines.join("\n");
}
