import type { SVGProps } from "react";

const PATHS = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9.5a.5.5 0 0 0 .5.5h4v-6h4v6h4a.5.5 0 0 0 .5-.5V10",
  wallet:
    "M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5a1 1 0 0 1 1 1v2M3.5 7.5V17A2 2 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H6a2.5 2.5 0 0 1-2.5-2.5M16 13.5h.01",
  receipt: "M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  plane: "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5",
  plus: "M12 5v14M5 12h14",
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-left": "m15 6-6 6 6 6",
  "chevron-down": "m6 9 6 6 6-6",
  "arrow-left": "M19 12H5m6-6-6 6 6 6",
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  "arrow-up": "M12 19V5m-6 6 6-6 6 6",
  "arrow-down": "M12 5v14m-6-6 6 6 6-6",
  check: "m5 12.5 4.5 4.5L19 7.5",
  "check-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-4-9 3 3 5-6",
  alert: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  calendar: "M5 6.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1zM4 10.5h16M8 4v4M16 4v4",
  copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  trash: "M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 7l3 3",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  download: "M12 4v11m-4-4 4 4 4-4M5 19.5h14",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0",
  users:
    "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 19.5a6.5 6.5 0 0 1 13 0M16 5a3.2 3.2 0 0 1 0 6.3M18.5 14a6 6 0 0 1 3 5.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.2-4.2",
  x: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4",
  logout: "M10 4.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9",
  file: "M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM14 3.5V8h4.5M9 13h6M9 16.5h6",
  bed: "M3.5 18.5v-11M3.5 14h17v4.5M20.5 14v-2.5a2.5 2.5 0 0 0-2.5-2.5h-6.5V14M7 11.5h.01",
  train:
    "M9 3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM6 11h12M9 21l2-4M15 21l-2-4M9.5 14h.01M14.5 14h.01",
  car: "M5 16.5v-4l1.8-4.5a1.5 1.5 0 0 1 1.4-1h7.6a1.5 1.5 0 0 1 1.4 1L19 12.5v4M3.5 12.5h17M5 16.5h14V19h-3v-2.5M8 16.5V19H5v-2.5M7.5 14.5h.01M16.5 14.5h.01",
  ship: "M3 16.5 4.5 20c3 1 12 1 15 0l1.5-3.5-9-3zM12 13.5V6M12 6l5 4",
  pin: "M12 21s6.5-5.7 6.5-11a6.5 6.5 0 1 0-13 0c0 5.3 6.5 11 6.5 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  bus: "M6 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 11h16M7.5 14.5h.01M16.5 14.5h.01M7 18v2M17 18v2",
  flag: "M5 21V4M5 5h12l-2 4 2 4H5",
  message: "M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9.5L5 20.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z",
  external: "M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  archive: "M4 5.5h16v4H4zM5.5 9.5V19h13V9.5M10 13h4",
  swap: "M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4",
  bell: "M6 17.5V11a6 6 0 1 1 12 0v6.5l1.5 1.5h-15zM10 21h4",
  server: "M5 4.5h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM5 12.5h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM8 8h.01M8 16h.01",
  inbox: "M4 13.5 6.5 5.5h11L20 13.5M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5M4 13.5h4.5l1 2h5l1-2H20",
  chart: "M5 20v-9M12 20V5M19 20v-6M3.5 20.5h17",
  card: "M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM3 10.5h18M7 14.5h3",
  grid: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  "eye-off": "M4 4l16 16M10 6a9.5 9.5 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.5 7.5C3.8 9.3 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.9M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2",
  photo: "M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3.5 16.5l5-5 4 4 3-3 5 5M8.5 9.5h.01",
  upload: "M12 16V5m-4 4 4-4 4 4M5 19.5h14",
  minus: "M5 12h14",
  filter: "M4 6h16M7 12h10M10 18h4",
  tag: "M3.5 12.5V5a1 1 0 0 1 1-1h7.5l8.5 8.5-8 8zM8 8.5h.01",
  folder: "M3.5 6.5a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  fork: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10",
  ticket: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V6H3zM14 6v12",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  passport: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 17h6",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  phone: "M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3",
  merge: "M6 3v7a5 5 0 0 0 5 5h7M15 11l4 4-4 4",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  stack: "M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5",
} as const;

export type IconName = keyof typeof PATHS;

type Props = { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">;

/** Eigene Strichsymbole; dekorativ (aria-hidden), Bedeutung steht immer im Text daneben. */
export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Katalog-Icon (`event-types.json` → icon) → eigenes Symbol. */
export function catalogIcon(name: string | undefined | null): IconName {
  switch (name) {
    case "plane":
      return "plane";
    case "train":
      return "train";
    case "car":
      return "car";
    case "transfer":
      return "pin";
    case "bed":
      return "bed";
    case "ship":
      return "ship";
    case "map":
      return "map";
    case "fork":
      return "fork";
    case "ticket":
      return "ticket";
    case "shield":
      return "shield";
    case "passport":
      return "passport";
    case "task":
      return "check";
    default:
      return "flag";
  }
}

/** Symbol zu einer Typ-ID des Katalogs (ohne Katalog; für Listen, die nur den Typnamen kennen). */
export function eventIcon(type: string): IconName {
  switch (type) {
    case "Flug":
      return "plane";
    case "Zugreisen":
      return "train";
    case "Mietauto":
      return "car";
    case "Transfer":
      return "pin";
    case "Hotel":
    case "Unterkunft":
      return "bed";
    case "Kreuzfahrt":
      return "ship";
    case "Ausflug":
      return "map";
    case "Restaurant":
      return "fork";
    case "Veranstaltung":
      return "ticket";
    case "Versicherung":
      return "shield";
    case "Visum":
      return "passport";
    case "Aufgabe":
      return "check";
    default:
      return "flag";
  }
}
