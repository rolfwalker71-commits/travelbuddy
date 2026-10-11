import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow/latin-ext-400.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import { initTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/ticket.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/viz.css";
import "./styles/map.css";

async function start(): Promise<void> {
  // Fixture-Mocks (nur Entwicklung und Tests, per Umschalter; im Produktionsbündel nicht enthalten)
  if (import.meta.env.DEV) {
    const m = await import("./mocks/install");
    m.installMocksIfEnabled();
  }
  initTheme();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void start();
