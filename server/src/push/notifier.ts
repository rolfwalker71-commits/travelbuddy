import type { Db } from "../db/client";
import { isNotConfigured, type ApnsMessage, type PushTransport } from "./apns";
import { quietDeferral, type QuietMode } from "./quiet";

/**
 * Mitteilungsarten (Kategorien). `thread-id` ist je Reise `trip-<id>`, je Reisekasse `ledger-<id>`.
 * `trip.comment`, `ledger.expense`, `ledger.settlement` und `trip.review` löst die Anwendung aus; `trip.today`,
 * `trip.depart`, `trip.stay`, `trip.pickup` und `trip.deadline` der Scheduler (`notifications/scheduler.ts`),
 * beide über `Notifier.deliver`.
 */
export const NOTIFICATION_KINDS = [
  "trip.today", // Morgenbriefing (07:30 Reisezeit)
  "trip.depart", // Abflug/Abfahrt in 24 h, 3 h, 1 h; «Check-in öffnet»
  "trip.stay", // Check-in heute, Check-out in 1 h
  "trip.pickup", // Mietwagen
  "trip.deadline", // Storno-/Zahlungsfrist
  "trip.review", // neue Vorschläge
  "trip.comment",
  "ledger.expense",
  "ledger.settlement",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Einstellungsschlüssel (camelCase) je Art. */
export const PREF_KEYS = {
  "trip.today": "tripToday",
  "trip.depart": "tripDepart",
  "trip.stay": "tripStay",
  "trip.pickup": "tripPickup",
  "trip.deadline": "tripDeadline",
  "trip.review": "tripReview",
  "trip.comment": "tripComment",
  "ledger.expense": "ledgerExpense",
  "ledger.settlement": "ledgerSettlement",
} as const satisfies Record<NotificationKind, string>;
export type PrefKey = (typeof PREF_KEYS)[NotificationKind];

export type Prefs = Record<PrefKey, boolean> & {
  /** Vorlaufzeiten für den Scheduler. */
  leadTimes: {
    /** Stunden vor Abflug/Abfahrt, zu denen erinnert wird. */
    departHours: number[];
    /** Minuten vor Check-out. */
    checkoutMinutes: number;
    /** Tage vor Storno-/Zahlungsfrist. */
    deadlineDays: number;
    /** Uhrzeit des Morgenbriefings (Reisezeit, HH:mm). */
    todayBriefing: string;
  };
  /**
   * Ruhezeiten (Ortszeit der Reise): Unkritische Mitteilungen werden in `[from, to)` nicht gesendet, sondern
   * verschoben (siehe `push/quiet.ts`). Abflug-Erinnerungen und Abholung sind ausgenommen.
   */
  quietHours: { enabled: boolean; from: string; to: string };
};

export const DEFAULT_PREFS: Prefs = {
  tripToday: true,
  tripDepart: true,
  tripStay: true,
  tripPickup: true,
  tripDeadline: true,
  tripReview: true,
  tripComment: true,
  ledgerExpense: true,
  ledgerSettlement: true,
  leadTimes: { departHours: [24, 3, 1], checkoutMinutes: 60, deadlineDays: 3, todayBriefing: "07:30" },
  quietHours: { enabled: true, from: "22:30", to: "06:30" },
};

export type Notice = {
  userId: number;
  kind: NotificationKind;
  /** Gleicher Schlüssel = nur einmal melden. */
  dedupeKey: string;
  title: string;
  body: string;
  /** `travelbuddy://…` */
  deepLink: string;
  tripId?: number;
  eventId?: number;
  /** Name einer Illustration aus `shared/illustrations/manifest.json`. */
  imageKey?: string;
  /** `time-sensitive` für Fristen und Abflüge. */
  interruption?: "active" | "time-sensitive";
  /** 0…1: Rang in der Mitteilungszentrale (`relevance`). */
  relevance?: number;
  /** Daten für die Ticket-Ansicht der Content-Extension (Anzeigewerte bereits als dd.mm.yyyy / hh:mm). */
  ticket?: Record<string, unknown>;
  /** Weitere Felder der Nutzlast (z. B. ledgerId, expenseId). */
  data?: Record<string, unknown>;
  threadId?: string;
  /** Ab diesem Zeitpunkt (UTC ms) ist die Meldung überholt (`apns-expiration`). */
  expiresAt?: number;
  /**
   * Verhalten in den Ruhezeiten: `skip` (nicht senden; die Planung liefert sie nach der Ruhezeit erneut),
   * `queue` (vormerken und nach der Ruhezeit senden), `false` (immer sofort). Ohne Angabe gilt der Standard je Art.
   */
  quiet?: QuietMode | false;
};

export type DeliveryReport = {
  sent: number;
  skippedPrefs: number;
  skippedDuplicate: number;
  noDevice: number;
  failed: number;
  /**
   * Nicht gesendet, weil Push nicht eingerichtet ist (kein APNs-Schlüssel, Trockenlauf): Die Meldung gilt nicht als
   * zugestellt und wird mit dem nächsten Lauf nachgeholt, solange sie noch aktuell ist.
   */
  deferred: number;
  /** Wegen der Ruhezeiten verschoben (vorgemerkt oder von der Planung später erneut geliefert). */
  quiet: number;
};

/** Mitteilungsillustration je Art (`shared/illustrations/manifest.json`). */
export const IMAGE_KEYS: Partial<Record<NotificationKind, string>> = {
  "trip.today": "notif-today",
  "trip.depart": "notif-depart",
  "trip.stay": "notif-stay",
  "trip.pickup": "notif-pickup",
  "trip.deadline": "notif-deadline",
  "trip.review": "notif-review",
};

/** Rang in der Mitteilungszentrale (`relevance`), wenn der Auslöser keinen setzt. */
export const DEFAULT_RELEVANCE: Partial<Record<NotificationKind, number>> = {
  "trip.depart": 1.0,
  "trip.stay": 0.9,
  "trip.pickup": 0.85,
  "trip.deadline": 0.8,
  "trip.today": 0.7,
  "trip.review": 0.4,
};

type DeviceRow = { id: number; apns_token: string; apns_environment: "development" | "production" | null };

/** Registriert/entfernt Push-Token am aktuellen Gerät. Nicht übergebene Felder bleiben unverändert. */
export function setDeviceToken(
  db: Db,
  tokenId: number,
  input: {
    apnsToken?: string | null;
    environment?: "development" | "production";
    appVersion?: string | null;
    pushToStartToken?: string | null;
    platform?: string | null;
  }
): void {
  const cur = db.prepare("SELECT apns_token, apns_environment, app_version, push_to_start_token, platform FROM api_tokens WHERE id = ?").get(tokenId) as
    | { apns_token: string | null; apns_environment: string | null; app_version: string | null; push_to_start_token: string | null; platform: string | null }
    | undefined;
  if (!cur) return;
  const apns = input.apnsToken === undefined ? cur.apns_token : input.apnsToken;
  const env = apns ? input.environment ?? (input.apnsToken === undefined ? cur.apns_environment : null) ?? "production" : null;
  db.prepare(
    `UPDATE api_tokens SET apns_token = ?, apns_environment = ?, app_version = ?, push_to_start_token = ?, platform = ? WHERE id = ?`
  ).run(
    apns,
    env,
    input.appVersion !== undefined ? input.appVersion : cur.app_version,
    input.pushToStartToken !== undefined ? input.pushToStartToken : cur.push_to_start_token,
    input.platform !== undefined ? input.platform : cur.platform,
    tokenId
  );
  // Ein physisches Gerät hat genau einen Push-Token: Doppelte bei anderen Sitzungen entfernen.
  if (apns) {
    db.prepare("UPDATE api_tokens SET apns_token = NULL, apns_environment = NULL WHERE apns_token = ? AND id != ?").run(apns, tokenId);
  }
}

export function getPrefs(db: Db, userId: number): Prefs {
  const row = db.prepare("SELECT prefs FROM notification_prefs WHERE user_id = ?").get(userId) as { prefs: string } | undefined;
  let stored: Record<string, unknown> = {};
  try {
    stored = row ? (JSON.parse(row.prefs) as Record<string, unknown>) : {};
  } catch {
    stored = {};
  }
  const out: Prefs = { ...DEFAULT_PREFS, leadTimes: { ...DEFAULT_PREFS.leadTimes }, quietHours: { ...DEFAULT_PREFS.quietHours } };
  for (const key of Object.values(PREF_KEYS)) {
    if (typeof stored[key] === "boolean") out[key] = stored[key] as boolean;
  }
  const lt = stored.leadTimes as Partial<Prefs["leadTimes"]> | undefined;
  if (lt && typeof lt === "object") out.leadTimes = sanitizeLeadTimes({ ...out.leadTimes, ...lt });
  const qh = stored.quietHours as Partial<Prefs["quietHours"]> | undefined;
  if (qh && typeof qh === "object") out.quietHours = sanitizeQuietHours({ ...out.quietHours, ...qh });
  return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sanitizeQuietHours(q: Partial<Prefs["quietHours"]>): Prefs["quietHours"] {
  const d = DEFAULT_PREFS.quietHours;
  return {
    enabled: typeof q.enabled === "boolean" ? q.enabled : d.enabled,
    from: typeof q.from === "string" && HHMM.test(q.from) ? q.from : d.from,
    to: typeof q.to === "string" && HHMM.test(q.to) ? q.to : d.to,
  };
}

export function sanitizeLeadTimes(lt: Prefs["leadTimes"]): Prefs["leadTimes"] {
  const hours = [...new Set((lt.departHours ?? []).filter((h) => Number.isFinite(h) && h > 0 && h <= 168).map((h) => Math.round(h * 4) / 4))].sort((a, b) => b - a);
  return {
    departHours: hours.length ? hours.slice(0, 6) : DEFAULT_PREFS.leadTimes.departHours,
    checkoutMinutes: clampInt(lt.checkoutMinutes, 0, 1440, 60),
    deadlineDays: clampInt(lt.deadlineDays, 0, 60, 3),
    todayBriefing: /^([01]\d|2[0-3]):[0-5]\d$/.test(lt.todayBriefing) ? lt.todayBriefing : DEFAULT_PREFS.leadTimes.todayBriefing,
  };
}

const clampInt = (v: unknown, min: number, max: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt;

export function setPrefs(
  db: Db,
  userId: number,
  p: Partial<Record<PrefKey, boolean>> & { leadTimes?: Partial<Prefs["leadTimes"]>; quietHours?: Partial<Prefs["quietHours"]> }
): Prefs {
  const cur = getPrefs(db, userId);
  const next: Prefs = { ...cur, leadTimes: { ...cur.leadTimes }, quietHours: { ...cur.quietHours } };
  for (const key of Object.values(PREF_KEYS)) if (typeof p[key] === "boolean") next[key] = p[key]!;
  if (p.leadTimes) next.leadTimes = sanitizeLeadTimes({ ...cur.leadTimes, ...p.leadTimes } as Prefs["leadTimes"]);
  if (p.quietHours) next.quietHours = sanitizeQuietHours({ ...cur.quietHours, ...p.quietHours });
  db.prepare(
    `INSERT INTO notification_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(next), new Date().toISOString());
  return next;
}

/** APNs-Nachricht zu einer Mitteilung (Nutzlast gemäss Vertrag, siehe `buildApnsPayload`). */
export function noticeMessage(n: Notice, device: { token: string; environment: "development" | "production" }): ApnsMessage {
  const interruption = n.interruption ?? "active";
  const imageKey = n.imageKey ?? IMAGE_KEYS[n.kind];
  const relevance = n.relevance ?? DEFAULT_RELEVANCE[n.kind];
  return {
    deviceToken: device.token,
    environment: device.environment,
    title: n.title,
    body: n.body,
    data: {
      kind: n.kind,
      deepLink: n.deepLink,
      ...(n.tripId != null ? { tripId: n.tripId } : {}),
      ...(n.eventId != null ? { eventId: n.eventId } : {}),
      ...(imageKey ? { imageKey } : {}),
      interruption,
      ...(relevance != null ? { relevance } : {}),
      ...(n.ticket ? { ticket: n.ticket } : {}),
      ...n.data,
    },
    category: n.kind,
    threadId: n.threadId ?? (n.tripId != null ? `trip-${n.tripId}` : undefined),
    interruptionLevel: interruption === "time-sensitive" ? "time-sensitive" : "active",
    ...(n.expiresAt != null ? { expiration: Math.floor(n.expiresAt / 1000) } : {}),
  };
}

export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly transport: PushTransport | null,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Meldet jedem Benutzer höchstens einmal je `dedupeKey`, respektiert Einstellungen und verwaiste Token. */
  async deliver(notices: Notice[]): Promise<DeliveryReport> {
    const r: DeliveryReport = { sent: 0, skippedPrefs: 0, skippedDuplicate: 0, noDevice: 0, failed: 0, deferred: 0, quiet: 0 };
    for (const n of notices) {
      const prefs = getPrefs(this.db, n.userId);
      if (!prefs[PREF_KEYS[n.kind]]) {
        r.skippedPrefs += 1;
        continue;
      }
      if (this.db.prepare("SELECT 1 FROM notification_log WHERE user_id = ? AND dedupe_key = ?").get(n.userId, n.dedupeKey)) {
        r.skippedDuplicate += 1;
        continue;
      }
      // Ruhezeiten: unkritische Meldungen warten bis zum Ende der Ruhezeit (zeitkritische sind ausgenommen)
      const hold = quietDeferral(this.db, n, prefs, this.now().getTime());
      if (hold) {
        r.quiet += 1;
        if (hold === "queue") this.queueQuiet(n);
        continue;
      }
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO notification_log (user_id, dedupe_key, kind, title, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(n.userId, n.dedupeKey, n.kind, n.title, n.body, this.now().toISOString());
      if (inserted.changes === 0) {
        r.skippedDuplicate += 1;
        continue;
      }
      const devices = this.db
        .prepare(
          `SELECT t.id, t.apns_token, t.apns_environment FROM api_tokens t
             JOIN users u ON u.id = t.user_id
            WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.apns_token IS NOT NULL AND u.active = 1`
        )
        .all(n.userId) as DeviceRow[];
      if (devices.length === 0) {
        r.noDevice += 1; // kein Gerät: bleibt als «gemeldet» vermerkt, damit später nichts nachgeflutet wird
        continue;
      }
      if (!this.transport) {
        this.db.prepare("DELETE FROM notification_log WHERE user_id = ? AND dedupe_key = ?").run(n.userId, n.dedupeKey);
        r.deferred += 1;
        continue;
      }
      let delivered = 0;
      let transient = 0;
      let notConfigured = 0;
      for (const d of devices) {
        const msg = noticeMessage(n, { token: d.apns_token, environment: d.apns_environment ?? "production" });
        const res = await this.transport.send(msg).catch(
          (e): { ok: false; status: number; reason: string; invalidToken: boolean } => ({
            ok: false, status: 0, reason: e instanceof Error ? e.message : "error", invalidToken: false,
          })
        );
        if (res.ok) {
          r.sent += 1;
          delivered += 1;
        } else if (isNotConfigured(res)) {
          notConfigured += 1;
          transient += 1;
        } else {
          r.failed += 1;
          if (res.invalidToken) {
            this.db.prepare("UPDATE api_tokens SET apns_token = NULL, apns_environment = NULL WHERE id = ?").run(d.id);
          } else {
            transient += 1;
          }
        }
      }
      // Nichts zugestellt und Fehler nicht endgültig (z. B. APNs-Schlüssel noch nicht eingerichtet,
      // Netzwerk): Eintrag zurücknehmen, damit der nächste Lauf es erneut versucht.
      if (delivered === 0 && transient > 0) {
        this.db.prepare("DELETE FROM notification_log WHERE user_id = ? AND dedupe_key = ?").run(n.userId, n.dedupeKey);
        if (notConfigured > 0) r.deferred += 1;
      }
    }
    return r;
  }

  /** Meldung für das Ende der Ruhezeit vormerken (`kv`, einmal je Benutzer und Schlüssel). */
  private queueQuiet(n: Notice): void {
    this.db
      .prepare("INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES (?, ?, ?)")
      .run(`qd:${n.userId}:${n.dedupeKey}`, JSON.stringify(n), this.now().toISOString());
  }

  /**
   * Vorgemerkte Meldungen senden, deren Ruhezeit vorbei ist (der Scheduler ruft das bei jedem Lauf auf).
   * Meldungen, die länger als 36 Stunden warten, verfallen.
   */
  async flushQuiet(): Promise<DeliveryReport> {
    const total: DeliveryReport = { sent: 0, skippedPrefs: 0, skippedDuplicate: 0, noDevice: 0, failed: 0, deferred: 0, quiet: 0 };
    const rows = this.db.prepare("SELECT key, value, updated_at FROM kv WHERE key LIKE 'qd:%' ORDER BY updated_at, key").all() as Array<{
      key: string;
      value: string | null;
      updated_at: string;
    }>;
    const nowMs = this.now().getTime();
    for (const row of rows) {
      let n: Notice | null = null;
      try {
        n = JSON.parse(row.value ?? "") as Notice;
      } catch {
        n = null;
      }
      if (!n || nowMs - Date.parse(row.updated_at) > 36 * 3_600_000) {
        this.db.prepare("DELETE FROM kv WHERE key = ?").run(row.key);
        continue;
      }
      if (quietDeferral(this.db, n, getPrefs(this.db, n.userId), nowMs)) continue; // noch Ruhezeit
      this.db.prepare("DELETE FROM kv WHERE key = ?").run(row.key);
      const r = await this.deliver([{ ...n, quiet: false }]);
      for (const k of Object.keys(total) as Array<keyof DeliveryReport>) total[k] += r[k];
    }
    return total;
  }

  /* ─ Ereignisse aus der Anwendung ─ */

  /**
   * Aktive Konten, die Teilnehmer der Reisekasse sind, ausser dem Auslöser. Mitreisende mit Konto dürfen die
   * Reisekasse ihrer Reise lesen und buchen (`auth/roles.ts`), also erhalten sie auch die Meldungen; eigenständige
   * Kassen ohne Reise (Altdaten) sind Administratoren vorbehalten, dort gehen Meldungen nur an diese.
   */
  private ledgerUsers(ledgerId: number, exceptUserId: number | null): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT p.user_id FROM participants p
             JOIN users u ON u.id = p.user_id
             JOIN ledgers l ON l.id = p.ledger_id
            WHERE p.ledger_id = ? AND u.active = 1 AND (u.is_admin = 1 OR l.trip_id IS NOT NULL)`
        )
        .all(ledgerId) as { user_id: number }[]
    )
      .map((r) => r.user_id)
      .filter((id) => id !== exceptUserId);
  }

  private ledgerTrip(ledgerId: number) {
    return this.db
      .prepare("SELECT l.title, l.trip_id FROM ledgers l WHERE l.id = ?")
      .get(ledgerId) as { title: string; trip_id: number | null } | undefined;
  }

  expenseCreated(e: { ledgerId: number; expenseId: number; actorUserId: number | null; actorName: string; amountLabel: string; description: string | null }) {
    const l = this.ledgerTrip(e.ledgerId);
    return this.deliver(
      this.ledgerUsers(e.ledgerId, e.actorUserId).map((userId) => ({
        userId,
        kind: "ledger.expense" as const,
        dedupeKey: `expense:${e.expenseId}`,
        title: l?.title ?? "Reisekasse",
        body: `${e.actorName}: ${e.description?.trim() || "Neue Ausgabe"} · ${e.amountLabel}`,
        deepLink: `travelbuddy://ledger/${e.ledgerId}`,
        ...(l?.trip_id != null ? { tripId: l.trip_id } : {}),
        data: { ledgerId: e.ledgerId, expenseId: e.expenseId },
        threadId: `ledger-${e.ledgerId}`,
      }))
    );
  }

  settlementCreated(s: { ledgerId: number; settlementId: number; actorUserId: number | null; fromName: string; toName: string; toUserId: number | null; amountLabel: string }) {
    const l = this.ledgerTrip(s.ledgerId);
    // Der Empfänger wird immer informiert; andere Teilnehmer sehen es in der Reisekasse.
    const users =
      s.toUserId != null && s.toUserId !== s.actorUserId && this.ledgerUsers(s.ledgerId, null).includes(s.toUserId) ? [s.toUserId] : [];
    return this.deliver(
      users.map((userId) => ({
        userId,
        kind: "ledger.settlement" as const,
        dedupeKey: `settlement:${s.settlementId}`,
        title: l?.title ?? "Reisekasse",
        body: `${s.fromName} hat dir ${s.amountLabel} zurückgezahlt`,
        deepLink: `travelbuddy://ledger/${s.ledgerId}`,
        ...(l?.trip_id != null ? { tripId: l.trip_id } : {}),
        data: { ledgerId: s.ledgerId, settlementId: s.settlementId },
        threadId: `ledger-${s.ledgerId}`,
      }))
    );
  }

  tripComment(c: { tripId: number; eventId: number; commentId: number; actorUserId: number | null; actorName: string; body: string }) {
    const trip = this.db.prepare("SELECT title FROM trips WHERE id = ?").get(c.tripId) as { title: string } | undefined;
    const users = (
      this.db
        .prepare("SELECT DISTINCT user_id FROM participants WHERE trip_id = ? AND user_id IS NOT NULL")
        .all(c.tripId) as { user_id: number }[]
    )
      .map((r) => r.user_id)
      .filter((id) => id !== c.actorUserId);
    return this.deliver(
      users.map((userId) => ({
        userId,
        kind: "trip.comment" as const,
        dedupeKey: `trip-comment:${c.commentId}`,
        title: trip?.title ?? "Reise",
        body: `${c.actorName}: ${c.body.length > 120 ? `${c.body.slice(0, 117)}…` : c.body}`,
        deepLink: `travelbuddy://event/${c.tripId}/${c.eventId}`,
        tripId: c.tripId,
        eventId: c.eventId,
        threadId: `trip-${c.tripId}`,
      }))
    );
  }

  /**
   * Neue Vorschläge aus Dokumenten (Aufruf durch «ingest» nach der Analyse). Empfänger: Administratoren, die an der
   * Reise beteiligt sind (Teilnehmer oder Ersteller), sonst alle aktiven Administratoren, denn nur sie können
   * Vorschläge bestätigen. Dieselbe Anzahl wird innerhalb einer Stunde nur einmal gemeldet.
   */
  review(tripId: number, count: number): Promise<DeliveryReport> {
    const empty: DeliveryReport = { sent: 0, skippedPrefs: 0, skippedDuplicate: 0, noDevice: 0, failed: 0, deferred: 0, quiet: 0 };
    if (!Number.isFinite(count) || count <= 0) return Promise.resolve(empty);
    const trip = this.db.prepare("SELECT title, created_by_user_id FROM trips WHERE id = ?").get(tripId) as
      | { title: string; created_by_user_id: number | null }
      | undefined;
    if (!trip) return Promise.resolve(empty);
    let users = (
      this.db
        .prepare(
          `SELECT DISTINCT u.id FROM users u
            WHERE u.is_admin = 1 AND u.active = 1
              AND (u.id = ? OR EXISTS (SELECT 1 FROM participants p WHERE p.trip_id = ? AND p.user_id = u.id))`
        )
        .all(trip.created_by_user_id ?? -1, tripId) as { id: number }[]
    ).map((r) => r.id);
    if (users.length === 0) {
      users = (this.db.prepare("SELECT id FROM users WHERE is_admin = 1 AND active = 1").all() as { id: number }[]).map((r) => r.id);
    }
    const bucket = Math.floor(this.now().getTime() / 3_600_000);
    const title = count === 1 ? "1 Vorschlag zu prüfen" : `${count} Vorschläge zu prüfen`;
    return this.deliver(
      users.map((userId) => ({
        userId,
        kind: "trip.review" as const,
        dedupeKey: `review:${tripId}:${count}:${bucket}`,
        title,
        body: `${trip.title}: Neue Vorschläge aus Dokumenten warten auf Bestätigung.`,
        deepLink: "travelbuddy://inbox",
        tripId,
        interruption: "active" as const,
        ticket: { icon: "doc", color: "doc", title, tripTitle: trip.title, count },
        threadId: `trip-${tripId}`,
      }))
    );
  }
}
