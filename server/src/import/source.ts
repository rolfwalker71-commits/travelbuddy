/**
 * Quelle des Imports: eine HomeBuddy-SQLite (Schnappschuss). Sie wird **nie** geöffnet, sondern zuerst in einen
 * temporären Ordner kopiert (samt `-wal`, falls vorhanden) und dort nur lesend verwendet. So kann der Import weder
 * in die Quelle schreiben noch Nebendateien neben ihr anlegen.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Row = Record<string, any>;

export type SourceData = {
  users: Row[];
  trips: Row[];
  trip_events: Row[];
  trip_travelers: Row[];
  trip_event_comments: Row[];
  trip_event_documents: Row[];
  ledgers: Row[];
  ledger_members: Row[];
  ledger_couples: Row[];
  expenses: Row[];
  expense_splits: Row[];
  settlements: Row[];
  media: Row[];
  /** Hat die Quelle eine Medien-Tabelle (ältere Schnappschüsse nicht)? */
  hasMediaTable: boolean;
};

export type OpenedSource = {
  data: SourceData;
  /** Dokumentzeilen (mit OCR-Text und Analyse) zu HomeBuddy-IDs; fehlende IDs fehlen im Ergebnis. */
  documentsByIds: (ids: number[]) => Row[];
  /** Dokumentzeilen zu Paperless-IDs. */
  documentsByPaperlessIds: (ids: number[]) => Row[];
  close: () => void;
};

const SIDE_FILES = ["-wal", "-shm"];

export function openSource(file: string): OpenedSource {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`Quelle nicht gefunden: ${abs}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travelbuddy-import-"));
  const copy = path.join(dir, "source.sqlite");
  fs.copyFileSync(abs, copy);
  for (const s of SIDE_FILES) {
    if (fs.existsSync(abs + s)) fs.copyFileSync(abs + s, copy + s);
  }
  const db = new Database(copy, { readonly: true, fileMustExist: true });
  const cleanup = () => {
    try {
      db.close();
    } catch {
      /* schon zu */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const has = (t: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
    const all = (t: string, order = "id"): Row[] => {
      if (!has(t)) return [];
      const cols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
      return db.prepare(`SELECT * FROM ${t}${cols.has(order) ? ` ORDER BY ${order}` : ""}`).all() as Row[];
    };
    if (!has("trips") && !has("ledgers") && !has("users")) {
      throw new Error("Die Datei ist keine HomeBuddy-Datenbank (Tabellen trips, ledgers, users fehlen).");
    }
    const data: SourceData = {
      users: all("users"),
      trips: all("trips"),
      trip_events: all("trip_events", "sort_key"),
      trip_travelers: all("trip_travelers", "sort_key"),
      trip_event_comments: all("trip_event_comments"),
      trip_event_documents: has("trip_event_documents")
        ? (db.prepare("SELECT * FROM trip_event_documents ORDER BY trip_event_id, document_id").all() as Row[])
        : [],
      ledgers: all("ledgers"),
      ledger_members: all("ledger_members"),
      ledger_couples: all("ledger_couples"),
      expenses: all("expenses"),
      expense_splits: has("expense_splits") ? (db.prepare("SELECT * FROM expense_splits ORDER BY expense_id, member_id").all() as Row[]) : [],
      settlements: all("settlements"),
      media: all("media"),
      hasMediaTable: has("media"),
    };
    // Reihenfolge je Reise/Ereignis stabil: sort_key, dann id
    data.trip_events.sort((a, b) => (a.sort_key ?? 0) - (b.sort_key ?? 0) || a.id - b.id);
    data.trip_travelers.sort((a, b) => (a.sort_key ?? 0) - (b.sort_key ?? 0) || a.id - b.id);
    const pick = (column: string, ids: number[]): Row[] => {
      if (!has("documents") || !ids.length) return [];
      const cols = new Set((db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>).map((c) => c.name));
      if (!cols.has(column)) return [];
      const out: Row[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        out.push(...(db.prepare(`SELECT * FROM documents WHERE ${column} IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as Row[]));
      }
      return out;
    };
    return {
      data,
      documentsByIds: (ids) => pick("id", ids),
      documentsByPaperlessIds: (ids) => pick("paperless_id", ids),
      close: cleanup,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}
