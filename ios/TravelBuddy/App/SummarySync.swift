import Foundation
import WidgetKit

/// Brücke zu den Widgets: legt die Antwort von `GET /v1/summary` unverändert in die App-Group
/// (`SharedConfig.Key.summaryJSON`, als JSON-Text/String; `summaryFetchedAt` als Unix-Sekunden, Double) und stösst die
/// Timelines an (Vertrag «Präzisierung Summary», App-Seite).
enum SummarySync {
    /// - Returns: `true`, wenn die Daten gültiges JSON waren und gespeichert wurden.
    @discardableResult
    static func store(_ data: Data, defaults: UserDefaults = SharedConfig.defaults, date: Date = Date(),
                      reload: () -> Void = { WidgetCenter.shared.reloadAllTimelines() }) -> Bool {
        guard (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] != nil else { return false }
        guard let text = String(data: data, encoding: .utf8) else { return false }
        defaults.set(text, forKey: SharedConfig.Key.summaryJSON)
        defaults.set(date.timeIntervalSince1970, forKey: SharedConfig.Key.summaryFetchedAt)
        reload()
        return true
    }

    /// Bei Abmeldung: Widgets leeren.
    static func clear(defaults: UserDefaults = SharedConfig.defaults, reload: () -> Void = { WidgetCenter.shared.reloadAllTimelines() }) {
        defaults.removeObject(forKey: SharedConfig.Key.summaryJSON)
        defaults.removeObject(forKey: SharedConfig.Key.summaryFetchedAt)
        reload()
    }
}
