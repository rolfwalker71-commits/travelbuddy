import type { ServerVersion } from "../api/types";
import { formatTimestamp } from "./dates";

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** Version und Build dieses Web-Clients (aus `/VERSION` und git per Vite-Define). */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const APP_BUILD: string = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "dev";

/** Hauptzahl einer SemVer-Version («0.1.0» → 0). */
export function majorOf(v: string): number | null {
  const m = /^(\d+)\./.exec(v.trim());
  return m ? Number(m[1]) : null;
}

/** Weichen Client und Server in der Hauptzahl ab? */
export function majorMismatch(app: string, server: string): boolean {
  const a = majorOf(app);
  const b = majorOf(server);
  return a !== null && b !== null && a !== b;
}

/** «TravelBuddy 0.1.0 (Build abc1234) · Server 0.1.0 · Stand 11.10.2026 14:30» */
export function versionLine(server: ServerVersion | null, app = { version: APP_VERSION, build: APP_BUILD }): string {
  const parts = [`TravelBuddy ${app.version} (Build ${app.build})`];
  if (server) {
    parts.push(`Server ${server.version}`);
    parts.push(`Stand ${formatTimestamp(server.builtAt)}`);
  } else {
    parts.push("Server nicht erreichbar");
  }
  return parts.join(" · ");
}
