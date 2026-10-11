import SwiftUI

/// Ereignis-Detail: Kopf mit Wichtigem, **Karte oberhalb der Buchungsdaten**, Buchungsdaten mit Herkunftspunkten,
/// Preis und Zahlung, Teilnehmer, Dokumente, Kommentare.
struct EventDetailView: View {
    let ref: EventRef

    @Environment(TravelStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.navigate) private var navigate
    @State private var showEdit = false
    @State private var intake = DocumentIntake()
    @State private var comment = ""
    @State private var errorMessage: String?
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var triggerRoute = false
    @State private var ledgerMessage: String?

    private var detail: TripDetail? { store.detail(id: ref.tripID) }
    private var event: TripEvent? { detail?.event(id: ref.eventID) }
    private var catalog: EventCatalog { store.catalog }

    var body: some View {
        Group {
            if let event { content(event) }
            else if store.detailStates[ref.tripID] == .loading || detail == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                StateMessage(title: "Ereignis nicht gefunden", systemImage: "questionmark.folder",
                             message: "Es wurde möglicherweise gelöscht.")
            }
        }
        .tbScreen()
        .navigationTitle(event.map { catalog.typeOrFallback(for: $0.type).label } ?? "Ereignis")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if event != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showEdit = true } label: { Label("Bearbeiten", systemImage: "pencil") }
                        Button(role: .destructive) { confirmDelete = true } label: { Label("Löschen", systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel("Aktionen")
                }
            }
        }
        .sheet(isPresented: $showEdit) { if let event { EventFormView(mode: .edit(event)) } }
        .confirmationDialog("Ereignis löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { Task { await delete() } }
            Button("Abbrechen", role: .cancel) {}
        }
        .task {
            if detail == nil { await store.refreshDetail(id: ref.tripID) }
            applyPendingAction()
        }
        .onChange(of: router.pendingAction?.event) { _, _ in applyPendingAction() }
        .onChange(of: event?.documents.count) { _, _ in applyPendingAction() }
    }

    private func applyPendingAction() {
        guard let pending = router.pendingAction, pending.event == ref, let event else { return }
        router.pendingAction = nil
        switch pending.action {
        case .route: triggerRoute = true
        case .document:
            if let id = event.documents.first?.id ?? event.documentIds.first { navigate(.document(id, tripID: ref.tripID)) }
        case .open: break
        }
    }

    // MARK: Inhalt

    @ViewBuilder
    private func content(_ e: TripEvent) -> some View {
        let type = catalog.typeOrFallback(for: e.type)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if store.isOffline { OfflineBanner(savedAt: store.detailSavedAt[ref.tripID]) }
                if let errorMessage { InlineMessage(text: errorMessage) }
                if e.status.isProposal { proposalBanner(e) }
                header(e, type: type)
                EventMapCard(event: e, type: type, autoRoute: triggerRoute) { triggerRoute = false }
                    .id(e.id)
                bookingData(e, type: type)
                priceCard(e)
                participantsCard(e)
                documentsCard(e)
                commentsCard(e)
            }
            .padding(16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await store.refreshDetail(id: ref.tripID) }
    }

    private func header(_ e: TripEvent, type: EventTypeDef) -> some View {
        let tripZoneID = detail?.trip.timezone
        let facts = EventFacts.big(for: e, catalog: catalog, participantId: store.myParticipantID(tripID: ref.tripID), limit: 4)
        return TicketCard(icon: type.icon, color: type.color, typeLabel: type.label, reference: e.bookingReference, status: e.status) {
            VStack(alignment: .leading, spacing: 12) {
                Text(e.title).tbTitle(26, weight: .bold, relativeTo: .title)
                if let p = e.provider { Text(p).tbText(16, color: Palette.mute) }
                timeLine(label: type.startLabel, date: e.startDate, time: e.startTime, zone: e.startTz, tripZone: tripZoneID)
                if e.endDate != nil || e.endTime != nil, !type.endLabel.isEmpty {
                    timeLine(label: type.endLabel, date: e.endDate ?? e.startDate, time: e.endTime, zone: e.endTz ?? e.startTz, tripZone: tripZoneID)
                }
                if !facts.isEmpty { Divider().overlay(Palette.line); FactGrid(facts: facts) }
            }
        }
    }

    private func timeLine(label: String, date: String?, time: String?, zone: String?, tripZone: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            TBLabel(label, size: 11).frame(width: 96, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 8) {
                    if let date {
                        Text(TBDate.shortDay(date)).tbMono(16, weight: .medium)
                    } else {
                        Text("ohne Datum").tbText(15, color: Palette.mute)
                    }
                    if let time { Text(time).tbMono(20, weight: .semibold) }
                }
                if let zone, zone != tripZone { Text("Ortszeit \(TripClock.placeName(zone))").tbText(12, color: Palette.mute) }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func proposalBanner(_ e: TripEvent) -> some View {
        PlainCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    StatusChip(status: e.status)
                    Text("Aus einem Dokument erkannt. Bitte prüfen.").tbText(14, color: Palette.mute)
                }
                HStack(spacing: 8) {
                    Button { Task { await run { try await store.confirmEvent(tripID: ref.tripID, eventID: ref.eventID) } } } label: {
                        Label("Übernehmen", systemImage: "checkmark")
                    }.buttonStyle(.tbPrimary)
                    Button { showEdit = true } label: { Label("Bearbeiten", systemImage: "pencil") }.buttonStyle(.tbSecondary)
                }
            }
            .padding(12)
        }
    }

    // MARK: Buchungsdaten

    private func bookingData(_ e: TripEvent, type: EventTypeDef) -> some View {
        var groups: [(title: String, rows: [(CatalogField, String)])] = []
        let common = catalog.commonFields.filter { ["provider", "bookingReference", "website", "phone", "address", "location"].contains($0.key) }
        var commonRows: [(CatalogField, String)] = []
        for f in common {
            let v: String? = switch f.key {
            case "provider": e.provider
            case "bookingReference": e.bookingReference
            case "website": e.website
            case "phone": e.phone
            case "address": e.address
            case "location": e.location
            default: nil
            }
            if let v, !v.isEmpty { commonRows.append((f, v)) }
        }
        if !commonRows.isEmpty { groups.append(("Buchung", commonRows)) }
        for section in type.sections {
            var rows: [(CatalogField, String)] = []
            for f in section.fields {
                guard let v = displayValue(f, e) else { continue }
                rows.append((f, v))
            }
            if !rows.isEmpty { groups.append((section.title, rows)) }
        }
        return Group {
            if !groups.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader("Buchungsdaten")
                    PlainCard {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(groups.enumerated()), id: \.offset) { gi, g in
                                if gi > 0 { Divider().overlay(Palette.line) }
                                VStack(alignment: .leading, spacing: 8) {
                                    TBLabel(g.title, size: 11)
                                    ForEach(g.rows, id: \.0.key) { f, v in dataRow(f, v, e) }
                                }
                                .padding(12)
                            }
                        }
                    }
                }
            }
        }
    }

    private func dataRow(_ f: CatalogField, _ value: String, _ e: TripEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(spacing: 5) {
                Text(f.label).tbText(14, color: Palette.mute)
                OriginDot(meta: e.fieldsMeta[f.key])
            }
            .frame(width: 130, alignment: .leading)
            Group {
                if f.key == "website", let url = URL(string: value.hasPrefix("http") ? value : "https://\(value)") {
                    Link(value, destination: url).tbText(16, color: Palette.accent)
                } else if f.key == "phone" || f.key.lowercased().contains("phone"), let url = URL(string: "tel:\(value.filter { $0.isNumber || $0 == "+" })") {
                    Link(value, destination: url).tbMono(15, weight: .medium, color: Palette.accent)
                } else if monoLike(f) {
                    Text(value).tbMono(16, weight: .medium)
                } else {
                    Text(value).tbText(16)
                }
            }
            .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func monoLike(_ f: CatalogField) -> Bool {
        f.kind == .time || f.kind == .number || f.kind == .money || f.kind == .airport || f.key == "bookingReference"
            || f.transform == "upper" || ["cabin", "deck", "seat", "terminal", "accessCode"].contains(f.key)
    }

    private func displayValue(_ f: CatalogField, _ e: TripEvent) -> String? {
        switch f.kind {
        case .passengers:
            let list = e.details[f.key]?.arrayValue?.compactMap(\.objectValue) ?? []
            let travelers = detail?.travelers ?? []
            let lines = list.compactMap { p -> String? in
                let name = travelers.first { $0.id == p["participantId"]?.intValue }?.displayName ?? "Person"
                let rest = f.fields.compactMap { sub in p[sub.key]?.stringValue.map { "\(sub.label) \($0)" } }
                return rest.isEmpty ? nil : "\(name): " + rest.joined(separator: ", ")
            }
            return lines.isEmpty ? nil : lines.joined(separator: "\n")
        case .money:
            guard let minor = e.details[f.key]?.intValue else { return nil }
            return Money.formatted(minor, currency: e.currency ?? detail?.trip.currency ?? "CHF")
        case .bool:
            guard let b = e.details[f.key]?.boolValue else { return nil }
            return b ? "Ja" : "Nein"
        case .select:
            guard let v = e.detail(f.key) else { return nil }
            return f.optionLabel(v)
        case .number:
            guard let v = e.detail(f.key) else { return nil }
            return f.unit == "Min." ? Int(v).map { TBDate.duration(minutes: $0) } ?? v : (f.unit.map { "\(v) \($0)" } ?? v)
        case .date:
            return e.detail(f.key).map(TBDate.display)
        default:
            return e.detail(f.key)
        }
    }

    // MARK: Preis

    @ViewBuilder
    private func priceCard(_ e: TripEvent) -> some View {
        if e.priceMinor != nil || e.paymentStatus != nil || e.cancelUntil != nil {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("Preis und Zahlung")
                PlainCard {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            if let p = e.priceMinor {
                                Text(Money.formatted(p, currency: e.currency ?? detail?.trip.currency ?? "CHF")).tbMono(22, weight: .semibold, relativeTo: .title2)
                            }
                            Spacer()
                            if let s = e.paymentStatus {
                                TBChip(text: s.title, symbol: s == .paid ? "checkmark.circle" : "circle.dashed",
                                       tint: s == .paid ? Palette.positive : Palette.mute)
                            }
                        }
                        if let paidBy = e.paidByParticipantId, let name = detail?.travelers.first(where: { $0.id == paidBy })?.displayName {
                            Text("Bezahlt von \(name)").tbText(15, color: Palette.mute)
                        }
                        if let c = e.cancelUntil {
                            Label("Kostenlos stornierbar bis \(TBDate.display(c))", systemImage: "calendar.badge.clock").tbText(15)
                        }
                        if e.expenseId != nil {
                            Label("In der Reisekasse erfasst", systemImage: "checkmark.seal").tbText(14, color: Palette.positive)
                        } else if e.priceMinor != nil, store.currentLedgerID(tripID: ref.tripID) != nil {
                            Button { Task { await takeOver(e) } } label: {
                                Label("In Reisekasse übernehmen", systemImage: "creditcard").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.tbSecondary).disabled(busy)
                        }
                        if let ledgerMessage { Text(ledgerMessage).tbText(13, color: Palette.mute) }
                    }
                    .padding(12)
                }
            }
        }
    }

    private func participantsCard(_ e: TripEvent) -> some View {
        let all = detail?.travelers ?? []
        let chosen = e.participantIds.isEmpty ? all : all.filter { e.participantIds.contains($0.id) }
        return Group {
            if !chosen.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader("Wer ist dabei", trailing: e.participantIds.isEmpty ? "alle" : nil)
                    FlowLayout(spacing: 8) {
                        ForEach(chosen) { t in
                            HStack(spacing: 6) {
                                TravelerAvatar(traveler: t, size: 24)
                                Text(t.displayName).tbText(15, weight: .medium)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Palette.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(Palette.line))
                        }
                    }
                }
            }
        }
    }

    // MARK: Dokumente

    private func documentsCard(_ e: TripEvent) -> some View {
        var docs = e.documents
        for id in e.documentIds where !docs.contains(where: { $0.id == id }) { docs.append(TBDocument(id: id, title: "Dokument \(id)")) }
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionHeader("Dokumente")
                DocumentIntakeMenu(intake: intake, tripID: ref.tripID, eventID: e.id) {
                    Label("Hinzufügen", systemImage: "plus").font(TB.Font.title(14, weight: .semibold)).foregroundStyle(Palette.accent)
                }
            }
            UploadStatusList(intake: intake)
            if docs.isEmpty && !intake.hasActivity {
                Text("Noch keine Dokumente. Füge ein PDF, einen Scan oder ein Foto hinzu.").tbText(14, color: Palette.mute)
            }
            if !docs.isEmpty {
                PlainCard {
                    VStack(spacing: 0) {
                        ForEach(Array(docs.enumerated()), id: \.element.id) { i, d in
                            Button { navigate(.document(d.id, tripID: ref.tripID)) } label: {
                                DocumentRow(document: d, offline: store.offlineDocumentIDs.contains(d.id)).padding(.horizontal, 12).padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                            if i < docs.count - 1 { Divider().overlay(Palette.line) }
                        }
                    }
                }
            }
        }
    }

    // MARK: Kommentare

    private func commentsCard(_ e: TripEvent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Kommentare", trailing: e.comments.isEmpty ? nil : "\(e.comments.count)")
            PlainCard {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(e.comments) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(c.author).tbText(14, weight: .semibold)
                                Text(TBDate.displayDateTime(isoTimestamp: c.createdAt)).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                                Spacer()
                                if c.userId == store.user.id || store.user.isAdmin {
                                    Button { Task { await run { try await store.deleteComment(tripID: ref.tripID, eventID: e.id, commentID: c.id) } } } label: {
                                        Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(Palette.mute)
                                    }
                                    .accessibilityLabel("Kommentar löschen")
                                }
                            }
                            Text(c.body).tbText(15)
                        }
                        Divider().overlay(Palette.line)
                    }
                    HStack(spacing: 8) {
                        TextField("Kommentar schreiben", text: $comment, axis: .vertical)
                            .font(TB.Font.text(16)).lineLimit(1...4)
                        Button {
                            let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !text.isEmpty else { return }
                            Task { await run { try await store.addComment(tripID: ref.tripID, eventID: e.id, body: text) }; comment = "" }
                        } label: { Image(systemName: "paperplane.fill").foregroundStyle(Palette.accent).frame(width: 44, height: 44) }
                            .disabled(comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                            .accessibilityLabel("Kommentar senden")
                    }
                }
                .padding(12)
            }
        }
    }

    // MARK: Aktionen

    private func run(_ action: () async throws -> Void) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do { try await action() } catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }

    private func takeOver(_ e: TripEvent) async {
        busy = true; defer { busy = false }
        do {
            try await LedgerTakeover.perform(store: store, event: e)
            ledgerMessage = "Ausgabe in der Reisekasse angelegt."
        } catch { ledgerMessage = error.writeMessage }
    }

    private func delete() async {
        await run {
            try await store.deleteEvent(tripID: ref.tripID, eventID: ref.eventID)
            router.selectedEvent = nil
            dismiss()
        }
    }
}
