/* Community-Decks: öffentlich statt nur geteilt, dazu Sterne und Rangliste.

   Drei Dinge sind daran heikel, und alle drei würden nicht als Fehler
   auffallen, sondern als Ergebnis:

   * WAS MIT BESTEHENDEN DECKS GESCHIEHT. Eine Spalte `is_public boolean not
     null default true` veröffentlichte mit der Migration JEDES bereits
     angelegte Deck, ohne dass jemand zugestimmt hätte. Die Reihenfolge in der
     Migration ist die eigentliche Aussage: erst mit false anlegen, dann den
     Vorgabewert auf true setzen. Wer sie umdreht, veröffentlicht rückwirkend
     alles — und niemand sähe daran etwas Ungewöhnliches.
   * DIE RANGLISTE. Ohne Glättung stünde ein Deck mit einer einzigen 5 über
     einem mit fünfzig 4,8ern. Die Liste zeigte dann nicht die besten Decks,
     sondern die mit den wenigsten Bewertungen — eine Rangliste, die das
     Gegenteil dessen tut, wofür man sie liest.
   * DAS EIGENE DECK. Ließe es sich bewerten, wäre die Rangliste ein
     Wettbewerb im Fünf-Sterne-Vergeben an sich selbst.

   Dazu die Anzeige: Der geglättete Wert wird nur zum SORTIEREN benutzt;
   dastehen muss der echte Schnitt. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "communitydecks";

const MIGRATION = "supabase/migrations/20260803000000_community_decks.sql";

const ATTRAPPE = () => {
  USER = { id: "u0", email: "ich@example.invalid" };
  PROFILE = { id: "u0", display_name: "Ich" };
  window.ALLE = [
    // eigenes Deck — darf nicht bewertbar sein
    { id: "d-mein", name: "Mein Deck", format: "Commander", archetype: "Aggro",
      commander: "Atraxa", commander_img: "", karten: 100,
      owner_id: "u0", owner_name: "Ich", owner_avatar: null,
      created: "2026-08-01T10:00:00Z", schnitt: 4.5, stimmen: 2, meine: null },
    { id: "d-a", name: "Fremdes Deck A", format: "Modern", archetype: null,
      commander: null, commander_img: "", karten: 60,
      owner_id: "u1", owner_name: "Mira", owner_avatar: null,
      created: "2026-07-01T10:00:00Z", schnitt: 4.8, stimmen: 50, meine: 5 },
    { id: "d-b", name: "Fremdes Deck B", format: null, archetype: null,
      commander: "Krenko", commander_img: "", karten: 99,
      owner_id: "u2", owner_name: "Jonas", owner_avatar: null,
      created: "2026-06-01T10:00:00Z", schnitt: 0, stimmen: 0, meine: null },
  ];
  window.ABFRAGEN = []; window.BEWERTUNGEN = [];
  window.communityDecksLaden = async (suche, sort, seite) => {
    window.ABFRAGEN.push({ suche, sort, seite });
    const treffer = window.ALLE.filter(d => !suche
      || (d.name + " " + (d.commander || "")).toLowerCase().includes(suche.toLowerCase()));
    return treffer.map(d => ({ ...d, gesamt: treffer.length }));
  };
  window.deckBewertenSchreiben = async (id, sterne) => {
    window.BEWERTUNGEN.push({ id, sterne });
    const d = window.ALLE.find(x => x.id === id);
    // So, wie es die Datenbank zurückgäbe: neuer Schnitt, neue Zahl.
    if (!sterne) return { schnitt: d.schnitt, stimmen: Math.max(0, d.stimmen - 1), meine: null };
    return { schnitt: 4.9, stimmen: d.stimmen + (d.meine ? 0 : 1), meine: sterne };
  };
  CDECKS = { zeilen: [], gesamt: 0, seite: 0, suche: "", sort: "rang", laedt: false, fehler: null };
  MITGLIEDER = { zeilen: [], gesamt: 0, seite: 0, suche: "", laedt: false, fehler: null };
  window.mitgliederLaden = async () => [];
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-community"));
  renderCommunity();
};

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Migration -------------------------------------------------- */
  const datei = await readFile(join(wurzel, MIGRATION), "utf8");
  /* Nur der ausführbare Teil: Der Kopfkommentar erklärt die Migration und
     zitiert sie dabei — eine Suche über die ganze Datei fände ihre eigene
     Beschreibung. (Genau daran blieb im Fall `mitgliederliste` eine Sabotage
     grün.) */
  const sql = datei.slice(datei.indexOf("alter table public.decks add column"));

  const anlegen = sql.indexOf("add column if not exists is_public boolean not null default false");
  const umstellen = sql.indexOf("alter column is_public set default true");
  stand.ist("die Spalte entsteht mit default false …", anlegen >= 0);
  stand.ist("… und wird ERST DANACH auf true umgestellt",
    umstellen > anlegen && anlegen >= 0, `anlegen ${anlegen}, umstellen ${umstellen}`);
  stand.ist("es gibt kein UPDATE, das bestehende Decks veröffentlicht",
    !/update public\.decks set is_public/i.test(sql));

  stand.ist("die Rangliste glättet (Bayes)",
    /stimmen::numeric \/ \(b\.stimmen \+ 3\)/.test(sql) && /3::numeric \/ \(b\.stimmen \+ 3\)/.test(sql));
  stand.ist("angezeigt wird der ECHTE Schnitt",
    /round\(b\.schnitt, 2\)/.test(sql));
  stand.ist("das eigene Deck lässt sich nicht bewerten",
    /not exists \(select 1 from public\.decks d\s*\n?\s*where d\.id = deck_id and d\.user_id = auth\.uid\(\)\)/.test(sql),
    (sql.match(/not exists \(select 1 from public\.decks[\s\S]{0,90}/) || [])[0]?.replace(/\s+/g, " "));
  stand.ist("nur zu öffentlichen Decks lässt sich schreiben",
    /with check \(user_id = auth\.uid\(\)[\s\S]{0,80}deck_public\(deck_id\)/.test(sql));
  stand.ist("Sterne sind auf 1 bis 5 begrenzt",
    /check \(stars between 1 and 5\)/.test(sql));
  stand.ist("öffentliche Decks werden auf allen fünf Ebenen lesbar",
    ["decks_select_public", "deck_entries_select_public", "deck_categories_select_public",
     "deck_entry_categories_select_public", "cards_select_public"].every(n => sql.includes(n)));

  /* --- Die Kacheln ---------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(ATTRAPPE);
  await seite.waitForTimeout(400);

  const k = await seite.evaluate(() => {
    const kachel = id => document.querySelector(`[data-cdeck="${id}"]`);
    const lies = id => {
      const c = kachel(id);
      if (!c) return null;
      return { name: c.querySelector(".cdeck-name").textContent.trim(),
               wert: c.querySelector(".cdeck-wert").textContent.trim(),
               sterne: c.querySelectorAll("button.stern").length,
               fest: !!c.querySelector(".sterne.fest"),
               meine: c.querySelectorAll("button.stern.meine").length,
               weg: !!c.querySelector(".stern-weg") };
    };
    return { karte: !!document.querySelector("#cdecks-karte"),
             gesamt: document.querySelector("#cd-gesamt")?.textContent.trim(),
             abfrage: window.ABFRAGEN[0],
             mein: lies("d-mein"), a: lies("d-a"), b: lies("d-b") };
  });
  stand.ist("die Karte steht in der Community-Ansicht", k.karte);
  stand.gleich("zuerst wird die Rangliste geholt", k.abfrage, { suche: "", sort: "rang", seite: 0 });
  stand.ist("die Gesamtzahl steht in der Überschrift", /3/.test(k.gesamt || ""), k.gesamt);

  stand.ist("am EIGENEN Deck sind die Sterne keine Knöpfe",
    k.mein?.fest === true && k.mein?.sterne === 0, JSON.stringify(k.mein));
  stand.gleich("an fremden Decks fünf Knöpfe", k.a?.sterne, 5);
  stand.gleich("die eigene Bewertung ist hervorgehoben", k.a?.meine, 5);
  stand.ist("und lässt sich zurücknehmen", k.a?.weg === true);
  stand.ist("ohne eigene Bewertung gibt es nichts zurückzunehmen", k.b?.weg === false);

  stand.ist("der Schnitt steht mit zwei Stellen und der Stimmenzahl",
    /4,80/.test(k.a?.wert || "") && /50/.test(k.a?.wert || ""), k.a?.wert);
  stand.ist("ohne Stimmen steht das auch so da",
    /noch nicht bewertet/.test(k.b?.wert || ""), k.b?.wert);

  /* --- Bewerten ------------------------------------------------------- */
  await seite.evaluate(() =>
    document.querySelector('[data-cdeck="d-b"] button.stern[data-n="4"]').click());
  await seite.waitForTimeout(300);
  const nach = await seite.evaluate(() => ({
    geschickt: window.BEWERTUNGEN[window.BEWERTUNGEN.length - 1],
    abfragen: window.ABFRAGEN.length,
    wert: document.querySelector('[data-cdeck="d-b"] .cdeck-wert')?.textContent.trim(),
    meine: document.querySelectorAll('[data-cdeck="d-b"] button.stern.meine').length,
    andere: document.querySelector('[data-cdeck="d-a"] .cdeck-wert')?.textContent.trim(),
  }));
  stand.gleich("ein Klick auf den vierten Stern schickt genau das",
    nach.geschickt, { id: "d-b", sterne: 4 });
  stand.ist("die Kachel zeigt danach den neuen Wert",
    /4,90/.test(nach.wert || "") && /1/.test(nach.wert || ""), nach.wert);
  stand.gleich("und die eigene Bewertung steht darin", nach.meine, 4);
  /* Die Liste NICHT neu zu holen ist Absicht: Sie risse die Kachel unter dem
     Finger weg, und bei „Rangliste" spränge das Deck womöglich an eine andere
     Stelle, während man noch darauf zielt. */
  stand.gleich("die Liste wird dabei nicht neu geholt", nach.abfragen, 1);
  stand.ist("die anderen Kacheln bleiben, wie sie waren",
    /4,80/.test(nach.andere || ""), nach.andere);

  await seite.evaluate(() =>
    document.querySelector('[data-cdeck="d-b"] .stern-weg').click());
  await seite.waitForTimeout(300);
  stand.gleich("das Kreuz nimmt die Bewertung zurück (0 Sterne)",
    await seite.evaluate(() => window.BEWERTUNGEN[window.BEWERTUNGEN.length - 1]),
    { id: "d-b", sterne: 0 });

  /* --- Sortieren und Suchen ------------------------------------------- */
  await seite.selectOption("#cd-sort", "neu");
  await seite.waitForTimeout(300);
  stand.gleich("die Sortierung geht an die Abfrage",
    await seite.evaluate(() => window.ABFRAGEN[window.ABFRAGEN.length - 1]),
    { suche: "", sort: "neu", seite: 0 });

  await seite.fill("#cd-suche", "Krenko");
  await seite.waitForTimeout(500);
  const suche = await seite.evaluate(() => ({
    abfrage: window.ABFRAGEN[window.ABFRAGEN.length - 1],
    kacheln: document.querySelectorAll(".cdeck").length,
  }));
  stand.gleich("gesucht wird auch über den Commander",
    suche.abfrage, { suche: "Krenko", sort: "neu", seite: 0 });
  stand.gleich("und die Sortierung bleibt dabei stehen", suche.abfrage.sort, "neu");
  stand.gleich("ein Treffer", suche.kacheln, 1);

  /* --- Der Schalter am Deck ------------------------------------------- */
  const schalter = await seite.evaluate(async () => {
    window.GESCHRIEBEN = null;
    sb = { from: () => ({ update: (f) => ({ eq: async () => { window.GESCHRIEBEN = f; return { error: null }; } }) }),
           rpc: async () => ({ data: [], error: null }) };
    DECKS[0].is_public = false;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
    renderDecks();
    const knopf = document.querySelector("[data-public]");
    const vorher = { da: !!knopf, an: knopf?.classList.contains("an") };
    knopf.click();
    await new Promise(r => setTimeout(r, 200));
    return { vorher, geschrieben: window.GESCHRIEBEN, jetzt: DECKS[0].is_public,
             anDanach: document.querySelector("[data-public]")?.classList.contains("an"),
             neben: !!document.querySelector(".deck-manage [data-share]") };
  });
  stand.ist("das Deck trägt einen Öffentlich-Schalter", schalter.vorher.da);
  stand.ist("neben (nicht statt) „Geteilt“", schalter.neben);
  stand.ist("aus heißt aus", schalter.vorher.an === false);
  stand.gleich("ein Klick schreibt is_public", schalter.geschrieben, { is_public: true });
  stand.ist("und der Knopf zeigt es an", schalter.anDanach === true && schalter.jetzt === true);
}
