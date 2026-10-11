import Foundation
import WidgetKit

// Datenschicht der Widgets: Cache in der App-Group lesen, `GET /v1/summary` holen (kurze Zeitlimits), Zeitleiste an den
// Ereigniszeitpunkten planen. Keine UI.

/// Aufbereiteter Datenstand einer Reise für die Darstellung zu einem beliebigen Zeitpunkt.
struct TravelSnapshot: Equatable {
    var trip: SharedSummary.Trip?
    var events: [SharedSummary.Event]       // chronologisch, nur bestätigte
    var today: SharedSummary.Today?         // vom Server, gilt für `todayDate`
    var ledger: SharedSummary.Ledger?
    var fetchedAt: Date?
    var isCached: Bool

    var zone: TimeZone { trip?.zone ?? .current }

    /// Lokaler Tag (`YYYY-MM-DD`) in der Reisezone.
    func day(at date: Date) -> String { SharedFormat.isoDay(date, in: zone) }

    func phase(at date: Date) -> String {
        guard let trip else { return "upcoming" }
        return trip.phase(on: day(at: date))
    }

    /// Tag x von y am Tag von `date`.
    func dayProgress(at date: Date) -> (index: Int, count: Int)? {
        let d = day(at: date)
        if let t = trip, let p = t.dayProgress(on: d) { return p }
        if let today, today.date == d, let i = today.dayIndex, let c = today.dayCount { return (i, c) }
        return nil
    }

    /// Das nächste Ereignis: noch bevorstehend oder vor weniger als 15 Minuten begonnen («Jetzt»).
    func nextEvent(at date: Date) -> SharedSummary.Event? {
        let grace: TimeInterval = 15 * 60
        return events.first { e in
            guard let s = e.start(fallback: zone) else { return false }
            return s >= date.addingTimeInterval(-grace)
        }
    }

    /// Ereignisse des lokalen Tages von `date` (Beginn an diesem Tag), chronologisch.
    /// Zeitlich geordnet: ohne Uhrzeit zuerst, dann nach Zeit; mehrtägige Einträge in der Mitte (`middle`) unten.
    func events(on day: String) -> [SharedSummary.Event] {
        let list = events.filter { $0.appears(on: day) }
        let regular = list.filter { !$0.isMiddle }
            .sorted { ($0.timeText ?? "00:00") < ($1.timeText ?? "00:00") }
        return regular + list.filter(\.isMiddle)
    }

    /// Heute noch nicht vergangene Ereignisse zuerst; vergangene davor werden in der Liste ausgeblendet.
    func remainingEvents(on date: Date) -> [SharedSummary.Event] {
        let d = day(at: date)
        let cutoff = date.addingTimeInterval(-60 * 60)
        return events(on: d).filter { e in
            guard let s = e.start(fallback: zone) else { return true }   // ohne Zeit: ganztägig, bleibt
            let single = e.dayRole == nil || e.dayRole == "single"
            return (single ? (e.end(fallback: zone) ?? s) : s) >= cutoff
        }
    }

    /// Anzahl noch ausstehender Ereignisse heute.
    func countToday(at date: Date) -> Int { events(on: day(at: date)).count }
}

enum TravelWidgetContent: Equatable {
    case data(TravelSnapshot)
    case signedOut
    case unavailable
}

struct TravelEntry: TimelineEntry {
    let date: Date
    let content: TravelWidgetContent
    var isPlaceholder = false
}

// MARK: - Laden

enum TravelWidgetLoader {
    /// Lädt die Daten für `tripId` (`nil` = aktive, sonst nächste Reise).
    /// Reihenfolge: Cache lesen (sofort verfügbar), Server abfragen, bei Fehler auf den Cache zurückfallen.
    static func load(tripId: Int?, needsLedger: Bool, now: Date = Date()) async -> TravelWidgetContent {
        let cached = cachedSnapshot(tripId: tripId)
        guard let api = SharedAPI(session: SharedAPI.shortSession(request: 8, resource: 14)) else {
            // Nie angemeldet: kein Cache vorhanden (ein Abmelden löscht ihn).
            return .signedOut
        }
        do {
            var snapshot = try await fetch(api: api, tripId: tripId, needsLedger: needsLedger, now: now)
            if needsLedger, snapshot.ledger == nil { snapshot.ledger = cached?.ledger }
            return .data(snapshot)
        } catch let failure as SharedAPI.Failure where failure.isAuthProblem {
            return .signedOut
        } catch {
            if let cached { return .data(cached) }
            return .unavailable
        }
    }

    /// Nur Cache (ohne Netz), z. B. für Schnappschüsse.
    static func cachedSnapshot(tripId: Int?) -> TravelSnapshot? {
        let key = cacheKey(tripId: tripId)
        guard let stored = SharedSummaryCache.load(key: key) else { return nil }
        return snapshot(from: stored.summary, tripId: tripId, fetchedAt: stored.fetchedAt, cached: true)
    }

    private static func cacheKey(tripId: Int?) -> String {
        guard let tripId else { return SharedConfig.Key.summaryJSON }
        return "\(SharedConfig.Key.summaryJSON).trip.\(tripId)"
    }

    private static func fetch(api: SharedAPI, tripId: Int?, needsLedger: Bool, now: Date) async throws -> TravelSnapshot {
        let (summary, raw) = try await api.summary(tripId: tripId)
        var chosen = summary
        var saveKey = SharedConfig.Key.summaryJSON
        var saveData = raw

        if let tripId, summary.defaultTrip?.id != tripId {
            // Gewählte Reise ist weder aktiv noch nächste: Detail holen und lokal zusammenfassen.
            let detail = try await api.tripDetail(id: tripId)
            chosen = detail.summary(now: now)
            if let data = try? JSONEncoder().encode(chosen) { saveData = data }
            saveKey = cacheKey(tripId: tripId)
        }
        SharedSummaryCache.save(saveData, key: saveKey, now: now)

        var snap = snapshot(from: chosen, tripId: tripId, fetchedAt: now, cached: false)
        if needsLedger, let ledgerId = snap.trip?.ledgerId ?? chosen.ledger?.id,
           snap.ledger == nil || snap.ledger?.id != ledgerId || snap.ledger?.balances.isEmpty == true {
            if let ledger = try? await fetchLedger(api: api, id: ledgerId) { snap.ledger = ledger }
        }
        return snap
    }

    static func snapshot(from summary: SharedSummary, tripId: Int?, fetchedAt: Date?, cached: Bool) -> TravelSnapshot {
        let trip: SharedSummary.Trip? = {
            if let tripId {
                if summary.activeTrip?.id == tripId { return summary.activeTrip }
                if summary.nextTrip?.id == tripId { return summary.nextTrip }
                return summary.activeTrip ?? summary.nextTrip
            }
            return summary.defaultTrip
        }()
        let events = summary.nextEvents
            .filter { !$0.isProposal && ($0.tripId == nil || trip == nil || $0.tripId == trip?.id) }
            .sorted { a, b in
                let ka = (a.shownDate ?? "9999-99-99", a.timeText ?? "00:00")
                let kb = (b.shownDate ?? "9999-99-99", b.timeText ?? "00:00")
                return ka < kb
            }
        let ledger = summary.ledger.map { l -> SharedSummary.Ledger in
            var l = l
            if l.id == nil { l.id = trip?.ledgerId }
            return l
        }
        return TravelSnapshot(trip: trip, events: events, today: summary.today, ledger: ledger,
                              fetchedAt: fetchedAt, isCached: cached)
    }

    /// `GET /v1/ledgers/:id` (HomeBuddy-API): `{ ledger: {id,title,baseCurrency}, myMemberId, balances: [...] }`.
    private static func fetchLedger(api: SharedAPI, id: Int) async throws -> SharedSummary.Ledger {
        struct Overview: Decodable {
            let ledger: Head
            let myMemberId: Int?
            let balances: [SharedSummary.Ledger.Balance]
            struct Head: Decodable { let id: Int?; let title: String?; let baseCurrency: String? }

            enum CodingKeys: String, CodingKey { case ledger, myMemberId, balances }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                ledger = try c.decode(Head.self, forKey: .ledger)
                myMemberId = c.tbInt(.myMemberId)
                balances = c.tbArray(.balances, of: SharedSummary.Ledger.Balance.self)
            }
        }
        let o: Overview = try await api.get("/v1/ledgers/\(id)")
        let balances = o.balances.map { b -> SharedSummary.Ledger.Balance in
            var b = b; b.isMe = (o.myMemberId != nil && b.id == o.myMemberId); return b
        }
        return SharedSummary.Ledger(
            id: o.ledger.id ?? id, title: o.ledger.title, currency: o.ledger.baseCurrency ?? "CHF",
            balanceMinor: balances.first(where: \.isMe)?.netMinor ?? 0, balances: balances, myMemberId: o.myMemberId)
    }
}

// MARK: - Zeitleiste

enum TravelTimeline {
    /// Gewünschter Abstand bis zum nächsten Abruf (das System entscheidet letztlich).
    static let refresh: TimeInterval = 30 * 60

    /// Eintragszeitpunkte: jetzt, an jedem Ereignisbeginn (und 15 Minuten danach, wenn «Jetzt» endet), kurz nach
    /// Mitternacht der Reisezone (Tag x von y wechselt) und ab Stundenwechseln, solange ein Countdown läuft.
    static func dates(now: Date, snapshot: TravelSnapshot?, horizon: TimeInterval = 36 * 3600, limit: Int = 24) -> [Date] {
        var set: Set<Date> = [now]
        guard let snapshot else { return [now] }
        let end = now.addingTimeInterval(horizon)

        for e in snapshot.events {
            guard let s = e.start(fallback: snapshot.zone) else { continue }
            for d in [s, s.addingTimeInterval(15 * 60)] where d > now && d < end { set.insert(d) }
        }
        let cal = SharedFormat.calendar(snapshot.zone)
        if let midnight = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 5),
                                       matchingPolicy: .nextTime), midnight < end {
            set.insert(midnight)
        }
        // Statische «in 3 Tagen»-Texte: an den Tagesgrenzen vor dem nächsten Ereignis neu zeichnen.
        if let next = snapshot.nextEvent(at: now), let s = next.start(fallback: snapshot.zone) {
            var k = 1
            while k <= 3 {
                let d = s.addingTimeInterval(-Double(k) * 86_400)
                if d > now && d < end { set.insert(d) }
                k += 1
            }
        }
        return Array(set.sorted().prefix(limit))
    }

    static func entries(now: Date, content: TravelWidgetContent) -> [TravelEntry] {
        switch content {
        case .data(let snapshot):
            return dates(now: now, snapshot: snapshot).map { TravelEntry(date: $0, content: content) }
        default:
            return [TravelEntry(date: now, content: content)]
        }
    }

    static func reloadDate(now: Date, content: TravelWidgetContent) -> Date {
        switch content {
        case .data: now.addingTimeInterval(refresh)
        case .unavailable: now.addingTimeInterval(15 * 60)
        case .signedOut: now.addingTimeInterval(60 * 60)
        }
    }
}
