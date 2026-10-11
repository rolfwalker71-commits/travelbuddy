import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { AppleMapsGeocoder, CachingGeocoder, FallbackGeocoder, NominatimGeocoder, geocoderFromEnv, type GeocodeHit, type Geocoder } from "../src/geo/geocode";
import { createBackground } from "../src/lib/background";
import { setup } from "./helpers";

/** Fake: bekannte Adressen → Treffer, sonst null; protokolliert alle Anfragen. */
class FakeGeocoder implements Geocoder {
  readonly name = "fake";
  readonly queries: string[] = [];
  constructor(private readonly table: Record<string, [number, number]> = {}, private readonly failing = false) {}
  async geocode(query: string): Promise<GeocodeHit | null> {
    this.queries.push(query);
    if (this.failing) throw new Error("Dienst nicht erreichbar");
    const hit = Object.entries(this.table).find(([k]) => query.toLowerCase().includes(k.toLowerCase()));
    if (!hit) return null;
    return { lat: hit[1][0], lon: hit[1][1], label: `${query} (aufgelöst)`, confidence: 0.8, provider: "fake" };
  }
}

async function geoSetup(geocoder: Geocoder | null) {
  const background = createBackground();
  const s = await setup({ deps: { geocoder, background } });
  const anna = await s.tokens.anna();
  const t = await s.call("POST", "/v1/trips", { token: anna, json: { title: "Karte", destination: "Miami" } });
  return { ...s, anna, background, tripId: t.body.trip.id as number };
}
const ev = (body: any, id: number) => body.events.find((e: any) => e.id === id);

test("geokodierung: places[] aus Adresse und details (Mietauto: Abholung und Rückgabe)", async () => {
  const { call, anna, tripId } = await geoSetup(null);
  const r = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: {
      type: "Mietauto", title: "Mietwagen", address: "2100 NW 42nd Ave, Miami, FL 33126",
      details: { pickupPlace: "Hertz MIA", returnPlace: "Hertz Fort Lauderdale" },
    },
  });
  const e = ev(r.body, r.body.eventId);
  assert.deepEqual(e.places.map((p: any) => [p.role, p.label, p.address, p.lat]), [
    ["pickup", "Hertz MIA", "2100 NW 42nd Ave, Miami, FL 33126", null],
    ["return", "Hertz Fort Lauderdale", null, null],
  ]);

  const hotel = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna, json: { type: "Hotel", title: "Hotel", location: "Hotel Negresco", address: "Promenade des Anglais 37, Nice", lat: 43.69, lon: 7.25 },
  });
  assert.deepEqual(ev(hotel.body, hotel.body.eventId).places, [
    { role: "venue", label: "Hotel Negresco", address: "Promenade des Anglais 37, Nice", lat: 43.69, lon: 7.25, source: "manual" },
  ]);
  const none = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Notiz", type: "Aufgabe" } });
  assert.deepEqual(ev(none.body, none.body.eventId).places, []);
});

test("geokodierung: Route löst alle Orte auf, schreibt lat/lon und fieldsMeta, weitere Orte je Rolle", async () => {
  const fake = new FakeGeocoder({ "2100 NW": [25.8, -80.28], "Fort Lauderdale": [26.07, -80.15] });
  const { call, anna, tripId, background } = await geoSetup(fake);
  // Beim Speichern läuft die Auflösung im Hintergrund an; hier zuerst abwarten und dann gezielt erneut auslösen.
  const created = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: { type: "Mietauto", title: "Mietwagen", address: "2100 NW 42nd Ave, Miami", details: { pickupPlace: "Hertz MIA", returnPlace: "Hertz Fort Lauderdale" } },
  });
  await background.idle();
  const id = created.body.eventId as number;
  // Suchbegriff = Adresse, sonst Ortsname (ohne Reiseziel als Anhang)
  assert.deepEqual(fake.queries, ["2100 NW 42nd Ave, Miami", "Hertz Fort Lauderdale"]);

  const kept = await call("POST", `/v1/trips/${tripId}/events/${id}/geocode`, { token: anna, json: {} });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.results.map((x: any) => [x.role, x.status]), [["pickup", "kept"], ["return", "kept"]]);
  assert.equal(fake.queries.length, 2, "keine neue Anfrage");

  // mit force wird neu aufgelöst
  const r = await call("POST", `/v1/trips/${tripId}/events/${id}/geocode`, { token: anna, json: { force: true } });
  assert.deepEqual(r.body.results.map((x: any) => [x.role, x.status]), [["pickup", "resolved"], ["return", "resolved"]]);
  const e = ev(r.body, id);
  assert.equal(e.lat, 25.8);
  assert.equal(e.lon, -80.28);
  assert.equal(e.fieldsMeta.lat.source, "geocoded");
  assert.equal(e.fieldsMeta.lat.confidence, 0.8);
  assert.equal(e.fieldsMeta.lat.quote, "2100 NW 42nd Ave, Miami (aufgelöst)");
  assert.deepEqual(e.places.map((p: any) => [p.role, p.lat, p.lon, p.source]), [
    ["pickup", 25.8, -80.28, "geocoded"],
    ["return", 26.07, -80.15, "geocoded"],
  ]);
});

test("geokodierung: von Hand gesetzte Koordinaten werden nie überschrieben", async () => {
  const fake = new FakeGeocoder({ Via: [1, 1], Hafen: [2, 2] });
  const { call, anna, tripId } = await geoSetup(fake);
  const created = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: { type: "Transfer", title: "Transfer", address: "Via Roma 1", lat: 40.9, lon: 9.5, details: { originPlace: "Hafen Olbia", destinationPlace: "Hotel" } },
  });
  const id = created.body.eventId as number;
  // Erster Ort (Hauptkoordinaten) von Hand, zweiter Ort (Ziel) ohne Koordinaten
  const r = await call("POST", `/v1/trips/${tripId}/events/${id}/geocode`, { token: anna, json: { force: true } });
  assert.equal(r.body.results[0].role, "start");
  assert.equal(r.body.results[0].status, "skipped_manual");
  const e = ev(r.body, id);
  assert.equal(e.lat, 40.9);
  assert.equal(e.lon, 9.5);
  assert.equal(e.fieldsMeta.lat.source, "manual");
  // das Ziel hat nur «Hotel» als Ortsname und wurde mit Kontext gesucht (nicht gefunden → unverändert)
  assert.notEqual(r.body.results[1].status, "skipped_manual");

  // Koordinaten eines weiteren Ortes von Hand setzen (Client-Auflösung per MapKit) → ebenfalls geschützt
  const set = await call("PATCH", `/v1/trips/${tripId}/events/${id}`, { token: anna, json: { placeCoords: { end: { lat: 41, lon: 9.6 } } } });
  assert.equal(ev(set.body, id).places[1].source, "manual");
  const again = await call("POST", `/v1/trips/${tripId}/events/${id}/geocode`, { token: anna, json: { force: true } });
  assert.deepEqual(again.body.results.map((x: any) => x.status), ["skipped_manual", "skipped_manual"]);
  assert.equal(ev(again.body, id).places[1].lat, 41);

  // gesperrte Koordinaten bleiben auch bei source «geocoded» geschützt
  const g = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { type: "Hotel", title: "H", address: "Via Neu 3" } });
  const gid = g.body.eventId as number;
  await call("POST", `/v1/trips/${tripId}/events/${gid}/geocode`, { token: anna, json: {} });
  await call("PATCH", `/v1/trips/${tripId}/events/${gid}`, { token: anna, json: { fieldsMeta: { lat: { locked: true } } } });
  const locked = await call("POST", `/v1/trips/${tripId}/events/${gid}/geocode`, { token: anna, json: { force: true } });
  assert.equal(locked.body.results[0].status, "skipped_manual");
});

test("geokodierung: Flughäfen aus der IATA-Tabelle, Fehlschläge, kein Dienst", async () => {
  const fake = new FakeGeocoder({}, false);
  const { call, anna, tripId } = await geoSetup(fake);
  const f = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna, json: { type: "Flug", title: "ZRH → MIA", details: { departureAirport: "ZRH", arrivalAirport: "MIA" } },
  });
  const r = await call("POST", `/v1/trips/${tripId}/events/${f.body.eventId}/geocode`, { token: anna, json: {} });
  assert.deepEqual(r.body.results.map((x: any) => x.status), ["airport", "airport"]);
  assert.equal(fake.queries.length, 0, "für Flughäfen kein Netz");

  const unknown = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { type: "Hotel", title: "H", address: "Nirgendwo 1" } });
  const nf = await call("POST", `/v1/trips/${tripId}/events/${unknown.body.eventId}/geocode`, { token: anna, json: {} });
  assert.equal(nf.body.results[0].status, "not_found");

  const down = await geoSetup(new FakeGeocoder({}, true));
  const e = await down.call("POST", `/v1/trips/${down.tripId}/events`, { token: down.anna, json: { type: "Hotel", title: "H", address: "Via 1" } });
  const u = await down.call("POST", `/v1/trips/${down.tripId}/events/${e.body.eventId}/geocode`, { token: down.anna, json: {} });
  assert.equal(u.status, 200);
  assert.equal(u.body.results[0].status, "unavailable");

  const off = await geoSetup(null);
  const o = await off.call("POST", `/v1/trips/${off.tripId}/events`, { token: off.anna, json: { type: "Hotel", title: "H", address: "Via 1" } });
  const na = await off.call("POST", `/v1/trips/${off.tripId}/events/${o.body.eventId}/geocode`, { token: off.anna, json: {} });
  assert.equal(na.status, 409);
  assert.equal(na.body.error.code, "geocoder_not_configured");
});

test("geokodierung: nach dem Speichern im Hintergrund, nur Orte ohne Koordinaten", async () => {
  const fake = new FakeGeocoder({ Olbia: [40.92, 9.5] });
  const { call, anna, tripId, background } = await geoSetup(fake);
  const created = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { type: "Hotel", title: "H", address: "Corso Umberto, Olbia" } });
  await background.idle();
  const detail = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  assert.equal(ev(detail.body, created.body.eventId).lat, 40.92);
  assert.equal(fake.queries.length, 1);
  // Änderung ohne Adresse löst nichts aus
  await call("PATCH", `/v1/trips/${tripId}/events/${created.body.eventId}`, { token: anna, json: { notes: "n" } });
  await background.idle();
  assert.equal(fake.queries.length, 1);
});

test("nominatim: eigener User-Agent, höchstens 1 Anfrage/s, Parameter", async () => {
  const calls: Array<{ url: string; ua: string; at: number }> = [];
  let clock = 1_000_000;
  const slept: number[] = [];
  const g = new NominatimGeocoder({
    userAgent: "TravelBuddy-Server/0.1.0 (test)",
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), ua: String((init?.headers as Record<string, string>)["User-Agent"]), at: clock });
      return new Response(JSON.stringify([{ lat: "47.4581", lon: "8.5481", display_name: "Flughafen Zürich", importance: 0.7 }]), { status: 200 });
    },
  });
  const [a, b, c] = await Promise.all([g.geocode("Zürich Flughafen"), g.geocode("Bern"), g.geocode("Basel")]);
  assert.deepEqual([a!.lat, a!.lon, a!.label], [47.4581, 8.5481, "Flughafen Zürich"]);
  assert.equal(b!.confidence, 0.7);
  assert.ok(c);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((x) => x.ua === "TravelBuddy-Server/0.1.0 (test)"));
  assert.ok(calls[1]!.at - calls[0]!.at >= 1000 && calls[2]!.at - calls[1]!.at >= 1000, "mindestens 1 s Abstand");
  const u = new URL(calls[0]!.url);
  assert.equal(u.hostname, "nominatim.openstreetmap.org");
  assert.equal(u.searchParams.get("q"), "Zürich Flughafen");
  assert.equal(u.searchParams.get("limit"), "1");
  assert.equal(u.searchParams.get("format"), "jsonv2");

  // Fehler blockiert die Warteschlange nicht
  const failing = new NominatimGeocoder({
    userAgent: "x", now: () => clock, sleep: async () => {},
    fetch: async () => new Response("", { status: 503 }),
  });
  await assert.rejects(failing.geocode("x"), /503/);
});

test("zwischenspeicher: Treffer und Fehlschläge werden gemerkt, Dienstfehler nicht", async () => {
  const { db } = await setup();
  const inner = new FakeGeocoder({ Bern: [46.95, 7.45] });
  let t = Date.parse("2026-10-10T08:00:00Z");
  const g = new CachingGeocoder(db, inner, () => t);
  assert.ok(await g.geocode("  Bern  "));
  assert.ok(await g.geocode("bern"));
  assert.equal(await g.geocode("Nirgendwo"), null);
  assert.equal(await g.geocode("Nirgendwo"), null);
  assert.equal(inner.queries.length, 2, "je ein Aufruf für «bern» und «nirgendwo»");
  // Negativer Eintrag verfällt nach einem Tag
  t += 25 * 3_600_000;
  await g.geocode("Nirgendwo");
  assert.equal(inner.queries.length, 3);

  const failing = new CachingGeocoder(db, new FakeGeocoder({}, true), () => t);
  await assert.rejects(failing.geocode("Irgendwas"));
  assert.equal(db.prepare("SELECT 1 FROM geocode_cache WHERE query_key = 'irgendwas'").get(), undefined);

  const chain = new FallbackGeocoder([new FakeGeocoder({}, true), new FakeGeocoder({ Luzern: [47.05, 8.3] })]);
  assert.equal((await chain.geocode("Luzern"))!.lat, 47.05);
});

test("apple maps server api: Token tauschen, geocode, Zugriffstoken wiederverwenden", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const seen: Array<{ url: string; auth: string }> = [];
  const g = new AppleMapsGeocoder(
    { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem, origin: "https://x.example" },
    {
      fetch: async (url, init) => {
        const auth = String((init?.headers as Record<string, string>).Authorization);
        seen.push({ url: String(url), auth });
        if (String(url).endsWith("/v1/token")) {
          return new Response(JSON.stringify({ accessToken: "ZUGRIFF", expiresInSeconds: 1800 }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ results: [{ coordinate: { latitude: 25.79, longitude: -80.29 }, formattedAddressLines: ["Miami International Airport", "Miami, FL"] }] }),
          { status: 200 }
        );
      },
      now: () => 1_800_000_000_000,
    }
  );
  const hit = await g.geocode("MIA Airport");
  assert.deepEqual([hit!.lat, hit!.lon, hit!.label, hit!.provider], [25.79, -80.29, "Miami International Airport, Miami, FL", "apple"]);
  await g.geocode("Zweite Adresse");
  assert.equal(seen.filter((s) => s.url.endsWith("/v1/token")).length, 1);
  assert.equal(seen[0]!.auth.startsWith("Bearer ey"), true, "Maps-Token (JWT) für den Tausch");
  assert.equal(seen[1]!.auth, "Bearer ZUGRIFF");
  assert.match(seen[1]!.url, /\/v1\/geocode\?q=MIA\+Airport&lang=de-CH/);
});

test("geocoderFromEnv: Apple mit Schlüssel vor Nominatim, off schaltet ab", async () => {
  const { db } = await setup();
  const base = { db, version: "0.1.0" };
  assert.equal(geocoderFromEnv({ TRAVELBUDDY_GEOCODER: "off" }, { ...base, mapkit: null }), null);
  assert.equal(geocoderFromEnv({}, { ...base, mapkit: null })!.name, "nominatim");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const mapkit = { teamId: "T", keyId: "K", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), origin: null };
  assert.equal(geocoderFromEnv({}, { ...base, mapkit })!.name, "apple+nominatim");
  assert.equal(geocoderFromEnv({ TRAVELBUDDY_GEOCODER: "nominatim" }, { ...base, mapkit })!.name, "nominatim");
});
