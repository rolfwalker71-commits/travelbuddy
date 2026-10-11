/**
 * `details` eines HomeBuddy-Ereignisses auf den Katalog des Ziels abbilden.
 *
 * - Schlüssel, die der Typ nicht kennt, werden verworfen und im Bericht gezählt (nach Schlüsselname).
 * - `select`-Werte werden auf die Katalog-Optionen normalisiert («Frühstück» → «Fruehstueck», Beschriftung → Option).
 * - Zahlen, Zeiten, Daten, Ja/Nein werden aus Textformen gelesen; was danach nicht gültig ist, wird verworfen
 *   und gezählt (nach Schlüsselname, nie mit Wert).
 * - Jeder Wert läuft am Ende einzeln durch `Catalog.validateDetails`: Es gelangt nichts in die Datenbank,
 *   was der Server später mit `422 invalid_details` ablehnen würde.
 */
import { HttpError } from "../lib/errors";
import { isValidTimeZone } from "../lib/tz";
import type { Catalog, FieldDef } from "../catalog/catalog";

export type DetailsReport = {
  /** Unbekannte Schlüssel: Anzahl je Schlüssel. */
  droppedKeys: Record<string, number>;
  /** Bekannter Schlüssel, aber Wert unbrauchbar (nach Normalisierung): Anzahl je Schlüssel. */
  invalidValues: Record<string, number>;
  /** Auf Katalog-Optionen normalisierte `select`-Werte (Anzahl je Schlüssel). */
  normalizedSelects: Record<string, number>;
  /** Auf die Höchstlänge gekürzte Texte (Anzahl je Schlüssel). */
  truncated: Record<string, number>;
  /** Umbenannte Schlüssel (z. B. `flightNumber` → `trainNumber` bei Zügen). */
  renamedKeys: Record<string, number>;
  eventsWithDetails: number;
};

export const emptyDetailsReport = (): DetailsReport => ({
  droppedKeys: {},
  invalidValues: {},
  normalizedSelects: {},
  truncated: {},
  renamedKeys: {},
  eventsWithDetails: 0,
});

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** Schlüssel, die HomeBuddy für einen Typ anders nannte. */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  Zugreisen: { flightNumber: "trainNumber" },
  Mietauto: { originPlace: "pickupPlace", destinationPlace: "returnPlace" },
};

const fold = (s: string) =>
  s
    .replace(/ä/gi, "ae").replace(/ö/gi, "oe").replace(/ü/gi, "ue").replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

export type DetailsContext = {
  /** Quell-Teilnehmer-ID (trip_travelers.id) → Ziel-Teilnehmer-ID, falls vorhanden. */
  mapParticipant: (sourceId: number) => number | null;
  /** Gültige Ziel-Teilnehmer der Reise (für `passengers`). */
  participantIds: Set<number>;
};

type Coerced = { ok: true; value: unknown } | { ok: false };

function coerce(def: FieldDef, raw: unknown, rep: DetailsReport, ctx: DetailsContext): Coerced {
  const skip: Coerced = { ok: false };
  switch (def.kind) {
    case "text":
    case "longtext":
    case "place":
    case "airport": {
      let v: string;
      if (typeof raw === "string") v = raw;
      else if (typeof raw === "number" && Number.isFinite(raw)) v = String(raw);
      else return skip;
      v = v.trim();
      if (!v) return skip;
      if (def.kind === "airport") {
        const m = /\b[A-Za-z]{3}\b/.exec(v);
        v = (m ? m[0] : v).toUpperCase();
      }
      if (def.transform === "upper") v = v.toUpperCase();
      if (def.pattern && !new RegExp(def.pattern).test(v)) {
        const compact = v.replace(/\s+/g, " ");
        if (new RegExp(def.pattern).test(compact)) v = compact;
        else {
          const squeezed = v.replace(/\s+/g, "");
          if (new RegExp(def.pattern).test(squeezed)) v = squeezed;
        }
      }
      const max = def.maxLength ?? (def.kind === "longtext" ? 10_000 : 300);
      if (v.length > max) {
        v = v.slice(0, max).trimEnd();
        bump(rep.truncated, def.key);
      }
      return { ok: true, value: v };
    }
    case "date": {
      if (typeof raw !== "string") return skip;
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
      return m ? { ok: true, value: m[1] } : skip;
    }
    case "time": {
      if (typeof raw !== "string") return skip;
      const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(raw.trim());
      if (!m) return skip;
      return { ok: true, value: `${m[1]!.padStart(2, "0")}:${m[2]}` };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim().replace(",", ".")) : NaN;
      if (!Number.isFinite(n) || n < 0) return skip;
      return { ok: true, value: Math.round(n) };
    }
    case "money": {
      const n = typeof raw === "number" ? raw : NaN;
      return Number.isSafeInteger(n) && n >= 0 ? { ok: true, value: n } : skip;
    }
    case "bool": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === 1 || raw === "1" || /^(true|ja|yes)$/i.test(String(raw))) return { ok: true, value: true };
      if (raw === 0 || raw === "0" || /^(false|nein|no)$/i.test(String(raw))) return { ok: true, value: false };
      return skip;
    }
    case "select": {
      if (typeof raw !== "string") return skip;
      const v = raw.trim();
      if (!v) return skip;
      if (def.options === "iana") return isValidTimeZone(v) ? { ok: true, value: v } : skip;
      const options = Array.isArray(def.options) ? def.options : [];
      if (options.includes(v)) return { ok: true, value: v };
      const f = fold(v);
      let idx = options.findIndex((o) => fold(o) === f);
      if (idx < 0) idx = (def.optionLabels ?? []).findIndex((l) => fold(l) === f);
      if (idx < 0) return skip;
      bump(rep.normalizedSelects, def.key);
      return { ok: true, value: options[idx] };
    }
    case "passengers": {
      if (!Array.isArray(raw)) return skip;
      const subs = new Map((def.fields ?? []).map((f) => [f.key, f]));
      const seen = new Set<number>();
      const list: Array<Record<string, unknown>> = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const e = entry as Record<string, unknown>;
        const srcId = [e.participantId, e.travelerId, e.memberId].find((x) => typeof x === "number") as number | undefined;
        const mapped = srcId != null ? ctx.mapParticipant(srcId) : null;
        if (mapped == null || !ctx.participantIds.has(mapped) || seen.has(mapped)) {
          bump(rep.invalidValues, `${def.key}[]`);
          continue;
        }
        seen.add(mapped);
        const row: Record<string, unknown> = { participantId: mapped };
        for (const [k, v] of Object.entries(e)) {
          const sub = subs.get(k);
          if (!sub) continue;
          const c = coerce(sub, v, rep, ctx);
          if (c.ok) row[k] = c.value;
        }
        list.push(row);
      }
      return list.length ? { ok: true, value: list } : skip;
    }
    default:
      return skip;
  }
}

export function parseDetailsJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function normalizeDetails(
  catalog: Catalog,
  typeId: string,
  rawJson: unknown,
  ctx: DetailsContext,
  rep: DetailsReport
): Record<string, unknown> {
  const parsed = parseDetailsJson(rawJson);
  if (parsed == null) {
    bump(rep.invalidValues, "details");
    return {};
  }
  const type = catalog.type(typeId);
  if (!type) return {};
  const out: Record<string, unknown> = {};
  let any = false;
  for (const [key0, value] of Object.entries(parsed)) {
    if (value === null || value === undefined || value === "") continue;
    any = true;
    let key = key0;
    if (!type.fields.has(key)) {
      const alias = KEY_ALIASES[type.id]?.[key];
      if (alias && type.fields.has(alias)) {
        if (out[alias] !== undefined) {
          bump(rep.droppedKeys, key0);
          continue;
        }
        key = alias;
        bump(rep.renamedKeys, `${key0}→${alias}`);
      } else {
        bump(rep.droppedKeys, key0);
        continue;
      }
    }
    const def = type.fields.get(key)!;
    const c = coerce(def, value, rep, ctx);
    if (!c.ok) {
      bump(rep.invalidValues, key);
      continue;
    }
    try {
      const checked = catalog.validateDetails(type.id, { [key]: c.value }, { participantIds: ctx.participantIds });
      if (checked[key] !== undefined) out[key] = checked[key];
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      bump(rep.invalidValues, key);
    }
  }
  if (any) rep.eventsWithDetails += 1;
  return out;
}
