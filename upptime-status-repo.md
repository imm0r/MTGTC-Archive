# Arcanum Archive Status Repository Template

Dies ist eine Vorlage zum Erstellen des Upptime Status-Repositories.

## Repository erstellen

1. Gehe zu https://github.com/new
2. **Repository name:** `MTGTC-Archive-Status`
3. **Description:** Status page for Arcanum Archive
4. **Public** (da die Status-Seite öffentlich sein soll)
5. **Add a README file:** Ja
6. **Create repository**

## Nach der Erstellung

Klone das neue Repo und füge folgende Dateien hinzu:

### 1. `.upptime.yml` (Konfiguration)

Kopiere diese Datei direkt aus dem Arcanum Archive Repo:

```bash
git clone https://github.com/imm0r/MTGTC-Archive-Status.git
cd MTGTC-Archive-Status
cp ../MTGTC-Archive/.upptime.yml .
```

### 2. GitHub Workflows

Erstelle die Ordnerstruktur:
```bash
mkdir -p .github/workflows
```

Dann erstelle folgende Dateien:

### `.github/workflows/uptime.yml`

```yaml
name: Check the uptime of the website
on:
  schedule:
    - cron: '*/5 * * * *'
  repository_dispatch:
    types:
      - Webhook_*
      - api_request
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
      - uses: actions/checkout@v4
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

### `.github/workflows/response-time.yml`

```yaml
name: Response Time CI
on:
  schedule:
    - cron: '0 23 * * *'
  repository_dispatch:
    types:
      - Webhook_*
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
      - uses: actions/checkout@v4
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

### `.github/workflows/setup.yml`

```yaml
name: Setup CI
on:
  push:
    branches:
      - master
  repository_dispatch:
    types:
      - Webhook_*
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
      - uses: actions/checkout@v4
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

### `.github/workflows/graphs.yml`

```yaml
name: Graphs CI
on:
  schedule:
    - cron: '0 0 * * *'
  repository_dispatch:
    types:
      - Webhook_*
  workflow_dispatch:
permissions:
  contents: write
  deployments: write
  pull-requests: write
jobs:
  release:
    name: Generate Graphs
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GH_PAT || github.token }}
      - name: Generate graphs
        uses: upptime/graphs@v1
        with:
          token: ${{ secrets.GH_PAT || github.token }}
          commit_message: "graphs: update [skip ci]"
          working-directory: graphs
```

### `.github/workflows/summary.yml`

```yaml
name: Summary CI
on:
  schedule:
    - cron: '0 0 * * *'
  repository_dispatch:
    types:
      - Webhook_*
  workflow_dispatch:
permissions:
  contents: write
  deployments: write
  pull-requests: write
jobs:
  release:
    name: Generate Summary
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
          token: ${{ secrets.GH_PAT || github.token }}
      - name: Generate summary
        uses: upptime/summary@v1
        with:
          token: ${{ secrets.GH_PAT || github.token }}
          commit_message: "summary: update summary [skip ci]"
```

## Erste Commits

```bash
git add .
git commit -m "Initial Upptime setup with Arcanum Archive monitoring"
git push origin master
```

## GitHub Pages aktivieren

1. Gehe ins Repo: **Settings → Pages**
2. **Branch:** `gh-pages`
3. **Folder:** `/`
4. **Save**

Die Status-Seite ist dann verfügbar unter:
- `https://imm0r.github.io/MTGTC-Archive-Status/` (Standard GitHub Pages URL)

## Custom Domain (optional)

Falls eine Custom Domain gewünscht ist (z.B. `status.arcanum-archive.de`):

1. In **Settings → Pages** unter "Custom domain" die URL eingeben
2. Im DNS-Provider folgende A-Records hinzufügen:
   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```
3. DNS-Propagation abwarten (bis zu 24h)

## Monitoring starten

Nach dem ersten Commit und Push:

1. GitHub Actions führen automatisch die Workflows aus
2. Erste Prüfung: ~1 Minute
3. Danach: Automatisch alle 5 Minuten
4. Status-Seite wird aktualisiert

## Fehlerbehandlung

**Workflows schlagen fehl?**
- Prüfe die Logs unter **Actions** im Status-Repo
- Stelle sicher, dass alle Dateien korrekt erstellt wurden

**Status-Seite zeigt keine Daten?**
- Warte 5-10 Minuten auf die erste automatische Prüfung
- Prüfe, ob die Workflows erfolgreich waren

**GitHub Pages deployt nicht?**
- Gehe zu **Actions** und prüfe, ob ein `pages build and deployment` Workflow erfolgreich war

---

## Nächste Schritte

1. Erstelle das Status-Repository
2. Füge die Dateien gemäß dieser Vorlage hinzu
3. Committe und pushe zum `master` Branch
4. Warte auf die erste automatische Prüfung (~5 Minuten)
5. Öffne `https://imm0r.github.io/MTGTC-Archive-Status/` zum Sehen der Status-Seite

Für weitere Konfigurationen siehe `UPPTIME_SETUP.md` im Arcanum Archive Repo.
