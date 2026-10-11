import SwiftUI

// Bausteine der Richtung B «Ticket» für Widgets, Live Activity, Mitteilungen und Teilen-Blatt.
// Alles zeichnet sich aus Daten (Shapes), Farben nur über `TB.Palette`, Schrift nur über `TB.Font`.

// MARK: - Typ-Symbolik

/// Katalog-Icon → SF Symbol; wo SF fehlt (Pass/Visum, Transfer), zeichnet `TBGlyph` ein eigenes Mini-Symbol.
enum TBIconMap {
    static func symbol(for icon: String) -> String? {
        switch icon {
        case "plane": "airplane"
        case "train": "tram.fill"
        case "car": "car.fill"
        case "bed": "bed.double.fill"
        case "ship": "ferry.fill"
        case "map": "map.fill"
        case "fork": "fork.knife"
        case "ticket": "ticket.fill"
        case "shield": "checkmark.shield.fill"
        case "task": "checkmark.circle"
        case "doc": "doc.text.fill"
        case "people": "person.2.fill"
        case "pin": "mappin.and.ellipse"
        case "check": "checkmark"
        case "bell": "bell.fill"
        case "wallet": "creditcard.fill"
        case "passport", "transfer": nil
        default: "mappin.circle.fill"
        }
    }
}

/// Eigenes Mini-Symbol «Pass»: Heft, Lochkreis, Zeile.
struct TBPassportShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width, h = rect.height
        p.addRoundedRect(in: CGRect(x: rect.minX + w * 0.2, y: rect.minY + h * 0.1, width: w * 0.6, height: h * 0.8),
                         cornerSize: CGSize(width: w * 0.1, height: w * 0.1), style: .continuous)
        p.addEllipse(in: CGRect(x: rect.minX + w * 0.5 - w * 0.12, y: rect.minY + h * 0.3, width: w * 0.24, height: w * 0.24))
        p.move(to: CGPoint(x: rect.minX + w * 0.36, y: rect.minY + h * 0.72))
        p.addLine(to: CGPoint(x: rect.minX + w * 0.64, y: rect.minY + h * 0.72))
        return p
    }
}

/// Eigenes Mini-Symbol «Transfer»: Startpunkt, Bogen, Pfeilspitze.
struct TBTransferShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width, h = rect.height
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + w * x, y: rect.minY + h * y) }
        p.addEllipse(in: CGRect(x: rect.minX + w * 0.1, y: rect.minY + h * 0.62, width: w * 0.2, height: w * 0.2))
        p.move(to: pt(0.2, 0.62))
        p.addCurve(to: pt(0.82, 0.3), control1: pt(0.2, 0.25), control2: pt(0.55, 0.3))
        p.move(to: pt(0.66, 0.16)); p.addLine(to: pt(0.84, 0.3)); p.addLine(to: pt(0.66, 0.46))
        return p
    }
}

struct TBGlyph: View {
    let icon: String
    var size: CGFloat = 16
    var weight: Font.Weight = .semibold

    var body: some View {
        Group {
            switch icon {
            case "passport": custom(TBPassportShape())
            case "transfer": custom(TBTransferShape())
            default:
                Image(systemName: TBIconMap.symbol(for: icon) ?? "mappin.circle.fill")
                    .font(.system(size: size, weight: weight))
                    .symbolRenderingMode(.monochrome)
            }
        }
        .frame(width: size * 1.2, height: size * 1.2)
        .accessibilityHidden(true)
    }

    private func custom<S: Shape>(_ shape: S) -> some View {
        shape.stroke(style: StrokeStyle(lineWidth: max(1.2, size * 0.1), lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

/// Quadrat in Typfarbe mit weissem Symbol (Ticket-Kopf, Liste, Insel).
struct TBTypeBadge: View {
    let icon: String
    let colorKey: String
    var size: CGFloat = 32

    var body: some View {
        RoundedRectangle(cornerRadius: max(5, size * 0.22), style: .continuous)
            .fill(TB.Palette.type(colorKey))
            .frame(width: size, height: size)
            .overlay { TBGlyph(icon: icon, size: size * 0.5).foregroundStyle(TB.Palette.onAccent) }
            .accessibilityHidden(true)
    }
}

// MARK: - Text

/// GROSSBUCHSTABEN-Label mit 0,08 em Spationierung (Barlow Semi Condensed).
struct TBCaption: View {
    let text: String
    var size: CGFloat = 10.5
    var color: Color = TB.Palette.mute

    init(_ text: String, size: CGFloat = 10.5, color: Color = TB.Palette.mute) {
        self.text = text; self.size = size; self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(TB.Font.title(size, weight: .semibold, relativeTo: .caption2))
            .tracking(size * 0.08)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// «Vorschlag» (gestrichelter Rand) bzw. «Zu prüfen» (Warnrand).
struct TBStatusChip: View {
    enum Kind { case proposal, review }
    let kind: Kind

    var body: some View {
        let color = kind == .review ? TB.Palette.negative : TB.Palette.mute
        Text(kind == .review ? "ZU PRÜFEN" : "VORSCHLAG")
            .font(TB.Font.title(9, weight: .bold, relativeTo: .caption2))
            .tracking(0.7)
            .foregroundStyle(color)
            .padding(.horizontal, 5).padding(.vertical, 2)
            .overlay {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(color, style: StrokeStyle(lineWidth: 1, dash: kind == .proposal ? [3, 2] : []))
            }
    }
}

// MARK: - Countdown

/// Restzeit bis `target` ab `from`: ab einem Tag statisch («in 3 Tagen»), darunter laufend (`Text(timerInterval:)`).
struct TBCountdown: View {
    let target: Date
    let from: Date
    var pastText = "Jetzt"
    /// `false`: ohne «in» vor Tagesangaben (wenn eine Beschriftung «In» bereits davorsteht).
    var prefixed = true

    var body: some View {
        if target <= from {
            Text(pastText)
        } else if let long = prefixed ? SharedFormat.longCountdown(from: from, to: target)
                    : SharedFormat.longCountdownValue(from: from, to: target) {
            Text(long)
        } else {
            Text(timerInterval: from...target, pauseTime: target, countsDown: true, showsHours: true)
                .monospacedDigit()
        }
    }
}

// MARK: - Ticket-Form

/// Ticket-Rechteck mit halbrunden Kerben auf Höhe (`.horizontal`: links und rechts) bzw. Breite (`.vertical`: oben und
/// unten) `fraction` der Perforation.
struct TBTicketShape: Shape {
    var fraction: CGFloat = 0.64
    var axis: Axis = .horizontal
    var cornerRadius: CGFloat = TB.Metric.cardRadius
    var notchRadius: CGFloat = 8

    func path(in rect: CGRect) -> Path {
        let card = Path(roundedRect: rect, cornerRadius: cornerRadius, style: .continuous)
        let r = notchRadius
        if axis == .horizontal {
            let y = rect.minY + rect.height * fraction
            let left = Path(ellipseIn: CGRect(x: rect.minX - r, y: y - r, width: r * 2, height: r * 2))
            let right = Path(ellipseIn: CGRect(x: rect.maxX - r, y: y - r, width: r * 2, height: r * 2))
            return card.subtracting(left).subtracting(right)
        }
        let x = rect.minX + rect.width * fraction
        let top = Path(ellipseIn: CGRect(x: x - r, y: rect.minY - r, width: r * 2, height: r * 2))
        let bottom = Path(ellipseIn: CGRect(x: x - r, y: rect.maxY - r, width: r * 2, height: r * 2))
        return card.subtracting(top).subtracting(bottom)
    }
}

/// Diagonal gestreifte Fläche («Cover» der Reise): Grundfarbe mit dunkleren Streifen.
struct TBStripes: View {
    var color: Color = TB.Palette.accent
    var gap: CGFloat = 14

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color))
            var x = -size.height
            while x < size.width + size.height {
                var p = Path()
                p.move(to: CGPoint(x: x, y: size.height))
                p.addLine(to: CGPoint(x: x + gap / 2, y: size.height))
                p.addLine(to: CGPoint(x: x + gap / 2 + size.height, y: 0))
                p.addLine(to: CGPoint(x: x + size.height, y: 0))
                p.closeSubpath()
                context.fill(p, with: .color(.black.opacity(0.10)))
                x += gap
            }
        }
        .accessibilityHidden(true)
    }
}

/// Dekorativer Strichcode, deterministisch aus `seed` (Buchungsreferenz).
struct TBBarcode: View {
    var seed: String
    var color: Color = TB.Palette.ink

    var body: some View {
        Canvas { context, size in
            var state: UInt64 = 5381
            for b in seed.utf8 { state = (state &* 33) &+ UInt64(b) }
            var x: CGFloat = 0
            while x < size.width {
                state = state &* 6364136223846793005 &+ 1442695040888963407
                let w = CGFloat((state >> 33) % 3 + 1)
                let gapW = CGFloat((state >> 40) % 3 + 1)
                context.fill(Path(CGRect(x: x, y: 0, width: min(w, size.width - x), height: size.height)), with: .color(color))
                x += w + gapW
            }
        }
        .accessibilityHidden(true)
    }
}

/// Gestrichelte Perforationslinie (volle Breite des Containers).
struct TBPerforation: View {
    var color: Color = TB.Palette.line
    var inset: CGFloat = 12

    var body: some View {
        GeometryReader { g in
            Path { p in
                p.move(to: CGPoint(x: inset, y: g.size.height / 2))
                p.addLine(to: CGPoint(x: g.size.width - inset, y: g.size.height / 2))
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

// MARK: - Infografiken

/// Fortschrittsbalken: Spur in `line`, Füllung in Typfarbe, optional Marke.
struct TBProgressBar: View {
    var progress: Double
    var tint: Color
    var track: Color = TB.Palette.line
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { g in
            let p = min(1, max(0, progress))
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(tint).frame(width: max(height, g.size.width * p))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel("Fortschritt")
        .accessibilityValue("\(Int((min(1, max(0, progress)) * 100).rounded())) Prozent")
    }
}

/// Mini-Routenbogen: Stationen als Punkte auf einem Bogen, bereits zurückgelegter Teil in Akzent, Marke «heute».
struct TBRouteArc: View {
    var stops: Int
    var progress: Double?
    var tint: Color = TB.Palette.accent
    var base: Color = TB.Palette.line
    var ink: Color = TB.Palette.ink

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let a = CGPoint(x: w * 0.04, y: h * 0.86)
            let c = CGPoint(x: w * 0.5, y: -h * 0.42)
            let b = CGPoint(x: w * 0.96, y: h * 0.86)
            let n = max(2, min(stops, 7))
            let curve = Path { p in p.move(to: a); p.addQuadCurve(to: b, control: c) }
            ZStack {
                curve.stroke(base, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 4]))
                if let progress {
                    curve.trim(from: 0, to: min(1, max(0, progress)))
                        .stroke(tint, style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
                }
                ForEach(0..<n, id: \.self) { i in
                    let t = CGFloat(i) / CGFloat(n - 1)
                    let pt = Self.point(t, a, c, b)
                    let ends = i == 0 || i == n - 1
                    Circle()
                        .fill(TB.Palette.surface)
                        .overlay(Circle().stroke(ink, lineWidth: 1.4))
                        .frame(width: ends ? 8 : 5, height: ends ? 8 : 5)
                        .position(pt)
                }
                if let progress {
                    let pt = Self.point(CGFloat(min(1, max(0, progress))), a, c, b)
                    Circle().fill(tint).frame(width: 9, height: 9)
                        .overlay(Circle().stroke(TB.Palette.surface, lineWidth: 1.5))
                        .position(pt)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private static func point(_ t: CGFloat, _ a: CGPoint, _ c: CGPoint, _ b: CGPoint) -> CGPoint {
        let u = 1 - t
        return CGPoint(x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
                       y: u * u * a.y + 2 * u * t * c.y + t * t * b.y)
    }
}

/// Tagesband: Tagesspanne (Standard 06:00–24:00) mit farbigen Segmenten je Ereignis und Marke «jetzt».
struct TBDayBand: View {
    struct Segment: Hashable {
        var startMinute: Int
        var endMinute: Int?
        var colorKey: String
    }

    var segments: [Segment]
    var nowMinute: Int?
    var from: Int = 6 * 60
    var to: Int = 24 * 60
    var showsLabels = true
    var height: CGFloat = 10

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { g in
                let span = CGFloat(max(1, to - from))
                let x: (Int) -> CGFloat = { minute in g.size.width * CGFloat(min(max(minute, from), to) - from) / span }
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3, style: .continuous).fill(TB.Palette.line.opacity(0.7))
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, s in
                        let x0 = x(s.startMinute)
                        let x1 = max(x0 + 6, s.endMinute.map { x($0) } ?? x0 + 6)
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(TB.Palette.type(s.colorKey))
                            .frame(width: min(x1 - x0, g.size.width - x0), height: height)
                            .offset(x: x0)
                    }
                    if let nowMinute, nowMinute >= from, nowMinute <= to {
                        Rectangle().fill(TB.Palette.accent)
                            .frame(width: 2, height: height + 6)
                            .offset(x: x(nowMinute) - 1)
                    }
                }
                .frame(height: height)
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: height + 6)
            if showsLabels {
                let labels = Self.hourLabels(from: from, to: to)
                HStack(spacing: 0) {
                    ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                        Text(label).font(TB.Font.mono(8.5, weight: .medium, relativeTo: .caption2))
                            .foregroundStyle(TB.Palette.mute)
                        if index < labels.count - 1 { Spacer(minLength: 0) }
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }

    private static func hourLabels(from: Int, to: Int) -> [String] {
        var marks: [Int] = [from]
        var h = (from / 60 / 6 + 1) * 6
        while h * 60 < to { marks.append(h * 60); h += 6 }
        marks.append(to)
        return marks.map { String(format: "%02d:00", $0 / 60) }
    }
}

/// Saldobalken um eine Mittelachse (Plus rechts, Minus links), Farben mit Vorzeichen und Text, nie allein.
struct TBBalanceBars: View {
    struct Row: Hashable, Identifiable {
        var id: Int
        var name: String
        var netMinor: Int
        var isMe: Bool
    }

    var rows: [Row]
    var currency: String

    var body: some View {
        let maxValue = max(1, rows.map { abs($0.netMinor) }.max() ?? 1)
        VStack(spacing: 5) {
            ForEach(rows) { row in
                HStack(spacing: 6) {
                    Text(row.name)
                        .font(TB.Font.text(11, weight: row.isMe ? .semibold : .regular, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(1)
                        .frame(width: 58, alignment: .leading)
                    GeometryReader { g in
                        let half = g.size.width / 2
                        let len = max(2, half * CGFloat(abs(row.netMinor)) / CGFloat(maxValue))
                        ZStack {
                            Rectangle().fill(TB.Palette.line).frame(width: 1)
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(row.netMinor >= 0 ? TB.Palette.positive : TB.Palette.negative)
                                .frame(width: len, height: 8)
                                .offset(x: row.netMinor >= 0 ? len / 2 : -len / 2)
                        }
                        .frame(width: g.size.width, height: g.size.height)
                    }
                    .frame(height: 12)
                    Text(SharedFormat.money(minor: row.netMinor, currency: nil, decimals: false, showPlus: true))
                        .font(TB.Font.mono(10.5, weight: .semibold, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(width: 52, alignment: .trailing)
                }
            }
        }
    }
}
