/**
 * Maskiert Pass-/Ausweisnummern, Kartennummern und IBAN, bevor Text an die KI geht. Ticketnummern (13 Ziffern),
 * Buchungscodes und BCBP-Zeichenketten bleiben unverändert: Sie werden gebraucht und sind keine Zahlungsdaten.
 */

const luhn = (digits: string): boolean => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

const PASS_KEYWORDS =
  "reisepass|reisepassnummer|passnummer|pass-?nr\\.?|pass-?nummer|passport(?:\\s?(?:no|number|nr)\\.?)?|passeport|pasaporte|passaporto|" +
  "ausweis(?:nummer|-?nr\\.?)?|personalausweis|identit(?:ä|ae)tskarte|id-?card|identity card|document\\s?(?:no|number|nr)\\.?|doc\\.?\\s?no\\.?|ci\\s?no\\.?";

export type MaskResult = { text: string; masked: { passport: number; card: number; iban: number } };

export function maskSensitive(text: string): MaskResult {
  const counts = { passport: 0, card: 0, iban: 0 };
  let out = text;

  // Pass-/Ausweisnummer: Schlüsselwort, danach (innerhalb weniger Zeichen) ein Token aus Buchstaben/Ziffern mit mindestens einer Ziffer.
  const passRe = new RegExp(`((?:${PASS_KEYWORDS})\\s*[:#.\\-]?\\s*(?:\\(?[A-Za-zÄÖÜäöü ]{0,12}\\)?\\s*[:#.\\-]?\\s*)?)([A-Z0-9]{6,12})(?![A-Z0-9])`, "gi");
  out = out.replace(passRe, (all, head: string, num: string) => {
    if (!/\d/.test(num)) return all;
    counts.passport++;
    return `${head}[Nummer maskiert]`;
  });

  // IBAN
  out = out.replace(/\b([A-Z]{2}\d{2})((?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4})\b/g, (all, head: string, rest: string) => {
    const compact = (head + rest).replace(/\s+/g, "");
    if (compact.length < 15 || compact.length > 34 || !/^[A-Z]{2}\d{2}/.test(compact)) return all;
    counts.iban++;
    return `${head} **** **** ${compact.slice(-4)}`;
  });

  // Kartennummern: 15–19 Ziffern (mit Leerzeichen/Bindestrichen gruppiert), Luhn-Prüfsumme, nicht nach «Ticket».
  out = out.replace(/(?<![\d])(\d[ -]?){14,18}\d(?![\d])/g, (all, _g: string, offset: number, whole: string) => {
    const digits = all.replace(/[ -]/g, "");
    if (digits.length < 15 || digits.length > 19) return all;
    const before = whole.slice(Math.max(0, offset - 24), offset).toLowerCase();
    if (/(ticket|e-?ticket|tkt|ticketnummer|billet|eticket|belegnummer|rechnung|invoice|order)/.test(before)) return all;
    if (!luhn(digits)) return all;
    counts.card++;
    return `**** **** **** ${digits.slice(-4)}`;
  });

  return { text: out, masked: counts };
}
