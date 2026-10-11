import PDFKit
import SwiftUI

struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.backgroundColor = UIColor(Palette.bg)
        v.document = PDFDocument(data: data)
        return v
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        if uiView.document?.dataRepresentation() != data { uiView.document = PDFDocument(data: data) }
    }
}

/// Zeigt ein Dokument (PDF mit PDFKit, Bild direkt). Nutzt zuerst die Offline-Kopie.
struct DocumentViewer: View {
    let document: TBDocument
    @Environment(TravelStore.self) private var store
    @State private var state: Phase = .loading

    private enum Phase {
        case loading
        case pdf(Data, URL)
        case image(UIImage, URL)
        case other(URL)
        case failed(String)
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView("Dokument wird geladen …")
            case .pdf(let data, _):
                PDFKitView(data: data).ignoresSafeArea(edges: .bottom)
            case .image(let image, _):
                ScrollView([.horizontal, .vertical]) { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity) }
            case .other:
                StateMessage(title: "Vorschau nicht möglich", systemImage: "doc", message: "Dieser Dateityp kann nur geteilt werden.")
            case .failed(let m):
                StateMessage(title: "Dokument nicht verfügbar", message: m, actionTitle: "Wiederholen") { Task { await load() } }
            }
        }
        .tbScreen()
        .navigationTitle(document.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let url = shareURL { ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("Teilen") }
            }
        }
        .task { await load() }
    }

    private var shareURL: URL? {
        switch state {
        case .pdf(_, let u), .image(_, let u), .other(let u): u
        default: nil
        }
    }

    private func load() async {
        state = .loading
        do {
            let file = try await store.documentData(id: document.id, fileName: document.fileName, contentType: document.contentType)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                (file.fileName?.isEmpty == false ? file.fileName! : "\(document.id).pdf"))
            try? file.data.write(to: url)
            let type = (file.contentType ?? document.contentType).lowercased()
            if type.contains("pdf") || PDFDocument(data: file.data) != nil {
                state = .pdf(file.data, url)
            } else if let image = UIImage(data: file.data) {
                state = .image(image, url)
            } else {
                state = .other(url)
            }
        } catch {
            if error.isCancellation { return }
            state = .failed(error.isOffline ? "Das Dokument ist noch nicht auf dem Gerät gespeichert. Öffne es einmal mit Verbindung." : error.userMessage)
        }
    }
}
