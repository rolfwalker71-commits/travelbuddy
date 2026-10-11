import Foundation

/// Vorschau der Aufteilung im Client. Spiegelt `server/src/ledgers/splits.ts`
/// (Prinzip des grössten Restes; Summe == Total). Massgebend bleibt der Server.
enum SplitCalculator {
    /// `memberID → Anteil in Minor Units`.
    static func byWeights(total: Int, items: [(id: Int, weight: Double)]) -> [Int: Int] {
        guard !items.isEmpty else { return [:] }
        let totalWeight = items.reduce(0) { $0 + $1.weight }
        guard totalWeight > 0 else { return [:] }

        let sign = total < 0 ? -1 : 1
        let absolute = abs(total)

        struct Part { var id: Int; var index: Int; var floor: Int; var frac: Double }
        var parts = items.enumerated().map { index, item -> Part in
            let exact = Double(absolute) * item.weight / totalWeight
            let floor = Int((exact + 1e-9).rounded(.down))
            return Part(id: item.id, index: index, floor: floor, frac: exact - Double(floor))
        }
        var remainder = absolute - parts.reduce(0) { $0 + $1.floor }
        let order = parts.indices.sorted {
            if parts[$0].frac != parts[$1].frac { return parts[$0].frac > parts[$1].frac }
            return parts[$0].index < parts[$1].index
        }
        for i in order {
            if remainder <= 0 { break }
            parts[i].floor += 1
            remainder -= 1
        }
        return Dictionary(uniqueKeysWithValues: parts.map { ($0.id, sign * $0.floor) })
    }

    static func equal(total: Int, memberIDs: [Int]) -> [Int: Int] {
        byWeights(total: total, items: memberIDs.map { (id: $0, weight: 1) })
    }

    static func shares(total: Int, units: [(memberID: Int, units: Double)]) -> [Int: Int] {
        byWeights(total: total, items: units.map { (id: $0.memberID, weight: $0.units) })
    }

    /// Differenz `total − Summe(amounts)`; 0 heisst: passt auf den Rappen.
    static func exactRemainder(total: Int, amounts: [Int]) -> Int {
        total - amounts.reduce(0, +)
    }
}
