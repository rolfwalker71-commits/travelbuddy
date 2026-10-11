/**
 * Saldo und Ausgleichsvorschläge, portiert aus FamilyBrain (`finance-brain/settlement.ts`),
 * aber vollständig in ganzzahligen Minor Units. Damit entfallen alle Epsilon-Vergleiche.
 */

export type BalanceInput = {
  memberId: number;
  displayName: string;
  paidMinor: number;
  owedMinor: number;
  settlementsReceivedMinor: number;
  settlementsPaidMinor: number;
};

export type MemberBalance = BalanceInput & { netMinor: number };

export type Transfer = {
  fromMemberId: number;
  fromName: string;
  toMemberId: number;
  toName: string;
  amountMinor: number;
};

export type SimplifyOpening = {
  memberId: number;
  displayName: string;
  netMinor: number;
  role: "debtor" | "creditor" | "settled";
};

export type SimplifyStep = Transfer & {
  step: number;
  debtorRemainingMinor: number;
  creditorRemainingMinor: number;
};

export type SimplifyExplanation = {
  openings: SimplifyOpening[];
  steps: SimplifyStep[];
  transfers: Transfer[];
};

const byName = (a: string, b: string) => a.localeCompare(b, "de");

/**
 * net > 0: Person bekommt noch Geld; net < 0: Person schuldet.
 * Eine Rückzahlung (settlement) verbessert den Saldo des Zahlenden und
 * verschlechtert den des Empfängers.
 */
export function computeMemberBalances(rows: BalanceInput[]): MemberBalance[] {
  return rows.map((r) => ({
    ...r,
    netMinor:
      r.paidMinor - r.owedMinor + r.settlementsPaidMinor - r.settlementsReceivedMinor,
  }));
}

/** «Wenigste Überweisungen»: greedy Min-Cash-Flow, grösste Schuld zuerst. */
export function explainSimplifyDebts(balances: MemberBalance[]): SimplifyExplanation {
  type Node = { id: number; name: string; amount: number };
  const creditors: Node[] = [];
  const debtors: Node[] = [];
  const openings: SimplifyOpening[] = [];

  for (const b of balances) {
    if (b.netMinor > 0) {
      creditors.push({ id: b.memberId, name: b.displayName, amount: b.netMinor });
      openings.push({ memberId: b.memberId, displayName: b.displayName, netMinor: b.netMinor, role: "creditor" });
    } else if (b.netMinor < 0) {
      debtors.push({ id: b.memberId, name: b.displayName, amount: -b.netMinor });
      openings.push({ memberId: b.memberId, displayName: b.displayName, netMinor: b.netMinor, role: "debtor" });
    } else {
      openings.push({ memberId: b.memberId, displayName: b.displayName, netMinor: 0, role: "settled" });
    }
  }

  openings.sort((a, b) => a.netMinor - b.netMinor || byName(a.displayName, b.displayName));
  creditors.sort((a, b) => b.amount - a.amount || byName(a.name, b.name));
  debtors.sort((a, b) => b.amount - a.amount || byName(a.name, b.name));

  const transfers: Transfer[] = [];
  const steps: SimplifyStep[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const pay = Math.min(d.amount, c.amount);
    d.amount -= pay;
    c.amount -= pay;
    const t: Transfer = {
      fromMemberId: d.id,
      fromName: d.name,
      toMemberId: c.id,
      toName: c.name,
      amountMinor: pay,
    };
    transfers.push(t);
    steps.push({
      ...t,
      step: steps.length + 1,
      debtorRemainingMinor: d.amount,
      creditorRemainingMinor: c.amount,
    });
    if (d.amount === 0) i += 1;
    if (c.amount === 0) j += 1;
  }
  return { openings, steps, transfers };
}

export type DebtEdge = { fromMemberId: number; toMemberId: number; amountMinor: number };

/**
 * «Nach Zahler»: Jeder Anteil (ausser dem des Zahlers) ergibt eine Schuld
 * Person → Zahler. Rückzahlungen vermindern sie, Gegenrichtungen werden verrechnet.
 */
export function buildPayerOrientedDebts(
  expenseEdges: DebtEdge[],
  settlements: DebtEdge[],
  nameById: Map<number, string>
): Transfer[] {
  const directed = new Map<string, number>();
  const key = (from: number, to: number) => `${from}:${to}`;
  const add = (from: number, to: number, amount: number) => {
    if (from === to || amount === 0) return;
    directed.set(key(from, to), (directed.get(key(from, to)) ?? 0) + amount);
  };
  for (const e of expenseEdges) add(e.fromMemberId, e.toMemberId, e.amountMinor);
  for (const s of settlements) add(s.fromMemberId, s.toMemberId, -s.amountMinor);

  const ids = [...nameById.keys()].sort((a, b) => a - b);
  const name = (id: number) => nameById.get(id) ?? `#${id}`;
  const out: Transfer[] = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const idA = ids[a]!;
      const idB = ids[b]!;
      const net = (directed.get(key(idA, idB)) ?? 0) - (directed.get(key(idB, idA)) ?? 0);
      if (net > 0) {
        out.push({ fromMemberId: idA, fromName: name(idA), toMemberId: idB, toName: name(idB), amountMinor: net });
      } else if (net < 0) {
        out.push({ fromMemberId: idB, fromName: name(idB), toMemberId: idA, toName: name(idA), amountMinor: -net });
      }
    }
  }
  out.sort((x, y) => byName(x.fromName, y.fromName) || byName(x.toName, y.toName));
  return out;
}

export type CappedSettlement = {
  amountMinor: number;
  capped: boolean;
  overpayByMinor: number;
  creditorNetMinor: number;
};

/** Begrenzt einen Rückzahlungsvorschlag auf das, was der Empfänger netto noch bekommt. */
export function capSettlementToCreditorNet(
  suggestedMinor: number,
  creditorNetMinor: number
): CappedSettlement {
  const suggested = Math.max(0, suggestedMinor);
  const net = Math.max(0, creditorNetMinor);
  if (suggested <= net) {
    return { amountMinor: suggested, capped: false, overpayByMinor: 0, creditorNetMinor: net };
  }
  return { amountMinor: net, capped: true, overpayByMinor: suggested - net, creditorNetMinor: net };
}
