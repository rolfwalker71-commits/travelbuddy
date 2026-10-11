/**
 * Eval der Dokumentanalyse (nicht in CI): `npm run eval:ingest [-- --docs <ordner> --db <sqlite> --out <datei> --limit N --all --no-ai]`
 *
 * Liest lokal `import-in/documents/*.pdf` und `import-in/homebuddy.sqlite` (echte Daten, git-ignoriert).
 *  1. Offline: Anteil der PDFs mit Textebene, Zeichen je Seite, Barcode-/Regel-Treffer.
 *  2. Mit `OPENAI_API_KEY` in der Umgebung: Vorschläge erzeugen und mit den vorhandenen Ereignissen vergleichen
 *     (Typ, Datum, Zeit, Referenz). Referenz «gold» = von Hand gepflegte, mit dem Dokument verknüpfte Ereignisse;
 *     «silver» = `travel_items` der früheren HomeBuddy-Analyse (Zwischenstand, nicht fehlerfrei).
 *  Bericht: `import-out/eval-ingest.json` (ohne Dokumentinhalt, nur Zahlen und Kennungen).
 *
 * Der Schlüssel kommt nur aus der Umgebung dieses Prozesses; Dateien mit Schlüsseln werden nicht gelesen.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate, openDb } from "../src/db/client";
import { getCatalog } from "../src/catalog/catalog";
import { OpenAiLlm } from "../src/ingest/openai";
import { IngestAnalyzer } from "../src/ingest/pipeline";
import { pdfPages, MIN_TEXT_CHARS_PER_PAGE, MIN_TEXT_CHARS_TOTAL } from "../src/ingest/source";
import { findBcbpInText } from "../src/ingest/bcbp";
import { flightNumberCandidates, referenceCandidates } from "../src/ingest/crosscheck";
import { guessTypeFromText } from "../src/ingest/typeguess";
import { compact } from "../src/ingest/values";
import type { ProposedEvent } from "../src/ingest/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const docsDir = path.resolve(arg("docs") ?? path.join(root, "import-in/documents"));
const dbFile = path.resolve(arg("db") ?? path.join(root, "import-in/homebuddy.sqlite"));
const outFile = path.resolve(arg("out") ?? path.join(root, "import-out/eval-ingest.json"));
const limit = Number(arg("limit") ?? 0);

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

type Manifest = {
  files: Array<{ paperlessId: number; homebuddyDocumentId: number; fileName: string; linkedEventIds: number[]; hasTravelItems?: boolean }>;
};
type Expected = { source: "gold" | "silver"; type: string; startDate: string | null; startTime: string | null; ref: string | null; flightNumber: string | null };

const TRAVEL_TYPE: Record<string, string> = {
  flight: "Flug", flug: "Flug", hotel: "Hotel", accommodation: "Hotel", unterkunft: "Unterkunft", train: "Zugreisen", zug: "Zugreisen", rail: "Zugreisen",
  car_rental: "Mietauto", rental_car: "Mietauto", mietwagen: "Mietauto", car: "Mietauto", cruise: "Kreuzfahrt", kreuzfahrt: "Kreuzfahrt",
  transfer: "Transfer", activity: "Ausflug", tour: "Ausflug", excursion: "Ausflug", restaurant: "Restaurant", event: "Veranstaltung",
  insurance: "Versicherung", visa: "Visum",
};

const MONTH_NAMES: string[][] = [
  ["januar", "january", "jan", "janvier", "gennaio", "enero"], ["februar", "february", "feb", "fevrier", "febbraio", "febrero"],
  ["maerz", "märz", "march", "mar", "mars", "marzo"], ["april", "apr", "avril", "aprile", "abril"], ["mai", "may", "maggio", "mayo"],
  ["juni", "june", "jun", "juin", "giugno", "junio"], ["juli", "july", "jul", "juillet", "luglio", "julio"],
  ["august", "aug", "aout", "agosto"], ["september", "sep", "sept", "septembre", "settembre", "septiembre"],
  ["oktober", "october", "oct", "okt", "octobre", "ottobre", "octubre"], ["november", "nov", "novembre", "noviembre"],
  ["dezember", "december", "dec", "dez", "decembre", "dicembre", "diciembre"],
];

/** Kommt das Datum (ISO) in gängigen Schreibweisen im Text vor? Obergrenze dessen, was eine Extraktion finden kann. */
function dateInText(text: string, iso: string): 0 | 1 | 2 {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 0;
  const y = m[1]!;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const t = text.toLowerCase();
  const plain = [`${p2(d)}.${p2(mo)}.${y}`, `${d}.${mo}.${y}`, `${y}-${p2(mo)}-${p2(d)}`, `${p2(mo)}/${p2(d)}/${y}`, `${p2(d)}/${p2(mo)}/${y}`, `${p2(d)}.${p2(mo)}.${y.slice(2)}`];
  if (plain.some((x) => t.includes(x))) return 2;
  const names = MONTH_NAMES[mo - 1] ?? [];
  for (const name of names) {
    const re = new RegExp(`\\b0?${d}\\.?\\s+${name}\\.?,?\\s+${y}\\b|\\b${name}\\.?\\s+0?${d}(?:st|nd|rd|th)?,?\\s+${y}\\b`);
    if (re.test(t.normalize("NFC"))) return 2;
  }
  // ohne Jahr («24.10.», «24. Oktober», «October 24»)
  if (new RegExp(`(?<!\\d)0?${d}\\.0?${mo}\\.(?!\\d)`).test(t)) return 1;
  for (const name of names) {
    if (new RegExp(`(?<!\\d)0?${d}\\.?\\s+${name}\\b|\\b${name}\\.?\\s+0?${d}(?!\\d)`).test(t)) return 1;
  }
  return 0;
}

function main() {
  return run().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

async function run() {
  if (!fs.existsSync(docsDir)) {
    console.error(`Ordner ${docsDir} fehlt (echte Dokumente liegen nur lokal unter import-in/documents).`);
    process.exit(1);
  }
  const catalog = getCatalog();
  const manifestPath = path.join(docsDir, "manifest.json");
  const manifest: Manifest | null = fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest) : null;
  const byFile = new Map((manifest?.files ?? []).map((f) => [f.fileName, f]));
  let files = fs.readdirSync(docsDir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (limit > 0) files = files.slice(0, limit);

  /* ───── Referenzdaten ───── */
  const expected = new Map<string, Expected[]>();
  if (fs.existsSync(dbFile)) {
    const hb = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const linked = hb
        .prepare(
          `SELECT d.id AS doc, e.event_type, e.start_date, e.start_time, e.booking_reference, e.details
             FROM trip_event_documents l JOIN trip_events e ON e.id = l.trip_event_id JOIN documents d ON d.id = l.document_id`
        )
        .all() as Array<{ doc: number; event_type: string; start_date: string | null; start_time: string | null; booking_reference: string | null; details: string }>;
      const byDoc = new Map<number, string>();
      for (const f of manifest?.files ?? []) byDoc.set(f.homebuddyDocumentId, f.fileName);
      for (const r of linked) {
        const file = byDoc.get(r.doc);
        if (!file) continue;
        let fn: string | null = null;
        try {
          fn = (JSON.parse(r.details) as { flightNumber?: string }).flightNumber ?? null;
        } catch {
          /* leer */
        }
        const list = expected.get(file) ?? [];
        list.push({ source: "gold", type: catalog.resolveTypeId(r.event_type) ?? r.event_type, startDate: r.start_date, startTime: r.start_time, ref: r.booking_reference, flightNumber: fn });
        expected.set(file, list);
      }
      const silver = hb.prepare("SELECT id, analysis_json FROM documents WHERE analysis_json LIKE '%\"travel_items\":[{%'").all() as Array<{ id: number; analysis_json: string }>;
      for (const r of silver) {
        const file = byDoc.get(r.id);
        if (!file) continue;
        let items: Array<Record<string, unknown>> = [];
        try {
          items = ((JSON.parse(r.analysis_json) as { travel_items?: Array<Record<string, unknown>> }).travel_items ?? []);
        } catch {
          /* leer */
        }
        const list = expected.get(file) ?? [];
        for (const t of items) {
          const raw = String(t.travel_type ?? "");
          const type = TRAVEL_TYPE[raw.toLowerCase()] ?? catalog.resolveTypeId(raw) ?? guessTypeFromText(raw);
          list.push({
            source: "silver", type, startDate: (t.start_date as string) ?? null, startTime: (t.start_time as string) ?? null,
            ref: (t.booking_reference as string) ?? null, flightNumber: (t.flight_number as string) ?? null,
          });
        }
        expected.set(file, list);
      }
    } finally {
      hb.close();
    }
  }

  /* ───── Offline-Messung ───── */
  const perDoc: Array<Record<string, unknown>> = [];
  const cover = {
    gold: { items: 0, date: 0, dateNoYear: 0, ref: 0, refItems: 0, fn: 0, fnItems: 0 },
    silver: { items: 0, date: 0, dateNoYear: 0, ref: 0, refItems: 0, fn: 0, fnItems: 0 },
  };
  const charsPerPage: number[] = [];
  let withText = 0;
  let needVision = 0;
  let withBcbp = 0;
  let withFlightNo = 0;
  let withRef = 0;
  let unreadable = 0;
  let pagesTotal = 0;
  for (const file of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(docsDir, file)));
    const r = await pdfPages(bytes);
    if (!r) {
      unreadable++;
      perDoc.push({ file, readable: false });
      continue;
    }
    const chars = r.pages.reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
    const avg = r.pageCount ? chars / r.pageCount : 0;
    const sparse = chars < MIN_TEXT_CHARS_TOTAL || avg < MIN_TEXT_CHARS_PER_PAGE;
    const text = r.pages.map((p) => p.text).join("\n");
    const bcbp = findBcbpInText(text).length;
    const fns = flightNumberCandidates(text).length;
    const refs = referenceCandidates(text).length;
    for (const e of expected.get(file) ?? []) {
      const c = cover[e.source];
      c.items++;
      const dt = e.startDate ? dateInText(text, e.startDate) : 0;
      if (dt === 2) c.date++;
      else if (dt === 1) c.dateNoYear++;
      if (e.ref) {
        c.refItems++;
        if (compact(text).includes(compact(e.ref))) c.ref++;
      }
      if (e.flightNumber) {
        c.fnItems++;
        if (compact(text).includes(compact(e.flightNumber))) c.fn++;
      }
    }
    pagesTotal += r.pageCount;
    if (!sparse) withText++;
    else needVision++;
    if (bcbp) withBcbp++;
    if (fns) withFlightNo++;
    if (refs) withRef++;
    charsPerPage.push(avg);
    perDoc.push({ file, readable: true, pages: r.pageCount, chars, charsPerPage: Math.round(avg), hasTextLayer: !sparse, bcbp, flightNumberCandidates: fns, referenceCandidates: refs, expectedEvents: expected.get(file)?.length ?? 0 });
  }
  const offline = {
    documents: files.length,
    unreadable,
    pages: pagesTotal,
    withTextLayer: withText,
    withTextLayerPercent: pct(withText, files.length),
    needVision,
    medianCharsPerPage: Math.round(median(charsPerPage)),
    meanCharsPerPage: Math.round(charsPerPage.reduce((a, b) => a + b, 0) / Math.max(1, charsPerPage.length)),
    withBcbp,
    withFlightNumberCandidate: withFlightNo,
    withReferenceCandidate: withRef,
    documentsWithGold: [...expected.entries()].filter(([, l]) => l.some((e) => e.source === "gold")).length,
    documentsWithSilver: [...expected.entries()].filter(([, l]) => l.some((e) => e.source === "silver")).length,
    /** Anteil der erwarteten Werte, die im Text der PDF überhaupt vorkommen (Obergrenze für die Extraktion). */
    expectedInText: {
      gold: { ...cover.gold, datePercent: pct(cover.gold.date, cover.gold.items), dateNoYearPercent: pct(cover.gold.dateNoYear, cover.gold.items), refPercent: pct(cover.gold.ref, cover.gold.refItems), flightNumberPercent: pct(cover.gold.fn, cover.gold.fnItems) },
      silver: { ...cover.silver, datePercent: pct(cover.silver.date, cover.silver.items), dateNoYearPercent: pct(cover.silver.dateNoYear, cover.silver.items), refPercent: pct(cover.silver.ref, cover.silver.refItems), flightNumberPercent: pct(cover.silver.fn, cover.silver.fnItems) },
    },
  };

  /* ───── Mit KI ───── */
  type Cmp = { expected: number; typeDate: number; time: number; timeBoth: number; ref: number; refBoth: number; extra: number };
  const blank = (): Cmp => ({ expected: 0, typeDate: 0, time: 0, timeBoth: 0, ref: 0, refBoth: 0, extra: 0 });
  let onlineResult: Record<string, unknown> | null = null;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key && !flag("no-ai")) {
    const db = openDb(":memory:");
    migrate(db);
    const analyzer = new IngestAnalyzer({
      db,
      documentsDir: docsDir,
      llm: new OpenAiLlm({ apiKey: key, baseUrl: process.env.OPENAI_BASE_URL?.trim() || null }),
      models: {
        text: process.env.TRAVELBUDDY_AI_MODEL_TEXT?.trim() || "gpt-4o-mini",
        vision: process.env.TRAVELBUDDY_AI_MODEL_VISION?.trim() || "gpt-4o",
      },
      log: () => undefined,
    });
    // Standard: nur Dokumente mit Referenz (gold oder silver); `--all` für alle.
    const targets = files.filter((f) => flag("all") || (expected.get(f)?.length ?? 0) > 0);
    const gold = blank();
    const silver = blank();
    const docResults: Array<Record<string, unknown>> = [];
    for (const file of targets) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(docsDir, file)));
      const meta = byFile.get(file);
      let proposals: ProposedEvent[] = [];
      let error: string | null = null;
      try {
        const r = await analyzer.proposeBytes({ bytes, contentType: "application/pdf", fileName: file, filePath: path.join(docsDir, file) });
        proposals = r.proposals;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const exp = expected.get(file) ?? [];
      const used = new Set<number>();
      for (const e of exp) {
        const bucket = e.source === "gold" ? gold : silver;
        bucket.expected++;
        const fam = (t: string) => (t === "Unterkunft" ? "Hotel" : t);
        const idx = proposals.findIndex((p, i) => !used.has(i) && fam(p.type) === fam(e.type) && (!e.startDate || p.common.startDate === e.startDate));
        if (idx < 0) continue;
        used.add(idx);
        const p = proposals[idx]!;
        bucket.typeDate++;
        if (e.startTime && p.common.startTime) {
          bucket.timeBoth++;
          if (p.common.startTime === e.startTime) bucket.time++;
        }
        const pref = (p.common.bookingReference as string | undefined) ?? (p.details.confirmationNumber as string | undefined);
        if (e.ref && pref) {
          bucket.refBoth++;
          if (compact(pref) === compact(e.ref)) bucket.ref++;
        }
      }
      const hasGold = exp.some((e) => e.source === "gold");
      (hasGold ? gold : silver).extra += proposals.filter((_, i) => !used.has(i)).length;
      docResults.push({ file, paperlessId: meta?.paperlessId ?? null, proposals: proposals.length, expected: exp.length, error });
    }
    const usage = db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cost_micro_usd),0) AS c FROM ai_usage").get() as {
      calls: number; i: number; o: number; c: number;
    };
    onlineResult = {
      documents: targets.length,
      gold,
      silver,
      goldTypeDatePercent: pct(gold.typeDate, gold.expected),
      silverTypeDatePercent: pct(silver.typeDate, silver.expected),
      usage: { calls: usage.calls, inputTokens: usage.i, outputTokens: usage.o, costUsd: Math.round(usage.c) / 1e6 },
      perDocument: docResults,
    };
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), offline, online: onlineResult, perDocument: perDoc }, null, 2));

  /* ───── Ausgabe ───── */
  console.log(`Eval Dokumentanalyse, Stand ${stamp()}`);
  console.log(`  Dokumente (PDF):            ${offline.documents} (nicht lesbar: ${offline.unreadable}), Seiten: ${offline.pages}`);
  console.log(`  mit Textebene:              ${offline.withTextLayer} (${offline.withTextLayerPercent} %), Vision nötig: ${offline.needVision}`);
  console.log(`  Zeichen je Seite:           Median ${offline.medianCharsPerPage}, Mittel ${offline.meanCharsPerPage}`);
  console.log(`  Barcode (BCBP) im Text:     ${offline.withBcbp}`);
  console.log(`  Flugnummer-Kandidat:        ${offline.withFlightNumberCandidate}`);
  console.log(`  Buchungscode-Kandidat:      ${offline.withReferenceCandidate}`);
  console.log(`  Referenz vorhanden:         gold ${offline.documentsWithGold} Dokumente, silver ${offline.documentsWithSilver} Dokumente`);
  for (const k of ["gold", "silver"] as const) {
    const c = offline.expectedInText[k];
    console.log(
      `  erwartete Werte im Text (${k}): ${c.items} Ereignisse; Datum mit Jahr ${c.date} (${c.datePercent} %), ohne Jahr ${c.dateNoYear} (${c.dateNoYearPercent} %), ` +
        `Referenz ${c.ref}/${c.refItems} (${c.refPercent} %), Flugnummer ${c.fn}/${c.fnItems} (${c.flightNumberPercent} %)`
    );
  }
  if (onlineResult) {
    const o = onlineResult as { gold: Cmp; silver: Cmp; usage: { calls: number; costUsd: number }; documents: number };
    console.log(`  KI-Lauf (${o.documents} Dokumente, ${o.usage.calls} Aufrufe, ca. ${o.usage.costUsd.toFixed(2)} USD):`);
    for (const [name, c] of [["gold", o.gold], ["silver", o.silver]] as const) {
      console.log(`    ${name}: Typ+Datum ${c.typeDate}/${c.expected}, Zeit ${c.time}/${c.timeBoth}, Referenz ${c.ref}/${c.refBoth}, zusätzliche Vorschläge ${c.extra}`);
    }
  } else {
    console.log("  KI-Lauf: übersprungen (OPENAI_API_KEY nicht in der Umgebung)");
  }
  console.log(`  Bericht: ${path.relative(process.cwd(), outFile) || outFile}`);
}

void main();
