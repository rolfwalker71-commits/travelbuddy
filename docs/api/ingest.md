# Eingang: Dokument → Reise (Paket «ingest»)

Stand: 11.10.2026. Beschreibt die Dokumentanalyse hinter `POST /v1/trips/:id/documents` und `POST /v1/documents`:
was ausgewertet wird, wie geprüft und zusammengeführt wird, welche Einstellungen es gibt und was die Clients
davon sehen. Grundlage: `docs/CONTRACT.md` (Abschnitte «Dokumente», «Adressen → Karte»), `docs/UMBAUPLAN.md` Abschnitt 4,
`shared/event-types.json`. Code: `server/src/ingest/`.

**Leitgedanke: KI extrahiert, Code verifiziert.** Was prüfbar ist (Barcode, Kalender, Pass, IATA, Zeitzonen,
Datumslogik, Zusammenführen, Sperren), macht Code. Ohne KI-Schlüssel bleibt die App voll nutzbar.

## 1. Ablauf

```
Upload ─▶ Dokument (pending) ─▶ Hintergrund: IngestAnalyzer.analyze(documentId)
  1. Quelle lesen        PDF-Textebene (unpdf, seitenweise) · .ics · .pkpass · JPG/PNG · HEIC (Umwandlung)
  2. Deterministisch     BCBP-Bordkarten (Text/Pass-Barcode), Kalendertermine, Pass-Angaben → Kandidaten
  3. Maskieren           Pass-/Ausweisnummern, Kartennummern, IBAN werden vor dem Senden ersetzt
  4. KI                  OpenAI, strikte Struktur (JSON-Schema aus dem Katalog), Text- oder Vision-Modell
  5. Normalisieren       Datum, Zeit, Beträge (Minor Units), Auswahlwerte, IATA, Flugnummer-Muster, Katalogprüfung
  6. Abgleich            Kandidaten gewinnen bei Widerspruch; Kennungen gegen den Dokumenttext; Zitate prüfen
  7. Prüfen              Ende nach Beginn, Flugzeiten über Zonen, Datum im Reisezeitraum ± Toleranz
  8. Reise zuordnen      verknüpfte Reise · sonst Buchungsnummer/Datum/Zielort · sonst `proposedTrip`
  9. Übernehmen          ergänzen (nur leere, nicht gesperrte Felder) oder neu anlegen; Dokument verknüpfen
 10. Karte               Adressen geokodieren, Zone aus Koordinaten, «Zu prüfen» an `notifier.review`
```

### Quellen

| Quelle | Text | Deterministisch | Vision |
|---|---|---|---|
| PDF mit Textebene | `unpdf` (reines Node), je Seite mit Seitennummer | BCBP-Zeichenketten im Text | nein |
| PDF ohne/mit zu wenig Text (< 120 Zeichen oder < 40 je Seite im Mittel) | – | – | Seiten als JPEG (`pdftoppm`, höchstens 8) oder, ohne poppler, das PDF als Dateieingabe (höchstens 20 MB) |
| JPG/PNG | – | – | Bild |
| HEIC | – | – | nach Umwandlung (`sips`, `heif-convert`, ImageMagick; im Docker-Image `libheif-examples`); sonst «übersprungen» mit Hinweis |
| `.ics` | lesbare Fassung der Termine | Termine → Kandidaten (Typ per Stichwort), `TZID` = Ortszeit | nein |
| `.pkpass` | alle Pass-Felder als Text | BCBP im Barcode → Flug, sonst grobes Ereignis | nein |

Barcodes werden **nicht aus Bildern dekodiert** (keine leichte Abhängigkeit); BCBP wird aus Klartext und aus
Pässen gelesen. Der Textweg versteht auch BCBP-Zeichenketten, deren Leerzeichen die Textextraktion zusammengefasst hat.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `OPENAI_API_KEY` | – | ohne Schlüssel keine KI: nur Barcode, Kalender, Pass; sonst `analysisStatus = "skipped"` mit Hinweis |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | jeder OpenAI-kompatible Endpunkt |
| `TRAVELBUDDY_AI_MODEL_TEXT` | `gpt-4o-mini` | Modell für Text |
| `TRAVELBUDDY_AI_MODEL_VISION` | `gpt-4o` | Modell für Scans und Fotos |
| `TRAVELBUDDY_AUTO_CONFIRM_MIN` | `0.92` | ab dieser Sicherheit (und bestandenen Prüfungen) wird ein neues Ereignis `confirmed`; `> 1` schaltet die Automatik ab |
| `TRAVELBUDDY_TRIP_TOLERANCE_DAYS` | `7` | Toleranz um den Reisezeitraum, sonst `needs_review` |
| `TRAVELBUDDY_AI_CHUNK_CHARS` | `24000` | Höchstzeichen je KI-Aufruf; längere Dokumente werden seitenweise in Teile geschnitten |

Der Hintergrundlauf (`TRAVELBUDDY_MAINTENANCE_MINUTES`) holt mit Schlüssel auch Dokumente nach, die zuvor «ohne
Schlüssel» übersprungen wurden (Marker `KI nicht konfiguriert` in `analysisError`).

## 2. KI-Anbindung (`openai.ts`)

- `POST {OPENAI_BASE_URL}/chat/completions`, `response_format: json_schema` mit `strict: true`.
- Eingabe: Text im Prompt; Scans als `image_url` (Data-URL) oder `file` (PDF-Data-URL).
- **Schema aus dem Katalog** (`schema.ts`): je Ereignis `type` (Enum der Typ-IDs), `confidence`, `fields[]`
  (`key` aus dem Katalog, `value` als Text, `confidence`, `page`, `quote`, `currency`), `addressParts`,
  `passengers[]`. Das Schlüsselverzeichnis im Prompt (Typen, Felder, Auswahlwerte, Formate)
  kommt ebenfalls aus `shared/event-types.json`; ein neues Feld dort ist nach einem Neustart erkennbar.
  Geldfelder heissen im Schema ohne «Minor» (`price`, `deposit`, `deductible`, `touristTax`); die KI liefert
  Dezimalzahlen der Hauptwährung, der Code rechnet in Minor Units um.
- Ungültige Ausgabe: **ein Reparaturversuch** (Fehlerliste + vorige Ausgabe), danach Fehler → `failed` mit Backoff.
- Fehler: Netz, Zeitüberschreitung, 408/409/429/5xx, leere oder abgeschnittene Antwort (`finish_reason: length`)
  sind wiederholbar (`runAnalysis`: 5 min, 10 min, 20 min … höchstens 6 h, 5 Versuche); 400/401/403/404 und eine
  Ablehnung durch das Modell werden **nicht** wiederholt (`analysisNextRetryAt = null`), der Text steht in `analysisError`.
- **Protokoll** `ai_usage` (Migration `002_ai_usage.sql`): je Aufruf Modell, Modus (`text`/`vision`), Zweck
  (`extract`/`repair`), Tokens, geschätzte Kosten in Mikro-US-Dollar (Preistabelle in `usage.ts`, `NULL` bei
  unbekanntem Modell), `ok`/`error`. Fehlgeschlagene Aufrufe werden mitprotokolliert.

### Datenschutz

- Wo Text vorhanden ist, geht **nur Text** an die KI, nicht das Bild.
- Vor dem Senden ersetzt `mask.ts`: Pass-/Ausweisnummern (Schlüsselwort + Nummer), Kartennummern (Luhn, 15–19 Ziffern,
  nicht nach «Ticket»), IBAN. Ticketnummern, Buchungscodes und BCBP bleiben. `documents.text` und alle Zitate
  stammen aus der maskierten Fassung.
- **Scans und Fotos** gehen als Bild bzw. PDF an die KI und lassen sich nicht maskieren.

## 3. Prüfen und normalisieren

- **Typ:** Katalog-ID oder Alias; unbekannt → `Ausflug` + `needs_review`.
- **Felder:** Pro Feld `confidence`; unter `0.5` wird das Feld nicht übernommen (Hinweis), unter `0.75` gilt es als
  zu prüfen. Jedes Detail wird einzeln gegen den Katalog gehalten (Muster, Auswahl, Länge); ein ungültiger Wert
  entfällt mit Hinweis, das Ereignis entsteht trotzdem.
- **Auswahlwerte:** Synonyme (`Bed & Breakfast` → `Fruehstueck`, `Economy Class` → `Economy`, `2. Klasse` → `Economy`,
  `Port of call` → `Hafen`, `Ferry` → `Faehre` …); sonst weggelassen, der Originalwert bleibt im Zitat.
- **Beträge:** `1’234.50`, `1.234,50`, `CHF 89,9` → Minor Units; Währung aus ISO-Code/Symbol; ohne erkennbare Währung
  Hinweis (nie stillschweigend die Heimwährung). Beträge in Detailfeldern gelten in der Währung des Preises.
- **Zeitzonen:** `startTz`/`endTz` nur aus dem Dokument; Flüge leitet der Server aus IATA ab. Für alle übrigen Typen
  wird `startTz` nach der Geokodierung aus den Koordinaten abgeleitet, wenn sie von der Reisezone abweicht
  (`fieldsMeta.startTz = { source: "derived" }`). UTC-Zeiten aus Kalendern werden in die Reisezone umgerechnet.
- **Flug über Zonen:** Aus Abflug-/Ankunftszeit und Zonen wird die Ankunft am Folgetag («+1») abgeleitet
  (`endDate`, `source: "derived"`, zu prüfen); unmögliche Dauern (≤ 0 oder > 26 h) → `needs_review`.
- **Reisezeitraum:** Datum ausserhalb ± Toleranz → `needs_review`; das Ereignis verbreitert die Reise **nicht**
  (ausgenommen Versicherung, Visum, Aufgabe).
- **Gegenprüfung (Code gegen KI):**
  - BCBP/Pass-Barcode: Flugnummer, Strecke, PNR, Datum (Julianischer Tag → Jahr nahe am Reisebeginn), Sitz.
    Widerspruch → **Barcode gewinnt**, `fieldsMeta.<feld>.needsReview = true`, Hinweis `barcode_conflict`.
  - Kalender mit `TZID`/Ortszeit: Datum und Zeiten gewinnen gegen die KI (UTC-Termine nur das Datum).
  - Kennungen (Buchungsreferenz, Flug-/Zugnummer, Bestätigungs-/Policen-/Genehmigungsnummer, Voucher) müssen im
    Dokumenttext stehen. Fehlen sie und gibt es genau **einen** Regel-Treffer (Buchungscode neben Stichwort,
    Flugnummer mit bekanntem Präfix), gewinnt die Regel (`rule_override`); sonst bleibt der Wert, die Sicherheit
    sinkt auf höchstens 0.6 und das Feld ist markiert.
  - IATA-Codes: in der Flughafentabelle und im Text (Code oder Stadt) vorhanden.
  - Zitate: nicht auffindbare entfallen, falsche Seitenangaben werden korrigiert.
- **Status neuer Ereignisse:** `confirmed` nur mit Ereignis-Sicherheit ≥ `TRAVELBUDDY_AUTO_CONFIRM_MIN`, KI beteiligt
  und ohne offene Prüfpunkte; `needs_review`, sobald ein Prüfpunkt offen ist (Hinweis mit `needsReview`, Feld mit
  Markierung oder Sicherheit < 0.75); sonst `proposed`. Nur aus Barcode/Kalender/Pass (ohne KI): immer `proposed`.

## 4. Zusammenführen

Gleiche Buchung = Ergänzung statt Dublette (`match.ts`):

| Typ | Schlüssel |
|---|---|
| Flug | `flightNumber + startDate`; sonst Strecke + Datum; sonst PNR + Datum |
| Zug | `trainNumber + startDate (+ startTime)`; sonst Buchungsnummer + Datum + Bahnhöfe |
| Hotel/Unterkunft | `bookingReference + startDate`; sonst Name (ähnlich) + Check-in |
| Kreuzfahrt | `entryKind + startDate + Ort` (+ Buchungsnummer, falls beide) |
| übrige | `bookingReference + Typ + startDate (+ startTime)` |

Ein Treffer ergänzt über `applyExtraction`: nur **leere, nicht gesperrte** Felder (auch in `details`), bestehende
Werte werden nie überschrieben; abweichende Werte stehen in `analysis_json.applied.conflicts`. Hängt das Dokument
an einem Ereignis (Upload mit `eventId`) und gibt es keinen Schlüsseltreffer, ergänzt der einzige erkannte
Vorschlag des gleichen Typs dieses Ereignis. Sonst entsteht ein neues Ereignis mit `sourceDocumentId` und
Verknüpfung zum Dokument. **Erneute Analyse ist idempotent.**

`fieldsMeta` je Feld: `{ source: "document" | "derived", confidence, documentId, page, quote, needsReview? }`.
Passagiere werden über den Namen den Mitreisenden zugeordnet (`details.passengers[].participantId`, `participantIds`
nur, wenn alle erkannten Personen Mitreisende sind und es weniger als alle sind); nicht zuordenbare stehen als
Zeile «Passagiere laut Dokument: …» in `notes`.

## 5. Reise-Zuordnung und `adopt-trip`

`POST /v1/documents` (Einwurf): Der Server wertet aus und bewertet alle Reisen:

| Signal | Punkte |
|---|---|
| Buchungsnummer (auch Bestätigungs-/Policennummer) kommt in einem Ereignis der Reise vor | 100 |
| Zeitraum des Dokuments überlappt die Reise (± 3 Tage) | 40, +20 wenn vollständig darin |
| Zielort/Reisetitel kommt in Orten des Dokuments vor | 25 |

Eindeutig ist: ≥ 100 Punkte, oder ≥ 60 Punkte und 25 Punkte Abstand zum Zweiten. Dann wird das Dokument der Reise
zugeordnet und die Ereignisse werden dort angelegt/ergänzt. Sonst: **keine Ereignisse**, `documents.proposedTrip`:

```json
{ "title": "Reise Barcelona 12.03.2027", "destination": "Barcelona", "startDate": "2027-03-12", "endDate": "2027-03-15",
  "timezone": null, "eventCount": 2, "candidateTripIds": [3, 7] }
```

Die erkannten Ereignisse liegen in `analysis_json.events` (Quelle für die Übernahme, kein erneuter KI-Aufruf).

### `POST /v1/documents/:id/adopt-trip` (Admin)

Legt aus `proposedTrip` eine Reise an und übernimmt die Vorschläge. Optionaler Body (alles überschreibbar):

```json
{ "tripId": 7, "title": "…", "destination": "…", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",
  "timezone": "Europe/Lisbon", "homeCurrency": "CHF" }
```

- Mit `tripId`: keine neue Reise, die Vorschläge gehen in die vorhandene (z. B. aus `candidateTripIds`).
- Antwort `201`: wie `GET /v1/trips/:id` (`trip`, `travelers`, `events`) plus `tripId`, `created`, `merged`, `document`
  (`proposedTrip` ist danach `null`).
- Fehler: `409 no_proposed_trip` (kein Vorschlag, oder bereits übernommen), `409 already_assigned` (Dokument hängt
  schon an einer Reise und es wurde keine `tripId` genannt), `409 analysis_unavailable` (Analyse nicht aktiv),
  `404` Dokument, `422` ungültige Werte.

## 6. Adressen → Karte

- `address` = Hauptadresse (Strasse, PLZ Ort, Land), `location` = Ortsname. Weitere Orte haben ab Katalog **Version 2**
  eigene Adressfelder (`kind: "text"`): Mietauto `pickupAddress`/`returnAddress`, Transfer und Zug
  `originAddress`/`destinationAddress`, Veranstaltung `venueAddress`, Kreuzfahrt `terminalAddress`. Die KI füllt sie
  wie jedes andere Feld (Schema und Prompt entstehen aus dem Katalog); bei Abholung ≠ Rückgabe sind es zwei
  verschiedene Adressen. Die Hauptadresse (`pickupAddress`, `originAddress`, `venueAddress`, `terminalAddress`) wird
  zusätzlich nach `address` übernommen, wenn dort nichts steht. Liefert ein Modell noch `placeAddresses[]`, wird es
  auf diese Felder abgebildet. `addressParts` bleibt in `analysis_json.events[].addressParts`.
- `places[]` (Serialisierung in `trips/places.ts`): je Ort `role` (`pickup`/`return`, `start`/`end`, `venue`, `stop`),
  `label` (Ortsname), `address` (aus dem Adressfeld, sonst für den ersten Ort `address` des Ereignisses),
  `lat`/`lon`. Koordinaten kommen vom Geokodierer (erster Ort → `lat`/`lon` des Ereignisses, weitere →
  `place_coords`), Flughäfen aus der IATA-Tabelle; von Hand gesetzte Koordinaten bleiben.
- Nach dem Anlegen löst der Server die Orte über den vorhandenen Geokodierer auf (`autoGeocodeEvent`, Suchbegriff =
  Adresse, sonst Ortsname + Reiseziel). Schlägt es fehl, lösen die Clients per MapKit auf.

## 7. Aufbau von `documents.analysis_json`

`version`, `textSource` (`pdf_text` | `vision` | `ics` | `pkpass`), `mode` (`text` | `vision` | `none`), `models`,
`documentKind`, `tripHint`, `tripId`, `proposedTrip`, `events[]` (vollständige Vorschläge mit `issues[]`,
`meta`, `status`), `applied` (`created[]`, `merged[]`, `conflicts[]`, `skipped[]`, `reviewCount`), `notes`, `masked`
(Anzahl maskierter Nummern), `candidates`, `candidateTrips[]`. `issues[]`: `{ field?, code, message, needsReview }`;
Codes u. a. `barcode_conflict`, `rule_override`, `value_not_in_document`, `outside_trip`, `arrival_next_day`,
`implausible_duration`, `invalid_value`, `catalog_invalid`, `low_confidence`, `unknown_type`, `no_date`.

## 8. Tests und Eval

- `npm test`: `server/test/ingest-*.test.ts` (ohne Netz; Fake-KI, Fake-Geokodierer; erfundene Texte für Flug, Hotel,
  Mietwagen, Kreuzfahrt-Reiseplan, Zug, Pauschalreise, BCBP, ICS, pkpass, Scan, Masken, Zusammenführen, Sperren,
  Fehler, Backoff, Zeitzonen, Reise-Zuordnung).
- `npm run eval:ingest` (nicht in CI): liest lokal `import-in/documents/*.pdf` und `import-in/homebuddy.sqlite`
  (git-ignoriert), misst offline die Textextraktion und schreibt `import-out/eval-ingest.json`; mit
  `OPENAI_API_KEY` in der Umgebung zusätzlich Vorschläge gegen die vorhandenen Ereignisse (Typ, Datum, Zeit,
  Referenz). Optionen: `--all` (alle PDFs, nicht nur solche mit Referenz), `--limit N`, `--no-ai`, `--docs`, `--db`, `--out`.

## 9. Bekannte Lücken

- Keine Barcode-Dekodierung aus Bildern/gerenderten Seiten (nur BCBP-Klartext und Pass-Barcodes).
- PDFs, die teils aus Text, teils aus Bildseiten bestehen, werden über die Textebene gelesen; einzelne Bildseiten
  gehen nicht ans Vision-Modell.
- Scans werden nicht maskiert (Bild/PDF direkt an OpenAI).
- HEIC braucht `sips` (macOS), `heif-convert` oder ImageMagick auf dem Server; das Docker-Image bringt `heif-convert`
  (`libheif-examples`) mit, ein lokaler Lauf ohne diese Werkzeuge lässt HEIC «übersprungen».
- Zusammengeführte Listen (`details.passengers`) werden nur gefüllt, wenn sie leer sind (keine Zeilen-Ergänzung).
- Der Modell-Preis in `usage.ts` ist eine Schätzung (Stand der Entwicklung) und bei neuen Modellen anzupassen.
