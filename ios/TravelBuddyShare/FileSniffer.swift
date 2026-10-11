import Foundation

/// Dateityp nach Dateikopf (nicht nach Endung); Limits und Typen nach Vertrag «Dokumente».
enum ShareFileKind: String {
    case pdf, jpeg, png, heic, pkpass, ics

    static let maxBytes: Int64 = 25 * 1024 * 1024

    var mimeType: String {
        switch self {
        case .pdf: "application/pdf"
        case .jpeg: "image/jpeg"
        case .png: "image/png"
        case .heic: "image/heic"
        case .pkpass: "application/vnd.apple.pkpass"
        case .ics: "text/calendar"
        }
    }

    var label: String {
        switch self {
        case .pdf: "PDF"
        case .jpeg: "JPG"
        case .png: "PNG"
        case .heic: "HEIC"
        case .pkpass: "WALLET"
        case .ics: "KALENDER"
        }
    }

    var isImage: Bool { self == .jpeg || self == .png || self == .heic }

    static func detect(url: URL) -> ShareFileKind? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let head = try? handle.read(upToCount: 64), head.count >= 4 else { return nil }
        let b = [UInt8](head)
        let ext = url.pathExtension.lowercased()

        if b.starts(with: Array("%PDF-".utf8)) { return .pdf }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return .jpeg }
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return .png }
        if b.count >= 12, Array(b[4..<8]) == Array("ftyp".utf8) {
            let brand = String(decoding: b[8..<12], as: UTF8.self)
            if ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].contains(brand) { return .heic }
        }
        if b.starts(with: [0x50, 0x4B, 0x03, 0x04]), ext == "pkpass" { return .pkpass }
        var text = b
        if text.starts(with: [0xEF, 0xBB, 0xBF]) { text.removeFirst(3) }
        if String(decoding: text, as: UTF8.self).uppercased().hasPrefix("BEGIN:VCALENDAR") { return .ics }
        return nil
    }
}
