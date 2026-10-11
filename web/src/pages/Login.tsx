import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useAuth } from "../state/auth";
import { Button } from "../ui/Button";
import { CheckField, TextField } from "../ui/Field";
import { Banner } from "../ui/Feedback";
import { Brand } from "../layout/AppShell";

function safeNext(s: unknown): string {
  return typeof s === "string" && /^\/(?![/\\])/.test(s) && !s.startsWith("/login") ? s : "/";
}

export function LoginPage() {
  const { status, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext((loc.state as { from?: string } | null)?.from);

  if (status === "authed") return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Bitte Benutzername und Passwort eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username, password, remember);
      nav(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login__card card" onSubmit={submit} noValidate>
        <div className="login__brand">
          <Brand />
        </div>
        <h1>Anmelden</h1>
        <p className="muted">Reisen planen, Buchungen sammeln und die Reisekasse teilen.</p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <TextField
          label="Benutzername"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoFocus
          name="username"
        />
        <TextField
          label="Passwort"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          name="password"
        />
        <CheckField
          checked={remember}
          onChange={setRemember}
          label="Angemeldet bleiben"
          description="Nur auf eigenen Geräten. Sonst endet die Sitzung mit dem Schliessen des Tabs."
        />
        <Button type="submit" variant="primary" busy={busy} className="btn--block">
          Anmelden
        </Button>
      </form>
    </main>
  );
}
