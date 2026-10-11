import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { users as usersApi } from "../api/endpoints";
import type { ManagedUser } from "../api/types";
import { useFormErrors } from "../hooks/useFormErrors";
import { QueryView, useQuery } from "../hooks/useQuery";
import { resetDirectoryCache } from "../hooks/useDirectory";
import { checkNewPassword, generatePassword } from "../lib/password";
import { useAuth } from "../state/auth";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Banner, Skeleton } from "../ui/Feedback";
import { CheckField, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { Badge, CopyButton } from "../ui/bits";
import { formatDateRange } from "../lib/dates";

const LAST_ADMIN =
  "Das ist der letzte aktive Administrator. Ernenne zuerst eine weitere Person zur Administratorin, bevor du diesem Konto die Rechte entziehst oder es deaktivierst.";

const USER_SPEC = {
  username: { key: "username", label: "Benutzername" },
  displayName: { key: "displayName", label: "Name" },
  email: { key: "email", label: "E-Mail" },
  password: { key: "password", label: "Passwort" },
  isAdmin: { key: "isAdmin", label: "Rolle" },
  active: { key: "active", label: "Status" },
};

/** Verständliche Texte für bekannte Fehlercodes dieses Bereichs. */
export function userErrorText(e: unknown): string | null {
  if (e instanceof ApiError && e.code === "last_admin") return LAST_ADMIN;
  if (e instanceof ApiError && e.code === "cannot_delete_self") return "Das eigene Konto kann nicht gelöscht werden.";
  return null;
}

export function UsersCard() {
  const q = useQuery(() => usersApi.list(), []);
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);

  const changed = () => {
    resetDirectoryCache();
    q.reload();
  };

  const remove = async (u: ManagedUser) => {
    const ok = await confirm({
      title: `${u.displayName} löschen?`,
      message:
        "Das Konto und alle seine Geräte werden endgültig gelöscht. Als Teilnehmer in Reisen und Reisekassen bleibt die Person " +
        "als Gast ohne Konto bestehen, damit Salden, Ausgaben und Kommentare erhalten bleiben. Das lässt sich nicht rückgängig machen.",
      confirmLabel: "Endgültig löschen",
      danger: true,
    });
    if (!ok) return;
    try {
      await usersApi.remove(u.id);
      toast(`${u.displayName} gelöscht`);
      changed();
    } catch (e) {
      toast(userErrorText(e) ?? (e instanceof Error ? e.message : "Fehler"), "error");
    }
  };

  const setActive = async (u: ManagedUser, active: boolean) => {
    if (!active) {
      const self = u.id === me?.id;
      const ok = await confirm({
        title: `${u.displayName} deaktivieren?`,
        message: `${self ? "Du meldest dich damit selbst ab. " : ""}Das Konto kann sich nicht mehr anmelden, alle Geräte werden abgemeldet. Bestehende Daten bleiben erhalten.`,
        confirmLabel: "Deaktivieren",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await usersApi.update(u.id, { active });
      toast(active ? `${u.displayName} aktiviert` : `${u.displayName} deaktiviert`);
      changed();
    } catch (e) {
      toast(userErrorText(e) ?? (e instanceof Error ? e.message : "Fehler"), "error");
    }
  };

  return (
    <div className="card">
      <QueryView query={q} skeleton={<Skeleton lines={4} height={24} />}>
        {(list) => (
          <>
            <ul className="list card--flush users-list">
              {list.map((u) => (
                <li key={u.id} className="row member-row">
                  <span className="avatar avatar--s" aria-hidden="true">
                    {u.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="row__main">
                    <span className="row__title">
                      {u.displayName}
                      {u.id === me?.id ? <span className="faint"> (du)</span> : null}
                    </span>
                    <span className="row__sub">
                      @{u.username}
                      {u.email ? ` · ${u.email}` : ""}
                    </span>
                    <span className="row__badges">
                      {u.isAdmin ? <Badge tone="accent" icon="user">Administrator</Badge> : <Badge icon="user">Mitglied</Badge>}
                      {!u.active ? <Badge tone="warn" icon="alert">Deaktiviert</Badge> : null}
                    </span>
                  </span>
                  <Menu
                    label={`Aktionen für ${u.displayName}`}
                    items={[
                      { label: "Bearbeiten", icon: "edit", onSelect: () => setEditing(u) },
                      { label: "Passwort zurücksetzen", icon: "refresh", onSelect: () => setResetting(u) },
                      u.active
                        ? { label: "Deaktivieren", icon: "x", danger: true, onSelect: () => void setActive(u, false) }
                        : { label: "Aktivieren", icon: "check", onSelect: () => void setActive(u, true) },
                      {
                        label: "Löschen",
                        icon: "trash",
                        danger: true,
                        disabled: u.id === me?.id,
                        onSelect: () => void remove(u),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
            <div className="card__actions">
              <Button icon="plus" onClick={() => setCreating(true)}>
                Benutzer anlegen
              </Button>
            </div>
          </>
        )}
      </QueryView>

      {creating ? (
        <CreateUserSheet
          onClose={() => setCreating(false)}
          onDone={(u) => {
            toast(`${u.displayName} angelegt`);
            changed();
          }}
        />
      ) : null}
      {editing ? (
        <EditUserSheet
          key={editing.id}
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onDone={() => {
            toast("Benutzer gespeichert");
            changed();
          }}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordSheet
          key={resetting.id}
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => toast(`Passwort von ${resetting.displayName} geändert`)}
        />
      ) : null}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  error,
  label = "Passwort",
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  label?: string;
}) {
  return (
    <div className="pw-row">
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        error={error}
        autoComplete="new-password"
        hint="Mindestens 12 Zeichen. Wird nur einmal angezeigt, bitte der Person sicher weitergeben."
        required
      />
      <div className="pw-row__tools">
        <Button size="s" variant="ghost" icon="refresh" onClick={() => onChange(generatePassword(16))}>
          Erzeugen
        </Button>
        {value ? <CopyButton text={value} label="Passwort kopieren" variant="ghost" /> : null}
      </div>
    </div>
  );
}

function CreateUserSheet({ onClose, onDone }: { onClose: () => void; onDone: (u: ManagedUser) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const errs = useFormErrors(USER_SPEC);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const local: Record<string, string> = {};
    if (!username.trim()) local.username = "Benutzername erforderlich";
    if (!displayName.trim()) local.displayName = "Name erforderlich";
    const pw = checkNewPassword(password);
    if (!pw.ok) local.password = pw.error;
    if (Object.keys(local).length > 0) {
      errs.set(local);
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      const u = await usersApi.create({
        username: username.trim(),
        displayName: displayName.trim(),
        email: email.trim() || null,
        password,
        isAdmin,
      });
      onDone(u);
      onClose();
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Benutzer anlegen"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Anlegen
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <TextField label="Benutzername" value={username} onChange={setUsername} required autoFocus autoComplete="off" error={errs.fields.username} maxLength={60} />
        <TextField label="Name" value={displayName} onChange={setDisplayName} required error={errs.fields.displayName} maxLength={100} />
        <TextField label="E-Mail (optional)" type="email" value={email} onChange={setEmail} error={errs.fields.email} />
        <PasswordInput value={password} onChange={setPassword} error={errs.fields.password} label="Startpasswort" />
        <CheckField
          checked={isAdmin}
          onChange={setIsAdmin}
          label="Administrator"
          description="Darf Benutzer verwalten, Reisen anlegen und bearbeiten, Dokumente prüfen und die Reisekassen aller Reisen öffnen."
        />
      </div>
    </Sheet>
  );
}

function EditUserSheet({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [active, setActive] = useState(user.active);
  const errs = useFormErrors(USER_SPEC);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  // Reisen, die das Konto sehen darf (Administratoren sehen immer alle).
  const tripsQ = useQuery((signal) => usersApi.trips(user.id, signal), [user.id]);
  const [tripIds, setTripIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (tripsQ.data) setTripIds(new Set(tripsQ.data.filter((t) => t.assigned).map((t) => t.id)));
  }, [tripsQ.data]);
  const tripsChanged =
    tripIds !== null &&
    tripsQ.data !== undefined &&
    (tripIds.size !== tripsQ.data.filter((t) => t.assigned).length ||
      tripsQ.data.some((t) => t.assigned !== tripIds.has(t.id)));

  const submit = async () => {
    if (!displayName.trim()) {
      errs.set({ displayName: "Name erforderlich" });
      return;
    }
    if (isSelf && user.isAdmin && !isAdmin) {
      const ok = await confirm({
        title: "Eigene Administratorrechte entziehen?",
        message: "Du kannst danach keine Benutzer, Reisen und Dokumente mehr verwalten, bis dich jemand wieder zum Administrator macht.",
        confirmLabel: "Rechte entziehen",
        danger: true,
      });
      if (!ok) return;
    }
    errs.clear();
    setBusy(true);
    try {
      await usersApi.update(user.id, {
        displayName: displayName.trim(),
        email: email.trim() || null,
        isAdmin,
        active,
      });
      if (tripsChanged && tripIds) await usersApi.setTrips(user.id, [...tripIds]);
      onDone();
      onClose();
    } catch (e) {
      const friendly = userErrorText(e);
      if (friendly) errs.set({}, friendly);
      else errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${user.displayName} bearbeiten`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <p className="muted small">
          Benutzername: <strong>@{user.username}</strong> (nicht änderbar)
        </p>
        <TextField label="Name" value={displayName} onChange={setDisplayName} required autoFocus error={errs.fields.displayName} maxLength={100} />
        <TextField label="E-Mail (optional)" type="email" value={email} onChange={setEmail} error={errs.fields.email} />
        <CheckField
          checked={isAdmin}
          onChange={setIsAdmin}
          label="Administrator"
          description="Benutzerverwaltung, Reisen, Dokumente und Zugriff auf alle Reisekassen."
        />
        <CheckField
          checked={active}
          onChange={setActive}
          label="Konto aktiv"
          description="Deaktivierte Konten können sich nicht anmelden; ihre Geräte werden abgemeldet."
        />
        {isAdmin ? (
          <p className="field__hint">Administratoren sehen alle Reisen. Die Auswahl gilt nur für Konten ohne Adminrechte.</p>
        ) : (
          <fieldset className="fieldset">
            <legend>Sichtbare Reisen</legend>
            {tripsQ.data === undefined ? (
              <p className="muted small">{tripsQ.error ? "Reisen konnten nicht geladen werden." : "Reisen werden geladen …"}</p>
            ) : tripsQ.data.length === 0 ? (
              <p className="muted small">Es gibt noch keine Reisen.</p>
            ) : (
              tripsQ.data.map((t) => (
                <CheckField
                  key={t.id}
                  label={t.title}
                  description={formatDateRange(t.startDate, t.endDate) || undefined}
                  checked={tripIds?.has(t.id) ?? false}
                  onChange={(c) =>
                    setTripIds((cur) => {
                      const n = new Set(cur ?? []);
                      if (c) n.add(t.id);
                      else n.delete(t.id);
                      return n;
                    })
                  }
                />
              ))
            )}
            <p className="field__hint">
              Ohne Haken sieht das Konto die Reise nicht. Wird eine Reise entzogen, bleibt die Person dort als Gast ohne Konto
              eingetragen.
            </p>
          </fieldset>
        )}
        {isSelf ? (
          <p className="xsmall faint">
            <Icon name="info" size={14} /> Das ist dein eigenes Konto.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function ResetPasswordSheet({
  user,
  onClose,
  onDone,
}: {
  user: ManagedUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const errs = useFormErrors(USER_SPEC);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const pw = checkNewPassword(password);
    if (!pw.ok) {
      errs.set({ password: pw.error });
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      await usersApi.update(user.id, { password });
      onDone();
      onClose();
    } catch (e) {
      errs.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Passwort zurücksetzen"
      description={`Setzt ein neues Passwort für ${user.displayName}. Alle Geräte dieser Person werden abgemeldet.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Zurücksetzen
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <PasswordInput value={password} onChange={setPassword} error={errs.fields.password} label="Neues Passwort" />
      </div>
    </Sheet>
  );
}
