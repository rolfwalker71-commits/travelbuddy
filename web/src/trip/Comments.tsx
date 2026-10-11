import { useState } from "react";
import type { TripComment } from "../api/types";
import { errorMessage } from "../api/client";
import { formatTimestamp } from "../lib/dates";
import { Button, IconButton } from "../ui/Button";
import { TextAreaField } from "../ui/Field";

/** Kommentare zu einem Ereignis mit Eingabe; Löschen nur, wo erlaubt. */
export function Comments({
  comments,
  onComment,
  canDelete,
  onDelete,
}: {
  comments: TripComment[];
  onComment: (body: string) => Promise<void>;
  canDelete?: (c: TripComment) => boolean;
  onDelete?: (c: TripComment) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await onComment(body);
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="comments">
      {comments.length > 0 ? (
        <ul className="comments__list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment__head">
                <strong>{c.author}</strong>
                <span className="faint xsmall num">{formatTimestamp(c.createdAt)}</span>
                {canDelete?.(c) ? <IconButton icon="trash" label="Kommentar löschen" size="s" onClick={() => onDelete?.(c)} /> : null}
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="comments__form"
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
      >
        <TextAreaField label="Neuer Kommentar" hideLabel value={text} onChange={setText} rows={2} maxLength={2000} placeholder="Kommentar schreiben …" error={error} />
        <Button type="submit" variant="primary" size="s" icon="arrow-right" busy={busy} disabled={!text.trim()}>
          Senden
        </Button>
      </form>
    </div>
  );
}
