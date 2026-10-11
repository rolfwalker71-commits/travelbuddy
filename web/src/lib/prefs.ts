/**
 * Anzeige-Einstellungen dieses Browsers (localStorage): KI-Bilder bei Ereignissen anzeigen oder ausblenden.
 * Eigene, hochgeladene Bilder bleiben immer sichtbar.
 */
import { useSyncExternalStore } from "react";

const KEY = "travelbuddy.showEventImages";
const EVENT = "travelbuddy:prefs";

export function readShowGeneratedEventImages(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setShowGeneratedEventImages(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* privates Fenster: gilt nur für diese Sitzung */
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

export function useShowGeneratedEventImages(): boolean {
  return useSyncExternalStore(subscribe, readShowGeneratedEventImages, () => true);
}

/** Soll das Ereignisbild gezeigt werden? Erzeugte nur, wenn die Einstellung es erlaubt. */
export function eventImageVisible(source: string | null | undefined, showGenerated: boolean): boolean {
  return source === "uploaded" || showGenerated;
}
