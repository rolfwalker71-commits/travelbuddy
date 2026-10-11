# syntax=docker/dockerfile:1
# Build-Kontext ist das Repo-Root:  docker build -f server/Dockerfile .
# (Docker war beim Schreiben nicht installiert: Datei und Compose sind noch nicht auf einem Docker-Host gelaufen.)

# ── Web-Client ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY VERSION /VERSION
# Web importiert Katalog und Illustrationen relativ zu ../../../shared (Layout wie im Repo: /web und /shared)
COPY shared/ /shared/
COPY web/ ./
RUN npm run build

# ── Server: Abhängigkeiten (inkl. native Module) + Bundle ────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Nur falls better-sqlite3 keine fertige Binärdatei für die Plattform findet.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm run build && npm prune --omit=dev

# ── Laufzeit ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7780 \
    TZ=Europe/Zurich \
    TRAVELBUDDY_TZ=Europe/Zurich \
    TRAVELBUDDY_DB_PATH=/data/travelbuddy.sqlite \
    TRAVELBUDDY_WEB_DIR=/app/web \
    TRAVELBUDDY_ILLUSTRATIONS_DIR=/app/shared/illustrations \
    TRAVELBUDDY_BUILD=${GIT_SHA} \
    TRAVELBUDDY_BUILT_AT=${BUILT_AT}
WORKDIR /app
# poppler-utils: Vorschaubilder der ersten PDF-Seite und Seitenbilder für Scans (pdftoppm). Ohne rendern die
#   Clients selbst bzw. geht das PDF direkt an das Vision-Modell.
# libheif-examples: `heif-convert` für HEIC-Fotos (iPhone) in der Dokumentanalyse. Ohne bleibt HEIC «übersprungen».
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils libheif-examples \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /web/dist ./web
COPY server/package.json ./
# Ereignis-Katalog (Quelle der Wahrheit, wird zur Laufzeit geladen) und Versionsdatei
COPY shared/event-types.json ./shared/event-types.json
# Mitteilungsbilder (PNG hell/dunkel) für GET /v1/media/notification/<imageKey>; Ordner per TRAVELBUDDY_ILLUSTRATIONS_DIR
COPY shared/illustrations/notifications ./shared/illustrations/notifications
COPY VERSION ./VERSION
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 7780
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7780)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.mjs"]
