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
import { changelogStempeln, istHoeher } from "../../scripts/version.mjs";

export const name = "changelog";

const ARTEN = new Set(["neu", "verbessert", "behoben"]);
const VERSION_RX = /^\d+\.\d+\.\d+$/;
const SPRACHEN = ["de", "en", "fr", "es", "it"];

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
    if (!Number.isInteger(e.pr)) kaputt.push(`#${i}: pr fehlt (${e.pr})`);
  });
  stand.gleich("jeder Eintrag hat lesbare Zeit, bekannte Art und PR", kaputt, []);

  /* Der Text steht in allen fünf Sprachen der Oberfläche.

     Die Anzeige verkraftet zwar auch einen blanken String (dann Deutsch für
     alle) und fällt bei einer fehlenden Sprache auf Deutsch zurück — beides
     ist Nachsicht beim LESEN, damit ein halb gepflegter Eintrag nicht die
     ganze Liste killt. Geschrieben wird trotzdem vollständig, und das prüft
     diese Zeile: Ein vergessenes Feld sähe im Dialog sonst richtig aus,
     nämlich deutsch — und niemand, der Deutsch eingestellt hat, würde es je
     bemerken. */
  const luecken = [];
  eintraege.forEach((e, i) => {
    const txt = e && e.text;
    if (!txt || typeof txt !== "object" || Array.isArray(txt))
      return luecken.push(`#${i}: text ist kein Objekt je Sprache`);
    for (const l of SPRACHEN)
      if (typeof txt[l] !== "string" || txt[l].trim().length < 10)
        luecken.push(`#${i}: text.${l} fehlt oder zu kurz`);
    const fremd = Object.keys(txt).filter(l => !SPRACHEN.includes(l));
    if (fremd.length) luecken.push(`#${i}: unbekannte Sprache ${fremd.join(", ")}`);
  });
  stand.gleich("jeder Eintrag steht in allen fünf Sprachen", luecken, []);

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

  /* --- Die Fassung je Eintrag -------------------------------------------
     Sie wird NICHT von Hand geschrieben, sondern von scripts/version.mjs
     gestempelt — beim Schreiben des Eintrags ist sie noch gar nicht bekannt.
     Genau deshalb darf der NEUESTE Eintrag hier fehlen: Der gehört zum
     laufenden Pull Request, und dieser Prüflauf sieht den Stand VOR dem
     Versions-Commit. Alle anderen müssen eine haben — bleibt der Stempel
     einmal aus, fällt es damit beim nächsten Pull Request auf. */
  const ohneVersion = eintraege
    .map((e, i) => (typeof e.version === "string" && VERSION_RX.test(e.version) ? -1 : i))
    .filter(i => i >= 0);
  stand.ist("höchstens der neueste Eintrag ist noch ohne Fassung",
    ohneVersion.length === 0 || (ohneVersion.length === 1 && ohneVersion[0] === 0),
    ohneVersion.length ? `ohne Fassung: Zeilen ${ohneVersion.join(", ")}` : "alle gestempelt");

  // Von oben nach unten geht es zurück in der Zeit, also auch in der Nummer.
  // Eine Fassung, die zweimal oder in der falschen Reihenfolge auftaucht,
  // wäre ein falsch gesetzter Stempel — und der sieht für sich genommen
  // richtig aus.
  const mitVersion = eintraege.filter(e => typeof e.version === "string" && VERSION_RX.test(e.version));
  const verdreht = [];
  for (let i = 1; i < mitVersion.length; i++)
    if (!istHoeher(mitVersion[i - 1].version, mitVersion[i].version))
      verdreht.push(`${mitVersion[i - 1].version} steht über ${mitVersion[i].version}`);
  stand.gleich("die Fassungen laufen nach unten abwärts, ohne Dublette", verdreht, []);

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

  /* --- Der Text in der eingestellten Sprache -----------------------------
     Gemessen wird gegen die DATEI, nicht gegen ein erwartetes Wort: So prüft
     der Fall, dass die richtige Sprache genommen wird, ohne bei jedem neuen
     Eintrag nachgezogen werden zu müssen.

     Und er prüft den Wechsel bei offenem Dialog. Der ist der eigentliche
     Stolperstein: Der statische Text der Oberfläche wird von i18n.js selbst
     nachgezogen, der Inhalt eines schon gebauten Dialogs aber nicht — er
     bliebe stehen, und zwar aussehend wie ein richtig gefüllter Dialog. */
  const sprachen = await seite.evaluate(async () => {
    const lies = () => [...document.querySelectorAll("#changelog-dlg .cl-text")]
      .slice(0, 3).map(el => el.textContent);
    const de = lies();
    setLang("it");
    await new Promise(r => setTimeout(r, 50));
    const it = lies();
    setLang("de");
    await new Promise(r => setTimeout(r, 50));
    return { de, it, zurueck: lies() };
  });
  const soll = l => eintraege.slice(0, 3).map(e => (e.text && e.text[l]) || "");
  stand.gleich("die Zeilen stehen in der eingestellten Sprache", sprachen.de, soll("de"));
  stand.gleich("ein Sprachwechsel zieht den offenen Dialog mit", sprachen.it, soll("it"));
  stand.gleich("und wieder zurück", sprachen.zurueck, soll("de"));

  /* --- Die Fassung steht an jeder Zeile ----------------------------------
     „Jede" heißt: jede, die in der Datei eine hat. Der neueste Eintrag gehört
     zum laufenden Pull Request und wird erst vom Versions-Commit gestempelt —
     seine Zeile bleibt hier also ohne, und das ist richtig so. */
  const versionen = await seite.evaluate(() => {
    const zeilen = [...document.querySelectorAll("#changelog-dlg .cl-zeile")];
    // Gemessen wird an der ersten Zeile, die eine Fassung TRÄGT.
    const zeile = zeilen.find(z => z.querySelector(".cl-version"));
    const marke = zeile?.querySelector(".cl-version");
    const kopf = zeile?.querySelector(".cl-kopf");
    const pr = zeile?.querySelector(".cl-pr");
    return {
      wieviele: zeilen.filter(z => z.querySelector(".cl-version")).length,
      gesamt: zeilen.length,
      text: marke?.textContent.trim() || "",
      titel: marke?.title || "",
      // Sie steht ganz rechts, HINTER der PR-Nummer — beides sind Zahlen, und
      // die Reihenfolge sagt, welche wofür steht.
      hinterPr: !!(marke && pr &&
        pr.getBoundingClientRect().right <= marke.getBoundingClientRect().left),
      amRand: !!(marke && kopf &&
        Math.abs(marke.getBoundingClientRect().right - kopf.getBoundingClientRect().right) < 3),
    };
  });
  const mitFassung = eintraege.filter(e => typeof e.version === "string" && VERSION_RX.test(e.version)).length;
  stand.ist("jede Zeile mit Fassung zeigt sie auch",
    versionen.wieviele === mitFassung && versionen.gesamt === eintraege.length,
    `${versionen.wieviele} Marken bei ${mitFassung} gestempelten Einträgen (${versionen.gesamt} Zeilen)`);
  stand.ist("und zwar als Nummer, nicht als Schlüssel",
    VERSION_RX.test(versionen.text), versionen.text);
  stand.ist("der Hinweis daran ist übersetzt",
    versionen.titel.includes(versionen.text) && !versionen.titel.includes("changelog."),
    versionen.titel);
  stand.ist("sie steht rechts außen, hinter der PR-Nummer",
    versionen.hinterPr && versionen.amRand,
    `hinterPr=${versionen.hinterPr}, amRand=${versionen.amRand}`);

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

  /* --- Was die Kopfzeile daraus macht ------------------------------------
     DREI Fälle, nicht zwei. „Keine gemerkte Fassung" heißt nämlich zweierlei:
     wirklich zum ersten Mal hier — oder schon lange dabei, aber zuletzt eine
     Fassung VOR dieser Anzeige gesehen. Beim Ausliefern von 0.76.0 traf das
     auf JEDEN bestehenden Nutzer zu, und alle bekamen die Behandlung für
     Neulinge: still merken, nicht färben. Die gesamte Nutzerschaft verpasste
     damit genau eine Meldung, nämlich die erste — unbemerkt, denn es sieht
     nicht nach einem Fehler aus, es passiert nur nichts.

     Diese Prüfung hat es nicht gefangen, weil sie den Unterschied gar nicht
     kannte: Sie räumte nur den einen Schlüssel weg und ließ alle anderen
     Spuren stehen. Jetzt wird beides gebaut. */
  const faelle = await seite.evaluate(() => {
    const el = document.getElementById("header-version");
    const lauf = (gemerkt, spuren) => {
      localStorage.clear();
      if (spuren) localStorage.setItem("mtg-lang", "de");   // war schon mal da
      if (gemerkt) localStorage.setItem("mtg-version-gesehen", gemerkt);
      zeigeKopfVersion();
      return { neu: el.classList.contains("neu"), titel: el.title,
               farbe: getComputedStyle(el).color,
               gemerkt: localStorage.getItem("mtg-version-gesehen") };
    };
    const alt = lauf("0.0.1", true);
    const gleich = lauf(APP_VERSION, true);
    const umstieg = lauf(null, true);    // Spuren, aber nichts gemerkt
    const erst = lauf(null, false);      // blanker Browser
    return { alt, gleich, umstieg, erst, version: APP_VERSION };
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

  // Der Fall, an dem es beim Ausliefern gescheitert ist.
  stand.ist("wer schon da war, aber noch nichts gemerkt hat, bekommt Farbe",
    faelle.umstieg.neu, faelle.umstieg.titel);
  stand.ist("und einen Hinweis ohne leere Klammer",
    !faelle.umstieg.titel.includes("()") && !/statt\s+beim/.test(faelle.umstieg.titel),
    faelle.umstieg.titel);
  // Nicht gleich merken: Sonst wäre die Farbe nach dem nächsten Neuladen weg,
  // ohne dass jemand hineingesehen hätte.
  stand.ist("gemerkt wird dabei noch nichts", !faelle.umstieg.gemerkt,
    String(faelle.umstieg.gemerkt));

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

  /* --- Der Stempel, der die Fassung einträgt -----------------------------
     scripts/version.mjs schreibt in eine Datei, die im Repository liegt und
     einen Verlauf hat. Zwei Fehler wären dort teuer und beide unauffällig:
     einen schon ausgelieferten Eintrag überschreiben (Geschichte umschreiben)
     — und beim Umrechnen auf eine neue Basis den eigenen Stempel NICHT
     mitzunehmen, sodass index.html die neue Nummer führt und das Changelog
     die alte. Beide Zahlen sähen für sich genommen richtig aus. */
  // Ausgangspunkt ist der ECHTE Bestand, einmal vollständig gestempelt — im
  // Arbeitsbaum ist der neueste Eintrag ja gerade noch offen. So prüft der
  // Fall weiterhin die echte Formatierung und hängt trotzdem nicht davon ab,
  // in welchem Zustand die Datei beim Lauf zufällig steht.
  const voll = changelogStempeln(roh, "0.0.0").text;
  const untenDrunter = JSON.parse(voll)[0].version;

  const nichts = changelogStempeln(voll, "9.9.9");
  stand.ist("ein voll gestempelter Bestand bleibt Zeichen für Zeichen gleich",
    nichts.text === voll && nichts.offen === 0 && nichts.umgerechnet === 0,
    `offen ${nichts.offen}, umgerechnet ${nichts.umgerechnet}, gleich ${nichts.text === voll}`);

  const probe = JSON.parse(voll);
  probe.unshift({ am: "2026-08-04T02:00:00+02:00", art: "neu",
                  text: Object.fromEntries(SPRACHEN.map(l => [l, `Eintrag ohne Fassung (${l})`])),
                  pr: 999 });
  const frisch = JSON.stringify(probe, null, 1) + "\n";

  /* Zwei Fassungen, die im echten Bestand nicht vorkommen KÖNNEN — eine höher
     als jede darin, und die nächste darüber.

     Hier standen feste Nummern (0.77.0 → 0.78.0), und das ging so lange gut,
     bis die ausgelieferte Fassung sie eingeholt hatte: Seit dem Eintrag zu
     #212 trug der oberste echte Eintrag selbst 0.77.0. Das Umrechnen erwischte
     damit ZWEI Einträge statt einem, die Behauptung darunter wurde rot — an
     einer Datei, die mit der jeweiligen Änderung nichts zu tun hatte. Der
     Fehlschlag blockierte jeden offenen Pull Request und wäre bei jeder
     weiteren Auslieferung wiedergekommen.

     Abgeleitet statt festgeschrieben kann das nicht mehr passieren: Die
     Prüfung rechnet oberhalb von allem, was je ausgeliefert wurde. */
  const hoechsterHauptteil = Math.max(0, ...JSON.parse(voll)
    .map(e => Number(String(e.version ?? "0").split(".")[0]) || 0));
  const stufe = `${hoechsterHauptteil + 1}.0.0`;
  const stufeDrueber = `${hoechsterHauptteil + 1}.1.0`;

  const gestempelt = changelogStempeln(frisch, stufe);
  const nachStempel = JSON.parse(gestempelt.text);
  stand.gleich("der neue Eintrag bekommt die Fassung, der darunter behält seine",
    [gestempelt.offen, nachStempel[0].version, nachStempel[1].version],
    [1, stufe, untenDrunter]);

  const um = changelogStempeln(gestempelt.text, stufeDrueber, stufe);
  const nachUm = JSON.parse(um.text);
  stand.gleich("auf neuer Basis wandert der EIGENE Stempel mit, kein fremder",
    [um.umgerechnet, nachUm[0].version, nachUm[1].version],
    [1, stufeDrueber, untenDrunter]);

  const ohneVorher = changelogStempeln(gestempelt.text, stufeDrueber);
  stand.ist("ohne diese Angabe wird nichts umgeschrieben — Geschichte bleibt stehen",
    ohneVorher.umgerechnet === 0 && ohneVorher.text === gestempelt.text);
}
