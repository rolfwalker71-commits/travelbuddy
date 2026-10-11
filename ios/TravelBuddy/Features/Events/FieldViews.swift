import SwiftUI

// Feldzeilen der Formulare. Datum und Zeit sind nativ (DatePicker), die Anzeige ist immer `dd.mm.yyyy`/`hh:mm`.

/// Brücke zwischen `YYYY-MM-DD`/`HH:mm` und dem nativen `DatePicker`. Beide Seiten rechnen in UTC, damit weder
/// Zeitzone noch Sommerzeit den Wert verschieben.
enum PickerBridge {
    static func date(from iso: String?) -> Date {
        if let iso, let d = TBDate.date(iso) { return d }
        return TBDate.date(TBDate.isoString(from: AppClock.now)) ?? Date()
    }

    static func iso(from date: Date) -> String { TBDate.isoString(from: date, calendar: TBDate.utc) }

    static func time(from text: String?) -> Date {
        let minutes = text.flatMap { TBDate.minutes($0) } ?? 9 * 60
        var c = DateComponents(); c.year = 2001; c.month = 1; c.day = 1; c.hour = minutes / 60; c.minute = minutes % 60
        return TBDate.utc.date(from: c) ?? Date()
    }

    static func timeString(from date: Date) -> String {
        let c = TBDate.utc.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// Zeilenrahmen: Label GROSS mit Herkunftspunkt, darunter der Inhalt.
struct FieldRow<Content: View>: View {
    let label: String
    var required = false
    var meta: FieldMeta?
    var note: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                TBLabel(required ? "\(label) *" : label, size: 11)
                OriginDot(meta: meta)
                if meta?.locked == true {
                    Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(Palette.mute).accessibilityLabel("Gesperrt")
                }
            }
            content()
            if let note { Text(note).tbText(12, relativeTo: .caption, color: Palette.mute) }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

struct DateFieldRow: View {
    let label: String
    @Binding var value: String?
    var meta: FieldMeta?
    var required = false

    var body: some View {
        FieldRow(label: label, required: required, meta: meta) {
            HStack {
                if let v = value {
                    pickerButton(Text(TBDate.display(v)).tbMono(17, weight: .medium))
                    Spacer()
                    Button { value = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mute) }
                        .accessibilityLabel("\(label) entfernen")
                } else {
                    pickerButton(Text("Datum wählen").tbText(16, color: Palette.accent))
                    Spacer()
                }
            }
            .frame(minHeight: 38)
        }
    }

    private func pickerButton<V: View>(_ text: V) -> some View {
        text.overlay {
            DatePicker("", selection: Binding(
                get: { PickerBridge.date(from: value) },
                set: { value = PickerBridge.iso(from: $0) }),
                       displayedComponents: .date)
                .labelsHidden()
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .environment(\.locale, Locale(identifier: "de_CH"))
                .colorMultiply(.clear)
                .accessibilityLabel(label)
        }
    }
}

struct TimeFieldRow: View {
    let label: String
    @Binding var value: String?
    var meta: FieldMeta?

    var body: some View {
        FieldRow(label: label, meta: meta) {
            HStack {
                if let v = value {
                    pickerButton(Text(v).tbMono(17, weight: .medium))
                    Spacer()
                    Button { value = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mute) }
                        .accessibilityLabel("\(label) entfernen")
                } else {
                    pickerButton(Text("Uhrzeit wählen").tbText(16, color: Palette.accent))
                    Spacer()
                }
            }
            .frame(minHeight: 38)
        }
    }

    private func pickerButton<V: View>(_ text: V) -> some View {
        text.overlay {
            DatePicker("", selection: Binding(
                get: { PickerBridge.time(from: value) },
                set: { value = PickerBridge.timeString(from: $0) }),
                       displayedComponents: .hourAndMinute)
                .labelsHidden()
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .environment(\.locale, Locale(identifier: "de_CH"))
                .colorMultiply(.clear)
                .accessibilityLabel(label)
        }
    }
}

/// Einzeiliges Textfeld mit Label.
struct TextFieldRow: View {
    let label: String
    @Binding var text: String
    var placeholder: String?
    var meta: FieldMeta?
    var required = false
    var mono = false
    var capitalization: TextInputAutocapitalization = .sentences
    var keyboard: UIKeyboardType = .default
    var axis: Axis = .horizontal
    var warning: String?

    var body: some View {
        FieldRow(label: label, required: required, meta: meta, note: warning) {
            TextField(placeholder ?? label, text: $text, axis: axis)
                .font(mono ? TB.Font.mono(17, weight: .medium) : TB.Font.text(17))
                .foregroundStyle(Palette.ink)
                .textInputAutocapitalization(capitalization)
                .keyboardType(keyboard)
                .lineLimit(axis == .vertical ? 1...8 : 1...1)
                .frame(minHeight: 36, alignment: .topLeading)
        }
    }
}

/// Auswahl aus fester Liste.
struct SelectFieldRow: View {
    let label: String
    let options: [(value: String, title: String)]
    @Binding var selection: String?
    var meta: FieldMeta?

    var body: some View {
        FieldRow(label: label, meta: meta) {
            Menu {
                Button("Keine Angabe") { selection = nil }
                ForEach(options, id: \.value) { o in
                    Button { selection = o.value } label: {
                        if selection == o.value { Label(o.title, systemImage: "checkmark") } else { Text(o.title) }
                    }
                }
            } label: {
                HStack {
                    Text(options.first { $0.value == selection }?.title ?? selection ?? "Wählen")
                        .tbText(17, color: selection == nil ? Palette.mute : Palette.ink)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(Palette.mute)
                }
                .touchTarget()
                .contentShape(Rectangle())
            }
        }
    }
}

/// Zeitzonen-Auswahl mit Suche (IANA-Kennungen, Anzeige als Ort).
struct TimeZoneFieldRow: View {
    let label: String
    @Binding var zoneID: String?
    var tripZoneID: String
    var meta: FieldMeta?
    @State private var showing = false

    var body: some View {
        FieldRow(label: label, meta: meta, note: zoneID == nil || zoneID == tripZoneID ? "Zone der Reise" : nil) {
            Button { showing = true } label: {
                HStack {
                    Text(zoneID.map(TripClock.placeName) ?? TripClock.placeName(tripZoneID)).tbText(17)
                    Text(zoneID ?? tripZoneID).tbMono(12, weight: .regular, relativeTo: .caption, color: Palette.mute)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Palette.mute)
                }
                .touchTarget()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: $showing) {
            TimeZonePickerSheet(selection: Binding(get: { zoneID ?? tripZoneID }, set: { zoneID = $0 }), tripZoneID: tripZoneID)
        }
    }
}

struct TimeZonePickerSheet: View {
    @Binding var selection: String
    let tripZoneID: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var zones: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers
        let q = TripListLogic.normalize(query)
        let filtered = q.isEmpty ? all : all.filter { TripListLogic.normalize($0.replacingOccurrences(of: "_", with: " ")).contains(q) }
        return filtered
    }

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Button { selection = tripZoneID; dismiss() } label: {
                        HStack { Text("Zone der Reise").tbText(16); Spacer(); Text(tripZoneID).tbMono(12, weight: .regular, color: Palette.mute) }
                    }.tbRow()
                }
                ForEach(zones, id: \.self) { id in
                    Button { selection = id; dismiss() } label: {
                        HStack {
                            Text(TripClock.placeName(id)).tbText(16)
                            Text(id.split(separator: "/").first.map(String.init) ?? "").tbText(12, color: Palette.mute)
                            Spacer()
                            if id == selection { Image(systemName: "checkmark").foregroundStyle(Palette.accent) }
                        }
                    }
                    .tbRow()
                }
            }
            .tbList()
            .searchable(text: $query, prompt: "Ort oder Zone suchen")
            .navigationTitle("Zeitzone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

/// Betrag mit Währung; Wert in Minor Units.
struct MoneyFieldRow: View {
    let label: String
    @Binding var minor: Int?
    @Binding var currency: String
    var meta: FieldMeta?
    @State private var text = ""
    @State private var didLoad = false
    @FocusState private var focused: Bool

    var body: some View {
        FieldRow(label: label, meta: meta, note: invalid ? "Betrag ist ungültig (z. B. 12.50)." : nil) {
            HStack(spacing: 10) {
                TextField("0.00", text: $text)
                    .font(TB.Font.mono(18, weight: .semibold))
                    .keyboardType(.decimalPad)
                    .focused($focused)
                    .onChange(of: text) { _, new in
                        if new.trimmingCharacters(in: .whitespaces).isEmpty { minor = nil }
                        else if let v = Money.parseMinor(new, currency: currency) { minor = v }
                    }
                Menu {
                    ForEach(Currency.choices(including: [currency]), id: \.self) { c in
                        Button(c) { currency = c }
                    }
                } label: {
                    Text(currency).tbMono(15, weight: .semibold, color: Palette.accent)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Palette.surface2, in: RoundedRectangle(cornerRadius: 6))
                }
            }
            .frame(minHeight: 36)
        }
        .onAppear {
            guard !didLoad else { return }
            didLoad = true
            if let m = minor { text = Money.inputString(m, currency: currency) }
        }
    }

    private var invalid: Bool {
        let t = text.trimmingCharacters(in: .whitespaces)
        return !t.isEmpty && Money.parseMinor(t, currency: currency) == nil
    }
}

/// Ja/Nein.
struct BoolFieldRow: View {
    let label: String
    @Binding var value: Bool
    var meta: FieldMeta?

    var body: some View {
        HStack {
            HStack(spacing: 6) {
                Text(label).tbText(17)
                OriginDot(meta: meta)
            }
            Spacer()
            Toggle(label, isOn: $value).labelsHidden().tint(Palette.accent)
        }
        .touchTarget()
    }
}
