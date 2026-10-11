import type { ReactNode } from "react";
import { Brand } from "../layout/AppShell";
import { useDocumentTitle } from "../ui/bits";

/** Schlanke, öffentliche Hülle für Gast-Links: keine Navigation, mobil zuerst. */
export function GuestShell({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  useDocumentTitle(title ?? "");
  return (
    <div className="guest">
      <header className="guest__bar glass">
        <Brand />
        {title ? (
          <div className="guest__title">
            <span className="truncate">{title}</span>
            {subtitle ? <span className="xsmall faint truncate">{subtitle}</span> : null}
          </div>
        ) : null}
      </header>
      <main className="guest__main">{children}</main>
      <footer className="guest__foot xsmall faint">
        Persönlicher Link von TravelBuddy. Bitte nicht weitergeben.
      </footer>
    </div>
  );
}
