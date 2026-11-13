/**
 * Ausgaben-Protokoll einer Reisekasse als PDF (A4).
 *  - `date`:   alle Ausgaben chronologisch, je Tag gruppiert, dazu Ausgleichszahlungen.
 *  - `person`: je Person bezahlte Ausgaben, Anteile und Saldo (optional nur eine Person).
 * Anzeige: dd.mm.yyyy, hh:mm, Zahlen de-CH. Die Standardschrift (Helvetica) kennt nur WinAnsi:
 * «−» und «→» werden daher ersetzt.
 */
import PDFDocument from "pdfkit";
import type { Db } from "../db/client";
import { appTimeZone, displayDate } from "../lib/dates";
import { formatMoney } from "../lib/money";
import * as L from "./service";

export type ReportGroupBy = "date" | "person";

type Overview = ReturnType<typeof L.ledgerOverview>;
type Expense = ReturnType<typeof L.listExpenses>[number];
type Settlement = ReturnType<typeof L.listSettlements>[number];

export type LedgerReportData = {
  title: string;
  currency: string;
  groupBy: ReportGroupBy;
  generatedAt: Date;
  members: Array<{ id: number; displayName: string }>;
  /** Nur bei groupBy = person: eingeschränkt auf diese Person. */
  onlyMemberId: number | null;
  expenses: Expense[];
  settlements: Settlement[];
  balances: Overview["balances"];
  totals: Overview["totals"];
};

export function buildLedgerReport(
  db: Db,
  ledgerId: number,
  opts: { groupBy: ReportGroupBy; participantId?: number | null; now?: Date }
): LedgerReportData {
  const overview = L.ledgerOverview(db, ledgerId);
  const members = overview.members.map((m) => ({ id: m.id, displayName: m.displayName }));
  if (opts.participantId != null && !members.some((m) => m.id === opts.participantId)) {
    throw new RangeError("participant_not_in_ledger");
  }
  return {
    title: overview.ledger.title,
    currency: overview.ledger.baseCurrency,
    groupBy: opts.groupBy,
    generatedAt: opts.now ?? new Date(),
    members,
    onlyMemberId: opts.groupBy === "person" ? opts.participantId ?? null : null,
    expenses: L.listExpenses(db, ledgerId),
    settlements: L.listSettlements(db, ledgerId),
    balances: overview.balances,
    totals: overview.totals,
  };
}

/* ─ Hilfen ─ */

const money = (minor: number, cur: string) => formatMoney(minor, cur).replace("−", "-");

const expenseDay = (e: Expense) => e.expenseDate ?? e.createdAt.slice(0, 10);
const settlementDay = (s: Settlement) => s.settledAt.slice(0, 10);

function stamp(d: Date): string {
  const p = new Intl.DateTimeFormat("de-CH", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")} ${g("hour")}:${g("minute")}`;
}

/** Dateiname ohne Sonderzeichen: «Ausgaben-Sardinien-nach-Datum.pdf». */
export function reportFileName(title: string, groupBy: ReportGroupBy): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Reisekasse";
  return `Ausgaben-${slug}-${groupBy === "date" ? "nach-Datum" : "nach-Person"}.pdf`;
}

/* ─ Zeichnen ─ */

const MARGIN = 40;
const INK = "#1b1f23";
const MUTED = "#6b7280";
const RULE = "#d1d5db";

type Doc = InstanceType<typeof PDFDocument>;

class Writer {
  constructor(private doc: Doc, private data: LedgerReportData) {}

  private get left() {
    return this.doc.page.margins.left;
  }
  private get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }
  private get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  title(text: string, sub: string) {
    const d = this.doc;
    d.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(text, this.left, d.y, { width: this.width });
    d.font("Helvetica").fontSize(10).fillColor(MUTED).text(sub, this.left, d.y + 2, { width: this.width });
    d.moveDown(0.8);
  }

  heading(text: string, size = 12) {
    this.ensure(size + 30);
    const d = this.doc;
    d.moveDown(0.6);
    d.font("Helvetica-Bold").fontSize(size).fillColor(INK).text(text, this.left, d.y, { width: this.width });
    const y = d.y + 2;
    d.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.5).strokeColor(RULE).stroke();
    d.y = y + 5;
  }

  /** Zeile: links (ggf. mehrzeilig) und rechts ausgerichteter Betrag, darunter optional Zusatz in Grau. */
  row(leftText: string, rightText: string, detail?: string, bold = false) {
    const d = this.doc;
    const rightW = 120;
    const leftW = this.width - rightW - 8;
    d.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    const h1 = Math.max(d.heightOfString(leftText, { width: leftW }), d.heightOfString(rightText, { width: rightW }));
    let h2 = 0;
    if (detail) {
      d.font("Helvetica").fontSize(8.5);
      h2 = d.heightOfString(detail, { width: this.width });
    }
    this.ensure(h1 + h2 + 6);
    const y = d.y;
    d.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK);
    d.text(leftText, this.left, y, { width: leftW });
    d.text(rightText, this.left + leftW + 8, y, { width: rightW, align: "right" });
    let next = y + h1;
    if (detail) {
      d.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(detail, this.left, next, { width: this.width });
      next += h2;
    }
    d.y = next + 4;
  }

  footers() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      const bottom = d.page.margins.bottom;
      d.page.margins.bottom = 0; // sonst legt pdfkit beim Schreiben im Fussbereich eine neue Seite an
      d.font("Helvetica").fontSize(8).fillColor(MUTED);
      d.text(
        `TravelBuddy · ${this.data.title} · erstellt ${stamp(this.data.generatedAt)}`,
        this.left,
        d.page.height - 28,
        { width: this.width - 60, align: "left", lineBreak: false }
      );
      d.text(`Seite ${i + 1} / ${range.count}`, this.left + this.width - 60, d.page.height - 28, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
      d.page.margins.bottom = bottom;
    }
  }
}

function expenseLines(e: Expense, name: (id: number) => string, cur: string) {
  const foreign = e.currency !== cur;
  const amount = foreign
    ? `${money(e.amountMinor, e.currency)} (${money(e.amountBaseMinor, cur)})`
    : money(e.amountMinor, cur);
  const title = `${e.direction === "income" ? "Einnahme: " : ""}${e.description?.trim() || "Ohne Beschreibung"}`;
  const parts = [`Bezahlt von ${name(e.paidByMemberId)}`];
  if (e.category) parts.push(e.category);
  if (e.splits.length) {
    parts.push(`Aufteilung: ${e.splits.map((s) => `${name(s.memberId)} ${money(s.shareBaseMinor, cur).replace(`${cur} `, "")}`).join(", ")}`);
  }
  if (e.note?.trim()) parts.push(e.note.trim());
  return { title, amount, detail: parts.join(" · ") };
}

function renderByDate(w: Writer, data: LedgerReportData) {
  const cur = data.currency;
  const name = (id: number) => data.members.find((m) => m.id === id)?.displayName ?? `#${id}`;
  type Item = { day: string; sort: string; kind: "e"; e: Expense } | { day: string; sort: string; kind: "s"; s: Settlement };
  const items: Item[] = [
    ...data.expenses.map((e) => ({ day: expenseDay(e), sort: e.createdAt, kind: "e" as const, e })),
    ...data.settlements.map((s) => ({ day: settlementDay(s), sort: s.createdAt, kind: "s" as const, s })),
  ].sort((a, b) => (a.day === b.day ? a.sort.localeCompare(b.sort) : a.day.localeCompare(b.day)));

  if (!items.length) w.row("Noch keine Ausgaben erfasst.", "");
  let day = "";
  let dayTotal = 0;
  const flushDay = () => {
    if (day && dayTotal !== 0) w.row(`Summe ${displayDate(day)}`, money(dayTotal, cur), undefined, true);
  };
  for (const it of items) {
    if (it.day !== day) {
      flushDay();
      day = it.day;
      dayTotal = 0;
      w.heading(displayDate(day), 11);
    }
    if (it.kind === "e") {
      const l = expenseLines(it.e, name, cur);
      w.row(l.title, l.amount, l.detail);
      if (it.e.direction === "expense") dayTotal += it.e.amountBaseMinor;
    } else {
      const s = it.s;
      w.row(
        `Ausgleich: ${name(s.fromMemberId)} an ${name(s.toMemberId)}`,
        money(s.amountBaseMinor, cur),
        s.note?.trim() || (s.auto ? "Automatisch beim Ausgleich einer Paar-Ausgabe" : undefined)
      );
    }
  }
  flushDay();

  w.heading("Zusammenfassung");
  w.row("Ausgaben gesamt", money(data.totals.expenseMinor, cur));
  if (data.totals.incomeMinor) w.row("Einnahmen gesamt", money(data.totals.incomeMinor, cur));
  w.heading("Salden", 11);
  for (const b of data.balances) {
    w.row(b.displayName, money(b.netMinor, cur), b.netMinor > 0 ? "bekommt noch Geld" : b.netMinor < 0 ? "schuldet noch Geld" : "ausgeglichen");
  }
}

function renderByPerson(w: Writer, data: LedgerReportData) {
  const cur = data.currency;
  const name = (id: number) => data.members.find((m) => m.id === id)?.displayName ?? `#${id}`;
  const people = data.members.filter((m) => data.onlyMemberId == null || m.id === data.onlyMemberId);
  const byDay = (a: Expense, b: Expense) => expenseDay(a).localeCompare(expenseDay(b)) || a.createdAt.localeCompare(b.createdAt);
  const real = data.expenses.filter((e) => e.direction === "expense").sort(byDay);

  people.forEach((m, i) => {
    if (i > 0) w.ensure(120);
    w.heading(m.displayName, 14);

    const paid = real.filter((e) => e.paidByMemberId === m.id);
    const owed = real.flatMap((e) => {
      const s = e.splits.find((x) => x.memberId === m.id);
      return s && s.shareBaseMinor > 0 ? [{ e, share: s.shareBaseMinor }] : [];
    });
    const paidTotal = paid.reduce((a, e) => a + e.amountBaseMinor, 0);
    const owedTotal = owed.reduce((a, x) => a + x.share, 0);
    const sent = data.settlements.filter((s) => s.fromMemberId === m.id);
    const received = data.settlements.filter((s) => s.toMemberId === m.id);
    const sentTotal = sent.reduce((a, s) => a + s.amountBaseMinor, 0);
    const receivedTotal = received.reduce((a, s) => a + s.amountBaseMinor, 0);

    w.heading("Bezahlt", 10.5);
    if (!paid.length) w.row("Keine Ausgaben bezahlt.", "");
    for (const e of paid) {
      const l = expenseLines(e, name, cur);
      w.row(`${displayDate(expenseDay(e))}  ${l.title}`, l.amount, l.detail);
    }
    w.row("Summe bezahlt", money(paidTotal, cur), undefined, true);

    w.heading("Anteile", 10.5);
    if (!owed.length) w.row("Keine Anteile.", "");
    for (const { e, share } of owed) {
      w.row(`${displayDate(expenseDay(e))}  ${e.description?.trim() || "Ohne Beschreibung"}`, money(share, cur), `Bezahlt von ${name(e.paidByMemberId)}`);
    }
    w.row("Summe Anteile", money(owedTotal, cur), undefined, true);

    if (sent.length || received.length) {
      w.heading("Ausgleichszahlungen", 10.5);
      for (const s of sent) w.row(`${displayDate(settlementDay(s))}  an ${name(s.toMemberId)}`, money(s.amountBaseMinor, cur));
      for (const s of received) w.row(`${displayDate(settlementDay(s))}  von ${name(s.fromMemberId)}`, money(s.amountBaseMinor, cur));
    }

    const net = paidTotal - owedTotal + sentTotal - receivedTotal;
    w.heading("Saldo", 10.5);
    w.row(net > 0 ? "bekommt noch" : net < 0 ? "schuldet noch" : "ausgeglichen", money(Math.abs(net), cur), undefined, true);
  });
}

export function renderLedgerReportPdf(data: LedgerReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: 56, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Ausgaben ${data.title}`, Producer: "TravelBuddy" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const w = new Writer(doc, data);
    const who = data.onlyMemberId != null ? data.members.find((m) => m.id === data.onlyMemberId)?.displayName : null;
    w.title(
      `Ausgaben ${data.title}`,
      `${data.groupBy === "date" ? "Nach Datum" : who ? `Nach Person: ${who}` : "Nach Person"} · Währung ${data.currency} · Stand ${stamp(data.generatedAt)}`
    );
    if (data.groupBy === "date") renderByDate(w, data);
    else renderByPerson(w, data);
    w.footers();
    doc.end();
  });
}
