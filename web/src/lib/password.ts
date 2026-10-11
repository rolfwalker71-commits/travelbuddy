/** Zeichen ohne leicht verwechselbare (0/O, 1/l/I). */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const MIN_PASSWORD_LENGTH = 12;

/** Zufälliges Passwort mit Rejection Sampling (kein Modulo-Bias). */
export function generatePassword(length = 16, random: (n: number) => Uint8Array = defaultRandom): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const b of random(length * 2)) {
      if (b < limit) out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function checkNewPassword(pw: string, repeat?: string): PasswordCheck {
  if (pw.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen` };
  if (repeat !== undefined && pw !== repeat) return { ok: false, error: "Die Wiederholung stimmt nicht überein" };
  return { ok: true };
}
