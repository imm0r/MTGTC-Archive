/* Karten von einer Kategorie in die andere ziehen — der Kern der
   Kartenansicht, und das Stück mit der längsten Pannengeschichte:

   * Der Namensbalken IST ein Bild, und ein Bild ist von Haus aus ziehbar. Der
     Browser startete seinen eigenen Zug und meldete unseren Zeiger mit
     pointercancel ab; die Fächer erschienen gar nicht.
   * Bewegung und Loslassen hingen am Element statt am Fenster. Ein Streifen
     ist 23 px hoch, die Zugschwelle 6 px — der Zeiger war draußen, bevor
     irgendetwas ankam.
   * setPointerCapture beim Drücken leitete den folgenden Klick um, und die
     Detailansicht ging nicht mehr auf.

   Keine dieser Pannen wurde je rot. Alle drei fielen beim Benutzen auf. */

import { AUFBAU, PUNKT, GREIFBAR } from "../hilfen.mjs";

export const name = "ziehen";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 14, kategorien: 3, decks: 2 });
  await seite.waitForTimeout(350);

  // Das Ablegen wird abgefangen: Ohne Datenbank käme sonst nur ein Fehlerton.
  await seite.evaluate(() => {
    window.ABGELEGT = null;
    window.katAbgelegt = (zug, ziel, zusatz) => {
      window.ABGELEGT = { deck: zug.deckId, karte: zug.cardId, von: zug.vonKat, ziel, zusatz };
      katZiehAus();
    };
  });

  stand.ist("die Bilder sind nicht browserseitig ziehbar",
    await seite.evaluate(() => [...document.querySelectorAll(".stapel-karte img")]
      .every(i => i.getAttribute("draggable") === "false" &&
                  getComputedStyle(i).webkitUserDrag === "none")),
    await seite.evaluate(() => document.querySelectorAll(".stapel-karte img").length + " Bilder"));

  /* --- Zug aus dem Streifen in eine andere Spalte ------------------------- */
  const quelle = seite.locator('.stapel-karte[data-id="d0c1"]').first();
  await quelle.scrollIntoViewIfNeeded();
  await seite.waitForTimeout(150);
  const q = await quelle.boundingBox();
  stand.ist("ein Streifen ist schmal (Zug muss am Fenster hängen)", q.height < 40,
    `${Math.round(q.height)} px hoch`);

  await seite.mouse.move(q.x + q.width * 0.6, q.y + 6);
  await seite.mouse.down();
  await seite.mouse.move(q.x + q.width * 0.6, q.y + 60, { steps: 8 });

  const beim = await seite.evaluate(() => ({
    fächer: !document.getElementById("kat-drop").hidden,
    schild: !!document.querySelector(".zieh-geist"),
    quelleMarkiert: !!document.querySelector(".stapel-karte.zieht"),
    schleier: getComputedStyle(document.getElementById("kat-drop")).pointerEvents,
    balken: getComputedStyle(document.querySelector(".katdrop-innen")).pointerEvents,
  }));
  stand.ist("die Fächer erscheinen", beim.fächer);
  stand.ist("das Schild hängt am Zeiger", beim.schild);
  stand.ist("die gezogene Karte ist markiert", beim.quelleMarkiert);
  stand.ist("der Schleier lässt den Zeiger durch", beim.schleier === "none", beim.schleier);
  stand.ist("der Balken fängt ihn ab", beim.balken === "auto", beim.balken);

  const ziel = await seite.evaluate(PUNKT, '.stapel-spalte[data-katdrop="d0k1"]');
  stand.ist("die Zielspalte ist erreichbar", !!ziel);
  if (ziel) {
    await seite.mouse.move(ziel.x, ziel.y, { steps: 8 });
    const hervor = await seite.evaluate(() => {
      const u = document.querySelectorAll(".ueber");
      return { anzahl: u.length, kat: u[0]?.dataset.katdrop ?? null, deck: u[0]?.dataset.dropdeck ?? null };
    });
    stand.gleich("genau ein Ziel leuchtet auf, das richtige",
      [hervor.anzahl, hervor.kat, hervor.deck], [1, "d0k1", "d0"]);
    await seite.mouse.up();
    await seite.waitForTimeout(120);
    stand.gleich("abgelegt wird im richtigen Fach des richtigen Decks",
      await seite.evaluate(() => window.ABGELEGT),
      { deck: "d0", karte: "d0c1", von: "d0k0", ziel: "d0k1", zusatz: false });
  }

  stand.gleich("nach dem Zug bleibt keine Markierung stehen",
    await seite.evaluate(() => ({
      ueber: document.querySelectorAll(".ueber").length,
      hat: document.querySelectorAll(".hat").length,
      zieht: document.querySelectorAll(".zieht").length,
      offen: !document.getElementById("kat-drop").hidden })),
    { ueber: 0, hat: 0, zieht: 0, offen: false });

  /* --- Ein Fach eines FREMDEN Decks nimmt nichts an ----------------------- */
  await seite.evaluate(() => { window.ABGELEGT = null; });
  // Damit die Spalten des zweiten Decks überhaupt im Baum stehen, beide öffnen.
  await seite.evaluate(() => { document.querySelectorAll(".deck-inhalt")
    .forEach(el => { el.style.display = "block"; }); });
  await seite.waitForTimeout(150);

  /* Beide Decks stehen nie gleichzeitig im Bild — allein die unterste Karte
     einer Spalte ist 310 px hoch. Also wird gezogen wie von Hand: oben
     anfassen, mit gedrückter Taste zum zweiten Deck scrollen, dort hinfahren.
     Dass der Zug das Scrollen übersteht, ist dabei die halbe Prüfung. */
  await seite.evaluate(() => scrollTo(0, 0));
  await seite.waitForTimeout(200);
  const q2 = await seite.evaluate(GREIFBAR, { raum: '.stapel-spalte[data-dropdeck="d0"]' });
  stand.ist("eine Quellkarte im ersten Deck ist anfassbar", !!q2, q2 ? q2.id : "keine im Bild");
  if (q2) {
    await seite.mouse.move(q2.x, q2.y);
    await seite.mouse.down();
    await seite.mouse.move(q2.x, q2.y + 60, { steps: 8 });

    await seite.evaluate(() => document.querySelector('.stapel-spalte[data-dropdeck="d1"]')
      .scrollIntoView({ block: "center" }));
    await seite.waitForTimeout(250);
    stand.ist("der Zug läuft nach dem Scrollen weiter",
      await seite.evaluate(() => !!document.querySelector(".stapel-karte.zieht")));

    // Erst JETZT das Ziel suchen: Der Fächerbalken steht erst beim Ziehen da
    // und kann den Punkt verdecken, den man vorher noch gefunden hätte.
    const fremd = await seite.evaluate(PUNKT, '.stapel-spalte[data-dropdeck="d1"]');
    stand.ist("ein Fach des zweiten Decks ist erreichbar", !!fremd);
    if (fremd) {
      await seite.mouse.move(fremd.x, fremd.y, { steps: 6 });
      stand.ist("ein fremdes Deck leuchtet nicht auf",
        await seite.evaluate(() => document.querySelectorAll(".ueber").length) === 0);
    }
    await seite.mouse.up();
    await seite.waitForTimeout(120);
    stand.ist("und nimmt auch nichts an",
      await seite.evaluate(() => window.ABGELEGT) === null);
  }
  await seite.evaluate(() => scrollTo(0, 0));
  await seite.waitForTimeout(200);

  /* --- Klick ohne Bewegung öffnet weiterhin die Detailansicht ------------- */
  await seite.evaluate(() => { window.DETAIL = 0; window.showCardDetail = () => window.DETAIL++; });
  const k = await seite.locator('.stapel-karte[data-id="d0c3"]').first().boundingBox();
  await seite.mouse.click(k.x + k.width * 0.6, k.y + 6);
  await seite.waitForTimeout(80);
  stand.gleich("ein Klick öffnet die Detailansicht",
    await seite.evaluate(() => ({ detail: window.DETAIL, fächer: !document.getElementById("kat-drop").hidden })),
    { detail: 1, fächer: false });

  /* --- Escape bricht ab --------------------------------------------------- */
  const e = await seite.locator('.stapel-karte[data-id="d0c4"]').first().boundingBox();
  await seite.mouse.move(e.x + e.width * 0.6, e.y + 6);
  await seite.mouse.down();
  await seite.mouse.move(e.x + e.width * 0.6, e.y + 60, { steps: 8 });
  await seite.keyboard.press("Escape");
  stand.gleich("Escape räumt alles weg",
    await seite.evaluate(() => ({ offen: !document.getElementById("kat-drop").hidden,
      ueber: document.querySelectorAll(".ueber").length })),
    { offen: false, ueber: 0 });
  await seite.mouse.up();
}
