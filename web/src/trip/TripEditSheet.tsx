import { useState } from "react";
import type { TripDetail, TripInput } from "../api/types";
import { useFormErrors } from "../hooks/useFormErrors";
import { isValidIsoDate } from "../lib/dates";
import { allZones, cityOf } from "../lib/timezones";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Feedback";
import { DateField, SelectField, TextAreaField, TextField } from "../ui/Field";
import { Sheet } from "../ui/Sheet";

const SPEC = {
  title: { key: "title", label: "Titel" },
  destination: { key: "destination", label: "Ziel" },
  startDate: { key: "start", label: "Beginn" },
  endDate: { key: "end", label: "Ende" },
  summary: { key: "summary", label: "Zusammenfassung" },
  notes: { key: "notes", label: "Notizen" },
  homeCurrency: { key: "currency", label: "Heimwährung" },
  timezone: { key: "timezone", label: "Zeitzone" },
};

export function TripEditSheet({
  open,
  data,
  onClose,
  onSave,
}: {
  open: boolean;
  data: TripDetail;
  onClose: () => void;
  onSave: (patch: TripInput) => Promise<void>;
}) {
  if (!open) return null;
  return <TripEditForm data={data} onClose={onClose} onSave={onSave} />;
}

function TripEditForm({ data, onClose, onSave }: { data: TripDetail; onClose: () => void; onSave: (p: TripInput) => Promise<void> }) {
  const t = data.trip;
  const [title, setTitle] = useState(t.title);
  const [destination, setDestination] = useState(t.destination ?? "");
  const [start, setStart] = useState(t.startDate ?? "");
  const [end, setEnd] = useState(t.endDate ?? "");
  const [summary, setSummary] = useState(t.summary ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  const [currency, setCurrency] = useState(t.homeCurrency ?? "CHF");
  const [timezone, setTimezone] = useState(t.timezone ?? "Europe/Zurich");
  const errs = useFormErrors(SPEC, { invalid_range: "end", currency_locked: "currency" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return errs.set({ title: "Titel erforderlich" });
    if ((start && !isValidIsoDate(start)) || (end && !isValidIsoDate(end))) return errs.set({ start: "Datum als TT.MM.JJJJ eingeben" });
    if (start && end && end < start) return errs.set({ end: "Das Ende liegt vor dem Start" });
    if (!/^[A-Za-z]{3}$/.test(currency)) return errs.set({ currency: "Währung mit drei Buchstaben angeben" });
    errs.clear();
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        destination: destination.trim() || null,
        startDate: start || null,
        endDate: end || null,
        summary: summary.trim() || null,
        notes: notes.trim() || null,
        homeCurrency: currency.toUpperCase(),
        timezone,
      });
      onClose();
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const zones = allZones();
  return (
    <Sheet
      open
      onClose={onClose}
      title="Reise bearbeiten"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <TextField label="Titel" value={title} onChange={setTitle} required maxLength={200} error={errs.fields.title} />
        <TextField label="Ziel" value={destination} onChange={setDestination} maxLength={200} error={errs.fields.destination} />
        <div className="form-row">
          <DateField label="Von" value={start} onChange={setStart} error={errs.fields.start} />
          <DateField label="Bis" value={end} onChange={setEnd} error={errs.fields.end} />
        </div>
        <div className="form-row">
          <TextField
            label="Heimwährung"
            value={currency}
            onChange={(v) => setCurrency(v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
            maxLength={3}
            error={errs.fields.currency}
            hint="Währung der Reisekasse"
          />
          <SelectField
            label="Zeitzone der Reise"
            value={timezone}
            onChange={setTimezone}
            error={errs.fields.timezone}
            hint="Gilt für Ereignisse ohne eigene Zone"
            options={(zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => ({ value: z, label: `${cityOf(z)} · ${z}` }))}
          />
        </div>
        <TextAreaField label="Zusammenfassung" value={summary} onChange={setSummary} rows={3} maxLength={2000} error={errs.fields.summary} />
        <TextAreaField label="Notizen" value={notes} onChange={setNotes} rows={3} maxLength={10000} error={errs.fields.notes} />
      </div>
    </Sheet>
  );
}
