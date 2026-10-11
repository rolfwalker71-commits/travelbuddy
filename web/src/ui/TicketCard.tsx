import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Fact } from "../lib/eventUi";
import { Icon, type IconName } from "./Icon";

export type TicketCardProps = {
  /** Farbschlüssel aus dem Katalog (`air`, `stay`, …) → `--k-<key>`. */
  kind: string;
  icon: IconName;
  /** Typ in GROSSBUCHSTABEN im Kopfband. */
  label: string;
  /** Referenz (Buchungsnummer, Flugnummer) in Plex Mono, rechts im Kopf. */
  reference?: string;
  /** Marken im Kopf (z. B. Vorschlag, Jetzt). */
  badges?: ReactNode;
  /** Titel und Hauptzeile. */
  title?: ReactNode;
  /** Zeit- oder Routenzeile unter dem Titel (gross, mono). */
  main?: ReactNode;
  /** Wichtiges je Typ als Raster. */
  facts?: Fact[];
  /** Freier Inhalt zwischen Hauptzeile und Raster. */
  children?: ReactNode;
  /** Abrissstreifen: Dokumente, Aktionen. */
  stub?: ReactNode;
  /** Ziel, wenn die ganze Karte ein Link ist. */
  to?: string;
  onClick?: () => void;
  /** Hervorgehoben (jetzt / als Nächstes). */
  active?: boolean;
  /** Gedämpft (vergangen oder Vorschlag). */
  soft?: boolean;
  dashed?: boolean;
  /** Eigenes Seitenverhältnis für grosse Detailkarten. */
  size?: "m" | "l";
  id?: string;
};

/** Ticket-Karte: Kopfband, Perforation, Hauptzeile, Detailraster, Abrissstreifen. */
export function TicketCard(p: TicketCardProps) {
  const cls = `ticket ticket--${p.size ?? "m"}${p.active ? " is-active" : ""}${p.soft ? " is-soft" : ""}${p.dashed ? " is-dashed" : ""}`;
  const style = { ["--tk" as string]: `var(--k-${p.kind})` } as React.CSSProperties;
  const body = (
    <>
      <header className="ticket__head">
        <span className="ticket__ic" aria-hidden="true">
          <Icon name={p.icon} size={16} />
        </span>
        <span className="ticket__type">{p.label}</span>
        {p.badges ? <span className="ticket__badges">{p.badges}</span> : null}
        {p.reference ? <span className="ticket__ref num">{p.reference}</span> : null}
      </header>
      <div className="ticket__perf" aria-hidden="true" />
      <div className="ticket__body">
        {p.title ? <div className="ticket__title">{p.title}</div> : null}
        {p.main ? <div className="ticket__main">{p.main}</div> : null}
        {p.children}
        {p.facts && p.facts.length > 0 ? (
          <dl className="ticket__facts">
            {p.facts.map((f) => (
              <div key={f.label} className={`ticket__fact${f.wide ? " is-wide" : ""}`}>
                <dt>{f.label}</dt>
                <dd className={f.mono ? "num" : undefined}>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {p.stub ? (
        <>
          <div className="ticket__perf ticket__perf--stub" aria-hidden="true" />
          <footer className="ticket__stub">{p.stub}</footer>
        </>
      ) : null}
    </>
  );
  if (p.to) {
    return (
      <article id={p.id} className={`${cls} ticket--link`} style={style}>
        <Link to={p.to} className="ticket__hit" aria-label={typeof p.title === "string" ? p.title : p.label} />
        {body}
      </article>
    );
  }
  return (
    <article id={p.id} className={cls} style={style} onClick={p.onClick}>
      {body}
    </article>
  );
}
