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
const CHANGELOG = resolve(WURZEL, "changelog.json");

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

/* Vergleicht zwei Versionen als Zahlentripel, nicht als Text: "0.10.0" ist
   höher als "0.9.0", als Zeichenkette wäre es kleiner. Grundlage der Wache,
   die nach dem Zusammenführen prüft, ob die Nummer wirklich gestiegen ist. */
export function istHoeher(neu, alt) {
  const z = v => { const m = VERSION_RX.exec(v); return m ? m.slice(1).map(Number) : null; };
  const a = z(neu), b = z(alt);
  if (!a || !b) throw new Error(`Version nicht lesbar: "${!a ? neu : alt}" (erwartet X.Y.Z)`);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;                                    // gleich ist nicht höher
}

/* Die Stufe aus einem Pull-Request-Titel lesen. Steht hier und nicht im
   Workflow, weil sie inzwischen an ZWEI Stellen gebraucht wird (beim Pull
   Request und beim Nachziehen offener Pull Requests nach einem Merge) — und
   eine Regel, die zweimal geschrieben ist, driftet. Wirft mit der Anleitung
   aus der README, wenn sie fehlt oder mehrdeutig ist. */
export function stufeAusTitel(titel) {
  const gefunden = STUFEN.filter(s => String(titel ?? "").toLowerCase().includes(`[${s}]`));
  if (gefunden.length > 1)
    throw new Error(`Im Titel stehen mehrere Stufen (${gefunden.map(s => `[${s}]`).join(" und ")}). Bitte genau eine angeben.`);
  if (!gefunden.length)
    throw new Error(`Im Titel fehlt die Stufe. Ergänze [major], [minor] oder [patch] — siehe README.md, Abschnitt „Versionsnummer". Titel war: ${titel}`);
  return gefunden[0];
}

/* Trägt die Fassung in die Changelog-Einträge nach, die noch keine haben.

   WARUM HIER UND NICHT VON HAND: Beim Schreiben des Eintrags ist die Nummer
   noch gar nicht bekannt — sie entsteht erst in diesem Lauf, aus der Stufe im
   PR-Titel und der Version im ZIELZWEIG. Wer sie vorher hinschreibt, rät. Und
   bei zwei gleichzeitig offenen Pull Requests rät er falsch: Der zweite wird
   gegen ein main gerechnet, das den ersten schon enthält (siehe der Abschnitt
   „WARUM AUCH AUF push:main" in version.yml). Ein von Hand eingetragener Wert
   wäre dann schlicht die Nummer eines anderen.

   NUR LEERE FELDER — mit einer Ausnahme. Ein gefüllter Eintrag gehört zu einer
   ausgelieferten Fassung; ihn zu überschreiben schriebe Geschichte um.

   Die Ausnahme ist `vorher`: die Nummer, die DIESER Zweig zuletzt selbst
   gestempelt hat. Sie wird nur übergeben, wenn der Zweig schon einmal
   angehoben wurde und jetzt auf eine neue Basis umgerechnet wird — der Fall
   „zwei gleichzeitig offene Pull Requests", für den es den push:main-Lauf in
   version.yml überhaupt gibt. Ohne diese Nachbesserung stünde in index.html
   die neue Nummer und im Changelog die alte, und niemand würde es merken:
   Beide Zahlen sehen für sich genommen richtig aus.

   Beim ERSTEN Anheben eines Zweigs darf `vorher` nicht gesetzt sein. Dort ist
   die Nummer in index.html die des Zielzweigs — und die tragen die schon
   ausgelieferten Einträge zu Recht.

   Die Formatierung ist dieselbe wie im Bestand (indent 1, kein ASCII-Escaping)
   — nachgemessen: Ein Durchlauf ohne Änderung liefert die Datei Zeichen für
   Zeichen zurück. Sonst stünde in jedem Pull Request die ganze Datei im Diff. */
export function changelogStempeln(text, version, vorher = null) {
  const eintraege = JSON.parse(text);
  if (!Array.isArray(eintraege)) throw new Error("changelog.json ist keine Liste");
  let offen = 0, umgerechnet = 0;
  for (const e of eintraege) {
    if (!e || typeof e !== "object") continue;
    if (!e.version) { e.version = version; offen++; }
    else if (vorher && vorher !== version && e.version === vorher) { e.version = version; umgerechnet++; }
  }
  return { text: JSON.stringify(eintraege, null, 1) + "\n", offen, umgerechnet };
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
  // --stufe "<Titel>": nur die Stufe ausgeben (für die Workflows). Kein
  // Schreiben, keine index.html — deshalb ganz vorn und mit eigenem Ausstieg.
  const iS = argv.indexOf("--stufe");
  if (iS >= 0) {
    try { console.log(stufeAusTitel(argv[iS + 1])); }
    catch (e) { console.error(e.message); process.exit(1); }
    return;
  }
  // --hoeher A B: Exit 0, wenn A höher als B ist — sonst 1 mit Meldung.
  const iH = argv.indexOf("--hoeher");
  if (iH >= 0) {
    const [neu, alt] = [argv[iH + 1], argv[iH + 2]];
    try {
      if (istHoeher(neu, alt)) { console.log(`${neu} ist höher als ${alt}.`); return; }
      console.error(`Version ist nicht gestiegen: ${alt} → ${neu}.`);
    } catch (e) { console.error(e.message); }
    process.exit(1);
  }

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

  // Das Changelog wird nur beim ANHEBEN gestempelt. Ohne Stufe ist dieser
  // Lauf ein reines Auffrischen der Hashes und liefert nichts aus — dann gibt
  // es auch keine Fassung, der ein neuer Eintrag zuzuordnen wäre.
  let clOffen = 0, clUm = 0;
  if (stufe) {
    try {
      const roh = readFileSync(CHANGELOG, "utf8");
      // `vorher` nur, wenn dieser Zweig schon einmal angehoben wurde: Dann
      // steht in seiner index.html nicht mehr die Nummer des Zielzweigs,
      // sondern die eigene von einem früheren Lauf — und genau die ist auch
      // ins Changelog gewandert. Beim ersten Anheben ist beides gleich, und
      // dort dürfte nichts umgerechnet werden.
      const inDatei = versionAus(alt);
      const vorher = inDatei && inDatei !== basis ? inDatei : null;
      const { text, offen, umgerechnet } = changelogStempeln(roh, version, vorher);
      clOffen = offen; clUm = umgerechnet;
      if (text !== roh) writeFileSync(CHANGELOG, text);
    } catch (e) {
      // Ein kaputtes oder fehlendes Changelog darf die Versionspflege nicht
      // aufhalten — die Prüfung „changelog" nimmt sich der Datei ohnehin an.
      console.warn(`  changelog.json übersprungen: ${e.message}`);
    }
  }

  if (!geaendert && !clOffen && !clUm) { console.log(`Nichts zu tun (Version ${version}).`); return; }
  if (geaendert) writeFileSync(INDEX, neu);
  console.log(`index.html geschrieben — Version ${version}${stufe ? ` (${stufe} auf ${basis})` : ""}.`);
  if (clOffen) console.log(`  changelog.json: ${clOffen} Eintrag/Einträge auf ${version} gestempelt.`);
  if (clUm) console.log(`  changelog.json: ${clUm} Eintrag/Einträge auf ${version} umgerechnet.`);
  for (const [, pfad, wert] of neu.matchAll(/\b(?:href|src)="([^"?]+)\?v=([^"]*)"/g))
    console.log(`  ${pfad} → ?v=${wert}`);
}

// Nur ausführen, wenn direkt aufgerufen — die Tests importieren die Funktionen.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main(process.argv.slice(2));
