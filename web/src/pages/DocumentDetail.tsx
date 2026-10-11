import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import { documentsApi, trips as tripsApi } from "../api/endpoints";
import type { DocumentItem, TripDetail, TripEvent } from "../api/types";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useDocumentPolling } from "../documents/useDocumentPolling";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import { QueryView, useQuery } from "../hooks/useQuery";
import { formatBytes, ANALYSIS_LABEL } from "../lib/upload";
import { formatDate, formatTimestamp } from "../lib/dates";
import { eventMapPoints, appleMapsUrl, addressText, type MapPoint } from "../lib/maps";
import { MapView } from "../map/MapView";
import { useAuth } from "../state/auth";
import { useCatalog } from "../state/catalog";
import type { Catalog } from "../lib/catalog";
import { typeInfo } from "../trip/EventTicket";
import { Button, IconButton } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Chip } from "../ui/Chip";
import { DocumentProblem } from "../ui/DocumentParts";
import { EmptyState, ErrorState, SkeletonCards, Spinner } from "../ui/Feedback";
import { SelectField, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { PdfViewer } from "../ui/PdfViewer";
import { useToast } from "../ui/Toast";
import { PageHeader, Section } from "../ui/bits";

/** Dokument: Anzeige (PDF/Bild), Status, verknüpfte Ereignisse und erkannte Adressen mit Karten-Vorschau. */
export function DocumentDetailPage() {
  const { id } = useParams();
  const docId = Number(id);
  const q = useQuery((s) => documentsApi.get(docId, s), [docId]);
  useDocumentPolling(q.data ? [q.data] : [], () => q.reload());
  if (!Number.isInteger(docId) || docId <= 0) {
    return (
      <div className="page">
        <ErrorState error={new Error("Ungültiges Dokument")} />
      </div>
    );
  }
  return (
    <QueryView
      query={q}
      skeleton={
        <div className="page">
          <PageHeader title="Dokument" back="/trips" />
          <SkeletonCards count={2} />
        </div>
      }
    >
      {(doc) => <DocumentView doc={doc} reload={q.reload} />}
    </QueryView>
  );
}

type Addr = { key: string; label: string; point: MapPoint; eventId: number | null };

/** Auswahltext eines Ereignisses: «Titel · Typ · 19.11.2026 08:30», damit gleichnamige Ereignisse unterscheidbar sind. */
function eventOptionLabel(catalog: Catalog, e: TripEvent): string {
  const parts = [e.title, typeInfo(catalog, e).label];
  if (e.startDate) parts.push(e.startTime ? `${formatDate(e.startDate)} ${e.startTime}` : formatDate(e.startDate));
  return parts.join(" · ");
}

const NEW_EVENT = "__new__";

function DocumentView({ doc, reload }: { doc: DocumentItem; reload: () => void }) {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const tripId = doc.tripIds[0] ?? null;
  const trip = useQuery<TripDetail | null>((s) => (tripId != null ? tripsApi.get(tripId, s) : Promise.resolve(null)), [tripId]);
  const file = useBlobUrl(`/v1/documents/${doc.id}/file`);
  const maps = useMapsEnabled();

  const addresses: Addr[] = useMemo(() => {
    const events = trip.data?.events ?? [];
    const out: Addr[] = [];
    const seen = new Set<string>();
    for (const a of doc.addresses ?? []) {
      const ev = a.eventId != null ? events.find((e) => e.id === a.eventId) : undefined;
      const key = `a-${a.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label: a.label || ev?.title || "Adresse",
        eventId: a.eventId ?? null,
        point: { id: key, eventId: a.eventId ?? 0, order: 0, role: "venue", title: a.label || ev?.title || "Adresse", roleLabel: "Ort", address: a.address, lat: a.lat, lon: a.lon, query: a.address, color: "var(--accent)", date: ev?.startDate ?? null },
      });
    }
    const linked = events.filter((e) => e.sourceDocumentId === doc.id || doc.eventIds.includes(e.id) || e.documentIds.includes(doc.id));
    for (const p of eventMapPoints(linked.map((e) => ({ ...e, status: undefined })), (e) => `var(--k-${typeInfo(catalog, e).color})`)) {
      if (!p.address) continue;
      const key = `a-${p.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: `${p.title} · ${p.roleLabel}`, point: p, eventId: p.eventId });
    }
    return out;
  }, [doc, trip.data, catalog]);

  const linkedEvents = (trip.data?.events ?? []).filter((e) => e.sourceDocumentId === doc.id || doc.eventIds.includes(e.id) || e.documentIds.includes(doc.id));

  return (
    <div className="page">
      <PageHeader
        title={doc.title || doc.fileName}
        eyebrow="Dokument"
        subtitle={`${doc.fileName} · ${formatBytes(doc.sizeBytes)}${doc.pages ? ` · ${doc.pages} Seiten` : ""} · ${formatTimestamp(doc.createdAt)}`}
        back={tripId != null ? `/trips/${tripId}/documents` : "/trips"}
        backLabel="Zu den Dokumenten der Reise"
        actions={
          <>
            {(doc.analysisStatus === "failed" || doc.analysisStatus === "skipped" || doc.analysisStatus === "done") ? (
              <Button
                icon="refresh"
                onClick={async () => {
                  try {
                    await documentsApi.analyze(doc.id);
                    toast("Auswertung gestartet");
                    reload();
                  } catch (e) {
                    toast(errorMessage(e), "error");
                  }
                }}
              >
                Erneut auswerten
              </Button>
            ) : null}
            {isAdmin ? (
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Dokument löschen?",
                    message: "Die Datei wird entfernt und von allen Ereignissen gelöst. Die Ereignisse selbst bleiben bestehen.",
                    confirmLabel: "Löschen",
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await documentsApi.remove(doc.id);
                    toast("Dokument gelöscht");
                    navigate(tripId != null ? `/trips/${tripId}/documents` : "/trips");
                  } catch (e) {
                    toast(errorMessage(e), "error");
                  }
                }}
              >
                Löschen
              </Button>
            ) : null}
          </>
        }
      />
      <div className="trip-layout">
        <div className="trip-main">
          <div className="card pdfcard">
            {file.loading ? (
              <div className="doc-preview__ph">
                <Spinner label="Dokument wird geladen …" />
              </div>
            ) : file.url ? (
              file.type?.startsWith("image/") ? (
                <img src={file.url} alt={doc.title} className="doc-viewer__img" />
              ) : file.blob ? (
                <PdfViewer blob={file.blob} title={doc.title || doc.fileName} />
              ) : null
            ) : (
              <DocumentProblem error={file.error} onRetry={file.reload} />
            )}
          </div>
        </div>
        <aside className="trip-side">
          <Section title="Auswertung" id="sec-status">
            <div className="card">
              <p>
                <Chip tone={doc.analysisStatus === "done" ? "pos" : doc.analysisStatus === "failed" ? "neg" : "accent"} icon={doc.analysisStatus === "failed" ? "alert" : doc.analysisStatus === "done" ? "check" : "refresh"}>
                  {ANALYSIS_LABEL[doc.analysisStatus]}
                </Chip>
              </p>
              {doc.analysisError ? <p className="field__error small">{doc.analysisError}</p> : null}
              {doc.summary ? <p className="small">{doc.summary}</p> : null}
            </div>
          </Section>

          <Section title="Ereignisse" id="sec-events">
            {isAdmin && tripId != null ? (
              <LinkToEvent
                tripId={tripId}
                docId={doc.id}
                docTitle={doc.title || doc.fileName}
                events={(trip.data?.events ?? []).filter((e) => !linkedEvents.some((l) => l.id === e.id))}
                onLinked={() => {
                  trip.reload();
                  reload();
                }}
              />
            ) : null}
            {linkedEvents.length === 0 ? (
              <div className="card">
                <p className="muted small">Noch keine Ereignisse aus diesem Dokument.</p>
              </div>
            ) : (
              <ul className="list card card--flush">
                {linkedEvents.map((e) => {
                  const info = typeInfo(catalog, e);
                  return (
                    <li key={e.id}>
                      <Link className="row row--button" to={`/trips/${e.tripId}/events/${e.id}`}>
                        <Icon name={info.icon} size={18} />
                        <span className="row__main">
                          <span className="row__title">{e.title}</span>
                          <span className="row__sub">{info.label}</span>
                        </span>
                        {e.status && e.status !== "confirmed" ? <Chip tone="proposal">Vorschlag</Chip> : null}
                      </Link>
                      {isAdmin ? (
                        <IconButton
                          icon="x"
                          label={`${e.title}: Zuordnung lösen`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Zuordnung lösen?",
                              message: "Das Dokument bleibt bei der Reise, ist aber nicht mehr mit diesem Ereignis verknüpft.",
                              confirmLabel: "Lösen",
                              danger: true,
                            });
                            if (!ok) return;
                            try {
                              await tripsApi.unlinkDocument(e.tripId, e.id, doc.id);
                              toast("Zuordnung gelöst");
                              trip.reload();
                              reload();
                            } catch (err) {
                              toast(errorMessage(err), "error");
                            }
                          }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </aside>
      </div>

      <Section title="Erkannte Adressen" id="sec-addresses">
        {addresses.length === 0 ? (
          <div className="card">
            <EmptyState icon="pin" title="Keine Adressen erkannt">
              Sobald die Auswertung Adressen findet, erscheinen sie hier mit einer Karten-Vorschau.
            </EmptyState>
          </div>
        ) : (
          <ul className="addrlist">
            {addresses.map((a) => (
              <AddressCard key={a.key} a={a} maps={maps} events={trip.data?.events ?? []} tripId={tripId} docId={doc.id} isAdmin={isAdmin} onAssigned={() => { trip.reload(); reload(); }} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/**
 * Dokument einem Ereignis zuordnen (`POST /v1/trips/:id/events/:eventId/documents { documentId }`, nur Admin)
 * oder daraus ein neues Ereignis anlegen (`POST /v1/trips/:id/events`, danach zuordnen).
 */
function LinkToEvent({
  tripId,
  docId,
  docTitle,
  events,
  onLinked,
}: {
  tripId: number;
  docId: number;
  docTitle: string;
  events: TripEvent[];
  onLinked: () => void;
}) {
  const toast = useToast();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  const [newType, setNewType] = useState(catalog.types[0]?.id ?? "Ausflug");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = target === NEW_EVENT;
  const canSubmit = creating ? (newTitle.trim() || docTitle).length > 0 : Boolean(target);
  return (
    <div className="addr__assign card">
      <SelectField
        label="Dem Ereignis zuordnen"
        value={target}
        onChange={setTarget}
        options={[
          { value: "", label: "Ereignis wählen …" },
          { value: NEW_EVENT, label: "＋ Neues Ereignis aus diesem Dokument anlegen" },
          ...events.map((e) => ({ value: String(e.id), label: eventOptionLabel(catalog, e) })),
        ]}
      />
      {creating ? (
        <>
          <SelectField
            label="Typ des neuen Ereignisses"
            value={newType}
            onChange={setNewType}
            options={catalog.types.map((t) => ({ value: t.id, label: t.label }))}
          />
          <TextField label="Titel" value={newTitle} onChange={setNewTitle} placeholder={docTitle} maxLength={200} />
        </>
      ) : null}
      <Button
        size="s"
        icon={creating ? "plus" : "link"}
        busy={busy}
        disabled={!canSubmit}
        onClick={async () => {
          setBusy(true);
          try {
            if (creating) {
              const created = await tripsApi.createEvent(tripId, { type: newType, title: newTitle.trim() || docTitle });
              await tripsApi.linkDocument(tripId, created.eventId, docId);
              toast("Ereignis angelegt und Dokument zugeordnet");
              navigate(`/trips/${tripId}/events/${created.eventId}`);
              return;
            }
            await tripsApi.linkDocument(tripId, Number(target), docId);
            toast("Dokument dem Ereignis zugeordnet");
            setTarget("");
            onLinked();
          } catch (e) {
            toast(errorMessage(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        {creating ? "Anlegen und zuordnen" : "Zuordnen"}
      </Button>
    </div>
  );
}

function AddressCard({
  a,
  maps,
  events,
  tripId,
  docId,
  isAdmin,
  onAssigned,
}: {
  a: Addr;
  maps: boolean | null;
  events: TripEvent[];
  tripId: number | null;
  docId: number;
  isAdmin: boolean;
  onAssigned: () => void;
}) {
  const toast = useToast();
  const catalog = useCatalog();
  const [target, setTarget] = useState(a.eventId != null ? String(a.eventId) : "");
  const [busy, setBusy] = useState(false);
  const url = appleMapsUrl(a.point);
  return (
    <li className="card addr">
      <div className="addr__map">
        {maps === true ? (
          <MapView points={[a.point]} label={`Karte: ${addressText(a.point)}`} height={140} compact />
        ) : (
          <div className="map-card map-card--compact addr__ph" style={{ height: 140 }}>
            <Icon name="map" size={28} />
          </div>
        )}
      </div>
      <div className="addr__body">
        <span className="label">{a.label}</span>
        <span className="addr__text">{addressText(a.point)}</span>
        <span className="row__badges">
          {url ? (
            <a className="btn btn--secondary btn--s" href={url} target="_blank" rel="noreferrer noopener">
              <Icon name="map" size={16} />
              <span>In Karten öffnen</span>
            </a>
          ) : null}
        </span>
        {isAdmin && tripId != null && events.length > 0 ? (
          <div className="addr__assign">
            <SelectField
              label="Dem Ereignis zuordnen"
              value={target}
              onChange={setTarget}
              options={[{ value: "", label: "Ereignis wählen …" }, ...events.map((e) => ({ value: String(e.id), label: eventOptionLabel(catalog, e) }))]}
            />
            <Button
              size="s"
              icon="check"
              busy={busy}
              disabled={!target || events.find((e) => e.id === Number(target))?.documentIds.includes(docId) === true}
              onClick={async () => {
                setBusy(true);
                try {
                  await tripsApi.linkDocument(tripId, Number(target), docId);
                  toast("Dokument dem Ereignis zugeordnet");
                  onAssigned();
                } catch (e) {
                  toast(errorMessage(e), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Zuordnen
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
