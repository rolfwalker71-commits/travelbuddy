import Foundation

/// Beispielzustände der Live Activity für Vorschauen und Screenshot-Läufe. Der Lebenszyklus (Start, Update, Ende) liegt in
/// der App; hier nur Daten in der Form des Vertrags (`TravelActivityAttributes.ContentState`).
enum TravelActivityPreviewData {
    typealias State = TravelActivityAttributes.ContentState

    static func attributes(_ kind: TravelActivityAttributes.Kind) -> TravelActivityAttributes {
        switch kind {
        case .flight:
            TravelActivityAttributes(tripId: 2, tripTitle: "Lissabon im Herbst", kind: .flight, eventId: 21,
                                     deepLink: "travelbuddy://event/2/21")
        case .checkin:
            TravelActivityAttributes(tripId: 1, tripTitle: "Ferien 2026", kind: .checkin, eventId: 11,
                                     deepLink: "travelbuddy://event/1/11")
        case .day:
            TravelActivityAttributes(tripId: 1, tripTitle: "Ferien 2026", kind: .day, eventId: nil,
                                     deepLink: "travelbuddy://today")
        }
    }

    private static func at(_ minutes: Double, from now: Date) -> Double {
        now.addingTimeInterval(minutes * 60).timeIntervalSince1970
    }

    static func flightCheckIn(now: Date = Date()) -> State {
        State(headline: "Check-in öffnet für ZRH → LIS", detail: "LX 2086 · Online-Check-in möglich",
              icon: "plane", colorKey: "air", stage: .checkIn, milestoneLabel: "Check-in schliesst",
              milestoneAt: at(95, from: now), progress: 0.2, nextHeadline: "Boarding Gate B42", nextAt: at(215, from: now))
    }

    static func flightBoarding(now: Date = Date()) -> State {
        State(headline: "Boarding ZRH → LIS", detail: "LX 2086 · Gate B42 · Sitz 12C", icon: "plane", colorKey: "air",
              stage: .boarding, milestoneLabel: "Boarding endet", milestoneAt: at(18, from: now), progress: 0.75,
              nextHeadline: "Abflug 07:45", nextAt: at(35, from: now))
    }

    static func flightUnderway(now: Date = Date()) -> State {
        State(headline: "Unterwegs nach Lissabon", detail: "LX 2086 · Landung 09:50 Ortszeit", icon: "plane",
              colorKey: "air", stage: .underway, milestoneLabel: "Landung", milestoneAt: at(72, from: now), progress: 0.42,
              nextHeadline: "Transfer zum Hotel", nextAt: at(150, from: now))
    }

    static func flightArrived(now: Date = Date()) -> State {
        State(headline: "Gelandet in Lissabon", detail: "Gepäckband 4 · Terminal 1", icon: "plane", colorKey: "air",
              stage: .arrived, milestoneLabel: nil, milestoneAt: nil, progress: 1,
              nextHeadline: "Check-in Hotel Avenida", nextAt: at(300, from: now))
    }

    static func atStay(now: Date = Date()) -> State {
        State(headline: "Hotel Negresco, Barcelona", detail: "Zimmer 412 · Frühstück bis 10:30", icon: "bed", colorKey: "stay",
              stage: .atStay, milestoneLabel: "Check-out", milestoneAt: at(100, from: now), progress: 0.6,
              nextHeadline: "Einschiffung Terminal Port Nou", nextAt: at(160, from: now))
    }

    static func checkinSoon(now: Date = Date()) -> State {
        State(headline: "Check-in Hotel Avenida", detail: "Ab 15:00 · Referenz AV55120", icon: "bed", colorKey: "stay",
              stage: .upcoming, milestoneLabel: "Check-in", milestoneAt: at(55, from: now), progress: nil,
              nextHeadline: nil, nextAt: nil)
    }

    static func dayGeneric(now: Date = Date()) -> State {
        State(headline: "Tag 3 von 29 · Barcelona", detail: "3 Ereignisse heute", icon: "map", colorKey: "activity",
              stage: .generic, milestoneLabel: "Einschiffung", milestoneAt: at(160, from: now), progress: 0.33,
              nextHeadline: "Abfahrt Barcelona", nextAt: at(340, from: now))
    }

    /// Alle Zustände mit Art, für Galerien und Tests.
    static func all(now: Date = Date()) -> [(name: String, attributes: TravelActivityAttributes, state: State)] {
        [
            ("Flug · Check-in", attributes(.flight), flightCheckIn(now: now)),
            ("Flug · Boarding", attributes(.flight), flightBoarding(now: now)),
            ("Flug · Unterwegs", attributes(.flight), flightUnderway(now: now)),
            ("Flug · Gelandet", attributes(.flight), flightArrived(now: now)),
            ("Unterkunft · Vor Ort", attributes(.checkin), atStay(now: now)),
            ("Check-in bald", attributes(.checkin), checkinSoon(now: now)),
            ("Tag", attributes(.day), dayGeneric(now: now)),
        ]
    }
}
