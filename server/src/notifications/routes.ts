/**
 * Routen der Mitteilungen: Push-Diagnose (Admin) und Mitteilungsbilder.
 *
 *   GET  /v1/push/status                      Schlüssel, Geräte, Scheduler-Lauf (Admin)
 *   POST /v1/push/test                        Testmeldung an die eigenen Geräte (Admin), Art wählbar
 *   POST /v1/push/simulate                    Plan für einen Zeitpunkt, ohne zu senden (Admin)
 *   GET  /v1/media/notification/:imageKey     PNG der Mitteilungsillustration (Bearer), `?scheme=dark`
 */
import { Hono, type Context } from "hono";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppEnv } from "../app";
import type { Db } from "../db/client";
import { HttpError, forbidden, notFound } from "../lib/errors";
import { parseWith } from "../lib/validate";
import type { PushTransport } from "../push/apns";
import { NOTIFICATION_KINDS, noticeMessage, type NotificationKind } from "../push/notifier";
import { buildApnsPayload } from "../push/apns";
import { sampleNotice } from "./samples";
import type { NotificationScheduler } from "./scheduler";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ───────────── Mitteilungsbilder ───────────── */

/** Kandidaten für den Illustrationsordner (`shared/illustrations`); `TRAVELBUDDY_ILLUSTRATIONS_DIR` hat Vorrang. */
export function illustrationCandidates(env: Record<string, string | undefined> = process.env): string[] {
  return [
    env.TRAVELBUDDY_ILLUSTRATIONS_DIR,
    path.resolve(process.cwd(), "shared/illustrations"),
    path.resolve(process.cwd(), "../shared/illustrations"),
    path.resolve(here, "../shared/illustrations"), // Bundle: dist/index.mjs → /app/shared/illustrations
    path.resolve(here, "../../../shared/illustrations"), // Quelle: server/src/notifications → Repo-Root
    path.resolve(here, "../../../../shared/illustrations"),
  ].filter((p): p is string => Boolean(p));
}

/**
 * Datei einer Mitteilungsillustration. Gesucht wird (je Ordner `<root>/notifications` und `<root>`):
 * hell `<key>.png`, `png/light/<key>.png`; dunkel `<key>-dark.png`, `png/dark/<key>.png`, dann hell als Rückfall.
 */
export function notificationImageFile(roots: string[], key: string, scheme: "light" | "dark"): string | null {
  const dirs = roots.flatMap((r) => [path.join(r, "notifications"), r]);
  const light = dirs.flatMap((d) => [path.join(d, `${key}.png`), path.join(d, "png", "light", `${key}.png`)]);
  const dark = dirs.flatMap((d) => [path.join(d, `${key}-dark.png`), path.join(d, "png", "dark", `${key}.png`)]);
  for (const f of scheme === "dark" ? [...dark, ...light] : light) {
    try {
      if (fs.statSync(f).isFile()) return f;
    } catch {
      /* nächster Kandidat */
    }
  }
  return null;
}

const KEY = /^notif-[a-z]{2,20}$/;

/* ───────────── Routen ───────────── */

export function notificationRoutes(deps: {
  db: Db;
  push: PushTransport | null;
  scheduler: NotificationScheduler;
  now: () => Date;
  /** Illustrationsordner (Tests); Vorgabe: Umgebung und Repo-Pfade. */
  illustrationsDir?: string | null;
}) {
  const { db } = deps;
  const r = new Hono<AppEnv>();
  const admin = (c: Context<AppEnv>) => {
    if (!c.get("user").isAdmin) throw forbidden("Nur für Administratoren");
  };
  const roots = () => (deps.illustrationsDir ? [deps.illustrationsDir] : illustrationCandidates());

  /** Mitteilungsbild: nur mit Anmeldung, Cache-Header; 404, solange die Datei fehlt (Illustrationen sind ein anderes Paket). */
  r.get("/v1/media/notification/:imageKey", async (c, next) => {
    let key = c.req.param("imageKey") ?? "";
    let scheme: "light" | "dark" = new URL(c.req.url).searchParams.get("scheme") === "dark" ? "dark" : "light";
    if (key.endsWith("-dark")) {
      key = key.slice(0, -5);
      scheme = "dark";
    }
    if (!KEY.test(key)) throw notFound("Bild");
    const file = notificationImageFile(roots(), key, scheme);
    if (!file) return next(); // Rückfall: ältere Ablage `<media>/notification/<key>.png` (media/routes.ts), sonst 404
    const st = fs.statSync(file);
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${path.basename(file).length}"`;
    const headers: Record<string, string> = {
      "content-type": "image/png",
      "cache-control": "private, max-age=86400",
      etag,
      vary: "Authorization",
      "x-content-type-options": "nosniff",
    };
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const bytes = new Uint8Array(await fs.promises.readFile(file));
    return new Response(bytes, { status: 200, headers: { ...headers, "content-length": String(bytes.length) } });
  });

  /** Push-Diagnose: Schlüssel eingerichtet? Geräte? Letzter Scheduler-Lauf? */
  r.get("/v1/push/status", (c) => {
    admin(c);
    const status = deps.push?.status?.() ?? (deps.push ? { configured: true as const } : { configured: false as const, reason: "Push ist nicht aktiviert", searched: null });
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const registeredDevices = one(
      `SELECT COUNT(*) AS n FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.revoked_at IS NULL AND t.apns_token IS NOT NULL AND u.active = 1`
    );
    const pushToStartDevices = one(
      `SELECT COUNT(*) AS n FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.revoked_at IS NULL AND t.push_to_start_token IS NOT NULL AND u.active = 1`
    );
    return c.json({
      ...status,
      /** Ohne Schlüssel wird nichts gesendet und nichts als gesendet markiert (Trockenlauf). */
      dryRun: !status.configured,
      registeredDevices,
      pushToStartDevices,
      liveActivities: one("SELECT COUNT(*) AS n FROM live_activities"),
      scheduler: deps.scheduler.status(),
    });
  });

  const testBody = z
    .object({
      kind: z.enum(["test", ...NOTIFICATION_KINDS, "liveactivity"]).optional(),
      /** Nur `liveactivity`: Art der Activity (Standard `flight`) und Ereignis (Standard `start`). */
      activityKind: z.enum(["day", "flight", "checkin"]).optional(),
      event: z.enum(["start", "update", "end"]).optional(),
    })
    .optional();

  /**
   * Testmeldung an die eigenen Geräte (Admin), unabhängig von Einstellungen und Entdoppelung. `kind`: `test`
   * (Standard), eine Mitteilungsart mit Beispiel-Ticket oder `liveactivity` (Start per Push-to-Start bzw. Update/Ende
   * an die angemeldeten Activities). Ohne APNs-Schlüssel antwortet die Route mit `dryRun: true` und der Nutzlast.
   */
  r.post("/v1/push/test", async (c) => {
    admin(c);
    if (!deps.push) throw new HttpError(409, "push_not_configured", "Push ist nicht aktiviert");
    const raw = (await c.req.text()).trim();
    let input: unknown;
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "invalid_json", "Ungültiger JSON-Body");
      }
    }
    const body = parseWith(input, testBody) ?? {};
    const kind = body.kind ?? "test";
    const user = c.get("user");
    const now = deps.now();

    if (kind === "liveactivity") {
      const results = await deps.scheduler.live.sendSample(user.id, {
        event: body.event ?? "start",
        kind: body.activityKind ?? "flight",
        now,
      });
      if (results.length === 0) {
        throw new HttpError(
          409,
          "no_device",
          body.event && body.event !== "start"
            ? "Keine angemeldete Live Activity auf diesem Konto (zuerst eine starten)"
            : "Kein Gerät mit Push-to-Start-Token auf diesem Konto (App einmal öffnen, iOS 17.2 oder neuer)"
        );
      }
      return c.json({ kind, dryRun: results.every((x) => x.dryRun), results });
    }

    const rows = db
      .prepare(
        `SELECT id, device_name, apns_token, apns_environment FROM api_tokens
          WHERE user_id = ? AND revoked_at IS NULL AND apns_token IS NOT NULL`
      )
      .all(user.id) as Array<{ id: number; device_name: string | null; apns_token: string; apns_environment: "development" | "production" | null }>;
    if (rows.length === 0) {
      throw new HttpError(409, "no_device", "Auf diesem Konto ist kein Gerät für Push registriert (in der App unter Konto einschalten)");
    }
    const results = [];
    for (const d of rows) {
      const environment = d.apns_environment ?? "production";
      const msg =
        kind === "test"
          ? { deviceToken: d.apns_token, environment, title: "TravelBuddy", body: "Testmeldung: Push funktioniert.", data: { kind: "test" } }
          : noticeMessage(sampleNotice(kind as NotificationKind, user.id, now), { token: d.apns_token, environment });
      const res = await deps.push.send(msg);
      const dry = !res.ok && res.reason.startsWith("not_configured");
      if (!res.ok && res.invalidToken) {
        db.prepare("UPDATE api_tokens SET apns_token = NULL, apns_environment = NULL WHERE id = ?").run(d.id);
      }
      results.push({
        device: d.device_name,
        environment,
        tokenSuffix: d.apns_token.slice(-6),
        ok: res.ok,
        ...(res.ok ? {} : { status: res.status, reason: res.reason, tokenRemoved: res.invalidToken }),
        ...(dry ? { dryRun: true, payload: buildApnsPayload(msg) } : {}),
      });
    }
    return c.json({ kind, dryRun: results.every((x) => "dryRun" in x), results });
  });

  /**
   * Simulationslauf des Schedulers: Was wäre zum Zeitpunkt `at` (UTC, Standard jetzt) fällig, was kommt in den
   * nächsten `previewHours` Stunden, welche Live Activities gelten? Sendet nichts, schreibt nichts.
   */
  r.post("/v1/push/simulate", async (c) => {
    admin(c);
    const raw = (await c.req.text()).trim();
    let input: unknown;
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "invalid_json", "Ungültiger JSON-Body");
      }
    }
    const b =
      parseWith(
        input,
        z
          .object({
            at: z.string().datetime().optional(),
            tripId: z.number().int().positive().optional(),
            previewHours: z.number().min(1).max(168).optional(),
          })
          .optional()
      ) ?? {};
    const at = b.at ? new Date(b.at) : deps.now();
    return c.json(deps.scheduler.simulate(at, { tripId: b.tripId ?? null, previewHours: b.previewHours }));
  });

  return r;
}
