import SwiftUI

/// Ziele innerhalb der Navigationsstapel.
struct RouteView: View {
    let route: TripRoute

    var body: some View {
        switch route {
        case .trip(let id): PlanView(tripID: id)
        case .event(let ref): EventDetailView(ref: ref)
        case .map(let id): TripMapView(tripID: id)
        case .documents(let id): DocumentsView(tripID: id)
        case .participants(let id): ParticipantsView(tripID: id)
        case .document(let id, let tripID): DocumentDetailView(documentID: id, tripID: tripID)
        }
    }
}

/// Wurzel nach der Anmeldung: iPhone mit Tabs, iPad mit dreispaltiger Ansicht. Lädt, hält Heute und
/// Live Activity aktuell und löst Links und Mitteilungen auf.
struct MainView: View {
    let store: TravelStore

    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var router = Router()
    @State private var inbox = DeepLinkInbox.shared
    @State private var lastRefresh = Date.distantPast
    @State private var didInitialRoute = false

    var body: some View {
        Group {
            if sizeClass == .regular { SplitRoot() } else { PhoneRoot() }
        }
        .environment(router)
        .environment(store)
        .environment(\.api, store.api)
        .tint(Palette.accent)
        .sheet(isPresented: $router.showInbox) { ReviewView().environment(store).environment(\.api, store.api) }
        .task {
            await store.refreshCatalog()
            await refresh()
            routeInitial()
            consumeInbox()
        }
        .task {
            // Live Activity: Fortschritt und «Als Nächstes» regelmässig nachziehen.
            while !Task.isCancelled {
                await syncLiveActivity()
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, Date().timeIntervalSince(lastRefresh) > 30 { Task { await refresh() } }
        }
        .onChange(of: store.todayPlan) { _, _ in Task { await syncLiveActivity() } }
        .onChange(of: inbox.pending?.destination) { _, _ in consumeInbox() }
        .onOpenURL { url in
            if let parsed = AppDestination.parse(url: url) { open(parsed.destination, action: parsed.action) }
        }
    }

    private func refresh() async {
        lastRefresh = Date()
        await store.refreshAll()
    }

    private func routeInitial() {
        guard !didInitialRoute else { return }
        didInitialRoute = true
        if DeepLinkInbox.shared.pending != nil { return }
        if let active = store.activeTrip {
            router.tab = .today
            router.sidebar = .today
            router.focusedTripID = active.id
        } else {
            router.tab = .trips
            if let first = store.currentTrip { router.sidebar = .trip(first.id); router.focusedTripID = first.id }
        }
    }

    private func consumeInbox() {
        if let pending = DeepLinkInbox.shared.take() { open(pending.destination, action: pending.action) }
    }

    private func open(_ destination: AppDestination, action: AppDestination.EventAction) {
        router.open(destination, action: action, hasActiveTrip: store.activeTrip != nil)
        if case .trip(let id) = destination { Task { await store.refreshDetail(id: id) } }
        if case .event(let t, _) = destination { Task { await store.refreshDetail(id: t) } }
    }

    private func syncLiveActivity() async {
        guard !app.isDemo else { return }
        let me = store.activeTrip.flatMap { store.myParticipantID(tripID: $0.id) }
        await LiveActivityManager.shared.sync(plan: store.todayPlan, catalog: store.catalog, participantId: me)
    }
}

// MARK: - iPhone

private struct PhoneRoot: View {
    @Environment(Router.self) private var router
    @Environment(TravelStore.self) private var store

    var body: some View {
        @Bindable var router = router
        let hasActive = store.activeTrip != nil
        TabView(selection: Binding(
            get: { (router.tab == .today && !hasActive) ? .trips : router.tab },
            set: { router.tab = $0 })) {
            if hasActive {
                Tab("Heute", systemImage: "sun.max", value: Router.Tab.today) {
                    stack(path: $router.todayPath) { TodayView() }
                }
            }
            Tab("Reisen", systemImage: "suitcase", value: Router.Tab.trips) {
                stack(path: $router.tripsPath) { TripListView() }
            }
            Tab("Kasse", systemImage: "creditcard", value: Router.Tab.ledger) {
                NavigationStack { LedgerRootView() }
                    .environment(\.navigate) { _ in }
            }
            Tab("Konto", systemImage: "person.crop.circle", value: Router.Tab.account) {
                NavigationStack { AccountView() }
            }
        }
    }

    private func stack<Root: View>(path: Binding<[TripRoute]>, @ViewBuilder root: () -> Root) -> some View {
        NavigationStack(path: path) {
            root()
                .navigationDestination(for: TripRoute.self) { RouteView(route: $0) }
        }
        .environment(\.navigate) { route in path.wrappedValue.append(route) }
    }
}

// MARK: - iPad

private struct SplitRoot: View {
    @Environment(Router.self) private var router
    @Environment(TravelStore.self) private var store
    @State private var visibility: NavigationSplitViewVisibility = .all
    @State private var contentPath: [TripRoute] = []

    var body: some View {
        @Bindable var router = router
        NavigationSplitView(columnVisibility: $visibility) {
            SidebarView(selection: $router.sidebar)
        } content: {
            NavigationStack(path: $contentPath) {
                contentColumn
                    .navigationDestination(for: TripRoute.self) { route in
                        switch route {
                        case .event(let ref): Color.clear.onAppear { router.selectedEvent = ref; contentPath.removeAll { $0 == route } }
                        case .map: Color.clear.onAppear { router.selectedEvent = nil; contentPath.removeAll { $0 == route } }
                        default: RouteView(route: route)
                        }
                    }
            }
            .environment(\.navigate) { route in
                switch route {
                case .event(let ref): router.selectedEvent = ref
                case .map: router.selectedEvent = nil
                case .trip(let id): router.sidebar = .trip(id)
                default: contentPath.append(route)
                }
            }
        } detail: {
            NavigationStack {
                detailColumn
            }
            .environment(\.navigate) { route in
                switch route {
                case .event(let ref): router.selectedEvent = ref
                case .map: router.selectedEvent = nil
                case .trip(let id): router.sidebar = .trip(id)
                default: contentPath.append(route)
                }
            }
        }
        .onChange(of: router.sidebar) { _, _ in
            contentPath = []
            router.selectedEvent = nil
        }
        .task {
            if router.sidebar == nil {
                router.sidebar = store.activeTrip != nil ? .today : store.currentTrip.map { .trip($0.id) }
            }
        }
    }

    @ViewBuilder private var contentColumn: some View {
        switch router.sidebar {
        case .today: TodayView()
        case .trip(let id): PlanView(tripID: id).id(id)
        case .ledger: LedgerRootView()
        case .account: AccountView()
        case nil:
            VStack {
                IllustrationCard(key: "reise", height: 150).padding()
                StateMessage(title: "Wähle eine Reise", systemImage: "suitcase", message: "Die Reisen stehen links. Mit «+» legst du eine neue an.")
                Spacer()
            }
            .tbScreen()
        }
    }

    @ViewBuilder private var detailColumn: some View {
        if let ref = router.selectedEvent {
            EventDetailView(ref: ref).id(ref)
        } else {
            switch router.sidebar {
            case .today:
                if let trip = store.activeTrip {
                    TripMapView(tripID: trip.id, initialDay: TBDate.isoDay(of: AppClock.now, in: TripClock.zone(trip.timezone) ?? .current))
                        .id("today-\(trip.id)")
                }
            case .trip(let id):
                TripMapView(tripID: id).id("trip-\(id)")
            default:
                VStack {
                    IllustrationCard(key: "karte", height: 160).padding()
                    Text("Details und Karte erscheinen hier.").tbText(15, color: Palette.mute)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tbScreen()
            }
        }
    }
}

// MARK: - Wurzel

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .launching:
                VStack(spacing: 16) {
                    ProgressView().controlSize(.large)
                    Text("TravelBuddy startet …").tbText(16, color: Palette.mute)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tbScreen()
            case .signedOut:
                LoginView()
            case .signedIn:
                if let store = app.store { MainView(store: store).id(ObjectIdentifier(store)) }
            }
        }
        .animation(.default, value: app.phase)
        // Keine Systemschrift in eigenen Oberflächen: Barlow ist die Grundschrift.
        .font(TB.Font.text(17))
    }
}
