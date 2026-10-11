/**
 * pdf.js wird erst beim ersten PDF geladen (eigener Chunk, Hauptbündel bleibt klein). Der Worker kommt
 * same-origin aus `/assets/`, damit die strenge CSP (`script-src 'self'`) unverändert bleibt.
 * Verwendet wird die «legacy»-Fassung: Sie bringt Polyfills mit und läuft auch in älteren Safari-Versionen.
 */
type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib as PdfJs;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
