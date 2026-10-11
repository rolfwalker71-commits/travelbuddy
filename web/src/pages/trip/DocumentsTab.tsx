import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { documentsApi, inbox } from "../../api/endpoints";
import type { DocumentItem, TripEvent } from "../../api/types";
import { DocumentRow } from "../../documents/DocumentRow";
import { ReviewList } from "../../documents/ReviewList";
import { UploadZone } from "../../documents/UploadZone";
import { useDocumentPolling } from "../../documents/useDocumentPolling";
import { documentTitle, learnDocuments } from "../../lib/docTitles";
import { proposalsOf } from "../../lib/review";
import { isAnalysisActive } from "../../lib/upload";
import { useToday } from "../../state/today";
import { EmptyState, Spinner } from "../../ui/Feedback";
import { HelpCard, IllustrationCard } from "../../ui/IllustrationCard";
import { Section } from "../../ui/bits";
import { useToast } from "../../ui/Toast";
import { useTripCtx } from "./context";

/** Dokumente einer Reise: Upload, Zu prüfen, Liste. Fehlt die Listenroute, wird sie aus den Ereignissen abgeleitet. */
function useTripDocuments(tripId: number, events: TripEvent[], reloadKey: number) {
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const idsKey = useMemo(() => JSON.stringify(events.flatMap((e) => [...e.documentIds, e.sourceDocumentId ?? 0]).filter(Boolean).sort()), [events]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const listed = await documentsApi.listForTrip(tripId);
        if (!alive) return;
        if (listed) {
          learnDocuments(listed);
          setDocs(listed);
          return;
        }
        // Rückfall: Dokumente aus Ereignissen und dem Eingang
        const ids = new Set<number>(JSON.parse(idsKey) as number[]);
        try {
          const ib = await inbox.get();
          for (const d of ib.documents) if (d.tripIds.includes(tripId)) ids.add(d.id);
        } catch {
          /* Eingang ist Zugabe */
        }
        const list = (
          await Promise.all([...ids].map((id) => documentsApi.get(id).catch(() => null)))
        ).filter((d): d is DocumentItem => d !== null);
        if (!alive) return;
        learnDocuments(list);
        setDocs(list);
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId, idsKey, reloadKey]);

  return { docs, setDocs, error };
}

export function DocumentsTab() {
  const ctx = useTripCtx();
  const { data, catalog, isAdmin } = ctx;
  const { trip, events, travelers } = data;
  const toast = useToast();
  const todayCtx = useToday();
  const [tick, setTick] = useState(0);
  const { docs, setDocs, error } = useTripDocuments(trip.id, events, tick);
  const proposals = proposalsOf(events);

  // Sprung zu «Zu prüfen» (#review)
  useEffect(() => {
    if (window.location.hash === "#review") document.getElementById("review")?.scrollIntoView({ block: "start" });
  }, [proposals.length]);

  const refresh = useCallback(() => {
    ctx.reload();
    todayCtx.reload();
    setTick((t) => t + 1);
  }, [ctx, todayCtx]);

  useDocumentPolling(docs ?? [], (d) => {
    setDocs((cur) => (cur ? cur.map((x) => (x.id === d.id ? d : x)) : cur));
    if (!isAnalysisActive(d.analysisStatus)) refresh();
  });

  const titlesByDoc = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of events) for (const id of e.documentIds) m.set(id, [...(m.get(id) ?? []), e.title]);
    return m;
  }, [events]);

  const analyze = async (d: DocumentItem) => {
    try {
      const next = await documentsApi.analyze(d.id);
      setDocs((cur) => (cur ? cur.map((x) => (x.id === next.id ? next : x)) : cur));
      toast("Auswertung gestartet");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="docs">
      <Section title="Hochladen" id="sec-upload">
        <UploadZone
          tripId={trip.id}
          onUploaded={(d) => setDocs((cur) => [d, ...(cur ?? []).filter((x) => x.id !== d.id)])}
          onAnalyzed={() => refresh()}
        />
      </Section>

      {proposals.length > 0 ? (
        <Section title={`Zu prüfen · ${proposals.length}`} id="review">
          <ReviewList
            tripId={trip.id}
            catalog={catalog}
            proposals={proposals}
            all={events}
            travelers={travelers}
            canEdit={isAdmin}
            onChanged={(next) => {
              ctx.apply(next);
              todayCtx.reload();
            }}
            onEdit={(e) => ctx.openEventForm(e)}
            onOpenDocument={(id, page) => ctx.openDocument(id, page, documentTitle(id))}
          />
          <HelpCard id="help-review" defaultOpen={false} />
        </Section>
      ) : null}

      <Section title="Dokumente" id="sec-docs">
        {error && !docs ? (
          <div className="card">
            {error instanceof ApiError && error.status === 403 ? (
              <EmptyState icon="lock" title="Kein Zugriff auf die Dokumente">
                Für diese Reise hast du keine Berechtigung für Dokumente. Wende dich an die Person, die die Reise verwaltet.
              </EmptyState>
            ) : (
              <EmptyState icon="alert" title="Dokumente konnten nicht geladen werden">
                {errorMessage(error)}
              </EmptyState>
            )}
          </div>
        ) : docs === null ? (
          <div className="card">
            <Spinner />
          </div>
        ) : docs.length === 0 ? (
          <div className="card empty--illu empty">
            <IllustrationCard id="empty-documents" decorative />
            <div className="empty__text">
              <h3>Noch keine Dokumente</h3>
              <p className="muted">
                Ziehe Buchungsbestätigungen, Tickets oder Versicherungspolicen in den Upload-Bereich. TravelBuddy liest sie aus und
                schlägt die Ereignisse vor.
              </p>
            </div>
          </div>
        ) : (
          <ul className="list card card--flush docs__list">
            {docs.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                detailTo={`/documents/${d.id}`}
                eventTitles={titlesByDoc.get(d.id)}
                onOpen={() => ctx.openDocument(d.id, undefined, d.title || d.fileName)}
                onAnalyze={() => void analyze(d)}
              />
            ))}
          </ul>
        )}
      </Section>

      <HelpCard id="help-share" defaultOpen={docs !== null && docs.length === 0} />
    </div>
  );
}
