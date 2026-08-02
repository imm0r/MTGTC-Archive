/* Synergie-Vorschläge je Deck aufheben.

   Der Anlass ist eine Selbstverletzung der App: Ein Lauf kostet Anfragen an
   Scryfall, die KI-Variante Tokens — und war beim nächsten Neuzeichnen weg.
   Ein Neuzeichnen löst aber schon aus, wer eine der vorgeschlagenen Karten ins
   Deck legt. Genau der Handgriff, für den man die Vorschläge geholt hat, warf
   sie also fort.

   Vier Dinge können daran still schiefgehen:

   * DIE SCHLANKE KARTE. Gespeichert wird nicht die ganze Scryfall-Antwort,
     sondern was Kachel und „+"-Knopf brauchen. Fehlt dort ein Feld, sieht man
     es nicht an einem Fehler, sondern an einer Kachel ohne Bild — oder an
     einer Wunschkarte ohne Auflage.
   * DER FINGERABDRUCK. Er sagt, ob das Deck sich seit dem Lauf geändert hat.
     Fehlt der Hinweis, liest man alte Vorschläge als aktuelle.
   * DAS ZURÜCKZEICHNEN. Es darf einen laufenden oder frisch fertigen Lauf
     NICHT überschreiben — sonst ersetzte der alte Stand die neuen Vorschläge
     in dem Augenblick, in dem sie fertig sind.
   * DER SCHNITT-VORSCHLAG wird beim Anzeigen NEU gerechnet, nicht mitgespeichert:
     Er gilt fürs jetzige Deck, nicht für das von damals. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "synergien";

/* Eine Scryfall-Karte, wie sie aus der Suche käme — mit reichlich Beiwerk,
   das NICHT mitgespeichert werden soll. */
const KARTE = {
  id: "sf-sol", oracle_id: "or-sol", name: "Sol Ring",
  type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.",
  mana_cost: "{1}", cmc: 1, colors: [], color_identity: [], keywords: [],
  rarity: "uncommon", set: "cmr", set_name: "Commander Legends",
  collector_number: "472", lang: "en", released_at: "2020-11-20",
  cardmarket_id: 12345, scryfall_uri: "https://scryfall.invalid/sol",
  edhrec_rank: 1,
  prices: { eur: "1.20", eur_foil: "3.40", usd: "1.50", tix: "0.02" },
  image_uris: { small: "https://img.invalid/s.jpg", normal: "https://img.invalid/n.jpg",
                large: "https://img.invalid/l.jpg", png: "https://img.invalid/p.png" },
  // Beiwerk, das gehen soll:
  legalities: { standard: "not_legal", commander: "legal" },
  all_parts: [{ id: "x" }], rulings_uri: "https://ru.invalid",
  purchase_uris: { tcgplayer: "https://tcg.invalid" },
};

const AUFSTELLUNG = (karte) => {
  window.KARTE = karte;
  window.GESCHRIEBEN = [];
  window.synErgebnisSchreiben = async (zeile) => { window.GESCHRIEBEN.push(zeile); };
  USER = { id: "u0" };
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  renderDecks();
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 6, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(AUFSTELLUNG, KARTE);
  await seite.waitForTimeout(200);

  /* --- Die schlanke Karte ----------------------------------------------- */
  const schlank = await seite.evaluate(() => synKarteSchlank(window.KARTE));
  stand.gleich("was die Kachel braucht, steht drin",
    [schlank.id, schlank.name, schlank.type_line, schlank.image_uris?.small, schlank.scryfall_uri],
    ["sf-sol", "Sol Ring", "Artifact", "https://img.invalid/s.jpg", "https://scryfall.invalid/sol"]);
  stand.gleich("was der „+\"-Knopf braucht, ebenso",
    [schlank.set, schlank.collector_number, schlank.lang, schlank.oracle_id, schlank.cmc],
    ["cmr", "472", "en", "or-sol", 1]);
  stand.gleich("die beiden Preise, die synPreis() liest",
    [schlank.prices.eur, schlank.prices.eur_foil], ["1.20", "3.40"]);
  stand.gleich("und das Beiwerk bleibt draußen",
    ["legalities", "all_parts", "rulings_uri", "purchase_uris"].filter(k => k in schlank), []);
  stand.ist("die schlanke Karte ist ein Bruchteil der ganzen",
    await seite.evaluate(() =>
      JSON.stringify(synKarteSchlank(window.KARTE)).length < JSON.stringify(window.KARTE).length),
    await seite.evaluate(() =>
      JSON.stringify(synKarteSchlank(window.KARTE)).length + " von " + JSON.stringify(window.KARTE).length + " Zeichen"));

  /* --- Was gespeichert würde -------------------------------------------- */
  const zeile = await seite.evaluate(async () => {
    await synErgebnisSpeichern("d0", "syn",
      [{ card: synKarteSchlank(window.KARTE), grund: "teilt Artefakt-Thema" }], { budget: 20 });
    return window.GESCHRIEBEN[0];
  });
  stand.gleich("Deck, Art und Nutzer stehen in der Zeile",
    [zeile.deck_id, zeile.art, zeile.user_id], ["d0", "syn", "u0"]);
  stand.gleich("die Vorschläge stehen darin", zeile.daten.eintraege.length, 1);
  stand.gleich("samt Begründung und Budget",
    [zeile.daten.eintraege[0].grund, zeile.daten.budget], ["teilt Artefakt-Thema", 20]);
  stand.ist("und der Fingerabdruck des Decks von jetzt",
    await seite.evaluate(([s]) => s === fingerabdruck(JSON.stringify(deckStand(DECKS[0]))),
      [zeile.stand]), zeile.stand);

  /* Ohne Deck (Vorschläge zu EINER Karte) gibt es nichts aufzuheben. */
  stand.ist("ein Lauf ohne Deck wird nicht gespeichert",
    await seite.evaluate(async () => {
      const vorher = window.GESCHRIEBEN.length;
      await synErgebnisSpeichern(null, "syn", [{ card: synKarteSchlank(window.KARTE), grund: "x" }]);
      return window.GESCHRIEBEN.length === vorher;
    }));

  /* --- Zurückzeichnen ---------------------------------------------------- */
  await seite.evaluate(() => renderDecks());
  await seite.waitForTimeout(250);
  const gezeigt = await seite.evaluate(() => {
    const box = document.querySelector('[data-synbox="d0"]');
    return {
      kacheln: box.querySelectorAll(".syn-card").length,
      name: box.querySelector(".syn-name")?.textContent,
      grund: box.querySelector(".syn-exp")?.textContent,
      kopf: !!box.querySelector(".syn-gespeichert"),
      // Die Kopfzeile sagt, WANN — sonst hielte man den Lauf für frisch.
      kopfText: box.querySelector(".syn-gespeichert-txt")?.textContent.trim(),
      veraltet: !!box.querySelector(".syn-veraltet"),
      wegKnopf: !!box.querySelector("[data-synweg]"),
      // Der „+"-Knopf braucht die Karte im Zwischenspeicher — ohne ihn ließe
      // sich ein aufgehobener Vorschlag nicht ins Deck legen.
      imCache: SYN_CACHE.has("sf-sol"),
    };
  });
  stand.gleich("der aufgehobene Lauf steht wieder im Kasten",
    [gezeigt.kacheln, gezeigt.name, gezeigt.grund],
    [1, "Sol Ring", "teilt Artefakt-Thema"]);
  stand.ist("mit Kopfzeile und Zeitpunkt",
    gezeigt.kopf && /\d{2}\.\d{2}\.\d{4}|\d{4}/.test(gezeigt.kopfText || ""), gezeigt.kopfText);
  stand.ist("und einem Weg, ihn loszuwerden", gezeigt.wegKnopf);
  stand.ist("die Karte liegt wieder im Zwischenspeicher (für den „+\"-Knopf)", gezeigt.imCache);
  stand.ist("solange das Deck unverändert ist, steht kein Warnhinweis da", !gezeigt.veraltet);

  /* --- Ändert sich das Deck, sagt die Kopfzeile das ---------------------- */
  await seite.evaluate(() => { DECKS[0].entries = DECKS[0].entries.slice(1); renderDecks(); });
  await seite.waitForTimeout(250);
  stand.ist("nach einer Deckänderung warnt die Kopfzeile",
    await seite.evaluate(() => !!document.querySelector('[data-synbox="d0"] .syn-veraltet')),
    await seite.evaluate(() => document.querySelector(".syn-gespeichert-txt")?.textContent.trim()));

  /* --- Ein voller Kasten wird NICHT überschrieben ------------------------ */
  stand.ist("ein frisches Ergebnis bleibt stehen",
    await seite.evaluate(() => {
      const box = document.querySelector('[data-synbox="d0"]');
      box.innerHTML = '<div class="frisch">gerade fertig</div>';
      synGespeicherteZeigen();
      return !!box.querySelector(".frisch") && !box.querySelector(".syn-card");
    }));

  /* --- Verwerfen --------------------------------------------------------- */
  stand.gleich("Verwerfen räumt Kasten und Gedächtnis",
    await seite.evaluate(async () => {
      await synErgebnisVerwerfen("d0");
      return { kasten: document.querySelector('[data-synbox="d0"]').innerHTML.trim(),
               gemerkt: DECK_SYN.has("d0") };
    }),
    { kasten: "", gemerkt: false });
  await seite.evaluate(() => renderDecks());
  await seite.waitForTimeout(200);
  stand.ist("und danach kommt er auch nicht wieder",
    await seite.evaluate(() => document.querySelectorAll('[data-synbox="d0"] .syn-card').length === 0));
}
