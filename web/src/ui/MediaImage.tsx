import { useEffect, useRef, useState } from "react";
import { isMediaPath, loadMedia, peekMedia } from "../lib/media";
import { Icon, type IconName } from "./Icon";

type Props = {
  /** `/v1/media/<art>/<id>?v=…` aus der API; `null`/`undefined` (auch bei Gästen) ergibt den Platzhalter. */
  src: string | null | undefined;
  /** Leer lassen, wenn das Bild nur schmückt. */
  alt?: string;
  /** Form und Grösse: `icon` (44 px), `thumb` (64 px), `cover` (Banner), `map`, `full` (grosse Ansicht in natürlichem Seitenverhältnis). */
  variant?: "icon" | "thumb" | "cover" | "map" | "full";
  fallback?: IconName;
  className?: string;
  /** Erst laden, wenn das Bild in die Nähe des sichtbaren Bereichs kommt. */
  lazy?: boolean;
  /** Klick-Aktion (z. B. grosse Ansicht); macht das Bild zu einer Schaltfläche. */
  onOpen?: () => void;
  openLabel?: string;
};

/**
 * Bild aus `/v1/media/…`: lädt mit Bearer-Header (ein `<img src>` kann keinen senden), merkt das Ergebnis je URL
 * (inkl. `?v=`) und zeigt bei fehlendem Bild oder Fehler ein Platzhalter-Symbol.
 */
export function MediaImage({ src, alt = "", variant = "icon", fallback = "photo", className, lazy = true, onOpen, openLabel }: Props) {
  const valid = typeof src === "string" && isMediaPath(src) ? src : null;
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(!lazy || typeof IntersectionObserver === "undefined");
  const [blob, setBlob] = useState<Blob | null | undefined>(() => (valid ? peekMedia(valid) : null));
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (near || !valid) return;
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, valid]);

  useEffect(() => {
    if (!valid) {
      setBlob(null);
      return;
    }
    const known = peekMedia(valid);
    setBlob(known);
    if (known !== undefined || !near) return;
    let alive = true;
    void loadMedia(valid).then((b) => {
      if (alive) setBlob(b);
    });
    return () => {
      alive = false;
    };
  }, [valid, near]);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const loading = valid !== null && blob === undefined;
  const cls = `media media--${variant}${loading ? " media--loading" : ""}${className ? ` ${className}` : ""}`;
  const inner = url ? (
    <img src={url} alt={alt} decoding="async" draggable={false} />
  ) : (
    <Icon name={fallback} size={variant === "icon" ? 20 : variant === "thumb" ? 24 : 32} />
  );

  if (onOpen && url) {
    return (
      <button type="button" className={`${cls} media--button`} onClick={onOpen} aria-label={openLabel ?? (alt || "Bild vergrössern")}>
        <img src={url} alt="" decoding="async" draggable={false} />
      </button>
    );
  }
  return (
    <span ref={box} className={cls} aria-hidden={url && alt ? undefined : true}>
      {inner}
    </span>
  );
}
