import { useMemo, useRef, useState } from "react";
import type { Airport, EventInput, Traveler, TripEvent } from "../api/types";
import { useFormErrors } from "../hooks/useFormErrors";
import {
  buildFormSections,
  eventToValues,
  emptyValues,
  getType,
  hiddenFieldCount,
  tileTypes,
  valuesToInput,
  type CatalogField,
  type FieldValue,
  type FormValues,
} from "../lib/catalog";
import { catalogIcon, Icon } from "../ui/Icon";
import { airportZone, suggestZones } from "../lib/timezones";
import { useCatalog } from "../state/catalog";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Feedback";
import { Sheet } from "../ui/Sheet";
import { Segmented } from "../ui/bits";
import { ProvenanceLegend, type ProvenanceInfo } from "../ui/Provenance";
import { CurrencyField, FieldInput, type FieldCtx } from "./FieldInputs";

type Trip = { id: number; homeCurrency?: string; timezone?: string };

export type EventFormProps = {
  open: boolean;
  onClose: () => void;
  event: TripEvent | null;
  trip: Trip;
  travelers: Traveler[];
  defaultDate?: string | null;
  /** Vorbelegter Typ (überspringt die Kachelwahl). */
  initialType?: string;
  onSave: (input: EventInput) => Promise<void>;
  onDelete?: (e: TripEvent) => void;
  /** «In Reisekasse übernehmen» (nur bei gespeichertem Ereignis mit Preis). */
  onToLedger?: (e: TripEvent) => void;
  onOpenDocument?: (documentId: number, page?: number) => void;
};

export function EventForm(props: EventFormProps) {
  if (!props.open) return null;
  return <EventFormInner key={props.event?.id ?? "new"} {...props} />;
}

const WIDE_KINDS = new Set(["longtext", "passengers", "participants"]);

function EventFormInner({ onClose, event, trip, travelers, defaultDate, initialType, onSave, onDelete, onToLedger, onOpenDocument }: EventFormProps) {
  const catalog = useCatalog();
  const tripTz = trip.timezone || "Europe/Zurich";
  const homeCurrency = trip.homeCurrency || "CHF";
  const [typeId, setTypeId] = useState<string | null>(event ? event.type : initialType ?? null);
  const type = typeId ? getType(catalog, typeId) : null;
  const [mode, setMode] = useState<"important" | "all">("important");
  const [values, setValues] = useState<FormValues>(() => {
    if (event) return eventToValues(catalog, event, homeCurrency);
    const v = emptyValues(homeCurrency);
    if (defaultDate) v.common.startDate = defaultDate;
    return v;
  });
  const [busy, setBusy] = useState(false);
  const errsRef = useRef<HTMLDivElement>(null);
  const titleTouched = useRef(Boolean(event));
  const zoneTouched = useRef({ startTz: Boolean(event?.startTz), endTz: Boolean(event?.endTz) });

  // Serverfehler (422) den Feldern zuordnen
  const spec = useMemo(() => {
    const s: Record<string, { key: string; label: string }> = {};
    for (const f of catalog.commonFields) s[f.key] = { key: `common.${f.key}`, label: f.label };
    for (const sec of type?.sections ?? []) for (const f of sec.fields) s[`details.${f.key}`] = { key: `details.${f.key}`, label: f.label };
    s.details = { key: "details", label: "Details" };
    return s;
  }, [catalog, type]);
  const errs = useFormErrors(spec, { invalid_range: "common.endDate" });

  const sections = useMemo(
    () =>
      type
        ? buildFormSections(catalog, type.id, {
            mode,
            filled: (scope, key) => {
              const v = values[scope][key];
              return Array.isArray(v) ? v.length > 0 : v === true || (typeof v === "string" && v.trim() !== "");
            },
          })
        : [],
    [catalog, type, mode, values]
  );
  const allCount = useMemo(
    () => (type ? hiddenFieldCount(buildFormSections(catalog, type.id, { mode: "important", filled: () => false })) : 0),
    [catalog, type]
  );

  const setField = (scope: "common" | "details", key: string, v: FieldValue) => {
    setValues((cur) => {
      const next: FormValues = { ...cur, [scope]: { ...cur[scope], [key]: v } };
      // Titel nicht überschreiben, sobald er von Hand angefasst wurde
      if (scope === "common" && key === "title") titleTouched.current = true;
      if (scope === "common" && (key === "startTz" || key === "endTz")) zoneTouched.current[key] = true;
      if (scope === "details" && type?.id === "Flug" && (key === "departureAirport" || key === "arrivalAirport")) {
        const dep = key === "departureAirport" ? String(v) : String(next.details.departureAirport ?? "");
        const arr = key === "arrivalAirport" ? String(v) : String(next.details.arrivalAirport ?? "");
        const z = suggestZones("Flug", { departureAirport: dep, arrivalAirport: arr }, tripTz);
        if (!zoneTouched.current.startTz && airportZone(dep)) next.common = { ...next.common, startTz: z.startTz ?? "" };
        if (!zoneTouched.current.endTz && airportZone(arr)) next.common = { ...next.common, endTz: z.endTz ?? "" };
        if (!titleTouched.current && dep.length >= 3 && arr.length >= 3) next.common = { ...next.common, title: `Flug ${dep} → ${arr}` };
      }
      return next;
    });
    errs.clearField(`${scope}.${key}`);
  };

  const onAirport = (f: CatalogField, a: Airport) => {
    const isDep = f.key === "departureAirport";
    const isArr = f.key === "arrivalAirport";
    if (!isDep && !isArr) return;
    const tzKey = isDep ? "startTz" : "endTz";
    setValues((cur) => {
      const next = { ...cur, common: { ...cur.common } };
      if (!zoneTouched.current[tzKey]) next.common[tzKey] = a.tz && a.tz !== tripTz ? a.tz : "";
      if (isDep && !String(next.common.location ?? "").trim()) next.common.location = `${a.city} (${a.iata})`;
      return next;
    });
  };

  const ctx: FieldCtx = {
    travelers,
    tripTz,
    currency: values.currency,
    onCurrency: (c) => setValues((v) => ({ ...v, currency: c })),
    onAirport,
  };

  const sourceOf = (scope: "common" | "details", key: string): ProvenanceInfo | null => {
    const m = event?.fieldsMeta?.[scope === "details" ? `details.${key}` : key] ?? event?.fieldsMeta?.[key];
    if (!m && !event) return null;
    if (!m) return null;
    return { meta: m, onOpenDocument, fallbackDocumentId: event?.sourceDocumentId ?? null };
  };

  const submit = async () => {
    if (!type) return;
    const { input, errors } = valuesToInput(catalog, type.id, values);
    if (Object.keys(errors).length > 0) {
      // Felder, die im Modus «Wichtiges» ausgeblendet sind, bei Fehlern einblenden
      if (mode === "important") setMode("all");
      errs.set(errors, "Bitte die markierten Felder prüfen.");
      window.setTimeout(() => errsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      await onSave({ ...input, ...(event ? {} : { status: "confirmed" as const }) });
      onClose();
    } catch (e) {
      errs.fromError(e);
      window.setTimeout(() => errsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
    } finally {
      setBusy(false);
    }
  };

  // Typ-Kacheln
  if (!type) {
    return (
      <Sheet open onClose={onClose} title="Ereignis hinzufügen" size="l" description="Welche Art von Buchung oder Termin ist es?">
        <div className="tiles" role="list">
          {tileTypes(catalog).map((t) => {
              const resolved = getType(catalog, t.id);
              const hints = (resolved?.sections ?? [])
                .flatMap((s) => s.fields)
                .filter((f) => f.important && f.kind !== "participants")
                .slice(0, 3)
                .map((f) => f.label);
              return (
                <button key={t.id} type="button" role="listitem" className="tile" style={{ ["--tk" as string]: `var(--k-${t.color})` }} onClick={() => setTypeId(t.id)}>
                  <span className="tile__ic" aria-hidden="true">
                    <Icon name={catalogIcon(t.icon)} size={22} />
                  </span>
                  <span className="tile__name">{t.label}</span>
                  <span className="tile__hint">{hints.length > 0 ? hints.join(", ") : t.titleHint}</span>
                </button>
              );
            })}
        </div>
      </Sheet>
    );
  }

  const title = event ? `${type.label} bearbeiten` : `${type.label} erfassen`;
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      size="xl"
      onSubmit={submit}
      footer={
        <>
          {event && onDelete ? (
            <Button variant="danger" icon="trash" className="sheet__foot-left" onClick={() => onDelete(event)}>
              Löschen
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="form" ref={errsRef}>
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <div className="evform__bar">
          <span className="evform__type" style={{ ["--tk" as string]: `var(--k-${type.color})` }}>
            <span className="tile__ic" aria-hidden="true">
              <Icon name={catalogIcon(type.icon)} size={18} />
            </span>
            <span className="label">{type.label}</span>
            {!event && !initialType ? (
              <button type="button" className="link-btn" onClick={() => setTypeId(null)}>
                Typ ändern
              </button>
            ) : null}
          </span>
          <Segmented<"important" | "all">
            label="Umfang des Formulars"
            value={mode}
            onChange={setMode}
            options={[
              { value: "important", label: "Wichtiges" },
              { value: "all", label: allCount > 0 ? `Alle Felder (+${allCount})` : "Alle Felder" },
            ]}
          />
        </div>
        {event?.fieldsMeta && Object.keys(event.fieldsMeta).length > 0 ? <ProvenanceLegend /> : null}
        {event?.status && event.status !== "confirmed" ? (
          <Banner tone="info">Dieses Ereignis ist ein Vorschlag aus einem Dokument. Speichern übernimmt es nicht; dafür gibt es «Übernehmen» in der Liste.</Banner>
        ) : null}

        {sections.map((s) => (
          <fieldset key={s.id} className="fieldset formsec" data-section={s.id}>
            <legend>{s.title}</legend>
            <div className="form-grid">
              {s.fields.map(({ scope, field: f }) => {
                const k = `${scope}.${f.key}`;
                const wide = WIDE_KINDS.has(f.kind);
                return (
                  <div key={k} className={`evfield${wide ? " is-wide" : ""}`}>
                    <FieldInput
                      field={f}
                      label={f.label}
                      value={values[scope][f.key]}
                      onChange={(v) => setField(scope, f.key, v)}
                      error={errs.fields[k] ?? null}
                      base={{ source: sourceOf(scope, f.key) }}
                      ctx={ctx}
                      autoFocus={!event && f.key === "title"}
                    />
                  </div>
                );
              })}
              {s.id === "kosten" && s.fields.some((x) => x.field.key === "priceMinor") ? (
                <div className="evfield">
                  <CurrencyField value={values.currency} onChange={(c) => setValues((v) => ({ ...v, currency: c }))} />
                </div>
              ) : null}
            </div>
            {s.id === "kosten" ? (
              <div className="evform__ledger">
                {event && onToLedger ? (
                  <Button
                    icon="wallet"
                    disabled={!event.priceMinor || event.expenseId != null}
                    onClick={() => onToLedger(event)}
                  >
                    {event.expenseId != null ? "Schon in der Reisekasse" : "In Reisekasse übernehmen"}
                  </Button>
                ) : (
                  <p className="muted xsmall">Nach dem Speichern lässt sich der Preis in die Reisekasse übernehmen.</p>
                )}
              </div>
            ) : null}
          </fieldset>
        ))}
      </div>
    </Sheet>
  );
}
