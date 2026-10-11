import test from "node:test";
import assert from "node:assert/strict";
import { HEX_A, HEX_B, addEvent, makeTrip, notifSetup, registerDevice, type NotifEnv } from "./notif-helpers";

/** Reise mit Ben (Gerät) und Anna (Admin, Gerät); Anna kommentiert, Ben soll die Meldung bekommen. */
async function commentSetup(now: string, trip: Parameters<typeof makeTrip>[1] = {}) {
  const env = await notifSetup({ now });
  const t = await makeTrip(env, { startDate: "2026-10-24", endDate: "2026-10-31", ...trip });
  const ben = await env.tokens.ben();
  await registerDevice(env, ben, HEX_B);
  const eventId = await addEvent(env, t.anna, t.tripId, { type: "Ausflug", title: "Stadtführung", startDate: "2026-10-28", startTime: "10:00" });
  return { env, ...t, ben, eventId };
}

const comment = async (env: NotifEnv, anna: string, tripId: number, eventId: number, body = "Treffpunkt am Eingang?") => {
  const r = await env.call("POST", `/v1/trips/${tripId}/events/${eventId}/comments`, { token: anna, json: { body } });
  assert.equal(r.status, 201);
  await env.background.idle();
};
const toBen = (env: NotifEnv) => env.push.sent.filter((m) => m.deviceToken === HEX_B);

test("ruhezeiten: Einstellung mit Standard 22:30–06:30, per GET/PUT änderbar und geprüft", async () => {
  const env = await notifSetup();
  const ben = await env.tokens.ben();
  const get = await env.call("GET", "/v1/me/notification-prefs", { token: ben });
  assert.deepEqual(get.body.prefs.quietHours, { enabled: true, from: "22:30", to: "06:30" });

  const put = await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { quietHours: { from: "23:00" } } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.prefs.quietHours, { enabled: true, from: "23:00", to: "06:30" });
  const off = await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { quietHours: { enabled: false } } });
  assert.deepEqual(off.body.prefs.quietHours, { enabled: false, from: "23:00", to: "06:30" });
  assert.equal((await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { quietHours: { to: "25:00" } } })).status, 422);
  // andere Einstellungen bleiben unberührt
  assert.deepEqual((await env.call("GET", "/v1/me/notification-prefs", { token: ben })).body.prefs.leadTimes.departHours, [24, 3, 1]);
});

test("ruhezeiten: Kommentar nachts wird vorgemerkt und um 06:30 Ortszeit gesendet (über Mitternacht), genau einmal", async () => {
  // 27.10.2026 22:30 UTC = 23:30 MEZ
  const { env, anna, tripId, eventId } = await commentSetup("2026-10-27T22:30:00Z");
  await comment(env, anna, tripId, eventId);
  assert.equal(toBen(env).length, 0, "23:30 liegt in der Ruhezeit");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'qd:%'").get() as any).n, 1);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as any).n, 0, "noch nicht als gesendet vermerkt");

  // 00:30 MEZ: noch Ruhezeit (Fenster über Mitternacht)
  env.set("2026-10-27T23:30:00Z");
  let r = await env.scheduler.tick();
  assert.equal(toBen(env).length, 0);
  assert.equal(r.delivery.sent, 0);

  // 06:29 MEZ: noch nicht
  env.set("2026-10-28T05:29:00Z");
  await env.scheduler.tick();
  assert.equal(toBen(env).length, 0);

  // 06:30 MEZ: gesendet
  env.set("2026-10-28T05:30:00Z");
  r = await env.scheduler.tick();
  assert.equal(r.delivery.sent, 1);
  assert.equal(toBen(env).length, 1);
  assert.equal(toBen(env)[0]!.category, "trip.comment");
  assert.equal(toBen(env)[0]!.body, "Anna: Treffpunkt am Eingang?");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'qd:%'").get() as any).n, 0);

  env.set("2026-10-28T05:31:00Z");
  await env.scheduler.tick();
  assert.equal(toBen(env).length, 1, "keine Wiederholung");
});

test("ruhezeiten: tagsüber sofort, Einstellung aus oder eigenes Fenster wird respektiert", async () => {
  const { env, anna, ben, tripId, eventId } = await commentSetup("2026-10-28T10:00:00Z");
  await comment(env, anna, tripId, eventId, "Mittags");
  assert.equal(toBen(env).length, 1, "11:00 MEZ");

  env.set("2026-10-28T21:45:00Z"); // 22:45 MEZ
  await comment(env, anna, tripId, eventId, "Abends");
  assert.equal(toBen(env).length, 1, "22:45 in der Ruhezeit");

  await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { quietHours: { enabled: false } } });
  await comment(env, anna, tripId, eventId, "Ruhezeit aus");
  assert.equal(toBen(env).length, 2);
  assert.equal(toBen(env)[1]!.body, "Anna: Ruhezeit aus");

  // eigenes Fenster 20:00–07:00: 19:45 MEZ sofort, 20:15 verschoben
  await env.call("PUT", "/v1/me/notification-prefs", { token: ben, json: { quietHours: { enabled: true, from: "20:00", to: "07:00" } } });
  env.set("2026-10-28T18:45:00Z"); // 19:45
  await comment(env, anna, tripId, eventId, "Kurz vor acht");
  assert.equal(toBen(env).length, 3);
  env.set("2026-10-28T19:15:00Z"); // 20:15
  await comment(env, anna, tripId, eventId, "Nach acht");
  assert.equal(toBen(env).length, 3);
});

test("ruhezeiten: Ortszeit der Reise entscheidet, nicht die des Servers (Zone der Reise, Zone nach dem Flug)", async () => {
  // Reise in Tokio: 28.10. 22:00 UTC = 07:00 JST (keine Ruhezeit), in Zürich wäre es 23:00
  const tokyo = await commentSetup("2026-10-28T22:00:00Z", { timezone: "Asia/Tokyo" });
  await comment(tokyo.env, tokyo.anna, tokyo.tripId, tokyo.eventId);
  assert.equal(toBen(tokyo.env).length, 1);

  // Reise in New York: 28.10. 08:00 UTC = 04:00 EDT (Ruhezeit), in Zürich wäre es 09:00
  const ny = await commentSetup("2026-10-28T08:00:00Z", { timezone: "America/New_York" });
  await comment(ny.env, ny.anna, ny.tripId, ny.eventId);
  assert.equal(toBen(ny.env).length, 0);
  ny.env.set("2026-10-28T10:30:00Z"); // 06:30 EDT
  await ny.env.scheduler.tick();
  assert.equal(toBen(ny.env).length, 1);

  // Reisezone Zürich, aber der Flug nach Tokio ist gelandet: «jetzt» gilt in Tokio (28.10. 22:00 UTC = 07:00 JST)
  const trip = await commentSetup("2026-10-28T22:00:00Z", { timezone: "Europe/Zurich" });
  await addEvent(trip.env, trip.anna, trip.tripId, {
    type: "Flug", title: "Flug ZRH → NRT", startDate: "2026-10-27", startTime: "13:00", startTz: "Europe/Zurich",
    endDate: "2026-10-28", endTime: "09:00", endTz: "Asia/Tokyo", details: { departureAirport: "ZRH", arrivalAirport: "NRT" },
  });
  await comment(trip.env, trip.anna, trip.tripId, trip.eventId);
  assert.equal(toBen(trip.env).length, 1, "in Tokio 07:00, nicht Ruhezeit");
});

test("ruhezeiten: Abflug 3 h/1 h/Check-in/Boarding und Abholung kommen nachts sofort, die 24-h-Vorankündigung wartet", async () => {
  const env = await notifSetup({ now: "2026-10-27T04:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  // Abflug 28.10. 05:00 MEZ = 04:00 UTC
  await addEvent(env, anna, tripId, {
    type: "Flug", title: "Flug ZRH → BCN", startDate: "2026-10-28", startTime: "05:00", startTz: "Europe/Zurich",
    endDate: "2026-10-28", endTime: "06:45", endTz: "Europe/Madrid",
    details: { flightNumber: "LX 1950", departureAirport: "ZRH", arrivalAirport: "BCN", checkInOpens: "03:00", boardingTime: "04:20" },
  });
  const heads = (): string[] => env.push.sent.filter((m) => m.category === "trip.depart").map((m) => m.title);

  // 24 h vorher = 27.10. 04:00 UTC = 05:00 MEZ: Ruhezeit, nichts
  await env.scheduler.tick();
  assert.deepEqual(heads(), []);
  const sim = env.scheduler.simulate(new Date("2026-10-27T04:00:00Z"));
  assert.equal(sim.due[0]!.tag, "depart:24h");
  assert.equal(sim.due[0]!.quiet, true, "Simulation zeigt die Verschiebung");

  // 06:30 MEZ: nachgeholt (die Planung liefert sie erneut)
  env.set("2026-10-27T05:30:00Z");
  await env.scheduler.tick();
  assert.deepEqual(heads(), ["Abflug in 22 Stunden 30 Minuten"]);

  // 3 h vorher = 28.10. 01:00 UTC = 02:00 MEZ: sofort, auch nachts
  env.set("2026-10-28T01:00:00Z");
  await env.scheduler.tick();
  assert.equal(heads().at(-1), "Abflug in 3 Stunden");
  // Check-in 03:00 MEZ = 02:00 UTC
  env.set("2026-10-28T02:00:00Z");
  await env.scheduler.tick();
  assert.equal(heads().at(-1), "Check-in öffnet jetzt");
  // 1 h vorher = 03:00 UTC, Boarding 04:20 MEZ = 03:20 UTC
  env.set("2026-10-28T03:00:00Z");
  await env.scheduler.tick();
  assert.equal(heads().at(-1), "Abflug in 1 Stunde");
  env.set("2026-10-28T03:20:00Z");
  await env.scheduler.tick();
  assert.equal(heads().at(-1), "Boarding beginnt");
  assert.ok(env.push.sent.filter((m) => m.category === "trip.depart").every((m) => m.interruptionLevel === "time-sensitive"));
});

test("ruhezeiten: Abholung nachts sofort; Briefing und Fristen vor 06:30 warten bis 06:30", async () => {
  const env = await notifSetup({ now: "2026-10-27T00:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-28", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A);
  await env.call("PUT", "/v1/me/notification-prefs", { token: anna, json: { leadTimes: { todayBriefing: "05:00" } } });
  await addEvent(env, anna, tripId, {
    type: "Mietauto", title: "Mietwagen", startDate: "2026-10-28", startTime: "04:00", startTz: "Europe/Zurich",
    endDate: "2026-10-31", endTime: "18:00", details: { pickupPlace: "Flughafen Zürich" },
  });
  await addEvent(env, anna, tripId, {
    type: "Hotel", title: "Hotel Alfa", startDate: "2026-11-05", endDate: "2026-11-08", startTz: "Europe/Zurich", cancelUntil: "2026-11-03",
  });
  await addEvent(env, anna, tripId, { type: "Ausflug", title: "Frühstart", startDate: "2026-10-28", startTime: "08:00" });
  const cat = (c: string) => env.push.sent.filter((m) => m.category === c);

  // 28.10. 02:00 MEZ = 01:00 UTC: Abholung 2 h vorher (04:00 MEZ) kommt sofort
  env.set("2026-10-28T01:00:00Z");
  await env.scheduler.tick();
  assert.equal(cat("trip.pickup").length, 1);
  assert.equal(cat("trip.pickup")[0]!.interruptionLevel, "time-sensitive");

  // Briefing 05:00 MEZ = 04:00 UTC liegt in der Ruhezeit
  env.set("2026-10-28T04:00:00Z");
  await env.scheduler.tick();
  assert.equal(cat("trip.today").length, 0);
  env.set("2026-10-28T05:29:00Z");
  await env.scheduler.tick();
  assert.equal(cat("trip.today").length, 0);
  env.set("2026-10-28T05:30:00Z"); // 06:30 MEZ
  await env.scheduler.tick();
  assert.equal(cat("trip.today").length, 1);

  // Frist 03.11.: 3 Tage vorher = 31.10. 05:00 MEZ (Briefing-Uhrzeit) ist Ruhezeit und wird auf 06:30 geschoben
  const dl = env.scheduler.simulate(new Date("2026-10-31T04:00:00Z")).due.find((d) => d.kind === "trip.deadline");
  assert.ok(dl, "Frist fällig");
  assert.equal(dl!.quiet, true);
  env.set("2026-10-31T04:00:00Z");
  env.push.sent.length = 0;
  await env.scheduler.tick();
  assert.equal(cat("trip.deadline").length, 0);
  env.set("2026-10-31T05:30:00Z");
  await env.scheduler.tick();
  assert.equal(cat("trip.deadline").length, 1);
});

test("ruhezeiten: Vorgemerktes verfällt nach 36 Stunden; Reisekasse und Vorschläge werden ebenso verschoben", async () => {
  const { env, anna, tripId, ledgerId, travelers } = await (async () => {
    const env = await notifSetup({ now: "2026-10-27T23:00:00Z" });
    const t = await makeTrip(env, { startDate: "2026-10-24", endDate: "2026-10-31" });
    const ben = await env.tokens.ben();
    await registerDevice(env, ben, HEX_B);
    return { env, ...t };
  })();
  const annaMember = travelers.find((x) => x.displayName === "Anna")!.id;
  const ex = await env.call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
    token: anna, json: { paidByMemberId: annaMember, amountMinor: 2500, currency: "CHF", description: "Nachtessen", split: { mode: "equal" } },
  });
  assert.equal(ex.status, 201);
  await env.background.idle();
  await env.notifier.review(tripId, 2); // Administratoren: Anna hat kein Gerät, also nur vorgemerkt
  assert.equal(env.push.sent.length, 0);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'qd:%'").get() as any).n >= 1, true);

  env.set("2026-10-28T05:30:00Z");
  await env.scheduler.tick();
  assert.deepEqual(toBen(env).map((m) => m.category), ["ledger.expense"]);

  // Verfall: neue Meldung nachts vormerken, dann erst nach 40 Stunden (tagsüber) prüfen
  env.set("2026-10-28T21:30:00Z");
  await env.call("PUT", "/v1/devices/current", { token: await env.tokens.anna(), json: { apnsToken: HEX_A } });
  await env.notifier.tripComment({ tripId, eventId: 1, commentId: 999, actorUserId: null, actorName: "Gast", body: "alt" });
  assert.equal(toBen(env).length, 1);
  env.set("2026-10-30T14:00:00Z");
  await env.scheduler.tick();
  assert.equal(toBen(env).length, 1, "verfallen, nicht mehr nachgeliefert");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'qd:%'").get() as any).n, 0);
});
