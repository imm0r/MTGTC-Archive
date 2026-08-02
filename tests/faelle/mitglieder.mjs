/* Die Mitgliederliste kennt keine Sichtbarkeitsstufen.

   „Ein Mitglied, dabei seit dem 2.8.2026" ist keine Auskunft, sondern eine
   leere Zeile: Sie nennt weder jemanden, den man begrüßen, noch jemanden, den
   man anschreiben könnte. Die Stufen regeln, WAS jemand tut — welche Karten er
   kauft, was er sammelt. Ob er überhaupt dabei ist, ist etwas anderes.

   Zwei Dinge müssen dafür zugleich stimmen, und sie liegen an verschiedenen
   Orten:

   * IN DER ABFRAGE. community_highlights() nimmt das neueste Mitglied aus
     ALLEN Profilen und mit echtem Namen — nicht mehr aus der nach Stufen
     gefilterten Menge. Das steht in SQL und lässt sich im Browser nicht
     ausführen; gelesen wird deshalb der Text der Migration. Eine Textprüfung
     ist schwach, aber sie fängt den Weg, auf dem das zurückfiele: jemand
     hängt die Kachel wieder an `benannt`.
   * IN DER ANZEIGE. Kommt ein Name, muss er dastehen; kommt keiner (leerer
     Anzeigename), die Ersatzbezeichnung. Das ist der Rest des alten
     Verhaltens und der einzige Weg, ungenannt zu bleiben.

   UND DIE ZUSAGE MUSS MITWANDERN. Die Einstellung versprach wörtlich „Auch in
   den Kacheln bleibst du ungenannt". Ein Satz, der nach der Änderung das
   Gegenteil dessen behauptet, was geschieht, ist schlimmer als die Änderung
   selbst — deshalb wird hier auch der Text geprüft, in allen fünf Sprachen. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "mitglieder";

const MIGRATION = "supabase/migrations/20260802210000_mitglied_immer_benannt.sql";

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Abfrage ---------------------------------------------------- */
  const sql = await readFile(join(wurzel, MIGRATION), "utf8");
  const fn = sql.slice(sql.indexOf("create or replace function public.community_highlights"));
  stand.ist("die Migration ersetzt community_highlights", fn.length > 400, fn.length + " Zeichen");

  // Der Block, aus dem das neueste Mitglied gelesen wird.
  const kachel = fn.slice(fn.indexOf("'newest_member'"), fn.indexOf("'biggest_collection'"));
  stand.ist("das neueste Mitglied kommt aus `mitglieder`, nicht aus `benannt`",
    /from mitglieder\b/.test(kachel) && !/from benannt\b/.test(kachel),
    kachel.replace(/\s+/g, " ").trim());

  const quelle = fn.slice(fn.indexOf("mitglieder as ("), fn.indexOf("karten as ("));
  stand.ist("und `mitglieder` filtert weder nach Stufe …",
    !/community_visibility/.test(quelle), quelle.replace(/\s+/g, " ").slice(0, 150));
  stand.ist("… noch unterdrückt es den Namen",
    !/case when/.test(quelle) && /display_name/.test(quelle));

  /* Was NICHT mitwandern durfte: Die übrigen Kacheln hängen weiter an den
     Stufen. Sonst hätte die Änderung die Einstellung ganz ausgehebelt. */
  const gross = fn.slice(fn.indexOf("'biggest_collection'"), fn.indexOf("'newest_card'"));
  stand.ist("„größte Sammlung“ hängt weiter an `benannt`",
    /join benannt\b/.test(gross), gross.replace(/\s+/g, " ").trim().slice(0, 120));
  stand.ist("die Karten weiterhin an `sichtbar` (privat fällt heraus)",
    /join sichtbar s on s\.id = c\.user_id/.test(fn));
  stand.ist("und `sichtbar` schließt private Profile weiter aus",
    /coalesce\(community_visibility, 'public'\) <> 'private'/.test(fn));

  /* --- Die Anzeige ---------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);

  const zeige = (mitglied) => seite.evaluate(m => {
    COMMUNITY_HIGHLIGHTS = { newest_member: m, biggest_collection: null,
                             newest_card: null, oldest_card: null, priciest_card: null };
    const el = document.createElement("div");
    el.innerHTML = communityHighlightsHtml();
    const kachel = el.querySelector(".ch-tile");
    return kachel ? { wert: kachel.querySelector(".ch-v")?.textContent.trim(),
                      zusatz: kachel.querySelector(".ch-z")?.textContent.trim() } : null;
  }, mitglied);

  const mitName = await zeige({ name: "Mira Sonnenschein", since: "2026-08-02T10:00:00Z" });
  stand.gleich("kommt ein Name, steht er da", mitName?.wert, "Mira Sonnenschein");
  stand.ist("mit dem Beitrittsdatum daneben", /2026/.test(mitName?.zusatz || ""), mitName?.zusatz);

  /* Der einzige Weg, ungenannt zu bleiben: keinen Anzeigenamen führen. Dann
     kommt aus der Abfrage NULL, und die Ersatzbezeichnung tritt ein. */
  const ohneName = await zeige({ name: null, since: "2026-08-02T10:00:00Z" });
  stand.ist("ohne Anzeigenamen bleibt die Ersatzbezeichnung",
    ohneName?.wert === "Ein Mitglied", ohneName?.wert);
  const leer = await zeige({ name: "   ", since: "2026-08-02T10:00:00Z" });
  stand.ist("auch bei einem Namen aus lauter Leerzeichen",
    leer?.wert === "Ein Mitglied", leer?.wert);

  /* --- Die Zusage in den Einstellungen -------------------------------- */
  const texte = await seite.evaluate(() => {
    const spr = ["de", "en", "fr", "es", "it"];
    const raus = {};
    const vorher = LANG;
    for (const l of spr) {
      setLang(l);
      raus[l] = { anon: t("community.vis.anonymousHint"), mitglied: t("community.vis.memberNote") };
    }
    setLang(vorher);
    return raus;
  });
  /* Der alte Satz endete unqualifiziert — „Auch in den Kacheln bleibst du
     ungenannt". Der neue muss sagen, WELCHE Kacheln gemeint sind; sonst liest
     man weiterhin eine Zusage, die für die Mitgliederliste nicht mehr gilt.
     Geprüft wird deshalb, dass jede Sprache die Einschränkung nennt — eine
     Suche nach dem alten Wortlaut fänge eine Umformulierung nicht. */
  const eingeschraenkt = {
    de: /Karten und Sammlung/, en: /card and collection/i,
    fr: /cartes et collection/i, es: /cartas y colecci/i, it: /carte e collezione/i,
  };
  stand.gleich("jede Sprache sagt, welche Kacheln ungenannt bleiben",
    Object.entries(eingeschraenkt).filter(([l, re]) => re.test(texte[l].anon)).map(([l]) => l),
    ["de", "en", "fr", "es", "it"]);
  stand.gleich("und jede Sprache sagt die Ausnahme ausdrücklich",
    Object.entries(texte).filter(([, x]) => (x.mitglied || "").length > 40).map(([l]) => l),
    ["de", "en", "fr", "es", "it"]);

  /* Der Satz steht bei JEDER Stufe, nicht nur bei einer — sonst hielte man
     ihn für die Eigenheit der Stufe, unter der er zufällig steht. */
  const beiAllen = await seite.evaluate(() => {
    USER = { id: "u0" };
    const raus = {};
    for (const stufe of ["public", "anonymous", "private"]) {
      PROFILE = { community_visibility: stufe };
      renderSettings();
      raus[stufe] = [...document.querySelectorAll("#v-settings .hint")]
        .some(h => h.textContent.includes(t("community.vis.memberNote")));
    }
    return raus;
  });
  stand.gleich("der Hinweis steht bei allen drei Stufen", beiAllen,
    { public: true, anonymous: true, private: true });
}
