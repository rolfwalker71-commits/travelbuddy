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
  members: Array<{ id: number; displayName: string; colorIndex: number }>;
  /** Nur bei groupBy = person: eingeschränkt auf diese Person. */
  onlyMemberId: number | null;
  expenses: Expense[];
  settlements: Settlement[];
  balances: Overview["balances"];
  /** Wer schuldet wem (wenigste Überweisungen), wie im Tab «Salden». */
  transfers: Overview["suggestedTransfers"];
  totals: Overview["totals"];
};

export function buildLedgerReport(
  db: Db,
  ledgerId: number,
  opts: { groupBy: ReportGroupBy; participantId?: number | null; now?: Date }
): LedgerReportData {
  const overview = L.ledgerOverview(db, ledgerId);
  const members = overview.members.map((m) => ({ id: m.id, displayName: m.displayName, colorIndex: m.colorIndex }));
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
    transfers: overview.suggestedTransfers,
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
// Farben aus docs/DESIGN.md (Richtung B «Ticket», hell)
const INK = "#1D1B18";
const MUTED = "#6F675A";
const RULE = "#D4C9B4";
const PAPER = "#FBF8F1";
const PAPER2 = "#F1EBDD";
const ACCENT = "#D8452B";
const POS = "#2F7D4F";
const NEG = "#B3261E";
/** Personenfarben (colorIndex 0–7), angelehnt an die Typfarben des Katalogs. */
const PERSON_COLORS = ["#D8452B", "#1F4E5F", "#B48A2B", "#5B8C5A", "#3C6E8F", "#7A5C99", "#C46A2D", "#A8433F"];

type Doc = InstanceType<typeof PDFDocument>;
type IconKind = "coin" | "food" | "stay" | "car" | "air" | "rail" | "fuel" | "shop" | "ticket" | "star" | "calendar" | "swap";

const personColor = (i: number) => PERSON_COLORS[((i % 8) + 8) % 8]!;

/** Kategorie (Freitext) → Symbol und Farbe. */
function categoryIcon(category: string | null | undefined, direction: string): { kind: IconKind; color: string } {
  if (direction === "income") return { kind: "coin", color: POS };
  const c = (category ?? "").toLowerCase();
  const has = (...w: string[]) => w.some((x) => c.includes(x));
  if (has("flug", "flight", "air")) return { kind: "air", color: "#D8452B" };
  if (has("benzin", "tank", "diesel", "treibstoff", "laden")) return { kind: "fuel", color: "#5B8C5A" };
  if (has("unterkunft", "hotel", "airbnb", "übernacht", "uebernacht", "camping", "ferienwohnung", "wohnung")) return { kind: "stay", color: "#B48A2B" };
  if (has("essen", "restaurant", "café", "cafe", "bar", "frühstück", "fruehstueck", "mittag", "abend", "getränk", "getraenk", "verpflegung", "pizza")) return { kind: "food", color: "#A8433F" };
  if (has("zug", "bahn", "sbb", "bus", "tram", "öv", "oev", "fähre", "faehre", "metro")) return { kind: "rail", color: "#3C6E8F" };
  if (has("auto", "miet", "taxi", "uber", "parkplatz", "parking", "maut", "vignette")) return { kind: "car", color: "#7A5C99" };
  if (has("ticket", "eintritt", "museum", "konzert", "show")) return { kind: "ticket", color: "#8A6F9E" };
  if (has("aktivität", "aktivitaet", "ausflug", "tour", "sport", "wellness", "spa")) return { kind: "star", color: "#C46A2D" };
  if (has("einkauf", "shop", "supermarkt", "migros", "coop", "geschenk", "souvenir", "lebensmittel", "kleid")) return { kind: "shop", color: "#1F4E5F" };
  return { kind: "coin", color: MUTED };
}

/** Zeichnet ein Linien-Symbol um (cx, cy) mit Halbkantenlänge r. */
function drawIcon(d: Doc, kind: IconKind, cx: number, cy: number, r: number, color: string) {
  d.save();
  d.translate(cx, cy);
  d.lineWidth(Math.max(0.9, r * 0.17)).lineCap("round").lineJoin("round").strokeColor(color).undash();
  const L = (x1: number, y1: number, x2: number, y2: number) => d.moveTo(x1 * r, y1 * r).lineTo(x2 * r, y2 * r).stroke();
  switch (kind) {
    case "coin":
      d.circle(0, 0, r * 0.95).stroke();
      d.circle(0, 0, r * 0.4).stroke();
      break;
    case "food":
      L(-0.75, -1, -0.75, -0.15); L(-0.15, -1, -0.15, -0.15); L(-0.75, -0.15, -0.15, -0.15); L(-0.45, -0.15, -0.45, 1);
      d.moveTo(0.6 * r, -r).lineTo(0.95 * r, -0.35 * r).lineTo(0.6 * r, 0.1 * r).stroke();
      L(0.6, -1, 0.6, 1);
      break;
    case "stay":
      L(-1, -0.6, -1, 0.9); L(-1, 0.45, 1, 0.45); L(1, 0.45, 1, 0.9);
      d.roundedRect(-0.85 * r, -0.25 * r, 0.6 * r, 0.45 * r, 1).stroke();
      d.moveTo(-0.2 * r, 0.1 * r).lineTo(0.1 * r, -0.1 * r).lineTo(1 * r, -0.1 * r).lineTo(1 * r, 0.45 * r).stroke();
      break;
    case "car":
      d.roundedRect(-r, -0.1 * r, 2 * r, 0.75 * r, 2).stroke();
      d.moveTo(-0.6 * r, -0.1 * r).lineTo(-0.35 * r, -0.65 * r).lineTo(0.35 * r, -0.65 * r).lineTo(0.6 * r, -0.1 * r).stroke();
      d.circle(-0.5 * r, 0.7 * r, 0.2 * r).stroke();
      d.circle(0.5 * r, 0.7 * r, 0.2 * r).stroke();
      break;
    case "air":
      d.moveTo(-r, 0).lineTo(r, -r).lineTo(0.3 * r, r).lineTo(-0.1 * r, 0.25 * r).closePath().stroke();
      L(-0.1, 0.25, 1, -1);
      break;
    case "rail":
      d.roundedRect(-0.7 * r, -r, 1.4 * r, 1.55 * r, 2).stroke();
      L(-0.7, -0.35, 0.7, -0.35);
      d.circle(-0.3 * r, 0.12 * r, 0.1 * r).stroke();
      d.circle(0.3 * r, 0.12 * r, 0.1 * r).stroke();
      L(-0.5, 0.55, -0.85, 1); L(0.5, 0.55, 0.85, 1);
      break;
    case "fuel":
      d.roundedRect(-0.75 * r, -r, 1.15 * r, 2 * r, 1.5).stroke();
      d.rect(-0.55 * r, -0.75 * r, 0.75 * r, 0.6 * r).stroke();
      d.moveTo(0.4 * r, -0.3 * r).lineTo(0.85 * r, -0.3 * r).lineTo(0.85 * r, 0.6 * r).stroke();
      break;
    case "shop":
      d.roundedRect(-0.85 * r, -0.3 * r, 1.7 * r, 1.3 * r, 2).stroke();
      d.moveTo(-0.4 * r, -0.3 * r).bezierCurveTo(-0.4 * r, -1.15 * r, 0.4 * r, -1.15 * r, 0.4 * r, -0.3 * r).stroke();
      break;
    case "ticket":
      d.roundedRect(-r, -0.6 * r, 2 * r, 1.2 * r, 2).stroke();
      d.dash(r * 0.22, { space: r * 0.2 });
      L(0.3, -0.6, 0.3, 0.6);
      d.undash();
      break;
    case "star": {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? 1 : 0.45;
        pts.push([Math.cos(a) * rad * r, Math.sin(a) * rad * r]);
      }
      d.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) d.lineTo(x, y);
      d.closePath().stroke();
      break;
    }
    case "calendar":
      d.roundedRect(-0.9 * r, -0.7 * r, 1.8 * r, 1.7 * r, 2).stroke();
      L(-0.9, -0.15, 0.9, -0.15); L(-0.45, -1, -0.45, -0.5); L(0.45, -1, 0.45, -0.5);
      break;
    case "swap":
      L(-1, -0.4, 1, -0.4); L(0.55, -0.85, 1, -0.4); L(0.55, 0.05, 1, -0.4);
      L(1, 0.5, -1, 0.5); L(-0.55, 0.05, -1, 0.5); L(-0.55, 0.95, -1, 0.5);
      break;
  }
  d.restore();
}

class Writer {
  constructor(private doc: Doc, private data: LedgerReportData) {}

  private get left() { return this.doc.page.margins.left; }
  private get width() { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right; }
  private get bottom() { return this.doc.page.height - this.doc.page.margins.bottom; }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  doc_addPage() {
    this.doc.addPage();
  }

  /** Personenkopf: grosser Kreis mit Initiale, Name und Saldo-Etikett. */
  personHeader(m: { displayName: string; colorIndex: number }, balanceText: string, color: string) {
    this.ensure(48);
    const d = this.doc;
    const y = d.y;
    this.avatar(this.left + 15, y + 15, 15, m);
    d.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(m.displayName, this.left + 40, y + 7, { width: this.width - 200, lineBreak: false, ellipsis: true });
    this.chip(balanceText, color, y + 5);
    d.y = y + 38;
  }

  /** Farbiges Kopfband mit Titel, Untertitel und Ticket-Symbol. */
  header(title: string, sub: string) {
    const d = this.doc;
    const w = d.page.width;
    d.rect(0, 0, w, 92).fill(ACCENT);
    // Perforierung wie bei einem Ticket
    d.save().lineWidth(1.2).strokeColor("#FFFFFF").opacity(0.55).dash(3, { space: 3 }).moveTo(0, 80).lineTo(w, 80).stroke().restore();
    d.save().opacity(0.9);
    drawIcon(d, "ticket", w - 64, 38, 17, "#FFFFFF");
    d.restore();
    d.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF").opacity(0.85).text("TRAVELBUDDY · REISEKASSE", this.left, 22, { characterSpacing: 1.2, width: w - 140 });
    d.opacity(1).font("Helvetica-Bold").fontSize(23).fillColor("#FFFFFF").text(title, this.left, 36, { width: w - 140, lineBreak: false, ellipsis: true });
    d.font("Helvetica").fontSize(9.5).fillColor("#FFFFFF").text(sub, this.left, 66, { width: w - 80, lineBreak: false, ellipsis: true });
    d.y = 108;
  }

  /** Kennzahlen-Karten nebeneinander: { label, value, color? }. */
  stats(items: Array<{ label: string; value: string; color?: string }>) {
    const d = this.doc;
    this.ensure(58);
    const gap = 10;
    const w = (this.width - gap * (items.length - 1)) / items.length;
    const y = d.y;
    items.forEach((it, i) => {
      const x = this.left + i * (w + gap);
      d.roundedRect(x, y, w, 48, 8).fillAndStroke(PAPER2, RULE);
      d.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(it.label.toUpperCase(), x + 12, y + 9, { width: w - 24, characterSpacing: 0.6, lineBreak: false });
      d.font("Helvetica-Bold").fontSize(14).fillColor(it.color ?? INK).text(it.value, x + 12, y + 24, { width: w - 24, lineBreak: false, ellipsis: true });
    });
    d.y = y + 48 + 12;
  }

  /** Abschnittstitel mit farbigem Balken (und optionalem Symbol). */
  heading(text: string, icon?: { kind: IconKind; color: string }) {
    this.ensure(34);
    const d = this.doc;
    d.y += 6;
    const y = d.y;
    d.rect(this.left, y + 1, 3, 15).fill(icon?.color ?? ACCENT);
    let x = this.left + 11;
    if (icon) {
      drawIcon(d, icon.kind, x + 6, y + 8.5, 6, icon.color);
      x += 18;
    }
    d.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, x, y + 2, { width: this.width - (x - this.left), lineBreak: false });
    d.y = y + 22;
  }

  /** Tageskopf: Kalender, Wochentag + Datum, rechts die Tagessumme. */
  dayHeading(day: string, totalText: string | null) {
    this.ensure(46);
    const d = this.doc;
    d.y += 6;
    const y = d.y;
    d.roundedRect(this.left, y, this.width, 22, 6).fill(PAPER2);
    drawIcon(d, "calendar", this.left + 16, y + 11, 6, ACCENT);
    const wd = new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
    d.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(`${wd.replace(".", "")}, ${displayDate(day)}`, this.left + 30, y + 6, { width: this.width / 2, lineBreak: false });
    if (totalText) {
      d.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED).text(totalText, this.left + this.width / 2, y + 6.5, { width: this.width / 2 - 12, align: "right", lineBreak: false });
    }
    d.y = y + 22 + 6;
  }

  avatar(x: number, y: number, r: number, m: { displayName: string; colorIndex: number } | undefined) {
    const d = this.doc;
    d.circle(x, y, r).fill(personColor(m?.colorIndex ?? 0));
    const initial = (m?.displayName?.trim()[0] ?? "?").toUpperCase();
    d.font("Helvetica-Bold").fontSize(r * 1.15).fillColor("#FFFFFF").text(initial, x - r, y - r * 0.58, { width: r * 2, align: "center", lineBreak: false });
  }

  /**
   * Eintrag: farbiges Symbol links, Titel, optional Person mit Kreis vor der grauen Detailzeile,
   * Betrag rechts (optional mit zweiter Zeile).
   */
  entry(o: {
    icon: { kind: IconKind; color: string };
    title: string;
    amount: string;
    amountSub?: string;
    amountColor?: string;
    detail?: string;
    person?: { displayName: string; colorIndex: number };
    prefix?: string;
  }) {
    const d = this.doc;
    const textX = this.left + 34 + (o.prefix ? 0 : 0);
    const rightW = 128;
    const mainW = this.width - 34 - rightW - 8;
    const detailX = textX + (o.person ? 15 : 0);
    d.font("Helvetica-Bold").fontSize(10);
    const titleText = o.prefix ? `${o.prefix}  ${o.title}` : o.title;
    const h1 = d.heightOfString(titleText, { width: mainW });
    let h2 = 0;
    if (o.detail) {
      d.font("Helvetica").fontSize(8.5);
      h2 = d.heightOfString(o.detail, { width: mainW - (detailX - textX) });
    }
    const hRight = 12 + (o.amountSub ? 11 : 0);
    const h = Math.max(h1 + h2 + 2, hRight, 22);
    this.ensure(h + 10);
    const y = d.y;
    d.save().fillColor(o.icon.color).fillOpacity(0.14).circle(this.left + 14, y + 11, 11.5).fill().restore();
    drawIcon(d, o.icon.kind, this.left + 14, y + 11, 6, o.icon.color);
    d.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(titleText, textX, y + 1, { width: mainW });
    if (o.detail) {
      const dy = y + 1 + h1 + 1;
      if (o.person) this.avatar(textX + 5.5, dy + 5.2, 5.5, o.person);
      d.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(o.detail, detailX, dy, { width: mainW - (detailX - textX) });
    }
    d.font("Helvetica-Bold").fontSize(10.5).fillColor(o.amountColor ?? INK).text(o.amount, this.left + this.width - rightW, y + 1, { width: rightW, align: "right", lineBreak: false });
    if (o.amountSub) d.font("Helvetica").fontSize(8).fillColor(MUTED).text(o.amountSub, this.left + this.width - rightW, y + 14, { width: rightW, align: "right", lineBreak: false });
    const yEnd = y + h + 5;
    d.moveTo(this.left + 34, yEnd).lineTo(this.left + this.width, yEnd).lineWidth(0.4).strokeColor(RULE).stroke();
    d.y = yEnd + 5;
  }

  note(text: string) {
    this.ensure(20);
    this.doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTED).text(text, this.left + 34, this.doc.y, { width: this.width - 34 });
    this.doc.y += 6;
  }

  /** Saldo je Person als zentrierter Balken (grün = bekommt, rot = schuldet). */
  balanceBars(rows: Array<{ name: string; colorIndex: number; netMinor: number }>, cur: string) {
    const d = this.doc;
    this.ensure(rows.length * 24 + 4); // Salden-Block zusammenhalten
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.netMinor)));
    const nameW = 110;
    const amtW = 120;
    const barW = this.width - nameW - amtW - 16;
    const mid = this.left + nameW + 8 + barW / 2;
    for (const r of rows) {
      this.ensure(26);
      const y = d.y;
      this.avatar(this.left + 9, y + 10, 8.5, { displayName: r.name, colorIndex: r.colorIndex });
      d.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(r.name, this.left + 24, y + 4.5, { width: nameW - 24, lineBreak: false, ellipsis: true });
      d.roundedRect(this.left + nameW + 8, y + 5, barW, 10, 5).fill(PAPER2);
      const len = (Math.abs(r.netMinor) / max) * (barW / 2 - 2);
      if (r.netMinor !== 0) {
        const x = r.netMinor > 0 ? mid : mid - len;
        d.roundedRect(x, y + 5, Math.max(len, 3), 10, 5).fill(r.netMinor > 0 ? POS : NEG);
      }
      d.moveTo(mid, y + 3).lineTo(mid, y + 17).lineWidth(0.6).strokeColor(MUTED).stroke();
      d.font("Helvetica-Bold").fontSize(10).fillColor(r.netMinor > 0 ? POS : r.netMinor < 0 ? NEG : MUTED)
        .text(r.netMinor === 0 ? "ausgeglichen" : `${r.netMinor > 0 ? "+" : "-"}${money(Math.abs(r.netMinor), cur)}`, this.left + this.width - amtW, y + 4.5, { width: amtW, align: "right", lineBreak: false });
      d.y = y + 24;
    }
  }

  /** «Wer schuldet wem»: Zeile je Überweisung mit Personen-Kreisen; `onlyMemberId` zeigt nur dessen Zahlungen. */
  transfers(onlyMemberId: number | null) {
    const d = this.doc;
    const cur = this.data.currency;
    const list = this.data.transfers.filter((t) => onlyMemberId == null || t.fromMemberId === onlyMemberId || t.toMemberId === onlyMemberId);
    this.heading("Wer schuldet wem", { kind: "swap", color: ACCENT });
    if (!list.length) {
      this.ensure(30);
      const y = d.y;
      d.save().fillColor(POS).fillOpacity(0.12).roundedRect(this.left, y, this.width, 26, 8).fill().restore();
      d.font("Helvetica-Bold").fontSize(10).fillColor(POS).text(
        onlyMemberId == null ? "Alles ausgeglichen: niemand schuldet etwas." : "Ausgeglichen: keine offenen Zahlungen.",
        this.left + 14, y + 8, { width: this.width - 28, lineBreak: false }
      );
      d.y = y + 34;
      return;
    }
    for (const t of list) {
      this.ensure(34);
      const y = d.y;
      const from = this.data.members.find((m) => m.id === t.fromMemberId);
      const to = this.data.members.find((m) => m.id === t.toMemberId);
      d.roundedRect(this.left, y, this.width, 28, 8).fillAndStroke(PAPER2, RULE);
      this.avatar(this.left + 18, y + 14, 8.5, from);
      d.font("Helvetica-Bold").fontSize(10).fillColor(INK);
      const fromW = Math.min(d.widthOfString(t.fromName), 110);
      d.text(t.fromName, this.left + 32, y + 9, { width: 110, lineBreak: false, ellipsis: true });
      const ax = this.left + 32 + fromW + 10;
      d.save().lineWidth(1.2).lineCap("round").lineJoin("round").strokeColor(ACCENT)
        .moveTo(ax, y + 14).lineTo(ax + 26, y + 14).moveTo(ax + 21, y + 9.5).lineTo(ax + 26, y + 14).lineTo(ax + 21, y + 18.5).stroke().restore();
      const bx = ax + 36;
      this.avatar(bx + 8.5, y + 14, 8.5, to);
      d.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(t.toName, bx + 22, y + 9, { width: 110, lineBreak: false, ellipsis: true });
      d.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(money(t.amountMinor, cur), this.left + this.width - 130, y + 8.5, { width: 118, align: "right", lineBreak: false });
      d.y = y + 34;
    }
  }

  /** Farbiges Etikett (Chip) rechtsbündig auf der Zeile `y`. */
  chip(text: string, color: string, y: number) {
    const d = this.doc;
    d.font("Helvetica-Bold").fontSize(9);
    const w = d.widthOfString(text) + 20;
    const x = this.left + this.width - w;
    d.save().fillColor(color).fillOpacity(0.14).roundedRect(x, y, w, 20, 10).fill().restore();
    d.fillColor(color).text(text, x, y + 5.5, { width: w, align: "center", lineBreak: false });
  }

  footers() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      const bottom = d.page.margins.bottom;
      d.page.margins.bottom = 0; // sonst legt pdfkit beim Schreiben im Fussbereich eine neue Seite an
      const y = d.page.height - 34;
      d.moveTo(this.left, y - 6).lineTo(this.left + this.width, y - 6).lineWidth(0.5).strokeColor(RULE).stroke();
      d.circle(this.left + 3, y + 3.5, 3).fill(ACCENT);
      d.font("Helvetica-Bold").fontSize(8).fillColor(INK).text("TravelBuddy", this.left + 11, y, { lineBreak: false });
      d.font("Helvetica").fontSize(8).fillColor(MUTED);
      d.text(`${this.data.title} · erstellt ${stamp(this.data.generatedAt)}`, this.left + 62, y, { width: this.width - 130, lineBreak: false, ellipsis: true });
      d.text(`Seite ${i + 1} / ${range.count}`, this.left + this.width - 60, y, { width: 60, align: "right", lineBreak: false });
      d.page.margins.bottom = bottom;
    }
  }
}

function expenseEntry(e: Expense, name: (id: number) => { displayName: string; colorIndex: number } | undefined, cur: string, extra?: { prefix?: string }) {
  const foreign = e.currency !== cur;
  const payer = name(e.paidByMemberId);
  const parts = [`Bezahlt von ${payer?.displayName ?? `#${e.paidByMemberId}`}`];
  if (e.category) parts.push(e.category);
  if (e.splits.length) {
    parts.push(`Aufteilung: ${e.splits.map((s) => `${name(s.memberId)?.displayName ?? s.memberId} ${money(s.shareBaseMinor, cur).replace(`${cur} `, "")}`).join(", ")}`);
  }
  if (e.note?.trim()) parts.push(e.note.trim());
  const income = e.direction === "income";
  return {
    icon: categoryIcon(e.category, e.direction),
    title: `${income ? "Einnahme: " : ""}${e.description?.trim() || "Ohne Beschreibung"}`,
    amount: `${income ? "+" : ""}${money(e.amountMinor, e.currency)}`,
    amountSub: foreign ? `= ${money(e.amountBaseMinor, cur)}` : undefined,
    amountColor: income ? POS : INK,
    detail: parts.join(" · "),
    person: payer,
    prefix: extra?.prefix,
  };
}

function renderByDate(w: Writer, data: LedgerReportData) {
  const cur = data.currency;
  const person = (id: number) => data.members.find((m) => m.id === id);
  const nameOf = (id: number) => person(id)?.displayName ?? `#${id}`;
  type Item = { day: string; sort: string; kind: "e"; e: Expense } | { day: string; sort: string; kind: "s"; s: Settlement };
  const items: Item[] = [
    ...data.expenses.map((e) => ({ day: expenseDay(e), sort: e.createdAt, kind: "e" as const, e })),
    ...data.settlements.map((s) => ({ day: settlementDay(s), sort: s.createdAt, kind: "s" as const, s })),
  ].sort((a, b) => (a.day === b.day ? a.sort.localeCompare(b.sort) : a.day.localeCompare(b.day)));

  const open = data.balances.filter((b) => b.netMinor !== 0).length;
  w.stats([
    { label: "Ausgaben gesamt", value: money(data.totals.expenseMinor, cur) },
    { label: "Buchungen", value: String(data.totals.count) },
    { label: "Offene Salden", value: open === 0 ? "ausgeglichen" : `${open} ${open === 1 ? "Person" : "Personen"}`, color: open === 0 ? POS : ACCENT },
  ]);

  if (!items.length) w.note("Noch keine Ausgaben erfasst.");
  const days = [...new Set(items.map((i) => i.day))];
  for (const day of days) {
    const ofDay = items.filter((i) => i.day === day);
    const total = ofDay.reduce((a, i) => (i.kind === "e" && i.e.direction === "expense" ? a + i.e.amountBaseMinor : a), 0);
    w.dayHeading(day, total ? `Tag ${money(total, cur)}` : null);
    for (const it of ofDay) {
      if (it.kind === "e") w.entry(expenseEntry(it.e, person, cur));
      else {
        const s = it.s;
        w.entry({
          icon: { kind: "swap", color: POS },
          title: `Ausgleich: ${nameOf(s.fromMemberId)} an ${nameOf(s.toMemberId)}`,
          amount: money(s.amountBaseMinor, cur),
          amountColor: POS,
          detail: s.note?.trim() || (s.auto ? "Automatisch beim Ausgleich einer Paar-Ausgabe" : "Rückzahlung"),
        });
      }
    }
  }

  w.ensure(data.balances.length * 24 + 40);
  w.heading("Salden", { kind: "coin", color: ACCENT });
  w.balanceBars(
    data.balances.map((b) => ({ name: b.displayName, colorIndex: person(b.memberId)?.colorIndex ?? 0, netMinor: b.netMinor })),
    cur
  );
  w.transfers(null);
}

function renderByPerson(w: Writer, data: LedgerReportData) {
  const cur = data.currency;
  const person = (id: number) => data.members.find((m) => m.id === id);
  const nameOf = (id: number) => person(id)?.displayName ?? `#${id}`;
  const people = data.members.filter((m) => data.onlyMemberId == null || m.id === data.onlyMemberId);
  const byDay = (a: Expense, b: Expense) => expenseDay(a).localeCompare(expenseDay(b)) || a.createdAt.localeCompare(b.createdAt);
  const real = data.expenses.filter((e) => e.direction === "expense").sort(byDay);

  people.forEach((m, i) => {
    if (i > 0) w.doc_addPage();
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
    const net = paidTotal - owedTotal + sentTotal - receivedTotal;

    w.personHeader(m, net === 0 ? "ausgeglichen" : net > 0 ? `bekommt ${money(net, cur)}` : `schuldet ${money(-net, cur)}`, net === 0 ? MUTED : net > 0 ? POS : NEG);
    w.stats([
      { label: "Bezahlt", value: money(paidTotal, cur) },
      { label: "Anteile", value: money(owedTotal, cur) },
      { label: "Saldo", value: `${net > 0 ? "+" : net < 0 ? "-" : ""}${money(Math.abs(net), cur)}`, color: net === 0 ? INK : net > 0 ? POS : NEG },
    ]);

    w.heading("Bezahlt", { kind: "coin", color: ACCENT });
    if (!paid.length) w.note("Keine Ausgaben bezahlt.");
    for (const e of paid) w.entry(expenseEntry(e, person, cur, { prefix: displayDate(expenseDay(e)) }));

    w.heading("Anteile", { kind: "shop", color: "#1F4E5F" });
    if (!owed.length) w.note("Keine Anteile.");
    for (const { e, share } of owed) {
      w.entry({
        icon: categoryIcon(e.category, e.direction),
        title: e.description?.trim() || "Ohne Beschreibung",
        amount: money(share, cur),
        detail: `Bezahlt von ${nameOf(e.paidByMemberId)}`,
        person: person(e.paidByMemberId),
        prefix: displayDate(expenseDay(e)),
      });
    }

    if (sent.length || received.length) {
      w.heading("Ausgleichszahlungen", { kind: "swap", color: POS });
      for (const s of sent) w.entry({ icon: { kind: "swap", color: NEG }, title: `an ${nameOf(s.toMemberId)}`, amount: `-${money(s.amountBaseMinor, cur)}`, amountColor: NEG, prefix: displayDate(settlementDay(s)) });
      for (const s of received) w.entry({ icon: { kind: "swap", color: POS }, title: `von ${nameOf(s.fromMemberId)}`, amount: `+${money(s.amountBaseMinor, cur)}`, amountColor: POS, prefix: displayDate(settlementDay(s)) });
    }
  });

  w.transfers(data.onlyMemberId);
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
    w.header(
      `Ausgaben ${data.title}`,
      `${data.groupBy === "date" ? "Nach Datum" : who ? `Nach Person: ${who}` : "Nach Person"} · Währung ${data.currency} · Stand ${stamp(data.generatedAt)}`
    );
    if (data.groupBy === "date") renderByDate(w, data);
    else renderByPerson(w, data);
    w.footers();
    doc.end();
  });
}
