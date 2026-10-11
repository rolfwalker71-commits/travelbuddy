import { useId } from "react";
import type { TripEvent } from "../api/types";
import { buildDayBand, fmtMin } from "../lib/today";
import { colorKeyOf } from "../lib/viz";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { niceStep, placeLabels, textWidth } from "../lib/vizLayout";

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
  const [ref, w] = useContainerWidth<HTMLElement>(620);
  const band = buildDayBand(events, date, tripTz, colorOf ?? ((e) => `var(--k-${colorKeyOf(e.type)})`));
  if (!band) return null;
  const W = Math.min(Math.max(w, 260), 960);
  const pad = 14;
  const span = band.to - band.from || 1;
  const x = (m: number) => pad + ((m - band.from) / span) * (W - pad * 2);
  const blocks = band.items.filter((i) => i.kind !== "point");
  const points = band.items.filter((i) => i.kind === "point");

  // Beschriftungen der Punkte in bis zu drei Reihen oberhalb der Achse, ohne Überdeckung; was nicht passt, steht in der Liste
  const pointTexts = points.map((p) => `${fmtMin(p.from)} ${p.label}`);
  const placed = placeLabels(
    points.map((p, i) => ({ x: x(p.from) + 6, w: textWidth(pointTexts[i]!, 6.4, 4) })),
    W,
    3
  );
  const rows = Math.max(1, ...placed.map((pl) => (pl ? pl.row + 1 : 0)));
  const labelH = 14;
  const top = 6 + rows * labelH;
  const axisY = top + 40;
  const H = axisY + 40;
  // Stundenmarken: höchstens eine je 34 px
  const hourEvery = niceStep((W - pad * 2) / (span / 60), 34, [1, 2, 3, 4, 6, 12]);
  const hours = band.hours.filter((h) => Math.round(h / 60) % hourEvery === 0);
  const desc = band.items.map((i) => `${fmtMin(i.from)}${i.to != null ? ` bis ${fmtMin(i.to)}` : ""} ${i.label}`).join("; ");
  const inRange = nowMinutes != null && nowMinutes >= band.from && nowMinutes <= band.to;
  const unplaced = points.filter((_, i) => placed[i] === null);
  return (
    <figure className="viz viz--day" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz__svg viz__svg--px" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <line x1={pad} x2={W - pad} y1={axisY} y2={axisY} className="viz__baseline" />
        {hours.map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={axisY - 4} y2={axisY + 4} className="viz__gridline" />
            <text x={x(h)} y={axisY + 20} textAnchor="middle" className="viz__axis num">
              {fmtMin(h).slice(0, 2)}
            </text>
          </g>
        ))}
        {blocks.map((b) => {
          const x1 = x(b.from);
          const x2 = b.to != null ? x(b.to) : x1 + 4;
          const wb = Math.max(x2 - x1, 4);
          const row = b.kind === "buffer" ? 0 : b.kind === "event" ? 1 : 2;
          const y = axisY - (row === 1 ? 28 : row === 2 ? 18 : 12);
          const h = row === 1 ? 20 : row === 2 ? 14 : 8;
          const room = Math.floor((wb - 12) / 6.4);
          return (
            <g key={b.id}>
              <rect
                x={x1}
                y={y}
                width={wb}
                height={h}
                rx={3}
                className={`viz__blk viz__blk--${b.kind}`}
                style={b.kind === "buffer" ? undefined : { fill: b.color }}
              >
                <title>{`${fmtMin(b.from)}${b.to != null ? ` – ${fmtMin(b.to)}` : ""} · ${b.label}`}</title>
              </rect>
              {b.kind === "buffer" && wb > textWidth(b.label, 6.2, 8) ? (
                <text x={x1 + wb / 2} y={y - 6} textAnchor="middle" className="viz__buffer">
                  {b.label}
                </text>
              ) : null}
              {b.kind !== "buffer" && room >= 4 ? (
                <text x={x1 + 6} y={y + h - 6} className="viz__seglabel">
                  {b.label.length > room ? `${b.label.slice(0, room - 1)}…` : b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {points.map((p, i) => {
          const pl = placed[i];
          const px = x(p.from);
          return (
            <g key={p.id}>
              <line x1={px} x2={px} y1={pl ? 6 + pl.row * labelH + 4 : top} y2={axisY} className="viz__pointline" style={{ stroke: p.color }} />
              <circle cx={px} cy={pl ? 6 + pl.row * labelH + 4 : top} r={4} style={{ fill: p.color }}>
                <title>{pointTexts[i]}</title>
              </circle>
              {pl ? (
                <text x={pl.anchor === "start" ? px + 7 : px - 7} y={6 + pl.row * labelH + 8} textAnchor={pl.anchor} className="viz__ptlabel">
                  {pointTexts[i]}
                </text>
              ) : null}
            </g>
          );
        })}
        {inRange ? (
          <g>
            <rect x={x(nowMinutes!) - 1} y={top} width={2} height={axisY - top + 8} className="viz__today" />
            <text x={Math.min(Math.max(x(nowMinutes!), 40), W - 40)} y={H - 4} textAnchor="middle" className="viz__axis num">
              jetzt {fmtMin(nowMinutes!)}
            </text>
          </g>
        ) : null}
      </svg>
      {unplaced.length > 0 ? (
        <ul className="viz__more">
          {unplaced.map((p) => (
            <li key={p.id} className="num">
              {fmtMin(p.from)} {p.label}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
