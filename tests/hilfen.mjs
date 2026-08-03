/* Werkzeug für die Prüfungen: Browser finden, Server starten, Ergebnisse
   sammeln, eine Attrappen-Sammlung aufbauen.

   Bewusst ohne Prüfrahmen von der Stange. Was hier gebraucht wird, sind drei
   Dinge — eine Behauptung, ein Zähler und eine verständliche Ausgabe —, und
   die stehen in vierzig Zeilen da. Ein Rahmen brächte dafür ein
   Abhängigkeitsgeflecht mit, das größer wäre als die App. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

/* ---------------------------------------------------------------- Browser
   Gesucht wird in dieser Reihenfolge:
     1. CHROMIUM_PFAD — für Umgebungen, die ihren Browser selbst mitbringen
     2. der von Playwright abgelegte Chromium (PLAYWRIGHT_BROWSERS_PATH)
     3. ein im System installierter Chrome/Chromium
   Der dritte Weg ist der für GitHub Actions: Auf den Ubuntu-Läufern liegt
   Chrome ohnehin, und dann muss nichts heruntergeladen werden. */
export function browserPfad() {
  if (process.env.CHROMIUM_PFAD) return process.env.CHROMIUM_PFAD;

  const ablage = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (ablage && existsSync(ablage)) {
    for (const eintrag of readdirSync(ablage)) {
      if (!eintrag.startsWith("chromium")) continue;
      for (const unter of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = join(ablage, eintrag, unter);
        if (existsSync(p)) return p;
      }
    }
  }

  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const p = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
      if (p) return p;
    } catch { /* nicht da, nächster */ }
  }
  throw new Error("Kein Chromium gefunden. CHROMIUM_PFAD setzen oder Chrome installieren.");
}

/* ----------------------------------------------------------------- Server
   Die App ist eine statische Seite; zum Prüfen braucht sie nur jemanden, der
   Dateien ausliefert. Kein Fremdpaket dafür — der Kern von Node kann es.

   Der Pfad wird normalisiert und muss unterhalb der Wurzel bleiben: Ein
   ".." in der Adresse soll nicht das halbe Dateisystem ausliefern, auch nicht
   auf einem Prüfrechner. */
const TYPEN = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".woff": "font/woff", ".json": "application/json" };

export function serverStarten(wurzel) {
  return new Promise(fertig => {
    const s = createServer(async (anf, ant) => {
      const rein = decodeURIComponent((anf.url || "/").split("?")[0]);
      const rel = normalize(rein === "/" ? "/index.html" : rein).replace(/^(\.\.[/\\])+/, "");
      const datei = join(wurzel, rel);
      if (!datei.startsWith(wurzel)) { ant.writeHead(403).end(); return; }
      try {
        const inhalt = await readFile(datei);
        ant.writeHead(200, { "content-type": TYPEN[extname(datei).toLowerCase()] || "application/octet-stream" });
        ant.end(inhalt);
      } catch { ant.writeHead(404).end("nicht da"); }
    });
    s.listen(0, "127.0.0.1", () => fertig({ port: s.address().port, schliessen: () => s.close() }));
  });
}

/* -------------------------------------------------------------- Ergebnisse */
export function pruefstand() {
  const zeilen = [];
  return {
    zeilen,
    /* Eine Behauptung. `hinweis` wird IMMER mitgeschrieben, nicht nur im
       Fehlerfall: Eine grüne Zeile mit der gemessenen Zahl daneben sagt beim
       nächsten Mal, ob sich etwas verschoben hat, das noch innerhalb der
       Schranke liegt. */
    ist(name, bedingung, hinweis) {
      zeilen.push({ name, ok: !!bedingung, hinweis: hinweis === undefined ? "" : String(hinweis) });
    },
    gleich(name, war, soll) {
      const a = JSON.stringify(war), b = JSON.stringify(soll);
      zeilen.push({ name, ok: a === b, hinweis: a === b ? a : `war ${a}, erwartet ${b}` });
    },
  };
}

/* ------------------------------------------------------- Attrappen-Sammlung
   Wird IM BROWSER ausgeführt (page.evaluate) und ersetzt CARDS/DECKS, bevor
   gezeichnet wird. Ohne das bräuchte jede Prüfung eine Datenbank.

   Erst sichtbar machen, dann zeichnen: Solange #app auf display:none steht,
   misst jedes Element null, und schwebemasseMessen() schriebe unbrauchbare
   Höhen. Genau daran ist in der Entwicklung schon einmal eine Messung
   gescheitert. */
export const AUFBAU = (o) => {
  const { karten = 12, kategorien = 2, ansicht = "karten", gruppe = "kat",
          decks = 1, frei = [], sprache = "de" } = o || {};
  document.getElementById("gate").style.display = "none";
  if (typeof setLang === "function") setLang(sprache);
  DECK_KAT_TABELLE_FEHLT = false;

  // Maßstabsgetreue Attrappe: 63:88, Namensbalken zwischen 4 % und 10 % der
  // Höhe — dieselbe Geometrie, mit der die Kartenansicht rechnet.
  const bild = (name, rahmen) => {
    const W = 244, H = Math.round(244 * 88 / 63);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" rx="12" fill="#0b0b0d"/>
      <rect x="7" y="7" width="${W-14}" height="${H-14}" rx="8" fill="${rahmen}"/>
      <rect x="13" y="${H*0.040}" width="${W-26}" height="${H*0.062}" rx="4" fill="#efe8d8"/>
      <text x="21" y="${H*0.088}" font-family="Georgia,serif" font-size="13" fill="#141414">${name}</text>
    </svg>`;
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  };
  const mk = (id, name, menge, rahmen) => ({ id, name, disp: name, cn: id, lang: "en",
    qty: menge, set: "cmr", price: 1, img: bild(name, rahmen || "#2f6b34"),
    type_line: "Artifact", oracle_text: "" });

  CARDS = []; DECKS = [];
  for (let d = 0; d < decks; d++) {
    const dk = "d" + d, ein = [];
    const kats = [];
    for (let k = 0; k < kategorien; k++) kats.push({ id: `${dk}k${k}`, name: `Fach ${k}` });
    for (let i = 0; i < karten; i++) {
      const id = `${dk}c${i}`;
      CARDS.push(mk(id, `Karte ${d}-${i}`, 2, ["#2f6b34", "#8a8a92", "#2a4f8a"][i % 3]));
      // Der Löwenanteil in die erste Kategorie: So wird eine Spalte länger als
      // das Fenster, und die klebenden Köpfe haben überhaupt etwas zu tun.
      const k = i < Math.ceil(karten * 0.7) ? 0 : (i % kategorien);
      ein.push({ cardId: id, qty: 1, kats: [{ id: `${dk}k${k}`, primaer: true }] });
    }
    DECKS.push({ id: dk, name: `Deck ${d}`, format: "Commander", kategorien: kats, entries: ein });
  }
  // Karten, die in keinem Deck stecken — Futter für die Zugabe-Prüfung.
  for (const f of frei) CARDS.push(mk(f.id, f.name, f.bestand ?? 1, "#7a2222"));

  DECKS.forEach(d => { deckAnsicht.setze(d.id, ansicht); deckGruppe.setze(d.id, gruppe); });
  try { localStorage.setItem("mtg-decks-offen", JSON.stringify([DECKS[0].id])); } catch { /* egal */ }
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  document.getElementById("app").style.display = "block";
  renderDecks();
};

/* Eine Karte suchen, die sich an dieser Stelle auch wirklich anfassen lässt.

   Eine bestimmte data-id anzusteuern führt in die Irre: Die Spalte ist nach
   Namen sortiert, und "Karte 0-11" steht dort weit VOR "Karte 0-8". Wer d0c11
   für "drei Zeilen unter d0c8" hält, drückt in Wahrheit auf einen Punkt weit
   oberhalb des Fensters — und wundert sich, dass kein Zug beginnt.

   Gesucht wird deshalb der Reihe nach: im Bild, mit Abstand zur klebenden
   Kopfzeile oben und zum Fächerbalken unten, und der Zeiger muss an der
   Stelle auch auf der Karte landen und nicht auf etwas darüber. */
export const GREIFBAR = (o) => {
  const { raum = "", ausser = [], oben = 120, unten = 150 } = o || {};
  for (const k of document.querySelectorAll(`${raum} .stapel-karte`.trim())) {
    if (ausser.includes(k.dataset.id)) continue;
    const r = k.getBoundingClientRect();
    const x = r.x + r.width * 0.6, y = r.top + 6;
    if (y < oben || r.bottom > innerHeight - unten) continue;
    if (!k.contains(document.elementFromPoint(x, y))) continue;
    return { id: k.dataset.id, x, y };
  }
  return null;
};

/* Einen Punkt im Element finden, an dem elementFromPoint auch WIRKLICH dort
   landet. Ohne das prüft ein Zug womöglich gegen etwas, das darüber liegt —
   die Trefferliste, der klebende Spaltenkopf, der Balken am unteren Rand. */
export const PUNKT = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  for (const fy of [0.5, 0.75, 0.3, 0.9]) for (const fx of [0.5, 0.2, 0.8]) {
    const x = r.x + r.width * fx, y = r.y + r.height * fy;
    if (y > 0 && y < innerHeight && x > 0 && x < innerWidth &&
        el.contains(document.elementFromPoint(x, y))) return { x, y };
  }
  return null;
};

/* ---------------------------------------------------- Der Hinweis am Element
   `el.title` zu lesen ist eine FALLE. Die App zeigt eigene Tooltips und hängt
   dafür den nativen Hinweis AUS, solange der Zeiger über dem Element steht
   (app.js, initTooltip → aushaengen: `el.dataset.aaTitle = txt;
   el.removeAttribute("title")`). Beim Verlassen hängt sie ihn wieder ein.
   Steht der Zeiger vom letzten Klick zufällig darüber — nach einem Wechsel der
   Fenstergröße liegt er plötzlich woanders im Layout —, misst man einen leeren
   Text und hält ihn für einen fehlenden Tooltip.

   Genau so wurde „mana: und der Aufschlüsselung im Tooltip" rot, und zwar NUR
   auf dem Prüfrechner: Hier scheitert der Aufbau vorher an der fehlenden
   Supabase-Bibliothek vom CDN (`connect()` wirft, wireApp() läuft nie), und
   ohne wireApp() gibt es initTooltip() gar nicht. Auf einem Läufer mit Netz
   lädt das CDN, der Tooltip ist da — und der Fehler auch. Sichtbar wurde das
   erst, als die Prüfung den gemessenen Text mitschrieb: "" statt der
   Aufschlüsselung, also gar kein Attribut.

   Diese Funktion liest beide Orte. Sie wird über addInitScript in JEDE Seite
   gelegt (lauf.mjs), damit kein Fall sie vergessen kann. */
export const HINWEIS_HELFER = () => {
  window.titelVon = (el) => !el ? null
    : (el.getAttribute("title") ?? el.dataset?.aaTitle ?? "");
};
