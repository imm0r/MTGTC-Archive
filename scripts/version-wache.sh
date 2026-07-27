#!/usr/bin/env bash
# Wache nach dem Zusammenführen: Ist die Version auf main wirklich gestiegen?
#
# Gebraucht wird sie wegen einer Lücke, die kein Ereignis meldet: Die neue
# Nummer berechnet .github/workflows/version.yml aus dem ZIELZWEIG zum
# Zeitpunkt seines Laufs. Sind zwei Pull Requests gleichzeitig offen, rechnet
# der zweite gegen das main VOR dem ersten Merge — seine Nummer ist dann
# vergeben, sobald der erste zusammengeführt ist. Der push-Lauf zieht offene
# Pull Requests deshalb nach; diese Wache ist das Netz darunter, falls doch
# etwas durchrutscht.
#
# Bewusst ein eigenes Skript und kein Shell-Block im Workflow: Was einen Merge
# rot färben kann, gehört geprüft, und ein Block in der YAML lässt sich nicht
# ausführen, ohne den Workflow laufen zu lassen.
#
# Aufruf:  scripts/version-wache.sh [NEU] [ALT]
#          ohne Argumente: HEAD gegen HEAD~1
# Exit 0 = in Ordnung, 1 = Version steht oder ist gefallen, obwohl die App sich
# geändert hat.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEU_REF="${1:-HEAD}"
ALT_REF="${2:-HEAD~1}"

# Die App-Dateien: ändert sich hier nichts, darf die Version stehen bleiben
# (Doku- und Workflow-Commits sind kein Fehler). Wandert eine davon, MUSS die
# Nummer steigen — sonst liefe der Browser bis zu zehn Minuten auf dem alten
# Stand weiter (GitHub Pages, max-age=600 ohne must-revalidate).
APP_DATEIEN=(app.js i18n.js style.css index.html)

version_aus() {
  git show "$1:index.html" 2>/dev/null \
    | grep -oE 'name="app-version" content="[^"]*"' \
    | sed -E 's/.*content="([^"]*)"/\1/'
}

neu="$(version_aus "$NEU_REF" || true)"
alt="$(version_aus "$ALT_REF" || true)"

if [ -z "$neu" ]; then
  echo "::error::In $NEU_REF steht keine app-version in index.html."
  exit 1
fi
if [ -z "$alt" ]; then
  echo "Kein Vorgänger zum Vergleichen ($ALT_REF) — nichts zu prüfen."
  exit 0
fi

if [ "$alt" = "$neu" ]; then
  if git diff --quiet "$ALT_REF" "$NEU_REF" -- "${APP_DATEIEN[@]}"; then
    echo "Version unverändert ($neu) — an der App hat sich aber auch nichts geändert."
    exit 0
  fi
  echo "::error::Die App hat sich geändert, die Version steht aber weiter auf $neu."
  echo "::error::Vermutlich war ein zweiter Pull Request offen, dessen Nummer gegen ein älteres main gerechnet wurde."
  exit 1
fi

if node "$WURZEL/scripts/version.mjs" --hoeher "$neu" "$alt" >/dev/null; then
  echo "Version gestiegen: $alt → $neu."
  exit 0
fi

echo "::error::Die Version ist von $alt auf $neu GEFALLEN."
echo "::error::Das passiert, wenn ein offener Pull Request gegen ein älteres main gerechnet wurde."
exit 1
