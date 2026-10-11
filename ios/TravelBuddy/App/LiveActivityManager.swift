import ActivityKit
import Foundation
import Observation
import OSLog

/// Baut aus dem Heute-Stand den Inhalt der Live Activity (reine Logik, testbar).
/// Die Darstellung (Widget-Seite) gehört `ios-ext`; Felder: `ios/Shared/TravelActivityAttributes.swift`.
enum LiveActivityContentBuilder {
    struct Result {
        var attributes: TravelActivityAttributes
        var state: TravelActivityAttributes.ContentState
        var kind: TravelActivityAttributes.Kind
        var eventID: Int?
    }

    static func make(plan: TodayPlan, catalog: EventCatalog, participantId: Int?, now: Date) -> Result? {
        guard let trip = plan.trip else { return nil }
        let nextEntry = plan.next ?? plan.entries.first
        let ongoing = plan.ongoing.first
        guard let entry = nextEntry ?? ongoing else { return nil }
        let e = entry.event
        let type = catalog.typeOrFallback(for: e.type)
        let remaining = entry.instant.map { $0.timeIntervalSince(now) }

        // Überschrift: «Abflug ZRH → BCN», sonst «Check-out Hotel Negresco».
        let label = entry.label ?? (entry.role == .end ? type.endLabel : type.startLabel)
        let route: String? = {
            if let a = e.detail("departureAirport"), let b = e.detail("arrivalAirport") { return "\(a) → \(b)" }
            if let a = e.detail("originPlace"), let b = e.detail("destinationPlace") { return "\(a) → \(b)" }
            return nil
        }()
        let headline = [label, route ?? e.title].filter { !$0.isEmpty }.joined(separator: " ")

        let facts = EventFacts.big(for: e, catalog: catalog, participantId: participantId, limit: 3)
        var parts: [String] = []
        for f in facts {
            switch f.key {
            case "departureGate": parts.append("Gate \(f.value)")
            case "seat": parts.append("Sitz \(f.value)")
            case "cabin": parts.append("Kabine \(f.value)")
            case "departureTerminal", "terminal": parts.append("Terminal \(f.value)")
            case "departurePlatform": parts.append("Gleis \(f.value)")
            case "accessCode": parts.append("Code \(f.value)")
            default: parts.append(f.value)
            }
        }
        let detail = parts.isEmpty ? e.location : parts.joined(separator: " · ")

        var stage: TravelActivityAttributes.Stage = .generic
        var kind: TravelActivityAttributes.Kind = .day
        if e.type == "Flug", let remaining {
            if remaining < 0 { stage = .underway }
            else if remaining < 3600 { stage = .boarding; kind = .flight }
            else if remaining < 3 * 3600 { stage = .checkIn; kind = .flight }
            else if remaining < 24 * 3600 { stage = .upcoming; kind = .flight }
        } else if ["Hotel", "Unterkunft"].contains(e.type) {
            stage = entry.role == .end ? .atStay : .upcoming
            if entry.role == .start, let remaining, remaining < 3 * 3600 { kind = .checkin; stage = .checkIn }
        } else if ongoing != nil, nextEntry == nil {
            stage = .atStay
        }

        let following = plan.entries.drop { $0.id != entry.id }.dropFirst().first(where: { $0.instant != nil })
        let state = TravelActivityAttributes.ContentState(
            headline: headline,
            detail: detail,
            icon: type.icon,
            colorKey: type.color,
            stage: stage,
            milestoneLabel: label,
            milestoneAt: entry.instant?.timeIntervalSince1970,
            progress: entry.instant == nil ? nil : plan.ringProgress(at: now),
            nextHeadline: following.map { $0.event.title },
            nextAt: following?.instant?.timeIntervalSince1970,
            updatedAt: now.timeIntervalSince1970)
        let eventID: Int? = kind == .day ? nil : e.id
        let link = kind == .day ? AppDestination.today.url : AppDestination.event(tripID: trip.id, eventID: e.id).url
        let attributes = TravelActivityAttributes(tripId: trip.id, tripTitle: trip.title, kind: kind, eventId: eventID,
                                                  deepLink: link.absoluteString)
        return Result(attributes: attributes, state: state, kind: kind, eventID: eventID)
    }
}

/// Lebenszyklus der Live Activity: startet, aktualisiert und beendet `Activity<TravelActivityAttributes>`
/// aus dem Heute-Modus und meldet Push-Token und Push-to-Start-Token am Server.
@MainActor
@Observable
final class LiveActivityManager {
    static let shared = LiveActivityManager()
    private static let log = Logger(subsystem: "ch.rolfwalker.travelbuddy", category: "liveactivity")

    private var api: (any TravelAPI)?
    private var observers: [Task<Void, Never>] = []
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private(set) var currentActivityID: String?

    var areActivitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func attach(api: any TravelAPI) {
        detach(endActivities: false)
        self.api = api
        // Push-to-Start-Token: der Server kann die Activity selbst starten.
        observers.append(Task { [weak self] in
            for await data in Activity<TravelActivityAttributes>.pushToStartTokenUpdates {
                let hex = PushToken.hex(from: data)
                await MainActor.run { PushService.shared.setPushToStartToken(hex) }
                _ = self
            }
        })
        // Per Push gestartete (oder bei einem früheren Start übrig gebliebene) Activities übernehmen.
        observers.append(Task { [weak self] in
            for await activity in Activity<TravelActivityAttributes>.activityUpdates {
                await self?.observe(activity)
            }
        })
        for activity in Activity<TravelActivityAttributes>.activities { observe(activity) }
    }

    func detach(endActivities: Bool) {
        observers.forEach { $0.cancel() }
        observers = []
        tokenTasks.values.forEach { $0.cancel() }
        tokenTasks = [:]
        if endActivities { Task { await endAll() } }
        api = nil
    }

    // MARK: Abgleich mit dem Heute-Stand

    /// Startet, aktualisiert oder beendet die Activity passend zum Heute-Stand. Ohne aktive Reise oder
    /// ohne Eintrag wird beendet.
    func sync(plan: TodayPlan?, catalog: EventCatalog, participantId: Int?, now: Date = AppClock.now) async {
        guard areActivitiesEnabled else { return }
        guard let plan, !plan.isOffline || plan.trip != nil,
              let built = LiveActivityContentBuilder.make(plan: plan, catalog: catalog, participantId: participantId, now: now) else {
            await endAll()
            return
        }
        let existing = Activity<TravelActivityAttributes>.activities
        let content = ActivityContent(state: built.state, staleDate: now.addingTimeInterval(6 * 3600))
        if let same = existing.first(where: { $0.attributes.tripId == built.attributes.tripId && $0.attributes.kind == built.kind
            && $0.attributes.eventId == built.eventID }) {
            await same.update(content)
            // Übrige Activities derselben App beenden (nur eine gleichzeitig).
            for other in existing where other.id != same.id { await end(other) }
            return
        }
        for other in existing { await end(other) }
        do {
            let activity = try Activity.request(attributes: built.attributes, content: content, pushType: .token)
            currentActivityID = activity.id
            observe(activity, tripID: built.attributes.tripId)
        } catch {
            Self.log.error("Live Activity nicht gestartet: \(error.localizedDescription, privacy: .public)")
        }
    }

    func endAll() async {
        for activity in Activity<TravelActivityAttributes>.activities { await end(activity) }
        currentActivityID = nil
    }

    // MARK: Intern

    private func end(_ activity: Activity<TravelActivityAttributes>) async {
        let id = activity.id
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
        await activity.end(nil, dismissalPolicy: .immediate)
        if let api { try? await api.unregisterLiveActivity(id: id) }
    }

    /// Verfolgt das Push-Token einer Activity und meldet jede Änderung am Server.
    private func observe(_ activity: Activity<TravelActivityAttributes>, tripID: Int? = nil) {
        let id = activity.id
        guard tokenTasks[id] == nil else { return }
        currentActivityID = id
        let attrs = activity.attributes
        tokenTasks[id] = Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                guard let api = await self?.api else { continue }
                let reg = LiveActivityRegistration(pushToken: PushToken.hex(from: data), tripId: tripID ?? attrs.tripId,
                                                   kind: attrs.kind.rawValue, eventId: attrs.eventId)
                try? await api.registerLiveActivity(id: id, reg)
            }
        }
        // Beendet das System die Activity (Zeitlimit, Nutzer), räumt der Server auf.
        Task { [weak self] in
            for await state in activity.activityStateUpdates {
                if state == .ended || state == .dismissed {
                    await self?.finished(id: id)
                    break
                }
            }
        }
    }

    private func finished(id: String) async {
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
        if currentActivityID == id { currentActivityID = nil }
        if let api { try? await api.unregisterLiveActivity(id: id) }
    }
}
