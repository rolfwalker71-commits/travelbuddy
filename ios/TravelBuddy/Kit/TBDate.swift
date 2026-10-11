import Foundation

/// Datum `dd.mm.yyyy`, Zeit `hh:mm` (24 h) für die Anzeige; API und Speicher bleiben `YYYY-MM-DD`, `HH:mm`
/// und UTC-ISO-8601. Reine Logik ohne UI, damit sie getestet werden kann.
enum TBDate {
    // MARK: Kalender

    /// Gregorianisch in UTC: Kalendertage ohne Zeitzonen-Verschiebung.
    static let utc: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        cal.locale = Locale(identifier: "de_CH")
        return cal
    }()

    static func calendar(in zone: TimeZone) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        cal.locale = Locale(identifier: "de_CH")
        return cal
    }

    // MARK: Datum (YYYY-MM-DD)

    private static func parse(_ iso: String) -> (year: Int, month: Int, day: Int)? {
        let head = iso.prefix(10)
        let parts = head.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d) else { return nil }
        return (y, m, d)
    }

    /// Gültiges Kalenderdatum `YYYY-MM-DD` (inkl. Schaltjahr-Prüfung).
    static func isValid(_ iso: String) -> Bool { date(iso) != nil }

    /// Mittag UTC des Kalendertags (stabil gegen Zeitzonen).
    static func date(_ iso: String) -> Date? {
        guard iso.count == 10, let p = parse(iso) else { return nil }
        var c = DateComponents()
        c.year = p.year; c.month = p.month; c.day = p.day; c.hour = 12
        guard let d = utc.date(from: c) else { return nil }
        let back = utc.dateComponents([.year, .month, .day], from: d)
        return back.year == p.year && back.month == p.month && back.day == p.day ? d : nil
    }

    /// `2026-10-10` → `10.10.2026`. Unbekanntes Format wird unverändert zurückgegeben.
    static func display(_ iso: String) -> String {
        guard let p = parse(iso) else { return iso }
        return String(format: "%02d.%02d.%04d", p.day, p.month, p.year)
    }

    static let weekdayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]
    static let weekdayShort = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

    static func weekdayName(_ iso: String) -> String? {
        guard let d = date(iso) else { return nil }
        return weekdayNames[utc.component(.weekday, from: d) - 1]
    }

    static func weekdayShortName(_ iso: String) -> String? {
        guard let d = date(iso) else { return nil }
        return weekdayShort[utc.component(.weekday, from: d) - 1]
    }

    /// `Sonntag, 25.10.2026`
    static func longDay(_ iso: String) -> String {
        guard let w = weekdayName(iso) else { return display(iso) }
        return "\(w), \(display(iso))"
    }

    /// `So 25.10.2026`
    static func shortDay(_ iso: String) -> String {
        guard let w = weekdayShortName(iso) else { return display(iso) }
        return "\(w) \(display(iso))"
    }

    /// Anzahl Tage von `from` bis `to` (negativ, wenn `to` früher liegt).
    static func days(from: String, to: String) -> Int? {
        guard let a = date(from), let b = date(to) else { return nil }
        return utc.dateComponents([.day], from: a, to: b).day
    }

    static func addDays(_ n: Int, to iso: String) -> String? {
        guard let d = date(iso), let r = utc.date(byAdding: .day, value: n, to: d) else { return nil }
        return isoString(from: r, calendar: utc)
    }

    static func isoString(from date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Kalendertag eines Zeitpunkts in einer Zeitzone.
    static func isoDay(of instant: Date, in zone: TimeZone) -> String {
        isoString(from: instant, calendar: calendar(in: zone))
    }

    /// `20.12.2026 – 28.12.2026`, einzelnes Datum, «ab …», «bis …» oder `nil`.
    static func range(start: String?, end: String?) -> String? {
        switch (start, end) {
        case let (s?, e?) where s == e: return display(s)
        case let (s?, e?): return "\(display(s)) – \(display(e))"
        case let (s?, nil): return "ab \(display(s))"
        case let (nil, e?): return "bis \(display(e))"
        default: return nil
        }
    }

    // MARK: Zeit (HH:mm)

    /// `HH:mm` mit 00–23 und 00–59.
    static func isValidTime(_ text: String) -> Bool {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard text.count == 5, parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]) else { return false }
        return (0...23).contains(h) && (0...59).contains(m)
    }

    /// Minuten seit Mitternacht, `nil` bei ungültiger Zeit.
    static func minutes(_ time: String) -> Int? {
        guard isValidTime(String(time.prefix(5))) else { return nil }
        let p = time.prefix(5).split(separator: ":")
        return Int(p[0])! * 60 + Int(p[1])!
    }

    static func timeString(minutes: Int) -> String {
        let m = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    /// Dauer als Text: `2 Std. 35 Min.`
    static func duration(minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m) Min." }
        return m == 0 ? "\(h) Std." : "\(h) Std. \(m) Min."
    }

    // MARK: Zeitstempel (UTC ISO 8601)

    static func parseTimestamp(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: text) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    /// `2026-10-10T13:05:00.000Z` → `10.10.2026 15:05` (lokale Zeitzone bzw. angegebene Zone).
    static func displayDateTime(isoTimestamp: String, timeZone: TimeZone = .current) -> String {
        guard let date = parseTimestamp(isoTimestamp) else { return isoTimestamp }
        return displayDateTime(date, timeZone: timeZone)
    }

    static func displayDateTime(_ date: Date, timeZone: TimeZone = .current) -> String {
        let cal = calendar(in: timeZone)
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return String(format: "%02d.%02d.%04d %02d:%02d", c.day ?? 0, c.month ?? 0, c.year ?? 0, c.hour ?? 0, c.minute ?? 0)
    }

    /// `hh:mm` eines Zeitpunkts in einer Zone.
    static func displayTime(_ date: Date, timeZone: TimeZone = .current) -> String {
        let c = calendar(in: timeZone).dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

// MARK: - Zeitzonen und Zeitpunkte

/// Ereigniszeiten sind «Wanduhr» an einem Ort. Erst mit der Zone (`startTz`/`endTz`, sonst Reisezone)
/// werden sie zu Zeitpunkten, die sich über Zonen hinweg vergleichen lassen.
enum TripClock {
    static func zone(_ id: String?) -> TimeZone? {
        guard let id, !id.isEmpty else { return nil }
        return TimeZone(identifier: id)
    }

    /// Wanduhr (`YYYY-MM-DD`, optional `HH:mm`) in `zone` → Zeitpunkt. Ohne Zeit: Tagesbeginn (00:00).
    static func instant(date: String?, time: String?, zone: TimeZone) -> Date? {
        guard let date, TBDate.isValid(date) else { return nil }
        let p = date.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = DateComponents()
        c.year = p[0]; c.month = p[1]; c.day = p[2]
        if let time, let m = TBDate.minutes(time) { c.hour = m / 60; c.minute = m % 60 } else { c.hour = 0; c.minute = 0 }
        return TBDate.calendar(in: zone).date(from: c)
    }

    /// Kurzname der Zone für «14:05 Ortszeit Miami» (letzter Teil der IANA-ID, Unterstriche als Leerzeichen).
    static func placeName(_ zoneID: String) -> String {
        let last = zoneID.split(separator: "/").last.map(String.init) ?? zoneID
        return last.replacingOccurrences(of: "_", with: " ")
    }

    /// `14:05` oder `14:05 Ortszeit Miami`, wenn die Zone von der Reisezone abweicht.
    static func timeLabel(_ time: String, zoneID: String?, tripZoneID: String?) -> String {
        guard let zoneID, !zoneID.isEmpty, zoneID != tripZoneID else { return time }
        return "\(time) Ortszeit \(placeName(zoneID))"
    }

    /// Zonenwechsel zwischen Beginn und Ende (z. B. Flug Zürich → Miami).
    static func offsetDifferenceHours(from a: TimeZone, to b: TimeZone, at date: Date) -> Double {
        Double(b.secondsFromGMT(for: date) - a.secondsFromGMT(for: date)) / 3600
    }
}
