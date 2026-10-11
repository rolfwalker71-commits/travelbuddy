import test from "node:test";
import assert from "node:assert/strict";
import { nonAdminMayCall } from "../src/auth/roles";
import { setup } from "./helpers";

test("rollen: Positivliste für Mitreisende mit Konto", () => {
  const ok: Array<[string, string]> = [
    ["GET", "/v1/me"],
    ["GET", "/v1/trips"],
    ["GET", "/v1/trips/12"],
    ["GET", "/v1/trips/12/ics"],
    ["GET", "/v1/trips/12/"],
    ["GET", "/v1/trips/12/day/2026-10-25"],
    ["POST", "/v1/trips/12/events/3/comments"],
    ["DELETE", "/v1/trips/12/events/3/comments/9"],
    ["PUT", "/v1/devices/current"],
    ["PUT", "/v1/live-activities/abc-123"],
    ["DELETE", "/v1/live-activities/abc-123"],
    ["GET", "/v1/summary"],
    ["GET", "/v1/today"],
    ["GET", "/v1/maps/token"],
    ["GET", "/v1/meta/airports"],
    ["GET", "/v1/meta/timezone"],
    // Reisekasse (lesen, Ausgaben/Rückzahlungen erfassen), Dokumente (lesen, hochladen), Inbox
    ["GET", "/v1/ledgers"],
    ["GET", "/v1/ledgers/5"],
    ["GET", "/v1/ledgers/5/expenses"],
    ["POST", "/v1/ledgers/5/expenses"],
    ["PATCH", "/v1/ledgers/5/expenses/9"],
    ["DELETE", "/v1/ledgers/5/expenses/9"],
    ["GET", "/v1/ledgers/5/settlements"],
    ["POST", "/v1/ledgers/5/settlements"],
    ["GET", "/v1/currencies"],
    ["GET", "/v1/fx"],
    ["GET", "/v1/trips/12/documents"],
    ["POST", "/v1/trips/12/documents"],
    ["GET", "/v1/documents/4"],
    ["GET", "/v1/documents/4/file"],
    ["HEAD", "/v1/documents/4/file"],
    ["GET", "/v1/documents/4/thumbnail"],
    ["GET", "/v1/inbox"],
    ["GET", "/v1/media/notification/notif-today"],
    ["GET", "/v1/media/notification/notif-today-dark"],
  ];
  for (const [m, p] of ok) assert.equal(nonAdminMayCall(m, p), true, `${m} ${p}`);

  const no: Array<[string, string]> = [
    ["POST", "/v1/trips"],
    ["GET", "/v1/trips/adopt"],
    ["PATCH", "/v1/trips/12"],
    ["DELETE", "/v1/trips/12"],
    ["POST", "/v1/trips/12/ledger"],
    ["POST", "/v1/trips/12/events/3/confirm"],
    ["POST", "/v1/trips/12/events/3/merge"],
    ["POST", "/v1/trips/12/events/3/geocode"],
    ["POST", "/v1/trips/12/events/3/expense"],
    ["POST", "/v1/trips/12/events"],
    ["PATCH", "/v1/trips/12/events/3"],
    ["DELETE", "/v1/trips/12/events/3"],
    ["GET", "/v1/trips/12/travelers"],
    ["POST", "/v1/ledgers"],
    ["PATCH", "/v1/ledgers/5"],
    ["DELETE", "/v1/ledgers/5"],
    ["POST", "/v1/ledgers/5/members"],
    ["DELETE", "/v1/ledgers/5/settlements/2"],
    ["POST", "/v1/ledgers/5/expenses/9/settle-couple"],
    ["GET", "/v1/users"],
    ["GET", "/v1/users/directory"],
    ["POST", "/v1/documents"],
    ["POST", "/v1/documents/4/analyze"],
    ["DELETE", "/v1/documents/4"],
    ["GET", "/v1/push/status"],
    ["POST", "/v1/push/test"],
    ["POST", "/v1/push/simulate"],
    ["GET", "/v1/me/../ledgers"],
    ["GET", "/v1/trips/12/events/3/comments"],
    ["GET", "/v2/trips"],
  ];
  for (const [m, p] of no) assert.equal(nonAdminMayCall(m, p), false, `${m} ${p}`);
});

async function adminSetup() {
  return setup({
    users: [
      { username: "admin", password: "admin-pw-123456", displayName: "Admin", isAdmin: true },
      { username: "tina", password: "tina-pw-1234567", displayName: "Tina" },
      { username: "zweiter", password: "zweiter-pw-12345", displayName: "Zweiter Admin", isAdmin: true },
    ],
  });
}

test("benutzer: Reisen zuweisen und entziehen, Teilnehmer bleibt als Gast erhalten", async () => {
  const { db, call, login, userId } = await adminSetup();
  const admin = await login("admin", "admin-pw-123456");
  const tina = await login("tina", "tina-pw-1234567");
  const t1 = (await call("POST", "/v1/trips", { token: admin, json: { title: "Tessin" } })).body.trip.id;
  const t2 = (await call("POST", "/v1/trips", { token: admin, json: { title: "Wien" } })).body.trip.id;

  assert.deepEqual((await call("GET", "/v1/trips", { token: tina })).body.trips, []);
  const before = await call("GET", `/v1/users/${userId("tina")}/trips`, { token: admin });
  assert.deepEqual(before.body.trips.map((t: any) => [t.title, t.assigned]).sort(), [["Tessin", false], ["Wien", false]]);

  const set = await call("PUT", `/v1/users/${userId("tina")}/trips`, { token: admin, json: { tripIds: [t1] } });
  assert.deepEqual(set.body.trips.filter((t: any) => t.assigned).map((t: any) => t.title), ["Tessin"]);
  assert.deepEqual((await call("GET", "/v1/trips", { token: tina })).body.trips.map((t: any) => t.title), ["Tessin"]);
  assert.equal((await call("GET", `/v1/trips/${t2}`, { token: tina })).status, 403);

  await call("PUT", `/v1/users/${userId("tina")}/trips`, { token: admin, json: { tripIds: [t1] } });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM participants WHERE trip_id = ? AND user_id = ?").get(t1, userId("tina")) as any).n, 1);

  await call("PUT", `/v1/users/${userId("tina")}/trips`, { token: admin, json: { tripIds: [t2] } });
  assert.deepEqual((await call("GET", "/v1/trips", { token: tina })).body.trips.map((t: any) => t.title), ["Wien"]);
  const guest = db.prepare("SELECT display_name, user_id, share_token FROM participants WHERE trip_id = ? AND display_name = 'Tina'").get(t1) as any;
  assert.equal(guest.user_id, null);
  assert.ok(guest.share_token);
  // Auch in der Reisekasse: dieselbe Person (eine Tabelle)
  const inLedger = db.prepare("SELECT COUNT(*) AS n FROM participants WHERE trip_id = ? AND ledger_id IS NOT NULL").get(t1) as any;
  assert.equal(inLedger.n, 2);

  assert.equal((await call("PUT", `/v1/users/${userId("tina")}/trips`, { token: admin, json: { tripIds: [9999] } })).status, 422);
  assert.equal((await call("PUT", "/v1/users/9999/trips", { token: admin, json: { tripIds: [] } })).status, 404);
  assert.equal((await call("PUT", `/v1/users/${userId("tina")}/trips`, { token: tina, json: { tripIds: [t1, t2] } })).status, 403);
  assert.equal((await call("GET", `/v1/users/${userId("tina")}/trips`, { token: tina })).status, 403);
});

test("benutzer: endgültig löschen, nie sich selbst oder den letzten Admin", async () => {
  const { db, call, login, userId } = await adminSetup();
  const admin = await login("admin", "admin-pw-123456");
  const tina = await login("tina", "tina-pw-1234567");
  const tinaId = userId("tina");

  const trip = (await call("POST", "/v1/trips", { token: admin, json: { title: "Tessin", travelers: [{ displayName: "Tina", userId: tinaId }] } })).body;
  await call("PUT", "/v1/devices/current", { token: tina, json: { apnsToken: "ab".repeat(32) } });

  assert.equal((await call("DELETE", `/v1/users/${tinaId}`, { token: tina })).status, 403);
  assert.equal((await call("DELETE", `/v1/users/${userId("admin")}`, { token: admin })).status, 409);
  assert.equal((await call("DELETE", "/v1/users/9999", { token: admin })).status, 404);

  const del = await call("DELETE", `/v1/users/${tinaId}`, { token: admin });
  assert.equal(del.status, 200);
  assert.equal((await call("GET", "/v1/me", { token: tina })).status, 401);
  assert.equal((await call("POST", "/v1/auth/login", { json: { username: "tina", password: "tina-pw-1234567" } })).status, 401);
  assert.equal(db.prepare("SELECT 1 FROM users WHERE id = ?").get(tinaId), undefined);

  const travelers = db.prepare("SELECT display_name, user_id FROM participants WHERE trip_id = ?").all(trip.trip.id) as any[];
  assert.ok(travelers.some((t) => t.display_name === "Tina" && t.user_id === null));
  const view = await call("GET", `/v1/ledgers/${trip.trip.ledgerId}`, { token: admin });
  assert.ok(view.body.members.some((m: any) => m.displayName === "Tina" && m.userId === null));

  const zweiter = await login("zweiter", "zweiter-pw-12345");
  assert.equal((await call("DELETE", `/v1/users/${userId("admin")}`, { token: zweiter })).status, 200);
  assert.equal((await call("DELETE", `/v1/users/${userId("zweiter")}`, { token: zweiter })).status, 409);
});
