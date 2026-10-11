import { describe, expect, it } from "vitest";
import type { Balance, Expense } from "../api/types";
import {
  allSettled,
  balanceLabel,
  balanceTone,
  capToCreditorNet,
  groupByDate,
  inviteUrl,
  prioritizeMine,
  shareOf,
  tripShareUrl,
} from "./ledger";

const bal = (netMinor: number): Balance => ({
  memberId: 1,
  displayName: "A",
  paidMinor: 0,
  owedMinor: 0,
  settlementsPaidMinor: 0,
  settlementsReceivedMinor: 0,
  netMinor,
});

describe("ledger helpers", () => {
  it("gruppiert nach Datum, neueste zuerst", () => {
    const g = groupByDate([
      { expenseDate: "2026-10-01", createdAt: "2026-10-05T10:00:00Z", id: 1 },
      { expenseDate: null, createdAt: "2026-10-03T10:00:00Z", id: 2 },
      { expenseDate: "2026-10-01", createdAt: "2026-10-06T10:00:00Z", id: 3 },
    ]);
    expect(g.map((x) => x.date)).toEqual(["2026-10-03", "2026-10-01"]);
    expect(g[1]!.items.map((i) => i.id)).toEqual([1, 3]);
  });
  it("erkennt ausgeglichene Abrechnungen", () => {
    expect(allSettled([bal(0), bal(0)])).toBe(true);
    expect(allSettled([bal(0), bal(1)])).toBe(false);
    expect(allSettled([])).toBe(true);
  });
  it("begrenzt Vorschläge auf den Saldo des Empfängers", () => {
    expect(capToCreditorNet(5000, 3000)).toEqual({ amountMinor: 3000, capped: true, creditorNetMinor: 3000 });
    expect(capToCreditorNet(2000, 3000)).toEqual({ amountMinor: 2000, capped: false, creditorNetMinor: 3000 });
    expect(capToCreditorNet(2000, -50)).toEqual({ amountMinor: 0, capped: true, creditorNetMinor: 0 });
  });
  it("beschriftet Salden mit Text, nicht nur Farbe", () => {
    expect(balanceTone(5)).toBe("credit");
    expect(balanceTone(-5)).toBe("debit");
    expect(balanceTone(0)).toBe("even");
    expect(balanceLabel(5, { me: true })).toBe("Du bekommst");
    expect(balanceLabel(-5)).toBe("schuldet");
    expect(balanceLabel(0)).toBe("ausgeglichen");
  });
  it("baut Einladungs- und Teilnehmerlinks", () => {
    expect(inviteUrl("https://hb.example", "abc_-1")).toBe("https://hb.example/g/abc_-1");
    expect(inviteUrl("https://hb.example/", "a b")).toBe("https://hb.example/g/a%20b");
    expect(tripShareUrl("http://localhost:5173", "tok")).toBe("http://localhost:5173/t/tok");
  });
  it("stellt eigene Überweisungen nach vorn", () => {
    const t = [
      { fromMemberId: 1, fromName: "A", toMemberId: 2, toName: "B", amountMinor: 1 },
      { fromMemberId: 3, fromName: "C", toMemberId: 4, toName: "D", amountMinor: 2 },
    ];
    expect(prioritizeMine(t, 4)[0]!.amountMinor).toBe(2);
    expect(prioritizeMine(t, null)).toBe(t);
  });
  it("liest Anteile aus Ausgaben", () => {
    const e = { splits: [{ memberId: 7, shareBaseMinor: 250, shareUnits: null }] } as unknown as Expense;
    expect(shareOf(e, 7)).toBe(250);
    expect(shareOf(e, 8)).toBe(0);
  });
});
