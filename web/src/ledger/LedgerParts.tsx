import type { ReactNode } from "react";
import type { Balance, Couple, Expense, Member, Settlement, SplitMode, Transfer } from "../api/types";
import { formatDate, formatDayHeading } from "../lib/dates";
import { balanceTone, groupByDate, memberName, prioritizeMine, shareOf } from "../lib/ledger";
import { formatMoney } from "../lib/money";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BalanceChip, Badge, Money } from "../ui/bits";

export const SPLIT_LABEL: Record<SplitMode, string> = {
  equal: "Gleichmässig",
  shares: "Nach Anteilen",
  exact: "Exakte Beträge",
  coupleEqual: "Nach Paaren",
};

export function BalanceList({ balances, currency, meId }: { balances: Balance[]; currency: string; meId?: number | null }) {
  const sorted = [...balances].sort((a, b) => b.netMinor - a.netMinor || a.displayName.localeCompare(b.displayName, "de"));
  const max = Math.max(1, ...sorted.map((b) => Math.abs(b.netMinor)));
  const totalPaid = sorted.reduce((s, b) => s + Math.max(0, b.paidMinor), 0);
  const payers = [...sorted].filter((b) => b.paidMinor > 0).sort((a, b) => b.paidMinor - a.paidMinor);
  return (
    <>
      <ul className="balance-list">
        {sorted.map((b) => {
          const tone = balanceTone(b.netMinor);
          const half = Math.round((Math.abs(b.netMinor) / max) * 50);
          return (
            <li key={b.memberId} className="balance-row">
              <div className="balance-row__main">
                <span className="balance-row__name">
                  {b.displayName}
                  {meId === b.memberId ? <span className="faint"> (du)</span> : null}
                </span>
                <BalanceChip netMinor={b.netMinor} currency={currency} me={false} />
              </div>
              <div className="dbar" aria-hidden="true">
                <span className="dbar__mid" />
                {tone !== "even" ? <span className={`dbar__fill dbar__fill--${tone}`} style={{ width: `${half}%` }} /> : null}
              </div>
              <p className="balance-row__sub xsmall faint tnum">
                Bezahlt {formatMoney(b.paidMinor, currency)} · Anteil {formatMoney(b.owedMinor, currency)}
              </p>
            </li>
          );
        })}
      </ul>
      {payers.length > 1 && totalPaid > 0 ? (
        <div className="paidshare">
          <span className="paidshare__label">Wer hat bezahlt?</span>
          <div
            className="paidshare__bar"
            role="img"
            aria-label={`Anteile an den Zahlungen: ${payers.map((p) => `${p.displayName} ${formatMoney(p.paidMinor, currency)}`).join(", ")}`}
          >
            {payers.map((p, i) => (
              <span key={p.memberId} className={`paidshare__seg paidshare__seg--${(i % 4) + 1}`} style={{ flexGrow: p.paidMinor }} />
            ))}
          </div>
          <ul className="paidshare__legend">
            {payers.map((p, i) => (
              <li key={p.memberId}>
                <i className={`paidshare__key paidshare__key--${(i % 4) + 1}`} />
                {p.displayName} <span className="num">{formatMoney(p.paidMinor, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function TransferList({
  transfers,
  currency,
  meId,
  onPay,
  payLabel = "Als bezahlt erfassen",
  disabled,
}: {
  transfers: Transfer[];
  currency: string;
  meId?: number | null;
  onPay?: (t: Transfer) => void;
  payLabel?: string;
  disabled?: boolean;
}) {
  return (
    <ul className="list">
      {prioritizeMine(transfers, meId ?? null).map((t, i) => {
        const mine = meId != null && (t.fromMemberId === meId || t.toMemberId === meId);
        return (
          <li key={`${t.fromMemberId}-${t.toMemberId}-${i}`} className={`transfer${mine ? " transfer--mine" : ""}`}>
            <div className="transfer__who">
              <span className="transfer__names">
                <strong>{t.fromMemberId === meId ? "Du" : t.fromName}</strong>
                <Icon name="arrow-right" size={16} />
                <strong>{t.toMemberId === meId ? "dich" : t.toName}</strong>
              </span>
              <span className="transfer__amount">
                <Money minor={t.amountMinor} currency={currency} />
              </span>
            </div>
            {onPay ? (
              <Button size="s" icon="check" onClick={() => onPay(t)} disabled={disabled}>
                {payLabel}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ExpenseGroups({
  expenses,
  members,
  baseCurrency,
  meId,
  onOpen,
  cashbook,
}: {
  expenses: Expense[];
  members: Member[];
  baseCurrency: string;
  meId?: number | null;
  onOpen: (e: Expense) => void;
  cashbook?: boolean;
}) {
  const groups = groupByDate(expenses);
  return (
    <div className="groups">
      {groups.map((g) => (
        <section key={g.date} className="group" aria-label={formatDayHeading(g.date)}>
          <h3 className="group__title">{formatDayHeading(g.date)}</h3>
          <ul className="list card card--flush">
            {g.items.map((e) => {
              const foreign = e.currency !== baseCurrency;
              const myShare = meId != null && !cashbook ? shareOf(e, meId) : 0;
              return (
                <li key={e.id}>
                  <button type="button" className="row row--button" onClick={() => onOpen(e)}>
                    <span className="row__main">
                      <span className="row__title">{e.description || (cashbook ? "Buchung" : "Ohne Beschreibung")}</span>
                      <span className="row__sub">
                        {cashbook
                          ? e.category || "Kassabuch"
                          : `Bezahlt von ${e.paidByMemberId === meId ? "dir" : memberName(members, e.paidByMemberId)}`}
                        {!cashbook && e.category ? ` · ${e.category}` : ""}
                      </span>
                      <span className="row__badges">
                        {e.direction === "income" ? <Badge tone="pos" icon="arrow-down">Einnahme</Badge> : null}
                        {e.settledStatus === 1 ? <Badge tone="neutral" icon="check">Ausgeglichen</Badge> : null}
                        {e.settledStatus === 2 ? <Badge tone="neutral" icon="check">Paar ausgeglichen</Badge> : null}
                      </span>
                    </span>
                    <span className="row__amount">
                      <Money minor={e.amountBaseMinor} currency={baseCurrency} className={e.direction === "income" ? "pos" : ""} />
                      {foreign ? (
                        <span className="row__amount-sub num">{formatMoney(e.amountMinor, e.currency)}</span>
                      ) : null}
                      {myShare > 0 ? (
                        <span className="row__amount-sub num">Anteil {formatMoney(myShare, baseCurrency)}</span>
                      ) : null}
                    </span>
                    <Icon name="chevron-right" size={18} className="row__chev" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function SettlementList({
  settlements,
  members,
  baseCurrency,
  meId,
  onDelete,
}: {
  settlements: Settlement[];
  members: Member[];
  baseCurrency: string;
  meId?: number | null;
  onDelete?: (s: Settlement) => void;
}) {
  const name = (id: number) => (id === meId ? "Du" : memberName(members, id));
  return (
    <ul className="list card card--flush">
      {settlements.map((s) => (
        <li key={s.id} className="row">
          <span className="row__main">
            <span className="row__title transfer__names">
              {name(s.fromMemberId)} <Icon name="arrow-right" size={16} /> {s.toMemberId === meId ? "dich" : name(s.toMemberId)}
            </span>
            <span className="row__sub">
              {formatDate(s.settledAt)}
              {s.note ? ` · ${s.note}` : ""}
            </span>
            {s.auto ? (
              <span className="row__badges">
                <Badge icon="check">Automatisch</Badge>
              </span>
            ) : null}
          </span>
          <span className="row__amount">
            <Money minor={s.amountBaseMinor} currency={baseCurrency} />
            {s.currency !== baseCurrency ? (
              <span className="row__amount-sub num">{formatMoney(s.amountMinor, s.currency)}</span>
            ) : null}
          </span>
          {onDelete && !s.auto ? (
            <button type="button" className="btn btn--ghost btn--s btn--icon" aria-label="Rückzahlung löschen" onClick={() => onDelete(s)}>
              <Icon name="trash" size={16} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items
        .filter((i) => i.value !== null && i.value !== undefined && i.value !== "")
        .map((i) => (
          <div key={i.label} className="kv__row">
            <dt>{i.label}</dt>
            <dd>{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Paar-Ausgleich ist möglich, wenn genau zwei Personen desselben Paars beteiligt sind. */
export function canSettleCouple(e: Expense, members: Member[], couples: Couple[]): boolean {
  if (e.direction !== "expense" || e.settledStatus !== 0) return false;
  const positive = e.splits.filter((s) => s.shareBaseMinor > 0);
  if (positive.length !== 2) return false;
  const payer = members.find((m) => m.id === e.paidByMemberId);
  const partner = positive.find((s) => s.memberId !== e.paidByMemberId);
  const p = partner ? members.find((m) => m.id === partner.memberId) : undefined;
  return Boolean(payer?.coupleId != null && p && payer.coupleId === p.coupleId && couples.some((c) => c.id === payer.coupleId));
}
