import Testing
import Foundation
@testable import TravelBuddy

@Suite("Datum, Zeit, Zahlen")
struct FormatTests {
    @Test func displayDate() {
        #expect(TBDate.display("2026-10-25") == "25.10.2026")
        #expect(TBDate.display("2026-01-05T10:00:00Z") == "05.01.2026")
        #expect(TBDate.display("kaputt") == "kaputt")
    }

    @Test("Keine verkürzten Datumsformen (nie «25.10.»)")
    func noShortForms() {
        let outputs = [
            TBDate.display("2026-10-25"), TBDate.longDay("2026-10-25"), TBDate.shortDay("2026-10-25"),
            TBDate.range(start: "2026-10-23", end: "2026-11-20") ?? "", TBDate.displayDateTime(Fixture.date("2026-10-25", "17:00", "Europe/Zurich"), timeZone: TimeZone(identifier: "Europe/Zurich")!),
        ]
        for o in outputs {
            #expect(o.range(of: #"\d{2}\.\d{2}\.(?!\d)"#, options: .regularExpression) == nil, "verkürzt: \(o)")
            #expect(!o.contains("Okt"))
        }
    }

    @Test func weekdays() {
        #expect(TBDate.longDay("2026-10-25") == "Sonntag, 25.10.2026")
        #expect(TBDate.shortDay("2026-10-11") == "So 11.10.2026")
    }

    @Test func rangeIsFull() {
        #expect(TBDate.range(start: "2026-10-23", end: "2026-11-20") == "23.10.2026 – 20.11.2026")
        #expect(TBDate.range(start: "2026-10-23", end: "2026-10-23") == "23.10.2026")
        #expect(TBDate.range(start: "2026-10-23", end: nil) == "ab 23.10.2026")
    }

    @Test func validity() {
        #expect(TBDate.isValid("2028-02-29"))
        #expect(!TBDate.isValid("2026-02-29"))
        #expect(!TBDate.isValid("2026-13-01"))
        #expect(TBDate.isValidTime("07:05"))
        #expect(!TBDate.isValidTime("24:00"))
        #expect(!TBDate.isValidTime("7:05"))
        #expect(TBDate.minutes("14:30") == 870)
    }

    @Test func arithmetic() {
        #expect(TBDate.days(from: "2026-10-23", to: "2026-11-20") == 28)
        #expect(TBDate.addDays(1, to: "2026-10-31") == "2026-11-01")
        #expect(TBDate.addDays(-1, to: "2026-03-01") == "2026-02-28")
    }

    @Test func dateTimeDisplay() {
        let d = Fixture.date("2026-10-11", "14:30", "Europe/Zurich")
        #expect(TBDate.displayDateTime(d, timeZone: TimeZone(identifier: "Europe/Zurich")!) == "11.10.2026 14:30")
        #expect(TBDate.displayTime(d, timeZone: TimeZone(identifier: "Europe/Zurich")!) == "14:30")
        #expect(TBDate.displayDateTime(isoTimestamp: "2026-10-11T12:30:00.000Z", timeZone: TimeZone(identifier: "Europe/Zurich")!) == "11.10.2026 14:30")
    }

    @Test func moneyDeCH() {
        #expect(Money.formatMinor(123_450, currency: "CHF") == "1\u{2019}234.50")
        #expect(Money.formatted(5_000, currency: "chf") == "CHF 50.00")
        #expect(Money.parseMinor("1’234.50", currency: "CHF") == 123_450)
        #expect(Money.parseMinor("12,5", currency: "CHF") == 1250)
        #expect(Money.parseMinor("1.005", currency: "CHF") == nil)
        #expect(Money.parseMinor("-5", currency: "CHF") == nil)
        #expect(Money.parseMinor("1000", currency: "JPY") == 1000)
    }

    @Test func versionLine() {
        let now = Fixture.date("2026-10-11", "14:30", "Europe/Zurich")
        let line = VersionLine.text(appVersion: "0.1.0", build: "1", server: ServerVersion(name: nil, version: "0.1.0", build: nil, builtAt: nil, api: 1),
                                    now: now, timeZone: TimeZone(identifier: "Europe/Zurich")!)
        #expect(line == "TravelBuddy 0.1.0 (Build 1) · Server 0.1.0 · Stand 11.10.2026 14:30")
        #expect(!VersionLine.mismatch(app: "0.1.0", server: "0.2.3"))
        #expect(VersionLine.mismatch(app: "0.1.0", server: "1.0.0"))
        #expect(!VersionLine.mismatch(app: "0.1.0", server: nil))
    }

    @Test("MARKETING_VERSION entspricht VERSION im Repo")
    func marketingVersionMatchesRepo() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let version = try String(contentsOf: root.appendingPathComponent("VERSION"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        #expect(DeviceInfo.appVersion == version)
    }
}

@Suite("Zeitzonen")
struct TimeZoneTests {
    @Test func instantsUseTheirZone() {
        let zrh = Fixture.date("2026-10-20", "10:00", "Europe/Zurich")
        let mia = Fixture.date("2026-10-20", "14:00", "America/New_York")
        // 20.10.2026: Zürich Sommerzeit (+2), Miami EDT (−4): 08:00 UTC gegen 18:00 UTC.
        #expect(mia.timeIntervalSince(zrh) == 10 * 3600)
        // Am 25.10.2026 endet in Europa die Sommerzeit: 10:00 Zürich ist 09:00 UTC.
        let after = Fixture.date("2026-10-25", "10:00", "Europe/Zurich")
        #expect(after == Date(timeIntervalSince1970: Date(timeIntervalSince1970: 0).timeIntervalSince1970 + TimeInterval(1_792_918_800)))
    }

    @Test func timeLabelOnlyWhenZoneDiffers() {
        #expect(TripClock.timeLabel("14:05", zoneID: "America/New_York", tripZoneID: "Europe/Zurich") == "14:05 Ortszeit New York")
        #expect(TripClock.timeLabel("14:05", zoneID: "Europe/Zurich", tripZoneID: "Europe/Zurich") == "14:05")
        #expect(TripClock.timeLabel("14:05", zoneID: nil, tripZoneID: "Europe/Zurich") == "14:05")
    }

    @Test func timelineSortsAcrossZones() {
        // Gleicher Kalendertag: 09:00 Miami (13:00 UTC) liegt nach 10:00 Zürich (08:00 UTC).
        let a = TripEvent(id: 1, type: "Flug", title: "A", startDate: "2026-10-25", startTime: "09:00", startTz: "America/New_York")
        let b = TripEvent(id: 2, type: "Flug", title: "B", startDate: "2026-10-25", startTime: "10:00", startTz: "Europe/Zurich")
        let sorted = TripTimeline.sort([a, b], tripZone: TimeZone(identifier: "Europe/Zurich")!)
        #expect(sorted.map(\.id) == [2, 1])
    }

    @Test func dayInTripZone() {
        // 23:30 UTC am 25.10. ist in Miami (−4) noch der 25., in Madrid (+2) schon der 26.
        let instant = Date(timeIntervalSince1970: 1_792_971_000) // 2026-10-25T23:30:00Z
        #expect(TBDate.isoDay(of: instant, in: TimeZone(identifier: "Europe/Madrid")!) == "2026-10-26")
        #expect(TBDate.isoDay(of: instant, in: TimeZone(identifier: "America/New_York")!) == "2026-10-25")
    }
}
