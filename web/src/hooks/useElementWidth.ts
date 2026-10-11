import { useEffect, useRef, useState } from "react";

/** Breite eines Elements in Pixeln (für Diagramme, die sich der Spalte anpassen). */
export function useElementWidth<T extends HTMLElement>(initial = 600): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
