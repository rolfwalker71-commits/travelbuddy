import { useCallback, useState } from "react";
import { mapApiError, NO_ERRORS, type CodeSpec, type FieldSpec, type FormErrors } from "../lib/fieldErrors";

/**
 * Formularfehler: Meldungen je Feld plus Banner. `fromError` ordnet Serverfehler
 * (`error.details.fields`) den Feldern zu; `set` für eigene Prüfungen im Client.
 */
export function useFormErrors(spec: FieldSpec, codes: CodeSpec = {}) {
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);

  const fromError = useCallback((e: unknown) => setErrors(mapApiError(e, spec, codes)), [spec, codes]);
  const clear = useCallback(() => setErrors(NO_ERRORS), []);
  /** Eigene Prüfung: ersetzt alle Fehler. */
  const set = useCallback((fields: Record<string, string>, form: string | null = null) => {
    setErrors({ fields, form });
  }, []);
  const clearField = useCallback((key: string) => {
    setErrors((cur) => {
      if (!(key in cur.fields)) return cur;
      const { [key]: _gone, ...rest } = cur.fields;
      return { fields: rest, form: cur.form };
    });
  }, []);

  return { fields: errors.fields, form: errors.form, fromError, clear, set, clearField };
}
