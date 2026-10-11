import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setUnauthorizedHandler, tokenStore } from "../api/client";
import type { User } from "../api/types";

type Status = "loading" | "authed" | "anon";

type AuthValue = {
  status: Status;
  user: User | null;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(tokenStore.get() ? "loading" : "anon");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setUser(null);
      setStatus("anon");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let alive = true;
    api<{ user: User }>("/v1/me")
      .then((r) => {
        if (!alive) return;
        setUser(r.user);
        setStatus("authed");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) tokenStore.clear();
        // Netzfehler: angemeldet bleiben, aber ohne Nutzerdaten ist nichts nutzbar -> Anmeldung zeigen
        setStatus("anon");
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const r = await api<{ token: string; user: User }>("/v1/auth/login", {
      method: "POST",
      anonymous: true,
      body: { username: username.trim(), password, deviceName: "Web-Browser", platform: "web" },
    });
    tokenStore.set(r.token, remember);
    setUser(r.user);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* Token ist ohnehin ungültig oder der Server nicht erreichbar: lokal abmelden */
    }
    tokenStore.clear();
    setUser(null);
    setStatus("anon");
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider fehlt");
  return c;
}
