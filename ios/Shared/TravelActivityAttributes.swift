import Foundation
import ActivityKit

/// Live Activity der Reise. Vertrag mit dem Server: `docs/CONTRACT.md`, Abschnitt «Geräte, Push, Live Activities».
/// Zeitpunkte sind Unix-Sekunden (UTC), damit Push-Nutzlasten unabhängig vom Date-Codec bleiben.
public struct TravelActivityAttributes: ActivityAttributes {
    public enum Kind: String, Codable, Hashable { case day, flight, checkin }
    public enum Stage: String, Codable, Hashable {
        case upcoming, checkIn, boarding, underway, arrived, atStay, generic
    }

    public struct ContentState: Codable, Hashable {
        public var headline: String            // «Abflug ZRH → BCN»
        public var detail: String?             // «LX 1952 · Gate B42 · Sitz 12C»
        public var icon: String                // Katalog-Icon: plane, bed, ship, car, train, …
        public var colorKey: String            // Katalog-Farbe: air, stay, ship, …
        public var stage: Stage
        public var milestoneLabel: String?     // «Boarding», «Abfahrt», «Check-out»
        public var milestoneAt: Double?        // Unix-Sekunden
        public var progress: Double?           // 0...1
        public var nextHeadline: String?
        public var nextAt: Double?             // Unix-Sekunden
        public var updatedAt: Double

        public init(headline: String, detail: String? = nil, icon: String, colorKey: String, stage: Stage = .generic,
                    milestoneLabel: String? = nil, milestoneAt: Double? = nil, progress: Double? = nil,
                    nextHeadline: String? = nil, nextAt: Double? = nil, updatedAt: Double = Date().timeIntervalSince1970) {
            self.headline = headline; self.detail = detail; self.icon = icon; self.colorKey = colorKey
            self.stage = stage; self.milestoneLabel = milestoneLabel; self.milestoneAt = milestoneAt
            self.progress = progress; self.nextHeadline = nextHeadline; self.nextAt = nextAt; self.updatedAt = updatedAt
        }

        public var milestoneDate: Date? { milestoneAt.map { Date(timeIntervalSince1970: $0) } }
        public var nextDate: Date? { nextAt.map { Date(timeIntervalSince1970: $0) } }
    }

    public var tripId: Int
    public var tripTitle: String
    public var kind: Kind
    public var eventId: Int?
    public var deepLink: String

    public init(tripId: Int, tripTitle: String, kind: Kind, eventId: Int? = nil, deepLink: String) {
        self.tripId = tripId; self.tripTitle = tripTitle; self.kind = kind; self.eventId = eventId; self.deepLink = deepLink
    }
}
