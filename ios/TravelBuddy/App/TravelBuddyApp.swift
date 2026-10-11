import SwiftUI

@main
struct TravelBuddyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(PushService.shared)
                .environment(\.locale, Locale(identifier: "de_CH"))
                .tint(Palette.accent)
                .task { await start() }
                .onOpenURL { url in
                    if let parsed = AppDestination.parse(url: url) {
                        DeepLinkInbox.shared.submit(parsed.destination, action: parsed.action)
                    }
                }
        }
    }

    private func start() async {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        func value(_ name: String) -> String? {
            guard let i = args.firstIndex(of: name), args.indices.contains(i + 1) else { return nil }
            return args[i + 1]
        }
        // Uhr für Vorführungen: -TBDemoNow hh:mm [-TBDemoDate yyyy-mm-dd] (gilt auch gegen einen echten Server).
        if let time = value("-TBDemoNow") {
            AppClock.pin(time: time, zone: TripClock.zone(value("-TBDemoZone") ?? "Europe/Zurich") ?? .current, day: value("-TBDemoDate"))
        }
        if args.contains("-TBDemo") {
            await app.startDemo(now: AppClock.now)
        } else {
            await app.restore()
        }
        if let link = value("-TBOpen"), let url = URL(string: link), let parsed = AppDestination.parse(url: url) {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            DeepLinkInbox.shared.submit(parsed.destination, action: parsed.action)
        }
        return
        #else
        await app.restore()
        #endif
    }
}
