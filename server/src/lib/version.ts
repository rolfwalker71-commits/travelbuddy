import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export type VersionInfo = {
  name: "TravelBuddy";
  version: string;
  build: string;
  builtAt: string;
  api: 1;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const SEMVER = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** Sucht `VERSION` (Repo-Wurzel, im Container `/app/VERSION`); Rückfall: `package.json` des Servers. */
export function readVersion(env: Record<string, string | undefined> = process.env): string {
  const candidates = [
    env.TRAVELBUDDY_VERSION_FILE,
    path.resolve(process.cwd(), "VERSION"),
    path.resolve(process.cwd(), "../VERSION"),
    path.resolve(here, "../../VERSION"), // dist/ bzw. src/lib → server/VERSION (Container)
    path.resolve(here, "../../../VERSION"), // src/lib → Repo-Wurzel
    path.resolve(here, "../../../../VERSION"),
  ].filter((p): p is string => Boolean(p));
  for (const file of candidates) {
    try {
      const v = fs.readFileSync(file, "utf8").trim();
      if (SEMVER.test(v)) return v;
    } catch {
      /* nächster Kandidat */
    }
  }
  for (const file of [path.resolve(process.cwd(), "package.json"), path.resolve(here, "../../package.json")]) {
    try {
      const v = (JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string }).version;
      if (v && SEMVER.test(v)) return v;
    } catch {
      /* nächster Kandidat */
    }
  }
  return "0.0.0";
}

function gitShort(): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 2000, cwd: path.resolve(here, "../..") });
    const out = r.status === 0 ? r.stdout.trim() : "";
    return /^[0-9a-f]{4,40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

const startedAt = new Date().toISOString();

/** Versionsangaben für `GET /v1/version`. `build` = `TRAVELBUDDY_BUILD` (Docker-Build) sonst Git-Kurzhash sonst «dev». */
export function versionInfo(env: Record<string, string | undefined> = process.env): VersionInfo {
  return {
    name: "TravelBuddy",
    version: readVersion(env),
    build: env.TRAVELBUDDY_BUILD?.trim() || gitShort() || "dev",
    builtAt: env.TRAVELBUDDY_BUILT_AT?.trim() || startedAt,
    api: 1,
  };
}
