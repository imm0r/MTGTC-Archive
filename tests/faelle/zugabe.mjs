/* Karte aus der Sammlung ins Deck: Schaltfläche, ausklappendes Feld,
   gefilterte Trefferliste, Zug daraus in eine Kategorie.

   Der wichtigste Teil ist der FILTER. zugabeGrund() entscheidet, was
   überhaupt angeboten wird, und dieselbe Regel prüft das Ablegen noch einmal.
   Läuft eine der beiden auseinander, bekommt man entweder Karten angeboten,
   die nicht dürfen (und nach dem Ziehen eine Fehlermeldung), oder man findet
   Karten nicht, die dürften. */

import { AUFBAU, PUNKT } from "../hilfen.mjs";

export const name = "zugabe";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 12, kategorien: 2, decks: 2,
    frei: [{ id: "fA", name: "Freikarte Eins" }, { id: "fB", name: "Freikarte Zwei" }] });
  await seite.waitForTimeout(350);

  /* Eine dritte Karte, die es zwar gibt, aber vollständig im zweiten Deck
     steckt: Sie darf NICHT angeboten werden. */
  await seite.evaluate(() => {
    CARDS.push({ id: "fBelegt", name: "Freikarte Belegt", disp: "Freikarte Belegt",
      cn: "x", lang: "en", qty: 1, set: "cmr", price: 1, type_line: "Artifact" });
    DECKS[1].entries.push({ cardId: "fBelegt", qty: 1, kats: [] });
    renderDecks();
  });
  await seite.waitForTimeout(250);

  /* --- Ruhezustand -------------------------------------------------------- */
  const ruhe = await seite.evaluate(() => {
    const l = document.querySelector('.deck-inhalt [data-zugabe="d0"]').closest(".stapel-leiste");
    const feld = l.querySelector("[data-zusuch]");
    const knopf = l.querySelector(".stapel-zugabe-knopf");
    return {
      feldBreite: Math.round(feld.getBoundingClientRect().width),
      tabindex: feld.getAttribute("tabindex"),
      bild: knopf.querySelector(".stapel-zugabe-bild")?.getAttribute("src") ?? null,
      bildDa: (() => { const i = knopf.querySelector(".stapel-zugabe-bild");
        return !!i && i.complete && i.naturalWidth > 0; })(),
      beschriftung: knopf.getAttribute("aria-label"),
      mengenfeld: l.querySelectorAll("input[type=number]").length,
    };
  });
  stand.ist("das Feld ist eingeklappt", ruhe.feldBreite === 0 && ruhe.tabindex === "-1",
    `${ruhe.feldBreite} px, tabindex ${ruhe.tabindex}`);
  stand.ist("die Schaltfläche trägt ihr Bild", ruhe.bildDa, ruhe.bild);
  stand.ist("und für Vorleseprogramme einen Namen", !!ruhe.beschriftung, ruhe.beschriftung);
  stand.ist("kein Mengenfeld in der Leiste", ruhe.mengenfeld === 0);

  /* --- Klick klappt nach rechts aus --------------------------------------- */
  await seite.locator('[data-zugabe="d0"]').click();
  await seite.waitForTimeout(400);
  const offen = await seite.evaluate(() => {
    const l = document.querySelector('.deck-inhalt [data-zugabe="d0"]').closest(".stapel-leiste");
    const k = l.querySelector(".stapel-zugabe-knopf").getBoundingClientRect();
    const f = l.querySelector("[data-zusuch]").getBoundingClientRect();
    return { breite: Math.round(f.width), rechtsDavon: Math.round(f.left - k.right),
             fokus: document.activeElement === l.querySelector("[data-zusuch]") };
  });
  stand.ist("das Feld klappt auf", offen.breite > 200, `${offen.breite} px`);
  stand.ist("und zwar nach rechts", offen.rechtsDavon >= 0, `${offen.rechtsDavon} px vom Knopf`);
  stand.ist("der Fokus springt hinein", offen.fokus);

  /* --- Die Liste zeigt nur, was auch darf --------------------------------- */
  await seite.locator('[data-zusuch="d0"]').type("Freikarte", { delay: 25 });
  await seite.waitForTimeout(300);
  const treffer = await seite.evaluate(() =>
    [...document.querySelectorAll(".sugg li.sugg-karte")].map(li => li.textContent.trim()));
  stand.ist("die freien Karten stehen da",
    treffer.some(t => t.includes("Eins")) && treffer.some(t => t.includes("Zwei")),
    treffer.join(" · "));
  stand.ist("die anderswo verbaute nicht", !treffer.some(t => t.includes("Belegt")));
  stand.ist("jede Zeile hat einen Griff",
    await seite.evaluate(() => document.querySelectorAll(".sugg li.sugg-karte [data-ziehgriff]").length) === treffer.length);

  // Eine Karte, die schon in diesem Deck liegt, taucht gar nicht auf.
  await seite.locator('[data-zusuch="d0"]').fill("");
  await seite.locator('[data-zusuch="d0"]').type("Karte 0-1", { delay: 25 });
  await seite.waitForTimeout(300);
  stand.ist("was schon im Deck liegt, wird nicht angeboten",
    await seite.evaluate(() => document.querySelectorAll(".sugg li.sugg-karte").length) === 0);

  /* --- Aus der Liste in eine Kategorie ziehen ----------------------------- */
  await seite.locator('[data-zusuch="d0"]').fill("");
  await seite.locator('[data-zusuch="d0"]').type("Freikarte Eins", { delay: 20 });
  await seite.waitForTimeout(300);
  await seite.evaluate(() => { window.ZUGABE = null;
    window.zugabeAbgelegt = (zug, ziel) => {
      window.ZUGABE = { karte: zug.cardId, neu: zug.neu, deck: zug.deckId, ziel }; katZiehAus(); }; });

  const zeile = await seite.locator(".sugg li.sugg-karte").first().boundingBox();
  await seite.mouse.move(zeile.x + 8, zeile.y + zeile.height / 2);
  await seite.mouse.down();
  await seite.mouse.move(zeile.x + 8, zeile.y + 60, { steps: 8 });
  const beim = await seite.evaluate(() => ({
    fächer: !document.getElementById("kat-drop").hidden,
    truhe: getComputedStyle(document.querySelector(".katdrop-muell")).display,
    listeWeg: document.querySelectorAll(".stapel-zugabe-feld ul").length === 0,
  }));
  stand.ist("die Fächer erscheinen", beim.fächer);
  stand.ist("die Truhe bleibt aus (die Karte ist noch nicht drin)", beim.truhe === "none", beim.truhe);
  stand.ist("die Trefferliste macht sofort Platz", beim.listeWeg);

  const ziel = await seite.evaluate(PUNKT, '.stapel-spalte[data-katdrop="d0k1"]');
  stand.ist("die Zielspalte ist erreichbar", !!ziel);
  if (ziel) {
    await seite.mouse.move(ziel.x, ziel.y, { steps: 8 });
    await seite.mouse.up();
    await seite.waitForTimeout(150);
    stand.gleich("abgelegt als NEUE Karte im richtigen Fach",
      await seite.evaluate(() => window.ZUGABE),
      { karte: "fA", neu: true, deck: "d0", ziel: "d0k1" });
  }

  /* --- Die Regel selbst, ohne Umweg über die Oberfläche ------------------- */
  stand.gleich("zugabeGrund urteilt wie erwartet",
    await seite.evaluate(() => {
      const d = DECKS.find(x => x.id === "d0");
      const g = id => zugabeGrund(d, CARDS.find(c => c.id === id)) ?? "darf";
      return { frei: g("fA"), belegt: g("fBelegt"), drin: g("d0c0") };
    }),
    { frei: "darf", belegt: "vergeben", drin: "drin" });

  /* --- Volles Deck -------------------------------------------------------- */
  await seite.evaluate(() => {
    const d = DECKS.find(x => x.id === "d0");
    // Auf genau DECK_MAX auffüllen, ohne die Kategorien anzufassen.
    let i = 0;
    while (deckGroesse(d) < DECK_MAX) {
      const id = "füll" + (i++);
      CARDS.push({ id, name: "Füller " + i, disp: "Füller " + i, cn: String(i), lang: "en",
        qty: 1, set: "cmr", price: 0, type_line: "Artifact" });
      d.entries.push({ cardId: id, qty: 1, kats: [] });
    }
    renderDecks();
  });
  await seite.waitForTimeout(300);
  await seite.locator('[data-zugabe="d0"]').click();
  await seite.waitForTimeout(300);
  await seite.locator('[data-zusuch="d0"]').type("Freikarte", { delay: 25 });
  await seite.waitForTimeout(300);
  const voll = await seite.evaluate(() => ({
    groesse: deckGroesse(DECKS.find(d => d.id === "d0")),
    zeilen: [...document.querySelectorAll(".sugg ul li")].map(li => li.className),
    text: document.querySelector(".sugg li.sugg-hinweis")?.textContent ?? "",
  }));
  stand.ist("das Deck ist voll", voll.groesse === await seite.evaluate(() => DECK_MAX), voll.groesse);
  stand.gleich("dann steht dort nur noch der Hinweis", voll.zeilen, ["sugg-hinweis"]);
  stand.ist("und der sagt auch, woran es liegt", /100/.test(voll.text), voll.text);
}
