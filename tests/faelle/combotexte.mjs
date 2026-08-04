/* Die Normalisierung der Combo-Texte: Kartennamen raus, Platzhalter rein, und
   zurück.

   ANLASS. Commander Spellbook liefert nur Englisch. Übersetzt wird über eine
   Edge Function, und damit nicht jede Combo einzeln bezahlt werden muss, wird
   je SATZ gespeichert: Kartennamen werden durch [[1]], [[2]] ersetzt, sodass
   „Play Basalt Monolith." und „Play Rings of Brighthearth." dasselbe Muster
   ergeben. Gemessen an 600 Combos mit 3210 Sätzen bleiben so 1638 Muster
   übrig — 49 % weniger zu übersetzen.

   Diese Prüfung hält die vier Eigenschaften fest, an denen das hängt. Jede
   davon ist schon einmal beinahe schiefgegangen:

     1. LÄNGSTER NAME GEWINNT. Ohne das frisst „Monolith" den „Basalt
        Monolith", und übrig bleibt „Basalt [[1]]" — ein Satz, der nach dem
        Rückweg einen falschen Kartennamen trägt.

     2. MANASYMBOLE ÜBERLEBEN. Der Platzhalter darf nicht {1} heißen, denn
        mitSymbolen() macht aus JEDEM {…} ein Manasymbol. Aus einem
        Kartennamen würde dort ein Mana-Icon.

     3. HIN UND ZURÜCK ERGIBT DAS ORIGINAL. Solange nichts übersetzt ist,
        läuft der Text durch beide Richtungen — kommt er verändert heraus,
        sieht der Nutzer eine kaputte Anleitung, ohne dass irgendetwas
        fehlgeschlagen wäre.

     4. NUMMERIERT WIRD JE SATZ. „Play {Karte}." muss immer [[1]] ergeben,
        nicht mal [[1]] und mal [[3]], je nachdem wie viele längere Namen die
        Combo sonst führt. Daran hängen die gemessenen 14 % Ersparnis
        gegenüber globaler Nummerierung.

   Läuft im Browser, weil die Funktionen in app.js stehen und dort ohnehin
   geladen werden. */

export const name = "combotexte";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });

  const erg = await seite.evaluate(() => {
    const namen = ["Basalt Monolith", "Monolith", "Rings of Brighthearth"];
    const hinUndZurueck = (roh, n) => {
      const { muster, namen: r } = comboMuster(roh, n);
      return { muster, namen: r, zurueck: comboEinsetzen(muster, r) };
    };

    // 1 — der längere Name gewinnt an derselben Stelle
    const lang = hinUndZurueck("Activate Basalt Monolith's first ability.", namen);

    // 2 — Manasymbole bleiben zeichengenau stehen
    const mana = hinUndZurueck("Tap Basalt Monolith, adding {C}{C}{C}, then pay {3}.", namen);

    // 3 — Hin und zurück über mehrere echte Sätze
    const proben = [
      "Activate Basalt Monolith's first ability by tapping it, adding {C}{C}{C}{C}.",
      "Rings of Brighthearth triggers, causing you to pay {2} to copy Basalt Monolith's last ability.",
      "Repeat.",
      "Repeat from step 2.",
      "Play Basalt Monolith.",
    ];
    const rund = proben.map(p => { const r = hinUndZurueck(p, namen); return r.zurueck === p; });

    // 4 — dieselbe Satzform, verschiedene Karten: EIN Muster
    const a = comboMuster("Play Basalt Monolith.", namen).muster;
    const b = comboMuster("Play Rings of Brighthearth.", namen).muster;

    // Ein Satz ohne Kartennamen bleibt, wie er ist — und braucht keine Namen
    const ohne = comboMuster("Repeat.", namen);

    // Der Platzhalter darf mitSymbolen() nicht in die Quere kommen: gerendert
    // wird der ZURÜCKGESETZTE Text, aber falls doch einmal ein Muster
    // durchrutscht, darf daraus kein Mana-Icon werden.
    const gerendert = mitSymbolen("Play [[1]] for {2}.");

    // Unbekannter Platzhalter: bleibt stehen statt zu verschwinden.
    const fehlend = comboEinsetzen("Play [[7]].", ["Basalt Monolith"]);

    return {
      langMuster: lang.muster, langNamen: lang.namen,
      manaMuster: mana.muster, manaZurueck: mana.zurueck,
      rund, a, b, ohneMuster: ohne.muster, ohneNamen: ohne.namen,
      manaIcons: (gerendert.match(/class="ms /g) || []).length,
      gerendert, fehlend,
    };
  });

  stand.gleich("der längere Kartenname gewinnt, nicht der enthaltene",
    erg.langMuster, "Activate [[1]]'s first ability.");
  stand.gleich("und der Platzhalter zeigt auf den vollen Namen",
    erg.langNamen, ["Basalt Monolith"]);

  stand.ist("Manasymbole bleiben zeichengenau stehen",
    (erg.manaMuster.match(/\{C\}/g) || []).length === 3 && erg.manaMuster.includes("{3}"),
    erg.manaMuster);
  stand.gleich("und überstehen den Rückweg",
    erg.manaZurueck, "Tap Basalt Monolith, adding {C}{C}{C}, then pay {3}.");

  stand.ist("hin und zurück ergibt jeden Satz unverändert",
    erg.rund.every(Boolean), `${erg.rund.filter(Boolean).length} von ${erg.rund.length}`);

  stand.gleich("dieselbe Satzform mit verschiedenen Karten ergibt EIN Muster",
    [erg.a, erg.b], ["Play [[1]].", "Play [[1]]."]);

  stand.gleich("ein Satz ohne Kartennamen bleibt unberührt",
    [erg.ohneMuster, erg.ohneNamen], ["Repeat.", []]);

  /* Die Falle, wegen der der Platzhalter [[1]] heißt und nicht {1}: In
     „Play [[1]] for {2}." darf GENAU EIN Symbol entstehen, nämlich das {2}. */
  stand.gleich("aus einem Platzhalter wird kein Manasymbol", erg.manaIcons, 1);
  stand.ist("und der Platzhalter kommt unversehrt durch mitSymbolen",
    erg.gerendert.includes("[[1]]"), erg.gerendert);

  stand.gleich("ein Platzhalter ohne Namen bleibt stehen statt zu verschwinden",
    erg.fehlend, "Play [[7]].");

  /* --- Was die Übersetzung gekostet hat ---------------------------------
     Dieselbe Auskunft wie bei den KI-Synergien und der Regelfrage. Der
     Speicher macht hier aber einen Fall auf, den es dort nicht gibt: Kam
     ALLES aus der gemeinsamen Tabelle, hat es keinen Modellaufruf gegeben.
     „$0,0000" wäre da die falsche Auskunft — es hat nicht fast nichts
     gekostet, sondern gar nichts, und genau dafür ist der Speicher gebaut.

     Geprüft wird gegen eine gefälschte Antwort der Function: Die echte
     braucht Anmeldung, Schalter, Kontingent und ein Modell — nichts davon
     gehört in einen Prüflauf, und keines davon prüft, was hier zur Debatte
     steht, nämlich die Rechnung und die Platzierung. */
  const kosten = await seite.evaluate(async () => {
    /* Im Prüflauf gibt es keine Datenbankverbindung, `sb` ist null. Gefälscht
       wird deshalb der ganze Client — gebraucht wird davon genau eine
       Methode. */
    let gesendet = [];
    const sbAlt = sb;
    sb = { functions: { invoke: null } };
    const antworten = a => {
      sb.functions.invoke = async (_name, opts) => {
        gesendet.push(opts.body.teile.map(t => t.text));
        return { data: a, error: null };
      };
    };

    let nr = 0;
    /* Ein Kasten wie im Deck: Kopfzeile, Gitter, darin eine Combo mit
       sichtbarem Ergebnis-Punkt und zugeklappten Details. */
    const bauen = () => {
      const erg = ++nr, schritt = ++nr;
      COMBO_TEILE.set(erg, { muster: "Infinite mana", namen: [], roh: "Infinite mana" });
      COMBO_TEILE.set(schritt, { muster: "Repeat.", namen: [], roh: "Repeat." });
      const box = document.createElement("div");
      box.innerHTML = `<div class="meta">Kopfzeile</div>
        <div class="combo-grid"><div class="combo">
          <ul class="combo-results"><li><span data-cmb="${erg}">Infinite mana</span></li></ul>
          <details class="combo-det"><summary>Details</summary>
            <div class="combo-det-body"><ol><li><span data-cmb="${schritt}">Repeat.</span></li></ol></div>
          </details>
        </div></div>`;
      document.body.appendChild(box);
      wireComboDetails(box);
      return box;
    };
    const zeileAus = el => {
      const z = el.querySelector(".cmb-kosten");
      return { text: z?.textContent ?? "", anzahl: el.querySelectorAll(".cmb-kosten").length };
    };

    setLang("de");

    // --- Beim Zeichnen: nur der sichtbare Ergebnis-Punkt geht raus ---------
    gesendet = [];
    const box1 = bauen();
    antworten({ texte: ["Unendlich Mana"], neu: 1, gesamt: 1,
      // 1.000.000 Eingabe- und 1.000.000 Ausgabe-Tokens bei Sonnet: 3 + 15 USD.
      usage: { input: 1e6, output: 1e6, model: "claude-sonnet-4-6" } });
    await comboTexteNachreichen(box1);
    const beimZeichnen = { gesendet: gesendet.slice(), ...zeileAus(box1) };

    // --- Beim Aufklappen: die Anleitung dieser einen Combo -----------------
    gesendet = [];
    antworten({ texte: ["Wiederholen."], neu: 1, gesamt: 1, usage: null });
    const det = box1.querySelector("details.combo-det");
    det.open = true;
    await new Promise(r => setTimeout(r, 30));
    const beimAufklappen = {
      gesendet: gesendet.slice(),
      ...zeileAus(det.querySelector(".combo-det-body")),
      obenNochEine: box1.querySelectorAll(".cmb-kosten").length,
    };

    // --- Ein zweites Aufklappen schickt nichts mehr ------------------------
    gesendet = [];
    det.open = false; det.open = true;
    await new Promise(r => setTimeout(r, 30));
    const nochmal = gesendet.slice();
    box1.remove();

    // --- Ohne Modellaufruf: keine Kosten, und das steht auch da ------------
    const box2 = bauen();
    antworten({ texte: ["Unendlich Mana"], neu: 0, gesamt: 12, usage: null });
    await comboTexteNachreichen(box2);
    const ausSpeicher = zeileAus(box2);
    box2.remove();

    // --- Mit Kennung (Kontingent alle): gar keine Zeile --------------------
    const box3 = bauen();
    antworten({ texte: [null], neu: 0, gesamt: 12, code: "quota" });
    await comboTexteNachreichen(box3);
    const mitKennung = zeileAus(box3);
    box3.remove();

    sb = sbAlt;
    return { beimZeichnen, beimAufklappen, nochmal, ausSpeicher, mitKennung };
  });

  /* Die Zusage, um die es dem Eigentümer ging: Zugeklapptes kostet nichts.
     Beim Zeichnen geht NUR der sichtbare Ergebnis-Punkt raus, die Anleitung
     bleibt liegen, bis jemand sie aufmacht. */
  stand.gleich("beim Zeichnen geht nur der sichtbare Ergebnis-Punkt raus",
    kosten.beimZeichnen.gesendet, [["Infinite mana"]]);
  stand.gleich("beim Aufklappen dann die Anleitung dieser einen Combo",
    kosten.beimAufklappen.gesendet, [["Repeat."]]);
  // Ohne das käme jeder Satz bei jedem Auf- und Zuklappen erneut — und jedes
  // Mal möglicherweise gegen Bezahlung.
  stand.gleich("ein zweites Aufklappen schickt nichts mehr",
    kosten.nochmal, []);

  stand.ist("die Zeile nennt Kosten, Tokens und wie viele Sätze neu waren",
    kosten.beimZeichnen.text.includes("$18,0000") && kosten.beimZeichnen.text.includes("1"),
    kosten.beimZeichnen.text);
  // Sie gehört dorthin, wo die Kosten entstanden sind: in die aufgeklappte
  // Combo, nicht über die ganze Liste.
  stand.gleich("beim Aufklappen steht sie in genau dieser Combo",
    [kosten.beimAufklappen.anzahl, kosten.beimAufklappen.obenNochEine], [1, 2]);

  // Der Fall, für den der Satzspeicher gebaut ist: kein Aufruf, keine Kosten.
  stand.ist("kam alles aus dem Speicher, sagt sie das statt „$0,0000“",
    kosten.ausSpeicher.text.includes("12") && !kosten.ausSpeicher.text.includes("$"),
    kosten.ausSpeicher.text);

  // Eine Kennung heißt: es wurde NICHT übersetzt. Eine Kostenzeile daneben
  // behauptete eine Übersetzung, die nicht stattgefunden hat.
  stand.gleich("bei Kontingent oder Fehler steht gar keine Zeile da",
    kosten.mitKennung.anzahl, 0);
}
