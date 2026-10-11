import AppIntents
import WidgetKit

/// Auswahl einer Reise für ein Widget. Ohne Auswahl («Automatisch») zeigt das Widget die aktive, sonst die nächste Reise.
struct TripEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = TypeDisplayRepresentation(name: "Reise")
    static var defaultQuery = TripEntityQuery()

    var id: String
    var title: String
    var subtitle: String?

    var tripId: Int? { Int(id) }

    var displayRepresentation: DisplayRepresentation {
        if let subtitle, !subtitle.isEmpty {
            return DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
        }
        return DisplayRepresentation(title: "\(title)")
    }

    init(id: String, title: String, subtitle: String? = nil) {
        self.id = id; self.title = title; self.subtitle = subtitle
    }

    init(_ trip: SharedSummary.Trip) {
        let range = trip.range
        self.init(id: String(trip.id), title: trip.title, subtitle: range.isEmpty ? trip.destination : range)
    }
}

struct TripEntityQuery: EntityQuery {
    /// Auflösung gespeicherter Auswahlen. Ohne Netz bleibt die Auswahl mit der ID erhalten.
    func entities(for identifiers: [String]) async throws -> [TripEntity] {
        let known = (try? await loadTrips()) ?? []
        return identifiers.map { id in
            if let trip = known.first(where: { String($0.id) == id }) { return TripEntity(trip) }
            return TripEntity(id: id, title: "Reise \(id)")
        }
    }

    func suggestedEntities() async throws -> [TripEntity] {
        try await loadTrips().map(TripEntity.init)
    }

    /// Laufende und kommende Reisen zuerst, vergangene am Ende.
    private func loadTrips() async throws -> [SharedSummary.Trip] {
        guard let api = SharedAPI(session: SharedAPI.shortSession(request: 8, resource: 10)) else { return [] }
        let trips = try await api.trips()
        let today = SharedFormat.isoDay(Date())
        func rank(_ t: SharedSummary.Trip) -> Int {
            switch t.phase ?? t.phase(on: today) {
            case "active": 0
            case "upcoming": 1
            default: 2
            }
        }
        return trips.sorted { a, b in
            let ra = rank(a), rb = rank(b)
            if ra != rb { return ra < rb }
            return (a.startDate ?? "") < (b.startDate ?? "")
        }
    }
}

struct SelectTripIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Reise wählen"
    static var description = IntentDescription("Wähle die Reise, die das Widget zeigt. Ohne Auswahl erscheint die aktive oder nächste Reise.")

    @Parameter(title: "Reise")
    var trip: TripEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Reise: \(\.$trip)")
    }

    init() {}
    init(trip: TripEntity?) { self.trip = trip }

    var tripId: Int? { trip?.tripId }
}
