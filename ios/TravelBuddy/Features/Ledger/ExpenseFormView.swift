import SwiftUI

/// Ausgabe erfassen oder bearbeiten: Betrag, Währung mit Kurs, Zahler, Aufteilung (gleich, Anteile, exakt).
struct ExpenseFormView: View {
    let model: LedgerModel
    let editing: Expense?

    @Environment(\.dismiss) private var dismiss
    @State private var draft: ExpenseDraft
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var fetchingRate = false

    init(model: LedgerModel, editing: Expense?) {
        self.model = model
        self.editing = editing
        let ids = model.members.map(\.id)
        let today = TBDate.isoString(from: AppClock.now)
        if let editing {
            _draft = State(initialValue: ExpenseDraft(editing: editing, baseCurrency: model.baseCurrency, memberIDs: ids, isCashbook: false, today: today))
        } else {
            _draft = State(initialValue: ExpenseDraft(baseCurrency: model.baseCurrency, memberIDs: ids, isCashbook: false, today: today,
                                                      paidByMemberID: model.myMemberID ?? ids.first))
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
                Section {
                    HStack(spacing: 10) {
                        TextField("0.00", text: $draft.amountText)
                            .font(TB.Font.mono(26, weight: .semibold)).keyboardType(.decimalPad)
                        Menu {
                            ForEach(Currency.choices(including: [draft.currency]), id: \.self) { c in Button(c) { draft.currency = c; if draft.isForeign { Task { await fetchRate() } } } }
                        } label: {
                            Text(draft.currency).tbMono(16, weight: .semibold, color: Palette.accent)
                                .padding(.horizontal, 10).padding(.vertical, 6).background(Palette.surface2, in: RoundedRectangle(cornerRadius: 6))
                        }
                    }
                    .touchTarget()
                    if draft.isForeign {
                        HStack {
                            Text("Kurs").tbText(16)
                            TextField("1.000000", text: $draft.rateText).keyboardType(.decimalPad).multilineTextAlignment(.trailing).font(TB.Font.mono(16))
                            Button { Task { await fetchRate() } } label: { Image(systemName: fetchingRate ? "hourglass" : "arrow.clockwise") }
                                .accessibilityLabel("Kurs der EZB laden")
                        }
                        if let base = draft.baseMinor {
                            Text("≈ \(Money.formatted(base, currency: draft.baseCurrency))").tbMono(14, weight: .regular, color: Palette.mute)
                        }
                    }
                    TextFieldRow(label: "Beschreibung", text: $draft.description)
                    DateFieldRow(label: "Datum", value: Binding(get: { draft.dateISO }, set: { if let v = $0 { draft.dateISO = v } }))
                } header: { TBLabel("Betrag") }.tbRow()

                Section {
                    Picker("Bezahlt von", selection: $draft.paidByMemberID) {
                        ForEach(model.members) { m in Text(model.isMe(m.id) ? "\(m.displayName) (du)" : m.displayName).tag(Optional(m.id)) }
                    }
                    .font(TB.Font.text(16))
                } header: { TBLabel("Zahler") }.tbRow()

                Section {
                    if draft.splitKind != .couples {
                        Picker("Aufteilung", selection: Binding(get: { draft.splitKind }, set: { draft.switchSplit(to: $0) })) {
                            Text("Gleich").tag(ExpenseDraft.SplitKind.equal)
                            Text("Anteile").tag(ExpenseDraft.SplitKind.shares)
                            Text("Exakt").tag(ExpenseDraft.SplitKind.exact)
                        }.pickerStyle(.segmented)
                    } else {
                        Text("Aufteilung nach Paaren (nur Anzeige).").tbText(14, color: Palette.mute)
                    }
                    let preview = draft.sharePreview
                    ForEach(model.members) { m in
                        HStack(spacing: 10) {
                            if draft.splitKind == .equal || draft.splitKind == .shares || draft.splitKind == .couples {
                                Button {
                                    if draft.includedMemberIDs.contains(m.id) { draft.includedMemberIDs.remove(m.id) } else { draft.includedMemberIDs.insert(m.id) }
                                } label: {
                                    Image(systemName: draft.includedMemberIDs.contains(m.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(draft.includedMemberIDs.contains(m.id) ? Palette.accent : Palette.mute)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(m.displayName) beteiligt")
                                .accessibilityValue(draft.includedMemberIDs.contains(m.id) ? "ja" : "nein")
                            }
                            Text(model.isMe(m.id) ? "\(m.displayName) (du)" : m.displayName).tbText(16)
                            Spacer()
                            if draft.splitKind == .shares {
                                TextField("1", text: Binding(get: { draft.unitsText[m.id] ?? "1" }, set: { draft.unitsText[m.id] = $0 }))
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 56).font(TB.Font.mono(15))
                            } else if draft.splitKind == .exact {
                                TextField("0.00", text: Binding(get: { draft.exactText[m.id] ?? "" }, set: { draft.exactText[m.id] = $0 }))
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 100).font(TB.Font.mono(15))
                            } else if let share = preview[m.id] {
                                Text(Money.formatMinor(share, currency: draft.baseCurrency)).tbMono(15, weight: .medium, color: Palette.mute)
                            }
                        }
                        .touchTarget()
                    }
                    if draft.splitKind == .exact, let rest = draft.exactRemainder, rest != 0 {
                        Text(rest > 0 ? "Es fehlen noch \(Money.formatted(rest, currency: draft.baseCurrency))." : "Die Anteile liegen \(Money.formatted(-rest, currency: draft.baseCurrency)) über dem Betrag.")
                            .tbText(14, color: Palette.negative)
                    }
                } header: { TBLabel("Aufteilung auf") }.tbRow()

                if editing == nil {
                    Section {
                        Toggle("Bereits ausgeglichen", isOn: $draft.preSettled).tint(Palette.accent).tbText(16)
                    }.tbRow()
                }
                let issues = draft.issues
                if !issues.isEmpty && !draft.amountText.isEmpty {
                    Section { ForEach(issues, id: \.self) { InlineMessage(text: $0, style: .warning) } }.listRowBackground(Color.clear)
                }
            }
            .tbList()
            .navigationTitle(editing == nil ? "Ausgabe erfassen" : "Ausgabe bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if isSaving { ProgressView() } else { Text("Sichern") } }
                        .disabled(!draft.isValid || isSaving)
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private func fetchRate() async {
        guard draft.isForeign else { return }
        fetchingRate = true; defer { fetchingRate = false }
        if let r = try? await model.api.fxRate(from: draft.currency, to: draft.baseCurrency, date: draft.dateISO) {
            draft.rateText = Money.formatRate(r.rate)
        }
    }

    private func save() async {
        guard let body = draft.makeBody(isNew: editing == nil) else { return }
        isSaving = true; errorMessage = nil; defer { isSaving = false }
        do { try await model.save(expense: body, editing: editing); dismiss() }
        catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}

/// Überweisung als bezahlt erfassen. Betrag ist vorbelegt, aber änderbar (Teilzahlung).
struct SettleSheet: View {
    let transfer: Transfer
    let currency: String
    let isMeFrom: Bool
    let isMeTo: Bool
    var onSave: (Int, String?, String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var amountText: String
    @State private var dateISO = TBDate.isoString(from: AppClock.now)
    @State private var note = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(transfer: Transfer, currency: String, isMeFrom: Bool, isMeTo: Bool, onSave: @escaping (Int, String?, String) async throws -> Void) {
        self.transfer = transfer; self.currency = currency; self.isMeFrom = isMeFrom; self.isMeTo = isMeTo; self.onSave = onSave
        _amountText = State(initialValue: Money.inputString(transfer.amountMinor, currency: currency))
    }

    private var amountMinor: Int? {
        guard let v = Money.parseMinor(amountText, currency: currency), v > 0 else { return nil }
        return v
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Von") { Text(isMeFrom ? "\(transfer.fromName) (du)" : transfer.fromName).tbText(16, weight: .semibold) }
                    LabeledContent("An") { Text(isMeTo ? "\(transfer.toName) (du)" : transfer.toName).tbText(16, weight: .semibold) }
                }.tbRow()
                Section {
                    HStack {
                        TextField("Betrag", text: $amountText).font(TB.Font.mono(22, weight: .semibold)).keyboardType(.decimalPad)
                        Text(currency).tbMono(15, weight: .semibold, color: Palette.mute)
                    }
                    .touchTarget()
                    DateFieldRow(label: "Datum", value: Binding(get: { dateISO }, set: { if let v = $0 { dateISO = v } }))
                    TextFieldRow(label: "Notiz", text: $note)
                } header: { TBLabel("Betrag") } footer: {
                    Text("Vorschlag: \(Money.formatted(transfer.amountMinor, currency: currency)). Bei einer Teilzahlung den Betrag anpassen.")
                        .tbText(12, color: Palette.mute)
                }.tbRow()
                if amountMinor == nil && !amountText.isEmpty {
                    Section { InlineMessage(text: "Betrag ist ungültig (z. B. 12.50).", style: .warning) }.listRowBackground(Color.clear)
                }
                if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
            }
            .tbList()
            .navigationTitle("Rückzahlung erfassen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Erfassen") { Task { await save() } }.disabled(amountMinor == nil || isSaving)
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        guard let amount = amountMinor else { return }
        isSaving = true; errorMessage = nil; defer { isSaving = false }
        do { try await onSave(amount, note, dateISO); dismiss() }
        catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}
