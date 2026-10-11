import Foundation
import Observation
import UIKit
import UserNotifications

/// Push-Registrierung: Berechtigung auf Wunsch, Gerätetoken beim System holen und dem Server melden
/// (`PUT /v1/devices/current`, dazu das Push-to-Start-Token der Live Activities).
@MainActor
@Observable
final class PushService {
    static let shared = PushService()

    enum Permission: Equatable { case unknown, notDetermined, denied, allowed }

    private(set) var permission: Permission = .unknown
    private(set) var deviceToken: String?
    private(set) var pushToStartToken: String?
    private(set) var lastError: String?
    private(set) var isEnabled: Bool

    private var api: (any TravelAPI)?
    private var reportedKey: String?
    private let defaults: UserDefaults
    private static let enabledKey = "push.enabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        isEnabled = defaults.object(forKey: Self.enabledKey) as? Bool ?? true
    }

    var isActive: Bool { permission == .allowed && isEnabled }

    // MARK: Sitzung

    func attach(api: any TravelAPI) {
        self.api = api
        reportedKey = nil
        Task {
            await refreshPermission()
            if isActive { UIApplication.shared.registerForRemoteNotifications() }
            await reportIfNeeded()
        }
    }

    func detach() {
        api = nil
        reportedKey = nil
    }

    func unregisterFromServer(using api: any TravelAPI) async {
        let body = DeviceRegistration(apnsToken: nil, environment: .current, appVersion: Self.appVersion,
                                      platform: DeviceInfo.platform, pushToStartToken: nil)
        try? await api.registerDevice(body)
        reportedKey = nil
    }

    // MARK: Berechtigung

    func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: permission = .notDetermined
        case .denied: permission = .denied
        case .authorized, .provisional, .ephemeral: permission = .allowed
        @unknown default: permission = .unknown
        }
    }

    /// Schalter «an»: erst jetzt fragt das System nach der Berechtigung.
    func enable() async {
        lastError = nil
        await refreshPermission()
        if permission == .notDetermined {
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            } catch {
                lastError = error.localizedDescription
            }
            await refreshPermission()
        }
        guard permission == .allowed else {
            if permission == .denied { lastError = "Mitteilungen sind für TravelBuddy in den Systemeinstellungen ausgeschaltet." }
            return
        }
        setEnabled(true)
        UIApplication.shared.registerForRemoteNotifications()
        await reportIfNeeded()
    }

    func disable() async {
        setEnabled(false)
        lastError = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        if let api { await unregisterFromServer(using: api) }
    }

    // MARK: Rückmeldungen des Systems

    func didRegister(deviceToken data: Data) {
        deviceToken = PushToken.hex(from: data)
        Task { await reportIfNeeded() }
    }

    func didFailToRegister(_ error: Error) {
        lastError = "Die Registrierung für Mitteilungen ist fehlgeschlagen: \(error.localizedDescription)"
    }

    /// Vom `LiveActivityManager`: neues Push-to-Start-Token.
    func setPushToStartToken(_ token: String?) {
        guard token != pushToStartToken else { return }
        pushToStartToken = token
        Task { await reportIfNeeded() }
    }

    // MARK: Intern

    private func setEnabled(_ value: Bool) {
        isEnabled = value
        defaults.set(value, forKey: Self.enabledKey)
    }

    /// Meldet Token, Umgebung, Plattform, Version und Push-to-Start-Token, einmal je Sitzung und Stand.
    private func reportIfNeeded() async {
        guard let api, isActive || pushToStartToken != nil else { return }
        let key = "\(deviceToken ?? "-")|\(pushToStartToken ?? "-")|\(isActive)"
        guard reportedKey != key else { return }
        let body = DeviceRegistration(apnsToken: isActive ? deviceToken : nil, environment: .current,
                                      appVersion: Self.appVersion, platform: DeviceInfo.platform,
                                      pushToStartToken: pushToStartToken)
        do {
            try await api.registerDevice(body)
            reportedKey = key
        } catch {
            // Beim nächsten Start/Anmelden erneut; kein Fehler für Nutzer.
        }
    }

    static var appVersion: String { "\(DeviceInfo.appVersion) (\(DeviceInfo.build))" }
}
