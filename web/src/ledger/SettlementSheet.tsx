import { useState } from "react";
import type { LedgerWriteApi } from "../api/endpoints";
import { useFormErrors } from "../hooks/useFormErrors";
import type { Member, Settlement } from "../api/types";
import { isValidIsoDate, todayIso } from "../lib/dates";
import { currencyExponent, formatMoney, minorToInput, parseMinor } from "../lib/money";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Feedback";
import { DateField, SelectField, TextField } from "../ui/Field";
import { Sheet } from "../ui/Sheet";

export type SettlementPrefill = {
  fromMemberId?: number;
  toMemberId?: number;
  amountMinor?: number;
  hint?: string;
};

export function SettlementSheet(props: {
  open: boolean;
  onClose: () => void;
  baseCurrency: string;
  members: Member[];
  prefill?: SettlementPrefill | null;
  api: LedgerWriteApi;
  onSaved: (s: Settlement) => void;
}) {
  if (!props.open) return null;
  return <SettlementForm {...props} />;
}

const SETTLEMENT_SPEC = {
  amountMinor: { key: "amount", label: "Betrag" },
  fromMemberId: { key: "from", label: "Zahler" },
  toMemberId: { key: "to", label: "Empfänger" },
  settledAt: { key: "date", label: "Datum" },
  note: { key: "note", label: "Notiz" },
  currency: { key: "amount", label: "Währung" },
};
const SETTLEMENT_CODES = { invalid_member: "to" };

function SettlementForm({
  onClose,
  baseCurrency,
  members,
  prefill,
  api,
  onSaved,
}: {
  onClose: () => void;
  baseCurrency: string;
  members: Member[];
  prefill?: SettlementPrefill | null;
  api: LedgerWriteApi;
  onSaved: (s: Settlement) => void;
}) {
  const [from, setFrom] = useState<string>(String(prefill?.fromMemberId ?? members[0]?.id ?? ""));
  const [to, setTo] = useState<string>(String(prefill?.toMemberId ?? members[1]?.id ?? members[0]?.id ?? ""));
  const [amount, setAmount] = useState(prefill?.amountMinor ? minorToInput(prefill.amountMinor, baseCurrency) : "");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const errs = useFormErrors(SETTLEMENT_SPEC, SETTLEMENT_CODES);
  const [busy, setBusy] = useState(false);

  const opts = members.map((m) => ({ value: String(m.id), label: m.displayName }));

  const submit = async () => {
    const p = parseMinor(amount, baseCurrency);
    if (!p.ok) {
      errs.set({ amount: p.error });
      return;
    }
    if (from === to) {
      errs.set({ to: "Zahler und Empfänger müssen verschieden sein" });
      return;
    }
    if (date && !isValidIsoDate(date)) {
      errs.set({ date: "Datum als TT.MM.JJJJ eingeben" });
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      const s = await api.createSettlement({
        fromMemberId: Number(from),
        toMemberId: Number(to),
        amountMinor: p.minor,
        currency: baseCurrency,
        note: note.trim() || null,
        settledAt: date || null,
      });
      onSaved(s);
      onClose();
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Rückzahlung erfassen"
      description={`Betrag in ${baseCurrency}. Die Rückzahlung verbessert den Saldo des Zahlenden und verringert den des Empfängers.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Erfassen
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        {prefill?.hint ? <Banner tone="info">{prefill.hint}</Banner> : null}
        <div className="form-row">
          <SelectField label="Zahlt" value={from} onChange={setFrom} options={opts} error={errs.fields.from} />
          <SelectField label="An" value={to} onChange={setTo} options={opts} error={errs.fields.to} />
        </div>
        <TextField
          label={`Betrag (${baseCurrency})`}
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          placeholder={currencyExponent(baseCurrency) === 0 ? "0" : "0.00"}
          error={errs.fields.amount}
          autoFocus={!prefill?.amountMinor}
          required
          hint={prefill?.amountMinor ? `Vorschlag: ${formatMoney(prefill.amountMinor, baseCurrency)}` : undefined}
        />
        <DateField label="Datum" value={date} onChange={setDate} error={errs.fields.date} />
        <TextField label="Notiz (optional)" value={note} onChange={setNote} maxLength={500} error={errs.fields.note} />
      </div>
    </Sheet>
  );
}
