import SwiftUI

/// Mitreisende einer Reise: hinzufügen, entfernen, Gäste-Link teilen, erneuern, widerrufen.
struct ParticipantsView: View {
    let tripID: Int
    @Environment(TravelStore.self) private var store
    @State private var newName = ""
    @State private var errorMessage: String?
    @State private var busy = false
    @State private var removal: Traveler?

    private var detail: TripDetail? { store.detail(id: tripID) }

    var body: some View {
        List {
            if let errorMessage { InlineMessage(text: errorMessage).listRowBackground(Color.clear) }
            Section {
                ForEach(detail?.travelers ?? []) { t in row(t) }
            } header: { TBLabel("Mitreisende") }.tbRow()
            Section {
                HStack {
                    TextField("Name", text: $newName).font(TB.Font.text(16)).submitLabel(.done).onSubmit { Task { await add() } }
                    Button("Hinzufügen") { Task { await add() } }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
            } header: { TBLabel("Gast hinzufügen") } footer: {
                Text("Gäste brauchen kein Konto. Mit dem Link sehen sie die Reise und die Reisekasse.").tbText(12, color: Palette.mute)
            }.tbRow()
        }
        .tbList()
        .navigationTitle("Teilnehmer")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Mitreisenden entfernen?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }),
                            titleVisibility: .visible) {
            Button("Entfernen", role: .destructive) { if let t = removal { Task { await remove(t) } } }
            Button("Abbrechen", role: .cancel) {}
        }
    }

    private func row(_ t: Traveler) -> some View {
        HStack(spacing: 12) {
            TravelerAvatar(traveler: t, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.displayName).tbText(17, weight: .semibold)
                Text(t.userId != nil ? "Konto" : "Gast").tbText(13, color: Palette.mute)
            }
            Spacer()
            if t.userId == nil, let token = t.shareToken, let url = TripShareLink.url(base: store.api.baseURL, token: token) {
                ShareLink(item: url) { Image(systemName: "link") }.accessibilityLabel("Gäste-Link von \(t.displayName) teilen")
            }
            Menu {
                if t.userId == nil {
                    Button { Task { await run { try await store.rotateShare(tripID: tripID, travelerID: t.id) } } } label: { Label("Neuer Link", systemImage: "arrow.triangle.2.circlepath") }
                    Button { Task { await run { try await store.revokeShare(tripID: tripID, travelerID: t.id) } } } label: { Label("Link widerrufen", systemImage: "link.badge.plus") }
                }
                Button(role: .destructive) { removal = t } label: { Label("Entfernen", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis.circle").frame(width: 44, height: 44) }
            .accessibilityLabel("Aktionen für \(t.displayName)")
        }
    }

    private func add() async {
        let n = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        await run { try await store.addTraveler(tripID: tripID, TravelerInput(displayName: n, email: nil, userId: nil)); newName = "" }
    }

    private func remove(_ t: Traveler) async {
        await run { try await store.removeTraveler(tripID: tripID, travelerID: t.id) }
    }

    private func run(_ action: () async throws -> Void) async {
        busy = true; errorMessage = nil; defer { busy = false }
        do { try await action() } catch {
            if error.isCancellation { return }
            errorMessage = (error as? APIError)?.code == "last_traveler" ? "Mindestens eine Person muss in der Reise bleiben." : error.writeMessage
        }
    }
}
