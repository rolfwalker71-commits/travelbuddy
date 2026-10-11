# Import aus HomeBuddy

Stand: 11.10.2026. Paket «import» (Welle 2). Code: `server/src/import/`, Skript `server/scripts/import-homebuddy.ts`,
Tests `server/test/import*.test.ts`. Hintergrund: `docs/UMBAUPLAN.md`, Abschnitt 9.

Der Import liest eine **Kopie** der HomeBuddy-Datenbank (nur lesend) und schreibt in die TravelBuddy-Datenbank. Er ist
wiederholbar (aktualisiert statt zu verdoppeln), prüft sich selbst (Abnahme) und rollt bei Abweichung alles zurück.
Echte Daten gehören nur nach `import-in/`, `import-out/` und `server/data/` (alle git-ignoriert).

## Aufruf

```bash
cd server
npm run import:homebuddy -- ../import-in/homebuddy.sqlite --dry-run          # Trockenlauf
npm run import:homebuddy -- ../import-in/homebuddy.sqlite                    # Import
npm run import:homebuddy -- <homebuddy.sqlite> [--documents <ordner>] [--dry-run] [--include-unlinked-travel-docs]
                            [--media <ordner>] [--summary <summary.json>] [--out <ordner>]
```

| Option | Bedeutung |
|---|---|
| `--documents <ordner>` | Ordner mit `manifest.json` und `paperless-<id>.<ext>`. Standard: `<ordner der sqlite>/documents`, falls vorhanden; sonst werden keine Dokumente übernommen |
| `--dry-run` | alles durchrechnen und prüfen, nichts schreiben (Datenbank und Dateien bleiben unberührt) |
| `--include-unlinked-travel-docs` | zusätzlich alle weiteren Reisedokumente des Manifests ohne Ereignis-Verknüpfung als **unzugeordnete** Dokumente übernehmen (Standard: aus) |
| `--media <ordner>` | HomeBuddy-Medienordner (`<kind>/<datei>`). Standard: `<ordner der sqlite>/media`, falls vorhanden |
| `--summary <datei>` | erwartete Zählungen und Salden. Standard: `<ordner der sqlite>/summary.json`, falls vorhanden |
| `--out <ordner>` | Ausgabeordner des Berichts. Standard: `import-out/` neben `import-in/`, sonst `<Datenordner>/import-out` |

Ziel ist die Datenbank aus `TRAVELBUDDY_DB_PATH` (Standard `./data/travelbuddy.sqlite`); Dokumente und Bilder liegen im
Datenordner daneben (`TRAVELBUDDY_DATA_DIR`, `TRAVELBUDDY_DOCUMENTS_DIR`, `TRAVELBUDDY_MEDIA_DIR`). Für Proben:
`TRAVELBUDDY_DB_PATH=/tmp/tb.sqlite npm run import:homebuddy -- …`.

**Exit-Code:** `0` in Ordnung, `2` Abweichung bei der Abnahme (alles zurückgerollt), `1` Fehler (Quelle fehlt,
keine HomeBuddy-Datenbank, Ausnahme). Der Bericht liegt als `report.json` und `report.txt` im Ausgabeordner.

## Abbildung

| Quelle (HomeBuddy) | Ziel (TravelBuddy) | Regel |
|---|---|---|
| `users` | `users` | Hash, `is_admin`, `active` unverändert; Geräte-Tokens werden **nicht** kopiert. Gleicher Benutzername (ohne Gross-/Kleinschreibung) im Ziel = vorhanden, bleibt unberührt (auch bei Wiederholung: ein im Ziel geändertes Passwort wird nie überschrieben) |
| `trips` | `trips` | Status, Daten, Texte unverändert; `home_currency` = Basiswährung der Kasse; `timezone` = `TRAVELBUDDY_TZ` (Standard `Europe/Zurich`) |
| `trip_events` | `trip_events` | siehe «Ereignisse»; `status = confirmed`, ausser bei unbekanntem Typ oder unsicherer Zeitzone (`needs_review`) |
| `trip_travelers` + `ledger_members` | `participants` | eine Person je Reise: Abgleich über das Konto, sonst über den Namen (ohne Gross-/Kleinschreibung); Rest bleibt je eigene Person |
| `ledgers` mit `trip_id` | `ledgers` (1:1 zur Reise) | Titel «Reisekasse: <Reisetitel>» (Regel des Servers); Basiswährung, Archivierung unverändert |
| `ledgers` ohne Reise (oder weitere zur selben Reise) | eigenständige `ledgers` | mit allen Mitgliedern |
| `ledger_couples` | `ledger_couples` | Zuordnung der Teilnehmer bleibt |
| `expenses`, `expense_splits`, `settlements` | gleichnamig | Beträge, Währung, Wechselkurs, `settled_status`, Aufteilung unverändert; Verweise auf Teilnehmer, Ereignis, Dokument werden übersetzt |
| `trip_event_comments` | `trip_event_comments` | Autor und Zeitpunkte bleiben |
| `trip_event_documents`, `documents` | `trip_event_documents`, `documents`, `trip_documents` | siehe «Dokumente» |
| `media` (`trip_cover`, `event_image`) | `media` | nur wenn die Datei im Medienordner liegt, siehe «Medien» |

**IDs:** In eine leere Datenbank werden die IDs der Quelle (Benutzer, Reisen, Ereignisse, Kassen, Paare, Ausgaben,
Rückzahlungen, Kommentare, bei Teilnehmern die Mitglieds-ID) übernommen, wenn sie im Ziel frei sind; sonst vergibt
SQLite neue. Massgeblich ist immer `import_map`.

### Kassabuch → Reisekasse (Regel)

Eine Abrechnung vom Typ `cashbook` hat in HomeBuddy ein verstecktes Solo-Mitglied («Konto»); die Reiseteilnehmer sind
keine Mitglieder. TravelBuddy kennt keine Kassabücher. Darum wird sie als normale Reisekasse mit den **Teilnehmern der
Reise** importiert:

- Das versteckte Mitglied wird **nicht** Teilnehmer; sein Platz geht an den **Ersteller** der Reise. Wahl, in dieser
  Reihenfolge: Teilnehmer mit dem Konto, das die Kasse (`created_by_user_id`) bzw. die Reise angelegt hat, sonst mit
  dessen Anzeigenamen; danach Teilnehmer mit dem Namen des ersten aktiven Administrators; sonst der erste Teilnehmer.
- Die Ausgaben werden vom Ersteller bezahlt, die Aufteilung liegt nur auf ihm. Beträge (Betrag, Währung, Kurs, Betrag in
  Basiswährung) und Summen bleiben erhalten; sein Saldo ist 0.
- Der Bericht listet die Kasse unter «Kassabücher» mit dieser Regel.

### Ereignisse

- **Typ:** über den Katalog (`shared/event-types.json`, Aliase wie `Mietwagen` → `Mietauto`). Unbekannte Typen werden
  `Ausflug` mit `status = needs_review`.
- **details:** nur Schlüssel des Katalogs. Unbekannte Schlüssel werden verworfen und im Bericht gezählt (nach
  Schlüsselname, nie mit Wert). Umbenannt werden `flightNumber` → `trainNumber` (Zug) sowie `originPlace` → `pickupPlace`
  und `destinationPlace` → `returnPlace` (Mietauto). `select`-Werte werden auf die Optionen normalisiert («Frühstück» →
  `Fruehstueck`, Beschriftung → Option), Zahlen und Zeiten aus Textformen gelesen; was danach nicht gültig ist, wird
  verworfen und gezählt. Jeder Wert läuft einzeln durch die Katalog-Prüfung des Servers.
- **Flug:** Koordinaten des Ereignisses = Abflughafen (`fieldsMeta.lat/lon = derived`), wenn leer.
- **Buchungsreferenz** wird wie im Server in Grossbuchstaben gespeichert.
- Es wird **nichts gesperrt** (`locked`); die spätere Analyse füllt nur leere Felder.

### Zeitzonen

HomeBuddy kennt keine Zonen. `startTz`/`endTz` werden in dieser Reihenfolge bestimmt (`fieldsMeta.startTz/endTz` trägt
`source = derived`, `confidence` und die Herkunft als `quote`):

| Herkunft | Sicherheit | Regel |
|---|---|---|
| `iata` | 1.0 | Flug: Zone von Abflug- und Ankunftsflughafen (`details` oder «ZRH → BCN» im Ort) |
| `coords` | 0.95 | `lat`/`lon` per Zeitzonen-Lookup (`tz-lookup`) |
| `place` | 0.8 | Zug/Transfer/Mietauto: Stadtname der Orte gegen die Flughafentabelle, nur wenn alle Treffer dieselbe Zone haben («Budapest-Keleti», «Zürich HB») |
| `lookahead` | 0.8 | mehrtägige Strecke (Kreuzfahrt, Zug, Transfer, Mietauto) mit bekanntem Start, aber unbekanntem Ende: Zone des ersten Folgeereignisses am Endtag |
| `carried` | 0.6 | Vorwärts-Übertragung: zuletzt bekannte Zone entlang der Zeit; ohne Uhrzeit gilt das Tagesende |
| `trip` | 0.5 | davor ist nichts bekannt: Zone der Reise |

**Unsicher → `needs_review`, Zone bleibt leer (nichts geraten):** Flug mit Flughafen, der nicht in der Tabelle steht;
Strecke mit Uhrzeit über einen Zonenwechsel hinweg, deren Ende sich nicht bestimmen lässt. Der Grund steht in
`fieldsMeta` und im Bericht («Zu prüfen»). Beispiel «Ferien 2026»: Zürich → Barcelona (Kreuzfahrt-Seetage übernehmen
`Europe/Madrid`) → Port Canaveral/Miami (`America/New_York`) → Lissabon → Zürich.

### Teilnehmer und Link-Tokens

Der Reise-Link `/t/<token>` (Reisender) und der Abrechnungs-Link `/g/<token>` (Mitglied) hatten in HomeBuddy je Person
zwei verschiedene Tokens; TravelBuddy hat einen (`participants.share_token`). Deshalb:

- Haupt-Token = der des Reisenden, sonst der des Mitglieds; **er bleibt unverändert**.
- Der zweite Token bleibt als **Alias** in `participant_token_aliases` gültig (beide Sichten lösen beide Tokens auf).
  Der Alias gilt nur, solange der Haupt-Token unverändert und nicht widerrufen ist: «Erneuern» oder «Widerrufen» macht
  auch den Alias unbrauchbar.
- Widerruf in der Quelle bleibt Widerruf.

### Dokumente

- Aus `--documents` werden die **verknüpften** Dokumente übernommen (Ereignis-Verknüpfung oder Beleg einer Ausgabe);
  mit `--include-unlinked-travel-docs` auch die übrigen Dokumente des Manifests (ohne Verknüpfung, erscheinen in der Inbox).
- Datei am Dateikopf geprüft, SHA-256 gegen das Manifest geprüft (Abweichung = Datei wird nicht übernommen, Verknüpfung
  fehlt, Abnahme schlägt fehl), Ablage `documents/<sha[0:2]>/<sha>.<ext>`.
- **Dublettenregel:** Gleiche SHA-256 wie ein vorhandenes Dokument = dasselbe Dokument; es wird nur verknüpft, nichts
  überschrieben.
- Felder: `title` = `suggested_title`, sonst `title`; `text` = OCR-Inhalt (`text_source = ocr`); `analysis_json` =
  Altanalyse, `analysis_status = done`, `analysis_model = homebuddy-import` (ohne Altanalyse bleibt `pending`);
  `source = upload`; `source_meta` = `{ importedFrom, paperlessId, homebuddyDocumentId }`; `file_name` = Originalname.
- Dateien werden erst **nach dem Festschreiben** geschrieben; ein Abbruch hinterlässt keine verwaisten Dateien.
- Es wird nie in Paperless geschrieben.

### Medien

Nur `trip_cover` und `event_image`, nur wenn die Datei unter `<medienordner>/<kind>/<datei>` existiert (`source =
imported`). Fehlende Dateien und nicht übernommene Arten (`ledger_cover`, `document_icon`, `event_map`,
`expense_image`) werden im Bericht gezählt. Enthält die Quelle keine Medien-Tabelle, steht das ebenfalls im Bericht.

## Idempotenz

`import_map(source, source_table, source_id, target_table, target_id)` hält die Zuordnung (`source = 'homebuddy'`).
Wiederholung aktualisiert die zugeordneten Zeilen; Teilnehmer, Ausgaben und alles andere entstehen nie doppelt.

Beim Aktualisieren gilt:

- Im Ziel **gesperrte** Ereignisfelder (`fieldsMeta.<feld>.locked`) bleiben, ebenso Status, Preis, Zahlung, Platzdaten.
- Ausgaben, Aufteilungen und Rückzahlungen werden aus der Quelle neu geschrieben (Änderungen im Ziel gehen verloren).
- Löschungen in der Quelle werden **nicht** nachgezogen.
- Titel der Reisekasse folgt dem Reisetitel, solange er die Vorgabe «Reisekasse: …» trägt.

## Abnahme

Innerhalb derselben Transaktion; Abweichung → `status = mismatch`, Rollback, Exit-Code 2:

- **Zählungen:** Benutzer, Reisen, Ereignisse, Teilnehmer (Personen), Reisekassen, Paare, Ausgaben, Rückzahlungen,
  Kommentare, Ereignis-Dokument-Verknüpfungen (übersprungen, wenn kein Dokumentenordner angegeben ist).
- **Summen** je Kasse und Währung (Betrag und Betrag in Basiswährung) für Ausgaben und Rückzahlungen.
- **Salden je Teilnehmer** (Basiswährung, `participantBalances` des Servers) gegen die aus den Quellzeilen gerechneten
  und – wenn `summary.json` vorliegt – gegen deren Salden (Abgleich über Anzeigename). Toleranz **1 Rappen**; die
  Summe der Salden einer Kasse muss 0 sein. Bei Kassabüchern: bezahlt/Anteil gegen `soloTotals`.
- Dazu, falls `summary.json` da ist: `counts.*` und je Kasse Anzahl und Summen je Währung.

## Bericht

`report.json` (maschinenlesbar) und `report.txt` (Datum `dd.mm.yyyy`, Zeit `hh:mm`): Zählungen Quelle/neu/aktualisiert,
Ereignisse nach Typ, alle Prüfungen, Salden je Teilnehmer, Kassabuch-Regel, Zeitzonen-Herkunft und «Zu prüfen»-Liste,
Katalog-Bereinigung (Zahlen je Schlüssel), Teilnehmer/Tokens (nur Anzahlen), Dokumente, Medien, Hinweise. Der Bericht
enthält **keine** Hashes, Tokens, Passwörter oder Dokumentinhalte.

## Bootstrap beim Start

`server/src/index.ts` ruft nach den Migrationen `bootstrapImport` auf. Importiert wird, wenn die Datenbank **keine Reise**
enthält und die Quelle existiert:

| Quelle | Wann |
|---|---|
| `TRAVELBUDDY_BOOTSTRAP_IMPORT=<pfad>/homebuddy.sqlite` | immer (Dokumente aus `<pfad-ordner>/documents`, `summary.json` und `media/` daneben) |
| `../import-in/homebuddy.sqlite` | im Dev-Modus (`npm run dev`, `npm run dev:live`), wenn die Datei da ist |
| `TRAVELBUDDY_BOOTSTRAP_IMPORT=off` | abgeschaltet |

Eine Abweichung bei der Abnahme oder ein Fehler legt den Start **nicht** lahm: der Server startet mit leerer Datenbank,
das Log nennt den Grund und den Pfad des Berichts. Der Bericht geht nach `import-out/` neben `import-in/`, sonst nach
`<Datenordner>/import-out`.

**Zugang:** Die HomeBuddy-Benutzer kommen samt Passwort-Hash mit; wer sich in HomeBuddy anmelden konnte, meldet sich mit
demselben Passwort an. Ist danach kein aktiver Benutzer (oder kein Administrator) vorhanden, wird **nichts erfunden**:
das Log nennt `TRAVELBUDDY_PASSWORD='…' npm run user:create -- <benutzername> <anzeigename> --admin`. Reisende ohne
Konto (z. B. Gäste) erreichen ihre Reise und Kasse weiter über ihre Links.

## Bekannte Grenzen

- Medien: nur mit vorhandenen Dateien; eine Quelle ohne `media`-Tabelle liefert keine Bilder.
- Zeitzonen sind abgeleitet; Seetage und Strecken ohne Orte übernehmen die letzte bekannte Zone (kein Schiffs-Zeitplan).
- Die Quelle muss ein konsistenter Schnappschuss sein (`sqlite3 .backup`); die Kopie wird nicht gegen laufende Schreiber
  abgesichert.
- Der Import setzt `trip_events.expense_id` auf die erste Ausgabe je Ereignis (wie der Server); weitere Ausgaben am
  selben Ereignis hängen nur über `expenses.trip_event_id`.
- Verknüpfungen von Dokumenten zu Ausgaben (`expenses.document_id`) werden übersetzt, wenn das Dokument übernommen wurde.
