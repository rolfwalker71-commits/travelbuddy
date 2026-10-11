import { useState } from "react";
import type { Traveler, TripEvent } from "../api/types";
import { errorMessage } from "../api/client";
import { trips as api } from "../api/endpoints";
import type { Catalog } from "../lib/catalog";
import { formatDate } from "../lib/dates";
import { confidenceOf, firstQuote, keyFacts, routeOf } from "../lib/eventUi";
import { confidenceLabel, mergeCandidates } from "../lib/review";
import { typeInfo } from "../trip/EventTicket";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { documentTitle } from "../lib/docTitles";
import type { TripDetail } from "../api/types";

/**
 * «Zu prüfen»: Vorschläge aus Dokumenten mit Quellenausschnitt und Sicherheit.
 * Übernehmen · Bearbeiten · Zusammenführen · Verwerfen. Nichts wird ungeprüft übernommen.
 */
export function ReviewList({
  tripId,
  catalog,
  proposals,
  all,
  travelers,
  onChanged,
  onEdit,
  onOpenDocument,
  canEdit,
}: {
  tripId: number;
  catalog: Catalog;
  proposals: TripEvent[];
  all: TripEvent[];
  travelers: Traveler[];
  onChanged: (next: TripDetail) => void;
  onEdit: (e: TripEvent) => void;
  onOpenDocument: (documentId: number, page?: number) => void;
  canEdit: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [merging, setMerging] = useState<TripEvent | null>(null);

  const run = async (id: number, fn: () => Promise<TripDetail>, ok: string) => {
    setBusy(id);
    try {
      onChanged(await fn());
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  if (proposals.length === 0) return null;

  return (
    <>
      <ul className="review">
        {proposals.map((e) => {
          const info = typeInfo(catalog, e);
          const conf = confidenceLabel(confidenceOf(e));
          const quote = firstQuote(e);
          const facts = keyFacts(catalog, e, { travelers, max: 5 });
          const route = routeOf(e);
          const cands = mergeCandidates(e, all);
          const strong = cands[0] && cands[0].score >= 2 ? cands[0] : null;
          const docId = quote?.documentId ?? e.sourceDocumentId ?? null;
          return (
            <li key={e.id} className={`prop${e.status === "needs_review" ? " prop--warn" : ""}`} style={{ ["--tk" as string]: `var(--k-${info.color})` }}>
              <div className="prop__head">
                <span className="prop__ic" aria-hidden="true">
                  <Icon name={info.icon} size={18} />
                </span>
                <div className="prop__title">
                  <strong>{e.title}</strong>
                  <span className="muted small num">
                    {formatDate(e.startDate)}
                    {e.startTime ? ` · ${e.startTime}` : ""}
                    {route ? ` · ${route.from} → ${route.to}` : ""}
                  </span>
                </div>
                <span className="prop__chips">
                  {e.status === "needs_review" ? <Chip tone="review" icon="alert">Zu prüfen</Chip> : <Chip tone="proposal" icon="sparkle">Vorschlag</Chip>}
                  <Chip tone={conf.tone === "pos" ? "pos" : conf.tone === "warn" ? "warn" : "neutral"} title="Sicherheit der Erkennung">
                    {conf.text}
                  </Chip>
                </span>
              </div>
              {quote ? (
                <blockquote className="quote">
                  <span>«{quote.quote}»</span>
                  {docId != null ? (
                    <button type="button" className="link-btn" onClick={() => onOpenDocument(docId, quote.page)}>
                      <Icon name="file" size={14} /> {documentTitle(docId)}
                      {quote.page ? `, Seite ${quote.page}` : ""}
                    </button>
                  ) : null}
                </blockquote>
              ) : docId != null ? (
                <button type="button" className="link-btn" onClick={() => onOpenDocument(docId)}>
                  <Icon name="file" size={14} /> Quelle: {documentTitle(docId)}
                </button>
              ) : null}
              {facts.length > 0 || e.address ? (
                <dl className="kv2">
                  {e.address && !facts.some((f) => f.label === "Adresse") ? (
                    <div className="kv2__row">
                      <dt>Adresse</dt>
                      <dd>{e.address}</dd>
                    </div>
                  ) : null}
                  {facts.map((f) => (
                    <div key={f.label} className="kv2__row">
                      <dt>{f.label}</dt>
                      <dd className={f.mono ? "num" : undefined}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {strong ? (
                <p className="muted small">
                  Passt zu «{strong.event.title}» ({strong.reason}). Zusammenführen ergänzt nur leere Felder.
                </p>
              ) : null}
              {canEdit ? (
                <div className="prop__actions">
                  <Button variant="primary" icon="check" busy={busy === e.id} onClick={() => void run(e.id, () => api.confirmEvent(tripId, e.id), "Vorschlag übernommen")}>
                    Übernehmen
                  </Button>
                  <Button icon="edit" onClick={() => onEdit(e)}>
                    Bearbeiten
                  </Button>
                  <Button icon="merge" disabled={cands.length === 0 && all.filter((x) => x.id !== e.id && (!x.status || x.status === "confirmed")).length === 0} onClick={() => setMerging(e)}>
                    Zusammenführen
                  </Button>
                  <Button
                    variant="ghost"
                    icon="trash"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Vorschlag verwerfen?",
                        message: `«${e.title}» wird gelöscht. Das Dokument bleibt erhalten.`,
                        confirmLabel: "Verwerfen",
                        danger: true,
                      });
                      if (ok) await run(e.id, () => api.deleteEvent(tripId, e.id), "Vorschlag verworfen");
                    }}
                  >
                    Verwerfen
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {merging ? (
        <MergeSheet
          proposal={merging}
          all={all}
          catalog={catalog}
          onClose={() => setMerging(null)}
          onMerge={async (intoId) => {
            const p = merging;
            setMerging(null);
            await run(p.id, () => api.mergeEvent(tripId, p.id, intoId), "Mit vorhandenem Ereignis zusammengeführt");
          }}
        />
      ) : null}
    </>
  );
}

function MergeSheet({
  proposal,
  all,
  catalog,
  onClose,
  onMerge,
}: {
  proposal: TripEvent;
  all: TripEvent[];
  catalog: Catalog;
  onClose: () => void;
  onMerge: (intoId: number) => void;
}) {
  const cands = mergeCandidates(proposal, all);
  const rest = all.filter((e) => e.id !== proposal.id && (!e.status || e.status === "confirmed") && !cands.some((c) => c.event.id === e.id));
  const rows = [...cands.map((c) => ({ e: c.event, note: c.reason })), ...rest.map((e) => ({ e, note: "" }))];
  return (
    <Sheet
      open
      onClose={onClose}
      title="Mit vorhandenem Ereignis zusammenführen"
      description={`In welches Ereignis soll «${proposal.title}» eingearbeitet werden? Es werden nur leere Felder ergänzt, von Hand gesetzte Werte bleiben.`}
    >
      <ul className="list card card--flush">
        {rows.map(({ e, note }) => {
          const info = typeInfo(catalog, e);
          return (
            <li key={e.id}>
              <button type="button" className="row row--button" onClick={() => onMerge(e.id)}>
                <span className="event__icon" style={{ background: `var(--k-${info.color})`, color: "#fff" }} aria-hidden="true">
                  <Icon name={info.icon} size={18} />
                </span>
                <span className="row__main">
                  <span className="row__title">{e.title}</span>
                  <span className="row__sub num">
                    {formatDate(e.startDate)}
                    {e.startTime ? ` · ${e.startTime}` : ""}
                    {note ? ` · ${note}` : ""}
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="row__chev" />
              </button>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="row muted">Es gibt kein bestätigtes Ereignis, in das sich der Vorschlag einarbeiten liesse.</li> : null}
      </ul>
    </Sheet>
  );
}
