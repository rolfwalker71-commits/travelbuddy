import type { Db } from "../db/client";
import type { Background } from "./background";
import type { Notifier } from "../push/notifier";
import type { ImageGenerator } from "../media/generate";

/** Gemeinsame Abhängigkeiten der Fachmodule (Routen, Hintergrundarbeit). */
export type ModuleDeps = {
  db: Db;
  now: () => Date;
  background: Background;
  notifier: Notifier;
  /** Ordner für erzeugte und importierte Bilder (neben der Datenbank, im Test ein Temp-Ordner). */
  mediaDir: string;
  /** KI-Bilderzeugung; null = nicht aktiv (kein Schlüssel oder abgeschaltet). Im Test ersetzbar. */
  images?: ImageGenerator | null;
  /** Höchstzahl erzeugter Bilder je Wartungslauf (Standard 5). */
  imagesPerRun?: number;
};
