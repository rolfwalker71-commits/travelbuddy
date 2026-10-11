import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerWriteApi } from "../api/endpoints";
import { errorMessage } from "../api/client";
import { useCurrencies } from "../hooks/useDirectory";
import { useFormErrors } from "../hooks/useFormErrors";
import type { Couple, Direction, Expense, ExpenseInput, Member, SplitInput, SplitMode } from "../api/types";
import { isValidIsoDate, todayIso, formatDate } from "../lib/dates";
import {
  convertMinorPreview,
  currencyExponent,
  formatMinor,
  formatMoney,
  formatRate,
  minorToInput,
  parseMinor,
  parseRate,
} from "../lib/money";
import { exactRemainder, parseUnits, splitCoupleEqual, splitEqual, splitShares, type SplitMap } from "../lib/splits";
import { Button } from "../ui/Button";
import { CheckField, DateField, SelectField, TextAreaField, TextField } from "../ui/Field";
import { Banner } from "../ui/Feedback";
import { Segmented } from "../ui/bits";
import { Sheet } from "../ui/Sheet";

const EXPENSE_SPEC = {
  amountMinor: { key: "amount", label: "Betrag" },
  currency: { key: "currency", label: "Währung" },
  exchangeRate: { key: "rate", label: "Wechselkurs" },
  expenseDate: { key: "date", label: "Datum" },
  paidByMemberId: { key: "payer", label: "Zahler" },
  split: { key: "split", label: "Aufteilung" },
  description: { key: "description", label: "Beschreibung" },
  category: { key: "category", label: "Kategorie" },
  note: { key: "note", label: "Notiz" },
};
const EXPENSE_CODES = {
  exchange_rate_required: "rate",
  payer_required: "payer",
  split_required: "split",
  split_sum_mismatch: "split",
  invalid_split: "split",
  invalid_member: "split",
  invalid_couple: "split",
};

export type ExpensePrefill = {
  description?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  expenseDate?: string | null;
  category?: string | null;
  tripEventId?: number | null;
  /** Beteiligte (leer = alle). */
  participantIds?: number[];
};

export type ExpenseSheetProps = {
  open: boolean;
  onClose: () => void;
  baseCurrency: string;
  kind: "split" | "cashbook";
  members: Member[];
  couples: Couple[];
  expense?: Expense | null;
  defaultPayerId?: number | null;
  /** Vorbelegung für eine neue Ausgabe (z. B. aus einem Ereignis: «In Reisekasse übernehmen»). */
  prefill?: ExpensePrefill;
  api: LedgerWriteApi;
  onSaved: (e: Expense, mode: "created" | "updated") => void;
  onDelete?: (e: Expense) => void;
};

export function ExpenseSheet(props: ExpenseSheetProps) {
  if (!props.open) return null;
  return <ExpenseForm key={props.expense?.id ?? "new"} {...props} />;
}

function initialEqual(expense: Expense | null | undefined, members: Member[], only?: number[]): Set<number> {
  if (expense && expense.splitMode === "equal") return new Set(expense.splits.map((s) => s.memberId));
  if (!expense && only && only.length > 0) return new Set(members.filter((m) => only.includes(m.id)).map((m) => m.id));
  return new Set(members.map((m) => m.id));
}

function ExpenseForm({
  onClose,
  baseCurrency,
  kind,
  members,
  couples,
  expense,
  defaultPayerId,
  prefill,
  api,
  onSaved,
  onDelete,
}: ExpenseSheetProps) {
  const editing = Boolean(expense);
  const cashbook = kind === "cashbook";
  const base = baseCurrency.toUpperCase();

  const [description, setDescription] = useState(expense?.description ?? prefill?.description ?? "");
  const [amountText, setAmountText] = useState(
    expense
      ? minorToInput(expense.amountMinor, expense.currency)
      : prefill?.amountMinor != null
        ? minorToInput(prefill.amountMinor, prefill.currency ?? base)
        : ""
  );
  const [currency, setCurrency] = useState(expense?.currency ?? prefill?.currency?.toUpperCase() ?? base);
  const [rateText, setRateText] = useState(
    expense && expense.currency !== base ? formatRate(expense.exchangeRate) : ""
  );
  const [rateManual, setRateManual] = useState(false);
  const [fx, setFx] = useState<{ status: "idle" | "loading" | "ok" | "error"; date?: string; message?: string }>({
    status: "idle",
  });
  const [fxTick, setFxTick] = useState(0);
  const [date, setDate] = useState(expense?.expenseDate ?? prefill?.expenseDate ?? todayIso());
  const [paidBy, setPaidBy] = useState<number | "">(
    expense?.paidByMemberId ?? defaultPayerId ?? members[0]?.id ?? ""
  );
  const [direction, setDirection] = useState<Direction>(expense?.direction ?? "expense");
  const [mode, setMode] = useState<SplitMode>(
    expense?.splitMode === "coupleEqual" && couples.length === 0 ? "equal" : expense?.splitMode ?? "equal"
  );
  const [equalIds, setEqualIds] = useState<Set<number>>(() => initialEqual(expense, members, prefill?.participantIds));
  const [shares, setShares] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const m of members) {
      const row = expense?.splitMode === "shares" ? expense.splits.find((s) => s.memberId === m.id) : undefined;
      out[m.id] = expense?.splitMode === "shares" ? (row ? String(row.shareUnits ?? 1) : "") : "1";
    }
    return out;
  });
  const [exact, setExact] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const m of members) {
      const row = expense?.splitMode === "exact" ? expense.splits.find((s) => s.memberId === m.id) : undefined;
      out[m.id] = row ? minorToInput(row.shareBaseMinor, base) : "";
    }
    return out;
  });
  const [coupleIds, setCoupleIds] = useState<Set<number>>(() => {
    if (expense?.splitMode === "coupleEqual") {
      const inSplit = new Set(expense.splits.map((s) => s.memberId));
      return new Set(couples.filter((c) => c.memberIds.some((id) => inSplit.has(id))).map((c) => c.id));
    }
    return new Set(couples.map((c) => c.id));
  });
  const [category, setCategory] = useState(expense?.category ?? prefill?.category ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [preSettled, setPreSettled] = useState(false);
  const errs = useFormErrors(EXPENSE_SPEC, EXPENSE_CODES);
  const currencyList = useCurrencies(api.currencies);
  const [busy, setBusy] = useState(false);

  const foreign = currency.length === 3 && currency !== base;

  /* ─ EZB-Kurs automatisch laden, solange er nicht von Hand überschrieben wurde ─ */
  const skipFirst = useRef(Boolean(expense && expense.currency !== base));
  useEffect(() => {
    if (!foreign) {
      setFx({ status: "idle" });
      return;
    }
    if (!isValidIsoDate(date)) return;
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    if (rateManual) return;
    let alive = true;
    setFx({ status: "loading" });
    const t = window.setTimeout(() => {
      const useDate = date > todayIso() ? undefined : date;
      api
        .fx(currency, base, useDate)
        .then((r) => {
          if (!alive) return;
          setRateText(formatRate(r.rate));
          setFx({ status: "ok", date: r.date });
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setFx({ status: "error", message: errorMessage(e) });
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, date, fxTick, foreign]);

  /* ─ Vorschau ─ */
  const amountParse = parseMinor(amountText, currency);
  const rate = foreign ? parseRate(rateText) : 1;
  const baseMinor = useMemo(() => {
    if (!amountParse.ok) return null;
    if (!foreign) return amountParse.minor;
    return rate ? convertMinorPreview(amountParse.minor, currency, base, rate) : null;
  }, [amountParse.ok, amountParse.ok ? amountParse.minor : 0, foreign, rate, currency, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview: SplitMap = useMemo(() => {
    if (baseMinor == null || cashbook) return new Map();
    if (mode === "equal") return splitEqual(baseMinor, members.filter((m) => equalIds.has(m.id)).map((m) => m.id));
    if (mode === "shares") {
      const items = members
        .map((m) => ({ memberId: m.id, units: parseUnits(shares[m.id] ?? "") }))
        .filter((x): x is { memberId: number; units: number } => x.units !== null);
      return splitShares(baseMinor, items);
    }
    if (mode === "coupleEqual") {
      const groups = couples
        .filter((c) => coupleIds.has(c.id))
        .map((c) => ({ coupleId: c.id, memberIds: members.filter((m) => m.coupleId === c.id).map((m) => m.id) }));
      return splitCoupleEqual(baseMinor, groups);
    }
    return new Map();
  }, [baseMinor, mode, equalIds, shares, coupleIds, members, couples, cashbook]);

  const exactAmounts = members.map((m) => {
    const t = exact[m.id] ?? "";
    if (t.trim() === "") return { memberId: m.id, minor: 0, ok: true };
    const p = parseMinor(t, base, { allowZero: true });
    return { memberId: m.id, minor: p.ok ? p.minor : 0, ok: p.ok };
  });
  const exactLeft = baseMinor != null ? exactRemainder(baseMinor, exactAmounts.map((a) => a.minor)) : null;

  /* ─ Absenden ─ */
  const submit = async () => {
    const local: Record<string, string> = {};
    const amt = parseMinor(amountText, currency);
    if (!amt.ok) local.amount = amt.error;
    if (currency.length !== 3 || !/^[A-Za-z]{3}$/.test(currency)) local.currency = "Währung mit drei Buchstaben angeben";
    if (date && !isValidIsoDate(date)) local.date = "Datum als TT.MM.JJJJ eingeben";
    let rateNum: number | undefined;
    if (foreign) {
      const r = parseRate(rateText);
      if (!r) local.rate = "Wechselkurs erforderlich (z. B. 0.9412)";
      else rateNum = r;
    }
    let split: SplitInput | undefined;
    if (!cashbook) {
      if (paidBy === "") local.payer = "Zahler wählen";
      if (mode === "equal") {
        const ids = members.filter((m) => equalIds.has(m.id)).map((m) => m.id);
        if (ids.length === 0) local.split = "Mindestens eine Person wählen";
        split = { mode: "equal", memberIds: ids };
      } else if (mode === "shares") {
        const list: { memberId: number; units: number }[] = [];
        for (const m of members) {
          const t = (shares[m.id] ?? "").trim();
          if (t === "") continue;
          const u = parseUnits(t);
          if (u === null) {
            local.split = `Ungültiger Anteil bei ${m.displayName}`;
            break;
          }
          list.push({ memberId: m.id, units: u });
        }
        if (!local.split && list.length === 0) local.split = "Mindestens einen Anteil angeben";
        split = { mode: "shares", shares: list };
      } else if (mode === "exact") {
        const list: { memberId: number; amountBaseMinor: number }[] = [];
        for (const m of members) {
          const t = (exact[m.id] ?? "").trim();
          if (t === "") continue;
          const p = parseMinor(t, base, { allowZero: true });
          if (!p.ok) {
            local.split = `${m.displayName}: ${p.error}`;
            break;
          }
          if (p.minor > 0) list.push({ memberId: m.id, amountBaseMinor: p.minor });
        }
        if (!local.split && baseMinor != null) {
          const left = exactRemainder(baseMinor, list.map((x) => x.amountBaseMinor));
          if (left !== 0) {
            local.split =
              left > 0
                ? `Es fehlen noch ${formatMoney(left, base)} in der Aufteilung`
                : `Die Aufteilung ist ${formatMoney(-left, base)} zu hoch`;
          }
        }
        if (!local.split && list.length === 0) local.split = "Mindestens einen Betrag angeben";
        split = { mode: "exact", amounts: list };
      } else {
        const ids = couples.filter((c) => coupleIds.has(c.id)).map((c) => c.id);
        if (ids.length === 0) local.split = "Mindestens ein Paar wählen";
        split = { mode: "coupleEqual", coupleIds: ids };
      }
    }
    errs.set(local);
    if (Object.keys(local).length > 0 || !amt.ok) return;

    const payload: ExpenseInput = {
      amountMinor: amt.minor,
      currency: currency.toUpperCase(),
      description: description.trim() || null,
      expenseDate: date || null,
      category: category.trim() || null,
      note: note.trim() || null,
    };
    if (foreign && rateNum) payload.exchangeRate = rateNum;
    if (!editing && prefill?.tripEventId != null) payload.tripEventId = prefill.tripEventId;
    if (cashbook) payload.direction = direction;
    else {
      payload.paidByMemberId = paidBy as number;
      payload.split = split;
      if (!editing && preSettled) payload.preSettled = true;
    }
    setBusy(true);
    try {
      const saved = editing ? await api.updateExpense(expense!.id, payload) : await api.createExpense(payload);
      onSaved(saved, editing ? "updated" : "created");
      onClose();
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<number>, id: number): Set<number> => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const title = editing ? (cashbook ? "Buchung bearbeiten" : "Ausgabe bearbeiten") : cashbook ? "Buchung erfassen" : "Ausgabe erfassen";
  const withoutCouple = members.filter((m) => m.coupleId == null);
  const amountLabel = foreign ? `Betrag in ${currency}` : "Betrag";
  const dl = "currency-list";

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      onSubmit={submit}
      size="l"
      footer={
        <>
          {editing && onDelete ? (
            <Button variant="danger" icon="trash" className="sheet__foot-left" onClick={() => onDelete(expense!)}>
              Löschen
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {editing ? "Speichern" : "Erfassen"}
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}

        {cashbook ? (
          <Segmented
            label="Art der Buchung"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "expense", label: "Ausgabe" },
              { value: "income", label: "Einnahme" },
            ]}
          />
        ) : null}

        <TextField
          label="Beschreibung"
          value={description}
          onChange={setDescription}
          placeholder="z. B. Abendessen"
          maxLength={500}
          error={errs.fields.description}
          autoFocus={!editing}
        />

        <div className="form-row form-row--keep">
          <TextField
            label={amountLabel}
            value={amountText}
            onChange={setAmountText}
            inputMode="decimal"
            placeholder={currencyExponent(currency) === 0 ? "0" : "0.00"}
            error={errs.fields.amount}
            required
          />
          <div>
            <TextField
              label="Währung"
              value={currency}
              onChange={(v) => {
                const up = v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
                setCurrency(up);
                setRateManual(false);
                if (up !== base) setRateText("");
              }}
              maxLength={3}
              list={dl}
              autoComplete="off"
              error={errs.fields.currency}
            />
            <datalist id={dl}>
              {[...currencyList].sort((a, b) => (a.code === base ? -1 : b.code === base ? 1 : 0)).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        {foreign ? (
          <div className="fx-box">
            <TextField
              label={`Wechselkurs (1 ${currency} = ? ${base})`}
              value={rateText}
              onChange={(v) => {
                setRateText(v);
                setRateManual(true);
              }}
              inputMode="decimal"
              error={errs.fields.rate}
              required
              hint={
                fx.status === "loading"
                  ? "EZB-Kurs wird geladen …"
                  : fx.status === "ok"
                    ? `EZB-Referenzkurs vom ${formatDate(fx.date)}`
                    : fx.status === "error"
                      ? `Kurs nicht verfügbar: ${fx.message}. Bitte von Hand eintragen.`
                      : rateManual
                        ? "Von Hand eingetragen"
                        : undefined
              }
            />
            <div className="fx-box__side">
              <Button
                size="s"
                variant="ghost"
                icon="refresh"
                onClick={() => {
                  setRateManual(false);
                  setFxTick((t) => t + 1);
                }}
              >
                EZB-Kurs laden
              </Button>
              {baseMinor != null ? (
                <p className="fx-box__result">
                  ≈ <strong className="num">{formatMoney(baseMinor, base)}</strong>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="form-row">
          <DateField label="Datum" value={date} onChange={setDate} error={errs.fields.date} />
          {!cashbook ? (
            <SelectField
              label="Bezahlt von"
              value={String(paidBy)}
              onChange={(v) => setPaidBy(Number(v))}
              error={errs.fields.payer}
              options={members.map((m) => ({ value: String(m.id), label: m.displayName }))}
            />
          ) : (
            <TextField label="Kategorie" value={category} onChange={setCategory} maxLength={100} error={errs.fields.category} />
          )}
        </div>

        {!cashbook ? (
          <fieldset className="fieldset">
            <legend>Aufteilung</legend>
            <Segmented
              label="Art der Aufteilung"
              value={mode}
              onChange={(m) => {
                setMode(m);
                errs.clearField("split");
              }}
              options={[
                { value: "equal", label: "Gleich" },
                { value: "shares", label: "Anteile" },
                { value: "exact", label: "Exakt" },
                ...(couples.length > 0 ? [{ value: "coupleEqual" as const, label: "Paare" }] : []),
              ]}
            />

            <div className="split-list" role="group" aria-label="Beteiligte">
              {mode === "equal" &&
                members.map((m) => (
                  <div className="split-row" key={m.id}>
                    <CheckField
                      checked={equalIds.has(m.id)}
                      onChange={() => setEqualIds((s) => toggle(s, m.id))}
                      label={m.displayName}
                    />
                    <span className="split-row__val num">
                      {equalIds.has(m.id) && preview.has(m.id) ? formatMinor(preview.get(m.id)!, base) : "–"}
                    </span>
                  </div>
                ))}

              {mode === "shares" &&
                members.map((m) => (
                  <div className="split-row" key={m.id}>
                    <span className="split-row__name">{m.displayName}</span>
                    <input
                      className="input input--tiny num"
                      inputMode="decimal"
                      aria-label={`Anteile von ${m.displayName}`}
                      placeholder="0"
                      value={shares[m.id] ?? ""}
                      onChange={(e) => setShares((s) => ({ ...s, [m.id]: e.target.value }))}
                    />
                    <span className="split-row__val num">
                      {preview.has(m.id) ? formatMinor(preview.get(m.id)!, base) : "–"}
                    </span>
                  </div>
                ))}

              {mode === "exact" &&
                members.map((m, i) => (
                  <div className="split-row" key={m.id}>
                    <span className="split-row__name">{m.displayName}</span>
                    <input
                      className={`input input--small num${exactAmounts[i]?.ok === false ? " input--bad" : ""}`}
                      inputMode="decimal"
                      aria-label={`Betrag von ${m.displayName} in ${base}`}
                      placeholder={currencyExponent(base) === 0 ? "0" : "0.00"}
                      value={exact[m.id] ?? ""}
                      onChange={(e) => setExact((s) => ({ ...s, [m.id]: e.target.value }))}
                    />
                    <span className="split-row__unit">{base}</span>
                  </div>
                ))}

              {mode === "coupleEqual" && (
                <>
                  {couples.map((c) => {
                    const sum = members
                      .filter((m) => m.coupleId === c.id)
                      .reduce((s, m) => s + (preview.get(m.id) ?? 0), 0);
                    return (
                      <div className="split-row" key={c.id}>
                        <CheckField
                          checked={coupleIds.has(c.id)}
                          onChange={() => setCoupleIds((s) => toggle(s, c.id))}
                          label={c.name}
                        />
                        <span className="split-row__val num">
                          {coupleIds.has(c.id) ? formatMinor(sum, base) : "–"}
                        </span>
                      </div>
                    );
                  })}
                  {withoutCouple.length > 0 ? (
                    <p className="field__hint">
                      Nicht beteiligt (kein Paar): {withoutCouple.map((m) => m.displayName).join(", ")}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {mode === "exact" && exactLeft !== null ? (
              <p className={`split-sum${exactLeft === 0 ? " split-sum--ok" : " split-sum--off"}`} aria-live="polite">
                {exactLeft === 0
                  ? "Aufteilung stimmt mit dem Betrag überein."
                  : exactLeft > 0
                    ? `Noch zu verteilen: ${formatMoney(exactLeft, base)}`
                    : `Zu viel verteilt: ${formatMoney(-exactLeft, base)}`}
              </p>
            ) : null}
            {errs.fields.split ? (
              <p className="field__error" role="alert">
                {errs.fields.split}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {!cashbook ? <TextField label="Kategorie (optional)" value={category} onChange={setCategory} maxLength={100} error={errs.fields.category} /> : null}
        <TextAreaField label="Notiz (optional)" value={note} onChange={setNote} rows={2} maxLength={4000} error={errs.fields.note} />

        {!editing && !cashbook ? (
          <CheckField
            checked={preSettled}
            onChange={setPreSettled}
            label="Bereits ausgeglichen"
            description="Zählt in den Kosten, die anderen haben dem Zahler ihren Anteil aber schon zurückgegeben. Der Saldo bleibt unverändert."
          />
        ) : null}
      </div>
    </Sheet>
  );
}
