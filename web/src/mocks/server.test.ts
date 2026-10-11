import { describe, expect, it } from "vitest";
import { MockServer, samplePdf } from "./server";

const U = (p: string) => new URL(p, "http://localhost");
const json = <T>(r: { json?: unknown } | null) => r!.json as T;

describe("Mock-Server (Vertrag)", () => {
  const today = "2026-10-11";
  it("liefert Heute mit aktiver Reise und Vorschlägen", async () => {
    const s = new MockServer(today);
    const r = json<{ trip: { dayIndex: number; dayCount: number }; review: number; ledger: { id: number }; events: unknown[] }>(
      await s.handle("GET", U("/v1/today?date=2026-10-11&tz=Europe/Zurich"), null, null)
    );
    expect(r.trip.dayIndex).toBe(3);
    expect(r.trip.dayCount).toBe(29);
    expect(r.review).toBe(2);
    expect(r.ledger.id).toBe(1);
    expect(r.events.length).toBeGreaterThan(0);
  });
  it("ohne Schlüssel antwortet die Karte mit 404 maps_not_configured", async () => {
    const s = new MockServer(today);
    const r = await s.handle("GET", U("/v1/maps/token"), null, null);
    expect(r?.status).toBe(404);
    expect((r?.json as { error: { code: string } }).error.code).toBe("maps_not_configured");
  });
  it("Upload → Analyse läuft → nach Abfragen fertig mit Vorschlag", async () => {
    const s = new MockServer(today);
    const form = new FormData();
    form.append("file", new File([samplePdf("x")], "Buchung.pdf", { type: "application/pdf" }));
    const up = await s.handle("POST", U("/v1/trips/1/documents"), null, form);
    expect(up?.status).toBe(202);
    const id = (up!.json as { document: { id: number; analysisStatus: string } }).document.id;
    let status = "processing";
    for (let i = 0; i < 4 && status === "processing"; i++) {
      status = json<{ document: { analysisStatus: string } }>(await s.handle("GET", U(`/v1/documents/${id}`), null, null)).document.analysisStatus;
    }
    expect(status).toBe("done");
    const trip = json<{ events: { sourceDocumentId: number | null; status: string }[] }>(await s.handle("GET", U("/v1/trips/1"), null, null));
    expect(trip.events.some((e) => e.sourceDocumentId === id && e.status === "proposed")).toBe(true);
  });
  it("Übernehmen, Zusammenführen, Sperren von Hand gesetzter Felder", async () => {
    const s = new MockServer(today);
    await s.handle("POST", U("/v1/trips/1/events/121/confirm"), null, null);
    const t1 = json<{ events: { id: number; status: string }[] }>(await s.handle("GET", U("/v1/trips/1"), null, null));
    expect(t1.events.find((e) => e.id === 121)!.status).toBe("confirmed");
    await s.handle("PATCH", U("/v1/trips/1/events/101"), { notes: "Koffer" }, null);
    const t2 = json<{ events: { id: number; fieldsMeta: Record<string, { locked?: boolean }> }[] }>(await s.handle("GET", U("/v1/trips/1"), null, null));
    expect(t2.events.find((e) => e.id === 101)!.fieldsMeta.notes?.locked).toBe(true);
    await s.handle("POST", U("/v1/trips/1/events/120/merge"), { intoEventId: 102 }, null);
    const t3 = json<{ events: { id: number }[] }>(await s.handle("GET", U("/v1/trips/1"), null, null));
    expect(t3.events.some((e) => e.id === 120)).toBe(false);
  });
  it("Reisekasse: Ausgabe verknüpft das Ereignis, Salden gehen auf null", async () => {
    const s = new MockServer(today);
    const r = json<{ expense: { id: number } }>(
      await s.handle("POST", U("/v1/ledgers/1/expenses"), { amountMinor: 10000, currency: "CHF", paidByMemberId: 11, tripEventId: 101, split: { mode: "equal" } }, null)
    );
    expect(r.expense.id).toBeGreaterThan(0);
    const ov = json<{ balances: { netMinor: number }[] }>(await s.handle("GET", U("/v1/ledgers/1"), null, null));
    expect(ov.balances.reduce((n, b) => n + b.netMinor, 0)).toBe(0);
    const t = json<{ events: { id: number; expenseId: number | null }[] }>(await s.handle("GET", U("/v1/trips/1"), null, null));
    expect(t.events.find((e) => e.id === 101)!.expenseId).toBe(r.expense.id);
  });
});
