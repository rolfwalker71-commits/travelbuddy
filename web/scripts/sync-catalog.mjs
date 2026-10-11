// Kopiert den Ereignis-Katalog aus shared/ in den Web-Client (gebündelte Rückfallkopie).
// `node scripts/sync-catalog.mjs` aktualisiert, `--check` meldet nur Abweichungen (Exit-Code 1).
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../shared/event-types.json");
const to = resolve(here, "../src/data/event-types.json");
if (!existsSync(from)) {
  console.log("shared/event-types.json fehlt (Web-Paket ausserhalb des Repos?), gebündelte Kopie bleibt.");
  process.exit(0);
}
const same = existsSync(to) && readFileSync(from, "utf8") === readFileSync(to, "utf8");
if (process.argv.includes("--check")) {
  console.log(same ? "Katalog aktuell." : "Katalog weicht von shared/event-types.json ab.");
  process.exit(same ? 0 : 1);
}
if (!same) copyFileSync(from, to);
console.log(same ? "Katalog aktuell." : "Katalog aktualisiert.");
