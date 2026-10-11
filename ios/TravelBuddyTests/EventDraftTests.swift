import Testing
import Foundation
@testable import TravelBuddy

@Suite("Ereignis-Formular aus dem Katalog")
struct EventDraftTests {
    let catalog = Fixture.catalog
    var flight: EventTypeDef { catalog.type(for: "Flug")! }

    private func newDraft(_ type: String = "Flug") -> EventDraft {
        EventDraft(type: catalog.type(for: type)!, tripZoneID: "Europe/Zurich", startDate: "2026-10-20")
    }

    @Test("Wichtiges zeigt weniger als Alle Felder, beides aus dem Katalog")
    func importantVsAll() {
        let d = newDraft()
        let important = d.sections(catalog: catalog, showAll: false).flatMap(\.fields).map(\.key)
        let all = d.sections(catalog: catalog, showAll: true).flatMap(\.fields).map(\.key)
        #expect(important.count < all.count)
        #expect(important.contains("departureGate"))
        #expect(!important.contains("aircraftReg"))
        #expect(all.contains("aircraftReg"))
        // Jedes wichtige Feld ist auch in «Alle Felder» enthalten.
        #expect(Set(important).isSubset(of: Set(all)))
    }

    @Test("Ausgefüllte Felder bleiben auch unter «Wichtiges» sichtbar")
    func filledFieldsStayVisible() {
        var d = newDraft()
        d.values["aircraftReg"] = "HB-JNA"
        let important = d.sections(catalog: catalog, showAll: false).flatMap(\.fields).map(\.key)
        #expect(important.contains("aircraftReg"))
    }

    @Test("Zeitzonenfelder behalten die IANA-Auswahl auch nach der Umbeschriftung")
    func zoneFieldsStayZonePickers() {
        let fields = newDraft().sections(catalog: catalog, showAll: true).flatMap(\.fields)
        #expect(fields.first { $0.key == "startTz" }?.optionsAreZones == true)
        #expect(fields.first { $0.key == "endTz" }?.optionsAreZones == true)
        #expect(fields.first { $0.key == "startTz" }?.label == "Zeitzone Abflug")
    }

    @Test("Beginn und Ende tragen die Beschriftung des Typs")
    func typeSpecificLabels() {
        let d = newDraft("Mietauto")
        let time = d.sections(catalog: catalog, showAll: true).first { $0.id == "time" }!
        #expect(time.fields.first { $0.key == "startDate" }?.label == "Abholung")
        #expect(time.fields.first { $0.key == "endDate" }?.label == "Rückgabe")
        // Aufgabe hat kein Ende.
        let task = newDraft("Aufgabe").sections(catalog: catalog, showAll: true).first { $0.id == "time" }!
        #expect(!task.fields.contains { $0.key == "endDate" })
    }

    @Test("Neu: nur gefüllte Felder, Reisezone wird nicht mitgeschickt")
    func createBody() {
        var d = newDraft()
        d.set("title", text: "Flug nach Miami")
        d.set("bookingReference", text: "k7qm2d", field: catalog.commonFields.first { $0.key == "bookingReference" })
        d.set("flightNumber", text: "lx 64", field: catalog.field(key: "flightNumber", in: flight))
        d.applyAirport(key: "departureAirport", airport: Airport(iata: "ZRH", name: "Zürich", city: nil, country: nil, lat: nil, lon: nil, tz: "Europe/Zurich"))
        d.applyAirport(key: "arrivalAirport", airport: Airport(iata: "MIA", name: "Miami", city: nil, country: nil, lat: nil, lon: nil, tz: "America/New_York"))
        let body = d.makeBody(catalog: catalog).fields
        #expect(body["type"] == "Flug")
        #expect(body["title"] == "Flug nach Miami")
        #expect(body["bookingReference"] == "K7QM2D")           // transform: upper
        #expect(body["startTz"] == nil)                          // = Reisezone
        #expect(body["endTz"] == "America/New_York")             // Zone der Ankunft
        #expect(body["startDate"] == "2026-10-20")
        #expect(body["details"]?.objectValue?["flightNumber"] == "LX 64")
        #expect(body["details"]?.objectValue?["departureAirport"] == "ZRH")
        #expect(body["currency"] == nil)                         // ohne Preis keine Währung
        #expect(body["notes"] == nil)
    }

    @Test("Bearbeiten: nur Geändertes, Geleertes als null, details vollständig")
    func patchBody() {
        let e = Fixture.flight()
        var d = EventDraft(editing: e, tripZoneID: "Europe/Zurich")
        #expect(d.makeBody(catalog: catalog).fields == ["type": "Flug"])   // nichts geändert
        d.set("title", text: "Neuer Titel")
        d.set("startTime", text: "")
        d.set("departureGate", text: "E30")
        let body = d.makeBody(catalog: catalog).fields
        #expect(body["title"] == "Neuer Titel")
        #expect(body["startTime"] == .null)
        #expect(body["bookingReference"] == nil)                  // unverändert, kein Sperren
        let details = body["details"]?.objectValue
        #expect(details?["departureGate"] == "E30")
        #expect(details?["flightNumber"] == "LX 64")              // vollständiges Objekt
        #expect(details?["passengers"]?.arrayValue?.count == 2)
    }

    @Test("Änderung der Adresse verwirft alte Koordinaten")
    func addressClearsCoordinates() {
        var e = Fixture.flight()
        e.address = "Alte Strasse 1"; e.lat = 47.0; e.lon = 8.0
        var d = EventDraft(editing: e, tripZoneID: "Europe/Zurich")
        d.set("address", text: "Neue Strasse 2")
        let body = d.makeBody(catalog: catalog).fields
        #expect(body["address"] == "Neue Strasse 2")
        #expect(body["lat"] == .null)
        #expect(body["lon"] == .null)
    }

    @Test("Mitreisende und Sitze je Person")
    func passengers() {
        var d = newDraft()
        d.setPassenger(participantID: 2, key: "seat", text: "12D")
        d.setPassenger(participantID: 1, key: "seat", text: "12C")
        #expect(d.passengerValue(participantID: 1, key: "seat") == "12C")
        #expect(d.passengers.map { $0["participantId"]?.intValue } == [1, 2])
        d.setPassenger(participantID: 1, key: "seat", text: "")
        #expect(d.passengers.count == 1)
        d.setParticipants([3, 1])
        #expect(d.participantIDs == [1, 3])
        d.setParticipants([])
        #expect(d.values["participantIds"] == nil)
    }

    @Test("Prüfung: Titel, Ende vor Beginn über Zeitzonen")
    func validation() {
        var d = newDraft()
        #expect(d.issues(catalog: catalog) == [.titleMissing])
        d.set("title", text: "X")
        #expect(d.isValid(catalog: catalog))
        d.values["startTime"] = "10:00"; d.values["startTz"] = "Europe/Zurich"
        d.values["endDate"] = "2026-10-20"; d.values["endTime"] = "14:00"; d.values["endTz"] = "America/New_York"
        // 10:00 Zürich → 14:00 Miami ist gültig (10 Stunden), auch wenn die Wanduhr «später» aussieht.
        #expect(d.isValid(catalog: catalog))
        #expect(d.computedDurationMinutes == 600)
        d.values["endTime"] = "02:00"
        #expect(d.issues(catalog: catalog).contains(.endBeforeStart))
    }

    @Test("Preis und Währung")
    func price() {
        var d = newDraft("Hotel")
        d.set("title", text: "Hotel")
        d.values["priceMinor"] = .int(118_000)
        d.values["currency"] = "EUR"
        d.values["paymentStatus"] = "deposit"
        let body = d.makeBody(catalog: catalog).fields
        #expect(body["priceMinor"] == 118_000)
        #expect(body["currency"] == "EUR")
        #expect(body["paymentStatus"] == "deposit")
    }

    @Test("Typwechsel verwirft Typ-Felder, behält gemeinsame")
    func changeType() {
        var d = newDraft()
        d.set("title", text: "Mein Titel")
        d.values["flightNumber"] = "LX 1"
        d.changeType(to: catalog.type(for: "Hotel")!, catalog: catalog)
        #expect(d.string("title") == "Mein Titel")
        #expect(d.values["flightNumber"] == nil)
        #expect(d.typeID == "Hotel")
    }
}
