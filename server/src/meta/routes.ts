import { Hono } from "hono";
import tzlookup from "tz-lookup";
import type { AppEnv } from "../app";
import { badRequest } from "../lib/errors";
import { getCatalog } from "../catalog/catalog";
import { searchAirports } from "./airports";

/** Zeitzone für Koordinaten (IANA) oder null. */
export function timezoneFor(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  try {
    return tzlookup(lat, lon);
  } catch {
    return null;
  }
}

/** Öffentlich: der Katalog (kein Geheimnis; Gäste-Links brauchen Beschriftungen, Symbole und Farben). */
export function publicMetaRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/v1/meta/event-types", (c) => {
    const cat = getCatalog();
    const etag = `"${Buffer.from(cat.raw).length.toString(16)}-${simpleHash(cat.raw)}"`;
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(cat.raw, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache", etag },
    });
  });
  return r;
}

/** Mit Anmeldung: Flughafensuche und Zeitzonen-Vorschlag. */
export function authedMetaRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/v1/meta/airports", (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) throw badRequest("q (Suchbegriff) erforderlich");
    const limit = Number(c.req.query("limit") ?? 20);
    return c.json({ airports: searchAirports(q, Number.isFinite(limit) ? limit : 20) });
  });
  r.get("/v1/meta/timezone", (c) => {
    const lat = Number(c.req.query("lat"));
    const lon = Number(c.req.query("lon"));
    if (c.req.query("lat") == null || c.req.query("lon") == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw badRequest("lat und lon erforderlich");
    }
    const tz = timezoneFor(lat, lon);
    if (!tz) throw badRequest("Ungültige Koordinaten", "invalid_coordinates");
    return c.json({ tz });
  });
  return r;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
