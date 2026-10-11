/** Synthetische Testdokumente (erfundene Daten, keine echten Unterlagen). */
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import type { DocumentAnalyzer } from "../src/ingest/analyzer";
import { IngestAnalyzer, type IngestOptions } from "../src/ingest/pipeline";
import { LlmError, type LlmRequest, type LlmResponse, type StructuredLlm } from "../src/ingest/openai";
import type { Geocoder, GeocodeHit } from "../src/geo/geocode";
import { createBackground } from "../src/lib/background";
import { setup } from "./helpers";

/** PDF mit Textebene: je Seite eine Liste von Zeilen (nur Zeichen aus WinAnsi). */
export async function textPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const line of lines) {
      if (line) page.drawText(line, { x: 40, y, size: 10, font });
      y -= 16;
    }
  }
  return new Uint8Array(await doc.save());
}

/* ───────────── Fake-KI ───────────── */


export type FieldSpec = [key: string, value: string, opts?: { c?: number; page?: number | null; quote?: string | null; currency?: string }];

export const fld = ([key, value, o]: FieldSpec) => ({
  key,
  value,
  confidence: o?.c ?? 0.97,
  page: o?.page === undefined ? 1 : o.page,
  quote: o?.quote === undefined ? value : o.quote,
  currency: o?.currency ?? null,
});

export type EventSpec = {
  type: string;
  fields: FieldSpec[];
  confidence?: number;
  addressParts?: Record<string, string | null> | null;
  placeAddresses?: Array<{ field: string; address: string | null }>;
  passengers?: Array<{ name: string | null; page?: number | null; quote?: string | null; [k: string]: unknown }>;
};

export const eventObj = (e: EventSpec) => ({
  type: e.type,
  confidence: e.confidence ?? 0.97,
  fields: e.fields.map(fld),
  addressParts: e.addressParts
    ? { street: null, postalCode: null, city: null, region: null, country: null, ...e.addressParts }
    : null,
  placeAddresses: e.placeAddresses ?? [],
  passengers: (e.passengers ?? []).map((p) => ({ page: 1, quote: null, ...p })),
});

export const extractionJson = (events: EventSpec[], extra: { summary?: string; trip?: Record<string, string | null>; documentKind?: string } = {}) =>
  JSON.stringify({
    summary: extra.summary ?? "Testdokument",
    documentKind: extra.documentKind ?? null,
    trip: { title: null, destination: null, startDate: null, endDate: null, ...(extra.trip ?? {}) },
    events: events.map(eventObj),
  });

/** Fake-LLM: `handler` bekommt Anfrage und Nummer des Aufrufs; wirft er `LlmError`, wird das weitergereicht. */
export class FakeLlm implements StructuredLlm {
  calls: LlmRequest[] = [];
  constructor(
    public handler: (req: LlmRequest, n: number) => string | LlmResponse | Promise<string | LlmResponse>,
    private readonly usage = { inputTokens: 1200, outputTokens: 300, cachedTokens: 0 }
  ) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const r = await this.handler(req, this.calls.length);
    if (typeof r !== "string") return r;
    return { content: r, finishReason: "stop", usage: this.usage, model: req.model };
  }
}

/** Fake-Geokodierer: feste Treffer je Teilstring der Anfrage. */
export class FakeGeocoder implements Geocoder {
  readonly name = "fake";
  queries: string[] = [];
  constructor(private readonly table: Array<[needle: string, lat: number, lon: number]>) {}
  async geocode(query: string): Promise<GeocodeHit | null> {
    this.queries.push(query);
    const hit = this.table.find(([n]) => query.toLowerCase().includes(n.toLowerCase()));
    return hit ? { lat: hit[1], lon: hit[2], label: query, confidence: 0.9, provider: "fake" } : null;
  }
}

export const rateLimited = () => new LlmError("KI-Anfrage fehlgeschlagen (429): Rate limit", true, 429);

export type IngestEnv = Awaited<ReturnType<typeof ingestSetup>>;

export async function ingestSetup(
  o: {
    llm?: StructuredLlm | null;
    geocoder?: Geocoder | null;
    autoConfirmMin?: number;
    now?: string;
    review?: (tripId: number, count: number) => unknown;
    analyzer?: Partial<IngestOptions>;
  } = {}
) {
  const background = createBackground();
  const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-ingest-"));
  let analyzer!: IngestAnalyzer;
  const proxy: DocumentAnalyzer = {
    analyze: (id) => analyzer.analyze(id),
    ready: () => analyzer.ready(),
    adopt: (id, u, ov) => analyzer.adopt(id, u, ov),
  };
  const nowIso = o.now ?? "2026-10-10T08:00:00Z";
  const s = await setup({ now: nowIso, deps: { background, documentsDir, analyzer: proxy, geocoder: o.geocoder ?? null } });
  const reviews: Array<[number, number]> = [];
  analyzer = new IngestAnalyzer({
    db: s.db,
    documentsDir,
    llm: o.llm === undefined ? null : o.llm,
    geocoder: o.geocoder ?? null,
    notifier: { review: (t: number, c: number) => { reviews.push([t, c]); return o.review?.(t, c); } },
    now: () => new Date(nowIso),
    autoConfirmMin: o.autoConfirmMin,
    render: null,
    heic: null,
    ...(o.analyzer ?? {}),
  });
  const anna = await s.tokens.anna();

  const createTrip = async (body: Record<string, unknown> = {}) => {
    const r = await s.call("POST", "/v1/trips", {
      token: anna,
      json: { title: "Miami 2026", destination: "Miami", startDate: "2026-10-24", endDate: "2026-11-07", timezone: "Europe/Zurich", ...body },
    });
    const id = r.body.trip.id as number;
    for (const name of ["Berta Muster", "Carl Muster"]) {
      await s.call("POST", `/v1/trips/${id}/travelers`, { token: anna, json: { displayName: name } });
    }
    return id;
  };
  const upload = async (bytes: Uint8Array | Buffer, name: string, tripId: number | null, extra: Record<string, string> = {}) => {
    const f = new FormData();
    const type = name.endsWith(".ics") ? "text/calendar" : name.endsWith(".pkpass") ? "application/vnd.apple.pkpass" : name.endsWith(".png") ? "image/png" : "application/pdf";
    f.set("file", new File([bytes as BlobPart], name, { type }));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    const r = await s.call("POST", tripId == null ? "/v1/documents" : `/v1/trips/${tripId}/documents`, { token: anna, form: f });
    await background.idle();
    const doc = await s.call("GET", `/v1/documents/${r.body.document.id}`, { token: anna });
    return { res: r, document: doc.body.document as any };
  };
  const trip = async (id: number) => (await s.call("GET", `/v1/trips/${id}`, { token: anna })).body as { trip: any; travelers: any[]; events: any[] };
  return { ...s, anna, background, documentsDir, analyzer, reviews, createTrip, upload, trip, llm: o.llm };
}

/** BCBP-Zeichenkette (erfunden). */
export function makeBcbp(o: { name?: string; pnr?: string; from?: string; to?: string; carrier?: string; flight?: string; doy?: number; seat?: string } = {}): string {
  return (
    "M1" + (o.name ?? "MUSTER/BERTA MRS").padEnd(20) + "E" + (o.pnr ?? "ABC123").padEnd(7) + (o.from ?? "ZRH") + (o.to ?? "MIA") +
    (o.carrier ?? "LX").padEnd(3) + (o.flight ?? "0086").padEnd(5) + String(o.doy ?? 297).padStart(3, "0") + "Y" +
    (o.seat ?? "012A").padEnd(4) + "0001 " + "1" + "00"
  );
}

/** Erfundene Bordkarte: MUSTER/ANNA, ABC123, ZRH–MIA, LX 86, Tag 297 (24.10.2026), Sitz 12A. */
export const BCBP = "M1" + "MUSTER/ANNA MRS".padEnd(20) + "E" + "ABC123 " + "ZRH" + "MIA" + "LX " + "0086 " + "297" + "Y" + "012A" + "0001 " + "1" + "00";

/** Minimales ZIP (nur «stored», CRC nicht geprüft) für .pkpass-Tests. */
export function zipStored(files: Record<string, string>, opts: { deflate?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = Buffer.from(name);
    const plain = Buffer.from(content);
    const data = opts.deflate ? zlib.deflateRawSync(plain) : plain;
    const method = opts.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(plain.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(plain.length, 24);
    ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

