/**
 * Vorschau der Aufteilung im Client. Gleiche Regel wie `server/src/ledgers/splits.ts`
 * (Prinzip des grössten Restes, Gleichstand in der übergebenen Reihenfolge), aber mit
 * Ganzzahlen gerechnet. Verbindlich ist immer die Antwort des Servers.
 */

export type SplitMap = Map<number, number>;

export function splitByWeights(totalMinor: number, items: ReadonlyArray<{ id: number; weight: number }>): SplitMap {
  const out: SplitMap = new Map();
  if (items.length === 0) return out;
  const weights = items.map((i) => BigInt(Math.max(0, Math.round(i.weight))));
  const totalWeight = weights.reduce((s, w) => s + w, 0n);
  if (totalWeight <= 0n) return out;

  const sign = totalMinor < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(totalMinor));
  const parts = items.map((it, index) => {
    const num = abs * weights[index]!;
    return { id: it.id, index, floor: num / totalWeight, rest: num % totalWeight };
  });
  let remainder = abs - parts.reduce((s, p) => s + p.floor, 0n);
  const order = [...parts].sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const p of order) {
    if (remainder <= 0n) break;
    p.floor += 1n;
    remainder -= 1n;
  }
  for (const p of parts) out.set(p.id, sign * Number(p.floor));
  return out;
}

export function splitEqual(totalMinor: number, memberIds: readonly number[]): SplitMap {
  return splitByWeights(totalMinor, memberIds.map((id) => ({ id, weight: 1 })));
}

/** Erst gleichmässig auf Paare, dann gleichmässig innerhalb des Paars. */
export function splitCoupleEqual(
  totalMinor: number,
  couples: ReadonlyArray<{ coupleId: number; memberIds: readonly number[] }>
): SplitMap {
  const out: SplitMap = new Map();
  const valid = couples.filter((c) => c.memberIds.length > 0);
  if (valid.length === 0) return out;
  const perCouple = splitEqual(totalMinor, valid.map((c) => c.coupleId));
  for (const c of valid) {
    for (const [memberId, share] of splitEqual(perCouple.get(c.coupleId) ?? 0, c.memberIds)) {
      out.set(memberId, (out.get(memberId) ?? 0) + share);
    }
  }
  return out;
}

/** Anteile dürfen Dezimalstellen haben («1.5»); intern auf Tausendstel genau. */
export function splitShares(
  totalMinor: number,
  shares: ReadonlyArray<{ memberId: number; units: number }>
): SplitMap {
  return splitByWeights(totalMinor, shares.map((s) => ({ id: s.memberId, weight: Math.round(s.units * 1000) })));
}

/** Differenz zwischen Gesamtbetrag und der Summe exakter Anteile (0 = stimmt). */
export function exactRemainder(totalMinor: number, amounts: ReadonlyArray<number>): number {
  return totalMinor - amounts.reduce((s, a) => s + a, 0);
}

/** «2», «1.5», «0,5» → Zahl > 0, sonst null. */
export function parseUnits(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}
