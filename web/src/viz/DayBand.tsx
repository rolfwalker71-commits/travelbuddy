import { useId } from "react";
import type { TripEvent } from "../api/types";
import { buildDayBand, fmtMin } from "../lib/today";
import { colorKeyOf } from "../lib/viz";

/**
 * Tagesband: ein Tag auf der Zeitachse mit Check-in, Boarding, Abfahrt und Pufferzeiten. Zeiten in Reisezeit;
 * die Jetzt-Marke zeigt die aktuelle Uhrzeit, wenn der Tag heute ist.
 */
export function DayBand({
  events,
  date,
  tripTz,
  nowMinutes = null,
  title = "Tagesband",
  colorOf,
}: {
  events: TripEvent[];
  date: string;
  tripTz: string;
  /** Minuten ab Mitternacht (Reisezeit) für die Jetzt-Marke. */
  nowMinutes?: number | null;
  title?: string;
  colorOf?: (e: TripEvent) => string;
}) {
  const uid = useId();
  const band = buildDayBand(events, date, tripTz, colorOf ?? ((e) => `var(--k-${colorKeyOf(e.type)})`));
  if (!band) return null;
  const W = 620;
  const pad = 14;
  const H = 108;
  const span = band.to - band.from || 1;
  const x = (m: number) => pad + ((m - band.from) / span) * (W - pad * 2);
  const blocks = band.items.filter((i) => i.kind !== "point");
  const points = band.items.filter((i) => i.kind === "point");
  const desc = band.items.map((i) => `${fmtMin(i.from)}${i.to != null ? ` bis ${fmtMin(i.to)}` : ""} ${i.label}`).join("; ");
  const inRange = nowMinutes != null && nowMinutes >= band.from && nowMinutes <= band.to;
  return (
    <figure className="viz viz--day viz--scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <line x1={pad} x2={W - pad} y1={64} y2={64} className="viz__baseline" />
        {band.hours.map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={60} y2={68} className="viz__gridline" />
            <text x={x(h)} y={84} textAnchor="middle" className="viz__axis num">
              {fmtMin(h).slice(0, 2)}
            </text>
          </g>
        ))}
        {blocks.map((b) => {
          const x1 = x(b.from);
          const x2 = b.to != null ? x(b.to) : x1 + 4;
          const w = Math.max(x2 - x1, 4);
          const row = b.kind === "buffer" ? 0 : b.kind === "event" ? 1 : 2;
          const y = row === 1 ? 36 : row === 2 ? 46 : 52;
          const h = row === 1 ? 20 : row === 2 ? 14 : 8;
          return (
            <g key={b.id}>
              <rect
                x={x1}
                y={y}
                width={w}
                height={h}
                rx={3}
                className={`viz__blk viz__blk--${b.kind}`}
                style={b.kind === "buffer" ? undefined : { fill: b.color }}
              >
                <title>{`${fmtMin(b.from)}${b.to != null ? ` – ${fmtMin(b.to)}` : ""} · ${b.label}`}</title>
              </rect>
              {b.kind === "buffer" && w > 70 ? (
                <text x={x1 + w / 2} y={y - 6} textAnchor="middle" className="viz__buffer">
                  {b.label}
                </text>
              ) : null}
              {b.kind !== "buffer" && w > 90 ? (
                <text x={x1 + 6} y={y + h - 6} className="viz__seglabel">
                  {b.label.length > w / 6.4 ? `${b.label.slice(0, Math.floor(w / 6.4) - 1)}…` : b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {points.map((p, i) => (
          <g key={p.id}>
            <line x1={x(p.from)} x2={x(p.from)} y1={22} y2={64} className="viz__pointline" style={{ stroke: p.color }} />
            <circle cx={x(p.from)} cy={22} r={4} style={{ fill: p.color }} />
            <text x={x(p.from) + (x(p.from) > W - 140 ? -7 : 7)} y={i % 2 ? 18 : 12} textAnchor={x(p.from) > W - 140 ? "end" : "start"} className="viz__ptlabel">
              {fmtMin(p.from)} {p.label}
            </text>
          </g>
        ))}
        {inRange ? (
          <g>
            <rect x={x(nowMinutes!) - 1} y={26} width={2} height={46} className="viz__today" />
            <text x={x(nowMinutes!)} y={100} textAnchor="middle" className="viz__axis num">
              jetzt {fmtMin(nowMinutes!)}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
