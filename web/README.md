# TravelBuddy-Web

Web-Client von TravelBuddy: Vite, React 18, TypeScript, React Router. Gestaltung Richtung B «Ticket»
(`docs/DESIGN.md`), API gemäss `docs/CONTRACT.md`, Ereignis-Katalog aus `shared/event-types.json`.
Der Server liefert das gebaute `dist/` same-origin unter `/` aus; die API liegt unter `/v1`.

## Start

```bash
cd web
npm install
npm run dev                 # http://127.0.0.1:5174, /v1 → http://127.0.0.1:7780 (Server: cd server && npm run dev)
TRAVELBUDDY_API=http://127.0.0.1:7791 npm run dev   # anderen Server als Ziel (Vite-Proxy)
npm run build               # tsc --noEmit && vite build → dist/
npm test                    # vitest (Logik, Mocks, keine Browserumgebung nötig)
npm run typecheck
npm run sync:catalog        # shared/event-types.json → src/data/event-types.json (gebündelte Rückfallkopie)
```

Ohne Server mit Beispieldaten: `http://127.0.0.1:5174/?mock=1&autologin=1` (siehe «Fixture-Mocks»).

## Aufbau

```
src/
  api/        client (Bearer-Token, Fehlerform, Upload mit Fortschritt), endpoints, types
  lib/        reine Logik, getestet: catalog (Katalog → Formular), timezones, today (Countdown, Tagesband),
              viz (Routenbogen, Zeitband, Zahlen, Kasse), eventUi (Wichtiges je Typ), maps, mapkit,
              review (Zusammenführen), upload, illustrations, version, dates, money, …
  state/      auth, catalog (Server-Fassung mit gebündelter Kopie), today
  ui/         TicketCard, PageHeader (bits), Field (+ Herkunftspunkt), Chip, Stat, Sheet, Menu, Icon,
              IllustrationCard, HelpCard, PdfViewer (pdf.js)
  viz/        SVG-Infografiken: RouteArc, TimeBand, DayBand, TripNumbers, CostCharts
  map/        MapView (MapKit JS), EventMapCard (Karte im Ereignis-Detail)
  trip/       EventForm (Katalog-Formular), FieldInputs, EventTicket, Comments, TripEditSheet
  documents/  UploadZone, DocumentRow, ReviewList (Zu prüfen), useDocumentPolling
  ledger/     Reisekasse (Fachlogik unverändert aus HomeBuddy): Ausgaben, Rückzahlungen, Salden
  pages/      Today, Trips, TripLayout + trip/{Plan,Documents,Ledger,Team,Map}Tab, EventDetailPage,
              DocumentDetail, Inbox, Settings, Login; guest/ (/t/<token>, /g/<token>)
  mocks/      Fixture-Server für Entwicklung und Tests (nur Dev-Bündel)
  styles/     tokens (Papier/Nachtpapier), base, components, ticket, layout, pages, viz, map
```

### Navigation

Seitenleiste (Handy: untere Tab-Leiste): **Heute** (nur bei aktiver Reise, sonst Weiterleitung zu Reisen), **Reisen**,
**Konto**. In einer Reise die Tabs **Plan**, **Dokumente**, **Kasse**, **Team**, **Karte**; das Ereignis-Detail liegt
unter `/trips/:id/events/:eventId`.

**Rollen** (Vertrag «Nachführung»): Mitreisende mit Konto sehen und nutzen Reisekasse und Dokumente eigener Reisen
(hochladen, Ausgaben buchen, kommentieren). Der Client sperrt das nicht selbst, sondern zeigt, was der Server liefert; bei
`403` erscheint ein Hinweis. **Ereignisse anlegen, bearbeiten, löschen, Vorschläge übernehmen/verwerfen, Reisen
verwalten, Teilnehmer und Links** zeigt der Client nur Administratoren.

### Routen

| Pfad | Inhalt |
|---|---|
| `/` | Heute (`GET /v1/today`) |
| `/trips`, `/trips/:id` | Reisen, Plan |
| `/trips/:id/{documents,ledger,team,map}` | Dokumente, Kasse, Team, Karte |
| `/trips/:id/events/:eventId` | Ereignis-Detail mit Karte oberhalb der Buchungsdaten |
| `/trips/:id/day/:date` | Vorschau eines Reisetags (`GET /v1/trips/:id/day/:date`) mit Tag-Navigation |
| `/documents/:id` | Dokument, erkannte Adressen mit Karten-Vorschau |
| `/inbox`, `/ledgers/:id`, `/settings` | Zu prüfen (alle Reisen), Direktlink Reisekasse, Konto |
| `/t/:token`, `/g/:token` | Gäste: Reise, Reisekasse (derselbe Token) |

## Gestaltung

- Tokens in `src/styles/tokens.css`: hell «Papier», dunkel «Nachtpapier», Umschalter System/Hell/Dunkel
  (`localStorage` `travelbuddy.theme`, Standard System). Typfarben `--k-<color>` aus dem Katalog.
- Schrift selbst ausgeliefert (`@fontsource`): Barlow (Text), Barlow Semi Condensed (Titel, GROSSBUCHSTABEN-Labels
  mit 0,08 em), IBM Plex Mono (Zeiten, Codes, Beträge).
- Kleine Komponenten-API: `TicketCard`, `PageHeader`, `Field`, `Chip`, `Stat`. Ticket-Karte mit Kopfband, Perforation
  (gestrichelt, seitliche Kerben) und Abrissstreifen. Hero (Heute) mit Countdown-Ring.
- `prefers-reduced-motion` wird respektiert (Sheet, Ring, Skeleton). Semantikfarben stehen nie allein.
- Datum **immer** `dd.mm.yyyy`, Zeit `hh:mm`, Wochentag davor erlaubt («So 11.10.2026»). Achsen von Infografiken dürfen
  bei Platzmangel `dd.mm.` zeigen, dann steht das Jahr im Untertitel (`formatAxisDate`, `formatYearSpan`). Zahlen de-CH
  (`1’234.50`). Texte Deutsch, nie «ß».

## Ereignis erfassen (katalog-getrieben)

`GET /v1/meta/event-types` (Rückfall: gebündelte Kopie `src/data/event-types.json`, per Test gegen `shared/` geprüft).
Das Formular entsteht aus dem Katalog (`lib/catalog.ts`): Typ-Kacheln (13), danach Abschnitte «Zeit und Ort» · Typabschnitte ·
Buchung · Wer ist dabei · Preis und Zahlung · Notizen, Umschalter «Wichtiges / Alle Felder» (gefüllte Felder bleiben
sichtbar). Feldarten text, longtext, date, time, number, money, select, bool, airport, place, passengers,
participants/participant; `pattern` und `transform` werden vor der Prüfung angewandt. Zeitzonen: Auswahl aus
`Intl.supportedValuesOf`, vorbelegt aus Flughafen (`GET /v1/meta/airports`) oder Reisezone. Herkunftspunkt je Feld
(`fieldsMeta`; gefüllt = aus Dokument, Ring = von Hand; Klick zeigt Zitat und Seite und öffnet das PDF an der Stelle).
«In Reisekasse übernehmen» öffnet die Ausgabe mit Vorbelegung und setzt `tripEventId`.

## Heute und Tagesrolle

Ereignisse der Tagesantworten tragen `dayRole` (single, start, middle, end), `displayTime` und `displayLabel`. Der Client
zeigt sie statt `startTime`: am Endtag eines Hotels «Check-out 12:00», am Starttag «Check-in 15:00»; `middle` ohne Zeit
unten als «Aufenthalt und Unterwegs». Das gilt für «Als Nächstes», Tagesliste, Tagesband (Punkt nach `displayTime`)
und die Folgetag-Vorschau. Zonen erscheinen nur, wenn die Uhr tatsächlich anders geht (Zürich und Madrid gelten als gleich).

## Dokumente

Upload per Drag-and-drop und Dateiauswahl (`POST /v1/trips/:id/documents`, optional `eventId`), Fortschritt (XHR),
Analysestatus-Polling (`GET /v1/documents/:id`, 2 bis 8 s, höchstens 5 Minuten). «Zu prüfen»: Vorschläge
(`status != confirmed`) mit Quellenausschnitt, Sicherheit; Übernehmen (`confirm`), Bearbeiten, Zusammenführen (`merge`,
mit Kandidaten nach Referenz/Nummer/Tag), Verwerfen (`DELETE`). «Dem Ereignis zuordnen» hängt das Dokument per
`POST /v1/trips/:id/events/:eventId/documents { documentId }` an (nur Admin). PDF-Anzeige mit pdf.js (eigener Chunk, Worker
same-origin).

## Karten

- **Apple Karten (MapKit JS)**: Token `GET /v1/maps/token`; das Skript wird erst bei Bedarf geladen. Reise-Karte mit
  Markern in Typfarbe (nummeriert) und Route in Reihenfolge, Tagesfilter. Ereignis-Detail: Karte oberhalb der
  Buchungsdaten mit allen `places[]`, «In Karten öffnen», «Route», «Adresse kopieren».
- Fehlende Koordinaten: MapKit-Suche im Browser, Speichern per `PATCH` (`lat`/`lon` für den ersten Ort,
  `placeCoords[<rolle>]` für weitere). Ohne MapKit im Browser stösst der Client die Server-Geokodierung an
  (`POST …/events/:id/geocode`). Schlägt es fehl, erscheint ein Hinweis.
- **Ohne Schlüssel** (`404 maps_not_configured`): schematischer SVG-Routenbogen aus den Koordinaten (kein Kartenmaterial).
- Kein Standort-Tracking.
- MapKit selbst ist hier nur gegen die Typen, nicht gegen einen echten Schlüssel geprüft.

## Infografiken

Reine SVG-Komponenten in `src/viz/`, Daten in `lib/viz.ts`/`lib/today.ts` (getestet), Farben nur über Tokens,
`role="img"` mit `<title>`/`<desc>`: Routenbogen, Zeitband der Reise, Tagesband (Check-in, Boarding, Abfahrt, Puffer),
Reise in Zahlen, Kasse nach Kategorie und Tag, Salden mit Ausgleichspfeilen. Auf schmalen Bildschirmen scrollen
die Grafiken seitlich, statt unlesbar zu schrumpfen.

## Illustrationen und Hilfekarten

`<IllustrationCard id="…" zoom>` und `<HelpCard id="…">` lesen `shared/illustrations/` zur Bauzeit per
`import.meta.glob`: `manifest.json` (`items[]` mit `id`, `title`, `alt`, `files.lightSvg/darkSvg`) und `help-cards.json`
(`cards[]` mit `title`, `summary`, `steps[].marker/label/title/text`, `illustration`); die SVGs liegen unter
`light/` und `dark/`, das Thema wählt die Datei (die PNG-Kopien unter `png/` sind ausgeschlossen). Fehlt eine ID,
steht ein Platzhalter; fehlt `help-cards.json`, gelten eingebaute Kurztexte. Ohne Manifest werden die Dateien aus der
Ordnerstruktur gefunden.

IDs im Web: `type-<Typ-ID>` (Ereignis-Kopf), `empty-trips` (Reisen), `empty-day` (Plan, Heute), `empty-documents`,
`empty-ledger`, `error`, `offline` (Fehlerzustand), `help-share|settle|today|timezones|invite|review` (Hilfekarten:
grosse Illustration, Klick vergrössert), `cover-sea|city|mountain|island`.

**Cover-Fallback** für Reisen ohne Titelbild (`coverIdFor` in `lib/illustrations.ts`): `cover-sea` bei Kreuzfahrt- oder
Schiff-Ereignissen, sonst nach Stichwörtern in Titel und Ziel (Berge, Insel, Stadt), sonst stabil nach Reise-ID.

## Version

Unten in den Einstellungen: `TravelBuddy 0.1.0 (Build <git-kurz>) · Server <x> · Stand dd.mm.yyyy hh:mm`. Version aus
`/VERSION` (Vite-Define `__APP_VERSION__`), Build aus `git rev-parse --short HEAD` (Rückfall «dev»,
`TRAVELBUDDY_BUILD` übersteuert), Server aus `GET /v1/version`. Weicht die Hauptzahl ab, erscheint ein Hinweis.

## Fixture-Mocks (nur Entwicklung und Tests)

`src/mocks/` bildet die Routen des Vertrags im Speicher nach (Anmeldung, Reisen, Ereignisse, Dokumente mit
Analyse-Übergang und Vorschlag, Heute, Reisekasse, Gäste, Version, Karte ohne Schlüssel). Schalter:

- URL `?mock=1` (merkt sich `travelbuddy.mocks=1`), `?mock=0` schaltet aus; oder `VITE_MOCKS=1 npm run dev`.
- Hilfen für Screenshots: `?autologin=1`, `?theme=dark|light|system`.
- Im Produktionsbündel sind die Mocks nicht enthalten (`import.meta.env.DEV`).

## Tests

`npm test`: Katalog → Felder, Pattern/Transform, Zeitzonen und Sommerzeit, Datumsformat, Heute-Aufbereitung und Tagesband,
Infografik-Daten, Karten-Links, Zusammenführen, Upload, Version, Illustrations-Manifest, Navigation, Mock-Server.

## Bekannte Lücken

- MapKit JS und die Karten im Browser ohne echten Apple-Schlüssel ungeprüft; die SVG-Ersatzkarte ist geprüft.
- Kein Offline-Cache im Web (Apple-Apps haben ihn).
- Mitreisende: Dokumente und Kasse hängen an der Rollenregel des Servers (Paket «notify»); bis dahin zeigt der Client bei `403` einen Hinweis.
- Länder in «Reise in Zahlen» stammen aus der letzten Adresszeile (Heuristik), solange der Server kein Land liefert.
