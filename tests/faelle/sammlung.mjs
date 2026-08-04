/* Sammlung: „In Decks verbaute ausblenden".

   Die Falle steckt im Wort. „Verbaut" kann zweierlei heißen — die Karte kommt
   in irgendeinem Deck vor, oder ALLE Exemplare, die man besitzt, liegen in
   Decks. Der Deckbau kennt seit jeher die zweite Auslegung (zugabeGrund gibt
   „vergeben" erst zurück, wenn die anderen Decks zusammen den Bestand
   erreichen), und der Filter hier muss dieselbe treffen. Zwei Auslegungen
   desselben Wortes an zwei Stellen liefen auseinander, ohne dass etwas rot
   würde: Der Filter blendete einfach zu viel oder zu wenig aus.

   Drei Dinge können daran still schiefgehen, und alle drei stehen hier:

   * Gezählt wird über ALLE Decks zusammen. Ein Exemplar in Deck A und eines in
     Deck B sind zwei — wer je Deck prüft, findet nie mehr als eines.
   * Gezählt wird je DRUCK (Set + Sammlernummer), nicht je Sammlungszeile.
     Dieselbe Karte als Foil und als Normal sind zwei Zeilen und ein Bestand;
     wer je Zeile rechnet, blendet die falsche aus.
   * Der Bestand kommt aus der Sammlung, nicht aus der Zeile: Eine Zeile mit
     Menge 1 kann zu einem Druck gehören, von dem man drei besitzt. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "sammlung";

/* Vier Lagen, die der Filter unterscheiden muss. Läuft IM BROWSER. */
const AUFSTELLUNG = () => {
  const byId = new Map(CARDS.map(c => [c.id, c]));

  // (1) GANZ VERPLANT: ein Exemplar, und das liegt im Deck.
  byId.get("d0c0").qty = 1;

  // (2) TEILS VERPLANT: zwei Exemplare, eines im Deck. AUFBAU legt das so an.

  // (3) ÜBER ZWEI DECKS VERPLANT: zwei Exemplare, je eines in d0 und in d1.
  DECKS[1].entries.push({ cardId: "d0c2", qty: 1, kats: [{ id: "d1k0", primaer: true }] });

  // (4) EIN DRUCK, ZWEI ZEILEN: Foil daneben. Bestand des Drucks damit 2 + 1 = 3,
  //     im Deck liegt eines — beide Zeilen bleiben also stehen.
  const z = byId.get("d0c3");
  CARDS.push({ ...z, id: "d0c3f", name: z.name, disp: z.name + " (Foil)", foil: true, qty: 1 });

  // Die Filterleiste verdrahtet wireApp(), und das läuft im Start nur MIT
  // Datenbank-Zugang (ohne Konfiguration kommt der Aufbau nie so weit). Hier
  // wird es deshalb von Hand angestoßen — sonst prüfte dieser Fall eine
  // Schaltfläche, an der gar nichts hängt.
  wireApp();

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-coll"));
  renderCollection();
};

const ZEILEN = () => [...document.querySelectorAll("#tbl tbody tr[data-id]")].map(tr => tr.dataset.id);

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 6, kategorien: 2, decks: 2,
    frei: [{ id: "fA", name: "Freikarte", bestand: 1 }] });
  await seite.waitForTimeout(250);
  await seite.evaluate(AUFSTELLUNG);
  await seite.waitForTimeout(250);

  stand.ist("die Sammlung steht", await seite.evaluate(() => !!document.querySelector("#v-coll.on")));

  const haken = await seite.evaluate(() => {
    const i = document.querySelector("#f-nodeck");
    return {
      da: !!i, an: i?.checked,
      // Beschriftet, nicht bloß ein Kästchen: Für „in Decks verbaut" gibt es
      // kein Symbol, das ohne Wort verstanden würde.
      text: i?.closest(".ci-box")?.textContent.trim(),
      // Und die Regel steht im Tooltip — sie ist nicht selbsterklärend.
      hinweis: i?.closest(".ci-box")?.getAttribute("title") || "",
      // In der Wunschliste gibt es ihn nicht: Dort steht nichts, was man
      // besitzt, und ohne Bestand kann nichts verbaut sein.
      inWunsch: document.querySelectorAll("#wf-nodeck").length,
    };
  });
  stand.gleich("der Haken steht in der Filterzeile, aus, und nur in der Sammlung",
    [haken.da, haken.an, haken.inWunsch], [true, false, 0]);
  stand.ist("er trägt ein Wort, kein Symbol", (haken.text || "").length > 3, haken.text);
  stand.ist("und erklärt die Regel im Tooltip", /vier|Deck/i.test(haken.hinweis), haken.hinweis);

  const ohne = await seite.evaluate(ZEILEN);
  stand.ist("ohne Haken stehen alle besessenen Karten da",
    ["d0c0", "d0c1", "d0c2", "d0c3", "d0c3f", "fA"].every(id => ohne.includes(id)),
    ohne.length + " Zeilen");

  // Geklickt wird die BESCHRIFTUNG, nicht das Kästchen: Das liegt wie bei den
  // Farb- und Typfiltern unsichtbar hinter seinem Kasten (0 × 0, opacity 0),
  // und angefasst wird es nie direkt.
  await seite.locator(".ci-box:has(#f-nodeck)").click();
  await seite.waitForTimeout(250);
  stand.ist("ein Klick auf die Beschriftung setzt den Haken",
    await seite.evaluate(() => document.querySelector("#f-nodeck").checked));
  const mit = await seite.evaluate(ZEILEN);

  stand.ist("ganz verplant → weg (ein Exemplar, eines im Deck)", !mit.includes("d0c0"));
  stand.ist("teils verplant → bleibt (zwei Exemplare, eines im Deck)", mit.includes("d0c1"));
  stand.ist("über ZWEI Decks verplant → weg (zwei Exemplare, je eines je Deck)",
    !mit.includes("d0c2"));
  stand.gleich("ein Druck in zwei Zeilen → beide bleiben (3 besessen, 1 im Deck)",
    [mit.includes("d0c3"), mit.includes("d0c3f")], [true, true]);
  stand.ist("und was in keinem Deck steckt, bleibt ohnehin", mit.includes("fA"));

  // Der Trefferzähler muss die Verkürzung melden — sonst sieht eine gefilterte
  // Sammlung aus wie eine geschrumpfte.
  stand.ist("der Zähler nennt jetzt Treffer UND Gesamtzahl",
    await seite.evaluate(() => /\d+\D+\d+/.test(document.querySelector("#coll-count").textContent)),
    await seite.evaluate(() => document.querySelector("#coll-count").textContent.trim()));

  /* Jetzt hält das Deck ALLE drei Exemplare des Drucks. Dann müssen BEIDE
     Zeilen verschwinden — die Frage ist der Druck, nicht die Zeile. */
  await seite.evaluate(() => {
    DECKS[0].entries.find(e => e.cardId === "d0c3").qty = 3;
    renderCollection();
  });
  await seite.waitForTimeout(250);
  stand.gleich("hält das Deck alle Exemplare, gehen beide Zeilen des Drucks",
    await seite.evaluate(ZEILEN).then(z => [z.includes("d0c3"), z.includes("d0c3f")]),
    [false, false]);

  /* Und der Haken zählt zu den Filtern: Wer auf eine bestimmte Zeile springt,
     bekommt sie geräumt — sonst zeigte der Sprung ins Leere. */
  await seite.evaluate(() => sammlungFilterZuruecksetzen());
  await seite.waitForTimeout(150);
  stand.ist("Filter räumen nimmt den Haken mit",
    await seite.evaluate(() => document.querySelector("#f-nodeck").checked === false));

  await seite.evaluate(() => renderCollection());
  await seite.waitForTimeout(200);
  stand.ist("danach stehen wieder alle da",
    await seite.evaluate(ZEILEN).then(z => z.includes("d0c0") && z.includes("d0c3")));

  /* Die Knöpfe der Filterleiste stehen auf FELDHÖHE. Vorher maßen sie 45 px
     neben 40er-Auswahllisten — fünf Pixel, die niemand als Fehler meldet und
     jeder sieht. Gemessen, nicht aus Klassen gefolgert: Die Höhe entsteht
     aus Zeile + Polster + Rahmen, und jede der drei Stellgrößen kann sie
     still wieder auseinanderziehen. */
  const hoehen = await seite.evaluate(() => {
    const h = el => Math.round(el.getBoundingClientRect().height);
    return { select: h(document.getElementById("f-foil")),
             upd: h(document.getElementById("upd")),
             sell: h(document.getElementById("sell-open")),
             combos: h(document.getElementById("coll-combos")) };
  });
  stand.ist("die Filterknöpfe sind genau feldhoch",
    hoehen.upd === hoehen.select && hoehen.sell === hoehen.select
      && hoehen.combos === hoehen.select,
    JSON.stringify(hoehen));
}
