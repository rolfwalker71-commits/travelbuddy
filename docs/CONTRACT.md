# TravelBuddy – Vertrag zwischen Server, Web und Apple-Apps

Verbindlich für alle parallel arbeitenden Pakete. **Grundregel:** Die API von HomeBuddy für Auth, Reisen,
Ereignisse, Kommentare, Reisekasse (Abrechnung), Gäste-Links, Geräte/Push, Wechselkurs, Medien und ICS bleibt
**unverändert** (Pfade, Felder, Fehlerformat). Sie ist in `/Volumes/INT_SSD_VOL2/DEVELOPMENT/HomeBuddy/docs/ARCHITECTURE.md`
(Abschnitt «Konventionen der API») und im Code `HomeBuddy/server/src/{trips,ledgers,auth,push,media}` beschrieben.
Dieses Dokument nennt nur **Änderungen und Ergänzungen**.

## Konventionen (aus HomeBuddy, unverändert)

JSON camelCase · Beträge `…Minor` (Integer, Rappen) · Daten `YYYY-MM-DD` · Zeiten `HH:mm` · Zeitstempel UTC ISO 8601 ·
Fehler `{ "error": { "code": "snake_case", "message": "Deutscher Text" } }` · Auth `Authorization: Bearer tb_…` (Präfix
neu `tb_`, vorher `hb_`) · Text Deutsch, Schweizer Rechtschreibung, **nie «ß»**.

## Identität

- Bundle-ID `ch.rolfwalker.travelbuddy`, Team `9XZWUZ7Z26`, App-Group `group.ch.rolfwalker.travelbuddy`.
- Erweiterungen: `.widgets`, `.share`, `.notificationservice`, `.notificationcontent`.
- URL-Schema `travelbuddy://trip/<id>`, `travelbuddy://event/<tripId>/<eventId>`, `travelbuddy://today`,
  `travelbuddy://ledger/<id>`, `travelbuddy://inbox`.

## Teilnehmer: eine Tabelle, zwei Sichten

Server speichert Mitreisende einmal (`participants`). **Die ID ist dieselbe**, ob als `travelers[]` in der Reise oder
als `members[]` in der Reisekasse erscheint. Reise-Antworten und Abrechnungs-Antworten behalten ihre HomeBuddy-Form,
Clients ändern sich dadurch nicht. Neu an jedem Teilnehmer in `travelers[]`: `coupleId` (nullable), `colorIndex` (0–7,
stabile Farbe für Avatar/Diagramme).

## Ereignis (Erweiterung)

Zusätzlich zu den HomeBuddy-Feldern (`id, tripId, type, title, startDate, endDate, startTime, endTime, location,
address, provider, bookingReference, website, phone, lat, lon, notes, details, sortKey, documentIds, documents,
comments, imageUrl, mapUrl`):

| Feld | Typ | Bedeutung |
|---|---|---|
| `startTz`, `endTz` | string? | IANA-Zone, z. B. `Europe/Zurich`. `null` = Zone der Reise |
| `status` | `confirmed` \| `proposed` \| `needs_review` | Vorschläge aus PDFs sind `proposed`/`needs_review` |
| `participantIds` | number[] | wer ist dabei; leer = alle |
| `priceMinor`, `currency` | number?, string? | Preis des Ereignisses |
| `paymentStatus` | `open` \| `paid` \| `deposit` \| `onsite` \| null | |
| `paidByParticipantId` | number? | |
| `cancelUntil` | date? | kostenlos stornierbar bis (erzeugt Erinnerung) |
| `expenseId` | number? | verknüpfte Ausgabe der Reisekasse |
| `fieldsMeta` | object | je Feldname `{ source: "manual"\|"document"\|"derived", confidence?: 0..1, documentId?, page?, quote?, locked?: bool }` |
| `sourceDocumentId` | number? | Dokument, aus dem das Ereignis vorgeschlagen wurde |

`type` ist eine `id` aus `shared/event-types.json` (13 Typen). `details` enthält ausschliesslich Schlüssel aus dem
Katalog dieses Typs (Validierung serverseitig, unbekannte Schlüssel → 422 `invalid_details`). `details.passengers` ist ein
Array `[{ participantId, seat?, ticketNumber?, … }]`.

Schreibregel: Ein per `PATCH` gesetztes Feld erhält `fieldsMeta[field] = { source: "manual", locked: true }`.
Die KI-Analyse darf gesperrte Felder nie ändern, leere Felder darf sie füllen.

### Katalog

`GET /v1/meta/event-types` → Inhalt von `shared/event-types.json` (identisch, Server liefert die Datei aus), dazu
`airports` nicht; Flughafen-Suche: `GET /v1/meta/airports?q=zrh` → `{ airports: [{ iata, name, city, country, lat, lon, tz }] }`.
Zeitzonen-Vorschlag: `GET /v1/meta/timezone?lat=&lon=` → `{ tz }`.

## Dokumente (neu, ersetzt Paperless)

Dokument-Objekt: `{ id, title, fileName, contentType, sizeBytes, pages, sha256, createdAt, analysisStatus:
"pending"|"processing"|"done"|"failed"|"skipped", analysisError?, summary?, tripIds: number[], eventIds: number[],
thumbnailUrl, fileUrl }`.

| Route | Zweck |
|---|---|
| `POST /v1/trips/:id/documents` (multipart `file`, optional `eventId`) | Datei an Reise (und Ereignis) hängen. Antwort `202 { document }`; Analyse läuft im Hintergrund |
| `POST /v1/documents` (multipart `file`) | «Einwurf» ohne Reise (Teilen-Menü): Server ordnet zu oder legt `proposedTrip` an. Antwort `202 { document }` |
| `GET /v1/documents/:id` | Dokument inkl. Status |
| `GET /v1/documents/:id/file` | Original (Range-Anfragen, `Content-Disposition: inline`) |
| `GET /v1/documents/:id/thumbnail` | PNG/JPEG der ersten Seite |
| `POST /v1/documents/:id/analyze` | Analyse neu starten |
| `DELETE /v1/documents/:id` | Datei und Verknüpfungen entfernen (Ereignisse bleiben) |
| `GET /v1/inbox` | `{ documents: Document[] (in Arbeit/fehlgeschlagen), review: [{ tripId, tripTitle, event }] }` – alles, was Aufmerksamkeit braucht |
| `POST /v1/trips/:id/events/:eventId/confirm` | `status → confirmed` |
| `POST /v1/trips/:id/events/:eventId/merge` `{ intoEventId }` | Vorschlag in vorhandenes Ereignis einarbeiten (nur leere Felder) |

Vorschläge sind normale Ereignisse mit `status != confirmed`; Ablehnen = `DELETE` des Ereignisses.
Anzeige in Plan und Heute: nur als «Vorschlag», nie vermischt mit bestätigten Zeiten ohne Kennzeichnung.

Limits: 25 MB, PDF/JPG/PNG/HEIC/`.pkpass`/`.ics`, Typ per Dateikopf.

## Reise (Erweiterung)

`POST/PATCH /v1/trips`: zusätzlich `homeCurrency` (Standard `CHF`), `timezone` (Standardzone der Reise).
Reise-Objekt: `+ homeCurrency, timezone, coverUrl, ledgerId, needsReviewCount, phase: "upcoming"|"active"|"past"`.
Die **Reisekasse wird automatisch beim Anlegen der Reise erzeugt** (`ledgerId` immer gesetzt). `POST …/ledger` bleibt
für Altdaten als No-op (liefert die bestehende).

## Heute und Zusammenfassung (neu)

`GET /v1/today?date=YYYY-MM-DD&tz=Europe/Zurich` →
```
{
  "generatedAt": "...Z",
  "trip": { id, title, destination, startDate, endDate, dayIndex, dayCount, coverUrl, timezone } | null,
  "date": "YYYY-MM-DD",
  "now": { "local": "HH:mm", "tz": "..." },
  "next": Event | null,                 // nächstes Ereignis ab jetzt (in Reisezeit)
  "nextInSeconds": number | null,
  "events": Event[],                    // heutige Ereignisse, chronologisch (Zeitzonen berücksichtigt)
  "tomorrow": Event[],
  "tasks": [{ eventId, title, dueDate }],
  "deadlines": [{ eventId, title, kind: "cancel"|"payment", date }],
  "review": number,                     // Vorschläge zu prüfen
  "ledger": { id, balanceMinor, currency } | null   // Saldo des Aufrufers
}
```
Ohne aktive Reise: `trip: null` und `upcoming: { id, title, startDate, daysUntil } | null`.

**Tagesrolle mehrtägiger Ereignisse (additiv).** Jedes Ereignis in `events`, `tomorrow`, `next` (`/v1/today`,
`/v1/trips/:id/day/:date`) und `nextEvents[]` (`/v1/summary`) trägt zusätzlich:

| Feld | Typ | Bedeutung |
|---|---|---|
| `dayRole` | `single` \| `start` \| `middle` \| `end` | Rolle am betrachteten Tag: eintägig `single`; mehrtägig (Hotel, Ferienwohnung, Mietauto, Visum, Flug über Mitternacht) am ersten Tag `start`, am letzten `end`, dazwischen `middle` |
| `displayTime` | `HH:mm`? | `single`/`start`: `startTime`; `end`: `endTime` (Ortszeit des Endes, nicht `startTime`); `middle`: `null` |
| `displayLabel` | string? | `start`: `startLabel` des Katalogs (z. B. «Check-in», «Abholung»), `end`: `endLabel` («Check-out», «Rückgabe»), `middle`: «Aufenthalt» (Unterkünfte), «Gültig» (Visum), «Versichert» (Versicherung), sonst «Unterwegs» |

Kreuzfahrt: Der Eintrag «Reise» (`entryKind`, Gesamtreise ohne Zeit) bleibt an allen Tagen `middle`/«Unterwegs»;
Hafentage, Ein-/Ausschiffung und «Abfahrt …» sind `single`. Die Tagesliste ist nach dem angezeigten Zeitpunkt
sortiert (Einträge ohne Uhrzeit zuerst, `middle` gruppiert unten). `next`/`nextInSeconds` rechnen mit dem tatsächlich
nächsten Zeitpunkt, bei mehrtägigen Ereignissen also auch mit dem Ende (Check-out); `next` trägt die Rolle dieses
Zeitpunkts. Bestehende Felder (`startDate`, `startTime`, `endDate`, `endTime` …) bleiben unverändert; Clients zeigen
`displayTime`/`displayLabel` an.

`GET /v1/summary` (Widgets, kompakt, ≤ 20 KB): `{ generatedAt, activeTrip?, nextTrip?, nextEvents: [{id,tripId,type,
title,startDate,startTime,startTz,endTime,location,bookingReference,icon,color,summary:[{label,value}]}], today:
{date,dayIndex,dayCount}, ledger?: {…} }`.

## Karten

- **Web:** Apple Karten per **MapKit JS**. Token: `GET /v1/maps/token` → `{ token, expiresAt }` (JWT, Server signiert mit
  Schlüssel aus Umgebung `TRAVELBUDDY_MAPKIT_TEAM_ID`, `…_KEY_ID`, `…_KEY` oder `…_KEY_PATH`, `…_ORIGIN`);
  ohne Schlüssel `404 maps_not_configured` und die Web-App zeigt die schematische SVG-Route.
- **Apple-Apps:** natives **MapKit** (SwiftUI `Map`), kein Schlüssel nötig. Gleiche Daten: `lat/lon` der Ereignisse.
- Koordinaten fehlen oft: Server füllt `lat/lon` per Flughafentabelle (IATA) und, wenn möglich, per Geocoding im
  Client (MapKit `MKLocalSearch`/MapKit-JS-Search) und speichert per `PATCH`.
- Kartendarstellung: Marker je Ereignis mit Typfarbe/-symbol, Route als Bogen/Linie in Reihenfolge, Heute-Karte zeigt
  heutige Stationen und die Position «jetzt» nicht (kein Tracking).

## Geräte, Push, Live Activities

`PUT /v1/devices/current` zusätzlich `{ pushToStartToken?: string, platform, appVersion }`.
`PUT /v1/live-activities/:activityId` `{ pushToken, tripId, kind: "day"|"flight"|"checkin", eventId? }` und
`DELETE /v1/live-activities/:activityId`. Server sendet `apns-push-type: liveactivity`,
Topic `ch.rolfwalker.travelbuddy.push-type.liveactivity`, mit `content-state` gemäss
`ios/Shared/TravelActivityAttributes.swift` (siehe dort die Felder).

Mitteilungsarten (Kategorien, `thread-id = trip-<id>`):
`trip.today` (Morgenbriefing 07:30 Reisezeit), `trip.depart` (Abflug/Abfahrt in 24 h, 3 h, 1 h, «Check-in öffnet»),
`trip.stay` (Check-in heute, Check-out in 1 h), `trip.pickup` (Mietwagen), `trip.deadline` (Storno-/Zahlungsfrist),
`trip.review` (neue Vorschläge), `trip.comment`, `ledger.expense`, `ledger.settlement`.
Jede Nutzlast enthält `deepLink`, `tripId`, `eventId?`, `kind`, `imageKey?` (Name einer Illustration aus
`shared/illustrations/manifest.json`), `interruption: "active"|"time-sensitive"`.
Je Benutzer abschaltbar (`GET/PUT /v1/me/notification-prefs` erweitert um die Arten oben, Lead-Zeiten).

## Entfällt gegenüber HomeBuddy

`/v1/invoices*`, `/v1/documents` (Paperless-Liste), `/v1/deadlines*`, `/v1/warranties*`, `/v1/finance*`,
`/v1/credit-cards*`, `/v1/tax*`, `/v1/paperless*`, `/v1/knowledge`, `/v1/briefing`, `/v1/inbox` (alte Prüf-Queue; der
Name `/v1/inbox` wird neu belegt, siehe oben), Rechnungs-Widgets. Kassabücher (`cashbook`) entfallen.

## Version (sichtbar in Web und Apple-Apps)

- Eine Versionsnummer für das ganze Repo in `VERSION` (SemVer, z. B. `0.1.0`). Server (`package.json`), Web
  (`package.json`, Vite-Define) und iOS (`MARKETING_VERSION` in `ios/project.yml`) folgen ihr.
- `GET /v1/version` (öffentlich) → `{ "name": "TravelBuddy", "version": "0.1.0", "build": "<git-kurz>", "builtAt": "<ISO UTC>", "api": 1 }`.
- **Einstellungen** (Web) und **Konto/Einstellungen** (iPhone, iPad) zeigen unten eine Zeile
  «TravelBuddy 0.1.0 (Build 12) · Server 0.1.0 · Stand 11.10.2026 14:30». App-Build-Nummer = `CURRENT_PROJECT_VERSION`.
  Weichen App- und Server-Version in der Hauptzahl ab, erscheint ein Hinweis.

## Datum, Zeit, Zahlen, Schreibweise (überall verbindlich)

- Anzeige **immer** `dd.mm.yyyy` und `hh:mm` (24 h), z. B. `25.10.2026 17:00`. Nie US-/ISO-Anzeige in der Oberfläche.
  **Nie verkürzt** (kein «23.10.», kein «So 11.10.», kein «Okt», kein Jahr mit zwei Stellen). Wochentag darf davorstehen
  («So 11.10.2026» oder «Sonntag, 11.10.2026»), das Datum selbst bleibt vollständig. Gilt auch für Widgets, Live Activities,
  Mitteilungen, Karten-Beschriftungen und Diagramm-Achsen (Achsen dürfen bei Platzmangel nur Tag und Monat tragen,
  müssen dann aber an anderer Stelle das Jahr zeigen).
  Interne Speicher-/API-Formate bleiben ISO (siehe oben).
- Zahlen de-CH: Tausender-Apostroph, Dezimalpunkt (`1’234.50`).
- Schweizer Rechtschreibung: **nie «ß»**, immer «ss» (Grösse, Strasse, schliessen, gross).
- Texte in der Oberfläche, Fehlermeldungen, Mitteilungen: Deutsch.

## Eingang in V1 und später

- **V1:** Teilen-Menü (Share-Extension iPhone/iPad) und **PDF-Upload im Web** (Drag-and-drop und Dateiauswahl),
  zusätzlich Datei-Anhang direkt am Ereignis.
- **Nicht V1, aber vorgesehen: Mail-Import.** Eine Buchungsmail an eine eigene Adresse weiterleiten; der Server holt sie ab
  (IMAP-Postfach), liest Anhänge und Mailtext, legt Dokument und Vorschläge an und **antwortet dem Absender** mit einer
  Rückmeldung (was erkannt wurde, was zu prüfen ist). Vorbereitung im Datenmodell: `documents.source`
  (`upload` | `share` | `mail`) und `documents.sourceMeta` (JSON). Keine Mail-Logik in V1.

## Adressen aus Dokumenten → Karte im Ereignis-Detail (verbindlich in V1)

- Die KI-Auswertung liefert Adressen **getrennt vom Ortsnamen** (`address` = Strasse, PLZ, Ort, Land als eine Zeile;
  optional strukturiert `addressParts: { street, postalCode, city, region, country }`), je Ereignis und, wo das Dokument
  mehrere Orte nennt, je Station (Flug: Flughafen; Mietauto: Abholung **und** Rückgabe; Transfer: Abhol- und Zielort;
  Kreuzfahrt: Terminal/Pier). Orte, die nur im Typ-`details` stehen (`pickupPlace`, `returnPlace`, `originPlace`,
  `destinationPlace`, `venue`), werden gleich behandelt.
- **Geokodierung:** Der Server löst erkannte Adressen zu `lat/lon` auf (Apple Maps Server API, wenn der MapKit-Schlüssel
  da ist; sonst OpenStreetMap-Nominatim mit Cache, 1 Anfrage/s, eigener User-Agent), Flughäfen über die IATA-Tabelle.
  Ergebnis: `lat`, `lon`, `fieldsMeta.lat = { source: "geocoded", confidence, quote: <aufgelöste Adresse> }`.
  Schlägt es fehl oder fehlen Koordinaten, lösen die **Clients** per MapKit (iOS `MKLocalSearch`, Web `mapkit.Search`)
  auf und speichern per `PATCH`. Von Hand gesetzte Koordinaten (`source: "manual"`) werden nie überschrieben.
- Mehrere Orte je Ereignis: `places: [{ role: "start"|"end"|"pickup"|"return"|"venue"|"stop", label, address, lat, lon }]`
  (abgeleitet, read-only, vom Server geliefert). Die Karte zeigt alle `places`.
- **Ereignis-Detail (Web, iPhone, iPad):** eigene Karte oberhalb der Buchungsdaten mit Marker(n) in Typfarbe, Adresse
  als Text, Buttons «In Karten öffnen» (Apple Karten) und «Route» (Wegbeschreibung), Kopieren der Adresse. Zwei Orte
  (Abholung/Rückgabe, Abflug/Ankunft) werden als Linie mit beiden Markern gezeigt. Steht eine Adresse ohne Koordinaten
  da, zeigt das Detail «Adresse wird gesucht …» und löst sie auf (Client-Fallback), mit Hinweis bei Fehlschlag.
- Auch die Dokumentansicht zeigt die erkannten Adressen als Liste mit Karten-Vorschau und «Dem Ereignis zuordnen».

## Port

Der Server läuft mit `npm run dev` / `npm start` standardmässig auf **Port 7780** (`PORT`, Standardwert 7780; Bindung
`127.0.0.1`, im Container `0.0.0.0`). Vite-Proxy `/v1` → `http://127.0.0.1:7780`. Debug-Builds der Apple-Apps verwenden
`http://localhost:7780` als Vorgabe. Docker-Compose veröffentlicht `127.0.0.1:7780:7780`. Tests nutzen einen freien Port.

## Präzisierung Summary und Push-Nutzlast (aus Paket «ios-ext», verbindlich)

### `GET /v1/summary` (Widgets)
- Optionaler Parameter `?tripId=<id>` für eine gewählte Reise; ohne ihn aktive, sonst nächste Reise.
- `activeTrip` / `nextTrip`: `{ id, title, destination, startDate, endDate, phase, timezone, ledgerId, coverUrl }`.
- `ledger`: `{ id, title?, currency, balanceMinor, myMemberId, balances: [{ memberId, displayName, netMinor }] }`.
- `nextEvents[]` je Ereignis zusätzlich zu den Feldern oben: `endDate, endTz, address, lat, lon, status, provider`.
  Jedes Ereignis hat `startDate`. `summary[]` enthält bei Strecken `{label:"Von"}` und `{label:"Nach"}`.

### Push-Nutzlast (APNs, Mitteilungen)
- `aps.mutable-content = 1`, `aps.category = kind` (`trip.today` | `trip.depart` | `trip.stay` | `trip.pickup` | `trip.deadline` | `trip.review` | `trip.comment` | `ledger.expense` | `ledger.settlement`), `aps.thread-id = "trip-<id>"`.
- Top-Level: `deepLink`, `tripId`, `eventId?`, `kind`, `imageKey?`, `interruption` (`active`|`time-sensitive`), `relevance?` (0…1).
- Optional `ticket` (für die Ticket-Ansicht der Content-Extension):
  `{ type, icon, color, title, startAt (ISO UTC), tz, from, to, place, address, lat, lon, reference, tripTitle, dayIndex,
  dayCount, count, facts: [{label,value}], items: [{time,title,type|icon,color}] }`. Bei `trip.review` ist `ticket.count`
  die Anzahl der Vorschläge. Anzeigewerte sind bereits als `dd.mm.yyyy` / `hh:mm` formatiert.
- `GET /v1/media/notification/<imageKey>` liefert die Mitteilungsillustration als PNG 600×300 (Bearer).
  `imageKey` = `notif-today|notif-depart|notif-stay|notif-pickup|notif-deadline|notif-review` (siehe `shared/illustrations/manifest.json`).

### App-Seite
- Widget-Cache: `SharedConfig.Key.summaryJSON` als **String** (JSON-Text), `summaryFetchedAt` als Unix-Sekunden (`Double`);
  schreiben nach Login und jedem `/v1/summary`, beim Abmelden `SharedSession.clear()`.
- Aktions-Kennungen: `tb.open`, `tb.document`, `tb.route` (alle `.foreground`).
  Deep-Links: `travelbuddy://today`, `trip/<id>`, `event/<tripId>/<eventId>[?section=documents]`, `ledger/<id>`, `inbox`.
- Live Activity: Bei Phase `underway` aktualisiert der Server (oder die App) `progress` regelmässig; die Widget-Seite rechnet ihn nicht selbst.

## Illustrationen: Schlüssel und Ablage (aus Paket «graphics»)

- `imageKey` in Push-Nutzlasten = `id` aus `shared/illustrations/manifest.json`:
  `trip.today` → `notif-today`, `trip.depart` → `notif-depart`, `trip.stay` → `notif-stay`, `trip.pickup` → `notif-pickup`,
  `trip.deadline` → `notif-deadline`, `trip.review` → `notif-review`.
- Typkarten heissen `type-<TypID>` (`type-Flug`, `type-Zugreisen`, `type-Mietauto`, `type-Transfer`, `type-Hotel`,
  `type-Unterkunft`, `type-Kreuzfahrt`, `type-Ausflug`, `type-Restaurant`, `type-Veranstaltung`, `type-Versicherung`,
  `type-Visum`, `type-Aufgabe`); Leerzustände `empty-*`, `offline`, `error`; Hilfekarten `help-*`; Cover `cover-sea|city|mountain|island`.
- Dateien: `shared/illustrations/{light,dark}/<id>.svg`. **PNG werden nur für Mitteilungen eingecheckt**
  (`notifications/png/`), alle übrigen PNG sind erzeugte Vorschauen (git-ignoriert, `node design/illustrations/build.js`).

## Nachführung (umgesetzt in Server-Kern und Web)

- `GET /v1/trips/:id/documents` → `{ documents: Document[] }`; Dokument zusätzlich `source`, `proposedTrip?`, `addresses?: [{ eventId?, label, address, lat?, lon? }]`.
- `POST /v1/trips/:id/documents` und `POST /v1/documents` antworten `202 { document, duplicate: boolean }`.
- `PATCH …/events/:id` akzeptiert zusätzlich `fieldsMeta` (nur `locked`-Umschalter je Feld) und `placeCoords` (`{ [role]: { lat, lon } }`).
- `POST …/events/:id/geocode` löst Adressen des Ereignisses auf; `GET /v1/trips/:id/day/:date` liefert die Tagesansicht (Form wie `/v1/today`).
- Fehlercodes: `has_ledger_entries` (Reise mit Buchungen löschen braucht `?withLedger=1`), `currency_locked`, `invalid_details`.
- `GET /v1/meta/event-types` ist öffentlich (Gäste-Links).
- `today.ledger.myMemberId` bleibt erhalten (Kasse-Schnelleingabe).
- Rollen (Entscheid): Mitreisende mit Konto sehen und nutzen Reisekasse und Dokumente **eigener** Reisen; Ereignisse bearbeiten/löschen nur Admin.

## Link-Tokens importierter Teilnehmer (Alias)

Ein Link-Token je Person (`/t/<token>` und `/g/<token>`). HomeBuddy hatte für Reise und Abrechnung getrennte Tokens:
Beim Import bleibt der Reise-Token der Haupt-Token, der zweite Token gilt als **Alias**, solange der Haupt-Token unverändert
und nicht widerrufen ist. Wird der Link erneuert oder widerrufen, erlischt der Alias.

## Import: «zu prüfen»

Unsichere Importfälle (Zeitzone nicht ableitbar, Typ unbekannt) werden `status = needs_review` und erscheinen in
`GET /v1/inbox → review[]`. Aktueller Stand mit den echten Daten: 0 Fälle.

## Ingest-Ergänzungen (umgesetzt)

- `POST /v1/documents/:id/adopt-trip` (Admin; Body optional `{ tripId?, title?, startDate?, endDate?, destination? }`) legt die vorgeschlagene
  Reise an oder hängt an eine bestehende und übernimmt die Vorschläge. Fehler `409`: `no_proposed_trip`, `already_assigned`, `analysis_unavailable`.
- `document.proposedTrip`: `{ title, destination, startDate, endDate, timezone, eventCount, candidateTripIds: number[] }`.
- `fieldsMeta[feld]` kennt zusätzlich `needsReview: true` (Prüfmarkierung am einzelnen Feld, z. B. bei Widerspruch zwischen Barcode und KI).
- Umgebungsvariablen: `TRAVELBUDDY_AUTO_CONFIRM_MIN` (0.92; `> 1` = Automatik aus), `TRAVELBUDDY_TRIP_TOLERANCE_DAYS` (7),
  `TRAVELBUDDY_AI_CHUNK_CHARS` (24000), `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `TRAVELBUDDY_AI_MODEL_TEXT`, `TRAVELBUDDY_AI_MODEL_VISION`.
