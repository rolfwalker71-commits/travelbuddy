import Foundation
import CoreText
#if canImport(UIKit)
import UIKit
#endif

/// Schriften der Richtung B in Erweiterungen sicherstellen.
/// `UIAppFonts` greift in Widgets, Live Activities und Mitteilungs-Erweiterungen nicht immer (sie rendern teils
/// ausserhalb des App-Kontexts). `registerIfNeeded()` registriert die TTF-Dateien aus dem Bundle der Erweiterung
/// (Ordner `Fonts`) bzw. aus der Host-App per `CTFontManagerRegisterFontsForURLs` für den Prozess.
/// `TB.Font.*` ruft das automatisch (einmalig) auf.
enum TBFonts {
    /// PostScript-Namen aller ausgelieferten Schnitte (Dateien in `ios/TravelBuddy/Resources/Fonts`).
    static let postScriptNames: [String] = [
        "Barlow-Regular", "Barlow-Medium", "Barlow-SemiBold", "Barlow-Bold",
        "BarlowSemiCondensed-Medium", "BarlowSemiCondensed-SemiBold", "BarlowSemiCondensed-Bold",
        "IBMPlexMono-Regular", "IBMPlexMono-Medium", "IBMPlexMono-SemiBold",
    ]

    private static let once: Bool = {
        registerNow()
        return true
    }()

    /// Registriert die Schriften höchstens einmal je Prozess und nur, wenn sie noch fehlen.
    static func registerIfNeeded() { _ = once }

    /// Namen, die auch nach der Registrierung nicht auflösbar sind (leer = alles in Ordnung).
    static func missingFonts() -> [String] {
        registerIfNeeded()
        return postScriptNames.filter { !isAvailable($0) }
    }

    private static func isAvailable(_ name: String) -> Bool {
        #if canImport(UIKit)
        return UIFont(name: name, size: 12) != nil
        #else
        let d = CTFontDescriptorCreateWithNameAndSize(name as CFString, 12)
        let font = CTFontCreateWithFontDescriptor(d, 12, nil)
        return (CTFontCopyPostScriptName(font) as String) == name
        #endif
    }

    private static func registerNow() {
        let missing = postScriptNames.filter { !isAvailable($0) }
        guard !missing.isEmpty else { return }
        var urls: [URL] = []
        var seen = Set<String>()
        for dir in candidateDirectories() {
            guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { continue }
            for url in files where url.pathExtension.lowercased() == "ttf" || url.pathExtension.lowercased() == "otf" {
                if seen.insert(url.lastPathComponent).inserted { urls.append(url) }
            }
        }
        guard !urls.isEmpty else { return }
        for url in urls {
            // Fehler «bereits registriert» sind unkritisch; ein einzelner Fehler stoppt die übrigen nicht.
            _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// Bundle der Erweiterung (`Fonts`, Wurzel) und die Host-App (`App.app/Fonts`).
    private static func candidateDirectories() -> [URL] {
        var dirs: [URL] = []
        let main = Bundle.main.bundleURL
        dirs.append(main.appendingPathComponent("Fonts", isDirectory: true))
        dirs.append(main)
        // App-Erweiterung: `App.app/PlugIns/X.appex` → `App.app`
        if main.pathExtension == "appex" {
            let host = main.deletingLastPathComponent().deletingLastPathComponent()
            dirs.append(host.appendingPathComponent("Fonts", isDirectory: true))
            dirs.append(host)
        }
        return dirs
    }
}
