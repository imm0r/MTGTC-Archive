/* Die Mitgliederliste und das öffentliche Profil.

   Zwei Lücken auf einmal: Es gab keine Stelle, an der man sah, WER hier
   sammelt — nur eine Kachel mit einem einzigen Namen und eine Personensuche,
   die einen Namen verlangt, bevor sie etwas zeigt. Und die Angaben aus dem
   eigenen Profil (Steckbrief, Ort, Lieblingsformat, Website) bekam niemand je
   zu Gesicht. Ein Formular, dessen Inhalt nirgends erscheint, ist eine Falle:
   Man füllt es aus und hält sich für vorgestellt.

   Woran es hängt:

   * DER RICHTIGE KNOPF JE ZEILE. Das Verhältnis kommt aus derselben Abfrage
     mit; wäre es das nicht, bräuchte jede Zeile eine eigene Anfrage. Vier
     Zustände, und bei sich selbst gar keiner.
   * FINDABLE. Wer sich aus der Personensuche ausgetragen hat, steht auch hier
     nicht — die Zusage lautet „nur noch über deinen Freundescode erreichbar",
     und eine durchsuchbare Mitgliederliste wäre genau das, wovor sie schützt.
     Das steht in SQL und wird am Text der Migration geprüft.
   * DIE GESAMTZAHL kommt je Zeile mit (count(*) over ()). Bei null Treffern
     gibt es keine Zeile und damit keine Zahl — dann muss 0 dastehen und nicht
     „NaN".
   * DIE WEBSITE wird zum Verweis, aber nur mit http(s) davor. Ein
     javascript:-Ziel im Profil eines Fremden wäre der kürzeste Weg zu fremdem
     Code im eigenen Fenster. Geprüft wird beim Anzeigen, nicht nur beim
     Speichern. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "mitgliederliste";

const MIGRATION = "supabase/migrations/20260802230000_mitgliederliste.sql";

/* Vierundzwanzig Mitglieder in allen vier Verhältnissen, dazu man selbst und
   eines ohne Anzeigenamen. Läuft im Browser. */
const ATTRAPPE = () => {
  USER = { id: "u0", email: "ich@example.invalid" };
  PROFILE = { id: "u0", display_name: "Ich" };
  const stati = ["none", "friend", "sent", "incoming"];
  window.ALLE = Array.from({ length: 30 }, (_, i) => ({
    id: "m" + i,
    display_name: i === 3 ? null : "Mitglied " + i,
    avatar_url: null,
    created: `2026-0${1 + (i % 8)}-1${i % 9}T10:00:00Z`,
    last_seen: "2026-08-01T20:00:00Z",
    roles: i === 1 ? ["Admin", "Tester"] : [],
    status: i === 0 ? "self" : stati[i % 4],
  }));
  window.ABFRAGEN = [];
  window.mitgliederLaden = async (suche, seite) => {
    window.ABFRAGEN.push({ suche, seite });
    const treffer = window.ALLE.filter(m => !suche
      || (m.display_name || "").toLowerCase().includes(suche.toLowerCase()));
    return treffer.slice(seite * 24, seite * 24 + 24)
      .map(m => ({ ...m, gesamt: treffer.length }));
  };
  window.PROFILGEHOLT = null;
  window.profilLaden = async (id) => { window.PROFILGEHOLT = id; return window.PROFIL_ANTWORT; };
  window.PROFIL_ANTWORT = {
    id: "m1", display_name: "Mitglied 1", avatar_url: null,
    created: "2026-02-11T10:00:00Z", last_seen: "2026-08-01T20:00:00Z",
    bio: "Sammelt seit 1998.\nSpielt am liebsten Grün.",
    location: "Bremen", website: "https://example.invalid/mira",
    favourite_format: "Commander", roles: ["Admin"], is_friend: false,
  };
  MITGLIEDER = { zeilen: [], gesamt: 0, seite: 0, suche: "", laedt: false, fehler: null };
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-community"));
  renderCommunity();
};

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Abfrage ---------------------------------------------------- */
  const datei = await readFile(join(wurzel, MIGRATION), "utf8");
  stand.ist("die Migration legt member_list an",
    /create function public\.member_list/.test(datei));
  /* Ab HIER gelesen, nicht ab Dateianfang: Der Kopfkommentar erklärt die
     Abfrage und zitiert sie dabei — eine Suche über die ganze Datei fand
     „count(*) over ()" also auch dann noch, als es aus dem Code verschwunden
     war. Nachgemessen: Die Sabotage blieb grün. */
  const sql = datei.slice(datei.indexOf("create function public.member_list"));
  stand.ist("sie achtet auf findable",
    /coalesce\(p\.findable, true\)/.test(sql), (sql.match(/.*findable.*/) || [])[0]?.trim());
  stand.ist("sie zählt die Gesamtmenge je Zeile mit",
    /count\(\*\) over \(\)/.test(sql));
  stand.ist("sie liefert das Verhältnis gleich mit",
    /'friend'/.test(sql) && /'sent'/.test(sql) && /'incoming'/.test(sql) && /'self'/.test(sql));
  stand.ist("und deckelt die Menge je Abruf",
    /least\(coalesce\(p_limit, 24\), 100\)/.test(sql));
  stand.ist("neueste zuerst", /order by s\.created desc/.test(sql));

  /* --- Die Liste ------------------------------------------------------ */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(ATTRAPPE);
  await seite.waitForTimeout(400);

  const liste = await seite.evaluate(() => ({
    karte: !!document.querySelector("#mitglieder-karte"),
    zeilen: document.querySelectorAll(".mitglied-zeile").length,
    gesamt: document.querySelector("#mitglieder-karte .hint")?.textContent.trim(),
    knoepfe: [...document.querySelectorAll(".mitglied-zeile")].slice(0, 5).map(z =>
      z.querySelector("[data-req]") ? "anfragen"
      : z.querySelector("[data-accept2]") ? "annehmen"
      : z.querySelector("[data-dmwith]") ? "schreiben"
      : (z.querySelector(".pill")?.textContent || "").trim()),
    erste: document.querySelector(".mitglied-name")?.textContent.trim(),
    ohneName: [...document.querySelectorAll(".mitglied-name")]
      .some(n => n.textContent.trim() === "Ein Mitglied"),
    rollen: [...document.querySelectorAll(".mitglied-zeile .pill.rolle")].map(r => r.textContent),
    blaettern: !!document.querySelector("#mit-vor"),
  }));
  stand.ist("die Karte steht in der Community-Ansicht", liste.karte);
  stand.ist("eine Seite zeigt 24 Mitglieder", liste.zeilen === 24, liste.zeilen);
  stand.ist("die Gesamtzahl steht in der Überschrift", /30/.test(liste.gesamt || ""), liste.gesamt);
  stand.gleich("jede Zeile trägt den Knopf, der zum Verhältnis passt",
    liste.knoepfe, ["Du", "schreiben", "wartet", "annehmen", "anfragen"]);
  stand.ist("ein Mitglied ohne Anzeigenamen steht mit der Ersatzbezeichnung da",
    liste.ohneName);
  stand.gleich("Rollen stehen als Marken daneben", liste.rollen, ["Admin", "Tester"]);
  stand.ist("bei mehr als einer Seite lässt sich blättern", liste.blaettern);

  /* --- Blättern und Suchen -------------------------------------------- */
  await seite.click("#mit-vor");
  await seite.waitForTimeout(300);
  const s2 = await seite.evaluate(() => ({
    abfrage: window.ABFRAGEN[window.ABFRAGEN.length - 1],
    zeilen: document.querySelectorAll(".mitglied-zeile").length,
    zurueck: !document.querySelector("#mit-zurueck")?.disabled,
    vor: !document.querySelector("#mit-vor")?.disabled,
  }));
  stand.gleich("die zweite Seite holt den passenden Ausschnitt", s2.abfrage, { suche: "", seite: 1 });
  stand.ist("und zeigt den Rest", s2.zeilen === 6, s2.zeilen);
  stand.gleich("zurück geht, vor nicht mehr", [s2.zurueck, s2.vor], [true, false]);

  await seite.fill("#mit-suche", "Mitglied 1");
  await seite.waitForTimeout(500);
  const suche = await seite.evaluate(() => ({
    abfrage: window.ABFRAGEN[window.ABFRAGEN.length - 1],
    zeilen: document.querySelectorAll(".mitglied-zeile").length,
    fokus: document.activeElement?.id,
  }));
  stand.gleich("die Suche beginnt wieder auf Seite eins",
    suche.abfrage, { suche: "Mitglied 1", seite: 0 });
  stand.ist("und zeigt nur die Treffer", suche.zeilen === 11, suche.zeilen);   // 1, 10-19
  stand.ist("der Fokus bleibt im Suchfeld", suche.fokus === "mit-suche", suche.fokus);

  await seite.fill("#mit-suche", "gibtsnicht");
  await seite.waitForTimeout(500);
  stand.ist("ohne Treffer steht ein Satz statt einer leeren Fläche",
    await seite.evaluate(() => /Niemand/.test(document.querySelector("#mitglieder-liste").textContent)));
  await seite.fill("#mit-suche", "");
  await seite.waitForTimeout(500);

  /* --- Das öffentliche Profil ----------------------------------------- */
  await seite.evaluate(() => document.querySelectorAll("[data-mitglied]")[1].click());
  await seite.waitForTimeout(400);
  const profil = await seite.evaluate(() => {
    const b = document.querySelector("#pp-body");
    if (!b) return null;
    const zeilen = [...b.querySelectorAll(".pp-zeile")].map(z => [
      z.querySelector(".pp-k").textContent.trim(), z.querySelector(".pp-v").textContent.trim()]);
    return { geholt: window.PROFILGEHOLT, name: b.querySelector("h3")?.textContent.trim(),
             bio: b.querySelector(".pp-bio")?.textContent, zeilen,
             rollen: [...b.querySelectorAll(".pp-rollen .pill")].map(r => r.textContent),
             link: b.querySelector(".pp-v a")?.getAttribute("href"),
             ziel: b.querySelector(".pp-v a")?.getAttribute("rel"),
             hinweis: /nicht befreundet/.test(b.textContent) };
  });
  stand.ist("ein Klick auf den Namen holt genau dieses Profil",
    profil?.geholt === "m1", profil?.geholt);
  stand.gleich("der Name steht im Kopf", profil?.name, "Mitglied 1");
  stand.ist("der Steckbrief steht da, mit seinen Zeilenumbrüchen",
    /1998/.test(profil?.bio || "") && /\n/.test(profil?.bio || ""));
  stand.gleich("Ort und Lieblingsformat stehen da",
    (profil?.zeilen || []).filter(([, v]) => ["Bremen", "Commander"].includes(v)).map(([, v]) => v),
    ["Bremen", "Commander"]);
  stand.gleich("die Rollen ebenfalls", profil?.rollen, ["Admin"]);
  stand.gleich("die Website wird zum Verweis", profil?.link, "https://example.invalid/mira");
  stand.ist("und trägt noopener", /noopener/.test(profil?.ziel || ""), profil?.ziel);
  stand.ist("ohne Freundschaft steht der Hinweis dazu", profil?.hinweis);

  /* Ein javascript:-Ziel darf NIE zu einem Verweis werden. Das ist der
     kürzeste Weg zu fremdem Code im eigenen Fenster, und die Angabe stammt
     aus dem Profil eines Fremden. */
  await seite.evaluate(() => document.querySelector("#dlg")?.close());
  await seite.waitForTimeout(150);
  await seite.evaluate(() => {
    window.PROFIL_ANTWORT = { ...window.PROFIL_ANTWORT,
      website: "javascript:alert(1)", bio: "<img src=x onerror=alert(1)>" };
  });
  await seite.evaluate(() => document.querySelectorAll("[data-mitglied]")[1].click());
  await seite.waitForTimeout(400);
  const boese = await seite.evaluate(() => {
    const b = document.querySelector("#pp-body");
    return { links: b.querySelectorAll("a").length,
             bilder: b.querySelectorAll("img[onerror], img[src='x']").length,
             text: b.textContent.includes("javascript:alert(1)") };
  });
  stand.gleich("ein javascript:-Ziel wird kein Verweis", boese.links, 0);
  stand.ist("… sondern bleibt Text", boese.text);
  stand.gleich("und Markup im Steckbrief bleibt Text", boese.bilder, 0);
}
