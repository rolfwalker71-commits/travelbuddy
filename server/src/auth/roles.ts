import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import type { Db } from "../db/client";
import * as L from "../ledgers/service";
import { forbidden, notFound } from "../lib/errors";

/**
 * Rollenmodell: Administratoren dürfen alles. Alle anderen Konten sind «Mitreisende mit Konto». Sie sehen nur
 * Reisen, auf denen sie als Teilnehmer eingetragen sind, und dürfen dort
 *   - die Reise, die Ereignisse und den Kalender lesen, kommentieren, «Heute» und die Zusammenfassung abrufen,
 *   - die Reisekasse lesen sowie Ausgaben und Rückzahlungen erfassen (wie Gäste per Link; Ausgaben ändern oder
 *     löschen nur die eigenen, Rückzahlungen löschen nur Administratoren),
 *   - Dokumente der Reise lesen (Liste, Detail, Original, Vorschau) und hochladen,
 *   - die Inbox der eigenen Reisen sehen (Dokumente in Arbeit, Vorschläge zu prüfen).
 * Nicht erlaubt: Reisen anlegen oder ändern, Ereignisse anlegen/bearbeiten/löschen, Teilnehmer und Gäste-Links
 * verwalten, Benutzerverwaltung, Push-Diagnose, Dokumente löschen oder neu analysieren, «Einwurf» ohne Reise.
 * Gäste ohne Konto laufen über Links (`/v1/guest/…`) und sind davon nicht betroffen.
 *
 * Bewusst als Positivliste: Eine neue Route ist für Nicht-Admins gesperrt, bis sie hier steht. Die Positivliste
 * sagt nur «Methode und Pfad sind für Mitreisende vorgesehen»; die Zugehörigkeit zur Reise prüft die Route
 * selbst bzw. `participantAccess` (Dokumente, Inbox, eigene Ausgaben).
 */
const RULES: Array<[method: string, path: RegExp]> = [
  // Eigenes Konto
  ["GET", /^\/v1\/me$/],
  ["POST", /^\/v1\/auth\/logout$/],
  ["POST", /^\/v1\/me\/password$/],
  ["GET", /^\/v1\/me\/devices$/],
  ["DELETE", /^\/v1\/me\/devices\/\d+$/],
  ["PUT", /^\/v1\/devices\/current$/],
  ["GET", /^\/v1\/me\/notification-prefs$/],
  ["PUT", /^\/v1\/me\/notification-prefs$/],
  // Live Activities der eigenen Reisen (die Route prüft den Reisezugriff)
  ["PUT", /^\/v1\/live-activities\/[A-Za-z0-9._-]+$/],
  ["DELETE", /^\/v1\/live-activities\/[A-Za-z0-9._-]+$/],
  // Heute und Widgets (nur die eigenen Reisen)
  ["GET", /^\/v1\/today$/],
  ["GET", /^\/v1\/summary$/],
  // Apple Karten: kurzlebiges Kartentoken, Flughafensuche und Zeitzonen-Vorschlag
  ["GET", /^\/v1\/maps\/token$/],
  ["GET", /^\/v1\/meta\/airports$/],
  ["GET", /^\/v1\/meta\/timezone$/],
  // Eigene Reisen lesen und kommentieren (die Route prüft die Zugehörigkeit)
  ["GET", /^\/v1\/trips$/],
  ["GET", /^\/v1\/trips\/\d+$/],
  ["GET", /^\/v1\/trips\/\d+\/ics$/],
  ["GET", /^\/v1\/trips\/\d+\/day\/\d{4}-\d{2}-\d{2}$/],
  ["POST", /^\/v1\/trips\/\d+\/events\/\d+\/comments$/],
  ["DELETE", /^\/v1\/trips\/\d+\/events\/\d+\/comments\/\d+$/],
  // Reisekasse der eigenen Reisen: lesen, Ausgaben und Rückzahlungen erfassen (wie Gäste per Link)
  ["GET", /^\/v1\/ledgers$/],
  ["GET", /^\/v1\/ledgers\/\d+$/],
  ["GET", /^\/v1\/ledgers\/\d+\/expenses$/],
  ["POST", /^\/v1\/ledgers\/\d+\/expenses$/],
  ["GET", /^\/v1\/ledgers\/\d+\/expenses\/\d+$/],
  ["PATCH", /^\/v1\/ledgers\/\d+\/expenses\/\d+$/], // nur eigene (participantAccess)
  ["DELETE", /^\/v1\/ledgers\/\d+\/expenses\/\d+$/], // nur eigene (participantAccess)
  ["GET", /^\/v1\/ledgers\/\d+\/settlements$/],
  ["POST", /^\/v1\/ledgers\/\d+\/settlements$/],
  ["GET", /^\/v1\/currencies$/],
  ["GET", /^\/v1\/fx$/],
  // Dokumente der eigenen Reisen lesen und hochladen (participantAccess prüft die Zugehörigkeit)
  ["GET", /^\/v1\/trips\/\d+\/documents$/],
  ["POST", /^\/v1\/trips\/\d+\/documents$/],
  ["GET", /^\/v1\/documents\/\d+$/],
  ["GET", /^\/v1\/documents\/\d+\/file$/],
  ["HEAD", /^\/v1\/documents\/\d+\/file$/],
  ["GET", /^\/v1\/documents\/\d+\/thumbnail$/],
  // Inbox: nur Dokumente und Vorschläge der eigenen Reisen (participantAccess filtert)
  ["GET", /^\/v1\/inbox$/],
  // Reisebilder der eigenen Reisen (die Route prüft die Zugehörigkeit selbst und antwortet sonst mit 403)
  ["GET", /^\/v1\/media\/(trip_cover|event_image)\/\d+$/],
  ["HEAD", /^\/v1\/media\/(trip_cover|event_image)\/\d+$/],
  // Mitteilungsillustrationen (Notification-Service-Extension der Push-Mitteilung), hell und dunkel
  ["GET", /^\/v1\/media\/notification\/notif-[a-z]{2,20}(-dark)?$/],
];

export function nonAdminMayCall(method: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const m = method.toUpperCase();
  return RULES.some(([rm, re]) => rm === m && re.test(path));
}

/* ───────────── Zugehörigkeit zur Reise ───────────── */

/** Ist das Konto als Teilnehmer in der Reise eingetragen? */
export function isTripParticipant(db: Db, userId: number, tripId: number): boolean {
  return db.prepare("SELECT 1 FROM participants WHERE trip_id = ? AND user_id = ?").get(tripId, userId) != null;
}

/** Darf das Konto das Dokument sehen? Ja, wenn es an eine Reise (oder ein Ereignis einer Reise) des Kontos gehängt ist. */
export function canReadDocument(db: Db, userId: number, documentId: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM participants p
          WHERE p.user_id = ? AND p.trip_id IS NOT NULL AND (
                EXISTS (SELECT 1 FROM trip_documents td WHERE td.trip_id = p.trip_id AND td.document_id = ?)
             OR EXISTS (SELECT 1 FROM trip_event_documents ed JOIN trip_events e ON e.id = ed.trip_event_id
                         WHERE e.trip_id = p.trip_id AND ed.document_id = ?))
          LIMIT 1`
      )
      .get(userId, documentId, documentId) != null
  );
}

function ownTripIds(db: Db, userId: number): Set<number> {
  const rows = db.prepare("SELECT DISTINCT trip_id FROM participants WHERE user_id = ? AND trip_id IS NOT NULL").all(userId) as {
    trip_id: number;
  }[];
  return new Set(rows.map((r) => r.trip_id));
}

/**
 * Prüft für Mitreisende (Nicht-Admins) die Zugehörigkeit bei den freigegebenen Routen, die die zuständigen Module
 * als «Admin» führen (Dokumente, Inbox), und die «nur eigene»-Regel bei Ausgaben der Reisekasse.
 *
 * Läuft nach der Positivliste (`nonAdminMayCall`). Für Dokumente und Inbox hebt die Prüfung die Rolle für diese eine
 * Anfrage an (`isAdmin` im Kontext), nachdem der Zugriff feststeht; die Inbox wird danach auf die eigenen Reisen
 * gefiltert und enthält nur die bekannten Felder `documents` und `review`.
 */
export function participantAccess(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (user.isAdmin) return next();
    const method = c.req.method.toUpperCase();
    const path = new URL(c.req.url).pathname.replace(/\/+$/, "");
    const elevate = () => c.set("user", { ...user, isAdmin: true });

    let m: RegExpExecArray | null;

    // Dokumente einer Reise: lesen und hochladen
    if ((m = /^\/v1\/trips\/(\d+)\/documents$/.exec(path)) && (method === "GET" || method === "POST")) {
      const tripId = Number(m[1]);
      const trip = db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId);
      if (!trip) throw notFound("Reise");
      if (!isTripParticipant(db, user.id, tripId)) throw forbidden("Kein Zugriff auf diese Reise");
      elevate();
      return next();
    }

    // Einzelnes Dokument: Detail, Original, Vorschau
    if ((m = /^\/v1\/documents\/(\d+)(?:\/(file|thumbnail))?$/.exec(path)) && (method === "GET" || method === "HEAD")) {
      // Fremde und unbekannte Dokumente sind nicht unterscheidbar.
      if (!canReadDocument(db, user.id, Number(m[1]))) throw forbidden("Kein Zugriff auf dieses Dokument");
      elevate();
      return next();
    }

    // Inbox: nur Dokumente und Vorschläge der eigenen Reisen
    if (path === "/v1/inbox" && method === "GET") {
      elevate();
      await next();
      const own = ownTripIds(db, user.id);
      const res = c.res;
      if (res.status !== 200) return;
      const src = (await res.clone().json()) as { documents?: Array<{ tripIds?: number[] }>; review?: Array<{ tripId?: number }> };
      const filtered = {
        documents: (src.documents ?? []).filter((d) => (d.tripIds ?? []).some((t) => own.has(t))),
        review: (src.review ?? []).filter((r) => r.tripId != null && own.has(r.tripId)),
      };
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      c.res = new Response(JSON.stringify(filtered), { status: 200, headers });
      return;
    }

    // Reisekasse: nur die einer eigenen Reise. Eigenständige Kassen ohne Reise (Altdaten) bleiben Administratoren
    // vorbehalten; die Liste enthält für Mitreisende nur Kassen eigener Reisen.
    if (path === "/v1/ledgers" && method === "GET") {
      await next();
      const res = c.res;
      if (res.status !== 200) return;
      const own = ownTripIds(db, user.id);
      const src = (await res.clone().json()) as { ledgers?: Array<{ tripId?: number | null }> };
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      c.res = new Response(
        JSON.stringify({ ledgers: (src.ledgers ?? []).filter((l) => l.tripId != null && own.has(l.tripId)) }),
        { status: 200, headers }
      );
      return;
    }
    if ((m = /^\/v1\/ledgers\/(\d+)(?:\/|$)/.exec(path))) {
      const ledger = db.prepare("SELECT trip_id FROM ledgers WHERE id = ?").get(Number(m[1])) as { trip_id: number | null } | undefined;
      if (!ledger) throw notFound("Abrechnung");
      if (ledger.trip_id == null || !isTripParticipant(db, user.id, ledger.trip_id)) throw forbidden("Kein Zugriff auf diese Abrechnung");
    }

    // Beleg an einer Ausgabe: nur ein Dokument, das der Benutzer selbst sehen darf (kein Abtasten fremder Dokument-IDs)
    if (/^\/v1\/ledgers\/\d+\/expenses(?:\/\d+)?$/.test(path) && (method === "POST" || method === "PATCH")) {
      let body: unknown = null;
      try {
        body = await c.req.json();
      } catch {
        /* ungültiger Body: die Route antwortet mit 400 */
      }
      const docId = (body as { documentId?: unknown } | null)?.documentId;
      if (typeof docId === "number" && !canReadDocument(db, user.id, docId)) throw forbidden("Kein Zugriff auf dieses Dokument");
    }

    // Ausgaben ändern oder löschen: nur die eigenen (wie Gäste per Link)
    if ((m = /^\/v1\/ledgers\/(\d+)\/expenses\/(\d+)$/.exec(path)) && (method === "PATCH" || method === "DELETE")) {
      const ledgerId = Number(m[1]);
      L.assertLedgerAccess(db, user, ledgerId);
      const me = db.prepare("SELECT id FROM participants WHERE ledger_id = ? AND user_id = ?").get(ledgerId, user.id) as
        | { id: number }
        | undefined;
      const expense = L.getExpense(db, ledgerId, Number(m[2]));
      if (!me || expense.createdByMemberId !== me.id) throw forbidden("Nur eigene Ausgaben können geändert werden");
    }

    return next();
  };
}
