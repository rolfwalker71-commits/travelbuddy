import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackground } from "../src/lib/background";
import { pdfForm, setup } from "./helpers";

const users = [
  { username: "anna", password: "anna-pw-123456", displayName: "Anna", isAdmin: true },
  { username: "ben", password: "ben-pw-1234567", displayName: "Ben" },
  { username: "cleo", password: "cleo-pw-123456", displayName: "Cleo" },
  { username: "dora", password: "dora-pw-123456", displayName: "Dora" },
];

/** Reise 1 mit Ben und Cleo, Reise 2 mit Dora; Dokumente je Reise. */
async function rolesSetup() {
  const background = createBackground();
  const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-roles-docs-"));
  const s = await setup({ users, deps: { background, documentsDir } });
  const anna = await s.login("anna", "anna-pw-123456");
  const ben = await s.login("ben", "ben-pw-1234567");
  const cleo = await s.login("cleo", "cleo-pw-123456");
  const dora = await s.login("dora", "dora-pw-123456");
  const t1 = await s.call("POST", "/v1/trips", {
    token: anna,
    json: {
      title: "Ferien",
      startDate: "2026-10-20",
      endDate: "2026-10-30",
      travelers: [{ displayName: "Ben", userId: s.userId("ben") }, { displayName: "Cleo", userId: s.userId("cleo") }],
    },
  });
  const t2 = await s.call("POST", "/v1/trips", {
    token: anna,
    json: { title: "Andere Reise", startDate: "2026-10-20", endDate: "2026-10-30", travelers: [{ displayName: "Dora", userId: s.userId("dora") }] },
  });
  const trip1 = t1.body.trip.id as number;
  const trip2 = t2.body.trip.id as number;
  const upload = async (token: string, tripId: number, name: string, extra: string) => {
    const r = await s.call("POST", `/v1/trips/${tripId}/documents`, { token, form: pdfForm(name, extra) });
    return r;
  };
  const d1 = await upload(anna, trip1, "Hotel.pdf", "eins");
  const d2 = await upload(anna, trip2, "Geheim.pdf", "zwei");
  await background.idle();
  return {
    ...s, background, documentsDir, anna, ben, cleo, dora, trip1, trip2, upload,
    ledger1: t1.body.trip.ledgerId as number,
    ledger2: t2.body.trip.ledgerId as number,
    travelers1: t1.body.travelers as Array<{ id: number; displayName: string }>,
    doc1: d1.body.document.id as number,
    doc2: d2.body.document.id as number,
  };
}

test("rollen: Mitreisende lesen und laden Dokumente der eigenen Reise, fremde nie (auch nicht Download)", async () => {
  const r = await rolesSetup();
  const { call, ben, dora, trip1, trip2, doc1, doc2, anna, background } = r;

  const list = await call("GET", `/v1/trips/${trip1}/documents`, { token: ben });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.documents.map((d: any) => d.id), [doc1]);
  assert.equal((await call("GET", `/v1/trips/${trip2}/documents`, { token: ben })).status, 403);
  assert.equal((await call("GET", `/v1/trips/${trip1}/documents`, { token: dora })).status, 403);
  assert.equal((await call("GET", "/v1/trips/9999/documents", { token: ben })).status, 404);

  const detail = await call("GET", `/v1/documents/${doc1}`, { token: ben });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.document.fileName, "Hotel.pdf");

  const file = await call("GET", `/v1/documents/${doc1}/file`, { token: ben });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "application/pdf");
  const range = await call("GET", `/v1/documents/${doc1}/file`, { token: ben, headers: { range: "bytes=0-4" } });
  assert.equal(range.status, 206);
  const thumb = await call("GET", `/v1/documents/${doc1}/thumbnail`, { token: ben });
  assert.ok([200, 404].includes(thumb.status), "Vorschau: Bild oder 404 thumbnail_unavailable, nie 403");
  if (thumb.status === 404) assert.equal(thumb.body.error.code, "thumbnail_unavailable");

  // fremde Reise: Detail, Original, Vorschau
  for (const suffix of ["", "/file", "/thumbnail"]) {
    const x = await call("GET", `/v1/documents/${doc2}${suffix}`, { token: ben });
    assert.equal(x.status, 403, `Dokument 2${suffix} ist für Ben gesperrt`);
  }
  assert.equal((await call("GET", `/v1/documents/${doc1}/file`, { token: dora })).status, 403);
  assert.equal((await call("GET", "/v1/documents/9999", { token: ben })).status, 403, "unbekannt und fremd nicht unterscheidbar");

  // lesen ohne Anmeldung
  assert.equal((await call("GET", `/v1/documents/${doc1}/file`)).status, 401);

  // Verwaltung bleibt Administratoren vorbehalten
  assert.equal((await call("DELETE", `/v1/documents/${doc1}`, { token: ben })).status, 403);
  assert.equal((await call("POST", `/v1/documents/${doc1}/analyze`, { token: ben })).status, 403);
  assert.equal((await call("POST", "/v1/documents", { token: ben, form: pdfForm("x.pdf", "x") })).status, 403);

  // Die Anhebung gilt nur für die eine Anfrage: danach ist Ben wieder Nicht-Admin
  assert.equal((await call("GET", "/v1/users", { token: ben })).status, 403);
  await background.idle();
  assert.equal((await call("GET", `/v1/documents/${doc1}`, { token: anna })).status, 200);
});

test("rollen: Mitreisende laden Dokumente für die eigene Reise hoch, nicht für fremde; Ereignis muss zur Reise gehören", async () => {
  const r = await rolesSetup();
  const { call, ben, trip1, trip2, anna, background, db, userId } = r;
  const up = await call("POST", `/v1/trips/${trip1}/documents`, { token: ben, form: pdfForm("Boarding.pdf", "drei") });
  assert.equal(up.status, 202);
  assert.deepEqual(up.body.document.tripIds, [trip1]);
  const id = up.body.document.id;
  assert.equal((db.prepare("SELECT created_by_user_id AS u FROM documents WHERE id = ?").get(id) as any).u, userId("ben"));
  await background.idle();

  const list = await call("GET", `/v1/trips/${trip1}/documents`, { token: ben });
  assert.ok(list.body.documents.some((d: any) => d.id === id));

  assert.equal((await call("POST", `/v1/trips/${trip2}/documents`, { token: ben, form: pdfForm("Fremd.pdf", "vier") })).status, 403);

  // Ereignis einer anderen Reise: abgelehnt (kein Verknüpfen über Reisegrenzen)
  const ev2 = await call("POST", `/v1/trips/${trip2}/events`, { token: anna, json: { title: "Hotel", type: "Hotel" } });
  const bad = await call("POST", `/v1/trips/${trip1}/documents`, {
    token: ben,
    form: pdfForm("Fremd2.pdf", "fünf", { eventId: String(ev2.body.eventId) }),
  });
  assert.ok([404, 422].includes(bad.status), `Ereignis fremder Reise: ${bad.status}`);
  const files = await call("POST", `/v1/trips/${trip1}/documents`, { token: ben, form: new FormData() });
  assert.equal(files.status, 400);
  assert.equal(files.body.error.code, "file_required");
});

test("rollen: Inbox nur mit Dokumenten und Vorschlägen der eigenen Reisen", async () => {
  const r = await rolesSetup();
  const { call, ben, anna, trip1, trip2, doc1, doc2, db, background } = r;
  // unzugeordnetes Dokument (Einwurf des Administrators)
  const loose = await call("POST", "/v1/documents", { token: anna, form: pdfForm("Einwurf.pdf", "lose") });
  assert.equal(loose.status, 202);
  await background.idle();
  db.prepare("UPDATE documents SET analysis_status = 'failed' WHERE id IN (?, ?)").run(doc1, doc2);
  await call("POST", `/v1/trips/${trip1}/events`, { token: anna, json: { title: "Vorschlag A", type: "Ausflug", status: "needs_review" } });
  await call("POST", `/v1/trips/${trip2}/events`, { token: anna, json: { title: "Vorschlag B", type: "Ausflug", status: "proposed" } });

  const admin = await call("GET", "/v1/inbox", { token: anna });
  assert.ok(admin.body.documents.length >= 3);
  assert.ok(admin.body.review.length >= 2);

  const mine = await call("GET", "/v1/inbox", { token: ben });
  assert.equal(mine.status, 200);
  assert.deepEqual(Object.keys(mine.body).sort(), ["documents", "review"]);
  assert.deepEqual(mine.body.documents.map((d: any) => d.id), [doc1]);
  assert.deepEqual(mine.body.review.map((x: any) => [x.tripId, x.event.title]), [[trip1, "Vorschlag A"]]);
});

test("rollen: Reisekasse der eigenen Reise lesen, Ausgaben und Rückzahlungen erfassen; Verwaltung bleibt Admin", async () => {
  const r = await rolesSetup();
  const { call, ben, cleo, dora, anna, ledger1, ledger2, travelers1, trip1 } = r;
  const m = Object.fromEntries(travelers1.map((t) => [t.displayName, t.id]));

  const own = await call("GET", "/v1/ledgers", { token: ben });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.ledgers.map((l: any) => l.id), [ledger1]);
  assert.deepEqual((await call("GET", "/v1/ledgers", { token: dora })).body.ledgers.map((l: any) => l.id), [ledger2]);

  const view = await call("GET", `/v1/ledgers/${ledger1}`, { token: ben });
  assert.equal(view.status, 200);
  assert.equal(view.body.myMemberId, m.Ben);
  assert.ok(view.body.members.every((x: any) => x.inviteToken === undefined), "keine Einladungs-Links");
  assert.ok((await call("GET", `/v1/ledgers/${ledger1}`, { token: anna })).body.members.every((x: any) => typeof x.inviteToken === "string"));
  assert.equal((await call("GET", `/v1/ledgers/${ledger1}/expenses`, { token: ben })).status, 200);
  assert.equal((await call("GET", `/v1/ledgers/${ledger1}/settlements`, { token: ben })).status, 200);
  assert.equal((await call("GET", `/v1/ledgers/${ledger2}`, { token: ben })).status, 403);
  assert.equal((await call("GET", `/v1/ledgers/${ledger2}/expenses`, { token: ben })).status, 403);
  assert.equal((await call("GET", `/v1/ledgers/${ledger1}`, { token: dora })).status, 403);

  // erfassen
  const adminExp = await call("POST", `/v1/ledgers/${ledger1}/expenses`, {
    token: anna, json: { paidByMemberId: m.Anna, amountMinor: 6000, currency: "CHF", description: "Taxi", split: { mode: "equal" } },
  });
  assert.equal(adminExp.status, 201);
  const mine = await call("POST", `/v1/ledgers/${ledger1}/expenses`, {
    token: ben, json: { paidByMemberId: m.Ben, amountMinor: 3000, currency: "CHF", description: "Essen", split: { mode: "equal" } },
  });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.expense.createdByMemberId, m.Ben);
  // Beleg: eigenes Dokument ja, fremdes nein (kein Abtasten von Dokument-IDs)
  const withDoc = await call("POST", `/v1/ledgers/${ledger1}/expenses`, {
    token: ben, json: { paidByMemberId: m.Ben, amountMinor: 100, currency: "CHF", documentId: r.doc1, split: { mode: "equal" } },
  });
  assert.equal(withDoc.status, 201);
  assert.equal(withDoc.body.expense.documentId, r.doc1);
  assert.equal((await call("POST", `/v1/ledgers/${ledger1}/expenses`, {
    token: ben, json: { paidByMemberId: m.Ben, amountMinor: 100, currency: "CHF", documentId: r.doc2, split: { mode: "equal" } },
  })).status, 403);
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}/expenses/${withDoc.body.expense.id}`, { token: ben })).status, 200);
  assert.equal((await call("POST", `/v1/ledgers/${ledger2}/expenses`, {
    token: ben, json: { paidByMemberId: m.Ben, amountMinor: 1, currency: "CHF", split: { mode: "equal" } },
  })).status, 403);

  // ändern und löschen nur eigene (wie Gäste per Link)
  assert.equal((await call("PATCH", `/v1/ledgers/${ledger1}/expenses/${mine.body.expense.id}`, { token: ben, json: { description: "Abendessen" } })).status, 200);
  assert.equal((await call("PATCH", `/v1/ledgers/${ledger1}/expenses/${adminExp.body.expense.id}`, { token: ben, json: { description: "Fremd" } })).status, 403);
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}/expenses/${adminExp.body.expense.id}`, { token: cleo })).status, 403);
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}/expenses/${mine.body.expense.id}`, { token: cleo })).status, 403, "Cleo hat sie nicht erfasst");
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}/expenses/${mine.body.expense.id}`, { token: ben })).status, 200);

  // Rückzahlung erfassen, aber nicht löschen
  const settle = await call("POST", `/v1/ledgers/${ledger1}/settlements`, { token: ben, json: { fromMemberId: m.Ben, toMemberId: m.Anna, amountMinor: 1000 } });
  assert.equal(settle.status, 201);
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}/settlements/${settle.body.settlement.id}`, { token: ben })).status, 403);

  // Verwaltung der Reisekasse bleibt Administratoren vorbehalten
  assert.equal((await call("PATCH", `/v1/ledgers/${ledger1}`, { token: ben, json: { title: "X" } })).status, 403);
  assert.equal((await call("DELETE", `/v1/ledgers/${ledger1}`, { token: ben })).status, 403);
  assert.equal((await call("POST", `/v1/ledgers/${ledger1}/members`, { token: ben, json: { displayName: "Neu" } })).status, 403);
  assert.equal((await call("POST", "/v1/ledgers", { token: ben, json: { title: "Neu" } })).status, 403);

  // Währungen und Wechselkurs für das Erfassen
  assert.equal((await call("GET", "/v1/currencies", { token: ben })).status, 200);
  assert.equal((await call("GET", "/v1/fx?from=EUR&to=CHF", { token: ben })).status, 200);

  // Heute und Zusammenfassung enthalten die Reisekasse mit dem eigenen Saldo
  const today = await call("GET", `/v1/today?tripId=${trip1}&date=2026-10-22`, { token: ben });
  assert.equal(today.status, 200);
  assert.equal(today.body.ledger.id, ledger1);
  assert.equal(today.body.ledger.currency, "CHF");
  assert.equal(today.body.ledger.myMemberId, m.Ben);
  // Ben hat Anteil 3000 am Taxi (6000/3) → -2000, Rückzahlung +1000 → -1000
  assert.equal(today.body.ledger.balanceMinor, -1000);
  const summary = await call("GET", `/v1/summary?tripId=${trip1}`, { token: ben });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.ledger.id, ledger1);
  assert.equal(summary.body.ledger.myMemberId, m.Ben);
  assert.equal(summary.body.ledger.balanceMinor, -1000);
  const day = await call("GET", `/v1/trips/${trip1}/day/2026-10-22`, { token: ben });
  assert.equal(day.body.ledger.id, ledger1);
});

test("rollen: eigenständige Reisekassen (ohne Reise) bleiben Administratoren vorbehalten", async () => {
  const r = await rolesSetup();
  const { call, ben, anna, userId } = r;
  const l = await call("POST", "/v1/ledgers", { token: anna, json: { title: "Haushalt", members: [{ displayName: "Ben", userId: userId("ben") }] } });
  const id = l.body.ledger.id;
  assert.equal((await call("GET", `/v1/ledgers/${id}`, { token: ben })).status, 403);
  assert.equal((await call("GET", `/v1/ledgers/${id}/expenses`, { token: ben })).status, 403);
  assert.ok(!(await call("GET", "/v1/ledgers", { token: ben })).body.ledgers.some((x: any) => x.id === id));
});

test("rollen: Ereignisse bearbeiten, anlegen, löschen und Reisen verwalten bleibt Administratoren vorbehalten", async () => {
  const r = await rolesSetup();
  const { call, ben, anna, trip1 } = r;
  const ev = await call("POST", `/v1/trips/${trip1}/events`, { token: anna, json: { title: "Hotel", type: "Hotel", startDate: "2026-10-21" } });
  const eventId = ev.body.eventId;
  assert.equal((await call("GET", `/v1/trips/${trip1}`, { token: ben })).status, 200);
  assert.equal((await call("POST", `/v1/trips/${trip1}/events/${eventId}/comments`, { token: ben, json: { body: "Super" } })).status, 201);
  for (const [method, p, json] of [
    ["POST", "/v1/trips", { title: "Neu" }],
    ["DELETE", `/v1/trips/${trip1}`, undefined],
    ["PATCH", `/v1/trips/${trip1}`, { title: "X" }],
    ["POST", `/v1/trips/${trip1}/events`, { title: "X" }],
    ["PATCH", `/v1/trips/${trip1}/events/${eventId}`, { title: "X" }],
    ["DELETE", `/v1/trips/${trip1}/events/${eventId}`, undefined],
    ["POST", `/v1/trips/${trip1}/events/${eventId}/confirm`, {}],
    ["GET", "/v1/users", undefined],
    ["POST", "/v1/users", { username: "x", displayName: "X", password: "x".repeat(12) }],
    ["PUT", "/v1/users/1/trips", { tripIds: [] }],
  ] as Array<[string, string, unknown]>) {
    const res = await call(method, p, { token: ben, json });
    assert.equal(res.status, 403, `${method} ${p}`);
  }
});
