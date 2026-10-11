/**
 * Konfiguration aus der Umgebung. Alle Variablen sind optional; `.env` wird nie vom Server selbst gelesen
 * (nur über `--env-file`, siehe `npm run dev:live`).
 */
import path from "node:path";

export type ServerConfig = {
  dbPath: string;
  port: number;
  host: string;
  /** Datenordner: Medien, Dokumente, APNs-Schlüssel (Standard: Ordner der Datenbank). */
  dataDir: string;
  mediaDir: string;
  documentsDir: string;
  webDirCandidates: Array<string | undefined>;
  accessLog: boolean;
  /** Intervall des Hintergrunds (Dokumentanalyse, Bilder), Minuten; 0 = aus. */
  maintenanceMinutes: number;
  imagesPerRun: number;
  apnsDir: string;
  ai: {
    apiKey: string | null;
    baseUrl: string | null;
    /** Textmodell (Analyse); nur gelesen, die Analyse selbst ist ein späteres Paket. */
    modelText: string;
    modelVision: string;
  };
};

const truthyOff = (v: string | undefined) => ["0", "false", "nein", "off", "aus"].includes((v ?? "").trim().toLowerCase());

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const dbPath = env.TRAVELBUDDY_DB_PATH || "./data/travelbuddy.sqlite";
  const dataDir = env.TRAVELBUDDY_DATA_DIR || path.dirname(path.resolve(dbPath));
  return {
    dbPath,
    port: Number(env.PORT ?? 7780),
    host: env.HOST ?? "127.0.0.1",
    dataDir,
    mediaDir: env.TRAVELBUDDY_MEDIA_DIR || path.join(dataDir, "media"),
    documentsDir: env.TRAVELBUDDY_DOCUMENTS_DIR || path.join(dataDir, "documents"),
    webDirCandidates: [env.TRAVELBUDDY_WEB_DIR, "./web", "../web/dist"],
    accessLog: !truthyOff(env.TRAVELBUDDY_ACCESS_LOG),
    maintenanceMinutes: Number(env.TRAVELBUDDY_MAINTENANCE_MINUTES ?? 5),
    imagesPerRun: Math.max(1, Number(env.TRAVELBUDDY_AI_IMAGES_PER_RUN) || 5),
    apnsDir: env.TRAVELBUDDY_APNS_DIR || path.join(dataDir, "apns"),
    ai: {
      apiKey: env.OPENAI_API_KEY?.trim() || null,
      baseUrl: env.OPENAI_BASE_URL?.trim() || null,
      modelText: env.TRAVELBUDDY_AI_MODEL_TEXT?.trim() || "gpt-4o-mini",
      modelVision: env.TRAVELBUDDY_AI_MODEL_VISION?.trim() || "gpt-4o",
    },
  };
}
