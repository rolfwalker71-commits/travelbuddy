import { useId } from "react";
import type { Balance, Expense, Transfer } from "../api/types";
import { formatAxisDate, formatDate } from "../lib/dates";
import { formatMinor, formatMoney } from "../lib/money";
import { balanceBars, costsByCategory, costsByDay, settlementArrows } from "../lib/viz";

/** Kasse nach Kategorie: gestapelter Balken mit Legende. */
export function CostByCategory({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const uid = useId();
  const slices = costsByCategory(expenses);
  const total = slices.reduce((n, s) => n + s.minor, 0);
  if (slices.length === 0 || total === 0) return null;
  const W = 580;
  let acc = 0;
  const desc = slices.map((s) => `${s.label} ${formatMoney(s.minor, currency)} (${Math.round(s.share * 100)} %)`).join("; ");
  return (
    <figure className="viz">
      <figcaption className="viz__cap">
        <span className="label">Ausgaben nach Kategorie</span>
        <span className="num">{formatMoney(total, currency)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} 26`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Ausgaben nach Kategorie</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        {slices.map((s) => {
          const w = Math.max(s.share * W - 1.5, 1);
          const x = acc;
          acc += s.share * W;
          return <rect key={s.key} x={x} y={0} width={w} height={26} className={`viz__c viz__c${s.colorIndex}`} />;
        })}
      </svg>
      <ul className="viz__legend2">
        {slices.map((s) => (
          <li key={s.key}>
            <i className={`viz__sw viz__c${s.colorIndex}`} aria-hidden="true" />
            <span>{s.label}</span>
            <b className="num">{formatMinor(s.minor, currency)}</b>
            <span className="muted xsmall num">{Math.round(s.share * 100)} %</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Kasse nach Tag: Säulen je Tag mit Betrag. */
export function CostByDay({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const uid = useId();
  const days = costsByDay(expenses);
  if (days.length === 0) return null;
  const W = 580;
  const H = 150;
  const top = 18;
  const bottom = 26;
  const max = Math.max(...days.map((d) => d.minor), 1);
  const slot = (W - 20) / Math.max(days.length, 1);
  const bw = Math.min(34, slot * 0.7);
  const every = Math.ceil(days.length / 10);
  const desc = days.map((d) => `${formatDate(d.date)} ${formatMoney(d.minor, currency)}`).join("; ");
  return (
    <figure className="viz">
      <figcaption className="viz__cap">
        <span className="label">Ausgaben nach Tag</span>
        <span className="muted xsmall num">
          {formatDate(days[0]!.date)}
          {days.length > 1 ? ` – ${formatDate(days[days.length - 1]!.date)}` : ""} · {currency}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Ausgaben nach Tag</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <line x1={10} x2={W - 10} y1={H - bottom} y2={H - bottom} className="viz__baseline" />
        {days.map((d, i) => {
          const h = Math.max(2, ((H - top - bottom) * d.minor) / max);
          const cx = 10 + slot * i + slot / 2;
          return (
            <g key={d.date}>
              <rect x={cx - bw / 2} y={H - bottom - h} width={bw} height={h} rx={2} className="viz__c viz__c1">
                <title>{`${formatDate(d.date)}: ${formatMoney(d.minor, currency)}`}</title>
              </rect>
              {days.length <= 12 ? (
                <text x={cx} y={H - bottom - h - 4} textAnchor="middle" className="viz__vl num">
                  {formatMinor(d.minor, currency).replace(/\.00$/, "")}
                </text>
              ) : null}
              {i % every === 0 ? (
                <text x={cx} y={H - 8} textAnchor="middle" className="viz__axis num">
                  {formatAxisDate(d.date)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Salden um die Mittelachse: Haben rechts, Soll links. */
export function BalanceChart({ balances, currency }: { balances: Balance[]; currency: string }) {
  const uid = useId();
  if (balances.length === 0) return null;
  const half = 150;
  const bars = balanceBars(balances, half);
  const rowH = 32;
  const W = 460;
  const H = bars.length * rowH + 8;
  const cx = W / 2;
  const desc = bars.map((b) => `${b.name} ${b.netMinor >= 0 ? "bekommt" : "schuldet"} ${formatMoney(Math.abs(b.netMinor), currency)}`).join("; ");
  return (
    <figure className="viz">
      <figcaption className="viz__cap">
        <span className="label">Saldo je Person</span>
        <span className="muted xsmall">{currency}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz__svg" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Salden je Person</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <line x1={cx} x2={cx} y1={0} y2={H} className="viz__axisline" />
        {bars.map((b, i) => {
          const y = 4 + i * rowH;
          const x = cx + b.x;
          const label = `${b.netMinor > 0 ? "+" : b.netMinor < 0 ? "−" : ""}${formatMinor(Math.abs(b.netMinor), currency)}`;
          return (
            <g key={b.memberId}>
              <text x={cx + (b.side === "neg" ? 8 : -8)} y={y + 13} textAnchor={b.side === "neg" ? "start" : "end"} className="viz__name">
                {b.name}
              </text>
              <rect x={x} y={y + 16} width={Math.max(b.w, 2)} height={10} rx={2} className={`viz__bal viz__bal--${b.side}`} />
              <text
                x={b.side === "neg" ? x - 6 : x + b.w + 6}
                y={y + 25}
                textAnchor={b.side === "neg" ? "end" : "start"}
                className="viz__vl num"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Ausgleich: wer zahlt wem, mit Pfeil und Betrag. */
export function SettlementArrows({ transfers, currency }: { transfers: Transfer[]; currency: string }) {
  const list = settlementArrows(transfers);
  if (list.length === 0) return null;
  return (
    <figure className="viz">
      <figcaption className="viz__cap">
        <span className="label">Ausgleich</span>
        <span className="muted xsmall">{list.length} {list.length === 1 ? "Überweisung" : "Überweisungen"}</span>
      </figcaption>
      <ul className="viz__pay">
        {list.map((t, i) => (
          <li key={i}>
            <span className="viz__who">{t.fromName}</span>
            <svg viewBox="0 0 80 14" className="viz__arrow" role="img" aria-label="zahlt an">
              <path d="M2 7h70M64 2l8 5-8 5" />
            </svg>
            <span className="viz__who">{t.toName}</span>
            <b className="num viz__amt">{formatMoney(t.amountMinor, currency)}</b>
          </li>
        ))}
      </ul>
    </figure>
  );
}
