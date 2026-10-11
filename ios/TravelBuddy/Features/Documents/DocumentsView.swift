import MapKit
import SwiftUI

struct DocumentRow: View {
    let document: TBDocument
    var offline = false

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(source: .thumbnail(document.id), maxPoints: 56) {
                Image(systemName: document.isPDF ? "doc.richtext" : "photo").font(.system(size: 20)).foregroundStyle(Palette.mute)
                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.surface2)
            }
            .frame(width: 48, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Palette.line))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(document.displayTitle).tbText(16, weight: .semibold).lineLimit(2)
                HStack(spacing: 8) {
                    if let p = document.pages { Text("\(p) S.").tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute) }
                    Text(document.sizeText).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                    if offline { Label("Offline", systemImage: "arrow.down.circle.fill").labelStyle(.iconOnly).foregroundStyle(Palette.positive).accessibilityLabel("Offline verfügbar") }
                }
                if document.analysisStatus != .done {
                    TBChip(text: document.analysisStatus.title,
                           symbol: document.analysisStatus == .failed ? "exclamationmark.triangle" : "hourglass",
                           tint: document.analysisStatus == .failed ? Palette.negative : Palette.mute)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(Palette.mute)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Dokumente einer Reise: Import, Scan, Analysestatus, Offline-Kennzeichen.
struct DocumentsView: View {
    let tripID: Int
    @Environment(TravelStore.self) private var store
    @Environment(\.navigate) private var navigate
    @State private var intake = DocumentIntake()
    @State private var extra: [TBDocument] = []

    private var documents: [TBDocument] {
        var map: [Int: TBDocument] = [:]
        for e in store.detail(id: tripID)?.events ?? [] {
            for d in e.documents { map[d.id] = d }
            for id in e.documentIds where map[id] == nil { map[id] = TBDocument(id: id, title: "Dokument \(id)") }
        }
        for d in extra where d.tripIds.contains(tripID) || d.tripIds.isEmpty { map[d.id] = d }
        for d in store.inbox?.documents ?? [] where d.tripIds.contains(tripID) { map[d.id] = d }
        return map.values.sorted { $0.id > $1.id }
    }

    var body: some View {
        List {
            if intake.hasActivity {
                UploadStatusList(intake: intake).listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            if store.isOffline { OfflineBanner(savedAt: store.detailSavedAt[tripID]).listRowBackground(Color.clear).listRowSeparator(.hidden) }
            if documents.isEmpty {
                VStack(spacing: 12) {
                    IllustrationCard(key: "dokument-scan", height: 130)
                    StateMessage(title: "Noch keine Dokumente", systemImage: "doc.viewfinder",
                                 message: "Importiere Buchungsbestätigungen als PDF oder scanne sie. TravelBuddy schlägt daraus Ereignisse vor.")
                }
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            ForEach(documents) { doc in
                Button { navigate(.document(doc.id, tripID: tripID)) } label: {
                    DocumentRow(document: doc, offline: store.offlineDocumentIDs.contains(doc.id))
                }
                .buttonStyle(.plain)
                .tbRow()
            }
        }
        .tbList()
        .navigationTitle("Dokumente")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                DocumentIntakeMenu(intake: intake, tripID: tripID) { Image(systemName: "plus") }
                    .accessibilityLabel("Dokument hinzufügen")
            }
        }
        .refreshable { await store.refreshDetail(id: tripID); await store.refreshInbox() }
        .task { await store.refreshInbox() }
    }
}

/// Dokument-Detail: Status, Datei öffnen, erkannte Adressen mit Karten-Vorschau, «Dem Ereignis zuordnen».
struct DocumentDetailView: View {
    let documentID: Int
    let tripID: Int
    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var document: TBDocument?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var attachMessage: String?

    private var detail: TripDetail? { store.detail(id: tripID) }

    private var linkedEvents: [TripEvent] {
        guard let d = detail else { return [] }
        return d.events.filter {
            $0.documentIds.contains(documentID) || $0.documents.contains { $0.id == documentID }
                || $0.sourceDocumentId == documentID || (document?.eventIds.contains($0.id) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let error { InlineMessage(text: error) }
                if let document {
                    header(document)
                    if let summary = document.summary, !summary.isEmpty {
                        PlainCard { Text(summary).tbText(15).padding(14) }
                    }
                    NavigationLink {
                        DocumentViewer(document: document)
                    } label: {
                        Label("Dokument öffnen", systemImage: "doc.richtext").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.tbPrimary)
                    addresses
                    actions(document)
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
            .frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .tbScreen()
        .navigationTitle("Dokument")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog("Dokument löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Löschen", role: .destructive) { Task { await delete() } }
            Button("Abbrechen", role: .cancel) {}
        } message: { Text("Datei und Verknüpfungen werden entfernt. Ereignisse bleiben bestehen.") }
    }

    private func header(_ d: TBDocument) -> some View {
        PlainCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(d.displayTitle).tbTitle(22, weight: .bold)
                HStack(spacing: 8) {
                    TBChip(text: d.analysisStatus.title,
                           symbol: d.analysisStatus == .done ? "checkmark.circle" : (d.analysisStatus == .failed ? "exclamationmark.triangle" : "hourglass"),
                           tint: d.analysisStatus == .failed ? Palette.negative : (d.analysisStatus == .done ? Palette.positive : Palette.mute))
                    if store.offlineDocumentIDs.contains(d.id) { TBChip(text: "Offline verfügbar", symbol: "arrow.down.circle", tint: Palette.positive) }
                }
                HStack(spacing: 12) {
                    Text(d.fileName).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute).lineLimit(1)
                    Text(d.sizeText).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                    if let p = d.pages { Text("\(p) Seiten").tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute) }
                }
                if let e = d.analysisError { Text(e).tbText(14, color: Palette.negative) }
                if let c = d.createdAt { Text("Hinzugefügt \(TBDate.displayDateTime(isoTimestamp: c))").tbText(13, color: Palette.mute) }
            }
            .padding(14)
        }
    }

    @ViewBuilder private var addresses: some View {
        let items: [(TripEvent, EventPlace)] = linkedEvents.flatMap { e in e.resolvedPlaces.map { (e, $0) } }
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Erkannte Adressen")
            if items.isEmpty {
                Text("Aus diesem Dokument wurden keine Adressen erkannt.").tbText(15, color: Palette.mute)
            }
            ForEach(items, id: \.1.id) { event, place in
                AddressPreview(event: event, place: place, type: store.catalog.typeOrFallback(for: event.type))
            }
            if let document, linkedEvents.isEmpty, let events = detail?.events, !events.isEmpty {
                Menu {
                    ForEach(events.filter { $0.type != "Aufgabe" }) { e in
                        Button("\(e.title)") { Task { await attach(document, to: e) } }
                    }
                } label: { Label("Dem Ereignis zuordnen", systemImage: "link").frame(maxWidth: .infinity) }
                    .buttonStyle(.tbSecondary)
            }
            if let attachMessage { InlineMessage(text: attachMessage, style: .info) }
        }
    }

    private func actions(_ d: TBDocument) -> some View {
        VStack(spacing: 8) {
            Button { Task { await reanalyze() } } label: {
                Label("Neu auswerten", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
            }
            .buttonStyle(.tbSecondary).disabled(busy)
            Button(role: .destructive) { confirmDelete = true } label: {
                Label("Dokument löschen", systemImage: "trash").frame(maxWidth: .infinity)
            }
            .buttonStyle(.tbDestructive).disabled(busy)
        }
    }

    private func load() async {
        if document == nil {
            document = detail?.events.flatMap(\.documents).first { $0.id == documentID }
        }
        do { document = try await store.api.document(id: documentID); error = nil }
        catch {
            if error.isCancellation { return }
            if document == nil { self.error = error.userMessage }
        }
    }

    private func reanalyze() async {
        busy = true; defer { busy = false }
        do { document = try await store.api.analyzeDocument(id: documentID); await store.refreshDetail(id: tripID); await store.refreshInbox() }
        catch { self.error = error.writeMessage }
    }

    private func delete() async {
        busy = true; defer { busy = false }
        do { try await store.api.deleteDocument(id: documentID); await store.refreshDetail(id: tripID); dismiss() }
        catch { self.error = error.writeMessage }
    }

    private func attach(_ d: TBDocument, to event: TripEvent) async {
        do {
            try await store.api.attachDocument(tripID: tripID, eventID: event.id, documentID: d.id)
            await store.refreshDetail(id: tripID)
            attachMessage = "Zugeordnet: \(event.title)"
        } catch {
            attachMessage = (error as? APIError)?.code == "forbidden"
                ? "Nur Administratoren können Dokumente Ereignissen zuordnen." : error.writeMessage
        }
    }
}

/// Adresse eines erkannten Ortes mit kleiner Karten-Vorschau.
struct AddressPreview: View {
    let event: TripEvent
    let place: EventPlace
    let type: EventTypeDef
    @State private var coordinate: CLLocationCoordinate2D?

    var body: some View {
        PlainCard {
            VStack(alignment: .leading, spacing: 0) {
                if let c = coordinate ?? place.coordinate {
                    Map(initialPosition: .region(MKCoordinateRegion(center: c, span: .init(latitudeDelta: 0.01, longitudeDelta: 0.01))),
                        interactionModes: []) {
                        Annotation(place.title, coordinate: c) {
                            EventMarker(point: MapPoint(id: place.id, coordinate: c, title: place.title, subtitle: nil, icon: type.icon,
                                                        color: type.color, eventID: event.id, role: place.role))
                        }
                    }
                    .mapControlVisibility(.hidden)
                    .frame(height: 110)
                    .allowsHitTesting(false)
                }
                VStack(alignment: .leading, spacing: 3) {
                    TBLabel("\(event.title) · \(place.roleTitle)", size: 11)
                    Text(place.title).tbTitle(17, relativeTo: .headline)
                    if let a = place.address { Text(a).tbText(14, color: Palette.mute).textSelection(.enabled) }
                    if coordinate == nil && place.coordinate == nil {
                        Text("Adresse wird gesucht …").tbText(13, color: Palette.mute)
                    }
                }
                .padding(12)
            }
        }
        .task(id: place.id) {
            guard place.coordinate == nil, let q = place.address ?? place.label else { return }
            coordinate = await PlaceResolver.resolve(q)
        }
        .accessibilityElement(children: .combine)
    }
}

extension EventPlace {
    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}
