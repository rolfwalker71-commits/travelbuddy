/**
 * Haken der Dokumentanalyse (PDF → Text → KI → Ereignis-Vorschläge).
 *
 * Upload und Hintergrundlauf rufen `DocumentAnalyzer.analyze(documentId)` auf. Die echte Implementierung ist
 * `IngestAnalyzer` (`pipeline.ts`); `NoopAnalyzer` bleibt als Standard von `createApp` ohne Anbindung (Tests,
 * Betrieb ohne Auswertung). Vertrag der Implementierung:
 *
 *  - Eingabe ist die Zeile in `documents` (Datei: `documentFilePath()` in `ingest/store.ts`).
 *  - Sie setzt `analysis_status` auf `done`, `failed` oder `skipped` (und `analysis_error`, `analysis_json`,
 *    `analysis_model`, `analyzed_at`, `summary`, `text`, `text_source`, `pages`).
 *  - Ereignisse legt sie mit `trips/service.ts` an (`createEvent(db, tripId, input, { markManual: false,
 *    fieldsMeta })`, Status `proposed`/`needs_review`) und ergänzt vorhandene mit `applyExtraction(…)`, das
 *    gesperrte Felder nie anfasst.
 *  - Wirft sie, vermerkt der Hintergrundlauf `failed` mit Wiederholung (5 min, 10 min, … höchstens 6 h, 5 Versuche).
 */
import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";

/** Marker im `analysis_error`: «übersprungen, weil kein KI-Schlüssel»; ein späterer Lauf mit Schlüssel holt es nach. */
export const NO_KEY_MARKER = "KI nicht konfiguriert";

export type AdoptOverrides = {
  tripId?: number;
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string;
  homeCurrency?: string;
};

export interface DocumentAnalyzer {
  analyze(documentId: number): Promise<void>;
  /** Optional: Die Analyse kann gerade KI nutzen (Schlüssel vorhanden); dann werden «ohne Schlüssel» übersprungene Dokumente nachgeholt. */
  ready?(): boolean;
  /** Optional: Reise aus dem Vorschlag eines Dokuments anlegen und die Vorschläge übernehmen (`POST …/adopt-trip`). */
  adopt?(documentId: number, user: AuthUser, overrides: AdoptOverrides): Promise<{ tripId: number; created: number; merged: number }>;
}

/** Standard ohne KI-Anbindung: markiert das Dokument als übersprungen. */
export class NoopAnalyzer implements DocumentAnalyzer {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  async analyze(documentId: number): Promise<void> {
    const ts = this.now().toISOString();
    this.db
      .prepare(
        `UPDATE documents SET analysis_status = 'skipped', analysis_error = 'Analyse nicht konfiguriert',
                analysis_next_retry_at = NULL, updated_at = ? WHERE id = ?`
      )
      .run(ts, documentId);
  }
}

export const MAX_ANALYSIS_ATTEMPTS = 5;
/** Ein hängengebliebenes «processing» wird nach so vielen Minuten wieder aufgenommen. */
const STALE_PROCESSING_MIN = 15;

/** Führt die Analyse eines Dokuments mit Statuspflege aus; wirft nie. */
export async function runAnalysis(db: Db, analyzer: DocumentAnalyzer, documentId: number, now: () => Date = () => new Date()): Promise<void> {
  const row = db.prepare("SELECT id, analysis_attempts FROM documents WHERE id = ?").get(documentId) as
    | { id: number; analysis_attempts: number }
    | undefined;
  if (!row) return;
  db.prepare(
    "UPDATE documents SET analysis_status = 'processing', analysis_next_retry_at = NULL, updated_at = ? WHERE id = ?"
  ).run(now().toISOString(), documentId);
  try {
    await analyzer.analyze(documentId);
    const after = db.prepare("SELECT analysis_status FROM documents WHERE id = ?").get(documentId) as
      | { analysis_status: string }
      | undefined;
    if (after?.analysis_status === "processing") {
      throw new Error("Die Analyse hat keinen Status gesetzt");
    }
  } catch (e) {
    const gone = !db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId);
    if (gone) return;
    const attempts = row.analysis_attempts + 1;
    const delayMs = Math.min(5 * 60_000 * 2 ** (attempts - 1), 6 * 3_600_000);
    // Fehler, die sich durch Warten nicht ändern (`retryable === false`, z. B. ungültiger Schlüssel), nicht wiederholen.
    const final = (e as { retryable?: boolean } | null)?.retryable === false;
    const next = final || attempts >= MAX_ANALYSIS_ATTEMPTS ? null : new Date(now().getTime() + delayMs).toISOString();
    db.prepare(
      `UPDATE documents SET analysis_status = 'failed', analysis_attempts = ?, analysis_next_retry_at = ?,
              analysis_error = ?, updated_at = ? WHERE id = ?`
    ).run(attempts, next, (e instanceof Error ? e.message : String(e)).slice(0, 500), now().toISOString(), documentId);
  }
}

/** Hintergrundlauf: wartende, fällige fehlgeschlagene und hängengebliebene Dokumente nacheinander analysieren. */
export async function runPendingAnalyses(
  db: Db,
  analyzer: DocumentAnalyzer,
  opts: { now?: () => Date; limit?: number } = {}
): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const stale = new Date(now().getTime() - STALE_PROCESSING_MIN * 60_000).toISOString();
  // Mit Schlüssel werden Dokumente nachgeholt, die zuvor «ohne Schlüssel» übersprungen wurden.
  const catchUp = analyzer.ready?.() === true ? 1 : 0;
  const ids = (
    db
      .prepare(
        `SELECT id FROM documents
          WHERE analysis_status = 'pending'
             OR (analysis_status = 'failed' AND analysis_next_retry_at IS NOT NULL AND analysis_next_retry_at <= ?)
             OR (analysis_status = 'processing' AND updated_at < ?)
             OR (? = 1 AND analysis_status = 'skipped' AND analysis_error LIKE ?)
          ORDER BY id LIMIT ?`
      )
      .all(nowIso, stale, catchUp, `${NO_KEY_MARKER}%`, opts.limit ?? 10) as { id: number }[]
  ).map((r) => r.id);
  for (const id of ids) await runAnalysis(db, analyzer, id, now);
  return ids.length;
}
