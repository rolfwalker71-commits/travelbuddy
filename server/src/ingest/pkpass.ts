/**
 * Apple-Wallet-Pass (`.pkpass`): ZIP mit `pass.json`. Liefert lesbaren Text (für die KI und die Anzeige) und
 * deterministische Kandidaten: BCBP-Barcode (Flug), sonst ein grobes Ereignis aus Pass-Art und Datum.
 */
import { readZipEntry } from "./zip";
import { parseBcbp } from "./bcbp";
import type { Candidate } from "./types";

type PassField = { key?: string; label?: string; value?: unknown; attributedValue?: unknown };
type PassStructure = Partial<Record<"headerFields" | "primaryFields" | "secondaryFields" | "auxiliaryFields" | "backFields", PassField[]>> & {
  transitType?: string;
};
type PassJson = {
  organizationName?: string;
  description?: string;
  logoText?: string;
  relevantDate?: string;
  barcode?: { message?: string; format?: string };
  barcodes?: Array<{ message?: string; format?: string }>;
  boardingPass?: PassStructure;
  eventTicket?: PassStructure;
  generic?: PassStructure;
  coupon?: PassStructure;
  storeCard?: PassStructure;
};

export type PkpassContent = {
  text: string;
  barcodes: string[];
  candidates: Candidate[];
  kind: "boardingPass" | "eventTicket" | "generic" | "coupon" | "storeCard" | "unknown";
  organization: string | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function parsePkpass(bytes: Uint8Array): PkpassContent | null {
  const raw = readZipEntry(bytes, "pass.json");
  if (!raw) return null;
  let pass: PassJson;
  try {
    pass = JSON.parse(Buffer.from(raw).toString("utf8").replace(/^﻿/, "")) as PassJson;
  } catch {
    return null;
  }
  const kind = (["boardingPass", "eventTicket", "generic", "coupon", "storeCard"] as const).find((k) => pass[k]) ?? "unknown";
  const struct: PassStructure = (kind !== "unknown" ? pass[kind] : undefined) ?? {};

  const lines: string[] = [];
  const add = (label: string, v: string) => v.trim() && lines.push(`${label}: ${v.trim()}`);
  add("Organisation", str(pass.organizationName));
  add("Beschreibung", str(pass.description));
  add("Titel", str(pass.logoText));
  add("Relevantes Datum", str(pass.relevantDate));
  add("Pass-Art", kind + (struct.transitType ? ` (${struct.transitType})` : ""));
  for (const group of ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields", "backFields"] as const) {
    for (const f of struct[group] ?? []) {
      const label = str(f.label) || str(f.key);
      const value = str(f.attributedValue) || str(f.value);
      if (value) lines.push(`${label}: ${value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    }
  }

  const barcodes = [pass.barcode?.message, ...(pass.barcodes ?? []).map((b) => b.message)].filter(
    (m): m is string => typeof m === "string" && m.length > 0
  );
  const uniq = [...new Set(barcodes)];
  for (const b of uniq) lines.push(`Barcode: ${b}`);

  const candidates: Candidate[] = [];
  const relevant = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(str(pass.relevantDate));

  for (const b of uniq) {
    for (const leg of parseBcbp(b)) {
      const fields: Candidate["fields"] = {
        flightNumber: leg.flightNumber,
        departureAirport: leg.from,
        arrivalAirport: leg.to,
        bookingReference: leg.pnr,
      };
      const c: Candidate = {
        origin: "pkpass",
        type: "Flug",
        fields,
        dayOfYear: leg.dayOfYear,
        passenger: { name: leg.passengerName, seat: leg.seat },
        quote: `BCBP ${leg.raw.trim().slice(0, 60)}`,
        page: 1,
        confidence: 0.99,
        authoritative: ["flightNumber", "departureAirport", "arrivalAirport", "bookingReference", "startDate"],
        weak: true,
      };
      if (relevant) {
        const d = new Date(`${relevant[1]}T00:00:00Z`);
        const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
        if (doy === leg.dayOfYear) fields.startDate = relevant[1]!;
      }
      candidates.push(c);
    }
  }

  // Ohne Flug-Barcode: grobes Ereignis aus der Pass-Art (nur Reise- und Veranstaltungspässe).
  if (candidates.length === 0 && relevant) {
    const title = str(pass.description) || str(pass.logoText) || str(pass.organizationName);
    const tt = struct.transitType ?? "";
    let type: string | null = null;
    const extra: Candidate["fields"] = {};
    if (kind === "eventTicket") type = "Veranstaltung";
    else if (kind === "boardingPass") {
      if (/Train|Rail/i.test(tt)) type = "Zugreisen";
      else if (/Bus/i.test(tt)) {
        type = "Transfer";
        extra.transferKind = "Bus";
      } else if (/Boat|Ferry/i.test(tt)) {
        type = "Transfer";
        extra.transferKind = "Faehre";
      } else if (/Air/i.test(tt)) type = "Flug";
    }
    if (type && title) {
      candidates.push({
        origin: "pkpass",
        type,
        fields: { title, startDate: relevant[1]!, ...(relevant[2] ? { startTime: relevant[2] } : {}), ...(pass.organizationName ? { provider: str(pass.organizationName) } : {}), ...extra },
        quote: `Pass: ${title}`.slice(0, 120),
        page: 1,
        confidence: 0.8,
        authoritative: ["startDate"],
        weak: true,
      });
    }
  }

  return { text: lines.join("\n"), barcodes: uniq, candidates, kind, organization: str(pass.organizationName) || null };
}
