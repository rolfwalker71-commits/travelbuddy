import { describe, expect, it } from "vitest";
import shared from "../../../shared/event-types.json";
import bundled from "../data/event-types.json";
import {
  BUNDLED_CATALOG,
  buildFormSections,
  emptyValues,
  eventToValues,
  getType,
  hiddenFieldCount,
  parseCatalog,
  resolveTypeId,
  valuesToInput,
  validateField,
  type FormValues,
} from "./catalog";
import { ev } from "./fixtures.test-helpers";

const C = BUNDLED_CATALOG;

describe("Katalog", () => {
  it("die gebündelte Kopie entspricht shared/event-types.json", () => {
    expect(bundled).toEqual(shared);
  });
  it("hat 13 Typen mit Farben aus dem Katalog", () => {
    expect(C.types).toHaveLength(13);
    for (const t of C.types) expect(C.colors).toContain(t.color);
  });
  it("löst Aliase und extends auf", () => {
    expect(resolveTypeId(C, "Mietwagen")).toBe("Mietauto");
    expect(resolveTypeId(C, "Flug")).toBe("Flug");
    const u = getType(C, "Unterkunft")!;
    expect(u.sections.map((s) => s.id)).toEqual(getType(C, "Hotel")!.sections.map((s) => s.id));
    expect(u.label).toBe("Ferienwohnung");
  });
  it("verwirft unbrauchbare Kataloge", () => {
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog({ commonFields: [], types: [] })).toBeNull();
    expect(parseCatalog({ commonFields: [{ key: "a", kind: "wild" }], types: [{ id: "x", label: "X" }] })).toBeNull();
    expect(parseCatalog(shared)).not.toBeNull();
  });
});

describe("Formularabschnitte", () => {
  it("«Wichtiges» zeigt nur wichtige Felder, «Alle» zeigt alles", () => {
    const imp = buildFormSections(C, "Flug", { mode: "important" });
    const all = buildFormSections(C, "Flug", { mode: "all" });
    const keys = (s: typeof imp) => s.flatMap((x) => x.fields.map((f) => f.field.key));
    expect(keys(imp)).toContain("flightNumber");
    expect(keys(imp)).toContain("departureGate");
    expect(keys(imp)).not.toContain("aircraftReg");
    expect(keys(all)).toContain("aircraftReg");
    expect(keys(all).length).toBeGreaterThan(keys(imp).length);
    expect(hiddenFieldCount(imp)).toBe(keys(all).length - keys(imp).length);
  });
  it("gefüllte Felder bleiben auch bei «Wichtiges» sichtbar", () => {
    const s = buildFormSections(C, "Flug", { mode: "important", filled: (_, k) => k === "aircraftReg" });
    expect(s.flatMap((x) => x.fields.map((f) => f.field.key))).toContain("aircraftReg");
  });
  it("ordnet Zeit und Ort zuerst, Buchung, Personen, Kosten, Notizen zuletzt", () => {
    const ids = buildFormSections(C, "Hotel", { mode: "all" }).map((s) => s.id);
    expect(ids[0]).toBe("zeit");
    expect(ids.slice(-4)).toEqual(["buchung", "personen", "kosten", "notizen"]);
    expect(ids).toContain("vorort");
  });
  it("beschriftet Zeitfelder mit startLabel/endLabel des Typs", () => {
    const sec = buildFormSections(C, "Flug", { mode: "all" })[0]!;
    const labels = Object.fromEntries(sec.fields.map((f) => [f.field.key, f.field.label]));
    expect(labels.startDate).toBe("Abflug");
    expect(labels.endTime).toBe("Ankunft · Uhrzeit");
  });
  it("Aufgaben haben kein Ende", () => {
    const keys = buildFormSections(C, "Aufgabe", { mode: "all" }).flatMap((s) => s.fields.map((f) => f.field.key));
    expect(keys).not.toContain("endDate");
    expect(keys).toContain("done");
  });
});

describe("Regeln: Pattern, Transform, Typen", () => {
  const flightNo = C.types.find((t) => t.id === "Flug")!.sections![0]!.fields.find((f) => f.key === "flightNumber")!;
  it("prüft das Pattern der Flugnummer", () => {
    expect(validateField(flightNo, "LX 1952")).toBeNull();
    expect(validateField(flightNo, "LX1952")).toBeNull();
    expect(validateField(flightNo, "Swiss 12")).not.toBeNull();
  });
  it("prüft Datum, Zeit, Zahl, Flughafen", () => {
    expect(validateField({ key: "d", label: "D", kind: "date" }, "2026-13-40")).not.toBeNull();
    expect(validateField({ key: "t", label: "T", kind: "time" }, "25:00")).not.toBeNull();
    expect(validateField({ key: "n", label: "N", kind: "number" }, "1.5")).not.toBeNull();
    expect(validateField({ key: "n", label: "N", kind: "number" }, "12")).toBeNull();
    expect(validateField({ key: "a", label: "A", kind: "airport" }, "ZRH")).toBeNull();
    expect(validateField({ key: "a", label: "A", kind: "airport" }, "Zürich")).not.toBeNull();
  });
  it("wendet upper auf die Buchungsreferenz an und liefert nur Katalogschlüssel", () => {
    const v = emptyValues("CHF");
    v.common.title = "Flug";
    v.common.bookingReference = "k7m2qx";
    v.details.flightNumber = "lx 1952";
    v.details.durationMinutes = "105";
    v.details.unbekannt = "x";
    v.details.passengers = [{ participantId: 5, values: { seat: "12C", ticketNumber: "" } }];
    const { input, errors } = valuesToInput(C, "Flug", v as FormValues);
    expect(errors).toEqual({});
    expect(input.bookingReference).toBe("K7M2QX");
    expect(input.details).toEqual({ flightNumber: "LX 1952", durationMinutes: 105, passengers: [{ participantId: 5, seat: "12C" }] });
  });
  it("meldet Fehler je Feld und rechnet Preise in Minor Units", () => {
    const v = emptyValues("EUR");
    v.common.title = "";
    v.common.startDate = "2026-10-25";
    v.common.endDate = "2026-10-24";
    v.common.priceMinor = "1’234.50";
    v.details.flightNumber = "!!";
    const { input, errors } = valuesToInput(C, "Flug", v);
    expect(errors["common.title"]).toBeDefined();
    expect(errors["common.endDate"]).toBeDefined();
    expect(errors["details.flightNumber"]).toBeDefined();
    expect(input.priceMinor).toBe(123450);
    expect(input.currency).toBe("EUR");
  });
  it("Rundreise: Ereignis → Werte → Eingabe", () => {
    const e = ev({
      type: "Hotel",
      title: "Negresco",
      startDate: "2026-10-23",
      endDate: "2026-10-25",
      priceMinor: 94000,
      currency: "EUR",
      paymentStatus: "paid",
      participantIds: [1, 2],
      details: { checkInFrom: "15:00", rooms: 2, board: "Fruehstueck", accessCode: "4471" },
    });
    const v = eventToValues(C, e, "CHF");
    expect(v.currency).toBe("EUR");
    expect(v.common.priceMinor).toBe("940.00");
    const { input, errors } = valuesToInput(C, "Hotel", v);
    expect(errors).toEqual({});
    expect(input.details).toEqual({ checkInFrom: "15:00", rooms: 2, board: "Fruehstueck", accessCode: "4471" });
    expect(input.participantIds).toEqual([1, 2]);
    expect(input.paymentStatus).toBe("paid");
  });
});
