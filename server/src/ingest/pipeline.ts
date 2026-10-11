/**
 * Die echte Dokumentanalyse (ersetzt `NoopAnalyzer`): Quelle lesen → deterministische Kandidaten (BCBP, ICS,
 * Pass) → KI extrahiert (OpenAI, strikte Struktur) → Code normalisiert, prüft und gleicht ab → Reise zuordnen →
 * Ereignisse anlegen oder ergänzen → Adressen geokodieren → «Zu prüfen» melden.
 *
 * Ohne Schlüssel läuft nur der deterministische Teil; ohne verwertbares Ergebnis wird das Dokument als
 * «übersprungen» mit Hinweis markiert (kein Absturz). Fehler des KI-Dienstes werfen und gehen in den
 * Backoff von `runAnalysis` (5 min, 10 min, … höchstens 6 h, 5 Versuche).
 */
import fs from "node:fs";
import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";
import { Catalog, getCatalog } from "../catalog/catalog";
import type { Geocoder } from "../geo/geocode";
import { conflict } from "../lib/errors";
import { appTimeZone, displayDate } from "../lib/dates";
import { isValidTimeZone } from "../lib/tz";
import * as T from "../trips/service";
import { NO_KEY_MARKER, type AdoptOverrides, type DocumentAnalyzer } from "./analyzer";
import { applyProposals, type ApplyResult, type ReviewNotifier } from "./apply";
import { pickTrip, rankTrips, signalsOf, type TripCandidate } from "./assign";
import { crossCheckText, reconcileCandidates } from "./crosscheck";
import { chunkPages, mergeExtractions, parseExtraction } from "./extraction";
import { finalizeAll } from "./finalize";
import { dedupeProposed } from "./match";
import { maskSensitive } from "./mask";
import { airportCity, normalizeExtraction } from "./normalize";
import { LlmError, type LlmRequest, type StructuredLlm } from "./openai";
import { systemPrompt, userPrompt, type TripContext } from "./prompt";
import { buildExtractionSchema } from "./schema";
import { documentLinks, getDocumentRow, originalPath, type DocumentRow } from "./service";
import {
  heicConverter, loadSource, pdftoppmRenderer, type HeicConverter, type PageRenderer,
} from "./source";
import { popplerAvailable } from "./store";
import type { Candidate, Extraction, PageText, ProposedEvent, ProposedTrip, SourceContent } from "./types";
import { recordUsage } from "./usage";

export const DEFAULT_AUTO_CONFIRM_MIN = 0.92;
export const DEFAULT_TOLERANCE_DAYS = 7;
export const DEFAULT_CHUNK_CHARS = 24_000;
const MAX_TEXT_STORED = 200_000;

export type IngestOptions = {
  db: Db;
  documentsDir: string;
  llm: StructuredLlm | null;
  models?: { text: string; vision: string };
  catalog?: Catalog;
  geocoder?: Geocoder | null;
  notifier?: ReviewNotifier | null;
  now?: () => Date;
  autoConfirmMin?: number;
  toleranceDays?: number;
  maxChunkChars?: number;
  /** Seiten rendern (Vorgabe: pdftoppm, falls installiert); `null` = nie rendern, PDF direkt senden. */
  render?: PageRenderer | null;
  heic?: HeicConverter | null;
  log?: (msg: string) => void;
};

export type ProposalRun = {
  extraction: Extraction | null;
  proposals: ProposedEvent[];
  models: string[];
  mode: "text" | "vision" | "none";
  masked: { passport: number; card: number; iban: number };
};

export type RunContext = {
  documentId: number | null;
  fileName: string;
  trip: TripContext | null;
  referenceDate: string;
};

/** Konfiguration aus der Umgebung (Zahlen mit Vorgaben). */
export function ingestEnv(env: Record<string, string | undefined> = process.env) {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v != null && v.trim() !== "" && Number.isFinite(n) ? n : d;
  };
  return {
    autoConfirmMin: num(env.TRAVELBUDDY_AUTO_CONFIRM_MIN, DEFAULT_AUTO_CONFIRM_MIN),
    toleranceDays: Math.max(0, Math.round(num(env.TRAVELBUDDY_TRIP_TOLERANCE_DAYS, DEFAULT_TOLERANCE_DAYS))),
    maxChunkChars: Math.max(4_000, Math.round(num(env.TRAVELBUDDY_AI_CHUNK_CHARS, DEFAULT_CHUNK_CHARS))),
  };
}

const parseJson = <X>(s: string | null | undefined, fb: X): X => {
  try {
    return s ? (JSON.parse(s) as X) : fb;
  } catch {
    return fb;
  }
};

export class IngestAnalyzer implements DocumentAnalyzer {
  readonly catalog: Catalog;
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly models: { text: string; vision: string };
  private readonly autoConfirmMin: number;
  private readonly toleranceDays: number;
  private readonly chunkChars: number;
  private renderer: PageRenderer | null | undefined;

  constructor(private readonly o: IngestOptions) {
    const env = ingestEnv();
    this.catalog = o.catalog ?? getCatalog();
    this.now = o.now ?? (() => new Date());
    this.log = o.log ?? (() => undefined);
    this.models = o.models ?? { text: "gpt-4o-mini", vision: "gpt-4o" };
    this.autoConfirmMin = o.autoConfirmMin ?? env.autoConfirmMin;
    this.toleranceDays = o.toleranceDays ?? env.toleranceDays;
    this.chunkChars = o.maxChunkChars ?? env.maxChunkChars;
    this.renderer = o.render;
  }

  /** Mit Schlüssel (KI) oder ohne (nur Barcode, Kalender, Pass). */
  ready(): boolean {
    return this.o.llm != null;
  }

  private async pageRenderer(): Promise<PageRenderer | null> {
    if (this.renderer !== undefined) return this.renderer;
    this.renderer = (await popplerAvailable()) ? pdftoppmRenderer : null;
    return this.renderer;
  }

  /* ───────────── KI-Aufruf mit Reparatur ───────────── */

  private async call(req: LlmRequest, documentId: number | null, mode: "text" | "vision"): Promise<Extraction> {
    const llm = this.o.llm!;
    const at = this.now();
    const attempt = async (r: LlmRequest, purpose: "extract" | "repair") => {
      try {
        const res = await llm.complete(r);
        recordUsage(this.o.db, { documentId, purpose, mode, model: res.model, usage: res.usage, ok: true, at });
        return res;
      } catch (e) {
        recordUsage(this.o.db, {
          documentId, purpose, mode, model: r.model, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
          ok: false, error: e instanceof Error ? e.message : String(e), at,
        });
        throw e;
      }
    };
    const first = await attempt(req, "extract");
    if (first.finishReason === "length") {
      throw new LlmError("KI-Antwort wurde abgeschnitten (zu viele Ereignisse in einem Teil)", true);
    }
    const parsed = parseExtraction(first.content, this.catalog);
    if (parsed.ok) return parsed.value;
    // Ein Reparaturversuch mit der Fehlerliste.
    const second = await attempt({ ...req, purpose: "repair", previous: { output: first.content, problems: parsed.problems } }, "repair");
    const again = parseExtraction(second.content, this.catalog);
    if (again.ok) return again.value;
    throw new LlmError(`KI-Ausgabe auch nach Reparatur ungültig: ${again.problems[0] ?? "unbekannt"}`, true);
  }

  private hintsOf(candidates: Candidate[]): string[] {
    return candidates
      .filter((c) => c.origin === "bcbp" || c.fields.flightNumber)
      .slice(0, 12)
      .map((c) => {
        const f = c.fields;
        const bits = [
          `Flug ${f.flightNumber ?? "?"} ${f.departureAirport ?? "?"}–${f.arrivalAirport ?? "?"}`,
          f.startDate ? `Datum ${f.startDate}` : c.dayOfYear ? `Tag ${c.dayOfYear} des Jahres` : null,
          f.bookingReference ? `Buchungscode ${f.bookingReference}` : null,
          c.passenger?.name ? `Passagier ${c.passenger.name}${c.passenger.seat ? `, Sitz ${c.passenger.seat}` : ""}` : null,
        ];
        return bits.filter(Boolean).join(", ");
      });
  }

  /* ───────────── Vorschläge erzeugen (ohne Schreiben in Reisedaten) ───────────── */

  async propose(source: SourceContent, ctx: RunContext): Promise<ProposalRun> {
    const cat = this.catalog;
    const llm = this.o.llm;
    const masked = { passport: 0, card: 0, iban: 0 };
    const pages: PageText[] = source.pages.map((p) => {
      const m = maskSensitive(p.text);
      masked.passport += m.masked.passport;
      masked.card += m.masked.card;
      masked.iban += m.masked.iban;
      return { page: p.page, text: m.text };
    });
    // Die maskierte Fassung ist die einzige, die das Modell sieht und gegen die Zitate geprüft werden.
    source.pages = pages;

    let extraction: Extraction | null = null;
    let mode: ProposalRun["mode"] = "none";
    const models: string[] = [];
    const usable = pages.some((p) => p.text.trim()) || source.attachments.length > 0;
    if (llm && usable) {
      const system = systemPrompt(cat, this.now());
      const schema = buildExtractionSchema(cat);
      const hints = this.hintsOf(source.candidates);
      if (source.needsVision && source.attachments.length) {
        mode = "vision";
        models.push(this.models.vision);
        extraction = await this.call(
          {
            purpose: "extract", model: this.models.vision, system, schema, attachments: source.attachments,
            user: userPrompt({ fileName: ctx.fileName, pages, trip: ctx.trip, hints, vision: true }),
          },
          ctx.documentId, "vision"
        );
      } else if (pages.some((p) => p.text.trim())) {
        mode = "text";
        models.push(this.models.text);
        const parts = chunkPages(pages, this.chunkChars);
        const results: Extraction[] = [];
        for (let i = 0; i < parts.length; i++) {
          results.push(
            await this.call(
              {
                purpose: "extract", model: this.models.text, system, schema,
                user: userPrompt({ fileName: ctx.fileName, pages: parts[i]!, trip: ctx.trip, hints, chunk: { index: i + 1, of: parts.length } }),
              },
              ctx.documentId, "text"
            )
          );
        }
        extraction = mergeExtractions(results);
      }
    }

    let proposals = extraction ? dedupeProposed(normalizeExtraction(extraction, cat)) : [];
    proposals = reconcileCandidates(proposals, source.candidates, { catalog: cat, referenceDate: ctx.referenceDate });
    if (source.textSource !== "vision") crossCheckText(proposals, pages);
    proposals = dedupeProposed(proposals);
    return { extraction, proposals, models, mode, masked };
  }

  /** Vorschläge für eine Datei, ohne Datenbankänderung ausser dem Kostenprotokoll (Eval, Vorschau). */
  async proposeBytes(input: { bytes: Uint8Array; contentType: string; fileName: string; filePath?: string }, ctx?: Partial<RunContext>) {
    const source = await loadSource(
      { contentType: input.contentType, fileName: input.fileName, bytes: input.bytes, filePath: input.filePath ?? "" },
      { defaultTz: appTimeZone(), render: await this.pageRenderer(), heic: this.o.heic ?? heicConverter }
    );
    const run = await this.propose(source, {
      documentId: ctx?.documentId ?? null, fileName: input.fileName, trip: ctx?.trip ?? null,
      referenceDate: ctx?.referenceDate ?? this.now().toISOString().slice(0, 10),
    });
    finalizeAll(run.proposals, { catalog: this.catalog, trip: null, toleranceDays: this.toleranceDays, autoConfirmMin: this.autoConfirmMin });
    return { source, ...run };
  }

  /* ───────────── DocumentAnalyzer ───────────── */

  async analyze(documentId: number): Promise<void> {
    const { db } = this.o;
    const row = getDocumentRow(db, documentId);
    const links = documentLinks(db, documentId);
    let bytes: Uint8Array;
    const filePath = originalPath(this.o.documentsDir, row);
    try {
      bytes = new Uint8Array(fs.readFileSync(filePath));
    } catch {
      throw new Error("Die Originaldatei fehlt auf dem Server");
    }

    // Reise: bereits verknüpft (Upload an die Reise) oder noch offen (Einwurf).
    let trip: T.TripRow | null = null;
    if (links.tripIds.length) trip = T.getTrip(db, links.tripIds[0]!);
    const tripCtx = trip ? this.tripContext(trip) : null;
    const source = await loadSource(
      { contentType: row.content_type, fileName: row.file_name, bytes, filePath },
      { defaultTz: trip?.timezone ?? appTimeZone(), render: await this.pageRenderer(), heic: this.o.heic ?? heicConverter }
    );
    const referenceDate = trip?.start_date ?? row.created_at.slice(0, 10);
    const run = await this.propose(source, { documentId, fileName: row.file_name, trip: tripCtx, referenceDate });
    const ts = this.now().toISOString();
    const base = {
      text: source.pages.map((p) => `=== Seite ${p.page} ===\n${p.text}`).join("\n").slice(0, MAX_TEXT_STORED) || null,
      textSource: source.textSource,
      pages: source.pageCount ?? row.pages,
    };

    // Nichts auswertbar: ohne Schlüssel «übersprungen», sonst «fertig» ohne Ereignisse.
    if (run.proposals.length === 0) {
      if (!this.o.llm) {
        this.finish(documentId, {
          ...base, status: "skipped", ts, model: null, summary: null,
          error: `${NO_KEY_MARKER} (OPENAI_API_KEY fehlt); Barcode, Kalender und Pass ergaben keine Ereignisse`,
          json: { version: 1, textSource: source.textSource, notes: source.notes, events: [], masked: run.masked },
        });
        return;
      }
      if (run.mode === "none") {
        this.finish(documentId, {
          ...base, status: "skipped", ts, model: null, summary: null,
          error: source.notes[0] ?? "Das Dokument enthält keinen lesbaren Inhalt",
          json: { version: 1, textSource: source.textSource, notes: source.notes, events: [], masked: run.masked },
        });
        return;
      }
    }

    // Reise zuordnen (nur ohne Verknüpfung).
    const sig = signalsOf(run.proposals, run.extraction?.trip ?? null);
    let ranking: TripCandidate[] = [];
    if (!trip && run.proposals.length) {
      ranking = rankTrips(db, sig, 3);
      const picked = pickTrip(ranking);
      if (picked != null) trip = T.getTrip(db, picked);
    } else if (trip && links.tripIds.length > 1) {
      const within = rankTrips(db, sig, 3).filter((c) => links.tripIds.includes(c.tripId));
      const picked = within[0];
      if (picked && picked.score > 0) trip = T.getTrip(db, picked.tripId);
    }

    finalizeAll(run.proposals, {
      catalog: this.catalog,
      trip: trip ? { startDate: trip.start_date, endDate: trip.end_date } : null,
      toleranceDays: this.toleranceDays,
      autoConfirmMin: this.autoConfirmMin,
    });

    let applied: ApplyResult | null = null;
    let proposedTrip: ProposedTrip | null = null;
    if (trip && run.proposals.length) {
      applied = await applyProposals(this.applyDeps(), {
        tripId: trip.id, documentId, proposals: run.proposals, hintEventIds: links.eventIds,
      });
      if (applied.skipped.length === run.proposals.length) {
        throw new Error(`Ereignisse konnten nicht angelegt werden: ${applied.skipped[0]!.error}`);
      }
    } else if (trip) {
      db.prepare("INSERT OR IGNORE INTO trip_documents (trip_id, document_id, created_at) VALUES (?, ?, ?)").run(trip.id, documentId, ts);
    } else if (run.proposals.length) {
      proposedTrip = this.buildProposedTrip(run.proposals, run.extraction, ranking, row);
    }

    const json = {
      version: 1,
      textSource: source.textSource,
      mode: run.mode,
      models: run.models,
      documentKind: run.extraction?.documentKind ?? null,
      tripHint: run.extraction?.trip ?? null,
      tripId: trip?.id ?? null,
      proposedTrip,
      events: run.proposals,
      applied,
      notes: source.notes,
      masked: run.masked,
      candidates: source.candidates.length,
      candidateTrips: ranking.slice(0, 5),
    };
    const created = applied?.created.length ?? 0;
    const merged = applied?.merged.length ?? 0;
    const summary =
      run.extraction?.summary ||
      (run.proposals.length
        ? `${run.proposals.length} Ereignis${run.proposals.length === 1 ? "" : "se"} erkannt`
        : "Keine Reiseereignisse erkannt");
    const noKey = !this.o.llm;
    this.finish(documentId, {
      ...base,
      status: noKey ? "skipped" : "done",
      ts,
      model: run.models.join(", ") || null,
      summary: summary.slice(0, 500),
      error: noKey
        ? `${NO_KEY_MARKER} (OPENAI_API_KEY fehlt); nur Barcode, Kalender und Pass ausgewertet (${run.proposals.length} Ereignisse)`
        : null,
      json,
    });
    this.log(
      `[ingest] Dokument ${documentId}: ${run.proposals.length} Ereignisse, ${created} neu, ${merged} ergänzt` +
        (proposedTrip ? ", Reisevorschlag" : trip ? ` (Reise ${trip.id})` : "")
    );
  }

  private finish(
    documentId: number,
    r: {
      status: "done" | "skipped";
      ts: string;
      text: string | null;
      textSource: string;
      pages: number | null;
      model: string | null;
      summary: string | null;
      error: string | null;
      json: unknown;
    }
  ): void {
    this.o.db
      .prepare(
        `UPDATE documents SET analysis_status = ?, analysis_error = ?, analysis_json = ?, analysis_model = ?, analyzed_at = ?,
                summary = ?, text = ?, text_source = ?, pages = COALESCE(?, pages), analysis_next_retry_at = NULL,
                analysis_attempts = 0, updated_at = ? WHERE id = ?`
      )
      .run(r.status, r.error, JSON.stringify(r.json), r.model, r.ts, r.summary, r.text, r.textSource, r.pages, r.ts, documentId);
  }

  private applyDeps() {
    return {
      db: this.o.db, catalog: this.catalog, geocoder: this.o.geocoder ?? null, notifier: this.o.notifier ?? null,
      now: this.now, log: this.log,
    };
  }

  private tripContext(trip: T.TripRow): TripContext {
    return {
      title: trip.title, destination: trip.destination, startDate: trip.start_date, endDate: trip.end_date,
      timezone: trip.timezone, travelers: T.listTravelers(this.o.db, trip.id).map((p) => p.display_name),
    };
  }

  /* ───────────── Reisevorschlag ───────────── */

  private buildProposedTrip(events: ProposedEvent[], ex: Extraction | null, ranking: TripCandidate[], row: DocumentRow): ProposedTrip {
    const dates = events
      .flatMap((e) => [e.common.startDate, e.common.endDate])
      .filter((d): d is string => typeof d === "string")
      .sort();
    const start = ex?.trip.startDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.trip.startDate) ? [ex.trip.startDate, dates[0]].filter(Boolean).sort()[0]! : dates[0] ?? null;
    const end = ex?.trip.endDate && /^\d{4}-\d{2}-\d{2}$/.test(ex.trip.endDate) ? [ex.trip.endDate, dates[dates.length - 1]].filter(Boolean).sort().pop()! : dates[dates.length - 1] ?? null;
    const destination = ex?.trip.destination?.trim() || guessDestination(events);
    const title =
      ex?.trip.title?.trim() ||
      (destination ? `Reise ${destination}${start ? ` ${displayDate(start)}` : ""}` : `Neue Reise (${row.title})`);
    // Zone: häufigste Zone der Ereignisse ausser Flügen (Abflugort ist oft der Heimatort), sonst Vorgabe.
    const zones = events.filter((e) => e.type !== "Flug").map((e) => e.common.startTz).filter((z): z is string => typeof z === "string" && isValidTimeZone(z));
    const counts = new Map<string, number>();
    for (const z of zones) counts.set(z, (counts.get(z) ?? 0) + 1);
    const timezone = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      title: title.slice(0, 200), destination: destination?.slice(0, 200) ?? null, startDate: start, endDate: end, timezone,
      eventCount: events.length, candidateTripIds: ranking.slice(0, 3).map((c) => c.tripId),
    };
  }

  /**
   * «Reise anlegen»: legt aus dem gespeicherten Vorschlag eine Reise an (oder ordnet einer vorhandenen zu,
   * wenn `tripId` gesetzt ist) und übernimmt die Vorschläge des Dokuments.
   */
  async adopt(
    documentId: number,
    user: AuthUser,
    overrides: AdoptOverrides = {}
  ): Promise<{ tripId: number; created: number; merged: number }> {
    const { db } = this.o;
    const row = getDocumentRow(db, documentId);
    const j = parseJson<{ proposedTrip?: ProposedTrip | null; events?: ProposedEvent[]; [k: string]: unknown }>(row.analysis_json, {});
    const proposals = Array.isArray(j.events) ? j.events : [];
    if (!proposals.length || (!j.proposedTrip && overrides.tripId == null)) {
      throw conflict("Für dieses Dokument liegt kein Reisevorschlag vor", "no_proposed_trip");
    }
    const links = documentLinks(db, documentId);
    if (links.tripIds.length && overrides.tripId == null) {
      throw conflict("Das Dokument ist bereits einer Reise zugeordnet", "already_assigned");
    }
    let trip: T.TripRow;
    if (overrides.tripId != null) {
      trip = T.getTrip(db, overrides.tripId);
    } else {
      const p = j.proposedTrip!;
      const tz = overrides.timezone ?? p.timezone ?? undefined;
      const tripId = T.createTrip(db, user, {
        title: (overrides.title ?? p.title).trim() || p.title,
        destination: overrides.destination !== undefined ? overrides.destination : p.destination,
        startDate: overrides.startDate !== undefined ? overrides.startDate : p.startDate,
        endDate: overrides.endDate !== undefined ? overrides.endDate : p.endDate,
        ...(tz && isValidTimeZone(tz) ? { timezone: tz } : {}),
        ...(overrides.homeCurrency ? { homeCurrency: overrides.homeCurrency } : {}),
      });
      trip = T.getTrip(db, tripId);
    }
    finalizeAll(proposals, {
      catalog: this.catalog, trip: { startDate: trip.start_date, endDate: trip.end_date },
      toleranceDays: this.toleranceDays, autoConfirmMin: this.autoConfirmMin,
    });
    const applied = await applyProposals(this.applyDeps(), { tripId: trip.id, documentId, proposals, hintEventIds: [] });
    const next = { ...j, proposedTrip: null, tripId: trip.id, events: proposals, applied };
    db.prepare("UPDATE documents SET analysis_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), this.now().toISOString(), documentId);
    return { tripId: trip.id, created: applied.created.length, merged: applied.merged.length };
  }
}

/** Zielort-Vermutung ohne KI-Angabe: Stadt der Hauptadresse, sonst Ankunftsstadt des ersten Fluges. */
function guessDestination(events: ProposedEvent[]): string | null {
  for (const e of events) {
    if (e.type === "Hotel" || e.type === "Unterkunft" || e.type === "Kreuzfahrt") {
      const city = e.addressParts?.city;
      if (city) return city;
      if (typeof e.common.location === "string" && e.type === "Kreuzfahrt") return e.common.location;
    }
  }
  const first = events
    .filter((e) => e.type === "Flug")
    .sort((a, b) => String(a.common.startDate ?? "").localeCompare(String(b.common.startDate ?? "")))[0];
  return airportCity(first?.details.arrivalAirport);
}
