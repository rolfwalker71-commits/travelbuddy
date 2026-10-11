import SwiftUI
import WidgetKit

/// «Als Nächstes»: nächstes Ereignis als Mini-Ticket (klein, mittel), als Übersicht mit Tagesband, Folgeereignissen und
/// Saldo (gross) bzw. als Sperrbildschirm-Widget.
struct NextWidget: Widget {
    static let kind = "ch.rolfwalker.travelbuddy.widget.next"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: SelectTripIntent.self, provider: TravelProvider(needsLedger: true)) { entry in
            NextWidgetView(entry: entry)
        }
        .configurationDisplayName("Als Nächstes")
        .description("Das nächste Ereignis deiner Reise mit Zeit, Ort, Referenz und Countdown.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

struct NextWidgetView: View {
    let entry: TravelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .travelContainer(axis: family == .systemMedium || family == .systemExtraLarge ? .vertical : .horizontal, fraction: containerFraction)
            .widgetURL(url)
    }

    private var containerFraction: CGFloat {
        switch family {
        case .systemMedium: 0.67
        case .systemExtraLarge: ExtraLargeNext.split
        case .systemLarge: LargeNext.split
        default: 0.70
        }
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
                case .systemLarge: LargeNext(entry: entry, snapshot: snapshot, event: event)
                case .systemExtraLarge: ExtraLargeNext(entry: entry, snapshot: snapshot, event: event)
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
            let split = g.size.height * 0.70
            ZStack(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 20).accentable()
                        TBCaption(event.headLabel)
                        Spacer(minLength: 0)
                    }
                    EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 27)
                    Text(event.title)
                        .font(TB.Font.title(13.5, weight: .bold, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(2)
                        .padding(.top, 1)
                }
                .padding(.horizontal, 14)
                .padding(.top, 11)
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
        // Feste Ticket-Aufteilung: bei sehr grosser Systemschrift nicht über den Rand wachsen.
        .dynamicTypeSize(...DynamicTypeSize.large)
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
                    .padding(.leading, 16).padding(.trailing, 12).padding(.vertical, 12)
                    .frame(width: split, height: g.size.height, alignment: .topLeading)

                Path { p in
                    p.move(to: CGPoint(x: split, y: 14))
                    p.addLine(to: CGPoint(x: split, y: g.size.height - 14))
                }
                .stroke(TB.Palette.line, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))

                stub
                    .padding(.horizontal, 12).padding(.vertical, 12)
                    .frame(width: g.size.width - split, height: g.size.height, alignment: .topLeading)
                    .offset(x: split)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private var main: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 22).accentable()
                TBCaption(event.headLabel).layoutPriority(1)
                if let trip = snapshot.trip {
                    Text("·").foregroundStyle(TB.Palette.mute)
                    TBCaption(trip.title)
                }
                Spacer(minLength: 0)
            }
            EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 30, endText: endText)
            Text(event.title)
                .font(TB.Font.title(16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(TB.Palette.ink)
                .lineLimit(2)
                .padding(.top, 1)
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

    private var endText: String? {
        guard event.hasTime, event.dayRole == nil || event.dayRole == "single" else { return nil }
        return SharedFormat.time(event.endTime)
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

// MARK: - Gross

private struct LargeNext: View {
    /// Anteil der Höhe oberhalb der Perforation (Hero und Tagesband).
    static let split: CGFloat = 0.54

    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    /// Folgeereignisse nach dem Hero, chronologisch (ohne mehrtägige «Mitte»-Einträge).
    private var upcoming: [SharedSummary.Event] {
        guard let index = snapshot.events.firstIndex(where: { $0.id == event.id }) else { return [] }
        return snapshot.events[(index + 1)...].filter { !$0.isMiddle }
    }

    var body: some View {
        GeometryReader { g in
            let split = g.size.height * Self.split
            let rowHeight: CGFloat = 36
            let capacity = max(2, min(4, Int((g.size.height - split - 14 - 36) / rowHeight)))
            let shown = Array(upcoming.prefix(capacity))
            let more = upcoming.count - shown.count
            ZStack(alignment: .topLeading) {
                top
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .frame(width: g.size.width, height: split, alignment: .topLeading)

                TBPerforation(inset: 12)
                    .frame(width: g.size.width)
                    .offset(y: split - 1)

                bottom(shown: shown, more: more)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 12)
                    .frame(width: g.size.width, height: g.size.height - split, alignment: .topLeading)
                    .offset(y: split)
            }
        }
        // Feste Ticket-Aufteilung: bei sehr grosser Systemschrift nicht über den Rand wachsen.
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private var top: some View {
        let day = event.shownDate ?? snapshot.day(at: entry.date)
        let isToday = day == snapshot.day(at: entry.date)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 22).accentable()
                TBCaption(event.headLabel).layoutPriority(1)
                if let trip = snapshot.trip {
                    Text("·").foregroundStyle(TB.Palette.mute)
                    TBCaption(trip.title)
                }
                Spacer(minLength: 0)
                if let fetched = snapshot.fetchedAt {
                    Text("Stand \(SharedFormat.time(fetched, in: snapshot.zone))")
                        .font(TB.Font.mono(10.5, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            HStack(alignment: .top, spacing: 10) {
                EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 36, endText: endText)
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 1) {
                    TBCaption("In")
                    NextCountdown(entry: entry, event: event, snapshot: snapshot, size: 20, prefixed: false)
                }
            }
            Text(event.title)
                .font(TB.Font.title(17, weight: .bold, relativeTo: .headline))
                .foregroundStyle(TB.Palette.ink)
                .lineLimit(2)
            if !placeLine.isEmpty {
                HStack(spacing: 5) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(TB.Palette.mute)
                    Text(placeLine)
                        .font(TB.Font.text(12, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            TBDayBand(segments: snapshot.bandSegments(on: day), nowMinute: isToday ? snapshot.minuteOfDay(at: entry.date) : nil,
                      height: 8)
        }
    }

    private var endText: String? {
        guard event.hasTime, event.dayRole == nil || event.dayRole == "single" else { return nil }
        return SharedFormat.time(event.endTime)
    }

    private var placeLine: String {
        [event.location, event.localTimeNote(tripZone: snapshot.zone)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func bottom(shown: [SharedSummary.Event], more: Int) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            if shown.isEmpty {
                Text("Danach ist nichts mehr geplant.")
                    .font(TB.Font.text(13, weight: .medium, relativeTo: .footnote))
                    .foregroundStyle(TB.Palette.mute)
            } else {
                ForEach(shown, id: \.self) { e in
                    UpcomingRow(event: e, today: snapshot.day(at: entry.date))
                }
            }
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline) {
                Text(more > 0 ? (more == 1 ? "+ 1 weiteres Ereignis" : "+ \(more) weitere Ereignisse")
                     : (snapshot.staleText ?? "Alle Ereignisse angezeigt"))
                    .font(TB.Font.text(11, relativeTo: .caption2))
                    .foregroundStyle(TB.Palette.mute)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let ledger = snapshot.ledger {
                    let mine = ledger.balances.first(where: \.isMe)?.netMinor ?? ledger.balanceMinor
                    HStack(spacing: 4) {
                        Text("Saldo").font(TB.Font.text(11, relativeTo: .caption2)).foregroundStyle(TB.Palette.mute)
                        Text(SharedFormat.money(minor: mine, currency: ledger.currency, decimals: false, showPlus: true))
                            .font(TB.Font.mono(12, weight: .semibold, relativeTo: .footnote))
                            .foregroundStyle(mine < 0 ? TB.Palette.negative : (mine > 0 ? TB.Palette.positive : TB.Palette.ink))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
            }
        }
    }
}

/// Zeile der Folgeereignisse: Zeit (an einem anderen Tag mit Datum darunter), Typ-Quadrat, Titel, Ort.
private struct UpcomingRow: View {
    let event: SharedSummary.Event
    let today: String

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(event.timeText ?? event.roleLabel ?? "ganztags")
                    .font(event.timeText != nil
                          ? TB.Font.mono(12.5, weight: .semibold, relativeTo: .caption)
                          : TB.Font.title(11.5, weight: .semibold, relativeTo: .caption2))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if event.shownDate != today, !event.dateText.isEmpty {
                    Text(event.dateText)
                        .font(TB.Font.mono(9.5, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(width: 66, alignment: .leading)
            TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 22).accentable()
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(TB.Font.text(13.5, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(1)
                if let place = event.location, !place.isEmpty {
                    Text(place)
                        .font(TB.Font.text(11, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(height: 29)
    }
}

// MARK: - Extragross (iPad)

/// Zwei Spalten wie ein breites Ticket: links Hero, Tagesband und Saldo, rechts die Folgeereignisse.
private struct ExtraLargeNext: View {
    /// Anteil der Breite links der Perforation.
    static let split: CGFloat = 0.44

    let entry: TravelEntry
    let snapshot: TravelSnapshot
    let event: SharedSummary.Event

    private var upcoming: [SharedSummary.Event] {
        guard let index = snapshot.events.firstIndex(where: { $0.id == event.id }) else { return [] }
        return snapshot.events[(index + 1)...].filter { !$0.isMiddle }
    }

    private var endText: String? {
        guard event.hasTime, event.dayRole == nil || event.dayRole == "single" else { return nil }
        return SharedFormat.time(event.endTime)
    }

    private var placeLine: String {
        [event.location, event.localTimeNote(tripZone: snapshot.zone)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        GeometryReader { g in
            let split = g.size.width * Self.split
            ZStack(alignment: .topLeading) {
                left
                    .padding(.leading, 20).padding(.trailing, 16).padding(.vertical, 16)
                    .frame(width: split, height: g.size.height, alignment: .topLeading)

                Path { p in
                    p.move(to: CGPoint(x: split, y: 16))
                    p.addLine(to: CGPoint(x: split, y: g.size.height - 16))
                }
                .stroke(TB.Palette.line, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))

                right(height: g.size.height)
                    .padding(.leading, 16).padding(.trailing, 20).padding(.vertical, 16)
                    .frame(width: g.size.width - split, height: g.size.height, alignment: .topLeading)
                    .offset(x: split)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private var left: some View {
        let day = event.shownDate ?? snapshot.day(at: entry.date)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: 26).accentable()
                TBCaption(event.headLabel, size: 11.5).layoutPriority(1)
                if let trip = snapshot.trip {
                    Text("·").foregroundStyle(TB.Palette.mute)
                    TBCaption(trip.title, size: 11.5)
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .top, spacing: 12) {
                EventTimeText(event: event, day: snapshot.day(at: entry.date), size: 44, endText: endText)
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 1) {
                    TBCaption("In")
                    NextCountdown(entry: entry, event: event, snapshot: snapshot, size: 22, prefixed: false)
                }
            }
            Text(event.title)
                .font(TB.Font.title(20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(TB.Palette.ink)
                .lineLimit(2)
            if !placeLine.isEmpty {
                HStack(spacing: 5) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TB.Palette.mute)
                    Text(placeLine)
                        .font(TB.Font.text(13, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            TBDayBand(segments: snapshot.bandSegments(on: day),
                      nowMinute: day == snapshot.day(at: entry.date) ? snapshot.minuteOfDay(at: entry.date) : nil,
                      height: 9)
            HStack(alignment: .firstTextBaseline) {
                if let fetched = snapshot.fetchedAt {
                    Text("Stand \(SharedFormat.dateTime(fetched, in: snapshot.zone))")
                        .font(TB.Font.mono(10.5, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if let ledger = snapshot.ledger {
                    let mine = ledger.balances.first(where: \.isMe)?.netMinor ?? ledger.balanceMinor
                    HStack(spacing: 4) {
                        Text("Saldo").font(TB.Font.text(11.5, relativeTo: .caption2)).foregroundStyle(TB.Palette.mute)
                        Text(SharedFormat.money(minor: mine, currency: ledger.currency, decimals: false, showPlus: true))
                            .font(TB.Font.mono(13, weight: .semibold, relativeTo: .footnote))
                            .foregroundStyle(mine < 0 ? TB.Palette.negative : (mine > 0 ? TB.Palette.positive : TB.Palette.ink))
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private func right(height: CGFloat) -> some View {
        let capacity = max(3, min(7, Int((height - 32 - 30) / 40)))
        let shown = Array(upcoming.prefix(capacity))
        let more = upcoming.count - shown.count
        return VStack(alignment: .leading, spacing: 8) {
            TBCaption("Danach", size: 11.5)
            if shown.isEmpty {
                Text("Danach ist nichts mehr geplant.")
                    .font(TB.Font.text(14, weight: .medium, relativeTo: .body))
                    .foregroundStyle(TB.Palette.mute)
            } else {
                ForEach(shown, id: \.self) { e in
                    UpcomingRow(event: e, today: snapshot.day(at: entry.date))
                }
            }
            Spacer(minLength: 0)
            if more > 0 {
                Text(more == 1 ? "+ 1 weiteres Ereignis" : "+ \(more) weitere Ereignisse")
                    .font(TB.Font.text(11.5, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.mute)
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

#Preview("Gross", as: .systemLarge) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
    TravelEntry(date: .now, content: .unavailable)
}

#Preview("Extragross", as: .systemExtraLarge) {
    NextWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
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
