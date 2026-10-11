import { useState } from "react";
import type { FieldMeta } from "../api/types";
import { Button } from "./Button";

export type ProvenanceInfo = {
  meta: FieldMeta | undefined;
  /** Öffnet das Dokument (optional bei einer bestimmten Seite). */
  onOpenDocument?: (documentId: number, page?: number) => void;
  /** Dokument des Ereignisses, falls das Feld selbst keines nennt. */
  fallbackDocumentId?: number | null;
};

const LABEL: Record<string, string> = {
  document: "Aus Dokument",
  manual: "Von Hand",
  derived: "Berechnet",
  geocoded: "Per Kartensuche gefunden",
};

/**
 * Herkunftspunkt an einem Feld: gefüllt = aus Dokument, Ring = von Hand. Ein Klick zeigt Zitat und Seite
 * und öffnet das Dokument. Nie nur Farbe: Tooltip und Text nennen die Herkunft.
 */
export function Provenance({ info, fieldLabel }: { info: ProvenanceInfo; fieldLabel: string }) {
  const [open, setOpen] = useState(false);
  const m = info.meta;
  if (!m) return null;
  const kind = m.source === "document" ? "doc" : m.source === "manual" ? "hand" : "derived";
  const docId = m.documentId ?? info.fallbackDocumentId ?? null;
  const label = `${LABEL[m.source] ?? "Herkunft"}${m.page ? `, Seite ${m.page}` : ""}`;
  const hasDetail = Boolean(m.quote) || docId != null || m.confidence != null || m.locked;
  return (
    <span className="prov">
      <button
        type="button"
        className={`prov__dot prov__dot--${kind}`}
        aria-label={`${fieldLabel}: ${label}`}
        aria-expanded={hasDetail ? open : undefined}
        title={label}
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <span className="prov__pop" role="status">
          <strong>{LABEL[m.source] ?? "Herkunft"}</strong>
          {m.confidence != null ? <span className="muted"> · Sicherheit {Math.round(m.confidence * 100)} %</span> : null}
          {m.locked ? <span className="muted"> · gesperrt gegen erneute Analyse</span> : null}
          {m.quote ? <q className="prov__quote">{m.quote}</q> : null}
          {m.page ? <span className="muted xsmall">Seite {m.page}</span> : null}
          {docId != null && info.onOpenDocument ? (
            <Button size="s" icon="file" onClick={() => info.onOpenDocument?.(docId, m.page)}>
              Dokument öffnen
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Legende zu den Herkunftspunkten (oberhalb eines Formulars oder einer Detailansicht). */
export function ProvenanceLegend() {
  return (
    <p className="prov-legend xsmall muted">
      <span>
        <i className="prov__dot prov__dot--doc" aria-hidden="true" /> aus Dokument
      </span>
      <span>
        <i className="prov__dot prov__dot--hand" aria-hidden="true" /> von Hand
      </span>
      <span>Leer = offen</span>
    </p>
  );
}
