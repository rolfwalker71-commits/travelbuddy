import Foundation

// MARK: - Tolerantes Dekodieren

/// Der Vertrag lässt Felder offen («…»); die Erweiterungen dürfen daran nie scheitern. Alles ist optional, Zahlen dürfen
/// als Text kommen und umgekehrt.
extension KeyedDecodingContainer {
    func tbString(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return String(i) }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return String(d) }
        return nil
    }

    func tbInt(_ key: Key) -> Int? {
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return Int(d.rounded()) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Int(s) }
        return nil
    }

    func tbDouble(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }

    func tbBool(_ key: Key) -> Bool? {
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return b }
        return nil
    }

    func tbArray<T: Decodable>(_ key: Key, of type: T.Type = T.self) -> [T] {
        (try? decodeIfPresent([Lossy<T>].self, forKey: key))?.compactMap(\.value) ?? []
    }

    func tbValue<T: Decodable>(_ key: Key, as type: T.Type = T.self) -> T? {
        try? decodeIfPresent(T.self, forKey: key)
    }
}

/// Einzelne fehlerhafte Listeneinträge werden übersprungen, die Liste bleibt.
struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

// MARK: - Zusammenfassung `GET /v1/summary`

/// `GET /v1/summary` (Widgets, kompakt): `{ generatedAt, activeTrip?, nextTrip?, nextEvents[], today, ledger? }`.
/// Dieselben Modelle dienen für eine aus `GET /v1/trips/:id` gebaute Ansicht einer gewählten Reise.
struct SharedSummary: Codable, Equatable {
    struct KeyValue: Codable, Equatable, Hashable {
        var label: String
        var value: String
    }

    struct Event: Codable, Equatable, Hashable, Identifiable {
        var id: Int
        var tripId: Int?
        var type: String
        var title: String
        var startDate: String?
        var startTime: String?
        var startTz: String?
        var endDate: String?
        var endTime: String?
        var endTz: String?
        var location: String?
        var address: String?
        var provider: String?
        var bookingReference: String?
        var icon: String?
        var color: String?
        var status: String?
        var lat: Double?
        var lon: Double?
        var summary: [KeyValue]
        /// Tagesrolle mehrtägiger Ereignisse (Vertrag): `single` | `start` | `middle` | `end`; `nil` bei älteren Servern.
        var dayRole: String?
        var displayTime: String?
        var displayLabel: String?

        private enum CodingKeys: String, CodingKey {
            case id, tripId, type, title, startDate, startTime, startTz, endDate, endTime, endTz, location, address
            case provider, bookingReference, icon, color, status, lat, lon, summary
            case dayRole, displayTime, displayLabel
        }

        init(id: Int, tripId: Int? = nil, type: String, title: String, startDate: String? = nil,
             startTime: String? = nil, startTz: String? = nil, endDate: String? = nil, endTime: String? = nil,
             endTz: String? = nil, location: String? = nil, address: String? = nil, provider: String? = nil,
             bookingReference: String? = nil, icon: String? = nil, color: String? = nil, status: String? = nil,
             lat: Double? = nil, lon: Double? = nil, summary: [KeyValue] = [],
             dayRole: String? = nil, displayTime: String? = nil, displayLabel: String? = nil) {
            self.dayRole = dayRole; self.displayTime = displayTime; self.displayLabel = displayLabel
            self.id = id; self.tripId = tripId; self.type = type; self.title = title
            self.startDate = startDate; self.startTime = startTime; self.startTz = startTz
            self.endDate = endDate; self.endTime = endTime; self.endTz = endTz
            self.location = location; self.address = address; self.provider = provider
            self.bookingReference = bookingReference; self.icon = icon; self.color = color; self.status = status
            self.lat = lat; self.lon = lon; self.summary = summary
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard let id = c.tbInt(.id) else {
                throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: c.codingPath, debugDescription: "id"))
            }
            self.id = id
            tripId = c.tbInt(.tripId)
            type = c.tbString(.type) ?? ""
            title = c.tbString(.title) ?? ""
            startDate = c.tbString(.startDate); startTime = c.tbString(.startTime); startTz = c.tbString(.startTz)
            endDate = c.tbString(.endDate); endTime = c.tbString(.endTime); endTz = c.tbString(.endTz)
            location = c.tbString(.location); address = c.tbString(.address); provider = c.tbString(.provider)
            bookingReference = c.tbString(.bookingReference)
            icon = c.tbString(.icon); color = c.tbString(.color); status = c.tbString(.status)
            lat = c.tbDouble(.lat); lon = c.tbDouble(.lon)
            summary = c.tbArray(.summary, of: KeyValue.self)
            dayRole = c.tbString(.dayRole)
            displayTime = c.tbString(.displayTime)
            displayLabel = c.tbString(.displayLabel)
        }

        // Ableitungen

        var catalog: SharedEventType { SharedTypeCatalog.info(for: type) }
        var iconName: String { SharedTypeCatalog.icon(type: type, override: icon) }
        var colorKey: String { SharedTypeCatalog.color(type: type, override: color) }
        var isProposal: Bool { status == "proposed" || status == "needs_review" }
        var isMiddle: Bool { dayRole == "middle" }

        /// Angezeigte Uhrzeit: mit Rolle `displayTime` (bei `middle` keine), sonst `startTime`.
        var timeText: String? {
            dayRole != nil ? SharedFormat.time(displayTime) : SharedFormat.time(startTime)
        }
        var hasTime: Bool { timeText != nil }

        /// Tag der Anzeige: bei `end` das Enddatum, sonst der Beginn.
        var shownDate: String? { dayRole == "end" ? (endDate ?? startDate) : startDate }
        var dateText: String { SharedFormat.date(shownDate) }

        /// Beschriftung der Rolle («Check-in», «Check-out», «Aufenthalt», «Unterwegs»); ohne Server-Angabe aus dem Katalog.
        var roleLabel: String? {
            if let displayLabel, !displayLabel.isEmpty { return displayLabel }
            switch dayRole {
            case "start": return catalog.startLabel.isEmpty ? nil : catalog.startLabel
            case "end": return catalog.endLabel.isEmpty ? nil : catalog.endLabel
            case "middle": return catalog.icon == "bed" ? "Aufenthalt" : "Unterwegs"
            default: return nil
            }
        }

        /// Liegt dieses Ereignis am lokalen Tag `day` an (angezeigter Tag, `middle` an allen Tagen dazwischen)?
        func appears(on day: String) -> Bool {
            if isMiddle {
                guard let s = startDate else { return false }
                return s <= day && day <= (endDate ?? s)
            }
            return shownDate == day
        }

        func startZone(fallback: TimeZone) -> TimeZone {
            if let startTz, let tz = TimeZone(identifier: startTz) { return tz }
            return fallback
        }

        /// Zeitpunkt der Anzeige: bei `end` das Ende (Check-out, Ortszeit des Endes), bei `middle` keiner,
        /// sonst der Beginn.
        func start(fallback: TimeZone = .current) -> Date? {
            switch dayRole {
            case "middle":
                return nil
            case "end":
                var tz = startZone(fallback: fallback)
                if let endTz, let z = TimeZone(identifier: endTz) { tz = z }
                return SharedFormat.moment(date: endDate ?? startDate, time: displayTime ?? endTime, tz: tz)
            case .some:
                return SharedFormat.moment(date: startDate, time: displayTime ?? startTime, tz: startZone(fallback: fallback))
            case .none:
                return SharedFormat.moment(date: startDate, time: startTime, tz: startZone(fallback: fallback))
            }
        }

        func end(fallback: TimeZone = .current) -> Date? {
            var tz = fallback
            if let endTz, let z = TimeZone(identifier: endTz) { tz = z } else { tz = startZone(fallback: fallback) }
            return SharedFormat.moment(date: endDate ?? startDate, time: endTime, tz: tz)
        }

        /// Ortszeit-Hinweis, wenn die Ereigniszone von der Reisezone abweicht («Ortszeit Miami»).
        func localTimeNote(tripZone: TimeZone) -> String? {
            guard let startTz, let tz = TimeZone(identifier: startTz), tz.identifier != tripZone.identifier else { return nil }
            let city = startTz.split(separator: "/").last.map {
                $0.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "Zurich", with: "Zürich")
            }
            return city.map { "Ortszeit \($0)" }
        }

        /// Ein Wert aus dem Kurzraster `summary` (Beschriftung ohne Beachtung der Gross-/Kleinschreibung).
        func fact(_ labels: String...) -> String? {
            for l in labels {
                if let kv = summary.first(where: { $0.label.caseInsensitiveCompare(l) == .orderedSame }), !kv.value.isEmpty {
                    return kv.value
                }
            }
            return nil
        }

        /// Kurze Streckenangabe `ZRH → BCN`, wenn aus dem Kurzraster ableitbar.
        var routeText: String? {
            if let from = fact("Von", "Abflug", "Start", "Abholung"), let to = fact("Nach", "Ankunft", "Ziel", "Rückgabe") {
                return "\(from) → \(to)"
            }
            return nil
        }
    }

    struct Trip: Codable, Equatable, Hashable, Identifiable {
        var id: Int
        var title: String
        var destination: String?
        var startDate: String?
        var endDate: String?
        var phase: String?          // upcoming | active | past (alt: current)
        var timezone: String?
        var coverUrl: String?
        var ledgerId: Int?
        var dayIndex: Int?
        var dayCount: Int?

        private enum CodingKeys: String, CodingKey {
            case id, title, destination, startDate, endDate, phase, timezone, coverUrl, ledgerId, dayIndex, dayCount
        }

        init(id: Int, title: String, destination: String? = nil, startDate: String? = nil, endDate: String? = nil,
             phase: String? = nil, timezone: String? = nil, coverUrl: String? = nil, ledgerId: Int? = nil,
             dayIndex: Int? = nil, dayCount: Int? = nil) {
            self.id = id; self.title = title; self.destination = destination; self.startDate = startDate
            self.endDate = endDate; self.phase = phase; self.timezone = timezone; self.coverUrl = coverUrl
            self.ledgerId = ledgerId; self.dayIndex = dayIndex; self.dayCount = dayCount
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard let id = c.tbInt(.id) else {
                throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: c.codingPath, debugDescription: "id"))
            }
            self.id = id
            title = c.tbString(.title) ?? "Reise"
            destination = c.tbString(.destination)
            startDate = c.tbString(.startDate); endDate = c.tbString(.endDate)
            phase = c.tbString(.phase).map { $0 == "current" ? "active" : $0 }
            timezone = c.tbString(.timezone); coverUrl = c.tbString(.coverUrl)
            ledgerId = c.tbInt(.ledgerId); dayIndex = c.tbInt(.dayIndex); dayCount = c.tbInt(.dayCount)
        }

        var zone: TimeZone { SharedFormat.timeZone(timezone) }

        /// Phase relativ zu `day` (`YYYY-MM-DD`): zwischengespeicherte Daten können Tage alt sein.
        func phase(on day: String) -> String {
            if let end = endDate, end < day { return "past" }
            if let start = startDate, start <= day { return "active" }
            return "upcoming"
        }

        /// Tag x von y am Tag `day`; `nil` ausserhalb der Reise.
        func dayProgress(on day: String) -> (index: Int, count: Int)? {
            guard let start = startDate, let end = endDate,
                  let total = SharedFormat.daysBetween(start, end).map({ $0 + 1 }),
                  let offset = SharedFormat.daysBetween(start, day), offset >= 0, offset < total else { return nil }
            return (offset + 1, total)
        }

        /// Ganze Tage bis zur Abreise (0 = heute); `nil` wenn bereits unterwegs oder unbekannt.
        func daysUntilStart(from day: String) -> Int? {
            guard let d = SharedFormat.daysBetween(day, startDate), d >= 0 else { return nil }
            return d
        }

        var range: String { SharedFormat.range(start: startDate, end: endDate) }
        var rangeStacked: String { SharedFormat.rangeStacked(start: startDate, end: endDate) }
    }

    struct Today: Codable, Equatable, Hashable {
        var date: String?
        var dayIndex: Int?
        var dayCount: Int?

        init(date: String? = nil, dayIndex: Int? = nil, dayCount: Int? = nil) {
            self.date = date; self.dayIndex = dayIndex; self.dayCount = dayCount
        }

        private enum CodingKeys: String, CodingKey { case date, dayIndex, dayCount }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            date = c.tbString(.date); dayIndex = c.tbInt(.dayIndex); dayCount = c.tbInt(.dayCount)
        }
    }

    struct Ledger: Codable, Equatable, Hashable {
        struct Balance: Codable, Equatable, Hashable, Identifiable {
            var id: Int
            var name: String
            var netMinor: Int
            var isMe: Bool

            private enum CodingKeys: String, CodingKey {
                case memberId, participantId, id, name, displayName, netMinor, balanceMinor, isMe, me
            }

            init(id: Int, name: String, netMinor: Int, isMe: Bool = false) {
                self.id = id; self.name = name; self.netMinor = netMinor; self.isMe = isMe
            }

            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                id = c.tbInt(.memberId) ?? c.tbInt(.participantId) ?? c.tbInt(.id) ?? 0
                name = c.tbString(.displayName) ?? c.tbString(.name) ?? "?"
                netMinor = c.tbInt(.netMinor) ?? c.tbInt(.balanceMinor) ?? 0
                isMe = c.tbBool(.isMe) ?? c.tbBool(.me) ?? false
            }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(id, forKey: .id); try c.encode(name, forKey: .name)
                try c.encode(netMinor, forKey: .netMinor); try c.encode(isMe, forKey: .isMe)
            }
        }

        var id: Int?
        var title: String?
        var currency: String
        var balanceMinor: Int
        var balances: [Balance]
        var myMemberId: Int?

        private enum CodingKeys: String, CodingKey {
            case id, title, currency, baseCurrency, balanceMinor, myNetMinor, netMinor, balances, members, myMemberId
        }

        init(id: Int? = nil, title: String? = nil, currency: String = "CHF", balanceMinor: Int,
             balances: [Balance] = [], myMemberId: Int? = nil) {
            self.id = id; self.title = title; self.currency = currency; self.balanceMinor = balanceMinor
            self.balances = balances; self.myMemberId = myMemberId
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = c.tbInt(.id); title = c.tbString(.title)
            currency = c.tbString(.currency) ?? c.tbString(.baseCurrency) ?? "CHF"
            myMemberId = c.tbInt(.myMemberId)
            var list: [Balance] = c.tbArray(.balances, of: Balance.self)
            if list.isEmpty { list = c.tbArray(.members, of: Balance.self) }
            balances = list
            if let own = c.tbInt(.balanceMinor) ?? c.tbInt(.myNetMinor) ?? c.tbInt(.netMinor) {
                balanceMinor = own
            } else if let me = myMemberId, let b = list.first(where: { $0.id == me }) {
                balanceMinor = b.netMinor
            } else if let me = list.first(where: \.isMe) {
                balanceMinor = me.netMinor
            } else {
                balanceMinor = 0
            }
            if let me = myMemberId {
                balances = list.map { var b = $0; b.isMe = b.isMe || b.id == me; return b }
            }
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encodeIfPresent(id, forKey: .id); try c.encodeIfPresent(title, forKey: .title)
            try c.encode(currency, forKey: .currency); try c.encode(balanceMinor, forKey: .balanceMinor)
            try c.encode(balances, forKey: .balances); try c.encodeIfPresent(myMemberId, forKey: .myMemberId)
        }
    }

    var generatedAt: String?
    var activeTrip: Trip?
    var nextTrip: Trip?
    var nextEvents: [Event]
    var today: Today?
    var ledger: Ledger?

    private enum CodingKeys: String, CodingKey { case generatedAt, activeTrip, nextTrip, nextEvents, today, ledger }

    init(generatedAt: String? = nil, activeTrip: Trip? = nil, nextTrip: Trip? = nil, nextEvents: [Event] = [],
         today: Today? = nil, ledger: Ledger? = nil) {
        self.generatedAt = generatedAt; self.activeTrip = activeTrip; self.nextTrip = nextTrip
        self.nextEvents = nextEvents; self.today = today; self.ledger = ledger
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = c.tbString(.generatedAt)
        activeTrip = c.tbValue(.activeTrip, as: Trip.self)
        nextTrip = c.tbValue(.nextTrip, as: Trip.self)
        nextEvents = c.tbArray(.nextEvents, of: Event.self)
        today = c.tbValue(.today, as: Today.self)
        ledger = c.tbValue(.ledger, as: Ledger.self)
    }

    /// Reise, die ein Widget standardmässig zeigt: aktive, sonst nächste.
    var defaultTrip: Trip? { activeTrip ?? nextTrip }

    static func decode(_ data: Data) -> SharedSummary? {
        try? JSONDecoder().decode(SharedSummary.self, from: data)
    }
}

// MARK: - Reisenliste und Reisedetail (HomeBuddy-API, unverändert)

/// `GET /v1/trips` → `{ trips: [...] }`
struct SharedTripList: Decodable {
    let trips: [SharedSummary.Trip]

    private enum CodingKeys: String, CodingKey { case trips }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        trips = c.tbArray(.trips, of: SharedSummary.Trip.self)
    }
}

/// `GET /v1/trips/:id` → `{ trip, travelers, events }`; daraus entsteht eine Zusammenfassung für eine gewählte Reise.
struct SharedTripDetail: Decodable {
    let trip: SharedSummary.Trip
    let events: [SharedSummary.Event]

    private enum CodingKeys: String, CodingKey { case trip, events }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let trip = c.tbValue(.trip, as: SharedSummary.Trip.self) else {
            throw DecodingError.keyNotFound(CodingKeys.trip, .init(codingPath: c.codingPath, debugDescription: "trip"))
        }
        self.trip = trip
        events = c.tbArray(.events, of: SharedSummary.Event.self)
    }

    /// Zusammenfassung wie `GET /v1/summary`, begrenzt auf diese Reise und auf zukünftige bzw. heutige Ereignisse.
    func summary(now: Date = Date(), keeping limit: Int = 40) -> SharedSummary {
        let zone = trip.zone
        let day = SharedFormat.isoDay(now, in: zone)
        let multiDay: Set<String> = ["Hotel", "Unterkunft", "Mietauto", "Visum"]
        var upcoming: [SharedSummary.Event] = []
        for original in events where original.startDate != nil && !original.isProposal {
            var e = original
            e.tripId = e.tripId ?? trip.id
            let start = e.startDate ?? day
            let end = e.endDate ?? start
            let isMulti = end > start && multiDay.contains(SharedTypeCatalog.info(for: e.type).id)
            guard isMulti else {
                if e.dayRole == nil { e.dayRole = "single" }
                if e.displayTime == nil { e.displayTime = e.startTime }
                if end >= day || start >= day { upcoming.append(e) }
                continue
            }
            let info = SharedTypeCatalog.info(for: e.type)
            if start >= day {
                var s = e; s.dayRole = "start"; s.displayTime = e.startTime; s.displayLabel = info.startLabel
                upcoming.append(s)
            }
            if start < day && day <= end && end > day {
                var m = e; m.dayRole = "middle"; m.displayTime = nil
                m.displayLabel = info.icon == "bed" ? "Aufenthalt" : "Unterwegs"
                upcoming.append(m)
            }
            if end >= day {
                var x = e; x.dayRole = "end"; x.displayTime = e.endTime; x.displayLabel = info.endLabel
                upcoming.append(x)
            }
        }
        upcoming.sort { a, b in
            let ka = (a.isMiddle ? day : (a.shownDate ?? ""), a.isMiddle ? "99:99" : (a.timeText ?? "00:00"))
            let kb = (b.isMiddle ? day : (b.shownDate ?? ""), b.isMiddle ? "99:99" : (b.timeText ?? "00:00"))
            return ka < kb
        }
        var t = trip
        t.phase = trip.phase(on: day)
        let progress = trip.dayProgress(on: day)
        t.dayIndex = progress?.index; t.dayCount = progress?.count
        return SharedSummary(
            generatedAt: ISO8601DateFormatter().string(from: now),
            activeTrip: t.phase == "active" ? t : nil,
            nextTrip: t.phase == "upcoming" ? t : nil,
            nextEvents: Array(upcoming.prefix(limit)),
            today: progress.map { .init(date: day, dayIndex: $0.index, dayCount: $0.count) },
            ledger: nil)
    }
}

// MARK: - Cache in der App-Group

/// Letzte `/v1/summary`-Antwort (`SharedConfig.Key.summaryJSON`). Die App darf ihn ebenfalls beschreiben (Text oder Data);
/// Widgets schreiben nach einem erfolgreichen Abruf.
enum SharedSummaryCache {
    struct Stored {
        let summary: SharedSummary
        let fetchedAt: Date?
    }

    static func load(key: String = SharedConfig.Key.summaryJSON, defaults: UserDefaults = SharedConfig.defaults) -> Stored? {
        let data: Data?
        if let d = defaults.data(forKey: key) { data = d }
        else if let s = defaults.string(forKey: key) { data = Data(s.utf8) }
        else { data = nil }
        guard let data, let summary = SharedSummary.decode(data) else { return nil }
        let fetched: Date? = {
            let suffix = key == SharedConfig.Key.summaryJSON ? SharedConfig.Key.summaryFetchedAt : key + ".fetchedAt"
            if let t = defaults.object(forKey: suffix) as? Double { return Date(timeIntervalSince1970: t) }
            if let d = defaults.object(forKey: suffix) as? Date { return d }
            if let s = defaults.string(forKey: suffix) { return ISO8601DateFormatter().date(from: s) }
            return summary.generatedAt.flatMap { ISO8601DateFormatter().date(from: $0) }
        }()
        return Stored(summary: summary, fetchedAt: fetched)
    }

    static func save(_ data: Data, key: String = SharedConfig.Key.summaryJSON, defaults: UserDefaults = SharedConfig.defaults,
                     now: Date = Date()) {
        guard SharedSummary.decode(data) != nil, let text = String(data: data, encoding: .utf8) else { return }
        defaults.set(text, forKey: key)
        let suffix = key == SharedConfig.Key.summaryJSON ? SharedConfig.Key.summaryFetchedAt : key + ".fetchedAt"
        defaults.set(now.timeIntervalSince1970, forKey: suffix)
    }
}
