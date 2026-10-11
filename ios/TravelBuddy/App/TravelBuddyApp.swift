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
        if args.contains("-TBDemo") {
            if let i = args.firstIndex(of: "-TBDemoNow"), args.indices.contains(i + 1) {
                AppClock.pin(time: args[i + 1], zone: TripClock.zone("Europe/Madrid") ?? .current)
            }
            await app.startDemo(now: AppClock.now)
            if let i = args.firstIndex(of: "-TBOpen"), args.indices.contains(i + 1), let url = URL(string: args[i + 1]),
               let parsed = AppDestination.parse(url: url) {
                try? await Task.sleep(nanoseconds: 600_000_000)
                DeepLinkInbox.shared.submit(parsed.destination, action: parsed.action)
            }
            return
        }
        #endif
        await app.restore()
    }
}
