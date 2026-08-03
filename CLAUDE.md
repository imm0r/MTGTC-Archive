# Hinweise für Claude

## Zu Beginn jeder Sitzung: den Stop-Hook flicken

```bash
node scripts/stop-hook-patch.mjs
```

Einmal, gefahrlos wiederholbar, und ohne diese Arbeitsumgebung tut es nichts.

**Warum.** Der Stop-Hook der Arbeitsumgebung schlägt aus zwei Gründen falsch an.

*Erstens der Bereich.* Er prüft `origin/<zweig>..HEAD`. Nach einem Squash-Merge
stimmt der nicht mehr: Der Fernzweig zeigt weiter auf den Stand *vor* dem Merge,
der lokale Zweig wird auf `main` zurückgesetzt (so verlangt es die Anleitung für
Folgearbeit) — und GitHubs Merge-Commit landet dadurch im geprüften Bereich.
Dort sieht er aus wie lokale Arbeit, die weder signiert noch gepusht ist. Er ist
beides nicht: gepusht längst, und signiert von GitHub statt von diesem Rechner.

Der Hook rät dann zu `git commit --amend`. **Nicht befolgen** — das schriebe
veröffentlichte Geschichte um, auf dem Zweig, von dem Pages und Vercel
ausliefern.

*Zweitens die Signaturfrage.* Er liest `%G?`, und das **verifiziert**. Bei
SSH-Signaturen braucht das `gpg.ssh.allowedSignersFile`; die ist hier nicht
eingerichtet (die Schlüsseldatei ist sogar leer), also meldet git `N` — dasselbe
wie für einen gar nicht signierten Commit. Jeder frisch erzeugte Commit sieht
damit unsigniert aus, sobald er am Zugende noch nicht gepusht ist, obwohl die
Signatur im Objekt steht und GitHub ihn als verified zeigt.

Das Skript nimmt beide Ursachen weg: Die Prüfungen klammern aus, was schon auf
`main` liegt, und fragen für die Signatur das Commit-Objekt selbst statt `%G?`.
Nachgemessen bleiben beide echten Fälle erhalten — ein unsignierter Commit und
einer mit falscher Identität werden weiterhin gemeldet.

Das ist ein Notnagel. Der Hook wird bei jeder Container-Bereitstellung neu
geschrieben, die Änderung überlebt die Sitzung also nicht — deshalb liegt sie
hier statt im Container. Nachgewiesen am 29.07.2026: Die Sitzung wurde um
08:48:20 neu aufgesetzt, der Hook kam im Original zurück und meldete prompt
wieder GitHubs Merge-Commit. Ein Aufruf des Skripts, und er schwieg.

**Schon gemeldet — nicht noch einmal melden.** Beide Fehlalarme sind bei
Anthropic eingegangen, Referenz-ID
`b5746b94-aef0-4d56-a8c4-22684b591659`. Behoben gehört der Hook dort, wo er
herkommt; hier ist nichts weiter zu tun, als das Skript zu Beginn der Sitzung
laufen zu lassen. Trägt eine künftige Fassung den Fehler nicht mehr, sagt das
Skript das von selbst („sieht anders aus als erwartet") und ändert nichts —
dann kann dieser Abschnitt samt `scripts/stop-hook-patch.mjs` weg.

## Pull Requests selbst zusammenführen

Nicht nachfragen. Sobald die Voraussetzungen erfüllt sind, mergen — per
**Squash**, wie seit #91 üblich (linearer Verlauf, `(#NN)` im Titel).

Die Zusammenfassung dabei **von Hand schreiben**, nicht die Liste der einzelnen
Commits übernehmen, die GitHub vorschlägt. Zwei Gründe: der Verlauf auf `main`
liest sich als ein Text je Änderung, und der Commit der Versions-Automatik
trägt die Sprungmarke `[skip ci]` im Betreff (siehe
`.github/workflows/version.yml`) — wanderte die mit nach `main`, liefe dort
kein Workflow aus `.github/workflows` mehr an. **Seit `pruefungen.yml` ist das
kein kleiner Schaden mehr:** die Prüfungen aus `tests/` hängen an `push` auf
`main` und blieben stillschweigend aus. (`prices.yml` und `uptime-monitor.yml`
laufen weiter nach Zeitplan und merkten nichts davon.)

Dieselbe Marke sorgt schon im Pull Request für eine Lücke: Nach dem Commit der
Versions-Automatik laufen die Prüfungen dort **nicht erneut**. Sie haben also
den Code-Commit gesehen, aber nicht den Stand, der zusammengeführt wird. Das
ist hinnehmbar, weil der Nachtrag nur `<meta name="app-version">` und die
`?v=`-Werte in `index.html` anfasst — und weil der Squash-Commit auf `main`
(ohne Marke, siehe oben) sofort einen vollen Lauf auslöst. Wer diese Reihenfolge
ändert, nimmt genau diese Absicherung weg.

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

## Jeder Pull Request trägt sich ins Changelog ein

`changelog.json` (Wurzelverzeichnis) ist das Changelog der App — der Klick auf
die Versionsnummer im Kopf zeigt es an. Vor dem Push einen Eintrag **vorn**
anfügen:

```json
{ "am": "<jetzt, ISO mit Zeitzone>", "art": "neu|verbessert|behoben",
  "text": "Zwei bis drei Zeilen, aus Nutzersicht.", "pr": <PR-Nummer> }
```

* **Aus Nutzersicht schreiben**, nicht aus Code-Sicht: „Karten lassen sich
  nach Thema filtern", nicht „cards_with_tag in filtered() verdrahtet".
* **`art`**: `neu` = konnte die App vorher nicht; `verbessert` = Bestehendes
  besser oder umgebaut; `behoben` = ein Fehler. Im Zweifel `verbessert`.
* **Weglassen**, was kein Nutzer sehen oder spüren kann (reine
  Arbeitsumgebung: Hooks, CI, CLAUDE.md selbst). Die Prüfungen zählen als
  spürbar, wenn sie eine sichtbare Änderung absichern — dann gehört der
  Eintrag zur Änderung, nicht zur Prüfung.
* Die PR-Nummer ist beim Schreiben noch nicht vergeben; die nächste freie
  nehmen (letzter PR + 1) und beim Anlegen des PR gegenprüfen.

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
