import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Db } from "../db/client";
import type { AppEnv } from "../app";
import { parseWith, readJson } from "../lib/validate";
import { badRequest, forbidden } from "../lib/errors";
import * as T from "./service";
import { EVENT_STATUSES, PAYMENT_STATUSES, TRIP_STATUSES } from "./service";
import type { Notifier } from "../push/notifier";
import type { Background } from "../lib/background";
import type { MediaService } from "../media/generate";
import type { Geocoder } from "../geo/geocode";
import { geocodeEvent, autoGeocodeEvent } from "../geo/event-geocode";
import { createExpenseFromEvent } from "./event-expense";
import type { FetchLike } from "../ledgers/fx";
import { dayView } from "./today";

const id = z.coerce.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "erwartet YYYY-MM-DD");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "erwartet HH:mm");
const text = (max: number) => z.string().max(max);
const coord = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

const eventFields = {
  type: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  startTime: clock.nullable(),
  endTime: clock.nullable(),
  startTz: text(64).nullable(),
  endTz: text(64).nullable(),
  location: text(300).nullable(),
  address: text(300).nullable(),
  provider: text(200).nullable(),
  bookingReference: text(100).nullable(),
  website: text(500).nullable(),
  phone: text(60).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  notes: text(10_000).nullable(),
  // Schlüssel und Werte prüft der Katalog (422 `invalid_details`).
  details: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(EVENT_STATUSES),
  priceMinor: z.number().int().safe().min(0).nullable(),
  currency: z.string().trim().length(3).nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
  paidByParticipantId: id.nullable(),
  cancelUntil: isoDate.nullable(),
  participantIds: z.array(id).max(60),
  placeCoords: z.record(z.string(), coord.nullable()),
  fieldsMeta: z.record(z.string(), z.object({ locked: z.boolean().optional() }).nullable()),
};
const eventCreate = z.object({ ...eventFields }).partial().required({ title: true });
const eventPatch = z.object({ ...eventFields }).partial();

export function tripRoutes(deps: {
  db: Db;
  now: () => Date;
  notifier: Notifier;
  background: Background;
  /** KI-Bilder im Hintergrund erzeugen (optional; ohne Dienst entfällt es). */
  media?: MediaService;
  geocoder?: Geocoder | null;
  fetch?: FetchLike;
}) {
  const { db } = deps;

  const param = (c: Context<AppEnv>, name: string) => {
    const v = id.safeParse(c.req.param(name));
    if (!v.success) throw badRequest(`Ungültiger Parameter ${name}`);
    return v.data;
  };
  const jsonBody = async <S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> =>
    parseWith(await readJson(c.req), schema);
  const detail = (tripId: number) => T.tripDetail(db, tripId, { includeShareTokens: true, now: deps.now() });

  /* ─ Gäste (Teilnehmer-Link, ohne Konto) ─ */
  const publicRoutes = new Hono<AppEnv>();
  publicRoutes.get("/v1/guest/trips/:token", (c) => c.json(T.guestTripView(db, c.req.param("token"), deps.now())));
  publicRoutes.post("/v1/guest/trips/:token/events/:eventId/comments", async (c) => {
    const { body } = await jsonBody(c, z.object({ body: z.string().trim().min(1).max(2000) }));
    const token = c.req.param("token");
    const eventId = param(c, "eventId");
    const comment = T.guestAddComment(db, token, eventId, body);
    const g = T.tripOfShareToken(db, token);
    deps.background.run(
      deps.notifier.tripComment({
        tripId: g.trip.id,
        eventId,
        commentId: comment.id,
        actorUserId: comment.userId,
        actorName: comment.author,
        body: comment.body,
      })
    );
    return c.json({ comment }, 201);
  });

  /* ─ Mit Konto ─ */
  const authed = new Hono<AppEnv>();
  const access = (c: Context<AppEnv>) => {
    const tripId = param(c, "id");
    T.assertTripAccess(db, c.get("user"), tripId);
    return tripId;
  };

  authed.get("/v1/trips", (c) => c.json({ trips: T.listTrips(db, c.get("user"), deps.now()) }));

  authed.post("/v1/trips", async (c) => {
    const input = await jsonBody(
      c,
      z.object({
        title: z.string().trim().min(1).max(200),
        destination: text(200).nullish(),
        startDate: isoDate.nullish(),
        endDate: isoDate.nullish(),
        summary: text(2000).nullish(),
        notes: text(10_000).nullish(),
        status: z.enum(TRIP_STATUSES).optional(),
        homeCurrency: z.string().trim().length(3).optional(),
        timezone: text(64).optional(),
        travelers: z
          .array(z.object({ displayName: z.string().trim().min(1).max(100), email: z.string().email().nullish(), userId: id.nullish() }))
          .max(30)
          .optional(),
      })
    );
    const tripId = T.createTrip(db, c.get("user"), input);
    deps.media?.schedule("trip_cover", tripId);
    return c.json(detail(tripId), 201);
  });

  authed.get("/v1/trips/:id", (c) => {
    const tripId = access(c);
    // Reiseteilnehmer ohne Adminrechte sehen weder Gäste-Links noch E-Mail-Adressen oder Dokumenttitel.
    return c.json(
      c.get("user").isAdmin
        ? detail(tripId)
        : T.tripDetail(db, tripId, { includeShareTokens: false, includeDocumentTitles: false, includeMedia: true, now: deps.now() })
    );
  });

  authed.patch("/v1/trips/:id", async (c) => {
    const tripId = access(c);
    const patch = await jsonBody(
      c,
      z
        .object({
          title: z.string().trim().min(1).max(200),
          destination: text(200).nullable(),
          startDate: isoDate.nullable(),
          endDate: isoDate.nullable(),
          summary: text(2000).nullable(),
          notes: text(10_000).nullable(),
          status: z.enum(TRIP_STATUSES),
          homeCurrency: z.string().trim().length(3),
          timezone: text(64),
        })
        .partial()
    );
    T.updateTrip(db, tripId, patch);
    return c.json(detail(tripId));
  });

  authed.delete("/v1/trips/:id", (c) => {
    const tripId = access(c);
    const withLedger = ["1", "true"].includes(new URL(c.req.url).searchParams.get("withLedger") ?? "");
    T.deleteTrip(db, tripId, { withLedger });
    return c.json({ ok: true });
  });

  authed.post("/v1/trips/:id/travelers", async (c) => {
    const tripId = access(c);
    const input = await jsonBody(
      c,
      z.object({ displayName: z.string().trim().min(1).max(100), email: z.string().email().nullish(), userId: id.nullish() })
    );
    T.addTraveler(db, tripId, input);
    return c.json(detail(tripId), 201);
  });

  authed.patch("/v1/trips/:id/travelers/:travelerId", async (c) => {
    const tripId = access(c);
    const patch = await jsonBody(
      c,
      z
        .object({
          displayName: z.string().trim().min(1).max(100),
          email: z.string().email().nullable(),
          userId: id.nullable(),
          coupleId: id.nullable(),
        })
        .partial()
    );
    T.updateTraveler(db, tripId, param(c, "travelerId"), patch);
    return c.json(detail(tripId));
  });

  authed.delete("/v1/trips/:id/travelers/:travelerId", (c) => {
    const tripId = access(c);
    T.removeTraveler(db, tripId, param(c, "travelerId"));
    return c.json(detail(tripId));
  });

  authed.post("/v1/trips/:id/travelers/:travelerId/share/rotate", (c) => {
    const tripId = access(c);
    T.rotateTravelerShare(db, tripId, param(c, "travelerId"), false);
    return c.json(detail(tripId));
  });

  authed.post("/v1/trips/:id/travelers/:travelerId/share/revoke", (c) => {
    const tripId = access(c);
    T.rotateTravelerShare(db, tripId, param(c, "travelerId"), true);
    return c.json(detail(tripId));
  });

  /* ─ Ereignisse ─ */

  const autoGeocode = (tripId: number, eventId: number) => {
    if (deps.geocoder) deps.background.run(autoGeocodeEvent(db, deps.geocoder, tripId, eventId));
  };

  authed.post("/v1/trips/:id/events", async (c) => {
    const tripId = access(c);
    const input = await jsonBody(c, eventCreate);
    const e = T.createEvent(db, tripId, input as T.EventInput);
    deps.media?.schedule("event_image", e.id);
    autoGeocode(tripId, e.id);
    return c.json({ eventId: e.id, ...detail(tripId) }, 201);
  });

  authed.post("/v1/trips/:id/events/reorder", async (c) => {
    const tripId = access(c);
    const { ids } = await jsonBody(c, z.object({ ids: z.array(id).min(1) }));
    T.reorderEvents(db, tripId, ids);
    return c.json(detail(tripId));
  });

  authed.patch("/v1/trips/:id/events/:eventId", async (c) => {
    const tripId = access(c);
    const patch = await jsonBody(c, eventPatch);
    const eventId = param(c, "eventId");
    T.updateEvent(db, tripId, eventId, patch as T.EventInput);
    autoGeocode(tripId, eventId);
    return c.json(detail(tripId));
  });

  authed.delete("/v1/trips/:id/events/:eventId", (c) => {
    const tripId = access(c);
    T.deleteEvent(db, tripId, param(c, "eventId"));
    return c.json(detail(tripId));
  });

  /** Vorschlag bestätigen (`status → confirmed`). */
  authed.post("/v1/trips/:id/events/:eventId/confirm", (c) => {
    const tripId = access(c);
    T.confirmEvent(db, tripId, param(c, "eventId"));
    return c.json(detail(tripId));
  });

  /** Vorschlag in ein vorhandenes Ereignis einarbeiten (nur leere Felder), der Vorschlag entfällt. */
  authed.post("/v1/trips/:id/events/:eventId/merge", async (c) => {
    const tripId = access(c);
    const { intoEventId } = await jsonBody(c, z.object({ intoEventId: id }));
    T.mergeEvent(db, tripId, param(c, "eventId"), intoEventId);
    return c.json({ eventId: intoEventId, ...detail(tripId) });
  });

  /** Adressen des Ereignisses auflösen (Apple Maps Server API oder Nominatim) und Koordinaten speichern. */
  authed.post("/v1/trips/:id/events/:eventId/geocode", async (c) => {
    const tripId = access(c);
    const eventId = param(c, "eventId");
    const body = await c.req.text();
    let force = false;
    if (body.trim()) {
      try {
        force = Boolean((JSON.parse(body) as { force?: unknown }).force);
      } catch {
        throw badRequest("Ungültiger JSON-Body", "invalid_json");
      }
    }
    const results = await geocodeEvent(db, deps.geocoder ?? null, tripId, eventId, { force });
    return c.json({ eventId, results, ...detail(tripId) });
  });

  /** Ausgabe aus dem Preis des Ereignisses anlegen (Betrag, Währung, Zahler, Aufteilung vorbelegt). */
  authed.post("/v1/trips/:id/events/:eventId/expense", async (c) => {
    const tripId = access(c);
    const eventId = param(c, "eventId");
    const raw = await c.req.text();
    let input: unknown = {};
    if (raw.trim()) {
      try {
        input = JSON.parse(raw);
      } catch {
        throw badRequest("Ungültiger JSON-Body", "invalid_json");
      }
    }
    const b = parseWith(
      input,
      z.object({
        paidByMemberId: id.optional(),
        exchangeRate: z.number().positive().optional(),
        expenseDate: isoDate.nullish(),
        preSettled: z.boolean().optional(),
        memberIds: z.array(id).max(60).optional(),
      })
    );
    const r = await createExpenseFromEvent(db, c.get("user"), tripId, eventId, b, { fetch: deps.fetch, now: deps.now });
    return c.json({ expenseId: r.expenseId, expense: r.expense, ...detail(tripId) }, 201);
  });

  /* ─ Dokumente an Ereignissen ─ */

  authed.post("/v1/trips/:id/events/:eventId/documents", async (c) => {
    const tripId = access(c);
    if (!c.get("user").isAdmin) throw forbidden("Dokumente verknüpfen ist Administratoren vorbehalten");
    const { documentId } = await jsonBody(c, z.object({ documentId: id }));
    T.linkDocument(db, tripId, param(c, "eventId"), documentId);
    return c.json(detail(tripId));
  });

  authed.delete("/v1/trips/:id/events/:eventId/documents/:documentId", (c) => {
    const tripId = access(c);
    if (!c.get("user").isAdmin) throw forbidden("Dokumente verknüpfen ist Administratoren vorbehalten");
    T.unlinkDocument(db, tripId, param(c, "eventId"), param(c, "documentId"));
    return c.json(detail(tripId));
  });

  /* ─ Kommentare ─ */

  authed.post("/v1/trips/:id/events/:eventId/comments", async (c) => {
    const tripId = access(c);
    const u = c.get("user");
    const { body } = await jsonBody(c, z.object({ body: z.string().trim().min(1).max(2000) }));
    const eventId = param(c, "eventId");
    const comment = T.addComment(db, tripId, eventId, { userId: u.id, name: u.displayName }, body);
    deps.background.run(
      deps.notifier.tripComment({ tripId, eventId, commentId: comment.id, actorUserId: u.id, actorName: u.displayName, body })
    );
    return c.json({ comment }, 201);
  });

  authed.delete("/v1/trips/:id/events/:eventId/comments/:commentId", (c) => {
    const tripId = access(c);
    T.deleteComment(db, tripId, param(c, "eventId"), param(c, "commentId"), c.get("user"));
    return c.json({ ok: true });
  });

  /* ─ Tag, Kalender, Reisekasse ─ */

  /** Ein Tag der Reise (gleiche Form wie `GET /v1/today`, aber auf Reise und Datum festgelegt). */
  authed.get("/v1/trips/:id/day/:date", (c) => {
    const tripId = access(c);
    const date = isoDate.safeParse(c.req.param("date"));
    if (!date.success) throw badRequest("Datum erwartet YYYY-MM-DD");
    return c.json(dayView(db, c.get("user"), { tripId, date: date.data, now: deps.now() }));
  });

  authed.get("/v1/trips/:id/ics", (c) => {
    const tripId = access(c);
    const trip = T.getTrip(db, tripId);
    const safe = trip.title.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "reise";
    // RFC 6266/5987: ASCII-Fallback plus UTF-8-Name, damit Umlaute korrekt ankommen.
    const ascii =
      safe
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^\x20-\x7e]/g, "_") || "reise";
    return new Response(T.tripIcs(db, tripId, deps.now()), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${ascii}.ics"; filename*=UTF-8''${encodeURIComponent(safe)}.ics`,
      },
    });
  });

  /** Reisekassen sind immer verknüpft; die Route löst nichts mehr, sagt es aber deutlich. */
  authed.delete("/v1/trips/:id/ledger", (c) => {
    access(c);
    throw badRequest("Die Reisekasse gehört zur Reise und lässt sich nicht lösen", "ledger_of_trip");
  });

  /** Für Altdaten: liefert die (automatisch angelegte) Reisekasse der Reise, legt nichts Neues an. */
  authed.post("/v1/trips/:id/ledger", (c) => {
    const tripId = access(c);
    const ledgerId = T.ledgerIdOfTrip(db, tripId);
    if (ledgerId == null) throw badRequest("Zur Reise gehört keine Reisekasse", "no_ledger");
    return c.json({ ledgerId }, 200);
  });

  return { publicRoutes, authed };
}
