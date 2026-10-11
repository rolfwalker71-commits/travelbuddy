import Foundation

/// Eingabestand des Ereignis-Formulars, erzeugt aus dem Katalog. Reine Logik, ohne UI (testbar):
/// Abschnitte, Sichtbarkeit («Wichtiges» / «Alle Felder»), Prüfung und Aufbau des API-Bodys.
struct EventDraft: Equatable {
    /// Katalog-`id` des Typs (z. B. `Flug`).
    private(set) var typeID: String
    /// Alle Werte flach, gemeinsame Felder und Typ-Felder; Zahlen/Beträge als `.int`, Ja/Nein als `.bool`,
    /// `participantIds` und `passengers` als Listen.
    var values: [String: JSONValue] = [:]
    /// Zone der Reise: Standardwert für Beginn und Ende.
    let tripZoneID: String
    private(set) var original: TripEvent?
    /// «In Reisekasse übernehmen»: nach dem Speichern wird eine Ausgabe angelegt.
    var addToLedger = false

    static let moneyCurrencyKey = "currency"

    // MARK: Anlegen

    init(type: EventTypeDef, tripZoneID: String, startDate: String? = nil, defaultCurrency: String = "CHF") {
        typeID = type.id
        self.tripZoneID = tripZoneID
        original = nil
        if let startDate { values["startDate"] = .string(startDate) }
        values["startTz"] = .string(tripZoneID)
        values[Self.moneyCurrencyKey] = .string(defaultCurrency)
    }

    // MARK: Bearbeiten

    init(editing event: TripEvent, tripZoneID: String, defaultCurrency: String = "CHF") {
        typeID = event.type
        self.tripZoneID = tripZoneID
        original = event
        for key in Self.columnKeys { values[key] = Self.columnValue(key, of: event) }
        for (k, v) in event.details { values[k] = v }
        if values["startTz"]?.isBlank != false { values["startTz"] = .string(tripZoneID) }
        // Ohne eigene Endzone gilt die Zone des Beginns (wie `endZone(trip:)`).
        if values["endTz"]?.isBlank != false { values["endTz"] = values["startTz"] }
        if values[Self.moneyCurrencyKey]?.isBlank != false { values[Self.moneyCurrencyKey] = .string(defaultCurrency) }
    }

    var isNew: Bool { original == nil }

    mutating func changeType(to type: EventTypeDef, catalog: EventCatalog) {
        // Typ-Felder des alten Typs verwerfen, gemeinsame Felder behalten.
        let oldKeys = Set(catalog.type(for: typeID).map { catalog.fields(of: $0).map(\.key) } ?? [])
        for k in oldKeys where !catalog.commonKeys.contains(k) { values.removeValue(forKey: k) }
        typeID = type.id
    }

    // MARK: Spalten

    /// Gemeinsame Felder, die Spalten des Ereignisses sind (alles andere liegt in `details`).
    static let columnKeys: [String] = [
        "title", "startDate", "startTime", "startTz", "endDate", "endTime", "endTz", "location", "address",
        "provider", "bookingReference", "website", "phone", "participantIds", "priceMinor", "currency",
        "paymentStatus", "paidByParticipantId", "cancelUntil", "notes", "lat", "lon",
    ]

    static func columnValue(_ key: String, of e: TripEvent) -> JSONValue? {
        func s(_ v: String?) -> JSONValue? { v.map { .string($0) } }
        switch key {
        case "title": return .string(e.title)
        case "startDate": return s(e.startDate)
        case "startTime": return s(e.startTime)
        case "startTz": return s(e.startTz)
        case "endDate": return s(e.endDate)
        case "endTime": return s(e.endTime)
        case "endTz": return s(e.endTz)
        case "location": return s(e.location)
        case "address": return s(e.address)
        case "provider": return s(e.provider)
        case "bookingReference": return s(e.bookingReference)
        case "website": return s(e.website)
        case "phone": return s(e.phone)
        case "participantIds": return e.participantIds.isEmpty ? nil : .array(e.participantIds.map { .int($0) })
        case "priceMinor": return e.priceMinor.map { .int($0) }
        case "currency": return s(e.currency)
        case "paymentStatus": return s(e.paymentStatus?.rawValue)
        case "paidByParticipantId": return e.paidByParticipantId.map { .int($0) }
        case "cancelUntil": return s(e.cancelUntil)
        case "notes": return s(e.notes)
        case "lat": return e.lat.map { .double($0) }
        case "lon": return e.lon.map { .double($0) }
        default: return nil
        }
    }

    // MARK: Zugriff

    func string(_ key: String) -> String { values[key]?.stringValue ?? "" }
    func int(_ key: String) -> Int? { values[key]?.intValue }
    func bool(_ key: String) -> Bool { values[key]?.boolValue ?? false }
    func hasValue(_ key: String) -> Bool { values[key].map { !$0.isBlank } ?? false }

    mutating func set(_ key: String, text: String, field: CatalogField? = nil) {
        var t = text
        if field?.transform == "upper" { t = t.uppercased() }
        if let max = field?.maxLength, t.count > max { t = String(t.prefix(max)) }
        let new: JSONValue? = t.isEmpty ? nil : .string(t)
        // Wird der Ort von Hand geändert, passen die alten Koordinaten nicht mehr: sie werden neu aufgelöst.
        if (key == "address" || key == "location"), values[key] != new { values["lat"] = nil; values["lon"] = nil }
        values[key] = new
    }

    /// Treffer der Kartensuche: Koordinaten setzen (und Adresse, wenn noch leer).
    mutating func applyPlace(name: String, address: String, lat: Double, lon: Double, toLocation: Bool) {
        if toLocation {
            values["location"] = .string(name)
            if !address.isEmpty { values["address"] = .string(address) }
            values["lat"] = .double(lat)
            values["lon"] = .double(lon)
        }
    }

    /// Mitreisende, die dabei sind; leer = alle.
    var participantIDs: [Int] { values["participantIds"]?.arrayValue?.compactMap(\.intValue) ?? [] }

    mutating func setParticipants(_ ids: [Int]) {
        values["participantIds"] = ids.isEmpty ? nil : .array(ids.sorted().map { .int($0) })
    }

    // MARK: Passagiere

    /// Einträge von `passengers` (Teilnehmer-ID → Felder).
    var passengers: [[String: JSONValue]] { values["passengers"]?.arrayValue?.compactMap(\.objectValue) ?? [] }

    func passengerValue(participantID: Int, key: String) -> String {
        passengers.first { $0["participantId"]?.intValue == participantID }?[key]?.stringValue ?? ""
    }

    mutating func setPassenger(participantID: Int, key: String, text: String) {
        var list = passengers
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let i = list.firstIndex(where: { $0["participantId"]?.intValue == participantID }) {
            list[i][key] = t.isEmpty ? nil : .string(t)
            // Eintrag ohne weitere Angaben entfällt.
            if list[i].keys.filter({ $0 != "participantId" }).isEmpty { list.remove(at: i) }
        } else if !t.isEmpty {
            list.append(["participantId": .int(participantID), key: .string(t)])
        }
        list.sort { ($0["participantId"]?.intValue ?? 0) < ($1["participantId"]?.intValue ?? 0) }
        values["passengers"] = list.isEmpty ? nil : .array(list.map { .object($0) })
    }

    // MARK: Zeitzonen

    /// Flughafen gewählt: Zone von Abflug → `startTz`, Ankunft → `endTz`.
    mutating func applyAirport(key: String, airport: Airport) {
        values[key] = .string(airport.iata)
        guard let tz = airport.tz, !tz.isEmpty else { return }
        if key == "departureAirport" { values["startTz"] = .string(tz) }
        if key == "arrivalAirport" { values["endTz"] = .string(tz) }
    }

    /// Wanduhr-Dauer `Beginn → Ende` in Minuten, über Zonen hinweg (Flug Zürich 10:00 → Miami 14:00).
    var computedDurationMinutes: Int? {
        guard let sd = values["startDate"]?.stringValue, let st = values["startTime"]?.stringValue,
              let ed = values["endDate"]?.stringValue ?? Optional(sd), let et = values["endTime"]?.stringValue,
              let sz = TripClock.zone(values["startTz"]?.stringValue) ?? TripClock.zone(tripZoneID),
              let s = TripClock.instant(date: sd, time: st, zone: sz) else { return nil }
        let ez = TripClock.zone(values["endTz"]?.stringValue) ?? sz
        guard let e = TripClock.instant(date: ed, time: et, zone: ez) else { return nil }
        let minutes = Int(e.timeIntervalSince(s) / 60)
        return minutes >= 0 ? minutes : nil
    }

    // MARK: Abschnitte

    struct Section: Identifiable, Equatable {
        let id: String
        let title: String
        let fields: [CatalogField]
    }

    private static let timeKeys = ["startDate", "startTime", "startTz", "endDate", "endTime", "endTz"]
    private static let placeKeys = ["location", "address"]
    private static let bookingKeys = ["provider", "bookingReference", "website", "phone"]
    private static let priceKeys = ["priceMinor", "paymentStatus", "paidByParticipantId", "cancelUntil"]

    /// Abschnitte für die Oberfläche. `showAll == false` zeigt nur Wichtiges, Pflicht- und ausgefüllte Felder.
    func sections(catalog: EventCatalog, showAll: Bool) -> [Section] {
        let type = catalog.typeOrFallback(for: typeID)
        func include(_ f: CatalogField) -> Bool {
            if showAll || f.important || f.required { return true }
            return hasValue(f.key)
        }
        func common(_ keys: [String]) -> [CatalogField] {
            keys.compactMap { key in
                guard var f = catalog.commonFields.first(where: { $0.key == key }) else { return nil }
                f = relabel(f, type: type)
                if type.endLabel.isEmpty, ["endDate", "endTime", "endTz"].contains(key) { return nil }
                return include(f) ? f : nil
            }
        }
        var out: [Section] = []
        let title = common(["title"])
        if !title.isEmpty { out.append(Section(id: "title", title: "Titel", fields: title)) }
        let time = common(Self.timeKeys)
        if !time.isEmpty { out.append(Section(id: "time", title: "Zeit", fields: time)) }
        for s in type.sections {
            let fs = s.fields.filter(include)
            if !fs.isEmpty { out.append(Section(id: s.id, title: s.title, fields: fs)) }
        }
        let place = common(Self.placeKeys)
        if !place.isEmpty { out.append(Section(id: "place", title: "Ort", fields: place)) }
        let booking = common(Self.bookingKeys)
        if !booking.isEmpty { out.append(Section(id: "booking", title: "Buchung", fields: booking)) }
        let people = common(["participantIds"])
        if !people.isEmpty { out.append(Section(id: "people", title: "Wer ist dabei", fields: people)) }
        let price = common(Self.priceKeys)
        if !price.isEmpty { out.append(Section(id: "price", title: "Preis und Zahlung", fields: price)) }
        let notes = common(["notes"])
        if !notes.isEmpty { out.append(Section(id: "notes", title: "Notizen", fields: notes)) }
        // Felder des Katalogs, die ich nicht eingeordnet habe (neue gemeinsame Felder), nicht verschweigen.
        let placed = Set(out.flatMap { $0.fields.map(\.key) })
        let rest = catalog.commonFields.filter { !placed.contains($0.key) && include($0) && !isKnownCommon($0.key) }
        if !rest.isEmpty { out.append(Section(id: "more", title: "Weiteres", fields: rest)) }
        return out
    }

    private func isKnownCommon(_ key: String) -> Bool {
        (["title", "notes", "participantIds"] + Self.timeKeys + Self.placeKeys + Self.bookingKeys + Self.priceKeys).contains(key)
    }

    /// «Beginn» wird je Typ zu «Abflug», «Check-in», «Abholung» …
    private func relabel(_ f: CatalogField, type: EventTypeDef) -> CatalogField {
        var label = f.label
        switch f.key {
        case "startDate": label = type.startLabel
        case "startTime": label = "Uhrzeit \(type.startLabel)"
        case "endDate": label = type.endLabel
        case "endTime": label = "Uhrzeit \(type.endLabel)"
        case "startTz": label = "Zeitzone \(type.startLabel)"
        case "endTz": label = "Zeitzone \(type.endLabel)"
        default: return f
        }
        return CatalogField(key: f.key, label: label, kind: f.kind, required: f.required, important: f.important,
                            options: f.options, optionsAreZones: f.optionsAreZones, optionLabels: f.optionLabels, placeholder: f.placeholder,
                            maxLength: f.maxLength, transform: f.transform, unit: f.unit, fields: f.fields)
    }

    // MARK: Prüfung

    enum Issue: Equatable {
        case titleMissing
        case endBeforeStart
        case endDateWithoutStart
        case invalidNumber(String)
        case invalidDate(String)
        case invalidTime(String)

        var message: String {
            switch self {
            case .titleMissing: "Bitte einen Titel eingeben."
            case .endBeforeStart: "Das Ende liegt vor dem Beginn."
            case .endDateWithoutStart: "Ein Enddatum braucht ein Startdatum."
            case .invalidNumber(let label): "«\(label)» muss eine ganze Zahl sein."
            case .invalidDate(let label): "«\(label)» ist kein gültiges Datum."
            case .invalidTime(let label): "«\(label)» ist keine gültige Uhrzeit (hh:mm)."
            }
        }
    }

    /// Blockierende Fehler (der Server würde ablehnen oder die Eingabe ist unbrauchbar).
    func issues(catalog: EventCatalog) -> [Issue] {
        var out: [Issue] = []
        if string("title").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(.titleMissing) }
        if hasValue("endDate"), !hasValue("startDate") { out.append(.endDateWithoutStart) }
        if let s = values["startDate"]?.stringValue, let e = values["endDate"]?.stringValue {
            if let sz = TripClock.zone(string("startTz")) ?? TripClock.zone(tripZoneID),
               let si = TripClock.instant(date: s, time: values["startTime"]?.stringValue, zone: sz),
               let ei = TripClock.instant(date: e, time: values["endTime"]?.stringValue,
                                          zone: TripClock.zone(string("endTz")) ?? sz) {
                if ei < si { out.append(.endBeforeStart) }
            } else if e < s { out.append(.endBeforeStart) }
        }
        let type = catalog.typeOrFallback(for: typeID)
        for f in catalog.fields(of: type) + catalog.commonFields {
            guard let v = values[f.key], !v.isBlank else { continue }
            switch f.kind {
            case .number:
                if v.intValue == nil { out.append(.invalidNumber(f.label)) }
            case .date:
                if let s = v.stringValue, !TBDate.isValid(s) { out.append(.invalidDate(f.label)) }
            case .time:
                if let s = v.stringValue, !TBDate.isValidTime(s) { out.append(.invalidTime(f.label)) }
            default: break
            }
        }
        return out
    }

    func isValid(catalog: EventCatalog) -> Bool { issues(catalog: catalog).isEmpty }

    /// Hinweis ohne Sperre: Ende am selben Tag vor dem Beginn (Nachtfahrt ohne Enddatum?).
    var timeWarning: String? {
        guard let st = values["startTime"]?.stringValue, let et = values["endTime"]?.stringValue, et < st else { return nil }
        let sameDay = !hasValue("endDate") || values["endDate"] == values["startDate"]
        let sameZone = string("startTz") == string("endTz") || !hasValue("endTz")
        return sameDay && sameZone ? "Die Endzeit liegt vor der Startzeit. Bei Nachtfahrten das Enddatum setzen." : nil
    }

    /// Treffer des Musters (z. B. Flugnummer) – nur als Hinweis.
    func patternWarning(for field: CatalogField) -> String? {
        guard let p = field.pattern, let v = values[field.key]?.stringValue, !v.isEmpty,
              v.range(of: p, options: .regularExpression) == nil else { return nil }
        return "Format prüfen" + (field.placeholder.map { " (z. B. \($0))" } ?? "")
    }

    // MARK: Body

    /// Typ-Schlüssel (alle Felder des Katalogtyps, einschliesslich `passengers`).
    private func detailKeys(catalog: EventCatalog) -> [String] {
        let type = catalog.typeOrFallback(for: typeID)
        return catalog.fields(of: type).map(\.key).filter { !catalog.commonKeys.contains($0) }
    }

    /// Body für `POST` (alle gefüllten Felder) bzw. `PATCH` (nur Geändertes; geleerte Felder als `null`).
    func makeBody(catalog: EventCatalog) -> EventBody {
        var out: [String: JSONValue] = [:]
        let orig = original
        func normalized(_ key: String) -> JSONValue? {
            guard let v = values[key], !v.isBlank else { return nil }
            if case .string(let s) = v { return .string(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
            return v
        }
        func originalValue(_ key: String) -> JSONValue? {
            guard let orig else { return nil }
            if key == "startTz" { return orig.startTz.map { .string($0) } ?? .string(tripZoneID) }
            if key == "endTz" { return (orig.endTz ?? orig.startTz).map { .string($0) } ?? .string(tripZoneID) }
            if key == Self.moneyCurrencyKey, orig.priceMinor == nil { return normalized(key) }
            if let v = Self.columnValue(key, of: orig), !v.isBlank { return v }
            return nil
        }
        out["type"] = .string(typeID)

        let sendKeys = Self.columnKeys
        for key in sendKeys {
            let now = normalized(key)
            if orig == nil {
                // Neu: Standardzonen nur senden, wenn sie von der Reisezone abweichen.
                if key == "startTz" || key == "endTz", now?.stringValue == tripZoneID { continue }
                // Währung nur zusammen mit einem Preis.
                if key == Self.moneyCurrencyKey, normalized("priceMinor") == nil { continue }
                if let now { out[key] = now }
            } else {
                let before = originalValue(key)
                if now != before { out[key] = now ?? .null }
            }
        }
        // «Titel» ist bei neuen Ereignissen Pflicht und gehört immer in den Body.
        if orig == nil, let t = normalized("title") { out["title"] = t }

        // Typ-Felder: bei Änderung das vollständige `details`-Objekt (der Server ersetzt `details` als Ganzes).
        var details: [String: JSONValue] = [:]
        for key in detailKeys(catalog: catalog) {
            if let v = normalized(key) { details[key] = v }
        }
        // Unbekannte, aber vorhandene Schlüssel des Ereignisses nicht verlieren.
        if let orig {
            let known = Set(detailKeys(catalog: catalog))
            for (k, v) in orig.details where !known.contains(k) && !catalog.commonKeys.contains(k) { details[k] = v }
        }
        if orig == nil {
            if !details.isEmpty { out["details"] = .object(details) }
        } else if let orig {
            let before = orig.details.filter { !$0.value.isBlank }
            if details != before { out["details"] = .object(details) }
        }
        return EventBody(out)
    }
}
