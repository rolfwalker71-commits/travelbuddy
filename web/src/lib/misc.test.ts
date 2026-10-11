import { describe, expect, it } from "vitest";
import { ev } from "./fixtures.test-helpers";
import { appleDirectionsUrl, appleMapsUrl, eventMapPoints, placesOfEvent, searchTextFor } from "./maps";
import { mergeCandidates, proposalsOf, confidenceLabel } from "./review";
import { checkUploadFile, formatBytes, isAnalysisActive, percent } from "./upload";
import { majorMismatch, versionLine } from "./version";
import realManifest from "../../../shared/illustrations/manifest.json";
import realHelp from "../../../shared/illustrations/help-cards.json";
import { COVER_IDS, coverIdFor, discoverIllustrations, getHelpCard, getIllustration, getManifest, parseManifest, resolveAssetUrl } from "./illustrations";
import { isActive, navFor, tripTabFor } from "./nav";
import { moveEvent, groupEventsByDay, canSwap } from "./plan";

describe("Karten", () => {
  it("leitet Orte aus Typfeldern ab und bevorzugt places[]", () => {
    const car = ev({ type: "Mietauto", details: { pickupPlace: "MIA", returnPlace: "FLL" }, address: "2100 NW 42nd Ave" });
    expect((placesOfEvent(car)).map((p) => [p.role, p.label])).toEqual([
      ["pickup", "MIA"],
      ["return", "FLL"],
    ]);
    const withPlaces = ev({ type: "Flug", places: [{ role: "start", label: "ZRH", address: null, lat: 47, lon: 8 }] });
    expect(placesOfEvent(withPlaces)).toHaveLength(1);
  });
  it("Punkte in Reihenfolge, Suchtext statt fehlender Koordinaten, Vorschläge ausgeblendet", () => {
    const a = ev({ id: 1, type: "Hotel", startDate: "2026-10-23", location: "Barcelona", address: "Carrer 1, Barcelona" });
    const b = ev({ id: 2, type: "Flug", startDate: "2026-10-22", status: "proposed", places: [{ role: "start", label: "ZRH", address: null, lat: 1, lon: 1 }] });
    const c = ev({ id: 3, type: "Ausflug", startDate: "2026-10-24", lat: 41.4, lon: 2.1, location: "Park" });
    const pts = eventMapPoints([c, b, a]);
    expect(pts.map((p) => [p.eventId, p.order])).toEqual([
      [1, 1],
      [3, 2],
    ]);
    expect(pts[0]!.lat).toBeNull();
    expect(pts[0]!.query).toBe("Carrer 1, Barcelona");
    expect(searchTextFor("BCN", null)).toBe("BCN Airport");
  });
  it("Links zu Apple Karten und Route", () => {
    const p = { title: "Hotel", lat: 41.4, lon: 2.2, query: null, address: "Carrer 1" };
    expect(appleMapsUrl(p)).toBe("https://maps.apple.com/?ll=41.4%2C2.2&q=Hotel");
    expect(appleMapsUrl({ title: "H", lat: null, lon: null, query: "Carrer 1", address: null })).toBe("https://maps.apple.com/?q=Carrer+1");
    expect(appleDirectionsUrl(p)).toContain("daddr=41.4%2C2.2");
    expect(appleDirectionsUrl({ lat: null, lon: null, query: null, address: null })).toBeNull();
  });
});

describe("Vorschläge prüfen", () => {
  const confirmed = ev({ id: 1, type: "Flug", bookingReference: "ab 12", startDate: "2026-10-23", details: { flightNumber: "LX 1952" } });
  it("findet Kandidaten nach Referenz, Nummer und Tag", () => {
    const p1 = ev({ id: 9, type: "Hotel", bookingReference: "AB12", status: "needs_review" });
    expect(mergeCandidates(p1, [confirmed, p1])[0]).toMatchObject({ score: 3, reason: "gleiche Buchungsreferenz" });
    const p2 = ev({ id: 10, type: "Flug", startDate: "2026-10-23", details: { flightNumber: "LX1952" }, status: "proposed" });
    expect(mergeCandidates(p2, [confirmed])[0]!.score).toBe(2);
    const p3 = ev({ id: 11, type: "Flug", startDate: "2026-10-23", status: "proposed" });
    expect(mergeCandidates(p3, [confirmed])[0]!.score).toBe(1);
  });
  it("sortiert «Zu prüfen» vor «Vorschlag» und rechnet die Sicherheit", () => {
    const l = proposalsOf([ev({ id: 1, type: "Flug", status: "proposed" }), ev({ id: 2, type: "Flug", status: "needs_review" }), ev({ id: 3, type: "Flug" })]);
    expect(l.map((e) => e.id)).toEqual([2, 1]);
    expect(confidenceLabel(0.98)).toEqual({ text: "98 %", tone: "pos" });
    expect(confidenceLabel(0.71).tone).toBe("warn");
    expect(confidenceLabel(null).text).toBe("unbekannt");
  });
});

describe("Upload", () => {
  it("prüft Typ und Grösse", () => {
    expect(checkUploadFile({ name: "Buchung.PDF", size: 1000 }).ok).toBe(true);
    expect(checkUploadFile({ name: "x.docx", size: 1000 }).ok).toBe(false);
    expect(checkUploadFile({ name: "x.pdf", size: 26 * 1024 * 1024 }).ok).toBe(false);
    expect(checkUploadFile({ name: "x.pdf", size: 0 }).ok).toBe(false);
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(percent(50, 200)).toBe(25);
    expect(isAnalysisActive("processing")).toBe(true);
    expect(isAnalysisActive("done")).toBe(false);
  });
});

describe("Version", () => {
  it("Versionszeile wie im Vertrag", () => {
    const line = versionLine(
      { name: "TravelBuddy", version: "0.1.0", build: "abc", builtAt: "2026-10-11T12:30:00.000Z", api: 1 },
      { version: "0.1.0", build: "12" }
    );
    expect(line).toMatch(/^TravelBuddy 0\.1\.0 \(Build 12\) · Server 0\.1\.0 · Stand 11\.10\.2026 \d{2}:\d{2}$/);
    expect(versionLine(null, { version: "0.1.0", build: "dev" })).toBe("TravelBuddy 0.1.0 (Build dev) · Server nicht erreichbar");
    expect(majorMismatch("0.1.0", "1.0.0")).toBe(true);
    expect(majorMismatch("0.1.0", "0.9.9")).toBe(false);
  });
});

describe("Illustrationen und Hilfekarten", () => {
  const assets = {
    "/x/shared/illustrations/light/type-Flug.svg": "/a/flug-light.svg",
    "/x/shared/illustrations/dark/type-Flug.svg": "/a/flug-dark.svg",
    "/x/shared/illustrations/png/light/type-Flug.png": "/a/flug.png",
  };
  it("findet Dateien theme-gerecht und ignoriert PNG", () => {
    expect(resolveAssetUrl("type-Flug.svg", assets)).toBe("/a/flug-light.svg");
    expect(resolveAssetUrl("type-Flug.svg", assets, "dark")).toBe("/a/flug-dark.svg");
    expect(resolveAssetUrl("light/type-Flug.svg", assets)).toBe("/a/flug-light.svg");
    expect(resolveAssetUrl("fehlt.svg", assets)).toBeNull();
  });
  it("entdeckt Illustrationen aus der Ordnerstruktur", () => {
    const m = discoverIllustrations(assets);
    expect(m.get("type-Flug")).toMatchObject({ light: "/a/flug-light.svg", dark: "/a/flug-dark.svg" });
  });
  it("liest verschiedene Manifest-Formen defensiv", () => {
    const a = parseManifest({ illustrations: [{ id: "type-Flug", title: "Flug", alt: "Flugzeug", file: "light/type-Flug.svg" }] }, assets);
    expect(a.get("type-Flug")).toMatchObject({ title: "Flug", alt: "Flugzeug", light: "/a/flug-light.svg", dark: "/a/flug-dark.svg" });
    const b = parseManifest({ "type-Flug": { files: { light: "light/type-Flug.svg", dark: "dark/type-Flug.svg" } } }, assets);
    expect(b.get("type-Flug")!.dark).toBe("/a/flug-dark.svg");
    expect(parseManifest(null, assets).size).toBe(0);
    expect(parseManifest("kaputt", assets).size).toBe(0);
  });
  it("liest das echte Manifest (items[], files.lightSvg/darkSvg) mit allen Illustrationen", () => {
    const items = (realManifest as { items: { id: string }[] }).items;
    expect(items.length).toBe(35);
    const m = getManifest();
    for (const it of items) {
      const e = m.get(it.id);
      expect(e, it.id).toBeDefined();
      if (!it.id.startsWith("notif-")) {
        expect(e!.light, `${it.id} hell`).toBeTruthy();
        expect(e!.dark, `${it.id} dunkel`).toBeTruthy();
      }
    }
    expect(getIllustration("type-Flug")?.title).toBe("Flug");
    expect(getIllustration("type-Flug")?.alt).toMatch(/flugzeug/i);
    for (const id of ["empty-trips", "empty-day", "empty-documents", "empty-ledger", "offline", "error", "cover-sea", "cover-city", "cover-mountain", "cover-island"]) {
      expect(getIllustration(id), id).not.toBeNull();
    }
  });
  it("Hilfekarten: Texte aus help-cards.json, Schritte mit Label und Text", () => {
    const cards = (realHelp as { cards: { id: string; title: string; illustration: string }[] }).cards;
    expect(cards.length).toBe(6);
    for (const c of cards) {
      const h = getHelpCard(c.id)!;
      expect(h.title).toBe(c.title);
      expect(h.illustration).toBe(c.illustration);
      expect(h.steps.length).toBe(4);
      expect(h.steps[0]!.label).toBeTruthy();
      expect(h.steps[0]!.text.length).toBeGreaterThan(10);
      expect(getIllustration(h.illustration!), c.id).not.toBeNull();
    }
    // frühere Kurznamen bleiben auffindbar
    expect(getHelpCard("share-upload")?.id).toBe("help-share");
    expect(getHelpCard("gibt-es-nicht")).toBeNull();
  });
  it("Cover-Fallback: See bei Kreuzfahrt, sonst Zielart, sonst stabil nach Reise-ID", () => {
    expect(coverIdFor({ id: 1, title: "Ferien", destination: "Florida" }, [{ type: "Kreuzfahrt" }])).toBe("cover-sea");
    expect(coverIdFor({ id: 2, title: "Skiwoche Zermatt", destination: null })).toBe("cover-mountain");
    expect(coverIdFor({ id: 3, title: "Auszeit", destination: "Mallorca" })).toBe("cover-island");
    expect(coverIdFor({ id: 4, title: "Städtetrip Lissabon", destination: "Lissabon" })).toBe("cover-city");
    // Teilwörter lösen nichts aus («Romantik» ist nicht «Rom»)
    const a = coverIdFor({ id: 6, title: "Romantik", destination: "irgendwo" });
    expect(a).toBe(COVER_IDS[6 % 4]);
    expect(coverIdFor({ id: 6, title: "Romantik", destination: "irgendwo" })).toBe(a);
    expect(new Set([0, 1, 2, 3].map((i) => coverIdFor({ id: i, title: "x", destination: null }))).size).toBe(4);
  });
});

describe("Navigation und Plan", () => {
  it("Heute nur bei aktiver Reise", () => {
    expect(navFor({ hasActiveTrip: false }).map((e) => e.label)).toEqual(["Reisen", "Konto"]);
    expect(navFor({ hasActiveTrip: true, reviewCount: 3 }).map((e) => e.label)).toEqual(["Heute", "Reisen", "Konto"]);
    expect(isActive({ to: "/" }, "/trips")).toBe(false);
    expect(isActive({ to: "/trips" }, "/trips/4/ledger")).toBe(true);
  });
  it("Reise-Tab aus dem Pfad", () => {
    expect(tripTabFor("/trips/4", 4)).toBe("plan");
    expect(tripTabFor("/trips/4/ledger", 4)).toBe("ledger");
    expect(tripTabFor("/trips/4/events/9", 4)).toBe("plan");
  });
  it("Sortieren nur bei gleicher Zeit", () => {
    const a = ev({ id: 1, type: "Ausflug", startDate: "2026-10-23", startTime: "10:00", sortKey: 1 });
    const b = ev({ id: 2, type: "Ausflug", startDate: "2026-10-23", startTime: "10:00", sortKey: 2 });
    const c = ev({ id: 3, type: "Ausflug", startDate: "2026-10-23", startTime: "12:00", sortKey: 3 });
    expect(canSwap(a, b)).toBe(true);
    expect(canSwap(b, c)).toBe(false);
    expect(moveEvent([a, b, c], 1, 1)).toEqual([2, 1, 3]);
    expect(moveEvent([a, b, c], 2, 1)).toBeNull();
    expect(groupEventsByDay([c, a, b]).map((g) => g.events.map((e) => e.id))).toEqual([[1, 2, 3]]);
  });
});

describe("Adressfelder je Ort (Katalog 2)", () => {
  it("Mietauto: Abholung und Rückgabe mit eigener Adresse als zwei Orte", () => {
    const car = ev({
      type: "Mietauto",
      title: "Mietwagen",
      details: { pickupPlace: "Hertz MIA", pickupAddress: "2100 NW 42nd Ave, Miami", returnPlace: "Hertz FLL", returnAddress: "100 Terminal Dr, Fort Lauderdale" },
    });
    const pts = eventMapPoints([car]);
    expect(pts.map((p) => [p.role, p.address])).toEqual([
      ["pickup", "2100 NW 42nd Ave, Miami"],
      ["return", "100 Terminal Dr, Fort Lauderdale"],
    ]);
    expect(pts[0]!.query).toBe("2100 NW 42nd Ave, Miami");
  });
  it("Veranstaltung, Kreuzfahrt, Zug: Adresse aus dem Ortsfeld", () => {
    expect(placesOfEvent(ev({ type: "Veranstaltung", details: { venue: "Opernhaus", venueAddress: "Falkenstrasse 1" } }))[0]).toMatchObject({ role: "venue", address: "Falkenstrasse 1" });
    expect(placesOfEvent(ev({ type: "Kreuzfahrt", details: { terminal: "Port Nou", terminalAddress: "Moll Adossat" } }))[0]).toMatchObject({ address: "Moll Adossat" });
    expect(placesOfEvent(ev({ type: "Zugreisen", details: { originPlace: "Zürich HB", originAddress: "Bahnhofplatz", destinationPlace: "Bern" } })).map((p) => p.role)).toEqual(["start", "end"]);
  });
});
