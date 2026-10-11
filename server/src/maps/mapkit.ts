import { createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";

/**
 * Apple Karten (MapKit JS). Der Server signiert kurzlebige JWTs (ES256) mit dem privaten MapKit-Schlüssel;
 * der Browser holt sie über `GET /v1/maps/token`. Der Schlüssel verlässt den Server nie.
 */
export type MapkitConfig = {
  teamId: string;
  keyId: string;
  /** PEM (PKCS#8, `-----BEGIN PRIVATE KEY-----`). */
  privateKey: string;
  /** Optional: Ursprung der Web-App (`https://host`). Apple bindet das Token daran. Ohne: kein Claim. */
  origin: string | null;
};

const PREFIX = "TRAVELBUDDY_MAPKIT_";

/**
 * Macht aus dem Wert einer Umgebungsvariable ein PEM: entfernt umschliessende Anführungszeichen, wandelt
 * ausgeschriebene `\n` in Zeilenumbrüche und ergänzt fehlende BEGIN/END-Zeilen (reiner Base64-Körper).
 */
export function normalizePrivateKey(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  s = s.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n").trim();
  if (!s.includes("-----BEGIN")) {
    const body = s.replace(/\s+/g, "");
    s = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PRIVATE KEY-----`;
  }
  return s;
}

/** Normalisiert `https://host/pfad` zu `https://host`; ungültige Werte ergeben null. */
export function normalizeOrigin(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Liest die Konfiguration aus `TRAVELBUDDY_MAPKIT_TEAM_ID`, `…_KEY_ID`, `…_KEY` (PEM, Zeilenumbrüche als `\n`;
 * `…_PRIVATE_KEY` wird ebenfalls gelesen) oder `…_KEY_PATH` (Pfad zur `.p8`) und `…_ORIGIN`.
 * null, wenn Team-ID, Key-ID oder Schlüssel fehlen oder der Schlüssel nicht lesbar ist.
 */
export function mapkitConfigFromEnv(
  env: Record<string, string | undefined>,
  warn: (msg: string) => void = console.warn
): MapkitConfig | null {
  const get = (name: string) => env[PREFIX + name]?.trim() ?? "";
  const teamId = get("TEAM_ID");
  const keyId = get("KEY_ID");
  let rawKey = get("KEY") || get("PRIVATE_KEY");
  const keyPath = get("KEY_PATH");
  if (!rawKey && keyPath) {
    try {
      rawKey = fs.readFileSync(keyPath, "utf8");
    } catch {
      warn("MapKit: KEY_PATH ist nicht lesbar; Apple Karten bleiben aus.");
      return null;
    }
  }
  if (!teamId && !keyId && !rawKey) return null;
  if (!teamId || !keyId || !rawKey) {
    warn("MapKit: TEAM_ID, KEY_ID und KEY (oder KEY_PATH) müssen zusammen gesetzt sein; Apple Karten bleiben aus.");
    return null;
  }
  const privateKey = normalizePrivateKey(rawKey);
  try {
    createPrivateKey(privateKey);
  } catch {
    warn("MapKit: Der Schlüssel ist kein lesbarer privater Schlüssel (PEM, PKCS#8); Apple Karten bleiben aus.");
    return null;
  }
  return { teamId, keyId, privateKey, origin: normalizeOrigin(get("ORIGIN")) };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Lebensdauer eines Tokens. MapKit JS holt bei Ablauf selbst ein neues. */
export const MAPKIT_TOKEN_TTL_SECONDS = 30 * 60;

/** ES256-JWT nach Apples Vorgabe (`kid`, `iss` = Team-ID, `iat`, `exp`, optional `origin`). */
export function mapkitToken(cfg: MapkitConfig, nowSec: number, ttlSec = MAPKIT_TOKEN_TTL_SECONDS): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cfg.teamId,
      iat: nowSec,
      exp: nowSec + ttlSec,
      ...(cfg.origin ? { origin: cfg.origin } : {}),
    })
  );
  const input = `${header}.${claims}`;
  const sig = sign("sha256", Buffer.from(input), { key: createPrivateKey(cfg.privateKey), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}
