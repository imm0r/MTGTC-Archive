# MTG Sammlung

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
identifiziert nichts selbst, es liest nur ab. Das `T` hinter der Nummer ist
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

**Kosten.** Gemessen an einer Testkarte: 2.304 Eingabe- und 63 Ausgabe-Tokens
pro Scan.

| Modell (`const MODEL` in `index.ts`) | Pro Karte | 1.000 Karten |
|---|---|---|
| `claude-haiku-4-5` (eingestellt) | 0,26 ct | 2,60 € |
| `claude-opus-4-8` | 1,31 ct | 13,10 € |

Jede Antwort meldet unter `usage` die tatsächlich verbrauchten Tokens — damit
lässt sich das jederzeit nachrechnen statt schätzen.

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
