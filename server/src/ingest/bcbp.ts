/**
 * IATA-BCBP (Resolution 792, «Bar Coded Boarding Pass»): Parser für die Textfassung der Bordkarte, wie sie in
 * Wallet-Pässen (`barcode.message`) oder im Text von Check-in-Bestätigungen steht.
 *
 * Aufbau (1-basierte Positionen): 1 Formatcode «M», 2 Anzahl Abschnitte, 3–22 Name (20), 23 E-Ticket-Kennzeichen,
 * dann je Abschnitt 37 Zeichen: PNR (7), Von (3), Nach (3), Fluggesellschaft (3), Flugnummer (5),
 * Julianischer Tag (3), Klasse (1), Sitz (4), Check-in-Folgenummer (5), Status (1), Länge des variablen
 * Teils (2, hex). Danach folgt der variable Teil (so viele Zeichen, wie die Länge angibt).
 */
import { findAirport } from "../meta/airports";

export type BcbpLeg = {
  /** Name wie auf der Bordkarte («MUSTER/ANNA MRS»). */
  passengerName: string;
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  /** «LX 1952» */
  flightNumber: string;
  dayOfYear: number;
  cabin: string;
  /** «12A» (ohne führende Nullen); null = nicht zugewiesen (z. B. «INF»). */
  seat: string | null;
  sequence: string;
  raw: string;
};

const NAME_CHARS = /^[A-Z0-9 /\-'.]{20}$/;

/** Ein Abschnitt (37 Zeichen) ab `pos`; null, wenn das Muster nicht stimmt. */
function parseLeg(s: string, pos: number, name: string): { leg: BcbpLeg; next: number } | null {
  const seg = s.slice(pos, pos + 37);
  if (seg.length < 37) return null;
  const pnr = seg.slice(0, 7).trim();
  const from = seg.slice(7, 10);
  const to = seg.slice(10, 13);
  const carrier = seg.slice(13, 16).trim();
  const flight = seg.slice(16, 21).trim();
  const doy = seg.slice(21, 24);
  const cabin = seg.slice(24, 25).trim();
  const seat = seg.slice(25, 29).trim();
  const seq = seg.slice(29, 34).trim();
  const varLen = seg.slice(35, 37);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) return null;
  if (!/^\d{3}$/.test(doy)) return null;
  const day = Number(doy);
  if (day < 1 || day > 366) return null;
  if (!/^[0-9A-F]{2}$/.test(varLen)) return null;
  if (!/^[A-Z0-9]{2}$/.test(carrier) && !/^[A-Z0-9]{3}$/.test(carrier)) return null;
  if (!/^\d{1,4}[A-Z]?$/.test(flight)) return null;
  const num = String(Number(flight.replace(/[A-Z]$/, ""))) + (/[A-Z]$/.test(flight) ? flight.slice(-1) : "");
  const seatNorm = /^\d{1,3}[A-Z]$/.test(seat) ? `${Number(seat.slice(0, -1))}${seat.slice(-1)}` : /^[A-Z0-9]{1,4}$/.test(seat) && /\d/.test(seat) ? seat : null;
  return {
    leg: {
      passengerName: name,
      pnr,
      from,
      to,
      carrier,
      flightNumber: `${carrier} ${num}`,
      dayOfYear: day,
      cabin,
      seat: seatNorm,
      sequence: seq,
      raw: s.slice(Math.max(0, pos - 23), pos + 37),
    },
    next: pos + 37 + parseInt(varLen, 16),
  };
}

/** Eine BCBP-Zeichenkette ab Index 0 (beginnt mit «M»). */
export function parseBcbp(s: string): BcbpLeg[] {
  if (s.length < 60 || s[0] !== "M") return [];
  const legsN = Number(s[1]);
  if (!(legsN >= 1 && legsN <= 4)) return [];
  const name = s.slice(2, 22);
  if (!NAME_CHARS.test(name)) return [];
  const out: BcbpLeg[] = [];
  let pos = 23;
  for (let i = 0; i < legsN; i++) {
    const r = parseLeg(s, pos, name.trim());
    if (!r) break;
    out.push(r.leg);
    pos = r.next;
    if (pos >= s.length) break;
  }
  return out;
}

/**
 * Toleranter Weg für Text aus PDFs: Die Textextraktion fasst Leerzeichen-Folgen zusammen, die festen Feldbreiten
 * gehen verloren. Daher werden Leerzeichen entfernt und die Felder über ihre Form getrennt (PNR, Von, Nach,
 * Fluggesellschaft, Flugnummer, Tag, Klasse, Sitz). Nur mit bekannten Flughäfen gilt ein Treffer.
 */
const LOOSE = /^M([1-4])([A-Z/'.-]+?)E?([A-Z0-9]{6,7}?)([A-Z]{3})([A-Z]{3})([A-Z0-9]{2})(\d{1,4}[A-Z]?)(\d{3})([A-Z])(\d{1,3}[A-Z]|[A-Z0-9]{1,4})/;

export function parseBcbpLoose(s: string): BcbpLeg | null {
  const squashed = s.replace(/\s+/g, "");
  const m = LOOSE.exec(squashed);
  if (!m) return null;
  const [, , nameRaw, pnr, from, to, carrier, flightRaw, doyRaw, cabin, seatRaw] = m as unknown as string[];
  const day = Number(doyRaw);
  if (day < 1 || day > 366 || from === to) return null;
  if (!findAirport(from) || !findAirport(to)) return null;
  const flight = String(Number(flightRaw!.replace(/[A-Z]$/, ""))) + (/[A-Z]$/.test(flightRaw!) ? flightRaw!.slice(-1) : "");
  const seat = /^\d{1,3}[A-Z]$/.test(seatRaw!) ? `${Number(seatRaw!.slice(0, -1))}${seatRaw!.slice(-1)}` : null;
  return {
    passengerName: nameRaw!.replace(/([A-Z])(MRS|MR|MS|MISS|MSTR|CHD|INF)$/, "$1 $2"),
    pnr: pnr!,
    from: from!,
    to: to!,
    carrier: carrier!,
    flightNumber: `${carrier} ${flight}`,
    dayOfYear: day,
    cabin: cabin!,
    seat,
    sequence: "",
    raw: s.slice(0, 80),
  };
}

/**
 * Sucht BCBP-Zeichenketten in freiem Text (Zeilen, in denen ein Barcode als Klartext steht). Mehrere Treffer
 * desselben Abschnitts (gleiche Flugnummer, Datum, Passagier) werden zusammengefasst.
 */
export function findBcbpInText(text: string): BcbpLeg[] {
  const out: BcbpLeg[] = [];
  const seen = new Set<string>();
  const add = (leg: BcbpLeg) => {
    const key = `${leg.flightNumber}|${leg.dayOfYear}|${leg.from}${leg.to}|${leg.pnr}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(leg);
  };
  const re = /M[1-4][A-Z]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Zeilenumbrüche mitten im Barcode kommen vor.
    const chunk = text.slice(m.index, m.index + 200).replace(/[\r\n]+/g, "");
    const strict = parseBcbp(chunk);
    if (strict.length) {
      strict.forEach(add);
      continue;
    }
    const loose = parseBcbpLoose(chunk.slice(0, 120));
    if (loose) add(loose);
  }
  return out;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Julianischer Tag → Datum. Das Jahr fehlt im Barcode: Es wird das Jahr gewählt, das dem Referenzdatum
 * (Reisebeginn, Dokumentdatum oder «heute») am nächsten liegt.
 */
export function bcbpDate(dayOfYear: number, reference: string): string | null {
  const refMs = Date.parse(`${reference}T00:00:00Z`);
  if (Number.isNaN(refMs)) return null;
  const refYear = new Date(refMs).getUTCFullYear();
  let best: { date: string; diff: number } | null = null;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    if (dayOfYear === 366 && !isLeap(y)) continue;
    const ms = Date.UTC(y, 0, dayOfYear);
    const diff = Math.abs(ms - refMs);
    if (!best || diff < best.diff) best = { date: new Date(ms).toISOString().slice(0, 10), diff };
  }
  return best?.date ?? null;
}

/** Plausibilität: Flughäfen der Tabelle (unbekannte Codes sind kein Beweis gegen den Barcode). */
export function knownRoute(leg: BcbpLeg): boolean {
  return Boolean(findAirport(leg.from) && findAirport(leg.to));
}
