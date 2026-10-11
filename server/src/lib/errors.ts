export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 416 | 422 | 429 | 500 | 502;

/** Fehler mit stabilem `code` für Clients und deutscher `message` für Menschen. */
export class HttpError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) =>
  new HttpError(404, "not_found", `${what} nicht gefunden`);
export const forbidden = (message = "Kein Zugriff") =>
  new HttpError(403, "forbidden", message);
export const badRequest = (message: string, code = "bad_request") =>
  new HttpError(400, code, message);
export const conflict = (message: string, code = "conflict") =>
  new HttpError(409, code, message);
