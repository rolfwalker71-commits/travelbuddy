import Foundation

/// Fehlerumschlag der API: `{ "error": { "code", "message" } }`.
struct APIErrorEnvelope: Decodable, Sendable {
    struct Body: Decodable, Sendable {
        let code: String
        let message: String
    }
    let error: Body
}

enum APIError: Error, Equatable, Sendable {
    /// Server hat mit Fehlerumschlag geantwortet (`message` ist deutsch und für Menschen gedacht).
    case server(status: Int, code: String, message: String)
    /// 401 mit Token: Sitzung ungültig oder widerrufen.
    case unauthorized(message: String)
    /// Keine Verbindung / Zeitüberschreitung / TLS usw.
    case network(String)
    /// Antwort war kein erwartetes JSON.
    case decoding(String)
    case invalidServerURL
    /// Antwort ohne Fehlerumschlag (z. B. Reverse-Proxy-Fehlerseite).
    case unexpectedStatus(Int)
    /// Der Endpunkt gehört zum Vertrag, ist auf dem Server aber (noch) nicht vorhanden.
    case notAvailable(String)

    /// Maschinenlesbarer Code (`invalid_details`, `invalid_credentials`, …), falls vorhanden.
    var code: String? {
        switch self {
        case .server(_, let code, _): code
        case .unauthorized: "unauthorized"
        default: nil
        }
    }

    /// Kein Netz, Zeitüberschreitung oder Server nicht erreichbar.
    var isConnectivity: Bool {
        if case .network = self { return true }
        return false
    }

    var userMessage: String {
        switch self {
        case .server(_, _, let message): message
        case .unauthorized(let message): message
        case .network(let detail): "Der Server ist nicht erreichbar. \(detail)"
        case .decoding: "Die Antwort des Servers wurde nicht verstanden. Ist die Server-Adresse richtig?"
        case .invalidServerURL: "Die Server-Adresse ist ungültig. Beispiel: https://travelbuddy.example.ch"
        case .unexpectedStatus(let status): "Unerwartete Antwort des Servers (HTTP \(status))."
        case .notAvailable(let what): "\(what) ist auf dem Server noch nicht verfügbar."
        }
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { userMessage }
}

extension Error {
    /// Text für die Anzeige im UI.
    var userMessage: String {
        if let api = self as? APIError { return api.userMessage }
        return localizedDescription
    }

    /// `true`, wenn der Fehler nur eine abgebrochene Aufgabe ist (kein Fehler für Nutzer).
    var isCancellation: Bool {
        if self is CancellationError { return true }
        if let url = self as? URLError, url.code == .cancelled { return true }
        return false
    }

    /// Fehlende Verbindung (für die Meldung «Du bist offline» bei Schreibaktionen).
    var isOffline: Bool {
        if let api = self as? APIError { return api.isConnectivity }
        if let url = self as? URLError {
            return [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost,
                    .cannotFindHost, .dataNotAllowed, .internationalRoamingOff].contains(url.code)
        }
        return false
    }

    /// Meldung für Schreibaktionen: klarer Hinweis, wenn kein Netz da ist.
    var writeMessage: String {
        isOffline
            ? "Du bist offline. Änderungen sind nur mit Verbindung zum Server möglich. Versuche es erneut, sobald du wieder online bist."
            : userMessage
    }
}
