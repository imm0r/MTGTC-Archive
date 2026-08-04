/* Die Deckliste: höchstens ein Deck aufgeklappt, und die Truhe nimmt Karten
   aus dem Deck.

   Die Ein-Deck-Regel hat zwei Hälften, die auseinanderlaufen können: den
   gemerkten Zustand (localStorage) und den Baum. Die Kopfzeile zeichnet
   absichtlich NICHT neu, wenn man sie anklickt — das verlöre die
   Scrollposition —, sondern zieht den Baum von Hand nach. Genau dort ist die
   Stelle, an der beides auseinanderfallen kann. */

import { AUFBAU, PUNKT } from "../hilfen.mjs";

export const name = "decks";

const stand_lesen = () => ({
  gemerkt: JSON.parse(localStorage.getItem("mtg-decks-offen") || "[]"),
  offen: [...document.querySelectorAll("#deck-list .deck-kopf")]
    .filter(k => k.parentElement.querySelector(".deck-inhalt").style.display !== "none")
    .map(k => k.dataset.toggle),
  // Der Pfeil ist ein Symbol, kein Textzeichen mehr: gelesen wird die
  // Kennung, auf die er verweist (ic-pfeil-ab = offen, ic-pfeil-rechts = zu).
  pfeile: [...document.querySelectorAll("#deck-list .deck-pfeil use")]
    .map(u => u.getAttribute("href").replace("#ic-pfeil-", "")),
});

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  // Altbestand: drei offene Decks im Speicher. Muss sich beim Zeichnen heilen.
  await seite.evaluate(() => localStorage.setItem("mtg-decks-offen", JSON.stringify(["d0", "d1", "d2"])));
  await seite.evaluate((o) => {
    // AUFBAU setzt den Speicher selbst — hier absichtlich danach überschreiben.
    const eigen = (0, eval)("(" + o.fn + ")");
    eigen(o.arg);
    localStorage.setItem("mtg-decks-offen", JSON.stringify(["d0", "d1", "d2"]));
    renderDecks();
  }, { fn: AUFBAU.toString(), arg: { karten: 6, kategorien: 2, decks: 3 } });
  await seite.waitForTimeout(350);

  stand.gleich("von drei gemerkten Decks steht genau eines offen",
    (await seite.evaluate(stand_lesen)).offen, ["d0"]);

  await seite.locator('.deck-kopf[data-toggle="d1"]').click();
  await seite.waitForTimeout(250);
  const nachB = await seite.evaluate(stand_lesen);
  stand.gleich("ein Klick auf das zweite schließt das erste", nachB.offen, ["d1"]);
  stand.gleich("und der gemerkte Zustand stimmt damit überein", nachB.gemerkt, ["d1"]);
  stand.gleich("auch die Pfeile", nachB.pfeile, ["rechts", "ab", "rechts"]);

  await seite.locator('.deck-kopf[data-toggle="d1"]').click();
  await seite.waitForTimeout(250);
  const zu = await seite.evaluate(stand_lesen);
  stand.gleich("ein zweiter Klick schließt alles", [zu.offen, zu.gemerkt], [[], []]);

  /* --- Die Truhe --------------------------------------------------------- */
  await seite.locator('.deck-kopf[data-toggle="d0"]').click();
  await seite.waitForTimeout(300);
  await seite.evaluate(() => { window.RAUS = null;
    window.karteAusDeckWerfen = (deck, karte) => { window.RAUS = { deck, karte }; }; });

  const q = seite.locator('.stapel-karte[data-id="d0c1"]').first();
  await q.scrollIntoViewIfNeeded();
  await seite.waitForTimeout(200);
  const box = await q.boundingBox();
  await seite.mouse.move(box.x + box.width * 0.6, box.y + 6);
  await seite.mouse.down();
  await seite.mouse.move(box.x + box.width * 0.6, box.y + 60, { steps: 8 });

  const truhe = await seite.evaluate(() => {
    const t = document.querySelector(".katdrop-muell");
    const r = t.getBoundingClientRect();
    return { sichtbar: getComputedStyle(t).display !== "none",
      ziel: t.dataset.katdrop,
      ereignisse: getComputedStyle(t).pointerEvents,
      bildDa: (() => { const i = t.querySelector(".katdrop-muell-bild");
        return !!i && i.complete && i.naturalWidth > 0; })(),
      trifftSichSelbst: t.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      ueberschneidetBalken: (() => {
        const b = document.querySelector(".katdrop-innen").getBoundingClientRect();
        return !(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom);
      })() };
  });
  stand.ist("die Truhe erscheint beim Ziehen", truhe.sichtbar);
  stand.ist("sie trägt ihr Bild", truhe.bildDa);
  stand.ist("sie nimmt Zeigereignisse an", truhe.ereignisse === "auto" && truhe.trifftSichSelbst);
  stand.ist("sie liegt nicht unter dem Balken", !truhe.ueberschneidetBalken);

  const p = await seite.evaluate(PUNKT, ".katdrop-muell");
  if (p) {
    await seite.mouse.move(p.x, p.y, { steps: 6 });
    stand.ist("sie leuchtet auf",
      await seite.evaluate(() => !!document.querySelector(".katdrop-muell.ueber")));
    await seite.mouse.up();
    await seite.waitForTimeout(120);
    stand.gleich("und wirft die richtige Karte aus dem richtigen Deck",
      await seite.evaluate(() => window.RAUS), { deck: "d0", karte: "d0c1" });
  } else {
    stand.ist("die Truhe ist erreichbar", false, "kein Punkt darauf gefunden");
  }
}
