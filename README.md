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

Beim ersten Aufruf fragt die App nach Project URL und Schlüssel und merkt sie
sich im Browser. Wer das Eintippen sparen will, trägt beide Werte fest in den
`CONFIG`-Block oben in `app.js` ein.

### 3. Lokal testen (optional)

`start.cmd` startet einen lokalen Webserver auf Port 8000 und braucht dazu
Python. Für den Betrieb über GitHub Pages ist beides nicht nötig.

## Hinweise

* Die App braucht Internet — für Scryfall, die Sprachdaten der Texterkennung
  und die Datenbank. Es gibt keinen Offline-Betrieb.
* Preise stammen von Scryfall und sind Marktbeobachtungen, keine Verkaufspreise.
* „Preise aktualisieren“ ruft jede Karte einzeln ab und schreibt einen
  Historienpunkt pro Tag (die letzten 60 bleiben erhalten).
