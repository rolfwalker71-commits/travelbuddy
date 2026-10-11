/** Gemeinsame Hilfen der Mitteilungs-Tests: Fake-APNs, eingefrorene Uhr, Reise mit Ereignissen. */
import { Notifier } from "../src/push/notifier";
import type { ApnsMessage, ApnsResult, PushTransport } from "../src/push/apns";
import { createBackground } from "../src/lib/background";
import { NotificationScheduler } from "../src/notifications/scheduler";
import { setup } from "./helpers";

export const HEX_A = "a".repeat(64);
export const HEX_B = "b".repeat(64);
export const HEX_C = "c".repeat(64);
export const START_A = "1a".repeat(40);
export const START_B = "1b".repeat(40);
export const ACT_A = "ac".repeat(40);
export const ACT_B = "ad".repeat(40);

export function fakePush(opts: { configured?: boolean } = {}) {
  const sent: ApnsMessage[] = [];
  const invalid = new Set<string>();
  const state = { configured: opts.configured ?? true };
  const transport: PushTransport = {
    async send(msg): Promise<ApnsResult> {
      if (!state.configured) return { ok: false, status: 0, reason: "not_configured: Keine Datei AuthKey_<KEYID>.p8", invalidToken: false };
      sent.push(msg);
      if (invalid.has(msg.deviceToken)) return { ok: false, status: 410, reason: "Unregistered", invalidToken: true };
      return { ok: true };
    },
    status() {
      return state.configured
        ? { configured: true, keyId: "ABC123DEFG", teamId: "9XZWUZ7Z26", topic: "ch.rolfwalker.travelbuddy", source: "file", file: "AuthKey_ABC123DEFG.p8" }
        : { configured: false, reason: "Keine Datei AuthKey_<KEYID>.p8", searched: "/data/apns" };
    },
  };
  return { transport, sent, invalid, state };
}

/** App mit Fake-APNs, einstellbarer Uhr und explizitem Scheduler (gleiche Uhr, gleicher Transport). */
export async function notifSetup(opts: { now?: string; configured?: boolean; illustrationsDir?: string | null } = {}) {
  const push = fakePush({ configured: opts.configured });
  const clock = { ms: Date.parse(opts.now ?? "2026-10-20T08:00:00Z") };
  const now = () => new Date(clock.ms);
  const background = createBackground();
  const s = await setup({ deps: { push: push.transport, now, background } });
  const notifier = new Notifier(s.db, push.transport, now);
  const scheduler = new NotificationScheduler({ db: s.db, notifier, transport: push.transport, now });
  // Die App der Prüfung nutzt denselben Scheduler (Routen für Status/Simulation).
  const { createApp } = await import("../src/app");
  const app = createApp({
    db: s.db,
    now,
    push: push.transport,
    notifier,
    scheduler,
    background,
    illustrationsDir: opts.illustrationsDir,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ date: "2026-10-09", rates: { CHF: 1 } }) }),
  });
  const call = async (
    method: string,
    path: string,
    o: { token?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.json !== undefined ? { "content-type": "application/json" } : {}),
        ...(o.headers ?? {}),
      },
      body: o.form ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined),
    });
    const ct = res.headers.get("content-type") ?? "";
    const clone = res.clone();
    let body: any = null;
    if (ct.includes("json")) body = await res.json();
    else if (ct.startsWith("text/")) body = await res.text();
    return { status: res.status, headers: res.headers, body, raw: clone };
  };
  const set = (iso: string) => {
    clock.ms = Date.parse(iso);
  };
  return { ...s, app, call, push, clock, set, scheduler, notifier, now, background };
}

export type NotifEnv = Awaited<ReturnType<typeof notifSetup>>;

/** Reise als Admin anlegen (Anna), `ben` und optional weitere Konten als Mitreisende. */
export async function makeTrip(
  env: NotifEnv,
  o: { title?: string; startDate?: string; endDate?: string; timezone?: string; destination?: string; travelers?: Array<{ displayName: string; userId?: number }> } = {}
) {
  const anna = await env.tokens.anna();
  const r = await env.call("POST", "/v1/trips", {
    token: anna,
    json: {
      title: o.title ?? "Barcelona",
      destination: o.destination ?? "Barcelona",
      startDate: o.startDate ?? "2026-10-24",
      endDate: o.endDate ?? "2026-10-31",
      timezone: o.timezone ?? "Europe/Zurich",
      travelers: o.travelers ?? [{ displayName: "Ben", userId: env.userId("ben") }],
    },
  });
  if (r.status !== 201) throw new Error(`Reise nicht angelegt: ${JSON.stringify(r.body)}`);
  return { anna, tripId: r.body.trip.id as number, ledgerId: r.body.trip.ledgerId as number, travelers: r.body.travelers as Array<{ id: number; displayName: string }> };
}

export async function addEvent(env: NotifEnv, token: string, tripId: number, input: Record<string, unknown>): Promise<number> {
  const r = await env.call("POST", `/v1/trips/${tripId}/events`, { token, json: input });
  if (r.status !== 201) throw new Error(`Ereignis nicht angelegt: ${JSON.stringify(r.body)}`);
  return r.body.eventId as number;
}

/** Gerät registrieren (APNs-Token, optional Push-to-Start). */
export async function registerDevice(env: NotifEnv, token: string, apns: string, extra: { pushToStartToken?: string; environment?: "development" | "production" } = {}) {
  const r = await env.call("PUT", "/v1/devices/current", { token, json: { apnsToken: apns, environment: extra.environment ?? "production", ...extra } });
  if (r.status !== 200) throw new Error(`Gerät nicht registriert: ${JSON.stringify(r.body)}`);
}

/** Wie `TravelNotificationPayload.init(userInfo:)` der Apps (Feldnamen aus ios/Shared/TravelNotificationPayload.swift). */
export function decodeLikeSwift(userInfo: Record<string, any>, category?: string) {
  const nested = (userInfo.data as Record<string, any> | undefined) ?? {};
  const value = (k: string) => userInfo[k] ?? nested[k];
  const string = (k: string) => {
    const v = value(k);
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "number") return String(v);
    return undefined;
  };
  const int = (k: string) => {
    const v = value(k);
    if (typeof v === "number") return Math.trunc(v);
    if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
    return undefined;
  };
  const t = (value("ticket") as Record<string, any> | undefined) ?? {};
  const ts = (k: string, alt?: string) => {
    if (typeof t[k] === "string" && t[k] !== "") return t[k] as string;
    if (typeof t[k] === "number") return String(t[k]);
    return alt ? string(alt) : undefined;
  };
  const startAtRaw = ts("startAt");
  // `ISO8601DateFormatter()` (Standardoptionen): `YYYY-MM-DDTHH:MM:SSZ`, ohne Sekundenbruchteile
  const startAtOk = startAtRaw == null ? undefined : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})$/.test(startAtRaw);
  return {
    kind: string("kind") ?? category ?? "",
    deepLink: string("deepLink"),
    tripId: int("tripId"),
    eventId: int("eventId"),
    imageKey: string("imageKey"),
    interruption: string("interruption"),
    relevance: typeof value("relevance") === "number" ? (value("relevance") as number) : undefined,
    ticket: {
      type: ts("type", "eventType"),
      icon: ts("icon"),
      color: ts("color"),
      title: ts("title", "eventTitle"),
      startDate: ts("startDate"),
      startTime: ts("startTime"),
      endTime: ts("endTime"),
      tz: ts("tz", "startTz"),
      startAt: startAtRaw,
      startAtParsable: startAtOk,
      from: ts("from"),
      to: ts("to"),
      place: ts("place", "location"),
      address: ts("address"),
      lat: typeof t.lat === "number" ? (t.lat as number) : undefined,
      lon: typeof t.lon === "number" ? (t.lon as number) : undefined,
      reference: ts("reference", "bookingReference"),
      tripTitle: ts("tripTitle"),
      dayIndex: typeof t.dayIndex === "number" ? (t.dayIndex as number) : undefined,
      dayCount: typeof t.dayCount === "number" ? (t.dayCount as number) : undefined,
      count: typeof t.count === "number" ? (t.count as number) : undefined,
      deadlineKind: ts("deadlineKind"),
      facts: Array.isArray(t.facts)
        ? (t.facts as any[]).filter((f) => typeof f?.label === "string" && typeof f?.value === "string")
        : [],
      items: Array.isArray(t.items) ? (t.items as any[]).filter((i) => typeof i?.title === "string") : [],
    },
  };
}
