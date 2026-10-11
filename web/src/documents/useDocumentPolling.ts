import { useEffect, useRef } from "react";
import { documentsApi } from "../api/endpoints";
import type { DocumentItem } from "../api/types";
import { isAnalysisActive } from "../lib/upload";

/**
 * Fragt Dokumente, deren Auswertung noch läuft, regelmässig ab (`GET /v1/documents/:id`), bis sie fertig
 * oder fehlgeschlagen sind. Der Abstand wächst von 2 auf höchstens 8 Sekunden; nach 5 Minuten ist Schluss.
 */
export function useDocumentPolling(docs: DocumentItem[], onUpdate: (d: DocumentItem) => void, enabled = true): void {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  const activeIds = docs.filter((d) => isAnalysisActive(d.analysisStatus)).map((d) => d.id);
  const key = activeIds.join(",");
  useEffect(() => {
    if (!enabled || activeIds.length === 0) return;
    let alive = true;
    const started = Date.now();
    let delay = 2000;
    let timer: number | undefined;
    const tick = async () => {
      if (!alive) return;
      await Promise.all(
        activeIds.map(async (id) => {
          try {
            const d = await documentsApi.get(id);
            if (alive) cb.current(d);
          } catch {
            /* nächster Versuch */
          }
        })
      );
      if (!alive || Date.now() - started > 5 * 60_000) return;
      delay = Math.min(delay * 1.4, 8000);
      timer = window.setTimeout(() => void tick(), delay);
    };
    timer = window.setTimeout(() => void tick(), delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
