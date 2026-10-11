import SwiftUI

/// Teilen-Blatt «In TravelBuddy ablegen» im Stil B: Papier, Ticket-Karten, Mono-Codes, Zinnober als Aktion.
struct ShareView: View {
    @ObservedObject var model: ShareModel
    var onClose: () -> Void
    var onOpenApp: () -> Void
    /// `false` nur für Bildschirmfotos ausserhalb eines Fensters (`ImageRenderer` zeichnet keine ScrollView).
    var scrollable = true

    var body: some View {
        VStack(spacing: 0) {
            header
            Group {
                if scrollable { ScrollView { sections } } else { sections.frame(maxHeight: .infinity, alignment: .top) }
            }
            footer
        }
        .background(TB.Palette.bg.ignoresSafeArea())
        .tint(TB.Palette.accent)
    }

    private var sections: some View {
                VStack(alignment: .leading, spacing: 16) {
                    switch model.phase {
                    case .loading: loading
                    case .noSession: noSession
                    case .ready: filesCard; tripCard
                    case .uploading: filesCard; progressCard
                    case .finished: resultCard; filesCard
                    }
                }
                .padding(16)
    }

    // MARK: Kopf und Fuss

    private var header: some View {
        HStack(spacing: 10) {
            TBTypeBadge(icon: "doc", colorKey: "air", size: 30)
            VStack(alignment: .leading, spacing: 0) {
                TBCaption("TravelBuddy", size: 10.5)
                Text("In TravelBuddy ablegen")
                    .font(TB.Font.title(19, weight: .bold, relativeTo: .title3))
                    .foregroundStyle(TB.Palette.ink)
            }
            Spacer()
            if model.phase != .finished {
                Button("Abbrechen", action: onClose)
                    .font(TB.Font.text(15, weight: .medium))
                    .foregroundStyle(TB.Palette.mute)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(TB.Palette.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(TB.Palette.line).frame(height: 1) }
    }

    @ViewBuilder private var footer: some View {
        switch model.phase {
        case .ready:
            VStack(spacing: 8) {
                actionButton(title: model.validItems.count == 1 ? "Ablegen" : "\(model.validItems.count) Dateien ablegen",
                             filled: true, enabled: !model.validItems.isEmpty) { model.startUpload() }
            }
            .padding(16).background(TB.Palette.surface)
            .overlay(alignment: .top) { Rectangle().fill(TB.Palette.line).frame(height: 1) }
        case .finished:
            VStack(spacing: 8) {
                if model.doneCount > 0 {
                    actionButton(title: "In TravelBuddy öffnen", filled: true, enabled: true, action: onOpenApp)
                }
                actionButton(title: "Fertig", filled: model.doneCount == 0, enabled: true, action: onClose)
            }
            .padding(16).background(TB.Palette.surface)
            .overlay(alignment: .top) { Rectangle().fill(TB.Palette.line).frame(height: 1) }
        case .noSession:
            VStack {
                actionButton(title: "Schliessen", filled: false, enabled: true, action: onClose)
            }
            .padding(16).background(TB.Palette.surface)
        default:
            EmptyView()
        }
    }

    private func actionButton(title: String, filled: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(TB.Font.title(17, weight: .bold, relativeTo: .headline))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .foregroundStyle(filled ? TB.Palette.onAccent : TB.Palette.ink)
                .background(filled ? TB.Palette.accent : Color.clear,
                            in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous))
                .overlay {
                    if !filled {
                        RoundedRectangle(cornerRadius: TB.Metric.fieldRadius, style: .continuous)
                            .strokeBorder(TB.Palette.line, lineWidth: 1)
                    }
                }
                .opacity(enabled ? 1 : 0.45)
        }
        .disabled(!enabled)
    }

    // MARK: Zustände

    private var loading: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text("Dateien werden gelesen …")
                .font(TB.Font.text(15)).foregroundStyle(TB.Palette.mute)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .ticketCard()
    }

    private var noSession: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TB.Palette.accent)
                TBCaption("Nicht angemeldet", size: 11)
            }
            Text("Bitte zuerst in TravelBuddy anmelden")
                .font(TB.Font.title(20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(TB.Palette.ink)
            Text("Öffne die App TravelBuddy, melde dich an und teile die Datei danach erneut.")
                .font(TB.Font.text(15)).foregroundStyle(TB.Palette.mute)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .ticketCard()
    }

    // MARK: Dateien

    private var filesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TBCaption(model.items.count == 1 ? "Datei" : "\(model.items.count) Dateien", size: 11)
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                Rectangle().fill(TB.Palette.line).frame(height: 1).padding(.leading, index == 0 ? 0 : 14)
                fileRow(item)
            }
            if let notice = model.notice {
                Rectangle().fill(TB.Palette.line).frame(height: 1)
                Text(notice).font(TB.Font.text(13)).foregroundStyle(TB.Palette.mute)
                    .padding(.horizontal, 14).padding(.vertical, 10)
            }
        }
        .ticketCard()
    }

    private func fileRow(_ item: ShareModel.Item) -> some View {
        HStack(alignment: .center, spacing: 12) {
            thumbnail(item)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name)
                    .font(TB.Font.text(15, weight: .semibold))
                    .foregroundStyle(TB.Palette.ink)
                    .lineLimit(2)
                    .truncationMode(.middle)
                HStack(spacing: 8) {
                    if let kind = item.kind {
                        Text(kind.label)
                            .font(TB.Font.mono(10.5, weight: .semibold))
                            .foregroundStyle(TB.Palette.mute)
                    }
                    Text(Self.sizeText(item.size))
                        .font(TB.Font.mono(10.5, weight: .medium))
                        .foregroundStyle(TB.Palette.mute)
                }
                if let problem = item.problem {
                    Label { Text(problem).font(TB.Font.text(13)) } icon: { Image(systemName: "exclamationmark.triangle.fill") }
                        .foregroundStyle(TB.Palette.negative)
                } else {
                    stateText(item.state)
                }
            }
            Spacer(minLength: 0)
            stateIcon(item.state, valid: item.isValid)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    @ViewBuilder private func thumbnail(_ item: ShareModel.Item) -> some View {
        Group {
            if let image = item.thumbnail {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ZStack {
                    TB.Palette.surface2
                    Image(systemName: item.kind == .pdf ? "doc.richtext" : "doc")
                        .font(.system(size: 20, weight: .medium)).foregroundStyle(TB.Palette.mute)
                }
            }
        }
        .frame(width: 46, height: 58)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(TB.Palette.line, lineWidth: 1))
        .accessibilityHidden(true)
    }

    @ViewBuilder private func stateText(_ state: ShareModel.ItemState) -> some View {
        switch state {
        case .pending: EmptyView()
        case .uploading(let p):
            Text("Wird hochgeladen · \(Int((p * 100).rounded())) %")
                .font(TB.Font.mono(11.5, weight: .medium)).foregroundStyle(TB.Palette.accent)
        case .done:
            Text("Abgelegt, wird ausgewertet")
                .font(TB.Font.text(13, weight: .medium)).foregroundStyle(TB.Palette.positive)
        case .failed(let reason):
            Text(reason).font(TB.Font.text(13)).foregroundStyle(TB.Palette.negative)
        }
    }

    @ViewBuilder private func stateIcon(_ state: ShareModel.ItemState, valid: Bool) -> some View {
        switch state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(TB.Palette.positive)
        case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(TB.Palette.negative)
        case .uploading: ProgressView()
        case .pending: if !valid { Image(systemName: "nosign").foregroundStyle(TB.Palette.mute) }
        }
    }

    // MARK: Reisewahl

    private var tripCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TBCaption("Reise wählen", size: 11)
                Spacer()
                if model.tripsLoading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            tripRow(title: "Automatisch zuordnen", subtitle: "TravelBuddy erkennt die passende Reise aus dem Dokument.",
                    icon: "wand.and.stars", selected: model.selectedTripID == nil) { model.selectedTripID = nil }
            ForEach(model.trips) { trip in
                Rectangle().fill(TB.Palette.line).frame(height: 1).padding(.leading, 14)
                tripRow(title: trip.title, subtitle: [trip.range, trip.destination].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                        icon: "suitcase", selected: model.selectedTripID == trip.id) { model.selectedTripID = trip.id }
            }
        }
        .ticketCard()
    }

    private func tripRow(title: String, subtitle: String, icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(selected ? TB.Palette.accent : TB.Palette.mute)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(TB.Font.text(15.5, weight: .semibold)).foregroundStyle(TB.Palette.ink).lineLimit(1)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(TB.Font.text(12.5)).foregroundStyle(TB.Palette.mute).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                ZStack {
                    Circle().strokeBorder(selected ? TB.Palette.accent : TB.Palette.line, lineWidth: 1.5).frame(width: 20, height: 20)
                    if selected { Circle().fill(TB.Palette.accent).frame(width: 10, height: 10) }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Fortschritt und Ergebnis

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TBCaption("Upload", size: 11)
                Spacer()
                Text("\(Int((model.progress * 100).rounded())) %")
                    .font(TB.Font.mono(14, weight: .semibold)).foregroundStyle(TB.Palette.ink)
            }
            TBProgressBar(progress: model.progress, tint: TB.Palette.accent, height: 8)
            Text("Du kannst das Blatt schliessen, die Übertragung läuft im Hintergrund weiter.")
                .font(TB.Font.text(13)).foregroundStyle(TB.Palette.mute)
        }
        .padding(14)
        .ticketCard()
    }

    private var resultCard: some View {
        let ok = model.failedItems.isEmpty
        let partial = !ok && model.doneCount > 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: ok ? "checkmark.circle.fill" : (partial ? "exclamationmark.circle.fill" : "xmark.circle.fill"))
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(ok ? TB.Palette.positive : TB.Palette.negative)
                Text(model.headline)
                    .font(TB.Font.title(21, weight: .bold, relativeTo: .title3))
                    .foregroundStyle(TB.Palette.ink)
            }
            if ok {
                Text(model.selectedTripID == nil
                     ? "TravelBuddy ordnet die Unterlagen einer Reise zu und schlägt Ereignisse vor. Du findest sie im Eingang."
                     : "Die Unterlagen hängen an der gewählten Reise. Erkannte Ereignisse erscheinen als Vorschlag.")
                    .font(TB.Font.text(14)).foregroundStyle(TB.Palette.mute)
            } else {
                ForEach(Array(model.failedItems.enumerated()), id: \.offset) { _, item in
                    if case .failed(let reason) = item.state {
                        Text("\(item.name): \(reason)").font(TB.Font.text(14)).foregroundStyle(TB.Palette.mute)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .ticketCard()
    }

    static func sizeText(_ bytes: Int64) -> String {
        if bytes >= 1_000_000 { return String(format: "%.1f MB", Double(bytes) / 1_000_000) }
        return "\(max(1, Int((Double(bytes) / 1000).rounded()))) kB"
    }
}

private extension View {
    func ticketCard() -> some View {
        background(TB.Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius, style: .continuous)
                .strokeBorder(TB.Palette.line, lineWidth: 1))
    }
}

// MARK: - Vorschau

extension ShareModel {
    /// Beispielzustand für Vorschauen und Screenshot-Läufe.
    static func previewModel(phase: Phase, failed: Bool = false) -> ShareModel {
        let m = ShareModel()
        m.phase = phase
        m.items = [
            Item(id: "1", url: URL(fileURLWithPath: "/tmp/Buchung_Flug_LX2086.pdf"), name: "Buchung_Flug_LX2086.pdf", size: 412_000,
                 kind: .pdf, problem: nil, state: phase == .finished ? .done("Flug") : .pending),
            Item(id: "2", url: URL(fileURLWithPath: "/tmp/IMG_2041.heic"), name: "IMG_2041.heic", size: 2_310_000,
                 kind: .heic, problem: nil, state: failed ? .failed("Die Datei ist zu gross (höchstens 25 MB).") : (phase == .finished ? .done(nil) : .pending)),
            Item(id: "3", url: URL(fileURLWithPath: "/tmp/Notiz.txt"), name: "Notiz.txt", size: 1_200, kind: nil,
                 problem: "Dateityp wird nicht unterstützt (PDF, JPG, PNG, HEIC)."),
        ]
        m.trips = [
            .init(id: 1, title: "Ferien 2026", destination: "Barcelona → Florida", startDate: "2026-10-23", endDate: "2026-11-20", phase: "active"),
            .init(id: 2, title: "Lissabon im Herbst", destination: "Lissabon", startDate: "2026-12-01", endDate: "2026-12-08", phase: "upcoming"),
        ]
        return m
    }
}

#Preview("Bereit") { ShareView(model: .previewModel(phase: .ready), onClose: {}, onOpenApp: {}) }
#Preview("Abgelegt") { ShareView(model: .previewModel(phase: .finished), onClose: {}, onOpenApp: {}) }
#Preview("Fehler") { ShareView(model: .previewModel(phase: .finished, failed: true), onClose: {}, onOpenApp: {}) }
#Preview("Nicht angemeldet") {
    let m = ShareModel(); m.phase = .noSession
    return ShareView(model: m, onClose: {}, onOpenApp: {})
}
