import Foundation
import Security

/// Anmeldung, die App und Erweiterungen teilen: Token im gemeinsamen Schlüsselbund, Server-URL in der App-Group.
/// Die App schreibt (`save`), Widgets, Teilen- und Mitteilungs-Erweiterungen lesen (`load`).
public enum SharedSession {
    public struct Credentials: Equatable {
        public let serverURL: URL
        public let token: String
        public init(serverURL: URL, token: String) { self.serverURL = serverURL; self.token = token }
    }

    private static let account = "device-token"

    /// Zugriffsgruppe `<TeamPrefix>.ch.rolfwalker.travelbuddy`; fällt auf die Standardgruppe zurück, wenn nicht ermittelbar.
    private static var accessGroup: String? {
        let probe: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: "__probe__",
            kSecAttrService as String: SharedConfig.keychainService,
            kSecReturnAttributes as String: true,
        ]
        var item: CFTypeRef?
        var status = SecItemCopyMatching(probe as CFDictionary, &item)
        if status == errSecItemNotFound {
            var add = probe; add.removeValue(forKey: kSecReturnAttributes as String)
            add[kSecValueData as String] = Data()
            SecItemAdd(add as CFDictionary, nil)
            status = SecItemCopyMatching(probe as CFDictionary, &item)
        }
        if status == errSecSuccess, let attrs = item as? [String: Any], let group = attrs[kSecAttrAccessGroup as String] as? String {
            // Standardgruppe ist `<Prefix>.<erste Gruppe aus Entitlements>`; Präfix übernehmen.
            if let dot = group.firstIndex(of: ".") {
                return String(group[..<dot]) + "." + SharedConfig.keychainAccessGroupSuffix
            }
        }
        return nil
    }

    private static func baseQuery() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: SharedConfig.keychainService,
            kSecAttrAccount as String: account,
        ]
        if let g = accessGroup { q[kSecAttrAccessGroup as String] = g }
        return q
    }

    public static func save(_ credentials: Credentials) {
        SharedConfig.defaults.set(credentials.serverURL.absoluteString, forKey: SharedConfig.Key.serverURL)
        var q = baseQuery()
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = Data(credentials.token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    public static func load() -> Credentials? {
        guard let urlString = SharedConfig.defaults.string(forKey: SharedConfig.Key.serverURL),
              let url = URL(string: urlString) else { return nil }
        var q = baseQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty else { return nil }
        return Credentials(serverURL: url, token: token)
    }

    public static func clear() {
        SecItemDelete(baseQuery() as CFDictionary)
        SharedConfig.defaults.removeObject(forKey: SharedConfig.Key.serverURL)
        SharedConfig.defaults.removeObject(forKey: SharedConfig.Key.summaryJSON)
    }
}
