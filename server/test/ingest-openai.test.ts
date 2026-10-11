import test from "node:test";
import assert from "node:assert/strict";
import { LlmError, OpenAiLlm, openAiFromEnv, type LlmRequest } from "../src/ingest/openai";
import { buildExtractionSchema } from "../src/ingest/schema";
import { getCatalog } from "../src/catalog/catalog";
import { estimateCostMicroUsd } from "../src/ingest/usage";
import { ingestEnv } from "../src/ingest/pipeline";

const schema = buildExtractionSchema(getCatalog());
const baseReq = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  purpose: "extract", model: "gpt-4o-mini", system: "S", user: "U", schema, ...over,
});

const okBody = (content: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } },
    ...extra,
  });

test("OpenAI: Anfrage mit strikter Struktur, Authorization, Bild und PDF als Eingabe; Nutzung wird gelesen", async () => {
  let seen: { url: string; headers: Record<string, string>; body: any } | null = null;
  const llm = new OpenAiLlm({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1/",
    fetch: async (url, init) => {
      seen = { url, headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) };
      return new Response(okBody('{"events":[]}'), { status: 200 });
    },
  });
  const r = await llm.complete(
    baseReq({
      model: "gpt-4o",
      attachments: [
        { kind: "image", mime: "image/jpeg", base64: "QUJD" },
        { kind: "pdf", fileName: "scan.pdf", base64: "UERG" },
      ],
    })
  );
  assert.equal(seen!.url, "https://example.test/v1/chat/completions");
  assert.equal(seen!.headers.Authorization, "Bearer sk-test");
  assert.equal(seen!.body.model, "gpt-4o");
  assert.equal(seen!.body.response_format.type, "json_schema");
  assert.equal(seen!.body.response_format.json_schema.strict, true);
  assert.equal(seen!.body.response_format.json_schema.name, "travelbuddy_extraction");
  const parts = seen!.body.messages[1].content;
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].image_url.url, "data:image/jpeg;base64,QUJD");
  assert.equal(parts[2].file.file_data, "data:application/pdf;base64,UERG");
  assert.equal(parts[2].file.filename, "scan.pdf");
  assert.equal(r.content, '{"events":[]}');
  assert.deepEqual(r.usage, { inputTokens: 1000, outputTokens: 200, cachedTokens: 100 });
  assert.equal(r.model, "gpt-4o-mini-2024-07-18");
});

test("OpenAI: Reparatur hängt die vorige Ausgabe und die Probleme an", async () => {
  let body: any;
  const llm = new OpenAiLlm({ apiKey: "k", fetch: async (_u, init) => ((body = JSON.parse(String(init!.body))), new Response(okBody("{}"), { status: 200 })) });
  await llm.complete(baseReq({ purpose: "repair", previous: { output: "kaputt", problems: ["`events` fehlt"] } }));
  const m = body.messages;
  assert.equal(m[2].role, "assistant");
  assert.equal(m[2].content, "kaputt");
  assert.equal(m[3].role, "user");
  assert.match(m[3].content, /`events` fehlt/);
});

test("OpenAI: Fehler tragen retryable (429/5xx/Netz ja, 400/401 nein), Ablehnung und leere Antwort", async () => {
  const mk = (res: () => Response | Promise<Response>) => new OpenAiLlm({ apiKey: "k", fetch: async () => res() });
  const err = async (llm: OpenAiLlm) => (await llm.complete(baseReq()).then(() => null, (e) => e)) as LlmError;

  const e429 = await err(mk(() => new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "20" } })));
  assert.ok(e429 instanceof LlmError);
  assert.equal(e429.retryable, true);
  assert.equal(e429.status, 429);
  assert.equal(e429.retryAfterSec, 20);
  assert.match(e429.message, /429.*Rate limit/);
  assert.equal((await err(mk(() => new Response("oops", { status: 503 })))).retryable, true);
  const e401 = await err(mk(() => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 })));
  assert.equal(e401.retryable, false);
  assert.equal((await err(mk(() => new Response("{}", { status: 400 })))).retryable, false);
  const net = await err(new OpenAiLlm({ apiKey: "k", fetch: async () => { throw new TypeError("fetch failed"); } }));
  assert.equal(net.retryable, true);
  assert.match(net.message, /nicht erreichbar/);
  const refusal = await err(mk(() => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "Das kann ich nicht." } }] }), { status: 200 })));
  assert.equal(refusal.retryable, false);
  const empty = await err(mk(() => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })));
  assert.equal(empty.retryable, true);
});

test("OpenAI aus der Umgebung: ohne Schlüssel null; Modelle, Kosten, Schwellen", () => {
  assert.equal(openAiFromEnv({}), null);
  assert.equal(openAiFromEnv({ OPENAI_API_KEY: "  " }), null);
  assert.ok(openAiFromEnv({ OPENAI_API_KEY: "sk-x", OPENAI_BASE_URL: "http://localhost:1234/v1" }) instanceof OpenAiLlm);
  assert.equal(estimateCostMicroUsd("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 }), 150_000);
  assert.equal(estimateCostMicroUsd("gpt-4o", { inputTokens: 0, outputTokens: 1_000_000, cachedTokens: 0 }), 10_000_000);
  assert.equal(estimateCostMicroUsd("irgendein-modell", { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }), null);
  assert.deepEqual(ingestEnv({}), { autoConfirmMin: 0.92, toleranceDays: 7, maxChunkChars: 24000 });
  assert.deepEqual(ingestEnv({ TRAVELBUDDY_AUTO_CONFIRM_MIN: "0.8", TRAVELBUDDY_TRIP_TOLERANCE_DAYS: "3" }), { autoConfirmMin: 0.8, toleranceDays: 3, maxChunkChars: 24000 });
});
