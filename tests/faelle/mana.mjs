/* Mana in diesem Zug: die Anzeige auf der Matte und im Akkordeon.

   Die Zahl entsteht aus dem Regeltext der liegenden Karten, und Regeltexte
   sind der Ort, an dem eine Schätzung STILL falsch wird: Ein Signet, das
   brutto statt netto zählt, macht aus „7“ eine „8“, und niemand rechnet nach.
   Deshalb prüft dieser Fall zuerst den Übersetzer an einer Tabelle echter
   Muster — und dann die Summen an einem Schlachtfeld, dessen Sollwerte von
   Hand ausgerechnet sind.

   Die vier Zusagen, an denen es hängt:

   * NETTO, NICHT BRUTTO. Ein Signet gibt zwei Mana heraus und schluckt eins;
     das Land, das es füttert, steht schon in der Zählung. Nur die Differenz
     macht die Summe richtig.
   * NUR DAS SCHLACHTFELD. Ein Manastein auf der HAND erzeugt gar nichts —
     zählte er mit, wäre die Zahl eine Deckliste, keine Anzeige des Zuges.
   * DER TAPP-ZUSTAND zählt je EXEMPLAR: von drei Wäldern, einer getappt,
     können noch zwei. Genau dafür führt das Feld seine Exemplarliste.
   * GRUNDLAND-TYPEN wirken aus dem RegelwERK (CR 305.6), nicht aus dem Text:
     Ein Wald ohne erfassten Erinnerungstext macht trotzdem {G}. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "mana";

const dreiDBereitstellen = (seite) => seite.route("https://cdn.jsdelivr.net/npm/three@**", r =>
  r.fulfill({ path: new URL("../node_modules/three/build/three.module.js", import.meta.url).pathname,
              headers: { "content-type": "text/javascript" } }));

/* Ein Schlachtfeld mit von Hand ausgerechneten Sollwerten:

     Wald ×3 (1 getappt)   je 1  →  frei 2 / gesamt 3
     Sol Ring              je 2  →  2 / 2
     Siegel (netto)        je 1  →  1 / 1
     Elf (getappt)         je 1  →  0 / 1
     Lotus Petal           je 1  →  1 / 1
     Turm (fremdes Opfer)  —     →  zählt nicht
     Wiege (for each)      —     →  variabel
     Alter Wald (ohne Text)je 1  →  1 / 1   (CR 305.6)
     Trümmer (ohne Text)   —     →  „ohne erfassten Regeltext“
     Bär (Vanilla, '')     —     →  nichts, und KEIN Hinweis
     Handstein             —     →  liegt auf der Hand, zählt nicht

   Summe: frei 7, gesamt 9, dazu „+“ für die Wiege. */
const PARTIE = () => {
  const d = DECKS[0];
  const K = [
    { name: "Wald",        typ: "Basic Land — Forest", text: "({T}: Add {G}.)",  qty: 3, zone: "field", fs: [{ t: 1, c: 0 }] },
    { name: "Sol Ring",    typ: "Artifact",            text: "{T}: Add {C}{C}.", qty: 1, zone: "field" },
    { name: "Siegel",      typ: "Artifact",            text: "{1}, {T}: Add two mana in any combination of colors.", qty: 1, zone: "field" },
    { name: "Elf",         typ: "Creature — Elf Druid", text: "{T}: Add {G}.",   qty: 1, zone: "field", fs: [{ t: 1, c: 0 }] },
    { name: "Lotus Petal", typ: "Artifact",            text: "{T}, Sacrifice Lotus Petal: Add one mana of any color.", qty: 1, zone: "field" },
    { name: "Turm",        typ: "Land",                text: "{T}, Sacrifice a creature: Add {C}{C}.", qty: 1, zone: "field" },
    { name: "Wiege",       typ: "Legendary Land",      text: "{T}: Add {G} for each creature you control.", qty: 1, zone: "field" },
    { name: "Alter Wald",  typ: "Basic Land — Forest", text: null,               qty: 1, zone: "field" },
    { name: "Truemmer",    typ: "Artifact",            text: null,               qty: 1, zone: "field" },
    { name: "Baer",        typ: "Creature — Bear",     text: "",                 qty: 1, zone: "field" },
    { name: "Handstein",   typ: "Artifact",            text: "{T}: Add {C}.",    qty: 1, zone: "hand" },
  ];
  d.entries = K.map((k, i) => ({ cardId: "d0c" + i, qty: k.qty }));
  d.main_card_id = null; d.second_card_id = null;
  K.forEach((k, i) => {
    const c = CARDS.find(x => x.id === "d0c" + i);
    c.name = c.disp = k.name; c.type_line = k.typ; c.oracle_text = k.text; c.qty = k.qty;
  });

  USER = { id: "u0" };
  PROFILE = { display_name: "Ich" };
  SESSION = { id: "s0", host: "u0", start_life: 40, status: "open" };
  SESSION_PLAYERS = [{ user_id: "u0", life: 40, status: "joined", seat: 0,
    deck_id: d.id, deck_name: d.name, commander: null, commander_img: null,
    profile: { id: "u0", display_name: "Ich" } }];

  SESSION_ZONEN = {};
  const leer = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0 };
  K.forEach((k, i) => {
    const st = { ...leer, [k.zone]: k.qty };
    if (k.fs) st.fs = k.fs;
    SESSION_ZONEN["d0c" + i] = st;
  });

  window.GESCHRIEBEN = [];
  window.zoneSchreiben = id => window.GESCHRIEBEN.push(id);
  window.wurfSpeichern = () => {};

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-session"));
  renderSession();
};

/* Die Anzeige ablesen: frei/gesamt ohne die schmalen Leerzeichen. */
const ABLESEN = () => {
  const w = document.querySelector(".mat-manawert");
  if (!w) return null;
  return { frei: w.querySelector(".mana-frei")?.textContent,
           von: (w.querySelector(".mana-von")?.textContent || "").replace(/[\s /]+/g, ""),
           titel: w.title, leer: w.classList.contains("leer") };
};

export default async function ({ seite, adresse, stand }) {
  await dreiDBereitstellen(seite);
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 12, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(PARTIE);
  await seite.waitForTimeout(300);

  /* --- Der Übersetzer, Muster für Muster ------------------------------ */
  const tabelle = await seite.evaluate(() => [
    ["({T}: Add {G}.)", "Basic Land — Forest"],
    ["{T}: Add {C}{C}.", "Artifact"],
    ["{1}, {T}: Add two mana in any combination of colors.", "Artifact"],
    ["{T}, Sacrifice this artifact: Add one mana of any color.", "Artifact"],
    ["{T}, Sacrifice a creature: Add {C}{C}.", "Land"],
    ["{T}: Add {G} for each creature you control.", "Land"],
    ["{T}: Add {G} or {W}.", "Land"],
    ["{T}: Add {W}{W}, {W}{B}, or {B}{B}.", "Land"],
    ["{1}, {T}: Add {G}{G}.", "Land"],
    ["{2}: Add {G}.", "Artifact"],
    ["{T}: Add three mana of any one color.", "Land"],
    ["Flying", "Creature — Bird"],
    [null, "Basic Land — Forest"],
    [null, "Land Creature — Forest Dryad"],
  ].map(([text, typ]) => {
    const p = manaProduktion({ name: "Probe", oracle_text: text, type_line: typ });
    const f = Object.entries(p.farben || {}).map(([k, v]) => k + v).join("");
    return p.je + (p.variabel ? "+" : "") + (f ? " " + f : "");
  }));
  /* Die Farbe steht hinter der Menge. Drei Fälle tragen die Last: das SIGNET
     (Kosten + zwei Farben → „wählbar“, nicht W1U1, sonst summierte sich die
     Aufschlüsselung auf zwei statt auf eins), das FILTERLAND ({1},{T}: Add
     {G}{G} → G1, denn eine einzige Farbe bleibt eine Aussage) und LOTUS PETAL
     („one mana of any color“ — eine Menge OHNE benannte Farbe; fiele sie nicht
     nach „wählbar“, summierten sich die Farben auf weniger als die Gesamtzahl). */
  stand.gleich("der Übersetzer urteilt Muster für Muster wie erwartet — mit Farbe", tabelle, [
    "1 G1",       // Wald
    "2 C2",       // Sol Ring
    "1 ANY1",     // Signet: netto 1, zwei Farben zur Wahl → wählbar
    "1 ANY1",     // Lotus Petal: „any color“ benennt keine Farbe
    "0",          // fremdes Opfer zählt nicht
    "0+",         // for each → variabel, ohne Farbe
    "1 ANY1",     // {G} or {W}: eine Wahl
    "2 ANY2",     // {W}{W}, {W}{B}, or {B}{B}: drei Möglichkeiten, keine davon
                  //   ist DIE Farbe — auch wenn die erste rein weiß ist
    "1 G1",       // Filterland {1},{T}: Add {G}{G} → ohne Wahl behält es seine Farbe
    "0",          // Fähigkeit ohne Tappen
    "3 ANY3",     // „three mana of any one color“
    "0",          // Vanilla
    "1 G1",       // CR 305.6 ohne Text
    "1 G1",       // Dryad Arbor
  ]);

  /* --- Die Kachel auf der Matte --------------------------------------- */
  const kachel = await seite.evaluate(ABLESEN);
  stand.ist("die Kachel steht auf der Matte", !!kachel);
  stand.gleich("frei zählt nur ungetappte Quellen — mit „+“ für die Wiege",
    kachel?.frei, "7+");
  stand.gleich("gesamt zählt Exemplare, nicht Zeilen", kachel?.von, "9+");
  stand.ist("die Aufschlüsselung nennt das Signet netto",
    /Siegel ×1 — je 1/.test(kachel?.titel || ""), kachel?.titel?.split("\n")[3]);
  stand.ist("… und den Sol Ring mit zwei", /Sol Ring ×1 — je 2/.test(kachel?.titel || ""));
  stand.ist("die Wiege steht als variabel dabei", /Wiege/.test(kachel?.titel || ""));
  stand.ist("Karten ohne erfassten Text werden benannt …",
    /Truemmer/.test(kachel?.titel || ""));
  stand.ist("… ein leerer Text (Vanilla) aber nicht",
    !/Baer/.test(kachel?.titel || ""));
  stand.ist("der Handstein taucht nirgends auf", !/Handstein/.test(kachel?.titel || ""));

  /* --- Tappen senkt frei, nicht gesamt -------------------------------- */
  await seite.click('.mat .zk[data-id="d0c0"]:not(.getappt)');
  await seite.waitForTimeout(250);
  stand.gleich("ein getappter Wald: frei sinkt um eins",
    await seite.evaluate(ABLESEN).then(k => k?.frei), "6+");
  stand.gleich("… gesamt bleibt", await seite.evaluate(ABLESEN).then(k => k?.von), "9+");

  /* --- „Alle enttappen“ hebt frei auf gesamt --------------------------- */
  await seite.click("#feld-enttappen");
  await seite.waitForTimeout(250);
  const wach = await seite.evaluate(ABLESEN);
  stand.gleich("nach dem Enttappen ist alles frei", [wach?.frei, wach?.von], ["9+", "9+"]);

  /* --- Sie passt in die schmale Spalte -------------------------------- */
  await seite.setViewportSize({ width: 820, height: 900 });
  await seite.waitForTimeout(350);
  const eng = await seite.evaluate(() => {
    const w = document.querySelector(".mat-manawert");
    const sp = document.querySelector(".mat-mitte");
    const lib = document.querySelector(".mat-lib");
    return w && sp && lib ? {
      passt: w.getBoundingClientRect().width <= sp.getBoundingClientRect().width + 1,
      quer: w.scrollWidth - w.clientWidth,
      libHoehe: Math.round(lib.getBoundingClientRect().height),
    } : null;
  });
  stand.ist("bei 820 px bleibt die Kachel in ihrer Spalte", eng?.passt && eng?.quer === 0,
    JSON.stringify(eng));
  stand.ist("und die Bibliothek behält Platz", eng?.libHoehe > 120, eng?.libHoehe + " px");

  /* --- Das Akkordeon trägt die Marke in der Kopfzeile ------------------ */
  await seite.setViewportSize({ width: 560, height: 860 });
  await seite.waitForTimeout(350);
  const marke = await seite.evaluate(() => {
    const el = document.querySelector('.zone[data-zone="field"] .zone-kopf .zone-mana');
    return el ? { text: el.textContent.trim(), titel: el.title } : null;
  });
  stand.ist("die Marke steht am Schlachtfeld-Kopf", !!marke, marke?.text);
  stand.ist("mit denselben Zahlen", /9\+\/9\+/.test(marke?.text || ""), marke?.text);
  stand.ist("und der Aufschlüsselung im Tooltip", /Sol Ring/.test(marke?.titel || ""));

  /* --- Die Farbreihe auf der Matte ------------------------------------
     Sieben Mana sind wertlos, wenn der Zauber zwei blaue verlangt und kein
     blaues darunter ist. Die Reihe muss dieselbe Summe tragen wie die große
     Zahl darüber — eine Aufschlüsselung, die ihrer eigenen Summe widerspricht,
     ist schlimmer als keine.

     Hier steht alles wach (die Prüfung davor hat enttappt); ein Wald wird
     eigens wieder getappt, damit ein TEILWEISE getapptes Trio sichtbar wird —
     bei einer Karte mit einem einzigen Exemplar fiele nicht auf, wenn die
     Farbe alle Exemplare als frei zählte.

     Soll: Wald ×3 (einer getappt) + Alter Wald + Elf → grün 4 frei / 5 gesamt;
     Sol Ring → farblos 2/2; Signet netto 1 + Lotus Petal 1 → wählbar 2/2.
     Summen 8 und 9. */
  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(350);
  await seite.click('.mat .zk[data-id="d0c0"]:not(.getappt)');   // ein Wald von dreien
  await seite.waitForTimeout(250);
  const LESEN = () => {
    const chips = [...document.querySelectorAll(".mat-mana .mana-chip")].map(c => ({
      sym: (c.querySelector(".ms").className.match(/ms-([a-z]+)/) || [])[1],
      frei: +c.querySelector(".mana-frei").textContent,
      gesamt: +c.querySelector(".mana-von").textContent.replace(/[^0-9]/g, ""),
    }));
    const w = document.querySelector(".mat-manawert");
    return { chips, frei: parseInt(w.textContent, 10),
             gesamt: +w.querySelector(".mana-von").textContent.replace(/[^0-9]/g, "") };
  };
  const reihe = await seite.evaluate(LESEN);
  stand.gleich("die Farbreihe steht in der Reihenfolge WUBRG, farblos, wählbar",
    reihe.chips.map(c => c.sym), ["g", "c", "multicolor"]);
  stand.gleich("grün: 4 frei von 5 — ein Wald von dreien ist getappt",
    reihe.chips.find(c => c.sym === "g"), { sym: "g", frei: 4, gesamt: 5 });
  stand.gleich("farblos: 2 von 2", reihe.chips.find(c => c.sym === "c"),
    { sym: "c", frei: 2, gesamt: 2 });
  stand.gleich("wählbar: 2 von 2 (Signet netto 1, Lotus Petal 1)",
    reihe.chips.find(c => c.sym === "multicolor"), { sym: "multicolor", frei: 2, gesamt: 2 });
  stand.gleich("die Farben summieren sich genau auf die große Zahl",
    [reihe.chips.reduce((s, c) => s + c.frei, 0), reihe.chips.reduce((s, c) => s + c.gesamt, 0)],
    [reihe.frei, reihe.gesamt]);

  /* Tappen muss in der FARBE ankommen, nicht nur in der Summe. */
  await seite.click('.mat .zk[data-id="d0c1"]');       // Sol Ring
  await seite.waitForTimeout(250);
  const nachTap = await seite.evaluate(LESEN);
  stand.gleich("ein getappter Sol Ring: farblos frei sinkt auf 0",
    nachTap.chips.find(c => c.sym === "c"), { sym: "c", frei: 0, gesamt: 2 });
  stand.gleich("… und die Summe stimmt weiter",
    nachTap.chips.reduce((s, c) => s + c.frei, 0), nachTap.frei);
  await seite.click("#feld-enttappen");
  await seite.waitForTimeout(250);

  /* --- Die Reihe passt in die schmale Spalte -------------------------- */
  await seite.setViewportSize({ width: 820, height: 900 });
  await seite.waitForTimeout(350);
  const platz = await seite.evaluate(() => {
    const r = document.querySelector(".mana-farben").getBoundingClientRect();
    const sp = document.querySelector(".mat-mitte").getBoundingClientRect();
    const lib = document.querySelector(".mat-lib").getBoundingClientRect();
    const el = document.querySelector(".mana-farben");
    return { breit: Math.round(r.width), spalte: Math.round(sp.width),
             quer: el.scrollWidth - el.clientWidth, lib: Math.round(lib.height) };
  });
  stand.ist("bei 820 px bleibt die Farbreihe in ihrer Spalte",
    platz.breit <= platz.spalte && platz.quer === 0, JSON.stringify(platz));
  stand.ist("und die Bibliothek behält Platz", platz.lib > 120, platz.lib + " px");

  /* --- Der Härtefall: alle sieben Marken auf einmal --------------------
     Fünf Farben, farblos und wählbar — mehr kann die Reihe nie tragen. In der
     154 px schmalen Spalte muss sie dann umbrechen statt hinauszulaufen, und
     die Bibliothek darunter muss übrig bleiben. Ein Fünf-Farben-Deck ist in
     Commander nichts Ausgefallenes. */
  await seite.evaluate(() => {
    // Der Zustand wird hinterher zurückgegeben: Die Prüfungen danach messen
    // sonst dieses Schlachtfeld statt ihres eigenen.
    window.SICHERUNG = CARDS.map(c => ({ id: c.id, text: c.oracle_text, typ: c.type_line }));
    // d0c1 (Sol Ring) bleibt farblos — sonst fehlte ausgerechnet die Marke,
    // die dieser Fall am wenigsten erwartet.
    const t = { d0c0: "{T}: Add {W}.", d0c3: "{T}: Add {U}.", d0c5: "{T}: Add {B}.",
                d0c7: "{T}: Add {R}.", d0c9: "{T}: Add {G}." };
    CARDS.forEach(c => { if (t[c.id]) { c.oracle_text = t[c.id]; c.type_line = "Land"; } });
    renderZonen();
  });
  await seite.waitForTimeout(250);
  const voll = await seite.evaluate(() => {
    const el = document.querySelector(".mana-farben");
    const r = el.getBoundingClientRect();
    const sp = document.querySelector(".mat-mitte").getBoundingClientRect();
    const lib = document.querySelector(".mat-lib").getBoundingClientRect();
    return { syms: [...el.querySelectorAll(".ms")].map(s => (s.className.match(/ms-([a-z]+)/) || [])[1]),
             breit: Math.round(r.width), spalte: Math.round(sp.width),
             quer: el.scrollWidth - el.clientWidth, hoch: Math.round(r.height),
             lib: Math.round(lib.height) };
  });
  stand.gleich("alle sieben Marken stehen da, in fester Reihenfolge", voll.syms,
    ["w", "u", "b", "r", "g", "c", "multicolor"]);
  stand.ist("sie brechen um, statt aus der Spalte zu laufen",
    voll.breit <= voll.spalte && voll.quer === 0, JSON.stringify(voll));
  stand.ist("und lassen der Bibliothek noch Platz", voll.lib > 120, voll.lib + " px");
  await seite.evaluate(() => {
    window.SICHERUNG.forEach(s => {
      const c = CARDS.find(x => x.id === s.id);
      if (c) { c.oracle_text = s.text; c.type_line = s.typ; }
    });
    renderZonen();
  });
  await seite.waitForTimeout(200);

  /* --- Im Akkordeon: dieselben Farben, nur die freie Zahl -------------- */
  await seite.setViewportSize({ width: 560, height: 860 });
  await seite.waitForTimeout(350);
  const eng2 = await seite.evaluate(() => {
    const k = document.querySelector('.zone[data-zone="field"] .zone-kopf');
    const chips = [...k.querySelectorAll(".mana-farben.kompakt .mana-chip")];
    return { farben: chips.map(c => (c.querySelector(".ms").className.match(/ms-([a-z]+)/) || [])[1]),
             zahlen: chips.map(c => c.textContent.trim()),
             ohneGesamt: !k.querySelector(".mana-farben.kompakt .mana-von"),
             hoehe: Math.round(k.getBoundingClientRect().height),
             quer: k.scrollWidth - k.clientWidth };
  });
  stand.gleich("die Kopfzeile trägt dieselben Farben", eng2.farben, ["g", "c", "multicolor"]);
  stand.gleich("dort steht nur die freie Menge", eng2.zahlen, ["5", "2", "2"]);
  stand.ist("… ohne das Gesamt", eng2.ohneGesamt);
  stand.ist("die Kopfzeile läuft nicht über",
    eng2.hoehe < 64 && eng2.quer === 0, JSON.stringify(eng2));

  /* --- Ohne Quellen: Strich statt Null, Marke ganz weg ----------------- */
  await seite.evaluate(() => {
    CARDS.forEach(c => { if (c.id.startsWith("d0c")) { c.oracle_text = ""; c.type_line = "Artifact"; } });
    renderZonen();
  });
  await seite.waitForTimeout(200);
  stand.ist("ohne Quellen verschwindet die Marke im Akkordeon",
    await seite.evaluate(() => !document.querySelector(".zone-mana")));
  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(350);
  stand.ist("auf der Matte bleibt ein matter Strich",
    await seite.evaluate(() => document.querySelector(".mat-manawert")?.classList.contains("leer")));
}
