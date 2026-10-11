-- TravelBuddy 002: Gedächtnis des Geokodierungs-Nachtrags (damit «nicht gefunden» und Fehler nicht endlos
-- wiederholt werden). Je Ereignis und Ort (Rolle) ein Eintrag; ändert sich der Suchbegriff, wird neu versucht.
CREATE TABLE geocode_backfill (
  event_id INTEGER NOT NULL REFERENCES trip_events(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('resolved', 'not_found', 'failed')),
  query TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL,
  next_retry_at TEXT,              -- NULL = endgültig (bis sich der Suchbegriff ändert)
  PRIMARY KEY (event_id, role)
);
