import SwiftUI
import WidgetKit

/// «Als Nächstes»: nächstes Ereignis als Mini-Ticket (klein, mittel) bzw. als Sperrbildschirm-Widget.
struct NextWidget: Widget {
    static let kind = "ch.rolfwalker.travelbuddy.widget.next"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: SelectTripIntent.self, provider: TravelProvider()) { entry in
            NextWidgetView(entry: entry)
        }
        .configurationDisplayName("Als Nächstes")
        .description("Das nächste Ereignis deiner Reise mit Zeit, Ort, Referenz und Countdown.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct NextWidgetView: View {
    let entry: TravelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .travelContainer(axis: family == .systemMedium ? .vertical : .horizontal, fraction: family == .systemMedium ? 0.67 : 0.64)
            .widgetURL(url)
    }

    @ViewBuilder private var content: some View {
        switch entry.content {
        case .signedOut:
            WidgetStatusView(kind: .signedOut, header: "Als Nächstes")
        case .unavailable:
            WidgetStatusView(kind: .unavailable, header: "Als Nächstes")
        case .data(let snapshot):
            if let event = snapshot.nextEvent(at: entry.date) {
                switch family {
                case .systemMedium: MediumNext(entry: entry, snapshot: snapshot, event: event)
                case .accessoryCircular: CircularNext(entry: entry, snapshot: snapshot, event: event)
                case .accessoryRectangular: RectangularNext(entry: entry, snapshot: snapshot, event: event)
                case .accessoryInline: InlineNext(entry: entry, snapshot: snapshot, event: event)
                default: SmallNext(entry: entry, snapshot: snapshot, event: event)
                }
            } else if snapshot.trip == nil {
                WidgetStatusView(kind: .noTrip, header: "Als Nächstes")
            } else {
                WidgetStatusView(kind: .noEvents, header: "Als Nächstes")
            }
        }
    }

    private var url: URL {
        guard case .data(let snapshot) = entry.content else { return SharedLink.today }
        if let event = snapshot.nextEvent(at: entry.date) {
            return SharedLink.event(trip: event.tripId ?? snapshot.trip?.id ?? 0, event: event.id)
        }
        if let trip = snapshot.trip { return SharedLink.trip(trip.id) }
        return SharedLink.today
    }
}

// MARK: - Gemeinsame Teile

private extension SharedSummary.Event {
    /// Beschriftung im Ticket-Kopf: Typ-Startlabel («ABFLUG», «CHECK-IN») oder der Typ selbst.
    var headLabel: String {
        if let label = roleLabel { return label }
        if title.localizedCaseInsensitiveContains("check-out") { return "Check-out" }
        switch catalog.id {
        case "Flug", "Zugreisen", "Hotel", "Unterkunft", "Mietauto", "Transfer": return catalog.startLabel
        default: return catalog.label
        }
    }
}

private struct NextCountdown: View {
    let entry: TravelEntry
    let event: SharedSummary.Event
    let snapshot: TravelSnapshot
    var size: CGFloat = 13
    var prefixed = true

    var body: some View {
        if let start = event.start(fallback: snapshot.zone) {
            Group {
                if start <= entry.date {
                    Text("Jetzt")
                } else {
                    TBCountdown(target: start, from: entry.date, prefixed: prefixed)
                }
            }
            .font(TB.Font.mono(size, weight: .semibold, relativeTo: .footnote))
            .foregroundStyle(TB.Palette.accent)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.leading)
            .accentable()
        } else {
            Text(event.dateText)
                .font(TB.Font.mono(size - 1, weight: .medium, relativeTo: .footnote))
                .foregroundStyle(TB.Palette.mute)
        }
    }
}

// MARK: - Klein

private struct SmallNext: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    var body: some View {
        GeometryReader { g in
            let split = g.size.height * 0.64
            ZStack(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 22).accentable()
                        TBCaption(event.headLabel)
                        Spacer(minLength: 0)
                    }
                    EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 30)
                    Text(event.title)
                        .font(TB.Font.title(14.5, weight: .bold, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .frame(width: g.size.width, height: split, alignment: .topLeading)

                TBPerforation(inset: 12)
                    .frame(width: g.size.width)
                    .offset(y: split - 1)

                HStack(alignment: .center, spacing: 6) {
                    VStack(alignment: .leading, spacing: 1) {
                        if let place = event.location, !place.isEmpty {
                            Text(place)
                                .font(TB.Font.text(11, relativeTo: .caption2))
                                .foregroundStyle(TB.Palette.mute)
                                .lineLimit(1)
                        }
                        if let ref = event.bookingReference, !ref.isEmpty {
                            Text(ref)
                                .font(TB.Font.mono(11, weight: .medium, relativeTo: .caption2))
                                .foregroundStyle(TB.Palette.ink)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    NextCountdown(entry: entry, event: event, snapshot: snapshot, size: 12.5)
                        .frame(maxWidth: 70, alignment: .trailing)
                }
                .padding(.horizontal, 14)
                .frame(width: g.size.width, height: g.size.height - split, alignment: .center)
                .offset(y: split)
            }
        }
    }
}

// MARK: - Mittel

private struct MediumNext: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    var body: some View {
        GeometryReader { g in
            let split = g.size.width * 0.67
            ZStack(alignment: .topLeading) {
                main
                    .padding(.leading, 16).padding(.trailing, 14).padding(.vertical, 14)
                    .frame(width: split, height: g.size.height, alignment: .topLeading)

                Path { p in
                    p.move(to: CGPoint(x: split, y: 14))
                    p.addLine(to: CGPoint(x: split, y: g.size.height - 14))
                }
                .stroke(TB.Palette.line, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))

                stub
                    .padding(.horizontal, 12).padding(.vertical, 14)
                    .frame(width: g.size.width - split, height: g.size.height, alignment: .topLeading)
                    .offset(x: split)
            }
        }
    }

    private var main: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 24).accentable()
                TBCaption(event.headLabel)
                if let trip = snapshot.trip {
                    Text("·").foregroundStyle(TB.Palette.mute)
                    TBCaption(trip.title)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 32)
                if let end = SharedFormat.time(event.endTime), event.hasTime, event.dayRole == nil || event.dayRole == "single" {
                    Text("→ \(end)")
                        .font(TB.Font.mono(13, weight: .medium, relativeTo: .footnote))
                        .foregroundStyle(TB.Palette.mute)
                }
            }
            Text(event.title)
                .font(TB.Font.title(17, weight: .bold, relativeTo: .headline))
                .foregroundStyle(TB.Palette.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 0)
            HStack(spacing: 5) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TB.Palette.mute)
                Text([event.location, event.localTimeNote(tripZone: snapshot.zone)]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(TB.Font.text(12, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.mute)
                    .lineLimit(1)
            }
        }
    }

    private var stub: some View {
        VStack(alignment: .leading, spacing: 4) {
            TBCaption("In")
            NextCountdown(entry: entry, event: event, snapshot: snapshot, size: 19, prefixed: false)
            Spacer(minLength: 0)
            if let ref = event.bookingReference, !ref.isEmpty {
                TBCaption("Referenz", size: 9)
                Text(ref)
                    .font(TB.Font.mono(12, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                TBBarcode(seed: ref, color: TB.Palette.ink)
                    .frame(height: 18)
                    .opacity(0.85)
            }
        }
    }
}

// MARK: - Sperrbildschirm

private struct CircularNext: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let start = event.start(fallback: snapshot.zone), start > entry.date {
                let remaining = start.timeIntervalSince(entry.date)
                if remaining < 24 * 3600 {
                    // Ring: letzte drei Stunden bis zum Ereignis, davor voll.
                    let from = min(entry.date, start.addingTimeInterval(-3 * 3600))
                    ProgressView(timerInterval: from...start, countsDown: true) {
                        EmptyView()
                    } currentValueLabel: {
                        VStack(spacing: 0) {
                            Image(systemName: TBIconMap.symbol(for: event.iconName) ?? "mappin")
                                .font(.system(size: 11, weight: .semibold))
                            Text(timerInterval: entry.date...start, pauseTime: start, countsDown: true, showsHours: false)
                                .font(TB.Font.mono(11, weight: .semibold, relativeTo: .caption2))
                                .monospacedDigit()
                                .minimumScaleFactor(0.6)
                        }
                    }
                    .progressViewStyle(.circular)
                } else {
                    let days = Int(remaining / 86_400)
                    Gauge(value: 1) {
                        EmptyView()
                    } currentValueLabel: {
                        VStack(spacing: 0) {
                            Image(systemName: TBIconMap.symbol(for: event.iconName) ?? "mappin")
                                .font(.system(size: 11, weight: .semibold))
                            Text("\(days) T")
                                .font(TB.Font.mono(12, weight: .semibold, relativeTo: .caption))
                        }
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                }
            } else {
                VStack(spacing: 1) {
                    Image(systemName: TBIconMap.symbol(for: event.iconName) ?? "mappin")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Jetzt").font(TB.Font.title(11, weight: .bold, relativeTo: .caption2))
                }
            }
        }
        .widgetAccentable()
        .accessibilityLabel("\(event.title), \(event.timeText ?? "")")
    }
}

private struct RectangularNext: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    /// Zeit; an einem anderen Tag davor das vollständige Datum (`26.10.2026 07:45`).
    private var rectangularTime: String {
        let time = event.timeText
        if event.shownDate == snapshot.day(at: entry.date) { return time ?? event.roleLabel ?? "ganztags" }
        return [event.dateText, time].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: TBIconMap.symbol(for: event.iconName) ?? "mappin")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 20)
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(TB.Font.title(14, weight: .bold, relativeTo: .headline))
                    .lineLimit(1)
                    .widgetAccentable()
                HStack(spacing: 4) {
                    Text(rectangularTime)
                        .font(TB.Font.mono(12, weight: .semibold, relativeTo: .caption))
                    if let place = event.location, !place.isEmpty {
                        Text(place).font(TB.Font.text(11.5, relativeTo: .caption)).lineLimit(1)
                    }
                }
                if let start = event.start(fallback: snapshot.zone), start > entry.date {
                    HStack(spacing: 4) {
                        Text("in")
                        TBCountdown(target: start, from: entry.date)
                    }
                    .font(TB.Font.mono(11.5, weight: .medium, relativeTo: .caption2))
                    .foregroundStyle(.secondary)
                } else if let ref = event.bookingReference {
                    Text(ref).font(TB.Font.mono(11.5, relativeTo: .caption2)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct InlineNext: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    private var inlineTime: String {
        let time = event.timeText
        if event.shownDate == snapshot.day(at: entry.date) { return time ?? event.roleLabel ?? "ganztags" }
        return [event.dateText, time].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    var body: some View {
        Label {
            Text("\(inlineTime) \(event.title)")
                .font(TB.Font.text(13, weight: .semibold, relativeTo: .footnote))
        } icon: {
            Image(systemName: TBIconMap.symbol(for: event.iconName) ?? "mappin")
        }
    }
}

// MARK: - Vorschauen

#Preview("Klein", as: .systemSmall) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
    TravelEntry(date: .now, content: .signedOut)
}

#Preview("Mittel", as: .systemMedium) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
    TravelEntry(date: .now, content: .unavailable)
}

#Preview("Sperrbildschirm rechteckig", as: .accessoryRectangular) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
}

#Preview("Sperrbildschirm rund", as: .accessoryCircular) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
}

#Preview("Sperrbildschirm Zeile", as: .accessoryInline) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
}
