import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { migrate, openDb } from "../src/db/client";
import { findWebDir } from "../src/web/static";

function webFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-web-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>TravelBuddy</title>");
  fs.writeFileSync(path.join(dir, "assets", "app.abc123.js"), "console.log('hi')");
  fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  // Geheimnis ausserhalb des Web-Ordners, das nie ausgeliefert werden darf
  fs.writeFileSync(path.join(path.dirname(dir), `${path.basename(dir)}-secret.txt`), "GEHEIM");
  return dir;
}

function setup() {
  const db = openDb(":memory:");
  migrate(db);
  const dir = webFixture();
  const app = createApp({ db, webDir: dir });
  return { app, dir };
}

test("web: index, SPA-Fallback und Assets mit Cache-Regeln", async () => {
  const { app } = setup();

  const root = await app.request("/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(root.headers.get("cache-control"), "no-cache");
  assert.match(await root.text(), /TravelBuddy/);

  // Client-Routing: unbekannter Pfad → index.html (Gast-Links!)
  const spa = await app.request("/g/abc123tokenxyz");
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<title>TravelBuddy/);

  const asset = await app.request("/assets/app.abc123.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);
  assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

  const icon = await app.request("/favicon.svg");
  assert.equal(icon.headers.get("content-type"), "image/svg+xml");
  assert.equal(icon.headers.get("cache-control"), "no-cache");
});

test("web: Sicherheits-Header, insbesondere no-referrer für Gäste-Links", async () => {
  const { app } = setup();
  const res = await app.request("/g/token");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/, "keine Inline-Skripte");
});

test("web: API-Pfade bleiben API, fehlende Dateien sind 404, kein Ausbrechen aus dem Ordner", async () => {
  const { app, dir } = setup();

  // Unbekannte API-Pfade bleiben JSON (nie index.html); ohne Anmeldung verrät die API nichts über Routen.
  const api = await app.request("/v1/gibts-nicht");
  assert.equal(api.status, 401);
  assert.match(api.headers.get("content-type") ?? "", /json/);
  assert.equal(((await api.json()) as any).error.code, "unauthorized");

  const health = await app.request("/healthz");
  assert.deepEqual(await health.json(), { ok: true });

  const missing = await app.request("/assets/fehlt.js");
  assert.equal(missing.status, 404);

  const secretName = `${path.basename(dir)}-secret.txt`;
  for (const evil of [
    `/..%2f${secretName}`,
    `/%2e%2e/${secretName}`,
    `/assets/..%2f..%2f${secretName}`,
    "/%00",
    "/%E0%A4%A", // ungültiges Percent-Encoding
  ]) {
    const r = await app.request(evil);
    const text = await r.text();
    assert.ok(!text.includes("GEHEIM"), `Pfad ${evil} hat Geheimnis geliefert`);
  }

  // Nur GET/HEAD werden statisch bedient
  const post = await app.request("/", { method: "POST" });
  assert.equal(post.status, 404);
  const head = await app.request("/", { method: "HEAD" });
  assert.equal(head.status, 200);
});

test("web: ohne webDir bleibt der Server reine API", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = createApp({ db });
  assert.equal((await app.request("/")).status, 404);
  assert.equal(findWebDir([undefined, "/gibt/es/nicht"]), null);
});
