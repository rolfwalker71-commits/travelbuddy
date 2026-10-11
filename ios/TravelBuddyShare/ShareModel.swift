import PDFKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Zustand des Teilen-Blatts: Dateien, Reisewahl, Upload, Ergebnis.
@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable { case loading, noSession, ready, uploading, finished }

    enum ItemState: Equatable {
        case pending
        case uploading(Double)
        case done(String?)          // Titel des Dokuments, falls geliefert
        case failed(String)
    }

    struct Item: Identifiable {
        let id: String
        var url: URL
        var name: String
        var size: Int64
        var kind: ShareFileKind?
        var problem: String?
        var thumbnail: UIImage?
        var state: ItemState = .pending

        var isValid: Bool { problem == nil && kind != nil }
    }

    @Published var phase: Phase = .loading
    @Published var items: [Item] = []
    @Published var trips: [SharedSummary.Trip] = []
    @Published var tripsLoading = false
    @Published var selectedTripID: Int?           // nil = «Automatisch zuordnen»
    @Published var notice: String?                // z. B. «Nur die ersten 10 Dateien»

    static let maxFiles = 10

    private var api: SharedAPI?
    private var uploader: ShareUploader?
    private var workDirectory: URL?

    // MARK: Start

    func start(extensionItems: [NSExtensionItem]) {
        TBFonts.registerIfNeeded()
        ShareStorage.cleanupOld()
        guard let api = SharedAPI(session: SharedAPI.shortSession(request: 10, resource: 20)) else {
            phase = .noSession
            return
        }
        self.api = api
        Task {
            await loadFiles(from: extensionItems)
            phase = .ready
        }
        Task { await loadTrips() }
    }

    private func loadTrips() async {
        guard let api else { return }
        tripsLoading = true
        defer { tripsLoading = false }
        do {
            let today = SharedFormat.isoDay(Date())
            let list = try await api.trips()
            func rank(_ t: SharedSummary.Trip) -> Int {
                switch t.phase ?? t.phase(on: today) { case "active": 0; case "upcoming": 1; default: 2 }
            }
            trips = list.sorted {
                let a = rank($0), b = rank($1)
                return a != b ? a < b : ($0.startDate ?? "") > ($1.startDate ?? "")
            }
        } catch let failure as SharedAPI.Failure where failure.isAuthProblem {
            phase = .noSession
        } catch {
            // Reiseliste ist optional: «Automatisch zuordnen» geht auch ohne.
            trips = []
        }
    }

    // MARK: Dateien laden

    private func loadFiles(from extensionItems: [NSExtensionItem]) async {
        let providers = extensionItems.flatMap { $0.attachments ?? [] }
        if providers.count > Self.maxFiles { notice = "Es werden nur die ersten \(Self.maxFiles) Dateien übernommen." }
        let directory = ShareStorage.newSessionDirectory()
        workDirectory = directory
        for provider in providers.prefix(Self.maxFiles) {
            if let item = await Self.load(provider: provider, into: directory) { items.append(item) }
        }
        if items.isEmpty { notice = "Es wurden keine Dateien erkannt, die sich ablegen lassen." }
    }

    private static func load(provider: NSItemProvider, into directory: URL) async -> Item? {
        let preferred: [UTType] = [.pdf, .heic, .jpeg, .png, .image, .data, .item]
        var chosen: String?
        for type in preferred {
            if let id = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: type) == true }) {
                chosen = id
                break
            }
        }
        guard let identifier = chosen else { return nil }

        let loaded: (URL, String)? = await withCheckedContinuation { cont in
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                guard let url else { cont.resume(returning: nil); return }
                var name = provider.suggestedName ?? url.deletingPathExtension().lastPathComponent
                var ext = url.pathExtension
                if ext.isEmpty { ext = UTType(identifier)?.preferredFilenameExtension ?? "" }
                if !ext.isEmpty, !name.lowercased().hasSuffix("." + ext.lowercased()) { name += "." + ext }
                if name.isEmpty { name = "Datei" }
                let target = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                do {
                    try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
                    let dest = target.appendingPathComponent(name.replacingOccurrences(of: "/", with: "-"))
                    try FileManager.default.copyItem(at: url, to: dest)
                    cont.resume(returning: (dest, name))
                } catch {
                    cont.resume(returning: nil)
                }
            }
        }
        guard let (url, name) = loaded else {
            return Item(id: UUID().uuidString, url: directory, name: provider.suggestedName ?? "Datei", size: 0, kind: nil,
                        problem: "Die Datei konnte nicht gelesen werden.")
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
        let kind = ShareFileKind.detect(url: url)
        var problem: String?
        if size == 0 { problem = "Die Datei ist leer." }
        else if size > ShareFileKind.maxBytes { problem = "Zu gross (höchstens 25 MB)." }
        else if kind == nil { problem = "Dateityp wird nicht unterstützt (PDF, JPG, PNG, HEIC)." }
        let thumb = await thumbnail(for: url, kind: kind)
        return Item(id: UUID().uuidString, url: url, name: name, size: size, kind: kind, problem: problem, thumbnail: thumb)
    }

    private static func thumbnail(for url: URL, kind: ShareFileKind?) async -> UIImage? {
        await Task.detached(priority: .utility) { () -> UIImage? in
            guard let kind else { return nil }
            if kind == .pdf {
                guard let doc = PDFDocument(url: url), let page = doc.page(at: 0) else { return nil }
                return page.thumbnail(of: CGSize(width: 140, height: 180), for: .cropBox)
            }
            if kind.isImage {
                // Verkleinert lesen, damit grosse Fotos das Speicherlimit der Erweiterung nicht sprengen.
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 220,
                ]
                guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary) else { return nil }
                return UIImage(cgImage: cg)
            }
            return nil
        }.value
    }

    // MARK: Upload

    var validItems: [Item] { items.filter(\.isValid) }

    var progress: Double {
        let list = validItems
        guard !list.isEmpty else { return 0 }
        let sum = list.reduce(0.0) { acc, item in
            switch item.state {
            case .pending: acc
            case .uploading(let p): acc + p
            case .done, .failed: acc + 1
            }
        }
        return sum / Double(list.count)
    }

    var doneCount: Int { items.filter { if case .done = $0.state { true } else { false } }.count }
    var failedItems: [Item] { items.filter { if case .failed = $0.state { true } else { false } } }

    func startUpload() {
        guard phase == .ready, let api, !validItems.isEmpty else { return }
        phase = .uploading
        let uploader = ShareUploader()
        self.uploader = uploader
        uploader.onProgress = { [weak self] id, fraction in
            Task { @MainActor in self?.setState(.uploading(fraction), for: id) }
        }
        uploader.onFinish = { [weak self] id, outcome in
            Task { @MainActor in self?.finish(id: id, outcome: outcome) }
        }
        let path = selectedTripID.map { "/v1/trips/\($0)/documents" } ?? "/v1/documents"
        let targets = validItems
        Task {
            for item in targets {
                guard let kind = item.kind else { continue }
                setState(.uploading(0), for: item.id)
                let boundary = "tb-\(UUID().uuidString)"
                let body = item.url.deletingLastPathComponent().appendingPathComponent("upload.body")
                do {
                    try await Task.detached(priority: .userInitiated) {
                        try SharedMultipart.writeBody(boundary: boundary, fileURL: item.url, fileName: item.name,
                                                      mimeType: kind.mimeType, to: body)
                    }.value
                    var request = api.request(path, method: "POST")
                    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
                    uploader.upload(itemID: item.id, bodyFile: body, request: request)
                } catch {
                    setState(.failed("Die Datei konnte nicht vorbereitet werden."), for: item.id)
                    checkFinished()
                }
            }
        }
    }

    private func setState(_ state: ItemState, for id: String) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].state = state
    }

    private func finish(id: String, outcome: ShareUploader.Outcome) {
        if let error = outcome.error {
            let reason: String
            if let urlError = error as? URLError { reason = SharedAPI.describe(urlError) } else { reason = "Der Upload ist fehlgeschlagen." }
            setState(.failed(reason), for: id)
        } else if let status = outcome.status, (200..<300).contains(status) {
            struct Reply: Decodable { struct Doc: Decodable { let title: String? }; let document: Doc? }
            let title = (try? JSONDecoder().decode(Reply.self, from: outcome.data))?.document?.title
            setState(.done(title), for: id)
        } else if let status = outcome.status {
            struct Body: Decodable { struct Err: Decodable { let message: String? }; let error: Err? }
            let message = (try? JSONDecoder().decode(Body.self, from: outcome.data))?.error?.message
            let failure: SharedAPI.Failure = status == 401 ? .unauthorized : .http(status: status, code: nil, message: message)
            setState(.failed(failure.userMessage), for: id)
        } else {
            setState(.failed("Keine Antwort vom Server."), for: id)
        }
        checkFinished()
    }

    private func checkFinished() {
        let pending = validItems.contains { item in
            switch item.state { case .pending, .uploading: true; default: false }
        }
        guard !pending else { return }
        phase = .finished
        if let workDirectory { ShareStorage.remove(workDirectory) }
    }

    var headline: String {
        switch phase {
        case .finished:
            if failedItems.isEmpty { return "Abgelegt, wird ausgewertet" }
            if doneCount == 0 { return "Nicht abgelegt" }
            return "\(doneCount) von \(validItems.count) abgelegt"
        default: return "In TravelBuddy ablegen"
        }
    }
}

// MARK: - Ablage im App-Group-Container

enum ShareStorage {
    private static var root: URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedConfig.appGroup)
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("ShareUploads", isDirectory: true)
    }

    static func newSessionDirectory() -> URL {
        let dir = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func remove(_ url: URL) { try? FileManager.default.removeItem(at: url) }

    /// Entfernt Reste früherer Läufe (älter als ein Tag), z. B. nach abgebrochenen Hintergrund-Uploads.
    static func cleanupOld() {
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-86_400)
        for d in dirs {
            let date = (try? d.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if date < limit { try? fm.removeItem(at: d) }
        }
    }
}
