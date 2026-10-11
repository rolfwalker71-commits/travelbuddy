/** Beispiel-Mitteilungen für die Diagnose (`POST /v1/push/test`): vollständige Nutzlast samt Ticket, ohne echte Daten. */
import type { Notice, NotificationKind } from "../push/notifier";
import { dateDe, isoUtc, weekdayDateDe } from "./text";

const HOUR = 3_600_000;

export function sampleNotice(kind: NotificationKind, userId: number, now: Date): Notice {
  const at = (h: number) => isoUtc(now.getTime() + h * HOUR);
  const today = now.toISOString().slice(0, 10);
  const base = { userId, dedupeKey: `test:${kind}:${now.getTime()}`, threadId: "trip-0" };
  const trip = { tripTitle: "Beispielreise Barcelona" };
  const flight = {
    type: "Flug",
    icon: "plane",
    color: "air",
    title: "Flug LX 1952",
    startAt: at(3),
    tz: "Europe/Zurich",
    from: "ZRH",
    to: "BCN",
    place: "Flughafen Zürich",
    reference: "X7K2QD",
    tripTitle: trip.tripTitle,
    dayIndex: 1,
    dayCount: 9,
    facts: [
      { label: "Abflug", value: `${dateDe(today)} ${at(3).slice(11, 16)}` },
      { label: "Gate", value: "B42" },
      { label: "Sitz", value: "12C" },
    ],
  };
  switch (kind) {
    case "trip.depart":
      return {
        ...base, kind, title: "Abflug in 3 Stunden", body: "ZRH → BCN · LX 1952 · Gate B42 · Testmeldung",
        deepLink: "travelbuddy://today", interruption: "time-sensitive", ticket: flight,
      };
    case "trip.today":
      return {
        ...base, kind, title: "Heute: Tag 3 von 9 · Barcelona", body: `${weekdayDateDe(today)}: 09:30 Frühstück, 14:00 Sagrada Familia · Testmeldung`,
        deepLink: "travelbuddy://today",
        ticket: {
          title: "Heute: Tag 3 von 9", startDate: today, tz: "Europe/Madrid", tripTitle: trip.tripTitle, dayIndex: 3, dayCount: 9, count: 2,
          items: [
            { time: "09:30", title: "Frühstück", type: "Restaurant", icon: "fork", color: "food" },
            { time: "14:00", title: "Sagrada Familia", type: "Ausflug", icon: "map", color: "activity" },
          ],
        },
      };
    case "trip.stay":
      return {
        ...base, kind, title: "Check-in heute", body: "Hotel Arts · ab 15:00 · Testmeldung", deepLink: "travelbuddy://today",
        ticket: { type: "Hotel", icon: "bed", color: "stay", title: "Hotel Arts", startDate: today, startTime: "15:00", tz: "Europe/Madrid", address: "Carrer de la Marina 19-21, Barcelona", tripTitle: trip.tripTitle, facts: [{ label: "Check-in", value: "ab 15:00" }] },
      };
    case "trip.pickup":
      return {
        ...base, kind, title: "Mietwagen abholen in 2 Stunden", body: "Sixt · Flughafen Barcelona · Testmeldung",
        deepLink: "travelbuddy://today", interruption: "time-sensitive",
        ticket: { type: "Mietauto", icon: "car", color: "car", title: "Mietwagen", startAt: at(2), tz: "Europe/Madrid", place: "Flughafen Barcelona", reference: "SX-4411", tripTitle: trip.tripTitle },
      };
    case "trip.deadline":
      return {
        ...base, kind, title: "Stornofrist in 3 Tagen", body: "Hotel Arts: kostenlos stornierbar bis 28.10.2026. · Testmeldung",
        deepLink: "travelbuddy://today",
        ticket: { type: "Hotel", icon: "bed", color: "stay", title: "Hotel Arts", tripTitle: trip.tripTitle, deadlineKind: "cancel", facts: [{ label: "Kostenlos stornierbar bis", value: "28.10.2026" }] },
      };
    case "trip.review":
      return {
        ...base, kind, title: "3 Vorschläge zu prüfen", body: "Beispielreise Barcelona: Neue Vorschläge aus Dokumenten warten auf Bestätigung. · Testmeldung",
        deepLink: "travelbuddy://inbox", ticket: { icon: "doc", color: "doc", title: "3 Vorschläge zu prüfen", tripTitle: trip.tripTitle, count: 3 },
      };
    case "trip.comment":
      return { ...base, kind, title: "Beispielreise Barcelona", body: "Anna: Treffpunkt am Eingang? · Testmeldung", deepLink: "travelbuddy://today" };
    case "ledger.expense":
      return { ...base, kind, threadId: "ledger-0", title: "Reisekasse: Beispielreise", body: "Anna: Abendessen · CHF 84.50 · Testmeldung", deepLink: "travelbuddy://today", data: { ledgerId: 0, expenseId: 0 } };
    case "ledger.settlement":
      return { ...base, kind, threadId: "ledger-0", title: "Reisekasse: Beispielreise", body: "Ben hat dir CHF 15.50 zurückgezahlt · Testmeldung", deepLink: "travelbuddy://today", data: { ledgerId: 0, settlementId: 0 } };
  }
}
