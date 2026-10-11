import { useEffect, useRef, useState } from "react";
import { loadMapkit, lookupPlace, type Mapkit, type MkAnnotation, type MkCoordinate } from "../lib/mapkit";
import type { MapPoint } from "../lib/maps";

type Status = "loading" | "ready" | "off" | "error";

export type ResolvedPlace = { point: MapPoint; lat: number; lon: number; label: string | null };

/** Ergebnisse der Adresssuche bleiben für die Sitzung im Speicher (`null` = nicht gefunden). */
const geocoded = new Map<string, { lat: number; lon: number; label: string | null } | null>();
const MAX_LOOKUPS = 25;

/** `var(--k-air)` → aktueller Farbwert des Tokens (MapKit kennt keine CSS-Variablen). */
export function cssColor(value: string, fallback = "#d8452b"): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!m) return value || fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export type MapViewProps = {
  points: MapPoint[];
  label: string;
  height?: number;
  /** Strecke zwischen den Punkten in Reihenfolge zeichnen. */
  route?: boolean;
  /** Kleine, nicht bedienbare Karte. */
  compact?: boolean;
  /** Marker mit Ordnungsnummer beschriften (Reise-Karte) statt ohne. */
  numbered?: boolean;
  /** Fehlende Koordinaten wurden per Suche aufgelöst (zum Speichern). */
  onResolve?: (r: ResolvedPlace) => void;
  /** Suche läuft / Orte, die nicht gefunden wurden. */
  onSearch?: (s: { resolving: boolean; notFound: MapPoint[] }) => void;
  /** Wird aufgerufen, wenn Apple Karten nicht eingerichtet ist. */
  onUnavailable?: () => void;
  /** Wird aufgerufen, wenn die Karte bereit ist oder fehlschlägt. */
  onStatus?: (s: Status) => void;
};

/**
 * Apple Karten (MapKit JS): Marker in Typfarbe, Route in Reihenfolge. Koordinaten am Ort haben Vorrang;
 * fehlende werden per Suche im Browser aufgelöst und über `onResolve` gemeldet (der Aufrufer speichert sie).
 */
export function MapView({ points, label, height = 360, route = false, compact = false, numbered = false, onResolve, onSearch, onUnavailable, onStatus }: MapViewProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const cb = useRef({ onResolve, onSearch, onUnavailable, onStatus });
  cb.current = { onResolve, onSearch, onUnavailable, onStatus };
  const theme = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  const key = JSON.stringify([points.map((p) => [p.id, p.title, p.lat, p.lon, p.query, p.color, p.order]), route, numbered, compact, theme]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    setStatus("loading");
    (async () => {
      const mapkit = await loadMapkit();
      if (cancelled) return;
      if (!mapkit) {
        setStatus("off");
        cb.current.onStatus?.("off");
        cb.current.onUnavailable?.();
        return;
      }
      if (!el.current) return;
      const schemes = (mapkit.Map as unknown as { ColorSchemes?: { Light?: string; Dark?: string } }).ColorSchemes;
      const colorScheme = document.documentElement.dataset.theme === "dark" ? schemes?.Dark : schemes?.Light;
      const map = new mapkit.Map(el.current, {
        ...(colorScheme ? { colorScheme } : {}),
        showsMapTypeControl: false,
        ...(compact ? { showsZoomControl: false, isScrollEnabled: false, isZoomEnabled: false, isRotationEnabled: false } : { showsZoomControl: true }),
      });
      destroy = () => map.destroy();

      cb.current.onSearch?.({ resolving: points.some((p) => p.lat == null && p.query), notFound: [] });
      const notFound: MapPoint[] = [];
      const placed: { p: MapPoint; c: MkCoordinate }[] = [];
      let lookups = 0;
      for (const p of points) {
        let c: MkCoordinate | null = null;
        if (p.lat != null && p.lon != null) {
          c = new mapkit.Coordinate(p.lat, p.lon);
        } else if (p.query && lookups < MAX_LOOKUPS) {
          let hit = geocoded.get(p.query);
          if (hit === undefined) {
            lookups += 1;
            hit = await lookupPlace(mapkit, p.query);
            geocoded.set(p.query, hit);
            if (cancelled) return;
            if (hit) cb.current.onResolve?.({ point: p, lat: hit.lat, lon: hit.lon, label: hit.label });
          }
          if (hit) c = new mapkit.Coordinate(hit.lat, hit.lon);
        }
        if (!c) {
          notFound.push(p);
          continue;
        }
        placed.push({ p, c });
      }
      addItems(mapkit, map, placed, { route, numbered, compact });
      setStatus("ready");
      cb.current.onStatus?.("ready");
      cb.current.onSearch?.({ resolving: false, notFound });
    })().catch(() => {
      if (!cancelled) {
        setStatus("error");
        cb.current.onStatus?.("error");
      }
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (status === "off") return null;
  return (
    <div className={`map-card${compact ? " map-card--compact" : ""}`} style={{ height }}>
      <div ref={el} className="map-card__map" style={{ height }} role="img" aria-label={label}>
        {status === "loading" ? <p className="map-card__status muted small">Karte wird geladen …</p> : null}
        {status === "error" ? <p className="map-card__status muted small">Karte nicht verfügbar. Die Links unter der Karte funktionieren weiterhin.</p> : null}
      </div>
    </div>
  );
}

function addItems(
  mapkit: Mapkit,
  map: InstanceType<Mapkit["Map"]>,
  placed: { p: MapPoint; c: MkCoordinate }[],
  opts: { route: boolean; numbered: boolean; compact: boolean }
): void {
  if (placed.length === 0) return;
  const annotations: MkAnnotation[] = placed.map(({ p, c }) =>
    new mapkit.MarkerAnnotation(c, {
      title: p.title,
      subtitle: [p.roleLabel, p.address].filter(Boolean).join(" · ") || undefined,
      color: cssColor(p.color),
      ...(opts.numbered ? { glyphText: String(p.order) } : {}),
    })
  );
  map.addAnnotations(annotations);
  const overlays: unknown[] = [];
  if (opts.route && placed.length > 1) {
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1]!;
      const b = placed[i]!;
      const air = b.p.color.includes("--k-air");
      overlays.push(
        new mapkit.PolylineOverlay([a.c, b.c], {
          style: new mapkit.Style({ lineWidth: 3, strokeColor: cssColor(b.p.color), lineDash: air ? [8, 7] : [] }),
        })
      );
    }
    for (const o of overlays) map.addOverlay(o);
  }
  if (annotations.length === 1) {
    map.region = new mapkit.CoordinateRegion(annotations[0]!.coordinate, new mapkit.CoordinateSpan(opts.compact ? 0.012 : 0.05, opts.compact ? 0.012 : 0.05));
  } else {
    map.showItems([...annotations, ...overlays], { animate: false, padding: new mapkit.Padding(56, 40, 40, 40) });
  }
}
