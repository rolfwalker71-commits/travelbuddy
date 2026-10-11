/** Werte aus Dokumenten normalisieren: Datum, Zeit, Beträge, Auswahlwerte (mit Synonymen), Codes. */
import type { FieldDef } from "../catalog/catalog";

export const foldText = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u00df/g, "ss")
    .toLowerCase();

/** Nur Buchstaben und Ziffern, gross: für Vergleiche von Nummern («LX 1952» = «lx1952»). */
export const compact = (s: string): string => foldText(s).replace(/[^a-z0-9]/g, "").toUpperCase();

const MONTHS: Record<string, number> = {
  januar: 1, jan: 1, january: 1, janvier: 1, gennaio: 1, enero: 1,
  februar: 2, feb: 2, february: 2, fevrier: 2, febbraio: 2, febrero: 2,
  maerz: 3, marz: 3, mar: 3, march: 3, mars: 3, marzo: 3, mrz: 3,
  april: 4, apr: 4, avril: 4, aprile: 4, abril: 4,
  mai: 5, may: 5, maggio: 5, mayo: 5,
  juni: 6, jun: 6, june: 6, juin: 6, giugno: 6, junio: 6,
  juli: 7, jul: 7, july: 7, juillet: 7, luglio: 7, julio: 7,
  august: 8, aug: 8, aout: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, septembre: 9, settembre: 9, septiembre: 9,
  oktober: 10, okt: 10, oct: 10, october: 10, octobre: 10, ottobre: 10, octubre: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11,
  dezember: 12, dez: 12, dec: 12, december: 12, decembre: 12, dicembre: 12, diciembre: 12,
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function normDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isRealDate(+m[1]!, +m[2]!, +m[3]!) ? `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}` : null;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return isRealDate(+m[3]!, +m[2]!, +m[1]!) ? `${m[3]}-${pad(+m[2]!)}-${pad(+m[1]!)}` : null;
  m = /^(\d{1,2})\.?\s+([A-Za-zÄÖÜäöüéû]+)\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[foldText(m[2]!)];
    return mon && isRealDate(+m[3]!, mon, +m[1]!) ? `${m[3]}-${pad(mon)}-${pad(+m[1]!)}` : null;
  }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[foldText(m[1]!)];
    return mon && isRealDate(+m[3]!, mon, +m[2]!) ? `${m[3]}-${pad(mon)}-${pad(+m[2]!)}` : null;
  }
  return null;
}

export function normTime(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m = /^(\d{1,2})\s*[:.h]\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*(am|pm|uhr|h)?$/.exec(s);
  if (!m) {
    const m4 = /^(\d{2})(\d{2})\s*(uhr|h)?$/.exec(s);
    if (m4) m = m4 as unknown as RegExpExecArray;
  }
  if (!m) return null;
  let h = +m[1]!;
  const min = +m[2]!;
  const suffix = m[3];
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function normInt(raw: string): number | null {
  const m = /-?\d[\d'’ ]*/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[0].replace(/['’ ]/g, ""));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function normBool(raw: string): boolean | null {
  const s = foldText(raw.trim());
  if (["true", "ja", "yes", "1", "oui", "si", "wahr"].includes(s)) return true;
  if (["false", "nein", "no", "0", "non", "falsch"].includes(s)) return false;
  return null;
}

export function normIata(raw: string): string | null {
  const s = raw.trim();
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  const m = /\b([A-Z]{3})\b/.exec(s);
  return m ? m[1]! : null;
}

/** «lx1952», «LX 0952» → «LX 1952»; null, wenn das Muster nicht passt. */
export function normFlightNumber(raw: string): string | null {
  const m = /^([A-Za-z0-9]{2})\s*-?\s*0*(\d{1,4})([A-Za-z]?)$/.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()} ${m[2]}${m[3]!.toUpperCase()}`;
}

const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/€|\beur(?:o|os)?\b/i, "EUR"],
  [/\bchf\b|\bfr\.|\bsfr\b|\bfranken\b/i, "CHF"],
  [/\bUS\$|\busd\b|\$/i, "USD"],
  [/£|\bgbp\b/i, "GBP"],
  [/¥|\bjpy\b/i, "JPY"],
];

export function currencyOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  const m = /\b([A-Z]{3})\b/.exec(s);
  if (m && /^(CHF|EUR|USD|GBP|JPY|SEK|NOK|DKK|PLN|CZK|HUF|CAD|AUD|NZD|TRY|AED|THB|MXN|BRL|ZAR|CNY|INR|ISK|HRK|RON|BGN)$/.test(m[1]!)) return m[1]!;
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(s)) return code;
  return null;
}

/** Betrag → Minor Units (2 Dezimalstellen), ohne Gleitkommarechnung. Erkennt «1’234.50», «1.234,50», «1,234.50», «1234,5». */
export function parseAmountMinor(raw: string): number | null {
  const stripped = raw.replace(/[A-Za-zÄÖÜäöü$€£¥]+\.?/g, " ").replace(/[^\d.,'’\- ]/g, "").trim();
  const neg = /^-/.test(stripped);
  const body = stripped.replace(/^-/, "").replace(/[ '’]/g, "");
  if (!/\d/.test(body)) return null;
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let intPart: string;
  let frac = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    intPart = body.slice(0, dec).replace(/[.,]/g, "");
    frac = body.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = body.split(sep);
    const last = parts[parts.length - 1]!;
    const multiple = parts.length > 2;
    // «1.234» (genau 3 Stellen nach dem einzigen Trenner, 1–3 Stellen davor) gilt als Tausendertrennung.
    if (multiple || (last.length === 3 && parts[0]!.length <= 3 && !parts[0]!.startsWith("0"))) {
      intPart = parts.join("");
    } else {
      intPart = parts.slice(0, -1).join("");
      frac = last;
    }
  } else {
    intPart = body;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const major = intPart === "" ? 0 : Number(intPart);
  const cents = Number((frac + "00").slice(0, 2));
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  const minor = major * 100 + cents + roundUp;
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

/* ───────────── Auswahlwerte ───────────── */

type Synonyms = Array<[option: string, re: RegExp]>;

const SYNONYMS: Record<string, Synonyms> = {
  cabinClass: [
    ["Premium Economy", /premium|comfort/],
    ["Business", /business|\bclub\b|\bj\b/],
    ["First", /first|erste klasse|1\.?\s*kl|klasse 1|1st|\bf\b/],
    ["Economy", /eco|touristen|coach|2\.?\s*kl|zweite|second|2nd|klasse 2|standard|\by\b/],
  ],
  board: [
    ["Halbpension", /halbpension|half.?board|demi.?pension|\bhp\b|mezza pensione/],
    ["Vollpension", /vollpension|full.?board|pension complete|\bvp\b|\bfb\b/],
    ["All inclusive", /all.?inclusive|\bai\b/],
    ["Fruehstueck", /fruehstueck|breakfast|b&b|\bbb\b|petit.?dejeuner|colazione|desayuno/],
    ["Ohne", /^ohne|nur uebernachtung|room only|no meal|keine verpflegung|logis|accommodation only|sans repas|\bro\b/],
  ],
  transmission: [
    ["Automat", /auto/],
    ["Schaltung", /manual|schalt|manuell|stick/],
  ],
  transferKind: [
    ["Faehre", /faehre|ferry|boat|boot/],
    ["Taxi", /taxi|\bcab\b/],
    ["Shuttle", /shuttle|minibus|\bvan\b/],
    ["Bus", /\bbus\b|coach|autocar/],
    ["Privat", /privat|private|chauffeur/],
  ],
  flightStatus: [
    ["gestrichen", /gestr|cancel|annul/],
    ["verspaetet", /versp|delay|late/],
    ["planmaessig", /planm|on.?time|scheduled|puenktlich|confirmed|bestaetigt/],
  ],
  entryKind: [
    ["Ausschiffung", /ausschiff|disembark|debark/],
    ["Einschiffung", /einschiff|embark|boarding/],
    ["Seetag", /seetag|sea day|at sea|auf see/],
    ["Hafen", /hafen|\bport\b|anlauf|call/],
    ["Reise", /reise|cruise|gesamt|booking|buchung/],
  ],
  applicationStatus: [
    ["abgelehnt", /abgelehnt|denied|reject|refus/],
    ["genehmigt", /genehmigt|approved|authori|granted|erteilt/],
    ["beantragt", /beantragt|applied|submitted|pending|bearbeitung|eingereicht/],
    ["offen", /offen|open|not yet/],
  ],
  paymentStatus: [
    ["onsite", /vor ort|on.?site|at (the )?(property|hotel|desk|counter)|bei ankunft|on arrival|at arrival|bei abholung/],
    ["deposit", /anzahlung|deposit|teilzahlung|partial/],
    ["open", /offen|\bopen\b|unpaid|ausstehend|\bdue\b|zu bezahlen|unbezahlt|nicht bezahlt/],
    ["paid", /bezahlt|\bpaid\b|beglichen|settled|\bpaye\b|pagado/],
  ],
};

/** Auf eine Option des Katalogs abbilden (exakt, Beschriftung, Synonym); sonst null. */
export function normSelect(def: Pick<FieldDef, "key" | "options" | "optionLabels">, raw: string, keyOverride?: string): string | null {
  const opts = Array.isArray(def.options) ? def.options : null;
  if (!opts) return raw.trim() || null;
  const s = raw.trim();
  if (opts.includes(s)) return s;
  const f = foldText(s);
  for (const o of opts) if (foldText(o) === f) return o;
  const labels = def.optionLabels ?? [];
  for (let i = 0; i < opts.length; i++) if (labels[i] && foldText(labels[i]!) === f) return opts[i]!;
  const syn = SYNONYMS[keyOverride ?? def.key];
  if (syn) {
    for (const [option, re] of syn) if (opts.includes(option) && re.test(f)) return option;
  }
  return null;
}
