import Foundation

// Katalog der Ereignistypen (`shared/event-types.json`, Server: `GET /v1/meta/event-types`).
// Typen und Felder sind Daten, nicht Code: ein neues Feld im Katalog erscheint ohne App-Update im Formular.

enum FieldKind: Equatable, Hashable, Sendable {
    case text, longtext, date, time, number, money, select, bool, airport, place, passengers
    case participants, participant
    case unknown(String)

    init(_ raw: String) {
        switch raw {
        case "text": self = .text
        case "longtext": self = .longtext
        case "date": self = .date
        case "time": self = .time
        case "number": self = .number
        case "money": self = .money
        case "select": self = .select
        case "bool": self = .bool
        case "airport": self = .airport
        case "place": self = .place
        case "passengers": self = .passengers
        case "participants": self = .participants
        case "participant": self = .participant
        default: self = .unknown(raw)
        }
    }
}

struct CatalogField: Decodable, Equatable, Hashable, Sendable, Identifiable {
    let key: String
    let label: String
    let kind: FieldKind
    let required: Bool
    let important: Bool
    /// Feste Auswahl; `nil` bei `select` mit `options: "iana"` (Zeitzonenliste).
    let options: [String]?
    let optionsAreZones: Bool
    let optionLabels: [String]?
    let placeholder: String?
    let maxLength: Int?
    let transform: String?
    let pattern: String?
    let unit: String?
    let note: String?
    /// Unterfelder (`passengers`).
    let fields: [CatalogField]

    var id: String { key }

    private enum CodingKeys: String, CodingKey {
        case key, label, kind, required, important, options, optionLabels, placeholder, maxLength
        case transform, pattern, unit, note, fields
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? key
        kind = FieldKind(try c.decodeIfPresent(String.self, forKey: .kind) ?? "text")
        required = try c.decodeIfPresent(Bool.self, forKey: .required) ?? false
        important = try c.decodeIfPresent(Bool.self, forKey: .important) ?? false
        if let list = try? c.decodeIfPresent([String].self, forKey: .options) {
            options = list; optionsAreZones = false
        } else if let word = try? c.decodeIfPresent(String.self, forKey: .options) {
            options = nil; optionsAreZones = (word == "iana")
        } else {
            options = nil; optionsAreZones = false
        }
        optionLabels = try c.decodeIfPresent([String].self, forKey: .optionLabels)
        placeholder = try c.decodeIfPresent(String.self, forKey: .placeholder)
        maxLength = try c.decodeIfPresent(Int.self, forKey: .maxLength)
        transform = try c.decodeIfPresent(String.self, forKey: .transform)
        pattern = try c.decodeIfPresent(String.self, forKey: .pattern)
        unit = try c.decodeIfPresent(String.self, forKey: .unit)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        fields = try c.decodeIfPresent([CatalogField].self, forKey: .fields) ?? []
    }

    init(key: String, label: String, kind: FieldKind, required: Bool = false, important: Bool = false,
         options: [String]? = nil, optionsAreZones: Bool = false, optionLabels: [String]? = nil, placeholder: String? = nil,
         maxLength: Int? = nil, transform: String? = nil, unit: String? = nil, fields: [CatalogField] = []) {
        self.key = key; self.label = label; self.kind = kind; self.required = required; self.important = important
        self.options = options; self.optionsAreZones = optionsAreZones; self.optionLabels = optionLabels
        self.placeholder = placeholder; self.maxLength = maxLength; self.transform = transform
        self.pattern = nil; self.unit = unit; self.note = nil; self.fields = fields
    }

    /// Anzeigetext einer Auswahl (`optionLabels` hat die gleiche Reihenfolge wie `options`).
    func optionLabel(_ value: String) -> String {
        guard let options, let i = options.firstIndex(of: value), let labels = optionLabels, i < labels.count
        else { return value }
        return labels[i]
    }
}

struct CatalogSection: Decodable, Equatable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let fields: [CatalogField]
}

struct EventTypeDef: Decodable, Equatable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let icon: String
    let color: String
    let startLabel: String
    let endLabel: String
    let titleHint: String?
    let summary: [String]
    let sections: [CatalogSection]
    /// `extends: "Hotel"`: übernimmt Abschnitte und Kurzfelder des Basistyps.
    let extends: String?

    private enum CodingKeys: String, CodingKey {
        case id, label, icon, color, startLabel, endLabel, titleHint, summary, sections, extends
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? id
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "doc"
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "doc"
        startLabel = try c.decodeIfPresent(String.self, forKey: .startLabel) ?? "Beginn"
        endLabel = try c.decodeIfPresent(String.self, forKey: .endLabel) ?? "Ende"
        titleHint = try c.decodeIfPresent(String.self, forKey: .titleHint)
        summary = try c.decodeIfPresent([String].self, forKey: .summary) ?? []
        sections = try c.decodeIfPresent([CatalogSection].self, forKey: .sections) ?? []
        extends = try c.decodeIfPresent(String.self, forKey: .extends)
    }

    init(id: String, label: String, icon: String, color: String, startLabel: String = "Beginn",
         endLabel: String = "Ende", titleHint: String? = nil, summary: [String] = [],
         sections: [CatalogSection] = [], extends: String? = nil) {
        self.id = id; self.label = label; self.icon = icon; self.color = color; self.startLabel = startLabel
        self.endLabel = endLabel; self.titleHint = titleHint; self.summary = summary; self.sections = sections
        self.extends = extends
    }
}

struct EventCatalog: Decodable, Equatable, Sendable {
    let version: Int
    let commonFields: [CatalogField]
    let types: [EventTypeDef]
    let aliases: [String: String]

    private enum CodingKeys: String, CodingKey { case version, commonFields, types, aliases }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        commonFields = try c.decodeIfPresent([CatalogField].self, forKey: .commonFields) ?? []
        let raw = try c.decodeIfPresent([EventTypeDef].self, forKey: .types) ?? []
        aliases = try c.decodeIfPresent([String: String].self, forKey: .aliases) ?? [:]
        types = EventCatalog.resolveExtends(raw)
    }

    init(version: Int = 1, commonFields: [CatalogField], types: [EventTypeDef], aliases: [String: String] = [:]) {
        self.version = version
        self.commonFields = commonFields
        self.types = EventCatalog.resolveExtends(types)
        self.aliases = aliases
    }

    /// Typen mit `extends` übernehmen Abschnitte und Kurzfelder des Basistyps, wenn sie keine eigenen haben.
    private static func resolveExtends(_ types: [EventTypeDef]) -> [EventTypeDef] {
        let byID = Dictionary(types.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return types.map { t in
            guard let base = t.extends.flatMap({ byID[$0] }), t.sections.isEmpty else { return t }
            return EventTypeDef(id: t.id, label: t.label, icon: t.icon, color: t.color, startLabel: t.startLabel,
                                endLabel: t.endLabel, titleHint: t.titleHint,
                                summary: t.summary.isEmpty ? base.summary : t.summary,
                                sections: base.sections, extends: t.extends)
        }
    }

    // MARK: Zugriff

    /// Typ zu einer Server-`id`; Aliase (`Mietwagen` → `Mietauto`) werden aufgelöst. Unbekannte Typen → `nil`.
    func type(for id: String?) -> EventTypeDef? {
        guard let id else { return nil }
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        if let t = types.first(where: { $0.id == trimmed }) { return t }
        if let alias = aliases[trimmed] { return types.first { $0.id == alias } }
        return nil
    }

    /// Wie `type(for:)`, fällt aber auf einen neutralen Typ zurück, damit die Oberfläche nie leer bleibt.
    func typeOrFallback(for id: String?) -> EventTypeDef {
        type(for: id) ?? EventTypeDef(id: id ?? "Aufgabe", label: id ?? "Ereignis", icon: "doc", color: "doc")
    }

    /// Alle Felder eines Typs (Abschnitte flach).
    func fields(of type: EventTypeDef) -> [CatalogField] { type.sections.flatMap(\.fields) }

    func field(key: String, in type: EventTypeDef) -> CatalogField? {
        fields(of: type).first { $0.key == key } ?? commonFields.first { $0.key == key }
    }

    /// Spaltenschlüssel (gemeinsame Felder), alles andere liegt in `details`.
    var commonKeys: Set<String> { Set(commonFields.map(\.key)) }
}

// MARK: - Laden

enum EventCatalogLoader {
    /// Gebündelte Kopie von `shared/event-types.json` (Resource der App). Fällt nie leer aus: Fehlt die Datei,
    /// liefert der Aufruf einen minimalen Notkatalog, damit die App startet.
    static func bundled(bundle: Bundle = .main) -> EventCatalog {
        if let url = bundle.url(forResource: "event-types", withExtension: "json"),
           let data = try? Data(contentsOf: url), let catalog = try? decode(data), !catalog.types.isEmpty {
            return catalog
        }
        return emergency
    }

    static func decode(_ data: Data) throws -> EventCatalog {
        try JSONDecoder().decode(EventCatalog.self, from: data)
    }

    /// Nur falls die Resource fehlt (Fehlkonfiguration).
    static let emergency = EventCatalog(
        commonFields: [
            CatalogField(key: "title", label: "Titel", kind: .text, required: true, important: true),
            CatalogField(key: "startDate", label: "Beginn", kind: .date, important: true),
            CatalogField(key: "startTime", label: "Uhrzeit Beginn", kind: .time, important: true),
            CatalogField(key: "notes", label: "Notizen", kind: .longtext),
        ],
        types: [EventTypeDef(id: "Aufgabe", label: "Aufgabe", icon: "task", color: "task")])
}

// MARK: - Symbole und Farben

enum TypeIcon {
    /// SF-Symbol zum Katalog-Icon (`icon` in event-types.json).
    static func symbol(_ icon: String) -> String {
        switch icon {
        case "plane": "airplane"
        case "train": "tram.fill"
        case "car": "car.fill"
        case "transfer": "bus.fill"
        case "bed": "bed.double.fill"
        case "ship": "ferry.fill"
        case "map": "figure.walk"
        case "fork": "fork.knife"
        case "ticket": "ticket.fill"
        case "shield": "checkmark.shield.fill"
        case "passport": "person.text.rectangle.fill"
        case "task": "checklist"
        case "doc": "doc.text.fill"
        default: "circle.fill"
        }
    }
}
