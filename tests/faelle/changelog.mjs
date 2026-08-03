/* Changelog: die Datei ist wohlgeformt, und der Dialog zeigt sie.

   Das Changelog wird von Hand gepflegt (je Pull Request ein Eintrag vorn,
   siehe CLAUDE.md) — und von Hand gepflegte Dateien gehen von Hand kaputt:
   ein vergessenes Komma macht aus der Liste ungültiges JSON, ein Tippfehler
   in der Art („verbesert") fiele im Dialog als nacktes Wort auf, eine falsch
   geschriebene Zeit als roher String. Nichts davon würde rot — die App fängt
   alles ab und zeigt eben Murks. Deshalb prüft dieser Fall die DATEI streng,
   und die Anzeige dazu. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const name = "changelog";

const ARTEN = new Set(["neu", "verbessert", "behoben"]);

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Datei selbst ---------------------------------------------------- */
  const roh = await readFile(join(wurzel, "changelog.json"), "utf8");
  let eintraege = null;
  try { eintraege = JSON.parse(roh); } catch { /* unten gemeldet */ }
  stand.ist("changelog.json ist gültiges JSON", Array.isArray(eintraege),
    eintraege ? `${eintraege.length} Einträge` : "Parse-Fehler");
  if (!Array.isArray(eintraege)) return;

  const kaputt = [];
  eintraege.forEach((e, i) => {
    if (!e || typeof e !== "object") return kaputt.push(`#${i}: kein Objekt`);
    if (isNaN(new Date(e.am))) kaputt.push(`#${i}: am unlesbar (${e.am})`);
    if (!ARTEN.has(e.art)) kaputt.push(`#${i}: art unbekannt (${e.art})`);
    if (typeof e.text !== "string" || e.text.trim().length < 10)
      kaputt.push(`#${i}: text fehlt oder zu kurz`);
    if (!Number.isInteger(e.pr)) kaputt.push(`#${i}: pr fehlt (${e.pr})`);
  });
  stand.gleich("jeder Eintrag hat lesbare Zeit, bekannte Art, Text und PR", kaputt, []);

  // Neueste zuerst — die Datei wird vorn ergänzt, und der Dialog verlässt
  // sich auf die Reihenfolge, statt selbst zu sortieren.
  const zeiten = eintraege.map(e => new Date(e.am).getTime());
  stand.ist("die Einträge stehen neueste zuerst",
    zeiten.every((z, i) => i === 0 || z <= zeiten[i - 1]),
    `${eintraege.length} Einträge, oben ${eintraege[0].am}`);

  // Doppelte PR-Nummern wären ein Zeichen, dass jemand den Hinweis „nächste
  // freie nehmen" übersehen hat.
  const prs = eintraege.map(e => e.pr);
  stand.ist("keine PR-Nummer doppelt", new Set(prs).size === prs.length,
    `${prs.length} Nummern`);

  /* --- Der Dialog ----------------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(() => {
    document.getElementById("gate").style.display = "none";
    document.getElementById("app").style.display = "block";
    if (typeof setLang === "function") setLang("de");
  });

  const dialog = await seite.evaluate(async () => {
    await zeigeChangelog();
    await new Promise(r => setTimeout(r, 150));
    const dlg = document.getElementById("changelog-dlg");
    const zeilen = [...dlg.querySelectorAll(".cl-zeile")];
    return {
      offen: dlg.open,
      zeilen: zeilen.length,
      ersteArt: zeilen[0]?.querySelector(".cl-art")?.textContent || "",
      ersteZeit: zeilen[0]?.querySelector(".cl-zeit")?.textContent || "",
      ersterLink: zeilen[0]?.querySelector(".cl-pr")?.getAttribute("href") || "",
    };
  });
  stand.ist("der Dialog öffnet und zeigt alle Einträge",
    dialog.offen && dialog.zeilen === eintraege.length,
    `${dialog.zeilen} von ${eintraege.length}`);
  stand.ist("die Art ist übersetzt, nicht der rohe Schlüssel",
    ["Neu", "Verbessert", "Behoben"].includes(dialog.ersteArt), dialog.ersteArt);
  stand.ist("die Zeit ist formatiert (kein rohes ISO)",
    !!dialog.ersteZeit && !dialog.ersteZeit.includes("T"), dialog.ersteZeit);
  stand.ist("der PR-Verweis zeigt auf GitHub",
    dialog.ersterLink.startsWith("https://github.com/imm0r/MTGTC-Archive/pull/"),
    dialog.ersterLink);

  // Die Versionsnummer im Kopf ist der Einstieg — sie muss klickbar sein und
  // denselben Dialog öffnen.
  const knopf = await seite.evaluate(() => {
    document.getElementById("changelog-dlg").close();
    zeigeKopfVersion();
    const el = document.getElementById("header-version");
    el.click();
    return { istKnopf: el.tagName === "BUTTON", titel: el.title };
  });
  await seite.waitForTimeout(150);
  stand.ist("die Versionsnummer im Kopf ist ein Knopf mit sprechendem title",
    knopf.istKnopf && knopf.titel.length > 8, knopf.titel);
  stand.ist("ihr Klick öffnet das Changelog",
    await seite.evaluate(() => document.getElementById("changelog-dlg").open));

  /* --- Neue Fassung seit dem letzten Besuch ------------------------------
     Verglichen wird nur auf UNGLEICH, nicht auf „größer". Das geht, weil die
     Nummer nur nach oben läuft (version.yml rechnet sie aus dem Zielzweig
     hoch) — und es macht die Falle gegenstandslos, die ein Größenvergleich
     mitbrächte: Als Text steht "0.9.0" NACH "0.10.0", die neue Fassung gälte
     also als die ältere und die Nummer bliebe grau. Ein Fehler, der genau
     einmal im Leben der App aufträte und dann niemandem erklärbar wäre.

     Geprüft wird deshalb beides: dass Ungleiches erkannt wird — und dass die
     Zehnerstelle daran nichts ändert, in BEIDE Richtungen. */
  const vergleich = await seite.evaluate(() => ({
    hoeher:    versionAnders("0.75.2", "0.75.1"),
    gleich:    versionAnders("0.75.1", "0.75.1"),
    zurueck:   versionAnders("0.75.0", "0.75.1"),   // zurückgenommene Auslieferung
    zehner:    versionAnders("0.10.0", "0.9.0"),    // die Falle, die es nicht mehr gibt
    zehnerRum: versionAnders("0.9.0", "0.10.0"),
    anhang:    versionAnders("0.76.0-rc1", "0.75.2"),
    leerA:     versionAnders("", "0.75.1"),
    leerB:     versionAnders("0.75.1", ""),
  }));
  stand.gleich("eine andere Fassung wird erkannt, dieselbe nicht",
    [vergleich.hoeher, vergleich.gleich], [true, false]);
  stand.gleich("die Zehnerstelle ändert nichts — in beide Richtungen",
    [vergleich.zehner, vergleich.zehnerRum], [true, true]);
  // Eine zurückgenommene Auslieferung IST eine Änderung seit dem letzten
  // Besuch, und genau das soll die Farbe sagen.
  stand.ist("auch eine zurückgenommene Auslieferung zählt als Änderung",
    vergleich.zurueck && vergleich.anhang);
  // Ohne gemerkte Fassung darf nie hervorgehoben werden — sonst leuchtete die
  // Nummer beim allerersten Besuch, wo es nichts zu verpassen gab.
  stand.gleich("eine leere Angabe zählt nie als Änderung",
    [vergleich.leerA, vergleich.leerB], [false, false]);

  /* --- Was die Kopfzeile daraus macht ------------------------------------ */
  const faelle = await seite.evaluate(() => {
    const el = document.getElementById("header-version");
    const lauf = (gemerkt) => {
      if (gemerkt === null) localStorage.removeItem("mtg-version-gesehen");
      else localStorage.setItem("mtg-version-gesehen", gemerkt);
      zeigeKopfVersion();
      return { neu: el.classList.contains("neu"), titel: el.title,
               farbe: getComputedStyle(el).color, gemerkt: localStorage.getItem("mtg-version-gesehen") };
    };
    const alt = lauf("0.0.1");
    const gleich = lauf(APP_VERSION);
    const erst = lauf(null);
    return { alt, gleich, erst, version: APP_VERSION };
  });
  stand.ist("nach einer neuen Fassung ist die Nummer hervorgehoben",
    faelle.alt.neu, faelle.alt.titel);
  stand.ist("und der Hinweis nennt die Fassung von vorher",
    faelle.alt.titel.includes("0.0.1") && faelle.alt.titel.includes(faelle.version),
    faelle.alt.titel);
  stand.ist("bei gleicher Fassung bleibt sie unauffällig",
    !faelle.gleich.neu, faelle.gleich.titel);
  stand.ist("die Farbe unterscheidet sich wirklich, nicht nur die Klasse",
    faelle.alt.farbe !== faelle.gleich.farbe,
    `${faelle.alt.farbe} statt ${faelle.gleich.farbe}`);
  // Wer noch nie hier war, hat nichts verpasst. Ohne diese Ausnahme leuchtete
  // die Nummer jedem Neuling entgegen und bedeutete nichts.
  stand.ist("beim allerersten Besuch ist sie nicht hervorgehoben",
    !faelle.erst.neu, faelle.erst.titel);
  stand.ist("die laufende Fassung wird dabei trotzdem gemerkt",
    faelle.erst.gemerkt === faelle.version, faelle.erst.gemerkt);

  // Und ein Blick ins Changelog nimmt die Hervorhebung wieder weg.
  const danach = await seite.evaluate(async () => {
    localStorage.setItem("mtg-version-gesehen", "0.0.1");
    zeigeKopfVersion();
    const el = document.getElementById("header-version");
    const vorher = el.classList.contains("neu");
    document.getElementById("changelog-dlg").close();
    await zeigeChangelog();
    return { vorher, nachher: el.classList.contains("neu"),
             gemerkt: localStorage.getItem("mtg-version-gesehen") };
  });
  stand.ist("ein Blick ins Changelog nimmt die Hervorhebung weg",
    danach.vorher && !danach.nachher, JSON.stringify(danach));
  stand.ist("und merkt sich die jetzige Fassung",
    danach.gemerkt === faelle.version, danach.gemerkt);
}
