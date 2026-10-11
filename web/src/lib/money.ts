/**
 * Geld im Client: Beträge sind immer ganze Minor Units (Rappen, Cent, Yen …).
 * Eingaben werden exakt als Zeichenkette zerlegt, nie über Fliesskomma gelesen;
 * die Anzeige rechnet mit Ganzzahlen. Entspricht `server/src/lib/money.ts`.
 */

/** Währungen ohne Nachkommastellen (wie im Server). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "ISK", "VND", "CLP", "UGX", "XAF", "XOF"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.trim().toUpperCase()) ? 0 : 2;
}

export type MinorParse = { ok: true; minor: number } | { ok: false; error: string };

export interface ParseOptions {
  /** Negative Beträge zulassen (Standard: nein). */
  allowNegative?: boolean;
  /** Betrag 0 zulassen (Standard: nein). */
  allowZero?: boolean;
}

const GROUP_CHARS = /[\s  '’‘`´]/g;

/**
 * «12.5» → 1250, «1’234.50» → 123450, «12,50» → 1250, «1,234.50» → 123450.
 * Mehrdeutiges («1,234» bei CHF) und zu viele Nachkommastellen werden abgelehnt.
 */
export function parseMinor(input: string, currency: string, opts: ParseOptions = {}): MinorParse {
  const exp = currencyExponent(currency);
  let s = input.replace(GROUP_CHARS, "");
  if (s === "") return { ok: false, error: "Betrag eingeben" };

  let negative = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return { ok: false, error: "Ungültiger Betrag" };
  if (negative && !opts.allowNegative) return { ok: false, error: "Betrag darf nicht negativ sein" };

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart: string;
  let fracPart = "";

  const groupedOk = (digits: string, sep: string) => {
    const parts = digits.split(sep);
    return parts[0]!.length >= 1 && parts[0]!.length <= 3 && parts.slice(1).every((p) => /^\d{3}$/.test(p));
  };

  if (lastDot >= 0 && lastComma >= 0) {
    // Beide vorhanden: das spätere ist das Dezimalzeichen, das andere gruppiert.
    const decimalAt = Math.max(lastDot, lastComma);
    const groupSep = lastDot > lastComma ? "," : ".";
    const decSep = lastDot > lastComma ? "." : ",";
    const head = s.slice(0, decimalAt);
    fracPart = s.slice(decimalAt + 1);
    if (head.includes(decSep)) return { ok: false, error: "Ungültiger Betrag" };
    if (!groupedOk(head, groupSep)) return { ok: false, error: "Ungültiger Betrag" };
    intPart = head.split(groupSep).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const count = s.split(sep).length - 1;
    const at = s.lastIndexOf(sep);
    const after = s.slice(at + 1);
    if (count > 1) {
      if (!groupedOk(s, sep)) return { ok: false, error: "Ungültiger Betrag" };
      intPart = s.split(sep).join("");
    } else if (exp === 0) {
      // Währung ohne Nachkommastellen: ein einzelnes Trennzeichen kann nur gruppieren.
      if (/^\d{3}$/.test(after) && at >= 1) intPart = s.split(sep).join("");
      else return { ok: false, error: "Diese Währung hat keine Nachkommastellen" };
    } else if (after.length === 0 || (after.length >= 1 && after.length <= exp)) {
      intPart = s.slice(0, at);
      fracPart = after;
      if (intPart === "") intPart = "0";
    } else if (after.length === 3) {
      return { ok: false, error: "Mehrdeutiger Betrag, bitte ohne Tausendertrennzeichen eingeben" };
    } else {
      return { ok: false, error: `Höchstens ${exp} Nachkommastellen` };
    }
  } else {
    intPart = s;
  }

  if (!/^\d+$/.test(intPart)) return { ok: false, error: "Ungültiger Betrag" };
  if (fracPart !== "" && !/^\d+$/.test(fracPart)) return { ok: false, error: "Ungültiger Betrag" };
  if (fracPart.length > exp) return { ok: false, error: `Höchstens ${exp} Nachkommastellen` };

  const digits = (intPart.replace(/^0+(?=\d)/, "") + fracPart.padEnd(exp, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return { ok: false, error: "Betrag ist zu gross" };
  let minor = Number(digits);
  if (!Number.isSafeInteger(minor)) return { ok: false, error: "Betrag ist zu gross" };
  if (minor === 0 && !opts.allowZero) return { ok: false, error: "Betrag muss grösser als 0 sein" };
  if (negative) minor = -minor;
  return { ok: true, minor };
}

const MINUS = "−";
const GROUP = "’";

function groupThousands(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP;
    out += digits[i];
  }
  return out;
}

/** Ganzzahl mit Tausenderapostroph («12’345»), unabhängig von der ICU-Version des Browsers. */
export function formatInt(n: number): string {
  const v = Math.round(n);
  const g = groupThousands(String(Math.abs(v)));
  return v < 0 ? MINUS + g : g;
}

/** «1’234.50» – rein ganzzahlig, ohne Währung. Negativ mit echtem Minuszeichen. */
export function formatMinor(minor: number, currency: string, opts: { sign?: "auto" | "always" } = {}): string {
  const exp = currencyExponent(currency);
  const abs = Math.abs(minor);
  const base = 10 ** exp;
  const whole = Math.floor(abs / base);
  const frac = abs - whole * base;
  let out = groupThousands(String(whole));
  if (exp > 0) out += "." + String(frac).padStart(exp, "0");
  if (minor < 0) out = MINUS + out;
  else if (opts.sign === "always" && minor > 0) out = "+" + out;
  return out;
}

/** «CHF 1’234.50» */
export function formatMoney(minor: number, currency: string, opts: { sign?: "auto" | "always" } = {}): string {
  const cur = currency.trim().toUpperCase();
  const n = formatMinor(minor, cur, opts);
  if (n.startsWith(MINUS) || n.startsWith("+")) return `${n[0]}${cur} ${n.slice(1)}`;
  return `${cur} ${n}`;
}

/** Betrag für ein Eingabefeld: «1234.50», ohne Gruppierung. */
export function minorToInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const abs = Math.abs(minor);
  const base = 10 ** exp;
  const whole = Math.floor(abs / base);
  const frac = abs - whole * base;
  const s = exp > 0 ? `${whole}.${String(frac).padStart(exp, "0")}` : String(whole);
  return minor < 0 ? `-${s}` : s;
}

/** Wechselkurs aus Texteingabe («0.9412», «0,9412»). Kein Geld, nur ein Faktor. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Kurs für die Anzeige, ohne Exponentialschreibweise. */
export function formatRate(rate: number): string {
  const s = rate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/**
 * Vorschau der Umrechnung in die Basiswährung, ganzzahlig gerechnet (Kurs auf 8 Stellen).
 * Der Server rechnet verbindlich; hier nur für die Anzeige «≈».
 */
export function convertMinorPreview(amountMinor: number, from: string, to: string, rate: number): number {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return amountMinor;
  const [i = "0", fr = ""] = rate.toFixed(8).split(".");
  const scaled = BigInt(i + fr.padEnd(8, "0"));
  let num = BigInt(Math.abs(amountMinor)) * scaled;
  let den = 10n ** 8n;
  const d = currencyExponent(t) - currencyExponent(f);
  if (d > 0) num *= 10n ** BigInt(d);
  else if (d < 0) den *= 10n ** BigInt(-d);
  const q = (2n * num + den) / (2n * den);
  const n = Number(q);
  return amountMinor < 0 ? -n : n;
}

/** Summe ganzer Beträge je Währung als «CHF 12.00 · EUR 5.00». */
export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals).filter(([, v]) => v !== 0);
  if (entries.length === 0) return "–";
  return entries
    .sort(([a], [b]) => (a === "CHF" ? -1 : b === "CHF" ? 1 : a.localeCompare(b)))
    .map(([cur, v]) => formatMoney(v, cur))
    .join(" · ");
}
