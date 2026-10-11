import { createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http2 from "node:http2";

export type ApnsConfig = {
  /** Inhalt der .p8-Datei (PKCS#8, PEM). */
  key: string;
  keyId: string;
  teamId: string;
  /** Bundle-ID der App. */
  topic: string;
};

export type ApnsMessage = {
  deviceToken: string;
  environment: "development" | "production";
  title: string;
  body: string;
  /** Eigene Daten für die App (z.B. Ziel zum Öffnen). */
  data?: Record<string, unknown>;
  /**
   * Art der Zustellung (`apns-push-type`); Standard `alert`. Live Activities: `liveactivity` mit `topic`
   * `<bundle>.push-type.liveactivity` und vollständigem `rawPayload` (aps.timestamp, event, content-state).
   */
  pushType?: "alert" | "background" | "liveactivity";
  /** Übersteuert das Standard-Topic (Bundle-ID). */
  topic?: string;
  /** Vollständige Nutzlast statt der aus Titel/Text gebauten (Live Activities). */
  rawPayload?: Record<string, unknown>;
  threadId?: string;
  /** `aps.category` (= Mitteilungsart, z. B. `trip.depart`). */
  category?: string;
  badge?: number;
  /** time-sensitive für Fälligkeiten. */
  interruptionLevel?: "passive" | "active" | "time-sensitive";
  /**
   * `apns-priority`: 10 sofort, 5 energieschonend (Live-Activity-Aktualisierungen ohne Übergang).
   * Ohne Angabe: 5 bei `passive`, sonst 10.
   */
  priority?: 5 | 10;
  /** `apns-collapse-id` (ersetzt eine noch nicht zugestellte Mitteilung gleicher Kennung). */
  collapseId?: string;
  /** `apns-expiration` (Unix-Sekunden): danach verwirft APNs die Meldung, z. B. eine überholte Abflug-Erinnerung. */
  expiration?: number;
};

export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string; /** Token ist dauerhaft ungültig */ invalidToken: boolean };

export type PushStatus =
  | { configured: true; keyId: string; teamId: string; topic: string; source: "env" | "file"; file: string | null }
  | { configured: false; reason: string; searched: string | null };

export interface PushTransport {
  send(msg: ApnsMessage): Promise<ApnsResult>;
  /** Für Diagnose (Admin): Ist ein Schlüssel vorhanden und lesbar? */
  status?(): PushStatus;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** ES256-JWT für APNs (gültig höchstens 60 min; Apple verlangt Erneuerung nicht öfter als alle 20 min). */
export function apnsJwt(cfg: Pick<ApnsConfig, "key" | "keyId" | "teamId">, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec }));
  const input = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(cfg.key),
    dsaEncoding: "ieee-p1363", // r||s, wie JWT es verlangt
  });
  return `${input}.${b64url(sig)}`;
}

/**
 * Nutzlast gemäss Vertrag: `aps.mutable-content = 1` (Service-Extension), `aps.category = kind`,
 * `aps.thread-id`; Top-Level `deepLink`, `tripId`, `eventId?`, `kind`, `imageKey?`, `interruption`,
 * `relevance?` und optional `ticket` (aus `data`).
 */
export function buildApnsPayload(m: ApnsMessage) {
  const relevance = typeof m.data?.relevance === "number" ? (m.data.relevance as number) : undefined;
  return {
    aps: {
      alert: { title: m.title, body: m.body },
      sound: "default",
      "mutable-content": 1,
      ...(m.category ? { category: m.category } : {}),
      ...(m.badge != null ? { badge: m.badge } : {}),
      ...(m.threadId ? { "thread-id": m.threadId } : {}),
      ...(m.interruptionLevel ? { "interruption-level": m.interruptionLevel } : {}),
      ...(relevance != null ? { "relevance-score": relevance } : {}),
    },
    ...(m.data ?? {}),
  };
}

/** Topic je Art: Live Activities brauchen `<bundle>.push-type.liveactivity`, alles andere die Bundle-ID. */
export function apnsTopic(bundleId: string, pushType?: ApnsMessage["pushType"]): string {
  return pushType === "liveactivity" ? `${bundleId}.push-type.liveactivity` : bundleId;
}

/** Ergebnis eines Transports ohne Schlüssel (Trockenlauf): nichts gesendet, nichts als gesendet markieren. */
export function isNotConfigured(r: ApnsResult): boolean {
  return !r.ok && r.reason.startsWith("not_configured");
}

const INVALID_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** APNs über HTTP/2 mit Token-Authentifizierung. */
export class ApnsTransport implements PushTransport {
  private sessions = new Map<string, http2.ClientHttp2Session>();
  private jwt: { token: string; issuedAt: number } | null = null;

  constructor(
    private readonly cfg: ApnsConfig,
    private readonly now: () => number = () => Date.now(),
    /** Nur für Tests: lokaler HTTP/2-Server statt `api.push.apple.com`. */
    private readonly originOverride?: string
  ) {}

  private session(origin: string): http2.ClientHttp2Session {
    const existing = this.sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = http2.connect(origin);
    s.on("error", () => this.sessions.delete(origin));
    s.on("close", () => this.sessions.delete(origin));
    s.unref();
    this.sessions.set(origin, s);
    return s;
  }

  /** Offene Verbindungen schliessen (Herunterfahren, Tests). */
  close(): void {
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
  }

  private token(): string {
    const nowSec = Math.floor(this.now() / 1000);
    if (!this.jwt || nowSec - this.jwt.issuedAt > 40 * 60) {
      this.jwt = { token: apnsJwt(this.cfg, nowSec), issuedAt: nowSec };
    }
    return this.jwt.token;
  }

  send(msg: ApnsMessage): Promise<ApnsResult> {
    const origin =
      this.originOverride ?? (msg.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    return new Promise((resolve) => {
      let session: http2.ClientHttp2Session;
      try {
        session = this.session(origin);
      } catch (e) {
        resolve({ ok: false, status: 0, reason: e instanceof Error ? e.message : "connect", invalidToken: false });
        return;
      }
      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${msg.deviceToken}`,
        authorization: `bearer ${this.token()}`,
        "apns-topic": msg.topic ?? apnsTopic(this.cfg.topic, msg.pushType),
        "apns-push-type": msg.pushType ?? "alert",
        "apns-priority": String(msg.priority ?? (msg.interruptionLevel === "passive" ? 5 : 10)),
        ...(msg.collapseId ? { "apns-collapse-id": msg.collapseId } : {}),
        ...(msg.expiration != null ? { "apns-expiration": String(Math.floor(msg.expiration)) } : {}),
        "content-type": "application/json",
      });
      let status = 0;
      let data = "";
      req.setEncoding("utf8");
      req.on("response", (h) => (status = Number(h[":status"] ?? 0)));
      req.on("data", (c) => (data += c));
      req.on("error", (e) => resolve({ ok: false, status: 0, reason: e.message, invalidToken: false }));
      req.on("end", () => {
        if (status === 200) return resolve({ ok: true });
        let reason = "unknown";
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? reason;
        } catch {
          /* leer */
        }
        resolve({ ok: false, status, reason, invalidToken: status === 410 || INVALID_REASONS.has(reason) });
      });
      req.setTimeout(15_000, () => {
        req.close();
        resolve({ ok: false, status: 0, reason: "timeout", invalidToken: false });
      });
      req.end(JSON.stringify(msg.rawPayload ?? buildApnsPayload(msg)));
    });
  }
}

/* ───────────── Schlüssel finden: Datei in den apns-Ordner legen genügt ───────────── */

const DEFAULT_TEAM_ID = "9XZWUZ7Z26";
const DEFAULT_TOPIC = "ch.rolfwalker.travelbuddy";
const KEY_FILE = /^AuthKey_([A-Z0-9]{10})\.p8$/;

export type ApnsDiscovery =
  | { ok: true; config: ApnsConfig; source: "env" | "file"; file: string | null; fingerprint: string }
  | { ok: false; reason: string };

/**
 * Reihenfolge: `APNS_KEY` (Inhalt) → `APNS_KEY_PATH` → neueste `AuthKey_<KEYID>.p8` im Ordner.
 * Die Key-ID wird aus dem Dateinamen gelesen (so benennt Apple die Datei), `APNS_KEY_ID` hat Vorrang.
 */
export function discoverApns(opts: { dir: string; env: Record<string, string | undefined> }): ApnsDiscovery {
  const { env } = opts;
  const teamId = env.APNS_TEAM_ID || DEFAULT_TEAM_ID;
  const topic = env.APNS_TOPIC || DEFAULT_TOPIC;

  let pem: string | null = null;
  let keyId = env.APNS_KEY_ID || null;
  let source: "env" | "file" = "env";
  let file: string | null = null;
  let fingerprint = "env";

  if (env.APNS_KEY) {
    pem = env.APNS_KEY.replace(/\\n/g, "\n");
  } else {
    file = env.APNS_KEY_PATH || null;
    if (!file) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(opts.dir).filter((n) => KEY_FILE.test(n));
      } catch {
        /* Ordner fehlt noch */
      }
      const newest = names
        .map((n) => ({ n, t: fs.statSync(path.join(opts.dir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0];
      if (!newest) {
        return { ok: false, reason: `Keine Datei AuthKey_<KEYID>.p8 in ${opts.dir}` };
      }
      file = path.join(opts.dir, newest.n);
    }
    source = "file";
    try {
      const st = fs.statSync(file);
      fingerprint = `${file}:${st.mtimeMs}:${st.size}`;
      pem = fs.readFileSync(file, "utf8");
    } catch (e) {
      return { ok: false, reason: `Schlüsseldatei nicht lesbar: ${e instanceof Error ? e.message : e}` };
    }
    keyId = keyId || KEY_FILE.exec(path.basename(file))?.[1] || null;
  }

  if (!keyId) return { ok: false, reason: "Key-ID unbekannt (Dateiname AuthKey_<KEYID>.p8 oder APNS_KEY_ID)" };
  try {
    createPrivateKey(pem);
  } catch {
    return { ok: false, reason: "Der Schlüssel ist keine gültige .p8-Datei (PKCS#8)" };
  }
  return { ok: true, config: { key: pem, keyId, teamId, topic }, source, file, fingerprint };
}

/**
 * Transport, der den Schlüssel bei Bedarf sucht: Die Datei kann zur Laufzeit abgelegt oder
 * ausgetauscht werden, ein Neustart des Containers ist nicht nötig.
 */
export class AutoApnsTransport implements PushTransport {
  private current: { fingerprint: string; transport: PushTransport } | null = null;

  constructor(
    private readonly opts: {
      dir: string;
      env: Record<string, string | undefined>;
      create?: (cfg: ApnsConfig) => PushTransport;
    }
  ) {}

  private resolve(): { transport: PushTransport; discovery: Extract<ApnsDiscovery, { ok: true }> } | { reason: string } {
    const d = discoverApns(this.opts);
    if (!d.ok) {
      this.current = null;
      return { reason: d.reason };
    }
    if (!this.current || this.current.fingerprint !== d.fingerprint) {
      const make = this.opts.create ?? ((cfg: ApnsConfig) => new ApnsTransport(cfg));
      this.current = { fingerprint: d.fingerprint, transport: make(d.config) };
    }
    return { transport: this.current.transport, discovery: d };
  }

  status(): PushStatus {
    const d = discoverApns(this.opts);
    if (!d.ok) return { configured: false, reason: d.reason, searched: this.opts.dir };
    return {
      configured: true,
      keyId: d.config.keyId,
      teamId: d.config.teamId,
      topic: d.config.topic,
      source: d.source,
      file: d.file ? path.basename(d.file) : null,
    };
  }

  async send(msg: ApnsMessage): Promise<ApnsResult> {
    const r = this.resolve();
    if ("reason" in r) return { ok: false, status: 0, reason: `not_configured: ${r.reason}`, invalidToken: false };
    return r.transport.send(msg);
  }
}
