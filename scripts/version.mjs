#!/usr/bin/env node
/* Pflegt die beiden Nummern in index.html, die von Hand ständig vergessen
   werden. Sie beantworten verschiedene Fragen und werden deshalb getrennt
   behandelt — siehe README.md „Versionsnummer".

   1. <meta name="app-version"> — welcher STAND ist ausgeliefert.
      Steigt nach Semantic Versioning. Welche Stelle, kann kein Programm
      entscheiden; die Stufe kommt deshalb von außen (aus dem PR-Titel).

   2. ?v= an jedem href/src — hat sich DIESE DATEI geändert.
      Wird hier aus dem Inhalt berechnet (SHA-256, acht Zeichen) statt
      hochgezählt. Ein Zähler braucht ein Gedächtnis und kann driften — genau
      das ist passiert: drei Zusammenführungen hintereinander haben app.js,
      i18n.js und style.css geändert, ohne die Zähler anzufassen. Ein Hash hat
      kein Gedächtnis. Gleiche Datei, gleicher Wert; geänderte Datei, anderer
      Wert. Vergessen ist damit unmöglich, nicht bloß unwahrscheinlich.

   WARUM ?v= ÜBERHAUPT NÖTIG IST: Die App liegt auf GitHub Pages (der Workflow
   pages-build-deployment, den GitHub implizit anlegt) UND auf Vercel. Pages
   liefert mit „cache-control: max-age=600" ohne must-revalidate aus — ein
   Browser darf die alte Datei also zehn Minuten lang weiterverwenden, ohne
   nachzufragen. Vercel schickt „max-age=0, must-revalidate", dort wäre ?v=
   entbehrlich. Maßgeblich ist Pages: auf diese Adresse zeigt auch die
   Überwachung in .upptime.yml.

   Aufrufe:
     node scripts/version.mjs                  nur die Hashes auffrischen
     node scripts/version.mjs minor            Version anheben + Hashes
     node scripts/version.mjs minor 0.13.0     Stufe auf DIESE Basis anwenden
     node scripts/version.mjs --pruefen        nichts schreiben, Exit 1 bei Abweichung

   Die Basis wird bewusst mitgegeben: der Workflow reicht die Version aus dem
   Zielzweig herein. Sonst würde ein zweiter Lauf auf demselben Pull Request
   die schon angehobene Nummer erneut anheben. */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = resolve(WURZEL, "index.html");

const STUFEN = ["major", "minor", "patch"];
/* Nur X.Y.Z ohne Vorab-/Bauteil: was dieses Skript anhebt, muss es auch
   eindeutig zerlegen können. Die Anzeige in app.js akzeptiert mehr (Semver
   vollständig) — das ist Absicht, gelesen wird großzügiger als geschrieben. */
const VERSION_RX = /^(\d+)\.(\d+)\.(\d+)$/;

export function anheben(basis, stufe) {
  const m = VERSION_RX.exec(basis);
  if (!m) throw new Error(`Basisversion nicht lesbar: "${basis}" (erwartet X.Y.Z)`);
  const [major, minor, patch] = m.slice(1).map(Number);
  // Steigt eine Stelle, werden die rechts davon auf 0 zurückgesetzt (README).
  if (stufe === "major") return `${major + 1}.0.0`;
  if (stufe === "minor") return `${major}.${minor + 1}.0`;
  if (stufe === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unbekannte Stufe: "${stufe}" (${STUFEN.join(", ")})`);
}

export function versionAus(html) {
  return /<meta\s+name="app-version"\s+content="([^"]*)"/.exec(html)?.[1] ?? null;
}

const hashVon = pfad =>
  createHash("sha256").update(readFileSync(resolve(WURZEL, pfad))).digest("hex").slice(0, 8);

/* Ersetzt das ?v= JEDES href/src, dessen Datei im Arbeitsbaum liegt. Bewusst
   ohne gepflegte Dateiliste — sonst fiele beim nächsten neuen Skript-Tag
   wieder etwas hinten runter. Attribute statt Freitext, damit die Erklärungen
   in den HTML-Kommentaren (die „app.js?v=" erwähnen) unangetastet bleiben. */
export function hashesSetzen(html, warnen = () => {}) {
  return html.replace(/(\b(?:href|src)=")([^"?]+)\?v=[^"]*(")/g, (ganz, vorn, pfad, hinten) => {
    try { return `${vorn}${pfad}?v=${hashVon(pfad)}${hinten}`; }
    catch { warnen(pfad); return ganz; }        // Datei fehlt: unverändert lassen
  });
}

function main(argv) {
  const pruefen = argv.includes("--pruefen");
  const rest = argv.filter(a => a !== "--pruefen");
  const stufe = rest[0] || null;
  if (stufe && !STUFEN.includes(stufe)) {
    console.error(`Unbekannte Stufe "${stufe}". Erlaubt: ${STUFEN.join(", ")}`);
    process.exit(2);
  }

  const alt = readFileSync(INDEX, "utf8");
  const basis = rest[1] || versionAus(alt);
  if (basis == null) { console.error("Kein <meta name=\"app-version\"> in index.html"); process.exit(2); }

  let neu = alt;
  let version = basis;
  if (stufe) {
    version = anheben(basis, stufe);
    neu = neu.replace(/(<meta\s+name="app-version"\s+content=")[^"]*(")/, `$1${version}$2`);
  } else if (rest[1]) {
    // Basis ohne Stufe: übernehmen, wie sie ist (der Workflow tut das nicht,
    // von Hand ist es beim Zurückdrehen praktisch).
    neu = neu.replace(/(<meta\s+name="app-version"\s+content=")[^"]*(")/, `$1${version}$2`);
  }
  neu = hashesSetzen(neu, p => console.warn(`  übersprungen, Datei fehlt: ${p}`));

  const geaendert = neu !== alt;
  if (pruefen) {
    if (geaendert) {
      console.error("index.html ist nicht auf Stand (Version oder ?v=).");
      console.error("Beheben mit: node scripts/version.mjs" + (stufe ? ` ${stufe}` : ""));
      process.exit(1);
    }
    console.log("index.html ist auf Stand.");
    return;
  }

  if (!geaendert) { console.log(`Nichts zu tun (Version ${version}).`); return; }
  writeFileSync(INDEX, neu);
  console.log(`index.html geschrieben — Version ${version}${stufe ? ` (${stufe} auf ${basis})` : ""}.`);
  for (const [, pfad, wert] of neu.matchAll(/\b(?:href|src)="([^"?]+)\?v=([^"]*)"/g))
    console.log(`  ${pfad} → ?v=${wert}`);
}

// Nur ausführen, wenn direkt aufgerufen — die Tests importieren die Funktionen.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main(process.argv.slice(2));
