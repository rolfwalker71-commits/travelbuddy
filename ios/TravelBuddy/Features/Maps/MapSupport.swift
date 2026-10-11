import CoreLocation
import MapKit
import SwiftUI
import UIKit

// Karten: natives MapKit (kein Schlüssel nötig). Koordinaten fehlen oft; dann lösen wir die Adresse per
// `MKLocalSearch` auf und speichern per PATCH (Vertrag «Adressen aus Dokumenten → Karte im Ereignis-Detail»).

struct MapPoint: Identifiable, Equatable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let title: String
    let subtitle: String?
    let icon: String
    let color: String
    let eventID: Int?
    let role: String?

    static func == (a: MapPoint, b: MapPoint) -> Bool {
        a.id == b.id && a.coordinate.latitude == b.coordinate.latitude && a.coordinate.longitude == b.coordinate.longitude
    }
}

enum MapPoints {
    /// Marker eines Ereignisses: alle Orte mit Koordinate (`places`), sonst Hauptkoordinate.
    static func points(for event: TripEvent, type: EventTypeDef, resolved: [String: CLLocationCoordinate2D] = [:]) -> [MapPoint] {
        var out: [MapPoint] = []
        for p in event.resolvedPlaces {
            var coord: CLLocationCoordinate2D?
            if let lat = p.lat, let lon = p.lon { coord = CLLocationCoordinate2D(latitude: lat, longitude: lon) }
            else if let r = resolved[p.id] { coord = r }
            guard let coord, CLLocationCoordinate2DIsValid(coord) else { continue }
            out.append(MapPoint(id: "\(event.id)-\(p.id)", coordinate: coord, title: p.title,
                                subtitle: p.role == "venue" ? event.title : p.roleTitle, icon: type.icon, color: type.color,
                                eventID: event.id, role: p.role))
        }
        if out.isEmpty, let lat = event.lat, let lon = event.lon {
            out.append(MapPoint(id: "\(event.id)-main", coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                                title: event.location ?? event.title, subtitle: event.title, icon: type.icon, color: type.color,
                                eventID: event.id, role: nil))
        }
        return out
    }

    /// Reisekarte: Marker aller Ereignisse in Reihenfolge, optional nur ein Tag.
    static func tripPoints(events: [TripEvent], catalog: EventCatalog, day: String?, tripZone: TimeZone) -> [MapPoint] {
        let sorted = TripTimeline.sort(events, tripZone: tripZone).filter { e in
            guard let day else { return true }
            return e.startDate == day || e.endDate == day
        }
        return sorted.flatMap { points(for: $0, type: catalog.typeOrFallback(for: $0.type)) }
    }

    static func region(for points: [MapPoint]) -> MKCoordinateRegion? {
        guard !points.isEmpty else { return nil }
        let lats = points.map(\.coordinate.latitude), lons = points.map(\.coordinate.longitude)
        let minLat = lats.min()!, maxLat = lats.max()!, minLon = lons.min()!, maxLon = lons.max()!
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max(0.02, (maxLat - minLat) * 1.5), longitudeDelta: max(0.02, (maxLon - minLon) * 1.5))
        return MKCoordinateRegion(center: center, span: span)
    }
}

enum PlaceResolver {
    /// Adresse oder Ortsname → Koordinate (`MKLocalSearch`). `nil`, wenn nichts gefunden wurde.
    static func resolve(_ query: String) async -> CLLocationCoordinate2D? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return nil }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = q
        do {
            let response = try await MKLocalSearch(request: request).start()
            return response.mapItems.first?.location.coordinate
        } catch {
            return nil
        }
    }

    struct Hit: Identifiable, Equatable {
        let id = UUID()
        let name: String
        let address: String
        let coordinate: CLLocationCoordinate2D
        static func == (a: Hit, b: Hit) -> Bool { a.id == b.id }
    }

    static func search(_ query: String) async -> [Hit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { return [] }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = q
        guard let response = try? await MKLocalSearch(request: request).start() else { return [] }
        return response.mapItems.prefix(8).map { item in
            Hit(name: item.name ?? q, address: item.address?.fullAddress ?? "",
                coordinate: item.location.coordinate)
        }
    }
}

@MainActor
enum MapsLauncher {
    static func item(coordinate: CLLocationCoordinate2D, name: String) -> MKMapItem {
        let item = MKMapItem(location: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude), address: nil)
        item.name = name
        return item
    }

    static func open(_ coordinate: CLLocationCoordinate2D, name: String) {
        item(coordinate: coordinate, name: name).openInMaps()
    }

    /// Wegbeschreibung vom aktuellen Standort (oder, mit `from`, vom ersten zum zweiten Ort).
    static func route(to coordinate: CLLocationCoordinate2D, name: String, from: (CLLocationCoordinate2D, String)? = nil) {
        let destination = item(coordinate: coordinate, name: name)
        if let from {
            MKMapItem.openMaps(with: [item(coordinate: from.0, name: from.1), destination],
                               launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
        } else {
            destination.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
        }
    }

    /// Route zum Hauptort eines Ereignisses; löst die Adresse bei Bedarf auf.
    static func route(for event: TripEvent) async -> Bool {
        let places = event.resolvedPlaces
        var coords: [(CLLocationCoordinate2D, String)] = []
        for p in places {
            if let lat = p.lat, let lon = p.lon { coords.append((CLLocationCoordinate2D(latitude: lat, longitude: lon), p.title)) }
            else if let q = [p.address, p.label].compactMap({ $0 }).first, let c = await PlaceResolver.resolve(q) { coords.append((c, p.title)) }
        }
        if coords.isEmpty, let q = event.address ?? event.location, let c = await PlaceResolver.resolve(q) { coords.append((c, event.location ?? q)) }
        guard let last = coords.last else { return false }
        if coords.count >= 2 { route(to: last.0, name: last.1, from: coords.first) } else { route(to: last.0, name: last.1) }
        return true
    }
}

/// Marker in Typfarbe mit Typ-Symbol.
struct EventMarker: View {
    let point: MapPoint
    var emphasized = false

    var body: some View {
        Image(systemName: TypeIcon.symbol(point.icon))
            .font(.system(size: emphasized ? 15 : 12, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: emphasized ? 34 : 28, height: emphasized ? 34 : 28)
            .background(Palette.type(point.color), in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
            .accessibilityLabel(point.title)
    }
}
