import type { IconName } from "../ui/Icon";

export type NavEntry = {
  to: string;
  label: string;
  icon: IconName;
  /** Zähler (z. B. Vorschläge zu prüfen). */
  count?: number | null;
};

/**
 * Hauptnavigation: «Heute» nur bei aktiver Reise, sonst Reisen und Konto.
 * Innerhalb einer Reise gibt es zusätzlich die Reise-Tabs (siehe `TRIP_TABS`).
 */
export function navFor(opts: { hasActiveTrip: boolean; reviewCount?: number }): NavEntry[] {
  const out: NavEntry[] = [];
  if (opts.hasActiveTrip) out.push({ to: "/", label: "Heute", icon: "compass", count: opts.reviewCount || null });
  out.push({ to: "/trips", label: "Reisen", icon: "plane" });
  out.push({ to: "/settings", label: "Konto", icon: "user" });
  return out;
}

/** Ist `path` genau `to` oder darunter? Die Startseite nur exakt. */
export function pathMatches(path: string, to: string): boolean {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(`${to}/`);
}

export function isActive(entry: Pick<NavEntry, "to">, path: string): boolean {
  return pathMatches(path, entry.to);
}

export type TripTabKey = "plan" | "documents" | "ledger" | "team" | "map";

export const TRIP_TABS: { key: TripTabKey; label: string; path: string; icon: IconName }[] = [
  { key: "plan", label: "Plan", path: "", icon: "calendar" },
  { key: "documents", label: "Dokumente", path: "documents", icon: "file" },
  { key: "ledger", label: "Kasse", path: "ledger", icon: "wallet" },
  { key: "team", label: "Team", path: "team", icon: "users" },
  { key: "map", label: "Karte", path: "map", icon: "map" },
];


/** Welcher Reise-Tab gehört zum Pfad `/trips/12/ledger`? Ereignis-Details zählen zum Plan. */
export function tripTabFor(pathname: string, tripId: number): TripTabKey {
  const rest = pathname.replace(new RegExp(`^/trips/${tripId}/?`), "");
  const first = rest.split("/")[0] ?? "";
  const hit = TRIP_TABS.find((t) => t.path !== "" && t.path === first);
  return hit?.key ?? "plan";
}
