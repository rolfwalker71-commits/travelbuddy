/**
 * Geokodierung: Adresse → Koordinaten.
 *
 * - Apple Maps Server API, wenn ein MapKit-Schlüssel konfiguriert ist (`TRAVELBUDDY_MAPKIT_*`),
 * - sonst OpenStreetMap-Nominatim (höchstens 1 Anfrage/s, eigener User-Agent),
 * - Treffer und Fehlschläge werden in `geocode_cache` gemerkt.
 *
 * Alle Dienste sind über `Geocoder` austauschbar; Tests verwenden eine Fake-Implementierung, nie echtes Netz.
 */
import type { Db } from "../db/client";
import { mapkitToken, type MapkitConfig } from "../maps/mapkit";

export type GeocodeHit = {
  lat: number;
  lon: number;
  /** Aufgelöste Adresse bzw. Name des Treffers. */
  label: string;
  /** 0..1 */
  confidence: number;
  provider: string;
};

export interface Geocoder {
  readonly name: string;
  /** null = kein Treffer; wirft bei Netz-/Dienstfehlern (werden nicht gecacht). */
  geocode(query: string): Promise<GeocodeHit | null>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

/* ───────────── Nominatim ───────────── */

export class NominatimGeocoder implements Geocoder {
  readonly name = "nominatim";
  private chain: Promise<unknown> = Promise.resolve();
  private lastAt = 0;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly doFetch: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;

  constructor(
    private readonly opts: {
      userAgent: string;
      baseUrl?: string;
      /** Standard 1100 ms (Nutzungsbedingungen: höchstens 1 Anfrage/s). */
      minIntervalMs?: number;
      fetch?: FetchFn;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    }
  ) {
    this.baseUrl = (opts.baseUrl ?? "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
    this.doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = opts.now ?? (() => Date.now());
  }

  geocode(query: string): Promise<GeocodeHit | null> {
    const run = this.chain.then(async () => {
      const wait = this.lastAt + this.minIntervalMs - this.clock();
      if (wait > 0) await this.sleep(wait);
      this.lastAt = this.clock();
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("accept-language", "de");
      const res = await this.doFetch(url.toString(), {
        headers: { "User-Agent": this.opts.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Nominatim antwortete mit ${res.status}`);
      const rows = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string; importance?: number }>;
      const r = rows[0];
      if (!r) return null;
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        lat: round6(lat),
        lon: round6(lon),
        label: r.display_name ?? query,
        confidence: typeof r.importance === "number" ? Math.max(0, Math.min(1, r.importance)) : 0.5,
        provider: this.name,
      } satisfies GeocodeHit;
    });
    // Ein Fehler darf die Warteschlange nicht blockieren.
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/* ───────────── Apple Maps Server API ───────────── */

export class AppleMapsGeocoder implements Geocoder {
  readonly name = "apple";
  private access: { token: string; expiresAtMs: number } | null = null;
  private readonly doFetch: FetchFn;

  constructor(
    private readonly cfg: MapkitConfig,
    opts: { fetch?: FetchFn; now?: () => number; baseUrl?: string; language?: string } = {}
  ) {
    this.doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.clock = opts.now ?? (() => Date.now());
    this.baseUrl = (opts.baseUrl ?? "https://maps-api.apple.com").replace(/\/+$/, "");
    this.language = opts.language ?? "de-CH";
  }
  private readonly clock: () => number;
  private readonly baseUrl: string;
  private readonly language: string;

  private async accessToken(): Promise<string> {
    const nowMs = this.clock();
    if (this.access && this.access.expiresAtMs - 60_000 > nowMs) return this.access.token;
    // Maps-Token (JWT, ES256) gegen ein kurzlebiges Zugriffstoken tauschen.
    const jwt = mapkitToken({ ...this.cfg, origin: null }, Math.floor(nowMs / 1000), 10 * 60);
    const res = await this.doFetch(`${this.baseUrl}/v1/token`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Apple Maps: Token abgelehnt (${res.status})`);
    const body = (await res.json()) as { accessToken?: string; expiresInSeconds?: number };
    if (!body.accessToken) throw new Error("Apple Maps: kein Zugriffstoken erhalten");
    this.access = { token: body.accessToken, expiresAtMs: nowMs + (body.expiresInSeconds ?? 600) * 1000 };
    return body.accessToken;
  }

  async geocode(query: string): Promise<GeocodeHit | null> {
    const token = await this.accessToken();
    const url = new URL(`${this.baseUrl}/v1/geocode`);
    url.searchParams.set("q", query);
    url.searchParams.set("lang", this.language);
    const res = await this.doFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) this.access = null;
    if (!res.ok) throw new Error(`Apple Maps antwortete mit ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{
        coordinate?: { latitude?: number; longitude?: number };
        name?: string;
        formattedAddressLines?: string[];
      }>;
    };
    const r = body.results?.[0];
    const lat = r?.coordinate?.latitude;
    const lon = r?.coordinate?.longitude;
    if (!r || typeof lat !== "number" || typeof lon !== "number") return null;
    return {
      lat: round6(lat),
      lon: round6(lon),
      label: r.formattedAddressLines?.join(", ") || r.name || query,
      confidence: 0.9,
      provider: this.name,
    };
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/* ───────────── Zwischenspeicher und Rückfall ───────────── */

/** Negative Treffer werden einen Tag gemerkt, positive dauerhaft. */
const NEGATIVE_TTL_MS = 24 * 3_600_000;

export class CachingGeocoder implements Geocoder {
  constructor(
    private readonly db: Db,
    private readonly inner: Geocoder,
    private readonly now: () => number = () => Date.now()
  ) {}
  get name() {
    return this.inner.name;
  }

  async geocode(query: string): Promise<GeocodeHit | null> {
    const key = normalizeQuery(query);
    if (!key) return null;
    const hit = this.db.prepare("SELECT * FROM geocode_cache WHERE query_key = ?").get(key) as
      | { found: number; lat: number | null; lon: number | null; label: string | null; confidence: number | null; provider: string; created_at: string }
      | undefined;
    if (hit) {
      if (hit.found === 1 && hit.lat != null && hit.lon != null) {
        return { lat: hit.lat, lon: hit.lon, label: hit.label ?? query, confidence: hit.confidence ?? 0.5, provider: hit.provider };
      }
      if (this.now() - Date.parse(hit.created_at) < NEGATIVE_TTL_MS) return null;
    }
    const r = await this.inner.geocode(query);
    const ts = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO geocode_cache (query_key, provider, found, lat, lon, label, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(query_key) DO UPDATE SET provider = excluded.provider, found = excluded.found, lat = excluded.lat,
           lon = excluded.lon, label = excluded.label, confidence = excluded.confidence, created_at = excluded.created_at`
      )
      .run(key, this.inner.name, r ? 1 : 0, r?.lat ?? null, r?.lon ?? null, r?.label ?? null, r?.confidence ?? null, ts);
    return r;
  }
}

/** Probiert die Dienste der Reihe nach; ein Dienstfehler führt zum nächsten, «kein Treffer» ebenfalls. */
export class FallbackGeocoder implements Geocoder {
  constructor(private readonly chain: Geocoder[]) {}
  get name() {
    return this.chain.map((g) => g.name).join("+");
  }
  async geocode(query: string): Promise<GeocodeHit | null> {
    let lastError: unknown = null;
    for (const g of this.chain) {
      try {
        const r = await g.geocode(query);
        if (r) return r;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    return null;
  }
}

/** Dienste aus der Umgebung: Apple (mit Schlüssel) vor Nominatim; `TRAVELBUDDY_GEOCODER=off` schaltet ab. */
export function geocoderFromEnv(
  env: Record<string, string | undefined>,
  deps: { db: Db; mapkit: MapkitConfig | null; version: string; fetch?: FetchFn }
): Geocoder | null {
  const mode = (env.TRAVELBUDDY_GEOCODER ?? "auto").trim().toLowerCase();
  if (["off", "0", "false", "aus", "none"].includes(mode)) return null;
  const chain: Geocoder[] = [];
  if ((mode === "auto" || mode === "apple") && deps.mapkit) chain.push(new AppleMapsGeocoder(deps.mapkit, { fetch: deps.fetch }));
  if (mode === "auto" || mode === "nominatim") {
    const contact = env.TRAVELBUDDY_GEOCODER_CONTACT?.trim();
    chain.push(
      new NominatimGeocoder({
        userAgent: `TravelBuddy-Server/${deps.version}${contact ? ` (${contact})` : ""}`,
        baseUrl: env.TRAVELBUDDY_NOMINATIM_URL || undefined,
        fetch: deps.fetch,
      })
    );
  }
  if (!chain.length) return null;
  return new CachingGeocoder(deps.db, chain.length === 1 ? chain[0]! : new FallbackGeocoder(chain));
}
