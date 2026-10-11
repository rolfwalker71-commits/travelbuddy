import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { guest } from "../api/endpoints";
import type { GuestTripState, TripEvent } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { formatDateRange, formatDayHeading, relativeDays, todayIso } from "../lib/dates";
import { groupEventsByDay } from "../lib/plan";
import { useCatalog } from "../state/catalog";
import { Comments } from "../trip/Comments";
import { EventTicket } from "../trip/EventTicket";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { EmptyState, SkeletonCards } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { Section } from "../ui/bits";
import { GuestShell } from "./GuestShell";

export function GuestTripPage() {
  const { token = "" } = useParams();
  const q = useQuery((signal) => guest.trip(token, signal), [token]);

  if (q.error && q.data === undefined) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <GuestShell>
        <div className="card">
          <EmptyState
            icon="link"
            title={notFound ? "Link ungültig" : "Das hat nicht geklappt"}
            action={notFound ? undefined : <Button icon="refresh" onClick={q.reload}>Erneut versuchen</Button>}
          >
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
      {(state) => <GuestTripView token={token} state={state} setData={q.setData} />}
    </QueryView>
  );
}

function GuestEvent({ token, e, state, setData }: { token: string; e: TripEvent; state: GuestTripState; setData: (fn: (p: GuestTripState) => GuestTripState) => void }) {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  return (
    <>
      <EventTicket
        catalog={catalog}
        event={e}
        tripTz={state.trip.timezone || "Europe/Zurich"}
        travelers={state.travelers}
        meId={state.me.travelerId}
        maxFacts={6}
        stub={
          <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="message" size={16} />
            {e.comments.length === 0 ? "Kommentieren" : `${e.comments.length} Kommentar${e.comments.length === 1 ? "" : "e"}`}
            <Icon name="chevron-down" size={14} className={open ? "flip" : ""} />
          </button>
        }
      />
      {open ? (
        <div className="card guest__comments">
          <Comments
            comments={e.comments}
            onComment={async (body) => {
              const c = await guest.comment(token, e.id, body);
              setData((p) => ({ ...p, events: p.events.map((x) => (x.id === e.id ? { ...x, comments: [...x.comments, c] } : x)) }));
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function GuestTripView({
  token,
  state,
  setData,
}: {
  token: string;
  state: GuestTripState;
  setData: (fn: (p: GuestTripState) => GuestTripState) => void;
}) {
  const { trip, events, travelers, me } = state;
  const today = todayIso();
  const days = groupEventsByDay(events.filter((e) => !e.status || e.status === "confirmed"));

  return (
    <GuestShell title={trip.title} subtitle={`Hallo ${me.displayName}`}>
      <div className="guest__stack">
        <section className="card">
          <h1 className="guest-trip__title">{trip.title}</h1>
          <p className="muted">{[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(" · ")}</p>
          {trip.summary ? <p className="trip-summary">{trip.summary}</p> : null}
          <p className="row__badges">
            {travelers.map((t) => (
              <Chip key={t.id} icon="user">
                {t.displayName}
              </Chip>
            ))}
          </p>
          {trip.ledgerId != null ? (
            <p>
              <Link className="btn btn--secondary btn--m" to={`/g/${encodeURIComponent(token)}`}>
                <Icon name="wallet" size={18} />
                <span>Zur Reisekasse</span>
              </Link>
            </p>
          ) : null}
        </section>

        <Section title="Plan" id="gt-timeline">
          {days.length === 0 ? (
            <div className="card">
              <EmptyState icon="calendar" title="Noch keine Ereignisse">
                Sobald Flüge, Hotels oder Ausflüge erfasst sind, siehst du sie hier.
              </EmptyState>
            </div>
          ) : (
            <ol className="timeline">
              {days.map((day) => (
                <li key={day.date ?? "none"} className="day">
                  <div className={`day__head${day.date === today ? " is-today" : ""}`}>
                    <h3>{formatDayHeading(day.date)}</h3>
                    {day.date ? <span className="day__rel">{relativeDays(day.date, today)}</span> : null}
                  </div>
                  <ul className="day__events">
                    {day.events.map((e) => (
                      <li key={e.id}>
                        <GuestEvent token={token} e={e} state={state} setData={setData} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </GuestShell>
  );
}
