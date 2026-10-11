import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { derivePlaces, labelMatchesAddress } from "../src/trips/places";
import { migrate, openDb } from "../src/db/client";
import { setup } from "./helpers";

const base = { type: "Zugreisen", title: "T", location: null, address: null, lat: null, lon: null, placeCoords: {}, latSource: null };

test("orte: Adresse des Ereignisses gehört dem passenden Ort, sonst dem Ziel, nie beiden", () => {
  // Fehlerbild: Importdaten führen die Adresse des Ziels
  const train = derivePlaces(
    { ...base, address: "Zürich Flughafen", details: { originPlace: "Altdorf UR", destinationPlace: "Zürich Flughafen" } },
    { destination: "Kreuzfahrt / Florida" }
  );
  assert.deepEqual(
    train.map((p) => [p.role, p.label, p.address, p.query]),
    [
      ["start", "Altdorf UR", null, "Altdorf UR"],
      ["end", "Zürich Flughafen", "Zürich Flughafen", "Zürich Flughafen"],
    ]
  );

  // Transfer: Adresse des Hotels, Namen passen nicht eindeutig → Ziel
  const transfer = derivePlaces(
    { ...base, type: "Transfer", address: "1633 N Bayshore Dr, Miami, FL 33132", details: { originPlace: "Cruise Terminal 4", destinationPlace: "Miami Marriott Biscayne Bay" } },
    { destination: "Florida" }
  );
  assert.deepEqual(transfer.map((p) => [p.role, p.address]), [["start", null], ["end", "1633 N Bayshore Dr, Miami, FL 33132"]]);
  assert.equal(transfer[0]!.query, "Cruise Terminal 4");
  assert.equal(transfer[1]!.query, "1633 N Bayshore Dr, Miami, FL 33132");

  // Passt der Name des Startes zur Adresse, gehört sie dem Start
  const fromStart = derivePlaces(
    { ...base, type: "Transfer", address: "Hotel Gabbiano, Via Roma 1, Olbia", details: { originPlace: "Hotel Gabbiano", destinationPlace: "Hafen Olbia" } },
    {}
  );
  assert.deepEqual(fromStart.map((p) => [p.role, p.address]), [["start", "Hotel Gabbiano, Via Roma 1, Olbia"], ["end", null]]);

  // Eigene Adressfelder haben Vorrang, die Ereignis-Adresse geht nur an einen freien Ort
  const own = derivePlaces(
    { ...base, address: "Bahnhofplatz 1, Altdorf", details: { originPlace: "Altdorf UR", originAddress: "Bahnhofplatz 1, Altdorf", destinationPlace: "Zürich Flughafen" } },
    {}
  );
  assert.deepEqual(own.map((p) => [p.role, p.address]), [["start", "Bahnhofplatz 1, Altdorf"], ["end", null]], "nie dieselbe Adresse an beiden Orten");
  const ownOther = derivePlaces(
    { ...base, address: "Flughafenstrasse 1, Kloten", details: { originPlace: "Altdorf UR", originAddress: "Bahnhofplatz 1, Altdorf", destinationPlace: "Zürich Flughafen" } },
    {}
  );
  assert.deepEqual(ownOther.map((p) => [p.role, p.address]), [["start", "Bahnhofplatz 1, Altdorf"], ["end", "Flughafenstrasse 1, Kloten"]]);

  // Mietauto: Adresse wie bisher bei der Abholung, passt der Name der Rückgabe, bei der Rückgabe
  const car = derivePlaces(
    { ...base, type: "Mietauto", address: "2100 NW 42nd Ave, Miami", details: { pickupPlace: "Hertz MIA", returnPlace: "Hertz Fort Lauderdale" } },
    { destination: "Florida" }
  );
  assert.deepEqual(car.map((p) => [p.role, p.address, p.query]), [
    ["pickup", "2100 NW 42nd Ave, Miami", "2100 NW 42nd Ave, Miami"],
    ["return", null, "Hertz Fort Lauderdale"],
  ]);
  const carReturn = derivePlaces(
    { ...base, type: "Mietauto", address: "Fort Lauderdale Airport", details: { pickupPlace: "Hertz MIA", returnPlace: "Fort Lauderdale Airport" } },
    {}
  );
  assert.deepEqual(carReturn.map((p) => [p.role, p.address]), [["pickup", null], ["return", "Fort Lauderdale Airport"]]);

  assert.equal(labelMatchesAddress("Zürich Flughafen", "ZURICH FLUGHAFEN"), true);
  assert.equal(labelMatchesAddress("Zürich", "Flughafen Zürich, 8058 Kloten"), true);
  assert.equal(labelMatchesAddress("Altdorf UR", "Zürich Flughafen"), false);
  assert.equal(labelMatchesAddress(null, "x"), false);
});

test("orte: Hafentag nur mit Titel (ohne Reiseziel-Anhang), Zug über die API", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Florida", destination: "Kreuzfahrt / Florida" } });
  const id = t.body.trip.id as number;
  const train = await call("POST", `/v1/trips/${id}/events`, {
    token: anna,
    json: { type: "Zugreisen", title: "Erstfeld / Altdorf nach Zürich Flughafen", address: "Zürich Flughafen", details: { originPlace: "Altdorf UR", destinationPlace: "Zürich Flughafen" } },
  });
  const ev = train.body.events.find((e: any) => e.id === train.body.eventId);
  assert.deepEqual(ev.places.map((p: any) => [p.role, p.label, p.address]), [
    ["start", "Altdorf UR", null],
    ["end", "Zürich Flughafen", "Zürich Flughafen"],
  ]);
  assert.equal(ev.lat, null);
});

test("bereinigung (Migration 022): geocodierte Ergebnisse verworfen, Handarbeit bleibt", () => {
  const db = openDb(":memory:");
  migrate(db);
  db.prepare("INSERT INTO trips (title, created_at, updated_at) VALUES ('T', 'x', 'x')").run();
  const ins = db.prepare(
    `INSERT INTO trip_events (trip_id, event_type, title, lat, lon, details, place_coords, fields_meta, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`
  );
  const g = JSON.stringify({ lat: { source: "geocoded", confidence: 0.5 }, lon: { source: "geocoded" } });
  const man = JSON.stringify({ lat: { source: "manual", locked: true }, lon: { source: "manual", locked: true } });
  const pcGeo = JSON.stringify({ end: { lat: 47.45, lon: 8.55, source: "geocoded" }, start: { lat: 1, lon: 2, source: "manual" } });
  const id = (r: any) => Number(r.lastInsertRowid);
  const train = id(ins.run("Zugreisen", "Zug", 47.45, 8.55, "{}", pcGeo, g));
  const transfer = id(ins.run("Transfer", "Transfer", 25.7, -80.2, "{}", "{}", man));
  const car = id(ins.run("Mietauto", "Auto", 25.8, -80.3, "{}", "{}", "{}")); // ohne Herkunft = von Hand
  const port = id(ins.run("Kreuzfahrt", "Palma", 39.5, 2.6, JSON.stringify({ entryKind: "Hafen" }), "{}", g));
  const cruiseWhole = id(ins.run("Kreuzfahrt", "Reise", 1, 1, JSON.stringify({ entryKind: "Reise" }), "{}", g));
  const hotel = id(ins.run("Hotel", "Hotel", 40.9, 9.5, "{}", "{}", g));
  const mem = db.prepare("INSERT INTO geocode_backfill (event_id, role, status, query, attempts, last_attempt_at) VALUES (?, ?, 'not_found', 'alt', 1, 'x')");
  mem.run(train, "start");
  mem.run(hotel, "venue");

  db.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../src/db/migrations/022_geocode_reset.sql"), "utf8"));

  const row = (i: number) => db.prepare("SELECT lat, lon, place_coords, fields_meta FROM trip_events WHERE id = ?").get(i) as any;
  const t = row(train);
  assert.deepEqual([t.lat, t.lon], [null, null]);
  assert.equal(JSON.parse(t.fields_meta).lat, undefined);
  assert.deepEqual(Object.keys(JSON.parse(t.place_coords)), ["start"], "nur die geocodierte Rolle verworfen, manuelle bleibt");
  assert.deepEqual([row(transfer).lat, JSON.parse(row(transfer).fields_meta).lat.source], [25.7, "manual"]);
  assert.equal(row(car).lat, 25.8, "ohne Herkunft = von Hand, bleibt");
  assert.equal(row(port).lat, null, "Hafentag wird neu geholt");
  assert.equal(row(cruiseWhole).lat, 1, "andere Kreuzfahrt-Einträge bleiben");
  assert.equal(row(hotel).lat, null, "alle Typen: geocodiert wird neu geholt");
  const left = db.prepare("SELECT event_id FROM geocode_backfill").all() as any[];
  assert.deepEqual(left, [], "Merker aller Ereignisse gelöscht");

  // idempotent
  db.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../src/db/migrations/022_geocode_reset.sql"), "utf8"));
  assert.equal(row(car).lat, 25.8);
});
