import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackground } from "../src/lib/background";
import { imageGeneratorFromEnv, MediaService, openAiImages, buildEventImagePrompt, type ImageGenerator } from "../src/media/generate";
import { getMedia, mediaFilePath, purgeTrash, saveMedia, sniffImage } from "../src/media/store";
import { setup } from "./helpers";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bild-eins")]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bild-zwei!")]);

function fakeImages(opts: { fail?: () => boolean } = {}) {
  const prompts: string[] = [];
  const gen: ImageGenerator = {
    model: "fake-image",
    async generate(input) {
      prompts.push(input.prompt);
      if (opts.fail?.()) throw new Error("Bilddienst nicht erreichbar");
      return { bytes: PNG, contentType: "image/png" };
    },
  };
  return { gen, prompts };
}

async function mediaSetup(images: ImageGenerator | null = null) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-media-"));
  const background = createBackground();
  // Leerer Illustrationsordner: Die Mitteilungsbilder des Repos sollen den Test nicht beeinflussen.
  const illustrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-illu-"));
  const s = await setup({ deps: { mediaDir, images, background, illustrationsDir } });
  const anna = await s.tokens.anna();
  return { ...s, anna, mediaDir, background };
}

test("medien: nur Reisebild und Ereignisbild, Bildformate an den Bytes, Pfade bleiben im Ordner", () => {
  assert.equal(sniffImage(PNG)!.ext, "png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))!.contentType, "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("<html>")), null);
  const dir = "/tmp/m";
  assert.ok(mediaFilePath(dir, "trip_cover", "1-abc.png"));
  assert.equal(mediaFilePath(dir, "trip_cover", "../x.png"), null);
  assert.equal(mediaFilePath(dir, "document_icon" as any, "1.png"), null, "Dokument-Icons gibt es nicht mehr");
  assert.equal(mediaFilePath(dir, "ledger_cover" as any, "1.png"), null);
});

test("medien: Speichern ersetzt, alte Datei wird aufgeräumt, Besitzer löschen räumt auf", async () => {
  const { db, mediaDir, call, anna } = await mediaSetup();
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Bild" } });
  const id = t.body.trip.id;
  const a = saveMedia(db, mediaDir, { kind: "trip_cover", ownerId: id, bytes: PNG, source: "uploaded" });
  const fileA = mediaFilePath(mediaDir, "trip_cover", a.file_name!)!;
  assert.ok(fs.existsSync(fileA));
  const b = saveMedia(db, mediaDir, { kind: "trip_cover", ownerId: id, bytes: PNG2, source: "uploaded" });
  assert.notEqual(a.file_name, b.file_name);
  assert.equal(purgeTrash(db, mediaDir), 1);
  assert.equal(fs.existsSync(fileA), false);

  const detail = await call("GET", `/v1/trips/${id}`, { token: anna });
  assert.match(detail.body.trip.coverUrl, new RegExp(`^/v1/media/trip_cover/${id}\\?v=\\d+$`));
  assert.equal(await call("DELETE", `/v1/trips/${id}`, { token: anna }).then((r) => r.status), 200);
  assert.equal(getMedia(db, "trip_cover", id), undefined);
  assert.equal(purgeTrash(db, mediaDir), 1);
});

test("auslieferung: Header, ETag, 304; Mitreisende nur eigene Reisebilder; Gäste und Anonyme nicht", async () => {
  const { db, mediaDir, call, anna, tokens, userId, app } = await mediaSetup();
  const ben = await tokens.ben();
  const cleo = await tokens.cleo();
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Bilder", travelers: [{ displayName: "Ben", userId: userId("ben") }, { displayName: "Gast" }] } });
  const id = t.body.trip.id;
  const ev = await call("POST", `/v1/trips/${id}/events`, { token: anna, json: { title: "Hotel" } });
  saveMedia(db, mediaDir, { kind: "trip_cover", ownerId: id, bytes: PNG, source: "generated" });
  saveMedia(db, mediaDir, { kind: "event_image", ownerId: ev.body.eventId, bytes: PNG2, source: "generated" });

  const res = await app.request(`/v1/media/trip_cover/${id}`, { headers: { authorization: `Bearer ${anna}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const etag = res.headers.get("etag")!;
  const cached = await app.request(`/v1/media/trip_cover/${id}`, { headers: { authorization: `Bearer ${anna}`, "if-none-match": etag } });
  assert.equal(cached.status, 304);

  const get = (token: string | null, p: string) => app.request(p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await get(ben, `/v1/media/trip_cover/${id}`)).status, 200);
  assert.equal((await get(ben, `/v1/media/event_image/${ev.body.eventId}`)).status, 200);
  assert.equal((await get(cleo, `/v1/media/trip_cover/${id}`)).status, 403);
  assert.equal((await get(null, `/v1/media/trip_cover/${id}`)).status, 401);
  assert.equal((await get(anna, `/v1/media/document_icon/1`)).status, 404);
  assert.equal((await get(anna, `/v1/media/ledger_cover/1`)).status, 404);
  assert.equal((await get(ben, `/v1/media/document_icon/1`)).status, 403);

  // URLs: Angemeldete bekommen sie, Gäste (ohne Token) nicht
  const detail = await call("GET", `/v1/trips/${id}`, { token: anna });
  assert.ok(detail.body.events[0].imageUrl);
  assert.equal(detail.body.events[0].mapUrl, null);
  const gast = detail.body.travelers.find((x: any) => x.displayName === "Gast");
  const guest = await call("GET", `/v1/guest/trips/${gast.shareToken}`);
  assert.equal(guest.body.events[0].imageUrl, undefined);
  assert.equal(guest.body.trip.coverUrl, null);
});

test("erzeugung: beim Anlegen im Hintergrund, nur Fehlendes, nie überschreiben; Fehler lassen Anfragen nie scheitern", async () => {
  let failing = false;
  const { gen, prompts } = fakeImages({ fail: () => failing });
  const { db, call, anna, background } = await mediaSetup(gen);
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Sardinien", destination: "Olbia" } });
  assert.equal(t.status, 201);
  await background.idle();
  assert.ok(getMedia(db, "trip_cover", t.body.trip.id)?.file_name);
  assert.match(prompts[0]!, /Sardinien, Olbia/);

  const ev = await call("POST", `/v1/trips/${t.body.trip.id}/events`, { token: anna, json: { type: "Flug", title: "Flug", details: { departureAirport: "ZRH" } } });
  await background.idle();
  assert.ok(getMedia(db, "event_image", ev.body.eventId)?.file_name);
  assert.match(prompts[1]!, /«Flug»/);
  assert.match(prompts[1]!, /airports: ZRH/);
  assert.equal(prompts.length, 2);

  // Fehler: Anfrage gelingt trotzdem, Fehlversuch mit Wiederholung vermerkt
  failing = true;
  const ev2 = await call("POST", `/v1/trips/${t.body.trip.id}/events`, { token: anna, json: { title: "Hotel", type: "Hotel" } });
  assert.equal(ev2.status, 201);
  await background.idle();
  const row = getMedia(db, "event_image", ev2.body.eventId)!;
  assert.equal(row.file_name, null);
  assert.equal(row.attempts, 1);
  assert.ok(row.next_retry_at);

  // Wartungslauf: noch nicht fällig → nichts; später erfolgreich
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-media2-"));
  const svc = new MediaService({ db, mediaDir, images: gen, now: () => new Date(Date.now() + 10 * 60_000) });
  failing = false;
  const batch = await svc.runBatch();
  assert.equal(batch.generated, 1);
  assert.ok(getMedia(db, "event_image", ev2.body.eventId)?.file_name);
  assert.equal((await svc.runBatch()).generated, 0, "nichts Fehlendes mehr");
});

test("erzeugung: Umgebung, Prompts, Images-API", async () => {
  assert.equal(imageGeneratorFromEnv({}), null);
  assert.equal(imageGeneratorFromEnv({ OPENAI_API_KEY: "k", TRAVELBUDDY_AI_IMAGES: "0" }), null);
  assert.equal(imageGeneratorFromEnv({ OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-1" })!.model, "gpt-image-1");
  const p = buildEventImagePrompt({
    type: "Restaurant", title: "Abendessen", startDate: "2026-10-24", endDate: null, startTime: "19:00", endTime: null,
    location: "Miami", address: null, provider: null, bookingReference: null, phone: null, website: null, notes: null, details: {},
  });
  assert.match(p, /restaurant table/);

  let body: any = null;
  const api = openAiImages({ apiKey: "k", model: "gpt-image-1" }, async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 });
  });
  const out = await api.generate({ prompt: "x", size: "1024x1024", quality: "low" });
  assert.equal(out.contentType, "image/png");
  assert.equal(body.model, "gpt-image-1");
  const bad = openAiImages({ apiKey: "k" }, async () => new Response("kaputt", { status: 500 }));
  await assert.rejects(bad.generate({ prompt: "x", size: "1024x1024" }), /Bilderzeugung fehlgeschlagen/);
});

test("betrieb: Status nur für Admins; Mitteilungsbilder als Erweiterungspunkt", async () => {
  const { call, anna, tokens, mediaDir, app } = await mediaSetup(null);
  const ben = await tokens.ben();
  assert.equal((await call("GET", "/v1/media/status", { token: ben })).status, 403);
  const st = await call("GET", "/v1/media/status", { token: anna });
  assert.equal(st.body.enabled, false);
  assert.deepEqual(Object.keys(st.body.kinds).sort(), ["event_image", "trip_cover"]);
  const regen = await call("POST", "/v1/media/trip_cover/1/regenerate", { token: anna });
  assert.equal(regen.status, 409);
  assert.equal(regen.body.error.code, "images_disabled");

  // Mitteilungsbild: fehlt → 404; vorhanden → PNG (auch für Nicht-Admins)
  const missing = await call("GET", "/v1/media/notification/notif-today", { token: ben });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "image_not_available");
  fs.mkdirSync(path.join(mediaDir, "notification"));
  fs.writeFileSync(path.join(mediaDir, "notification", "notif-today.png"), PNG);
  const ok = await app.request("/v1/media/notification/notif-today", { headers: { authorization: `Bearer ${ben}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal((await call("GET", "/v1/media/notification/..%2Fsecret", { token: anna })).status, 404);
  assert.equal((await call("GET", "/v1/media/notification/notif-today")).status, 401);
});

test("bilder: eigenes Bild hochladen, entfernen, mit Zusatzhinweis neu erzeugen (nur Admin)", async () => {
  const { gen, prompts } = fakeImages();
  const { call, anna, tokens, db, mediaDir } = await mediaSetup(gen);
  const ben = await tokens.ben();
  const t = await call("POST", "/v1/trips", { token: anna, json: { title: "Meer", destination: "Barcelona" } });
  const tripId = t.body.trip.id as number;
  const ev = await call("POST", `/v1/trips/${tripId}/events`, {
    token: anna,
    json: { type: "Flug", title: "Zürich → Barcelona", startDate: "2026-10-23", startTime: "08:30", details: { airline: "Beispiel Air" } },
  });
  const eventId = ev.body.eventId as number;

  const upload = (token: string, bytes: Uint8Array | string, name = "x.png") => {
    const form = new FormData();
    form.append("file", new File([bytes as BlobPart], name));
    return call("PUT", `/v1/media/event_image/${eventId}`, { token, form });
  };

  // Nur Admins; Nicht-Bilder werden abgewiesen
  assert.equal((await upload(ben, PNG)).status, 403);
  assert.equal((await upload(anna, "kein bild")).status, 415);
  const ok = await upload(anna, PNG2);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.media.source, "uploaded");
  assert.equal(getMedia(db, "event_image", eventId)!.source, "uploaded");
  const d1 = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  const e1 = d1.body.events.find((e: any) => e.id === eventId);
  assert.equal(e1.imageSource, "uploaded");
  assert.ok(e1.imageUrl);

  // Neu erzeugen: Zusatzhinweis hängt am erzeugten Prompt; der Prompt der alten App (Logos erlaubt)
  const regen = await call("POST", `/v1/media/event_image/${eventId}/regenerate`, { token: anna, json: { extra: "bei Sonnenuntergang" } });
  assert.equal(regen.status, 200);
  assert.equal(regen.body.media.source, "generated");
  const used = prompts.at(-1)!;
  assert.match(used, /Square travel illustration/);
  assert.match(used, /bei Sonnenuntergang/);
  assert.match(used, /Logos and brand marks/);
  assert.doesNotMatch(used, /No logos/);
  assert.equal((await call("POST", `/v1/media/event_image/${eventId}/regenerate`, { token: ben })).status, 403);

  // Entfernen: Datei weg, keine automatische Neuerzeugung
  const file = mediaFilePath(mediaDir, "event_image", getMedia(db, "event_image", eventId)!.file_name!)!;
  const del = await call("DELETE", `/v1/media/event_image/${eventId}`, { token: anna });
  assert.equal(del.status, 200);
  assert.equal(del.body.media.url, null);
  purgeTrash(db, mediaDir);
  assert.equal(fs.existsSync(file), false);
  const svc = new MediaService({ db, mediaDir, images: gen, now: () => new Date() });
  const before = prompts.length;
  await svc.runBatch({ limit: 10 });
  assert.equal(getMedia(db, "event_image", eventId)!.file_name, null, "entferntes Bild wird nicht automatisch ersetzt");
  void before;
});

test("prompt: Vorlage der alten App mit Beleg, Logos erlaubt", () => {
  const p = buildEventImagePrompt({
    type: "Hotel", title: "Hotel Brickell", startDate: "2026-11-19", endDate: null, startTime: null, endTime: null,
    location: "Miami", address: null, provider: "Beispiel Hotels", bookingReference: null, phone: null, website: null,
    notes: null, details: {}, documentNotes: "Bestätigung für 5 Nächte",
  });
  assert.match(p, /Receipt context: Bestätigung für 5 Nächte\./);
  assert.match(p, /Scene idea: welcoming hotel/);
  assert.match(p, /Logos and brand marks/);
});
