import { Link } from "react-router-dom";
import type { DocumentItem } from "../api/types";
import { formatTimestamp } from "../lib/dates";
import { ANALYSIS_LABEL, formatBytes, isAnalysisActive } from "../lib/upload";
import { Chip } from "../ui/Chip";
import { DocThumb } from "../ui/DocumentParts";
import { Button } from "../ui/Button";

/** Eine Zeile in der Dokumentliste: Vorschau, Titel, Status, Verknüpfungen. */
export function DocumentRow({
  doc,
  onOpen,
  onAnalyze,
  eventTitles,
  detailTo,
}: {
  doc: DocumentItem;
  onOpen: () => void;
  onAnalyze?: () => void;
  eventTitles?: string[];
  detailTo?: string;
}) {
  const active = isAnalysisActive(doc.analysisStatus);
  return (
    <li className="docrow">
      <DocThumb documentId={doc.id} label={`Vorschau von ${doc.title}`} enabled={doc.thumbnailUrl !== null} />
      <div className="docrow__main">
        {detailTo ? (
          <Link to={detailTo} className="docrow__title">
            {doc.title || doc.fileName}
          </Link>
        ) : (
          <span className="docrow__title">{doc.title || doc.fileName}</span>
        )}
        <span className="muted xsmall">
          {doc.fileName} · {formatBytes(doc.sizeBytes)}
          {doc.pages ? ` · ${doc.pages} ${doc.pages === 1 ? "Seite" : "Seiten"}` : ""} · {formatTimestamp(doc.createdAt)}
        </span>
        {doc.summary ? <span className="docrow__sum small">{doc.summary}</span> : null}
        <span className="row__badges">
          {doc.analysisStatus === "done" ? (
            <Chip tone="pos" icon="check">{ANALYSIS_LABEL.done}</Chip>
          ) : doc.analysisStatus === "failed" ? (
            <Chip tone="neg" icon="alert" title={doc.analysisError ?? undefined}>{ANALYSIS_LABEL.failed}</Chip>
          ) : active ? (
            <Chip tone="accent" icon="refresh">{ANALYSIS_LABEL[doc.analysisStatus]}</Chip>
          ) : (
            <Chip>{ANALYSIS_LABEL[doc.analysisStatus] ?? doc.analysisStatus}</Chip>
          )}
          {eventTitles && eventTitles.length > 0 ? <Chip icon="link">{eventTitles.slice(0, 2).join(", ")}{eventTitles.length > 2 ? ` +${eventTitles.length - 2}` : ""}</Chip> : null}
        </span>
        {doc.analysisStatus === "failed" && doc.analysisError ? <span className="field__error xsmall">{doc.analysisError}</span> : null}
        {doc.analysisStatus === "skipped" && doc.analysisError ? <span className="muted xsmall">{doc.analysisError}. Ereignisse lassen sich von Hand erfassen.</span> : null}
      </div>
      <div className="docrow__actions">
        <Button size="s" icon="external" onClick={onOpen}>
          Öffnen
        </Button>
        {onAnalyze && (doc.analysisStatus === "failed" || doc.analysisStatus === "skipped") ? (
          <Button size="s" variant="ghost" icon="refresh" onClick={onAnalyze}>
            Erneut auswerten
          </Button>
        ) : null}
      </div>
    </li>
  );
}
