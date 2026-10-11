import fs from "node:fs";
import path from "node:path";
import type { Context, MiddlewareHandler } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Sicherheits-Header für die Web-Oberfläche. `no-referrer` ist wichtig: Gäste-Links
 * enthalten ihr Token in der URL und dürfen nirgends als Referer landen.
 */
export function webSecurityHeaders(opts: { mapkit?: boolean } = {}): Record<string, string> {
  // Apple Karten (MapKit JS): Skript vom Apple-CDN, Kacheln und Dienste von *.apple-mapkit.com / *.apple.com,
  // Worker als blob:. Nur freigeschaltet, wenn MapKit konfiguriert ist.
  const m = opts.mapkit;
  const apple = "https://*.apple-mapkit.com https://*.apple.com";
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self'${m ? " https://cdn.apple-mapkit.com" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob:${m ? ` ${apple}` : ""}`,
      "font-src 'self'",
      `connect-src 'self'${m ? ` ${apple}` : ""}`,
      "frame-src 'self' blob:",
      "object-src 'self' blob:",
      ...(m ? ["worker-src 'self' blob:", "child-src 'self' blob:"] : []),
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    // Standort bleibt gesperrt; Karten brauchen ihn nicht.
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

export const WEB_SECURITY_HEADERS: Record<string, string> = webSecurityHeaders();

/** Erster vorhandener Ordner mit index.html, sonst null. */
export function findWebDir(candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "index.html"))) return path.resolve(c);
  }
  return null;
}

/**
 * Statische SPA-Auslieferung. API-Pfade (`/v1`, `/healthz`) werden nie berührt, unbekannte
 * Pfade fallen auf `index.html` zurück (Client-Routing). Dateien unter `/assets/` sind
 * inhalts-gehasht und dürfen lange gecacht werden.
 */
export function spaStatic(root: string, opts: { mapkit?: boolean } = {}): MiddlewareHandler {
  const base = path.resolve(root);
  const securityHeaders = webSecurityHeaders(opts);

  const send = (c: Context, file: string, immutable: boolean) => {
    const ext = path.extname(file).toLowerCase();
    const body = fs.readFileSync(file);
    const headers = new Headers({
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ...securityHeaders,
    });
    return new Response(c.req.method === "HEAD" ? null : body, { status: 200, headers });
  };

  return async (c, next) => {
    const method = c.req.method;
    const pathname = decodeURIComponentSafe(new URL(c.req.url).pathname);
    if (
      (method !== "GET" && method !== "HEAD") ||
      pathname === null ||
      pathname === "/healthz" ||
      pathname === "/v1" ||
      pathname.startsWith("/v1/")
    ) {
      return next();
    }

    const rel = pathname.replace(/^\/+/, "");
    if (rel) {
      const candidate = path.resolve(base, rel);
      // Kein Ausbrechen aus dem Web-Ordner (../, absolute Pfade, Symlink-Tricks)
      if (candidate.startsWith(base + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const real = fs.realpathSync(candidate);
        if (real.startsWith(fs.realpathSync(base) + path.sep)) {
          return send(c, real, rel.startsWith("assets/"));
        }
      }
      // Anfragen nach Dateien (mit Endung), die es nicht gibt, sind echte 404, kein SPA-Pfad.
      if (path.extname(rel)) return next();
    }
    return send(c, path.join(base, "index.html"), false);
  };
}

function decodeURIComponentSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
