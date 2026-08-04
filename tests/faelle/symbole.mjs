/* Das Symbolset: keine Emoji mehr, und kein Verweis ins Leere.

   ANLASS. Bis zur Umstellung standen die Sinnbilder der Oberfläche als
   Zeichen-Entities im Quelltext — `&#9878;` für die Waage, `&#128200;` für den
   Preisverlauf, `&#10024;` für die KI. 181 Stück, 55 verschiedene. Sie kamen
   aus fünf Jahrzehnten Unicode und aus so vielen Händen: Strichzeichnungen
   neben vollfarbigen Bildchen, flache neben perspektivischen, und auf jedem
   Betriebssystem sah alles wieder anders aus. Ein Dutzend davon nebeneinander
   in der Kartenansicht las sich als Sammelsurium.

   Ersetzt sind sie durch ein eigenes Set in index.html. Diese Prüfung hält
   den Zustand fest, denn er ist leicht zu verlieren: Ein Emoji ist schneller
   getippt als ein <symbol> gezeichnet, und in einem 18.000-Zeilen-Quelltext
   fällt eines nicht auf.

   Vier Behauptungen:

     1. In allem, was die App AUSLIEFERT, steht kein Piktogramm mehr.
        Kommentare sind ausgenommen — die dürfen erzählen, was früher dastand
        (app.js tut das an zwei Stellen), und ausgeliefert wird davon nichts.

     2. Jeder ico()-Aufruf trifft ein Symbol, das es gibt. Ein Vertipper
        („ico('kette')" statt „ico('ketten')") fällt sonst NICHT auf: <use> auf
        eine unbekannte Kennung zeichnet nichts und meldet nichts — an der
        Stelle bleibt einfach Leere, und niemand sieht den Unterschied zu
        „hier gehört nichts hin".

     3. Jedes Symbol im Sprite wird auch gebraucht. Ungenutzte Zeichnungen
        wandern sonst mit jeder Auslieferung mit.

     4. Die Symbole halten ihr Raster ein (viewBox 0 0 24 24) und bringen keine
        festen Farben mit. Ein `fill="#c9a227"` mitten im Sprite wäre genau der
        Rückfall, den die Umstellung beheben sollte: ein Symbol, das seine
        Farbe nicht mehr von der Umgebung nimmt.

   Ohne Browser — es geht um den Quelltext, nicht um die Darstellung. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const name = "symbole";

/* Kommentare wegnehmen, bevor gesucht wird. Bewusst ein kleiner Automat und
   kein regulärer Ausdruck: `"http://x"` enthält `//` und wäre für einen
   Ausdruck der Anfang eines Kommentars — der halbe Rest der Datei fiele weg,
   und die Prüfung wäre stillschweigend blind. */
function ohneKommentare(quelle, art) {
  let aus = "", i = 0, zustand = "code";
  while (i < quelle.length) {
    const c = quelle[i], n = quelle[i + 1];
    if (zustand === "code") {
      if (art === "js" && c === "/" && n === "/") { zustand = "zeile"; i += 2; continue; }
      if (art !== "html" && c === "/" && n === "*") { zustand = "block"; i += 2; continue; }
      if (art === "html" && quelle.startsWith("<!--", i)) { zustand = "html"; i += 4; continue; }
      if (art === "js" && (c === '"' || c === "'" || c === "`")) { zustand = c; }
      aus += c; i++; continue;
    }
    if (zustand === "zeile") { if (c === "\n") { zustand = "code"; aus += c; } i++; continue; }
    if (zustand === "block") { if (c === "*" && n === "/") { zustand = "code"; i += 2; continue; } i++; continue; }
    if (zustand === "html") { if (quelle.startsWith("-->", i)) { zustand = "code"; i += 3; continue; } i++; continue; }
    // in einer Zeichenkette: bis zum passenden Ende durchreichen
    aus += c;
    if (c === "\\") { aus += n ?? ""; i += 2; continue; }
    if (c === zustand) zustand = "code";
    i++;
  }
  return aus;
}

/* Was als Piktogramm gilt. Extended_Pictographic trifft die Emoji; die
   Entities schreibt niemand versehentlich, aber genau so standen sie vorher
   im Quelltext, deshalb werden auch sie aufgelöst und mitgeprüft.
   AUSGENOMMEN sind die Entities unterhalb U+2000 (&#160; geschütztes
   Leerzeichen, &#39; Apostroph aus esc()) — die sind Satzzeichen, keine
   Bilder. */
function piktogramme(text) {
  const aufgelöst = text.replace(/&#(\d+);/g, (ganz, n) =>
    Number(n) >= 0x2000 ? String.fromCodePoint(Number(n)) : ganz);
  const treffer = new Map();
  for (const m of aufgelöst.matchAll(/\p{Extended_Pictographic}/gu)) {
    const z = m[0];
    treffer.set(z, (treffer.get(z) || 0) + 1);
  }
  return treffer;
}

export default async function ({ stand, wurzel }) {
  const lies = f => readFile(join(wurzel, f), "utf8");
  const [appJs, i18nJs, indexHtml, styleCss] = await Promise.all(
    ["app.js", "i18n.js", "index.html", "style.css"].map(lies));

  // ---- 1. Keine Piktogramme in dem, was ausgeliefert wird ----------------
  const dateien = [
    ["app.js", appJs, "js"],
    ["i18n.js", i18nJs, "js"],
    ["index.html", indexHtml, "html"],
    ["style.css", styleCss, "css"],
  ];
  const gefunden = [];
  for (const [datei, quelle, art] of dateien) {
    for (const [zeichen, n] of piktogramme(ohneKommentare(quelle, art)))
      gefunden.push(`${datei}: ${zeichen} (${n}×)`);
  }
  stand.ist("keine Emoji außerhalb von Kommentaren", gefunden.length === 0,
            gefunden.length ? gefunden.join(", ") : "vier Dateien geprüft");

  // ---- 2. Jeder Verweis trifft ein Symbol --------------------------------
  const vorhanden = new Set([...indexHtml.matchAll(/<symbol id="ic-([a-z-]+)"/g)].map(m => m[1]));
  stand.ist("das Sprite steht in index.html", vorhanden.size > 30, vorhanden.size + " Symbole");

  const benutzt = new Set();
  for (const m of appJs.matchAll(/\bico\(\s*"([a-z-]+)"/g)) benutzt.add(m[1]);
  for (const m of indexHtml.matchAll(/<use href="#ic-([a-z-]+)"/g)) benutzt.add(m[1]);

  const insLeere = [...benutzt].filter(n => !vorhanden.has(n));
  stand.ist("kein Verweis auf ein Symbol, das es nicht gibt", insLeere.length === 0,
            insLeere.length ? insLeere.join(", ") : benutzt.size + " Verweise geprüft");

  // ---- 3. Kein Symbol liegt ungenutzt herum ------------------------------
  const ungenutzt = [...vorhanden].filter(n => !benutzt.has(n));
  stand.ist("kein Symbol ohne Verwendung", ungenutzt.length === 0,
            ungenutzt.length ? ungenutzt.join(", ") : "alle " + vorhanden.size + " im Einsatz");

  // ---- 4. Ein Raster, keine festen Farben --------------------------------
  const sprite = indexHtml.match(/<svg class="ic-sprite"[\s\S]*?<\/svg>\s*(?=<!--|\n<)/)?.[0] ?? "";
  stand.ist("das Sprite ließ sich herausschneiden", sprite.length > 1000, sprite.length + " Zeichen");

  const falschesRaster = [...sprite.matchAll(/<symbol id="ic-([a-z-]+)"([^>]*)>/g)]
    .filter(m => !m[2].includes('viewBox="0 0 24 24"')).map(m => m[1]);
  stand.ist("alle Symbole auf demselben Raster", falschesRaster.length === 0,
            falschesRaster.length ? falschesRaster.join(", ") : "24×24");

  // Erlaubt sind currentColor, var(--ic-akz) und none. Alles andere ist eine
  // festgeschriebene Farbe und damit blind für die Umgebung.
  const festeFarben = [...sprite.matchAll(/(?:fill|stroke)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(w => !["currentColor", "none", "var(--ic-akz)"].includes(w));
  stand.ist("kein Symbol bringt eine eigene Farbe mit", festeFarben.length === 0,
            festeFarben.length ? [...new Set(festeFarben)].join(", ") : "nur currentColor und der Akzent");

  // ---- Zwei Zeichen gibt es doppelt --------------------------------------
  // Jeweils einmal als <symbol> und einmal als Maske in style.css, weil
  // content: kein <use> einsetzen kann. Zwei Zeichnungen desselben Zeichens
  // laufen auseinander, sobald jemand nur eine davon anfasst — und zwar
  // still: Beide sehen für sich genommen richtig aus, nur eben nicht mehr
  // gleich. Deshalb hier der stumpfe Vergleich Pfad gegen Pfad.
  const pfadeAusMaske = (name) =>
    [...decodeURIComponent(styleCss.match(new RegExp(`--ic-${name}:url\\("([^"]+)"\\)`))?.[1] ?? "")
      .matchAll(/<path d='([^']+)'/g)].map(m => m[1]);
  const pfadeAusSprite = (id) =>
    [...(sprite.match(new RegExp(`<symbol id="ic-${id}"[^>]*>([\\s\\S]*?)</symbol>`))?.[1] ?? "")
      .matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);

  for (const [maske, symbol] of [["winkel", "pfeil-rechts"], ["leer", "kartenruecken"]])
    stand.gleich(`Maske --ic-${maske} deckt sich mit dem Symbol ic-${symbol}`,
      pfadeAusMaske(maske), pfadeAusSprite(symbol));
}
