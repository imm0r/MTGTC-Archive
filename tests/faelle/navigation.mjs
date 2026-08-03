/* Die oberste Navigation.

   Sie besteht aus sieben Knöpfen mit gemaltem Sinnbild, und an ihr sind schon
   zwei Dinge still danebengegangen — beide sehen nicht wie ein Fehler aus:

   * DER TEXT DARF NICHT AM KNOPF HÄNGEN. `applyI18n()` setzt `textContent`,
     und das ersetzt ALLES im Element — auch das <img> daneben. Steht das
     Wort direkt am Knopf statt in einem eigenen <span>, sind beim ERSTEN
     Sprachwechsel alle Bilder weg. Beim Laden ist noch alles da; auffallen
     würde es also erst dem, der die Sprache umstellt.
   * EINE FEHLENDE BILDDATEI VERSCHWINDET NICHT. Ein <img> mit leerem `alt`
     und fester Größe bleibt als 32 px breites Loch neben dem Wort stehen,
     im Prüfbrowser nachgemessen. Der Knopf tut, was er soll, und sieht
     trotzdem kaputt aus. Dagegen steht navSymboleAbsichern().

   Dazu die Frage, wer oben wohnt. „Community“ trägt Mitgliederliste,
   Community-Decks und Live-Feed; „Regelfrage“ und „live Partie“ braucht man
   MITTEN IM SPIEL. Alle drei stehen deshalb oben — und NUR oben. Ein zweiter
   Eintrag im Benutzermenü wäre ein zweiter Ort für dieselbe Frage. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "navigation";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(300);

  /* --- Wer oben steht -------------------------------------------------- */
  stand.gleich("die obersten Punkte stehen in dieser Reihenfolge",
    await seite.evaluate(() =>
      [...document.querySelectorAll("nav > button[data-v]")].map(b => b.dataset.v)),
    ["coll", "decks", "wish", "more", "community", "rules", "session"]);

  /* Jeder der drei Umzügler steht GENAU EINMAL da. Ein Eintrag, der oben
     dazukam und unten stehen blieb, ist zweimal derselbe Ort für dieselbe
     Frage — und fiele niemandem auf, weil beide funktionieren. */
  stand.gleich("jeder umgezogene Punkt steht genau einmal im Dokument",
    await seite.evaluate(() => ["community", "rules", "session"]
      .map(v => document.querySelectorAll(`[data-v="${v}"]`).length)), [1, 1, 1]);
  stand.gleich("und keiner mehr im Benutzermenü",
    await seite.evaluate(() => ["community", "rules", "session"]
      .filter(v => document.querySelector(`#who-menu [data-v="${v}"]`))), []);

  /* --- Aufbau eines Punktes -------------------------------------------- */
  const bau = await seite.evaluate(() => {
    const b = document.querySelector('nav > button[data-v="community"]');
    const im = b.querySelector("img.nav-sym");
    const sp = b.querySelector('span[data-i18n="nav.community"]');
    return {
      bild: im ? new URL(im.getAttribute("src"), location.href).pathname : null,
      alt: im?.getAttribute("alt"),
      spanDa: !!sp,
      // Der Knopf SELBST darf keine Übersetzungsmarke tragen — sonst räumt
      // applyI18n() beim Sprachwechsel das Bild mit ab.
      markeAmKnopf: b.hasAttribute("data-i18n"),
    };
  });
  stand.gleich("der Knopf zeigt auf assets/community.PNG", bau.bild, "/assets/community.PNG");
  stand.gleich("das Sinnbild trägt leeres alt — es sagt nichts, was der Text nicht sagt",
    bau.alt, "");
  stand.ist("das Wort steht in einem eigenen span", bau.spanDa);
  stand.ist("und die Übersetzungsmarke NICHT am Knopf", !bau.markeAmKnopf);

  /* --- Der Sprachwechsel ----------------------------------------------- */
  /* Der eigentliche Grund für die span-Regel. Gemessen wird an ALLEN sieben
     Punkten, nicht nur am neuen: Der Fehler träfe sie alle gleichzeitig.
     Der Text wird dabei am KNOPF abgelesen und nicht am span — sonst misst
     dieser Block mit, WO das Wort steht, und liefe bei falscher Auszeichnung
     in einen Ausnahmefehler statt in eine rote Zeile. Wo es steht, sagt der
     Block darüber; hier zählt allein, ob das Bild den Wechsel übersteht. */
  const stand5 = () => ({
    bilder: document.querySelectorAll("nav > button .nav-sym").length,
    sammlung: document.querySelector('nav > button[data-v="coll"]').textContent.trim(),
    community: document.querySelector('nav > button[data-v="community"]').textContent.trim(),
  });
  const vorher = await seite.evaluate(stand5);
  await seite.evaluate(() => setLang("en"));
  await seite.waitForTimeout(200);
  const nachher = await seite.evaluate(stand5);
  stand.gleich("vor dem Sprachwechsel tragen sieben Punkte ein Sinnbild", vorher.bilder, 7);
  stand.gleich("danach immer noch", nachher.bilder, 7);
  stand.ist("und der Text ist wirklich umgestellt worden",
    vorher.sammlung === "Sammlung" && nachher.sammlung === "Collection",
    `${vorher.sammlung} → ${nachher.sammlung}`);
  stand.gleich("Community heißt in jeder Sprache Community", nachher.community, "Community");
  await seite.evaluate(() => setLang("de"));
  await seite.waitForTimeout(200);

  /* --- Die Umbenennung ------------------------------------------------- */
  /* „Spielrunde" heißt auf Deutsch jetzt „live Partie". Geprüft an ALLEN
     deutschen Zeichenketten und nicht nur am Navigationspunkt: Ein Wort,
     das an einer Stelle umbenannt wird und an fünf anderen stehen bleibt,
     ist keine Umbenennung, sondern zwei Namen für dieselbe Sache.
     Die anderen Sprachen sind ausdrücklich NICHT betroffen — gefragt war
     die deutsche Bezeichnung. */
  const worte = await seite.evaluate(() => ({
    reste: Object.entries(I18N.de).filter(([, v]) => /Spielrunde/.test(String(v))).map(([k]) => k),
    punkt: document.querySelector('nav > button[data-v="session"] span[data-i18n]')?.textContent,
    englisch: I18N.en["nav.session"],
  }));
  stand.gleich("im Deutschen steht nirgends mehr „Spielrunde“", worte.reste, []);
  stand.gleich("der Punkt heißt „live Partie“", worte.punkt, "live Partie");
  stand.ist("die anderen Sprachen bleiben, wie sie waren",
    !!worte.englisch && !/live Partie/.test(worte.englisch), worte.englisch);

  /* Die Zahl der offenen Einladungen hängt am Knopf und muss den Umzug
     mitgemacht haben — ohne sie erführe man von einer Einladung erst, wenn
     man von sich aus nachsieht. */
  stand.ist("die Einladungszahl sitzt im Punkt „live Partie“",
    await seite.evaluate(() =>
      !!document.querySelector('nav > button[data-v="session"] #sess-badge')));

  /* --- Der Klick -------------------------------------------------------- */
  /* Die Verdrahtung läuft im Start nur MIT Datenbankzugang — hier von Hand,
     wie in den Fällen „sammlung“ und „wunschliste“. renderCommunity() wird
     dabei ersetzt: Geprüft wird der Weg dorthin, nicht die Ansicht selbst
     (die hat ihre eigenen Fälle) — und ohne Datenbank käme sie ohnehin nicht
     weit. */
  await seite.evaluate(() => {
    window.GERUFEN = 0;
    renderCommunity = () => { window.GERUFEN++; };
    wireApp();
  });
  await seite.click('nav > button[data-v="community"]');
  await seite.waitForTimeout(200);
  const nachKlick = await seite.evaluate(() => ({
    ansicht: [...document.querySelectorAll(".view.on")].map(v => v.id),
    an: [...document.querySelectorAll("nav button.on")].map(b => b.dataset.v),
    gerufen: window.GERUFEN,
  }));
  stand.gleich("der Klick öffnet die Community-Ansicht", nachKlick.ansicht, ["v-community"]);
  stand.gleich("und markiert genau diesen einen Punkt", nachKlick.an, ["community"]);
  stand.gleich("die Ansicht wird dabei einmal aufgebaut", nachKlick.gerufen, 1);

  /* --- Fehlt eine Bilddatei -------------------------------------------- */
  /* Der Rückfall, ohne den ein noch nicht hochgeladenes Sinnbild ein Loch in
     die Kopfzeile schlägt. Geprüft an einem eigens erfundenen Pfad und nicht
     an einem echten Knopf: So bleibt der Fall auch dann aussagekräftig, wenn
     jede Datei an ihrem Platz liegt. */
  const rueckfall = await seite.evaluate(async () => {
    const b = document.querySelector('nav > button[data-v="community"]');
    const im = document.createElement("img");
    im.className = "nav-sym";
    im.alt = "";
    im.src = "assets/gibt-es-nicht-" + performance.now() + ".PNG";
    b.prepend(im);
    navSymboleAbsichern();
    await new Promise(f => setTimeout(f, 400));
    return { fehlt: im.classList.contains("fehlt"),
             breite: Math.round(im.getBoundingClientRect().width) };
  });
  stand.ist("ein nicht ladbares Sinnbild wird als fehlend gekennzeichnet", rueckfall.fehlt);
  stand.gleich("und nimmt danach keinen Platz mehr ein", rueckfall.breite, 0);

  /* Die zweite Reihenfolge, und die ist die unangenehmere: War das Bild schon
     durch, bevor jemand hinsah, meldet sich `error` NIE MEHR. Wer nur den
     Zuhörer anhängt, kommt bei jedem schnellen Laden zu spät — und genau dann
     steht das Loch da. */
  const zuSpaet = await seite.evaluate(async () => {
    const b = document.querySelector('nav > button[data-v="community"]');
    const im = document.createElement("img");
    im.className = "nav-sym";
    im.alt = "";
    im.src = "assets/auch-nicht-da-" + performance.now() + ".PNG";
    b.prepend(im);
    // ERST fehlschlagen lassen, DANN absichern.
    await new Promise(f => setTimeout(f, 400));
    const vorher = im.complete && !im.naturalWidth;
    navSymboleAbsichern();
    return { schonDurch: vorher, fehlt: im.classList.contains("fehlt") };
  });
  stand.ist("das Bild war zum Zeitpunkt der Absicherung schon durchgefallen", zuSpaet.schonDurch);
  stand.ist("auch dann wird es noch als fehlend erkannt", zuSpaet.fehlt);

  /* Die andere Hälfte derselben Regel: Ein Bild, das LÄDT, darf nicht
     verschwinden. Ohne diese Zeile bliebe „display:none für alle“ grün. */
  stand.gleich("ein vorhandenes Sinnbild bleibt stehen",
    await seite.evaluate(() =>
      [...document.querySelectorAll("nav > button .nav-sym")]
        .filter(i => i.naturalWidth > 0 && i.classList.contains("fehlt"))
        .map(i => i.getAttribute("src"))), []);

  /* Und die Aussage, auf die es dem Betrachter ankommt: Kein Knopf steht mit
     einem leeren Kasten da — jedes Sinnbild ist entweder geladen oder weg.
     Diese Zeile bleibt richtig, egal welche Dateien schon hochgeladen sind. */
  stand.gleich("kein Knopf zeigt einen leeren Bildkasten",
    await seite.evaluate(() =>
      [...document.querySelectorAll("nav > button .nav-sym")]
        .filter(i => i.complete && !i.naturalWidth && i.getBoundingClientRect().width > 0)
        .map(i => i.getAttribute("src"))), []);
}
