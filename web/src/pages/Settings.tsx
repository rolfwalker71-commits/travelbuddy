import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { account, meta, misc } from "../api/endpoints";
import type { Device, LeadTimes, NotificationPrefs, ServerVersion } from "../api/types";
import { useFormErrors } from "../hooks/useFormErrors";
import { checkNewPassword } from "../lib/password";
import { formatTimestamp } from "../lib/dates";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/Field";
import { UsersCard } from "./UserAdmin";
import { QueryView, useQuery } from "../hooks/useQuery";
import { useAuth } from "../state/auth";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/Confirm";
import { Banner, Skeleton } from "../ui/Feedback";
import { SwitchField } from "../ui/Field";
import { Badge, PageHeader, Section, Segmented } from "../ui/bits";
import { THEME_LABEL, readThemePreference, setThemePreference, type ThemePreference } from "../lib/theme";
import { useToast } from "../ui/Toast";
import { KeyValue } from "../ledger/LedgerParts";
import { APP_BUILD, APP_VERSION, majorMismatch, versionLine } from "../lib/version";

/** System (Standard), Hell «Papier» oder Dunkel «Nachtpapier»; gilt für diesen Browser. */
function ThemeCard() {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference);
  return (
    <div className="card">
      <Segmented<ThemePreference>
        label="Darstellung"
        value={pref}
        onChange={(v) => {
          setPref(v);
          setThemePreference(v);
        }}
        options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: THEME_LABEL[v] }))}
      />
      <p className="muted small" style={{ marginTop: 12 }}>
        «System» folgt der Einstellung deines Geräts. Die Wahl gilt nur für diesen Browser.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="page">
      <PageHeader title="Einstellungen" subtitle={user?.displayName} />

      <Section title="Konto" id="set-account">
        <div className="card">
          <KeyValue
            items={[
              { label: "Name", value: user?.displayName },
              { label: "Benutzername", value: user?.username },
              { label: "E-Mail", value: user?.email },
              { label: "Rolle", value: user?.isAdmin ? "Administrator" : "Mitreisende Person" },
            ]}
          />
          <div className="card__actions">
            <Button icon="edit" onClick={() => setPwOpen(true)}>
              Passwort ändern
            </Button>
            <Button
              variant="danger"
              icon="logout"
              onClick={async () => {
                const ok = await confirm({
                  title: "Abmelden?",
                  message: "Dieses Gerät wird abgemeldet. Beim nächsten Mal musst du dich neu anmelden.",
                  confirmLabel: "Abmelden",
                });
                if (ok) await logout();
              }}
            >
              Abmelden
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Darstellung" id="set-theme">
        <ThemeCard />
      </Section>

      <Section title="Geräte und Sitzungen" id="set-devices">
        <DevicesCard />
      </Section>

      <Section title="Benachrichtigungen" id="set-notify">
        <PrefsCard isAdmin={Boolean(user?.isAdmin)} />
      </Section>

      {user?.isAdmin ? (
        <Section title="Benutzer" id="set-users">
          <UsersCard />
        </Section>
      ) : null}

      <VersionFooter />
      {pwOpen ? <PasswordSheet onClose={() => setPwOpen(false)} /> : null}
    </div>
  );
}

const PW_SPEC = {
  currentPassword: { key: "current", label: "Aktuelles Passwort" },
  newPassword: { key: "next", label: "Neues Passwort" },
};
const PW_CODES = { invalid_credentials: "current" };

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const errs = useFormErrors(PW_SPEC, PW_CODES);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const local: Record<string, string> = {};
    if (!current) local.current = "Aktuelles Passwort eingeben";
    const check = checkNewPassword(next, repeat);
    if (!check.ok) local[check.error.startsWith("Die Wiederholung") ? "repeat" : "next"] = check.error;
    if (Object.keys(local).length > 0) {
      errs.set(local);
      return;
    }
    errs.clear();
    setBusy(true);
    try {
      await account.changePassword(current, next);
      toast("Passwort geändert. Andere Geräte wurden abgemeldet.");
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
      title="Passwort ändern"
      description="Nach der Änderung werden alle anderen Geräte abgemeldet. Dieses Gerät bleibt angemeldet."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Passwort ändern
          </Button>
        </>
      }
    >
      <div className="form">
        {errs.form ? <Banner tone="error">{errs.form}</Banner> : null}
        <TextField label="Aktuelles Passwort" type="password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus required error={errs.fields.current} />
        <TextField
          label="Neues Passwort"
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          required
          error={errs.fields.next}
          hint="Mindestens 12 Zeichen."
        />
        <TextField label="Neues Passwort wiederholen" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" required error={errs.fields.repeat} />
      </div>
    </Sheet>
  );
}

const PLATFORM: Record<string, string> = {
  ios: "iPhone",
  ipados: "iPad",
  macos: "Mac",
  visionos: "Apple Vision Pro",
  web: "Web-Browser",
};

function DevicesCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const { logout } = useAuth();
  const q = useQuery(() => account.devices(), []);

  const remove = async (d: Device) => {
    const ok = await confirm({
      title: d.current ? "Dieses Gerät abmelden?" : "Gerät abmelden?",
      message: d.current
        ? "Du wirst hier abgemeldet und musst dich neu anmelden."
        : `«${d.name ?? PLATFORM[d.platform ?? ""] ?? "Gerät"}» wird abgemeldet und erhält keine Mitteilungen mehr.`,
      confirmLabel: "Abmelden",
      danger: true,
    });
    if (!ok) return;
    if (d.current) {
      await logout();
      return;
    }
    try {
      await account.removeDevice(d.id);
      toast("Gerät abgemeldet");
      q.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="card">
      <QueryView query={q} skeleton={<Skeleton lines={3} height={26} />}>
        {(devices) =>
          devices.length === 0 ? (
            <p className="muted">Keine aktiven Sitzungen.</p>
          ) : (
            <ul className="list card--flush">
              {devices.map((d) => (
                <li key={d.id} className="row member-row">
                  <span className="row__main">
                    <span className="row__title">{d.name || PLATFORM[d.platform ?? ""] || "Unbekanntes Gerät"}</span>
                    <span className="row__sub">
                      {PLATFORM[d.platform ?? ""] ?? d.platform ?? "Gerät"} · zuletzt aktiv{" "}
                      {formatTimestamp(d.lastUsedAt ?? d.createdAt)} · angemeldet seit {formatTimestamp(d.createdAt)}
                    </span>
                    <span className="row__badges">
                      {d.current ? <Badge tone="accent" icon="check">Dieses Gerät</Badge> : null}
                      {d.push ? <Badge icon="bell">Push aktiv</Badge> : null}
                    </span>
                  </span>
                  <Button size="s" variant="ghost" icon="logout" onClick={() => void remove(d)}>
                    Abmelden
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </div>
  );
}

/** Beschriftung der Mitteilungsarten (Server: camelCase); unbekannte Schlüssel erscheinen mit ihrem Namen. */
const PREF_LABELS: Record<string, { label: string; description: string }> = {
  tripToday: { label: "Morgenbriefing", description: "Der Tag auf einen Blick, zur eingestellten Uhrzeit in Reisezeit" },
  tripDepart: { label: "Abflug und Abfahrt", description: "Vor dem Abflug zu den eingestellten Vorlaufzeiten, «Check-in öffnet»" },
  tripStay: { label: "Unterkunft", description: "Check-in heute, Check-out kurz vorher" },
  tripPickup: { label: "Mietwagen", description: "Abholung und Rückgabe" },
  tripDeadline: { label: "Fristen", description: "Storno- und Zahlungsfristen" },
  tripReview: { label: "Neue Vorschläge", description: "Aus Dokumenten erkannte Buchungen zum Prüfen" },
  tripComment: { label: "Kommentare", description: "Neue Kommentare auf deinen Reisen" },
  ledgerExpense: { label: "Neue Ausgaben", description: "Ausgaben in der Reisekasse" },
  ledgerSettlement: { label: "Rückzahlungen", description: "Rückzahlungen an dich" },
};

/** Bekannte Arten zuerst, in Reihenfolge des Vertrags; danach weitere Schalter des Servers. */
export function prefKeys(prefs: NotificationPrefs): string[] {
  const order = Object.keys(PREF_LABELS);
  const present = Object.keys(prefs).filter((k) => typeof prefs[k] === "boolean");
  return [...order.filter((k) => present.includes(k)), ...present.filter((k) => !order.includes(k))];
}

function PrefsCard({ isAdmin }: { isAdmin: boolean }) {
  void isAdmin;
  const toast = useToast();
  const q = useQuery(() => misc.prefs(), []);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) setPrefs(q.data);
  }, [q.data]);

  const save = async (patch: NotificationPrefs, optimistic: NotificationPrefs) => {
    if (!prefs) return;
    const prev = prefs;
    setPrefs({ ...prefs, ...optimistic });
    setSaving(true);
    try {
      setPrefs(await misc.setPrefs(patch));
    } catch (e) {
      setPrefs(prev);
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const lead = prefs?.leadTimes;
  const [hours, setHours] = useState("");
  useEffect(() => {
    if (lead) setHours(lead.departHours.join(", "));
  }, [lead]);
  const saveLead = (next: Partial<LeadTimes>) => {
    if (!lead) return;
    const merged = { ...lead, ...next };
    void save({ leadTimes: merged }, { leadTimes: merged });
  };

  return (
    <div className="card">
      <QueryView query={q} skeleton={<Skeleton lines={3} height={28} />}>
        {() =>
          prefs ? (
            <div className="switch-list" aria-busy={saving}>
              <p className="muted small">
                Push-Mitteilungen erhältst du in der TravelBuddy-App auf iPhone und iPad. Der Web-Client zeigt keine Mitteilungen an,
                die Auswahl gilt aber für dein Konto.
              </p>
              {prefKeys(prefs).map((k) => (
                <SwitchField
                  key={k}
                  label={PREF_LABELS[k]?.label ?? k}
                  description={PREF_LABELS[k]?.description}
                  checked={prefs[k] === true}
                  onChange={(v) => void save({ [k]: v }, { [k]: v })}
                />
              ))}
              {lead ? (
                <fieldset className="fieldset leadtimes">
                  <legend>Vorlaufzeiten</legend>
                  <div className="form-grid">
                    <TextField
                      label="Morgenbriefing um"
                      value={lead.todayBriefing}
                      onChange={(v) => setPrefs((p) => (p ? { ...p, leadTimes: { ...lead, todayBriefing: v } } : p))}
                      onBlur={() => /^([01]\d|2[0-3]):[0-5]\d$/.test(lead.todayBriefing) && saveLead({ todayBriefing: lead.todayBriefing })}
                      placeholder="hh:mm"
                      hint="Reisezeit, hh:mm"
                    />
                    <TextField
                      label="Abflug: Stunden vorher"
                      value={hours}
                      onChange={setHours}
                      onBlur={() => {
                        const list = hours
                          .split(/[,\s]+/)
                          .map(Number)
                          .filter((n) => Number.isFinite(n) && n > 0);
                        if (list.length > 0) saveLead({ departHours: list });
                      }}
                      placeholder="24, 3, 1"
                      hint="Mehrere Werte mit Komma"
                    />
                    <TextField
                      label="Check-out: Minuten vorher"
                      value={String(lead.checkoutMinutes)}
                      inputMode="numeric"
                      onChange={(v) => setPrefs((p) => (p ? { ...p, leadTimes: { ...lead, checkoutMinutes: Number(v.replace(/\D/g, "")) || 0 } } : p))}
                      onBlur={() => saveLead({ checkoutMinutes: lead.checkoutMinutes })}
                    />
                    <TextField
                      label="Fristen: Tage vorher"
                      value={String(lead.deadlineDays)}
                      inputMode="numeric"
                      onChange={(v) => setPrefs((p) => (p ? { ...p, leadTimes: { ...lead, deadlineDays: Number(v.replace(/\D/g, "")) || 0 } } : p))}
                      onBlur={() => saveLead({ deadlineDays: lead.deadlineDays })}
                    />
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null
        }
      </QueryView>
    </div>
  );
}

/** «TravelBuddy 0.1.0 (Build abc1234) · Server 0.1.0 · Stand 11.10.2026 14:30», mit Hinweis bei abweichender Hauptzahl. */
function VersionFooter() {
  const [server, setServer] = useState<ServerVersion | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    meta
      .version()
      .then((v) => alive && setServer(v))
      .catch(() => alive && setServer(null));
    return () => {
      alive = false;
    };
  }, []);
  const mismatch = server ? majorMismatch(APP_VERSION, server.version) : false;
  return (
    <footer className="versionline">
      {mismatch ? (
        <Banner tone="warn">
          Web-Client {APP_VERSION} und Server {server!.version} haben unterschiedliche Hauptversionen. Bitte beide auf denselben Stand bringen.
        </Banner>
      ) : null}
      <p className="num xsmall muted" data-testid="version-line">
        {server === undefined ? `TravelBuddy ${APP_VERSION} (Build ${APP_BUILD})` : versionLine(server)}
      </p>
    </footer>
  );
}
