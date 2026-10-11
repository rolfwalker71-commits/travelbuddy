import Testing
import Foundation
@testable import TravelBuddy

@Suite("Store, Offline, Navigation, Widgets", .serialized)
@MainActor
struct StoreTests {
    private func makeStore(api: DemoAPI) -> TravelStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tb-test-\(UUID().uuidString)")
        let cache = OfflineStore(root: dir, scope: "test")
        return TravelStore(api: api, user: DemoAPI.user, cache: cache)
    }

    private func noonMadrid() -> Date {
        // Heute 10:30 in Madrid, damit «Als Nächstes» deterministisch ist.
        var cal = TBDate.calendar(in: TimeZone(identifier: "Europe/Madrid")!)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid")!
        var c = cal.dateComponents([.year, .month, .day], from: Date())
        c.hour = 10; c.minute = 30
        return cal.date(from: c)!
    }

    @Test("Heute aus dem Server, bei Verbindungsfehler aus dem Zwischenspeicher")
    func offlineFallback() async throws {
        let now = noonMadrid()
        AppClock.offset = now.timeIntervalSince(Date())
        defer { AppClock.offset = 0 }
        let api = DemoAPI(now: now)
        let store = makeStore(api: api)
        await store.refreshTrips()
        #expect(store.activeTrip?.id == 1)
        await store.refreshDetail(id: 1)
        await store.refreshToday()
        #expect(store.todayPlan?.isOffline == false)
        #expect(store.todayPlan?.entries.isEmpty == false)

        // Verbindung weg: frischer Store mit demselben Zwischenspeicher.
        api.failing = .network("Keine Internetverbindung.")
        let offline = TravelStore(api: api, user: DemoAPI.user, cache: store.cache)
        #expect(offline.trips.count == 3)                     // aus dem Zwischenspeicher
        await offline.refreshTrips()
        #expect(offline.isOffline)
        #expect(offline.tripsState == .loaded)
        await offline.refreshDetail(id: 1)
        #expect(offline.detail(id: 1) != nil)
        await offline.refreshToday()
        #expect(offline.todayPlan?.isOffline == true)
        #expect(offline.todayPlan?.entries.isEmpty == false)
    }

    @Test("Schreiben ohne Netz meldet klar «offline»")
    func writeOffline() async throws {
        let api = DemoAPI(now: noonMadrid())
        let store = makeStore(api: api)
        await store.refreshTrips()
        api.failing = .network("Keine Internetverbindung.")
        do {
            _ = try await store.createEvent(tripID: 1, body: EventBody(["type": "Aufgabe", "title": "x"]))
            Issue.record("Fehler erwartet")
        } catch {
            #expect(error.isOffline)
            #expect(error.writeMessage.contains("offline"))
        }
    }

    @Test("Ereignis anlegen, ändern, löschen über den Store")
    func eventLifecycle() async throws {
        let api = DemoAPI(now: noonMadrid())
        let store = makeStore(api: api)
        await store.refreshTrips()
        await store.refreshDetail(id: 1)
        let before = store.detail(id: 1)!.events.count
        let id = try await store.createEvent(tripID: 1, body: EventBody(["type": "Restaurant", "title": "Frühstück", "startDate": "2026-10-26"]))
        let newID = try #require(id)
        #expect(store.detail(id: 1)!.events.count == before + 1)
        try await store.updateEvent(tripID: 1, eventID: newID, body: EventBody(["title": "Brunch"]))
        #expect(store.detail(id: 1)!.event(id: newID)?.title == "Brunch")
        #expect(store.detail(id: 1)!.event(id: newID)?.fieldsMeta["title"]?.locked == true)
        try await store.deleteEvent(tripID: 1, eventID: newID)
        #expect(store.detail(id: 1)!.events.count == before)
    }

    @Test("Vorschlag übernehmen")
    func confirm() async throws {
        let api = DemoAPI(now: noonMadrid())
        let store = makeStore(api: api)
        await store.refreshTrips()
        await store.refreshDetail(id: 1)
        await store.refreshInbox()
        #expect(store.inbox?.review.count == 1)
        let item = try #require(store.inbox?.review.first)
        try await store.confirmEvent(tripID: item.tripId, eventID: item.event.id)
        #expect(store.inbox?.review.isEmpty == true)
    }

    @Test("Zusammenfassung wird als String und Unix-Sekunden für Widgets abgelegt")
    func summarySync() throws {
        let defaults = UserDefaults(suiteName: "tb-test-\(UUID().uuidString)")!
        nonisolated(unsafe) var reloaded = 0
        let json = Data("{\"generatedAt\":\"2026-10-25T10:00:00Z\",\"nextEvents\":[]}".utf8)
        let date = Date(timeIntervalSince1970: 1_792_000_000)
        #expect(SummarySync.store(json, defaults: defaults, date: date, reload: { reloaded += 1 }))
        #expect(defaults.string(forKey: SharedConfig.Key.summaryJSON) == "{\"generatedAt\":\"2026-10-25T10:00:00Z\",\"nextEvents\":[]}")
        #expect(defaults.double(forKey: SharedConfig.Key.summaryFetchedAt) == 1_792_000_000)
        #expect(reloaded == 1)
        #expect(!SummarySync.store(Data("<html>".utf8), defaults: defaults, reload: { reloaded += 1 }))
        #expect(reloaded == 1)
        SummarySync.clear(defaults: defaults, reload: { reloaded += 1 })
        #expect(defaults.string(forKey: SharedConfig.Key.summaryJSON) == nil)
    }

    @Test("Reisekasse: Ereignis übernehmen baut die Ausgabe")
    func ledgerTakeover() {
        var e = Fixture.flight()
        e.priceMinor = 41_200; e.currency = "EUR"; e.participantIds = [1, 2]
        let body = LedgerTakeover.body(event: e, baseCurrency: "CHF", memberIDs: [1, 2, 3], payerID: 1, rate: 0.93,
                                       fallbackCurrency: "CHF", today: "2026-10-25")
        #expect(body?.amountMinor == 41_200)
        #expect(body?.currency == "EUR")
        #expect(body?.exchangeRate == 0.93)
        #expect(body?.tripEventId == 1)
        if case .equal(let ids)? = body?.split { #expect(ids == [1, 2]) } else { Issue.record("Aufteilung erwartet") }
        e.priceMinor = nil
        #expect(LedgerTakeover.body(event: e, baseCurrency: "CHF", memberIDs: [1], payerID: 1, rate: nil, fallbackCurrency: "CHF", today: "x") == nil)
    }

    @Test("Aufteilung der Kasse: Rest geht an die grössten Reste")
    func split() {
        let shares = SplitCalculator.equal(total: 1000, memberIDs: [1, 2, 3])
        #expect(shares.values.reduce(0, +) == 1000)
        #expect(shares[1] == 334)
        var draft = ExpenseDraft(baseCurrency: "CHF", memberIDs: [1, 2, 3], isCashbook: false, today: "2026-10-25", paidByMemberID: 1)
        draft.amountText = "10.00"
        #expect(draft.isValid)
        #expect(draft.sharePreview.values.reduce(0, +) == 1000)
        draft.switchSplit(to: .exact)
        draft.exactText[1] = "5.00"
        #expect(draft.exactRemainder != 0)
        #expect(!draft.isValid)
    }
}

@Suite("Links und Mitteilungen")
struct LinkTests {
    @Test func urls() {
        #expect(AppDestination(url: URL(string: "travelbuddy://today")!) == .today)
        #expect(AppDestination(url: URL(string: "travelbuddy://trip/12")!) == .trip(12))
        #expect(AppDestination(url: URL(string: "travelbuddy://event/12/45")!) == .event(tripID: 12, eventID: 45))
        #expect(AppDestination(url: URL(string: "travelbuddy://ledger/3")!) == .ledger(3))
        #expect(AppDestination(url: URL(string: "travelbuddy://inbox")!) == .inbox)
        #expect(AppDestination(url: URL(string: "travelbuddy://trip/abc")!) == nil)
        #expect(AppDestination(url: URL(string: "homebuddy://today")!) == nil)
        #expect(AppDestination.event(tripID: 1, eventID: 2).url.absoluteString == "travelbuddy://event/1/2")
        let parsed = AppDestination.parse(url: URL(string: "travelbuddy://event/1/2?section=documents")!)
        #expect(parsed?.destination == .event(tripID: 1, eventID: 2))
        #expect(parsed?.action == .document)
    }

    @Test func pushPayload() {
        let a = AppDestination(pushUserInfo: ["deepLink": "travelbuddy://event/3/9", "tripId": 3, "eventId": 9, "kind": "trip.depart"])
        #expect(a == .event(tripID: 3, eventID: 9))
        #expect(AppDestination(pushUserInfo: ["tripId": 3, "kind": "trip.review"]) == .inbox)
        #expect(AppDestination(pushUserInfo: ["tripId": "3", "eventId": "9", "kind": "trip.stay"]) == .event(tripID: 3, eventID: 9))
        #expect(AppDestination(pushUserInfo: ["kind": "trip.today"]) == .today)
        #expect(AppDestination(pushUserInfo: ["aps": [:]]) == nil)
    }

    @Test func notificationCategoriesAndActions() {
        let cats = NotificationSetup.categories()
        #expect(Set(cats.map(\.identifier)) == ["trip.today", "trip.depart", "trip.stay", "trip.pickup", "trip.deadline", "trip.review"])
        let depart = cats.first { $0.identifier == "trip.depart" }!
        #expect(depart.actions.map(\.identifier) == ["tb.open", "tb.document", "tb.route"])
        let info: [AnyHashable: Any] = ["deepLink": "travelbuddy://event/3/9", "kind": "trip.depart"]
        let r = NotificationSetup.destination(actionIdentifier: "tb.route", userInfo: info)
        #expect(r?.0 == .event(tripID: 3, eventID: 9))
        #expect(r?.1 == .route)
    }

    @Test func preferences() throws {
        var p = NotificationPrefs(raw: ["tripToday": false])
        #expect(!p.isOn(.today))
        #expect(p.isOn(.depart))                    // unbekannt = an
        p.set(.depart, false)
        #expect(p.raw["tripDepart"] == .bool(false))
        #expect(!p.isOn(.depart))
        // Vertragsschlüssel, genau so.
        #expect(TripNotificationKind.allCases.map(\.prefKey) == [
            "tripToday", "tripDepart", "tripStay", "tripPickup", "tripDeadline", "tripReview", "tripComment",
            "ledgerExpense", "ledgerSettlement"])
        // Ruhezeiten und Vorlaufzeiten.
        #expect(p.quietHours == QuietHours(enabled: true, from: "22:30", to: "06:30"))   // Standard
        let json = Data(#"{"quietHours":{"enabled":false,"from":"23:00","to":"07:00"},"leadTimes":{"departHours":[24,6],"checkoutMinutes":90,"deadlineDays":5,"todayBriefing":"08:00"}}"#.utf8)
        let parsed = try JSONDecoder().decode([String: JSONValue].self, from: json)
        let q = NotificationPrefs(raw: parsed)
        #expect(q.quietHours == QuietHours(enabled: false, from: "23:00", to: "07:00"))
        #expect(q.leadTimes.departHours == [24, 6])
        #expect(q.leadTimes.checkoutMinutes == 90 && q.leadTimes.deadlineDays == 5 && q.leadTimes.todayBriefing == "08:00")
    }
}

@Suite("Illustrationen und Reisenliste")
struct MiscTests {
    @Test func manifestVariants() {
        let a = IllustrationCatalog.entries(from: Data("{\"illustrations\":[{\"key\":\"type-Flug\",\"file\":\"light/type-Flug.svg\",\"title\":\"Flug\"}]}".utf8))
        #expect(a.first?.key == "type-Flug")
        #expect(a.first?.imageNames.contains("type-Flug") == true)
        let b = IllustrationCatalog.entries(from: Data("[{\"id\":\"notif-today\",\"path\":\"x/notif-today.svg\"}]".utf8))
        #expect(b.first?.key == "notif-today")
        let c = IllustrationCatalog.entries(from: Data("{\"type-Hotel\":\"light/type-Hotel.svg\"}".utf8))
        #expect(c.first?.key == "type-Hotel")
        #expect(IllustrationCatalog.entries(from: Data("kaputt".utf8)).isEmpty)
        let cards = IllustrationCatalog.helpCards(from: Data("{\"cards\":[{\"id\":\"scan\",\"title\":\"Scannen\",\"text\":\"…\",\"steps\":[\"a\",\"b\"],\"illustration\":\"type-Flug\"}]}".utf8))
        #expect(cards.first?.steps.count == 2)
        #expect(cards.first?.illustrationKey == "type-Flug")
    }

    @Test func tripGrouping() {
        func t(_ id: Int, _ s: String, _ e: String, _ p: TripPhase) -> TripSummary {
            TripSummary(id: id, title: "T\(id)", startDate: s, endDate: e, phase: p)
        }
        let list = [t(1, "2026-01-01", "2026-01-05", .past), t(2, "2026-11-01", "2026-11-05", .upcoming),
                    t(3, "2026-10-20", "2026-11-20", .active), t(4, "2025-05-01", "2025-05-05", .past)]
        let g = TripListLogic.groups(list)
        #expect(g.map(\.phase) == [.active, .upcoming, .past])
        #expect(g[2].trips.map(\.id) == [1, 4])    // jüngste zuerst
        #expect(TripListLogic.groups(list, query: "t4").flatMap(\.trips).map(\.id) == [4])
        #expect(TripListLogic.activeTrip(list)?.id == 3)
    }

    @Test func passwordPolicy() {
        #expect(PasswordPolicy.problems(current: "a", new: "kurz", confirmation: "kurz").contains(.tooShort(missing: 8)))
        #expect(PasswordPolicy.problems(current: "alt-passwort-123", new: "neues-passwort-123", confirmation: "neues-passwort-123").isEmpty)
    }

    @Test func jsonValueRoundTrip() throws {
        let v: JSONValue = .object(["a": 1, "b": .array([.string("x"), .bool(true), .null]), "c": .double(1.5)])
        let data = try JSONEncoder().encode(v)
        #expect(try JSONDecoder().decode(JSONValue.self, from: data) == v)
        #expect(JSONValue.string("  ").isBlank)
        #expect(JSONValue.int(5).stringValue == "5")
    }
}
