/**
 * Illustrationen und Hilfekarten aus `shared/illustrations/` (`manifest.json`, `help-cards.json`).
 * Ein anderes Paket erzeugt die Dateien; bis sie da sind (oder wenn eine ID fehlt) gelten Platzhalter.
 * Alles hier ist defensiv: unbekannte Formen werden ignoriert, nie geworfen.
 */

const manifestModules = import.meta.glob("../../../shared/illustrations/manifest.json", { eager: true, import: "default" }) as Record<string, unknown>;
const helpModules = import.meta.glob("../../../shared/illustrations/help-cards.json", { eager: true, import: "default" }) as Record<string, unknown>;
// Nur die SVG-Fassungen (light/ und dark/); die PNG-Kopien unter png/ sind für die Apple-Apps und zu gross fürs Web.
const assetModules = import.meta.glob(["../../../shared/illustrations/**/*.{svg,webp}", "!../../../shared/illustrations/png/**"], {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export type IllustrationEntry = {
  id: string;
  title: string;
  alt: string;
  light: string | null;
  dark: string | null;
};

export type HelpStep = { marker: number; label: string; title: string; text: string };

export type HelpCardData = {
  id: string;
  title: string;
  /** Kurzer Einleitungssatz (`summary` in help-cards.json). */
  text: string;
  steps: HelpStep[];
  illustration: string | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (...v: unknown[]): string => v.map(str).find((x) => x) ?? "";

/**
 * Datei im Illustrationsordner per relativem Pfad oder Dateinamen. Gibt es denselben Namen in `light/` und `dark/`,
 * gilt bei blossem Dateinamen die helle Fassung (`prefer`). Die PNG-Kopien unter `png/` werden nur genommen,
 * wenn es keine SVG gibt.
 */
export function resolveAssetUrl(file: string, assets: Record<string, string> = assetModules, prefer: "light" | "dark" = "light"): string | null {
  if (!file) return null;
  const clean = file.replace(/^\.?\/*/, "");
  const keys = Object.keys(assets);
  const exact = keys.find((k) => k.endsWith(`/illustrations/${clean}`));
  if (exact) return assets[exact] ?? null;
  const base = clean.split("/").pop()!;
  const named = keys.filter((k) => k.endsWith(`/${base}`));
  const pick =
    named.find((k) => k.includes(`/${prefer}/`) && !k.includes("/png/")) ??
    named.find((k) => !k.includes("/png/")) ??
    named[0];
  return pick ? assets[pick] ?? null : null;
}

/** Illustrationen aus der Ordnerstruktur `light/<id>.svg` und `dark/<id>.svg` (ohne Manifest). */
export function discoverIllustrations(assets: Record<string, string> = assetModules): Map<string, IllustrationEntry> {
  const out = new Map<string, IllustrationEntry>();
  for (const [path, url] of Object.entries(assets)) {
    const m = /\/illustrations\/(light|dark)\/([^/]+)\.(svg|webp|png|jpe?g)$/i.exec(path);
    if (!m) continue;
    const theme = m[1]!.toLowerCase() as "light" | "dark";
    const id = m[2]!;
    const cur = out.get(id) ?? { id, title: id, alt: id, light: null, dark: null };
    cur[theme] = url;
    out.set(id, cur);
  }
  return out;
}

function asList(raw: unknown, listKeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of listKeys) {
      const v = o[k];
      if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
      if (v && typeof v === "object") {
        return Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x && typeof x === "object")
          .map(([id, x]) => ({ id, ...(x as Record<string, unknown>) }));
      }
    }
  }
  return [];
}

/** Manifest → Einträge nach ID. Akzeptiert Liste oder Objekt unter `illustrations`/`items`/`images`/Wurzel. */
export function parseManifest(raw: unknown, assets: Record<string, string> = assetModules): Map<string, IllustrationEntry> {
  const out = new Map<string, IllustrationEntry>();
  let list = asList(raw, ["illustrations", "items", "images", "entries"]);
  if (list.length === 0 && raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Wurzel als Objekt: id → Eintrag (Zeichenkette = Datei)
    list = Object.entries(raw as Record<string, unknown>)
      .filter(([k]) => !["version", "doc", "description", "generatedAt"].includes(k))
      .map(([id, v]): Record<string, unknown> | null =>
        typeof v === "string" ? { id, file: v } : v && typeof v === "object" ? { id, ...(v as Record<string, unknown>) } : null
      )
      .filter((x): x is Record<string, unknown> => x !== null);
  }
  for (const e of list) {
    const id = first(e.id, e.key, e.name);
    if (!id) continue;
    const files = (e.files && typeof e.files === "object" ? e.files : {}) as Record<string, unknown>;
    // Echtes Manifest: files.lightSvg / files.darkSvg (Pfade relativ zu shared/illustrations/); ältere Formen bleiben lesbar.
    const lightFile = first(files.lightSvg, files.light, e.light, e.fileLight, e.file, e.path, e.src, e.url, e.svg);
    const darkFile = first(files.darkSvg, files.dark, e.dark, e.fileDark, e.srcDark);
    let light = resolveAssetUrl(lightFile, assets);
    let dark = darkFile ? resolveAssetUrl(darkFile, assets, "dark") : null;
    if (!dark && /(^|\/)light\//.test(lightFile)) dark = resolveAssetUrl(lightFile.replace(/(^|\/)light\//, "$1dark/"), assets, "dark");
    if (!dark && lightFile) {
      // Konvention «name.svg» + «name-dark.svg»
      const m = /^(.*)\.(svg|png|webp|jpe?g)$/i.exec(lightFile);
      if (m) dark = resolveAssetUrl(`${m[1]}-dark.${m[2]}`, assets, "dark");
    }
    if (!light && dark) light = dark;
    out.set(id, {
      id,
      title: first(e.title, e.label, e.name, id),
      alt: first(e.alt, e.description, e.caption, e.title, e.label, id),
      light,
      dark,
    });
  }
  return out;
}

let manifestCache: Map<string, IllustrationEntry> | null = null;
export function getManifest(): Map<string, IllustrationEntry> {
  if (!manifestCache) {
    // Ordnerstruktur als Grundlage, das Manifest ergänzt und überschreibt (Titel, Alternativtext, Dateien).
    const merged = discoverIllustrations();
    for (const [id, e] of parseManifest(Object.values(manifestModules)[0])) {
      const base = merged.get(id);
      merged.set(id, { ...e, light: e.light ?? base?.light ?? null, dark: e.dark ?? base?.dark ?? null });
    }
    manifestCache = merged;
  }
  return manifestCache;
}

/** Illustration zu einer ID oder `null` (dann Platzhalter). */
export function getIllustration(id: string): IllustrationEntry | null {
  return getManifest().get(id) ?? null;
}

/* ─ Hilfekarten ─ */

/** Eingebaute Kurzfassung, falls `help-cards.json` fehlt (die echte Datei hat Vorrang). */
const step = (marker: number, label: string, title: string, text: string): HelpStep => ({ marker, label, title, text });
export const DEFAULT_HELP: Record<string, HelpCardData> = {
  "help-share": {
    id: "help-share",
    title: "So kommt ein PDF in die Reise",
    text: "Buchungsbestätigungen als PDF teilen oder hochladen. Der Server liest sie aus und schlägt Ereignisse vor, die du bestätigst.",
    steps: [
      step(1, "TEILEN", "Teilen", "Teile das PDF aus Mail oder Dateien mit TravelBuddy, oder ziehe es im Web in die Reise."),
      step(2, "AUSWERTEN", "Auswerten", "Der Server liest Text und Daten aus dem Dokument."),
      step(3, "PRÜFEN", "Prüfen", "Erkannte Buchungen erscheinen als gestrichelte Vorschläge. Prüfe die Felder."),
      step(4, "ÜBERNOMMEN", "Übernommen", "Nach dem Bestätigen gilt das Ereignis in Plan und Heute."),
    ],
    illustration: "help-share",
  },
  "help-settle": {
    id: "help-settle",
    title: "So wird in der Reisekasse ausgeglichen",
    text: "Ausgaben erfassen, Salden ansehen, Zahlungen vorschlagen lassen und als beglichen markieren.",
    steps: [
      step(1, "ERFASSEN", "Erfassen", "Trage Betrag, Währung und Bezahlende ein."),
      step(2, "SALDO", "Saldo", "Plus bekommt Geld, Minus schuldet Geld."),
      step(3, "AUSGLEICH", "Ausgleich", "TravelBuddy schlägt wenige direkte Zahlungen vor."),
      step(4, "BEGLICHEN", "Beglichen", "Markiere eine Zahlung als erledigt, sobald sie überwiesen ist."),
    ],
    illustration: "help-settle",
  },
  "help-today": {
    id: "help-today",
    title: "So funktioniert Heute",
    text: "Heute zeigt, was als Nächstes ansteht, den Tagesverlauf, offene Aufgaben und neue Vorschläge.",
    steps: [
      step(1, "NÄCHSTES", "Nächstes", "Die dunkle Karte zeigt das nächste Ereignis mit Countdown."),
      step(2, "TAGESBAND", "Tagesband", "Das Band zeigt Check-in, Boarding und Pufferzeiten."),
      step(3, "TICKETS", "Tickets", "Terminal, Gate, Sitz oder Türcode stehen gross auf der Karte."),
      step(4, "OFFEN", "Offen", "Aufgaben, Fristen und die Kasse-Schnelleingabe."),
    ],
    illustration: "help-today",
  },
  "help-timezones": {
    id: "help-timezones",
    title: "So rechnet TravelBuddy mit Zeitzonen",
    text: "Jede Zeit gilt in der Ortszeit des Ereignisses.",
    steps: [
      step(1, "ORT", "Ortszeit", "Abflug und Ankunft haben je eine eigene Zone."),
      step(2, "VORBELEGT", "Vorbelegt", "Die Zone kommt aus dem Flughafen oder der Reise."),
      step(3, "ABWEICHUNG", "Abweichung", "Weicht eine Zone ab, steht sie bei der Zeit («Ortszeit Miami»)."),
      step(4, "COUNTDOWN", "Countdown", "Countdown und Heute rechnen mit der richtigen Zone."),
    ],
    illustration: "help-timezones",
  },
  "help-invite": {
    id: "help-invite",
    title: "So lädst du Mitreisende ein",
    text: "Jede Person bekommt einen eigenen Link für Reise und Reisekasse, ohne Konto.",
    steps: [
      step(1, "HINZUFÜGEN", "Hinzufügen", "Teilnehmer in der Reise hinzufügen."),
      step(2, "LINK", "Link", "Persönlichen Link kopieren und senden."),
      step(3, "ANSEHEN", "Ansehen", "Die Person sieht Plan und Kasse und kann kommentieren."),
      step(4, "WIDERRUFEN", "Widerrufen", "Der Link lässt sich erneuern oder widerrufen."),
    ],
    illustration: "help-invite",
  },
  "help-review": {
    id: "help-review",
    title: "So prüfst du Vorschläge",
    text: "Erkannte Buchungen erscheinen zuerst als Vorschlag mit dem Ausschnitt aus dem Dokument.",
    steps: [
      step(1, "QUELLE", "Quelle", "Ausschnitt und Sicherheit ansehen."),
      step(2, "ÜBERNEHMEN", "Übernehmen", "Übernehmen, bearbeiten, zusammenführen oder verwerfen."),
      step(3, "ERGÄNZEN", "Ergänzen", "Neue Dokumente zur Buchung ergänzen nur leere Felder."),
      step(4, "GESPERRT", "Gesperrt", "Von Hand gesetzte Felder bleiben geschützt."),
    ],
    illustration: "help-review",
  },
};

/** Kurznamen aus früheren Fassungen → ID der Hilfekarte. */
const HELP_ALIAS: Record<string, string> = {
  "share-upload": "help-share",
  share: "help-share",
  settle: "help-settle",
  today: "help-today",
  timezones: "help-timezones",
  invite: "help-invite",
  review: "help-review",
};

function normalizeSteps(raw: unknown): HelpStep[] {
  if (!Array.isArray(raw)) return [];
  const out: HelpStep[] = [];
  raw.forEach((x, i) => {
    if (typeof x === "string") {
      if (x) out.push({ marker: i + 1, label: "", title: "", text: x });
      return;
    }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const text = first(o.text, o.body, o.description);
      const title = first(o.title);
      const label = first(o.label);
      if (!text && !title) return;
      out.push({ marker: typeof o.marker === "number" ? o.marker : i + 1, label, title, text });
    }
  });
  return out;
}

let helpCache: Map<string, HelpCardData> | null = null;
export function getHelpCards(): Map<string, HelpCardData> {
  if (helpCache) return helpCache;
  const map = new Map<string, HelpCardData>(Object.entries(DEFAULT_HELP));
  const list = asList(Object.values(helpModules)[0], ["cards", "helpCards", "items", "entries"]);
  for (const c of list) {
    const id = first(c.id, c.key, c.name);
    if (!id) continue;
    const steps = normalizeSteps(c.steps);
    const base = map.get(id);
    map.set(id, {
      id,
      title: first(c.title, c.label, base?.title, id),
      text: first(c.summary, c.text, c.body, c.description, base?.text),
      steps: steps.length > 0 ? steps : base?.steps ?? [],
      illustration: first(c.illustration, c.image, c.illustrationId, c.imageKey, base?.illustration) || null,
    });
  }
  helpCache = map;
  return map;
}

export function getHelpCard(id: string): HelpCardData | null {
  const cards = getHelpCards();
  return cards.get(id) ?? cards.get(HELP_ALIAS[id] ?? "") ?? null;
}

/* ─ Cover-Fallback ─ */

export const COVER_IDS = ["cover-sea", "cover-city", "cover-mountain", "cover-island"] as const;

/** Zielart aus Stichwörtern im Zieltext (Kleinschreibung, Teilwörter). */
const COVER_HINTS: { id: (typeof COVER_IDS)[number]; words: string[] }[] = [
  { id: "cover-mountain", words: ["berg", "alpen", "alp", "gebirge", "skigebiet", "zermatt", "dolomiten", "tirol", "matterhorn", "mountain", "ski"] },
  { id: "cover-island", words: ["insel", "island", "mallorca", "malediven", "bali", "hawaii", "kanaren", "teneriffa", "kreta", "sardinien", "sizilien", "korsika", "madeira", "azoren", "karibik", "ibiza", "malta", "zypern"] },
  { id: "cover-city", words: ["stadt", "city", "städtetrip", "lissabon", "paris", "rom", "berlin", "wien", "london", "amsterdam", "prag", "barcelona", "madrid", "new york", "tokio", "istanbul", "budapest", "kopenhagen"] },
];

/**
 * Cover-Illustration für eine Reise ohne Titelbild: `cover-sea` bei Kreuzfahrt/Schiff, sonst nach Zielart (Stichwörter
 * in Titel/Ziel), sonst stabil nach Reise-ID.
 */
export function coverIdFor(trip: { id: number; title?: string | null; destination?: string | null }, events: { type: string; details?: Record<string, unknown> }[] = []): string {
  if (events.some((e) => e.type === "Kreuzfahrt" || e.details?.ship != null)) return "cover-sea";
  const text = `${trip.title ?? ""} ${trip.destination ?? ""}`.toLowerCase();
  if (/(kreuzfahrt|schiff|cruise|meer\b|küste|strand)/.test(text)) return "cover-sea";
  const tokens = text.split(/[^a-zäöüéèàç0-9]+/).filter(Boolean);
  const hit = (w: string) => (w.includes(" ") ? text.includes(w) : tokens.some((t) => t === w || (w.length >= 5 && t.startsWith(w))));
  for (const h of COVER_HINTS) if (h.words.some(hit)) return h.id;
  return COVER_IDS[Math.abs(Math.trunc(trip.id)) % COVER_IDS.length]!;
}

/** Nur für Tests. */
export function resetIllustrationCaches(): void {
  manifestCache = null;
  helpCache = null;
}
