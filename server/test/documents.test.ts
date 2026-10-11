import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackground } from "../src/lib/background";
import { runPendingAnalyses, type DocumentAnalyzer } from "../src/ingest/analyzer";
import { sniffUpload } from "../src/ingest/sniff";
import { pdfForm, setup, tinyPdf } from "./helpers";

async function docSetup(deps: Parameters<typeof setup>[0] extends infer O ? (O extends { deps?: infer D } ? D : never) : never = {}) {
  const background = createBackground();
  const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-docs-"));
  const s = await setup({ deps: { background, documentsDir, ...deps } });
  const anna = await s.tokens.anna();
  const trip = await s.call("POST", "/v1/trips", { token: anna, json: { title: "Dokumente" } });
  return { ...s, anna, background, documentsDir, tripId: trip.body.trip.id as number };
}

test("sniff: Typ am Dateikopf, nicht am Namen", () => {
  const b = (...n: number[]) => new Uint8Array([...n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffUpload(tinyPdf())!.ext, "pdf");
  assert.equal(sniffUpload(b(0xff, 0xd8, 0xff, 0xe0))!.ext, "jpg");
  assert.equal(sniffUpload(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))!.ext, "png");
  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
  assert.equal(sniffUpload(heic)!.ext, "heic");
  const ics = new TextEncoder().encode("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n");
  assert.equal(sniffUpload(ics)!.ext, "ics");
  const zipPass = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....pass.json....manifest.json")]);
  assert.equal(sniffUpload(zipPass)!.ext, "pkpass");
  const zipOther = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....irgendwas.txt....")]);
  assert.equal(sniffUpload(zipOther), null);
  assert.equal(sniffUpload(new TextEncoder().encode("MZ\u0090 ausführbar, kein Dokument")), null);
});

test("upload: PDF an die Reise, 202, Original unter <sha[0:2]>/<sha>.pdf, Analyse wird übersprungen", async () => {
  const { call, anna, tripId, background, documentsDir, db } = await docSetup();
  const r = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: pdfForm("Hotel Bestätigung.pdf") });
  assert.equal(r.status, 202);
  const d = r.body.document;
  assert.equal(r.body.duplicate, false);
  assert.equal(d.fileName, "Hotel Bestätigung.pdf");
  assert.equal(d.title, "Hotel Bestätigung");
  assert.equal(d.contentType, "application/pdf");
  assert.equal(d.pages, 1);
  assert.match(d.sha256, /^[0-9a-f]{64}$/);
  assert.equal(d.analysisStatus, "pending");
  assert.deepEqual(d.tripIds, [tripId]);
  assert.deepEqual(d.eventIds, []);
  assert.equal(d.fileUrl, `/v1/documents/${d.id}/file`);
  assert.ok(d.createdAt);
  assert.ok(fs.existsSync(path.join(documentsDir, d.sha256.slice(0, 2), `${d.sha256}.pdf`)));

  // Hintergrund: Standard-Analyse tut nichts und markiert «übersprungen»
  await background.idle();
  const after = await call("GET", `/v1/documents/${d.id}`, { token: anna });
  assert.equal(after.body.document.analysisStatus, "skipped");
  assert.equal(after.body.document.analysisError, "Analyse nicht konfiguriert");
  assert.equal((db.prepare("SELECT source FROM documents").get() as any).source, "upload");
});

test("upload: gleiche Datei = bestehendes Dokument, wird an Reise und Ereignis verknüpft", async () => {
  const { call, anna, tripId, background, db } = await docSetup();
  const t2 = (await call("POST", "/v1/trips", { token: anna, json: { title: "Zweite Reise" } })).body.trip.id;
  const ev = await call("POST", `/v1/trips/${t2}/events`, { token: anna, json: { title: "Flug", type: "Flug" } });

  const first = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: pdfForm("a.pdf") });
  await background.idle();
  const again = await call("POST", `/v1/trips/${t2}/documents`, {
    token: anna,
    form: pdfForm("anderer-name.pdf", "", { eventId: String(ev.body.eventId) }),
  });
  assert.equal(again.status, 202);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.document.id, first.body.document.id);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM documents").get() as any).n, 1);
  assert.deepEqual(again.body.document.tripIds, [tripId, t2].sort((a, b) => a - b));
  assert.deepEqual(again.body.document.eventIds, [ev.body.eventId]);
  assert.equal(again.body.document.analysisStatus, "skipped", "Dublette wird nicht erneut analysiert");

  // Die Ereignis-Sicht kennt das Dokument
  const detail = await call("GET", `/v1/trips/${t2}`, { token: anna });
  assert.deepEqual(detail.body.events[0].documentIds, [first.body.document.id]);
  assert.equal(detail.body.events[0].documents[0].title, "a");

  // Dokumente der Reise
  const list = await call("GET", `/v1/trips/${t2}/documents`, { token: anna });
  assert.equal(list.body.documents.length, 1);
});

test("upload: Einwurf ohne Reise, Quelle «share», erscheint in der Inbox", async () => {
  const { call, anna, background } = await docSetup();
  const r = await call("POST", "/v1/documents", { token: anna, form: pdfForm("Teilen.pdf", "x") });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body.document.tripIds, []);
  assert.equal(r.body.document.source, "share");
  await background.idle();
  const inbox = await call("GET", "/v1/inbox", { token: anna });
  assert.deepEqual(inbox.body.documents.map((d: any) => d.id), [r.body.document.id]);
  assert.deepEqual(inbox.body.review, []);
});

test("upload: Typ, Grösse, Felder, Berechtigung", async () => {
  const { call, anna, tripId, tokens } = await docSetup();
  const form = (bytes: Uint8Array, name: string) => {
    const f = new FormData();
    f.set("file", new File([bytes as BlobPart], name));
    return f;
  };
  // falscher Typ trotz «.pdf»
  const exe = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: form(new TextEncoder().encode("MZ\u0090 programm"), "x.pdf") });
  assert.equal(exe.status, 415);
  assert.equal(exe.body.error.code, "unsupported_media_type");
  // leer
  assert.equal((await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: form(new Uint8Array(0), "leer.pdf") })).status, 422);
  // zu gross (25 MB + 1)
  const big = new Uint8Array(25 * 1024 * 1024 + 1);
  big.set(tinyPdf());
  const tooBig = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: form(big, "gross.pdf") });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.error.code, "payload_too_large");
  // genau an der Grenze geht
  const edge = new Uint8Array(25 * 1024 * 1024);
  edge.set(tinyPdf());
  assert.equal((await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: form(edge, "grenze.pdf") })).status, 202);
  // kein Feld «file»
  const noFile = new FormData();
  noFile.set("name", "x");
  assert.equal((await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: noFile })).body.error.code, "file_required");
  // Ereignis einer anderen Reise
  const other = (await call("POST", "/v1/trips", { token: anna, json: { title: "Andere" } })).body.trip.id;
  const ev = await call("POST", `/v1/trips/${other}/events`, { token: anna, json: { title: "x" } });
  const wrong = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: pdfForm("a.pdf", "y", { eventId: String(ev.body.eventId) }) });
  assert.equal(wrong.status, 404);
  // Nicht-Admin
  const ben = await tokens.ben();
  assert.equal((await call("POST", `/v1/trips/${tripId}/documents`, { token: ben, form: pdfForm("b.pdf", "z") })).status, 403);
  assert.equal((await call("POST", `/v1/trips/${tripId}/documents`, { form: pdfForm("b.pdf", "z") })).status, 401);
});

test("datei: inline, Range-Anfragen, ETag; Löschen entfernt Datei und Verknüpfungen, Ereignisse bleiben", async () => {
  const { call, anna, tripId, documentsDir, app } = await docSetup();
  const bytes = tinyPdf("daten".repeat(40));
  const f = new FormData();
  f.set("file", new File([bytes as BlobPart], "Ticket ä.pdf"));
  const up = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: f });
  const id = up.body.document.id as number;
  const sha = up.body.document.sha256 as string;

  const get = (headers: Record<string, string> = {}) =>
    app.request(`/v1/documents/${id}/file`, { headers: { authorization: `Bearer ${anna}`, ...headers } });
  const full = await get();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "application/pdf");
  assert.match(full.headers.get("content-disposition") ?? "", /^inline;/);
  assert.match(full.headers.get("content-disposition") ?? "", /filename\*=UTF-8''Ticket%20%C3%A4\.pdf/);
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes);

  const part = await get({ range: "bytes=0-9" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-9/${bytes.length}`);
  assert.equal(part.headers.get("content-length"), "10");
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes.slice(0, 10));

  const tail = await get({ range: "bytes=-5" });
  assert.equal(tail.status, 206);
  assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), bytes.slice(bytes.length - 5));
  const open = await get({ range: `bytes=${bytes.length - 3}-` });
  assert.deepEqual(new Uint8Array(await open.arrayBuffer()), bytes.slice(bytes.length - 3));
  assert.equal((await get({ range: `bytes=${bytes.length + 10}-` })).status, 416);
  assert.equal((await get({ range: "bytes=abc" })).status, 416);
  assert.equal((await get({ "if-none-match": full.headers.get("etag")! })).status, 304);

  // Vorschau: PDF ohne poppler → 404 (Client rendert selbst); wenn poppler da ist, ein JPEG
  const thumb = await app.request(`/v1/documents/${id}/thumbnail`, { headers: { authorization: `Bearer ${anna}` } });
  assert.ok(thumb.status === 404 || thumb.headers.get("content-type") === "image/jpeg");

  // Ereignis mit Dokument, dann Dokument löschen
  const ev = await call("POST", `/v1/trips/${tripId}/events`, { token: anna, json: { title: "Hotel" } });
  await call("POST", `/v1/trips/${tripId}/events/${ev.body.eventId}/documents`, { token: anna, json: { documentId: id } });
  const del = await call("DELETE", `/v1/documents/${id}`, { token: anna });
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(path.join(documentsDir, sha.slice(0, 2), `${sha}.pdf`)), false);
  assert.equal((await call("GET", `/v1/documents/${id}`, { token: anna })).status, 404);
  const detail = await call("GET", `/v1/trips/${tripId}`, { token: anna });
  assert.equal(detail.body.events.length, 1, "Ereignisse bleiben");
  assert.deepEqual(detail.body.events[0].documentIds, []);
});

test("bilder: JPEG/PNG dienen sich selbst als Vorschau, HEIC nicht", async () => {
  const { call, anna, tripId, app } = await docSetup();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest-des-bildes")]);
  const f = new FormData();
  f.set("file", new File([png as BlobPart], "foto.png"));
  const up = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: f });
  assert.equal(up.status, 202);
  assert.equal(up.body.document.contentType, "image/png");
  assert.equal(up.body.document.pages, 1);
  assert.equal(up.body.document.thumbnailUrl, `/v1/documents/${up.body.document.id}/thumbnail`);
  const t = await app.request(up.body.document.thumbnailUrl, { headers: { authorization: `Bearer ${anna}` } });
  assert.equal(t.status, 200);
  assert.equal(t.headers.get("content-type"), "image/png");

  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 1, 2, 3]);
  const h = new FormData();
  h.set("file", new File([heic as BlobPart], "IMG_1.HEIC"));
  const hu = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: h });
  assert.equal(hu.body.document.contentType, "image/heic");
  assert.equal(hu.body.document.thumbnailUrl, null);
  assert.equal((await call("GET", hu.body.document.fileUrl.replace(/\/file$/, "/thumbnail"), { token: anna })).status, 404);
});

test("analyse: Haken mit eigener Implementierung, Fehler mit Wiederholung, erneutes Starten", async () => {
  const calls: number[] = [];
  let fail = true;
  const analyzer: DocumentAnalyzer = {
    async analyze(id) {
      calls.push(id);
      if (fail) throw new Error("KI nicht erreichbar");
      // echte Implementierungen setzen den Status selbst
      (globalThis as any).__db.prepare("UPDATE documents SET analysis_status = 'done', summary = 'Hotel in Miami' WHERE id = ?").run(id);
    },
  };
  const { call, anna, tripId, background, db } = await docSetup({ analyzer });
  (globalThis as any).__db = db;
  const up = await call("POST", `/v1/trips/${tripId}/documents`, { token: anna, form: pdfForm("x.pdf") });
  await background.idle();
  assert.deepEqual(calls, [up.body.document.id]);
  let doc = (await call("GET", `/v1/documents/${up.body.document.id}`, { token: anna })).body.document;
  assert.equal(doc.analysisStatus, "failed");
  assert.equal(doc.analysisError, "KI nicht erreichbar");
  const row = db.prepare("SELECT analysis_attempts, analysis_next_retry_at FROM documents").get() as any;
  assert.equal(row.analysis_attempts, 1);
  assert.ok(row.analysis_next_retry_at);

  // Hintergrundlauf vor Fälligkeit tut nichts, danach wiederholt er
  assert.equal(await runPendingAnalyses(db, analyzer, { now: () => new Date("2026-10-10T08:00:00Z") }), 0);
  fail = false;
  const later = () => new Date(Date.now() + 10 * 60_000);
  assert.equal(await runPendingAnalyses(db, analyzer, { now: later }), 1);
  doc = (await call("GET", `/v1/documents/${up.body.document.id}`, { token: anna })).body.document;
  assert.equal(doc.analysisStatus, "done");
  assert.equal(doc.summary, "Hotel in Miami");

  // Manuell neu starten
  const again = await call("POST", `/v1/documents/${up.body.document.id}/analyze`, { token: anna });
  assert.equal(again.status, 202);
  await background.idle();
  assert.equal(calls.length, 3);
  delete (globalThis as any).__db;
});
