import Foundation

/// Gemeinsame Konstanten für App und Erweiterungen (Widgets, Teilen, Mitteilungen).
public enum SharedConfig {
    public static let appGroup = "group.ch.rolfwalker.travelbuddy"
    public static let keychainService = "ch.rolfwalker.travelbuddy"
    public static let keychainAccessGroupSuffix = "ch.rolfwalker.travelbuddy"
    public static let urlScheme = "travelbuddy"
    public static let liveActivityTopicSuffix = ".push-type.liveactivity"

    /// Gemeinsame UserDefaults (App-Group).
    public static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    public enum Key {
        public static let serverURL = "serverURL"
        public static let summaryJSON = "summaryJSON"        // letzte /v1/summary-Antwort für Widgets
        public static let summaryFetchedAt = "summaryFetchedAt"
    }
}
