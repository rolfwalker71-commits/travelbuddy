/**
 * Mitteilungs-Scheduler: minütlicher Lauf (`start`, über `lib/background`), der
 *  1. fällige Mitteilungen aus den Ereignissen berechnet (`plan.ts`) und über `Notifier.deliver` zustellt
 *     (Entdoppelung in `notification_log`, Einstellungen je Benutzer, nur Teilnehmer mit Konto und Gerät),
 *  2. Live Activities startet, aktualisiert und beendet (`live.ts`).
 *
 * Ohne APNs-Schlüssel (Trockenlauf) wird nichts als gesendet markiert; sobald der Schlüssel da ist, holt der nächste
 * Lauf nach, was dann noch gilt. `simulate` rechnet denselben Plan für einen frei gewählten Zeitpunkt, ohne zu
 * senden oder zu schreiben (Diagnose, Tests mit eingefrorener Uhr).
 */
import type { Db } from "../db/client";
import type { Background } from "../lib/background";
import type { PushTransport } from "../push/apns";
import { IMAGE_KEYS, getPrefs, type DeliveryReport, type Notifier } from "../push/notifier";
import { quietDeferral } from "../push/quiet";
import { planNotices, type PlannedNotice, type PlanOptions } from "./plan";
import { LiveActivityService, emptyLiveReport, planActivities, type ActivityPlan, type LiveReport } from "./live";

export type TickReport = {
  at: string;
  durationMs: number;
  /** Kein APNs-Schlüssel: Es wurde nichts gesendet. */
  dryRun: boolean;
  /** Fällige Mitteilungen in diesem Lauf. */
  planned: number;
  delivery: DeliveryReport;
  live: LiveReport;
  error?: string;
};

export type SchedulerStatus = {
  running: boolean;
  intervalSeconds: number | null;
  lastRun: TickReport | null;
  /** Im Trockenlauf aufgelaufene, noch nicht gesendete Mitteilungen des letzten Laufs. */
  pending: number;
};

export type PlannedView = {
  userId: number;
  kind: string;
  tag: string;
  title: string;
  body: string;
  dueAt: string;
  validUntil: string;
  tripId: number | null;
  eventId: number | null;
  interruption: "active" | "time-sensitive";
  deepLink: string;
  imageKey: string | null;
  relevance: number | null;
  /** Läge zum Zeitpunkt in der Ruhezeit des Empfängers und würde verschoben. */
  quiet: boolean;
};

export type ActivityView = {
  userId: number;
  key: string;
  kind: string;
  tripId: number;
  eventId: number | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  state: ReturnType<ActivityPlan["state"]> | null;
};

export type Simulation = { at: string; due: PlannedView[]; upcoming: PlannedView[]; liveActivities: ActivityView[] };

const describe = (p: PlannedNotice, quiet: boolean): PlannedView => ({
  userId: p.notice.userId,
  kind: p.notice.kind,
  tag: p.tag,
  title: p.notice.title,
  body: p.notice.body,
  dueAt: new Date(p.dueAtMs).toISOString(),
  validUntil: new Date(p.validUntilMs).toISOString(),
  tripId: p.notice.tripId ?? null,
  eventId: p.notice.eventId ?? null,
  interruption: p.notice.interruption ?? "active",
  deepLink: p.notice.deepLink,
  imageKey: p.notice.imageKey ?? IMAGE_KEYS[p.notice.kind] ?? null,
  relevance: p.notice.relevance ?? null,
  quiet,
});

const DEFAULT_BUNDLE = "ch.rolfwalker.travelbuddy";
const LOG_KEEP_DAYS = 120;

export class NotificationScheduler {
  readonly live: LiveActivityService;
  private readonly now: () => Date;
  private running = false;
  private last: TickReport | null = null;
  private interval: number | null = null;
  private lastPrune = 0;
  private lastLoggedPending = -1;

  constructor(
    private readonly opts: {
      db: Db;
      notifier: Notifier;
      transport: PushTransport | null;
      now?: () => Date;
      /** Bundle-ID für das Live-Activity-Topic; Vorgabe aus dem Transport, `APNS_TOPIC` oder die App-Kennung. */
      bundleId?: string;
      log?: (message: string) => void;
    }
  ) {
    this.now = opts.now ?? (() => new Date());
    this.live = new LiveActivityService(opts.db, opts.transport, { bundleId: this.bundleId(), log: opts.log });
  }

  private bundleId(): string {
    if (this.opts.bundleId) return this.opts.bundleId;
    const st = this.opts.transport?.status?.();
    if (st?.configured) return st.topic;
    return process.env.APNS_TOPIC || DEFAULT_BUNDLE;
  }

  /** Ist ein Push-Schlüssel da (oder ein Transport ohne Statusabfrage, z. B. im Test)? */
  isConfigured(): boolean {
    const t = this.opts.transport;
    if (!t) return false;
    const st = t.status?.();
    return st ? st.configured : true;
  }

  /** Ein Lauf zum Zeitpunkt `at` (Standard: jetzt). Läuft nie parallel zu sich selbst. */
  async tick(at?: Date): Promise<TickReport> {
    const started = Date.now();
    const when = at ?? this.now();
    if (this.running) return this.last ?? this.empty(when, started);
    this.running = true;
    const report = this.empty(when, started);
    try {
      const plan = planNotices(this.opts.db, when.getTime());
      report.planned = plan.due.length;
      if (!this.isConfigured()) {
        report.dryRun = true;
        report.delivery.deferred = plan.due.length;
        if (plan.due.length !== this.lastLoggedPending) {
          this.lastLoggedPending = plan.due.length;
          this.opts.log?.(
            `[notify] Trockenlauf (kein APNs-Schlüssel): ${plan.due.length} fällige Mitteilung(en) werden nachgeholt, sobald der Schlüssel da ist`
          );
        }
      } else {
        this.lastLoggedPending = -1;
        report.delivery = await this.opts.notifier.deliver(plan.due.map((p) => p.notice));
        // Vorgemerkte Meldungen (Kommentare, Reisekasse, Vorschläge), deren Ruhezeit vorbei ist
        const flushed = await this.opts.notifier.flushQuiet();
        for (const k of Object.keys(flushed) as Array<keyof DeliveryReport>) report.delivery[k] += flushed[k];
        report.live = await this.live.run(when, planActivities(this.opts.db, when.getTime(), { trips: plan.trips }));
        this.prune(when);
      }
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      this.opts.log?.(`[notify] ${report.error}`);
    } finally {
      this.running = false;
      report.durationMs = Date.now() - started;
      this.last = report;
    }
    return report;
  }

  private empty(when: Date, started: number): TickReport {
    return {
      at: when.toISOString(),
      durationMs: Date.now() - started,
      dryRun: false,
      planned: 0,
      delivery: { sent: 0, skippedPrefs: 0, skippedDuplicate: 0, noDevice: 0, failed: 0, deferred: 0, quiet: 0 },
      live: emptyLiveReport(),
    };
  }

  /** Was wäre zum Zeitpunkt `at` fällig? Sendet nichts, schreibt nichts. */
  simulate(at: Date, opts: PlanOptions = {}): Simulation {
    const nowMs = at.getTime();
    const plan = planNotices(this.opts.db, nowMs, opts);
    const activities = planActivities(this.opts.db, nowMs, { trips: plan.trips });
    return {
      at: at.toISOString(),
      due: plan.due.map((p) => describe(p, this.heldBack(p, nowMs))),
      upcoming: plan.upcoming.map((p) => describe(p, this.heldBack(p, p.dueAtMs))),
      liveActivities: activities
        .filter((a) => a.endAtMs > nowMs - 3_600_000 && a.startAtMs < nowMs + (opts.previewHours ?? 24) * 3_600_000)
        .map((a) => {
          const active = a.startAtMs <= nowMs && nowMs < a.endAtMs;
          return {
            userId: a.userId,
            key: a.key,
            kind: a.kind,
            tripId: a.tripId,
            eventId: a.eventId,
            startsAt: new Date(a.startAtMs).toISOString(),
            endsAt: new Date(a.endAtMs).toISOString(),
            active,
            state: a.startAtMs <= nowMs + 3_600_000 ? a.state(Math.min(Math.max(nowMs, a.startAtMs), a.endAtMs)) : null,
          };
        }),
    };
  }

  /** Würde die Mitteilung zum Zeitpunkt wegen der Ruhezeiten verschoben? */
  private heldBack(p: PlannedNotice, atMs: number): boolean {
    return quietDeferral(this.opts.db, p.notice, getPrefs(this.opts.db, p.notice.userId), atMs) != null;
  }

  /** Minütlicher Lauf im Hintergrund; Rückgabe beendet ihn. */
  start(background: Background, intervalMs = 60_000, firstDelayMs = 10_000): () => void {
    this.interval = Math.round(intervalMs / 1000);
    const run = () => background.run(this.tick());
    const first = setTimeout(run, firstDelayMs);
    first.unref();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      this.interval = null;
    };
  }

  status(): SchedulerStatus {
    return {
      running: this.running,
      intervalSeconds: this.interval,
      lastRun: this.last,
      pending: this.last?.dryRun ? this.last.delivery.deferred : 0,
    };
  }

  /** Protokoll älter als 120 Tage entfernen (höchstens einmal je Tag). */
  private prune(at: Date): void {
    if (at.getTime() - this.lastPrune < 24 * 3_600_000) return;
    this.lastPrune = at.getTime();
    const cutoff = new Date(at.getTime() - LOG_KEEP_DAYS * 24 * 3_600_000).toISOString();
    this.opts.db.prepare("DELETE FROM notification_log WHERE created_at < ?").run(cutoff);
  }
}
