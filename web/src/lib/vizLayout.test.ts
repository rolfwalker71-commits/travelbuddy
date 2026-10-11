import { describe, expect, it } from "vitest";
import { niceStep, placeLabels, shortStopLabel, textWidth } from "./vizLayout";

describe("Layout der Infografiken", () => {
  it("wählt Achsenschritte, bei denen sich Beschriftungen nicht berühren", () => {
    // 29 Tage auf 300 px: 10 px je Tag, Beschriftung braucht 54 px → alle 7 Tage
    expect(niceStep(10, 54)).toBe(7);
    // 7 Tage auf 600 px: 85 px je Tag → täglich
    expect(niceStep(85, 54)).toBe(1);
    expect(niceStep(0.5, 54, [1, 7, 28])).toBe(28);
  });

  it("verteilt Beschriftungen ohne Überdeckung auf Reihen", () => {
    const items = [
      { x: 10, w: 80 },
      { x: 40, w: 80 }, // überdeckt die erste → zweite Reihe
      { x: 200, w: 80 },
    ];
    const p = placeLabels(items, 400, 2);
    expect(p[0]).toMatchObject({ row: 0, anchor: "start" });
    expect(p[1]).toMatchObject({ row: 1, anchor: "start" });
    expect(p[2]).toMatchObject({ row: 0 });
  });

  it("verankert am rechten Rand nach links und lässt Unpassendes weg", () => {
    const p = placeLabels([{ x: 370, w: 80 }, { x: 372, w: 80 }], 400, 1);
    expect(p[0]).toMatchObject({ anchor: "end", x1: 370 });
    expect(p[1]).toBeNull(); // keine Reihe mehr frei
    // breiter als die Fläche: nie ausserhalb zeichnen
    expect(placeLabels([{ x: 5, w: 500 }], 400, 3)[0]).toBeNull();
  });

  it("kürzt Stationsnamen, ohne Wörter hart abzuschneiden", () => {
    expect(shortStopLabel("Josep Tarradellas Barcelona-El Prat Airport (BCN)")).toBe("BCN");
    expect(shortStopLabel("Zürich Airport (ZRH)", 30)).toBe("Zürich Airport (ZRH)");
    expect(shortStopLabel("Hotel Negresco Princess 4* Superior", 18)).toBe("Hotel Negresco Pr…");
    expect(shortStopLabel("Palma", 18)).toBe("Palma");
    expect(textWidth("ZRH", 6, 0)).toBe(18);
  });
});
