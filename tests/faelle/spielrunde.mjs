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
     etwas anderem als dem, worauf man gezielt hat. */

import { AUFBAU, PUNKT } from "../hilfen.mjs";

export const name = "spielrunde";

/* Eine Partie ohne Datenbank: Sitzung, Spieler und Zonenstand von Hand
   gesetzt, das Schreiben abgefangen. Läuft IM BROWSER. */
const PARTIE = () => {
  const d = DECKS[0];
  const ids = d.entries.map(e => e.cardId);
  d.main_card_id = ids[0];             // damit die Kommandozone überhaupt dasteht

  USER = { id: "u0" };
  PROFILE = { display_name: "Ich" };
  SESSION = { id: "s0", host: "u0", start_life: 40, status: "open" };
  SESSION_PLAYERS = [{
    user_id: "u0", life: 40, status: "joined", seat: 0,
    deck_id: d.id, deck_name: d.name, commander: null, commander_img: null,
    profile: { id: "u0", display_name: "Ich" },
  }];

  SESSION_ZONEN = {};
  const leer = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0 };
  const feld = ids.slice(1, 4), hand = ids.slice(4, 6);
  feld.forEach(id => { SESSION_ZONEN[id] = { ...leer, field: 1 }; });
  hand.forEach(id => { SESSION_ZONEN[id] = { ...leer, hand: 1 }; });

  // Ohne Datenbank käme sonst nur ein Fehlerton. Gemerkt wird, WAS geschrieben
  // würde — daran hängt, dass ein Zug überhaupt gespeichert wird.
  window.GESCHRIEBEN = [];
  window.zoneSchreiben = id => window.GESCHRIEBEN.push(id);

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-session"));
  renderSession();
  return { feld, hand, cmd: ids[0] };
};

export default async function ({ seite, adresse, stand }) {
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

  /* --- Die Hand als schwebende Lade ------------------------------------- */
  /* Auf der Matte steht die Hand nicht mehr in der Reihe, sondern klappt unten
     links aus. Drei Dinge können daran still schiefgehen, und alle drei sind
     hier festgehalten. */
  const lade = await seite.evaluate(() => {
    const l = document.querySelector("#zonen .hand-lade");
    const korb = l?.querySelector(".hand-lade-korb");
    return {
      da: !!l,
      alteReihe: document.querySelectorAll(".mat-hand").length,
      ziel: l?.dataset.zonedrop ?? null,
      korbSichtbar: korb ? getComputedStyle(korb).visibility : null,
      // Die Klammer muss durchlässig sein, sonst finge sie Klicks ab, die dem
      // Schlachtfeld darunter gelten — ein unsichtbares Rechteck über der Matte.
      klammer: l ? getComputedStyle(l).pointerEvents : null,
      knopf: l ? getComputedStyle(l.querySelector(".hand-lade-knopf")).pointerEvents : null,
      zahl: l?.querySelector(".hand-lade-n")?.textContent ?? null,
    };
  });
  stand.ist("die Hand steht als Lade da, nicht mehr als Mattenzeile",
    lade.da && lade.alteReihe === 0);
  stand.ist("sie ist selbst das Ablageziel", lade.ziel === "hand", lade.ziel);
  stand.ist("zugeklappt ist der Korb weggenommen", lade.korbSichtbar === "hidden", lade.korbSichtbar);
  stand.gleich("die Klammer lässt Klicks durch, die Schaltfläche nicht",
    [lade.klammer, lade.knopf], ["none", "auto"]);
  stand.ist("die Schaltfläche nennt die Anzahl", lade.zahl === "2", lade.zahl);

  /* Die Schaltfläche IST das Emblem: kein Beiwort daneben, und die Zahl steht
     unten rechts darauf statt daneben. Zwei Dinge daran können still
     schiefgehen — das Bild lädt nicht (dann bliebe eine leere Fläche, die
     niemand anklickt), oder die Zahl rutscht neben das Symbol statt darauf. */
  const sym = await seite.evaluate(() => {
    const knopf = document.querySelector(".hand-lade-knopf");
    const bild = knopf.querySelector(".hand-lade-bild");
    const s = knopf.querySelector(".hand-lade-sym").getBoundingClientRect();
    const n = knopf.querySelector(".hand-lade-n").getBoundingClientRect();
    return {
      quelle: bild?.getAttribute("src") ?? null,
      geladen: !!bild && bild.complete && bild.naturalWidth > 0,
      ersatzVersteckt: getComputedStyle(knopf.querySelector(".hand-lade-ersatz")).display === "none",
      // Auf dem Symbol: der Mittelpunkt der Zahl liegt innerhalb des Symbols …
      draufX: n.left + n.width / 2 > s.left && n.left + n.width / 2 < s.right,
      draufY: n.top + n.height / 2 > s.top && n.top + n.height / 2 < s.bottom,
      // … und zwar in dessen unterem rechten Viertel.
      untenRechts: n.left + n.width / 2 > s.left + s.width / 2 &&
                   n.top + n.height / 2 > s.top + s.height / 2,
      // Die Zahl darf das Symbol nicht erschlagen.
      anteil: Math.round(n.width / s.width * 100),
      beschriftung: knopf.getAttribute("aria-label"),
    };
  });
  stand.ist("die Schaltfläche trägt das Emblem", sym.geladen, sym.quelle);
  stand.ist("das Ersatzzeichen bleibt dabei versteckt", sym.ersatzVersteckt);
  stand.gleich("die Zahl steht auf dem Symbol, unten rechts",
    [sym.draufX, sym.draufY, sym.untenRechts], [true, true, true]);
  stand.ist("und erschlägt es nicht", sym.anteil <= 40, sym.anteil + " % der Symbolbreite");
  // Der sichtbare Text ist weg — für Vorleseprogramme muss die Anzahl deshalb
  // in die Beschriftung, sonst wäre sie dort gar nicht mehr vorhanden.
  stand.ist("die Beschriftung nennt die Anzahl mit",
    /\b2\b/.test(sym.beschriftung || ""), sym.beschriftung);

  await seite.locator("[data-handlade]").click();
  await seite.waitForTimeout(400);
  const offen = await seite.evaluate(() => {
    const korb = document.querySelector(".hand-lade-korb");
    const kr = korb.getBoundingClientRect();
    const karten = [...document.querySelectorAll(".hand-lade .hand-karte")].map(e => e.getBoundingClientRect());
    return {
      sichtbar: getComputedStyle(korb).visibility,
      anzahl: karten.length,
      knopfSagt: document.querySelector(".hand-lade-knopf").getAttribute("aria-expanded"),
      // Der Fächer dreht seine äußeren Karten; sie schwenken über ihre Spalte
      // hinaus. Reicht das Polster nicht, schneidet der Korb sie ab — das sieht
      // man erst hin, wenn man misst.
      linksRaus:  Math.round(kr.left - Math.min(...karten.map(r => r.left))),
      rechtsRaus: Math.round(Math.max(...karten.map(r => r.right)) - kr.right),
      untenRaus:  Math.round(Math.max(...karten.map(r => r.bottom)) - kr.bottom),
      // Sie klappt nach OBEN aus: der Korb liegt über der Schaltfläche.
      ueberDemKnopf: Math.round(document.querySelector(".hand-lade-knopf").getBoundingClientRect().top
                                - kr.bottom) >= 0,
    };
  });
  stand.ist("ein Klick klappt sie auf", offen.sichtbar === "visible" && offen.knopfSagt === "true");
  stand.ist("die Handkarten liegen darin", offen.anzahl === 2, offen.anzahl);
  stand.ist("und zwar nach oben ausgeklappt", offen.ueberDemKnopf);
  stand.gleich("keine Karte wird vom Rand abgeschnitten",
    [offen.linksRaus <= 0, offen.rechtsRaus <= 0, offen.untenRaus <= 0], [true, true, true],
    `links ${offen.linksRaus}, rechts ${offen.rechtsRaus}, unten ${offen.untenRaus}`);

  // Aus der Hand aufs Schlachtfeld: Die Lade muss dabei zugehen, sonst läge sie
  // über genau den Zonen, auf die man zielt.
  const hk = await seite.evaluate(PUNKT, ".hand-lade .hand-karte");
  stand.ist("eine Handkarte ist greifbar", !!hk);
  if (hk) {
    await seite.mouse.move(hk.x, hk.y);
    await seite.mouse.down();
    await seite.mouse.move(hk.x + 30, hk.y - 70, { steps: 8 });
    await seite.waitForTimeout(150);
    stand.ist("beim Ziehen geht die Lade zu",
      await seite.evaluate(() => !document.querySelector(".hand-lade").classList.contains("offen")));
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
        await seite.evaluate(() => document.querySelector(".hand-lade-n").textContent) === "1");
    }
  }

  // Escape schließt sie — der schnelle Weg an das darunter.
  await seite.locator("[data-handlade]").click();
  await seite.waitForTimeout(300);
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(300);
  stand.ist("Escape klappt sie wieder zu",
    await seite.evaluate(() => !document.querySelector(".hand-lade").classList.contains("offen")));

  /* --- Im Akkordeon: die Zone klappt während des Zuges nicht um --------- */
  await seite.setViewportSize({ width: 800, height: 900 });
  await seite.waitForTimeout(450);
  stand.ist("im schmalen Fenster steht das Akkordeon",
    await seite.evaluate(() => !MAT_AN && !!document.querySelector("#zonen.zonen")));
  // Dort gibt es keine Lade: Das Akkordeon zeigt ohnehin nur eine Zone auf
  // einmal, eine schwebende obendrauf wäre eine zweite Antwort auf dieselbe
  // Frage. Die Hand bleibt eine Zone unter sechs.
  stand.gleich("dort bleibt die Hand eine gewöhnliche Zone",
    await seite.evaluate(() => ({
      lade: document.querySelectorAll(".hand-lade").length,
      zone: document.querySelectorAll('#zonen .zone[data-zone="hand"]').length })),
    { lade: 0, zone: 1 });

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
      stand.gleich("und nimmt die Karte trotzdem an",
        await seite.evaluate(([id]) => { const s = { field: 0, exile: 0, ...(SESSION_ZONEN[id] || {}) };
          return { field: s.field, exile: s.exile }; }, [k.feld[1]]),
        { field: 0, exile: 1 });
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
