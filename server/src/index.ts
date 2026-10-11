import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { migrate, openDb } from "./db/client";
import { loadConfig } from "./config";
import { AutoApnsTransport } from "./push/apns";
import { Notifier } from "./push/notifier";
import { NotificationScheduler } from "./notifications/scheduler";
import { findWebDir } from "./web/static";
import { imageGeneratorFromEnv, MediaService } from "./media/generate";
import { mapkitConfigFromEnv } from "./maps/mapkit";
import { geocoderFromEnv } from "./geo/geocode";
import { runPendingAnalyses, type DocumentAnalyzer } from "./ingest/analyzer";
import { GeocodeBackfill, backfillModeFromEnv } from "./maps/backfill";
import { IngestAnalyzer } from "./ingest/pipeline";
import { OpenAiLlm } from "./ingest/openai";
import { versionInfo } from "./lib/version";
import { getCatalog } from "./catalog/catalog";
import { airportCount } from "./meta/airports";
import { createBackground } from "./lib/background";
import { bootstrapImport } from "./import/bootstrap";

const env = process.env;
const cfg = loadConfig(env);
const version = versionInfo(env);

const db = openDb(cfg.dbPath);
const ran = migrate(db);
if (ran.length) console.log(`Migrationen angewendet: ${ran.join(", ")}`);

// Katalog und Flughafentabelle beim Start laden: Ein fehlender Katalog soll hier auffallen, nicht erst im Betrieb.
const catalog = getCatalog();
const airports = airportCount();

// Leere Datenbank und Quelle vorhanden (TRAVELBUDDY_BOOTSTRAP_IMPORT, im Dev-Modus ../import-in/homebuddy.sqlite):
// einmal aus HomeBuddy importieren. Ein Fehlschlag legt den Server nicht lahm, er steht dann im Log.
await bootstrapImport(
  { db, documentsDir: cfg.documentsDir, mediaDir: cfg.mediaDir },
  { env, dataDir: cfg.dataDir, log: console.log }
);

// KI-Bilder (Reise- und Ereignisbilder): aktiv, sobald ein OpenAI-Schlüssel da ist; TRAVELBUDDY_AI_IMAGES=0 schaltet ab.
const images = imageGeneratorFromEnv(env);
const mediaDir = cfg.mediaDir;
const background = createBackground();
const media = new MediaService({ db, mediaDir, images, perRun: cfg.imagesPerRun, background });

// Push: Den Schlüssel `AuthKey_<KEYID>.p8` einfach in den Ordner `apns` neben der Datenbank legen
// (im Container: /data/apns). Er wird zur Laufzeit gefunden, ein Neustart ist nicht nötig.
try {
  fs.mkdirSync(cfg.apnsDir, { recursive: true });
} catch (e) {
  console.warn(`APNs-Ordner ${cfg.apnsDir} konnte nicht angelegt werden: ${e instanceof Error ? e.message : e}`);
}
const push = new AutoApnsTransport({ dir: cfg.apnsDir, env });
const notifier = new Notifier(db, push);
const scheduler = new NotificationScheduler({ db, notifier, transport: push, log: console.log });

const mapkit = mapkitConfigFromEnv(env);
const geocoder = geocoderFromEnv(env, { db, mapkit, version: version.version });
const webDir = findWebDir(cfg.webDirCandidates);
// Dokumentanalyse: KI (OpenAI) extrahiert, Code verifiziert. Ohne OPENAI_API_KEY laufen nur Barcode, ICS und Pass;
// Dokumente ohne Ergebnis werden «übersprungen» und mit Schlüssel im Wartungslauf nachgeholt.
const analyzer = new IngestAnalyzer({
  db,
  documentsDir: cfg.documentsDir,
  llm: cfg.ai.apiKey ? new OpenAiLlm({ apiKey: cfg.ai.apiKey, baseUrl: cfg.ai.baseUrl }) : null,
  models: { text: cfg.ai.modelText, vision: cfg.ai.modelVision },
  geocoder,
  notifier,
  log: console.log,
});

// Geokodierungs-Nachtrag: holt fehlende Koordinaten langsam im Hintergrund nach (TRAVELBUDDY_GEOCODE_BACKFILL).
const backfill = new GeocodeBackfill({ db, geocoder, mode: backfillModeFromEnv(env), log: console.log });
// Nach jeder Dokumentanalyse (Upload, Wiederholung, erneutes Starten) auch den Nachtrag anstossen.
const analyzeThenBackfill: DocumentAnalyzer = {
  async analyze(documentId) {
    try {
      await analyzer.analyze(documentId);
    } finally {
      backfill.trigger();
    }
  },
};

const app = createApp({
  db,
  push,
  notifier,
  scheduler,
  webDir,
  mapkit,
  geocoder,
  analyzer: analyzeThenBackfill,
  backfill,
  mediaDir,
  documentsDir: cfg.documentsDir,
  images,
  imagesPerRun: cfg.imagesPerRun,
  background,
  log: cfg.accessLog ? console.log : undefined,
});

function pushLabel(): string {
  const st = push.status?.();
  if (st?.configured) return `APNs (Key ${st.keyId})`;
  return `wartet auf ${path.join(cfg.apnsDir, "AuthKey_<KEYID>.p8")}`;
}

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
  console.log(`TravelBuddy-Server ${version.version} (${version.build}) läuft auf http://${info.address}:${info.port}  (DB: ${cfg.dbPath})`);
  console.log(
    `Katalog: ${catalog.typeIds.length} Typen · Flughäfen: ${airports} · KI: ${cfg.ai.apiKey ? `${cfg.ai.modelText} / ${cfg.ai.modelVision}` : "nicht konfiguriert"} · ` +
      `KI-Bilder: ${images ? `${images.model}, ${cfg.imagesPerRun} je Lauf` : "aus"} · Push: ${pushLabel()} · ` +
      `Karten: ${mapkit ? `Apple Karten (Key ${mapkit.keyId})` : "aus"} · Geokodierung: ${geocoder ? geocoder.name : "aus"}${backfill.enabled ? " (Nachtrag an)" : ""} · Web: ${webDir ?? "aus"}`
  );
});

// Geokodierungs-Nachtrag beim Start (mit etwas Abstand).
setTimeout(() => backfill.trigger(), 10_000).unref();

// Hintergrundlauf: Dokumentanalyse (Haken), fehlende Bilder. Läuft nie parallel zu sich selbst.
if (cfg.maintenanceMinutes > 0) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPendingAnalyses(db, analyzeThenBackfill);
      await media.runBatch();
      backfill.trigger(); // fängt auch Daten ab, die ein Import-Skript geschrieben hat
    } catch (e) {
      console.error("[maintenance]", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, cfg.maintenanceMinutes * 60_000).unref();
}

// Mitteilungen und Live Activities: minütlicher Lauf (TRAVELBUDDY_NOTIFY_SECONDS, 0 = aus). Ohne APNs-Schlüssel ein
// Trockenlauf: nichts wird gesendet oder als gesendet markiert, fällige Mitteilungen werden später nachgeholt.
const notifySeconds = Number(env.TRAVELBUDDY_NOTIFY_SECONDS ?? 60);
const stopNotify = notifySeconds > 0 ? scheduler.start(background, notifySeconds * 1000) : () => {};

// Sauberes Herunterfahren (docker stop sendet SIGTERM): Anfragen beenden, DB-Datei schliessen.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  stopNotify();
  console.log(`${signal} empfangen, fahre herunter …`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.message : reason);
});
