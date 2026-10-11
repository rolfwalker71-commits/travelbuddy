import SwiftUI
import WidgetKit

/// «Reisekasse»: Saldo des Nutzers und kurze Salden-Balken der Mitreisenden.
struct LedgerWidget: Widget {
    static let kind = "ch.rolfwalker.travelbuddy.widget.ledger"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: SelectTripIntent.self, provider: TravelProvider(needsLedger: true)) { entry in
            LedgerWidgetView(entry: entry)
        }
        .configurationDisplayName("Reisekasse")
        .description("Dein Saldo in der Reisekasse und die Salden der Mitreisenden.")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

struct LedgerWidgetView: View {
    let entry: TravelEntry

    var body: some View {
        content
            .travelContainer(axis: .vertical, fraction: 0.4)
            .widgetURL(url)
    }

    @ViewBuilder private var content: some View {
        switch entry.content {
        case .signedOut: WidgetStatusView(kind: .signedOut, header: "Reisekasse")
        case .unavailable: WidgetStatusView(kind: .unavailable, header: "Reisekasse")
        case .data(let snapshot):
            if let ledger = snapshot.ledger {
                Ledger(snapshot: snapshot, ledger: ledger)
            } else if snapshot.trip == nil {
                WidgetStatusView(kind: .noTrip, header: "Reisekasse")
            } else {
                WidgetStatusView(kind: .unavailable, header: "Reisekasse")
            }
        }
    }

    private var url: URL {
        if case .data(let s) = entry.content, let id = s.ledger?.id ?? s.trip?.ledgerId { return SharedLink.ledger(id) }
        return SharedLink.today
    }
}

private struct Ledger: View {
    let snapshot: TravelSnapshot
    let ledger: SharedSummary.Ledger

    var body: some View {
        GeometryReader { g in
            let split = g.size.width * 0.4
            ZStack(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    TBCaption("Reisekasse")
                    Text(ledger.title ?? snapshot.trip?.title ?? "")
                        .font(TB.Font.title(14, weight: .bold, relativeTo: .subheadline))
                        .foregroundStyle(TB.Palette.ink)
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(statement)
                        .font(TB.Font.text(11.5, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(TB.Palette.mute)
                    Text(SharedFormat.money(minor: abs(ledger.balanceMinor), currency: nil, decimals: false))
                        .font(TB.Font.mono(26, weight: .semibold, relativeTo: .title))
                        .foregroundStyle(tone)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(ledger.currency)
                        .font(TB.Font.mono(11, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(TB.Palette.mute)
                }
                .padding(.leading, 16).padding(.trailing, 10).padding(.vertical, 14)
                .frame(width: split, height: g.size.height, alignment: .topLeading)

                Path { p in
                    p.move(to: CGPoint(x: split, y: 14)); p.addLine(to: CGPoint(x: split, y: g.size.height - 14))
                }
                .stroke(TB.Palette.line, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 4]))

                VStack(alignment: .leading, spacing: 6) {
                    if rows.isEmpty {
                        Spacer(minLength: 0)
                        Text("Noch keine Ausgaben erfasst.")
                            .font(TB.Font.text(12.5, relativeTo: .footnote))
                            .foregroundStyle(TB.Palette.mute)
                        Spacer(minLength: 0)
                    } else {
                        TBCaption("Salden je Person")
                        TBBalanceBars(rows: rows, currency: ledger.currency)
                        Spacer(minLength: 0)
                    }
                    if let stale = snapshot.staleText {
                        Text(stale).font(TB.Font.text(10, relativeTo: .caption2)).foregroundStyle(TB.Palette.mute)
                    }
                }
                .padding(.leading, 12).padding(.trailing, 14).padding(.vertical, 14)
                .frame(width: g.size.width - split, height: g.size.height, alignment: .topLeading)
                .offset(x: split)
            }
        }
    }

    private var rows: [TBBalanceBars.Row] {
        let sorted = ledger.balances.sorted { abs($0.netMinor) > abs($1.netMinor) }
        let me = sorted.filter(\.isMe)
        let others = sorted.filter { !$0.isMe }
        return (me + others).prefix(4).map { .init(id: $0.id, name: $0.isMe ? "Du" : $0.name, netMinor: $0.netMinor, isMe: $0.isMe) }
    }

    private var statement: String {
        if ledger.balanceMinor > 0 { return "Du bekommst" }
        if ledger.balanceMinor < 0 { return "Du schuldest" }
        return "Ausgeglichen"
    }

    private var tone: Color {
        ledger.balanceMinor > 0 ? TB.Palette.positive : (ledger.balanceMinor < 0 ? TB.Palette.negative : TB.Palette.ink)
    }
}

#Preview("Reisekasse", as: .systemMedium) {
    LedgerWidget()
} timeline: {
    TravelEntry(date: .now, content: .data({
        var s = TravelProvider.sampleSnapshot(); s.ledger = SharedSampleData.ledger; return s
    }()))
    TravelEntry(date: .now, content: .signedOut)
}
