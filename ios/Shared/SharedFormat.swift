import Foundation

/// Anzeige-Formate für alle Erweiterungen (Vertrag: Datum `dd.mm.yyyy`, Zeit `hh:mm` 24 h, Zahlen de-CH).
/// Abhängigkeitsfrei und ohne Locale-Abhängigkeit: Die Ausgabe ist auf jedem Gerät identisch.
/// Speicher-/API-Formate bleiben ISO (`YYYY-MM-DD`, `HH:mm`, UTC-Zeitstempel).
enum SharedFormat {
    static let weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]
    static let weekdaysShort = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

    // MARK: Zerlegen

    /// `2026-10-25` (auch mit Zeitanteil) → Jahr, Monat, Tag.
    static func ymd(_ iso: String?) -> (y: Int, m: Int, d: Int)? {
        guard let iso, iso.count >= 10 else { return nil }
        let parts = iso.prefix(10).split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d) else { return nil }
        return (y, m, d)
    }

    /// `17:00`, `7:05`, `17:00:30` → `(17, 0)`.
    static func hm(_ value: String?) -> (h: Int, m: Int)? {
        guard let value else { return nil }
        let parts = value.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]), (0...23).contains(h), (0...59).contains(m)
        else { return nil }
        return (h, m)
    }

    static func timeZone(_ id: String?) -> TimeZone {
        if let id, !id.isEmpty, let tz = TimeZone(identifier: id) { return tz }
        return .current
    }

    static func calendar(_ tz: TimeZone = .current) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        cal.locale = Locale(identifier: "de_CH")
        cal.firstWeekday = 2
        return cal
    }

    // MARK: ISO-Daten und -Zeiten → Anzeige

    /// `25.10.2026`; leer bei ungültiger Eingabe.
    static func date(_ iso: String?) -> String {
        guard let p = ymd(iso) else { return "" }
        return String(format: "%02d.%02d.%04d", p.d, p.m, p.y)
    }

    /// `Sonntag`
    static func weekday(_ iso: String?) -> String {
        guard let p = ymd(iso), let day = day(p) else { return "" }
        return weekdays[calendar(TimeZone(secondsFromGMT: 0)!).component(.weekday, from: day) - 1]
    }

    /// `So`
    static func weekdayShort(_ iso: String?) -> String {
        guard let p = ymd(iso), let day = day(p) else { return "" }
        return weekdaysShort[calendar(TimeZone(secondsFromGMT: 0)!).component(.weekday, from: day) - 1]
    }

    /// `Sonntag, 25.10.2026`
    static func weekdayDate(_ iso: String?) -> String {
        let d = date(iso)
        guard !d.isEmpty else { return "" }
        return "\(weekday(iso)), \(d)"
    }

    /// `So 25.10.2026` (Wochentag-Kürzel davor ist erlaubt, das Datum selbst nie verkürzt).
    static func weekdayShortDate(_ iso: String?) -> String {
        let d = date(iso)
        guard !d.isEmpty else { return "" }
        return "\(weekdayShort(iso)) \(d)"
    }

    /// `HH:mm` normalisiert; `nil` bei fehlender/ungültiger Zeit.
    static func time(_ hhmm: String?) -> String? {
        guard let p = hm(hhmm) else { return nil }
        return String(format: "%02d:%02d", p.h, p.m)
    }

    /// `23.10.2026–20.11.2026`: beide Daten immer vollständig.
    static func range(start: String?, end: String?) -> String {
        let s = date(start), e = date(end)
        if s.isEmpty { return e }
        if e.isEmpty || e == s { return s }
        return "\(s)–\(e)"
    }

    /// Zwei Zeilen für schmale Flächen: `23.10.2026 –` / `20.11.2026`.
    static func rangeStacked(start: String?, end: String?) -> String {
        let s = date(start), e = date(end)
        if s.isEmpty || e.isEmpty || e == s { return range(start: start, end: end) }
        return "\(s) –\n\(e)"
    }

    // MARK: Date → Anzeige

    static func time(_ date: Date, in tz: TimeZone = .current) -> String {
        let c = calendar(tz).dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    static func date(_ date: Date, in tz: TimeZone = .current) -> String {
        let c = calendar(tz).dateComponents([.year, .month, .day], from: date)
        return String(format: "%02d.%02d.%04d", c.day ?? 1, c.month ?? 1, c.year ?? 1970)
    }

    /// `25.10.2026 17:00`
    static func dateTime(_ date: Date, in tz: TimeZone = .current) -> String {
        "\(Self.date(date, in: tz)) \(time(date, in: tz))"
    }

    /// `YYYY-MM-DD` des lokalen Tags.
    static func isoDay(_ date: Date, in tz: TimeZone = .current) -> String {
        let c = calendar(tz).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// Zeitpunkt aus lokalem Datum, Uhrzeit und Zone. `nil` ohne gültige Zeit.
    static func moment(date iso: String?, time hhmm: String?, tz: TimeZone) -> Date? {
        guard let p = ymd(iso), let t = hm(hhmm) else { return nil }
        var c = DateComponents()
        c.year = p.y; c.month = p.m; c.day = p.d; c.hour = t.h; c.minute = t.m
        return calendar(tz).date(from: c)
    }

    /// Beginn des lokalen Tags `iso` in `tz`.
    static func startOfDay(_ iso: String?, tz: TimeZone) -> Date? {
        guard let p = ymd(iso) else { return nil }
        var c = DateComponents()
        c.year = p.y; c.month = p.m; c.day = p.d
        return calendar(tz).date(from: c)
    }

    /// Ganze Tage von `from` bis `to` (beide `YYYY-MM-DD`); negativ, wenn `to` früher liegt.
    static func daysBetween(_ from: String?, _ to: String?) -> Int? {
        guard let a = ymd(from), let b = ymd(to), let da = day(a), let db = day(b) else { return nil }
        return calendar(TimeZone(secondsFromGMT: 0)!).dateComponents([.day], from: da, to: db).day
    }

    private static func day(_ p: (y: Int, m: Int, d: Int)) -> Date? {
        var c = DateComponents()
        c.year = p.y; c.month = p.m; c.day = p.d; c.hour = 12
        return calendar(TimeZone(secondsFromGMT: 0)!).date(from: c)
    }

    // MARK: Zahlen und Beträge (de-CH)

    /// Ganzzahl mit Tausender-Apostroph: `1’234`.
    static func integer(_ value: Int) -> String {
        let digits = String(abs(value))
        var out = ""
        for (i, ch) in digits.reversed().enumerated() {
            if i > 0, i % 3 == 0 { out.append("’") }
            out.append(ch)
        }
        return (value < 0 ? "−" : "") + String(out.reversed())
    }

    /// Betrag aus Minor Units: `1’234.50` (`decimals: false` → `1’235` gerundet).
    static func amount(minor: Int, decimals: Bool = true) -> String {
        let absolute = abs(minor)
        let sign = minor < 0 ? "−" : ""
        if !decimals {
            let whole = Int((Double(absolute) / 100).rounded())
            return sign + integer(whole)
        }
        return sign + integer(absolute / 100) + String(format: ".%02d", absolute % 100)
    }

    /// `CHF 1’234.50`, optional mit Vorzeichen `+`/`−`.
    static func money(minor: Int, currency: String?, decimals: Bool = true, showPlus: Bool = false) -> String {
        let body = amount(minor: abs(minor), decimals: decimals)
        let sign = minor < 0 ? "−" : (showPlus && minor > 0 ? "+" : "")
        if let currency, !currency.isEmpty { return "\(sign)\(currency) \(body)" }
        return sign + body
    }

    // MARK: Restzeit

    /// Statische Restzeit für Zeiten ab einem Tag: `in 3 Tagen`, `in 1 Tag 4 Std.`, sonst `nil`.
    static func longCountdown(from now: Date, to target: Date) -> String? {
        longCountdownValue(from: now, to: target).map { "in \($0)" }
    }

    /// Wert ohne «in»: `3 Tagen`, `1 Tag 4 Std.` (für Beschriftungen wie «IN»).
    static func longCountdownValue(from now: Date, to target: Date) -> String? {
        let seconds = target.timeIntervalSince(now)
        guard seconds >= 86_400 else { return nil }
        let days = Int(seconds / 86_400)
        let hours = Int(seconds.truncatingRemainder(dividingBy: 86_400) / 3_600)
        let dayText = days == 1 ? "1 Tag" : "\(days) Tagen"
        if days < 3, hours > 0 { return "\(dayText) \(hours) Std." }
        return dayText
    }
}
