import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { mapApiError, normalizeField } from "./fieldErrors";

const spec = {
  title: { key: "title", label: "Titel" },
  startDate: { key: "start", label: "Beginn" },
  "members.displayName": { key: "members", label: "Teilnehmer" },
  split: { key: "split", label: "Aufteilung" },
};

const err = (fields: { field: string; message: string }[], code = "validation_failed", message = "Ungültige Eingabe") =>
  new ApiError(422, code, message, fields);

describe("mapApiError", () => {
  it("normalisiert Array-Indizes", () => {
    expect(normalizeField("members.2.displayName")).toBe("members.displayName");
    expect(normalizeField("title")).toBe("title");
  });
  it("ordnet ein Feld dem Formularfeld zu", () => {
    const r = mapApiError(err([{ field: "title", message: "fehlt" }]), spec);
    expect(r.fields).toEqual({ title: "Titel fehlt" });
    expect(r.form).toBeNull();
  });
  it("findet verschachtelte Pfade über Präfixe", () => {
    const r = mapApiError(err([{ field: "split.amounts.1.amountBaseMinor", message: "ist ungültig" }]), spec);
    expect(r.fields.split).toBe("Aufteilung ist ungültig");
  });
  it("sammelt unbekannte Felder im Banner", () => {
    const r = mapApiError(
      err([
        { field: "title", message: "ist zu lang (höchstens 200 Zeichen)" },
        { field: "irgendwas", message: "fehlt" },
      ]),
      spec
    );
    expect(r.fields.title).toBe("Titel ist zu lang (höchstens 200 Zeichen)");
    expect(r.form).toContain("«irgendwas» fehlt");
  });
  it("weist Fehlercodes ohne Feldliste zu", () => {
    const e = new ApiError(422, "split_sum_mismatch", "Aufteilung summiert sich nicht zum Gesamtbetrag");
    const r = mapApiError(e, spec, { split_sum_mismatch: "split" });
    expect(r.fields.split).toBe("Aufteilung summiert sich nicht zum Gesamtbetrag");
    expect(r.form).toBeNull();
  });
  it("zeigt andere Fehler im Banner", () => {
    expect(mapApiError(new ApiError(409, "archived", "Die Abrechnung ist archiviert"), spec).form).toBe(
      "Die Abrechnung ist archiviert"
    );
    expect(mapApiError(new Error("Netz weg"), spec).form).toBe("Netz weg");
  });
  it("fasst mehrere Feldfehler mit Hinweis zusammen", () => {
    const r = mapApiError(
      err([
        { field: "title", message: "fehlt" },
        { field: "startDate", message: "hat ein ungültiges Format" },
      ]),
      spec
    );
    expect(Object.keys(r.fields)).toEqual(["title", "start"]);
    expect(r.form).toBe("Bitte die markierten Felder prüfen.");
  });
});
