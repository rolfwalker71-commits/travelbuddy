import { useEffect, useMemo, useRef, useState } from "react";
import type { TripEvent } from "../api/types";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import { addressText, appleDirectionsUrl, appleMapsUrl, eventMapPoints, type MapPoint } from "../lib/maps";
import { Banner } from "../ui/Feedback";
import { Icon } from "../ui/Icon";
import { copyToClipboard } from "../ui/bits";
import { useToast } from "../ui/Toast";
import { RouteArc } from "../viz/RouteArc";
import { MapView, type ResolvedPlace } from "./MapView";

/**
 * Karte im Ereignis-Detail, oberhalb der Buchungsdaten: Marker in Typfarbe (zwei Orte als Linie), Adressen als
 * Text, «In Karten öffnen», «Route» und «Adresse kopieren». Fehlende Koordinaten werden per MapKit-Suche
 * aufgelöst und über `onSaveCoords` gespeichert.
 */
export function EventMapCard({
  event,
  color,
  onSaveCoords,
  onServerGeocode,
}: {
  event: TripEvent;
  color: string;
  /**
   * Speichert gefundene Koordinaten: der erste Ort als `lat`/`lon`, weitere Orte als `placeCoords[<rolle>]` (PATCH).
   * Fehlt die Funktion (keine Berechtigung), wird nichts gespeichert.
   */
  onSaveCoords?: (role: string, index: number, lat: number, lon: number) => Promise<void>;
  /** Server-Geokodierung (`POST …/geocode`); sie läuft, wenn Apple Karten im Browser nicht zur Verfügung steht. */
  onServerGeocode?: () => Promise<void>;
}) {
  const toast = useToast();
  const maps = useMapsEnabled();
  const points = useMemo(() => eventMapPoints([{ ...event, status: undefined }], () => color), [event, color]);
  const [search, setSearch] = useState<{ resolving: boolean; notFound: MapPoint[] }>({ resolving: false, notFound: [] });
  const savedRoles = useRef(new Set<string>());
  const asked = useRef(false);
  const [serverBusy, setServerBusy] = useState(false);
  const missingCoords = points.some((p) => p.lat == null);

  // Ohne Apple Karten im Browser löst der Server fehlende Koordinaten auf (409 = Dienst nicht eingerichtet).
  useEffect(() => {
    if (maps !== false || !missingCoords || asked.current || !onServerGeocode) return;
    asked.current = true;
    setServerBusy(true);
    onServerGeocode()
      .catch(() => undefined)
      .finally(() => setServerBusy(false));
  }, [maps, missingCoords, onServerGeocode]);

  if (points.length === 0) return null;

  const onResolve = (r: ResolvedPlace) => {
    const index = points.findIndex((p) => p.id === r.point.id);
    if (index < 0 || !onSaveCoords || savedRoles.current.has(r.point.id)) return;
    savedRoles.current.add(r.point.id);
    onSaveCoords(r.point.role, index, r.lat, r.lon).catch(() => {
      savedRoles.current.delete(r.point.id);
      toast("Koordinaten konnten nicht gespeichert werden", "error");
    });
  };

  const copy = (p: MapPoint) => {
    void copyToClipboard(addressText(p)).then(() => toast("Adresse kopiert"));
  };

  return (
    <section className="eventmap card" aria-label={`Karte: ${event.title}`}>
      {maps === true ? (
        <MapView points={points} label={`Karte zu ${event.title}`} height={260} route={points.length > 1} onResolve={onResolve} onSearch={setSearch} />
      ) : maps === false ? (
        points.length > 1 ? <RouteArc events={[event]} title={`Strecke: ${event.title}`} height={180} /> : null
      ) : (
        <div className="map-card map-card--compact" style={{ height: 120 }}>
          <p className="map-card__status muted small">Karte wird geladen …</p>
        </div>
      )}
      {(maps === true && search.resolving) || serverBusy ? (
        <p className="muted small eventmap__note" role="status">
          <span className="spinner" aria-hidden="true" /> Adresse wird gesucht …
        </p>
      ) : null}
      {search.notFound.length > 0 ? (
        <Banner tone="warn">
          Die Adresse «{search.notFound.map((p) => p.address || p.query).join("», «")}» wurde in Apple Karten nicht gefunden. Bitte die
          Adresse im Ereignis prüfen oder die Koordinaten ergänzen.
        </Banner>
      ) : null}
      <ul className="eventmap__places">
        {points.map((p) => {
          const open = appleMapsUrl(p);
          const dir = appleDirectionsUrl(p);
          return (
            <li key={p.id} className="eventmap__place">
              <span className="eventmap__ic" style={{ background: p.color }} aria-hidden="true">
                <Icon name="pin" size={14} />
              </span>
              <span className="eventmap__text">
                <span className="label">{p.roleLabel}</span>
                <span className="eventmap__addr">{addressText(p)}</span>
              </span>
              <span className="eventmap__actions">
                {open ? (
                  <a className="btn btn--secondary btn--s" href={open} target="_blank" rel="noreferrer noopener">
                    <Icon name="map" size={16} />
                    <span>In Karten öffnen</span>
                  </a>
                ) : null}
                {dir ? (
                  <a className="btn btn--secondary btn--s" href={dir} target="_blank" rel="noreferrer noopener">
                    <Icon name="route" size={16} />
                    <span>Route</span>
                  </a>
                ) : null}
                <button type="button" className="btn btn--ghost btn--s" onClick={() => copy(p)}>
                  <Icon name="copy" size={16} />
                  <span>Adresse kopieren</span>
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
