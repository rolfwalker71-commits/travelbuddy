import Foundation
import Observation

/// Ablage der Anmeldung: Token im gemeinsamen Schlüsselbund, Server-URL in der App-Group (`SharedSession`).
protocol SessionStoring: Sendable {
    func load() -> SharedSession.Credentials?
    func save(_ credentials: SharedSession.Credentials)
    func clear()
}

struct SharedSessionStore: SessionStoring {
    func load() -> SharedSession.Credentials? { SharedSession.load() }
    func save(_ credentials: SharedSession.Credentials) { SharedSession.save(credentials) }
    func clear() { SharedSession.clear() }
}

/// Sitzung der App: Server-Adresse, Anmeldung, Token. Erzeugt nach der Anmeldung den `TravelStore`.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case launching, signedOut, signedIn }

    private(set) var phase: Phase = .launching
    private(set) var user: User?
    private(set) var api: (any TravelAPI)?
    private(set) var store: TravelStore?
    private(set) var serverVersion: ServerVersion?
    /// Hinweis auf der Anmeldeseite (z. B. «Sitzung abgelaufen»).
    var notice: String?
    private(set) var serverURLText: String
    private(set) var isDemo = false

    private let sessions: any SessionStoring
    private let defaults: UserDefaults
    private let push: PushService
    private let liveActivities: LiveActivityManager
    private let makeAPI: (URL, String?, @escaping @Sendable () -> Void) -> any TravelAPI
    private enum Keys {
        static let serverURL = "serverURL"
        static let cachedUser = "cachedUser"
    }

    init(sessions: any SessionStoring = SharedSessionStore(),
         defaults: UserDefaults = .standard,
         push: PushService? = nil,
         liveActivities: LiveActivityManager? = nil,
         makeAPI: @escaping (URL, String?, @escaping @Sendable () -> Void) -> any TravelAPI = { url, token, unauthorized in
             APIClient(baseURL: url, token: token, longSession: APIClient.longRunningSession(), onUnauthorized: unauthorized)
         }) {
        self.sessions = sessions
        self.defaults = defaults
        self.push = push ?? PushService.shared
        self.liveActivities = liveActivities ?? LiveActivityManager.shared
        self.makeAPI = makeAPI
        #if DEBUG
        let fallback = "http://localhost:7780"
        #else
        let fallback = ""
        #endif
        serverURLText = defaults.string(forKey: Keys.serverURL) ?? SharedConfig.defaults.string(forKey: SharedConfig.Key.serverURL) ?? fallback
    }

    // MARK: Start

    func restore() async {
        guard phase == .launching else { return }
        guard let creds = sessions.load() else {
            phase = .signedOut
            return
        }
        serverURLText = creds.serverURL.absoluteString
        let api = makeAPI(creds.serverURL, creds.token) { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        if let data = defaults.data(forKey: Keys.cachedUser), let cached = try? JSONDecoder().decode(User.self, from: data) {
            // Sofort anzeigen; ohne Netz bleibt die App mit dem Zwischenspeicher nutzbar.
            beginSession(api: api, user: cached, url: creds.serverURL)
        }
        do {
            let fresh = try await api.me()
            remember(user: fresh)
            if phase != .signedIn { beginSession(api: api, user: fresh, url: creds.serverURL) }
            else { user = fresh }
        } catch let error as APIError {
            if case .unauthorized = error { return }   // handleUnauthorized hat bereits abgemeldet
            if phase != .signedIn { phase = .signedOut; notice = error.userMessage }
        } catch {
            if phase != .signedIn { phase = .signedOut }
        }
        await loadServerVersion()
    }

    func login(serverURLText input: String, username: String, password: String) async throws {
        guard let url = ServerURL.normalize(input) else { throw APIError.invalidServerURL }
        let response = try await Authenticator.login(
            baseURL: url, username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password,
            deviceName: DeviceInfo.name, platform: DeviceInfo.platform)
        // Token und Server-URL für App und Erweiterungen ablegen.
        sessions.save(.init(serverURL: url, token: response.token))
        serverURLText = url.absoluteString
        defaults.set(serverURLText, forKey: Keys.serverURL)
        remember(user: response.user)
        let api = makeAPI(url, response.token) { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        notice = nil
        beginSession(api: api, user: response.user, url: url)
        await loadServerVersion()
    }

    func logout() async {
        if let api {
            await push.unregisterFromServer(using: api)
            try? await api.logout()
        }
        endSession(notice: nil)
    }

    /// Vorführmodus (Debug): Beispieldaten ohne Server und ohne Schlüsselbund.
    func startDemo(now: Date = Date()) async {
        let data = (try? Data(contentsOf: Bundle.main.url(forResource: "event-types", withExtension: "json")!)) ?? Data()
        let api = DemoAPI(now: now, catalogData: data)
        isDemo = true
        serverVersion = ServerVersion(name: "TravelBuddy", version: DeviceInfo.appVersion, build: "demo", builtAt: nil, api: 1)
        beginSession(api: api, user: DemoAPI.user, url: api.baseURL, scope: "demo", attachPush: false)
    }

    // MARK: Intern

    private func beginSession(api: any TravelAPI, user: User, url: URL, scope: String? = nil, attachPush: Bool = true) {
        self.api = api
        self.user = user
        let scope = scope ?? "\(url.host() ?? "server")-\(user.id)"
        let store = TravelStore(api: api, user: user, cache: OfflineStore(scope: scope))
        self.store = store
        phase = .signedIn
        if attachPush {
            push.attach(api: api)
            liveActivities.attach(api: api)
        }
    }

    private func handleUnauthorized() {
        guard phase != .signedOut else { return }
        endSession(notice: "Deine Sitzung ist abgelaufen oder wurde beendet. Bitte melde dich erneut an.")
    }

    private func endSession(notice: String?) {
        sessions.clear()
        defaults.removeObject(forKey: Keys.cachedUser)
        store?.clearLocalData()
        SummarySync.clear()
        push.detach()
        liveActivities.detach(endActivities: true)
        api = nil
        store = nil
        user = nil
        isDemo = false
        self.notice = notice
        phase = .signedOut
    }

    private func remember(user: User) {
        if let data = try? JSONEncoder().encode(user) { defaults.set(data, forKey: Keys.cachedUser) }
    }

    func loadServerVersion() async {
        guard !isDemo, let url = ServerURL.normalize(serverURLText) else { return }
        serverVersion = try? await Authenticator.version(baseURL: url)
    }
}
