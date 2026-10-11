import { useCallback, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { ledgers as L, trips as api } from "../api/endpoints";
import type { EventInput, LedgerOverview, TripDetail, TripEvent } from "../api/types";
import { QueryView, useQuery } from "../hooks/useQuery";
import { Fab } from "../layout/AppShell";
import { daysBetween, formatDateRange, todayIso } from "../lib/dates";
import { learnDocumentTitles, documentTitle } from "../lib/docTitles";
import { TRIP_TABS } from "../lib/nav";
import { tripSpan } from "../lib/plan";
import { useAuth } from "../state/auth";
import { useCatalog } from "../state/catalog";
import { useToday } from "../state/today";
import { ExpenseSheet } from "../ledger/ExpenseSheet";
import { accountLedgerApi } from "../api/endpoints";
import { EventForm } from "../trip/EventForm";
import { TripEditSheet } from "../trip/TripEditSheet";
import { Button, LinkButton } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Chip } from "../ui/Chip";
import { DocumentSheet } from "../ui/DocumentParts";
import { ErrorState, SkeletonCards } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { MediaImage } from "../ui/MediaImage";
import { CoverIllustration } from "../ui/IllustrationCard";
import { coverIdFor } from "../lib/illustrations";
import { Menu } from "../ui/Menu";
import { useToast } from "../ui/Toast";
import { PageHeader } from "../ui/bits";
import { Stat } from "../ui/Stat";
import { apiBlob } from "../api/client";
import type { TripCtx } from "./trip/context";

export function TripLayout() {
  const { id } = useParams();
  const tripId = Number(id);
  const valid = Number.isInteger(tripId) && tripId > 0;
  const q = useQuery((signal) => (valid ? api.get(tripId, signal) : Promise.reject(new Error("Ungültige Reise"))), [tripId]);
  if (!valid) {
    return (
      <div className="page">
        <ErrorState error={new Error("Ungültige Reise")} />
      </div>
    );
  }
  return (
    <QueryView
      query={q}
      skeleton={
        <div className="page">
          <PageHeader title="Reise" back="/trips" backLabel="Zu den Reisen" />
          <SkeletonCards count={3} />
        </div>
      }
    >
      {(data) => <TripShell data={data} apply={(next) => q.setData(() => next)} reload={q.reload} />}
    </QueryView>
  );
}

type ExpenseSeed = { overview: LedgerOverview; event: TripEvent };

function TripShell({ data, apply, reload }: { data: TripDetail; apply: (next: TripDetail) => void; reload: () => void }) {
  const { trip, travelers, events } = data;
  learnDocumentTitles(events);
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const catalog = useCatalog();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const todayCtx = useToday();
  const tripTz = trip.timezone || "Europe/Zurich";
  const homeCurrency = trip.homeCurrency || "CHF";
  const meId = travelers.find((t) => t.userId != null && t.userId === user?.id)?.id ?? null;
  const today = todayIso();

  const [form, setForm] = useState<{ open: boolean; event: TripEvent | null; defaultDate?: string | null; type?: string }>({ open: false, event: null });
  const [editOpen, setEditOpen] = useState(false);
  const [view, setView] = useState<{ id: number; page?: number; title?: string } | null>(null);
  const [seed, setSeed] = useState<ExpenseSeed | null>(null);

  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [toast]
  );

  const saveForm = async (input: EventInput) => {
    const cur = form.event;
    if (cur) {
      apply(await api.updateEvent(trip.id, cur.id, input));
      toast("Ereignis gespeichert");
    } else {
      apply(await api.createEvent(trip.id, input));
      toast("Ereignis hinzugefügt");
    }
    todayCtx.reload();
  };

  const saveEvent = async (event: TripEvent, patch: EventInput) => {
    apply(await api.updateEvent(trip.id, event.id, patch));
  };

  const deleteEvent = async (e: TripEvent) => {
    const ok = await confirm({
      title: "Ereignis löschen?",
      message: `«${e.title}» und die Kommentare dazu werden gelöscht.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    setForm({ open: false, event: null });
    await guard(async () => {
      apply(await api.deleteEvent(trip.id, e.id));
      toast("Ereignis gelöscht");
      todayCtx.reload();
      if (window.location.pathname.includes(`/events/${e.id}`)) nav(`/trips/${trip.id}`, { replace: true });
    });
  };

  const toLedger = (event: TripEvent) => {
    if (trip.ledgerId == null) {
      toast("Diese Reise hat noch keine Reisekasse.", "error");
      return;
    }
    void guard(async () => {
      const overview = await L.overview(trip.ledgerId!);
      setForm({ open: false, event: null });
      setSeed({ overview, event });
    });
  };

  const downloadIcs = () =>
    guard(async () => {
      const { blob, filename } = await apiBlob(`/v1/trips/${trip.id}/ics`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "reise.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast("Kalenderdatei erstellt");
    });

  const printItem = { label: "Drucken / Als PDF", icon: "file" as const, onSelect: () => nav(`/trips/${trip.id}/print`) };
  const adminMenu = [
    { label: "Reise bearbeiten", icon: "edit" as const, onSelect: () => setEditOpen(true) },
    { label: "Kalender exportieren (ICS)", icon: "download" as const, onSelect: () => void downloadIcs() },
    {
      label: "Reise löschen",
      icon: "trash" as const,
      danger: true,
      onSelect: async () => {
        const ok = await confirm({
          title: "Reise löschen?",
          message: `«${trip.title}» mit allen Ereignissen, Dokumenten und der Reisekasse wird endgültig gelöscht.`,
          confirmLabel: "Löschen",
          danger: true,
        });
        if (!ok) return;
        await guard(async () => {
          try {
            await api.remove(trip.id);
          } catch (e) {
            if (!(e instanceof ApiError) || e.code !== "has_ledger_entries") throw e;
            const again = await confirm({
              title: "Reisekasse hat Buchungen",
              message: "Die Reisekasse enthält Ausgaben oder Rückzahlungen. Sie werden mit der Reise endgültig gelöscht.",
              confirmLabel: "Alles löschen",
              danger: true,
            });
            if (!again) return;
            await api.remove(trip.id, true);
          }
          toast("Reise gelöscht");
          nav("/trips", { replace: true });
        });
      },
    },
  ];
  const menu = isAdmin ? [printItem, ...adminMenu] : [printItem];

  const span = tripSpan(trip, events);
  const reviewCount = trip.needsReviewCount ?? events.filter((e) => e.status && e.status !== "confirmed").length;
  const phase = trip.phase ?? (trip.startDate && today < trip.startDate ? "upcoming" : trip.endDate && today > trip.endDate ? "past" : "active");

  const ctx: TripCtx = {
    data,
    apply,
    reload,
    catalog,
    tripTz,
    homeCurrency,
    isAdmin,
    userId: user?.id ?? null,
    meId,
    openEventForm: (event, opts) => setForm({ open: true, event, defaultDate: opts?.defaultDate ?? null, type: opts?.type }),
    openDocument: (id, page, title) => setView({ id, page, title }),
    saveEvent,
    toLedger,
    deleteEvent,
  };

  return (
    <div className="page">
      <PageHeader
        title={trip.title}
        eyebrow={phase === "active" ? "Läuft gerade" : phase === "past" ? "Vergangen" : trip.startDate ? `Beginnt in ${Math.max(0, daysBetween(today, trip.startDate))} Tagen` : "Geplant"}
        subtitle={[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(" · ")}
        back="/trips"
        backLabel="Zu den Reisen"
        actions={
          <>
            <LinkButton to={`/trips/${trip.id}/print`} icon="file" className="hide-sm">
              Drucken
            </LinkButton>
            {isAdmin ? (
              <Button variant="primary" icon="plus" className="hide-sm" onClick={() => setForm({ open: true, event: null })}>
                Ereignis
              </Button>
            ) : null}
            <Menu items={menu} />
          </>
        }
      />

      <div className="triphead">
        {trip.coverUrl ? (
          <MediaImage src={trip.coverUrl} variant="cover" lazy={false} className="triphead__cover" />
        ) : (
          <CoverIllustration id={coverIdFor(trip, events)} />
        )}
        <div className="triphead__stats stat-row stat-row--box">
          <Stat label="Tage" value={span?.days ?? "–"} />
          <Stat label="Personen" value={travelers.length} />
          <Stat label="Ereignisse" value={events.filter((e) => !e.status || e.status === "confirmed").length} />
          {reviewCount > 0 ? (
            <div className="triphead__review">
              <LinkButton to={`/trips/${trip.id}/documents#review`} size="s" icon="sparkle">
                {reviewCount} zu prüfen
              </LinkButton>
            </div>
          ) : null}
          {phase === "past" ? <Chip icon="check">Vergangen</Chip> : null}
        </div>
      </div>

      <nav className="trip-tabs" aria-label="Bereiche der Reise">
        {TRIP_TABS.map((t) => (
          <NavLink
            key={t.key}
            to={t.path === "" ? `/trips/${trip.id}` : `/trips/${trip.id}/${t.path}`}
            end={t.path === ""}
            className={({ isActive }) => `tabs__item${isActive ? " is-active" : ""}`}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {t.key === "documents" && reviewCount > 0 ? <span className="tabs__count">{reviewCount}</span> : null}
          </NavLink>
        ))}
      </nav>

      <Outlet context={ctx} />

      {isAdmin ? <Fab label="Ereignis hinzufügen" onClick={() => setForm({ open: true, event: null })} /> : null}

      <EventForm
        open={form.open}
        event={form.event}
        trip={{ id: trip.id, homeCurrency, timezone: tripTz }}
        travelers={travelers}
        defaultDate={form.defaultDate}
        initialType={form.type}
        onClose={() => setForm({ open: false, event: null })}
        onSave={saveForm}
        onDelete={isAdmin ? (e) => void deleteEvent(e) : undefined}
        onToLedger={isAdmin ? toLedger : undefined}
        onOpenDocument={(id, page) => setView({ id, page, title: documentTitle(id) })}
      />
      <TripEditSheet
        open={editOpen}
        data={data}
        onClose={() => setEditOpen(false)}
        onSave={async (patch) => {
          apply(await api.update(trip.id, patch));
          toast("Reise gespeichert");
          todayCtx.reload();
        }}
      />
      <DocumentSheet documentId={view?.id ?? null} title={view?.title ?? (view ? documentTitle(view.id) : "")} page={view?.page} onClose={() => setView(null)} />
      {seed ? (
        <ExpenseSheet
          open
          onClose={() => setSeed(null)}
          baseCurrency={seed.overview.ledger.baseCurrency}
          kind="split"
          members={seed.overview.members}
          couples={seed.overview.couples}
          defaultPayerId={seed.event.paidByParticipantId ?? seed.overview.myMemberId ?? null}
          prefill={{
            description: seed.event.title,
            amountMinor: seed.event.priceMinor ?? null,
            currency: seed.event.currency ?? seed.overview.ledger.baseCurrency,
            expenseDate: seed.event.startDate,
            tripEventId: seed.event.id,
            category: categoryFor(seed.event.type),
            participantIds: seed.event.participantIds ?? [],
          }}
          api={accountLedgerApi(seed.overview.ledger.id)}
          onSaved={() => {
            toast("In die Reisekasse übernommen");
            setSeed(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** Kategorie der Ausgabe aus dem Ereignistyp. */
export function categoryFor(type: string): string {
  switch (type) {
    case "Flug":
      return "Flug";
    case "Zugreisen":
      return "Bahn";
    case "Hotel":
    case "Unterkunft":
      return "Unterkunft";
    case "Mietauto":
      return "Mietwagen";
    case "Kreuzfahrt":
      return "Schiff";
    case "Transfer":
      return "Transfer";
    case "Restaurant":
      return "Essen";
    case "Ausflug":
    case "Veranstaltung":
      return "Aktivität";
    case "Versicherung":
      return "Versicherung";
    default:
      return "Weitere";
  }
}
