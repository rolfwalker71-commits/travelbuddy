import test from "node:test";
import assert from "node:assert/strict";
import { isValidTimeZone, localDateTime, offsetMinutes, zonedToUtcMs } from "../src/lib/tz";
import { addDays, diffDays } from "../src/lib/dates";
import { setup } from "./helpers";

test("tz: Ortszeit ↔ UTC inkl. Sommerzeit und Lücken", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  assert.equal(iso(zonedToUtcMs("2026-07-01", "12:00", "Europe/Zurich")), "2026-07-01T10:00:00.000Z");
  assert.equal(iso(zonedToUtcMs("2026-01-15", "12:00", "Europe/Zurich")), "2026-01-15T11:00:00.000Z");
  assert.equal(iso(zonedToUtcMs("2026-10-23", "16:00", "America/New_York")), "2026-10-23T20:00:00.000Z");
  assert.equal(iso(zonedToUtcMs("2026-10-28", "06:00", "Europe/Lisbon")), "2026-10-28T06:00:00.000Z");
  assert.equal(iso(zonedToUtcMs("2026-10-28", "06:00", "Asia/Kolkata")), "2026-10-28T00:30:00.000Z");
  // Lücke bei der Umstellung auf Sommerzeit (29.03.2026, 02:00 → 03:00): 02:30 gibt es nicht und rückt vor
  assert.equal(iso(zonedToUtcMs("2026-03-29", "02:30", "Europe/Zurich")), "2026-03-29T01:30:00.000Z");
  assert.equal(offsetMinutes(Date.parse("2026-07-01T00:00:00Z"), "Europe/Zurich"), 120);
  assert.deepEqual(localDateTime(Date.parse("2026-10-27T20:50:00Z"), "America/New_York"), { date: "2026-10-27", time: "16:50" });
  assert.deepEqual(localDateTime(Date.parse("2026-10-27T23:30:00Z"), "Europe/Zurich"), { date: "2026-10-28", time: "00:30" });
  assert.equal(isValidTimeZone("Europe/Zurich"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(diffDays("2026-10-23", "2026-11-02"), 10);
});

/** Reise «Ferien» (23.10.–02.11.2026), Zone Zürich, mit Flügen über Zeitzonen. */
async function ferien(nowIso: string) {
  let current = new Date(nowIso);
  const s = await setup({ deps: { now: () => current } });
  const anna = await s.tokens.anna();
  const t = await s.call("POST", "/v1/trips", {
    token: anna,
    json: { title: "Ferien 2026", destination: "Miami und Lissabon", startDate: "2026-10-23", endDate: "2026-11-02", travelers: [{ displayName: "Ben" }] },
  });
  const tripId = t.body.trip.id as number;
  const mk = async (json: unknown) => {
    const r = await s.call("POST", `/v1/trips/${tripId}/events`, { token: anna, json });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.eventId as number;
  };
  const ids = {
    out: await mk({
      type: "Flug", title: "ZRH → MIA", startDate: "2026-10-23", startTime: "10:05", endDate: "2026-10-23", endTime: "15:40",
      details: { departureAirport: "ZRH", arrivalAirport: "MIA", flightNumber: "LX64" }, bookingReference: "ABC123",
    }),
    hotel: await mk({
      type: "Hotel", title: "Hotel Miami Beach", startDate: "2026-10-23", startTime: "16:00", endDate: "2026-10-27", endTime: "11:00",
      startTz: "America/New_York", endTz: "America/New_York", cancelUntil: "2026-10-20", priceMinor: 120000, currency: "USD", paymentStatus: "open",
    }),
    task: await mk({ type: "Aufgabe", title: "Online-Check-in", startDate: "2026-10-26" }),
    back: await mk({
      type: "Flug", title: "MIA → LIS", startDate: "2026-10-27", startTime: "16:50", endDate: "2026-10-28", endTime: "06:00",
      details: { departureAirport: "MIA", arrivalAirport: "LIS" },
    }),
    review: await mk({ type: "Restaurant", title: "Vorschlag Essen", startDate: "2026-10-24", startTime: "19:00", status: "proposed" }),
  };
  return { ...s, anna, tripId, ids, setNow: (iso: string) => (current = new Date(iso)) };
}

test("heute: «jetzt» in Reisezone, Zonenwechsel nach dem Flug, nächstes Ereignis in Reisezeit", async () => {
  const { call, anna, tripId, ids, setNow } = await ferien("2026-10-23T12:00:00Z");

  // 12:00Z = 14:00 Zürich; der Hinflug (10:05 Zürich bis 15:40 Miami) ist unterwegs
  let r = await call("GET", "/v1/today", { token: anna });
  assert.equal(r.status, 200);
  assert.equal(r.body.trip.id, tripId);
  assert.equal(r.body.trip.dayIndex, 1);
  assert.equal(r.body.trip.dayCount, 11);
  assert.equal(r.body.date, "2026-10-23");
  assert.deepEqual(r.body.now, { local: "14:00", tz: "Europe/Zurich" });
  // Nächstes: Hotel 16:00 Miami = 20:00Z → in 8 Stunden (der Flug ist schon gestartet)
  assert.equal(r.body.next.id, ids.hotel);
  assert.equal(r.body.nextInSeconds, 8 * 3600);
  assert.deepEqual(r.body.events.map((e: any) => e.id), [ids.out, ids.hotel]);
  assert.deepEqual(r.body.tomorrow.map((e: any) => e.id), [ids.review, ids.hotel], "mehrtägige Einträge (middle) unten");
  assert.equal(r.body.review, 1);
  assert.deepEqual(r.body.tasks.map((x: any) => x.eventId), [ids.task]);
  assert.equal(r.body.tasks[0].dueDate, "2026-10-26");
  assert.ok(r.body.ledger.id);
  assert.equal(r.body.ledger.currency, "CHF");
  assert.equal(r.body.ledger.balanceMinor, 0);
  assert.ok(typeof r.body.generatedAt === "string");

  // Nach der Landung (20:30Z = 16:30 Miami): Zone wechselt auf New York
  setNow("2026-10-23T20:30:00Z");
  r = await call("GET", "/v1/today", { token: anna });
  assert.deepEqual(r.body.now, { local: "16:30", tz: "America/New_York" });
  assert.equal(r.body.date, "2026-10-23");

  // Rückflug unterwegs: 03:00Z = 27.10. 23:00 Miami → «heute» ist noch der 27.10., der Flug landet «morgen» in Lissabon
  setNow("2026-10-28T03:00:00Z");
  r = await call("GET", "/v1/today", { token: anna });
  assert.deepEqual(r.body.now, { local: "23:00", tz: "America/New_York" });
  assert.equal(r.body.date, "2026-10-27");
  assert.ok(r.body.events.some((e: any) => e.id === ids.back));
  assert.ok(r.body.tomorrow.some((e: any) => e.id === ids.back), "Landung am Folgetag");

  // Nach der Landung in Lissabon (06:00 WET = 06:00Z; 07:00Z → 07:00 Lissabon)
  setNow("2026-10-28T07:00:00Z");
  r = await call("GET", "/v1/today", { token: anna });
  assert.deepEqual(r.body.now, { local: "07:00", tz: "Europe/Lisbon" });
  assert.equal(r.body.date, "2026-10-28");
  assert.equal(r.body.trip.dayIndex, 6);

  // Ausdrücklich übersteuert: date und tz
  r = await call("GET", "/v1/today?date=2026-10-26&tz=Europe/Zurich", { token: anna });
  assert.equal(r.body.date, "2026-10-26");
  assert.equal(r.body.now.tz, "Europe/Zurich");
  assert.deepEqual(r.body.events.map((e: any) => e.id), [ids.task, ids.hotel]);

  assert.equal((await call("GET", "/v1/today?tz=Nirgendwo/Stadt", { token: anna })).status, 400);
  assert.equal((await call("GET", "/v1/today?date=morgen", { token: anna })).status, 400);
  void tripId;
});

test("heute: ohne laufende Reise kommt die nächste, Fristen und Zahlungen werden gelistet", async () => {
  const { call, anna, tripId, ids, setNow } = await ferien("2026-10-10T08:00:00Z");
  let r = await call("GET", "/v1/today", { token: anna });
  assert.equal(r.body.trip, null);
  assert.deepEqual(r.body.upcoming, { id: tripId, title: "Ferien 2026", startDate: "2026-10-23", daysUntil: 13 });
  assert.deepEqual(r.body.events, []);

  // 19.10.: Storno bis 20.10. steht an; Zahlung (offen) wird mit dem Beginn am 23.10. fällig
  setNow("2026-10-19T08:00:00Z");
  r = await call("GET", `/v1/trips/${tripId}/day/2026-10-19`, { token: anna });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.deadlines, [
    { eventId: ids.hotel, title: "Hotel Miami Beach", kind: "cancel", date: "2026-10-20" },
    { eventId: ids.hotel, title: "Hotel Miami Beach", kind: "payment", date: "2026-10-23" },
  ]);
  assert.equal(r.body.date, "2026-10-19");
  assert.equal(r.body.trip.id, tripId);
  assert.equal(r.body.next.id, ids.out);
  assert.deepEqual(r.body.events, []);

  // Tagesansicht eines Reisetags
  r = await call("GET", `/v1/trips/${tripId}/day/2026-10-27`, { token: anna });
  assert.deepEqual(r.body.events.map((e: any) => e.id), [ids.hotel, ids.back]);
  assert.equal((await call("GET", `/v1/trips/${tripId}/day/27.10.2026`, { token: anna })).status, 400);
});

test("zusammenfassung: Widgets bekommen aktive Reise, nächste Ereignisse mit Symbol und Farbe", async () => {
  const { call, anna, tripId, ids, setNow } = await ferien("2026-10-24T08:00:00Z");
  const r = await call("GET", "/v1/summary", { token: anna });
  assert.equal(r.status, 200);
  assert.equal(r.body.activeTrip.id, tripId);
  assert.equal(r.body.nextTrip, null);
  assert.equal(r.body.today.date, "2026-10-24");
  assert.equal(r.body.today.dayIndex, 2);
  assert.equal(r.body.today.dayCount, 11);
  const next = r.body.nextEvents;
  assert.ok(next.length >= 1 && next.length <= 6);
  assert.equal(next[0].id, ids.review, "19:00 Miami am 24.10. ist das nächste Ereignis");
  assert.equal(next[0].icon, "fork");
  assert.equal(next[0].color, "food");
  assert.equal(next[0].colorHex, "#A8433F");
  const flight = next.find((e: any) => e.id === ids.back);
  assert.equal(flight.icon, "plane");
  assert.equal(flight.startTz, "America/New_York");
  assert.deepEqual(flight.summary.slice(0, 2), [
    { label: "Von", value: "MIA" },
    { label: "Nach", value: "LIS" },
  ]);
  for (const k of ["endDate", "endTz", "address", "lat", "lon", "status", "provider", "startDate"]) assert.ok(k in flight, k);
  assert.equal(flight.endTz, "Europe/Lisbon");
  assert.equal(flight.endDate, "2026-10-28");
  assert.ok(JSON.stringify(r.body).length < 20 * 1024);
  assert.ok(r.body.ledger.id);
  assert.equal(r.body.ledger.currency, "CHF");
  assert.equal(r.body.ledger.myMemberId, r.body.ledger.balances[0].memberId);
  assert.deepEqual(r.body.ledger.balances.map((b: any) => b.displayName).sort(), ["Anna", "Ben"]);
  assert.equal(r.body.activeTrip.ledgerId, r.body.ledger.id);
  assert.equal(r.body.activeTrip.phase, "active");
  assert.equal(r.body.activeTrip.timezone, "Europe/Zurich");

  // Vor der Reise: nächste Reise statt aktiver
  setNow("2026-10-10T08:00:00Z");
  const before = await call("GET", "/v1/summary", { token: anna });
  assert.equal(before.body.activeTrip, null);
  assert.equal(before.body.nextTrip.id, tripId);
  assert.equal(before.body.today.dayIndex, null);

  // Gewählte Reise per ?tripId=
  const pinned = await call("GET", `/v1/summary?tripId=${tripId}`, { token: anna });
  assert.equal(pinned.body.nextTrip.id, tripId);
  assert.equal(pinned.body.nextTrip.phase, "upcoming");
  assert.equal((await call("GET", "/v1/summary?tripId=99999", { token: anna })).status, 404);
  assert.equal((await call("GET", "/v1/summary?tripId=abc", { token: anna })).status, 400);
});

/* ───────────── Mehrtägige Ereignisse: dayRole, displayTime, displayLabel ───────────── */

test("tagesrolle: Hotel 23.–25.10. erscheint als Check-in, Aufenthalt, Check-out; next rechnet mit dem Check-out", async () => {
  let current = new Date("2026-10-25T06:00:00Z"); // 07:00 MEZ am 25.10. (Zeitumstellung: Check-out 12:00 MEZ = 11:00Z)
  const s = await setup({ deps: { now: () => current } });
  const anna = await s.tokens.anna();
  const t = await s.call("POST", "/v1/trips", { token: anna, json: { title: "Nizza", startDate: "2026-10-23", endDate: "2026-10-27", timezone: "Europe/Zurich" } });
  const tripId = t.body.trip.id as number;
  const mk = async (json: unknown) => (await s.call("POST", `/v1/trips/${tripId}/events`, { token: anna, json })).body.eventId as number;
  const hotel = await mk({ type: "Hotel", title: "Negresco Princess", startDate: "2026-10-23", startTime: "15:00", endDate: "2026-10-25", endTime: "12:00" });
  const dinner = await mk({ type: "Restaurant", title: "Abendessen", startDate: "2026-10-25", startTime: "19:00" });
  const museum = await mk({ type: "Ausflug", title: "Museum", startDate: "2026-10-25", startTime: "09:30" });
  const car = await mk({ type: "Mietauto", title: "Mietwagen", startDate: "2026-10-24", startTime: "10:00", endDate: "2026-10-27", endTime: "16:30" });

  const day = async (date: string) => (await s.call("GET", `/v1/trips/${tripId}/day/${date}`, { token: anna })).body;
  const byId = (d: any, id: number) => d.events.find((e: any) => e.id === id);

  // 23.10.: Check-in mit 15:00 und Katalog-Beschriftung
  let d = await day("2026-10-23");
  assert.deepEqual(
    [byId(d, hotel).dayRole, byId(d, hotel).displayTime, byId(d, hotel).displayLabel],
    ["start", "15:00", "Check-in"]
  );
  // 24.10.: Hotel dazwischen («Aufenthalt», keine Zeit), Mietwagen startet (Abholung 10:00); middle unten
  d = await day("2026-10-24");
  assert.deepEqual(d.events.map((e: any) => [e.id, e.dayRole, e.displayTime, e.displayLabel]), [
    [car, "start", "10:00", "Abholung"],
    [hotel, "middle", null, "Aufenthalt"],
  ]);
  // 25.10.: Check-out 12:00 (nicht 15:00), Mietwagen läuft («Unterwegs»), Zeiten sortiert, middle unten
  d = await day("2026-10-25");
  assert.deepEqual(d.events.map((e: any) => [e.id, e.dayRole, e.displayTime, e.displayLabel]), [
    [museum, "single", "09:30", null],
    [hotel, "end", "12:00", "Check-out"],
    [dinner, "single", "19:00", null],
    [car, "middle", null, "Unterwegs"],
  ]);
  // Vorhandene Felder bleiben unverändert
  assert.equal(byId(d, hotel).startTime, "15:00");
  assert.equal(byId(d, hotel).endTime, "12:00");
  assert.equal(byId(d, hotel).endDate, "2026-10-25");
  // 27.10.: Mietwagen-Rückgabe 16:30
  d = await day("2026-10-27");
  assert.deepEqual([byId(d, car).dayRole, byId(d, car).displayTime, byId(d, car).displayLabel], ["end", "16:30", "Rückgabe"]);

  // «Heute» am 25.10. morgens: nächstes ist das Museum (09:30), nicht ein vergangener Check-in
  let today = (await s.call("GET", "/v1/today", { token: anna })).body;
  assert.equal(today.date, "2026-10-25");
  assert.equal(today.next.id, museum);
  assert.equal(today.nextInSeconds, 2.5 * 3600 + 0); // 07:00 MEZ → 09:30 MEZ
  // Nach dem Museum: Check-out (12:00 MEZ = 11:00Z) ist der nächste Zeitpunkt
  current = new Date("2026-10-25T09:00:00Z"); // 10:00 MEZ
  today = (await s.call("GET", "/v1/today", { token: anna })).body;
  assert.equal(today.next.id, hotel);
  assert.equal(today.next.dayRole, "end");
  assert.equal(today.next.displayTime, "12:00");
  assert.equal(today.nextInSeconds, 2 * 3600);
  assert.deepEqual(today.events.map((e: any) => e.id), [museum, hotel, dinner, car]);

  // Zusammenfassung: Check-out erscheint als Ende mit displayTime, Beginn-Felder bleiben
  const sum = (await s.call("GET", "/v1/summary", { token: anna })).body;
  const h = sum.nextEvents.find((e: any) => e.id === hotel);
  assert.deepEqual([h.dayRole, h.displayTime, h.displayLabel], ["end", "12:00", "Check-out"]);
  assert.equal(h.startTime, "15:00");
  assert.equal(h.endTime, "12:00");
  const c = sum.nextEvents.find((e: any) => e.id === car);
  assert.deepEqual([c.dayRole, c.displayTime, c.displayLabel], ["end", "16:30", "Rückgabe"], "nächster Zeitpunkt des Mietwagens ist die Rückgabe");
  assert.ok(sum.nextEvents.every((e: any) => ["single", "start", "middle", "end"].includes(e.dayRole)));
});

test("tagesrolle: Kreuzfahrt – Reise bleibt «Unterwegs», Hafentage und Abfahrt sind single; Flug über Mitternacht", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Mittelmeer", startDate: "2026-10-26", endDate: "2026-11-02" } });
  const tripId = t.body.trip.id as number;
  const mk = async (json: unknown) => (await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json })).body.eventId as number;
  const trip = await mk({ type: "Kreuzfahrt", title: "MSC Mittelmeer", startDate: "2026-10-26", endDate: "2026-11-02", details: { entryKind: "Reise", ship: "MSC Seaside" } });
  const port = await mk({ type: "Kreuzfahrt", title: "Barcelona", startDate: "2026-10-27", startTime: "08:00", endTime: "17:00", details: { entryKind: "Hafen", allAboard: "16:30" } });
  const embark = await mk({ type: "Kreuzfahrt", title: "Einschiffung", startDate: "2026-10-26", startTime: "13:00", details: { entryKind: "Einschiffung" } });
  const visa = await mk({ type: "Visum", title: "ESTA", startDate: "2026-10-20", endDate: "2026-12-20" });
  const night = await mk({
    type: "Flug", title: "MIA → LIS", startDate: "2026-10-27", startTime: "16:50", endDate: "2026-10-28", endTime: "06:00",
    details: { departureAirport: "MIA", arrivalAirport: "LIS" },
  });
  const day = async (date: string) => (await call("GET", `/v1/trips/${tripId}/day/${date}`, { token: anna })).body.events;
  const find = (list: any[], id: number) => list.find((e: any) => e.id === id);

  let ev = await day("2026-10-27");
  assert.deepEqual([find(ev, trip).dayRole, find(ev, trip).displayTime, find(ev, trip).displayLabel], ["middle", null, "Unterwegs"]);
  assert.deepEqual([find(ev, port).dayRole, find(ev, port).displayTime, find(ev, port).displayLabel], ["single", "08:00", null]);
  assert.deepEqual([find(ev, night).dayRole, find(ev, night).displayTime, find(ev, night).displayLabel], ["start", "16:50", "Abflug"]);
  assert.equal(find(ev, visa).dayRole, "middle");
  assert.equal(find(ev, visa).displayLabel, "Gültig", "Visum an Zwischentagen: «Gültig»");
  assert.equal(ev.at(-1).dayRole, "middle", "middle-Einträge ganz unten");

  ev = await day("2026-10-26");
  assert.deepEqual([find(ev, trip).dayRole, find(ev, trip).displayLabel], ["middle", "Unterwegs"], "die Reise bleibt auch am ersten Tag middle");
  assert.deepEqual([find(ev, embark).dayRole, find(ev, embark).displayTime], ["single", "13:00"]);

  ev = await day("2026-10-28");
  assert.deepEqual([find(ev, night).dayRole, find(ev, night).displayTime, find(ev, night).displayLabel], ["end", "06:00", "Ankunft"]);

  ev = await day("2026-11-02");
  assert.equal(find(ev, trip).dayRole, "middle");
});
