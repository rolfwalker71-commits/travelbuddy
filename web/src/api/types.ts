/** Formen der `/v1`-API (docs/CONTRACT.md; Abrechnung unverändert aus HomeBuddy). */

export type User = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
};

/* ───── Reisekasse (Abrechnung) ───── */

export type Direction = "expense" | "income";
export type SplitMode = "equal" | "coupleEqual" | "exact" | "shares";

export type Ledger = {
  id: number;
  title: string;
  baseCurrency: string;
  kind?: "split" | "cashbook";
  tripId: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  coverUrl?: string | null;
};

export type Member = {
  id: number;
  displayName: string;
  email: string | null;
  userId: number | null;
  coupleId: number | null;
  hidden?: boolean;
  /** Nur bei angemeldeten Aufrufen; `null` = Link widerrufen. */
  inviteToken?: string | null;
};

export type Couple = { id: number; name: string; memberIds: number[] };

export type Balance = {
  memberId: number;
  displayName: string;
  paidMinor: number;
  owedMinor: number;
  settlementsPaidMinor: number;
  settlementsReceivedMinor: number;
  netMinor: number;
};

export type Transfer = {
  fromMemberId: number;
  fromName: string;
  toMemberId: number;
  toName: string;
  amountMinor: number;
};

export type LedgerOverview = {
  ledger: Ledger;
  myMemberId?: number | null;
  members: Member[];
  couples: Couple[];
  totals: { expenseMinor: number; incomeMinor: number; netMinor: number; count: number };
  balances: Balance[];
  suggestedTransfers: Transfer[];
  payerDebts: Transfer[];
  steps?: unknown[];
};

export type ExpenseSplit = { memberId: number; shareBaseMinor: number; shareUnits: number | null };

export type Expense = {
  id: number;
  ledgerId: number;
  paidByMemberId: number;
  createdByMemberId: number | null;
  direction: Direction;
  amountMinor: number;
  currency: string;
  exchangeRate: number;
  amountBaseMinor: number;
  description: string | null;
  expenseDate: string | null;
  category: string | null;
  note: string | null;
  splitMode: SplitMode;
  /** 0 offen, 1 automatisch ausgeglichen, 2 Paar-Ausgleich. */
  settledStatus: 0 | 1 | 2;
  documentId?: number | null;
  tripEventId: number | null;
  place?: { name: string | null; lat: number | null; lon: number | null } | null;
  splits: ExpenseSplit[];
  createdAt: string;
  updatedAt: string;
};

export type Settlement = {
  id: number;
  ledgerId: number;
  fromMemberId: number;
  toMemberId: number;
  amountMinor: number;
  currency: string;
  exchangeRate: number;
  amountBaseMinor: number;
  note: string | null;
  settledAt: string;
  relatedExpenseId: number | null;
  auto: boolean;
  createdAt: string;
};

export type GuestLedgerState = LedgerOverview & {
  me: { memberId: number; displayName: string };
  expenses: Expense[];
  settlements: Settlement[];
};

export type SplitInput =
  | { mode: "equal"; memberIds?: number[] }
  | { mode: "coupleEqual"; coupleIds?: number[] }
  | { mode: "exact"; amounts: { memberId: number; amountBaseMinor: number }[] }
  | { mode: "shares"; shares: { memberId: number; units: number }[] };

export type ExpenseInput = {
  paidByMemberId?: number;
  amountMinor: number;
  currency: string;
  exchangeRate?: number;
  direction?: Direction;
  description?: string | null;
  expenseDate?: string | null;
  category?: string | null;
  note?: string | null;
  split?: SplitInput;
  preSettled?: boolean;
  /** Verknüpfung mit dem Ereignis, aus dem die Ausgabe stammt («In Reisekasse übernehmen»). */
  tripEventId?: number | null;
};

export type SettlementInput = {
  fromMemberId: number;
  toMemberId: number;
  amountMinor: number;
  currency?: string;
  exchangeRate?: number;
  note?: string | null;
  settledAt?: string | null;
};

export type FxResult = { from: string; to: string; rate: number; date: string; source: "ECB" };

/* ───── Reisen ───── */

export type TripPhase = "upcoming" | "active" | "past";

export type TripListItem = {
  id: number;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  eventCount: number;
  documentCount?: number;
  travelerCount: number;
  ledgerId: number | null;
  nextEvent: { id: number; type: string; title: string; startDate: string; startTime: string | null } | null;
  phase: TripPhase;
  needsReviewCount?: number;
  homeCurrency?: string;
  timezone?: string;
  coverUrl?: string | null;
};

export type EventStatus = "confirmed" | "proposed" | "needs_review";
export type PaymentStatus = "open" | "paid" | "deposit" | "onsite";

/** Passagier-/Platzdaten je Teilnehmer (`details.passengers`). */
export type PassengerRow = { participantId: number; seat?: string; ticketNumber?: string; [k: string]: unknown };

/** `details` enthält ausschliesslich Schlüssel aus dem Katalog des Typs. */
export type EventDetails = Record<string, string | number | boolean | PassengerRow[] | null | undefined>;

export type FieldSource = "manual" | "document" | "derived" | "geocoded";
export type FieldMeta = {
  source: FieldSource;
  confidence?: number;
  documentId?: number;
  page?: number;
  quote?: string;
  locked?: boolean;
};

export type EventPlaceRole = "start" | "end" | "pickup" | "return" | "venue" | "stop";
export type EventPlace = {
  role: EventPlaceRole;
  label: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Herkunft der Koordinaten (Server): von Hand, per Kartensuche, Flughafentabelle, abgeleitet. */
  source?: "manual" | "geocoded" | "airport" | "derived" | null;
};

export type TripComment = {
  id: number;
  eventId: number;
  userId: number | null;
  author: string;
  body: string;
  createdAt: string;
};

export type TripEvent = {
  id: number;
  tripId: number;
  type: string;
  emoji?: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  startTz?: string | null;
  endTz?: string | null;
  location: string | null;
  address: string | null;
  provider: string | null;
  bookingReference: string | null;
  website: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  details: EventDetails;
  sortKey: number;
  documentIds: number[];
  documents?: { id: number; title: string | null }[];
  comments: TripComment[];
  imageUrl?: string | null;
  mapUrl?: string | null;
  status?: EventStatus;
  participantIds?: number[];
  priceMinor?: number | null;
  currency?: string | null;
  paymentStatus?: PaymentStatus | null;
  paidByParticipantId?: number | null;
  cancelUntil?: string | null;
  expenseId?: number | null;
  fieldsMeta?: Record<string, FieldMeta>;
  sourceDocumentId?: number | null;
  places?: EventPlace[];
};

export type Traveler = {
  id: number;
  displayName: string;
  email: string | null;
  userId: number | null;
  coupleId?: number | null;
  colorIndex?: number;
  /** Nur bei angemeldeten Aufrufen; `null` = Link widerrufen. */
  shareToken?: string | null;
};

export type TripCore = {
  id: number;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
  notes: string | null;
  ledgerId: number | null;
  createdAt: string;
  updatedAt: string;
  coverUrl?: string | null;
  homeCurrency?: string;
  timezone?: string;
  phase?: TripPhase;
  needsReviewCount?: number;
  status?: string;
};

export type TripDetail = {
  trip: TripCore;
  travelers: Traveler[];
  events: TripEvent[];
  /** Falls der Server die Dokumente der Reise gleich mitliefert. */
  documents?: DocumentItem[];
};

export type GuestTripState = TripDetail & { me: { travelerId: number; displayName: string } };

export type EventInput = Partial<{
  type: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  startTz: string | null;
  endTz: string | null;
  location: string | null;
  address: string | null;
  provider: string | null;
  bookingReference: string | null;
  website: string | null;
  phone: string | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  details: EventDetails;
  participantIds: number[];
  priceMinor: number | null;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  paidByParticipantId: number | null;
  cancelUntil: string | null;
  status: EventStatus;
  /** Koordinaten weiterer Orte je Rolle (der erste Ort nutzt `lat`/`lon`). */
  placeCoords: Record<string, { lat: number; lon: number } | null>;
  /** Sperre setzen/aufheben; `null` entfernt den Eintrag. */
  fieldsMeta: Record<string, { locked: boolean } | null>;
}>;

export type TripInput = {
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  homeCurrency?: string;
  timezone?: string;
};

/* ───── Dokumente ───── */

export type AnalysisStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export type DocumentItem = {
  id: number;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pages: number | null;
  sha256?: string;
  createdAt: string;
  analysisStatus: AnalysisStatus;
  analysisError?: string | null;
  summary?: string | null;
  tripIds: number[];
  eventIds: number[];
  /** `null`, wenn der Server keine Vorschau liefern kann (dann rendert der Client selbst). */
  thumbnailUrl?: string | null;
  fileUrl?: string;
  /** Vom Server erkannte Adressen (optional; sonst aus den Ereignissen abgeleitet). */
  addresses?: { label: string | null; address: string; lat: number | null; lon: number | null; eventId?: number | null }[];
};

export type InboxState = {
  documents: DocumentItem[];
  review: { tripId: number; tripTitle: string; event: TripEvent }[];
};

/* ───── Heute ───── */

export type TodayTrip = {
  id: number;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  dayIndex: number;
  dayCount: number;
  coverUrl?: string | null;
  timezone: string;
};

export type TodayState = {
  generatedAt: string;
  trip: TodayTrip | null;
  upcoming?: { id: number; title: string; startDate: string; daysUntil: number } | null;
  date: string;
  now?: { local: string; tz: string };
  next: TripEvent | null;
  nextInSeconds: number | null;
  events: TripEvent[];
  tomorrow: TripEvent[];
  tasks: { eventId: number; title: string; dueDate: string | null }[];
  deadlines: { eventId: number; title: string; kind: "cancel" | "payment"; date: string }[];
  review: number;
  ledger: { id: number; balanceMinor: number; currency: string; title?: string; myMemberId?: number | null } | null;
};

/* ───── Katalog, Flughäfen ───── */

export type Airport = { iata: string; name: string; city: string; country: string; lat: number; lon: number; tz: string };

/* ───── Konto, Einstellungen ───── */

/** Vorlaufzeiten der Mitteilungen (Server: `leadTimes`). */
export type LeadTimes = { departHours: number[]; checkoutMinutes: number; deadlineDays: number; todayBriefing: string };

/** Schalter je Mitteilungsart (camelCase: tripToday, …) plus `leadTimes`; weitere Schlüssel erscheinen mit ihrem Namen. */
export type NotificationPrefs = Record<string, boolean | number | string | LeadTimes | null | undefined> & { leadTimes?: LeadTimes };

export type DirectoryUser = { id: number; displayName: string };

export type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  active: boolean;
};

/** Reise in der Zuweisung eines Benutzers (Benutzerverwaltung). */
export type TripAssignment = {
  id: number;
  title: string;
  status?: string;
  startDate: string | null;
  endDate: string | null;
  assigned: boolean;
};

export type Device = {
  id: number;
  name: string | null;
  platform: string | null;
  appVersion?: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  push: boolean;
  current: boolean;
};

export type Currency = { code: string; name: string; exponent: number };

export type ServerVersion = { name: string; version: string; build: string; builtAt: string; api: number };
