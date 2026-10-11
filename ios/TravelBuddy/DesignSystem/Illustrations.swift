import SwiftUI
import UIKit

// Illustrationen und Hilfskarten. Die Dateien erzeugt ein anderes Paket in `shared/illustrations/`
// (`manifest.json`, `help-cards.json`, SVG hell/dunkel); `ios/scripts/sync-illustrations.sh` legt sie als
// Asset-Katalog `Illustrations.xcassets` und als JSON-Resource in die App. Bis dahin: Platzhalter mit Symbol.

struct IllustrationEntry: Equatable, Identifiable {
    let key: String
    /// Mögliche Namen im Asset-Katalog (Dateiname ohne Endung, Schlüssel, ID).
    let imageNames: [String]
    let title: String?
    let alt: String?
    var id: String { key }
}

struct HelpCardEntry: Equatable, Identifiable {
    let id: String
    let title: String
    let text: String
    let steps: [String]
    let illustrationKey: String?
}

enum IllustrationCatalog {
    static func entries(from data: Data) -> [IllustrationEntry] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return [] }
        var items: [(String?, [String: Any])] = []
        func collect(_ value: Any) {
            if let arr = value as? [[String: Any]] {
                items = arr.map { (nil, $0) }
            } else if let obj = value as? [String: Any] {
                for k in ["illustrations", "items", "images", "entries"] {
                    if let arr = obj[k] as? [[String: Any]] { items = arr.map { (nil, $0) }; return }
                    if let dict = obj[k] as? [String: Any] { collect(dict); return }
                }
                // Dictionary: Schlüssel -> Objekt oder Dateiname.
                for (key, v) in obj {
                    if let o = v as? [String: Any] { items.append((key, o)) }
                    else if let s = v as? String { items.append((key, ["file": s])) }
                }
            }
        }
        collect(json)
        return items.compactMap { fallbackKey, o in
            func str(_ keys: [String]) -> String? { keys.compactMap { o[$0] as? String }.first }
            guard let key = str(["key", "id", "name", "slug"]) ?? fallbackKey else { return nil }
            var names: [String] = []
            for f in [str(["file", "path", "svg", "light", "src", "filename"])].compactMap({ $0 }) {
                let base = ((f as NSString).lastPathComponent as NSString).deletingPathExtension
                names.append(base)
            }
            names.append(key)
            if let id = str(["id"]) { names.append(id) }
            return IllustrationEntry(key: key, imageNames: Array(NSOrderedSet(array: names)) as? [String] ?? names,
                                     title: str(["title", "label", "name"]), alt: str(["alt", "description", "caption"]))
        }
    }

    static func helpCards(from data: Data) -> [HelpCardEntry] {
        guard let json = try? JSONSerialization.jsonObject(with: data) else { return [] }
        var list: [[String: Any]] = []
        if let arr = json as? [[String: Any]] { list = arr }
        else if let obj = json as? [String: Any] {
            for k in ["cards", "helpCards", "items", "help"] { if let arr = obj[k] as? [[String: Any]] { list = arr; break } }
        }
        return list.compactMap { o in
            func str(_ keys: [String]) -> String? { keys.compactMap { o[$0] as? String }.first }
            guard let title = str(["title", "heading", "label"]) else { return nil }
            let steps = (o["steps"] as? [String]) ?? []
            return HelpCardEntry(id: str(["id", "key", "slug"]) ?? title, title: title,
                                 text: str(["text", "body", "summary", "description", "intro"]) ?? "",
                                 steps: steps,
                                 illustrationKey: str(["illustration", "illustrationKey", "imageKey", "image", "key"]))
        }
    }

    private static func resource(_ name: String, bundle: Bundle) -> Data? {
        for sub in ["Illustrations", nil] as [String?] {
            if let url = bundle.url(forResource: name, withExtension: "json", subdirectory: sub),
               let data = try? Data(contentsOf: url) { return data }
        }
        return nil
    }

    static func bundledEntries(bundle: Bundle = .main) -> [IllustrationEntry] {
        resource("illustrations-manifest", bundle: bundle).map(entries(from:)) ?? []
    }

    static func bundledHelpCards(bundle: Bundle = .main) -> [HelpCardEntry] {
        resource("help-cards", bundle: bundle).map(helpCards(from:)) ?? []
    }

    /// Bild zu einem Schlüssel: Katalogname direkt, über das Manifest oder `type-<Typ>`.
    static func image(for key: String, bundle: Bundle = .main) -> UIImage? {
        if let img = UIImage(named: key, in: bundle, compatibleWith: nil) { return img }
        if let entry = bundledEntries(bundle: bundle).first(where: { $0.key == key }) {
            for n in entry.imageNames { if let img = UIImage(named: n, in: bundle, compatibleWith: nil) { return img } }
        }
        return UIImage(named: "type-\(key)", in: bundle, compatibleWith: nil)
    }

    /// Platzhalter-Symbol, solange es das Bild nicht gibt.
    static func symbol(for key: String) -> String {
        let k = key.lowercased()
        let map: [(String, String)] = [
            ("flug", "airplane"), ("air", "airplane"), ("zug", "tram.fill"), ("rail", "tram.fill"),
            ("miet", "car.fill"), ("car", "car.fill"), ("transfer", "bus.fill"), ("hotel", "bed.double.fill"),
            ("unterkunft", "house.fill"), ("kreuz", "ferry.fill"), ("ship", "ferry.fill"), ("ausflug", "figure.walk"),
            ("restaurant", "fork.knife"), ("veranstaltung", "ticket.fill"), ("versicherung", "checkmark.shield.fill"),
            ("visum", "person.text.rectangle.fill"), ("aufgabe", "checklist"), ("dokument", "doc.text.fill"),
            ("scan", "doc.viewfinder"), ("karte", "map.fill"), ("kasse", "creditcard.fill"), ("heute", "sun.max.fill"),
        ]
        return map.first { k.contains($0.0) }?.1 ?? "suitcase.fill"
    }
}

/// Illustration in einer Karte: Bild aus dem Katalog, sonst eine ruhige Fläche mit Symbol.
struct IllustrationCard: View {
    let key: String
    var caption: String?
    var height: CGFloat = 150

    var body: some View {
        let image = IllustrationCatalog.image(for: key)
        ZStack {
            Palette.surface2
            if let image {
                Image(uiImage: image).resizable().scaledToFit().padding(6)
            } else {
                Image(systemName: IllustrationCatalog.symbol(for: key))
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(Palette.mute)
            }
        }
        .frame(maxWidth: .infinity).frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous).strokeBorder(Palette.line))
        .overlay(alignment: .bottomLeading) {
            if let caption {
                Text(caption).tbText(12, weight: .medium, relativeTo: .caption)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Palette.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: 4))
                    .padding(8)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(caption ?? "Illustration")
        .accessibilityHidden(caption == nil)
    }
}

/// Hilfskarte: Illustration, Titel, Text und Schritte. Daten aus `help-cards.json`.
struct HelpCard: View {
    let card: HelpCardEntry

    var body: some View {
        PlainCard {
            VStack(alignment: .leading, spacing: 10) {
                if let key = card.illustrationKey { IllustrationCard(key: key, height: 120) }
                Text(card.title).tbTitle(20, relativeTo: .title3)
                if !card.text.isEmpty { Text(card.text).tbText(15, color: Palette.mute) }
                ForEach(Array(card.steps.enumerated()), id: \.offset) { i, step in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(i + 1)").tbMono(13, weight: .semibold, relativeTo: .footnote, color: Palette.accent)
                        Text(step).tbText(15)
                    }
                }
            }
            .padding(14)
        }
        .accessibilityElement(children: .combine)
    }
}
