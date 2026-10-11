import type { TripEvent } from "../api/types";

export type MergeCandidate = { event: TripEvent; reason: string; score: number };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Bestätigte Ereignisse, in die ein Vorschlag passen könnte (Zusammenführen ergänzt nur leere Felder).
 * Stark: gleiche Buchungsreferenz. Mittel: gleicher Typ und Tag mit gleicher Flug-/Zugnummer. Schwach: gleicher Typ und Tag.
 */
export function mergeCandidates(proposal: TripEvent, all: TripEvent[]): MergeCandidate[] {
  const out: MergeCandidate[] = [];
  for (const e of all) {
    if (e.id === proposal.id || (e.status && e.status !== "confirmed")) continue;
    let score = 0;
    let reason = "";
    if (norm(e.bookingReference) && norm(e.bookingReference) === norm(proposal.bookingReference)) {
      score = 3;
      reason = "gleiche Buchungsreferenz";
    } else if (e.type === proposal.type && e.startDate && e.startDate === proposal.startDate) {
      const a = norm(String(e.details?.flightNumber ?? e.details?.trainNumber ?? ""));
      const b = norm(String(proposal.details?.flightNumber ?? proposal.details?.trainNumber ?? ""));
      if (a && a === b) {
        score = 2;
        reason = "gleiche Nummer am gleichen Tag";
      } else {
        score = 1;
        reason = "gleicher Typ am gleichen Tag";
      }
    }
    if (score > 0) out.push({ event: e, reason, score });
  }
  return out.sort((x, y) => y.score - x.score || x.event.id - y.event.id);
}

/** Vorschläge einer Reise: alles ausser bestätigt, «Zu prüfen» vor «Vorschlag». */
export function proposalsOf(events: TripEvent[]): TripEvent[] {
  const rank = (e: TripEvent) => (e.status === "needs_review" ? 0 : 1);
  return events.filter((e) => e.status === "proposed" || e.status === "needs_review").sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}

/** Sicherheit als Text («98 %») und Ton. */
export function confidenceLabel(c: number | null): { text: string; tone: "pos" | "warn" | "neutral" } {
  if (c == null) return { text: "unbekannt", tone: "neutral" };
  const pct = Math.round(c * 100);
  return { text: `${pct} %`, tone: c >= 0.9 ? "pos" : "warn" };
}
