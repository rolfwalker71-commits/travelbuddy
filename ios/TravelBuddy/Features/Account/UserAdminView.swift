import SwiftUI

/// Benutzer verwalten (nur Administratoren): anlegen mit Benutzername und Passwort, Passwort neu setzen, löschen.
struct UserAdminView: View {
    @Environment(TravelStore.self) private var store
    @State private var users: [ManagedUser] = []
    @State private var state: LoadState = .idle
    @State private var showCreate = false
    @State private var resetTarget: ManagedUser?
    @State private var deleteTarget: ManagedUser?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
            Section {
                ForEach(users) { u in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(u.displayName).tbText(16, weight: .semibold)
                        Text(u.username + (u.isAdmin ? " · Administrator" : "") + (u.active ? "" : " · deaktiviert"))
                            .tbMono(13, weight: .regular)
                    }
                    .touchTarget()
                    .swipeActions(edge: .trailing) {
                        if u.id != store.user.id {
                            Button("Löschen", systemImage: "trash", role: .destructive) { deleteTarget = u }
                        }
                        Button("Passwort", systemImage: "key") { resetTarget = u }.tint(Palette.accent)
                    }
                    .contextMenu {
                        Button("Passwort zurücksetzen", systemImage: "key") { resetTarget = u }
                        if u.id != store.user.id {
                            Button("Löschen", systemImage: "trash", role: .destructive) { deleteTarget = u }
                        }
                    }
                }
            } footer: {
                Text("Wische eine Zeile nach links, um das Passwort zu ändern oder das Konto zu löschen. Das eigene Konto kann nicht gelöscht werden.")
                    .tbText(12, color: Palette.mute)
            }.tbRow()
        }
        .tbList()
        .navigationTitle("Benutzer")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }.accessibilityLabel("Benutzer anlegen")
            }
        }
        .overlay { if state == .loading && users.isEmpty { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showCreate) {
            UserCreateSheet { name, password in
                _ = try await store.api.createUser(username: name, displayName: name, password: password)
                await load()
            }
        }
        .sheet(item: $resetTarget) { u in
            UserPasswordSheet(user: u) { password in
                try await store.api.setUserPassword(id: u.id, password: password)
            }
        }
        .confirmationDialog("«\(deleteTarget?.displayName ?? "")» löschen?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
                            titleVisibility: .visible) {
            Button("Endgültig löschen", role: .destructive) {
                if let u = deleteTarget { Task { await remove(u) } }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Das Konto und seine Geräte werden gelöscht. Teilnehmer in Reisen und Abrechnungen bleiben als Gäste erhalten.")
        }
    }

    private func load() async {
        state = .loading
        do { users = try await store.api.managedUsers(); state = .loaded; errorMessage = nil }
        catch { if !error.isCancellation { state = .failed(error.userMessage); errorMessage = error.userMessage } }
    }

    private func remove(_ u: ManagedUser) async {
        do { try await store.api.deleteUser(id: u.id); await load() } catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}

private struct UserCreateSheet: View {
    let onCreate: (String, String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var name: String { username.trimmingCharacters(in: .whitespaces) }
    private var valid: Bool { UsernamePolicy.isValid(name) && password.count >= PasswordPolicy.minLength && password.count <= PasswordPolicy.maxLength }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Benutzername", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Passwort (mind. \(PasswordPolicy.minLength) Zeichen)", text: $password).textContentType(.newPassword)
                } footer: {
                    Text("Der Benutzername erlaubt Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.").tbText(12, color: Palette.mute)
                }.font(TB.Font.text(17)).tbRow()
                if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
            }
            .tbList()
            .navigationTitle("Benutzer anlegen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "…" : "Anlegen") { Task { await save() } }.disabled(!valid || busy)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        busy = true; errorMessage = nil; defer { busy = false }
        do { try await onCreate(name, password); dismiss() } catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}

private struct UserPasswordSheet: View {
    let user: ManagedUser
    let onSave: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var valid: Bool { password.count >= PasswordPolicy.minLength && password.count <= PasswordPolicy.maxLength }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Neues Passwort", text: $password).textContentType(.newPassword)
                } footer: {
                    Text("Mindestens \(PasswordPolicy.minLength) Zeichen. Alle Geräte von \(user.displayName) werden abgemeldet.").tbText(12, color: Palette.mute)
                }.font(TB.Font.text(17)).tbRow()
                if let errorMessage { Section { InlineMessage(text: errorMessage) }.listRowBackground(Color.clear) }
            }
            .tbList()
            .navigationTitle("Passwort für \(user.username)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "…" : "Speichern") { Task { await save() } }.disabled(!valid || busy)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        busy = true; errorMessage = nil; defer { busy = false }
        do { try await onSave(password); dismiss() } catch { if !error.isCancellation { errorMessage = error.writeMessage } }
    }
}
