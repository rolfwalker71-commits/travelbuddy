import { useCallback, useEffect, useState } from "react";

/**
 * Breite eines Elements in px (ResizeObserver). Gibt eine Callback-Referenz zurück, damit die Messung auch dann
 * funktioniert, wenn das Element erst später gerendert wird.
 */
export function useContainerWidth<T extends HTMLElement>(initial = 600): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!el) return;
    const set = () => setWidth(Math.round(el.getBoundingClientRect().width));
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, width];
}
