import SwiftUI
import WidgetKit

@main
struct TravelBuddyWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NextWidget()
        TodayWidget()
        TripWidget()
        LedgerWidget()
        TravelLiveActivity()
    }
}
