/**
 * Kleiner In-Memory-Server für Entwicklung und Tests: bildet die Routen des Vertrags (docs/CONTRACT.md) nach,
 * soweit der Web-Client sie braucht. Kein Produktionscode: wird nur über `mocks/install.ts` im Dev-Modus geladen.
 */
import type { DocumentItem, Expense, TripEvent } from "../api/types";
import bundledCatalog from "../data/event-types.json";
import { createDb, addDays, mkDoc, type MockDb, type MockTrip } from "./fixtures";
import { splitEqual } from "../lib/splits";

type Reply = { status: number; json?: unknown; body?: BodyInit; type?: string };
const ok = (json: unknown, status = 200): Reply => ({ status, json });
const err = (status: number, code: string, message: string): Reply => ({ status, json: { error: { code, message } } });

const AIRPORTS = [
  { iata: "ZRH", name: "Zürich Flughafen", city: "Zürich", country: "Schweiz", lat: 47.4647, lon: 8.5492, tz: "Europe/Zurich" },
  { iata: "BCN", name: "Barcelona-El Prat", city: "Barcelona", country: "Spanien", lat: 41.2974, lon: 2.0833, tz: "Europe/Madrid" },
  { iata: "PMI", name: "Palma de Mallorca", city: "Palma", country: "Spanien", lat: 39.5517, lon: 2.7388, tz: "Europe/Madrid" },
  { iata: "LIS", name: "Humberto Delgado", city: "Lissabon", country: "Portugal", lat: 38.7813, lon: -9.1359, tz: "Europe/Lisbon" },
  { iata: "MIA", name: "Miami International", city: "Miami", country: "USA", lat: 25.7959, lon: -80.287, tz: "America/New_York" },
  { iata: "FLL", name: "Fort Lauderdale-Hollywood", city: "Fort Lauderdale", country: "USA", lat: 26.0742, lon: -80.1506, tz: "America/New_York" },
  { iata: "LHR", name: "London Heathrow", city: "London", country: "Grossbritannien", lat: 51.47, lon: -0.4543, tz: "Europe/London" },
  { iata: "JFK", name: "John F. Kennedy", city: "New York", country: "USA", lat: 40.6413, lon: -73.7781, tz: "America/New_York" },
];

/** Minimales gültiges PDF mit einer Seite (für den PDF-Betrachter). */
export function samplePdf(title: string): string {
  const esc = (t: string) => t.replace(/[()\\]/g, "");
  const stream = `BT /F1 20 Tf 60 740 Td (${esc(title)}) Tj 0 -34 Td /F1 12 Tf (Buchungsbestaetigung, Beispieldaten) Tj 0 -22 Td (Flug LX 1952 Zuerich - Barcelona, 12:20) Tj 0 -22 Td (Buchungscode K7M2QX) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

const THUMB = (title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 116"><rect width="88" height="116" fill="#fff"/><rect x="10" y="12" width="40" height="6" fill="#bbb"/><g fill="#ddd"><rect x="10" y="30" width="68" height="4"/><rect x="10" y="40" width="60" height="4"/><rect x="10" y="50" width="64" height="4"/><rect x="10" y="60" width="50" height="4"/></g><text x="10" y="104" font-size="7" fill="#888" font-family="sans-serif">${title.slice(0, 18)}</text></svg>`;

export class MockServer {
  db: MockDb;
  today: string;
  /** Welche Antworten sollen fehlschlagen (für Tests der Fehlerzustände). */
  failOnce = new Set<string>();
  private prefs: Record<string, unknown> = {
    tripToday: true,
    tripDepart: true,
    tripStay: true,
    tripPickup: true,
    tripDeadline: true,
    tripReview: true,
    tripComment: true,
    ledgerExpense: true,
    ledgerSettlement: true,
    leadTimes: { departHours: [24, 3, 1], checkoutMinutes: 60, deadlineDays: 3, todayBriefing: "07:30" },
    quietHours: { enabled: true, from: "22:30", to: "06:30" },
  };

  constructor(today: string) {
    this.today = today;
    this.db = createDb(today);
  }

  private trip(id: number): MockTrip | undefined {
    return this.db.trips.find((t) => t.id === id);
  }

  private tripDetail(t: MockTrip) {
    const review = t.events.filter((e) => e.status && e.status !== "confirmed").length;
    return {
      trip: {
        id: t.id,
        title: t.title,
        destination: t.destination,
        startDate: t.startDate,
        endDate: t.endDate,
        summary: t.summary,
        notes: t.notes,
        ledgerId: t.ledgerId,
        createdAt: "2026-09-01T08:00:00.000Z",
        updatedAt: "2026-10-09T08:00:00.000Z",
        coverUrl: null,
        homeCurrency: t.homeCurrency,
        timezone: t.timezone,
        phase: this.phaseOf(t),
        needsReviewCount: review,
      },
      travelers: t.travelers,
      events: t.events,
    };
  }

  private phaseOf(t: MockTrip): "upcoming" | "active" | "past" {
    if (t.startDate && this.today < t.startDate) return "upcoming";
    if (t.endDate && this.today > t.endDate) return "past";
    return "active";
  }

  private balances(ledgerId: number) {
    const t = this.db.trips.find((x) => x.ledgerId === ledgerId)!;
    const net = new Map<number, { paid: number; owed: number }>();
    for (const m of t.travelers) net.set(m.id, { paid: 0, owed: 0 });
    for (const e of this.db.expenses.filter((x) => x.ledgerId === ledgerId)) {
      const p = net.get(e.paidByMemberId);
      if (p) p.paid += e.amountBaseMinor;
      for (const s of e.splits) {
        const o = net.get(s.memberId);
        if (o) o.owed += s.shareBaseMinor;
      }
    }
    const balances = t.travelers.map((m) => {
      const v = net.get(m.id)!;
      return {
        memberId: m.id,
        displayName: m.displayName,
        paidMinor: v.paid,
        owedMinor: v.owed,
        settlementsPaidMinor: 0,
        settlementsReceivedMinor: 0,
        netMinor: v.paid - v.owed,
      };
    });
    // minimale Überweisungen (gierig)
    const cred = balances.filter((b) => b.netMinor > 0).map((b) => ({ ...b })).sort((a, b) => b.netMinor - a.netMinor);
    const debt = balances.filter((b) => b.netMinor < 0).map((b) => ({ ...b, netMinor: -b.netMinor })).sort((a, b) => b.netMinor - a.netMinor);
    const transfers: { fromMemberId: number; fromName: string; toMemberId: number; toName: string; amountMinor: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i]!.netMinor, cred[j]!.netMinor);
      if (amt > 0) transfers.push({ fromMemberId: debt[i]!.memberId, fromName: debt[i]!.displayName, toMemberId: cred[j]!.memberId, toName: cred[j]!.displayName, amountMinor: amt });
      debt[i]!.netMinor -= amt;
      cred[j]!.netMinor -= amt;
      if (debt[i]!.netMinor === 0) i++;
      if (cred[j]!.netMinor === 0) j++;
    }
    return { balances, transfers };
  }

  private overview(ledgerId: number) {
    const t = this.db.trips.find((x) => x.ledgerId === ledgerId);
    if (!t) return null;
    const { balances, transfers } = this.balances(ledgerId);
    const exps = this.db.expenses.filter((x) => x.ledgerId === ledgerId);
    return {
      ledger: {
        id: ledgerId,
        title: t.title,
        baseCurrency: t.homeCurrency,
        kind: "split",
        tripId: t.id,
        archivedAt: null,
        createdAt: "2026-09-01T08:00:00.000Z",
        updatedAt: "2026-10-09T08:00:00.000Z",
      },
      myMemberId: t.travelers.find((x) => x.userId === this.db.user.id)?.id ?? null,
      members: t.travelers.map((m) => ({ id: m.id, displayName: m.displayName, email: null, userId: m.userId, coupleId: m.coupleId ?? null, inviteToken: m.shareToken })),
      couples: ledgerId === 1 ? this.db.couples : [],
      totals: { expenseMinor: exps.reduce((n, e) => n + e.amountBaseMinor, 0), incomeMinor: 0, netMinor: 0, count: exps.length },
      balances,
      suggestedTransfers: transfers,
      payerDebts: transfers,
      steps: [],
    };
  }

  /** Tagesrolle wie der Server (Vertrag «Tagesrolle mehrtägiger Ereignisse»). */
  private withRole(e: TripEvent, date: string): TripEvent {
    const multi = e.endDate && e.startDate && e.endDate > e.startDate && ["Hotel", "Unterkunft", "Mietauto", "Visum"].includes(e.type);
    if (!multi) return { ...e, dayRole: "single", displayTime: e.startTime, displayLabel: null };
    const stay = e.type === "Hotel" || e.type === "Unterkunft";
    if (date === e.startDate) return { ...e, dayRole: "start", displayTime: e.startTime, displayLabel: stay ? "Check-in" : "Abholung" };
    if (date === e.endDate) return { ...e, dayRole: "end", displayTime: e.endTime, displayLabel: stay ? "Check-out" : "Rückgabe" };
    return { ...e, dayRole: "middle", displayTime: null, displayLabel: stay ? "Aufenthalt" : "Unterwegs" };
  }

  private todayState(date: string, tripId?: number) {
    const t = tripId != null ? this.trip(tripId) : this.db.trips.find((x) => this.phaseOf(x) === "active");
    const now = new Date();
    if (!t) {
      const up = this.db.trips.filter((x) => x.startDate && x.startDate > date).sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0];
      return {
        generatedAt: now.toISOString(),
        trip: null,
        upcoming: up ? { id: up.id, title: up.title, startDate: up.startDate, daysUntil: 1 } : null,
        date,
        next: null,
        nextInSeconds: null,
        events: [],
        tomorrow: [],
        tasks: [],
        deadlines: [],
        review: 0,
        ledger: null,
      };
    }
    const confirmed = t.events.filter((e) => !e.status || e.status === "confirmed");
    const touches = (e: TripEvent, d: string) => e.startDate === d || (e.startDate != null && e.endDate != null && e.startDate <= d && d <= e.endDate);
    const events = confirmed
      .filter((e) => touches(e, date))
      .map((e) => this.withRole(e, date))
      .sort((a, b) => {
        if ((a.dayRole === "middle") !== (b.dayRole === "middle")) return a.dayRole === "middle" ? 1 : -1;
        return (a.displayTime ?? "00") < (b.displayTime ?? "00") ? -1 : 1;
      });
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    // Für die Demo steht «jetzt» mindestens zwei Stunden vor dem ersten Termin, damit ein Countdown läuft.
    const withTime = events.filter((e) => e.displayTime);
    let next: TripEvent | null = withTime.find((e) => toMin(e.displayTime!) >= nowMin) ?? withTime[withTime.length - 1] ?? null;
    let secs: number | null = null;
    if (next) {
      const diff = (toMin(next.displayTime!) - nowMin) * 60 - now.getSeconds();
      secs = diff >= 0 ? diff : 2 * 3600 + 40 * 60;
    }
    if (next && secs === null) next = null;
    const idx = t.startDate ? Math.round((Date.parse(date) - Date.parse(t.startDate)) / 86_400_000) + 1 : 1;
    const bal = this.balances(t.ledgerId).balances.find((b) => b.memberId === t.travelers.find((x) => x.userId === this.db.user.id)?.id);
    return {
      generatedAt: now.toISOString(),
      trip: {
        id: t.id,
        title: t.title,
        destination: t.destination,
        startDate: t.startDate,
        endDate: t.endDate,
        dayIndex: idx,
        dayCount: t.startDate && t.endDate ? Math.round((Date.parse(t.endDate) - Date.parse(t.startDate)) / 86_400_000) + 1 : 0,
        coverUrl: null,
        timezone: t.timezone,
      },
      date,
      now: { local: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, tz: t.timezone },
      next,
      nextInSeconds: secs,
      events,
      tomorrow: confirmed.filter((e) => touches(e, addDays(date, 1))).map((e) => this.withRole(e, addDays(date, 1))),
      tasks: confirmed.filter((e) => e.type === "Aufgabe" && e.details.done !== true).map((e) => ({ eventId: e.id, title: e.title, dueDate: e.startDate })),
      deadlines: confirmed.filter((e) => e.cancelUntil).map((e) => ({ eventId: e.id, title: `${e.title}: kostenlos stornierbar`, kind: "cancel" as const, date: e.cancelUntil! })),
      review: t.events.filter((e) => e.status && e.status !== "confirmed").length,
      ledger: { id: t.ledgerId, balanceMinor: bal?.netMinor ?? 0, currency: t.homeCurrency },
    };
  }

  /** Verarbeitet eine Anfrage; `null` = nicht gemockt (geht an den echten Server). */
  async handle(method: string, url: URL, body: unknown, form: FormData | null): Promise<Reply | null> {
    const path = url.pathname;
    const q = url.searchParams;
    const m = (re: RegExp) => re.exec(path);
    const key = `${method} ${path}`;
    if (this.failOnce.has(key)) {
      this.failOnce.delete(key);
      return err(500, "internal", "Simulierter Serverfehler");
    }
    let r: RegExpExecArray | null;

    // Auth, Konto
    if (method === "POST" && path === "/v1/auth/login") {
      const b = body as { username?: string; password?: string };
      if (!b?.password) return err(401, "invalid_credentials", "Benutzername oder Passwort ist falsch.");
      return ok({ token: "tb_mock_token", user: this.db.user });
    }
    if (method === "POST" && path === "/v1/auth/logout") return ok({ ok: true });
    if (method === "GET" && path === "/v1/me") return ok({ user: this.db.user });
    if (method === "GET" && path === "/v1/me/devices")
      return ok({
        devices: [
          { id: 1, name: "Web-Browser", platform: "web", createdAt: "2026-10-01T08:00:00.000Z", lastUsedAt: new Date().toISOString(), push: false, current: true },
          { id: 2, name: "iPhone von Rolf", platform: "ios", appVersion: "0.1.0", createdAt: "2026-09-20T08:00:00.000Z", lastUsedAt: "2026-10-10T18:30:00.000Z", push: true, current: false },
        ],
      });
    if (path === "/v1/me/notification-prefs") {
      this.prefs = { ...this.prefs, ...(method === "PUT" ? (body as object) : {}) };
      return ok({ prefs: this.prefs });
    }
    if (method === "GET" && path === "/v1/users/directory")
      return ok({ users: [{ id: 1, displayName: "Rolf" }, { id: 2, displayName: "Valentyna" }, { id: 3, displayName: "Eliane" }] });
    if (method === "GET" && path === "/v1/users")
      return ok({ users: [{ id: 1, username: "rolf", displayName: "Rolf", email: "rolf@example.test", isAdmin: true, active: true }] });
    if (method === "GET" && path === "/v1/currencies")
      return ok({ currencies: ["CHF", "EUR", "USD", "GBP"].map((code) => ({ code, name: code, exponent: 2 })) });
    if (method === "GET" && path === "/v1/fx") return ok({ from: q.get("from"), to: q.get("to"), rate: 0.94, date: q.get("date") ?? this.today, source: "ECB" });

    // Meta, Version, Karten
    if (method === "GET" && path === "/v1/meta/event-types") return ok(bundledCatalog);
    if (method === "GET" && path === "/v1/meta/airports") {
      const s = (q.get("q") ?? "").toLowerCase();
      return ok({ airports: AIRPORTS.filter((a) => `${a.iata} ${a.name} ${a.city}`.toLowerCase().includes(s)) });
    }
    if (method === "GET" && path === "/v1/meta/timezone") return ok({ tz: "Europe/Zurich" });
    if (method === "GET" && path === "/v1/version") return ok({ name: "TravelBuddy", version: "0.1.0", build: "mock", builtAt: "2026-10-11T12:30:00.000Z", api: 1 });
    if (method === "GET" && path === "/v1/maps/token") return err(404, "maps_not_configured", "Apple Karten ist nicht eingerichtet.");
    if (path.startsWith("/v1/media/")) return err(404, "not_found", "Kein Bild");

    // Heute, Eingang
    if (method === "GET" && path === "/v1/today") return ok(this.todayState(q.get("date") ?? this.today));
    if ((r = m(/^\/v1\/trips\/(\d+)\/day\/(\d{4}-\d{2}-\d{2})$/)) && method === "GET") {
      if (!this.trip(Number(r[1]))) return err(404, "not_found", "Reise nicht gefunden.");
      return ok(this.todayState(r[2]!, Number(r[1])));
    }
    if (method === "GET" && path === "/v1/inbox") {
      const review = this.db.trips.flatMap((t) =>
        t.events.filter((e) => e.status && e.status !== "confirmed").map((event) => ({ tripId: t.id, tripTitle: t.title, event }))
      );
      return ok({ documents: this.db.documents.filter((d) => d.analysisStatus === "processing" || d.analysisStatus === "pending"), review });
    }

    // Reisen
    if (method === "GET" && path === "/v1/trips")
      return ok({
        trips: this.db.trips.map((t) => ({
          id: t.id,
          title: t.title,
          destination: t.destination,
          startDate: t.startDate,
          endDate: t.endDate,
          eventCount: t.events.length,
          documentCount: this.db.documents.filter((d) => d.tripIds.includes(t.id)).length,
          travelerCount: t.travelers.length,
          ledgerId: t.ledgerId,
          homeCurrency: t.homeCurrency,
          timezone: t.timezone,
          phase: this.phaseOf(t),
          needsReviewCount: t.events.filter((e) => e.status && e.status !== "confirmed").length,
          nextEvent: (() => {
            const n = t.events.filter((e) => (!e.status || e.status === "confirmed") && e.startDate && e.startDate >= this.today).sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0];
            return n ? { id: n.id, type: n.type, title: n.title, startDate: n.startDate!, startTime: n.startTime } : null;
          })(),
          coverUrl: null,
        })),
      });
    if (method === "POST" && path === "/v1/trips") {
      const b = body as Partial<MockTrip> & { travelers?: { displayName: string; userId?: number | null }[] };
      const id = this.db.nextId++;
      const t: MockTrip = {
        id,
        title: b.title ?? "Neue Reise",
        destination: b.destination ?? null,
        startDate: b.startDate ?? null,
        endDate: b.endDate ?? null,
        summary: b.summary ?? null,
        notes: null,
        homeCurrency: b.homeCurrency ?? "CHF",
        timezone: b.timezone ?? "Europe/Zurich",
        ledgerId: this.db.nextId++,
        travelers: [{ id: this.db.nextId++, displayName: this.db.user.displayName, email: null, userId: this.db.user.id, colorIndex: 0, shareToken: `tok_${id}` }],
        events: [],
      };
      this.db.trips.push(t);
      return ok(this.tripDetail(t), 201);
    }
    if ((r = m(/^\/v1\/trips\/(\d+)$/))) {
      const t = this.trip(Number(r[1]));
      if (!t) return err(404, "not_found", "Reise nicht gefunden.");
      if (method === "GET") return ok(this.tripDetail(t));
      if (method === "PATCH") {
        Object.assign(t, body);
        return ok(this.tripDetail(t));
      }
      if (method === "DELETE") {
        this.db.trips = this.db.trips.filter((x) => x.id !== t.id);
        return ok({ ok: true });
      }
    }
    if ((r = m(/^\/v1\/trips\/(\d+)\/ics$/))) return { status: 200, body: "BEGIN:VCALENDAR\nEND:VCALENDAR", type: "text/calendar" };
    if ((r = m(/^\/v1\/trips\/(\d+)\/travelers(?:\/(\d+))?(?:\/share\/(rotate|revoke))?$/))) {
      const t = this.trip(Number(r[1]));
      if (!t) return err(404, "not_found", "Reise nicht gefunden.");
      const b = body as { displayName?: string; userId?: number | null };
      if (method === "POST" && !r[2]) {
        t.travelers.push({ id: this.db.nextId++, displayName: b.displayName ?? "Gast", email: null, userId: b.userId ?? null, colorIndex: t.travelers.length % 8, shareToken: `tok_${this.db.nextId}` });
      } else if (r[2]) {
        const tr = t.travelers.find((x) => x.id === Number(r![2]));
        if (!tr) return err(404, "not_found", "Teilnehmer nicht gefunden.");
        if (r[3] === "rotate") tr.shareToken = `tok_${this.db.nextId++}`;
        else if (r[3] === "revoke") tr.shareToken = null;
        else if (method === "PATCH") Object.assign(tr, b);
        else if (method === "DELETE") t.travelers = t.travelers.filter((x) => x.id !== tr.id);
      }
      return ok(this.tripDetail(t));
    }

    // Ereignisse
    if ((r = m(/^\/v1\/trips\/(\d+)\/events$/)) && method === "POST") {
      const t = this.trip(Number(r[1]));
      if (!t) return err(404, "not_found", "Reise nicht gefunden.");
      const b = body as Partial<TripEvent>;
      const e = this.newEvent(t.id, b);
      t.events.push(e);
      return ok({ ...this.tripDetail(t), eventId: e.id }, 201);
    }
    if ((r = m(/^\/v1\/trips\/(\d+)\/events\/reorder$/)) && method === "POST") {
      const t = this.trip(Number(r[1]))!;
      const ids = (body as { ids: number[] }).ids;
      ids.forEach((id, i) => {
        const e = t.events.find((x) => x.id === id);
        if (e) e.sortKey = (i + 1) * 10;
      });
      return ok(this.tripDetail(t));
    }
    if ((r = m(/^\/v1\/trips\/(\d+)\/events\/(\d+)(?:\/(confirm|merge|comments|documents))?(?:\/(\d+))?$/))) {
      const t = this.trip(Number(r[1]));
      const e = t?.events.find((x) => x.id === Number(r![2]));
      if (!t || !e) return err(404, "not_found", "Ereignis nicht gefunden.");
      const sub = r[3];
      if (!sub) {
        if (method === "PATCH") {
          const b = body as Partial<TripEvent>;
          // Von Hand gesetzte Felder werden gesperrt
          for (const k of Object.keys(b)) if (k !== "details") e.fieldsMeta = { ...e.fieldsMeta, [k]: { source: "manual", locked: true } };
          if (b.details) for (const k of Object.keys(b.details)) e.fieldsMeta = { ...e.fieldsMeta, [`details.${k}`]: { source: "manual", locked: true } };
          Object.assign(e, b);
          return ok(this.tripDetail(t));
        }
        if (method === "DELETE") {
          t.events = t.events.filter((x) => x.id !== e.id);
          return ok(this.tripDetail(t));
        }
      }
      if (sub === "confirm") {
        e.status = "confirmed";
        return ok(this.tripDetail(t));
      }
      if (sub === "merge") {
        const into = t.events.find((x) => x.id === (body as { intoEventId: number }).intoEventId);
        if (into) {
          for (const k of ["location", "address", "provider", "bookingReference", "startTime", "endTime"] as const) {
            if (!into[k] && e[k]) (into as unknown as Record<string, unknown>)[k] = e[k];
          }
          into.documentIds = [...new Set([...into.documentIds, ...e.documentIds])];
          into.documents = [...(into.documents ?? []), ...(e.documents ?? [])];
          t.events = t.events.filter((x) => x.id !== e.id);
        }
        return ok(this.tripDetail(t));
      }
      if (sub === "comments") {
        if (method === "POST") {
          const c = { id: this.db.nextId++, eventId: e.id, userId: this.db.user.id, author: this.db.user.displayName, body: (body as { body: string }).body, createdAt: new Date().toISOString() };
          e.comments.push(c);
          return ok({ comment: c }, 201);
        }
        if (method === "DELETE") {
          e.comments = e.comments.filter((c) => c.id !== Number(r![4]));
          return ok({ ok: true });
        }
      }
      if (sub === "documents") {
        if (method === "POST") {
          const id = (body as { documentId: number }).documentId;
          if (!e.documentIds.includes(id)) e.documentIds.push(id);
        } else if (method === "DELETE") {
          const id = Number(r[4]);
          e.documentIds = e.documentIds.filter((x) => x !== id);
          e.documents = (e.documents ?? []).filter((x) => x.id !== id);
        }
        return ok(this.tripDetail(t));
      }
    }

    // Dokumente
    if ((r = m(/^\/v1\/trips\/(\d+)\/documents$/))) {
      const t = this.trip(Number(r[1]));
      if (!t) return err(404, "not_found", "Reise nicht gefunden.");
      if (method === "GET") return ok({ documents: this.db.documents.filter((d) => d.tripIds.includes(t.id)).map(stripDoc) });
      if (method === "POST" && form) {
        const file = form.get("file");
        const eventId = form.get("eventId");
        const name = file instanceof File ? file.name : "Dokument.pdf";
        const id = this.db.nextId++;
        const d = { ...mkDoc(id, name.replace(/\.[^.]+$/, ""), t.id, eventId ? Number(eventId) : null, "processing", 1), fileName: name, sizeBytes: file instanceof File ? file.size : 1000, createdAt: new Date().toISOString() };
        this.db.documents.unshift(d);
        return ok({ document: stripDoc(d) }, 202);
      }
    }
    if ((r = m(/^\/v1\/documents\/(\d+)(?:\/(file|thumbnail|analyze))?$/))) {
      const d = this.db.documents.find((x) => x.id === Number(r![1]));
      if (!d) return err(404, "document_not_found", "Dokument nicht gefunden.");
      if (r[2] === "file") return { status: 200, body: samplePdf(d.title), type: "application/pdf" };
      if (r[2] === "thumbnail") return { status: 200, body: THUMB(d.title), type: "image/svg+xml" };
      if (r[2] === "analyze" && method === "POST") {
        d.analysisStatus = "processing";
        d._polls = 0;
        return ok({ document: stripDoc(d) }, 202);
      }
      if (method === "DELETE") {
        this.db.documents = this.db.documents.filter((x) => x.id !== d.id);
        return ok({ ok: true });
      }
      // Auswertung läuft: nach drei Abfragen fertig, legt einen Vorschlag an
      if (d.analysisStatus === "processing" || d.analysisStatus === "pending") {
        d._polls += 1;
        if (d._polls >= 3) {
          d.analysisStatus = "done";
          const t = this.trip(d._tripId);
          if (t && !t.events.some((e) => e.sourceDocumentId === d.id)) {
            const ne = this.newEvent(t.id, {
              type: "Flug",
              title: `Flug aus ${d.title}`,
              startDate: addDays(this.today, 5),
              startTime: "09:10",
              status: "proposed",
              bookingReference: "ZX81PQ",
              sourceDocumentId: d.id,
              documentIds: [d.id],
              documents: [{ id: d.id, title: d.title }],
              details: { airline: "Swiss", flightNumber: "LX 2038", departureAirport: "BCN", arrivalAirport: "ZRH" },
              fieldsMeta: { title: { source: "document", confidence: 0.93, documentId: d.id, page: 1, quote: "Flug LX 2038 Barcelona - Zuerich, 09:10, Buchungscode ZX81PQ" } },
            });
            t.events.push(ne);
            d.eventIds = [ne.id];
          }
        }
      }
      return ok({ document: stripDoc(d) });
    }

    // Reisekasse
    if ((r = m(/^\/v1\/ledgers\/(\d+)(?:\/(expenses|settlements|couples|members))?(?:\/(\d+))?(?:\/(settle-couple))?$/))) {
      const id = Number(r[1]);
      const ov = this.overview(id);
      if (!ov) return err(404, "not_found", "Reisekasse nicht gefunden.");
      if (!r[2] && method === "GET") return ok(ov);
      if (r[2] === "expenses") {
        if (method === "GET" && !r[3]) return ok({ expenses: this.db.expenses.filter((e) => e.ledgerId === id) });
        if (method === "POST") {
          const b = body as Partial<Expense> & { split?: { mode: string; memberIds?: number[] }; tripEventId?: number };
          const t = this.db.trips.find((x) => x.ledgerId === id)!;
          const ids = b.split?.memberIds?.length ? b.split.memberIds : t.travelers.map((x) => x.id);
          const rate = b.currency && b.currency !== t.homeCurrency ? 0.94 : 1;
          const base = Math.round((b.amountMinor ?? 0) * rate);
          const e: Expense = {
            id: this.db.nextId++,
            ledgerId: id,
            paidByMemberId: b.paidByMemberId ?? ov.myMemberId ?? t.travelers[0]!.id,
            createdByMemberId: ov.myMemberId,
            direction: "expense",
            amountMinor: b.amountMinor ?? 0,
            currency: b.currency ?? t.homeCurrency,
            exchangeRate: rate,
            amountBaseMinor: base,
            description: b.description ?? null,
            expenseDate: b.expenseDate ?? this.today,
            category: b.category ?? null,
            note: b.note ?? null,
            splitMode: "equal",
            settledStatus: 0,
            tripEventId: b.tripEventId ?? null,
            splits: [...splitEqual(base, ids)].map(([memberId, shareBaseMinor]) => ({ memberId, shareBaseMinor, shareUnits: null })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          this.db.expenses.push(e);
          if (b.tripEventId) {
            const ev = t.events.find((x) => x.id === b.tripEventId);
            if (ev) ev.expenseId = e.id;
          }
          return ok({ expense: e }, 201);
        }
        if (method === "DELETE") {
          this.db.expenses = this.db.expenses.filter((e) => e.id !== Number(r![3]));
          return ok({ ok: true });
        }
        if (method === "PATCH") {
          const e = this.db.expenses.find((x) => x.id === Number(r![3]));
          if (e) Object.assign(e, body);
          return ok({ expense: e });
        }
      }
      if (r[2] === "settlements") {
        if (method === "GET") return ok({ settlements: [] });
        if (method === "POST") return ok({ settlement: { id: this.db.nextId++, ledgerId: id, ...(body as object), createdAt: new Date().toISOString() } }, 201);
      }
      if (r[2] === "couples") return ok({ ok: true });
      return ok(ov);
    }

    // Gäste
    if ((r = m(/^\/v1\/guest\/trips\/([^/]+)$/)) && method === "GET") {
      const t = this.db.trips.find((x) => x.travelers.some((y) => y.shareToken === r![1]));
      if (!t) return err(404, "not_found", "Link ungültig.");
      const me = t.travelers.find((y) => y.shareToken === r![1])!;
      const d = this.tripDetail(t);
      return ok({ ...d, travelers: d.travelers.map((x) => ({ ...x, shareToken: undefined })), me: { travelerId: me.id, displayName: me.displayName } });
    }
    if ((r = m(/^\/v1\/guest\/trips\/([^/]+)\/events\/(\d+)\/comments$/)) && method === "POST") {
      const t = this.db.trips.find((x) => x.travelers.some((y) => y.shareToken === r![1]));
      const e = t?.events.find((x) => x.id === Number(r![2]));
      if (!t || !e) return err(404, "not_found", "Nicht gefunden.");
      const me = t.travelers.find((y) => y.shareToken === r![1])!;
      const c = { id: this.db.nextId++, eventId: e.id, userId: null, author: me.displayName, body: (body as { body: string }).body, createdAt: new Date().toISOString() };
      e.comments.push(c);
      return ok({ comment: c }, 201);
    }
    if ((r = m(/^\/v1\/guest\/([^/]+)$/)) && method === "GET") {
      const t = this.db.trips.find((x) => x.travelers.some((y) => y.shareToken === r![1]));
      if (!t) return err(404, "not_found", "Link ungültig.");
      const me = t.travelers.find((y) => y.shareToken === r![1])!;
      const ov = this.overview(t.ledgerId)!;
      return ok({ ...ov, me: { memberId: me.id, displayName: me.displayName }, expenses: this.db.expenses.filter((e) => e.ledgerId === t.ledgerId), settlements: [] });
    }
    return null;
  }

  private newEvent(tripId: number, b: Partial<TripEvent>): TripEvent {
    const id = this.db.nextId++;
    return {
      id,
      tripId,
      type: b.type ?? "Ausflug",
      title: b.title ?? "Ereignis",
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      startTz: null,
      endTz: null,
      location: null,
      address: null,
      provider: null,
      bookingReference: null,
      website: null,
      phone: null,
      lat: null,
      lon: null,
      notes: null,
      details: {},
      sortKey: id * 10,
      documentIds: [],
      documents: [],
      comments: [],
      status: "confirmed",
      participantIds: [],
      priceMinor: null,
      currency: null,
      paymentStatus: null,
      paidByParticipantId: null,
      cancelUntil: null,
      expenseId: null,
      fieldsMeta: {},
      sourceDocumentId: null,
      places: [],
      ...b,
    };
  }
}

function stripDoc(d: MockDb["documents"][number]): DocumentItem {
  const { _polls, _tripId, _eventId, ...rest } = d;
  void _polls;
  void _tripId;
  void _eventId;
  return rest;
}
