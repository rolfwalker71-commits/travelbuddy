/**
 * Gemeinsame Typen der Eingangs-Pipeline (Dokument → Text → KI/Regeln → Vorschläge).
 *
 * Datenfluss: `SourceContent` (Text je Seite, Barcodes, Kandidaten) → `Extraction` (rohe KI-Ausgabe) →
 * `ProposedEvent` (normalisiert, geprüft, mit Herkunft je Feld) → Ereignis (neu oder Ergänzung).
 */
import type { EventStatus } from "../trips/service";

export type PageText = { page: number; text: string };

/** Hinweis zur Prüfung; `needsReview` = Mensch muss hinschauen, sonst nur Information. */
export type Issue = {
  field?: string;
  code: string;
  message: string;
  needsReview: boolean;
};

export type AddressParts = {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
};

/* ───────────── Rohe KI-Ausgabe ───────────── */

export type ExtractedField = {
  key: string;
  value: string;
  confidence: number;
  page: number | null;
  quote: string | null;
  currency: string | null;
};

export type ExtractedPassenger = {
  name: string | null;
  /** Unterfelder des Katalogs (`seat`, `ticketNumber`, `frequentFlyer`, `coach`), nur gesetzte. */
  values: Record<string, string>;
  page: number | null;
  quote: string | null;
};

export type ExtractedEvent = {
  type: string;
  confidence: number;
  fields: ExtractedField[];
  addressParts: AddressParts | null;
  placeAddresses: Array<{ field: string; address: string | null }>;
  passengers: ExtractedPassenger[];
};

export type Extraction = {
  summary: string;
  documentKind: string | null;
  trip: { title: string | null; destination: string | null; startDate: string | null; endDate: string | null };
  events: ExtractedEvent[];
};

/* ───────────── Kandidaten aus Barcode, ICS, Pass ───────────── */

export type CandidateOrigin = "bcbp" | "pkpass" | "ics";

/**
 * Deterministisch gewonnene Teil-Ereignisse. `fields` nutzt API-Namen des Katalogs (gemeinsame Felder und
 * `details`-Schlüssel) mit bereits normalisierten Werten. Bei Widerspruch zur KI gewinnt der Kandidat.
 */
export type Candidate = {
  origin: CandidateOrigin;
  type: string;
  fields: Record<string, string | number | boolean>;
  /** Julianischer Tag (BCBP kennt kein Jahr); wird mit einem Referenzdatum zu `startDate`. */
  dayOfYear?: number;
  passenger?: { name: string; seat: string | null };
  quote: string;
  page: number;
  confidence: number;
  /** Felder, die bei Widerspruch die KI-Werte überstimmen. */
  authoritative: string[];
  /** Nur Barcode: ohne weitere Angaben ist der Kandidat allein kein vollständiges Ereignis. */
  weak?: boolean;
};

/* ───────────── Quelle ───────────── */

export type SourceKind = "pdf" | "image" | "ics" | "pkpass";

export type Attachment =
  | { kind: "pdf"; fileName: string; base64: string }
  | { kind: "image"; mime: string; base64: string };

export type SourceContent = {
  kind: SourceKind;
  /** pdf_text | vision | ics | pkpass */
  textSource: "pdf_text" | "vision" | "ics" | "pkpass";
  pages: PageText[];
  pageCount: number | null;
  /** Zeichen der Textebene (ohne Seitenmarken). */
  chars: number;
  /** Zu wenig Text (Scan/Foto): Bild bzw. PDF an das Vision-Modell. */
  needsVision: boolean;
  attachments: Attachment[];
  candidates: Candidate[];
  notes: string[];
};

/* ───────────── Vorschlag ───────────── */

export type FieldOrigin = {
  source: "document" | "derived";
  confidence: number;
  page: number | null;
  quote: string | null;
  needsReview?: boolean;
  /** Aus einem Barcode: wird nicht gegen den Text geprüft (der Barcode ist die Referenz). */
  verified?: boolean;
};

export type ProposedPassenger = ExtractedPassenger;

export type ProposedEvent = {
  type: string;
  /** Gemeinsame Felder (API-Namen): title, startDate, …, priceMinor, currency, paymentStatus, cancelUntil, notes. */
  common: Record<string, string | number | null>;
  /** Typ-Felder des Katalogs (ohne `passengers`). */
  details: Record<string, string | number | boolean>;
  /** Herkunft je Feldname (gemeinsame Felder und Katalog-Schlüssel). */
  meta: Record<string, FieldOrigin>;
  passengers: ProposedPassenger[];
  addressParts: AddressParts | null;
  /** Adressen weiterer Orte je Feldname (`returnPlace` …); stehen als «Name, Adresse» im Ortsfeld. */
  placeAddresses: Record<string, string>;
  confidence: number;
  issues: Issue[];
  origins: Array<"llm" | CandidateOrigin>;
  status: EventStatus;
};

export type ProposedTrip = {
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  eventCount: number;
  candidateTripIds: number[];
};

export type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number };
