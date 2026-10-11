import { describe, expect, it } from "vitest";
import {
  convertMinorPreview,
  currencyExponent,
  formatMinor,
  formatMoney,
  formatRate,
  formatTotals,
  minorToInput,
  parseMinor,
  parseRate,
} from "./money";

const ok = (s: string, cur = "CHF", o = {}) => {
  const r = parseMinor(s, cur, o);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.minor;
};
const err = (s: string, cur = "CHF", o = {}) => {
  const r = parseMinor(s, cur, o);
  return r.ok ? null : r.error;
};

describe("currencyExponent", () => {
  it("kennt Währungen ohne Dezimalen", () => {
    for (const c of ["JPY", "krw", "ISK", "VND", "CLP", "UGX", "XAF", "XOF"]) expect(currencyExponent(c)).toBe(0);
    expect(currencyExponent("CHF")).toBe(2);
    expect(currencyExponent("eur")).toBe(2);
  });
});

describe("parseMinor", () => {
  it("liest Beträge exakt als Zeichenkette", () => {
    expect(ok("12")).toBe(1200);
    expect(ok("12.5")).toBe(1250);
    expect(ok("12.50")).toBe(1250);
    expect(ok("0.05")).toBe(5);
    expect(ok(".5")).toBe(50);
    expect(ok("12.")).toBe(1200);
    expect(ok("0.1")).toBe(10);
    expect(ok("19.99")).toBe(1999);
    expect(ok("1.15")).toBe(115); // Fliesskomma würde 114.99999… liefern
    expect(ok("8.2")).toBe(820);
  });
  it("akzeptiert Komma, Gruppierung und Leerraum", () => {
    expect(ok("12,5")).toBe(1250);
    expect(ok("1’234.50")).toBe(123450);
    expect(ok("1'234.50")).toBe(123450);
    expect(ok("1 234,50")).toBe(123450);
    expect(ok("1,234.50")).toBe(123450);
    expect(ok("1.234,50")).toBe(123450);
    expect(ok("1,234,567.89")).toBe(123456789);
    expect(ok("  7.00 ")).toBe(700);
  });
  it("lehnt Mehrdeutiges und Überlanges ab", () => {
    expect(err("1,234")).toMatch(/Mehrdeutig/);
    expect(err("1.234")).toMatch(/Mehrdeutig/);
    expect(err("12.345")).toMatch(/Mehrdeutig/);
    expect(err("12.3456")).toMatch(/Nachkommastellen/);
    expect(err("abc")).toBe("Ungültiger Betrag");
    expect(err("1.2.3")).toBe("Ungültiger Betrag");
    expect(err("12,34.56,7")).toBe("Ungültiger Betrag");
    expect(err("")).toBe("Betrag eingeben");
    expect(err("CHF 12")).toBe("Ungültiger Betrag");
    expect(err("1e5")).toBe("Ungültiger Betrag");
  });
  it("behandelt Null und Vorzeichen", () => {
    expect(err("0")).toMatch(/grösser als 0/);
    expect(ok("0", "CHF", { allowZero: true })).toBe(0);
    expect(err("-5")).toMatch(/negativ/);
    expect(ok("-5.5", "CHF", { allowNegative: true })).toBe(-550);
    expect(ok("−5.5", "CHF", { allowNegative: true })).toBe(-550);
  });
  it("kennt Währungen ohne Dezimalen", () => {
    expect(ok("1500", "JPY")).toBe(1500);
    expect(ok("1’500", "JPY")).toBe(1500);
    expect(ok("1,500", "JPY")).toBe(1500);
    expect(err("12.5", "JPY")).toMatch(/keine Nachkommastellen/);
    expect(ok("12.50")).toBe(1250);
  });
  it("schützt vor unsicheren Ganzzahlen", () => {
    expect(err("99999999999999999999")).toMatch(/zu gross/);
    expect(ok("9007199254740.99")).toBe(900719925474099);
    expect(err("90071992547409.92")).toMatch(/zu gross/);
  });
});

describe("formatMinor / formatMoney", () => {
  it("formatiert de-CH mit ’ und Punkt", () => {
    expect(formatMinor(123450, "CHF")).toBe("1’234.50");
    expect(formatMinor(5, "CHF")).toBe("0.05");
    expect(formatMinor(0, "CHF")).toBe("0.00");
    expect(formatMinor(100000000, "CHF")).toBe("1’000’000.00");
    expect(formatMinor(999, "CHF")).toBe("9.99");
    expect(formatMinor(1500, "JPY")).toBe("1’500");
    expect(formatMinor(-123450, "CHF")).toBe("−1’234.50");
    expect(formatMinor(5, "CHF", { sign: "always" })).toBe("+0.05");
  });
  it("setzt die Währung davor", () => {
    expect(formatMoney(123450, "chf")).toBe("CHF 1’234.50");
    expect(formatMoney(-1000, "EUR")).toBe("−EUR 10.00");
  });
  it("erzeugt Eingabefelder-Werte", () => {
    expect(minorToInput(123450, "CHF")).toBe("1234.50");
    expect(minorToInput(5, "CHF")).toBe("0.05");
    expect(minorToInput(1500, "JPY")).toBe("1500");
  });
  it("Runde Hin- und Rückkehr", () => {
    for (const m of [0, 1, 9, 10, 99, 100, 101, 123456789, 900719925474099]) {
      expect(ok(minorToInput(m, "CHF"), "CHF", { allowZero: true })).toBe(m);
      expect(ok(formatMinor(m, "CHF"), "CHF", { allowZero: true })).toBe(m);
    }
  });
});

describe("Wechselkurs", () => {
  it("parst Kurse", () => {
    expect(parseRate("0.9412")).toBe(0.9412);
    expect(parseRate("0,9412")).toBe(0.9412);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("x")).toBeNull();
    expect(formatRate(0.9412)).toBe("0.9412");
    expect(formatRate(1)).toBe("1");
  });
  it("rechnet Vorschau ganzzahlig, symmetrisch gerundet", () => {
    expect(convertMinorPreview(1000, "EUR", "CHF", 0.94)).toBe(940);
    expect(convertMinorPreview(1000, "CHF", "CHF", 0.5)).toBe(1000);
    expect(convertMinorPreview(1, "EUR", "CHF", 0.5)).toBe(1); // 0.5 → 1
    expect(convertMinorPreview(-1, "EUR", "CHF", 0.5)).toBe(-1);
  });
  it("berücksichtigt unterschiedliche Dezimalen", () => {
    // 1000 JPY (Minor = 1000) → CHF-Rappen: 1000 × 0.0058 CHF = 5.80 CHF = 580 Rappen
    expect(convertMinorPreview(1000, "JPY", "CHF", 0.0058)).toBe(580);
    // 5.80 CHF (580 Rappen) → JPY: 580 / 100 × 172.4 = 999.92 → 1000
    expect(convertMinorPreview(580, "CHF", "JPY", 172.4)).toBe(1000);
  });
});

describe("formatTotals", () => {
  it("ordnet CHF zuerst und ignoriert Nullen", () => {
    expect(formatTotals({ EUR: 500, CHF: 123450, USD: 0 })).toBe("CHF 1’234.50 · EUR 5.00");
    expect(formatTotals({})).toBe("–");
  });
});

import { formatInt } from "./money";
it("formatInt: Tausenderapostroph unabhängig von ICU", () => {
  expect(formatInt(1234)).toBe("1’234");
  expect(formatInt(1234567)).toBe("1’234’567");
  expect(formatInt(12)).toBe("12");
  expect(formatInt(-1500)).toBe("−1’500");
});
