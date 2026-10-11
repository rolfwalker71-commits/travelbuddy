import { useId } from "react";
import type { TripEvent } from "../api/types";
import { formatAxisDate, formatDate, formatYearSpan } from "../lib/dates";
import type { TripSpan } from "../lib/plan";
import { buildTimeBand, LANE_LABEL } from "../lib/viz";

/** Zeitband: alle Tage der Reise in Spuren (Unterwegs, Schiff, Unterkunft, Mietwagen), heute markiert. */
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
  const band = buildTimeBand(events, span, today);
  if (!span || band.lanes.length === 0) return null;
  const W = 620;
  const labelW = 86;
  const laneH = 34;
  const top = 24;
  const H = top + band.lanes.length * laneH + 22;
  const dayW = (W - labelW - 6) / span.days;
  const x = (i: number) => labelW + i * dayW;
  const step = span.days <= 8 ? 1 : span.days <= 16 ? 2 : span.days <= 40 ? 7 : 14;
  const ticks: number[] = [];
  for (let i = 0; i < span.days; i += step) ticks.push(i);
  const dd = (iso: string) => formatAxisDate(iso);
  const desc = `Von ${formatDate(span.start)} bis ${formatDate(span.end)}, ${span.days} Tage. ${band.segments
    .map((s) => `${LANE_LABEL[s.lane]}: ${s.label}`)
    .join("; ")}.`;
  return (
    <figure className="viz viz--scroll">
      <figcaption className="viz__cap">
        <span className="muted xsmall num">
          {formatDate(span.start)} – {formatDate(span.end)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>{`${title} ${formatYearSpan(span.start, span.end)}`}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        {ticks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={top - 4} y2={H - 18} className="viz__gridline" />
            <text x={x(i)} y={14} className="viz__axis num">
              {dd(band.days[i] ?? span.start)}
            </text>
          </g>
        ))}
        {band.lanes.map((lane, li) => (
          <text key={lane} x={0} y={top + li * laneH + 21} className="viz__lane">
            {LANE_LABEL[lane]}
          </text>
        ))}
        {band.segments.map((s) => {
          const li = band.lanes.indexOf(s.lane);
          const w = Math.max(dayW * (s.to - s.from + 1) - 2, 5);
          const fits = w > s.label.length * 6.1 + 12;
          return (
            <g key={s.id}>
              <rect x={x(s.from) + 1} y={top + li * laneH + 5} width={w} height={24} rx={3} style={{ fill: `var(--k-${s.color})` }}>
                <title>{`${s.label} · ${formatDate(band.days[s.from])}${s.to > s.from ? ` – ${formatDate(band.days[s.to])}` : ""}`}</title>
              </rect>
              {fits ? (
                <text x={x(s.from) + 8} y={top + li * laneH + 21} className="viz__seglabel">
                  {s.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {band.todayIndex != null ? (
          <g>
            <rect x={x(band.todayIndex) + dayW / 2 - 1} y={top - 6} width={2} height={band.lanes.length * laneH + 8} className="viz__today" />
            <text x={Math.min(x(band.todayIndex) + 6, W - 70)} y={H - 4} className="viz__axis num">
              heute · Tag {band.todayIndex + 1}
            </text>
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
