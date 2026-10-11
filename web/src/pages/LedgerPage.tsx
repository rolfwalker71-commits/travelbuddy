import { Link, useParams } from "react-router-dom";
import { ledgers as L } from "../api/endpoints";
import { QueryView, useQuery } from "../hooks/useQuery";
import { LedgerView } from "../ledger/LedgerView";
import { ErrorState, SkeletonCards } from "../ui/Feedback";
import { PageHeader } from "../ui/bits";

/** Direktlink auf eine Reisekasse (`travelbuddy://ledger/<id>`): Kopf mit Rücksprung zur Reise. */
export function LedgerPage() {
  const { id } = useParams();
  const ledgerId = Number(id);
  const valid = Number.isInteger(ledgerId) && ledgerId > 0;
  const q = useQuery((s) => (valid ? L.overview(ledgerId, s) : Promise.reject(new Error("Ungültige Reisekasse"))), [ledgerId]);
  if (!valid) {
    return (
      <div className="page">
        <ErrorState error={new Error("Ungültige Reisekasse")} />
      </div>
    );
  }
  return (
    <div className="page">
      <QueryView query={q} skeleton={<SkeletonCards />}>
        {(o) => (
          <>
            <PageHeader
              title={o.ledger.title}
              eyebrow="Reisekasse"
              subtitle={`${o.members.length} Teilnehmer · ${o.ledger.baseCurrency}`}
              back={o.ledger.tripId != null ? `/trips/${o.ledger.tripId}/ledger` : "/trips"}
              backLabel="Zur Reise"
            />
            {o.ledger.tripId != null ? (
              <p>
                <Link to={`/trips/${o.ledger.tripId}`}>Zur Reise</Link>
              </p>
            ) : null}
            <LedgerView ledgerId={ledgerId} />
          </>
        )}
      </QueryView>
    </div>
  );
}
