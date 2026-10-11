import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconButton } from "./Button";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Mit Formular-Absenden (Enter in Feldern, Submit-Knopf). */
  onSubmit?: () => void;
  size?: "m" | "l" | "xl";
};

/** Dauer der Ein- und Ausblend-Animation; muss zu `--sheet-ms` im CSS passen. */
export const SHEET_MS = 300;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Sheet auf Basis von `<dialog>`: Fokusfalle, Esc, inerter Hintergrund kommen vom Browser.
 * Fliegt von rechts ein und blendet in 0,3 s wieder aus (auf dem Handy über die ganze Breite).
 */
export function Sheet({ open, onClose, title, description, children, footer, onSubmit, size = "m" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  const returnFocus = useRef<HTMLElement | null>(null);
  // Der Inhalt bleibt während der Ausblend-Animation sichtbar.
  const [shown, setShown] = useState(open);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      delete d.dataset.state;
      setShown(true);
      if (!d.open) {
        returnFocus.current = document.activeElement as HTMLElement | null;
        d.showModal();
        // React-`autoFocus` greift hier nicht (Dialog war beim Einhängen noch verborgen).
        d.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
      }
      return;
    }
    if (!d.open) {
      setShown(false);
      return;
    }
    if (reducedMotion()) {
      d.close();
      setShown(false);
      return;
    }
    d.dataset.state = "closing";
    const t = window.setTimeout(() => {
      d.close();
      delete d.dataset.state;
      setShown(false);
    }, SHEET_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  // Blenden Aufrufer das Sheet sofort aus (bedingtes Rendern), bleibt eine Kopie für die Ausblend-Animation stehen.
  useLayoutEffect(() => {
    const d = ref.current;
    return () => {
      if (!d || !d.open || reducedMotion()) return;
      const ghost = d.cloneNode(true) as HTMLDialogElement;
      ghost.removeAttribute("open");
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.dataset.state = "closing";
      // Eingebettete Dokumente würden neu laden (Blob-URL ist dann schon freigegeben).
      ghost.querySelectorAll("iframe, object, embed, video").forEach((el) => el.remove());
      document.body.appendChild(ghost);
      try {
        ghost.showModal();
      } catch {
        ghost.remove();
        return;
      }
      window.setTimeout(() => {
        if (ghost.open) ghost.close();
        ghost.remove();
      }, SHEET_MS);
    };
  }, []);

  // Fokus zurück an den Auslöser, auch wenn das Sheet samt Elternteil ausgehängt wird.
  useEffect(
    () => () => {
      const el = returnFocus.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    },
    []
  );

  const content = (
    <>
      <header className="sheet__head">
        <div className="sheet__grab" aria-hidden="true" />
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        <IconButton icon="x" label="Schliessen" onClick={onClose} />
      </header>
      <div className="sheet__body">
        {description ? (
          <p className="muted small sheet__desc" id={descId}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {footer ? <footer className="sheet__foot">{footer}</footer> : null}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`sheet sheet--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {shown || open ? (
        onSubmit ? (
          <form
            className="sheet__panel glass glass--strong"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {content}
          </form>
        ) : (
          <div className="sheet__panel glass glass--strong">{content}</div>
        )
      ) : null}
    </dialog>
  );
}
