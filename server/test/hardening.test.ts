import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, createUser, issueToken, LoginThrottle, TOKEN_IDLE_DAYS } from "../src/auth/auth";
import { todayLocal } from "../src/lib/dates";
import { convertMinor } from "../src/lib/money";
import { setup as baseSetup } from "./helpers";

async function setup() {
  const s = await baseSetup({
    users: [
      { username: "admin", password: "admin-pw-123456", displayName: "Admin", isAdmin: true },
      { username: "ben", password: "ben-pw-1234567", displayName: "Ben" },
    ],
    deps: { throttle: new LoginThrottle(5, 60_000) },
  });
  const rawCall = async (method: string, path: string, o: { token?: string; json?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
    const res = await s.app.request(path, {
      method,
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.json !== undefined || o.raw !== undefined ? { "content-type": "application/json" } : {}),
        ...o.headers,
      },
      body: o.raw ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const login = async (u: string, p: string, h: Record<string, string> = {}) =>
    (await rawCall("POST", "/v1/auth/login", { json: { username: u, password: p }, headers: h })).body?.token as string;
  return { db: s.db, call: rawCall, login };
}

test("login: gefälschter X-Forwarded-For umgeht die Sperre pro Benutzername nicht", async () => {
  const { call } = await setup();
  let last = 0;
  for (let i = 0; i < 8; i++) {
    last = (
      await call("POST", "/v1/auth/login", { json: { username: "ben", password: "falsch" }, headers: { "x-forwarded-for": `10.0.0.${i}` } })
    ).status;
  }
  assert.equal(last, 429);
});

test("login: richtiges Passwort setzt den Zähler zurück", async () => {
  const { call } = await setup();
  for (let i = 0; i < 3; i++) await call("POST", "/v1/auth/login", { json: { username: "ben", password: "falsch" } });
  assert.equal((await call("POST", "/v1/auth/login", { json: { username: "ben", password: "ben-pw-1234567" } })).status, 200);
  for (let i = 0; i < 4; i++) {
    assert.equal((await call("POST", "/v1/auth/login", { json: { username: "ben", password: "falsch" } })).status, 401);
  }
});

test("token: verfällt nach 180 Tagen ohne Nutzung, Nutzung verlängert das Fenster", async () => {
  const { db } = await setup();
  const uid = (db.prepare("SELECT id FROM users WHERE username = 'ben'").get() as any).id;
  const t0 = new Date("2026-01-01T00:00:00Z").getTime();
  const at = (days: number) => new Date(t0 + days * 86_400_000);
  const fresh = () => {
    const token = issueToken(db, uid);
    db.prepare("UPDATE api_tokens SET created_at = ?, last_used_at = NULL").run(at(0).toISOString());
    return token;
  };
  assert.ok(authenticate(db, fresh(), at(TOKEN_IDLE_DAYS - 1)));
  assert.equal(authenticate(db, fresh(), at(TOKEN_IDLE_DAYS + 1)), null);
  const used = fresh();
  assert.ok(authenticate(db, used, at(100)));
  assert.ok(authenticate(db, used, at(100 + TOKEN_IDLE_DAYS - 1)));
  assert.equal(authenticate(db, fresh(), at(100 + TOKEN_IDLE_DAYS + 5)), null);
});

test("body: zu grosse JSON-Anfragen werden abgelehnt", async () => {
  const { call, login } = await setup();
  const t = await login("admin", "admin-pw-123456");
  const r = await call("POST", "/v1/ledgers", { token: t, raw: JSON.stringify({ title: "x".repeat(2 * 1024 * 1024) }) });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, "payload_too_large");
});

test("benutzer: nur Admins verwalten, letzter Admin bleibt, Passwortwechsel meldet andere Geräte ab", async () => {
  const { call, login, db } = await setup();
  const admin = await login("admin", "admin-pw-123456");
  const ben = await login("ben", "ben-pw-1234567");

  assert.equal((await call("GET", "/v1/users", { token: ben })).status, 403);
  assert.equal((await call("POST", "/v1/users", { token: ben, json: {} })).status, 403);

  const created = await call("POST", "/v1/users", { token: admin, json: { username: "cleo", displayName: "Cleo", password: "cleo-passwort-12" } });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.isAdmin, false);
  assert.equal((await call("POST", "/v1/users", { token: admin, json: { username: "cleo", displayName: "x", password: "noch-ein-passwort" } })).status, 409);
  assert.equal((await call("POST", "/v1/users", { token: admin, json: { username: "kurz", displayName: "x", password: "zu-kurz" } })).status, 422);
  assert.ok(await login("cleo", "cleo-passwort-12"));

  const adminId = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as any).id;
  const demote = await call("PATCH", `/v1/users/${adminId}`, { token: admin, json: { isAdmin: false } });
  assert.equal(demote.status, 409);
  assert.equal(demote.body.error.code, "last_admin");

  const benId = (db.prepare("SELECT id FROM users WHERE username = 'ben'").get() as any).id;
  await call("PATCH", `/v1/users/${benId}`, { token: admin, json: { active: false } });
  assert.equal((await call("GET", "/v1/me", { token: ben })).status, 401);
  assert.equal(await login("ben", "ben-pw-1234567"), undefined);

  const cleo1 = await login("cleo", "cleo-passwort-12");
  const cleo2 = await login("cleo", "cleo-passwort-12");
  assert.equal((await call("POST", "/v1/me/password", { token: cleo1, json: { currentPassword: "falsch", newPassword: "neues-passwort-99" } })).status, 403);
  assert.equal((await call("POST", "/v1/me/password", { token: cleo1, json: { currentPassword: "cleo-passwort-12", newPassword: "neues-passwort-99" } })).status, 200);
  assert.equal((await call("GET", "/v1/me", { token: cleo1 })).status, 200);
  assert.equal((await call("GET", "/v1/me", { token: cleo2 })).status, 401);
  assert.ok(await login("cleo", "neues-passwort-99"));
});

test("geräte: eigene Sitzungen auflisten und abmelden", async () => {
  const { call, login } = await setup();
  const a = await login("ben", "ben-pw-1234567");
  const b = await login("ben", "ben-pw-1234567");
  const list = await call("GET", "/v1/me/devices", { token: a });
  assert.equal(list.body.devices.length, 2);
  assert.equal(list.body.devices.filter((d: any) => d.current).length, 1);
  const other = list.body.devices.find((d: any) => !d.current);
  assert.equal((await call("DELETE", `/v1/me/devices/${other.id}`, { token: a })).status, 200);
  assert.equal((await call("GET", "/v1/me", { token: b })).status, 401);
  assert.equal((await call("DELETE", `/v1/me/devices/${other.id}`, { token: a })).status, 404);
});

test("ausgaben: Dokument und Reise-Ereignis müssen existieren und zur Reise passen", async () => {
  const { call, login, db } = await setup();
  const t = await login("admin", "admin-pw-123456");
  const trip1 = await call("POST", "/v1/trips", { token: t, json: { title: "A" } });
  const trip2 = await call("POST", "/v1/trips", { token: t, json: { title: "B" } });
  const ev2 = await call("POST", `/v1/trips/${trip2.body.trip.id}/events`, { token: t, json: { title: "Hotel B" } });
  const ledgerId = trip1.body.trip.ledgerId;
  const me = (await call("GET", `/v1/ledgers/${ledgerId}`, { token: t })).body.members[0].id;
  const post = (extra: Record<string, unknown>) =>
    call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
      token: t,
      json: { paidByMemberId: me, amountMinor: 1000, currency: "CHF", split: { mode: "equal" }, ...extra },
    });

  const wrongTrip = await post({ tripEventId: ev2.body.eventId });
  assert.equal(wrongTrip.status, 422);
  assert.equal(wrongTrip.body.error.code, "invalid_trip_event");
  assert.equal((await post({ tripEventId: 9999 })).status, 422);
  assert.equal((await post({ documentId: 9999 })).body.error.code, "invalid_document");

  const ev1 = await call("POST", `/v1/trips/${trip1.body.trip.id}/events`, { token: t, json: { title: "Hotel A" } });
  const ok = await post({ tripEventId: ev1.body.eventId });
  assert.equal(ok.status, 201);
  // Die Verknüpfung steht auch am Ereignis
  const detail = await call("GET", `/v1/trips/${trip1.body.trip.id}`, { token: t });
  assert.equal(detail.body.events[0].expenseId, ok.body.expense.id);
  const docId = Number(
    db
      .prepare(
        `INSERT INTO documents (title, file_name, content_type, size_bytes, sha256, created_at, updated_at)
         VALUES ('D', 'd.pdf', 'application/pdf', 1, ?, 'x', 'x')`
      )
      .run("b".repeat(64)).lastInsertRowid
  );
  assert.equal((await post({ documentId: docId })).status, 201);
});

test("heute: Kalendertag in der Zeitzone, nicht UTC", () => {
  assert.equal(todayLocal(new Date("2026-10-09T23:30:00Z"), "Europe/Zurich"), "2026-10-10");
  assert.equal(todayLocal(new Date("2026-10-09T23:30:00Z"), "UTC"), "2026-10-09");
  assert.equal(todayLocal(new Date("2026-12-31T23:30:00Z"), "Europe/Zurich"), "2027-01-01");
  assert.equal(todayLocal(new Date("2026-12-31T22:30:00Z"), "Europe/Zurich"), "2026-12-31");
  assert.equal(todayLocal(new Date("2026-10-25T03:00:00Z"), "America/New_York"), "2026-10-24");
});

test("umrechnung: Halbwerte runden ohne Fliesskomma-Rauschen", () => {
  assert.equal(convertMinor(1005, "EUR", "CHF", 0.5), 503);
  assert.equal(convertMinor(1, "EUR", "CHF", 0.5), 1);
  assert.equal(convertMinor(-1005, "EUR", "CHF", 0.5), -503);
  assert.equal(convertMinor(33, "EUR", "CHF", 0.15), 5);
});

test("benutzerverzeichnis: nur für Admins, nur aktive, ohne sensible Felder", async () => {
  const { call, login, db } = await setup();
  const admin = await login("admin", "admin-pw-123456");
  const ben = await login("ben", "ben-pw-1234567");
  await createUser(db, { username: "weg", password: "weg-passwort-123", displayName: "Weg" });
  db.prepare("UPDATE users SET active = 0 WHERE username = 'weg'").run();
  const r = await call("GET", "/v1/users/directory", { token: admin });
  assert.deepEqual(r.body.users.map((u: any) => u.displayName), ["Admin", "Ben"]);
  assert.deepEqual(Object.keys(r.body.users[0]).sort(), ["displayName", "id"]);
  assert.equal((await call("GET", "/v1/users/directory", { token: ben })).status, 403);
});

test("overview: myMemberId, soloMemberId bleibt für Altclients null", async () => {
  const { call, login } = await setup();
  const t = await login("admin", "admin-pw-123456");
  const l = await call("POST", "/v1/ledgers", { token: t, json: { title: "WG", members: [{ displayName: "Gast" }] } });
  const me = l.body.members.find((m: any) => m.displayName === "Admin");
  assert.equal(l.body.myMemberId, me.id);
  const o = await call("GET", `/v1/ledgers/${l.body.ledger.id}`, { token: t });
  assert.equal(o.body.myMemberId, me.id);
  assert.equal(o.body.soloMemberId, null);
  assert.equal(o.body.ledger.kind, "split");
  assert.equal(o.body.members[0].hidden, false);
  const patched = await call("PATCH", `/v1/ledgers/${l.body.ledger.id}`, { token: t, json: { title: "Y" } });
  assert.equal(patched.body.myMemberId, me.id);
});

test("ausgabe ändern: exakte und Paar-Aufteilung werden proportional neu berechnet", async () => {
  const { call, login } = await setup();
  const t = await login("admin", "admin-pw-123456");
  const l = await call("POST", "/v1/ledgers", { token: t, json: { title: "Ski", members: [{ displayName: "Anna" }, { displayName: "Cleo" }] } });
  const id = l.body.ledger.id;
  const m = Object.fromEntries(l.body.members.map((x: any) => [x.displayName, x.id]));

  const e = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: t,
    json: {
      paidByMemberId: m.Admin, amountMinor: 10000, currency: "CHF",
      split: { mode: "exact", amounts: [{ memberId: m.Anna, amountBaseMinor: 6000 }, { memberId: m.Cleo, amountBaseMinor: 4000 }] },
    },
  });
  const up = await call("PATCH", `/v1/ledgers/${id}/expenses/${e.body.expense.id}`, { token: t, json: { amountMinor: 20000 } });
  assert.equal(up.status, 200);
  const by = Object.fromEntries(up.body.expense.splits.map((s: any) => [s.memberId, s.shareBaseMinor]));
  assert.deepEqual(by, { [m.Anna]: 12000, [m.Cleo]: 8000 });
  assert.equal(up.body.expense.splitMode, "exact");

  const couple = await call("POST", `/v1/ledgers/${id}/couples`, { token: t, json: { memberIds: [m.Admin, m.Anna] } });
  const ce = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: t,
    json: { paidByMemberId: m.Admin, amountMinor: 3000, currency: "CHF", split: { mode: "coupleEqual", coupleIds: [couple.body.couple.id] } },
  });
  const cu = await call("PATCH", `/v1/ledgers/${id}/expenses/${ce.body.expense.id}`, { token: t, json: { amountMinor: 5000 } });
  assert.deepEqual(cu.body.expense.splits.map((s: any) => s.shareBaseMinor).sort(), [2500, 2500]);
});

test("validierung: deutsche Meldung und Feldliste in details", async () => {
  const { call, login } = await setup();
  const t = await login("admin", "admin-pw-123456");
  const r = await call("POST", "/v1/ledgers", { token: t, json: { baseCurrency: "FR", members: [{ displayName: "" }] } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "validation_failed");
  assert.match(r.body.error.message, /^Ungültige Eingabe: «title» fehlt$/);
  const fields = r.body.error.details.fields.map((f: any) => f.field).sort();
  assert.deepEqual(fields, ["baseCurrency", "members.0.displayName", "title"]);
  assert.ok(r.body.error.details.fields.every((f: any) => !/Invalid|expected/i.test(f.message)));
  const badEnum = await call("POST", "/v1/auth/login", { json: { username: "a", password: "b", platform: "amiga" } });
  assert.match(badEnum.body.error.message, /nicht erlaubt \(erlaubt: ios, ipados, macos, visionos, web\)/);
});

test("abrechnungen: archived=only, Währungsliste", async () => {
  const { call, login } = await setup();
  const t = await login("admin", "admin-pw-123456");
  await call("POST", "/v1/ledgers", { token: t, json: { title: "Aktiv" } });
  const b = await call("POST", "/v1/ledgers", { token: t, json: { title: "Alt" } });
  await call("PATCH", `/v1/ledgers/${b.body.ledger.id}`, { token: t, json: { archived: true } });
  const titles = async (q: string) => (await call("GET", `/v1/ledgers${q}`, { token: t })).body.ledgers.map((l: any) => l.title).sort();
  assert.deepEqual(await titles(""), ["Aktiv"]);
  assert.deepEqual(await titles("?archived=only"), ["Alt"]);
  assert.deepEqual(await titles("?archived=include"), ["Aktiv", "Alt"]);
  const cur = await call("GET", "/v1/currencies", { token: t });
  assert.equal(cur.body.currencies.find((c: any) => c.code === "JPY").exponent, 0);
});

test("live activities: anmelden, ändern, abmelden; nur eigene Reisen", async () => {
  const { call, login, db } = await setup();
  const admin = await login("admin", "admin-pw-123456");
  const ben = await login("ben", "ben-pw-1234567");
  const t = await call("POST", "/v1/trips", { token: admin, json: { title: "Live" } });
  const tripId = t.body.trip.id;
  const ev = await call("POST", `/v1/trips/${tripId}/events`, { token: admin, json: { title: "Flug", type: "Flug" } });
  const body = { pushToken: "ab".repeat(20), tripId, kind: "flight", eventId: ev.body.eventId };

  assert.equal((await call("PUT", "/v1/live-activities/act-1", { token: admin, json: body })).status, 200);
  assert.equal((await call("PUT", "/v1/live-activities/act-1", { token: admin, json: { ...body, kind: "day", eventId: null } })).status, 200);
  assert.equal((db.prepare("SELECT kind FROM live_activities WHERE activity_id = 'act-1'").get() as any).kind, "day");
  assert.equal((await call("PUT", "/v1/live-activities/act-2", { token: admin, json: { ...body, kind: "bogus" } })).status, 422);
  // Ben ist nicht Teilnehmer der Reise
  assert.equal((await call("PUT", "/v1/live-activities/act-3", { token: ben, json: body })).status, 403);
  assert.equal((await call("DELETE", "/v1/live-activities/act-1", { token: admin })).status, 200);
  assert.equal(db.prepare("SELECT 1 FROM live_activities").get(), undefined);
});
