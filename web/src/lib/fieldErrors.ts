import { ApiError } from "../api/client";

/** Serverfeld (ohne Array-Indizes, z. B. `members.displayName`) → Formularfeld + Bezeichnung. */
export type FieldSpec = Record<string, { key: string; label: string }>;
/** Fehlercode des Servers → Formularfeld (für Fehler ohne Feldliste, z. B. `split_sum_mismatch`). */
export type CodeSpec = Record<string, string>;

export type FormErrors = {
  /** Meldungen je Formularfeld (Schlüssel aus der Spec). */
  fields: Record<string, string>;
  /** Allgemeine Meldung für das Banner; null, wenn nur Felder betroffen sind. */
  form: string | null;
};

export const NO_ERRORS: FormErrors = { fields: {}, form: null };

/** `split.amounts.0.amountBaseMinor` → `split.amounts.amountBaseMinor` */
export function normalizeField(path: string): string {
  return path
    .split(".")
    .filter((seg) => !/^\d+$/.test(seg))
    .join(".");
}

function lookup(spec: FieldSpec, path: string) {
  const parts = normalizeField(path).split(".");
  // genaueste Übereinstimmung zuerst, dann immer kürzere Präfixe
  for (let n = parts.length; n > 0; n--) {
    const hit = spec[parts.slice(0, n).join(".")];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Ordnet `error.details.fields` den Formularfeldern zu. Unbekannte Felder und alle
 * übrigen Fehler landen als Text im Banner.
 */
export function mapApiError(e: unknown, spec: FieldSpec, codes: CodeSpec = {}): FormErrors {
  if (!(e instanceof ApiError)) {
    return { fields: {}, form: e instanceof Error ? e.message : "Unbekannter Fehler" };
  }
  const fields: Record<string, string> = {};
  const rest: string[] = [];

  for (const issue of e.fields) {
    const hit = lookup(spec, issue.field);
    if (hit) {
      if (!fields[hit.key]) fields[hit.key] = `${hit.label} ${issue.message}`;
    } else {
      rest.push(`«${issue.field}» ${issue.message}`);
    }
  }

  if (e.fields.length === 0) {
    const key = codes[e.code];
    if (key) {
      fields[key] = e.message;
      return { fields, form: null };
    }
    return { fields, form: e.message };
  }
  if (rest.length > 0) return { fields, form: `Ungültige Eingabe: ${rest.join("; ")}` };
  return { fields, form: Object.keys(fields).length > 1 ? "Bitte die markierten Felder prüfen." : null };
}
