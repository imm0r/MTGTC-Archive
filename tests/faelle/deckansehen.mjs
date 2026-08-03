/* Ein Community-Deck ansehen und übernehmen.

   Bis hierher war ein Community-Deck ein Bild mit einem Namen und fünf
   Sternen. Bewerten ließ es sich, hineinsehen nicht — eine Bewertung über
   etwas, das man nicht gelesen hat. Jetzt öffnet ein Klick die Kartenliste,
   und von dort führt ein Knopf ins eigene Regal.

   Vier Dinge daran gehen still daneben:

   * DER KLICK AUF EINEN STERN DARF NICHT DAS DECK ÖFFNEN. Die ganze Kachel
     ist Trefferfläche; in ihr sitzen aber schon Knöpfe. Ohne Ausnahme
     bewertete ein Klick auf den dritten Stern das Deck UND risse den Dialog
     auf — über einer Kachel, die darunter gerade neu gezeichnet wird.
   * ZWEI DIALOGE ÜBEREINANDER GEHEN NICHT. Profil und Übernahme-Rückfrage
     laufen beide über confirmDlg, also über dasselbe <dialog>. showModal()
     auf einem offenen Dialog wirft InvalidStateError: Der Knopf täte dann
     nichts, und der Fehler stünde nur in der Konsole. Deshalb erst
     schließen, dann öffnen.
   * DIE KOPIE DARF NICHT ÖFFENTLICH SEIN. Seit der Community-Migration ist
     der Vorgabewert von decks.is_public true. Nennt der INSERT die Spalte
     nicht, veröffentlicht jede Übernahme das Deck eines ANDEREN sofort unter
     eigenem Namen — und der Bestätigungstext verspricht in allen fünf
     Sprachen das Gegenteil („als neues, privates Deck"). Nichts schlüge
     fehl.
   * DER ZWEITE ZUGANGSWEG. import_shared_deck kannte nur „geteilt UND
     befreundet". Wer das beim Fortschreiben stehen lässt, bekommt einen
     Knopf, der zuverlässig „Kein Zugriff auf dieses Deck" sagt. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "deckansehen";

const MIGRATION = "supabase/migrations/20260803120000_deck_uebernehmen.sql";

const ATTRAPPE = () => {
  USER = { id: "u0", email: "ich@example.invalid" };
  PROFILE = { id: "u0", display_name: "Ich" };
  window.ALLE = [
    { id: "d-mein", name: "Mein Deck", format: "Commander", archetype: null,
      commander: null, commander_img: "", karten: 3,
      owner_id: "u0", owner_name: "Ich", owner_avatar: null,
      created: "2026-08-01T10:00:00Z", schnitt: 4.5, stimmen: 2, meine: null },
    { id: "d-a", name: "Fremdes Deck A", format: "Modern", archetype: "Aggro",
      commander: null, commander_img: "", karten: 4,
      owner_id: "u1", owner_name: "Mira", owner_avatar: null,
      created: "2026-07-01T10:00:00Z", schnitt: 4.8, stimmen: 50, meine: null },
  ];
  window.ABFRAGEN = []; window.RPCS = [];
  window.communityDecksLaden = async () =>
    window.ALLE.map(d => ({ ...d, gesamt: window.ALLE.length }));
  window.deckBewertenSchreiben = async (id, sterne) => {
    const d = window.ALLE.find(x => x.id === id);
    return { schnitt: 4.9, stimmen: d.stimmen + 1, meine: sterne };
  };

  /* Der Inhalt eines Decks, wie ihn die Datenbank über die Policies liefert.
     Absichtlich MIT Einteilung und mit einer Karte, die in keinem Fach steckt
     — dann zeigt sich, ob die Reste eine eigene Gruppe bekommen. */
  const K = {
    k1: { id: "k1", disp: "Alpha Ant", name: "Alpha Ant", set: "ONE", set_name: "One", cn: "1", price: 1, img: "" },
    k2: { id: "k2", disp: "Beta Bear", name: "Beta Bear", set: "ONE", set_name: "One", cn: "2", price: 2, img: "" },
    k3: { id: "k3", disp: "Gamma Golem", name: "Gamma Golem", set: "ONE", set_name: "One", cn: "3", price: 4, img: "" },
  };
  window.communityDeckLaden = async (deckId) => {
    window.ABFRAGEN.push(deckId);
    const d = window.ALLE.find(x => x.id === deckId);
    if (!d) return null;
    const zuord = new Map();
    zuord.set(deckId + "|k1", [{ id: "kat-l", primaer: true }]);
    zuord.set(deckId + "|k2", [{ id: "kat-l", primaer: true }]);
    return {
      deck: { id: deckId, name: d.name, format: d.format, archetype: d.archetype, main_card_id: null },
      entries: [{ card_id: "k2", qty: 4 }, { card_id: "k1", qty: 1 }, { card_id: "k3", qty: 2 }],
      cardsById: K,
      kategorien: [{ id: "kat-l", name: "Länder", pos: 0 }],
      zuord,
    };
  };

  // Für die Übernahme: die RPC abfangen, statt sie zu stellen.
  // sb ist ein top-level `let` und KEINE Fenstereigenschaft — window.sb = …
  // liefe ins Leere und die Übernahme riefe weiter die echte Datenbank.
  sb = { rpc: async (name, args) => { window.RPCS.push({ name, args }); return { data: "neu", error: null }; } };
  reload = async () => {};
  renderAll = () => {};

  CDECKS = { zeilen: [], gesamt: 0, seite: 0, suche: "", sort: "rang", laedt: false, fehler: null };
  MITGLIEDER = { zeilen: [], gesamt: 0, seite: 0, suche: "", laedt: false, fehler: null };
  window.mitgliederLaden = async () => [];
  // Die Navigation verdrahtet wireApp(), und das läuft im Start nur MIT
  // Datenbankzugang — hier von Hand, wie in „sammlung" und „wunschliste".
  // Gebraucht wird sie, weil die Übernahme am Ende in die Deckansicht führt.
  wireApp();
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-community"));
  renderCommunity();
};

const dlgZu = () => { const d = document.querySelector("#dlg"); if (d?.open) d.close(); };

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Migration -------------------------------------------------- */
  const datei = await readFile(join(wurzel, MIGRATION), "utf8");
  /* Erst ab der Funktion lesen: Der Kopfkommentar erklärt die Migration und
     zitiert sie dabei — eine Suche über die ganze Datei fände ihre eigene
     Beschreibung, und jede Sabotage bliebe grün. */
  const sql = datei.slice(datei.indexOf("create or replace function public.import_shared_deck"));

  stand.ist("ein öffentliches Deck ist Zugang genug",
    /coalesce\(src\.is_public, false\)/.test(sql));
  stand.ist("und der Freundesweg bleibt daneben bestehen",
    /src\.shared and public\.are_friends\(me, src\.user_id\)/.test(sql));
  /* Die Zeile, die nichts meldet, wenn sie fehlt. */
  stand.ist("die Kopie wird ausdrücklich privat angelegt",
    /insert into public\.decks \([^)]*is_public\)[\s\S]{0,220}?false, false\)/.test(sql),
    (sql.match(/insert into public\.decks \([^)]*\)/) || [])[0]);
  stand.ist("die Fächer des Erbauers werden mitkopiert",
    /insert into public\.deck_categories \(deck_id, user_id, name, pos\)/.test(sql));
  stand.ist("und die Zuordnung der Karten dazu",
    /insert into public\.deck_entry_categories \(deck_id, card_id, category_id, user_id, is_primary\)/.test(sql));
  stand.ist("aber nur, wo BEIDE Übersetzungen vorliegen",
    /v_karte \? zc\.card_id::text/.test(sql) && /v_kat \? zc\.category_id::text/.test(sql));
  stand.ist("die Reihenfolge der Fächer wandert mit", /order by pos, created/.test(sql));

  /* --- Die Kachel ----------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(ATTRAPPE);
  await seite.waitForTimeout(400);

  stand.ist("der Deckname ist ein Knopf und kein bloßer Text",
    await seite.evaluate(() => {
      const b = document.querySelector('[data-cdeck="d-a"] [data-cdopen]');
      return !!b && b.tagName === "BUTTON" && b.textContent.trim() === "Fremdes Deck A";
    }));

  /* --- Der Dialog ----------------------------------------------------- */
  await seite.click('[data-cdeck="d-a"] [data-cdopen]');
  await seite.waitForTimeout(350);
  const auf = await seite.evaluate(() => {
    const w = document.querySelector("#cd-detail");
    if (!w) return null;
    return {
      offen: document.querySelector("#dlg")?.open === true,
      geholt: window.ABFRAGEN,
      name: w.querySelector("h3")?.textContent,
      // Kopf: Format, Archetyp, Kartenzahl (4+1+2) und Wert (4·2+1·1+2·4=17)
      meta: w.querySelector(".cdeck-meta")?.textContent.replace(/\s+/g, " ").trim(),
      erbauer: w.querySelector("[data-mitglied]")?.textContent.trim(),
      koepfe: [...w.querySelectorAll(".deck-cat-head .deck-cat-name")].map(x => x.textContent),
      karten: [...w.querySelectorAll("tbody tr:not(.deck-cat-head) td:nth-child(2)")].map(x => x.textContent),
      mengen: [...w.querySelectorAll("tbody tr:not(.deck-cat-head) td:nth-child(4)")].map(x => x.textContent),
      importDa: !!w.querySelector("[data-cdimport]"),
      sterne: w.querySelectorAll("[data-sterne]").length,
    };
  });
  stand.ist("der Klick öffnet den Dialog", auf?.offen);
  stand.gleich("und holt genau dieses Deck", auf?.geholt, ["d-a"]);
  stand.gleich("der Kopf nennt das Deck", auf?.name, "Fremdes Deck A");
  stand.ist("mit Format, Archetyp, Kartenzahl und Wert",
    /Modern/.test(auf?.meta || "") && /Aggro/.test(auf?.meta || "")
    && /7 Karten/.test(auf?.meta || "") && /17,00/.test(auf?.meta || ""), auf?.meta);
  stand.ist("und dem Erbauer", /Mira/.test(auf?.erbauer || ""), auf?.erbauer);

  /* Die Einteilung ist das, was das Deck zum Bauplan macht — sie muss die des
     ERBAUERS sein, samt einer Gruppe für alles, was er nirgends einsortiert
     hat. */
  stand.gleich("die Fächer des Erbauers stehen da, Reste in einer eigenen Gruppe",
    auf?.koepfe, ["Länder", "Ohne Kategorie"]);
  stand.gleich("die Karten stehen alphabetisch unter ihrem Fach",
    auf?.karten, ["Alpha Ant", "Beta Bear", "Gamma Golem"]);
  stand.gleich("mit der DECKMENGE, nicht dem Bestand", auf?.mengen, ["1×", "4×", "2×"]);
  stand.ist("ein fremdes Deck lässt sich übernehmen", auf?.importDa);
  stand.gleich("und bewerten — fünf Sterne", auf?.sterne, 5);

  /* --- Bewerten im Dialog wirkt auch auf der Kachel dahinter ----------- */
  await seite.click('#cd-detail [data-sterne][data-n="4"]');
  await seite.waitForTimeout(350);
  const nachStern = await seite.evaluate(() => ({
    imDialog: document.querySelector("#cd-detail .cdeck-detail-leiste .cdeck-wert")?.textContent.replace(/\s+/g, " ").trim(),
    aufKachel: document.querySelector('[data-cdeck="d-a"] .cdeck-wert')?.textContent.replace(/\s+/g, " ").trim(),
    meine: document.querySelectorAll("#cd-detail .stern.meine").length,
  }));
  stand.ist("die Bewertung steht im Dialog", /4,90/.test(nachStern.imDialog || ""), nachStern.imDialog);
  stand.ist("und auf der Kachel dahinter genauso",
    /4,90/.test(nachStern.aufKachel || ""), nachStern.aufKachel);
  stand.gleich("die eigenen vier Sterne leuchten", nachStern.meine, 4);

  /* --- Übernehmen ----------------------------------------------------- */
  /* Der Knopf schließt DIESEN Dialog und öffnet danach die Rückfrage. Zwei
     modale Dialoge übereinander wirft der Browser zurück (InvalidStateError),
     und der Klick sähe dann aus wie ein toter Knopf. */
  await seite.evaluate(() => { window.RPCS.length = 0; });
  await seite.click("#cd-import");
  await seite.waitForTimeout(300);
  const frage = await seite.evaluate(() => ({
    offen: document.querySelector("#dlg")?.open === true,
    detailWeg: !document.querySelector("#cd-detail"),
    text: document.querySelector("#dlg-body")?.textContent || "",
  }));
  stand.ist("die Rückfrage steht offen", frage.offen);
  stand.ist("und der Deckdialog ist dafür gewichen", frage.detailWeg);
  stand.ist("sie verspricht ein PRIVATES Deck — so, wie es die Migration hält",
    /privates Deck/.test(frage.text), frage.text.slice(0, 60));

  await seite.click("#dlg-yes");
  await seite.waitForTimeout(350);
  stand.gleich("bestätigt geht genau ein Aufruf an die Datenbank",
    await seite.evaluate(() => window.RPCS),
    [{ name: "import_shared_deck", args: { p_deck: "d-a" } }]);
  stand.ist("und die Deckansicht steht danach offen",
    await seite.evaluate(() => document.querySelector("#v-decks")?.classList.contains("on")));

  /* --- Das eigene Deck ------------------------------------------------ */
  await seite.evaluate(() => {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-community"));
  });
  await seite.evaluate(dlgZu);
  await seite.click('[data-cdeck="d-mein"] [data-cdopen]');
  await seite.waitForTimeout(350);
  const eigen = await seite.evaluate(() => {
    const w = document.querySelector("#cd-detail");
    return { importDa: !!w?.querySelector("[data-cdimport]"),
             knopfSterne: w?.querySelectorAll("[data-sterne]").length,
             fest: !!w?.querySelector(".sterne.fest"),
             hinweis: w?.querySelector(".cdeck-eigen")?.textContent || "" };
  });
  stand.ist("das eigene Deck trägt keinen Übernehmen-Knopf", !eigen.importDa);
  stand.ist("sondern sagt, warum", /eigenes Deck/.test(eigen.hinweis), eigen.hinweis);
  stand.gleich("und seine Sterne sind Zeichen, keine Knöpfe", eigen.knopfSterne, 0);
  stand.ist("die Sternreihe steht fest", eigen.fest);
  await seite.evaluate(dlgZu);
  await seite.waitForTimeout(150);

  /* --- Wo die Kachel klickbar ist und wo nicht ------------------------ */
  /* Die Trefferfläche ist die ganze Kachel — außer dort, wo schon ein Knopf
     sitzt. Beides muss gemessen werden: „öffnet immer" wäre genauso falsch
     wie „öffnet nie". */
  await seite.evaluate(() => { window.ABFRAGEN.length = 0; });
  await seite.click('[data-cdeck="d-a"] .cdeck-fuss .stern[data-n="2"]');
  await seite.waitForTimeout(300);
  stand.gleich("ein Klick auf einen Stern öffnet den Dialog NICHT",
    await seite.evaluate(() => ({ geholt: window.ABFRAGEN.length,
                                  offen: document.querySelector("#dlg")?.open === true })),
    { geholt: 0, offen: false });

  await seite.evaluate(() => { window.ABFRAGEN.length = 0; });
  await seite.click('[data-cdeck="d-a"] .cdeck-meta');
  await seite.waitForTimeout(350);
  stand.gleich("ein Klick daneben auf der Kachel schon",
    await seite.evaluate(() => window.ABFRAGEN), ["d-a"]);
  await seite.evaluate(dlgZu);
  await seite.waitForTimeout(150);

  /* Der Erbauer führt zum Profil und nicht ins Deck — auch von der Kachel aus. */
  await seite.evaluate(() => {
    window.ABFRAGEN.length = 0; window.PROFIL_AUF = null;
    window.mitgliedProfilZeigen = async (id) => { window.PROFIL_AUF = id; };
  });
  await seite.click('[data-cdeck="d-a"] [data-mitglied]');
  await seite.waitForTimeout(300);
  stand.gleich("der Erbauer führt zum Profil, nicht ins Deck",
    await seite.evaluate(() => ({ profil: window.PROFIL_AUF, decks: window.ABFRAGEN.length })),
    { profil: "u1", decks: 0 });

  /* --- Ein verschwundenes Deck ---------------------------------------- */
  /* Zwischen Liste und Klick kann das Deck privat gestellt oder gelöscht
     worden sein. Dann muss dastehen, was los ist — und nicht ein leeres
     Fenster. */
  await seite.evaluate(() => {
    window.communityDeckLaden = async () => null;
  });
  await seite.click('[data-cdeck="d-a"] [data-cdopen]');
  await seite.waitForTimeout(350);
  stand.ist("ein inzwischen verschwundenes Deck sagt das",
    await seite.evaluate(() =>
      /nicht mehr/.test(document.querySelector("#cd-detail")?.textContent || "")),
    await seite.evaluate(() => document.querySelector("#cd-detail")?.textContent?.trim()));
  await seite.evaluate(dlgZu);
}
