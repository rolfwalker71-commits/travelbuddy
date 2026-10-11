import Foundation
import Observation

struct EventRef: Hashable, Sendable {
    let tripID: Int
    let eventID: Int
}

/// Ziele innerhalb eines Navigationsstapels.
enum TripRoute: Hashable, Sendable {
    case trip(Int)
    case event(EventRef)
    case map(Int)
    case documents(Int)
    case participants(Int)
    case document(Int, tripID: Int)
}

/// Eintrag der Seitenleiste (iPad).
enum SidebarItem: Hashable, Sendable {
    case today
    case trip(Int)
    case ledger
    case account
}

/// Gemeinsame Navigation für iPhone (Tabs mit Stapeln) und iPad (drei Spalten).
@MainActor
@Observable
final class Router {
    enum Tab: Hashable, Sendable { case today, trips, ledger, account }

    var tab: Tab = .trips
    var tripsPath: [TripRoute] = []
    var todayPath: [TripRoute] = []
    var sidebar: SidebarItem?
    var selectedEvent: EventRef?
    var showInbox = false
    /// Aktion, die das Ereignis-Detail nach dem Öffnen ausführt (Mitteilungs-Aktion «Dokument», «Route»).
    var pendingAction: (event: EventRef, action: AppDestination.EventAction)?
    /// Reise, die auf dem iPad im Plan steht, wenn keine aus der Seitenleiste gewählt ist.
    var focusedTripID: Int?

    func open(_ destination: AppDestination, action: AppDestination.EventAction = .open, hasActiveTrip: Bool = true) {
        switch destination {
        case .today:
            if hasActiveTrip { tab = .today; sidebar = .today } else { tab = .trips; sidebar = nil }
        case .trips:
            tab = .trips; tripsPath = []; sidebar = nil
        case .account:
            tab = .account; sidebar = .account
        case .inbox:
            showInbox = true
        case .ledger:
            tab = .ledger; sidebar = .ledger
        case .trip(let id):
            tab = .trips
            tripsPath = [.trip(id)]
            sidebar = .trip(id)
            focusedTripID = id
            selectedEvent = nil
        case .event(let t, let e):
            let ref = EventRef(tripID: t, eventID: e)
            tab = .trips
            tripsPath = [.trip(t), .event(ref)]
            sidebar = .trip(t)
            focusedTripID = t
            selectedEvent = ref
            if action != .open { pendingAction = (ref, action) }
        }
    }
}

import SwiftUI

private struct NavigateKey: EnvironmentKey {
    static let defaultValue: (TripRoute) -> Void = { _ in }
}

extension EnvironmentValues {
    /// Öffnet ein Ziel im jeweils passenden Navigationsbereich (iPhone: Stapel, iPad: Spalten).
    var navigate: (TripRoute) -> Void {
        get { self[NavigateKey.self] }
        set { self[NavigateKey.self] = newValue }
    }
}
