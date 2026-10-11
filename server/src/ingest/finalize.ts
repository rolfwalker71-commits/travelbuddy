/**
 * Letzte Prüfungen eines Vorschlags: Titel, Datumsfolge, Flugzeiten über Zeitzonen, Reisezeitraum (± Toleranz),
 * und der Status: `confirmed` nur bei hoher Sicherheit und bestandenen Prüfungen, sonst `proposed`/`needs_review`.
 */
import type { Catalog } from "../catalog/catalog";
import { addDays, diffDays, displayDate } from "../lib/dates";
import { zonedToUtcMs } from "../lib/tz";
import { findAirport } from "../meta/airports";
import type { ProposedEvent } from "./types";

export type FinalizeCtx = {
  catalog: Catalog;
  trip: { startDate: string | null; endDate: string | null } | null;
  toleranceDays: number;
  autoConfirmMin: number;
};

/** Typen, deren Daten (Gültigkeit, Frist) legitim ausserhalb des Reisezeitraums liegen. */
const RANGE_EXEMPT = new Set(["Versicherung", "Visum", "Aufgabe"]);

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function synthTitle(e: ProposedEvent, cat: Catalog): string {
  const d = e.details;
  const c = e.common;
  const label = cat.type(e.type)?.label ?? e.type;
  switch (e.type) {
    case "Flug": {
      const dep = s(d.departureAirport);
      const arr = s(d.arrivalAirport);
      const route = dep || arr ? `${dep ?? "?"} – ${arr ?? "?"}` : null;
      return ["Flug", s(d.flightNumber), route].filter(Boolean).join(" ");
    }
    case "Zugreisen": {
      const o = s(d.originPlace);
      const t = s(d.destinationPlace);
      return o && t ? `Zug ${o} – ${t}` : ["Zug", s(d.trainNumber)].filter(Boolean).join(" ");
    }
    case "Hotel":
    case "Unterkunft":
      return s(c.provider) ?? s(c.location) ?? label;
    case "Mietauto":
      return ["Mietwagen", s(c.provider), s(d.pickupPlace)].filter(Boolean).join(" ");
    case "Kreuzfahrt":
      return s(c.location) ?? s(d.routeName) ?? ["Kreuzfahrt", s(d.ship)].filter(Boolean).join(" ");
    case "Transfer": {
      const o = s(d.originPlace);
      const t = s(d.destinationPlace);
      return o && t ? `Transfer ${o} – ${t}` : "Transfer";
    }
    default:
      return [label, s(c.provider) ?? s(c.location)].filter(Boolean).join(" ");
  }
}

const addIssue = (e: ProposedEvent, field: string | undefined, code: string, message: string, needsReview = true) =>
  e.issues.push({ ...(field ? { field } : {}), code, message, needsReview });

/** Hinweise, die dieser Schritt selbst erzeugt (bei erneutem Aufruf, z. B. nach «Reise übernehmen», zuerst entfernt). */
const OWN_CODES = new Set(["end_before_start", "implausible_duration", "arrival_next_day", "no_date", "outside_trip"]);

export function finalizeEvent(e: ProposedEvent, ctx: FinalizeCtx): void {
  const cat = ctx.catalog;
  e.issues = e.issues.filter((i) => !OWN_CODES.has(i.code));

  if (!s(e.common.title)) {
    e.common.title = synthTitle(e, cat).slice(0, 200) || (cat.type(e.type)?.label ?? e.type);
    e.meta.title = { source: "derived", confidence: 0.6, page: null, quote: null };
  }

  const start = s(e.common.startDate);
  let end = s(e.common.endDate);
  if (start && end && end < start) {
    addIssue(e, "endDate", "end_before_start", `Ende (${displayDate(end)}) liegt vor dem Beginn (${displayDate(start)}); Enddatum nicht übernommen`);
    delete e.common.endDate;
    delete e.meta.endDate;
    end = null;
  }

  // Flug: Abflug und Ankunft in Ortszeit der Flughäfen; «+1» aus den Zeiten ableiten, Unmögliches melden.
  if (e.type === "Flug" && start) {
    const dep = findAirport(s(e.details.departureAirport));
    const arr = findAirport(s(e.details.arrivalAirport));
    const depTz = s(e.common.startTz) ?? dep?.tz ?? null;
    const arrTz = s(e.common.endTz) ?? arr?.tz ?? null;
    const t0 = s(e.common.startTime);
    const t1 = s(e.common.endTime);
    if (t0 && t1 && depTz && arrTz) {
      const depMs = zonedToUtcMs(start, t0, depTz);
      const arrOn = (date: string) => zonedToUtcMs(date, t1, arrTz);
      const H = 3_600_000;
      const ok = (ms: number) => ms > depMs && ms - depMs <= 26 * H;
      const given = end ?? start;
      if (ok(arrOn(given))) {
        if (!end) {
          e.common.endDate = given;
          e.meta.endDate = { source: "derived", confidence: 0.8, page: null, quote: "Ankunftsdatum aus Ortszeiten berechnet" };
        }
      } else {
        const fixed = [1, 2].map((n) => addDays(given, n)).find((d) => ok(arrOn(d)));
        if (fixed) {
          e.common.endDate = fixed;
          e.meta.endDate = { source: "derived", confidence: 0.75, page: null, quote: "Ankunft am Folgetag (+1) aus den Ortszeiten abgeleitet", needsReview: true };
          addIssue(e, "endDate", "arrival_next_day", `Ankunft am ${displayDate(fixed)} aus den Zeitzonen abgeleitet (+${diffDays(start, fixed)})`);
        } else {
          addIssue(e, "endTime", "implausible_duration", "Abflug- und Ankunftszeit ergeben keine plausible Flugdauer (Zeitzonen prüfen)");
        }
      }
    }
  } else if (e.type !== "Flug" && start && !e.common.endDate && s(e.common.startTime) && s(e.common.endTime)) {
    if (s(e.common.endTime)! < s(e.common.startTime)!) {
      addIssue(e, "endTime", "end_before_start", "Ende liegt vor dem Beginn (Datum des Endes fehlt?)");
    }
  }

  if (!start && e.type !== "Aufgabe") {
    addIssue(e, "startDate", "no_date", "Datum fehlt");
  }

  // Reisezeitraum
  const t = ctx.trip;
  if (t && start && !RANGE_EXEMPT.has(e.type) && (t.startDate || t.endDate)) {
    const tol = ctx.toleranceDays;
    const lo = t.startDate ? addDays(t.startDate, -tol) : null;
    const hi = t.endDate ? addDays(t.endDate, tol) : null;
    if ((lo && start < lo) || (hi && start > hi)) {
      addIssue(e, "startDate", "outside_trip", `Datum ${displayDate(start)} liegt ausserhalb des Reisezeitraums (± ${tol} Tage)`);
    }
  }

  const fieldFlag = Object.values(e.meta).some((m) => m.needsReview);
  const blocking = e.issues.some((i) => i.needsReview) || fieldFlag;
  const candidateOnly = !e.origins.includes("llm");
  if (blocking) e.status = "needs_review";
  // Nur aus Barcode/Kalender/Pass (ohne KI-Auswertung) wird nie automatisch bestätigt.
  else if (e.confidence >= ctx.autoConfirmMin && !candidateOnly) e.status = "confirmed";
  else e.status = "proposed";
}

export function finalizeAll(events: ProposedEvent[], ctx: FinalizeCtx): void {
  for (const e of events) finalizeEvent(e, ctx);
}
