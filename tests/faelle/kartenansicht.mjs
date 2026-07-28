/* Die Kartenansicht: klebende Spaltenköpfe, das Aufklappen beim Überfahren,
   und dass beides sich nicht ins Gehege kommt.

   Beide Punkte hier haben still versagt:

   * "body.zieht-gerade .stapel-gross{display:none}" stand im Stylesheet und
     wirkte NIE — zwei Klassen gegen die vier der Hover-Regel. Die Reihenfolge
     im Stylesheet entscheidet erst bei gleicher Spezifität. Der damalige
     Prüfpunkt las das erste .stapel-gross im Dokument, über dem gar keine Maus
     war, und meldete zufrieden "none": richtig aus dem falschen Grund.
     Deshalb wird hier BEIDES gemessen — ohne Zug muss aufklappen.

   * Die Spaltenköpfe klebten auf einer Höhe, die vor dem Umbruch der Leiste
     gemessen worden war, und lagen damit hinter ihr. Deshalb wird nicht die
     Höhe geprüft, sondern die Lage: unter der Leiste und im Bild. */

import { AUFBAU, GREIFBAR } from "../hilfen.mjs";

export const name = "kartenansicht";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 40, kategorien: 3 });
  await seite.waitForTimeout(400);

  stand.ist("kein Namenszettel an den Streifen",
    await seite.evaluate(() => [...document.querySelectorAll(".stapel-karte")]
      .every(el => !el.hasAttribute("title"))),
    await seite.evaluate(() => document.querySelectorAll(".stapel-karte").length + " Streifen"));

  /* --- Klebende Spaltenköpfe --------------------------------------------- */
  await seite.evaluate(() => scrollTo(0, 1400));
  await seite.waitForTimeout(250);
  const kleben = await seite.evaluate(() => {
    const sp = document.querySelector('.stapel-spalte[data-katdrop="d0k0"]');
    const kopf = sp.querySelector(".stapel-kopf");
    const kr = kopf.getBoundingClientRect(), sr = sp.getBoundingClientRect();
    const leiste = document.querySelector(".stapel-leiste").getBoundingClientRect();
    const seitenkopf = document.querySelector("header").getBoundingClientRect();
    return {
      position: getComputedStyle(kopf).position,
      spalteSchonOben: Math.round(sr.top),          // negativ = wir sind mitten drin
      kopfImBild: kr.top >= 0 && kr.bottom <= innerHeight,
      unterLeiste: Math.round(kr.top - leiste.bottom) >= 0,
      unterSeitenkopf: Math.round(kr.top - seitenkopf.bottom) >= -1,
      name: kopf.querySelector(".stapel-name")?.textContent,
    };
  });
  stand.ist("der Spaltenkopf klebt", kleben.position === "sticky", kleben.position);
  stand.ist("die Spalte ist längst hinausgescrollt", kleben.spalteSchonOben < 0,
    `Spaltenoberkante bei ${kleben.spalteSchonOben} px`);
  stand.ist("der Kopf steht trotzdem im Bild", kleben.kopfImBild);
  stand.ist("und zwar unter der Deckleiste, nicht dahinter", kleben.unterLeiste);
  stand.ist("und unter der Kopfzeile der Seite", kleben.unterSeitenkopf);
  stand.ist("er nennt weiter seinen Namen", !!kleben.name, kleben.name);

  /* Dasselbe im schmalen Fenster — und nur DAS sagt wirklich etwas aus.
     Ab 1000 px steht die Deckleiste auf height:0 und schwebt daneben; ein Kopf
     kann dort gar nicht hinter ihr liegen, die Behauptung oben ist also
     geschenkt. Unterhalb steht die Leiste in der Zeile, nimmt Platz weg, und
     genau hier lag der Fehler: Der Kopf klebte auf einer Höhe, die vor dem
     Umbruch der Leiste gemessen worden war. */
  await seite.setViewportSize({ width: 820, height: 900 });
  await seite.waitForTimeout(400);
  await seite.evaluate(() => scrollTo(0, 1400));
  await seite.waitForTimeout(300);
  const schmal = await seite.evaluate(() => {
    const kopf = document.querySelector('.stapel-spalte[data-katdrop="d0k0"] .stapel-kopf');
    const kr = kopf.getBoundingClientRect();
    const lr = document.querySelector(".stapel-leiste").getBoundingClientRect();
    return { leisteHoch: Math.round(lr.height), abstand: Math.round(kr.top - lr.bottom),
      // Gesetzt wird die Höhe am ELTERNTEIL der Leiste, nicht am Wurzelelement.
      gemessen: getComputedStyle(document.querySelector(".stapel-leiste").parentElement)
        .getPropertyValue("--leiste-hoehe").trim() };
  });
  stand.ist("im schmalen Fenster nimmt die Leiste Platz ein", schmal.leisteHoch > 20,
    `${schmal.leisteHoch} px hoch, gemerkt: ${schmal.gemessen || "—"}`);
  stand.ist("und der Spaltenkopf klebt darunter, nicht dahinter", schmal.abstand >= 0,
    `${schmal.abstand} px unter der Leiste`);

  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(300);
  await seite.evaluate(() => scrollTo(0, 0));
  await seite.waitForTimeout(250);

  /* --- Aufklappen: ohne Zug JA, mit Zug NEIN ------------------------------ */
  await seite.evaluate(() => { window.katAbgelegt = () => katZiehAus(); });
  const ziel = seite.locator('.stapel-karte[data-id="d0c8"]').first();
  await ziel.scrollIntoViewIfNeeded();
  await seite.waitForTimeout(250);
  const z = await ziel.boundingBox();

  await seite.mouse.move(z.x + z.width * 0.6, z.y + z.height / 2);
  await seite.waitForTimeout(250);
  const ohne = await seite.evaluate(() => {
    const k = document.querySelector('.stapel-karte[data-id="d0c8"]');
    return { auf: getComputedStyle(k.querySelector(".stapel-gross")).display,
             ueberfahren: k.matches(":hover") };
  });
  stand.ist("der Zeiger liegt wirklich darauf", ohne.ueberfahren);
  stand.ist("ohne Zug klappt die Karte auf", ohne.auf === "block", ohne.auf);

  /* Erst den Zeiger wegnehmen und die eben aufgeklappte Karte wieder
     zusammenfallen lassen. Sonst wird die Quelle in einem Zustand gemessen,
     den das Wegbewegen sofort aufhebt: d0c8 klappt zu, alles darunter rutscht
     nach oben, und gedrückt wird auf eine andere Karte — oder auf gar keine. */
  await seite.mouse.move(4, 4);
  await seite.waitForTimeout(250);

  const q = await seite.evaluate(GREIFBAR, { ausser: ["d0c8"] });
  stand.ist("eine andere Karte ist anfassbar", !!q, q ? q.id : "keine im Bild");
  await seite.mouse.move(q.x, q.y);
  await seite.mouse.down();
  await seite.mouse.move(q.x, q.y + 60, { steps: 8 });
  await seite.mouse.move(z.x + z.width * 0.6, z.y + z.height / 2, { steps: 8 });
  await seite.waitForTimeout(150);
  const mit = await seite.evaluate(() => ({
    auf: getComputedStyle(document.querySelector('.stapel-karte[data-id="d0c8"] .stapel-gross')).display,
    zieht: !!document.querySelector(".stapel-karte.zieht"),
  }));
  stand.ist("ein Zug läuft überhaupt", mit.zieht);
  stand.ist("mit Zug klappt nichts auf", mit.auf === "none", mit.auf);
  await seite.mouse.up();

  /* --- Die letzte Karte liegt immer offen -------------------------------- */
  stand.ist("die unterste Karte einer Spalte ist ganz zu sehen",
    await seite.evaluate(() => {
      const karten = document.querySelectorAll('.stapel-spalte[data-katdrop="d0k0"] .stapel-karte');
      const letzte = karten[karten.length - 1];
      const f = getComputedStyle(letzte.querySelector(".stapel-fenster"));
      // 63:88 statt des beschnittenen 8:1
      return Math.abs(parseFloat(f.aspectRatio.split("/")[0]) / parseFloat(f.aspectRatio.split("/")[1]) - 63 / 88) < 0.01;
    }));
}
