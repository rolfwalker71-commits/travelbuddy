import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { migrate, openDb, type Db } from "../src/db/client";
import { importHomeBuddy, type ImportOptions } from "../src/import/homebuddy";
import { renderReportText } from "../src/import/report";
import { deriveZones, zoneFromPlaceName, type ZoneEventInput } from "../src/import/zones";
import { participantBalances } from "../src/ledgers/service";
import { buildFixture, EXPECTED_NET, fileHash, PASSWORDS, TOKENS, type Fixture } from "./import-fixture";

type Target = { db: Db; documentsDir: string; mediaDir: string; dir: string };

function newTarget(): Target {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-import-target-"));
  const db = openDb(":memory:");
  migrate(db);
  return { db, dir, documentsDir: path.join(dir, "documents"), mediaDir: path.join(dir, "media") };
}

const opts = (fx: Fixture, extra: Partial<ImportOptions> = {}): ImportOptions => ({
  sourceFile: fx.sqlite,
  documentsFolder: fx.documents,
  mediaSourceFolder: fx.media,
  summaryFile: fx.summaryFile,
  defaultTimeZone: "Europe/Zurich",
  now: () => new Date("2026-10-11T10:00:00Z"),
  ...extra,
});

const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const tables = ["users", "trips", "trip_events", "participants", "ledgers", "ledger_couples", "expenses", "expense_splits", "settlements",
  "trip_event_comments", "documents", "trip_event_documents", "trip_documents", "import_map", "participant_token_aliases", "media"];
const snapshot = (db: Db) => Object.fromEntries(tables.map((t) => [t, count(db, t)]));

function eventBy(db: Db, title: string) {
  return db.prepare("SELECT * FROM trip_events WHERE title = ?").get(title) as Record<string, any>;
}

async function withFixture<T>(o: Parameters<typeof buildFixture>[0], fn: (fx: Fixture, t: Target) => Promise<T>): Promise<T> {
  const fx = await buildFixture(o);
  const t = newTarget();
  try {
    return await fn(fx, t);
  } finally {
    fx.cleanup();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}

test("import: Abbildung, Zählungen und Salden stimmen, Quelle bleibt unverändert", async () => {
  await withFixture({ withSummary: true, withMedia: true }, async (fx, t) => {
    const before = fileHash(fx.sqlite);
    const { report } = await importHomeBuddy(t, opts(fx));
    assert.equal(report.status, "ok");
    assert.equal(report.committed, true);
    assert.equal(report.summaryUsed, true);
    assert.deepEqual(report.checks.filter((c) => !c.ok), []);
    assert.equal(fileHash(fx.sqlite), before, "Quelle unverändert");
    assert.deepEqual(fs.readdirSync(fx.dir).sort(), ["documents", "homebuddy.sqlite", "media", "summary.json"], "keine Nebendateien neben der Quelle");

    assert.deepEqual(
      { trips: count(t.db, "trips"), events: count(t.db, "trip_events"), participants: count(t.db, "participants"),
        ledgers: count(t.db, "ledgers"), expenses: count(t.db, "expenses"), settlements: count(t.db, "settlements"),
        comments: count(t.db, "trip_event_comments"), links: count(t.db, "trip_event_documents"), documents: count(t.db, "documents"),
        couples: count(t.db, "ledger_couples"), users: count(t.db, "users") },
      { trips: 2, events: 10, participants: 5, ledgers: 2, expenses: 5, settlements: 1, comments: 1, links: 3, documents: 2, couples: 1, users: 3 }
    );

    // IDs der Kasse und der Ausgaben bleiben (leere Datenbank)
    assert.deepEqual((t.db.prepare("SELECT id, trip_id FROM ledgers ORDER BY id").all() as any[]).map((l) => [l.id, l.trip_id]), [[7, 3], [8, 4]]);
    assert.ok(t.db.prepare("SELECT 1 FROM expenses WHERE id = 40").get());

    // Salden mit der TravelBuddy-Logik
    const names = new Map((t.db.prepare("SELECT id, display_name FROM participants").all() as any[]).map((p) => [p.id, p.display_name]));
    const net = Object.fromEntries(participantBalances(t.db, 7).map((b) => [names.get(b.memberId), b.netMinor]));
    assert.deepEqual(net, { Anna: EXPECTED_NET.Anna, Ben: EXPECTED_NET.Ben, Dora: EXPECTED_NET.Dora });
    assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);

    // Beträge, Kurse, Status unverändert
    const e41 = t.db.prepare("SELECT * FROM expenses WHERE id = 41").get() as any;
    assert.equal(e41.amount_minor, 6000);
    assert.equal(e41.currency, "EUR");
    assert.equal(e41.exchange_rate, 0.95);
    assert.equal(e41.amount_base_minor, 5700);
    // Ausgabe am Ereignis, Ereignis kennt die Ausgabe
    assert.equal((t.db.prepare("SELECT expense_id FROM trip_events WHERE id = 100").get() as any).expense_id, 40);

    // Benutzer: Hash unverändert, Aktiv-Flag, keine Tokens
    const anna = t.db.prepare("SELECT * FROM users WHERE username = 'anna'").get() as any;
    assert.match(anna.password_hash, /^scrypt:/);
    assert.equal(anna.is_admin, 1);
    assert.equal((t.db.prepare("SELECT active FROM users WHERE username = 'cleo'").get() as any).active, 0);
    assert.equal(count(t.db, "api_tokens"), 0);

    // Bericht enthält keine Geheimnisse
    const text = renderReportText(report) + JSON.stringify(report);
    for (const secret of [PASSWORDS.anna, TOKENS.trip.Anna, TOKENS.invite.Dora, "scrypt:", fx.sha.docA]) {
      assert.ok(!text.includes(secret), `Bericht enthält ${secret.slice(0, 8)}…`);
    }
    assert.ok(!/ß/.test(text));
    assert.match(renderReportText(report), /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
  });
});

test("import: Anmeldung mit dem übernommenen Hash, Gäste-Links /t/ und /g/ gelten weiter, Alias stirbt mit dem Link", async () => {
  await withFixture({}, async (fx, t) => {
    await importHomeBuddy(t, opts(fx));
    const app = createApp({ db: t.db, now: () => new Date("2026-10-11T10:00:00Z"), documentsDir: t.documentsDir, mediaDir: t.mediaDir });
    const req = async (method: string, url: string, body?: unknown, token?: string) => {
      const res = await app.request(url, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    };
    const login = await req("POST", "/v1/auth/login", { username: "anna", password: PASSWORDS.anna, platform: "ios" });
    assert.equal(login.status, 200);
    const token = login.body.token as string;

    const trip = await req("GET", `/v1/trips/${fx.ids.tripItaly}`, undefined, token);
    assert.equal(trip.status, 200);
    const travelers = trip.body.travelers as any[];
    assert.deepEqual(travelers.map((x) => x.displayName), ["Anna", "Ben", "Dora"]);
    assert.equal(travelers.find((x) => x.displayName === "Dora").shareToken, TOKENS.trip.Dora);
    assert.ok(trip.body.trip.ledgerId);
    const flight = (trip.body.events as any[]).find((e) => e.title === "Flug nach Barcelona");
    assert.equal(flight.type, "Flug");
    assert.equal(flight.startTz, "Europe/Zurich");
    assert.equal(flight.endTz, "Europe/Madrid");
    assert.equal(flight.status, "confirmed");
    assert.equal(flight.details.flightNumber, "LX 1954");
    assert.equal(flight.documentIds.length, 2);

    const ledger = await req("GET", `/v1/ledgers/${fx.ids.ledgerSplit}`, undefined, token);
    assert.equal(ledger.status, 200);
    const bal = Object.fromEntries((ledger.body.balances as any[]).map((b) => [b.displayName, b.netMinor]));
    assert.deepEqual(bal, { Anna: 2100, Ben: -1200, Dora: -900 });

    // Reise-Link (Haupt-Token) und Abrechnungs-Link (zweiter Token, Alias) funktionieren, in beiden Sichten
    assert.equal((await req("GET", `/v1/guest/trips/${TOKENS.trip.Dora}`)).status, 200);
    assert.equal((await req("GET", `/v1/guest/${TOKENS.trip.Dora}`)).status, 200);
    assert.equal((await req("GET", `/v1/guest/${TOKENS.invite.Dora}`)).status, 200);
    assert.equal((await req("GET", `/v1/guest/trips/${TOKENS.invite.Dora}`)).status, 200);
    assert.equal((await req("GET", `/v1/guest/${TOKENS.invite.Ben}`)).status, 200);
    assert.equal((await req("GET", `/v1/guest/nicht-vorhanden`)).status, 404);

    // Link erneuern: Haupt-Token und Alias sind danach ungültig
    const dora = t.db.prepare("SELECT id FROM participants WHERE display_name = 'dora' OR display_name = 'Dora'").get() as { id: number };
    const rotated = await req("POST", `/v1/ledgers/${fx.ids.ledgerSplit}/members/${dora.id}/invite/rotate`, {}, token);
    assert.equal(rotated.status, 200);
    assert.equal((await req("GET", `/v1/guest/${TOKENS.trip.Dora}`)).status, 404);
    assert.equal((await req("GET", `/v1/guest/${TOKENS.invite.Dora}`)).status, 404);
  });
});

test("import: Kassabuch wird zur Reisekasse mit den Reiseteilnehmern, Ersteller zahlt, Summen bleiben", async () => {
  await withFixture({ withSummary: true }, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx));
    assert.equal(report.status, "ok");
    assert.equal(report.cashbooks.length, 1);
    assert.equal(report.cashbooks[0]!.payer, "Anna");
    assert.equal(report.cashbooks[0]!.expenses, 2);
    assert.match(report.cashbooks[0]!.rule, /Ersteller/);

    const ledger = t.db.prepare("SELECT * FROM ledgers WHERE id = 8").get() as any;
    assert.equal(ledger.trip_id, fx.ids.tripCash);
    const people = t.db.prepare("SELECT id, display_name, trip_id, ledger_id FROM participants WHERE trip_id = 4 ORDER BY sort_key").all() as any[];
    assert.deepEqual(people.map((p) => p.display_name), ["Anna", "Ben"], "Reiseteilnehmer, kein «Konto»");
    assert.ok(people.every((p) => p.ledger_id === 8));
    const anna = people[0].id as number;
    const rows = t.db.prepare("SELECT * FROM expenses WHERE ledger_id = 8 ORDER BY id").all() as any[];
    assert.deepEqual(rows.map((r) => [r.paid_by_participant_id, r.currency, r.amount_minor, r.amount_base_minor]), [
      [anna, "EUR", 1000, 900],
      [anna, "EUR", 2000, 1800],
    ]);
    const splits = t.db.prepare("SELECT participant_id, SUM(share_base_minor) AS s FROM expense_splits WHERE expense_id IN (50, 51) GROUP BY participant_id").all() as any[];
    assert.deepEqual(splits, [{ participant_id: anna, s: 2700 }], "Aufteilung nur auf den Ersteller");
    assert.deepEqual(participantBalances(t.db, 8).map((b) => b.netMinor), [0, 0]);
    assert.equal((t.db.prepare("SELECT trip_event_id FROM expenses WHERE id = 50").get() as any).trip_event_id, fx.ids.eventCash);
  });
});

test("import: Zeitzonen aus IATA, Koordinaten, Ortsnamen, Folgeereignis und Vorwärts-Übertragung; Unsicheres wird «zu prüfen»", async () => {
  await withFixture({}, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx));
    const tz = (title: string) => {
      const e = eventBy(t.db, title);
      return [e.start_tz, e.end_tz, e.status];
    };
    assert.deepEqual(tz("Flug nach Barcelona"), ["Europe/Zurich", "Europe/Madrid", "confirmed"]);
    assert.deepEqual(tz("Hotel Meer"), ["Europe/Madrid", "Europe/Madrid", "confirmed"]);
    // Kreuzfahrt: Start per Koordinaten, Ende aus dem Folgeereignis am Endtag (Florida)
    assert.deepEqual(tz("Transatlantik"), ["Europe/Madrid", "America/New_York", "confirmed"]);
    assert.deepEqual(tz("Ankunft Port Canaveral"), ["America/New_York", "America/New_York", "confirmed"]);
    // Seetag ohne Ort und Zeit: zuletzt bekannte Zone
    assert.deepEqual(tz("Seetag"), ["Europe/Madrid", "Europe/Madrid", "confirmed"]);
    assert.deepEqual(tz("Mietwagen Miami"), ["America/New_York", "America/New_York", "confirmed"]);
    // Bahn: Anfang Reisezone (Altdorf unbekannt), Ende über den Ortsnamen
    assert.deepEqual(tz("Anreise"), ["Europe/Zurich", "Europe/Zurich", "confirmed"]);
    assert.deepEqual(tz("Zugfahrt Budapest-Keleti nach Zürich HB"), ["Europe/Budapest", "Europe/Zurich", "confirmed"]);
    // Flug mit unbekannten Flughäfen: nichts geraten
    assert.deepEqual(tz("Flug ins Ungewisse"), [null, null, "needs_review"]);
    // Unbekannter Typ → Ausflug, zu prüfen
    const odd = eventBy(t.db, "Unbekannter Typ");
    assert.equal(odd.event_type, "Ausflug");
    assert.equal(odd.status, "needs_review");

    assert.equal(report.zones.review.length, 1);
    assert.equal(report.zones.review[0]!.title, "Flug ins Ungewisse");
    assert.equal(report.eventsNeedingReview.unknownType, 1);
    assert.ok(report.zones.byOrigin.iata! >= 2 && report.zones.byOrigin.coords! >= 4 && report.zones.byOrigin.lookahead === 1);

    // Flug: Koordinaten = Abflughafen, Herkunft «derived»
    const f = eventBy(t.db, "Flug nach Barcelona");
    assert.ok(Math.abs(f.lat - 47.4581) < 0.01);
    assert.equal(JSON.parse(f.fields_meta).lat.source, "derived");
    assert.equal(JSON.parse(f.fields_meta).startTz.quote, "IATA ZRH");
  });

  assert.equal(zoneFromPlaceName("Budapest-Keleti")?.tz, "Europe/Budapest");
  assert.equal(zoneFromPlaceName("Zürich HB")?.tz, "Europe/Zurich");
  assert.equal(zoneFromPlaceName("Irgendwo im Nirgendwo"), null);
});

test("import: details gegen den Katalog (Aliase, Auswahl, unbekannte Schlüssel gezählt)", async () => {
  await withFixture({}, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx));
    const flight = JSON.parse(eventBy(t.db, "Flug nach Barcelona").details);
    assert.deepEqual(flight, { flightNumber: "LX 1954", departureAirport: "ZRH", arrivalAirport: "BCN", cabinClass: "Business" });
    const hotel = JSON.parse(eventBy(t.db, "Hotel Meer").details);
    assert.deepEqual(hotel, { board: "Fruehstueck", roomType: "5", checkInFrom: "09:30" });
    const car = eventBy(t.db, "Mietwagen Miami");
    assert.equal(car.event_type, "Mietauto");
    assert.deepEqual(JSON.parse(car.details), { pickupPlace: "Miami Airport", returnPlace: "Miami Airport" });
    assert.equal(JSON.parse(eventBy(t.db, "Anreise").details).durationMinutes, 92);

    assert.deepEqual(report.details.droppedKeys, { seatMap: 1, gateNote: 1 });
    assert.equal(report.details.normalizedSelects.board, 1);
    assert.equal(report.details.normalizedSelects.cabinClass, 1);
    assert.deepEqual(report.details.renamedKeys, { "originPlace→pickupPlace": 1, "destinationPlace→returnPlace": 1 });
  });
});

test("import: Dokumente (Dublettenregel, Titel, OCR-Text, Altanalyse), unzugeordnete nur mit Schalter", async () => {
  await withFixture({}, async (fx, t) => {
    // Vorhandenes Dokument mit gleicher Datei (Dublette per SHA-256) bleibt unverändert und wird verknüpft
    t.db
      .prepare(
        `INSERT INTO documents (title, file_name, content_type, size_bytes, sha256, analysis_status, source, created_at, updated_at)
         VALUES ('Eigener Titel', 'meins.pdf', 'application/pdf', 10, ?, 'pending', 'upload', 'x', 'x')`
      )
      .run(fx.sha.docB);
    const { report } = await importHomeBuddy(t, opts(fx));
    assert.equal(report.documents.imported, 1);
    assert.equal(report.documents.duplicates, 1);
    assert.equal(count(t.db, "documents"), 2);
    const b = t.db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(fx.sha.docB) as any;
    assert.equal(b.title, "Eigener Titel");
    assert.equal(b.analysis_status, "pending");
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM trip_event_documents WHERE document_id = ?").get(b.id) as any).n, 1);

    const a = t.db.prepare("SELECT * FROM documents WHERE sha256 = ?").get(fx.sha.docA) as any;
    assert.equal(a.title, "Bestätigung Flug", "suggested_title vor title");
    assert.equal(a.text, "OCR-Text A");
    assert.equal(a.text_source, "ocr");
    assert.equal(a.analysis_status, "done");
    assert.equal(a.analysis_model, "homebuddy-import");
    assert.equal(JSON.parse(a.analysis_json).category, "Reisen");
    assert.equal(a.source, "upload");
    assert.deepEqual(JSON.parse(a.source_meta), { importedFrom: "homebuddy", paperlessId: 7001, homebuddyDocumentId: 300 });
    assert.equal(a.file_name, "original-A.pdf");
    assert.equal(a.pages, 1);
    assert.ok(fs.existsSync(path.join(t.documentsDir, a.sha256.slice(0, 2), `${a.sha256}.pdf`)));
    assert.ok(!fs.existsSync(path.join(t.documentsDir, fx.sha.docC.slice(0, 2), `${fx.sha.docC}.pdf`)), "unverknüpftes Dokument nicht ohne Schalter");

    // Mit Schalter: das nicht verknüpfte Reisedokument kommt als unzugeordnetes Dokument dazu
    const again = await importHomeBuddy(t, opts(fx, { includeUnlinkedTravelDocs: true }));
    assert.equal(again.report.documents.unlinkedImported, 1);
    const c = t.db.prepare("SELECT id, title FROM documents WHERE sha256 = ?").get(fx.sha.docC) as any;
    assert.equal(c.title, "Titel C", "ohne suggested_title gilt title");
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM trip_event_documents WHERE document_id = ?").get(c.id) as any).n, 0);
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM trip_documents WHERE document_id = ?").get(c.id) as any).n, 0);
  });
});

test("import: Wiederholung aktualisiert statt zu verdoppeln, Teilnehmer und Ausgaben nie doppelt, Sperren bleiben", async () => {
  await withFixture({ withSummary: true, withMedia: true }, async (fx, t) => {
    const first = await importHomeBuddy(t, opts(fx));
    assert.equal(first.report.status, "ok");
    const snap = snapshot(t.db);
    const tokens = t.db.prepare("SELECT id, share_token FROM participants ORDER BY id").all();
    const ids = t.db.prepare("SELECT id FROM expenses ORDER BY id").all();

    // Von Hand geändert und gesperrt, dazu eine freie Änderung am Titel der Reise im Ziel
    t.db.prepare("UPDATE trip_events SET title = 'Mein Titel', fields_meta = ? WHERE title = 'Hotel Meer'").run(
      JSON.stringify({ title: { source: "manual", locked: true } })
    );
    t.db.prepare("UPDATE trip_events SET status = 'confirmed' WHERE title = 'Unbekannter Typ'").run();

    const second = await importHomeBuddy(t, opts(fx));
    assert.equal(second.report.status, "ok");
    assert.deepEqual(snapshot(t.db), snap, "keine neuen Zeilen");
    assert.deepEqual(t.db.prepare("SELECT id, share_token FROM participants ORDER BY id").all(), tokens);
    assert.deepEqual(t.db.prepare("SELECT id FROM expenses ORDER BY id").all(), ids);
    assert.equal(second.report.counts.events.created, 0);
    assert.equal(second.report.counts.events.updated, 10);
    assert.equal(second.report.counts.expenses.updated, 5);
    assert.ok(t.db.prepare("SELECT 1 FROM trip_events WHERE title = 'Mein Titel'").get(), "gesperrtes Feld bleibt");
    assert.equal((t.db.prepare("SELECT status FROM trip_events WHERE title = 'Unbekannter Typ'").get() as any).status, "confirmed", "Status bleibt");
    assert.deepEqual(participantBalances(t.db, 7).map((b) => b.netMinor).sort((a, b) => a - b), [-1200, -900, 2100]);
  });
});

test("import: Trockenlauf schreibt nichts (Datenbank, Dateien), Bericht zeigt die Zahlen", async () => {
  await withFixture({ withSummary: true, withMedia: true }, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx, { dryRun: true }));
    assert.equal(report.mode, "dry-run");
    assert.equal(report.status, "ok");
    assert.equal(report.committed, false);
    assert.equal(report.counts.expenses.created, 5);
    assert.equal(report.counts.events.created, 10);
    assert.ok(Object.values(snapshot(t.db)).every((n) => n === 0), JSON.stringify(snapshot(t.db)));
    assert.ok(!fs.existsSync(t.documentsDir));
    assert.ok(!fs.existsSync(t.mediaDir));
    assert.equal(report.media.copied, 1);
    assert.match(renderReportText(report), /Trockenlauf bestanden/);
  });
});

test("import: Abweichung beim Saldo (summary.json) → Status mismatch, alles zurückgerollt, keine Dateien", async () => {
  await withFixture({ withSummary: true, summaryBalanceOff: true, withMedia: true }, async (fx, t) => {
    t.db.prepare("INSERT INTO users (username, display_name, password_hash, created_at) VALUES ('vorher', 'Vorher', 'scrypt:a:b', 'x')").run();
    const { report } = await importHomeBuddy(t, opts(fx));
    assert.equal(report.status, "mismatch");
    assert.equal(report.committed, false);
    const bad = report.checks.filter((c) => !c.ok);
    assert.ok(bad.length >= 1);
    assert.ok(bad.some((c) => /Saldo Anna/.test(c.name)), JSON.stringify(bad));
    const snap = snapshot(t.db);
    assert.equal(snap.users, 1, "nur der vorher vorhandene Benutzer");
    assert.equal(snap.trips, 0);
    assert.equal(snap.expenses, 0);
    assert.equal(snap.import_map, 0);
    assert.equal(snap.media, 0);
    assert.ok(!fs.existsSync(t.documentsDir), "keine Dokumentdateien");
    assert.ok(!fs.existsSync(t.mediaDir), "keine Bilder");
    assert.match(renderReportText(report), /ABWEICHUNG/);
  });
});

test("import: fehlende Dokumentdatei bei angegebenem Ordner ist eine Abweichung; ohne Ordner wird die Prüfung übersprungen", async () => {
  await withFixture({}, async (fx, t) => {
    fs.rmSync(path.join(fx.documents, "paperless-7002.pdf"));
    const { report } = await importHomeBuddy(t, opts(fx, { summaryFile: null }));
    assert.equal(report.status, "mismatch");
    assert.equal(report.documents.missingFiles, 1);
    assert.equal(count(t.db, "trips"), 0);
  });
  await withFixture({}, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx, { documentsFolder: null, summaryFile: null }));
    assert.equal(report.status, "ok");
    const links = report.checks.find((c) => c.name === "Ereignis-Dokument-Verknüpfungen")!;
    assert.ok(links.skipped);
    assert.equal(count(t.db, "documents"), 0);
    assert.equal(count(t.db, "trip_event_documents"), 0);
    assert.equal(report.counts.events.created, 10);
  });
});

test("import: Medien werden nur kopiert, wenn die Datei im Medienordner liegt; sonst gemeldet", async () => {
  await withFixture({ withMedia: true }, async (fx, t) => {
    const { report } = await importHomeBuddy(t, opts(fx, { summaryFile: null }));
    assert.equal(report.media.tableInSource, true);
    assert.equal(report.media.inSource, 3);
    assert.equal(report.media.copied, 1);
    assert.equal(report.media.missingFiles, 1);
    assert.equal(report.media.skippedKinds, 1);
    const m = t.db.prepare("SELECT * FROM media").all() as any[];
    assert.equal(m.length, 1);
    assert.equal(m[0].kind, "trip_cover");
    assert.equal(m[0].owner_id, 3);
    assert.equal(m[0].source, "imported");
    assert.ok(fs.existsSync(path.join(t.mediaDir, "trip_cover", m[0].file_name)));
    assert.ok(report.warnings.some((w) => /Medien/.test(w)));
  });
});

test("import: Quelle ohne HomeBuddy-Tabellen wird abgelehnt", async () => {
  const t = newTarget();
  const file = path.join(t.dir, "leer.sqlite");
  const Database = (await import("better-sqlite3")).default;
  const d = new Database(file);
  d.exec("CREATE TABLE foo (id INTEGER)");
  d.close();
  await assert.rejects(() => importHomeBuddy(t, { sourceFile: file }), /keine HomeBuddy-Datenbank/);
  await assert.rejects(() => importHomeBuddy(t, { sourceFile: path.join(t.dir, "gibtsnicht.sqlite") }), /nicht gefunden/);
  fs.rmSync(t.dir, { recursive: true, force: true });
});

test("zonen: Flug mit halb bekannten Flughäfen, Strecke über einen Zonenwechsel, Ereignis ohne Datum", () => {
  const ev = (o: Partial<ZoneEventInput>): ZoneEventInput => ({
    type: "Ausflug", startDate: "2026-11-01", endDate: null, startTime: null, endTime: null, lat: null, lon: null,
    location: null, details: {}, ...o,
  });
  const r = deriveZones(
    [
      ev({ type: "Flug", startDate: "2026-11-01", startTime: "10:00", endTime: "12:00", details: { departureAirport: "ZRH", arrivalAirport: "QQQ" } }),
      ev({ type: "Transfer", startDate: "2026-11-02", startTime: "09:00", endTime: "09:40", location: "Hafen → Hotel" }),
      ev({ startDate: null }),
      ev({ startDate: "2026-11-01", lat: 40.64, lon: -73.78 }), // New York
      ev({ type: "Zugreisen", startDate: "2026-11-05", endDate: "2026-11-06", startTime: "20:00", endTime: "07:00" }),
      ev({ startDate: "2026-11-07", lat: 47.37, lon: 8.54 }), // Zürich
    ],
    { tripTz: "Europe/Zurich" }
  );
  // Flug: Abflughafen bekannt, Ankunft nicht → nichts übertragen, zu prüfen
  assert.equal(r[0]!.startTz?.tz, "Europe/Zurich");
  assert.equal(r[0]!.endTz, null);
  assert.match(r[0]!.review ?? "", /Flughafen/);
  // Transfer am Folgetag: übernimmt die zuletzt bekannte Zone (New York, 01.11. 23:59 kommt vor 02.11.)
  assert.equal(r[1]!.startTz?.tz, "America/New_York");
  assert.equal(r[1]!.startTz?.how, "carried");
  assert.equal(r[1]!.review, null);
  // ohne Datum: Reisezone (NULL)
  assert.deepEqual(r[2], { startTz: null, endTz: null, review: null });
  // Nachtzug zwischen New York und Zürich, ohne Orte: Zonenwechsel nicht zuzuordnen
  assert.equal(r[4]!.review !== null, true);
  assert.equal(r[4]!.startTz, null);
});
