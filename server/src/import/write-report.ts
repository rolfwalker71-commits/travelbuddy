import fs from "node:fs";
import path from "node:path";
import type { ImportOutcome } from "./homebuddy";

/** Schreibt `report.json` und `report.txt` (nur Zahlen, Titel, Namen) in den Ordner. Gibt die Pfade zurück. */
export function writeReportFiles(outDir: string, outcome: ImportOutcome): { json: string; txt: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const json = path.join(outDir, "report.json");
  const txt = path.join(outDir, "report.txt");
  fs.writeFileSync(json, JSON.stringify(outcome.report, null, 2) + "\n");
  fs.writeFileSync(txt, outcome.reportText);
  return { json, txt };
}
