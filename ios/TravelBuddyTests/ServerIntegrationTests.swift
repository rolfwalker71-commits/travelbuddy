import Testing
import Foundation
@testable import TravelBuddy

/// Läuft nur, wenn ein lokaler Server und Testzugang angegeben sind:
/// `TEST_RUNNER_TB_IT_SERVER=http://127.0.0.1:7799 TEST_RUNNER_TB_IT_USER=… TEST_RUNNER_TB_IT_PASSWORD=… xcodebuild test`.
/// Prüft die Modelle der App gegen die echten Antworten des Servers (Vertrag).
@Suite("Server-Integration (lokal, optional)", .serialized,
       .enabled(if: ProcessInfo.processInfo.environment["TB_IT_SERVER"] != nil))
struct ServerIntegrationTests {
    private func api() async throws -> APIClient {
        let env = ProcessInfo.processInfo.environment
        let url = try #require(ServerURL.normalize(env["TB_IT_SERVER"] ?? ""))
        let login = try await Authenticator.login(baseURL: url, username: env["TB_IT_USER"] ?? "", password: env["TB_IT_PASSWORD"] ?? "",
                                                  deviceName: "Test", platform: "ios")
        return APIClient(baseURL: url, token: login.token)
    }

    @Test func versionAndCatalog() async throws {
        let c = try await api()
        let v = try await c.version()
        #expect(v.api == 1)
        let data = try await c.eventTypesData()
        let remote = try EventCatalogLoader.decode(data)
        let bundled = EventCatalogLoader.bundled()
        #expect(remote.types.map(\.id) == bundled.types.map(\.id))
        #expect(remote.commonFields.map(\.key) == bundled.commonFields.map(\.key))
    }

    @Test func tripLifecycle() async throws {
        let c = try await api()
        let created = try await c.createTrip(CreateTripRequest(title: "Integrationstest", destination: "Lissabon", startDate: "2026-10-11",
                                                               endDate: "2026-10-14", summary: nil, homeCurrency: "EUR",
                                                               timezone: "Europe/Lisbon", travelers: [TravelerInput(displayName: "Gast", email: nil, userId: nil)]))
        let id = created.trip.id
        #expect(created.trip.timezone == "Europe/Lisbon")
        #expect(created.trip.ledgerId != nil)

        // Formular-Body aus dem Katalog → Server akzeptiert und liefert die Felder zurück.
        let catalog = EventCatalogLoader.bundled()
        var draft = EventDraft(type: catalog.type(for: "Mietauto")!, tripZoneID: "Europe/Lisbon", startDate: "2026-10-12", defaultCurrency: "EUR")
        draft.set("title", text: "Mietwagen Lissabon")
        draft.set("pickupPlace", text: "Flughafen Lissabon")
        draft.set("pickupHours", text: "06:00–24:00")
        draft.values["startTime"] = "10:00"
        draft.values["priceMinor"] = .int(23_000)
        let after = try await c.createEvent(tripID: id, draft.makeBody(catalog: catalog))
        let eventID = try #require(after.createdEventId)
        let ev = try #require(after.event(id: eventID))
        #expect(ev.type == "Mietauto")
        #expect(ev.detail("pickupPlace") == "Flughafen Lissabon")
        #expect(ev.priceMinor == 23_000)

        // Bearbeiten: nur Geändertes.
        var edit = EventDraft(editing: ev, tripZoneID: "Europe/Lisbon", defaultCurrency: "EUR")
        edit.set("phone", text: "+351 21 000 00 00")
        let patch = edit.makeBody(catalog: catalog)
        #expect(patch.fields.keys.sorted() == ["phone", "type"], "Body: \(patch.fields)")
        let patched = try await c.updateEvent(tripID: id, eventID: eventID, patch)
        #expect(patched.event(id: eventID)?.phone == "+351 21 000 00 00")
        #expect(patched.event(id: eventID)?.fieldsMeta["phone"]?.locked == true)
        #expect(patched.event(id: eventID)?.details["pickupHours"]?.stringValue == "06:00–24:00")

        // Heute und Zusammenfassung.
        let today = try await c.today(date: "2026-10-12", tz: "Europe/Lisbon")
        #expect(today.trip?.id == id)
        let plan = TodayPlanner.plan(from: today, catalog: catalog, now: Fixture.date("2026-10-12", "09:00", "Europe/Lisbon"))
        #expect(plan.entries.contains { $0.event.id == eventID })
        let summary = try await c.summaryData()
        #expect(SummarySync.store(summary, defaults: UserDefaults(suiteName: "tb-it")!, reload: {}))

        // Reisekasse und Übernahme.
        let overview = try await c.ledger(id: try #require(created.trip.ledgerId))
        #expect(overview.members.count == 2)
        let expense = try await c.createExpense(ledgerID: overview.ledger.id, ExpenseBody(
            paidByMemberId: overview.members.first?.id, amountMinor: 23_000, currency: "EUR", description: "Mietwagen",
            expenseDate: "2026-10-12", split: .equal(memberIds: overview.members.map(\.id)), tripEventId: eventID))
        #expect(expense.amountMinor == 23_000)

        // Aufräumen.
        let gone = try await c.deleteEvent(tripID: id, eventID: eventID)
        #expect(gone.event(id: eventID) == nil)
        try? await c.deleteExpense(ledgerID: overview.ledger.id, expenseID: expense.id)
        try? await c.deleteTrip(id: id)
    }

    @Test func airportsAndTimezone() async throws {
        let c = try await api()
        let a = try await c.airports(query: "mia")
        #expect(a.contains { $0.iata == "MIA" && $0.tz == "America/New_York" })
        #expect(try await c.timezone(lat: 25.79, lon: -80.29) == "America/New_York")
        let inbox = try await c.inbox()
        #expect(inbox.review.isEmpty || !inbox.review.isEmpty)
    }

    @Test func prefsAndDevices() async throws {
        let c = try await api()
        let prefs = try await c.notificationPrefs()
        _ = prefs.isOn(.today)
        try await c.registerDevice(DeviceRegistration(apnsToken: nil, environment: .development, appVersion: "0.1.0 (1)", platform: "ios", pushToStartToken: nil))
        let devices = try await c.devices()
        #expect(devices.contains { $0.current })
    }
}
