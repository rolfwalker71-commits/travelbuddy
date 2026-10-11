import type { TripEvent } from "../api/types";

/** Minimales Ereignis für Tests. */
export function ev(p: Partial<TripEvent> & Pick<TripEvent, "type">): TripEvent {
  return {
    id: 1,
    tripId: 1,
    title: "Ereignis",
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
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
    sortKey: 10,
    documentIds: [],
    comments: [],
    ...p,
  };
}
