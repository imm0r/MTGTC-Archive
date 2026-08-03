/* Preisverlauf im Dialog: Zeitfenster, Kennzahlen, Ablesung.

   Was hier schiefgehen kann, wird niemand melden — es sieht immer nach einem
   Graphen aus. Geprüft wird deshalb, ob die ZAHLEN zum gewählten Fenster
   passen und ob die Kurve nur zeigt, was gemessen wurde:

   * Das Fenster schneidet wirklich ab (30 Tage zeigen 31 Punkte, nicht 120),
     und die Kennzahlen beziehen sich auf den Ausschnitt, nicht auf alles.
   * Ein Fenster, das ohnehin alles zeigt, ist gesperrt und sagt warum. Sonst
     stünden fünf Knöpfe da, von denen drei dasselbe tun.
   * Gerechnet wird ab HEUTE zurück, nicht ab dem letzten Messpunkt: Bei einer
     Reihe, die vor Wochen endet, ist das 30-Tage-Fenster leer — und der Knopf
     gesperrt, statt „30 Tage" über einen Ausschnitt von vor einem Monat zu
     schreiben.
   * Die geglättete Kurve SCHIESST NICHT ÜBER. Das ist die teuerste Falle des
     ganzen Umbaus: Ein gewöhnlicher Spline malt zwischen zwei Messungen
     Preise, die es nie gab. Geprüft wird deshalb an einer Zacke, dass kein
     Punkt der Kurve über das gemessene Hoch hinausläuft.
   * Die Ablesung nennt Datum, Preis und die Veränderung bis zum letzten Punkt
     — und lässt Letztere weg, wo sie nichts sagt (auf dem letzten Punkt).
   * Die Hover-Vorschau bekommt weiterhin den nackten Graphen ohne Knöpfe. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "preisfenster";

/* Eine Reihe bauen: `tage` Punkte, endend `endeVorTagen` Tage vor heute. */
const REIHE = (tage, endeVorTagen, werte) => {
  const h = [];
  const heute = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  for (let i = tage - 1; i >= 0; i--) {
    const d = new Date(heute - (i + endeVorTagen) * 864e5).toISOString().slice(0, 10);
    h.push({ d, v: werte(tage - 1 - i) });
  }
  return h;
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 3 });
  await seite.waitForTimeout(250);

  /* --- 120 Tage Verlauf: Fenster schneiden, Kennzahlen folgen ------------- */
  const auf = await seite.evaluate((r) => {
    CARDS[0].hist = r;
    showCardDetail("d0c0");
    document.querySelector(".dt-price-full").open = true;
    const lies = () => ({
      name: document.querySelector(".pv-fenstername").textContent,
      kopf: [...document.querySelectorAll(".pv-kopf .pv-kz b")].map(b => b.textContent),
      fuss: [...document.querySelectorAll(".pv-fuss .pv-kz b")].map(b => b.textContent),
      punkte: document.querySelectorAll("#dt-pverlauf .chart-svg circle:not(.pchart-marke)").length,
      knoepfe: [...document.querySelectorAll("[data-pv]")].map(b =>
        ({ id: b.dataset.pv, aus: b.disabled, an: b.classList.contains("on"), titel: b.title })),
    });
    const dreissig = lies();
    document.querySelector('[data-pv="alle"]').click();
    return { dreissig, alle: lies() };
  }, REIHE(120, 0, i => 9 + i / 100));
  // Durchgehend steigend, 9,00 … 10,19. Bewusst KEIN Zyklus: Eine Reihe, die
  // sich alle 30 Tage wiederholt, hat im 30-Tage-Fenster dasselbe Hoch und
  // Tief wie im ganzen Verlauf — die Prüfung „das Fenster wirkt auf die
  // Kennzahlen" wäre dann grün, egal was der Code tut. Genau so ist sie im
  // ersten Anlauf durchgefallen.

  stand.gleich("das 30-Tage-Fenster zeigt 31 Punkte, nicht alle 120",
    auf.dreissig.punkte, 31);
  stand.gleich("und benennt sich selbst", auf.dreissig.name, "30 Tage");
  stand.gleich("„Alle“ zeigt alle 120", auf.alle.punkte, 120);
  stand.gleich("der gewählte Knopf ist markiert, und nur er",
    auf.alle.knoepfe.filter(k => k.an).map(k => k.id), ["alle"]);
  stand.gleich("6 Monate und 1 Jahr sind gesperrt — sie zeigten dasselbe wie „Alle“",
    auf.alle.knoepfe.filter(k => k.aus).map(k => k.id), ["6m", "1j"]);
  stand.ist("und sagen auch, warum",
    auf.alle.knoepfe.filter(k => k.aus).every(k => k.titel.length > 10),
    auf.alle.knoepfe.find(k => k.aus)?.titel);

  // Die Kennzahlen: über den ganzen Verlauf 9,00–10,19, im 30-Tage-Ausschnitt
  // nur dessen letzte 31 Werte (9,89–10,19). Beide Zahlenpaare stehen hier
  // ausgeschrieben statt bloß „ungleich" — sonst rechnete die Zeile stur über
  // alles, und die Prüfung bliebe trotzdem grün.
  stand.gleich("„Alle“: Hoch und Tief über die ganze Reihe",
    auf.alle.kopf, ["10,19 €", "9,00 €"]);
  stand.gleich("30 Tage: Hoch und Tief nur aus dem Ausschnitt",
    auf.dreissig.kopf, ["10,19 €", "9,89 €"]);
  stand.gleich("der Fuß nennt Veränderung, Spanne und die Zahl der Messpunkte",
    auf.alle.fuss.length, 3);
  stand.gleich("und die Zahl der Messpunkte stimmt", auf.alle.fuss[2], "120");

  /* --- Reihe, die vor Wochen endet: ab HEUTE gerechnet ------------------- */
  // 200 Tage, aber vor 60 Tagen abgebrochen. Ab heute zurück gerechnet ist das
  // 30-Tage-Fenster damit LEER — ab dem letzten Messpunkt gerechnet wäre es
  // gut gefüllt und trüge trotzdem die Aufschrift „30 Tage". Genau diesen
  // Unterschied hält die Prüfung fest. 3 Monate und 6 Monate greifen noch,
  // 1 Jahr umfasst die ganze Reihe und ist deshalb ein zweites „Alle“.
  stand.gleich("eine vor 60 Tagen abgebrochene Reihe sperrt das 30-Tage-Fenster",
    await seite.evaluate((r) => {
      CARDS[1].hist = r;
      showCardDetail("d0c1");
      document.querySelector(".dt-price-full").open = true;
      const k = [...document.querySelectorAll("[data-pv]")];
      return { gesperrt: k.filter(b => b.disabled).map(b => b.dataset.pv),
               an: k.filter(b => b.classList.contains("on")).map(b => b.dataset.pv) };
    }, REIHE(200, 60, i => 5 + i / 100)),
    { gesperrt: ["30t", "1j"], an: ["3m"] });

  /* --- Die Kurve schießt nicht über --------------------------------------- */
  // Eine einzelne Zacke nach oben: Ein gewöhnlicher Spline malt links und
  // rechts davon Werte ÜBER der Zacke. Gemessen wird an der gezeichneten
  // Kurve selbst (getPointAtLength), nicht an der Rechnung dahinter.
  const ueber = await seite.evaluate((r) => {
    CARDS[2].hist = r;
    showCardDetail("d0c2");
    document.querySelector(".dt-price-full").open = true;
    const pfad = document.querySelector("#dt-pverlauf .chart-svg path[stroke]:not([fill])")
              || [...document.querySelectorAll("#dt-pverlauf .chart-svg path")].find(p => p.getAttribute("fill") === "none");
    if (!pfad) return { fehler: "keine Kurve gefunden" };
    // Im SVG zeigt y nach UNTEN: Der höchste Preis hat das KLEINSTE y.
    const punkte = [...document.querySelectorAll("#dt-pverlauf .chart-svg circle:not(.pchart-marke)")]
      .map(c => Number(c.getAttribute("cy")));
    const hoechsterPunkt = Math.min(...punkte);
    const len = pfad.getTotalLength();
    let kurveOben = Infinity;
    for (let i = 0; i <= 600; i++) kurveOben = Math.min(kurveOben, pfad.getPointAtLength(len * i / 600).y);
    return { hoechsterPunkt, kurveOben, punkte: punkte.length };
  }, REIHE(11, 0, i => (i === 5 ? 12 : 4)));
  stand.ist("die geglättete Kurve läuft nirgends über den höchsten Messwert hinaus",
    !ueber.fehler && ueber.kurveOben >= ueber.hoechsterPunkt - 0.6,
    ueber.fehler || `Kurve bis y=${ueber.kurveOben.toFixed(2)}, höchster Punkt y=${ueber.hoechsterPunkt.toFixed(2)}`);

  /* --- Ablesung ----------------------------------------------------------- */
  await seite.evaluate((r) => {
    CARDS[0].hist = r;
    showCardDetail("d0c0");
    document.querySelector(".dt-price-full").open = true;
  }, REIHE(40, 0, i => 10 + i / 10));
  const g = await seite.locator("#dt-pverlauf .pchart").boundingBox();
  await seite.mouse.move(g.x + g.width * 0.4, g.y + g.height * 0.5);
  const ab = await seite.evaluate(async () => {
    const tip = document.querySelector("#dt-pverlauf .pchart-tip");
    for (let i = 0; i < 60 && tip.hidden; i++) await new Promise(r => setTimeout(r, 25));
    const lot = document.querySelector("#dt-pverlauf .pchart-lot");
    return { offen: !tip.hidden,
             datum: tip.querySelector(".pchart-tip-d").textContent,
             preis: tip.querySelector(".pchart-tip-v span").textContent,
             wandel: tip.querySelector(".pchart-tip-w").hidden ? ""
                   : tip.querySelector(".pchart-tip-w").textContent,
             lotAn: lot.style.display !== "none",
             lotX: lot.getAttribute("x1") };
  });
  stand.ist("beim Überfahren steht das Ablesekästchen", ab.offen);
  stand.ist("es nennt ein Datum", /^\d{2}\.\d{2}\.\d{4}$/.test(ab.datum), ab.datum);
  stand.ist("es nennt einen Preis", /€$/.test(ab.preis), ab.preis);
  // Die Reihe steigt durchgehend — die Veränderung bis zum letzten Punkt muss
  // also positiv sein. Ein vertauschtes Vorzeichen fiele sonst nicht auf.
  stand.ist("es nennt die Veränderung bis zum letzten Punkt, mit Datum",
    /^\+\d+,\d %\s\S+\s\d{2}\.\d{2}\.\d{4}$/.test(ab.wandel), ab.wandel);
  stand.ist("das Lot steht am abgelesenen Punkt", ab.lotAn && Number(ab.lotX) > 0, ab.lotX);

  // Auf dem letzten Punkt entfällt die Veränderung — „0 % gegenüber sich
  // selbst" wäre keine Auskunft.
  stand.ist("auf dem letzten Punkt entfällt die Veränderung",
    await seite.evaluate(async () => {
      const box = document.querySelector("#dt-pverlauf .pchart");
      const r = box.getBoundingClientRect();
      box.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX: r.right - 2, clientY: r.top + r.height / 2 }));
      await new Promise(r2 => setTimeout(r2, 60));
      return document.querySelector("#dt-pverlauf .pchart-tip-w").hidden;
    }));

  /* --- Die Hover-Vorschau bleibt nackt ------------------------------------ */
  stand.ist("die Hover-Vorschau bekommt Graph, aber keine Fensterknöpfe",
    await seite.evaluate(() => {
      const html = detailHtml(CARDS[0], true);
      return /chart-svg/.test(html) && !/data-pv=/.test(html);
    }));
}
