# TravelBuddy – Mitteilungen, Live Activities, Rollen (Paket «notify», Welle 2)

Stand: 11.10.2026. Ergänzt `docs/CONTRACT.md` (Abschnitte «Geräte, Push, Live Activities» und «Präzisierung Summary und
Push-Nutzlast») und `docs/api/server-notes.md`. **Dieses Dokument ersetzt dort** Punkt 2 (Rollen), Punkt 15 (Versand
der Live Activities), Punkt 16 (versendete Arten) und Punkt 18 (Mitteilungsbilder).

Code: `server/src/notifications/` (Plan, Scheduler, Live Activities, Routen), `server/src/push/` (APNs, Notifier),
`server/src/auth/roles.ts` (Rollen).

## 1. Rollen: Mitreisende mit Konto (Nicht-Admins)

Positivliste in `auth/roles.ts` (`RULES`); neue Routen sind für Nicht-Admins gesperrt, bis sie dort stehen. Die
Zugehörigkeit zur Reise prüft die Route selbst bzw. `participantAccess` (Middleware, läuft nach der Positivliste).

| Bereich | Erlaubt für Mitreisende (nur eigene Reisen = als Teilnehmer eingetragen) | Admin-only |
|---|---|---|
| Reise, Ereignisse | `GET /v1/trips`, `GET /v1/trips/:id`, `…/ics`, `…/day/:date`, `/v1/today`, `/v1/summary`, Kommentare (`POST/DELETE …/comments`) | Reisen anlegen/ändern/löschen, Ereignisse anlegen/**bearbeiten**/löschen/bestätigen/zusammenführen, Teilnehmer, Gäste-Links |
| Reisekasse | `GET /v1/ledgers` (nur Kassen eigener Reisen), `GET /v1/ledgers/:id` (ohne Einladungs-Links), `…/expenses`, `…/settlements`; **Ausgaben und Rückzahlungen erfassen**; eigene Ausgaben ändern/löschen; `/v1/currencies`, `/v1/fx` | Kasse anlegen/ändern/löschen, Mitglieder, Paare, Rückzahlungen löschen, `settle-couple`, eigenständige Kassen ohne Reise |
| Dokumente | `GET /v1/trips/:id/documents`, `GET /v1/documents/:id`, `…/file` (auch `HEAD`, `Range`), `…/thumbnail`; **hochladen** `POST /v1/trips/:id/documents` | löschen, neu analysieren, «Einwurf» `POST /v1/documents`, Dokumente an Ereignisse hängen |
| Inbox | `GET /v1/inbox`: nur Dokumente und Vorschläge der eigenen Reisen (Antwort nur `documents`, `review`) | – |
| Konto | Geräte, Einstellungen, Live Activities, Passwort | Benutzerverwaltung (`/v1/users*`), `/v1/push/*` |

Weitere Regeln:

- `403 forbidden` bei fremder Reise, fremdem Dokument (Detail, Original **und** Vorschau), fremder Kasse. Unbekannte und
  fremde Dokumente sind nicht unterscheidbar (`403`).
- Ein hochgeladenes Dokument gehört der Reise des Pfads; `eventId` muss zu dieser Reise gehören (sonst `404`).
- `ledger` in `GET /v1/today`, `GET /v1/trips/:id/day/:date` und `GET /v1/summary` ist für Mitreisende gesetzt
  (`{ id, title, currency, balanceMinor, myMemberId, balances[] }`).
- `GET /v1/trips/:id` blendet für Mitreisende weiterhin Gäste-Links, E-Mail-Adressen und Dokumenttitel am Ereignis aus
  (Titel über `GET /v1/trips/:id/documents`).
- Eigenständige Reisekassen ohne Reise (Altdaten, Import) bleiben Administratoren vorbehalten.
- Meldungen der Reisekasse (`ledger.expense`, `ledger.settlement`) gehen an alle aktiven Teilnehmer mit Konto der Kasse
  einer Reise (nicht mehr nur an Admins); bei eigenständigen Kassen weiterhin nur an Admins.

## 2. Scheduler

`NotificationScheduler` (`notifications/scheduler.ts`), gestartet in `index.ts` (`TRAVELBUDDY_NOTIFY_SECONDS`, Standard
60, `0` = aus) über `lib/background`. Je Lauf: fällige Mitteilungen berechnen (`plan.ts`), über `Notifier.deliver`
zustellen, Live Activities abgleichen (`live.ts`).

**Empfänger:** Teilnehmer der Reise mit aktivem Konto und mindestens einem Gerät mit APNs-Token. Ist bei einem
Ereignis «Wer ist dabei» eingeschränkt (`participantIds`), nur diese. Nur **bestätigte** Ereignisse
(`status = confirmed`) lösen aus, Vorschläge nie. Stornierte Reisen (`status = cancelled`) ruhen.

**Zeitzonen:** Datum und Uhrzeit eines Ereignisses gelten in `startTz`/`endTz`, ohne Angabe in der Zone der Reise.
Fälligkeit ist ein absoluter UTC-Zeitpunkt. Das Morgenbriefing läuft in der Zone, in der die Reisenden gerade sind
(wie «Heute»: Reisezone, nach einem Flug die Zone des begonnenen/beendeten Ereignisses). `checkInOpens` und
`boardingTime` sind Uhrzeiten am Abflugtag in `startTz`; liegen sie nach dem Abflug, gelten sie am Vortag.

| Art | Auslöser | Zeitpunkt | `interruption` |
|---|---|---|---|
| `trip.today` | aktive Reise, Tag mit mindestens einem Eintrag (ohne Aufgaben) | täglich `leadTimes.todayBriefing` (07:30) Ortszeit, gültig bis 12:00 | `active` |
| `trip.depart` | Flug, Zug, Transfer, Kreuzfahrt (Einschiffung/Reise), Mietwagen | `leadTimes.departHours` (24 h, 3 h, 1 h) vor Beginn | `time-sensitive` |
| `trip.depart` | Flug: «Check-in öffnet» | `checkInOpens`, sonst 24 h vorher (fällt es mit der 24-h-Meldung zusammen, trägt diese den Hinweis) | `time-sensitive` |
| `trip.depart` | Flug: «Boarding beginnt» | `boardingTime` (wenn vorhanden) | `time-sensitive` |
| `trip.stay` | Hotel/Unterkunft: Check-in | Morgen des Anreisetags (Briefing-Uhrzeit, Ortszeit der Unterkunft) | `active` |
| `trip.stay` | Hotel/Unterkunft: Check-out | `leadTimes.checkoutMinutes` (60) vor `endTime`/`checkOutUntil` | `active` |
| `trip.pickup` | Mietwagen-Abholung | 2 h vorher | `time-sensitive` |
| `trip.deadline` | `cancelUntil` (Storno) und offene/angezahlte Zahlung (fällig am Beginn) | `leadTimes.deadlineDays` (3) und 1 Tag vorher, Briefing-Uhrzeit | `active` |
| `trip.review` | `Notifier.review(tripId, count)` (löst «ingest» aus) | sofort | `active` |
| `trip.comment`, `ledger.expense`, `ledger.settlement` | Anwendung | sofort | `active` |

**Ruhezeiten** (`quietHours`, siehe unten): Die Spalte «Zeitpunkt» gilt nur ausserhalb der Ruhezeit des Empfängers;
unkritische Arten werden auf das Ende der Ruhezeit verschoben.

Abweichung: **Mietwagen** erhält als `trip.depart` nur die frühe Vorankündigung (Vorlaufzeiten ≥ 12 h, also 24 h);
die Abholung kommt 2 h vorher als `trip.pickup`. Sonst kämen 24 h, 3 h, 2 h und 1 h für dieselbe Abholung.

**Aufholen statt fluten:** Fällig ist eine Mitteilung von ihrem Zeitpunkt bis zum Beginn des Ereignisses (bzw. Ende der
Frist, 12:00 beim Briefing). Je Benutzer und Ereignis wird nur die **zuletzt fällig gewordene** gesendet; eine
2 h vor Abflug angelegte Buchung löst nicht «24 h» und «3 h» auf einmal aus. Beim Nachholen nennt der Titel die
tatsächlich verbleibende Zeit («Abflug in 1 Stunde 30 Minuten», gerundet auf 5 bzw. 30 Minuten).

**Entdoppelung:** `notification_log (user_id, dedupe_key)`. Schlüssel: `sched:<art>:<ereignis-id>:<lead>:<beginn-in-minuten>`
(`today:<reise>:<datum>`, `stay-in:<ereignis>:<datum>`, `deadline:<ereignis>:<cancel|payment>:<datum>:<n>d`). Verschiebt
sich ein Ereignis, gilt es als neu. Einträge werden nach 120 Tagen entfernt.

**Einstellungen** (`GET/PUT /v1/me/notification-prefs`): je Art ein-/ausschaltbar, dazu `leadTimes`
(`departHours`, `checkoutMinutes`, `deadlineDays`, `todayBriefing`) und `quietHours` (siehe unten).

**Texte:** Deutsch, nie «ß», Datum `dd.mm.yyyy`, Zeit `hh:mm`. Weicht die Zone des Ereignisses von der Reisezone ab,
steht «Ortszeit» dahinter («27.10.2026 22:30 Ortszeit»). Titel höchstens 60, Text höchstens 180 Zeichen.
Beispiele: `Abflug in 3 Stunden` / `ZRH → BCN · LX 1952 · 27.10.2026 17:00 · Terminal 2 · Gate B42`;
`Check-in heute` / `Hotel Arts · ab 15:00 · Carrer de la Marina 19-21`;
`Stornofrist in 3 Tagen` / `Hotel Arts: kostenlos stornierbar bis 05.11.2026.`

### Ruhezeiten

Einstellung je Benutzer in `notification_prefs`, über `GET/PUT /v1/me/notification-prefs`:
`quietHours: { enabled: boolean, from: "HH:mm", to: "HH:mm" }`, Standard **an, 22:30–06:30**. Das Fenster gilt in der
**Ortszeit der Reise** (die Zone, in der sich die Reisenden gerade befinden, wie «Heute»; ohne Reise die Zone des
Servers `TRAVELBUDDY_TZ`) und darf über Mitternacht reichen (`from` > `to`); `from = to` heisst «nie».

| Verhalten in der Ruhezeit | Arten |
|---|---|
| **verschoben** (nicht gesendet, nach dem Ende der Ruhezeit nachgeholt) | `trip.today`, `trip.deadline`, `trip.review`, `trip.comment`, `ledger.expense`, `ledger.settlement`, Abflug-Vorankündigung ab 12 h (24 h) |
| **sofort**, auch nachts (`time-sensitive`) | `trip.depart` (3 h, 1 h, Check-in öffnet, Boarding), `trip.pickup`; ebenso `trip.stay` (Check-out-Erinnerung) |

Mechanik: `trip.today`, `trip.deadline` und die 24-h-Vorankündigung (`quiet: "skip"`) werden nicht gesendet und
nicht vermerkt; die Planung liefert sie im nächsten Lauf nach Ende der Ruhezeit erneut, solange sie noch gelten (danach
nicht mehr). Ereignisgetriebene Meldungen (`trip.comment`, `ledger.*`, `trip.review`; `quiet: "queue"`) werden in `kv`
(`qd:<benutzer>:<schlüssel>`) vorgemerkt und beim ersten Lauf nach der Ruhezeit gesendet, spätestens 36 Stunden danach
verfallen sie. `POST /v1/push/test` und die Diagnose ignorieren die Ruhezeiten. `POST /v1/push/simulate` kennzeichnet
betroffene Mitteilungen mit `quiet: true`; `GET /v1/push/status` → `scheduler.lastRun.delivery.quiet` zählt sie.

### Ohne APNs-Schlüssel (Trockenlauf)

Ohne `AuthKey_<KEYID>.p8` bzw. `APNS_KEY` berechnet der Scheduler weiter, sendet aber nichts und markiert nichts als
gesendet (`TickReport.dryRun`, `delivery.deferred`). Sobald der Schlüssel da ist (Datei ablegen genügt, kein Neustart),
holt der nächste Lauf nach, was dann noch gilt. `GET /v1/push/status` zeigt `dryRun` und die Zahl der wartenden
Mitteilungen (`scheduler.pending`).

## 3. Nutzlast (APNs, Mitteilungen)

Exakt nach Vertrag (siehe `buildApnsPayload`, `noticeMessage`):

```json
{
  "aps": {
    "alert": { "title": "Abflug in 3 Stunden", "body": "ZRH → BCN · LX 1952 · 27.10.2026 17:00 · Gate B42" },
    "sound": "default",
    "mutable-content": 1,
    "category": "trip.depart",
    "thread-id": "trip-12",
    "interruption-level": "time-sensitive",
    "relevance-score": 1
  },
  "kind": "trip.depart",
  "deepLink": "travelbuddy://event/12/345",
  "tripId": 12,
  "eventId": 345,
  "imageKey": "notif-depart",
  "interruption": "time-sensitive",
  "relevance": 1,
  "ticket": {
    "type": "Flug", "icon": "plane", "color": "air", "title": "Flug ZRH → BCN",
    "startAt": "2026-10-27T16:00:00Z", "startDate": "2026-10-27", "startTime": "17:00", "endTime": "18:35",
    "tz": "Europe/Zurich", "from": "ZRH", "to": "BCN", "place": "Flughafen Zürich", "address": "…",
    "lat": 47.4647, "lon": 8.5492, "reference": "X7K2QD", "tripTitle": "Barcelona", "dayIndex": 2, "dayCount": 6,
    "facts": [{ "label": "Flugnummer", "value": "LX 1952" }],
    "deadlineKind": "cancel"
  }
}
```

- `ticket.startAt` ist ISO UTC **ohne Sekundenbruchteile** (so liest es `ISO8601DateFormatter()` der Apps).
  `ticket.startDate` ist ISO (`YYYY-MM-DD`), die App formatiert es als `dd.mm.yyyy`; `startTime`, `endTime`,
  `items[].time` sind `HH:mm` in der Zone `ticket.tz`. Anzeigetexte (Titel, Text, `facts[].value`) sind fertig formatiert.
- `trip.today`: `ticket.items = [{ time, title, type, icon, color }]` (bis 8), `count` = Anzahl der Einträge.
- `trip.review`: `ticket.count` = Anzahl der Vorschläge, `deepLink = travelbuddy://inbox`.
- `trip.deadline`: `ticket.deadlineKind` = `cancel` | `payment`.
- Die Tests lesen die Nutzlast mit denselben Feldnamen wie `ios/Shared/TravelNotificationPayload.swift`
  (`test/notif-helpers.ts`, `decodeLikeSwift`).
- `apns-expiration` = Ende der Gültigkeit der Erinnerung (Abflug, Fristende), damit APNs sie danach verwirft.

## 4. Live Activities

Arten und Zeiten (`TravelActivityAttributes.Kind`):

| Art | Start (Push-to-Start) | Aktualisierung | Ende |
|---|---|---|---|
| `flight` | 3 h vor Flug, Zug oder Einschiffung | Übergänge: `checkIn` (Check-in offen), `boarding`, `underway` (mit `progress`, danach alle 10 min), `arrived`, `atStay` (Check-in Hotel) | 30 min nach Ankunft bzw. nach Check-in des Hotels (innerhalb 14 h nach Ankunft), `dismissal-date` + 10 min |
| `day` | Reisetag ab dem Morgenbriefing, wenn der Tag Einträge hat; **nicht**, solange eine `flight`-Activity läuft | nächstes Ereignis (`milestoneAt`), danach `nextHeadline`/`nextAt` | letzter Eintrag + 1 h (mindestens 2 h nach Start, höchstens 23:59), `dismissal-date` + 1 min |
| `checkin` | nicht automatisch (nur gepflegt, wenn die App sie anmeldet) | `upcoming` → `atStay` | 2 h nach Check-in |

- **Push-to-Start:** an `devices.push_to_start_token` (`PUT /v1/devices/current { pushToStartToken }`), je Gerät höchstens
  einmal je Plan (`kv`: `la:start:<geräte-id>:<art>:<reise>:<ereignis|datum>`). `aps`: `timestamp`, `event: "start"`,
  `content-state`, `attributes-type: "TravelActivityAttributes"`, `attributes: { tripId, tripTitle, kind, eventId?,
  deepLink }`, `alert`.
- **Aktualisierung/Ende:** an das Token der angemeldeten Activity (`PUT /v1/live-activities/:activityId`),
  `event: "update"` bzw. `"end"` mit `dismissal-date` (Unix-Sekunden). Zuletzt gesendeter Zustand in `kv`
  (`la:state:<activityId>`), gesendet wird nur bei Änderung (Übergang, Priorität 10) bzw. Fortschritt (Priorität 5).
- **Kopfzeilen:** `apns-push-type: liveactivity`, `apns-topic: <bundle>.push-type.liveactivity`
  (`ch.rolfwalker.travelbuddy.push-type.liveactivity`), `apns-priority` 10 (Start, Übergang, Ende) bzw. 5 (Fortschritt).
- **`content-state`** genau wie `TravelActivityAttributes.ContentState`: `headline`, `detail?`, `icon`, `colorKey`,
  `stage` (`upcoming|checkIn|boarding|underway|arrived|atStay|generic`), `milestoneLabel?`, `milestoneAt?`
  (Unix-Sekunden, Double), `progress?` (0…1), `nextHeadline?`, `nextAt?`, `updatedAt`. Fehlende Werte werden weggelassen.
- **Fehler:** `410`, `BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic` → Push-to-Start-Token bzw. Zeile in
  `live_activities` wird entfernt.
- Ohne Schlüssel (Trockenlauf) wird nichts gesendet und kein Start vermerkt; der Start wird nachgeholt.
- Activities ohne Plan (Tag ohne Einträge, fremde Reste älter als 18 h) beendet der Server.

## 5. Mitteilungsbilder

`GET /v1/media/notification/:imageKey` (Bearer, auch Mitreisende): PNG aus
`<TRAVELBUDDY_ILLUSTRATIONS_DIR>/notifications/<imageKey>.png`; `?scheme=dark` (oder `<imageKey>-dark`) wählt die
dunkle Fassung, sonst bzw. wenn sie fehlt die helle. Suchreihenfolge je Ordner (`<dir>/notifications`, `<dir>`):
`<key>.png`, `png/light/<key>.png`; dunkel zuerst `<key>-dark.png`, `png/dark/<key>.png`. Die Dateien liefert das Paket
«graphics» (Ablage `notifications/png/{light,dark}/`, 1200×600 px, 2× der Zielgrösse 600×300); der Server reicht sie
unverändert durch und legt keine Dateien an. Fehlt die Datei: `404 image_not_available` (Rückfall auf die ältere Ablage
`<media>/notification/<key>.png`). Header: `cache-control: private, max-age=86400`, `etag` (`304` bei
`If-None-Match`), `vary: Authorization`. Schlüssel: `notif-[a-z]{2,20}`.

Ordner: `TRAVELBUDDY_ILLUSTRATIONS_DIR` (Wurzel `shared/illustrations`), sonst `./shared/illustrations`,
`../shared/illustrations` und relativ zum Quellordner. Im Docker-Image liegen sie unter `/app/shared/illustrations`
(`server/Dockerfile`).

## 6. Diagnose (Admin)

| Route | Zweck |
|---|---|
| `GET /v1/push/status` | `configured`, `keyId`, `teamId`, `topic`, `source`, `file` (nie Schlüsselinhalt) oder `reason`/`searched`; `dryRun`, `registeredDevices`, `pushToStartDevices`, `liveActivities`, `scheduler { running, intervalSeconds, lastRun, pending }` |
| `POST /v1/push/test` | an die **eigenen** Geräte, unabhängig von Einstellungen und Entdoppelung. Body (optional) `{ kind }`: `test` (Standard), eine Art aus `NOTIFICATION_KINDS` mit Beispiel-Ticket, oder `liveactivity` mit `activityKind` (`day`\|`flight`\|`checkin`) und `event` (`start` per Push-to-Start, `update`/`end` an angemeldete Activities). Antwort `{ kind, dryRun, results[] }`; ohne Schlüssel `dryRun: true` mit `payload`-Vorschau. `409 no_device`, `409 push_not_configured` |
| `POST /v1/push/simulate` | Simulationslauf: `{ at?: ISO UTC, tripId?, previewHours? }` → `{ at, due[], upcoming[], liveActivities[] }`; sendet und schreibt nichts |

## 7. Betrieb

Neue Umgebungsvariablen (auch in `.env.example` und `server/README.md`): `TRAVELBUDDY_NOTIFY_SECONDS`
(Intervall des Schedulers, Standard `60`, `0` = aus), `TRAVELBUDDY_ILLUSTRATIONS_DIR` (siehe oben). Bestehend: `APNS_KEY`, `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_TOPIC`, `TRAVELBUDDY_APNS_DIR`.

## 8. Bekannte Lücken

- Zeitkritische Erinnerungen (3 h, 1 h, Check-in, Boarding, Abholung) kommen bewusst auch nachts: «3 h vor» einem
  Flug um 05:00 um 02:00.
- Mietwagen-Rückgabe, Restaurant, Veranstaltung und Ausflug lösen keine eigene Erinnerung aus (nur «Heute»).
- Live Activities: Die Dauer eines Flugs ohne `endTime` ist eine Annahme (`durationMinutes`, sonst 2 h).
- Mehrere Geräte desselben Kontos erhalten je eine eigene Activity; die `checkin`-Art startet der Server nicht selbst.
- `apns-collapse-id` wird nicht gesetzt; zwei verschiedene Erinnerungen bleiben getrennte Mitteilungen.
