import type { ReactNode } from "react";

/** Kennzahl: GROSSBUCHSTABEN-Label, Wert in Plex Mono, optional Zusatzzeile. */
export function Stat({
  label,
  value,
  sub,
  tone,
  size = "m",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "pos" | "neg" | "warn";
  size?: "m" | "l";
}) {
  return (
    <div className={`stat2${tone ? ` stat2--${tone}` : ""}${size === "l" ? " stat2--l" : ""}`}>
      <span className="stat2__label">{label}</span>
      <span className="stat2__value num">{value}</span>
      {sub ? <span className="stat2__sub">{sub}</span> : null}
    </div>
  );
}
