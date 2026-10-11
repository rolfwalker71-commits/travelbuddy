import { useState, type ReactNode } from "react";
import type { Traveler, TripEvent } from "../api/types";
import { getType, type Catalog } from "../lib/catalog";
import { formatDate } from "../lib/dates";
import { keyFacts, referenceOf, routeOf, summaryLine, timeLine } from "../lib/eventUi";
import { shownLabel, shownTime } from "../lib/today";
import { Chip } from "../ui/Chip";
import { catalogIcon, eventIcon } from "../ui/Icon";
import { TicketCard } from "../ui/TicketCard";
import { ImageLightbox } from "../ui/ImageLightbox";
import { MediaImage } from "../ui/MediaImage";
import { eventImageVisible, useShowGeneratedEventImages } from "../lib/prefs";

/** Typ-Angaben (Farbe, Icon, Beschriftung) eines Ereignisses aus dem Katalog; mit Rückfall für unbekannte Typen. */
export function typeInfo(catalog: Catalog, e: Pick<TripEvent, "type">) {
  const t = getType(catalog, e.type);
  return {
    color: t?.color ?? "doc",
    icon: t ? catalogIcon(t.icon) : eventIcon(e.type),
    label: t?.label ?? e.type,
    start: t?.startLabel ?? "Beginn",
    end: t?.endLabel ?? "Ende",
  };
}

export function statusChips(e: TripEvent): ReactNode {
  if (e.status === "needs_review") return <Chip tone="review" icon="alert">Zu prüfen</Chip>;
  if (e.status === "proposed") return <Chip tone="proposal" icon="sparkle">Vorschlag</Chip>;
  return null;
}

/**
 * Ereignis als Ticket-Karte: Kopfband mit Typ und Referenz, Zeiten gross, Wichtiges je Typ, Abrissstreifen.
 * Ohne `to` ist die Karte nicht anklickbar (Gast-Ansicht).
 */
/** Kleines KI-/eigenes Bild des Ereignisses; Klick vergrössert. */
function EventThumb({ event: e }: { event: TripEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MediaImage src={e.imageUrl} variant="thumb" alt={e.title} openLabel={`Bild vergrössern: ${e.title}`} onOpen={() => setOpen(true)} className="evthumb" />
      <ImageLightbox open={open} onClose={() => setOpen(false)} src={e.imageUrl} title={e.title} />
    </>
  );
}

export function EventTicket({
  catalog,
  event: e,
  tripTz,
  travelers = [],
  meId = null,
  to,
  active,
  soft,
  stub,
  showDate = false,
  badges,
  maxFacts = 4,
}: {
  catalog: Catalog;
  event: TripEvent;
  tripTz: string;
  travelers?: Traveler[];
  meId?: number | null;
  to?: string;
  active?: boolean;
  soft?: boolean;
  stub?: ReactNode;
  showDate?: boolean;
  badges?: ReactNode;
  maxFacts?: number;
}) {
  const showGenerated = useShowGeneratedEventImages();
  const info = typeInfo(catalog, e);
  const tl = timeLine(e, tripTz);
  const route = routeOf(e);
  const sum = summaryLine(catalog, e);
  const facts = keyFacts(catalog, e, { meId, travelers, max: maxFacts });
  const multi = e.endDate && e.startDate && e.endDate !== e.startDate;
  const role = e.dayRole;
  const label = shownLabel(e);
  const time = shownTime(e);
  const roleZone = role === "end" ? tl.endZone : role === "start" ? tl.startZone : null;
  // Mehrtägige Ereignisse in der Tagesansicht: nur der Zeitpunkt dieses Tages («Check-out 12:00»), sonst «Aufenthalt»
  const main =
    role === "middle" ? (
      <small className="ticket__state">{label}</small>
    ) : role === "start" || role === "end" ? (
      <>
        {label ? <small className="ticket__rolelabel">{label}</small> : null}
        {time ? <span>{time}</span> : null}
        {roleZone ? <small>Ortszeit {roleZone}</small> : null}
        {route ? (
          <small className="num">
            {route.from} → {route.to}
          </small>
        ) : null}
      </>
    ) : tl.start || tl.end || route ? (
      <>
        {tl.start ? <span>{tl.start}</span> : null}
        {tl.start && tl.end ? <span className="sep">→</span> : null}
        {tl.end ? <span>{tl.end}</span> : null}
        {multi ? <small>bis {formatDate(e.endDate)}</small> : null}
        {route ? (
          <small className="num">
            {route.from} → {route.to}
          </small>
        ) : null}
        {tl.startZone || tl.endZone ? <small>Ortszeit {[tl.startZone, tl.endZone].filter(Boolean).filter((z, i, a) => a.indexOf(z) === i).join(" / ")}</small> : null}
      </>
    ) : null;
  return (
    <TicketCard
      id={`ev-${e.id}`}
      kind={info.color}
      icon={info.icon}
      label={info.label}
      reference={referenceOf(e)}
      badges={
        <>
          {active ? <Chip tone="now">Jetzt</Chip> : null}
          {statusChips(e)}
          {badges}
        </>
      }
      title={
        <>
          {showDate && e.startDate ? <span className="ticket__date num">{formatDate(e.startDate)} · </span> : null}
          {e.title}
        </>
      }
      main={main}
      facts={facts}
      stub={stub}
      to={to}
      active={active}
      soft={soft}
      dashed={e.status === "proposed" || e.status === "needs_review"}
      thumb={e.imageUrl && eventImageVisible(e.imageSource, showGenerated) ? <EventThumb event={e} /> : undefined}
    >
      {sum ? <p className="ticket__sum muted">{sum}</p> : null}
    </TicketCard>
  );
}
