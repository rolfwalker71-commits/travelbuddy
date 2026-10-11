import { describe, expect, it } from "vitest";
import { BUNDLED_CATALOG as C } from "./catalog";
import { detailSections, keyFacts, referenceOf, routeOf, seatFor, summaryLine } from "./eventUi";
import { formatDate } from "./dates";
import { formatMoney } from "./money";
import { ev } from "./fixtures.test-helpers";
import type { Traveler } from "../api/types";

const trav: Traveler[] = [
  { id: 11, displayName: "Rolf", email: null, userId: 1 },
  { id: 12, displayName: "Valentyna", email: null, userId: null },
];

const flight = ev({
  type: "Flug",
  title: "Flug",
  bookingReference: "K7M2QX",
  details: {
    airline: "Swiss",
    flightNumber: "LX 1952",
    departureAirport: "ZRH",
    arrivalAirport: "BCN",
    departureTerminal: "2",
    departureGate: "A24",
    boardingTime: "11:40",
    passengers: [
      { participantId: 11, seat: "12C" },
      { participantId: 12, seat: "12D" },
    ],
  },
});

describe("Wichtiges je Typ", () => {
  it("Flug: Terminal, Gate, Sitz des Angemeldeten", () => {
    const f = keyFacts(C, flight, { meId: 12, travelers: trav });
    expect(f.map((x) => [x.label, x.value])).toEqual([
      ["Terminal", "2"],
      ["Gate", "A24"],
      ["Sitz", "12D"],
      ["Boarding", "11:40"],
    ]);
    expect(seatFor(flight, 11)).toBe("12C");
  });
  it("Hotel: Adresse und Türcode gross, Mietauto: Abholort, Öffnungszeiten, Notfallnummer", () => {
    const hotel = ev({ type: "Hotel", address: "Carrer 1", details: { accessCode: "4471", checkInFrom: "15:00" } });
    const hf = keyFacts(C, hotel);
    expect(hf[0]).toMatchObject({ label: "Adresse", value: "Carrer 1", wide: true });
    expect(hf.find((x) => x.label === "Türcode")?.value).toBe("4471");
    const car = ev({ type: "Mietauto", details: { pickupPlace: "MIA", pickupHours: "05:00–24:00", emergencyPhone: "+1 800" } });
    expect(keyFacts(C, car).map((x) => x.label)).toEqual(["Abholort", "Öffnungszeiten", "Notfallnummer"]);
  });
  it("Kreuzfahrt: Kabine, Terminal, Alle an Bord", () => {
    const ship = ev({ type: "Kreuzfahrt", details: { cabin: "8142", terminal: "Port Nou", allAboard: "16:30" } });
    expect(keyFacts(C, ship).map((x) => x.value)).toEqual(["8142", "Port Nou", "16:30"]);
  });
  it("Alias wird wie der Typ behandelt", () => {
    const car = ev({ type: "Mietwagen", details: { pickupPlace: "MIA" } });
    expect(keyFacts(C, car)[0]!.label).toBe("Abholort");
  });
  it("Route, Referenz, Zusammenfassung", () => {
    expect(routeOf(flight)).toEqual({ from: "ZRH", to: "BCN" });
    expect(routeOf(ev({ type: "Hotel" }))).toBeNull();
    expect(referenceOf(flight)).toBe("K7M2QX");
    expect(referenceOf(ev({ type: "Flug", details: { flightNumber: "LX 1" } }))).toBe("LX 1");
    expect(summaryLine(C, flight)).toBe("Swiss · LX 1952 · ZRH · BCN");
  });
});

describe("Detailansicht", () => {
  it("zeigt nur ausgefüllte Felder, mit Beschriftungen und Datum dd.mm.yyyy", () => {
    const e = ev({
      type: "Hotel",
      title: "H",
      startDate: "2026-10-23",
      startTime: "15:00",
      endDate: "2026-10-25",
      priceMinor: 94000,
      currency: "EUR",
      paymentStatus: "deposit",
      cancelUntil: "2026-10-17",
      details: { board: "Fruehstueck", rooms: 2, accessCode: "4471" },
    });
    const s = detailSections(C, e, trav, formatMoney, formatDate);
    const flat = Object.fromEntries(s.flatMap((x) => x.rows.map((r) => [r.label, r.value])));
    expect(flat["Check-in"]).toBe("23.10.2026 · 15:00");
    expect(flat["Verpflegung"]).toBe("Frühstück");
    expect(flat["Zimmer"]).toBe("2");
    expect(flat["Preis"]).toMatch(/^EUR\s940\.00$/);
    expect(flat["Zahlung"]).toBe("Anzahlung");
    expect(flat["Kostenlos stornierbar bis"]).toBe("17.10.2026");
    expect(flat["Wer ist dabei"]).toBe("Alle");
    expect(flat["Wifi"]).toBeUndefined();
  });
});
