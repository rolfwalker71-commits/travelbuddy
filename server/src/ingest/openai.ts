/**
 * OpenAI-Anbindung der Dokumentanalyse (per `fetch`, ohne SDK): Chat Completions mit strikter Strukturausgabe
 * (`response_format: json_schema`, `strict: true`). Text, Bilder (`image_url` mit Data-URL) und PDF
 * (`file` mit Data-URL) gehen im selben Aufruf; jeder OpenAI-kompatible Endpunkt (`OPENAI_BASE_URL`) genügt.
 *
 * Fehler tragen `retryable`: Netz, Zeitüberschreitung, 408/409/429/5xx → ja (Backoff in `analyzer.ts`);
 * 400/401/403/404, Ablehnung durch das Modell → nein (Konfiguration oder Eingabe muss sich ändern).
 */
import type { Attachment, Usage } from "./types";

export type LlmRequest = {
  purpose: "extract" | "repair";
  model: string;
  system: string;
  user: string;
  attachments?: Attachment[];
  schema: { name: string; schema: Record<string, unknown> };
  /** Reparaturversuch: vorige (ungültige) Ausgabe und die gefundenen Probleme. */
  previous?: { output: string; problems: string[] };
};

export type LlmResponse = {
  content: string;
  finishReason: string | null;
  usage: Usage;
  model: string;
};

export interface StructuredLlm {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    /** Vom Dienst verlangte Wartezeit in Sekunden (`Retry-After`), falls genannt. */
    readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "LlmError";
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenAiConfig = {
  apiKey: string;
  baseUrl?: string | null;
  fetch?: FetchFn;
  timeoutMs?: number;
};

export class OpenAiLlm implements StructuredLlm {
  private readonly baseUrl: string;
  private readonly doFetch: FetchFn;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: OpenAiConfig) {
    this.baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.doFetch = cfg.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = cfg.timeoutMs ?? 240_000;
  }

  private buildMessages(req: LlmRequest): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [{ type: "text", text: req.user }];
    for (const a of req.attachments ?? []) {
      if (a.kind === "image") {
        parts.push({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.base64}`, detail: "high" } });
      } else {
        parts.push({ type: "file", file: { filename: a.fileName, file_data: `data:application/pdf;base64,${a.base64}` } });
      }
    }
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: req.system },
      { role: "user", content: parts.length === 1 ? req.user : parts },
    ];
    if (req.previous) {
      messages.push({ role: "assistant", content: req.previous.output.slice(0, 40_000) });
      messages.push({
        role: "user",
        content:
          "Deine letzte Antwort war nicht gültig. Probleme:\n" +
          req.previous.problems.slice(0, 20).map((p) => `- ${p}`).join("\n") +
          "\nGib die vollständige, korrigierte Antwort erneut als JSON gemäss Schema aus. Ändere keine Werte, die korrekt waren.",
      });
    }
    return messages;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: this.buildMessages(req),
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new LlmError(timeout ? "KI-Dienst: Zeitüberschreitung" : "KI-Dienst nicht erreichbar", true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = errorMessage(text);
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryable = [408, 409, 425, 429].includes(res.status) || res.status >= 500;
      // «insufficient_quota» ist ein 429, wird aber ohne Eingriff nicht besser; Wiederholung ist trotzdem harmlos.
      throw new LlmError(
        `KI-Anfrage fehlgeschlagen (${res.status})${detail ? `: ${detail}` : ""}`,
        retryable,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      );
    }
    let data: {
      model?: string;
      choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new LlmError("KI-Dienst: Antwort nicht lesbar", true, res.status);
    }
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) {
      throw new LlmError(`KI-Dienst hat die Verarbeitung abgelehnt: ${choice.message.refusal.slice(0, 200)}`, false, res.status);
    }
    const content = choice?.message?.content;
    if (!content) throw new LlmError("KI-Dienst: leere Antwort", true, res.status);
    return {
      content,
      finishReason: choice?.finish_reason ?? null,
      model: data.model ?? req.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }
}

function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message.slice(0, 200);
  } catch {
    /* kein JSON */
  }
  return body.slice(0, 160);
}

/** Aus der Umgebung: ohne `OPENAI_API_KEY` gibt es keine KI (die Analyse läuft dann nur mit Barcodes, ICS, Pass). */
export function openAiFromEnv(env: Record<string, string | undefined> = process.env, doFetch?: FetchFn): OpenAiLlm | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAiLlm({ apiKey, baseUrl: env.OPENAI_BASE_URL?.trim() || null, fetch: doFetch });
}
