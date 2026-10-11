import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatDate,
  formatDateRange,
  formatDayHeading,
  formatTimestamp,
  isValidIsoDate,
  parseClock,
  parseDisplayDate,
  relativeDays,
  todayIso,
  weekday,
} from "./dates";

describe("Datumsformat", () => {
  it("formatiert dd.mm.yyyy", () => {
    expect(formatDate("2026-10-06")).toBe("06.10.2026");
    expect(formatDate(null)).toBe("–");
    expect(formatDate("")).toBe("–");
  });
  it("liest Eingaben", () => {
    expect(parseDisplayDate("06.10.2026")).toBe("2026-10-06");
    expect(parseDisplayDate("6.10.2026")).toBe("2026-10-06");
    expect(parseDisplayDate("6.1.26")).toBe("2026-01-06");
    expect(parseDisplayDate(" 29.02.2028 ")).toBe("2028-02-29");
    expect(parseDisplayDate("29.02.2027")).toBeNull();
    expect(parseDisplayDate("31.04.2026")).toBeNull();
    expect(parseDisplayDate("2026-10-06")).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
  });
  it("prüft ISO-Daten kalendarisch", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
  });
  it("nennt Wochentage und Tagesüberschriften", () => {
    expect(weekday("2026-10-06")).toBe("Dienstag");
    expect(formatDayHeading("2026-10-06")).toBe("Dienstag, 06.10.2026");
    expect(formatDayHeading(null)).toBe("Ohne Datum");
  });
  it("bildet Zeiträume", () => {
    expect(formatDateRange("2026-10-06", "2026-10-13")).toBe("06.10.2026 – 13.10.2026");
    expect(formatDateRange("2026-10-06", "2026-10-06")).toBe("06.10.2026");
    expect(formatDateRange("2026-10-06", null)).toBe("ab 06.10.2026");
    expect(formatDateRange(null, "2026-10-06")).toBe("bis 06.10.2026");
    expect(formatDateRange(null, null)).toBe("Ohne Datum");
  });
  it("rechnet Tage über Monats- und Jahreswechsel", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(relativeDays("2026-10-12", "2026-10-10")).toBe("in 2 Tagen");
    expect(relativeDays("2026-10-10", "2026-10-10")).toBe("heute");
    expect(relativeDays("2026-10-09", "2026-10-10")).toBe("gestern");
    expect(relativeDays("2026-10-07", "2026-10-10")).toBe("vor 3 Tagen");
  });
  it("nutzt lokales Datum für heute", () => {
    expect(todayIso(new Date(2026, 9, 6, 23, 59))).toBe("2026-10-06");
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
  it("zeigt Zeitstempel lokal als dd.mm.yyyy hh:mm", () => {
    const d = new Date(2026, 9, 6, 18, 30);
    expect(formatTimestamp(d.toISOString())).toBe("06.10.2026 18:30");
    expect(formatTimestamp(null)).toBe("–");
  });
  it("liest Uhrzeiten", () => {
    expect(parseClock("9:30")).toBe("09:30");
    expect(parseClock("09.30")).toBe("09:30");
    expect(parseClock("0930")).toBe("09:30");
    expect(parseClock("930")).toBe("09:30");
    expect(parseClock("23:59")).toBe("23:59");
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("12:60")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
});

import { formatAxisDate, formatDateWithWeekday, formatYearSpan, formatDate as fd } from "./dates";

describe("Datumsanzeige (vollständig, nie verkürzt)", () => {
  it("zeigt immer dd.mm.yyyy", () => {
    expect(fd("2026-10-23")).toBe("23.10.2026");
    expect(formatDateWithWeekday("2026-10-11")).toBe("So 11.10.2026");
    expect(formatDateWithWeekday("2026-10-25")).toBe("So 25.10.2026");
  });
  it("Achsendatum nur Tag.Monat, Jahr kommt aus dem Titel", () => {
    expect(formatAxisDate("2026-10-23")).toBe("23.10.");
    expect(formatAxisDate("kaputt")).toBe("");
    expect(formatYearSpan("2026-12-28", "2027-01-05")).toBe("2026/2027");
    expect(formatYearSpan("2026-10-23", "2026-11-20")).toBe("2026");
  });
});

import { addDaysIso } from "./dates";
describe("addDaysIso", () => {
  it("verschiebt über Monats- und Jahresgrenzen", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});
