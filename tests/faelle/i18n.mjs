/* Übersetzungen: vollständig, und jeder benutzte Schlüssel existiert.

   Zwei Fehler, die sonst erst auffallen, wenn jemand die Sprache umstellt:
   ein Schlüssel, den nur Deutsch kennt (die anderen vier zeigen dann den
   Schlüsselnamen), und ein Tippfehler im Aufruf (t("kat.assignd")), der in
   JEDER Sprache den Schlüsselnamen zeigt.

   Läuft im Browser, weil i18n.js und app.js dort ohnehin geladen werden — ein
   zweiter Weg, dieselben Dateien zu lesen, liefe irgendwann auseinander. */

export const name = "i18n";

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });

  const erg = await seite.evaluate(async () => {
    const sprachen = Object.keys(I18N);
    const leit = "de";
    const fehlend = {};
    for (const s of sprachen) {
      if (s === leit) continue;
      const weg = Object.keys(I18N[leit]).filter(k => !(k in I18N[s]));
      if (weg.length) fehlend[s] = weg;
    }
    // Schlüssel, die nur eine Nebensprache kennt — meist ein Überbleibsel.
    const ueberzaehlig = {};
    for (const s of sprachen) {
      if (s === leit) continue;
      const zuviel = Object.keys(I18N[s]).filter(k => !(k in I18N[leit]));
      if (zuviel.length) ueberzaehlig[s] = zuviel;
    }

    /* Alle t("…")-Aufrufe aus app.js gegen die deutsche Liste halten. Zu
       unterscheiden sind zwei Formen, erkennbar am Zeichen HINTER dem String:

         t("kat.assigned")      — fertiger Schlüssel, muss es geben
         t("type." + zeile)     — Vorsilbe, der Rest entsteht erst beim Laufen

       Die zweite Form als fertigen Schlüssel zu lesen, meldete "type." als
       unbekannt — richtig gerechnet, falsch gefragt. Prüfbar ist an ihr nur,
       dass es überhaupt Schlüssel mit dieser Vorsilbe gibt; genau das fällt
       weg, wenn jemand eine Gruppe umbenennt. */
    const quelle = await (await fetch("app.js")).text();
    const rufe = [...quelle.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*([),+])/g)];
    const benutzt = new Set(rufe.filter(m => m[2] !== "+").map(m => m[1]));
    const vorsilben = new Set(rufe.filter(m => m[2] === "+").map(m => m[1]));
    const unbekannt = [...benutzt].filter(k => !(k in I18N[leit]));
    const leereVorsilben = [...vorsilben]
      .filter(v => !Object.keys(I18N[leit]).some(k => k.startsWith(v)));

    // Dasselbe für die data-i18n-Merkmale im Seitengerüst.
    const ausHtml = [...document.querySelectorAll("[data-i18n],[data-i18n-html],[data-i18n-ph],[data-i18n-title]")]
      .flatMap(el => [el.dataset.i18n, el.dataset.i18nHtml, el.dataset.i18nPh, el.dataset.i18nTitle])
      .filter(Boolean);
    const unbekanntHtml = [...new Set(ausHtml)].filter(k => !(k in I18N[leit]));

    /* Die Zonen einer Combo kommen von Commander Spellbook als EINZELNE
       BUCHSTABEN und werden erst zur Laufzeit über ZONE_NAMES zu Schlüsseln.
       Für den Abgleich oben sind sie damit unsichtbar: t(ZONE_NAMES[z]) sieht
       nach einem zusammengesetzten Aufruf aus, und fehlte einer der sieben
       Schlüssel, stünde in ALLEN fünf Sprachen der Schlüsselname da — die
       Lückenprüfung schlägt nicht an, weil überall dasselbe fehlt.

       Genau so war es: zone.stack gab es nirgends. Deshalb hier die Probe an
       den Buchstaben selbst, die CSB liefern kann. */
    const zonenFehlt = {};
    for (const s of sprachen) {
      const weg = Object.entries(ZONE_NAMES)
        .filter(([, k]) => !(k in I18N[s]))
        .map(([b, k]) => `${b}→${k}`);
      if (weg.length) zonenFehlt[s] = weg;
    }
    const zonenProbe = Object.entries(ZONE_NAMES).map(([b, k]) => `${b}=${I18N[leit][k] ?? "?"}`).join(" ");

    return { sprachen, anzahl: Object.keys(I18N[leit]).length,
      fehlend, ueberzaehlig, unbekannt, unbekanntHtml, benutzt: benutzt.size,
      vorsilben: [...vorsilben], leereVorsilben, zonenFehlt, zonenProbe };
  });

  stand.gleich("fünf Sprachen", erg.sprachen.sort(), ["de", "en", "es", "fr", "it"]);
  stand.ist("keine Sprache hat Lücken", Object.keys(erg.fehlend).length === 0,
    Object.keys(erg.fehlend).length
      ? Object.entries(erg.fehlend).map(([s, k]) => `${s}: ${k.slice(0, 5).join(", ")}${k.length > 5 ? " …" : ""}`).join(" | ")
      : `${erg.anzahl} Schlüssel je Sprache`);
  stand.ist("keine überzähligen Schlüssel", Object.keys(erg.ueberzaehlig).length === 0,
    Object.entries(erg.ueberzaehlig).map(([s, k]) => `${s}: ${k.join(", ")}`).join(" | "));
  stand.ist("jeder t()-Aufruf in app.js hat einen Schlüssel", erg.unbekannt.length === 0,
    erg.unbekannt.length ? erg.unbekannt.join(", ") : `${erg.benutzt} verschiedene Aufrufe`);
  stand.ist("auch die zusammengesetzten Aufrufe finden ihre Gruppe",
    erg.leereVorsilben.length === 0,
    erg.leereVorsilben.length ? erg.leereVorsilben.join(", ")
      : `${erg.vorsilben.length} Vorsilben: ${erg.vorsilben.join(", ")}`);
  stand.ist("jedes data-i18n in index.html hat einen Schlüssel", erg.unbekanntHtml.length === 0,
    erg.unbekanntHtml.join(", "));
  stand.ist("jede Combo-Zone hat in jeder Sprache ein Wort",
    Object.keys(erg.zonenFehlt).length === 0,
    Object.keys(erg.zonenFehlt).length
      ? Object.entries(erg.zonenFehlt).map(([s, k]) => `${s}: ${k.join(", ")}`).join(" | ")
      : erg.zonenProbe);
}
