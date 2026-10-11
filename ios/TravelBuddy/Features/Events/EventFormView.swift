import SwiftUI

/// Ereignis erfassen oder bearbeiten, aus dem Katalog: Typ-Kacheln, dann Formular in Abschnitten mit Umschalter
/// «Wichtiges / Alle Felder», Zeitzonen vorbelegt, Preis und Zahlung, «In Reisekasse übernehmen», Löschen.
struct EventFormView: View {
    enum Mode {
        case create(tripID: Int, startDate: String?)
        case edit(TripEvent)
    }

    let mode: Mode
    var onSaved: (Int?) -> Void = { _ in }
    var onDeleted: () -> Void = {}

    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventDraft?
    @State private var showAll = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var airportErrors: [String] = []

    private var tripID: Int {
        switch mode { case .create(let id, _): id; case .edit(let e): e.tripId }
    }
    private var detail: TripDetail? { store.detail(id: tripID) }
    private var travelers: [Traveler] { detail?.travelers ?? [] }
    private var tripZoneID: String { detail?.trip.timezone ?? TimeZone.current.identifier }
    private var catalog: EventCatalog { store.catalog }

    var body: some View {
        NavigationStack {
            Group {
                if let draft { form(draft) } else { typePicker }
            }
            .tbScreen()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                if draft != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { Task { await save() } } label: {
                            if isSaving { ProgressView() } else { Text("Sichern") }
                        }
                        .disabled(isSaving || !(draft?.isValid(catalog: catalog) ?? false))
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .onAppear(perform: setup)
        .confirmationDialog("Ereignis löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { Task { await delete() } }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Das Ereignis wird aus der Reise entfernt. Verknüpfte Dokumente bleiben erhalten.")
        }
    }

    private var title: String {
        switch mode {
        case .create: draft == nil ? "Neues Ereignis" : "Ereignis erfassen"
        case .edit: "Ereignis bearbeiten"
        }
    }

    private func setup() {
        guard draft == nil else { return }
        switch mode {
        case .create: break
        case .edit(let e):
            draft = EventDraft(editing: e, tripZoneID: tripZoneID, defaultCurrency: detail?.trip.currency ?? "CHF")
        }
    }

    // MARK: Typ wählen

    private var typePicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TBLabel("Was möchtest du erfassen?")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                    ForEach(catalog.types) { type in
                        Button { pick(type) } label: {
                            VStack(spacing: 8) {
                                TypeBadge(icon: type.icon, color: type.color, size: 44)
                                Text(type.label).tbText(15, weight: .semibold).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.75)
                            }
                            .frame(maxWidth: .infinity, minHeight: 96)
                            .padding(8)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
                            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(type.label)
                    }
                }
            }
            .padding(16)
        }
    }

    private func pick(_ type: EventTypeDef) {
        guard case .create(_, let startDate) = mode else { return }
        draft = EventDraft(type: type, tripZoneID: tripZoneID, startDate: startDate ?? detail?.trip.startDate,
                           defaultCurrency: detail?.trip.currency ?? "CHF")
    }

    // MARK: Formular

    private func form(_ d: EventDraft) -> some View {
        let type = catalog.typeOrFallback(for: d.typeID)
        let sections = d.sections(catalog: catalog, showAll: showAll)
        return Form {
            Section {
                HStack(spacing: 12) {
                    TypeBadge(icon: type.icon, color: type.color, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        TBLabel("Typ")
                        Text(type.label).tbTitle(20, relativeTo: .title3)
                    }
                    Spacer()
                    if d.isNew {
                        Button("Ändern") { draft = nil }.font(TB.Font.title(15, weight: .semibold)).foregroundStyle(Palette.accent)
                    }
                }
                Picker("Anzeige", selection: $showAll) {
                    Text("Wichtiges").tag(false)
                    Text("Alle Felder").tag(true)
                }
                .pickerStyle(.segmented)
            }
            .tbRow()

            if let errorMessage {
                Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear)
            }

            ForEach(sections) { section in
                Section {
                    ForEach(section.fields) { field in fieldRow(field, d) }
                } header: {
                    TBLabel(section.title)
                }
                .tbRow()
            }

            if d.isNew || d.original?.expenseId == nil, d.int("priceMinor") != nil, store.currentLedgerID(tripID: tripID) != nil {
                Section {
                    Toggle(isOn: Binding(get: { draft?.addToLedger ?? false }, set: { draft?.addToLedger = $0 })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("In Reisekasse übernehmen").tbText(16)
                            Text("Legt eine Ausgabe für alle Beteiligten an.").tbText(12, color: Palette.mute)
                        }
                    }
                    .tint(Palette.accent)
                }
                .tbRow()
            }

            let issues = d.issues(catalog: catalog)
            if !issues.isEmpty || d.timeWarning != nil {
                Section {
                    ForEach(issues, id: \.message) { InlineMessage(text: $0.message, style: .warning) }
                    if let w = d.timeWarning { InlineMessage(text: w, style: .info) }
                }
                .listRowBackground(Color.clear)
            }

            if case .edit = mode {
                Section {
                    Button("Ereignis löschen", role: .destructive) { confirmDelete = true }
                        .font(TB.Font.text(17, weight: .semibold))
                }
                .tbRow()
            }
        }
        .tbList()
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Zeilen

    private func meta(_ key: String) -> FieldMeta? {
        if case .edit(let e) = mode { return e.fieldsMeta[key] }
        return nil
    }

    private func text(_ key: String, _ field: CatalogField? = nil) -> Binding<String> {
        Binding(get: { draft?.string(key) ?? "" }, set: { draft?.set(key, text: $0, field: field) })
    }

    private func optional(_ key: String) -> Binding<String?> {
        Binding(get: { draft?.values[key]?.stringValue }, set: { draft?.values[key] = $0.flatMap { $0.isEmpty ? nil : .string($0) } })
    }

    @ViewBuilder
    private func fieldRow(_ f: CatalogField, _ d: EventDraft) -> some View {
        let m = meta(f.key)
        switch f.kind {
        case .text where f.key == "bookingReference" || f.transform == "upper":
            TextFieldRow(label: f.label, text: text(f.key, f), placeholder: f.placeholder, meta: m, required: f.required, mono: true,
                         capitalization: .characters, warning: d.patternWarning(for: f))
        case .text:
            TextFieldRow(label: f.label, text: text(f.key, f), placeholder: f.placeholder, meta: m, required: f.required,
                         capitalization: ["website"].contains(f.key) ? .never : .sentences,
                         keyboard: f.key == "website" ? .URL : (f.key == "phone" ? .phonePad : .default))
        case .longtext:
            TextFieldRow(label: f.label, text: text(f.key, f), placeholder: f.placeholder, meta: m, axis: .vertical)
        case .date:
            DateFieldRow(label: f.label, value: optional(f.key), meta: m, required: f.required)
        case .time:
            TimeFieldRow(label: f.label, value: optional(f.key), meta: m)
        case .number:
            TextFieldRow(label: f.unit.map { "\(f.label) (\($0))" } ?? f.label,
                         text: Binding(get: { draft?.values[f.key]?.stringValue ?? "" },
                                       set: { t in
                                           let digits = t.filter(\.isNumber)
                                           draft?.values[f.key] = digits.isEmpty ? nil : .int(Int(digits.prefix(9)) ?? 0)
                                       }),
                         meta: m, mono: true, keyboard: .numberPad)
        case .money:
            MoneyFieldRow(label: f.label,
                          minor: Binding(get: { draft?.values[f.key]?.intValue }, set: { draft?.values[f.key] = $0.map { .int($0) } }),
                          currency: Binding(get: { draft?.string(EventDraft.moneyCurrencyKey) ?? "CHF" },
                                            set: { draft?.values[EventDraft.moneyCurrencyKey] = .string($0) }),
                          meta: m)
        case .select where f.optionsAreZones:
            TimeZoneFieldRow(label: f.label, zoneID: optional(f.key), tripZoneID: tripZoneID, meta: m)
        case .select:
            SelectFieldRow(label: f.label,
                           options: (f.options ?? []).map { ($0, f.optionLabel($0)) },
                           selection: optional(f.key), meta: m)
        case .bool:
            BoolFieldRow(label: f.label, value: Binding(get: { draft?.bool(f.key) ?? false },
                                                        set: { draft?.values[f.key] = .bool($0) }), meta: m)
        case .airport:
            AirportFieldRow(label: f.label, code: d.string(f.key), meta: m,
                            onPick: { a in draft?.applyAirport(key: f.key, airport: a) },
                            onManual: { code in draft?.values[f.key] = .string(code) })
        case .place:
            PlaceFieldRow(label: f.label, text: text(f.key, f), meta: m, placeholder: f.placeholder) { hit in
                draft?.applyPlace(name: hit.name, address: hit.address, lat: hit.coordinate.latitude,
                                  lon: hit.coordinate.longitude, toLocation: f.key == "location")
                if f.key == "location" { Task { await suggestZone(lat: hit.coordinate.latitude, lon: hit.coordinate.longitude) } }
            }
        case .participants:
            ParticipantsFieldRow(label: f.label, travelers: travelers,
                                 selected: Binding(get: { draft?.participantIDs ?? [] }, set: { draft?.setParticipants($0) }), meta: m)
        case .participant:
            ParticipantPickerRow(label: f.label, travelers: travelers,
                                 selection: Binding(get: { draft?.int(f.key) }, set: { draft?.values[f.key] = $0.map { .int($0) } }), meta: m)
        case .passengers:
            PassengersFieldRow(field: f, travelers: travelers,
                               draft: Binding(get: { draft ?? d }, set: { draft = $0 }), meta: m)
        case .unknown:
            TextFieldRow(label: f.label, text: text(f.key, f), meta: m)
        }
    }

    /// Zeitzone des gewählten Ortes vorschlagen (nur für den Beginn, wenn die Zone noch die der Reise ist).
    private func suggestZone(lat: Double, lon: Double) async {
        guard draft?.string("startTz") == tripZoneID || draft?.hasValue("startTz") == false,
              let tz = try? await store.api.timezone(lat: lat, lon: lon) else { return }
        draft?.values["startTz"] = .string(tz)
    }

    // MARK: Aktionen

    private func save() async {
        guard let d = draft, d.isValid(catalog: catalog) else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        let body = d.makeBody(catalog: catalog)
        do {
            switch mode {
            case .create(let tripID, _):
                let id = try await store.createEvent(tripID: tripID, body: body)
                if d.addToLedger, let id, let ev = store.detail(id: tripID)?.event(id: id) {
                    try? await LedgerTakeover.perform(store: store, event: ev)
                }
                onSaved(id)
            case .edit(let e):
                try await store.updateEvent(tripID: e.tripId, eventID: e.id, body: body)
                if d.addToLedger, let ev = store.detail(id: e.tripId)?.event(id: e.id) {
                    try? await LedgerTakeover.perform(store: store, event: ev)
                }
                onSaved(e.id)
            }
            dismiss()
        } catch {
            if error.isCancellation { return }
            errorMessage = error.writeMessage
        }
    }

    private func delete() async {
        guard case .edit(let e) = mode else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await store.deleteEvent(tripID: e.tripId, eventID: e.id)
            onDeleted()
            dismiss()
        } catch {
            errorMessage = error.writeMessage
        }
    }
}

/// Sitz, Ticket und Co. je Mitreisendem.
struct PassengersFieldRow: View {
    let field: CatalogField
    let travelers: [Traveler]
    @Binding var draft: EventDraft
    var meta: FieldMeta?

    var body: some View {
        FieldRow(label: field.label, meta: meta) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(travelers) { t in
                    DisclosureGroup {
                        VStack(spacing: 4) {
                            ForEach(field.fields) { sub in
                                TextFieldRow(label: sub.label,
                                             text: Binding(get: { draft.passengerValue(participantID: t.id, key: sub.key) },
                                                           set: { draft.setPassenger(participantID: t.id, key: sub.key, text: $0) }),
                                             placeholder: sub.placeholder, mono: true, capitalization: .characters)
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            TravelerAvatar(traveler: t, size: 26)
                            Text(t.displayName).tbText(16, weight: .semibold)
                            Spacer()
                            let seat = draft.passengerValue(participantID: t.id, key: "seat")
                            if !seat.isEmpty { Text(seat).tbMono(14, weight: .semibold, color: Palette.mute) }
                        }
                    }
                    .tint(Palette.ink)
                }
                if travelers.isEmpty { Text("Noch keine Mitreisenden in der Reise.").tbText(14, color: Palette.mute) }
            }
        }
    }
}
