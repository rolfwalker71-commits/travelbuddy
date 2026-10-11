import SwiftUI
import WidgetKit

/// «Reise»: Titel, Zeitraum, Countdown bis Abreise bzw. Tag x von y, Mini-Routenbogen.
struct TripWidget: Widget {
    static let kind = "ch.rolfwalker.travelbuddy.widget.trip"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: SelectTripIntent.self, provider: TravelProvider()) { entry in
            TripWidgetView(entry: entry)
        }
        .configurationDisplayName("Reise")
        .description("Deine Reise mit Zeitraum, Countdown bis zur Abreise bzw. Tag x von y und Routenbogen.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
        .contentMarginsDisabled()
    }
}

struct TripWidgetView: View {
    let entry: TravelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .travelContainer(notched: false)
            .widgetURL(url)
    }

    @ViewBuilder private var content: some View {
        switch entry.content {
        case .signedOut: WidgetStatusView(kind: .signedOut, header: "Reise")
        case .unavailable: WidgetStatusView(kind: .unavailable, header: "Reise")
        case .data(let snapshot):
            if let trip = snapshot.trip, snapshot.phase(at: entry.date) != "past" {
                switch family {
                case .accessoryCircular: CircularTrip(entry: entry, snapshot: snapshot, trip: trip)
                case .systemMedium: MediumTrip(entry: entry, snapshot: snapshot, trip: trip)
                default: SmallTrip(entry: entry, snapshot: snapshot, trip: trip)
                }
            } else {
                WidgetStatusView(kind: .noTrip, header: "Reise")
            }
        }
    }

    private var url: URL {
        if case .data(let snapshot) = entry.content, let trip = snapshot.trip { return SharedLink.trip(trip.id) }
        return SharedLink.today
    }
}

private struct TripFacts {
    let isActive: Bool
    let dayIndex: Int?
    let dayCount: Int?
    let daysUntil: Int?

    init(snapshot: TravelSnapshot, trip: SharedSummary.Trip, at date: Date) {
        let day = snapshot.day(at: date)
        let progress = snapshot.dayProgress(at: date)
        isActive = snapshot.phase(at: date) == "active"
        dayIndex = progress?.index
        dayCount = progress?.count
        daysUntil = trip.daysUntilStart(from: day)
    }

    var headline: String {
        if isActive, let i = dayIndex, let c = dayCount { return "Tag \(i) von \(c)" }
        if isActive { return "Unterwegs" }
        if let d = daysUntil { return d == 0 ? "Heute geht's los" : (d == 1 ? "Morgen geht's los" : "In \(d) Tagen") }
        return "Geplant"
    }

    /// Anteil der Reise, der vorbei ist (0 vor Beginn).
    var progress: Double? {
        guard isActive, let i = dayIndex, let c = dayCount, c > 0 else { return isActive ? nil : 0 }
        return min(1, max(0, (Double(i) - 0.5) / Double(c)))
    }
}

private struct StripeHeader: View {
    let title: String
    let height: CGFloat

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            TBStripes(color: TB.Palette.accent, gap: 14)
            Text(title.uppercased())
                .font(TB.Font.title(11, weight: .bold, relativeTo: .caption))
                .tracking(0.9)
                .foregroundStyle(TB.Palette.onAccent)
                .lineLimit(1)
                .padding(.horizontal, 14).padding(.bottom, 6)
        }
        .frame(height: height)
        .accentable()
    }
}

// MARK: - Klein

private struct SmallTrip: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let trip: SharedSummary.Trip

    var body: some View {
        let facts = TripFacts(snapshot: snapshot, trip: trip, at: entry.date)
        VStack(alignment: .leading, spacing: 0) {
            StripeHeader(title: facts.isActive ? "Unterwegs" : "Reise", height: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.title)
                    .font(TB.Font.title(16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(trip.rangeStacked)
                    .font(TB.Font.mono(10.5, weight: .medium, relativeTo: .caption2))
                    .foregroundStyle(TB.Palette.mute)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if !facts.isActive, let d = facts.daysUntil {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text("\(d)")
                            .font(TB.Font.mono(32, weight: .semibold, relativeTo: .largeTitle))
                            .foregroundStyle(TB.Palette.ink)
                        Text(d == 1 ? "Tag bis Abreise" : "Tage bis Abreise")
                            .font(TB.Font.text(11, weight: .medium, relativeTo: .caption2))
                            .foregroundStyle(TB.Palette.mute)
                            .lineLimit(2)
                    }
                } else {
                    Text(facts.headline)
                        .font(TB.Font.mono(16, weight: .semibold, relativeTo: .headline))
                        .foregroundStyle(TB.Palette.accent)
                        .accentable()
                    if let p = facts.progress {
                        TBProgressBar(progress: p, tint: TB.Palette.accent, height: 5)
                    }
                }
            }
            .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 12)
        }
    }
}

// MARK: - Mittel

private struct MediumTrip: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let trip: SharedSummary.Trip

    var body: some View {
        let facts = TripFacts(snapshot: snapshot, trip: trip, at: entry.date)
        VStack(alignment: .leading, spacing: 0) {
            StripeHeader(title: [trip.destination, facts.isActive ? "unterwegs" : nil]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ").ifEmpty("Reise"), height: 28)
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.title)
                        .font(TB.Font.title(20, weight: .bold, relativeTo: .title3))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Text(trip.range)
                        .font(TB.Font.mono(11, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 2)
                    if !facts.isActive, let d = facts.daysUntil {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(d)")
                                .font(TB.Font.mono(30, weight: .semibold, relativeTo: .largeTitle))
                                .foregroundStyle(TB.Palette.ink)
                            Text(d == 1 ? "Tag bis zur Abreise" : "Tage bis zur Abreise")
                                .font(TB.Font.text(12, weight: .medium, relativeTo: .caption))
                                .foregroundStyle(TB.Palette.mute)
                        }
                    } else {
                        Text(facts.headline)
                            .font(TB.Font.mono(18, weight: .semibold, relativeTo: .headline))
                            .foregroundStyle(TB.Palette.accent)
                            .accentable()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(spacing: 4) {
                    TBRouteArc(stops: max(3, min(6, routeStops)), progress: facts.progress)
                        .frame(height: 64)
                    HStack {
                        Text(SharedFormat.date(trip.startDate))
                        Spacer(minLength: 2)
                        Text(SharedFormat.date(trip.endDate))
                    }
                    .font(TB.Font.mono(9, weight: .medium, relativeTo: .caption2))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(TB.Palette.mute)
                }
                .frame(width: 136)
            }
            .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
        }
    }

    private var routeStops: Int {
        var seen: [String] = []
        for e in snapshot.events {
            let place = e.location ?? e.title
            if !seen.contains(place) { seen.append(place) }
        }
        return seen.count
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

// MARK: - Sperrbildschirm

private struct CircularTrip: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let trip: SharedSummary.Trip

    var body: some View {
        let facts = TripFacts(snapshot: snapshot, trip: trip, at: entry.date)
        ZStack {
            AccessoryWidgetBackground()
            if facts.isActive, let i = facts.dayIndex, let c = facts.dayCount {
                Gauge(value: Double(i), in: 0...Double(max(c, 1))) {
                    EmptyView()
                } currentValueLabel: {
                    VStack(spacing: -1) {
                        Text("\(i)").font(TB.Font.mono(16, weight: .semibold, relativeTo: .headline))
                        Text("von \(c)").font(TB.Font.text(9, weight: .medium, relativeTo: .caption2))
                    }
                }
                .gaugeStyle(.accessoryCircularCapacity)
            } else if let d = facts.daysUntil {
                // Ring: die letzten 30 Tage vor der Abreise.
                Gauge(value: Double(max(0, 30 - min(d, 30))), in: 0...30) {
                    EmptyView()
                } currentValueLabel: {
                    VStack(spacing: -1) {
                        Text("\(d)").font(TB.Font.mono(16, weight: .semibold, relativeTo: .headline))
                        Text(d == 1 ? "Tag" : "Tage").font(TB.Font.text(9, weight: .medium, relativeTo: .caption2))
                    }
                }
                .gaugeStyle(.accessoryCircularCapacity)
            } else {
                Image(systemName: "suitcase.fill").font(.title3)
            }
        }
        .widgetAccentable()
        .accessibilityLabel("\(trip.title), \(facts.headline)")
    }
}

#Preview("Klein", as: .systemSmall) {
    TripWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
}

#Preview("Mittel", as: .systemMedium) {
    TripWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
}

#Preview("Sperrbildschirm rund", as: .accessoryCircular) {
    TripWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
}
