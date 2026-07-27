# Hinweise für Claude

## Pull Requests selbst zusammenführen

Nicht nachfragen. Sobald die Voraussetzungen erfüllt sind, mergen — per
**Squash**, wie seit #91 üblich (linearer Verlauf, `(#NN)` im Titel).

Die Zusammenfassung dabei **von Hand schreiben**, nicht die Liste der einzelnen
Commits übernehmen, die GitHub vorschlägt. Zwei Gründe: der Verlauf auf `main`
liest sich als ein Text je Änderung, und der Commit der Versions-Automatik
trägt die Sprungmarke `[skip ci]` im Betreff (siehe
`.github/workflows/version.yml`) — wanderte die mit nach `main`, übersprängen
Pages-Build und CodeQL den Stand.

### Die Sprungmarke nie ausschreiben

**In keiner Commit-Nachricht und keiner PR-Beschreibung.** GitHub sucht sie
IRGENDWO im Text, nicht nur am Zeilenanfang, und macht keinen Unterschied
zwischen „hier wirkt sie" und „hier ist bloß von ihr die Rede". Eine Nachricht,
die sie erklärt, schaltet die Prüfläufe genauso ab wie eine, die sie meint.

Das ist keine Theorie: der Commit, der diese Zeilen einführte, erwähnte sie im
Rumpf — prompt lief `version.yml` für den Pull Request gar nicht erst an, und
die Version blieb stehen. (CodeQL lief weiter; dessen Default-Setup liegt nicht
unter `.github/workflows` und schert sich nicht um die Marke. Das Ausbleiben
fällt also nicht dadurch auf, dass alles rot wird — sondern gar nicht.)

Umschreiben statt ausschreiben: „die Sprungmarke ‚skip ci' in eckigen
Klammern". In Dateien wie dieser hier darf sie stehen; nur Commit-Nachrichten
und PR-Beschreibungen liest GitHub daraufhin aus.

Voraussetzungen, alle vier:

* alle Prüfungen grün (`skipped` zählt als in Ordnung),
* keine offenen Review-Kommentare,
* kein Konflikt mit dem Zielzweig,
* keine eigene Rückfrage offen, auf die noch keine Antwort vorliegt.

Ist eine davon verletzt, nicht mergen, sondern beheben oder sagen, was im Weg
steht.

**Ausnahme:** Sagt der Eigentümer zu Beginn einer Sitzung ausdrücklich etwas
anderes, gilt das für diese Sitzung.

## Pull Requests nicht als Draft anlegen

Direkt als „ready for review" öffnen, **nicht** als Draft. Ein Draft sperrt bei
GitHub den Merge-Knopf: die Prüfungen laufen zwar, aber zusammenführen lässt
sich nichts, bis jemand von Hand „Ready for review" klickt. Genau dieser
Handgriff blieb bei #103, #104 und #105 jedes Mal am Repository-Eigentümer
hängen und sah nach langer Wartezeit auf die Prüfungen aus — die tatsächlich
gemessen rund 75 Sekunden brauchen.

Das überstimmt bewusst die Voreinstellung der Arbeitsumgebung („create as
draft"). Die Absicherung liegt hier nicht im Draft-Status, sondern davor: vor
dem Push prüfen, und der Merge-Knopf bleibt ohnehin beim Eigentümer.

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
