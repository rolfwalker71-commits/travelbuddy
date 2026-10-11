import Foundation
import PDFKit
import UIKit

/// Beispieldaten und ein Server im Speicher: für Vorschauen, Tests und Bildschirmfotos ohne echten Server.
/// Enthält ausschliesslich erfundene Daten.
final class DemoAPI: TravelAPI, @unchecked Sendable {
    let baseURL = URL(string: "http://localhost:7780")!
    private let lock = NSLock()
    private var trips: [Int: TripDetail]
    private var nextEventID = 500
    private var nextCommentID = 900
    private var documents: [Int: TBDocument]
    private var expenses: [Expense]
    private var settlements: [Settlement]
    private var nextExpenseID = 70
    private var prefs: NotificationPrefs = .allOn
    private let now: Date
    private let catalogData: Data
    /// Simuliert fehlende Verbindung (Tests des Offline-Verhaltens).
    var failing: APIError?

    static let user = User(id: 1, username: "rolf", displayName: "Rolf", email: nil, isAdmin: true)
    static let activeTripID = 1

    init(now: Date = Date(), catalogData: Data? = nil) {
        self.now = now
        self.catalogData = catalogData ?? Data()
        let f = DemoFixtures(now: now)
        trips = Dictionary(uniqueKeysWithValues: f.details.map { ($0.trip.id, $0) })
        documents = Dictionary(uniqueKeysWithValues: f.documents.map { ($0.id, $0) })
        expenses = f.expenses
        settlements = f.settlements
    }

    private func check() throws { if let failing { throw failing } }
    private func with<T>(_ body: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try body() }

    // MARK: Anmeldung, Version
    func me() async throws -> User { try check(); return Self.user }
    func logout() async throws {}
    func version() async throws -> ServerVersion {
        try check()
        return ServerVersion(name: "TravelBuddy", version: "0.1.0", build: "demo", builtAt: nil, api: 1)
    }

    // MARK: Katalog
    func eventTypesData() async throws -> Data {
        try check()
        if catalogData.isEmpty { throw APIError.notAvailable("Der Ereigniskatalog") }
        return catalogData
    }
    func airports(query: String) async throws -> [Airport] {
        try check()
        let all = [
            Airport(iata: "ZRH", name: "Flughafen Zürich", city: "Zürich", country: "CH", lat: 47.4647, lon: 8.5492, tz: "Europe/Zurich"),
            Airport(iata: "BCN", name: "Josep Tarradellas Barcelona-El Prat", city: "Barcelona", country: "ES", lat: 41.2974, lon: 2.0833, tz: "Europe/Madrid"),
            Airport(iata: "MIA", name: "Miami International", city: "Miami", country: "US", lat: 25.7959, lon: -80.2870, tz: "America/New_York"),
            Airport(iata: "LIS", name: "Humberto Delgado", city: "Lissabon", country: "PT", lat: 38.7742, lon: -9.1342, tz: "Europe/Lisbon"),
            Airport(iata: "MAD", name: "Adolfo Suárez Madrid-Barajas", city: "Madrid", country: "ES", lat: 40.4983, lon: -3.5676, tz: "Europe/Madrid"),
        ]
        let q = query.lowercased()
        return all.filter { $0.iata.lowercased().hasPrefix(q) || ($0.city ?? "").lowercased().contains(q) || $0.name.lowercased().contains(q) }
    }
    func timezone(lat: Double, lon: Double) async throws -> String {
        try check()
        return lon < -30 ? "America/New_York" : "Europe/Zurich"
    }

    // MARK: Reisen
    func trips() async throws -> [TripSummary] {
        try check()
        return with {
            trips.values.map { d in
                let phase = TripPhase.compute(startDate: d.trip.startDate, endDate: d.trip.endDate, today: TBDate.isoDay(of: now, in: d.trip.zone))
                let next = d.events.filter { ($0.startDate ?? "") >= (d.trip.startDate ?? "") }.first
                return TripSummary(
                    id: d.trip.id, title: d.trip.title, status: d.trip.status, destination: d.trip.destination,
                    startDate: d.trip.startDate, endDate: d.trip.endDate, eventCount: d.events.count,
                    travelerCount: d.travelers.count, ledgerId: d.trip.ledgerId,
                    nextEvent: next.map { TripNextEvent(id: $0.id, type: $0.type, title: $0.title, startDate: $0.startDate, startTime: $0.startTime) },
                    phase: phase, coverUrl: nil,
                    needsReviewCount: d.events.filter { $0.status.isProposal }.count,
                    timezone: d.trip.timezone, homeCurrency: d.trip.homeCurrency)
            }.sorted { ($0.startDate ?? "") < ($1.startDate ?? "") }
        }
    }
    func trip(id: Int) async throws -> TripDetail {
        try check()
        guard let d = with({ trips[id] }) else { throw APIError.server(status: 404, code: "not_found", message: "Reise nicht gefunden.") }
        return d
    }
    func createTrip(_ body: CreateTripRequest) async throws -> TripDetail {
        try check()
        return with {
            let id = (trips.keys.max() ?? 0) + 1
            let trip = Trip(id: id, title: body.title, destination: body.destination, startDate: body.startDate,
                            endDate: body.endDate, summary: body.summary, ledgerId: nil, homeCurrency: body.homeCurrency ?? "CHF",
                            timezone: body.timezone ?? "Europe/Zurich")
            let d = TripDetail(trip: trip, travelers: [Traveler(id: 1, displayName: "Rolf", userId: 1, colorIndex: 0)], events: [])
            trips[id] = d
            return d
        }
    }
    func updateTrip(id: Int, _ body: UpdateTripRequest) async throws -> TripDetail {
        try check()
        return try with {
            guard var d = trips[id] else { throw APIError.server(status: 404, code: "not_found", message: "Reise nicht gefunden.") }
            d.trip.title = body.title; d.trip.destination = body.destination; d.trip.startDate = body.startDate
            d.trip.endDate = body.endDate; d.trip.summary = body.summary; d.trip.notes = body.notes; d.trip.status = body.status
            if let t = body.timezone { d.trip.timezone = t }
            trips[id] = d
            return d
        }
    }
    func deleteTrip(id: Int) async throws { try check(); with { trips[id] = nil } }
    func addTraveler(tripID: Int, _ input: TravelerInput) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { d in
            let id = (d.travelers.map(\.id).max() ?? 0) + 1
            d.travelers.append(Traveler(id: id, displayName: input.displayName, email: input.email, userId: input.userId,
                                        shareToken: "demo-\(id)", colorIndex: id % 8))
        }
    }
    func removeTraveler(tripID: Int, travelerID: Int) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { $0.travelers.removeAll { $0.id == travelerID } }
    }
    func rotateTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail { try await trip(id: tripID) }
    func revokeTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail { try await trip(id: tripID) }
    func userDirectory() async throws -> [DirectoryUser] {
        try check()
        return [DirectoryUser(id: 2, displayName: "Eliane"), DirectoryUser(id: 3, displayName: "Harald")]
    }
    func tripICS(tripID: Int) async throws -> (data: Data, filename: String) {
        try check()
        let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TravelBuddy//Demo//DE\r\nEND:VCALENDAR\r\n"
        return (Data(ics.utf8), "reise-\(tripID).ics")
    }

    private func mutate(_ tripID: Int, _ change: (inout TripDetail) -> Void) throws -> TripDetail {
        try with {
            guard var d = trips[tripID] else { throw APIError.server(status: 404, code: "not_found", message: "Reise nicht gefunden.") }
            change(&d)
            trips[tripID] = d
            return d
        }
    }

    // MARK: Ereignisse
    func createEvent(tripID: Int, _ body: EventBody) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { d in
            nextEventID += 1
            var e = TripEvent(id: nextEventID, tripId: tripID, type: "Aufgabe", title: "")
            e = e.applying(body)
            e.fieldsMeta = [:]
            e = TripEvent(id: nextEventID, tripId: tripID, type: e.type, title: e.title, startDate: e.startDate, endDate: e.endDate,
                          startTime: e.startTime, endTime: e.endTime, startTz: e.startTz, endTz: e.endTz, location: e.location,
                          address: e.address, provider: e.provider, bookingReference: e.bookingReference, website: e.website,
                          phone: e.phone, lat: e.lat, lon: e.lon, notes: e.notes, details: e.details,
                          participantIds: e.participantIds, priceMinor: e.priceMinor, currency: e.currency,
                          paymentStatus: e.paymentStatus)
            d.events.append(e)
            d.createdEventId = e.id
        }
    }
    func updateEvent(tripID: Int, eventID: Int, _ body: EventBody) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { d in
            if let i = d.events.firstIndex(where: { $0.id == eventID }) { d.events[i] = d.events[i].applying(body) }
        }
    }
    func deleteEvent(tripID: Int, eventID: Int) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { $0.events.removeAll { $0.id == eventID } }
    }
    func confirmEvent(tripID: Int, eventID: Int) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { d in
            if let i = d.events.firstIndex(where: { $0.id == eventID }) { d.events[i].status = .confirmed }
        }
    }
    func mergeEvent(tripID: Int, eventID: Int, into targetID: Int) async throws -> TripDetail {
        try check()
        return try mutate(tripID) { $0.events.removeAll { $0.id == eventID } }
    }
    func attachDocument(tripID: Int, eventID: Int, documentID: Int) async throws {
        try check()
        _ = try mutate(tripID) { d in
            if let i = d.events.firstIndex(where: { $0.id == eventID }), !d.events[i].documentIds.contains(documentID) {
                d.events[i].documentIds.append(documentID)
            }
        }
    }

    func detachDocument(tripID: Int, eventID: Int, documentID: Int) async throws {
        try check()
        _ = try mutate(tripID) { d in
            if let i = d.events.firstIndex(where: { $0.id == eventID }) {
                d.events[i].documentIds.removeAll { $0 == documentID }
                d.events[i].documents.removeAll { $0.id == documentID }
            }
        }
    }

    func addComment(tripID: Int, eventID: Int, body: String) async throws -> TripComment {
        try check()
        return with {
            nextCommentID += 1
            let c = TripComment(id: nextCommentID, eventId: eventID, userId: 1, author: "Rolf", body: body,
                                createdAt: ISO8601DateFormatter().string(from: now))
            if var d = trips[tripID], let i = d.events.firstIndex(where: { $0.id == eventID }) {
                d.events[i].comments.append(c)
                trips[tripID] = d
            }
            return c
        }
    }
    func deleteComment(tripID: Int, eventID: Int, commentID: Int) async throws {
        try check()
        with {
            if var d = trips[tripID], let i = d.events.firstIndex(where: { $0.id == eventID }) {
                d.events[i].comments.removeAll { $0.id == commentID }
                trips[tripID] = d
            }
        }
    }

    // MARK: Heute
    func today(date: String?, tz: String?) async throws -> TodayResponse {
        try check()
        guard let d = with({ trips.values.first { TripPhase.compute(startDate: $0.trip.startDate, endDate: $0.trip.endDate, today: TBDate.isoDay(of: now, in: $0.trip.zone)) == .active } }) else {
            return TodayResponse(generatedAt: ISO8601DateFormatter().string(from: now), date: date)
        }
        let me = d.travelers.first { $0.userId == Self.user.id }?.id
        let ledger = TodayLedger(id: d.trip.ledgerId ?? 0, balanceMinor: 21_500, currency: "CHF")
        return TodayPlanner.response(from: d, now: now, myParticipantId: me, ledger: ledger)
    }
    func day(tripID: Int, date: String) async throws -> TodayResponse {
        try check()
        guard let d = with({ trips[tripID] }) else { throw APIError.server(status: 404, code: "not_found", message: "Reise nicht gefunden.") }
        let at = TripClock.instant(date: date, time: "12:00", zone: d.trip.zone) ?? now
        return TodayPlanner.response(from: d, now: at, myParticipantId: d.travelers.first { $0.userId == Self.user.id }?.id)
    }

    func summaryData() async throws -> Data {
        try check()
        return Data("{\"generatedAt\":\"\(ISO8601DateFormatter().string(from: now))\",\"nextEvents\":[]}".utf8)
    }

    // MARK: Dokumente
    func inbox() async throws -> InboxResponse {
        try check()
        return with {
            var review: [InboxResponse.ReviewItem] = []
            for d in trips.values {
                for e in d.events where e.status.isProposal {
                    review.append(.init(tripId: d.trip.id, tripTitle: d.trip.title, event: e))
                }
            }
            return InboxResponse(documents: documents.values.filter { !$0.analysisStatus.isFinished || $0.analysisStatus == .failed }
                .sorted { $0.id < $1.id }, review: review)
        }
    }
    func document(id: Int) async throws -> TBDocument {
        try check()
        guard let d = with({ documents[id] }) else { throw APIError.server(status: 404, code: "not_found", message: "Dokument nicht gefunden.") }
        return d
    }
    func documentFile(id: Int) async throws -> (data: Data, contentType: String?, filename: String?) {
        try check()
        return (Self.samplePDF(title: documents[id]?.title ?? "Dokument"), "application/pdf", "\(id).pdf")
    }
    func documentThumbnail(id: Int) async throws -> Data { throw APIError.server(status: 404, code: "not_found", message: "Kein Bild.") }
    func analyzeDocument(id: Int) async throws -> TBDocument { try await document(id: id) }
    func deleteDocument(id: Int) async throws { try check(); with { documents[id] = nil } }
    func uploadDocument(tripID: Int, eventID: Int?, fileURL: URL, fileName: String, contentType: String,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> TBDocument {
        try check()
        for step in 1...4 { progress(Double(step) / 4); try await Task.sleep(nanoseconds: 60_000_000) }
        return with {
            let id = (documents.keys.max() ?? 0) + 1
            let doc = TBDocument(id: id, title: fileName, fileName: fileName, contentType: contentType, sizeBytes: 12_000,
                                 pages: 1, analysisStatus: .done, tripIds: [tripID], eventIds: eventID.map { [$0] } ?? [])
            documents[id] = doc
            return doc
        }
    }
    func mediaImage(path: String) async throws -> Data { throw APIError.server(status: 404, code: "not_found", message: "Kein Bild.") }

    static func samplePDF(title: String) -> Data {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 595, height: 842))
        return renderer.pdfData { ctx in
            ctx.beginPage()
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 28)]
            (title as NSString).draw(at: CGPoint(x: 48, y: 64), withAttributes: attrs)
            ("Beispieldokument (Demo)" as NSString).draw(at: CGPoint(x: 48, y: 110), withAttributes: [.font: UIFont.systemFont(ofSize: 16)])
        }
    }

    // MARK: Reisekasse
    func ledger(id: Int) async throws -> LedgerOverview {
        try check()
        let trip = with { trips.values.first { $0.trip.ledgerId == id } }
        let members = (trip?.travelers ?? []).map {
            Member(id: $0.id, displayName: $0.displayName, email: nil, userId: $0.userId, coupleId: $0.coupleId, hidden: false)
        }
        return with { DemoFixtures.overview(ledgerID: id, members: members, expenses: expenses, settlements: settlements) }
    }
    func expenses(ledgerID: Int) async throws -> [Expense] {
        try check()
        return with { expenses.filter { $0.ledgerId == ledgerID }.sorted { ($0.expenseDate ?? "") > ($1.expenseDate ?? "") } }
    }
    func settlements(ledgerID: Int) async throws -> [Settlement] {
        try check()
        return with { settlements.filter { $0.ledgerId == ledgerID } }
    }
    func createExpense(ledgerID: Int, _ body: ExpenseBody) async throws -> Expense {
        try check()
        return with {
            nextExpenseID += 1
            let members = (trips.values.first { $0.trip.ledgerId == ledgerID }?.travelers ?? []).map(\.id)
            var ids = members
            if case .equal(let m)? = body.split { ids = m }
            let shares = SplitCalculator.equal(total: body.amountMinor, memberIDs: ids)
            let e = Expense(
                id: nextExpenseID, ledgerId: ledgerID, paidByMemberId: body.paidByMemberId ?? 1, createdByMemberId: 1,
                direction: .expense, amountMinor: body.amountMinor, currency: body.currency,
                exchangeRate: body.exchangeRate ?? 1, amountBaseMinor: body.amountMinor, description: body.description,
                expenseDate: body.expenseDate, category: body.category, note: nil, splitMode: .equal, settledStatus: 0,
                documentId: nil, tripEventId: body.tripEventId, place: nil,
                splits: shares.map { ExpenseSplit(memberId: $0.key, shareBaseMinor: $0.value, shareUnits: nil) },
                createdAt: ISO8601DateFormatter().string(from: now), updatedAt: ISO8601DateFormatter().string(from: now))
            expenses.append(e)
            return e
        }
    }
    func updateExpense(ledgerID: Int, expenseID: Int, _ body: ExpenseBody) async throws -> Expense {
        try check()
        return try with {
            guard let e = expenses.first(where: { $0.id == expenseID }) else { throw APIError.server(status: 404, code: "not_found", message: "Ausgabe nicht gefunden.") }
            return e
        }
    }
    func deleteExpense(ledgerID: Int, expenseID: Int) async throws {
        try check()
        with { expenses.removeAll { $0.id == expenseID } }
    }
    func createSettlement(ledgerID: Int, _ body: SettlementBody) async throws -> Settlement {
        try check()
        return with {
            let s = Settlement(id: (settlements.map(\.id).max() ?? 0) + 1, ledgerId: ledgerID, fromMemberId: body.fromMemberId,
                               toMemberId: body.toMemberId, amountMinor: body.amountMinor, currency: body.currency ?? "CHF",
                               exchangeRate: 1, amountBaseMinor: body.amountMinor, note: body.note,
                               settledAt: body.settledAt ?? TBDate.isoString(from: now), relatedExpenseId: nil, auto: false,
                               createdAt: ISO8601DateFormatter().string(from: now))
            settlements.append(s)
            return s
        }
    }
    func deleteSettlement(ledgerID: Int, settlementID: Int) async throws {
        try check()
        with { settlements.removeAll { $0.id == settlementID } }
    }
    func addMember(ledgerID: Int, displayName: String) async throws -> Member {
        try check()
        return Member(id: 99, displayName: displayName, email: nil, userId: nil, coupleId: nil, hidden: false)
    }
    func removeMember(ledgerID: Int, memberID: Int) async throws { try check() }
    func fxRate(from: String, to: String, date: String?) async throws -> FxRate {
        try check()
        return FxRate(from: from, to: to, rate: from == "USD" ? 0.88 : 1, date: date ?? TBDate.isoString(from: now), source: "demo")
    }

    // MARK: Konto
    func registerDevice(_ registration: DeviceRegistration) async throws { try check() }
    func notificationPrefs() async throws -> NotificationPrefs { try check(); return prefs }
    func updateNotificationPrefs(_ patch: NotificationPrefsPatch) async throws -> NotificationPrefs {
        try check()
        return with { for (k, v) in patch.fields { prefs.raw[k] = v }; return prefs }
    }
    func devices() async throws -> [UserDevice] {
        try check()
        return [UserDevice(id: 1, name: "iPhone von Rolf", platform: "ios", createdAt: "2026-10-01T08:00:00.000Z",
                           lastUsedAt: "2026-10-11T08:00:00.000Z", push: true, current: true)]
    }
    func revokeDevice(id: Int) async throws { try check() }
    func changePassword(current: String, new: String) async throws { try check() }
    func registerLiveActivity(id: String, _ registration: LiveActivityRegistration) async throws { try check() }
    func unregisterLiveActivity(id: String) async throws { try check() }
}

// MARK: - Beispieldaten

struct DemoFixtures {
    let details: [TripDetail]
    let documents: [TBDocument]
    let expenses: [Expense]
    let settlements: [Settlement]

    init(now: Date) {
        let zone = TripClock.zone("Europe/Madrid")!
        let today = TBDate.isoDay(of: now, in: zone)
        func day(_ offset: Int) -> String { TBDate.addDays(offset, to: today) ?? today }
        let people = [
            Traveler(id: 1, displayName: "Rolf", userId: 1, shareToken: "g1", coupleId: 1, colorIndex: 0),
            Traveler(id: 2, displayName: "Eliane", shareToken: "g2", coupleId: 1, colorIndex: 1),
            Traveler(id: 3, displayName: "Harald", shareToken: "g3", coupleId: 2, colorIndex: 2),
            Traveler(id: 4, displayName: "Valentyna", shareToken: "g4", coupleId: 2, colorIndex: 3),
        ]
        let trip = Trip(id: 1, title: "Ferien 2026", status: .active, destination: "Barcelona → Florida",
                        startDate: day(-2), endDate: day(26), summary: "Kreuzfahrt und Florida", ledgerId: 11,
                        homeCurrency: "CHF", timezone: "Europe/Madrid", needsReviewCount: 1, phase: .active)
        var events: [TripEvent] = []
        events.append(TripEvent(
            id: 101, tripId: 1, type: "Flug", title: "Flug von Zürich nach Barcelona", startDate: day(-2), endDate: day(-2),
            startTime: "08:05", endTime: "09:55", startTz: "Europe/Zurich", endTz: "Europe/Madrid", provider: "SWISS",
            bookingReference: "K7QM2D", lat: 47.4647, lon: 8.5492,
            details: ["airline": "SWISS", "flightNumber": "LX 2084", "departureAirport": "ZRH", "arrivalAirport": "BCN",
                      "departureTerminal": "2", "departureGate": "E24", "cabinClass": "Economy",
                      "passengers": .array([.object(["participantId": 1, "seat": "12C"]), .object(["participantId": 2, "seat": "12D"])])],
            participantIds: [1, 2], priceMinor: 41_200, currency: "CHF", paymentStatus: .paid,
            fieldsMeta: ["flightNumber": FieldMeta(source: .document, confidence: 0.98, documentId: 1),
                         "title": FieldMeta(source: .manual, locked: true)],
            places: [EventPlace(role: "start", label: "Flughafen Zürich", address: "Flughafenstrasse, 8058 Zürich", lat: 47.4647, lon: 8.5492),
                     EventPlace(role: "end", label: "Aeropuerto de Barcelona", address: "08820 El Prat de Llobregat", lat: 41.2974, lon: 2.0833)]))
        events.append(TripEvent(
            id: 102, tripId: 1, type: "Hotel", title: "Hotel Negresco Princess", startDate: day(-2), endDate: day(0),
            startTime: "15:00", endTime: "12:00", startTz: "Europe/Madrid", endTz: "Europe/Madrid", location: "Hotel Negresco Princess",
            address: "Carrer de Pere IV 5, 08018 Barcelona", provider: "Booking.com", bookingReference: "5521983304",
            lat: 41.4021, lon: 2.1940,
            details: ["checkInFrom": "15:00", "checkOutUntil": "12:00", "roomType": "Doppelzimmer Superior", "board": "Fruehstueck",
                      "accessCode": "4821#", "wifi": "NegrescoGuest"],
            documents: [TBDocument(id: 2, title: "Buchungsbestätigung Hotel", fileName: "hotel.pdf", pages: 2, analysisStatus: .done, tripIds: [1], eventIds: [102])],
            participantIds: [], priceMinor: 118_000, currency: "EUR", paymentStatus: .deposit,
            places: [EventPlace(role: "venue", label: "Hotel Negresco Princess", address: "Carrer de Pere IV 5, 08018 Barcelona", lat: 41.4021, lon: 2.1940)]))
        events.append(TripEvent(
            id: 103, tripId: 1, type: "Transfer", title: "Transfer Hotel nach Hafen", startDate: day(0), startTime: "12:30",
            endTime: "13:00", startTz: "Europe/Madrid", provider: "Barcelona Taxi",
            details: ["transferKind": "Taxi", "meetingPoint": "Hotelempfang", "originPlace": "Hotel Negresco Princess",
                      "destinationPlace": "Terminal Port Nou, Barcelona", "durationMinutes": 25],
            places: [EventPlace(role: "start", label: "Hotel Negresco Princess", address: "Carrer de Pere IV 5", lat: 41.4021, lon: 2.1940),
                     EventPlace(role: "end", label: "Terminal Port Nou", address: "Moll Adossat, 08039 Barcelona", lat: 41.3566, lon: 2.1573)]))
        // Gesamtreise ohne Uhrzeit («Reise»): an allen Tagen «Unterwegs».
        events.append(TripEvent(
            id: 104, tripId: 1, type: "Kreuzfahrt", title: "Legend of the Seas", startDate: day(0), endDate: day(26),
            startTz: "Europe/Madrid", endTz: "America/New_York", location: "Terminal Port Nou",
            address: "Moll Adossat, 08039 Barcelona", provider: "Royal Caribbean", bookingReference: "LS88-4410",
            lat: 41.3566, lon: 2.1573,
            details: ["entryKind": "Reise", "ship": "Legend of the Seas", "cabin": "8042", "deck": "8",
                      "terminal": "Port Nou, Terminal B", "allAboard": "16:30", "emergencyPhone": "+34 900 000 000"],
            documents: [TBDocument(id: 1, title: "Reiseunterlagen Kreuzfahrt", fileName: "kreuzfahrt.pdf", pages: 6, analysisStatus: .done, tripIds: [1], eventIds: [104])],
            participantIds: [1, 2, 3, 4], priceMinor: 1_840_000, currency: "CHF", paymentStatus: .deposit, cancelUntil: day(5),
            places: [EventPlace(role: "start", label: "Terminal Port Nou", address: "Moll Adossat, 08039 Barcelona", lat: 41.3566, lon: 2.1573),
                     EventPlace(role: "end", label: "Port Miami", address: "1015 N America Way, Miami", lat: 25.7787, lon: -80.1730)]))
        events.append(TripEvent(
            id: 110, tripId: 1, type: "Kreuzfahrt", title: "Einschiffung Barcelona", startDate: day(0), startTime: "13:30",
            startTz: "Europe/Madrid", location: "Terminal Port Nou", address: "Moll Adossat, 08039 Barcelona",
            provider: "Royal Caribbean", bookingReference: "LS88-4410", lat: 41.3566, lon: 2.1573,
            details: ["entryKind": "Einschiffung", "ship": "Legend of the Seas", "cabin": "8042",
                      "terminal": "Port Nou, Terminal B", "allAboard": "16:30"],
            participantIds: [1, 2, 3, 4],
            places: [EventPlace(role: "venue", label: "Terminal Port Nou", address: "Moll Adossat, 08039 Barcelona", lat: 41.3566, lon: 2.1573)]))
        events.append(TripEvent(
            id: 105, tripId: 1, type: "Ausflug", title: "Palma de Mallorca", startDate: day(1), endDate: day(1), startTime: "07:30",
            endTime: "15:30", startTz: "Europe/Madrid", location: "Palma de Mallorca", lat: 39.5696, lon: 2.6502,
            details: ["meetingPoint": "Ausgang Pier", "durationMinutes": 480]))
        events.append(TripEvent(
            id: 106, tripId: 1, type: "Restaurant", title: "Abendessen Tapas", startDate: day(0), startTime: "20:30",
            startTz: "Europe/Madrid", location: "Bar Cañete", address: "Carrer de la Unió 17, Barcelona", lat: 41.3796, lon: 2.1737,
            details: ["reservationName": "Walker", "partySize": 4], participantIds: [1, 2, 3, 4]))
        events.append(TripEvent(
            id: 107, tripId: 1, type: "Mietauto", title: "Mietwagen Miami", startDate: day(25), endDate: day(28), startTime: "10:00",
            endTime: "10:00", startTz: "America/New_York", location: "Miami Airport", provider: "Alamo", bookingReference: "AL-77231",
            details: ["vehicleCategory": "Kompakt SUV", "pickupPlace": "Alamo Miami Airport", "returnPlace": "Alamo Miami Airport",
                      "pickupHours": "06:00–24:00", "emergencyPhone": "+1 800 000 0000", "transmission": "Automat"],
            cancelUntil: day(20)))
        events.append(TripEvent(
            id: 108, tripId: 1, type: "Aufgabe", title: "Online-Check-in Kreuzfahrt ausfüllen", startDate: day(0),
            details: ["done": false]))
        events.append(TripEvent(
            id: 109, tripId: 1, type: "Hotel", title: "Hotel Miami Beach (Vorschlag)", startDate: day(26), endDate: day(28),
            startTime: "15:00", startTz: "America/New_York", location: "Miami Beach", provider: "Hilton",
            status: .needsReview,
            fieldsMeta: ["startDate": FieldMeta(source: .document, confidence: 0.62, documentId: 3, page: 1, quote: "Arrival 11/06")],
            sourceDocumentId: 3))
        let tripOne = TripDetail(trip: trip, travelers: people, events: events)

        let upcomingTrip = Trip(id: 2, title: "Weihnachten in Lissabon", status: .planned, destination: "Lissabon",
                                startDate: day(70), endDate: day(78), ledgerId: 12, homeCurrency: "EUR", timezone: "Europe/Lisbon", phase: .upcoming)
        let upcoming = TripDetail(trip: upcomingTrip, travelers: Array(people.prefix(2)), events: [
            TripEvent(id: 201, tripId: 2, type: "Flug", title: "Flug nach Lissabon", startDate: day(70), startTime: "10:20",
                      startTz: "Europe/Zurich", endTz: "Europe/Lisbon", details: ["departureAirport": "ZRH", "arrivalAirport": "LIS"]),
        ])
        let pastTrip = Trip(id: 3, title: "Wochenende Wien", status: .done, destination: "Wien", startDate: day(-120),
                            endDate: day(-117), ledgerId: 13, homeCurrency: "EUR", timezone: "Europe/Vienna", phase: .past)
        let past = TripDetail(trip: pastTrip, travelers: Array(people.prefix(3)), events: [])
        details = [tripOne, upcoming, past]

        documents = [
            TBDocument(id: 1, title: "Reiseunterlagen Kreuzfahrt", fileName: "kreuzfahrt.pdf", contentType: "application/pdf",
                       sizeBytes: 480_000, pages: 6, analysisStatus: .done, summary: "Einschiffung 13:30, Kabine 8042", tripIds: [1], eventIds: [104]),
            TBDocument(id: 2, title: "Buchungsbestätigung Hotel", fileName: "hotel.pdf", sizeBytes: 120_000, pages: 2,
                       analysisStatus: .done, tripIds: [1], eventIds: [102]),
            TBDocument(id: 3, title: "Hilton Miami Beach", fileName: "hilton.pdf", sizeBytes: 90_000, pages: 1,
                       analysisStatus: .processing, tripIds: [1], eventIds: [109]),
        ]

        func exp(_ id: Int, _ paid: Int, _ amount: Int, _ desc: String, _ dayOffset: Int, _ cat: String, currency: String = "CHF") -> Expense {
            let shares = SplitCalculator.equal(total: amount, memberIDs: [1, 2, 3, 4])
            return Expense(id: id, ledgerId: 11, paidByMemberId: paid, createdByMemberId: paid, direction: .expense,
                           amountMinor: amount, currency: currency, exchangeRate: 1, amountBaseMinor: amount, description: desc,
                           expenseDate: day(dayOffset), category: cat, note: nil, splitMode: .equal, settledStatus: 0,
                           documentId: nil, tripEventId: nil, place: nil,
                           splits: shares.sorted { $0.key < $1.key }.map { ExpenseSplit(memberId: $0.key, shareBaseMinor: $0.value, shareUnits: nil) },
                           createdAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z")
        }
        expenses = [
            exp(61, 1, 164_800, "Flüge Zürich – Barcelona", -2, "Flug"),
            exp(62, 3, 118_000, "Hotel Negresco Princess", -2, "Hotel"),
            exp(63, 2, 8_650, "Taxi und Abendessen", -2, "Essen"),
            exp(64, 4, 12_400, "Metro-Tickets und Museum", -1, "Aktivität"),
            exp(65, 1, 6_200, "Frühstück", 0, "Essen"),
        ]
        settlements = [
            Settlement(id: 1, ledgerId: 11, fromMemberId: 4, toMemberId: 1, amountMinor: 10_000, currency: "CHF", exchangeRate: 1,
                       amountBaseMinor: 10_000, note: "Anzahlung", settledAt: day(-1), relatedExpenseId: nil, auto: false,
                       createdAt: "2026-10-10T10:00:00.000Z"),
        ]
    }

    /// Salden wie der Server: bezahlt − geschuldet ± Rückzahlungen; Vorschläge greedy.
    static func overview(ledgerID: Int, members: [Member], expenses: [Expense], settlements: [Settlement]) -> LedgerOverview {
        let list = expenses.filter { $0.ledgerId == ledgerID }
        let sets = settlements.filter { $0.ledgerId == ledgerID }
        var paid: [Int: Int] = [:], owed: [Int: Int] = [:], sPaid: [Int: Int] = [:], sRecv: [Int: Int] = [:]
        for e in list {
            paid[e.paidByMemberId, default: 0] += e.amountBaseMinor
            for s in e.splits { owed[s.memberId, default: 0] += s.shareBaseMinor }
        }
        for s in sets {
            sPaid[s.fromMemberId, default: 0] += s.amountBaseMinor
            sRecv[s.toMemberId, default: 0] += s.amountBaseMinor
        }
        let balances = members.map { m -> Balance in
            let net = (paid[m.id] ?? 0) - (owed[m.id] ?? 0) + (sPaid[m.id] ?? 0) - (sRecv[m.id] ?? 0)
            return Balance(memberId: m.id, displayName: m.displayName, paidMinor: paid[m.id] ?? 0, owedMinor: owed[m.id] ?? 0,
                           settlementsPaidMinor: sPaid[m.id] ?? 0, settlementsReceivedMinor: sRecv[m.id] ?? 0, netMinor: net)
        }
        var creditors = balances.filter { $0.netMinor > 0 }.map { ($0.memberId, $0.displayName, $0.netMinor) }
        var debtors = balances.filter { $0.netMinor < 0 }.map { ($0.memberId, $0.displayName, -$0.netMinor) }
        var transfers: [Transfer] = []
        while let c = creditors.first, let d = debtors.first {
            let amount = min(c.2, d.2)
            transfers.append(Transfer(fromMemberId: d.0, fromName: d.1, toMemberId: c.0, toName: c.1, amountMinor: amount))
            creditors[0].2 -= amount; debtors[0].2 -= amount
            if creditors[0].2 == 0 { creditors.removeFirst() }
            if debtors[0].2 == 0 { debtors.removeFirst() }
        }
        let total = list.reduce(0) { $0 + $1.amountBaseMinor }
        return LedgerOverview(
            ledger: Ledger(id: ledgerID, title: "Ferien 2026", baseCurrency: "CHF", kind: .split, tripId: 1, archivedAt: nil,
                           createdAt: nil, updatedAt: nil),
            members: members, couples: [], totals: LedgerTotals(expenseMinor: total, incomeMinor: 0, netMinor: total, count: list.count),
            balances: balances, suggestedTransfers: transfers, payerDebts: [])
    }
}
