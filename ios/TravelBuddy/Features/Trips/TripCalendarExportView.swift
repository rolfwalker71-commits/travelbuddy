import SwiftUI
import UniformTypeIdentifiers

/// Lädt die Kalenderdatei (ICS) vom Server und bietet sie zum Teilen oder Sichern an.
struct TripCalendarExportView: View {
    let tripID: Int
    let tripTitle: String
    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case loading
        case ready(URL, Data)
        case failed(String)
    }

    @State private var phase: Phase = .loading
    @State private var showExporter = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                switch phase {
                case .loading: ProgressView("Kalenderdatei wird erstellt …").controlSize(.large)
                case .failed(let m):
                    StateMessage(title: "Export nicht möglich", message: m, actionTitle: "Wiederholen") { Task { await load() } }
                case .ready(let url, let data): ready(url: url, data: data)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
            .tbScreen()
            .navigationTitle("Kalender exportieren")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.medium])
    }

    private func ready(url: URL, data: Data) -> some View {
        VStack(spacing: 18) {
            Image(systemName: "calendar.badge.plus").font(.system(size: 44)).foregroundStyle(Palette.accent).accessibilityHidden(true)
            VStack(spacing: 6) {
                Text(url.lastPathComponent).tbMono(15, weight: .semibold).multilineTextAlignment(.center).textSelection(.enabled)
                Text("Alle Ereignisse mit Datum von «\(tripTitle)» als Kalenderdatei (ICS).").tbText(15, color: Palette.mute).multilineTextAlignment(.center)
            }
            VStack(spacing: 10) {
                ShareLink(item: url, preview: SharePreview(url.lastPathComponent)) {
                    Label("Teilen", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }.buttonStyle(.tbPrimary)
                Button { showExporter = true } label: { Label("In Dateien sichern …", systemImage: "folder").frame(maxWidth: .infinity) }
                    .buttonStyle(.tbSecondary)
            }
            .frame(maxWidth: 360)
        }
        .fileExporter(isPresented: $showExporter, document: TripICSDocument(data: data), contentType: .calendarEvent,
                      defaultFilename: url.deletingPathExtension().lastPathComponent) { _ in }
    }

    private func load() async {
        phase = .loading
        do {
            let file = try await store.api.tripICS(tripID: tripID)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("travelbuddy-ics-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(Self.safeFilename(file.filename))
            try file.data.write(to: url, options: .atomic)
            phase = .ready(url, file.data)
        } catch {
            if error.isCancellation { return }
            phase = .failed(error.writeMessage)
        }
    }

    /// Nur der letzte Pfadbestandteil, mit `.ics`-Endung.
    static func safeFilename(_ name: String) -> String {
        var base = (name as NSString).lastPathComponent.replacingOccurrences(of: "/", with: "_")
        if base.isEmpty { base = "reise.ics" }
        if !base.lowercased().hasSuffix(".ics") { base += ".ics" }
        return base
    }
}

struct TripICSDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.calendarEvent] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
