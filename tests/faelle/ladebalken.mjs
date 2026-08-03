/* Der Ladebalken für Suchen, die dauern.

   ANLASS. Die KI-Synergien haben bei einem vollen Deck viel zu tun, und
   angezeigt wurde das durch ein Zahnrad von zehn Pixeln. Wer nichts sieht,
   hält es für kaputt — und klickt noch einmal. Genau das verwirft den
   laufenden, bei der KI bezahlten Lauf (synergyLauf zählt hoch, die alte
   Antwort fällt weg). Die Anzeige war also nicht nur unhöflich, sie kostete
   Geld.

   Vier Dinge, die daran still schiefgehen können:

   * DER BALKEN STEHT. Eine Animation, die nicht läuft, sieht genau nach dem
     aus, wovor sie bewahren soll. Ein Tippfehler im Namen der Keyframes fällt
     nirgends auf — CSS wirft nichts, es passiert nur nichts.
   * ER LÄUFT NICHT DURCH. Bleibt das Licht in der Mitte hängen oder wandert
     nur ein Stück, ist es wieder ein Zeichen statt einer Bahn.
   * ER IST WIEDER KLEIN. Der ganze Zweck ist, dass man ihn nicht übersieht.
   * DAS ZAHNRAD KOMMT ZURÜCK. Vier Stellen zeichnen den langen Lade-Zustand;
     eine davon beim nächsten Umbau zu vergessen, fiele niemandem auf. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "ladebalken";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 4, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);

  await seite.evaluate(() => {
    const k = document.createElement("div");
    k.id = "lb-probe";
    k.style.width = "420px";
    k.innerHTML = ladeBalken(t("syn.aiLoading"), t("syn.aiLoadingHint"));
    document.getElementById("app").appendChild(k);
  });
  await seite.waitForTimeout(120);

  /* --- Aufbau ------------------------------------------------------------ */
  const bau = await seite.evaluate(() => {
    const w = document.querySelector("#lb-probe .ladebalken");
    return {
      rolle: w?.getAttribute("role") || null,
      schiene: !!w?.querySelector(".ladebalken-schiene"),
      licht: !!w?.querySelector(".ladebalken-licht"),
      txt: w?.querySelector(".ladebalken-txt")?.textContent.trim() || "",
      hinweis: w?.querySelector(".ladebalken-hinweis")?.textContent.trim() || "",
      zahnrad: !!w?.querySelector(".syn-spin"),
    };
  });
  stand.ist("Schiene und Licht stehen da, das Zahnrad nicht mehr",
    bau.schiene && bau.licht && !bau.zahnrad, JSON.stringify(bau));
  stand.ist("Vorleseprogramme bekommen den Zustand mit", bau.rolle === "status", bau.rolle);
  stand.ist("der Satz ist übersetzt, nicht der Schlüssel",
    bau.txt.includes("KI") && !bau.txt.includes("syn."), bau.txt);
  stand.ist("und die zweite Zeile erklärt die Wartezeit",
    bau.hinweis.length > 20 && !bau.hinweis.includes("syn."), bau.hinweis);
  // Ohne Hinweis bleibt die zweite Zeile ganz weg — eine leere Zeile wäre ein
  // Loch im Kasten.
  stand.ist("ohne Hinweis gibt es keine leere zweite Zeile",
    !(await seite.evaluate(() => ladeBalken("nur Text").includes("ladebalken-hinweis"))));
  // Der Text kommt aus t() und könnte irgendwann Zeichen enthalten, die HTML
  // sind. Er wird eingesetzt, nicht ausgeführt.
  stand.ist("der Text wird maskiert, nicht als HTML eingesetzt",
    await seite.evaluate(() => !ladeBalken("<b>x</b>").includes("<b>")));

  /* --- Er ist groß genug, um aufzufallen --------------------------------- */
  const groesse = await seite.evaluate(() => {
    const s = document.querySelector("#lb-probe .ladebalken-schiene").getBoundingClientRect();
    const g = document.querySelector(".syn-spin")?.getBoundingClientRect();
    return { breite: Math.round(s.width), hoehe: Math.round(s.height),
             zahnrad: g ? Math.round(g.width) : null };
  });
  stand.ist("die Bahn nimmt die volle Breite ein", groesse.breite >= 400,
    `${groesse.breite} px breit, ${groesse.hoehe} px hoch`);

  /* --- Und er läuft ------------------------------------------------------ */
  const lauf = await seite.evaluate(() => {
    const el = document.querySelector("#lb-probe .ladebalken-licht");
    const st = getComputedStyle(el);
    return { name: st.animationName, dauer: st.animationDuration,
             wdh: st.animationIterationCount, art: st.animationTimingFunction };
  });
  stand.gleich("die Animation heißt, wie sie in den Keyframes steht",
    [lauf.name, lauf.wdh], ["ladebalken-lauf", "infinite"]);

  // Der eigentliche Beweis: mehrmals nachmessen, wo das Licht steht. Eine
  // Animation, die zwar deklariert ist, aber nichts bewegt (fehlende
  // Keyframes, transform an einem statischen Element), sähe oben genauso aus.
  const bewegung = await seite.evaluate(async () => {
    const licht = document.querySelector("#lb-probe .ladebalken-licht");
    const bahn = document.querySelector("#lb-probe .ladebalken-schiene").getBoundingClientRect();
    const punkte = [];
    for (let i = 0; i < 8; i++) {
      punkte.push(Math.round(licht.getBoundingClientRect().left - bahn.left));
      await new Promise(r => setTimeout(r, 110));
    }
    return { punkte, bahn: Math.round(bahn.width),
             lichtBreite: Math.round(licht.getBoundingClientRect().width) };
  });
  stand.ist("das Licht steht an jeder Messung woanders",
    new Set(bewegung.punkte).size >= 6, bewegung.punkte.join(", "));
  const spanne = Math.max(...bewegung.punkte) - Math.min(...bewegung.punkte);
  stand.ist("und wandert dabei über die halbe Bahn hinaus",
    spanne > bewegung.bahn * 0.5, `${spanne} px von ${bewegung.bahn} px`);
  // Es beginnt links AUSSERHALB und endet rechts außerhalb — nur dann ist es
  // eine durchlaufende Bahn und kein Pendel in der Mitte.
  //
  // Gemessen wird das NICHT über Stichproben. Acht davon über 880 ms treffen
  // die äußersten Punkte eines 1250-ms-Zyklus nur manchmal — die Prüfung war
  // in dieser Form einmal rot und beim nächsten Lauf grün, ohne dass sich
  // etwas geändert hätte. Stattdessen wird die Animation angehalten und an
  // ihren Anfang und ihr Ende gestellt: dieselbe Aussage, nur ohne Zufall.
  const enden = await seite.evaluate(() => {
    const licht = document.querySelector("#lb-probe .ladebalken-licht");
    const bahn = document.querySelector("#lb-probe .ladebalken-schiene").getBoundingClientRect();
    const anim = licht.getAnimations()[0];
    if (!anim) return null;
    const bei = (t) => {
      anim.currentTime = t;
      const r = licht.getBoundingClientRect();
      return { links: Math.round(r.left - bahn.left), rechts: Math.round(r.right - bahn.left) };
    };
    anim.pause();
    // getComputedTiming(), nicht getTiming(): Letzteres gibt bei einer
    // CSS-Animation "auto" zurück, currentTime bliebe dann stehen.
    const dauer = anim.effect.getComputedTiming().duration;
    const a = bei(0);
    // NICHT auf dauer selbst, sondern kurz davor. Bei currentTime === dauer ist
    // eine Animation mit infinite bereits im NÄCHSTEN Durchlauf und steht damit
    // wieder am Anfang — gemessen: 0,25 → 10 px, 0,5 → 147, 0,75 → 283,
    // 1,0 → wieder −126. Beide Messungen lieferten so denselben Wert, was
    // aussah wie ein Balken, der sich nicht bewegt.
    const e = bei(dauer * 0.999);
    anim.play();
    return { a, e, dauer, bahn: Math.round(bahn.width) };
  });
  stand.ist("am Anfang steht es vollständig links außerhalb",
    enden && enden.a.rechts <= 0, JSON.stringify(enden?.a));
  stand.ist("und am Ende vollständig rechts außerhalb",
    enden && enden.e.links >= enden.bahn - 3,
    `${JSON.stringify(enden?.e)} bei ${enden?.bahn} px Bahn`);

  /* --- Wer weniger Bewegung will, bekommt langsamer — nicht stillstehend -- */
  await seite.emulateMedia({ reducedMotion: "reduce" });
  await seite.waitForTimeout(120);
  const ruhig = await seite.evaluate(() => {
    const st = getComputedStyle(document.querySelector("#lb-probe .ladebalken-licht"));
    return { name: st.animationName, dauer: st.animationDuration };
  });
  stand.ist("bei prefers-reduced-motion läuft er weiter, nur langsamer",
    ruhig.name === "ladebalken-lauf" && parseFloat(ruhig.dauer) > parseFloat(lauf.dauer),
    `${lauf.dauer} → ${ruhig.dauer}`);
  await seite.emulateMedia({ reducedMotion: "no-preference" });

  /* --- Alle langen Lade-Zustände benutzen ihn ---------------------------- */
  // Vier Stellen zeichnen ihn; eine beim nächsten Umbau zu vergessen, fiele
  // sonst niemandem auf. Geprüft an der Quelle, weil jede dieser Stellen sonst
  // eine eigene Attrappe für Scryfall, die Edge Function oder die Combo-API
  // bräuchte.
  const quelle = await seite.evaluate(() => fetch("app.js").then(r => r.text()));
  const lang = ["syn.loading", "syn.aiLoading", "combo.loading", "an.loading"];
  const ohne = lang.filter(k =>
    !new RegExp(`ladeBalken\\(\\s*t\\("${k.replace(".", "\\.")}"`).test(quelle));
  stand.gleich("Synergien, KI-Synergien, Combos und Deck-Analyse zeigen den Balken", ohne, []);
  const nochZahnrad = lang.filter(k =>
    new RegExp(`syn-spin[^\`]*\\$\\{esc\\(t\\("${k.replace(".", "\\.")}"`).test(quelle));
  stand.gleich("und keine davon zeichnet daneben noch das Zahnrad", nochZahnrad, []);
  // Umgekehrt: Das Zahnrad bleibt, wo es hingehört — in Knöpfen und bei allem,
  // was in einem Wimpernschlag da ist. Verschwände es ganz, wäre das ein
  // Zeichen, dass jemand zu grob ersetzt hat.
  stand.ist("das Zahnrad gibt es weiterhin für die kurzen Fälle",
    (quelle.match(/syn-spin/g) || []).length > 10,
    (quelle.match(/syn-spin/g) || []).length + " Stellen");

  /* --- Am Deck steht er da, wo geklickt wurde --------------------------- */
  /* DER EIGENTLICHE FEHLER. Der Balken war gezeichnet und trotzdem unsichtbar:
     Die Ergebniskästen eines Decks stehen UNTER der Kartentabelle, bei hundert
     Karten zweitausend Pixel tiefer. Zu sehen blieb das Zahnrad am Knopf —
     also genau das, was der Balken ersetzen sollte. Gemessen wird deshalb
     nicht „gibt es ihn", sondern „wie weit ist er vom Knopf entfernt". */
  await seite.evaluate(() => document.getElementById("lb-probe")?.remove());
  await seite.evaluate(AUFBAU, { karten: 100, kategorien: 2, decks: 1, ansicht: "tabelle" });
  await seite.waitForTimeout(400);

  // Die Suche anhalten, damit der Lade-Zustand stehen bleibt und sich messen
  // lässt. Ohne Attrappe liefe sie gegen Scryfall.
  await seite.evaluate(() => {
    window.LOESE = null;
    window.themenFuerKarten = async () => null;
    window.synergieAnzeigen = (box) => new Promise(fertig => {
      window.LOESE = () => { box.innerHTML = `<div class="empty">fertig</div>`; fertig(); };
    });
    renderDecks();
  });
  await seite.waitForTimeout(300);
  await seite.locator('[data-synbtn="d0"]').click();
  await seite.waitForTimeout(300);

  const platz = await seite.evaluate(() => {
    const knopf = document.querySelector('[data-synbtn="d0"]').getBoundingClientRect();
    const balken = document.querySelector('[data-ladebox="d0"] .ladebalken');
    const kasten = document.querySelector('.deck-syn[data-synbox="d0"]').getBoundingClientRect();
    return {
      da: !!balken,
      unterKnopf: balken ? Math.round(balken.getBoundingClientRect().top - knopf.bottom) : null,
      kastenUnterKnopf: Math.round(kasten.top - knopf.bottom),
      fenster: innerHeight,
    };
  });
  stand.ist("der Balken steht unter dem Knopf, nicht erst im Ergebniskasten",
    platz.da && platz.unterKnopf >= 0 && platz.unterKnopf < 200,
    `${platz.unterKnopf} px unter dem Knopf`);
  // Die Gegenprobe: Der Ergebniskasten ist WIRKLICH weit weg. Rutschte er
  // eines Tages nach oben, verlöre die Messung darüber ihren Sinn — sie wäre
  // dann grün, ohne noch etwas zu zeigen.
  stand.ist("und der Ergebniskasten liegt tatsächlich außerhalb des Bildes",
    platz.kastenUnterKnopf > platz.fenster,
    `${platz.kastenUnterKnopf} px unter dem Knopf, Fenster ${platz.fenster} px hoch`);

  // Und er verschwindet wieder — ein Ladebalken, der stehen bleibt, wäre eine
  // Suche, die nie fertig wird.
  await seite.evaluate(() => window.LOESE());
  await seite.waitForTimeout(300);
  stand.ist("nach der Suche ist er weg",
    await seite.evaluate(() => !document.querySelector('[data-ladebox="d0"] .ladebalken')));
}
