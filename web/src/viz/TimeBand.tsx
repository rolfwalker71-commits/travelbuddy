import { useId } from "react";
import type { TripEvent } from "../api/types";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { formatAxisDate, formatDate, formatYearSpan } from "../lib/dates";
import type { TripSpan } from "../lib/plan";
import { niceStep, textWidth } from "../lib/vizLayout";
import { buildTimeBand, LANE_LABEL } from "../lib/viz";

/**
 * Zeitband: alle Tage der Reise in Spuren (Unterwegs, Schiff, Unterkunft, Mietwagen), heute markiert.
 * Folgt der Breite des Behälters; auf schmalen Bildschirmen stehen die Spurnamen über der Spur statt links.
 * Achsen zeigen `dd.mm.`, das Jahr steht in Titel und Unterzeile.
 */
export function TimeBand({
  events,
  span,
  today,
  title = "Zeitband der Reise",
}: {
  events: TripEvent[];
  span: TripSpan | null;
  today: string | null;
  title?: string;
}) {
  const uid = useId();
  const [ref, w] = useContainerWidth<HTMLElement>(620);
  const band = buildTimeBand(events, span, today);
  if (!span || band.lanes.length === 0) return null;
  const W = Math.min(Math.max(w, 260), 960);
  const narrow = W < 480;
  const labelW = narrow ? 0 : 92;
  const laneH = narrow ? 48 : 34;
  const top = 24;
  const H = top + band.lanes.length * laneH + 22;
  const plotW = W - labelW - 8;
  const dayW = plotW / span.days;
  const x = (i: number) => labelW + i * dayW;
  // Achsenbeschriftung: «dd.mm.» braucht rund 42 px; Schritt in Tagen so, dass sie sich nicht berühren
  const step = niceStep(dayW, 54);
  const ticks: number[] = [];
  for (let i = 0; i < span.days; i += step) ticks.push(i);
  const desc = `Von ${formatDate(span.start)} bis ${formatDate(span.end)}, ${span.days} Tage. ${band.segments
    .map((s) => `${LANE_LABEL[s.lane]}: ${s.label}`)
    .join("; ")}.`;
  return (
    <figure className="viz" ref={ref}>
      <figcaption className="viz__cap">
        <span className="muted xsmall num">
          {formatDate(span.start)} – {formatDate(span.end)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz__svg viz__svg--px" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{`${title} ${formatYearSpan(span.start, span.end)}`}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        {ticks.map((i) => {
          const tx = x(i);
          const late = tx > W - 44;
          return (
            <g key={i}>
              <line x1={tx} x2={tx} y1={top - 4} y2={H - 18} className="viz__gridline" />
              <text x={late ? tx + 2 : tx} y={14} textAnchor={late ? "end" : "start"} className="viz__axis num">
                {formatAxisDate(band.days[i] ?? span.start)}
              </text>
            </g>
          );
        })}
        {band.lanes.map((lane, li) => (
          <text key={lane} x={narrow ? 0 : 0} y={top + li * laneH + (narrow ? 11 : 21)} className="viz__lane">
            {LANE_LABEL[lane]}
          </text>
        ))}
        {band.segments.map((s) => {
          const li = band.lanes.indexOf(s.lane);
          const wSeg = Math.max(dayW * (s.to - s.from + 1) - 2, 5);
          const fits = wSeg > textWidth(s.label, 6.1, 12);
          const y = top + li * laneH + (narrow ? 16 : 5);
          return (
            <g key={s.id}>
              <rect x={x(s.from) + 1} y={y} width={wSeg} height={24} rx={3} style={{ fill: `var(--k-${s.color})` }}>
                <title>{`${s.label} · ${formatDate(band.days[s.from])}${s.to > s.from ? ` – ${formatDate(band.days[s.to])}` : ""}`}</title>
              </rect>
              {fits ? (
                <text x={x(s.from) + 8} y={y + 16} className="viz__seglabel">
                  {s.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {band.todayIndex != null ? (
          <g>
            <rect x={x(band.todayIndex) + dayW / 2 - 1} y={top - 6} width={2} height={band.lanes.length * laneH + 8} className="viz__today" />
            <text
              x={Math.min(x(band.todayIndex) + dayW / 2 + 6, W - 4)}
              y={H - 4}
              textAnchor={x(band.todayIndex) + dayW / 2 + 6 + 90 > W ? "end" : "start"}
              className="viz__axis num"
            >
              heute · Tag {band.todayIndex + 1}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
