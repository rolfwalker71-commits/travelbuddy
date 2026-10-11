import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { trips as tripsApi } from "../api/endpoints";
import type { Traveler, TripDetail, TripEvent } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { useCatalog } from "../state/catalog";
import { daysBetween, formatDate, formatDateRange, formatDayHeading, formatTimestamp } from "../lib/dates";
import { detailSections, keyFacts, referenceOf, summaryLine, type DetailRow } from "../lib/eventUi";
import { findField } from "../lib/catalog";
import type { IconName } from "../ui/Icon";
import { groupEventsByDay, tripSpan } from "../lib/plan";
import { MediaImage } from "../ui/MediaImage";
import { CoverIllustration } from "../ui/IllustrationCard";
import { coverIdFor } from "../lib/illustrations";
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
  const events = useMemo(() => data.events.filter(isPrintable), [data.events]);
  const groups = useMemo(() => groupEventsByDay(events), [events]);
  const span = tripSpan(trip, events);

  const counts = useMemo(() => {
    const m = new Map<string, [number, IconName]>();
    for (const e of events) {
      const i = typeInfo(catalog, e);
      m.set(i.label, [(m.get(i.label)?.[0] ?? 0) + 1, i.icon]);
    }
    return [...m.entries()].map(([label, [n, icon]]) => [label, n, icon] as const);
  }, [events, catalog]);
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
        <Button variant="primary" icon="download" onClick={() => window.print()}>
          Drucken / Als PDF
        </Button>
        <p className="print-toolbar__hint">Im Druckdialog «Kopf- und Fusszeilen» ausschalten und «Hintergrundgrafiken» einschalten.</p>
      </div>

      <main className="sheet">
        <header className="sheet__cover">
          {trip.coverUrl ? (
            <MediaImage src={trip.coverUrl} variant="cover" lazy={false} className="sheet__hero" />
          ) : (
            <div className="sheet__hero"><CoverIllustration id={coverIdFor(trip, events)} /></div>
          )}
          <div className="eyebrow"><Icon name="compass" size={15} /> Reiseplan</div>
          <h1>{trip.title}</h1>
          <div className="sheet__meta">
            {trip.destination ? <span><Icon name="pin" size={16} /> {trip.destination}</span> : null}
            {span ? <span><Icon name="calendar" size={16} /> {formatDateRange(span.start, span.end)} · {span.days} {span.days === 1 ? "Tag" : "Tage"}</span> : null}
            {travelers.length > 0 ? <span><Icon name="users" size={16} /> {travelers.map((t) => t.displayName).join(", ")}</span> : null}
          </div>
        </header>

        <section className="sheet__sum" aria-label="Übersicht">
          {counts.map(([label, n, icon]) => (
            <div key={label}><span className="k"><Icon name={icon} size={16} /> {label}</span><span className="v">{n}</span></div>
          ))}
        </section>

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

/** Symbol je Angabe nach Feldschlüssel, sonst nach Bezeichnung. */
function rowIcon(key: string, label: string): IconName {
  const k = `${key} ${label}`.toLowerCase();
  if (/phone|telefon|contact|kontakt/.test(k)) return "phone";
  if (/website|url/.test(k)) return "globe";
  if (/wifi|wlan|code|zugang|schlüssel|pin\b/.test(k)) return "lock";
  if (/passenger|passagier|guests|gäste|participant|wer ist dabei|personen/.test(k)) return "users";
  if (/notes|notiz|hinweis/.test(k)) return "message";
  if (/address|adresse|place|ort\b|location|venue|station|terminal|airport|flughafen|hafen|meeting|treffpunkt/.test(k)) return "pin";
  if (/gate|platform|gleis|check-?in|check-?out|boarding/.test(k)) return "flag";
  if (/seat|sitz|kabine|cabin|zimmer|room|deck/.test(k)) return "ticket";
  if (/reference|referenz|booking|buchung|reservierung|reservation|confirmation|bestätigung|voucher|policy|police|number|nummer/.test(k)) return "receipt";
  if (/date|datum|start|ende|end|beginn|ankunft|abflug|dauer|duration|time|zeit|from|until|bis|ab\b/.test(k)) return "clock";
  if (/airline|operator|provider|anbieter|gesellschaft|reederei|vermieter|company/.test(k)) return "tag";
  if (/insurance|versicherung|visa|visum|pass/.test(k)) return "shield";
  if (/meal|verpflegung|board|frühstück|restaurant/.test(k)) return "fork";
  return "info";
}

function rowsOf(catalog: Catalog, e: TripEvent, travelers: Traveler[]): DetailRow[] {
  const secs = detailSections(catalog, e, travelers, () => "", formatDate);
  const out: DetailRow[] = [];
  for (const s of secs) {
    if (s.id === "kosten") continue; // Preise und Zahlungsstatus gehören nicht auf den Ausdruck
    for (const r of s.rows) {
      if (r.scope === "details" && findField(catalog, e.type, r.key)?.kind === "money") continue;
      if (r.key === "startDate") continue; // steht in der Kopfzeile
      if (r.key === "participantIds") continue;
      if (r.key === "bookingReference") continue; // steht im Kopf des Tickets
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
  return (
    <article className="ev" style={{ ["--c" as string]: `var(--k-${info.color})` }}>
      <header>
        <span className="ev__ico"><Icon name={info.icon} size={21} /></span>
        <span className="ev__typ">{info.label}</span>
        {ref ? <span className="ev__ref">{ref}</span> : null}
      </header>
      <div className="ev__main">
        <div className="ev__time">{timeOf(e) || "–"}</div>
        <div className="ev__ttl">
          <h3>{e.title}</h3>
          {sum ? <p>{sum}</p> : null}
        </div>
      </div>
      {rows.length > 0 ? (
        <dl className="ev__facts">
          {rows.map((r) => (
            <div key={`${r.scope}-${r.key}`} className={r.value.includes("\n") || r.value.length > 60 || r.key === "notes" ? "wide" : ""}>
              <dt><Icon name={rowIcon(r.key, r.label)} size={15} /> {r.label}</dt>
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
          const factList = keyFacts(catalog, e, { travelers, max: 5 });
          const items: { icon: IconName; text: string }[] = factList.map((f) => ({ icon: rowIcon(f.label, f.label), text: `${f.label} ${f.value}` }));
          if (e.address && !factList.some((f) => f.value.includes(e.address!))) items.unshift({ icon: "pin", text: e.address });
          if (e.phone && !factList.some((f) => f.value.includes(e.phone!))) items.push({ icon: "phone", text: e.phone });
          const ref = referenceOf(e);
          return (
            <tr key={e.id} style={{ ["--c" as string]: `var(--k-${info.color})` }}>
              <td className="cmp__time">{timeOf(e) || "–"}</td>
              <td className="cmp__ico"><Icon name={info.icon} size={19} /></td>
              <td className="cmp__main">
                <strong>{e.title}</strong>
                {sum ? <span className="muted"> · {sum}</span> : null}
                {items.length > 0 ? (
                  <div className="cmp__facts">
                    {items.map((it, i) => (
                      <span key={i} className="cmp__fact"><Icon name={it.icon} size={14} /> {it.text}</span>
                    ))}
                  </div>
                ) : null}
              </td>
              <td className="cmp__ref mono">{ref}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
