/**
 * Abnahme des Imports (innerhalb der Transaktion, nach dem Schreiben):
 *  - Zählungen (Reisen, Ereignisse, Teilnehmer, Kassen, Ausgaben, Rückzahlungen, Kommentare, Verknüpfungen),
 *  - Summen je Kasse und Währung (Beträge in Minor Units),
 *  - Salden je Teilnehmer, gerechnet mit der TravelBuddy-Logik (`participantBalances`) gegen die Quellzeilen
 *    und – wenn vorhanden – gegen `summary.json` (Abgleich über Anzeigename).
 * Abweichung > 1 Rappen oder falsche Zählung: der Aufrufer rollt zurück.
 */
import fs from "node:fs";
import type { Db } from "../db/client";
import { participantBalances } from "../ledgers/service";
import type { CheckInput } from "./homebuddy";
import type { Check, ImportReport } from "./report";
import type { Row } from "./source";

const TOLERANCE_MINOR = 1;

type Summary = {
  counts?: {
    trips?: number;
    tripEvents?: number;
    travelers?: number;
    comments?: number;
    eventDocumentLinks?: number;
    ledgersWithTripId?: number;
  };
  ledgers?: Array<{
    ledgerId: number;
    expenses?: number;
    incomes?: number;
    settlements?: number;
    sumByCurrencyMinor?: Record<string, Record<string, number>>;
    balances?: Array<{ displayName: string; netMinor: number }>;
    soloTotals?: Array<{ displayName: string; paidMinor: number; owedMinor: number; netMinor: number }>;
  }>;
};

function readSummary(file: string | null): Summary | null {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Summary;
  } catch {
    return null;
  }
}

const eq = (a: number, b: number, tol = 0) => Math.abs(a - b) <= tol;

export function runChecks(db: Db, input: CheckInput, report: ImportReport, summaryFile: string | null): void {
  const { data } = input;
  const checks = report.checks;
  const add = (name: string, expected: number | string, actual: number | string, tol = 0, skipped?: string) => {
    const ok = skipped ? true : typeof expected === "number" && typeof actual === "number" ? eq(expected, actual, tol) : expected === actual;
    checks.push({ name, expected, actual, ok, ...(skipped ? { skipped } : {}) } satisfies Check);
  };

  const mappedCount = (sourceTable: string, targetTable: string): number =>
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT m.target_id) AS n FROM import_map m JOIN ${targetTable} t ON t.id = m.target_id
            WHERE m.source = 'homebuddy' AND m.source_table = ? AND m.target_table = ?`
        )
        .get(sourceTable, targetTable) as { n: number }
    ).n;

  // Personen = verschiedene Ziel-Teilnehmer, auf die Reisende oder (sichtbare) Mitglieder zeigen.
  const personTargets = new Set<number>();
  for (const id of input.memberTargets.values()) personTargets.add(id);
  const travelerTargets = db
    .prepare(
      `SELECT DISTINCT target_id FROM import_map WHERE source = 'homebuddy' AND source_table = 'trip_travelers' AND target_table = 'participants'`
    )
    .all() as Array<{ target_id: number }>;
  for (const r of travelerTargets) personTargets.add(r.target_id);
  const existingPersons = [...personTargets].filter((id) => db.prepare("SELECT 1 FROM participants WHERE id = ?").get(id)).length;
  // Versteckte Solo-Mitglieder zeigen auf den Ersteller, ergeben also keine zusätzliche Person.
  add("Teilnehmer", input.personCount, existingPersons);

  add("Benutzer", data.users.filter((u) => u.username).length, mappedCount("users", "users"));
  add("Reisen", data.trips.length, mappedCount("trips", "trips"));
  add("Ereignisse", data.trip_events.length, mappedCount("trip_events", "trip_events"));
  add("Reisekassen", data.ledgers.length, mappedCount("ledgers", "ledgers"));
  add("Paare", data.ledger_couples.length, mappedCount("ledger_couples", "ledger_couples"));
  add("Ausgaben", data.expenses.length, mappedCount("expenses", "expenses"));
  add("Rückzahlungen", data.settlements.length, mappedCount("settlements", "settlements"));
  add("Kommentare", data.trip_event_comments.length, mappedCount("trip_event_comments", "trip_event_comments"));

  // Ereignis-Dokument-Verknüpfungen: nur prüfbar, wenn ein Dokumentenordner angegeben war.
  const linkPairs = new Set(data.trip_event_documents.map((l) => `${l.trip_event_id}:${l.document_id}`)).size;
  let linksActual = 0;
  {
    const rows = db
      .prepare(
        `SELECT e.target_id AS ev, d.target_id AS doc
           FROM import_map e JOIN import_map d ON d.source = e.source AND d.source_table = 'documents'
           JOIN trip_event_documents l ON l.trip_event_id = e.target_id AND l.document_id = d.target_id
          WHERE e.source = 'homebuddy' AND e.source_table = 'trip_events'`
      )
      .all() as Array<{ ev: number; doc: number }>;
    // Quell-Paare einzeln abgleichen (mehrere Quell-Dokumente können auf eine Zieldatei fallen).
    for (const l of new Set(data.trip_event_documents.map((x) => `${x.trip_event_id}:${x.document_id}`))) {
      const [ev, doc] = l.split(":").map(Number) as [number, number];
      const evT = input.map.get("trip_events", ev);
      const docT = input.map.get("documents", doc);
      if (evT != null && docT != null && rows.some((r) => r.ev === evT && r.doc === docT)) linksActual += 1;
    }
  }
  add(
    "Ereignis-Dokument-Verknüpfungen",
    linkPairs,
    linksActual,
    0,
    input.documentsAvailable ? undefined : "keine Dokumente angegeben"
  );

  // Summen je Kasse und Währung, Salden je Teilnehmer
  const summary = readSummary(summaryFile);
  report.summaryUsed = summary != null;
  const ledgerTitle = (id: number) => String(data.ledgers.find((l) => l.id === id)?.title ?? `Kasse ${id}`);
  const nameOf = (participantId: number) =>
    (db.prepare("SELECT display_name FROM participants WHERE id = ?").get(participantId) as { display_name: string } | undefined)?.display_name ??
    `#${participantId}`;

  for (const l of data.ledgers) {
    const target = input.ledgerTargets.get(l.id);
    if (target == null) {
      add(`Kasse ${l.id}: Ziel vorhanden`, 1, 0);
      continue;
    }
    const title = ledgerTitle(l.id);
    const srcExpenses = data.expenses.filter((e) => e.ledger_id === l.id);
    const srcSettlements = data.settlements.filter((s) => s.ledger_id === l.id);

    const tgtExpenses = db
      .prepare(
        `SELECT e.* FROM expenses e JOIN import_map m ON m.target_id = e.id AND m.target_table = 'expenses' AND m.source = 'homebuddy' AND m.source_table = 'expenses'
          WHERE e.ledger_id = ?`
      )
      .all(target) as Row[];
    const tgtSettlements = db
      .prepare(
        `SELECT s.* FROM settlements s JOIN import_map m ON m.target_id = s.id AND m.target_table = 'settlements' AND m.source = 'homebuddy' AND m.source_table = 'settlements'
          WHERE s.ledger_id = ?`
      )
      .all(target) as Row[];

    add(`${title}: Ausgaben`, srcExpenses.length, tgtExpenses.length);
    add(`${title}: Rückzahlungen`, srcSettlements.length, tgtSettlements.length);

    const currencies = new Set([...srcExpenses, ...srcSettlements].map((r) => String(r.currency).toUpperCase()));
    for (const cur of [...currencies].sort()) {
      const s = (rows: Row[], key: string, dir?: string) =>
        rows.filter((r) => String(r.currency).toUpperCase() === cur && (dir == null || r.direction === dir)).reduce((a, r) => a + Number(r[key] ?? 0), 0);
      add(`${title}: Ausgaben ${cur} (Betrag)`, s(srcExpenses, "amount_minor", "expense"), s(tgtExpenses, "amount_minor", "expense"));
      add(`${title}: Ausgaben ${cur} (Basiswährung)`, s(srcExpenses, "amount_base_minor", "expense"), s(tgtExpenses, "amount_base_minor", "expense"));
      if (srcSettlements.some((r) => String(r.currency).toUpperCase() === cur)) {
        add(`${title}: Rückzahlungen ${cur} (Basiswährung)`, s(srcSettlements, "amount_base_minor"), s(tgtSettlements, "amount_base_minor"));
      }
    }

    // Erwartete Salden aus den Quellzeilen (Ziel-Teilnehmer je Quell-Mitglied)
    const net = new Map<number, number>();
    const bump = (member: number, v: number) => {
      const p = input.memberTargets.get(member);
      if (p != null) net.set(p, (net.get(p) ?? 0) + v);
    };
    for (const e of srcExpenses) {
      if (e.direction === "income") continue;
      bump(e.paid_by_member_id, Number(e.amount_base_minor));
      for (const s of data.expense_splits.filter((x) => x.expense_id === e.id)) bump(s.member_id, -Number(s.share_base_minor));
    }
    for (const s of srcSettlements) {
      bump(s.from_member_id, Number(s.amount_base_minor));
      bump(s.to_member_id, -Number(s.amount_base_minor));
    }
    const actual = new Map(participantBalances(db, target).map((b) => [b.memberId, b.netMinor]));
    const sumEntry = summary?.ledgers?.find((x) => x.ledgerId === l.id);
    const isCashbook = input.cashbookPayers.has(l.id);
    const summaryByName = new Map((sumEntry?.balances ?? []).map((b) => [b.displayName.trim().toLowerCase(), b.netMinor]));

    for (const [participant, expected] of net) {
      const act = actual.get(participant) ?? 0;
      const name = nameOf(participant);
      const fromSummary = isCashbook ? null : summaryByName.get(name.trim().toLowerCase()) ?? null;
      const diff = act - expected;
      const ok = Math.abs(diff) <= TOLERANCE_MINOR && (fromSummary == null || Math.abs(act - fromSummary) <= TOLERANCE_MINOR);
      report.balances.push({
        ledger: title, participant: name, expectedMinor: expected, summaryMinor: fromSummary, actualMinor: act, diffMinor: diff, ok,
      });
      checks.push({ name: `${title}: Saldo ${name}`, expected, actual: act, ok });
    }
    // Teilnehmer aus summary.json, die im Ziel nicht vorkommen
    if (sumEntry && !isCashbook) {
      const targetNames = new Set([...actual.keys()].map((p) => nameOf(p).trim().toLowerCase()));
      for (const b of sumEntry.balances ?? []) {
        if (!targetNames.has(b.displayName.trim().toLowerCase())) {
          checks.push({ name: `${title}: Teilnehmer ${b.displayName} (summary.json)`, expected: "vorhanden", actual: "fehlt", ok: false });
        }
      }
      add(`${title}: Salden summiert`, 0, [...actual.values()].reduce((a, v) => a + v, 0), TOLERANCE_MINOR);
    }
    // Kassabuch: Rohsummen des Solo-Mitglieds gegen paid/owed des Erstellers
    if (isCashbook && sumEntry?.soloTotals?.length) {
      const payer = input.cashbookPayers.get(l.id)!;
      const paid = tgtExpenses.filter((e) => e.paid_by_participant_id === payer && e.direction === "expense").reduce((a, e) => a + Number(e.amount_base_minor), 0);
      const owed = (
        db
          .prepare(
            `SELECT COALESCE(SUM(s.share_base_minor), 0) AS v FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
              WHERE e.ledger_id = ? AND s.participant_id = ? AND e.direction = 'expense'`
          )
          .get(target, payer) as { v: number }
      ).v;
      const solo = sumEntry.soloTotals[0]!;
      add(`${title}: bezahlt (summary.json)`, solo.paidMinor, paid, TOLERANCE_MINOR);
      add(`${title}: Anteil (summary.json)`, solo.owedMinor, owed, TOLERANCE_MINOR);
    }
  }

  if (summary) {
    const c = summary.counts ?? {};
    if (c.trips != null) add("summary.json: Reisen", c.trips, mappedCount("trips", "trips"));
    if (c.tripEvents != null) add("summary.json: Ereignisse", c.tripEvents, mappedCount("trip_events", "trip_events"));
    if (c.travelers != null) add("summary.json: Teilnehmer", c.travelers, existingPersons);
    if (c.comments != null) add("summary.json: Kommentare", c.comments, mappedCount("trip_event_comments", "trip_event_comments"));
    if (c.eventDocumentLinks != null) {
      add("summary.json: Verknüpfungen", c.eventDocumentLinks, linksActual, 0, input.documentsAvailable ? undefined : "keine Dokumente angegeben");
    }
    for (const l of summary.ledgers ?? []) {
      const target = input.ledgerTargets.get(l.ledgerId);
      if (target == null) {
        add(`summary.json: Kasse ${l.ledgerId}`, "vorhanden", "fehlt");
        continue;
      }
      const title = ledgerTitle(l.ledgerId);
      const exp = (db
        .prepare(
          `SELECT COUNT(*) AS n FROM expenses e JOIN import_map m ON m.target_id = e.id AND m.source = 'homebuddy' AND m.source_table = 'expenses'
            WHERE e.ledger_id = ? AND e.direction = 'expense'`
        )
        .get(target) as { n: number }).n;
      if (l.expenses != null) add(`summary.json ${title}: Ausgaben`, l.expenses, exp);
      if (l.settlements != null) {
        const n = (db
          .prepare(
            `SELECT COUNT(*) AS n FROM settlements s JOIN import_map m ON m.target_id = s.id AND m.source = 'homebuddy' AND m.source_table = 'settlements'
              WHERE s.ledger_id = ?`
          )
          .get(target) as { n: number }).n;
        add(`summary.json ${title}: Rückzahlungen`, l.settlements, n);
      }
      for (const [cur, v] of Object.entries(l.sumByCurrencyMinor ?? {})) {
        const row = db
          .prepare(
            `SELECT COALESCE(SUM(e.amount_minor), 0) AS amount, COALESCE(SUM(e.amount_base_minor), 0) AS base, COUNT(*) AS n
               FROM expenses e JOIN import_map m ON m.target_id = e.id AND m.source = 'homebuddy' AND m.source_table = 'expenses'
              WHERE e.ledger_id = ? AND e.currency = ? AND e.direction = 'expense'`
          )
          .get(target, cur) as { amount: number; base: number; n: number };
        if (v.expenseCount != null) add(`summary.json ${title}: Ausgaben ${cur} (Anzahl)`, v.expenseCount, row.n);
        if (v.expenseAmountMinor != null) add(`summary.json ${title}: Ausgaben ${cur} (Betrag)`, v.expenseAmountMinor, row.amount);
        if (v.expenseBaseMinor != null) add(`summary.json ${title}: Ausgaben ${cur} (Basiswährung)`, v.expenseBaseMinor, row.base);
      }
    }
  }
}
