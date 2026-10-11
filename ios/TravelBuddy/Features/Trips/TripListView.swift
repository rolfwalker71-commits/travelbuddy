import SwiftUI

struct TripRowView: View {
    let trip: TripSummary
    let phase: TripPhase
    @Environment(TravelStore.self) private var store

    var body: some View {
        HStack(spacing: 12) {
            TripCover(path: trip.coverUrl, height: 60, cornerRadius: 8).frame(width: 60)
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.title).tbTitle(19, weight: .semibold, relativeTo: .headline).lineLimit(2)
                if let d = trip.destination, !d.isEmpty { Text(d).tbText(14, color: Palette.mute).lineLimit(1) }
                if let r = TBDate.range(start: trip.startDate, end: trip.endDate) {
                    Text(r).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                }
                HStack(spacing: 6) {
                    if phase == .active { TBChip(text: "Unterwegs", symbol: "location.fill", tint: Palette.accent) }
                    if trip.needsReviewCount > 0 { TBChip(text: "\(trip.needsReviewCount) zu prüfen", symbol: "checklist", tint: Palette.negative) }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(Palette.mute).accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Reisen (iPhone): gruppiert nach Phase, Suche, neue Reise.
struct TripListView: View {
    @Environment(TravelStore.self) private var store
    @Environment(\.navigate) private var navigate
    @State private var query = ""
    @State private var showNew = false

    var body: some View {
        let groups = TripListLogic.groups(store.trips.map { var t = $0; t.phase = store.phase(of: $0); return t }, query: query)
        List {
            if store.isOffline { OfflineBanner(savedAt: store.tripsSavedAt).listRowBackground(Color.clear).listRowSeparator(.hidden) }
            if store.trips.isEmpty {
                switch store.tripsState {
                case .failed(let m):
                    StateMessage(title: "Reisen nicht verfügbar", message: m, actionTitle: "Wiederholen") { Task { await store.refreshTrips() } }
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                case .loading, .idle:
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear).listRowSeparator(.hidden)
                case .loaded:
                    VStack(spacing: 14) {
                        IllustrationCard(key: "reise", height: 150)
                        StateMessage(title: "Noch keine Reise", systemImage: "suitcase", message: "Lege eine Reise an oder importiere eine Buchungsbestätigung.",
                                     actionTitle: "Reise anlegen") { showNew = true }
                    }
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
            }
            ForEach(groups) { group in
                Section {
                    ForEach(group.trips) { trip in
                        Button { navigate(.trip(trip.id)) } label: { TripRowView(trip: trip, phase: group.phase) }
                            .buttonStyle(.plain)
                            .tbRow()
                    }
                } header: { TBLabel(group.phase.title) }
            }
        }
        .tbList()
        .searchable(text: $query, prompt: "Reisen durchsuchen")
        .navigationTitle("Reisen")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNew = true } label: { Image(systemName: "plus") }.accessibilityLabel("Neue Reise")
            }
        }
        .refreshable { await store.refreshAll() }
        .sheet(isPresented: $showNew) {
            TripFormView(mode: .create) { id in navigate(.trip(id)) }
        }
        .task { if store.trips.isEmpty || store.tripsState == .idle { await store.refreshTrips() } }
    }
}

/// Seitenleiste (iPad): Heute, Reisen, Kasse, Konto.
struct SidebarView: View {
    @Binding var selection: SidebarItem?
    @Environment(TravelStore.self) private var store
    @State private var showNew = false

    var body: some View {
        let hasActive = store.activeTrip != nil
        List(selection: $selection) {
            Section {
                if hasActive { Label("Heute", systemImage: "sun.max").tag(SidebarItem.today) }
                Label("Kasse", systemImage: "creditcard").tag(SidebarItem.ledger)
            }
            ForEach(TripListLogic.groups(store.trips.map { var t = $0; t.phase = store.phase(of: $0); return t })) { group in
                Section {
                    ForEach(group.trips) { trip in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trip.title).tbText(16, weight: .semibold)
                            if let r = TBDate.range(start: trip.startDate, end: trip.endDate) {
                                Text(r).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                            }
                        }
                        .tag(SidebarItem.trip(trip.id))
                    }
                } header: { TBLabel(group.phase.title) }
            }
            Section { Label("Konto", systemImage: "person.crop.circle").tag(SidebarItem.account) }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.bg)
        .navigationTitle("TravelBuddy")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showNew = true } label: { Image(systemName: "plus") }.accessibilityLabel("Neue Reise")
            }
        }
        .refreshable { await store.refreshAll() }
        .sheet(isPresented: $showNew) { TripFormView(mode: .create) { id in selection = .trip(id) } }
    }
}
