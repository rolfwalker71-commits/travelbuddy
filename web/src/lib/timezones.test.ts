import { describe, expect, it } from "vitest";
import {
  airportZone,
  cityOf,
  durationMinutes,
  effectiveZone,
  offsetLabel,
  offsetMinutes,
  suggestZones,
  timeWithZone,
  zonedToUtc,
} from "./timezones";

describe("Zeitzonen", () => {
  it("rechnet Ortszeit mit Sommerzeit nach UTC", () => {
    // 25.10.2026: Europa wechselt um 03:00 auf Winterzeit; 12:20 ist bereits MEZ (UTC+1)
    expect(zonedToUtc("2026-10-25", "12:20", "Europe/Zurich")?.toISOString()).toBe("2026-10-25T11:20:00.000Z");
    expect(zonedToUtc("2026-10-23", "12:20", "Europe/Zurich")?.toISOString()).toBe("2026-10-23T10:20:00.000Z");
    expect(zonedToUtc("2026-07-01", "12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });
  it("Versatz und Beschriftung", () => {
    expect(offsetMinutes("Europe/Zurich", new Date("2026-07-01T12:00:00Z"))).toBe(120);
    expect(offsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("UTC−05:00");
  });
  it("berechnet die Flugdauer über Zonen hinweg", () => {
    // MIA 16:50 (New York, UTC−5) → LIS 06:00 (+1, Lissabon, UTC+0): 8 h 10 min
    const d = durationMinutes(
      { date: "2026-11-14", time: "16:50", tz: "America/New_York" },
      { date: "2026-11-15", time: "06:00", tz: "Europe/Lisbon" }
    );
    expect(d).toBe(8 * 60 + 10);
    expect(durationMinutes({ date: null, time: "10:00", tz: "UTC" }, { date: "2026-11-15", time: "06:00", tz: "UTC" })).toBeNull();
  });
  it("nennt die Zone nur, wenn sie von der Reisezone abweicht", () => {
    expect(timeWithZone("14:05", "America/New_York", "Europe/Zurich")).toBe("14:05 Ortszeit New York");
    expect(timeWithZone("14:05", "Europe/Zurich", "Europe/Zurich")).toBe("14:05");
    expect(timeWithZone("14:05", null, "Europe/Zurich")).toBe("14:05");
    expect(cityOf("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
  it("belegt die Zone aus Flughafen vor und fällt auf die Reisezone zurück", () => {
    expect(airportZone("mia")).toBe("America/New_York");
    expect(suggestZones("Flug", { departureAirport: "ZRH", arrivalAirport: "MIA" }, "Europe/Zurich")).toEqual({
      startTz: null,
      endTz: "America/New_York",
    });
    expect(suggestZones("Hotel", {}, "Europe/Zurich")).toEqual({ startTz: null, endTz: null });
    expect(effectiveZone(null, "Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(effectiveZone("Kaputt/Zone", "Europe/Lisbon")).toBe("Europe/Lisbon");
  });
});
