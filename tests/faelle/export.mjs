/* Ein Deck als Deckliste ausgeben.

   Der Export ist die einzige Stelle, an der die App etwas erzeugt, das ein
   FREMDES Werkzeug lesen muss. Ein Fehler darin sieht nicht wie ein Fehler
   aus — er sieht wie eine Deckliste aus, und auffallen tut er erst drüben,
   beim Einlesen, wenn zehn Zeilen stillschweigend fehlen.

   Die Zeile ist das Format:

       1x Capricious Hellraiser (ONE) 125

   Vier Dinge daran können still danebengehen:

   * DER NAME MUSS ENGLISCH SEIN. Eine deutsche Auflage trägt in der Sammlung
     einen deutschen Namen (`disp`); stünde der im Export, fände ihn drüben
     niemand. Genau umgekehrt zur Anzeige, die überall sonst den gedruckten
     Namen bevorzugt — deshalb ist das die Zeile, die am ehesten kippt.
   * DER SETCODE GEHÖRT IN GROSSBUCHSTABEN. Die Datenbank führt ihn seit einer
     Migration groß, ältere Zeilen können klein sein.
   * OHNE AUFLAGENANGABE bleibt die Zeile beim Namen. Ein „() “ mittendrin
     läse kein Werkzeug — dann lieber ungenau als unlesbar.
   * DIE REIHENFOLGE muss alphabetisch sein, sonst sind zwei Ausgaben
     desselben Decks nicht vergleichbar. Die Reihenfolge der Einträge in der
     Datenbank folgt dem Zufall des Einbuchens. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "export";

/* Ein Deck, dessen Einträge ABSICHTLICH in falscher Reihenfolge stehen und
   jeden Sonderfall einmal enthalten. Läuft im Browser. */
const DECKAUFBAU = () => {
  const d = DECKS[0];
  // englischer Name, Anzeigename, Set, Nummer, MENGE IM DECK, BESTAND
  const K = [
    ["Capricious Hellraiser", "Capricious Hellraiser", "one", "125", 1, 1],
    ["Arcane Signet",         "Arkanes Wappen",        "ELD", "331", 1, 1],  // deutsch gedruckt
    // Neun im Deck, vier im Schrank: Wären Deckmenge und Bestand überall
    // gleich, ließe sich nicht messen, welche von beiden der Export nimmt —
    // eine Sabotage, die den Bestand ausgab, blieb genau daran unentdeckt.
    ["Forest",                "Wald",                  "ONE", "271", 9, 4],
    ["Sol Ring",              "Sol Ring",              null,  null,  1, 1],  // ohne Auflage
    ["Brainstorm",            "Brainstorm",            "MH2", "42",  1, 0],  // fehlt im Schrank
  ];
  d.entries = K.map(([, , , , imDeck], i) => ({ cardId: "d0c" + i, qty: imDeck }));
  K.forEach(([name, disp, set, cn, , bestand], i) => {
    const c = CARDS.find(x => x.id === "d0c" + i);
    c.name = name; c.disp = disp; c.set = set; c.cn = cn; c.qty = bestand;
  });
  // Absichtlich verdreht: Der Export muss selbst sortieren.
  d.entries.reverse();

  window.GELADEN = null;
  window.download = (name, text) => { window.GELADEN = { name, text }; };
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  renderDecks();
  return d.id;
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 5, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  const deckId = await seite.evaluate(DECKAUFBAU);
  await seite.waitForTimeout(250);

  /* --- Der Text ------------------------------------------------------- */
  const text = await seite.evaluate(id => deckExportText(DECKS.find(d => d.id === id)), deckId);
  stand.gleich("die Deckliste steht Zeile für Zeile da", text.split("\n"), [
    "1x Arcane Signet (ELD) 331",       // deutsch gedruckt, englisch ausgegeben
    "1x Brainstorm (MH2) 42",           // im Schrank fehlt sie, im Deck steht sie
    "1x Capricious Hellraiser (ONE) 125",
    "9x Forest (ONE) 271",
    "1x Sol Ring",                      // ohne Auflage nur der Name
  ]);
  stand.ist("der gedruckte Name taucht nirgends auf", !/Arkanes Wappen|Wald/.test(text));
  stand.ist("der Setcode steht groß", /\(ELD\) 331/.test(text) && !/\(one\)/.test(text),
    text.split("\n")[2]);
  stand.ist("keine leere Klammer bei fehlender Auflage", !/\(\)/.test(text));

  /* Der Bestand darf die Ausgabe nicht steuern — im Export steht, was das
     DECK verlangt, nicht was im Schrank liegt. Sonst verschwänden genau die
     Karten aus der Liste, die man nachkaufen will. */
  stand.ist("eine Karte, die im Schrank fehlt, steht mit ihrer DECKMENGE da",
    /^1x Brainstorm \(MH2\) 42$/m.test(text), text.split("\n")[1]);
  stand.ist("und neun Wälder im Deck bleiben neun, auch bei vier im Schrank",
    /^9x Forest \(ONE\) 271$/m.test(text), text.split("\n")[3]);

  /* --- Der Knopf und der Dialog --------------------------------------- */
  stand.ist("das Deck trägt einen Export-Knopf",
    await seite.evaluate(id => !!document.querySelector(`[data-exportbtn="${id}"]`), deckId));
  await seite.click(`[data-exportbtn="${deckId}"]`);
  await seite.waitForTimeout(300);
  const dlg = await seite.evaluate(() => {
    const f = document.querySelector("#exp-text");
    if (!f) return null;
    return { offen: document.querySelector("#dlg")?.open === true,
             inhalt: f.value, readonly: f.readOnly,
             kopf: document.querySelector("#dlg-body h3")?.textContent,
             hinweis: document.querySelector("#dlg-body .hint")?.textContent,
             knoepfe: [!!document.querySelector("#exp-copy"), !!document.querySelector("#exp-file")] };
  });
  stand.ist("der Dialog steht offen", dlg?.offen);
  stand.gleich("und trägt genau denselben Text", dlg?.inhalt, text);
  stand.ist("das Feld ist schreibgeschützt — hier wird nichts geändert", dlg?.readonly);
  stand.ist("der Kopf nennt das Deck", /Deck 0/.test(dlg?.kopf || ""), dlg?.kopf);
  stand.ist("der Hinweis nennt Zeilen und Karten",
    /5/.test(dlg?.hinweis || "") && /13/.test(dlg?.hinweis || ""), dlg?.hinweis);
  stand.gleich("Kopieren und Sichern stehen bereit", dlg?.knoepfe, [true, true]);

  /* --- Als Datei ------------------------------------------------------ */
  await seite.click("#exp-file");
  await seite.waitForTimeout(200);
  const datei = await seite.evaluate(() => window.GELADEN);
  stand.ist("die Datei trägt Deckname und Datum",
    /^deck-deck-0-\d{4}-\d{2}-\d{2}\.txt$/.test(datei?.name || ""), datei?.name);
  stand.gleich("und denselben Inhalt", datei?.text, text);

  /* --- In die Zwischenablage ------------------------------------------ */
  await seite.evaluate(() => {
    window.ABLAGE = null;
    // Kein Recht auf die echte Zwischenablage im Prüfbrowser — abgefangen wird
    // deshalb der Aufruf selbst.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async txt => { window.ABLAGE = txt; } },
    });
  });
  await seite.click("#exp-copy");
  await seite.waitForTimeout(250);
  stand.gleich("der Kopieren-Knopf legt den Text in die Zwischenablage",
    await seite.evaluate(() => window.ABLAGE), text);

  /* Ohne Recht auf die Zwischenablage darf der Weg nicht enden: Dann muss der
     Text wenigstens markiert sein, damit ein Tastendruck genügt. */
  await seite.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("verboten"); } },
    });
    document.querySelector("#exp-text").setSelectionRange(0, 0);
  });
  await seite.click("#exp-copy");
  await seite.waitForTimeout(250);
  stand.gleich("scheitert das Kopieren, ist der Text markiert",
    await seite.evaluate(() => {
      const f = document.querySelector("#exp-text");
      return [f.selectionStart, f.selectionEnd === f.value.length];
    }), [0, true]);

  /* --- Ein zweites Format wäre ein Eintrag mehr ------------------------ */
  stand.ist("die Formate stehen als Liste, nicht als eingebauter Sonderfall",
    await seite.evaluate(() => Array.isArray(EXPORT_FORMATE) && EXPORT_FORMATE.length >= 1
      && typeof EXPORT_FORMATE[0].zeile === "function"));
}
