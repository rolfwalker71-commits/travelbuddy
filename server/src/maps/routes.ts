import { Hono } from "hono";
import type { AppEnv } from "../app";
import { HttpError, forbidden } from "../lib/errors";
import type { Db } from "../db/client";
import { MAPKIT_TOKEN_TTL_SECONDS, mapkitToken, type MapkitConfig } from "./mapkit";
import { backfillCounts, type GeocodeBackfill } from "./backfill";

/**
 * `GET /v1/maps/token` → `{ token, expiresAt }` (JWT, 30 Minuten); ohne Schlüssel `404 maps_not_configured`
 * (die Web-App zeigt dann die schematische SVG-Route). Für jedes angemeldete Konto, auch Reiseteilnehmer.
 */
export function mapsRoutes(deps: { now: () => Date; config: MapkitConfig | null; db?: Db; backfill?: GeocodeBackfill | null }) {
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

  /**
   * Diagnose des Geokodierungs-Nachtrags (Admin): offen, aufgelöst, nicht gefunden, fehlgeschlagen.
   * Ohne laufenden Nachtrag (`enabled: false`) kommen die Zähler trotzdem aus der Datenbank.
   */
  r.get("/v1/maps/backfill", (c) => {
    if (!c.get("user").isAdmin) throw forbidden("Nur für Administratoren");
    c.header("cache-control", "no-store");
    if (deps.backfill) return c.json(deps.backfill.stats());
    const counts = deps.db ? backfillCounts(deps.db, deps.now()) : { open: 0, due: 0, resolved: 0, notFound: 0, failed: 0 };
    return c.json({ enabled: false, geocoder: null, running: false, lastRunAt: null, lastRun: null, ...counts });
  });
  return r;
}
