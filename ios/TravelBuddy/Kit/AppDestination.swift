import Foundation

/// Ziel innerhalb der App, aus einem Link (`travelbuddy://event/3/17`), einem Widget oder einer Mitteilung.
/// Reine Logik; das Öffnen übernimmt der `Router`. Vertrag: docs/CONTRACT.md, «Identität».
enum AppDestination: Equatable, Hashable, Sendable {
    case today
    case trips
    case account
    case inbox
    case trip(Int)
    case event(tripID: Int, eventID: Int)
    case ledger(Int)

    /// Aktion, die nach dem Öffnen eines Ereignisses ausgeführt werden soll (Mitteilungs-Aktionen).
    enum EventAction: String, Sendable { case open, document, route }

    // MARK: URL

    var url: URL {
        var comps = URLComponents()
        comps.scheme = SharedConfig.urlScheme
        switch self {
        case .today: comps.host = "today"
        case .trips: comps.host = "trips"
        case .account: comps.host = "account"
        case .inbox: comps.host = "inbox"
        case .trip(let id): comps.host = "trip"; comps.path = "/\(id)"
        case .event(let t, let e): comps.host = "event"; comps.path = "/\(t)/\(e)"
        case .ledger(let id): comps.host = "ledger"; comps.path = "/\(id)"
        }
        return comps.url ?? URL(string: "\(SharedConfig.urlScheme)://today")!
    }

    /// `travelbuddy://trip/12`, `travelbuddy://event/12/45`, `travelbuddy://today`, `travelbuddy://ledger/3`, `travelbuddy://inbox`.
    init?(url: URL) {
        guard url.scheme?.lowercased() == SharedConfig.urlScheme else { return nil }
        var parts = [String]()
        if let host = url.host(percentEncoded: false), !host.isEmpty { parts.append(host.lowercased()) }
        parts += url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        guard let area = parts.first else { return nil }
        let rest = Array(parts.dropFirst())

        switch area {
        case "today", "heute":
            guard rest.isEmpty else { return nil }
            self = .today
        case "trips", "reisen":
            guard rest.isEmpty else { return nil }
            self = .trips
        case "account", "konto":
            guard rest.isEmpty else { return nil }
            self = .account
        case "inbox", "pruefung":
            guard rest.isEmpty else { return nil }
            self = .inbox
        case "trip":
            guard rest.count == 1, let id = Self.identifier(rest[0]) else { return nil }
            self = .trip(id)
        case "ledger":
            guard rest.count == 1, let id = Self.identifier(rest[0]) else { return nil }
            self = .ledger(id)
        case "event":
            guard rest.count == 2, let t = Self.identifier(rest[0]), let e = Self.identifier(rest[1]) else { return nil }
            self = .event(tripID: t, eventID: e)
        default:
            return nil
        }
    }

    /// Ziel samt Aktion: `travelbuddy://event/3/17?section=documents` öffnet das Ereignis und das Dokument.
    static func parse(url: URL) -> (destination: AppDestination, action: EventAction)? {
        guard let dest = AppDestination(url: url) else { return nil }
        let section = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "section" }?.value
        if case .event = dest, section == "documents" { return (dest, .document) }
        if case .event = dest, section == "route" { return (dest, .route) }
        return (dest, .open)
    }

    // MARK: Mitteilung

    /// Wie `init?(pushUserInfo:)`, inklusive Aktion aus `?section=` im Link.
    static func parse(pushUserInfo info: [AnyHashable: Any]) -> (destination: AppDestination, action: EventAction)? {
        let payload = (info["data"] as? [AnyHashable: Any]).map { $0.merging(info) { a, _ in a } } ?? info
        if let link = payload["deepLink"] as? String, let url = URL(string: link), let r = parse(url: url) { return r }
        return AppDestination(pushUserInfo: info).map { ($0, .open) }
    }

    /// Liest die Nutzlast: `deepLink`, `tripId`, `eventId?`, `kind`. Der Link gewinnt; fehlt er, entscheiden die IDs.
    /// Die Nutzlast steht entweder auf oberster Ebene oder unter `data` (wie bei HomeBuddy).
    init?(pushUserInfo userInfo: [AnyHashable: Any]) {
        let payload = (userInfo["data"] as? [AnyHashable: Any]).map { $0.merging(userInfo) { a, _ in a } } ?? userInfo
        if let link = payload["deepLink"] as? String, let url = URL(string: link), let d = AppDestination(url: url) {
            self = d
            return
        }
        let trip = Self.identifier(payload["tripId"])
        let event = Self.identifier(payload["eventId"])
        let kind = payload["kind"] as? String
        switch (kind, trip, event) {
        case ("ledger.expense", _, _), ("ledger.settlement", _, _):
            if let ledger = Self.identifier(payload["ledgerId"]) { self = .ledger(ledger); return }
            if let trip { self = .trip(trip); return }
            return nil
        case ("trip.review", _, _): self = .inbox
        case ("trip.today", _, _): self = .today
        case (_, let t?, let e?): self = .event(tripID: t, eventID: e)
        case (_, let t?, nil): self = .trip(t)
        default: return nil
        }
    }

    // MARK: Hilfen

    /// Positive ganze Zahl aus `Int`, `NSNumber` (ohne Nachkommastellen) oder Text.
    static func identifier(_ raw: Any?) -> Int? {
        let value: Int?
        switch raw {
        case let n as Int: value = n
        case let s as String: value = Int(s.trimmingCharacters(in: .whitespaces))
        case let n as NSNumber:
            let d = n.doubleValue
            value = d == d.rounded() && abs(d) < 1e15 ? n.intValue : nil
        default: value = nil
        }
        guard let value, value > 0 else { return nil }
        return value
    }
}
