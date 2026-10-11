import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { mediaApi } from "../api/endpoints";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";

type Progress = { total: number; done: number; failed: number };

/**
 * Ereignisbilder einer Reise gesamthaft per KI erzeugen: nur fehlende oder alle (eigene Bilder bleiben).
 * Die Erzeugung läuft auf dem Server weiter, auch wenn das Fenster geschlossen wird.
 */
export function BulkImages({ tripId, open, onClose, onDone }: { tripId: number; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const poll = () => {
    stop();
    timer.current = window.setInterval(async () => {
      try {
        const { job } = await mediaApi.tripStatus(tripId);
        if (!job) return;
        setProgress({ total: job.total, done: job.done, failed: job.failed });
        if (!job.running) {
          stop();
          setBusy(false);
          onDone();
          toast(job.failed > 0 ? `${job.done - job.failed} Bilder erzeugt, ${job.failed} fehlgeschlagen` : `${job.done} Bilder erzeugt`, job.failed > 0 ? "error" : undefined);
        }
      } catch {
        /* nächster Versuch */
      }
    }, 4000);
  };

  const start = async (mode: "missing" | "all") => {
    setBusy(true);
    try {
      const r = await mediaApi.generateTrip(tripId, mode);
      if (r.queued === 0) {
        setBusy(false);
        toast("Nichts zu erzeugen");
        return;
      }
      setProgress({ total: r.queued, done: 0, failed: 0 });
      poll();
    } catch (e) {
      setBusy(false);
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="KI-Bilder für alle Ereignisse"
      description="Pro Bild dauert die Erzeugung etwa eine halbe Minute. Sie läuft auf dem Server weiter, auch wenn du dieses Fenster schliesst."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {busy ? "Im Hintergrund weiter" : "Schliessen"}
          </Button>
          <Button icon="refresh" disabled={busy} onClick={() => void start("all")}>
            Alle neu erzeugen
          </Button>
          <Button variant="primary" icon="sparkle" busy={busy} onClick={() => void start("missing")}>
            Nur fehlende erzeugen
          </Button>
        </>
      }
    >
      <p>
        <strong>Nur fehlende:</strong> Ereignisse ohne Bild bekommen eines. Bilder, die du entfernt hast, bleiben entfernt.
      </p>
      <p>
        <strong>Alle neu erzeugen:</strong> ersetzt alle KI-Bilder. Eigene, hochgeladene Bilder bleiben unberührt.
      </p>
      {progress ? (
        <p className="muted" role="status">
          {progress.done} von {progress.total} erzeugt{progress.failed ? `, ${progress.failed} fehlgeschlagen` : ""} …
        </p>
      ) : null}
    </Sheet>
  );
}
