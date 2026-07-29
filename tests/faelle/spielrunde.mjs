/* Spielrunde: Karten von Zone zu Zone ziehen statt über Knöpfe schieben.

   Auf dem Schlachtfeld trug früher jede Karte vier Zielknöpfe — Friedhof,
   Exil, Hand, Bibliothek. Bei 62 px Kartenbreite war das eine Knopfleiste,
   breiter als die Karte, die sie bedient. Sie ist demselben Zug gewichen, der
   im Deck eine Karte in ein Fach schiebt.

   Zwei Dinge sind daran neu und deshalb hier festgehalten:

   * Die Zug-Maschine bedient jetzt ZWEI Arten (Fach und Zone). Was sie im Deck
     tat, muss sie weiter tun — das prüfen die Fälle „ziehen" und „zugabe"
     nebenan; hier wird die zweite Art geprüft.
   * Im Akkordeon ist immer nur eine Zone offen, und die Kopfzeilen klappen beim
     Überfahren auf. Während eines Zuges darf das NICHT geschehen: Sonst
     verschiebt sich das Layout unter dem Zeiger, und losgelassen wird über
     etwas anderem als dem, worauf man gezielt hat.

   Dazu die Anordnung der Matte, die sich mehrfach still verschieben kann:
   die Lebensreihe unter den Ländern, die vier Embleme darüber, und die
   Würfelbühne über allem. */

import { AUFBAU, PUNKT } from "../hilfen.mjs";

export const name = "spielrunde";

/* three.js kommt in der App von einem CDN. Auf dem Prüfrechner gibt es keins,
   und ohne Bibliothek liefe hier IMMER der SVG-Rückfall — der echte Würfel,
   den fast alle sehen, bliebe ungeprüft. Deshalb wird die Anfrage aus
   node_modules bedient, mit derselben Fassung, die auch die App lädt. */
const dreiDBereitstellen = (seite) => seite.route("https://cdn.jsdelivr.net/npm/three@**", r =>
  r.fulfill({ path: new URL("../node_modules/three/build/three.module.js", import.meta.url).pathname,
              headers: { "content-type": "text/javascript" } }));

/* Eine Partie ohne Datenbank: Sitzung, Spieler und Zonenstand von Hand
   gesetzt, das Schreiben abgefangen. Läuft IM BROWSER. */
const PARTIE = () => {
  const d = DECKS[0];
  const ids = d.entries.map(e => e.cardId);
  d.main_card_id = ids[0];             // damit die Kommandozone überhaupt dasteht

  USER = { id: "u0" };
  PROFILE = { display_name: "Ich" };
  SESSION = { id: "s0", host: "u0", start_life: 40, status: "open" };
  // Vier Mitspieler: die Zahl, für die die Lebensreihe ausgelegt ist. Mit
  // einem einzigen fiele nicht auf, wenn sie bei vieren umbräche oder rollte.
  SESSION_PLAYERS = ["Ich", "Mira", "Jonas", "Ada"].map((n, i) => ({
    user_id: "u" + i, life: 40 - i, status: "joined", seat: i,
    deck_id: d.id, deck_name: d.name, commander: null, commander_img: null,
    profile: { id: "u" + i, display_name: n },
  }));

  SESSION_ZONEN = {};
  const leer = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0 };
  const feld = ids.slice(1, 4), hand = ids.slice(4, 6);
  feld.forEach(id => { SESSION_ZONEN[id] = { ...leer, field: 1 }; });
  hand.forEach(id => { SESSION_ZONEN[id] = { ...leer, hand: 1 }; });

  // Ohne Datenbank käme sonst nur ein Fehlerton. Gemerkt wird, WAS geschrieben
  // würde — daran hängt, dass ein Zug überhaupt gespeichert wird.
  window.GESCHRIEBEN = [];
  window.zoneSchreiben = id => window.GESCHRIEBEN.push(id);
  // Ebenso der Wurf: Gemerkt wird, WAS in die Runde ginge — daran hängt, dass
  // die Mitspieler den Wurf überhaupt zu sehen bekommen.
  window.WUERFE = [];
  window.wurfSpeichern = (sides, result) => window.WUERFE.push({ sides, result });

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-session"));
  renderSession();
  return { feld, hand, cmd: ids[0] };
};

export default async function ({ seite, adresse, stand }) {
  await dreiDBereitstellen(seite);
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 10, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  const k = await seite.evaluate(PARTIE);
  await seite.waitForTimeout(400);

  stand.ist("die Matte steht (breites Fenster)",
    await seite.evaluate(() => MAT_AN && !!document.querySelector("#zonen.mat")));

  /* --- Die Zielknöpfe sind von den Karten verschwunden ------------------- */
  const knoepfe = await seite.evaluate(() => ({
    aufFeldkarten: document.querySelectorAll('.zk[data-zone="field"] [data-move]').length,
    aufHandkarten: document.querySelectorAll(".hand-karte [data-move]").length,
    tappen:        document.querySelectorAll('.zk[data-zone="field"] [data-tap]').length,
    marken:        document.querySelectorAll('.zk[data-zone="field"] [data-marke]').length,
    feldkarten:    document.querySelectorAll('.zk[data-zone="field"]').length,
  }));
  stand.gleich("weder Zielknöpfe noch Tappknopf auf den Karten",
    [knoepfe.aufFeldkarten, knoepfe.aufHandkarten, knoepfe.tappen], [0, 0, 0]);
  stand.ist("die Karten stehen trotzdem da", knoepfe.feldkarten === 3, knoepfe.feldkarten);
  stand.ist("die Marken sind geblieben (dafür gibt es keine Geste)",
    knoepfe.marken === 3, knoepfe.marken);

  /* Der Weg für Finger und Tastatur: In der angehefteten Kartenansicht stehen
     sie alle weiter — vier Zielzonen, ↻ und die beiden Marken. Fiele der weg,
     gäbe es auf einem Tablet überhaupt keinen Weg mehr, eine Karte vom
     Schlachtfeld herunterzubekommen. */
  await seite.evaluate(([id]) => zeigeSpielKarte(id, 300, 300, "field", true, 0), [k.feld[0]]);
  await seite.waitForTimeout(200);
  stand.gleich("in der angehefteten Kartenansicht stehen sie weiter",
    await seite.evaluate(() => ({
      ziele:  document.querySelectorAll(".spk [data-move]").length,
      tappen: document.querySelectorAll(".spk [data-tap]").length,
      marken: document.querySelectorAll(".spk [data-marke]").length })),
    { ziele: 4, tappen: 1, marken: 2 });
  await seite.evaluate(() => versteckeSpielKarte(true));
  await seite.waitForTimeout(150);

  /* --- Ein Klick tappt, ein Zug nicht ----------------------------------- */
  const kl = await seite.evaluate(PUNKT, '.zk[data-zone="field"]');
  stand.ist("eine Feldkarte ist anklickbar", !!kl);
  if (kl) {
    const zustand = () => seite.evaluate(([id]) => ({
      getappt: (feldListe(id)[0] || {}).t || 0,
      klasse:  !!document.querySelector(`.zk[data-id="${id}"].getappt`),
    }), [k.feld[0]]);
    stand.gleich("vorher steht sie aufrecht", await zustand(), { getappt: 0, klasse: false });
    await seite.mouse.click(kl.x, kl.y);
    await seite.waitForTimeout(200);
    stand.gleich("ein Klick tappt sie", await zustand(), { getappt: 1, klasse: true });
    await seite.mouse.click(kl.x, kl.y);
    await seite.waitForTimeout(200);
    stand.gleich("noch einer richtet sie wieder auf", await zustand(), { getappt: 0, klasse: false });
    // Und die Kartenansicht geht dabei NICHT auf — sonst stünde nach jedem
    // Tappen ein Fenster über dem Feld.
    stand.ist("die Kartenansicht bleibt dabei zu",
      await seite.evaluate(() => !document.querySelector(".spk.fest")));
  }

  /* Dieselbe Falle wie im Deck, und sie hat hier ein zweites Mal zugeschlagen:
     Ein <img> ist von Haus aus ziehbar. Der Browser startet über dem Kartenbild
     seinen EIGENEN Zug und meldet unseren Zeiger mit pointercancel ab — der Zug
     begann, wurde nach dem ersten pointermove abgeräumt, und nichts geschah. */
  stand.ist("die Kartenbilder sind nicht browserseitig ziehbar",
    await seite.evaluate(() => [...document.querySelectorAll(".zk img,.hand-karte img")]
      .every(i => i.getAttribute("draggable") === "false" &&
                  getComputedStyle(i).webkitUserDrag === "none")),
    await seite.evaluate(() => document.querySelectorAll(".zk img,.hand-karte img").length + " Bilder"));

  /* --- Jede Zone ist ein Ziel ------------------------------------------- */
  stand.gleich("jede Zone trägt ihr Ablagemerkmal",
    await seite.evaluate(() => [...new Set([...document.querySelectorAll("#zonen [data-zonedrop]")]
      .map(el => el.dataset.zonedrop))].sort()),
    ["cmd", "exile", "field", "grave", "hand", "lib"]);

  /* --- Vom Schlachtfeld auf den Friedhof -------------------------------- */
  const q = await seite.evaluate(PUNKT, '.zk[data-zone="field"]');
  stand.ist("eine Feldkarte ist erreichbar", !!q);
  if (q) {
    await seite.mouse.move(q.x, q.y);
    await seite.mouse.down();
    await seite.mouse.move(q.x, q.y + 40, { steps: 8 });

    const beim = await seite.evaluate(() => ({
      schild: !!document.querySelector(".zieh-geist"),
      quelle: document.querySelectorAll(".zk.zieht").length,
      ziele: [...document.querySelectorAll("#zonen [data-zonedrop].zieh-ziel")]
        .map(el => el.dataset.zonedrop).sort(),
      vorschau: !!document.querySelector(".spk.fest"),
      // Gibt es den Balken gar nicht, steht er auch nicht im Weg — `?.hidden`
      // wäre dann undefined und die Verneinung meldete fälschlich „steht da".
      balken: document.getElementById("kat-drop")?.hidden === false,
    }));
    stand.ist("das Schild hängt am Zeiger", beim.schild);
    stand.ist("die angehobene Karte ist markiert", beim.quelle === 1, beim.quelle);
    // Die eigene Zone nicht (dorthin wäre es kein Zug), die Kommandozone nicht
    // (dort liegen nur Commander) — genau die Regel der früheren Zielknöpfe.
    stand.gleich("nur die erlaubten Zonen leuchten vor",
      [...new Set(beim.ziele)], ["exile", "grave", "hand", "lib"]);
    stand.ist("die Kartenansicht macht Platz", !beim.vorschau);
    stand.ist("kein Fächer-Balken des Decks", !beim.balken);

    const ziel = await seite.evaluate(PUNKT, '#zonen [data-zonedrop="grave"]');
    stand.ist("der Friedhof ist erreichbar", !!ziel);
    if (ziel) {
      await seite.mouse.move(ziel.x, ziel.y, { steps: 8 });
      const hervor = await seite.evaluate(() => {
        const u = document.querySelectorAll("#zonen [data-zonedrop].ueber");
        return { anzahl: u.length, zone: u[0]?.dataset.zonedrop ?? null };
      });
      stand.gleich("genau der Friedhof leuchtet auf", [hervor.anzahl, hervor.zone], [1, "grave"]);

      await seite.mouse.up();
      await seite.waitForTimeout(200);
      stand.gleich("die Karte liegt jetzt im Friedhof",
        await seite.evaluate(([id]) => { const s = { hand: 0, field: 0, grave: 0, exile: 0, ...(SESSION_ZONEN[id] || {}) };
          return { field: s.field, grave: s.grave }; }, [k.feld[0]]),
        { field: 0, grave: 1 });
      stand.ist("und der Zug wurde zum Speichern angemeldet",
        await seite.evaluate(([id]) => window.GESCHRIEBEN.includes(id), [k.feld[0]]));
    }
  }

  stand.gleich("nach dem Zug bleibt keine Markierung stehen",
    await seite.evaluate(() => ({
      ueber: document.querySelectorAll("[data-zonedrop].ueber").length,
      vor:   document.querySelectorAll("[data-zonedrop].zieh-ziel").length,
      zieht: document.querySelectorAll(".zieht").length })),
    { ueber: 0, vor: 0, zieht: 0 });

  /* --- Eine verbotene Zone nimmt nichts an ------------------------------ */
  await seite.evaluate(() => { window.GESCHRIEBEN = []; });
  const q2 = await seite.evaluate(PUNKT, '.zk[data-zone="field"]');
  if (q2) {
    await seite.mouse.move(q2.x, q2.y);
    await seite.mouse.down();
    await seite.mouse.move(q2.x, q2.y + 40, { steps: 8 });
    const cmd = await seite.evaluate(PUNKT, '#zonen [data-zonedrop="cmd"]');
    stand.ist("die Kommandozone ist erreichbar", !!cmd);
    if (cmd) {
      await seite.mouse.move(cmd.x, cmd.y, { steps: 6 });
      stand.ist("sie leuchtet für eine normale Karte nicht auf",
        await seite.evaluate(() => document.querySelectorAll("[data-zonedrop].ueber").length) === 0);
    }
    await seite.mouse.up();
    await seite.waitForTimeout(150);
    stand.ist("und nimmt auch nichts an",
      await seite.evaluate(() => window.GESCHRIEBEN.length) === 0);
    /* Und der Klick, der jedem Loslassen folgt, tappt nichts. Ohne
       katKlickSchlucken drehte sich jede Karte, die man nur verschieben
       wollte — der Zug oben endete über der Kommandozone, dieser hier begann
       auf der Karte selbst. */
    stand.ist("ein Zug tappt die Karte nicht",
      await seite.evaluate(() => document.querySelectorAll(".zk.getappt").length) === 0,
      await seite.evaluate(() => document.querySelectorAll(".zk.getappt").length) + " getappt");
  }

  /* --- Die Lebenspunkte unter den Ländern ------------------------------- */
  /* Sie standen früher als schmale Spalte ganz rechts, eine Kachel über der
     anderen, und rollten bei vier Mitspielern innen. Jetzt laufen sie unter
     den Ländern über deren volle Breite, alle vier nebeneinander. */
  const leben = await seite.evaluate(() => {
    const B = s => document.querySelector(s).getBoundingClientRect();
    const feld = B(".mat-leben"), laender = B(".mat-laender");
    const korb = document.querySelector(".mat-leben .mat-korb");
    const k = [...document.querySelectorAll(".mat-leben .sp-card")].map(e => e.getBoundingClientRect());
    return {
      inLinks: document.querySelectorAll(".mat-links .mat-leben").length,
      alteSpalte: document.querySelectorAll(".mat-rechts").length,
      // Unter den Ländern und genau so breit wie sie.
      unterDenLaendern: Math.round(feld.top - laender.bottom),
      gleichBreit: [Math.round(feld.left - laender.left), Math.round(feld.right - laender.right)],
      anzahl: k.length,
      // Nebeneinander: gleiche Oberkante, aufsteigende linke Kanten.
      eineReihe: k.every(r => Math.abs(r.top - k[0].top) < 1),
      aufsteigend: k.every((r, i) => i === 0 || r.left > k[i - 1].left),
      gleichWeit: new Set(k.map(r => Math.round(r.width))).size === 1,
      // Kein Rollbalken: Bei vier Kacheln passte die Reihe zweimal knapp nicht.
      rollt: [korb.scrollHeight - korb.clientHeight, korb.scrollWidth - korb.clientWidth],
      // Und die Namen sind lesbar, statt auf null Pixel zusammenzufallen.
      namen: [...document.querySelectorAll(".mat-leben .sp-name")]
        .map(n => [Math.round(n.getBoundingClientRect().width), n.scrollWidth - n.clientWidth]),
    };
  });
  stand.gleich("die Lebenspunkte stehen in der linken Spalte, die alte rechte ist weg",
    [leben.inLinks, leben.alteSpalte], [1, 0]);
  stand.ist("unmittelbar unter den Ländern", leben.unterDenLaendern >= 0 && leben.unterDenLaendern <= 12,
    leben.unterDenLaendern + " px darunter");
  stand.gleich("und über deren volle Breite", leben.gleichBreit, [0, 0]);
  stand.gleich("alle vier Kacheln stehen nebeneinander und gleich breit",
    [leben.anzahl, leben.eineReihe, leben.aufsteigend, leben.gleichWeit], [4, true, true, true]);
  stand.gleich("die Reihe rollt nicht", leben.rollt, [0, 0]);
  stand.ist("und die Namen sind nicht auf null zusammengefallen",
    leben.namen.every(([b, ab]) => b >= 40 && ab === 0), JSON.stringify(leben.namen));

  /* --- Die vier Laden über den Lebenspunkten ---------------------------- */
  /* Würfel, Hand, Exil und Friedhof stehen als Embleme in einer Leiste am
     rechten unteren Rand des Schlachtfelds. Sieben Dinge können daran still
     schiefgehen, und alle sieben sind hier festgehalten. */
  const leiste = await seite.evaluate(() => {
    const zonen = [...document.querySelectorAll("#zonen .schwebe-zone")];
    const kn = z => document.querySelector(`.sz-${z} .schwebe-knopf`).getBoundingClientRect();
    const links = document.querySelector(".mat-links").getBoundingClientRect();
    const lebenOben = document.querySelector(".mat-leben").getBoundingClientRect().top;
    const reihe = ["wuerfel", "hand", "exile", "grave"];
    return {
      reihenfolge: zonen.map(z => [...z.classList].find(c => c.startsWith("sz-"))?.slice(3)),
      ziele: zonen.map(z => z.dataset.zonedrop ?? null),
      alteReihen: document.querySelectorAll(
        '.mat-hand, .mat-rechts [data-zone="grave"], .mat-mitte [data-zone="exile"], #dice-box').length,
      // Alle vier im Streifen des Schlachtfelds, keiner unter der schmalen Spalte.
      inLinks: reihe.every(z => kn(z).left > links.left && kn(z).right < links.right),
      // Von links nach rechts: Würfel, Hand, Exil, Friedhof.
      vonLinks: reihe.every((z, i) => i === 0 || kn(z).left > kn(reihe[i - 1]).right),
      // ÜBER den Lebenspunkten, nicht darauf.
      ueberLeben: reihe.map(z => Math.round(lebenOben - kn(z).bottom)),
      // Die Klammer muss durchlässig sein, sonst finge sie Klicks ab, die dem
      // Schlachtfeld darunter gelten. Bei Hand und Würfel wäre das die GANZE Matte.
      klammer: zonen.map(z => getComputedStyle(z).pointerEvents),
      knopf: getComputedStyle(zonen[0].querySelector(".schwebe-knopf")).pointerEvents,
      // Körbe haben nur die drei Zonen — der Würfel ist keine Lade.
      koerbeZu: zonen.filter(z => z.dataset.zonedrop)
        .every(z => getComputedStyle(z.querySelector(".schwebe-korb")).visibility === "hidden"),
      zahlen: zonen.filter(z => z.dataset.zonedrop).map(z => z.querySelector(".schwebe-n").textContent),
      // Der Würfel trägt statt einer Anzahl den letzten Wurf — vor dem ersten
      // einen matten Gedankenstrich, damit der Platz erkennbar bleibt.
      wuerfelZahl: document.querySelector(".sz-wuerfel .schwebe-n")?.textContent,
      wuerfelMatt: document.querySelector(".sz-wuerfel .schwebe-n")?.classList.contains("null"),
    };
  });
  stand.gleich("vier Laden statt Reihen auf der Matte",
    [leiste.reihenfolge, leiste.alteReihen],
    [["wuerfel", "hand", "exile", "grave"], 0]);
  stand.gleich("die drei Zonen sind Ablageziel, der Würfel nicht",
    leiste.ziele, [null, "hand", "exile", "grave"]);
  stand.ist("alle vier stehen im Streifen des Schlachtfelds", leiste.inLinks);
  stand.ist("von links nach rechts: Würfel, Hand, Exil, Friedhof", leiste.vonLinks);
  stand.ist("und alle über den Lebenspunkten",
    leiste.ueberLeben.every(a => a >= 0 && a <= 24),
    leiste.ueberLeben.join(", ") + " px darüber");
  stand.ist("zugeklappt sind alle Körbe weggenommen", leiste.koerbeZu);
  stand.gleich("die Klammern lassen Klicks durch, die Schaltflächen nicht",
    [leiste.klammer, leiste.knopf], [["none", "none", "none", "none"], "auto"]);
  stand.gleich("die Zonen nennen ihre Anzahl, der Würfel den letzten Wurf",
    [leiste.zahlen, leiste.wuerfelZahl, leiste.wuerfelMatt],
    [["2", "0", "1"], "–", true]);

  /* Jede Schaltfläche IST ihr Emblem: kein Beiwort daneben, und die Zahl steht
     unten rechts darauf statt daneben. */
  const sym = await seite.evaluate(() => [...document.querySelectorAll(".schwebe-zone[data-zonedrop]")].map(z => {
    const bild = z.querySelector(".schwebe-bild");
    const s = z.querySelector(".schwebe-sym").getBoundingClientRect();
    const n = z.querySelector(".schwebe-n").getBoundingClientRect();
    return {
      zone: z.dataset.zone,
      quelle: bild?.getAttribute("src") ?? null,
      geladen: !!bild && bild.complete && bild.naturalWidth > 0,
      ersatzVersteckt: getComputedStyle(z.querySelector(".schwebe-ersatz")).display === "none",
      // Mittelpunkt der Zahl im unteren rechten Viertel des Symbols.
      untenRechts: n.left + n.width / 2 > s.left + s.width / 2 &&
                   n.top + n.height / 2 > s.top + s.height / 2 &&
                   n.left + n.width / 2 < s.right && n.top + n.height / 2 < s.bottom,
      anteil: Math.round(n.width / s.width * 100),
      beschriftung: z.querySelector(".schwebe-knopf").getAttribute("aria-label"),
    };
  }));
  stand.ist("alle Schaltflächen tragen ihr Emblem", sym.every(x => x.geladen),
    sym.map(x => x.quelle).join(" · "));
  stand.ist("auch der Würfel, mit eigenem Bild",
    await seite.evaluate(() => { const b = document.querySelector(".sz-wuerfel .schwebe-bild");
      return !!b && b.complete && b.naturalWidth > 0 && /roll-the-dice/i.test(b.getAttribute("src")); }),
    await seite.evaluate(() => document.querySelector(".sz-wuerfel .schwebe-bild")?.getAttribute("src")));
  stand.ist("die Ersatzzeichen bleiben dabei versteckt", sym.every(x => x.ersatzVersteckt));
  stand.ist("die Zahl steht jeweils unten rechts auf dem Symbol", sym.every(x => x.untenRechts));
  stand.ist("und erschlägt es nicht", sym.every(x => x.anteil <= 40),
    sym.map(x => x.zone + ": " + x.anteil + " %").join(", "));
  // Der sichtbare Text ist weg — für Vorleseprogramme muss die Anzahl deshalb
  // in die Beschriftung, sonst wäre sie dort gar nicht mehr vorhanden.
  stand.ist("die Beschriftungen nennen Zone und Anzahl",
    sym.every(x => /\d/.test(x.beschriftung || "")),
    sym.map(x => x.beschriftung).join(" | "));

  /* Nur EINE auf einmal: Die Körbe sind breiter als ihre Schaltflächen und
     lägen offen übereinander. */
  await seite.locator('[data-schwebe="grave"]').click();
  await seite.waitForTimeout(400);
  const friedhof = await seite.evaluate(() => {
    const z = document.querySelector('.schwebe-zone[data-zone="grave"]');
    const korb = z.querySelector(".schwebe-korb");
    const kr = korb.getBoundingClientRect();
    const mat = document.querySelector(".mat").getBoundingClientRect();
    const knopf = z.querySelector(".schwebe-knopf").getBoundingClientRect();
    return {
      offen: [...document.querySelectorAll(".schwebe-zone.offen")].map(e => e.dataset.zone),
      karten: korb.querySelectorAll(".zk").length,
      // Der Friedhof bekommt Rahmen UND Grund — anders als die Hand.
      rahmen: getComputedStyle(korb).borderTopWidth,
      grund: getComputedStyle(korb).backgroundColor,
      // Er klappt nach oben aus und bleibt dabei in der Matte.
      ueberDemKnopf: Math.round(knopf.top - kr.bottom) >= 0,
      inDerMatte: Math.round(kr.left - mat.left) >= 0 && Math.round(mat.bottom - kr.bottom) >= 0
                  && Math.round(kr.top - mat.top) >= 0,
    };
  });
  stand.gleich("ein Klick klappt den Friedhof auf", friedhof.offen, ["grave"]);
  stand.ist("die Friedhofskarten liegen darin", friedhof.karten === 1, friedhof.karten);
  stand.ist("er trägt Rahmen und Grund", friedhof.rahmen !== "0px" && friedhof.grund !== "rgba(0, 0, 0, 0)",
    `${friedhof.rahmen} / ${friedhof.grund}`);
  stand.ist("und klappt nach oben aus", friedhof.ueberDemKnopf);
  stand.ist("dabei bleibt er innerhalb der Matte", friedhof.inDerMatte);

  /* Das Exil teilt sich die Mechanik mit dem Friedhof — geprüft wird deshalb
     nur, was an ihm eigen ist: dass es dieselbe Fläche bekommt und sich beim
     Öffnen an seinen Inhalt schmiegt statt auf feste Breite zu gehen. Genau
     das ging beim Bauen zweimal daneben (alle Karten in eine Reihe, dann alle
     untereinander). */
  await seite.locator('[data-schwebe="exile"]').click();
  await seite.waitForTimeout(400);
  const exil = await seite.evaluate(() => {
    const z = document.querySelector('.schwebe-zone[data-zone="exile"]');
    const korb = z.querySelector(".schwebe-korb");
    const kr = korb.getBoundingClientRect();
    const mat = document.querySelector(".mat").getBoundingClientRect();
    return {
      offen: [...document.querySelectorAll(".schwebe-zone.offen")].map(e => e.dataset.zone),
      rahmen: getComputedStyle(korb).borderTopWidth,
      grund: getComputedStyle(korb).backgroundColor,
      breite: Math.round(kr.width),
      inDerMatte: Math.round(kr.left - mat.left) >= 0 && Math.round(kr.top - mat.top) >= 0
                  && Math.round(mat.bottom - kr.bottom) >= 0,
    };
  });
  stand.gleich("ein Klick klappt das Exil auf und schließt den Friedhof", exil.offen, ["exile"]);
  stand.ist("es trägt dieselbe Fläche wie der Friedhof",
    exil.rahmen === friedhof.rahmen && exil.grund === friedhof.grund,
    `${exil.rahmen} / ${exil.grund}`);
  stand.ist("und bleibt innerhalb der Matte", exil.inDerMatte, exil.breite + " px breit");

  await seite.locator('[data-schwebe="hand"]').click();
  await seite.waitForTimeout(400);
  const hand = await seite.evaluate(() => {
    const z = document.querySelector('.schwebe-zone[data-zone="hand"]');
    const korb = z.querySelector(".schwebe-korb");
    const kr = korb.getBoundingClientRect();
    const karten = [...korb.querySelectorAll(".hand-karte")].map(e => e.getBoundingClientRect());
    return {
      offen: [...document.querySelectorAll(".schwebe-zone.offen")].map(e => e.dataset.zone),
      anzahl: karten.length,
      // Die Hand bekommt WEDER Rahmen NOCH Grund — der Fächer trägt seine Form
      // selbst. Genau das war die Bitte, und genau das kann beim nächsten
      // Umbau der gemeinsamen Regeln still zurückkommen.
      rahmen: getComputedStyle(korb).borderTopWidth,
      grund: getComputedStyle(korb).backgroundColor,
      // Der Fächer dreht seine äußeren Karten; ein Rollbereich schnitte sie ab.
      linksRaus:  Math.round(kr.left - Math.min(...karten.map(r => r.left))),
      rechtsRaus: Math.round(Math.max(...karten.map(r => r.right)) - kr.right),
      untenRaus:  Math.round(Math.max(...karten.map(r => r.bottom)) - kr.bottom),
    };
  });
  stand.gleich("ein Klick auf die Hand schließt das Exil", hand.offen, ["hand"]);
  stand.ist("die Handkarten liegen darin", hand.anzahl === 2, hand.anzahl);
  stand.gleich("die Hand hat WEDER Rahmen NOCH Grund",
    [hand.rahmen, hand.grund], ["0px", "rgba(0, 0, 0, 0)"]);
  stand.gleich("keine Karte wird vom Rand abgeschnitten",
    [hand.linksRaus <= 0, hand.rechtsRaus <= 0, hand.untenRaus <= 0], [true, true, true],
    `links ${hand.linksRaus}, rechts ${hand.rechtsRaus}, unten ${hand.untenRaus}`);

  // Aus der Hand aufs Schlachtfeld: Die Lade muss dabei zugehen, sonst läge sie
  // über genau den Zonen, auf die man zielt.
  const hk = await seite.evaluate(PUNKT, ".schwebe-zone .hand-karte");
  stand.ist("eine Handkarte ist greifbar", !!hk);
  if (hk) {
    await seite.mouse.move(hk.x, hk.y);
    await seite.mouse.down();
    await seite.mouse.move(hk.x + 30, hk.y - 70, { steps: 8 });
    await seite.waitForTimeout(150);
    stand.ist("beim Ziehen geht die Lade zu",
      await seite.evaluate(() => document.querySelectorAll(".schwebe-zone.offen").length === 0));
    const feld = await seite.evaluate(PUNKT, '.mat-gross[data-zonedrop="field"]');
    stand.ist("das Schlachtfeld ist dahinter erreichbar", !!feld);
    if (feld) {
      await seite.mouse.move(feld.x, feld.y, { steps: 8 });
      await seite.mouse.up();
      await seite.waitForTimeout(200);
      stand.gleich("die Karte liegt jetzt auf dem Schlachtfeld",
        await seite.evaluate(([id]) => { const s = { hand: 0, field: 0, ...(SESSION_ZONEN[id] || {}) };
          return { hand: s.hand, field: s.field }; }, [k.hand[0]]),
        { hand: 0, field: 1 });
      stand.ist("und die Schaltfläche zählt herunter",
        await seite.evaluate(() => document.querySelector('.schwebe-zone[data-zone="hand"] .schwebe-n')
          .textContent) === "1");
    }
  }

  // Zugeklappt nimmt die Schaltfläche trotzdem an: eine Karte vom Schlachtfeld
  // auf den Friedhof ziehen, ohne ihn vorher aufzuklappen.
  const fq = await seite.evaluate(PUNKT, '.zk[data-zone="field"]');
  if (fq) {
    await seite.mouse.move(fq.x, fq.y);
    await seite.mouse.down();
    await seite.mouse.move(fq.x, fq.y + 40, { steps: 8 });
    const fz = await seite.evaluate(PUNKT, '.schwebe-zone[data-zone="grave"] .schwebe-knopf');
    stand.ist("die zugeklappte Friedhofs-Schaltfläche ist erreichbar", !!fz);
    if (fz) {
      await seite.mouse.move(fz.x, fz.y, { steps: 6 });
      stand.gleich("sie leuchtet als Ziel auf",
        await seite.evaluate(() => [...document.querySelectorAll("[data-zonedrop].ueber")]
          .map(e => e.dataset.zonedrop)), ["grave"]);
      await seite.mouse.up();
      await seite.waitForTimeout(200);
      stand.ist("und nimmt die Karte an",
        await seite.evaluate(() => document.querySelector('.schwebe-zone[data-zone="grave"] .schwebe-n')
          .textContent) === "2");
    }
  }

  // Escape schließt — der schnelle Weg an das darunter.
  await seite.locator('[data-schwebe="hand"]').click();
  await seite.waitForTimeout(300);
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(300);
  stand.ist("Escape klappt sie wieder zu",
    await seite.evaluate(() => document.querySelectorAll(".schwebe-zone.offen").length === 0));

  /* --- Der Würfel: nur noch W20, direkt auf der Matte -------------------- */
  /* Der Kasten unter der Matte ist weg, und mit ihm das Eingabefeld für eine
     freie Seitenzahl und die Knopfreihe W4…W12. Was bleibt, ist ein Emblem in
     der Leiste: Ein Klick darauf WÜRFELT — keine Lade, die erst aufgeht. */
  stand.gleich("kein Würfelkasten, keine anderen Würfel mehr",
    await seite.evaluate(() => ({
      kasten: document.querySelectorAll("#dice-box").length,
      seiten: document.querySelectorAll("#dice-sides").length,
      knoepfe: document.querySelectorAll("[data-dice]").length,
      // Das Emblem IST der Werfen-Knopf, und es ist keine Lade mehr.
      werfen: document.querySelectorAll(".sz-wuerfel .schwebe-knopf#dice-roll").length,
      lade: document.querySelectorAll('.sz-wuerfel [data-schwebe]').length })),
    { kasten: 0, seiten: 0, knoepfe: 0, werfen: 1, lade: 0 });

  // Vor dem Wurf liegt nichts auf der Matte — und die Fläche trägt weder
  // Rahmen noch Grund: Der Würfel rollt direkt über das Spielfeld.
  stand.gleich("die Würfelfläche ist blank und liegt nicht dauerhaft da",
    await seite.evaluate(() => {
      const s = getComputedStyle(document.querySelector("#wuerfel-buehne"));
      return { sichtbar: s.visibility, rahmen: s.borderTopWidth, grund: s.backgroundColor };
    }),
    { sichtbar: "hidden", rahmen: "0px", grund: "rgba(0, 0, 0, 0)" });

  // Ein Wurf: Ergebnis im Kopf der Fläche und auf dem Emblem, zwischen 1 und 20.
  const wuerfe = [];
  for (let i = 0; i < 3; i++) {
    await seite.locator("#dice-roll").click();
    await seite.waitForTimeout(1500);
    wuerfe.push(await seite.evaluate(() => {
      const b = document.querySelector("#wuerfel-buehne").getBoundingClientRect();
      const m = document.querySelector(".mat").getBoundingClientRect();
      return {
        kopf: document.querySelector("#wuerfel-kopf").textContent.trim(),
        erg: parseInt(document.querySelector(".wuerfel-erg")?.textContent || "", 10),
        // Die Zahl steht AUF dem Emblem, nicht mehr matt.
        aufSymbol: document.querySelector(".sz-wuerfel .schwebe-n").textContent,
        symbolMatt: document.querySelector(".sz-wuerfel .schwebe-n").classList.contains("null"),
        sichtbar: getComputedStyle(document.querySelector("#wuerfel-buehne")).visibility,
        // Die ganze Matte, nicht ein Kasten darin — das war die Bitte.
        deckt: [Math.round(b.left - m.left), Math.round(b.top - m.top),
                Math.round(m.right - b.right), Math.round(m.bottom - b.bottom)],
        dreiD: DiceGL.ready,
        // Ruhelage des Würfels — bei jedem Wurf eine andere.
        ort: DiceGL.ico ? [Math.round(DiceGL.ico.position.x * 100), Math.round(DiceGL.ico.position.y * 100)] : null,
      };
    }));
  }
  stand.ist("ein Klick auf das Emblem würfelt sofort",
    wuerfe.every(w => w.sichtbar === "visible" && w.erg >= 1 && w.erg <= 20),
    wuerfe.map(w => w.sichtbar + "/" + w.erg).join(" "));
  stand.ist("der Würfel rollt über die ganze Matte",
    wuerfe.every(w => JSON.stringify(w.deckt) === "[0,0,0,0]"),
    JSON.stringify(wuerfe[0].deckt));
  stand.ist("der echte 3D-Würfel steht bereit", wuerfe.every(w => w.dreiD));
  stand.ist("die gewürfelte Zahl steht auf dem Symbol",
    wuerfe.every(w => w.aufSymbol === String(w.erg) && !w.symbolMatt),
    wuerfe.map(w => w.aufSymbol).join(", "));

  /* Die Wurfliste der Runde ist mit dem Kasten nicht verschwunden, sie steht im
     Tooltip des Emblems. Ohne Rahmen und Grund lag sie als blanker Text über
     den Kartenbildern und war dort nicht zu lesen. */
  stand.gleich("die Wurfliste der Runde steht im Tooltip des Emblems",
    await seite.evaluate(() => {
      // Der Weg, den auch das Echo der Datenbank nimmt.
      logHinzu({ id: 1, user_id: "u1", kind: "dice", data: { sides: 20, result: 13 } });
      logHinzu({ id: 2, user_id: "u0", kind: "dice", data: { sides: 20, result: 7 } });
      return document.querySelector("#dice-roll").title.split("\n");
    }),
    ["Würfeln", "Ich: 7", "Mira: 13"]);
  stand.ist("jeder Wurf nennt Werfer und Ergebnis",
    wuerfe.every(w => /^Ich /.test(w.kopf) && w.erg >= 1 && w.erg <= 20),
    wuerfe.map(w => w.kopf).join(" | "));
  // Und jeder geht als Ereignis in die Runde — sonst sähe ihn nur der Werfer.
  stand.gleich("jeder Wurf geht als W20-Ereignis an die Mitspieler",
    await seite.evaluate(() => window.WUERFE.map(w => w.sides)), [20, 20, 20]);
  stand.gleich("und das gemeldete Ergebnis ist das gezeigte",
    await seite.evaluate(() => window.WUERFE.map(w => w.result)), wuerfe.map(w => w.erg));
  stand.ist("und keine zwei Würfe kommen an derselben Stelle zur Ruhe",
    new Set(wuerfe.map(w => JSON.stringify(w.ort))).size === 3,
    wuerfe.map(w => JSON.stringify(w.ort)).join(" "));

  /* Die Leinwand muss der Fläche folgen. Fest gesetzt (früher 340 × 150) wäre
     der Würfel verzerrt und liefe quer aus dem Bild. Sie entsteht erst beim
     ersten Wurf — vorher steht dort das ruhende SVG.
     Geprüft wird BEIDES: die CSS-Größe (wie groß sie im Bild ist) und der
     Zeichenpuffer (wie fein gerechnet wird). Nur die CSS-Größe zu prüfen
     bemerkte ein festes setSize() nicht — die Fläche stimmte dann trotzdem. */
  stand.gleich("die Leinwand hat die Größe der Fläche, im Bild wie im Puffer",
    await seite.evaluate(() => {
      const c = document.querySelector("#wuerfel-feld canvas");
      const f = document.querySelector("#wuerfel-feld").getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      return {
        bild: [c?.style.width ?? null, c?.style.height ?? null],
        puffer: [c?.width ?? null, c?.height ?? null],
        sollBild: [Math.round(f.width) + "px", Math.round(f.height) + "px"],
        sollPuffer: [Math.round(Math.round(f.width) * dpr), Math.round(Math.round(f.height) * dpr)],
      };
    }).then(x => [x.bild, x.puffer]),
    await seite.evaluate(() => {
      const f = document.querySelector("#wuerfel-feld").getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      return [[Math.round(f.width) + "px", Math.round(f.height) + "px"],
              [Math.round(Math.round(f.width) * dpr), Math.round(Math.round(f.height) * dpr)]];
    }));

  /* Und der Plan selbst streut. Ohne diese Prüfung könnte wurfPlan() ein
     einziges Feld auslosen und den Rest festhalten — die Ruhelagen oben wären
     trotzdem verschieden, und der Wurf sähe doch jedes Mal gleich aus. */
  const streuung = await seite.evaluate(() => {
    const p = Array.from({ length: 40 }, () => wurfPlan());
    const zaehle = f => new Set(p.map(f)).size;
    return {
      seiten: zaehle(x => x.seite), spruenge: zaehle(x => x.spruenge),
      bogen: zaehle(x => x.bogen), tempo: zaehle(x => x.tempo),
      taumeln: zaehle(x => x.taumeln), legen: zaehle(x => x.legen),
      // Der Weg muss auch WÄHREND des Fluges auseinanderlaufen, nicht nur am Ende.
      mitte: zaehle(x => JSON.stringify(wurfPunkt(x, 0.5))),
    };
  });
  stand.ist("der Wurfplan streut in jeder Größe",
    streuung.seiten >= 4 && streuung.spruenge === 3 && streuung.bogen > 30 &&
    streuung.tempo > 30 && streuung.taumeln > 25 && streuung.legen > 25 && streuung.mitte > 30,
    JSON.stringify(streuung));

  /* Danach räumt er sich selbst weg. Bliebe er liegen, verdeckte er genau die
     Karten, für die man gewürfelt hat — die Zahl bleibt am Emblem stehen. */
  await seite.waitForTimeout(6000);          // taumeln + legen + 2600 ms Halten + Ausblenden
  stand.gleich("danach blendet der Würfel aus, die Zahl bleibt am Emblem",
    await seite.evaluate(() => ({
      sichtbar: getComputedStyle(document.querySelector("#wuerfel-buehne")).visibility,
      aufSymbol: document.querySelector(".sz-wuerfel .schwebe-n").textContent })),
    { sichtbar: "hidden", aufSymbol: String(wuerfe[2].erg) });

  /* --- Im Akkordeon: die Zone klappt während des Zuges nicht um --------- */
  await seite.setViewportSize({ width: 800, height: 900 });
  await seite.waitForTimeout(450);
  stand.ist("im schmalen Fenster steht das Akkordeon",
    await seite.evaluate(() => !MAT_AN && !!document.querySelector("#zonen.zonen")));
  // Dort gibt es keine Zonen-Laden: Das Akkordeon zeigt ohnehin nur eine Zone
  // auf einmal, eine schwebende obendrauf wäre eine zweite Antwort auf dieselbe
  // Frage. Der WÜRFEL kommt trotzdem mit — er ist keine Zone, und ohne ihn
  // gäbe es auf einem hochkant gehaltenen Handy gar keinen Wurf mehr.
  stand.gleich("dort bleiben die drei gewöhnliche Zonen, der Würfel bleibt",
    await seite.evaluate(() => ({
      laden: document.querySelectorAll("#zonen .schwebe-zone[data-zonedrop]").length,
      hand: document.querySelectorAll('#zonen .zone[data-zone="hand"]').length,
      grave: document.querySelectorAll('#zonen .zone[data-zone="grave"]').length,
      exile: document.querySelectorAll('#zonen .zone[data-zone="exile"]').length,
      wuerfel: document.querySelectorAll("#zonen .sz-wuerfel #dice-roll").length })),
    { laden: 0, hand: 1, grave: 1, exile: 1, wuerfel: 1 });
  // Dort hängt er am Schirm statt an der Matte — die gibt es hier nicht.
  stand.ist("und hängt dort fest am unteren rechten Schirmrand",
    await seite.evaluate(() => {
      const k = document.querySelector(".sz-wuerfel .schwebe-knopf");
      const b = k.getBoundingClientRect();
      return getComputedStyle(k).position === "fixed" &&
             innerWidth - b.right < 30 && innerHeight - b.bottom < 30;
    }));

  await seite.evaluate(() => { zoneOeffnen("field", true); });
  await seite.waitForTimeout(250);
  const q3 = await seite.evaluate(PUNKT, '.zone.offen .zk[data-zone="field"]');
  stand.ist("eine Feldkarte ist auch hier erreichbar", !!q3, q3 ? `${Math.round(q3.x)}/${Math.round(q3.y)}` : "keine");
  if (q3) {
    await seite.mouse.move(q3.x, q3.y);
    await seite.mouse.down();
    await seite.mouse.move(q3.x, q3.y + 30, { steps: 8 });

    // Über die KOPFZEILE einer zugeklappten Zone fahren. Ohne die Sperre klappte
    // sie nach 140 ms auf, und alles darunter sprang weg.
    const exilVorher = await seite.evaluate(() => zoneSumme("exile"));
    const kopf = await seite.evaluate(PUNKT, '.zone[data-zonedrop="exile"] .zone-kopf');
    stand.ist("die Kopfzeile einer zugeklappten Zone ist erreichbar", !!kopf);
    if (kopf) {
      await seite.mouse.move(kopf.x, kopf.y, { steps: 6 });
      await seite.waitForTimeout(400);           // länger als die 140 ms des Aufklappens
      stand.gleich("die zugeklappte Zone bleibt zu und leuchtet nur auf",
        await seite.evaluate(() => ({ offen: ZONE_OFFEN,
          ueber: document.querySelector("[data-zonedrop].ueber")?.dataset.zonedrop ?? null })),
        { offen: "field", ueber: "exile" });

      await seite.mouse.up();
      await seite.waitForTimeout(200);
      /* Gezählt wird die ZONE, nicht eine feste Kartenkennung. Welche Karte
         hier gerade obenauf liegt, hängt von allem ab, was vorher verschoben
         wurde — eine verdrahtete Kennung bricht, sobald oben ein Zug
         dazukommt. Genau das ist beim Bauen passiert. */
      stand.gleich("und nimmt die Karte trotzdem an",
        await seite.evaluate(([vorher]) => ({ exil: zoneSumme("exile") - vorher }), [exilVorher]),
        { exil: 1 });
    }
  }

  /* --- Escape bricht ab -------------------------------------------------- */
  const q4 = await seite.evaluate(PUNKT, '.zone.offen .zk[data-zone="field"]');
  if (q4) {
    await seite.mouse.move(q4.x, q4.y);
    await seite.mouse.down();
    await seite.mouse.move(q4.x, q4.y + 30, { steps: 8 });
    await seite.keyboard.press("Escape");
    stand.gleich("Escape räumt alles weg",
      await seite.evaluate(() => ({
        ueber: document.querySelectorAll("[data-zonedrop].ueber").length,
        vor:   document.querySelectorAll("[data-zonedrop].zieh-ziel").length,
        schild: document.querySelectorAll(".zieh-geist").length })),
      { ueber: 0, vor: 0, schild: 0 });
    await seite.mouse.up();
  }

  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(300);
}
