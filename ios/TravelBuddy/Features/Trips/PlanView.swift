import SwiftUI

/// Plan einer Reise: Kopf mit Zahlen, Verlauf, Tage mit Ereignissen, Aktionen (Karte, Dokumente, Teilnehmer, Kalender).
struct PlanView: View {
    let tripID: Int

    @Environment(TravelStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.navigate) private var navigate
    @State private var showNewEvent = false
    @State private var showEditTrip = false
    @State private var showCalendar = false
    @State private var confirmDelete = false
    @State private var deleteError: String?
    @State private var newEventDay: String?

    private var detail: TripDetail? { store.detail(id: tripID) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if store.isOffline { OfflineBanner(savedAt: store.detailSavedAt[tripID]) }
                if let detail { loaded(detail) }
                else if case .failed(let m)? = store.detailStates[tripID] {
                    StateMessage(title: "Reise nicht verfügbar", message: m, actionTitle: "Wiederholen") { Task { await store.refreshDetail(id: tripID) } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .tbScreen()
        .navigationTitle(detail?.trip.title ?? "Reise")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { newEventDay = nil; showNewEvent = true } label: { Image(systemName: "plus") }.accessibilityLabel("Ereignis hinzufügen")
                Menu {
                    Button { showEditTrip = true } label: { Label("Reise bearbeiten", systemImage: "pencil") }
                    Button { showCalendar = true } label: { Label("Kalender exportieren", systemImage: "calendar.badge.plus") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Reise löschen", systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Weitere Aktionen")
            }
        }
        .refreshable { await store.refreshDetail(id: tripID) }
        .task { await store.refreshDetail(id: tripID) }
        .sheet(isPresented: $showNewEvent) {
            EventFormView(mode: .create(tripID: tripID, startDate: newEventDay)) { id in
                if let id { navigate(.event(EventRef(tripID: tripID, eventID: id))) }
            }
        }
        .sheet(isPresented: $showEditTrip) { if let detail { TripFormView(mode: .edit(detail.trip)) { _ in } } }
        .sheet(isPresented: $showCalendar) { TripCalendarExportView(tripID: tripID, tripTitle: detail?.trip.title ?? "Reise") }
        .confirmationDialog("Reise löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Reise löschen", role: .destructive) { Task { await deleteTrip() } }
            Button("Abbrechen", role: .cancel) {}
        } message: { Text("Alle Ereignisse der Reise werden gelöscht. Das lässt sich nicht rückgängig machen.") }
        .alert("Löschen nicht möglich", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(deleteError ?? "") }
    }

    @ViewBuilder private func loaded(_ d: TripDetail) -> some View {
        header(d)
        actionRow(d)
        if d.events.contains(where: { $0.status.isProposal }) {
            ReviewTeaser(count: d.events.filter { $0.status.isProposal }.count)
        }
        let groups = TripTimeline.groups(events: d.events, tripStart: d.trip.startDate, tripZone: d.trip.zone)
        if d.events.isEmpty {
            VStack(spacing: 12) {
                IllustrationCard(key: "reise", height: 130)
                StateMessage(title: "Noch keine Ereignisse", systemImage: "calendar.badge.plus",
                             message: "Erfasse Flüge, Hotels und Ausflüge oder importiere Buchungsbestätigungen als PDF.",
                             actionTitle: "Ereignis hinzufügen") { showNewEvent = true }
            }
        } else {
            TripBand(detail: d)
            let today = TBDate.isoDay(of: AppClock.now, in: d.trip.zone)
            ForEach(groups) { group in
                dayHeader(group, today: today, trip: d.trip)
                PlainCard {
                    VStack(spacing: 0) {
                        ForEach(Array(group.events.enumerated()), id: \.element.id) { i, e in
                            EventRowView(event: e, tripID: tripID, tripZoneID: d.trip.timezone) {
                                navigate(.event(EventRef(tripID: tripID, eventID: e.id)))
                            }
                            if i < group.events.count - 1 { Divider().overlay(Palette.line).padding(.leading, 64) }
                        }
                    }
                }
            }
        }
    }

    private func header(_ d: TripDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            TripCover(path: d.trip.coverUrl, height: 120)
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 2) {
                        if let dest = d.trip.destination { TBLabel(dest, color: .white, size: 12) }
                        Text(d.trip.title).tbTitle(28, weight: .bold, relativeTo: .title, color: .white)
                    }
                    .padding(12)
                    .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
                }
            HStack(spacing: 10) {
                stat(value: dayCount(d).map(String.init) ?? "–", label: "Tage")
                stat(value: "\(d.travelers.count)", label: "Personen")
                stat(value: "\(d.events.count)", label: "Ereignisse")
            }
            if let r = TBDate.range(start: d.trip.startDate, end: d.trip.endDate) {
                Text(r).tbMono(14, weight: .medium, color: Palette.mute)
            }
        }
    }

    private func dayCount(_ d: TripDetail) -> Int? {
        guard let s = d.trip.startDate, let e = d.trip.endDate, let n = TBDate.days(from: s, to: e) else { return nil }
        return n + 1
    }

    private func stat(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).tbMono(24, weight: .semibold, relativeTo: .title2)
            TBLabel(label, size: 11)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
        .accessibilityElement(children: .combine)
    }

    private func actionRow(_ d: TripDetail) -> some View {
        HStack(spacing: 8) {
            quick("Karte", "map") { navigate(.map(tripID)) }
            quick("Dokumente", "doc.richtext") { navigate(.documents(tripID)) }
            quick("Team", "person.2") { navigate(.participants(tripID)) }
            if let ledger = d.trip.ledgerId {
                quick("Kasse", "creditcard") { router.open(.ledger(ledger)) }
            }
        }
    }

    private func quick(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 20, weight: .regular))
                Text(title).tbText(12, weight: .semibold, relativeTo: .caption)
            }
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
        }
        .buttonStyle(.plain)
    }

    private func dayHeader(_ g: TripDayGroup, today: String, trip: Trip) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let key = g.dayKey {
                if key == today { TBChip(text: "Heute", tint: Palette.accent) }
                Text(TBDate.longDay(key)).tbText(15, weight: .semibold)
                Spacer()
                if let n = g.dayNumber { TBLabel("Tag \(n)", size: 11) }
                Button { newEventDay = key; showNewEvent = true } label: { Image(systemName: "plus.circle") }
                    .foregroundStyle(Palette.mute).accessibilityLabel("Ereignis am \(TBDate.display(key)) hinzufügen")
            } else {
                Text("Ohne Datum").tbText(15, weight: .semibold)
                Spacer()
            }
        }
        .padding(.top, 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func deleteTrip() async {
        do {
            try await store.deleteTrip(id: tripID)
            router.open(.trips)
        } catch { deleteError = error.isOffline ? error.writeMessage : ((error as? APIError)?.code == "has_ledger" ? "Die Reise hat eine Reisekasse. Lösche zuerst die Kasse." : error.userMessage) }
    }
}

struct EventRowView: View {
    let event: TripEvent
    let tripID: Int
    let tripZoneID: String?
    let action: () -> Void
    @Environment(TravelStore.self) private var store

    var body: some View {
        let type = store.catalog.typeOrFallback(for: event.type)
        let summary = type.summary.compactMap { EventFacts.fact($0, event: event, type: type, catalog: store.catalog, participantId: nil)?.value }
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 2) {
                    if let t = event.startTime {
                        Text(t).tbMono(15, weight: .semibold, relativeTo: .subheadline)
                        if let z = event.startTz, z != tripZoneID { Text(TripClock.placeName(z)).tbText(10, relativeTo: .caption2, color: Palette.mute).lineLimit(1) }
                    } else {
                        Text("–:–").tbMono(15, weight: .regular, relativeTo: .subheadline, color: Palette.mute)
                    }
                }
                .frame(width: 52)
                TypeBadge(icon: type.icon, color: type.color, size: 34)
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title).tbText(16, weight: .semibold).lineLimit(2)
                    if !summary.isEmpty {
                        Text(summary.prefix(3).joined(separator: " · ")).tbText(13, color: Palette.mute).lineLimit(2)
                    } else if let p = event.provider ?? event.location {
                        Text(p).tbText(13, color: Palette.mute).lineLimit(1)
                    }
                    HStack(spacing: 6) {
                        StatusChip(status: event.status)
                        if !event.documentIds.isEmpty || !event.documents.isEmpty {
                            Image(systemName: "paperclip").font(.system(size: 12)).foregroundStyle(Palette.mute).accessibilityLabel("Dokument angehängt")
                        }
                        if let r = event.bookingReference { Text(r).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute) }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Öffnet das Ereignis")
    }
}

/// Verlauf: eine Zelle je Reisetag, gefärbt nach dem Haupttyp des Tages; heute markiert.
struct TripBand: View {
    let detail: TripDetail
    @Environment(TravelStore.self) private var store

    var body: some View {
        if let start = detail.trip.startDate, let end = detail.trip.endDate, let n = TBDate.days(from: start, to: end), n >= 0, n < 120 {
            let today = TBDate.isoDay(of: AppClock.now, in: detail.trip.zone)
            VStack(alignment: .leading, spacing: 6) {
                TBLabel("Verlauf")
                HStack(spacing: 2) {
                    ForEach(0...n, id: \.self) { i in
                        let day = TBDate.addDays(i, to: start) ?? start
                        let events = detail.events.filter { $0.startDate == day }
                        let color = events.first.map { Palette.type(store.catalog.typeOrFallback(for: $0.type).color) } ?? Palette.line
                        RoundedRectangle(cornerRadius: 2).fill(color).frame(height: day == today ? 22 : 14)
                            .overlay(alignment: .top) { if day == today { Rectangle().fill(Palette.accent).frame(height: 3) } }
                    }
                }
                .frame(height: 22, alignment: .bottom)
                HStack {
                    Text(TBDate.display(start)).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                    Spacer()
                    Text(TBDate.display(end)).tbMono(11, weight: .regular, relativeTo: .caption2, color: Palette.mute)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Verlauf über \(n + 1) Tage")
        }
    }
}
