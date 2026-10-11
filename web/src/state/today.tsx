import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { today as todayApi } from "../api/endpoints";
import type { TodayState } from "../api/types";
import { todayIso } from "../lib/dates";
import { useAuth } from "./auth";

type Ctx = {
  /** `undefined`, solange nichts geladen ist; sonst die Antwort von `GET /v1/today`. */
  data: TodayState | null | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
};

const TodayCtx = createContext<Ctx>({ data: undefined, error: null, loading: false, reload: () => undefined });

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich";
  } catch {
    return "Europe/Zurich";
  }
}

/** Lädt «Heute» einmal für die Navigation und die Heute-Seite; neu bei Fokus und alle 5 Minuten. */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [data, setData] = useState<TodayState | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (status !== "authed") return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    todayApi
      .get({ date: todayIso(), tz: deviceZone() }, c.signal)
      .then((d) => {
        if (c.signal.aborted) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        setError(e);
        setData((p) => (p === undefined ? null : p));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [status, tick]);

  useEffect(() => {
    if (status !== "authed") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => setTick((t) => t + 1), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [status]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const value = useMemo(() => ({ data, error, loading, reload }), [data, error, loading, reload]);
  return <TodayCtx.Provider value={value}>{children}</TodayCtx.Provider>;
}

export const useToday = (): Ctx => useContext(TodayCtx);
