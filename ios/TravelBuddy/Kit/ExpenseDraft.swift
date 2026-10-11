import Foundation

/// Eingabestand des Ausgabenformulars (Textfelder als Strings) samt Validierung,
/// Vorschau der Aufteilung und Aufbau des API-Bodys. Rein logisch, ohne UI → testbar.
struct ExpenseDraft: Equatable, Sendable {
    enum SplitKind: String, CaseIterable, Sendable {
        case equal, shares, exact
        /// Nur bei bestehenden Ausgaben mit Paar-Aufteilung: wird angezeigt, nicht neu erfasst.
        case couples
    }

    // Kontext (unveränderlich während des Bearbeitens)
    let baseCurrency: String
    /// Sichtbare Teilnehmer in Anzeigereihenfolge (bestimmt auch die Reihenfolge beim Aufrunden).
    let memberIDs: [Int]
    let isCashbook: Bool
    /// Bei `.couples`: Basisbetrag der gespeicherten Aufteilung; Änderung des Betrags ist dann nicht möglich.
    var lockedSplitBaseMinor: Int?

    // Eingaben
    var amountText = ""
    var currency: String
    var rateText = ""
    var description = ""
    var dateISO: String
    var paidByMemberID: Int?
    var direction: Direction = .expense
    var splitKind: SplitKind = .equal
    var includedMemberIDs: Set<Int>
    var unitsText: [Int: String] = [:]
    var exactText: [Int: String] = [:]
    var preSettled = false

    init(baseCurrency: String, memberIDs: [Int], isCashbook: Bool, today: String, paidByMemberID: Int?) {
        self.baseCurrency = baseCurrency.uppercased()
        self.memberIDs = memberIDs
        self.isCashbook = isCashbook
        self.currency = baseCurrency.uppercased()
        self.dateISO = today
        self.paidByMemberID = paidByMemberID
        self.includedMemberIDs = Set(memberIDs)
    }

    /// Entwurf aus einer bestehenden Ausgabe.
    init(editing e: Expense, baseCurrency: String, memberIDs: [Int], isCashbook: Bool, today: String) {
        self.init(baseCurrency: baseCurrency, memberIDs: memberIDs, isCashbook: isCashbook,
                  today: e.expenseDate ?? today, paidByMemberID: e.paidByMemberId)
        currency = e.currency.uppercased()
        amountText = Money.inputString(e.amountMinor, currency: e.currency)
        if isForeign { rateText = Money.formatRate(e.exchangeRate) }
        description = e.description ?? ""
        direction = e.direction
        let rows = e.splits
        switch e.splitMode {
        case .equal:
            splitKind = .equal
            includedMemberIDs = Set(rows.map(\.memberId))
        case .shares:
            splitKind = .shares
            includedMemberIDs = Set(rows.map(\.memberId))
            for r in rows { unitsText[r.memberId] = Self.unitsString(r.shareUnits ?? 1) }
        case .exact:
            splitKind = .exact
            includedMemberIDs = Set(rows.map(\.memberId))
            for r in rows { exactText[r.memberId] = Money.inputString(r.shareBaseMinor, currency: baseCurrency) }
        case .coupleEqual:
            splitKind = .couples
            includedMemberIDs = Set(rows.filter { $0.shareBaseMinor > 0 }.map(\.memberId))
            lockedSplitBaseMinor = e.amountBaseMinor
        }
        preSettled = e.isSettled
    }

    // MARK: Abgeleitete Werte

    var isForeign: Bool { currency != baseCurrency }

    /// Betrag in Minor Units der Ausgabenwährung, `nil` bei fehlender/ungültiger Eingabe.
    var amountMinor: Int? {
        guard let v = Money.parseMinor(amountText, currency: currency), v > 0 else { return nil }
        return v
    }

    var exchangeRate: Double? {
        isForeign ? Money.parseRate(rateText) : 1
    }

    /// Betrag in der Basiswährung (wie ihn der Server speichert, solange der Kurs gleich bleibt).
    var baseMinor: Int? {
        guard let amount = amountMinor, let rate = exchangeRate else { return nil }
        return isForeign ? Money.convertMinor(amount, from: currency, to: baseCurrency, rate: rate) : amount
    }

    private static func unitsString(_ units: Double) -> String {
        units == units.rounded() ? String(Int(units)) : String(units)
    }

    func units(for id: Int) -> Double? {
        let text = (unitsText[id] ?? "1").trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        if text.isEmpty { return 0 }
        guard let v = Double(text), v.isFinite, v >= 0 else { return nil }
        return v
    }

    func exactMinor(for id: Int) -> Int? {
        let text = (exactText[id] ?? "").trimmingCharacters(in: .whitespaces)
        if text.isEmpty { return 0 }
        return Money.parseMinor(text, currency: baseCurrency, allowNegative: false)
    }

    /// Mitglieder in Teilnahme-Reihenfolge, die tatsächlich einen Anteil tragen.
    private var activeMemberIDs: [Int] {
        memberIDs.filter { includedMemberIDs.contains($0) }
    }

    /// Vorschau der Anteile in Basiswährung (leer, wenn noch nicht berechenbar).
    var sharePreview: [Int: Int] {
        guard let base = baseMinor else { return [:] }
        switch splitKind {
        case .equal:
            return SplitCalculator.equal(total: base, memberIDs: activeMemberIDs)
        case .shares:
            let items = activeMemberIDs.compactMap { id -> (memberID: Int, units: Double)? in
                guard let u = units(for: id), u > 0 else { return nil }
                return (id, u)
            }
            return SplitCalculator.shares(total: base, units: items)
        case .exact:
            var out: [Int: Int] = [:]
            for id in memberIDs { out[id] = exactMinor(for: id) ?? 0 }
            return out
        case .couples:
            return [:]
        }
    }

    /// `total − Summe` bei exakter Aufteilung; `nil` wenn nicht anwendbar oder Eingabe ungültig.
    var exactRemainder: Int? {
        guard splitKind == .exact, let base = baseMinor else { return nil }
        var sum = 0
        for id in memberIDs {
            guard let v = exactMinor(for: id) else { return nil }
            sum += v
        }
        return base - sum
    }

    // MARK: Prüfung

    /// Hinweise, warum nicht gespeichert werden kann (leer = gültig).
    var issues: [String] {
        var out: [String] = []
        if amountText.trimmingCharacters(in: .whitespaces).isEmpty {
            out.append("Betrag eingeben.")
        } else if amountMinor == nil {
            out.append("Betrag ist ungültig (z. B. 12.50).")
        }
        if isForeign && exchangeRate == nil {
            out.append("Wechselkurs eingeben (grösser als 0).")
        }
        if isCashbook { return out }

        if paidByMemberID == nil { out.append("Zahler wählen.") }
        switch splitKind {
        case .equal:
            if includedMemberIDs.isEmpty { out.append("Mindestens eine Person für die Aufteilung wählen.") }
        case .shares:
            let positive = activeMemberIDs.filter { (units(for: $0) ?? 0) > 0 }
            if positive.isEmpty { out.append("Mindestens eine Person mit Anteilen grösser als 0.") }
            if activeMemberIDs.contains(where: { units(for: $0) == nil }) {
                out.append("Anteile müssen Zahlen sein.")
            }
        case .exact:
            if memberIDs.contains(where: { exactMinor(for: $0) == nil }) {
                out.append("Ein Anteil ist ungültig.")
            } else if let rest = exactRemainder, rest != 0, baseMinor != nil {
                let text = Money.formatted(abs(rest), currency: baseCurrency)
                out.append(rest > 0 ? "Es fehlen noch \(text)." : "Die Anteile liegen \(text) über dem Betrag.")
            }
        case .couples:
            if let locked = lockedSplitBaseMinor, let base = baseMinor, base != locked {
                out.append("Bei Aufteilung nach Paaren kann der Betrag nicht geändert werden. Wähle eine andere Aufteilung.")
            }
        }
        return out
    }

    var isValid: Bool { issues.isEmpty && amountMinor != nil }

    // MARK: Body

    /// API-Body für `POST`/`PATCH`; `nil`, solange die Eingabe ungültig ist.
    func makeBody(isNew: Bool) -> ExpenseBody? {
        guard isValid, let amount = amountMinor else { return nil }
        var body = ExpenseBody(
            paidByMemberId: nil,
            amountMinor: amount,
            currency: currency,
            exchangeRate: isForeign ? exchangeRate : nil,
            direction: isCashbook ? direction : nil,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            expenseDate: dateISO,
            split: nil,
            preSettled: nil
        )
        if isCashbook { return body }

        body.paidByMemberId = paidByMemberID
        switch splitKind {
        case .equal:
            body.split = .equal(memberIds: activeMemberIDs)
        case .shares:
            body.split = .shares(activeMemberIDs.compactMap { id in
                guard let u = units(for: id), u > 0 else { return nil }
                return .init(memberId: id, units: u)
            })
        case .exact:
            body.split = .exact(memberIDs.compactMap { id in
                guard let v = exactMinor(for: id), v != 0 else { return nil }
                return .init(memberId: id, amountBaseMinor: v)
            })
        case .couples:
            body.split = nil   // unverändert lassen
        }
        if isNew && preSettled { body.preSettled = true }
        return body
    }

    // MARK: Hilfen für die Oberfläche

    /// Beim Wechsel auf «Exakt» die bisherige Verteilung als Startwert übernehmen.
    mutating func switchSplit(to kind: SplitKind) {
        if kind == .exact && splitKind != .exact {
            let preview = sharePreview
            exactText = [:]
            for (id, share) in preview where share != 0 {
                exactText[id] = Money.inputString(share, currency: baseCurrency)
            }
        }
        splitKind = kind
    }
}
