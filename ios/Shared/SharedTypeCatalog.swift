import Foundation

/// Ereignistypen der Erweiterungen: Spiegel von `shared/event-types.json` (Einzige Quelle der Wahrheit ist die JSON-Datei;
/// hier nur, was Widgets/Live Activity/Mitteilungen brauchen: Icon, Typfarbe, Beschriftungen).
struct SharedEventType: Hashable {
    let id: String
    let label: String
    let icon: String        // Katalog-Icon (plane, train, bed, …)
    let color: String       // Katalog-Farbe (air, rail, stay, …) → `TB.Palette.type(_:)`
    let startLabel: String
    let endLabel: String
}

enum SharedTypeCatalog {
    static let all: [SharedEventType] = [
        .init(id: "Flug", label: "Flug", icon: "plane", color: "air", startLabel: "Abflug", endLabel: "Ankunft"),
        .init(id: "Zugreisen", label: "Zug", icon: "train", color: "rail", startLabel: "Abfahrt", endLabel: "Ankunft"),
        .init(id: "Mietauto", label: "Mietauto", icon: "car", color: "car", startLabel: "Abholung", endLabel: "Rückgabe"),
        .init(id: "Transfer", label: "Transfer", icon: "transfer", color: "transfer", startLabel: "Abholung", endLabel: "Ankunft"),
        .init(id: "Hotel", label: "Hotel", icon: "bed", color: "stay", startLabel: "Check-in", endLabel: "Check-out"),
        .init(id: "Unterkunft", label: "Ferienwohnung", icon: "bed", color: "stay", startLabel: "Check-in", endLabel: "Check-out"),
        .init(id: "Kreuzfahrt", label: "Kreuzfahrt", icon: "ship", color: "ship", startLabel: "Beginn", endLabel: "Ende"),
        .init(id: "Ausflug", label: "Ausflug", icon: "map", color: "activity", startLabel: "Beginn", endLabel: "Ende"),
        .init(id: "Restaurant", label: "Restaurant", icon: "fork", color: "food", startLabel: "Reservierung", endLabel: "Ende"),
        .init(id: "Veranstaltung", label: "Veranstaltung", icon: "ticket", color: "ticket", startLabel: "Beginn", endLabel: "Ende"),
        .init(id: "Versicherung", label: "Versicherung", icon: "shield", color: "safety", startLabel: "Gültig ab", endLabel: "Gültig bis"),
        .init(id: "Visum", label: "Visum / Einreise", icon: "passport", color: "doc", startLabel: "Gültig ab", endLabel: "Gültig bis"),
        .init(id: "Aufgabe", label: "Aufgabe", icon: "task", color: "task", startLabel: "Fällig", endLabel: ""),
    ]

    /// Alte und alternative Bezeichnungen (`aliases` im Katalog).
    private static let aliases: [String: String] = [
        "Mietwagen": "Mietauto", "Aktivitaet": "Ausflug", "Aktivität": "Ausflug", "Notiz": "Aufgabe",
        "Sonstiges": "Ausflug", "Bahn": "Zugreisen", "Zug": "Zugreisen", "Train": "Zugreisen", "Parking": "Transfer",
        "Visa / Einreise": "Visum", "Pauschalreise / Urlaub": "Ausflug", "Reiseversicherung": "Versicherung",
    ]

    static func info(for typeId: String?) -> SharedEventType {
        let raw = (typeId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let id = aliases[raw] ?? raw
        return all.first { $0.id == id } ?? SharedEventType(
            id: raw, label: raw.isEmpty ? "Ereignis" : raw, icon: "map", color: "activity",
            startLabel: "Beginn", endLabel: "Ende")
    }

    /// Katalog-Icon für eine Typ-ID oder, falls der Server `icon` mitliefert, dieses.
    static func icon(type: String?, override: String? = nil) -> String {
        if let override, !override.isEmpty { return override }
        return info(for: type).icon
    }

    static func color(type: String?, override: String? = nil) -> String {
        if let override, !override.isEmpty { return override }
        return info(for: type).color
    }
}

/// Deep-Links `travelbuddy://…` (Vertrag «Identität»).
enum SharedLink {
    static func url(_ host: String, _ path: [Int?] = []) -> URL {
        var s = "\(SharedConfig.urlScheme)://\(host)"
        for part in path { if let part { s += "/\(part)" } }
        return URL(string: s) ?? URL(string: "\(SharedConfig.urlScheme)://today")!
    }

    static var today: URL { url("today") }
    static var inbox: URL { url("inbox") }
    static func trip(_ id: Int) -> URL { url("trip", [id]) }
    static func event(trip: Int, event: Int) -> URL { url("event", [trip, event]) }
    static func ledger(_ id: Int) -> URL { url("ledger", [id]) }
}
