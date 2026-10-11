import { useEffect, useState } from "react";
import { apiBlob } from "../api/client";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { documentErrorInfo } from "../lib/documents";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Spinner } from "./Feedback";
import { PdfViewer } from "./PdfViewer";
import { Sheet } from "./Sheet";

/** Erklärung zu einem Ladefehler eines Dokuments, mit «Erneut versuchen», wo es etwas bringt. */
export function DocumentProblem({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const info = documentErrorInfo(error);
  return (
    <div className={`doc-problem${compact ? " doc-problem--compact" : ""}`} role="alert">
      <Icon name="alert" size={compact ? 20 : 28} />
      <p className="doc-problem__title">{info.title}</p>
      {!compact ? <p className="muted small">{info.text}</p> : null}
      {info.retry && onRetry ? (
        <Button size="s" icon="refresh" onClick={onRetry}>
          Erneut versuchen
        </Button>
      ) : null}
    </div>
  );
}

/** Kleine Vorschau eines Dokuments (Thumbnail per Blob-URL). */
export function DocThumb({ documentId, label, enabled = true }: { documentId: number; label: string; enabled?: boolean }) {
  const t = useBlobUrl(`/v1/documents/${documentId}/thumbnail`, enabled);
  if (t.url) return <img src={t.url} alt={label} className="doc-thumb" />;
  return (
    <span className="doc-thumb doc-thumb--ph" title={t.error ? documentErrorInfo(t.error).title : undefined}>
      {t.loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="file" size={20} />}
    </span>
  );
}

async function saveBlob(path: string, fallbackName: string) {
  const { blob, filename } = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Dokument in einem grossen Sheet ansehen (PDF mit pdf.js, Bilder direkt); optional ab einer Seite. */
export function DocumentSheet({
  documentId,
  title,
  page,
  onClose,
}: {
  documentId: number | null;
  title: string;
  page?: number;
  onClose: () => void;
}) {
  if (documentId == null) return null;
  return <DocumentViewer key={`${documentId}-${page ?? 0}`} documentId={documentId} title={title} page={page} onClose={onClose} />;
}

function DocumentViewer({ documentId, title, page, onClose }: { documentId: number; title: string; page?: number; onClose: () => void }) {
  const path = `/v1/documents/${documentId}/file`;
  const f = useBlobUrl(path);
  const [dlError, setDlError] = useState<unknown>(null);
  useEffect(() => setDlError(null), [documentId]);

  return (
    <Sheet
      open
      onClose={onClose}
      title={page ? `${title} · Seite ${page}` : title}
      size="xl"
      footer={
        <>
          {f.url ? (
            <a className="btn btn--secondary btn--m" href={f.url} target="_blank" rel="noreferrer">
              <Icon name="external" size={18} />
              <span>In neuem Tab öffnen</span>
            </a>
          ) : null}
          <Button
            icon="download"
            disabled={!f.url}
            onClick={() => {
              saveBlob(path, `Dokument-${documentId}.pdf`).catch(setDlError);
            }}
          >
            Herunterladen
          </Button>
          <Button variant="primary" onClick={onClose}>
            Schliessen
          </Button>
        </>
      }
    >
      <div className="doc-viewer">
        {f.loading ? (
          <div className="doc-preview__ph">
            <Spinner label="Dokument wird geladen …" />
          </div>
        ) : f.url ? (
          f.type?.startsWith("image/") ? (
            <img src={f.url} alt={title} className="doc-viewer__img" />
          ) : f.blob ? (
            <PdfViewer blob={f.blob} title={title} initialPage={page} />
          ) : null
        ) : (
          <DocumentProblem error={f.error} onRetry={f.reload} />
        )}
        {dlError ? <DocumentProblem error={dlError} compact /> : null}
      </div>
    </Sheet>
  );
}
