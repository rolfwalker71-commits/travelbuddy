import Foundation

/// Uhr der App. Nur für Vorführungen und Tests verschiebbar (`-TBDemoNow hh:mm` in Debug-Builds).
enum AppClock {
    nonisolated(unsafe) static var offset: TimeInterval = 0
    static var now: Date { Date().addingTimeInterval(offset) }

    /// Setzt die Uhr so, dass «jetzt» in `zone` die gegebene Uhrzeit ist.
    static func pin(time: String, zone: TimeZone, on date: Date = Date()) {
        guard let minutes = TBDate.minutes(time) else { return }
        let cal = TBDate.calendar(in: zone)
        var c = cal.dateComponents([.year, .month, .day], from: date)
        c.hour = minutes / 60; c.minute = minutes % 60
        if let target = cal.date(from: c) { offset = target.timeIntervalSince(date) }
    }
}

extension TripEvent {
    /// Wendet einen `EventBody` lokal an (Server-Verhalten nachgebildet: gesetzte Felder ersetzen, `null` löscht).
    /// Dient dem Demo-Server und den Tests.
    func applying(_ body: EventBody) -> TripEvent {
        guard let data = try? JSONEncoder().encode(self),
              var dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return self }
        for (k, v) in body.fields {
            if v.isNull { dict.removeValue(forKey: k); continue }
            if let enc = try? JSONEncoder().encode(v), let obj = try? JSONSerialization.jsonObject(with: enc, options: [.fragmentsAllowed]) {
                dict[k] = obj
            }
        }
        // Gesperrte Felder markieren, wie der Server es tut.
        var meta = (dict["fieldsMeta"] as? [String: Any]) ?? [:]
        for k in body.fields.keys where k != "type" { meta[k] = ["source": "manual", "locked": true] }
        dict["fieldsMeta"] = meta
        guard let out = try? JSONSerialization.data(withJSONObject: dict),
              let event = try? JSONDecoder().decode(TripEvent.self, from: out) else { return self }
        return event
    }
}
