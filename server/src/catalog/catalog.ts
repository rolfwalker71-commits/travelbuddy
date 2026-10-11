/**
 * Ereignis-Katalog: `shared/event-types.json` ist die einzige Quelle der Wahrheit für Typ-IDs, Aliase und
 * die Felder in `details`. Der Server lädt die Datei zur Laufzeit (kein Build-Schritt, kein Kopieren in den Code);
 * im Docker-Image liegt sie unter `/app/shared/event-types.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../lib/errors";
import { isValidTimeZone } from "../lib/tz";

export type FieldKind =
  | "text" | "longtext" | "date" | "time" | "number" | "money" | "select" | "bool"
  | "airport" | "place" | "passengers" | "participants" | "participant";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  important?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  transform?: "upper";
  pattern?: string;
  options?: string[] | "iana";
  optionLabels?: string[];
  unit?: string;
  fields?: FieldDef[];
  note?: string;
};

export type SectionDef = { id: string; title: string; fields: FieldDef[] };

export type TypeDef = {
  id: string;
  label: string;
  icon: string;
  color: string;
  extends?: string;
  startLabel?: string;
  endLabel?: string;
  titleHint?: string;
  summary?: string[];
  sections?: SectionDef[];
};

export type CatalogFile = {
  version: number;
  doc?: string;
  kinds: Record<string, string>;
  commonFields: FieldDef[];
  colors: string[];
  types: TypeDef[];
  aliases: Record<string, string>;
};

/** Typ mit aufgelöster Vererbung (`extends`). */
export type ResolvedType = {
  id: string;
  label: string;
  icon: string;
  color: string;
  startLabel: string;
  endLabel: string;
  summary: string[];
  sections: SectionDef[];
  /** Detail-Schlüssel dieses Typs. */
  fields: Map<string, FieldDef>;
};

export class Catalog {
  readonly types = new Map<string, ResolvedType>();
  readonly commonKeys: Set<string>;

  constructor(
    readonly file: CatalogFile,
    /** Unveränderter Dateiinhalt (wird so ausgeliefert). */
    readonly raw: string
  ) {
    const byId = new Map(file.types.map((t) => [t.id, t]));
    for (const t of file.types) {
      const base = t.extends ? byId.get(t.extends) : undefined;
      const sections = t.sections ?? base?.sections ?? [];
      const fields = new Map<string, FieldDef>();
      for (const s of sections) for (const f of s.fields) fields.set(f.key, f);
      this.types.set(t.id, {
        id: t.id,
        label: t.label,
        icon: t.icon,
        color: t.color,
        startLabel: t.startLabel ?? base?.startLabel ?? "Beginn",
        endLabel: t.endLabel ?? base?.endLabel ?? "Ende",
        summary: t.summary ?? base?.summary ?? [],
        sections,
        fields,
      });
    }
    this.commonKeys = new Set(file.commonFields.map((f) => f.key));
  }

  /** Typ-ID (oder Alias, Gross-/Kleinschreibung egal) → ID im Katalog; null, wenn unbekannt. */
  resolveTypeId(raw: string | null | undefined): string | null {
    const t = (raw ?? "").trim();
    if (!t) return null;
    if (this.types.has(t)) return t;
    const alias = this.file.aliases[t];
    if (alias && this.types.has(alias)) return alias;
    const lower = t.toLowerCase();
    for (const id of this.types.keys()) if (id.toLowerCase() === lower) return id;
    for (const [a, id] of Object.entries(this.file.aliases)) if (a.toLowerCase() === lower && this.types.has(id)) return id;
    return null;
  }

  type(id: string): ResolvedType | undefined {
    return this.types.get(this.resolveTypeId(id) ?? "");
  }

  get typeIds(): string[] {
    return [...this.types.keys()];
  }

  /**
   * Prüft `details` eines Typs gegen den Katalog und liefert die bereinigte Fassung (Texte getrimmt,
   * `transform: upper` angewandt, leere Werte entfernt). Wirft 422 `invalid_details`.
   */
  validateDetails(
    typeId: string,
    details: unknown,
    ctx: { participantIds?: Set<number> } = {}
  ): Record<string, unknown> {
    const type = this.type(typeId);
    if (!type) throw invalid(`Unbekannter Ereignistyp «${typeId}»`, [{ field: "type", message: "unbekannt" }]);
    if (details == null) return {};
    if (typeof details !== "object" || Array.isArray(details)) {
      throw invalid("details muss ein Objekt sein", [{ field: "details", message: "kein Objekt" }]);
    }
    const out: Record<string, unknown> = {};
    const problems: Array<{ field: string; message: string }> = [];
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      const def = type.fields.get(key);
      if (!def) {
        problems.push({ field: key, message: `kein Feld des Typs «${type.id}»` });
        continue;
      }
      if (value === null || value === undefined || value === "") continue;
      const r = checkValue(def, value, key, ctx, problems);
      if (r !== undefined) out[key] = r;
    }
    if (problems.length) {
      const first = problems[0]!;
      throw invalid(`Ungültige Details: «${first.field}» ${first.message}`, problems);
    }
    return out;
  }

  /** Wert für `summary` je Typ: `[{label, value}]` aus den Detail-Feldern, die der Katalog nennt. */
  summaryRows(typeId: string, details: Record<string, unknown>): Array<{ label: string; value: string }> {
    const type = this.type(typeId);
    if (!type) return [];
    const rows: Array<{ label: string; value: string }> = [];
    for (const key of type.summary) {
      const def = type.fields.get(key);
      const v = details[key];
      if (!def || v == null || v === "") continue;
      rows.push({ label: def.label, value: displayValue(def, v) });
    }
    return rows;
  }
}

function invalid(message: string, fields: Array<{ field: string; message: string }>): HttpError {
  return new HttpError(422, "invalid_details", message, { fields });
}

function displayValue(def: FieldDef, v: unknown): string {
  if (def.kind === "bool") return v ? "Ja" : "Nein";
  if (def.kind === "select" && Array.isArray(def.options)) {
    const i = def.options.indexOf(String(v));
    const label = i >= 0 ? def.optionLabels?.[i] : undefined;
    return label ?? String(v);
  }
  if (def.kind === "number") return def.unit ? `${v} ${def.unit}` : String(v);
  if (def.kind === "money" && typeof v === "number") return (v / 100).toFixed(2);
  return String(v);
}

const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function checkValue(
  def: FieldDef,
  value: unknown,
  path: string,
  ctx: { participantIds?: Set<number> },
  problems: Array<{ field: string; message: string }>
): unknown {
  const bad = (message: string) => {
    problems.push({ field: path, message });
    return undefined;
  };
  switch (def.kind) {
    case "text":
    case "longtext":
    case "place":
    case "airport": {
      if (typeof value !== "string") return bad("erwartet Text");
      let s = value.trim();
      if (!s) return undefined;
      if (def.transform === "upper") s = s.toUpperCase();
      if (def.kind === "airport") s = s.toUpperCase();
      const max = def.maxLength ?? (def.kind === "longtext" ? 10_000 : 300);
      if (s.length > max) return bad(`ist zu lang (höchstens ${max} Zeichen)`);
      if (def.pattern && !new RegExp(def.pattern).test(s)) return bad(`hat ein ungültiges Format${def.placeholder ? ` (z. B. ${def.placeholder})` : ""}`);
      return s;
    }
    case "date":
      return typeof value === "string" && isDate(value) ? value : bad("erwartet YYYY-MM-DD");
    case "time":
      return typeof value === "string" && isTime(value) ? value : bad("erwartet HH:mm");
    case "number":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000
        ? value
        : bad("erwartet eine ganze Zahl");
    case "money":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : bad("erwartet einen ganzzahligen Betrag in Minor Units");
    case "bool":
      return typeof value === "boolean" ? value : bad("erwartet Ja/Nein (true/false)");
    case "select": {
      if (typeof value !== "string") return bad("erwartet Text");
      if (def.options === "iana") return isValidTimeZone(value) ? value : bad("ist keine gültige Zeitzone");
      if (Array.isArray(def.options) && !def.options.includes(value)) {
        return bad(`ist nicht erlaubt (erlaubt: ${def.options.join(", ")})`);
      }
      return value;
    }
    case "passengers": {
      if (!Array.isArray(value)) return bad("erwartet eine Liste");
      if (value.length > 60) return bad("hat zu viele Einträge");
      const subs = new Map((def.fields ?? []).map((f) => [f.key, f]));
      const seen = new Set<number>();
      const list: Array<Record<string, unknown>> = [];
      value.forEach((entry, i) => {
        const p = `${path}[${i}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          bad("erwartet Objekte mit participantId");
          return;
        }
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
          if (k === "participantId") {
            if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
              problems.push({ field: `${p}.participantId`, message: "erwartet eine Teilnehmer-ID" });
            } else if (ctx.participantIds && !ctx.participantIds.has(v)) {
              problems.push({ field: `${p}.participantId`, message: "gehört nicht zu dieser Reise" });
            } else if (seen.has(v)) {
              problems.push({ field: `${p}.participantId`, message: "kommt doppelt vor" });
            } else {
              seen.add(v);
              row.participantId = v;
            }
            continue;
          }
          const sub = subs.get(k);
          if (!sub) {
            problems.push({ field: `${p}.${k}`, message: "unbekanntes Feld" });
            continue;
          }
          if (v === null || v === "" || v === undefined) continue;
          const r = checkValue(sub, v, `${p}.${k}`, ctx, problems);
          if (r !== undefined) row[k] = r;
        }
        if (row.participantId === undefined && !problems.some((q) => q.field.startsWith(p))) {
          problems.push({ field: `${p}.participantId`, message: "fehlt" });
        }
        list.push(row);
      });
      return list;
    }
    default:
      return bad("kann nicht in details stehen");
  }
}

/* ───────────── Laden ───────────── */

const here = path.dirname(fileURLToPath(import.meta.url));

export function catalogCandidates(env: Record<string, string | undefined> = process.env): string[] {
  return [
    env.TRAVELBUDDY_CATALOG_PATH,
    path.resolve(process.cwd(), "shared/event-types.json"),
    path.resolve(process.cwd(), "../shared/event-types.json"),
    path.resolve(here, "../../shared/event-types.json"),
    path.resolve(here, "../../../shared/event-types.json"),
    path.resolve(here, "../../../../shared/event-types.json"),
  ].filter((p): p is string => Boolean(p));
}

export function loadCatalog(file?: string, env: Record<string, string | undefined> = process.env): Catalog {
  const candidates = file ? [file] : catalogCandidates(env);
  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c, "utf8");
      const parsed = JSON.parse(raw) as CatalogFile;
      if (!Array.isArray(parsed.types) || !parsed.types.length) throw new Error("keine Typen");
      return new Catalog(parsed, raw);
    } catch {
      /* nächster Kandidat */
    }
  }
  throw new Error(`Ereignis-Katalog nicht gefunden (gesucht: ${candidates.join(", ")}). TRAVELBUDDY_CATALOG_PATH setzen.`);
}

let shared: Catalog | null = null;
/** Prozessweiter Katalog (einmal geladen). */
export function getCatalog(): Catalog {
  return (shared ??= loadCatalog());
}
export function setCatalogForTests(c: Catalog | null): void {
  shared = c;
}
