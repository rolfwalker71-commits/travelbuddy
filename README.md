# TravelBuddy

Reiseplanung für Familie und Mitreisende: PDFs (Buchungen, Tickets) werden geteilt oder hochgeladen, ausgewertet und
bauen Schritt für Schritt eine Reise auf. Mit Reisekasse (Ausgaben teilen, Salden, Ausgleich), Heute-Modus für aktive
Reisen, Karten, Widgets, Mitteilungen und Live Activities. Ausgelagert aus HomeBuddy, ohne Paperless.

| Teil | Ort | Technik |
|---|---|---|
| Server (API, Hintergrundjobs) | `server/` | TypeScript, Hono, SQLite, Port **7780** |
| Web | `web/` | Vite, React, TypeScript; vom Server ausgeliefert |
| iPhone / iPad | `ios/` | SwiftUI (iOS 26), Widgets, Live Activities, Teilen-Menü, Mitteilungs-Erweiterungen, xcodegen |
| Ereignis-Katalog | `shared/event-types.json` | Einzige Quelle für Ereignistypen und Felder |
| Illustrationen | `shared/illustrations/`, Generator `design/illustrations/` | isometrisch, SVG, hell/dunkel |
| Dokumentation | `docs/` | `CONTRACT.md` (API), `DESIGN.md`, `UMBAUPLAN.md`, `api/*` |

Version: Datei [`VERSION`](VERSION). Sie steht unten in den Einstellungen von Web und Apple-Apps
(«TravelBuddy 0.1.0 (Build 1) · Server 0.1.0 · Stand dd.mm.yyyy hh:mm»).

## Schnellstart

```bash
# Server (Port 7780)
cd server && npm install
TRAVELBUDDY_PASSWORD='mindestens-12-zeichen' npm run user:create -- rolf "Rolf" --admin
npm run dev            # http://127.0.0.1:7780

# Web (Entwicklung, leitet /v1 an 7780 weiter)
cd web && npm install && npm run dev        # http://127.0.0.1:5174
npm run build                               # → web/dist, wird vom Server unter / ausgeliefert

# Apple-App
cd ios && xcodegen generate && open TravelBuddy.xcodeproj
```

Tests: `cd server && npm test && npm run typecheck`, `cd web && npm test && npm run typecheck`,
iOS: Schema `TravelBuddy` (Unit-Tests im Simulator).

## Daten aus HomeBuddy übernehmen

Die Reisen und die Reisekasse aus HomeBuddy werden **importiert**, nicht neu erfasst. Die Quelle (`homebuddy.sqlite`) und
die PDFs liegen unter `import-in/` (nicht im Repo).

```bash
cd server
npm run import:homebuddy -- ../import-in/homebuddy.sqlite --dry-run                       # prüfen
npm run import:homebuddy -- ../import-in/homebuddy.sqlite --documents ../import-in/documents
```

- Abnahme: Salden je Teilnehmer müssen auf den Rappen mit HomeBuddy übereinstimmen, sonst Abbruch.
- Wiederholbar (idempotent); Details in `docs/api/import.md`.
- **Bootstrap:** Bei leerer Datenbank importiert `npm run dev` automatisch aus `import-in/homebuddy.sqlite`
  (abschaltbar mit `TRAVELBUDDY_BOOTSTRAP_IMPORT=off`).

## Konfiguration (Auszug, vollständig in `.env.example`)

| Variable | Zweck |
|---|---|
| `PORT` | Server-Port, Standard 7780 |
| `TRAVELBUDDY_DB_PATH` | SQLite-Datei |
| `OPENAI_API_KEY`, `TRAVELBUDDY_AI_MODEL_TEXT`, `…_VISION` | KI-Auswertung der PDFs (OpenAI). Ohne Schlüssel keine Vorschläge, Rest funktioniert |
| `TRAVELBUDDY_MAPKIT_*` | Apple Karten im Web (MapKit JS). Ohne Schlüssel schematische Route |
| `AuthKey_<KEYID>.p8` im Ordner `apns` | Push und Live Activities (APNs) |
| `TRAVELBUDDY_BOOTSTRAP_IMPORT` | Pfad zur HomeBuddy-Datenbank für den ersten Start |

Schlüssel und echte Daten gehören **nie** ins Repo (siehe `.gitignore`).

## Regeln

Deutsch, Schweizer Rechtschreibung (nie «ß»), Datum `dd.mm.yyyy` und Zeit `hh:mm`, Zahlen de-CH, Beträge in Rappen
(Integer). Details für alle Beteiligten: [`CLAUDE.md`](CLAUDE.md).

## Stand

V1: Reisen, Ereignisse (13 Typen mit allen wichtigen Feldern), Dokumente (Upload im Web, Teilen-Menü), Auswertung per
OpenAI mit Prüfung und Zusammenführen, Reisekasse, Heute, Karten, Widgets, Mitteilungen, Live Activities, Import.
Später: Mail-Import (Weiterleitung einer Buchungsmail), siehe `docs/CONTRACT.md`.
