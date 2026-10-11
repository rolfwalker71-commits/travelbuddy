import type { z } from "zod";
import { HttpError } from "./errors";

type Issue = z.core.$ZodIssue;

const ENGLISH_DEFAULT = /^(Invalid |Too (small|big)|Unrecognized|Expected )/;

function describe(issue: Issue): string {
  const raw = issue as unknown as Record<string, any>;
  // Eigene (deutsche) Meldungen aus den Schemas unverändert übernehmen.
  if (issue.message && !ENGLISH_DEFAULT.test(issue.message)) return issue.message;

  switch (issue.code) {
    case "invalid_type":
      return /received undefined/.test(issue.message) ? "fehlt" : `hat den falschen Typ (erwartet: ${raw.expected})`;
    case "too_small": {
      const n = raw.minimum;
      if (raw.origin === "string") return `ist zu kurz (mindestens ${n} Zeichen)`;
      if (raw.origin === "array") return `braucht mindestens ${n} Einträge`;
      return `ist zu klein (mindestens ${n})`;
    }
    case "too_big": {
      const n = raw.maximum;
      if (raw.origin === "string") return `ist zu lang (höchstens ${n} Zeichen)`;
      if (raw.origin === "array") return `hat zu viele Einträge (höchstens ${n})`;
      return `ist zu gross (höchstens ${n})`;
    }
    case "invalid_value":
      return `ist nicht erlaubt (erlaubt: ${(raw.values as unknown[]).join(", ")})`;
    case "unrecognized_keys":
      return `enthält unbekannte Felder: ${(raw.keys as string[]).join(", ")}`;
    case "invalid_format":
      return raw.format === "email" ? "ist keine gültige E-Mail-Adresse" : "hat ein ungültiges Format";
    default:
      return "ist ungültig";
  }
}

/** Validiert und liefert bei Fehlern 422 mit deutschem Text und Feldliste in `details`. */
export function parseWith<S extends z.ZodType>(raw: unknown, schema: S): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields = r.error.issues.map((i) => ({
    field: i.path.map(String).join(".") || "body",
    message: describe(i),
  }));
  const first = fields[0]!;
  throw new HttpError(
    422,
    "validation_failed",
    `Ungültige Eingabe: «${first.field}» ${first.message}`,
    { fields }
  );
}

export async function readJson(req: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Ungültiger JSON-Body");
  }
}
