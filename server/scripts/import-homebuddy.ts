/**
 * Import aus HomeBuddy (wiederholbar, mit Trockenlauf und Abnahme):
 *
 *   npm run import:homebuddy -- <homebuddy.sqlite> [--documents <ordner>] [--dry-run]
 *                               [--include-unlinked-travel-docs] [--media <ordner>] [--summary <summary.json>]
 *                               [--out <ordner>]
 *
 * Ziel ist die Datenbank aus `TRAVELBUDDY_DB_PATH` (Standard `./data/travelbuddy.sqlite`), Dokumente und Bilder
 * landen im Datenordner daneben. Die Quelle wird nie verändert. Exit-Code: 0 = in Ordnung, 2 = Abweichung bei der
 * Abnahme (alles zurückgerollt), 1 = Fehler. Der Bericht geht nach `import-out/report.json` und `report.txt`.
 */
import path from "node:path";
import { loadConfig } from "../src/config";
import { migrate, openDb } from "../src/db/client";
import { importHomeBuddy } from "../src/import/homebuddy";
import { defaultOutDir, resolveImportOptions } from "../src/import/inputs";
import { writeReportFiles } from "../src/import/write-report";

const USAGE =
  "Aufruf: npm run import:homebuddy -- <homebuddy.sqlite> [--documents <ordner>] [--dry-run] " +
  "[--include-unlinked-travel-docs] [--media <ordner>] [--summary <datei>] [--out <ordner>]";

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const withValue = new Set(["documents", "media", "summary", "out"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
    if (withValue.has(name)) {
      const v = inline ?? argv[++i];
      if (!v) throw new Error(`--${name} braucht einen Wert`);
      flags[name] = v;
    } else if (["dry-run", "include-unlinked-travel-docs", "help"].includes(name)) flags[name] = true;
    else throw new Error(`Unbekannte Option --${name}`);
  }
  return { flags, positional };
}

async function main(): Promise<number> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length !== 1) {
    console.error(USAGE);
    return flags.help ? 0 : 1;
  }
  const sourceFile = positional[0]!;
  const cfg = loadConfig(process.env);
  const db = openDb(cfg.dbPath);
  migrate(db);
  const opts = resolveImportOptions(sourceFile, {
    documents: flags.documents as string | undefined,
    media: flags.media as string | undefined,
    summary: flags.summary as string | undefined,
    includeUnlinkedTravelDocs: Boolean(flags["include-unlinked-travel-docs"]),
    dryRun: Boolean(flags["dry-run"]),
  });
  const outcome = await importHomeBuddy({ db, documentsDir: cfg.documentsDir, mediaDir: cfg.mediaDir }, opts);
  const outDir = flags.out ? path.resolve(String(flags.out)) : defaultOutDir(sourceFile, cfg.dataDir);
  const files = writeReportFiles(outDir, outcome);
  console.log(outcome.reportText);
  console.log(`Bericht: ${files.txt}\n         ${files.json}`);
  db.close();
  return outcome.report.status === "ok" ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Import fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
);
