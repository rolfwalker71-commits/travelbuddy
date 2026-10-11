import test from "node:test";
import assert from "node:assert/strict";
import { buildIcsCalendar, foldLine, parseClockTime } from "../src/trips/ics";
import type { Db } from "../src/db/client";
import { setup } from "./helpers";

export function insertDoc(db: Db, title: string, n = Math.random()): number {
  const sha = Buffer.from(String(n) + title).toString("hex").padEnd(64, "0").slice(0, 64);
  const r = db
    .prepare(
      `INSERT INTO documents (title, file_name, content_type, size_bytes, sha256, created_at, updated_at)
       VALUES (?, ?, 'application/pdf', 10, ?, 'x', 'x')`
    )
    .run(title, `${title}.pdf`, sha);
  return Number(r.lastInsertRowid);
}

/* ───────────── ICS ───────────── */

test("ics: Zeiten, Ganztägiges und Escaping", () => {
  const ics = buildIcsCalendar(
    [
      {
        uid: "a@x",
        title: "✈️ Flug: ZRH → MIA, Economy; früh",
        description: "Zeile 1\nZeile 2",
        startDate: "2026-10-25",
        endDate: "2026-10-25",
        startTime: "10:00",
        endTime: "16:30",
        url: "https://example.com/a?x=1,2",
        geo: { lat: 47.45, lon: 8.55 },
        categories: ["Flug"],
      },
      { uid: "b@x", title: "Hotel", startDate: "2026-10-25", endDate: "2026-10-27" },
    ],
    { now: new Date("2026-10-10T12:00:00Z") }
  );

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTAMP:20261010T120000Z/);
  assert.match(ics, /DTSTART:20261025T100000\r\n/);
  assert.match(ics, /DTEND:20261025T163000/);
  assert.ok(ics.includes("SUMMARY:✈️ Flug: ZRH → MIA\\, Economy\\; früh"));
  assert.match(ics, /DESCRIPTION:Zeile 1\\nZeile 2/);
  assert.match(ics, /URL:https:\/\/example\.com\/a\?x=1,2/);
  assert.match(ics, /GEO:47\.45;8\.55/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261028/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("ics: Ereignis ohne Endzeit dauert eine Stunde, 12-h-Zeiten werden gelesen", () => {
  const ics = buildIcsCalendar([{ uid: "c", title: "T", startDate: "2026-10-25", startTime: "5:30 PM" }]);
  assert.match(ics, /DTSTART:20261025T173000/);
  assert.match(ics, /DTEND:20261025T183000/);
  assert.deepEqual(parseClockTime("5:30 PM"), { h: 17, m: 30 });
  assert.deepEqual(parseClockTime("12:05 AM"), { h: 0, m: 5 });
  assert.equal(parseClockTime("25:00"), null);
});

test("ics: mit Zeitzone wird als UTC ausgegeben (Sommer- und Winterzeit)", () => {
  const ics = buildIcsCalendar([
    // 25.10.2026 ist der Tag der Zeitumstellung in Europa: 10:00 ist bereits MEZ (UTC+1)
    { uid: "z1", title: "Flug", startDate: "2026-10-25", startTime: "10:00", startTz: "Europe/Zurich", endTime: "15:30", endTz: "America/New_York" },
    // ohne Endzeit: eine Stunde später (UTC)
    { uid: "z2", title: "Zug", startDate: "2026-07-01", startTime: "08:15", startTz: "Europe/Zurich" },
  ]);
  assert.match(ics, /DTSTART:20261025T090000Z\r\nDTEND:20261025T193000Z/); // 15:30 New York (EDT bis 01.11.) = 19:30 UTC
  assert.match(ics, /DTSTART:20260701T061500Z\r\nDTEND:20260701T071500Z/);
});

test("ics: Zeilenfaltung nach Bytes, Mehrbyte-Zeichen bleiben ganz", () => {
  const line = "SUMMARY:" + "ä".repeat(60);
  const folded = foldLine(line).split("\r\n");
  assert.ok(folded.length > 1);
  for (const l of folded) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  assert.equal(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join(""), line);
  const emoji = foldLine("DESCRIPTION:" + "✈️".repeat(40));
  for (const l of emoji.split("\r\n")) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
});

test("ics: ungültige Daten werden übersprungen statt ein kaputtes Ereignis zu erzeugen", () => {
  assert.doesNotMatch(buildIcsCalendar([{ uid: "d", title: "X", startDate: "kein-datum" }]), /BEGIN:VEVENT/);
});

/* ───────────── HTTP ───────────── */

const adminUsers = [
  { username: "admin", password: "admin-pw-123456", displayName: "Admin", isAdmin: true },
  // Ben organisiert die Reisen und ist deshalb Administrator; Cleo und Dora sind Mitreisende ohne Adminrechte.
  { username: "ben", password: "ben-pw-1234567", displayName: "Ben", isAdmin: true },
  { username: "cleo", password: "cleo-pw-123456", displayName: "Cleo" },
  { username: "dora", password: "dora-pw-123456", displayName: "Dora" },
];

test("reisen: anlegen, Ereignisse, Reisezeitraum wächst, Sortierung, Reisekasse entsteht mit", async () => {
  const { call, login } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");

  const t = await call("POST", "/v1/trips", {
    token: ben,
    json: { title: "Sardinien", destination: "Olbia", startDate: "2026-10-20", endDate: "2026-10-25", travelers: [{ displayName: "Anna" }] },
  });
  assert.equal(t.status, 201);
  const id = t.body.trip.id;
  assert.equal(t.body.travelers.length, 2);
  assert.equal(t.body.travelers[0].displayName, "Ben");
  assert.ok(t.body.travelers[1].shareToken);
  assert.equal(t.body.trip.homeCurrency, "CHF");
  assert.equal(t.body.trip.timezone, "Europe/Zurich");
  assert.ok(t.body.trip.ledgerId, "Reisekasse wird automatisch angelegt");
  assert.equal(t.body.trip.needsReviewCount, 0);
  assert.equal(t.body.trip.phase, "upcoming");

  await call("POST", `/v1/trips/${id}/events`, {
    token: ben,
    json: { type: "Hotel", title: "Hotel Gabbiano", startDate: "2026-10-21", endDate: "2026-10-24", address: "Via Roma 1" },
  });
  await call("POST", `/v1/trips/${id}/events`, {
    token: ben,
    json: { type: "Flug", title: "ZRH → OLB", startDate: "2026-10-19", startTime: "08:30", details: { flightNumber: "lx1234" } },
  });
  const detail = await call("GET", `/v1/trips/${id}`, { token: ben });
  assert.deepEqual(detail.body.events.map((e: any) => e.title), ["ZRH → OLB", "Hotel Gabbiano"]);
  assert.equal(detail.body.trip.startDate, "2026-10-19");
  assert.equal(detail.body.trip.endDate, "2026-10-25");
  assert.equal(detail.body.events[0].details.flightNumber, "LX1234", "Katalog: transform upper");

  const badTime = await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "x", startTime: "25:99" } });
  assert.equal(badTime.status, 422);
  const badRange = await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "x", startDate: "2026-10-25", endDate: "2026-10-20" } });
  assert.equal(badRange.status, 422);
  assert.equal(badRange.body.error.code, "invalid_range");
  const badDetails = await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "x", details: { unbekannt: 1 } } });
  assert.equal(badDetails.status, 422);
  assert.equal(badDetails.body.error.code, "invalid_details");

  const ids = detail.body.events.map((e: any) => e.id).reverse();
  assert.equal((await call("POST", `/v1/trips/${id}/events/reorder`, { token: ben, json: { ids } })).status, 200);
  assert.equal((await call("POST", `/v1/trips/${id}/events/reorder`, { token: ben, json: { ids: [999] } })).status, 422);
});

test("reisen: Mitreisende mit Konto sehen nur ihre Reisen, alles andere ist Administratoren vorbehalten", async () => {
  const { db, call, login, userId } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const cleo = await login("cleo", "cleo-pw-123456");
  const dora = await login("dora", "dora-pw-123456");

  const t = await call("POST", "/v1/trips", {
    token: ben,
    json: { title: "Privat", travelers: [{ displayName: "Cleo", userId: userId("cleo"), email: "cleo@example.com" }, { displayName: "Gast Gerda" }] },
  });
  const id = t.body.trip.id;
  const other = await call("POST", "/v1/trips", { token: ben, json: { title: "Andere Reise" } });
  const ev = await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "Hotel", startDate: "2026-10-21" } });
  const docId = insertDoc(db, "Geheim.pdf");
  await call("POST", `/v1/trips/${id}/events/${ev.body.eventId}/documents`, { token: ben, json: { documentId: docId } });

  const list = await call("GET", "/v1/trips", { token: cleo });
  assert.deepEqual(list.body.trips.map((x: any) => x.title), ["Privat"]);
  const view = await call("GET", `/v1/trips/${id}`, { token: cleo });
  assert.equal(view.status, 200);
  assert.ok(view.body.travelers.every((x: any) => x.shareToken === undefined), "keine Gäste-Links");
  assert.ok(view.body.travelers.every((x: any) => x.email === null), "keine E-Mail-Adressen");
  assert.equal(view.body.events[0].documents, undefined, "keine Dokumenttitel");
  assert.equal((await call("GET", `/v1/trips/${id}/ics`, { token: cleo })).status, 200);

  assert.equal((await call("GET", `/v1/trips/${other.body.trip.id}`, { token: cleo })).status, 403);
  assert.equal((await call("GET", `/v1/trips/${id}`, { token: dora })).status, 403);
  assert.equal((await call("GET", "/v1/trips", { token: dora })).body.trips.length, 0);

  const c = await call("POST", `/v1/trips/${id}/events/${ev.body.eventId}/comments`, { token: cleo, json: { body: "Freue mich!" } });
  assert.equal(c.status, 201);

  const ledgerId = t.body.trip.ledgerId;
  const forbidden: Array<[string, string, unknown?]> = [
    ["POST", "/v1/trips", { title: "X" }],
    ["PATCH", `/v1/trips/${id}`, { title: "X" }],
    ["DELETE", `/v1/trips/${id}`],
    ["POST", `/v1/trips/${id}/events`, { title: "X" }],
    ["PATCH", `/v1/trips/${id}/events/${ev.body.eventId}`, { title: "X" }],
    ["POST", `/v1/trips/${id}/events/${ev.body.eventId}/confirm`],
    ["POST", `/v1/trips/${id}/events/${ev.body.eventId}/geocode`],
    ["POST", `/v1/trips/${id}/events/${ev.body.eventId}/expense`, {}],
    ["POST", `/v1/trips/${id}/travelers`, { displayName: "X" }],
    ["POST", `/v1/trips/${id}/ledger`, {}],
    ["POST", `/v1/trips/${id}/events/${ev.body.eventId}/documents`, { documentId: docId }],
    ["POST", "/v1/documents", {}],
    ["POST", `/v1/documents/${docId}/analyze`, {}],
    ["DELETE", `/v1/documents/${docId}`],
    ["POST", "/v1/ledgers", { title: "X" }],
    ["PATCH", `/v1/ledgers/${ledgerId}`, { title: "X" }],
    ["DELETE", `/v1/ledgers/${ledgerId}`],
    ["GET", "/v1/users"],
    ["GET", "/v1/users/directory"],
    ["GET", "/v1/push/status"],
    ["POST", "/v1/push/test", {}],
    ["POST", "/v1/push/simulate", {}],
  ];
  for (const [method, path, json] of forbidden) {
    const r = await call(method, path, { token: cleo, json });
    assert.equal(r.status, 403, `${method} ${path} muss für Mitreisende gesperrt sein (war ${r.status})`);
  }
  // Erlaubt: Heute, Zusammenfassung, Tag, Karte-Token-Route (hier 404 ohne Schlüssel, aber nicht 403)
  assert.equal((await call("GET", "/v1/today", { token: cleo })).status, 200);
  assert.equal((await call("GET", "/v1/summary", { token: cleo })).status, 200);
  assert.equal((await call("GET", `/v1/trips/${id}/day/2026-10-21`, { token: cleo })).status, 200);
  assert.equal((await call("GET", `/v1/trips/${other.body.trip.id}/day/2026-10-21`, { token: cleo })).status, 403);
  assert.equal((await call("GET", "/v1/maps/token", { token: cleo })).status, 404);

  const adminView = await call("GET", `/v1/trips/${id}`, { token: ben });
  assert.ok(adminView.body.travelers.some((x: any) => x.shareToken));
  assert.equal(adminView.body.events[0].documents[0].title, "Geheim.pdf");
  assert.equal((await call("GET", "/v1/trips", { token: ben })).body.trips.length, 2);
});

test("reisen: Liste mit Phase und nächstem Ereignis", async () => {
  const { call, login } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const mk = async (title: string, s: string, e: string) => {
    const r = await call("POST", "/v1/trips", { token: ben, json: { title, startDate: s, endDate: e } });
    await call("POST", `/v1/trips/${r.body.trip.id}/events`, { token: ben, json: { title: `${title} Start`, startDate: s } });
  };
  await mk("Vergangen", "2026-05-01", "2026-05-10");
  await mk("Läuft", "2026-10-08", "2026-10-12");
  await mk("Bald", "2026-11-01", "2026-11-05");

  const list = await call("GET", "/v1/trips", { token: ben });
  assert.deepEqual(list.body.trips.map((t: any) => [t.title, t.phase]), [
    ["Läuft", "active"],
    ["Bald", "upcoming"],
    ["Vergangen", "past"],
  ]);
  const bald = list.body.trips.find((t: any) => t.title === "Bald");
  assert.equal(bald.nextEvent.title, "Bald Start");
  assert.equal(bald.eventCount, 1);
  assert.equal(bald.homeCurrency, "CHF");
});

test("reisen: ICS-Export mit Zeitzonen", async () => {
  const { call, login } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const t = await call("POST", "/v1/trips", { token: ben, json: { title: "Ferien 2026 (Süd)", destination: "Italien" } });
  const id = t.body.trip.id;
  await call("POST", `/v1/trips/${id}/events`, {
    token: ben,
    json: {
      type: "Flug", title: "ZRH → MIA", startDate: "2026-10-25", startTime: "10:00", endTime: "16:00", bookingReference: "abc123",
      details: { flightNumber: "LX64", departureAirport: "ZRH", arrivalAirport: "MIA" },
    },
  });
  await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "Ohne Datum" } });

  const res = await call("GET", `/v1/trips/${id}/ics`, { token: ben });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/calendar/);
  const disp = res.headers.get("content-disposition") ?? "";
  assert.match(disp, /filename="Ferien_2026_Sud_\.ics"/);
  assert.match(disp, /filename\*=UTF-8''Ferien_2026_S%C3%BCd_\.ics/);
  const ics = (res.body as string).replace(/\r\n /g, "");
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1, "Ereignisse ohne Datum werden nicht exportiert");
  assert.match(ics, /Flug: LX64/);
  assert.match(ics, /Buchung: ABC123/);
  assert.match(ics, /Route: ZRH → MIA/);
  // Zone aus dem Flughafen vorbelegt: 10:00 Zürich (MEZ ab 25.10.) = 09:00Z, 16:00 New York (EDT) = 20:00Z
  assert.match(ics, /DTSTART:20261025T090000Z/);
  assert.match(ics, /DTEND:20261025T200000Z/);
});

test("reisen: Kommentare und Gäste-Link (nur lesen + kommentieren)", async () => {
  const { call, login } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const t = await call("POST", "/v1/trips", { token: ben, json: { title: "Roadtrip", travelers: [{ displayName: "Gerda" }] } });
  const id = t.body.trip.id;
  const gerda = t.body.travelers.find((x: any) => x.displayName === "Gerda");
  const ev = await call("POST", `/v1/trips/${id}/events`, { token: ben, json: { title: "Hotel", type: "Hotel", startDate: "2026-10-21" } });
  const eventId = ev.body.eventId;
  const c1 = await call("POST", `/v1/trips/${id}/events/${eventId}/comments`, { token: ben, json: { body: "Parkplatz buchen!" } });
  assert.equal(c1.status, 201);

  const view = await call("GET", `/v1/guest/trips/${gerda.shareToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.me.displayName, "Gerda");
  assert.ok(view.body.travelers.every((x: any) => x.shareToken === undefined));
  assert.equal(view.body.events[0].comments.length, 1);

  const gc = await call("POST", `/v1/guest/trips/${gerda.shareToken}/events/${eventId}/comments`, { json: { body: "Bin dabei" } });
  assert.equal(gc.status, 201);
  assert.equal(gc.body.comment.author, "Gerda");
  assert.equal((await call("PATCH", `/v1/trips/${id}/events/${eventId}`, { json: { title: "x" } })).status, 401);

  const cleo = await login("cleo", "cleo-pw-123456");
  assert.equal((await call("DELETE", `/v1/trips/${id}/events/${eventId}/comments/${c1.body.comment.id}`, { token: cleo })).status, 403);
  assert.equal((await call("DELETE", `/v1/trips/${id}/events/${eventId}/comments/${c1.body.comment.id}`, { token: ben })).status, 200);

  await call("POST", `/v1/trips/${id}/travelers/${gerda.id}/share/revoke`, { token: ben });
  assert.equal((await call("GET", `/v1/guest/trips/${gerda.shareToken}`)).status, 404);
});

test("reisen: Reisekasse entsteht mit der Reise und teilt die Teilnehmer", async () => {
  const { call, login, userId } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const cleo = await login("cleo", "cleo-pw-123456");

  const t = await call("POST", "/v1/trips", {
    token: ben,
    json: { title: "Skiwoche", homeCurrency: "eur", timezone: "Europe/Vienna", travelers: [{ displayName: "Cleo", userId: userId("cleo") }, { displayName: "Gast Gerda" }] },
  });
  const id = t.body.trip.id;
  assert.equal(t.body.trip.homeCurrency, "EUR");
  assert.equal(t.body.trip.timezone, "Europe/Vienna");
  const ledgerId = t.body.trip.ledgerId;

  const ledger = await call("GET", `/v1/ledgers/${ledgerId}`, { token: ben });
  assert.equal(ledger.body.ledger.tripId, id);
  assert.equal(ledger.body.ledger.baseCurrency, "EUR");
  assert.equal(ledger.body.ledger.title, "Reisekasse: Skiwoche");
  assert.deepEqual(ledger.body.members.map((m: any) => m.displayName).sort(), ["Ben", "Cleo", "Gast Gerda"]);
  // Mitreisende mit Konto dürfen die Reisekasse ihrer Reise lesen (ohne Einladungs-Links der anderen)
  const asCleo = await call("GET", `/v1/ledgers/${ledgerId}`, { token: cleo });
  assert.equal(asCleo.status, 200);
  assert.ok(asCleo.body.members.every((m: any) => m.inviteToken === undefined), "keine Einladungs-Links für Mitreisende");

  // POST …/ledger bleibt für Altdaten ein No-op
  const again = await call("POST", `/v1/trips/${id}/ledger`, { token: ben, json: {} });
  assert.equal(again.status, 200);
  assert.equal(again.body.ledgerId, ledgerId);
  assert.equal((await call("DELETE", `/v1/trips/${id}/ledger`, { token: ben })).status, 400);
  // Reisekasse einer Reise lässt sich nicht einzeln löschen
  const del = await call("DELETE", `/v1/ledgers/${ledgerId}`, { token: ben });
  assert.equal(del.status, 409);
  assert.equal(del.body.error.code, "ledger_of_trip");

  // Titel und Heimwährung folgen der Reise
  const patched = await call("PATCH", `/v1/trips/${id}`, { token: ben, json: { title: "Skiwoche Arlberg", homeCurrency: "CHF" } });
  assert.equal(patched.status, 200);
  const l2 = await call("GET", `/v1/ledgers/${ledgerId}`, { token: ben });
  assert.equal(l2.body.ledger.title, "Reisekasse: Skiwoche Arlberg");
  assert.equal(l2.body.ledger.baseCurrency, "CHF");

  // Mit Buchungen: Löschen nur mit withLedger, Heimwährung gesperrt
  const m = Object.fromEntries(l2.body.members.map((x: any) => [x.displayName, x.id]));
  await call("POST", `/v1/ledgers/${ledgerId}/expenses`, {
    token: ben,
    json: { paidByMemberId: m.Ben, amountMinor: 5000, currency: "CHF", split: { mode: "equal" } },
  });
  const locked = await call("PATCH", `/v1/trips/${id}`, { token: ben, json: { homeCurrency: "USD" } });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, "currency_locked");
  const nodel = await call("DELETE", `/v1/trips/${id}`, { token: ben });
  assert.equal(nodel.status, 409);
  assert.equal(nodel.body.error.code, "has_ledger_entries");
  assert.equal((await call("DELETE", `/v1/trips/${id}?withLedger=1`, { token: ben })).status, 200);
  assert.equal((await call("GET", `/v1/ledgers/${ledgerId}`, { token: ben })).status, 404);
});

test("reisen: ohne Buchungen lässt sich die Reise samt Reisekasse löschen", async () => {
  const { call, login, db } = await setup({ users: adminUsers });
  const ben = await login("ben", "ben-pw-1234567");
  const t = await call("POST", "/v1/trips", { token: ben, json: { title: "Kurz" } });
  assert.equal((await call("DELETE", `/v1/trips/${t.body.trip.id}`, { token: ben })).status, 200);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledgers").get() as any).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM participants").get() as any).n, 0);
});

test("reisen: Liste zeigt die Anzahl verknüpfter Dokumente", async () => {
  const { db, call, login } = await setup({ users: adminUsers });
  const admin = await login("admin", "admin-pw-123456");
  const t = await call("POST", "/v1/trips", { token: admin, json: { title: "Doku" } });
  const id = t.body.trip.id;
  const e1 = await call("POST", `/v1/trips/${id}/events`, { token: admin, json: { title: "A" } });
  const e2 = await call("POST", `/v1/trips/${id}/events`, { token: admin, json: { title: "B" } });
  const d1 = insertDoc(db, "D1");
  const d2 = insertDoc(db, "D2");
  await call("POST", `/v1/trips/${id}/events/${e1.body.eventId}/documents`, { token: admin, json: { documentId: d1 } });
  await call("POST", `/v1/trips/${id}/events/${e2.body.eventId}/documents`, { token: admin, json: { documentId: d1 } });
  await call("POST", `/v1/trips/${id}/events/${e2.body.eventId}/documents`, { token: admin, json: { documentId: d2 } });
  const list = await call("GET", "/v1/trips", { token: admin });
  assert.equal(list.body.trips[0].documentCount, 2, "dasselbe Dokument an zwei Ereignissen zählt einmal");
});

test("reisen: Ereignisse liefern Dokumenttitel (nur angemeldet), Gäste sehen nur die Anzahl", async () => {
  const { db, call, login } = await setup({ users: adminUsers });
  const admin = await login("admin", "admin-pw-123456");
  const t = await call("POST", "/v1/trips", { token: admin, json: { title: "Titel" } });
  const id = t.body.trip.id;
  const ev = await call("POST", `/v1/trips/${id}/events`, { token: admin, json: { title: "Hotel" } });
  const docId = insertDoc(db, "Hotelbuchung Miami");
  await call("POST", `/v1/trips/${id}/events/${ev.body.eventId}/documents`, { token: admin, json: { documentId: docId } });

  const detail = await call("GET", `/v1/trips/${id}`, { token: admin });
  const event = detail.body.events[0];
  assert.deepEqual(event.documentIds, [docId]);
  assert.deepEqual(event.documents, [{ id: docId, title: "Hotelbuchung Miami" }]);

  const guest = await call("GET", `/v1/guest/trips/${detail.body.travelers[0].shareToken}`);
  assert.equal(guest.status, 200);
  assert.equal(guest.body.events[0].documents, undefined);
  assert.deepEqual(guest.body.events[0].documentIds, [docId]);
});

test("reisen: Teilnehmer nachträglich ändern und mit Konto verknüpfen", async () => {
  const { call, login, userId } = await setup({ users: adminUsers });
  const admin = await login("admin", "admin-pw-123456");
  const t = await call("POST", "/v1/trips", { token: admin, json: { title: "Verknüpfen", travelers: [{ displayName: "Gast Gerda" }] } });
  const id = t.body.trip.id;
  const gerda = t.body.travelers.find((x: any) => x.displayName === "Gast Gerda");
  const adminTraveler = t.body.travelers.find((x: any) => x.userId != null);
  const cleoId = userId("cleo");

  const linked = await call("PATCH", `/v1/trips/${id}/travelers/${gerda.id}`, { token: admin, json: { userId: cleoId, displayName: "Cleo" } });
  assert.equal(linked.status, 200);
  const after = linked.body.travelers.find((x: any) => x.id === gerda.id);
  assert.equal(after.userId, cleoId);
  assert.equal(after.displayName, "Cleo");
  assert.equal(after.shareToken, gerda.shareToken, "Gäste-Link bleibt beim Verknüpfen gleich");

  const cleo = await login("cleo", "cleo-pw-123456");
  assert.equal((await call("GET", `/v1/trips/${id}`, { token: cleo })).status, 200);

  const dup = await call("PATCH", `/v1/trips/${id}/travelers/${adminTraveler.id}`, { token: admin, json: { userId: cleoId } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "user_already_traveler");

  assert.equal((await call("PATCH", `/v1/trips/${id}/travelers/${gerda.id}`, { token: admin, json: { userId: 99999 } })).status, 422);
  const unlinked = await call("PATCH", `/v1/trips/${id}/travelers/${gerda.id}`, { token: admin, json: { userId: null } });
  assert.equal(unlinked.body.travelers.find((x: any) => x.id === gerda.id).userId, null);
  assert.equal((await call("PATCH", `/v1/trips/${id}/travelers/${gerda.id}`, { token: admin, json: { displayName: "  " } })).status, 422);
  assert.equal((await call("PATCH", `/v1/trips/${id}/travelers/99999`, { token: admin, json: { displayName: "X" } })).status, 404);
});

test("reisen: Teilnehmer entfernen räumt Verweise in Ereignissen auf, mit Buchungen nicht", async () => {
  const { call, login } = await setup({ users: adminUsers });
  const admin = await login("admin", "admin-pw-123456");
  const t = await call("POST", "/v1/trips", { token: admin, json: { title: "Aufräumen", travelers: [{ displayName: "Gerda" }, { displayName: "Hans" }] } });
  const id = t.body.trip.id;
  const [a, g, h] = ["Admin", "Gerda", "Hans"].map((n) => t.body.travelers.find((x: any) => x.displayName === n).id as number);
  const ev = await call("POST", `/v1/trips/${id}/events`, {
    token: admin,
    json: { type: "Flug", title: "Flug", participantIds: [g, h], details: { passengers: [{ participantId: g, seat: "12A" }, { participantId: h, seat: "12B" }] } },
  });
  assert.equal(ev.status, 201);
  const gone = await call("DELETE", `/v1/trips/${id}/travelers/${h}`, { token: admin });
  assert.equal(gone.status, 200);
  const event = gone.body.events[0];
  assert.deepEqual(event.participantIds, [g]);
  assert.deepEqual(event.details.passengers, [{ participantId: g, seat: "12A" }]);

  const ledgerId = t.body.trip.ledgerId;
  await call("POST", `/v1/ledgers/${ledgerId}/expenses`, { token: admin, json: { paidByMemberId: a, amountMinor: 1000, currency: "CHF", split: { mode: "equal" } } });
  const used = await call("DELETE", `/v1/trips/${id}/travelers/${g}`, { token: admin });
  assert.equal(used.status, 409);
  assert.equal(used.body.error.code, "member_in_use");
});
