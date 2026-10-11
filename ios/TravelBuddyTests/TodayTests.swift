import Testing
import Foundation
@testable import TravelBuddy

@Suite("Heute")
struct TodayTests {
    let catalog = Fixture.catalog
    let zone = TimeZone(identifier: "Europe/Madrid")!

    private func detail() -> TripDetail {
        var hotel = TripEvent(id: 2, tripId: 1, type: "Hotel", title: "Hotel Negresco", startDate: "2026-10-23", endDate: "2026-10-25",
                              startTime: "15:00", endTime: "12:00", startTz: "Europe/Madrid", location: "Barcelona")
        hotel.details = ["accessCode": "4821#"]
        let ship = TripEvent(id: 3, tripId: 1, type: "Kreuzfahrt", title: "Legend", startDate: "2026-10-25", endDate: "2026-11-20",
                             startTime: "13:30", endTime: "07:00", startTz: "Europe/Madrid", endTz: "America/New_York",
                             details: ["cabin": "8042", "terminal": "Port Nou", "allAboard": "16:30"])
        let dinner = TripEvent(id: 4, tripId: 1, type: "Restaurant", title: "Tapas", startDate: "2026-10-25", startTime: "20:30", startTz: "Europe/Madrid")
        let tomorrow = TripEvent(id: 5, tripId: 1, type: "Ausflug", title: "Palma", startDate: "2026-10-26", startTime: "07:30", startTz: "Europe/Madrid")
        let task = TripEvent(id: 6, tripId: 1, type: "Aufgabe", title: "Check-in online", startDate: "2026-10-25")
        let stay = TripEvent(id: 7, tripId: 1, type: "Hotel", title: "Zwischenstopp", startDate: "2026-10-20", endDate: "2026-10-30")
        var cancel = TripEvent(id: 8, tripId: 1, type: "Mietauto", title: "Auto", startDate: "2026-11-10")
        cancel.cancelUntil = "2026-10-30"
        return TripDetail(trip: Fixture.trip(), travelers: Fixture.people, events: [hotel, ship, dinner, tomorrow, task, stay, cancel])
    }

    @Test("Aufbereitung: Beginn, Ende, laufend, Aufgaben, Fristen, Morgen")
    func plan() throws {
        let now = Fixture.date("2026-10-25", "10:00", "Europe/Madrid")
        let response = TodayPlanner.response(from: detail(), now: now)
        let plan = TodayPlanner.plan(from: response, catalog: catalog, now: now, isOffline: true)
        #expect(plan.date == "2026-10-25")
        #expect(plan.isOffline)
        // Check-out (Ende Hotel) 12:00, Einschiffung 13:30, Abendessen 20:30 in zeitlicher Reihenfolge.
        #expect(plan.entries.map(\.event.id) == [2, 3, 4])
        #expect(plan.entries.first?.role == .end)
        #expect(plan.entries.first?.time == "12:00")
        #expect(plan.ongoing.map(\.event.id) == [7])
        #expect(plan.next?.event.id == 2)
        #expect(plan.tomorrow.map(\.event.id) == [5])
        #expect(plan.tasks.map(\.eventId) == [6])
        #expect(plan.deadlines.map(\.eventId) == [8])
        #expect(plan.trip?.dayIndex == 3)
        #expect(plan.trip?.dayCount == 29)
    }

    @Test("Als Nächstes springt nach dem Check-out zur Einschiffung; Countdown und Ring")
    func nextAndCountdown() throws {
        let now = Fixture.date("2026-10-25", "12:30", "Europe/Madrid")
        let plan = TodayPlanner.plan(from: TodayPlanner.response(from: detail(), now: now), catalog: catalog, now: now)
        #expect(plan.next?.event.id == 3)
        let remaining = try #require(plan.remaining(at: now))
        #expect(remaining == 3600)
        let progress = plan.ringProgress(at: now)
        #expect(progress > 0 && progress < 1)
        // Kurz vor dem Ziel ist der Ring fast voll.
        let late = Fixture.date("2026-10-25", "13:29", "Europe/Madrid")
        #expect(plan.ringProgress(at: late) > 0.95)
    }

    @Test("Nach dem letzten Eintrag zeigt Als Nächstes den ersten von morgen")
    func nextTomorrow() {
        let now = Fixture.date("2026-10-25", "22:00", "Europe/Madrid")
        let plan = TodayPlanner.plan(from: TodayPlanner.response(from: detail(), now: now), catalog: catalog, now: now)
        #expect(plan.next?.event.id == 5)
    }

    @Test("Ereignisse anderer Personen erscheinen nicht")
    func participantFilter() {
        var d = detail()
        d.events[2].participantIds = [2]   // Abendessen nur für Eliane
        let now = Fixture.date("2026-10-25", "10:00", "Europe/Madrid")
        let r = TodayPlanner.response(from: d, now: now, myParticipantId: 1)
        #expect(!r.events.contains { $0.id == 4 })
    }

    @Test("Tag richtet sich nach der Reisezone, nicht nach dem Gerät")
    func dayInTripZone() {
        // 23:30 UTC am 25.10.: in Madrid schon der 26.
        let now = Date(timeIntervalSince1970: 1_792_971_000)
        let r = TodayPlanner.response(from: detail(), now: now)
        #expect(r.date == "2026-10-26")
    }

    @Test("Grosse Angaben je Typ")
    func facts() {
        let c = catalog
        let flight = EventFacts.big(for: Fixture.flight(), catalog: c, participantId: 2)
        #expect(flight.map(\.key).prefix(3) == ["departureTerminal", "departureGate", "seat"])
        #expect(flight.first { $0.key == "seat" }?.value == "12D")   // Sitz der Person
        #expect(flight.first { $0.key == "departureGate" }?.mono == true)

        let hotel = TripEvent(id: 1, type: "Hotel", title: "H", address: "Carrer 5", details: ["accessCode": "4821#", "checkInFrom": "15:00"])
        let h = EventFacts.big(for: hotel, catalog: c)
        #expect(h.map(\.key).prefix(2) == ["address", "accessCode"])

        let car = TripEvent(id: 1, type: "Mietauto", title: "A", details: ["pickupPlace": "Alamo", "pickupHours": "06:00–24:00", "emergencyPhone": "+1 800"])
        #expect(EventFacts.big(for: car, catalog: c).map(\.key).prefix(3) == ["pickupPlace", "pickupHours", "emergencyPhone"])

        let ship = TripEvent(id: 1, type: "Kreuzfahrt", title: "S", details: ["cabin": "8042", "terminal": "B", "allAboard": "16:30"])
        #expect(EventFacts.big(for: ship, catalog: c).map(\.key).prefix(3) == ["cabin", "terminal", "allAboard"])
    }

    @Test("Live-Activity-Inhalt aus dem Heute-Stand")
    func liveActivityContent() throws {
        var d = detail()
        d.events.append(Fixture.flight(id: 9, date: "2026-10-25", time: "14:00", tz: "Europe/Madrid"))
        let now = Fixture.date("2026-10-25", "12:30", "Europe/Madrid")
        let plan = TodayPlanner.plan(from: TodayPlanner.response(from: d, now: now), catalog: catalog, now: now)
        let built = try #require(LiveActivityContentBuilder.make(plan: plan, catalog: catalog, participantId: 1, now: now))
        #expect(built.attributes.tripId == 1)
        #expect(built.state.milestoneAt != nil)
        #expect(built.state.updatedAt == now.timeIntervalSince1970)
        // Nächster Eintrag ist die Einschiffung (13:30), danach der Flug 14:00.
        #expect(built.state.nextHeadline == "Flug ZRH nach MIA")
        #expect(built.attributes.deepLink.hasPrefix("travelbuddy://"))
        #expect(LiveActivityContentBuilder.make(plan: TodayPlan(trip: nil, date: "2026-10-25", zoneID: "Europe/Madrid"), catalog: catalog, participantId: nil, now: now) == nil)
    }
}
