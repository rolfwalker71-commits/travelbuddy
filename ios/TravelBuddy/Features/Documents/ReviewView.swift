import SwiftUI

/// «Zu prüfen»: Vorschläge aus Dokumenten (Übernehmen, Bearbeiten, Zusammenführen, Verwerfen) und Dokumente in Arbeit.
struct ReviewView: View {
    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var editing: TripEvent?
    @State private var busy: Int?
    @State private var errorMessage: String?
    @State private var discard: InboxResponse.ReviewItem?

    private var review: [InboxResponse.ReviewItem] { store.inbox?.review ?? [] }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { InlineMessage(text: errorMessage).listRowBackground(Color.clear) }
                if store.isOffline { OfflineBanner(savedAt: nil).listRowBackground(Color.clear).listRowSeparator(.hidden) }
                if review.isEmpty && (store.inbox?.documents.isEmpty ?? true) {
                    VStack(spacing: 12) {
                        IllustrationCard(key: "pruefen", height: 120)
                        StateMessage(title: "Alles geprüft", systemImage: "checkmark.circle",
                                     message: "Neue Vorschläge aus Dokumenten erscheinen hier.")
                    }
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(review) { item in
                    ReviewCard(item: item, busy: busy == item.id,
                               accept: { Task { await accept(item) } },
                               edit: { editing = item.event },
                               merge: { target in Task { await merge(item, into: target) } },
                               discard: { discard = item })
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
                if let docs = store.inbox?.documents, !docs.isEmpty {
                    Section {
                        ForEach(docs) { d in
                            HStack {
                                DocumentRow(document: d)
                                if d.analysisStatus == .failed {
                                    Button("Neu") { Task { _ = try? await store.api.analyzeDocument(id: d.id); await store.refreshInbox() } }
                                        .buttonStyle(.tbCompact)
                                }
                            }
                        }
                    } header: { TBLabel("Dokumente in Arbeit") }
                    .tbRow()
                }
            }
            .tbList()
            .navigationTitle("Zu prüfen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .refreshable { await store.refreshInbox() }
            .task { await store.refreshInbox() }
            .sheet(item: $editing) { event in
                EventFormView(mode: .edit(event))
            }
            .confirmationDialog("Vorschlag verwerfen?", isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } }),
                                titleVisibility: .visible) {
                Button("Verwerfen", role: .destructive) { if let item = discard { Task { await remove(item) } } }
                Button("Abbrechen", role: .cancel) {}
            } message: { Text("Das vorgeschlagene Ereignis wird gelöscht.") }
        }
    }

    private func accept(_ item: InboxResponse.ReviewItem) async {
        busy = item.id; defer { busy = nil }
        do { try await store.confirmEvent(tripID: item.tripId, eventID: item.event.id) } catch { errorMessage = error.writeMessage }
    }

    private func merge(_ item: InboxResponse.ReviewItem, into target: Int) async {
        busy = item.id; defer { busy = nil }
        do { try await store.mergeEvent(tripID: item.tripId, eventID: item.event.id, into: target) } catch { errorMessage = error.writeMessage }
    }

    private func remove(_ item: InboxResponse.ReviewItem) async {
        busy = item.id; defer { busy = nil }
        do { try await store.deleteEvent(tripID: item.tripId, eventID: item.event.id); await store.refreshInbox() }
        catch { errorMessage = error.writeMessage }
    }
}

struct ReviewCard: View {
    let item: InboxResponse.ReviewItem
    let busy: Bool
    let accept: () -> Void
    let edit: () -> Void
    let merge: (Int) -> Void
    let discard: () -> Void
    @Environment(TravelStore.self) private var store

    var body: some View {
        let e = item.event
        let type = store.catalog.typeOrFallback(for: e.type)
        let candidates = (store.detail(id: item.tripId)?.events ?? []).filter { $0.id != e.id && $0.status == .confirmed && $0.type == e.type }
        let facts = EventFacts.big(for: e, catalog: store.catalog, limit: 4)
        TicketCard(icon: type.icon, color: type.color, typeLabel: type.label, reference: e.bookingReference, status: e.status) {
            VStack(alignment: .leading, spacing: 10) {
                TBLabel(item.tripTitle, size: 11)
                Text(e.title).tbTitle(20, weight: .semibold, relativeTo: .title3)
                HStack(spacing: 8) {
                    if let d = e.startDate { Text(TBDate.display(d)).tbMono(15, weight: .medium) }
                    if let t = e.startTime { Text(t).tbMono(15, weight: .medium) }
                    if let p = e.provider ?? e.location { Text(p).tbText(15, color: Palette.mute) }
                }
                if !facts.isEmpty { FactGrid(facts: facts, large: false) }
                // Quellenausschnitt der unsichersten Angabe.
                if let (key, meta) = e.fieldsMeta.filter({ $0.value.quote != nil }).min(by: { ($0.value.confidence ?? 1) < ($1.value.confidence ?? 1) }),
                   let quote = meta.quote {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "quote.opening").font(.system(size: 11)).foregroundStyle(Palette.mute)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("«\(quote)»").tbText(13, color: Palette.mute)
                            Text("\(store.catalog.commonFields.first { $0.key == key }?.label ?? store.catalog.field(key: key, in: type)?.label ?? key)\(meta.page.map { " · Seite \($0)" } ?? "")\(meta.confidence.map { " · Sicherheit \(Int($0 * 100)) %" } ?? "")")
                                .tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                        }
                    }
                }
            }
        } strip: {
            FlowLayout(spacing: 8) {
                Button(action: accept) { Label("Übernehmen", systemImage: "checkmark") }.buttonStyle(.tbCompact)
                Button(action: edit) { Label("Bearbeiten", systemImage: "pencil") }.buttonStyle(.tbCompact)
                if !candidates.isEmpty {
                    Menu {
                        ForEach(candidates) { c in Button(c.title) { merge(c.id) } }
                    } label: { Label("Zusammenführen", systemImage: "arrow.triangle.merge") }
                        .buttonStyle(.tbCompact)
                }
                Button(role: .destructive, action: discard) { Image(systemName: "trash") }
                    .buttonStyle(.tbDestructive).accessibilityLabel("Verwerfen")
            }
            .labelStyle(.titleAndIcon)
            .font(TB.Font.title(14, weight: .semibold))
            .disabled(busy)
            .overlay { if busy { ProgressView() } }
        }
    }
}
