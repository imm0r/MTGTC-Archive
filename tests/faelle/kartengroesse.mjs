/* Die Darstellungsgröße der Karten in der Kartenansicht.

   Ein Regler über den Karten stellt ein, wie groß sie erscheinen. Vier Dinge
   daran gehen still daneben:

   * ZIEHEN DARF NICHTS NEU ZEICHNEN. Die Größe hängt als CSS-Variable am
     Wurzelelement; würde stattdessen renderDecks() laufen, risse jede
     Bewegung die Liste unter dem Finger weg und verlöre die Scrollposition.
     Ein Regler, bei dem man nach jeder Bewegung zurückscrollen muss, ist
     unbenutzbar — und trotzdem sähe die eingestellte Größe richtig aus.
   * SIE GILT FÜR ALLE DECKS. Gruppierung und Ansicht beantworten eine Frage
     über DIESES Deck; die Größe eine über den Betrachter. Je Deck gemerkt
     hieße, sie dreißigmal einzustellen.
   * SIE MUSS DAS NEULADEN ÜBERSTEHEN und dabei GLEICH anliegen. Wird die
     Variable erst beim ersten Ziehen gesetzt, springen die Karten von der
     Vorgabe auf den gemerkten Wert, sobald man den Regler anfasst.
   * DIE SPALTE DARF NICHT AUS DEM KASTEN LAUFEN. Ein Raster rollt nicht von
     sich aus; eine Spalte, die breiter eingestellt ist als das Fenster, läuft
     seitlich hinaus, ohne dass ein Rollbalken erschiene. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "kartengroesse";

/* Deck aufklappen und auf Kartenansicht stellen. */
const KARTENANSICHT = () => {
  deckAnsicht.setze(DECKS[0].id, "karten");
  if (!deckOffen.ist(DECKS[0].id)) deckOffen.schalte(DECKS[0].id);
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  renderDecks();
};

const MESSEN = () => {
  const sp = document.querySelector(".stapel-spalte");
  const bild = document.querySelector(".stapel-fenster");
  const r = document.querySelector("[data-stapelbreite]");
  return {
    spalte: Math.round(sp?.getBoundingClientRect().width || 0),
    bild: Math.round(bild?.getBoundingClientRect().width || 0),
    regler: r ? Number(r.value) : null,
    zahl: r?.parentElement.querySelector("output")?.textContent || null,
    variable: getComputedStyle(document.documentElement).getPropertyValue("--stapel-breite").trim(),
  };
};

const ZIEHE = (v) => {
  const r = document.querySelector("[data-stapelbreite]");
  r.value = v;
  r.dispatchEvent(new Event("input", { bubbles: true }));
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 14, kategorien: 3, decks: 2 });
  await seite.waitForTimeout(300);

  /* --- Nur in der Kartenansicht --------------------------------------- */
  /* In der Tabelle gibt es keine Kartengröße einzustellen. Ein Regler, der
     dort stünde und nichts täte, wäre schlimmer als keiner. */
  await seite.evaluate(() => {
    deckAnsicht.setze(DECKS[0].id, "tabelle");
    if (!deckOffen.ist(DECKS[0].id)) deckOffen.schalte(DECKS[0].id);
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
    renderDecks();
  });
  await seite.waitForTimeout(300);
  /* An DIESEM Deck, nicht irgendwo im Dokument: Die Attrappe stellt das zweite
     Deck von sich aus auf Kartenansicht, und dessen Regler stünde sonst hier
     als Treffer da. */
  stand.ist("in der Tabellenansicht steht kein Regler",
    await seite.evaluate(() =>
      !document.querySelector(`[data-stapelbreite="${DECKS[0].id}"]`)));
  stand.ist("beim Deck daneben, das auf Karten steht, dagegen schon",
    await seite.evaluate(() =>
      !!document.querySelector(`[data-stapelbreite="${DECKS[1].id}"]`)));

  await seite.evaluate(KARTENANSICHT);
  await seite.waitForTimeout(400);
  const vorgabe = await seite.evaluate(MESSEN);
  stand.ist("in der Kartenansicht steht einer", vorgabe.regler !== null);
  stand.gleich("er beginnt bei der Vorgabe", [vorgabe.regler, vorgabe.variable], [210, "210px"]);
  stand.gleich("und die Zahl daneben sagt dasselbe", vorgabe.zahl, "210 px");

  /* --- Er ändert wirklich die Größe ------------------------------------ */
  /* Gemessen am BILD und nicht am Regler: Dass ein Schieber sich schieben
     lässt, sagt nichts darüber, ob dabei etwas geschieht. */
  await seite.evaluate(ZIEHE, 140);
  await seite.waitForTimeout(250);
  const bei140 = await seite.evaluate(MESSEN);
  await seite.evaluate(ZIEHE, 420);
  await seite.waitForTimeout(250);
  const bei420 = await seite.evaluate(MESSEN);

  stand.ist("klein gestellt wird das Kartenbild schmaler",
    bei140.bild < vorgabe.bild, `${vorgabe.bild} → ${bei140.bild} px`);
  stand.ist("groß gestellt deutlich breiter",
    bei420.bild > vorgabe.bild * 2, `${vorgabe.bild} → ${bei420.bild} px`);
  stand.gleich("die Zahl daneben zieht mit", [bei140.zahl, bei420.zahl], ["140 px", "420 px"]);
  stand.gleich("und die Variable am Wurzelelement auch",
    [bei140.variable, bei420.variable], ["140px", "420px"]);

  /* --- Ziehen zeichnet NICHT neu --------------------------------------- */
  /* Der Punkt, an dem es unbenutzbar würde, ohne falsch auszusehen: Ein
     renderDecks() bei jeder Bewegung ersetzt den ganzen Baum. Geprüft an der
     IDENTITÄT eines Knotens — er muss derselbe bleiben. */
  const bleibt = await seite.evaluate(() => {
    const vorher = document.querySelector(".stapel-karte");
    vorher.dataset.merkzeichen = "ja";
    const r = document.querySelector("[data-stapelbreite]");
    r.value = 300;
    r.dispatchEvent(new Event("input", { bubbles: true }));
    const nachher = document.querySelector(".stapel-karte");
    return { selber: vorher === nachher, zeichenDa: nachher?.dataset.merkzeichen === "ja" };
  });
  stand.ist("beim Ziehen bleibt der Baum stehen", bleibt.selber && bleibt.zeichenDa,
    JSON.stringify(bleibt));

  /* --- Sie gilt für ALLE Decks ----------------------------------------- */
  await seite.evaluate(() => {
    DECKS.forEach(d => deckAnsicht.setze(d.id, "karten"));
    DECKS.forEach(d => { if (!deckOffen.ist(d.id)) deckOffen.schalte(d.id); });
    renderDecks();
  });
  await seite.waitForTimeout(400);
  stand.gleich("jedes offene Deck trägt denselben Stand",
    await seite.evaluate(() =>
      [...document.querySelectorAll("[data-stapelbreite]")].map(r => Number(r.value))),
    [300, 300]);

  /* Und ein Zug an EINEM Regler stellt die anderen mit — sonst stünden zwei
     verschiedene Zahlen für dieselbe Einstellung da. */
  await seite.evaluate(ZIEHE, 250);
  await seite.waitForTimeout(250);
  stand.gleich("ein Zug an einem stellt alle",
    await seite.evaluate(() =>
      [...document.querySelectorAll("[data-stapelbreite]")].map(r =>
        r.value + "|" + r.parentElement.querySelector("output").textContent)),
    ["250|250 px", "250|250 px"]);

  /* --- Grenzen --------------------------------------------------------- */
  /* Ein gespeicherter Unsinn (von Hand, aus einer älteren Fassung) darf die
     Ansicht nicht sprengen. */
  stand.gleich("gespeicherte Ausreißer werden zurechtgestutzt",
    await seite.evaluate(() => {
      const raus = [];
      for (const w of [5, 9999, 0, -40]) {
        localStorage.setItem("mtg-stapel-breite", String(w));
        raus.push(deckKartenBreite.lies());
      }
      localStorage.setItem("mtg-stapel-breite", "250");
      return raus;
    }), [140, 420, 210, 140]);

  /* --- Neuladen -------------------------------------------------------- */
  /* Und zwar SOFORT anliegend: Wird die Variable erst beim ersten Ziehen
     gesetzt, springen die Karten, sobald man den Regler anfasst. */
  await seite.reload({ waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 14, kategorien: 3, decks: 2 });
  await seite.waitForTimeout(300);
  stand.gleich("die Größe steht schon vor dem ersten Blick auf ein Deck",
    await seite.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--stapel-breite").trim()),
    "250px");
  await seite.evaluate(KARTENANSICHT);
  await seite.waitForTimeout(400);
  const nachNeu = await seite.evaluate(MESSEN);
  stand.gleich("und der Regler steht dort, wo man ihn gelassen hat",
    [nachNeu.regler, nachNeu.zahl], [250, "250 px"]);

  /* --- Nichts läuft aus dem Kasten ------------------------------------- */
  /* Im schmalen Fenster mit größter Einstellung: Ein Raster rollt nicht von
     sich aus — eine zu breite Spalte liefe seitlich hinaus, ohne Rollbalken. */
  await seite.setViewportSize({ width: 380, height: 800 });
  await seite.evaluate(ZIEHE, 420);
  await seite.waitForTimeout(300);
  stand.ist("auch groß gestellt bleibt die Spalte im schmalen Fenster",
    await seite.evaluate(() => {
      const raster = document.querySelector(".deck-stapel");
      const sp = document.querySelector(".stapel-spalte");
      return sp.getBoundingClientRect().right <= raster.getBoundingClientRect().right + 1;
    }),
    await seite.evaluate(() => {
      const raster = document.querySelector(".deck-stapel");
      const sp = document.querySelector(".stapel-spalte");
      return `Spalte bis ${Math.round(sp.getBoundingClientRect().right)}, Raster bis ${Math.round(raster.getBoundingClientRect().right)}`;
    }));
  await seite.setViewportSize({ width: 1500, height: 900 });
}
