import test from "node:test";
import assert from "node:assert/strict";
import { runPendingAnalyses } from "../src/ingest/analyzer";
import { IngestAnalyzer } from "../src/ingest/pipeline";
import { LlmError, type LlmResponse } from "../src/ingest/openai";
import { FakeGeocoder, FakeLlm, extractionJson, ingestSetup, rateLimited, textPdf, type EventSpec } from "./ingest-fixtures";

const row = (env: any, sql: string, ...p: unknown[]) => env.db.prepare(sql).get(...p) as any;
const rows = (env: any, sql: string, ...p: unknown[]) => env.db.prepare(sql).all(...p) as any[];

const FLIGHT_TEXT = [
  "Flugbestaetigung Beispiel Air", "Buchungscode: ABC123", "Passagier: MUSTER/BERTA MRS",
  "Flug LX 86 Zuerich (ZRH) - Miami (MIA)", "Abflug 24.10.2026 11:05 Ankunft 24.10.2026 15:30", "Terminal 2 Gate A12 Sitz 12A",
  "Bitte beachten Sie die Reisebestimmungen und Einreiseformalitaeten des Ziellandes fuer Ihre Reise.",
];
const flightFields = (extra: Array<[string, string, any?]> = []): EventSpec["fields"] => [
  ["title", "Flug Zuerich - Miami"], ["startDate", "2026-10-24"], ["startTime", "11:05"], ["endDate", "2026-10-24"], ["endTime", "15:30"],
  ["bookingReference", "ABC123"], ["flightNumber", "LX 86"], ["departureAirport", "ZRH"], ["arrivalAirport", "MIA"], ...extra,
];

test("Zusammenführen: zweites Dokument ergänzt nur leere Felder, gesperrte bleiben, Abweichung wird gemeldet, keine Dublette", async () => {
  let n = 0;
  const llm = new FakeLlm(() => {
    n++;
    return n === 1
      ? extractionJson([{ type: "Flug", fields: flightFields() }])
      : extractionJson([
          {
            type: "Flug",
            fields: [...flightFields().filter(([k]) => k !== "startTime"), ["startTime", "11:10"], ["departureTerminal", "2"], ["departureGate", "A12"], ["baggageBelt", "7"]],
          },
        ]);
  });
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const first = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  let ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.details.departureGate, undefined);
  // Von Hand gesperrtes Feld
  const patch = await env.call("PATCH", `/v1/trips/${tripId}/events/${ev.id}`, { token: env.anna, json: { details: { ...ev.details, departureGate: "B7" } } });
  assert.equal(patch.status, 200);

  const second = await env.upload(await textPdf([[...FLIGHT_TEXT, "Zweite Fassung"]]), "b.pdf", tripId);
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 1, "gleiche Buchung = Ergänzung statt Dublette");
  ev = events[0];
  assert.equal(ev.details.departureTerminal, "2");
  assert.equal(ev.details.baggageBelt, "7");
  assert.equal(ev.details.departureGate, "B7", "von Hand gesperrt");
  assert.equal(ev.startTime, "11:05", "vorhandene Zeit wird nie überschrieben");
  assert.deepEqual(ev.fieldsMeta.departureTerminal, { source: "document", documentId: second.document.id, confidence: 0.97, page: 1, quote: "2" });
  assert.equal(ev.fieldsMeta.departureGate.locked, true);
  assert.deepEqual(ev.documentIds.sort(), [first.document.id, second.document.id].sort());
  const j = JSON.parse(row(env, "SELECT analysis_json AS j FROM documents WHERE id = ?", second.document.id).j);
  assert.deepEqual(j.applied.conflicts.map((c: any) => [c.field, c.existing, c.proposed]), [["startTime", "11:05", "11:10"]]);
  assert.equal(j.applied.created.length, 0);
  assert.ok(j.applied.merged[0].fields.includes("departureTerminal"));
});

test("Hinweis-Ereignis: Dokument am Ereignis ergänzt dieses, statt ein zweites anzulegen", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([{ type: "Hotel", fields: [["title", "Hotel Strandhaus"], ["startDate", "2026-10-24"], ["endDate", "2026-10-31"], ["bookingReference", "H-1"], ["checkInFrom", "15:00"]] }])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const manual = await env.call("POST", `/v1/trips/${tripId}/events`, { token: env.anna, json: { type: "Hotel", title: "Unterkunft Miami" } });
  const evId = manual.body.eventId;
  const text = ["Hotelbestaetigung", "Reservierungsnummer H-1", "Anreise 24.10.2026 Abreise 31.10.2026 Check-in ab 15:00", "Hotel Strandhaus Miami Beach mit Fruehstueck und Parkplatz am Haus."];
  await env.upload(await textPdf([text]), "hotel.pdf", tripId, { eventId: String(evId) });
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, evId);
  assert.equal(events[0].title, "Unterkunft Miami", "bestehender Titel bleibt");
  assert.equal(events[0].startDate, "2026-10-24");
  assert.equal(events[0].bookingReference, "H-1");
  assert.equal(events[0].details.checkInFrom, "15:00");
});

test("Status: Sicherheit, Schwelle TRAVELBUDDY_AUTO_CONFIRM_MIN, Datum ausserhalb der Reise, Review-Meldung", async () => {
  const text = ["Buchung", "Buchungscode ABC123 Flug LX 86 ZRH MIA 24.10.2026", "Zweiter Flug LX 90 ZRH MIA 01.03.2027 Buchungscode QQQ111", "Dritter Flug LX 91 ZRH MIA 25.10.2026 Buchungscode WWW222", "Weitere Hinweise zur Reise und den Bedingungen."];
  const llm = new FakeLlm(() =>
    extractionJson([
      { type: "Flug", fields: flightFields(), confidence: 0.97 },
      { type: "Flug", confidence: 0.97, fields: [["startDate", "2027-03-01"], ["startTime", "09:00"], ["bookingReference", "QQQ111"], ["flightNumber", "LX 90"], ["departureAirport", "ZRH"], ["arrivalAirport", "MIA"]] },
      { type: "Flug", confidence: 0.8, fields: [["startDate", "2026-10-25"], ["startTime", "09:00"], ["bookingReference", "WWW222"], ["flightNumber", "LX 91"], ["departureAirport", "ZRH"], ["arrivalAirport", "MIA"]] },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  await env.upload(await textPdf([text]), "drei.pdf", tripId);
  const { trip, events } = await env.trip(tripId);
  const byFn = (fn: string) => events.find((e: any) => e.details.flightNumber === fn);
  assert.equal(byFn("LX 86").status, "confirmed");
  assert.equal(byFn("LX 91").status, "proposed", "unter der Schwelle 0.92");
  assert.equal(byFn("LX 90").status, "needs_review", "Datum ausserhalb des Reisezeitraums");
  assert.equal(trip.endDate, "2026-11-07", "ein ausserliegendes Datum verbreitert die Reise nicht");
  assert.deepEqual(env.reviews, [[tripId, 2]]);
  const j = JSON.parse(row(env, "SELECT analysis_json AS j FROM documents").j);
  const bad = j.events.find((e: any) => e.details.flightNumber === "LX 90");
  assert.ok(bad.issues.some((i: any) => i.code === "outside_trip" && i.needsReview));

  // Schwelle konfigurierbar
  const env2 = await ingestSetup({ llm: new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields() }])), autoConfirmMin: 0.99 });
  const t2 = await env2.createTrip();
  await env2.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", t2);
  assert.equal((await env2.trip(t2)).events[0].status, "proposed");
});

test("Zeitzonen: Miami 16:50 → Lissabon 06:00 (+1) wird aus den Ortszeiten abgeleitet und zur Prüfung markiert", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Flug",
        fields: [
          ["title", "Flug Miami - Lissabon"], ["startDate", "2026-11-05"], ["startTime", "16:50"], ["endDate", "2026-11-05"], ["endTime", "06:00"],
          ["flightNumber", "TP 202"], ["bookingReference", "TPX900"], ["departureAirport", "MIA"], ["arrivalAirport", "LIS"],
        ],
      },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["Flug TP 202 Miami (MIA) - Lissabon (LIS)", "Abflug 05.11.2026 16:50 Ankunft 06:00 +1", "Buchungscode TPX900", "Weitere Angaben zu Gepaeck und Einreise nach Portugal fuer die Reisenden."];
  await env.upload(await textPdf([text]), "tp.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.startTz, "America/New_York");
  assert.equal(ev.endTz, "Europe/Lisbon");
  assert.equal(ev.endDate, "2026-11-06");
  assert.equal(ev.fieldsMeta.endDate.source, "derived");
  assert.equal(ev.status, "needs_review");
});

test("Kennungen werden gegen den Text geprüft: nicht gefunden → markiert; eindeutiger Regel-Treffer ersetzt den KI-Wert", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      { type: "Flug", fields: flightFields().map(([k, v, o]) => (k === "bookingReference" ? [k, "ZZZ999", o] : k === "flightNumber" ? [k, "LX 87", o] : [k, v, o]) as any) },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.bookingReference, "ABC123", "genau ein Buchungscode im Dokument");
  assert.equal(ev.details.flightNumber, "LX 86", "genau eine Flugnummer im Dokument");
  assert.equal(ev.fieldsMeta.bookingReference.needsReview, true);
  assert.equal(ev.status, "needs_review");
  const j = JSON.parse(row(env, "SELECT analysis_json AS j FROM documents WHERE id = ?", document.id).j);
  assert.ok(j.events[0].issues.some((i: any) => i.code === "rule_override"));

  // Ohne Regel-Treffer: Wert bleibt, Sicherheit sinkt, Markierung
  const env2 = await ingestSetup({ llm: new FakeLlm(() => extractionJson([{ type: "Hotel", fields: [["title", "Hotel Test"], ["startDate", "2026-10-24"], ["bookingReference", "NOPE-123"]] }])) });
  const t2 = await env2.createTrip();
  await env2.upload(await textPdf([["Hotelbestaetigung fuer Ihren Aufenthalt vom 24.10.2026 im Hotel Test", "Wir freuen uns auf Sie und wuenschen eine gute Reise nach Miami.", "Bitte beachten Sie die Hausordnung und die Zeiten fuer Anreise und Abreise sowie das Fruehstuecksbuffet."]]), "h.pdf", t2);
  const h = (await env2.trip(t2)).events[0];
  assert.equal(h.bookingReference, "NOPE-123");
  assert.equal(h.status, "needs_review");
  assert.ok(h.fieldsMeta.bookingReference.confidence <= 0.6);
});

test("Katalog: unbekannte Auswahl und ungültiges Muster entfallen einzeln, das Ereignis entsteht trotzdem (zu prüfen)", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Hotel",
        fields: [
          ["title", "Hotel Test"], ["startDate", "2026-10-24"], ["board", "Zimmer mit Hund"], ["roomType", "Suite"], ["checkInFrom", "nach 14 Uhr"], ["guests", "zwei"],
        ],
      },
      { type: "Flug", fields: [["title", "Flug X"], ["startDate", "2026-10-24"], ["flightNumber", "ABCDEFGHIJ"], ["departureAirport", "ZRH"]] },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["Bestaetigung Hotel Test Suite 24.10.2026 Zimmer mit Hund erlaubt", "Flug X ABCDEFGHIJ Zuerich ZRH 24.10.2026", "Weitere Hinweise zur Anreise und zum Aufenthalt in Miami Beach."];
  const { document } = await env.upload(await textPdf([text]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 2);
  const hotel = events.find((e: any) => e.type === "Hotel");
  assert.equal(hotel.details.board, undefined);
  assert.equal(hotel.details.roomType, "Suite");
  assert.equal(hotel.details.checkInFrom, undefined);
  assert.equal(hotel.status, "needs_review");
  const fl = events.find((e: any) => e.type === "Flug");
  assert.equal(fl.details.flightNumber, undefined);
  assert.equal(fl.status, "needs_review");
});

test("Reise-Zuordnung: Buchungsnummer-Treffer ergänzt das vorhandene Ereignis der passenden Reise", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([{ type: "Hotel", fields: [["title", "Hotel Strandhaus"], ["startDate", "2026-10-25"], ["bookingReference", "HTL555"], ["checkInFrom", "16:00"]] }])
  );
  const env = await ingestSetup({ llm });
  const a = await env.createTrip();
  const b = await env.createTrip({ title: "Rom 2027", destination: "Rom", startDate: "2027-05-01", endDate: "2027-05-08" });
  const ev = await env.call("POST", `/v1/trips/${a}/events`, { token: env.anna, json: { type: "Hotel", title: "Hotel Strandhaus", startDate: "2026-10-25", bookingReference: "HTL555" } });
  const text = ["Hotelbestaetigung Strandhaus", "Reservierungsnummer HTL555", "Anreise 25.10.2026 Check-in ab 16:00 Uhr im Hotel Strandhaus Miami Beach."];
  const { document } = await env.upload(await textPdf([text]), "einwurf.pdf", null);
  assert.deepEqual(document.tripIds, [a]);
  assert.deepEqual(document.eventIds, [ev.body.eventId]);
  assert.equal((await env.trip(a)).events.length, 1);
  assert.equal((await env.trip(a)).events[0].details.checkInFrom, "16:00");
  assert.equal((await env.trip(b)).events.length, 0);
  assert.equal(document.proposedTrip, null);
});

test("Reise-Zuordnung: Datum und Zielort genügen, wenn eindeutig", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Ausflug", fields: [["title", "Stadtrundfahrt Miami"], ["startDate", "2026-10-27"], ["startTime", "10:00"], ["location", "Miami"]] }]));
  const env = await ingestSetup({ llm });
  const a = await env.createTrip();
  await env.createTrip({ title: "Rom 2027", destination: "Rom", startDate: "2027-05-01", endDate: "2027-05-08" });
  const text = ["Ticket Stadtrundfahrt Miami", "27.10.2026 10:00 Treffpunkt Bayfront Park, Dauer 3 Stunden, Voucher bitte ausdrucken."];
  const { document } = await env.upload(await textPdf([text]), "tour.pdf", null);
  assert.deepEqual(document.tripIds, [a]);
  assert.equal((await env.trip(a)).events.length, 1);
});

test("Reisevorschlag: ohne eindeutige Reise bleibt proposedTrip, «adopt-trip» legt Reise und Ereignisse an", async () => {
  const geocoder = new FakeGeocoder([["Hafenstrasse", 41.38, 2.17]]);
  const llm = new FakeLlm(() =>
    extractionJson(
      [
        { type: "Flug", fields: [["startDate", "2027-03-12"], ["startTime", "08:15"], ["flightNumber", "LX 2084"], ["bookingReference", "BCN555"], ["departureAirport", "ZRH"], ["arrivalAirport", "BCN"]] },
        { type: "Hotel", fields: [["title", "Hotel Hafen"], ["startDate", "2027-03-12"], ["endDate", "2027-03-15"], ["address", "Hafenstrasse 1, 08003 Barcelona"], ["location", "Hotel Hafen"]], addressParts: { city: "Barcelona", country: "Spanien" } },
      ],
      { trip: { destination: "Barcelona" } }
    )
  );
  const env = await ingestSetup({ llm, geocoder });
  const text = ["Reiseunterlagen Barcelona", "Flug LX 2084 ZRH BCN 12.03.2027 08:15 Buchungscode BCN555", "Hotel Hafen Hafenstrasse 1 Barcelona 12.03.2027 bis 15.03.2027 Frühstück inklusive und weitere Hinweise"];
  const { document } = await env.upload(await textPdf([text]), "bcn.pdf", null);
  assert.equal(document.analysisStatus, "done");
  assert.deepEqual(document.tripIds, []);
  assert.equal(document.proposedTrip.destination, "Barcelona");
  assert.equal(document.proposedTrip.startDate, "2027-03-12");
  assert.equal(document.proposedTrip.endDate, "2027-03-15");
  assert.equal(document.proposedTrip.eventCount, 2);
  assert.equal(rows(env, "SELECT id FROM trips").length, 0, "noch keine Reise");
  const inbox = await env.call("GET", "/v1/inbox", { token: env.anna });
  assert.deepEqual(inbox.body.documents.map((d: any) => d.id), [document.id]);

  const res = await env.call("POST", `/v1/documents/${document.id}/adopt-trip`, { token: env.anna, json: { title: "Barcelona im Frühling" } });
  assert.equal(res.status, 201);
  assert.equal(res.body.trip.title, "Barcelona im Frühling");
  assert.equal(res.body.trip.destination, "Barcelona");
  assert.equal(res.body.trip.startDate, "2027-03-12");
  assert.equal(res.body.created, 2);
  assert.equal(res.body.events.length, 2);
  assert.equal(res.body.document.proposedTrip, null);
  assert.deepEqual(res.body.document.tripIds, [res.body.tripId]);
  const hotel = res.body.events.find((e: any) => e.type === "Hotel");
  assert.equal(hotel.sourceDocumentId, document.id);
  const after = await env.trip(res.body.tripId);
  assert.equal(after.events.find((e: any) => e.type === "Hotel").lat, 41.38, "Adresse geokodiert");
  // zweiter Aufruf: kein Vorschlag mehr
  const again = await env.call("POST", `/v1/documents/${document.id}/adopt-trip`, { token: env.anna, json: {} });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "no_proposed_trip");
  // Mitreisende ohne Adminrechte dürfen nicht
  const ben = await env.tokens.ben();
  assert.equal((await env.call("POST", `/v1/documents/${document.id}/adopt-trip`, { token: ben, json: {} })).status, 403);
});

test("Reisevorschlag: mehrere gleich gute Reisen → Kandidaten; adopt-trip mit tripId ordnet einer vorhandenen zu", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Ausflug", fields: [["title", "Wanderung"], ["startDate", "2026-10-30"], ["startTime", "09:00"]] }]));
  const env = await ingestSetup({ llm });
  const a = await env.createTrip({ title: "Reise A", destination: "Alpha" });
  const b = await env.createTrip({ title: "Reise B", destination: "Beta" });
  const { document } = await env.upload(await textPdf([["Ticket Wanderung am 30.10.2026 um 09:00 Treffpunkt beim Bahnhof, bitte feste Schuhe mitbringen."]]), "w.pdf", null);
  assert.deepEqual(document.tripIds, []);
  assert.deepEqual(document.proposedTrip.candidateTripIds.sort(), [a, b].sort());
  const res = await env.call("POST", `/v1/documents/${document.id}/adopt-trip`, { token: env.anna, json: { tripId: b } });
  assert.equal(res.status, 201);
  assert.equal(res.body.tripId, b);
  assert.equal((await env.trip(b)).events.length, 1);
  assert.equal((await env.trip(a)).events.length, 0);
});

test("Fehler und Backoff: 429 → Wiederholung nach 5, dann 10 Minuten; Erfolg setzt zurück; 401 wird nicht wiederholt", async () => {
  let mode: "limit" | "ok" | "auth" = "limit";
  const llm = new FakeLlm(() => {
    if (mode === "limit") throw rateLimited();
    if (mode === "auth") throw new LlmError("KI-Anfrage fehlgeschlagen (401): Incorrect API key", false, 401);
    return extractionJson([{ type: "Flug", fields: flightFields() }]);
  });
  const t0 = new Date("2026-10-10T08:00:00Z");
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "failed");
  assert.match(document.analysisError, /429/);
  let d = row(env, "SELECT analysis_attempts AS a, analysis_next_retry_at AS n FROM documents WHERE id = ?", document.id);
  assert.equal(d.a, 1);
  assert.equal(d.n, new Date(t0.getTime() + 5 * 60_000).toISOString());
  assert.equal(rows(env, "SELECT * FROM ai_usage WHERE ok = 0").length, 1, "fehlgeschlagener Aufruf wird protokolliert");

  // Zu früh: nichts passiert
  assert.equal(await runPendingAnalyses(env.db, env.analyzer, { now: () => new Date(t0.getTime() + 60_000) }), 0);
  // Fällig: zweiter Fehlschlag, 10 Minuten
  const t1 = new Date(t0.getTime() + 6 * 60_000);
  assert.equal(await runPendingAnalyses(env.db, env.analyzer, { now: () => t1 }), 1);
  d = row(env, "SELECT analysis_attempts AS a, analysis_next_retry_at AS n FROM documents WHERE id = ?", document.id);
  assert.equal(d.a, 2);
  assert.equal(d.n, new Date(t1.getTime() + 10 * 60_000).toISOString());
  // Dritter Versuch gelingt
  mode = "ok";
  const t2 = new Date(t1.getTime() + 11 * 60_000);
  await runPendingAnalyses(env.db, env.analyzer, { now: () => t2 });
  d = row(env, "SELECT analysis_status AS s, analysis_attempts AS a, analysis_next_retry_at AS n, analysis_error AS e FROM documents WHERE id = ?", document.id);
  assert.deepEqual([d.s, d.a, d.n, d.e], ["done", 0, null, null]);
  assert.equal((await env.trip(tripId)).events.length, 1);

  // Nicht wiederholbarer Fehler: sofort endgültig «failed»
  mode = "auth";
  const doc2 = await env.upload(await textPdf([["Anderes Dokument mit genug Text fuer die Erkennung, Flug LX 86 und weitere Zeilen."]]), "b.pdf", tripId);
  d = row(env, "SELECT analysis_status AS s, analysis_next_retry_at AS n, analysis_error AS e FROM documents WHERE id = ?", doc2.document.id);
  assert.equal(d.s, "failed");
  assert.equal(d.n, null);
  assert.match(d.e, /401/);
});

test("Ungültige KI-Ausgabe: ein Reparaturversuch; scheitert auch er, bleibt das Dokument «failed» mit Wiederholung", async () => {
  let n = 0;
  const llm = new FakeLlm((req) => {
    n++;
    if (n === 1) return "Das ist kein JSON";
    assert.equal(req.purpose, "repair");
    assert.ok(req.previous?.output.includes("kein JSON"));
    assert.ok(req.previous?.problems.length);
    return extractionJson([{ type: "Flug", fields: flightFields() }]);
  });
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  assert.equal(llm.calls.length, 2);
  assert.deepEqual(rows(env, "SELECT purpose FROM ai_usage ORDER BY id").map((r) => r.purpose), ["extract", "repair"]);

  const bad = new FakeLlm(() => "{ kaputt");
  const env2 = await ingestSetup({ llm: bad });
  const t2 = await env2.createTrip();
  const r = await env2.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", t2);
  assert.equal(r.document.analysisStatus, "failed");
  assert.equal(bad.calls.length, 2, "genau ein Reparaturversuch");
  assert.match(r.document.analysisError, /ungültig/);
  assert.ok(row(env2, "SELECT analysis_next_retry_at AS n FROM documents").n);
  assert.equal((await env2.trip(t2)).events.length, 0);
});

test("Abgeschnittene Antwort (finish_reason length) → Fehler mit Wiederholung, keine halben Ereignisse", async () => {
  const llm = new FakeLlm((): LlmResponse => ({
    content: '{"summary":"x","events":[{"type":"Flug"',
    finishReason: "length",
    usage: { inputTokens: 10, outputTokens: 16000, cachedTokens: 0 },
    model: "gpt-4o-mini",
  }));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "failed");
  assert.match(document.analysisError, /abgeschnitten/);
  assert.equal((await env.trip(tripId)).events.length, 0);
});

test("Ohne Schlüssel: «übersprungen» mit Hinweis; mit Schlüssel holt der Wartungslauf es nach", async () => {
  const env = await ingestSetup({ llm: null });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "skipped");
  assert.match(document.analysisError, /^KI nicht konfiguriert .*OPENAI_API_KEY/);
  assert.equal((await env.trip(tripId)).events.length, 0);
  assert.equal(await runPendingAnalyses(env.db, env.analyzer), 0, "ohne Schlüssel kein Nachholen");

  const withKey = new IngestAnalyzer({
    db: env.db, documentsDir: env.documentsDir, llm: new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields() }])), render: null, heic: null,
  });
  assert.equal(await runPendingAnalyses(env.db, withKey), 1);
  assert.equal(row(env, "SELECT analysis_status AS s FROM documents").s, "done");
  assert.equal((await env.trip(tripId)).events.length, 1);
});

test("Scan ohne Textebene: PDF als Datei an das Vision-Modell; mit poppler als Bilder; Quelle «vision»", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields() }]));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const scan = await textPdf([[""]]);
  const { document } = await env.upload(scan, "scan.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  assert.equal(llm.calls.length, 1);
  const req = llm.calls[0]!;
  assert.equal(req.model, "gpt-4o");
  assert.equal(req.attachments?.[0]?.kind, "pdf");
  assert.equal(row(env, "SELECT text_source AS t FROM documents").t, "vision");
  assert.equal(row(env, "SELECT mode FROM ai_usage").mode, "vision");
  // Vision-Quelle: keine Textprüfung, Vorschlag trotzdem möglich
  assert.equal((await env.trip(tripId)).events.length, 1);

  const llm2 = new FakeLlm(() => extractionJson([]));
  const env2 = await ingestSetup({
    llm: llm2,
    analyzer: { render: async () => [Buffer.from("seite1"), Buffer.from("seite2")] },
  });
  const t2 = await env2.createTrip();
  await env2.upload(scan, "scan.pdf", t2);
  assert.deepEqual(llm2.calls[0]!.attachments!.map((a) => a.kind), ["image", "image"]);
});

test("Foto (PNG): Vision; HEIC ohne Umwandler → «übersprungen» mit klarem Hinweis", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Veranstaltung", fields: [["title", "Konzert Muster"], ["startDate", "2026-10-28"], ["startTime", "20:00"]] }]));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const { document } = await env.upload(png, "ticket.png", tripId);
  assert.equal(document.analysisStatus, "done");
  assert.equal(llm.calls[0]!.attachments![0]!.kind, "image");
  assert.equal((await env.trip(tripId)).events[0].type, "Veranstaltung");

  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
  const f = new FormData();
  f.set("file", new File([heic as BlobPart], "foto.heic"));
  await env.call("POST", `/v1/trips/${tripId}/documents`, { token: env.anna, form: f });
  await env.background.idle();
  const d = row(env, "SELECT analysis_status AS s, analysis_error AS e FROM documents WHERE file_name = 'foto.heic'");
  assert.equal(d.s, "skipped");
  assert.match(d.e, /HEIC/);
});

test("Datenschutz: Pass- und Kartennummern verlassen den Server nicht (Prompt, gespeicherter Text)", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields() }]));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = [...FLIGHT_TEXT, "Reisepass Nr: C01X00T47", "Zahlung mit Karte 4111 1111 1111 1111", "E-Ticket 724 2345678901"];
  const { document } = await env.upload(await textPdf([text]), "a.pdf", tripId);
  const sent = llm.calls[0]!.user;
  assert.ok(!sent.includes("C01X00T47"));
  assert.ok(!sent.includes("4111 1111 1111 1111"));
  assert.ok(sent.includes("724 2345678901"), "Ticketnummer bleibt");
  const stored = row(env, "SELECT text FROM documents WHERE id = ?", document.id).text as string;
  assert.ok(!stored.includes("C01X00T47") && !stored.includes("4111 1111"));
  const j = JSON.parse(row(env, "SELECT analysis_json AS j FROM documents WHERE id = ?", document.id).j);
  assert.deepEqual(j.masked, { passport: 1, card: 1, iban: 0 });
});

test("Lange Dokumente: Text wird seitenweise in Teile geschnitten, doppelte Ereignisse vereint", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields() }]));
  const env = await ingestSetup({ llm, analyzer: { maxChunkChars: 4000 } });
  const tripId = await env.createTrip();
  const filler = "Allgemeine Reisebedingungen und Hinweise zur Reise. ".repeat(2);
  const pages = [0, 1, 2].map((i) => [`Seite ${i + 1} ${FLIGHT_TEXT[3]}`, ...Array.from({ length: 60 }, (_, k) => `${filler} Zeile ${k}`).slice(0, 40)]);
  const { document } = await env.upload(await textPdf(pages), "lang.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  assert.ok(llm.calls.length >= 2, `Teile: ${llm.calls.length}`);
  assert.equal((await env.trip(tripId)).events.length, 1);
  assert.match(llm.calls[0]!.user, /=== Seite 1 ===/);
});

test("Erneute Analyse ist idempotent und lässt manuelle Änderungen unberührt", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields([["departureTerminal", "2"]]) }]));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  await env.call("PATCH", `/v1/trips/${tripId}/events/${ev.id}`, { token: env.anna, json: { details: { ...ev.details, departureTerminal: "1" } } });
  const r = await env.call("POST", `/v1/documents/${document.id}/analyze`, { token: env.anna });
  assert.equal(r.status, 202);
  await env.background.idle();
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 1);
  assert.equal(events[0].details.departureTerminal, "1");
  assert.equal(rows(env, "SELECT * FROM ai_usage").length, 2);
});

test("Benachrichtigung: fehlt notifier.review, bleibt es bei einer Logzeile (kein Absturz)", async () => {
  const llm = new FakeLlm(() => extractionJson([{ type: "Flug", fields: flightFields(), confidence: 0.6 }]));
  const logs: string[] = [];
  const env = await ingestSetup({ llm, analyzer: { notifier: {}, log: (m) => logs.push(m) } });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "a.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  assert.ok(logs.some((l) => /1 neue Vorschläge zu prüfen/.test(l)), logs.join("|"));
});

test("Zitate: nicht im Dokument auffindbare entfallen, falsche Seitenangaben werden korrigiert", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Flug",
        fields: [
          ...flightFields().filter(([k]) => k !== "startTime" && k !== "flightNumber"),
          ["startTime", "11:05", { quote: "Das steht so nirgends im Dokument", page: 1 }],
          ["flightNumber", "LX 86", { quote: "Flug LX 86 Zuerich", page: 2 }],
        ],
      },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  await env.upload(await textPdf([FLIGHT_TEXT, ["Zweite Seite mit Hinweisen zur Reise und zum Gepaeck, genug Text fuer die Erkennung der Textebene."]]), "a.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.fieldsMeta.startTime.quote, undefined, "erfundenes Zitat wird nicht gespeichert");
  assert.equal(ev.startTime, "11:05", "der Wert bleibt");
  assert.equal(ev.fieldsMeta.flightNumber.page, 1, "Seite aus dem Fundort korrigiert");
  assert.equal(ev.fieldsMeta.flightNumber.quote, "Flug LX 86 Zuerich");
});
