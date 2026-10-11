import Foundation
import OSLog
import UIKit
import UserNotifications

/// Aktionen der Mitteilungen.
enum NotificationActionID {
    static let open = "tb.open"
    static let document = "tb.document"
    static let route = "tb.route"
}

enum NotificationSetup {
    /// Kategorien `trip.today`, `trip.depart`, `trip.stay`, `trip.pickup`, `trip.deadline`, `trip.review`
    /// mit den Aktionen «Öffnen», «Dokument», «Route».
    static func categories() -> Set<UNNotificationCategory> {
        func category(_ kind: TripNotificationKind) -> UNNotificationCategory {
            var actions = [UNNotificationAction(identifier: NotificationActionID.open, title: "Öffnen", options: [.foreground])]
            switch kind {
            case .today, .review:
                break
            case .deadline:
                actions.append(UNNotificationAction(identifier: NotificationActionID.document, title: "Dokument", options: [.foreground]))
            default:
                actions.append(UNNotificationAction(identifier: NotificationActionID.document, title: "Dokument", options: [.foreground]))
                actions.append(UNNotificationAction(identifier: NotificationActionID.route, title: "Route", options: [.foreground]))
            }
            return UNNotificationCategory(identifier: kind.rawValue, actions: actions, intentIdentifiers: [],
                                          options: [.hiddenPreviewsShowTitle])
        }
        return Set(TripNotificationKind.actionable.map(category))
    }

    static func register(center: UNUserNotificationCenter = .current()) {
        center.setNotificationCategories(categories())
    }

    /// Ziel und Aktion aus einer Antwort des Nutzers auf eine Mitteilung.
    static func destination(actionIdentifier: String, userInfo: [AnyHashable: Any]) -> (AppDestination, AppDestination.EventAction)? {
        guard let parsed = AppDestination.parse(pushUserInfo: userInfo) else { return nil }
        let dest = parsed.destination
        switch actionIdentifier {
        case NotificationActionID.document: return (dest, .document)
        case NotificationActionID.route: return (dest, .route)
        default: return (dest, parsed.action)
        }
    }
}

/// Empfängt die Rückmeldungen des Systems zu Mitteilungen.
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    private static let log = Logger(subsystem: "ch.rolfwalker.travelbuddy", category: "push")

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let (destination, action) = NotificationSetup.destination(actionIdentifier: response.actionIdentifier, userInfo: info) else {
            Self.log.info("Mitteilung ohne Ziel angetippt")
            return
        }
        await MainActor.run { DeepLinkInbox.shared.submit(destination, action: action) }
    }
}

/// Eingang für Ziele von aussen (Link, Mitteilung). Der `Router` lebt erst nach der Anmeldung;
/// bis dahin bleibt das Ziel hier liegen.
@MainActor
@Observable
final class DeepLinkInbox {
    static let shared = DeepLinkInbox()
    private(set) var pending: (destination: AppDestination, action: AppDestination.EventAction)?

    func submit(_ destination: AppDestination, action: AppDestination.EventAction = .open) {
        pending = (destination, action)
    }

    func take() -> (destination: AppDestination, action: AppDestination.EventAction)? {
        defer { pending = nil }
        return pending
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    private let notifications = NotificationCenterDelegate()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = notifications
        NotificationSetup.register()
        FontAppearance.install()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushService.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        Task { @MainActor in PushService.shared.didFailToRegister(error) }
    }
}
