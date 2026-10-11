import Foundation

/// Die ganze Server-Schnittstelle der App hinter einem Protokoll. `APIClient` ist die echte Umsetzung,
/// `DemoAPI` liefert Beispieldaten (Vorschauen, Tests, Bildschirmfotos ohne Server).
protocol TravelAPI: Sendable {
    var baseURL: URL { get }

    // MARK: Anmeldung, Version
    func me() async throws -> User
    func logout() async throws
    func version() async throws -> ServerVersion

    // MARK: Katalog und Verzeichnisse
    /// Rohdaten von `GET /v1/meta/event-types` (inhaltsgleich zu `shared/event-types.json`).
    func eventTypesData() async throws -> Data
    func airports(query: String) async throws -> [Airport]
    func timezone(lat: Double, lon: Double) async throws -> String

    // MARK: Reisen
    func trips() async throws -> [TripSummary]
    func trip(id: Int) async throws -> TripDetail
    func createTrip(_ body: CreateTripRequest) async throws -> TripDetail
    func updateTrip(id: Int, _ body: UpdateTripRequest) async throws -> TripDetail
    func deleteTrip(id: Int) async throws
    func addTraveler(tripID: Int, _ input: TravelerInput) async throws -> TripDetail
    func removeTraveler(tripID: Int, travelerID: Int) async throws -> TripDetail
    func rotateTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail
    func revokeTravelerShare(tripID: Int, travelerID: Int) async throws -> TripDetail
    func userDirectory() async throws -> [DirectoryUser]
    func tripICS(tripID: Int) async throws -> (data: Data, filename: String)

    // MARK: Ereignisse
    func createEvent(tripID: Int, _ body: EventBody) async throws -> TripDetail
    func updateEvent(tripID: Int, eventID: Int, _ body: EventBody) async throws -> TripDetail
    func deleteEvent(tripID: Int, eventID: Int) async throws -> TripDetail
    func confirmEvent(tripID: Int, eventID: Int) async throws -> TripDetail
    func mergeEvent(tripID: Int, eventID: Int, into targetID: Int) async throws -> TripDetail
    /// `POST /v1/trips/:id/events/:eventId/documents { documentId }` (nur Admin).
    func attachDocument(tripID: Int, eventID: Int, documentID: Int) async throws
    func detachDocument(tripID: Int, eventID: Int, documentID: Int) async throws
    func addComment(tripID: Int, eventID: Int, body: String) async throws -> TripComment
    func deleteComment(tripID: Int, eventID: Int, commentID: Int) async throws

    // MARK: Heute, Zusammenfassung
    func today(date: String?, tz: String?) async throws -> TodayResponse
    /// `GET /v1/trips/:id/day/:date`: Tagesansicht in der Form von `/v1/today` (beliebiger Tag der Reise).
    func day(tripID: Int, date: String) async throws -> TodayResponse
    /// Rohdaten von `GET /v1/summary` (unverändert an die Widgets weitergereicht).
    func summaryData() async throws -> Data

    // MARK: Dokumente
    func inbox() async throws -> InboxResponse
    func document(id: Int) async throws -> TBDocument
    func documentFile(id: Int) async throws -> (data: Data, contentType: String?, filename: String?)
    func documentThumbnail(id: Int) async throws -> Data
    func analyzeDocument(id: Int) async throws -> TBDocument
    func deleteDocument(id: Int) async throws
    /// `progress` meldet 0…1 während des Hochladens (aus beliebigem Thread).
    func uploadDocument(tripID: Int, eventID: Int?, fileURL: URL, fileName: String, contentType: String,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> TBDocument
    func mediaImage(path: String) async throws -> Data

    // MARK: Reisekasse
    func ledger(id: Int) async throws -> LedgerOverview
    func expenses(ledgerID: Int) async throws -> [Expense]
    func settlements(ledgerID: Int) async throws -> [Settlement]
    func createExpense(ledgerID: Int, _ body: ExpenseBody) async throws -> Expense
    func updateExpense(ledgerID: Int, expenseID: Int, _ body: ExpenseBody) async throws -> Expense
    func deleteExpense(ledgerID: Int, expenseID: Int) async throws
    func createSettlement(ledgerID: Int, _ body: SettlementBody) async throws -> Settlement
    func deleteSettlement(ledgerID: Int, settlementID: Int) async throws
    func addMember(ledgerID: Int, displayName: String) async throws -> Member
    func removeMember(ledgerID: Int, memberID: Int) async throws
    func fxRate(from: String, to: String, date: String?) async throws -> FxRate

    // MARK: Konto, Push
    func registerDevice(_ registration: DeviceRegistration) async throws
    func notificationPrefs() async throws -> NotificationPrefs
    func updateNotificationPrefs(_ patch: NotificationPrefsPatch) async throws -> NotificationPrefs
    func devices() async throws -> [UserDevice]
    func revokeDevice(id: Int) async throws
    func changePassword(current: String, new: String) async throws
    func registerLiveActivity(id: String, _ registration: LiveActivityRegistration) async throws
    func unregisterLiveActivity(id: String) async throws
}

/// Anmeldung läuft ohne Token und ausserhalb des Protokolls.
enum Authenticator {
    static func login(baseURL: URL, username: String, password: String, deviceName: String?, platform: String?,
                      session: URLSession = APIClient.defaultSession()) async throws -> LoginResponse {
        let anonymous = APIClient(baseURL: baseURL, token: nil, session: session)
        return try await anonymous.send(.post, "/v1/auth/login", body: LoginRequest(
            username: username, password: password, deviceName: deviceName, platform: platform))
    }

    static func version(baseURL: URL, session: URLSession = APIClient.defaultSession()) async throws -> ServerVersion {
        try await APIClient(baseURL: baseURL, token: nil, session: session).version()
    }
}
