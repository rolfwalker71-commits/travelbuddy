import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { trips as api } from "../../api/endpoints";
import { UploadZone } from "../../documents/UploadZone";
import { getType } from "../../lib/catalog";
import { formatDate, formatDayHeading } from "../../lib/dates";
import { documentTitle } from "../../lib/docTitles";
import { detailSections, keyFacts, referenceOf, routeOf, summaryLine, timeLine, seatList } from "../../lib/eventUi";
import { formatMoney } from "../../lib/money";
import { EventMapCard } from "../../map/EventMapCard";
import { Comments } from "../../trip/Comments";
import { statusChips, typeInfo } from "../../trip/EventTicket";
import { Button } from "../../ui/Button";
import { useConfirm } from "../../ui/Confirm";
import { Banner, EmptyState } from "../../ui/Feedback";
import { Icon } from "../../ui/Icon";
import { IllustrationCard } from "../../ui/IllustrationCard";
import { ImageTools } from "../../ui/ImageTools";
import { ImageLightbox } from "../../ui/ImageLightbox";
import { MediaImage } from "../../ui/MediaImage";
import { eventImageVisible, useShowGeneratedEventImages } from "../../lib/prefs";
import { Provenance, ProvenanceLegend } from "../../ui/Provenance";
import { TicketCard } from "../../ui/TicketCard";
import { useToast } from "../../ui/Toast";
import { Section, useDocumentTitle } from "../../ui/bits";
import { useTripCtx } from "./context";

/** Ereignis-Detail: Ticket, Karte oberhalb der Buchungsdaten, Buchungsdaten mit Herkunft, Dokumente, Kommentare. */
export function EventDetailPage() {
  const { eventId } = useParams();
  const ctx = useTripCtx();
  const { data, catalog, tripTz, isAdmin, meId } = ctx;
  const { trip, travelers } = data;
  const toast = useToast();
  const confirm = useConfirm();
  const e = data.events.find((x) => x.id === Number(eventId));
  const [showUpload, setShowUpload] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  useDocumentTitle(e?.title ?? "Ereignis");
  const showGenerated = useShowGeneratedEventImages();

  if (!e) {
    return (
      <div className="card">
        <EmptyState icon="search" title="Ereignis nicht gefunden" action={<Link className="btn btn--secondary btn--m" to={`/trips/${trip.id}`}>Zum Plan</Link>}>
          Das Ereignis wurde gelöscht oder gehört nicht zu dieser Reise.
        </EmptyState>
      </div>
    );
  }

  const info = typeInfo(catalog, e);
  const tl = timeLine(e, tripTz);
  const route = routeOf(e);
  const facts = keyFacts(catalog, e, { meId, travelers, max: 6 });
  const seats = seatList(e, travelers);
  const sections = detailSections(catalog, e, travelers, formatMoney, formatDate);
  const proposal = e.status === "proposed" || e.status === "needs_review";
  const sum = summaryLine(catalog, e);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const meta = (scope: "common" | "details", key: string) => e.fieldsMeta?.[scope === "details" ? `details.${key}` : key] ?? e.fieldsMeta?.[key];

  return (
    <div className="evdetail">
      <div className="evdetail__nav">
        <Link to={`/trips/${trip.id}`} className="link-btn">
          <Icon name="arrow-left" size={16} /> Zum Plan
        </Link>
        {e.startDate ? <span className="muted small">{formatDayHeading(e.startDate)}</span> : null}
      </div>

      {proposal ? (
        <Banner
          tone={e.status === "needs_review" ? "warn" : "info"}
          action={
            isAdmin ? (
              <span className="row__badges">
                <Button size="s" variant="primary" icon="check" onClick={() => void guard(async () => { ctx.apply(await api.confirmEvent(trip.id, e.id)); toast("Vorschlag übernommen"); })}>
                  Übernehmen
                </Button>
                <Button size="s" icon="edit" onClick={() => ctx.openEventForm(e)}>
                  Bearbeiten
                </Button>
              </span>
            ) : undefined
          }
        >
          {e.status === "needs_review" ? "Zu prüfen: " : "Vorschlag: "}
          dieses Ereignis stammt aus einem Dokument und ist noch nicht übernommen.
        </Banner>
      ) : null}

      <div className="evdetail__grid">
        <div className="evdetail__main">
          <TicketCard
            size="l"
            kind={info.color}
            icon={info.icon}
            label={info.label}
            reference={referenceOf(e)}
            badges={statusChips(e)}
            title={e.title}
            dashed={proposal}
            main={
              tl.start || tl.end || route ? (
                <>
                  {tl.start ? <span>{tl.start}</span> : null}
                  {tl.start && tl.end ? <span className="sep">→</span> : null}
                  {tl.end ? <span>{tl.end}</span> : null}
                  {route ? (
                    <small className="num">
                      {route.from} → {route.to}
                    </small>
                  ) : null}
                  {tl.startZone || tl.endZone ? <small>Ortszeit {[tl.startZone, tl.endZone].filter(Boolean).join(" / ")}</small> : null}
                </>
              ) : null
            }
            facts={facts}
            stub={
              <>
                {isAdmin ? (
                  <Button size="s" icon="edit" onClick={() => ctx.openEventForm(e)}>
                    Bearbeiten
                  </Button>
                ) : null}
                {e.priceMinor != null && trip.ledgerId != null ? (
                  <Button size="s" icon="wallet" disabled={e.expenseId != null} onClick={() => ctx.toLedger(e)}>
                    {e.expenseId != null ? "In der Reisekasse" : "In Reisekasse übernehmen"}
                  </Button>
                ) : null}
                {isAdmin ? (
                  <Button size="s" variant="ghost" icon="trash" onClick={async () => void (await ctx.deleteEvent(e))}>
                    Löschen
                  </Button>
                ) : null}
              </>
            }
          >
            {sum || seats ? (
              <div className="evhero__text">
                {sum ? <p className="ticket__sum muted">{sum}</p> : null}
                {seats ? <p className="small"><span className="label">Sitze</span> {seats}</p> : null}
              </div>
            ) : null}
            <div className="evhero__illu evhero__media">
              {e.imageUrl && eventImageVisible(e.imageSource, showGenerated) ? (
                <MediaImage src={e.imageUrl} variant="full" alt={e.title} lazy={false} className="evhero__img" openLabel="Bild vergrössern" onOpen={() => setImgOpen(true)} />
              ) : (
                <IllustrationCard id={`type-${getType(catalog, e.type)?.id ?? e.type}`} decorative compact />
              )}
              {isAdmin ? (
                <ImageTools kind="event_image" ownerId={e.id} hasImage={Boolean(e.imageUrl)} onChanged={ctx.reload} />
              ) : null}
              <ImageLightbox open={imgOpen} onClose={() => setImgOpen(false)} src={e.imageUrl} title={e.title} />
            </div>
          </TicketCard>

          <EventMapCard
            event={e}
            color={`var(--k-${info.color})`}
            onSaveCoords={
              isAdmin
                ? async (role, index, lat, lon) => {
                    // Im Browser aufgelöst: als «geocoded» speichern, damit eine spätere Adressänderung sie ersetzt
                    void index;
                    ctx.apply(await api.updateEvent(trip.id, e.id, { placeCoords: { [role]: { lat, lon, source: "geocoded" } } }));
                  }
                : undefined
            }
            onResetCoords={
              isAdmin
                ? async (role, index) => {
                    const patch = index === 0 ? { lat: null, lon: null, placeCoords: { [role]: null } } : { placeCoords: { [role]: null } };
                    ctx.apply(await api.updateEvent(trip.id, e.id, patch));
                    // Server geokodiert nach dem Speichern im Hintergrund; danach neu laden
                    window.setTimeout(() => ctx.reload(), 2500);
                  }
                : undefined
            }
            onServerGeocode={
              isAdmin
                ? async () => {
                    ctx.apply(await api.geocode(trip.id, e.id));
                  }
                : undefined
            }
          />

          <Section title="Buchungsdaten" id="sec-booking">
            <div className="card">
              {e.fieldsMeta && Object.keys(e.fieldsMeta).length > 0 ? <ProvenanceLegend /> : null}
              {sections.length === 0 ? (
                <p className="muted">Noch keine Angaben. Mit «Bearbeiten» lassen sich Buchungsdaten ergänzen.</p>
              ) : (
                sections.map((s) => (
                  <section key={s.id} className="detsec" aria-label={s.title}>
                    <h3 className="label">{s.title}</h3>
                    <dl className="kv">
                      {s.rows.map((r) => {
                        const m = meta(r.scope, r.key);
                        return (
                          <div key={`${r.scope}-${r.key}`} className="kv__row">
                            <dt>
                              {r.label}
                              {m ? (
                                <Provenance
                                  info={{ meta: m, fallbackDocumentId: e.sourceDocumentId ?? null, onOpenDocument: (id, page) => ctx.openDocument(id, page, documentTitle(id)) }}
                                  fieldLabel={r.label}
                                />
                              ) : null}
                            </dt>
                            <dd className={`${r.mono ? "num " : ""}${r.value.includes("\n") ? "pre" : ""}`}>{r.value}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </section>
                ))
              )}
            </div>
          </Section>
        </div>

        <aside className="evdetail__side">
          <Section title="Dokumente" id="sec-evdocs">
            <div className="card">
              {(e.documents ?? e.documentIds.map((id) => ({ id, title: documentTitle(id) }))).length === 0 ? (
                <p className="muted small">Noch kein Dokument an diesem Ereignis.</p>
              ) : (
                <ul className="evdocs">
                  {(e.documents ?? e.documentIds.map((id) => ({ id, title: null as string | null }))).map((d) => (
                    <li key={d.id}>
                      <Icon name="file" size={16} />
                      <span className="truncate">{d.title || documentTitle(d.id)}</span>
                      <Button size="s" icon="external" onClick={() => ctx.openDocument(d.id, undefined, d.title || documentTitle(d.id))}>
                        Öffnen
                      </Button>
                      {isAdmin ? (
                        <Button
                          size="s"
                          variant="ghost"
                          icon="x"
                          aria-label={`${d.title || documentTitle(d.id)} lösen`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Verknüpfung lösen?",
                              message: "Das Dokument bleibt bei der Reise, ist aber nicht mehr mit diesem Ereignis verknüpft.",
                              confirmLabel: "Lösen",
                              danger: true,
                            });
                            if (ok) await guard(async () => { ctx.apply(await api.unlinkDocument(trip.id, e.id, d.id)); toast("Verknüpfung gelöst"); });
                          }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {showUpload ? (
                <UploadZone tripId={trip.id} eventId={e.id} compact onAnalyzed={() => ctx.reload()} />
              ) : (
                <button type="button" className="link-btn" onClick={() => setShowUpload(true)}>
                  <Icon name="upload" size={16} /> Beleg hochladen
                </button>
              )}
            </div>
          </Section>

          <Section title="Kommentare" id="sec-comments">
            <div className="card">
              <Comments
                comments={e.comments}
                onComment={async (body) => {
                  const c = await api.comment(trip.id, e.id, body);
                  ctx.apply({ ...data, events: data.events.map((x) => (x.id === e.id ? { ...x, comments: [...x.comments, c] } : x)) });
                }}
                canDelete={(c) => isAdmin || (c.userId != null && c.userId === ctx.userId)}
                onDelete={async (c) => {
                  const ok = await confirm({ title: "Kommentar löschen?", confirmLabel: "Löschen", danger: true });
                  if (!ok) return;
                  await guard(async () => {
                    await api.deleteComment(trip.id, e.id, c.id);
                    ctx.apply({ ...data, events: data.events.map((x) => (x.id === e.id ? { ...x, comments: x.comments.filter((y) => y.id !== c.id) } : x)) });
                  });
                }}
              />
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
