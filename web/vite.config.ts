import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

/** Version aus `/VERSION` im Repo (Vertrag «Version»); ausserhalb des Repos die aus package.json. */
function readVersion(): string {
  try {
    return readFileSync(resolve(here, "../VERSION"), "utf8").trim() || "0.0.0";
  } catch {
    try {
      return (JSON.parse(readFileSync(resolve(here, "package.json"), "utf8")) as { version: string }).version;
    } catch {
      return "0.0.0";
    }
  }
}

/** Kurzer Commit (nur lesend); ohne git oder ohne Commit «dev». */
function readBuild(): string {
  if (process.env.TRAVELBUDDY_BUILD) return process.env.TRAVELBUDDY_BUILD;
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: here, stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

// Der Server liefert `dist/` same-origin unter `/` aus; die API liegt unter `/v1`.
// Dev und Preview leiten `/v1` an den lokalen Server weiter (TRAVELBUDDY_API überschreibt das Ziel, Port 7780).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxy = { "/v1": { target: env.TRAVELBUDDY_API || "http://127.0.0.1:7780", changeOrigin: false } };
  return {
    base: "/",
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(readVersion()),
      __APP_BUILD__: JSON.stringify(readBuild()),
    },
    server: { port: 5174, proxy, fs: { allow: [resolve(here, "..")] } },
    preview: { port: 4174, proxy },
    build: {
      target: "es2022",
      sourcemap: false,
      // Keine Inline-Skripte oder -Assets: der Server setzt eine strikte CSP (script-src 'self').
      assetsInlineLimit: 0,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
