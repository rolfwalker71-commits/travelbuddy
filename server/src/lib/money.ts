/**
 * Alle Geldbeträge sind ganzzahlige «Minor Units» (Rappen, Cent, Yen …).
 * Es gibt nirgends Fliesskomma-Beträge, nur Wechselkurse sind Zahlen mit Nachkommastellen.
 */

/** Währungen ohne Nachkommastellen (ISO 4217, Auswahl). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "ISK", "VND", "CLP", "UGX", "XAF", "XOF"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.trim().toUpperCase()) ? 0 : 2;
}

/** Symmetrisches Runden (−2.5 → −3), im Gegensatz zu Math.round. */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function isMinor(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

/**
 * Rechnet einen Betrag in Minor Units von `from` nach `to` um.
 * `rate` = Einheiten `to` pro 1 Einheit `from` (wie ECB/Frankfurter).
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number
): number {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return amountMinor;
  const factor = rate * 10 ** (currencyExponent(t) - currencyExponent(f));
  // toPrecision(15) entfernt Fliesskomma-Rauschen (z.B. 502.49999999999994 → 502.5), damit
  // Server und Clients bei Halbwerten gleich runden.
  return roundHalfAway(Number((amountMinor * factor).toPrecision(15)));
}

/**
 * «CHF 1’234.50» (de-CH). Nur für Anzeigetexte, nie zum Rechnen.
 * Bewusst ohne `Intl.NumberFormat`: Je nach ICU-Version liefert de-CH einen geraden (') oder typografischen (’)
 * Apostroph als Tausendertrenner. Hier ist das Ergebnis auf jeder Plattform gleich.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const factor = 10 ** exp;
  const abs = Math.abs(Math.round(amountMinor));
  const whole = String(Math.floor(abs / factor)).replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  const frac = exp > 0 ? `.${String(abs % factor).padStart(exp, "0")}` : "";
  return `${currency.toUpperCase()} ${amountMinor < 0 ? "−" : ""}${whole}${frac}`;
}
