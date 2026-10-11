import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Airport, Traveler } from "../api/types";
import { meta } from "../api/endpoints";
import { useCurrencies } from "../hooks/useDirectory";
import { useMapsEnabled } from "../hooks/useMapsEnabled";
import type { CatalogField, FieldValue, PassengerValue } from "../lib/catalog";
import { applyTransform, optionLabel } from "../lib/catalog";
import { loadMapkit, lookupPlace } from "../lib/mapkit";
import { allZones, cityOf, rememberAirportZone, zoneOptionLabel } from "../lib/timezones";
import { Button } from "../ui/Button";
import { CheckField, DateField, Field, SelectField, TextAreaField, TextField, TimeField, type Base } from "../ui/Field";
import { Icon } from "../ui/Icon";

export type FieldCtx = {
  travelers: Traveler[];
  tripTz: string;
  currency: string;
  onCurrency: (c: string) => void;
  /** Flughafen gewählt (setzt Zeitzone und Ort). */
  onAirport?: (field: CatalogField, a: Airport) => void;
};

type InputProps = {
  field: CatalogField;
  label: string;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  error?: string | null;
  base: Omit<Base, "label" | "error">;
  ctx: FieldCtx;
  autoFocus?: boolean;
};

const str = (v: FieldValue | undefined): string => (typeof v === "string" ? v : "");

/** Ein Katalogfeld als Eingabe (je nach `kind`). */
export function FieldInput(p: InputProps) {
  const { field: f, label, value, onChange, error, base, ctx } = p;
  const common = { label, error, hint: f.note ?? base.hint, source: base.source, required: f.required };
  switch (f.kind) {
    case "longtext":
      return <TextAreaField {...common} value={str(value)} onChange={onChange} rows={3} maxLength={f.maxLength ?? 10000} placeholder={f.placeholder} />;
    case "date":
      return <DateField {...common} value={str(value)} onChange={onChange} />;
    case "time":
      return <TimeField {...common} value={str(value)} onChange={onChange} />;
    case "number":
      return (
        <TextField
          {...common}
          value={str(value)}
          onChange={(v) => onChange(v.replace(/[^\d’' ]/g, ""))}
          inputMode="numeric"
          placeholder={f.placeholder}
          suffix={f.unit}
        />
      );
    case "money":
      return (
        <TextField
          {...common}
          value={str(value)}
          onChange={onChange}
          inputMode="decimal"
          placeholder="0.00"
          suffix={f.key === "priceMinor" ? undefined : ctx.currency}
        />
      );
    case "bool":
      return <CheckField checked={value === true} onChange={onChange} label={label} />;
    case "select":
      if (f.options === "iana") return <ZoneSelect {...common} value={str(value)} onChange={onChange} tripTz={ctx.tripTz} />;
      return (
        <SelectField
          {...common}
          value={str(value)}
          onChange={onChange}
          options={[
            { value: "", label: "Keine Angabe" },
            ...((f.options as string[] | undefined) ?? []).map((o) => ({ value: o, label: optionLabel(f, o) })),
            ...(str(value) && !((f.options as string[] | undefined) ?? []).includes(str(value)) ? [{ value: str(value), label: str(value) }] : []),
          ]}
        />
      );
    case "airport":
      return <AirportInput {...common} value={str(value)} onChange={onChange} onPick={(a) => ctx.onAirport?.(f, a)} placeholder={f.placeholder ?? "ZRH"} autoFocus={p.autoFocus} />;
    case "place":
      return <PlaceInput {...common} value={str(value)} onChange={onChange} maxLength={f.maxLength} placeholder={f.placeholder} />;
    case "participants":
      return <ParticipantsInput label={label} value={Array.isArray(value) ? (value as number[]) : []} onChange={onChange} travelers={ctx.travelers} source={base.source} />;
    case "participant":
      return (
        <SelectField
          {...common}
          value={str(value)}
          onChange={onChange}
          options={[{ value: "", label: "Keine Angabe" }, ...ctx.travelers.map((t) => ({ value: String(t.id), label: t.displayName }))]}
        />
      );
    case "passengers":
      return <PassengersInput field={f} label={label} value={Array.isArray(value) ? (value as PassengerValue[]) : []} onChange={onChange} travelers={ctx.travelers} source={base.source} />;
    case "text":
    default:
      return (
        <TextField
          {...common}
          value={str(value)}
          onChange={(v) => onChange(applyTransform(f, v))}
          maxLength={f.maxLength}
          placeholder={f.placeholder}
          autoFocus={p.autoFocus}
        />
      );
  }
}

/** Zeitzone: «Zone der Reise» als Standard, danach gängige Zonen, danach alle. */
function ZoneSelect({
  value,
  onChange,
  tripTz,
  ...base
}: Base & { value: string; onChange: (v: string) => void; tripTz: string }) {
  // Rund 400 Zonen: Beschriftungen nur einmal rechnen, nicht bei jedem Tastendruck im Formular.
  const all = useMemo(() => {
    const now = new Date();
    return allZones().map((z) => ({ value: z, label: zoneOptionLabel(z, now) }));
  }, []);
  const opts = [
    { value: "", label: `Zone der Reise (${cityOf(tripTz)})` },
    ...(value && !all.some((z) => z.value === value) ? [{ value, label: value }] : []),
    ...all,
  ];
  return <SelectField {...base} value={value} onChange={onChange} options={opts} />;
}

/** Flughafen: IATA-Code, Vorschläge aus `GET /v1/meta/airports?q=`. */
function AirportInput({
  value,
  onChange,
  onPick,
  placeholder,
  autoFocus,
  ...base
}: Base & { value: string; onChange: (v: string) => void; onPick: (a: Airport) => void; placeholder?: string; autoFocus?: boolean }) {
  const id = useId();
  const [hits, setHits] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const search = (q: string) => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      const n = ++seq.current;
      setBusy(true);
      meta
        .airports(q.trim())
        .then((list) => {
          if (n !== seq.current) return;
          for (const a of list) rememberAirportZone(a.iata, a.tz);
          setHits(list.slice(0, 6));
        })
        .catch(() => {
          if (n === seq.current) setHits([]);
        })
        .finally(() => {
          if (n === seq.current) setBusy(false);
        });
    }, 220);
  };

  return (
    <Field id={id} {...base}>
      <div className="combo">
        <div className="input-wrap">
          <input
            id={id}
            className="input num"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder={placeholder}
            value={value}
            data-autofocus={autoFocus ? "" : undefined}
            role="combobox"
            aria-expanded={open && hits.length > 0}
            aria-autocomplete="list"
            aria-controls={`${id}-list`}
            aria-invalid={base.error ? true : undefined}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              onChange(v);
              setOpen(true);
              search(v);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          />
          {busy ? <span className="input-suffix"><span className="spinner" aria-hidden="true" /></span> : null}
        </div>
        {open && hits.length > 0 ? (
          <ul className="combo__list" id={`${id}-list`} role="listbox">
            {hits.map((a) => (
              <li key={a.iata} role="option" aria-selected={a.iata === value}>
                <button
                  type="button"
                  className="combo__item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(a.iata);
                    onPick(a);
                    setOpen(false);
                  }}
                >
                  <span className="num combo__code">{a.iata}</span>
                  <span className="combo__name">
                    {a.name}
                    <span className="muted xsmall"> · {a.city}, {a.country}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

/** Ort: Textfeld; mit Apple Karten eine Adresssuche, die den Vorschlag übernehmbar macht. */
function PlaceInput({
  value,
  onChange,
  maxLength,
  placeholder,
  ...base
}: Base & { value: string; onChange: (v: string) => void; maxLength?: number; placeholder?: string }) {
  const maps = useMapsEnabled();
  const [found, setFound] = useState<{ text: string } | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setFound(null);
    try {
      const mk = await loadMapkit();
      const hit = mk ? await lookupPlace(mk, value.trim()) : null;
      setFound(hit?.label ? { text: hit.label } : "none");
    } catch {
      setFound("none");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="placefield">
      <TextField {...base} value={value} onChange={(v) => { onChange(v); setFound(null); }} maxLength={maxLength} placeholder={placeholder} />
      {maps === true ? (
        <div className="placefield__tools">
          <Button size="s" icon="search" busy={busy} disabled={!value.trim()} onClick={() => void search()}>
            Auf Karte suchen
          </Button>
          {found && found !== "none" ? (
            <button type="button" className="link-btn" onClick={() => { onChange(found.text); setFound(null); }}>
              <Icon name="check" size={14} /> Übernehmen: {found.text}
            </button>
          ) : null}
          {found === "none" ? <span className="muted xsmall">Nichts gefunden</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Wer ist dabei: leer = alle Mitreisenden. */
function ParticipantsInput({
  label,
  value,
  onChange,
  travelers,
  source,
}: {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
  travelers: Traveler[];
  source: Base["source"];
}) {
  const id = useId();
  const all = value.length === 0;
  const toggle = (tid: number) => {
    const set = new Set(value.length === 0 ? travelers.map((t) => t.id) : value);
    if (set.has(tid)) set.delete(tid);
    else set.add(tid);
    // Alle gewählt = leer (gilt für alle, auch später hinzukommende)
    onChange(set.size === travelers.length || set.size === 0 ? [] : [...set]);
  };
  return (
    <Field id={id} label={label} source={source}>
      <div className="people" role="group" aria-label={label}>
        <button type="button" className={`people__chip${all ? " is-on" : ""}`} aria-pressed={all} onClick={() => onChange([])}>
          Alle
        </button>
        {travelers.map((t) => {
          const on = all ? false : value.includes(t.id);
          return (
            <button key={t.id} type="button" className={`people__chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(t.id)}>
              {t.displayName}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/** Pro Person: Sitz, Ticketnummer … (Unterfelder aus dem Katalog). */
function PassengersInput({
  field,
  label,
  value,
  onChange,
  travelers,
  source,
}: {
  field: CatalogField;
  label: string;
  value: PassengerValue[];
  onChange: (v: PassengerValue[]) => void;
  travelers: Traveler[];
  source: Base["source"];
}) {
  const id = useId();
  const sub = field.fields ?? [];
  const missing = travelers.filter((t) => !value.some((r) => r.participantId === t.id));
  const setRow = (i: number, key: string, v: string) =>
    onChange(value.map((r, j) => (j === i ? { ...r, values: { ...r.values, [key]: applyTransform(sub.find((s) => s.key === key) ?? {}, v) } } : r)));
  const add = (tid: number) => onChange([...value, { participantId: tid, values: {} }]);
  return (
    <Field id={id} label={label} source={source}>
      <div className="pax2">
        {value.map((r, i) => (
          <div key={r.participantId} className="pax2__row">
            <span className="pax2__name">{travelers.find((t) => t.id === r.participantId)?.displayName ?? `#${r.participantId}`}</span>
            <div className="pax2__fields">
              {sub.map((s) => (
                <TextField
                  key={s.key}
                  label={s.label}
                  value={r.values[s.key] ?? ""}
                  onChange={(v) => setRow(i, s.key, v)}
                  maxLength={s.maxLength}
                  placeholder={s.placeholder}
                  className={s.key === "seat" || s.key === "coach" ? "num" : undefined}
                />
              ))}
            </div>
            <button type="button" className="btn btn--ghost btn--icon btn--s" aria-label="Person entfernen" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
        {missing.length > 0 ? (
          <div className="pax2__add">
            {missing.map((t) => (
              <button key={t.id} type="button" className="link-btn" onClick={() => add(t.id)}>
                <Icon name="plus" size={14} /> {t.displayName}
              </button>
            ))}
          </div>
        ) : null}
        {travelers.length === 0 ? <p className="muted xsmall">Noch keine Mitreisenden auf dieser Reise.</p> : null}
      </div>
    </Field>
  );
}

/** Währung des Preises (drei Buchstaben, Auswahl aus der Währungsliste). */
export function CurrencyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const list = useCurrencies();
  return (
    <SelectField
      label="Währung"
      value={value}
      onChange={onChange}
      options={[...(list.some((c) => c.code === value) ? [] : [{ value, label: value }]), ...list.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
    />
  );
}
