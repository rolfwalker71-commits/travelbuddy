import UIKit
import OSLog

/// Setzt Barlow, Barlow Semi Condensed und IBM Plex Mono auch in den System-Leisten: Navigationstitel,
/// Tab-Beschriftung, Toolbar-Schaltflächen, Segmente, Suchfeld, Alerts. Dynamic Type bleibt über `UIFontMetrics` aktiv.
enum FontAppearance {
    private static let log = Logger(subsystem: "ch.rolfwalker.travelbuddy", category: "fonts")

    /// PostScript-Namen, die `TB.Font` erzeugt (siehe `ios/Shared/DesignTokens.swift`).
    static let expectedFontNames = [
        "Barlow-Regular", "Barlow-Medium", "Barlow-SemiBold", "Barlow-Bold",
        "BarlowSemiCondensed-Medium", "BarlowSemiCondensed-SemiBold", "BarlowSemiCondensed-Bold",
        "IBMPlexMono-Regular", "IBMPlexMono-Medium", "IBMPlexMono-SemiBold",
    ]

    /// Namen, die zur Laufzeit nicht gefunden werden (leer = alles in Ordnung).
    static func missingFontNames() -> [String] {
        expectedFontNames.filter { UIFont(name: $0, size: 12) == nil }
    }

    static func scaled(_ name: String, size: CGFloat, style: UIFont.TextStyle) -> UIFont {
        let base = UIFont(name: name, size: size) ?? .systemFont(ofSize: size)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }

    static func install() {
        let missing = missingFontNames()
        if !missing.isEmpty { log.error("Schriften fehlen: \(missing.joined(separator: ", "), privacy: .public)") }

        let ink = UIColor(TB.Palette.ink)
        let bg = UIColor(TB.Palette.bg)
        let accent = UIColor(TB.Palette.accent)

        let nav = UINavigationBarAppearance()
        nav.configureWithDefaultBackground()
        nav.titleTextAttributes = [.font: scaled("BarlowSemiCondensed-SemiBold", size: 17, style: .headline), .foregroundColor: ink]
        nav.largeTitleTextAttributes = [.font: scaled("BarlowSemiCondensed-Bold", size: 34, style: .largeTitle), .foregroundColor: ink]
        let barButton = UIBarButtonItemAppearance(style: .plain)
        barButton.normal.titleTextAttributes = [.font: scaled("Barlow-SemiBold", size: 17, style: .body), .foregroundColor: accent]
        barButton.highlighted.titleTextAttributes = [.font: scaled("Barlow-SemiBold", size: 17, style: .body)]
        nav.buttonAppearance = barButton
        nav.doneButtonAppearance = barButton
        nav.backButtonAppearance = barButton
        let navScroll = UINavigationBarAppearance()
        navScroll.configureWithTransparentBackground()
        navScroll.titleTextAttributes = nav.titleTextAttributes
        navScroll.largeTitleTextAttributes = nav.largeTitleTextAttributes
        navScroll.buttonAppearance = barButton
        navScroll.doneButtonAppearance = barButton
        navScroll.backButtonAppearance = barButton
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = navScroll
        UINavigationBar.appearance().compactAppearance = nav

        let tabItem = UITabBarItemAppearance()
        let tabFont = scaled("BarlowSemiCondensed-SemiBold", size: 11, style: .caption2)
        tabItem.normal.titleTextAttributes = [.font: tabFont]
        tabItem.selected.titleTextAttributes = [.font: tabFont]
        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        tab.stackedLayoutAppearance = tabItem
        tab.inlineLayoutAppearance = tabItem
        tab.compactInlineLayoutAppearance = tabItem
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        UIBarButtonItem.appearance().setTitleTextAttributes([.font: scaled("Barlow-SemiBold", size: 17, style: .body)], for: .normal)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: scaled("Barlow-SemiBold", size: 14, style: .subheadline)], for: .normal)
        UITextField.appearance().font = scaled("Barlow-Regular", size: 17, style: .body)
        UITextView.appearance().font = scaled("Barlow-Regular", size: 17, style: .body)
        UILabel.appearance(whenContainedInInstancesOf: [UITableViewHeaderFooterView.self]).font = scaled("BarlowSemiCondensed-SemiBold", size: 13, style: .footnote)
        UIDatePicker.appearance().tintColor = accent
        _ = bg
    }
}
