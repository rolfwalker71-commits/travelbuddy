import test from "node:test";
import assert from "node:assert/strict";
import { ACT_A, ACT_B, HEX_A, START_A, addEvent, makeTrip, notifSetup, registerDevice, type NotifEnv } from "./notif-helpers";

/** Felder von `TravelActivityAttributes.ContentState` (ios/Shared/TravelActivityAttributes.swift). */
const STATE_KEYS = ["headline", "detail", "icon", "colorKey", "stage", "milestoneLabel", "milestoneAt", "progress", "nextHeadline", "nextAt", "updatedAt"];
const STAGES = ["upcoming", "checkIn", "boarding", "underway", "arrived", "atStay", "generic"];
const REQUIRED = ["headline", "icon", "colorKey", "stage", "updatedAt"];

function assertContentState(cs: Record<string, unknown>, label = "content-state") {
  for (const k of Object.keys(cs)) assert.ok(STATE_KEYS.includes(k), `${label}: unbekanntes Feld «${k}»`);
  for (const k of REQUIRED) assert.ok(k in cs, `${label}: «${k}» fehlt`);
  assert.ok(STAGES.includes(cs.stage as string), `${label}: stage ${cs.stage}`);
  for (const k of ["headline", "icon", "colorKey", "detail", "milestoneLabel", "nextHeadline"]) {
    if (k in cs) assert.equal(typeof cs[k], "string", `${label}: ${k} ist ein String`);
  }
  // Zeitpunkte: Unix-Sekunden (Double), keine ISO-Strings, keine Millisekunden
  for (const k of ["milestoneAt", "nextAt", "updatedAt"]) {
    if (k in cs) {
      assert.equal(typeof cs[k], "number", `${label}: ${k} ist eine Zahl`);
      assert.ok((cs[k] as number) > 1_700_000_000 && (cs[k] as number) < 4_000_000_000, `${label}: ${k} in Sekunden`);
    }
  }
  if ("progress" in cs) assert.ok((cs.progress as number) >= 0 && (cs.progress as number) <= 1);
  const text = JSON.stringify(cs);
  assert.ok(!text.includes("ß"));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), "kein ISO-Datum in der Anzeige");
}

const raw = (m: { rawPayload?: Record<string, unknown> }) => (m.rawPayload as any).aps as Record<string, any>;
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

async function liveSetup(opts: { now?: string } = {}) {
  const env = await notifSetup({ now: opts.now ?? "2026-10-27T06:00:00Z" });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A, { pushToStartToken: START_A, environment: "development" });
  const flight = await addEvent(env, anna, tripId, {
    type: "Flug", title: "Flug ZRH → BCN", startDate: "2026-10-27", startTime: "17:00", startTz: "Europe/Zurich",
    endDate: "2026-10-27", endTime: "18:35", endTz: "Europe/Madrid",
    details: {
      flightNumber: "LX 1952", departureAirport: "ZRH", arrivalAirport: "BCN", departureGate: "B42",
      checkInOpens: "10:00", boardingTime: "16:20", baggageBelt: "7",
    },
  });
  const hotel = await addEvent(env, anna, tripId, {
    type: "Hotel", title: "Hotel Arts", startDate: "2026-10-27", startTime: "20:30", startTz: "Europe/Madrid",
    endDate: "2026-10-30", endTime: "11:00", address: "Carrer de la Marina 19-21", details: { checkInFrom: "15:00" },
  });
  return { env, anna, tripId, flight, hotel };
}

const lastLive = (env: NotifEnv) => env.push.sent.filter((m) => m.pushType === "liveactivity").at(-1)!;
const live = (env: NotifEnv) => env.push.sent.filter((m) => m.pushType === "liveactivity");

test("live: Lebenszyklus – Push-to-Start, Aktualisierung an Übergängen, Ende mit dismissal-date", async () => {
  const { env, anna, tripId, flight } = await liveSetup();
  const set = async (iso: string) => {
    env.set(iso);
    env.push.sent.length = 0;
    return env.scheduler.tick();
  };

  // Vor dem Morgenbriefing nichts (07:30 MEZ = 06:30 UTC)
  await set("2026-10-27T06:29:00Z");
  assert.equal(live(env).length, 0);

  // Reisetag: Tagesaktivität per Push-to-Start
  await set("2026-10-27T06:30:00Z");
  assert.equal(live(env).length, 1);
  const start = live(env)[0]!;
  assert.equal(start.deviceToken, START_A);
  assert.equal(start.environment, "development");
  assert.equal(start.pushType, "liveactivity");
  assert.equal(start.topic, "ch.rolfwalker.travelbuddy.push-type.liveactivity");
  assert.equal(start.priority, 10);
  let aps = raw(start);
  assert.equal(aps.event, "start");
  assert.equal(aps["attributes-type"], "TravelActivityAttributes");
  assert.deepEqual(aps.attributes, { tripId, tripTitle: "Barcelona", kind: "day", deepLink: "travelbuddy://today" });
  assert.equal(aps.timestamp, unix("2026-10-27T06:30:00Z"));
  assert.ok(aps.alert.title.startsWith("Tag 2 von 6"));
  assertContentState(aps["content-state"], "day/start");
  assert.equal(aps["content-state"].headline, "Flug ZRH → BCN");
  assert.equal(aps["content-state"].milestoneLabel, "Abflug");
  assert.equal(aps["content-state"].milestoneAt, unix("2026-10-27T16:00:00Z"));
  assert.equal(aps["content-state"].nextHeadline, "Hotel Arts");
  assert.equal(aps["content-state"].nextAt, unix("2026-10-27T19:30:00Z"));
  assert.equal(aps["content-state"].stage, "upcoming");

  // Die App meldet die Activity an; keine doppelte Aktualisierung, kein zweiter Start
  const reg = await env.call("PUT", "/v1/live-activities/day-1", { token: anna, json: { pushToken: ACT_A, tripId, kind: "day" } });
  assert.equal(reg.status, 200);
  await set("2026-10-27T07:00:00Z");
  assert.equal(live(env).length, 0, "Zustand unverändert, nichts zu senden");

  // 3 h vor Abflug: Flug-Activity startet, die Tagesaktivität wird beendet
  await set("2026-10-27T13:00:00Z");
  const ev = live(env);
  assert.equal(ev.length, 2);
  const end = ev.find((m) => raw(m).event === "end")!;
  const fstart = ev.find((m) => raw(m).event === "start")!;
  assert.equal(end.deviceToken, ACT_A, "Ende geht an das Activity-Token");
  assert.equal(end.pushType, "liveactivity");
  assert.equal(raw(end)["dismissal-date"], unix("2026-10-27T13:00:00Z"), "Tagesaktivität weicht sofort");
  assert.equal(fstart.deviceToken, START_A);
  aps = raw(fstart);
  assert.deepEqual(aps.attributes, { tripId, tripTitle: "Barcelona", kind: "flight", eventId: flight, deepLink: `travelbuddy://event/${tripId}/${flight}` });
  assertContentState(aps["content-state"], "flight/start");
  assert.equal(aps["content-state"].stage, "checkIn", "Check-in ist seit 10:00 MEZ offen");
  assert.equal(aps["content-state"].headline, "Abflug ZRH → BCN");
  assert.equal(aps["content-state"].detail, "LX 1952 · Gate B42");
  assert.equal(aps["content-state"].icon, "plane");
  assert.equal(aps["content-state"].colorKey, "air");
  assert.equal(aps["content-state"].milestoneLabel, "Boarding");
  assert.equal(aps["content-state"].milestoneAt, unix("2026-10-27T15:20:00Z"));
  assert.equal(aps["content-state"].progress, 0);
  assert.equal(aps["content-state"].nextHeadline, "Ankunft BCN");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM live_activities WHERE kind = 'day'").get() as any).n, 0, "Zeile der Tagesaktivität entfernt");

  await env.call("PUT", "/v1/live-activities/flight-1", { token: anna, json: { pushToken: ACT_B, tripId, kind: "flight", eventId: flight } });
  await set("2026-10-27T14:00:00Z");
  assert.equal(live(env).length, 0, "kein Übergang, keine Meldung");

  // Boarding
  await set("2026-10-27T15:20:00Z");
  assert.equal(live(env).length, 1);
  assert.equal(lastLive(env).deviceToken, ACT_B);
  assert.equal(lastLive(env).priority, 10, "Übergang: sofort zustellen");
  aps = raw(lastLive(env));
  assert.equal(aps.event, "update");
  assert.equal(aps["content-state"].stage, "boarding");
  assert.equal(aps["content-state"].milestoneLabel, "Abflug");
  assert.equal(aps["content-state"].milestoneAt, unix("2026-10-27T16:00:00Z"));
  assertContentState(aps["content-state"], "boarding");

  // Abflug: unterwegs mit Fortschritt
  await set("2026-10-27T16:00:00Z");
  aps = raw(lastLive(env));
  assert.equal(aps["content-state"].stage, "underway");
  assert.equal(aps["content-state"].progress, 0);
  assert.equal(aps["content-state"].milestoneLabel, "Ankunft");
  assert.equal(aps["content-state"].milestoneAt, unix("2026-10-27T17:35:00Z"));
  assert.equal(aps["content-state"].nextHeadline, "Check-in Hotel Arts");
  assert.equal(aps["content-state"].nextAt, unix("2026-10-27T19:30:00Z"));
  assert.equal(lastLive(env).priority, 10);

  await set("2026-10-27T16:05:00Z");
  assert.equal(live(env).length, 0, "Fortschritt wird nicht minütlich gesendet");
  await set("2026-10-27T16:10:00Z");
  assert.equal(live(env).length, 1);
  assert.equal(lastLive(env).priority, 5, "periodischer Fortschritt: energieschonend");
  const progress = raw(lastLive(env))["content-state"].progress as number;
  assert.ok(Math.abs(progress - 10 / 95) < 0.01, `Fortschritt ${progress}`);
  assertContentState(raw(lastLive(env))["content-state"], "underway");

  // Ankunft
  await set("2026-10-27T17:35:00Z");
  aps = raw(lastLive(env));
  assert.equal(aps["content-state"].stage, "arrived");
  assert.equal(aps["content-state"].headline, "Angekommen in BCN");
  assert.equal(aps["content-state"].detail, "Gepäckband 7");
  assert.equal(aps["content-state"].milestoneLabel, "Check-in");
  assert.equal(aps["content-state"].progress, 1);

  // Check-in Hotel
  await set("2026-10-27T19:30:00Z");
  aps = raw(lastLive(env));
  assert.equal(aps["content-state"].stage, "atStay");
  assert.equal(aps["content-state"].headline, "Check-in Hotel Arts");
  assert.equal(aps["content-state"].icon, "bed");
  assert.equal(aps["content-state"].colorKey, "stay");
  assertContentState(aps["content-state"], "atStay");

  // Ende: 30 Minuten nach dem Check-in, mit dismissal-date; die Zeile verschwindet
  await set("2026-10-27T20:00:00Z");
  const fin = live(env).find((m) => m.deviceToken === ACT_B)!;
  assert.equal(raw(fin).event, "end");
  assert.equal(raw(fin)["dismissal-date"], unix("2026-10-27T20:00:00Z") + 600);
  assertContentState(raw(fin)["content-state"], "end");
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM live_activities").get() as any).n, 0);
  // Die Tagesaktivität startet nicht ein zweites Mal (einmal je Gerät und Tag)
  assert.equal(live(env).filter((m) => raw(m).event === "start").length, 0);
  await set("2026-10-27T20:10:00Z");
  assert.equal(live(env).length, 0);
});

test("live: ohne Push-to-Start-Token kein Start; ungültige Token werden entfernt (410)", async () => {
  const { env, anna, tripId, flight } = await liveSetup({ now: "2026-10-27T13:00:00Z" });
  // Gerät ohne Push-to-Start
  await env.call("PUT", "/v1/devices/current", { token: anna, json: { pushToStartToken: null } });
  await env.scheduler.tick();
  assert.equal(live(env).length, 0, "kein Push-to-Start-Token, die App startet selbst");

  // Mit Token, aber APNs meldet 410 → Token wird entfernt, keine Wiederholung
  await env.call("PUT", "/v1/devices/current", { token: anna, json: { pushToStartToken: START_A } });
  env.push.invalid.add(START_A);
  const r = await env.scheduler.tick();
  assert.equal(r.live.failed, 1);
  assert.equal(r.live.removedTokens, 1);
  assert.equal((env.db.prepare("SELECT push_to_start_token AS t FROM api_tokens WHERE push_to_start_token IS NOT NULL").get() as any), undefined);

  // Activity-Token ungültig → Zeile entfernt
  await env.call("PUT", "/v1/devices/current", { token: anna, json: { pushToStartToken: START_A } });
  env.push.invalid.delete(START_A);
  await env.call("PUT", "/v1/live-activities/flight-9", { token: anna, json: { pushToken: ACT_B, tripId, kind: "flight", eventId: flight } });
  env.push.invalid.add(ACT_B);
  env.set("2026-10-27T15:20:00Z"); // Boarding: Update an ACT_B
  env.push.sent.length = 0;
  const r2 = await env.scheduler.tick();
  assert.ok(r2.live.failed >= 1);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM live_activities WHERE activity_id = 'flight-9'").get() as any).n, 0, "Zeile mit ungültigem Token entfernt");
});

test("live: ohne APNs-Schlüssel nichts als gesendet markiert, Start wird nachgeholt", async () => {
  const env = await notifSetup({ now: "2026-10-27T13:00:00Z", configured: false });
  const { anna, tripId } = await makeTrip(env, { startDate: "2026-10-26", endDate: "2026-10-31", travelers: [] });
  await registerDevice(env, anna, HEX_A, { pushToStartToken: START_A });
  await addEvent(env, anna, tripId, {
    type: "Flug", title: "Flug ZRH → BCN", startDate: "2026-10-27", startTime: "17:00", startTz: "Europe/Zurich",
    endDate: "2026-10-27", endTime: "18:35", endTz: "Europe/Madrid", details: { departureAirport: "ZRH", arrivalAirport: "BCN" },
  });
  const r = await env.scheduler.tick();
  assert.equal(r.dryRun, true);
  assert.equal(env.push.sent.length, 0);
  assert.equal((env.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key LIKE 'la:%'").get() as any).n, 0);

  env.push.state.configured = true;
  env.set("2026-10-27T13:01:00Z");
  const r2 = await env.scheduler.tick();
  assert.equal(r2.live.started, 1);
  assert.equal(raw(lastLive(env)).event, "start");
});

test("live: Diagnose – Beispiel-Activity per Push-to-Start, Update und Ende, auch als Trockenlauf mit Vorschau", async () => {
  const env = await notifSetup({ now: "2026-10-27T12:00:00Z" });
  const anna = await env.tokens.anna();
  const ben = await env.tokens.ben();
  assert.equal((await env.call("POST", "/v1/push/test", { token: ben, json: { kind: "liveactivity" } })).status, 403);

  const none = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity" } });
  assert.equal(none.status, 409);
  assert.equal(none.body.error.code, "no_device");

  await registerDevice(env, anna, HEX_A, { pushToStartToken: START_A });
  const r = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity", activityKind: "flight" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.dryRun, false);
  assert.equal(r.body.results[0].target, "push-to-start");
  const sent = lastLive(env);
  assert.equal(raw(sent).event, "start");
  assertContentState(raw(sent)["content-state"], "Beispiel");

  // Update/Ende brauchen eine angemeldete Activity
  assert.equal((await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity", event: "update" } })).status, 409);
  const trip = await makeTrip(env, { travelers: [] });
  await env.call("PUT", "/v1/live-activities/test-1", { token: anna, json: { pushToken: ACT_A, tripId: trip.tripId, kind: "day" } });
  const upd = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity", event: "update", activityKind: "day" } });
  assert.equal(upd.status, 200);
  assert.equal(raw(lastLive(env)).event, "update");
  assert.equal(lastLive(env).deviceToken, ACT_A);
  const fin = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity", event: "end" } });
  assert.equal(fin.status, 200);
  assert.ok(raw(lastLive(env))["dismissal-date"] > raw(lastLive(env)).timestamp);

  // Trockenlauf: Vorschau der Nutzlast, nichts gesendet
  env.push.state.configured = false;
  const dry = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "liveactivity" } });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.results[0].payload.aps.event, "start");
});

test("apns: Kopfzeilen für Live Activities und Mitteilungen (lokaler HTTP/2-Server, kein Netz)", async () => {
  const http2 = await import("node:http2");
  const { generateKeyPairSync } = await import("node:crypto");
  const { ApnsTransport, apnsTopic } = await import("../src/push/apns");
  assert.equal(apnsTopic("ch.x.app", "liveactivity"), "ch.x.app.push-type.liveactivity");
  assert.equal(apnsTopic("ch.x.app"), "ch.x.app");

  const seen: Array<{ headers: Record<string, any>; path: string; body: any }> = [];
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    let data = "";
    stream.on("data", (c) => (data += c));
    stream.on("end", () => {
      const token = String(headers[":path"]).split("/").pop()!;
      seen.push({ headers: headers as any, path: String(headers[":path"]), body: JSON.parse(data) });
      if (token.startsWith("dead")) {
        stream.respond({ ":status": 410 });
        stream.end(JSON.stringify({ reason: "Unregistered" }));
      } else {
        stream.respond({ ":status": 200 });
        stream.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const t = new ApnsTransport({ key, keyId: "ABC123DEFG", teamId: "9XZWUZ7Z26", topic: "ch.rolfwalker.travelbuddy" }, () => 1_760_000_000_000, `http://127.0.0.1:${port}`);
  try {
    const la = await t.send({
      deviceToken: "ab".repeat(20), environment: "production", title: "", body: "", pushType: "liveactivity", priority: 5,
      rawPayload: { aps: { timestamp: 1, event: "update", "content-state": { headline: "x" } } },
    });
    assert.equal(la.ok, true);
    const h = seen[0]!.headers;
    assert.equal(h["apns-push-type"], "liveactivity");
    assert.equal(h["apns-topic"], "ch.rolfwalker.travelbuddy.push-type.liveactivity");
    assert.equal(h["apns-priority"], "5");
    assert.match(String(h.authorization), /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(seen[0]!.body.aps.event, "update");

    const alert = await t.send({
      deviceToken: "cd".repeat(20), environment: "production", title: "Abflug", body: "ZRH → BCN", category: "trip.depart", threadId: "trip-1",
      interruptionLevel: "time-sensitive", expiration: 1_760_003_600, data: { kind: "trip.depart", deepLink: "travelbuddy://today" },
    });
    assert.equal(alert.ok, true);
    const a = seen[1]!;
    assert.equal(a.headers["apns-push-type"], "alert");
    assert.equal(a.headers["apns-topic"], "ch.rolfwalker.travelbuddy");
    assert.equal(a.headers["apns-priority"], "10");
    assert.equal(a.headers["apns-expiration"], "1760003600");
    assert.equal(a.body.aps["interruption-level"], "time-sensitive");
    assert.equal(a.body.aps["mutable-content"], 1);

    const dead = await t.send({ deviceToken: "dead" + "0".repeat(36), environment: "production", title: "", body: "", pushType: "liveactivity", rawPayload: { aps: {} } });
    assert.equal(dead.ok, false);
    if (!dead.ok) {
      assert.equal(dead.status, 410);
      assert.equal(dead.invalidToken, true);
    }
  } finally {
    t.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
