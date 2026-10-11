# TravelBuddy – Bau und Betrieb

## Ablauf

```
git push main ──► GitHub Actions ──► Tests (Server, Web) ──► Image linux/amd64 ──► ghcr.io/rolfwalker71-commits/travelbuddy
                                                                                         │
                                         Server:  docker compose pull && docker compose up -d
```

- Workflow: `.github/workflows/docker.yml`. Baut **nur für x86 (linux/amd64)** auf einem x86-Runner (kein Emulator).
- Läuft bei Push auf `main` und bei Tags `v*` (nur wenn `server/`, `web/`, `shared/`, `VERSION` oder der Workflow sich ändern),
  bei Pull Requests ohne Veröffentlichung. Zuerst laufen Typecheck und Tests von Server und Web; scheitern sie, wird kein Image gebaut.
- Tags des Images: `latest` (Hauptzweig), `sha-<kurz>`, bei Release-Tags `v…`.
- In das Image fliessen `GIT_SHA` und der Bauzeitpunkt ein; sie erscheinen in `GET /v1/version` und in den Einstellungen
  («TravelBuddy 0.1.0 (Build a1b2c3d) · Server 0.1.0 · Stand dd.mm.yyyy hh:mm»).

## Einmalig auf dem Server

```bash
mkdir -p /home/travelbuddy/data/apns /home/travelbuddy/data/import && cd /home/travelbuddy
# docker-compose.yml und .env.example aus dem Repo hierher kopieren; .env anlegen und Werte eintragen
cp .env.example .env
sudo chown -R 1000:1000 data

# Das Repo ist privat, also ist es das Paket auch: Anmeldung bei ghcr.io mit einem Token (read:packages)
echo "<TOKEN>" | docker login ghcr.io -u rolfwalker71-commits --password-stdin

docker compose pull
docker compose up -d
docker compose exec -it travelbuddy node dist/create-user.mjs rolf "Rolf" --admin   # nur ohne Import
curl -s http://127.0.0.1:7780/healthz
```

Erster Start mit den bestehenden Reisen: `homebuddy.sqlite` und `documents/` nach `./data/import/` legen und in der `.env`
`TRAVELBUDDY_BOOTSTRAP_IMPORT=/data/import/homebuddy.sqlite` setzen. Der Server importiert sie beim ersten Start in die
leere Datenbank und führt den Saldo-Abgleich durch (Anmeldung dann mit den HomeBuddy-Zugangsdaten).

## Aktualisieren

```bash
docker compose pull && docker compose up -d
```

Mit festem Stand statt `latest`: in der `.env` `TRAVELBUDDY_TAG=sha-a1b2c3d` setzen.

## Hinweise

- **Reverse-Proxy:** HTTPS und Domain vor `127.0.0.1:7780` (z. B. Nginx Proxy Manager). Die Domain ist zugleich der
  `TRAVELBUDDY_MAPKIT_ORIGIN` für Apple Karten.
- **Backup:** Ordner `./data` (SQLite, `documents/`, `media/`, `apns/`). Datenbank im laufenden Betrieb am besten mit
  `sqlite3 data/travelbuddy.sqlite ".backup neu.sqlite"` sichern.
- **Schlüssel** (OpenAI, MapKit, APNs) stehen nur auf dem Server in `.env` bzw. `data/apns/`, nie im Repo und nie im Image.
- **Architektur:** Das Image ist x86. Auf einem ARM-Host (z. B. Apple Silicon) läuft es nur unter Emulation; für lokale
  Entwicklung `npm run dev` verwenden.
