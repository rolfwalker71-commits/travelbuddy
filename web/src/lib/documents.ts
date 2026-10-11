import { ApiError } from "../api/client";

export type DocumentErrorInfo = {
  title: string;
  text: string;
  /** Erneutes Laden kann helfen. */
  retry: boolean;
};

/** Fehler beim Laden von Datei oder Vorschau (`/v1/documents/:id/file|thumbnail`) mit eigenen Texten. */
export function documentErrorInfo(e: unknown): DocumentErrorInfo {
  const code = e instanceof ApiError ? e.code : e instanceof Error && /network/i.test(e.name) ? "network" : "unknown";
  const status = e instanceof ApiError ? e.status : 0;
  if (code === "network" || status === 0) {
    return {
      title: "Keine Verbindung",
      text: "Der TravelBuddy-Server ist nicht erreichbar. Bitte die Verbindung prüfen.",
      retry: true,
    };
  }
  if (status === 404 || code === "document_not_found") {
    return {
      title: "Dokument nicht gefunden",
      text: "Das Dokument wurde entfernt oder gehört nicht zu dieser Reise.",
      retry: false,
    };
  }
  if (status === 403) {
    return { title: "Kein Zugriff", text: "Für dieses Dokument fehlt die Berechtigung.", retry: false };
  }
  return {
    title: "Dokument nicht verfügbar",
    text: e instanceof Error && e.message ? e.message : "Das Dokument konnte nicht geladen werden.",
    retry: true,
  };
}
