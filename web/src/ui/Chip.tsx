import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type ChipTone = "neutral" | "accent" | "pos" | "neg" | "warn" | "proposal" | "review" | "now";

/**
 * Kleine Marke: Status, Typ, Zähler. «Vorschlag» hat gestrichelten Rand, «Zu prüfen» einen Warnrand.
 * Bedeutung steht immer im Text, nie nur in der Farbe.
 */
export function Chip({ tone = "neutral", icon, children, title }: { tone?: ChipTone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span className={`chip2 chip2--${tone}`} title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}
