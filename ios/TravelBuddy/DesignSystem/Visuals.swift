import SwiftUI

// Infografiken aus Daten, mit SwiftUI-Formen gezeichnet; Farben nur über Tokens.

// MARK: - Countdown

enum CountdownText {
    /// `1:42 Std.` ab einer Stunde, sonst `42 Min.`, unter einer Minute `< 1 Min.`; vergangen: `jetzt`.
    static func short(_ seconds: TimeInterval) -> String {
        if seconds <= 0 { return "jetzt" }
        let minutes = Int((seconds / 60).rounded(.up))
        if minutes >= 24 * 60 {
            let d = minutes / (24 * 60)
            return d == 1 ? "1 Tag" : "\(d) Tage"
        }
        if minutes >= 60 { return String(format: "%d:%02d", minutes / 60, minutes % 60) }
        return "\(max(minutes, 1))"
    }

    static func unit(_ seconds: TimeInterval) -> String {
        if seconds <= 0 { return "" }
        let minutes = Int((seconds / 60).rounded(.up))
        if minutes >= 24 * 60 { return "" }
        return minutes >= 60 ? "Std." : "Min."
    }

    /// Satz für VoiceOver: «in 1 Stunde 42 Minuten».
    static func spoken(_ seconds: TimeInterval) -> String {
        if seconds <= 0 { return "jetzt" }
        let minutes = Int((seconds / 60).rounded(.up))
        if minutes >= 24 * 60 { let d = minutes / 1440; return d == 1 ? "in 1 Tag" : "in \(d) Tagen" }
        if minutes >= 60 {
            let h = minutes / 60, m = minutes % 60
            return m == 0 ? "in \(h) Stunden" : "in \(h) Stunden und \(m) Minuten"
        }
        return "in \(minutes) Minuten"
    }
}

struct CountdownRing: View {
    let remaining: TimeInterval?
    let progress: Double
    var size: CGFloat = 96
    var track: Color = Palette.heroInk.opacity(0.18)
    var tint: Color = Palette.heroAccent
    var textColor: Color = Palette.heroInk

    var body: some View {
        ZStack {
            Circle().stroke(track, lineWidth: size * 0.09)
            Circle()
                .trim(from: 0, to: max(0.02, min(1, progress)))
                .stroke(tint, style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: -2) {
                if let remaining {
                    Text(CountdownText.short(remaining)).font(TB.Font.mono(size * 0.26, weight: .semibold, relativeTo: .title2))
                    let unit = CountdownText.unit(remaining)
                    if !unit.isEmpty {
                        Text(unit).font(TB.Font.title(size * 0.13, weight: .medium, relativeTo: .caption)).textCase(.uppercase)
                    }
                } else {
                    Image(systemName: "checkmark").font(.system(size: size * 0.3, weight: .semibold))
                }
            }
            .foregroundStyle(textColor)
            .minimumScaleFactor(0.6)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(remaining.map { "Als Nächstes \(CountdownText.spoken($0))" } ?? "Nichts mehr geplant")
    }
}

// MARK: - Tagesband

/// Tagesband: ein Tag als Zeitleiste von 00:00 bis 24:00 mit den Ereignissen als Marken und der Position «jetzt».
struct DayBand: View {
    struct Mark: Identifiable {
        let id: String
        let minutes: Int
        let color: String
        let label: String
    }

    let marks: [Mark]
    /// Minuten seit Mitternacht in der Reisezone; `nil`, wenn der Tag nicht heute ist.
    let nowMinutes: Int?
    var from = 6 * 60
    var to = 24 * 60

    var body: some View {
        let lo = min(from, (marks.map(\.minutes).min() ?? from) - 30)
        let hi = max(to, (marks.map(\.minutes).max() ?? to) + 30)
        let span = Double(max(60, hi - lo))
        VStack(spacing: 6) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surface2).frame(height: 6)
                    Capsule().strokeBorder(Palette.line, lineWidth: 1).frame(height: 6)
                    ForEach(marks) { m in
                        Circle()
                            .fill(Palette.type(m.color))
                            .frame(width: 14, height: 14)
                            .overlay(Circle().strokeBorder(Palette.surface, lineWidth: 2))
                            .position(x: w * CGFloat(Double(m.minutes - lo) / span), y: 10)
                    }
                    if let nowMinutes, nowMinutes >= lo, nowMinutes <= hi {
                        Rectangle().fill(Palette.accent).frame(width: 2, height: 20)
                            .position(x: w * CGFloat(Double(nowMinutes - lo) / span), y: 10)
                    }
                }
                .frame(height: 20)
            }
            .frame(height: 20)
            HStack {
                Text(TBDate.timeString(minutes: lo)).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                Spacer()
                Text(hi >= 1440 ? "24:00" : TBDate.timeString(minutes: hi)).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tagesband mit \(marks.count) Einträgen")
    }
}

/// Reisetage als Punkte: vergangene gefüllt, heute akzentuiert, kommende leer.
struct DayDots: View {
    let dayIndex: Int
    let dayCount: Int

    var body: some View {
        let count = min(max(dayCount, 1), 60)
        HStack(spacing: 3) {
            ForEach(1...count, id: \.self) { i in
                Capsule()
                    .fill(i < dayIndex ? Palette.heroInk.opacity(0.85) : (i == dayIndex ? Palette.heroAccent : Palette.heroInk.opacity(0.22)))
                    .frame(height: i == dayIndex ? 8 : 5)
            }
        }
        .frame(height: 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tag \(dayIndex) von \(dayCount)")
    }
}

// MARK: - Avatar

/// Avatar eines Mitreisenden in einer von 8 stabilen Farben (`colorIndex`).
struct TravelerAvatar: View {
    let traveler: Traveler
    var size: CGFloat = 32

    private static let keys = ["ship", "air", "stay", "car", "ticket", "rail", "activity", "food"]

    var body: some View {
        let key = Self.keys[((traveler.colorIndex ?? traveler.id) % 8 + 8) % 8]
        Text(traveler.initials)
            .font(TB.Font.title(size * 0.4, weight: .semibold, relativeTo: .caption))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Palette.type(key), in: Circle())
            .accessibilityLabel(traveler.displayName)
    }
}

/// Saldobalken: positiv nach rechts, negativ nach links, mit Vorzeichen im Text (nie nur Farbe).
struct BalanceBar: View {
    let value: Int
    let maxMagnitude: Int

    var body: some View {
        GeometryReader { geo in
            let half = geo.size.width / 2
            let frac = maxMagnitude > 0 ? CGFloat(abs(value)) / CGFloat(maxMagnitude) : 0
            ZStack {
                Rectangle().fill(Palette.line).frame(width: 1)
                HStack(spacing: 0) {
                    Spacer(minLength: 0).frame(width: value < 0 ? half * (1 - frac) : half)
                    if value != 0 {
                        Rectangle().fill(value > 0 ? Palette.positive : Palette.negative)
                            .frame(width: half * frac, height: 8)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}
