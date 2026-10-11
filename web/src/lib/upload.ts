/** Prüfung und Anzeige von Uploads (Vertrag: 25 MB; PDF, JPG, PNG, HEIC, .pkpass, .ics; Typ per Dateikopf serverseitig). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const EXT = ["pdf", "jpg", "jpeg", "png", "heic", "heif", "pkpass", "ics"];
export const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.pkpass,.ics,application/pdf,image/jpeg,image/png,image/heic,text/calendar";

export type FileCheck = { ok: true } | { ok: false; error: string };

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function checkUploadFile(file: { name: string; size: number }): FileCheck {
  if (file.size === 0) return { ok: false, error: `«${file.name}» ist leer.` };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `«${file.name}» ist grösser als 25 MB.` };
  if (!EXT.includes(extensionOf(file.name))) {
    return { ok: false, error: `«${file.name}»: erlaubt sind PDF, JPG, PNG, HEIC, Wallet-Pässe (.pkpass) und Kalenderdateien (.ics).` };
  }
  return { ok: true };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function titleFromFileName(name: string): string {
  const i = name.lastIndexOf(".");
  return (i > 0 ? name.slice(0, i) : name).replace(/[_]+/g, " ").trim();
}

/** Fortschritt in Prozent (0–100). */
export function percent(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

export const ANALYSIS_LABEL: Record<string, string> = {
  pending: "Wartet auf Analyse",
  processing: "Wird ausgewertet",
  done: "Ausgewertet",
  failed: "Auswertung fehlgeschlagen",
  skipped: "Nicht ausgewertet",
};

/** Läuft die Auswertung noch (Polling nötig)? */
export function isAnalysisActive(status: string): boolean {
  return status === "pending" || status === "processing";
}
