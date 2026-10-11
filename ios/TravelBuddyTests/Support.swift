import Foundation
@testable import TravelBuddy

enum Fixture {
    static var catalog: EventCatalog { EventCatalogLoader.bundled() }

    static func flight(id: Int = 1, date: String = "2026-10-25", time: String = "10:00", tz: String? = "Europe/Zurich") -> TripEvent {
        TripEvent(id: id, tripId: 1, type: "Flug", title: "Flug ZRH nach MIA", startDate: date, endDate: date,
                  startTime: time, endTime: "14:00", startTz: tz, endTz: "America/New_York",
                  bookingReference: "K7QM2D",
                  details: ["flightNumber": "LX 64", "departureAirport": "ZRH", "arrivalAirport": "MIA",
                            "departureTerminal": "2", "departureGate": "E24",
                            "passengers": .array([.object(["participantId": 1, "seat": "12C"]), .object(["participantId": 2, "seat": "12D"])])])
    }

    static func trip(start: String = "2026-10-23", end: String = "2026-11-20", tz: String = "Europe/Madrid") -> Trip {
        Trip(id: 1, title: "Ferien", status: .active, destination: "Florida", startDate: start, endDate: end,
             ledgerId: 11, homeCurrency: "CHF", timezone: tz)
    }

    static let people = [
        Traveler(id: 1, displayName: "Rolf", userId: 1),
        Traveler(id: 2, displayName: "Eliane"),
    ]

    static func date(_ iso: String, _ time: String, _ zone: String) -> Date {
        TripClock.instant(date: iso, time: time, zone: TimeZone(identifier: zone)!)!
    }
}

/// URLProtocol-Attrappe mit eigenem Zustand je Test-Suite.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> (Int, Data, [String: String]))?
    nonisolated(unsafe) static var requests: [URLRequest] = []
    nonisolated(unsafe) static var bodies: [Data] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var req = request
        var body = req.httpBody ?? Data()
        if body.isEmpty, let stream = req.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
            req.httpBody = body
        }
        Self.requests.append(req)
        Self.bodies.append(body)
        let (status, data, headers) = Self.handler?(req) ?? (500, Data(), [:])
        var fields = ["Content-Type": "application/json"]
        fields.merge(headers) { _, new in new }
        let response = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: fields)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        requests = []
        bodies = []
        return URLSession(configuration: config)
    }
}
