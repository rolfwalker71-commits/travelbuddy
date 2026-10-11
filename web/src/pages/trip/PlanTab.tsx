import { useMemo } from "react";
import { Link } from "react-router-dom";
import { trips as api } from "../../api/endpoints";
import type { TripEvent } from "../../api/types";
import { errorMessage } from "../../api/client";
import { daysBetween, formatDayHeading, relativeDays, todayIso } from "../../lib/dates";
import { canSwap, groupEventsByDay, moveEvent, tripSpan } from "../../lib/plan";
import { useMapsEnabled } from "../../hooks/useMapsEnabled";
import { eventMapPoints } from "../../lib/maps";
import { MapView } from "../../map/MapView";
import { EventTicket, typeInfo } from "../../trip/EventTicket";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { HelpCard, IllustrationCard } from "../../ui/IllustrationCard";
import { Chip } from "../../ui/Chip";
import { Section } from "../../ui/bits";
import { useToast } from "../../ui/Toast";
import { RouteArc } from "../../viz/RouteArc";
import { TimeBand } from "../../viz/TimeBand";
import { TripNumbersCard } from "../../viz/TripNumbers";
import { useTripCtx } from "./context";

export function PlanTab() {
  const ctx = useTripCtx();
  const { data, catalog, tripTz, isAdmin, meId } = ctx;
  const { trip, events, travelers } = data;
  const toast = useToast();
  const today = todayIso();
  const days = groupEventsByDay(events);
  const span = tripSpan(trip, events);
  const proposals = events.filter((e) => e.status && e.status !== "confirmed");
  const nextId = nextEventId(events, today);
  const maps = useMapsEnabled();
  const routePoints = useMemo(
    () => eventMapPoints(events, (e) => `var(--k-${typeInfo(catalog, e).color})`),
    [events, catalog]
  );

  const move = async (e: TripEvent, dir: -1 | 1) => {
    const ids = moveEvent(events, e.id, dir);
    if (!ids) return;
    try {
      ctx.apply(await api.reorder(trip.id, ids));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  if (events.length === 0) {
    return (
      <div className="card empty--illu empty">
        <IllustrationCard id="empty-day" decorative />
        <div className="empty__text">
          <h3>Noch keine Ereignisse</h3>
          <p className="muted">
            {isAdmin
              ? "Lade eine Buchungsbestätigung hoch oder lege ein Ereignis von Hand an. Alles erscheint nach Tagen geordnet."
              : "Für diese Reise wurden noch keine Ereignisse erfasst."}
          </p>
          {isAdmin ? (
            <div className="row__badges">
              <Button variant="primary" icon="plus" onClick={() => ctx.openEventForm(null)}>
                Ereignis hinzufügen
              </Button>
              <Link className="btn btn--secondary btn--m" to={`/trips/${trip.id}/documents`}>
                <Icon name="upload" size={18} />
                <span>Dokument hochladen</span>
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="plan">
      {span ? (
        <section className="card viz-card" aria-label="Verlauf der Reise">
          <h3 className="label">Verlauf</h3>
          <TimeBand events={events} span={span} today={today} />
        </section>
      ) : null}

      {proposals.length > 0 ? (
        <div className="banner banner--info" role="status">
          <Icon name="sparkle" size={18} />
          <div className="banner__text">
            {proposals.length === 1 ? "1 Vorschlag wartet" : `${proposals.length} Vorschläge warten`} auf die Prüfung. Vorschläge sind im Plan gestrichelt markiert und zählen erst nach der Übernahme.
          </div>
          <Link className="btn btn--secondary btn--s" to={`/trips/${trip.id}/documents#review`}>
            Prüfen
          </Link>
        </div>
      ) : null}

      <div className="trip-layout">
        <div className="trip-main">
          <Section
            title="Plan"
            id="sec-plan"
            actions={
              <span className="row__badges">
                {days.some((d) => d.date === today) ? (
                  <Button size="s" icon="calendar" onClick={() => document.getElementById(`day-${today}`)?.scrollIntoView({ block: "start" })}>
                    Zu heute
                  </Button>
                ) : null}
                {isAdmin ? (
                  <Button size="s" icon="plus" onClick={() => ctx.openEventForm(null)}>
                    Ereignis
                  </Button>
                ) : null}
              </span>
            }
          >
            <ol className="timeline">
              {days.map((day) => {
                const isToday = day.date === today;
                const idx = day.date && span ? daysBetween(span.start, day.date) + 1 : null;
                return (
                  <li key={day.date ?? "none"} className="day" id={day.date ? `day-${day.date}` : undefined}>
                    <div className={`day__head${isToday ? " is-today" : ""}`}>
                      <h3>{formatDayHeading(day.date)}</h3>
                      {day.date ? <span className="day__rel">{relativeDays(day.date, today)}</span> : null}
                      {idx != null && idx >= 1 && span && idx <= span.days ? <span className="day__no num">Tag {idx}</span> : null}
                      {day.date ? (
                        <Link className="link-btn day__view" to={`/trips/${trip.id}/day/${day.date}`}>
                          <Icon name="compass" size={14} /> Tag ansehen
                        </Link>
                      ) : null}
                      {isAdmin && day.date ? (
                        <button type="button" className="link-btn day__add" onClick={() => ctx.openEventForm(null, { defaultDate: day.date })}>
                          <Icon name="plus" size={14} /> Ereignis
                        </button>
                      ) : null}
                    </div>
                    <ul className="day__events">
                      {day.events.map((e, i) => (
                        <li key={e.id}>
                          <EventTicket
                            catalog={catalog}
                            event={e}
                            tripTz={tripTz}
                            travelers={travelers}
                            meId={meId}
                            to={`/trips/${trip.id}/events/${e.id}`}
                            active={e.id === nextId && isToday}
                            stub={
                              <>
                                {e.documentIds.length > 0 ? (
                                  <Chip icon="file">{e.documentIds.length} {e.documentIds.length === 1 ? "Dokument" : "Dokumente"}</Chip>
                                ) : null}
                                {e.comments.length > 0 ? <Chip icon="message">{e.comments.length}</Chip> : null}
                                {e.priceMinor != null && e.paymentStatus ? (
                                  <Chip icon="wallet" tone={e.paymentStatus === "paid" ? "pos" : "neutral"}>
                                    {e.paymentStatus === "paid" ? "Bezahlt" : e.paymentStatus === "deposit" ? "Anzahlung" : e.paymentStatus === "onsite" ? "Vor Ort" : "Offen"}
                                  </Chip>
                                ) : null}
                                {isAdmin ? (
                                  <span className="ticket__tools">
                                    <IconButton icon="arrow-up" label="Nach oben" size="s" disabled={!canSwap(day.events[i - 1], e)} onClick={() => void move(e, -1)} />
                                    <IconButton icon="arrow-down" label="Nach unten" size="s" disabled={!canSwap(e, day.events[i + 1])} onClick={() => void move(e, 1)} />
                                    <IconButton icon="edit" label={`${e.title} bearbeiten`} size="s" onClick={() => ctx.openEventForm(e)} />
                                  </span>
                                ) : null}
                              </>
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>
        <aside className="trip-side" aria-label="Kennzahlen und Hilfe">
          <TripNumbersCard events={events} span={span} />
          <section className="card viz-card" aria-label="Routenbogen">
            <h3 className="label">Route</h3>
            {maps === true && routePoints.length > 0 ? (
              <MapView points={routePoints} route numbered compact height={280} label={`Karte der Reise ${trip.title}`} />
            ) : (
              <RouteArc events={events} />
            )}
          </section>
          <HelpCard id="help-timezones" defaultOpen={false} />
        </aside>
      </div>
    </div>
  );
}

/** Nächstes Ereignis ab jetzt am heutigen Tag (für die Hervorhebung «Jetzt»). */
function nextEventId(events: TripEvent[], today: string): number | null {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const list = events
    .filter((e) => e.startDate === today && (!e.status || e.status === "confirmed") && e.startTime && e.startTime >= hhmm)
    .sort((a, b) => (a.startTime! < b.startTime! ? -1 : 1));
  return list[0]?.id ?? null;
}
