/* Tauschen an einem vollen Deck: die vorgeschlagene Karte raus, der Vorschlag
   rein — mit einem Klick.

   Die Schnitt-Zeile („dafür raus: X") gibt es schon länger, sie war aber nur
   ein Satz zum Nachlesen. Der Knopf führt ihn jetzt aus, und damit hängt an
   der Zeile eine SCHREIBENDE Handlung. Vier Dinge können daran still
   schiefgehen:

   * DER KNOPF OHNE GEGENSTÜCK. Er braucht beide Seiten — die Sammlungszeile,
     die weicht, und die Scryfall-Karte, die kommt. Fehlt der Deck-Bezug (etwa
     im Kartendetail), darf die Zeile ein Hinweis bleiben und kein Knopf werden,
     der ins Leere greift.
   * DER COMMANDER. deckSchnittKandidat() lässt ihn aus. Täte es das nicht,
     nähme ein Klick jetzt den Commander aus dem Deck — vorher stand da nur ein
     unglücklicher Satz.
   * DIE VERALTETEN NACHBARN. Nach einem Tausch nennen die übrigen Kacheln
     womöglich dieselbe, nun herausgenommene Karte. Wer dort weiterklickt,
     läuft in „liegt nicht in diesem Deck" — die Zeile sah bis dahin gültig aus.
   * DER PARAMETERSATZ. Aufnehmen und Tauschen schicken dieselben zwanzig
     Felder an die Datenbank. Gehen sie auseinander, fällt das nicht als Fehler
     auf, sondern als getauschte Wunschzeile ohne Bild oder ohne Auflage. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "decktausch";

/* Der Vorschlag, wie er aus der Synergie-Suche käme. Artefakt, damit die
   Heuristik „gleicher Kartentyp" greift — dieselbe Art wie die Attrappen. */
const VORSCHLAG = {
  id: "sf-sol", oracle_id: "or-sol", name: "Sol Ring",
  type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.",
  mana_cost: "{1}", cmc: 1, colors: [], color_identity: [], keywords: [],
  rarity: "uncommon", set: "cmr", set_name: "Commander Legends",
  collector_number: "472", lang: "en", released_at: "2020-11-20",
  scryfall_uri: "https://scryfall.invalid/sol",
  prices: { eur: "1.20", eur_foil: "3.40" },
  image_uris: { small: "https://img.invalid/s.jpg", normal: "https://img.invalid/n.jpg" },
};

/* Ein zweiter Vorschlag — er soll denselben Schnitt vorschlagen wie der erste.
   Genau daran zeigt sich, ob die Nachbarn nach einem Tausch neu rechnen. */
const VORSCHLAG2 = { ...VORSCHLAG, id: "sf-mana", oracle_id: "or-mana",
  name: "Mana Crypt", collector_number: "473",
  scryfall_uri: "https://scryfall.invalid/crypt" };

const AUFSTELLUNG = (o) => {
  const { a, b } = o;
  // Der Knopf hängt an wireApp(), und das läuft im Start nur MIT
  // Datenbank-Zugang. Hier von Hand — sonst prüfte der Fall eine Schaltfläche,
  // an der nichts hängt.
  wireApp();
  USER = { id: "u0" };

  const d = DECKS[0];
  // Der Commander. Ohne ihn hätte der Fall nichts, woran er zeigen könnte,
  // dass er ausgelassen wird.
  d.main_card_id = "d0c0";
  // Manakosten von oben nach unten, damit die Heuristik („teuerste zuerst")
  // eine eindeutige Reihenfolge hat: d0c0 (Commander, tabu) > d0c1 > d0c2 > …
  CARDS.forEach(c => {
    const n = Number(String(c.id).replace("d0c", ""));
    if (Number.isFinite(n)) c.cmc = 100 - n;
  });

  window.GETAUSCHT = [];
  window.FEHLER = null;
  // Attrappe für den einen Weg nach draußen. Sie ahmt nach, was swap_in_deck
  // in der Datenbank tut: den Eintrag herausnehmen und den Vorschlag als neue
  // Zeile aufnehmen. Ohne das bliebe das Deck unverändert, und die Prüfung der
  // veralteten Nachbarn liefe ins Leere.
  window.deckTauschen = async (deckId, raus, c) => {
    if (window.FEHLER) throw window.FEHLER;
    window.GETAUSCHT.push({ deckId, raus, sid: c.id, params: wunschParams(c) });
    const deck = DECKS.find(x => x.id === deckId);
    if (!deck.entries.some(e => e.cardId === raus)) {
      throw { hint: "no_entry", message: "Karte liegt nicht in diesem Deck" };
    }
    deck.entries = deck.entries.filter(e => e.cardId !== raus);
    const neu = "neu-" + c.id;
    CARDS.push({ id: neu, name: c.name, disp: c.name, qty: 0, cmc: c.cmc,
                 type_line: c.type_line, lang: "en", set: c.set, cn: c.collector_number });
    deck.entries.push({ cardId: neu, qty: 1, kats: [] });
    return neu;
  };
  // reload() liest die Datenbank; ohne sie schlüge es fehl und verdeckte das
  // Ergebnis. Geprüft wird, WAS geschickt würde — nicht das Nachladen.
  window.reload = async () => {};

  // Zwei Kacheln nebeneinander, wie im Synergie-Kasten.
  const kasten = document.createElement("div");
  kasten.id = "tausch-probe";
  kasten.innerHTML = `<div class="syn-grid">${
    synKachel(a, "Grund A", d.id)}${synKachel(b, "Grund B", d.id)}</div>`;
  document.getElementById("app").appendChild(kasten);
};

const zeilenStand = () => [...document.querySelectorAll("#tausch-probe .syn-cut")].map(z => ({
  cut: z.dataset.cut || null,
  text: z.textContent.replace(/\s+/g, " ").trim(),
  getauscht: z.classList.contains("getauscht"),
  knopf: !!z.querySelector(".syn-swap"),
}));

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  // Genau 100 Karten: Erst dann ist das Commander-Deck voll, und erst dann
  // zeigt die Kachel überhaupt eine Schnitt-Zeile.
  await seite.evaluate(AUFBAU, { karten: 100, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(350);
  await seite.evaluate(AUFSTELLUNG, { a: VORSCHLAG, b: VORSCHLAG2 });
  await seite.waitForTimeout(250);

  /* --- Die Ausgangslage stimmt ------------------------------------------- */
  const start = await seite.evaluate(() => ({
    groesse: deckGroesse(DECKS[0]),
    frei: deckFrei(DECKS[0]),
    kandidat: deckSchnittKandidat(DECKS[0], { type_line: "Artifact" })?.karte?.id,
  }));
  stand.ist("das Deck ist voll (100/100)", start.groesse === 100 && start.frei === 0,
    `${start.groesse} Karten, ${start.frei} frei`);
  stand.gleich("der Commander wird nie zum Schneiden vorgeschlagen — d0c1 statt d0c0",
    start.kandidat, "d0c1");

  /* --- Der Knopf steht da, wo beide Seiten bekannt sind ------------------ */
  const zeilen = await seite.evaluate(zeilenStand);
  stand.ist("beide Kacheln zeigen eine Schnitt-Zeile mit Knopf",
    zeilen.length === 2 && zeilen.every(z => z.knopf), JSON.stringify(zeilen.map(z => z.knopf)));
  stand.gleich("und beide nennen dieselbe Karte — die teuerste ohne den Commander",
    zeilen.map(z => z.cut), ["d0c1", "d0c1"]);

  const knopf = await seite.evaluate(() => {
    const b = document.querySelector("#tausch-probe .syn-swap");
    return { deck: b.dataset.deck, sid: b.dataset.sid, cut: b.dataset.cut,
             titel: b.title, text: b.textContent.trim() };
  });
  stand.gleich("der Knopf trägt Deck, Vorschlag und Schnitt an sich",
    [knopf.deck, knopf.sid, knopf.cut], ["d0", "sf-sol", "d0c1"]);
  stand.ist("sein Hinweis nennt beide Karten im Klartext",
    knopf.titel.includes("Karte 0-1") && knopf.titel.includes("Sol Ring"), knopf.titel);
  stand.ist("die Beschriftung ist übersetzt, nicht der Schlüssel",
    knopf.text.includes("Tauschen"), knopf.text);

  // Ohne Deck-Bezug bleibt die Zeile ein Hinweis. Sonst stünde im Kartendetail
  // ein Knopf, der nicht weiß, aus welchem Deck er schneiden soll.
  stand.ist("ohne Deck-Bezug gibt es keinen Knopf",
    await seite.evaluate(() =>
      !schnittHinweisHtml(deckSchnittKandidat(DECKS[0], { type_line: "Artifact" }))
        .includes("syn-swap")));

  /* --- Der Klick schickt genau einen Aufruf ------------------------------ */
  await seite.locator("#tausch-probe .syn-swap").first().click();
  await seite.waitForTimeout(300);

  const ruf = await seite.evaluate(() => window.GETAUSCHT);
  stand.ist("ein Aufruf, nicht zwei", ruf.length === 1, ruf.length + " Aufrufe");
  stand.gleich("mit Deck, herauszunehmender Zeile und Vorschlag",
    [ruf[0]?.deckId, ruf[0]?.raus, ruf[0]?.sid], ["d0", "d0c1", "sf-sol"]);
  // Derselbe Parametersatz wie beim bloßen Aufnehmen — sonst hätte die
  // getauschte Wunschkarte weniger Daten als eine gewünschte.
  stand.gleich("und mit dem vollen Parametersatz der Wunschkarte",
    [ruf[0]?.params?.p_scryfall_id, ruf[0]?.params?.p_set_code, ruf[0]?.params?.p_cn,
     ruf[0]?.params?.p_img, ruf[0]?.params?.p_price, ruf[0]?.params?.p_oracle_text],
    ["sf-sol", "CMR", "472", "https://img.invalid/n.jpg", 1.2, "{T}: Add {C}{C}."]);

  /* --- Das Deck bleibt gleich groß -------------------------------------- */
  stand.ist("das Deck hat danach wieder 100 Karten",
    await seite.evaluate(() => deckGroesse(DECKS[0])) === 100,
    await seite.evaluate(() => deckGroesse(DECKS[0])));

  /* --- Die Kachel sagt, was passiert ist --------------------------------- */
  const danach = await seite.evaluate(() => {
    const karte = document.querySelector("#tausch-probe .syn-card");
    const plus = karte.querySelector(".syn-add");
    return {
      zeile: karte.querySelector(".syn-cut")?.textContent.replace(/\s+/g, " ").trim() || "",
      getauscht: karte.querySelector(".syn-cut")?.classList.contains("getauscht"),
      plusFertig: plus?.classList.contains("done") && plus.disabled,
      plusVoll: plus?.classList.contains("voll"),
      toast: document.getElementById("toast").textContent,
    };
  });
  stand.ist("die Schnitt-Zeile nennt beide Karten und ist als getauscht markiert",
    danach.getauscht && danach.zeile.includes("Karte 0-1") && danach.zeile.includes("Sol Ring"),
    danach.zeile);
  stand.ist("der „+\"-Knopf steht nicht mehr auf „Deck ist voll\", sondern auf erledigt",
    danach.plusFertig && !danach.plusVoll,
    `done=${danach.plusFertig}, voll=${danach.plusVoll}`);
  stand.ist("die Meldung nennt Deck und beide Karten",
    danach.toast.includes("Deck 0") && danach.toast.includes("Karte 0-1")
      && danach.toast.includes("Sol Ring"), danach.toast);

  /* --- Der Nachbar rechnet neu ------------------------------------------ */
  const nachbar = await seite.evaluate(zeilenStand);
  stand.gleich("die getauschte Zeile ist raus aus der Rechnung, der Nachbar zeigt den nächsten Schnitt",
    nachbar.map(z => z.cut), [null, "d0c2"]);
  stand.ist("und der Nachbar hat wieder einen benutzbaren Knopf",
    nachbar[1].knopf && !nachbar[1].getauscht, JSON.stringify(nachbar[1]));
  stand.ist("er nennt jetzt die neue Karte, nicht mehr die herausgenommene",
    nachbar[1].text.includes("Karte 0-2") && !nachbar[1].text.includes("Karte 0-1"),
    nachbar[1].text);
  // Der heikle Fall: Die eben aufgenommene Karte ist eine Wunschkarte mit
  // Bestand 0, und „nicht besessen" ist das erste Argument der Heuristik. Ohne
  // Sperre schlüge der Nachbar vor, genau sie wieder herauszunehmen.
  stand.ist("und niemals die Karte, die der Tausch gerade hineingelegt hat",
    !nachbar[1].text.includes("Sol Ring") && nachbar[1].cut !== "neu-sf-sol",
    nachbar[1].cut);

  /* --- Der veraltete Vorschlag ------------------------------------------- */
  // Von einem zweiten Gerät herausgenommen: Der Aufruf sagt ab, und die App
  // rechnet die Zeile neu, statt den rohen Datenbankfehler zu zeigen.
  await seite.evaluate(() => {
    const d = DECKS[0];
    d.entries = d.entries.filter(e => e.cardId !== "d0c2");
    // Besessen und billig — damit das Deck voll bleibt, die Karte aber selbst
    // nicht als nächster Schnitt herauskommt.
    CARDS.push({ id: "fuell", name: "Füllkarte", disp: "Füllkarte", qty: 3, cmc: 1,
                 type_line: "Artifact", lang: "en", set: "cmr", cn: "1" });
    d.entries.push({ cardId: "fuell", qty: 1, kats: [] });
  });
  await seite.locator("#tausch-probe .syn-swap").first().click();
  await seite.waitForTimeout(300);

  const veraltet = await seite.evaluate(() => ({
    rufe: window.GETAUSCHT.length,
    toast: document.getElementById("toast").textContent,
    zeilen: [...document.querySelectorAll("#tausch-probe .syn-cut")].map(z => z.dataset.cut || null),
  }));
  stand.ist("der Aufruf wurde versucht", veraltet.rufe === 2, veraltet.rufe + " Aufrufe");
  stand.ist("die Absage wird erklärt, nicht als Datenbankfehler durchgereicht",
    veraltet.toast.includes("Karte 0-2") && veraltet.toast.includes("nicht mehr"),
    veraltet.toast);
  stand.gleich("und die Zeile zeigt danach einen gültigen Schnitt",
    veraltet.zeilen, [null, "d0c3"]);

  /* --- Die Migration ist noch nicht gelaufen ----------------------------- */
  // Bemerken lässt sich das erst beim ersten Klick. Danach soll die App
  // vollständig weiterlaufen — die Schnitt-Zeile bleibt als Hinweis stehen,
  // nur die Knöpfe verschwinden, statt bei jedem Klick erneut ins Leere zu
  // greifen.
  await seite.evaluate(() => {
    window.FEHLER = { code: "PGRST202",
      message: "Could not find the function public.swap_in_deck" };
  });
  await seite.locator("#tausch-probe .syn-swap").first().click();
  await seite.waitForTimeout(300);

  const ohne = await seite.evaluate(() => ({
    knoepfe: document.querySelectorAll("#tausch-probe .syn-swap").length,
    zeilen: document.querySelectorAll("#tausch-probe .syn-cut").length,
    flagge: TAUSCH_FEHLT,
    toast: document.getElementById("toast").textContent,
    neuGezeichnet: schnittHinweisHtml(
      deckSchnittKandidat(DECKS[0], { type_line: "Artifact" }), "d0", { id: "sf-sol", name: "Sol Ring" }),
  }));
  stand.ist("die Knöpfe verschwinden, die Hinweise bleiben",
    ohne.knoepfe === 0 && ohne.zeilen === 2 && ohne.flagge,
    `${ohne.knoepfe} Knöpfe, ${ohne.zeilen} Zeilen`);
  stand.ist("die Meldung nennt die Migration, die fehlt",
    ohne.toast.includes("swap_in_deck") && ohne.toast.includes("20260803210000_deck_tausch.sql"),
    ohne.toast);
  stand.ist("und auch neu gezeichnete Kacheln bekommen keinen mehr",
    !ohne.neuGezeichnet.includes("syn-swap") && ohne.neuGezeichnet.includes("syn-cut"));
}
