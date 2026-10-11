/**
 * Eingaben des Imports aus einem Quellpfad ableiten: Dokumente, Zusammenfassung und Medien liegen standardmässig
 * neben der SQLite-Datei (`documents/`, `summary.json`, `media/`); der Bericht geht nach `import-out/`.
 */
import fs from "node:fs";
import path from "node:path";
import type { ImportOptions } from "./homebuddy";

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export type InputFlags = {
  documents?: string | null;
  media?: string | null;
  summary?: string | null;
  includeUnlinkedTravelDocs?: boolean;
  dryRun?: boolean;
};

export function resolveImportOptions(sourceFile: string, flags: InputFlags = {}): ImportOptions {
  const abs = path.resolve(sourceFile);
  const dir = path.dirname(abs);
  const documents = flags.documents ? path.resolve(flags.documents) : isDir(path.join(dir, "documents")) ? path.join(dir, "documents") : null;
  const media = flags.media ? path.resolve(flags.media) : isDir(path.join(dir, "media")) ? path.join(dir, "media") : null;
  const summary = flags.summary ? path.resolve(flags.summary) : isFile(path.join(dir, "summary.json")) ? path.join(dir, "summary.json") : null;
  return {
    sourceFile: abs,
    documentsFolder: documents,
    mediaSourceFolder: media,
    summaryFile: summary,
    includeUnlinkedTravelDocs: Boolean(flags.includeUnlinkedTravelDocs),
    dryRun: Boolean(flags.dryRun),
  };
}

/** Ausgabeordner des Berichts: `import-out/` neben `import-in/`, sonst `<Datenordner>/import-out`. */
export function defaultOutDir(sourceFile: string, dataDir: string): string {
  const dir = path.dirname(path.resolve(sourceFile));
  return path.basename(dir) === "import-in" ? path.join(path.dirname(dir), "import-out") : path.join(path.resolve(dataDir), "import-out");
}
