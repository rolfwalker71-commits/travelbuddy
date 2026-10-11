import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import { documentsApi, trips as tripsApi } from "../api/endpoints";
import type { DocumentItem, TripDetail, TripEvent } from "../api/types";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useDocumentPolling } from "../documents/useDocumentPolling";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import { QueryView, useQuery } from "../hooks/useQuery";
import { formatBytes, ANALYSIS_LABEL } from "../lib/upload";
import { formatTimestamp } from "../lib/dates";
import { eventMapPoints, appleMapsUrl, addressText, type MapPoint } from "../lib/maps";
import { MapView } from "../map/MapView";
import { useAuth } from "../state/auth";
import { useCatalog } from "../state/catalog";
import { typeInfo } from "../trip/EventTicket";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { DocumentProblem } from "../ui/DocumentParts";
import { EmptyState, ErrorState, SkeletonCards, Spinner } from "../ui/Feedback";
import { SelectField } from "../ui/Field";
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

function DocumentView({ doc, reload }: { doc: DocumentItem; reload: () => void }) {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const toast = useToast();
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

  const eventsById = new Map((trip.data?.events ?? []).map((e) => [e.id, e] as const));
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
          (doc.analysisStatus === "failed" || doc.analysisStatus === "skipped" || doc.analysisStatus === "done") ? (
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
          ) : undefined
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
              <AddressCard key={a.key} a={a} maps={maps} events={trip.data?.events ?? []} tripId={tripId} isAdmin={isAdmin} owner={a.eventId != null ? eventsById.get(a.eventId) : undefined} onAssigned={() => { trip.reload(); }} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function AddressCard({
  a,
  maps,
  events,
  tripId,
  isAdmin,
  owner,
  onAssigned,
}: {
  a: Addr;
  maps: boolean | null;
  events: TripEvent[];
  tripId: number | null;
  isAdmin: boolean;
  owner?: TripEvent;
  onAssigned: () => void;
}) {
  const toast = useToast();
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
              options={[{ value: "", label: "Ereignis wählen …" }, ...events.map((e) => ({ value: String(e.id), label: e.title }))]}
            />
            <Button
              size="s"
              icon="check"
              busy={busy}
              disabled={!target || (owner != null && String(owner.id) === target)}
              onClick={async () => {
                setBusy(true);
                try {
                  await tripsApi.updateEvent(tripId, Number(target), {
                    address: a.point.address ?? a.point.query,
                    ...(a.point.lat != null && a.point.lon != null ? { lat: a.point.lat, lon: a.point.lon } : {}),
                  });
                  toast("Adresse zugeordnet");
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
