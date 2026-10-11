import Foundation

/// Beispieldaten für Platzhalter, Widget-Galerie, Vorschauen und Screenshot-Läufe. Keine echten Reisedaten.
/// Die Zeiten hängen von `now` ab, damit Countdown und «Als Nächstes» in der Vorschau immer sinnvoll sind.
enum SharedSampleData {
    static let zone = TimeZone(identifier: "Europe/Zurich") ?? .current

    private static func local(_ date: Date) -> (day: String, time: String) {
        (SharedFormat.isoDay(date, in: zone), SharedFormat.time(date, in: zone))
    }

    /// Aktive Reise «Ferien 2026», Tag 3 von 29, mit Ereignissen im Lauf des Tages.
    static func summary(now: Date = Date()) -> SharedSummary {
        let day = SharedFormat.isoDay(now, in: zone)
        let start = SharedFormat.isoDay(now.addingTimeInterval(-2 * 86_400), in: zone)
        let end = SharedFormat.isoDay(now.addingTimeInterval(26 * 86_400), in: zone)
        let checkout = local(now.addingTimeInterval(100 * 60))
        let boarding = local(now.addingTimeInterval(160 * 60))
        let departure = local(now.addingTimeInterval(340 * 60))
        let dinner = local(now.addingTimeInterval(520 * 60))
        let tomorrow = SharedFormat.isoDay(now.addingTimeInterval(86_400), in: zone)
        let trip = SharedSummary.Trip(
            id: 1, title: "Ferien 2026", destination: "Barcelona → Florida", startDate: start, endDate: end,
            phase: "active", timezone: zone.identifier, ledgerId: 1, dayIndex: 3, dayCount: 29)
        let events: [SharedSummary.Event] = [
            .init(id: 11, tripId: 1, type: "Hotel", title: "Check-out Hotel Negresco", startDate: checkout.day,
                  startTime: checkout.time, startTz: zone.identifier, location: "Negresco Princess 4*",
                  bookingReference: "HN48271", icon: "bed", color: "stay",
                  summary: [.init(label: "Zimmer", value: "412")]),
            .init(id: 12, tripId: 1, type: "Kreuzfahrt", title: "Einschiffung", startDate: boarding.day,
                  startTime: boarding.time, startTz: zone.identifier, location: "Terminal Port Nou",
                  bookingReference: "RCI7KQ4", icon: "ship", color: "ship",
                  summary: [.init(label: "Schiff", value: "Legend of the Seas")]),
            .init(id: 13, tripId: 1, type: "Kreuzfahrt", title: "Abfahrt Barcelona", startDate: departure.day,
                  startTime: departure.time, startTz: zone.identifier, location: "Alle an Bord bis 16:30",
                  bookingReference: "RCI7KQ4", icon: "ship", color: "ship"),
            .init(id: 14, tripId: 1, type: "Restaurant", title: "Abendessen Bord", startDate: dinner.day,
                  startTime: dinner.time, startTz: zone.identifier, location: "Hauptrestaurant", icon: "fork", color: "food"),
            .init(id: 15, tripId: 1, type: "Ausflug", title: "Palma de Mallorca", startDate: tomorrow, startTime: "07:30",
                  startTz: zone.identifier, location: "Hafentag, 07:30–15:30", icon: "map", color: "activity"),
        ]
        return SharedSummary(
            generatedAt: ISO8601DateFormatter().string(from: now), activeTrip: trip, nextTrip: nil,
            nextEvents: events, today: .init(date: day, dayIndex: 3, dayCount: 29), ledger: ledger)
    }

    /// Bevorstehende Reise: Abflug in 12 Tagen.
    static func upcomingSummary(now: Date = Date()) -> SharedSummary {
        let startDay = SharedFormat.isoDay(now.addingTimeInterval(12 * 86_400), in: zone)
        let endDay = SharedFormat.isoDay(now.addingTimeInterval(26 * 86_400), in: zone)
        let trip = SharedSummary.Trip(
            id: 2, title: "Lissabon im Herbst", destination: "Lissabon, Portugal", startDate: startDay, endDate: endDay,
            phase: "upcoming", timezone: "Europe/Lisbon", ledgerId: 2)
        let flight = SharedSummary.Event(
            id: 21, tripId: 2, type: "Flug", title: "Flug ZRH → LIS", startDate: startDay, startTime: "07:45",
            startTz: "Europe/Zurich", endDate: startDay, endTime: "09:50", endTz: "Europe/Lisbon", location: "Zürich, Terminal 2",
            bookingReference: "X7K4QP", icon: "plane", color: "air",
            summary: [.init(label: "Flug", value: "LX 2086"), .init(label: "Gate", value: "B42"), .init(label: "Sitz", value: "12C")])
        let hotel = SharedSummary.Event(
            id: 22, tripId: 2, type: "Hotel", title: "Check-in Hotel Avenida", startDate: startDay, startTime: "15:00",
            startTz: "Europe/Lisbon", location: "Avenida da Liberdade", bookingReference: "AV55120", icon: "bed", color: "stay")
        return SharedSummary(
            generatedAt: ISO8601DateFormatter().string(from: now), activeTrip: nil, nextTrip: trip,
            nextEvents: [flight, hotel], today: nil, ledger: nil)
    }

    static var ledger: SharedSummary.Ledger {
        .init(id: 1, title: "Ferien 2026", currency: "CHF", balanceMinor: 124_000, balances: [
            .init(id: 1, name: "Rolf", netMinor: 124_000, isMe: true),
            .init(id: 2, name: "Valentyna", netMinor: -31_000),
            .init(id: 3, name: "Eliane", netMinor: -52_000),
            .init(id: 4, name: "Harald", netMinor: -41_000),
        ], myMemberId: 1)
    }
}
