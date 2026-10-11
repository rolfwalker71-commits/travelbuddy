import Combine
import SwiftUI
import UIKit
import UserNotifications
import UserNotificationsUI

/// Erweiterte Mitteilung (langes Drücken / Herunterziehen): Ticket je Kategorie
/// `trip.today`, `trip.depart`, `trip.stay`, `trip.pickup`, `trip.deadline`, `trip.review`.
final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private var model: TicketModel?
    private var host: UIHostingController<TicketNotificationView>?
    private var heightSubscription: AnyCancellable?
    private var enrichTask: Task<Void, Never>?

    func didReceive(_ notification: UNNotification) {
        let content = TicketContent(notification: notification.request.content)
        let model = TicketModel(content: content)
        self.model = model
        install(model)

        // Ergänzen: zuerst Cache der App-Group (sofort), dann kurzer Abruf von `GET /v1/summary`.
        var cachedContent = content
        if let cached = SharedSummaryCache.load()?.summary { cachedContent.enrich(with: cached) }
        if cachedContent != content { model.content = cachedContent }

        enrichTask?.cancel()
        enrichTask = Task { [weak model] in
            guard let api = SharedAPI(session: SharedAPI.shortSession(request: 6, resource: 10)),
                  let (summary, raw) = try? await api.summary() else { return }
            SharedSummaryCache.save(raw)
            await MainActor.run {
                guard let model else { return }
                var updated = content
                updated.enrich(with: summary)
                if updated != model.content { model.content = updated }
            }
        }
    }

    private func install(_ model: TicketModel) {
        host?.willMove(toParent: nil)
        host?.view.removeFromSuperview()
        host?.removeFromParent()

        let controller = UIHostingController(rootView: TicketNotificationView(model: model))
        controller.view.backgroundColor = .clear
        controller.sizingOptions = [.intrinsicContentSize]
        addChild(controller)
        view.addSubview(controller.view)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        controller.didMove(toParent: self)
        host = controller

        heightSubscription = model.$height
            .filter { $0 > 1 }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] height in
                guard let self else { return }
                self.preferredContentSize = CGSize(width: self.view.bounds.width, height: height)
            }
    }

    // MARK: Aktionen

    func didReceive(_ response: UNNotificationResponse,
                    completionHandler completion: @escaping (UNNotificationContentExtensionResponseOption) -> Void) {
        let content = model?.content ?? TicketContent(notification: response.notification.request.content)
        switch TravelNotificationAction.resolve(response.actionIdentifier) {
        case .document:
            open(content.documentURL, completion: completion)
        case .route:
            if let url = content.routeURL { open(url, completion: completion) } else { open(content.openURL, completion: completion) }
        case .open:
            open(content.openURL, completion: completion)
        case .defaultTap, .other:
            // Standard-Tipp und unbekannte Aktionen: die App übernimmt (Deep-Link aus der Nutzlast).
            completion(.dismissAndForwardAction)
        }
    }

    private func open(_ url: URL?, completion: @escaping (UNNotificationContentExtensionResponseOption) -> Void) {
        guard let url else { completion(.dismissAndForwardAction); return }
        extensionContext?.open(url) { success in
            // Gelingt das Öffnen hier nicht, leitet die App die Aktion weiter.
            completion(success ? .dismiss : .dismissAndForwardAction)
        }
    }
}
