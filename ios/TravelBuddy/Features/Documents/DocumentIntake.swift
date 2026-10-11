import PDFKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// Eingang für Dokumente: Datei-Import (PDF, Bilder), Kamera-/Dokumentenscan und Fotos. Upload mit Fortschritt
/// (`POST /v1/trips/:id/documents`), danach Verfolgung des Analysestatus bis «fertig».
@MainActor
@Observable
final class DocumentIntake {
    struct Item: Identifiable, Equatable {
        enum State: Equatable {
            case uploading(Double)
            case analyzing
            case done(AnalysisStatus)
            case failed(String)
        }
        let id = UUID()
        var name: String
        var state: State
        var documentID: Int?
    }

    var items: [Item] = []
    var showImporter = false
    var showScanner = false
    var showPhotos = false
    var photoSelection: [PhotosPickerItem] = []
    var scannerUnavailable = false

    var hasActivity: Bool { !items.isEmpty }
    var isBusy: Bool {
        items.contains { if case .uploading = $0.state { true } else if case .analyzing = $0.state { true } else { false } }
    }

    func dismiss(_ item: Item) { items.removeAll { $0.id == item.id } }
    func clearFinished() {
        items.removeAll { if case .uploading = $0.state { false } else if case .analyzing = $0.state { false } else { true } }
    }

    static let allowedTypes: [UTType] = [.pdf, .image, .jpeg, .png, .heic, .calendarEvent]

    // MARK: Aufnahme

    func importFiles(_ result: Result<[URL], Error>, tripID: Int, eventID: Int?, store: TravelStore) {
        switch result {
        case .failure(let error):
            items.append(Item(name: "Import", state: .failed(error.localizedDescription)))
        case .success(let urls):
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
                do {
                    try FileManager.default.copyItem(at: url, to: tmp)
                    upload(fileURL: tmp, name: url.lastPathComponent, tripID: tripID, eventID: eventID, store: store)
                } catch {
                    items.append(Item(name: url.lastPathComponent, state: .failed("Datei nicht lesbar: \(error.localizedDescription)")))
                }
            }
        }
    }

    func importPhotos(_ picks: [PhotosPickerItem], tripID: Int, eventID: Int?, store: TravelStore) async {
        for (i, pick) in picks.enumerated() {
            guard let data = try? await pick.loadTransferable(type: Data.self) else {
                items.append(Item(name: "Foto \(i + 1)", state: .failed("Foto nicht lesbar.")))
                continue
            }
            let ext = pick.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let name = "Foto \(TBDate.displayDateTime(Date())) \(i + 1).\(ext)"
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")
            do {
                try data.write(to: tmp)
                upload(fileURL: tmp, name: name, tripID: tripID, eventID: eventID, store: store)
            } catch {
                items.append(Item(name: name, state: .failed(error.localizedDescription)))
            }
        }
    }

    /// Scan (Seiten als Bilder) → ein PDF.
    func importScan(_ pages: [UIImage], tripID: Int, eventID: Int?, store: TravelStore) {
        guard !pages.isEmpty else { return }
        let pdf = PDFDocument()
        for (i, image) in pages.enumerated() {
            if let page = PDFPage(image: image) { pdf.insert(page, at: i) }
        }
        let name = "Scan \(TBDate.displayDateTime(Date())).pdf"
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).pdf")
        guard pdf.write(to: tmp) else {
            items.append(Item(name: name, state: .failed("Der Scan konnte nicht gespeichert werden.")))
            return
        }
        upload(fileURL: tmp, name: name, tripID: tripID, eventID: eventID, store: store)
    }

    // MARK: Upload

    func upload(fileURL: URL, name: String, tripID: Int, eventID: Int?, store: TravelStore) {
        var item = Item(name: name, state: .uploading(0))
        let id = item.id
        items.append(item)
        let contentType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        Task { [weak self] in
            defer { try? FileManager.default.removeItem(at: fileURL) }
            do {
                let doc = try await store.api.uploadDocument(
                    tripID: tripID, eventID: eventID, fileURL: fileURL, fileName: name, contentType: contentType,
                    progress: { value in Task { @MainActor in self?.update(id) { $0.state = .uploading(value) } } })
                self?.update(id) { $0.state = .analyzing; $0.documentID = doc.id }
                var status = doc.analysisStatus
                // Analyse verfolgen (läuft im Hintergrund des Servers), höchstens etwa 90 Sekunden.
                var attempts = 0
                while !status.isFinished, attempts < 45 {
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    status = (try? await store.api.document(id: doc.id))?.analysisStatus ?? status
                    attempts += 1
                }
                self?.update(id) { $0.state = .done(status) }
                await store.refreshDetail(id: tripID)
                await store.refreshInbox()
                await store.refreshToday()
                store.prefetchDocuments(tripID: tripID)
            } catch {
                if error.isCancellation { return }
                self?.update(id) { $0.state = .failed(error.writeMessage) }
            }
        }
        item = items.last ?? item
    }

    private func update(_ id: UUID, _ change: (inout Item) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[i])
    }
}

// MARK: - Oberfläche

/// Menü «Dokument hinzufügen» (Datei, Scan, Foto) mit allen nötigen Präsentationen.
struct DocumentIntakeMenu<MenuLabel: View>: View {
    let intake: DocumentIntake
    let tripID: Int
    var eventID: Int?
    @ViewBuilder var label: () -> MenuLabel
    @Environment(TravelStore.self) private var store

    var body: some View {
        @Bindable var intake = intake
        Menu {
            Button { intake.showImporter = true } label: { Label("Datei importieren", systemImage: "folder") }
            Button {
                if VNDocumentCameraViewController.isSupported { intake.showScanner = true } else { intake.scannerUnavailable = true }
            } label: { Label("Dokument scannen", systemImage: "doc.viewfinder") }
            Button { intake.showPhotos = true } label: { Label("Foto auswählen", systemImage: "photo") }
        } label: { label() }
            .fileImporter(isPresented: $intake.showImporter, allowedContentTypes: DocumentIntake.allowedTypes, allowsMultipleSelection: true) { result in
                intake.importFiles(result, tripID: tripID, eventID: eventID, store: store)
            }
            .photosPicker(isPresented: $intake.showPhotos, selection: $intake.photoSelection, maxSelectionCount: 10, matching: .images)
            .onChange(of: intake.photoSelection) { _, picks in
                guard !picks.isEmpty else { return }
                let chosen = picks
                intake.photoSelection = []
                Task { await intake.importPhotos(chosen, tripID: tripID, eventID: eventID, store: store) }
            }
            .fullScreenCover(isPresented: $intake.showScanner) {
                DocumentScannerView { pages in
                    intake.showScanner = false
                    if let pages { intake.importScan(pages, tripID: tripID, eventID: eventID, store: store) }
                }
                .ignoresSafeArea()
            }
            .alert("Scannen nicht verfügbar", isPresented: $intake.scannerUnavailable) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Auf diesem Gerät steht der Dokumentenscan nicht zur Verfügung. Importiere stattdessen eine Datei oder ein Foto.")
            }
    }
}

/// Fortschrittsliste für laufende Uploads.
struct UploadStatusList: View {
    let intake: DocumentIntake

    var body: some View {
        if intake.hasActivity {
            PlainCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        TBLabel("Dokumente")
                        Spacer()
                        if !intake.isBusy { Button("Schliessen") { intake.clearFinished() }.font(TB.Font.title(14, weight: .semibold)) }
                    }
                    ForEach(intake.items) { item in row(item) }
                }
                .padding(12)
            }
        }
    }

    @ViewBuilder private func row(_ item: DocumentIntake.Item) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                switch item.state {
                case .uploading: Image(systemName: "arrow.up.circle").foregroundStyle(Palette.accent)
                case .analyzing: ProgressView().controlSize(.small)
                case .done(let s): Image(systemName: s == .failed ? "exclamationmark.triangle" : "checkmark.circle.fill")
                    .foregroundStyle(s == .failed ? Palette.negative : Palette.positive)
                case .failed: Image(systemName: "xmark.octagon").foregroundStyle(Palette.negative)
                }
                Text(item.name).tbText(15, weight: .medium).lineLimit(1)
                Spacer()
                switch item.state {
                case .uploading(let p): Text("\(Int(p * 100)) %").tbMono(13, weight: .medium, color: Palette.mute)
                case .analyzing: Text("Auswertung …").tbText(13, color: Palette.mute)
                case .done(let s): Text(s.title).tbText(13, color: Palette.mute)
                case .failed: EmptyView()
                }
            }
            if case .uploading(let p) = item.state { ProgressView(value: p).tint(Palette.accent) }
            if case .failed(let m) = item.state { Text(m).tbText(13, color: Palette.negative) }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Dokumentenscan (VisionKit)

struct DocumentScannerView: UIViewControllerRepresentable {
    /// `nil` bei Abbruch oder Fehler.
    var onFinish: ([UIImage]?) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFinish) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([UIImage]?) -> Void
        init(_ onFinish: @escaping ([UIImage]?) -> Void) { self.onFinish = onFinish }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            onFinish((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onFinish(nil) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onFinish(nil) }
    }
}
