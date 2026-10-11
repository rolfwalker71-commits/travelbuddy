import Foundation

/// Währungs-Metadaten. Spiegelt `server/src/lib/money.ts`.
enum Currency {
    /// Währungen ohne Nachkommastellen (wie auf dem Server).
    static let zeroDecimal: Set<String> = ["JPY", "KRW", "ISK", "VND", "CLP", "UGX", "XAF", "XOF"]

    /// Auswahl für die Währungsmenüs (Reihenfolge = Anzeige).
    static let common: [String] = [
        "CHF", "EUR", "USD", "GBP", "JPY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK",
        "PLN", "CZK", "HUF", "TRY", "THB", "SGD", "HKD", "CNY", "ZAR", "MXN", "BRL", "AED", "ISK",
    ]

    static func exponent(of code: String) -> Int {
        zeroDecimal.contains(code.trimmingCharacters(in: .whitespaces).uppercased()) ? 0 : 2
    }

    /// `common`, ergänzt um Währungen, die schon vorkommen, aber nicht in der Liste stehen.
    static func choices(including extra: [String]) -> [String] {
        var out = common
        for code in extra where !out.contains(code) { out.append(code) }
        return out
    }
}

/// Geld ist überall `Int` in Minor Units (Rappen, Cent, Yen …). Hier liegt alles,
/// was Beträge aus Text liest oder als Text ausgibt – ohne Fliesskomma.
enum Money {
    /// Obergrenze wie `Number.isSafeInteger` auf dem Server.
    static let maxMinor = 9_007_199_254_740_991

    static let groupingSeparator = "\u{2019}"   // ’  (de-CH)
    static let decimalSeparator = "."
    static let minusSign = "\u{2212}"           // −

    // MARK: Parsen

    /// Liest eine Betragseingabe exakt in Minor Units.
    ///
    /// Akzeptiert `1234.5`, `1’234.50`, `1 234,50`, `.5`. Genau ein Dezimaltrennzeichen
    /// (`.` oder `,`); Tausendertrenner (`’ ' Leerzeichen`) werden ignoriert.
    /// Mehr Nachkommastellen als die Währung kennt sind nur erlaubt, wenn sie `0` sind
    /// (es wird nie gerundet). Liefert `nil` bei ungültiger Eingabe.
    static func parseMinor(_ input: String, currency: String, allowNegative: Bool = false) -> Int? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let ignorable: Set<Character> = ["\u{2019}", "'", "\u{02BC}", "\u{2018}", " ", "\u{00A0}", "\u{202F}", "\u{2009}"]
        text.removeAll { ignorable.contains($0) }

        var negative = false
        if let first = text.first, first == "-" || first == "\u{2212}" {
            negative = true
            text.removeFirst()
        }
        if negative && !allowNegative { return nil }
        guard !text.isEmpty else { return nil }

        let separators = text.filter { $0 == "." || $0 == "," }
        guard separators.count <= 1 else { return nil }

        let parts = text.split(omittingEmptySubsequences: false) { $0 == "." || $0 == "," }
        guard parts.count <= 2 else { return nil }
        let intPart = String(parts[0])
        var fracPart = parts.count == 2 ? String(parts[1]) : ""
        guard !(intPart.isEmpty && fracPart.isEmpty) else { return nil }
        guard intPart.allSatisfy(Self.isASCIIDigit), fracPart.allSatisfy(Self.isASCIIDigit) else { return nil }

        let exp = Currency.exponent(of: currency)
        if fracPart.count > exp {
            let extra = fracPart.dropFirst(exp)
            guard extra.allSatisfy({ $0 == "0" }) else { return nil }
            fracPart = String(fracPart.prefix(exp))
        }
        while fracPart.count < exp { fracPart.append("0") }

        let digits = (intPart.isEmpty ? "0" : intPart) + fracPart
        guard let value = Int(digits), value <= maxMinor else { return nil }
        return negative ? -value : value
    }

    private static func isASCIIDigit(_ c: Character) -> Bool {
        c.isASCII && c.isNumber
    }

    // MARK: Ausgeben

    /// `1’234.50` (ohne Währungscode). Negativ mit typografischem Minus.
    static func formatMinor(_ minor: Int, currency: String) -> String {
        let exp = Currency.exponent(of: currency)
        let magnitude = minor.magnitude
        let divisor = UInt(pow10(exp))
        let whole = magnitude / divisor
        let fraction = magnitude % divisor

        var text = group(String(whole))
        if exp > 0 {
            var frac = String(fraction)
            while frac.count < exp { frac = "0" + frac }
            text += decimalSeparator + frac
        }
        return minor < 0 ? minusSign + text : text
    }

    /// `CHF 1’234.50`; mit `signed` zusätzlich ein `+` bei positiven Beträgen.
    static func formatted(_ minor: Int, currency: String, signed: Bool = false) -> String {
        let body = "\(currency.uppercased()) \(formatMinor(abs(minor), currency: currency))"
        if minor < 0 { return minusSign + body }
        return signed && minor > 0 ? "+" + body : body
    }

    /// Wert für Eingabefelder: `1234.50`, ohne Tausendertrenner.
    static func inputString(_ minor: Int, currency: String) -> String {
        formatMinor(minor, currency: currency).replacingOccurrences(of: groupingSeparator, with: "")
    }

    /// Ganzzahl mit Tausendertrenner nach de-CH: `247` → `247`, `1039` → `1’039`.
    static func groupedCount(_ value: Int) -> String {
        let text = group(String(abs(value)))
        return value < 0 ? minusSign + text : text
    }

    private static func group(_ digits: String) -> String {
        guard digits.count > 3 else { return digits }
        var out = ""
        for (offset, ch) in digits.reversed().enumerated() {
            if offset > 0 && offset % 3 == 0 { out.append(contentsOf: groupingSeparator) }
            out.append(ch)
        }
        return String(out.reversed())
    }

    private static func pow10(_ exp: Int) -> Int {
        var r = 1
        for _ in 0..<exp { r *= 10 }
        return r
    }

    // MARK: Umrechnen

    /// Wie `convertMinor` auf dem Server: `rate` = Einheiten `to` pro 1 Einheit `from`,
    /// symmetrisch gerundet. Nur für die Vorschau; massgebend ist immer die Serverantwort.
    static func convertMinor(_ amountMinor: Int, from: String, to: String, rate: Double) -> Int {
        let f = from.uppercased(), t = to.uppercased()
        if f == t { return amountMinor }
        let factor = rate * pow(10, Double(Currency.exponent(of: t) - Currency.exponent(of: f)))
        return Int((Double(amountMinor) * factor).rounded(.toNearestOrAwayFromZero))
    }

    /// Wechselkurs für Anzeige/Eingabe: höchstens 6 Nachkommastellen, mindestens 2.
    static func formatRate(_ rate: Double) -> String {
        var text = String(format: "%.6f", rate)
        while text.hasSuffix("0"), let dot = text.firstIndex(of: "."),
              text.distance(from: dot, to: text.endIndex) > 3 {
            text.removeLast()
        }
        return text
    }

    /// Kurs aus Text (`0.9412` oder `0,9412`). `nil`, wenn nicht positiv/endlich.
    static func parseRate(_ input: String) -> Double? {
        let text = input.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !text.isEmpty, let v = Double(text), v.isFinite, v > 0 else { return nil }
        return v
    }
}
