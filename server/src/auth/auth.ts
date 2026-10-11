import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "../db/client";
import { HttpError } from "../lib/errors";

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;

/**
 * Format `scrypt:<salt>:<hash>` ist identisch mit HomeBuddy/FamilyBrain, damit bestehende
 * Passwort-Hashes beim Umzug unverändert übernommen werden können.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const want = Buffer.from(expected, "base64url");
  return actual.length === want.length && timingSafeEqual(actual, want);
}

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  tokenId: number;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function issueToken(
  db: Db,
  userId: number,
  meta: { deviceName?: string | null; platform?: string | null } = {}
): string {
  const token = `tb_${randomBytes(32).toString("base64url")}`;
  db.prepare(
    `INSERT INTO api_tokens (user_id, token_hash, device_name, platform, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, hashToken(token), meta.deviceName ?? null, meta.platform ?? null, new Date().toISOString());
  return token;
}

/** Geräte-Token verfallen nach so vielen Tagen ohne Nutzung. */
export const TOKEN_IDLE_DAYS = 180;

export function authenticate(db: Db, token: string, now = new Date()): AuthUser | null {
  const cutoff = new Date(now.getTime() - TOKEN_IDLE_DAYS * 86_400_000).toISOString();
  const row = db
    .prepare(
      `SELECT t.id AS token_id, u.id, u.username, u.display_name, u.email, u.is_admin
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.active = 1
          AND COALESCE(t.last_used_at, t.created_at) > ?`
    )
    .get(hashToken(token), cutoff) as
    | { token_id: number; id: number; username: string; display_name: string; email: string | null; is_admin: number }
    | undefined;
  if (!row) return null;
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.token_id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    isAdmin: row.is_admin === 1,
    tokenId: row.token_id,
  };
}

export function revokeToken(db: Db, tokenId: number): void {
  db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    tokenId
  );
}

export async function createUser(
  db: Db,
  input: {
    username: string;
    password: string;
    displayName: string;
    email?: string | null;
    isAdmin?: boolean;
    passwordHash?: string;
  }
): Promise<number> {
  const username = input.username.trim();
  if (username.length < 2) throw new HttpError(422, "invalid_username", "Benutzername zu kurz");
  const hash = input.passwordHash ?? (await hashPassword(input.password));
  try {
    const res = db
      .prepare(
        `INSERT INTO users (username, display_name, email, password_hash, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(username, input.displayName.trim() || username, input.email ?? null, hash, input.isAdmin ? 1 : 0, new Date().toISOString());
    return Number(res.lastInsertRowid);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new HttpError(409, "username_taken", "Benutzername ist bereits vergeben");
    }
    throw err;
  }
}

/**
 * In-Memory-Limiter gegen Passwort-Raten. Wird je Benutzername und je IP getrennt
 * geführt: Ein gefälschter X-Forwarded-For umgeht so nicht die Sperre pro Benutzername.
 */
export class LoginThrottle {
  private fails = new Map<string, { count: number; first: number }>();
  constructor(
    private readonly max = 8,
    private readonly windowMs = 15 * 60 * 1000
  ) {}

  check(key: string, now = Date.now()): void {
    const e = this.fails.get(key);
    if (!e) return;
    if (now - e.first > this.windowMs) {
      this.fails.delete(key);
      return;
    }
    if (e.count >= this.max) {
      throw new HttpError(429, "too_many_attempts", "Zu viele Versuche, bitte später erneut versuchen");
    }
  }

  fail(key: string, now = Date.now()): void {
    const e = this.fails.get(key);
    if (!e || now - e.first > this.windowMs) this.fails.set(key, { count: 1, first: now });
    else e.count += 1;
  }

  success(key: string): void {
    this.fails.delete(key);
  }
}

export const MIN_PASSWORD_LENGTH = 12;

export async function changePassword(db: Db, userId: number, newPassword: string, keepTokenId?: number): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(422, "password_too_short", `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
  }
  const hash = await hashPassword(newPassword);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
    // Alle anderen Geräte müssen sich neu anmelden.
    db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?").run(
      new Date().toISOString(), userId, keepTokenId ?? -1
    );
  })();
}
