import Foundation
import UserNotifications

// Mitteilungs-Nutzlast der Reise (Vertrag «Geräte, Push, Live Activities»): Kategorien, `deepLink`, `tripId`, `eventId?`,
// `kind`, `imageKey?`, `interruption`. Für die eigene Ticket-Darstellung nutzt die Inhalts-Erweiterung zusätzlich das
// optionale Objekt `ticket` (siehe `Ticket`); fehlt es, ergänzt sie aus dem Cache bzw. `GET /v1/summary`.

enum TravelNotificationKind {
    static let today = "trip.today"
    static let depart = "trip.depart"
    static let stay = "trip.stay"
    static let pickup = "trip.pickup"
    static let deadline = "trip.deadline"
    static let review = "trip.review"
    static let comment = "trip.comment"
    static let all = [today, depart, stay, pickup, deadline, review]
}

/// Aktions-Kennungen, die die App bei den Kategorien registriert (Öffnen, Dokument, Route).
enum TravelNotificationAction {
    static let open = "tb.open"
    static let document = "tb.document"
    static let route = "tb.route"

    enum Resolved { case open, document, route, defaultTap, other }

    /// Toleranter Abgleich: genaue Kennungen oder Stichwort in der Kennung.
    static func resolve(_ identifier: String) -> Resolved {
        if identifier == UNNotificationDefaultActionIdentifier { return .defaultTap }
        if identifier == UNNotificationDismissActionIdentifier { return .other }
        let id = identifier.lowercased()
        if id == open || id.hasSuffix(".open") || id == "open" { return .open }
        if id == document || id.contains("document") || id.contains("dokument") { return .document }
        if id == route || id.contains("route") || id.contains("directions") { return .route }
        return .other
    }
}

struct TravelNotificationPayload {
    struct Item: Equatable, Hashable {
        var time: String?
        var title: String
        var icon: String
        var color: String
    }

    struct Ticket: Equatable {
        var type: String?
        var icon: String?
        var color: String?
        var title: String?
        var startDate: String?
        var startTime: String?
        var endTime: String?
        var tz: String?
        var startAt: Date?
        var from: String?
        var to: String?
        var place: String?
        var address: String?
        var lat: Double?
        var lon: Double?
        var reference: String?
        var tripTitle: String?
        var dayIndex: Int?
        var dayCount: Int?
        var facts: [SharedSummary.KeyValue] = []
        var items: [Item] = []
        var count: Int?
        var deadlineKind: String?
    }

    var kind: String
    var deepLink: URL?
    var tripId: Int?
    var eventId: Int?
    var imageKey: String?
    var interruption: String?
    var relevance: Double?
    var ticket: Ticket

    init(userInfo: [AnyHashable: Any], category: String? = nil) {
        let info = userInfo
        // Nutzlast liegt auf oberster Ebene; ältere Server verpacken sie unter `data`.
        let nested = (info["data"] as? [String: Any]) ?? [:]
        func value(_ key: String) -> Any? { info[key] ?? nested[key] }
        func string(_ key: String) -> String? {
            if let s = value(key) as? String, !s.isEmpty { return s }
            if let n = value(key) as? NSNumber { return n.stringValue }
            return nil
        }
        func int(_ key: String) -> Int? {
            if let n = value(key) as? NSNumber { return n.intValue }
            if let s = value(key) as? String { return Int(s) }
            return nil
        }
        kind = string("kind") ?? category ?? ""
        if let s = string("deepLink") { deepLink = URL(string: s) }
        tripId = int("tripId")
        eventId = int("eventId")
        imageKey = string("imageKey").flatMap(Self.safeKey)
        interruption = string("interruption")
        relevance = (value("relevance") as? NSNumber)?.doubleValue

        let t = (value("ticket") as? [String: Any]) ?? [:]
        func ts(_ key: String, alt: String? = nil) -> String? {
            if let s = t[key] as? String, !s.isEmpty { return s }
            if let n = t[key] as? NSNumber { return n.stringValue }
            if let alt { return string(alt) }
            return nil
        }
        var ticket = Ticket()
        ticket.type = ts("type", alt: "eventType")
        ticket.icon = ts("icon")
        ticket.color = ts("color")
        ticket.title = ts("title", alt: "eventTitle")
        ticket.startDate = ts("startDate")
        ticket.startTime = ts("startTime")
        ticket.endTime = ts("endTime")
        ticket.tz = ts("tz", alt: "startTz")
        if let at = ts("startAt") { ticket.startAt = ISO8601DateFormatter().date(from: at) }
        ticket.from = ts("from")
        ticket.to = ts("to")
        ticket.place = ts("place", alt: "location")
        ticket.address = ts("address")
        ticket.lat = (t["lat"] as? NSNumber)?.doubleValue
        ticket.lon = (t["lon"] as? NSNumber)?.doubleValue
        ticket.reference = ts("reference", alt: "bookingReference")
        ticket.tripTitle = ts("tripTitle")
        ticket.dayIndex = (t["dayIndex"] as? NSNumber)?.intValue
        ticket.dayCount = (t["dayCount"] as? NSNumber)?.intValue
        ticket.count = (t["count"] as? NSNumber)?.intValue
        ticket.deadlineKind = ts("deadlineKind")
        if let facts = t["facts"] as? [[String: Any]] {
            ticket.facts = facts.compactMap { f in
                guard let l = f["label"] as? String, let v = f["value"] as? String else { return nil }
                return .init(label: l, value: v)
            }
        }
        if let items = t["items"] as? [[String: Any]] {
            ticket.items = items.compactMap { i in
                guard let title = i["title"] as? String else { return nil }
                let type = i["type"] as? String
                return Item(time: i["time"] as? String, title: title,
                            icon: (i["icon"] as? String) ?? SharedTypeCatalog.icon(type: type),
                            color: (i["color"] as? String) ?? SharedTypeCatalog.color(type: type))
            }
        }
        self.ticket = ticket
    }

    /// Nur Zeichen, die in einem Dateinamen unbedenklich sind (kein Pfad, kein `..`).
    static func safeKey(_ raw: String) -> String? {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        guard !raw.isEmpty, raw.count <= 80, !raw.contains(".."),
              raw.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return raw
    }

    var threadIdentifier: String? { tripId.map { "trip-\($0)" } }

    /// `active` oder `timeSensitive` nach Vertrag (`"active" | "time-sensitive"`).
    var interruptionLevel: UNNotificationInterruptionLevel {
        switch interruption?.lowercased() {
        case "time-sensitive", "timesensitive", "time_sensitive": .timeSensitive
        case "passive": .passive
        case "critical": .timeSensitive
        default: .active
        }
    }

    /// 0…1; Vorgabe nach Art, damit Abflug und Check-in in der Zusammenfassung oben stehen.
    var relevanceScore: Double {
        if let relevance { return min(1, max(0, relevance)) }
        switch kind {
        case TravelNotificationKind.depart: return 1.0
        case TravelNotificationKind.stay: return 0.9
        case TravelNotificationKind.pickup: return 0.85
        case TravelNotificationKind.deadline: return 0.8
        case TravelNotificationKind.today: return 0.7
        case TravelNotificationKind.review: return 0.4
        default: return 0.3
        }
    }
}

// MARK: - Text kürzen und formatieren

/// Datum `dd.mm.yyyy`, Zeit `hh:mm` und Länge für Mitteilungstexte.
enum NotificationText {
    static func format(_ text: String, tz: TimeZone? = nil, maxLength: Int? = nil) -> String {
        var s = text
        s = replaceISODateTimes(in: s, tz: tz)
        s = replaceISODates(in: s)
        s = replaceTwelveHourTimes(in: s)
        s = padSingleDigitHours(in: s)
        s = s.replacingOccurrences(of: "ß", with: "ss")
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if let maxLength { s = truncate(s, to: maxLength) }
        return s
    }

    /// Kürzt an einer Wortgrenze und hängt «…» an.
    static func truncate(_ text: String, to limit: Int) -> String {
        guard text.count > limit, limit > 1 else { return text }
        let head = String(text.prefix(limit - 1))
        if let space = head.lastIndex(where: { $0 == " " || $0 == "," || $0 == "·" }),
           head.distance(from: head.startIndex, to: space) > limit / 2 {
            return String(head[..<space]).trimmingCharacters(in: .whitespaces) + "…"
        }
        return head.trimmingCharacters(in: .whitespaces) + "…"
    }

    private static func regex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern)
    }

    private static func replace(_ re: NSRegularExpression?, in text: String, using transform: (NSTextCheckingResult, NSString) -> String?) -> String {
        guard let re else { return text }
        let ns = text as NSString
        var out = ""
        var cursor = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            out += transform(m, ns) ?? ns.substring(with: m.range)
            cursor = m.range.location + m.range.length
        }
        out += ns.substring(from: cursor)
        return out
    }

    /// `2026-10-25T15:00:00Z`, `2026-10-25 17:00`, `2026-10-25T17:00+02:00` → `25.10.2026 17:00`.
    private static func replaceISODateTimes(in text: String, tz: TimeZone?) -> String {
        let re = regex(#"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?"#)
        return replace(re, in: text) { m, ns in
            func g(_ i: Int) -> String? { m.range(at: i).location == NSNotFound ? nil : ns.substring(with: m.range(at: i)) }
            guard let y = g(1), let mo = g(2), let d = g(3), let h = g(4), let mi = g(5) else { return nil }
            if let zone = g(6) {
                let iso = "\(y)-\(mo)-\(d)T\(h):\(mi):00" + (zone == "Z" ? "Z" : (zone.contains(":") ? zone : String(zone.prefix(3)) + ":" + String(zone.suffix(2))))
                if let date = ISO8601DateFormatter().date(from: iso) {
                    return SharedFormat.dateTime(date, in: tz ?? .current)
                }
            }
            return "\(d).\(mo).\(y) \(h):\(mi)"
        }
    }

    /// `2026-10-25` → `25.10.2026`.
    private static func replaceISODates(in text: String) -> String {
        let re = regex(#"(?<![\d.])(\d{4})-(\d{2})-(\d{2})(?![\d])"#)
        return replace(re, in: text) { m, ns in
            "\(ns.substring(with: m.range(at: 3))).\(ns.substring(with: m.range(at: 2))).\(ns.substring(with: m.range(at: 1)))"
        }
    }

    /// `5:00 PM` → `17:00`, `12:30 am` → `00:30`.
    private static func replaceTwelveHourTimes(in text: String) -> String {
        let re = regex(#"\b(\d{1,2}):(\d{2})\s?([AaPp])\.?[Mm]\.?"#)
        return replace(re, in: text) { m, ns in
            guard var h = Int(ns.substring(with: m.range(at: 1))) else { return nil }
            let minute = ns.substring(with: m.range(at: 2))
            let pm = ns.substring(with: m.range(at: 3)).lowercased() == "p"
            if h == 12 { h = pm ? 12 : 0 } else if pm { h += 12 }
            return String(format: "%02d:%@", h % 24, minute)
        }
    }

    /// `7:45` → `07:45`.
    private static func padSingleDigitHours(in text: String) -> String {
        let re = regex(#"(?<![\d:.])(\d):(\d{2})(?![\d:])"#)
        return replace(re, in: text) { m, ns in
            "0\(ns.substring(with: m.range(at: 1))):\(ns.substring(with: m.range(at: 2)))"
        }
    }
}
