import { HttpError } from "../lib/errors";

/** memberId → Anteil in Minor Units der Basiswährung. */
export type SplitMap = Map<number, number>;

/**
 * Verteilt `totalMinor` nach Gewichten; der Rest (Rappen) geht nach dem
 * Prinzip des grössten Restes an die Personen mit dem grössten Nachkommaanteil,
 * bei Gleichstand in der übergebenen Reihenfolge. Summe == total, immer.
 */
export function splitByWeights(
  totalMinor: number,
  items: ReadonlyArray<{ id: number; weight: number }>
): SplitMap {
  const out: SplitMap = new Map();
  if (items.length === 0) return out;
  const totalWeight = items.reduce((s, x) => s + x.weight, 0);
  if (!(totalWeight > 0)) {
    throw new HttpError(422, "invalid_split", "Gewichte müssen positiv sein");
  }

  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(totalMinor);

  const parts = items.map((it, index) => {
    const exact = (abs * it.weight) / totalWeight;
    const floor = Math.floor(exact + 1e-9);
    return { id: it.id, index, floor, frac: exact - floor };
  });
  let remainder = abs - parts.reduce((s, p) => s + p.floor, 0);

  const order = [...parts].sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const p of order) {
    if (remainder <= 0) break;
    p.floor += 1;
    remainder -= 1;
  }
  for (const p of parts) out.set(p.id, sign * p.floor);
  return out;
}

export function splitEqual(totalMinor: number, memberIds: readonly number[]): SplitMap {
  return splitByWeights(
    totalMinor,
    memberIds.map((id) => ({ id, weight: 1 }))
  );
}

/** Erst gleichmässig auf Paare, dann gleichmässig innerhalb des Paars. */
export function splitCoupleEqual(
  totalMinor: number,
  couples: ReadonlyArray<{ coupleId: number; memberIds: readonly number[] }>
): SplitMap {
  const out: SplitMap = new Map();
  const valid = couples.filter((c) => c.memberIds.length > 0);
  if (valid.length === 0) return out;
  const perCouple = splitEqual(
    totalMinor,
    valid.map((c) => c.coupleId)
  );
  for (const c of valid) {
    const inner = splitEqual(perCouple.get(c.coupleId) ?? 0, c.memberIds);
    for (const [memberId, share] of inner) {
      out.set(memberId, (out.get(memberId) ?? 0) + share);
    }
  }
  return out;
}

export function splitShares(
  totalMinor: number,
  shares: ReadonlyArray<{ memberId: number; units: number }>
): SplitMap {
  return splitByWeights(
    totalMinor,
    shares.map((s) => ({ id: s.memberId, weight: s.units }))
  );
}

/** Exakte Beträge: müssen sich auf den Cent genau zum Total summieren. */
export function splitExact(
  totalMinor: number,
  amounts: ReadonlyArray<{ memberId: number; amountBaseMinor: number }>
): SplitMap {
  const out: SplitMap = new Map();
  for (const a of amounts) {
    out.set(a.memberId, (out.get(a.memberId) ?? 0) + a.amountBaseMinor);
  }
  const sum = [...out.values()].reduce((s, v) => s + v, 0);
  if (sum !== totalMinor) {
    throw new HttpError(
      422,
      "split_sum_mismatch",
      "Aufteilung summiert sich nicht zum Gesamtbetrag"
    );
  }
  return out;
}
