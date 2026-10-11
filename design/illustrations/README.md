# TravelBuddy – Illustrationen (Toolkit und Szenen)

Isometrische (30°/30°), technisch-präzise Illustrationen für Ereignistypen, leere Zustände, Hilfekarten, Reise-Cover und
Mitteilungsbilder. Alles wird aus Code erzeugt: kleines Node-Toolkit ohne Abhängigkeiten, SVG als einzige Quelle, PNG per
macOS-Bordmittel. Ausgabe liegt unter `shared/illustrations/` (siehe `manifest.json` und `index.html` dort).

## Aufruf

```
node design/illustrations/build.js                 # alles: 35 Szenen x hell/dunkel -> 70 SVG + 70 PNG (+12 flache Mitteilungs-PNG), Manifest, Hilfekarten, Kontaktbogen
node design/illustrations/build.js type-Flug help-share   # nur einzelne Szenen (Manifest bleibt unverändert)
node design/illustrations/build.js --no-png        # nur SVG (und Manifest)
node design/illustrations/build.js --scale 1       # PNG nur in 1x (schnelle Sichtprüfung)
node design/illustrations/build.js --out <ordner>  # in ein anderes Verzeichnis schreiben
```

Voraussetzungen: Node 18+ und die Xcode Command Line Tools (`swiftc`) für den PNG-Export. Kein `npm install`.

## Render-Verfahren (getestet)

| Verfahren | Ergebnis |
|---|---|
| `qlmanage -t -s <px>` | funktioniert, liefert aber **quadratische** Vorschaubilder (Seitenverhältnis geht verloren) → verworfen |
| **Swift + AppKit (`NSImage` → CoreSVG → CGContext → ImageIO)** | **gewählt:** exakte Pixelgrösse, Gradienten, Strichmuster und Deckkraft korrekt, 0,1 s je Bild |

`tools/render.swift` wird beim ersten Lauf nach `$TMPDIR` kompiliert und danach wiederverwendet. Es rendert mit
derselben Engine (CoreSVG), die Xcode für SVG-Assets und SwiftUI verwendet, und liefert Rohpixel. Daraus entsteht in
Node (`tools/png8.js`, ohne Abhängigkeiten) ein **indizierter PNG** (256 Farben, Median Cut + k-Means, Zeilenfilter
adaptiv, zlib Stufe 9). Der Hintergrund ist Teil des Bildes. Typen, Leerzustände, Hilfekarten und Cover in **2x**
(Typ-, Leerzustands- und Hilfekarten 2400 x 1600, Cover 3200 x 1800), Mitteilungsbilder in **1x** (1200 x 600).
Die Palettenquantisierung schrumpft die PNG auf rund ein Fünftel gegenüber 24-Bit-RGB, ohne sichtbaren Verlust bei
den flächigen Illustrationen (Himmelsverläufe bleiben ohne Streifen).
Für eine schnelle Sichtprüfung: `tools/montage.swift` setzt mehrere PNG zu einem Bogen zusammen.

## SVG-Regeln (damit Xcode und Web gleich rendern)

- Nur `<path>`, `<rect>`, `<circle>`, `<ellipse>` und lineare Verläufe (`userSpaceOnUse`); **kein** `<style>`, `<text>`,
  `<filter>`, `clip-path`, `mask`, Radialverlauf, Bild oder Skript.
- Kontur 0,5–1,5 px, `stroke-linejoin: round`; Deckkraft nur über `fill-opacity`/`stroke-opacity`.
- Beschriftungen im Bild (Ziffern, «ABFLUG», «11.10.2026» …) sind Strichschrift aus Pfaden (`lib/font.js`).
- Dateigrösse: alle SVG < 100 KB; alle PNG ausser den Mitteilungsbildern zusammen < 12 MB (siehe Abschlussmeldung).

## Stil und Palette

- Palette strikt aus `docs/DESIGN.md`: hell «Papier», dunkel «Nachtpapier», Akzent Zinnober; Typfarben aus
  `shared/event-types.json`. Zwischentöne entstehen ausschliesslich durch Mischen dieser Werte (`lib/palette.js`).
- Je Körper drei Töne: Licht (Oberseite), Front (linke Fläche), Schatten (rechte Fläche). Licht von links oben,
  Bodenschatten als eine zusammengefasste Fläche (kein doppeltes Abdunkeln).
- Menschen sind schlichte, gesichtslose Figuren in Palettenfarben.

## Toolkit (`lib/`)

| Datei | Inhalt |
|---|---|
| `util.js` | Farbmischung, Zufall, Zahlenformat, konvexe Hülle |
| `palette.js` | Paletten hell/dunkel, Dreitonmaterialien (`m.paper`, `m.type('air')`, `m.glass`, `m.card` …) |
| `iso.js` | `Scene`: Projektion, Quader, Prisma (`extrude`, `prismXZ`, `prismYZ`), Pyramidenstumpf, Satteldach, Rampe, Treppe, Rohr/Zylinder/Kegel (`tube`), Kugel, Kuppel, Bodenband, Fensterraster, Rahmen für Beschriftung/Details, Massmarken, Tiefensortierung (topologisch nach Quader-Trennachsen), automatische Einpassung |
| `font.js` | Strichschrift A–Z, Ziffern, Umlaute (Ä Ö Ü), `: . - / + > ! ?` |
| `props.js` | gegliederte Figur (Kopf, Hals, Torso, Arme, Beine, Schuhe; Rucksack, Umhängetasche, Hut, Jacke, Rock, Hautton, Grösse; `lod` 0 für Menschenmengen), Koffer, Bäume, Palme, Laterne, Bank, Gepäckwagen, Schlepper, Verkehrsflugzeug |
| `objects.js` | Auto, Bus, Schienenfahrzeug, Schiff |
| `things.js` | Möbel, Blätter, Ticketkarte, Telefon, Server, Globus, Uhr, Münze, Schirm, Ausschnittfiguren |
| `icons.js` | Stationsobjekte der Hilfekarten: stehende Karte, Sockel, Förderband (Rollen/Zeitstriche), Beschriftungsschild mit Nummernmarke, Lupe, Münzstapel, Schloss, QR, Waage, Uhrenturm, Schlüssel |
| `scenery.js` | Umgebung für dichte Szenen: Zebrastreifen, Bodenpfeile und -schrift, Schilderpfosten, Flaggen, Regale, Aktenschrank, Zäune, Hecken, Laptop, Bürostuhl, Funkmast, Ampel |
| `common.js` | Passermarken, Inselplatte, Nummernmarke, Gleise, Wellen, Himmel |

Eine Szene ist ein Modul in `scenes/` mit `{ id, kind, title, alt, usage, width, height, build(s, pal), setup }`.
`build.js` baut jede Szene zweimal (hell/dunkel); die erste Runde misst die Ausdehnung, die zweite zeichnet im
passenden Massstab (`setup.pad` = Ränder links, oben, rechts, unten; `setup.fit: false` schaltet das ab).
Teile (`s.box(...)`, `s.group(...)`) tragen eine Bounding-Box für die Tiefensortierung und werden mit `s.add(teil)`
in die Ebene `obj` (sortiert), `ground`, `top` oder `bg` gelegt.

## Dateien in `shared/illustrations/`

```
light/<id>.svg            dark/<id>.svg            Typen, Leerzustände, Hilfekarten, Cover (29)
png/light/<id>.png        png/dark/<id>.png        2x
notifications/light|dark/<id>.svg                  Mitteilungsbilder (6)
notifications/png/light|dark/<id>.png              1200 x 600
notifications/png/<imageKey>.png                   flach, für den Server (hell)
notifications/png/<imageKey>-dark.png              flach, für den Server (dunkel) – 12 Dateien
manifest.json             Verzeichnis aller Illustrationen (id, kind, title, alt, files, width, height, usage)
help-cards.json           Texte der sechs Hilfekarten (id, title, summary, steps[], illustration)
index.html                Kontaktbogen (hell/dunkel, SVG/PNG umschaltbar, ohne Server nutzbar)
```

Mitteilungsbilder tragen im Manifest zusätzlich `imageKey` (= `id`) und `serverFiles` (`png`, `pngDark`).
Hilfekarten: `steps[].marker` = Nummer der Marke im Bild, `steps[].label` = Wort auf dem Schild der Station.

`usage`: Typen = Katalog-Typ-ID (`Flug`, `Zugreisen`, …), sonst `<art>:<name>`, z. B. `empty-state:trips`,
`help:share`, `cover:sea`, `notification:trip.today`. Für Mitteilungen gilt `imageKey` = `id` (z. B. `notif-today`).

## Texte

Deutsch, Schweizer Rechtschreibung (immer «ss», nie das scharfe S), Datum `dd.mm.yyyy`, Zeit `hh:mm`. Die Bild-Beschriftungen sind
bewusst kurz und enthalten nur Beispieldaten (`11.10.2026`, `14:05`).
