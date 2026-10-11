import test from "node:test";
import assert from "node:assert/strict";
import { buildApnsPayload } from "../src/push/apns";
import { Notifier } from "../src/push/notifier";
import { HEX_A, HEX_B, HEX_C, addEvent, decodeLikeSwift, makeTrip, notifSetup, registerDevice } from "./notif-helpers";

/** Mitteilungen eines Geräts (Token) im Fake-APNs, neueste zuletzt. */
const to = (env: Awaited<ReturnType<typeof notifSetup>>, token: string) => env.push.sent.filter((m) => m.deviceToken === token);

const flightZrhBcn = {
  type: "Flug",
  title: "Flug ZRH → BCN",
  startDate: "2026-10-27",
  startTime: "17:00",
  startTz: "Europe/Zurich",
  endDate: "2026-10-27",
  endTime: "18:35",
  endTz: "Europe/Madrid",
  bookingReference: "X7K2QD",
  details: {
    airline: "Swiss",
    flightNumber: "LX 1952",
    departureAirport: "ZRH",
    arrivalAirport: "BCN",
    departureTerminal: "2",
    departureGate: "B42",
    checkInOpens: "10:00",
    boardingTime: "16:20",
  },
};

test("scheduler: Flug ZRH→BCN – 24 h, Check-in öffnet, 3 h, 1 h, Boarding, je einmal, Ortszeit, time-sensitive", async () => {
  const env = await notifSetup({ now: "2026-10-26T12:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31" });
  const ben = await env.tokens.ben();
  await registerDevice(env, ben, HEX_B);
  await registerDevice(env, anna, HEX_A);
  const eventId = await addEvent(env, anna, tripId, flightZrhBcn);

  // 26.10.2026 wirkt noch Sommerzeit-Ende (25.10.): 17:00 MEZ = 16:00 UTC. 24 h vorher = 26.10. 16:00 UTC.
  env.set("2026-10-26T15:59:00Z");
  assert.equal((await env.scheduler.tick()).planned, 0);
  assert.equal(env.push.sent.length, 0);

  env.set("2026-10-26T16:00:00Z");
  const r1 = await env.scheduler.tick();
  assert.equal(r1.delivery.sent, 2, "Anna und Ben (je ein Gerät)");
  const m = to(env, HEX_B)[0]!;
  assert.equal(m.title, "Abflug in 24 Stunden");
  assert.equal(m.body, "ZRH → BCN · LX 1952 · 27.10.2026 17:00 · Terminal 2 · Gate B42");
  assert.equal(m.category, "trip.depart");
  assert.equal(m.interruptionLevel, "time-sensitive");
  assert.equal(m.threadId, `trip-${tripId}`);
  assert.equal(m.data!.deepLink, `travelbuddy://event/${tripId}/${eventId}`);
  assert.equal(m.data!.imageKey, "notif-depart");
  assert.equal(m.expiration, Math.floor(Date.parse("2026-10-27T16:00:00Z") / 1000), "nach dem Abflug verfällt die Erinnerung");

  // Entdoppelung: derselbe Zeitpunkt, nächste Minute
  env.set("2026-10-26T16:01:00Z");
  const again = await env.scheduler.tick();
  assert.equal(again.delivery.sent, 0);
  assert.equal(again.delivery.skippedDuplicate, 2);

  const expectNext = async (iso: string, title: string, bodyPart?: RegExp) => {
    env.set(iso);
    env.push.sent.length = 0;
    await env.scheduler.tick();
    const msgs = to(env, HEX_B).filter((m) => m.category === "trip.depart");
    assert.equal(msgs.length, 1, `${iso}: genau eine Abflug-Mitteilung an Ben (war ${msgs.length})`);
    assert.equal(msgs[0]!.title, title, iso);
    if (bodyPart) assert.match(msgs[0]!.body, bodyPart, iso);
    // nochmals: nichts Neues
    env.push.sent.length = 0;
    await env.scheduler.tick();
    assert.equal(env.push.sent.length, 0, `${iso}: keine Wiederholung`);
  };
  // Das Morgenbriefing (07:30 MEZ = 06:30 UTC) liegt zwischen den Läufen und wird nachgeholt, ist aber keine Abflug-Meldung.
  await expectNext("2026-10-27T09:00:00Z", "Check-in öffnet jetzt", /Abflug 27\.10\.2026 17:00/); // 10:00 MEZ
  await expectNext("2026-10-27T13:00:00Z", "Abflug in 3 Stunden");
  await expectNext("2026-10-27T15:00:00Z", "Abflug in 1 Stunde");
  await expectNext("2026-10-27T15:20:00Z", "Boarding beginnt", /Gate B42/); // 16:20 MEZ

  // nach dem Abflug nichts mehr
  env.set("2026-10-27T16:30:00Z");
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.equal(env.push.sent.length, 0);
});

test("scheduler: Nutzlast nach Vertrag und mit den Feldnamen der App dekodierbar (ticket, startAt ISO UTC)", async () => {
  const env = await notifSetup({ now: "2026-10-27T13:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31" });
  await registerDevice(env, anna, HEX_A);
  const eventId = await addEvent(env, anna, tripId, {
    ...flightZrhBcn,
    lat: 47.4647,
    lon: 8.5492,
    address: "Flughafenstrasse, 8058 Zürich-Flughafen",
    location: "Flughafen Zürich",
  });
  await env.scheduler.tick();
  const msg = env.push.sent.find((m) => m.category === "trip.depart")!;
  assert.ok(msg, "Abflug-Mitteilung gesendet");
  const payload = buildApnsPayload(msg) as any;

  // aps
  assert.deepEqual(payload.aps.alert, { title: "Abflug in 3 Stunden", body: payload.aps.alert.body });
  assert.equal(payload.aps.sound, "default");
  assert.equal(payload.aps["mutable-content"], 1);
  assert.equal(payload.aps.category, "trip.depart");
  assert.equal(payload.aps["thread-id"], `trip-${tripId}`);
  assert.equal(payload.aps["interruption-level"], "time-sensitive");
  assert.equal(payload.aps["relevance-score"], 1);
  // Top-Level
  assert.equal(payload.deepLink, `travelbuddy://event/${tripId}/${eventId}`);
  assert.equal(payload.tripId, tripId);
  assert.equal(payload.eventId, eventId);
  assert.equal(payload.kind, "trip.depart");
  assert.equal(payload.imageKey, "notif-depart");
  assert.equal(payload.interruption, "time-sensitive");
  assert.equal(payload.relevance, 1);

  // Gegenprobe: so liest `TravelNotificationPayload.swift` die Nutzlast
  const d = decodeLikeSwift(payload, payload.aps.category);
  assert.equal(d.kind, "trip.depart");
  assert.equal(d.deepLink, `travelbuddy://event/${tripId}/${eventId}`);
  assert.equal(d.tripId, tripId);
  assert.equal(d.eventId, eventId);
  assert.equal(d.imageKey, "notif-depart");
  assert.equal(d.interruption, "time-sensitive");
  assert.equal(d.relevance, 1);
  const t = d.ticket;
  assert.equal(t.type, "Flug");
  assert.equal(t.icon, "plane");
  assert.equal(t.color, "air");
  assert.equal(t.title, "Flug ZRH → BCN");
  assert.equal(t.startAt, "2026-10-27T16:00:00Z");
  assert.equal(t.startAtParsable, true, "ISO8601DateFormatter() liest keine Sekundenbruchteile");
  assert.equal(t.startDate, "2026-10-27");
  assert.equal(t.startTime, "17:00");
  assert.equal(t.endTime, "18:35");
  assert.equal(t.tz, "Europe/Zurich");
  assert.equal(t.from, "ZRH");
  assert.equal(t.to, "BCN");
  assert.equal(t.place, "Flughafen Zürich");
  assert.equal(t.address, "Flughafenstrasse, 8058 Zürich-Flughafen");
  assert.equal(t.lat, 47.4647);
  assert.equal(t.lon, 8.5492);
  assert.equal(t.reference, "X7K2QD");
  assert.equal(t.tripTitle, "Barcelona");
  assert.equal(t.dayIndex, 2);
  assert.equal(t.dayCount, 6);
  assert.ok(t.facts.length > 0 && t.facts.every((f: any) => typeof f.label === "string" && typeof f.value === "string"));
  assert.ok(t.facts.some((f: any) => f.label === "Flugnummer" && f.value === "LX 1952"));
});

test("scheduler: Flug MIA→LIS über Mitternacht – Zeiten in Ortszeit des Abflugs, absolute Fälligkeit stimmt", async () => {
  const env = await notifSetup({ now: "2026-10-27T00:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-24", endDate: "2026-11-02" });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    type: "Flug",
    title: "Flug MIA → LIS",
    startDate: "2026-10-27",
    startTime: "22:30",
    startTz: "America/New_York",
    endDate: "2026-10-28",
    endTime: "11:50",
    endTz: "Europe/Lisbon",
    details: { flightNumber: "TP 204", departureAirport: "MIA", arrivalAirport: "LIS", checkInOpens: "23:30", boardingTime: "21:50" },
  });

  // Abflug 22:30 EDT (UTC-4) = 28.10. 02:30 UTC. 24 h = 27.10. 02:30 UTC, 3 h = 27.10. 23:30 UTC, 1 h = 28.10. 01:30 UTC.
  // `checkInOpens` 23:30 liegt nach dem Abflug: gemeint ist der Vortag (26.10. 23:30 EDT = 27.10. 03:30 UTC).
  const plan = env.scheduler.simulate(new Date("2026-10-26T12:00:00Z"), { previewHours: 72 });
  const byTag = Object.fromEntries(plan.upcoming.map((p) => [p.tag, p]));
  assert.equal(byTag["depart:24h"]!.dueAt, "2026-10-27T02:30:00.000Z");
  assert.equal(byTag["checkin"]!.dueAt, "2026-10-27T03:30:00.000Z");
  assert.equal(byTag["depart:3h"]!.dueAt, "2026-10-27T23:30:00.000Z");
  assert.equal(byTag["depart:1h"]!.dueAt, "2026-10-28T01:30:00.000Z");
  assert.equal(byTag["boarding"]!.dueAt, "2026-10-28T01:50:00.000Z");
  assert.equal(byTag["depart:3h"]!.validUntil, "2026-10-28T02:30:00.000Z");

  env.set("2026-10-27T23:30:00Z");
  await env.scheduler.tick();
  const m = env.push.sent.at(-1)!;
  assert.equal(m.title, "Abflug in 3 Stunden");
  assert.equal(m.body, "MIA → LIS · TP 204 · 27.10.2026 22:30 Ortszeit");
  assert.ok(!/04:30|28\.10\./.test(m.body), "keine Umrechnung in die Reisezone, kein Datum nach Mitternacht");
  const ticket = (buildApnsPayload(m) as any).ticket;
  assert.equal(ticket.startAt, "2026-10-28T02:30:00Z");
  assert.equal(ticket.tz, "America/New_York");
  assert.equal(ticket.startDate, "2026-10-27");
  assert.equal(ticket.startTime, "22:30");
});

test("scheduler: Morgenbriefing 07:30 in der Zone, in der die Reisenden sind (nach Lissabon, nicht Zürich)", async () => {
  const env = await notifSetup({ now: "2026-10-29T06:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-24", endDate: "2026-11-02" });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    type: "Flug", title: "Flug MIA → LIS", startDate: "2026-10-27", startTime: "22:30", startTz: "America/New_York",
    endDate: "2026-10-28", endTime: "11:50", endTz: "Europe/Lisbon", details: { departureAirport: "MIA", arrivalAirport: "LIS" },
  });
  await addEvent(env, anna, tripId, {
    type: "Restaurant", title: "Mittagessen Alfama", startDate: "2026-10-29", startTime: "13:00", startTz: "Europe/Lisbon", location: "Alfama",
  });
  await addEvent(env, anna, tripId, {
    type: "Ausflug", title: "Stadtführung", startDate: "2026-10-29", startTime: "10:00", startTz: "Europe/Lisbon",
  });
  await addEvent(env, anna, tripId, { type: "Aufgabe", title: "Tickets ausdrucken", startDate: "2026-10-29" });

  // 07:30 in Zürich (MEZ) wäre 06:30 UTC; die Reisenden sind aber in Lissabon (WET = UTC): 07:30 UTC.
  env.set("2026-10-29T06:30:00Z");
  await env.scheduler.tick();
  assert.equal(env.push.sent.filter((m) => m.category === "trip.today").length, 0, "in Zürich wäre es 07:30, in Lissabon erst 06:30");

  env.set("2026-10-29T07:30:00Z");
  await env.scheduler.tick();
  const today = env.push.sent.filter((m) => m.category === "trip.today");
  assert.equal(today.length, 1);
  assert.equal(today[0]!.title, "Heute: Tag 6 von 10 · Barcelona");
  assert.equal(today[0]!.body, "Donnerstag, 29.10.2026: 10:00 Stadtführung, 13:00 Mittagessen Alfama");
  assert.equal(today[0]!.interruptionLevel, "active");
  const p = buildApnsPayload(today[0]!) as any;
  assert.equal(p.imageKey, "notif-today");
  assert.equal(p.deepLink, "travelbuddy://today");
  assert.equal(p.ticket.count, 2, "Aufgaben stehen nicht in der Tagesliste");
  assert.deepEqual(p.ticket.items.map((i: any) => [i.time, i.title]), [["10:00", "Stadtführung"], ["13:00", "Mittagessen Alfama"]]);
  assert.equal(p.ticket.tz, "Europe/Lisbon");
  assert.equal(p.ticket.dayIndex, 6);
  assert.equal(p.ticket.dayCount, 10);

  // einmal je Tag
  env.set("2026-10-29T07:45:00Z");
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.equal(env.push.sent.length, 0);
  // am Abend (nach 12:00) nicht mehr nachträglich, auch nicht an einem Tag ohne Liste
  env.set("2026-10-30T08:00:00Z");
  await env.scheduler.tick();
  assert.equal(env.push.sent.length, 0, "30.10. hat keine Ereignisse");
});

test("scheduler: Unterkunft – Check-in-Tag am Morgen, Check-out 1 h vorher; Einstellung 90 Minuten", async () => {
  const env = await notifSetup({ now: "2026-10-28T05:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-27", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    type: "Hotel", title: "Hotel Arts", startDate: "2026-10-28", endDate: "2026-10-30", endTime: "11:00",
    startTz: "Europe/Madrid", endTz: "Europe/Madrid", address: "Carrer de la Marina 19-21, Barcelona",
    details: { checkInFrom: "15:00", checkOutUntil: "11:00" },
  });
  // 07:30 in Madrid (MEZ) = 06:30 UTC
  env.set("2026-10-28T06:29:00Z");
  await env.scheduler.tick();
  assert.equal(env.push.sent.filter((m) => m.category === "trip.stay").length, 0);
  env.set("2026-10-28T06:30:00Z");
  await env.scheduler.tick();
  const checkIn = env.push.sent.filter((m) => m.category === "trip.stay");
  assert.equal(checkIn.length, 1);
  assert.equal(checkIn[0]!.title, "Check-in heute");
  assert.equal(checkIn[0]!.body, "Hotel Arts · ab 15:00 · Carrer de la Marina 19-21, Barcelona");
  assert.equal(checkIn[0]!.data!.imageKey, "notif-stay");
  assert.equal(checkIn[0]!.interruptionLevel, "active");

  // Check-out 30.10. 11:00 Madrid = 10:00 UTC; 1 h vorher = 09:00 UTC
  env.set("2026-10-30T08:59:00Z");
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.equal(env.push.sent.filter((m) => m.title.startsWith("Check-out")).length, 0);
  env.set("2026-10-30T09:00:00Z");
  await env.scheduler.tick();
  const out = env.push.sent.filter((m) => m.title.startsWith("Check-out"));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "Check-out in 1 Stunde");
  assert.equal(out[0]!.body, "Hotel Arts · bis 11:00 · 30.10.2026");
  assert.equal((buildApnsPayload(out[0]!) as any).ticket.startAt, "2026-10-30T10:00:00Z");
});

test("scheduler: Einstellungen je Benutzer – Art aus, eigene Vorlaufzeiten, Briefing-Uhrzeit", async () => {
  const env = await notifSetup({ now: "2026-10-27T05:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-27", endDate: "2026-10-31" });
  const ben = await env.tokens.ben();
  await registerDevice(env, anna, HEX_A);
  await registerDevice(env, ben, HEX_B);
  await addEvent(env, anna, tripId, flightZrhBcn);

  // Ben: Abflug-Erinnerungen aus; Anna: nur 2 h vorher und Briefing um 08:00
  assert.equal((await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { tripDepart: false } })).status, 200);
  const put = await env.call("PUT", "/v1/me/notification-prefs", {
    token: anna,
    json: { leadTimes: { departHours: [2], todayBriefing: "08:00" } },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.prefs.leadTimes.departHours, [2]);

  env.set("2026-10-27T07:30:00Z"); // 08:30 MEZ: Briefing 08:00 MEZ = 07:00 UTC (ab 07:00 fällig), 3 h lead entfällt
  await env.scheduler.tick();
  const annaMsgs = to(env, HEX_A);
  const benMsgs = to(env, HEX_B);
  assert.deepEqual(annaMsgs.map((m) => m.category), ["trip.today"], "Anna: Briefing um 08:00, noch keine Abflug-Mitteilung");
  assert.deepEqual(benMsgs.map((m) => m.category), ["trip.today"], "Ben: Briefing um 07:30 (Standard)");

  env.set("2026-10-27T13:30:00Z"); // 3 h lead wäre 13:00 – Anna hat 2 h (14:00); «Check-in ist offen» seit 10:00 MEZ
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.deepEqual(to(env, HEX_A).map((m) => m.title), ["Check-in ist offen"], "nachgeholt, aber keine 3-h-Erinnerung");
  assert.equal(to(env, HEX_B).length, 0, "Ben hat tripDepart ausgeschaltet");

  env.set("2026-10-27T14:00:00Z");
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.deepEqual(to(env, HEX_A).map((m) => m.title), ["Abflug in 2 Stunden"]);
  assert.equal(to(env, HEX_B).length, 0);
});

test("scheduler: Mietwagen – Vorankündigung 24 h und Abholung 2 h vorher (trip.pickup, time-sensitive)", async () => {
  const env = await notifSetup({ now: "2026-10-27T00:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-27", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    type: "Mietauto", title: "Mietwagen Sixt", startDate: "2026-10-28", startTime: "10:00", startTz: "Europe/Madrid",
    endDate: "2026-10-31", endTime: "18:00", provider: "Sixt", bookingReference: "SX-4411",
    details: { pickupPlace: "Flughafen Barcelona", returnPlace: "Flughafen Barcelona", pickupHours: "06:00-23:00" },
  });
  // Abholung 28.10. 10:00 MEZ = 09:00 UTC
  const sim = env.scheduler.simulate(new Date("2026-10-27T00:00:00Z"), { previewHours: 48 });
  assert.deepEqual(sim.upcoming.map((p) => [p.kind, p.tag]).sort(), [["trip.depart", "depart:24h"], ["trip.pickup", "pickup:2h"]]);

  env.set("2026-10-28T07:00:00Z");
  await env.scheduler.tick();
  const pick = env.push.sent.filter((m) => m.category === "trip.pickup");
  assert.equal(pick.length, 1);
  assert.equal(pick[0]!.title, "Mietwagen abholen in 2 Stunden");
  assert.equal(pick[0]!.interruptionLevel, "time-sensitive");
  assert.match(pick[0]!.body, /Sixt · Flughafen Barcelona · 28\.10\.2026 10:00 Ortszeit · Öffnungszeiten 06:00-23:00 · Buchung SX-4411/);
  assert.equal(pick[0]!.data!.imageKey, "notif-pickup");
});

test("scheduler: Fristen – Storno und Zahlung, 3 Tage und 1 Tag vorher am Morgen", async () => {
  const env = await notifSetup({ now: "2026-10-30T00:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-11-08", endDate: "2026-11-12", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    type: "Hotel", title: "Hotel Arts", startDate: "2026-11-08", endDate: "2026-11-12", startTz: "Europe/Madrid",
    cancelUntil: "2026-11-05", priceMinor: 45000, currency: "CHF", paymentStatus: "open",
  });
  // Storno bis 05.11.: 3 Tage = 02.11. 07:30 MEZ (06:30 UTC), 1 Tag = 04.11. 07:30 MEZ
  const sim = env.scheduler.simulate(new Date("2026-11-01T00:00:00Z"), { previewHours: 24 * 12 });
  const dl = sim.upcoming.filter((p) => p.kind === "trip.deadline").map((p) => [p.tag, p.dueAt, p.title]);
  assert.deepEqual(dl, [
    ["deadline:cancel:3d", "2026-11-02T06:30:00.000Z", "Stornofrist in 3 Tagen"],
    ["deadline:cancel:1d", "2026-11-04T06:30:00.000Z", "Stornofrist morgen"],
    ["deadline:payment:3d", "2026-11-05T06:30:00.000Z", "Zahlung fällig in 3 Tagen"],
    ["deadline:payment:1d", "2026-11-07T06:30:00.000Z", "Zahlung fällig morgen"],
  ]);

  env.set("2026-11-02T06:30:00Z");
  await env.scheduler.tick();
  const m = env.push.sent.at(-1)!;
  assert.equal(m.category, "trip.deadline");
  assert.equal(m.title, "Stornofrist in 3 Tagen");
  assert.equal(m.body, "Hotel Arts: kostenlos stornierbar bis 05.11.2026.");
  assert.equal(m.interruptionLevel, "active");
  assert.equal(m.data!.imageKey, "notif-deadline");
  const t = (buildApnsPayload(m) as any).ticket;
  assert.equal(t.deadlineKind, "cancel");

  env.set("2026-11-05T06:30:00Z");
  await env.scheduler.tick();
  const pay = env.push.sent.at(-1)!;
  assert.equal(pay.title, "Zahlung fällig in 3 Tagen");
  assert.equal(pay.body, "Hotel Arts: CHF 450.00 offen, fällig bis 08.11.2026.");
});

test("scheduler: nur Teilnehmer mit Konto und Gerät; «Wer ist dabei» schränkt ein; neu angelegte Buchung flutet nicht", async () => {
  const env = await notifSetup({ now: "2026-10-27T14:30:00Z" });
  const { anna, tripId, travelers } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31" });
  const ben = await env.tokens.ben();
  const cleo = await env.tokens.cleo(); // nicht auf der Reise, hat aber ein Gerät
  await registerDevice(env, anna, HEX_A);
  await registerDevice(env, ben, HEX_B);
  await registerDevice(env, cleo, HEX_C);
  const annaId = travelers.find((t) => t.displayName === "Anna")!.id;
  const benId = travelers.find((t) => t.displayName === "Ben")!.id;

  // Buchung 1 h 30 vor Abflug angelegt: «24 h» und «3 h» sind schon vorbei, es kommt genau eine Mitteilung
  await addEvent(env, anna, tripId, { ...flightZrhBcn, participantIds: [annaId] });
  await env.scheduler.tick();
  const msgs = env.push.sent.filter((m) => m.category === "trip.depart");
  assert.equal(msgs.length, 1, "nur Anna ist dabei, nur eine Mitteilung, nicht 24 h + 3 h");
  assert.equal(msgs[0]!.deviceToken, HEX_A);
  assert.equal(msgs[0]!.title, "Abflug in 1 Stunde 30 Minuten", "tatsächlich verbleibende Zeit, nicht die Vorlaufzeit");
  assert.equal(env.push.sent.filter((m) => m.deviceToken === HEX_C).length, 0, "Cleo ist nicht Teilnehmerin der Reise");

  // Ben bekommt sein Ereignis; ohne Gerät: nichts und kein Protokolleintrag
  env.set("2026-10-28T09:00:00Z");
  await addEvent(env, anna, tripId, {
    type: "Zugreisen", title: "Zug nach Girona", startDate: "2026-10-28", startTime: "12:15", startTz: "Europe/Madrid",
    participantIds: [benId], details: { trainNumber: "AVE 1234", originPlace: "Barcelona Sants", destinationPlace: "Girona", departurePlatform: "6" },
  });
  await call(env, ben, "PUT", "/v1/devices/current", { apnsToken: null });
  env.push.sent.length = 0;
  const before = (env.db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as any).n;
  await env.scheduler.tick();
  assert.equal(env.push.sent.filter((m) => m.category === "trip.depart").length, 0);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as any).n, before, "ohne Gerät wird nichts vermerkt");

  await registerDevice(env, ben, HEX_B);
  await env.scheduler.tick();
  const train = env.push.sent.filter((m) => m.category === "trip.depart");
  assert.equal(train.length, 1);
  assert.equal(train[0]!.deviceToken, HEX_B);
  assert.match(train[0]!.title, /^Abfahrt in /);
  assert.equal(train[0]!.body, "Barcelona Sants → Girona · AVE 1234 · 28.10.2026 12:15 Ortszeit · Gleis 6");
});

async function call(env: Awaited<ReturnType<typeof notifSetup>>, token: string, method: string, path: string, json: unknown) {
  return env.call(method, path, { token, json });
}

test("scheduler: Trockenlauf ohne Schlüssel markiert nichts als gesendet und holt später nach", async () => {
  const env = await notifSetup({ now: "2026-10-27T13:00:00Z", configured: false });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, flightZrhBcn);

  const r1 = await env.scheduler.tick();
  assert.equal(r1.dryRun, true);
  assert.ok(r1.planned >= 1);
  assert.equal(r1.delivery.sent, 0);
  assert.equal(r1.delivery.deferred, r1.planned);
  assert.equal(env.push.sent.length, 0);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as any).n, 0, "nichts als gesendet markiert");
  assert.equal(env.scheduler.status().pending, r1.planned);

  // Schlüssel eingerichtet: der nächste Lauf holt die noch gültige Mitteilung nach
  env.push.state.configured = true;
  env.set("2026-10-27T13:05:00Z");
  const r2 = await env.scheduler.tick();
  assert.equal(r2.dryRun, false);
  assert.equal(r2.delivery.sent, 1);
  assert.equal(env.push.sent[0]!.title, "Abflug in 2 Stunden 55 Minuten", "nachgeholt: verbleibende Zeit");

  // Direkt über den Notifier (Transport ohne Schlüssel): «deferred», Eintrag wird zurückgenommen
  const off = (await import("./notif-helpers")).fakePush({ configured: false });
  const notifier = new Notifier(env.db, off.transport, env.now);
  const uid = env.userId("anna");
  const rep = await notifier.deliver([
    { userId: uid, kind: "trip.deadline", dedupeKey: "x:1", title: "t", body: "b", deepLink: "travelbuddy://today", tripId },
  ]);
  assert.equal(rep.deferred, 1);
  assert.equal(rep.failed, 0);
  assert.equal(env.db.prepare("SELECT 1 FROM notification_log WHERE dedupe_key = 'x:1'").get(), undefined);
});

test("scheduler: Texte – nie «ß», Datum dd.mm.yyyy, Zeit hh:mm, keine ISO-Daten in Titel und Text", async () => {
  const env = await notifSetup({ now: "2026-10-27T10:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { title: "Strandurlaub Süd", startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, {
    ...flightZrhBcn, title: "Flug Groß Straße ß", address: "Fußweg 5", location: "Flughafen",
    details: { ...flightZrhBcn.details, departureGate: "Weiß" },
  });
  await addEvent(env, anna, tripId, { type: "Hotel", title: "Hotel Weiß", startDate: "2026-10-27", details: { checkInFrom: "07:05" } });
  await env.scheduler.tick();
  const kinds = new Set(env.push.sent.map((m) => m.category));
  assert.ok(kinds.has("trip.depart") && kinds.has("trip.stay") && kinds.has("trip.today"), `Arten: ${[...kinds]}`);
  for (const m of env.push.sent) {
    const all = JSON.stringify(buildApnsPayload(m));
    assert.ok(!all.includes("ß"), `kein ß: ${all}`);
    for (const s of [m.title, m.body]) {
      assert.ok(!/\d{4}-\d{2}-\d{2}/.test(s), `kein ISO-Datum in «${s}»`);
      assert.ok(!/\b\d:\d{2}\b/.test(s), `Zeit zweistellig in «${s}»`);
    }
    assert.ok(m.title.length <= 60 && m.body.length <= 180);
  }
});

test("review: Notifier.review meldet Vorschläge an Administratoren der Reise, einmal je Anzahl und Stunde", async () => {
  const env = await notifSetup({ now: "2026-10-27T13:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { title: "Lissabon", startDate: "2026-11-01", endDate: "2026-11-05" });
  const ben = await env.tokens.ben();
  await registerDevice(env, anna, HEX_A);
  await registerDevice(env, ben, HEX_B); // Mitreisender ohne Adminrechte kann nicht bestätigen

  const r = await env.notifier.review(tripId, 3);
  assert.equal(r.sent, 1);
  const m = env.push.sent[0]!;
  assert.equal(m.deviceToken, HEX_A);
  assert.equal(m.title, "3 Vorschläge zu prüfen");
  assert.equal(m.body, "Lissabon: Neue Vorschläge aus Dokumenten warten auf Bestätigung.");
  assert.equal(m.category, "trip.review");
  const p = buildApnsPayload(m) as any;
  assert.equal(p.deepLink, "travelbuddy://inbox");
  assert.equal(p.imageKey, "notif-review");
  assert.equal(p.ticket.count, 3);
  assert.equal(p.interruption, "active");
  assert.equal(decodeLikeSwift(p).ticket.count, 3);

  assert.equal((await env.notifier.review(tripId, 3)).skippedDuplicate, 1);
  assert.equal((await env.notifier.review(tripId, 5)).sent, 1, "andere Anzahl: neue Meldung");
  assert.equal((await env.notifier.review(tripId, 0)).sent, 0);
  assert.equal((await env.notifier.review(9999, 2)).sent, 0);
  // Einstellung
  await env.call("PUT", "/v1/me/notification-prefs", { token: anna, json: { tripReview: false } });
  assert.equal((await env.notifier.review(tripId, 7)).skippedPrefs, 1);
});

test("scheduler: Simulation nur für Admins, mit eingefrorener Uhr und ohne Nebenwirkung", async () => {
  const env = await notifSetup({ now: "2026-10-20T08:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  const ben = await env.tokens.ben();
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, flightZrhBcn);

  assert.equal((await env.call("POST", "/v1/push/simulate", { token: ben, json: {} })).status, 403);
  const sim = await env.call("POST", "/v1/push/simulate", { token: anna, json: { at: "2026-10-27T13:00:00Z", tripId } });
  assert.equal(sim.status, 200);
  assert.equal(sim.body.at, "2026-10-27T13:00:00.000Z");
  assert.deepEqual(sim.body.due.map((d: any) => d.tag), ["depart:3h"]);
  assert.equal(sim.body.due[0].title, "Abflug in 3 Stunden");
  assert.equal(sim.body.due[0].dueAt, "2026-10-27T13:00:00.000Z");
  assert.ok(sim.body.upcoming.some((d: any) => d.tag === "depart:1h"));
  assert.equal(env.push.sent.length, 0, "Simulation sendet nichts");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as any).n, 0, "und schreibt nichts");
  assert.equal((await env.call("POST", "/v1/push/simulate", { token: anna, json: { at: "kein-datum" } })).status, 422);

  // Status zeigt den letzten Lauf
  await env.scheduler.tick();
  const st = await env.call("GET", "/v1/push/status", { token: anna });
  assert.equal(st.body.configured, true);
  assert.equal(st.body.dryRun, false);
  assert.equal(st.body.registeredDevices, 1);
  assert.equal(st.body.scheduler.lastRun.dryRun, false);
});

test("scheduler: Briefing nur für aktive Reisen und nur mit Tagesliste; stornierte Reisen und Vorschläge ruhen", async () => {
  const env = await notifSetup({ now: "2026-11-09T07:30:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-11-10", endDate: "2026-11-12", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await addEvent(env, anna, tripId, { type: "Ausflug", title: "Stadtführung", startDate: "2026-11-10", startTime: "10:00" });
  // Vorschlag aus einem Dokument: löst nichts aus
  await addEvent(env, anna, tripId, { ...flightZrhBcn, startDate: "2026-11-10", endDate: "2026-11-10", status: "needs_review" });

  // 09.11., Reise beginnt erst am 10.11.: kein Briefing (auch nicht am Vorabend)
  await env.scheduler.tick();
  assert.equal(env.push.sent.length, 0);

  // 10.11. 07:30 MEZ = 06:30 UTC: Briefing mit genau einem Eintrag, keine Abflug-Erinnerung für den Vorschlag
  env.set("2026-11-10T06:30:00Z");
  await env.scheduler.tick();
  assert.deepEqual(env.push.sent.map((m) => m.category), ["trip.today"]);
  assert.match(env.push.sent[0]!.body, /10:00 Stadtführung$/);

  // storniert: nichts mehr
  env.db.prepare("UPDATE trips SET status = 'cancelled' WHERE id = ?").run(tripId);
  env.set("2026-11-11T06:30:00Z");
  env.push.sent.length = 0;
  await addEvent(env, anna, tripId, { type: "Ausflug", title: "Strand", startDate: "2026-11-11", startTime: "11:00" });
  await env.scheduler.tick();
  assert.equal(env.push.sent.length, 0);
});
