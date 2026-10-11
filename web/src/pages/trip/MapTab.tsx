import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMapsEnabled } from "../../hooks/useMapsEnabled";
import { formatDayHeading } from "../../lib/dates";
import { eventMapPoints, type MapPoint } from "../../lib/maps";
import { MapView } from "../../map/MapView";
import { typeInfo } from "../../trip/EventTicket";
import { Banner } from "../../ui/Feedback";
import { Icon } from "../../ui/Icon";
import { SelectField } from "../../ui/Field";
import { RouteArc } from "../../viz/RouteArc";
import { useTripCtx } from "./context";

/** Reise-Karte: Apple Karten mit Markern in Typfarbe und Route in Reihenfolge, Tagesfilter; sonst Routenbogen. */
export function MapTab() {
  const { data, catalog } = useTripCtx();
  const { trip, events } = data;
  const maps = useMapsEnabled();
  const [day, setDay] = useState("");
  const [search, setSearch] = useState<{ resolving: boolean; notFound: MapPoint[] }>({ resolving: false, notFound: [] });
  const colorOf = (e: (typeof events)[number]) => `var(--k-${typeInfo(catalog, e).color})`;
  const all = useMemo(() => eventMapPoints(events, colorOf), [events, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => [...new Set(all.map((p) => p.date).filter((d): d is string => Boolean(d)))].sort(), [all]);
  const points = day ? all.filter((p) => p.date === day) : all;
  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; color: string; icon: ReturnType<typeof typeInfo>["icon"] }>();
    for (const e of events) {
      const i = typeInfo(catalog, e);
      if (points.some((p) => p.eventId === e.id) && !seen.has(i.label)) seen.set(i.label, { label: i.label, color: `var(--k-${i.color})`, icon: i.icon });
    }
    return [...seen.values()];
  }, [events, catalog, points]);

  if (all.length === 0) {
    return (
      <div className="card">
        <p className="muted">
          Für die Karte fehlen Orte. Sobald Ereignisse Adressen oder Flughäfen haben, erscheinen sie hier.
        </p>
      </div>
    );
  }

  return (
    <div className="mapTab">
      <div className="maptoolbar">
        <SelectField
          label="Tag"
          value={day}
          onChange={setDay}
          options={[{ value: "", label: "Alle Tage" }, ...days.map((d) => ({ value: d, label: formatDayHeading(d) }))]}
        />
        <ul className="maplegend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className="maplegend__dot" style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
      {maps === true ? (
        <>
          <MapView points={points} route numbered label={`Karte der Reise ${trip.title}`} height={520} onSearch={setSearch} />
          {search.resolving ? <p className="muted small">Adressen werden gesucht …</p> : null}
          {search.notFound.length > 0 ? (
            <Banner tone="warn">
              Nicht gefunden:{" "}
              {search.notFound.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ", " : ""}
                  <Link to={`/trips/${trip.id}/events/${p.eventId}`}>{p.title}</Link>
                </span>
              ))}
              . Bitte die Adresse im Ereignis prüfen.
            </Banner>
          ) : null}
        </>
      ) : maps === false ? (
        <div className="card viz-card">
          <Banner tone="info">Apple Karten ist auf dem Server nicht eingerichtet. Hier steht der schematische Routenbogen.</Banner>
          <RouteArc events={day ? events.filter((e) => e.startDate === day) : events} title={`Routenbogen ${trip.title}`} />
        </div>
      ) : (
        <div className="map-card" style={{ height: 240 }}>
          <p className="map-card__status muted small">Karte wird geladen …</p>
        </div>
      )}
      <section className="card">
        <h3 className="label">Stationen</h3>
        <ol className="stations">
          {points.map((p) => (
            <li key={p.id}>
              <span className="stations__no num" style={{ background: p.color }}>
                {p.order}
              </span>
              <Link to={`/trips/${trip.id}/events/${p.eventId}`} className="stations__title">
                {p.title}
              </Link>
              <span className="muted small">{p.roleLabel}{p.address ? ` · ${p.address}` : p.query ? ` · ${p.query}` : ""}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="muted xsmall">
        <Icon name="info" size={12} /> Kein Standort-Tracking: die Karte zeigt nur geplante Orte.
      </p>
    </div>
  );
}
