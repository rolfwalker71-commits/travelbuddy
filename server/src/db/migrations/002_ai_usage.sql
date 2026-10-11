-- Protokoll der KI-Aufrufe der Dokumentanalyse (Tokens und geschätzte Kosten je Dokument).
-- Nur additiv; `document_id` wird beim Löschen des Dokuments geleert, die Zeile bleibt für die Kostenübersicht.
CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,                 -- UTC ISO 8601
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,                    -- extract | repair
  mode TEXT NOT NULL DEFAULT 'text',        -- text | vision
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER,                   -- geschätzt (Preistabelle im Code); NULL = Modell unbekannt
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE INDEX idx_ai_usage_document ON ai_usage(document_id);
CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);
