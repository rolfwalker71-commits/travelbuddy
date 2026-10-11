import { currencyExponent } from "./money";

/** Von der EZB (Frankfurter) mit Referenzkursen geführte Währungen, deutsche Bezeichnungen. */
const NAMES: Array<[string, string]> = [
  ["CHF", "Schweizer Franken"],
  ["EUR", "Euro"],
  ["USD", "US-Dollar"],
  ["GBP", "Britisches Pfund"],
  ["AUD", "Australischer Dollar"],
  ["BGN", "Bulgarischer Lew"],
  ["BRL", "Brasilianischer Real"],
  ["CAD", "Kanadischer Dollar"],
  ["CNY", "Renminbi Yuan"],
  ["CZK", "Tschechische Krone"],
  ["DKK", "Dänische Krone"],
  ["HKD", "Hongkong-Dollar"],
  ["HUF", "Ungarischer Forint"],
  ["IDR", "Indonesische Rupiah"],
  ["ILS", "Israelischer Schekel"],
  ["INR", "Indische Rupie"],
  ["ISK", "Isländische Krone"],
  ["JPY", "Japanischer Yen"],
  ["KRW", "Südkoreanischer Won"],
  ["MXN", "Mexikanischer Peso"],
  ["MYR", "Malaysischer Ringgit"],
  ["NOK", "Norwegische Krone"],
  ["NZD", "Neuseeland-Dollar"],
  ["PHP", "Philippinischer Peso"],
  ["PLN", "Polnischer Zloty"],
  ["RON", "Rumänischer Leu"],
  ["SEK", "Schwedische Krone"],
  ["SGD", "Singapur-Dollar"],
  ["THB", "Thailändischer Baht"],
  ["TRY", "Türkische Lira"],
  ["ZAR", "Südafrikanischer Rand"],
];

export const CURRENCIES = NAMES.map(([code, name]) => ({ code, name, exponent: currencyExponent(code) }));
