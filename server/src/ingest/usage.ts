/** Protokoll der KI-Aufrufe (`ai_usage`): Tokens und geschätzte Kosten je Dokument. */
import type { Db } from "../db/client";
import type { Usage } from "./types";

/** US-Dollar je 1 Mio. Tokens (Eingabe, Ausgabe). Stand der Schätzung; unbekannte Modelle ergeben `null`. */
const PRICES: Array<[prefix: string, input: number, output: number]> = [
  ["gpt-4o-mini", 0.15, 0.6],
  ["gpt-4o", 2.5, 10],
  ["gpt-4.1-nano", 0.1, 0.4],
  ["gpt-4.1-mini", 0.4, 1.6],
  ["gpt-4.1", 2, 8],
  ["gpt-5-mini", 0.25, 2],
  ["gpt-5-nano", 0.05, 0.4],
  ["gpt-5", 1.25, 10],
  ["o4-mini", 1.1, 4.4],
];

/** Geschätzte Kosten in Mikro-US-Dollar (1 000 000 = 1 USD) oder null. */
export function estimateCostMicroUsd(model: string, u: Usage): number | null {
  const m = model.toLowerCase();
  const hit = PRICES.find(([p]) => m.startsWith(p));
  if (!hit) return null;
  const [, pin, pout] = hit;
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  // Zwischengespeicherte Eingabe kostet etwa die Hälfte (Näherung).
  return Math.round(fresh * pin + u.cachedTokens * pin * 0.5 + u.outputTokens * pout);
}

export function recordUsage(
  db: Db,
  row: {
    documentId: number | null;
    purpose: "extract" | "repair";
    mode: "text" | "vision";
    model: string;
    usage: Usage;
    ok: boolean;
    error?: string | null;
    at: Date;
  }
): void {
  try {
    db.prepare(
      `INSERT INTO ai_usage (created_at, document_id, purpose, mode, model, input_tokens, output_tokens, cached_tokens,
                             cost_micro_usd, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.at.toISOString(), row.documentId, row.purpose, row.mode, row.model, row.usage.inputTokens, row.usage.outputTokens,
      row.usage.cachedTokens, estimateCostMicroUsd(row.model, row.usage), row.ok ? 1 : 0, row.error?.slice(0, 300) ?? null
    );
  } catch {
    /* Protokoll darf die Analyse nie scheitern lassen (z. B. Tabelle fehlt in einer alten Datenbank) */
  }
}

/** Summe je Dokument (für Anzeige und Auswertung). */
export function usageOfDocument(db: Db, documentId: number): { calls: number; inputTokens: number; outputTokens: number; costMicroUsd: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o,
              COALESCE(SUM(cost_micro_usd), 0) AS c FROM ai_usage WHERE document_id = ?`
    )
    .get(documentId) as { calls: number; i: number; o: number; c: number };
  return { calls: r.calls, inputTokens: r.i, outputTokens: r.o, costMicroUsd: r.c };
}
