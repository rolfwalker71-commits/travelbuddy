import SwiftUI

// Bausteine der Richtung B «Ticket» (docs/DESIGN.md). Farben und Schriften nur über `TB.*`.
// Liquid Glass gibt es hier nicht: das übernehmen die System-Leisten (TabView, Toolbar).

typealias Palette = TB.Palette

extension View {
    /// Papier-Hintergrund für ganze Bildschirme.
    func tbScreen() -> some View {
        background(Palette.bg.ignoresSafeArea())
    }

    /// Schrift Barlow mit Dynamic Type.
    func tbText(_ size: CGFloat = 16, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body,
                color: Color = Palette.ink) -> some View {
        font(TB.Font.text(size, weight: weight, relativeTo: style)).foregroundStyle(color)
    }

    /// Titelschrift Barlow Semi Condensed.
    func tbTitle(_ size: CGFloat = 22, weight: Font.Weight = .semibold, relativeTo style: Font.TextStyle = .title2,
                 color: Color = Palette.ink) -> some View {
        font(TB.Font.title(size, weight: weight, relativeTo: style)).foregroundStyle(color)
    }

    /// Mono für Zeiten, Codes, Beträge (tabellarische Ziffern sind in Plex Mono ohnehin gegeben).
    func tbMono(_ size: CGFloat = 16, weight: Font.Weight = .medium, relativeTo style: Font.TextStyle = .body,
                color: Color = Palette.ink) -> some View {
        font(TB.Font.mono(size, weight: weight, relativeTo: style)).foregroundStyle(color)
    }

    /// Mindestgrösse für Zeilen mit Bedienelementen (44 pt Touch-Ziel).
    func touchTarget() -> some View { frame(minHeight: 44) }

    func decimalInput() -> some View { keyboardType(.decimalPad) }
}

// MARK: - Label

/// GROSSBUCHSTABEN-Label mit 0,08 em Spationierung.
struct TBLabel: View {
    let text: String
    var color: Color = Palette.mute
    var size: CGFloat = 12

    init(_ text: String, color: Color = Palette.mute, size: CGFloat = 12) {
        self.text = text; self.color = color; self.size = size
    }

    var body: some View {
        Text(text)
            .textCase(.uppercase)
            .font(TB.Font.title(size, weight: .semibold, relativeTo: .caption))
            .tracking(size * 0.08)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Abschnittskopf in Listen.
struct SectionHeader: View {
    let title: String
    var trailing: String?
    init(_ title: String, trailing: String? = nil) { self.title = title; self.trailing = trailing }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            TBLabel(title)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
            }
        }
        .padding(.top, 6)
    }
}

// MARK: - Typ-Symbol

/// Typ-Symbol: Quadrat in Typfarbe mit weissem Symbol.
struct TypeBadge: View {
    let icon: String
    let color: String
    @ScaledMetric private var size: CGFloat

    init(icon: String, color: String, size: CGFloat = 36) {
        self.icon = icon; self.color = color
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    var body: some View {
        Image(systemName: TypeIcon.symbol(icon))
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Palette.type(color), in: RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Chips

/// «Vorschlag» (gestrichelter Rand) und «Zu prüfen» (Warnrand), nie nur Farbe.
struct StatusChip: View {
    let status: EventStatus

    var body: some View {
        if status.isProposal {
            let warn = status == .needsReview
            HStack(spacing: 4) {
                Image(systemName: warn ? "exclamationmark.circle" : "sparkles").imageScale(.small)
                Text(status.title)
            }
            .tbText(12, weight: .semibold, relativeTo: .caption, color: warn ? Palette.negative : Palette.ink)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(
                RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous)
                    .strokeBorder(warn ? Palette.negative : Palette.mute,
                                  style: StrokeStyle(lineWidth: 1, dash: warn ? [] : [3, 2]))
            )
            .accessibilityElement(children: .combine)
        }
    }
}

struct TBChip: View {
    let text: String
    var symbol: String?
    var tint: Color = Palette.mute

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).imageScale(.small).accessibilityHidden(true) }
            Text(text)
        }
        .tbText(12, weight: .semibold, relativeTo: .caption, color: tint)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Herkunft eines Feldes: gefüllt = aus Dokument, Ring = von Hand.
struct OriginDot: View {
    let meta: FieldMeta?

    var body: some View {
        if let meta {
            ZStack {
                if meta.isFromDocument {
                    Circle().fill(Palette.accent)
                } else {
                    Circle().strokeBorder(Palette.mute, lineWidth: 1.5)
                }
            }
            .frame(width: 9, height: 9)
            .accessibilityLabel(meta.isFromDocument ? "Aus Dokument erkannt" : "Von Hand eingegeben")
        }
    }
}

// MARK: - Schaltflächen

struct TBButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, destructive }
    var kind: Kind = .primary
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        let fg: Color = switch kind {
        case .primary: Palette.onAccent
        case .secondary, .plain: Palette.ink
        case .destructive: Palette.negative
        }
        configuration.label
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .font(TB.Font.title(compact ? 14 : 16, weight: .semibold, relativeTo: .body))
            .foregroundStyle(fg)
            .padding(.horizontal, compact ? 10 : 14)
            .frame(minHeight: compact ? 36 : 44)
            .frame(maxWidth: kind == .plain ? nil : nil)
            .background(
                RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous)
                    .fill(kind == .primary ? Palette.accent : (kind == .plain ? Color.clear : Palette.surface2))
            )
            .overlay(
                RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous)
                    .strokeBorder(kind == .secondary || kind == .destructive ? Palette.line : Color.clear, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == TBButtonStyle {
    static var tbPrimary: TBButtonStyle { TBButtonStyle(kind: .primary) }
    static var tbSecondary: TBButtonStyle { TBButtonStyle(kind: .secondary) }
    static var tbDestructive: TBButtonStyle { TBButtonStyle(kind: .destructive) }
    static var tbCompact: TBButtonStyle { TBButtonStyle(kind: .secondary, compact: true) }
}

// MARK: - Zustände

enum LoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

/// Leerer oder fehlgeschlagener Zustand mit optionaler Aktion.
struct StateMessage: View {
    let title: String
    var systemImage = "exclamationmark.triangle"
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Palette.mute)
                .accessibilityHidden(true)
            Text(title).tbTitle(20, relativeTo: .title3).multilineTextAlignment(.center)
            if let message {
                Text(message).tbText(15, color: Palette.mute).multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.tbSecondary)
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

struct InlineMessage: View {
    enum Style { case error, warning, info }
    let text: String
    var style: Style = .error

    var body: some View {
        let tint: Color = style == .error ? Palette.negative : (style == .warning ? Palette.accent : Palette.mute)
        let symbol = style == .info ? "info.circle" : "exclamationmark.triangle"
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
            Text(text).tbText(14, color: Palette.ink).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Hinweis oben im Bildschirm: Stand stammt aus dem Zwischenspeicher.
struct OfflineBanner: View {
    let savedAt: Date?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "icloud.slash").accessibilityHidden(true)
            Text(savedAt.map { "Offline · Stand \(TBDate.displayDateTime($0))" } ?? "Offline")
                .tbText(13, weight: .medium, relativeTo: .footnote)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.ink)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Palette.surface2, in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous).strokeBorder(Palette.line))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(savedAt.map { "Offline. Stand \(TBDate.displayDateTime($0))" } ?? "Offline")
    }
}

// MARK: - Layout

/// Bricht Inhalte in mehrere Zeilen um.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: min(maxX, width.isFinite ? width : maxX), height: y + rowHeight), origins)
    }
}

/// Karte mit Linie und Papierfläche (ohne Perforation) für Gruppen von Zeilen.
struct PlainCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous)
                .strokeBorder(Palette.line, lineWidth: TB.Metric.hairline))
    }
}

/// Zeile in `List`/`Form`: Papierfläche, Linienfarbe, Schrift.
extension View {
    func tbRow() -> some View {
        listRowBackground(Palette.surface).listRowSeparatorTint(Palette.line)
    }

    func tbList() -> some View {
        scrollContentBackground(.hidden).background(Palette.bg.ignoresSafeArea())
    }
}
