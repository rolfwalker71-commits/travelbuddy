/** Dünner fetch-Wrapper für die `/v1`-API: Bearer-Token, Fehlerform `{error:{code,message}}`. */

const TOKEN_KEY = "travelbuddy.token";

export type FieldIssue = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Bei 422: betroffene Felder (`error.details.fields`). */
    public readonly fields: FieldIssue[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Nur in Entwicklung und Tests: Fixture-Mocks fangen `/v1`-Anfragen ab (siehe `src/mocks/`).
 * Gibt der Hook `null` zurück, geht die Anfrage an den echten Server.
 */
export type FetchHook = (path: string, init: RequestInit) => Promise<Response | null>;
let fetchHook: FetchHook | null = null;
export function setFetchHook(h: FetchHook | null): void {
  fetchHook = h;
}
async function doFetch(path: string, init: RequestInit): Promise<Response> {
  if (fetchHook) {
    const r = await fetchHook(path, init);
    if (r) return r;
  }
  return fetch(path, init);
}

type ErrorBody = { error?: { code?: string; message?: string; details?: { fields?: FieldIssue[] } } };

function toApiError(status: number, body: ErrorBody | null, fallback: string): ApiError {
  const e = body?.error;
  const fields = Array.isArray(e?.details?.fields)
    ? e!.details!.fields!.filter((f) => typeof f?.field === "string" && typeof f?.message === "string")
    : [];
  return new ApiError(status, e?.code ?? `http_${status}`, e?.message ?? fallback, fields);
}

/* ─ Token-Ablage: localStorage («angemeldet bleiben») oder sessionStorage ─ */

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const tokenStore = {
  get(): string | null {
    return safe(() => sessionStorage.getItem(TOKEN_KEY), null) ?? safe(() => localStorage.getItem(TOKEN_KEY), null);
  },
  set(token: string, remember: boolean): void {
    tokenStore.clear();
    safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token), undefined);
  },
  clear(): void {
    safe(() => sessionStorage.removeItem(TOKEN_KEY), undefined);
    safe(() => localStorage.removeItem(TOKEN_KEY), undefined);
  },
};

/** Wird bei 401 einer angemeldeten Anfrage aufgerufen (Token löschen, zur Anmeldung). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** Für Aufrufe ausserhalb von `api()`/`apiBlob()` (Upload mit Fortschritt, Blob-Antworten auf POST). */
export function reportUnauthorized(): void {
  onUnauthorized?.();
}

export { toApiError };

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Ohne Bearer-Header senden (öffentliche Gast-Routen, Login). */
  anonymous?: boolean;
  signal?: AbortSignal;
};

async function raw(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = opts.anonymous ? null : tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await doFetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen.");
  }
  if (!res.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* kein JSON-Body */
    }
    const err = toApiError(res.status, body, `Anfrage fehlgeschlagen (${res.status})`);
    if (res.status === 401 && !opts.anonymous && err.code !== "invalid_credentials") onUnauthorized?.();
    throw err;
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await raw(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Datei mit Bearer-Header laden (Vorschaubild, PDF, ICS). */
export async function apiBlob(path: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string | null }> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await doFetch(path, { headers, signal, cache: "no-store" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Keine Verbindung zum Server.");
  }
  if (!res.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* kein JSON-Body */
    }
    const err = toApiError(res.status, body, `Datei nicht verfügbar (${res.status})`);
    if (res.status === 401) onUnauthorized?.();
    throw err;
  }
  return {
    blob: await res.blob(),
    filename: filenameFromContentDisposition(res.headers.get("content-disposition")),
  };
}

/** `filename*=UTF-8''…` (RFC 5987) hat Vorrang vor `filename="…"`. */
export function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim());
    } catch {
      /* ungültig kodiert: Fallback */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain ? plain[1]!.trim() : null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Unbekannter Fehler";
}

/* ─ Upload mit Fortschritt ─ */

export type UploadProgress = (loaded: number, total: number) => void;

/**
 * `multipart/form-data` mit Fortschritt (XMLHttpRequest, `fetch` meldet keinen Upload-Fortschritt).
 * Antwort ist das JSON des Servers; Fehler werden wie bei `api()` als `ApiError` geworfen.
 */
export function apiUpload<T>(
  path: string,
  form: FormData,
  opts: { onProgress?: UploadProgress; signal?: AbortSignal } = {}
): Promise<T> {
  if (fetchHook) {
    // Mocks: kein XHR; Fortschritt wird simuliert.
    return (async () => {
      const total = [...form.values()].reduce<number>((n, v) => n + (v instanceof Blob ? v.size : 0), 0) || 1;
      for (const f of [0.2, 0.6, 1]) {
        opts.onProgress?.(Math.round(total * f), total);
        await new Promise((r) => setTimeout(r, 120));
      }
      const token = tokenStore.get();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await doFetch(path, { method: "POST", headers, body: form });
      if (!res.ok) {
        let body: ErrorBody | null = null;
        try {
          body = (await res.json()) as ErrorBody;
        } catch {
          /* kein JSON */
        }
        throw toApiError(res.status, body, `Upload fehlgeschlagen (${res.status})`);
      }
      return (await res.json()) as T;
    })();
  }
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Accept", "application/json");
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen."));
    xhr.onabort = () => reject(new DOMException("Abgebrochen", "AbortError"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* kein JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const err = toApiError(xhr.status, body as ErrorBody | null, `Upload fehlgeschlagen (${xhr.status})`);
      if (xhr.status === 401) onUnauthorized?.();
      reject(err);
    };
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
