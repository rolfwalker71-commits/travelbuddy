import SwiftUI
import WidgetKit

/// Gemeinsamer Zeitleisten-Lieferant aller Reise-Widgets (Konfiguration «Reise wählen»).
struct TravelProvider: AppIntentTimelineProvider {
    typealias Intent = SelectTripIntent
    typealias Entry = TravelEntry

    /// Die Reisekasse braucht zusätzlich die Salden der Reise.
    var needsLedger = false

    func placeholder(in context: Context) -> TravelEntry {
        TravelEntry(date: Date(), content: .data(Self.sampleSnapshot()), isPlaceholder: true)
    }

    func snapshot(for configuration: SelectTripIntent, in context: Context) async -> TravelEntry {
        let now = Date()
        // Widget-Galerie: immer Beispieldaten, damit sie auch ohne Anmeldung etwas zeigt.
        if context.isPreview { return TravelEntry(date: now, content: .data(Self.sampleSnapshot(now: now))) }
        let content = await TravelWidgetLoader.load(tripId: configuration.tripId, needsLedger: needsLedger, now: now)
        return TravelEntry(date: now, content: content)
    }

    func timeline(for configuration: SelectTripIntent, in context: Context) async -> Timeline<TravelEntry> {
        let now = Date()
        let content = await TravelWidgetLoader.load(tripId: configuration.tripId, needsLedger: needsLedger, now: now)
        let entries = TravelTimeline.entries(now: now, content: content)
        return Timeline(entries: entries, policy: .after(TravelTimeline.reloadDate(now: now, content: content)))
    }

    static func sampleSnapshot(now: Date = Date()) -> TravelSnapshot {
        TravelWidgetLoader.snapshot(from: SharedSampleData.summary(now: now), tripId: nil, fetchedAt: now, cached: false)
    }

    static func upcomingSnapshot(now: Date = Date()) -> TravelSnapshot {
        TravelWidgetLoader.snapshot(from: SharedSampleData.upcomingSummary(now: now), tripId: nil, fetchedAt: now, cached: false)
    }
}
