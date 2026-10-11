/**
 * Bootstrap beim Serverstart: Enthält die Datenbank **keine Reise** und gibt es eine Quelle, wird einmal aus
 * HomeBuddy importiert. So ist die Web-App beim ersten `npm run dev` sofort gefüllt.
 *
 * Quelle: `TRAVELBUDDY_BOOTSTRAP_IMPORT` = Pfad der `homebuddy.sqlite` (Dokumente aus `<Ordner>/documents`,
 * Zusammenfassung `<Ordner>/summary.json`, Bilder `<Ordner>/media`). Im Dev-Modus (`npm run dev`) gilt ohne
 * Angabe `../import-in/homebuddy.sqlite`, wenn die Datei da ist. `off` schaltet ab.
 *
 * Zugang: Die HomeBuddy-Benutzer kommen samt Passwort-Hash mit. Gibt es danach keinen aktiven Benutzer
 * (oder keinen Administrator), wird nichts erfunden: Das Log nennt `npm run user:create`.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { importHomeBuddy, type ImportTarget } from "./homebuddy";
import { defaultOutDir, resolveImportOptions } from "./inputs";
import { writeReportFiles } from "./write-report";

export type BootstrapResult =
  | { status: "skipped"; reason: string }
  | { status: "imported" }
  | { status: "mismatch" }
  | { status: "failed"; error: string };

const OFF = new Set(["off", "0", "false", "aus", "nein", "no"]);
export const DEV_DEFAULT_SOURCE = "../import-in/homebuddy.sqlite";

/** Quelle laut Umgebung (oder `null`). */
export function bootstrapSource(env: Record<string, string | undefined>, cwd = process.cwd()): { file: string | null; reason: string } {
  const raw = (env.TRAVELBUDDY_BOOTSTRAP_IMPORT ?? "").trim();
  if (OFF.has(raw.toLowerCase())) return { file: null, reason: "abgeschaltet (TRAVELBUDDY_BOOTSTRAP_IMPORT=off)" };
  if (raw) return { file: path.resolve(cwd, raw), reason: "" };
  const dev = env.npm_lifecycle_event === "dev" || env.npm_lifecycle_event === "dev:live" || env.TRAVELBUDDY_DEV === "1";
  if (!dev) return { file: null, reason: "keine Quelle angegeben" };
  const candidate = path.resolve(cwd, DEV_DEFAULT_SOURCE);
  return fs.existsSync(candidate) ? { file: candidate, reason: "" } : { file: null, reason: "keine Quelle im Dev-Modus gefunden" };
}

export async function bootstrapImport(
  target: ImportTarget,
  o: { env?: Record<string, string | undefined>; dataDir: string; log?: (line: string) => void; cwd?: string }
): Promise<BootstrapResult> {
  const log = o.log ?? (() => {});
  const env = o.env ?? process.env;
  const { db } = target;
  const src = bootstrapSource(env, o.cwd);
  if (!src.file) return { status: "skipped", reason: src.reason };
  const trips = (db.prepare("SELECT COUNT(*) AS n FROM trips").get() as { n: number }).n;
  if (trips > 0) return { status: "skipped", reason: "Datenbank enthält bereits Reisen" };
  if (!fs.existsSync(src.file)) {
    log(`Bootstrap-Import: Quelle ${src.file} nicht gefunden, übersprungen.`);
    return { status: "skipped", reason: "Quelle nicht gefunden" };
  }

  log(`Bootstrap-Import: leere Datenbank, importiere aus ${src.file} …`);
  try {
    const opts = resolveImportOptions(src.file);
    const outcome = await importHomeBuddy(target, opts);
    const r = outcome.report;
    let reportPath = "";
    try {
      reportPath = writeReportFiles(defaultOutDir(src.file, o.dataDir), outcome).txt;
    } catch (e) {
      log(`Bootstrap-Import: Bericht konnte nicht geschrieben werden: ${e instanceof Error ? e.message : e}`);
    }
    if (r.status !== "ok") {
      const bad = r.checks.filter((c) => !c.ok && !c.skipped).length;
      log(`Bootstrap-Import: ABWEICHUNG in ${bad} Prüfungen, nichts übernommen (zurückgerollt).${reportPath ? ` Bericht: ${reportPath}` : ""}`);
      return { status: "mismatch" };
    }
    const c = r.counts;
    log(
      `Bootstrap-Import: ${c.trips.created} Reisen, ${c.events.created} Ereignisse, ${c.participants.created} Teilnehmer, ` +
        `${c.expenses.created} Ausgaben, ${c.settlements.created} Rückzahlungen, ${c.comments.created} Kommentare, ` +
        `${r.documents.imported} Dokumente übernommen; Abnahme bestanden.${reportPath ? ` Bericht: ${reportPath}` : ""}`
    );
    const review = r.eventsNeedingReview.zones + r.eventsNeedingReview.unknownType;
    if (review > 0) log(`Bootstrap-Import: ${review} Ereignisse sind «zu prüfen» (Zeitzone oder Typ), siehe Bericht.`);
    accessHint(db, log);
    return { status: "imported" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Bootstrap-Import fehlgeschlagen: ${msg}`);
    return { status: "failed", error: msg };
  }
}

/** Hinweis zum Zugang, wenn nach dem Import niemand sich anmelden kann. Erfindet nichts. */
export function accessHint(db: Db, log: (line: string) => void): void {
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(is_admin), 0) AS a FROM users WHERE active = 1").get() as { n: number; a: number };
  const cmd = "TRAVELBUDDY_PASSWORD='<mindestens 12 Zeichen>' npm run user:create -- <benutzername> <anzeigename> --admin";
  if (r.n === 0) log(`Kein aktiver Benutzer vorhanden. Zugang anlegen mit: ${cmd}`);
  else if (r.a === 0) log(`Kein aktiver Administrator vorhanden. Zugang anlegen mit: ${cmd}`);
}
