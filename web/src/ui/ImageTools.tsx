import { useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { mediaApi, type MediaKind } from "../api/endpoints";
import { Button } from "./Button";
import { useConfirm } from "./Confirm";
import { TextAreaField } from "./Field";
import { Menu } from "./Menu";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/**
 * Bild ändern (nur Admins): eigenes Bild hochladen, per KI neu erzeugen (optional mit zusätzlichen Hinweisen)
 * oder entfernen. Gilt für das Titelbild der Reise und für Ereignisbilder.
 */
export function ImageTools({
  kind,
  ownerId,
  hasImage,
  onChanged,
  label = "Bild ändern",
}: {
  kind: MediaKind;
  ownerId: number;
  hasImage: boolean;
  onChanged: () => void;
  label?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<null | "upload" | "generate" | "remove">(null);

  const run = async (what: "upload" | "generate" | "remove", fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      toast(done);
      onChanged();
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const items = [
    { label: "Eigenes Bild hochladen …", icon: "upload" as const, onSelect: () => input.current?.click() },
    { label: "Mit KI neu erzeugen …", icon: "sparkle" as const, onSelect: () => setOpen(true) },
    ...(hasImage
      ? [
          {
            label: "Bild entfernen",
            icon: "trash" as const,
            danger: true,
            onSelect: async () => {
              const ok = await confirm({
                title: "Bild entfernen?",
                message: "Das Bild wird gelöscht und nicht automatisch neu erzeugt. Neu erzeugen geht jederzeit von Hand.",
                confirmLabel: "Entfernen",
                danger: true,
              });
              if (ok) await run("remove", () => mediaApi.remove(kind, ownerId), "Bild entfernt");
            },
          },
        ]
      : []),
  ];

  return (
    <span className="imagetools">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await run("upload", () => mediaApi.upload(kind, ownerId, file), "Bild hochgeladen");
        }}
      />
      <Menu items={items} label={label} />
      {busy ? <span className="imagetools__busy muted small">{busy === "generate" ? "Bild wird erzeugt …" : busy === "upload" ? "Wird hochgeladen …" : "Wird entfernt …"}</span> : null}
      <Sheet
        open={open}
        onClose={() => (busy === "generate" ? undefined : setOpen(false))}
        title="Bild mit KI neu erzeugen"
        description="Das aktuelle Bild wird ersetzt. Die Erzeugung dauert etwa eine halbe bis eine Minute."
        footer={
          <>
            <Button variant="ghost" disabled={busy === "generate"} onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              icon="sparkle"
              busy={busy === "generate"}
              onClick={async () => {
                const ok = await run("generate", () => mediaApi.regenerate(kind, ownerId, extra), "Neues Bild erzeugt");
                if (ok) {
                  setOpen(false);
                  setExtra("");
                }
              }}
            >
              Bild erzeugen
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Zusätzliche Hinweise (optional)"
          value={extra}
          onChange={setExtra}
          rows={4}
          maxLength={1000}
          placeholder="z. B. bei Sonnenuntergang, mit Logo der Fluggesellschaft, Blick auf das Meer"
          hint="Die Hinweise gelten für diese eine Erzeugung und werden nicht gespeichert."
        />
      </Sheet>
    </span>
  );
}
