import ImageIO
import SwiftUI

private struct APIKey: EnvironmentKey {
    static let defaultValue: (any TravelAPI)? = nil
}

extension EnvironmentValues {
    /// Die angemeldete Schnittstelle; so müssen Unteransichten sie nicht durchreichen.
    var api: (any TravelAPI)? {
        get { self[APIKey.self] }
        set { self[APIKey.self] = newValue }
    }
}

/// Speicher-Cache für Bilddaten (Titelbilder, Vorschaubilder). Gleiche Anfragen laufen zusammen,
/// fehlende Bilder (`404`/`403`) merkt sich der Cache für die Sitzung.
actor MediaImageStore {
    static let shared = MediaImageStore()

    private let cache = NSCache<NSString, NSData>()
    private var absent = Set<String>()
    private var inflight: [String: Task<Data?, Error>] = [:]

    init(countLimit: Int = 300, byteLimit: Int = 64 * 1024 * 1024) {
        cache.countLimit = countLimit
        cache.totalCostLimit = byteLimit
    }

    func data(key: String, load: @escaping @Sendable () async throws -> Data) async throws -> Data? {
        if let hit = cache.object(forKey: key as NSString) { return hit as Data }
        if absent.contains(key) { return nil }
        if let running = inflight[key] { return try await running.value }
        let task = Task<Data?, Error> {
            do { return try await load() } catch let error as APIError {
                if case .server(let status, _, _) = error, status == 404 || status == 403 { return nil }
                throw error
            }
        }
        inflight[key] = task
        defer { inflight[key] = nil }
        let result = try await task.value
        if let result { cache.setObject(result as NSData, forKey: key as NSString, cost: result.count) } else { absent.insert(key) }
        return result
    }

    func removeAll() { cache.removeAllObjects(); absent.removeAll(); inflight.removeAll() }
}

/// Lädt ein Bild mit Bearer-Token über die Schnittstelle (kein `AsyncImage` ohne Header), hält es im Speicher
/// und zeigt bis dahin (und ohne Bild) einen Platzhalter.
struct RemoteImage<Placeholder: View>: View {
    enum Source: Equatable {
        case media(String)         // `/v1/media/...`
        case thumbnail(Int)        // Dokument-Vorschau
    }

    let source: Source?
    var maxPoints: CGFloat = 160
    @ViewBuilder var placeholder: () -> Placeholder

    @Environment(\.api) private var api
    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(decorative: image, scale: 1).resizable().scaledToFill()
                } else {
                    placeholder()
                }
            }
            .clipped()
            .task(id: source) { await load() }
    }

    private func load() async {
        guard let source, let api else { image = nil; return }
        let pixels = Int((maxPoints * displayScale).rounded())
        let raw: String
        switch source {
        case .media(let p): raw = p
        case .thumbnail(let id): raw = "thumb:\(id)"
        }
        let key = "\(api.baseURL.absoluteString)\(raw)"
        if let cached = DecodedImageCache.shared.image(for: "\(key)|\(pixels)") { image = cached; return }
        do {
            let data = try await MediaImageStore.shared.data(key: key) {
                switch source {
                case .media(let p): return try await api.mediaImage(path: p)
                case .thumbnail(let id): return try await api.documentThumbnail(id: id)
                }
            }
            guard let data else { image = nil; return }
            let decoded = await Task.detached(priority: .userInitiated) {
                ImageDownsampler.thumbnail(from: data, maxPixel: pixels)
            }.value
            guard !Task.isCancelled else { return }
            if let decoded { DecodedImageCache.shared.store(decoded, for: "\(key)|\(pixels)") }
            image = decoded?.cgImage
        } catch {
            if !error.isCancellation { image = nil }
        }
    }
}

struct DecodedImage: @unchecked Sendable { let cgImage: CGImage }

enum ImageDownsampler {
    static func thumbnail(from data: Data, maxPixel: Int) -> DecodedImage? {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary) else { return nil }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(32, maxPixel),
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else { return nil }
        return DecodedImage(cgImage: cg)
    }
}

final class DecodedImageCache: @unchecked Sendable {
    static let shared = DecodedImageCache()
    private let cache = NSCache<NSString, Box>()
    private final class Box { let image: DecodedImage; init(_ i: DecodedImage) { image = i } }

    init() { cache.countLimit = 200; cache.totalCostLimit = 96 * 1024 * 1024 }
    func image(for key: String) -> CGImage? { cache.object(forKey: key as NSString)?.image.cgImage }
    func store(_ image: DecodedImage, for key: String) {
        cache.setObject(Box(image), forKey: key as NSString, cost: image.cgImage.bytesPerRow * image.cgImage.height)
    }
}

/// Titelbild einer Reise; ohne Bild eine schraffierte Fläche in Zinnober (wie im Entwurf).
struct TripCover: View {
    let path: String?
    var height: CGFloat = 140
    var cornerRadius: CGFloat = TB.Metric.cardRadius

    var body: some View {
        RemoteImage(source: path.map { .media($0) }, maxPoints: 900) {
            ZStack {
                Palette.accent
                Canvas { ctx, size in
                    var x: CGFloat = -size.height
                    while x < size.width {
                        var p = Path()
                        p.move(to: CGPoint(x: x, y: size.height))
                        p.addLine(to: CGPoint(x: x + size.height, y: 0))
                        ctx.stroke(p, with: .color(.black.opacity(0.10)), lineWidth: 14)
                        x += 28
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .accessibilityHidden(true)
    }
}
