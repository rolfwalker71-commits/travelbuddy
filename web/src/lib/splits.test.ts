import { describe, expect, it } from "vitest";
import { exactRemainder, parseUnits, splitByWeights, splitCoupleEqual, splitEqual, splitShares } from "./splits";

const sum = (m: Map<number, number>) => [...m.values()].reduce((s, v) => s + v, 0);

describe("splitEqual", () => {
  it("verteilt den Rest in Reihenfolge, Summe stimmt immer", () => {
    const m = splitEqual(1000, [1, 2, 3]);
    expect([...m.entries()]).toEqual([[1, 334], [2, 333], [3, 333]]);
    expect(sum(m)).toBe(1000);
  });
  it("kommt mit kleinen Beträgen zurecht", () => {
    const m = splitEqual(1, [1, 2, 3]);
    expect([...m.values()]).toEqual([1, 0, 0]);
    expect(sum(splitEqual(2, [4, 5, 6]))).toBe(2);
  });
  it("hält die Summe auch bei grossen Beträgen", () => {
    const m = splitEqual(900719925474099, [1, 2, 3, 4, 5, 6, 7]);
    expect(sum(m)).toBe(900719925474099);
  });
  it("verteilt negative Beträge symmetrisch", () => {
    const m = splitEqual(-1000, [1, 2, 3]);
    expect([...m.values()]).toEqual([-334, -333, -333]);
  });
  it("leer ergibt leer", () => {
    expect(splitEqual(100, []).size).toBe(0);
  });
});

describe("splitShares", () => {
  it("gewichtet, grösster Rest zuerst", () => {
    const m = splitShares(1000, [
      { memberId: 1, units: 1 },
      { memberId: 2, units: 2 },
    ]);
    expect([...m.entries()]).toEqual([[1, 333], [2, 667]]);
  });
  it("erlaubt Dezimalanteile", () => {
    const m = splitShares(1000, [
      { memberId: 1, units: 1.5 },
      { memberId: 2, units: 0.5 },
    ]);
    expect([...m.entries()]).toEqual([[1, 750], [2, 250]]);
  });
});

describe("splitCoupleEqual", () => {
  it("teilt erst auf Paare, dann innerhalb des Paars", () => {
    const m = splitCoupleEqual(1000, [
      { coupleId: 1, memberIds: [10, 11] },
      { coupleId: 2, memberIds: [20] },
    ]);
    expect(m.get(10)).toBe(250);
    expect(m.get(11)).toBe(250);
    expect(m.get(20)).toBe(500);
    expect(sum(m)).toBe(1000);
  });
  it("ungerade Beträge bleiben ganz", () => {
    const m = splitCoupleEqual(1001, [
      { coupleId: 1, memberIds: [10, 11] },
      { coupleId: 2, memberIds: [20, 21] },
    ]);
    expect(sum(m)).toBe(1001);
  });
});

describe("Hilfen", () => {
  it("rechnet die Differenz exakter Anteile", () => {
    expect(exactRemainder(1000, [400, 300])).toBe(300);
    expect(exactRemainder(1000, [600, 400])).toBe(0);
    expect(exactRemainder(1000, [700, 400])).toBe(-100);
  });
  it("liest Anteile", () => {
    expect(parseUnits("2")).toBe(2);
    expect(parseUnits("1,5")).toBe(1.5);
    expect(parseUnits("0")).toBeNull();
    expect(parseUnits("-1")).toBeNull();
    expect(parseUnits("1.2345")).toBeNull();
    expect(parseUnits("x")).toBeNull();
  });
  it("lehnt Nullgewichte ab", () => {
    expect(splitByWeights(100, [{ id: 1, weight: 0 }]).size).toBe(0);
  });
});
