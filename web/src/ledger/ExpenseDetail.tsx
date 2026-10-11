import type { Couple, Expense, Member } from "../api/types";
import { formatDate, formatTimestamp } from "../lib/dates";
import { memberName } from "../lib/ledger";
import { formatMoney, formatRate } from "../lib/money";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Badge, Money } from "../ui/bits";
import { canSettleCouple, KeyValue, SPLIT_LABEL } from "./LedgerParts";

export function ExpenseDetailSheet({
  expense,
  members,
  couples,
  baseCurrency,
  meId,
  cashbook,
  canEdit,
  onClose,
  onEdit,
  onDelete,
  onSettleCouple,
}: {
  expense: Expense | null;
  members: Member[];
  couples: Couple[];
  baseCurrency: string;
  meId?: number | null;
  cashbook?: boolean;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  onSettleCouple?: (e: Expense) => void;
}) {
  const e = expense;
  const foreign = e ? e.currency !== baseCurrency : false;
  const who = (id: number | null) => (id == null ? "–" : id === meId ? `${memberName(members, id)} (du)` : memberName(members, id));
  return (
    <Sheet
      open={e !== null}
      onClose={onClose}
      title={e?.description || (cashbook ? "Buchung" : "Ausgabe")}
      footer={
        e && canEdit ? (
          <>
            <Button variant="danger" icon="trash" className="sheet__foot-left" onClick={() => onDelete(e)}>
              Löschen
            </Button>
            {onSettleCouple && canSettleCouple(e, members, couples) ? (
              <Button icon="check" onClick={() => onSettleCouple(e)}>
                Paar-Ausgleich
              </Button>
            ) : null}
            <Button variant="primary" icon="edit" onClick={() => onEdit(e)}>
              Bearbeiten
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Schliessen</Button>
        )
      }
    >
      {e ? (
        <div className="detail">
          <div className="detail__amount">
            <Money minor={e.amountMinor} currency={e.currency} />
            {foreign ? (
              <span className="muted small num">
                = {formatMoney(e.amountBaseMinor, baseCurrency)} (Kurs {formatRate(e.exchangeRate)})
              </span>
            ) : null}
            <span className="detail__badges">
              {e.direction === "income" ? <Badge tone="pos" icon="arrow-down">Einnahme</Badge> : null}
              {e.settledStatus === 1 ? <Badge icon="check">Ausgeglichen</Badge> : null}
              {e.settledStatus === 2 ? <Badge icon="check">Paar ausgeglichen</Badge> : null}
            </span>
          </div>
          <KeyValue
            items={[
              { label: "Datum", value: e.expenseDate ? formatDate(e.expenseDate) : null },
              { label: cashbook ? "Kategorie" : "Bezahlt von", value: cashbook ? e.category : who(e.paidByMemberId) },
              { label: "Kategorie", value: cashbook ? null : e.category },
              { label: "Aufteilung", value: cashbook ? null : SPLIT_LABEL[e.splitMode] },
              { label: "Notiz", value: e.note },
              { label: "Erfasst von", value: e.createdByMemberId != null ? who(e.createdByMemberId) : null },
              { label: "Erfasst am", value: formatTimestamp(e.createdAt) },
            ]}
          />
          {!cashbook ? (
            <>
              <h3 className="detail__h">Anteile</h3>
              <ul className="list card card--flush">
                {e.splits
                  .filter((s) => s.shareBaseMinor !== 0 || e.splitMode !== "equal")
                  .map((s) => (
                    <li key={s.memberId} className="row">
                      <span className="row__main">
                        <span className="row__title">{who(s.memberId)}</span>
                        {e.splitMode === "shares" && s.shareUnits != null ? (
                          <span className="row__sub">{String(s.shareUnits).replace(".", ",")} Anteile</span>
                        ) : null}
                      </span>
                      <span className="row__amount">
                        <Money minor={s.shareBaseMinor} currency={baseCurrency} />
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
