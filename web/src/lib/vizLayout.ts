/**
 * Layout-Hilfen für Infografiken, die sich der Breite ihres Behälters anpassen: Achsenabstände, Beschriftungen ohne
 * Überdeckung, gekürzte Namen. Reine Logik (getestet); die SVG-Komponenten rechnen damit in echten Pixeln, damit
 * Schrift auf dem Handy nicht mitschrumpft.
 */

/** Kleinster Schritt aus `steps`, bei dem `step * unitPx >= minSpacingPx`; sonst der grösste. */
export function niceStep(unitPx: number, minSpacingPx: number, steps: readonly number[] = [1, 2, 3, 5, 7, 10, 14, 21, 28, 56]): number {
  for (const s of steps) if (s * unitPx >= minSpacingPx) return s;
  return steps[steps.length - 1]!;
}

/** Geschätzte Textbreite in px (proportional, `perChar` je Zeichen). */
export function textWidth(text: string, perChar = 6.2, pad = 6): number {
  return Math.ceil(text.length * perChar) + pad;
}

export type LabelBox = { x: number; w: number };
export type LabelPlace = { row: number; anchor: "start" | "end"; x0: number; x1: number };

/**
 * Setzt Beschriftungen in Reihen, ohne dass sie sich überdecken. `x` ist der Ankerpunkt, `w` die Breite; liegt das Ende
 * rechts ausserhalb von `width`, wird nach links verankert. Passt eine Beschriftung in keine Reihe, gibt es `null`.
 */
export function placeLabels(items: LabelBox[], width: number, rows: number, gap = 6): (LabelPlace | null)[] {
  const taken: { x0: number; x1: number }[][] = Array.from({ length: rows }, () => []);
  return items.map((it) => {
    const preferStart = it.x + it.w <= width - 2;
    const options: ("start" | "end")[] = preferStart ? ["start", "end"] : ["end", "start"];
    for (const anchor of options) {
      const x0 = anchor === "start" ? it.x : it.x - it.w;
      const x1 = x0 + it.w;
      if (x0 < 0 || x1 > width) continue;
      for (let r = 0; r < rows; r++) {
        if (!taken[r]!.some((t) => x0 < t.x1 + gap && x1 + gap > t.x0)) {
          taken[r]!.push({ x0, x1 });
          return { row: r, anchor, x0, x1 };
        }
      }
    }
    return null;
  });
}

/**
 * Kurzname für Karten und Routenbögen: «Flughafen Zürich (ZRH)» → «ZRH»; sonst bei Bedarf mit Auslassungspunkt gekürzt.
 * Der volle Name steht immer zusätzlich in der Stationenliste unter der Grafik.
 */
export function shortStopLabel(label: string, max = 18): string {
  const t = label.trim();
  const iata = /\(([A-Z]{3})\)\s*$/.exec(t);
  if (iata && t.length > max) return iata[1]!;
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
