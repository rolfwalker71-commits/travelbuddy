import { ApiError, apiBlob } from "../api/client";

/** Kleiner LRU-Speicher: der zuletzt benutzte Eintrag bleibt, der am längsten ungenutzte fliegt raus. */
export class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** Nur Pfade unter `/v1/media/` werden als Medien geladen (nie fremde Adressen mit dem Token). */
export function isMediaPath(src: string): boolean {
  return /^\/v1\/media\/[a-z_]+\/\d+(\?[A-Za-z0-9=&_-]*)?$/.test(src);
}

/** Höchstens so viele Bilder gleichzeitig laden, damit Listen die Verbindung nicht fluten. */
const MAX_PARALLEL = 6;
let active = 0;
const waiting: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Blobs je URL inkl. `?v=`; `null` heisst «kein Bild» (404/403), Netzwerkfehler werden nicht gemerkt. */
const blobs = new Lru<Promise<Blob | null>>(300);
const settled = new Lru<Blob | null>(300);

/** Bereits geladenes Ergebnis ohne Netzwerk: `undefined` = noch unbekannt. */
export function peekMedia(src: string): Blob | null | undefined {
  return settled.peek(src);
}

export function loadMedia(src: string): Promise<Blob | null> {
  const hit = blobs.get(src);
  if (hit) return hit;
  const p = slot(() => apiBlob(src))
    .then(({ blob }) => {
      const ok = blob.type.startsWith("image/") ? blob : null;
      settled.set(src, ok);
      return ok;
    })
    .catch((e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        settled.set(src, null);
        return null;
      }
      blobs.delete(src);
      settled.delete(src);
      return null;
    });
  blobs.set(src, p);
  return p;
}
