import { api, ApiError } from "../api/client";

/**
 * Apple Karten (MapKit JS) erst bei Bedarf laden. Das Skript kommt vom Apple-CDN, das Token vom eigenen Server
 * (`GET /v1/maps/token` → `{ token, expiresAt }`). Ohne Schlüssel antwortet der Server `404 maps_not_configured`;
 * `loadMapkit()` liefert dann `null` und die Oberfläche zeigt den schematischen SVG-Routenbogen.
 */

export type MkCoordinate = { latitude: number; longitude: number };
export type MkAnnotation = { coordinate: MkCoordinate };
export type MkOverlay = unknown;
export type MkMap = {
  addAnnotations(a: MkAnnotation[]): void;
  addOverlay(o: MkOverlay): void;
  removeAnnotations(a: MkAnnotation[]): void;
  removeOverlays(o: MkOverlay[]): void;
  showItems(items: unknown[], opts?: { animate?: boolean; padding?: unknown }): void;
  region: unknown;
  destroy(): void;
};
export type MkPlaceResult = { coordinate: MkCoordinate; formattedAddress?: string; name?: string };
export type Mapkit = {
  init(opts: { authorizationCallback: (done: (token: string) => void) => void; language?: string }): void;
  Map: new (el: HTMLElement, opts?: Record<string, unknown>) => MkMap;
  Coordinate: new (lat: number, lon: number) => MkCoordinate;
  CoordinateRegion: new (center: MkCoordinate, span: unknown) => unknown;
  CoordinateSpan: new (latDelta: number, lonDelta: number) => unknown;
  Padding: new (top: number, right: number, bottom: number, left: number) => unknown;
  MarkerAnnotation: new (c: MkCoordinate, opts?: Record<string, unknown>) => MkAnnotation;
  PolylineOverlay: new (coords: MkCoordinate[], opts?: Record<string, unknown>) => MkOverlay;
  Style: new (opts?: Record<string, unknown>) => unknown;
  Search: new (opts?: Record<string, unknown>) => {
    search(q: string, cb: (err: unknown, data: { places?: MkPlaceResult[] }) => void, opts?: Record<string, unknown>): unknown;
  };
  Geocoder: new (opts?: { language?: string }) => {
    lookup(q: string, cb: (err: unknown, data: { results?: MkPlaceResult[] }) => void): unknown;
  };
};

export const MAPKIT_SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

type TokenReply = { token?: string; expiresAt?: string; enabled?: boolean };

/** `null` = nicht eingerichtet (404 `maps_not_configured`, 501 oder `enabled: false`). */
async function fetchToken(signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await api<TokenReply>("/v1/maps/token", { signal });
    if (r.enabled === false || !r.token) return null;
    return r.token;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501 || e.code === "maps_not_configured")) return null;
    throw e;
  }
}

let pending: Promise<Mapkit | null> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { mapkit?: unknown }).mapkit) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Apple Karten konnten nicht geladen werden"));
    document.head.appendChild(s);
  });
}

export function loadMapkit(): Promise<Mapkit | null> {
  if (pending) return pending;
  const p = (async () => {
    const first = await fetchToken();
    if (!first) return null;
    await injectScript(MAPKIT_SRC);
    const mapkit = (window as unknown as { mapkit?: Mapkit }).mapkit;
    if (!mapkit) throw new Error("Apple Karten sind nicht verfügbar");
    let initial: string | null = first;
    mapkit.init({
      language: "de",
      authorizationCallback: (done) => {
        if (initial) {
          const t = initial;
          initial = null;
          done(t);
          return;
        }
        void fetchToken()
          .then((t) => {
            if (t) done(t);
          })
          .catch(() => undefined);
      },
    });
    return mapkit;
  })();
  pending = p;
  // Nach einem Fehler (Netz, CDN) darf ein späterer Versuch es erneut probieren.
  p.catch(() => {
    if (pending === p) pending = null;
  });
  return p;
}

let enabledP: Promise<boolean> | null = null;

/** Ist Apple Karten auf dem Server eingerichtet? Ohne das Skript zu laden; Ergebnis bleibt für die Sitzung. */
export function mapsEnabled(): Promise<boolean> {
  if (!enabledP) {
    const p = fetchToken().then((t) => t !== null);
    enabledP = p;
    p.catch(() => {
      if (enabledP === p) enabledP = null;
    });
  }
  return enabledP;
}

/** Adresse oder Ort suchen; `null`, wenn nichts gefunden wurde. Nutzt `mapkit.Search`, sonst den Geocoder. */
export async function lookupPlace(mapkit: Mapkit, query: string): Promise<{ lat: number; lon: number; label: string | null } | null> {
  const fromResult = (r: MkPlaceResult | undefined) =>
    r ? { lat: r.coordinate.latitude, lon: r.coordinate.longitude, label: r.formattedAddress ?? r.name ?? null } : null;
  try {
    const hit = await new Promise<MkPlaceResult | undefined>((resolve) => {
      try {
        new mapkit.Search({ language: "de" }).search(query, (err, data) => resolve(err ? undefined : data.places?.[0]));
      } catch {
        resolve(undefined);
      }
    });
    if (hit) return fromResult(hit);
  } catch {
    /* weiter mit dem Geocoder */
  }
  return new Promise((resolve) => {
    try {
      new mapkit.Geocoder({ language: "de" }).lookup(query, (err, data) => resolve(err ? null : fromResult(data.results?.[0])));
    } catch {
      resolve(null);
    }
  });
}

/** Nur für Tests: Zwischenspeicher leeren. */
export function resetMapkitForTests(): void {
  pending = null;
  enabledP = null;
}
