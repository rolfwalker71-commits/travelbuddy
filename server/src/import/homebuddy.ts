/**
 * Einmaliger, wiederholbarer Import aus einer HomeBuddy-SQLite (nur lesend) in die TravelBuddy-Datenbank.
 *
 * Ablauf: Quelle lesen und Dokumente vorbereiten (asynchron, ohne zu schreiben) → eine Transaktion mit allen
 * Zeilen und der Abnahme → bei Abweichung oder Trockenlauf Rollback → erst nach dem Festschreiben Dateien
 * (Dokumente, Bilder) schreiben. Siehe `docs/api/import.md` für die Abbildungsregeln.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { getCatalog } from "../catalog/catalog";
import { appTimeZone } from "../lib/dates";
import { findAirport } from "../meta/airports";
import { writeDocumentFile } from "../ingest/store";
import { mediaFilePath, saveMedia, type MediaKind } from "../media/store";
import { newShareToken } from "../ledgers/service";
import { runChecks } from "./checks";
import { normalizeDetails, type DetailsContext, type DetailsReport } from "./details";
import { prepareDocuments, type DocumentPlan, type PreparedDoc } from "./documents";
import { newReport, renderReportText, type ImportReport } from "./report";
import { openSource, type Row, type SourceData } from "./source";
import { CONFIDENCE, deriveZones, flightAirports, type ZoneValue } from "./zones";

export const SOURCE_NAME = "homebuddy";

export type ImportTarget = { db: Db; documentsDir: string; mediaDir: string };

export type ImportOptions = {
  /** Pfad der HomeBuddy-SQLite (Schnappschuss). */
  sourceFile: string;
  /** Ordner mit `manifest.json` und `paperless-<id>.<ext>`; `null` = keine Dokumente übernehmen. */
  documentsFolder?: string | null;
  /** Weitere Reisedokumente ohne Ereignis-Verknüpfung als unzugeordnete Dokumente übernehmen. */
  includeUnlinkedTravelDocs?: boolean;
  dryRun?: boolean;
  /** HomeBuddy-Medienordner (`<kind>/<datei>`); Standard: nicht übernehmen, wenn nicht angegeben. */
  mediaSourceFolder?: string | null;
  /** `summary.json` mit erwarteten Zählungen und Salden; `null` = nur gegen die Quellzeilen prüfen. */
  summaryFile?: string | null;
  /** Zone neuer Reisen (Standard: `TRAVELBUDDY_TZ`, sonst Europe/Zurich). */
  defaultTimeZone?: string;
  now?: () => Date;
};

class Rollback extends Error {
  constructor() {
    super("rollback");
  }
}

const nowIso = () => new Date().toISOString();
const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase() && (a ?? "").trim() !== "";

export function validDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

export function validTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const coord = (v: unknown, max: number): number | null => {
  const n = num(v);
  return n != null && Math.abs(n) <= max ? n : null;
};
const parseObj = (raw: unknown): Record<string, any> => {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const intOf = (v: unknown, what: string): number => {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  throw new Error(`Ungültiger Betrag in ${what}`);
};

/* ───────────── Zuordnung Quelle → Ziel ───────────── */

class IdMap {
  private m = new Map<string, { targetTable: string; targetId: number }>();
  constructor(
    private db: Db,
    private ts: () => string
  ) {
    for (const r of db
      .prepare("SELECT source_table, source_id, target_table, target_id FROM import_map WHERE source = ?")
      .all(SOURCE_NAME) as Array<{ source_table: string; source_id: number; target_table: string; target_id: number }>) {
      this.m.set(`${r.source_table}:${r.source_id}`, { targetTable: r.target_table, targetId: r.target_id });
    }
  }
  /** Ziel-ID, wenn zugeordnet und die Zielzeile noch existiert. */
  get(sourceTable: string, sourceId: number | null | undefined): number | undefined {
    if (sourceId == null) return undefined;
    const hit = this.m.get(`${sourceTable}:${sourceId}`);
    if (!hit) return undefined;
    return exists(this.db, hit.targetTable, hit.targetId) ? hit.targetId : undefined;
  }
  set(sourceTable: string, sourceId: number, targetTable: string, targetId: number) {
    this.m.set(`${sourceTable}:${sourceId}`, { targetTable, targetId });
    this.db
      .prepare(
        `INSERT INTO import_map (source, source_table, source_id, target_table, target_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, source_table, source_id) DO UPDATE SET
           target_table = excluded.target_table, target_id = excluded.target_id, updated_at = excluded.updated_at`
      )
      .run(SOURCE_NAME, sourceTable, sourceId, targetTable, targetId, this.ts());
  }
}

const TABLE_RE = /^[a-z_]+$/;
function exists(db: Db, table: string, id: number): boolean {
  if (!TABLE_RE.test(table)) throw new Error("Ungültiger Tabellenname");
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
}

/** Fügt eine Zeile ein; die bevorzugte ID (aus der Quelle) wird verwendet, wenn sie im Ziel frei ist. */
function insertRow(db: Db, table: string, row: Record<string, unknown>, preferredId?: number | null): number {
  if (!TABLE_RE.test(table)) throw new Error("Ungültiger Tabellenname");
  const useId = preferredId != null && Number.isSafeInteger(preferredId) && preferredId > 0 && !exists(db, table, preferredId);
  const cols: Record<string, unknown> = useId ? { id: preferredId, ...row } : row;
  const names = Object.keys(cols);
  const res = db
    .prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...names.map((n) => cols[n] ?? null));
  return useId ? (preferredId as number) : Number(res.lastInsertRowid);
}

function updateRow(db: Db, table: string, id: number, row: Record<string, unknown>) {
  if (!TABLE_RE.test(table)) throw new Error("Ungültiger Tabellenname");
  const names = Object.keys(row);
  db.prepare(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`).run(...names.map((n) => row[n] ?? null), id);
}

/* ───────────── Ereignisse: Spalten und Sperren ───────────── */

/** API-Feldname (für `fields_meta`) → Spalte. */
const EVENT_FIELD_COLUMNS: Record<string, string> = {
  type: "event_type", title: "title", startDate: "start_date", endDate: "end_date", startTime: "start_time",
  endTime: "end_time", startTz: "start_tz", endTz: "end_tz", location: "location", address: "address",
  provider: "provider", bookingReference: "booking_reference", website: "website", phone: "phone", lat: "lat",
  lon: "lon", notes: "notes",
};

type Meta = Record<string, { source: string; confidence?: number; quote?: string; locked?: boolean; [k: string]: unknown }>;

function zoneMeta(z: ZoneValue) {
  return { source: "derived", confidence: CONFIDENCE[z.how], quote: z.quote };
}

/* ───────────── Haupt-Einstieg ───────────── */

export type ImportOutcome = { report: ImportReport; reportText: string };

export async function importHomeBuddy(target: ImportTarget, opts: ImportOptions): Promise<ImportOutcome> {
  const clock = opts.now ?? (() => new Date());
  const { db } = target;
  const report = newReport(path.basename(opts.sourceFile), opts.dryRun ? "dry-run" : "import", clock());
  const src = openSource(opts.sourceFile);
  try {
    const plan = await prepareDocuments(src, opts.documentsFolder ?? null, { includeUnlinked: Boolean(opts.includeUnlinkedTravelDocs) });
    report.warnings.push(...plan.warnings);

    const run = new Run(db, src.data, plan, opts, report, clock);
    try {
      db.transaction(() => {
        run.execute();
        runChecks(db, run.checkInput(), report, opts.summaryFile ?? null);
        report.status = report.checks.some((c) => !c.ok && !c.skipped) ? "mismatch" : "ok";
        if (opts.dryRun || report.status !== "ok") throw new Rollback();
      })();
      report.committed = true;
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    if (report.committed) {
      // Dateien erst nach dem Festschreiben: ein Abbruch hinterlässt keine verwaisten Dateien.
      for (const d of plan.docs) {
        if (run.usedDocumentHashes.has(d.sha256)) writeDocumentFile(target.documentsDir, d.sha256, d.ext, d.bytes);
      }
    }
    importMedia(target, src.data, opts, report, !report.committed);
    return { report, reportText: renderReportText(report) };
  } finally {
    src.close();
  }
}

/* ───────────── Medien (nach dem Festschreiben) ───────────── */

function importMedia(target: ImportTarget, data: SourceData, opts: ImportOptions, report: ImportReport, dryRun: boolean) {
  const m = report.media;
  m.tableInSource = data.hasMediaTable;
  if (!data.hasMediaTable) return;
  const ts = () => nowIso();
  const map = new IdMap(target.db, ts);
  const kinds: Record<string, [MediaKind, string]> = {
    trip_cover: ["trip_cover", "trips"],
    event_image: ["event_image", "trip_events"],
  };
  for (const row of data.media) {
    if (!row.file_name) continue;
    m.inSource += 1;
    const k = kinds[String(row.kind)];
    if (!k) {
      m.skippedKinds += 1;
      continue;
    }
    const owner = map.get(k[1], Number(row.owner_id));
    const folder = opts.mediaSourceFolder;
    const file = folder ? mediaFilePath(folder, k[0], String(row.file_name)) : null;
    if ((!dryRun && owner == null) || !file || !fs.existsSync(file)) {
      m.missingFiles += 1;
      continue;
    }
    if (dryRun || owner == null) {
      m.copied += 1;
      continue;
    }
    try {
      saveMedia(target.db, target.mediaDir, {
        kind: k[0],
        ownerId: owner,
        bytes: new Uint8Array(fs.readFileSync(file)),
        source: "imported",
        prompt: typeof row.prompt === "string" ? row.prompt : null,
      });
      m.copied += 1;
    } catch {
      m.missingFiles += 1;
    }
  }
  if (m.inSource > 0 && m.copied < m.inSource) {
    report.warnings.push(
      `Medien: ${m.inSource - m.copied} von ${m.inSource} Bildern nicht übernommen (Datei fehlt oder Art wird nicht übernommen).`
    );
  }
}

/* ───────────── Der Lauf (innerhalb der Transaktion) ───────────── */

type Person = { traveler: Row | null; member: Row | null };

export type CheckInput = {
  data: SourceData;
  map: IdMap;
  /** Quell-Kasse → Ziel-Kasse. */
  ledgerTargets: Map<number, number>;
  /** Quell-Mitglied → Ziel-Teilnehmer. */
  memberTargets: Map<number, number>;
  /** Anzahl Personen laut Zusammenführung. */
  personCount: number;
  documentsAvailable: boolean;
  plan: DocumentPlan;
  cashbookPayers: Map<number, number>;
};

class Run {
  /** SHA-256 der Dokumente, die der Lauf in die Datenbank geschrieben oder verknüpft hat (Dateien folgen nach dem Commit). */
  readonly usedDocumentHashes = new Set<string>();
  private map: IdMap;
  private catalog = getCatalog();
  private ts: () => string;
  private tripTz: string;
  private details: DetailsReport;
  private ledgerTargets = new Map<number, number>();
  private memberTargets = new Map<number, number>();
  private travelerTargets = new Map<number, number>();
  private couples = new Map<number, number>();
  private events = new Map<number, number>();
  private docTargets = new Map<number, number>(); // HomeBuddy-Dokument-ID → Ziel-ID
  private cashbookPayers = new Map<number, number>();
  private persons = 0;
  private firstExpenseOfEvent = new Map<number, number>();

  constructor(
    private db: Db,
    private data: SourceData,
    private plan: DocumentPlan,
    private opts: ImportOptions,
    private report: ImportReport,
    clock: () => Date
  ) {
    this.ts = () => clock().toISOString();
    this.details = report.details;
    this.map = new IdMap(db, this.ts);
    this.tripTz = opts.defaultTimeZone ?? appTimeZone();
  }

  checkInput(): CheckInput {
    return {
      data: this.data,
      map: this.map,
      ledgerTargets: this.ledgerTargets,
      memberTargets: this.memberTargets,
      personCount: this.persons,
      documentsAvailable: this.plan.folder,
      plan: this.plan,
      cashbookPayers: this.cashbookPayers,
    };
  }

  execute() {
    const r = this.report;
    r.counts.users.source = this.data.users.length;
    r.counts.trips.source = this.data.trips.length;
    r.counts.events.source = this.data.trip_events.length;
    r.counts.ledgers.source = this.data.ledgers.length;
    r.counts.couples.source = this.data.ledger_couples.length;
    r.counts.expenses.source = this.data.expenses.length;
    r.counts.settlements.source = this.data.settlements.length;
    r.counts.comments.source = this.data.trip_event_comments.length;
    r.counts.eventDocumentLinks.source = this.data.trip_event_documents.length;
    r.counts.documents.source = this.plan.docs.length + this.plan.missing.length;
    r.documents.linkedInSource = this.plan.linkedInSource;
    r.documents.folder = this.plan.folder;
    r.documents.missingFiles = this.plan.missing.length;
    r.documents.hashMismatches = this.plan.hashMismatches;

    const userMap = this.importUsers();
    this.importTripsAndLedgers(userMap);
    this.importDocuments();
    this.importMoney();
    this.importComments(userMap);
    this.linkDocuments();
    this.backfillEventExpenses();
  }

  /* ─ Benutzer ─ */
  private importUsers(): Map<number, number> {
    const out = new Map<number, number>();
    const c = this.report.counts.users;
    for (const u of this.data.users) {
      const username = str(u.username);
      if (!username) continue;
      const mapped =
        this.map.get("users", u.id) ??
        (this.db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username) as { id: number } | undefined)?.id;
      if (mapped != null) {
        out.set(u.id, mapped);
        this.map.set("users", u.id, "users", mapped);
        this.report.users.skippedExisting += 1;
        continue;
      }
      const id = insertRow(
        this.db,
        "users",
        {
          username,
          display_name: str(u.display_name) ?? username,
          email: str(u.email),
          password_hash: String(u.password_hash ?? ""),
          is_admin: u.is_admin ? 1 : 0,
          active: u.active === 0 ? 0 : 1,
          created_at: str(u.created_at) ?? this.ts(),
        },
        u.id
      );
      out.set(u.id, id);
      this.map.set("users", u.id, "users", id);
      c.created += 1;
    }
    const active = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(is_admin), 0) AS a FROM users WHERE active = 1").get() as {
      n: number;
      a: number;
    };
    this.report.users.activeUsers = active.n;
    this.report.users.activeAdmins = active.a;
    return out;
  }

  /* ─ Reisen, Teilnehmer, Ereignisse, Reisekassen ─ */
  private importTripsAndLedgers(userMap: Map<number, number>) {
    const d = this.data;
    const tripIds = new Set(d.trips.map((t) => t.id));
    const ledgersByTrip = new Map<number, Row[]>();
    const standalone: Row[] = [];
    for (const l of d.ledgers) {
      if (l.trip_id != null && tripIds.has(l.trip_id)) (ledgersByTrip.get(l.trip_id) ?? ledgersByTrip.set(l.trip_id, []).get(l.trip_id)!).push(l);
      else standalone.push(l);
    }
    const membersOf = (ledgerId: number) => d.ledger_members.filter((m) => m.ledger_id === ledgerId);
    const couplesOf = (ledgerId: number) => d.ledger_couples.filter((c) => c.ledger_id === ledgerId);

    for (const trip of d.trips) {
      const candidates = (ledgersByTrip.get(trip.id) ?? []).slice().sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.id - b.id);
      const ledger = candidates[0] ?? null;
      for (const extra of candidates.slice(1)) {
        standalone.push(extra);
        this.report.warnings.push(`Reise «${trip.title}» hat mehrere Reisekassen; «${extra.title}» wird als eigenständige Reisekasse übernommen.`);
      }
      const tripId = this.upsertTrip(trip, ledger, userMap);
      const tripTitle = str(trip.title) ?? "Reise";
      let ledgerTarget: number | null = null;
      if (ledger) ledgerTarget = this.upsertLedger(ledger, { tripId, title: `Reisekasse: ${tripTitle}`, userMap });
      else ledgerTarget = this.createEmptyTripLedger(tripId, tripTitle, userMap.get(trip.created_by_user_id) ?? null);

      // Paare dieser Kasse
      if (ledger) for (const c of couplesOf(ledger.id)) this.upsertCouple(c, ledgerTarget);

      // Personen: Reisende und Kassenmitglieder zusammenführen
      const travelers = d.trip_travelers.filter((t) => t.trip_id === trip.id);
      const isCashbook = ledger != null && String(ledger.kind) === "cashbook";
      const allMembers = ledger ? membersOf(ledger.id) : [];
      const hidden = isCashbook ? allMembers.filter((m) => Number(m.hidden) === 1) : [];
      const visible = allMembers.filter((m) => !hidden.includes(m));
      const people = this.matchPeople(travelers, visible);
      if (people.length === 0 && hidden.length) people.push({ traveler: null, member: hidden[0]! });
      this.persons += people.length;
      const targets = people.map((p, i) => this.upsertParticipant(p, i, { tripId, ledgerId: ledgerTarget, userMap }));
      this.report.counts.participants.source = this.persons;

      // Versteckte Solo-Mitglieder (Kassabuch) zeigen auf den Ersteller der Reise.
      if (ledger && hidden.length) {
        const creator = this.pickCreator(trip, ledger, people);
        const creatorTarget = targets[creator]!;
        const creatorName = people[creator]!.traveler?.display_name ?? people[creator]!.member?.display_name ?? "Teilnehmer";
        for (const h of hidden) {
          if (people[creator]!.member?.id === h.id) continue;
          this.memberTargets.set(h.id, creatorTarget);
          this.map.set("ledger_members", h.id, "participants", creatorTarget);
        }
        this.cashbookPayers.set(ledger.id, creatorTarget);
        const n = d.expenses.filter((e) => e.ledger_id === ledger.id).length;
        this.report.cashbooks.push({
          ledger: str(ledger.title) ?? "Kassabuch",
          trip: tripTitle,
          payer: creatorName,
          expenses: n,
          rule:
            "Kassabuch mit verstecktem Solo-Mitglied → normale Reisekasse der Reise mit den Reiseteilnehmern; " +
            "Ausgaben bezahlt vom Ersteller der Reise, Aufteilung nur auf ihn (Beträge und Summen bleiben erhalten).",
        });
      }

      this.importEvents(trip, tripId);
    }

    // Eigenständige Reisekassen (ohne Reise) mit allen Mitgliedern
    for (const l of standalone) {
      const ledgerTarget = this.upsertLedger(l, { tripId: null, title: str(l.title) ?? "Reisekasse", userMap });
      for (const c of couplesOf(l.id)) this.upsertCouple(c, ledgerTarget);
      const people = membersOf(l.id).map((m): Person => ({ traveler: null, member: m }));
      this.persons += people.length;
      people.forEach((p, i) => this.upsertParticipant(p, i, { tripId: null, ledgerId: ledgerTarget, userMap }));
      this.report.counts.participants.source = this.persons;
    }
  }

  private upsertTrip(t: Row, ledger: Row | null, userMap: Map<number, number>): number {
    const status = ["planned", "active", "done", "cancelled"].includes(t.status) ? t.status : "planned";
    const common = {
      title: str(t.title) ?? "Reise",
      status,
      destination: str(t.destination),
      start_date: validDate(t.start_date),
      end_date: validDate(t.end_date),
      summary: str(t.summary),
      notes: str(t.notes),
      updated_at: str(t.updated_at) ?? this.ts(),
    };
    const existing = this.map.get("trips", t.id);
    const c = this.report.counts.trips;
    if (existing != null) {
      // Der Titel der Reisekasse folgt dem der Reise, solange er noch die Vorgabe «Reisekasse: …» trägt.
      const before = this.db.prepare("SELECT title FROM trips WHERE id = ?").get(existing) as { title: string } | undefined;
      updateRow(this.db, "trips", existing, common);
      if (before && before.title !== common.title) {
        this.db
          .prepare("UPDATE ledgers SET title = ? WHERE trip_id = ? AND title = ?")
          .run(`Reisekasse: ${common.title}`, existing, `Reisekasse: ${before.title}`);
      }
      c.updated += 1;
      return existing;
    }
    const home = ledger ? String(ledger.base_currency || "CHF").toUpperCase() : "CHF";
    const id = insertRow(
      this.db,
      "trips",
      {
        ...common,
        home_currency: home,
        timezone: this.tripTz,
        created_by_user_id: userMap.get(t.created_by_user_id) ?? null,
        created_at: str(t.created_at) ?? this.ts(),
      },
      t.id
    );
    this.map.set("trips", t.id, "trips", id);
    c.created += 1;
    return id;
  }

  private upsertLedger(l: Row, o: { tripId: number | null; title: string; userMap: Map<number, number> }): number {
    const c = this.report.counts.ledgers;
    const existing = this.map.get("ledgers", l.id);
    if (existing != null) {
      updateRow(this.db, "ledgers", existing, { archived_at: str(l.archived_at), updated_at: str(l.updated_at) ?? this.ts() });
      this.ledgerTargets.set(l.id, existing);
      c.updated += 1;
      return existing;
    }
    // Zu einer Reise gehört genau eine Kasse (UNIQUE trip_id): schon vorhanden (z. B. leer angelegt) → übernehmen.
    const byTrip =
      o.tripId != null
        ? (this.db.prepare("SELECT id FROM ledgers WHERE trip_id = ?").get(o.tripId) as { id: number } | undefined)?.id
        : undefined;
    if (byTrip != null) {
      updateRow(this.db, "ledgers", byTrip, {
        base_currency: String(l.base_currency || "CHF").toUpperCase(),
        archived_at: str(l.archived_at),
        updated_at: str(l.updated_at) ?? this.ts(),
      });
      this.map.set("ledgers", l.id, "ledgers", byTrip);
      this.ledgerTargets.set(l.id, byTrip);
      c.updated += 1;
      return byTrip;
    }
    const id = insertRow(
      this.db,
      "ledgers",
      {
        title: o.title,
        base_currency: String(l.base_currency || "CHF").toUpperCase(),
        trip_id: o.tripId,
        created_by_user_id: o.userMap.get(l.created_by_user_id) ?? null,
        created_at: str(l.created_at) ?? this.ts(),
        updated_at: str(l.updated_at) ?? this.ts(),
        archived_at: str(l.archived_at),
      },
      l.id
    );
    this.map.set("ledgers", l.id, "ledgers", id);
    this.ledgerTargets.set(l.id, id);
    c.created += 1;
    return id;
  }

  /** Reise ohne Kasse in der Quelle: trotzdem eine Reisekasse (1:1, wie im Server). */
  private createEmptyTripLedger(tripId: number, tripTitle: string, userId: number | null): number {
    const existing = this.db.prepare("SELECT id FROM ledgers WHERE trip_id = ?").get(tripId) as { id: number } | undefined;
    if (existing) return existing.id;
    const trip = this.db.prepare("SELECT home_currency FROM trips WHERE id = ?").get(tripId) as { home_currency: string };
    return insertRow(this.db, "ledgers", {
      title: `Reisekasse: ${tripTitle}`,
      base_currency: trip.home_currency,
      trip_id: tripId,
      created_by_user_id: userId,
      created_at: this.ts(),
      updated_at: this.ts(),
    });
  }

  private upsertCouple(c: Row, ledgerTarget: number) {
    const existing = this.map.get("ledger_couples", c.id);
    const tally = this.report.counts.couples;
    if (existing != null) {
      updateRow(this.db, "ledger_couples", existing, { name: str(c.name) ?? "Paar" });
      this.couples.set(c.id, existing);
      tally.updated += 1;
      return;
    }
    const id = insertRow(
      this.db,
      "ledger_couples",
      { ledger_id: ledgerTarget, name: str(c.name) ?? "Paar", created_at: str(c.created_at) ?? this.ts() },
      c.id
    );
    this.map.set("ledger_couples", c.id, "ledger_couples", id);
    this.couples.set(c.id, id);
    tally.created += 1;
  }

  /** Reisende und Kassenmitglieder einer Reise zu Personen zusammenführen: Konto zuerst, sonst Name. */
  private matchPeople(travelers: Row[], members: Row[]): Person[] {
    const people: Person[] = travelers.map((t) => ({ traveler: t, member: null }));
    for (const m of members) {
      let hit = people.find((p) => !p.member && p.traveler?.user_id != null && p.traveler.user_id === m.user_id && m.user_id != null);
      hit ??= people.find((p) => !p.member && p.traveler && sameName(p.traveler.display_name, m.display_name));
      if (hit) {
        hit.member = m;
        this.report.participants.merged += 1;
      } else people.push({ traveler: null, member: m });
    }
    return people;
  }

  /** Ersteller der Reise unter den Personen (für Kassabuch-Ausgaben): Konto der Kasse/Reise, sonst Admin-Name, sonst erste Person. */
  private pickCreator(trip: Row, ledger: Row, people: Person[]): number {
    const userOf = (p: Person) => p.traveler?.user_id ?? p.member?.user_id ?? null;
    for (const uid of [ledger.created_by_user_id, trip.created_by_user_id]) {
      if (uid == null) continue;
      const i = people.findIndex((p) => userOf(p) === uid);
      if (i >= 0) return i;
      const u = this.data.users.find((x) => x.id === uid);
      const j = u ? people.findIndex((p) => sameName(p.traveler?.display_name ?? p.member?.display_name, u.display_name)) : -1;
      if (j >= 0) return j;
    }
    const admins = this.data.users.filter((u) => u.is_admin && u.active !== 0);
    for (const a of admins) {
      const j = people.findIndex((p) => sameName(p.traveler?.display_name ?? p.member?.display_name, a.display_name));
      if (j >= 0) return j;
    }
    return 0;
  }

  private tokenFree(token: string): boolean {
    return (
      !this.db.prepare("SELECT 1 FROM participants WHERE share_token = ?").get(token) &&
      !this.db.prepare("SELECT 1 FROM participant_token_aliases WHERE alias_token = ?").get(token)
    );
  }

  private upsertParticipant(
    p: Person,
    index: number,
    o: { tripId: number | null; ledgerId: number | null; userMap: Map<number, number> }
  ): number {
    const t = p.traveler;
    const m = p.member;
    const tally = this.report.counts.participants;
    const name = str(t?.display_name) ?? str(m?.display_name) ?? "Teilnehmer";
    const userSrc = t?.user_id ?? m?.user_id ?? null;
    const row = {
      display_name: name,
      email: str(t?.email) ?? str(m?.email),
      user_id: userSrc != null ? o.userMap.get(userSrc) ?? null : null,
      couple_id: m?.couple_id != null ? this.couples.get(m.couple_id) ?? null : null,
      sort_key: num(t?.sort_key) ?? index,
    };
    const existing = (t ? this.map.get("trip_travelers", t.id) : undefined) ?? (m ? this.map.get("ledger_members", m.id) : undefined);
    let id: number;
    if (existing != null) {
      updateRow(this.db, "participants", existing, {
        ...row,
        trip_id: o.tripId,
        ledger_id: o.ledgerId,
      });
      id = existing;
      tally.updated += 1;
    } else {
      const primarySrc = str(t?.share_token) ?? str(m?.invite_token);
      let token = primarySrc;
      if (!token || !this.tokenFree(token)) {
        token = newShareToken();
        this.report.participants.tokensRegenerated += 1;
      } else this.report.participants.tokensKept += 1;
      id = insertRow(
        this.db,
        "participants",
        {
          trip_id: o.tripId,
          ledger_id: o.ledgerId,
          ...row,
          color_index: index % 8,
          share_token: token,
          share_revoked_at: str(t?.share_revoked_at) ?? (t ? null : str(m?.invite_revoked_at)),
          created_at: str(t?.created_at) ?? str(m?.created_at) ?? this.ts(),
        },
        m?.id ?? null
      );
      tally.created += 1;
      // Zweiter Token (Reise `/t/…` und Abrechnung `/g/…` waren in HomeBuddy verschieden) bleibt als Alias gültig.
      const second = t && m ? str(m.invite_token) : null;
      if (second && second !== token && !m!.invite_revoked_at && this.tokenFree(second)) {
        this.db
          .prepare("INSERT INTO participant_token_aliases (alias_token, participant_id, primary_token, created_at) VALUES (?, ?, ?, ?)")
          .run(second, id, token, this.ts());
        this.report.participants.aliasTokens += 1;
      }
    }
    if (t) {
      this.travelerTargets.set(t.id, id);
      this.map.set("trip_travelers", t.id, "participants", id);
    }
    if (m) {
      this.memberTargets.set(m.id, id);
      this.map.set("ledger_members", m.id, "participants", id);
    }
    return id;
  }

  /* ─ Ereignisse ─ */
  private importEvents(trip: Row, tripId: number) {
    const events = this.data.trip_events.filter((e) => e.trip_id === trip.id);
    const cat = this.catalog;
    const tripRow = this.db.prepare("SELECT timezone FROM trips WHERE id = ?").get(tripId) as { timezone: string };
    const participantIds = new Set(
      (this.db.prepare("SELECT id FROM participants WHERE trip_id = ?").all(tripId) as Array<{ id: number }>).map((r) => r.id)
    );
    const ctx: DetailsContext = { mapParticipant: (sid) => this.travelerTargets.get(sid) ?? null, participantIds };

    // 1. Spalten und Details je Ereignis
    type Item = {
      src: Row;
      type: string;
      unknownType: boolean;
      cols: Record<string, unknown>;
      details: Record<string, unknown>;
    };
    const items: Item[] = events.map((e) => {
      const resolved = cat.resolveTypeId(String(e.event_type ?? ""));
      const type = resolved ?? "Ausflug";
      const details = normalizeDetails(cat, type, e.details, ctx, this.details);
      const startDate = validDate(e.start_date);
      const endDate = validDate(e.end_date);
      if (e.start_date && !startDate) this.report.warnings.push(`Ereignis «${str(e.title) ?? ""}»: Startdatum nicht lesbar, ausgelassen.`);
      return {
        src: e,
        type,
        unknownType: !resolved,
        details,
        cols: {
          event_type: type,
          title: str(e.title) ?? "Ohne Titel",
          start_date: startDate,
          end_date: endDate && startDate && endDate < startDate ? null : endDate,
          start_time: validTime(e.start_time),
          end_time: validTime(e.end_time),
          location: str(e.location),
          address: str(e.address),
          provider: str(e.provider),
          booking_reference: str(e.booking_reference)?.toUpperCase() ?? null,
          website: str(e.website),
          phone: str(e.phone),
          lat: coord(e.lat, 90),
          lon: coord(e.lon, 180),
          notes: str(e.notes),
        },
      };
    });

    // 2. Zeitzonen
    const zones = deriveZones(
      items.map((it) => ({
        type: it.type,
        startDate: it.cols.start_date as string | null,
        endDate: it.cols.end_date as string | null,
        startTime: it.cols.start_time as string | null,
        endTime: it.cols.end_time as string | null,
        lat: it.cols.lat as number | null,
        lon: it.cols.lon as number | null,
        location: it.cols.location as string | null,
        details: it.details,
      })),
      { tripTz: tripRow.timezone }
    );

    // 3. Schreiben
    items.forEach((it, i) => {
      const e = it.src;
      const z = zones[i]!;
      const meta: Meta = {};
      const cols = it.cols;
      const details = { ...it.details };
      const bump = (z0: ZoneValue | null) => {
        if (z0) this.report.zones.byOrigin[z0.how] = (this.report.zones.byOrigin[z0.how] ?? 0) + 1;
      };
      cols.start_tz = z.startTz?.tz ?? null;
      cols.end_tz = z.endTz?.tz ?? null;
      if (z.startTz) meta.startTz = zoneMeta(z.startTz);
      if (z.endTz) meta.endTz = zoneMeta(z.endTz);
      bump(z.startTz);
      bump(z.endTz);
      if (z.review) {
        const field = !z.startTz ? "startTz" : "endTz";
        meta[field] = { source: "derived", confidence: 0, quote: `Zone zu prüfen: ${z.review}` };
        this.report.eventsNeedingReview.zones += 1;
        this.report.zones.review.push({
          trip: str(trip.title) ?? "Reise",
          type: it.type,
          title: String(cols.title),
          reason: z.review,
        });
      }
      // Flug: Koordinaten des Ereignisses = Abflughafen (wie `prefillFromAirports` im Server)
      if (it.type === "Flug" && cols.lat == null && cols.lon == null) {
        const dep = findAirport(flightAirports({ details, location: cols.location as string | null }).dep);
        if (dep) {
          cols.lat = dep.lat;
          cols.lon = dep.lon;
          meta.lat = { source: "derived", quote: `IATA ${dep.iata}` };
          meta.lon = { source: "derived", quote: `IATA ${dep.iata}` };
        }
      }
      if (it.unknownType) this.report.eventsNeedingReview.unknownType += 1;
      const status = z.review || it.unknownType ? "needs_review" : "confirmed";
      this.report.eventsByType[it.type] = (this.report.eventsByType[it.type] ?? 0) + 1;

      const existing = this.map.get("trip_events", e.id);
      const tally = this.report.counts.events;
      if (existing != null) {
        this.updateEvent(existing, cols, details, meta, str(e.updated_at));
        tally.updated += 1;
        this.events.set(e.id, existing);
        return;
      }
      const id = insertRow(
        this.db,
        "trip_events",
        {
          trip_id: tripId,
          ...cols,
          place_coords: "{}",
          details: JSON.stringify(details),
          status,
          fields_meta: JSON.stringify(meta),
          sort_key: Number.isFinite(Number(e.sort_key)) ? Number(e.sort_key) : 0,
          created_at: str(e.created_at) ?? this.ts(),
          updated_at: str(e.updated_at) ?? this.ts(),
        },
        e.id
      );
      this.map.set("trip_events", e.id, "trip_events", id);
      this.events.set(e.id, id);
      tally.created += 1;
    });
  }

  /** Wiederholter Import: gesperrte Felder (von Hand geändert) bleiben, Status und Preise werden nie angefasst. */
  private updateEvent(id: number, cols: Record<string, unknown>, details: Record<string, unknown>, meta: Meta, updatedAt: string | null) {
    const cur = this.db.prepare("SELECT * FROM trip_events WHERE id = ?").get(id) as Row;
    const curMeta = parseObj(cur.fields_meta) as Meta;
    const curDetails = parseObj(cur.details);
    const next: Record<string, unknown> = { ...cols };
    for (const [api, col] of Object.entries(EVENT_FIELD_COLUMNS)) {
      if (curMeta[api]?.locked) next[col] = cur[col];
    }
    const nextDetails = { ...details };
    for (const [k, v] of Object.entries(curMeta)) {
      if (v?.locked && k in curDetails) nextDetails[k] = curDetails[k];
    }
    const mergedMeta: Meta = { ...meta };
    for (const [k, v] of Object.entries(curMeta)) {
      if (v?.locked || v?.source === "manual") mergedMeta[k] = v;
      else if (!(k in mergedMeta)) mergedMeta[k] = v;
    }
    updateRow(this.db, "trip_events", id, {
      ...next,
      details: JSON.stringify(nextDetails),
      fields_meta: JSON.stringify(mergedMeta),
      updated_at: updatedAt ?? this.ts(),
    });
  }

  /* ─ Kommentare ─ */
  private importComments(userMap: Map<number, number>) {
    const tally = this.report.counts.comments;
    for (const c of this.data.trip_event_comments) {
      const eventId = this.events.get(c.trip_event_id);
      if (eventId == null) {
        this.report.warnings.push(`Kommentar ${c.id}: Ereignis fehlt in der Quelle, nicht übernommen.`);
        continue;
      }
      const row = {
        trip_event_id: eventId,
        user_id: c.user_id != null ? userMap.get(c.user_id) ?? null : null,
        author_name: str(c.author_name) ?? "Unbekannt",
        body: String(c.body ?? ""),
        created_at: str(c.created_at) ?? this.ts(),
        updated_at: str(c.updated_at) ?? str(c.created_at) ?? this.ts(),
      };
      const existing = this.map.get("trip_event_comments", c.id);
      if (existing != null) {
        updateRow(this.db, "trip_event_comments", existing, row);
        tally.updated += 1;
      } else {
        const id = insertRow(this.db, "trip_event_comments", row, c.id);
        this.map.set("trip_event_comments", c.id, "trip_event_comments", id);
        tally.created += 1;
      }
    }
  }

  /* ─ Dokumente ─ */
  private importDocuments() {
    const tally = this.report.counts.documents;
    const seen = new Set<number>();
    for (const doc of this.plan.docs) {
      const mapped = doc.sourceId != null ? this.map.get("documents", doc.sourceId) : undefined;
      const bySha = this.db.prepare("SELECT id FROM documents WHERE sha256 = ?").get(doc.sha256) as { id: number } | undefined;
      const existing = mapped ?? bySha?.id;
      const ts = this.ts();
      let id: number;
      if (existing != null) {
        if (mapped != null) {
          // Aus einem früheren Import: Titel, Text und Altanalyse auffrischen.
          this.refreshDocument(existing, doc);
          if (!seen.has(existing)) tally.updated += 1;
        } else {
          // Dieselbe Datei gab es schon (Dublette per SHA-256): nur verknüpfen, nichts überschreiben.
          this.report.documents.duplicates += 1;
        }
        id = existing;
      } else {
        id = insertRow(this.db, "documents", {
          title: doc.title,
          file_name: doc.fileName,
          content_type: doc.contentType,
          size_bytes: doc.bytes.length,
          sha256: doc.sha256,
          pages: doc.pages,
          text: doc.text,
          text_source: doc.text ? "ocr" : null,
          analysis_status: doc.analysisJson ? "done" : "pending",
          analysis_json: doc.analysisJson,
          analysis_model: doc.analysisJson ? "homebuddy-import" : null,
          analyzed_at: doc.analysisJson ? doc.analyzedAt ?? ts : null,
          summary: doc.summary,
          source: "upload",
          source_meta: JSON.stringify(doc.sourceMeta),
          created_at: doc.createdAt ?? ts,
          updated_at: ts,
        });
        tally.created += 1;
        this.report.documents.imported += 1;
        if (!doc.linked) this.report.documents.unlinkedImported += 1;
      }
      seen.add(id);
      this.usedDocumentHashes.add(doc.sha256);
      if (doc.sourceId != null) {
        this.docTargets.set(doc.sourceId, id);
        this.map.set("documents", doc.sourceId, "documents", id);
      }
    }
  }

  private refreshDocument(id: number, doc: PreparedDoc) {
    const cur = this.db.prepare("SELECT analysis_model FROM documents WHERE id = ?").get(id) as { analysis_model: string | null };
    const row: Record<string, unknown> = { title: doc.title, text: doc.text, text_source: doc.text ? "ocr" : null, summary: doc.summary, updated_at: this.ts() };
    // Eine spätere echte Analyse im Ziel nicht durch die Altanalyse ersetzen.
    if (doc.analysisJson && (cur.analysis_model == null || cur.analysis_model === "homebuddy-import")) {
      row.analysis_status = "done";
      row.analysis_json = doc.analysisJson;
      row.analysis_model = "homebuddy-import";
      row.analyzed_at = doc.analyzedAt ?? this.ts();
    }
    updateRow(this.db, "documents", id, row);
  }

  private linkDocuments() {
    const tally = this.report.counts.eventDocumentLinks;
    const ins = this.db.prepare("INSERT OR IGNORE INTO trip_event_documents (trip_event_id, document_id, created_at) VALUES (?, ?, ?)");
    const insTrip = this.db.prepare("INSERT OR IGNORE INTO trip_documents (trip_id, document_id, created_at) VALUES (?, ?, ?)");
    const tripOf = this.db.prepare("SELECT trip_id FROM trip_events WHERE id = ?");
    for (const l of this.data.trip_event_documents) {
      const ev = this.events.get(l.trip_event_id);
      const doc = this.docTargets.get(l.document_id);
      if (ev == null || doc == null) continue;
      const r = ins.run(ev, doc, str(l.created_at) ?? this.ts());
      if (r.changes > 0) tally.created += 1;
      else tally.updated += 1;
      const trip = tripOf.get(ev) as { trip_id: number } | undefined;
      if (trip) insTrip.run(trip.trip_id, doc, this.ts());
    }
  }

  /* ─ Ausgaben und Rückzahlungen ─ */
  private importMoney() {
    const d = this.data;
    const splitsOf = new Map<number, Row[]>();
    for (const s of d.expense_splits) (splitsOf.get(s.expense_id) ?? splitsOf.set(s.expense_id, []).get(s.expense_id)!).push(s);
    const ledgerById = new Map(d.ledgers.map((l) => [l.id, l]));
    const expenseTargets = new Map<number, number>();
    const eTally = this.report.counts.expenses;
    const member = (id: number | null | undefined): number | null => (id == null ? null : this.memberTargets.get(id) ?? null);

    for (const e of d.expenses.slice().sort((a, b) => a.id - b.id)) {
      const ledger = ledgerById.get(e.ledger_id);
      const ledgerTarget = this.ledgerTargets.get(e.ledger_id);
      if (!ledger || ledgerTarget == null) {
        this.report.warnings.push(`Ausgabe ${e.id}: Reisekasse fehlt in der Quelle, nicht übernommen.`);
        continue;
      }
      const payer = member(e.paid_by_member_id);
      if (payer == null) {
        this.report.warnings.push(`Ausgabe ${e.id}: Zahler lässt sich keinem Teilnehmer zuordnen, nicht übernommen.`);
        continue;
      }
      const base = String(ledger.base_currency || "CHF").toUpperCase();
      const currency = String(e.currency || base).toUpperCase();
      const eventId = e.trip_event_id != null ? this.events.get(e.trip_event_id) ?? null : null;
      const row: Record<string, unknown> = {
        ledger_id: ledgerTarget,
        paid_by_participant_id: payer,
        created_by_participant_id: member(e.created_by_member_id),
        direction: e.direction === "income" ? "income" : "expense",
        amount_minor: intOf(e.amount_minor, `Ausgabe ${e.id}`),
        currency,
        exchange_rate: num(e.exchange_rate) ?? 1,
        amount_base_minor: intOf(e.amount_base_minor, `Ausgabe ${e.id}`),
        description: str(e.description),
        expense_date: validDate(e.expense_date),
        category_label: str(e.category_label),
        note: str(e.note),
        split_mode: ["equal", "coupleEqual", "exact", "shares"].includes(e.split_mode) ? e.split_mode : "equal",
        settled_status: [0, 1, 2].includes(Number(e.settled_status)) ? Number(e.settled_status) : 0,
        document_id: e.document_id != null ? this.docTargets.get(e.document_id) ?? null : null,
        trip_event_id: eventId,
        place_name: str(e.place_name),
        place_lat: num(e.place_lat),
        place_lon: num(e.place_lon),
        updated_at: str(e.updated_at) ?? this.ts(),
      };
      let id = this.map.get("expenses", e.id);
      if (id != null) {
        updateRow(this.db, "expenses", id, row);
        this.db.prepare("DELETE FROM expense_splits WHERE expense_id = ?").run(id);
        eTally.updated += 1;
      } else {
        id = insertRow(this.db, "expenses", { ...row, created_at: str(e.created_at) ?? this.ts() }, e.id);
        this.map.set("expenses", e.id, "expenses", id);
        eTally.created += 1;
      }
      expenseTargets.set(e.id, id);
      if (eventId != null && !this.firstExpenseOfEvent.has(eventId)) this.firstExpenseOfEvent.set(eventId, id);
      const insSplit = this.db.prepare(
        "INSERT OR REPLACE INTO expense_splits (expense_id, participant_id, share_base_minor, share_units) VALUES (?, ?, ?, ?)"
      );
      // Mehrere Quell-Mitglieder können auf einen Teilnehmer fallen (Solo-Mitglied → Ersteller): Anteile addieren.
      const acc = new Map<number, { share: number; units: number | null }>();
      for (const s of splitsOf.get(e.id) ?? []) {
        const p = member(s.member_id);
        if (p == null) throw new Error(`Aufteilung der Ausgabe ${e.id}: Mitglied ${s.member_id} lässt sich keinem Teilnehmer zuordnen`);
        const cur = acc.get(p) ?? { share: 0, units: null };
        cur.share += intOf(s.share_base_minor, `Aufteilung der Ausgabe ${e.id}`);
        if (num(s.share_units) != null) cur.units = (cur.units ?? 0) + (s.share_units as number);
        acc.set(p, cur);
      }
      for (const [p, v] of acc) insSplit.run(id, p, v.share, v.units);
    }

    const sTally = this.report.counts.settlements;
    for (const s of d.settlements.slice().sort((a, b) => a.id - b.id)) {
      const ledger = ledgerById.get(s.ledger_id);
      const ledgerTarget = this.ledgerTargets.get(s.ledger_id);
      const from = member(s.from_member_id);
      const to = member(s.to_member_id);
      if (!ledger || ledgerTarget == null || from == null || to == null || from === to) {
        this.report.warnings.push(`Rückzahlung ${s.id}: Teilnehmer lassen sich nicht zuordnen, nicht übernommen.`);
        continue;
      }
      const base = String(ledger.base_currency || "CHF").toUpperCase();
      const row = {
        ledger_id: ledgerTarget,
        from_participant_id: from,
        to_participant_id: to,
        amount_minor: intOf(s.amount_minor, `Rückzahlung ${s.id}`),
        currency: String(s.currency || base).toUpperCase(),
        exchange_rate: num(s.exchange_rate) ?? 1,
        amount_base_minor: intOf(s.amount_base_minor, `Rückzahlung ${s.id}`),
        note: str(s.note),
        settled_at: str(s.settled_at) ?? this.ts().slice(0, 10),
        created_by_participant_id: member(s.created_by_member_id),
        related_expense_id: s.related_expense_id != null ? expenseTargets.get(s.related_expense_id) ?? null : null,
      };
      const existing = this.map.get("settlements", s.id);
      if (existing != null) {
        updateRow(this.db, "settlements", existing, row);
        sTally.updated += 1;
      } else {
        const id = insertRow(this.db, "settlements", { ...row, created_at: str(s.created_at) ?? this.ts() }, s.id);
        this.map.set("settlements", s.id, "settlements", id);
        sTally.created += 1;
      }
    }
  }

  /** `trip_events.expense_id` = erste Ausgabe zum Ereignis (wie `createExpense` des Servers), sofern leer. */
  private backfillEventExpenses() {
    const set = this.db.prepare("UPDATE trip_events SET expense_id = ? WHERE id = ? AND expense_id IS NULL");
    for (const [eventId, expenseId] of this.firstExpenseOfEvent) set.run(expenseId, eventId);
  }
}
