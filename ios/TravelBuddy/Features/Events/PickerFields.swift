import CoreLocation
import SwiftUI

/// Flughafen: IATA-Code mit Suche (`GET /v1/meta/airports?q=`). Die Zone des Flughafens füllt die Zeitzone vor.
struct AirportFieldRow: View {
    let label: String
    let code: String
    var meta: FieldMeta?
    var onPick: (Airport) -> Void
    var onManual: (String) -> Void

    @State private var showing = false

    var body: some View {
        FieldRow(label: label, meta: meta) {
            Button { showing = true } label: {
                HStack {
                    if code.isEmpty {
                        Text("Flughafen suchen").tbText(17, color: Palette.accent)
                    } else {
                        Text(code).tbMono(20, weight: .semibold)
                    }
                    Spacer()
                    Image(systemName: "magnifyingglass").foregroundStyle(Palette.mute)
                }
                .touchTarget()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: $showing) {
            AirportSearchSheet(onPick: { onPick($0); showing = false }, onManual: { onManual($0); showing = false })
        }
    }
}

struct AirportSearchSheet: View {
    var onPick: (Airport) -> Void
    var onManual: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.api) private var api
    @State private var query = ""
    @State private var results: [Airport] = []
    @State private var failed: String?
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                if let failed { InlineMessage(text: failed, style: .warning).listRowBackground(Color.clear) }
                if query.count == 3, results.isEmpty, !searching {
                    Button { onManual(query.uppercased()) } label: {
                        Label("«\(query.uppercased())» übernehmen", systemImage: "checkmark.circle").tbText(16)
                    }.tbRow()
                }
                ForEach(results) { a in
                    Button { onPick(a) } label: {
                        HStack(spacing: 12) {
                            Text(a.iata).tbMono(18, weight: .semibold).frame(width: 56, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text([a.city, a.country].compactMap { $0 }.joined(separator: ", ")).tbText(16, weight: .semibold)
                                Text(a.name).tbText(13, color: Palette.mute)
                            }
                            Spacer()
                            if let tz = a.tz { Text(TripClock.placeName(tz)).tbText(12, color: Palette.mute) }
                        }
                    }
                    .tbRow()
                }
            }
            .tbList()
            .overlay { if searching && results.isEmpty { ProgressView() } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "IATA-Code oder Ort")
            .textInputAutocapitalization(.characters)
            .navigationTitle("Flughafen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
            .task(id: query) {
                let q = query.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2, let api else { results = []; return }
                try? await Task.sleep(nanoseconds: 250_000_000)
                if Task.isCancelled { return }
                searching = true
                defer { searching = false }
                do { results = try await api.airports(query: q); failed = nil }
                catch { if !error.isCancellation { failed = error.isOffline ? "Ohne Verbindung keine Flughafensuche. Den 3-Buchstaben-Code kannst du trotzdem direkt eingeben." : error.userMessage } }
            }
        }
    }
}

/// Ort mit Kartensuche. Der Text bleibt frei editierbar; die Suche schlägt Orte mit Adresse vor.
struct PlaceFieldRow: View {
    let label: String
    @Binding var text: String
    var meta: FieldMeta?
    var placeholder: String?
    /// Name, Adresse und Koordinate eines gewählten Treffers.
    var onPick: ((PlaceResolver.Hit) -> Void)?

    @State private var showing = false

    var body: some View {
        FieldRow(label: label, meta: meta) {
            HStack(spacing: 8) {
                TextField(placeholder ?? label, text: $text, axis: .vertical)
                    .font(TB.Font.text(17))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1...3)
                    .frame(minHeight: 36, alignment: .topLeading)
                Button { showing = true } label: {
                    Image(systemName: "mappin.and.ellipse").font(.system(size: 18)).foregroundStyle(Palette.accent)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("\(label) auf der Karte suchen")
            }
        }
        .sheet(isPresented: $showing) {
            PlaceSearchSheet(initial: text) { hit in
                text = hit.name
                onPick?(hit)
                showing = false
            }
        }
    }
}

struct PlaceSearchSheet: View {
    var initial: String
    var onPick: (PlaceResolver.Hit) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [PlaceResolver.Hit] = []
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(hits) { h in
                    Button { onPick(h) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.name).tbText(16, weight: .semibold)
                            if !h.address.isEmpty { Text(h.address).tbText(13, color: Palette.mute) }
                        }
                    }
                    .tbRow()
                }
                if hits.isEmpty && !searching && query.count >= 2 {
                    Text("Keine Treffer. Prüfe die Schreibweise.").tbText(15, color: Palette.mute).listRowBackground(Color.clear)
                }
            }
            .tbList()
            .overlay { if searching && hits.isEmpty { ProgressView() } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Adresse oder Ort")
            .navigationTitle("Ort suchen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
            .onAppear { if query.isEmpty { query = initial } }
            .task(id: query) {
                try? await Task.sleep(nanoseconds: 350_000_000)
                if Task.isCancelled { return }
                searching = true
                hits = await PlaceResolver.search(query)
                searching = false
            }
        }
    }
}

/// Wer ist dabei: leer = alle.
struct ParticipantsFieldRow: View {
    let label: String
    let travelers: [Traveler]
    @Binding var selected: [Int]
    var meta: FieldMeta?

    var body: some View {
        FieldRow(label: label, meta: meta, note: selected.isEmpty ? "Keine Auswahl heisst: alle Mitreisenden." : nil) {
            FlowLayout(spacing: 8) {
                ForEach(travelers) { t in
                    let on = selected.contains(t.id)
                    Button {
                        if on { selected.removeAll { $0 == t.id } } else { selected.append(t.id) }
                    } label: {
                        HStack(spacing: 6) {
                            TravelerAvatar(traveler: t, size: 22)
                            Text(t.displayName).tbText(15, weight: .medium, color: on ? Palette.onAccent : Palette.ink)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(on ? Palette.accent : Palette.surface2, in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.line))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }
}

struct ParticipantPickerRow: View {
    let label: String
    let travelers: [Traveler]
    @Binding var selection: Int?
    var meta: FieldMeta?

    var body: some View {
        SelectFieldRow(label: label, options: travelers.map { ("\($0.id)", $0.displayName) },
                       selection: Binding(get: { selection.map(String.init) }, set: { selection = $0.flatMap(Int.init) }), meta: meta)
    }
}
