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
   merkt, ist sonst derjenige, der die App benutzt. */

import { chromium } from "playwright-core";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

let gut = 0, schlecht = 0;
const gescheitert = [];

for (const datei of dateien) {
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

  const fehler = stand.zeilen.filter(z => !z.ok);
  console.log(`\n\x1b[1m${name}\x1b[0m  (${stand.zeilen.length - fehler.length}/${stand.zeilen.length})`);
  for (const z of stand.zeilen) {
    const zeichen = z.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${zeichen} ${z.name}${z.hinweis ? `  \x1b[2m${z.hinweis}\x1b[0m` : ""}`);
  }
  gut += stand.zeilen.length - fehler.length;
  schlecht += fehler.length;
  if (fehler.length) gescheitert.push(`${name}: ${fehler.map(f => f.name).join(", ")}`);
}

await browser.close();
server.schliessen();

console.log(`\n${"─".repeat(60)}`);
if (schlecht) {
  console.log(`\x1b[31m${schlecht} von ${gut + schlecht} Prüfungen gescheitert\x1b[0m`);
  gescheitert.forEach(z => console.log("  " + z));
  process.exit(1);
}
console.log(`\x1b[32malle ${gut} Prüfungen bestanden\x1b[0m`);
