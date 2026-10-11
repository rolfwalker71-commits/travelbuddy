// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "../api/types";
import { ev } from "../lib/fixtures.test-helpers";
import { PrintView, isPrintable } from "./TripPrint";

const data: TripDetail = {
  trip: { id: 1, title: "Testreise", destination: "Miami", startDate: "2026-11-19", endDate: "2026-11-24", homeCurrency: "CHF", timezone: "America/New_York" } as TripDetail["trip"],
  travelers: [{ id: 1, displayName: "Anna", email: null, userId: null }],
  events: [
    ev({ id: 1, type: "Flug", title: "Zürich → Miami", startDate: "2026-11-19", startTime: "08:30", bookingReference: "7KQ2XD", priceMinor: 123456, currency: "CHF", status: "confirmed", details: { departureGate: "A14", flightNumber: "BA123" } }),
    ev({ id: 2, type: "Hotel", title: "Hotel Brickell", startDate: "2026-11-19", status: "confirmed", details: { accessCode: "4711" } }),
    ev({ id: 3, type: "Ausflug", title: "Nur Vorschlag", startDate: "2026-11-20", status: "proposed" }),
    ev({ id: 4, type: "Ausflug", title: "Noch zu prüfen", startDate: "2026-11-20", status: "needs_review" }),
  ],
};

const render = (v: string) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/trips/1/print${v}`] }, createElement(PrintView, { data })));

describe("Druckansicht", () => {
  it("nimmt nur bestätigte Ereignisse", () => {
    expect(isPrintable(data.events[0]!)).toBe(true);
    expect(isPrintable(data.events[2]!)).toBe(false);
    expect(isPrintable(data.events[3]!)).toBe(false);
  });
  it("ausführlich: Preis, Codes, Referenz, ohne Vorschläge", () => {
    const html = render("");
    expect(html).toContain("Zürich → Miami");
    expect(html).toMatch(/CHF\s1\D234\.56/);
    expect(html).toContain("4711");
    expect(html).toContain("Buchungsreferenzen auf einen Blick");
    expect(html).not.toContain("Nur Vorschlag");
    expect(html).not.toContain("Noch zu prüfen");
  });
  it("kompakt: Tagesliste ohne Referenztabelle", () => {
    const html = render("?v=compact");
    expect(html).toContain("cmp");
    expect(html).not.toContain("Buchungsreferenzen auf einen Blick");
  });
});
