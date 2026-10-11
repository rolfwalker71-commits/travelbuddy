import type { DocumentItem, TripEvent } from "../api/types";

/** Titel bekannter Dokumente (aus Ereignissen und Dokumentlisten), damit Verweise lesbar sind. */
const titles = new Map<number, string>();

export function learnDocumentTitles(events: TripEvent[]): void {
  for (const e of events) {
    for (const d of e.documents ?? []) if (d.title) titles.set(d.id, d.title);
  }
}

export function learnDocuments(docs: DocumentItem[]): void {
  for (const d of docs) titles.set(d.id, d.title || d.fileName);
}

export function documentTitle(id: number): string {
  return titles.get(id) ?? `Dokument ${id}`;
}
