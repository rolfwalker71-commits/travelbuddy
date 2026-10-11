import test from "node:test";
import assert from "node:assert/strict";
import { convertMinor, currencyExponent, roundHalfAway } from "../src/lib/money";
import {
  splitByWeights,
  splitCoupleEqual,
  splitEqual,
  splitExact,
  splitShares,
} from "../src/ledgers/splits";
import {
  buildPayerOrientedDebts,
  capSettlementToCreditorNet,
  computeMemberBalances,
  explainSimplifyDebts,
} from "../src/ledgers/settlement";

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

test("money: Exponent und symmetrisches Runden", () => {
  assert.equal(currencyExponent("CHF"), 2);
  assert.equal(currencyExponent("jpy"), 0);
  assert.equal(roundHalfAway(2.5), 3);
  assert.equal(roundHalfAway(-2.5), -3);
});

test("money: Umrechnung berücksichtigt Nachkommastellen", () => {
  // 10.00 EUR * 0.95 = 9.50 CHF
  assert.equal(convertMinor(1000, "EUR", "CHF", 0.95), 950);
  // 1000 JPY * 0.0060 CHF = 6.00 CHF = 600 Rappen
  assert.equal(convertMinor(1000, "JPY", "CHF", 0.006), 600);
  // gleiche Währung bleibt unverändert
  assert.equal(convertMinor(1234, "CHF", "chf", 99), 1234);
});

test("splits: gleichmässig, Rest verteilt, Summe stimmt immer", () => {
  const m = splitEqual(1000, [1, 2, 3]); // 10.00 / 3
  assert.equal(sum(m), 1000);
  assert.deepEqual([...m.values()].sort(), [333, 333, 334]);
  assert.equal(m.get(1), 334); // Rest geht zuerst an die erste Person

  for (const total of [1, 2, 99, 1001, 12345, -1001]) {
    for (const n of [1, 2, 3, 4, 7]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      assert.equal(sum(splitEqual(total, ids)), total, `${total}/${n}`);
    }
  }
});

test("splits: Gewichte (Anteile) nach grösstem Rest", () => {
  const m = splitShares(1000, [
    { memberId: 1, units: 2 },
    { memberId: 2, units: 1 },
  ]);
  assert.equal(m.get(1), 667);
  assert.equal(m.get(2), 333);
  assert.equal(sum(m), 1000);
});

test("splits: Paare zuerst, dann innerhalb des Paars", () => {
  // 3 Personen: Paar A (1,2) und Single B (3). 900 → je 450 pro «Einheit».
  const m = splitCoupleEqual(900, [
    { coupleId: 10, memberIds: [1, 2] },
    { coupleId: 11, memberIds: [3] },
  ]);
  assert.equal(m.get(1), 225);
  assert.equal(m.get(2), 225);
  assert.equal(m.get(3), 450);
});

test("splits: exakt muss auf den Rappen stimmen", () => {
  const ok = splitExact(1000, [
    { memberId: 1, amountBaseMinor: 400 },
    { memberId: 2, amountBaseMinor: 600 },
  ]);
  assert.equal(sum(ok), 1000);
  assert.throws(
    () =>
      splitExact(1000, [
        { memberId: 1, amountBaseMinor: 400 },
        { memberId: 2, amountBaseMinor: 599 },
      ]),
    /summiert sich nicht/
  );
});

test("splits: ungültige Gewichte werden abgelehnt", () => {
  assert.throws(() => splitByWeights(100, [{ id: 1, weight: 0 }]));
});

test("settlement: Saldo mit Rückzahlung", () => {
  const b = computeMemberBalances([
    { memberId: 1, displayName: "Anna", paidMinor: 9000, owedMinor: 3000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0 },
    { memberId: 2, displayName: "Ben", paidMinor: 0, owedMinor: 3000, settlementsPaidMinor: 1000, settlementsReceivedMinor: 0 },
    { memberId: 3, displayName: "Cleo", paidMinor: 0, owedMinor: 3000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0 },
  ]);
  assert.deepEqual(
    b.map((x) => x.netMinor),
    [6000, -2000, -3000]
  );
});

test("settlement: Min-Cash-Flow gleicht alles aus", () => {
  const balances = computeMemberBalances([
    { memberId: 1, displayName: "Anna", paidMinor: 9000, owedMinor: 3000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0 },
    { memberId: 2, displayName: "Ben", paidMinor: 0, owedMinor: 3000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0 },
    { memberId: 3, displayName: "Cleo", paidMinor: 0, owedMinor: 3000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0 },
  ]);
  const { transfers, steps, openings } = explainSimplifyDebts(balances);
  assert.equal(transfers.length, 2);
  assert.equal(steps.length, 2);
  assert.equal(openings[0]!.role, "debtor");

  // Nach Anwendung aller Überweisungen ist jeder Saldo 0.
  const net = new Map(balances.map((x) => [x.memberId, x.netMinor]));
  for (const t of transfers) {
    net.set(t.fromMemberId, net.get(t.fromMemberId)! + t.amountMinor);
    net.set(t.toMemberId, net.get(t.toMemberId)! - t.amountMinor);
  }
  assert.deepEqual([...net.values()], [0, 0, 0]);
});

test("settlement: Min-Cash-Flow bleibt für zufällige Salden ausgeglichen", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let run = 0; run < 200; run++) {
    const n = 2 + Math.floor(rnd() * 6);
    const nets: number[] = [];
    for (let i = 0; i < n - 1; i++) nets.push(Math.round((rnd() - 0.5) * 100000));
    nets.push(-nets.reduce((a, b) => a + b, 0));
    const balances = nets.map((netMinor, i) => ({
      memberId: i + 1,
      displayName: `P${i + 1}`,
      paidMinor: 0,
      owedMinor: 0,
      settlementsPaidMinor: 0,
      settlementsReceivedMinor: 0,
      netMinor,
    }));
    const { transfers } = explainSimplifyDebts(balances);
    assert.ok(transfers.length <= n - 1);
    const net = new Map(balances.map((x) => [x.memberId, x.netMinor]));
    for (const t of transfers) {
      assert.ok(t.amountMinor > 0);
      net.set(t.fromMemberId, net.get(t.fromMemberId)! + t.amountMinor);
      net.set(t.toMemberId, net.get(t.toMemberId)! - t.amountMinor);
    }
    assert.ok([...net.values()].every((v) => v === 0));
  }
});

test("settlement: Nach-Zahler verrechnet Gegenrichtungen und Rückzahlungen", () => {
  const names = new Map([
    [1, "Anna"],
    [2, "Ben"],
  ]);
  // Ben schuldet Anna 50.00, Anna schuldet Ben 20.00 → Ben schuldet 30.00.
  const debts = buildPayerOrientedDebts(
    [
      { fromMemberId: 2, toMemberId: 1, amountMinor: 5000 },
      { fromMemberId: 1, toMemberId: 2, amountMinor: 2000 },
    ],
    [],
    names
  );
  assert.deepEqual(debts, [
    { fromMemberId: 2, fromName: "Ben", toMemberId: 1, toName: "Anna", amountMinor: 3000 },
  ]);

  // Ben hat 10.00 zurückgezahlt → noch 20.00.
  const after = buildPayerOrientedDebts(
    [
      { fromMemberId: 2, toMemberId: 1, amountMinor: 5000 },
      { fromMemberId: 1, toMemberId: 2, amountMinor: 2000 },
    ],
    [{ fromMemberId: 2, toMemberId: 1, amountMinor: 1000 }],
    names
  );
  assert.equal(after[0]!.amountMinor, 2000);
});

test("settlement: Vorschlag wird auf Netto-Guthaben des Empfängers begrenzt", () => {
  assert.deepEqual(capSettlementToCreditorNet(4800, 4750), {
    amountMinor: 4750,
    capped: true,
    overpayByMinor: 50,
    creditorNetMinor: 4750,
  });
  assert.equal(capSettlementToCreditorNet(1000, 4750).capped, false);
});
