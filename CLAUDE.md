# TravelBuddy – Arbeitsregeln

Reiseplanungs-App (Server, Web, iPhone/iPad), ausgelagert aus HomeBuddy. Verbindliche Vorgaben:
`docs/CONTRACT.md` (API), `docs/DESIGN.md` (Gestaltung, Richtung B «Ticket»), `shared/event-types.json` (Ereignis-Katalog),
`docs/UMBAUPLAN.md` (Hintergrund). Referenz-Code: `/Volumes/INT_SSD_VOL2/DEVELOPMENT/HomeBuddy` (nur lesen).

## Regeln für Texte und Daten
- Deutsch, Schweizer Rechtschreibung: **nie «ß»**, immer «ss».
- Anzeige Datum/Zeit **immer** `dd.mm.yyyy` und `hh:mm` (24 h). Zahlen de-CH (`1’234.50`). Speicher/API bleiben ISO.
- Beträge ganzzahlig in Minor Units (Rappen).

## Sicherheit
- Keine Schlüssel, Tokens, `.env`-Inhalte, `.p8`-Dateien oder echte Reisedaten ins Repo, in Logs oder in Chatausgaben.
  `.env`-Dateien nur über `--env-file` laden, nie ausgeben.
- Echte Daten (SQLite, PDFs) nur unter `import-in/`, `import-out/`, `server/data/` (alle git-ignoriert).
- Nie in Paperless schreiben (nur lesen). Nie auf produktive Systeme schreiben.

## Zusammenarbeit
- Jedes Paket besitzt Verzeichnisse (siehe Auftrag). Fremde Verzeichnisse nicht ändern; Wünsche an den Vertrag in der
  Abschlussmeldung nennen, nicht still umsetzen.
- Keine Git-Befehle, die das Repo verändern (kein add/commit/push/checkout/stash). Committen übernimmt die Hauptsitzung.
- Xcode: eigener `-derivedDataPath /private/tmp/claude-501/tb-dd-<paketname>`, nie mehrere xcodebuild mit demselben Pfad.
  Simulator-Tests nur das Paket «ios-app». `xcodegen generate` ist idempotent; in `ios/project.yml` nur den eigenen Target-Block ändern.
- Version steht in `VERSION`; in Einstellungen/Konto sichtbar (siehe Vertrag «Version»).
