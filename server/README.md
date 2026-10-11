# TravelBuddy-Server

TypeScript, Hono, SQLite (`better-sqlite3`), Zod. Die API ist in `docs/CONTRACT.md` beschrieben, Abweichungen und
Erweiterungspunkte in `docs/api/server-notes.md`. Quelle der Wahrheit für Ereignistypen ist `shared/event-types.json`
(wird zur Laufzeit geladen).

## Start

```bash
cd server
npm install
npm run dev                      # tsx watch, http://127.0.0.1:7780, Daten ./data/travelbuddy.sqlite
npm start                        # ohne Watch
TRAVELBUDDY_PASSWORD='mindestens-12-zeichen' npm run user:create -- rolf "Rolf" --admin
```

- **Standardport ist 7780** (`PORT`). `npm run dev` und `npm start` laden **keine** `.env`; `npm run dev:live` und
  `npm run start:live` laden `server/.env` über `--env-file`.
- Der Web-Client (`web/dist`) wird ausgeliefert, sobald er gebaut ist (`TRAVELBUDDY_WEB_DIR`, sonst `./web` oder
  `../web/dist`). `/t/<token>` (Reise) und `/g/<token>` (Reisekasse) sind Client-Routen für Gäste-Links.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Neustart bei Änderungen |
| `npm start` | Server ohne Watch |
| `npm test` | Tests (`node:test`, Speicher-Datenbank, nie echtes Netz) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild-Bundle nach `dist/` (`index.mjs`, `create-user.mjs`, `set-password.mjs`, `migrations/`, `data/airports.json`) |
| `npm run start:prod` | `node dist/index.mjs` |
| `npm run user:create -- <name> <anzeigename> [--admin] [--email=…]` | Benutzer anlegen (Passwort interaktiv oder `TRAVELBUDDY_PASSWORD`) |
| `npm run user:password -- <name>` | Passwort setzen, alle Geräte abmelden |
| `npm run airports:build [-- pfad/airports.csv]` | `src/meta/airports.json` aus OurAirports neu erzeugen |
| `npm run eval:ingest [-- --all --limit N --no-ai]` | Eval der Dokumentanalyse gegen lokale PDFs und `import-in/homebuddy.sqlite` (nicht in CI; mit `OPENAI_API_KEY` auch KI-Lauf), siehe `docs/api/ingest.md` |
| `npm run import:homebuddy -- <homebuddy.sqlite> [--documents <ordner>] [--dry-run] [--include-unlinked-travel-docs]` | Import aus HomeBuddy (wiederholbar, mit Abnahme; Bericht nach `import-out/`), siehe `docs/api/import.md` |

## Umgebungsvariablen

Alle optional. Vollständige Liste mit Beispielwerten: `.env.example` im Repo-Root.

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `7780` | Port des Servers (im Container ebenfalls 7780; `TRAVELBUDDY_PORT` in `.env`/Compose ist nur der Host-Port der Veröffentlichung) |
| `HOST` | `127.0.0.1` (Container `0.0.0.0`) | Bindeadresse |
| `TRAVELBUDDY_DB_PATH` | `./data/travelbuddy.sqlite` | SQLite-Datei |
| `TRAVELBUDDY_DATA_DIR` | Ordner der Datenbank | Datenordner (`documents/`, `media/`, `apns/`) |
| `TRAVELBUDDY_DOCUMENTS_DIR`, `TRAVELBUDDY_MEDIA_DIR` | `<Datenordner>/documents`, `…/media` | Ablage der Dokumente bzw. Bilder, falls abweichend |
| `TRAVELBUDDY_TZ` | `Europe/Zurich` | Vorgabezone für neue Reisen und «heute» ohne Reise |
| `TRAVELBUDDY_WEB_DIR` | `./web`, `../web/dist` | gebauter Web-Client |
| `TRAVELBUDDY_CATALOG_PATH` | `../shared/event-types.json`, `./shared/…` | Ereignis-Katalog |
| `TRAVELBUDDY_ACCESS_LOG` | an | `0` schaltet das Zugriffsprotokoll ab |
| `TRAVELBUDDY_MAINTENANCE_MINUTES` | `5` | Hintergrundlauf (Dokumentanalyse inkl. Wiederholungen, Bilder); `0` = aus |
| `TRAVELBUDDY_AIRPORTS_PATH` | `src/meta/airports.json`, `dist/data/airports.json` | Flughafentabelle (JSON), falls abweichend |
| `TRAVELBUDDY_NOTIFY_SECONDS` | `60` | Intervall des Mitteilungs-Schedulers (Erinnerungen, Live Activities, Ruhezeiten); `0` = aus. Ohne APNs-Schlüssel Trockenlauf, siehe `docs/api/notifications.md` |
| `TRAVELBUDDY_ILLUSTRATIONS_DIR` | `./shared/illustrations`, `../shared/illustrations` (Container `/app/shared/illustrations`) | Wurzel der Illustrationen; Mitteilungsbilder `<dir>/notifications/<imageKey>.png` für `GET /v1/media/notification/<imageKey>` |
| `TRAVELBUDDY_BOOTSTRAP_IMPORT` | im Dev-Modus `../import-in/homebuddy.sqlite`, sonst aus | Quelle des Imports beim Start, wenn die Datenbank keine Reise enthält; `off` schaltet ab |
| `TRAVELBUDDY_DEV` | – | `1` verhält sich wie `npm run dev` (Bootstrap-Import aus `../import-in`) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | – | KI: Dokumentanalyse und Bilder; ohne Schlüssel nur Barcode/ICS/Pass, PDFs bleiben «übersprungen» |
| `TRAVELBUDDY_AI_MODEL_TEXT`, `…_VISION` | `gpt-4o-mini`, `gpt-4o` | Modelle der Dokumentanalyse (Text bzw. Scans/Fotos) |
| `TRAVELBUDDY_AUTO_CONFIRM_MIN` | `0.92` | ab dieser Sicherheit (und bestandenen Prüfungen) bestätigt die Analyse neue Ereignisse selbst; `> 1` = nie |
| `TRAVELBUDDY_TRIP_TOLERANCE_DAYS` | `7` | Toleranz um den Reisezeitraum, sonst «zu prüfen» |
| `TRAVELBUDDY_AI_CHUNK_CHARS` | `24000` | Höchstzeichen je KI-Aufruf; längere Dokumente werden seitenweise geteilt |
| `TRAVELBUDDY_AI_IMAGES`, `…_PER_RUN`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_BASE_URL`, `OPENAI_IMAGE_API_KEY` | an mit Schlüssel, 5, `gpt-image-1` | Reise- und Ereignisbilder (eigener Schlüssel optional) |
| `APNS_KEY`, `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `TRAVELBUDDY_APNS_DIR` | Team `9XZWUZ7Z26`, Topic `ch.rolfwalker.travelbuddy` | Push; die Datei `AuthKey_<KEYID>.p8` in `<Datenordner>/apns` genügt |
| `TRAVELBUDDY_MAPKIT_TEAM_ID`, `…_KEY_ID`, `…_KEY` oder `…_KEY_PATH`, `…_ORIGIN` | – | MapKit-JS-Token (`GET /v1/maps/token`) und Apple-Geokodierung |
| `TRAVELBUDDY_GEOCODER`, `…_GEOCODER_CONTACT`, `…_NOMINATIM_URL` | `auto` | `auto` (Apple mit Schlüssel, sonst Nominatim), `apple`, `nominatim`, `off` |
| `TRAVELBUDDY_BUILD`, `TRAVELBUDDY_BUILT_AT`, `TRAVELBUDDY_VERSION_FILE` | Git-Kurzhash bzw. «dev», Startzeit, `VERSION` | Angaben für `GET /v1/version` (setzt der Docker-Build) |
| `TRAVELBUDDY_PASSWORD` | – | nur für `user:create`/`user:password` ohne Rückfrage (mindestens 12 Zeichen) |

## Datenordner

Neben der Datenbank (oder in `TRAVELBUDDY_DATA_DIR`):

```
travelbuddy.sqlite (+ -wal, -shm)
documents/<sha256[0:2]>/<sha256>.<ext>   Originale (PDF, JPG, PNG, HEIC, .pkpass, .ics), Hash = Name
documents/thumbs/<sha256>.jpg            Vorschau der ersten PDF-Seite (nur mit poppler-utils)
media/trip_cover|event_image/…           Reise- und Ereignisbilder
media/notification/notif-*.png           Mitteilungsillustrationen (Standard: shared/illustrations, siehe TRAVELBUDDY_ILLUSTRATIONS_DIR)
apns/AuthKey_<KEYID>.p8                  Push-Schlüssel
```

Das alles ist echte Nutzerdaten-Ablage: nie ins Repo (`server/data/` und `*.sqlite` sind git-ignoriert).

## Aufbau

```
src/app.ts            Routen: Auth, Benutzer, Geräte, Push, Gäste, Reisekasse; baut die Module zusammen
src/trips/            Reisen, Ereignisse (service, routes), Orte, Heute/Tag/Zusammenfassung, ICS, Ausgabe aus Ereignis
src/ledgers/          Reisekasse: Aufteilung, Salden, Ausgleich, Wechselkurs (EZB)
src/catalog/          Ereignis-Katalog laden und Details validieren
src/ingest/           Dokumente: Upload, Ablage, Dubletten, Analyse (pipeline.ts, KI in openai.ts), Reise-Zuordnung
src/geo/              Geokodierung (Apple Maps Server API, Nominatim, Cache)
src/meta/             Flughafentabelle, Zeitzonen-Vorschlag, Katalog-Auslieferung
src/media/            Reise- und Ereignisbilder (KI, optional)
src/push/             APNs-Transport, Notifier
src/maps/             MapKit-JS-Token
src/import/           Import aus HomeBuddy (Abbildung, Zeitzonen, Abnahme, Bootstrap beim Start)
src/db/migrations/    001_init.sql (konsolidiert, nur vorwärts)
scripts/              Benutzerverwaltung, Flughafentabelle, Import aus HomeBuddy (`import-homebuddy.ts`)
test/                 node:test
```

## Docker

`server/Dockerfile` (Build-Kontext Repo-Root) und `docker-compose.yml` im Repo-Root; siehe Kopfkommentar der
Compose-Datei. Das Image enthält Server, Web-Client, Katalog und `VERSION`, dazu `poppler-utils` (PDF-Vorschauen, Seitenbilder für Scans)
und `libheif-examples` (`heif-convert` für HEIC-Fotos in der Dokumentanalyse).
Port im Container und auf dem Host: 7780 (`127.0.0.1:7780:7780`).
