/**
 * Benutzer anlegen:
 *   npm run user:create -- <username> <anzeigename> [--admin] [--email=a@b.ch]
 * Das Passwort wird interaktiv abgefragt (oder via TRAVELBUDDY_PASSWORD gesetzt).
 */
import { createInterface } from "node:readline";
import { createUser } from "../src/auth/auth";
import { migrate, openDb } from "../src/db/client";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [username, displayName] = args.filter((a) => !a.startsWith("--"));
if (!username || !displayName) {
  console.error("Aufruf: npm run user:create -- <username> <anzeigename> [--admin] [--email=…]");
  process.exit(1);
}

async function readPassword(): Promise<string> {
  if (process.env.TRAVELBUDDY_PASSWORD) return process.env.TRAVELBUDDY_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Passwort (mind. 12 Zeichen): ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Passwort ist zu kurz (mind. 12 Zeichen).");
  process.exit(1);
}

const db = openDb(process.env.TRAVELBUDDY_DB_PATH ?? "./data/travelbuddy.sqlite");
migrate(db);
const email = flags.find((f) => f.startsWith("--email="))?.slice("--email=".length) ?? null;
const id = await createUser(db, {
  username,
  displayName,
  password,
  email,
  isAdmin: flags.includes("--admin"),
});
console.log(`Benutzer «${username}» angelegt (id ${id}).`);
