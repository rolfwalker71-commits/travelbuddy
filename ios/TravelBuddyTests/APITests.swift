import Testing
import Foundation
@testable import TravelBuddy

@Suite("API-Client", .serialized)
struct APIClientTests {
    private func client(token: String? = "tb_test", onUnauthorized: (@Sendable () -> Void)? = nil) -> APIClient {
        APIClient(baseURL: URL(string: "http://localhost:7780")!, token: token, session: StubURLProtocol.session(), onUnauthorized: onUnauthorized)
    }

    private let tripJSON = """
    {"trip":{"id":7,"title":"Ferien","status":"active","destination":"Florida","startDate":"2026-10-23","endDate":"2026-11-20",
             "ledgerId":11,"homeCurrency":"CHF","timezone":"Europe/Madrid","coverUrl":null,"needsReviewCount":1,"phase":"active"},
     "travelers":[{"id":1,"displayName":"Rolf","userId":1,"coupleId":3,"colorIndex":2}],
     "events":[{"id":5,"tripId":7,"type":"Flug","title":"Flug","startDate":"2026-10-25","startTime":"10:00","startTz":"Europe/Zurich",
                "endTz":"America/New_York","status":"needs_review","participantIds":[1],"priceMinor":41200,"currency":"CHF",
                "paymentStatus":"paid","fieldsMeta":{"flightNumber":{"source":"document","confidence":0.9,"documentId":4,"page":1,"quote":"LX 64"},
                "title":{"source":"manual","locked":true}},
                "details":{"flightNumber":"LX 64","passengers":[{"participantId":1,"seat":"12C"}],"durationMinutes":600},
                "places":[{"role":"start","label":"ZRH","address":"Flughafenstrasse","lat":47.46,"lon":8.55}],
                "documents":[{"id":4,"title":"Bordkarte","fileName":"b.pdf","contentType":"application/pdf","sizeBytes":1000,"analysisStatus":"done"}],
                "documentIds":[4]}]}
    """

    @Test func decodesTripWithContractExtensions() async throws {
        let json = tripJSON
        StubURLProtocol.handler = { _ in (200, Data(json.utf8), [:]) }
        let d = try await client().trip(id: 7)
        #expect(d.trip.timezone == "Europe/Madrid")
        #expect(d.trip.needsReviewCount == 1)
        #expect(d.travelers[0].coupleId == 3 && d.travelers[0].colorIndex == 2)
        let e = try #require(d.events.first)
        #expect(e.status == .needsReview)
        #expect(e.endTz == "America/New_York")
        #expect(e.paymentStatus == .paid && e.priceMinor == 41_200)
        #expect(e.fieldsMeta["flightNumber"]?.isFromDocument == true)
        #expect(e.fieldsMeta["title"]?.locked == true)
        #expect(e.details["durationMinutes"]?.intValue == 600)
        #expect(e.resolvedPlaces.first?.lat == 47.46)
        #expect(e.documents.first?.analysisStatus == .done)
        let req = try #require(StubURLProtocol.requests.last)
        #expect(req.url?.path == "/v1/trips/7")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer tb_test")
    }

    @Test func tripListToleratesLegacyPhase() async throws {
        let json = """
        {"trips":[{"id":1,"title":"A","status":"planned","startDate":"2026-12-20","endDate":"2026-12-28","phase":"current"},
                  {"id":2,"title":"B","status":"planned","phase":"upcoming"}]}
        """
        StubURLProtocol.handler = { _ in (200, Data(json.utf8), [:]) }
        let trips = try await client().trips()
        #expect(trips[0].phase == .active)
        #expect(trips[1].phase == .upcoming)
    }

    @Test func patchSendsOnlyGivenFieldsAndNull() async throws {
        let json = tripJSON
        StubURLProtocol.handler = { _ in (200, Data(json.utf8), [:]) }
        _ = try await client().updateEvent(tripID: 7, eventID: 5, EventBody(["title": "Neu", "startTime": .null]))
        let req = try #require(StubURLProtocol.requests.last)
        #expect(req.httpMethod == "PATCH")
        #expect(req.url?.path == "/v1/trips/7/events/5")
        let body = try #require(try JSONSerialization.jsonObject(with: StubURLProtocol.bodies.last!) as? [String: Any])
        #expect(body.count == 2)
        #expect(body["title"] as? String == "Neu")
        #expect(body["startTime"] is NSNull)
    }

    @Test func mergeAndConfirmRoutes() async throws {
        let json = tripJSON
        StubURLProtocol.handler = { _ in (200, Data(json.utf8), [:]) }
        let c = client()
        _ = try await c.confirmEvent(tripID: 7, eventID: 5)
        #expect(StubURLProtocol.requests.last?.url?.path == "/v1/trips/7/events/5/confirm")
        _ = try await c.mergeEvent(tripID: 7, eventID: 5, into: 3)
        #expect(StubURLProtocol.requests.last?.url?.path == "/v1/trips/7/events/5/merge")
        let body = try #require(try JSONSerialization.jsonObject(with: StubURLProtocol.bodies.last!) as? [String: Any])
        #expect(body["intoEventId"] as? Int == 3)
    }

    @Test func todayQuery() async throws {
        StubURLProtocol.handler = { _ in (200, Data("{\"generatedAt\":\"2026-10-25T10:00:00Z\",\"trip\":null,\"date\":\"2026-10-25\",\"events\":[],\"tomorrow\":[],\"tasks\":[],\"deadlines\":[],\"review\":2,\"upcoming\":{\"id\":3,\"title\":\"X\",\"startDate\":\"2026-12-01\",\"daysUntil\":40}}".utf8), [:]) }
        let t = try await client().today(date: "2026-10-25", tz: "Europe/Zurich")
        #expect(t.trip == nil)
        #expect(t.upcoming?.daysUntil == 40)
        #expect(t.review == 2)
        let comps = URLComponents(url: StubURLProtocol.requests.last!.url!, resolvingAgainstBaseURL: false)!
        #expect(comps.path == "/v1/today")
        #expect(comps.queryItems?.contains { $0.name == "tz" && $0.value == "Europe/Zurich" } == true)
    }

    @Test func errorEnvelopeAndUnauthorized() async throws {
        StubURLProtocol.handler = { _ in (422, Data("{\"error\":{\"code\":\"invalid_details\",\"message\":\"Unbekanntes Feld.\"}}".utf8), [:]) }
        do {
            _ = try await client().createEvent(tripID: 1, EventBody(["title": "x"]))
            Issue.record("Fehler erwartet")
        } catch let e as APIError {
            #expect(e.code == "invalid_details")
            #expect(e.userMessage == "Unbekanntes Feld.")
        }
        let flag = Flag()
        StubURLProtocol.handler = { _ in (401, Data("{\"error\":{\"code\":\"unauthorized\",\"message\":\"Bitte erneut anmelden.\"}}".utf8), [:]) }
        do {
            _ = try await client(onUnauthorized: { flag.set() }).me()
            Issue.record("Fehler erwartet")
        } catch {
            #expect(flag.isSet)
        }
    }

    @Test func uploadIsMultipartWithEventId() async throws {
        StubURLProtocol.handler = { _ in (202, Data("{\"document\":{\"id\":9,\"title\":\"b.pdf\",\"fileName\":\"b.pdf\",\"analysisStatus\":\"pending\"}}".utf8), [:]) }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("up-\(UUID().uuidString).pdf")
        try Data("%PDF-1.4 test".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let progress = Flag()
        let doc = try await client().uploadDocument(tripID: 7, eventID: 5, fileURL: file, fileName: "b.pdf", contentType: "application/pdf",
                                                    progress: { if $0 >= 1 { progress.set() } })
        #expect(doc.id == 9)
        #expect(progress.isSet)
        let req = try #require(StubURLProtocol.requests.last)
        #expect(req.url?.path == "/v1/trips/7/documents")
        #expect(req.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = String(decoding: StubURLProtocol.bodies.last ?? Data(), as: UTF8.self)
        #expect(body.contains("name=\"eventId\""))
        #expect(body.contains("name=\"file\"; filename=\"b.pdf\""))
        #expect(body.contains("%PDF-1.4 test"))
    }

    @Test func deviceRegistrationIncludesPushToStartToken() throws {
        let reg = DeviceRegistration(apnsToken: nil, environment: .development, appVersion: "0.1.0 (1)", platform: "ios", pushToStartToken: "abcd")
        let data = try JSONEncoder().encode(reg)
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(obj["apnsToken"] is NSNull)
        #expect(obj["pushToStartToken"] as? String == "abcd")
        #expect(obj["platform"] as? String == "ios")
    }

    @Test func mediaPathGuard() {
        #expect(MediaPath.isValid("/v1/media/trip_cover/3?v=1"))
        #expect(!MediaPath.isValid("https://evil.example/v1/media/x"))
        #expect(!MediaPath.isValid("/v1/media/../etc"))
        #expect(!MediaPath.isValid("//evil/v1/media/x"))
    }

    @Test func serverURLRules() {
        #expect(ServerURL.normalize("travelbuddy.example.ch")?.absoluteString == "https://travelbuddy.example.ch")
        #expect(ServerURL.normalize("localhost:7780")?.absoluteString == "http://localhost:7780")
        #expect(ServerURL.normalize("http://travelbuddy.example.ch") == nil)
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.lock(); value = true; lock.unlock() }
    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
}
