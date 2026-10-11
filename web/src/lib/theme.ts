/**
 * Darstellung: System (Standard), Hell «Papier» oder Dunkel «Nachtpapier». Die Wahl liegt im Browser
 * (localStorage) und setzt `data-theme` am `<html>`; die Farben stehen in styles/tokens.css.
 */
export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "travelbuddy.theme";
export const THEME_CHANGED = "travelbuddy:theme";

export const THEME_LABEL: Record<ThemePreference, string> = {
  dark: "Dunkel",
  light: "Hell",
  system: "System",
};

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "dark" || v === "light" || v === "system";
}

/** `system` folgt der Einstellung des Geräts; Hell, wenn sie unbekannt ist. */
export function resolveTheme(pref: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersLight ? "light" : "dark";
  return pref;
}

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersLight(): boolean {
  try {
    return !window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/** Farbe der Browserleiste (Handy), passend zum Hintergrund. */
const BAR_COLOR: Record<ResolvedTheme, string> = { dark: "#151412", light: "#ece5d7" };

export function applyTheme(pref: ThemePreference = readThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersLight());
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", BAR_COLOR[resolved]));
  return resolved;
}

export function setThemePreference(pref: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* Privates Fenster: gilt nur für diese Sitzung */
  }
  const r = applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: pref }));
  return r;
}

/** Beim Start aufrufen; folgt Änderungen der Geräteeinstellung, solange «System» gewählt ist. */
export function initTheme(): void {
  applyTheme();
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePreference() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
  } catch {
    /* ältere Browser: kein Live-Wechsel */
  }
}
