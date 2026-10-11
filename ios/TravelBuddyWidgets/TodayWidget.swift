import SwiftUI
import WidgetKit

/// «Heute»: Tagesband und bis zu vier Ereignisse, dazu «Tag x von y».
struct TodayWidget: Widget {
    static let kind = "ch.rolfwalker.travelbuddy.widget.today"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: SelectTripIntent.self, provider: TravelProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Heute")
        .description("Der Tag deiner Reise: Tagesband, Ereignisse und Tag x von y.")
        .supportedFamilies([.systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct TodayWidgetView: View {
    let entry: TravelEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .travelContainer(notched: false)
            .widgetURL(SharedLink.today)
    }

    @ViewBuilder private var content: some View {
        switch entry.content {
        case .signedOut: WidgetStatusView(kind: .signedOut, header: "Heute")
        case .unavailable: WidgetStatusView(kind: .unavailable, header: "Heute")
        case .data(let snapshot):
            if snapshot.trip == nil {
                WidgetStatusView(kind: .noTrip, header: "Heute")
            } else if family == .systemLarge {
                LargeToday(entry: entry, snapshot: snapshot)
            } else {
                MediumToday(entry: entry, snapshot: snapshot)
            }
        }
    }
}

// MARK: - Tagesangaben

private extension TravelSnapshot {
    func dayCaption(at date: Date) -> String? {
        guard let p = dayProgress(at: date) else {
            if let t = trip, phase(at: date) == "upcoming", let n = t.daysUntilStart(from: day(at: date)) {
                return n == 0 ? "Abreise heute" : (n == 1 ? "Abreise morgen" : "Abreise in \(n) Tagen")
            }
            return nil
        }
        return "Tag \(p.index) von \(p.count)"
    }
}

private extension Array where Element == SharedSummary.Event {
    /// Bis zu `limit` Einträge; ein mehrtägiger («Aufenthalt», «Unterwegs») behält seinen Platz am Ende der Liste.
    func visible(limit: Int) -> [SharedSummary.Event] {
        guard count > limit, let middle = first(where: \.isMiddle) else { return Array(prefix(limit)) }
        return Array(filter { !$0.isMiddle }.prefix(limit - 1)) + [middle]
    }
}

// MARK: - Mittel

private struct MediumToday: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot

    var body: some View {
        let day = snapshot.day(at: entry.date)
        let events = snapshot.remainingEvents(on: entry.date)
        let next = snapshot.nextEvent(at: entry.date)
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                TBCaption("Heute")
                Text(SharedFormat.weekday(day))
                    .font(TB.Font.title(20, weight: .bold, relativeTo: .title3))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(SharedFormat.date(day))
                    .font(TB.Font.mono(11.5, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.mute)
                Spacer(minLength: 4)
                if let caption = snapshot.dayCaption(at: entry.date) {
                    Text(caption)
                        .font(TB.Font.mono(11.5, weight: .semibold, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.accent)
                        .accentable()
                        .lineLimit(1)
                }
                TBDayBand(segments: snapshot.bandSegments(on: day), nowMinute: snapshot.minuteOfDay(at: entry.date),
                          showsLabels: false, height: 8)
            }
            .padding(.leading, 16).padding(.vertical, 14).padding(.trailing, 10)
            .frame(width: 128, alignment: .topLeading)

            Path { p in
                p.move(to: CGPoint(x: 0.5, y: 14)); p.addLine(to: CGPoint(x: 0.5, y: 140))
            }
            .stroke(TB.Palette.line, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))
            .frame(width: 1)

            VStack(alignment: .leading, spacing: 7) {
                if events.isEmpty {
                    Spacer(minLength: 0)
                    Text("Heute ist nichts geplant.")
                        .font(TB.Font.text(13, weight: .medium, relativeTo: .footnote))
                        .foregroundStyle(TB.Palette.mute)
                    Spacer(minLength: 0)
                } else {
                    ForEach(events.visible(limit: 4), id: \.self) { e in
                        EventRow(event: e, isNext: e.id == next?.id)
                    }
                    if events.count > 4 {
                        Text("+ \(events.count - 4) weitere")
                            .font(TB.Font.text(11, relativeTo: .caption2))
                            .foregroundStyle(TB.Palette.mute)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.leading, 12).padding(.trailing, 14).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - Gross

private struct LargeToday: View {
    let entry: TravelEntry
    let snapshot: TravelSnapshot

    var body: some View {
        let day = snapshot.day(at: entry.date)
        let events = snapshot.remainingEvents(on: entry.date)
        let next = snapshot.nextEvent(at: entry.date)
        let tomorrow = SharedFormat.isoDay(entry.date.addingTimeInterval(86_400), in: snapshot.zone)
        let tomorrowEvents = snapshot.events(on: tomorrow).filter { !$0.isMiddle }

        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    TBCaption(snapshot.trip?.title ?? "Heute")
                    Text(SharedFormat.weekdayDate(day))
                        .font(TB.Font.title(22, weight: .bold, relativeTo: .title2))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 8)
                if let caption = snapshot.dayCaption(at: entry.date) {
                    Text(caption)
                        .font(TB.Font.mono(12.5, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(TB.Palette.accent)
                        .accentable()
                }
            }
            TBDayBand(segments: snapshot.bandSegments(on: day), nowMinute: snapshot.minuteOfDay(at: entry.date), height: 10)

            TBPerforation(inset: 0)

            if events.isEmpty {
                Text("Heute ist nichts geplant.")
                    .font(TB.Font.text(14, weight: .medium, relativeTo: .body))
                    .foregroundStyle(TB.Palette.mute)
                    .padding(.top, 6)
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(events.visible(limit: 4), id: \.self) { e in
                        EventRow(event: e, isNext: e.id == next?.id, showsDetail: true, timeWidth: 48)
                    }
                    if events.count > 4 {
                        Text(events.count - 4 == 1 ? "+ 1 weiteres Ereignis" : "+ \(events.count - 4) weitere Ereignisse")
                            .font(TB.Font.text(11.5, relativeTo: .caption))
                            .foregroundStyle(TB.Palette.mute)
                    }
                }
            }
            Spacer(minLength: 0)
            if !tomorrowEvents.isEmpty {
                TBPerforation(inset: 0)
                HStack(spacing: 8) {
                    TBCaption("Morgen")
                    Text(tomorrowEvents.prefix(2).map { ($0.timeText.map { "\($0) " } ?? "") + $0.title }.joined(separator: " · "))
                        .font(TB.Font.text(12, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            if let stale = snapshot.staleText {
                Text(stale).font(TB.Font.text(10.5, relativeTo: .caption2)).foregroundStyle(TB.Palette.mute)
            }
        }
        .padding(16)
    }
}

// MARK: - Vorschauen

#Preview("Mittel", as: .systemMedium) {
    TodayWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .data(TravelProvider.upcomingSnapshot()))
    TravelEntry(date: .now, content: .signedOut)
}

#Preview("Gross", as: .systemLarge) {
    TodayWidget()
} timeline: {
    TravelEntry(date: .now, content: .data(TravelProvider.sampleSnapshot()))
    TravelEntry(date: .now, content: .unavailable)
}
