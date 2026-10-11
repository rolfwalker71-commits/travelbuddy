import CoreLocation
import MapKit
import SwiftUI

/// Karte im Ereignis-Detail, oberhalb der Buchungsdaten: Orte aus `places[]` mit Marker in Typfarbe, bei zwei Orten
/// als Linie; Adresse als Text; «In Karten öffnen», «Route», Adresse kopieren. Fehlende Koordinaten werden per
/// `MKLocalSearch` aufgelöst und per PATCH gespeichert.
struct EventMapCard: View {
    let event: TripEvent
    let type: EventTypeDef
    var autoRoute = false
    var onRouteHandled: () -> Void = {}

    @Environment(TravelStore.self) private var store
    @State private var resolved: [String: CLLocationCoordinate2D] = [:]
    @State private var searching = false
    @State private var failedPlaces: Set<String> = []
    @State private var copied = false
    @State private var routeFailed = false

    private var places: [EventPlace] { event.resolvedPlaces }
    private var points: [MapPoint] { MapPoints.points(for: event, type: type, resolved: resolved) }
    private var tint: Color { Palette.type(type.color) }

    var body: some View {
        if places.isEmpty && points.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                mapArea
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(places) { place in placeRow(place) }
                    if searching {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Adresse wird gesucht …").tbText(14, color: Palette.mute)
                        }
                    }
                    if !failedPlaces.isEmpty && !searching {
                        InlineMessage(text: "Die Adresse konnte nicht auf der Karte gefunden werden. Prüfe die Schreibweise im Ereignis.", style: .warning)
                    }
                    if routeFailed {
                        InlineMessage(text: "Für die Route fehlt ein auffindbarer Ort.", style: .warning)
                    }
                    actions
                }
                .padding(12)
            }
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous).strokeBorder(Palette.line))
            .clipShape(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous))
            .task(id: placeKey) { await resolveMissing() }
            .task(id: autoRoute) {
                if autoRoute {
                    if !(await MapsLauncher.route(for: event)) { routeFailed = true }
                    onRouteHandled()
                }
            }
        }
    }

    private var placeKey: String { places.map { "\($0.id)|\($0.lat ?? 0)|\($0.lon ?? 0)" }.joined(separator: ";") + "\(event.lat ?? 0)" }

    @ViewBuilder private var mapArea: some View {
        if points.isEmpty {
            ZStack {
                Palette.surface2
                VStack(spacing: 6) {
                    Image(systemName: searching ? "magnifyingglass" : "mappin.slash").font(.system(size: 26, weight: .light))
                    Text(searching ? "Adresse wird gesucht …" : "Noch kein Kartenpunkt").tbText(13, color: Palette.mute)
                }
                .foregroundStyle(Palette.mute)
            }
            .frame(height: 120)
        } else {
            let region = MapPoints.region(for: points)!
            Map(initialPosition: .region(region), interactionModes: []) {
                ForEach(points) { p in
                    Annotation(p.title, coordinate: p.coordinate, anchor: .center) { EventMarker(point: p, emphasized: true) }
                }
                if points.count == 2 {
                    MapPolyline(coordinates: points.map(\.coordinate), contourStyle: .geodesic)
                        .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [6, 5]))
                }
            }
            .id(points.map { "\($0.coordinate.latitude),\($0.coordinate.longitude)" }.joined())
            .mapControlVisibility(.hidden)
            .frame(height: 190)
            .accessibilityLabel("Karte mit \(points.count) Ort\(points.count == 1 ? "" : "en")")
        }
    }

    private func placeRow(_ place: EventPlace) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if places.count > 1 { TBLabel(place.roleTitle, size: 11) }
            Text(place.title).tbTitle(17, relativeTo: .headline)
            if let a = place.address, !a.isEmpty, a != place.title {
                Text(a).tbText(14, color: Palette.mute).textSelection(.enabled)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var actions: some View {
        FlowLayout(spacing: 8) {
            Button {
                if let p = points.first { MapsLauncher.open(p.coordinate, name: p.title) }
            } label: { Label("In Karten öffnen", systemImage: "map") }
                .buttonStyle(.tbCompact)
                .disabled(points.isEmpty)
            Button {
                Task { if !(await MapsLauncher.route(for: event)) { routeFailed = true } }
            } label: { Label("Route", systemImage: "arrow.triangle.turn.up.right.diamond") }
                .buttonStyle(.tbCompact)
            Button {
                let text = places.compactMap { $0.address ?? $0.label }.joined(separator: "\n")
                UIPasteboard.general.string = text.isEmpty ? (event.address ?? event.location ?? "") : text
                copied = true
                Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
            } label: { Label(copied ? "Kopiert" : "Adresse kopieren", systemImage: copied ? "checkmark" : "doc.on.doc") }
                .buttonStyle(.tbCompact)
        }
        .labelStyle(.titleAndIcon)
        .font(TB.Font.title(14, weight: .semibold))
    }

    /// Fehlende Koordinaten per MapKit auflösen und je Rolle im Ereignis speichern (`placeCoords`, Vertrag).
    private func resolveMissing() async {
        let missing = places.filter { !$0.hasCoordinate && resolved[$0.id] == nil }
        guard !missing.isEmpty else { return }
        searching = true
        defer { searching = false }
        failedPlaces = []
        var found: [String: JSONValue] = [:]
        for p in missing {
            guard let query = [p.address, p.label].compactMap({ $0 }).first(where: { !$0.isEmpty }) else { continue }
            let q = (p.address != nil && p.label != nil && p.address != p.label) ? "\(p.label!), \(p.address!)" : query
            var coordinate = await PlaceResolver.resolve(q)
            if coordinate == nil, q != query { coordinate = await PlaceResolver.resolve(query) }
            if let c = coordinate {
                resolved[p.id] = c
                found[p.role] = .object(["lat": .double(c.latitude), "lon": .double(c.longitude)])
            } else {
                failedPlaces.insert(p.id)
            }
        }
        // Speichern; scheitert das (offline, gesperrt), bleibt die Karte trotzdem richtig.
        if !found.isEmpty, !store.isOffline {
            var body: [String: JSONValue] = ["placeCoords": .object(found)]
            // Das Ereignis selbst hat noch keine Koordinate: den ersten Ort zusätzlich als Hauptkoordinate ablegen.
            if event.lat == nil, event.lon == nil, let first = missing.first, let c = resolved[first.id] {
                body["lat"] = .double(c.latitude); body["lon"] = .double(c.longitude)
            }
            try? await store.updateEvent(tripID: event.tripId, eventID: event.id, body: EventBody(body))
        }
    }
}

/// Reisekarte: Marker aller Ereignisse in Typfarbe, Route in Reihenfolge, Tagesfilter.
struct TripMapView: View {
    let tripID: Int
    var initialDay: String?
    var showsTitle = true

    @Environment(TravelStore.self) private var store
    @Environment(\.navigate) private var navigate
    @State private var day: String?
    @State private var position: MapCameraPosition = .automatic
    @State private var selected: String?
    @State private var resolved: [Int: CLLocationCoordinate2D] = [:]

    private var detail: TripDetail? { store.detail(id: tripID) }
    private var zone: TimeZone { detail?.trip.zone ?? .current }

    private var days: [String] {
        let all = (detail?.events ?? []).flatMap { [$0.startDate, $0.endDate].compactMap { $0 } }
        return Array(Set(all)).sorted()
    }

    private var points: [MapPoint] {
        guard let detail else { return [] }
        let base = MapPoints.tripPoints(events: detail.events, catalog: store.catalog, day: day, tripZone: zone)
        // Aufgelöste Adressen ergänzen (nur im Speicher).
        let known = Set(base.compactMap(\.eventID))
        let extra = detail.events.filter { !known.contains($0.id) && (day == nil || $0.startDate == day) }.compactMap { e -> MapPoint? in
            guard let c = resolved[e.id] else { return nil }
            let t = store.catalog.typeOrFallback(for: e.type)
            return MapPoint(id: "\(e.id)-r", coordinate: c, title: e.location ?? e.title, subtitle: e.title, icon: t.icon, color: t.color, eventID: e.id, role: nil)
        }
        return base + extra
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Map(position: $position, selection: $selected) {
                ForEach(points) { p in
                    Annotation(p.title, coordinate: p.coordinate, anchor: .center) {
                        EventMarker(point: p, emphasized: selected == p.id)
                    }
                    .tag(p.id)
                }
                if points.count >= 2 {
                    MapPolyline(coordinates: points.map(\.coordinate), contourStyle: .geodesic)
                        .stroke(Palette.accent.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [7, 5]))
                }
            }
            .mapControls { MapCompass(); MapScaleView() }
            .overlay(alignment: .top) { dayFilter }
            if let p = points.first(where: { $0.id == selected }), let id = p.eventID {
                selectionCard(p, eventID: id)
            }
            if points.isEmpty {
                InlineMessage(text: "Für diese Auswahl gibt es noch keine Orte mit Koordinaten.", style: .info).padding()
            }
        }
        .navigationTitle(showsTitle ? "Karte" : "")
        .navigationBarTitleDisplayMode(.inline)
        .task { day = initialDay; fit(); await resolveMissing() }
        .onChange(of: day) { _, _ in fit() }
        .onChange(of: points.count) { _, _ in fit() }
    }

    private var dayFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("Alle", on: day == nil) { day = nil }
                ForEach(days, id: \.self) { d in
                    chip(TBDate.display(d), on: day == d) { day = d }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .background(.ultraThinMaterial)
    }

    private func chip(_ text: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).tbMono(13, weight: .semibold, relativeTo: .footnote, color: on ? Palette.onAccent : Palette.ink)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(on ? Palette.accent : Palette.surface, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Palette.line))
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func selectionCard(_ p: MapPoint, eventID: Int) -> some View {
        Button { navigate(.event(EventRef(tripID: tripID, eventID: eventID))) } label: {
            HStack(spacing: 10) {
                TypeBadge(icon: p.icon, color: p.color, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.subtitle ?? p.title).tbTitle(17, relativeTo: .headline)
                    Text(p.title).tbText(14, color: Palette.mute)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Palette.mute)
            }
            .padding(12)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
            .padding(12)
        }
        .buttonStyle(.plain)
    }

    private func fit() {
        if let r = MapPoints.region(for: points) { position = .region(r) }
    }

    private func resolveMissing() async {
        guard let detail else { return }
        for e in detail.events where !e.hasCoordinate && e.places.allSatisfy({ !$0.hasCoordinate }) {
            guard let q = e.address ?? e.location, resolved[e.id] == nil, let c = await PlaceResolver.resolve(q) else { continue }
            resolved[e.id] = c
        }
    }
}
