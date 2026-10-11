import { LedgerView } from "../../ledger/LedgerView";
import { EmptyState } from "../../ui/Feedback";
import { useTripCtx } from "./context";

export function LedgerTab() {
  const { data, reload } = useTripCtx();
  const id = data.trip.ledgerId;
  if (id == null) {
    return (
      <div className="card">
        <EmptyState icon="wallet" title="Keine Reisekasse">
          Zu dieser Reise gehört noch keine Reisekasse. Neue Reisen bekommen sie automatisch; bei älteren legt der Server sie beim
          nächsten Öffnen an.
        </EmptyState>
      </div>
    );
  }
  return <LedgerView ledgerId={id} onChanged={reload} />;
}
