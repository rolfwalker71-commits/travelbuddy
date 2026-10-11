import Testing
import UIKit
@testable import TravelBuddy

@Suite("Schriften und Katalog")
struct CatalogAndFontTests {
    @Test("Alle 10 PostScript-Namen aus DesignTokens sind zur Laufzeit vorhanden")
    func fontNamesExist() {
        for name in FontAppearance.expectedFontNames {
            #expect(UIFont(name: name, size: 12) != nil, "Schrift fehlt: \(name)")
        }
        #expect(FontAppearance.missingFontNames().isEmpty)
        #expect(TBFonts.missingFonts().isEmpty)
    }

    @Test("TB.Font erzeugt genau diese Namen")
    func tokenNames() {
        // Der Name wird intern gebaut; die Familien müssen als Familie auflösbar sein.
        #expect(UIFont.fontNames(forFamilyName: "Barlow").contains("Barlow-SemiBold"))
        #expect(UIFont.fontNames(forFamilyName: "Barlow Semi Condensed").contains("BarlowSemiCondensed-Bold"))
        #expect(UIFont.fontNames(forFamilyName: "IBM Plex Mono").contains("IBMPlexMono-Medium"))
    }

    @Test("Gebündelter Katalog: 13 Typen, Unterkunft erbt von Hotel")
    func bundledCatalog() throws {
        let c = EventCatalogLoader.bundled()
        #expect(c.types.count == 13)
        let ferien = try #require(c.type(for: "Unterkunft"))
        let hotel = try #require(c.type(for: "Hotel"))
        #expect(ferien.sections == hotel.sections)
        #expect(c.type(for: "Mietwagen")?.id == "Mietauto")   // Alias
        #expect(c.type(for: "gibt-es-nicht") == nil)
        let tz = try #require(c.commonFields.first { $0.key == "startTz" })
        #expect(tz.optionsAreZones)
        let pax = try #require(c.field(key: "passengers", in: c.type(for: "Flug")!))
        #expect(pax.kind == .passengers)
        #expect(pax.fields.map(\.key) == ["seat", "ticketNumber", "frequentFlyer"])
    }

    @Test("Katalog vom Server mit unbekannter Feldart und fehlenden Angaben bleibt lesbar")
    func tolerantDecoding() throws {
        let json = """
        {"version":2,"commonFields":[{"key":"x","label":"X","kind":"hologramm"}],
         "types":[{"id":"Neu","label":"Neu","icon":"star","color":"air","sections":[{"id":"s","title":"S","fields":[{"key":"f","label":"F","kind":"text"}]}]}]}
        """
        let c = try EventCatalogLoader.decode(Data(json.utf8))
        #expect(c.commonFields.first?.kind == .unknown("hologramm"))
        #expect(c.types.first?.startLabel == "Beginn")
    }

    @Test("Schweizer Rechtschreibung: kein ß im Katalog")
    func noEszett() throws {
        let url = try #require(Bundle.main.url(forResource: "event-types", withExtension: "json"))
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(!text.contains("ß"))
    }
}
