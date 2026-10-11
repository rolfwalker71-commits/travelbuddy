import { useEffect, useState } from "react";
import { getHelpCard, getIllustration } from "../lib/illustrations";
import { THEME_CHANGED } from "../lib/theme";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** Aufgelöstes Thema des Dokuments (`data-theme`), folgt Wechseln in den Einstellungen. */
function useResolvedTheme(): "light" | "dark" {
  const read = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [t, setT] = useState<"light" | "dark">(read);
  useEffect(() => {
    const on = () => setT(read());
    window.addEventListener(THEME_CHANGED, on);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", on);
    } catch {
      /* ältere Browser */
    }
    return () => {
      window.removeEventListener(THEME_CHANGED, on);
      mq?.removeEventListener("change", on);
    };
  }, []);
  return t;
}

/** Technischer Platzhalter, bis die Illustration vorliegt (isometrischer Block, gestrichelt). */
function Placeholder() {
  return (
    <svg viewBox="0 0 160 100" className="illu__ph" role="presentation" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeDasharray="3 4">
        <path d="M80 18 124 42v34L80 100 36 76V42z" opacity=".55" />
        <path d="M36 42 80 66l44-24M80 66v34" opacity=".55" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".5">
        <path d="M60 32h40M52 38h56" />
      </g>
    </svg>
  );
}

/** Datei der Illustration für das aktuelle Thema oder `null` (dann Platzhalter). */
function useIllustrationSrc(id: string) {
  const theme = useResolvedTheme();
  const entry = getIllustration(id);
  const src = entry ? (theme === "dark" ? entry.dark ?? entry.light : entry.light ?? entry.dark) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return { entry, src: failed ? null : src, onError: () => setFailed(true) };
}

/**
 * Illustration aus `shared/illustrations/manifest.json`. Fehlt die ID oder die Datei, steht ein Platzhalter;
 * die Karte bleibt nutzbar. Helles und dunkles Thema wählen die passende Datei. Mit `zoom` lässt sich die
 * Illustration vergrössern (Klick oder Enter).
 */
export function IllustrationCard({
  id,
  caption,
  compact = false,
  decorative = false,
  zoom = false,
  className,
}: {
  id: string;
  caption?: string;
  compact?: boolean;
  /** Nur Schmuck: kein Alternativtext. */
  decorative?: boolean;
  /** Klick öffnet eine grosse Ansicht. */
  zoom?: boolean;
  className?: string;
}) {
  const { entry, src, onError } = useIllustrationSrc(id);
  const [big, setBig] = useState(false);
  const alt = decorative ? "" : entry?.alt || caption || "";
  const frame = src ? (
    <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={onError} />
  ) : (
    <Placeholder />
  );
  return (
    <figure className={`illu${compact ? " illu--compact" : ""}${className ? ` ${className}` : ""}`} data-illustration={id}>
      {zoom && src ? (
        <button type="button" className="illu__frame illu__frame--btn" onClick={() => setBig(true)} aria-label={`${entry?.title ?? "Illustration"} vergrössern`}>
          {frame}
          <span className="illu__zoom" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
        </button>
      ) : (
        <div className="illu__frame">{frame}</div>
      )}
      {caption ? <figcaption className="illu__cap">{caption}</figcaption> : null}
      {big && src ? (
        <Sheet open onClose={() => setBig(false)} title={entry?.title ?? "Illustration"} size="xl" description={entry?.alt || undefined}>
          <img className="illu__big" src={src} alt={entry?.alt ?? ""} />
        </Sheet>
      ) : null}
    </figure>
  );
}

/** Cover einer Reise ohne Titelbild (`cover-sea|city|mountain|island`), als Banner zugeschnitten. */
export function CoverIllustration({ id, className }: { id: string; className?: string }) {
  const { entry, src, onError } = useIllustrationSrc(id);
  if (!src) return null;
  return (
    <div className={`coverill${className ? ` ${className}` : ""}`} data-illustration={id}>
      <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} onError={onError} title={entry?.title} />
    </div>
  );
}

/**
 * Hilfekarte aus `shared/illustrations/help-cards.json` (mit eingebauten Texten als Rückfall): grosse Illustration
 * (klickbar zum Vergrössern), Einleitung und nummerierte Schritte mit GROSSBUCHSTABEN-Label. Einklappbar.
 */
export function HelpCard({ id, defaultOpen = true, className }: { id: string; defaultOpen?: boolean; className?: string }) {
  const card = getHelpCard(id);
  const [open, setOpen] = useState(defaultOpen);
  if (!card) return null;
  const panel = `help-${card.id}`;
  return (
    <section className={`help${className ? ` ${className}` : ""}`} aria-labelledby={`${panel}-t`}>
      <button type="button" className="help__head" aria-expanded={open} aria-controls={`${panel}-body`} onClick={() => setOpen((o) => !o)}>
        <span className="help__q" aria-hidden="true">
          <Icon name="help" size={18} />
        </span>
        <span className="help__title" id={`${panel}-t`}>
          {card.title}
        </span>
        <Icon name="chevron-down" size={16} className={`help__chev${open ? " is-open" : ""}`} />
      </button>
      {open ? (
        <div className="help__body" id={`${panel}-body`}>
          {card.illustration ? <IllustrationCard id={card.illustration} zoom className="help__illu" /> : null}
          <div className="help__text">
            {card.text ? <p>{card.text}</p> : null}
            {card.steps.length > 0 ? (
              <ol className="help__steps">
                {card.steps.map((st, i) => (
                  <li key={i}>
                    <span className="help__no num" aria-hidden="true">
                      {String(st.marker).padStart(2, "0")}
                    </span>
                    <span>
                      {st.label ? <span className="label help__label">{st.label}</span> : null}
                      {st.title && st.title.toLowerCase() !== st.label.toLowerCase() ? <strong className="help__stitle"> {st.title}</strong> : null}
                      {st.text ? <span className="help__stext">{st.text}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
