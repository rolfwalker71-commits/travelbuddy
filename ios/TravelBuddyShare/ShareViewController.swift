import SwiftUI
import UIKit

/// Teilen-Erweiterung «In TravelBuddy ablegen»: nimmt PDF, Bilder und Dateien (bis 10) an und legt sie bei TravelBuddy ab.
final class ShareViewController: UIViewController {
    private let model = ShareModel()
    private var host: UIHostingController<ShareView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        TBFonts.registerIfNeeded()
        view.backgroundColor = UIColor(TB.Palette.bg)

        let root = ShareView(model: model, onClose: { [weak self] in self?.close() }, onOpenApp: { [weak self] in self?.openApp() })
        let controller = UIHostingController(rootView: root)
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        controller.didMove(toParent: self)
        host = controller

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { @MainActor in model.start(extensionItems: items) }
    }

    private func close() {
        if model.phase == .finished {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
    }

    /// `travelbuddy://inbox`. Teilen-Erweiterungen dürfen `extensionContext.open` nicht überall nutzen; Rückfall über
    /// die Responder-Kette der Host-Anwendung.
    private func openApp() {
        let url = SharedLink.inbox
        extensionContext?.open(url) { [weak self] success in
            if success {
                self?.extensionContext?.completeRequest(returningItems: nil)
            } else {
                self?.openViaResponderChain(url)
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }

    private func openViaResponderChain(_ url: URL) {
        var responder: UIResponder? = self
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        while let current = responder {
            if current.responds(to: selector) {
                typealias Open = @convention(c) (AnyObject, Selector, URL, [UIApplication.OpenExternalURLOptionsKey: Any], ((Bool) -> Void)?) -> Void
                if let method = class_getMethodImplementation(type(of: current), selector) {
                    let open = unsafeBitCast(method, to: Open.self)
                    open(current, selector, url, [:], nil)
                }
                return
            }
            responder = current.next
        }
    }
}
