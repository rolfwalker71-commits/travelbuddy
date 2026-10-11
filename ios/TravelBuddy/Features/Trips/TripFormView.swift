import SwiftUI

/// Reise anlegen oder bearbeiten: Titel, Ziel, Zeitraum, Zeitzone, Währung, Mitreisende.
struct TripFormView: View {
    enum Mode { case create; case edit(Trip) }
    let mode: Mode
    var onSaved: (Int) -> Void

    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var destination = ""
    @State private var startDate: String?
    @State private var endDate: String?
    @State private var summary = ""
    @State private var notes = ""
    @State private var status: TripStatus = .planned
    @State private var timezone: String? = TimeZone.current.identifier
    @State private var currency = "CHF"
    @State private var directory: [DirectoryUser] = []
    @State private var selectedUsers: Set<Int> = []
    @State private var guestNames: [String] = []
    @State private var newGuest = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var isCreate: Bool { if case .create = mode { true } else { false } }
    private var endsBeforeStart: Bool { if let s = startDate, let e = endDate { e < s } else { false } }
    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !endsBeforeStart && !isSaving }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
                Section {
                    TextFieldRow(label: "Titel", text: $title, required: true)
                    TextFieldRow(label: "Ziel", text: $destination)
                    DateFieldRow(label: "Abreise", value: $startDate)
                    DateFieldRow(label: "Rückkehr", value: $endDate)
                    if endsBeforeStart { InlineMessage(text: "Die Rückkehr liegt vor der Abreise.", style: .warning) }
                } header: { TBLabel("Reise") }.tbRow()

                Section {
                    TimeZoneFieldRow(label: "Zeitzone der Reise", zoneID: $timezone, tripZoneID: TimeZone.current.identifier)
                    SelectFieldRow(label: "Währung der Reisekasse",
                                   options: Currency.choices(including: [currency]).map { ($0, $0) },
                                   selection: Binding(get: { currency }, set: { currency = $0 ?? "CHF" }))
                } header: { TBLabel("Zeit und Geld") }.tbRow()

                Section {
                    TextFieldRow(label: "Zusammenfassung", text: $summary, axis: .vertical)
                    if !isCreate { TextFieldRow(label: "Notizen", text: $notes, axis: .vertical) }
                    if !isCreate {
                        SelectFieldRow(label: "Status", options: [("planned", "Geplant"), ("active", "Unterwegs"), ("done", "Abgeschlossen"), ("cancelled", "Abgesagt")],
                                       selection: Binding(get: { status.rawValue }, set: { status = TripStatus(rawValue: $0 ?? "planned") ?? .planned }))
                    }
                } header: { TBLabel("Weiteres") }.tbRow()

                if isCreate {
                    Section {
                        ForEach(directory.filter { $0.id != store.user.id }) { u in
                            Toggle(u.displayName, isOn: Binding(get: { selectedUsers.contains(u.id) },
                                                                 set: { if $0 { selectedUsers.insert(u.id) } else { selectedUsers.remove(u.id) } }))
                                .tint(Palette.accent).tbText(16)
                        }
                        ForEach(guestNames, id: \.self) { n in
                            HStack { Text(n).tbText(16); Spacer(); Button { guestNames.removeAll { $0 == n } } label: { Image(systemName: "minus.circle") }.foregroundStyle(Palette.mute) }
                        }
                        HStack {
                            TextField("Gast ohne Konto hinzufügen", text: $newGuest).font(TB.Font.text(16))
                                .onSubmit(addGuest)
                            Button("Hinzufügen", action: addGuest).disabled(newGuest.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    } header: { TBLabel("Mitreisende") } footer: {
                        Text("Du bist automatisch dabei. Gäste brauchen kein Konto und erhalten einen Link.").tbText(12, color: Palette.mute)
                    }
                    .tbRow()
                }
            }
            .tbList()
            .navigationTitle(isCreate ? "Neue Reise" : "Reise bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if isSaving { ProgressView() } else { Text("Sichern") } }.disabled(!canSave)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .task {
                if case .edit(let t) = mode, title.isEmpty {
                    title = t.title; destination = t.destination ?? ""; startDate = t.startDate; endDate = t.endDate
                    summary = t.summary ?? ""; notes = t.notes ?? ""; status = t.status
                    timezone = t.timezone ?? timezone; currency = t.currency
                }
                if isCreate { directory = (try? await store.api.userDirectory()) ?? [] }
            }
        }
    }

    private func addGuest() {
        let n = newGuest.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        guestNames.append(n)
        newGuest = ""
    }

    private func clean(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func save() async {
        isSaving = true; errorMessage = nil
        defer { isSaving = false }
        do {
            switch mode {
            case .create:
                var travelers: [TravelerInput] = selectedUsers.compactMap { id in
                    directory.first { $0.id == id }.map { TravelerInput(displayName: $0.displayName, email: nil, userId: $0.id) }
                }
                travelers += guestNames.map { TravelerInput(displayName: $0, email: nil, userId: nil) }
                let req = CreateTripRequest(title: title.trimmingCharacters(in: .whitespacesAndNewlines), destination: clean(destination),
                                            startDate: startDate, endDate: endDate, summary: clean(summary), homeCurrency: currency,
                                            timezone: timezone, travelers: travelers)
                let id = try await store.createTrip(req)
                onSaved(id)
            case .edit(let t):
                let req = UpdateTripRequest(title: title.trimmingCharacters(in: .whitespacesAndNewlines), destination: clean(destination),
                                            startDate: startDate, endDate: endDate, summary: clean(summary), notes: clean(notes),
                                            status: status, homeCurrency: currency, timezone: timezone)
                try await store.updateTrip(id: t.id, req)
                onSaved(t.id)
            }
            dismiss()
        } catch {
            if error.isCancellation { return }
            errorMessage = error.writeMessage
        }
    }
}
