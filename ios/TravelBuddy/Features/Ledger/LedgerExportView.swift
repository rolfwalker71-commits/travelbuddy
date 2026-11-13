import SwiftUI
import UniformTypeIdentifiers

/// Ausgaben-Protokoll der Reisekasse als PDF: nach Datum oder nach Person, zum Teilen (Share Sheet) oder Sichern.
struct LedgerExportView: View {
    let ledgerID: Int
    let title: String
    let members: [Member]
    @Environment(TravelStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case options
        case loading
        case ready(URL, Data)
        case failed(String)
    }

    @State private var phase: Phase = .options
    @State private var grouping: LedgerExportGrouping = .date
    /// `nil` = alle Personen.
    @State private var personID: Int?
    @State private var showExporter = false

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .options: options
                case .loading: ProgressView("PDF wird erstellt …").controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let m):
                    StateMessage(title: "Export nicht möglich", message: m, actionTitle: "Wiederholen") { Task { await load() } }
                case .ready(let url, let data): ready(url: url, data: data)
                }
            }
            .tbScreen()
            .navigationTitle("Ausgaben als PDF")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private var options: some View {
        Form {
            Section {
                Picker("Gliederung", selection: $grouping) {
                    ForEach(LedgerExportGrouping.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                if grouping == .person {
                    Picker("Person", selection: $personID) {
                        Text("Alle Personen").tag(Int?.none)
                        ForEach(members) { Text($0.displayName).tag(Int?.some($0.id)) }
                    }
                }
            } footer: {
                Text(grouping == .date
                     ? "Alle Ausgaben und Rückzahlungen von «\(title)» chronologisch, je Tag gruppiert."
                     : "Je Person: bezahlte Ausgaben, Anteile und Saldo.")
            }
            Section {
                Button { Task { await load() } } label: {
                    Label("PDF erstellen", systemImage: "doc.richtext").frame(maxWidth: .infinity)
                }
                .buttonStyle(.tbPrimary)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
    }

    private func ready(url: URL, data: Data) -> some View {
        VStack(spacing: 18) {
            Image(systemName: "doc.richtext").font(.system(size: 44)).foregroundStyle(Palette.accent).accessibilityHidden(true)
            VStack(spacing: 6) {
                Text(url.lastPathComponent).tbMono(15, weight: .semibold).multilineTextAlignment(.center).textSelection(.enabled)
                Text("Protokoll der Reisekasse «\(title)» als PDF.").tbText(15, color: Palette.mute).multilineTextAlignment(.center)
            }
            VStack(spacing: 10) {
                ShareLink(item: url, preview: SharePreview(url.lastPathComponent)) {
                    Label("Teilen", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }.buttonStyle(.tbPrimary)
                Button { showExporter = true } label: { Label("In Dateien sichern …", systemImage: "folder").frame(maxWidth: .infinity) }
                    .buttonStyle(.tbSecondary)
                Button("Andere Gliederung wählen") { phase = .options }.buttonStyle(.plain).tbText(15, color: Palette.mute)
            }
            .frame(maxWidth: 360)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .fileExporter(isPresented: $showExporter, document: LedgerPDFDocument(data: data), contentType: .pdf,
                      defaultFilename: url.deletingPathExtension().lastPathComponent) { _ in }
    }

    private func load() async {
        phase = .loading
        do {
            let file = try await store.api.ledgerExportPDF(ledgerID: ledgerID, grouping: grouping, participantID: grouping == .person ? personID : nil)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("travelbuddy-pdf-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(Self.safeFilename(file.filename))
            try file.data.write(to: url, options: .atomic)
            phase = .ready(url, file.data)
        } catch {
            if error.isCancellation { return }
            phase = .failed(error.writeMessage)
        }
    }

    /// Nur der letzte Pfadbestandteil, mit `.pdf`-Endung.
    static func safeFilename(_ name: String) -> String {
        var base = (name as NSString).lastPathComponent.replacingOccurrences(of: "/", with: "_")
        if base.isEmpty { base = "ausgaben.pdf" }
        if !base.lowercased().hasSuffix(".pdf") { base += ".pdf" }
        return base
    }
}

struct LedgerPDFDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.pdf] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
