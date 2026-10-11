import test from "node:test";
import assert from "node:assert/strict";
import { migrate, openDb } from "../src/db/client";

test("schema: eine konsolidierte Migration, idempotent, Fremdschlüssel in Ordnung", () => {
  const db = openDb(":memory:");
  // 001 ist das konsolidierte Schema; weitere Migrationen (z. B. 020_import_map) sind additiv und kommen danach.
  const applied = migrate(db);
  assert.equal(applied[0], "001_init.sql");
  assert.deepEqual([...applied].sort(), applied);
  assert.deepEqual(migrate(db), []);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((r) => r.name)
    .sort();
  for (const t of [
    "users", "api_tokens", "trips", "participants", "trip_events", "event_participants", "documents",
    "trip_event_documents", "trip_documents", "trip_event_comments", "ledgers", "ledger_couples", "expenses",
    "expense_splits", "settlements", "media", "live_activities", "notification_log", "notification_prefs", "kv",
  ]) {
    assert.ok(tables.includes(t), `Tabelle ${t} fehlt`);
  }
  // Nichts aus HomeBuddy, das hier entfällt
  for (const gone of ["invoices", "ledger_members", "trip_travelers", "credit_card_exclusions", "maintenance_runs"]) {
    assert.ok(!tables.includes(gone), `Tabelle ${gone} darf nicht existieren`);
  }
  const cols = (db.prepare("PRAGMA table_info(trip_events)").all() as { name: string }[]).map((c) => c.name);
  for (const c of ["start_tz", "end_tz", "status", "price_minor", "currency", "payment_status", "paid_by_participant_id", "cancel_until", "expense_id", "fields_meta", "source_document_id"]) {
    assert.ok(cols.includes(c), `Spalte trip_events.${c} fehlt`);
  }
  const doc = (db.prepare("PRAGMA table_info(documents)").all() as { name: string }[]).map((c) => c.name);
  for (const c of ["sha256", "pages", "text", "text_source", "analysis_status", "analysis_attempts", "analysis_next_retry_at", "analysis_error", "analysis_json", "analysis_model", "analyzed_at", "summary", "source", "source_meta"]) {
    assert.ok(doc.includes(c), `Spalte documents.${c} fehlt`);
  }
});
