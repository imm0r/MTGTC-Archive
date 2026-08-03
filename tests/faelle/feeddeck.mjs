/* Ein geteiltes Deck im Live-Feed: mit Namen und anklickbar.

   Die Zeile nannte bisher nur die Person („… hat ein Deck mit der Community
   geteilt"). Der Kopf der Migration, die sie eingeführt hat, führt dafür zwei
   Gründe an — und beide bleiben gewahrt, weil NICHT der Name gespeichert wird,
   sondern die Deck-Kennung:

   * DATENSPARSAMKEIT. „Private card, deck and event details never enter this
     table" gilt seit Sprint 1. Eine Kennung auf etwas, das öffentlich ist, ist
     kein privates Detail; der Deckname landet nie in community_activity.
   * WIEDER PRIVAT GESTELLT. Der Name kommt erst beim Lesen dazu, aus `decks`
     und nur solange `is_public` gilt. Nimmt jemand sein Deck zurück, findet der
     Verbund nichts mehr, und die Zeile fällt von selbst auf den namenlosen Satz
     zurück. Ein gespeicherter Name täte das nicht — und NICHTS würde dabei
     fehlschlagen, es stünde nur für immer da.

   Deshalb prüft dieser Fall beides: die SQL-Seite (was geschrieben und was
   verbunden wird) und die Anzeige (Name, Klick, Rückfall, Maskierung). */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "feeddeck";

const MIGRATION = "supabase/migrations/20260803160000_feed_deckname.sql";

/* Vier Feed-Zeilen, die die vier Fälle abdecken. */
const ATTRAPPE = () => {
  USER = { id: "u0", email: "ich@example.invalid" };
  PROFILE = { id: "u0", display_name: "Ich" };
  COMMUNITY_STATS = { member_count: 3, deck_count: 5, public_deck_count: 2, card_count: 100,
    active_session_count: 0, upcoming_event_count: 0, activity_7d_count: 4,
    combo_count: 0, synergy_count: 0 };
  COMMUNITY_FEED = [
    // 1. Der Normalfall: Kennung UND Name aus dem Verbund.
    { id: 4, kind: "deck_public", actor_id: "u1", actor_name: "Mira", metadata: { deck_id: "d-a" },
      occurred_at: new Date(Date.now() - 60000).toISOString(), deck_id: "d-a", deck_name: "Reyhan & Ikra" },
    // 2. Wieder privat gestellt (oder alter Eintrag ohne Kennung): Der Verbund
    //    liefert nichts, die Zeile bleibt namenlos.
    { id: 3, kind: "deck_public", actor_id: "u2", actor_name: "Jonas", metadata: { deck_id: "d-weg" },
      occurred_at: new Date(Date.now() - 120000).toISOString(), deck_id: null, deck_name: null },
    // 3. Ein Deckname aus fremder Hand darf kein Markup einschleusen.
    { id: 2, kind: "deck_public", actor_id: "u3", actor_name: "Ada", metadata: { deck_id: "d-boese" },
      occurred_at: new Date(Date.now() - 180000).toISOString(), deck_id: "d-boese",
      deck_name: '<img src=x onerror="window.BOESE=1">' },
    // 4. Eine andere Art bleibt, wie sie war — der neue Zweig darf nicht
    //    auf alles zugreifen, was zufällig eine Kennung mitbringt.
    { id: 1, kind: "deck_created", actor_id: "u1", actor_name: "Mira", metadata: {},
      occurred_at: new Date(Date.now() - 240000).toISOString(), deck_id: null, deck_name: null },
  ];
  COMMUNITY_HIGHLIGHTS = null;
  CDECKS = { zeilen: [], gesamt: 0, seite: 0, suche: "", sort: "rang", laedt: false, fehler: null };
  MITGLIEDER = { zeilen: [], gesamt: 0, seite: 0, suche: "", laedt: false, fehler: null };
  window.mitgliederLaden = async () => [];
  window.communityDecksLaden = async () => [];

  /* Die beiden Wege in die Deckansicht werden abgefangen. Gemerkt wird, WONACH
     gefragt wurde — daran hängt, dass der Klick überhaupt beim richtigen Deck
     ankommt. */
  window.GEFRAGT = [];
  window.communityDeckKachelLaden = async (id) => {
    window.GEFRAGT.push({ was: "kachel", id });
    return id === "d-weg" ? null : { id, name: "Reyhan & Ikra", format: "Commander",
      archetype: "Control", commander: "Reyhan", commander_img: "", karten: 100,
      owner_id: "u1", owner_name: "Mira", owner_avatar: null,
      created: "2026-08-01T10:00:00Z", schnitt: 0, stimmen: 0, meine: null };
  };
  window.communityDeckLaden = async (id) => {
    window.GEFRAGT.push({ was: "inhalt", id });
    return { deck: { id, name: "Reyhan & Ikra", is_public: true }, rows: [], kategorien: [], zuord: {} };
  };

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
  const sql = datei.slice(datei.indexOf("create or replace function public.log_deck_created_activity"));
  stand.ist("die Migration ist da", sql.length > 400, sql.length + " Zeichen");

  stand.ist("geteilt wird MIT Kennung geschrieben",
    /'deck_public',\s*\n?\s*jsonb_build_object\('deck_id', new\.id\)/.test(sql));
  /* Ein privat angelegtes Deck bekommt KEINE Kennung mit: Sie wäre ein Griff
     auf etwas, das niemand sehen darf. */
  stand.ist("ein privat angelegtes Deck bekommt keine",
    /'deck_created'\)/.test(sql) && !/'deck_created',\s*\n?\s*jsonb_build_object/.test(sql));
  /* Der Deckname darf NIRGENDS in die Tabelle wandern — das ist die Zusage,
     an der die ganze Lösung hängt. */
  stand.ist("der Deckname wird nirgends gespeichert",
    !/jsonb_build_object\([^)]*'(name|deck_name)'/.test(sql),
    (sql.match(/jsonb_build_object\([^)]*\)/g) || []).join(" | "));

  /* `is_public` gehört in die VERBUNDBEDINGUNG. Stünde es in einer
     where-Klausel, fielen Feed-Zeilen zu wieder privaten Decks ganz aus der
     Liste, statt bloß ihren Namen zu verlieren. */
  const feed = sql.slice(sql.indexOf("create function public.community_activity_feed"),
                         sql.indexOf("-- ---- Eine einzelne Kachel"));
  stand.ist("der Feed verbindet das Deck über die Kennung",
    /left join public\.decks d[\s\S]{0,160}d\.id = \(a\.metadata ->> 'deck_id'\)::uuid/.test(feed));
  stand.ist("… nur solange es öffentlich ist, und zwar IM VERBUND",
    /left join public\.decks d[\s\S]{0,120}and d\.is_public/.test(feed) && !/where[\s\S]{0,80}d\.is_public/.test(feed),
    feed.slice(feed.indexOf("left join public.decks"), feed.indexOf("order by")).replace(/\s+/g, " "));

  const kachel = sql.slice(sql.indexOf("create function public.community_deck_tile"));
  stand.ist("die einzelne Kachel gibt es nur für öffentliche Decks",
    /where auth\.uid\(\) is not null and d\.is_public and d\.id = p_deck/.test(kachel));
  stand.ist("und sie ist nicht für anonyme Aufrufer freigegeben",
    /revoke all on function public\.community_deck_tile\(uuid\) from public, anon/.test(kachel)
    && /grant execute on function public\.community_deck_tile\(uuid\) to authenticated/.test(kachel));

  /* --- Die Anzeige ---------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(ATTRAPPE);
  await seite.waitForTimeout(400);

  const zeilen = await seite.evaluate(() =>
    [...document.querySelectorAll(".community-feed > li")].map(li => ({
      text: li.querySelector(".cf-text").textContent.trim(),
      knopf: li.querySelector("[data-cf-deck]")?.textContent ?? null,
      id: li.querySelector("[data-cf-deck]")?.dataset.cfDeck ?? null,
    })));
  stand.ist("der Feed steht", zeilen.length === 4, zeilen.length);
  stand.gleich("das geteilte Deck steht mit Namen da und ist ein Knopf",
    [zeilen[0]?.knopf, zeilen[0]?.id], ["Reyhan & Ikra", "d-a"]);
  stand.ist("… und der Name steht auch im Satz",
    /Mira/.test(zeilen[0]?.text || "") && /Reyhan & Ikra/.test(zeilen[0]?.text || ""),
    zeilen[0]?.text);
  /* Ohne Namen bleibt es beim bisherigen Satz — und OHNE Knopf: Ein Knopf, der
     ins Leere führte, wäre schlimmer als gar keiner. */
  stand.gleich("ein wieder privates Deck bleibt namenlos und ohne Knopf",
    [zeilen[1]?.knopf, /Deck/.test(zeilen[1]?.text || "")], [null, true]);
  stand.gleich("eine andere Art bleibt unberührt", zeilen[3]?.knopf, null);

  /* Der Name kommt aus fremder Hand. Er darf als TEXT dastehen und nichts
     ausführen — der Platzhalter im Satz überlebt die Maskierung, das Markup
     nicht. */
  stand.gleich("ein Deckname mit Markup steht als Text da, nicht als Markup",
    [zeilen[2]?.knopf, await seite.evaluate(() => window.BOESE ?? null),
     await seite.evaluate(() => document.querySelectorAll(".community-feed img").length)],
    ['<img src=x onerror="window.BOESE=1">', null, 0]);

  /* --- Der Klick ------------------------------------------------------ */
  /* Er führt in dieselbe Ansicht wie die Kachel in der Deckliste. Die Kachel
     dafür steht dort meist NICHT: Die Liste zeigt eine Seite, womöglich
     gefiltert. Vorher endete der Klick in einem stillen `return`. */
  await seite.click('.community-feed [data-cf-deck="d-a"]');
  await seite.waitForTimeout(400);
  stand.gleich("ein Klick holt die fehlende Kachel und den Inhalt nach",
    await seite.evaluate(() => window.GEFRAGT),
    [{ was: "kachel", id: "d-a" }, { was: "inhalt", id: "d-a" }]);
  stand.ist("und die Deckansicht steht offen",
    await seite.evaluate(() => !!document.querySelector("#cd-detail")));
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(250);

  /* Steht die Kachel schon in der Liste, wird sie NICHT noch einmal geholt. */
  await seite.evaluate(() => {
    window.GEFRAGT = [];
    CDECKS.zeilen = [{ id: "d-a", name: "Reyhan & Ikra", format: "Commander", archetype: null,
      commander: null, commander_img: "", karten: 100, owner_id: "u1", owner_name: "Mira",
      owner_avatar: null, created: "2026-08-01T10:00:00Z", schnitt: 0, stimmen: 0, meine: null }];
  });
  await seite.click('.community-feed [data-cf-deck="d-a"]');
  await seite.waitForTimeout(400);
  stand.gleich("liegt die Kachel schon vor, wird nur der Inhalt geholt",
    await seite.evaluate(() => window.GEFRAGT), [{ was: "inhalt", id: "d-a" }]);
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(250);

  /* --- Dasselbe in der Meldung ----------------------------------------
     Die Meldung, die beim Eintreffen kurz oben erscheint, sagte „hat ein Deck
     mit der Community geteilt" — ohne Namen, ohne Weg hinein. Sie baut ihren
     Satz über dieselbe Funktion wie der Feed, bekam aber nur die ROHZEILE aus
     Realtime: Die trägt die Kennung, aber keinen Namen. Den holt erst der
     Verbund der Feed-Abfrage dazu, und der steht beim Melden schon bereit —
     ladeCommunityFoundation() läuft davor.

     Nachgeschlagen wird über die Kennung des Ereignisses, nicht über die
     Person: Eine Person kann in derselben Runde mehrere Dinge getan haben. */
  await seite.evaluate(() => {
    window.GEFRAGT = [];
    communityToastSchlange = []; communityToastLaeuft = false;
    communityEventPuffer = [{ id: 4, kind: "deck_public", actor_id: "u1",
                              metadata: { deck_id: "d-a" } }];
    meldeCommunityEreignisse();
  });
  await seite.waitForTimeout(300);
  const meldung = await seite.evaluate(() => {
    const el = document.querySelector("#community-toast");
    const knopf = el.querySelector("[data-cf-deck]");
    return { an: el.classList.contains("on"), text: el.textContent.trim(),
             id: knopf?.dataset.cfDeck ?? null,
             // Der Toast ist als Ganzes klickdurchlässig; der Knopf darf es nicht sein.
             zeiger: knopf ? getComputedStyle(knopf).pointerEvents : null };
  });
  stand.ist("die Meldung steht", meldung.an, meldung.text);
  stand.gleich("sie nennt das Deck beim Namen und ist anklickbar",
    [meldung.id, /Reyhan & Ikra/.test(meldung.text)], ["d-a", true]);
  stand.gleich("und der Knopf nimmt Klicks an, obwohl die Meldung sie durchlässt",
    meldung.zeiger, "auto");

  /* Der Klick führt in dieselbe Ansicht — und räumt die Meldung sofort weg.
     Ohne das zählte sie hinter dem Dialog weiter und käme beim Schließen als
     Rest zurück. */
  await seite.click('#community-toast [data-cf-deck="d-a"]');
  await seite.waitForTimeout(400);
  stand.gleich("ein Klick in der Meldung öffnet dasselbe Deck",
    await seite.evaluate(() => window.GEFRAGT), [{ was: "inhalt", id: "d-a" }]);
  stand.ist("und die Meldung ist dabei weg",
    await seite.evaluate(() => !document.querySelector("#community-toast").classList.contains("on")));
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(250);

  /* Ohne Namen im Feed bleibt auch die Meldung beim alten Satz. Das ist der
     Fall „schon aus den zwanzig Zeilen herausgerutscht" und zugleich der Fall
     „inzwischen wieder privat". */
  await seite.evaluate(() => {
    communityToastSchlange = []; communityToastLaeuft = false;
    communityEventPuffer = [{ id: 3, kind: "deck_public", actor_id: "u2",
                              metadata: { deck_id: "d-weg" } }];
    meldeCommunityEreignisse();
  });
  await seite.waitForTimeout(300);
  stand.gleich("ohne Namen im Feed bleibt die Meldung namenlos und ohne Knopf",
    await seite.evaluate(() => {
      const el = document.querySelector("#community-toast");
      return [el.querySelectorAll("[data-cf-deck]").length, /Deck/.test(el.textContent)];
    }), [0, true]);
}
