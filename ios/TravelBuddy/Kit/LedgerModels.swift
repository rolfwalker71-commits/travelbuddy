import Foundation

// Reisekasse (Abrechnung). Formen entsprechen `server/src/ledgers/service.ts` aus HomeBuddy; der Vertrag
// lässt sie unverändert. Beträge sind durchgehend `…Minor` (Int). Daten `YYYY-MM-DD`, Zeitstempel UTC ISO 8601.

struct User: Codable, Equatable, Sendable, Identifiable {
    let id: Int
    let username: String
    let displayName: String
    let email: String?
    let isAdmin: Bool
}

struct LoginResponse: Decodable, Sendable {
    let token: String
    let user: User
}

struct MeResponse: Decodable, Sendable {
    let user: User
}

enum LedgerKind: String, Codable, Sendable {
    case split
    case cashbook
}

struct Ledger: Codable, Equatable, Sendable, Identifiable, Hashable {
    let id: Int
    let title: String
    let baseCurrency: String
    let kind: LedgerKind?
    let tripId: Int?
    let archivedAt: String?
    let createdAt: String?
    let updatedAt: String?

    var isArchived: Bool { archivedAt != nil }
}

struct Member: Codable, Equatable, Sendable, Identifiable, Hashable {
    let id: Int
    let displayName: String
    let email: String?
    let userId: Int?
    let coupleId: Int?
    let hidden: Bool
}

struct MemberResponse: Decodable, Sendable {
    let member: Member
}

struct Couple: Codable, Equatable, Sendable, Identifiable {
    let id: Int
    let name: String
    let memberIds: [Int]
}

struct LedgerTotals: Codable, Equatable, Sendable {
    let expenseMinor: Int
    let incomeMinor: Int
    let netMinor: Int
    let count: Int
}

struct Balance: Codable, Equatable, Sendable, Identifiable {
    let memberId: Int
    let displayName: String
    let paidMinor: Int
    let owedMinor: Int
    let settlementsPaidMinor: Int
    let settlementsReceivedMinor: Int
    let netMinor: Int

    var id: Int { memberId }
}

struct Transfer: Codable, Equatable, Sendable, Identifiable, Hashable {
    let fromMemberId: Int
    let fromName: String
    let toMemberId: Int
    let toName: String
    let amountMinor: Int

    var id: String { "\(fromMemberId)>\(toMemberId):\(amountMinor)" }
}

struct LedgerOverview: Codable, Equatable, Sendable {
    let ledger: Ledger
    let members: [Member]
    let couples: [Couple]
    let totals: LedgerTotals
    let balances: [Balance]
    let suggestedTransfers: [Transfer]
    let payerDebts: [Transfer]

    /// «Nach Zahler» verrechnet paarweise und zeigt nach einem Ausgleich einen Ring offener
    /// Schulden, obwohl alle Salden 0 sind (ARCHITECTURE, «Offene Punkte»). Nur zeigen, wenn nicht alles 0.
    var hasOpenBalances: Bool { balances.contains { $0.netMinor != 0 } }
    var showsPayerDebts: Bool { hasOpenBalances && !payerDebts.isEmpty }
}

enum Direction: String, Codable, Sendable {
    case expense
    case income
}

enum SplitMode: String, Codable, Sendable {
    case equal
    case coupleEqual
    case exact
    case shares
}

struct ExpenseSplit: Codable, Equatable, Sendable {
    let memberId: Int
    let shareBaseMinor: Int
    let shareUnits: Double?
}

struct Place: Codable, Equatable, Sendable {
    let name: String?
    let lat: Double?
    let lon: Double?
}

struct Expense: Codable, Equatable, Sendable, Identifiable {
    let id: Int
    let ledgerId: Int
    let paidByMemberId: Int
    let createdByMemberId: Int?
    let direction: Direction
    let amountMinor: Int
    let currency: String
    let exchangeRate: Double
    let amountBaseMinor: Int
    let description: String?
    let expenseDate: String?
    let category: String?
    let note: String?
    let splitMode: SplitMode
    /// 0 offen, 1 automatisch ausgeglichen («bereits ausgeglichen»), 2 Paar-Ausgleich.
    let settledStatus: Int
    let documentId: Int?
    let tripEventId: Int?
    let place: Place?
    let splits: [ExpenseSplit]
    let createdAt: String
    let updatedAt: String

    /// Gleiche Gruppierung wie die Serverreihenfolge: Datum, sonst Erfassungstag.
    var dayKey: String { expenseDate ?? String(createdAt.prefix(10)) }
    var isForeignCurrency: Bool { exchangeRate != 1 }
    var isSettled: Bool { settledStatus != 0 }
}

struct ExpenseResponse: Decodable, Sendable {
    let expense: Expense
}

struct ExpenseListResponse: Decodable, Sendable {
    let expenses: [Expense]
}

struct Settlement: Codable, Equatable, Sendable, Identifiable {
    let id: Int
    let ledgerId: Int
    let fromMemberId: Int
    let toMemberId: Int
    let amountMinor: Int
    let currency: String
    let exchangeRate: Double
    let amountBaseMinor: Int
    let note: String?
    let settledAt: String
    let relatedExpenseId: Int?
    /// Automatisch aus einer Ausgabe entstanden; nur mit ihr zusammen verwaltbar.
    let auto: Bool
    let createdAt: String
}

struct SettlementResponse: Decodable, Sendable {
    let settlement: Settlement
}

struct SettlementListResponse: Decodable, Sendable {
    let settlements: [Settlement]
}

struct FxRate: Codable, Equatable, Sendable {
    let from: String
    let to: String
    /// Einheiten `to` pro 1 Einheit `from`.
    let rate: Double
    let date: String
    let source: String
}

struct OKResponse: Decodable, Sendable {
    let ok: Bool
}

// MARK: - Anfragen

struct AddMemberRequest: Encodable, Sendable {
    let displayName: String
}

struct UpdateLedgerRequest: Encodable, Sendable {
    var title: String?
    var archived: Bool?
    var baseCurrency: String?
}

/// Aufteilung einer Ausgabe. `coupleEqual` wird in dieser Version nicht erfasst, nur angezeigt.
enum SplitInput: Encodable, Equatable, Sendable {
    case equal(memberIds: [Int])
    case shares([ShareInput])
    case exact([ExactInput])

    struct ShareInput: Encodable, Equatable, Sendable {
        let memberId: Int
        let units: Double
    }

    struct ExactInput: Encodable, Equatable, Sendable {
        let memberId: Int
        let amountBaseMinor: Int
    }

    private enum CodingKeys: String, CodingKey { case mode, memberIds, shares, amounts }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .equal(let ids):
            try c.encode("equal", forKey: .mode)
            try c.encode(ids, forKey: .memberIds)
        case .shares(let shares):
            try c.encode("shares", forKey: .mode)
            try c.encode(shares, forKey: .shares)
        case .exact(let amounts):
            try c.encode("exact", forKey: .mode)
            try c.encode(amounts, forKey: .amounts)
        }
    }
}

/// Body für `POST` und `PATCH` …/expenses. Nicht gesetzte Felder werden weggelassen.
struct ExpenseBody: Encodable, Sendable {
    var paidByMemberId: Int?
    var amountMinor: Int
    var currency: String
    var exchangeRate: Double?
    var direction: Direction?
    var description: String?
    var expenseDate: String?
    var category: String?
    var split: SplitInput?
    /// Nur bei `POST`; `PATCH` kennt das Feld nicht.
    var preSettled: Bool?
    /// Verknüpfung mit einem Ereignis («In Reisekasse übernehmen»).
    var tripEventId: Int?
}

struct SettlementBody: Encodable, Sendable {
    let fromMemberId: Int
    let toMemberId: Int
    let amountMinor: Int
    var currency: String?
    var note: String?
    var settledAt: String?
}
