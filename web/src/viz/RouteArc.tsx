import { useId } from "react";
import type { TripEvent } from "../api/types";
import { buildRoute, projectRoute } from "../lib/viz";

const KIND_LABEL = { air: "Flug", ship: "Schiff", rail: "Bahn", road: "Strasse", other: "Weg" } as const;

/**
 * Routenbogen: die Reise als Linie, aus den Koordinaten der Ereignisse gezeichnet (kein Kartenmaterial).
 * Ersatz für Apple Karten, wenn kein MapKit-Schlüssel eingerichtet ist, und Infografik für sich.
 */
export function RouteArc({ events, title = "Routenbogen der Reise", height = 232 }: { events: TripEvent[]; title?: string; height?: number }) {
  const uid = useId();
  const width = 630;
  const route = buildRoute(events);
  const p = projectRoute(route, width, height);
  if (p.stops.length < 2) {
    return (
      <p className="muted small viz__empty">
        Für den Routenbogen fehlen Orte mit Koordinaten. Sobald Flughäfen oder Adressen aufgelöst sind, erscheint er hier.
      </p>
    );
  }
  const kinds = [...new Set(p.legs.map((l) => l.kind))];
  // Beschriftungen ohne Überdeckung: kollidierende entfallen, ihre Nummer bleibt am Punkt (Liste steht auf der Karte-Seite)
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labels: { id: string; x: number; y: number; anchor: "start" | "end"; text: string }[] = [];
  p.stops.forEach((s, i) => {
    const right = s.x < width * 0.7;
    const text = s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label;
    const w = text.length * 5.8 + 4;
    const y = s.y + (i % 2 === 0 ? -9 : 17);
    const x = s.x + (right ? 10 : -10);
    const box = { x0: right ? x : x - w, x1: right ? x + w : x, y0: y - 11, y1: y + 3 };
    const clash = placed.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
    const outside = box.x0 < 0 || box.x1 > width;
    if (clash || outside) return;
    placed.push(box);
    labels.push({ id: s.id, x, y, anchor: right ? "start" : "end", text });
  });
  const desc = `Stationen in Reihenfolge: ${p.stops.map((s) => s.label).join(", ")}.`;
  const grid: number[] = [];
  for (let x = 60; x < width; x += 60) grid.push(x);
  return (
    <figure className="viz viz--scroll">
      <svg viewBox={`0 0 ${width} ${height}`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <g className="viz__grid">
          {grid.map((x) => (
            <line key={x} x1={x} y1={0} x2={x} y2={height} />
          ))}
          {[Math.round(height / 4), Math.round(height / 2), Math.round((height * 3) / 4)].map((y) => (
            <line key={y} x1={0} y1={y} x2={width} y2={y} />
          ))}
        </g>
        {p.legs.map((l, i) => (
          <path key={i} d={l.d} className={`viz__leg viz__leg--${l.kind}`} style={{ stroke: `var(--k-${l.color})` }} />
        ))}
        {p.stops.map((s) => (
          <g key={s.id}>
            <circle cx={s.x} cy={s.y} r={5.5} className="viz__stop" style={{ stroke: `var(--k-${s.color})` }} />
            <text x={s.x} y={s.y + 3.5} textAnchor="middle" className="viz__stopno num">
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
