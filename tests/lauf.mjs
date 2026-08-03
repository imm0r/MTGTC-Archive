/* Der Läufer. Startet einen Dateiserver auf die Projektwurzel, öffnet einen
   Browser, lässt jede Datei aus faelle/ ihre Behauptungen aufstellen und
   meldet am Ende, was nicht stimmt.

   Aufruf:
     npm test                 — alles
     npm test -- ziehen css   — nur Fälle, deren Name das enthält

   Warum überhaupt: In dieser Anwendung scheitert das meiste STILL. Ein
   ungültiger CSS-Kurzschreiber wirft die ganze Anweisung weg, eine zu schwache
   Regel verliert gegen eine stärkere, eine zu früh genommene Messung schreibt
   eine falsche Höhe — nichts davon wird rot, es sieht nur falsch aus. Wer das
   merkt, ist sonst derjenige, der die App benutzt.

   ---- Mehrere Fälle gleichzeitig ----------------------------------------
   Nacheinander dauerte der ganze Lauf gut sieben Minuten, und daran war fast
   nichts Rechnerei: Gemessen hat JEDER Fall einen Sockel von 14 bis 16
   Sekunden, während `migrationen` — der einzige ohne Browser — in 1,1 s fertig
   ist. Die Zeit steckt im Seitenaufbau und in den festen Wartezeiten, mit
   denen die Fälle auf Übergänge warten (fremdmatte wartet allein zweimal 4,6 s
   auf den Auffrischtakt). Wartezeit ist kein Rechenbedarf: Solange ein Fall
   wartet, kann ein anderer arbeiten.

   Jeder Fall hat ohnehin schon seinen EIGENEN Kontext — geteilter Zustand
   zwischen Prüfungen ist die zuverlässigste Art, sich grüne Läufe einzubilden.
   Damit ist Gleichzeitigkeit keine Umstellung, sondern nur das Weglassen des
   Wartens aufeinander.

   WIE VIELE GLEICHZEITIG. So viele wie Kerne. Gemessen auf vier Kernen:

     nacheinander   ~7:00      4 gleichzeitig   1:59
     3 gleichzeitig  2:41       6 gleichzeitig   1:25

   Sechs wären noch schneller, und alle 698 Prüfungen blieben dabei grün — die
   Voreinstellung bleibt trotzdem bei der Kernzahl. Grund: Die Fälle warten in
   festen Zeitspannen („350 ms, dann müsste es stehen"), und aus einer solchen
   Spanne wird unter Last schnell zu wenig. Wie viel Luft dabei bleibt, hängt
   an der Maschine; nachgemessen ist es auf dieser, nicht auf dem Prüfrechner.
   Die vier verkürzen den Lauf ohnehin um mehr als die Hälfte.

   PRUEF_PARALLEL setzt die Zahl von Hand. PRUEF_PARALLEL=1 stellt die alte,
   streng serielle Reihenfolge wieder her — der erste Griff, wenn ein Fall nur
   im vollen Lauf rot wird und einzeln grün bleibt.

   Die Ausgabe bleibt BLOCKWEISE: Ein Fall wird erst gedruckt, wenn er ganz
   fertig ist. Zeilenweise durcheinander wäre die Ausgabe wertlos. Die
   Reihenfolge der Blöcke ist die des Fertigwerdens, nicht mehr die alphabetische
   — die Zusammenfassung am Ende sortiert wieder. */

import { chromium } from "playwright-core";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { browserPfad, serverStarten, pruefstand, HINWEIS_HELFER } from "./hilfen.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, "..");
const filter = process.argv.slice(2);

const server = await serverStarten(WURZEL);
const adresse = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ executablePath: browserPfad() });

const dateien = (await readdir(join(HIER, "faelle")))
  .filter(f => f.endsWith(".mjs"))
  .filter(f => !filter.length || filter.some(w => f.includes(w)))
  .sort();

const kerne = availableParallelism?.() || 4;
const gewuenscht = Number(process.env.PRUEF_PARALLEL) || 0;
const gleichzeitig = Math.max(1, Math.min(gewuenscht || kerne, dateien.length));

/* Ein Fall von Anfang bis Ende. Gibt zurück, was gedruckt und gezählt wird —
   gedruckt wird erst danach, damit sich die Blöcke nicht ineinanderschieben. */
async function laufe(datei) {
  const modul = await import(join(HIER, "faelle", datei));
  const name = modul.name || datei.replace(/\.mjs$/, "");
  const stand = pruefstand();
  // Jeder Fall bekommt einen FRISCHEN Kontext. Geteilter Zustand zwischen
  // Prüfungen ist die zuverlässigste Art, sich grüne Läufe einzubilden.
  const kontext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const seite = await kontext.newPage();
  // titelVon() in jede Seite legen — siehe HINWEIS_HELFER in hilfen.mjs.
  await seite.addInitScript(HINWEIS_HELFER);
  const seitenfehler = [];
  seite.on("pageerror", e => seitenfehler.push(e.message));

  try {
    await modul.default({ seite, adresse, stand, wurzel: WURZEL });
    // Ein Ausnahmefehler im Browser ist immer ein Befund, auch wenn die
    // Behauptungen daneben stimmen. Ausgenommen: die CDN-Bibliotheken, die
    // ohne Netz nicht laden — die prüft hier niemand.
    const echte = seitenfehler.filter(m => !/supabase is not defined|Tesseract/.test(m));
    stand.ist("keine Ausnahmefehler im Browser", echte.length === 0, echte.join(" | "));
  } catch (e) {
    stand.ist("Fall lief durch", false, e.message.split("\n")[0]);
  }
  await kontext.close();
  return { name, zeilen: stand.zeilen };
}

function drucke({ name, zeilen }) {
  const fehler = zeilen.filter(z => !z.ok);
  console.log(`\n\x1b[1m${name}\x1b[0m  (${zeilen.length - fehler.length}/${zeilen.length})`);
  for (const z of zeilen) {
    const zeichen = z.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${zeichen} ${z.name}${z.hinweis ? `  \x1b[2m${z.hinweis}\x1b[0m` : ""}`);
  }
}

let gut = 0, schlecht = 0;
const gescheitert = [];

/* Eine Schlange, aus der sich `gleichzeitig` Arbeiter bedienen: Wird einer
   fertig, nimmt er den nächsten Fall. Feste Päckchen wären langsamer — die
   Fälle dauern zwischen 1 und 38 Sekunden, und ein Päckchen ist nur so schnell
   wie sein längster. */
let naechster = 0;
async function arbeiter() {
  for (;;) {
    const i = naechster++;
    if (i >= dateien.length) return;
    const ergebnis = await laufe(dateien[i]);
    drucke(ergebnis);
    const fehler = ergebnis.zeilen.filter(z => !z.ok);
    gut += ergebnis.zeilen.length - fehler.length;
    schlecht += fehler.length;
    if (fehler.length) gescheitert.push(`${ergebnis.name}: ${fehler.map(f => f.name).join(", ")}`);
  }
}
await Promise.all(Array.from({ length: gleichzeitig }, arbeiter));

await browser.close();
server.schliessen();

console.log(`\n${"─".repeat(60)}`);
if (schlecht) {
  console.log(`\x1b[31m${schlecht} von ${gut + schlecht} Prüfungen gescheitert\x1b[0m`);
  gescheitert.sort().forEach(z => console.log("  " + z));
  process.exit(1);
}
console.log(`\x1b[32malle ${gut} Prüfungen bestanden\x1b[0m`);
