/* Wunschliste: eine Karte direkt vormerken, ohne Umweg über ein Deck.

   Eine Wunschzeile ist eine gewöhnliche Sammlungszeile mit BESTAND 0 — genau
   das listet die Wunschliste. Daran hängen drei Dinge, die still schiefgehen
   können:

   * DIE ZEILE. Bestand 0, Zustand NM, kein Foil, Setcode GROSS. Ein klein
     geschriebener Setcode ist der Klassiker: Die gescannte Karte trägt „LTR",
     die Wunschzeile „ltr", und jeder Vergleich über Set + Nummer geht ins
     Leere — die Karte gilt dann als nie gekauft.
   * DIE DOPPELPRÜFUNG. Ein Wunsch für eine Karte, die man in einer ANDEREN
     Auflage besitzt, würde vom Wunschabgleich beim nächsten Zugang wieder
     gelöscht (er hält ihn für erfüllt). Ihn anzulegen hieße, eine Zeile zu
     schreiben, die still wieder verschwindet.
   * DER PREIS. Er ist der Grund, eine Wunschliste zu führen, und muss mit dem
     ersten Punkt der Historie in die Zeile.

   Was hier NICHT geprüft werden kann, ist das Nachschlagen bei Scryfall und
   das Schreiben — beides braucht Netz bzw. Datenbank. Für beides hängt der
   Fall eine Attrappe ein, wie es die anderen Fälle mit zoneSchreiben() und
   wurfSpeichern() tun. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "wunschliste";

/* Eine Scryfall-Karte, wie sie von findCard() käme. Setcode klein — genau so
   liefert Scryfall ihn, und genau das muss die Zeile geraderücken. */
const KARTE = {
  id: "sf-blitz", oracle_id: "or-blitz", name: "Lightning Bolt",
  set: "ltr", set_name: "Tales of Middle-earth", collector_number: "123",
  lang: "en", cmc: 1, mana_cost: "{R}", type_line: "Instant", rarity: "common",
  released_at: "2023-06-23", colors: ["R"], keywords: [],
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  cardmarket_id: 4242, prices: { eur: "2.50" },
  image_uris: { small: "https://example.invalid/b.jpg" },
};

const AUFSTELLUNG = (karte) => {
  window.KARTE = karte;
  // Die Filterleiste und der Wunsch-Knopf hängen an wireApp(), und das läuft im
  // Start nur MIT Datenbank-Zugang. Hier von Hand — sonst prüfte der Fall
  // Schaltflächen, an denen nichts hängt.
  wireApp();
  // Attrappen für die beiden Wege nach draußen: Scryfall und die Datenbank.
  window.GESCHRIEBEN = [];
  window.wunschKarteFinden = async (v) => (/blitz|bolt|ltr/i.test(v) ? window.KARTE : null);
  window.wunschSchreiben = async (zeile) => { window.GESCHRIEBEN.push(zeile); };
  // reload() liest die Datenbank; ohne sie schlüge es fehl und verdeckte das
  // Ergebnis. Der Fall prüft, WAS geschrieben würde — nicht das Nachladen.
  window.reload = async () => {};
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-wish"));
  renderWunschliste();
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 4, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(AUFSTELLUNG, KARTE);
  await seite.waitForTimeout(250);

  /* --- Die Eingabe steht da, und nur in der Wunschliste ------------------ */
  stand.gleich("Feld und Knopf stehen in der Wunschliste, nicht in der Sammlung",
    await seite.evaluate(() => ({
      feld: document.querySelectorAll("#v-wish #wish-add").length,
      knopf: document.querySelectorAll("#v-wish #wish-add-btn").length,
      inSammlung: document.querySelectorAll("#v-coll #wish-add").length,
      // Die Vorschlagsliste braucht einen Bezugsrahmen, sonst klappt sie
      // irgendwo auf der Seite auf statt unter dem Feld.
      bezug: getComputedStyle(document.querySelector("#wish-add").parentElement).position,
    })),
    { feld: 1, knopf: 1, inSammlung: 0, bezug: "relative" });

  /* --- Die Zeile, die geschrieben würde --------------------------------- */
  const zeile = await seite.evaluate(() => wunschZeile(window.KARTE));
  stand.gleich("Bestand 0 — genau das ist eine Wunschzeile", zeile.qty, 0);
  stand.gleich("Zustand und Ausführung sind Vorgaben (das entscheidet der Kauf)",
    [zeile.condition, zeile.foil], ["NM", false]);
  stand.gleich("der Setcode steht GROSS in der Zeile", zeile.set_code, "LTR");
  stand.gleich("Preis und erster Punkt der Historie stehen drin",
    [zeile.price, zeile.hist.length, zeile.hist[0]?.v], [2.5, 1, 2.5]);
  stand.gleich("die Produkt-ID kommt mit — der Kauflink zeigt damit auf die Auflage",
    zeile.cm_id, 4242);
  stand.gleich("Name, Auflage und Nummer stehen drin",
    [zeile.name, zeile.cn, zeile.set_name], ["Lightning Bolt", "123", "Tales of Middle-earth"]);

  /* --- Was schon da ist, kommt nicht noch einmal ------------------------- */
  const doppelt = await seite.evaluate(() => {
    const probe = (o) => { CARDS.push(o); const r = wunschSchonDa(window.KARTE); CARDS.pop(); return r?.grund ?? null; };
    return {
      leer: wunschSchonDa(window.KARTE)?.grund ?? null,
      // Dieselbe Auflage, besessen.
      selbeAuflage: probe({ id: "x1", qty: 2, set: "LTR", cn: "123",
                            oracle_id: "or-blitz", name: "Lightning Bolt", disp: "Lightning Bolt" }),
      // ANDERE Auflage, besessen — der Wunschabgleich löschte den Wunsch sonst
      // beim nächsten Zugang wieder.
      andereAuflage: probe({ id: "x2", qty: 1, set: "M10", cn: "146",
                             oracle_id: "or-blitz", name: "Lightning Bolt", disp: "Lightning Bolt" }),
      // Steht schon auf der Wunschliste.
      schonWunsch: probe({ id: "x3", qty: 0, set: "LTR", cn: "123",
                           oracle_id: "or-blitz", name: "Lightning Bolt", disp: "Lightning Bolt" }),
      // Eine ganz andere Karte stört nicht.
      fremd: probe({ id: "x4", qty: 3, set: "LTR", cn: "999",
                     oracle_id: "or-anders", name: "Sol Ring", disp: "Sol Ring" }),
    };
  });
  stand.gleich("in leerer Sammlung ist nichts im Weg", doppelt.leer, null);
  stand.gleich("dieselbe Auflage besessen → besitzt du schon", doppelt.selbeAuflage, "besitzt");
  stand.gleich("ANDERE Auflage besessen → ebenfalls (sonst verschwände der Wunsch wieder)",
    doppelt.andereAuflage, "besitzt");
  stand.gleich("steht schon als Wunsch → nicht doppelt", doppelt.schonWunsch, "wunsch");
  stand.gleich("eine fremde Karte stört nicht", doppelt.fremd, null);

  /* --- Der ganze Weg über die Oberfläche -------------------------------- */
  stand.ist("ein leeres Feld schreibt nichts", await seite.evaluate(async () => {
    await wunschHinzufuegen();
    return window.GESCHRIEBEN.length === 0;
  }));

  await seite.locator("#wish-add").fill("Lightning Bolt");
  await seite.locator("#wish-add-btn").click();
  await seite.waitForTimeout(400);
  const nach = await seite.evaluate(() => ({
    anzahl: window.GESCHRIEBEN.length,
    name: window.GESCHRIEBEN[0]?.name,
    menge: window.GESCHRIEBEN[0]?.qty,
    feldLeer: document.querySelector("#wish-add").value === "",
    meldung: document.querySelector("#toast")?.textContent || "",
  }));
  stand.gleich("ein Klick legt genau eine Wunschzeile an",
    [nach.anzahl, nach.name, nach.menge], [1, "Lightning Bolt", 0]);
  stand.ist("das Feld ist danach leer — die nächste Karte kann sofort hinein", nach.feldLeer);
  stand.ist("und es steht in der Meldung, was passiert ist",
    /Lightning Bolt/.test(nach.meldung), nach.meldung);

  /* Jetzt liegt sie in der Sammlung (Bestand 0) — ein zweiter Versuch muss
     abgewiesen werden, sonst stünde sie doppelt auf der Liste. */
  await seite.evaluate(() => { CARDS.push({ ...wunschZeile(window.KARTE), id: "neu",
    set: "LTR", disp: "Lightning Bolt" }); });
  await seite.locator("#wish-add").fill("Lightning Bolt");
  await seite.locator("#wish-add-btn").click();
  await seite.waitForTimeout(400);
  const zweit = await seite.evaluate(() => ({
    anzahl: window.GESCHRIEBEN.length,
    meldung: document.querySelector("#toast")?.textContent || "",
  }));
  stand.gleich("ein zweiter Versuch schreibt nichts", zweit.anzahl, 1);
  stand.ist("und sagt, dass sie schon auf der Liste steht",
    /schon/.test(zweit.meldung), zweit.meldung);

  /* Und was Scryfall nicht kennt, wird gemeldet statt still verschluckt. */
  await seite.locator("#wish-add").fill("Gibtsnichtkarte");
  await seite.locator("#wish-add-btn").click();
  await seite.waitForTimeout(400);
  const unbekannt = await seite.evaluate(() => ({
    anzahl: window.GESCHRIEBEN.length,
    meldung: document.querySelector("#toast")?.textContent || "",
    // Der Text bleibt stehen: Man will ihn verbessern, nicht neu tippen.
    feld: document.querySelector("#wish-add").value,
  }));
  stand.gleich("eine unbekannte Karte schreibt nichts", unbekannt.anzahl, 1);
  stand.ist("und wird gemeldet", /Gibtsnichtkarte/.test(unbekannt.meldung), unbekannt.meldung);
  stand.gleich("die Eingabe bleibt zum Verbessern stehen", unbekannt.feld, "Gibtsnichtkarte");
}
