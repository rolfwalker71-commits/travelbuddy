/**
 * Code verifiziert die KI: Barcode-, Kalender- und Pass-Kandidaten (deterministisch) werden mit der KI-Ausgabe
 * abgeglichen, Kennungen (Buchungscode, Flugnummer, IATA …) gegen den Dokumenttext geprüft. Bei Widerspruch
 * gewinnt Barcode bzw. Regel, das Feld erhält die Markierung `needsReview`.
 */
import type { Catalog } from "../catalog/catalog";
import { findAirport } from "../meta/airports";
import { bcbpDate } from "./bcbp";
import type { Candidate, FieldOrigin, Issue, PageText, ProposedEvent } from "./types";
import { compact, foldText, normFlightNumber } from "./values";

/* ───────────── Kennungen im Text (Regel-Kandidaten) ───────────── */

/** Häufige IATA-Airline-Codes: Flugnummer-Kandidaten im Fliesstext gelten nur mit bekanntem Präfix. */
const AIRLINES = new Set(
  ("LX OS EW LH BA AF KL IB VY UX TP SN AZ TK EK QR EY AA UA DL B6 WN AS AC LA QF SQ CX NH JL AI SK DY FR U2 W6 HV PC A3 LO OK " +
    "JU OU BT FI AY KM MS RJ SV WY GF KU ET KQ SA AT MH TG GA VN PR BR CI OZ KE MU CA CZ HU AM AV CM G3 JJ AR H2 EN X3 DE 4Y VX F9 NK " +
    "G4 SY HA WS XQ PS SU S7 FZ G9 TO VF BY LS MT OR EI WF DX XK ZB 5O 2L PU LG BE BJ VS UL PK BG WB RW HM ME LY RO TU AH TM EN WK " +
    "OA BW CU EW HG BF").split(/\s+/)
);

export function flightNumberCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{1,4})([A-Z])?\b/g)) {
    const code = m[1]!;
    if (!AIRLINES.has(code)) continue;
    const n = normFlightNumber(`${code}${m[2]}`);
    if (n) out.add(n);
  }
  return [...out];
}

const REF_RE =
  /(?:buchungs?(?:code|nummer|referenz|nr\.?)|booking\s*(?:reference|code|number|ref\.?|no\.?)|reservierungs?(?:nummer|code|nr\.?)|reservation\s*(?:number|code|no\.?)|confirmation\s*(?:number|code|no\.?)?|best(?:ä|ae)tigungs(?:nummer|code)|bestellnummer|PNR|referenz(?:nummer)?|reference(?:\s*number)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/gi;

export function referenceCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REF_RE)) {
    const v = m[1]!.toUpperCase();
    if (!/\d/.test(v) && !/^[A-Z]{6}$/.test(v)) continue;
    if (/^(NUMBER|REFERENZ|CODE|NUMMER|BOOKING|CONFIRMATION)$/.test(v)) continue;
    out.add(v);
  }
  return [...out];
}

/* ───────────── Ähnlichkeit ───────────── */

const STOP = new Set(["hotel", "resort", "the", "der", "die", "das", "und", "and", "spa", "inn", "von", "de", "la", "le", "del", "im"]);
export function nameTokens(s: string): string[] {
  return foldText(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const jacc = inter / (sa.size + sb.size - inter);
  const ca = ta.join("");
  const cb = tb.join("");
  const contain = ca.length >= 5 && cb.length >= 5 && (ca.includes(cb) || cb.includes(ca)) ? 0.8 : 0;
  return Math.max(jacc, contain);
}

/* ───────────── Abgleich mit Kandidaten ───────────── */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const get = (e: ProposedEvent, k: string): string | number | boolean | null | undefined => (k in e.common ? e.common[k] : e.details[k]);

function setField(
  e: ProposedEvent,
  cat: Catalog,
  key: string,
  value: string | number | boolean,
  origin: FieldOrigin
): void {
  if (cat.commonKeys.has(key)) e.common[key] = value as string | number;
  else e.details[key] = value;
  e.meta[key] = origin;
}

const eq = (a: unknown, b: unknown) => compact(String(a)) === compact(String(b));

export function applyCandidate(e: ProposedEvent, c: Candidate, cat: Catalog, referenceDate: string): void {
  const fields: Candidate["fields"] = { ...c.fields };
  if (fields.startDate === undefined && c.dayOfYear != null) {
    const d = bcbpDate(c.dayOfYear, e.common.startDate ? String(e.common.startDate) : referenceDate);
    if (d) fields.startDate = d;
  }
  for (const [key, value] of Object.entries(fields)) {
    const cur = get(e, key);
    const verified = c.origin === "bcbp" || (c.origin === "pkpass" && c.confidence >= 0.99);
    const origin: FieldOrigin = { source: "document", confidence: c.confidence, page: c.page, quote: c.quote, ...(verified ? { verified: true } : {}) };
    if (cur == null || cur === "") {
      setField(e, cat, key, value, origin);
    } else if (!eq(cur, value)) {
      if (c.authoritative.includes(key)) {
        e.issues.push({
          field: key,
          code: c.origin === "bcbp" ? "barcode_conflict" : "source_conflict",
          message:
            `${key}: KI-Wert «${String(cur).slice(0, 40)}» widerspricht ` +
            `${c.origin === "bcbp" ? "dem Barcode" : c.origin === "ics" ? "dem Kalendereintrag" : "dem Pass"} «${String(value).slice(0, 40)}»; übernommen wurde der verlässlichere Wert`,
          needsReview: true,
        });
        setField(e, cat, key, value, { ...origin, needsReview: true });
      }
    } else if ((e.meta[key]?.confidence ?? 0) < c.confidence) {
      e.meta[key] = { ...(e.meta[key] ?? origin), confidence: c.confidence, source: "document" };
    }
  }
  if (c.passenger?.name) {
    const known = e.passengers.find((p) => p.name && compact(p.name) === compact(c.passenger!.name));
    if (known) {
      if (c.passenger.seat && !known.values.seat) known.values.seat = c.passenger.seat;
    } else {
      e.passengers.push({
        name: c.passenger.name,
        values: c.passenger.seat ? { seat: c.passenger.seat } : {},
        page: c.page,
        quote: c.quote,
      });
    }
  }
  if (!e.origins.includes(c.origin)) e.origins.push(c.origin);
  e.confidence = Math.max(e.confidence, Math.min(1, c.confidence));
}

function candidateScore(e: ProposedEvent, c: Candidate, referenceDate: string): number {
  const date = (x: ProposedEvent) => (typeof x.common.startDate === "string" ? x.common.startDate : null);
  if (c.origin === "bcbp" || (c.origin === "pkpass" && c.fields.flightNumber)) {
    if (e.type !== "Flug") return 0;
    const cdate = c.fields.startDate ?? (c.dayOfYear != null ? bcbpDate(c.dayOfYear, date(e) ?? referenceDate) : null);
    const fn = get(e, "flightNumber");
    const dep = get(e, "departureAirport");
    const arr = get(e, "arrivalAirport");
    let s = 0;
    if (fn && c.fields.flightNumber && eq(fn, c.fields.flightNumber)) s += 10;
    if (dep && arr && c.fields.departureAirport && c.fields.arrivalAirport && eq(dep, c.fields.departureAirport) && eq(arr, c.fields.arrivalAirport)) s += 6;
    const ref = get(e, "bookingReference");
    if (ref && c.fields.bookingReference && eq(ref, c.fields.bookingReference)) s += 2;
    if (s > 0 && cdate && date(e) === cdate) s += 3;
    return s;
  }
  // ICS / Pass ohne Barcode: gleiches Datum und ähnlicher Titel oder gleiche Zeit.
  const cd = c.fields.startDate ? String(c.fields.startDate) : null;
  if (!cd || date(e) !== cd) return 0;
  let s = 1;
  const title = str(e.common.title);
  const ctitle = c.fields.title ? String(c.fields.title) : null;
  if (title && ctitle) s += nameSimilarity(title, ctitle) * 5;
  if (c.fields.startTime && e.common.startTime === c.fields.startTime) s += 2;
  return s;
}

/**
 * Führt Kandidaten mit KI-Ereignissen zusammen. Ein Kandidat ohne Entsprechung wird zu einem eigenen Ereignis
 * (mit `weak`: nie automatisch bestätigt).
 */
export function reconcileCandidates(
  events: ProposedEvent[],
  candidates: Candidate[],
  opts: { catalog: Catalog; referenceDate: string }
): ProposedEvent[] {
  const out = [...events];
  const used = new Set<number>();
  for (const c of candidates) {
    let bestIdx = -1;
    let best = 0;
    out.forEach((e, i) => {
      // Ein Ereignis nimmt je Barcode höchstens einen Kandidaten desselben Passagiers auf.
      const s = candidateScore(e, c, opts.referenceDate);
      const needed = c.origin === "bcbp" || c.fields.flightNumber ? 6 : 1.5;
      if (s >= needed && s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0 && !(c.origin === "ics" && used.has(bestIdx))) {
      applyCandidate(out[bestIdx]!, c, opts.catalog, opts.referenceDate);
      used.add(bestIdx);
      continue;
    }
    const cat = opts.catalog;
    const type = cat.resolveTypeId(c.type) ?? "Ausflug";
    const e: ProposedEvent = {
      type,
      common: {},
      details: {},
      meta: {},
      passengers: [],
      addressParts: null,
      placeAddresses: {},
      confidence: c.confidence,
      issues: [],
      origins: [c.origin],
      status: "proposed",
    };
    // Typ-fremde Schlüssel (z. B. transferKind bei einem Zug) filtert der Katalog später; hier nur Typ-Felder.
    const resolved = cat.type(type)!;
    const filtered: Candidate = {
      ...c,
      fields: Object.fromEntries(Object.entries(c.fields).filter(([k]) => cat.commonKeys.has(k) || resolved.fields.has(k))),
    };
    applyCandidate(e, filtered, cat, opts.referenceDate);
    if (c.weak) e.issues.push({ code: "candidate_only", message: "Nur aus Barcode/Pass erkannt; Zeiten und Details fehlen", needsReview: false });
    out.push(e);
    used.add(out.length - 1);
  }
  return out;
}

/* ───────────── Gegenprüfung gegen den Text ───────────── */

/** Zitate müssen im Dokument stehen: gefundene Seite korrigiert die Angabe, nicht auffindbare Zitate entfallen. */
function verifyQuotes(e: ProposedEvent, pages: PageText[]): void {
  const norm = (t: string) => foldText(t).replace(/[^a-z0-9]+/g, " ").trim();
  const hay = pages.map((p) => ({ page: p.page, text: ` ${norm(p.text)} `, tight: norm(p.text).replace(/ /g, "") }));
  const all = hay.map((h) => h.text).join(" ");
  for (const [k, m] of Object.entries(e.meta)) {
    if (!m.quote || m.verified || m.source !== "document") continue;
    const q = norm(m.quote);
    if (q.length < 3) continue;
    const hit = hay.find((h) => h.text.includes(q) || h.tight.includes(q.replace(/ /g, "")));
    if (hit) {
      if (m.page !== hit.page) e.meta[k] = { ...m, page: hit.page };
      continue;
    }
    const tokens = q.split(" ").filter((t) => t.length > 1);
    const found = tokens.filter((t) => all.includes(` ${t} `)).length;
    if (tokens.length && found / tokens.length >= 0.7) continue;
    e.meta[k] = { ...m, quote: null };
  }
}

const IDENT_KEYS = ["bookingReference", "flightNumber", "trainNumber", "confirmationNumber", "policyNumber", "authorizationNumber", "voucher"];

function markField(e: ProposedEvent, key: string, issue: Issue): void {
  e.issues.push(issue);
  const m = e.meta[key];
  if (m) e.meta[key] = { ...m, needsReview: true, confidence: Math.min(m.confidence, 0.6) };
}

export function crossCheckText(events: ProposedEvent[], pages: PageText[]): void {
  if (!pages.length) return;
  const text = pages.map((p) => p.text).join("\n");
  const ctext = compact(text);
  if (ctext.length < 40) return;
  const folded = foldText(text);
  const tokens = new Set([...text.matchAll(/\b[A-Z]{3}\b/g)].map((m) => m[0]));
  const refs = referenceCandidates(text);
  const flights = flightNumberCandidates(text);

  for (const e of events) {
    verifyQuotes(e, pages);
    // Kennungen: müssen im Dokument vorkommen (Leerzeichen/Bindestriche egal).
    for (const k of IDENT_KEYS) {
      const v = get(e, k);
      if (typeof v !== "string" || e.meta[k]?.verified) continue;
      const c = compact(v);
      if (c.length < 4 || ctext.includes(c)) continue;
      const label = k === "bookingReference" ? "Buchungsreferenz" : k === "flightNumber" ? "Flugnummer" : k;
      const pool = k === "bookingReference" ? refs : k === "flightNumber" ? flights : [];
      // Regel gewinnt, wenn sie eindeutig ist (genau ein Treffer im Dokument).
      if (pool.length === 1 && !e.origins.some((o) => o !== "llm")) {
        const fixed = pool[0]!;
        if (k in e.common) e.common[k] = fixed;
        else e.details[k] = fixed;
        e.meta[k] = { source: "document", confidence: 0.7, page: e.meta[k]?.page ?? null, quote: e.meta[k]?.quote ?? null, needsReview: true };
        e.issues.push({
          field: k, code: "rule_override",
          message: `${label}: KI-Wert «${v}» steht nicht im Dokument; Treffer «${fixed}» aus dem Text übernommen`, needsReview: true,
        });
      } else {
        markField(e, k, {
          field: k, code: "value_not_in_document",
          message: `${label} «${v}» ist im Dokumenttext nicht zu finden`, needsReview: true,
        });
      }
    }
    // Flughäfen: bekannter Code, im Text als Code oder Stadtname vorhanden.
    for (const k of ["departureAirport", "arrivalAirport"]) {
      const v = e.details[k];
      if (typeof v !== "string" || e.meta[k]?.verified) continue;
      const ap = findAirport(v);
      if (!ap) {
        markField(e, k, { field: k, code: "unknown_airport", message: `Flughafen «${v}» ist nicht in der Flughafentabelle`, needsReview: true });
        continue;
      }
      const cityFolded = foldText(ap.city);
      if (!tokens.has(v) && !(cityFolded.length >= 3 && folded.includes(cityFolded)) && !folded.includes(foldText(ap.name).split(" ")[0] ?? "\u0000")) {
        markField(e, k, { field: k, code: "value_not_in_document", message: `Flughafen «${v}» ist im Dokumenttext nicht zu finden`, needsReview: true });
      }
    }
    // Ticketnummern der Passagiere
    for (const p of e.passengers) {
      const t = p.values.ticketNumber;
      if (t && compact(t).length >= 8 && !ctext.includes(compact(t))) {
        e.issues.push({ field: "passengers", code: "value_not_in_document", message: `Ticketnummer «${t}» ist im Dokumenttext nicht zu finden`, needsReview: true });
      }
    }
  }
}
