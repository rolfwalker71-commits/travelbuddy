import { HttpError } from "../lib/errors";

/** Minimale Schnittstelle: Der Anbieter ist austauschbar, die Analyse kennt nur dies. */
export interface LlmClient {
  readonly model: string;
  completeJson(input: { system: string; user: string }): Promise<string>;
}

export type OpenAiCompatibleConfig = {
  apiKey: string;
  /** Standard: https://api.openai.com/v1 (jeder OpenAI-kompatible Endpunkt funktioniert). */
  baseUrl?: string;
  model: string;
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function openAiCompatible(
  cfg: OpenAiCompatibleConfig,
  doFetch: FetchFn = (url, init) => fetch(url, init)
): LlmClient {
  const baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    model: cfg.model,
    async completeJson({ system, user }) {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: cfg.model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch {
        throw new HttpError(502, "llm_unavailable", "KI-Dienst nicht erreichbar");
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new HttpError(502, "llm_error", `KI-Anfrage fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new HttpError(502, "llm_error", "Leere Antwort der KI");
      return content;
    },
  };
}
