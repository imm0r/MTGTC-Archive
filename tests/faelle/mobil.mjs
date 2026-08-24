/* Handy-Breite: keine Ansicht darf waagerecht überlaufen.

   Warum es diesen Fall braucht. Alle anderen Prüfungen laufen bei 1600 × 900
   (siehe lauf.mjs) — am Schreibtisch also, wo Platz im Überfluss ist. Was auf
   einem Telefon zerbricht, sieht dort tadellos aus, und genau so ist es
   passiert: Die Knopfleiste im Deck-Kopf (.deck-manage) steht in einer
   Flex-Zeile ohne Umbruch auf flex:none, schrumpft also nie. Fünf beschriftete
   Knöpfe messen zusammen rund 580 px. Auf einem 390er Schirm schob das die
   ganze Seite 256 px zur Seite UND presste den Titelblock daneben auf
   Restbreite, sodass „8 Karten · 8,00 €" mit einem Wort je Zeile untereinander
   stand. Niemandem fiel es auf, weil kein Prüflauf je schmal gemessen hat.

   Waagerechtes Scrollen ist auf einem Telefon nicht eine Unschönheit unter
   vielen, sondern der Unterschied zwischen benutzbar und unbenutzbar: Jede
   Wischgeste zieht die Seite seitlich weg, und die halbe Oberfläche liegt
   außerhalb des Bildes.

   Bewusst ALLE Ansichten, nicht nur die Decks: Der nächste zu breite Kasten
   entsteht woanders, und diese Prüfung soll ihn fangen, ohne dass jemand sie
   dafür erweitern muss.

   Ausgenommen sind Kästen, die absichtlich seitlich rollen (.xscroll um die
   Tabellen) — dort ist der Überlauf INNEN gewollt und die Seite bleibt ruhig. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "mobil";

const HANDY = { width: 390, height: 844 };   // iPhone 12/13/14, ein gängiges Maß

/* Läuft IM BROWSER: die Seite selbst und die breitesten Ausreißer darin. */
const MESSEN = () => {
  const vw = document.documentElement.clientWidth;
  const raus = [];
  for (const el of document.querySelectorAll(".view.on *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    // Absichtliche Roll-Kästen: dort gehört die Breite hin.
    if (el.closest(".xscroll, [style*='overflow-x:auto']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right > vw + 1) {
      const t = el.tagName.toLowerCase();
      const kl = typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      raus.push({ el: t + (el.id ? "#" + el.id : "") + kl, breite: Math.round(r.width) });
    }
  }
  return { ueberlauf: document.documentElement.scrollWidth - vw, raus: raus.slice(0, 3) };
};

export default async function ({ seite, adresse, stand }) {
  await seite.setViewportSize(HANDY);
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 8, kategorien: 2, decks: 2 });
  await seite.waitForTimeout(300);

  const ansichten = await seite.evaluate(() => [...document.querySelectorAll(".view")].map(v => v.id));
  stand.ist("die Ansichten stehen", ansichten.length > 5, ansichten.length + " Ansichten");

  const schuldige = [];
  for (const id of ansichten) {
    await seite.evaluate(vid => {
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === vid));
      window.scrollTo(0, 0);
    }, id);
    await seite.waitForTimeout(120);
    const m = await seite.evaluate(MESSEN);
    if (m.ueberlauf > 1) {
      schuldige.push(`${id}: ${m.ueberlauf}px` +
        (m.raus.length ? ` (${m.raus.map(r => `${r.el} ${r.breite}px`).join(", ")})` : ""));
    }
  }
  stand.gleich(`keine der ${ansichten.length} Ansichten läuft bei ${HANDY.width}px seitlich über`,
    schuldige, []);

  /* Und die Stelle, an der es zerbrach, ausdrücklich: Der Deckname soll die
     Breite bekommen, nicht die Knopfleiste. Ein Titelblock, der schmaler ist
     als ein Drittel des Schirms, bricht wieder Wort für Wort um — das ist die
     Schwelle, die den alten Zustand von einem gesunden trennt (gemessen lag er
     bei rund 66 px, gesund sind es über 280). */
  await seite.evaluate(() => {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  });
  await seite.waitForTimeout(150);
  const kopf = await seite.evaluate(() => {
    const k = document.querySelector(".deck-kopf");
    if (!k) return null;
    const titel = k.querySelector("h3");
    const leiste = k.querySelector(".deck-manage");
    return {
      titelBreite: titel ? Math.round(titel.getBoundingClientRect().width) : 0,
      // Ein h3, das in EINER Zeile steht, ist so hoch wie seine Zeilenhöhe.
      titelZeilen: titel ? Math.round(titel.getBoundingClientRect().height /
        parseFloat(getComputedStyle(titel).lineHeight || "20")) : 0,
      leisteRechts: leiste ? Math.round(leiste.getBoundingClientRect().right) : 0,
      breite: document.documentElement.clientWidth,
    };
  });
  stand.ist("der Deck-Kopf steht", !!kopf, JSON.stringify(kopf));
  if (kopf) {
    stand.ist("der Deckname bekommt die Breite, nicht die Knopfleiste",
      kopf.titelBreite > kopf.breite / 3, `${kopf.titelBreite}px von ${kopf.breite}px`);
    stand.ist("und steht auf einer Zeile", kopf.titelZeilen <= 1, kopf.titelZeilen + " Zeilen");
    stand.ist("die Knopfleiste bleibt im Bild",
      kopf.leisteRechts <= kopf.breite + 1, `rechts bis ${kopf.leisteRechts}px`);
  }
}
