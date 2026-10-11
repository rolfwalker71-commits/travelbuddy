/**
 * Synthetische Mini-HomeBuddy-Datenbank für die Import-Tests (keine echten Daten).
 *
 * Erwartete Salden der Kasse «Italien» (Basis CHF), von Hand gerechnet:
 *   Ausgaben: Anna zahlt 90.00 (gleich auf 3 → 30.00), Ben zahlt 60.00 EUR zu 0.95 = 57.00 (gleich → 19.00),
 *   Dora zahlt 30.00 (exakt: Anna 10.00, Ben 20.00). Rückzahlung Dora → Anna 10.00.
 *   Anna +21.00, Ben −12.00, Dora −9.00 (Summe 0).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "../src/auth/auth";
import { tinyPdf } from "./helpers";

export const PASSWORDS = { anna: "anna-pw-123456", ben: "ben-pw-1234567" };

export const EXPECTED_NET = { Anna: 2100, Ben: -1200, Dora: -900 } as const;

export const TOKENS = {
  trip: { Anna: "trav-token-anna-0001", Ben: "trav-token-ben-00002", Dora: "trav-token-dora-0003" },
  invite: { Anna: "invite-token-anna-001", Ben: "invite-token-ben-0002", Dora: "invite-token-dora-003" },
  cashTrip: { Anna: "trav-cash-anna-000001", Ben: "trav-cash-ben-0000002" },
};

const DDL = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
  email TEXT, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE api_tokens (id INTEGER PRIMARY KEY, user_id INTEGER, token_hash TEXT);
CREATE TABLE trips (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', destination TEXT,
  start_date TEXT, end_date TEXT, summary TEXT, notes TEXT, created_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE trip_events (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL,
  start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT, location TEXT, address TEXT, provider TEXT, booking_reference TEXT,
  website TEXT, phone TEXT, lat REAL, lon REAL, notes TEXT, details TEXT NOT NULL DEFAULT '{}', sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE trip_travelers (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, display_name TEXT NOT NULL, email TEXT,
  user_id INTEGER, sort_key INTEGER NOT NULL DEFAULT 0, share_token TEXT NOT NULL UNIQUE, share_revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE trip_event_documents (trip_event_id INTEGER NOT NULL, document_id INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (trip_event_id, document_id));
CREATE TABLE trip_event_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_event_id INTEGER NOT NULL, user_id INTEGER,
  author_name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, base_currency TEXT NOT NULL DEFAULT 'CHF',
  kind TEXT NOT NULL DEFAULT 'split', trip_id INTEGER, created_by_user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE ledger_members (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, display_name TEXT NOT NULL, email TEXT,
  user_id INTEGER, couple_id INTEGER, invite_token TEXT NOT NULL UNIQUE, invite_revoked_at TEXT, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE ledger_couples (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, paid_by_member_id INTEGER NOT NULL,
  created_by_member_id INTEGER, direction TEXT NOT NULL DEFAULT 'expense', amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1, amount_base_minor INTEGER NOT NULL, description TEXT, expense_date TEXT, category_label TEXT,
  note TEXT, split_mode TEXT NOT NULL DEFAULT 'equal', settled_status INTEGER NOT NULL DEFAULT 0, document_id INTEGER, trip_event_id INTEGER,
  place_name TEXT, place_lat REAL, place_lon REAL, receipt_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE expense_splits (expense_id INTEGER NOT NULL, member_id INTEGER NOT NULL, share_base_minor INTEGER NOT NULL, share_units REAL,
  PRIMARY KEY (expense_id, member_id));
CREATE TABLE settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, from_member_id INTEGER NOT NULL,
  to_member_id INTEGER NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, exchange_rate REAL NOT NULL DEFAULT 1,
  amount_base_minor INTEGER NOT NULL, note TEXT, settled_at TEXT NOT NULL, created_by_member_id INTEGER, related_expense_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, paperless_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
  content TEXT, created_date TEXT, added_at TEXT, original_file_name TEXT, analysis_status TEXT NOT NULL DEFAULT 'pending',
  analysis_json TEXT, analysis_model TEXT, analyzed_at TEXT, category TEXT, summary TEXT, suggested_title TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const MEDIA_DDL = `
CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, owner_id INTEGER NOT NULL, file_name TEXT, content_type TEXT,
  bytes INTEGER, sha256 TEXT, prompt TEXT, source TEXT NOT NULL DEFAULT 'generated', error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (kind, owner_id));
`;

const TS = "2026-07-01T10:00:00.000Z";
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);

export type Fixture = {
  dir: string;
  sqlite: string;
  documents: string;
  media: string;
  summaryFile: string;
  /** Quell-IDs, damit Tests gezielt zugreifen können. */
  ids: { tripItaly: number; tripCash: number; ledgerSplit: number; ledgerCash: number; eventFlight: number; eventTrain: number; eventCash: number };
  sha: { docA: string; docB: string; docC: string };
  cleanup: () => void;
};

export async function buildFixture(
  o: { withMedia?: boolean; withSummary?: boolean; summaryBalanceOff?: boolean; withDocuments?: boolean } = {}
): Promise<Fixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-import-"));
  const sqlite = path.join(dir, "homebuddy.sqlite");
  const documents = path.join(dir, "documents");
  const media = path.join(dir, "media");
  const db = new Database(sqlite);
  db.exec(DDL);
  if (o.withMedia) db.exec(MEDIA_DDL);
  const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);

  const annaHash = await hashPassword(PASSWORDS.anna);
  const benHash = await hashPassword(PASSWORDS.ben);
  run("INSERT INTO users (id, username, display_name, email, password_hash, is_admin, active, created_at) VALUES (5, 'anna', 'Anna', 'anna@example.org', ?, 1, 1, ?)", annaHash, TS);
  run("INSERT INTO users (id, username, display_name, email, password_hash, is_admin, active, created_at) VALUES (6, 'ben', 'Ben', NULL, ?, 0, 1, ?)", benHash, TS);
  run("INSERT INTO users (id, username, display_name, email, password_hash, is_admin, active, created_at) VALUES (7, 'cleo', 'Cleo', NULL, ?, 0, 0, ?)", "scrypt:x:y", TS);
  run("INSERT INTO api_tokens (id, user_id, token_hash) VALUES (1, 5, 'geheim')");

  // Reise 3 «Italien» mit geteilter Reisekasse 7
  run("INSERT INTO trips (id, title, status, destination, start_date, end_date, created_by_user_id, created_at, updated_at) VALUES (3, 'Italien', 'planned', 'Toskana', '2026-10-23', '2026-11-20', 5, ?, ?)", TS, TS);
  const tr = (id: number, trip: number, name: string, user: number | null, sort: number, token: string) =>
    run("INSERT INTO trip_travelers (id, trip_id, display_name, user_id, sort_key, share_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, trip, name, user, sort, token, TS);
  tr(1, 3, "Anna", 5, 0, TOKENS.trip.Anna);
  tr(2, 3, "Ben", 6, 1, TOKENS.trip.Ben);
  tr(3, 3, "Dora", null, 2, TOKENS.trip.Dora);
  run("INSERT INTO ledgers (id, title, base_currency, kind, trip_id, created_by_user_id, created_at, updated_at) VALUES (7, 'Italien (Kasse)', 'CHF', 'split', 3, 5, ?, ?)", TS, TS);
  run("INSERT INTO ledger_couples (id, ledger_id, name, created_at) VALUES (4, 7, 'Anna & Ben', ?)", TS);
  const mem = (id: number, ledger: number, name: string, user: number | null, couple: number | null, token: string, hidden = 0) =>
    run("INSERT INTO ledger_members (id, ledger_id, display_name, user_id, couple_id, invite_token, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, ledger, name, user, couple, token, hidden, TS);
  mem(20, 7, "Anna", 5, 4, TOKENS.invite.Anna);
  mem(21, 7, "Ben", 6, 4, TOKENS.invite.Ben);
  mem(22, 7, "dora", null, null, TOKENS.invite.Dora); // Abgleich über den Namen (Schreibweise egal)

  const exp = (id: number, payer: number, amount: number, cur: string, rate: number, base: number, desc: string, mode: string, event: number | null) =>
    run(
      `INSERT INTO expenses (id, ledger_id, paid_by_member_id, amount_minor, currency, exchange_rate, amount_base_minor, description,
                             expense_date, split_mode, trip_event_id, created_at, updated_at)
       VALUES (?, 7, ?, ?, ?, ?, ?, ?, '2026-10-24', ?, ?, ?, ?)`,
      id, payer, amount, cur, rate, base, desc, mode, event, TS, TS
    );
  const split = (e: number, m: number, share: number) =>
    run("INSERT INTO expense_splits (expense_id, member_id, share_base_minor) VALUES (?, ?, ?)", e, m, share);
  exp(40, 20, 9000, "CHF", 1, 9000, "Mietwagen", "equal", 100);
  split(40, 20, 3000); split(40, 21, 3000); split(40, 22, 3000);
  exp(41, 21, 6000, "EUR", 0.95, 5700, "Abendessen", "equal", null);
  split(41, 20, 1900); split(41, 21, 1900); split(41, 22, 1900);
  exp(42, 22, 3000, "CHF", 1, 3000, "Eintritte", "exact", null);
  split(42, 20, 1000); split(42, 21, 2000);
  run(
    `INSERT INTO settlements (id, ledger_id, from_member_id, to_member_id, amount_minor, currency, exchange_rate, amount_base_minor,
                              note, settled_at, related_expense_id, created_at)
     VALUES (9, 7, 22, 20, 1000, 'CHF', 1, 1000, 'Bar bezahlt', '2026-10-30', NULL, ?)`, TS
  );

  // Reise 4 «Wochenende» mit Kassabuch 8 (verstecktes Solo-Mitglied «Konto», Reisende sind keine Mitglieder)
  run("INSERT INTO trips (id, title, status, start_date, end_date, created_by_user_id, created_at, updated_at) VALUES (4, 'Wochenende', 'done', '2026-08-15', '2026-08-16', 5, ?, ?)", TS, TS);
  tr(4, 4, "Anna", null, 0, TOKENS.cashTrip.Anna);
  tr(5, 4, "Ben", null, 1, TOKENS.cashTrip.Ben);
  run("INSERT INTO ledgers (id, title, base_currency, kind, trip_id, created_at, updated_at) VALUES (8, 'Wochenende (Kassabuch)', 'CHF', 'cashbook', 4, ?, ?)", TS, TS);
  mem(30, 8, "Konto", null, null, "invite-solo-konto-00001", 1);
  const cash = (id: number, amount: number, base: number, event: number | null) => {
    run(
      `INSERT INTO expenses (id, ledger_id, paid_by_member_id, amount_minor, currency, exchange_rate, amount_base_minor, description,
                             expense_date, split_mode, trip_event_id, created_at, updated_at)
       VALUES (?, 8, 30, ?, 'EUR', 0.9, ?, 'Kasse', '2026-08-15', 'equal', ?, ?, ?)`, id, amount, base, event, TS, TS
    );
    split(id, 30, base);
  };
  cash(50, 1000, 900, 200);
  cash(51, 2000, 1800, null);

  // Ereignisse der Reise 3
  const ev = (id: number, trip: number, type: string, title: string, sort: number, f: Record<string, unknown>) => {
    const row = { start_date: null, end_date: null, start_time: null, end_time: null, location: null, lat: null, lon: null, details: "{}", ...f };
    run(
      `INSERT INTO trip_events (id, trip_id, event_type, title, start_date, end_date, start_time, end_time, location, lat, lon, details,
                                sort_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, trip, type, title, row.start_date, row.end_date, row.start_time, row.end_time, row.location, row.lat, row.lon,
      typeof row.details === "string" ? row.details : JSON.stringify(row.details), sort, TS, TS
    );
  };
  ev(100, 3, "Flug", "Flug nach Barcelona", 0, {
    start_date: "2026-10-23", end_date: "2026-10-23", start_time: "12:20", end_time: "14:05", location: "ZRH → BCN",
    details: { flightNumber: "lx 1954", departureAirport: "ZRH", arrivalAirport: "BCN", cabinClass: "business", seatMap: "x", gateNote: "A1" },
  });
  ev(101, 3, "Hotel", "Hotel Meer", 1, {
    start_date: "2026-10-23", end_date: "2026-10-25", start_time: "15:00", end_time: "12:00", lat: 41.39, lon: 2.17,
    details: { board: "Frühstück", roomType: 5, checkInFrom: "9:30" },
  });
  ev(102, 3, "Kreuzfahrt", "Transatlantik", 2, {
    start_date: "2026-10-25", end_date: "2026-11-07", start_time: "17:00", end_time: "05:00", lat: 41.35, lon: 2.17, details: { ship: "Legend" },
  });
  ev(103, 3, "Kreuzfahrt", "Seetag", 3, { start_date: "2026-10-29", end_date: "2026-10-29" });
  ev(104, 3, "Kreuzfahrt", "Ankunft Port Canaveral", 4, {
    start_date: "2026-11-07", end_date: "2026-11-07", start_time: "05:00", lat: 28.41, lon: -80.62,
  });
  ev(105, 3, "Mietwagen", "Mietwagen Miami", 5, {
    start_date: "2026-11-15", end_date: "2026-11-19", details: { originPlace: "Miami Airport", destinationPlace: "Miami Airport" },
  });
  ev(106, 3, "Quatsch", "Unbekannter Typ", 6, { start_date: "2026-11-16" });
  ev(107, 3, "Flug", "Flug ins Ungewisse", 7, {
    start_date: "2026-11-19", end_date: "2026-11-19", start_time: "10:00", end_time: "12:00", location: "XXX → QQQ",
  });
  ev(108, 3, "Zugreisen", "Anreise", 8, {
    start_date: "2026-10-23", end_date: "2026-10-23", start_time: "08:39", end_time: "10:11",
    location: "Altdorf UR → Zürich Flughafen", details: { originPlace: "Altdorf UR", destinationPlace: "Zürich Flughafen", durationMinutes: "92" },
  });
  ev(200, 4, "Zugreisen", "Zugfahrt Budapest-Keleti nach Zürich HB", 0, {
    start_date: "2026-08-15", end_date: "2026-08-16", start_time: "20:30", end_time: "10:36", location: "Budapest-Keleti → Zürich HB",
  });

  run("INSERT INTO trip_event_comments (id, trip_event_id, user_id, author_name, body, created_at, updated_at) VALUES (1, 100, 5, 'Anna', 'Check-in online erledigt', ?, ?)", TS, TS);

  // Dokumente: A (an Flug und Hotel), B (an Flug), C (ohne Verknüpfung, nur im Manifest)
  const docs = [
    { id: 300, paperless: 7001, extra: "A", title: "Bestätigung Flug", linked: [100, 101] },
    { id: 301, paperless: 7002, extra: "B", title: "Hotel Gutschein", linked: [100] },
    { id: 302, paperless: 7003, extra: "C", title: "Reiseführer", linked: [] as number[] },
  ];
  const sha: Record<string, string> = {};
  if (o.withDocuments !== false) fs.mkdirSync(documents, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];
  for (const d of docs) {
    const bytes = tinyPdf(`dokument-${d.extra}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    sha[d.extra] = hash;
    run(
      `INSERT INTO documents (id, paperless_id, title, content, added_at, original_file_name, analysis_status, analysis_json, analysis_model,
                              analyzed_at, summary, suggested_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-07-02T08:00:00.000Z', ?, 'done', ?, 'gpt-4o-mini', '2026-07-03T09:00:00.000Z', ?, ?, ?, ?)`,
      d.id, d.paperless, `Titel ${d.extra}`, `OCR-Text ${d.extra}`, `original-${d.extra}.pdf`,
      JSON.stringify({ category: "Reisen", travel_items: [{ title: d.title }] }), `Zusammenfassung ${d.extra}`,
      d.extra === "A" ? d.title : null, TS, TS
    );
    for (const e of d.linked) run("INSERT INTO trip_event_documents (trip_event_id, document_id, created_at) VALUES (?, ?, ?)", e, d.id, TS);
    if (o.withDocuments !== false) {
      fs.writeFileSync(path.join(documents, `paperless-${d.paperless}.pdf`), bytes);
      manifest.push({
        paperlessId: d.paperless, homebuddyDocumentId: d.id, title: d.title, fileName: `paperless-${d.paperless}.pdf`,
        sha256: hash, linkedEventIds: d.linked, originalFileName: `original-${d.extra}.pdf`,
      });
    }
  }
  if (o.withDocuments !== false) fs.writeFileSync(path.join(documents, "manifest.json"), JSON.stringify({ files: manifest }));

  if (o.withMedia) {
    run("INSERT INTO media (kind, owner_id, file_name, content_type, source, prompt, created_at, updated_at) VALUES ('trip_cover', 3, 'cover.png', 'image/png', 'generated', 'Berge', ?, ?)", TS, TS);
    run("INSERT INTO media (kind, owner_id, file_name, content_type, source, created_at, updated_at) VALUES ('event_image', 100, 'fehlt.png', 'image/png', 'generated', ?, ?)", TS, TS);
    run("INSERT INTO media (kind, owner_id, file_name, content_type, source, created_at, updated_at) VALUES ('ledger_cover', 7, 'kasse.png', 'image/png', 'generated', ?, ?)", TS, TS);
    fs.mkdirSync(path.join(media, "trip_cover"), { recursive: true });
    fs.writeFileSync(path.join(media, "trip_cover", "cover.png"), PNG);
  }
  db.close();

  const summaryFile = path.join(dir, "summary.json");
  if (o.withSummary) {
    const off = o.summaryBalanceOff ? 5 : 0;
    fs.writeFileSync(
      summaryFile,
      JSON.stringify({
        counts: { trips: 2, tripEvents: 10, travelers: 5, comments: 1, eventDocumentLinks: 3 },
        ledgers: [
          {
            ledgerId: 7, expenses: 3, settlements: 1,
            sumByCurrencyMinor: {
              CHF: { expenseCount: 2, expenseAmountMinor: 12000, expenseBaseMinor: 12000 },
              EUR: { expenseCount: 1, expenseAmountMinor: 6000, expenseBaseMinor: 5700 },
            },
            balances: [
              { displayName: "Anna", netMinor: EXPECTED_NET.Anna + off },
              { displayName: "Ben", netMinor: EXPECTED_NET.Ben },
              { displayName: "Dora", netMinor: EXPECTED_NET.Dora },
            ],
          },
          {
            ledgerId: 8, expenses: 2, settlements: 0,
            sumByCurrencyMinor: { EUR: { expenseCount: 2, expenseAmountMinor: 3000, expenseBaseMinor: 2700 } },
            soloTotals: [{ displayName: "Konto", paidMinor: 2700, owedMinor: 2700, netMinor: 0 }],
          },
        ],
      })
    );
  }

  return {
    dir, sqlite, documents, media, summaryFile,
    ids: { tripItaly: 3, tripCash: 4, ledgerSplit: 7, ledgerCash: 8, eventFlight: 100, eventTrain: 108, eventCash: 200 },
    sha: { docA: sha.A!, docB: sha.B!, docC: sha.C! },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

export function fileHash(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
