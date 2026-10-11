/**
 * Bericht des HomeBuddy-Imports. Enthält nur Zahlen, Titel und Namen: keine Hashes, Tokens, Pfade zu Geheimnissen
 * oder Dokumentinhalte. `renderReportText` erzeugt die lesbare Fassung (Datum `dd.mm.yyyy`, Zeit `hh:mm`).
 */
import type { DetailsReport } from "./details";

export type Tally = { source: number; created: number; updated: number };

export type Check = {
  name: string;
  expected: number | string;
  actual: number | string;
  ok: boolean;
  /** Wofür die Prüfung nicht gilt (z. B. «keine Dokumente angegeben»). */
  skipped?: string;
};

export type BalanceLine = {
  ledger: string;
  participant: string;
  /** Aus den Quellzeilen gerechnet (Minor Units, Basiswährung). */
  expectedMinor: number;
  /** Aus `summary.json` (Abgleich über Anzeigename), falls vorhanden. */
  summaryMinor: number | null;
  /** Nach dem Import mit der TravelBuddy-Logik gerechnet. */
  actualMinor: number;
  diffMinor: number;
  ok: boolean;
};

export type ZoneReviewLine = { trip: string; type: string; title: string; reason: string };

export type ImportReport = {
  generatedAt: string;
  /** Dateiname der Quelle (ohne Pfad). */
  sourceFile: string;
  mode: "import" | "dry-run";
  /** `ok`: Abnahme bestanden; `mismatch`: Abweichung, alles zurückgerollt. */
  status: "ok" | "mismatch";
  /** Wurde in die Datenbank geschrieben (false bei Trockenlauf und bei Abweichung)? */
  committed: boolean;
  summaryUsed: boolean;
  counts: {
    users: Tally;
    trips: Tally;
    events: Tally;
    participants: Tally;
    couples: Tally;
    ledgers: Tally;
    expenses: Tally;
    settlements: Tally;
    comments: Tally;
    documents: Tally;
    eventDocumentLinks: Tally;
  };
  eventsByType: Record<string, number>;
  users: { activeUsers: number; activeAdmins: number; skippedExisting: number };
  participants: { merged: number; tokensKept: number; aliasTokens: number; tokensRegenerated: number };
  cashbooks: Array<{ ledger: string; trip: string | null; payer: string; expenses: number; rule: string }>;
  zones: {
    byOrigin: Record<string, number>;
    review: ZoneReviewLine[];
  };
  eventsNeedingReview: { unknownType: number; zones: number };
  details: DetailsReport;
  documents: {
    linkedInSource: number;
    imported: number;
    duplicates: number;
    unlinkedImported: number;
    missingFiles: number;
    hashMismatches: number;
    folder: boolean;
  };
  media: { tableInSource: boolean; inSource: number; copied: number; missingFiles: number; skippedKinds: number };
  checks: Check[];
  balances: BalanceLine[];
  warnings: string[];
};

export const tally = (source = 0): Tally => ({ source, created: 0, updated: 0 });

export function newReport(sourceFile: string, mode: ImportReport["mode"], now: Date): ImportReport {
  return {
    generatedAt: now.toISOString(),
    sourceFile,
    mode,
    status: "ok",
    committed: false,
    summaryUsed: false,
    counts: {
      users: tally(), trips: tally(), events: tally(), participants: tally(), couples: tally(), ledgers: tally(),
      expenses: tally(), settlements: tally(), comments: tally(), documents: tally(), eventDocumentLinks: tally(),
    },
    eventsByType: {},
    users: { activeUsers: 0, activeAdmins: 0, skippedExisting: 0 },
    participants: { merged: 0, tokensKept: 0, aliasTokens: 0, tokensRegenerated: 0 },
    cashbooks: [],
    zones: { byOrigin: {}, review: [] },
    eventsNeedingReview: { unknownType: 0, zones: 0 },
    details: {
      droppedKeys: {}, invalidValues: {}, normalizedSelects: {}, truncated: {}, renamedKeys: {}, eventsWithDetails: 0,
    },
    documents: { linkedInSource: 0, imported: 0, duplicates: 0, unlinkedImported: 0, missingFiles: 0, hashMismatches: 0, folder: false },
    media: { tableInSource: false, inSource: 0, copied: 0, missingFiles: 0, skippedKinds: 0 },
    checks: [],
    balances: [],
    warnings: [],
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** `dd.mm.yyyy hh:mm` (Ortszeit des Rechners). */
export function displayDateTime(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Betrag in Minor Units als «1’234.50» (de-CH). */
export function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return `${sign}${whole}.${pad(abs % 100)}`;
}

const T: Record<keyof ImportReport["counts"], string> = {
  users: "Benutzer",
  trips: "Reisen",
  events: "Ereignisse",
  participants: "Teilnehmer",
  couples: "Paare",
  ledgers: "Reisekassen",
  expenses: "Ausgaben",
  settlements: "Rückzahlungen",
  comments: "Kommentare",
  documents: "Dokumente",
  eventDocumentLinks: "Ereignis-Dokument-Verknüpfungen",
};

const kv = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ");

export function renderReportText(r: ImportReport): string {
  const L: string[] = [];
  const when = displayDateTime(new Date(r.generatedAt));
  const verdict =
    r.status === "mismatch"
      ? "ABWEICHUNG – nichts übernommen (zurückgerollt)"
      : r.mode === "dry-run"
        ? "Trockenlauf bestanden – nichts geschrieben"
        : "Import abgeschlossen, Abnahme bestanden";
  L.push(`TravelBuddy – Import aus HomeBuddy`);
  L.push(`Stand: ${when} · Quelle: ${r.sourceFile} · ${verdict}`);
  L.push("");
  L.push("Zählungen (Quelle / neu angelegt / aktualisiert)");
  for (const k of Object.keys(T) as Array<keyof typeof T>) {
    const t = r.counts[k];
    L.push(`  ${T[k].padEnd(34)} ${String(t.source).padStart(5)} / ${String(t.created).padStart(5)} / ${String(t.updated).padStart(5)}`);
  }
  L.push(`  Ereignisse nach Typ: ${kv(r.eventsByType) || "–"}`);
  L.push("");
  L.push("Abnahme");
  for (const c of r.checks) {
    const mark = c.skipped ? "übersprungen" : c.ok ? "ok" : "ABWEICHUNG";
    L.push(`  [${mark}] ${c.name}: erwartet ${c.expected}, ist ${c.actual}${c.skipped ? ` (${c.skipped})` : ""}`);
  }
  if (r.balances.length) {
    L.push("");
    L.push("Salden je Teilnehmer (Basiswährung; plus = bekommt noch Geld)");
    for (const b of r.balances) {
      const sum = b.summaryMinor == null ? "" : ` · summary.json ${money(b.summaryMinor)}`;
      L.push(
        `  ${b.ledger} · ${b.participant}: erwartet ${money(b.expectedMinor)} · ist ${money(b.actualMinor)}${sum} · Differenz ${money(b.diffMinor)}${b.ok ? "" : "  <-- ABWEICHUNG"}`
      );
    }
  }
  if (r.cashbooks.length) {
    L.push("");
    L.push("Kassabücher (als Reisekasse übernommen)");
    for (const c of r.cashbooks) {
      L.push(`  ${c.ledger}${c.trip ? ` (Reise: ${c.trip})` : ""}: ${c.expenses} Ausgaben, bezahlt von ${c.payer}`);
      L.push(`    Regel: ${c.rule}`);
    }
  }
  L.push("");
  L.push("Zeitzonen");
  L.push(`  Herkunft: ${kv(r.zones.byOrigin) || "–"}`);
  L.push(`  Zu prüfen: ${r.zones.review.length}`);
  for (const z of r.zones.review) L.push(`    ${z.trip} · ${z.type} · ${z.title}: ${z.reason}`);
  if (r.eventsNeedingReview.unknownType) L.push(`  Zu prüfen wegen unbekanntem Typ: ${r.eventsNeedingReview.unknownType}`);
  L.push("");
  L.push("Details gegen den Katalog");
  L.push(`  Ereignisse mit Details: ${r.details.eventsWithDetails}`);
  L.push(`  Verworfene Schlüssel: ${kv(r.details.droppedKeys) || "keine"}`);
  L.push(`  Unbrauchbare Werte: ${kv(r.details.invalidValues) || "keine"}`);
  L.push(`  Auf Katalog-Optionen normalisiert: ${kv(r.details.normalizedSelects) || "keine"}`);
  L.push(`  Gekürzte Texte: ${kv(r.details.truncated) || "keine"}`);
  L.push(`  Umbenannte Schlüssel: ${kv(r.details.renamedKeys) || "keine"}`);
  L.push("");
  L.push("Teilnehmer und Zugang");
  L.push(
    `  Aus Reise und Kasse zusammengeführt: ${r.participants.merged} · Link-Tokens erhalten: ${r.participants.tokensKept} · ` +
      `zweiter Token als Alias: ${r.participants.aliasTokens} · neu vergeben: ${r.participants.tokensRegenerated}`
  );
  L.push(`  Aktive Benutzer: ${r.users.activeUsers} (davon Administratoren: ${r.users.activeAdmins}) · schon vorhanden: ${r.users.skippedExisting}`);
  L.push("");
  L.push("Dokumente");
  const d = r.documents;
  L.push(
    `  Verknüpfte Dokumente in der Quelle: ${d.linkedInSource} · übernommen: ${d.imported} (davon unzugeordnet: ${d.unlinkedImported}) · ` +
      `Dubletten: ${d.duplicates} · Datei fehlt: ${d.missingFiles} · Hash weicht ab: ${d.hashMismatches}` +
      (d.folder ? "" : " · kein Dokumentenordner angegeben")
  );
  L.push("");
  L.push("Medien");
  L.push(
    r.media.tableInSource
      ? `  In der Quelle: ${r.media.inSource} · kopiert: ${r.media.copied} · Datei fehlt: ${r.media.missingFiles} · nicht übernommene Arten: ${r.media.skippedKinds}`
      : "  Die Quelle enthält keine Medien-Tabelle (keine Bilder zu übernehmen)."
  );
  if (r.warnings.length) {
    L.push("");
    L.push("Hinweise");
    for (const w of r.warnings) L.push(`  - ${w}`);
  }
  return L.join("\n") + "\n";
}
