import Foundation

/// Formulierung von Salden: `net > 0` bekommt Geld, `net < 0` schuldet.
enum BalancePhrase {
    enum Tone: Sendable { case positive, negative, neutral }

    static func tone(net: Int) -> Tone {
        net > 0 ? .positive : (net < 0 ? .negative : .neutral)
    }

    /// `du bekommst CHF 12.30` · `Anna schuldet CHF 5.00` · `ausgeglichen`.
    /// - Parameter subject: `nil` heisst «ich» (du-Form); sonst der Name der Person.
    static func text(net: Int, currency: String, subject: String?) -> String {
        let amount = Money.formatted(abs(net), currency: currency)
        switch tone(net: net) {
        case .neutral: return "ausgeglichen"
        case .positive: return subject == nil ? "du bekommst \(amount)" : "bekommt \(amount)"
        case .negative: return subject == nil ? "du schuldest \(amount)" : "schuldet \(amount)"
        }
    }
}
