import type { Balance, Expense, Member, Transfer } from "../api/types";

/** Ausgaben nach Datum gruppiert, neueste zuerst (wie der Server sortiert). */
export function groupByDate<T extends { expenseDate?: string | null; settledAt?: string | null; createdAt: string }>(
  items: T[]
): { date: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const d = it.expenseDate ?? it.settledAt ?? it.createdAt.slice(0, 10);
    const list = groups.get(d);
    if (list) list.push(it);
    else groups.set(d, [it]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, items: list }));
}

/** Alle Salden 0? Dann zeigt die Oberfläche «Alles ausgeglichen» und keine Zahler-Ansicht. */
export function allSettled(balances: Balance[]): boolean {
  return balances.every((b) => b.netMinor === 0);
}

export type CappedTransfer = { amountMinor: number; capped: boolean; creditorNetMinor: number };

/**
 * Begrenzt einen Vorschlag auf das, was der Empfänger netto noch bekommt
 * (wie `capSettlementToCreditorNet` im Server). Verhindert Überzahlungen
 * in der Ansicht «Nach Zahler».
 */
export function capToCreditorNet(suggestedMinor: number, creditorNetMinor: number): CappedTransfer {
  const suggested = Math.max(0, suggestedMinor);
  const net = Math.max(0, creditorNetMinor);
  if (suggested <= net) return { amountMinor: suggested, capped: false, creditorNetMinor: net };
  return { amountMinor: net, capped: true, creditorNetMinor: net };
}

export type Tone = "credit" | "debit" | "even";
export function balanceTone(netMinor: number): Tone {
  return netMinor > 0 ? "credit" : netMinor < 0 ? "debit" : "even";
}

/** Text zum Saldo; nie nur Farbe. */
export function balanceLabel(netMinor: number, opts: { me?: boolean } = {}): string {
  if (netMinor > 0) return opts.me ? "Du bekommst" : "bekommt";
  if (netMinor < 0) return opts.me ? "Du schuldest" : "schuldet";
  return "ausgeglichen";
}

export function memberName(members: Member[], id: number | null | undefined): string {
  if (id == null) return "–";
  return members.find((m) => m.id === id)?.displayName ?? `#${id}`;
}

/** `https://host/g/<token>` für Einladungen (Gast ohne Konto). */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/g/${encodeURIComponent(token)}`;
}

/** `https://host/t/<token>` für Reise-Teilnehmer. */
export function tripShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/t/${encodeURIComponent(token)}`;
}

/** Anteil eines Mitglieds an einer Ausgabe (0, wenn nicht beteiligt). */
export function shareOf(e: Expense, memberId: number): number {
  return e.splits.find((s) => s.memberId === memberId)?.shareBaseMinor ?? 0;
}

/** Überweisungen, an denen ein Mitglied beteiligt ist, zuerst. */
export function prioritizeMine(transfers: Transfer[], memberId: number | null): Transfer[] {
  if (memberId == null) return transfers;
  const mine = (t: Transfer) => (t.fromMemberId === memberId || t.toMemberId === memberId ? 0 : 1);
  return [...transfers].sort((a, b) => mine(a) - mine(b));
}
