/**
 * Beispieldaten für die Fixture-Mocks (nur Entwicklung und Tests; keine echten Reisedaten).
 * Alle Daten hängen am heutigen Tag, damit die Reise immer «aktiv» ist (Tag 3 von 29).
 */
import type { DocumentItem, Expense, Traveler, TripComment, TripEvent } from "../api/types";
import { splitEqual } from "../lib/splits";

const pad = (n: number) => String(n).padStart(2, "0");
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export type MockDb = {
  nextId: number;
  user: { id: number; username: string; displayName: string; email: string | null; isAdmin: boolean };
  trips: MockTrip[];
  documents: (DocumentItem & { _polls: number; _tripId: number; _eventId: number | null })[];
  expenses: Expense[];
  settlements: unknown[];
  couples: { id: number; name: string; memberIds: number[] }[];
};

export type MockTrip = {
  id: number;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
  notes: string | null;
  homeCurrency: string;
  timezone: string;
  ledgerId: number;
  travelers: Traveler[];
  events: TripEvent[];
};

const ev = (id: number, tripId: number, p: Partial<TripEvent> & Pick<TripEvent, "type" | "title">): TripEvent => ({
  id,
  tripId,
  emoji: "",
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  startTz: null,
  endTz: null,
  location: null,
  address: null,
  provider: null,
  bookingReference: null,
  website: null,
  phone: null,
  lat: null,
  lon: null,
  notes: null,
  details: {},
  sortKey: id * 10,
  documentIds: [],
  documents: [],
  comments: [],
  status: "confirmed",
  participantIds: [],
  priceMinor: null,
  currency: null,
  paymentStatus: null,
  paidByParticipantId: null,
  cancelUntil: null,
  expenseId: null,
  fieldsMeta: {},
  sourceDocumentId: null,
  places: [],
  ...p,
});

export function createDb(today: string): MockDb {
  const start = addDays(today, -2);
  const d = (n: number) => addDays(start, n);
  const T = 1;
  const travelers: Traveler[] = [
    { id: 11, displayName: "Rolf", email: null, userId: 1, coupleId: 1, colorIndex: 0, shareToken: "tok_rolf_demo" },
    { id: 12, displayName: "Valentyna", email: null, userId: null, coupleId: 1, colorIndex: 1, shareToken: "tok_valentyna_demo" },
    { id: 13, displayName: "Eliane", email: null, userId: null, coupleId: null, colorIndex: 2, shareToken: "tok_eliane_demo" },
    { id: 14, displayName: "Harald", email: null, userId: null, coupleId: null, colorIndex: 3, shareToken: "tok_harald_demo" },
  ];
  const events: TripEvent[] = [
    ev(101, T, {
      type: "Flug",
      title: "Flug ZRH → BCN",
      startDate: d(0),
      startTime: "12:20",
      endDate: d(0),
      endTime: "14:05",
      location: "Zürich (ZRH)",
      provider: "Swiss",
      bookingReference: "K7M2QX",
      details: {
        airline: "Swiss",
        flightNumber: "LX 1952",
        cabinClass: "Economy",
        departureAirport: "ZRH",
        arrivalAirport: "BCN",
        departureTerminal: "2",
        departureGate: "A24",
        boardingTime: "11:40",
        checkInOpens: "09:20",
        checkInCloses: "11:30",
        durationMinutes: 105,
        passengers: [
          { participantId: 11, seat: "12C", ticketNumber: "724 2200 445 566" },
          { participantId: 12, seat: "12D" },
        ],
      },
      participantIds: [11, 12],
      priceMinor: 61200,
      currency: "CHF",
      paymentStatus: "paid",
      paidByParticipantId: 11,
      documentIds: [501],
      documents: [{ id: 501, title: "Swiss-Buchung.pdf" }],
      sourceDocumentId: 501,
      fieldsMeta: {
        title: { source: "manual", locked: true },
        "details.flightNumber": { source: "document", confidence: 0.99, documentId: 501, page: 1, quote: "Flug LX 1952 Zürich – Barcelona, 12:20" },
        "details.departureAirport": { source: "document", confidence: 0.98, documentId: 501, page: 1 },
        bookingReference: { source: "document", confidence: 0.99, documentId: 501, page: 1, quote: "Buchungscode K7M2QX" },
        "details.cabinClass": { source: "manual", locked: true },
      },
      places: [
        { role: "start", label: "ZRH", address: "Flughafen Zürich, Zürich, Schweiz", lat: 47.4647, lon: 8.5492 },
        { role: "end", label: "BCN", address: "Aeropuerto de Barcelona-El Prat, Barcelona, Spanien", lat: 41.2974, lon: 2.0833 },
      ],
    }),
    ev(102, T, {
      type: "Hotel",
      title: "Hotel Negresco Princess",
      startDate: d(0),
      endDate: d(2),
      startTime: "15:00",
      endTime: "12:00",
      location: "Barcelona",
      address: "Carrer de Pere IV 195, 08018 Barcelona, Spanien",
      provider: "Booking.com",
      bookingReference: "884-221-905",
      lat: 41.4036,
      lon: 2.2002,
      details: {
        checkInFrom: "15:00",
        checkOutUntil: "12:00",
        roomType: "Doppelzimmer",
        rooms: 2,
        guests: 4,
        board: "Fruehstueck",
        platform: "Booking.com",
        confirmationNumber: "884-221-905",
        accessCode: "Türcode 4471, Rezeption bis 22:00",
        wifi: "Negresco-Guest / reise2026",
      },
      priceMinor: 94000,
      currency: "EUR",
      paymentStatus: "deposit",
      cancelUntil: addDays(today, 6),
      documentIds: [502],
      documents: [{ id: 502, title: "Booking-Bestätigung.pdf" }],
      fieldsMeta: {
        address: { source: "document", confidence: 0.96, documentId: 502, page: 1, quote: "Carrer de Pere IV 195, 08018 Barcelona" },
        lat: { source: "geocoded", confidence: 0.9, quote: "Carrer de Pere IV 195, Barcelona" },
      },
      places: [{ role: "venue", label: "Hotel Negresco Princess", address: "Carrer de Pere IV 195, 08018 Barcelona, Spanien", lat: 41.4036, lon: 2.2002 }],
    }),
    ev(103, T, {
      type: "Kreuzfahrt",
      title: "Einschiffung Legend of the Seas",
      startDate: d(2),
      startTime: "13:00",
      endDate: d(2),
      endTime: "17:00",
      location: "Barcelona, Terminal Port Nou",
      address: "Moll Adossat, 08039 Barcelona, Spanien",
      provider: "Royal Caribbean",
      bookingReference: "RC-48213",
      lat: 41.3512,
      lon: 2.1594,
      details: {
        entryKind: "Einschiffung",
        shipLine: "Royal Caribbean",
        ship: "Legend of the Seas",
        cabin: "8142",
        cabinCategory: "Balkon",
        deck: "8",
        terminal: "Terminal Port Nou",
        checkInWindow: "13:00–14:30",
        allAboard: "16:30",
        emergencyPhone: "+34 93 000 00 00",
      },
      participantIds: [],
      places: [{ role: "venue", label: "Terminal Port Nou", address: "Moll Adossat, 08039 Barcelona, Spanien", lat: 41.3512, lon: 2.1594 }],
    }),
    ev(104, T, {
      type: "Kreuzfahrt",
      title: "Palma de Mallorca",
      startDate: d(3),
      startTime: "07:30",
      endDate: d(3),
      endTime: "15:30",
      location: "Palma de Mallorca",
      address: "Moll Vell, 07012 Palma, Spanien",
      lat: 39.5696,
      lon: 2.6502,
      details: { entryKind: "Hafen", ship: "Legend of the Seas", allAboard: "15:00" },
      places: [{ role: "venue", label: "Palma de Mallorca", address: "Moll Vell, 07012 Palma, Spanien", lat: 39.5696, lon: 2.6502 }],
    }),
    ev(105, T, {
      type: "Kreuzfahrt",
      title: "Málaga",
      startDate: d(4),
      startTime: "08:00",
      endDate: d(4),
      endTime: "17:00",
      location: "Málaga",
      address: "Muelle de Levante, 29016 Málaga, Spanien",
      lat: 36.7213,
      lon: -4.4214,
      details: { entryKind: "Hafen", ship: "Legend of the Seas", allAboard: "16:30" },
      places: [{ role: "venue", label: "Málaga", address: "Muelle de Levante, 29016 Málaga, Spanien", lat: 36.7213, lon: -4.4214 }],
    }),
    ev(106, T, {
      type: "Kreuzfahrt",
      title: "Cádiz",
      startDate: d(5),
      startTime: "08:00",
      endDate: d(5),
      endTime: "18:00",
      location: "Cádiz",
      lat: 36.5271,
      lon: -6.2886,
      details: { entryKind: "Hafen", ship: "Legend of the Seas", tender: true },
      places: [{ role: "venue", label: "Cádiz", address: null, lat: 36.5271, lon: -6.2886 }],
    }),
    ev(107, T, {
      type: "Mietauto",
      title: "Mietwagen Miami",
      startDate: d(27),
      startTime: "15:00",
      endDate: d(28),
      endTime: "10:00",
      location: "Miami",
      provider: "Hertz",
      bookingReference: "H-77310",
      details: {
        vehicleCategory: "Kompakt SUV",
        transmission: "Automat",
        pickupPlace: "Miami International Airport",
        pickupHours: "05:00–24:00",
        returnPlace: "Fort Lauderdale Airport",
        emergencyPhone: "+1 800 555 0100",
      },
      places: [
        { role: "pickup", label: "Miami International Airport", address: "2100 NW 42nd Ave, Miami, FL 33126, USA", lat: null, lon: null },
        { role: "return", label: "Fort Lauderdale Airport", address: "100 Terminal Dr, Fort Lauderdale, FL 33315, USA", lat: 26.0742, lon: -80.1506 },
      ],
    }),
    ev(108, T, {
      type: "Flug",
      title: "Flug MIA → LIS",
      startDate: d(26),
      startTime: "16:50",
      endDate: d(27),
      endTime: "06:00",
      startTz: "America/New_York",
      endTz: "Europe/Lisbon",
      details: { airline: "TAP", flightNumber: "TP 202", departureAirport: "MIA", arrivalAirport: "LIS", departureTerminal: "D" },
      places: [
        { role: "start", label: "MIA", address: "Miami International Airport", lat: 25.7959, lon: -80.287 },
        { role: "end", label: "LIS", address: "Aeroporto de Lisboa", lat: 38.7813, lon: -9.1359 },
      ],
    }),
    ev(109, T, {
      type: "Aufgabe",
      title: "ESTA prüfen und Online-Check-in",
      startDate: addDays(today, 1),
      details: { done: false },
    }),
    ev(110, T, {
      type: "Restaurant",
      title: "Abendessen Tapas",
      startDate: today,
      startTime: "20:30",
      location: "Barcelona",
      address: "Carrer del Parlament 53, Barcelona",
      details: { reservationName: "Walker", partySize: 4, table: "12" },
      places: [{ role: "venue", label: "Cal Pep", address: "Carrer del Parlament 53, Barcelona", lat: null, lon: null }],
    }),
    // Vorschläge aus einem Dokument
    ev(120, T, {
      type: "Hotel",
      title: "Hotel Rosa dels Vents",
      startDate: d(1),
      endDate: d(2),
      status: "needs_review",
      location: "Barcelona",
      address: "Carrer de la Mar 12, Barcelona",
      bookingReference: "884-221-905",
      sourceDocumentId: 503,
      documentIds: [503],
      documents: [{ id: 503, title: "Hotelbestätigung-2.pdf" }],
      details: { roomType: "Suite" },
      fieldsMeta: {
        title: { source: "document", confidence: 0.71, documentId: 503, page: 2, quote: "Hotel Rosa dels Vents · Check-in 24.10.2026 · Check-out 25.10.2026" },
        bookingReference: { source: "document", confidence: 0.95, documentId: 503, page: 1, quote: "Bestätigung 884-221-905" },
      },
    }),
    ev(121, T, {
      type: "Ausflug",
      title: "Stadtrundfahrt Palma",
      startDate: d(3),
      startTime: "09:30",
      status: "proposed",
      sourceDocumentId: 504,
      documentIds: [504],
      documents: [{ id: 504, title: "Ausflug-Voucher.pdf" }],
      details: { meetingPoint: "Pier 2, vor dem Terminal", voucher: "PMI-4411" },
      fieldsMeta: {
        title: { source: "document", confidence: 0.97, documentId: 504, page: 1, quote: "Stadtrundfahrt Palma, Treffpunkt Pier 2, 09:30" },
      },
    }),
  ];
  const documents: MockDb["documents"] = [
    mkDoc(501, "Swiss-Buchung", T, 101, "done", 2),
    mkDoc(502, "Booking-Bestätigung", T, 102, "done", 1),
    mkDoc(503, "Hotelbestätigung-2", T, 120, "done", 3),
    mkDoc(504, "Ausflug-Voucher", T, 121, "done", 1),
  ];
  const mk = (id: number, paidBy: number, minor: number, cur: string, desc: string, cat: string, day: number, share: number[]): Expense => {
    const base = cur === "CHF" ? minor : Math.round(minor * 0.94);
    return {
    id,
    ledgerId: 1,
    paidByMemberId: paidBy,
    createdByMemberId: paidBy,
    direction: "expense",
    amountMinor: minor,
    currency: cur,
    exchangeRate: cur === "CHF" ? 1 : 0.94,
    amountBaseMinor: base,
    description: desc,
    expenseDate: addDays(start, day),
    category: cat,
    note: null,
    splitMode: "equal",
    settledStatus: 0,
    tripEventId: null,
    splits: [...splitEqual(base, share)].map(([memberId, shareBaseMinor]) => ({ memberId, shareBaseMinor, shareUnits: null })),
    createdAt: `${addDays(start, day)}T10:00:00.000Z`,
    updatedAt: `${addDays(start, day)}T10:00:00.000Z`,
  };
  };
  const all = [11, 12, 13, 14];
  const expenses: Expense[] = [
    mk(1, 11, 61200, "CHF", "Flüge Swiss", "Flug", 0, all),
    mk(2, 12, 12400, "EUR", "Taxi und Gepäck", "Transfer", 0, all),
    mk(3, 13, 28000, "EUR", "Abendessen Barcelona", "Essen", 1, all),
    mk(4, 11, 9400, "EUR", "Metro-Karten", "Transfer", 1, all),
    mk(5, 14, 15600, "EUR", "Sagrada Família", "Aktivität", 2, [11, 12, 14]),
  ];
  documents[1]!.addresses = [
    { eventId: 102, label: "Hotel Negresco Princess", address: "Carrer de Pere IV 195, 08018 Barcelona, Spanien", lat: 41.4036, lon: 2.2002 },
  ];
  return {
    nextId: 1000,
    user: { id: 1, username: "rolf", displayName: "Rolf", email: "rolf@example.test", isAdmin: true },
    trips: [
      {
        id: T,
        title: "Ferien 2026",
        destination: "Barcelona → Florida",
        startDate: start,
        endDate: addDays(start, 28),
        summary: "Kreuzfahrt von Barcelona über den Atlantik nach Florida, danach vier Tage Mietwagen.",
        notes: null,
        homeCurrency: "CHF",
        timezone: "Europe/Madrid",
        ledgerId: 1,
        travelers,
        events,
      },
      {
        id: 2,
        title: "Lissabon-Wochenende",
        destination: "Lissabon",
        startDate: addDays(today, 60),
        endDate: addDays(today, 63),
        summary: null,
        notes: null,
        homeCurrency: "CHF",
        timezone: "Europe/Lisbon",
        ledgerId: 2,
        travelers: [{ id: 21, displayName: "Rolf", email: null, userId: 1, colorIndex: 0, shareToken: "tok_lis" }],
        events: [],
      },
    ],
    documents,
    expenses,
    settlements: [],
    couples: [{ id: 1, name: "Rolf und Valentyna", memberIds: [11, 12] }],
  };
}

function mkDoc(id: number, title: string, tripId: number, eventId: number | null, status: DocumentItem["analysisStatus"], pages: number) {
  return {
    id,
    title,
    fileName: `${title}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 120_000 + id * 1000,
    pages,
    createdAt: new Date(Date.now() - id * 3_600_000).toISOString(),
    analysisStatus: status,
    summary: null,
    tripIds: [tripId],
    eventIds: eventId ? [eventId] : [],
    thumbnailUrl: `/v1/documents/${id}/thumbnail`,
    fileUrl: `/v1/documents/${id}/file`,
    _polls: 0,
    _tripId: tripId,
    _eventId: eventId,
  };
}

export { mkDoc };
export type { TripComment };
