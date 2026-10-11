import { HttpError } from "../lib/errors";
import { todayLocal } from "../lib/dates";

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type FxResult = {
  from: string;
  to: string;
  /** Einheiten `to` pro 1 Einheit `from`. */
  rate: number;
  date: string;
  source: "ECB";
};

/** EZB-Referenzkurse über Frankfurter (ohne API-Key). */
export async function fetchEcbRate(
  input: { from: string; to: string; date?: string },
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<FxResult> {
  const { from, to } = input;
  if (from === to) {
    return { from, to, rate: 1, date: input.date ?? todayLocal(), source: "ECB" };
  }
  const url = new URL(`https://api.frankfurter.dev/v1/${input.date ?? "latest"}`);
  url.searchParams.set("base", from);
  url.searchParams.set("symbols", to);

  let res;
  try {
    res = await doFetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    throw new HttpError(502, "fx_unavailable", "Wechselkurs-Dienst nicht erreichbar");
  }
  if (!res.ok) {
    throw new HttpError(502, "fx_unavailable", `EZB-Kurs konnte nicht geladen werden (${res.status})`);
  }
  const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const rate = data.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new HttpError(502, "fx_unavailable", `Kein EZB-Kurs für ${from} → ${to}`);
  }
  return {
    from,
    to,
    rate: Math.round(rate * 1e6) / 1e6,
    date: data.date ?? input.date ?? todayLocal(),
    source: "ECB",
  };
}
