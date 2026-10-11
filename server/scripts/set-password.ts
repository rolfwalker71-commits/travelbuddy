/**
 * Passwort eines bestehenden Benutzers zurücksetzen (z. B. wenn es nach dem Import unbekannt ist):
 *   npm run user:password -- <username>
 * Das Passwort wird interaktiv abgefragt (oder via TRAVELBUDDY_PASSWORD gesetzt). Alle angemeldeten
 * Geräte dieses Benutzers werden abgemeldet.
 */
import { createInterface } from "node:readline";
import { changePassword, MIN_PASSWORD_LENGTH } from "../src/auth/auth";
import { migrate, openDb } from "../src/db/client";

const username = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!username) {
  console.error("Aufruf: npm run user:password -- <username>");
  process.exit(1);
}

const db = openDb(process.env.TRAVELBUDDY_DB_PATH ?? "./data/travelbuddy.sqlite");
migrate(db);
const user = db
  .prepare("SELECT id, username, display_name FROM users WHERE username = ? COLLATE NOCASE")
  .get(username) as { id: number; username: string; display_name: string } | undefined;
if (!user) {
  const all = (db.prepare("SELECT username FROM users ORDER BY username COLLATE NOCASE").all() as { username: string }[])
    .map((u) => u.username)
    .join(", ");
  console.error(`Benutzer «${username}» nicht gefunden. Vorhanden: ${all}`);
  process.exit(1);
}

async function readPassword(): Promise<string> {
  if (process.env.TRAVELBUDDY_PASSWORD) return process.env.TRAVELBUDDY_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Neues Passwort für ${user!.username} (mind. ${MIN_PASSWORD_LENGTH} Zeichen): `, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

const password = await readPassword();
try {
  await changePassword(db, user.id, password);
  console.log(`Passwort von «${user.username}» geändert; alle Geräte wurden abgemeldet.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
