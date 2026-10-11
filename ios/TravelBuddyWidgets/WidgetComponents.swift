import SwiftUI
import WidgetKit

// MARK: - Hintergrund (Papier, Ticket mit Kerben) und Rendering-Modi

/// Ticket-Hintergrund: Papierfläche mit Perforationskerben nur im Vollfarb-Modus; akzentuiert/vibrant übernimmt das System.
struct TicketBackground: View {
    var axis: Axis = .horizontal
    var fraction: CGFloat = 0.64
    var notched = true
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        if mode == .fullColor {
            if notched {
                TBTicketShape(fraction: fraction, axis: axis, cornerRadius: 0, notchRadius: 8).fill(TB.Palette.surface)
            } else {
                TB.Palette.surface
            }
        } else {
            Color.clear
        }
    }
}

/// Setzt je Familie den passenden Container-Hintergrund (Lock Screen transparent, sonst Ticket).
struct TravelContainer: ViewModifier {
    var axis: Axis = .horizontal
    var fraction: CGFloat = 0.64
    var notched = true
    @Environment(\.widgetFamily) private var family

    func body(content: Content) -> some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            content.containerBackground(.clear, for: .widget)
        default:
            content.containerBackground(for: .widget) { TicketBackground(axis: axis, fraction: fraction, notched: notched) }
        }
    }
}

extension View {
    func travelContainer(axis: Axis = .horizontal, fraction: CGFloat = 0.64, notched: Bool = true) -> some View {
        modifier(TravelContainer(axis: axis, fraction: fraction, notched: notched))
    }

    /// Verlauf der Inhalte im akzentuierten Modus: markierte Elemente erhalten die Akzentfarbe des Systems.
    func accentable(_ on: Bool = true) -> some View { widgetAccentable(on) }
}

// MARK: - Stand der Daten

extension TravelSnapshot {
    /// Hinweis, wenn der Stand aus dem Cache kommt und älter als eine Stunde ist: `Stand 11.10.2026 14:30`.
    var staleText: String? {
        guard isCached else { return nil }
        guard let fetchedAt else { return "Offline" }
        guard Date().timeIntervalSince(fetchedAt) > 3600 else { return nil }
        return "Stand \(SharedFormat.dateTime(fetchedAt))"
    }
}

// MARK: - Leer- und Fehlerzustände

/// «Nicht angemeldet», «Keine Daten», «Keine Reise»: eine Ticket-Fläche je Familie mit Deep-Link auf die App.
struct WidgetStatusView: View {
    enum Kind { case signedOut, unavailable, noTrip, noEvents }

    let kind: Kind
    var header = "TravelBuddy"
    @Environment(\.widgetFamily) private var family

    private var symbol: String {
        switch kind {
        case .signedOut: "person.crop.circle.badge.exclamationmark"
        case .unavailable: "wifi.exclamationmark"
        case .noTrip: "suitcase"
        case .noEvents: "calendar"
        }
    }

    private var title: String {
        switch kind {
        case .signedOut: "Nicht angemeldet"
        case .unavailable: "Keine Daten"
        case .noTrip: "Keine Reise geplant"
        case .noEvents: "Nichts mehr geplant"
        }
    }

    private var detail: String {
        switch kind {
        case .signedOut: "Öffne TravelBuddy und melde dich an."
        case .unavailable: "Der Server ist nicht erreichbar."
        case .noTrip: "Lege in TravelBuddy eine Reise an."
        case .noEvents: "Keine weiteren Ereignisse in dieser Reise."
        }
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: symbol).font(.title3).widgetAccentable()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
        case .accessoryInline:
            Label { Text(title).font(TB.Font.text(13, weight: .semibold, relativeTo: .footnote)) } icon: { Image(systemName: symbol) }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Label { Text(header).font(TB.Font.title(14, weight: .bold, relativeTo: .headline)) } icon: { Image(systemName: symbol) }
                    .widgetAccentable()
                Text(title).font(TB.Font.text(12, weight: .medium, relativeTo: .caption))
                Text(detail).font(TB.Font.text(11, relativeTo: .caption2)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(TB.Palette.accent)
                        .widgetAccentable()
                    TBCaption(header)
                }
                Spacer(minLength: 0)
                Text(title)
                    .font(TB.Font.title(18, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if family != .systemSmall || kind != .noTrip {
                    Text(detail)
                        .font(TB.Font.text(12.5, relativeTo: .footnote))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Kleine Bausteine

/// Zeitangabe eines Ereignisses gross in Mono, darunter Datum, wenn nicht heute.
struct EventTimeText: View {
    let event: SharedSummary.Event
    let day: String
    var size: CGFloat = 28

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(event.timeText ?? "ganztags")
                .font(TB.Font.mono(event.hasTime ? size : size * 0.55, weight: .semibold, relativeTo: .title))
                .foregroundStyle(TB.Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if event.shownDate != day, !event.dateText.isEmpty {
                Text(SharedFormat.weekdayShortDate(event.shownDate))
                    .font(TB.Font.mono(10.5, weight: .medium, relativeTo: .caption2))
                    .foregroundStyle(TB.Palette.mute)
                    .lineLimit(1)
            }
        }
    }
}

/// Eine Zeile der Ereignisliste: Zeit, Typ-Quadrat, Titel (und optional Ort/Referenz darunter).
struct EventRow: View {
    let event: SharedSummary.Event
    var isNext = false
    var showsDetail = false
    var timeWidth: CGFloat = 44

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Group {
                if let time = event.timeText {
                    Text(time)
                        .font(TB.Font.mono(12.5, weight: isNext ? .semibold : .medium, relativeTo: .caption))
                        .foregroundStyle(isNext ? TB.Palette.accent : TB.Palette.ink)
                } else {
                    // Ohne Uhrzeit (mehrtägig, ganztägig): Rolle als Text («Aufenthalt», «Unterwegs»).
                    Text(event.roleLabel ?? "ganztags")
                        .font(TB.Font.title(11.5, weight: .semibold, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .minimumScaleFactor(0.7)
                }
            }
            .lineLimit(1)
            .frame(width: timeWidth, alignment: .leading)
            TBTypeBadge(icon: event.iconName, colorKey: event.colorKey, size: showsDetail ? 24 : 18)
                .accentable()
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(TB.Font.text(showsDetail ? 13.5 : 12.5, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(1)
                if showsDetail, let detail = detailText {
                    Text(detail)
                        .font(TB.Font.text(11, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var detailText: String? {
        var parts: [String] = []
        if event.dayRole == "start" || event.dayRole == "end", let role = event.roleLabel { parts.append(role) }
        if let l = event.location, !l.isEmpty { parts.append(l) }
        if let r = event.bookingReference, !r.isEmpty { parts.append(r) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

extension TravelSnapshot {
    /// Segmente für das Tagesband aus den Ereignissen des Tages.
    func bandSegments(on day: String) -> [TBDayBand.Segment] {
        events(on: day).compactMap { e in
            guard let t = SharedFormat.hm(e.timeText) else { return nil }
            let start = t.h * 60 + t.m
            var end: Int?
            if let et = SharedFormat.hm(e.endTime), e.dayRole == nil || e.dayRole == "single",
               e.endDate == nil || e.endDate == e.startDate {
                let candidate = et.h * 60 + et.m
                if candidate > start { end = candidate }
            }
            return TBDayBand.Segment(startMinute: start, endMinute: end, colorKey: e.colorKey)
        }
    }

    func minuteOfDay(at date: Date) -> Int {
        let c = SharedFormat.calendar(zone).dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}
