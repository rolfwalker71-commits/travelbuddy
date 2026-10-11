import Foundation

// Konto: Anmeldung, Geräte, Push, Mitteilungs-Einstellungen, Version (docs/CONTRACT.md).

struct LoginRequest: Encodable, Sendable {
    let username: String
    let password: String
    let deviceName: String?
    /// `ios`, `ipados`, `web`
    let platform: String?
}

// MARK: - Push

enum PushEnvironment: String, Codable, Sendable {
    case development
    case production

    /// Entspricht dem Entitlement `aps-environment` (Debug = development, Release = production).
    static var current: PushEnvironment {
        #if DEBUG
        .development
        #else
        .production
        #endif
    }
}

enum PushToken {
    /// Gerätetoken als Hex-Text (klein geschrieben), wie ihn der Server erwartet.
    static func hex(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// Body für `PUT /v1/devices/current`. `apnsToken: null` meldet das Token ab, darum wird der Schlüssel auch bei
/// `nil` ausdrücklich als `null` gesendet. `pushToStartToken` gehört den Live Activities.
struct DeviceRegistration: Encodable, Equatable, Sendable {
    var apnsToken: String?
    var environment: PushEnvironment
    var appVersion: String?
    var platform: String?
    var pushToStartToken: String?

    private enum CodingKeys: String, CodingKey { case apnsToken, environment, appVersion, platform, pushToStartToken }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(apnsToken, forKey: .apnsToken)
        try c.encode(environment, forKey: .environment)
        try c.encodeIfPresent(appVersion, forKey: .appVersion)
        try c.encodeIfPresent(platform, forKey: .platform)
        try c.encodeIfPresent(pushToStartToken, forKey: .pushToStartToken)
    }
}

/// `PUT /v1/live-activities/:activityId`.
struct LiveActivityRegistration: Encodable, Equatable, Sendable {
    var pushToken: String
    var tripId: Int
    /// `day` | `flight` | `checkin`
    var kind: String
    var eventId: Int?
}

// MARK: - Mitteilungsarten

/// Arten gemäss Vertrag; `id` ist der Schlüssel in `UNNotificationCategory` und in der Nutzlast (`kind`).
enum TripNotificationKind: String, CaseIterable, Identifiable, Sendable {
    case today = "trip.today"
    case depart = "trip.depart"
    case stay = "trip.stay"
    case pickup = "trip.pickup"
    case deadline = "trip.deadline"
    case review = "trip.review"
    case comment = "trip.comment"
    case expense = "ledger.expense"
    case settlement = "ledger.settlement"

    var id: String { rawValue }

    /// Kategorien mit eigenen Aktionen (Öffnen, Dokument, Route).
    static let actionable: [TripNotificationKind] = [.today, .depart, .stay, .pickup, .deadline, .review]

    var title: String {
        switch self {
        case .today: "Morgenbriefing"
        case .depart: "Abflug und Abfahrt"
        case .stay: "Check-in und Check-out"
        case .pickup: "Mietwagen"
        case .deadline: "Fristen"
        case .review: "Vorschläge zu prüfen"
        case .comment: "Kommentare"
        case .expense: "Neue Ausgaben"
        case .settlement: "Rückzahlungen"
        }
    }

    var detail: String {
        switch self {
        case .today: "Jeden Reisetag um 07:30 Reisezeit: was heute ansteht."
        case .depart: "24 Stunden, 3 Stunden und 1 Stunde vor Abflug oder Abfahrt, und wenn der Check-in öffnet."
        case .stay: "Check-in am Anreisetag und Check-out eine Stunde vorher."
        case .pickup: "Erinnerung an die Abholung des Mietwagens."
        case .deadline: "Kostenlos stornierbar bis … und Zahlungsfristen."
        case .review: "Neue Vorschläge aus Dokumenten, die du prüfen solltest."
        case .comment: "Neue Kommentare zu Ereignissen deiner Reisen."
        case .expense: "Neue Ausgaben in der Reisekasse."
        case .settlement: "Rückzahlungen an dich."
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .depart: "airplane.departure"
        case .stay: "bed.double"
        case .pickup: "car"
        case .deadline: "calendar.badge.clock"
        case .review: "checklist"
        case .comment: "bubble.left"
        case .expense: "creditcard"
        case .settlement: "arrow.left.arrow.right"
        }
    }

    /// Schlüssel in `/v1/me/notification-prefs` (camelCase, Vertrag): `tripToday`, `tripDepart`, …, `ledgerSettlement`.
    var prefKey: String {
        switch self {
        case .today: "tripToday"
        case .depart: "tripDepart"
        case .stay: "tripStay"
        case .pickup: "tripPickup"
        case .deadline: "tripDeadline"
        case .review: "tripReview"
        case .comment: "tripComment"
        case .expense: "ledgerExpense"
        case .settlement: "ledgerSettlement"
        }
    }
}

/// Vorlaufzeiten der Mitteilungen (`leadTimes`).
struct LeadTimes: Codable, Equatable, Sendable {
    /// Stunden vor Abflug/Abfahrt, z. B. `[24, 3, 1]`.
    var departHours: [Int] = [24, 3, 1]
    /// Check-out-Erinnerung: Minuten vorher.
    var checkoutMinutes: Int = 60
    /// Tage vor einer Frist.
    var deadlineDays: Int = 3
    /// Morgenbriefing, `HH:mm` Reisezeit.
    var todayBriefing: String = "07:30"

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        departHours = (try? c.decodeIfPresent([Int].self, forKey: .departHours)) ?? [24, 3, 1]
        checkoutMinutes = (try? c.decodeIfPresent(Int.self, forKey: .checkoutMinutes)) ?? 60
        deadlineDays = (try? c.decodeIfPresent(Int.self, forKey: .deadlineDays)) ?? 3
        todayBriefing = (try? c.decodeIfPresent(String.self, forKey: .todayBriefing)) ?? "07:30"
    }
}

/// Ruhezeiten (`quietHours`): in dieser Zeit keine Töne (Standard an, 22:30–06:30).
struct QuietHours: Codable, Equatable, Sendable {
    var enabled: Bool = true
    var from: String = "22:30"
    var to: String = "06:30"

    init() {}
    init(enabled: Bool, from: String, to: String) { self.enabled = enabled; self.from = from; self.to = to }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true
        from = (try? c.decodeIfPresent(String.self, forKey: .from)) ?? "22:30"
        to = (try? c.decodeIfPresent(String.self, forKey: .to)) ?? "06:30"
    }
}

/// `GET/PUT /v1/me/notification-prefs`: je Art ein Schalter, dazu `leadTimes` und `quietHours`.
/// Unbekannte Schlüssel bleiben erhalten.
struct NotificationPrefs: Equatable, Sendable {
    var raw: [String: JSONValue]

    init(raw: [String: JSONValue] = [:]) { self.raw = raw }

    /// Kompatibilität: Schlüssel der Art.
    func key(for kind: TripNotificationKind) -> String { kind.prefKey }

    func isOn(_ kind: TripNotificationKind) -> Bool { raw[kind.prefKey]?.boolValue ?? true }

    mutating func set(_ kind: TripNotificationKind, _ on: Bool) { raw[kind.prefKey] = .bool(on) }

    var leadTimes: LeadTimes {
        get { decode(LeadTimes.self, "leadTimes") ?? LeadTimes() }
        set { encode(newValue, "leadTimes") }
    }

    var quietHours: QuietHours {
        get { decode(QuietHours.self, "quietHours") ?? QuietHours() }
        set { encode(newValue, "quietHours") }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let v = raw[key], let data = try? JSONEncoder().encode(v) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private mutating func encode<T: Encodable>(_ value: T, _ key: String) {
        if let data = try? JSONEncoder().encode(value), let v = try? JSONDecoder().decode(JSONValue.self, from: data) {
            raw[key] = v
        }
    }

    static let allOn = NotificationPrefs()
}

struct NotificationPrefsResponse: Decodable, Sendable {
    let prefs: [String: JSONValue]
}

struct NotificationPrefsPatch: Encodable, Equatable, Sendable {
    var fields: [String: JSONValue]
    func encode(to encoder: Encoder) throws { try fields.encode(to: encoder) }
}

// MARK: - Geräte

struct UserDevice: Decodable, Equatable, Sendable, Identifiable {
    let id: Int
    let name: String?
    let platform: String?
    let createdAt: String
    let lastUsedAt: String?
    /// Für dieses Gerät ist ein Push-Token hinterlegt.
    let push: Bool
    /// Das Gerät, von dem aus die Anfrage kommt.
    let current: Bool

    var displayName: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? platformTitle : trimmed
    }

    var platformTitle: String {
        switch platform {
        case "ios": "iPhone"
        case "ipados": "iPad"
        case "macos": "Mac"
        case "web": "Browser"
        default: "Gerät"
        }
    }

    var symbol: String {
        switch platform {
        case "ios": "iphone"
        case "ipados": "ipad"
        case "macos": "desktopcomputer"
        case "web": "globe"
        default: "questionmark.square.dashed"
        }
    }

    func activityLine(timeZone: TimeZone = .current) -> String {
        if let last = lastUsedAt {
            return "Zuletzt aktiv \(TBDate.displayDateTime(isoTimestamp: last, timeZone: timeZone))"
        }
        return "Angemeldet \(TBDate.displayDateTime(isoTimestamp: createdAt, timeZone: timeZone))"
    }
}

struct UserDevicesResponse: Decodable, Sendable {
    let devices: [UserDevice]
}

enum DeviceOrdering {
    /// Aktuelles Gerät zuerst, danach wie vom Server (zuletzt aktiv).
    static func sorted(_ devices: [UserDevice]) -> [UserDevice] {
        devices.enumerated()
            .sorted { lhs, rhs in
                if lhs.element.current != rhs.element.current { return lhs.element.current }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}

// MARK: - Passwort

struct ChangePasswordRequest: Encodable, Equatable, Sendable {
    let currentPassword: String
    let newPassword: String
}

enum PasswordPolicy {
    static let minLength = 12
    static let maxLength = 200

    enum Problem: Equatable, Sendable {
        case currentMissing
        case tooShort(missing: Int)
        case tooLong
        case sameAsCurrent
        case mismatch

        var message: String {
            switch self {
            case .currentMissing: "Bitte gib dein aktuelles Passwort ein."
            case .tooShort(let missing):
                "Das neue Passwort braucht mindestens \(PasswordPolicy.minLength) Zeichen (noch \(missing))."
            case .tooLong: "Das neue Passwort darf höchstens \(PasswordPolicy.maxLength) Zeichen lang sein."
            case .sameAsCurrent: "Das neue Passwort muss sich vom aktuellen unterscheiden."
            case .mismatch: "Die beiden neuen Passwörter stimmen nicht überein."
            }
        }
    }

    static func problems(current: String, new: String, confirmation: String) -> [Problem] {
        var out: [Problem] = []
        if current.isEmpty { out.append(.currentMissing) }
        if new.count < minLength { out.append(.tooShort(missing: minLength - new.count)) }
        else if new.count > maxLength { out.append(.tooLong) }
        if !current.isEmpty, !new.isEmpty, new == current { out.append(.sameAsCurrent) }
        if !confirmation.isEmpty || !new.isEmpty, new != confirmation { out.append(.mismatch) }
        return out
    }
}

// MARK: - Version

/// `GET /v1/version` (öffentlich).
struct ServerVersion: Codable, Equatable, Sendable {
    var name: String?
    var version: String
    var build: String?
    var builtAt: String?
    var api: Int?
}

enum VersionLine {
    /// «TravelBuddy 0.1.0 (Build 1) · Server 0.1.0 · Stand 11.10.2026 14:30»
    static func text(appVersion: String, build: String, server: ServerVersion?, now: Date = Date(),
                     timeZone: TimeZone = .current) -> String {
        let stamp = TBDate.displayDateTime(now, timeZone: timeZone)
        var parts = ["TravelBuddy \(appVersion) (Build \(build))"]
        parts.append("Server \(server?.version ?? "–")")
        parts.append("Stand \(stamp)")
        return parts.joined(separator: " · ")
    }

    /// Die Hauptzahl (Major) von App und Server weicht ab (`0.1.0` gegen `1.0.0`): Vertrag «Version».
    static func mismatch(app: String, server: String?) -> Bool {
        guard let server else { return false }
        func major(_ v: String) -> Int? { v.split(separator: ".").first.flatMap { Int($0.filter(\.isNumber)) } }
        guard let a = major(app), let s = major(server) else { return false }
        return a != s
    }
}

// MARK: - Meta

struct Airport: Codable, Equatable, Hashable, Sendable, Identifiable {
    let iata: String
    var name: String
    var city: String?
    var country: String?
    var lat: Double?
    var lon: Double?
    var tz: String?

    var id: String { iata }
    var title: String { [city, name].compactMap { $0 }.joined(separator: " · ") }
}

struct AirportsResponse: Decodable, Sendable {
    let airports: [Airport]
}

struct TimezoneResponse: Decodable, Sendable {
    let tz: String
}
