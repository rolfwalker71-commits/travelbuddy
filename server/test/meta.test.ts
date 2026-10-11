import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { airportCount, findAirport, searchAirports } from "../src/meta/airports";
import { setup } from "./helpers";

test("flughäfen: Tabelle, Suche (Code, Stadt mit Umlaut), IATA-Nachschlagen", () => {
  assert.ok(airportCount() > 3000);
  const zrh = findAirport("zrh")!;
  assert.deepEqual([zrh.iata, zrh.country, zrh.tz], ["ZRH", "CH", "Europe/Zurich"]);
  assert.equal(findAirport("XXX"), null);
  assert.equal(findAirport(null), null);
  assert.equal(searchAirports("zrh")[0]!.iata, "ZRH");
  assert.ok(searchAirports("zürich").some((a) => a.iata === "ZRH"));
  assert.ok(searchAirports("miami").some((a) => a.iata === "MIA"));
  assert.deepEqual(searchAirports(""), []);
  assert.ok(searchAirports("a", 5).length <= 5);
});

test("meta: /v1/meta/airports und /v1/meta/timezone", async () => {
  const { call, tokens } = await setup();
  assert.equal((await call("GET", "/v1/meta/airports?q=zrh")).status, 401);
  const anna = await tokens.anna();
  const r = await call("GET", "/v1/meta/airports?q=zrh", { token: anna });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.airports[0]).sort(), ["city", "country", "iata", "lat", "lon", "name", "tz"]);
  assert.equal(r.body.airports[0].iata, "ZRH");
  assert.equal((await call("GET", "/v1/meta/airports", { token: anna })).status, 400);

  const tz = await call("GET", "/v1/meta/timezone?lat=25.79&lon=-80.29", { token: anna });
  assert.deepEqual(tz.body, { tz: "America/New_York" });
  assert.deepEqual((await call("GET", "/v1/meta/timezone?lat=47.37&lon=8.54", { token: anna })).body, { tz: "Europe/Zurich" });
  assert.equal((await call("GET", "/v1/meta/timezone?lat=abc&lon=1", { token: anna })).status, 400);
  assert.equal((await call("GET", "/v1/meta/timezone?lat=200&lon=1", { token: anna })).status, 400);
  assert.equal((await call("GET", "/v1/meta/timezone", { token: anna })).status, 400);
});

test("version: öffentlich, folgt VERSION, package.json stimmt überein", async () => {
  const { call } = await setup();
  const r = await call("GET", "/v1/version");
  assert.equal(r.status, 200);
  const file = fs.readFileSync(path.resolve(import.meta.dirname, "../../VERSION"), "utf8").trim();
  assert.equal(r.body.name, "TravelBuddy");
  assert.equal(r.body.version, file);
  assert.equal(r.body.api, 1);
  assert.ok(typeof r.body.build === "string" && r.body.build.length > 0);
  assert.match(r.body.builtAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"));
  assert.equal(pkg.name, "travelbuddy-server");
  assert.equal(pkg.version, file, "package.json folgt der Datei VERSION");
});

test("version: Umgebung übersteuert Build und Zeitpunkt", async () => {
  const { versionInfo } = await import("../src/lib/version");
  const v = versionInfo({ TRAVELBUDDY_BUILD: "abc1234", TRAVELBUDDY_BUILT_AT: "2026-10-11T12:30:00.000Z" });
  assert.equal(v.build, "abc1234");
  assert.equal(v.builtAt, "2026-10-11T12:30:00.000Z");
});

test("port: Standard ist 7780", async () => {
  const { loadConfig } = await import("../src/config");
  assert.equal(loadConfig({}).port, 7780);
  assert.equal(loadConfig({ PORT: "3300" }).port, 3300);
});
