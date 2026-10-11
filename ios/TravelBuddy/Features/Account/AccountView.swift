import SwiftUI

/// Konto und Einstellungen: Person, Server, Mitteilungen je Art, Geräte, Passwort, Hilfe, Version.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(TravelStore.self) private var store
    @State private var confirmLogout = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Name") { Text(store.user.displayName).tbText(16, weight: .semibold) }
                LabeledContent("Benutzername") { Text(store.user.username).tbMono(15, weight: .medium) }
                if let mail = store.user.email { LabeledContent("E-Mail") { Text(mail).tbText(16) } }
                if store.user.isAdmin { LabeledContent("Rolle") { Text("Administrator").tbText(16) } }
            }.tbRow()

            Section {
                LabeledContent("Adresse") { Text(app.serverURLText).tbMono(13, weight: .regular).textSelection(.enabled).multilineTextAlignment(.trailing) }
                LabeledContent("Dieses Gerät") { Text(DeviceInfo.name).tbText(16) }
                if store.isOffline { Label("Offline: Anzeige aus dem Zwischenspeicher", systemImage: "icloud.slash").tbText(14, color: Palette.mute) }
            } header: { TBLabel("Server") }.tbRow()

            NotificationSettingsSection()

            Section {
                NavigationLink { DevicesView() } label: { Label("Geräte", systemImage: "iphone").tbText(16) }.touchTarget()
                NavigationLink { ChangePasswordView() } label: { Label("Passwort ändern", systemImage: "key").tbText(16) }.touchTarget()
                NavigationLink { HelpListView() } label: { Label("Hilfe", systemImage: "questionmark.circle").tbText(16) }.touchTarget()
            } header: { TBLabel("Sicherheit und Hilfe") }.tbRow()

            Section {
                Button("Abmelden", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmLogout = true }
                    .font(TB.Font.text(17, weight: .semibold)).touchTarget()
            } footer: {
                Text("Beim Abmelden wird das Token dieses Geräts auf dem Server widerrufen und aus dem Schlüsselbund gelöscht. Der Zwischenspeicher wird geleert.")
                    .tbText(12, color: Palette.mute)
            }.tbRow()

            Section {
                VersionFooter()
            }
            .listRowBackground(Color.clear)
        }
        .tbList()
        .navigationTitle("Konto")
        .confirmationDialog("Abmelden?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Abmelden", role: .destructive) { Task { await app.logout() } }
            Button("Abbrechen", role: .cancel) {}
        }
        .task { await app.loadServerVersion() }
    }
}

/// «TravelBuddy 0.1.0 (Build 1) · Server 0.1.0 · Stand 11.10.2026 14:30», mit Hinweis bei abweichender Hauptzahl.
struct VersionFooter: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let line = VersionLine.text(appVersion: DeviceInfo.appVersion, build: DeviceInfo.build, server: app.serverVersion)
        let mismatch = VersionLine.mismatch(app: DeviceInfo.appVersion, server: app.serverVersion?.version)
        VStack(spacing: 8) {
            Text(line).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute).multilineTextAlignment(.center)
                .textSelection(.enabled)
                .accessibilityLabel(line)
            if mismatch {
                InlineMessage(text: "App und Server haben unterschiedliche Hauptversionen (App \(DeviceInfo.appVersion), Server \(app.serverVersion?.version ?? "?")). Bitte die App oder den Server aktualisieren.", style: .warning)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

struct NotificationSettingsSection: View {
    @Environment(TravelStore.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var push = PushService.shared
    @State private var prefs = NotificationPrefs.allOn
    @State private var loaded = false
    @State private var errorMessage: String?

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { push.isActive }, set: { on in Task { if on { await push.enable() } else { await push.disable() } } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Mitteilungen auf diesem Gerät").tbText(16)
                    Text(statusText).tbText(12, color: Palette.mute)
                }
            }
            .tint(Palette.accent)
            if push.permission == .denied {
                Button("Systemeinstellungen öffnen") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
            }
            if let m = push.lastError ?? errorMessage { InlineMessage(text: m, style: .warning) }
            ForEach(TripNotificationKind.allCases) { kind in
                Toggle(isOn: Binding(get: { prefs.isOn(kind) }, set: { v in Task { await set(kind, v) } })) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kind.title).tbText(16)
                            Text(kind.detail).tbText(12, color: Palette.mute)
                        }
                    } icon: { Image(systemName: kind.symbol).foregroundStyle(Palette.mute) }
                }
                .tint(Palette.accent)
                .disabled(!loaded)
            }
        } header: { TBLabel("Mitteilungen") }
        .tbRow()
        .task {
            await push.refreshPermission()
            if let p = try? await store.api.notificationPrefs() { prefs = p; loaded = true }
        }
    }

    private var statusText: String {
        switch push.permission {
        case .allowed: push.isEnabled ? "Eingeschaltet" : "Ausgeschaltet"
        case .denied: "In den Systemeinstellungen ausgeschaltet"
        case .notDetermined, .unknown: "Noch nicht erlaubt"
        }
    }

    private func set(_ kind: TripNotificationKind, _ on: Bool) async {
        var next = prefs
        next.set(kind, on)
        let old = prefs
        prefs = next
        do {
            prefs = try await store.api.updateNotificationPrefs(NotificationPrefsPatch(fields: [next.key(for: kind): .bool(on)]))
            errorMessage = nil
        } catch {
            prefs = old
            errorMessage = error.writeMessage
        }
    }
}

struct DevicesView: View {
    @Environment(TravelStore.self) private var store
    @State private var devices: [UserDevice] = []
    @State private var state: LoadState = .loading
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage { InlineMessage(text: errorMessage).listRowBackground(Color.clear) }
            if case .failed(let m) = state {
                StateMessage(title: "Geräte nicht verfügbar", message: m, actionTitle: "Wiederholen") { Task { await load() } }.listRowBackground(Color.clear)
            }
            ForEach(DeviceOrdering.sorted(devices)) { d in
                HStack(spacing: 12) {
                    Image(systemName: d.symbol).font(.system(size: 22)).frame(width: 32).foregroundStyle(Palette.mute)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(d.displayName).tbText(16, weight: .semibold)
                            if d.current { TBChip(text: "Dieses Gerät", tint: Palette.accent) }
                        }
                        Text(d.activityLine()).tbText(13, color: Palette.mute)
                        if d.push { Label("Mitteilungen", systemImage: "bell").labelStyle(.titleAndIcon).tbText(12, color: Palette.mute) }
                    }
                    Spacer()
                }
                .swipeActions {
                    if !d.current { Button("Abmelden", role: .destructive) { Task { await revoke(d) } } }
                }
            }
        }
        .tbList()
        .navigationTitle("Geräte")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { devices = try await store.api.devices(); state = .loaded } catch { if !error.isCancellation { state = .failed(error.userMessage) } }
    }

    private func revoke(_ d: UserDevice) async {
        do { try await store.api.revokeDevice(id: d.id); await load() } catch { errorMessage = error.writeMessage }
    }
}

struct ChangePasswordView: View {
    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var done = false

    var body: some View {
        let problems = PasswordPolicy.problems(current: current, new: new, confirmation: confirm)
        Form {
            Section {
                SecureField("Aktuelles Passwort", text: $current).textContentType(.password)
                SecureField("Neues Passwort", text: $new).textContentType(.newPassword)
                SecureField("Neues Passwort wiederholen", text: $confirm).textContentType(.newPassword)
            }.font(TB.Font.text(17)).tbRow()
            if !problems.isEmpty && !(new.isEmpty && confirm.isEmpty) {
                Section { ForEach(problems, id: \.message) { InlineMessage(text: $0.message, style: .warning) } }.listRowBackground(Color.clear)
            }
            if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
            if done { Section { InlineMessage(text: "Das Passwort wurde geändert.", style: .info) }.listRowBackground(Color.clear) }
            Section {
                Button { Task { await save() } } label: { Text(busy ? "Wird gespeichert …" : "Passwort ändern").frame(maxWidth: .infinity) }
                    .buttonStyle(.tbPrimary).disabled(!problems.isEmpty || busy)
            }.listRowBackground(Color.clear)
        }
        .tbList()
        .navigationTitle("Passwort ändern")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func save() async {
        busy = true; errorMessage = nil; defer { busy = false }
        do {
            try await store.api.changePassword(current: current, new: new)
            current = ""; new = ""; confirm = ""; done = true
        } catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}

struct HelpListView: View {
    var body: some View {
        let cards = IllustrationCatalog.bundledHelpCards()
        ScrollView {
            LazyVStack(spacing: 14) {
                if cards.isEmpty {
                    IllustrationCard(key: "heute", height: 150)
                    StateMessage(title: "Hilfe folgt", systemImage: "questionmark.circle",
                                 message: "Die Hilfekarten werden mit der nächsten Version der Illustrationen geliefert.")
                }
                ForEach(cards) { HelpCard(card: $0) }
            }
            .padding(16).frame(maxWidth: 700).frame(maxWidth: .infinity)
        }
        .tbScreen()
        .navigationTitle("Hilfe")
        .navigationBarTitleDisplayMode(.inline)
    }
}
