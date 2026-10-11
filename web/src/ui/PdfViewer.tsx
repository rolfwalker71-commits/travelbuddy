import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "../lib/pdfjs";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  currentPageIndex,
  outputScale,
  pageCssWidth,
  placeholderHeight,
  stepZoom,
  zoomLabel,
} from "../lib/pdfLayout";
import { Spinner } from "./Feedback";
import { IconButton } from "./Button";
import "../styles/pdfviewer.css";

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; doc: PDFDocumentProxy };

/** Verständliche deutsche Meldung zu einem pdf.js-Fehler. */
function pdfErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "PasswordException") return "Das PDF ist passwortgeschützt und kann hier nicht angezeigt werden.";
  if (name === "InvalidPDFException") return "Die Datei ist kein gültiges PDF oder beschädigt.";
  if (name === "MissingPDFException") return "Das PDF konnte nicht gefunden werden.";
  return "Das PDF konnte nicht angezeigt werden.";
}

/**
 * PDF-Betrachter mit pdf.js: Seiten als `<canvas>`, Breite folgt dem Container, Seiten werden erst beim
 * Annähern gerendert. Ersetzt das `<iframe>`, das in Safari innerhalb eines Modal-Dialogs weiss blieb.
 */
export function PdfViewer({ blob, title, initialPage }: { blob: Blob; title: string; initialPage?: number }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [aspect, setAspect] = useState(1.414);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const ratio = useRef<number | null>(null);

  // Dokument laden: Bytes stammen aus dem bereits geladenen Blob, es gibt keine zweite Anfrage.
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    let task: { destroy: () => Promise<void> } | null = null;
    setStatus({ kind: "loading" });
    (async () => {
      try {
        const [lib, buf] = await Promise.all([loadPdfjs(), blob.arrayBuffer()]);
        if (cancelled) return;
        const loading = lib.getDocument({
          data: new Uint8Array(buf),
          // pdf.js 5.x kommt ohne eval/Function aus; die CSP (kein 'unsafe-eval') bleibt unverändert.
          enableXfa: false,
        });
        task = loading;
        doc = await loading.promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        const first = await doc.getPage(1);
        const v = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setAspect(v.height / v.width);
        setPage(1);
        setStatus({ kind: "ready", doc });
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", message: pdfErrorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [blob]);

  // Containerbreite verfolgen.
  useEffect(() => {
    if (!root) return;
    setWidth(root.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(root.clientWidth));
    });
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [root, status.kind]);

  // Sprung zur Seite, aus der ein Feld stammt (Herkunftspunkt, Quellenausschnitt).
  useEffect(() => {
    if (!root || status.kind !== "ready" || !initialPage || initialPage < 2) return;
    const id = requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>(`[data-page="${initialPage}"]`);
      if (el) root.scrollTop = Math.max(0, el.offsetTop - 12);
    });
    return () => cancelAnimationFrame(id);
    // Nur beim ersten Anzeigen springen, nicht bei jedem Zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, status.kind, initialPage]);

  // Beim Zoomen die relative Leseposition behalten.
  useLayoutEffect(() => {
    if (!root || ratio.current === null) return;
    root.scrollTop = ratio.current * root.scrollHeight;
    ratio.current = null;
  }, [zoom, root]);

  const changeZoom = (next: number) => {
    if (next === zoom) return;
    if (root && root.scrollHeight > 0) ratio.current = root.scrollTop / root.scrollHeight;
    setZoom(next);
  };

  const raf = useRef(0);
  const onScroll = useCallback(() => {
    if (!root) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const els = [...root.querySelectorAll<HTMLElement>("[data-page]")];
      const tops = els.map((e) => e.offsetTop);
      const heights = els.map((e) => e.offsetHeight);
      setPage(currentPageIndex(tops, heights, root.scrollTop, root.clientHeight) + 1);
    });
  }, [root]);

  if (status.kind === "error") {
    return (
      <div className="pdfv pdfv--state" role="alert">
        <p className="doc-problem__title">{status.message}</p>
        <p className="muted small">Über «In neuem Tab öffnen» oder «Herunterladen» lässt sich die Datei trotzdem ansehen.</p>
      </div>
    );
  }
  if (status.kind === "loading") {
    return (
      <div className="pdfv pdfv--state">
        <Spinner label="PDF wird aufbereitet …" />
      </div>
    );
  }

  const doc = status.doc;
  const cssWidth = pageCssWidth(width, zoom);
  const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);

  return (
    <div className="pdfv">
      <div className="pdfv__bar" role="toolbar" aria-label="PDF-Anzeige">
        <span className="pdfv__pages" aria-live="polite">
          Seite {Math.min(page, doc.numPages)} von {doc.numPages}
        </span>
        <span className="pdfv__zoom">
          <IconButton icon="minus" label="Verkleinern" size="s" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(stepZoom(zoom, -1))} />
          <button type="button" className="pdfv__level" title="Auf Seitenbreite zurücksetzen" onClick={() => changeZoom(1)}>
            {zoomLabel(zoom)}
          </button>
          <IconButton icon="plus" label="Vergrössern" size="s" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(stepZoom(zoom, 1))} />
        </span>
      </div>
      <div
        ref={setRoot}
        className="pdfv__scroll"
        tabIndex={0}
        role="region"
        aria-label={`PDF: ${title}`}
        onScroll={onScroll}
      >
        <div className="pdfv__pages-col" style={{ width: cssWidth }}>
          {pages.map((n) => (
            <PdfPage key={n} doc={doc} number={n} cssWidth={cssWidth} aspect={aspect} root={root} total={doc.numPages} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  number,
  cssWidth,
  aspect,
  root,
  total,
}: {
  doc: PDFDocumentProxy;
  number: number;
  cssWidth: number;
  aspect: number;
  root: HTMLElement | null;
  total: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(number === 1);
  const [height, setHeight] = useState(() => placeholderHeight(cssWidth, aspect));
  const [failed, setFailed] = useState(false);

  // Nur Seiten in der Nähe des sichtbaren Bereichs rendern.
  useEffect(() => {
    const el = box.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
      root,
      rootMargin: "900px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Platzhalterhöhe folgt Breite und Seitenverhältnis, solange die Seite nicht gerendert ist.
  useEffect(() => {
    setHeight((h) => (near ? h : placeholderHeight(cssWidth, aspect)));
  }, [cssWidth, aspect, near]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!near) {
      // Speicher freigeben, die Höhe bleibt als Platzhalter stehen.
      el.width = 0;
      el.height = 0;
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        const p = await doc.getPage(number);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: cssWidth / base.width });
        const scale = outputScale(viewport.width, viewport.height, window.devicePixelRatio);
        el.width = Math.max(1, Math.floor(viewport.width * scale));
        el.height = Math.max(1, Math.floor(viewport.height * scale));
        el.style.width = `${Math.floor(viewport.width)}px`;
        el.style.height = `${Math.floor(viewport.height)}px`;
        setHeight(Math.floor(viewport.height));
        const ctx = el.getContext("2d");
        if (!ctx) throw new Error("canvas");
        task = p.render({
          canvas: el,
          canvasContext: ctx,
          viewport,
          transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
        });
        await task.promise;
        if (!cancelled) setFailed(false);
      } catch (e) {
        if (cancelled || (e instanceof Error && e.name === "RenderingCancelledException")) return;
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, cssWidth, near]);

  return (
    <div ref={box} className="pdfv__page" data-page={number} style={{ height }}>
      <canvas ref={canvas} role="img" aria-label={`Seite ${number} von ${total}`} />
      {failed ? <p className="pdfv__fail muted small">Seite {number} konnte nicht dargestellt werden.</p> : null}
    </div>
  );
}
