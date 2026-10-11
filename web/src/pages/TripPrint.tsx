import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { trips as tripsApi } from "../api/endpoints";
import type { Traveler, TripDetail, TripEvent } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import { useCatalog } from "../state/catalog";
import { daysBetween, formatDate, formatDateRange, formatDayHeading, formatTimestamp } from "../lib/dates";
import { detailSections, keyFacts, referenceOf, summaryLine, type DetailRow } from "../lib/eventUi";
import { eventMapPoints } from "../lib/maps";
import { formatMoney, formatTotals } from "../lib/money";
import { groupEventsByDay, tripSpan } from "../lib/plan";
import { MapView } from "../map/MapView";
import { typeInfo } from "../trip/EventTicket";
import { Button } from "../ui/Button";
import { ErrorState, Spinner } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import type { Catalog } from "../lib/catalog";
import "../styles/print.css";

type Variant = "full" | "compact";

/** Nur bestätigte Ereignisse kommen in den Ausdruck (keine Vorschläge, nichts «Zu prüfen»). */
export const isPrintable = (e: TripEvent): boolean => !e.status || e.status === "confirmed";

/** Druckansicht einer Reise (A4): «Ausführlich» mit allen Angaben je Ereignis, «Kompakt» als Tagesliste. */
export function TripPrintPage() {
  const { id } = useParams();
  const tripId = Number(id);
  const valid = Number.isInteger(tripId) && tripId > 0;
  const q = useQuery((s) => (valid ? tripsApi.get(tripId, s) : Promise.reject(new Error("Ungültige Reise"))), [tripId]);

  // Der Ausdruck ist immer hell, unabhängig vom eingestellten Thema.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    return () => {
      if (before == null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", before);
    };
  }, []);

  if (!valid) return <div className="page"><ErrorState error={new Error("Ungültige Reise")} /></div>;
  return (
    <QueryView query={q} skeleton={<div className="print-loading"><Spinner label="Reise wird geladen …" /></div>}>
      {(data) => <PrintView data={data} />}
    </QueryView>
  );
}

export function PrintView({ data }: { data: TripDetail }) {
  const { trip, travelers } = data;
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const variant: Variant = params.get("v") === "compact" ? "compact" : "full";
  const maps = useMapsEnabled();
  const [mapState, setMapState] = useState<"loading" | "ready" | "off" | "error">("loading");
  const events = useMemo(() => data.events.filter(isPrintable), [data.events]);
  const groups = useMemo(() => groupEventsByDay(events), [events]);
  const span = tripSpan(trip, events);
  const points = useMemo(
    () => eventMapPoints(events, (e) => `var(--k-${typeInfo(catalog, e).color})`),
    [events, catalog]
  );
  const showMap = maps === true && points.length > 0;
  const mapPending = showMap && mapState === "loading";

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const label = typeInfo(catalog, e).label;
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [events, catalog]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const e of events) if (e.priceMinor != null) t[e.currency || trip.homeCurrency || "CHF"] = (t[e.currency || trip.homeCurrency || "CHF"] ?? 0) + e.priceMinor;
    return t;
  }, [events, trip.homeCurrency]);
  const stand = formatTimestamp(new Date().toISOString());
  const refs = events.filter((e) => e.bookingReference || e.details?.confirmationNumber);

  return (
    <div className="print-root">
      <div className="print-toolbar">
        <Link className="btn btn--ghost btn--m" to={`/trips/${trip.id}`}>
          <Icon name="arrow-left" size={18} />
          <span>Zur Reise</span>
        </Link>
        <div className="print-toolbar__variants" role="group" aria-label="Variante">
          {(["full", "compact"] as const).map((v) => (
            <button key={v} type="button" className={`print-toolbar__opt${variant === v ? " is-on" : ""}`} aria-pressed={variant === v} onClick={() => setParams(v === "full" ? {} : { v }, { replace: true })}>
              {v === "full" ? "Ausführlich" : "Kompakt"}
            </button>
          ))}
        </div>
        <Button variant="primary" icon="download" disabled={mapPending} onClick={() => window.print()}>
          {mapPending ? "Karte wird geladen …" : "Drucken / Als PDF"}
        </Button>
        <p className="print-toolbar__hint">Im Druckdialog «Kopf- und Fusszeilen» ausschalten und «Hintergrundgrafiken» einschalten.</p>
      </div>

      <main className="sheet">
        <header className="sheet__cover">
          <div className="eyebrow">Reiseplan</div>
          <h1>{trip.title}</h1>
          <div className="sheet__meta">
            {trip.destination ? <span><Icon name="pin" size={15} /> {trip.destination}</span> : null}
            {span ? <span><Icon name="calendar" size={15} /> {formatDateRange(span.start, span.end)} · {span.days} {span.days === 1 ? "Tag" : "Tage"}</span> : null}
            {travelers.length > 0 ? <span><Icon name="users" size={15} /> {travelers.map((t) => t.displayName).join(", ")}</span> : null}
          </div>
        </header>

        <section className="sheet__sum" aria-label="Übersicht">
          {counts.map(([label, n]) => (
            <div key={label}><span className="k">{label}</span><span className="v">{n}</span></div>
          ))}
          {Object.keys(totals).length > 0 ? (
            <div className="sheet__sum-total"><span className="k">Gesamtpreis</span><span className="v">{formatTotals(totals)}</span></div>
          ) : null}
        </section>

        {showMap ? (
          <section className="sheet__map" aria-label="Karte">
            <MapView points={points} route numbered compact height={320} label={`Karte der Reise ${trip.title}`} onStatus={setMapState} />
          </section>
        ) : null}

        {groups.length === 0 ? <p className="muted">Keine bestätigten Ereignisse.</p> : null}
        {groups.map((g) => (
          <section className="day" key={g.date ?? "none"}>
            <h2>
              <span><Icon name="calendar" size={16} /> {formatDayHeading(g.date)}</span>
              {g.date && span ? <span className="day__n">Tag {daysBetween(span.start, g.date) + 1}</span> : null}
            </h2>
            {variant === "full"
              ? g.events.map((e) => <FullEvent key={e.id} e={e} catalog={catalog} travelers={travelers} />)
              : <CompactDay events={g.events} catalog={catalog} travelers={travelers} />}
          </section>
        ))}

        {variant === "full" && refs.length > 0 ? (
          <section className="day refs">
            <h2><span><Icon name="file" size={16} /> Buchungsreferenzen auf einen Blick</span></h2>
            <table>
              <thead><tr><th>Art</th><th>Leistung</th><th>Referenz</th><th>Datum</th></tr></thead>
              <tbody>
                {refs.map((e) => (
                  <tr key={e.id}>
                    <td>{typeInfo(catalog, e).label}</td>
                    <td>{e.title}</td>
                    <td className="mono">{String(e.bookingReference || e.details?.confirmationNumber || "")}</td>
                    <td>{e.startDate ? formatDate(e.startDate) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="sheet__foot">
          <span>{trip.title} · Stand {stand}</span>
          <span>TravelBuddy</span>
        </footer>
      </main>
    </div>
  );
}

const timeOf = (e: TripEvent): string => {
  const a = e.startTime ?? "";
  const b = e.endTime && e.endDate === e.startDate ? e.endTime : "";
  return a && b ? `${a} → ${b}` : a;
};

function rowsOf(catalog: Catalog, e: TripEvent, travelers: Traveler[]): DetailRow[] {
  const money = (m: number, c: string) => formatMoney(m, c);
  const secs = detailSections(catalog, e, travelers, money, formatDate);
  const out: DetailRow[] = [];
  for (const s of secs) {
    for (const r of s.rows) {
      if (r.key === "startDate") continue; // steht in der Kopfzeile
      if (r.key === "participantIds") continue;
      if (r.key === "priceMinor" || r.key === "bookingReference") continue; // stehen im Kopf des Tickets
      out.push(r);
    }
  }
  return out;
}

function FullEvent({ e, catalog, travelers }: { e: TripEvent; catalog: Catalog; travelers: Traveler[] }) {
  const info = typeInfo(catalog, e);
  const ref = referenceOf(e);
  const sum = summaryLine(catalog, e);
  const rows = rowsOf(catalog, e, travelers);
  const price = e.priceMinor != null ? formatMoney(e.priceMinor, e.currency || "CHF") : null;
  return (
    <article className="ev" style={{ ["--c" as string]: `var(--k-${info.color})` }}>
      <header>
        <span className="ev__ico"><Icon name={info.icon} size={18} /></span>
        <span className="ev__typ">{info.label}</span>
        {ref ? <span className="ev__ref">{ref}</span> : null}
      </header>
      <div className="ev__main">
        <div className="ev__time">{timeOf(e) || "–"}</div>
        <div className="ev__ttl">
          <h3>{e.title}</h3>
          {sum ? <p>{sum}</p> : null}
        </div>
        {price ? <div className="ev__price">{price}</div> : null}
      </div>
      {rows.length > 0 ? (
        <dl className="ev__facts">
          {rows.map((r) => (
            <div key={`${r.scope}-${r.key}`} className={r.value.includes("\n") || r.value.length > 60 || r.key === "notes" ? "wide" : ""}>
              <dt>{r.label}</dt>
              <dd className={r.mono ? "mono" : ""}>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

function CompactDay({ events, catalog, travelers }: { events: TripEvent[]; catalog: Catalog; travelers: Traveler[] }) {
  return (
    <table className="cmp">
      <tbody>
        {events.map((e) => {
          const info = typeInfo(catalog, e);
          const sum = summaryLine(catalog, e);
          const factList = keyFacts(catalog, e, { travelers, max: 4 });
          const facts = factList.map((f) => `${f.label} ${f.value}`);
          const addrShown = e.address ? factList.some((f) => f.value.includes(e.address!)) : true;
          const ref = referenceOf(e);
          return (
            <tr key={e.id} style={{ ["--c" as string]: `var(--k-${info.color})` }}>
              <td className="cmp__time">{timeOf(e) || "–"}</td>
              <td className="cmp__ico"><Icon name={info.icon} size={16} /></td>
              <td className="cmp__main">
                <strong>{e.title}</strong>
                {sum ? <span className="muted"> · {sum}</span> : null}
                {facts.length > 0 ? <div className="cmp__facts">{facts.join(" · ")}</div> : null}
                {e.address && !addrShown ? <div className="cmp__facts">{e.address}</div> : null}
              </td>
              <td className="cmp__ref mono">{ref}</td>
              <td className="cmp__price mono">{e.priceMinor != null ? formatMoney(e.priceMinor, e.currency || "CHF") : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
