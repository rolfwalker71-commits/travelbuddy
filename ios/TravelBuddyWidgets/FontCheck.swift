import SwiftUI
import WidgetKit

/// Prüft in der Vorschau, dass alle PostScript-Namen aus `TBFonts` auflösbar sind (kein Rückfall auf die Systemschrift).
struct FontCheckView: View {
    var body: some View {
        let missing = TBFonts.missingFonts()
        VStack(alignment: .leading, spacing: 6) {
            Text(missing.isEmpty ? "Alle Schriften vorhanden" : "Fehlt: \(missing.joined(separator: ", "))")
                .font(TB.Font.title(15, weight: .bold))
                .foregroundStyle(missing.isEmpty ? TB.Palette.positive : TB.Palette.negative)
            Text("Barlow Regular 07:45 Abflug").font(TB.Font.text(13))
            Text("Barlow Semi Condensed SemiBold").font(TB.Font.title(13))
            Text("IBM Plex Mono 07:45 X7K4QP").font(TB.Font.mono(13))
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(TB.Palette.surface)
    }
}

#Preview("Schriften") {
    FontCheckView().frame(width: 340, height: 140)
}
