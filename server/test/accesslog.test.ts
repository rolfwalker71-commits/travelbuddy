import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { maskPath } from "../src/lib/accessLog";
import { migrate, openDb } from "../src/db/client";

test("protokoll: Einladungs-Tokens werden maskiert", () => {
  assert.equal(maskPath("/v1/guest/AbC123xyzSECRET"), "/v1/guest/:token");
  assert.equal(maskPath("/v1/guest/AbC123xyzSECRET/expenses/4"), "/v1/guest/:token/expenses/4");
  assert.equal(maskPath("/v1/guest/trips/TripSECRET/events/3/comments"), "/v1/guest/trips/:token/events/3/comments");
  assert.equal(maskPath("/g/SECRET"), "/g/:token");
  assert.equal(maskPath("/t/SECRET"), "/t/:token");
  assert.equal(maskPath("/share/f/SECRET"), "/share/f/:token");
  assert.equal(maskPath("/v1/ledgers/12/expenses"), "/v1/ledgers/12/expenses");
});

test("protokoll: eine Zeile je Anfrage, ohne Query und ohne Token, ohne /healthz", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const lines: string[] = [];
  const app = createApp({ db, log: (l) => lines.push(l) });

  await app.request("/healthz");
  await app.request("/v1/guest/GEHEIMTOKEN123?q=suchbegriff");
  await app.request("/v1/me");

  assert.equal(lines.length, 2, "healthz wird nicht protokolliert");
  const all = lines.join("\n");
  assert.ok(!all.includes("GEHEIMTOKEN123"));
  assert.ok(!all.includes("suchbegriff"));
  assert.match(lines[0]!, /^\d{4}-\d\d-\d\dT[\d:.]+Z GET \/v1\/guest\/:token 404 \d+ms$/);
  assert.match(lines[1]!, / GET \/v1\/me 401 \d+ms$/);
});
