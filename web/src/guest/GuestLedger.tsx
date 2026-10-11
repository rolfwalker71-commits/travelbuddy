import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { guest, guestLedgerApi } from "../api/endpoints";
import type { Expense, GuestLedgerState, Transfer } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { Fab } from "../layout/AppShell";
import { allSettled } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Banner, EmptyState, SkeletonCards } from "../ui/Feedback";
import { useToast } from "../ui/Toast";
import { BalanceChip, Section } from "../ui/bits";
import { ExpenseDetailSheet } from "../ledger/ExpenseDetail";
import { ExpenseSheet } from "../ledger/ExpenseSheet";
import { BalanceList, ExpenseGroups, SettlementList, TransferList } from "../ledger/LedgerParts";
import { SettlementSheet, type SettlementPrefill } from "../ledger/SettlementSheet";
import { GuestShell } from "./GuestShell";

export function GuestLedgerPage() {
  const { token = "" } = useParams();
  const q = useQuery((signal) => guest.ledger(token, signal), [token]);

  if (q.error && q.data === undefined) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <GuestShell>
        <div className="card">
          <EmptyState icon="link" title={notFound ? "Link ungültig" : "Das hat nicht geklappt"} action={
            notFound ? undefined : <Button icon="refresh" onClick={q.reload}>Erneut versuchen</Button>
          }>
            {notFound
              ? "Dieser Link ist ungültig oder wurde widerrufen. Bitte frage die Person, die dich eingeladen hat, nach einem neuen Link."
              : errorMessage(q.error)}
          </EmptyState>
        </div>
      </GuestShell>
    );
  }

  return (
    <QueryView
      query={q}
      skeleton={
        <GuestShell>
          <SkeletonCards count={3} />
        </GuestShell>
      }
    >
      {(state) => <GuestLedgerView token={token} state={state} reload={q.reload} />}
    </QueryView>
  );
}

function GuestLedgerView({ token, state, reload }: { token: string; state: GuestLedgerState; reload: () => void }) {
  const { ledger, members, couples, balances, me, expenses, settlements } = state;
  const base = ledger.baseCurrency;
  const archived = Boolean(ledger.archivedAt);
  const toast = useToast();
  const confirm = useConfirm();
  const api = useMemo(() => guestLedgerApi(token), [token]);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [prefill, setPrefill] = useState<SettlementPrefill | null>(null);

  const mine = balances.find((b) => b.memberId === me.memberId);
  const myTransfers = state.suggestedTransfers.filter((t) => t.fromMemberId === me.memberId || t.toMemberId === me.memberId);
  const settled = allSettled(balances);

  const openCreate = () => {
    setEditing(null);
    setExpenseOpen(true);
  };

  const remove = async (e: Expense) => {
    const ok = await confirm({
      title: "Ausgabe löschen?",
      message: `«${e.description || "Ohne Beschreibung"}» wird endgültig gelöscht.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    setDetail(null);
    setExpenseOpen(false);
    try {
      await api.deleteExpense(e.id);
      toast("Ausgabe gelöscht");
      reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const pay = (t: Transfer) => {
    setPrefill({ fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, amountMinor: t.amountMinor });
    setSettleOpen(true);
  };

  return (
    <GuestShell title={ledger.title} subtitle={`Hallo ${me.displayName}`}>
      <div className="guest__stack">
        {archived ? <Banner tone="warn">Diese Reisekasse ist archiviert. Es können keine Buchungen mehr erfasst werden.</Banner> : null}

        <section className="card guest-hero" aria-label="Mein Saldo">
          <p className="muted small">Dein Stand in «{ledger.title}»</p>
          <div className="guest-hero__balance">
            {mine ? <BalanceChip netMinor={mine.netMinor} currency={base} me /> : null}
          </div>
          {mine ? (
            <p className="xsmall faint tnum">
              Du hast {formatMoney(mine.paidMinor, base)} bezahlt, dein Anteil ist {formatMoney(mine.owedMinor, base)}.
            </p>
          ) : null}
          {!archived ? (
            <div className="guest-hero__actions">
              <Button variant="primary" icon="plus" onClick={openCreate}>
                Ausgabe erfassen
              </Button>
              <Button
                icon="swap"
                onClick={() => {
                  setPrefill(null);
                  setSettleOpen(true);
                }}
              >
                Rückzahlung erfassen
              </Button>
            </div>
          ) : null}
        </section>

        <Section title="Überweisungen" id="g-transfers">
          {settled ? (
            <div className="card">
              <EmptyState icon="check-circle" title="Alles ausgeglichen">
                Niemand schuldet jemandem etwas.
              </EmptyState>
            </div>
          ) : myTransfers.length > 0 ? (
            <div className="card card--flush">
              <TransferList
                transfers={myTransfers}
                currency={base}
                meId={me.memberId}
                onPay={archived ? undefined : pay}
                payLabel="Als bezahlt erfassen"
              />
            </div>
          ) : (
            <div className="card">
              <p className="muted">Für dich sind keine Überweisungen offen.</p>
            </div>
          )}
        </Section>

        <Section title="Salden" id="g-balances">
          <div className="card">
            <BalanceList balances={balances} currency={base} meId={me.memberId} />
          </div>
        </Section>

        <Section title="Ausgaben" id="g-expenses">
          {expenses.length === 0 ? (
            <div className="card">
              <EmptyState icon="receipt" title="Noch keine Ausgaben">
                Erfasse die erste Ausgabe mit dem Knopf oben.
              </EmptyState>
            </div>
          ) : (
            <ExpenseGroups expenses={expenses} members={members} baseCurrency={base} meId={me.memberId} onOpen={setDetail} />
          )}
        </Section>

        {settlements.length > 0 ? (
          <Section title="Rückzahlungen" id="g-settle">
            <SettlementList settlements={settlements} members={members} baseCurrency={base} meId={me.memberId} />
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
        defaultPayerId={me.memberId}
        api={api}
        onSaved={(_, mode) => {
          toast(mode === "created" ? "Ausgabe erfasst" : "Ausgabe gespeichert");
          reload();
        }}
        onDelete={remove}
      />
      <ExpenseDetailSheet
        expense={detail}
        members={members}
        couples={couples}
        baseCurrency={base}
        meId={me.memberId}
        canEdit={Boolean(detail && detail.createdByMemberId === me.memberId && !archived)}
        onClose={() => setDetail(null)}
        onEdit={(e) => {
          setDetail(null);
          setEditing(e);
          setExpenseOpen(true);
        }}
        onDelete={remove}
      />
      <SettlementSheet
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        baseCurrency={base}
        members={members}
        prefill={prefill ?? { fromMemberId: me.memberId }}
        api={api}
        onSaved={() => {
          toast("Rückzahlung erfasst");
          reload();
        }}
      />
    </GuestShell>
  );
}
