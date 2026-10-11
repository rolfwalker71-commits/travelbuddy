import { useState } from "react";
import { errorMessage } from "../../api/client";
import { ledgers as L, trips as api } from "../../api/endpoints";
import type { DirectoryUser, LedgerOverview, Traveler } from "../../api/types";
import { useDirectory } from "../../hooks/useDirectory";
import { useFormErrors } from "../../hooks/useFormErrors";
import { QueryView, useQuery } from "../../hooks/useQuery";
import { tripShareUrl } from "../../lib/ledger";
import { Button } from "../../ui/Button";
import { CheckField, SelectField, TextField } from "../../ui/Field";
import { Banner, Skeleton } from "../../ui/Feedback";
import { HelpCard } from "../../ui/IllustrationCard";
import { Icon } from "../../ui/Icon";
import { Menu } from "../../ui/Menu";
import { Sheet } from "../../ui/Sheet";
import { useConfirm } from "../../ui/Confirm";
import { useToast } from "../../ui/Toast";
import { CopyButton, Section } from "../../ui/bits";
import { useTripCtx } from "./context";

const TRAVELER_SPEC = {
  displayName: { key: "name", label: "Name" },
  userId: { key: "userId", label: "Konto" },
  email: { key: "email", label: "E-Mail" },
};

/** Team: Teilnehmer mit persönlichem Link (Reise und Kasse), Konten verknüpfen, Paare für die Aufteilung. */
export function TeamTab() {
  const ctx = useTripCtx();
  const { data, isAdmin } = ctx;
  const { trip, travelers } = data;
  const toast = useToast();
  const confirm = useConfirm();
  const directory = useDirectory(isAdmin);
  const origin = window.location.origin;
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [linkFor, setLinkFor] = useState<Traveler | null>(null);
  const addErrs = useFormErrors(TRAVELER_SPEC);
  const takenAccounts = new Set(travelers.map((t) => t.userId).filter((x): x is number => x != null));
  const accountName = (uid: number | null) => directory.find((u) => u.id === uid)?.displayName ?? null;

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const addTraveler = async () => {
    const uid = accountId ? Number(accountId) : null;
    const n = name.trim() || (uid != null ? accountName(uid) ?? "" : "");
    if (!n) {
      addErrs.set({ name: "Name eingeben oder ein Konto wählen" });
      return;
    }
    addErrs.clear();
    try {
      ctx.apply(await api.addTraveler(trip.id, { displayName: n, userId: uid }));
      setName("");
      setAccountId("");
      toast(`${n} hinzugefügt`);
    } catch (e) {
      addErrs.fromError(e);
    }
  };

  return (
    <div className="team">
      <div className="trip-layout">
        <div className="trip-main">
          <Section title="Teilnehmer" id="sec-travelers">
            <ul className="list card card--flush">
              {travelers.map((t) => (
                <li key={t.id} className="row member-row">
                  <span className={`avatar avatar--s avatar--c${(t.colorIndex ?? t.id) % 8}`} aria-hidden="true">
                    {t.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="row__main">
                    <span className="row__title">
                      {t.displayName}
                      {t.id === ctx.meId ? <span className="faint"> (du)</span> : null}
                    </span>
                    {isAdmin ? (
                      <span className="row__sub">{t.userId != null ? `Konto: ${accountName(t.userId) ?? "verknüpft"}` : "Gast, nur über den Link"}</span>
                    ) : null}
                    {isAdmin && t.shareToken ? (
                      <span className="invite xsmall faint truncate" title={tripShareUrl(origin, t.shareToken)}>
                        {tripShareUrl(origin, t.shareToken)}
                      </span>
                    ) : null}
                    {isAdmin && t.shareToken === null ? <span className="xsmall faint">Link widerrufen</span> : null}
                  </span>
                  {isAdmin ? (
                    <span className="member-row__actions">
                      {t.shareToken ? (
                        <CopyButton
                          text={tripShareUrl(origin, t.shareToken)}
                          label={`Link für ${t.displayName} kopieren`}
                          onCopied={() => toast("Teilnehmer-Link kopiert")}
                        />
                      ) : null}
                      <Menu
                        label={`Aktionen für ${t.displayName}`}
                        items={[
                          t.userId == null
                            ? {
                                label: "Mit Konto verknüpfen",
                                icon: "link" as const,
                                disabled: directory.every((u) => takenAccounts.has(u.id)),
                                onSelect: () => setLinkFor(t),
                              }
                            : {
                                label: "Verknüpfung lösen",
                                icon: "x" as const,
                                onSelect: async () => {
                                  const ok = await confirm({
                                    title: "Verknüpfung mit dem Konto lösen?",
                                    message: `${t.displayName} bleibt Teilnehmer, sieht die Reise aber nur noch über den Link.`,
                                    confirmLabel: "Lösen",
                                    danger: true,
                                  });
                                  if (!ok) return;
                                  await guard(async () => {
                                    ctx.apply(await api.updateTraveler(trip.id, t.id, { userId: null }));
                                    toast("Verknüpfung gelöst");
                                  });
                                },
                              },
                          {
                            label: "Neuer Link",
                            icon: "refresh",
                            onSelect: () =>
                              void guard(async () => {
                                ctx.apply(await api.rotateShare(trip.id, t.id));
                                toast("Neuer Link erstellt");
                              }),
                          },
                          ...(t.shareToken
                            ? [
                                {
                                  label: "Link widerrufen",
                                  icon: "link" as const,
                                  onSelect: async () => {
                                    const ok = await confirm({
                                      title: "Link widerrufen?",
                                      message: `${t.displayName} kann Reise und Reisekasse danach nicht mehr über den bisherigen Link öffnen.`,
                                      confirmLabel: "Widerrufen",
                                      danger: true,
                                    });
                                    if (!ok) return;
                                    await guard(async () => {
                                      ctx.apply(await api.revokeShare(trip.id, t.id));
                                      toast("Link widerrufen");
                                    });
                                  },
                                },
                              ]
                            : []),
                          {
                            label: "Entfernen",
                            icon: "trash",
                            danger: true,
                            disabled: travelers.length <= 1,
                            onSelect: async () => {
                              const ok = await confirm({
                                title: `${t.displayName} entfernen?`,
                                message: "Nur möglich, solange die Person keine Buchungen in der Reisekasse hat.",
                                confirmLabel: "Entfernen",
                                danger: true,
                              });
                              if (!ok) return;
                              await guard(async () => {
                                ctx.apply(await api.removeTraveler(trip.id, t.id));
                                toast(`${t.displayName} entfernt`);
                              });
                            },
                          },
                        ]}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {isAdmin ? (
              <>
                <form
                  className="inline-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addTraveler();
                  }}
                >
                  <TextField
                    label="Teilnehmer hinzufügen"
                    value={name}
                    onChange={(v) => {
                      setName(v);
                      addErrs.clearField("name");
                    }}
                    error={addErrs.fields.name ?? addErrs.fields.userId}
                    maxLength={100}
                    placeholder="Name"
                  />
                  {directory.length > 0 ? (
                    <SelectField
                      label="Konto (optional)"
                      value={accountId}
                      onChange={setAccountId}
                      options={[
                        { value: "", label: "Kein Konto (Gast)" },
                        ...directory.map((u) => ({
                          value: String(u.id),
                          label: takenAccounts.has(u.id) ? `${u.displayName} (bereits dabei)` : u.displayName,
                          disabled: takenAccounts.has(u.id),
                        })),
                      ]}
                    />
                  ) : null}
                  <Button type="submit" icon="plus">
                    Hinzufügen
                  </Button>
                </form>
                <p className="field__hint">
                  Mit dem Link sieht ein Teilnehmer die Reise und die Reisekasse und kann kommentieren und Ausgaben erfassen, ohne Konto.
                </p>
              </>
            ) : null}
          </Section>

          {isAdmin && trip.ledgerId != null ? <CouplesSection ledgerId={trip.ledgerId} /> : null}
        </div>
        <aside className="trip-side">
          <HelpCard id="help-invite" defaultOpen />
        </aside>
      </div>

      {linkFor ? (
        <LinkAccountSheet
          traveler={linkFor}
          directory={directory}
          taken={takenAccounts}
          onClose={() => setLinkFor(null)}
          onSave={async (userId) => {
            ctx.apply(await api.updateTraveler(trip.id, linkFor.id, { userId }));
            toast(`${linkFor.displayName} ist jetzt mit einem Konto verknüpft`);
            setLinkFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function LinkAccountSheet({
  traveler,
  directory,
  taken,
  onClose,
  onSave,
}: {
  traveler: Traveler;
  directory: DirectoryUser[];
  taken: Set<number>;
  onClose: () => void;
  onSave: (userId: number) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = directory.filter((u) => !taken.has(u.id));
  const submit = async () => {
    if (!accountId) {
      setError("Bitte ein Konto wählen");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(Number(accountId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${traveler.displayName} mit Konto verknüpfen`}
      description="Der Teilnehmer sieht die Reise danach in seiner Liste. Name und Link bleiben unverändert."
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Verknüpfen
          </Button>
        </>
      }
    >
      <div className="form">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <SelectField
          label="Konto"
          value={accountId}
          onChange={(v) => {
            setAccountId(v);
            setError(null);
          }}
          options={[{ value: "", label: "Konto wählen …" }, ...free.map((u) => ({ value: String(u.id), label: u.displayName }))]}
        />
      </div>
    </Sheet>
  );
}

/** Paare für die Aufteilung «Nach Paaren» (Reisekasse). */
function CouplesSection({ ledgerId }: { ledgerId: number }) {
  const q = useQuery<LedgerOverview>((s) => L.overview(ledgerId, s), [ledgerId]);
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Paare"
      id="sec-couples"
      actions={
        q.data && q.data.members.filter((m) => m.coupleId == null).length >= 2 ? (
          <Button size="s" icon="plus" onClick={() => setOpen(true)}>
            Paar bilden
          </Button>
        ) : undefined
      }
    >
      <QueryView query={q} skeleton={<Skeleton lines={2} height={28} />}>
        {(o) =>
          o.couples.length === 0 ? (
            <div className="card">
              <p className="muted small">Paare werden bei der Aufteilung «Nach Paaren» zuerst als Einheit gerechnet und dann innerhalb des Paars geteilt.</p>
            </div>
          ) : (
            <ul className="list card card--flush">
              {o.couples.map((c) => (
                <li key={c.id} className="row">
                  <Icon name="users" size={20} />
                  <span className="row__main">
                    <span className="row__title">{c.name}</span>
                    <span className="row__sub">{c.memberIds.map((id) => o.members.find((m) => m.id === id)?.displayName ?? `#${id}`).join(", ")}</span>
                  </span>
                  <Button
                    size="s"
                    variant="ghost"
                    icon="trash"
                    onClick={async () => {
                      const ok = await confirm({ title: "Paar auflösen?", message: "Bestehende Ausgaben bleiben unverändert.", confirmLabel: "Auflösen", danger: true });
                      if (!ok) return;
                      try {
                        await L.deleteCouple(ledgerId, c.id);
                        toast("Paar aufgelöst");
                        q.reload();
                      } catch (e) {
                        toast(errorMessage(e), "error");
                      }
                    }}
                  >
                    Auflösen
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      {open && q.data ? (
        <CoupleSheet
          members={q.data.members.filter((m) => m.coupleId == null)}
          onClose={() => setOpen(false)}
          onSave={async (ids, nm) => {
            await L.createCouple(ledgerId, ids, nm);
            toast("Paar gebildet");
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function CoupleSheet({
  members,
  onClose,
  onSave,
}: {
  members: { id: number; displayName: string }[];
  onClose: () => void;
  onSave: (ids: number[], name: string) => Promise<void>;
}) {
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (ids.size < 2) {
      setError("Mindestens zwei Personen wählen");
      return;
    }
    setBusy(true);
    try {
      await onSave([...ids], name.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Paar bilden"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Paar bilden
          </Button>
        </>
      }
    >
      <div className="form">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <fieldset className="fieldset">
          <legend>Personen</legend>
          {members.map((m) => (
            <CheckField
              key={m.id}
              label={m.displayName}
              checked={ids.has(m.id)}
              onChange={(c) =>
                setIds((s) => {
                  const n = new Set(s);
                  if (c) n.add(m.id);
                  else n.delete(m.id);
                  return n;
                })
              }
            />
          ))}
        </fieldset>
        <TextField label="Name (optional)" value={name} onChange={setName} placeholder="z. B. Familie Muster" maxLength={100} />
      </div>
    </Sheet>
  );
}
