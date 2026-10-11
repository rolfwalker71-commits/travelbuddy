import { Link } from "react-router-dom";
import { inbox } from "../api/endpoints";
import { useDocumentPolling } from "../documents/useDocumentPolling";
import { QueryView, useQuery } from "../hooks/useQuery";
import { formatDate, formatTimestamp } from "../lib/dates";
import { ANALYSIS_LABEL } from "../lib/upload";
import { useCatalog } from "../state/catalog";
import { typeInfo } from "../trip/EventTicket";
import { Chip } from "../ui/Chip";
import { SkeletonCards } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { HelpCard, IllustrationCard } from "../ui/IllustrationCard";
import { PageHeader, Section } from "../ui/bits";

/** Eingang über alle Reisen: Dokumente in Arbeit und Vorschläge, die Aufmerksamkeit brauchen. */
export function InboxPage() {
  const q = useQuery((s) => inbox.get(s), []);
  const catalog = useCatalog();
  useDocumentPolling(q.data?.documents ?? [], () => q.reload());
  return (
    <div className="page page--narrow">
      <PageHeader title="Zu prüfen" eyebrow="Eingang" subtitle="Erkannte Buchungen und Dokumente in Arbeit" />
      <QueryView query={q} skeleton={<SkeletonCards count={2} />}>
        {(data) =>
          data.documents.length === 0 && data.review.length === 0 ? (
            <div className="card empty--illu empty">
              <IllustrationCard id="empty-documents" decorative />
              <div className="empty__text">
                <h3>Alles geprüft</h3>
                <p className="muted">Es gibt keine Vorschläge und keine Dokumente in Arbeit.</p>
              </div>
            </div>
          ) : (
            <>
              {data.review.length > 0 ? (
                <Section title={`Vorschläge · ${data.review.length}`} id="sec-review">
                  <ul className="list card card--flush">
                    {data.review.map((r) => {
                      const info = typeInfo(catalog, r.event);
                      return (
                        <li key={`${r.tripId}-${r.event.id}`}>
                          <Link className="row row--button" to={`/trips/${r.tripId}/documents#review`}>
                            <span className="event__icon" style={{ background: `var(--k-${info.color})`, color: "#fff" }} aria-hidden="true">
                              <Icon name={info.icon} size={18} />
                            </span>
                            <span className="row__main">
                              <span className="row__title">{r.event.title}</span>
                              <span className="row__sub">
                                {r.tripTitle}
                                {r.event.startDate ? ` · ${formatDate(r.event.startDate)}` : ""}
                              </span>
                            </span>
                            {r.event.status === "needs_review" ? <Chip tone="review" icon="alert">Zu prüfen</Chip> : <Chip tone="proposal">Vorschlag</Chip>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              ) : null}
              {data.documents.length > 0 ? (
                <Section title="Dokumente in Arbeit" id="sec-docs">
                  <ul className="list card card--flush">
                    {data.documents.map((d) => (
                      <li key={d.id} className="row">
                        <Icon name="file" size={18} />
                        <span className="row__main">
                          <span className="row__title">{d.title || d.fileName}</span>
                          <span className="row__sub">{formatTimestamp(d.createdAt)}</span>
                        </span>
                        <Chip tone={d.analysisStatus === "failed" ? "neg" : "accent"} icon={d.analysisStatus === "failed" ? "alert" : "refresh"}>
                          {ANALYSIS_LABEL[d.analysisStatus]}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          )
        }
      </QueryView>
      <HelpCard id="help-review" defaultOpen={false} />
    </div>
  );
}

