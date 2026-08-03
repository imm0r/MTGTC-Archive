/* Die Commander-Steuer: je Commander eine, und sie folgt der KARTE.

   Zwei Dinge gingen daran still daneben, beide gemessen, bevor sie behoben
   wurden:

   * Der Kasten las `zoneKarten("cmd")[0]` — die erste Karte, die GERADE in der
     Kommandozone liegt. Ein gewirkter Commander steht auf dem Schlachtfeld und
     ist aus der Zone verschwunden; der Kasten zeigte ab da „–", obwohl genau
     dann Steuer fällig ist. Bei zwei Commandern sprang die Zahl beim Wirken
     des ersten stillschweigend auf den zweiten über: erst „+0" für den einen,
     dann „+0" für den anderen, und keine der beiden Zahlen war beschriftet.
   * Ein Deck mit Partnern hat ZWEI Commander, und jeder zahlt seine eigene
     Steuer. Wer den einen dreimal gewirkt hat und den anderen nie, schuldet
     +6 und +0 — nicht zweimal dieselbe Zahl und erst recht nicht ihre Summe.

   Gezählt wird weiterhin je Karte (`cast` in SESSION_ZONEN); das war nie das
   Problem. Falsch war allein, WAS angezeigt wurde. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "steuer";

const dreiDBereitstellen = (seite) => seite.route("https://cdn.jsdelivr.net/npm/three@**", r =>
  r.fulfill({ path: new URL("../node_modules/three/build/three.module.js", import.meta.url).pathname,
              headers: { "content-type": "text/javascript" } }));

/* Eine Partie mit einem Doppel-Commander-Deck. Geschrieben wird nichts. */
const PARTIE = () => {
  const d = DECKS[0];
  const ids = d.entries.map(e => e.cardId);
  d.main_card_id = ids[0];
  d.second_card_id = ids[1];

  USER = { id: "u0" };
  PROFILE = { display_name: "Ich" };
  SESSION = { id: "s0", host: "u0", start_life: 40, status: "open" };
  SESSION_PLAYERS = [{ user_id: "u0", life: 40, status: "joined", seat: 0, deck_id: d.id,
    deck_name: d.name, commander: null, commander_img: null,
    profile: { id: "u0", display_name: "Ich" } }];
  /* Eine gewöhnliche Karte liegt von Anfang an auf dem Schlachtfeld. Ohne sie
     liefe die Prüfung „gewöhnliche Feldkarten tragen kein Abzeichen" über eine
     leere Liste und wäre immer grün — nachgemessen: Sie blieb es auch, als das
     Abzeichen versuchsweise an JEDER Feldkarte hing. */
  SESSION_ZONEN = { [ids[2]]: { hand: 0, field: 1, grave: 0, exile: 0, cast: 0 } };
  window.GESCHRIEBEN = [];
  window.zoneSchreiben = id => window.GESCHRIEBEN.push(id);
  window.wurfSpeichern = () => {};

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-session"));
  renderSession();
  return { eins: ids[0], zwei: ids[1], drei: ids[2] };
};

/* Was im Kasten steht: je Zeile der angezeigte Wert und die Karte, an der er
   hängt. Ohne das zweite Feld ließe sich „zwei Zeilen mit +0" nicht von „zwei
   Zeilen für dieselbe Karte" unterscheiden. */
const ABLESEN = () => ({
  zeilen: [...document.querySelectorAll(".mat-steuer .mat-steuerwert")]
    .map(e => [e.textContent.trim(), e.dataset.steuer || null]),
  namen: [...document.querySelectorAll(".mat-steuer .mat-steuername")].map(e => e.textContent.trim()),
  cast: [...document.querySelectorAll(".mat-steuer .mat-steuerwert")]
    .map(e => (SESSION_ZONEN[e.dataset.steuer] || {}).cast || 0),
});

export default async function ({ seite, adresse, stand }) {
  await dreiDBereitstellen(seite);
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 10, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  const k = await seite.evaluate(PARTIE);
  await seite.waitForTimeout(400);

  stand.ist("die Matte steht (breites Fenster)",
    await seite.evaluate(() => MAT_AN && !!document.querySelector("#zonen.mat")));

  /* --- Zwei Commander, zwei Zeilen ------------------------------------- */
  const anfang = await seite.evaluate(ABLESEN);
  stand.gleich("jeder Commander bekommt eine eigene Zeile",
    anfang.zeilen, [["+0", k.eins], ["+0", k.zwei]]);
  stand.gleich("und jede trägt den Namen ihrer Karte", anfang.namen, ["Karte 0-0", "Karte 0-1"]);

  /* --- Der eine wird gewirkt, der andere nicht -------------------------- */
  /* Der Weg, den die Steuer in einer Partie wirklich nimmt: aus der
     Kommandozone aufs Schlachtfeld. Danach liegt der Commander NICHT mehr in
     der Zone — und genau das brachte die alte Anzeige zu Fall. */
  await seite.evaluate(([id]) => zoneMove(id, "cmd", "field"), [k.eins]);
  await seite.waitForTimeout(300);
  const einmal = await seite.evaluate(ABLESEN);
  stand.gleich("Wirken erhöht NUR die Steuer des gewirkten Commanders",
    einmal.zeilen, [["+2", k.eins], ["+0", k.zwei]]);
  stand.gleich("und das steht auch so in den Zonendaten", einmal.cast, [1, 0]);
  stand.ist("der gewirkte Commander liegt dabei auf dem Schlachtfeld",
    await seite.evaluate(([id]) => zAnzahl(id, "field") === 1 && zAnzahl(id, "cmd") === 0, [k.eins]));

  await seite.evaluate(([id]) => { zoneMove(id, "field", "cmd"); zoneMove(id, "cmd", "field"); }, [k.eins]);
  await seite.waitForTimeout(300);
  stand.gleich("ein zweites Wirken macht +4 daraus, der Partner bleibt bei +0",
    (await seite.evaluate(ABLESEN)).zeilen, [["+4", k.eins], ["+0", k.zwei]]);

  /* --- Auch der Partner zahlt für sich --------------------------------- */
  await seite.evaluate(([id]) => zoneMove(id, "cmd", "field"), [k.zwei]);
  await seite.waitForTimeout(300);
  const beide = await seite.evaluate(ABLESEN);
  stand.gleich("beide Commander stehen mit ihrer eigenen Zahl da",
    beide.zeilen, [["+4", k.eins], ["+2", k.zwei]]);
  stand.ist("obwohl die Kommandozone jetzt leer ist",
    await seite.evaluate(() => zoneSumme("cmd") === 0),
    await seite.evaluate(() => zoneSumme("cmd")));

  /* --- Zurückzählen trifft nur die eine Karte --------------------------- */
  /* Der Knopf ist da, weil sich am Tisch jemand verzählt. Träfe er beide,
     wäre er schlimmer als gar keiner. */
  await seite.evaluate(() => { window.GESCHRIEBEN = []; });
  await seite.click(`.mat-steuer [data-steuer="${k.eins}"]`);
  await seite.waitForTimeout(300);
  stand.gleich("ein Klick nimmt genau ein Wirken zurück — bei dieser Karte",
    (await seite.evaluate(ABLESEN)).zeilen, [["+2", k.eins], ["+2", k.zwei]]);
  stand.gleich("und meldet genau diese Karte zum Speichern an",
    await seite.evaluate(() => window.GESCHRIEBEN), [k.eins]);

  /* --- Hochkant: die Marke am Commander selbst -------------------------- */
  /* Im Akkordeon gibt es keinen Steuerkasten; die Zahl sitzt als Abzeichen auf
     der Karte. Auch dort hing sie an der ZONE statt an der Karte und war weg,
     sobald der Commander gewirkt war — hier liegen beide auf dem Schlachtfeld,
     und beide müssen ihre eigene tragen. */
  await seite.setViewportSize({ width: 560, height: 860 });
  await seite.waitForTimeout(350);
  stand.ist("schmal steht das Akkordeon", await seite.evaluate(() => !MAT_AN));
  /* `.zk[data-zone="field"]`, nicht `[data-zone="field"] .zk`: Das Attribut
     sitzt an der KARTE, nicht an einem Behälter darum. Der zweite Selektor
     trifft nichts — und eine Prüfung über eine leere Liste ist immer grün.
     Genau so blieb die Zeile darunter still bestehen, als das Abzeichen
     versuchsweise an jeder Feldkarte hing. */
  const akk = await seite.evaluate(() =>
    [...document.querySelectorAll('.zone .zk[data-zone="field"]')]
      .map(z => [z.dataset.id, z.querySelector(".zk-steuer")?.textContent.trim() ?? null]).sort());
  stand.gleich("beide gewirkten Commander tragen ihr eigenes Abzeichen",
    akk.filter(([id]) => id === k.eins || id === k.zwei), [[k.eins, "+2"], [k.zwei, "+2"]]);
  /* Und eine gewöhnliche Karte trägt keins — sonst stünde auf jeder gelegten
     Kreatur ein „+0". */
  stand.gleich("gewöhnliche Feldkarten tragen keins",
    akk.filter(([id]) => id !== k.eins && id !== k.zwei), [[k.drei, null]]);
  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.waitForTimeout(350);

  /* --- Ein Deck mit nur EINEM Commander -------------------------------- */
  /* Dann steht kein Name dabei: Die Überschrift des Kastens sagt schon alles,
     und die schmale Spalte ist unter 1200 px nur 154 px breit. */
  await seite.evaluate(() => { DECKS[0].second_card_id = null; renderSession(); });
  await seite.waitForTimeout(300);
  const einer = await seite.evaluate(ABLESEN);
  stand.gleich("bei einem einzelnen Commander bleibt es bei einer Zeile ohne Namen",
    [einer.zeilen, einer.namen], [[["+2", k.eins]], []]);

  /* --- Gar kein Commander ---------------------------------------------- */
  await seite.evaluate(() => { DECKS[0].main_card_id = null; renderSession(); });
  await seite.waitForTimeout(300);
  stand.gleich("ohne Commander steht dort ein matter Strich, kein Knopf",
    await seite.evaluate(() => ({
      werte: document.querySelectorAll(".mat-steuer .mat-steuerwert:not(.leer)").length,
      leer:  document.querySelectorAll(".mat-steuer .mat-steuerwert.leer").length,
    })), { werte: 0, leer: 1 });
}
