import { useCallback, useEffect, useState } from "react";
import { apiBlob } from "../api/client";

/** Lädt eine geschützte Datei (Bearer-Header) und stellt sie als Blob-URL bereit. */
export function useBlobUrl(path: string | null, enabled = true) {
  const [state, setState] = useState<{
    url: string | null;
    /** Die geladenen Bytes (z. B. für pdf.js), ohne zweite Anfrage. */
    blob: Blob | null;
    type: string | null;
    error: unknown;
    loading: boolean;
  }>({
    url: null,
    blob: null,
    type: null,
    error: null,
    loading: false,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path || !enabled) {
      setState({ url: null, blob: null, type: null, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    let created: string | null = null;
    setState({ url: null, blob: null, type: null, error: null, loading: true });
    apiBlob(path, ctrl.signal)
      .then(({ blob }) => {
        if (ctrl.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setState({ url: created, blob, type: blob.type, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ url: null, blob: null, type: null, error: e, loading: false });
      });
    return () => {
      ctrl.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
