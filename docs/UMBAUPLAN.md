# TravelBuddy – Umbauplan

Stand: 11.10.2026. Grundlage: Durchsicht von `HomeBuddy` (Server, Web, Apple-App, lokale Datenbank).
Dieses Dokument beschreibt, **wie** HomeBuddys Reiseteil in eine eigene App ausgelagert wird. Es wird noch nichts gebaut.

## 1. Ausgangslage

| | HomeBuddy heute | TravelBuddy heute |
|---|---|---|
| Server | TypeScript, Hono, SQLite, ~16 000 Zeilen, 209 Tests | – |
| Web | Vite + React, ~25 000 Zeilen, Design «Kontor» | – |
| Apple-App | SwiftUI Multiplatform, ~17 600 Zeilen, Widgets, Push, TestFlight Build 2 | leere Xcode-Vorlage (`Hello, world!`) |
| Daten (lokal) | 2 Reisen, 43 Ereignisse, 6 Teilnehmer, 2 Reisekassen (29 Ausgaben, 22 Rückzahlungen), 1 518 Dokumente | – |

**Der Reiseteil ist schon sauber vom Rest getrennt.** `server/src/trips/` (Reisen, Ereignisse, ICS, Gäste-Links) und
`server/src/ledgers/` (Reisekasse: Aufteilung, Salden, Fremdwährung, Ausgleich) kennen Paperless nicht. Die
einzige Kopplung ist `trip_event_documents → documents` und die Übernahme aus einer KI-Analyse
(`adoptTripFromDocument`). Das macht den Umbau günstig: **kopieren, kappen, ersetzen**, nicht neu schreiben.

## 2. Zielbild

```
iPhone / iPad (SwiftUI)  ─ Teilen-Menü / Upload ─┐        Web (Browser)
        │                                          │            │
        └───────────────── /v1 JSON ───────────────┴────────────┘
                              │
                     TravelBuddy-Server (Hono)
   ┌────────────┬─────────────┼───────────────┬──────────────┐
 Eingang      Reisen        Reisekasse     Push / ICS     Bilder
(PDF → Text   (Ereignisse,  (Ausgaben,     (APNs,         (Cover,
 → KI → Vor-   Teilnehmer,   Salden,        Kalender)      Karten)
 schläge)      Heute)        Ausgleich)
                              │
                           SQLite + Dateispeicher (PDFs, Bilder)
```

Ein Dokument kommt rein, wird ausgewertet, und **schlägt** Ereignisse **vor**. Der Mensch bestätigt (oder
Auto-Übernahme bei hoher Sicherheit). Die Reise wächst dadurch Stück für Stück.

## 3. Was übernommen wird, was neu ist, was entfällt

### Übernehmen (Kopie, anpassen)

| Baustein | Quelle in HomeBuddy | Anpassung |
|---|---|---|
| Auth, Benutzer, Geräte-Tokens, Rollen | `server/src/auth/` | Rollen vereinfachen: Admin, Mitglied; Gäste per Link |
| Reisen, Ereignisse, Kommentare, ICS | `server/src/trips/` | Datenmodell erweitern (siehe 5) |
| Reisekasse | `server/src/ledgers/` | 1:1; `cashbook` und Paperless-Bezug entfallen; automatisch je Reise |
| Wechselkurse (EZB) | `ledgers/fx.ts` | unverändert |
| Teilen-Links für Mitreisende | `trip_travelers.share_token` | wird mit Reisekasse-Mitgliedern zusammengelegt |
| KI-Client, Wiederholung bei ungültigem JSON | `ai/llm.ts`, `analyze.ts` (`runAnalysisModel`) | Prompt neu, nur Reise |
| Bilder (Cover, Ereignisbilder) | `server/src/media/` | nur `trip_cover`, `event_image` |
| Push (APNs) | `server/src/push/` | Auslöser: Kommentar, neue Ausgabe, Erinnerungen vor Abflug/Check-in |
| Karten (MapKit JS), Betrieb, Docker, Access-Log | `maps/`, `web/static.ts`, `Dockerfile` | Namen und Pfade |
| Apple-App: API-Client, Keychain, Geld, Reisen, Abrechnung | `HomeBuddy/Kit`, `Features/Trips`, `Features/Ledgers` | in `TravelBuddy` umziehen |
| Web: Reisen, Zeitleiste, Abrechnung, Gäste-Ansichten | `web/src/trip`, `pages/TripDetail`, `pages/LedgerDetail`, `guest/` | dito |

### Entfällt (bleibt in HomeBuddy)

Paperless-Sync und -Client, Rechnungen, Zahlungsstatus, Fristen, Garantien, Finanzen, Kreditkarten, Steuern, Prüf-Queue
(Inbox/Triage), Briefing, Wissensbereiche, Rechnungs-Widgets. Rund **60 %** des Servers und der Oberflächen.

### Neu

1. **Eingang**: Datei-Upload (Web), Teilen-Menü (iPhone/iPad), eigener Dokumentspeicher, Textextraktion.
2. **Auswertung für Reisen**: eigener Prompt und Schema, Typ-Erkennung, Zusammenführen, Vorschläge mit Quelle.
3. **Heute-Modus** für aktive Reisen.
4. **Ereignis-Katalog** mit allen wichtigen Feldern je Typ (Abschnitt 6).
5. **Offline-Cache** auf dem Gerät (Tickets am Flughafen ohne Netz).
6. **Infografiken** (Route, Zeitband, Reise in Zahlen, Kasse).

## 4. Eingang: PDF → Reise («zuverlässig auswerten»)

### KI oder Regeln? Beides, mit klarer Arbeitsteilung

Reine Regeln scheitern an der Vielfalt: Hotelbestätigung von Booking, Royal-Caribbean-Reiseunterlagen,
Mietwagen-Voucher, SBB-Ticket, Pauschalreise in drei Sprachen und mit eigenem Layout je Anbieter. Pro Anbieter ein
Parser wäre nie fertig und bräche bei jeder Layout-Änderung. **Die Extraktion braucht deshalb ein Sprachmodell.**
Alles, was *prüfbar* ist, macht dagegen Code, ohne KI:

| Aufgabe | Wer | Warum |
|---|---|---|
| Text aus PDF (Textebene) | Code | exakt, kostenlos |
| Scan/Foto lesen | KI (Vision) | Tabellen und Bordkarten, die OCR zerlegt |
| **Bordkarten-Barcode** (IATA BCBP: PNR, Flug, Sitz, Strecke, Datum), **ICS-Anhänge**, `.pkpass` | Code | strukturiert und eindeutig, schlägt jede KI |
| Typ erkennen, Felder aus Fliesstext holen | KI | Kernaufgabe |
| IATA → Flughafen/Zeitzone, Flugnummer-Muster, Datumslogik, Plausibilität | Code | kontrolliert die KI |
| Zusammenführen, Dubletten, «nicht überschreiben» | Code | deterministisch |
| Cover-Bilder | KI (Bildmodell) | gibt es schon |

**KI extrahiert, Code verifiziert.** Weicht ein KI-Wert von einem Barcode ab, gewinnt der Barcode und das Feld
wird markiert. **Ohne KI-Schlüssel bleibt die App voll nutzbar**: Upload, Ablage am Ereignis, Barcodes,
manuelle Erfassung. Nur die automatischen Vorschläge fehlen.

**OpenAI fest vorgesehen** (Standardanbieter, über eine dünne Schnittstelle wie `LlmClient` in HomeBuddy):
Textmodell und Vision-Modell getrennt konfigurierbar (`OPENAI_API_KEY`, `TRAVELBUDDY_AI_MODEL_TEXT`,
`…_VISION`), strikte Strukturausgabe (JSON-Schema) statt «gib gültiges JSON», bei Fehlschlag ein Reparaturversuch,
danach «zu prüfen». Ein Dokument kostet im Bereich weniger Rappen; Kosten je Dokument werden mitprotokolliert.
Datenschutz: Dokumente enthalten Ticket- und Passnummern, sie gehen an OpenAI. Deshalb wird wenn möglich nur der
**Text** gesendet (nicht das Bild), und Passnummern werden vorher maskiert.

### Pipeline

HomeBuddy bekommt den OCR-Text fertig von Paperless. TravelBuddy muss ihn selbst liefern. Pipeline:

1. **Annahme**: Upload oder Teilen. Typ per Dateikopf prüfen (PDF/JPG/PNG, bleibt wie `sniffUpload`), SHA-256
   gegen Dubletten, Original **immer** speichern und am Ereignis anhängbar halten.
2. **Text**: PDF-Textebene (`pdfjs`/`pdftotext`). Fehlt sie (Scan, Foto): Seiten als Bild an ein Vision-Modell.
   Das ist zuverlässiger als klassisches OCR bei Tabellen, Bordkarten und mehrspaltigen Buchungen.
3. **Klassifizieren**: Flug / Zug / Hotel / Mietauto / Kreuzfahrt / Transfer / Ausflug / Versicherung / Visum / Sonstiges.
   Ein PDF kann mehrere Ereignisse enthalten (Pauschalreise).
4. **Extrahieren** mit streng typisiertem Schema, **generiert aus dem Ereignis-Katalog** (Abschnitt 6): alles, was
   man von Hand eintragen kann, kann auch erkannt werden und umgekehrt. Je Feld: Wert, Sicherheit, Seite.
5. **Normalisieren und prüfen**: IATA-Code → Flughafen, Zeitzone, Ort; Ende nach Beginn; Flugnummer-Muster;
   Datum liegt im Reisezeitraum (± Toleranz); Beträge in Minor Units.
6. **Zusammenführen** (der wichtigste Schritt für «nach und nach»): Schlüssel `Buchungsreferenz + Typ + Datum`
   oder `Flugnummer + Datum`. Treffer = **Ergänzung** (nur leere Felder, nie manuelle Werte überschreiben),
   sonst neues Ereignis. Neues PDF zur gleichen Buchung aktualisiert also, statt zu verdoppeln.
7. **Vorschlag statt Zwang**: Ereignis erscheint als «Zu prüfen» mit Quellenausschnitt. Ab einer Sicherheit
   (einstellbar) wird automatisch übernommen. Nichts geht still verloren, nichts wird still falsch.
8. **Zuordnung zur Reise**: nach Datum/Ort/Buchungsnummer zur passenden Reise, sonst «Neue Reise vorschlagen».

**Prüfbarkeit**: Die 45 bereits analysierten Reisedokumente und die 43 von Hand gepflegten Ereignisse in HomeBuddy
sind ein fertiger **Testsatz** (Dokument → erwartete Ereignisse). Damit lässt sich die Trefferquote messen, bevor
sie jemand im Urlaub braucht.

## 5. Datenmodell (Änderungen gegenüber HomeBuddy)

- **`participants`** statt zwei Listen (`trip_travelers` + `ledger_members`): eine Person je Reise, ein Token,
  optional ein Konto. Reise und Reisekasse teilen sich dieselben Personen. Paare bleiben.
- **`trips`**: `home_currency`, `cover_media`, `status` (geplant / aktiv / vorbei) wird aus Daten abgeleitet.
- **`trip_events`**: neu `start_tz`, `end_tz` (IANA, z. B. `Europe/Zurich`, `America/New_York`), `status`
  (`confirmed` | `proposed` | `needs_review`), `source_document_id`, `participant_ids` (wer ist dabei),
  `price_minor` + `currency` + `payment_status`, `cancel_until`, `fields_meta` (je Feld: Herkunft
  `manual|document|derived`, Sicherheit, Seite, gesperrt).
- **`documents`**: eigene Tabelle mit Datei auf Platte, Hash, Seiten, Text, Analyse-Status, Modell, Version.
- **`trip_event_documents`** bleibt N:M. Ein Dokument kann Ereignisse mehrerer Reisen belegen.
- **Beträge** bleiben ganzzahlig in Minor Units, Daten `YYYY-MM-DD`, Zeitstempel UTC (Konvention aus HomeBuddy).

Zeitzonen sind heute der grösste fachliche Mangel: «Miami 16:50 → Lissabon 06:00 (+1)» ist ohne Zone nicht
berechenbar, und der Heute-Modus würde auf Reisen falsch «jetzt» zeigen.

## 6. Ereignisse erfassen: alle wichtigen Angaben je Typ

**Ist-Stand HomeBuddy:** Flug (14 Felder) und Zug (5) sind brauchbar. Mietauto, Transfer und Kreuzfahrt kennen nur
Start, Ziel, Dauer. **Hotel, Unterkunft und Ausflug haben keine typspezifischen Felder.** Kosten, Teilnehmer,
Zeitzonen, Sitzplätze und Fristen fehlen überall. Dazu steht die Felderliste dreimal im Code (Server, Web, Swift).

**Lösung: ein deklarativer Katalog** (`event-types.json`), vom Server ausgeliefert (`GET /v1/meta/event-types`).
Server-Validierung, Web- und iOS-Formular und das KI-Schema werden daraus erzeugt. Ein neues Feld = eine Zeile.

### Gemeinsame Felder (jeder Typ)

Titel · Beginn/Ende (Datum, Uhrzeit, **Zeitzone**) · Ort, Adresse (mit Kartensuche, Koordinaten) · Anbieter ·
Buchungsreferenz · Kontakt (Telefon, E-Mail, Website) · **Wer ist dabei** (Teilnehmer) · Preis, Währung,
Zahlungsstatus, Zahler · Storno-/Zahlungsfrist (erzeugt Erinnerung) · Notizen · Anhänge · Status.
Aktion: **«Als Ausgabe in die Reisekasse übernehmen»** (Betrag, Zahler, Aufteilung vorbelegt).

### Typspezifisch

| Typ | Felder |
|---|---|
| **Flug** | Airline · Flugnummer · durchgeführt von (Codeshare) · Buchungscode (PNR) · Ticketnummer je Person · **Sitz je Person** · Klasse · Abflug: Flughafen (IATA), Terminal, Gate, Check-in-Schalter, Check-in öffnet/schliesst, Boarding · Ankunft: Flughafen, Terminal, Gepäckband · Freigepäck (Hand/Aufgabe) · Mahlzeit · Dauer · Flugzeugtyp/Kennzeichen · Vielfliegernummer · Status (planmässig/verspätet/gestrichen) |
| **Zug** | Betreiber · Zugnummer · Abfahrt (Ort, **Gleis**) · Ankunft (Ort, Gleis) · **Wagen und Sitz je Person** · Klasse · Ticketart/Gültigkeit (Zugbindung, Sparbillett) · Reservierungs-/Auftragsnummer · Umstiege · Dauer |
| **Hotel / Unterkunft** | Name · Adresse · Check-in ab · Check-out bis · Nächte (berechnet) · Zimmerart · Zimmer · Personen · Verpflegung · Buchungsplattform · Bestätigungsnummer · Gastgeber-Kontakt · **Schlüsselübergabe/Türcode** · WLAN · Parkplatz · Kurtaxe · Stornofrist · Zahlung (vor Ort/bezahlt/Anzahlung) |
| **Mietauto** | Vermieter · Reservierungsnummer · **Abholung** (Ort, Adresse, Zeit, Öffnungszeiten) · **Rückgabe** (Ort, Zeit) · Fahrzeugkategorie/Modell · Getriebe · Versicherung/Selbstbehalt · Kaution · Kilometer inklusive · Tankregel · Zusatzfahrer · Notfallnummer |
| **Transfer** (Taxi, Shuttle, Bus, Fähre) | Art · Anbieter · Abholort · Zielort · Abholzeit · Treffpunkt · Fahrer/Kontakt · Fahrzeug · Personen/Gepäck · Bestätigung |
| **Kreuzfahrt** | Reederei · Schiff · Routenname · Buchungsnummer · **Kabine** (Nummer, Kategorie, Deck) · Einschiffung (Hafen, Terminal, Zeitfenster, *All aboard*) · Ausschiffung · Tischzeit/Restaurant · Getränke-/Bordpaket · Reisedokumente · Notrufnummer. Hafentage als Unterereignisse: Ankunft, Abfahrt, **All aboard**, Tender ja/nein, Seetag |
| **Ausflug / Aktivität** | Anbieter · Treffpunkt · Startzeit · Dauer · Personenzahl · Voucher/Ticket · Sprache · Mitbringen · Storno · Preis |
| **Restaurant** *(neu)* | Name · Reservierung (Zeit, Personen, Name) · Tisch · Bestätigung · Dresscode |
| **Veranstaltung** *(neu)* | Titel · Veranstalter · Einlass · Beginn · Sitz/Block/Reihe · Ticketnummer · QR-Code |
| **Versicherung** *(neu)* | Versicherer · Police · Deckung · **Notfallnummer** · Schadenmeldung |
| **Visum / Einreise** *(neu)* | Dokument · Genehmigungsnummer · gültig von/bis · Antragsstatus (z. B. ESTA) |
| **Aufgabe / Notiz** *(neu)* | Titel · fällig · erledigt (z. B. Online-Check-in, Reisepass prüfen) |

### Bedienung

1. **Typ wählen** (Kacheln), dann ein Formular in **Abschnitten**: Zeit & Ort · Buchung · Typ-Details · Personen ·
   Kosten · Anhänge. «Nur Wichtiges» / «Alle Felder» (Progressive Disclosure), damit ein Flug in 20 Sekunden
   angelegt ist, aber nichts fehlen muss.
2. Felder tragen eine **Herkunft**: «aus Dokument» (Antippen öffnet die PDF-Seite), «von Hand», «berechnet».
   **Von Hand geänderte Felder sind gegen erneute Analyse geschützt.**
3. **«Aus PDF ergänzen»** an jedem Ereignis: Dokument anhängen, fehlende Felder werden vorgeschlagen.
4. Orts- und Flughafensuche mit Vervollständigung (IATA, Zeitzone, Koordinaten) statt Freitext.
5. Dasselbe Formular im Web und auf iPhone/iPad, aus demselben Katalog.

## 7. Heute-Modus (aktive Reise)

Ist die Reise aktiv, ersetzt die Startseite die Planübersicht durch den **heutigen Tag**:

- **Als Nächstes**, mit Countdown und Ort in lokaler Zeit des Reiseziels.
- **Der Tag**: Zeitleiste mit Check-in-/Boarding-/All-aboard-Zeiten, Buchungsnummern gross, Dokumente mit einem Tipp.
- **Wichtige Daten je Typ** werden bevorzugt gezeigt (Flug: Terminal, Gate, Sitz; Hotel: Adresse, Türcode;
  Mietauto: Abholort, Öffnungszeiten, Notfallnummer).
- **Morgen** als Vorschau, **Heute offen** (Aufgaben, Zahlungsfristen), kleines **Reisekasse-Eingabefeld**.
- **Widgets und Live Activity**: nächster Termin, Sperrbildschirm (Widget-Extension gibt es bereits).
- **Offline**: aktive Reise samt PDFs wird auf das Gerät geladen. Ohne Netz bleibt alles lesbar.

## 8. Reisekasse

Fachlogik **unverändert** (getestet): Aufteilungsarten gleich/Paar/exakt/Anteile, Ganzzahl-Rappen, Fremdwährung mit
Tageskurs, minimale Überweisungen, Teilrückzahlungen, Gäste dürfen eigene Ausgaben buchen. Änderungen:
automatisch zur Reise angelegt, gleiche Personen wie die Reise, Ausgabe lässt sich an ein Ereignis hängen
(Beleg = PDF desselben Ereignisses), Auswertung nach Tag und Kategorie.

## 9. Import aus HomeBuddy

Ein einmaliger, **wiederholbarer** Import (`import:homebuddy <db>`, Trockenlauf zuerst), arbeitet auf einer Kopie:

| Quelle | Ziel |
|---|---|
| `trips`, `trip_events` (inkl. `details`) | gleichnamig; Zeitzonen aus Ortsangaben abgeleitet, Unklares als «zu prüfen» |
| `trip_travelers` + `ledger_members` | `participants` (Abgleich über Konto, sonst Name) |
| `ledgers`, `expenses`, `expense_splits`, `settlements`, Paare | unverändert, **IDs bleiben** |
| `trip_event_comments` | gleichnamig |
| Verknüpfte Dokumente (27 Verknüpfungen) | **PDF einmalig aus Paperless laden** und als Datei speichern (HomeBuddy hat nur Verweise) |
| Gäste-Links | Tokens bleiben gültig |
| KI-Bilder | Cover und Ereignisbilder kopieren |

**Abnahme**: Je Teilnehmer wird der Saldo vor und nach dem Import verglichen (wie `import:familybrain`);
Abweichung > 1 Rappen bricht ab. Die Reisekasse «Ferien 2026» (27 Ausgaben, 22 Rückzahlungen, 4 Personen, CHF/EUR/USD)
ist damit der erste Prüfstein. Die Reise beginnt am 23.10.2026, der Import muss also **vorher** stehen und
mindestens zweimal gegen die echte Datenbank geprobt sein.

## 10. Plattformen

- **Web**: Vite/React aus HomeBuddy, neue Gestaltung (Abschnitt 11). Upload per Drag-and-drop.
- **iPhone/iPad**: SwiftUI, ein Target (die Vorlage `TravelBuddy` unterstützt iOS 27, iPadOS, macOS).
  Dazu eine **Share-Extension** (PDF aus Mail, Safari, Dateien, Wallet-Apps direkt in eine Reise),
  App-Group und gemeinsamer Schlüsselbund wie bei HomeBuddy. Mac läuft nebenher mit, ist aber kein Ziel.
- **iPad**: Dreispalten-Layout (Reisen · Plan · Detail/Karte) statt gestreckter iPhone-Ansicht.
- **Bundle-ID** Vorschlag `ch.rolfwalker.travelbuddy`, Team `9XZWUZ7Z26`.
- **Betrieb**: eigener Container, eigene Datenbank, eigene Domain; HomeBuddy bleibt unberührt.

## 11. Design und Infografiken

Siehe `designvorschlaege.html` (drei Richtungen mit Heute-Modus, Reiseübersicht, Erfassen, Infografiken).

Infografiken werden **aus den Daten gezeichnet** (SVG, deterministisch, immer korrekt), KI nur für Cover und
Stimmungsbilder (gibt es schon):

| Grafik | Zweck |
|---|---|
| **Routenbogen** | Reise als Linie über die Karte, Verkehrsmittel farbig |
| **Zeitband** | Alle Tage der Reise, wo man übernachtet, wann man unterwegs ist |
| **Tagesband** | Ein Tag auf der Zeitachse: Check-in, Boarding, Abfahrt, Pufferzeiten |
| **Reise in Zahlen** | Tage, Nächte, Kilometer, Flugstunden, Häfen, Länder |
| **Kasse nach Kategorie / Tag** | Gestapelter Balken, Tagesverlauf |
| **Ausgleich** | Salden um die Mittelachse, Pfeile «wer zahlt wem» |

## 12. Phasen

| # | Inhalt | Ergebnis |
|---|---|---|
| 0 | Entscheide (Abschnitt 13), Designrichtung wählen | Freigabe |
| 1 | Repo-Gerüst, Server-Kern kopieren und kappen, Datenmodell, Katalog, Tests grün | API ohne Paperless |
| 2 | **Import** aus HomeBuddy + Abgleich der Reisekasse | Daten stehen vor 23.10.2026 |
| 3 | Web: Reisen, Plan, Kasse, Erfassen aus Katalog | nutzbar im Browser |
| 4 | iPhone/iPad: Plan, Heute, Kasse, Erfassen, Offline | TestFlight |
| 5 | Eingang: Upload/Teilen, Pipeline, Vorschläge, Zusammenführen | PDFs bauen die Reise |
| 6 | Infografiken, Widgets, Push-Erinnerungen, Feinschliff | Release |

Die Phasen 1–4 liefern bereits **den heutigen Funktionsumfang** unabhängig von Paperless. Phase 5 ist das
eigentlich Neue. Vor der Reise (23.10.2026) ist realistisch: Phasen 1–4, der Import und eine erste Eingangsstrecke.

## 13. Offene Entscheide

1. **Designrichtung** (A Atlas, B Ticket, C Journal oder Mischung).
2. **Zugriff auf die produktive HomeBuddy-Datenbank** (`/home/homebuddy/data`) und **einmalig auf Paperless**, um die
   27 verknüpften PDFs zu holen. Ohne das fehlen die Belege an den Ereignissen.
3. **Domain** und Ort des Containers (gleicher Host wie HomeBuddy?).
4. ~~KI-Anbieter~~ **entschieden: OpenAI**, fest vorgesehen (Text, Vision, Bilder). Offen nur: eigener API-Schlüssel
   für TravelBuddy oder derselbe wie HomeBuddy (Empfehlung: eigener, damit Kosten getrennt sichtbar sind).
5. **Mitreisende**: eigenes Konto, nur Link, oder beides (heute: beides).
6. **Nach dem Umzug**: Reiseteil in HomeBuddy entfernen oder Verknüpfung «Dokument an TravelBuddy senden» anbieten.

## 14. Risiken

| Risiko | Gegenmassnahme |
|---|---|
| Fehlerkennung eines PDF zerstört einen korrekten Plan | Vorschläge statt Überschreiben, manuelle Felder gesperrt, Quelle sichtbar |
| Saldo der Reisekasse weicht nach Import ab | Abgleich je Person, Abbruch bei Abweichung, Wiederholung auf frischer Kopie |
| Zeitzonen falsch abgeleitet | Unsichere Fälle als «zu prüfen», Zone im Formular sichtbar und änderbar |
| Zu wenig Zeit bis 23.10.2026 | Reihenfolge so, dass Import und Lesen/Heute zuerst stehen; Erfassen und Eingang danach |
| Kein Netz unterwegs | Offline-Cache der aktiven Reise inkl. PDFs ab Phase 4 |
