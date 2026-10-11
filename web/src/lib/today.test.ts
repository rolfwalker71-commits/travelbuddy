import { describe, expect, it } from "vitest";
import { buildDayBand, countdown, dayLabel, fmtDuration, fmtMin, liveSeconds, localMinutes, minutesOnDay, ringProgress, splitByNow } from "./today";
import { ev } from "./fixtures.test-helpers";

describe("Heute: Countdown und Ring", () => {
  it("formatiert den Countdown", () => {
    expect(countdown(null)).toBeNull();
    expect(countdown(40 * 60)).toMatchObject({ value: "40", unit: "Min." });
    expect(countdown(100 * 60)).toMatchObject({ value: "1:40", unit: "Std.", text: "in 1 Std. 40 Min." });
    expect(countdown(3 * 86400 + 100)).toMatchObject({ value: "3", unit: "Tage" });
    expect(countdown(0)?.past).toBe(true);
  });
  it("füllt den Ring je näher der Termin ist", () => {
    expect(ringProgress(null)).toBe(0);
    expect(ringProgress(6 * 3600)).toBe(0);
    expect(ringProgress(3 * 3600)).toBeCloseTo(0.5);
    expect(ringProgress(-5)).toBe(1);
  });
  it("zählt seit dem Abruf weiter", () => {
    const gen = "2026-10-11T10:00:00.000Z";
    expect(liveSeconds({ generatedAt: gen, nextInSeconds: 600 }, Date.parse(gen) + 120_000)).toBe(480);
    expect(liveSeconds({ generatedAt: gen, nextInSeconds: null }, Date.now())).toBeNull();
  });
  it("Tagesbeschriftung und Dauer", () => {
    expect(dayLabel({ dayIndex: 3, dayCount: 29 })).toBe("Tag 3 von 29");
    expect(dayLabel(null)).toBeNull();
    expect(fmtDuration(130)).toBe("2:10 Std.");
    expect(fmtDuration(45)).toBe("45 Min.");
    expect(fmtMin(75)).toBe("01:15");
  });
  it("Ortszeit in einer Zone", () => {
    expect(localMinutes("Europe/Zurich", Date.parse("2026-07-01T10:30:00Z"))).toBe(12 * 60 + 30);
  });
  it("trennt vergangene und kommende Ereignisse", () => {
    const a = ev({ id: 1, type: "Ausflug", startTime: "08:00", endTime: "09:00" });
    const b = ev({ id: 2, type: "Ausflug", startTime: "15:00" });
    const c = ev({ id: 3, type: "Hotel", startDate: "2026-10-23", endDate: "2026-10-25", startTime: "15:00", endTime: "12:00" });
    const { past, rest } = splitByNow([a, b, c], 12 * 60);
    expect(past.map((e) => e.id)).toEqual([1]);
    expect(rest.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("Tagesband", () => {
  const day = "2026-10-23";
  const flight = ev({
    id: 1,
    type: "Flug",
    title: "ZRH → BCN",
    startDate: day,
    startTime: "12:20",
    endDate: day,
    endTime: "14:05",
    startTz: "Europe/Zurich",
    endTz: "Europe/Madrid",
    details: { checkInOpens: "09:20", checkInCloses: "11:30", boardingTime: "11:40" },
  });
  const taxi = ev({ id: 2, type: "Transfer", title: "Taxi", startDate: day, startTime: "07:30", endTime: "08:00", startTz: "Europe/Zurich" });

  it("rechnet Zeiten in Reisezeit des Tages", () => {
    expect(minutesOnDay(day, "12:20", "Europe/Zurich", day, "Europe/Zurich")).toBe(740);
    // Madrid und Zürich haben dieselbe Zeit; New York 6 Stunden früher
    expect(minutesOnDay(day, "06:20", "America/New_York", day, "Europe/Zurich")).toBe(740);
  });
  it("zeigt Check-in, Boarding, Flug und Puffer", () => {
    const band = buildDayBand([taxi, flight], day, "Europe/Zurich", () => "var(--k-air)")!;
    const kinds = band.items.map((i) => [i.kind, i.from, i.to]);
    expect(kinds).toContainEqual(["checkin", 9 * 60 + 20, 11 * 60 + 30]);
    expect(kinds).toContainEqual(["boarding", 11 * 60 + 40, 12 * 60 + 20]);
    expect(band.items.find((i) => i.kind === "event" && i.label === "ZRH → BCN")).toBeDefined();
    const buffers = band.items.filter((i) => i.kind === "buffer");
    expect(buffers.length).toBeGreaterThan(0);
    expect(buffers[0]!.label).toMatch(/^Puffer/);
    expect(band.to - band.from).toBeGreaterThanOrEqual(360);
  });
  it("liefert null ohne Zeiten", () => {
    expect(buildDayBand([ev({ id: 9, type: "Aufgabe", startDate: day })], day, "Europe/Zurich", () => "x")).toBeNull();
  });
  it("Kreuzfahrt: «Alle an Bord» als Punkt", () => {
    const ship = ev({ id: 3, type: "Kreuzfahrt", startDate: day, startTime: "13:00", endTime: "17:00", details: { allAboard: "16:30" } });
    const band = buildDayBand([ship], day, "Europe/Zurich", () => "x")!;
    const p = band.items.find((i) => i.kind === "point")!;
    expect(p.from).toBe(16 * 60 + 30);
    expect(p.label).toBe("Alle an Bord");
  });
});
