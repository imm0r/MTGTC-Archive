/* Der Aufbau der Kartendetailansicht: was neben dem Bild steht, was darunter,
   und die drei Zentrierungen, die schon einmal kaputt waren.

   ANLASS. Der Umzug des Werkzeugblocks unter das Bild (#227) hat zwei Regeln
   abgehängt, die an `.detail .tool-row` hingen: Die Goldsymbole in den
   Knöpfen saßen nicht mehr mittig, und das Feld „max €/Karte" war wieder
   höher als die Knöpfe daneben — derselbe Fehler, der schon einmal behoben
   war. Beides fiel keinem Prüflauf auf, nur dem Auge des Eigentümers.
   Seitdem gilt hier: Die Werkzeuge stehen IN der Info-Spalte (dort gelten
   die Regeln), und die Geometrie wird GEMESSEN, nicht aus Klassen gefolgert.

   Der Aufbau seit #230:
   * Unter dem BILD: „Bearbeiten" und „Bild ersetzen" — beide gehören zur
     Karte selbst, nicht zu den Werkzeugen.
   * Neben dem Bild: Kopf, Pillen, Decks — und die EINE Gruppe „Verwaltung"
     mit fünf Werkzeugen (Preis, max €/Karte, Synergien, KI-Synergien,
     Combos) in EINER Zeile, die nie umbricht.
   * Unter Bild UND Spalte, volle Breite: Legalität und Tags als Paar,
     Preisverlauf, Ergebnis-Kästen. Die Legalität führt ihre acht Formate
     in ZWEI Spalten aus GLEICH GROSSEN Pillen (Format links, Urteil
     rechts) — neben den längsten Tag-Namen (34 Zeichen, nachgemessen). */

import { AUFBAU } from "../hilfen.mjs";

export const name = "detailaufbau";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 4 });
  await seite.waitForTimeout(250);

  const erg = await seite.evaluate(() => {
    const c = CARDS[0];
    c.condition = "NM"; c.price = 0.18; c.qty = 1;
    showCardDetail(c.id);

    // Legalität mit dem breitesten deutschen Fall füllen — acht Formate,
    // überall „nicht legal", einmal „restricted".
    document.getElementById("dt-legal-body").innerHTML = legalGridHtml({
      standard: "not_legal", pioneer: "not_legal", modern: "not_legal",
      legacy: "not_legal", vintage: "restricted", commander: "not_legal",
      brawl: "not_legal", pauper: "not_legal" });
    document.getElementById("dt-legal").open = true;

    // Tags mit den längsten ECHTEN Labels des Index (34/33/32 Zeichen) —
    // genau die Kandidaten, die als Erste umbrechen oder kürzen würden.
    document.getElementById("dt-themen-body").innerHTML = themenChipsHtml([
      { wurzel: "cycle", wurzel_label: "cycle", slug: "a",
        label: "cycle-plc-alternate-reality-legend", cards: 5, cards_total: 5 },
      { wurzel: "cycle", wurzel_label: "cycle", slug: "b",
        label: "cycle-pcy-ability-losing-creature", cards: 8, cards_total: 8 },
      { wurzel: null, wurzel_label: null, slug: "c",
        label: "continuous effect from graveyard", cards: 123, cards_total: 456 },
    ]);
    document.getElementById("dt-themen").open = true;

    const koerper = document.getElementById("detail-body");
    const werk = koerper.querySelectorAll(".tool-group");
    const bild = koerper.querySelector(".detail-bildspalte").getBoundingClientRect();
    const rWerk = werk[0].getBoundingClientRect();
    // „Bearbeiten" wohnt bei „Bild ersetzen" unter dem Bild — beide gehören
    // zur Karte selbst, nicht zu den Werkzeugen.
    const edit = document.getElementById("dt-edit");
    const bildBtn = document.getElementById("dt-bild");
    const zeile = document.querySelector(".detail .tool-row");
    const glieder = [...zeile.children];
    const paar = koerper.querySelector(".det-paar");
    const items = [...koerper.querySelectorAll(".legal-item")];
    const chips = [...koerper.querySelectorAll(".thema-chip")];
    const laengster = chips.reduce((a, b) => (b.scrollWidth > a.scrollWidth ? b : a));

    // Punkt 6: die Mitte der Zustand+Anzahl-Gruppe gegen die Mitte des
    // Zwischenraums von Sprachpille und Preis.
    const copy = koerper.querySelector(".detail-copy");
    const lang = [...copy.querySelectorAll(":scope > .pill")].pop();
    const mitte = copy.querySelector(".copy-mitte").getBoundingClientRect();
    const preis = copy.querySelector(".detail-preis").getBoundingClientRect();
    const rLang = lang.getBoundingClientRect();

    const cap = document.getElementById("syn-cap").getBoundingClientRect();
    const knopf = document.getElementById("dt-syn").getBoundingClientRect();
    const gic = document.getElementById("dt-syn").querySelector(".gic").getBoundingClientRect();

    return {
      gruppen: werk.length,
      inInfo: !!werk[0].closest(".detail-info"),
      nebenBild: rWerk.left > bild.right - 5,
      werkzeuge: [...werk[0].querySelectorAll(".btn,.field input")].map(x => x.id),
      editBeimBild: !!edit.closest(".detail-bildtools")
        && edit.nextElementSibling === bildBtn,
      // … und die Zeile spannt sich über die Bildbreite: „Bearbeiten" an der
      // linken Bildkante, „Bild ersetzen" an der rechten.
      bildtoolsLinks: Math.abs(edit.getBoundingClientRect().left - bild.left) <= 1,
      bildtoolsRechts: Math.abs(bildBtn.getBoundingClientRect().right - bild.right) <= 1,
      // EINE Zeile, immer: alle fünf Glieder auf derselben UNTERKANTE (die
      // Zeile richtet an flex-end aus — das Feld ist mit seinem Label höher
      // als die Knöpfe, die Oberkanten dürfen sich also unterscheiden), und
      // keines über den rechten Rand der Spalte hinaus.
      eineZeile: new Set(glieder.map(g => Math.round(g.getBoundingClientRect().bottom))).size === 1,
      zeilePasst: zeile.scrollWidth <= zeile.clientWidth,
      capBreite: Math.round(document.querySelector(".feld-cap").getBoundingClientRect().width),
      paarVolleBreite: Math.abs(paar.clientWidth - koerper.clientWidth) < 2,
      paarNichtInInfo: !paar.closest(".detail-info"),
      legalZeilen: new Set(items.map(i => Math.round(i.getBoundingClientRect().top))).size,
      legalSpalten: new Set(items.map(i => Math.round(i.getBoundingClientRect().left))).size,
      // Punkt „alle gleich groß": jede Pille exakt so breit wie jede andere —
      // und das Urteil rechtsbündig, nur das Polster (8 px) vom Rand entfernt.
      legalBreiten: new Set(items.map(i => Math.round(i.getBoundingClientRect().width))).size,
      urteilRechts: items.every(i => Math.round(i.getBoundingClientRect().right
        - i.querySelector(".pill").getBoundingClientRect().right) === 9),
      legalPasst: items.every(i => i.getBoundingClientRect().right
        <= document.getElementById("dt-legal").getBoundingClientRect().right + 0.5),
      // Punkt 5: Kopf und Chips einer Zeile stehen in der Zeilenmitte
      // zueinander — gemessen an der ersten Gruppe.
      oberZentriert: (() => {
        const g = koerper.querySelector(".thema-gruppe");
        const o = g.querySelector(".thema-ober").getBoundingClientRect();
        const r = g.getBoundingClientRect();
        return Math.abs((o.top + o.bottom) / 2 - (r.top + r.bottom) / 2) <= 1;
      })(),
      // Punkt 6/7: Unkategorisiert zuletzt, keine Quelle-Zeile mehr.
      letzteGruppe: [...koerper.querySelectorAll(".thema-ober")].pop()?.textContent,
      quelleWeg: !koerper.querySelector("#dt-themen-body .hint"),
      chipGekuerzt: laengster.scrollWidth > laengster.clientWidth,
      chipText: laengster.textContent,
      // Zwischen dem Paar und dem Preisverlauf steht ein Trennstrich — wie
      // zwischen allen Abschnitten der Ansicht. Er fehlte nach dem Umbau,
      // und aufgefallen ist es sofort.
      strichVorVerlauf: (() => {
        let n = paar.nextElementSibling;
        return !!(n && n.classList.contains("sec-sep")
          && n.nextElementSibling?.classList.contains("dt-price-full"));
      })(),
      mitteSoll: Math.round((rLang.right + preis.left) / 2),
      mitteIst: Math.round((mitte.left + mitte.right) / 2),
      feldHoehe: Math.round(cap.height), knopfHoehe: Math.round(knopf.height),
      symbolAbstand: Math.round((gic.top + gic.height / 2) - (knopf.top + knopf.height / 2)),
      // Das Goldsymbol rückt an den linken Knopfrand: 1 px Rahmen + 7 px
      // Polster. Ein Knopf OHNE Symbol behält die vollen 10 px.
      symbolLinks: Math.round(gic.left - knopf.left),
      ohneSymbolPolster: (() => {
        const b = document.getElementById("dt-bild");
        return Math.round(parseFloat(getComputedStyle(b).paddingLeft));
      })(),
    };
  });

  /* --- Neben dem Bild ---------------------------------------------------- */
  stand.gleich("EINE Werkzeuggruppe, nicht mehr zwei", erg.gruppen, 1);
  stand.ist("sie steht in der Info-Spalte neben dem Bild",
    erg.inInfo && erg.nebenBild, `inInfo ${erg.inInfo}, nebenBild ${erg.nebenBild}`);
  stand.gleich("fünf Werkzeuge darin — Bearbeiten nicht mehr",
    erg.werkzeuge, ["dt-price", "syn-cap", "dt-syn", "dt-syn-ai", "dt-combos"]);
  stand.ist("Bearbeiten steht unter dem Bild, direkt vor „Bild ersetzen“",
    erg.editBeimBild);
  stand.ist("die Zeile unter dem Bild spannt sich über die Bildbreite — Bearbeiten links, Bild ersetzen rechts",
    erg.bildtoolsLinks && erg.bildtoolsRechts,
    `links ${erg.bildtoolsLinks}, rechts ${erg.bildtoolsRechts}`);
  stand.ist("die fünf stehen in EINER Zeile und passen hinein",
    erg.eineZeile && erg.zeilePasst, `eineZeile ${erg.eineZeile}, passt ${erg.zeilePasst}`);
  stand.gleich("das Feld „max €/Karte“ ist vierstellenbreit, nicht datumsbreit",
    erg.capBreite, 76);

  /* --- Unter dem Bild, volle Breite -------------------------------------- */
  stand.ist("Legalität und Tags stehen unterhalb, in voller Dialogbreite",
    erg.paarNichtInInfo && erg.paarVolleBreite,
    `ausserhalb ${erg.paarNichtInInfo}, volle Breite ${erg.paarVolleBreite}`);
  stand.gleich("die acht Formate stehen in vier Zeilen …", erg.legalZeilen, 4);
  stand.gleich("… und zwei Spalten", erg.legalSpalten, 2);
  stand.gleich("alle acht Pillen sind gleich breit", erg.legalBreiten, 1);
  stand.ist("das Urteil steht rechtsbündig in der Pille", erg.urteilRechts);
  stand.ist("und treten der Spalte nicht über den Rand", erg.legalPasst);
  stand.ist("zwischen dem Paar und dem Preisverlauf steht der Trennstrich",
    erg.strichVorVerlauf);

  /* --- Tags -------------------------------------------------------------- */
  stand.ist("Sammeltag und Chips stehen in der Zeilenmitte zueinander",
    erg.oberZentriert);
  stand.gleich("die Gruppe ohne Oberbegriff steht zuletzt, als „Unkategorisiert“",
    erg.letzteGruppe, "Unkategorisiert");
  stand.ist("die Tagger-Quellzeile ist fort", erg.quelleWeg);

  /* Der Handel dabei: Zwei Legalitäts-Spalten dürfen den Tags nicht den
     Platz nehmen, den die längsten Namen brauchen. Gemessen am längsten
     Label des echten Index (34 Zeichen) — kürzt der Chip, ist die
     Spaltenaufteilung in style.css (.det-paar) zu eng geraten. */
  stand.ist("der längste echte Tag-Name steht ungekürzt in seiner Pille",
    !erg.chipGekuerzt, erg.chipText);

  /* --- Die drei Zentrierungen ------------------------------------------- */
  stand.ist("Zustand und Anzahl stehen mittig zwischen Sprache und Preis",
    Math.abs(erg.mitteIst - erg.mitteSoll) <= 1, `ist ${erg.mitteIst}, soll ${erg.mitteSoll}`);
  stand.gleich("das Feld „max €/Karte“ ist genau knopfhoch",
    erg.feldHoehe, erg.knopfHoehe);
  stand.gleich("das Goldsymbol sitzt senkrecht mittig im Knopf", erg.symbolAbstand, 0);
  stand.gleich("und nah am linken Knopfrand (1 px Rahmen + 7 px Polster)",
    erg.symbolLinks, 8);
  stand.gleich("ein Knopf ohne Symbol behält sein volles Polster",
    erg.ohneSymbolPolster, 10);
}
