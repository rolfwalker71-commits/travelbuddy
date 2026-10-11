import SwiftUI

/// Beobachtbarer Zustand der erweiterten Mitteilung.
final class TicketModel: ObservableObject {
    @Published var content: TicketContent
    @Published var height: CGFloat = 0

    init(content: TicketContent) { self.content = content }
}

/// Ticket-Darstellung (Richtung B): Kopfband in Typfarbe, Hauptteil mit grosser Zeit, Perforation, Abriss mit Countdown.
struct TicketNotificationView: View {
    @ObservedObject var model: TicketModel
    @State private var split: CGFloat = 0
    @State private var total: CGFloat = 1

    var body: some View {
        let c = model.content
        VStack(spacing: 0) {
            band(c)
            main(c)
            TBPerforation(inset: 14)
                .padding(.vertical, 8)
                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("ticket")).midY } action: { split = $0 }
            stub(c)
        }
        .coordinateSpace(name: "ticket")
        .background {
            TBTicketShape(fraction: total > 1 ? split / total : 0.7, cornerRadius: TB.Metric.cardRadius, notchRadius: 9)
                .fill(TB.Palette.surface)
        }
        .overlay {
            TBTicketShape(fraction: total > 1 ? split / total : 0.7, cornerRadius: TB.Metric.cardRadius, notchRadius: 9)
                .stroke(TB.Palette.line, lineWidth: 1)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { h in
            total = max(1, h)
            model.height = h + 16
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Kopfband

    private func band(_ c: TicketContent) -> some View {
        let tint = TB.Palette.type(c.colorKey)
        return HStack(spacing: 9) {
            TBGlyph(icon: c.icon, size: 17).foregroundStyle(TB.Palette.onAccent)
            Text(c.kicker.uppercased())
                .font(TB.Font.title(13, weight: .bold, relativeTo: .subheadline))
                .tracking(1.0)
                .foregroundStyle(TB.Palette.onAccent)
            if let trip = c.tripTitle, c.kind != TravelNotificationKind.today {
                Text("·").foregroundStyle(TB.Palette.onAccent.opacity(0.7))
                Text(trip.uppercased())
                    .font(TB.Font.title(11, weight: .semibold, relativeTo: .caption))
                    .tracking(0.8)
                    .foregroundStyle(TB.Palette.onAccent.opacity(0.85))
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            if let ref = c.reference, !ref.isEmpty {
                Text(ref)
                    .font(TB.Font.mono(13, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(TB.Palette.onAccent)
                    .lineLimit(1)
            } else if let caption = c.dayCaption {
                Text(caption)
                    .font(TB.Font.mono(12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(TB.Palette.onAccent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                tint
                TBStripes(color: tint, gap: 16).opacity(0.5)
            }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: TB.Metric.cardRadius, topTrailingRadius: TB.Metric.cardRadius))
        }
    }

    // MARK: Hauptteil

    @ViewBuilder private func main(_ c: TicketContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            switch c.kind {
            case TravelNotificationKind.today: today(c)
            case TravelNotificationKind.review: review(c)
            default: eventMain(c)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func eventMain(_ c: TicketContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if let time = c.timeText {
                    Text(time)
                        .font(TB.Font.mono(44, weight: .semibold, relativeTo: .largeTitle))
                        .foregroundStyle(TB.Palette.ink)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
                VStack(alignment: .leading, spacing: 1) {
                    if let date = c.dateText {
                        Text(date)
                            .font(TB.Font.mono(13, weight: .medium, relativeTo: .footnote))
                            .foregroundStyle(TB.Palette.ink)
                    }
                    if let note = c.zoneNote {
                        Text(note).font(TB.Font.text(11.5, relativeTo: .caption2)).foregroundStyle(TB.Palette.mute)
                    }
                }
                Spacer(minLength: 0)
            }
            if let from = c.from, let to = c.to {
                HStack(spacing: 10) {
                    Text(from).font(TB.Font.mono(20, weight: .semibold, relativeTo: .title3))
                    ZStack {
                        TBPerforation(color: TB.Palette.mute, inset: 0)
                        TBGlyph(icon: c.icon, size: 14)
                            .foregroundStyle(TB.Palette.type(c.colorKey))
                            .padding(.horizontal, 4)
                            .background(TB.Palette.surface)
                    }
                    Text(to).font(TB.Font.mono(20, weight: .semibold, relativeTo: .title3))
                }
                .foregroundStyle(TB.Palette.ink)
            }
            Text(c.title)
                .font(TB.Font.title(18, weight: .bold, relativeTo: .headline))
                .foregroundStyle(TB.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let place = c.subtitle, !place.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TB.Palette.mute)
                        .padding(.top, 2)
                    Text(place)
                        .font(TB.Font.text(14, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.mute)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !c.facts.isEmpty { factGrid(c.facts) }
            if !c.hasStructure, !c.body.isEmpty {
                Text(c.body).font(TB.Font.text(14, relativeTo: .body)).foregroundStyle(TB.Palette.ink)
            }
        }
    }

    private func factGrid(_ facts: [SharedSummary.KeyValue]) -> some View {
        let columns = [GridItem(.adaptive(minimum: 92), spacing: 8, alignment: .leading)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(facts.prefix(6), id: \.self) { f in
                VStack(alignment: .leading, spacing: 1) {
                    TBCaption(f.label, size: 9.5)
                    Text(f.value)
                        .font(TB.Font.mono(14, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TB.Palette.surface2, in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous))
            }
        }
    }

    // MARK: Tagesliste

    private func today(_ c: TicketContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(c.dateText ?? c.title)
                    .font(TB.Font.title(21, weight: .bold, relativeTo: .title3))
                    .foregroundStyle(TB.Palette.ink)
                if !c.title.isEmpty, c.dateText != nil {
                    Text(c.title).font(TB.Font.text(14, relativeTo: .subheadline)).foregroundStyle(TB.Palette.mute)
                }
            }
            if !c.segments.isEmpty {
                TBDayBand(segments: c.segments, nowMinute: nil, height: 9)
            }
            if c.rows.isEmpty {
                Text(c.body.isEmpty ? "Heute ist nichts geplant." : c.body)
                    .font(TB.Font.text(14, relativeTo: .body)).foregroundStyle(TB.Palette.mute)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(c.rows.prefix(5).enumerated()), id: \.offset) { _, r in
                        HStack(spacing: 9) {
                            let isTime = SharedFormat.hm(r.time) != nil
                            Text(r.time ?? "ganztags")
                                .font(isTime
                                      ? TB.Font.mono(14, weight: r.isNext ? .semibold : .medium, relativeTo: .subheadline)
                                      : TB.Font.title(11, weight: .semibold, relativeTo: .caption))
                                .foregroundStyle(r.isNext ? TB.Palette.accent : (isTime ? TB.Palette.ink : TB.Palette.mute))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .frame(width: 52, alignment: .leading)
                            TBTypeBadge(icon: r.icon, colorKey: r.color, size: 22)
                            Text(r.title)
                                .font(TB.Font.text(14.5, weight: .semibold, relativeTo: .subheadline))
                                .foregroundStyle(TB.Palette.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                    if c.rows.count > 5 {
                        Text("+ \(c.rows.count - 5) weitere")
                            .font(TB.Font.text(12, relativeTo: .caption)).foregroundStyle(TB.Palette.mute)
                    }
                }
            }
        }
    }

    private func review(_ c: TicketContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let n = c.count {
                    Text("\(n)")
                        .font(TB.Font.mono(44, weight: .semibold, relativeTo: .largeTitle))
                        .foregroundStyle(TB.Palette.ink)
                }
                Text(c.count == 1 ? "Vorschlag zu prüfen" : "Vorschläge zu prüfen")
                    .font(TB.Font.title(18, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(TB.Palette.ink)
            }
            if c.rows.isEmpty, !c.body.isEmpty {
                Text(c.body).font(TB.Font.text(14, relativeTo: .body)).foregroundStyle(TB.Palette.mute)
            }
            ForEach(Array(c.rows.prefix(4).enumerated()), id: \.offset) { _, r in
                HStack(spacing: 9) {
                    TBTypeBadge(icon: r.icon, colorKey: r.color, size: 22)
                    Text(r.title).font(TB.Font.text(14.5, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.ink).lineLimit(1)
                    Spacer(minLength: 0)
                    TBStatusChip(kind: .proposal)
                }
            }
        }
    }

    // MARK: Abriss

    private func stub(_ c: TicketContent) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                if let target = c.startAt, c.kind != TravelNotificationKind.review {
                    TBCaption(c.countdownLabel, size: 10)
                    Group {
                        if target > Date() {
                            TBCountdown(target: target, from: Date())
                        } else {
                            Text("Jetzt")
                        }
                    }
                    .font(TB.Font.mono(24, weight: .semibold, relativeTo: .title2))
                    .foregroundStyle(TB.Palette.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                } else if let tripTitle = c.tripTitle {
                    TBCaption("Reise", size: 10)
                    Text(tripTitle).font(TB.Font.title(16, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(TB.Palette.ink).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let ref = c.reference, !ref.isEmpty {
                TBBarcode(seed: ref).frame(width: 96, height: 30).opacity(0.85)
            } else {
                HStack(spacing: 5) {
                    Text("Öffnen")
                        .font(TB.Font.title(13, weight: .semibold, relativeTo: .footnote))
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                }
                .foregroundStyle(TB.Palette.mute)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Vorschauen

#Preview("Abflug") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.depart)))
        .frame(width: 390).background(TB.Palette.bg)
}

#Preview("Heute") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.today)))
        .frame(width: 390).background(TB.Palette.bg)
}

#Preview("Unterkunft") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.stay)))
        .frame(width: 390).background(TB.Palette.bg)
}

#Preview("Mietwagen") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.pickup)))
        .frame(width: 390).background(TB.Palette.bg)
}

#Preview("Frist") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.deadline)))
        .frame(width: 390).background(TB.Palette.bg)
}

#Preview("Prüfen") {
    TicketNotificationView(model: TicketModel(content: .sample(kind: TravelNotificationKind.review)))
        .frame(width: 390).background(TB.Palette.bg)
}
