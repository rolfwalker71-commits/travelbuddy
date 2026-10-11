import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Design-Tokens der Richtung B «Ticket» (siehe docs/DESIGN.md). Gemeinsam für App, Widgets und Erweiterungen.
public enum TB {
    // MARK: Farben (hell «Papier» / dunkel «Nachtpapier»)
    public enum Palette {
        public static let bg = dynamic(light: 0xECE5D7, dark: 0x151412)
        public static let surface = dynamic(light: 0xFBF8F1, dark: 0x1F1D1A)
        public static let surface2 = dynamic(light: 0xF1EBDD, dark: 0x2A2723)
        public static let line = dynamic(light: 0xD4C9B4, dark: 0x3A362F)
        public static let ink = dynamic(light: 0x1D1B18, dark: 0xF1EBDD)
        public static let mute = dynamic(light: 0x6F675A, dark: 0xA59C8B)
        public static let accent = dynamic(light: 0xD8452B, dark: 0xF0653F)
        public static let onAccent = dynamic(light: 0xFFFFFF, dark: 0x1A0E0A)
        public static let positive = dynamic(light: 0x2F7D4F, dark: 0x6FCF97)
        public static let negative = dynamic(light: 0xB3261E, dark: 0xF28B82)
        /// Dunkle Hero-Fläche (Heute, Live Activity), in beiden Modi dunkel.
        public static let hero = Color(hex: 0x1D1B18)
        public static let heroInk = Color(hex: 0xFBF8F1)
        public static let heroAccent = Color(hex: 0xFFB347)

        /// Typfarbe aus dem Katalog (`color` in event-types.json).
        public static func type(_ key: String) -> Color {
            switch key {
            case "air": dynamic(light: 0xD8452B, dark: 0xF0653F)
            case "ship": dynamic(light: 0x1F4E5F, dark: 0x5FA3B8)
            case "stay": dynamic(light: 0xB48A2B, dark: 0xD6B04E)
            case "car": dynamic(light: 0x5B8C5A, dark: 0x7FB47E)
            case "rail": dynamic(light: 0x3C6E8F, dark: 0x6FA3C4)
            case "transfer": dynamic(light: 0x7A5C99, dark: 0xA68BC4)
            case "activity": dynamic(light: 0xC46A2D, dark: 0xE08F55)
            case "food": dynamic(light: 0xA8433F, dark: 0xD97671)
            case "ticket": dynamic(light: 0x8A6F9E, dark: 0xB59BC7)
            case "safety": dynamic(light: 0x3F7A8C, dark: 0x6FA9BB)
            default: dynamic(light: 0x6F675A, dark: 0xA59C8B)
            }
        }
    }

    // MARK: Schrift (Barlow, Barlow Semi Condensed, IBM Plex Mono; siehe UIAppFonts und `TBFonts`)
    public enum Font {
        public static func text(_ size: CGFloat, weight: SwiftUI.Font.Weight = .regular, relativeTo style: SwiftUI.Font.TextStyle = .body) -> SwiftUI.Font {
            TBFonts.registerIfNeeded()
            return .custom(name("Barlow", weight, available: ["Regular", "Medium", "SemiBold", "Bold"]), size: size, relativeTo: style)
        }
        public static func title(_ size: CGFloat, weight: SwiftUI.Font.Weight = .semibold, relativeTo style: SwiftUI.Font.TextStyle = .title2) -> SwiftUI.Font {
            TBFonts.registerIfNeeded()
            return .custom(name("BarlowSemiCondensed", weight, available: ["Medium", "SemiBold", "Bold"]), size: size, relativeTo: style)
        }
        public static func mono(_ size: CGFloat, weight: SwiftUI.Font.Weight = .medium, relativeTo style: SwiftUI.Font.TextStyle = .body) -> SwiftUI.Font {
            TBFonts.registerIfNeeded()
            return .custom(name("IBMPlexMono", weight, available: ["Regular", "Medium", "SemiBold"]), size: size, relativeTo: style)
        }

        /// PostScript-Name; nicht ausgelieferte Schnitte (z. B. Semi Condensed Regular) rücken zum nächsten vorhandenen.
        private static func name(_ family: String, _ weight: SwiftUI.Font.Weight, available: [String]) -> String {
            let wanted: String
            switch weight {
            case .bold, .heavy, .black: wanted = "Bold"
            case .semibold: wanted = "SemiBold"
            case .medium: wanted = "Medium"
            default: wanted = "Regular"
            }
            let order = ["Regular", "Medium", "SemiBold", "Bold"]
            let resolved: String
            if available.contains(wanted) {
                resolved = wanted
            } else {
                let idx = order.firstIndex(of: wanted) ?? 0
                resolved = available.min { abs((order.firstIndex(of: $0) ?? 0) - idx) < abs((order.firstIndex(of: $1) ?? 0) - idx) } ?? wanted
            }
            return "\(family)-\(resolved)"
        }
    }

    // MARK: Masse
    public enum Metric {
        public static let cardRadius: CGFloat = 10
        public static let fieldRadius: CGFloat = 6
        public static let hairline: CGFloat = 1
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
        #else
        Color(hex: light)
        #endif
    }
}

public extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}
#if canImport(UIKit)
public extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
#endif
