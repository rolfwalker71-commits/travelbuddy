import Foundation

/// «In Reisekasse übernehmen»: aus Preis und Zahlungsangaben eines Ereignisses eine Ausgabe der Reisekasse machen.
enum LedgerTakeover {
    enum Failure: LocalizedError {
        case noPrice, noLedger, noMembers
        var errorDescription: String? {
            switch self {
            case .noPrice: "Das Ereignis hat noch keinen Preis."
            case .noLedger: "Für diese Reise gibt es noch keine Reisekasse."
            case .noMembers: "Die Reisekasse hat keine Teilnehmer."
            }
        }
    }

    /// Reiner Aufbau des Bodys (testbar). `rate` ist `to`-Einheiten pro `from`-Einheit, wenn die Währungen abweichen.
    static func body(event: TripEvent, baseCurrency: String, memberIDs: [Int], payerID: Int?, rate: Double?,
                     fallbackCurrency: String, today: String) -> ExpenseBody? {
        guard let price = event.priceMinor, price > 0, !memberIDs.isEmpty else { return nil }
        let currency = (event.currency ?? fallbackCurrency).uppercased()
        let beneficiaries = event.participantIds.isEmpty ? memberIDs : memberIDs.filter { event.participantIds.contains($0) }
        let split = beneficiaries.isEmpty ? memberIDs : beneficiaries
        let payer = payerID ?? event.paidByParticipantId ?? memberIDs.first
        let foreign = currency != baseCurrency.uppercased()
        return ExpenseBody(
            paidByMemberId: payer, amountMinor: price, currency: currency, exchangeRate: foreign ? rate : nil,
            direction: nil, description: event.title, expenseDate: event.startDate ?? today,
            category: event.type, split: .equal(memberIds: split), preSettled: nil,
            tripEventId: event.id)
    }

    @MainActor
    static func perform(store: TravelStore, event: TripEvent) async throws {
        guard event.priceMinor != nil else { throw Failure.noPrice }
        guard let ledgerID = store.currentLedgerID(tripID: event.tripId) else { throw Failure.noLedger }
        let overview = try await store.api.ledger(id: ledgerID)
        let ids = overview.members.filter { !$0.hidden }.map(\.id)
        guard !ids.isEmpty else { throw Failure.noMembers }
        let fallback = store.trip(id: event.tripId)?.currency ?? overview.ledger.baseCurrency
        let currency = (event.currency ?? fallback).uppercased()
        var rate: Double?
        if currency != overview.ledger.baseCurrency.uppercased() {
            rate = try await store.api.fxRate(from: currency, to: overview.ledger.baseCurrency, date: event.startDate).rate
        }
        let me = store.myParticipantID(tripID: event.tripId)
        guard let body = body(event: event, baseCurrency: overview.ledger.baseCurrency, memberIDs: ids,
                              payerID: event.paidByParticipantId ?? me, rate: rate, fallbackCurrency: fallback,
                              today: TBDate.isoString(from: AppClock.now)) else { throw Failure.noPrice }
        _ = try await store.api.createExpense(ledgerID: ledgerID, body)
        await store.refreshDetail(id: event.tripId)
    }
}
