# Arcanum Archive

*Unearth your collection.*

Magic-Karten per Foto erfassen: Texterkennung liest den Kartennamen, Scryfall
liefert Set, Sammlernummer, Bild und Marktpreis, Supabase speichert die Sammlung
geräteübergreifend.

## Aufbau

| Datei                 | Zweck                                              |
|-----------------------|----------------------------------------------------|
| `index.html`          | Seitengerüst, Login- und Einrichtungsbereich        |
| `app.js`              | Logik: OCR, Scryfall, Supabase, Ansichten           |
| `style.css`           | Gestaltung                                          |
| `assets/fira/`        | Schrift der Oberfläche (Fira Sans Condensed), selbst gehostet |
| `assets/keyrune/`     | Set-Symbol-Font (Keyrune), selbst gehostet          |
| `assets/mana/`        | Mana- und Kartensymbol-Font (Mana), selbst gehostet |
| `supabase-schema.sql` | Tabellen, Row Level Security, Funktionen            |
| `supabase/functions/` | Edge Functions (Scan, Regelfrage, Terminmail …)     |
| `scripts/price-backfill/` | Node-Job: MTGJSON-Preisverlauf → Supabase       |
| `tests/`              | Prüfungen im echten Browser (siehe „Prüfungen“)     |
| `.github/workflows/`  | GitHub Action, die den Preis-Job nach Plan fährt    |
| `start.cmd`           | Nur für lokales Testen (braucht Python)             |

Kein Build-Schritt: Die Seite lädt Supabase und Tesseract per CDN. Alle
**Schriften** kommen dagegen aus `assets/` — die Icon-Fonts Keyrune und Mana
für Set- und Mana-Symbole, und **Fira Sans Condensed** für die Oberfläche. Kein
Fremdanbieter: Ein Aufruf an fonts.gstatic.com verriete jedem Besucher die
eigene Adresse an einen Dritten, und die Seite hinge an dessen Erreichbarkeit.

Von Fira liegen nur **latin und latin-ext** da, in drei Schnitten (400, 600,
700). Kyrillisch, Griechisch und Vietnamesisch lägen ungenutzt herum; die
Oberfläche spricht fünf Sprachen, die alle mit Latein auskommen. Der Browser
lädt ohnehin nur, was die `unicode-range` verlangt — gemessen holt eine
deutsche Seite zwei der sechs Dateien.

Ändert sich einer der Fonts, den `?v=` seiner CSS-Datei in `index.html` mit
hochzählen (wie bei `app.js`/`style.css`).

## Einrichtung

### 1. Supabase

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen (Region EU).
2. **SQL Editor** öffnen, Inhalt von `supabase-schema.sql` einfügen, **Run**.
   Das Skript ist wiederholbar — nach jeder Schemaänderung einfach erneut
   komplett ausführen. Vorhandene Daten bleiben dabei erhalten.
3. **Authentication → Sign In / Providers → Email**: „Confirm email“ ausschalten,
   sonst wartest du auf eine Bestätigungsmail, die der kostenlose Tarif nur
   sehr langsam verschickt.
4. **Project Settings → API**: Project URL und den anon/publishable key kopieren.

Beide Werte sind für den Browser bestimmt und dürfen öffentlich sein — die Daten
schützt die Row Level Security, nicht die Geheimhaltung des Schlüssels. Das
Datenbank-Passwort und der `service_role`-Key gehören **nicht** in diese App.

### 2. Veröffentlichen über GitHub Pages

```bash
git remote add origin https://github.com/<konto>/<repo>.git
git push -u origin main
```

Dann im Repository unter **Settings → Pages** als Source „Deploy from a branch“,
Branch `main`, Ordner `/ (root)` wählen. Nach ein bis zwei Minuten liegt die App
unter `https://<konto>.github.io/<repo>/`.

Project URL und Schlüssel stehen fest im `CONFIG`-Block oben in `app.js`. Sind
sie dort leer, fragt die App beim ersten Aufruf danach und merkt sie sich im
Browser.

**Nach jeder Änderung an `app.js` oder `style.css`** den Versionsanhang in
`index.html` hochzählen (`app.js?v=3`, `style.css?v=3`). Ohne das servieren
Browser und der Cache von GitHub Pages nach dem Push weiter die alten Dateien —
die Änderung wirkt dann scheinbar gar nicht.

### Versionsnummer

Die angezeigte Version steht in `index.html` und folgt Semantic Versioning:

```html
<meta name="app-version" content="0.12.0">
```

| Stelle | Wann sie steigt |
| --- | --- |
| **Major** (`X`) | Grundlegende Änderungen, die Schnittstellen verändern können |
| **Minor** (`X.Y`) | Neue Funktionen oder Erweiterungen, vollständig abwärtskompatibel |
| **Patch** (`X.Y.Z`) | Fehlerbehebungen und kleinere Optimierungen |

Steigt eine Stelle, werden die rechts davon auf `0` zurückgesetzt: nach `1.4.7`
kommt bei einer neuen Funktion `1.5.0`, bei einer Schnittstellenänderung `2.0.0`.

Die führende `0` ist Absicht: solange als registrierte Nutzer nur Tester
unterwegs sind, gilt nichts als festgeschrieben. Die `1.0.0` markiert den
Punkt, ab dem Schnittstellen verlässlich sind — bis dahin darf sich alles
ändern, ohne dass dafür die Major-Stelle steigen müsste.

Das ist **etwas anderes als `?v=`**, auch wenn beides in derselben Datei steht:

* `?v=` beantwortet „hat sich *diese Datei* geändert" und wandert je Datei
  einzeln — nur so holen Browser genau das Geänderte neu.
* Die Version beantwortet „welcher *Stand* ist ausgeliefert" und gilt für die
  App als Ganzes.

#### Beide werden automatisch gesetzt

Von Hand ging das schief: drei Zusammenführungen hintereinander (#103, #104,
#105) haben `app.js`, `i18n.js` und `style.css` geändert, ohne `index.html`
anzufassen. Auf GitHub Pages konnte danach bis zu zehn Minuten lang die alte
Datei ausgeliefert werden.

`.github/workflows/version.yml` übernimmt das jetzt beim Pull Request:

* **`?v=`** wird zum **Inhalts-Hash** der Datei (SHA-256, acht Zeichen) statt zu
  einem Zähler. Ein Zähler braucht ein Gedächtnis und kann driften, ein Hash
  nicht: gleiche Datei, gleicher Wert. Erfasst wird jedes `href`/`src` mit
  `?v=`, ohne gepflegte Dateiliste.
* **Die Version** wird um genau eine Stelle angehoben. Welche, kann kein
  Programm entscheiden — deshalb steht die Stufe **im Titel des Pull Requests**:

  ```
  Eigenes Kartenbild in der Detailansicht hinterlegen [minor]
  ```

  Erlaubt sind `[major]`, `[minor]` und `[patch]`, Groß- und Kleinschreibung
  ist egal. Fehlt die Angabe oder stehen zwei darin, schlägt der Lauf mit einer
  Anleitung fehl — lieber gar keine Version als eine erfundene.

Angehoben wird immer auf die Version im **Zielzweig**, nicht auf die im Zweig
des Pull Requests. So bleibt es bei mehreren Läufen am selben Pull Request bei
einer einzigen Anhebung.

### Zwei Pull Requests gleichzeitig

Genau daraus folgt eine Lücke, denn gerechnet wird gegen den Zielzweig **zum
Zeitpunkt des Laufs**: Sind A und B gleichzeitig offen, rechnet B gegen das
`main` *vor* A. Wird A zusammengeführt, trägt B eine längst vergebene Nummer —
B zu mergen ließe die Version stehen oder, bei kleinerer Stufe, sogar fallen.
Ein Ereignis dafür gibt es nicht: GitHub meldet keinem Pull Request, dass sich
sein Zielzweig bewegt hat.

Deshalb läuft `version.yml` **auch bei jedem Push auf `main`** und tut dort
zweierlei:

1. **Offene Pull Requests nachziehen** — jeder bekommt seine Nummer gegen das
   neue `main` neu berechnet und in seinen Zweig geschrieben. Damit stimmt sie
   wieder, ohne dass jemand etwas anfassen muss. (Pull Requests aus fremden
   Gabelungen werden übersprungen — dorthin lässt sich nicht schreiben.)
2. **Nachsehen, ob die Nummer wirklich gestiegen ist** — das Netz darunter,
   falls doch etwas durchrutscht. Steht sie still, obwohl sich `app.js`,
   `i18n.js`, `style.css` oder `index.html` geändert haben, oder ist sie
   gefallen, schlägt der Lauf fehl. Reine Doku- oder Workflow-Commits stören
   dabei nicht.

Von Hand nachfahren geht auch, `scripts/version.mjs` ist dasselbe Programm:

```bash
node scripts/version.mjs            # nur die Hashes auffrischen
node scripts/version.mjs minor      # Version anheben und Hashes auffrischen
node scripts/version.mjs --pruefen  # nichts schreiben, Exit 1 bei Abweichung
node scripts/version.mjs --stufe "Titel [minor]"   # Stufe aus einem Titel lesen
node scripts/version.mjs --hoeher 0.18.0 0.17.1    # Exit 0, wenn wirklich höher
scripts/version-wache.sh            # HEAD gegen HEAD~1 prüfen (wie nach dem Merge)
```

**Warum `?v=` überhaupt nötig ist:** Die App liegt auf GitHub Pages *und* auf
Vercel. Pages liefert mit `cache-control: max-age=600` **ohne**
`must-revalidate` aus — ein Browser darf die alte Datei also zehn Minuten
weiterverwenden, ohne nachzufragen. Vercel schickt `max-age=0,
must-revalidate` und käme ohne `?v=` aus. Maßgeblich ist Pages: auf diese
Adresse zeigt auch die Überwachung in `.upptime.yml`.

Beide gehören zu jeder Auslieferung hochgezählt: `?v=` bei jeder berührten
Datei, die Version je nach Art der Änderung. Hinge die Anzeige am `app.js?v=`,
bliebe sie bei einer reinen Stilkorrektur stehen, obwohl eine Fehlerbehebung
ausgeliefert wurde.

Fehlt das `<meta>` oder steht dort keine gültige Nummer, zeigt die App gar
keine Version an, statt eine erfundene zu behaupten.

### 3. Lokal testen (optional)

`start.cmd` startet einen lokalen Webserver auf Port 8000 und braucht dazu
Python. Für den Betrieb über GitHub Pages ist beides nicht nötig.

## Row Level Security richtig prüfen

Der publishable key steht im Browser und im Repository — der Schutz der Daten
hängt allein an RLS. Wer das im Browser nachprüfen will, muss aufpassen:
`createClient` lädt eine gespeicherte Anmeldung **automatisch** aus dem
localStorage (`sb-<projekt>-auth-token`). Ein vermeintlich anonymer Client ist
dann in Wahrheit angemeldet und sieht selbstverständlich alles — das sieht wie
ein Datenleck aus, ist aber nur die eigene Sitzung.

Ein echter anonymer Client braucht einen leeren Speicher:

```js
const leer = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const anon = supabase.createClient(URL, KEY, { auth: {
  persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage: leer } });
await anon.from("cards").select("id");   // muss 42501 liefern
```

Erwartet wird `42501` auf Lesen, Schreiben und `add_card`. Kommen stattdessen
Zeilen zurück, ist tatsächlich etwas offen.

Und: Schreib- oder Löschproben nie mit einem Filter formulieren, der breit
trifft. `.delete().neq("scryfall_id", "---")` trifft **jede** Zeile — bei
funktionierender RLS bleibt das folgenlos, bei einer echten Lücke löscht es
den ganzen Bestand. Eine Probe, deren Harmlosigkeit von der Lücke abhängt, die
sie prüfen soll, ist keine Probe.

## Wie eine Karte erkannt wird

1. **Bildmodell** (Edge Function `scan-card`): liest Setcode, Sammlernummer,
   Sprache sowie Token- und Foil-Zeichen in einem Zug. Robust bei Schräglage,
   Foil und winzigem Aufdruck.
2. **Tesseract**, wenn die Funktion nicht erreichbar ist — erst die untere
   linke Ecke, dann der Kartenname.
3. **Von Hand**: im Trefferfeld entweder den Namen oder `MKM 8` bzw. `MKM 8 T`
   eintippen.

Aus dem Gelesenen wird die Karte immer über Scryfall bestimmt — das Bildmodell
identifiziert nichts selbst, es liest nur ab.

**Was vom Foto kommt und was nicht.** Die Sprache liest die App von der Karte:
sie ist aufgedruckt und eindeutig, deshalb schlägt sie das Dropdown. **Foil und
Zustand kommen ausschließlich aus den Dropdowns** — beides sind physische
Eigenschaften, die ein Foto nicht verrät. Glanz entsteht auch, wenn eine Lampe
über einer normalen Karte steht; ein Fehlurteil legt eine eigene Zeile mit
falschem Preis an. Das `T` hinter der Nummer ist
dabei entscheidend: `mkm/8` und `tmkm/8` sind zwei völlig verschiedene Karten.

Fürs Fotografieren heißt das: Die untere linke Ecke sollte mit aufs Bild und
scharf sein — sie ist wertvoller als der Kartenname.

### Karte aus einem zweiten Fenster ziehen

Zwei Browserfenster nebeneinander: links die App, rechts Scryfall, Cardmarket
oder der Gatherer. Das Kartenbild von rechts nach links ziehen — egal in welche
Ansicht — und die Karte landet in der Sammlung.

**Wie viel gefragt wird, hängt davon ab, wie sicher der Treffer ist.** Benennt
die Adresse die Auflage eindeutig (Scryfall-Kennung, Set und Sammlernummer,
Multiverse- oder Cardmarket-Produktnummer), wird ohne Rückfrage geschrieben:
Die Sammlung springt auf die neue Zeile und hebt sie kurz hervor. Dort stehen
Bearbeiten und Entfernen ohnehin — eine Rückfrage davor hätte nur Sprache
(steht schon fest), Ausführung und Zustand angeboten, und die ändert die Zeile
genauso. Bleibt nur der **Namensweg** (Gatherer-Bild, markierter Text), kann
die falsche Karte herauskommen — dann erscheint die Bestätigung wie beim Scan,
in einem schwebenden Kasten unten rechts, samt Auswahlliste bei
Mehrdeutigkeit.

Voreinstellung ist dabei „Normal" und „NM" — wer regelmäßig Foils oder
gespielte Karten zieht, stellt die Dropdowns unter **Card Management → Karten
scannen** einmal um; sie gelten für beide Wege.

Erkannt wird dabei **die Adresse, nicht das Bild**: Ein aus einem fremden
Fenster gezogenes Bild kommt als Verweis an, und der trägt die Kennung schon
in sich — bei Scryfall die Karten-ID im Dateinamen, beim Gatherer Setcode und
Sammlernummer (bzw. die Multiverse-ID der alten Adressen), bei Cardmarket die
Produktnummer, die Scryfall als `cardmarket_id` mitführt. Das ist exakter als
jede Bilderkennung — es bezeichnet die Auflage, nicht bloß den Namen — und
kostet keinen Modellaufruf. Erst wenn die Adresse nichts hergibt, zählt der
mitgezogene Name (das `alt` des Bildes), notfalls mit Auswahlliste; auch ein
markierter Kartenname lässt sich so herüberziehen.

**Die Bilderkennung läuft beim Ziehen von einer Webseite nicht ungefragt an.**
Chromium legt die Bilddatei oft mit bei. Sie auszulesen ist nicht aussichtslos —
beobachtet hat die Erkennung „Agent of Erebos" durchaus gelesen, nur mit einer
verirrten Ziffer dahinter —, aber teuer: Ein Modellaufruf kostet KI-Kontingent,
und die anschließenden Namenssuchen dauerten in einem gemessenen Fall über zwei
Minuten, an deren Ende doch die Handkorrektur stand. Diese Kosten ungefragt
auszulösen, nachdem jemand nur ein Bild herübergezogen hat, ist die falsche
Vorgabe.

Trägt also keine Adresse, geht es **sofort** in die Handkorrektur — und dort
steht ein Knopf, der die Bilderkennung auf Wunsch doch noch anwirft. Angeboten
statt aufgedrängt.

Aus dem **Dateimanager** gezogene Bilder haben gar keine Adresse dabei; die
gehen unverändert den Scan-Weg, denn dort ist ein echtes Foto zu erwarten.

#### Die Sprache bei Cardmarket

Cardmarket führt je Auflage **ein** Produkt für alle Sprachen — die Sprache ist
dort eine Eigenschaft des einzelnen Angebots, nicht des Produkts. Deshalb zeigt
Cardmarket auch immer das englische Kartenbild, und die `cardmarket_id` einer
Karte gehört bei Scryfall stets dem **englischen** Druck. Über sie allein
landet man also zwangsläufig bei der englischen Auflage — mit englischem
Artwork, englischem gedruckten Namen und eigener `scryfall_id`.

Die Sprache kommt daher in dieser Reihenfolge:

1. **Der gedruckte Name** aus dem `alt`-Text des gezogenen Bildes — der beste
   Beleg, wenn Cardmarket ihn landessprachlich ausliefert.
2. **`?language=N`** in der Adresse. Cardmarket hängt die Nummer an gefilterte
   Produktseiten (`3` = Deutsch), und sie benennt die gesuchte **Karte** —
   anders als der Pfadteil `/de/`, der nur die Anzeigesprache der Seite meint.
   Ein deutscher Nutzer sieht dort auch englische Karten.
3. **Der Sprachteil der Adresse** (`cardmarket.com/de/…`).
4. **Das Dropdown „Sprache"** unter *Karten scannen*. Nötig, weil die
   Bild­adresse (`product-images.s3.cardmarket.com/…`) gar keinen Sprachteil
   hat — und das Bild ist genau das, was man zieht. Steht das Dropdown auf
   Deutsch, holt der Import die deutsche Auflage samt deutschem Artwork.

#### Wenn Scryfall die Auflage nicht in der Sprache führt

Das kommt für **ganze Sets** vor: Von Innistrad Remastered kennt Scryfall keine
einzige deutsche Karte, obwohl es sie gedruckt gibt. Dann greift ein Rückfall
in zwei Stufen:

1. Gibt es die **Auflage** in der Sprache, wird sie genommen — dann stimmt auch
   das Bild.
2. Sonst wenigstens der **gedruckte Name** aus einer anderen Auflage derselben
   Karte. Der Name gehört zur Karte, nicht zur Auflage: „Angelic Purge" aus
   Innistrad Remastered heißt auf Deutsch „Engelhafte Säuberung", nachweisbar
   über die Auflage aus *Shadows over Innistrad*. Bild und Kennung bleiben
   dann die gefundenen — etwas Besseres hat Scryfall nicht —, die Zeile führt
   aber Sprache und deutschen Namen.

Findet sich beides nicht (typisch für Tokens), bleibt es bei der englischen
Auflage: eine fehlende Sprachfassung ist kein Grund, die Karte fallenzulassen.

#### Das Bild kommt immer aus der eigenen Auflage

Ausgetauscht wird höchstens die **Sprache derselben Auflage** — Set und
Sammlernummer bleiben in jedem Fall gleich, das Motiv also auch. Der
Namensrückfall oben borgt ausschließlich Text aus einer Schwester-Auflage,
**nie das Bild**.

Das ist keine Kosmetik: Im Handel trennt oft ein Vielfaches des Preises einen
Normaldruck von seiner Showcase-Fassung. Ein Bild zu zeigen, das nicht auf der
Karte im Regal ist, wäre dort der teuerste Fehler.

Deshalb wird auch nicht geraten, wo Cardmarket uneindeutig ist: Für jedes
abweichende Artwork führt Cardmarket ein eigenes Produkt und hängt ab dem
zweiten ein `-V2`, `-V3` … an den Namen. **Welche** Sammlernummer damit gemeint
ist, verrät die Adresse nicht — der Import zeigt dann die Auflagen des Sets als
Auswahlliste, und du erkennst am Bild, welche du in der Hand hältst. Ohne
Kürzel ist der Normaldruck gemeint, der geht direkt durch.

Wer für eine bestimmte Karte ein eigenes Motiv will, hinterlegt es in den
Kartendetails selbst („Bild ersetzen").

**Altbestand** wird beim Start einmalig nachgezogen (`backfillGedruckteNamen`):
Zeilen, die eine Fremdsprache behaupten, aber den englischen Druck halten,
bekommen nach denselben zwei Stufen ihren gedruckten Namen und — wo die
Auflage existiert — auch das richtige Bild. Angefasst werden ausschließlich
Anzeigefelder; Menge, Zustand, Ausführung, Sprache und Preis bleiben
unberührt. Was nichts hergibt, wird gerätelokal vermerkt und nicht bei jedem
Start erneut abgefragt.

**Bei Scryfall und Gatherer steht die Sprache in der Adresse und schlägt alles**
— eine englische Scryfall-Adresse bleibt englisch, auch wenn das Dropdown auf
Deutsch steht. **Eine Ausnahme ist der neue Gatherer:** Sein Kartenbild trägt
weder Kennung noch Sprache (der Dateiname ist ein Hash, das `alt` immer
englisch), das Ziehen des Bildes findet die Karte also nur über den Namen.
Wer die Auflage samt Sprache exakt treffen will, zieht stattdessen **die
Adresse aus der Adressleiste** herüber — sie trägt Set, Nummer und Sprache
(`…/LTC/de-de/68/…`), genau wie ein Kartenlink aus den Gatherer-Suchtreffern.

#### Diagnose: was genau gelesen wurde

Findet ein Zug die falsche Auflage, hilft Raten wenig — deshalb gibt es unter
**Einstellungen → Verwaltung → Zieh-Import** den Schalter **„Diagnose
anzeigen"**. Er ist der **Adminrolle** vorbehalten und wirkt nur auf dem Gerät,
an dem er gesetzt wurde (localStorage, wie „Treffer sofort übernehmen"). Die
Rolle wird nicht nur beim Zeichnen geprüft, sondern auch bei jedem Zug: Sonst
liefe die Diagnose bei jemandem weiter, der sie als Admin eingeschaltet hatte
und die Rolle später verlor.

Solange er an ist, bleibt die Kachel im Zieh-Kasten stehen und trägt darunter
die vollständige Aufschlüsselung:

| Abschnitt | Inhalt |
| --- | --- |
| Abgelegte Daten (roh) | jeder Typ, den der ziehende Browser beigelegt hat, im Wortlaut (`text/uri-list`, `text/html`, …) |
| Gefundene Adressen / Namen | was daraus gewonnen wurde, in der Reihenfolge der Auswertung |
| Erkannte Kennungen | je Adresse Art, Quelle und alle Felder (Set, Nummer, Sprache, ID …) samt Rang |
| Versuche der Reihe nach | welcher Weg probiert wurde und was er lieferte — auch die erfolglosen |
| Ergebnis | Quelle, ob die Adresse eindeutig war, und die Felder der Scryfall-Karte inkl. Preisen |
| In die Sammlung geschrieben | Zeilen-ID, Sprache, Zustand, Ausführung, Preis |
| Fehler | die Meldung, falls etwas schiefging |

**Als JSON kopieren** legt alles in die Zwischenablage — zum Weitergeben
brauchbarer als ein Bildschirmfoto. Ausgeschaltet verhält sich alles wie
zuvor: schreiben, springen, Kachel weg.

### Edge Function einrichten

Die Funktion existiert aus einem einzigen Grund: Der Anthropic-Schlüssel darf
nicht in die App — auf GitHub Pages läge er offen. Sie prüft außerdem die
Anmeldung, damit niemand mit der bloßen URL auf deine Rechnung scannt.

1. Einen API-Schlüssel auf [console.anthropic.com](https://console.anthropic.com)
   anlegen und Guthaben aufladen.
2. Supabase → **Edge Functions** → **Deploy a new function**, Name `scan-card`,
   Inhalt von `supabase/functions/scan-card/index.ts` einfügen.
3. Supabase → **Edge Functions → Secrets**: `ANTHROPIC_API_KEY` setzen.

Ohne diese Schritte läuft die App weiter — sie meldet die Bilderkennung einmal
als nicht verfügbar und nutzt danach Tesseract.

**Kosten.** Beide Modelle an derselben Testkarte gemessen — sie lasen sie
identisch und fehlerfrei, inklusive des Token-Zeichens:

| Modell (`const MODEL` in `index.ts`) | Tokens (ein/aus) | Pro Karte | 1.000 Karten |
|---|---|---|---|
| `claude-haiku-4-5` (eingestellt) | 2.012 / 49 | 0,23 ct | 2,30 € |
| `claude-opus-4-8` | 2.304 / 63 | 1,31 ct | 13,10 € |

Die Wartezeit ist praktisch gleich (7,1 gegen 7,7 s kalt, ~4,5 s warm) — sie
steckt in Netzwerk und Kaltstart der Funktion, nicht im Modell.

Jede Antwort meldet unter `usage` die tatsächlich verbrauchten Tokens — damit
lässt sich das jederzeit nachrechnen statt schätzen.

## Regelfrage: strittige Spielsituationen klären

Im Benutzermenü unter **Regelfrage** lässt sich eine unklare Spielsituation in
ein paar Sätzen schildern; die App klärt sie gegen das **offizielle erweiterte
Regelwerk** (Comprehensive Rules) auf und zitiert die einschlägigen Regeln
wörtlich. Gedacht für die Live-Spielrunde, wenn am Tisch diskutiert wird, wie
eine Situation regeltechnisch ausgeht.

Der Kernpunkt gegen „klingt plausibel, ist aber falsch": Das Modell **rät nur,
welche Regeln relevant sind** — die Antwort selbst stützt sich ausschließlich auf
den echten Regeltext, der dazu aus der offiziellen Fassung geladen wird. Die im
Ergebnis gezeigten Zitate stammen **1:1 aus dem Regelwerk**, nicht aus dem
Gedächtnis des Modells: Erfundene Regelnummern fallen dabei heraus, gezeigt wird
immer die tatsächliche Formulierung.

Ablauf in der Edge Function `rules-question` (*propose-then-ground*):

1. **Triage** (kleines Modell): liest die Schilderung in beliebiger Sprache.
   Versteht es die Situation noch nicht eindeutig — fehlen wesentliche Angaben
   oder ist die Schilderung mehrdeutig —, **stellt es zuerst gezielte Rückfragen**
   und bricht hier ab (keine Regelsuche, kein teures Urteil), bis der Nutzer
   ergänzt. Ist die Situation klar, nennt es englische Such- und Glossarbegriffe
   sowie Kandidaten-Regelnummern.
2. **Retrieval**: holt genau diese Regeln und Glossareinträge wörtlich aus der
   geladenen Textfassung, dazu per Stichwort gefundene weitere Regeln.
3. **Urteil** (stärkeres Modell): antwortet nur auf Basis dieser Auszüge, in der
   Sprache der Oberfläche, mit klarem Ergebnis, Begründung und Regelnummern.

Die Rückfrage-Schleife darf sich wiederholen: reicht die Ergänzung noch nicht,
fragt das Modell erneut nach, bevor es urteilt.

Lädt das Regelwerk einmal nicht (Netz, veraltete URL), antwortet die Funktion im
abgesicherten Modus aus dem Modellwissen — mit deutlichem Hinweis, statt hart zu
brechen (wie die Bilderkennung auf Tesseract zurückfällt).

**Verlauf.** Jedes fertige Urteil wird in der Tabelle `rules_rulings` gespeichert
(jsonb-`payload`, damit neue Felder ohne Schemaänderung mitkommen) und beim
Öffnen der Ansicht wieder geladen — so bleiben geklärte Fragen nach einem
Neuladen abrufbar. RLS zeigt jedem nur die eigenen; über das ×-Zeichen an einer
Antwort lässt sich ein Eintrag wieder löschen. Rückfragen (ohne Urteil) werden
nicht gespeichert.

### Einrichten

Die Funktion selbst braucht wie `scan-card` nur den Anthropic-Schlüssel und ist
allein durch die Anmeldung geschützt. Für den **Verlauf** kommt die Tabelle
`rules_rulings` hinzu — dafür `supabase-schema.sql` erneut komplett ausführen
(das Skript ist wiederholbar, vorhandene Daten bleiben erhalten).

1. Supabase → **Edge Functions → Deploy a new function**, Name `rules-question`,
   Inhalt von `supabase/functions/rules-question/index.ts` einfügen.
2. Das Secret `ANTHROPIC_API_KEY` ist durch `scan-card` bereits gesetzt und wird
   mitgenutzt — nichts weiter zu tun.
3. **Optional** `RULES_TXT_URL`: Wizards datiert den Dateinamen der Textfassung
   bei jeder Aktualisierung. Die aktuell gültige `.txt` steht auf
   [Magic.Wizards.com/Rules](https://magic.wizards.com/en/rules); die Vorgabe im
   Code zeigt auf die zum Entwicklungszeitpunkt aktuelle Fassung. Bricht sie
   irgendwann, setzt du dieses Secret auf die neue URL — der Code bleibt
   unverändert. Die App zeigt bei jeder Antwort das Gültigkeitsdatum des
   geladenen Regelwerks an.

**Kosten.** Zwei Modell-Aufrufe je Frage: die günstige Triage und das eigentliche
Urteil (Modelle stehen als `MODEL_TRIAGE`/`MODEL_JUDGE` oben in `index.ts`). In
Summe rund **2–3 ct pro Frage** — für eine Spielrunde mit einem Dutzend
Streitfällen ein paar Cent. Jede Antwort meldet unter `usage` die verbrauchten
Tokens; die Kostenzeile im Ergebnis rechnet sie vor.

Das Ergebnis ist KI-gestützt und ohne Gewähr: auf Turnieren entscheidet der
Schiedsrichter, nicht die App.

## Terminplaner: Einladungen & Erinnerungen per Mail

Der Terminplaner kann zwei Arten von Mails verschicken:

1. **Einladung** — sobald ein Termin mit eingeladenen Freunden angelegt wird
   (oder später weitere eingeladen werden), bekommen diese eine Einladungs-Mail.
2. **Erinnerung** — rund **3 Stunden vor Beginn** an alle auf der Gästeliste
   außer Absagen. Das ist **pro Termin optional** (Häkchen „3 Stunden vorher per
   Mail erinnern"), standardmäßig aus.

Beides läuft über die Edge Function `event-mail`, die per **SMTP** über ein
normales Postfach verschickt (die Adressen der Eingeladenen liegen in
`auth.users` und sind nur serverseitig lesbar). Ohne die folgende Einrichtung
bleibt der Terminplaner voll nutzbar — es werden nur keine Mails versendet
(die App meldet das einmal als Hinweis).

### Einrichten

1. **Schema aktualisieren:** `supabase-schema.sql` erneut komplett ausführen
   (ergänzt die Spalten `remind`/`reminded_at` und erweitert `create_event`).
2. **Function deployen:** Supabase → **Edge Functions → Deploy a new function**,
   Name `event-mail`, Inhalt von `supabase/functions/event-mail/index.ts`.
   Diese Funktion prüft die Anmeldung selbst — daher **„Verify JWT" ausschalten**
   (der Cron ruft sie mit einem eigenen Geheimnis auf).
3. **Secrets setzen** (Edge Functions → Secrets):
   - `SMTP_HOST`, `SMTP_PORT` (z. B. `465`), `SMTP_USER`, `SMTP_PASS` — Zugang
     deines Postfachs. Für Gmail: ein **App-Passwort** erzeugen (nicht das
     normale Passwort), Host `smtp.gmail.com`, Port `465`.
   - `SMTP_FROM` — Absenderadresse (meist gleich `SMTP_USER`), optional
     `SMTP_FROM_NAME` (Vorgabe „Arcanum Archive").
   - `CRON_SECRET` — ein selbst gewähltes Geheimnis für den Erinnerungs-Cron.
   - optional `APP_URL` (Link zur App in der Mail), `EVENT_TZ` (Vorgabe
     `Europe/Berlin`). `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/
     `SUPABASE_ANON_KEY` stellt Supabase automatisch bereit.
4. **Erinnerungs-Cron einrichten** (Supabase → **SQL Editor**, einmalig). Setze
   `<CRON_SECRET>` auf denselben Wert wie oben:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('event-reminders', '*/15 * * * *', $$
     select net.http_post(
       url     := 'https://<PROJEKT-REF>.supabase.co/functions/v1/event-mail',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
       body    := '{}'::jsonb
     );
   $$);
   ```

   Alle 15 Minuten prüft der Sweep, welche Termine mit gesetzter Erinnerung in
   den nächsten 3 Stunden starten und noch nicht erinnert wurden, verschickt die
   Mails und merkt sich das (`reminded_at`), damit nichts doppelt kommt.

**SMTP statt Mail-API bewusst gewählt:** keine Domain-Verifizierung nötig, der
Absender ist das eigene Postfach — dafür gelten dessen Tageslimits (Gmail
~500 Mails/Tag), was für eine Spielgruppe reichlich ist. Der `CRON_SECRET`
gehört wie alle Secrets **nicht** ins Repository.

## Sammlung: was noch frei ist

Neben Suche, Set, Ausführung, Farbidentität und Kartentyp steht in der
Filterzeile der Haken **„Verbaute ausblenden"**. Er nimmt aus der Liste, was
schon in Decks steckt — die Frage dahinter ist immer dieselbe: *Was habe ich
noch übrig?*

**„Verbaut" heißt: alle Exemplare.** Hast du vier Blitzschläge und einer liegt
in einem Deck, bleibt die Zeile stehen — drei sind ja noch frei. Erst wenn alle
vier in Decks liegen, verschwindet sie. Das ist keine Auslegungsfrage, sondern
dieselbe Regel, die der Deckbau seit jeher als **„vergeben"** kennt: Ein
Exemplar, das schon in einem anderen Deck steckt, lässt sich nicht ein zweites
Mal verbauen. Zwei Auslegungen desselben Wortes an zwei Stellen liefen
auseinander, ohne dass irgendetwas rot würde.

Zwei Feinheiten, die man an der Oberfläche nicht sieht:

* **Gezählt wird über alle Decks zusammen.** Ein Exemplar in Deck A und eines in
  Deck B sind zwei — nicht zweimal eines.
* **Gezählt wird je Druck, nicht je Zeile.** Dieselbe Karte als Foil und als
  Normal sind zwei Sammlungszeilen und *ein* Bestand (Set + Sammlernummer,
  sprach- und zustandsunabhängig — genau wie beim Deck-Kontingent). Sie
  verschwinden deshalb gemeinsam oder gar nicht.

Der Haken zählt zu den Filtern, die geräumt werden, wenn der Blick auf eine
bestimmte Zeile springen soll — ein Sprung auf etwas Unsichtbares wäre keiner.
Gerechnet wird das Kontingent **einmal je Liste**, nicht je Zeile: Bestand und
Deckvorkommen gehen jeweils über alle Karten bzw. alle Decks, und der Filter
läuft bei jedem Tastendruck in der Suche.

## Wunschliste: was dir noch fehlt

Decks lassen sich mit Karten bauen, die man gar nicht hat — aus den
Synergie-Vorschlägen, aus einem Deck-Import oder von Hand. Diese Karten
belegen im Deck bereits ihren Platz und erscheinen dort als „fehlen“. Neben
**Sammlung** und **Decks** listet die dritte Kategorie **Wunschliste** genau
sie auf.

### Eine Karte direkt vormerken

Über der Liste steht **„Karte zur Wunschliste"**: Kartenname (mit Vorschlägen
von Scryfall) oder Setcode und Nummer wie bei der Handeingabe der Sammlung —
`MKM 8`, `FIN 9 T`, `PEMN 1Z`.

Vorher entstand ein Wunsch **nur über ein Deck**: Man musste eine Karte
einplanen, um sie sich zu merken. „Die will ich haben" ist aber keine Aussage
über ein Deck. Solche Wünsche stehen dann mit „in keinem Deck" in der Spalte
*Geplant in*, zählen mit einem Exemplar in die Summe und gehen wie alle anderen
in die Wants-Liste bei Cardmarket.

**Was schon da ist, kommt nicht noch einmal drauf.** Gefragt wird über Auflage,
Oracle-ID und zuletzt den Namen — dieselbe Frage, die auch der Wunschabgleich
stellt. Das ist wichtiger, als es aussieht: Ein Wunsch für eine Karte, die man
in einer *anderen* Auflage besitzt, würde vom Abgleich beim nächsten Zugang
wieder gelöscht (er hält ihn für erfüllt). Ihn anzulegen hieße, eine Zeile zu
schreiben, die still wieder verschwindet — die App sagt stattdessen, woran es
liegt, und springt zu der Zeile, die man schon hat.

> Geschrieben wird direkt in `cards`, ohne RPC: Ohne Deck bleibt nichts zu
> prüfen, was die Datenbank besser wüsste als der Browser. Die Funktion braucht
> deshalb **keine Schemaänderung** und wirkt sofort.

Es ist **keine eigene Tabelle**: Eine Wunschkarte ist eine ganz normale
Sammlungszeile mit **Bestand 0** — „will ich haben, habe ich nicht“.
Genau dort gehört sie hin, denn der Deckplatz hängt an ihr wie an jeder
anderen Karte, und Bild, Preis und Kartendaten sind dieselben. Die Sammlung
blendet diese Zeilen aus, die Wunschliste zeigt ausschließlich sie. Eine
zweite Tabelle hätte dieselben Spalten, dieselbe RLS und dieselben Fremd­
schlüssel gebraucht — und die Frage aufgeworfen, was beim Kauf zwischen den
beiden zu wandern hat.

Die Ansicht ist deshalb auch dieselbe wie die Sammlung: gleiche Tabelle
(`cardHead`/`cardRow`), gleiche Filter, gleiche Blätterleiste, unterschieden
nur durch einen Bereichsschlüssel. Zwei fast gleiche Ansichten getrennt zu
pflegen, hieße sie driften zu lassen. Was die Wunschliste weglässt, wäre
dort ohne Aussage: **Zustand** (immer die Vorgabe NM) und **Erscheinungsdatum**
gehören zu einer Karte, die man in der Hand hatte; ein **Foil-Filter** hätte
nie etwas zu filtern, weil jede Wunschkarte als „Normal“ entsteht. Statt der
Bestandszahl — die ist per Definition 0 — steht dort, **in welchen Decks** der
Platz schon vergeben ist. Der Preis bleibt, samt Summe über der Tabelle: das
ist die Frage, die man an eine Wunschliste stellt. „Alle bei Cardmarket“
öffnet dieselbe Wants-Liste wie „Fehlende Karten kaufen“ am einzelnen Deck,
nur über den gesamten Bestand an Wünschen.

### Wunsch streichen

Das × nimmt eine Karte von der Liste — **und damit auch ihren Deckplatz**
(`deck_entries` hängt per `ON DELETE CASCADE` an der Kartenzeile). Das ist
Absicht: den Wunsch zu streichen und die Lücke im Deck stehen zu lassen,
hieße einen Platz für nichts zu reservieren. Weil das mehr als eine Zeile
trifft, wird vorher gefragt — mit den Namen der betroffenen Decks, und mit
einer Warnung, falls die Karte dort Commander ist.

### Kauft man sie, löst sie sich von selbst ein

Nach **jedem** Zugang zur Sammlung — Scan, Handeingabe, Sicherung, Mythic-
Tools-CSV — gleicht die App Wunschliste und Bestand ab. Findet sie zu einer
Wunschzeile eine besessene Auflage derselben Karte (über `oracle_id`, sonst
den Namen — jede Auflage ist dieselbe Karte), dann

1. **wandert der Deckplatz** von der Wunschzeile auf das echte Exemplar, in
   jedem Deck, in dem sie eingeplant war,
2. **zieht ein Commander-Verweis mit um** (`decks.main_card_id` /
   `second_card_id`), damit das Deck nicht still seine Hauptkarte verliert,
3. **fällt der Platzhalter weg** — er hat jetzt weder Bestand noch Deckplatz.

Warum umhängen und nicht einfach zusätzlich einlegen: Der Platz ist längst
vergeben. Die gekaufte Karte wäre die 101. im Deck und im Commander zugleich
eine zweite Kopie derselben Karte. Das Umhängen erledigt
`fulfil_wish_in_deck` in **einem** Schritt in der Datenbank — zwei getrennte
Aufrufe aus dem Browser könnten dazwischen abbrechen und das Deck um eine
Karte kürzen, und in der falschen Reihenfolge liefe das Gutschreiben in den
100-Karten-Trigger.

Trifft der Zugang zufällig **dieselbe** Auflage in derselben Sprache,
Ausführung und demselben Zustand, gibt es nichts umzuhängen: `add_card` setzt
die vorhandene Zeile per `ON CONFLICT` auf Bestand 1, der Deckplatz sitzt
schon richtig. Die App meldet auch das als erfüllten Wunsch.

Der Abgleich läuft über den ganzen Bestand, nicht nur über die eben gescannte
Karte, und ist beliebig wiederholbar: Gibt es zu einer Wunschzeile keine
besessene Auflage, tut er nichts. So heilt er auch Wünsche, die aus anderen
Gründen stehen geblieben sind. Schlägt er fehl, bleibt der Zugang trotzdem
stehen — die Karte **ist** in der Sammlung, nur der Platzhalter blieb; der
nächste Zugang versucht es erneut.

> Meldet die App beim Einlösen einen Fehler, fehlt der Datenbank vermutlich
> `fulfil_wish_in_deck` — `supabase-schema.sql` erneut im SQL Editor ausführen
> (oder `supabase/migrations/20260725050000_fulfil_wish_in_deck.sql` einzeln).

## Eigene Kategorien: wozu eine Karte im Deck steht

Die Deck-Tabelle gruppierte lange allein nach **Kartentyp**. Diese Ordnung
bringt die Karte mit, nicht der Spieler: Sie sagt, *was* eine Karte ist, aber
nicht, *wozu* sie im Deck steht. Ein Sol Ring ist ein Artefakt, gespielt wird er
als Ramp; ein Swords to Plowshares ist eine Spontanzauberei, im Deck ist es
Removal. Wer ein Deck baut, denkt in der zweiten Ordnung — und rechnet in ihr:
„acht Ramp, zehn Removal, elf Kartenziehen" ist die Frage, die man an eine
Deckliste stellt, nicht „wie viele Spontanzauber".

Deshalb legt jeder Nutzer für **jedes seiner Decks** eigene Kategorien an. Über
der Tabelle steht der Umschalter **Nach Typ / Eigene Kategorien**, daneben
**Kategorien** für Anlegen, Umbenennen, Sortieren und Löschen.

**Je Deck, nicht je Nutzer.** Dieselbe Karte kann in einem Deck Ramp sein und im
nächsten Fixing, und ein Aggro-Deck braucht andere Fächer als ein Control-Deck.
Eine nutzerweite Liste hätte jedem Deck Kategorien aufgedrängt, die es nicht
braucht, und ein Umbenennen hätte überall gewirkt. Wer eine Liste
wiederverwenden will, übernimmt sie im Verwaltungsdialog aus einem anderen Deck
— **kopiert**, nicht geteilt.

**Eine Karte darf in mehreren Kategorien stehen.** Ein Sol Ring ist Ramp *und*
Teil des Artefakt-Pakets, ein Solemn Simulacrum ist Ramp *und* Kartenziehen —
beim Deckbau will man ihn in beiden Rechnungen sehen, nicht sich für eine
entscheiden müssen. Genau **eine davon ist die primäre** (der Stern im Dialog):
Sie beantwortet die Frage, die eine Mehrfachzuordnung offen lässt — wo die Karte
steht, wenn jede nur einmal vorkommen darf.

Der Preis dafür ist eine Aussage, die für die Typ-Gruppen noch galt: Die Summe
der Gruppen ist **nicht mehr** die Deckgröße. Sie kann sie übersteigen, sobald
eine Karte in zwei Fächern liegt. Die Zahl über der Tabelle zählt weiter jede
Karte genau einmal — nur die Zahlen an den Gruppen zählen Zuordnungen.

### Einordnen durch Ziehen

Der schnelle Weg: **die Karte am Griff anfassen und ziehen** — das ⋮⋮ links in
der Zeile. Sobald der Zug beginnt, werden die Fächer zu **Ablageflächen**: die
Spalten und Tabellenblöcke selbst, dazu ein schmaler Balken am unteren Rand für
das, was gerade nicht dasteht. Fallen lassen, fertig. Mit der Maus lässt sich
auch die Zeile selbst irgendwo anfassen, nicht nur der Griff.

Das ist nicht bloß Schauwert. Ablegen braucht im Layout **keinen Platz**: Es
verhält sich bei jeder Auflösung gleich, funktioniert in der Tabelle ebenso wie
in der Kartenansicht, und erspart das Einordnen Karte für Karte über einen
Dialog.

Die Regel dahinter, in drei Zeilen:

* **Loslassen** ordnet in das Fach ein und nimmt die Karte aus dem Fach heraus,
  aus dem sie *gezogen* wurde. Kam sie aus keinem — Typ-Ansicht oder „Ohne
  Kategorie" —, kommt das Ziel schlicht hinzu.
* **Mit Strg** (bzw. Cmd) kommt das Ziel immer nur *hinzu*; es fällt nichts weg.
  Der Hinweis im Balken wechselt mit der Taste, damit man vor dem Loslassen
  sieht, was passieren wird.
* Auf **„Ohne Kategorie"** abgelegt, fallen alle Zuordnungen weg.

Das Kennzeichen *primär* wandert mit: Es geht ans Ziel, wenn die Karte noch
keines hatte oder wenn ausgerechnet das ersetzte Fach es trug — sonst bleibt es,
wo es war. Fächer, in denen die Karte schon liegt, sind beim Ziehen als solche
gekennzeichnet. Eine Fläche **„+ Neue Kategorie"** legt eines an und ordnet
gleich ein.

#### Direkt in die Spalte — und der Balken, der die Lücke füllt

Der übliche Weg ist der kürzeste: **Die Spalten und Tabellenblöcke sind selbst
Ablageflächen.** Beim Ziehen leuchtet die Gruppe unter dem Zeiger auf, ein
ruhigerer Rahmen zeigt an, wo die Karte schon liegt — loslassen, fertig. Karten
lassen sich dabei **nur in Fächer des eigenen Decks** ablegen; sind zwei Decks
aufgeklappt, bleiben die Spalten des anderen stumm.

Am unteren Rand erscheint dazu ein schmaler Balken. Er **wiederholt nicht, was
ohnehin dasteht**: Wer nach Kategorien gruppiert, hat jedes Fach als Spalte vor
sich, und der Balken trägt nur noch „Ohne Kategorie" und „+ Neue Kategorie".
Wer nach Typ gruppiert, hat *keine* Fächer auf dem Schirm — dort führt der
Balken sie vollständig auf und ist der einzige Weg.

Diese beiden bleiben immer stehen, und das mit Grund: „Ohne Kategorie" gibt es
als Spalte nur, solange auch eine Karte darin liegt. Räumte man die letzte
heraus, verschwände mit ihr der Weg zurück. Und ein neues Fach legt im Zug
sonst nichts an.

Wo der Balken liegt, gewinnt er: Er fängt den Zeiger ab, alles daneben lässt
ihn zur Spalte darunter durch. Deshalb ist er flach und sitzt unten — dort
verdeckt er am wenigsten von dem, worauf man zielt, und am Handy liegt er, wo
der Daumen ohnehin ist.

Seine Breite steht fest statt mit dem Inhalt zu wachsen. Der Hinweis wechselt
mit der Strg-Taste, der zweite Text ist kürzer — ein mitwachsender Balken zuckte
mitten im Zug unter der Hand zusammen und nähme die Schaltflächen mit.

#### Die Truhe: zurück in die Sammlung

Unten rechts erscheint während eines Zuges eine **Truhe**
(`assets/del-card-from-deck.png`). Wer eine Karte dort fallen lässt, löst ihren
**Deckplatz** auf — die Sammlungszeile bleibt, wo sie ist. Genau das sagt das
Bild: Die Karte wandert nicht in den Müll, sondern zurück ins Regal. Dasselbe,
was der Papierkorb in der Tabellenzeile tut; in der Kartenansicht gab es dafür
bisher gar keinen Weg.

Ohne Rückfrage, mit Meldung: Ein Zug in die Truhe ist eine bewusste Bewegung
über den halben Bildschirm, und die Karte ist mit einem Griff wieder drin. Eine
Rückfrage bei jedem Ablegen machte gerade das Durchsortieren zäh, um das es hier
geht.

Rot statt Gold, und weit weg von den Schaltflächen in der Mitte: Die Goldtönung
heißt in dieser App überall „ausgewählt"; was etwas *wegnimmt*, darf nicht
dieselbe Farbe tragen wie das, was etwas zuordnet. Im schmalen Fenster wandert
sie nach oben rechts — unten stünde sie sonst im Balken.

### Geteilte Decks: die Einteilung des Erbauers

Gibt ein Freund ein Deck frei, sieht man dort jetzt **seine** Kategorien —
gruppiert wie bei ihm, mit Anzahl je Fach, „Ohne Kategorie" zuletzt. Das ist
Teil dessen, was geteilt wird: Ein Deck ohne Einteilung ist eine Liste, mit ihr
ein Bauplan.

Hat er keine angelegt, bleibt es bei der schlichten alphabetischen Liste — hier
wird nichts umgruppiert, was er nicht selbst so angelegt hat. Aus demselben
Grund gibt es hier auch **keinen Umschalter** zwischen Typ und Kategorien: Der
gehört dem Eigentümer der Ansicht und liegt in seinem Browser. Für einen fremden
Blick gibt es nur eine richtige Ordnung, die des Erbauers.

Die Kopfzeilen klappen nichts auf und sehen deshalb auch nicht danach aus.

### Automatisch einordnen

Hundert Karten von Hand einzuordnen ist auch mit Ziehen ein Abend Arbeit. Der
Knopf **⚡ Automatisch** schlägt für jede Karte **ohne Kategorie** eine vor —
anhand ihres Regeltexts.

Die Regeln sind bewusst **dieselben**, mit denen die Deck-Analyse zählt
(`AN_KATEGORIEN`): Ramp, Kartenvorteil, Entfernung, Boardwipes. Ein zweiter Satz
Muster daneben hieße, dass die Analyse eine Karte als Ramp zählt, die die
Einordnung nicht als Ramp ansieht — zwei Wahrheiten über dieselbe Karte. Dazu
kommen nur die **Länder**, die die Analyse nicht führt, weil sie dort keine
Funktionslücke sein können.

Drei Zusagen:

* **Angefasst wird nur, was noch nirgends liegt.** Was du selbst eingeordnet
  hast, ist eine Entscheidung; die überschreibt kein Automat.
* **Nichts geschieht ungefragt.** Der Vorschlag steht erst als Liste da —
  welche Kategorie wie viele Karten bekäme und wie viele ohne bleiben —, und
  wird erst auf OK geschrieben.
* **Fehlende Kategorien entstehen mit**, vorhandene gleichen Namens werden
  wiederverwendet.

Greift mehr als eine Regel, bekommt die Karte mehrere Fächer; die erste
greifende wird die primäre. Mit den engen Mustern der Analyse ist das der
Ausnahmefall — die Möglichkeit kostet aber nichts und verhindert, dass eine
Karte willkürlich einem Fach zugeschlagen wird, in das sie nur zur Hälfte
gehört.

Was keine Regel trifft (eine Vanilla-Kreatur etwa), bleibt unter „Ohne
Kategorie" liegen. Das ist Absicht: Geraten wird nicht.

### Kartenansicht: das Deck als Stapel

Über der Liste steht neben der Gruppierung ein zweiter Umschalter: **Tabelle**
oder **Karten**. In der Kartenansicht wird jede Gruppe eine **Spalte**, und die
Karten darin liegen als Stapel — sichtbar ist von jeder nur ihr
**Namensbalken**, also der obere Streifen des echten Kartenbildes. Beim
Überfahren **schwebt** die ganze Karte über dem Stapel.

Warum der Bildausschnitt und nicht Text: Der Balken trägt Name, Manakosten und
die Rahmenfarbe in der Gestaltung der Karte selbst. Das ist dieselbe Auskunft,
die eine Tabellenzeile in vier Spalten gibt — nur erkennt man sie, ohne zu
lesen. Wer Magic spielt, liest Karten ohnehin an ihrem Balken; genau so liegen
sie im Regal und in der Hand.

**Die Geometrie ist der ganze Trick.** Eine Magic-Karte misst 63 × 88 mm, ihr
Seitenverhältnis ist also 1 : 1,397, und der Namensbalken sitzt zwischen rund
4 % und 10 % der Kartenhöhe. Beides sind *Anteile*, keine Pixel — deshalb stimmt
der Ausschnitt bei jeder Spaltenbreite und auf jedem Bildschirm, ohne eine
einzige Pixelangabe:

* Das Fenster bekommt `aspect-ratio: 8/1`. Bei Breite B ist es B/8 hoch, also
  8,9 % der Kartenhöhe (B × 1,397) — das deckt den Balken samt Oberkante ab.
* Das Bild wird auf volle Breite gezogen und um 3,5 % **seiner eigenen Höhe**
  nach oben geschoben. Prozentwerte in `translateY` beziehen sich auf das
  Element selbst; genau das macht die Rechnung auflösungsunabhängig.
* Beim Überfahren erscheint dieselbe Karte ungeschnitten als **schwebendes**
  Bild über dem Stapel.
* Die **letzte Karte** eines Stapels liegt immer offen da. Beschnitten wird ja
  nur, weil jede Karte die nächste verdeckt — unter der letzten liegt aber
  nichts mehr. So sieht auch ein echter Fächer aus: lauter Namensbalken und
  obenauf eine ganze Karte. Das gilt auf jedem Gerät; mit dem Finger gibt es
  kein Überfahren, und sonst bliebe gar keine Karte zu sehen.

**Warum die Karte schwebt und den Stapel nicht auseinanderschiebt.** Das war
zuerst anders, und der Unterschied ist kein Geschmack: Schob das Aufklappen die
Karten darunter weg, war der Weg von unten nach oben ruhig und der von oben nach
unten unbrauchbar. Die aufgeklappte Karte wanderte unter den Zeiger, und beim
Verlassen sprang die Liste um ihre Höhe zurück — man landete nicht auf der
nächsten Karte, sondern irgendwo weiter unten. Schwebend bleiben die Streifen
fest liegen, und der Zeiger geht sie der Reihe nach ab, in beide Richtungen
gleich. Die schwebende Karte trägt dafür `pointer-events: none`: Sie verdeckt
die Streifen darunter, darf sie aber nicht abfangen.

**Die Kartenbilder sind ausdrücklich nicht ziehbar** (`draggable="false"` plus
`-webkit-user-drag: none`). Ein Bild ist es von Haus aus, und in der
Kartenansicht *ist* der Streifen ein Bild: Drückte man darauf und bewegte sich,
startete der Browser seinen eigenen Bild-Zug und meldete unseren Zeiger mit
`pointercancel` ab — die Ablageflächen erschienen dann gar nicht. Das Attribut
steht zusätzlich zur CSS-Eigenschaft am Element, weil Firefox auf letztere nicht
hört.

Eine Auflage ohne Bild klappt nicht auf (`:has(img)`) — sie würde sonst zu einem
großen leeren Rechteck mit einem Namen darin. Ihr Balken bleibt ein Balken.

**Kein Namenszettel des Browsers.** Die Streifen tragen kein `title`. Er legte
sich über die Karte, die gerade aufklappte, kam mit Verzögerung und ging beim
Ziehen nicht weg — und sagte nichts, was die aufgeklappte Karte nicht besser
zeigt. Der Fehlbestand steht damit nicht mehr in Worten da; er bleibt am roten
Ring und an der roten Menge daneben ablesbar.

Der Kopf jeder Spalte nennt **Anzahl und Wert** der Gruppe und klappt sie zu;
der Zustand ist derselbe wie in der Tabelle. Eine fehlende Karte trägt eine rote
Kante statt der roten Pille, der Commander eine goldene — in einem Stapel ist
der Rand die einzige Fläche, die frei bleibt. Hat eine Auflage bei Scryfall kein
Bild, zeigt der Balken schlicht den Namen.

#### Was beim Scrollen stehen bleibt

Eine Kategorie mit vierzig Karten ist mehrere Bildschirme hoch. Zwei Dinge
**kleben** deshalb:

* Der **Spaltenkopf**. Scrollte er weg, stand man vor einer Wand aus
  Namensbalken und wusste beim Ziehen nicht mehr, welche Spalte welche ist —
  genau in dem Moment, in dem man es braucht.
* Die **Deckleiste**: links der Zugang zur Sammlung, rechts der Name des Decks,
  an dem man gerade baut. Sie ist **keine Kachel** — kein Grund, kein Rahmen.
  Was dort steht, sind zwei Dinge: eine Schaltfläche, die ihren eigenen Rahmen
  mitbringt, und ein Name. Eine Fläche darum herum wäre ein Kasten um nichts.
  Der Name trägt dafür einen Schatten statt eines Grundes: Er schwebt über
  Kartenbildern, und Gold auf hellem Rahmen ist sonst schwer zu lesen.

Ab **1000 px Fensterbreite steht die Leiste neben dem Raster**, nicht darüber:
Sie ist dann null Pixel hoch, und Knopf und Name ragen links und rechts in
Ränder hinein, um die das Raster einrückt. Der Gewinn ist der Zwischenraum —
solange sie eine eigene Zeile belegte, klebten die Spaltenköpfe um ihre Höhe
tiefer, und zwischen Seitenkopf und erstem Spaltentitel klaffte ein leerer
Streifen. Bezahlt wird das mit schmaleren Spalten; ein sehr langer Deckname wird
gekürzt (vollständig steht er im Deck-Kopf darüber). Unter 1000 px wäre der
Handel zu teuer — dort steht die Leiste weiter über dem Raster.

Aufgeklappt ist **immer höchstens ein Deck**. An einem Deck arbeitet man, nicht
an dreien; zwei Kartenansichten untereinander sind zwei Spaltenlandschaften, und
welche Spalte zu welchem Deck gehört, sieht man ihr nicht an. Der gespeicherte
Wert bleibt eine Liste, damit ältere Stände lesbar bleiben — gelesen wird davon
nur noch das erste, und so heilt sich der Zustand beim ersten Aufruf.

Wie hoch Seitenkopf und Deckleiste gerade sind, wird **gemessen** und als
`--kopf-oben` / `--leiste-hoehe` abgelegt. Feste Zahlen im Stylesheet stimmten
für ein Fenster und eine Sprache und für keine andere: Die Navigation bricht im
schmalen Fenster um, und wie viele Zeilen dabei entstehen, hängt an der Länge
der Wörter. Gemessen wird nach jedem Zeichnen *und* per `ResizeObserver` — auf
`border-box`, denn `offsetHeight` schließt Polster und Rahmen ein. Manches
findet erst später statt: `zahlenfelderAufwerten()` hüllt Zahlenfelder im
nächsten Bild in eine eigene Hülle, Schriften und Bilder kommen nach. Ohne die
Nachmessung stand die Leiste höher da als gemeldet — und die Spaltenköpfe
klebten hinter ihr.

#### Karte ins Deck: eintippen und hinüberziehen

Links in der Leiste steht im Ruhezustand nur ein **Symbol**
(`assets/add-card-to-deck.png`; fehlt die Datei, tritt die Beschriftung an seine
Stelle — ein Knopf ohne beides wäre eine leere Fläche, die niemand anklickt).
Der Klick klappt das Suchfeld nach rechts aus; was man tippt, sucht in der
**eigenen Sammlung**. Aus der Trefferliste **zieht** man die Karte in die
Kategorie, in die sie gehört — dieselbe Geste wie das Umsortieren, nur dass der
Deckplatz dabei erst entsteht.

Beginnt der Zug, schließt sich die Trefferliste **sofort**. Seit die Leiste
neben dem Raster steht, hängt die Liste genau über der ersten Spaltenreihe; von
selbst verschwände sie erst eine Viertelsekunde später, und in der sieht man die
Ziele nicht, auf die man zielt.

Kein Mengenfeld, kein Hinzufügen-Knopf. Beides kostete Breite in einer Leiste,
in der die Breite dem Decknamen fehlt, und der Weg über zwei Schritte („wählen",
dann „hinzufügen", dann irgendwann einordnen) ist länger als der über einen.
Eine zweite Kopie holt man, indem man ein zweites Mal zieht.

Die Reihenfolge beim Ablegen ist zwingend: erst der Deckplatz, dann das Fach.
Die Zuordnung hängt über einen zusammengesetzten Fremdschlüssel
`(deck_id, card_id)` am Deckplatz — gäbe es ihn noch nicht, wiese die Datenbank
sie ab. Nach einem Namen für eine neue Kategorie wird deshalb **vorher** gefragt:
Bricht man dort ab, soll gar nichts geschehen sein.

**Was gar nicht erst in der Liste steht.** Eine Frage, eine Antwort
(`zugabeGrund`) — die Liste blendet aus, was nicht darf, und das Ablegen prüft
dieselbe Regel noch einmal. Die zweite Prüfung wird gebraucht: Zwischen dem
Tippen und dem Loslassen kann ein zweites Gerät das Deck gefüllt haben.

| Fall | Warum |
| --- | --- |
| Karte liegt schon in diesem Deck | Der Deckplatz ist da; mehr davon regelt die Menge |
| Alle besessenen Exemplare stecken in anderen Decks | Ein Exemplar lässt sich nicht zweimal verbauen |
| Commander-Singleton erreicht | Der Platz ist nicht weg, er ist an genau diese Karte vergeben |
| Deck hat 100 Karten | Erst muss eine heraus — die Liste sagt es als Zeile, nicht als Leere |

Das **Einlösen eines Wunsches** steht vor allen diesen Prüfungen: Steht dieselbe
Karte schon als fehlender Eintrag im Deck und hat man sie inzwischen gekauft,
wird der Eintrag umgehängt, statt einen neuen anzulegen. Das Deck wächst dabei
nicht — und im vollen Deck ist es der einzige verbliebene Weg.

Beim Ziehen aus der Liste bleibt die **Truhe** aus: Aus einem Deck nehmen
kann man nur, was darin ist.

In der Trefferliste zeigt das Überfahren eines Eintrags dieselbe
**Kartenvorschau** wie in der Tabelle. Ein Name mit Set-Kürzel sagt nicht, ob es
die richtige Karte ist — vier Auflagen derselben Karte lesen sich in dieser
Liste fast gleich.

In der **Tabellenansicht** bleibt der Werkzeugkasten mit Feld, Menge und Knopf,
wie er war. Dort ist das Ziehen in einen Block zwar auch möglich, aber das
Hinzufügen mehrerer Kopien auf einmal („vier Wälder") der häufigere Fall.

**Ziehen funktioniert hier genauso.** Streifen anfassen, Fächer erscheinen,
loslassen — mit der Maus überall, mit dem Finger an der Mengenangabe links.
Beide Ansichten teilen sich dieselbe Verdrahtung; zwei getrennte liefen
auseinander, sobald eine von beiden geändert würde.

Auf Geräten ohne Zeiger gibt es das Aufklappen nicht: Dort führt der Tipp zur
Detailansicht, die ohnehin mehr zeigt als das Bild allein.

### Warum Zeigereignisse und nicht HTML5-Ziehen

Der erste Anlauf hing an `draggable="true"` samt `dragstart`/`drop` — die
naheliegende Wahl und die falsche:

* Auf **Touch-Geräten gibt es das schlicht nicht.** Kein Finger löst je ein
  `dragstart` aus; auf dem Handy wäre gar nichts zu ziehen gewesen.
* **Safari** behandelt ziehbare Tabellenzeilen eigenwillig.
* Am Rechner konkurriert es mit der **Textmarkierung**: Wer auf einem
  Kartennamen drückt und zieht, markiert unter Umständen nur Text.
* Und vor allem: **Man sieht einer Zeile nicht an, dass sie ziehbar ist.**

Zeigereignisse haben keines dieser Probleme. Sie sind für Maus, Finger und Stift
dieselben, sie liefern die Bewegung selbst, und sie hängen an einem sichtbaren
Griff. Der trägt `touch-action: none` — ohne das rollt die Seite unter dem
Finger weg, statt die Karte mitzunehmen.

**Bewegung und Loslassen hören am Fenster zu, nicht am angefassten Element.**
Das klingt nach einer Kleinigkeit und ist die entscheidende Stelle: Ein
Stapelstreifen ist rund 23 px hoch, und schon die sechs Pixel bis zur
Zugschwelle führen den Zeiger heraus. Hingen die Ereignisse am Streifen, käme
danach keines mehr an — der Zug begänne nie, das Loslassen erreichte ihn
ebenso wenig, und der halb gesetzte Zustand bliebe stehen. In der Tabelle fiel
das nicht auf, weil eine Zeile 64 px hoch ist.

Der naheliegende Ausweg — den Zeiger mit `setPointerCapture` einfangen — ist
hier **falsch**: Ein gefangener Zeiger leitet auch den folgenden `click` auf das
fangende Element um. Das Kartenbild bekäme seinen Klick nie mehr, und die
Detailansicht ginge nicht auf. Am Fenster zuzuhören löst dasselbe Problem, ohne
dieses zu schaffen.

Ein Zug beginnt erst nach **sechs Pixeln** Bewegung: genug, um ein Zittern der
Hand nicht als Zug zu lesen, wenig genug, dass er sofort einsetzt, wenn er
gemeint war. Kommt eine Bewegung ohne gedrückte Taste an, wird ein angefangener
Ansatz verworfen — das fängt den Fall ab, dass ein Loslassen gar nicht bei uns
ankam (außerhalb des Fensters, vom System abgefangen). Darunter bleibt es ein Klick, der wie bisher die Detailansicht
öffnet. Umgekehrt wird der Klick, der einem Zug folgt, verschluckt — sonst ginge
nach jedem Ziehen vom Kartenbild aus die Detailansicht auf.

Dass der **Zieh-Import** (Karten aus einem zweiten Fenster hereinziehen) nicht
mehr in die Quere kommen kann, ist ein Nebenertrag: Es feuert gar kein
Zieh-Ereignis mehr, an dem er sich stören könnte.

### … und der Weg ohne Ziehen

Die **Kategorie-Spalte** der Kartenzeile bleibt, was sie war: Sie zeigt die
Fächer als Marken (die primäre hervorgehoben) und öffnet auf Klick eine Auswahl
mit Häkchen und Stern. Das ist der bequemere Weg, wenn eine Karte gleich in
mehrere Fächer soll — und am Handy der Weg für alles, was über ein Verschieben
hinausgeht, denn eine Strg-Taste gibt es dort nicht. Beide Wege schreiben durch
dieselbe Funktion; zwei Wege zu derselben Datenbank, die auseinanderliefen,
wären zwei Fehlerquellen.

**Beide Ordnungen bleiben.** Umgeschaltet wird je Deck und je Gerät, gemerkt im
Browser. Das ist keine Unentschlossenheit: Ein halb eingeordnetes Deck ist der
Regelfall — 100 Karten ordnet niemand in einem Zug ein —, und solange das so
ist, sagt die Typ-Ansicht mehr. Voreingestellt ist deshalb keine feste Ordnung,
sondern eine Frage an das Deck: Hat es eigene Kategorien, zeigt es sie; sonst
bleibt alles wie zuvor. Die erste angelegte Kategorie wirkt so sofort und auf
jedem Gerät, ohne dass irgendwo etwas eingestellt sein müsste.

Nicht zugeordnete Karten sammeln sich unter **„Ohne Kategorie"** — am Ende, wie
schon die Restgruppe der Typ-Ansicht. Eine **leere eigene** Kategorie bleibt
dagegen stehen: Sie ist eine Aussage des Nutzers, und wer gerade „Ramp"
angelegt hat, soll sie sehen. Eine leere Typgruppe fällt weg, denn sie ist
abgeleitet — „0 Planeswalker" hat niemand behauptet.

### Was beim Umbauen mit der Kategorie geschieht

Die Zuordnungen stehen in `deck_entry_categories` und hängen am **Deckplatz**
(`deck_id, card_id`), nicht an der Karte — dieselbe Karte darf in einem anderen
Deck etwas anderes sein. Der Fremdschlüssel zeigt deshalb auf `deck_entries`:
Fliegt die Karte aus dem Deck, fliegen ihre Zuordnungen mit, und eine verwaiste
Einordnung für eine Karte, die gar nicht mehr drinliegt, kann es nicht geben.

Daraus folgt, was bei jedem Umhängen zu tun ist, und beides tut die App:

* **Wunsch eingelöst.** `fulfil_wish_in_deck` hängt den Deckplatz von der
  Wunschzeile auf das gekaufte Exemplar um und **nimmt die Kategorien mit** —
  gemerkt *vor* dem Abziehen, denn mit der Wunschzeile verschwänden sie.
  Wer eine Wunschkarte unter „Removal" eingeplant hat, hat den *Platz*
  eingeordnet, nicht den Platzhalter; gingen sie verloren, zerfiele die
  Einteilung genau in dem Moment, in dem das Deck echt wird.
* **Zwei Zeilen fallen zusammen** (Bearbeiten auf eine schon vorhandene
  Ausprägung): dasselbe. In beiden Fällen behält die **Zielzeile** ihre eigene
  Einteilung, falls sie eine hat — die der verschwindenden springt nur ein, wo
  noch nichts steht.

Eine gelöschte Kategorie nimmt **keine Karten** mit: Das `on delete cascade`
räumt nur die *Zuordnung* weg, die Karte bleibt im Deck und steht wieder unter
„Ohne Kategorie". Wer ein Fach loswerden will, will nicht den Inhalt loswerden.

Zwei Dinge erzwingt die Datenbank, nicht die Anwendung:

* Eine Zuordnung zeigt nur auf eine Kategorie **desselben Decks** (Trigger
  `deck_entry_kategorie_passt`). Eine fremde wäre eine Gruppe, die dieses Deck
  gar nicht anzeigt — die Karte verschwände aus der Liste.
* **Höchstens eine primäre** je Karte und Deck (Teilindex
  `deck_entry_categories_primaer_idx`). Ein `check` genügte dafür nicht: Der
  sieht nur die eigene Zeile, „genau eine unter allen Zeilen dieser Karte" ist
  aber eine Aussage über die Menge.

> Meldet die App „Dafür fehlt der Datenbank die Tabelle `deck_categories`", ist
> das Schema älter als die App — `supabase-schema.sql` erneut im SQL Editor
> ausführen (oder die beiden Migrationen
> `20260727190000_deck_kategorien.sql` und
> `20260727200000_deck_kategorien_mehrfach.sql` einzeln, in dieser Reihenfolge).
> Bis dahin läuft alles wie zuvor, nur eben nach Typ gruppiert.

> Wer schon 0.23.0 im Einsatz hatte: Dort saß die Zuordnung als
> `deck_entries.category_id`, also genau eine je Karte. Der Umzug ist
> verlustfrei — jede vorhandene Zuordnung wird zur **primären** der neuen
> Tabelle, denn eine einzige ist immer auch die erste.

## Synergie-Vorschläge: aufgehoben statt weggeworfen

Am Deck stehen zwei Wege zu Vorschlägen: die **heuristische Suche** (Haken aus
den Deckkarten → Scryfall) und die **KI-Suche** (die Deckliste als Kontext an
Claude, jeder Vorschlag gegen Scryfall geprüft). Beide schreiben in denselben
Kasten.

**Das Ergebnis bleibt jetzt liegen.** Vorher war es beim nächsten Neuzeichnen
weg — und ein Neuzeichnen löst schon aus, wer eine der vorgeschlagenen Karten
ins Deck legt. Genau der Handgriff, für den man die Vorschläge geholt hat, warf
sie also fort. Ein Lauf kostet: die heuristische Suche mehrere Anfragen an
Scryfall, die KI-Variante Tokens und damit Kontingent.

Aufgehoben wird **eine Zeile je Deck** (`deck_synergies`, Primärschlüssel ist
die `deck_id`): Gezeigt wird immer der letzte Lauf, ein neuer überschreibt ihn.
Ein Verlauf der Vorschläge wäre etwas anderes als ein Vorschlag.

Über dem wiederhergestellten Lauf steht, **wann** er entstand — und, wenn sich
das Deck seither geändert hat, dass er womöglich überholt ist. Verglichen wird
über denselben **Fingerabdruck**, den auch der Deck-Verlauf führt. Ohne diesen
Hinweis läse man alte Vorschläge als aktuelle; das ist der Fehler, den ein
Gedächtnis leicht macht. Daneben steht „Verwerfen“.

Zwei Feinheiten:

* **Gespeichert wird nur, was gebraucht wird.** Je Vorschlag die Scryfall-Karte
  auf die Felder eingedampft, die die Kachel zeichnet und der „+“-Knopf
  schreibt — eine ganze Scryfall-Antwort besteht zu neun Zehnteln aus Dingen,
  die keine Kachel ansieht.
* **Der Schnitt-Vorschlag** („dafür könnte X weichen“) wird beim Anzeigen *neu*
  gerechnet. Er gilt fürs jetzige Deck, nicht für das von damals; vom Modell
  kommt nur der Name der Karte, die es ersetzen wollte.

Ein Lauf zu einer **einzelnen Karte** wird nicht aufgehoben — er hängt an keinem
Deck. Und geteilte Decks zeigen ihre Karten, nicht die Überlegungen, die noch
nicht darin stehen: für `deck_synergies` gibt es keine Freigabe an Freunde.

> Fehlt der Datenbank die Tabelle `deck_synergies`, laufen die Vorschläge wie
> bisher, nur ohne Gedächtnis — `supabase-schema.sql` erneut im SQL Editor
> ausführen (oder `supabase/migrations/20260802120000_deck_synergien.sql`
> einzeln).

## Verlauf je Deck: zurück auf einen älteren Stand

Jedes Deck führt einen **Verlauf**. Der Knopf „↺ Verlauf" in der Werkzeugleiste
klappt ihn auf: eine Zeile je Stand, von jung nach alt, mit Zeitpunkt,
Deckgröße, dem Umbau in Worten — und einem Knopf, der das Deck dorthin
zurücksetzt.

```
02.08.2026, 11:12   Karte 0-4 dazu                                 aktueller Stand
5 Karten
02.08.2026, 10:04   Karte 0-3 dazu · Karte 0-0 heraus · 1× mehr    ↺ Zurückspringen
5 Karten            · 1 umsortiert · umbenannt in „Deck 0 v2"
30.07.2026, 19:41   Ausgangsstand                                  ↺ Zurückspringen
4 Karten
```

**Nicht rückwirkend.** Der erste Stand entsteht beim ersten Laden nach der
Einführung. Was davor am Deck geschah, ist nicht rekonstruierbar — und wird
auch nicht behauptet: Der älteste Eintrag heißt „Ausgangsstand", nicht „Deck
angelegt".

Der Kasten sitzt **über der Kartenliste**, gleich unter der Werkzeugleiste und
neben der Statistik. Unter der Liste — wo die übrigen Kästen stehen — lag er bei
einem großen Deck rund zweitausend Pixel tiefer, und ein Klick auf „Verlauf" sah
aus, als geschähe nichts. Im schmalen Fenster reicht das allein nicht: Dort
bricht die Werkzeugleiste um, der Kasten liegt gemessen bei 879 px hinter dem
unteren Rand eines 720 px hohen Fensters — der Klick holt ihn deshalb zusätzlich
heran.

### Stände, keine Ereignisse

Gespeichert wird der **fertige Stand** eines Decks (Kopf, Fächer, Karten mit
Menge und Einordnung), nicht die Änderung. Der Unterschied ist keine Feinheit:

Ein Ereignisstrom („Karte X ergänzt", „Kategorie umbenannt") müsste an jeder der
rund zwanzig Schreibstellen der App mitgeschrieben werden. Eine davon zu
vergessen fiele **nicht auf** — der Verlauf wäre still unvollständig, und ein
Rücksprung landete auf einem Stand, den es nie gab. Geschrieben wird deshalb an
genau einer Stelle: nach dem Laden der Decks, wenn sich der **Fingerabdruck**
des Standes geändert hat. Was sich geändert *hat*, folgt aus dem Vergleich
zweier Stände — es muss sich niemand merken.

> Der Fingerabdruck rechnet über den sortierten Stand. Ohne Sortierung entstünde
> ein neuer Eintrag, sobald die Datenbank die Zeilen einmal anders zurückgibt —
> der Verlauf liefe voll mit Ständen, in denen sich nichts geändert hat.

**Fächer stehen über ihren Namen darin**, nicht über ihre `id`. Ein Fach kann
zwischendurch gelöscht und gleichnamig neu angelegt worden sein; über die `id`
zeigte der Rücksprung dann ins Leere. Fehlt das Fach ganz, legt der Rücksprung
es wieder an.

### Was ein Rücksprung tut

Deckkopf zurücksetzen, fehlende Fächer anlegen, alle Karten ersetzen, die
Einordnungen wiederherstellen (samt der primären). Zwei Dinge sind dabei
bewusst:

* **Karten, die es nicht mehr gibt, kommen nicht zurück.** Der Fremdschlüssel
  zeigt in die Sammlung, und aus der ist die Zeile verschwunden. Die Rückfrage
  vor dem Sprung sagt, wie viele fehlen werden — stillschweigend ein kleineres
  Deck herzustellen wäre schlimmer als die Ansage. Dasselbe gilt für einen
  Commander, den es nicht mehr gibt: Das Deck verliert sein Aushängeschild,
  nicht seinen Stand.
* **Ein Rücksprung ist selbst eine Änderung** und bekommt seinen eigenen
  Eintrag. Man kann ihn also zurücknehmen wie alles andere.

Die Rechnung dahinter (`ruecksprungPlan`) steht getrennt vom Schreiben: Dort
steckt alles, was man falsch machen kann, und genau das lässt sich ohne
Datenbank prüfen.

**Vierzig Stände je Deck**, danach fällt der älteste weg (Trigger
`deck_history_kuerzen`). Der Verlauf ist ein Gedächtnis, kein Archiv; ein Deck
mit hundert Karten wiegt als JSON rund sechs Kilobyte.

Geteilte Decks zeigen ihren **aktuellen** Stand, nicht die Umwege dorthin — für
`deck_history` gibt es bewusst keine Freigabe an Freunde.

> Fehlt der Datenbank die Tabelle `deck_history`, bleibt der Knopf ohne Inhalt
> und alles andere läuft wie zuvor — `supabase-schema.sql` erneut im SQL Editor
> ausführen (oder `supabase/migrations/20260802090000_deck_verlauf.sql`
> einzeln).

## Live-Spielrunde: die eigenen Karten am Tisch

In der Spielrunde wählt jeder sein Deck; darunter steht der **private
Kartenüberblick** — nur der Spieler selbst sieht ihn, Mitspieler sehen lediglich
den Decknamen und den Commander.

Eine Karte liegt immer in genau **einer Zone**, und die Zonen stehen
untereinander wie am Tisch: das Feld weit vorn, die Hand direkt vor einem, die
Bibliothek zuunterst.

| | Zone | Inhalt |
| --- | --- | --- |
| ★ | Kommandozone | der Commander, solange er nicht im Spiel ist (nur bei Commander-Decks) |
| ⚔️ | Schlachtfeld | alles, was ausgespielt auf dem Tisch liegt — mit getappt/ungetappt und +1/+1-Marken |
| ⚰️ | Friedhof | Gestorbenes, Abgehandeltes, Abgeworfenes; auf der Matte eine Lade (siehe unten) |
| 🚫 | Exil | ins Exil geschickte Karten; auf der Matte eine Lade |
| ✋ | Hand | aufgefächert, jedes Exemplar eine eigene Karte; auf der Matte eine Lade |
| 📚 | Bibliothek | was noch im Deck steckt |

Die **Länder** stehen dabei getrennt vom übrigen Schlachtfeld — in der Matte als
eigener Streifen, im Akkordeon unter einer eigenen Überschrift. Eine Zone bleibt
es trotzdem: eine Karte wandert nicht „aufs Land", sondern aufs Schlachtfeld,
und ob sie ein Land ist, weiß die App aus der Typzeile.

### Zwei Anordnungen

Ab **820 px Breite** liegen die Felder wie auf der offiziellen Spielmatte:
Schlachtfeld groß links, Länder als Streifen darunter, die Lebenspunkte als
Reihe unter beiden, und rechts eine schmale Spalte (Commander-Steuer,
Kommandozone, Bibliothek). Ein quer gehaltenes Handy erreicht diese Breite und
bekommt die Matte automatisch. Ab **1200 px** kommt rechts eine dritte Spalte
über die volle Höhe dazu: die Kartenansicht (siehe unten).

**Die Lebenspunkte laufen unter den Ländern über deren volle Breite**, bis zu
vier Kacheln nebeneinander — so wie die Mitspieler am Tisch nebeneinander
sitzen. Vorher standen sie als schmale Spalte ganz rechts, eine Kachel über der
anderen, und rollten bei vier Mitspielern innen. Die Reihe hat eine feste Höhe,
weil die Emblemleiste darüber daraus rechnet; die vier Knöpfe (−5/−1/+1/+5)
stehen deshalb unter Name und Zahl statt daneben. Nebeneinander rangen sie mit
dem Namen um dieselbe Breite, und der verlor: Bei vier Mitspielern auf einer
820-px-Matte blieben für ihn gemessen **null Pixel**.

**Vier Embleme** stehen als Leiste am rechten unteren Rand des Schlachtfelds,
gleich über den Lebenspunkten: von links nach rechts `assets/roll-the-dice.PNG`,
`assets/cards-on-hand.PNG`, `assets/cards-at-exil.PNG` und
`assets/cards-on-graveyard.PNG`. Jedes trägt unten rechts eine Zahl — bei den
drei Zonen die Kartenzahl, beim Würfel den letzten Wurf.

**Hand, Friedhof und Exil sind Laden.** Ein Klick klappt nach oben aus, Escape
oder ein zweiter Klick wieder zu. Nach oben, weil am Tisch alle drei vor einem
liegen — zur Seite auszufahren löste dieses Bild auf. Der **Würfel** ist keine:
Ein Klick würfelt sofort (siehe „Der Würfel").

Die Abstände der Leiste rechnen aus den Spaltenbreiten und der Höhe der
Lebensreihe, damit sie mitgehen, wenn sich eine davon ändert.

**Immer nur eine offen.** Die Schaltflächen stehen nebeneinander, ihre Körbe
sind breiter als sie selbst — offen lägen sie übereinander. Dieselbe Regel wie
im Akkordeon, aus demselben Grund.

**Rahmen bei Friedhof und Exil.** Ihre Gitter sind lose Reihen kleiner Bilder
und bräuchten sonst eine Fläche, um nicht über dem Schlachtfeld zu schwimmen.
Der Handfächer trägt seine Form selbst: Seine Karten liegen gestaffelt und
werfen Schatten — ein Kasten darum wäre ein Rahmen um etwas, das schon eine
Gestalt hat.

**Der Handfächer geht mittig über dem Schlachtfeld auf**, dicht über den
Lebenspunkten — nicht rechts oben über seiner Schaltfläche, wo er die halbe
Matte verdeckte. Er **rollt nicht**: Ein Rollbereich schnitte die gedrehten
Ränder ab und die beim Zeigen angehobene Karte gleich mit. Nötig ist er auch
nicht, denn der Fächer wird bei vielen Karten von selbst schmaler — der sichtbare
Anteil je Karte schrumpft mit ihrer Zahl, gemessen in Kartenbreiten statt in
Pixeln, damit er auf schmalen Schirmen mitschrumpft.

**Der Würfel rollt über die ganze Matte** — er ist keine Zone und trägt deshalb
kein Ablageziel. Seine Fläche liegt *unter* den drei anderen Emblemen: Man
würfelt oft, während eine Lade offen steht, und die gehört dann davor.

Das Emblem trägt die Schaltfläche jeweils allein: kein Kasten darum, kein
Beiwort daneben; lesbar über hellen wie dunklen Kartenbildern bleibt es durch
den Schlagschatten. Lädt ein Bild nicht, tritt sein Schriftzeichen an die
Stelle — dieselbe Regel wie am Zugabe-Knopf und an der Truhe. Weil der sichtbare
Text entfällt, nennt die Beschriftung für Vorleseprogramme Zone und Anzahl mit.

> **Warum sie nicht mehr in der Reihe stehen.** Der Handfächer ist gut 230 px
> hoch und kostete diese Höhe *dauernd*, obwohl man ihn nur ansieht, wenn man
> etwas daraus spielen will; Friedhof und Exil wachsen über die Partie, werden
> aber fast nur nachgeschlagen — das Exil bleibt in den meisten Partien sogar
> leer. Den Platz bekommt das Schlachtfeld, das man ständig ansieht.
>
> Zieht man eine Karte heraus, **geht die Lade zu** — sie schwebt über der
> Matte und läge sonst über genau den Zonen, auf die man zielt. Gesehen hat man
> die Karte trotzdem: sie hängt am Zeiger. Dieselbe Überlegung wie bei der
> Trefferliste im Deckbau.
>
> Die Schaltflächen sind auch **zugeklappt Ablageziele**. Etwas auf die Hand
> zurückzunehmen oder auf Friedhof und Exil zu legen, ohne vorher aufzuklappen,
> ist der häufigere Weg. Ziel ist dabei nur die Schaltfläche selbst: Die Klammer
> der Hand deckt die ganze Matte, damit ihr Fächer mittig aufgehen kann, und
> jeder Punkt des Schlachtfelds wäre sonst ein Handziel.

Die Spielrunde darf dabei **breiter werden als der Rest der App** (1800 statt
1100 px): die Mattenspalten sind fest, alles Zusätzliche geht ans Schlachtfeld
und an die Länder. Auf einem 3440-px-Monitor wächst das Schlachtfeld damit von
628 auf 1328 px.

Darunter — also auf einem hochkant gehaltenen Handy — steht dasselbe als
**Akkordeon**: eine Zone auf einmal. Das ist keine Bequemlichkeit, sondern
Notwendigkeit: von den schmalen Mattenspalten blieben bei 390 px rund 50 px
übrig, eine Kartenminiatur ist 62 px breit. Beide Anordnungen zeigen dieselben
Zonen, dieselben Ziele beim Ziehen, denselben Zustand.

> Drehen kann die App das Gerät nicht selbst — `screen.orientation.lock()` gibt
> es nur im Vollbild und nur auf Android, iOS Safari kennt es gar nicht. Im
> Hochformat steht deshalb nur ein Hinweis, kein Knopf, der auf dem iPhone still
> nichts täte.

**Aufgeklappt ist im Akkordeon immer genau eine Zone** — die, über der die Maus steht; auf
dem Handy die zuletzt angetippte. So bleibt die Ansicht kurz, statt sechs Listen
untereinander zu stapeln. Die zugeklappten Kopfzeilen zeigen Anzahl und ein paar
Miniaturen, damit man auch ohne Aufklappen sieht, was drinliegt.

**Karten verschieben: ziehen.** Mit der Maus fasst du eine Karte an und lässt
sie über der Zielzone los — dieselbe Geste, mit der im Deckbau eine Karte in
eine Kategorie wandert. Beim Anheben zeichnen sich die erlaubten Zonen vor, die
unter dem Zeiger leuchtet auf, Escape bricht ab. Wohin eine Karte darf, ist
dabei dieselbe Regel wie eh und je: die Bibliothek nur für normale Karten, die
Kommandozone nur für Commander.

Ziehst du im Spiel eine Karte, suchst du sie unten in der Bibliothek und ziehst
sie auf die **Hand**; von dort aufs **Schlachtfeld**, später in den
**Friedhof**. Jeder Weg lässt sich auch rückwärts gehen.

> **Warum nicht mehr über Knöpfe.** Bis dahin trug jede Karte auf dem
> Schlachtfeld vier davon — Friedhof, Exil, Hand, Bibliothek, bei einem
> Commander fünf. Bei 62 px Kartenbreite war das eine Knopfleiste, breiter als
> die Karte, die sie bedient, und man musste ihre Zeichen auseinanderhalten,
> bevor man traf. Eine Zone dagegen ist ein großes Feld mit Namen und Zeichen
> in der Kopfzeile: Man zieht dorthin, wo man ohnehin hinsieht.

**Mit dem Finger** geht es weiter über Knöpfe: Antippen hält die Kartenansicht
fest, und dort stehen sie alle — je erlaubter Zone ein Zielknopf mit dem Zeichen
aus der Tabelle oben, dazu ↻ und die Marken. Zug und Tappklick sind bewusst der
Maus vorbehalten, denn ein Kartengitter muss unter dem Finger rollen können; das
ginge nur, wenn man jeder Karte das Rollen abgewöhnte. Ohne diesen Weg gäbe es
auf einem Tablet überhaupt keinen mehr, eine Karte vom Schlachtfeld
herunterzubekommen.

**Auf dem Schlachtfeld** kann eine Karte mehr als nur daliegen. **Ein Klick
tappt sie** — das Bild dreht sich um 90° wie am Tisch —, ein zweiter richtet sie
wieder auf. Auch dafür gibt es keinen Knopf mehr: Am Tisch dreht man die Karte
selbst, nicht eine Schaltfläche daneben. ＋ und − legen +1/+1-Marken drauf und
wieder herunter; die bleiben Knöpfe, weil es für sie keine Geste gibt. Oben in
der Zone richtet **alle enttappen** in einem Klick den ganzen Tisch wieder auf.

> Ein Klick, der aus einem *Zug* entstand, tappt nichts — sonst drehte sich jede
> Karte, die man nur verschieben wollte.

Gleiche Exemplare fassen sich zu einem Stapel zusammen: fünf ungetappte Wälder
sind ein Bild mit `×5`. Tappst du einen, spaltet sich `×4` und `×1 getappt` ab.
Das ist kein Schönheitsdetail, sondern nötig — von zwei gleichen Kreaturen kann
eine getappt sein und die andere zwei Marken tragen, und stirbt die markierte,
darf sie ihre Marken nicht der Zwillingsschwester dalassen.

**Bibliothek: suchen statt scrollen.** Am Tisch ziehst du physisch und musst der
App nur sagen, *welche* Karte es war — dafür steht dort ein Suchfeld statt einer
Dauerliste. Die ganze Bibliothek ist einen Klick entfernt, wenn du sehen willst,
was noch drin ist.

**🎲 Zufällig ziehen** nimmt gleich darunter eine zufällige Karte aus der
Bibliothek auf die Hand — für Probehände, Testläufe und Runden ohne Karten auf
dem Tisch, wo niemand da ist, der mischt. Ist die Bibliothek leer, ist der Knopf
gesperrt.

> **Gezogen wird über Exemplare, nicht über Zeilen.** Vier Wälder sind vier
> Chancen, nicht eine. Über die Zeilen gezogen käme aus einem Deck mit 38
> Ländern und 62 Einzelkarten fast nie ein Land — das wäre keine Bibliothek
> mehr, sondern eine Namensliste.

Eine Zeile trägt dabei **nur Kartenname und Anzahl**. Alles Weitere steht in der
**Kartenansicht für den Spielmodus**: Zeigen blendet sie ein, Klicken hält sie
fest. Erst dann wird sie bedienbar und trägt die Zielknöpfe.

Dieselbe Ansicht hat **jede** Karte in jeder Zone, auf Zeigen wie auf Klick.
Zonenkacheln sind in den schmalen Mattenspalten nur 48 px breit — ohne Vorschau
erkennt man dort nicht, welche Karte man vor sich hat, und müsste sich
durchklicken. Zum *Verschieben* ohne Maus ist sie der Weg: dort stehen die Zielknöpfe. Auf
dem Schlachtfeld und bei den Ländern bleibt zusätzlich die schnelle Leiste am
Kartenbild, aber nur noch mit ↻ und den Marken — Tappen und Marken sind die
häufigsten Handgriffe im Spiel, und für sie gibt es keinen Zug.

**Wo die Ansicht erscheint**, hängt vom Platz ab. Ab **1200 px** hat die Matte
ganz rechts eine eigene Spalte dafür („Karte"): Was du anzeigst, erscheint immer
an **derselben** Stelle, statt als Fenster über dem Spielfeld — der Tisch bleibt
frei, und der Blick muss die Karte nicht suchen. Beim Mausaustritt bleibt die
zuletzt gezeigte Karte stehen (nur die Zielknöpfe verschwinden), sonst flackerte
die Fläche im Spiel dauernd — beim Ziehen zeigt sie damit gerade die Karte, die
am Zeiger hängt. Darunter — und im Akkordeon — schwebt sie wie bisher
am Zeiger; auf einem Handy gibt es für eine feste Spalte keinen Platz. Dort
blendet sie sich außerdem erst nach kurzem Verweilen ein, damit nicht bei jedem
Überstreichen ein Fenster aufpoppt.

Unter dem Bild steht bewusst **nicht** der Regeltext: der steht bereits auf der
Karte. Auch nicht das Set — beim Spielen ist egal, aus welcher Auflage die Karte
kommt. Was bleibt, ist das, was auf dem Bild klein oder gar nicht zu lesen ist:
Manakosten, fremdsprachiger Name und Typzeile. Das ist bewusst nicht die
Detailkarte aus der Sammlung: Preis, Preisverlauf, Zustand und
Deckzugehörigkeit sind am Tisch ohne Belang und stünden nur im Weg. Und eine
Bibliothek hat schnell 90 Zeilen — jede mit Bild, Set und vier Knöpfen zu
bestücken machte sie in der schmalen Mattenspalte unlesbar.

**Commander-Steuer.** Wanderst du deinen Commander aus der Kommandozone aufs
Feld, zählt die App das Wirken mit und zeigt am Kartenbild, was das nächste Mal
extra kostet (`+2`, `+4`, …). Verzählt? Das Abzeichen selbst nimmt ein Wirken
zurück.

**Gespeichert** werden nur vier Zahlen je Karte (`session_played.hand`, `.field`,
`.graveyard`, `.exile`). Bibliothek und Kommandozone sind der **Rest** aus der
Deckmenge und werden bei jeder Anzeige neu gerechnet — so kann kein Exemplar
doppelt existieren. `cast_count` zählt daneben die Commander-Steuer.

Nur das Schlachtfeld braucht mehr als eine Zahl, denn dort unterscheiden sich
gleiche Karten voneinander. `field_state` hält deshalb eine Liste je Exemplar —
`[{"t":1,"c":0},{"t":0,"c":2}]` heißt „eine getappt, eine mit +2/+2" — und ist
genau so lang wie `field`. Solange alles ungetappt und ohne Marken ist, bleibt
sie leer; der Regelfall kostet also nichts.

Der Stand überlebt einen Neuladen der Seite; „Neues Spiel" des Gastgebers räumt
ihn bei allen ab.

Die Einladeliste ist Zubehör und steht eingeklappt am Ende.

### Der Würfel

**Nur noch der W20.** W4, W6, W8, W10, W12 und das Eingabefeld für eine freie
Seitenzahl sind weg. Gewürfelt wird in einer Partie um Anspiel, als Münzwurf-
Ersatz und für die Effekte, die einen Zwanzigseiter verlangen; die übrigen
Größen standen als Knopfreihe da und wurden nie angefasst.

**Ein Klick auf das Emblem würfelt** — es gibt keine Bühne, die erst aufgehen
müsste. Der W20 rollt **direkt über die Matte**, ohne Rahmen und ohne Grund;
wer geworfen hat und was, steht für den Moment links neben der Emblemleiste.
Vorher lag der Würfel in einem einklappbaren Kasten *unter* der Matte und war
340 × 150 px groß — er rollte durch einen Briefschlitz.

**Die Zahl bleibt, der Würfel geht.** Auf dem Emblem steht immer der letzte Wurf
der Runde (vor dem ersten ein matter Gedankenstrich). Der Würfel selbst rollt,
bleibt gut zwei Sekunden liegen und blendet dann aus — läge er dauerhaft da,
verdeckte er genau die Karten, für die man gewürfelt hat.

Die **Wurfliste der Runde** steht im Tooltip des Emblems. Als Liste auf der
Matte bräuchte sie einen Grund, um lesbar zu sein — und genau der sollte weg.

**Jeder Wurf sieht anders aus.** Das Ergebnis steht vorher fest (ein
`Math.random()`, einmal); die Schau darum wird jedes Mal neu ausgelost —
Eintrittsseite (fünf), Zahl der Sprünge (1–3), Bogenhöhe, Drehachse,
Drehgeschwindigkeit, Dauer des Taumelns, Dauer des Einrastens und der Fleck, auf
dem er liegen bleibt. Vorher lief sie **immer gleich**: von links herein, flacher
Bogen, 800 ms taumeln, 650 ms einrasten; nur die Drehachse war zufällig, und die
sieht man einem taumelnden Körper nicht an.

> Ein *Wurfplan* beschreibt diese Größen, und **eine** Kurve fliegt beide
> Darsteller ab: den echten Ikosaeder aus three.js (per `import()` vom CDN
> nachgeladen, einmal je Sitzung) und den SVG-Rückfall ohne Netz oder WebGL.
> Zwei getrennte Wege liefen auseinander, sobald man einen davon ändert — und
> die Abwechslung ginge am anderen vorbei.

Ein Wurf **zeigt sich selbst**: Der Würfel erscheint auch beim Wurf eines
Mitspielers, und dessen Zahl landet ebenso auf dem Emblem.

Wo es keine Matte gibt — im Akkordeon und in einer Runde ohne gewähltes Deck —
hängt der Würfel fest am Schirm: Knopf unten rechts, und er rollt über den
Schirm statt über die Matte.
Die drei Zonen-Laden gibt es dort nicht (das Akkordeon zeigt ohnehin eine Zone
auf einmal), der Würfel schon: Er ist keine Zone, und ohne ihn gäbe es auf einem
hochkant gehaltenen Handy gar keinen Wurf mehr.

> Meldet die App „Spalte fehlt", ist die Datenbank älter als die App —
> `supabase-schema.sql` erneut im SQL Editor ausführen (oder
> `supabase/migrations/20260725190000_field_state.sql` einzeln). Bis dahin
> läuft die Partie im Browser weiter, wird aber nicht gespeichert.

### Die Matte eines Mitspielers ansehen

Am Tisch sieht man, was vor den anderen liegt. In der App sah man davon nichts —
jeder Zonenstand ist privat, weil in derselben Zeile die **Hand** steht.

Das **Auge am Avatar** einer Spielerkachel klappt die Matte dieses Mitspielers
über die eigene: Schlachtfeld, Länder, Kommandozone, Friedhof, Exil — in
derselben Anordnung wie die eigene, damit man beim Hinübersehen nicht umlernt.
Getappte Karten stehen gedreht, Marken tragen ihr Abzeichen, die
Commander-Steuer steht als Zahl. Ein zweites Auge schaltet um, dasselbe noch
einmal macht zu, Escape ebenfalls.

**Hand und Bibliothek bleiben verdeckt.** Das steht nicht in der Anzeige,
sondern in der Abfrage: `session_board` wählt die Spalte `hand` **gar nicht
erst aus** und überspringt Zeilen, in denen nur sie steht — sonst verriete
deren Anzahl, wie viele verschiedene Karten jemand hält. Die Bibliothek steht
ohnehin in keiner Tabelle: Sie ist der Rest aus der Deckmenge, und die
Deckliste eines anderen gibt die Abfrage nicht heraus.

> **Die Kommandozone ist die eine Ausnahme**, und sie muss es sein: Sie liegt am
> Tisch offen, lässt sich aber aus den vier gespeicherten Zonen nicht ableiten —
> eine Karte, die nirgends liegt, ist entweder in der Bibliothek *oder* in der
> Kommandozone. Für die beiden Commander-Karten kommt deshalb die Deckmenge mit,
> für keine andere. Öffentlich sind sie längst: `session_roster` schickt Name
> und Bild des Commanders seit jeher an alle Mitspieler.

**Nur ansehen.** Keine Zielknöpfe, kein Ziehen, kein Tappen. Die fremde Karte
ist bewusst ein eigener Baustein und nicht der eigene mit abgeschalteten
Handgriffen: Bei einem gemeinsamen Bauteil macht ein vergessener Schalter fremde
Karten verschiebbar, getrennt kann das nicht passieren.

**Die Lade endet über der Lebensreihe.** Nicht Kosmetik — geöffnet wird sie an
den Spielerkacheln, und die stehen in dieser Reihe. Deckte sie sie zu, käme man
von einem Mitspieler nicht zum nächsten, ohne erst zu schließen. (Gemessen: Der
Klick aufs zweite Auge lief in einen Zeitablauf, solange sie darüber lag.)

**Aufgefrischt wird im Takt**, alle vier Sekunden, solange die Lade offen steht.
Über Realtime ginge es nicht: Die Zeilen sind privat, ein Kanal darauf bekäme
für fremde Spieler nichts zu sehen. Der Takt kostet nur, während jemand
hinsieht, und hört mit dem Schließen auf — auch das Intervall selbst wird
abgeräumt, nicht bloß wirkungslos gestellt.

**Auch als Zuschauer.** Wer kein Deck gewählt hat, hat keine Matte — und sah
deshalb auf einem breiten Schirm bisher weder Lebenspunkte noch Mitspieler, weil
die Spielerreihe nur *in* der Matte stand. Ohne Matte steht sie jetzt wieder in
der Runde selbst. Wer bloß zusieht, braucht sie am meisten.

Hochkant, wo statt der Matte das Akkordeon steht, hängt die Lade **fest am
Schirm** — wie der Würfel. Am Akkordeon aufgehängt klappte sie außerhalb des
Blickfelds auf (bei 560 × 860 px erst auf Höhe 576): Man klickt oben auf das
Auge, und „nichts passiert“. Genau diese Meldung gab es hier schon einmal, beim
Deck-Verlauf.

> Kennt die Datenbank `session_board` noch nicht, meldet die Lade das und die
> übrige Runde läuft weiter. `supabase-schema.sql` erneut im SQL Editor
> ausführen (oder `supabase/migrations/20260802160000_fremde_matte.sql`
> einzeln).

## Preisverlauf: Langzeitarchiv aus MTGJSON

Scryfall liefert nur den **Tagespreis** — einen Verlauf gibt es dort nicht. Die
App führt deshalb selbst eine Historie: „Preise aktualisieren" schreibt je Karte
einen Punkt pro Tag. Das beginnt aber erst mit dem Erfassen und wächst nur
langsam.

[MTGJSON](https://mtgjson.com/) bündelt ~90 Tage Preisverlauf (Cardmarket-EUR,
TCGplayer-USD) als Bulk-Daten. Ein **optionaler** Hintergrund-Job lädt daraus
die passenden Reihen in eine geteilte Tabelle; die App legt sie beim Anzeigen
**unter** die eigene Historie — der Graph zeigt dann sofort ~90 Tage, statt bei
null anzufangen. Ohne diese Einrichtung bleibt alles beim Alten: nur die eigenen
Vorwärts-Punkte.

**Neu erfasste Karten.** MTGJSON kennt keinen Abruf für eine einzelne Karte —
den Verlauf einer Karte zu holen heißt, die ~1 GB große Bulkdatei zu streamen.
Deshalb greifen zwei Dinge ineinander:

* Hat die Karte **schon jemand anderes**, liegt ihr Verlauf bereits im geteilten
  Archiv. Die App lädt ihn beim Erfassen sofort nach (`reload()` ruft
  `ladePreisHistorie()`), es ist also gleich alles da.
* Ist die Karte **noch nie erfasst worden**, füllt sie die stündliche
  Lückenprüfung — spätestens eine Stunde später stehen die ~90 Tage da.

Weiter zurück als diese 90 Tage geht es für so eine Karte nicht: MTGJSON
veröffentlicht nur das laufende Fenster, ältere Tage sind dort nicht mehr
abrufbar. Ab dann wächst ihr Verlauf mit jedem Lauf.

**Über die 90 Tage hinaus.** MTGJSON liefert je Abruf nur das laufende
90-Tage-Fenster. Würde der Job es einfach in die Tabelle schreiben, wäre der
gespeicherte Verlauf ebenfalls ein gleitendes Fenster — nach einem Jahr stünde
dort immer noch nur ein Vierteljahr, egal wie oft der Job lief. Stattdessen
**mischt** er sein Fenster in den vorhandenen Bestand (`merge_price_history` in
der Datenbank): je Datum ein Punkt, bei Gleichstand gewinnt der neuere Wert,
Älteres bleibt für immer stehen. Das Archiv wächst also mit jedem Lauf, und nach
zwei Jahren zeigt der Graph zwei Jahre.

Gemischt wird bewusst **in der Datenbank** und nicht im Job: sonst müsste der
Job täglich das gesamte Archiv herunterladen, im Speicher zusammenführen und
vollständig zurückschreiben — eine Datenmenge, die mit jedem Jahr wächst. So
überträgt er immer nur das frische Fenster.

Lückenlos bleibt der Verlauf, solange zwischen zwei Läufen keine 90 Tage
liegen — beim täglichen Zeitplan also mit reichlich Luft. Ein ausgefallener Tag
schadet nichts: der nächste Lauf bringt die verpassten Tage rückwirkend mit.

Gekürzt wird nirgends mehr, auch nicht in der persönlichen Historie: `set_price`
hielt früher nur die letzten 60 Punkte je Karte. Für Karten, die MTGJSON kennt,
trug das geteilte Fundament die alten Tage — für seltene Auflagen ohne
Cardmarket-Reihe war die eigene Historie aber die einzige, und die endete nach
zwei Monaten.

**Der Graph** ist im Zuschnitt von [Cardmarket](https://www.cardmarket.com)
gehalten: Gitterlinien auf runden Eurobeträgen, schräg gestellte Datumsangaben,
ein Punkt je Messwert und beim Überfahren ein heller Kasten, der auf den
nächstgelegenen Punkt einrastet und dessen Datum und Preis zeigt. Die Zeitachse
ist **zeitgetreu** skaliert, nicht nach Laufnummer — bei einer Reihe über Jahre
würden Lücken sonst verschwiegen. Die Kurve ist grün bei gestiegenem und rot bei
gefallenem Kurs; dünn und gestrichelt liegt der **Median** darin, der auf einen
Blick zeigt, ob der heutige Preis über oder unter dem üblichen Niveau liegt.

Warum ein GitHub Action und keine Edge Function: MTGJSONs Preisdatei ist entpackt
~1 GB — zu groß für den Speicher einer Edge Function. Der Runner hat den Platz,
**streamt** die Datei und zieht nur die Karten heraus, die im Bestand stehen. Der
`service_role`-Key liegt dabei als Actions-Secret, **nie** im Browser.

### So funktioniert es

* **Tabelle `price_history`** — je `scryfall_id`, nicht je Nutzer (die Preise
  sind für alle gleich, das spart Dubletten). Angemeldete dürfen nur lesen;
  schreiben darf allein der Job über den `service_role`-Key, der RLS umgeht. Die
  Tabelle kommt mit `supabase-schema.sql`. Die persönliche Historie (`cards.hist`)
  bleibt davon unberührt.
* **`merge_price_history(jsonb)`** — die Funktion, die das neue Fenster über den
  Bestand legt, statt ihn zu ersetzen. Nur für den `service_role` aufrufbar;
  Angemeldeten ist das Ausführungsrecht entzogen.
* **`scripts/price-backfill/`** — Node-Skript: liest die vorhandenen
  `scryfall_id` aus der Datenbank, streamt MTGJSONs `AllIdentifiers` (Zuordnung
  `scryfallId → uuid`) und `AllPrices`, schickt die EUR/USD-Reihen gebündelt an
  `merge_price_history`. Fehlt die Funktion (Schema noch nicht nachgezogen),
  bricht der Lauf ab, **ohne etwas zu schreiben** — lieber kein neuer Punkt als
  ein stillschweigend auf 90 Tage zurückgestutztes Archiv.
* **`.github/workflows/prices.yml`** — drei Zeitpläne, siehe „Welche Datei wann"
  unten. Ein Start von Hand zieht immer voll durch.
* **`cards_missing_price_history()`** — die Vorfrage der Lückenprüfung: welche
  `scryfall_id` aus `cards` hat noch keine Zeile in `price_history`? Ein
  Anti-Join in der Datenbank statt zweier voller Listen über die Leitung.
* **`price_history.mtgjson_uuid`** — die MTGJSON-uuid der Karte, die ein voller
  Lauf ohnehin ermittelt. Nur deshalb kommt der Tageslauf ohne `AllIdentifiers`
  aus.

### Welche Datei wann

MTGJSON kennt **keinen** Abruf für eine einzelne Karte, und auch die Set- und
Deck-Dateien enthalten keine Preise (nachgeprüft: dort steht `purchaseUrls`, also
Shop-Links, aber kein `prices`). Es gibt nur Bulkdateien — und die sind
unterschiedlich teuer:

| Datei | Größe (gz) | Inhalt |
|---|---|---|
| `AllIdentifiers.json.gz` | 215 MB | `scryfallId` → `uuid` |
| `AllPrices.json.gz` | 143 MB | 90 Tage Verlauf |
| `AllPricesToday.json.gz` | 5,2 MB | nur der Tagespreis, **gleicher Aufbau** |

Daraus drei Betriebsarten, jede so sparsam wie ihre Aufgabe es zulässt:

| Wann | Modus | Lädt | Wozu |
|---|---|---|---|
| stündlich (außer 15:00) | `--only-gaps` | nichts, außer es fehlt etwas | neu erfasste Karten binnen einer Stunde |
| Mo–Sa 15:00 UTC | `--today` | 5,2 MB | einen Punkt je Karte anhängen |
| So 15:00 UTC | voll | 358 MB | Korrekturen einsammeln, ausgefallene Tage heilen, `uuid` nachtragen |

Der wöchentliche Vollauf ist kein Beiwerk: `AllPricesToday` kennt immer nur
*sein* Datum. Fällt ein Tageslauf aus, wären diese Tage sonst dauerhaft weg —
der Vollauf holt sie aus dem 90-Tage-Fenster zurück. Ebenso Korrekturen, die
MTGJSON nachträglich an zurückliegenden Tagen vornimmt.

**Fremdsprachige Auflagen laufen über die englische.** MTGJSONs
`identifiers.scryfallId` zeigt auf die **englische** Auflage; eine deutsche Karte
trägt eine eigene Scryfall-ID, die in `AllIdentifiers` nie vorkommt. Direkt
gesucht bekäme sie also niemals einen Verlauf.

Denselben Umweg geht die App beim **Tagespreis** längst (`withPrice` in
`app.js`): Scryfall führt für fremdsprachige Auflagen gar keine Preise — alle
Felder sind `null` —, der Preis hängt an der englischen Auflage desselben Sets
und derselben Sammlernummer. Nachgeprüft an „Jeska's Will" (SOA 44):

| Auflage | `prices.eur` | `cardmarket_id` |
|---|---|---|
| deutsch | `null` | `null` |
| englisch | 30,99 € | 883092 |

Der Job tut daher jetzt dasselbe für den **Verlauf**: für jede fremdsprachige
Karte schlägt er über `set` + `cn` die englische Auflage bei Scryfall nach und
sucht **deren** ID in MTGJSON — die Reihe landet aber unter der eigenen,
fremdsprachigen `scryfall_id`. Liste und Graph haben damit dieselbe Quelle.

Der Wert ist also bewusst der Preis der englischen Auflage; deutsche Karten
handeln auf Cardmarket oft etwas günstiger. Eine Näherung — aber dieselbe, die
schon in der Preisspalte steht.

Die Auflösung ist **Einmalarbeit je Karte**: die gefundene `mtgjson_uuid` landet
in `price_history`, und wer sie hat, braucht danach weder Scryfall noch
`AllIdentifiers`. Steht für alle Karten eine uuid, lädt selbst der Vollauf die
215-MB-Datei nicht mehr.

Bleibt eine Karte unauflösbar (Scryfall kennt die Kombination nicht), bekommt sie
eine **leere Zeile** als Vermerk. Ohne den gälte sie für immer als Lücke, die
stündliche Prüfung stiege nie früh aus und zöge jede Stunde die 358 MB. Der
Vermerk ist verlustfrei: `merge_price_map` läuft über die Schlüssel der neuen
Seite, und `{}` hat keine — ein vorhandener Verlauf bleibt unangetastet.

Vorerst zeigt die App nur den **EUR**-Verlauf; die USD-Reihe wird schon
mitgespeichert und lässt sich später ohne erneuten Import sichtbar machen.

### Einrichten (optional)

1. **Schema aktualisieren:** `supabase-schema.sql` erneut komplett ausführen
   (legt `price_history` samt RLS, `merge_price_history` und
   `cards_missing_price_history` an; wiederholbar, Daten bleiben erhalten). Wer
   nur nachziehen will, spielt die drei Migrationen einzeln ein:
   `20260726120000_price_history_langzeit.sql`,
   `20260726140000_price_history_luecken.sql` und
   `20260726160000_price_history_uuid.sql` (aus `supabase/migrations/`).
2. **Secrets im GitHub-Repo** (Settings → Secrets and variables → Actions):
   * `SUPABASE_URL` — z. B. `https://<projekt>.supabase.co`.
   * `SUPABASE_SERVICE_ROLE_KEY` — aus **Project Settings → API**. Er umgeht RLS
     und gehört ausschließlich hierher, nie in die App.
3. **Auslösen:** im Repo unter **Actions → „Preisarchiv (MTGJSON)" → Run
   workflow** einmal von Hand starten; danach läuft er täglich. Beim nächsten
   Öffnen der Sammlung sind die Graphen gefüllt.

**Bündelgröße beim Schreiben.** Der Job schickt 50 Zeilen je Aufruf an
`merge_price_history`, nicht mehr. Das Mischen ist kein einfacher Upsert: je
Zeile läuft `merge_price_map` durch bis zu vier Reihen à ~90 Punkte, jede mit
`jsonb_agg` und einer Fensterfunktion. Mit 500 Zeilen lief das in Supabases
`statement_timeout` (Fehler `57014`) und riss den ganzen Lauf mit. Läuft ein
Stapel trotzdem in die Zeitüberschreitung, halbiert der Job ihn und versucht es
erneut — das ist gefahrlos wiederholbar, weil das Mischen additiv ist.

Lokal prüfen: in `scripts/price-backfill/` einmal `npm ci`, dann
`node backfill.mjs --self-test` (nur die Umform-Logik, ohne Netz) oder — mit
gesetzten `SUPABASE_*`-Variablen — `node backfill.mjs --dry-run` (lädt und
rechnet, schreibt aber nichts). `node backfill.mjs --only-gaps` fährt den
stündlichen Modus von Hand: er meldet, wie viele Karten ohne Verlauf dastehen,
und endet sofort, wenn es keine gibt. `node backfill.mjs --today` fährt den
Tagesmodus — praktisch zum Ausprobieren, weil er nur 5 MB lädt.

## Prüfungen

```bash
cd tests
npm ci
npm test                 # alles
npm test -- ziehen css   # nur Fälle, deren Name das enthält
```

Läuft bei jedem Pull Request (`.github/workflows/pruefungen.yml`).

### Warum es sie gibt

In dieser App scheitert das meiste **still**. Ein ungültiger CSS-Kurzschreiber
wirft die ganze Anweisung weg. Eine Regel mit zwei Klassen verliert gegen eine
mit vier, unabhängig von der Reihenfolge im Stylesheet. Eine Höhe, die eine
Bildaufbauphase zu früh gemessen wird, bleibt für den Rest der Sitzung falsch.
Ein Übersetzungsschlüssel, den nur Deutsch kennt, zeigt in vier Sprachen seinen
eigenen Namen. Nichts davon wird rot; es sieht nur falsch aus, und auffallen
tut es dem, der die App benutzt.

Jede Datei in `tests/faelle/` trägt deshalb im Kopf die Panne, aus der sie
entstanden ist — nicht als Anekdote, sondern damit beim nächsten Umbau
nachlesbar ist, warum dort etwas so und nicht anders gemessen wird.

| Fall             | Worauf er aufpasst                                           |
|------------------|--------------------------------------------------------------|
| `css-gueltig`    | Jede Anweisung aus `style.css` einem echten `CSSStyleDeclaration` angeboten: Was dort nicht ankommt, hat der Browser verworfen |
| `i18n`           | Fünf Sprachen ohne Lücken, jeder `t()`-Aufruf und jedes `data-i18n` hat einen Schlüssel |
| `ziehen`         | Karten zwischen Kategorien ziehen: Fächer, Schild, Ziel, fremde Decks, Klick, Escape |
| `kartenansicht`  | Klebende Spaltenköpfe (auch im schmalen Fenster), Aufklappen beim Überfahren, kein Aufklappen beim Ziehen |
| `zugabe`         | „Karte zum Deck“: Ausklappen, gefilterte Trefferliste, Zug in eine Kategorie, volles Deck |
| `decks`          | Höchstens ein Deck aufgeklappt, Speicher und Baum stimmen überein, Truhe wirft die richtige Karte |
| `sammlung`       | „Verbaute ausblenden": erst wenn ALLE Exemplare in Decks liegen, über alle Decks zusammen gezählt, je Druck statt je Zeile |
| `verlauf`        | Deck-Verlauf: Fingerabdruck unabhängig von der Reihenfolge, der Umbau in Worten, und was ein Rücksprung schreiben würde (fehlende Karten, fehlende Fächer, primäre Einordnung) |
| `wunschliste`    | Karte direkt vormerken: die Zeile (Bestand 0, Setcode groß, Preis mit erstem Punkt) und die Doppelprüfung — auch gegen eine andere Auflage derselben Karte |
| `synergien`      | Aufgehobene Vorschläge: die eingedampfte Karte, der Fingerabdruck als Warnung vor Überholtem, und dass ein frisches Ergebnis nicht überschrieben wird |
| `spielrunde`     | Die Matte: Ziehen zwischen den Zonen, Tappen per Klick, die Lebensreihe (vier Kacheln nebeneinander, kein Rollbalken), die drei Laden (Ort, Rahmen, Zahl, immer nur eine offen, auch zugeklappt Ablageziel), der Würfel (nur W20, blanke Fläche über der ganzen Matte, Zahl aufs Emblem, jeder Wurf anders) und „Zufällig ziehen" (gewichtet über Exemplare, leere Bibliothek) |
| `fremdmatte`     | Die Matte eines Mitspielers: dass die Abfrage die Spalte `hand` nicht führt und Zeilen ohne offene Zone überspringt, dass die Anzeige ein doch geliefertes `hand` gar nicht erst übernimmt, dass fremde Karten keine Handgriffe tragen, dass die Lebensreihe frei und anklickbar bleibt und dass der Takt nach dem Schließen samt Intervall verschwindet; dazu, dass die Lade hochkant im Blickfeld statt weit unten aufklappt und dass ein Zuschauer ohne eigenes Deck die Mitspieler samt Auge überhaupt sieht |

### Zwei Regeln, die dabei gelernt wurden

**Eine grüne Prüfung ist erst dann etwas wert, wenn sie auch rot werden kann.**
Der erste Anlauf beim Aufklappen las das erste `.stapel-gross` im Dokument —
über dem gar kein Zeiger war — und meldete zufrieden „none“: richtig aus dem
falschen Grund. Geprüft wird deshalb immer **beides**, der Zustand und sein
Gegenteil. Und wer einen Punkt hinzufügt, sollte ihn einmal absichtlich
kaputtmachen und zusehen, ob er das merkt.

**Nicht auf Nummern zielen, sondern suchen.** Die Spalten sind nach Namen
sortiert: „Karte 0-11“ steht dort weit vor „Karte 0-8“. Wer eine bestimmte
`data-id` anfasst, drückt womöglich weit außerhalb des Fensters. `GREIFBAR`
und `PUNKT` in `tests/hilfen.mjs` suchen deshalb eine Stelle, an der
`elementFromPoint` auch wirklich landet — sonst prüft man gegen den klebenden
Kopf oder den Balken am unteren Rand statt gegen das gemeinte Element.

Es gibt keine Datenbank dabei: `AUFBAU` in `tests/hilfen.mjs` setzt `CARDS` und
`DECKS` selbst und zeichnet dann. Die Kartenbilder sind maßstabsgetreue SVGs
(63:88, Namensbalken zwischen 4 % und 10 % der Höhe) — dieselbe Geometrie, mit
der die Kartenansicht rechnet.

Als Browser dient Chrome/Chromium in dieser Reihenfolge: `CHROMIUM_PFAD`,
`PLAYWRIGHT_BROWSERS_PATH`, System-Chrome. Auf den GitHub-Läufern ist Chrome
vorinstalliert; `playwright install` braucht es dadurch nicht.

Abhängigkeiten sind zwei: `playwright-core` — der Treiber ohne Browser — und
`three` in genau der Fassung, die die App vom CDN lädt. Der Fall `spielrunde`
leitet die CDN-Anfrage auf `node_modules` um; ohne das liefe auf einem
Prüfrechner ohne Netz immer der SVG-Rückfall, und der echte 3D-Würfel, den fast
alle sehen, bliebe ungeprüft.

## Hinweise

* Die App braucht Internet — für Scryfall, die Sprachdaten der Texterkennung
  und die Datenbank. Es gibt keinen Offline-Betrieb.
* Fremdsprachige Karten: Scryfalls `/cards/named` und `/cards/autocomplete`
  kennen nur englische Namen. Für andere Sprachen sucht die App deshalb über
  `/cards/search` mit `include_multilingual`. Tokens gibt es bei Scryfall
  ausschließlich auf Englisch — ein deutscher Token ist dort nicht zu finden.
* Bei mehreren Auflagen derselben Karte nimmt der Namensweg die neueste. Ist es
  eine andere, führt „Falsche Karte?“ zur Auswahl — oder gleich der Weg über
  Setcode und Nummer, der die Auflage exakt trifft.
* Deutsche Auflagen haben bei Scryfall häufig keinen eigenen Preis und keine
  `cardmarket_id`. Beides wird dann von der englischen Auflage geholt. Das ist
  keine Schätzung: Cardmarket führt pro Auflage nur **ein** Produkt, die
  Sprache filtert dort lediglich einzelne Angebote.
* Preise stammen von Scryfall und sind Marktbeobachtungen, keine Verkaufspreise.
* Die Oberfläche setzt [Fira Sans Condensed] der Mozilla Foundation und
  Telefónica (SIL Open Font License 1.1, in `assets/fira/` mit Lizenz daneben).
  Sie ist schmal, und das kommt den Tabellen zugute: In einer Kartenzeile stehen
  Name, Set, Sprache, Zustand, Menge und Preis nebeneinander.
* Set- und Mana-Symbole zeichnen die Icon-Fonts [Keyrune] und [Mana] von Andrew
  Gioia (in `assets/`, mit Lizenzen daneben). Set-Symbole gibt es nur zu Codes,
  die Keyrune kennt — sonst bleibt es beim reinen Setnamen, wie bei den Flaggen
  kein geratenes Symbol. Die Symbole selbst sind Marken von Wizards of the Coast.

[Fira Sans Condensed]: https://mozilla.github.io/Fira/
[Keyrune]: https://keyrune.andrewgioia.com/
[Mana]: https://mana.andrewgioia.com/

### Warum Scryfall und nicht Cardmarket

Weil beides dasselbe ist: Scryfalls `eur`-Preise **sind** Cardmarket-Preise.
Jede Karte trägt eine `cardmarket_id`; gegengeprüft am Ooze-Token aus MKM —
Scryfall meldet 0,30 €, Cardmarket zeigt als Preis-Trend 0,30 €.

Die Cardmarket-API selbst kommt nicht in Frage:

* Cardmarket nimmt derzeit **keine Anträge auf API-Zugang** mehr an; die alte
  Doku antwortet mit `410 Gone`.
* Sie verlangt OAuth-1.0a-Signaturen mit einem geheimen Schlüssel. In einer
  reinen Browser-App auf GitHub Pages wäre der öffentlich — es bräuchte einen
  Server dazwischen.
* Kein CORS; Auslesen der Webseite verbietet Cardmarket.
* Für die *Erkennung* ist Scryfall ohnehin besser: den Zugriff über Setcode und
  Sammlernummer gibt es bei Cardmarket nicht.

Was Cardmarket besser kann, sind die konkreten Angebote. Dorthin führt der
`CM`-Link je Kartenzeile.
* „Preise aktualisieren“ ruft jede Karte einzeln ab und schreibt einen
  Historienpunkt pro Tag; gekürzt wird dabei nichts. Rückwirkend füllt der
  optionale MTGJSON-Job den Verlauf und trägt ihn über die Jahre fort — siehe
  „Preisverlauf: Langzeitarchiv aus MTGJSON“.
