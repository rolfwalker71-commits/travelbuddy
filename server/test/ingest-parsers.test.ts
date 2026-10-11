import test from "node:test";
import assert from "node:assert/strict";
import { bcbpDate, findBcbpInText, parseBcbp } from "../src/ingest/bcbp";
import { maskSensitive } from "../src/ingest/mask";
import { parseIcs, icsCandidates, icsToText } from "../src/ingest/icsparse";
import { parsePkpass } from "../src/ingest/pkpass";
import { currencyOf, normDate, normFlightNumber, normSelect, normTime, parseAmountMinor } from "../src/ingest/values";
import { buildExtractionSchema, extractionKeys, keyReference } from "../src/ingest/schema";
import { chunkPages, parseExtraction } from "../src/ingest/extraction";
import { getCatalog } from "../src/catalog/catalog";
import { flightNumberCandidates, referenceCandidates, nameSimilarity } from "../src/ingest/crosscheck";
import { loadSource } from "../src/ingest/source";
import { BCBP, textPdf, zipStored } from "./ingest-fixtures";

test("BCBP: Abschnitt, Sitz ohne führende Nullen, Flugnummer, Jahr nahe am Referenzdatum", () => {
  assert.equal(BCBP.length, 60);
  const [leg] = parseBcbp(BCBP);
  assert.ok(leg);
  assert.equal(leg.passengerName, "MUSTER/ANNA MRS");
  assert.equal(leg.pnr, "ABC123");
  assert.equal(leg.from, "ZRH");
  assert.equal(leg.to, "MIA");
  assert.equal(leg.flightNumber, "LX 86");
  assert.equal(leg.seat, "12A");
  assert.equal(leg.dayOfYear, 297);
  assert.equal(bcbpDate(297, "2026-10-01"), "2026-10-24");
  assert.equal(bcbpDate(5, "2026-12-28"), "2027-01-05", "Jahreswechsel: nächstes Jahr liegt näher");
  assert.equal(bcbpDate(366, "2026-12-30"), null, "Tag 366 gibt es 2025 bis 2027 nicht");
  assert.equal(bcbpDate(366, "2028-06-01"), "2028-12-31");
});

test("BCBP: zwei Abschnitte, Text mit Umgebung, Zeilenumbruch im Barcode", () => {
  const leg2 = "DEF456 " + "MIA" + "ZRH" + "LX " + "0087 " + "304" + "Y" + "021C" + "0002 " + "1" + "00";
  const two = "M2" + "MUSTER/ANNA MRS".padEnd(20) + "E" + "ABC123 ZRHMIALX 0086 297Y012A0001 100" + leg2;
  const legs = parseBcbp(two);
  assert.equal(legs.length, 2);
  assert.equal(legs[1]!.flightNumber, "LX 87");
  assert.equal(legs[1]!.seat, "21C");
  const text = `Ihre Bordkarte\nBarcode: ${BCBP.slice(0, 30)}\n${BCBP.slice(30)}\nGute Reise`;
  const found = findBcbpInText(text);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.pnr, "ABC123");
  assert.deepEqual(findBcbpInText("Kein Barcode, nur Text M1 und etwas Rauschen"), []);
});

test("maskieren: Pass- und Kartennummern, IBAN; Ticketnummern und BCBP bleiben", () => {
  const input = [
    "Reisepass Nr: C01X00T47 gültig bis 2030",
    "Passport number: X1234567",
    "Kreditkarte 4111 1111 1111 1111 (Visa)",
    "IBAN CH93 0076 2011 6238 5295 7",
    "E-Ticket 724 2345678901 und Buchung ABC123",
    BCBP,
  ].join("\n");
  const r = maskSensitive(input);
  assert.ok(!r.text.includes("C01X00T47"));
  assert.ok(!r.text.includes("X1234567"));
  assert.ok(!r.text.includes("4111 1111 1111 1111"));
  assert.ok(r.text.includes("**** **** **** 1111"));
  assert.ok(!r.text.includes("0076 2011 6238"));
  assert.ok(r.text.includes("724 2345678901"), "Ticketnummer unverändert");
  assert.ok(r.text.includes("ABC123"));
  assert.ok(r.text.includes(BCBP), "BCBP unverändert");
  assert.deepEqual(r.masked, { passport: 2, card: 1, iban: 1 });
});

test("Werte: Beträge in Minor Units, Daten, Zeiten, Flugnummer, Währung", () => {
  assert.equal(parseAmountMinor("CHF 1’234.50"), 123450);
  assert.equal(parseAmountMinor("1.234,50 €"), 123450);
  assert.equal(parseAmountMinor("1,234.50"), 123450);
  assert.equal(parseAmountMinor("89,9"), 8990);
  assert.equal(parseAmountMinor("1.234"), 123400);
  assert.equal(parseAmountMinor("0.50"), 50);
  assert.equal(parseAmountMinor("gratis"), null);
  assert.equal(currencyOf("1234.50 €"), "EUR");
  assert.equal(currencyOf("usd"), "USD");
  assert.equal(currencyOf("Fr. 40"), "CHF");
  assert.equal(normDate("24.10.2026"), "2026-10-24");
  assert.equal(normDate("24 Oktober 2026"), "2026-10-24");
  assert.equal(normDate("October 24, 2026"), "2026-10-24");
  assert.equal(normDate("2026-02-30"), null);
  assert.equal(normTime("7:05 PM"), "19:05");
  assert.equal(normTime("19.05 Uhr"), "19:05");
  assert.equal(normTime("1730"), "17:30");
  assert.equal(normTime("25:00"), null);
  assert.equal(normFlightNumber("lx1952"), "LX 1952");
  assert.equal(normFlightNumber("LX 0086"), "LX 86");
  assert.equal(normFlightNumber("nur Text"), null);
});

test("Auswahlwerte: Synonyme auf Katalog-Optionen, sonst null", () => {
  const cat = getCatalog();
  const hotel = cat.type("Hotel")!;
  const board = hotel.fields.get("board")!;
  assert.equal(normSelect(board, "Bed & Breakfast"), "Fruehstueck");
  assert.equal(normSelect(board, "Frühstück"), "Fruehstueck");
  assert.equal(normSelect(board, "Half board"), "Halbpension");
  assert.equal(normSelect(board, "All Inclusive"), "All inclusive");
  assert.equal(normSelect(board, "Zimmer ohne Verpflegung"), null);
  const cabin = cat.type("Flug")!.fields.get("cabinClass")!;
  assert.equal(normSelect(cabin, "Economy Class"), "Economy");
  assert.equal(normSelect(cabin, "Premium Economy"), "Premium Economy");
  assert.equal(normSelect(cabin, "Business Class"), "Business");
  const train = cat.type("Zugreisen")!.fields.get("cabinClass")!;
  assert.equal(normSelect(train, "2. Klasse"), "Economy");
  assert.equal(normSelect(train, "1. Klasse"), "First");
  const kind = cat.type("Kreuzfahrt")!.fields.get("entryKind")!;
  assert.equal(normSelect(kind, "Disembarkation"), "Ausschiffung");
  assert.equal(normSelect(kind, "Embarkation"), "Einschiffung");
  assert.equal(normSelect(kind, "Sea day"), "Seetag");
  assert.equal(normSelect(kind, "Port of call"), "Hafen");
  const transfer = cat.type("Transfer")!.fields.get("transferKind")!;
  assert.equal(normSelect(transfer, "Ferry"), "Faehre");
});

test("ICS: TZID bleibt Ortszeit, UTC wird in die Zone umgerechnet, ganztägig, Text und Kandidaten", () => {
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:1@x", "SUMMARY:Flug LX 86 Zürich – Miami", "DTSTART;TZID=Europe/Zurich:20261024T110500", "DTEND;TZID=America/New_York:20261024T153000",
    "LOCATION:Flughafen Zürich", "DESCRIPTION:Check-in ab 08:30\\, Terminal 2", "END:VEVENT",
    "BEGIN:VEVENT", "UID:2@x", "SUMMARY:Abendessen Casa Muster", "DTSTART:20261025T170000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:3@x", "SUMMARY:Hotel Strandhaus", "DTSTART;VALUE=DATE:20261024", "DTEND;VALUE=DATE:20261028", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const ev = parseIcs(ics, { defaultTz: "Europe/Zurich" });
  assert.equal(ev.length, 3);
  assert.deepEqual([ev[0]!.start.date, ev[0]!.start.time, ev[0]!.start.tz], ["2026-10-24", "11:05", "Europe/Zurich"]);
  assert.deepEqual([ev[0]!.end!.time, ev[0]!.end!.tz], ["15:30", "America/New_York"]);
  assert.equal(ev[0]!.description, "Check-in ab 08:30, Terminal 2");
  // 17:00 UTC am 25.10.2026 = 18:00 in Zürich (die Sommerzeit endet am 25.10. um 03:00, danach UTC+1)
  assert.deepEqual([ev[1]!.start.date, ev[1]!.start.time], ["2026-10-25", "18:00"]);
  assert.equal(ev[2]!.allDay, true);
  assert.equal(ev[2]!.end!.date, "2026-10-27", "Ende ganztägig ist exklusiv");
  const c = icsCandidates(ev);
  assert.equal(c[0]!.type, "Flug");
  assert.equal(c[1]!.type, "Restaurant");
  assert.equal(c[2]!.type, "Hotel");
  assert.ok(icsToText(ev).includes("Termin 1: Flug LX 86"));
});

test("pkpass: pass.json lesen, BCBP-Barcode → Flug-Kandidat, Textfassung", () => {
  const pass = {
    formatVersion: 1, organizationName: "Beispiel Air", description: "Bordkarte", relevantDate: "2026-10-24T11:05:00+02:00",
    barcodes: [{ format: "PKBarcodeFormatAztec", message: BCBP, messageEncoding: "iso-8859-1" }],
    boardingPass: {
      transitType: "PKTransitTypeAir",
      primaryFields: [{ key: "origin", label: "Zürich", value: "ZRH" }, { key: "destination", label: "Miami", value: "MIA" }],
      auxiliaryFields: [{ key: "gate", label: "Gate", value: "A12" }],
    },
  };
  const zip = zipStored({ "pass.json": JSON.stringify(pass), "icon.png": "x" });
  const r = parsePkpass(zip)!;
  assert.equal(r.kind, "boardingPass");
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0]!;
  assert.equal(c.fields.flightNumber, "LX 86");
  assert.equal(c.fields.bookingReference, "ABC123");
  assert.equal(c.fields.startDate, "2026-10-24", "relevantDate bestätigt den Tag");
  assert.equal(c.passenger?.seat, "12A");
  assert.ok(r.text.includes("Gate: A12"));
  assert.equal(parsePkpass(Buffer.from("kein zip")), null);
  const deflated = parsePkpass(zipStored({ "pass.json": JSON.stringify(pass) }, { deflate: true }))!;
  assert.equal(deflated.candidates[0]!.fields.flightNumber, "LX 86", "auch komprimierte Einträge werden gelesen");
});

test("Schema: aus dem Katalog erzeugt, strikt (alle Objekte geschlossen und vollständig), Schlüssel je Typ", () => {
  const cat = getCatalog();
  const { schema } = buildExtractionSchema(cat);
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const types = Array.isArray(o.type) ? o.type : [o.type];
    if (types.includes("object")) {
      const props = Object.keys((o.properties as object) ?? {});
      if (o.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
      const req = (o.required as string[]) ?? [];
      if (JSON.stringify([...req].sort()) !== JSON.stringify([...props].sort())) problems.push(`${path}: required ≠ properties`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk(schema, "$");
  assert.deepEqual(problems, []);
  const keys = extractionKeys(cat);
  for (const k of ["flightNumber", "departureAirport", "price", "bookingReference", "entryKind", "board", "deposit", "touristTax", "pickupPlace", "returnPlace", "cancelUntil", "startTz"]) {
    assert.ok(keys.has(k), `Schlüssel ${k} fehlt`);
  }
  assert.ok(!keys.has("passengers"));
  assert.ok(!keys.has("priceMinor"), "Geldfelder heissen im Schema ohne «Minor»");
  assert.ok(!keys.has("participantIds"));
  const props = (schema.properties as any).events.items.properties;
  assert.deepEqual(props.type.enum, cat.typeIds);
  assert.ok(props.fields.items.properties.key.enum.includes("flightNumber"));
  const ref = keyReference(cat);
  assert.ok(ref.includes("TYP «Flug»") && ref.includes("TYP «Kreuzfahrt»") && ref.includes("Fruehstueck"));
  // Jeder Detail-Schlüssel jedes Typs ist über das Schema erreichbar
  for (const t of cat.types.values()) for (const [key, def] of t.fields) {
    if (def.kind === "passengers") continue;
    assert.ok(keys.has(def.kind === "money" ? key.replace(/Minor$/, "") : key), `${t.id}.${key} fehlt im Schema`);
  }
});

test("Extraktion lesen: Struktur, Zahlen als Text, ungültig → Probleme, Teile", () => {
  const cat = getCatalog();
  const ok = parseExtraction(
    "```json\n" + JSON.stringify({ summary: "Flug", documentKind: null, trip: {}, events: [{ type: "Flug", confidence: 0.9, fields: [{ key: "durationMinutes", value: 640, confidence: "0.8", page: "1", quote: null, currency: null }] }] }) + "\n```",
    cat
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.events[0]!.fields[0]!.value, "640");
    assert.equal(ok.value.events[0]!.fields[0]!.confidence, 0.8);
    assert.equal(ok.value.events[0]!.fields[0]!.page, 1);
  }
  const bad = parseExtraction(JSON.stringify({ events: [{ fields: [] }] }), cat);
  assert.equal(bad.ok, false);
  assert.equal(parseExtraction("kein json", cat).ok, false);
  assert.equal(parseExtraction("[1]", cat).ok, false);
  const pages = [1, 2, 3, 4].map((n) => ({ page: n, text: "x".repeat(400) }));
  assert.deepEqual(chunkPages(pages, 900).map((c) => c.map((p) => p.page)), [[1, 2], [3, 4]]);
});

test("Regeln: Flugnummern nur mit bekanntem Präfix, Buchungscodes neben Stichwörtern, Namensähnlichkeit", () => {
  assert.deepEqual(flightNumberCandidates("Flug LX 1952 am 24.10.2026, Zimmer HB 12, Seite A4 11"), ["LX 1952"]);
  assert.deepEqual(referenceCandidates("Buchungscode: QWE456\nBuchungsnummer 1234567890\nReferenz: Nummer"), ["QWE456", "1234567890"]);
  assert.ok(nameSimilarity("Hotel Negresco Princess", "Negresco Princess Hotel & Spa") >= 0.6);
  assert.ok(nameSimilarity("Hotel Alpenblick", "Strandhaus Muster") < 0.3);
});

test("Quelle: PDF mit Textebene seitenweise, Scan (ohne Text) → Vision mit PDF als Datei, Bild → Vision", async () => {
  const withText = await textPdf([["Flugbestaetigung LX 86 Zuerich nach Miami", "Abflug 24.10.2026 11:05 Buchungscode ABC123 und mehr Text damit es genug ist " + "x".repeat(60)], ["Seite zwei: Hotel Strandhaus Check-in 15:00 " + "y".repeat(60)]]);
  const s = await loadSource({ contentType: "application/pdf", fileName: "a.pdf", bytes: withText, filePath: "" }, { defaultTz: "Europe/Zurich" });
  assert.equal(s.needsVision, false);
  assert.equal(s.pages.length, 2);
  assert.equal(s.pageCount, 2);
  assert.ok(s.pages[0]!.text.includes("Flugbestaetigung LX 86"));
  assert.ok(s.pages[1]!.text.includes("Strandhaus"));
  assert.equal(s.textSource, "pdf_text");

  const scan = await textPdf([[""]]);
  const sc = await loadSource({ contentType: "application/pdf", fileName: "scan.pdf", bytes: scan, filePath: "" }, { defaultTz: "Europe/Zurich", render: null });
  assert.equal(sc.needsVision, true);
  assert.equal(sc.attachments[0]?.kind, "pdf");
  assert.equal(sc.textSource, "vision");

  const rendered = await loadSource(
    { contentType: "application/pdf", fileName: "scan.pdf", bytes: scan, filePath: "/x" },
    { defaultTz: "Europe/Zurich", render: async () => [Buffer.from("jpeg1"), Buffer.from("jpeg2")] }
  );
  assert.deepEqual(rendered.attachments.map((a) => a.kind), ["image", "image"]);

  const img = await loadSource({ contentType: "image/png", fileName: "foto.png", bytes: new Uint8Array([1, 2, 3]), filePath: "" }, { defaultTz: "Europe/Zurich" });
  assert.equal(img.needsVision, true);
  assert.equal(img.attachments[0]?.kind, "image");
  const heic = await loadSource({ contentType: "image/heic", fileName: "foto.heic", bytes: new Uint8Array([1, 2, 3]), filePath: "" }, { defaultTz: "Europe/Zurich", heic: null });
  assert.equal(heic.attachments.length, 0);
  assert.match(heic.notes[0]!, /HEIC/);
});
