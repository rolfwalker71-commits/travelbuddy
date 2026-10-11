import { api, apiUpload, ApiError, type UploadProgress } from "./client";
import type {
  Airport,
  Currency,
  Device,
  DirectoryUser,
  DocumentItem,
  Expense,
  ExpenseInput,
  EventInput,
  FxResult,
  GuestLedgerState,
  GuestTripState,
  InboxState,
  LedgerOverview,
  ManagedUser,
  Member,
  NotificationPrefs,
  ServerVersion,
  Settlement,
  SettlementInput,
  TodayState,
  TripAssignment,
  TripComment,
  TripDetail,
  TripInput,
  TripListItem,
  TripPhase,
} from "./types";

/** Gemeinsame Schreib-Schnittstelle der Reisekasse, für Konto und Gast-Link. */
export interface LedgerWriteApi {
  fx(from: string, to: string, date?: string): Promise<FxResult>;
  /** Währungsliste: Konto über `/v1/currencies`, Gast über den Einladungs-Link. */
  currencies(): Promise<Currency[]>;
  createExpense(input: ExpenseInput): Promise<Expense>;
  updateExpense(id: number, patch: Partial<ExpenseInput>): Promise<Expense>;
  deleteExpense(id: number): Promise<void>;
  createSettlement(input: SettlementInput): Promise<Settlement>;
}

const q = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fxPath = (from: string, to: string, date?: string) => `/v1/fx${q({ from, to, date })}`;

let accountCurrencies: Promise<Currency[]> | null = null;
/** Währungsliste des Kontos, einmal je Sitzung geladen. */
const cachedCurrencies = (): Promise<Currency[]> =>
  (accountCurrencies ??= currencies.list().catch((e) => {
    accountCurrencies = null;
    throw e;
  }));

export function accountLedgerApi(ledgerId: number): LedgerWriteApi {
  const base = `/v1/ledgers/${ledgerId}`;
  return {
    fx: (from, to, date) => api<FxResult>(fxPath(from, to, date)),
    currencies: cachedCurrencies,
    createExpense: async (input) => (await api<{ expense: Expense }>(`${base}/expenses`, { method: "POST", body: input })).expense,
    updateExpense: async (id, patch) =>
      (await api<{ expense: Expense }>(`${base}/expenses/${id}`, { method: "PATCH", body: patch })).expense,
    deleteExpense: async (id) => {
      await api(`${base}/expenses/${id}`, { method: "DELETE" });
    },
    createSettlement: async (input) =>
      (await api<{ settlement: Settlement }>(`${base}/settlements`, { method: "POST", body: input })).settlement,
  };
}

export function guestLedgerApi(token: string): LedgerWriteApi {
  const base = `/v1/guest/${encodeURIComponent(token)}`;
  return {
    fx: (from, to, date) => api<FxResult>(`${base}/fx${q({ from, to, date })}`, { anonymous: true }),
    currencies: () => api<{ currencies: Currency[] }>(`${base}/currencies`, { anonymous: true }).then((r) => r.currencies),
    createExpense: async (input) =>
      (await api<{ expense: Expense }>(`${base}/expenses`, { method: "POST", body: input, anonymous: true })).expense,
    updateExpense: async (id, patch) =>
      (await api<{ expense: Expense }>(`${base}/expenses/${id}`, { method: "PATCH", body: patch, anonymous: true })).expense,
    deleteExpense: async (id) => {
      await api(`${base}/expenses/${id}`, { method: "DELETE", anonymous: true });
    },
    createSettlement: async (input) =>
      (await api<{ settlement: Settlement }>(`${base}/settlements`, { method: "POST", body: input, anonymous: true }))
        .settlement,
  };
}

/* ─ Reisekasse (Konto) ─ */
export const ledgers = {
  overview: (id: number, signal?: AbortSignal) => api<LedgerOverview>(`/v1/ledgers/${id}`, { signal }),
  expenses: (id: number, signal?: AbortSignal) =>
    api<{ expenses: Expense[] }>(`/v1/ledgers/${id}/expenses`, { signal }).then((r) => r.expenses),
  settlements: (id: number, signal?: AbortSignal) =>
    api<{ settlements: Settlement[] }>(`/v1/ledgers/${id}/settlements`, { signal }).then((r) => r.settlements),
  update: (id: number, patch: { title?: string; archived?: boolean; baseCurrency?: string }) =>
    api<LedgerOverview>(`/v1/ledgers/${id}`, { method: "PATCH", body: patch }),
  addMember: (id: number, input: { displayName: string; email?: string | null; userId?: number | null }) =>
    api<{ member: Member }>(`/v1/ledgers/${id}/members`, { method: "POST", body: input }).then((r) => r.member),
  createCouple: (id: number, memberIds: number[], name?: string) =>
    api(`/v1/ledgers/${id}/couples`, { method: "POST", body: { memberIds, name: name || null } }),
  deleteCouple: (id: number, coupleId: number) => api(`/v1/ledgers/${id}/couples/${coupleId}`, { method: "DELETE" }),
  settleCouple: (id: number, expenseId: number) =>
    api(`/v1/ledgers/${id}/expenses/${expenseId}/settle-couple`, { method: "POST" }),
  deleteSettlement: (id: number, settlementId: number) =>
    api(`/v1/ledgers/${id}/settlements/${settlementId}`, { method: "DELETE" }),
};

export const guest = {
  ledger: (token: string, signal?: AbortSignal) =>
    api<GuestLedgerState>(`/v1/guest/${encodeURIComponent(token)}`, { anonymous: true, signal }),
  trip: (token: string, signal?: AbortSignal) =>
    api<GuestTripState>(`/v1/guest/trips/${encodeURIComponent(token)}`, { anonymous: true, signal }),
  comment: (token: string, eventId: number, body: string) =>
    api<{ comment: TripComment }>(`/v1/guest/trips/${encodeURIComponent(token)}/events/${eventId}/comments`, {
      method: "POST",
      anonymous: true,
      body: { body },
    }).then((r) => r.comment),
};

/** Server liefert `current` (HomeBuddy) oder `active` (TravelBuddy). */
export function normalizePhase(p: string | undefined | null): TripPhase {
  if (p === "active" || p === "current") return "active";
  if (p === "past") return "past";
  return "upcoming";
}

/* ─ Reisen ─ */
export const trips = {
  list: () =>
    api<{ trips: TripListItem[] }>("/v1/trips").then((r) =>
      r.trips.map((t) => ({ ...t, phase: normalizePhase(t.phase as string) }))
    ),
  create: (input: TripInput & { title: string; travelers?: { displayName: string; userId?: number | null }[] }) =>
    api<TripDetail>("/v1/trips", { method: "POST", body: input }),
  get: (id: number, signal?: AbortSignal) => api<TripDetail>(`/v1/trips/${id}`, { signal }),
  update: (id: number, patch: TripInput) => api<TripDetail>(`/v1/trips/${id}`, { method: "PATCH", body: patch }),
  /** Mit Buchungen in der Reisekasse antwortet der Server `409 has_ledger_entries`; `withLedger` löscht alles. */
  remove: (id: number, withLedger = false) => api(`/v1/trips/${id}${withLedger ? "?withLedger=1" : ""}`, { method: "DELETE" }),
  /** Server löst fehlende Koordinaten auf; `409 geocoder_not_configured`, wenn er keinen Dienst hat. */
  geocode: (id: number, eventId: number, force = false) =>
    api<TripDetail & { eventId: number }>(`/v1/trips/${id}/events/${eventId}/geocode`, { method: "POST", body: force ? { force: true } : {} }),
  updateTraveler: (
    id: number,
    travelerId: number,
    patch: { displayName?: string; email?: string | null; userId?: number | null }
  ) => api<TripDetail>(`/v1/trips/${id}/travelers/${travelerId}`, { method: "PATCH", body: patch }),
  addTraveler: (id: number, input: { displayName: string; email?: string | null; userId?: number | null }) =>
    api<TripDetail>(`/v1/trips/${id}/travelers`, { method: "POST", body: input }),
  removeTraveler: (id: number, travelerId: number) =>
    api<TripDetail>(`/v1/trips/${id}/travelers/${travelerId}`, { method: "DELETE" }),
  rotateShare: (id: number, travelerId: number) =>
    api<TripDetail>(`/v1/trips/${id}/travelers/${travelerId}/share/rotate`, { method: "POST" }),
  revokeShare: (id: number, travelerId: number) =>
    api<TripDetail>(`/v1/trips/${id}/travelers/${travelerId}/share/revoke`, { method: "POST" }),
  createEvent: (id: number, input: EventInput) =>
    api<TripDetail & { eventId: number }>(`/v1/trips/${id}/events`, { method: "POST", body: input }),
  updateEvent: (id: number, eventId: number, patch: EventInput) =>
    api<TripDetail>(`/v1/trips/${id}/events/${eventId}`, { method: "PATCH", body: patch }),
  deleteEvent: (id: number, eventId: number) => api<TripDetail>(`/v1/trips/${id}/events/${eventId}`, { method: "DELETE" }),
  confirmEvent: (id: number, eventId: number) =>
    api<TripDetail>(`/v1/trips/${id}/events/${eventId}/confirm`, { method: "POST" }),
  mergeEvent: (id: number, eventId: number, intoEventId: number) =>
    api<TripDetail>(`/v1/trips/${id}/events/${eventId}/merge`, { method: "POST", body: { intoEventId } }),
  reorder: (id: number, ids: number[]) =>
    api<TripDetail>(`/v1/trips/${id}/events/reorder`, { method: "POST", body: { ids } }),
  comment: (id: number, eventId: number, body: string) =>
    api<{ comment: TripComment }>(`/v1/trips/${id}/events/${eventId}/comments`, { method: "POST", body: { body } }).then(
      (r) => r.comment
    ),
  deleteComment: (id: number, eventId: number, commentId: number) =>
    api(`/v1/trips/${id}/events/${eventId}/comments/${commentId}`, { method: "DELETE" }),
  linkDocument: (id: number, eventId: number, documentId: number) =>
    api<TripDetail>(`/v1/trips/${id}/events/${eventId}/documents`, { method: "POST", body: { documentId } }),
  unlinkDocument: (id: number, eventId: number, documentId: number) =>
    api<TripDetail>(`/v1/trips/${id}/events/${eventId}/documents/${documentId}`, { method: "DELETE" }),
};

/* ─ Heute, Eingang, Dokumente ─ */
export const today = {
  get: (p: { date: string; tz: string }, signal?: AbortSignal) =>
    api<TodayState>(`/v1/today${q({ date: p.date, tz: p.tz })}`, { signal }),
  /** Tagesansicht einer Reise (gleiche Form wie `today`), z. B. als Vorschau eines Reisetags. */
  day: (tripId: number, date: string, tz?: string, signal?: AbortSignal) =>
    api<TodayState>(`/v1/trips/${tripId}/day/${date}${q({ tz })}`, { signal }),
};

export const inbox = {
  get: (signal?: AbortSignal) => api<InboxState>("/v1/inbox", { signal }),
};

/** Der Server liefert `{ document }`; eine blosse Dokumentform wird ebenfalls angenommen. */
const unwrapDoc = (r: { document: DocumentItem } | DocumentItem): DocumentItem => ("document" in r ? r.document : r);

export const documentsApi = {
  get: (id: number, signal?: AbortSignal) => api<{ document: DocumentItem } | DocumentItem>(`/v1/documents/${id}`, { signal }).then(unwrapDoc),
  /** Dokumente einer Reise; ältere Server kennen die Route nicht (`null` → Aufrufer leitet sie aus den Ereignissen ab). */
  listForTrip: async (tripId: number, signal?: AbortSignal): Promise<DocumentItem[] | null> => {
    try {
      const r = await api<{ documents: DocumentItem[] }>(`/v1/trips/${tripId}/documents`, { signal });
      return r.documents;
    } catch (e) {
      if (e instanceof ApiError && [404, 405].includes(e.status)) return null;
      throw e;
    }
  },
  /** Antwort `202 { document, duplicate }`: `duplicate`, wenn die Datei (Hash) schon vorhanden war. */
  uploadToTrip: (tripId: number, file: File, opts: { eventId?: number | null; onProgress?: UploadProgress; signal?: AbortSignal } = {}) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (opts.eventId != null) form.append("eventId", String(opts.eventId));
    return apiUpload<{ document: DocumentItem; duplicate?: boolean } | DocumentItem>(`/v1/trips/${tripId}/documents`, form, opts).then((r) =>
      "document" in r ? { document: r.document, duplicate: Boolean(r.duplicate) } : { document: r, duplicate: false }
    );
  },
  analyze: (id: number) => api<{ document: DocumentItem } | DocumentItem>(`/v1/documents/${id}/analyze`, { method: "POST" }).then(unwrapDoc),
  remove: (id: number) => api(`/v1/documents/${id}`, { method: "DELETE" }),
};

/* ─ Katalog, Flughäfen, Zeitzone, Karten, Version ─ */
export const meta = {
  eventTypes: (signal?: AbortSignal) => api<unknown>("/v1/meta/event-types", { signal }),
  airports: (query: string, signal?: AbortSignal) =>
    api<{ airports: Airport[] }>(`/v1/meta/airports${q({ q: query })}`, { signal }).then((r) => r.airports),
  timezone: (lat: number, lon: number, signal?: AbortSignal) =>
    api<{ tz: string }>(`/v1/meta/timezone${q({ lat, lon })}`, { signal }).then((r) => r.tz),
  version: () => api<ServerVersion>("/v1/version", { anonymous: true }),
};

/* ─ Konto, Benutzer, Geräte, Währungen ─ */
export const misc = {
  prefs: () => api<{ prefs: NotificationPrefs }>("/v1/me/notification-prefs").then((r) => r.prefs),
  setPrefs: (p: NotificationPrefs) =>
    api<{ prefs: NotificationPrefs }>("/v1/me/notification-prefs", { method: "PUT", body: p }).then((r) => r.prefs),
};

export const users = {
  directory: () => api<{ users: DirectoryUser[] }>("/v1/users/directory").then((r) => r.users),
  list: () => api<{ users: ManagedUser[] }>("/v1/users").then((r) => r.users),
  create: (input: { username: string; displayName: string; email?: string | null; password: string; isAdmin?: boolean }) =>
    api<{ user: ManagedUser }>("/v1/users", { method: "POST", body: input }).then((r) => r.user),
  update: (
    id: number,
    patch: { displayName?: string; email?: string | null; isAdmin?: boolean; active?: boolean; password?: string }
  ) => api<{ user: ManagedUser }>(`/v1/users/${id}`, { method: "PATCH", body: patch }).then((r) => r.user),
  remove: (id: number) => api<{ ok: true }>(`/v1/users/${id}`, { method: "DELETE" }),
  trips: (id: number, signal?: AbortSignal) =>
    api<{ trips: TripAssignment[] }>(`/v1/users/${id}/trips`, { signal }).then((r) => r.trips),
  setTrips: (id: number, tripIds: number[]) =>
    api<{ trips: TripAssignment[] }>(`/v1/users/${id}/trips`, { method: "PUT", body: { tripIds } }).then((r) => r.trips),
};

export const account = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true }>("/v1/me/password", { method: "POST", body: { currentPassword, newPassword } }),
  devices: () => api<{ devices: Device[] }>("/v1/me/devices").then((r) => r.devices),
  removeDevice: (id: number) => api<{ ok: true }>(`/v1/me/devices/${id}`, { method: "DELETE" }),
};

export const currencies = {
  list: () => api<{ currencies: Currency[] }>("/v1/currencies").then((r) => r.currencies),
};

/* ─ Bilder: Reise-Titelbild und Ereignisbild ─ */
export type MediaKind = "trip_cover" | "event_image";
export const mediaApi = {
  /** Eigenes Bild hochladen (Admin); ersetzt ein vorhandenes. */
  upload: (kind: MediaKind, ownerId: number, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return apiUpload<{ media: { url: string | null; source: string } }>(`/v1/media/${kind}/${ownerId}`, form, { method: "PUT" });
  },
  /** KI-Bild neu erzeugen, optional mit zusätzlichen Hinweisen (kann gut eine Minute dauern). */
  regenerate: (kind: MediaKind, ownerId: number, extra?: string) =>
    api<{ media: { url: string | null; source: string } }>(`/v1/media/${kind}/${ownerId}/regenerate`, {
      method: "POST",
      body: extra && extra.trim() ? { extra: extra.trim() } : {},
    }),
  /** Ereignisbilder einer Reise gesamthaft erzeugen: `missing` nur fehlende, `all` alle ausser eigenen Bildern. */
  generateTrip: (tripId: number, mode: "missing" | "all") =>
    api<{ queued: number; skipped: number; mode: string }>(`/v1/trips/${tripId}/event-images/generate`, { method: "POST", body: { mode } }),
  tripStatus: (tripId: number) =>
    api<{ enabled: boolean; job: { total: number; done: number; failed: number; running: boolean } | null }>(`/v1/trips/${tripId}/event-images/status`),
  /** Bild entfernen (wird nicht automatisch neu erzeugt). */
  remove: (kind: MediaKind, ownerId: number) =>
    api<{ media: { url: string | null } }>(`/v1/media/${kind}/${ownerId}`, { method: "DELETE" }),
};
