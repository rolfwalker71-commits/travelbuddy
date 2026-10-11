import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { illustrationCandidates, notificationImageFile } from "../src/notifications/routes";
import { notifSetup } from "./notif-helpers";

const png = (tag: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tb-illu-"));
const put = (file: string, tag: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(tag));
};

test("mitteilungsbilder: PNG aus <dir>/notifications/<key>.png, dunkel per ?scheme=dark mit Rückfall, Cache-Header", async () => {
  const dir = tmp();
  put(path.join(dir, "notifications", "notif-today.png"), "heute-hell");
  put(path.join(dir, "notifications", "notif-today-dark.png"), "heute-dunkel");
  put(path.join(dir, "notifications", "notif-stay.png"), "unterkunft-hell"); // ohne dunkle Fassung
  const env = await notifSetup({ illustrationsDir: dir });
  const ben = await env.tokens.ben(); // Nicht-Admin genügt

  const light = await env.app.request("/v1/media/notification/notif-today", { headers: { authorization: `Bearer ${ben}` } });
  assert.equal(light.status, 200);
  assert.equal(light.headers.get("content-type"), "image/png");
  assert.match(light.headers.get("cache-control") ?? "", /max-age=\d+/);
  assert.equal(light.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await light.arrayBuffer()).toString("latin1").endsWith("heute-hell"), true);

  const dark = await env.app.request("/v1/media/notification/notif-today?scheme=dark", { headers: { authorization: `Bearer ${ben}` } });
  assert.equal(dark.status, 200);
  assert.equal(Buffer.from(await dark.arrayBuffer()).toString("latin1").endsWith("heute-dunkel"), true);
  const viaKey = await env.app.request("/v1/media/notification/notif-today-dark", { headers: { authorization: `Bearer ${ben}` } });
  assert.equal(Buffer.from(await viaKey.arrayBuffer()).toString("latin1").endsWith("heute-dunkel"), true);

  const fallback = await env.app.request("/v1/media/notification/notif-stay?scheme=dark", { headers: { authorization: `Bearer ${ben}` } });
  assert.equal(fallback.status, 200);
  assert.equal(Buffer.from(await fallback.arrayBuffer()).toString("latin1").endsWith("unterkunft-hell"), true, "dunkel fehlt: hell");

  // bedingte Anfrage
  const etag = light.headers.get("etag")!;
  assert.ok(etag);
  const again = await env.app.request("/v1/media/notification/notif-today", { headers: { authorization: `Bearer ${ben}`, "if-none-match": etag } });
  assert.equal(again.status, 304);
});

test("mitteilungsbilder: Ablage des Grafik-Pakets (png/light, png/dark), fehlende Datei 404, Bearer-Pflicht, Schlüsselprüfung", async () => {
  const dir = tmp();
  put(path.join(dir, "notifications", "png", "light", "notif-depart.png"), "abflug-hell");
  put(path.join(dir, "notifications", "png", "dark", "notif-depart.png"), "abflug-dunkel");
  const env = await notifSetup({ illustrationsDir: dir });
  const anna = await env.tokens.anna();
  const get = (p: string, token: string | null = anna) =>
    env.app.request(p, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  const l = await get("/v1/media/notification/notif-depart");
  assert.equal(Buffer.from(await l.arrayBuffer()).toString("latin1").endsWith("abflug-hell"), true);
  const d = await get("/v1/media/notification/notif-depart?scheme=dark");
  assert.equal(Buffer.from(await d.arrayBuffer()).toString("latin1").endsWith("abflug-dunkel"), true);

  const missing = await get("/v1/media/notification/notif-review");
  assert.equal(missing.status, 404, "404, bis die Datei da ist");
  assert.equal((await missing.json()).error.code, "image_not_available");
  assert.equal((await get("/v1/media/notification/notif-depart", null)).status, 401);
  assert.equal((await get("/v1/media/notification/..%2Fsecret")).status, 404);
  assert.equal((await get("/v1/media/notification/NOTIF-DEPART")).status, 404);
  assert.equal((await get("/v1/media/notification/etc-passwd")).status, 404);
});

test("mitteilungsbilder: TRAVELBUDDY_ILLUSTRATIONS_DIR hat Vorrang; Repo-Illustrationen werden ohne Angabe gefunden", async () => {
  const dir = tmp();
  put(path.join(dir, "notifications", "notif-pickup.png"), "x");
  const c = illustrationCandidates({ TRAVELBUDDY_ILLUSTRATIONS_DIR: dir });
  assert.equal(c[0], dir);
  assert.ok(notificationImageFile([dir], "notif-pickup", "light")!.endsWith(path.join("notifications", "notif-pickup.png")));
  assert.equal(notificationImageFile([dir], "notif-deadline", "light"), null);
  assert.equal(notificationImageFile([], "notif-pickup", "dark"), null);

  // Ohne Angabe: Repo-Pfad `shared/illustrations` (relativ zum Quellordner), sofern die Grafik-Dateien da sind
  const repoFile = notificationImageFile(illustrationCandidates({}), "notif-today", "light");
  if (repoFile) {
    const env = await notifSetup();
    const anna = await env.tokens.anna();
    const r = await env.app.request("/v1/media/notification/notif-today", { headers: { authorization: `Bearer ${anna}` } });
    assert.equal(r.status, 200);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  }
});
