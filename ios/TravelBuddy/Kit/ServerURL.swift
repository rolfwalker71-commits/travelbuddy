import Foundation

/// Normalisiert und prüft die vom Nutzer eingegebene Server-Adresse.
enum ServerURL {
    /// `https://…` ist immer erlaubt. `http://` nur für lokale Entwicklung
    /// (localhost, Loopback, `*.local`, `*.localhost`, `*.test`) – produktiv nur HTTPS.
    static func normalize(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") {
            text = (isLocalHost(hostPart(of: text)) ? "http://" : "https://") + text
        }
        while text.hasSuffix("/") { text.removeLast() }
        guard var comps = URLComponents(string: text),
              let scheme = comps.scheme?.lowercased(),
              let host = comps.host, !host.isEmpty else { return nil }
        guard scheme == "https" || (scheme == "http" && isLocalHost(host)) else { return nil }
        comps.scheme = scheme
        comps.query = nil
        comps.fragment = nil
        return comps.url
    }

    static func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if h == "localhost" || h == "127.0.0.1" || h == "::1" { return true }
        return h.hasSuffix(".local") || h.hasSuffix(".localhost") || h.hasSuffix(".test")
    }

    private static func hostPart(of text: String) -> String {
        var host = text
        if let slash = host.firstIndex(of: "/") { host = String(host[..<slash]) }
        if host.hasPrefix("["), let close = host.firstIndex(of: "]") {
            return String(host[host.index(after: host.startIndex)..<close])
        }
        if let colon = host.lastIndex(of: ":"), host.filter({ $0 == ":" }).count == 1 {
            host = String(host[..<colon])
        }
        return host
    }
}
