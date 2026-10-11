import { useId } from "react";
import type { TripEvent } from "../api/types";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { shortStopLabel, textWidth } from "../lib/vizLayout";
import { buildRoute, projectRoute } from "../lib/viz";

const KIND_LABEL = { air: "Flug", ship: "Schiff", rail: "Bahn", road: "Strasse", other: "Weg" } as const;

/**
 * Routenbogen: die Reise als Linie, aus den Koordinaten der Ereignisse gezeichnet (kein Kartenmaterial).
 * Ersatz für Apple Karten, wenn kein MapKit-Schlüssel eingerichtet ist, und Infografik für sich.
 * Die Zeichenfläche folgt der Breite des Behälters (1 Einheit = 1 px), Beschriftungen werden gekürzt und überdecken
 * sich nicht; die vollständigen Namen stehen in der Stationenliste darunter (`list`).
 */
export function RouteArc({
  events,
  title = "Routenbogen der Reise",
  height,
  list = true,
}: {
  events: TripEvent[];
  title?: string;
  /** Feste Höhe in px; sonst nach Breite (180 bis 280). */
  height?: number;
  /** Stationenliste mit vollen Namen unter der Grafik. */
  list?: boolean;
}) {
  const uid = useId();
  const [ref, w] = useContainerWidth<HTMLElement>(630);
  const width = Math.min(Math.max(w, 260), 960);
  const h = height ?? Math.round(Math.min(280, Math.max(180, width * 0.38)));
  const route = buildRoute(events);
  const p = projectRoute(route, width, h, 34);
  if (p.stops.length < 2) {
    return (
      <p className="muted small viz__empty">
        Für den Routenbogen fehlen Orte mit Koordinaten. Sobald Flughäfen oder Adressen aufgelöst sind, erscheint er hier.
      </p>
    );
  }
  const kinds = [...new Set(p.legs.map((l) => l.kind))];
  const desc = `Stationen in Reihenfolge: ${p.stops.map((s) => s.label).join(", ")}.`;

  // Beschriftung rechts oder links vom Punkt, in zwei Reihen (oberhalb/unterhalb), ohne Überdeckung
  const shorts = p.stops.map((s) => shortStopLabel(s.label, width < 420 ? 12 : 18));
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labels = p.stops.flatMap((s, i) => {
    const text = shorts[i]!;
    const tw = textWidth(text, 5.9, 2);
    const spots = [
      { x: s.x + 11, y: s.y - 9, anchor: "start" as const },
      { x: s.x - 11, y: s.y - 9, anchor: "end" as const },
      { x: s.x + 11, y: s.y + 16, anchor: "start" as const },
      { x: s.x - 11, y: s.y + 16, anchor: "end" as const },
    ];
    for (const sp of spots) {
      const x0 = sp.anchor === "start" ? sp.x : sp.x - tw;
      const box = { x0, x1: x0 + tw, y0: sp.y - 11, y1: sp.y + 3 };
      if (box.x0 < 2 || box.x1 > width - 2 || box.y0 < 0 || box.y1 > h) continue;
      if (taken.some((o) => box.x0 < o.x1 + 3 && box.x1 + 3 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0)) continue;
      // Punkte nicht überdecken
      if (p.stops.some((o) => o !== s && o.x + 8 > box.x0 && o.x - 8 < box.x1 && o.y + 8 > box.y0 && o.y - 8 < box.y1)) continue;
      taken.push(box);
      return [{ id: s.id, text, x: sp.x, y: sp.y, anchor: sp.anchor }];
    }
    return [];
  });

  return (
    <figure className="viz viz--route" ref={ref}>
      <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} className="viz__svg viz__svg--px" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <g className="viz__grid">
          {Array.from({ length: Math.floor(width / 70) }, (_, i) => (i + 1) * 70).map((x) => (
            <line key={x} x1={x} y1={0} x2={x} y2={h} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} y1={Math.round(h * f)} x2={width} y2={Math.round(h * f)} />
          ))}
        </g>
        {p.legs.map((l, i) => (
          <path key={i} d={l.d} className={`viz__leg viz__leg--${l.kind}`} style={{ stroke: `var(--k-${l.color})` }} />
        ))}
        {p.stops.map((s) => (
          <g key={s.id}>
            <circle cx={s.x} cy={s.y} r={8} className="viz__stop" style={{ stroke: `var(--k-${s.color})` }} />
            <text x={s.x} y={s.y + 3.2} textAnchor="middle" className="viz__stopno num">
              {s.order}
            </text>
            <title>{`${s.order}. ${s.label}`}</title>
          </g>
        ))}
        <g className="viz__labels">
          {labels.map((l) => (
            <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor}>
              {l.text}
            </text>
          ))}
        </g>
      </svg>
      {list ? (
        <ol className="viz__stations" aria-label="Stationen">
          {p.stops.map((s) => (
            <li key={s.id}>
              <span className="viz__no num" style={{ borderColor: `var(--k-${s.color})` }}>
                {s.order}
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <figcaption className="viz__legend">
        {kinds.map((k) => (
          <span key={k}>
            <i className={`viz__key viz__key--${k}`} aria-hidden="true" />
            {KIND_LABEL[k]}
          </span>
        ))}
        <small>Schematisch aus den Koordinaten gezeichnet</small>
      </figcaption>
    </figure>
  );
}
