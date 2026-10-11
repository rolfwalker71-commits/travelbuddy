import type { TripEvent } from "../api/types";
import type { TripSpan } from "../lib/plan";
import { formatInt } from "../lib/money";
import { fmtDuration } from "../lib/today";
import { tripNumbers } from "../lib/viz";
import { Stat } from "../ui/Stat";

const nf = { format: formatInt };

/** «Reise in Zahlen»: Tage, Nächte, Kilometer, Flugzeit, Häfen, Länder. */
export function TripNumbersCard({ events, span }: { events: TripEvent[]; span: TripSpan | null }) {
  const n = tripNumbers(events, span);
  const items: { label: string; value: string; sub?: string }[] = [];
  if (n.days > 0) items.push({ label: "Tage", value: nf.format(n.days) });
  if (n.nights > 0) items.push({ label: "Nächte", value: nf.format(n.nights), sub: n.stays > 0 ? `${n.stays} Unterkünfte` : undefined });
  if (n.travelKm > 0) items.push({ label: "Kilometer", value: nf.format(n.travelKm), sub: "Luftlinie zwischen Stationen" });
  if (n.flightMinutes > 0) items.push({ label: "In der Luft", value: fmtDuration(n.flightMinutes) });
  if (n.ports > 0) items.push({ label: "Häfen", value: nf.format(n.ports) });
  if (n.countries > 0) items.push({ label: "Länder", value: nf.format(n.countries), sub: "aus den Adressen" });
  items.push({ label: "Ereignisse", value: nf.format(n.events) });
  return (
    <section className="card viz-card" aria-label="Reise in Zahlen">
      <h3 className="label">Reise in Zahlen</h3>
      <div className="stat-row">
        {items.map((i) => (
          <Stat key={i.label} label={i.label} value={i.value} sub={i.sub} />
        ))}
      </div>
    </section>
  );
}
