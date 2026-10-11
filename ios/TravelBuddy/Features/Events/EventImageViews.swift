import SwiftUI

/// Einstellung «KI-Bilder bei Ereignissen anzeigen» (nur dieses Gerät). Eigene, hochgeladene Bilder bleiben sichtbar.
enum EventImagePrefs {
    static let key = "showGeneratedEventImages"

    static func isVisible(_ event: TripEvent, showGenerated: Bool) -> Bool {
        guard event.imageUrl != nil else { return false }
        return event.imageSource == "uploaded" || showGenerated
    }
}

/// Kleine Bildvorschau eines Ereignisses; Antippen öffnet die grosse Ansicht.
struct EventImageThumb: View {
    let event: TripEvent
    var size: CGFloat = 52
    @State private var showFull = false

    var body: some View {
        if let path = event.imageUrl {
            Button { showFull = true } label: {
                RemoteImage(source: .media(path), maxPoints: size * 2) {
                    Palette.surface2.overlay { Image(systemName: "photo").foregroundStyle(Palette.mute) }
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Palette.line, lineWidth: TB.Metric.hairline))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Bild vergrössern: \(event.title)")
            .fullScreenCover(isPresented: $showFull) { EventImageViewer(path: path, title: event.title) }
        }
    }
}

/// Grosse Ansicht des Ereignisbildes (volle Auflösung, Zuschneiden vermieden).
struct EventImageViewer: View {
    let path: String
    let title: String
    @Environment(\.api) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var image: CGImage?
    @State private var failed = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Group {
                if let image {
                    Image(decorative: image, scale: 1).resizable().scaledToFit()
                        .accessibilityLabel(title)
                } else if failed {
                    Label("Bild nicht verfügbar", systemImage: "photo").foregroundStyle(.white)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(12)
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 30)).symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.5))
            }
            .padding(16)
            .accessibilityLabel("Schliessen")
        }
        .onTapGesture { dismiss() }
        .task {
            guard let api else { failed = true; return }
            do {
                let data = try await MediaImageStore.shared.data(key: "\(api.baseURL.absoluteString)\(path)") {
                    try await api.mediaImage(path: path)
                }
                guard let data else { failed = true; return }
                let decoded = await Task.detached(priority: .userInitiated) { ImageDownsampler.thumbnail(from: data, maxPixel: 2400) }.value
                if let decoded { image = decoded.cgImage } else { failed = true }
            } catch {
                if !error.isCancellation { failed = true }
            }
        }
    }
}
