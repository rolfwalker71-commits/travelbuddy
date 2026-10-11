import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers";

test("auth: Login, Token (tb_), Logout, falsche Daten", async () => {
  const { call, tokens } = await setup();

  assert.equal((await call("GET", "/v1/me")).status, 401);
  const bad = await call("POST", "/v1/auth/login", { json: { username: "anna", password: "falsch" } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "invalid_credentials");

  const token = await tokens.anna();
  assert.match(token, /^tb_/);
  const me = await call("GET", "/v1/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.displayName, "Anna");
  assert.equal(me.body.user.isAdmin, true);

  assert.equal((await call("POST", "/v1/auth/logout", { token })).status, 200);
  assert.equal((await call("GET", "/v1/me", { token })).status, 401);
});

test("auth: Login wird nach zu vielen Fehlversuchen gedrosselt", async () => {
  const { call } = await setup();
  let last = 0;
  for (let i = 0; i < 9; i++) {
    last = (await call("POST", "/v1/auth/login", { json: { username: "ben", password: "x" } })).status;
  }
  assert.equal(last, 429);
});

test("Reisekasse: Reise zu dritt, Saldo und Ausgleich auf den Rappen", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();

  const created = await call("POST", "/v1/ledgers", {
    token: anna,
    json: { title: "Sardinien", members: [{ displayName: "Ben" }, { displayName: "Cleo" }] },
  });
  assert.equal(created.status, 201);
  const ledgerId = created.body.ledger.id as number;
  const [mAnna, mBen, mCleo] = ["Anna", "Ben", "Cleo"].map(
    (n) => created.body.members.find((m: any) => m.displayName === n).id as number
  );

  // Anna zahlt 100.00 für alle drei → 33.33 / 33.33 / 33.34
  const e1 = await call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
    token: anna,
    json: { paidByMemberId: mAnna, amountMinor: 10000, currency: "CHF", description: "Mietwagen", expenseDate: "2026-09-12", split: { mode: "equal" } },
  });
  assert.equal(e1.status, 201);
  const shares = e1.body.expense.splits.map((s: any) => s.shareBaseMinor).sort();
  assert.deepEqual(shares, [3333, 3333, 3334]);
  assert.equal(shares.reduce((a: number, b: number) => a + b, 0), 10000);

  // Ben zahlt 30.00 nur für Ben und Cleo.
  await call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
    token: anna,
    json: { paidByMemberId: mBen, amountMinor: 3000, currency: "CHF", description: "Glacé", split: { mode: "equal", memberIds: [mBen, mCleo] } },
  });

  const overview = await call("GET", `/v1/ledgers/${ledgerId}`, { token: anna });
  const net = Object.fromEntries(overview.body.balances.map((b: any) => [b.displayName, b.netMinor]));
  assert.equal(Object.values(net).reduce((a: number, b) => a + (b as number), 0), 0);
  assert.equal(overview.body.totals.expenseMinor, 13000);
  assert.ok(net.Anna > 0);
  assert.ok(net.Cleo < 0);

  for (const t of overview.body.suggestedTransfers) {
    const r = await call("POST", `/v1/ledgers/${ledgerId}/settlements`, {
      token: anna,
      json: { fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, amountMinor: t.amountMinor },
    });
    assert.equal(r.status, 201);
  }
  const after = await call("GET", `/v1/ledgers/${ledgerId}`, { token: anna });
  assert.ok(after.body.balances.every((b: any) => b.netMinor === 0));
  assert.deepEqual(after.body.suggestedTransfers, []);

  // «Nach Zahler» verrechnet nur paarweise; ein übrig gebliebener Ring hebt sich für jede Person zu 0 auf.
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, number>();
  for (const d of after.body.payerDebts) {
    outgoing.set(d.fromMemberId, (outgoing.get(d.fromMemberId) ?? 0) + d.amountMinor);
    incoming.set(d.toMemberId, (incoming.get(d.toMemberId) ?? 0) + d.amountMinor);
  }
  for (const id of new Set([...incoming.keys(), ...outgoing.keys()])) {
    assert.equal(incoming.get(id) ?? 0, outgoing.get(id) ?? 0);
  }
});

test("Ausgaben: Fremdwährung, exakte Aufteilung, Validierung", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Paris", members: [{ displayName: "Ben" }] } });
  const id = l.body.ledger.id;
  const [a, b] = ["Anna", "Ben"].map((n) => l.body.members.find((m: any) => m.displayName === n).id);

  const noRate = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 5000, currency: "EUR", split: { mode: "equal" } },
  });
  assert.equal(noRate.status, 422);
  assert.equal(noRate.body.error.code, "exchange_rate_required");

  // 50.00 EUR * 0.93 = 46.50 CHF
  const ok = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 5000, currency: "eur", exchangeRate: 0.93, split: { mode: "equal" } },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.expense.amountBaseMinor, 4650);
  assert.equal(ok.body.expense.currency, "EUR");

  const wrong = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 1000, currency: "CHF", split: { mode: "exact", amounts: [{ memberId: a, amountBaseMinor: 400 }, { memberId: b, amountBaseMinor: 500 }] } },
  });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.error.code, "split_sum_mismatch");

  const float = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 10.5, currency: "CHF", split: { mode: "equal" } },
  });
  assert.equal(float.status, 422);

  const patched = await call("PATCH", `/v1/ledgers/${id}/expenses/${ok.body.expense.id}`, { token: anna, json: { amountMinor: 5001 } });
  assert.equal(patched.status, 200);
  assert.equal(
    patched.body.expense.splits.reduce((s: number, x: any) => s + x.shareBaseMinor, 0),
    patched.body.expense.amountBaseMinor
  );
});

test("Nacherfasst: bereits ausgeglichen hält Saldo neutral, Löschen räumt auf", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Wochenende", members: [{ displayName: "Ben" }] } });
  const id = l.body.ledger.id;
  const a = l.body.members.find((m: any) => m.displayName === "Anna").id;

  const e = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: a, amountMinor: 8000, currency: "CHF", split: { mode: "equal" }, preSettled: true },
  });
  assert.equal(e.body.expense.settledStatus, 1);

  const o = await call("GET", `/v1/ledgers/${id}`, { token: anna });
  assert.ok(o.body.balances.every((b: any) => b.netMinor === 0));
  assert.equal(o.body.totals.expenseMinor, 8000);

  const settlements = await call("GET", `/v1/ledgers/${id}/settlements`, { token: anna });
  assert.equal(settlements.body.settlements.length, 1);
  assert.equal(settlements.body.settlements[0].auto, true);
  const del = await call("DELETE", `/v1/ledgers/${id}/settlements/${settlements.body.settlements[0].id}`, { token: anna });
  assert.equal(del.status, 409);

  await call("DELETE", `/v1/ledgers/${id}/expenses/${e.body.expense.id}`, { token: anna });
  const after = await call("GET", `/v1/ledgers/${id}/settlements`, { token: anna });
  assert.equal(after.body.settlements.length, 0);
});

test("Paare: coupleEqual und manueller Paar-Ausgleich", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Skiwoche", members: [{ displayName: "Ben" }, { displayName: "Cleo" }] } });
  const id = l.body.ledger.id;
  const m = Object.fromEntries(l.body.members.map((x: any) => [x.displayName, x.id]));

  const couple = await call("POST", `/v1/ledgers/${id}/couples`, { token: anna, json: { memberIds: [m.Anna, m.Ben] } });
  assert.equal(couple.status, 201);
  const dup = await call("POST", `/v1/ledgers/${id}/couples`, { token: anna, json: { memberIds: [m.Ben, m.Cleo] } });
  assert.equal(dup.status, 409);

  const e = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: m.Cleo, amountMinor: 9000, currency: "CHF", split: { mode: "coupleEqual", coupleIds: [couple.body.couple.id] } },
  });
  assert.equal(e.status, 201);
  const byMember = Object.fromEntries(e.body.expense.splits.map((s: any) => [s.memberId, s.shareBaseMinor]));
  assert.equal(byMember[m.Anna], 4500);
  assert.equal(byMember[m.Ben], 4500);

  const e2 = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: m.Anna, amountMinor: 2000, currency: "CHF", split: { mode: "equal", memberIds: [m.Anna, m.Ben] } },
  });
  const settle = await call("POST", `/v1/ledgers/${id}/expenses/${e2.body.expense.id}/settle-couple`, { token: anna });
  assert.equal(settle.status, 200);
  assert.equal(settle.body.expense.settledStatus, 2);
  const again = await call("POST", `/v1/ledgers/${id}/expenses/${e2.body.expense.id}/settle-couple`, { token: anna });
  assert.equal(again.status, 409);

  // Paare erscheinen mit coupleId auch als Reise-Teilnehmer (eine Tabelle, zwei Sichten)
  const overview = await call("GET", `/v1/ledgers/${id}`, { token: anna });
  assert.equal(overview.body.members.find((x: any) => x.id === m.Anna).coupleId, couple.body.couple.id);
});

test("Zugriff: eigenständige Reisekassen (ohne Reise) sind Administratoren vorbehalten, auch für verknüpfte Mitglieder", async () => {
  const { call, tokens, userId } = await setup();
  const anna = await tokens.anna();
  const ben = await tokens.ben();
  const cleo = await tokens.cleo();

  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Haushalt" } });
  const id = l.body.ledger.id;
  await call("POST", `/v1/ledgers/${id}/members`, { token: anna, json: { displayName: "Cleo", userId: userId("cleo") } });

  assert.equal((await call("GET", `/v1/ledgers/${id}`, { token: anna })).status, 200);
  for (const token of [ben, cleo]) {
    assert.equal((await call("GET", `/v1/ledgers/${id}`, { token })).status, 403);
    // Die Liste enthält für Mitreisende nur Reisekassen eigener Reisen
    const list = await call("GET", "/v1/ledgers", { token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.ledgers, []);
    assert.equal((await call("POST", "/v1/ledgers", { token, json: { title: "X" } })).status, 403);
    assert.equal((await call("POST", `/v1/ledgers/${id}/expenses`, { token, json: {} })).status, 403);
  }
  const guestLink = (await call("GET", `/v1/ledgers/${id}`, { token: anna })).body.members.find((m: any) => m.displayName === "Cleo");
  assert.equal((await call("GET", `/v1/guest/${guestLink.inviteToken}`)).status, 200, "Link funktioniert weiterhin");
});

test("Mitglieder: mit Buchungen nicht entfernbar", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "T", members: [{ displayName: "Ben" }] } });
  const id = l.body.ledger.id;
  const m = Object.fromEntries(l.body.members.map((x: any) => [x.displayName, x.id]));
  await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: m.Anna, amountMinor: 1000, currency: "CHF", split: { mode: "equal" } },
  });
  const r = await call("DELETE", `/v1/ledgers/${id}/members/${m.Ben}`, { token: anna });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "member_in_use");
});

test("Wechselkurs: ECB-Antwort wird durchgereicht", async () => {
  const { call, tokens, fetchCalls } = await setup();
  const anna = await tokens.anna();
  const r = await call("GET", "/v1/fx?from=EUR&to=CHF&date=2026-10-09", { token: anna });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { from: "EUR", to: "CHF", rate: 0.931235, date: "2026-10-09", source: "ECB" });
  assert.match(fetchCalls[0]!, /frankfurter\.dev\/v1\/2026-10-09\?base=EUR&symbols=CHF/);

  assert.equal((await call("GET", "/v1/fx?from=EUR", { token: anna })).status, 400);
  const same = await call("GET", "/v1/fx?from=CHF&to=CHF", { token: anna });
  assert.equal(same.body.rate, 1);
});

test("Gäste: Zugriff nur mit Einladungs-Token, nur eigene Buchungen änderbar", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", {
    token: anna,
    json: { title: "Roadtrip", members: [{ displayName: "Gast Gerda" }, { displayName: "Gast Hans" }] },
  });
  const id = l.body.ledger.id;
  const byName = Object.fromEntries(l.body.members.map((m: any) => [m.displayName, m]));
  const gerda = byName["Gast Gerda"];
  const hans = byName["Gast Hans"];
  assert.ok(gerda.inviteToken && hans.inviteToken);

  assert.equal((await call("GET", "/v1/guest/gibts-nicht")).status, 404);

  const view = await call("GET", `/v1/guest/${gerda.inviteToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.me.displayName, "Gast Gerda");
  assert.ok(view.body.members.every((m: any) => m.inviteToken === undefined));

  const created = await call("POST", `/v1/guest/${gerda.inviteToken}/expenses`, {
    json: { paidByMemberId: gerda.id, amountMinor: 4200, currency: "CHF", description: "Tanken", split: { mode: "equal" } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.expense.createdByMemberId, gerda.id);

  const annaMember = l.body.members.find((m: any) => m.displayName === "Anna");
  const annas = await call("POST", `/v1/ledgers/${id}/expenses`, {
    token: anna,
    json: { paidByMemberId: annaMember.id, amountMinor: 1000, currency: "CHF", split: { mode: "equal" } },
  });
  assert.equal((await call("PATCH", `/v1/guest/${gerda.inviteToken}/expenses/${annas.body.expense.id}`, { json: { description: "manipuliert" } })).status, 403);
  assert.equal((await call("DELETE", `/v1/guest/${gerda.inviteToken}/expenses/${annas.body.expense.id}`)).status, 403);

  const ownPatch = await call("PATCH", `/v1/guest/${gerda.inviteToken}/expenses/${created.body.expense.id}`, { json: { description: "Tanken Autobahn" } });
  assert.equal(ownPatch.status, 200);
  assert.equal(ownPatch.body.expense.description, "Tanken Autobahn");

  assert.equal((await call("GET", `/v1/ledgers/${id}`)).status, 401);

  const revoked = await call("POST", `/v1/ledgers/${id}/members/${hans.id}/invite/revoke`, { token: anna });
  assert.equal(revoked.body.member.inviteToken, null);
  assert.equal((await call("GET", `/v1/guest/${hans.inviteToken}`)).status, 404);
  const rotated = await call("POST", `/v1/ledgers/${id}/members/${hans.id}/invite/rotate`, { token: anna });
  assert.ok(rotated.body.member.inviteToken && rotated.body.member.inviteToken !== hans.inviteToken);
  assert.equal((await call("GET", `/v1/guest/${rotated.body.member.inviteToken}`)).status, 200);

  await call("PATCH", `/v1/ledgers/${id}`, { token: anna, json: { archived: true } });
  const blocked = await call("POST", `/v1/guest/${gerda.inviteToken}/expenses`, {
    json: { paidByMemberId: gerda.id, amountMinor: 100, currency: "CHF", split: { mode: "equal" } },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "archived");
  assert.equal((await call("GET", `/v1/guest/${gerda.inviteToken}`)).status, 200);
});

test("Reisekasse anlegen: Teilnehmer direkt mit Konto verknüpfen", async () => {
  const { call, tokens, userId } = await setup();
  const anna = await tokens.anna();
  const benId = userId("ben");

  const l = await call("POST", "/v1/ledgers", {
    token: anna,
    json: { title: "Mit Konten", members: [{ displayName: "Ben", userId: benId }, { displayName: "Gast Gerda" }] },
  });
  assert.equal(l.status, 201);
  assert.equal(l.body.members.find((m: any) => m.displayName === "Ben").userId, benId);
  assert.equal(l.body.members.find((m: any) => m.displayName === "Gast Gerda").userId, null);

  const selfAgain = await call("POST", "/v1/ledgers", { token: anna, json: { title: "X", members: [{ displayName: "Anna 2", userId: userId("anna") }] } });
  assert.equal(selfAgain.status, 409);
  assert.equal(selfAgain.body.error.code, "user_already_member");
  const twice = await call("POST", "/v1/ledgers", {
    token: anna,
    json: { title: "X", members: [{ displayName: "B1", userId: benId }, { displayName: "B2", userId: benId }] },
  });
  assert.equal(twice.status, 409);
  const unknown = await call("POST", "/v1/ledgers", { token: anna, json: { title: "X", members: [{ displayName: "?", userId: 99999 }] } });
  assert.equal(unknown.status, 422);
  const all = await call("GET", "/v1/ledgers", { token: anna });
  assert.equal(all.body.ledgers.filter((x: any) => x.title === "X").length, 0, "fehlgeschlagene Anlage hinterlässt nichts");
});

test("Gäste: Währungsliste über den Einladungs-Link", async () => {
  const { call, tokens } = await setup();
  const anna = await tokens.anna();
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Reise", members: [{ displayName: "Gast Gerda" }] } });
  const gerda = l.body.members.find((m: any) => m.displayName === "Gast Gerda");

  assert.equal((await call("GET", "/v1/guest/gibts-nicht/currencies")).status, 404);
  const r = await call("GET", `/v1/guest/${gerda.inviteToken}/currencies`);
  assert.equal(r.status, 200);
  const authed = await call("GET", "/v1/currencies", { token: anna });
  assert.deepEqual(r.body.currencies, authed.body.currencies);
  assert.ok(r.body.currencies.length > 10);
});

test("Geräte: App-Version, Push-Umgebung, Push-to-Start-Token und Plattform", async () => {
  const { call, tokens, db } = await setup();
  const ben = await tokens.ben();
  const put = await call("PUT", "/v1/devices/current", {
    token: ben,
    json: { apnsToken: "ab".repeat(32), environment: "development", appVersion: "1.0 (7)", pushToStartToken: "cd".repeat(40), platform: "ipados" },
  });
  assert.equal(put.status, 200);
  const list = await call("GET", "/v1/me/devices", { token: ben });
  const current = list.body.devices.find((d: any) => d.current);
  assert.equal(current.appVersion, "1.0 (7)");
  assert.equal(current.environment, "development");
  assert.equal(current.push, true);
  const row = db.prepare("SELECT push_to_start_token, platform FROM api_tokens WHERE user_id = (SELECT id FROM users WHERE username='ben')").get() as any;
  assert.equal(row.push_to_start_token, "cd".repeat(40));
  assert.equal(row.platform, "ipados");

  // Teilaktualisierung lässt den APNs-Token unberührt
  await call("PUT", "/v1/devices/current", { token: ben, json: { appVersion: "1.0 (8)" } });
  const again = (await call("GET", "/v1/me/devices", { token: ben })).body.devices.find((d: any) => d.current);
  assert.equal(again.push, true);
  assert.equal(again.appVersion, "1.0 (8)");
  // null entfernt
  await call("PUT", "/v1/devices/current", { token: ben, json: { apnsToken: null } });
  assert.equal((await call("GET", "/v1/me/devices", { token: ben })).body.devices.find((d: any) => d.current).push, false);
});

test("Mitteilungs-Einstellungen: Arten und Vorlaufzeiten", async () => {
  const { call, tokens } = await setup();
  const ben = await tokens.ben();
  const def = await call("GET", "/v1/me/notification-prefs", { token: ben });
  assert.equal(def.body.prefs.tripToday, true);
  assert.deepEqual(def.body.prefs.leadTimes.departHours, [24, 3, 1]);
  assert.equal(def.body.prefs.leadTimes.todayBriefing, "07:30");

  const put = await call("PUT", "/v1/me/notification-prefs", {
    token: ben,
    json: { tripDeadline: false, ledgerExpense: false, leadTimes: { departHours: [2, 12], todayBriefing: "08:00" } },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.prefs.tripDeadline, false);
  assert.equal(put.body.prefs.tripComment, true);
  assert.deepEqual(put.body.prefs.leadTimes.departHours, [12, 2]);
  assert.equal(put.body.prefs.leadTimes.todayBriefing, "08:00");
  assert.equal(put.body.prefs.leadTimes.checkoutMinutes, 60);

  const bad = await call("PUT", "/v1/me/notification-prefs", { token: ben, json: { leadTimes: { todayBriefing: "7 Uhr" } } });
  assert.equal(bad.status, 422);
});
