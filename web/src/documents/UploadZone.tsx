import { useCallback, useId, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { documentsApi } from "../api/endpoints";
import type { DocumentItem } from "../api/types";
import { ACCEPT, ANALYSIS_LABEL, checkUploadFile, formatBytes, isAnalysisActive, percent } from "../lib/upload";
import { Icon } from "../ui/Icon";
import { Chip } from "../ui/Chip";
import { useDocumentPolling } from "./useDocumentPolling";

type Item = {
  key: number;
  name: string;
  size: number;
  progress: number;
  phase: "uploading" | "analyzing" | "done" | "failed";
  doc?: DocumentItem;
  duplicate?: boolean;
  error?: string;
};

let seq = 1;

/**
 * Upload per Drag-and-drop und Dateiauswahl (an die Reise, optional an ein Ereignis): Fortschritt je Datei,
 * danach Abfrage des Analysestatus, bis die Auswertung fertig ist. Meldet jede abgeschlossene Auswertung.
 */
export function UploadZone({
  tripId,
  eventId = null,
  compact = false,
  onUploaded,
  onAnalyzed,
}: {
  tripId: number;
  eventId?: number | null;
  compact?: boolean;
  /** Datei ist auf dem Server (Auswertung läuft). */
  onUploaded?: (doc: DocumentItem) => void;
  /** Auswertung beendet (Vorschläge sind angelegt oder sie ist fehlgeschlagen). */
  onAnalyzed?: (doc: DocumentItem) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const depth = useRef(0);

  const patch = useCallback((key: number, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const start = useCallback(
    async (files: File[]) => {
      const errors: string[] = [];
      const ok: File[] = [];
      for (const f of files) {
        const c = checkUploadFile(f);
        if (c.ok) ok.push(f);
        else errors.push(c.error);
      }
      setRejected(errors);
      for (const f of ok) {
        const key = seq++;
        setItems((cur) => [...cur, { key, name: f.name, size: f.size, progress: 0, phase: "uploading" }]);
        try {
          const { document: doc, duplicate } = await documentsApi.uploadToTrip(tripId, f, {
            eventId,
            onProgress: (l, t) => patch(key, { progress: percent(l, t) }),
          });
          const active = isAnalysisActive(doc.analysisStatus);
          patch(key, { progress: 100, doc, duplicate, phase: active ? "analyzing" : doc.analysisStatus === "failed" ? "failed" : "done", error: doc.analysisError ?? undefined });
          onUploaded?.(doc);
          if (!active) onAnalyzed?.(doc);
        } catch (e) {
          patch(key, { phase: "failed", error: errorMessage(e) });
        }
      }
    },
    [tripId, eventId, patch, onUploaded, onAnalyzed]
  );

  // Analysestatus der hochgeladenen Dateien nachfragen
  const analyzing = items.filter((i) => i.phase === "analyzing" && i.doc).map((i) => i.doc!);
  useDocumentPolling(analyzing, (d) => {
    setItems((cur) =>
      cur.map((i) => {
        if (i.doc?.id !== d.id) return i;
        const active = isAnalysisActive(d.analysisStatus);
        return { ...i, doc: d, phase: active ? "analyzing" : d.analysisStatus === "failed" ? "failed" : "done", error: d.analysisError ?? undefined };
      })
    );
    if (!isAnalysisActive(d.analysisStatus)) onAnalyzed?.(d);
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length > 0) void start(files);
  };

  return (
    <div className="upload">
      <div
        className={`dropzone${over ? " is-over" : ""}${compact ? " dropzone--compact" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <span className="dropzone__ic" aria-hidden="true">
          <Icon name="file" size={26} />
        </span>
        <div className="dropzone__text">
          <strong>PDF hier ablegen</strong>
          <span className="muted small">
            Buchungsbestätigungen werden erkannt und als Vorschlag angelegt. PDF, JPG, PNG, HEIC, Wallet-Pass oder Kalenderdatei, bis 25 MB.
          </span>
        </div>
        <label htmlFor={inputId} className="btn btn--primary btn--m dropzone__btn">
          <Icon name="upload" size={18} />
          <span>Datei wählen</span>
        </label>
        <input
          id={inputId}
          ref={input}
          className="sr-only"
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            e.target.value = "";
            if (files.length > 0) void start(files);
          }}
        />
      </div>

      {rejected.length > 0 ? (
        <ul className="upload__rejected" role="alert">
          {rejected.map((r) => (
            <li key={r}>
              <Icon name="alert" size={14} /> {r}
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <ul className="upload__list" aria-live="polite">
          {items.map((i) => (
            <li key={i.key} className={`upload__item upload__item--${i.phase}`}>
              <span className="upload__name truncate">{i.name}</span>
              <span className="muted xsmall num">{formatBytes(i.size)}</span>
              {i.phase === "uploading" ? (
                <>
                  <span className="upload__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.progress} aria-label={`Upload ${i.name}`}>
                    <span style={{ width: `${i.progress}%` }} />
                  </span>
                  <span className="num xsmall">{i.progress} %</span>
                </>
              ) : i.phase === "analyzing" ? (
                <Chip tone="accent" icon="refresh">
                  {i.doc ? ANALYSIS_LABEL[i.doc.analysisStatus] : "Wird ausgewertet"}
                </Chip>
              ) : i.phase === "done" ? (
                <Chip tone="pos" icon="check">
                  {i.duplicate ? "Schon vorhanden" : i.doc?.analysisStatus === "skipped" ? "Abgelegt" : "Ausgewertet"}
                </Chip>
              ) : (
                <Chip tone="neg" icon="alert" title={i.error}>
                  {i.error ?? "Fehlgeschlagen"}
                </Chip>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
