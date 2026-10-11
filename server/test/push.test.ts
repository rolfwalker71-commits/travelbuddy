import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AutoApnsTransport, apnsJwt, buildApnsPayload, discoverApns, type ApnsConfig, type ApnsMessage, type ApnsResult, type PushTransport } from "../src/push/apns";
import { Notifier } from "../src/push/notifier";
import { createBackground } from "../src/lib/background";
import { formatMoney } from "../src/lib/money";
import { setup as baseSetup } from "./helpers";

const pem = () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tb-apns-"));

test("apns: JWT ist ein gültiges ES256-Token im r||s-Format", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwt = apnsJwt({ key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), keyId: "ABC123DEFG", teamId: "9XZWUZ7Z26" }, 1_760_000_000);
  const [h, c, sig] = jwt.split(".") as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "9XZWUZ7Z26", iat: 1_760_000_000 });
  assert.equal(Buffer.from(sig, "base64url").length, 64);
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

test("apns: Nutzlast nach Vertrag (mutable-content, category, thread-id, Top-Level-Felder, ticket)", () => {
  const p = buildApnsPayload({
    deviceToken: "t", environment: "production", title: "Abflug in 3 Stunden", body: "LX 64 ZRH → MIA",
    category: "trip.depart", threadId: "trip-4", interruptionLevel: "time-sensitive",
    data: { kind: "trip.depart", deepLink: "travelbuddy://event/4/9", tripId: 4, eventId: 9, imageKey: "notif-depart", interruption: "time-sensitive", relevance: 0.9, ticket: { type: "Flug", from: "ZRH", to: "MIA" } },
  });
  assert.deepEqual(p, {
    aps: {
      alert: { title: "Abflug in 3 Stunden", body: "LX 64 ZRH → MIA" },
      sound: "default",
      "mutable-content": 1,
      category: "trip.depart",
      "thread-id": "trip-4",
      "interruption-level": "time-sensitive",
      "relevance-score": 0.9,
    },
    kind: "trip.depart",
    deepLink: "travelbuddy://event/4/9",
    tripId: 4,
    eventId: 9,
    imageKey: "notif-depart",
    interruption: "time-sensitive",
    relevance: 0.9,
    ticket: { type: "Flug", from: "ZRH", to: "MIA" },
  });
});

test("geld: Anzeigeformat de-CH", () => {
  assert.equal(formatMoney(123450, "chf"), "CHF 1’234.50");
  assert.equal(formatMoney(5, "CHF"), "CHF 0.05");
  assert.equal(formatMoney(5000, "JPY"), "JPY 5’000");
});

test("apns: ohne Datei nicht eingerichtet, Key-ID aus dem Namen, Vorgabe-Topic TravelBuddy", () => {
  const dir = tmp();
  const none = discoverApns({ dir, env: {} });
  assert.equal(none.ok, false);
  assert.match((none as any).reason, /AuthKey_<KEYID>\.p8/);
  fs.writeFileSync(path.join(dir, "AuthKey_ABC123DEFG.p8"), pem());
  const found = discoverApns({ dir, env: {} });
  assert.ok(found.ok);
  if (found.ok) {
    assert.equal(found.config.keyId, "ABC123DEFG");
    assert.equal(found.config.teamId, "9XZWUZ7Z26");
    assert.equal(found.config.topic, "ch.rolfwalker.travelbuddy");
  }
  const o = discoverApns({ dir, env: { APNS_KEY_ID: "CUSTOMID99", APNS_TEAM_ID: "TEAM000001", APNS_TOPIC: "ch.example.app" } });
  assert.ok(o.ok && o.config.keyId === "CUSTOMID99" && o.config.topic === "ch.example.app");
  fs.writeFileSync(path.join(dir, "AuthKey_ABC123DEFG.p8"), "kein schlüssel");
  assert.match((discoverApns({ dir, env: {} }) as any).reason, /gültige \.p8/);
});

test("apns: Transport findet die Datei zur Laufzeit ohne Neustart", async () => {
  const dir = tmp();
  const created: ApnsConfig[] = [];
  const t = new AutoApnsTransport({
    dir, env: {},
    create: (cfg) => {
      created.push(cfg);
      return { send: async () => ({ ok: true }) };
    },
  });
  const msg: ApnsMessage = { deviceToken: "a".repeat(64), environment: "development", title: "t", body: "b" };
  assert.equal(t.status().configured, false);
  const before = await t.send(msg);
  assert.match((before as any).reason, /^not_configured/);
  fs.writeFileSync(path.join(dir, "AuthKey_ABC123DEFG.p8"), pem());
  assert.equal((await t.send(msg)).ok, true);
  assert.equal((await t.send(msg)).ok, true);
  assert.equal(created.length, 1);
});

/* ───────────── Benachrichtigungen über HTTP ───────────── */

function fakePush() {
  const sent: ApnsMessage[] = [];
  const invalid = new Set<string>();
  const transport: PushTransport = {
    async send(msg): Promise<ApnsResult> {
      sent.push(msg);
      if (invalid.has(msg.deviceToken)) return { ok: false, status: 410, reason: "Unregistered", invalidToken: true };
      return { ok: true };
    },
  };
  return { transport, sent, invalid };
}
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

async function setup() {
  const push = fakePush();
  const background = createBackground();
  const s = await baseSetup({ deps: { push: push.transport, background } });
  return { ...s, push, background };
}

test("push: Gerät registrieren, Ausgabe löst Meldung an andere Administratoren aus (mit Vertrags-Nutzlast)", async () => {
  const { db, call, tokens, push, background, userId } = await setup();
  db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'ben'").run();
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  assert.equal((await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: "kein-hex" } })).status, 422);
  assert.equal((await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: HEX_B, environment: "development" } })).status, 200);
  await call("PUT", "/v1/devices/current", { token: anna, json: { apnsToken: HEX_A } });

  const trip = await call("POST", "/v1/trips", { token: anna, json: { title: "Sardinien", travelers: [{ displayName: "Ben", userId: userId("ben") }] } });
  const ledgerId = trip.body.trip.ledgerId;
  const a = trip.body.travelers.find((m: any) => m.displayName === "Anna").id;
  const e = await call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 8450, currency: "CHF", description: "Mietwagen", split: { mode: "equal" } },
  });
  assert.equal(e.status, 201);
  await background.idle();

  assert.equal(push.sent.length, 1);
  const msg = push.sent[0]!;
  assert.equal(msg.deviceToken, HEX_B);
  assert.equal(msg.environment, "development");
  assert.equal(msg.title, "Reisekasse: Sardinien");
  assert.equal(msg.body, "Anna: Mietwagen · CHF 84.50");
  assert.equal(msg.category, "ledger.expense");
  assert.equal(msg.threadId, `ledger-${ledgerId}`);
  assert.deepEqual(msg.data, {
    kind: "ledger.expense",
    deepLink: `travelbuddy://ledger/${ledgerId}`,
    tripId: trip.body.trip.id,
    interruption: "active",
    ledgerId,
    expenseId: e.body.expense.id,
  });
});

test("push: Rückzahlung meldet dem Empfänger, Einstellungen werden respektiert", async () => {
  const { db, call, tokens, push, background, userId } = await setup();
  db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'ben'").run();
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  await call("PUT", "/v1/devices/current", { token: anna, json: { apnsToken: HEX_A } });
  await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: HEX_B } });
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "WG", members: [{ displayName: "Ben", userId: userId("ben") }] } });
  const id = l.body.ledger.id;
  const mA = l.body.members.find((m: any) => m.userId === userId("anna")).id;
  const mB = l.body.members.find((m: any) => m.userId === userId("ben")).id;

  await call("PUT", "/v1/me/notification-prefs", { token: anna, json: { ledgerSettlement: false } });
  await call("POST", `/v1/ledgers/${id}/settlements`, { token: ben, json: { fromMemberId: mB, toMemberId: mA, amountMinor: 2000 } });
  await background.idle();
  assert.equal(push.sent.length, 0, "Empfängerin Anna hat die Art ausgeschaltet");

  await call("PUT", "/v1/me/notification-prefs", { token: anna, json: { ledgerSettlement: true } });
  await call("POST", `/v1/ledgers/${id}/settlements`, { token: ben, json: { fromMemberId: mB, toMemberId: mA, amountMinor: 1550 } });
  await background.idle();
  assert.equal(push.sent.length, 1);
  assert.equal(push.sent[0]!.deviceToken, HEX_A);
  assert.equal(push.sent[0]!.body, "Ben hat dir CHF 15.50 zurückgezahlt");
});

test("push: ungültige Token werden entfernt, ein Gerät gehört nur einer Sitzung", async () => {
  const { db, call, tokens, login, push, background, userId } = await setup();
  db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'ben'").run();
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: HEX_B } });
  push.invalid.add(HEX_B);
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "T", members: [{ displayName: "Ben", userId: userId("ben") }] } });
  const a = l.body.members.find((m: any) => m.displayName === "Anna").id;
  await call("POST", `/v1/ledgers/${l.body.ledger.id}/expenses`, {
    token: anna, json: { paidByMemberId: a, amountMinor: 100, currency: "CHF", split: { mode: "equal" } },
  });
  await background.idle();
  assert.equal(push.sent.length, 1);
  assert.equal(db.prepare("SELECT apns_token FROM api_tokens WHERE apns_token IS NOT NULL").all().length, 0);

  const ben2 = await login("ben", "ben-pw-1234567");
  await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: HEX_A } });
  await call("PUT", "/v1/devices/current", { token: ben2, json: { apnsToken: HEX_A } });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE apns_token = ?").get(HEX_A) as any).n, 1);
});

test("push: Reise-Kommentar an Mitreisende (trip.comment mit Deep-Link), Gast-Kommentar ebenfalls", async () => {
  const { call, tokens, push, background, userId } = await setup();
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  await call("PUT", "/v1/devices/current", { token: anna, json: { apnsToken: HEX_A } });
  const t = await call("POST", "/v1/trips", {
    token: anna,
    json: { title: "Roadtrip", travelers: [{ displayName: "Ben", userId: userId("ben") }, { displayName: "Gerda" }] },
  });
  const id = t.body.trip.id;
  const ev = await call("POST", `/v1/trips/${id}/events`, { token: anna, json: { title: "Hotel", type: "Hotel" } });

  await call("POST", `/v1/trips/${id}/events/${ev.body.eventId}/comments`, { token: ben, json: { body: "Parkplatz?" } });
  await background.idle();
  assert.equal(push.sent.length, 1);
  assert.equal(push.sent[0]!.body, "Ben: Parkplatz?");
  assert.equal(push.sent[0]!.category, "trip.comment");
  assert.equal(push.sent[0]!.threadId, `trip-${id}`);
  assert.equal(push.sent[0]!.data!.deepLink, `travelbuddy://event/${id}/${ev.body.eventId}`);

  const gerda = t.body.travelers.find((x: any) => x.displayName === "Gerda");
  await call("POST", `/v1/guest/trips/${gerda.shareToken}/events/${ev.body.eventId}/comments`, { json: { body: "Bin dabei" } });
  await background.idle();
  assert.equal(push.sent.length, 2);
  assert.equal(push.sent[1]!.body, "Gerda: Bin dabei");
});

test("push: Reisekassen-Meldungen und Reise-Kommentare an eingetragene Teilnehmer mit Konto (auch Nicht-Admins)", async () => {
  const { call, tokens, push, background, userId } = await setup();
  const anna = await tokens.anna();
  const ben = await tokens.ben(); // kein Admin, aber Mitreisender: darf die Reisekasse der Reise lesen
  await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: HEX_B } });
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Ferien", travelers: [{ displayName: "Ben", userId: userId("ben") }] } });
  const annaMember = t.body.travelers.find((x: any) => x.displayName === "Anna").id;
  await call("POST", `/v1/ledgers/${t.body.trip.ledgerId}/expenses`, {
    token: anna, json: { paidByMemberId: annaMember, amountMinor: 1000, currency: "CHF", split: { mode: "equal" } },
  });
  await background.idle();
  assert.equal(push.sent.length, 1, "Ben darf die Reisekasse der Reise öffnen und erhält die Meldung");
  assert.equal(push.sent[0]!.category, "ledger.expense");
  assert.equal(push.sent[0]!.deviceToken, HEX_B);

  const ev = await call("POST", `/v1/trips/${t.body.trip.id}/events`, { token: anna, json: { title: "Hotel" } });
  await call("POST", `/v1/trips/${t.body.trip.id}/events/${ev.body.eventId}/comments`, { token: anna, json: { body: "Zimmer ok" } });
  await background.idle();
  assert.equal(push.sent.length, 2);
  assert.equal(push.sent[1]!.category, "trip.comment");
  assert.equal(push.sent[1]!.deviceToken, HEX_B);
});

test("push: Scheduler-Erweiterungspunkt – deliver respektiert Art, Entdoppelung und Nutzlast", async () => {
  const { db, push, tokens, call } = await setup();
  const anna = await tokens.anna();
  await call("PUT", "/v1/devices/current", { token: anna, json: { apnsToken: HEX_A } });
  const uid = (db.prepare("SELECT id FROM users WHERE username = 'anna'").get() as any).id;
  const notifier = new Notifier(db, push.transport, () => new Date("2026-10-10T08:00:00Z"));
  const notice = {
    userId: uid, kind: "trip.deadline" as const, dedupeKey: "deadline:5:2026-10-20", title: "Storno-Frist", body: "Hotel bis 20.10.2026",
    deepLink: "travelbuddy://event/1/5", tripId: 1, eventId: 5, imageKey: "notif-deadline", interruption: "time-sensitive" as const, relevance: 0.8,
  };
  const r1 = await notifier.deliver([notice]);
  assert.equal(r1.sent, 1);
  const m = push.sent[0]!;
  assert.equal(m.interruptionLevel, "time-sensitive");
  assert.equal(m.category, "trip.deadline");
  assert.equal(m.data!.imageKey, "notif-deadline");
  assert.equal(m.data!.relevance, 0.8);
  assert.equal((await notifier.deliver([notice])).skippedDuplicate, 1);
  await call("PUT", "/v1/me/notification-prefs", { token: anna, json: { tripDeadline: false } });
  assert.equal((await notifier.deliver([{ ...notice, dedupeKey: "andere" }])).skippedPrefs, 1);
});

test("push: Diagnose (Status, Test) nur für Admins", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "AuthKey_ABC123DEFG.p8"), pem());
  const sent: ApnsMessage[] = [];
  const inner: PushTransport = { send: async (m) => (sent.push(m), { ok: true }) };
  const transport = new AutoApnsTransport({ dir, env: {}, create: () => inner });
  const { call, tokens } = await baseSetup({ deps: { push: transport } });
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  assert.equal((await call("GET", "/v1/push/status", { token: ben })).status, 403);
  assert.equal((await call("POST", "/v1/push/test", { token: ben })).status, 403);
  const st = await call("GET", "/v1/push/status", { token: anna });
  assert.equal(st.body.configured, true);
  assert.equal(st.body.topic, "ch.rolfwalker.travelbuddy");
  assert.ok(!JSON.stringify(st.body).includes("PRIVATE KEY"));
  assert.equal((await call("POST", "/v1/push/test", { token: anna })).body.error.code, "no_device");
  await call("PUT", "/v1/devices/current", { token: anna, json: { apnsToken: HEX_A, environment: "development" } });
  const t = await call("POST", "/v1/push/test", { token: anna });
  assert.equal(t.status, 200);
  assert.equal(sent[0]!.title, "TravelBuddy");
});
