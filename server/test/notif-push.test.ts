import test from "node:test";
import assert from "node:assert/strict";
import { buildApnsPayload } from "../src/push/apns";
import { NOTIFICATION_KINDS } from "../src/push/notifier";
import { HEX_A, HEX_B, decodeLikeSwift, notifSetup, registerDevice } from "./notif-helpers";

test("push/status: nur Admins, ohne Schlüsselinhalt, mit Trockenlauf-Anzeige und Zählern", async () => {
  const env = await notifSetup({ configured: false });
  const anna = await env.tokens.anna();
  const ben = await env.tokens.ben();
  assert.equal((await env.call("GET", "/v1/push/status", { token: ben })).status, 403);
  await registerDevice(env, anna, HEX_A, { pushToStartToken: "1a".repeat(40) });
  await registerDevice(env, ben, HEX_B);

  const off = await env.call("GET", "/v1/push/status", { token: anna });
  assert.equal(off.status, 200);
  assert.equal(off.body.configured, false);
  assert.equal(off.body.dryRun, true);
  assert.equal(off.body.registeredDevices, 2);
  assert.equal(off.body.pushToStartDevices, 1);
  assert.equal(off.body.liveActivities, 0);
  assert.equal(off.body.scheduler.lastRun, null);
  assert.ok(!/PRIVATE KEY|BEGIN/.test(JSON.stringify(off.body)));

  env.push.state.configured = true;
  await env.scheduler.tick();
  const on = await env.call("GET", "/v1/push/status", { token: anna });
  assert.equal(on.body.configured, true);
  assert.equal(on.body.dryRun, false);
  assert.equal(on.body.topic, "ch.rolfwalker.travelbuddy");
  assert.equal(on.body.keyId, "ABC123DEFG");
  assert.equal(typeof on.body.scheduler.lastRun.durationMs, "number");
});

test("push/test: jede Art mit Beispiel-Ticket, Nutzlast nach Vertrag, mit den Feldnamen der App dekodierbar", async () => {
  const env = await notifSetup();
  const anna = await env.tokens.anna();
  const ben = await env.tokens.ben();
  assert.equal((await env.call("POST", "/v1/push/test", { token: ben, json: {} })).status, 403);
  assert.equal((await env.call("POST", "/v1/push/test", { token: anna, json: {} })).body.error.code, "no_device");
  await registerDevice(env, anna, HEX_A, { environment: "development" });

  // Standard: einfache Testmeldung (ohne Body)
  const plain = await env.call("POST", "/v1/push/test", { token: anna });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.kind, "test");
  assert.equal(env.push.sent[0]!.title, "TravelBuddy");
  env.push.sent.length = 0;

  for (const kind of NOTIFICATION_KINDS) {
    env.push.sent.length = 0;
    const r = await env.call("POST", "/v1/push/test", { token: anna, json: { kind } });
    assert.equal(r.status, 200, kind);
    assert.equal(r.body.results[0].ok, true);
    assert.equal(env.push.sent.length, 1);
    const m = env.push.sent[0]!;
    assert.equal(m.deviceToken, HEX_A);
    assert.equal(m.environment, "development");
    const p = buildApnsPayload(m) as any;
    assert.equal(p.aps.category, kind);
    assert.equal(p.aps["mutable-content"], 1);
    assert.equal(p.kind, kind);
    assert.equal(typeof p.deepLink, "string");
    assert.ok(p.deepLink.startsWith("travelbuddy://"));
    assert.ok(["active", "time-sensitive"].includes(p.interruption));
    assert.equal(p.aps["interruption-level"], p.interruption);
    assert.ok(!JSON.stringify(p).includes("ß"));
    const d = decodeLikeSwift(p, p.aps.category);
    assert.equal(d.kind, kind);
    if (kind.startsWith("trip.") && kind !== "trip.comment") {
      assert.ok(d.ticket.title, `${kind}: Beispiel-Ticket mit Titel`);
      assert.ok(d.imageKey?.startsWith("notif-"), `${kind}: Bild`);
    }
    if (d.ticket.startAt) assert.equal(d.ticket.startAtParsable, true);
  }

  // Abflug: time-sensitive mit vollständigem Ticket
  env.push.sent.length = 0;
  await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "trip.depart" } });
  const t = decodeLikeSwift(buildApnsPayload(env.push.sent[0]!) as any).ticket;
  assert.equal(t.from, "ZRH");
  assert.equal(t.to, "BCN");
  assert.equal(t.type, "Flug");
  assert.ok(t.facts.length >= 2);
  assert.equal(env.push.sent[0]!.interruptionLevel, "time-sensitive");

  assert.equal((await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "gibt-es-nicht" } })).status, 422);
  assert.equal(
    (await env.call("POST", "/v1/push/test", { token: anna, headers: { "content-type": "application/json" } as any })).status,
    200
  );
});

test("push/test: ohne Schlüssel Trockenlauf mit Vorschau der Nutzlast, ungültiges Token wird entfernt", async () => {
  const env = await notifSetup({ configured: false });
  const anna = await env.tokens.anna();
  await registerDevice(env, anna, HEX_A);
  const dry = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "trip.today" } });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.results[0].ok, false);
  assert.equal(dry.body.results[0].dryRun, true);
  assert.equal(dry.body.results[0].payload.aps.category, "trip.today");
  assert.equal(env.push.sent.length, 0);
  // Das Token bleibt bestehen (kein 410)
  assert.equal((env.db.prepare("SELECT apns_token AS t FROM api_tokens WHERE apns_token IS NOT NULL").get() as any).t, HEX_A);

  env.push.state.configured = true;
  env.push.invalid.add(HEX_A);
  const gone = await env.call("POST", "/v1/push/test", { token: anna, json: { kind: "trip.today" } });
  assert.equal(gone.body.results[0].tokenRemoved, true);
  assert.equal(env.db.prepare("SELECT apns_token FROM api_tokens WHERE apns_token IS NOT NULL").get(), undefined);
});
