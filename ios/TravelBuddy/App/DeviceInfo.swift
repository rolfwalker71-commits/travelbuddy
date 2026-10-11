import UIKit

enum DeviceInfo {
    static var name: String { UIDevice.current.name }

    /// Der Server kennt `ios`, `ipados`, `macos`, `web`.
    static var platform: String { UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios" }

    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }

    static var build: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }
}
