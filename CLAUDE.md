# Hinweise für Claude

## Jeder Pull Request braucht eine Versionsstufe im Titel

**Zwingend.** In den Titel jedes Pull Requests gehört genau eine der Angaben
`[major]`, `[minor]` oder `[patch]`:

```
Eigenes Kartenbild in der Detailansicht hinterlegen [minor]
Doppelten Oracle-Kasten aus der Aufschlüsselung entfernen [patch]
```

`.github/workflows/version.yml` liest die Angabe, hebt
`<meta name="app-version">` in `index.html` an und setzt die `?v=`-Hashes.
Fehlt sie oder stehen zwei darin, schlägt der Lauf fehl und der Pull Request
lässt sich nicht zusammenführen.

### Die Stufe selbst entscheiden

Nicht nachfragen — die Regel steht fest (README.md, Abschnitt
„Versionsnummer"):

| Stufe | Wann |
| --- | --- |
| `[major]` | Grundlegende Änderungen, die Schnittstellen verändern können |
| `[minor]` | Neue Funktionen oder Erweiterungen, vollständig abwärtskompatibel |
| `[patch]` | Fehlerbehebungen und kleinere Optimierungen |

Im Zweifel die kleinere Stufe: eine zu niedrig angesetzte Nummer lässt sich im
nächsten Pull Request nachholen, eine zu hoch angesetzte nicht mehr
zurücknehmen.

Trägt ein Pull Request mehrere Arten von Änderungen, zählt die größte darin.

### Nicht von Hand in index.html schreiben

Weder die Version noch die `?v=`-Werte. Das erledigt der Workflow beim Pull
Request. Wer es doch lokal braucht (etwa zum Prüfen):

```bash
node scripts/version.mjs --pruefen   # nichts schreiben, Exit 1 bei Abweichung
node scripts/version.mjs minor       # anheben und Hashes auffrischen
```

Warum das automatisiert ist: Von Hand wurde es dreimal hintereinander
vergessen (#103, #104, #105). Die App liegt auf GitHub Pages, und Pages
liefert mit `cache-control: max-age=600` **ohne** `must-revalidate` aus — ein
Browser darf die alte Datei danach zehn Minuten weiterverwenden.
