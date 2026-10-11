# TravelBuddy – Gestaltung (Richtung B «Ticket»)

Reise als Mappe aus Tickets: warmes Papier, Tinte, Zinnoberrot als Signal, Codes in Monospace, Perforation und
Abrissstreifen als Gliederung. Ruhig, dicht, nachvollziehbar; kein Kinderstil. Liquid Glass nur für System-Leisten auf iOS.

## Schrift (ohne Serifen)
| Rolle | Schrift | Einsatz |
|---|---|---|
| Text | **Barlow** (400, 500, 600, 700) | Fliesstext, Listen, Formulare |
| Titel, Labels | **Barlow Semi Condensed** (500, 600, 700) | Überschriften, Kopfbänder, GROSSBUCHSTABEN-Labels mit 0,08 em Spationierung |
| Zeiten, Codes, Beträge | **IBM Plex Mono** (400, 500, 600) | Uhrzeiten, Buchungsnummern, Gate, Sitz, Beträge (tabellarisch) |
Web: `@fontsource/barlow`, `@fontsource/barlow-semi-condensed`, `@fontsource/ibm-plex-mono` (selbst ausgeliefert, CSP `font-src 'self'`).
iOS: TTF in `ios/TravelBuddy/Resources/Fonts` (Namen siehe `ios/project.yml`, `UIAppFonts`); Dynamic Type über `relativeTo:`.

## Farben
| Token | Hell «Papier» | Dunkel «Nachtpapier» |
|---|---|---|
| `bg` | `#ECE5D7` | `#151412` |
| `surface` | `#FBF8F1` | `#1F1D1A` |
| `surface2` | `#F1EBDD` | `#2A2723` |
| `line` | `#D4C9B4` | `#3A362F` |
| `ink` | `#1D1B18` | `#F1EBDD` |
| `mute` | `#6F675A` | `#A59C8B` |
| `accent` (Zinnober, Aktion/Jetzt) | `#D8452B` | `#F0653F` |
| `onAccent` | `#FFFFFF` | `#1A0E0A` |
| `positive` / `negative` | `#2F7D4F` / `#B3261E` | `#6FCF97` / `#F28B82` |
Typfarben (`color` im Katalog): `air #D8452B`, `ship #1F4E5F`, `stay #B48A2B`, `car #5B8C5A`, `rail #3C6E8F`, `transfer #7A5C99`,
`activity #C46A2D`, `food #A8433F`, `ticket #8A6F9E`, `safety #3F7A8C`, `doc #6F675A`, `task #6F675A`; im Dunkeln je ~12 % aufgehellt.
Semantikfarben stehen nie allein (immer Text, Vorzeichen oder Symbol). Kontrast mindestens WCAG AA.

## Bausteine
- **Ticket-Karte:** Kopfband (Typ-Icon, Typ GROSS, Referenz mono), Perforation (gestrichelt, seitliche Kerben), Hauptzeile
  (Abfahrt → Ankunft mit grossen Zeiten mono), Detailraster (Gate, Sitz, Terminal, …), Abrissstreifen mit Dokumenten/Aktionen.
- **Heute-Hero:** dunkle Karte mit Countdown-Ring, «Als Nächstes», Ort in lokaler Zeit.
- **Tagesband / Zeitband / Routenbogen / Kasse:** Infografiken aus Daten gezeichnet (SVG bzw. SwiftUI Shapes), Farben nur über Tokens.
- **Vorschlags-Chip:** «Vorschlag» (gestrichelter Rand) und «Zu prüfen» (Warnrand); Herkunftspunkt an Feldern:
  gefüllt = aus Dokument, Ring = von Hand.
- Radien 10 pt (Karten), 6 pt (Felder); Linien 1 pt; Abstände 4er-Raster.

## Illustrationen und Hilfskarten
Isometrisch (30°/30°), detailliert, technisch-präzise, keine Comic- oder Kinderzeichnung: feine Linien, Materialflächen mit
Licht-/Schattenseiten (drei Töne je Körper), Details wie Fenster, Gepäck, Gangways. Palette wie oben. Ablage und Index:
`shared/illustrations/` und `shared/illustrations/manifest.json`.

## Karten
Web: Apple Karten (MapKit JS). iOS/iPadOS: MapKit. Marker in Typfarbe mit Typ-Icon, Route als Linie in Reihenfolge,
Tagesfilter. Ohne MapKit-JS-Schlüssel: schematischer SVG-Routenbogen.

## Datum/Zeit
`dd.mm.yyyy` und `hh:mm`, Wochentag ausgeschrieben («Sonntag, 25.10.2026»). Zeiten mit Zone nur, wenn sie von der
Reisezone abweicht («14:05 Ortszeit Miami»).
