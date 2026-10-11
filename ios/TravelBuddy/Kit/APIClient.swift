import Foundation

/// Dünner Client für `/v1` des TravelBuddy-Servers (Bearer-Token, JSON, Fehlerumschlag).
/// Unveränderlich und `Sendable`; bei Anmeldung/Abmeldung wird ein neuer Client erzeugt.
final class APIClient: TravelAPI, Sendable {
    let baseURL: URL
    private let token: String?
    private let session: URLSession
    /// Sitzung mit langen Zeitlimits für Aufrufe, die auf der Gegenseite dauern (KI-Analyse, Upload).
    private let longSession: URLSession
    private let onUnauthorized: (@Sendable () -> Void)?

    enum Method: String { case get = "GET", post = "POST", patch = "PATCH", delete = "DELETE", put = "PUT" }

    /// - Parameter onUnauthorized: Wird bei `401` einer authentifizierten Anfrage aufgerufen
    ///   (Token widerrufen/abgelaufen), der Aufrufer meldet daraufhin ab.
    init(baseURL: URL, token: String?, session: URLSession = APIClient.defaultSession(),
         longSession: URLSession? = nil, onUnauthorized: (@Sendable () -> Void)? = nil) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.longSession = longSession ?? session
        self.onUnauthorized = onUnauthorized
    }

    static func defaultSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["Accept": "application/json"]
        return URLSession(configuration: config)
    }

    /// Für langsame Aufgaben (Analyse, Upload bis 25 MB).
    static func longRunningSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["Accept": "application/json"]
        return URLSession(configuration: config)
    }

    // MARK: Transport

    func send<T: Decodable & Sendable>(_ method: Method, _ path: String, query: [URLQueryItem] = [],
                                       body: (any Encodable & Sendable)? = nil, longRunning: Bool = false) async throws -> T {
        let request = try makeRequest(method, path, query: query, body: body)
        let (data, _) = try await perform(request, longRunning: longRunning)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    func sendVoid(_ method: Method, _ path: String, query: [URLQueryItem] = [],
                  body: (any Encodable & Sendable)? = nil) async throws {
        let request = try makeRequest(method, path, query: query, body: body)
        _ = try await perform(request)
    }

    func rawData(_ path: String, query: [URLQueryItem] = [], accept: String = "*/*") async throws
        -> (data: Data, contentType: String?, filename: String?) {
        guard var request = makeRequest(path, method: Method.get.rawValue, query: query, jsonBody: nil) else {
            throw APIError.invalidServerURL
        }
        request.setValue(accept, forHTTPHeaderField: "Accept")
        let (data, http) = try await perform(request, longRunning: true)
        return (data, http.value(forHTTPHeaderField: "Content-Type"), Self.filename(from: http))
    }

    private func perform(_ request: URLRequest, longRunning: Bool = false) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await (longRunning ? longSession : session).data(for: request)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.network(Self.describe(error))
        }
        return try validate(data: data, response: response)
    }

    private func validate(data: Data, response: URLResponse) throws -> (Data, HTTPURLResponse) {
        guard let http = response as? HTTPURLResponse else { throw APIError.network("Keine HTTP-Antwort.") }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            if http.statusCode == 401, token != nil {
                onUnauthorized?()
                throw APIError.unauthorized(message: envelope?.error.message ?? "Bitte erneut anmelden.")
            }
            guard let envelope else { throw APIError.unexpectedStatus(http.statusCode) }
            throw APIError.server(status: http.statusCode, code: envelope.error.code, message: envelope.error.message)
        }
        return (data, http)
    }

    private static func filename(from response: HTTPURLResponse) -> String? {
        guard let header = response.value(forHTTPHeaderField: "Content-Disposition") else { return nil }
        if let range = header.range(of: "filename*=UTF-8''") {
            let rest = header[range.upperBound...].split(separator: ";").first.map(String.init) ?? ""
            if let decoded = rest.removingPercentEncoding, !decoded.isEmpty { return decoded }
        }
        if let range = header.range(of: "filename=\"") {
            let rest = header[range.upperBound...]
            if let end = rest.firstIndex(of: "\"") { return String(rest[..<end]) }
        }
        return nil
    }

    func makeRequest(_ path: String, method: String, query: [URLQueryItem] = [], jsonBody: Data? = nil) -> URLRequest? {
        guard var comps = URLComponents(string: baseURL.absoluteString + path) else { return nil }
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let jsonBody {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = jsonBody
        }
        return req
    }

    private func makeRequest(_ method: Method, _ path: String, query: [URLQueryItem],
                             body: (any Encodable & Sendable)?) throws -> URLRequest {
        var data: Data?
        if let body { data = try JSONEncoder().encode(AnyEncodable(body)) }
        guard let request = makeRequest(path, method: method.rawValue, query: query, jsonBody: data) else {
            throw APIError.invalidServerURL
        }
        return request
    }

    private static func describe(_ error: URLError) -> String {
        switch error.code {
        case .notConnectedToInternet: "Keine Internetverbindung."
        case .timedOut: "Zeitüberschreitung."
        case .cannotFindHost, .dnsLookupFailed: "Der Servername wurde nicht gefunden."
        case .cannotConnectToHost: "Verbindung zum Server abgelehnt."
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
            "Die sichere Verbindung (HTTPS) ist fehlgeschlagen."
        case .appTransportSecurityRequiresSecureConnection: "Unverschlüsselte Verbindungen sind nicht erlaubt."
        default: "Netzwerkfehler (\(error.code.rawValue))."
        }
    }

    // MARK: Anmeldung, Version

    func me() async throws -> User {
        let r: MeResponse = try await send(.get, "/v1/me")
        return r.user
    }

    func logout() async throws { try await sendVoid(.post, "/v1/auth/logout") }

    func version() async throws -> ServerVersion { try await send(.get, "/v1/version") }

    // MARK: Katalog

    func eventTypesData() async throws -> Data {
        try await rawData("/v1/meta/event-types", accept: "application/json").data
    }

    func airports(query: String) async throws -> [Airport] {
        let r: AirportsResponse = try await send(.get, "/v1/meta/airports", query: [URLQueryItem(name: "q", value: query)])
        return r.airports
    }

    func timezone(lat: Double, lon: Double) async throws -> String {
        let r: TimezoneResponse = try await send(.get, "/v1/meta/timezone", query: [
            URLQueryItem(name: "lat", value: String(lat)), URLQueryItem(name: "lon", value: String(lon)),
        ])
        return r.tz
    }

    // MARK: Reisen

    func trips() async throws -> [TripSummary] {
        let r: TripListResponse = try await send(.get, "/v1/trips")
        return r.trips
    }

    func trip(id: Int) async throws -> TripDetail { try await send(.get, "/v1/trips/\(id)") }

    func createTrip(_ body: CreateTripRequest) async throws -> TripDetail { try await send(.post, "/v1/trips", body: body) }

    func updateTrip(id: Int, _ body: UpdateTripRequest) async throws -> TripDetail {
        try await send(.patch, "/v1/trips/\(id)", body: body)
    }

    func deleteTrip(id: Int) async throws { try await sendVoid(.delete, "/v1/trips/\(id)") }

    func addTraveler(tripID: Int, _ input: TravelerInput) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/travelers", body: input)
    }

    func removeTraveler(tripID: Int, travelerID: Int) async throws -> TripDetail {
        try await send(.delete, "/v1/trips/\(tripID)/travelers/\(travelerID)")
    }

    func rotateTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/travelers/\(travelerID)/share/rotate")
    }

    func revokeTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/travelers/\(travelerID)/share/revoke")
    }

    func userDirectory() async throws -> [DirectoryUser] {
        let r: UserDirectoryResponse = try await send(.get, "/v1/users/directory")
        return r.users
    }

    func tripICS(tripID: Int) async throws -> (data: Data, filename: String) {
        let r = try await rawData("/v1/trips/\(tripID)/ics", accept: "text/calendar")
        return (r.data, r.filename ?? "reise.ics")
    }

    // MARK: Ereignisse

    func createEvent(tripID: Int, _ body: EventBody) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/events", body: body)
    }

    func updateEvent(tripID: Int, eventID: Int, _ body: EventBody) async throws -> TripDetail {
        try await send(.patch, "/v1/trips/\(tripID)/events/\(eventID)", body: body)
    }

    func deleteEvent(tripID: Int, eventID: Int) async throws -> TripDetail {
        try await send(.delete, "/v1/trips/\(tripID)/events/\(eventID)")
    }

    func confirmEvent(tripID: Int, eventID: Int) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/events/\(eventID)/confirm", body: EmptyBody())
    }

    func mergeEvent(tripID: Int, eventID: Int, into targetID: Int) async throws -> TripDetail {
        try await send(.post, "/v1/trips/\(tripID)/events/\(eventID)/merge", body: MergeBody(intoEventId: targetID))
    }

    func attachDocument(tripID: Int, eventID: Int, documentID: Int) async throws {
        try await sendVoid(.post, "/v1/trips/\(tripID)/events/\(eventID)/documents", body: AttachDocumentBody(documentId: documentID))
    }

    func detachDocument(tripID: Int, eventID: Int, documentID: Int) async throws {
        try await sendVoid(.delete, "/v1/trips/\(tripID)/events/\(eventID)/documents/\(documentID)")
    }

    func addComment(tripID: Int, eventID: Int, body: String) async throws -> TripComment {
        let r: TripCommentResponse = try await send(
            .post, "/v1/trips/\(tripID)/events/\(eventID)/comments", body: TripCommentBody(body: body))
        return r.comment
    }

    func deleteComment(tripID: Int, eventID: Int, commentID: Int) async throws {
        try await sendVoid(.delete, "/v1/trips/\(tripID)/events/\(eventID)/comments/\(commentID)")
    }

    // MARK: Heute

    func today(date: String?, tz: String?) async throws -> TodayResponse {
        var q: [URLQueryItem] = []
        if let date { q.append(URLQueryItem(name: "date", value: date)) }
        if let tz { q.append(URLQueryItem(name: "tz", value: tz)) }
        return try await send(.get, "/v1/today", query: q)
    }

    func day(tripID: Int, date: String) async throws -> TodayResponse {
        try await send(.get, "/v1/trips/\(tripID)/day/\(date)")
    }

    func summaryData() async throws -> Data { try await rawData("/v1/summary", accept: "application/json").data }

    // MARK: Dokumente

    func inbox() async throws -> InboxResponse { try await send(.get, "/v1/inbox") }

    func document(id: Int) async throws -> TBDocument {
        // Antwort: `{ document }` oder das Dokument selbst.
        let (data, _) = try await perform(try makeRequest(.get, "/v1/documents/\(id)", query: [], body: nil))
        return try Self.decodeDocument(data)
    }

    func documentFile(id: Int) async throws -> (data: Data, contentType: String?, filename: String?) {
        try await rawData("/v1/documents/\(id)/file")
    }

    func documentThumbnail(id: Int) async throws -> Data {
        try await rawData("/v1/documents/\(id)/thumbnail", accept: "image/*").data
    }

    func analyzeDocument(id: Int) async throws -> TBDocument {
        let request = try makeRequest(.post, "/v1/documents/\(id)/analyze", query: [], body: EmptyBody())
        let (data, _) = try await perform(request, longRunning: true)
        return try Self.decodeDocument(data)
    }

    func deleteDocument(id: Int) async throws { try await sendVoid(.delete, "/v1/documents/\(id)") }

    private static func decodeDocument(_ data: Data) throws -> TBDocument {
        let decoder = JSONDecoder()
        if let wrapped = try? decoder.decode(DocumentResponse.self, from: data) { return wrapped.document }
        do { return try decoder.decode(TBDocument.self, from: data) } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    func uploadDocument(tripID: Int, eventID: Int?, fileURL: URL, fileName: String, contentType: String,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> TBDocument {
        let boundary = "tb-" + UUID().uuidString
        // Multipart in eine Datei schreiben: grosse PDFs nicht im Speicher halten, Fortschritt je gesendetem Byte.
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString).multipart")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let out = try FileHandle(forWritingTo: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        func write(_ s: String) throws { try out.write(contentsOf: Data(s.utf8)) }
        if let eventID {
            try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"eventId\"\r\n\r\n\(eventID)\r\n")
        }
        let safeName = fileName.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(contentType)\r\n\r\n")
        let input = try FileHandle(forReadingFrom: fileURL)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 256 * 1024), !chunk.isEmpty { try out.write(contentsOf: chunk) }
        try write("\r\n--\(boundary)--\r\n")
        try out.close()

        guard var request = makeRequest("/v1/trips/\(tripID)/documents", method: Method.post.rawValue) else {
            throw APIError.invalidServerURL
        }
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let delegate = UploadProgressDelegate(progress)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await longSession.upload(for: request, fromFile: tmp, delegate: delegate)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.network(Self.describe(error))
        }
        let (body, _) = try validate(data: data, response: response)
        progress(1)
        return try Self.decodeDocument(body)
    }

    func mediaImage(path: String) async throws -> Data {
        guard MediaPath.isValid(path) else { throw APIError.invalidServerURL }
        return try await rawData(path, accept: "image/*").data
    }

    // MARK: Reisekasse

    func ledger(id: Int) async throws -> LedgerOverview { try await send(.get, "/v1/ledgers/\(id)") }

    func expenses(ledgerID: Int) async throws -> [Expense] {
        let r: ExpenseListResponse = try await send(.get, "/v1/ledgers/\(ledgerID)/expenses")
        return r.expenses
    }

    func settlements(ledgerID: Int) async throws -> [Settlement] {
        let r: SettlementListResponse = try await send(.get, "/v1/ledgers/\(ledgerID)/settlements")
        return r.settlements
    }

    func createExpense(ledgerID: Int, _ body: ExpenseBody) async throws -> Expense {
        let r: ExpenseResponse = try await send(.post, "/v1/ledgers/\(ledgerID)/expenses", body: body)
        return r.expense
    }

    func updateExpense(ledgerID: Int, expenseID: Int, _ body: ExpenseBody) async throws -> Expense {
        var patch = body
        patch.preSettled = nil
        let r: ExpenseResponse = try await send(.patch, "/v1/ledgers/\(ledgerID)/expenses/\(expenseID)", body: patch)
        return r.expense
    }

    func deleteExpense(ledgerID: Int, expenseID: Int) async throws {
        try await sendVoid(.delete, "/v1/ledgers/\(ledgerID)/expenses/\(expenseID)")
    }

    func createSettlement(ledgerID: Int, _ body: SettlementBody) async throws -> Settlement {
        let r: SettlementResponse = try await send(.post, "/v1/ledgers/\(ledgerID)/settlements", body: body)
        return r.settlement
    }

    func deleteSettlement(ledgerID: Int, settlementID: Int) async throws {
        try await sendVoid(.delete, "/v1/ledgers/\(ledgerID)/settlements/\(settlementID)")
    }

    func addMember(ledgerID: Int, displayName: String) async throws -> Member {
        let r: MemberResponse = try await send(.post, "/v1/ledgers/\(ledgerID)/members",
                                               body: AddMemberRequest(displayName: displayName))
        return r.member
    }

    func removeMember(ledgerID: Int, memberID: Int) async throws {
        try await sendVoid(.delete, "/v1/ledgers/\(ledgerID)/members/\(memberID)")
    }

    func fxRate(from: String, to: String, date: String?) async throws -> FxRate {
        var q = [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: to)]
        if let date { q.append(URLQueryItem(name: "date", value: date)) }
        return try await send(.get, "/v1/fx", query: q)
    }

    // MARK: Konto, Push

    func registerDevice(_ registration: DeviceRegistration) async throws {
        try await sendVoid(.put, "/v1/devices/current", body: registration)
    }

    func notificationPrefs() async throws -> NotificationPrefs {
        let r: NotificationPrefsResponse = try await send(.get, "/v1/me/notification-prefs")
        return NotificationPrefs(raw: r.prefs)
    }

    func updateNotificationPrefs(_ patch: NotificationPrefsPatch) async throws -> NotificationPrefs {
        let r: NotificationPrefsResponse = try await send(.put, "/v1/me/notification-prefs", body: patch)
        return NotificationPrefs(raw: r.prefs)
    }

    func devices() async throws -> [UserDevice] {
        let r: UserDevicesResponse = try await send(.get, "/v1/me/devices")
        return r.devices
    }

    func revokeDevice(id: Int) async throws { try await sendVoid(.delete, "/v1/me/devices/\(id)") }

    func changePassword(current: String, new: String) async throws {
        try await sendVoid(.post, "/v1/me/password", body: ChangePasswordRequest(currentPassword: current, newPassword: new))
    }

    func registerLiveActivity(id: String, _ registration: LiveActivityRegistration) async throws {
        try await sendVoid(.put, "/v1/live-activities/\(Self.pathComponent(id))", body: registration)
    }

    func unregisterLiveActivity(id: String) async throws {
        try await sendVoid(.delete, "/v1/live-activities/\(Self.pathComponent(id))")
    }

    private static func pathComponent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

/// Meldet den Fortschritt eines Uploads; gehört zu genau einer Aufgabe.
private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let handler: @Sendable (Double) -> Void
    init(_ handler: @escaping @Sendable (Double) -> Void) { self.handler = handler }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        handler(min(1, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }
}

// MARK: - Bilder aus /v1/media

enum MediaPath {
    /// Nur Pfade unter `/v1/media/` des eigenen Servers. Der Bearer-Token darf nie an einen fremden Host
    /// gehen: absolute URLs, `//host`, Rückwärtspfade und Steuerzeichen werden abgelehnt.
    static func isValid(_ path: String) -> Bool {
        guard path.hasPrefix("/v1/media/"), !path.hasPrefix("//") else { return false }
        guard !path.contains(".."), !path.contains("\\"), !path.contains("://"), !path.contains("@") else { return false }
        return path.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) && $0 != " " }
    }
}
