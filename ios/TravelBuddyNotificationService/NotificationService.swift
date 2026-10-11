import UIKit
import UniformTypeIdentifiers
import UserNotifications

/// Reichert Reise-Mitteilungen an (`mutable-content`): Illustration als Anhang, `threadIdentifier = trip-<id>`,
/// Unterbrechungsstufe, Relevanz, Text kürzen und mit `dd.mm.yyyy` / `hh:mm` formatieren.
/// Was schiefgeht, zeigt die unveränderte Mitteilung (nie ohne Inhalt).
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?
    private var work: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        lock.withLock {
            handler = contentHandler
            best = content
        }
        let payload = TravelNotificationPayload(userInfo: content.userInfo, category: content.categoryIdentifier)
        Self.applyMetadata(to: content, payload: payload)
        Self.applyText(to: content, payload: payload)

        work = Task { [weak self] in
            if let attachment = await NotificationImageResolver.attachment(for: payload, requestID: request.identifier) {
                content.attachments = [attachment]
            }
            self?.deliver()
        }
    }

    override func serviceExtensionTimeWillExpire() {
        work?.cancel()
        deliver()
    }

    /// Ruft den Handler genau einmal mit dem besten verfügbaren Stand auf.
    private func deliver() {
        let pending: ((UNNotificationContent) -> Void, UNNotificationContent)? = lock.withLock {
            guard let handler, let best else { return nil }
            self.handler = nil
            return (handler, best)
        }
        pending.map { $0.0($0.1) }
    }

    // MARK: Anreichern

    static func applyMetadata(to content: UNMutableNotificationContent, payload: TravelNotificationPayload) {
        if let thread = payload.threadIdentifier { content.threadIdentifier = thread }
        content.interruptionLevel = payload.interruptionLevel
        content.relevanceScore = payload.relevanceScore
        if content.categoryIdentifier.isEmpty, TravelNotificationKind.all.contains(payload.kind) {
            content.categoryIdentifier = payload.kind
        }
    }

    static func applyText(to content: UNMutableNotificationContent, payload: TravelNotificationPayload) {
        let tz = payload.ticket.tz.flatMap { TimeZone(identifier: $0) }
        if !content.title.isEmpty { content.title = NotificationText.format(content.title, tz: tz, maxLength: 60) }
        if !content.subtitle.isEmpty { content.subtitle = NotificationText.format(content.subtitle, tz: tz, maxLength: 60) }
        if !content.body.isEmpty { content.body = NotificationText.format(content.body, tz: tz, maxLength: 180) }
    }
}

// MARK: - Illustration

/// Auflösung des Mitteilungsbilds (PNG 600×300): gebündelt → Cache der App-Group →
/// `GET /v1/media/notification/<imageKey>` → selbst gezeichnete Ersatzkachel in Typfarbe.
enum NotificationImageResolver {
    static func attachment(for payload: TravelNotificationPayload, requestID: String) async -> UNNotificationAttachment? {
        guard let data = await imageData(for: payload) else { return nil }
        return makeAttachment(data: data, id: requestID)
    }

    static func imageData(for payload: TravelNotificationPayload) async -> Data? {
        if let key = payload.imageKey {
            if let data = bundled(key: key) { return data }
            if let data = cached(key: key) { return data }
            if !Task.isCancelled, let data = await fetch(key: key) {
                store(data, key: key)
                return data
            }
        }
        return FallbackTile.png(kind: payload.kind, ticket: payload.ticket)
    }

    private static func bundled(key: String) -> Data? {
        let bundle = Bundle.main
        let url = bundle.url(forResource: key, withExtension: "png", subdirectory: "notifications")
            ?? bundle.url(forResource: key, withExtension: "png")
        return url.flatMap { try? Data(contentsOf: $0) }
    }

    private static var cacheDirectory: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedConfig.appGroup)?
            .appendingPathComponent("NotificationImages", isDirectory: true)
    }

    private static func cached(key: String) -> Data? {
        guard let url = cacheDirectory?.appendingPathComponent("\(key).png") else { return nil }
        return try? Data(contentsOf: url)
    }

    private static func store(_ data: Data, key: String) {
        guard let dir = cacheDirectory else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: dir.appendingPathComponent("\(key).png"), options: .atomic)
    }

    private static func fetch(key: String) async -> Data? {
        guard let api = SharedAPI(session: SharedAPI.shortSession(request: 8, resource: 12)) else { return nil }
        guard let data = try? await api.notificationImage(key: key), isPNG(data) else { return nil }
        return data
    }

    private static func isPNG(_ data: Data) -> Bool {
        data.starts(with: [0x89, 0x50, 0x4E, 0x47])
    }

    private static func makeAttachment(data: Data, id: String) -> UNNotificationAttachment? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tb-\(UUID().uuidString).png")
        do {
            try data.write(to: url, options: .atomic)
            return try UNNotificationAttachment(identifier: id, url: url,
                                                options: [UNNotificationAttachmentOptionsTypeHintKey: UTType.png.identifier])
        } catch {
            return nil
        }
    }
}

// MARK: - Ersatzkachel

/// 600×300-Kachel im Stil B: Papier, Streifen in Typfarbe, grosses Symbol. Dient, bis die Illustrationen vorliegen.
enum FallbackTile {
    static func png(kind: String, ticket: TravelNotificationPayload.Ticket) -> Data? {
        let type = SharedTypeCatalog.info(for: ticket.type)
        let colorKey: String
        let symbol: String
        switch kind {
        case TravelNotificationKind.today: colorKey = "air"; symbol = "map.fill"
        case TravelNotificationKind.depart: colorKey = ticket.color ?? type.color; symbol = TBIconMap.symbol(for: ticket.icon ?? type.icon) ?? "airplane"
        case TravelNotificationKind.stay: colorKey = "stay"; symbol = "bed.double.fill"
        case TravelNotificationKind.pickup: colorKey = "car"; symbol = "car.fill"
        case TravelNotificationKind.deadline: colorKey = "air"; symbol = "hourglass"
        case TravelNotificationKind.review: colorKey = "doc"; symbol = "tray.full.fill"
        default: colorKey = ticket.color ?? type.color; symbol = TBIconMap.symbol(for: ticket.icon ?? type.icon) ?? "mappin.circle.fill"
        }
        let light = UITraitCollection(userInterfaceStyle: .light)
        let tint = UIColor(TB.Palette.type(colorKey)).resolvedColor(with: light)
        let paper = UIColor(hex: 0xFBF8F1)
        let line = UIColor(hex: 0xD4C9B4)

        let size = CGSize(width: 600, height: 300)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            paper.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            // Streifenband links
            tint.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 150, height: size.height))
            UIColor.black.withAlphaComponent(0.10).setFill()
            var x: CGFloat = -300
            while x < 150 {
                let p = UIBezierPath()
                p.move(to: CGPoint(x: x, y: 300)); p.addLine(to: CGPoint(x: x + 9, y: 300))
                p.addLine(to: CGPoint(x: x + 309, y: 0)); p.addLine(to: CGPoint(x: x + 300, y: 0)); p.close()
                p.fill()
                x += 18
            }
            // Perforation
            line.setStroke()
            let dash = UIBezierPath()
            dash.move(to: CGPoint(x: 150, y: 14)); dash.addLine(to: CGPoint(x: 150, y: 286))
            dash.lineWidth = 2
            dash.setLineDash([6, 8], count: 2, phase: 0)
            dash.stroke()
            // Symbol
            let config = UIImage.SymbolConfiguration(pointSize: 150, weight: .semibold)
            if let sym = UIImage(systemName: symbol, withConfiguration: config)?
                .withTintColor(tint, renderingMode: .alwaysOriginal) {
                let s = sym.size
                let scale = min(220 / s.width, 160 / s.height, 1)
                let w = s.width * scale, h = s.height * scale
                sym.draw(in: CGRect(x: 150 + (450 - w) / 2, y: (300 - h) / 2, width: w, height: h))
            }
        }
        return image.pngData()
    }
}
