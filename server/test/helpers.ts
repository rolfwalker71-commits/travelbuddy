import { createApp, type AppDeps } from "../src/app";
import { createUser } from "../src/auth/auth";
import { migrate, openDb, type Db } from "../src/db/client";

export type Call = (
  method: string,
  path: string,
  o?: { token?: string; json?: unknown; form?: FormData; headers?: Record<string, string> }
) => Promise<{ status: number; headers: Headers; body: any; raw: Response }>;

/** App mit Speicher-Datenbank und typischen Benutzern; `now` ist fest, Netzwerk und Geokodierung sind Fakes. */
export async function setup(
  opts: {
    users?: Array<{ username: string; password: string; displayName: string; isAdmin?: boolean }>;
    deps?: Partial<AppDeps>;
    now?: string;
  } = {}
) {
  const db: Db = openDb(":memory:");
  migrate(db);
  const users = opts.users ?? [
    { username: "anna", password: "anna-pw-123456", displayName: "Anna", isAdmin: true },
    { username: "ben", password: "ben-pw-1234567", displayName: "Ben" },
    { username: "cleo", password: "cleo-pw-123456", displayName: "Cleo" },
  ];
  for (const u of users) await createUser(db, u);
  const fetchCalls: string[] = [];
  const app = createApp({
    db,
    now: () => new Date(opts.now ?? "2026-10-10T08:00:00Z"),
    fetch: async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ date: "2026-10-09", rates: { CHF: 0.9312345, EUR: 1.07 } }) };
    },
    ...opts.deps,
  });
  const call: Call = async (method, path, o = {}) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.json !== undefined ? { "content-type": "application/json" } : {}),
        ...(o.headers ?? {}),
      },
      body: o.form ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined),
    });
    const ct = res.headers.get("content-type") ?? "";
    const clone = res.clone();
    let body: any = null;
    if (ct.includes("json")) body = await res.json();
    else if (ct.startsWith("text/")) body = await res.text();
    return { status: res.status, headers: res.headers, body, raw: clone };
  };
  const login = async (username: string, password: string) => {
    const r = await call("POST", "/v1/auth/login", { json: { username, password, platform: "ios" } });
    return r.body.token as string;
  };
  const tokens = {
    anna: () => login("anna", "anna-pw-123456"),
    ben: () => login("ben", "ben-pw-1234567"),
    cleo: () => login("cleo", "cleo-pw-123456"),
  };
  const userId = (username: string) => (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  return { db, app, call, login, tokens, userId, fetchCalls };
}

/** Minimales gültiges PDF (eine Seite). */
export function tinyPdf(extra = ""): Uint8Array {
  const body =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    `trailer<</Root 1 0 R/Size 4>>\n%${extra}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function pdfForm(name = "Buchung.pdf", extra = "", fields: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("file", new File([tinyPdf(extra) as BlobPart], name, { type: "application/pdf" }));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
