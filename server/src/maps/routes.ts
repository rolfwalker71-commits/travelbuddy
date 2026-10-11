import { Hono } from "hono";
import type { AppEnv } from "../app";
import { HttpError } from "../lib/errors";
import { MAPKIT_TOKEN_TTL_SECONDS, mapkitToken, type MapkitConfig } from "./mapkit";

/**
 * `GET /v1/maps/token` → `{ token, expiresAt }` (JWT, 30 Minuten); ohne Schlüssel `404 maps_not_configured`
 * (die Web-App zeigt dann die schematische SVG-Route). Für jedes angemeldete Konto, auch Reiseteilnehmer.
 */
export function mapsRoutes(deps: { now: () => Date; config: MapkitConfig | null }) {
  const r = new Hono<AppEnv>();
  r.get("/v1/maps/token", (c) => {
    c.header("cache-control", "no-store");
    if (!deps.config) throw new HttpError(404, "maps_not_configured", "Apple Karten sind nicht eingerichtet");
    const nowSec = Math.floor(deps.now().getTime() / 1000);
    return c.json({
      token: mapkitToken(deps.config, nowSec),
      expiresAt: new Date((nowSec + MAPKIT_TOKEN_TTL_SECONDS) * 1000).toISOString(),
    });
  });
  return r;
}
