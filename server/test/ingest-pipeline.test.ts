import test from "node:test";
import assert from "node:assert/strict";
import { runPendingAnalyses } from "../src/ingest/analyzer";
import { IngestAnalyzer } from "../src/ingest/pipeline";
import { usageOfDocument } from "../src/ingest/usage";
import {
  FakeGeocoder, FakeLlm, extractionJson, ingestSetup, makeBcbp, rateLimited, textPdf, zipStored, type EventSpec,
} from "./ingest-fixtures";
import { LlmError } from "../src/ingest/openai";

const FLIGHT_TEXT = [
  "Flugbestaetigung Beispiel Air",
  "Buchungscode: ABC123",
  "Passagier: MUSTER/BERTA MRS   Ticket 724 2345678901",
  "Flug LX 86   Zuerich (ZRH) - Miami (MIA)",
  "Abflug 24.10.2026 11:05   Ankunft 24.10.2026 15:30",
  "Terminal 2   Sitz 12A   Economy Class",
  "Preis CHF 1234.50 bezahlt",
  "Bitte beachten Sie die Reisebestimmungen und Einreiseformalitaeten des Ziellandes.",
];

const flight = (over: Partial<EventSpec> = {}, extra: Array<[string, string, any?]> = []): EventSpec => ({
  type: "Flug",
  fields: [
    ["title", "Flug Zuerich - Miami"], ["startDate", "2026-10-24"], ["startTime", "11:05"], ["endDate", "2026-10-24"], ["endTime", "15:30"],
    ["bookingReference", "abc123"], ["flightNumber", "lx86"], ["airline", "Beispiel Air"], ["departureAirport", "ZRH"],
    ["arrivalAirport", "MIA"], ["departureTerminal", "2"], ["cabinClass", "Economy Class"], ["price", "1'234.50", { currency: "CHF" }],
    ["paymentStatus", "bezahlt"], ...extra,
  ],
  passengers: [{ name: "MUSTER/BERTA MRS", seat: "12A", ticketNumber: "724 2345678901" }],
  ...over,
});

const eventIds = (d: any) => d.eventIds as number[];
const row = (env: any, sql: string, ...p: unknown[]) => env.db.prepare(sql).get(...p) as any;

test("Flug: Text → bestätigtes Ereignis mit Zeitzonen aus IATA, Herkunft je Feld, verknüpft, Kosten protokolliert", async () => {
  const llm = new FakeLlm(() => extractionJson([flight()], { summary: "Flug ZRH-MIA am 24.10.2026" }));
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const { document } = await env.upload(await textPdf([FLIGHT_TEXT]), "flug.pdf", tripId);

  assert.equal(document.analysisStatus, "done");
  assert.equal(document.summary, "Flug ZRH-MIA am 24.10.2026");
  assert.equal(eventIds(document).length, 1);
  const { trip, events, travelers } = await env.trip(tripId);
  const ev = events[0];
  assert.equal(ev.type, "Flug");
  assert.equal(ev.startDate, "2026-10-24");
  assert.equal(ev.startTime, "11:05");
  assert.equal(ev.endTime, "15:30");
  assert.equal(ev.startTz, "Europe/Zurich");
  assert.equal(ev.endTz, "America/New_York");
  assert.equal(ev.bookingReference, "ABC123");
  assert.equal(ev.details.flightNumber, "LX 86");
  assert.equal(ev.details.cabinClass, "Economy");
  assert.equal(ev.priceMinor, 123450);
  assert.equal(ev.currency, "CHF");
  assert.equal(ev.paymentStatus, "paid");
  assert.equal(ev.status, "confirmed");
  assert.equal(ev.sourceDocumentId, document.id);
  assert.deepEqual(ev.documentIds, [document.id]);
  assert.ok(ev.lat != null, "Koordinaten des Abflughafens aus der IATA-Tabelle");
  assert.equal(ev.fieldsMeta.flightNumber.source, "document");
  assert.equal(ev.fieldsMeta.flightNumber.documentId, document.id);
  assert.equal(ev.fieldsMeta.flightNumber.page, 1);
  assert.equal(ev.fieldsMeta.flightNumber.confidence, 0.97);
  assert.equal(ev.fieldsMeta.flightNumber.quote, "lx86");
  assert.equal(ev.fieldsMeta.startTz.source, "derived");
  // Passagier ↔ Mitreisende, «Wer ist dabei»
  const berta = travelers.find((t) => t.displayName === "Berta Muster");
  assert.deepEqual(ev.details.passengers, [{ participantId: berta.id, seat: "12A", ticketNumber: "724 2345678901" }]);
  assert.deepEqual(ev.participantIds, [berta.id]);
  // Reisezeitraum unverändert, kein Review nötig
  assert.equal(trip.startDate, "2026-10-24");
  assert.equal(trip.endDate, "2026-11-07");
  assert.deepEqual(env.reviews, []);
  // Text und Quelle gespeichert, Kosten protokolliert
  const d = row(env, "SELECT text, text_source, analysis_model, analyzed_at, pages FROM documents WHERE id = ?", document.id);
  assert.equal(d.text_source, "pdf_text");
  assert.ok(d.text.includes("=== Seite 1 ===") && d.text.includes("Flug LX 86"));
  assert.equal(d.analysis_model, "gpt-4o-mini");
  const u = usageOfDocument(env.db, document.id);
  assert.equal(u.calls, 1);
  assert.equal(u.inputTokens, 1200);
  assert.ok(u.costMicroUsd > 0);
  assert.equal(row(env, "SELECT mode, purpose FROM ai_usage").mode, "text");
});

test("Hotel: Adresse getrennt vom Ortsnamen, Geokodierung, Zone aus Koordinaten, Katalogwerte normalisiert", async () => {
  const geocoder = new FakeGeocoder([["Collins Ave", 25.7907, -80.1300]]);
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Hotel",
        fields: [
          ["title", "Hotel Strandhaus"], ["location", "Strandhaus Miami Beach"], ["address", "Collins Ave 100, 33139 Miami Beach, USA"],
          ["provider", "Strandhaus Hotels"], ["startDate", "2026-10-24"], ["endDate", "2026-10-31"], ["startTime", "3:00 PM"],
          ["checkInFrom", "15:00"], ["checkOutUntil", "11:00"], ["bookingReference", "H-77881"], ["board", "Bed & Breakfast"],
          ["roomType", "Doppelzimmer"], ["price", "1890.00", { currency: "USD" }], ["cancelUntil", "2026-10-20"],
          ["confirmationNumber", "77881"],
        ],
        addressParts: { street: "Collins Ave 100", postalCode: "33139", city: "Miami Beach", country: "USA" },
      },
    ])
  );
  const env = await ingestSetup({ llm, geocoder });
  const tripId = await env.createTrip();
  const text = ["Hotelbestaetigung Strandhaus", "Strandhaus Miami Beach, Collins Ave 100, 33139 Miami Beach", "Reservierungsnummer H-77881 Bestaetigung 77881", "Anreise 24.10.2026 ab 15:00 Abreise 31.10.2026 bis 11:00", "Doppelzimmer inklusive Fruehstueck, Preis USD 1890.00", "Kostenlose Stornierung bis 20.10.2026."];
  const { document } = await env.upload(await textPdf([text]), "hotel.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.location, "Strandhaus Miami Beach");
  assert.equal(ev.address, "Collins Ave 100, 33139 Miami Beach, USA");
  assert.equal(ev.details.board, "Fruehstueck");
  assert.equal(ev.priceMinor, 189000);
  assert.equal(ev.currency, "USD");
  assert.equal(ev.cancelUntil, "2026-10-20");
  assert.equal(ev.startTime, "15:00");
  assert.equal(ev.lat, 25.7907);
  assert.equal(ev.fieldsMeta.lat.source, "geocoded");
  assert.equal(ev.startTz, "America/New_York", "Zone aus den geokodierten Koordinaten (weicht von der Reisezone ab)");
  assert.equal(ev.fieldsMeta.startTz.source, "derived");
  assert.equal(ev.places.length, 1);
  assert.equal(ev.places[0].address, "Collins Ave 100, 33139 Miami Beach, USA");
  assert.equal(ev.places[0].lat, 25.7907);
  assert.ok(geocoder.queries.some((q) => q.includes("Collins Ave 100")));
});

test("Mietwagen: Abholung ≠ Rückgabe, je eigene Adresse, beide geokodiert, beide Marker in places[]", async () => {
  const geocoder = new FakeGeocoder([["NW 25th", 25.79, -80.28], ["1500 Collins", 25.78, -80.13]]);
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Mietauto",
        fields: [
          ["title", "Mietwagen Miami"], ["provider", "Beispiel Autovermietung"], ["bookingReference", "RC-4411"],
          ["startDate", "2026-10-24"], ["startTime", "17:30"], ["endDate", "2026-10-31"], ["endTime", "10:00"],
          ["pickupPlace", "Miami Airport Station"], ["pickupAddress", "3900 NW 25th St, Miami FL 33142"],
          ["returnPlace", "Miami Beach Station"], ["returnAddress", "1500 Collins Ave, Miami Beach FL 33139"],
          ["vehicleCategory", "Kompakt SUV"], ["transmission", "Automatic"], ["deposit", "300.00", { currency: "USD" }],
          ["emergencyPhone", "+1 800 555 0100"],
        ],
      },
    ])
  );
  const env = await ingestSetup({ llm, geocoder });
  const tripId = await env.createTrip();
  const text = ["Mietwagen-Voucher Beispiel Autovermietung", "Reservierungsnummer RC-4411", "Abholung: Miami Airport Station, 3900 NW 25th St, Miami FL 33142, 24.10.2026 17:30", "Rueckgabe: Miami Beach Station, 1500 Collins Ave, Miami Beach FL 33139, 31.10.2026 10:00", "Kompakt SUV, Automatic, Kaution USD 300.00 Notfall +1 800 555 0100"];
  await env.upload(await textPdf([text]), "auto.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.type, "Mietauto");
  assert.equal(ev.details.transmission, "Automat");
  assert.equal(ev.details.depositMinor, 30000);
  assert.equal(ev.details.pickupPlace, "Miami Airport Station");
  assert.equal(ev.details.pickupAddress, "3900 NW 25th St, Miami FL 33142");
  assert.equal(ev.details.returnPlace, "Miami Beach Station", "Ortsname ohne Adresse");
  assert.equal(ev.details.returnAddress, "1500 Collins Ave, Miami Beach FL 33139");
  assert.equal(ev.address, "3900 NW 25th St, Miami FL 33142", "Hauptadresse = Abholung");
  assert.deepEqual(ev.places.map((p: any) => [p.role, p.label, p.address]), [
    ["pickup", "Miami Airport Station", "3900 NW 25th St, Miami FL 33142"],
    ["return", "Miami Beach Station", "1500 Collins Ave, Miami Beach FL 33139"],
  ]);
  assert.deepEqual(ev.places.map((p: any) => [p.lat, p.lon]), [[25.79, -80.28], [25.78, -80.13]]);
  assert.ok(geocoder.queries.includes("3900 NW 25th St, Miami FL 33142"));
  assert.ok(geocoder.queries.includes("1500 Collins Ave, Miami Beach FL 33139"));
  assert.equal(ev.fieldsMeta.lat.source, "geocoded");
});

test("Orte: Adressfelder je Ort (Katalog 2) für Transfer, Zug, Veranstaltung und Kreuzfahrt; alte Angaben ohne Adressfeld bleiben gültig", async () => {
  const { derivePlaces } = await import("../src/trips/places");
  const base = { lat: null, lon: null, placeCoords: {}, latSource: null } as const;
  const roles = (e: Parameters<typeof derivePlaces>[0]) => derivePlaces(e).map((p) => [p.role, p.label, p.address]);
  assert.deepEqual(
    roles({ ...base, type: "Transfer", location: null, address: null, details: { originPlace: "Hafen", originAddress: "Moll de Barcelona 1", destinationPlace: "Hotel Hafen", destinationAddress: "Hafenstrasse 1, Barcelona" } }),
    [["start", "Hafen", "Moll de Barcelona 1"], ["end", "Hotel Hafen", "Hafenstrasse 1, Barcelona"]]
  );
  assert.deepEqual(
    roles({ ...base, type: "Zugreisen", location: null, address: null, details: { originPlace: "Zuerich HB", originAddress: "Bahnhofplatz, 8001 Zuerich", destinationAddress: "Bahnhofplatz 10, 3011 Bern" } }),
    [["start", "Zuerich HB", "Bahnhofplatz, 8001 Zuerich"], ["end", null, "Bahnhofplatz 10, 3011 Bern"]]
  );
  assert.deepEqual(
    roles({ ...base, type: "Veranstaltung", location: null, address: "Alte Adresse 1", details: { venue: "Arena", venueAddress: "Arenaweg 5, Miami" } }),
    [["venue", "Arena", "Arenaweg 5, Miami"]]
  );
  assert.deepEqual(
    roles({ ...base, type: "Kreuzfahrt", location: "Palma de Mallorca", address: null, details: { terminalAddress: "Moll Vell, 07012 Palma" } }),
    [["stop", "Palma de Mallorca", "Moll Vell, 07012 Palma"]]
  );
  // Ohne Adressfelder: wie bisher (Adresse des Ereignisses für den ersten Ort)
  assert.deepEqual(
    roles({ ...base, type: "Mietauto", location: null, address: "Flughafenstr. 1", details: { pickupPlace: "Station A", returnPlace: "Station B" } }),
    [["pickup", "Station A", "Flughafenstr. 1"], ["return", "Station B", null]]
  );
});

test("Kreuzfahrt-Reiseplan: Einschiffung, Häfen, Seetag, Ausschiffung als Einträge (entryKind), ohne Dubletten", async () => {
  const mk = (kind: string, date: string, loc: string | null, extra: Array<[string, string, any?]> = []): EventSpec => ({
    type: "Kreuzfahrt",
    fields: [
      ["title", loc ? `${kind} ${loc}` : kind], ["entryKind", kind], ["startDate", date], ["bookingReference", "KF-9001"], ["ship", "MS Beispiel"],
      ...(loc ? ([["location", loc]] as Array<[string, string]>) : []), ...extra,
    ],
  });
  const llm = new FakeLlm(() =>
    extractionJson([
      mk("Cruise", "2026-10-31", null, [["cabin", "8212"], ["endDate", "2026-11-06"], ["price", "3490.00", { currency: "EUR" }]]),
      mk("Embarkation", "2026-10-31", "Palma de Mallorca", [["startTime", "14:00"], ["allAboard", "17:30"], ["terminal", "Terminal 2"]]),
      mk("Port of call", "2026-11-01", "Barcelona", [["startTime", "08:00"], ["endTime", "18:00"], ["allAboard", "17:30"]]),
      mk("Sea day", "2026-11-02", null),
      mk("Port of call", "2026-11-03", "Marseille", [["startTime", "09:00"], ["endTime", "19:00"], ["tender", "ja"]]),
      mk("Disembarkation", "2026-11-06", "Palma de Mallorca", [["startTime", "08:00"]]),
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["Reiseplan MS Beispiel Buchung KF-9001", "Kabine 8212", "31.10.2026 Palma de Mallorca Einschiffung 14:00 All aboard 17:30", "01.11.2026 Barcelona 08:00-18:00", "02.11.2026 Seetag", "03.11.2026 Marseille 09:00-19:00 Tender", "06.11.2026 Palma de Mallorca Ausschiffung 08:00", "Preis EUR 3490.00"];
  const { document } = await env.upload(await textPdf([text]), "reiseplan.pdf", tripId);
  assert.equal(document.analysisStatus, "done");
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 6);
  const kinds = events.map((e: any) => e.details.entryKind).sort();
  assert.deepEqual(kinds, ["Ausschiffung", "Einschiffung", "Hafen", "Hafen", "Reise", "Seetag"]);
  const port = events.find((e: any) => e.location === "Marseille");
  assert.equal(port.details.tender, true);
  const board = events.find((e: any) => e.details.entryKind === "Einschiffung");
  assert.equal(board.details.allAboard, "17:30");
  assert.equal(board.details.terminal, "Terminal 2");
  assert.equal(eventIds(document).length, 6);
  // Erneute Analyse legt keine Dubletten an
  await env.call("POST", `/v1/documents/${document.id}/analyze`, { token: env.anna });
  await env.background.idle();
  assert.equal((await env.trip(tripId)).events.length, 6);
});

test("Zug: Alias «Zug» → Zugreisen, Klasse aus «2. Klasse», Gleis, Bahnhöfe", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Zug",
        fields: [
          ["title", "Zuerich HB - Bern"], ["startDate", "2026-10-23"], ["startTime", "08:02"], ["endTime", "08:58"], ["trainNumber", "IC 8"],
          ["originPlace", "Zuerich HB"], ["destinationPlace", "Bern"], ["departurePlatform", "7"], ["cabinClass", "2. Klasse"],
          ["bookingReference", "SBB-5543"], ["operator", "SBB"],
        ],
        passengers: [{ name: "MUSTER/CARL", coach: "3", seat: "45" }],
      },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["SBB Ticket Sparbillett", "Auftragsnummer SBB-5543", "Zug IC 8 Zuerich HB ab 08:02 Gleis 7 - Bern an 08:58", "Wagen 3 Sitz 45 2. Klasse 23.10.2026 MUSTER/CARL"];
  await env.upload(await textPdf([text]), "zug.pdf", tripId);
  const ev = (await env.trip(tripId)).events[0];
  assert.equal(ev.type, "Zugreisen");
  assert.equal(ev.details.cabinClass, "Economy");
  assert.equal(ev.details.departurePlatform, "7");
  assert.equal(ev.details.trainNumber, "IC 8");
  assert.equal(ev.details.passengers[0].coach, "3");
});

test("Pauschalreise: mehrere Ereignisse je PDF, Gesamtpreis nur einmal", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([
      { type: "Flug", fields: [["startDate", "2026-10-24"], ["startTime", "11:05"], ["flightNumber", "LX 86"], ["departureAirport", "ZRH"], ["arrivalAirport", "MIA"], ["bookingReference", "PKG777"]] },
      { type: "Flug", fields: [["startDate", "2026-11-07"], ["startTime", "17:40"], ["flightNumber", "LX 87"], ["departureAirport", "MIA"], ["arrivalAirport", "ZRH"], ["bookingReference", "PKG777"]] },
      { type: "Hotel", fields: [["title", "Hotel Strandhaus"], ["startDate", "2026-10-24"], ["endDate", "2026-11-07"], ["price", "4980.00", { currency: "CHF" }], ["bookingReference", "PKG777"]] },
      { type: "Transfer", fields: [["title", "Transfer Flughafen - Hotel"], ["startDate", "2026-10-24"], ["startTime", "16:30"], ["transferKind", "Shuttle"], ["bookingReference", "PKG777"]] },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["Pauschalreise Miami Buchungsnummer PKG777", "Hinflug LX 86 ZRH MIA 24.10.2026 11:05", "Rueckflug LX 87 MIA ZRH 07.11.2026 17:40", "Hotel Strandhaus 24.10.2026 bis 07.11.2026", "Transfer Flughafen Hotel 24.10.2026 16:30", "Gesamtpreis CHF 4980.00"];
  const { document } = await env.upload(await textPdf([text]), "pauschal.pdf", tripId);
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((e: any) => e.type).sort(), ["Flug", "Flug", "Hotel", "Transfer"]);
  assert.equal(events.filter((e: any) => e.priceMinor != null).length, 1);
  assert.equal(events.find((e: any) => e.type === "Transfer").details.transferKind, "Shuttle");
  assert.equal(eventIds(document).length, 4);
  // Flug mit gleicher Buchung am selben Tag bleibt vom Hotel getrennt (Familie)
  assert.equal(events.filter((e: any) => e.bookingReference === "PKG777").length, 4);
});

test("Barcode gewinnt: widersprechende KI-Werte werden ersetzt und markiert (needsReview), Sitz aus dem Barcode", async () => {
  const bcbp = makeBcbp({ name: "MUSTER/BERTA MRS", pnr: "ABC123", from: "ZRH", to: "MIA", flight: "0086", doy: 297, seat: "012A" });
  const llm = new FakeLlm(() =>
    extractionJson([
      {
        type: "Flug",
        fields: [
          ["title", "Flug Zuerich - Miami"], ["startDate", "2026-10-24"], ["startTime", "11:05"], ["flightNumber", "LX 87"],
          ["bookingReference", "XYZ789"], ["departureAirport", "ZRH"], ["arrivalAirport", "MIA"],
        ],
      },
    ])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const text = ["Mobile Bordkarte", bcbp, "Flug LX 86 ZRH MIA 24.10.2026 Abflug 11:05", "Buchungscode ABC123 Passagier MUSTER/BERTA MRS Sitz 12A"];
  const { document } = await env.upload(await textPdf([text]), "bordkarte.pdf", tripId);
  const { events, travelers } = await env.trip(tripId);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.details.flightNumber, "LX 86");
  assert.equal(ev.bookingReference, "ABC123");
  assert.equal(ev.status, "needs_review");
  assert.equal(ev.fieldsMeta.flightNumber.needsReview, true);
  assert.ok(ev.fieldsMeta.flightNumber.quote.startsWith("BCBP"), JSON.stringify(ev.fieldsMeta.flightNumber));
  const berta = travelers.find((t) => t.displayName === "Berta Muster");
  assert.equal(ev.details.passengers[0].participantId, berta.id);
  assert.equal(ev.details.passengers[0].seat, "12A");
  const j = JSON.parse(row(env, "SELECT analysis_json AS j FROM documents WHERE id = ?", document.id).j);
  assert.ok(j.events[0].issues.some((i: any) => i.code === "barcode_conflict" && i.field === "flightNumber"));
});

test("Ohne KI-Aufruf: ICS-Termine werden Vorschläge (proposed), Zeitzone aus TZID; Dokument «übersprungen» mit Hinweis", async () => {
  const env = await ingestSetup({ llm: null });
  const tripId = await env.createTrip();
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:a1", "SUMMARY:Abendessen Casa Muster", "DTSTART;TZID=America/New_York:20261025T190000", "DTEND;TZID=America/New_York:20261025T210000", "LOCATION:Casa Muster\\, Miami", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a2", "SUMMARY:Stadtrundfahrt Miami", "DTSTART;TZID=America/New_York:20261026T100000", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n");
  const { document } = await env.upload(new TextEncoder().encode(ics), "termine.ics", tripId);
  assert.equal(document.analysisStatus, "skipped");
  assert.match(document.analysisError, /^KI nicht konfiguriert/);
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 2);
  const dinner = events.find((e: any) => e.title.startsWith("Abendessen"));
  assert.equal(dinner.type, "Restaurant");
  assert.equal(dinner.status, "proposed");
  assert.equal(dinner.startTime, "19:00");
  assert.equal(dinner.startTz, "America/New_York");
  assert.equal(dinner.location, "Casa Muster, Miami");
  assert.equal(dinner.fieldsMeta.startTime.source, "document");
  assert.deepEqual(env.reviews, [[tripId, 2]]);
});

test("ICS mit KI: Kalenderzeit schlägt KI-Zeit und markiert das Feld", async () => {
  const llm = new FakeLlm(() =>
    extractionJson([{ type: "Ausflug", fields: [["title", "Stadtrundfahrt Miami"], ["startDate", "2026-10-26"], ["startTime", "10:30"], ["provider", "Beispiel Tours"]] }])
  );
  const env = await ingestSetup({ llm });
  const tripId = await env.createTrip();
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:a2", "SUMMARY:Stadtrundfahrt Miami", "DTSTART;TZID=America/New_York:20261026T100000", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  await env.upload(new TextEncoder().encode(ics), "tour.ics", tripId);
  const { events } = await env.trip(tripId);
  assert.equal(events.length, 1);
  assert.equal(events[0].startTime, "10:00");
  assert.equal(events[0].startTz, "America/New_York");
  assert.equal(events[0].details.meetingPoint, undefined);
  assert.equal(events[0].provider, "Beispiel Tours");
  assert.equal(events[0].fieldsMeta.startTime.needsReview, true);
  assert.equal(events[0].status, "needs_review");
});

test("Wallet-Pass (.pkpass) ohne KI: Bordkarte → Flug mit Strecke, PNR, Sitz und Zonen", async () => {
  const pass = {
    formatVersion: 1, organizationName: "Beispiel Air", description: "Bordkarte LX 86", relevantDate: "2026-10-24T11:05:00+02:00",
    barcodes: [{ format: "PKBarcodeFormatAztec", message: makeBcbp(), messageEncoding: "iso-8859-1" }],
    boardingPass: { transitType: "PKTransitTypeAir", primaryFields: [{ key: "origin", label: "Zuerich", value: "ZRH" }] },
  };
  const env = await ingestSetup({ llm: null });
  const tripId = await env.createTrip();
  const { document } = await env.upload(zipStored({ "pass.json": JSON.stringify(pass) }), "bordkarte.pkpass", tripId);
  assert.equal(document.analysisStatus, "skipped");
  const { events, travelers } = await env.trip(tripId);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.type, "Flug");
  assert.equal(ev.details.flightNumber, "LX 86");
  assert.equal(ev.bookingReference, "ABC123");
  assert.equal(ev.startDate, "2026-10-24");
  assert.equal(ev.startTz, "Europe/Zurich");
  assert.equal(ev.status, "proposed", "nur aus dem Pass: nie automatisch bestätigt");
  assert.equal(ev.details.passengers[0].seat, "12A");
  assert.equal(ev.details.passengers[0].participantId, travelers.find((t) => t.displayName === "Berta Muster").id);
});
