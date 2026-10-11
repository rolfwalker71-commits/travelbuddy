/**
 * Schaltet die Fixture-Mocks ein (nur Entwicklung und Tests; main.tsx lädt dieses Modul nur bei `import.meta.env.DEV`).
 *
 * Umschalter:
 *   - URL `?mock=1` schaltet ein und merkt es sich (localStorage `travelbuddy.mocks`), `?mock=0` schaltet aus.
 *   - `VITE_MOCKS=1 npm run dev` startet mit Mocks.
 * Die Anmeldung akzeptiert mit Mocks jedes nicht leere Passwort.
 */
import { setFetchHook } from "../api/client";
import { todayIso } from "../lib/dates";
import { MockServer } from "./server";

const KEY = "travelbuddy.mocks";

export function mocksEnabled(): boolean {
  try {
    const p = new URLSearchParams(window.location.search).get("mock");
    if (p === "1") localStorage.setItem(KEY, "1");
    if (p === "0") localStorage.removeItem(KEY);
    if (localStorage.getItem(KEY) === "1") return true;
  } catch {
    /* kein Speicher */
  }
  return import.meta.env.VITE_MOCKS === "1";
}

/** Dev-Hilfen für Screenshots und Tests: `?autologin=1` setzt ein Mock-Token, `?theme=dark|light|system` die Darstellung. */
function applyDevParams(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("autologin") === "1") localStorage.setItem("travelbuddy.token", "tb_mock_token");
    const t = p.get("theme");
    if (t === "dark" || t === "light" || t === "system") localStorage.setItem("travelbuddy.theme", t);
  } catch {
    /* kein Speicher */
  }
}

export function installMocksIfEnabled(): void {
  if (!mocksEnabled()) return;
  applyDevParams();
  const server = new MockServer(todayIso());
  (window as unknown as { __tbMock?: MockServer }).__tbMock = server;
  setFetchHook(async (path, init) => {
    if (!path.startsWith("/v1/")) return null;
    const url = new URL(path, window.location.origin);
    const method = (init.method ?? "GET").toUpperCase();
    let json: unknown = null;
    let form: FormData | null = null;
    if (init.body instanceof FormData) form = init.body;
    else if (typeof init.body === "string") {
      try {
        json = JSON.parse(init.body);
      } catch {
        json = null;
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    const reply = await server.handle(method, url, json, form);
    if (!reply) return null;
    const headers = new Headers();
    if (reply.body !== undefined) {
      headers.set("content-type", reply.type ?? "application/octet-stream");
      return new Response(reply.body, { status: reply.status, headers });
    }
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(reply.json ?? null), { status: reply.status, headers });
  });
  showBadge();
}

function showBadge(): void {
  const el = document.createElement("div");
  el.textContent = "Mock-Daten";
  el.setAttribute("data-mock-badge", "");
  el.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:9999;font:600 11px/1 'IBM Plex Mono',monospace;padding:4px 8px;border-radius:6px;background:#1d1b18;color:#ffb347;opacity:.85;pointer-events:none";
  document.body.appendChild(el);
}
