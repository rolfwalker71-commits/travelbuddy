import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import { accountLedgerApi, ledgers as L, today as todayApi, trips as tripsApi } from "../api/endpoints";
import type { TodayState, TripDetail, TripEvent } from "../api/types";
import { useCurrencies } from "../hooks/useDirectory";
import { QueryView, useQuery } from "../hooks/useQuery";
import { addDaysIso, formatDate, formatDayHeading, isValidIsoDate, relativeDays, todayIso } from "../lib/dates";
import { effectiveZone } from "../lib/timezones";
import { countdown, dayLabel, liveSeconds, localClock, localMinutes, ringProgress, shownLabel, shownTime, splitByNow, splitOngoing } from "../lib/today";
import { formatMoney, minorToInput, parseMinor } from "../lib/money";
import { keyFacts, referenceOf, routeOf, summaryLine, zoneDiffers } from "../lib/eventUi";
import { useAuth } from "../state/auth";
import { useCatalog } from "../state/catalog";
import { deviceZone, useToday } from "../state/today";
import { EventTicket, typeInfo } from "../trip/EventTicket";
import { Button } from "../ui/Button";
import { Banner, ErrorState, SkeletonCards } from "../ui/Feedback";
import { SelectField, TextField } from "../ui/Field";
import { HelpCard, IllustrationCard } from "../ui/IllustrationCard";
import { Icon } from "../ui/Icon";
import { Chip } from "../ui/Chip";
import { Stat } from "../ui/Stat";
import { useToast } from "../ui/Toast";
import { PageHeader, Section } from "../ui/bits";
import { DayBand } from "../viz/DayBand";
import { RouteArc } from "../viz/RouteArc";
import { MapView } from "../map/MapView";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import { eventMapPoints } from "../lib/maps";

/** Zeit-Ticker für Countdown und Jetzt-Marke (alle 20 s). */
function useNow(ms = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Startseite: bei aktiver Reise «Heute», sonst Weiterleitung zu den Reisen. */
export function TodayPage() {
  const { data, error, loading, reload } = useToday();
  if (data === undefined) {
    return (
      <div className="page">
        <SkeletonCards count={3} />
      </div>
    );
  }
  if (data === null && error) {
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }
  if (!data?.trip) return <Navigate to="/trips" replace />;
  return <TodayView state={data} refreshing={loading} reload={reload} />;
}

/** Vorschau eines Reisetags (`/trips/:id/day/:date`, `GET /v1/trips/:id/day/:date`) mit Tag-Navigation. */
export function DayPage() {
  const { id, date } = useParams();
  const tripId = Number(id);
  const valid = Number.isInteger(tripId) && tripId > 0 && isValidIsoDate(date ?? "");
  const q = useQuery<TodayState>(
    (s) => (valid ? todayApi.day(tripId, date!, deviceZone(), s) : Promise.reject(new Error("Ungültiger Tag"))),
    [tripId, date]
  );
  if (!valid) {
    return (
      <div className="page">
        <ErrorState error={new Error("Ungültiger Tag")} />
      </div>
    );
  }
  return (
    <QueryView query={q} skeleton={<div className="page"><SkeletonCards count={3} /></div>}>
      {(state) =>
        state.trip ? (
          <TodayView state={{ ...state, date: date! }} refreshing={q.refreshing} reload={q.reload} />
        ) : (
          <div className="page">
            <ErrorState error={new Error("Zu diesem Tag gibt es keine Reise.")} />
          </div>
        )
      }
    </QueryView>
  );
}

function TodayView({ state, reload }: { state: TodayState; refreshing: boolean; reload: () => void }) {
  const trip = state.trip!;
  const catalog = useCatalog();
  const { user } = useAuth();
  const now = useNow();
  const tripTz = trip.timezone || deviceZone();
  const q = useQuery<TripDetail>((s) => tripsApi.get(trip.id, s), [trip.id]);
  const travelers = q.data?.travelers ?? [];
  const meId = travelers.find((t) => t.userId != null && t.userId === user?.id)?.id ?? null;
  const nowMin = localMinutes(tripTz, now);
  // Vorschau eines anderen Tages: kein Countdown, keine Jetzt-Marke
  const live = state.date === todayIso();
  const secs = live ? liveSeconds(state, now) : null;
  const cd = countdown(secs);
  const next = live ? state.next : null;
  const { timed, ongoing } = useMemo(() => splitOngoing(state.events), [state.events]);
  const { past, rest } = useMemo(() => splitByNow(timed, live ? nowMin : -1), [timed, nowMin, live]);
  const prevDay = trip.startDate && addDaysIso(state.date, -1) >= trip.startDate ? addDaysIso(state.date, -1) : null;
  const nextDay = trip.endDate && addDaysIso(state.date, 1) <= trip.endDate ? addDaysIso(state.date, 1) : null;
  const nextInfo = next ? typeInfo(catalog, next) : null;
  const nextZone = next ? effectiveZone(next.dayRole === "end" ? next.endTz : next.startTz, tripTz) : tripTz;
  const R = 23;
  const C = 2 * Math.PI * R;
  const progress = ringProgress(secs);
  const heroFacts = next ? keyFacts(catalog, next, { meId, travelers, max: 3 }) : [];
  const route = next ? routeOf(next) : null;

  return (
    <div className="page page--today">
      <PageHeader
        eyebrow={[trip.title, dayLabel(trip)].filter(Boolean).join(" · ")}
        title={formatDayHeading(state.date)}
        subtitle={
          <>
            {trip.destination ? `${trip.destination} · ` : ""}
            {live ? (
              <>
                <span className="num">{localClock(tripTz, now)}</span> Ortszeit
              </>
            ) : (
              "Vorschau"
            )}
          </>
        }
        actions={
          <nav className="daynav" aria-label="Tag wechseln">
            {prevDay ? (
              <Link className="btn btn--secondary btn--icon" to={`/trips/${trip.id}/day/${prevDay}`} aria-label={`Vortag, ${formatDate(prevDay)}`} title={`Vortag, ${formatDate(prevDay)}`}>
                <Icon name="chevron-left" size={20} />
              </Link>
            ) : null}
            {!live ? (
              <Link className="btn btn--secondary" to="/">
                Heute
              </Link>
            ) : null}
            {nextDay ? (
              <Link className="btn btn--secondary btn--icon" to={`/trips/${trip.id}/day/${nextDay}`} aria-label={`Folgetag, ${formatDate(nextDay)}`} title={`Folgetag, ${formatDate(nextDay)}`}>
                <Icon name="chevron-right" size={20} />
              </Link>
            ) : null}
          </nav>
        }
      >
        {trip.dayCount > 0 && trip.dayCount <= 90 ? (
          <div className="daydots" role="img" aria-label={dayLabel(trip) ?? undefined}>
            {Array.from({ length: trip.dayCount }, (_, i) => (
              <i key={i} className={i + 1 < trip.dayIndex ? "is-done" : i + 1 === trip.dayIndex ? "is-now" : ""} />
            ))}
          </div>
        ) : null}
      </PageHeader>

      {state.review > 0 ? (
        <Banner
          tone="info"
          action={
            <Link className="btn btn--secondary btn--s" to={`/trips/${trip.id}/documents#review`}>
              Prüfen
            </Link>
          }
        >
          {state.review === 1 ? "1 Vorschlag wartet" : `${state.review} Vorschläge warten`} auf die Prüfung.
        </Banner>
      ) : null}

      {live ? (
      <section className="hero" aria-label="Als Nächstes">
        <span className="hero__notch hero__notch--l" aria-hidden="true" />
        <span className="hero__notch hero__notch--r" aria-hidden="true" />
        <span className="hero__label">Als Nächstes</span>
        {next && cd ? (
          <div className="hero__row">
            <svg viewBox="0 0 56 56" className="hero__ring" role="img" aria-label={`Countdown: ${cd.text}`}>
              <circle cx="28" cy="28" r={R} className="hero__r0" />
              <circle cx="28" cy="28" r={R} className="hero__r1" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 28 28)" />
              <text x="28" y={cd.unit ? 27 : 32} textAnchor="middle" className="hero__rt num">
                {cd.value}
              </text>
              {cd.unit ? (
                <text x="28" y="39" textAnchor="middle" className="hero__rs num">
                  {cd.unit}
                </text>
              ) : null}
            </svg>
            <div className="hero__text">
              <div className="hero__title">{[shownLabel(next), next.title].filter(Boolean).join(" ")}</div>
              <div className="hero__meta">
                {[nextInfo?.label, route ? `${route.from} → ${route.to}` : null, next.location].filter(Boolean).join(" · ")}
              </div>
              <div className="hero__meta hero__time">
                {shownTime(next) ?? ""}
                {zoneDiffers(nextZone, tripTz, next.dayRole === "end" ? next.endDate ?? next.startDate : next.startDate, shownTime(next)) ? ` Ortszeit ${nextZone.split("/").pop()?.replace(/_/g, " ")}` : ""}
                {summaryLine(catalog, next) ? ` · ${summaryLine(catalog, next)}` : ""}
              </div>
            </div>
            <Link className="hero__go" to={`/trips/${trip.id}/events/${next.id}`} aria-label={`${next.title}: Details`}>
              <Icon name="chevron-right" size={22} />
            </Link>
          </div>
        ) : (
          <div className="hero__row">
            <div className="hero__text">
              <div className="hero__title">Heute steht nichts mehr an</div>
              <div className="hero__meta">
                {state.tomorrow.length > 0 ? `Morgen: ${state.tomorrow[0]!.title}` : "Geniesst den Tag."}
              </div>
            </div>
          </div>
        )}
        {heroFacts.length > 0 ? (
          <dl className="hero__facts">
            {heroFacts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className={f.mono ? "num" : undefined}>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
      ) : null}

      <section className="card viz-card" aria-label="Tagesband">
        <h3 className="label">Tagesband</h3>
        <DayBand events={state.events} date={state.date} tripTz={tripTz} nowMinutes={live ? nowMin : null} title={`Tagesband ${formatDate(state.date)}`} />
      </section>

      <TodayMap events={state.events} tripId={trip.id} />

      <div className="trip-layout">
        <div className="trip-main">
          <Section title={live ? "Heute" : "Tag"} id="sec-today">
            {state.events.length === 0 ? (
              <div className="card empty--illu empty">
                <IllustrationCard id="empty-day" decorative />
                <div className="empty__text">
                  <h3>{live ? "Heute ist nichts geplant" : "An diesem Tag ist nichts geplant"}</h3>
                  <p className="muted">Ein freier Tag. Im Plan lässt sich ein Ereignis ergänzen.</p>
                  <Link className="btn btn--secondary btn--m" to={`/trips/${trip.id}`}>
                    Zum Plan
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="day__events">
                {[...past.map((e) => ({ e, soft: true })), ...rest.map((e) => ({ e, soft: false }))].map(({ e, soft }) => (
                  <li key={e.id}>
                    <EventTicket
                      catalog={catalog}
                      event={e}
                      tripTz={tripTz}
                      travelers={travelers}
                      meId={meId}
                      to={`/trips/${trip.id}/events/${e.id}`}
                      active={next?.id === e.id}
                      soft={soft}
                      maxFacts={5}
                      stub={
                        <>
                          {e.documentIds.length > 0 ? <Chip icon="file">{e.documentIds.length} Dok.</Chip> : null}
                          {referenceOf(e) ? <span className="muted xsmall num">{referenceOf(e)}</span> : null}
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {ongoing.length > 0 ? (
              <div className="ongoing">
                <h3 className="label">Aufenthalt und Unterwegs</h3>
                <ul className="list card card--flush">
                  {ongoing.map((e) => (
                    <TomorrowRow key={e.id} e={e} tripId={trip.id} />
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        </div>

        <aside className="trip-side" aria-label="Morgen, Offenes, Kasse">
          <Section title={live ? "Morgen" : "Folgetag"} id="sec-tomorrow">
            {state.tomorrow.length === 0 ? (
              <div className="card">
                <p className="muted small">Für morgen ist nichts geplant.</p>
              </div>
            ) : (
              <ul className="list card card--flush">
                {state.tomorrow.map((e) => (
                  <TomorrowRow key={e.id} e={e} tripId={trip.id} />
                ))}
              </ul>
            )}
          </Section>

          {state.tasks.length > 0 || state.deadlines.length > 0 ? (
            <Section title="Offen" id="sec-open">
              <ul className="list card card--flush">
                {state.tasks.map((t) => (
                  <li key={`t-${t.eventId}`}>
                    <Link to={`/trips/${trip.id}/events/${t.eventId}`} className="row row--button">
                      <Icon name="check" size={18} />
                      <span className="row__main">
                        <span className="row__title">{t.title}</span>
                        <span className="row__sub">{t.dueDate ? `Fällig ${formatDate(t.dueDate)}` : "Aufgabe"}</span>
                      </span>
                      <Icon name="chevron-right" size={18} className="row__chev" />
                    </Link>
                  </li>
                ))}
                {state.deadlines.map((d) => (
                  <li key={`d-${d.eventId}-${d.kind}`}>
                    <Link to={`/trips/${trip.id}/events/${d.eventId}`} className="row row--button">
                      <Icon name="clock" size={18} />
                      <span className="row__main">
                        <span className="row__title">{d.title}</span>
                        <span className="row__sub">
                          {d.kind === "cancel" ? "Stornofrist" : "Zahlungsfrist"} {formatDate(d.date)} · {relativeDays(d.date, state.date)}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={18} className="row__chev" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {state.ledger ? (
            <Section title="Reisekasse" id="sec-ledger">
              <QuickExpense ledger={state.ledger} date={state.date} onSaved={reload} />
            </Section>
          ) : null}

          <HelpCard id="help-today" defaultOpen={false} />
        </aside>
      </div>
    </div>
  );
}

/** Orte des Tages: Apple Karten mit Route, ohne Schlüssel der schematische Routenbogen (nur bei mindestens zwei Orten). */
function TodayMap({ events, tripId }: { events: TripEvent[]; tripId: number }) {
  const catalog = useCatalog();
  const maps = useMapsEnabled();
  const points = useMemo(() => eventMapPoints(events, (e) => `var(--k-${typeInfo(catalog, e).color})`), [events, catalog]);
  if (points.length === 0 || maps === null) return null;
  if (maps === false && points.filter((p) => p.lat != null).length < 2) return null;
  return (
    <section className="card todaymap" aria-label="Karte der heutigen Orte">
      <div className="viz__cap">
        <h3 className="label">Orte heute</h3>
        <Link to={`/trips/${tripId}/map`} className="link-btn">
          Ganze Reise
        </Link>
      </div>
      {maps ? <MapView points={points} route numbered label="Karte der heutigen Orte" height={280} /> : <RouteArc events={events} title="Routenbogen heute" height={200} />}
    </section>
  );
}

function TomorrowRow({ e, tripId }: { e: TripEvent; tripId: number }) {
  const catalog = useCatalog();
  const info = typeInfo(catalog, e);
  return (
    <li>
      <Link to={`/trips/${tripId}/events/${e.id}`} className="row row--button">
        <span className="event__icon" style={{ background: `var(--k-${info.color})`, color: "#fff" }} aria-hidden="true">
          <Icon name={info.icon} size={16} />
        </span>
        <span className="row__main">
          <span className="row__title">{e.title}</span>
          <span className="row__sub num">
            {e.dayRole === "middle"
              ? shownLabel(e)
              : e.dayRole === "start" || e.dayRole === "end"
                ? `${shownLabel(e) ?? ""} ${shownTime(e) ?? ""}`.trim() || "ganztägig"
                : `${e.startTime ?? "ganztägig"}${e.endTime ? ` – ${e.endTime}` : ""}`}
            {" · "}
            {info.label}
          </span>
        </span>
        <Icon name="chevron-right" size={18} className="row__chev" />
      </Link>
    </li>
  );
}

/** Schnelleingabe: Betrag, Währung, Text; gleichmässig auf alle verteilt, bezahlt von mir. */
function QuickExpense({ ledger, date, onSaved }: { ledger: NonNullable<TodayState["ledger"]>; date: string; onSaved: () => void }) {
  const toast = useToast();
  const currencies = useCurrencies();
  // Der Server nennt den eigenen Teilnehmer in `ledger.myMemberId`; die Übersicht ist nur der Rückfall.
  const overview = useQuery((s) => (ledger.myMemberId != null ? Promise.resolve(null) : L.overview(ledger.id, s)), [ledger.id, ledger.myMemberId]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(ledger.currency);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const p = parseMinor(amount, currency);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    const payer = ledger.myMemberId ?? overview.data?.myMemberId ?? overview.data?.members[0]?.id;
    if (payer == null) {
      setError("Zahler konnte nicht bestimmt werden. Bitte die Reisekasse öffnen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountLedgerApi(ledger.id).createExpense({
        paidByMemberId: payer,
        amountMinor: p.minor,
        currency,
        description: text.trim() || null,
        expenseDate: date,
        split: { mode: "equal" },
      });
      toast("Ausgabe erfasst");
      setAmount("");
      setText("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card quick"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Stat
        label="Mein Saldo"
        value={`${ledger.balanceMinor > 0 ? "+" : ledger.balanceMinor < 0 ? "−" : ""}${formatMoney(Math.abs(ledger.balanceMinor), ledger.currency)}`}
        tone={ledger.balanceMinor > 0 ? "pos" : ledger.balanceMinor < 0 ? "neg" : undefined}
        sub={ledger.balanceMinor > 0 ? "Du bekommst" : ledger.balanceMinor < 0 ? "Du schuldest" : "ausgeglichen"}
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="form-row form-row--keep">
        <TextField label="Betrag" value={amount} onChange={setAmount} inputMode="decimal" placeholder={minorToInput(0, currency) || "0.00"} />
        <SelectField
          label="Währung"
          value={currency}
          onChange={setCurrency}
          options={[...(currencies.some((c) => c.code === currency) ? [] : [{ value: currency, label: currency }]), ...currencies.map((c) => ({ value: c.code, label: c.code }))]}
        />
      </div>
      <TextField label="Wofür?" value={text} onChange={setText} placeholder="z. B. Mittagessen" maxLength={200} />
      <div className="card__actions">
        <Button type="submit" variant="primary" icon="plus" busy={busy} disabled={!amount.trim()}>
          Ausgabe erfassen
        </Button>
      </div>
    </form>
  );
}

