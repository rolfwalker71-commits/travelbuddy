import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  currentPageIndex,
  outputScale,
  pageCssWidth,
  placeholderHeight,
  stepZoom,
  zoomLabel,
} from "./pdfLayout";

describe("stepZoom", () => {
  it("geht Stufe für Stufe und bleibt an den Enden stehen", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
  it("findet auch aus Zwischenwerten die nächste Stufe", () => {
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
  });
});

describe("Seitenbreite und Platzhalter", () => {
  it("zieht den Rand ab, multipliziert mit dem Zoom und hat eine Untergrenze", () => {
    expect(pageCssWidth(824, 1)).toBe(800);
    expect(pageCssWidth(824, 1.5)).toBe(1200);
    expect(pageCssWidth(50, 0.5)).toBe(120);
  });
  it("berechnet die Höhe aus dem Seitenverhältnis", () => {
    expect(placeholderHeight(600, 842 / 595)).toBe(849);
    expect(placeholderHeight(0, 1.4)).toBe(1);
  });
});

describe("outputScale", () => {
  it("nutzt devicePixelRatio, begrenzt auf 3", () => {
    expect(outputScale(600, 800, 2)).toBe(2);
    expect(outputScale(600, 800, 1)).toBe(1);
    expect(outputScale(300, 400, 5)).toBe(3);
    expect(outputScale(300, 400, 0)).toBe(1);
    expect(outputScale(300, 400, Number.NaN)).toBe(1);
  });
  it("bleibt unter der Canvas-Grenze von Safari", () => {
    const s = outputScale(3000, 4200, 3);
    expect(3000 * 4200 * s * s).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001);
    expect(s).toBeGreaterThanOrEqual(0.5);
  });
});

describe("currentPageIndex", () => {
  const tops = [0, 900, 1800, 2700];
  const heights = [880, 880, 880, 880];
  it("wählt die Seite bei einem Drittel der Sichthöhe", () => {
    expect(currentPageIndex(tops, heights, 0, 600)).toBe(0);
    expect(currentPageIndex(tops, heights, 800, 600)).toBe(1);
    expect(currentPageIndex(tops, heights, 5000, 600)).toBe(3);
  });
  it("kommt mit leerer Liste zurecht", () => {
    expect(currentPageIndex([], [], 100, 600)).toBe(0);
  });
});

describe("zoomLabel", () => {
  it("zeigt Prozent mit Leerschritt", () => {
    expect(zoomLabel(1.25)).toBe("125 %");
  });
});
