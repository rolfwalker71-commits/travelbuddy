import { randomBytes } from "node:crypto";
import type { Db } from "../db/client";
import type { AuthUser } from "../auth/auth";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors";
import { convertMinor } from "../lib/money";
import { todayLocal } from "../lib/dates";
import { mediaUrls } from "../media/store";
import {
  splitByWeights,
  splitCoupleEqual,
  splitEqual,
  splitExact,
  splitShares,
  type SplitMap,
} from "./splits";
import {
  buildPayerOrientedDebts,
  computeMemberBalances,
  explainSimplifyDebts,
  type BalanceInput,
  type DebtEdge,
} from "./settlement";

/* ───────────── Typen ───────────── */

export type Direction = "expense" | "income";
export type SettledStatus = 0 | 1 | 2;

export type LedgerRow = {
  id: number;
  title: string;
  base_currency: string;
  trip_id: number | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** Teilnehmer (Tabelle `participants`): dieselbe ID wie `travelers[]` der Reise. */
export type MemberRow = {
  id: number;
  trip_id: number | null;
  ledger_id: number | null;
  display_name: string;
  email: string | null;
  user_id: number | null;
  couple_id: number | null;
  color_index: number;
  sort_key: number;
  share_token: string;
  share_revoked_at: string | null;
  created_at: string;
};

type CoupleRow = { id: number; ledger_id: number; name: string; created_at: string };

type ExpenseRow = {
  id: number;
  ledger_id: number;
  paid_by_participant_id: number;
  created_by_participant_id: number | null;
  direction: Direction;
  amount_minor: number;
  currency: string;
  exchange_rate: number;
  amount_base_minor: number;
  description: string | null;
  expense_date: string | null;
  category_label: string | null;
  note: string | null;
  split_mode: "equal" | "coupleEqual" | "exact" | "shares";
  settled_status: SettledStatus;
  document_id: number | null;
  trip_event_id: number | null;
  place_name: string | null;
  place_lat: number | null;
  place_lon: number | null;
  receipt_path: string | null;
  created_at: string;
  updated_at: string;
};

type SplitRow = {
  expense_id: number;
  participant_id: number;
  share_base_minor: number;
  share_units: number | null;
};

type SettlementRow = {
  id: number;
  ledger_id: number;
  from_participant_id: number;
  to_participant_id: number;
  amount_minor: number;
  currency: string;
  exchange_rate: number;
  amount_base_minor: number;
  note: string | null;
  settled_at: string;
  created_by_participant_id: number | null;
  related_expense_id: number | null;
  created_at: string;
};

export type SplitInput =
  | { mode: "equal"; memberIds?: number[] }
  | { mode: "coupleEqual"; coupleIds?: number[] }
  | { mode: "exact"; amounts: { memberId: number; amountBaseMinor: number }[] }
  | { mode: "shares"; shares: { memberId: number; units: number }[] };

const now = () => new Date().toISOString();
const today = () => todayLocal();
export const newShareToken = () => randomBytes(18).toString("base64url");

/** Stabile Avatar-Farbe (0–7): die niedrigste noch freie in der Reise, sonst reihum. */
export function nextColorIndex(db: Db, where: { tripId?: number | null; ledgerId?: number | null }): number {
  const rows = (
    where.tripId != null
      ? db.prepare("SELECT color_index AS c FROM participants WHERE trip_id = ?").all(where.tripId)
      : db.prepare("SELECT color_index AS c FROM participants WHERE ledger_id = ?").all(where.ledgerId ?? -1)
  ) as Array<{ c: number }>;
  const used = new Set(rows.map((r) => r.c));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return rows.length % 8;
}

/* ───────────── Zugriff & Laden ───────────── */

export function getLedger(db: Db, ledgerId: number): LedgerRow {
  const row = db.prepare("SELECT * FROM ledgers WHERE id = ?").get(ledgerId) as LedgerRow | undefined;
  if (!row) throw notFound("Abrechnung");
  return row;
}

/** Zugriff: Admin, oder verknüpfter Teilnehmer der Reisekasse. */
export function assertLedgerAccess(db: Db, user: AuthUser, ledgerId: number): LedgerRow {
  const ledger = getLedger(db, ledgerId);
  if (user.isAdmin) return ledger;
  const hit = db
    .prepare("SELECT 1 FROM participants WHERE ledger_id = ? AND user_id = ?")
    .get(ledgerId, user.id);
  if (!hit) throw forbidden("Kein Zugriff auf diese Abrechnung");
  return ledger;
}

function listMembers(db: Db, ledgerId: number): MemberRow[] {
  return db
    .prepare("SELECT * FROM participants WHERE ledger_id = ? ORDER BY display_name COLLATE NOCASE, id")
    .all(ledgerId) as MemberRow[];
}

function listCouples(db: Db, ledgerId: number): CoupleRow[] {
  return db
    .prepare("SELECT * FROM ledger_couples WHERE ledger_id = ? ORDER BY id")
    .all(ledgerId) as CoupleRow[];
}

function getMember(db: Db, ledgerId: number, memberId: number): MemberRow {
  const m = db
    .prepare("SELECT * FROM participants WHERE id = ? AND ledger_id = ?")
    .get(memberId, ledgerId) as MemberRow | undefined;
  if (!m) throw new HttpError(422, "invalid_member", "Teilnehmer gehört nicht zu dieser Abrechnung");
  return m;
}

function touch(db: Db, ledgerId: number): void {
  db.prepare("UPDATE ledgers SET updated_at = ? WHERE id = ?").run(now(), ledgerId);
}

function requireDate(value: string | null | undefined, label: string): string | null {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${label}: erwartet YYYY-MM-DD`);
  return value;
}

function requireMinor(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) throw badRequest(`${label}: ganzzahliger Betrag in Rappen erwartet`);
}

/* ───────────── Abrechnungen ───────────── */

/** Legt nur die Zeile der Reisekasse an (Teilnehmer fügt der Aufrufer hinzu). */
export function insertLedgerRow(
  db: Db,
  input: { title: string; baseCurrency?: string; tripId?: number | null; userId?: number | null }
): number {
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO ledgers (title, base_currency, trip_id, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.title.trim(), (input.baseCurrency ?? "CHF").trim().toUpperCase(), input.tripId ?? null, input.userId ?? null, ts, ts);
  return Number(res.lastInsertRowid);
}

/**
 * Fügt einer Reisekasse einen Teilnehmer hinzu. Gehört die Kasse zu einer Reise, ist es zugleich ein
 * Mitreisender dieser Reise (eine Tabelle, eine ID).
 */
export function insertParticipant(
  db: Db,
  input: {
    ledgerId: number | null;
    tripId: number | null;
    displayName: string;
    email?: string | null;
    userId?: number | null;
    sortKey?: number;
  }
): number {
  const color = nextColorIndex(db, input.tripId != null ? { tripId: input.tripId } : { ledgerId: input.ledgerId });
  const sort =
    input.sortKey ??
    (
      db
        .prepare(
          input.tripId != null
            ? "SELECT COALESCE(MAX(sort_key), -1) + 1 AS n FROM participants WHERE trip_id = ?"
            : "SELECT COALESCE(MAX(sort_key), -1) + 1 AS n FROM participants WHERE ledger_id = ?"
        )
        .get(input.tripId ?? input.ledgerId) as { n: number }
    ).n;
  const res = db
    .prepare(
      `INSERT INTO participants (trip_id, ledger_id, display_name, email, user_id, color_index, sort_key, share_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.tripId, input.ledgerId, input.displayName, input.email ?? null, input.userId ?? null, color, sort, newShareToken(), now());
  return Number(res.lastInsertRowid);
}

/**
 * Eigenständige Reisekasse (ohne Reise). Die App legt Reisekassen über die Reise an (automatisch);
 * diese Funktion bleibt für Altdaten, Import und Tests.
 */
export function createLedger(
  db: Db,
  user: AuthUser,
  input: {
    title: string;
    baseCurrency?: string;
    tripId?: number | null;
    members?: { displayName: string; email?: string | null; userId?: number | null }[];
  }
): number {
  const title = input.title.trim();
  if (!title) throw badRequest("Titel erforderlich");
  if (input.tripId != null) {
    if (!db.prepare("SELECT 1 FROM trips WHERE id = ?").get(input.tripId)) throw notFound("Reise");
    if (db.prepare("SELECT 1 FROM ledgers WHERE trip_id = ?").get(input.tripId)) {
      throw conflict("Zur Reise existiert bereits eine Reisekasse", "ledger_exists");
    }
  }
  return db.transaction(() => {
    const ledgerId = insertLedgerRow(db, { title, baseCurrency: input.baseCurrency, tripId: input.tripId, userId: user.id });
    const tripId = input.tripId ?? null;
    insertParticipant(db, { ledgerId, tripId, displayName: user.displayName, email: user.email, userId: user.id });
    const linked = new Set<number>([user.id]);
    for (const m of input.members ?? []) {
      const name = m.displayName.trim();
      if (!name) continue;
      if (m.userId != null) {
        if (linked.has(m.userId)) {
          throw conflict("Dieses Konto ist bereits Teilnehmer dieser Abrechnung", "user_already_member");
        }
        const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(m.userId);
        if (!u) throw new HttpError(422, "invalid_user", "Benutzer nicht gefunden");
        linked.add(m.userId);
      }
      insertParticipant(db, { ledgerId, tripId, displayName: name, email: m.email, userId: m.userId });
    }
    return ledgerId;
  })();
}

export function updateLedger(
  db: Db,
  ledgerId: number,
  patch: { title?: string; archived?: boolean; baseCurrency?: string }
): void {
  const ledger = getLedger(db, ledgerId);
  if (patch.baseCurrency && patch.baseCurrency.toUpperCase() !== ledger.base_currency) {
    const used = db.prepare("SELECT 1 FROM expenses WHERE ledger_id = ? LIMIT 1").get(ledgerId);
    if (used) {
      throw conflict("Basiswährung kann nicht mehr geändert werden, sobald Ausgaben existieren", "currency_locked");
    }
  }
  const title = patch.title !== undefined ? patch.title.trim() : ledger.title;
  if (!title) throw badRequest("Titel erforderlich");
  const archivedAt =
    patch.archived === undefined ? ledger.archived_at : patch.archived ? ledger.archived_at ?? now() : null;
  db.prepare(
    "UPDATE ledgers SET title = ?, base_currency = ?, archived_at = ?, updated_at = ? WHERE id = ?"
  ).run(title, (patch.baseCurrency ?? ledger.base_currency).toUpperCase(), archivedAt, now(), ledgerId);
}

export function deleteLedger(db: Db, ledgerId: number): void {
  const ledger = getLedger(db, ledgerId);
  if (ledger.trip_id != null) {
    throw conflict("Die Reisekasse gehört zur Reise und wird mit ihr gelöscht", "ledger_of_trip");
  }
  db.prepare("DELETE FROM ledgers WHERE id = ?").run(ledgerId);
}

/* ───────────── Mitglieder & Paare ───────────── */

export function addMember(
  db: Db,
  ledgerId: number,
  input: { displayName: string; email?: string | null; userId?: number | null }
): MemberRow {
  const ledger = getLedger(db, ledgerId);
  const name = input.displayName.trim();
  if (!name) throw badRequest("Name erforderlich");
  if (input.userId != null) {
    const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(input.userId);
    if (!u) throw new HttpError(422, "invalid_user", "Benutzer nicht gefunden");
  }
  const id = insertParticipant(db, {
    ledgerId,
    tripId: ledger.trip_id,
    displayName: name,
    email: input.email,
    userId: input.userId,
  });
  touch(db, ledgerId);
  return getMember(db, ledgerId, id);
}

export function updateMember(
  db: Db,
  ledgerId: number,
  memberId: number,
  patch: { displayName?: string; email?: string | null; userId?: number | null; coupleId?: number | null }
): MemberRow {
  const m = getMember(db, ledgerId, memberId);
  const displayName = patch.displayName !== undefined ? patch.displayName.trim() : m.display_name;
  if (!displayName) throw badRequest("Name erforderlich");
  const coupleId = patch.coupleId !== undefined ? patch.coupleId : m.couple_id;
  if (coupleId != null) {
    const c = db
      .prepare("SELECT 1 FROM ledger_couples WHERE id = ? AND ledger_id = ?")
      .get(coupleId, ledgerId);
    if (!c) throw new HttpError(422, "invalid_couple", "Paar gehört nicht zu dieser Abrechnung");
  }
  const userId = patch.userId !== undefined ? patch.userId : m.user_id;
  if (userId != null) {
    const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId);
    if (!u) throw new HttpError(422, "invalid_user", "Benutzer nicht gefunden");
  }
  db.prepare(
    "UPDATE participants SET display_name = ?, email = ?, user_id = ?, couple_id = ? WHERE id = ?"
  ).run(displayName, patch.email !== undefined ? patch.email : m.email, userId, coupleId, memberId);
  touch(db, ledgerId);
  return getMember(db, ledgerId, memberId);
}

export function removeMember(db: Db, ledgerId: number, memberId: number): void {
  const m = getMember(db, ledgerId, memberId);
  if (m.trip_id != null) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM participants WHERE trip_id = ?").get(m.trip_id) as { n: number }).n;
    if (n <= 1) throw conflict("Eine Reise braucht mindestens einen Teilnehmer", "last_traveler");
  }
  deleteParticipant(db, memberId);
  touch(db, ledgerId);
}

/** Hat der Teilnehmer Buchungen (Ausgaben, Anteile, Rückzahlungen)? */
export function participantInUse(db: Db, participantId: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM expenses WHERE paid_by_participant_id = ? OR created_by_participant_id = ? LIMIT 1").get(participantId, participantId) ||
      db.prepare("SELECT 1 FROM expense_splits WHERE participant_id = ? LIMIT 1").get(participantId) ||
      db
        .prepare(
          "SELECT 1 FROM settlements WHERE from_participant_id = ? OR to_participant_id = ? OR created_by_participant_id = ? LIMIT 1"
        )
        .get(participantId, participantId, participantId)
  );
}

/**
 * Entfernt einen Teilnehmer endgültig (409 `member_in_use`, wenn er Buchungen hat) und räumt Verweise in
 * Ereignissen auf (`details.passengers`, «Wer ist dabei», Zahler).
 */
export function deleteParticipant(db: Db, participantId: number): void {
  if (participantInUse(db, participantId)) {
    throw conflict("Teilnehmer hat Buchungen und kann nicht entfernt werden", "member_in_use");
  }
  db.transaction(() => {
    const p = db.prepare("SELECT trip_id FROM participants WHERE id = ?").get(participantId) as { trip_id: number | null } | undefined;
    if (p?.trip_id != null) {
      const events = db
        .prepare("SELECT id, details FROM trip_events WHERE trip_id = ? AND details LIKE '%\"passengers\"%'")
        .all(p.trip_id) as Array<{ id: number; details: string }>;
      for (const e of events) {
        try {
          const d = JSON.parse(e.details) as { passengers?: Array<{ participantId?: number }> };
          if (Array.isArray(d.passengers)) {
            const kept = d.passengers.filter((x) => x.participantId !== participantId);
            if (kept.length !== d.passengers.length) {
              if (kept.length) d.passengers = kept;
              else delete d.passengers;
              db.prepare("UPDATE trip_events SET details = ? WHERE id = ?").run(JSON.stringify(d), e.id);
            }
          }
        } catch {
          /* unlesbare Details nicht anfassen */
        }
      }
    }
    db.prepare("DELETE FROM participants WHERE id = ?").run(participantId);
  })();
}

export function createCouple(db: Db, ledgerId: number, memberIds: number[], name?: string | null): CoupleRow {
  const ids = [...new Set(memberIds)];
  if (ids.length < 2) throw badRequest("Ein Paar braucht mindestens zwei Personen");
  const members = ids.map((id) => getMember(db, ledgerId, id));
  if (members.some((m) => m.couple_id != null)) {
    throw conflict("Mindestens eine Person gehört bereits zu einem Paar", "already_in_couple");
  }
  return db.transaction(() => {
    const label = name?.trim() || members.map((m) => m.display_name).join(" & ");
    const res = db
      .prepare("INSERT INTO ledger_couples (ledger_id, name, created_at) VALUES (?, ?, ?)")
      .run(ledgerId, label, now());
    const coupleId = Number(res.lastInsertRowid);
    const upd = db.prepare("UPDATE participants SET couple_id = ? WHERE id = ?");
    for (const id of ids) upd.run(coupleId, id);
    touch(db, ledgerId);
    return db.prepare("SELECT * FROM ledger_couples WHERE id = ?").get(coupleId) as CoupleRow;
  })();
}

export function deleteCouple(db: Db, ledgerId: number, coupleId: number): void {
  const c = db
    .prepare("SELECT * FROM ledger_couples WHERE id = ? AND ledger_id = ?")
    .get(coupleId, ledgerId);
  if (!c) throw notFound("Paar");
  db.prepare("DELETE FROM ledger_couples WHERE id = ?").run(coupleId);
  touch(db, ledgerId);
}

/* ───────────── Einladungen & Gäste ───────────── */

export function rotateInvite(db: Db, ledgerId: number, memberId: number): MemberRow {
  getMember(db, ledgerId, memberId);
  db.prepare("UPDATE participants SET share_token = ?, share_revoked_at = NULL WHERE id = ?").run(
    newShareToken(),
    memberId
  );
  return getMember(db, ledgerId, memberId);
}

export function revokeInvite(db: Db, ledgerId: number, memberId: number): MemberRow {
  getMember(db, ledgerId, memberId);
  db.prepare("UPDATE participants SET share_revoked_at = ? WHERE id = ?").run(now(), memberId);
  return getMember(db, ledgerId, memberId);
}

export type GuestContext = { member: MemberRow; ledger: LedgerRow };

/** Unbekannte oder widerrufene Tokens sind für den Aufrufer ununterscheidbar (404). */
export function resolveGuest(db: Db, token: string): GuestContext {
  const member = (db
    .prepare("SELECT * FROM participants WHERE share_token = ? AND share_revoked_at IS NULL AND ledger_id IS NOT NULL")
    .get(token) ??
    // Zweiter Token einer importierten Person (HomeBuddy kannte je Person zwei Links), siehe 020_import_map.sql.
    db
      .prepare(
        `SELECT p.* FROM participant_token_aliases a JOIN participants p ON p.id = a.participant_id
          WHERE a.alias_token = ? AND a.primary_token = p.share_token AND p.share_revoked_at IS NULL AND p.ledger_id IS NOT NULL`
      )
      .get(token)) as MemberRow | undefined;
  if (!member) throw notFound("Einladung");
  return { member, ledger: getLedger(db, member.ledger_id!) };
}

export function assertWritable(ledger: LedgerRow): void {
  if (ledger.archived_at) throw conflict("Die Abrechnung ist archiviert", "archived");
}

/* ───────────── Aufteilung ───────────── */

function buildSplitMap(db: Db, ledger: LedgerRow, amountBaseMinor: number, split: SplitInput): SplitMap {
  const members = listMembers(db, ledger.id);
  const memberSet = new Set(members.map((m) => m.id));
  const assertMember = (id: number) => {
    if (!memberSet.has(id)) throw new HttpError(422, "invalid_member", "Ungültiger Teilnehmer");
  };

  switch (split.mode) {
    case "equal": {
      const ids = split.memberIds?.length ? [...new Set(split.memberIds)] : members.map((m) => m.id);
      if (ids.length === 0) throw new HttpError(422, "invalid_split", "Mindestens eine Person wählen");
      ids.forEach(assertMember);
      return splitEqual(amountBaseMinor, ids);
    }
    case "coupleEqual": {
      const couples = listCouples(db, ledger.id);
      const known = new Set(couples.map((c) => c.id));
      const ids = split.coupleIds?.length ? [...new Set(split.coupleIds)] : couples.map((c) => c.id);
      if (ids.length === 0) throw new HttpError(422, "invalid_split", "Mindestens ein Paar wählen");
      for (const id of ids) {
        if (!known.has(id)) throw new HttpError(422, "invalid_couple", "Ungültiges Paar");
      }
      const groups = ids.map((coupleId) => ({
        coupleId,
        memberIds: members.filter((m) => m.couple_id === coupleId).map((m) => m.id),
      }));
      if (groups.some((g) => g.memberIds.length === 0)) {
        throw new HttpError(422, "invalid_split", "Gewähltes Paar hat keine Teilnehmer");
      }
      return splitCoupleEqual(amountBaseMinor, groups);
    }
    case "exact": {
      split.amounts.forEach((a) => {
        assertMember(a.memberId);
        requireMinor(a.amountBaseMinor, "Anteil");
      });
      return splitExact(amountBaseMinor, split.amounts);
    }
    case "shares": {
      for (const s of split.shares) {
        assertMember(s.memberId);
        if (!(s.units > 0)) throw new HttpError(422, "invalid_split", "Anteile müssen positiv sein");
      }
      return splitShares(amountBaseMinor, split.shares);
    }
  }
}

function insertSplits(db: Db, expenseId: number, map: SplitMap, units?: Map<number, number>): void {
  const ins = db.prepare(
    "INSERT INTO expense_splits (expense_id, participant_id, share_base_minor, share_units) VALUES (?, ?, ?, ?)"
  );
  for (const [memberId, share] of map) ins.run(expenseId, memberId, share, units?.get(memberId) ?? null);
}

function unitsOf(split: SplitInput): Map<number, number> | undefined {
  return split.mode === "shares" ? new Map(split.shares.map((s) => [s.memberId, s.units])) : undefined;
}

/* ───────────── Ausgaben ───────────── */

/** Verknüpfungen müssen existieren und zur Reise der Abrechnung passen. */
function assertExpenseLinks(
  db: Db,
  ledger: LedgerRow,
  documentId: number | null | undefined,
  tripEventId: number | null | undefined
): void {
  if (documentId != null) {
    const d = db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId);
    if (!d) throw new HttpError(422, "invalid_document", "Dokument nicht gefunden");
  }
  if (tripEventId != null) {
    const e = db.prepare("SELECT trip_id FROM trip_events WHERE id = ?").get(tripEventId) as
      | { trip_id: number }
      | undefined;
    if (!e) throw new HttpError(422, "invalid_trip_event", "Reise-Ereignis nicht gefunden");
    if (ledger.trip_id != null && e.trip_id !== ledger.trip_id) {
      throw new HttpError(422, "invalid_trip_event", "Das Ereignis gehört nicht zur verknüpften Reise");
    }
  }
}

export type CreateExpenseInput = {
  paidByMemberId?: number;
  createdByMemberId?: number | null;
  amountMinor: number;
  currency: string;
  exchangeRate?: number;
  direction?: Direction;
  description?: string | null;
  expenseDate?: string | null;
  category?: string | null;
  note?: string | null;
  documentId?: number | null;
  tripEventId?: number | null;
  place?: { name?: string | null; lat?: number | null; lon?: number | null } | null;
  split?: SplitInput;
  /** Zählt in den Kosten, wird aber sofort an den Zahler zurückgebucht (Saldo bleibt neutral). */
  preSettled?: boolean;
};

function baseAmount(ledger: LedgerRow, amountMinor: number, currency: string, rate: number | undefined) {
  const cur = currency.trim().toUpperCase();
  if (cur === ledger.base_currency) return { currency: cur, rate: 1, base: amountMinor };
  const r = rate ?? 0;
  if (!(r > 0)) throw new HttpError(422, "exchange_rate_required", "Wechselkurs erforderlich");
  return { currency: cur, rate: r, base: convertMinor(amountMinor, cur, ledger.base_currency, r) };
}

export function createExpense(db: Db, ledgerId: number, input: CreateExpenseInput): ExpenseRow {
  const ledger = getLedger(db, ledgerId);
  requireMinor(input.amountMinor, "Betrag");
  if (input.amountMinor <= 0) throw badRequest("Betrag muss positiv sein");
  const direction: Direction = input.direction ?? "expense";

  const paidBy = input.paidByMemberId;
  if (paidBy == null) throw new HttpError(422, "payer_required", "Zahler ist erforderlich");
  if (!input.split) throw new HttpError(422, "split_required", "Aufteilung ist erforderlich");
  getMember(db, ledgerId, paidBy);
  const split: SplitInput = input.split;
  if (input.createdByMemberId != null) getMember(db, ledgerId, input.createdByMemberId);

  const { currency, rate, base } = baseAmount(ledger, input.amountMinor, input.currency, input.exchangeRate);
  assertExpenseLinks(db, ledger, input.documentId, input.tripEventId);
  const date = requireDate(input.expenseDate, "Datum");
  const preSettled = Boolean(input.preSettled) && direction === "expense";

  return db.transaction(() => {
    const map = buildSplitMap(db, ledger, base, split);
    const ts = now();
    const res = db
      .prepare(
        `INSERT INTO expenses (
           ledger_id, paid_by_participant_id, created_by_participant_id, direction,
           amount_minor, currency, exchange_rate, amount_base_minor,
           description, expense_date, category_label, note, split_mode, settled_status,
           document_id, trip_event_id, place_name, place_lat, place_lon, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ledgerId, paidBy, input.createdByMemberId ?? null, direction,
        input.amountMinor, currency, rate, base,
        input.description?.trim() || null, date, input.category?.trim() || null,
        input.note?.trim() || null, split.mode, preSettled ? 1 : 0,
        input.documentId ?? null, input.tripEventId ?? null,
        input.place?.name?.trim() || null, input.place?.lat ?? null, input.place?.lon ?? null,
        ts, ts
      );
    const expenseId = Number(res.lastInsertRowid);
    insertSplits(db, expenseId, map, unitsOf(split));
    if (preSettled) settleSharesToPayer(db, expenseId, "Auto-Ausgleich");
    if (input.tripEventId != null) {
      db.prepare("UPDATE trip_events SET expense_id = ? WHERE id = ? AND expense_id IS NULL").run(expenseId, input.tripEventId);
    }
    touch(db, ledgerId);
    return getExpenseRow(db, ledgerId, expenseId);
  })();
}

function getExpenseRow(db: Db, ledgerId: number, expenseId: number): ExpenseRow {
  const row = db
    .prepare("SELECT * FROM expenses WHERE id = ? AND ledger_id = ?")
    .get(expenseId, ledgerId) as ExpenseRow | undefined;
  if (!row) throw notFound("Ausgabe");
  return row;
}

export type UpdateExpenseInput = Partial<
  Omit<CreateExpenseInput, "createdByMemberId" | "preSettled">
>;

export function updateExpense(
  db: Db,
  ledgerId: number,
  expenseId: number,
  patch: UpdateExpenseInput
): ExpenseRow {
  const ledger = getLedger(db, ledgerId);
  const ex = getExpenseRow(db, ledgerId, expenseId);

  const amountMinor = patch.amountMinor ?? ex.amount_minor;
  requireMinor(amountMinor, "Betrag");
  if (amountMinor <= 0) throw badRequest("Betrag muss positiv sein");
  const currencyInput = patch.currency ?? ex.currency;
  const rateInput = patch.exchangeRate ?? ex.exchange_rate;
  const { currency, rate, base } = baseAmount(ledger, amountMinor, currencyInput, rateInput);
  const amountChanged = base !== ex.amount_base_minor;

  const paidBy = patch.paidByMemberId ?? ex.paid_by_participant_id;
  if (paidBy !== ex.paid_by_participant_id) getMember(db, ledgerId, paidBy);
  assertExpenseLinks(db, ledger, patch.documentId, patch.tripEventId);

  return db.transaction(() => {
    let split: SplitInput | null = null;
    let map: SplitMap | null = null;

    if (patch.split || amountChanged) {
      split = patch.split ?? deriveSplitFromExisting(db, ex, base);
      map = buildSplitMap(db, ledger, base, split);
    }

    const place = patch.place === undefined ? undefined : patch.place;
    db.prepare(
      `UPDATE expenses SET
         paid_by_participant_id = ?, direction = ?, amount_minor = ?, currency = ?, exchange_rate = ?,
         amount_base_minor = ?, description = ?, expense_date = ?, category_label = ?, note = ?,
         split_mode = ?, document_id = ?, trip_event_id = ?, place_name = ?, place_lat = ?, place_lon = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      paidBy,
      patch.direction ?? ex.direction,
      amountMinor, currency, rate, base,
      patch.description !== undefined ? patch.description?.trim() || null : ex.description,
      patch.expenseDate !== undefined ? requireDate(patch.expenseDate, "Datum") : ex.expense_date,
      patch.category !== undefined ? patch.category?.trim() || null : ex.category_label,
      patch.note !== undefined ? patch.note?.trim() || null : ex.note,
      split?.mode ?? ex.split_mode,
      patch.documentId !== undefined ? patch.documentId : ex.document_id,
      patch.tripEventId !== undefined ? patch.tripEventId : ex.trip_event_id,
      place === undefined ? ex.place_name : place?.name?.trim() || null,
      place === undefined ? ex.place_lat : place?.lat ?? null,
      place === undefined ? ex.place_lon : place?.lon ?? null,
      now(),
      expenseId
    );

    if (map && split) {
      db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").run(expenseId);
      insertSplits(db, expenseId, map, unitsOf(split));
    }
    if (patch.tripEventId !== undefined) {
      db.prepare("UPDATE trip_events SET expense_id = NULL WHERE expense_id = ?").run(expenseId);
      if (patch.tripEventId != null) {
        db.prepare("UPDATE trip_events SET expense_id = ? WHERE id = ? AND expense_id IS NULL").run(expenseId, patch.tripEventId);
      }
    }
    // Bereits ausgeglichene Ausgaben: Auto-Rückzahlungen neu aufbauen.
    if (ex.settled_status !== 0 && (map || paidBy !== ex.paid_by_participant_id)) {
      db.prepare("DELETE FROM settlements WHERE related_expense_id = ?").run(expenseId);
      settleSharesToPayer(
        db,
        expenseId,
        ex.settled_status === 2 ? "Manueller Paar-Ausgleich" : "Auto-Ausgleich"
      );
    }
    touch(db, ledgerId);
    return getExpenseRow(db, ledgerId, expenseId);
  })();
}

/** Beim blossen Ändern des Betrags: gleiche Personen/Gewichte wie bisher. */
function deriveSplitFromExisting(db: Db, ex: ExpenseRow, newBaseMinor: number): SplitInput {
  const rows = db
    .prepare("SELECT * FROM expense_splits WHERE expense_id = ? ORDER BY participant_id")
    .all(ex.id) as SplitRow[];
  if (ex.split_mode === "equal") {
    return { mode: "equal", memberIds: rows.map((r) => r.participant_id) };
  }
  if (ex.split_mode === "shares" && rows.every((r) => r.share_units != null)) {
    return { mode: "shares", shares: rows.map((r) => ({ memberId: r.participant_id, units: r.share_units! })) };
  }
  if (ex.split_mode === "exact") {
    // Proportional skalieren: Die bisherigen Anteile bleiben im gleichen Verhältnis.
    const weights = rows.filter((r) => r.share_base_minor > 0).map((r) => ({ id: r.participant_id, weight: r.share_base_minor }));
    if (weights.length > 0) {
      const scaled = splitByWeights(newBaseMinor, weights);
      return {
        mode: "exact",
        amounts: [...scaled].map(([memberId, amountBaseMinor]) => ({ memberId, amountBaseMinor })),
      };
    }
  }
  if (ex.split_mode === "coupleEqual") {
    const ids = rows.filter((r) => r.share_base_minor > 0).map((r) => r.participant_id);
    const coupleIds = new Set<number>();
    let complete = ids.length > 0;
    for (const id of ids) {
      const m = db.prepare("SELECT couple_id FROM participants WHERE id = ?").get(id) as { couple_id: number | null } | undefined;
      if (m?.couple_id == null) complete = false;
      else coupleIds.add(m.couple_id);
    }
    if (complete) return { mode: "coupleEqual", coupleIds: [...coupleIds] };
  }
  throw new HttpError(
    422,
    "split_required",
    "Beim Ändern des Betrags muss die Aufteilung erneut angegeben werden"
  );
}

export function deleteExpense(db: Db, ledgerId: number, expenseId: number): void {
  getExpenseRow(db, ledgerId, expenseId);
  db.prepare("DELETE FROM expenses WHERE id = ?").run(expenseId); // splits + Auto-Rückzahlungen kaskadieren
  touch(db, ledgerId);
}

/* ───────────── Rückzahlungen ───────────── */

function insertSettlement(
  db: Db,
  ledger: LedgerRow,
  input: {
    fromMemberId: number;
    toMemberId: number;
    amountMinor: number;
    currency: string;
    exchangeRate?: number;
    note?: string | null;
    settledAt?: string | null;
    createdByMemberId?: number | null;
    relatedExpenseId?: number | null;
  }
): number {
  requireMinor(input.amountMinor, "Betrag");
  if (input.amountMinor <= 0) throw badRequest("Betrag muss positiv sein");
  if (input.fromMemberId === input.toMemberId) throw badRequest("Zahler und Empfänger müssen verschieden sein");
  getMember(db, ledger.id, input.fromMemberId);
  getMember(db, ledger.id, input.toMemberId);
  const { currency, rate, base } = baseAmount(ledger, input.amountMinor, input.currency, input.exchangeRate);
  if (base <= 0) throw badRequest("Betrag in Basiswährung muss positiv sein");
  const res = db
    .prepare(
      `INSERT INTO settlements (
         ledger_id, from_participant_id, to_participant_id, amount_minor, currency, exchange_rate,
         amount_base_minor, note, settled_at, created_by_participant_id, related_expense_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ledger.id, input.fromMemberId, input.toMemberId, input.amountMinor, currency, rate, base,
      input.note?.trim() || null,
      requireDate(input.settledAt, "Datum") ?? today(),
      input.createdByMemberId ?? null, input.relatedExpenseId ?? null, now()
    );
  return Number(res.lastInsertRowid);
}

export function createSettlement(
  db: Db,
  ledgerId: number,
  input: Omit<Parameters<typeof insertSettlement>[2], "relatedExpenseId">
): SettlementRow {
  const ledger = getLedger(db, ledgerId);
  return db.transaction(() => {
    const id = insertSettlement(db, ledger, input);
    touch(db, ledgerId);
    return db.prepare("SELECT * FROM settlements WHERE id = ?").get(id) as SettlementRow;
  })();
}

export function deleteSettlement(db: Db, ledgerId: number, settlementId: number): void {
  const s = db
    .prepare("SELECT id, related_expense_id FROM settlements WHERE id = ? AND ledger_id = ?")
    .get(settlementId, ledgerId) as { id: number; related_expense_id: number | null } | undefined;
  if (!s) throw notFound("Rückzahlung");
  if (s.related_expense_id != null) {
    throw conflict(
      "Automatische Rückzahlung gehört zu einer Ausgabe und wird mit ihr verwaltet",
      "auto_settlement"
    );
  }
  db.prepare("DELETE FROM settlements WHERE id = ?").run(settlementId);
  touch(db, ledgerId);
}

/** Bucht die Anteile aller anderen Personen als Rückzahlung an den Zahler. */
function settleSharesToPayer(db: Db, expenseId: number, notePrefix: string): number {
  const ex = db.prepare("SELECT * FROM expenses WHERE id = ?").get(expenseId) as ExpenseRow;
  const ledger = getLedger(db, ex.ledger_id);
  const label = ex.description?.trim() || `Ausgabe #${ex.id}`;
  const splits = db
    .prepare("SELECT * FROM expense_splits WHERE expense_id = ? ORDER BY participant_id")
    .all(expenseId) as SplitRow[];
  let count = 0;
  for (const s of splits) {
    if (s.participant_id === ex.paid_by_participant_id || s.share_base_minor <= 0) continue;
    insertSettlement(db, ledger, {
      fromMemberId: s.participant_id,
      toMemberId: ex.paid_by_participant_id,
      amountMinor: s.share_base_minor,
      currency: ledger.base_currency,
      note: `${notePrefix}: ${label}`,
      settledAt: ex.expense_date,
      createdByMemberId: ex.created_by_participant_id,
      relatedExpenseId: expenseId,
    });
    count += 1;
  }
  return count;
}

/** Paar hat untereinander ausgeglichen: Anteil des Partners als Rückzahlung buchen. */
export function settleCoupleExpense(db: Db, ledgerId: number, expenseId: number): ExpenseRow {
  const ex = getExpenseRow(db, ledgerId, expenseId);
  if (ex.direction !== "expense" || ex.settled_status !== 0) {
    throw conflict("Die Buchung ist nicht mehr offen", "not_open");
  }
  const positive = (
    db.prepare("SELECT * FROM expense_splits WHERE expense_id = ?").all(expenseId) as SplitRow[]
  ).filter((s) => s.share_base_minor > 0);
  const partnerSplit = positive.find((s) => s.participant_id !== ex.paid_by_participant_id);
  const payer = getMember(db, ledgerId, ex.paid_by_participant_id);
  const partner = partnerSplit ? getMember(db, ledgerId, partnerSplit.participant_id) : null;
  if (
    positive.length !== 2 ||
    !partner ||
    payer.couple_id == null ||
    payer.couple_id !== partner.couple_id
  ) {
    throw conflict(
      "Paar-Ausgleich nur möglich, wenn genau zwei Personen desselben Paars beteiligt sind",
      "not_couple_expense"
    );
  }
  return db.transaction(() => {
    settleSharesToPayer(db, expenseId, "Manueller Paar-Ausgleich");
    db.prepare("UPDATE expenses SET settled_status = 2, updated_at = ? WHERE id = ?").run(now(), expenseId);
    touch(db, ledgerId);
    return getExpenseRow(db, ledgerId, expenseId);
  })();
}

/* ───────────── Lesen / Serialisieren ───────────── */

export function serializeMember(m: MemberRow, opts: { includeInvite?: boolean } = {}) {
  return {
    id: m.id,
    displayName: m.display_name,
    email: m.email,
    userId: m.user_id,
    coupleId: m.couple_id,
    colorIndex: m.color_index,
    /** Aus HomeBuddy (versteckte Solo-Mitglieder der Kassabücher); gibt es hier nicht mehr. */
    hidden: false,
    ...(opts.includeInvite
      ? { inviteToken: m.share_revoked_at ? null : m.share_token }
      : {}),
  };
}

export function serializeLedger(l: LedgerRow) {
  return {
    id: l.id,
    title: l.title,
    baseCurrency: l.base_currency,
    /** Immer «split» (Kassabücher entfallen); bleibt für HomeBuddy-Clients erhalten. */
    kind: "split" as const,
    tripId: l.trip_id,
    archivedAt: l.archived_at,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

function serializeExpense(e: ExpenseRow, splits: SplitRow[]) {
  return {
    id: e.id,
    ledgerId: e.ledger_id,
    paidByMemberId: e.paid_by_participant_id,
    createdByMemberId: e.created_by_participant_id,
    direction: e.direction,
    amountMinor: e.amount_minor,
    currency: e.currency,
    exchangeRate: e.exchange_rate,
    amountBaseMinor: e.amount_base_minor,
    description: e.description,
    expenseDate: e.expense_date,
    category: e.category_label,
    note: e.note,
    splitMode: e.split_mode,
    settledStatus: e.settled_status,
    documentId: e.document_id,
    tripEventId: e.trip_event_id,
    place: e.place_name || e.place_lat != null ? { name: e.place_name, lat: e.place_lat, lon: e.place_lon } : null,
    splits: splits
      .filter((s) => s.expense_id === e.id)
      .map((s) => ({ memberId: s.participant_id, shareBaseMinor: s.share_base_minor, shareUnits: s.share_units })),
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

export function listExpenses(db: Db, ledgerId: number) {
  const rows = db
    .prepare(
      `SELECT * FROM expenses WHERE ledger_id = ?
        ORDER BY COALESCE(expense_date, substr(created_at, 1, 10)) DESC, id DESC`
    )
    .all(ledgerId) as ExpenseRow[];
  const splits = db
    .prepare(
      `SELECT s.* FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.ledger_id = ?`
    )
    .all(ledgerId) as SplitRow[];
  return rows.map((e) => serializeExpense(e, splits));
}

export function getExpense(db: Db, ledgerId: number, expenseId: number) {
  const e = getExpenseRow(db, ledgerId, expenseId);
  const splits = db.prepare("SELECT * FROM expense_splits WHERE expense_id = ?").all(expenseId) as SplitRow[];
  return serializeExpense(e, splits);
}

export function serializeSettlement(s: SettlementRow) {
  return {
    id: s.id,
    ledgerId: s.ledger_id,
    fromMemberId: s.from_participant_id,
    toMemberId: s.to_participant_id,
    amountMinor: s.amount_minor,
    currency: s.currency,
    exchangeRate: s.exchange_rate,
    amountBaseMinor: s.amount_base_minor,
    note: s.note,
    settledAt: s.settled_at,
    relatedExpenseId: s.related_expense_id,
    auto: s.related_expense_id != null,
    createdAt: s.created_at,
  };
}

export function listSettlements(db: Db, ledgerId: number) {
  const rows = db
    .prepare("SELECT * FROM settlements WHERE ledger_id = ? ORDER BY settled_at DESC, id DESC")
    .all(ledgerId) as SettlementRow[];
  return rows.map(serializeSettlement);
}

function collectBalanceInputs(db: Db, ledgerId: number, members: MemberRow[]): BalanceInput[] {
  const sumBy = (sql: string) =>
    new Map(
      (db.prepare(sql).all(ledgerId) as { k: number; v: number }[]).map((r) => [r.k, r.v])
    );
  const paid = sumBy(
    `SELECT paid_by_participant_id AS k, SUM(amount_base_minor) AS v FROM expenses
      WHERE ledger_id = ? AND direction = 'expense' GROUP BY paid_by_participant_id`
  );
  const owed = sumBy(
    `SELECT s.participant_id AS k, SUM(s.share_base_minor) AS v
       FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
      WHERE e.ledger_id = ? AND e.direction = 'expense' GROUP BY s.participant_id`
  );
  const sent = sumBy(
    `SELECT from_participant_id AS k, SUM(amount_base_minor) AS v FROM settlements
      WHERE ledger_id = ? GROUP BY from_participant_id`
  );
  const received = sumBy(
    `SELECT to_participant_id AS k, SUM(amount_base_minor) AS v FROM settlements
      WHERE ledger_id = ? GROUP BY to_participant_id`
  );
  return members.map((m) => ({
    memberId: m.id,
    displayName: m.display_name,
    paidMinor: paid.get(m.id) ?? 0,
    owedMinor: owed.get(m.id) ?? 0,
    settlementsPaidMinor: sent.get(m.id) ?? 0,
    settlementsReceivedMinor: received.get(m.id) ?? 0,
  }));
}

export function ledgerOverview(
  db: Db,
  ledgerId: number,
  opts: { includeInvites?: boolean; forUserId?: number; includeMedia?: boolean } = {}
) {
  const ledger = getLedger(db, ledgerId);
  const members = listMembers(db, ledgerId);
  const couples = listCouples(db, ledgerId);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'expense' THEN amount_base_minor END), 0) AS expense,
         COALESCE(SUM(CASE WHEN direction = 'income' THEN amount_base_minor END), 0) AS income,
         COUNT(*) AS count
       FROM expenses WHERE ledger_id = ?`
    )
    .get(ledgerId) as { expense: number; income: number; count: number };

  const base = {
    ledger: {
      ...serializeLedger(ledger),
      // Nur für angemeldete Administratoren: Gäste können das Bild nicht öffnen (kein Token).
      ...(opts.includeMedia
        ? { coverUrl: ledger.trip_id != null ? mediaUrls(db, "trip_cover", [ledger.trip_id]).get(ledger.trip_id) ?? null : null }
        : {}),
    },
    /** Mein Teilnehmer in dieser Abrechnung (über das Konto verknüpft), sonst null. */
    myMemberId: opts.forUserId != null ? members.find((m) => m.user_id === opts.forUserId)?.id ?? null : null,
    soloMemberId: null,
    members: members.map((m) => serializeMember(m, { includeInvite: opts.includeInvites })),
    couples: couples.map((c) => ({
      id: c.id,
      name: c.name,
      memberIds: members.filter((m) => m.couple_id === c.id).map((m) => m.id),
    })),
    totals: {
      expenseMinor: totals.expense,
      incomeMinor: totals.income,
      netMinor: totals.income - totals.expense,
      count: totals.count,
    },
  };
  const balances = computeMemberBalances(collectBalanceInputs(db, ledgerId, members));
  const { transfers, steps } = explainSimplifyDebts(balances);

  const nameById = new Map(members.map((m) => [m.id, m.display_name]));
  const edges: DebtEdge[] = [];
  const expenseRows = db
    .prepare(
      `SELECT e.paid_by_participant_id AS payer, s.participant_id AS member, s.share_base_minor AS share
         FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
        WHERE e.ledger_id = ? AND e.direction = 'expense'`
    )
    .all(ledgerId) as { payer: number; member: number; share: number }[];
  for (const r of expenseRows) {
    if (r.member !== r.payer && r.share > 0) {
      edges.push({ fromMemberId: r.member, toMemberId: r.payer, amountMinor: r.share });
    }
  }
  const settlementEdges = (
    db
      .prepare("SELECT from_participant_id AS f, to_participant_id AS t, amount_base_minor AS a FROM settlements WHERE ledger_id = ?")
      .all(ledgerId) as { f: number; t: number; a: number }[]
  ).map((s) => ({ fromMemberId: s.f, toMemberId: s.t, amountMinor: s.a }));

  return {
    ...base,
    balances,
    suggestedTransfers: transfers,
    steps,
    payerDebts: buildPayerOrientedDebts(edges, settlementEdges, nameById),
  };
}

/** Salden aller Teilnehmer einer Reisekasse (Basiswährung), nach Name sortiert. */
export function participantBalances(db: Db, ledgerId: number): Array<{ memberId: number; displayName: string; netMinor: number }> {
  const members = listMembers(db, ledgerId);
  return computeMemberBalances(collectBalanceInputs(db, ledgerId, members)).map((b) => ({
    memberId: b.memberId,
    displayName: b.displayName,
    netMinor: b.netMinor,
  }));
}

/** Saldo (Basiswährung) eines Teilnehmers in einer Reisekasse; 0, wenn er nicht dazugehört. */
export function participantNet(db: Db, ledgerId: number, participantId: number): number {
  const members = listMembers(db, ledgerId);
  if (!members.some((m) => m.id === participantId)) return 0;
  const b = computeMemberBalances(collectBalanceInputs(db, ledgerId, members));
  return b.find((x) => x.memberId === participantId)?.netMinor ?? 0;
}

export type ArchivedMode = "exclude" | "include" | "only";

export function listLedgersForUser(db: Db, user: AuthUser, archived: ArchivedMode | boolean = "exclude") {
  const mode: ArchivedMode = archived === true ? "include" : archived === false ? "exclude" : archived;
  const rows = (
    user.isAdmin
      ? db.prepare("SELECT * FROM ledgers ORDER BY updated_at DESC").all()
      : db
          .prepare(
            `SELECT DISTINCT l.* FROM ledgers l
               JOIN participants m ON m.ledger_id = l.id
              WHERE m.user_id = ? ORDER BY l.updated_at DESC`
          )
          .all(user.id)
  ) as LedgerRow[];

  // Titelbild einer Reisekasse = Titelbild ihrer Reise.
  const tripIds = rows.map((l) => l.trip_id).filter((x): x is number => x != null);
  const covers = mediaUrls(db, "trip_cover", tripIds);
  return rows
    .filter((l) => (mode === "only" ? l.archived_at != null : mode === "include" || l.archived_at == null))
    .map((l) => {
      const members = listMembers(db, l.id);
      const mine = members.find((m) => m.user_id === user.id);
      let myNetMinor: number | null = null;
      if (mine) {
        const b = computeMemberBalances(collectBalanceInputs(db, l.id, members));
        myNetMinor = b.find((x) => x.memberId === mine.id)?.netMinor ?? null;
      }
      return {
        ...serializeLedger(l),
        coverUrl: l.trip_id != null ? covers.get(l.trip_id) ?? null : null,
        memberCount: members.length,
        myMemberId: mine?.id ?? null,
        myNetMinor,
      };
    });
}
