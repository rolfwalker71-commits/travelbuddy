import Foundation
import Observation

struct ExpenseDayGroup: Identifiable, Equatable {
    let dayKey: String
    let expenses: [Expense]
    var id: String { dayKey }
}

/// Reisekasse einer Reise: Übersicht, Ausgaben, Rückzahlungen. Offline bleibt der letzte Stand lesbar.
@MainActor
@Observable
final class LedgerModel {
    struct Snapshot: Codable {
        var overview: LedgerOverview
        var expenses: [Expense]
        var settlements: [Settlement]
    }

    let api: any TravelAPI
    let ledgerID: Int
    let userID: Int
    private let cache: OfflineStore?
    var onChange: () -> Void = {}

    private(set) var overview: LedgerOverview?
    private(set) var expenses: [Expense] = []
    private(set) var settlements: [Settlement] = []
    private(set) var state: LoadState = .idle
    private(set) var isOffline = false
    private(set) var savedAt: Date?

    init(api: any TravelAPI, ledgerID: Int, userID: Int, cache: OfflineStore? = nil) {
        self.api = api
        self.ledgerID = ledgerID
        self.userID = userID
        self.cache = cache
        if let c = cache?.load(Snapshot.self, name: CacheKey.ledger(ledgerID)) {
            overview = c.value.overview; expenses = c.value.expenses; settlements = c.value.settlements
            savedAt = c.savedAt; state = .loaded
        }
    }

    // MARK: Abgeleitet

    var baseCurrency: String { overview?.ledger.baseCurrency ?? "CHF" }
    var members: [Member] { (overview?.members ?? []).filter { !$0.hidden } }
    var myMemberID: Int? { overview?.members.first { $0.userId == userID }?.id }

    var myBalanceMinor: Int? {
        guard let id = myMemberID else { return nil }
        return overview?.balances.first { $0.memberId == id }?.netMinor
    }

    func memberName(_ id: Int) -> String {
        overview?.members.first { $0.id == id }?.displayName
            ?? overview?.balances.first { $0.memberId == id }?.displayName ?? "Unbekannt"
    }

    func isMe(_ id: Int) -> Bool { id == myMemberID }

    var expenseGroups: [ExpenseDayGroup] {
        var order: [String] = []
        var buckets: [String: [Expense]] = [:]
        for e in expenses {
            if buckets[e.dayKey] == nil { order.append(e.dayKey) }
            buckets[e.dayKey, default: []].append(e)
        }
        return order.map { ExpenseDayGroup(dayKey: $0, expenses: buckets[$0] ?? []) }
    }

    // MARK: Laden

    func load() async {
        if overview == nil { state = .loading }
        do {
            async let o = api.ledger(id: ledgerID)
            async let e = api.expenses(ledgerID: ledgerID)
            async let s = api.settlements(ledgerID: ledgerID)
            let (overview, expenses, settlements) = try await (o, e, s)
            self.overview = overview; self.expenses = expenses; self.settlements = settlements
            state = .loaded
            isOffline = false
            savedAt = Date()
            cache?.save(Snapshot(overview: overview, expenses: expenses, settlements: settlements), as: CacheKey.ledger(ledgerID))
        } catch {
            if error.isCancellation { return }
            if error.isOffline { isOffline = true }
            state = overview == nil ? .failed(error.userMessage) : .loaded
        }
    }

    private func reload() async { await load(); onChange() }

    // MARK: Schreiben

    func recordTransfer(from: Int, to: Int, amountMinor: Int, note: String?, dateISO: String) async throws {
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await api.createSettlement(ledgerID: ledgerID, SettlementBody(
            fromMemberId: from, toMemberId: to, amountMinor: amountMinor, currency: baseCurrency,
            note: trimmed?.isEmpty == false ? trimmed : nil, settledAt: dateISO))
        await reload()
    }

    func save(expense body: ExpenseBody, editing: Expense?) async throws {
        if let editing { _ = try await api.updateExpense(ledgerID: ledgerID, expenseID: editing.id, body) }
        else { _ = try await api.createExpense(ledgerID: ledgerID, body) }
        await reload()
    }

    func deleteExpense(_ e: Expense) async throws {
        try await api.deleteExpense(ledgerID: ledgerID, expenseID: e.id)
        await reload()
    }

    func deleteSettlement(_ s: Settlement) async throws {
        try await api.deleteSettlement(ledgerID: ledgerID, settlementID: s.id)
        await reload()
    }
}
