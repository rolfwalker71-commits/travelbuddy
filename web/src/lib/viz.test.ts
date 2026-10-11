import { describe, expect, it } from "vitest";
import type { Balance, Expense } from "../api/types";
import { ev } from "./fixtures.test-helpers";
import {
  balanceBars,
  buildRoute,
  buildTimeBand,
  costsByCategory,
  costsByDay,
  countryOfAddress,
  haversineKm,
  projectRoute,
  settlementArrows,
  tripNumbers,
} from "./viz";
import { tripSpan } from "./plan";

const flight = ev({
  id: 1,
  type: "Flug",
  title: "ZRH → BCN",
  startDate: "2026-10-23",
  startTime: "12:20",
  endTime: "14:05",
  details: { durationMinutes: 105 },
  places: [
    { role: "start", label: "ZRH", address: null, lat: 47.4647, lon: 8.5492 },
    { role: "end", label: "BCN", address: "Aeropuerto, Barcelona, Spanien", lat: 41.2974, lon: 2.0833 },
  ],
});
const hotel = ev({ id: 2, type: "Hotel", title: "Negresco", startDate: "2026-10-23", endDate: "2026-10-25", address: "Carrer 1, Barcelona, Spanien", lat: 41.4, lon: 2.2 });
const port1 = ev({ id: 3, type: "Kreuzfahrt", title: "Palma", startDate: "2026-10-26", endDate: "2026-10-26", lat: 39.57, lon: 2.65, details: { entryKind: "Hafen" } });
const port2 = ev({ id: 4, type: "Kreuzfahrt", title: "Málaga", startDate: "2026-10-27", endDate: "2026-10-27", lat: 36.72, lon: -4.42, details: { entryKind: "Hafen" } });

describe("Routenbogen", () => {
  it("baut Stationen und Strecken in Reihenfolge", () => {
    const r = buildRoute([port2, flight, hotel, port1]);
    expect(r.stops.map((s) => s.label)).toEqual(["ZRH", "BCN", "Negresco", "Palma", "Málaga"]);
    const kinds = r.legs.map((l) => l.kind);
    expect(kinds).toEqual(["air", "ship"]);
  });
  it("projiziert in die Fläche und liefert Bögen", () => {
    const p = projectRoute(buildRoute([flight, hotel, port1, port2]), 630, 232, 36);
    expect(p.stops.length).toBe(5);
    for (const s of p.stops) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(630);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(232);
    }
    expect(p.legs[0]!.d).toMatch(/^M[\d.]+ [\d.]+ Q/);
    // Norden liegt oben: ZRH (47° N) hat kleineres y als Málaga (36° N)
    expect(p.stops[0]!.y).toBeLessThan(p.stops[4]!.y);
  });
  it("Distanz Zürich–Barcelona rund 860 km", () => {
    const km = haversineKm({ lat: 47.4647, lon: 8.5492 }, { lat: 41.2974, lon: 2.0833 });
    expect(km).toBeGreaterThan(830);
    expect(km).toBeLessThan(890);
  });
  it("lässt Vorschläge aus", () => {
    expect(buildRoute([{ ...flight, status: "proposed" }]).stops).toHaveLength(0);
  });
});

describe("Zeitband und Zahlen", () => {
  const span = tripSpan({ startDate: "2026-10-23", endDate: "2026-10-29" }, []);
  it("Spuren und heute", () => {
    expect(span?.days).toBe(7);
    const b = buildTimeBand([flight, hotel, port1, port2], span, "2026-10-25");
    expect(b.lanes).toEqual(["away", "ship", "stay"]);
    expect(b.todayIndex).toBe(2);
    const ship = b.segments.filter((s) => s.lane === "ship");
    expect(ship).toHaveLength(1); // Palma und Málaga schliessen aneinander an
    expect(ship[0]).toMatchObject({ from: 3, to: 4 });
    expect(buildTimeBand([], null, null).days).toEqual([]);
  });
  it("Reise in Zahlen", () => {
    const n = tripNumbers([flight, hotel, port1, port2], span);
    expect(n.days).toBe(7);
    expect(n.nights).toBe(2);
    expect(n.ports).toBe(2);
    expect(n.flightMinutes).toBe(105);
    expect(n.travelKm).toBeGreaterThan(600);
    expect(n.countries).toBe(1);
    expect(countryOfAddress("Carrer 1, 08018 Barcelona, Spanien")).toBe("Spanien");
    expect(countryOfAddress("Spanien")).toBe("Spanien");
    expect(countryOfAddress("Carrer 1")).toBeNull();
    expect(countryOfAddress("Bahnhofstr. 1, 8001")).toBeNull();
  });
});

const exp = (p: Partial<Expense>): Expense =>
  ({ id: 1, direction: "expense", amountBaseMinor: 1000, category: null, expenseDate: "2026-10-23", ...p }) as Expense;

describe("Kasse", () => {
  it("fasst Kategorien zusammen, grösste zuerst, Rest als «Weitere»", () => {
    const list = [
      exp({ category: "Flug", amountBaseMinor: 6000 }),
      exp({ category: "Essen", amountBaseMinor: 3000 }),
      exp({ category: "Essen", amountBaseMinor: 1000 }),
      exp({ category: null, amountBaseMinor: 500 }),
      exp({ category: "A", amountBaseMinor: 100 }),
      exp({ category: "B", amountBaseMinor: 90 }),
      exp({ category: "C", amountBaseMinor: 80 }),
      exp({ direction: "income", category: "Flug", amountBaseMinor: 99999 }),
    ];
    const s = costsByCategory(list, 4);
    expect(s.map((x) => x.label)).toEqual(["Flug", "Essen", "Ohne Kategorie", "Weitere"]);
    expect(s[0]!.minor).toBe(6000);
    expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
    expect(s[3]!.minor).toBe(270);
  });
  it("Tage aufsteigend, ohne Datum entfällt", () => {
    const d = costsByDay([exp({ expenseDate: "2026-10-25", amountBaseMinor: 5 }), exp({ expenseDate: "2026-10-23", amountBaseMinor: 7 }), exp({ expenseDate: null })]);
    expect(d.map((x) => x.date)).toEqual(["2026-10-23", "2026-10-25"]);
  });
  it("Salden um die Mittelachse und Ausgleichspfeile", () => {
    const b = [
      { memberId: 1, displayName: "A", netMinor: 1000 },
      { memberId: 2, displayName: "B", netMinor: -250 },
      { memberId: 3, displayName: "C", netMinor: 0 },
    ] as Balance[];
    const bars = balanceBars(b, 100);
    expect(bars[0]).toMatchObject({ side: "pos", x: 0, w: 100 });
    expect(bars[1]).toMatchObject({ side: "neg", x: -25, w: 25 });
    expect(bars[2]!.side).toBe("zero");
    const t = settlementArrows([
      { fromMemberId: 1, fromName: "A", toMemberId: 2, toName: "B", amountMinor: 5 },
      { fromMemberId: 3, fromName: "C", toMemberId: 2, toName: "B", amountMinor: 50 },
    ]);
    expect(t[0]!.amountMinor).toBe(50);
  });
});
