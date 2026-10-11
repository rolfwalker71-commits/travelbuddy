import { api } from "./client";

export type MapsToken = { enabled: false } | { enabled: true; token: string; expiresAt: string };

export const maps = {
  token: (signal?: AbortSignal) => api<MapsToken>("/v1/maps/token", { signal }),
};
