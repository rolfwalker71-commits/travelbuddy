import Foundation
import UserNotifications

/// Inhalt einer Ticket-Mitteilung: aus der Nutzlast (`ticket`), ergänzt aus Cache bzw. `GET /v1/summary`.
struct TicketContent: Equatable {
    struct Row: Equatable, Hashable {
        var time: String?
        var title: String
        var icon: String
        var color: String
        var isNext = false
    }

    var kind: String
    var icon: String
    var colorKey: String
    var kicker: String
    var title: String
    var subtitle: String?
    var from: String?
    var to: String?
    var timeText: String?
    var dateText: String?
    var zoneNote: String?
    var reference: String?
    var facts: [SharedSummary.KeyValue] = []
    var rows: [Row] = []
    var segments: [TBDayBand.Segment] = []
    var startAt: Date?
    var countdownLabel = "In"
    var dayCaption: String?
    var tripTitle: String?
    var count: Int?
    var body: String = ""
    var deepLink: URL?
    var tripId: Int?
    var eventId: Int?
    var address: String?
    var lat: Double?
    var lon: Double?
    var isProposal = false
    /// `true`, wenn die Beschriftung vom Server (`displayLabel`) stammt und nicht überschrieben wird.
    var hasServerLabel = false

    // MARK: Aufbau aus der Mitteilung

    init(notification: UNNotificationContent) {
        let payload = TravelNotificationPayload(userInfo: notification.userInfo, category: notification.categoryIdentifier)
        let t = payload.ticket
        kind = payload.kind.isEmpty ? notification.categoryIdentifier : payload.kind
        let type = SharedTypeCatalog.info(for: t.type)
        let tz = t.tz.flatMap { TimeZone(identifier: $0) } ?? .current

        icon = t.icon ?? type.icon
        colorKey = t.color ?? type.color
        title = NotificationText.format(t.title ?? notification.title, tz: tz)
        body = NotificationText.format(notification.body, tz: tz)
        subtitle = t.place
        from = t.from
        to = t.to
        reference = t.reference
        facts = t.facts
        tripTitle = t.tripTitle
        count = t.count
        deepLink = payload.deepLink
        tripId = payload.tripId
        eventId = payload.eventId
        address = t.address
        lat = t.lat
        lon = t.lon
        if let d = t.dayIndex, let c = t.dayCount { dayCaption = "Tag \(d) von \(c)" }
        rows = t.items.map { Row(time: $0.time, title: $0.title, icon: $0.icon, color: $0.color) }

        if let at = t.startAt {
            startAt = at
            timeText = SharedFormat.time(at, in: tz)
            dateText = SharedFormat.weekdayShortDate(SharedFormat.isoDay(at, in: tz))
        } else {
            // `displayTime` (Rolle am Tag) hat Vorrang; bei `middle` gibt es keine Uhrzeit.
            let shownTime = t.dayRole == "middle" ? nil : (t.displayTime ?? t.startTime)
            timeText = SharedFormat.time(shownTime)
            dateText = t.startDate.map { SharedFormat.weekdayShortDate($0) }
            startAt = SharedFormat.moment(date: t.startDate, time: shownTime, tz: tz)
        }
        if kind == TravelNotificationKind.today, let at = t.startAt ?? startAt {
            dateText = SharedFormat.weekdayDate(SharedFormat.isoDay(at, in: tz))
        } else if kind == TravelNotificationKind.today, let d = t.startDate {
            dateText = SharedFormat.weekdayDate(d)
        }
        kicker = t.displayLabel ?? Self.kicker(kind: kind, type: type, title: title)
        hasServerLabel = t.displayLabel != nil
        applyKindDefaults(type: type)
    }

    private static func kicker(kind: String, type: SharedEventType, title: String) -> String {
        switch kind {
        case TravelNotificationKind.today: return "Heute"
        case TravelNotificationKind.depart: return type.startLabel
        case TravelNotificationKind.stay: return title.localizedCaseInsensitiveContains("check-out") ? "Check-out" : "Check-in"
        case TravelNotificationKind.pickup: return "Abholung"
        case TravelNotificationKind.deadline: return "Frist"
        case TravelNotificationKind.review: return "Zu prüfen"
        default: return type.label
        }
    }

    private mutating func applyKindDefaults(type: SharedEventType) {
        switch kind {
        case TravelNotificationKind.today:
            colorKey = "air"; icon = "map"; countdownLabel = "Als Nächstes in"
            segments = rows.compactMap { r in
                guard let hm = SharedFormat.hm(r.time) else { return nil }
                return TBDayBand.Segment(startMinute: hm.h * 60 + hm.m, endMinute: nil, colorKey: r.color)
            }
        case TravelNotificationKind.depart:
            countdownLabel = "Abfahrt in"
        case TravelNotificationKind.stay:
            if icon == "map" { icon = "bed" }
            if colorKey == "activity" { colorKey = "stay" }
            countdownLabel = kicker == "Check-out" ? "Check-out in" : "Check-in in"
        case TravelNotificationKind.pickup:
            if icon == "map" { icon = "car" }
            if colorKey == "activity" { colorKey = "car" }
            countdownLabel = "Abholung in"
        case TravelNotificationKind.deadline:
            icon = "task"; colorKey = "air"; countdownLabel = "Frist endet in"
        case TravelNotificationKind.review:
            icon = "doc"; colorKey = "doc"; countdownLabel = "Offen"
        default:
            break
        }
    }

    // MARK: Ergänzen aus Zusammenfassung

    /// Füllt fehlende Angaben aus `summary` (Ereignis `eventId`, Tagesliste, Tag x von y).
    mutating func enrich(with summary: SharedSummary, now: Date = Date()) {
        let trip: SharedSummary.Trip? = {
            if let tripId {
                if summary.activeTrip?.id == tripId { return summary.activeTrip }
                if summary.nextTrip?.id == tripId { return summary.nextTrip }
            }
            return summary.defaultTrip
        }()
        let zone = trip?.zone ?? .current
        if tripTitle == nil { tripTitle = trip?.title }

        if let eventId, let e = summary.nextEvents.first(where: { $0.id == eventId }) {
            if title.isEmpty { title = e.title }
            if icon == "map" || icon.isEmpty, kind != TravelNotificationKind.today { icon = e.iconName; colorKey = e.colorKey }
            if subtitle == nil { subtitle = e.location }
            if reference == nil { reference = e.bookingReference }
            if facts.isEmpty { facts = e.summary }
            if timeText == nil { timeText = e.timeText }
            if dateText == nil, e.shownDate != nil { dateText = SharedFormat.weekdayShortDate(e.shownDate) }
            if !hasServerLabel, kind != TravelNotificationKind.today, let label = e.roleLabel {
                kicker = label
                hasServerLabel = true
            }
            if startAt == nil { startAt = e.start(fallback: zone) }
            if address == nil { address = e.address }
            if lat == nil { lat = e.lat; lon = e.lon }
            if zoneNote == nil { zoneNote = e.localTimeNote(tripZone: zone) }
            if from == nil, to == nil, let route = e.routeText {
                let parts = route.components(separatedBy: " → ")
                if parts.count == 2 { from = parts[0]; to = parts[1] }
            }
        }

        if kind == TravelNotificationKind.today || rows.isEmpty && kind == TravelNotificationKind.today {
            let day = SharedFormat.isoDay(now, in: zone)
            let events = summary.nextEvents
                .filter { $0.appears(on: day) && !$0.isProposal && ($0.tripId == nil || trip == nil || $0.tripId == trip?.id) }
                .sorted { a, b in
                    if a.isMiddle != b.isMiddle { return !a.isMiddle }   // mehrtägige «middle» unten
                    return (a.timeText ?? "00:00") < (b.timeText ?? "00:00")
                }
            if rows.isEmpty {
                let next = events.first { ($0.start(fallback: zone) ?? .distantFuture) >= now }
                rows = events.prefix(5).map {
                    Row(time: $0.timeText ?? $0.roleLabel, title: $0.title, icon: $0.iconName, color: $0.colorKey,
                        isNext: $0.id == next?.id && $0.hasTime)
                }
                if startAt == nil, let next { startAt = next.start(fallback: zone) }
            }
            segments = events.compactMap { e in
                guard let hm = SharedFormat.hm(e.timeText) else { return nil }
                let start = hm.h * 60 + hm.m
                var end: Int?
                if e.dayRole == nil || e.dayRole == "single",
                   let et = SharedFormat.hm(e.endTime), et.h * 60 + et.m > start { end = et.h * 60 + et.m }
                return TBDayBand.Segment(startMinute: start, endMinute: end, colorKey: e.colorKey)
            }
            if dayCaption == nil {
                if let p = trip?.dayProgress(on: day) { dayCaption = "Tag \(p.index) von \(p.count)" }
                else if let t = summary.today, t.date == day, let i = t.dayIndex, let c = t.dayCount { dayCaption = "Tag \(i) von \(c)" }
            }
            if dateText == nil { dateText = SharedFormat.weekdayDate(day) }
        }
    }

    /// Hat die Darstellung genug, um mehr zu zeigen als Titel und Text?
    var hasStructure: Bool {
        timeText != nil || from != nil || to != nil || reference != nil || !rows.isEmpty || !facts.isEmpty
    }

    // MARK: Aktionen

    /// Ziel für «Route»: Apple Karten mit Wegbeschreibung zu Koordinate oder Adresse.
    var routeURL: URL? {
        var comps = URLComponents(string: "https://maps.apple.com/")
        if let lat, let lon {
            comps?.queryItems = [URLQueryItem(name: "daddr", value: "\(lat),\(lon)"), URLQueryItem(name: "dirflg", value: "d")]
        } else if let q = address ?? subtitle, !q.isEmpty {
            comps?.queryItems = [URLQueryItem(name: "daddr", value: q), URLQueryItem(name: "dirflg", value: "d")]
        } else {
            return nil
        }
        return comps?.url
    }

    /// Ziel für «Dokument»: Ereignis in der App, Bereich Dokumente.
    var documentURL: URL? {
        guard let tripId, let eventId else { return deepLink }
        var comps = URLComponents(url: SharedLink.event(trip: tripId, event: eventId), resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "section", value: "documents")]
        return comps?.url
    }

    var openURL: URL? {
        if let deepLink { return deepLink }
        if let tripId, let eventId { return SharedLink.event(trip: tripId, event: eventId) }
        if let tripId { return SharedLink.trip(tripId) }
        return SharedLink.today
    }

    // MARK: Beispiele (Vorschau, Screenshots)

    static func sample(kind: String, now: Date = Date()) -> TicketContent {
        var info: [AnyHashable: Any] = ["kind": kind, "tripId": 1, "eventId": 21, "deepLink": "travelbuddy://event/1/21"]
        func iso(_ minutes: Double) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(minutes * 60)) }
        var ticket: [String: Any] = [:]
        let content = UNMutableNotificationContent()
        switch kind {
        case TravelNotificationKind.depart:
            content.title = "Abflug in 3 Stunden"
            content.body = "Flug ZRH → LIS, LX 2086, 2026-10-26T07:45:00+01:00"
            ticket = ["type": "Flug", "title": "Flug ZRH → LIS", "startAt": iso(180), "tz": "Europe/Zurich", "from": "ZRH", "to": "LIS",
                      "place": "Zürich, Terminal 2", "reference": "X7K4QP", "tripTitle": "Lissabon im Herbst",
                      "facts": [["label": "Gate", "value": "B42"], ["label": "Sitz", "value": "12C"], ["label": "Boarding", "value": "07:10"]]]
        case TravelNotificationKind.stay:
            content.title = "Check-in heute"
            content.body = "Hotel Avenida ab 15:00"
            ticket = ["type": "Hotel", "title": "Hotel Avenida", "startAt": iso(95), "tz": "Europe/Lisbon", "place": "Avenida da Liberdade 12, Lissabon",
                      "dayRole": "start", "displayTime": "15:00", "displayLabel": "Check-in",
                      "reference": "AV55120", "tripTitle": "Lissabon im Herbst",
                      "facts": [["label": "Zimmer", "value": "Doppel"], ["label": "Nächte", "value": "4"]]]
        case TravelNotificationKind.pickup:
            content.title = "Mietwagen abholen"
            content.body = "Europcar, Flughafen Lissabon, 10:30"
            ticket = ["type": "Mietauto", "title": "Europcar Lissabon", "startAt": iso(70), "tz": "Europe/Lisbon", "place": "Flughafen, Ankunftshalle",
                      "reference": "EU7731", "tripTitle": "Lissabon im Herbst",
                      "facts": [["label": "Klasse", "value": "Kompakt"], ["label": "Kaution", "value": "CHF 300"]]]
        case TravelNotificationKind.deadline:
            content.title = "Kostenlos stornierbar bis morgen"
            content.body = "Hotel Avenida: Frist 2026-10-27"
            ticket = ["type": "Hotel", "title": "Hotel Avenida", "startAt": iso(26 * 60), "tz": "Europe/Zurich", "place": "Stornofrist",
                      "reference": "AV55120", "tripTitle": "Lissabon im Herbst", "deadlineKind": "cancel"]
        case TravelNotificationKind.review:
            content.title = "3 Vorschläge zu prüfen"
            content.body = "Aus Buchungsbestätigungen erkannt."
            ticket = ["title": "Neue Vorschläge", "count": 3, "tripTitle": "Lissabon im Herbst",
                      "items": [["title": "Flug ZRH → LIS", "type": "Flug", "time": "07:45"],
                                ["title": "Hotel Avenida", "type": "Hotel", "time": "15:00"],
                                ["title": "Mietwagen Europcar", "type": "Mietauto", "time": "10:30"]]]
        default:
            content.title = "Guten Morgen: Tag 3 von 29"
            content.body = "Heute 3 Ereignisse, als Nächstes Check-out 12:00."
            ticket = ["title": "Barcelona", "tripTitle": "Ferien 2026", "dayIndex": 3, "dayCount": 29, "tz": "Europe/Zurich",
                      "startAt": iso(100), "startDate": SharedFormat.isoDay(now, in: SharedSampleData.zone),
                      "items": [["time": "12:00", "title": "Check-out Hotel Negresco", "type": "Hotel"],
                                ["time": "13:00", "title": "Einschiffung Legend of the Seas", "type": "Kreuzfahrt"],
                                ["time": "17:00", "title": "Abfahrt Barcelona", "type": "Kreuzfahrt"],
                                ["time": "19:30", "title": "Abendessen an Bord", "type": "Restaurant"]]]
        }
        info["ticket"] = ticket
        content.userInfo = info
        content.categoryIdentifier = kind
        return TicketContent(notification: content)
    }
}
