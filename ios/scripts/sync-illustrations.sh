#!/bin/bash
# Kopiert die Illustrationen aus shared/illustrations/ in die App:
#   *.svg            -> ios/TravelBuddy/Resources/Illustrations.xcassets/<name>.imageset (Vektordaten bleiben erhalten)
#   manifest.json    -> ios/TravelBuddy/Resources/Illustrations/illustrations-manifest.json
#   help-cards.json  -> ios/TravelBuddy/Resources/Illustrations/help-cards.json
# Idempotent: gleicher Stand ergibt gleiche Dateien; entfernte SVGs verschwinden aus dem Katalog.
# Fehlt die Quelle noch, entstehen leere Platzhalter (die App zeigt dann Symbole statt Bilder).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
src="$repo/shared/illustrations"
res="$repo/ios/TravelBuddy/Resources"
catalog="$res/Illustrations.xcassets"
data="$res/Illustrations"
index="$data/.synced-imagesets"

mkdir -p "$catalog" "$data"
[ -f "$catalog/Contents.json" ] || printf '{\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  }\n}\n' > "$catalog/Contents.json"

# JSON-Dateien: nur überschreiben, wenn sich der Inhalt ändert (Zeitstempel bleiben stabil).
copy_if_changed() {
  local from="$1" to="$2"
  if [ ! -f "$to" ] || ! cmp -s "$from" "$to"; then cp "$from" "$to"; fi
}
if [ -f "$src/manifest.json" ]; then copy_if_changed "$src/manifest.json" "$data/illustrations-manifest.json"
elif [ ! -f "$data/illustrations-manifest.json" ]; then printf '{ "illustrations": [] }\n' > "$data/illustrations-manifest.json"; fi
if [ -f "$src/help-cards.json" ]; then copy_if_changed "$src/help-cards.json" "$data/help-cards.json"
elif [ ! -f "$data/help-cards.json" ]; then printf '{ "cards": [] }\n' > "$data/help-cards.json"; fi

# SVGs -> Image-Sets. Quellen: light/<name>.svg und dark/<name>.svg (ein Set mit Hell/Dunkel-Varianten)
# oder <name>.svg direkt in shared/illustrations/ (universell). png/ wird nicht verwendet.
new_index="$(mktemp)"
names="$(mktemp)"
if [ -d "$src" ]; then
  { find "$src/light" -maxdepth 1 -type f -name '*.svg' 2>/dev/null
    find "$src/dark" -maxdepth 1 -type f -name '*.svg' 2>/dev/null
    find "$src" -maxdepth 1 -type f -name '*.svg' 2>/dev/null; } | while IFS= read -r f; do basename "$f" .svg; done | sort -u > "$names"
  while IFS= read -r base; do
    [ -n "$base" ] || continue
    name="$(printf '%s' "$base" | tr -c 'A-Za-z0-9._-' '-')"
    set_dir="$catalog/$name.imageset"
    mkdir -p "$set_dir"
    light="$src/light/$base.svg"; dark="$src/dark/$base.svg"; flat="$src/$base.svg"
    [ -f "$light" ] || light="$flat"
    images=""
    if [ -f "$light" ]; then
      copy_if_changed "$light" "$set_dir/$name.svg"
      images='    {
      "filename" : "'"$name"'.svg",
      "idiom" : "universal"
    }'
    fi
    if [ -f "$dark" ]; then
      copy_if_changed "$dark" "$set_dir/$name-dark.svg"
      [ -n "$images" ] && images="$images,
"
      images="$images"'    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "filename" : "'"$name"'-dark.svg",
      "idiom" : "universal"
    }'
    fi
    printf '{\n  "images" : [\n%s\n  ],\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  },\n  "properties" : {\n    "preserves-vector-representation" : true\n  }\n}\n' "$images" > "$set_dir/Contents.json.tmp"
    if [ ! -f "$set_dir/Contents.json" ] || ! cmp -s "$set_dir/Contents.json.tmp" "$set_dir/Contents.json"; then
      mv "$set_dir/Contents.json.tmp" "$set_dir/Contents.json"
    else rm -f "$set_dir/Contents.json.tmp"; fi
    echo "$name" >> "$new_index"
  done < "$names"
fi
rm -f "$names"
touch "$new_index"

# Früher synchronisierte, jetzt fehlende Image-Sets entfernen.
if [ -f "$index" ]; then
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    if ! grep -qxF "$old" "$new_index"; then rm -rf "$catalog/$old.imageset"; fi
  done < "$index"
fi
sort -u "$new_index" > "$index"
rm -f "$new_index"
echo "Illustrationen synchronisiert: $(wc -l < "$index" | tr -d ' ') SVG, Katalog $catalog"
