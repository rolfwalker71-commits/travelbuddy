import test from "node:test";
import assert from "node:assert/strict";
import { GeocodeBackfill, backfillCounts, backfillModeFromEnv } from "../src/maps/backfill";
import type { GeocodeHit, Geocoder } from "../src/geo/geocode";
import { migrate, openDb } from "../src/db/client";
import { setup } from "./helpers";

class FakeGeocoder implements Geocoder {
  readonly name = "fake";
  readonly queries: string[] = [];
  down = false;
  constructor(private readonly table: Record<string, [number, number]> = {}) {}
  async geocode(query: string): Promise<GeocodeHit | null> {
    this.queries.push(query);
    if (this.down) throw new Error("kein Netz");
    const hit = Object.entries(this.table).find(([k]) => query.toLowerCase().includes(k.toLowerCase()));
    return hit ? { lat: hit[1][0], lon: hit[1][1], label: `${query} (aufgelöst)`, confidence: 0.7, provider: "fake" } : null;
  }
}

const FROZEN = "2026-10-11T08:00:00Z";

async function boot(table: Record<string, [number, number]>) {
  const geocoder = new FakeGeocoder(table);
  let clock = new Date(FROZEN);
  const logs: string[] = [];
  const s = await setup(); // ohne Geokodierer: Ereignisse bleiben ohne Koordinaten (kein Auto-Geokodieren)
  const anna = await s.tokens.anna();
  const trip = await s.call("POST", "/v1/trips", { token: anna, json: { title: "Mittelmeer", destination: "Spain", startDate: "2026-10-26", endDate: "2026-11-02" } });
  const tripId = trip.body.trip.id as number;
  const mk = async (json: unknown) => (await s.call("POST", `/v1/trips/${tripId}/events`, { token: anna, json })).body.eventId as number;
  const backfill = new GeocodeBackfill({ db: s.db, geocoder, now: () => clock, log: (m) => logs.push(m), limit: 50 });
  return { ...s, anna, tripId, mk, geocoder, backfill, logs, setClock: (iso: string) => (clock = new Date(iso)) };
}
const ev = async (s: Awaited<ReturnType<typeof boot>>, id: number) =>
  (await s.call("GET", `/v1/trips/${s.tripId}`, { token: s.anna })).body.events.find((e: any) => e.id === id);

test("nachtrag: Hafentage über den Titel, Seetag und Reise nie, Transfer/Mietwagen getrennt, fieldsMeta geocoded", async () => {
  const s = await boot({ "Palma de Mallorca": [39.57, 2.65], "Hafen Olbia": [40.92, 9.5], "Hotel Gabbiano": [40.93, 9.52], "Hertz Palma": [39.55, 2.73], "Flughafen Palma": [39.55, 2.73] });
  const port = await s.mk({ type: "Kreuzfahrt", title: "Palma de Mallorca", startDate: "2026-10-27", details: { entryKind: "Hafen" } });
  const departure = await s.mk({ type: "Kreuzfahrt", title: "Abfahrt Palma de Mallorca", startDate: "2026-10-27", details: { entryKind: "Hafen" } });
  const seaDay = await s.mk({ type: "Kreuzfahrt", title: "Seetag", startDate: "2026-10-28", details: { entryKind: "Seetag" } });
  const whole = await s.mk({ type: "Kreuzfahrt", title: "MSC Mittelmeer", startDate: "2026-10-26", endDate: "2026-11-02", details: { entryKind: "Reise" } });
  const transfer = await s.mk({ type: "Transfer", title: "Transfer", startDate: "2026-10-26", details: { originPlace: "Hafen Olbia", destinationPlace: "Hotel Gabbiano" } });
  const car = await s.mk({ type: "Mietauto", title: "Mietwagen", startDate: "2026-10-28", endDate: "2026-10-31", details: { pickupPlace: "Hertz Palma", returnPlace: "Flughafen Palma Station" } });
  const manual = await s.mk({ type: "Hotel", title: "Eigenes Hotel", address: "Via Roma 1, Olbia", lat: 1, lon: 2 });

  const before = backfillCounts(s.db, new Date(FROZEN));
  assert.equal(before.open, 6, "Hafen, Abfahrt, Start und Ziel des Transfers, Abholung und Rückgabe");

  const r = await s.backfill.run();
  assert.equal(r.resolved, 6);
  assert.equal(r.notFound, 0);
  assert.ok(!s.geocoder.queries.some((q) => /Seetag|MSC Mittelmeer|Via Roma/.test(q)), s.geocoder.queries.join(" | "));
  assert.ok(s.geocoder.queries.includes("Palma de Mallorca"), "Suchbegriff = Titel, ohne Reiseziel-Anhang");
  assert.ok(!s.geocoder.queries.some((q) => q.includes("Spain")), "kein Reiseziel im Suchbegriff");
  assert.equal(s.geocoder.queries.filter((q) => q === "Palma de Mallorca").length, 2, "«Abfahrt …» wird auf den Hafennamen gekürzt");

  const p = await ev(s, port);
  assert.deepEqual([p.lat, p.lon], [39.57, 2.65]);
  assert.equal(p.fieldsMeta.lat.source, "geocoded");
  assert.equal(p.fieldsMeta.lon.source, "geocoded");
  assert.equal(p.fieldsMeta.lat.quote, "Palma de Mallorca (aufgelöst)");
  assert.equal((await ev(s, seaDay)).lat, null);
  assert.equal((await ev(s, whole)).lat, null);
  const t = await ev(s, transfer);
  assert.deepEqual(t.places.map((x: any) => [x.role, x.lat, x.lon]), [["start", 40.92, 9.5], ["end", 40.93, 9.52]]);
  const c = await ev(s, car);
  assert.deepEqual(c.places.map((x: any) => [x.role, x.lat]), [["pickup", 39.55], ["return", 39.55]]);
  assert.deepEqual([(await ev(s, manual)).lat, (await ev(s, manual)).fieldsMeta.lat.source], [1, "manual"], "Handwerk bleibt");

  // zweiter Lauf: nichts mehr offen, keine neuen Anfragen
  const n = s.geocoder.queries.length;
  const again = await s.backfill.run();
  assert.equal(again.attempted, 0);
  assert.equal(s.geocoder.queries.length, n);
  assert.deepEqual(
    (({ open, resolved, notFound, failed }) => ({ open, resolved, notFound, failed }))(s.backfill.stats()),
    { open: 0, resolved: 6, notFound: 0, failed: 0 }
  );
});

test("nachtrag: «nicht gefunden» wird gemerkt und erst bei neuem Suchbegriff wiederholt", async () => {
  const s = await boot({});
  const id = await s.mk({ type: "Hotel", title: "Hotel Phantasia", address: "Nirgendwogasse 1" });
  assert.equal((await s.backfill.run()).notFound, 1);
  assert.equal(s.geocoder.queries.length, 1);
  s.setClock("2026-12-01T08:00:00Z");
  assert.equal((await s.backfill.run()).attempted, 0, "auch viel später nicht erneut");
  assert.equal(s.geocoder.queries.length, 1);
  assert.deepEqual(
    (({ open, notFound }) => ({ open, notFound }))(s.backfill.stats()),
    { open: 0, notFound: 1 }
  );
  // Adresse geändert → neuer Versuch
  await s.call("PATCH", `/v1/trips/${s.tripId}/events/${id}`, { token: s.anna, json: { address: "Via Roma 2, Olbia" } });
  assert.equal((await s.backfill.run()).notFound, 1);
  assert.equal(s.geocoder.queries.length, 2);
});

test("nachtrag: ohne Netz kein Absturz, Wartezeit, endgültig nach fünf Versuchen", async () => {
  const s = await boot({ Olbia: [40.9, 9.5] });
  await s.mk({ type: "Hotel", title: "A", address: "Corso 1, Olbia" });
  await s.mk({ type: "Hotel", title: "B", address: "Corso 2, Olbia" });
  await s.mk({ type: "Hotel", title: "C", address: "Corso 3, Olbia" });
  await s.mk({ type: "Hotel", title: "D", address: "Corso 4, Olbia" });
  s.geocoder.down = true;

  const first = await s.backfill.run();
  assert.equal(first.resolved, 0);
  assert.equal(first.failed, 3, "nach drei Fehlern in Folge pausiert der Lauf");
  assert.equal(s.geocoder.queries.length, 3);
  assert.ok(s.logs.some((l) => /nicht erreichbar/.test(l)));

  // Wartezeit: sofort nichts, nach 20 Minuten die drei erneut (der vierte war noch nie dran)
  s.geocoder.queries.length = 0;
  assert.equal((await s.backfill.run()).attempted, 1, "der vierte, noch nie versuchte Ort");
  s.setClock("2026-10-11T08:20:00Z");
  s.geocoder.down = false;
  const later = await s.backfill.run();
  assert.equal(later.resolved, 4);
  assert.equal(s.backfill.stats().open, 0, "alles aufgelöst, sobald das Netz wieder da ist");
});

test("nachtrag: Fehlversuche enden endgültig (Backoff, höchstens fünf)", async () => {
  const s = await boot({});
  await s.mk({ type: "Hotel", title: "A", address: "Corso 1" });
  s.geocoder.down = true;
  let t = new Date(FROZEN).getTime();
  let attempts = 0;
  for (let i = 0; i < 8; i++) {
    s.setClock(new Date(t).toISOString());
    attempts += (await s.backfill.run()).attempted;
    t += 7 * 3_600_000;
  }
  assert.equal(attempts, 5);
  assert.equal(s.backfill.stats().open, 0, "aufgegeben");
  assert.equal(s.backfill.stats().failed, 1);
});

test("nachtrag: Steuerung (auto/on/off), ohne Geokodierer aus, Diagnose-Route nur für Admins", async () => {
  assert.equal(backfillModeFromEnv({}), "auto");
  assert.equal(backfillModeFromEnv({ TRAVELBUDDY_GEOCODE_BACKFILL: "off" }), "off");
  assert.equal(backfillModeFromEnv({ TRAVELBUDDY_GEOCODE_BACKFILL: "an" }), "on");
  const db = openDb(":memory:");
  migrate(db);
  assert.equal(new GeocodeBackfill({ db, geocoder: null }).enabled, false);
  assert.equal(new GeocodeBackfill({ db, geocoder: new FakeGeocoder(), mode: "off" }).enabled, false);
  assert.equal(new GeocodeBackfill({ db, geocoder: new FakeGeocoder(), mode: "auto" }).enabled, true);

  const s = await setup();
  const anna = await s.tokens.anna();
  const ben = await s.tokens.ben();
  assert.equal((await s.call("GET", "/v1/maps/backfill", { token: ben })).status, 403);
  assert.equal((await s.call("GET", "/v1/maps/backfill")).status, 401);
  const r = await s.call("GET", "/v1/maps/backfill", { token: anna });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["due", "enabled", "failed", "geocoder", "lastRun", "lastRunAt", "notFound", "open", "resolved", "running"]);
  assert.equal(r.body.enabled, false);
});

test("nachtrag: Diagnose-Route mit laufendem Nachtrag zeigt Zähler und letzten Lauf", async () => {
  const geocoder = new FakeGeocoder({ Olbia: [40.9, 9.5] });
  const holder: { b?: GeocodeBackfill } = {};
  const s = await setup({ deps: { backfill: { stats: () => holder.b!.stats() } as any } });
  holder.b = new GeocodeBackfill({ db: s.db, geocoder, now: () => new Date(FROZEN), log: () => {} });
  const anna = await s.tokens.anna();
  const trip = await s.call("POST", "/v1/trips", { token: anna, json: { title: "T" } });
  await s.call("POST", `/v1/trips/${trip.body.trip.id}/events`, { token: anna, json: { type: "Hotel", title: "H", address: "Corso 1, Olbia" } });
  let r = await s.call("GET", "/v1/maps/backfill", { token: anna });
  assert.deepEqual([r.body.enabled, r.body.geocoder, r.body.open, r.body.due], [true, "fake", 1, 1]);
  await holder.b.run();
  r = await s.call("GET", "/v1/maps/backfill", { token: anna });
  assert.deepEqual([r.body.open, r.body.resolved, r.body.lastRun.resolved, r.body.lastRunAt], [0, 1, 1, FROZEN.replace("Z", ".000Z")]);
});
