import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";
import { HttpError, conflict, badRequest } from "../lib/errors";
import { getCatalog } from "../catalog/catalog";
import { fetchEcbRate, type FetchLike } from "../ledgers/fx";
import * as L from "../ledgers/service";
import * as T from "./service";

/**
 * «Als Ausgabe in die Reisekasse übernehmen»: legt aus Preis und Währung des Ereignisses eine Ausgabe an
 * (Zahler und Aufteilung vorbelegt) und schreibt `expenseId` ins Ereignis zurück.
 *
 * - Zahler: Angabe im Aufruf, sonst `paidByParticipantId` des Ereignisses, sonst der Teilnehmer des Aufrufers,
 *   sonst der erste Teilnehmer.
 * - Aufteilung: gleichmässig auf «Wer ist dabei» (leer = alle Teilnehmer der Reise).
 * - Fremdwährung: Kurs aus dem Aufruf, sonst EZB-Tageskurs zum Datum der Ausgabe.
 * - Beleg: das erste mit dem Ereignis verknüpfte Dokument.
 */
export async function createExpenseFromEvent(
  db: Db,
  user: AuthUser,
  tripId: number,
  eventId: number,
  input: { paidByMemberId?: number; exchangeRate?: number; expenseDate?: string | null; preSettled?: boolean; memberIds?: number[] },
  deps: { fetch?: FetchLike; now?: () => Date } = {}
): Promise<{ expenseId: number; expense: ReturnType<typeof L.getExpense> }> {
  const trip = T.getTrip(db, tripId);
  const ev = T.getEventRow(db, tripId, eventId);
  if (ev.expense_id != null) {
    const still = db.prepare("SELECT 1 FROM expenses WHERE id = ?").get(ev.expense_id);
    if (still) throw conflict("Zum Ereignis gehört bereits eine Ausgabe", "expense_exists");
  }
  if (ev.price_minor == null || ev.price_minor <= 0) {
    throw new HttpError(422, "price_required", "Das Ereignis hat keinen Preis");
  }
  const ledgerId = T.ledgerIdOfTrip(db, tripId);
  if (ledgerId == null) throw badRequest("Zur Reise gehört keine Reisekasse", "no_ledger");
  const ledger = L.getLedger(db, ledgerId);
  L.assertWritable(ledger);

  const people = T.listTravelers(db, tripId);
  if (!people.length) throw new HttpError(422, "no_participants", "Die Reise hat keine Teilnehmer");
  const payer =
    input.paidByMemberId ??
    ev.paid_by_participant_id ??
    people.find((p) => p.user_id === user.id)?.id ??
    people[0]!.id;
  const evParticipants = (
    db.prepare("SELECT participant_id FROM event_participants WHERE event_id = ?").all(eventId) as { participant_id: number }[]
  ).map((r) => r.participant_id);
  const memberIds = input.memberIds?.length ? input.memberIds : evParticipants.length ? evParticipants : people.map((p) => p.id);

  const currency = (ev.currency ?? trip.home_currency).toUpperCase();
  const date = input.expenseDate ?? ev.start_date ?? (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  let rate = input.exchangeRate;
  if (currency !== ledger.base_currency && rate == null) {
    const fx = await fetchEcbRate({ from: currency, to: ledger.base_currency, date }, deps.fetch);
    rate = fx.rate;
  }
  const doc = db
    .prepare("SELECT document_id FROM trip_event_documents WHERE trip_event_id = ? ORDER BY created_at, document_id LIMIT 1")
    .get(eventId) as { document_id: number } | undefined;
  const label = getCatalog().type(ev.event_type)?.label ?? ev.event_type;

  const row = L.createExpense(db, ledgerId, {
    paidByMemberId: payer,
    createdByMemberId: people.find((p) => p.user_id === user.id)?.id ?? null,
    amountMinor: ev.price_minor,
    currency,
    exchangeRate: rate,
    description: ev.title,
    expenseDate: date,
    category: label,
    tripEventId: eventId,
    documentId: doc?.document_id ?? null,
    split: { mode: "equal", memberIds },
    preSettled: input.preSettled,
  });
  db.prepare("UPDATE trip_events SET expense_id = ?, updated_at = ? WHERE id = ?").run(row.id, new Date().toISOString(), eventId);
  return { expenseId: row.id, expense: L.getExpense(db, ledgerId, row.id) };
}
