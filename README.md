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
| `supabase-schema.sql` | Tabellen, Row Level Security, Funktionen            |
| `start.cmd`           | Nur für lokales Testen (braucht Python)             |

Kein Build-Schritt: Die Seite lädt Supabase und Tesseract per CDN.

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

1. **Triage** (kleines Modell): liest die Schilderung in beliebiger Sprache und
   nennt englische Such- und Glossarbegriffe sowie Kandidaten-Regelnummern.
2. **Retrieval**: holt genau diese Regeln und Glossareinträge wörtlich aus der
   geladenen Textfassung, dazu per Stichwort gefundene weitere Regeln.
3. **Urteil** (stärkeres Modell): antwortet nur auf Basis dieser Auszüge, in der
   Sprache der Oberfläche, mit klarem Ergebnis, Begründung und Regelnummern.

Lädt das Regelwerk einmal nicht (Netz, veraltete URL), antwortet die Funktion im
abgesicherten Modus aus dem Modellwissen — mit deutlichem Hinweis, statt hart zu
brechen (wie die Bilderkennung auf Tesseract zurückfällt).

### Einrichten

Wie `scan-card` braucht die Funktion nur den Anthropic-Schlüssel; eine
Schemaänderung ist **nicht** nötig, der Zugriff ist allein durch die Anmeldung
geschützt.

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
  Historienpunkt pro Tag (die letzten 60 bleiben erhalten).
