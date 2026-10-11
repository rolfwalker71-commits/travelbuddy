import ActivityKit
import SwiftUI
import WidgetKit

// Live Activity «Reise» (Richtung B «Ticket» auf dunkler Hero-Fläche): Sperrbildschirm-Banner und Dynamic Island für
// `day`, `flight`, `checkin`; Phasen `checkIn`, `boarding`, `underway`, `arrived`, `atStay` mit eigener Darstellung.
// Vertrag: ios/Shared/TravelActivityAttributes.swift. Start, Update und Ende liegen in der App.

private typealias Attributes = TravelActivityAttributes
private typealias State = TravelActivityAttributes.ContentState

// MARK: - Hilfen

private enum Hero {
    static let ink = TB.Palette.heroInk
    static let soft = TB.Palette.heroInk.opacity(0.66)
    static let faint = TB.Palette.heroInk.opacity(0.18)
    static let accent = TB.Palette.heroAccent
    static let surface = TB.Palette.hero
}

private extension State {
    var typeColor: Color { TB.Palette.type(colorKey) }

    func label(kind: Attributes.Kind) -> String {
        switch stage {
        case .checkIn: "Check-in"
        case .boarding: "Boarding"
        case .underway: "Unterwegs"
        case .arrived: "Angekommen"
        case .atStay: "Vor Ort"
        case .upcoming: "Demnächst"
        case .generic:
            switch kind {
            case .day: "Heute"
            case .flight: "Flug"
            case .checkin: "Check-in"
            }
        }
    }

    var hasActiveMilestone: Bool {
        guard let d = milestoneDate else { return false }
        return d > Date()
    }
}

/// Meilenstein als laufender Countdown (ab einem Tag statisch). Ohne Meilenstein nichts.
private struct MilestoneTime: View {
    let state: State
    var size: CGFloat = 22
    var color: Color = Hero.accent

    var body: some View {
        if let target = state.milestoneDate {
            Group {
                if target > Date() {
                    if let long = SharedFormat.longCountdown(from: Date(), to: target) {
                        Text(long)
                    } else {
                        Text(timerInterval: Date.now...target, pauseTime: target, countsDown: true, showsHours: true)
                            .monospacedDigit()
                    }
                } else {
                    Text(SharedFormat.time(target))
                }
            }
            .font(TB.Font.mono(size, weight: .semibold, relativeTo: .title2))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
        }
    }
}

/// Spur mit Marke: Start- und Zielpunkt, zurückgelegter Teil, Symbol des Verkehrsmittels an der Stelle.
private struct TravelTrack: View {
    let icon: String
    let progress: Double
    let tint: Color

    var body: some View {
        GeometryReader { g in
            let p = min(1, max(0, progress))
            let x = 8 + (g.size.width - 16) * p
            ZStack(alignment: .leading) {
                Path { path in
                    path.move(to: CGPoint(x: 8, y: g.size.height / 2))
                    path.addLine(to: CGPoint(x: g.size.width - 8, y: g.size.height / 2))
                }
                .stroke(Hero.faint, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [2, 5]))
                Path { path in
                    path.move(to: CGPoint(x: 8, y: g.size.height / 2))
                    path.addLine(to: CGPoint(x: x, y: g.size.height / 2))
                }
                .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                Circle().stroke(Hero.ink, lineWidth: 1.6).background(Circle().fill(Hero.surface))
                    .frame(width: 8, height: 8).position(x: 4, y: g.size.height / 2)
                Circle().stroke(Hero.ink, lineWidth: 1.6).background(Circle().fill(Hero.surface))
                    .frame(width: 8, height: 8).position(x: g.size.width - 4, y: g.size.height / 2)
                TBGlyph(icon: icon, size: 15)
                    .foregroundStyle(Hero.surface)
                    .padding(4)
                    .background(Circle().fill(tint))
                    .position(x: x, y: g.size.height / 2)
            }
        }
        .frame(height: 26)
        .accessibilityHidden(true)
    }
}

// MARK: - Sperrbildschirm

struct TravelActivityBanner: View {
    let attributes: TravelActivityAttributes
    let state: TravelActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            progress
            if state.nextHeadline != nil {
                TBPerforation(color: Hero.faint, inset: 0)
                upNext
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .environment(\.colorScheme, .dark)
        .widgetURL(URL(string: attributes.deepLink))
    }

    // Kopf: Typ-Quadrat, Phase, Überschrift, Detail, Meilenstein rechts

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                TBTypeBadge(icon: state.icon, colorKey: state.colorKey, size: 42)
                if state.stage == .arrived {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(TB.Palette.positive, Hero.surface)
                        .offset(x: 5, y: 5)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if state.stage == .boarding {
                        Text("BOARDING")
                            .font(TB.Font.title(11, weight: .bold, relativeTo: .caption2))
                            .tracking(0.9)
                            .foregroundStyle(Hero.surface)
                            .lineLimit(1)
                            .fixedSize()
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Hero.accent, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    } else {
                        TBCaption(state.label(kind: attributes.kind), size: 11, color: Hero.accent)
                    }
                    TBCaption(attributes.tripTitle, size: 11, color: Hero.soft)
                }
                Text(state.headline)
                    .font(TB.Font.title(19, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Hero.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if let detail = state.detail, !detail.isEmpty {
                    Text(detail)
                        .font(TB.Font.mono(12, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(Hero.soft)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
            }
            Spacer(minLength: 6)
            if state.milestoneDate != nil {
                VStack(alignment: .trailing, spacing: 2) {
                    if let l = state.milestoneLabel { TBCaption(l, size: 10.5, color: Hero.soft) }
                    MilestoneTime(state: state, size: state.stage == .boarding ? 26 : 22)
                        .frame(maxWidth: 112, alignment: .trailing)
                }
            }
        }
    }

    @ViewBuilder private var progress: some View {
        if let p = state.progress {
            switch state.stage {
            case .underway:
                TravelTrack(icon: state.icon, progress: p, tint: state.typeColor)
            case .arrived:
                TBProgressBar(progress: 1, tint: TB.Palette.positive, track: Hero.faint, height: 5)
            default:
                TBProgressBar(progress: p, tint: state.stage == .boarding ? Hero.accent : state.typeColor,
                              track: Hero.faint, height: 5)
            }
        }
    }

    private var upNext: some View {
        HStack(spacing: 8) {
            TBCaption("Danach", size: 10.5, color: Hero.soft)
            Text(state.nextHeadline ?? "")
                .font(TB.Font.text(13, weight: .semibold, relativeTo: .footnote))
                .foregroundStyle(Hero.ink)
                .lineLimit(1)
            Spacer(minLength: 6)
            if let next = state.nextDate {
                Text(SharedFormat.time(next))
                    .font(TB.Font.mono(13, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(Hero.ink)
            }
        }
    }
}

// MARK: - Widget (Banner + Dynamic Island)

struct TravelLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TravelActivityAttributes.self) { context in
            TravelActivityBanner(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Hero.surface)
                .activitySystemActionForegroundColor(Hero.ink)
        } dynamicIsland: { context in
            let state = context.state
            let tint = state.typeColor
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        TBTypeBadge(icon: state.icon, colorKey: state.colorKey, size: 34)
                    }
                    .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        if let l = state.milestoneLabel, state.milestoneDate != nil {
                            TBCaption(l, size: 10, color: Hero.soft)
                        } else {
                            TBCaption(state.label(kind: context.attributes.kind), size: 10, color: Hero.soft)
                        }
                        MilestoneTime(state: state, size: 20)
                            .frame(maxWidth: 104, alignment: .trailing)
                        if state.milestoneDate == nil, state.stage == .arrived {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(TB.Palette.positive)
                        }
                    }
                    .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(state.headline)
                            .font(TB.Font.title(16, weight: .bold, relativeTo: .headline))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                        if let detail = state.detail, !detail.isEmpty {
                            Text(detail)
                                .font(TB.Font.mono(11, weight: .medium, relativeTo: .caption2))
                                .foregroundStyle(Hero.soft)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        if let p = state.progress {
                            if state.stage == .underway {
                                TravelTrack(icon: state.icon, progress: p, tint: tint)
                            } else {
                                TBProgressBar(progress: p, tint: state.stage == .boarding ? Hero.accent : tint,
                                              track: Hero.faint, height: 5)
                            }
                        }
                        if let next = state.nextHeadline {
                            HStack(spacing: 8) {
                                TBCaption("Danach", size: 10, color: Hero.soft)
                                Text(next)
                                    .font(TB.Font.text(12.5, weight: .semibold, relativeTo: .footnote))
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                if let d = state.nextDate {
                                    Text(SharedFormat.time(d))
                                        .font(TB.Font.mono(12.5, weight: .semibold, relativeTo: .footnote))
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 2)
                }
            } compactLeading: {
                TBGlyph(icon: state.icon, size: 14)
                    .foregroundStyle(tint)
                    .padding(.leading, 2)
            } compactTrailing: {
                Group {
                    if state.hasActiveMilestone {
                        MilestoneTime(state: state, size: 13, color: Hero.accent)
                            .frame(maxWidth: 52)
                    } else if state.stage == .arrived {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(TB.Palette.positive)
                    } else {
                        Text(state.label(kind: context.attributes.kind).prefix(3).uppercased())
                            .font(TB.Font.title(11, weight: .bold, relativeTo: .caption2))
                    }
                }
            } minimal: {
                TBGlyph(icon: state.icon, size: 13).foregroundStyle(tint)
            }
            .keylineTint(tint)
            .widgetURL(URL(string: context.attributes.deepLink))
        }
    }
}

// MARK: - Vorschauen

#Preview("Banner", as: .content, using: TravelActivityPreviewData.attributes(.flight)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.flightCheckIn()
    TravelActivityPreviewData.flightBoarding()
    TravelActivityPreviewData.flightUnderway()
    TravelActivityPreviewData.flightArrived()
}

#Preview("Banner Unterkunft", as: .content, using: TravelActivityPreviewData.attributes(.checkin)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.atStay()
    TravelActivityPreviewData.checkinSoon()
}

#Preview("Banner Tag", as: .content, using: TravelActivityPreviewData.attributes(.day)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.dayGeneric()
}

#Preview("Insel erweitert", as: .dynamicIsland(.expanded), using: TravelActivityPreviewData.attributes(.flight)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.flightCheckIn()
    TravelActivityPreviewData.flightBoarding()
    TravelActivityPreviewData.flightUnderway()
    TravelActivityPreviewData.flightArrived()
}

#Preview("Insel kompakt", as: .dynamicIsland(.compact), using: TravelActivityPreviewData.attributes(.flight)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.flightBoarding()
    TravelActivityPreviewData.flightArrived()
}

#Preview("Insel minimal", as: .dynamicIsland(.minimal), using: TravelActivityPreviewData.attributes(.checkin)) {
    TravelLiveActivity()
} contentStates: {
    TravelActivityPreviewData.atStay()
}
