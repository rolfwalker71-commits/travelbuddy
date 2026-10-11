import Foundation

/// Kleiner API-Client für Erweiterungen: Bearer-Token aus `SharedSession`, kurze Zeitlimits, deutsche Fehlertexte.
/// Format: JSON camelCase, Fehler `{ "error": { "code", "message" } }` (Vertrag «Konventionen»).
struct SharedAPI {
    enum Failure: Error, Equatable {
        case notSignedIn
        case unauthorized
        case http(status: Int, code: String?, message: String?)
        case network(String)
        case invalidResponse

        /// Verständlicher Grund für die Oberfläche.
        var userMessage: String {
            switch self {
            case .notSignedIn:
                return "Du bist nicht angemeldet. Öffne TravelBuddy und melde dich an."
            case .unauthorized:
                return "Die Anmeldung ist abgelaufen. Melde dich in TravelBuddy neu an."
            case .http(let status, _, let message):
                if let message, !message.isEmpty { return message }
                switch status {
                case 413: return "Die Datei ist zu gross (höchstens 25 MB)."
                case 415, 422: return "Dieser Dateityp wird nicht unterstützt."
                case 429: return "Zu viele Anfragen. Versuche es in einer Minute erneut."
                case 500...599: return "Der Server hat ein Problem. Versuche es später erneut."
                default: return "Der Server hat die Anfrage abgelehnt (Status \(status))."
                }
            case .network(let text):
                return text
            case .invalidResponse:
                return "Die Antwort des Servers war unerwartet."
            }
        }

        var isAuthProblem: Bool { self == .notSignedIn || self == .unauthorized }
    }

    let credentials: SharedSession.Credentials
    let session: URLSession

    /// Kurze Zeitlimits: Widgets haben nur wenige Sekunden, Mitteilungs-Erweiterungen rund 30.
    static func shortSession(request: TimeInterval = 8, resource: TimeInterval = 12) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = request
        config.timeoutIntervalForResource = resource
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config)
    }

    /// `nil`, wenn keine Anmeldung geteilt ist (App noch nicht angemeldet).
    init?(session: URLSession = SharedAPI.shortSession()) {
        guard let credentials = SharedSession.load() else { return nil }
        self.credentials = credentials
        self.session = session
    }

    init(credentials: SharedSession.Credentials, session: URLSession = SharedAPI.shortSession()) {
        self.credentials = credentials
        self.session = session
    }

    // MARK: Anfragen

    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var comps = URLComponents(url: credentials.serverURL, resolvingAgainstBaseURL: false)
        let basePath = comps?.path ?? ""
        let trimmedBase = basePath.hasSuffix("/") ? String(basePath.dropLast()) : basePath
        comps?.path = trimmedBase + (path.hasPrefix("/") ? path : "/" + path)
        comps?.queryItems = query.isEmpty ? nil : query
        return comps?.url ?? credentials.serverURL
    }

    func request(_ path: String, method: String = "GET", query: [URLQueryItem] = [],
                 accept: String = "application/json") -> URLRequest {
        var r = URLRequest(url: url(path, query: query))
        r.httpMethod = method
        r.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        r.setValue(accept, forHTTPHeaderField: "Accept")
        return r
    }

    /// Rohdaten einer GET-Anfrage.
    func data(_ path: String, query: [URLQueryItem] = [], accept: String = "application/json") async throws -> (Data, HTTPURLResponse) {
        let req = request(path, query: query, accept: accept)
        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw Failure.invalidResponse }
            try Self.check(http, data: data)
            return (data, http)
        } catch let failure as Failure {
            throw failure
        } catch let error as URLError {
            throw Failure.network(Self.describe(error))
        } catch {
            throw Failure.network("Keine Verbindung zum Server.")
        }
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        let (data, _) = try await self.data(path, query: query)
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw Failure.invalidResponse }
    }

    // MARK: Fachliche Aufrufe

    /// `GET /v1/summary`; `tripId` ist ein optionaler Wunsch an den Server (unbekannte Parameter werden ignoriert).
    func summary(tripId: Int? = nil) async throws -> (summary: SharedSummary, raw: Data) {
        let query = tripId.map { [URLQueryItem(name: "tripId", value: String($0))] } ?? []
        let (data, _) = try await self.data("/v1/summary", query: query)
        guard let summary = SharedSummary.decode(data) else { throw Failure.invalidResponse }
        return (summary, data)
    }

    func trips() async throws -> [SharedSummary.Trip] {
        let list: SharedTripList = try await get("/v1/trips")
        return list.trips
    }

    func tripDetail(id: Int) async throws -> SharedTripDetail {
        try await get("/v1/trips/\(id)")
    }

    /// Mitteilungsbild: `GET /v1/media/notification/<imageKey>` (PNG 600×300).
    func notificationImage(key: String) async throws -> Data {
        let safe = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
        let (data, http) = try await self.data("/v1/media/notification/\(safe)", accept: "image/png,image/*")
        guard http.statusCode == 200, !data.isEmpty else { throw Failure.invalidResponse }
        return data
    }

    // MARK: Fehler

    static func check(_ http: HTTPURLResponse, data: Data) throws {
        guard !(200..<300).contains(http.statusCode) else { return }
        if http.statusCode == 401 { throw Failure.unauthorized }
        struct Body: Decodable { struct Err: Decodable { let code: String?; let message: String? }; let error: Err? }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        throw Failure.http(status: http.statusCode, code: body?.error?.code, message: body?.error?.message)
    }

    static func describe(_ error: URLError) -> String {
        switch error.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff:
            "Keine Internetverbindung."
        case .timedOut:
            "Der Server antwortet nicht rechtzeitig."
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .networkConnectionLost:
            "Der Server ist nicht erreichbar."
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate:
            "Die sichere Verbindung zum Server ist fehlgeschlagen."
        default:
            "Netzwerkfehler. Versuche es erneut."
        }
    }
}

// MARK: - Multipart-Upload (Datei auf Platte, ohne sie in den Speicher zu laden)

enum SharedMultipart {
    /// Schreibt einen `multipart/form-data`-Körper mit Feld `file` (und optionalen Textfeldern) in eine Datei.
    /// Die Quelle wird in Blöcken kopiert; geeignet für Hintergrund-`uploadTask(with:fromFile:)`.
    static func writeBody(boundary: String, fileURL: URL, fileName: String, mimeType: String,
                          fields: [String: String] = [:], to destination: URL) throws {
        let manager = FileManager.default
        try? manager.removeItem(at: destination)
        guard manager.createFile(atPath: destination.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let out = try FileHandle(forWritingTo: destination)
        defer { try? out.close() }

        func write(_ string: String) throws { try out.write(contentsOf: Data(string.utf8)) }

        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        let safeName = fileName
            .replacingOccurrences(of: "\"", with: "'")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        try write("Content-Type: \(mimeType)\r\n\r\n")

        let input = try FileHandle(forReadingFrom: fileURL)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 256 * 1024), !chunk.isEmpty {
            try out.write(contentsOf: chunk)
        }
        try write("\r\n--\(boundary)--\r\n")
    }
}
