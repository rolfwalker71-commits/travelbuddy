-- TravelBuddy 020: Import aus HomeBuddy (additiv).
-- `import_map` hält fest, welche Zeile der Quelle zu welcher Zeile des Ziels wurde. Damit ist der Import
-- wiederholbar (Aktualisieren statt Verdoppeln) und die Zuordnung nachvollziehbar.

CREATE TABLE import_map (
  source TEXT NOT NULL,              -- Name der Quelle, z. B. 'homebuddy'
  source_table TEXT NOT NULL,        -- Tabelle in der Quelle (users, trips, trip_events, trip_travelers, ledger_members, …)
  source_id INTEGER NOT NULL,        -- ID in der Quelle
  target_table TEXT NOT NULL,        -- Tabelle im Ziel (users, trips, trip_events, participants, ledgers, …)
  target_id INTEGER NOT NULL,        -- ID im Ziel
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, source_table, source_id)
);
CREATE INDEX idx_import_map_target ON import_map(source, target_table, target_id);

-- Zweiter Link-Token einer Person. HomeBuddy kennt je Person zwei Tokens (Reise `/t/…`, Abrechnung `/g/…`);
-- TravelBuddy hat einen (`participants.share_token`). Der zweite bleibt hier gültig, solange der Haupt-Token
-- unverändert ist: Erneuern oder Widerrufen des Links macht auch den Alias unbrauchbar.
CREATE TABLE participant_token_aliases (
  alias_token TEXT PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  primary_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_participant_token_aliases_participant ON participant_token_aliases(participant_id);
