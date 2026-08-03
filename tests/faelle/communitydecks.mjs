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

  /* --- Die Kacheln führen zu den Listen --------------------------------
     Eine Zahl, unter der etwas Ganzes liegt, soll man anklicken können —
     sonst liest man „6 Mitglieder" und sucht die Liste von Hand. Die übrigen
     Kacheln bleiben Flächen: Ein Knopf, der nichts tut, ist schlechter als
     eine Fläche, die nie so aussah. */
  const kacheln = await seite.evaluate(() => {
    COMMUNITY_STATS = { member_count: 6, deck_count: 15, public_deck_count: 9,
      card_count: 1601, active_session_count: 1, upcoming_event_count: 47,
      activity_7d_count: 195, combo_count: 741, synergy_count: 466 };
    renderCommunity();
    return [...document.querySelectorAll(".stat")].map(el => ({
      wert: el.querySelector(".v").textContent.trim(),
      text: el.querySelector(".k").textContent.trim().replace(/\s*↓$/, ""),
      ziel: el.dataset.springt || null,
    }));
  });
  await seite.waitForTimeout(300);
  stand.gleich("die Community-Decks stehen als eigene Kachel gleich nach den Decks",
    kacheln.slice(0, 3).map(k => `${k.text}=${k.wert}`),
    ["Mitglieder=6", "Decks=15", "Community-Decks=9"]);
  stand.gleich("genau zwei Kacheln führen irgendwohin",
    kacheln.filter(k => k.ziel).map(k => k.ziel), ["mitglieder-karte", "cdecks-karte"]);

  /* Kennt die Datenbank die neue Zahl noch nicht, fehlt die Kachel lieber,
     als eine 0 zu zeigen, die keine ist. */
  const ohne = await seite.evaluate(() => {
    const { public_deck_count, ...alt } = COMMUNITY_STATS;
    COMMUNITY_STATS = alt;
    renderCommunity();
    return [...document.querySelectorAll(".stat")].map(el => el.dataset.springt || null);
  });
  stand.gleich("ohne die neue Spalte bleibt die Kachel weg",
    ohne.filter(Boolean), ["mitglieder-karte"]);

  await seite.evaluate(() => {
    COMMUNITY_STATS = { ...COMMUNITY_STATS, public_deck_count: 9 };
    renderCommunity();
  });
  await seite.waitForTimeout(400);
  /* Gemessen in einem NIEDRIGEN Fenster: In einem hohen steht die Karte
     ohnehin schon im Bild, und ein Sprung, der nichts bewegt, ließe sich von
     einem kaputten nicht unterscheiden. */
  await seite.setViewportSize({ width: 1280, height: 380 });
  await seite.waitForTimeout(300);
  const sprung = await seite.evaluate(async () => {
    const karte = document.getElementById("cdecks-karte");
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 100));
    const vorher = karte.getBoundingClientRect().top;
    document.querySelector('[data-springt="cdecks-karte"]').click();
    await new Promise(r => setTimeout(r, 900));
    return { vorher: Math.round(vorher), nachher: Math.round(karte.getBoundingClientRect().top),
             hoehe: innerHeight, leuchtet: karte.classList.contains("leuchtet") };
  });
  stand.ist("vorher steht die Karte unterhalb des Fensters",
    sprung.vorher > sprung.hoehe, `oben bei ${sprung.vorher}, Fenster ${sprung.hoehe}`);
  stand.ist("ein Klick holt sie ins Bild",
    sprung.nachher < sprung.hoehe && sprung.nachher < sprung.vorher,
    `von ${sprung.vorher} auf ${sprung.nachher}`);
  stand.ist("und lässt sie kurz aufleuchten", sprung.leuchtet);
  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(250);

  /* --- Der Feed nennt das Teilen -------------------------------------- */
  const feed = await seite.evaluate(() => {
    const zeile = k => aktivitaetText({ actor_name: "Mira", kind: k, metadata: {} });
    const mehr = k => aktivitaetText({ actor_name: "Mira", kind: k, metadata: { n: 3 } });
    return { einzeln: zeile("deck_public"), mehrere: mehr("deck_public"),
             angelegt: zeile("deck_created") };
  });
  stand.ist("ein geteiltes Deck steht als eigene Zeile im Feed",
    /Mira/.test(feed.einzeln) && /geteilt/.test(feed.einzeln), feed.einzeln);
  stand.ist("… auch in der Mehrzahl", /3/.test(feed.mehrere), feed.mehrere);
  stand.ist("und bleibt vom bloßen Anlegen unterscheidbar",
    feed.angelegt !== feed.einzeln && !/geteilt/.test(feed.angelegt), feed.angelegt);
  stand.ist("der Deckname steht NICHT darin — der Feed bleibt datensparsam",
    !/Deck [AB]|Mein Deck/.test(feed.einzeln));

  /* --- Der Trigger schreibt genau EINE Zeile --------------------------- */
  const trig = await readFile(join(wurzel, "supabase/migrations/20260803010000_deck_geteilt_feed.sql"), "utf8");
  const tsql = trig.slice(trig.indexOf("alter table public.community_activity"));
  stand.ist("beim Anlegen entscheidet der Trigger, welche der beiden Zeilen es ist",
    /case when new\.is_public then 'deck_public' else 'deck_created' end/.test(tsql));
  stand.ist("beim Umschalten von privat auf öffentlich ebenfalls",
    /coalesce\(old\.is_public, false\) = false and new\.is_public/.test(tsql));
  stand.ist("dafür hängt ein Trigger am UPDATE",
    /after update of is_public on public\.decks/.test(tsql));
  stand.ist("die neue Art ist in der Prüfbedingung erlaubt",
    /check \(kind in \([^)]*'deck_public'/.test(tsql.replace(/\n/g, " ")));
  stand.ist("und die Kennzahl zählt die öffentlichen Decks",
    /public_deck_count bigint/.test(tsql) && /count\(\*\) from public\.decks where is_public/.test(tsql));

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
