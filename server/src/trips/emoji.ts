import { getCatalog } from "../catalog/catalog";

/** Symbol je Katalog-`icon` (für ICS-Titel und Meldungen; Clients zeichnen eigene Symbole). */
const BY_ICON: Record<string, string> = {
  plane: "✈️",
  train: "🚆",
  car: "🚗",
  transfer: "🚌",
  bed: "🏨",
  ship: "🚢",
  map: "📍",
  fork: "🍽️",
  ticket: "🎟️",
  shield: "🛡️",
  passport: "🛂",
  task: "✅",
};

export function eventEmoji(type: string | null | undefined): string {
  const t = getCatalog().type(type ?? "");
  return (t && BY_ICON[t.icon]) || "📍";
}
