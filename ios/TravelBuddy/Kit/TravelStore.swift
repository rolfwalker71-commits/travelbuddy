import Foundation
import Observation

/// Zentraler Zustand einer angemeldeten Sitzung: Katalog, Reisen, Reisedetails, Heute, Prüfliste.
/// Lädt vom Server und fällt bei fehlender Verbindung auf den lokalen Zwischenspeicher zurück.
@MainActor
@Observable
final class TravelStore {
    let api: any TravelAPI
    let user: User
    let cache: OfflineStore
    var onSummary: (Data) -> Void = { SummarySync.store($0) }

    private(set) var catalog: EventCatalog {
        didSet { EventCatalogLoader.shared = catalog }
    }
    private(set) var trips: [TripSummary] = []
    private(set) var tripsState: LoadState = .idle
    private(set) var tripsSavedAt: Date?
    private(set) var details: [Int: TripDetail] = [:]
    private(set) var detailSavedAt: [Int: Date] = [:]
    private(set) var detailStates: [Int: LoadState] = [:]
    private(set) var todayPlan: TodayPlan?
    private(set) var todayState: LoadState = .idle
    private(set) var todaySavedAt: Date?
    private(set) var inbox: InboxResponse?
    /// Letzter Abruf scheiterte an der Verbindung; angezeigt wird der Zwischenspeicher.
    private(set) var isOffline = false
    private(set) var offlineDocumentIDs: Set<Int> = []
    private var prefetching = Set<Int>()

    init(api: any TravelAPI, user: User, cache: OfflineStore) {
        self.api = api
        self.user = user
        self.cache = cache
        if let data = cache.load(Data.self, name: CacheKey.catalog)?.value,
           let c = try? EventCatalogLoader.decode(data), !c.types.isEmpty {
            catalog = c
        } else {
            catalog = EventCatalogLoader.bundled()
        }
        EventCatalogLoader.shared = catalog
        if let cached = cache.load([TripSummary].self, name: CacheKey.trips) {
            trips = cached.value
            tripsSavedAt = cached.savedAt
        }
        if let cached = cache.load(InboxResponse.self, name: CacheKey.inbox) { inbox = cached.value }
    }

    // MARK: Abgeleitet

    /// Phase relativ zu heute, lokal berechnet (der Zwischenspeicher kann Tage alt sein).
    func phase(of trip: TripSummary, now: Date = AppClock.now) -> TripPhase {
        let zone = TripClock.zone(trip.timezone) ?? .current
        return TripPhase.compute(startDate: trip.startDate, endDate: trip.endDate, today: TBDate.isoDay(of: now, in: zone))
    }

    var activeTrip: TripSummary? {
        trips.filter { phase(of: $0) == .active && $0.status != .cancelled }
            .sorted { ($0.startDate ?? "") > ($1.startDate ?? "") }.first
    }

    /// Reise für die Kasse: aktive, sonst nächste, sonst jüngste vergangene.
    var currentTrip: TripSummary? {
        if let a = activeTrip { return a }
        let upcoming = trips.filter { phase(of: $0) == .upcoming }.sorted { ($0.startDate ?? "9999") < ($1.startDate ?? "9999") }
        if let u = upcoming.first { return u }
        return trips.filter { phase(of: $0) == .past }.sorted { ($0.startDate ?? "") > ($1.startDate ?? "") }.first
    }

    func trip(id: Int) -> Trip? { details[id]?.trip }

    /// Reisekasse der Reise (wird vom Server beim Anlegen der Reise erzeugt).
    func currentLedgerID(tripID: Int) -> Int? {
        details[tripID]?.trip.ledgerId ?? trips.first { $0.id == tripID }?.ledgerId
    }
    func detail(id: Int) -> TripDetail? { details[id] }

    /// Der Teilnehmer, der zum angemeldeten Konto gehört.
    func myParticipantID(tripID: Int) -> Int? {
        details[tripID]?.travelers.first { $0.userId == user.id }?.id
    }

    var reviewCount: Int {
        let fromInbox = inbox?.review.count ?? 0
        return max(fromInbox, todayPlan?.review ?? 0)
    }

    // MARK: Katalog

    func refreshCatalog() async {
        guard let data = try? await api.eventTypesData(), let fresh = try? EventCatalogLoader.decode(data),
              !fresh.types.isEmpty else { return }
        catalog = fresh
        cache.save(data, as: CacheKey.catalog)
    }

    // MARK: Reisen

    func refreshTrips() async {
        if trips.isEmpty { tripsState = .loading }
        do {
            let list = try await api.trips()
            trips = list
            tripsSavedAt = Date()
            tripsState = .loaded
            isOffline = false
            cache.save(list, as: CacheKey.trips)
        } catch {
            if error.isCancellation { return }
            handleReadFailure(error, state: &tripsState, hasCache: !trips.isEmpty)
        }
    }

    func refreshDetail(id: Int) async {
        if details[id] == nil {
            if let cached = cache.load(TripDetail.self, name: CacheKey.trip(id)) {
                details[id] = cached.value
                detailSavedAt[id] = cached.savedAt
            }
            if details[id] == nil { detailStates[id] = .loading }
        }
        do {
            let d = try await api.trip(id: id)
            apply(d)
            isOffline = false
        } catch {
            if error.isCancellation { return }
            var state = detailStates[id] ?? .idle
            handleReadFailure(error, state: &state, hasCache: details[id] != nil)
            detailStates[id] = state
        }
    }

    private func handleReadFailure(_ error: Error, state: inout LoadState, hasCache: Bool) {
        if error.isOffline { isOffline = true }
        state = hasCache ? .loaded : .failed(error.userMessage)
    }

    /// Übernimmt eine (vom Server gelieferte) Reise in Speicher und Zwischenspeicher.
    func apply(_ detail: TripDetail) {
        var d = detail
        d.createdEventId = nil
        details[d.trip.id] = d
        detailSavedAt[d.trip.id] = Date()
        detailStates[d.trip.id] = .loaded
        cache.save(d, as: CacheKey.trip(d.trip.id))
        // Zähler der Reisenliste nachziehen.
        if let i = trips.firstIndex(where: { $0.id == d.trip.id }) {
            trips[i].title = d.trip.title
            trips[i].destination = d.trip.destination
            trips[i].startDate = d.trip.startDate
            trips[i].endDate = d.trip.endDate
            trips[i].eventCount = d.events.count
            trips[i].travelerCount = d.travelers.count
            trips[i].needsReviewCount = d.events.filter { $0.status.isProposal }.count
            cache.save(trips, as: CacheKey.trips)
        }
    }

    // MARK: Heute

    func refreshToday() async {
        guard let active = activeTrip else {
            todayPlan = nil
            todayState = .loaded
            return
        }
        if todayPlan == nil { todayState = .loading }
        let zone = TripClock.zone(active.timezone) ?? .current
        let now = AppClock.now
        do {
            let day = TBDate.isoDay(of: now, in: zone)
            var response: TodayResponse
            if AppClock.offset != 0 {
                // Vorführuhr: der Server kennt «heute» nicht, die Tagesansicht der Reise schon.
                response = try await api.day(tripID: active.id, date: day)
            } else {
                response = try await api.today(date: day, tz: zone.identifier)
                // Der Server sieht keine aktive Reise, die App schon (Zonengrenze): Tagesansicht der Reise.
                if response.trip == nil, let d = try? await api.day(tripID: active.id, date: day), d.trip != nil { response = d }
            }
            let plan = TodayPlanner.plan(from: response, catalog: catalog, now: now)
            if plan.trip == nil, plan.upcoming == nil, plan.entries.isEmpty {
                // Der Server kennt keine aktive Reise, die App aber schon (veralteter Zwischenspeicher).
                todayPlan = plan
            } else {
                todayPlan = plan
            }
            todayState = .loaded
            todaySavedAt = Date()
            isOffline = false
            cache.save(response, as: CacheKey.today(active.id))
        } catch {
            if error.isCancellation { return }
            if error.isOffline { isOffline = true }
            if let offline = offlineToday(trip: active, now: now) {
                todayPlan = offline.plan
                todaySavedAt = offline.savedAt
                todayState = .loaded
            } else {
                todayState = .failed(error.userMessage)
            }
        }
    }

    /// Heute-Stand ohne Server: aus der zwischengespeicherten Reise, sonst aus dem letzten Heute-Stand.
    func offlineToday(trip: TripSummary, now: Date) -> (plan: TodayPlan, savedAt: Date?)? {
        if let d = details[trip.id] ?? cache.load(TripDetail.self, name: CacheKey.trip(trip.id))?.value {
            let response = TodayPlanner.response(from: d, now: now, myParticipantId: d.travelers.first { $0.userId == user.id }?.id, catalog: catalog)
            var plan = TodayPlanner.plan(from: response, catalog: catalog, now: now, isOffline: true)
            plan.isOffline = true
            return (plan, detailSavedAt[trip.id] ?? cache.load(TripDetail.self, name: CacheKey.trip(trip.id))?.savedAt)
        }
        if let cached = cache.load(TodayResponse.self, name: CacheKey.today(trip.id)) {
            return (TodayPlanner.plan(from: cached.value, catalog: catalog, now: now, isOffline: true), cached.savedAt)
        }
        return nil
    }

    // MARK: Prüfliste

    func refreshInbox() async {
        do {
            let value = try await api.inbox()
            inbox = value
            cache.save(value, as: CacheKey.inbox)
        } catch {
            // Fehlt der Endpunkt noch, bleibt die Liste leer; Fehler zeigt nur die Prüfansicht selbst.
        }
    }

    // MARK: Alles auffrischen

    /// Pull-to-refresh und Rückkehr in den Vordergrund.
    func refreshAll() async {
        await refreshTrips()
        await refreshToday()
        if let active = activeTrip {
            await refreshDetail(id: active.id)
            // Heute neu, falls die Reise erst jetzt geladen wurde (Offline-Ableitung braucht sie).
            if todayPlan?.isOffline == true { await refreshToday() }
            prefetchDocuments(tripID: active.id)
        }
        await refreshInbox()
        await refreshSummary()
    }

    func refreshSummary() async {
        guard let data = try? await api.summaryData() else { return }
        onSummary(data)
    }

    // MARK: Schreiben (werfen; Ansichten zeigen `writeMessage`)

    @discardableResult
    func createEvent(tripID: Int, body: EventBody) async throws -> Int? {
        let d = try await api.createEvent(tripID: tripID, body)
        apply(d)
        await afterWrite(tripID: tripID)
        return d.createdEventId
    }

    func updateEvent(tripID: Int, eventID: Int, body: EventBody) async throws {
        guard !body.isEmpty else { return }
        apply(try await api.updateEvent(tripID: tripID, eventID: eventID, body))
        await afterWrite(tripID: tripID)
    }

    func deleteEvent(tripID: Int, eventID: Int) async throws {
        apply(try await api.deleteEvent(tripID: tripID, eventID: eventID))
        await afterWrite(tripID: tripID)
    }

    func confirmEvent(tripID: Int, eventID: Int) async throws {
        apply(try await api.confirmEvent(tripID: tripID, eventID: eventID))
        await afterWrite(tripID: tripID)
        await refreshInbox()
    }

    func mergeEvent(tripID: Int, eventID: Int, into target: Int) async throws {
        apply(try await api.mergeEvent(tripID: tripID, eventID: eventID, into: target))
        await afterWrite(tripID: tripID)
        await refreshInbox()
    }

    func addComment(tripID: Int, eventID: Int, body: String) async throws {
        _ = try await api.addComment(tripID: tripID, eventID: eventID, body: body)
        await refreshDetail(id: tripID)
    }

    func deleteComment(tripID: Int, eventID: Int, commentID: Int) async throws {
        try await api.deleteComment(tripID: tripID, eventID: eventID, commentID: commentID)
        await refreshDetail(id: tripID)
    }

    func updateTrip(id: Int, _ request: UpdateTripRequest) async throws {
        apply(try await api.updateTrip(id: id, request))
        await afterWrite(tripID: id)
    }

    @discardableResult
    func createTrip(_ request: CreateTripRequest) async throws -> Int {
        let d = try await api.createTrip(request)
        await refreshTrips()
        apply(d)
        return d.trip.id
    }

    func deleteTrip(id: Int) async throws {
        try await api.deleteTrip(id: id)
        details[id] = nil
        cache.remove(CacheKey.trip(id))
        await refreshTrips()
    }

    func addTraveler(tripID: Int, _ input: TravelerInput) async throws { apply(try await api.addTraveler(tripID: tripID, input)) }
    func removeTraveler(tripID: Int, travelerID: Int) async throws { apply(try await api.removeTraveler(tripID: tripID, travelerID: travelerID)) }
    func rotateShare(tripID: Int, travelerID: Int) async throws { apply(try await api.rotateTravelerShare(tripID: tripID, travelerID: travelerID)) }
    func revokeShare(tripID: Int, travelerID: Int) async throws { apply(try await api.revokeTravelerShare(tripID: tripID, travelerID: travelerID)) }

    private func afterWrite(tripID: Int) async {
        if tripID == activeTrip?.id { await refreshToday() }
        await refreshSummary()
    }

    // MARK: Offline-Dokumente

    /// Lädt die PDFs/Bilder der aktiven Reise für den Offline-Zugriff (nacheinander, im Hintergrund).
    func prefetchDocuments(tripID: Int) {
        guard let d = details[tripID], !prefetching.contains(tripID) else { return }
        var docs: [Int: TBDocument] = [:]
        for e in d.events {
            for doc in e.documents { docs[doc.id] = doc }
            for id in e.documentIds where docs[id] == nil { docs[id] = TBDocument(id: id) }
        }
        let wanted = Set(docs.keys)
        cache.removeDocuments(except: wanted)
        offlineDocumentIDs = Set(wanted.filter { cache.cachedDocument(id: $0) != nil })
        let missing = docs.values.filter { cache.cachedDocument(id: $0.id) == nil && $0.sizeBytes <= 25 * 1024 * 1024 }
        guard !missing.isEmpty else { return }
        prefetching.insert(tripID)
        let api = self.api, cache = self.cache
        Task { [weak self] in
            for doc in missing {
                if Task.isCancelled { break }
                guard let file = try? await api.documentFile(id: doc.id) else { continue }
                cache.saveDocument(file.data, id: doc.id, fileName: file.filename ?? doc.fileName, contentType: file.contentType ?? doc.contentType)
                await MainActor.run { _ = self?.offlineDocumentIDs.insert(doc.id) }
            }
            await MainActor.run { _ = self?.prefetching.remove(tripID) }
        }
    }

    /// Dokumentdaten: zuerst Offline-Kopie, sonst Server (und danach merken, wenn die Reise aktiv ist).
    func documentData(id: Int, fileName: String?, contentType: String?) async throws -> (data: Data, contentType: String?, fileName: String?) {
        if let url = cache.cachedDocument(id: id), let data = try? Data(contentsOf: url) {
            return (data, contentType ?? Self.mimeType(forExtension: url.pathExtension), fileName ?? url.lastPathComponent)
        }
        let file = try await api.documentFile(id: id)
        cache.saveDocument(file.data, id: id, fileName: file.filename ?? fileName, contentType: file.contentType ?? contentType)
        offlineDocumentIDs.insert(id)
        return (file.data, file.contentType ?? contentType, file.filename ?? fileName)
    }

    static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "pdf": "application/pdf"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "heic": "image/heic"
        default: "application/octet-stream"
        }
    }

    func clearLocalData() {
        cache.clear()
        trips = []; details = [:]; todayPlan = nil; inbox = nil; offlineDocumentIDs = []
    }
}
