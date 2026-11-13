import { useState } from "react";
import { apiBlob, errorMessage } from "../api/client";
import type { Member } from "../api/types";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";

type GroupBy = "date" | "person";

/** Pfad des PDF-Protokolls (siehe `docs/CONTRACT.md`, «Ausgaben-Protokoll als PDF»). */
export function ledgerExportPath(ledgerId: number, groupBy: GroupBy, participantId?: number | null): string {
  const q = new URLSearchParams({ groupBy });
  if (groupBy === "person" && participantId) q.set("participantId", String(participantId));
  return `/v1/ledgers/${ledgerId}/export.pdf?${q.toString()}`;
}

/** Ausgaben-Protokoll als PDF laden: nach Datum oder nach Person (alle oder eine). */
export function ExportSheet(props: { open: boolean; onClose: () => void; ledgerId: number; title: string; members: Member[] }) {
  const { open, onClose, ledgerId, title, members } = props;
  const toast = useToast();
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [person, setPerson] = useState("all");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await apiBlob(ledgerExportPath(ledgerId, groupBy, person === "all" ? null : Number(person)));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `Ausgaben-${groupBy === "date" ? "nach-Datum" : "nach-Person"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast("PDF erstellt");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ausgaben als PDF"
      description={`Protokoll der Reisekasse «${title}»`}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon="download" busy={busy} onClick={() => void download()}>
            PDF laden
          </Button>
        </>
      }
    >
      <div className="stack">
        <SelectField<GroupBy>
          label="Gliederung"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: "date", label: "Nach Datum" },
            { value: "person", label: "Nach Person" },
          ]}
        />
        {groupBy === "person" ? (
          <SelectField<string>
            label="Person"
            value={person}
            onChange={setPerson}
            options={[{ value: "all", label: "Alle Personen" }, ...members.map((m) => ({ value: String(m.id), label: m.displayName }))]}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
