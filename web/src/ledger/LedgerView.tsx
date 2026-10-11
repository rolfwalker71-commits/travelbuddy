import { useMemo, useState } from "react";
import { errorMessage } from "../api/client";
import { accountLedgerApi, ledgers as L } from "../api/endpoints";
import type { Expense, LedgerOverview, Settlement, Transfer } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { Fab } from "../layout/AppShell";
import { allSettled, capToCreditorNet } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { useAuth } from "../state/auth";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Banner, EmptyState, SkeletonCards } from "../ui/Feedback";
import { HelpCard, IllustrationCard } from "../ui/IllustrationCard";
import { Stat } from "../ui/Stat";
import { useToast } from "../ui/Toast";
import { BalanceChip, Section, Segmented, Tabs } from "../ui/bits";
import { BalanceChart, CostByCategory, CostByDay, SettlementArrows } from "../viz/CostCharts";
import { ExpenseDetailSheet } from "./ExpenseDetail";
import { ExpenseSheet } from "./ExpenseSheet";
import { BalanceList, ExpenseGroups, SettlementList, TransferList } from "./LedgerParts";
import { SettlementSheet, type SettlementPrefill } from "./SettlementSheet";

type Data = { overview: LedgerOverview; expenses: Expense[]; settlements: Settlement[] };
type TabKey = "balances" | "expenses" | "settlements";

/**
 * Reisekasse einer Reise: Salden, Ausgaben, Rückzahlungen, mit Infografiken (Kategorie, Tag, Ausgleich).
 * Die Abrechnungslogik (Aufteilung, Fremdwährung, Ausgleich) ist unverändert aus HomeBuddy.
 */
export function LedgerView({ ledgerId, onChanged }: { ledgerId: number; onChanged?: () => void }) {
  const q = useQuery<Data>(
    async (signal) => {
      const [overview, expenses, settlements] = await Promise.all([
        L.overview(ledgerId, signal),
        L.expenses(ledgerId, signal),
        L.settlements(ledgerId, signal),
      ]);
      return { overview, expenses, settlements };
    },
    [ledgerId]
  );
  return (
    <QueryView query={q} skeleton={<SkeletonCards />}>
      {(data) => (
        <LedgerBody
          data={data}
          refreshing={q.refreshing}
          reload={() => {
            q.reload();
            onChanged?.();
          }}
        />
      )}
    </QueryView>
  );
}

function LedgerBody({ data, reload, refreshing }: { data: Data; reload: () => void; refreshing: boolean }) {
  const { overview, expenses, settlements } = data;
  const { ledger, members, couples } = overview;
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const archived = Boolean(ledger.archivedAt);
  const base = ledger.baseCurrency;

  const [tab, setTab] = useState<TabKey>("balances");
  const [transferView, setTransferView] = useState<"min" | "payer">("min");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [prefill, setPrefill] = useState<SettlementPrefill | null>(null);

  const me = members.find((m) => m.id === overview.myMemberId) ?? members.find((m) => m.userId === user?.id) ?? null;
  const api = useMemo(() => accountLedgerApi(ledger.id), [ledger.id]);
  const settled = allSettled(overview.balances);
  const myBalance = me ? overview.balances.find((b) => b.memberId === me.id) : undefined;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setExpenseOpen(true);
  };

  const payTransfer = (t: Transfer) => {
    let amount = t.amountMinor;
    let hint: string | undefined;
    if (transferView === "payer") {
      const net = overview.balances.find((b) => b.memberId === t.toMemberId)?.netMinor ?? 0;
      const c = capToCreditorNet(t.amountMinor, net);
      amount = c.amountMinor;
      if (c.capped) hint = `Auf den offenen Saldo von ${t.toName} begrenzt (${formatMoney(c.amountMinor, base)}).`;
    }
    setPrefill({ fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, amountMinor: amount, hint });
    setSettleOpen(true);
  };

  const deleteExpense = async (e: Expense) => {
    const ok = await confirm({
      title: "Ausgabe löschen?",
      message: `«${e.description || "Ohne Beschreibung"}» wird endgültig gelöscht. Salden werden neu berechnet.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    setDetail(null);
    setExpenseOpen(false);
    await run(() => api.deleteExpense(e.id), "Ausgabe gelöscht");
  };

  const transfers = transferView === "min" ? overview.suggestedTransfers : overview.payerDebts;

  return (
    <div className="ledger">
      {archived ? (
        <Banner
          tone="warn"
          action={
            <Button size="s" onClick={() => void run(() => L.update(ledger.id, { archived: false }), "Reisekasse aktiviert")}>
              Wieder aktivieren
            </Button>
          }
        >
          Diese Reisekasse ist archiviert. Änderungen sind erst nach der Reaktivierung möglich.
        </Banner>
      ) : null}

      <div className="card stat-row stat-row--box" aria-live="polite" aria-busy={refreshing}>
        <Stat label="Ausgaben gesamt" value={formatMoney(overview.totals.expenseMinor, base)} sub={`${overview.totals.count} Buchungen`} />
        <div className="stat2 stat2--wide-sm">
          <span className="stat2__label">Mein Saldo</span>
          <span className="stat2__sub">
            {myBalance ? <BalanceChip netMinor={myBalance.netMinor} currency={base} me /> : <span className="muted">Nicht beteiligt</span>}
          </span>
        </div>
        <Stat
          label="Offen"
          value={settled ? "Ausgeglichen" : `${overview.suggestedTransfers.length}`}
          sub={settled ? undefined : overview.suggestedTransfers.length === 1 ? "Überweisung" : "Überweisungen"}
        />
        {!archived ? (
          <div className="ledger__add hide-sm">
            <Button variant="primary" icon="plus" onClick={openCreate}>
              Ausgabe
            </Button>
          </div>
        ) : null}
      </div>

      <Tabs<TabKey>
        label="Bereiche der Reisekasse"
        idPrefix="ledger"
        value={tab}
        onChange={setTab}
        options={[
          { value: "balances", label: "Salden" },
          { value: "expenses", label: "Ausgaben", count: expenses.length },
          { value: "settlements", label: "Rückzahlungen", count: settlements.length },
        ]}
      />

      <div id="ledger-panel" role="tabpanel" aria-labelledby={`ledger-tab-${tab}`} className="panel">
        {tab === "balances" ? (
          settled ? (
            <div className="card empty--illu empty">
              <IllustrationCard id="empty-ledger" decorative />
              <div className="empty__text">
                <h3>Alles ausgeglichen</h3>
                <p className="muted">
                  {expenses.length === 0
                    ? "Es gibt noch keine Ausgaben. Erfasse die erste, um Salden zu sehen."
                    : "Alle Teilnehmer sind quitt. Neue Ausgaben ergeben wieder Salden."}
                </p>
                {!archived && expenses.length === 0 ? (
                  <Button variant="primary" icon="plus" onClick={openCreate}>
                    Ausgabe erfassen
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="viz-grid">
                <section className="card viz-card">
                  <BalanceChart balances={overview.balances} currency={base} />
                </section>
                <section className="card viz-card">
                  <SettlementArrows transfers={overview.suggestedTransfers} currency={base} />
                </section>
              </div>
              <Section title="Salden" id="sec-balances">
                <div className="card">
                  <BalanceList balances={overview.balances} currency={base} meId={me?.id} />
                </div>
              </Section>
              <Section
                title="Überweisungen"
                id="sec-transfers"
                actions={
                  <Segmented
                    label="Ansicht der Überweisungen"
                    value={transferView}
                    onChange={setTransferView}
                    options={[
                      { value: "min", label: "Wenigste" },
                      { value: "payer", label: "Nach Zahler" },
                    ]}
                  />
                }
              >
                <p className="muted small section__intro">
                  {transferView === "min"
                    ? "Der kürzeste Weg, damit alle quitt sind."
                    : "Wer wem wegen welcher Ausgaben noch etwas schuldet, paarweise verrechnet."}
                </p>
                {transfers.length > 0 ? (
                  <div className="card card--flush">
                    <TransferList transfers={transfers} currency={base} meId={me?.id} onPay={payTransfer} disabled={archived} />
                  </div>
                ) : (
                  <div className="card">
                    <EmptyState icon="check-circle" title="Keine Überweisungen nötig" />
                  </div>
                )}
              </Section>
              <HelpCard id="help-settle" defaultOpen={false} />
            </>
          )
        ) : null}

        {tab === "expenses" ? (
          expenses.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="receipt"
                title="Noch keine Ausgaben"
                action={
                  !archived ? (
                    <Button variant="primary" icon="plus" onClick={openCreate}>
                      Ausgabe erfassen
                    </Button>
                  ) : undefined
                }
              >
                Erfasse die erste gemeinsame Ausgabe.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="viz-grid">
                <section className="card viz-card">
                  <CostByCategory expenses={expenses} currency={base} />
                </section>
                <section className="card viz-card">
                  <CostByDay expenses={expenses} currency={base} />
                </section>
              </div>
              <ExpenseGroups expenses={expenses} members={members} baseCurrency={base} meId={me?.id} onOpen={setDetail} />
            </>
          )
        ) : null}

        {tab === "settlements" ? (
          <Section
            title="Rückzahlungen"
            id="sec-settle"
            actions={
              !archived ? (
                <Button
                  size="s"
                  icon="plus"
                  onClick={() => {
                    setPrefill(null);
                    setSettleOpen(true);
                  }}
                >
                  Erfassen
                </Button>
              ) : undefined
            }
          >
            {settlements.length === 0 ? (
              <div className="card">
                <EmptyState icon="swap" title="Noch keine Rückzahlungen">
                  Hier erscheinen Überweisungen, die du als bezahlt erfasst, und automatische Ausgleiche.
                </EmptyState>
              </div>
            ) : (
              <SettlementList
                settlements={settlements}
                members={members}
                baseCurrency={base}
                meId={me?.id}
                onDelete={async (s) => {
                  const ok = await confirm({
                    title: "Rückzahlung löschen?",
                    message: "Die Salden werden neu berechnet.",
                    confirmLabel: "Löschen",
                    danger: true,
                  });
                  if (ok) await run(() => L.deleteSettlement(ledger.id, s.id), "Rückzahlung gelöscht");
                }}
              />
            )}
          </Section>
        ) : null}
      </div>

      {!archived ? <Fab label="Ausgabe erfassen" onClick={openCreate} /> : null}

      <ExpenseSheet
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        baseCurrency={base}
        kind="split"
        members={members}
        couples={couples}
        expense={editing}
        defaultPayerId={me?.id ?? null}
        api={api}
        onSaved={(_, mode) => {
          toast(mode === "created" ? "Ausgabe erfasst" : "Ausgabe gespeichert");
          reload();
        }}
        onDelete={deleteExpense}
      />

      <ExpenseDetailSheet
        expense={detail}
        members={members}
        couples={couples}
        baseCurrency={base}
        meId={me?.id}
        cashbook={false}
        canEdit={!archived}
        onClose={() => setDetail(null)}
        onEdit={(e) => {
          setDetail(null);
          setEditing(e);
          setExpenseOpen(true);
        }}
        onDelete={deleteExpense}
        onSettleCouple={async (e) => {
          setDetail(null);
          await run(() => L.settleCouple(ledger.id, e.id), "Paar-Ausgleich gebucht");
        }}
      />

      <SettlementSheet
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        baseCurrency={base}
        members={members}
        prefill={prefill}
        api={api}
        onSaved={() => {
          toast("Rückzahlung erfasst");
          reload();
        }}
      />
    </div>
  );
}
