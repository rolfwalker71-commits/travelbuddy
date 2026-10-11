import type { MiddlewareHandler } from "hono";

/**
 * Pfad fürs Protokoll: Einladungs-Tokens (Gäste-Links) gehören nicht in Logdateien,
 * Query-Strings (Suchbegriffe) ebenfalls nicht.
 */
export function maskPath(pathname: string): string {
  return pathname
    .replace(/^\/v1\/guest\/trips\/[^/]+/, "/v1/guest/trips/:token")
    .replace(/^\/v1\/guest\/(?!trips\/)[^/]+/, "/v1/guest/:token")
    .replace(/^\/(g|t)\/[^/]+/, "/$1/:token")
    .replace(/^\/share\/(f|t)\/[^/]+/, "/share/$1/:token");
}

export function accessLog(write: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const path = new URL(c.req.url).pathname;
    if (path === "/healthz") return;
    const ms = Math.round(performance.now() - started);
    write(`${new Date().toISOString()} ${c.req.method} ${maskPath(path)} ${c.res.status} ${ms}ms`);
  };
}
