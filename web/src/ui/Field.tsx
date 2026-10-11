import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatDate, parseClock, parseDisplayDate } from "../lib/dates";
import { Icon } from "./Icon";
import { Provenance, type ProvenanceInfo } from "./Provenance";

export type Base = {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Label nur für Screenreader */
  hideLabel?: boolean;
  /** Herkunft des Werts: gefüllter Punkt = aus Dokument, Ring = von Hand. */
  source?: ProvenanceInfo | null;
};

/** Beschriftetes Feld mit Hinweis, Fehler und Herkunftspunkt; Grundbaustein aller Eingaben. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  hideLabel,
  source,
  children,
}: Base & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <span className="field__top">
        <label htmlFor={id} className={hideLabel ? "sr-only" : "field__label"}>
          {label}
          {required ? <span className="field__req" aria-hidden="true"> *</span> : null}
        </label>
        {source ? <Provenance info={source} fieldLabel={label} /> : null}
      </span>
      {children}
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string | null, hint?: ReactNode) =>
  error ? `${id}-err` : hint ? `${id}-hint` : undefined;

export function TextField({
  value,
  onChange,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  maxLength,
  autoFocus,
  name,
  suffix,
  onBlur,
  className,
  list,
  ...base
}: Base & {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "password" | "url" | "tel" | "search";
  inputMode?: "text" | "decimal" | "numeric" | "email" | "url" | "tel" | "search";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  name?: string;
  suffix?: ReactNode;
  onBlur?: () => void;
  className?: string;
  list?: string;
}) {
  const id = useId();
  return (
    <Field id={id} {...base}>
      <div className="input-wrap">
        <input
          id={id}
          name={name}
          className={`input${className ? ` ${className}` : ""}`}
          type={type}
          value={value}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          data-autofocus={autoFocus ? "" : undefined}
          required={base.required}
          list={list}
          aria-invalid={base.error ? true : undefined}
          aria-describedby={describedBy(id, base.error, base.hint)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoCapitalize={type === "text" ? "sentences" : "none"}
          spellCheck={type === "text"}
        />
        {suffix ? <span className="input-suffix">{suffix}</span> : null}
      </div>
    </Field>
  );
}

export function TextAreaField({
  value,
  onChange,
  rows = 3,
  maxLength,
  placeholder,
  ...base
}: Base & { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; placeholder?: string }) {
  const id = useId();
  return (
    <Field id={id} {...base}>
      <textarea
        id={id}
        className="input input--area"
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={base.error ? true : undefined}
        aria-describedby={describedBy(id, base.error, base.hint)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  ...base
}: Base & {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
}) {
  const id = useId();
  return (
    <Field id={id} {...base}>
      <div className="select-wrap">
        <select
          id={id}
          className="input input--select"
          value={value}
          aria-invalid={base.error ? true : undefined}
          aria-describedby={describedBy(id, base.error, base.hint)}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="select-wrap__chev" />
      </div>
    </Field>
  );
}

export function CheckField({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="check">
      <input
        id={id}
        type="checkbox"
        className="check__box"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-d` : undefined}
      />
      <label htmlFor={id} className="check__label">
        <span>{label}</span>
        {description ? (
          <span className="check__desc" id={`${id}-d`}>
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}

/** Schalter (role=switch) für Einstellungen. */
export function SwitchField({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <label htmlFor={id} className="switch-row__label">
          {label}
        </label>
        {description ? (
          <p className="switch-row__desc" id={`${id}-d`}>
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
        <span className="sr-only">{checked ? "An" : "Aus"}</span>
      </button>
    </div>
  );
}

/** Datum als `dd.mm.yyyy` tippen; Wert ist `YYYY-MM-DD` oder leer. Kalender per Knopf. */
export function DateField({
  value,
  onChange,
  ...base
}: Base & { value: string; onChange: (iso: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value ? formatDate(value) : "");
  const [touched, setTouched] = useState(false);
  const native = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((parseDisplayDate(text) ?? "") !== value) setText(value ? formatDate(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const invalid = text.trim() !== "" && parseDisplayDate(text) === null;
  const error = base.error ?? (touched && invalid ? "Datum als TT.MM.JJJJ eingeben" : null);

  return (
    <Field id={id} {...base} error={error}>
      <div className="input-wrap">
        <input
          id={id}
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="TT.MM.JJJJ"
          maxLength={10}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, base.hint)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseDisplayDate(e.target.value) ?? "");
          }}
          onBlur={() => {
            setTouched(true);
            const p = parseDisplayDate(text);
            if (p) setText(formatDate(p));
          }}
        />
        <button
          type="button"
          className="input-suffix input-suffix--btn"
          aria-label="Kalender öffnen"
          onClick={() => {
            try {
              native.current?.showPicker();
            } catch {
              native.current?.focus();
            }
          }}
        >
          <Icon name="calendar" size={18} />
        </button>
        <input
          ref={native}
          className="date-native"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setText(e.target.value ? formatDate(e.target.value) : "");
          }}
        />
      </div>
    </Field>
  );
}

/** Uhrzeit `hh:mm` (24 h); Wert ist `HH:mm` oder leer. */
export function TimeField({
  value,
  onChange,
  ...base
}: Base & { value: string; onChange: (hhmm: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if ((parseClock(text) ?? "") !== value) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const invalid = text.trim() !== "" && parseClock(text) === null;
  const error = base.error ?? (touched && invalid ? "Uhrzeit als hh:mm eingeben" : null);

  return (
    <Field id={id} {...base} error={error}>
      <input
        id={id}
        className="input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="hh:mm"
        maxLength={5}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, base.hint)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseClock(e.target.value) ?? "");
        }}
        onBlur={() => {
          setTouched(true);
          const p = parseClock(text);
          if (p) setText(p);
        }}
      />
    </Field>
  );
}

/** Validierungsfehler für Datum/Zeit-Felder, die der Server sonst als 400 meldet. */
export function dateFieldInvalid(text: string): boolean {
  return text.trim() !== "" && parseDisplayDate(text) === null;
}
