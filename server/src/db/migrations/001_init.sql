-- TravelBuddy 001: konsolidiertes Schema (frisch, nur vorwärts).
-- Alle Geldbeträge sind INTEGER in Minor Units (Rappen/Cent). Zeitstempel: UTC ISO 8601. Daten: YYYY-MM-DD.
-- Zeiten: HH:mm (Ortszeit der jeweiligen Zone, siehe start_tz/end_tz bzw. trips.timezone).

/* ───────────── Benutzer und Geräte ───────────── */

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

-- Ein Token pro Gerät/Client («Gerät» = Sitzung). Im Klartext existiert es nur beim Client (Keychain).
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT,
  platform TEXT,                          -- ios | ipados | macos | visionos | web
  apns_token TEXT,
  apns_environment TEXT CHECK (apns_environment IN ('development', 'production')),
  push_to_start_token TEXT,               -- Live Activity: Push-to-Start
  app_version TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

/* ───────────── Reisen ───────────── */

CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'done', 'cancelled')),
  destination TEXT,
  start_date TEXT,
  end_date TEXT,
  summary TEXT,
  notes TEXT,
  home_currency TEXT NOT NULL DEFAULT 'CHF',
  timezone TEXT NOT NULL DEFAULT 'Europe/Zurich',   -- IANA, Vorgabe für Ereignisse ohne start_tz/end_tz
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trips_start ON trips(start_date);

/* ───────────── Reisekasse (1:1 zur Reise; Altdaten dürfen ohne Reise stehen) ───────────── */

CREATE TABLE ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'CHF',
  trip_id INTEGER UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE ledger_couples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ledger_couples_ledger ON ledger_couples(ledger_id);

/* ───────────── Teilnehmer: eine Tabelle, zwei Sichten ─────────────
   Dieselbe ID erscheint als `travelers[]` der Reise und als `members[]` der Reisekasse.
   Gäste ohne Konto nutzen `share_token` (Pfade /t/<token> für die Reise, /g/<token> für die Reisekasse). */

CREATE TABLE participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
  ledger_id INTEGER REFERENCES ledgers(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  couple_id INTEGER REFERENCES ledger_couples(id) ON DELETE SET NULL,
  color_index INTEGER NOT NULL DEFAULT 0 CHECK (color_index BETWEEN 0 AND 7),
  sort_key INTEGER NOT NULL DEFAULT 0,
  share_token TEXT NOT NULL UNIQUE,
  share_revoked_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (trip_id IS NOT NULL OR ledger_id IS NOT NULL)
);
CREATE INDEX idx_participants_trip ON participants(trip_id);
CREATE INDEX idx_participants_ledger ON participants(ledger_id);
CREATE INDEX idx_participants_user ON participants(user_id);

/* ───────────── Dokumente (eigene Ablage, ersetzt Paperless) ───────────── */

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  pages INTEGER,
  text TEXT,
  text_source TEXT,                       -- pdf_text | ocr | vision | …  (setzt die Analyse)
  analysis_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  analysis_attempts INTEGER NOT NULL DEFAULT 0,
  analysis_next_retry_at TEXT,
  analysis_error TEXT,
  analysis_json TEXT,
  analysis_model TEXT,
  analyzed_at TEXT,
  summary TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'share', 'mail')),
  source_meta TEXT NOT NULL DEFAULT '{}',
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_status ON documents(analysis_status, analysis_next_retry_at);

-- Dokument an eine Reise gehängt (auch ohne Ereignis).
CREATE TABLE trip_documents (
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, document_id)
);
CREATE INDEX idx_trip_documents_doc ON trip_documents(document_id);

/* ───────────── Ereignisse ───────────── */

CREATE TABLE trip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,               -- id aus shared/event-types.json
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  start_tz TEXT,                          -- IANA; NULL = Zone der Reise
  end_tz TEXT,
  location TEXT,
  address TEXT,
  provider TEXT,
  booking_reference TEXT,
  website TEXT,
  phone TEXT,
  lat REAL,
  lon REAL,
  place_coords TEXT NOT NULL DEFAULT '{}', -- JSON: Koordinaten weiterer Orte je Rolle (pickup, return, end, …)
  notes TEXT,
  details TEXT NOT NULL DEFAULT '{}',     -- typspezifisch, Schlüssel aus dem Katalog
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'proposed', 'needs_review')),
  price_minor INTEGER,
  currency TEXT,
  payment_status TEXT CHECK (payment_status IN ('open', 'paid', 'deposit', 'onsite')),
  paid_by_participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  cancel_until TEXT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,  -- verknüpfte Ausgabe der Reisekasse
  fields_meta TEXT NOT NULL DEFAULT '{}', -- JSON: je Feldname { source, confidence?, documentId?, page?, quote?, locked? }
  source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trip_events_trip ON trip_events(trip_id, start_date, start_time, sort_key);
CREATE INDEX idx_trip_events_status ON trip_events(status);

-- Wer ist dabei? Keine Zeile = alle Teilnehmer der Reise.
CREATE TABLE event_participants (
  event_id INTEGER NOT NULL REFERENCES trip_events(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, participant_id)
);

CREATE TABLE trip_event_documents (
  trip_event_id INTEGER NOT NULL REFERENCES trip_events(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (trip_event_id, document_id)
);
CREATE INDEX idx_trip_event_documents_doc ON trip_event_documents(document_id);

CREATE TABLE trip_event_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_event_id INTEGER NOT NULL REFERENCES trip_events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trip_event_comments_event ON trip_event_comments(trip_event_id);

/* ───────────── Ausgaben, Aufteilungen, Rückzahlungen ───────────── */

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  paid_by_participant_id INTEGER NOT NULL REFERENCES participants(id),
  created_by_participant_id INTEGER REFERENCES participants(id),
  direction TEXT NOT NULL DEFAULT 'expense' CHECK (direction IN ('expense', 'income')),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1,      -- Einheiten Basiswährung pro 1 Einheit currency
  amount_base_minor INTEGER NOT NULL,
  description TEXT,
  expense_date TEXT,
  category_label TEXT,
  note TEXT,
  split_mode TEXT NOT NULL DEFAULT 'equal'
    CHECK (split_mode IN ('equal', 'coupleEqual', 'exact', 'shares')),
  -- 0 offen, 1 nacherfasst/ausgeglichen, 2 manuell als Paar ausgeglichen
  settled_status INTEGER NOT NULL DEFAULT 0 CHECK (settled_status IN (0, 1, 2)),
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  trip_event_id INTEGER REFERENCES trip_events(id) ON DELETE SET NULL,
  place_name TEXT,
  place_lat REAL,
  place_lon REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_ledger ON expenses(ledger_id, expense_date);
CREATE INDEX idx_expenses_event ON expenses(trip_event_id);

CREATE TABLE expense_splits (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  share_base_minor INTEGER NOT NULL,
  share_units REAL,
  PRIMARY KEY (expense_id, participant_id)
);

-- Rückzahlung: from_participant hat to_participant Geld gegeben.
CREATE TABLE settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  from_participant_id INTEGER NOT NULL REFERENCES participants(id),
  to_participant_id INTEGER NOT NULL REFERENCES participants(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1,
  amount_base_minor INTEGER NOT NULL CHECK (amount_base_minor > 0),
  note TEXT,
  settled_at TEXT NOT NULL,
  created_by_participant_id INTEGER REFERENCES participants(id),
  related_expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (from_participant_id != to_participant_id)
);
CREATE INDEX idx_settlements_ledger ON settlements(ledger_id);
CREATE INDEX idx_settlements_expense ON settlements(related_expense_id);

/* ───────────── Medien (Reisebild, Ereignisbild) ───────────── */

CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('trip_cover', 'event_image')),
  owner_id INTEGER NOT NULL,
  file_name TEXT,                              -- nur [A-Za-z0-9._-], nie aus Nutzereingaben
  content_type TEXT,
  bytes INTEGER,
  sha256 TEXT,
  prompt TEXT,
  source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('imported', 'generated', 'uploaded')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, owner_id)
);
CREATE INDEX idx_media_retry ON media(next_retry_at) WHERE file_name IS NULL;

CREATE TABLE media_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  queued_at TEXT NOT NULL
);

CREATE TRIGGER media_after_delete AFTER DELETE ON media
WHEN OLD.file_name IS NOT NULL
BEGIN
  INSERT INTO media_trash (kind, file_name, queued_at) VALUES (OLD.kind, OLD.file_name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER media_after_replace AFTER UPDATE OF file_name ON media
WHEN OLD.file_name IS NOT NULL AND NEW.file_name IS NOT OLD.file_name
BEGIN
  INSERT INTO media_trash (kind, file_name, queued_at) VALUES (OLD.kind, OLD.file_name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER media_owner_trip AFTER DELETE ON trips
BEGIN
  DELETE FROM media WHERE kind = 'trip_cover' AND owner_id = OLD.id;
END;

CREATE TRIGGER media_owner_event AFTER DELETE ON trip_events
BEGIN
  DELETE FROM media WHERE kind = 'event_image' AND owner_id = OLD.id;
END;

/* ───────────── Push, Live Activities, Einstellungen ───────────── */

-- Je Benutzer ein JSON-Dokument (Arten und Vorlaufzeiten); fehlende Schlüssel gelten als Standard.
CREATE TABLE notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Entdoppelung: Eine Meldung wird pro Benutzer nur einmal zugestellt.
CREATE TABLE notification_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, dedupe_key)
);
CREATE INDEX idx_notification_log_user ON notification_log(user_id, created_at);

-- Live Activities, die ein Gerät registriert hat (Versand ist Sache des Mitteilungs-Schedulers).
CREATE TABLE live_activities (
  activity_id TEXT PRIMARY KEY,
  token_id INTEGER NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('day', 'flight', 'checkin')),
  event_id INTEGER REFERENCES trip_events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_live_activities_trip ON live_activities(trip_id);

/* ───────────── Sonstiges ───────────── */

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

-- Geokodierung: Treffer und Fehlschläge je normalisierter Suchbegriff (schont das Limit von 1 Anfrage/s).
CREATE TABLE geocode_cache (
  query_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  found INTEGER NOT NULL CHECK (found IN (0, 1)),
  lat REAL,
  lon REAL,
  label TEXT,
  confidence REAL,
  created_at TEXT NOT NULL
);
