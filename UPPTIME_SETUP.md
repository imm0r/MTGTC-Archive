# Upptime Integration für Arcanum Archive

Upptime ist ein GitHub Actions-basiertes Uptime-Monitoring, das eine öffentliche Status-Seite generiert.

## Schnellstart (2 Schritte)

### 1. Separate Status-Repository erstellen

Erstelle ein neues GitHub Repository:
- **Name:** `MTGTC-Archive-Status` (oder ähnlich)
- **Sichtbarkeit:** Public (für die öffentliche Status-Seite)
- **Mit README initialisieren:** Ja

```bash
# Lokal klonen
git clone https://github.com/imm0r/MTGTC-Archive-Status.git
cd MTGTC-Archive-Status
```

### 2. Upptime-Dateien hinzufügen

Kopiere die folgenden Dateien aus dem Arcanum Archive Repo ins Status-Repo:

```bash
cp /home/user/MTGTC-Archive/.upptime.yml .
mkdir -p .github/workflows
```

Erstelle dann in der Status-Repository folgende Dateien:

**`.github/workflows/uptime.yml`** (Upptime generiert diesen selbst — dieser ist eine Vorlage):
```yaml
name: Check the uptime of the website
on:
  schedule:
    - cron: '*/5 * * * *'
  repository_dispatch:
    types:
      - Webhook_* # Allow `requests to trigger the script
      - api_request # Allow `requests to trigger the script
  workflow_dispatch:
permissions:
  checks: write
  contents: write
  deployments: write
  pull-requests: write
  statuses: write
jobs:
  release:
    name: Check Status
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GH_PAT || github.token }}
      - name: Check Status
        uses: upptime/uptime-monitor@v1
        with:
          token: ${{ secrets.GH_PAT || github.token }}
          commit_message: "status: update summary [skip ci]"
          status_website_token: ${{ secrets.STATUS_WEBSITE_TOKEN }}
```

**`.github/workflows/response-time.yml`** (Antwortzeitanalyse):
```yaml
name: Response Time CI
on:
  schedule:
    - cron: '0 23 * * *'
  repository_dispatch:
    types:
      - Webhook_* # Allow `requests to trigger the script
  workflow_dispatch:
permissions:
  contents: write
  deployments: write
  pull-requests: write
jobs:
  release:
    name: Check Response Time
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GH_PAT || github.token }}
      - name: Update response time
        uses: upptime/response-time@v1
        with:
          token: ${{ secrets.GH_PAT || github.token }}
          commit_message: "response-time: update [skip ci]"
          working-directory: history
```

**`.github/workflows/setup.yml`** (Erste Konfiguration):
```yaml
name: Setup CI
on:
  push:
    branches:
      - master
  repository_dispatch:
    types:
      - Webhook_* # Allow `requests to trigger the script
  workflow_dispatch:
permissions:
  checks: write
  contents: write
  deployments: write
  pages: write
  pull-requests: write
  statuses: write
jobs:
  release:
    name: Setup Upptime
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GH_PAT || github.token }}
      - uses: upptime/uptime-monitor@v1
        with:
          token: ${{ secrets.GH_PAT || github.token }}
          update_template: true
          commit_message: "chore: update template [skip ci]"
          status_website_token: ${{ secrets.STATUS_WEBSITE_TOKEN }}
```

### 3. Im Arcanum Archive Repo konfigurieren

Das Status-Repo ist nun eigenständig. Im Arcanum Archive Repo (`imm0r/MTGTC-Archive`) gibt es bereits:

- **`.upptime.yml`** — Zentrale Konfiguration (verweist auf das Status-Repo)
- **`.github/workflows/uptime-monitor.yml`** — Einfache Überwachung (5-Minuten-Intervall)

### 4. Domain konfigurieren (optional)

Um die Status-Seite unter einer Custom Domain zu betreiben (z.B. `status.arcanum-archive.de`):

1. Gehe ins Status-Repo: **Settings → Pages**
2. Wähle "Deploy from a branch" und Branch `gh-pages`
3. Unter "Custom domain" trage die Domain ein (z.B. `status.arcanum-archive.de`)
4. In deinem DNS-Provider A-Records zu GitHub Pages zeigen lassen:
   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

## Was wird überwacht?

Die `.upptime.yml` überwacht folgende Endpoints (konfigurierbar):

1. **Arcanum Archive App** — `https://imm0r.github.io/MTGTC-Archive/`
2. **Keyrune Font** — `https://imm0r.github.io/MTGTC-Archive/assets/keyrune/keyrune.woff2`
3. **Mana Font** — `https://imm0r.github.io/MTGTC-Archive/assets/mana/mana.woff2`
4. **Supabase Health** — `https://api.supabase.co/health`

Jeder Endpoint wird **alle 5 Minuten** geprüft.

## Konfiguration anpassen

In `.upptime.yml` können folgende Aspekte geändert werden:

```yaml
sites:
  - name: Name des Services
    url: https://beispiel.com
    expectedStatusCodes:
      - 200
    timeout: 10000  # ms
    headers:        # Optional: Custom Headers
      - header: Authorization
        value: Bearer TOKEN
```

### Häufige Änderungen

**Prüfintervall ändern** (Standard: 5 Minuten):
```yaml
checks:
  domains:
    interval: 300  # Sekunden (5 min = 300, 10 min = 600)
```

**Status-Seite URL** (z.B. custom Domain):
```yaml
status-website:
  cname: status.arcanum-archive.de  # oder status.example.com
```

**Weitere Endpoints hinzufügen:**
```yaml
sites:
  - name: Mein Service
    url: https://beispiel.com/api/health
    expectedStatusCodes:
      - 200
      - 201
    timeout: 5000
```

## Monitoring starten

Nach dem Setup wird Upptime automatisch gestartet:

1. **Erste Prüfung:** ~1 Minute nach dem ersten Commit
2. **Danach:** Alle 5 Minuten automatisch
3. **Status-Seite:** Verfügbar unter `https://imm0r.github.io/MTGTC-Archive-Status/`

## GitHub Actions Secrets (optional)

Falls du einen Personal Access Token verwenden möchtest (für bessere Ratelimits):

1. Gehe ins Arcanum Archive Repo: **Settings → Secrets and variables → Actions**
2. Füge hinzu:
   - **Name:** `GH_PAT`
   - **Value:** Dein GitHub Personal Access Token

Der Token braucht Zugriff auf:
- `public_repo`
- `read:org`

## Fehlerbehandlung

**Falsche Branches/Pull Requests von Upptime?**
- Das ist normal. Upptime aktualisiert automatisch die Statusdaten und erstellt Commits/PRs.
- Setze `assignees` in `.upptime.yml` um automatisch benachrichtigt zu werden.

**Domain zeigt zu GitHub Pages nicht?**
- GitHub braucht 24h für DNS-Propagation.
- Prüfe die DNS-Einträge mit `nslookup` oder `dig`.

**Endpoints werden nicht überwacht?**
- Prüfe, ob der Endpoint in `.upptime.yml` unter `sites:` korrekt ist.
- Teste manuell: `curl -v https://deine-url.com`

## Externe Ressourcen

- **Offizielle Upptime Docs:** https://upptime.js.org
- **Upptime Konfiguration:** https://upptime.js.org/docs/configuration
- **GitHub Actions Dokumentation:** https://docs.github.com/en/actions

---

## Zusammenfassung

Das aktuelle Setup nutzt **zwei Repos**:

| Repo | Zweck |
|------|-------|
| **imm0r/MTGTC-Archive** | Arcanum Archive App (Quellcode) + `.upptime.yml` + `.github/workflows/uptime-monitor.yml` |
| **imm0r/MTGTC-Archive-Status** | Upptime Status-Seite (automatisch generiert) |

Die Status-Seite wird unter `https://imm0r.github.io/MTGTC-Archive-Status/` gehostet und zeigt Echtzeit-Uptime für alle konfigurierten Endpoints.
