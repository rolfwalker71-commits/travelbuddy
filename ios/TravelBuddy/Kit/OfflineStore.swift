import Foundation

/// Lokaler Zwischenspeicher für die aktive Reise: Reise, Ereignisse, Teilnehmer, Heute-Stand, Dokument-PDFs.
/// Dateien liegen unter «Application Support/TravelBuddy/Cache/<Bereich>». Ohne Netz bleibt Heute/Plan lesbar.
final class OfflineStore: @unchecked Sendable {
    struct Entry<T: Codable>: Codable {
        var savedAt: Date
        var value: T
    }

    let directory: URL
    private let fm = FileManager.default
    private let lock = NSLock()

    /// - Parameter scope: trennt Server und Konto (z. B. `host-user`), damit nach einem Wechsel nichts vermischt wird.
    init(root: URL? = nil, scope: String) {
        let base = root ?? (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                         appropriateFor: nil, create: true)) ?? FileManager.default.temporaryDirectory
        let safe = scope.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" }
        directory = base.appendingPathComponent("TravelBuddy/Cache/\(String(safe))", isDirectory: true)
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func url(_ name: String) -> URL {
        let safe = name.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" }
        return directory.appendingPathComponent(String(safe) + ".json")
    }

    // MARK: JSON

    func save<T: Codable>(_ value: T, as name: String, at date: Date = Date()) {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? JSONEncoder().encode(Entry(savedAt: date, value: value)) else { return }
        try? data.write(to: url(name), options: [.atomic])
    }

    func load<T: Codable>(_ type: T.Type, name: String) -> (value: T, savedAt: Date)? {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: url(name)),
              let entry = try? JSONDecoder().decode(Entry<T>.self, from: data) else { return nil }
        return (entry.value, entry.savedAt)
    }

    func remove(_ name: String) {
        lock.lock(); defer { lock.unlock() }
        try? fm.removeItem(at: url(name))
    }

    // MARK: Dokumente

    private var documentsDirectory: URL {
        let d = directory.appendingPathComponent("documents", isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func documentURL(id: Int, fileName: String?) -> URL {
        let ext = (fileName as NSString?)?.pathExtension ?? ""
        return documentsDirectory.appendingPathComponent("\(id)" + (ext.isEmpty ? "" : ".\(ext.lowercased())"))
    }

    /// Vorhandene Offline-Kopie (egal welche Endung).
    func cachedDocument(id: Int) -> URL? {
        let items = (try? fm.contentsOfDirectory(at: documentsDirectory, includingPropertiesForKeys: nil)) ?? []
        return items.first { $0.deletingPathExtension().lastPathComponent == "\(id)" }
    }

    @discardableResult
    func saveDocument(_ data: Data, id: Int, fileName: String?, contentType: String?) -> URL? {
        var name = fileName
        if (name as NSString?)?.pathExtension.isEmpty != false {
            if contentType?.contains("pdf") == true { name = "\(id).pdf" }
            else if contentType?.contains("png") == true { name = "\(id).png" }
            else if contentType?.contains("jpeg") == true || contentType?.contains("jpg") == true { name = "\(id).jpg" }
        }
        let target = documentURL(id: id, fileName: name)
        do { try data.write(to: target, options: [.atomic]); return target } catch { return nil }
    }

    func removeDocuments(except keep: Set<Int>) {
        let items = (try? fm.contentsOfDirectory(at: documentsDirectory, includingPropertiesForKeys: nil)) ?? []
        for u in items {
            if let id = Int(u.deletingPathExtension().lastPathComponent), !keep.contains(id) { try? fm.removeItem(at: u) }
        }
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        try? fm.removeItem(at: directory)
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    }
}

/// Namen der Einträge.
enum CacheKey {
    static let catalog = "catalog"
    static let trips = "trips"
    static let inbox = "inbox"
    static func trip(_ id: Int) -> String { "trip-\(id)" }
    static func today(_ tripID: Int) -> String { "today-\(tripID)" }
    static func ledger(_ id: Int) -> String { "ledger-\(id)" }
}
