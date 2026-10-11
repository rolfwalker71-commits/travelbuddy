import Foundation

// `GET /v1/today?date=YYYY-MM-DD&tz=Europe/Zurich` (docs/CONTRACT.md, «Heute und Zusammenfassung»).

struct TodayTrip: Codable, Equatable, Hashable, Sendable {
    let id: Int
    var title: String
    var destination: String?
    var startDate: String?
    var endDate: String?
    var dayIndex: Int?
    var dayCount: Int?
    var coverUrl: String?
    var timezone: String?

    var zone: TimeZone { TripClock.zone(timezone) ?? .current }
}

struct TodayUpcoming: Codable, Equatable, Hashable, Sendable {
    let id: Int
    var title: String
    var startDate: String?
    var daysUntil: Int?
}

struct TodayTask: Codable, Equatable, Hashable, Sendable, Identifiable {
    let eventId: Int
    var title: String
    var dueDate: String?
    var id: Int { eventId }
}

struct TodayDeadline: Codable, Equatable, Hashable, Sendable, Identifiable {
    let eventId: Int
    var title: String
    /// `cancel` | `payment`
    var kind: String
    var date: String
    var id: String { "\(eventId)-\(kind)-\(date)" }

    var kindTitle: String { kind == "payment" ? "Zahlung fällig" : "Stornierbar bis" }
}

struct TodayLedger: Codable, Equatable, Hashable, Sendable {
    let id: Int
    var balanceMinor: Int
    var currency: String
}

struct TodayNow: Codable, Equatable, Hashable, Sendable {
    var local: String?
    var tz: String?
}

struct TodayResponse: Codable, Equatable, Sendable {
    var generatedAt: String?
    var trip: TodayTrip?
    var upcoming: TodayUpcoming?
    var date: String?
    var now: TodayNow?
    var next: TripEvent?
    var nextInSeconds: Double?
    var events: [TripEvent] = []
    var tomorrow: [TripEvent] = []
    var tasks: [TodayTask] = []
    var deadlines: [TodayDeadline] = []
    var review: Int = 0
    var ledger: TodayLedger?

    init(generatedAt: String? = nil, trip: TodayTrip? = nil, upcoming: TodayUpcoming? = nil, date: String? = nil,
         now: TodayNow? = nil, next: TripEvent? = nil, nextInSeconds: Double? = nil, events: [TripEvent] = [],
         tomorrow: [TripEvent] = [], tasks: [TodayTask] = [], deadlines: [TodayDeadline] = [], review: Int = 0,
         ledger: TodayLedger? = nil) {
        self.generatedAt = generatedAt; self.trip = trip; self.upcoming = upcoming; self.date = date; self.now = now
        self.next = next; self.nextInSeconds = nextInSeconds; self.events = events; self.tomorrow = tomorrow
        self.tasks = tasks; self.deadlines = deadlines; self.review = review; self.ledger = ledger
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
        trip = try? c.decodeIfPresent(TodayTrip.self, forKey: .trip)
        upcoming = try? c.decodeIfPresent(TodayUpcoming.self, forKey: .upcoming)
        date = try c.decodeIfPresent(String.self, forKey: .date)
        now = try? c.decodeIfPresent(TodayNow.self, forKey: .now)
        next = try? c.decodeIfPresent(TripEvent.self, forKey: .next)
        nextInSeconds = try? c.decodeIfPresent(Double.self, forKey: .nextInSeconds)
        events = (try? c.decodeIfPresent([TripEvent].self, forKey: .events)) ?? []
        tomorrow = (try? c.decodeIfPresent([TripEvent].self, forKey: .tomorrow)) ?? []
        tasks = (try? c.decodeIfPresent([TodayTask].self, forKey: .tasks)) ?? []
        deadlines = (try? c.decodeIfPresent([TodayDeadline].self, forKey: .deadlines)) ?? []
        review = try c.decodeIfPresent(Int.self, forKey: .review) ?? 0
        ledger = try? c.decodeIfPresent(TodayLedger.self, forKey: .ledger)
    }
}

// MARK: - Aufbereitung

/// Eine Zeile des Tages: ein Ereignis in seiner Rolle (Beginn, Ende, läuft) mit Zeitpunkt.
struct TodayEntry: Identifiable, Equatable, Sendable {
    enum Role: String, Sendable { case start, end, ongoing }

    let event: TripEvent
    let role: Role
    /// Wanduhr `HH:mm` (in `zoneID`), `nil` ohne Uhrzeit.
    let time: String?
    let zoneID: String?
    let instant: Date?

    var id: String { "\(event.id)-\(role.rawValue)" }
}

/// Aufbereiteter Heute-Stand für die Oberfläche: eine Pipeline für Serverantwort und Offline-Stand.
struct TodayPlan: Equatable, Sendable {
    var trip: TodayTrip?
    var upcoming: TodayUpcoming?
    var date: String
    var zoneID: String
    var generatedAt: Date?
    /// Stand stammt aus dem lokalen Zwischenspeicher, nicht vom Server.
    var isOffline = false
    /// Läuft über den Tag (Unterkunft, Mietauto, Kreuzfahrt), ohne feste Uhrzeit.
    var ongoing: [TodayEntry] = []
    /// Chronologisch, nur Einträge mit oder ohne Uhrzeit des heutigen Tages.
    var entries: [TodayEntry] = []
    var tomorrow: [TodayEntry] = []
    var next: TodayEntry?
    var tasks: [TodayTask] = []
    var deadlines: [TodayDeadline] = []
    var review = 0
    var ledger: TodayLedger?

    var tripZone: TimeZone { TripClock.zone(zoneID) ?? .current }
    var isEmpty: Bool { entries.isEmpty && ongoing.isEmpty }

    /// Verbleibende Zeit bis «Als Nächstes» ab `now`.
    func remaining(at now: Date) -> TimeInterval? {
        guard let t = next?.instant else { return nil }
        return t.timeIntervalSince(now)
    }

    /// Fortschritt des Rings 0…1: Anteil der Wartezeit, die seit dem vorigen Eintrag (oder höchstens 6 h) verstrichen ist.
    func ringProgress(at now: Date) -> Double {
        guard let target = next?.instant else { return 0 }
        let previous = entries.compactMap(\.instant).filter { $0 < target }.max()
        let window = min(6 * 3600, previous.map { target.timeIntervalSince($0) } ?? 6 * 3600)
        guard window > 0 else { return 1 }
        let left = max(0, target.timeIntervalSince(now))
        return min(1, max(0, 1 - left / window))
    }
}

enum TodayPlanner {
    static let stayTypes: Set<String> = ["Hotel", "Unterkunft", "Mietauto", "Kreuzfahrt"]

    /// Aus der Serverantwort die Anzeige bauen. `now` ist der Zeitpunkt der Anzeige (nicht `generatedAt`).
    static func plan(from response: TodayResponse, catalog: EventCatalog, now: Date = Date(),
                     isOffline: Bool = false) -> TodayPlan {
        let zoneID = response.trip?.timezone ?? response.now?.tz ?? TimeZone.current.identifier
        let zone = TripClock.zone(zoneID) ?? .current
        let date = response.date ?? TBDate.isoDay(of: now, in: zone)
        var plan = TodayPlan(trip: response.trip, upcoming: response.upcoming, date: date, zoneID: zoneID,
                             generatedAt: response.generatedAt.flatMap(TBDate.parseTimestamp), isOffline: isOffline)

        let built = entries(for: response.events, date: date, zone: zone)
        plan.ongoing = built.filter { $0.role == .ongoing }
        plan.entries = built.filter { $0.role != .ongoing }
        let tomorrowDate = TBDate.addDays(1, to: date) ?? date
        plan.tomorrow = entries(for: response.tomorrow, date: tomorrowDate, zone: zone).filter { $0.role != .ongoing }
        plan.tasks = response.tasks
        plan.deadlines = response.deadlines
        plan.review = response.review
        plan.ledger = response.ledger

        // Als Nächstes: erster Eintrag mit Zeitpunkt ab jetzt, sonst der erste von morgen.
        plan.next = plan.entries.first { ($0.instant ?? .distantPast) >= now }
            ?? plan.tomorrow.first { $0.instant != nil }
        if plan.next == nil, let n = response.next, let first = entries(for: [n], date: date, zone: zone).first {
            plan.next = first
        }
        return plan
    }

    /// Einträge für Ereignisse an einem Kalendertag, chronologisch nach Zeitpunkt, Einträge ohne Zeit zuletzt.
    static func entries(for events: [TripEvent], date: String, zone: TimeZone) -> [TodayEntry] {
        var out: [TodayEntry] = []
        for e in events where e.type != "Aufgabe" {
            let startsToday = e.startDate == date
            let endsToday = e.endDate == date && e.startDate != date
            if startsToday {
                let z = e.startZone(trip: zone)
                out.append(TodayEntry(event: e, role: .start, time: e.startTime, zoneID: e.startTz,
                                      instant: e.startTime == nil ? nil : TripClock.instant(date: e.startDate, time: e.startTime, zone: z)))
            } else if endsToday {
                let z = e.endZone(trip: zone)
                out.append(TodayEntry(event: e, role: .end, time: e.endTime, zoneID: e.endTz ?? e.startTz,
                                      instant: e.endTime == nil ? nil : TripClock.instant(date: e.endDate, time: e.endTime, zone: z)))
            } else if let s = e.startDate, s < date, let end = e.endDate, end > date {
                out.append(TodayEntry(event: e, role: .ongoing, time: nil, zoneID: nil, instant: nil))
            } else if e.startDate == nil || e.startDate == date {
                out.append(TodayEntry(event: e, role: .start, time: e.startTime, zoneID: e.startTz, instant: nil))
            }
        }
        return out.sorted { a, b in
            switch (a.instant, b.instant) {
            case let (x?, y?): return x != y ? x < y : a.event.sortKey < b.event.sortKey
            case (nil, _?): return false
            case (_?, nil): return true
            default: return a.event.sortKey != b.event.sortKey ? a.event.sortKey < b.event.sortKey : a.event.id < b.event.id
            }
        }
    }

    /// Aus einer (zwischengespeicherten) Reise den Heute-Stand ableiten, ohne Server.
    static func response(from detail: TripDetail, now: Date = Date(), myParticipantId: Int? = nil,
                         ledger: TodayLedger? = nil) -> TodayResponse {
        let trip = detail.trip
        let zone = trip.zone
        let today = TBDate.isoDay(of: now, in: zone)
        let tomorrow = TBDate.addDays(1, to: today) ?? today
        let visible = detail.events.filter { e in
            guard let me = myParticipantId, !e.participantIds.isEmpty else { return true }
            return e.participantIds.contains(me)
        }
        func touches(_ e: TripEvent, _ day: String) -> Bool {
            if e.startDate == day || e.endDate == day { return true }
            if let s = e.startDate, let end = e.endDate { return s < day && end > day && stayTypes.contains(e.type) }
            return false
        }
        let todayEvents = TripTimeline.sort(visible.filter { touches($0, today) && $0.type != "Aufgabe" }, tripZone: zone)
        let tomorrowEvents = TripTimeline.sort(visible.filter { ($0.startDate == tomorrow || $0.endDate == tomorrow) && $0.type != "Aufgabe" }, tripZone: zone)
        let tasks = visible.filter { $0.type == "Aufgabe" && $0.detail("done") != "true" && ($0.startDate ?? today) <= tomorrow }
            .map { TodayTask(eventId: $0.id, title: $0.title, dueDate: $0.startDate) }
        var deadlines: [TodayDeadline] = []
        for e in visible {
            if let c = e.cancelUntil, c >= today, (TBDate.days(from: today, to: c) ?? 99) <= 14 {
                deadlines.append(TodayDeadline(eventId: e.id, title: e.title, kind: "cancel", date: c))
            }
        }
        deadlines.sort { $0.date < $1.date }
        let dayIndex = trip.startDate.flatMap { TBDate.days(from: $0, to: today) }.map { $0 + 1 }
        let dayCount = trip.startDate.flatMap { s in trip.endDate.flatMap { TBDate.days(from: s, to: $0) } }.map { $0 + 1 }
        return TodayResponse(
            generatedAt: ISO8601DateFormatter().string(from: now),
            trip: TodayTrip(id: trip.id, title: trip.title, destination: trip.destination, startDate: trip.startDate,
                            endDate: trip.endDate, dayIndex: dayIndex, dayCount: dayCount, coverUrl: trip.coverUrl,
                            timezone: trip.timezone),
            date: today,
            now: TodayNow(local: TBDate.displayTime(now, timeZone: zone), tz: zone.identifier),
            events: todayEvents, tomorrow: tomorrowEvents, tasks: tasks, deadlines: deadlines,
            review: detail.events.filter { $0.status.isProposal }.count, ledger: ledger)
    }
}

// MARK: - Wichtiges je Typ

/// Die grossen Angaben auf der Ticket-Karte («Wichtiges»): je Typ die Felder, die man am Schalter braucht.
struct EventFact: Equatable, Sendable, Identifiable {
    let key: String
    let label: String
    let value: String
    /// Codes, Zeiten und Nummern werden in Mono gesetzt.
    let mono: Bool
    var id: String { key }
}

enum EventFacts {
    /// Vorrang je Typ; was fehlt, wird übersprungen, danach füllen `important`-Felder des Katalogs auf.
    private static let priority: [String: [String]] = [
        "Flug": ["departureTerminal", "departureGate", "seat", "boardingTime", "flightNumber"],
        "Zugreisen": ["departurePlatform", "coach", "seat", "trainNumber"],
        "Mietauto": ["pickupPlace", "pickupHours", "emergencyPhone", "vehicleCategory"],
        "Transfer": ["meetingPoint", "originPlace", "driverContact", "destinationPlace"],
        "Hotel": ["address", "accessCode", "checkInFrom", "checkOutUntil"],
        "Unterkunft": ["address", "accessCode", "checkInFrom", "checkOutUntil"],
        "Kreuzfahrt": ["cabin", "terminal", "allAboard", "ship"],
        "Ausflug": ["meetingPoint", "voucher", "durationMinutes", "bring"],
        "Restaurant": ["reservationName", "partySize", "table", "dressCode"],
        "Veranstaltung": ["doorsOpen", "seat", "venue", "ticketNumber"],
        "Versicherung": ["emergencyPhone", "policyNumber", "insurer"],
        "Visum": ["authorizationNumber", "applicationStatus", "country", "documentKind"],
        "Aufgabe": [],
    ]

    private static let monoKeys: Set<String> = [
        "departureTerminal", "departureGate", "seat", "boardingTime", "flightNumber", "departurePlatform", "coach",
        "trainNumber", "accessCode", "checkInFrom", "checkOutUntil", "cabin", "terminal", "allAboard", "doorsOpen",
        "ticketNumber", "policyNumber", "authorizationNumber", "emergencyPhone", "pickupHours", "partySize", "table",
        "bookingReference", "checkInOpens", "checkInCloses", "arrivalTerminal", "arrivalGate", "baggageBelt",
        "arrivalPlatform", "durationMinutes",
    ]

    /// - Parameters:
    ///   - limit: höchstens so viele Angaben.
    ///   - participantId: «ich», für den Sitz in `passengers`.
    static func big(for event: TripEvent, catalog: EventCatalog, participantId: Int? = nil, limit: Int = 4) -> [EventFact] {
        let type = catalog.typeOrFallback(for: event.type)
        var out: [EventFact] = []
        var used = Set<String>()

        func add(_ key: String) {
            guard out.count < limit, !used.contains(key), let fact = fact(key, event: event, type: type,
                                                                          catalog: catalog, participantId: participantId)
            else { return }
            used.insert(key)
            out.append(fact)
        }
        for key in priority[type.id] ?? priority[catalog.aliases[type.id] ?? ""] ?? [] { add(key) }
        for field in catalog.fields(of: type) where field.important { add(field.key) }
        return out
    }

    static func fact(_ key: String, event: TripEvent, type: EventTypeDef, catalog: EventCatalog,
                     participantId: Int?) -> EventFact? {
        var label: String?
        var value: String?
        switch key {
        case "address": value = event.address; label = "Adresse"
        case "bookingReference": value = event.bookingReference; label = "Buchung"
        case "seat", "coach":
            if let p = passenger(event, participantId: participantId)?[key]?.stringValue, !p.isEmpty { value = p }
            else if key == "seat" { value = event.detail("seat") }
            label = key == "seat" ? "Sitz" : "Wagen"
        default:
            value = event.detail(key)
        }
        if label == nil { label = catalog.field(key: key, in: type)?.label ?? key }
        guard let v = value?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty, let l = label else { return nil }
        let display: String
        if let f = catalog.field(key: key, in: type), f.kind == .select { display = f.optionLabel(v) }
        else if key == "durationMinutes", let n = Int(v) { display = TBDate.duration(minutes: n) }
        else if let f = catalog.field(key: key, in: type), f.kind == .bool { display = v == "true" ? "Ja" : "Nein" }
        else { display = v }
        return EventFact(key: key, label: l, value: display, mono: monoKeys.contains(key))
    }

    /// Eintrag von «mir» in `details.passengers`, sonst der erste mit Sitz.
    static func passenger(_ event: TripEvent, participantId: Int?) -> [String: JSONValue]? {
        guard let list = event.details["passengers"]?.arrayValue?.compactMap(\.objectValue), !list.isEmpty else { return nil }
        if let me = participantId, let mine = list.first(where: { $0["participantId"]?.intValue == me }) { return mine }
        return list.first
    }
}
