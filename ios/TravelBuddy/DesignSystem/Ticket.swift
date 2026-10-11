import SwiftUI

/// Perforation: gestrichelte Linie mit seitlichen Kerben. Die Kerben ragen über den Kartenrand hinaus und werden
/// vom `clipShape` der Karte halb abgeschnitten, die Fläche in Papierfarbe bildet den Ausschnitt.
struct Perforation: View {
    var notch: CGFloat = 14

    var body: some View {
        ZStack {
            DashedLine()
                .stroke(Palette.line, style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
                .frame(height: 1)
                .padding(.horizontal, notch)
            HStack {
                Circle().fill(Palette.bg).overlay(Circle().strokeBorder(Palette.line, lineWidth: 1))
                    .frame(width: notch, height: notch).offset(x: -notch / 2)
                Spacer()
                Circle().fill(Palette.bg).overlay(Circle().strokeBorder(Palette.line, lineWidth: 1))
                    .frame(width: notch, height: notch).offset(x: notch / 2)
            }
        }
        .frame(height: notch)
        .accessibilityHidden(true)
    }
}

private struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

/// Ticket-Karte: Kopfband (Typ-Symbol, Typ GROSS, Referenz mono), Perforation, Hauptteil, optional Abrissstreifen.
struct TicketCard<Main: View, Strip: View>: View {
    let icon: String
    let color: String
    let typeLabel: String
    var reference: String?
    var status: EventStatus = .confirmed
    var emphasized = false
    @ViewBuilder var main: () -> Main
    @ViewBuilder var strip: () -> Strip

    private var tint: Color { Palette.type(color) }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous)
        VStack(spacing: 0) {
            header
            Perforation()
            main()
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            if Strip.self != EmptyView.self {
                Perforation()
                strip()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surface2)
            }
        }
        .background {
            ZStack {
                Palette.surface
                shape.strokeBorder(emphasized ? tint : Palette.line, lineWidth: emphasized ? 1.5 : TB.Metric.hairline)
            }
        }
        .clipShape(shape)
        .overlay(alignment: .top) {
            // Typfarbe als Kante am Kopf (die Fläche bleibt Papier, damit der Kontrast reicht).
            Rectangle().fill(tint).frame(height: 4).clipShape(UnevenRoundedRectangle(topLeadingRadius: TB.Metric.cardRadius, topTrailingRadius: TB.Metric.cardRadius))
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: 10) {
            TypeBadge(icon: icon, color: color, size: 28)
            TBLabel(typeLabel, color: Palette.ink, size: 13)
            if status.isProposal { StatusChip(status: status) }
            Spacer(minLength: 8)
            if let reference, !reference.isEmpty {
                Text(reference)
                    .tbMono(13, weight: .medium, relativeTo: .footnote)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel("Referenz \(reference)")
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .background(tint.opacity(0.10))
    }
}

extension TicketCard where Strip == EmptyView {
    init(icon: String, color: String, typeLabel: String, reference: String? = nil, status: EventStatus = .confirmed,
         emphasized: Bool = false, @ViewBuilder main: @escaping () -> Main) {
        self.icon = icon; self.color = color; self.typeLabel = typeLabel; self.reference = reference
        self.status = status; self.emphasized = emphasized; self.main = main; self.strip = { EmptyView() }
    }
}

/// Raster der grossen Angaben (Terminal, Gate, Sitz …): Label GROSS, Wert gross, Codes in Mono.
struct FactGrid: View {
    let facts: [EventFact]
    var large = true

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: 120), spacing: 14, alignment: .topLeading)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            ForEach(facts) { fact in
                VStack(alignment: .leading, spacing: 2) {
                    TBLabel(fact.label, size: 11)
                    if fact.mono && fact.value.count <= 9 {
                        Text(fact.value).tbMono(large ? 24 : 17, weight: .semibold, relativeTo: .title2)
                    } else {
                        Text(fact.value).tbTitle(large ? 20 : 16, weight: .semibold, relativeTo: .title3)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(fact.label): \(fact.value)")
            }
        }
    }
}
