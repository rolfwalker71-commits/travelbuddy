# TravelBuddy-Server – Notizen zum Vertrag

Stand: 11.10.2026. Ergänzt `docs/CONTRACT.md` um das, was der Server anders oder zusätzlich macht, und beschreibt
Schema und Erweiterungspunkte. Abschnitt 1 enthält die **Wünsche an den Vertrag**.

## 1. Abweichungen und Wünsche an den Vertrag

1. **Fehlercode für unbekannte Typen:** Ein unbekannter `type` und unbekannte oder ungültige `details` ergeben beide
   `422 invalid_details` (bei Typen mit `details.fields[0].field = "type"`). Aliase des Katalogs werden aufgelöst
   (`Mietwagen` → `Mietauto`). Werte werden nach dem Katalog geprüft (Muster, Auswahl, Zahl, Zeit, Betrag,
   `passengers[].participantId` muss zur Reise gehören) und bereinigt (`transform: upper`, Trimmen, leere Werte entfallen).
   Bei einer Typänderung gilt der Katalog des neuen Typs.
2. **Rollen wie HomeBuddy, bewusst eng:** Mitreisende mit Konto (Nicht-Admins) dürfen: eigene Reisen lesen, `ics`,
   `day`, kommentieren, `today`, `summary`, Karten-Token, Flughafensuche, Zeitzone, Bilder der eigenen Reisen,
   Geräte/Einstellungen/Live Activities. **Nicht:** Reisekasse (auch `ledgerId` ist sichtbar, aber `403`), Dokumente,
   Inbox, Reisen/Ereignisse ändern. In `today`/`summary` ist `ledger` für sie `null` bzw. fehlt.
   *Wunsch:* Sollen Mitreisende ihre Reisekasse und die Belege ihrer Reise sehen und buchen, ist das ein Eintrag in
   `src/auth/roles.ts` (`RULES`) plus eine Prüfung «nur eigene Reise» in `ingest/routes.ts`; entscheiden und im Vertrag nennen.
3. **Ein Link-Token je Person:** `travelers[].shareToken` (Reise, `/v1/guest/trips/:token`) und `members[].inviteToken`
   (Reisekasse, `/v1/guest/:token`) sind derselbe Wert; Erneuern und Widerrufen wirkt auf beide Sichten
   (`…/travelers/:id/share/*` und `…/members/:id/invite/*` sind zwei Wege zur selben Sache).
4. **Reisekasse immer da:** `ledgerId` ist immer gesetzt (auch für Mitreisende und Gäste). `POST /v1/trips/:id/ledger`
   liefert nur noch `200 { ledgerId }` (No-op). `DELETE /v1/trips/:id/ledger` → `400 ledger_of_trip`,
   `DELETE /v1/ledgers/:id` einer Reisekasse mit Reise → `409 ledger_of_trip`. `DELETE /v1/trips/:id` mit Buchungen →
   `409 has_ledger_entries`, mit `?withLedger=1` wird alles gelöscht. `homeCurrency` = Basiswährung der Reisekasse
   (`409 currency_locked`, sobald Ausgaben existieren); der Kassentitel folgt dem Reisetitel («Reisekasse: …»).
5. **Eigenständige Reisekassen bleiben** (`POST /v1/ledgers` ohne Reise) für Altdaten, Import und die portierten Tests;
   die Apps legen Kassen nur über die Reise an. `kind` ist immer `"split"`, `hidden` immer `false`, `soloMemberId` immer
   `null` (HomeBuddy-Clients), Kassabücher entfallen. `coverUrl` einer Kasse = Titelbild ihrer Reise.
6. **`POST /v1/trips/adopt` entfällt** (hing an der alten Analyse). Ersatz: `POST /v1/documents/:id/adopt-trip`
   (legt aus `documents.proposedTrip` eine Reise an und übernimmt die erkannten Ereignisse; Details in
   `docs/api/ingest.md`).
7. **`fieldsMeta`:**
   - Schlüssel sind die bare Feldnamen (gemeinsame Felder wie `title`, `startTime`, `lat` und Katalog-Schlüssel wie
     `flightNumber`; `participantIds` für «Wer ist dabei»). Der Test `katalog: Aliase und Vererbung` stellt sicher,
     dass kein Katalog-Schlüssel einem gemeinsamen Feld gleicht.
   - **Gesperrt wird, was sich per `POST`/`PATCH` tatsächlich ändert** (unveränderte Werte in einem vollständigen
     Formular sperren nichts). `source` kennt zusätzlich `"geocoded"` (siehe Orte).
   - `PATCH` akzeptiert `fieldsMeta: { <feld>: { locked: boolean } | null }` (Sperre setzen/aufheben, `null` entfernt
     den Eintrag) und `placeCoords: { <rolle>: { lat, lon } | null }` (Koordinaten weiterer Orte von Hand).
   - Flug: `startTz`, `endTz`, `lat`/`lon` werden aus den IATA-Codes vorbelegt, wenn leer **oder** `source: "derived"`
     und nicht gesperrt (folgt also einem geänderten Flughafen). `lat`/`lon` des Ereignisses = **Abflughafen**; die
     Ankunft steht in `places[]`.
8. **`places[]`** hat zusätzlich `source` (`manual | geocoded | airport | derived | null`). Der erste Ort trägt
   `lat`/`lon` des Ereignisses, weitere Orte `trip_events.place_coords` (je Rolle). Koordinaten ohne Herkunft
   (z. B. importiert) gelten als «von Hand» und werden nie überschrieben. Die `address` je Ort stammt (Katalog
   Version 2) aus den Adressfeldern des Typs: Mietauto `pickupAddress`/`returnAddress`, Transfer und Zug
   `originAddress`/`destinationAddress`, Veranstaltung `venueAddress`, Kreuzfahrt `terminalAddress`; fehlt das Feld,
   gilt für den ersten Ort `address` des Ereignisses (Altdaten, Import).
9. **Geokodierung:** `POST …/events/:id/geocode` (Body optional `{ force: true }`) antwortet
   `{ eventId, results: [{ role, status, lat?, lon?, label?, provider? }], …tripDetail }`. Status: `resolved`, `kept`,
   `airport`, `skipped_manual`, `not_found`, `no_query`, `unavailable`. Ohne Dienst `409 geocoder_not_configured`
   (Clients lösen per MapKit auf). Nach `POST`/`PATCH` eines Ereignisses läuft die Auflösung für Orte ohne Koordinaten
   automatisch im Hintergrund. Label-only-Suchen bekommen das Reiseziel als Kontext.
10. **Dokumente:**
    - Zusätzliche Tabelle `trip_documents` (Dokument an Reise ohne Ereignis); `tripIds` ist die Vereinigung.
    - Dokument-Objekt zusätzlich `source` (`upload|share|mail`) und `proposedTrip` (`analysis_json.proposedTrip` oder
      `null`); `analysisError` und `summary` fehlen, wenn leer. `thumbnailUrl` ist `null`, wenn der Server keine
      Vorschau liefern kann.
    - Upload-Antwort `202 { document, duplicate }`; Fehler `413 payload_too_large`, `415 unsupported_media_type`,
      `422 empty_file`, `400 file_required`. Optionales Formularfeld `source` (`upload|share`).
    - Zusätzlich `GET /v1/trips/:id/documents` (Dokumente einer Reise).
    - **Vorschau-Entscheidung:** JPEG/PNG liefern sich selbst, PDF die erste Seite per `pdftoppm` (poppler-utils, im
      Docker-Image vorhanden, Zwischenspeicher `documents/thumbs/`), sonst `404 thumbnail_unavailable` und die Clients
      rendern selbst (PDFKit, pdf.js, Wallet). HEIC, `.pkpass`, `.ics`: nie.
    - Inbox: `documents` = Status `pending|processing|failed` **oder** an nichts verknüpft; `review` = alle Ereignisse
      mit `status != confirmed`. Nur Administratoren.
    - `merge`: Pfad-Ereignis ist der Vorschlag, `intoEventId` das Ziel; nur leere, nicht gesperrte Felder; Antwort
      `{ eventId, …tripDetail }`. `confirm` antwortet mit `tripDetail`.
11. **Heute / Tag:** `GET /v1/today?date=&tz=&tripId=`. «Jetzt» rechnet in der Zone, in der die Reisenden gerade sind:
    Reisezone, dann Zone des zuletzt begonnenen bzw. beendeten Ereignisses mit `startTz`/`endTz` (ein Flug nach Miami
    schaltet auf `America/New_York`); `tz` übersteuert. Ohne Reise: `trip: null` und `upcoming`, übrige Felder leer.
    `events` enthält Ereignisse, deren Zeitraum den Tag berührt (mehrtägige Aufenthalte, über Mitternacht endende
    Flüge); `next` ist das nächste Ereignis mit Beginn ab jetzt (ohne Aufgaben). `tasks` = nicht erledigte Aufgaben
    bis 7 Tage voraus (auch undatierte); `deadlines` = `cancel` (`cancelUntil`) und `payment` (Preis mit Status
    `open`/`deposit`, fällig am Beginn) in den nächsten 14 Tagen. `ledger` zusätzlich `title`, `myMemberId`,
    `balances[]`; `balanceMinor` ist 0, wenn der Aufrufer (Admin) nicht Teilnehmer ist.
    **`GET /v1/trips/:id/day/:date`** ist im Vertrag nicht beschrieben: gleiche Antwort wie `today`, aber auf Reise
    und Datum festgelegt (`?tz=` optional).
11a. **Tagesrolle:** `dayRole`, `displayTime`, `displayLabel` an allen Ereignissen der Tageslisten, an `next` und an
    `nextEvents[]` (siehe Vertrag «Heute und Zusammenfassung»). Umsetzung in `src/trips/today.ts` (`dayInfo`,
    `nextMoment`). `next` kennt Ende-Zeitpunkte nur für mehrtägige Ereignisse (kein Treffer «Ankunft» für einen
    eintägigen Flug unterwegs); die Zusammenfassung nimmt zusätzlich kurze, laufende Ereignisse auf.
12. **Summary:** `GET /v1/summary?tripId=` gemäss Abschnitt «Präzisierung». `activeTrip`/`nextTrip` zusätzlich
    `needsReviewCount`; `nextEvents[]` (höchstens 6; kommende und kurze laufende Ereignisse, keine Aufgaben) zusätzlich
    `colorHex`; `summary[]` führt bei Strecken `Von`/`Nach` (Flughafen, Bahnhof, Station), danach die übrigen
    Katalog-Angaben. `today.dayIndex` ist `null`, wenn keine Reise läuft. Eine per `tripId` gewählte vergangene Reise
    erscheint als `nextTrip` mit `phase: "past"`.
13. **Katalog öffentlich:** `GET /v1/meta/event-types` braucht kein Token (Gäste-Links brauchen Beschriftungen);
    `airports` und `timezone` brauchen eines. `country` der Flughäfen ist der ISO-2-Code. `limit` (1–50) optional.
14. **Benachrichtigungs-Einstellungen:** `GET/PUT /v1/me/notification-prefs` → `{ prefs: { tripToday, tripDepart,
    tripStay, tripPickup, tripDeadline, tripReview, tripComment, ledgerExpense, ledgerSettlement: boolean,
    leadTimes: { departHours: number[], checkoutMinutes, deadlineDays, todayBriefing: "HH:mm" } } }`
    (Standard: alle an; `[24, 3, 1]`, 60, 3, `07:30`). Die HomeBuddy-Schlüssel entfallen.
15. **Geräte/Live Activities:** `PUT /v1/devices/current` nimmt `apnsToken?` (nullable), `environment?`, `appVersion?`,
    `pushToStartToken?`, `platform?`; nicht gesendete Felder bleiben. `PUT/DELETE /v1/live-activities/:activityId`
    speichern nur (Tabelle `live_activities`); der Versand ist Sache der zweiten Welle.
16. **Push-Nutzlast:** `aps.mutable-content = 1`, `aps.category = kind`, `thread-id`, Top-Level `kind`, `deepLink`,
    `tripId`, `eventId?`, `imageKey?`, `interruption`, `relevance?`, `ticket?`. Versendet werden hier nur
    `trip.comment`, `ledger.expense`, `ledger.settlement` (Reisekassen-Meldungen nur an Administratoren).
17. **Version:** `build` = `TRAVELBUDDY_BUILD` (Docker-Build), sonst Git-Kurzhash, sonst `dev`; `builtAt` =
    `TRAVELBUDDY_BUILT_AT`, sonst Startzeit des Prozesses.
18. **Medien:** nur `trip_cover` und `event_image`; `mapUrl` am Ereignis bleibt als Feld, ist aber immer `null`.
    `GET /v1/media/notification/<imageKey>` ist eine Hülle (404 `image_not_available`, bis die Datei
    `<media>/notification/<imageKey>.png` existiert).
19. **Karten-Token:** `GET /v1/maps/token` → `{ token, expiresAt }` oder `404 maps_not_configured` (kein
    `{ enabled }` mehr).
20. **Port:** Standard `PORT=7780`.

## 2. Schema (`001_init.sql`)

| Tabelle | Inhalt |
|---|---|
| `users`, `api_tokens` | Konten; Geräte-Token (`tb_…`, SHA-256) mit `apns_token`, `apns_environment`, `push_to_start_token`, `platform`, `app_version` |
| `trips` | `+ home_currency, timezone`; `status` bleibt (planned/active/done/cancelled), `phase` wird aus Daten abgeleitet |
| `ledgers` | 1:1 zur Reise (`trip_id UNIQUE`, `NULL` nur bei Altdaten/Import), `ledger_couples` |
| `participants` | **eine Tabelle**: `trip_id`, `ledger_id`, `user_id`, `couple_id`, `color_index`, `share_token`, `share_revoked_at`; ID = `travelers[].id` = `members[].id` |
| `trip_events` | `+ start_tz, end_tz, status, price_minor, currency, payment_status, paid_by_participant_id, cancel_until, expense_id, fields_meta, source_document_id, place_coords`; `event_participants` (leer = alle) |
| `documents` | wie im Auftrag (`sha256 UNIQUE`, Analyse-Spalten, `source`, `source_meta`); `trip_documents`, `trip_event_documents` (N:M) |
| `trip_event_comments` | wie HomeBuddy |
| `expenses`, `expense_splits`, `settlements` | wie HomeBuddy; `paid_by_participant_id`, `created_by_participant_id`, `participant_id`, `from_/to_participant_id` verweisen auf `participants` |
| `media`, `media_trash` | `trip_cover`, `event_image` |
| `notification_prefs` (JSON), `notification_log`, `live_activities` | Push |
| `kv`, `geocode_cache` | Sonstiges |

Beträge sind `INTEGER` in Minor Units, Zeitstempel UTC ISO 8601, Daten `YYYY-MM-DD`, Uhrzeiten `HH:mm` in Ortszeit der
Zone des Ereignisses.

## 3. Erweiterungspunkte für die späteren Wellen

- **Analyse:** umgesetzt in `src/ingest/` (Beschreibung: `docs/api/ingest.md`). Haken: `DocumentAnalyzer`
  (`analyzer.ts`) mit `analyze(documentId)`, optional `ready()` (KI verfügbar → ohne Schlüssel übersprungene Dokumente
  werden nachgeholt) und `adopt(…)` (`POST /v1/documents/:id/adopt-trip`). Die echte Implementierung ist
  `IngestAnalyzer` (`pipeline.ts`, in `index.ts` verdrahtet); `createApp` nimmt ohne `analyzer` weiterhin `NoopAnalyzer`
  (setzt `skipped`, «Analyse nicht konfiguriert»), damit Tests ohne Anbindung laufen. Aufrufer: Upload
  (`ingest/routes.ts`), `POST /v1/documents/:id/analyze`, `runPendingAnalyses` im Hintergrundlauf; Wiederholung
  5 min … 6 h, 5 Versuche (`retryable === false` am Fehler = nicht wiederholen). Ereignisse legt die Analyse mit
  `createEvent(db, tripId, input, { markManual: false, fieldsMeta })` an (`status` je Prüfergebnis, `sourceDocumentId`),
  vorhandene ergänzt `applyExtraction(…)` (fasst gesperrte Felder nie an). KI-Aufrufe protokolliert `ai_usage`
  (Migration `002_ai_usage.sql`). Austausch der KI: `StructuredLlm` (`openai.ts`); Tests nutzen eine Fake-Implementierung.
- **Benachrichtigungen:** umgesetzt (`src/push/notifier.ts`, `src/notifications/`, Beschreibung
  `docs/api/notifications.md`). `Notifier.deliver(notices)` mit Art, `dedupeKey`, `deepLink`, `imageKey`,
  `interruption`, `relevance`, `ticket`; `Notifier.review(tripId, count)` meldet neue Vorschläge der Dokumentanalyse.
  Einstellungen und Vorlaufzeiten über `getPrefs`; `ApnsMessage` kennt `pushType` (`liveactivity`), `topic` und
  `rawPayload` für Live Activities (Topic `ch.rolfwalker.travelbuddy.push-type.liveactivity`).
- **Import:** `server/scripts/` (neben `create-user.ts`); Schema und `participants`-Zuordnung siehe oben, IDs der
  Reisekasse bleiben erhalten, wenn der Import in eine leere Datenbank schreibt.
  Umgesetzt in `server/src/import/` und `server/scripts/import-homebuddy.ts`, Beschreibung in `docs/api/import.md`.
- **Mail-Eingang:** `documents.source = 'mail'` und `source_meta` sind vorbereitet, keine Logik.
- **Mitteilungsbilder:** `shared/illustrations/notifications/<imageKey>.png` (Ordner per `TRAVELBUDDY_ILLUSTRATIONS_DIR`).

## 4. Bekannte Lücken

- Docker/Compose nur geschrieben, nicht auf einem Docker-Host gelaufen (kein Docker installiert).
- Apple Maps Server API (Token-Tausch, `/v1/geocode`) nur gegen einen Fake geprüft, nicht gegen Apple.
- PDF-Vorschauen brauchen `pdftoppm`; lokal ohne poppler gibt es `404`.
- Flughafentabelle (4 101 Einträge, OurAirports, Stand 11.10.2026) ist ein Abzug; Aktualisierung per
  `npm run airports:build`.
- Der Katalog prüft `select`-Werte streng gegen `options` (z. B. `Fruehstueck`); Alt- und Importdaten müssen vorher
  normalisiert werden.
- Zeitzonen-Rechnung nutzt `Intl`; Ereignisse ohne Uhrzeit gelten ab 00:00 Ortszeit.
