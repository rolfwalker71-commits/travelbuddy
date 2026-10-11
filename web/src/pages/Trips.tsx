import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trips as api } from "../api/endpoints";
import type { TripListItem, TripPhase } from "../api/types";
import { useDirectory } from "../hooks/useDirectory";
import { useFormErrors } from "../hooks/useFormErrors";
import { QueryView, useQuery } from "../hooks/useQuery";
import { Fab } from "../layout/AppShell";
import { formatDate, formatDateRange, isValidIsoDate, relativeDays, todayIso } from "../lib/dates";
import { allZones, cityOf } from "../lib/timezones";
import { useAuth } from "../state/auth";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Banner, SkeletonCards } from "../ui/Feedback";
import { CheckField, DateField, SelectField, TextAreaField, TextField } from "../ui/Field";
import { eventIcon, Icon } from "../ui/Icon";
import { CoverIllustration, IllustrationCard } from "../ui/IllustrationCard";
import { coverIdFor } from "../lib/illustrations";
import { MediaImage } from "../ui/MediaImage";
import { Sheet } from "../ui/Sheet";
import { TicketCard } from "../ui/TicketCard";
import { useToast } from "../ui/Toast";
import { PageHeader, Section } from "../ui/bits";

const PHASES: { key: TripPhase; title: string }[] = [
  { key: "active", title: "Aktuell" },
  { key: "upcoming", title: "Demnächst" },
  { key: "past", title: "Vergangen" },
];

export function TripsPage() {
  const q = useQuery(() => api.list(), []);
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin); // nur Administratoren legen Reisen an
  const [creating, setCreating] = useState(false);
  const today = todayIso();

  return (
    <div className="page">
      <PageHeader
        title="Reisen"
        eyebrow="Unterwegs"
        subtitle={isAdmin ? "Planung, Dokumente, Kasse und Mitreisende" : "Deine Reisen"}
        actions={
          isAdmin ? (
            <Button variant="primary" icon="plus" className="hide-sm" onClick={() => setCreating(true)}>
              Neue Reise
            </Button>
          ) : undefined
        }
      />
      <QueryView query={q} skeleton={<SkeletonCards count={3} />}>
        {(trips) =>
          trips.length === 0 ? (
            <div className="card empty--illu empty">
              <IllustrationCard id="empty-trips" decorative />
              <div className="empty__text">
                <h3>Noch keine Reise</h3>
                <p className="muted">
                  {isAdmin
                    ? "Lege eine Reise an und lade Buchungsbestätigungen hoch. TravelBuddy liest sie aus und baut den Plan."
                    : "Du bist auf keiner Reise eingetragen. Wende dich an die Person, die die Reise verwaltet."}
                </p>
                {isAdmin ? (
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                    Reise anlegen
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {PHASES.map((p) => {
                const list = trips.filter((t) => t.phase === p.key);
                if (list.length === 0) return null;
                return (
                  <Section key={p.key} title={p.title} id={`phase-${p.key}`}>
                    <ul className="tripgrid">
                      {list.map((t) => (
                        <li key={t.id}>
                          <TripTicket t={t} today={today} />
                        </li>
                      ))}
                    </ul>
                  </Section>
                );
              })}
            </>
          )
        }
      </QueryView>
      {isAdmin ? <Fab label="Neue Reise" onClick={() => setCreating(true)} /> : null}
      {isAdmin && creating ? <CreateTripForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function TripTicket({ t, today }: { t: TripListItem; today: string }) {
  return (
    <TicketCard
      kind="air"
      icon="plane"
      label="Reise"
      to={`/trips/${t.id}`}
      active={t.phase === "active"}
      badges={
        <>
          {t.phase === "active" ? <Chip tone="now">Läuft gerade</Chip> : null}
          {t.phase === "upcoming" && t.startDate ? <Chip icon="calendar">Start {relativeDays(t.startDate, today)}</Chip> : null}
          {t.phase === "past" ? <Chip icon="check">Vergangen</Chip> : null}
          {t.needsReviewCount ? <Chip tone="review" icon="sparkle">{t.needsReviewCount} zu prüfen</Chip> : null}
        </>
      }
      title={t.title}
      main={<small>{[t.destination, formatDateRange(t.startDate, t.endDate)].filter(Boolean).join(" · ")}</small>}
      stub={
        <>
          <span className="tripstat">
            <Icon name="flag" size={14} /> {t.eventCount} {t.eventCount === 1 ? "Ereignis" : "Ereignisse"}
          </span>
          <span className="tripstat">
            <Icon name="users" size={14} /> {t.travelerCount}
          </span>
          {t.documentCount ? (
            <span className="tripstat">
              <Icon name="file" size={14} /> {t.documentCount}
            </span>
          ) : null}
          {t.nextEvent && t.phase !== "past" ? (
            <span className="tripstat tripstat--next">
              <Icon name={eventIcon(t.nextEvent.type)} size={14} />
              <span className="truncate">
                {t.nextEvent.title}, {formatDate(t.nextEvent.startDate)}
                {t.nextEvent.startTime ? ` ${t.nextEvent.startTime}` : ""}
              </span>
            </span>
          ) : null}
        </>
      }
    >
      {t.coverUrl ? (
        <MediaImage src={t.coverUrl} variant="map" lazy />
      ) : (
        <CoverIllustration
          id={coverIdFor(t, t.nextEvent ? [{ type: t.nextEvent.type }] : [])}
          className="coverill--thumb"
        />
      )}
    </TicketCard>
  );
}

const TRIP_SPEC = {
  title: { key: "title", label: "Titel" },
  destination: { key: "destination", label: "Ziel" },
  startDate: { key: "start", label: "Beginn" },
  endDate: { key: "end", label: "Ende" },
  summary: { key: "summary", label: "Zusammenfassung" },
  travelers: { key: "travelers", label: "Mitreisende" },
  homeCurrency: { key: "currency", label: "Heimwährung" },
  timezone: { key: "timezone", label: "Zeitzone" },
};

function CreateTripForm({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const directory = useDirectory();
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [summary, setSummary] = useState("");
  const [currency, setCurrency] = useState("CHF");
  const [timezone, setTimezone] = useState("Europe/Zurich");
  const [people, setPeople] = useState<Set<number>>(new Set());
  const errs = useFormErrors(TRIP_SPEC, { invalid_range: "end" });
  const [busy, setBusy] = useState(false);
  const others = directory.filter((u) => u.id !== user?.id);
  const zones = allZones();

  const submit = async () => {
    const local: Record<string, string> = {};
    if (!title.trim()) local.title = "Titel erforderlich";
    if ((start && !isValidIsoDate(start)) || (end && !isValidIsoDate(end))) local.start = "Datum als TT.MM.JJJJ eingeben";
    if (start && end && end < start) local.end = "Das Ende liegt vor dem Start";
    if (!/^[A-Za-z]{3}$/.test(currency)) local.currency = "Währung mit drei Buchstaben angeben";
    if (Object.keys(local).length > 0) {
      errs.set(local);
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      const r = await api.create({
        title: title.trim(),
        destination: destination.trim() || null,
        startDate: start || null,
        endDate: end || null,
        summary: summary.trim() || null,
        homeCurrency: currency.toUpperCase(),
        timezone,
        travelers: others.filter((u) => people.has(u.id)).map((u) => ({ displayName: u.displayName, userId: u.id })),
      });
      toast("Reise angelegt");
      onClose();
      nav(`/trips/${r.trip.id}`);
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Neue Reise"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Anlegen
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <TextField label="Titel" value={title} onChange={setTitle} required autoFocus error={errs.fields.title} placeholder="z. B. Städtetrip Lissabon" maxLength={200} />
        <TextField label="Ziel" value={destination} onChange={setDestination} maxLength={200} error={errs.fields.destination} />
        <div className="form-row">
          <DateField label="Von" value={start} onChange={setStart} error={errs.fields.start} />
          <DateField label="Bis" value={end} onChange={setEnd} error={errs.fields.end} />
        </div>
        <div className="form-row">
          <TextField
            label="Heimwährung"
            value={currency}
            onChange={(v) => setCurrency(v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
            maxLength={3}
            error={errs.fields.currency}
            hint="Währung der Reisekasse"
          />
          <SelectField
            label="Zeitzone der Reise"
            value={timezone}
            onChange={setTimezone}
            error={errs.fields.timezone}
            options={zones.map((z) => ({ value: z, label: `${cityOf(z)} · ${z}` }))}
          />
        </div>
        <TextAreaField label="Zusammenfassung (optional)" value={summary} onChange={setSummary} rows={3} maxLength={2000} error={errs.fields.summary} />
        {others.length > 0 ? (
          <fieldset className="fieldset">
            <legend>Mitreisende mit Konto</legend>
            {others.map((u) => (
              <CheckField
                key={u.id}
                label={u.displayName}
                checked={people.has(u.id)}
                onChange={(c) =>
                  setPeople((cur) => {
                    const n = new Set(cur);
                    if (c) n.add(u.id);
                    else n.delete(u.id);
                    return n;
                  })
                }
              />
            ))}
            {errs.fields.travelers ? <p className="field__error">{errs.fields.travelers}</p> : null}
          </fieldset>
        ) : null}
        <p className="field__hint">Die Reisekasse wird automatisch mit angelegt.</p>
      </div>
    </Sheet>
  );
}
