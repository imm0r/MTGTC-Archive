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

  /* --- Die Leiste bleibt eine Zeile ------------------------------------ */
  /* Sieben Punkte mit Wort passen nicht mehr überall. Bricht die Kopfzeile um,
     ist das kein Schönheitsfehler: Sie klebt oben (position:sticky) und nimmt
     dem Inhalt die Höhe dauerhaft weg — gemessen 229 statt 67 px bei 560.

     Gemessen wird in FRANZÖSISCH, der breitesten der fünf Sprachen (volle
     Beschriftung verlangt dort 1420 px Fensterbreite, auf Deutsch 1353). Eine
     Schwelle, die nur in der eigenen Sprache stimmt, ist keine — genau das
     wäre bei 1360 passiert. */
  /* WIE IM ECHTEN BETRIEB messen, nicht wie in der Attrappe: Rechts stehen
     Avatar und Name, und die kosten rund 190 px. Ohne sie fiele die Messung um
     genau diese Breite zu günstig aus — eine Schwelle, die nur im
     abgemeldeten Zustand hält, hilft niemandem.
     Dazu eine Zahl an der Wunschliste, damit sich prüfen lässt, dass sie beim
     Ausblenden der Wörter STEHEN bleibt. */
  await seite.evaluate(() => {
    const who = document.querySelector("#who");
    // Genau das Gerüst, das zeigeKopfProfil() baut — samt Symbol im Winkel.
    // Nachgebaut statt echt geladen, weil hier die BREITE gemessen wird: Ein
    // Avatarbild, das erst später eintrifft, verschöbe jede Messung danach.
    who.innerHTML = `<span style="width:26px;height:26px;border-radius:50%;background:#444;display:inline-block"></span><span>Sturmprophet</span><span class="who-caret"><svg class="ic" aria-hidden="true"><use href="#ic-pfeil-ab"></use></svg></span>`;
    // BEIDE Zähler, und zwar zweistellig: Sie kosten zusammen rund 40 px, und
    // ohne sie bräche die Leiste genau dem auf, der eine Einladung offen hat.
    for (const id of ["wish-badge", "sess-badge"]) {
      const z = document.querySelector("#" + id);
      z.textContent = "12"; z.hidden = false;
    }
  });
  await seite.evaluate(() => setLang("fr"));
  const kopfhoehe = async (breite) => {
    await seite.setViewportSize({ width: breite, height: 800 });
    await seite.waitForTimeout(250);
    return seite.evaluate(() => {
      const k = [...document.querySelectorAll("nav > button")];
      return {
        kopf: Math.round(document.querySelector("header").getBoundingClientRect().height),
        zeilen: new Set(k.map(b => Math.round(b.getBoundingClientRect().top))).size,
        wort: getComputedStyle(k[0].querySelector("span[data-i18n]")).display !== "none",
        titel: k.every(b => (titelVon(b) || "").trim().length > 0),
        // Die Zahl an Wunschliste/live Partie ist KEIN Beschriftungs-span und
        // muss bleiben — sie ist der einzige Hinweis, dass etwas wartet.
        zahlDa: getComputedStyle(document.querySelector("#wish-badge")).display !== "none",
      };
    });
  };
  const breit = await kopfhoehe(1600);
  stand.gleich("breit: eine Zeile, 70 px, mit Wort",
    [breit.kopf, breit.zeilen, breit.wort], [70, 1, true]);

  /* KNAPP ÜBER DER SCHWELLE, wo die Beschriftung gerade noch erscheint. Das
     ist die Stelle, an der es zuerst kippt — und die einzige, die man beim
     Ändern der Bildgröße vergisst. Französisch mit beiden Zählern verlangt
     1450 px; die Grenze liegt darüber bei 1470. */
  const knapp = await kopfhoehe(1471);
  stand.gleich("knapp über der Schwelle steht das Wort und es bleibt eine Zeile",
    [knapp.kopf, knapp.zeilen, knapp.wort], [70, 1, true]);

  for (const b of [1470, 1366, 1200, 1024, 900, 768]) {
    const m = await kopfhoehe(b);
    stand.gleich(`bei ${b} px bleibt es eine Zeile à 67 px`, [m.kopf, m.zeilen], [67, 1]);
  }

  const schmal = await kopfhoehe(1200);
  stand.ist("dort steht das Wort nicht mehr da", !schmal.wort);
  stand.ist("dafür trägt JEDER Knopf einen Titel — sonst wäre er ein Rätsel", schmal.titel);
  stand.ist("und die Zahl der offenen Punkte bleibt sichtbar", schmal.zahlDa);

  /* UND SIE VERSCHWINDET, WENN NICHTS ANLIEGT. Das Attribut hidden wirkt nur
     über die Vorgabe des Browsers, und die verliert gegen jede Klassenregel
     mit display — .menu-badge trug display:inline-flex. Die Zähler an
     Wunschliste und live Partie standen dadurch IMMER da, mit einer Null
     darin: zwei gelbe Punkte in der Kopfzeile, die nichts bedeuteten.
     Geprüft an BEIDEN Zuständen; nur „sichtbar“ zu messen ließe die Regel
     „immer sichtbar“ durchgehen. */
  stand.ist("ohne offene Punkte ist die Zahl weg",
    await seite.evaluate(() => {
      const z = document.querySelector("#wish-badge");
      z.textContent = "0"; z.hidden = true;
      const weg = getComputedStyle(z).display === "none";
      z.textContent = "3"; z.hidden = false;
      return weg;
    }));

  /* Der Titel wandert mit der Sprache: Er ist jetzt die einzige Beschriftung,
     und eine Beschriftung, die auf Deutsch stehen bleibt, ist keine. */
  await seite.evaluate(() => setLang("de"));
  await seite.waitForTimeout(200);
  stand.gleich("der Titel wechselt mit der Sprache",
    await seite.evaluate(() => titelVon(document.querySelector('nav > button[data-v="coll"]'))),
    "Sammlung");

  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(250);

  /* --- Das große Sinnbild im Seitenrand -------------------------------- */
  /* Dasselbe Bild wie oben, nur groß und halb durchsichtig, links neben dem
     Inhalt. Zwei Dinge dürfen dabei nicht auseinanderlaufen:

     * ES MUSS DASSELBE BILD SEIN wie am Navigationspunkt. Zwei Listen von
       Pfaden — eine in index.html, eine in style.css — driften auseinander,
       sobald eine Datei umbenannt wird. Geprüft wird deshalb PAARWEISE gegen
       die Leiste und nicht gegen eine abgeschriebene Liste.
     * ES DARF NICHT ERSCHEINEN, WENN KEIN PLATZ IST. Ein Bild, das halb unter
       dem Inhalt liegt oder am Fensterrand abgeschnitten wird, ist schlechter
       als keines. */
  await seite.setViewportSize({ width: 2400, height: 900 });
  await seite.waitForTimeout(250);
  const rand = await seite.evaluate(() => {
    const raus = [];
    for (const b of document.querySelectorAll("nav > button[data-v]")) {
      const v = b.dataset.v;
      document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
      const st = getComputedStyle(document.querySelector("main"), "::before");
      raus.push({
        v,
        leiste: b.querySelector("img.nav-sym").getAttribute("src"),
        gross: (st.backgroundImage.match(/assets\/[^"')]+/) || [])[0] || null,
        sichtbar: st.display !== "none",
        deckkraft: st.opacity,
        breite: st.width,
        klickt: st.pointerEvents !== "none",
      });
    }
    return raus;
  });
  stand.gleich("jede der sieben Ansichten zeigt ein großes Sinnbild",
    rand.filter(r => r.sichtbar).length, 7);
  stand.gleich("und zwar dasselbe Bild wie am Punkt darüber",
    rand.filter(r => r.leiste !== r.gross).map(r => `${r.v}: ${r.leiste} ≠ ${r.gross}`), []);
  stand.gleich("halb durchsichtig", [...new Set(rand.map(r => r.deckkraft))], ["0.5"]);
  stand.ist("und größer als das in der Leiste",
    rand.every(r => parseInt(r.breite, 10) >= 200), rand[0]?.breite);
  stand.gleich("es fängt keinen Klick ab — es ist Schmuck, keine Schaltfläche",
    rand.filter(r => r.klickt).map(r => r.v), []);

  /* Eine Ansicht ohne Punkt in der Leiste (Profil) hat auch kein Sinnbild.
     Ohne diese Zeile bliebe „immer dasselbe Bild“ unbemerkt. */
  stand.ist("eine Ansicht ohne eigenen Punkt zeigt keines",
    await seite.evaluate(() => {
      document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-profile"));
      return getComputedStyle(document.querySelector("main"), "::before").display === "none";
    }));

  /* Und der Platz. Die Sammlung ist breiter als die übrigen Ansichten, ihre
     Schwelle liegt deshalb höher — bei 1920 px ist der Rand zu schmal, bei
     2000 reicht er. */
  const platz = async (breite, ansicht) => {
    await seite.setViewportSize({ width: breite, height: 900 });
    await seite.evaluate(v => {
      document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
    }, ansicht);
    await seite.waitForTimeout(200);
    const m = await seite.evaluate(() => {
      const el = document.querySelector("main");
      const st = getComputedStyle(el, "::before");
      return { sichtbar: st.display !== "none", breite: Math.round(el.getBoundingClientRect().width),
               links: Math.round(el.getBoundingClientRect().left) };
    });
    return m;
  };
  const engCo = await platz(1920, "coll");
  const weitCo = await platz(2000, "coll");
  const engCom = await platz(1600, "community");
  const weitCom = await platz(1700, "community");
  stand.ist("in der Sammlung bleibt es bei zu schmalem Rand weg", !engCo.sichtbar,
    `Rand ${engCo.links} px`);
  stand.ist("und erscheint, sobald er reicht", weitCo.sichtbar, `Rand ${weitCo.links} px`);
  stand.ist("die schmaleren Ansichten kommen früher dazu", weitCom.sichtbar && !engCom.sichtbar,
    `1600: Rand ${engCom.links}, 1700: Rand ${weitCom.links}`);
  stand.gleich("die Sammlung ist wieder schmaler als vorher (1400 statt 2400)",
    weitCo.breite, 1400);

  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.evaluate(() => {
    document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-coll"));
  });
  await seite.waitForTimeout(200);

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
