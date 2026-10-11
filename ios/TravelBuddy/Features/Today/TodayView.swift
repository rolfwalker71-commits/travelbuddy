import SwiftUI

/// Heute-Modus einer aktiven Reise: Hero mit Countdown-Ring, Tagesband, Tagesliste mit Ticket-Karten,
/// Morgen, Aufgaben und Fristen, Vorschläge zu prüfen. Pull-to-refresh; offline der letzte Stand.
struct TodayView: View {
    @Environment(TravelStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.navigate) private var navigate

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .tbScreen()
        .navigationTitle("Heute")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.refreshAll() }
        .task { if store.todayPlan == nil { await store.refreshToday() } }
    }

    @ViewBuilder private var content: some View {
        if let plan = store.todayPlan, plan.trip != nil {
            if store.isOffline || plan.isOffline { OfflineBanner(savedAt: store.todaySavedAt) }
            TimelineView(.periodic(from: .now, by: 30)) { context in
                TodayHero(plan: plan, now: context.date.addingTimeInterval(AppClock.offset))
            }
            TodayDayBandCard(plan: plan)
            if !plan.ongoing.isEmpty {
                SectionHeader("Unterkunft und Reise")
                ForEach(plan.ongoing) { entry in TodayEntryCard(entry: entry, plan: plan) }
            }
            SectionHeader("Heute", trailing: TBDate.display(plan.date))
            if plan.entries.isEmpty {
                PlainCard {
                    Text("Heute steht nichts Festes an.").tbText(16, color: Palette.mute).padding(14)
                }
            } else {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    VStack(spacing: 14) {
                        ForEach(plan.entries) { entry in
                            TodayEntryCard(entry: entry, plan: plan, now: context.date.addingTimeInterval(AppClock.offset))
                        }
                    }
                }
            }
            if !plan.tomorrow.isEmpty {
                SectionHeader("Morgen", trailing: TBDate.display(TBDate.addDays(1, to: plan.date) ?? plan.date))
                PlainCard {
                    VStack(spacing: 0) {
                        ForEach(Array(plan.tomorrow.enumerated()), id: \.element.id) { i, entry in
                            TomorrowRow(entry: entry, plan: plan)
                            if i < plan.tomorrow.count - 1 { Divider().overlay(Palette.line) }
                        }
                    }
                }
            }
            if !plan.tasks.isEmpty || !plan.deadlines.isEmpty { TasksCard(plan: plan) }
            if plan.review > 0 || (store.inbox?.review.count ?? 0) > 0 { ReviewTeaser(count: max(plan.review, store.inbox?.review.count ?? 0)) }
            if let ledger = plan.ledger { LedgerTeaser(ledger: ledger) }
        } else if store.todayState == .loading || store.todayState == .idle {
            ProgressView("Heute wird geladen …").frame(maxWidth: .infinity).padding(.top, 60)
        } else if let message = store.todayState.errorMessage {
            StateMessage(title: "Heute nicht verfügbar", message: message, actionTitle: "Wiederholen") {
                Task { await store.refreshToday() }
            }
        } else if let upcoming = store.todayPlan?.upcoming {
            UpcomingCard(upcoming: upcoming)
        } else {
            VStack(spacing: 16) {
                IllustrationCard(key: "heute", caption: nil, height: 160)
                StateMessage(title: "Keine aktive Reise", systemImage: "suitcase",
                             message: "Sobald eine Reise beginnt, zeigt «Heute» den Tag mit Zeiten, Gate, Sitz und Code.")
            }
        }
    }
}

// MARK: - Hero

struct TodayHero: View {
    let plan: TodayPlan
    let now: Date

    var body: some View {
        let trip = plan.trip
        let remaining = plan.remaining(at: now)
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                if let trip {
                    let dayText = (trip.dayIndex != nil && trip.dayCount != nil) ? " · Tag \(trip.dayIndex!) von \(trip.dayCount!)" : ""
                    TBLabel("\(trip.title)\(dayText)", color: Palette.heroInk.opacity(0.7))
                }
                Text(TBDate.longDay(plan.date)).tbTitle(26, weight: .bold, relativeTo: .title, color: Palette.heroInk)
                HStack(spacing: 6) {
                    if let dest = trip?.destination { Text(dest) }
                    Text("·")
                    Text(TBDate.displayTime(now, timeZone: plan.tripZone)).font(TB.Font.mono(14, weight: .medium, relativeTo: .subheadline))
                    Text("Ortszeit")
                }
                .tbText(14, relativeTo: .subheadline, color: Palette.heroInk.opacity(0.75))
            }
            if let i = trip?.dayIndex, let c = trip?.dayCount, c > 0 { DayDots(dayIndex: i, dayCount: c) }
            Rectangle().fill(Palette.heroInk.opacity(0.15)).frame(height: 1)
            if let next = plan.next {
                HStack(alignment: .center, spacing: 16) {
                    CountdownRing(remaining: remaining, progress: plan.ringProgress(at: now), size: 92)
                    VStack(alignment: .leading, spacing: 4) {
                        TBLabel("Als Nächstes", color: Palette.heroAccent)
                        Text(next.title(in: plan)).tbTitle(22, weight: .bold, relativeTo: .title2, color: Palette.heroInk)
                            .lineLimit(2)
                        if let sub = next.subtitle(in: plan) {
                            Text(sub).font(TB.Font.mono(14, weight: .medium, relativeTo: .subheadline))
                                .foregroundStyle(Palette.heroInk.opacity(0.85))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle").font(.system(size: 30, weight: .light)).foregroundStyle(Palette.heroAccent)
                    Text("Für heute ist alles erledigt.").tbText(17, weight: .medium, color: Palette.heroInk)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.hero, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius + 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius + 4, style: .continuous).strokeBorder(Palette.heroInk.opacity(0.12)))
    }
}

extension TodayEntry {
    /// Ereignistitel mit Rolle: «Check-out Hotel Negresco», «Abflug ZRH → BCN».
    func title(in plan: TodayPlan) -> String {
        let catalog = EventCatalogLoader.shared
        let t = catalog.typeOrFallback(for: event.type)
        let label = role == .end ? t.endLabel : t.startLabel
        if role == .ongoing { return event.title }
        if ["Flug"].contains(event.type), let a = event.detail("departureAirport"), let b = event.detail("arrivalAirport") {
            return "\(label) \(a) → \(b)"
        }
        if event.title.lowercased().hasPrefix(label.lowercased()) || label.isEmpty { return event.title }
        if ["Hotel", "Unterkunft", "Mietauto"].contains(event.type) { return "\(label) \(event.title)" }
        return event.title
    }

    /// Zeit (mit Ortszeit-Hinweis) und Ort.
    func subtitle(in plan: TodayPlan) -> String? {
        var parts: [String] = []
        if let time { parts.append(TripClock.timeLabel(time, zoneID: zoneID, tripZoneID: plan.zoneID)) }
        if let place = event.location ?? event.provider, !event.title.localizedCaseInsensitiveContains(place) { parts.append(place) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - Tagesband

struct TodayDayBandCard: View {
    let plan: TodayPlan

    var body: some View {
        let catalog = EventCatalogLoader.shared
        let marks: [DayBand.Mark] = plan.entries.compactMap { e in
            guard let t = e.time, let m = TBDate.minutes(t) else { return nil }
            let type = catalog.typeOrFallback(for: e.event.type)
            return .init(id: e.id, minutes: m, color: type.color, label: e.event.title)
        }
        let now = AppClock.now
        let cal = TBDate.calendar(in: plan.tripZone)
        let c = cal.dateComponents([.hour, .minute], from: now)
        let nowMin = plan.date == TBDate.isoDay(of: now, in: plan.tripZone) ? (c.hour ?? 0) * 60 + (c.minute ?? 0) : nil
        if !marks.isEmpty {
            PlainCard {
                VStack(alignment: .leading, spacing: 8) {
                    TBLabel("Tagesband")
                    DayBand(marks: marks, nowMinutes: nowMin)
                }
                .padding(14)
            }
        }
    }
}

// MARK: - Eintrag

struct TodayEntryCard: View {
    let entry: TodayEntry
    let plan: TodayPlan
    var now: Date = AppClock.now

    @Environment(TravelStore.self) private var store
    @Environment(\.navigate) private var navigate

    private var event: TripEvent { entry.event }
    private var type: EventTypeDef { store.catalog.typeOrFallback(for: event.type) }
    private var isPast: Bool { (entry.instant ?? .distantFuture) < now && entry.role != .ongoing }
    private var isNext: Bool { plan.next?.id == entry.id }

    var body: some View {
        let facts = EventFacts.big(for: event, catalog: store.catalog, participantId: store.myParticipantID(tripID: event.tripId == 0 ? (plan.trip?.id ?? 0) : event.tripId), limit: 4)
        let tripID = event.tripId == 0 ? (plan.trip?.id ?? 0) : event.tripId
        Button {
            navigate(.event(EventRef(tripID: tripID, eventID: event.id)))
        } label: {
            TicketCard(icon: type.icon, color: type.color, typeLabel: type.label, reference: event.bookingReference,
                       status: event.status, emphasized: isNext) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        if let time = entry.time {
                            Text(time).tbMono(30, weight: .semibold, relativeTo: .largeTitle)
                        } else {
                            Text("ganztägig").tbMono(14, weight: .medium, relativeTo: .subheadline, color: Palette.mute)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.title(in: plan)).tbTitle(20, weight: .semibold, relativeTo: .title3)
                            if let z = entry.zoneID, z != plan.zoneID, entry.time != nil {
                                Text("Ortszeit \(TripClock.placeName(z))").tbText(13, color: Palette.mute)
                            }
                            if let place = event.location ?? event.address, !event.title.localizedCaseInsensitiveContains(place) {
                                Text(place).tbText(14, color: Palette.mute).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                        if isPast { Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.positive).accessibilityLabel("Erledigt") }
                    }
                    if !facts.isEmpty { FactGrid(facts: facts) }
                }
            } strip: {
                HStack(spacing: 8) {
                    ForEach(event.documents.prefix(2)) { doc in
                        Label(doc.displayTitle, systemImage: "doc.richtext").lineLimit(1)
                            .tbText(13, weight: .semibold, relativeTo: .footnote, color: Palette.ink)
                    }
                    if event.documents.isEmpty && !event.documentIds.isEmpty {
                        Label("\(event.documentIds.count) Dokument\(event.documentIds.count == 1 ? "" : "e")", systemImage: "doc.richtext")
                            .tbText(13, weight: .semibold, relativeTo: .footnote)
                    }
                    Spacer(minLength: 0)
                    if event.hasCoordinate || event.address != nil || !event.places.isEmpty {
                        Label("Route", systemImage: "arrow.triangle.turn.up.right.diamond")
                            .tbText(13, weight: .semibold, relativeTo: .footnote, color: Palette.accent)
                    }
                    Image(systemName: "chevron.right").foregroundStyle(Palette.mute).accessibilityHidden(true)
                }
            }
            .opacity(isPast ? 0.62 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(facts))
        .accessibilityHint("Öffnet das Ereignis")
        .accessibilityAddTraits(.isButton)
    }

    private func accessibilityText(_ facts: [EventFact]) -> String {
        var parts = [type.label, entry.title(in: plan)]
        if let t = entry.time { parts.insert(t + " Uhr", at: 0) }
        parts += facts.map { "\($0.label) \($0.value)" }
        if isPast { parts.append("Erledigt") }
        return parts.joined(separator: ", ")
    }
}

struct TomorrowRow: View {
    let entry: TodayEntry
    let plan: TodayPlan
    @Environment(TravelStore.self) private var store
    @Environment(\.navigate) private var navigate

    var body: some View {
        let type = store.catalog.typeOrFallback(for: entry.event.type)
        let tripID = entry.event.tripId == 0 ? (plan.trip?.id ?? 0) : entry.event.tripId
        Button { navigate(.event(EventRef(tripID: tripID, eventID: entry.event.id))) } label: {
            HStack(spacing: 12) {
                Text(entry.time ?? "–:–").tbMono(15, weight: .semibold, relativeTo: .subheadline, color: Palette.mute)
                    .frame(width: 52, alignment: .leading)
                TypeBadge(icon: type.icon, color: type.color, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.title(in: plan)).tbText(16, weight: .semibold)
                    if let sub = entry.event.location ?? entry.event.provider { Text(sub).tbText(13, color: Palette.mute) }
                }
                Spacer()
                StatusChip(status: entry.event.status)
            }
            .padding(12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Aufgaben, Fristen, Prüfen, Kasse

struct TasksCard: View {
    let plan: TodayPlan
    @Environment(\.navigate) private var navigate

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Aufgaben und Fristen")
            PlainCard {
                VStack(spacing: 0) {
                    ForEach(plan.tasks) { task in
                        Button { navigate(.event(EventRef(tripID: plan.trip?.id ?? 0, eventID: task.eventId))) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "circle").foregroundStyle(Palette.mute).accessibilityHidden(true)
                                Text(task.title).tbText(16)
                                Spacer()
                                if let due = task.dueDate { Text(TBDate.display(due)).tbMono(13, weight: .regular, relativeTo: .footnote, color: Palette.mute) }
                            }
                            .padding(12).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Palette.line)
                    }
                    ForEach(plan.deadlines) { dl in
                        Button { navigate(.event(EventRef(tripID: plan.trip?.id ?? 0, eventID: dl.eventId))) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "calendar.badge.clock").foregroundStyle(Palette.accent).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(dl.title).tbText(16)
                                    Text(dl.kindTitle).tbText(13, color: Palette.mute)
                                }
                                Spacer()
                                Text(TBDate.display(dl.date)).tbMono(13, weight: .medium, relativeTo: .footnote)
                            }
                            .padding(12).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if dl.id != plan.deadlines.last?.id { Divider().overlay(Palette.line) }
                    }
                }
            }
        }
    }
}

struct ReviewTeaser: View {
    let count: Int
    @Environment(Router.self) private var router

    var body: some View {
        Button { router.showInbox = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "checklist").font(.system(size: 22)).foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(count) Vorschl\(count == 1 ? "ag" : "äge") zu prüfen").tbTitle(18, relativeTo: .headline)
                    Text("Aus Dokumenten erkannt, noch nicht bestätigt.").tbText(13, color: Palette.mute)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Palette.mute)
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.accent.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

struct LedgerTeaser: View {
    let ledger: TodayLedger
    @Environment(Router.self) private var router

    var body: some View {
        Button { router.open(.ledger(ledger.id)) } label: {
            HStack(spacing: 12) {
                Image(systemName: "creditcard").font(.system(size: 20)).foregroundStyle(Palette.mute)
                VStack(alignment: .leading, spacing: 2) {
                    TBLabel("Reisekasse")
                    Text(BalancePhrase.text(net: ledger.balanceMinor, currency: ledger.currency, subject: nil)).tbText(16, weight: .semibold,
                        color: ledger.balanceMinor == 0 ? Palette.ink : (ledger.balanceMinor > 0 ? Palette.positive : Palette.negative))
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Palette.mute)
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: TB.Metric.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: TB.Metric.cardRadius).strokeBorder(Palette.line))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

struct UpcomingCard: View {
    let upcoming: TodayUpcoming

    var body: some View {
        VStack(spacing: 14) {
            IllustrationCard(key: "heute", height: 150)
            VStack(spacing: 6) {
                TBLabel("Nächste Reise")
                Text(upcoming.title).tbTitle(24, weight: .bold)
                if let d = upcoming.daysUntil {
                    Text(d <= 0 ? "Beginnt heute" : (d == 1 ? "Noch 1 Tag" : "Noch \(d) Tage"))
                        .tbMono(16, weight: .medium, color: Palette.mute)
                }
                if let s = upcoming.startDate { Text("ab \(TBDate.display(s))").tbText(14, color: Palette.mute) }
            }
        }
    }
}

extension EventCatalogLoader {
    /// Der geladene Katalog für reine Darstellungs-Erweiterungen ohne Zugriff auf den Store.
    nonisolated(unsafe) static var shared: EventCatalog = bundled()
}
