import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate, openDb } from "../src/db/client";
import { bootstrapImport, bootstrapSource } from "../src/import/bootstrap";
import { buildFixture, type Fixture } from "./import-fixture";

function target() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-bootstrap-"));
  const db = openDb(":memory:");
  migrate(db);
  return { db, dir, documentsDir: path.join(dir, "documents"), mediaDir: path.join(dir, "media") };
}

async function withEnv<T>(o: Parameters<typeof buildFixture>[0], fn: (fx: Fixture, t: ReturnType<typeof target>, lines: string[]) => Promise<T>) {
  const fx = await buildFixture(o);
  const t = target();
  try {
    return await fn(fx, t, []);
  } finally {
    fx.cleanup();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}

const trips = (db: ReturnType<typeof target>["db"]) => (db.prepare("SELECT COUNT(*) AS n FROM trips").get() as { n: number }).n;

test("bootstrap: leere Datenbank + Quelle → importiert, Dokumente und Bericht, Abnahme bestanden", async () => {
  await withEnv({ withSummary: true }, async (fx, t, lines) => {
    const r = await bootstrapImport(t, {
      env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite },
      dataDir: t.dir,
      log: (l) => lines.push(l),
    });
    assert.equal(r.status, "imported");
    assert.equal(trips(t.db), 2);
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM documents").get() as any).n, 2, "Dokumente aus <ordner>/documents");
    assert.ok(lines.some((l) => /Abnahme bestanden/.test(l)), lines.join("\n"));
    assert.ok(lines.some((l) => /zu prüfen/.test(l)), "Ereignisse zu prüfen werden im Log genannt");
    assert.ok(!lines.some((l) => /user:create/.test(l)), "aktive Benutzer vorhanden: kein Hinweis");
    const out = path.join(t.dir, "import-out");
    assert.ok(fs.existsSync(path.join(out, "report.json")));
    assert.match(fs.readFileSync(path.join(out, "report.txt"), "utf8"), /Import abgeschlossen/);
    // Zweiter Start: Datenbank hat Reisen → nichts mehr
    const again = await bootstrapImport(t, { env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite }, dataDir: t.dir });
    assert.deepEqual(again, { status: "skipped", reason: "Datenbank enthält bereits Reisen" });
    assert.equal(trips(t.db), 2);
  });
});

test("bootstrap: gefüllte Datenbank, «off» und fehlende Quelle überspringen", async () => {
  await withEnv({}, async (fx, t) => {
    t.db.prepare("INSERT INTO trips (title, created_at, updated_at) VALUES ('Vorhanden', 'x', 'x')").run();
    const filled = await bootstrapImport(t, { env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite }, dataDir: t.dir });
    assert.equal(filled.status, "skipped");
    assert.equal(trips(t.db), 1);
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM import_map").get() as any).n, 0);
  });
  await withEnv({}, async (fx, t) => {
    const off = await bootstrapImport(t, {
      env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: "off", npm_lifecycle_event: "dev" },
      dataDir: t.dir,
      cwd: path.join(fx.dir, "server"),
    });
    assert.equal(off.status, "skipped");
    assert.equal(trips(t.db), 0);
    const lines: string[] = [];
    const missing = await bootstrapImport(t, {
      env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: path.join(fx.dir, "gibtsnicht.sqlite") },
      dataDir: t.dir,
      log: (l) => lines.push(l),
    });
    assert.equal(missing.status, "skipped");
    assert.match(lines.join("\n"), /nicht gefunden/);
  });
});

test("bootstrap: Dev-Modus nimmt ../import-in/homebuddy.sqlite, ohne Dev-Modus keine Vorgabe", async () => {
  await withEnv({ withSummary: true }, async (fx, t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-root-"));
    try {
      fs.mkdirSync(path.join(root, "server"));
      fs.cpSync(fx.dir, path.join(root, "import-in"), { recursive: true });
      const cwd = path.join(root, "server");
      assert.equal(bootstrapSource({}, cwd).file, null);
      assert.equal(bootstrapSource({ npm_lifecycle_event: "start" }, cwd).file, null);
      assert.equal(bootstrapSource({ npm_lifecycle_event: "dev" }, cwd).file, path.join(root, "import-in", "homebuddy.sqlite"));

      const none = await bootstrapImport(t, { env: { npm_lifecycle_event: "start" }, dataDir: t.dir, cwd });
      assert.equal(none.status, "skipped");
      assert.equal(trips(t.db), 0);

      const dev = await bootstrapImport(t, { env: { npm_lifecycle_event: "dev" }, dataDir: t.dir, cwd });
      assert.equal(dev.status, "imported");
      assert.equal(trips(t.db), 2);
      // Bericht liegt neben import-in
      assert.ok(fs.existsSync(path.join(root, "import-out", "report.json")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("bootstrap: ohne aktiven Benutzer nichts erfinden, Hinweis auf user:create", async () => {
  await withEnv({}, async (fx, t, lines) => {
    const src = new Database(fx.sqlite);
    src.prepare("UPDATE users SET active = 0").run();
    src.close();
    const r = await bootstrapImport(t, { env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite }, dataDir: t.dir, log: (l) => lines.push(l) });
    assert.equal(r.status, "imported");
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1").get() as any).n, 0);
    assert.ok(lines.some((l) => /npm run user:create/.test(l)), lines.join("\n"));
    assert.equal((t.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 3, "keine erfundenen Benutzer");
  });
});

test("bootstrap: Abweichung bei der Abnahme oder kaputte Quelle legen den Start nicht lahm", async () => {
  await withEnv({ withSummary: true, summaryBalanceOff: true }, async (fx, t, lines) => {
    const r = await bootstrapImport(t, { env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite }, dataDir: t.dir, log: (l) => lines.push(l) });
    assert.equal(r.status, "mismatch");
    assert.equal(trips(t.db), 0);
    assert.ok(lines.some((l) => /ABWEICHUNG/.test(l)));
    assert.ok(fs.existsSync(path.join(t.dir, "import-out", "report.txt")));
  });
  await withEnv({}, async (fx, t, lines) => {
    fs.writeFileSync(fx.sqlite, "das ist keine Datenbank");
    const r = await bootstrapImport(t, { env: { TRAVELBUDDY_BOOTSTRAP_IMPORT: fx.sqlite }, dataDir: t.dir, log: (l) => lines.push(l) });
    assert.equal(r.status, "failed");
    assert.ok(lines.some((l) => /fehlgeschlagen/.test(l)));
    assert.equal(trips(t.db), 0);
  });
});
