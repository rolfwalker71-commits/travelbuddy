import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var serverURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var isBusy = false
    @State private var errorMessage: String?
    @FocusState private var focus: Field?

    private enum Field { case server, username, password }

    private var canSubmit: Bool {
        !isBusy && !serverURL.trimmingCharacters(in: .whitespaces).isEmpty
            && !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                form.frame(maxWidth: 460)
            }
            .padding(.horizontal, 20).padding(.vertical, 36)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .tbScreen()
        .onAppear { if serverURL.isEmpty { serverURL = app.serverURLText } }
        #if DEBUG
        .task { await debugAutoLogin() }
        #endif
    }

    private var header: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.accent)
                Image(systemName: "ticket.fill").font(.system(size: 38, weight: .semibold)).foregroundStyle(Palette.onAccent)
            }
            .frame(width: 84, height: 84)
            .accessibilityHidden(true)
            Text("TravelBuddy").tbTitle(34, weight: .bold, relativeTo: .largeTitle)
            Text("Reisen planen, Tickets zur Hand, Kasse im Griff.").tbText(16, color: Palette.mute).multilineTextAlignment(.center)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let notice = app.notice { InlineMessage(text: notice, style: .warning) }
            field("Server") {
                TextField("https://travelbuddy.example.ch", text: $serverURL)
                    .autocorrectionDisabled().focused($focus, equals: .server).submitLabel(.next).onSubmit { focus = .username }
                    .keyboardType(.URL).textInputAutocapitalization(.never).textContentType(.URL)
            }
            field("Benutzername") {
                TextField("Benutzername", text: $username)
                    .autocorrectionDisabled().focused($focus, equals: .username).submitLabel(.next).onSubmit { focus = .password }
                    .textInputAutocapitalization(.never).textContentType(.username)
            }
            field("Passwort") {
                SecureField("Passwort", text: $password)
                    .focused($focus, equals: .password).submitLabel(.go).onSubmit { Task { await submit() } }
                    .textContentType(.password)
            }
            if let errorMessage { InlineMessage(text: errorMessage) }
            Button { Task { await submit() } } label: {
                HStack {
                    if isBusy { ProgressView().controlSize(.small).tint(Palette.onAccent) }
                    Text(isBusy ? "Anmelden …" : "Anmelden")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.tbPrimary)
            .disabled(!canSubmit)
            .keyboardShortcut(.defaultAction)
            Text("Dein Passwort wird nicht gespeichert. Nach der Anmeldung merkt sich dieses Gerät nur ein widerrufbares Token im Schlüsselbund.")
                .tbText(12, relativeTo: .footnote, color: Palette.mute)
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TBLabel(label, size: 12)
            content()
                .font(TB.Font.text(17))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 12).frame(minHeight: 48)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.fieldRadius))
                .overlay(RoundedRectangle(cornerRadius: TB.Metric.fieldRadius).strokeBorder(Palette.line))
        }
    }

    #if DEBUG
    /// Nur Debug-Builds: Anmeldung aus der Prozess-Umgebung (`TB_AUTOLOGIN_USER`/`_PASSWORD`/`_SERVER`) für Testläufe.
    private func debugAutoLogin() async {
        let env = ProcessInfo.processInfo.environment
        guard let user = env["TB_AUTOLOGIN_USER"], let pass = env["TB_AUTOLOGIN_PASSWORD"] else { return }
        if let server = env["TB_AUTOLOGIN_SERVER"] { serverURL = server }
        username = user; password = pass
        await submit()
    }
    #endif

    private func submit() async {
        guard canSubmit else { return }
        isBusy = true; errorMessage = nil; defer { isBusy = false }
        do {
            try await app.login(serverURLText: serverURL, username: username, password: password)
            password = ""
        } catch {
            if error.isCancellation { return }
            errorMessage = error.userMessage
        }
    }
}
