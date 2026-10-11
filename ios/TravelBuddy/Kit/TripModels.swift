import Foundation

// Formen entsprechen `docs/CONTRACT.md` (Reisen, Ereignisse, Dokumente) und der HomeBuddy-API, die unverändert bleibt.
// Daten `YYYY-MM-DD`, Zeiten `HH:mm`, Zeitstempel UTC ISO 8601. Alle Decoder sind nachsichtig:
// ein fehlendes optionales Feld darf die Ansicht nie verhindern.

// MARK: - Reise

enum TripStatus: String, Codable, Sendable {
    case planned, active, done, cancelled

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TripStatus(rawValue: raw) ?? .planned
    }

    var title: String {
        switch self {
        case .planned: "Geplant"
        case .active: "Unterwegs"
        case .done: "Abgeschlossen"
        case .cancelled: "Abgesagt"
        }
    }
}

/// Phase einer Reise relativ zu «heute». Der Server liefert `upcoming|active|past`; ältere Stände `current`.
enum TripPhase: String, Codable, CaseIterable, Sendable {
    case active, upcoming, past

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "active", "current": self = .active
        case "past": self = .past
        default: self = .upcoming
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }

    var title: String {
        switch self {
        case .active: "Unterwegs"
        case .upcoming: "Demnächst"
        case .past: "Vergangen"
        }
    }

    /// Gleiche Regel wie der Server: vorbei, wenn das Ende vor heute liegt; aktiv ab Beginn.
    static func compute(startDate: String?, endDate: String?, today: String) -> TripPhase {
        if let end = endDate, end < today { return .past }
        if let start = startDate, start <= today { return .active }
        return .upcoming
    }
}

struct TripNextEvent: Codable, Equatable, Hashable, Sendable {
    let id: Int
    let type: String
    let title: String
    let startDate: String?
    let startTime: String?
}

/// Eintrag aus `GET /v1/trips`.
struct TripSummary: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var title: String
    var status: TripStatus = .planned
    var destination: String?
    var startDate: String?
    var endDate: String?
    var eventCount: Int = 0
    var travelerCount: Int = 0
    var ledgerId: Int?
    var nextEvent: TripNextEvent?
    var phase: TripPhase = .upcoming
    var coverUrl: String?
    var needsReviewCount: Int = 0
    var timezone: String?
    var homeCurrency: String?
}

extension TripSummary {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        status = (try? c.decodeIfPresent(TripStatus.self, forKey: .status)) ?? .planned
        destination = try c.decodeIfPresent(String.self, forKey: .destination)
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        eventCount = try c.decodeIfPresent(Int.self, forKey: .eventCount) ?? 0
        travelerCount = try c.decodeIfPresent(Int.self, forKey: .travelerCount) ?? 0
        ledgerId = try c.decodeIfPresent(Int.self, forKey: .ledgerId)
        nextEvent = try? c.decodeIfPresent(TripNextEvent.self, forKey: .nextEvent)
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl)
        needsReviewCount = try c.decodeIfPresent(Int.self, forKey: .needsReviewCount) ?? 0
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone)
        homeCurrency = try c.decodeIfPresent(String.self, forKey: .homeCurrency)
        let today = TBDate.isoString(from: Date())
        phase = (try? c.decodeIfPresent(TripPhase.self, forKey: .phase))
            ?? TripPhase.compute(startDate: startDate, endDate: endDate, today: today)
    }
}

struct TripListResponse: Decodable, Sendable {
    let trips: [TripSummary]
}

struct Trip: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var title: String
    var status: TripStatus = .planned
    var destination: String?
    var startDate: String?
    var endDate: String?
    var summary: String?
    var notes: String?
    var ledgerId: Int?
    var createdAt: String?
    var updatedAt: String?
    var coverUrl: String?
    var homeCurrency: String?
    /// Standardzone der Reise (IANA), z. B. `Europe/Zurich`.
    var timezone: String?
    var needsReviewCount: Int = 0
    var phase: TripPhase?
}

extension Trip {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        status = (try? c.decodeIfPresent(TripStatus.self, forKey: .status)) ?? .planned
        destination = try c.decodeIfPresent(String.self, forKey: .destination)
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        ledgerId = try c.decodeIfPresent(Int.self, forKey: .ledgerId)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl)
        homeCurrency = try c.decodeIfPresent(String.self, forKey: .homeCurrency)
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone)
        needsReviewCount = try c.decodeIfPresent(Int.self, forKey: .needsReviewCount) ?? 0
        phase = try? c.decodeIfPresent(TripPhase.self, forKey: .phase)
    }

    /// Zone der Reise; ohne Angabe die Zone des Geräts.
    var zone: TimeZone { TripClock.zone(timezone) ?? .current }
    var currency: String { (homeCurrency ?? "CHF").uppercased() }
}

/// Teilnehmer. Die ID ist dieselbe wie `Member.id` in der Reisekasse (Vertrag «Teilnehmer: eine Tabelle»).
struct Traveler: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var displayName: String
    var email: String?
    var userId: Int?
    /// `nil`, wenn der Gäste-Link widerrufen wurde (oder nicht mitgeliefert).
    var shareToken: String?
    var coupleId: Int?
    /// 0–7, stabile Farbe für Avatar und Diagramme.
    var colorIndex: Int?
}

extension Traveler {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        displayName = try c.decode(String.self, forKey: .displayName)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        userId = try c.decodeIfPresent(Int.self, forKey: .userId)
        shareToken = try c.decodeIfPresent(String.self, forKey: .shareToken)
        coupleId = try c.decodeIfPresent(Int.self, forKey: .coupleId)
        colorIndex = try c.decodeIfPresent(Int.self, forKey: .colorIndex)
    }

    var initials: String {
        let parts = displayName.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

struct TripComment: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var eventId: Int?
    var userId: Int?
    var author: String
    var body: String
    var createdAt: String
}

struct TripCommentResponse: Decodable, Sendable {
    let comment: TripComment
}

// MARK: - Ereignis

enum EventStatus: String, Codable, Sendable {
    case confirmed, proposed
    case needsReview = "needs_review"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = EventStatus(rawValue: raw) ?? .confirmed
    }

    var title: String {
        switch self {
        case .confirmed: "Bestätigt"
        case .proposed: "Vorschlag"
        case .needsReview: "Zu prüfen"
        }
    }
    var isProposal: Bool { self != .confirmed }
}

enum PaymentStatus: String, Codable, CaseIterable, Sendable {
    case open, paid, deposit, onsite

    var title: String {
        switch self {
        case .open: "Offen"
        case .paid: "Bezahlt"
        case .deposit: "Anzahlung"
        case .onsite: "Vor Ort"
        }
    }
}

/// Herkunft eines Feldwerts (`fieldsMeta`).
struct FieldMeta: Codable, Equatable, Hashable, Sendable {
    enum Source: String, Codable, Sendable { case manual, document, derived, geocoded, unknown }
    var source: Source
    var confidence: Double?
    var documentId: Int?
    var page: Int?
    var quote: String?
    var locked: Bool?

    init(source: Source, confidence: Double? = nil, documentId: Int? = nil, page: Int? = nil,
         quote: String? = nil, locked: Bool? = nil) {
        self.source = source; self.confidence = confidence; self.documentId = documentId
        self.page = page; self.quote = quote; self.locked = locked
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decodeIfPresent(String.self, forKey: .source) ?? "unknown"
        source = Source(rawValue: raw) ?? .unknown
        confidence = try? c.decodeIfPresent(Double.self, forKey: .confidence)
        documentId = try? c.decodeIfPresent(Int.self, forKey: .documentId)
        page = try? c.decodeIfPresent(Int.self, forKey: .page)
        quote = try? c.decodeIfPresent(String.self, forKey: .quote)
        locked = try? c.decodeIfPresent(Bool.self, forKey: .locked)
    }

    /// Aus einem Dokument erkannt (gefüllter Punkt) statt von Hand (Ring).
    var isFromDocument: Bool { source == .document || source == .derived || source == .geocoded }
}

/// Ort eines Ereignisses (abgeleitet, vom Server geliefert, nur lesend).
struct EventPlace: Codable, Equatable, Hashable, Sendable, Identifiable {
    var role: String
    var label: String?
    var address: String?
    var lat: Double?
    var lon: Double?

    var id: String { "\(role)|\(label ?? "")|\(address ?? "")" }
    var hasCoordinate: Bool { lat != nil && lon != nil }

    /// Beschriftung der Rolle: «Abholung», «Rückgabe», …
    var roleTitle: String {
        switch role {
        case "start": "Start"
        case "end": "Ziel"
        case "pickup": "Abholung"
        case "return": "Rückgabe"
        case "venue": "Ort"
        case "stop": "Station"
        default: role.capitalized
        }
    }

    /// Anzeigetext: Beschriftung, sonst Adresse.
    var title: String { (label?.isEmpty == false ? label : nil) ?? address ?? roleTitle }
}

struct TripEvent: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var tripId: Int = 0
    var type: String
    var title: String
    var startDate: String?
    var endDate: String?
    var startTime: String?
    var endTime: String?
    var startTz: String?
    var endTz: String?
    var location: String?
    var address: String?
    var provider: String?
    var bookingReference: String?
    var website: String?
    var phone: String?
    var lat: Double?
    var lon: Double?
    var notes: String?
    var details: [String: JSONValue] = [:]
    var sortKey: Int = 0
    var documentIds: [Int] = []
    var documents: [TBDocument] = []
    var comments: [TripComment] = []
    var imageUrl: String?
    /// Herkunft des Bildes: `generated`, `uploaded` oder `imported`.
    var imageSource: String?
    var mapUrl: String?
    var status: EventStatus = .confirmed
    var participantIds: [Int] = []
    var priceMinor: Int?
    var currency: String?
    var paymentStatus: PaymentStatus?
    var paidByParticipantId: Int?
    var cancelUntil: String?
    var expenseId: Int?
    var fieldsMeta: [String: FieldMeta] = [:]
    var sourceDocumentId: Int?
    var places: [EventPlace] = []
    /// Tagesrolle, Anzeigezeit und -beschriftung am betrachteten Tag (`/v1/today`, `/v1/trips/:id/day/:date`, Summary).
    var dayRole: DayRole?
    var displayTime: String?
    var displayLabel: String?
}

/// Rolle eines Ereignisses an einem Kalendertag: eintägig `single`; mehrtägig am ersten Tag `start`, am letzten `end`,
/// dazwischen `middle`.
enum DayRole: String, Codable, Sendable {
    case single, start, middle, end

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = DayRole(rawValue: raw) ?? .single
    }
}

extension TripEvent {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        tripId = try c.decodeIfPresent(Int.self, forKey: .tripId) ?? 0
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "Aufgabe"
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        startTime = try c.decodeIfPresent(String.self, forKey: .startTime)
        endTime = try c.decodeIfPresent(String.self, forKey: .endTime)
        startTz = try c.decodeIfPresent(String.self, forKey: .startTz)
        endTz = try c.decodeIfPresent(String.self, forKey: .endTz)
        location = try c.decodeIfPresent(String.self, forKey: .location)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        provider = try c.decodeIfPresent(String.self, forKey: .provider)
        bookingReference = try c.decodeIfPresent(String.self, forKey: .bookingReference)
        website = try c.decodeIfPresent(String.self, forKey: .website)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lon = try c.decodeIfPresent(Double.self, forKey: .lon)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        details = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .details)) ?? [:]
        sortKey = try c.decodeIfPresent(Int.self, forKey: .sortKey) ?? 0
        documentIds = (try? c.decodeIfPresent([Int].self, forKey: .documentIds)) ?? []
        documents = (try? c.decodeIfPresent([TBDocument].self, forKey: .documents)) ?? []
        comments = (try? c.decodeIfPresent([TripComment].self, forKey: .comments)) ?? []
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        imageSource = try c.decodeIfPresent(String.self, forKey: .imageSource)
        mapUrl = try c.decodeIfPresent(String.self, forKey: .mapUrl)
        status = (try? c.decodeIfPresent(EventStatus.self, forKey: .status)) ?? .confirmed
        participantIds = (try? c.decodeIfPresent([Int].self, forKey: .participantIds)) ?? []
        priceMinor = try c.decodeIfPresent(Int.self, forKey: .priceMinor)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        paymentStatus = (try? c.decodeIfPresent(PaymentStatus.self, forKey: .paymentStatus)) ?? nil
        paidByParticipantId = try c.decodeIfPresent(Int.self, forKey: .paidByParticipantId)
        cancelUntil = try c.decodeIfPresent(String.self, forKey: .cancelUntil)
        expenseId = try c.decodeIfPresent(Int.self, forKey: .expenseId)
        fieldsMeta = (try? c.decodeIfPresent([String: FieldMeta].self, forKey: .fieldsMeta)) ?? [:]
        sourceDocumentId = try c.decodeIfPresent(Int.self, forKey: .sourceDocumentId)
        places = (try? c.decodeIfPresent([EventPlace].self, forKey: .places)) ?? []
        dayRole = try? c.decodeIfPresent(DayRole.self, forKey: .dayRole)
        displayTime = try c.decodeIfPresent(String.self, forKey: .displayTime)
        displayLabel = try c.decodeIfPresent(String.self, forKey: .displayLabel)
    }

    // MARK: Abgeleitetes

    var hasCoordinate: Bool { lat != nil && lon != nil }

    /// Wert eines Typ-Feldes aus `details` als Text.
    func detail(_ key: String) -> String? {
        guard let v = details[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty else { return nil }
        return v
    }

    /// Orte für die Karte: `places` vom Server, sonst aus Ereignis und Typ-Feldern abgeleitet (ältere Stände, offline).
    /// Katalog Version 2 liefert je Ort ein Adressfeld (`pickupAddress`, `returnAddress`, …).
    var resolvedPlaces: [EventPlace] {
        if !places.isEmpty { return places }
        var out: [EventPlace] = []
        let pairs: [(String, String, String)] = [
            ("pickupPlace", "pickup", "pickupAddress"), ("returnPlace", "return", "returnAddress"),
            ("originPlace", "start", "originAddress"), ("destinationPlace", "end", "destinationAddress"),
            ("terminal", "venue", "terminalAddress"), ("venue", "venue", "venueAddress"),
        ]
        for (key, role, addressKey) in pairs {
            let label = detail(key), addr = detail(addressKey)
            if label == nil && addr == nil { continue }
            if out.contains(where: { $0.role == role && role == "venue" }) { continue }
            out.append(EventPlace(role: role, label: label, address: addr, lat: nil, lon: nil))
        }
        if out.isEmpty {
            if address != nil || location != nil || hasCoordinate {
                out.append(EventPlace(role: "venue", label: location, address: address, lat: lat, lon: lon))
            }
        } else if (hasCoordinate || address != nil), out[0].address == nil || !out[0].hasCoordinate {
            // Hauptort (Adresse/Koordinate des Ereignisses) dem ersten Ort zuordnen, wenn dort nichts steht.
            if out[0].address == nil { out[0].address = address }
            if !out[0].hasCoordinate { out[0].lat = lat; out[0].lon = lon }
        }
        return out
    }

    /// Wanduhr-Zonen: Beginn in `startTz`, Ende in `endTz`, sonst jeweils die Reisezone.
    func startZone(trip: TimeZone) -> TimeZone { TripClock.zone(startTz) ?? trip }
    func endZone(trip: TimeZone) -> TimeZone { TripClock.zone(endTz) ?? TripClock.zone(startTz) ?? trip }

    func startInstant(trip: TimeZone) -> Date? {
        TripClock.instant(date: startDate, time: startTime, zone: startZone(trip: trip))
    }

    func endInstant(trip: TimeZone) -> Date? {
        let date = endDate ?? startDate
        guard endTime != nil || endDate != nil else { return nil }
        return TripClock.instant(date: date, time: endTime, zone: endZone(trip: trip))
    }
}

// MARK: - Dokument

enum AnalysisStatus: String, Codable, Sendable {
    case pending, processing, done, failed, skipped

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AnalysisStatus(rawValue: raw) ?? .pending
    }

    var title: String {
        switch self {
        case .pending: "Wartet auf Auswertung"
        case .processing: "Wird ausgewertet …"
        case .done: "Ausgewertet"
        case .failed: "Auswertung fehlgeschlagen"
        case .skipped: "Nicht ausgewertet"
        }
    }

    var isFinished: Bool { self == .done || self == .failed || self == .skipped }
}

struct TBDocument: Codable, Equatable, Hashable, Sendable, Identifiable {
    let id: Int
    var title: String = ""
    var fileName: String = ""
    var contentType: String = "application/pdf"
    var sizeBytes: Int = 0
    var pages: Int?
    var sha256: String?
    var createdAt: String?
    var analysisStatus: AnalysisStatus = .pending
    var analysisError: String?
    var summary: String?
    var tripIds: [Int] = []
    var eventIds: [Int] = []
    var thumbnailUrl: String?
    var fileUrl: String?
}

extension TBDocument {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        fileName = try c.decodeIfPresent(String.self, forKey: .fileName) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? fileName
        contentType = try c.decodeIfPresent(String.self, forKey: .contentType) ?? "application/pdf"
        sizeBytes = try c.decodeIfPresent(Int.self, forKey: .sizeBytes) ?? 0
        pages = try c.decodeIfPresent(Int.self, forKey: .pages)
        sha256 = try c.decodeIfPresent(String.self, forKey: .sha256)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        analysisStatus = (try? c.decodeIfPresent(AnalysisStatus.self, forKey: .analysisStatus)) ?? .pending
        analysisError = try c.decodeIfPresent(String.self, forKey: .analysisError)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        tripIds = (try? c.decodeIfPresent([Int].self, forKey: .tripIds)) ?? []
        eventIds = (try? c.decodeIfPresent([Int].self, forKey: .eventIds)) ?? []
        thumbnailUrl = try c.decodeIfPresent(String.self, forKey: .thumbnailUrl)
        fileUrl = try c.decodeIfPresent(String.self, forKey: .fileUrl)
    }

    var isPDF: Bool { contentType.lowercased().contains("pdf") || fileName.lowercased().hasSuffix(".pdf") }
    var isImage: Bool { contentType.lowercased().hasPrefix("image/") }
    var displayTitle: String { title.isEmpty ? (fileName.isEmpty ? "Dokument" : fileName) : title }
    var sizeText: String { ByteCountFormatter.string(fromByteCount: Int64(sizeBytes), countStyle: .file) }
}

struct DocumentResponse: Decodable, Sendable {
    let document: TBDocument
}

/// `GET /v1/inbox`: alles, was Aufmerksamkeit braucht.
struct InboxResponse: Codable, Equatable, Sendable {
    struct ReviewItem: Codable, Equatable, Sendable, Identifiable {
        let tripId: Int
        let tripTitle: String
        let event: TripEvent
        var id: Int { event.id }
    }
    var documents: [TBDocument] = []
    var review: [ReviewItem] = []

    init(documents: [TBDocument] = [], review: [ReviewItem] = []) {
        self.documents = documents
        self.review = review
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        documents = (try? c.decodeIfPresent([TBDocument].self, forKey: .documents)) ?? []
        review = (try? c.decodeIfPresent([ReviewItem].self, forKey: .review)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case documents, review }
}

// MARK: - Antworten

/// `GET /v1/trips/:id` und alle schreibenden Aufrufe, die die Reise zurückgeben.
struct TripDetail: Codable, Equatable, Sendable {
    var trip: Trip
    var travelers: [Traveler]
    var events: [TripEvent]
    /// Nur bei `POST …/events`: ID des neu angelegten Ereignisses.
    var createdEventId: Int?

    private enum CodingKeys: String, CodingKey { case trip, travelers, events, eventId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        trip = try c.decode(Trip.self, forKey: .trip)
        travelers = (try? c.decodeIfPresent([Traveler].self, forKey: .travelers)) ?? []
        events = (try? c.decodeIfPresent([TripEvent].self, forKey: .events)) ?? []
        createdEventId = try c.decodeIfPresent(Int.self, forKey: .eventId)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(trip, forKey: .trip)
        try c.encode(travelers, forKey: .travelers)
        try c.encode(events, forKey: .events)
        try c.encodeIfPresent(createdEventId, forKey: .eventId)
    }

    init(trip: Trip, travelers: [Traveler], events: [TripEvent], createdEventId: Int? = nil) {
        self.trip = trip; self.travelers = travelers; self.events = events; self.createdEventId = createdEventId
    }

    func event(id: Int) -> TripEvent? { events.first { $0.id == id } }
}

struct TripLedgerResponse: Decodable, Sendable {
    let ledgerId: Int
}

/// Eintrag aus `GET /v1/users/directory`.
struct DirectoryUser: Decodable, Equatable, Sendable, Identifiable, Hashable {
    let id: Int
    let displayName: String
}

struct UserDirectoryResponse: Decodable, Sendable {
    let users: [DirectoryUser]
}

// MARK: - Anfragen

struct TravelerInput: Encodable, Equatable, Sendable {
    var displayName: String
    var email: String?
    var userId: Int?
}

struct CreateTripRequest: Encodable, Equatable, Sendable {
    var title: String
    var destination: String?
    var startDate: String?
    var endDate: String?
    var summary: String?
    var homeCurrency: String?
    var timezone: String?
    var travelers: [TravelerInput]
}

/// Teiländerung der Reise (PATCH): Leere Felder werden ausdrücklich als `null` gesendet.
struct UpdateTripRequest: Encodable, Equatable, Sendable {
    var title: String
    var destination: String?
    var startDate: String?
    var endDate: String?
    var summary: String?
    var notes: String?
    var status: TripStatus
    var homeCurrency: String?
    var timezone: String?

    private enum CodingKeys: String, CodingKey {
        case title, destination, startDate, endDate, summary, notes, status, homeCurrency, timezone
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encodeOrNull(destination, forKey: .destination)
        try c.encodeOrNull(startDate, forKey: .startDate)
        try c.encodeOrNull(endDate, forKey: .endDate)
        try c.encodeOrNull(summary, forKey: .summary)
        try c.encodeOrNull(notes, forKey: .notes)
        try c.encode(status.rawValue, forKey: .status)
        try c.encodeIfPresent(homeCurrency, forKey: .homeCurrency)
        try c.encodeIfPresent(timezone, forKey: .timezone)
    }
}

/// Ereignis anlegen (POST) oder ändern (PATCH). Ein Feld, das fehlt, bleibt unberührt; `null` löscht.
/// Der Server sperrt jedes per PATCH gesetzte Feld (`fieldsMeta.locked`), darum sendet die App bei Änderungen
/// nur, was sich wirklich geändert hat (siehe `EventFormModel.makePatch`).
struct EventBody: Encodable, Equatable, Sendable {
    var fields: [String: JSONValue]

    init(_ fields: [String: JSONValue] = [:]) { self.fields = fields }

    func encode(to encoder: Encoder) throws {
        try fields.encode(to: encoder)
    }

    var isEmpty: Bool { fields.isEmpty }
}

struct TripCommentBody: Encodable, Equatable, Sendable {
    var body: String
}

struct AttachDocumentBody: Encodable, Equatable, Sendable {
    var documentId: Int
}

struct MergeBody: Encodable, Equatable, Sendable {
    var intoEventId: Int
}

struct TripLedgerRequest: Encodable, Equatable, Sendable {
    var baseCurrency: String?
}

struct EmptyBody: Encodable, Sendable {}

extension KeyedEncodingContainer {
    mutating func encodeOrNull<T: Encodable>(_ value: T?, forKey key: Key) throws {
        if let value { try encode(value, forKey: key) } else { try encodeNil(forKey: key) }
    }
}

// MARK: - Zeitleiste

/// Ein Tag des Plans. `dayKey == nil`: Ereignisse ohne Datum (stehen am Ende).
struct TripDayGroup: Equatable, Sendable, Identifiable {
    let dayKey: String?
    let events: [TripEvent]
    /// 1-basierter Reisetag (1 = Starttag der Reise), falls Reisebeginn und Datum bekannt.
    let dayNumber: Int?

    var id: String { dayKey ?? "undated" }
}

enum TripTimeline {
    /// Nach Starttag gruppiert, Tage aufsteigend, «Ohne Datum» zuletzt; im Tag nach Uhrzeit in der
    /// jeweiligen Zone (Zeitpunkt), dann Uhrzeit ohne Zone, dann `sortKey`, dann `id`.
    static func groups(events: [TripEvent], tripStart: String? = nil, tripZone: TimeZone = .current) -> [TripDayGroup] {
        let sorted = sort(events, tripZone: tripZone)
        var order: [String?] = []
        var buckets: [String?: [TripEvent]] = [:]
        for e in sorted {
            let key = e.startDate
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(e)
        }
        return order.map { key in
            let number = key.flatMap { k in tripStart.flatMap { TBDate.days(from: $0, to: k) } }.map { $0 + 1 }
            return TripDayGroup(dayKey: key, events: buckets[key] ?? [], dayNumber: number.flatMap { $0 >= 1 ? $0 : nil })
        }
    }

    static func sort(_ events: [TripEvent], tripZone: TimeZone) -> [TripEvent] {
        events.sorted { a, b in
            let da = a.startDate ?? "9999-12-31", db = b.startDate ?? "9999-12-31"
            if da != db { return da < db }
            // Gleicher Kalendertag: Wanduhr vergleichen (beide gleiche Zone) oder Zeitpunkt.
            let ia = a.startInstant(trip: tripZone), ib = b.startInstant(trip: tripZone)
            if a.startTime != nil, b.startTime != nil, let ia, let ib, ia != ib { return ia < ib }
            if (a.startTime == nil) != (b.startTime == nil) { return a.startTime != nil }
            if a.sortKey != b.sortKey { return a.sortKey < b.sortKey }
            return a.id < b.id
        }
    }
}

// MARK: - Reisenliste

struct TripPhaseGroup: Equatable, Sendable, Identifiable {
    let phase: TripPhase
    let trips: [TripSummary]
    var id: TripPhase { phase }
}

enum TripListLogic {
    /// Gruppiert nach Phase in der Reihenfolge Unterwegs, Demnächst, Vergangen. Innerhalb der Phase:
    /// Unterwegs/Demnächst nach Start aufsteigend, Vergangen nach Start absteigend (jüngste zuerst).
    static func groups(_ trips: [TripSummary], query: String = "") -> [TripPhaseGroup] {
        let q = normalize(query)
        let filtered = q.isEmpty ? trips : trips.filter { t in
            [t.title, t.destination ?? "", t.nextEvent?.title ?? ""].contains { normalize($0).contains(q) }
        }
        return TripPhase.allCases.compactMap { phase in
            let items = filtered.filter { $0.phase == phase }.sorted { a, b in
                let da = a.startDate ?? "9999-12-31", db = b.startDate ?? "9999-12-31"
                if da != db { return phase == .past ? da > db : da < db }
                return a.id < b.id
            }
            return items.isEmpty ? nil : TripPhaseGroup(phase: phase, trips: items)
        }
    }

    static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "de_CH"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Die Reise für «Heute» und «Kasse»: aktive Reise, sonst keine.
    static func activeTrip(_ trips: [TripSummary]) -> TripSummary? {
        trips.filter { $0.phase == .active }.sorted { ($0.startDate ?? "") > ($1.startDate ?? "") }.first
    }

    /// Die Reise für «Kasse»: aktive, sonst nächste anstehende, sonst jüngste vergangene.
    static func currentTrip(_ trips: [TripSummary]) -> TripSummary? {
        if let a = activeTrip(trips) { return a }
        let upcoming = trips.filter { $0.phase == .upcoming }.sorted { ($0.startDate ?? "9999") < ($1.startDate ?? "9999") }
        if let u = upcoming.first { return u }
        return trips.filter { $0.phase == .past }.sorted { ($0.startDate ?? "") > ($1.startDate ?? "") }.first
    }
}

// MARK: - Gäste-Link

enum TripShareLink {
    /// `<Server-Adresse>/t/<shareToken>` (wie `tripShareUrl` im Web-Client).
    static func url(base: URL, token: String) -> URL? {
        var origin = base.absoluteString
        while origin.hasSuffix("/") { origin.removeLast() }
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        guard let encoded = token.addingPercentEncoding(withAllowedCharacters: allowed), !encoded.isEmpty else { return nil }
        return URL(string: "\(origin)/t/\(encoded)")
    }
}
