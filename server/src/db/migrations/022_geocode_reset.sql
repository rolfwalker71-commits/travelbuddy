-- TravelBuddy 022: Bereinigung fehlerhafter Geokodierungen (einmalig, beim Start mit der Migration).
--
-- Ursache: Die Adresse des Ereignisses wurde bei Zug/Transfer pauschal dem Start zugeordnet und an Ortsnamen wurde
-- das Reiseziel angehängt («Altdorf UR, Kreuzfahrt / Florida»). Betroffene, per Geokodierung entstandene Ergebnisse
-- werden verworfen, damit der Nachtrag sie mit den korrekten Suchbegriffen neu holt.
-- Betroffen: alle Ereignistypen (auch Unterkünfte und Ausflüge ohne Adresse, die mit angehängtem Reiseziel gesucht
-- wurden); Seetage und die Gesamtreise der Kreuzfahrt haben nie Koordinaten. Von Hand gesetzte Koordinaten
-- (`source` manual oder ohne Herkunft) bleiben unangetastet.

-- Ortskoordinaten je Rolle (place_coords) mit Quelle «geocoded»
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.start')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.start.source') = 'geocoded';
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.end')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.end.source') = 'geocoded';
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.pickup')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.pickup.source') = 'geocoded';
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.return')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.return.source') = 'geocoded';
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.venue')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.venue.source') = 'geocoded';
UPDATE trip_events SET place_coords = json_remove(place_coords, '$.stop')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(place_coords, '$.stop.source') = 'geocoded';

-- Hauptkoordinaten (lat/lon) mit Herkunft «geocoded»
UPDATE trip_events
   SET lat = NULL, lon = NULL, fields_meta = json_remove(fields_meta, '$.lat', '$.lon')
 WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
   AND json_extract(fields_meta, '$.lat.source') = 'geocoded';

-- Gedächtnis des Nachtrags für diese Ereignisse löschen (neuer Suchbegriff = neuer Versuch)
DELETE FROM geocode_backfill
 WHERE event_id IN (
   SELECT id FROM trip_events
    WHERE NOT (event_type = 'Kreuzfahrt' AND json_extract(details, '$.entryKind') IN ('Seetag', 'Reise'))
 );
