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
}
