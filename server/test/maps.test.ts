import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { createUser } from "../src/auth/auth";
import { migrate, openDb } from "../src/db/client";
import { mapkitConfigFromEnv, mapkitToken, normalizeOrigin, normalizePrivateKey } from "../src/maps/mapkit";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
const oneLine = pem.replace(/\n/g, "\\n");

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("mapkit: Schlüssel aus einzeiliger Umgebungsvariable (\\n, Anführungszeichen, ohne BEGIN-Zeilen)", () => {
  assert.equal(normalizePrivateKey(oneLine), pem);
  assert.equal(normalizePrivateKey(`"${oneLine}"`), pem);
  assert.equal(normalizePrivateKey(pem), pem);
  const body = pem.split("\n").slice(1, -1).join("");
  assert.equal(normalizePrivateKey(body).replace(/\n/g, ""), `-----BEGIN PRIVATE KEY-----${body}-----END PRIVATE KEY-----`);
  assert.equal(normalizeOrigin("https://travel.example.ch/pfad?x=1"), "https://travel.example.ch");
  assert.equal(normalizeOrigin("kein url"), null);
  assert.equal(normalizeOrigin(""), null);
});

test("mapkit: Konfiguration aus TRAVELBUDDY_MAPKIT_* (KEY inline oder KEY_PATH), unvollständig = aus", () => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  assert.equal(mapkitConfigFromEnv({}, warn), null);
  assert.equal(warnings.length, 0);

  const inline = mapkitConfigFromEnv(
    {
      TRAVELBUDDY_MAPKIT_TEAM_ID: "TEAM123456",
      TRAVELBUDDY_MAPKIT_KEY_ID: "KEY1234567",
      TRAVELBUDDY_MAPKIT_ORIGIN: "https://travel.example.ch/",
      TRAVELBUDDY_MAPKIT_KEY: oneLine,
    },
    warn
  );
  assert.deepEqual(
    [inline?.teamId, inline?.keyId, inline?.origin, inline?.privateKey],
    ["TEAM123456", "KEY1234567", "https://travel.example.ch", pem]
  );

  // Pfad zur .p8-Datei statt Inhalt
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mapkey-"));
  const file = path.join(dir, "AuthKey_KEY1234567.p8");
  fs.writeFileSync(file, pem);
  const viaPath = mapkitConfigFromEnv(
    { TRAVELBUDDY_MAPKIT_TEAM_ID: "T", TRAVELBUDDY_MAPKIT_KEY_ID: "K", TRAVELBUDDY_MAPKIT_KEY_PATH: file },
    warn
  );
  assert.equal(viaPath?.privateKey, pem);
  assert.equal(viaPath?.origin, null);

  // Unvollständig, unlesbar oder kaputt: aus, ohne den Schlüsselinhalt zu nennen
  assert.equal(mapkitConfigFromEnv({ TRAVELBUDDY_MAPKIT_TEAM_ID: "T" }, warn), null);
  assert.equal(
    mapkitConfigFromEnv({ TRAVELBUDDY_MAPKIT_TEAM_ID: "T", TRAVELBUDDY_MAPKIT_KEY_ID: "K", TRAVELBUDDY_MAPKIT_KEY: "kaputt" }, warn),
    null
  );
  assert.equal(
    mapkitConfigFromEnv({ TRAVELBUDDY_MAPKIT_TEAM_ID: "T", TRAVELBUDDY_MAPKIT_KEY_ID: "K", TRAVELBUDDY_MAPKIT_KEY_PATH: path.join(dir, "fehlt.p8") }, warn),
    null
  );
  // Alte TravelBuddy-Namen gelten nicht mehr
  assert.equal(mapkitConfigFromEnv({ HOMEBUDDY_MAPKIT_TEAM_ID: "T", HOMEBUDDY_MAPKIT_KEY_ID: "K", HOMEBUDDY_MAPKIT_PRIVATE_KEY: oneLine }, warn), null);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((w) => !w.includes("kaputt")), "Schlüsselinhalt gehört nicht ins Protokoll");
});

test("mapkit: Token ist ein gültiges ES256-JWT mit kid, iss, exp und origin", () => {
  const cfg = { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem, origin: "https://travel.example.ch" };
  const token = mapkitToken(cfg, 1_800_000_000, 600);
  const [h, c, s] = token.split(".") as [string, string, string];
  assert.deepEqual(decode(h), { alg: "ES256", kid: "KEY1234567", typ: "JWT" });
  assert.deepEqual(decode(c), {
    iss: "TEAM123456",
    iat: 1_800_000_000,
    exp: 1_800_000_600,
    origin: "https://travel.example.ch",
  });
  const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey(pem), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  assert.equal(ok, true);
  // Ohne Ursprung kein origin-Claim
  const noOrigin = mapkitToken({ ...cfg, origin: null }, 1_800_000_000);
  assert.equal("origin" in decode(noOrigin.split(".")[1]!), false);
});

async function setup(mapkit: Parameters<typeof createApp>[0]["mapkit"], webDir?: string) {
  const db = openDb(":memory:");
  migrate(db);
  await createUser(db, { username: "admin", password: "admin-pw-123456", displayName: "Admin", isAdmin: true });
  await createUser(db, { username: "tina", password: "tina-pw-1234567", displayName: "Tina" });
  const app = createApp({ db, mapkit, webDir, now: () => new Date("2026-10-10T08:00:00Z") });
  const login = async (u: string, p: string) => {
    const r = await app.request("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    return ((await r.json()) as any).token as string;
  };
  const get = (token: string | null) =>
    app.request("/v1/maps/token", { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { app, login, get };
}

test("maps: /v1/maps/token verlangt Anmeldung, steht Reiseteilnehmern offen und ist ohne Konfiguration 404", async () => {
  const cfg = { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem, origin: null };
  const on = await setup(cfg);
  assert.equal((await on.get(null)).status, 401);

  const admin = await on.login("admin", "admin-pw-123456");
  const tina = await on.login("tina", "tina-pw-1234567");
  for (const t of [admin, tina]) {
    const res = await on.get(t);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as any;
    assert.equal(body.expiresAt, "2026-10-10T08:30:00.000Z");
    const claims = decode(String(body.token).split(".")[1]!);
    assert.equal(claims.iss, "TEAM123456");
    assert.equal(claims.exp, Math.floor(Date.parse("2026-10-10T08:00:00Z") / 1000) + 1800);
  }

  const off = await setup(null);
  const t = await off.login("tina", "tina-pw-1234567");
  const res = await off.get(t);
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as any).error.code, "maps_not_configured");
});

test("maps: Content-Security-Policy öffnet Apple-Hosts nur, wenn MapKit konfiguriert ist", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-maps-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>TravelBuddy</title>");
  const cfg = { teamId: "T", keyId: "K", privateKey: pem, origin: null };

  const off = await setup(null, dir);
  const cspOff = (await off.app.request("/")).headers.get("content-security-policy") ?? "";
  assert.ok(!cspOff.includes("apple"), cspOff);
  assert.match(cspOff, /script-src 'self'(;|$)/);

  const on = await setup(cfg, dir);
  const cspOn = (await on.app.request("/")).headers.get("content-security-policy") ?? "";
  assert.match(cspOn, /script-src 'self' https:\/\/cdn\.apple-mapkit\.com;/);
  assert.match(cspOn, /connect-src 'self' https:\/\/\*\.apple-mapkit\.com/);
  assert.match(cspOn, /worker-src 'self' blob:/);
  assert.match(cspOn, /frame-ancestors 'none'/);
});
