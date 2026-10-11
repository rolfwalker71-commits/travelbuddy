/** Reine Rechenlogik des PDF-Betrachters (Zoom, Skalierung, Seitenbereich). */

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Nächste Zoomstufe (`dir` = +1 oder -1); an den Enden bleibt der Wert stehen. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-9) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i]! < current - 1e-9) return ZOOM_STEPS[i]!;
  }
  return MIN_ZOOM;
}

/** CSS-Breite einer Seite: Containerbreite abzüglich Rand, mal Zoom; nie unter 120 px. */
export function pageCssWidth(containerWidth: number, zoom: number, padding = 24): number {
  return Math.max(120, Math.floor((containerWidth - padding) * zoom));
}

/** Höhe eines Platzhalters aus dem Seitenverhältnis (Höhe/Breite). */
export function placeholderHeight(cssWidth: number, aspect: number): number {
  return Math.max(1, Math.round(cssWidth * aspect));
}

/** Safari begrenzt Canvas auf rund 16,7 Mio. Pixel; darunter bleiben, sonst bleibt die Seite leer. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Ausgabemassstab (Pixel je CSS-Pixel): `devicePixelRatio`, begrenzt auf 3 und die Canvas-Obergrenze. */
export function outputScale(cssWidth: number, cssHeight: number, dpr: number): number {
  const wanted = Math.min(3, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
  const pixels = cssWidth * cssHeight * wanted * wanted;
  if (pixels <= MAX_CANVAS_PIXELS) return wanted;
  return Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)));
}

/**
 * Welche Seite gilt als aktuell? Die erste, deren Unterkante unterhalb einer Linie bei einem Drittel der
 * Sichtbreite liegt. `tops`/`heights` sind die Positionen der Seiten im Scrollbereich.
 */
export function currentPageIndex(tops: number[], heights: number[], scrollTop: number, viewHeight: number): number {
  if (tops.length === 0) return 0;
  const line = scrollTop + viewHeight / 3;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! + heights[i]! > line) return i;
  }
  return tops.length - 1;
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)} %`;
}
