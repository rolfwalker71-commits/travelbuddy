import { useOutletContext } from "react-router-dom";
import type { EventInput, TripDetail, TripEvent } from "../../api/types";
import type { Catalog } from "../../lib/catalog";

/** Gemeinsamer Zustand der Reise-Tabs (aus `TripLayout`). */
export type TripCtx = {
  data: TripDetail;
  /** Neue Fassung der Reise übernehmen (Antwort des Servers). */
  apply: (next: TripDetail) => void;
  reload: () => void;
  catalog: Catalog;
  tripTz: string;
  homeCurrency: string;
  isAdmin: boolean;
  userId: number | null;
  /** Teilnehmer-ID des angemeldeten Benutzers auf dieser Reise. */
  meId: number | null;
  openEventForm: (event: TripEvent | null, opts?: { defaultDate?: string | null; type?: string }) => void;
  openDocument: (documentId: number, page?: number, title?: string) => void;
  saveEvent: (event: TripEvent, patch: EventInput) => Promise<void>;
  toLedger: (event: TripEvent) => void;
  deleteEvent: (event: TripEvent) => Promise<void>;
};

export function useTripCtx(): TripCtx {
  return useOutletContext<TripCtx>();
}
