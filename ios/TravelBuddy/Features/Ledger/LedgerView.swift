import SwiftUI

/// Kasse: Reisekasse der aktuellen Reise (Salden, Ausgleich, Ausgaben, Rückzahlungen).
struct LedgerRootView: View {
    @Environment(TravelStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        Group {
            if let trip = store.currentTrip, let ledgerID = store.currentLedgerID(tripID: trip.id) {
                LedgerView(ledgerID: ledgerID, tripTitle: trip.title)
                    .id(ledgerID)
            } else if store.tripsState == .loading || store.tripsState == .idle {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack {
                    IllustrationCard(key: "kasse", height: 150).padding()
                    StateMessage(title: "Keine Reisekasse", systemImage: "creditcard",
                                 message: "Die Reisekasse entsteht mit der ersten Reise und teilt sich die Mitreisenden mit ihr.")
                    Spacer()
                }
            }
        }
        .tbScreen()
        .navigationTitle("Kasse")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct LedgerView: View {
    let ledgerID: Int
    var tripTitle: String?

    @Environment(TravelStore.self) private var store
    @State private var model: LedgerModel?
    @State private var editor: ExpenseTarget?
    @State private var settleTarget: Transfer?
    @State private var errorMessage: String?
    @State private var pendingDelete: Expense?

    private enum ExpenseTarget: Identifiable {
        case new
        case edit(Expense)
        var id: String { switch self { case .new: "new"; case .edit(let e): "e\(e.id)" } }
    }

    var body: some View {
        Group {
            if let model { content(model) } else { ProgressView() }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { editor = .new } label: { Image(systemName: "plus") }
                    .disabled(model?.overview == nil).accessibilityLabel("Ausgabe erfassen")
            }
        }
        .task {
            if model == nil {
                let m = LedgerModel(api: store.api, ledgerID: ledgerID, userID: store.user.id, cache: store.cache)
                m.onChange = { Task { await store.refreshSummary(); await store.refreshToday() } }
                model = m
            }
            await model?.load()
        }
        .sheet(item: $editor) { target in
            if let model {
                switch target {
                case .new: ExpenseFormView(model: model, editing: nil)
                case .edit(let e): ExpenseFormView(model: model, editing: e)
                }
            }
        }
        .sheet(item: $settleTarget) { t in
            if let model {
                SettleSheet(transfer: t, currency: model.baseCurrency, isMeFrom: model.isMe(t.fromMemberId), isMeTo: model.isMe(t.toMemberId)) { amount, note, date in
                    try await model.recordTransfer(from: t.fromMemberId, to: t.toMemberId, amountMinor: amount, note: note, dateISO: date)
                }
            }
        }
        .confirmationDialog("Ausgabe löschen?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                if let e = pendingDelete, let model { Task { do { try await model.deleteExpense(e) } catch { errorMessage = error.writeMessage } } }
            }
            Button("Abbrechen", role: .cancel) {}
        }
    }

    @ViewBuilder private func content(_ model: LedgerModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if model.isOffline { OfflineBanner(savedAt: model.savedAt) }
                if let errorMessage { InlineMessage(text: errorMessage) }
                if let overview = model.overview {
                    summary(model, overview)
                    balances(model, overview)
                    if !overview.suggestedTransfers.isEmpty { transfers(model, overview) }
                    expenses(model)
                    if !model.settlements.isEmpty { settlements(model) }
                } else if let m = model.state.errorMessage {
                    StateMessage(title: "Kasse nicht verfügbar", message: m, actionTitle: "Wiederholen") { Task { await model.load() } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
            .frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .refreshable { await model.load() }
    }

    private func summary(_ model: LedgerModel, _ o: LedgerOverview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let tripTitle { TBLabel(tripTitle) }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    TBLabel("Ausgaben gesamt", size: 11)
                    Text(Money.formatted(o.totals.expenseMinor, currency: o.ledger.baseCurrency)).tbMono(26, weight: .semibold, relativeTo: .title)
                }
                Spacer()
                if let mine = model.myBalanceMinor {
                    VStack(alignment: .trailing, spacing: 2) {
                        TBLabel("Mein Saldo", size: 11)
                        Text(BalancePhrase.text(net: mine, currency: o.ledger.baseCurrency, subject: nil))
                            .tbText(16, weight: .semibold, color: mine == 0 ? Palette.ink : (mine > 0 ? Palette.positive : Palette.negative))
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
    }

    private func balances(_ model: LedgerModel, _ o: LedgerOverview) -> some View {
        let maxMag = o.balances.map { abs($0.netMinor) }.max() ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Saldo je Person", trailing: o.ledger.baseCurrency)
            PlainCard {
                VStack(spacing: 12) {
                    ForEach(o.balances) { b in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(model.isMe(b.memberId) ? "\(b.displayName) (du)" : b.displayName).tbText(16, weight: .medium)
                                Spacer()
                                Text(Money.formatted(b.netMinor, currency: o.ledger.baseCurrency, signed: true))
                                    .tbMono(15, weight: .semibold, color: b.netMinor == 0 ? Palette.mute : (b.netMinor > 0 ? Palette.positive : Palette.negative))
                            }
                            BalanceBar(value: b.netMinor, maxMagnitude: maxMag)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(14)
            }
        }
    }

    private func transfers(_ model: LedgerModel, _ o: LedgerOverview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Ausgleich", trailing: "\(o.suggestedTransfers.count) Überweisung\(o.suggestedTransfers.count == 1 ? "" : "en")")
            PlainCard {
                VStack(spacing: 0) {
                    ForEach(Array(o.suggestedTransfers.enumerated()), id: \.element.id) { i, t in
                        HStack(spacing: 8) {
                            Text(t.fromName).tbText(15, weight: .semibold)
                            Image(systemName: "arrow.right").foregroundStyle(Palette.mute).accessibilityLabel("an")
                            Text(t.toName).tbText(15, weight: .semibold)
                            Spacer()
                            Text(Money.formatted(t.amountMinor, currency: o.ledger.baseCurrency)).tbMono(15, weight: .semibold)
                                .lineLimit(1).fixedSize()
                            Button("Erfassen") { settleTarget = t }.buttonStyle(.tbCompact)
                        }
                        .padding(12)
                        .accessibilityElement(children: .combine)
                        if i < o.suggestedTransfers.count - 1 { Divider().overlay(Palette.line) }
                    }
                }
            }
        }
    }

    private func expenses(_ model: LedgerModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Ausgaben", trailing: "\(model.expenses.count)")
            if model.expenses.isEmpty {
                Text("Noch keine Ausgaben.").tbText(15, color: Palette.mute)
            }
            ForEach(model.expenseGroups) { group in
                VStack(alignment: .leading, spacing: 6) {
                    Text(TBDate.longDay(group.dayKey)).tbText(13, weight: .semibold, color: Palette.mute)
                    PlainCard {
                        VStack(spacing: 0) {
                            ForEach(Array(group.expenses.enumerated()), id: \.element.id) { i, e in
                                Button { editor = .edit(e) } label: { expenseRow(model, e) }
                                    .buttonStyle(.plain)
                                    .contextMenu { Button(role: .destructive) { pendingDelete = e } label: { Label("Löschen", systemImage: "trash") } }
                                if i < group.expenses.count - 1 { Divider().overlay(Palette.line) }
                            }
                        }
                    }
                }
            }
        }
    }

    private func expenseRow(_ model: LedgerModel, _ e: Expense) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(e.description?.isEmpty == false ? e.description! : "Ausgabe").tbText(16, weight: .semibold).lineLimit(2)
                Text("bezahlt von \(model.isMe(e.paidByMemberId) ? "dir" : model.memberName(e.paidByMemberId))")
                    .tbText(13, color: Palette.mute)
                if e.isSettled { TBChip(text: "Ausgeglichen", symbol: "checkmark", tint: Palette.positive) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.formatted(e.amountMinor, currency: e.currency)).tbMono(15, weight: .semibold).lineLimit(1).fixedSize()
                if e.isForeignCurrency {
                    Text(Money.formatted(e.amountBaseMinor, currency: model.baseCurrency)).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                }
            }
        }
        .padding(12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func settlements(_ model: LedgerModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Rückzahlungen", trailing: "\(model.settlements.count)")
            PlainCard {
                VStack(spacing: 0) {
                    ForEach(Array(model.settlements.enumerated()), id: \.element.id) { i, s in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(model.memberName(s.fromMemberId)) → \(model.memberName(s.toMemberId))").tbText(15, weight: .semibold)
                                Text(TBDate.display(s.settledAt)).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                            }
                            Spacer()
                            Text(Money.formatted(s.amountMinor, currency: s.currency)).tbMono(15, weight: .semibold)
                        }
                        .padding(12)
                        .contextMenu {
                            if !s.auto { Button(role: .destructive) { Task { try? await model.deleteSettlement(s) } } label: { Label("Löschen", systemImage: "trash") } }
                        }
                        if i < model.settlements.count - 1 { Divider().overlay(Palette.line) }
                    }
                }
            }
        }
    }
}

