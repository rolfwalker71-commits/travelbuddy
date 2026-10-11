import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/client";
import {
  authenticate,
  LoginThrottle,
  revokeToken,
  issueToken,
  verifyPassword,
  changePassword,
  createUser,
  type AuthUser,
} from "./auth/auth";
import { HttpError, badRequest, forbidden } from "./lib/errors";
import { bodyLimit } from "hono/body-limit";
import { parseWith, readJson } from "./lib/validate";
import * as L from "./ledgers/service";
import { fetchEcbRate, type FetchLike } from "./ledgers/fx";
import { createBackground, type Background } from "./lib/background";
import { tripRoutes } from "./trips/routes";
import { todayView, summaryView } from "./trips/today";
import {
  Notifier,
  getPrefs,
  setDeviceToken,
  setPrefs,
  PREF_KEYS,
} from "./push/notifier";
import type { PushTransport } from "./push/apns";
import { formatMoney } from "./lib/money";
import { setTripsForUser, tripAssignmentsForUser, assertTripAccess } from "./trips/service";
import { mediaRoutes } from "./media/routes";
import { MediaService, type ImageGenerator } from "./media/generate";
import type { ModuleDeps } from "./lib/module-deps";
import { spaStatic } from "./web/static";
import { mapsRoutes } from "./maps/routes";
import type { MapkitConfig } from "./maps/mapkit";
import { CURRENCIES } from "./lib/currencies";
import { nonAdminMayCall, participantAccess } from "./auth/roles";
import { NotificationScheduler } from "./notifications/scheduler";
import { notificationRoutes } from "./notifications/routes";
import { accessLog } from "./lib/accessLog";
import { versionInfo } from "./lib/version";
import { authedMetaRoutes, publicMetaRoutes } from "./meta/routes";
import type { Geocoder } from "./geo/geocode";
import { documentRoutes, isUploadPath } from "./ingest/routes";
import { NoopAnalyzer, type DocumentAnalyzer } from "./ingest/analyzer";
import { MAX_UPLOAD_BYTES } from "./ingest/sniff";

export type AppEnv = { Variables: { user: AuthUser } };

export type AppDeps = {
  db: Db;
  /** Für Tests ersetzbar. */
  fetch?: FetchLike;
  /** Sperre pro Benutzername (streng) und pro IP (grosszügiger, wegen gemeinsamer Netze). */
  throttle?: LoginThrottle;
  ipThrottle?: LoginThrottle;
  background?: Background;
  now?: () => Date;
  /** APNs-Transport; ohne ihn werden Benachrichtigungen protokolliert, aber nicht gesendet. */
  push?: PushTransport | null;
  notifier?: Notifier;
  /** Ordner mit dem gebauten Web-Client (index.html). Ohne: nur die API. */
  webDir?: string | null;
  /** Zugriffsprotokoll (eine Zeile je Anfrage, Tokens maskiert). Ohne: kein Protokoll. */
  log?: (line: string) => void;
  /** Ordner für Bilder (Standard: `media/` neben der Datenbank). */
  mediaDir?: string;
  /** KI-Bilderzeugung; null/weggelassen = nicht aktiv. Im Test durch einen Fake ersetzbar. */
  images?: ImageGenerator | null;
  /** Höchstzahl erzeugter Bilder je Wartungslauf (Standard 5). */
  imagesPerRun?: number;
  /** Apple Karten (MapKit JS); null/weggelassen = `404 maps_not_configured`, die Web-App zeigt die SVG-Route. */
  mapkit?: MapkitConfig | null;
  /** Ordner der Dokumentablage (Standard: `documents/` neben der Datenbank, im Test ein Temp-Ordner). */
  documentsDir?: string;
  /** Dokumentanalyse; Standard: `NoopAnalyzer` (setzt «übersprungen»). Eine spätere Welle ersetzt ihn. */
  analyzer?: DocumentAnalyzer;
  /** Geokodierung (Apple Maps Server API / Nominatim); null/weggelassen = nicht aktiv, in Tests ein Fake. */
  geocoder?: Geocoder | null;
  /** Mitteilungs-Scheduler (Mitteilungen, Live Activities); Standard: eigener, nicht gestarteter (Diagnose, Simulation). */
  scheduler?: NotificationScheduler;
  /** Ordner `shared/illustrations` (Mitteilungsbilder); Standard: `TRAVELBUDDY_ILLUSTRATIONS_DIR`, dann Repo-Pfade. */
  illustrationsDir?: string | null;
};

/* ───────────── Schemas ───────────── */

const id = z.coerce.number().int().positive();
const minor = z.number().int().safe();
const currency = z
  .string()
  .trim()
  .length(3)
  .transform((s) => s.toUpperCase());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "erwartet YYYY-MM-DD");

const splitSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("equal"), memberIds: z.array(id).optional() }),
  z.object({ mode: z.literal("coupleEqual"), coupleIds: z.array(id).optional() }),
  z.object({
    mode: z.literal("exact"),
    amounts: z.array(z.object({ memberId: id, amountBaseMinor: minor })).min(1),
  }),
  z.object({
    mode: z.literal("shares"),
    shares: z.array(z.object({ memberId: id, units: z.number().positive() })).min(1),
  }),
]);

const placeSchema = z
  .object({
    name: z.string().nullish(),
    lat: z.number().min(-90).max(90).nullish(),
    lon: z.number().min(-180).max(180).nullish(),
  })
  .nullable();

const expenseCreate = z.object({
  paidByMemberId: id.optional(),
  amountMinor: minor,
  currency,
  exchangeRate: z.number().positive().optional(),
  direction: z.enum(["expense", "income"]).optional(),
  description: z.string().max(500).nullish(),
  expenseDate: isoDate.nullish(),
  category: z.string().max(100).nullish(),
  note: z.string().max(4000).nullish(),
  documentId: id.nullish(),
  tripEventId: id.nullish(),
  place: placeSchema.optional(),
  split: splitSchema.optional(),
  preSettled: z.boolean().optional(),
});
const expensePatch = expenseCreate.omit({ preSettled: true }).partial();

const settlementCreate = z.object({
  fromMemberId: id,
  toMemberId: id,
  amountMinor: minor,
  currency: currency.optional(),
  exchangeRate: z.number().positive().optional(),
  note: z.string().max(500).nullish(),
  settledAt: isoDate.nullish(),
});

/* ───────────── Helfer ───────────── */

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return parseWith(await readJson(c.req), schema);
}

function param(c: Context, name: string): number {
  const v = id.safeParse(c.req.param(name));
  if (!v.success) throw badRequest(`Ungültiger Parameter ${name}`);
  return v.data;
}

/** Ordner neben der Datenbank (`media/`, `documents/`), im Test (`:memory:`) ein Temp-Ordner. */
function resolveSiblingDir(db: Db, name: string, explicit?: string): string {
  if (explicit) return explicit;
  const file = db.name;
  if (!file || file === ":memory:" || file === "") {
    return fs.mkdtempSync(path.join(os.tmpdir(), `travelbuddy-${name}-`));
  }
  return path.join(path.dirname(path.resolve(file)), name);
}

/* ───────────── App ───────────── */

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const throttle = deps.throttle ?? new LoginThrottle();
  const ipThrottle = deps.ipThrottle ?? new LoginThrottle(40);
  const app = new Hono<AppEnv>();
  const background = deps.background ?? createBackground();
  const clock = deps.now ?? (() => new Date());
  const notifier = deps.notifier ?? new Notifier(db, deps.push ?? null, clock);
  const scheduler = deps.scheduler ?? new NotificationScheduler({ db, notifier, transport: deps.push ?? null, now: clock });
  const mediaDir = resolveSiblingDir(db, "media", deps.mediaDir);
  const documentsDir = resolveSiblingDir(db, "documents", deps.documentsDir);
  const media = new MediaService({
    db, mediaDir, images: deps.images ?? null, now: clock, background, perRun: deps.imagesPerRun,
  });
  const analyzer = deps.analyzer ?? new NoopAnalyzer(db, clock);
  const docs = documentRoutes({ db, documentsDir, analyzer, background, now: clock });
  const trips = tripRoutes({ db, now: clock, notifier, background, media, geocoder: deps.geocoder ?? null, fetch: deps.fetch });

  /** Benachrichtigungen laufen im Hintergrund und dürfen eine Anfrage nie scheitern lassen. */
  const notifyExpense = (ledgerId: number, expenseId: number, actor: { userId: number | null; name: string }) => {
    const ledger = L.getLedger(db, ledgerId);
    const ex = L.getExpense(db, ledgerId, expenseId);
    if (ex.direction !== "expense") return;
    background.run(
      notifier.expenseCreated({
        ledgerId,
        expenseId,
        actorUserId: actor.userId,
        actorName: actor.name,
        amountLabel: formatMoney(ex.amountBaseMinor, ledger.base_currency),
        description: ex.description,
      })
    );
  };
  const notifySettlement = (ledgerId: number, settlementId: number, actor: { userId: number | null }) => {
    const ledger = L.getLedger(db, ledgerId);
    const s = L.listSettlements(db, ledgerId).find((x) => x.id === settlementId);
    if (!s || s.auto) return;
    const names = new Map(
      (
        db.prepare("SELECT id, display_name, user_id FROM participants WHERE ledger_id = ?").all(ledgerId) as Array<{
          id: number;
          display_name: string;
          user_id: number | null;
        }>
      ).map((m) => [m.id, m])
    );
    background.run(
      notifier.settlementCreated({
        ledgerId,
        settlementId,
        actorUserId: actor.userId,
        fromName: names.get(s.fromMemberId)?.display_name ?? "Jemand",
        toName: names.get(s.toMemberId)?.display_name ?? "",
        toUserId: names.get(s.toMemberId)?.user_id ?? null,
        amountLabel: formatMoney(s.amountBaseMinor, ledger.base_currency),
      })
    );
  };

  if (deps.log) app.use("*", accessLog(deps.log));
  if (deps.webDir) app.use("*", spaStatic(deps.webDir, { mapkit: Boolean(deps.mapkit) }));

  // JSON-Anfragen sind klein; alles Grössere ist ein Fehler oder Missbrauch.
  // Ausnahme: Datei-Uploads (Dokumente), die eine eigene, höhere Grenze haben (25 MB plus Multipart-Rahmen).
  const jsonLimit = bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: { code: "payload_too_large", message: "Anfrage zu gross" } }, 413),
  });
  const uploadLimit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES + 1024 * 1024,
    onError: (c) => c.json({ error: { code: "payload_too_large", message: "Die Datei ist grösser als 25 MB" } }, 413),
  });
  app.use("/v1/*", (c, next) =>
    isUploadPath(c.req.method, c.req.path) ? uploadLimit(c, next) : jsonLimit(c, next)
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
        err.status
      );
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Interner Fehler" } }, 500);
  });
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Route nicht gefunden" } }, 404)
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  /** Öffentlich: Name, Version, Build, Zeitpunkt, API-Stand (Einstellungen in Web und Apple-Apps). */
  const version = versionInfo();
  app.get("/v1/version", (c) => {
    c.header("cache-control", "no-cache");
    return c.json(version);
  });

  /** Öffentlich: der Ereignis-Katalog (Gäste-Links brauchen Beschriftungen, Symbole, Farben). */
  app.route("/", publicMetaRoutes());

  /* ─ Auth (Login ist öffentlich) ─ */
  app.post("/v1/auth/login", async (c) => {
    const input = await body(
      c,
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        deviceName: z.string().max(100).optional(),
        platform: z.enum(["ios", "ipados", "macos", "visionos", "web"]).optional(),
      })
    );
    const userKey = `u:${input.username.trim().toLowerCase()}`;
    const ipKey = `ip:${(c.req.header("x-forwarded-for") ?? "local").split(",")[0]!.trim()}`;
    throttle.check(userKey);
    ipThrottle.check(ipKey);
    const row = db
      .prepare(
        "SELECT id, password_hash FROM users WHERE username = ? AND active = 1"
      )
      .get(input.username.trim()) as { id: number; password_hash: string } | undefined;
    // Auch bei unbekanntem Benutzer rechnen, damit die Antwortzeit nicht verrät, ob er existiert.
    const ok = await verifyPassword(
      input.password,
      row?.password_hash ?? "scrypt:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:AAAA"
    );
    if (!row || !ok) {
      throttle.fail(userKey);
      ipThrottle.fail(ipKey);
      throw new HttpError(401, "invalid_credentials", "Benutzername oder Passwort falsch");
    }
    throttle.success(userKey);
    const token = issueToken(db, row.id, { deviceName: input.deviceName, platform: input.platform });
    const user = authenticate(db, token)!;
    return c.json({ token, user: publicUser(user) });
  });

  /* ─ Gäste: Zugriff mit Einladungs-Token, ohne Konto ─ */
  const guestState = (token: string) => {
    const { member, ledger } = L.resolveGuest(db, token);
    return {
      me: { memberId: member.id, displayName: member.display_name },
      ...L.ledgerOverview(db, ledger.id),
      expenses: L.listExpenses(db, ledger.id),
      settlements: L.listSettlements(db, ledger.id),
    };
  };

  app.get("/v1/guest/:token", (c) => c.json(guestState(c.req.param("token"))));

  app.post("/v1/guest/:token/expenses", async (c) => {
    const { member, ledger } = L.resolveGuest(db, c.req.param("token"));
    L.assertWritable(ledger);
    const input = await body(c, expenseCreate);
    const row = L.createExpense(db, ledger.id, { ...input, createdByMemberId: member.id });
    notifyExpense(ledger.id, row.id, { userId: member.user_id, name: member.display_name });
    return c.json({ expense: L.getExpense(db, ledger.id, row.id) }, 201);
  });

  /** Gäste dürfen nur eigene Buchungen ändern oder löschen. */
  const guestOwnExpense = (ledgerId: number, expenseId: number, memberId: number) => {
    const ex = L.getExpense(db, ledgerId, expenseId);
    if (ex.createdByMemberId !== memberId) {
      throw forbidden("Nur eigene Ausgaben können geändert werden");
    }
  };

  app.patch("/v1/guest/:token/expenses/:expenseId", async (c) => {
    const { member, ledger } = L.resolveGuest(db, c.req.param("token"));
    L.assertWritable(ledger);
    const expenseId = param(c, "expenseId");
    guestOwnExpense(ledger.id, expenseId, member.id);
    const patch = await body(c, expensePatch);
    const row = L.updateExpense(db, ledger.id, expenseId, patch);
    return c.json({ expense: L.getExpense(db, ledger.id, row.id) });
  });

  app.delete("/v1/guest/:token/expenses/:expenseId", (c) => {
    const { member, ledger } = L.resolveGuest(db, c.req.param("token"));
    L.assertWritable(ledger);
    const expenseId = param(c, "expenseId");
    guestOwnExpense(ledger.id, expenseId, member.id);
    L.deleteExpense(db, ledger.id, expenseId);
    return c.json({ ok: true });
  });

  app.post("/v1/guest/:token/settlements", async (c) => {
    const { member, ledger } = L.resolveGuest(db, c.req.param("token"));
    L.assertWritable(ledger);
    const input = await body(c, settlementCreate);
    const row = L.createSettlement(db, ledger.id, {
      ...input,
      currency: input.currency ?? ledger.base_currency,
      createdByMemberId: member.id,
    });
    notifySettlement(ledger.id, row.id, { userId: member.user_id });
    return c.json({ settlement: L.serializeSettlement(row) }, 201);
  });

  /** Währungsliste für Gäste (gleiche Liste wie /v1/currencies, aber über den Einladungs-Link). */
  app.get("/v1/guest/:token/currencies", (c) => {
    L.resolveGuest(db, c.req.param("token"));
    return c.json({ currencies: CURRENCIES });
  });

  app.get("/v1/guest/:token/fx", async (c) => {
    L.resolveGuest(db, c.req.param("token"));
    const q = z
      .object({ from: currency, to: currency, date: isoDate.optional() })
      .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.success) throw badRequest("from, to (und optional date) erforderlich");
    return c.json(await fetchEcbRate(q.data, deps.fetch));
  });

  app.route("/", trips.publicRoutes);

  /* ─ Alles unter /v1 ab hier braucht ein Token ─ */
  const requireAuth = async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const user = m ? authenticate(db, m[1]!) : null;
    if (!user) throw new HttpError(401, "unauthorized", "Anmeldung erforderlich");
    c.set("user", user);
    await next();
  };
  app.use("/v1/*", requireAuth);
  // Nicht-Administratoren (Reiseteilnehmer) kommen nur an die Routen der Positivliste.
  app.use("/v1/*", async (c, next) => {
    if (!c.get("user").isAdmin && !nonAdminMayCall(c.req.method, new URL(c.req.url).pathname)) {
      throw forbidden("Nur für Administratoren");
    }
    await next();
  });
  // Mitreisende: Zugehörigkeit bei Dokumenten, Inbox und eigenen Ausgaben (Rollenmodell in auth/roles.ts).
  app.use("/v1/*", participantAccess(db));

  app.get("/v1/me", (c) => c.json({ user: publicUser(c.get("user")) }));
  /* ─ Benutzerverwaltung ─ */
  const adminOnly = (c: Context<AppEnv>) => {
    if (!c.get("user").isAdmin) throw forbidden("Nur für Administratoren");
  };
  const userRow = (r: { id: number; username: string; display_name: string; email: string | null; is_admin: number; active: number }) => ({
    id: r.id, username: r.username, displayName: r.display_name, email: r.email, isAdmin: r.is_admin === 1, active: r.active === 1,
  });

  /** Schlankes Verzeichnis zum Verknüpfen von Teilnehmern mit Konten (Familie, daher für alle sichtbar). */
  app.get("/v1/users/directory", (c) => {
    const rows = db
      .prepare("SELECT id, display_name FROM users WHERE active = 1 ORDER BY display_name COLLATE NOCASE")
      .all() as Array<{ id: number; display_name: string }>;
    return c.json({ users: rows.map((r) => ({ id: r.id, displayName: r.display_name })) });
  });

  app.get("/v1/users", (c) => {
    adminOnly(c);
    const rows = db.prepare("SELECT id, username, display_name, email, is_admin, active FROM users ORDER BY display_name COLLATE NOCASE").all() as any[];
    return c.json({ users: rows.map(userRow) });
  });

  app.post("/v1/users", async (c) => {
    adminOnly(c);
    const b = await body(
      c,
      z.object({
        username: z.string().trim().min(2).max(60).regex(/^[\p{L}\p{N}._-]+$/u, "nur Buchstaben, Ziffern, . _ -"),
        displayName: z.string().trim().min(1).max(100),
        email: z.string().email().nullish(),
        password: z.string().min(12).max(200),
        isAdmin: z.boolean().optional(),
      })
    );
    const id = await createUser(db, { ...b, email: b.email ?? null });
    const r = db.prepare("SELECT id, username, display_name, email, is_admin, active FROM users WHERE id = ?").get(id) as any;
    return c.json({ user: userRow(r) }, 201);
  });

  /** Reisen, die ein Konto sehen darf (alle Reisen mit Markierung). */
  app.get("/v1/users/:id/trips", (c) => {
    adminOnly(c);
    const uid = param(c, "id");
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(uid)) throw new HttpError(404, "not_found", "Benutzer nicht gefunden");
    return c.json({ trips: tripAssignmentsForUser(db, uid) });
  });

  app.put("/v1/users/:id/trips", async (c) => {
    adminOnly(c);
    const uid = param(c, "id");
    const b = await body(c, z.object({ tripIds: z.array(id).max(500) }));
    setTripsForUser(db, uid, b.tripIds);
    return c.json({ trips: tripAssignmentsForUser(db, uid) });
  });

  /**
   * Benutzer endgültig löschen. Geräte und Einstellungen verschwinden mit dem Konto. Teilnehmer in
   * Abrechnungen und Reisen bleiben als Gäste ohne Konto erhalten, damit Salden und Verlauf stimmen.
   */
  app.delete("/v1/users/:id", (c) => {
    adminOnly(c);
    const uid = param(c, "id");
    const cur = db.prepare("SELECT * FROM users WHERE id = ?").get(uid) as any;
    if (!cur) throw new HttpError(404, "not_found", "Benutzer nicht gefunden");
    if (uid === c.get("user").id) {
      throw new HttpError(409, "cannot_delete_self", "Das eigene Konto kann nicht gelöscht werden");
    }
    if (cur.is_admin === 1 && cur.active === 1) {
      const others = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND active = 1 AND id != ?").get(uid) as { n: number }).n;
      if (others === 0) throw new HttpError(409, "last_admin", "Es muss mindestens ein aktiver Administrator bleiben");
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(uid);
    return c.json({ ok: true });
  });

  app.patch("/v1/users/:id", async (c) => {
    adminOnly(c);
    const uid = param(c, "id");
    const b = await body(
      c,
      z
        .object({
          displayName: z.string().trim().min(1).max(100),
          email: z.string().email().nullable(),
          isAdmin: z.boolean(),
          active: z.boolean(),
          password: z.string().min(12).max(200),
        })
        .partial()
    );
    const cur = db.prepare("SELECT * FROM users WHERE id = ?").get(uid) as any;
    if (!cur) throw new HttpError(404, "not_found", "Benutzer nicht gefunden");
    // Der letzte aktive Admin darf sich nicht selbst aussperren.
    const losesAdmin = cur.is_admin === 1 && (b.isAdmin === false || b.active === false);
    if (losesAdmin) {
      const others = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND active = 1 AND id != ?").get(uid) as { n: number }).n;
      if (others === 0) throw new HttpError(409, "last_admin", "Es muss mindestens ein aktiver Administrator bleiben");
    }
    db.prepare("UPDATE users SET display_name = ?, email = ?, is_admin = ?, active = ? WHERE id = ?").run(
      b.displayName ?? cur.display_name,
      b.email !== undefined ? b.email : cur.email,
      b.isAdmin === undefined ? cur.is_admin : b.isAdmin ? 1 : 0,
      b.active === undefined ? cur.active : b.active ? 1 : 0,
      uid
    );
    if (b.password) await changePassword(db, uid, b.password);
    if (b.active === false) {
      db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), uid);
    }
    const r = db.prepare("SELECT id, username, display_name, email, is_admin, active FROM users WHERE id = ?").get(uid) as any;
    return c.json({ user: userRow(r) });
  });

  /** Eigenes Passwort ändern; alle anderen Geräte werden abgemeldet. */
  app.post("/v1/me/password", async (c) => {
    const b = await body(c, z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) }));
    const u = c.get("user");
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(u.id) as { password_hash: string };
    if (!(await verifyPassword(b.currentPassword, row.password_hash))) {
      throw new HttpError(403, "invalid_credentials", "Das aktuelle Passwort ist falsch");
    }
    await changePassword(db, u.id, b.newPassword, u.tokenId);
    return c.json({ ok: true });
  });

  /** Geräte/Sitzungen des Benutzers. */
  app.get("/v1/me/devices", (c) => {
    const rows = db
      .prepare(
        `SELECT id, device_name, platform, created_at, last_used_at, apns_token IS NOT NULL AS push,
                app_version, apns_environment
           FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY COALESCE(last_used_at, created_at) DESC`
      )
      .all(c.get("user").id) as any[];
    return c.json({
      devices: rows.map((r) => ({
        id: r.id, name: r.device_name, platform: r.platform, createdAt: r.created_at,
        lastUsedAt: r.last_used_at, push: r.push === 1, current: r.id === c.get("user").tokenId,
        appVersion: r.app_version ?? null, environment: r.apns_environment ?? null,
      })),
    });
  });

  app.delete("/v1/me/devices/:id", (c) => {
    const r = db
      .prepare("UPDATE api_tokens SET revoked_at = ?, apns_token = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), param(c, "id"), c.get("user").id);
    if (r.changes === 0) throw new HttpError(404, "not_found", "Gerät nicht gefunden");
    return c.json({ ok: true });
  });

  /**
   * Gerät registrieren: APNs-Token (null entfernt), Push-to-Start-Token für Live Activities, Plattform und
   * App-Version. Nicht übergebene Felder bleiben unverändert.
   */
  app.put("/v1/devices/current", async (c) => {
    const b = await body(
      c,
      z.object({
        apnsToken: z.string().regex(/^[0-9a-fA-F]{32,200}$/, "erwartet Hex-Token").nullable().optional(),
        environment: z.enum(["development", "production"]).optional(),
        appVersion: z.string().max(40).nullish(),
        pushToStartToken: z.string().regex(/^[0-9a-fA-F]{32,300}$/, "erwartet Hex-Token").nullable().optional(),
        platform: z.enum(["ios", "ipados", "macos", "visionos", "web"]).optional(),
      })
    );
    setDeviceToken(db, c.get("user").tokenId, b);
    return c.json({ ok: true });
  });

  /** Live Activity eines Geräts anmelden (der Versand ist Sache des Mitteilungs-Schedulers). */
  app.put("/v1/live-activities/:activityId", async (c) => {
    const activityId = c.req.param("activityId");
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(activityId)) throw badRequest("Ungültige activityId");
    const b = await body(
      c,
      z.object({
        pushToken: z.string().regex(/^[0-9a-fA-F]{16,400}$/, "erwartet Hex-Token"),
        tripId: id,
        kind: z.enum(["day", "flight", "checkin"]),
        eventId: id.nullish(),
      })
    );
    const user = c.get("user");
    assertTripAccess(db, user, b.tripId);
    if (b.eventId != null) {
      const ev = db.prepare("SELECT 1 FROM trip_events WHERE id = ? AND trip_id = ?").get(b.eventId, b.tripId);
      if (!ev) throw new HttpError(422, "invalid_event", "Ereignis gehört nicht zur Reise");
    }
    const taken = db.prepare("SELECT user_id FROM live_activities WHERE activity_id = ?").get(activityId) as { user_id: number } | undefined;
    if (taken && taken.user_id !== user.id) throw forbidden("Diese Live Activity gehört einem anderen Konto");
    const ts = clock().toISOString();
    db.prepare(
      `INSERT INTO live_activities (activity_id, token_id, user_id, push_token, trip_id, kind, event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET token_id = excluded.token_id, push_token = excluded.push_token,
         trip_id = excluded.trip_id, kind = excluded.kind, event_id = excluded.event_id, updated_at = excluded.updated_at`
    ).run(activityId, user.tokenId, user.id, b.pushToken, b.tripId, b.kind, b.eventId ?? null, ts, ts);
    return c.json({ ok: true });
  });

  app.delete("/v1/live-activities/:activityId", (c) => {
    db.prepare("DELETE FROM live_activities WHERE activity_id = ? AND user_id = ?").run(c.req.param("activityId"), c.get("user").id);
    return c.json({ ok: true });
  });

  app.get("/v1/me/notification-prefs", (c) => c.json({ prefs: getPrefs(db, c.get("user").id) }));
  app.put("/v1/me/notification-prefs", async (c) => {
    const kinds = Object.fromEntries(Object.values(PREF_KEYS).map((k) => [k, z.boolean()]));
    const b = await body(
      c,
      z
        .object({
          ...kinds,
          leadTimes: z
            .object({
              departHours: z.array(z.number().positive().max(168)).max(6),
              checkoutMinutes: z.number().int().min(0).max(1440),
              deadlineDays: z.number().int().min(0).max(60),
              todayBriefing: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "erwartet HH:mm"),
            })
            .partial(),
          // Ruhezeiten (Ortszeit der Reise): unkritische Mitteilungen warten bis `to`
          quietHours: z
            .object({
              enabled: z.boolean(),
              from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "erwartet HH:mm"),
              to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "erwartet HH:mm"),
            })
            .partial(),
        })
        .partial()
    );
    return c.json({ prefs: setPrefs(db, c.get("user").id, b as Parameters<typeof setPrefs>[2]) });
  });

  /** Push-Diagnose, Testmeldungen, Scheduler-Simulation und Mitteilungsbilder (notifications/routes.ts). */
  app.route(
    "/",
    notificationRoutes({ db, push: deps.push ?? null, scheduler, now: clock, illustrationsDir: deps.illustrationsDir })
  );

  /** Währungen mit EZB-Referenzkursen (für Auswahllisten). */
  app.get("/v1/currencies", (c) => c.json({ currencies: CURRENCIES }));

  /** «Heute»: aktive Reise, nächstes Ereignis, Tag und morgen, Aufgaben, Fristen, Vorschläge, Saldo. */
  app.get("/v1/today", (c) =>
    c.json(
      todayView(db, c.get("user"), {
        date: c.req.query("date") ?? null,
        tz: c.req.query("tz") ?? null,
        tripId: c.req.query("tripId") ? Number(c.req.query("tripId")) || null : null,
        now: clock(),
      })
    )
  );

  /** Kompakte Zusammenfassung für Widgets (≤ 20 KB). */
  app.get("/v1/summary", (c) => {
    const raw = c.req.query("tripId");
    let tripId: number | null = null;
    if (raw != null && raw !== "") {
      const v = id.safeParse(raw);
      if (!v.success) throw badRequest("tripId ungültig");
      tripId = v.data;
    }
    return c.json(summaryView(db, c.get("user"), clock(), { tripId }));
  });

  app.post("/v1/auth/logout", (c) => {
    revokeToken(db, c.get("user").tokenId);
    return c.json({ ok: true });
  });

  app.route("/", trips.authed);
  app.route("/", docs);
  app.route("/", authedMetaRoutes());
  app.route("/", mapsRoutes({ now: clock, config: deps.mapkit ?? null }));

  // Fachmodule mit gemeinsamem Kontext.
  const moduleDeps: ModuleDeps = {
    db,
    now: clock,
    background,
    notifier,
    mediaDir,
    images: deps.images ?? null,
    imagesPerRun: deps.imagesPerRun,
  };
  app.route("/", mediaRoutes(moduleDeps));

  /* ─ Wechselkurs ─ */
  app.get("/v1/fx", async (c) => {
    const q = z
      .object({ from: currency, to: currency, date: isoDate.optional() })
      .safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.success) throw badRequest("from, to (und optional date) erforderlich");
    return c.json(await fetchEcbRate(q.data, deps.fetch));
  });

  /* ─ Abrechnungen ─ */
  app.get("/v1/ledgers", (c) => {
    // archived=1|include → aktive und archivierte, archived=only → nur archivierte
    const a = new URL(c.req.url).searchParams.get("archived");
    const mode = a === "only" ? "only" : a === "1" || a === "include" ? "include" : "exclude";
    return c.json({ ledgers: L.listLedgersForUser(db, c.get("user"), mode) });
  });

  app.post("/v1/ledgers", async (c) => {
    const input = await body(
      c,
      z.object({
        title: z.string().trim().min(1).max(200),
        baseCurrency: currency.optional(),
        tripId: id.nullish(),
        members: z
          .array(
            z.object({ displayName: z.string().trim().min(1), email: z.string().email().nullish(), userId: id.nullish() })
          )
          .max(50)
          .optional(),
      })
    );
    const ledgerId = L.createLedger(db, c.get("user"), input);
    return c.json(L.ledgerOverview(db, ledgerId, { includeInvites: c.get("user").isAdmin, forUserId: c.get("user").id, includeMedia: true }), 201);
  });

  const ledgerAccess = (c: Context<AppEnv>) => {
    const ledgerId = param(c, "id");
    L.assertLedgerAccess(db, c.get("user"), ledgerId);
    return ledgerId;
  };

  app.get("/v1/ledgers/:id", (c) =>
    c.json(L.ledgerOverview(db, ledgerAccess(c), { includeInvites: c.get("user").isAdmin, forUserId: c.get("user").id, includeMedia: true }))
  );

  app.patch("/v1/ledgers/:id", async (c) => {
    const ledgerId = ledgerAccess(c);
    const patch = await body(
      c,
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        archived: z.boolean().optional(),
        baseCurrency: currency.optional(),
      })
    );
    L.updateLedger(db, ledgerId, patch);
    return c.json(L.ledgerOverview(db, ledgerId, { includeInvites: c.get("user").isAdmin, forUserId: c.get("user").id, includeMedia: true }));
  });

  app.delete("/v1/ledgers/:id", (c) => {
    const ledgerId = ledgerAccess(c);
    L.deleteLedger(db, ledgerId);
    return c.json({ ok: true });
  });

  /* ─ Mitglieder & Paare ─ */
  app.post("/v1/ledgers/:id/members", async (c) => {
    const ledgerId = ledgerAccess(c);
    const input = await body(
      c,
      z.object({
        displayName: z.string().trim().min(1).max(100),
        email: z.string().email().nullish(),
        userId: id.nullish(),
      })
    );
    return c.json(
      { member: L.serializeMember(L.addMember(db, ledgerId, input), { includeInvite: true }) },
      201
    );
  });

  app.patch("/v1/ledgers/:id/members/:memberId", async (c) => {
    const ledgerId = ledgerAccess(c);
    const patch = await body(
      c,
      z.object({
        displayName: z.string().trim().min(1).max(100).optional(),
        email: z.string().email().nullable().optional(),
        userId: id.nullable().optional(),
        coupleId: id.nullable().optional(),
      })
    );
    return c.json({
      member: L.serializeMember(L.updateMember(db, ledgerId, param(c, "memberId"), patch), {
        includeInvite: true,
      }),
    });
  });

  app.delete("/v1/ledgers/:id/members/:memberId", (c) => {
    const ledgerId = ledgerAccess(c);
    L.removeMember(db, ledgerId, param(c, "memberId"));
    return c.json({ ok: true });
  });

  app.post("/v1/ledgers/:id/members/:memberId/invite/rotate", (c) => {
    const ledgerId = ledgerAccess(c);
    const m = L.rotateInvite(db, ledgerId, param(c, "memberId"));
    return c.json({ member: L.serializeMember(m, { includeInvite: true }) });
  });

  app.post("/v1/ledgers/:id/members/:memberId/invite/revoke", (c) => {
    const ledgerId = ledgerAccess(c);
    const m = L.revokeInvite(db, ledgerId, param(c, "memberId"));
    return c.json({ member: L.serializeMember(m, { includeInvite: true }) });
  });

  app.post("/v1/ledgers/:id/couples", async (c) => {
    const ledgerId = ledgerAccess(c);
    const input = await body(
      c,
      z.object({ memberIds: z.array(id).min(2).max(6), name: z.string().trim().max(100).nullish() })
    );
    const couple = L.createCouple(db, ledgerId, input.memberIds, input.name);
    return c.json({ couple: { id: couple.id, name: couple.name, memberIds: input.memberIds } }, 201);
  });

  app.delete("/v1/ledgers/:id/couples/:coupleId", (c) => {
    const ledgerId = ledgerAccess(c);
    L.deleteCouple(db, ledgerId, param(c, "coupleId"));
    return c.json({ ok: true });
  });

  /* ─ Ausgaben ─ */
  app.get("/v1/ledgers/:id/expenses", (c) =>
    c.json({ expenses: L.listExpenses(db, ledgerAccess(c)) })
  );

  app.post("/v1/ledgers/:id/expenses", async (c) => {
    const ledgerId = ledgerAccess(c);
    const input = await body(c, expenseCreate);
    const myMember = db
      .prepare("SELECT id FROM participants WHERE ledger_id = ? AND user_id = ?")
      .get(ledgerId, c.get("user").id) as { id: number } | undefined;
    const row = L.createExpense(db, ledgerId, { ...input, createdByMemberId: myMember?.id ?? null });
    notifyExpense(ledgerId, row.id, { userId: c.get("user").id, name: c.get("user").displayName });
    return c.json({ expense: L.getExpense(db, ledgerId, row.id) }, 201);
  });

  app.get("/v1/ledgers/:id/expenses/:expenseId", (c) =>
    c.json({ expense: L.getExpense(db, ledgerAccess(c), param(c, "expenseId")) })
  );

  app.patch("/v1/ledgers/:id/expenses/:expenseId", async (c) => {
    const ledgerId = ledgerAccess(c);
    const patch = await body(c, expensePatch);
    const row = L.updateExpense(db, ledgerId, param(c, "expenseId"), patch);
    return c.json({ expense: L.getExpense(db, ledgerId, row.id) });
  });

  app.delete("/v1/ledgers/:id/expenses/:expenseId", (c) => {
    const ledgerId = ledgerAccess(c);
    L.deleteExpense(db, ledgerId, param(c, "expenseId"));
    return c.json({ ok: true });
  });

  app.post("/v1/ledgers/:id/expenses/:expenseId/settle-couple", (c) => {
    const ledgerId = ledgerAccess(c);
    const row = L.settleCoupleExpense(db, ledgerId, param(c, "expenseId"));
    return c.json({ expense: L.getExpense(db, ledgerId, row.id) });
  });

  /* ─ Rückzahlungen ─ */
  app.get("/v1/ledgers/:id/settlements", (c) =>
    c.json({ settlements: L.listSettlements(db, ledgerAccess(c)) })
  );

  app.post("/v1/ledgers/:id/settlements", async (c) => {
    const ledgerId = ledgerAccess(c);
    const input = await body(c, settlementCreate);
    const ledger = L.getLedger(db, ledgerId);
    const myMember = db
      .prepare("SELECT id FROM participants WHERE ledger_id = ? AND user_id = ?")
      .get(ledgerId, c.get("user").id) as { id: number } | undefined;
    const row = L.createSettlement(db, ledgerId, {
      ...input,
      currency: input.currency ?? ledger.base_currency,
      createdByMemberId: myMember?.id ?? null,
    });
    notifySettlement(ledgerId, row.id, { userId: c.get("user").id });
    return c.json({ settlement: L.serializeSettlement(row) }, 201);
  });

  app.delete("/v1/ledgers/:id/settlements/:settlementId", (c) => {
    const ledgerId = ledgerAccess(c);
    L.deleteSettlement(db, ledgerId, param(c, "settlementId"));
    return c.json({ ok: true });
  });

  return app;
}

function publicUser(u: AuthUser) {
  return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, isAdmin: u.isAdmin };
}
