import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getCatalog, loadCatalog } from "../src/catalog/catalog";
import { setup } from "./helpers";

const catalogFile = path.resolve(import.meta.dirname, "../../shared/event-types.json");

async function tripWith(users = true) {
  const s = await setup();
  const anna = await s.tokens.anna();
  const t = await s.call("POST", "/v1/trips", { token: anna, json: { title: "Katalog", travelers: [{ displayName: "Ben" }, { displayName: "Gast Gerda" }] } });
  const tripId = t.body.trip.id as number;
  const people = Object.fromEntries(t.body.travelers.map((x: any) => [x.displayName, x.id as number]));
  return { ...s, anna, tripId, people, ledgerId: t.body.trip.ledgerId as number };
}

test("katalog: wird zur Laufzeit aus shared/event-types.json geladen und unverändert ausgeliefert", async () => {
  const cat = getCatalog();
  assert.equal(cat.raw, fs.readFileSync(catalogFile, "utf8"));
  assert.equal(cat.typeIds.length, 13);
  const { call, tokens } = await setup();
  const r = await call("GET", "/v1/meta/event-types");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /json/);
  assert.equal(JSON.stringify(r.body), JSON.stringify(JSON.parse(fs.readFileSync(catalogFile, "utf8"))));
  // mit Anmeldung identisch
  const authed = await call("GET", "/v1/meta/event-types", { token: await tokens.anna() });
  assert.equal(authed.status, 200);
  // bedingte Anfrage
  const etag = r.headers.get("etag")!;
  assert.equal((await call("GET", "/v1/meta/event-types", { headers: { "if-none-match": etag } })).status, 304);
});

test("katalog: Aliase und Vererbung (Unterkunft erbt von Hotel)", () => {
  const cat = loadCatalog(catalogFile);
  assert.equal(cat.resolveTypeId("Mietwagen"), "Mietauto");
  assert.equal(cat.resolveTypeId("Bahn"), "Zugreisen");
  assert.equal(cat.resolveTypeId("Notiz"), "Aufgabe");
  assert.equal(cat.resolveTypeId("Visa / Einreise"), "Visum");
  assert.equal(cat.resolveTypeId("flug"), "Flug");
  assert.equal(cat.resolveTypeId("Raumschiff"), null);
  assert.ok(cat.type("Unterkunft")!.fields.has("accessCode"));
  assert.equal(cat.type("Unterkunft")!.icon, "bed");
  // Kein Detail-Schlüssel darf einem gemeinsamen Feld (Spalte) gleichen: Schreibregel `fieldsMeta` ist je Name eindeutig.
  for (const t of cat.types.values()) {
    for (const k of t.fields.keys()) assert.ok(!cat.commonKeys.has(k), `${t.id}.${k} kollidiert mit einem gemeinsamen Feld`);
  }
});

test("katalog: Typen und details werden geprüft (422 invalid_details), Aliase aufgelöst", async () => {
  const { call, anna, tripId } = await tripWith();
  const post = (json: unknown) => call("POST", `/v1/trips/${tripId}/events`, { token: anna, json });

  const alias = await post({ type: "Mietwagen", title: "Auto", details: { pickupPlace: "MIA Airport" } });
  assert.equal(alias.status, 201);
  assert.equal(alias.body.events.find((e: any) => e.id === alias.body.eventId).type, "Mietauto");

  const unknownType = await post({ type: "Raumschiff", title: "x" });
  assert.equal(unknownType.status, 422);
  assert.equal(unknownType.body.error.code, "invalid_details");

  // Schlüssel eines anderen Typs
  const wrongKey = await post({ type: "Hotel", title: "x", details: { flightNumber: "LX1" } });
  assert.equal(wrongKey.status, 422);
  assert.equal(wrongKey.body.error.code, "invalid_details");
  assert.equal(wrongKey.body.error.details.fields[0].field, "flightNumber");

  // Werte: Muster, Auswahl, Zahl, Zeit, Betrag
  for (const details of [
    { flightNumber: "kein flug" },
    { cabinClass: "Holzklasse" },
    { durationMinutes: "90" },
    { boardingTime: "25:00" },
  ]) {
    const r = await post({ type: "Flug", title: "x", details });
    assert.equal(r.status, 422, JSON.stringify(details));
    assert.equal(r.body.error.code, "invalid_details");
  }
  const money = await post({ type: "Mietauto", title: "x", details: { depositMinor: 12.5 } });
  assert.equal(money.status, 422);

  const good = await post({
    type: "Flug", title: "ZRH → MIA",
    details: { flightNumber: " lx 64 ", cabinClass: "Business", durationMinutes: 600, boardingTime: "09:30", departureAirport: "zrh", arrivalAirport: "MIA" },
  });
  assert.equal(good.status, 201);
  const ev = good.body.events.find((e: any) => e.id === good.body.eventId);
  assert.equal(ev.details.flightNumber, "LX 64");
  assert.equal(ev.details.departureAirport, "ZRH");

  // PATCH: auch bei Typwechsel gilt der Katalog des neuen Typs
  const patch = await call("PATCH", `/v1/trips/${tripId}/events/${good.body.eventId}`, { token: anna, json: { type: "Hotel" } });
  assert.equal(patch.status, 422);
});

test("katalog: passengers verweisen auf Teilnehmer der Reise", async () => {
  const { call, anna, tripId, people } = await tripWith();
  const post = (details: unknown) => call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { type: "Flug", title: "Flug", details } });
  const ok = await post({ passengers: [{ participantId: people.Ben, seat: "12A", ticketNumber: "0987" }] });
  assert.equal(ok.status, 201);
  assert.equal((await post({ passengers: [{ participantId: 99999, seat: "1A" }] })).status, 422);
  assert.equal((await post({ passengers: [{ participantId: people.Ben, kabine: "x" }] })).status, 422);
  assert.equal((await post({ passengers: [{ seat: "1A" }] })).status, 422);
  assert.equal((await post({ passengers: [{ participantId: people.Ben }, { participantId: people.Ben }] })).status, 422);
});

test("fieldsMeta: per PATCH gesetzte Felder sind von Hand und gesperrt, Analyse-Schreiben respektiert das", async () => {
  const { call, anna, tripId, db } = await tripWith();
  const T = await import("../src/trips/service");
  const created = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: { type: "Hotel", title: "Hotel Alt", location: "Olbia" },
  });
  const id = created.body.eventId as number;
  const meta = () => call("GET", `/v1/trips/${tripId}`, { token: anna }).then((r) => r.body.events.find((e: any) => e.id === id).fieldsMeta);
  assert.deepEqual((await meta()).title, { source: "manual", locked: true });

  const patched = await call("PATCH", `/v1/trips/${tripId}/events/${id}`, {
    token: anna,
    json: { phone: "+39 0789 1", details: { roomType: "Suite" } },
  });
  assert.equal(patched.status, 200);
  const m = await meta();
  assert.deepEqual(m.phone, { source: "manual", locked: true });
  assert.deepEqual(m.roomType, { source: "manual", locked: true });
  assert.equal(m.address, undefined, "nicht gesetzte Felder bleiben ohne Eintrag");

  // Analyse: gesperrtes Feld bleibt, leere werden gefüllt
  const changed = T.applyExtraction(
    db, tripId, id,
    { title: "Hotel Neu", address: "Via Roma 1", phone: "000", details: { roomType: "Standard", board: "Fruehstueck" } },
    { documentId: 1, confidence: 0.9, page: 2, quotes: { address: "Via Roma 1, 07026 Olbia" } }
  );
  assert.deepEqual(changed.sort(), ["address", "board"]);
  const after = (await call("GET", `/v1/trips/${tripId}`, { token: anna })).body.events.find((e: any) => e.id === id);
  assert.equal(after.title, "Hotel Alt");
  assert.equal(after.phone, "+39 0789 1");
  assert.equal(after.address, "Via Roma 1");
  assert.deepEqual(after.fieldsMeta.address, { source: "document", documentId: 1, confidence: 0.9, page: 2, quote: "Via Roma 1, 07026 Olbia" });

  // Sperre aufheben: danach darf die Analyse überschreiben
  await call("PATCH", `/v1/trips/${tripId}/events/${id}`, { token: anna, json: { fieldsMeta: { title: { locked: false } } } });
  const again = T.applyExtraction(db, tripId, id, { title: "Hotel Neu" }, { documentId: 1 }, { overwriteUnlocked: true });
  assert.deepEqual(again, ["title"]);
});

test("status: Vorschläge bestätigen und in ein Ereignis einarbeiten (nur leere Felder)", async () => {
  const { call, anna, tripId, db } = await tripWith();
  const T = await import("../src/trips/service");
  const target = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna, json: { type: "Hotel", title: "Hotel Gabbiano", startDate: "2026-10-21", phone: "111" },
  });
  const proposal = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: {
      type: "Hotel", title: "Gabbiano (PDF)", status: "needs_review", startDate: "2026-10-21", phone: "999",
      address: "Via Roma 1", bookingReference: "h-77", priceMinor: 45000, currency: "EUR", details: { roomType: "Doppel" },
    },
  });
  assert.equal(proposal.status, 201);
  assert.equal(proposal.body.trip.needsReviewCount, 1);
  const inbox = await call("GET", "/v1/inbox", { token: anna });
  assert.equal(inbox.body.review.length, 1);
  assert.equal(inbox.body.review[0].tripTitle, "Katalog");
  assert.equal(inbox.body.review[0].event.status, "needs_review");

  const doc = db.prepare(
    `INSERT INTO documents (title, file_name, content_type, size_bytes, sha256, created_at, updated_at)
     VALUES ('Bestätigung', 'b.pdf', 'application/pdf', 1, ?, 'x', 'x')`
  ).run("a".repeat(64)).lastInsertRowid as number;
  await call("POST", `/v1/trips/${tripId}/events/${proposal.body.eventId}/documents`, { token: anna, json: { documentId: Number(doc) } });

  const merged = await call("POST", `/v1/trips/${tripId}/events/${proposal.body.eventId}/merge`, {
    token: anna, json: { intoEventId: target.body.eventId },
  });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.events.length, 1);
  const ev = merged.body.events[0];
  assert.equal(ev.id, target.body.eventId);
  assert.equal(ev.title, "Hotel Gabbiano");
  assert.equal(ev.phone, "111", "vorhandene Werte werden nicht überschrieben");
  assert.equal(ev.address, "Via Roma 1");
  assert.equal(ev.bookingReference, "H-77");
  assert.equal(ev.priceMinor, 45000);
  assert.equal(ev.details.roomType, "Doppel");
  assert.deepEqual(ev.documentIds, [Number(doc)]);
  assert.equal(merged.body.trip.needsReviewCount, 0);

  // confirm
  const p2 = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Vorschlag", status: "proposed" } });
  assert.equal(p2.body.trip.needsReviewCount, 1);
  const c = await call("POST", `/v1/trips/${tripId}/events/${p2.body.eventId}/confirm`, { token: anna });
  assert.equal(c.status, 200);
  assert.equal(c.body.events.find((e: any) => e.id === p2.body.eventId).status, "confirmed");
  assert.equal(c.body.trip.needsReviewCount, 0);
  // Sich selbst einarbeiten geht nicht
  assert.equal((await call("POST", `/v1/trips/${tripId}/events/${p2.body.eventId}/merge`, { token: anna, json: { intoEventId: p2.body.eventId } })).status, 422);
  void T;
});

test("flug: Zeitzonen und Koordinaten werden aus IATA vorbelegt (nur wenn leer)", async () => {
  const { call, anna, tripId } = await tripWith();
  const r = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: {
      type: "Flug", title: "ZRH → MIA", startDate: "2026-10-25", startTime: "10:00", endDate: "2026-10-25", endTime: "14:40",
      details: { departureAirport: "ZRH", arrivalAirport: "MIA" },
    },
  });
  const ev = r.body.events.find((e: any) => e.id === r.body.eventId);
  assert.equal(ev.startTz, "Europe/Zurich");
  assert.equal(ev.endTz, "America/New_York");
  assert.ok(Math.abs(ev.lat - 47.4581) < 0.01 && Math.abs(ev.lon - 8.5481) < 0.01);
  assert.equal(ev.fieldsMeta.startTz.source, "derived");
  assert.deepEqual(ev.places.map((p: any) => [p.role, p.source]), [["start", "airport"], ["end", "airport"]]);
  assert.ok(Math.abs(ev.places[1].lat - 25.796) < 0.01);

  // Von Hand gesetzte Zone wird nicht überschrieben, auch nicht bei geändertem Flughafen
  const manual = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: { type: "Flug", title: "Flug 2", startTz: "Europe/London", lat: 1, lon: 2, details: { departureAirport: "ZRH" } },
  });
  const ev2 = manual.body.events.find((e: any) => e.id === manual.body.eventId);
  assert.equal(ev2.startTz, "Europe/London");
  assert.equal(ev2.lat, 1);

  // Abgeleitete Werte folgen einem geänderten Flughafen
  const changed = await call("PATCH", `/v1/trips/${tripId}/events/${r.body.eventId}`, {
    token: anna, json: { details: { departureAirport: "JFK", arrivalAirport: "MIA" } },
  });
  const ev3 = changed.body.events.find((e: any) => e.id === r.body.eventId);
  assert.equal(ev3.startTz, "America/New_York");

  // ungültige Zone
  const bad = await call("PATCH", `/v1/trips/${tripId}/events/${r.body.eventId}`, { token: anna, json: { endTz: "Mars/Olympus" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "invalid_timezone");
});

test("teilnehmer: dieselbe ID als travelers[] der Reise und members[] der Reisekasse", async () => {
  const { call, anna, tripId, ledgerId, db } = await tripWith();
  const trip = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  const ledger = await call("GET", `/v1/ledgers/${ledgerId}`, { token: anna });
  const t = trip.body.travelers.map((x: any) => [x.id, x.displayName]).sort();
  const m = ledger.body.members.map((x: any) => [x.id, x.displayName]).sort();
  assert.deepEqual(t, m);
  assert.equal(trip.body.travelers.length, 3);
  // Jede Person hat eine stabile Farbe 0–7, ein Gästelink gilt für Reise (/v1/guest/trips) und Reisekasse (/v1/guest)
  const colors = trip.body.travelers.map((x: any) => x.colorIndex);
  assert.deepEqual(colors, [0, 1, 2]);
  assert.ok(trip.body.travelers.every((x: any) => "coupleId" in x));
  const gerda = trip.body.travelers.find((x: any) => x.displayName === "Gast Gerda");
  const lm = ledger.body.members.find((x: any) => x.id === gerda.id);
  assert.equal(lm.inviteToken, gerda.shareToken);
  const gTrip = await call("GET", `/v1/guest/trips/${gerda.shareToken}`);
  const gLedger = await call("GET", `/v1/guest/${gerda.shareToken}`);
  assert.equal(gTrip.body.me.travelerId, gerda.id);
  assert.equal(gLedger.body.me.memberId, gerda.id);

  // Ausgabe verweist auf dieselbe Person
  const exp = await call("POST", `/v1/guest/${gerda.shareToken}/expenses`, {
    json: { paidByMemberId: gerda.id, amountMinor: 900, currency: "CHF", split: { mode: "equal" } },
  });
  assert.equal(exp.status, 201);
  const row = db.prepare("SELECT paid_by_participant_id, created_by_participant_id FROM expenses").get() as any;
  assert.equal(row.paid_by_participant_id, gerda.id);
  assert.equal(row.created_by_participant_id, gerda.id);

  // Eine Person aus der Reisekasse hinzufügen = Mitreisender der Reise (gleiche ID)
  const added = await call("POST", `/v1/ledgers/${ledgerId}/members`, { token: anna, json: { displayName: "Hans" } });
  const hansId = added.body.member.id;
  const after = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  assert.ok(after.body.travelers.some((x: any) => x.id === hansId && x.displayName === "Hans"));
  // Link widerrufen gilt für beide Sichten
  await call("POST", `/v1/trips/${tripId}/travelers/${gerda.id}/share/revoke`, { token: anna });
  assert.equal((await call("GET", `/v1/guest/${gerda.shareToken}`)).status, 404);
  assert.equal((await call("GET", `/v1/guest/trips/${gerda.shareToken}`)).status, 404);
});

test("teilnehmer: Paar (coupleId) und Wer-ist-dabei an Ereignissen", async () => {
  const { call, anna, tripId, ledgerId, people } = await tripWith();
  const couple = await call("POST", `/v1/ledgers/${ledgerId}/couples`, { token: anna, json: { memberIds: [people.Ben, people["Gast Gerda"]] } });
  assert.equal(couple.status, 201);
  const trip = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  assert.equal(trip.body.travelers.find((x: any) => x.id === people.Ben).coupleId, couple.body.couple.id);

  const ev = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Essen", type: "Restaurant", participantIds: [people.Ben] } });
  assert.deepEqual(ev.body.events.find((e: any) => e.id === ev.body.eventId).participantIds, [people.Ben]);
  const bad = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Essen", participantIds: [424242] } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "invalid_participant");
});

test("ereignis → Ausgabe: Betrag, Währung, Zahler und Aufteilung vorbelegt, expenseId zurückgeschrieben", async () => {
  const { call, anna, tripId, ledgerId, people, fetchCalls } = await tripWith();
  const ev = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: {
      type: "Hotel", title: "Hotel Negresco", startDate: "2026-10-21", priceMinor: 50000, currency: "EUR",
      paidByParticipantId: people.Ben, participantIds: [people.Ben, people.Anna ?? 0].filter(Boolean),
    },
  });
  assert.equal(ev.status, 201);
  const eventId = ev.body.eventId as number;

  const r = await call("POST", `/v1/trips/${tripId}/events/${eventId}/expense`, { token: anna, json: {} });
  assert.equal(r.status, 201);
  const ex = r.body.expense;
  assert.equal(ex.amountMinor, 50000);
  assert.equal(ex.currency, "EUR");
  assert.equal(ex.paidByMemberId, people.Ben);
  assert.equal(ex.tripEventId, eventId);
  assert.equal(ex.description, "Hotel Negresco");
  assert.equal(ex.exchangeRate, 0.931235, "EZB-Kurs (Fake) zum Datum");
  assert.match(fetchCalls[0]!, /2026-10-21\?base=EUR&symbols=CHF/);
  assert.equal(ex.amountBaseMinor, Math.round(50000 * 0.931235));
  assert.equal(r.body.events.find((e: any) => e.id === eventId).expenseId, ex.id);
  assert.equal(ex.splits.reduce((s: number, x: any) => s + x.shareBaseMinor, 0), ex.amountBaseMinor);

  // nicht doppelt, ohne Preis nicht
  const dup = await call("POST", `/v1/trips/${tripId}/events/${eventId}/expense`, { token: anna, json: {} });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "expense_exists");
  const free = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Gratis" } });
  const noPrice = await call("POST", `/v1/trips/${tripId}/events/${free.body.eventId}/expense`, { token: anna, json: {} });
  assert.equal(noPrice.status, 422);
  assert.equal(noPrice.body.error.code, "price_required");

  // Ausgabe löschen gibt den Verweis frei
  await call("DELETE", `/v1/ledgers/${ledgerId}/expenses/${ex.id}`, { token: anna });
  const detail = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  assert.equal(detail.body.events.find((e: any) => e.id === eventId).expenseId, null);
});
