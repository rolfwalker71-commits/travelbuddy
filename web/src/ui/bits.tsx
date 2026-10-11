import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "../lib/money";
import { balanceLabel, balanceTone } from "../lib/ledger";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./Button";

export function Money({
  minor,
  currency,
  sign,
  className,
}: {
  minor: number;
  currency: string;
  sign?: "always";
  className?: string;
}) {
  return <span className={`num money${className ? ` ${className}` : ""}`}>{formatMoney(minor, currency, { sign })}</span>;
}

export type BadgeTone = "neutral" | "pos" | "neg" | "warn" | "accent";
export function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

/** Saldo mit Text und Icon, nicht nur Farbe. */
export function BalanceChip({ netMinor, currency, me }: { netMinor: number; currency: string; me?: boolean }) {
  const tone = balanceTone(netMinor);
  const icon: IconName = tone === "credit" ? "arrow-down" : tone === "debit" ? "arrow-up" : "check";
  return (
    <span className={`balance balance--${tone}`}>
      <Icon name={icon} size={14} />
      <span className="balance__label">{balanceLabel(netMinor, { me })}</span>
      {netMinor !== 0 ? <Money minor={Math.abs(netMinor)} currency={currency} /> : null}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  label: string;
  className?: string;
}) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    onChange(options[n]!.value);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={`segmented${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={`segmented__item${o.value === value ? " is-active" : ""}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
          {o.count != null ? <span className="segmented__count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Tab-Leiste für Abschnitte einer Seite (ARIA tabs). */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
  idPrefix,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  label: string;
  idPrefix: string;
}) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % options.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[n]!.value);
    document.getElementById(`${idPrefix}-tab-${options[n]!.value}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          id={`${idPrefix}-tab-${o.value}`}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={o.value === value ? 0 : -1}
          className={`tabs__item${o.value === value ? " is-active" : ""}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
          {o.count != null ? <span className="tabs__count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Seitenkopf: Rubrik (GROSS, Zinnober), Titel in Barlow Semi Condensed, Untertitel, Aktionen.
 * Mit `back` erscheint ein Zurück-Pfeil; `children` stehen unter dem Kopf (z. B. Kennzahlen).
 */
export function PageHeader({
  title,
  subtitle,
  back,
  backLabel = "Zurück",
  actions,
  eyebrow,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  backLabel?: string;
  actions?: ReactNode;
  /** Kleine Rubrik über dem Titel. */
  eyebrow?: string;
  children?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div className="pagehead">
      <header className="toolbar">
        {back ? (
          <Link to={back} className="btn btn--ghost btn--m btn--icon" aria-label={backLabel} title={backLabel}>
            <Icon name="arrow-left" size={20} />
          </Link>
        ) : null}
        <div className="toolbar__title">
          {eyebrow ? <span className="toolbar__eyebrow">{eyebrow}</span> : null}
          <h1>{title}</h1>
          {subtitle ? <p className="toolbar__sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="toolbar__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** Seitentitel für Tab-Leiste und Screenreader: «Reisen · TravelBuddy». */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · TravelBuddy` : "TravelBuddy";
    return () => {
      document.title = prev;
    };
  }, [title]);
}

export function Section({
  title,
  actions,
  children,
  id,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      {title || actions ? (
        <div className="section__head">
          {title ? <h2 id={id}>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Text in die Zwischenablage; Rückfall für unsichere Kontexte (http). */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export function CopyButton({
  text,
  label,
  onCopied,
  variant = "secondary",
}: {
  text: string;
  label: string;
  onCopied?: () => void;
  variant?: "secondary" | "ghost";
}) {
  const copy = async () => {
    await copyToClipboard(text);
    onCopied?.();
  };
  return <IconButton icon="copy" label={label} variant={variant} onClick={copy} />;
}
