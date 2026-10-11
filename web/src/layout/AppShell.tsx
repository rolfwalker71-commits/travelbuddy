import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { THEME_CHANGED, setThemePreference, type ResolvedTheme } from "../lib/theme";
import { isActive, navFor, type NavEntry } from "../lib/nav";
import { formatTimestamp } from "../lib/dates";
import { useAuth } from "../state/auth";
import { CatalogProvider } from "../state/catalog";
import { TodayProvider, useToday } from "../state/today";
import { Icon, type IconName } from "../ui/Icon";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden="true">
        <Icon name="ticket" size={22} />
      </span>
      <span className="brand__name">TravelBuddy</span>
    </span>
  );
}

/** «11.10.2026 14:30», minutengenau. */
function useClock(): string {
  const [now, setNow] = useState(() => formatTimestamp(new Date().toISOString()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatTimestamp(new Date().toISOString())), 20_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Obere Leiste: Bereich, Datum, Darstellung. */
function Topbar({ sectionLabel }: { sectionLabel: string }) {
  const clock = useClock();
  const [resolved, setResolved] = useState<ResolvedTheme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  useEffect(() => {
    const on = () => setResolved(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    window.addEventListener(THEME_CHANGED, on);
    return () => window.removeEventListener(THEME_CHANGED, on);
  }, []);
  return (
    <div className="topbar">
      <div className="topbar__crumb">
        <strong>TravelBuddy</strong>
        {sectionLabel ? (
          <>
            <span className="topbar__sep" aria-hidden="true">
              /
            </span>
            <span>{sectionLabel}</span>
          </>
        ) : null}
      </div>
      <div className="topbar__tools">
        <span className="topbar__clock">{clock}</span>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => setThemePreference(resolved === "dark" ? "light" : "dark")}
          aria-label={resolved === "dark" ? "Zum hellen Thema wechseln" : "Zum dunklen Thema wechseln"}
          title={resolved === "dark" ? "Papier (hell)" : "Nachtpapier (dunkel)"}
        >
          <Icon name={resolved === "dark" ? "sun" : "moon"} size={20} />
        </button>
      </div>
    </div>
  );
}

/** Zähler mit Text für Screenreader; bei 0 oder unbekannt nichts. */
function Count({ n }: { n: number | null | undefined }) {
  if (!n) return null;
  return (
    <span className="navcount">
      <span aria-hidden="true">{n > 99 ? "99+" : n}</span>
      <span className="sr-only">{n === 1 ? ", 1 zu prüfen" : `, ${n} zu prüfen`}</span>
    </span>
  );
}

function ShellInner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { data } = useToday();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  const items: NavEntry[] = navFor({ hasActiveTrip: Boolean(data?.trip), reviewCount: data?.review ?? 0 });
  const sectionLabel = items.find((e) => isActive(e, pathname))?.label ?? "";

  // Seitenwechsel: Fokus auf den Inhalt, damit Tastatur und Screenreader nicht in der Navigation hängen.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>

      <aside className="sidebar" aria-label="Seitenleiste">
        <div className="sidebar__brand">
          <Link to={items[0]?.to ?? "/trips"} aria-label="TravelBuddy, zur Startseite" title="TravelBuddy">
            <Brand />
          </Link>
        </div>
        <nav aria-label="Hauptnavigation" className="sidebar__scroll">
          <ul className="sidebar__nav">
            {items.map((e) => {
              const active = isActive(e, pathname);
              return (
                <li key={e.to}>
                  <Link to={e.to} className={`navlink${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                    <Icon name={e.icon} size={22} />
                    <span className="navlink__label">{e.label}</span>
                    <Count n={e.count} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {data?.trip ? (
          <Link to={`/trips/${data.trip.id}`} className="sidebar__trip" aria-label={`Aktive Reise: ${data.trip.title}`}>
            <span className="label">Aktive Reise</span>
            <strong>{data.trip.title}</strong>
            <span className="num xsmall muted">
              Tag {data.trip.dayIndex} von {data.trip.dayCount}
            </span>
            {data.trip.dayCount > 0 && data.trip.dayCount <= 60 ? (
              <span className="daydots daydots--s" aria-hidden="true">
                {Array.from({ length: data.trip.dayCount }, (_, i) => (
                  <i key={i} className={i + 1 < data.trip!.dayIndex ? "is-done" : i + 1 === data.trip!.dayIndex ? "is-now" : ""} />
                ))}
              </span>
            ) : null}
          </Link>
        ) : null}
        <div className="sidebar__foot">
          <span className="topbar__avatar" aria-hidden="true" title={user?.displayName}>
            {(user?.displayName ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar__user">
            <span>{user?.displayName}</span>
            <span>{user?.isAdmin ? "Administrator" : "Reiseteilnehmer"}</span>
          </span>
        </div>
      </aside>

      <main id="main" ref={main} className="main" tabIndex={-1}>
        <Topbar sectionLabel={sectionLabel} />
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Hauptnavigation">
        <ul>
          {items.map((e) => {
            const active = isActive(e, pathname);
            return (
              <li key={e.to}>
                <Link to={e.to} className={`tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                  <span className="tab__icon">
                    <Icon name={e.icon} size={22} />
                    <Count n={e.count} />
                  </span>
                  <span>{e.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function AppShell() {
  return (
    <CatalogProvider>
      <TodayProvider>
        <ShellInner />
      </TodayProvider>
    </CatalogProvider>
  );
}

/** Schwebende Hauptaktion, auf kleinen Bildschirmen. */
export function Fab({ label, onClick, icon = "plus" }: { label: string; onClick: () => void; icon?: IconName }) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={label}>
      <Icon name={icon} size={22} />
      <span className="fab__label">{label}</span>
    </button>
  );
}
