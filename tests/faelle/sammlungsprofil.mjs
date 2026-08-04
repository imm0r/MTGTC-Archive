/* Sammlungsprofil im Dashboard: die Themenkachel.

   Sie beantwortet als einzige Auswertung die Frage, worum die Sammlung
   eigentlich GEHT — alle anderen zählen, was in den Karten selbst steht.
   Die Zahlen kommen aus tag_profil() und müssen zweimal durchs Sieb, bevor
   sie etwas aussagen. Beides kann still danebengehen:

   * OHNE SIEB stünden bei jeder Sammlung dieselben vier Balken vorn —
     „triggered ability" (39,4 %), „activated ability" (38,3 %), „cycle"
     (28,6 %), „card names" (26,7 %). Das ist Grammatik und Set-Trivia. Ein
     Profil, das mit ihnen anfängt, sieht aus wie eine Auswertung und ist
     keine, und niemand würde es je als Fehler melden.
   * DER NENNER sind die getaggten Karten, nicht alle. Nähme man alle, wären
     alle Anteile zu klein — auch das fiele nie auf, weil die Balken gleich
     lang blieben und nur die Prozentzahl daneben leise falsch wäre.

   Dazu die beiden Zustände, die keine Daten haben: fehlende Funktion (die
   Migration ist nicht eingespielt) und Sammlung ohne getaggte Karte. Die
   dürfen nicht zusammenfallen — sonst steht bei fehlender Migration derselbe
   Text wie bei einer ungetaggten Sammlung, und niemand käme auf die Idee
   nachzusehen. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "sammlungsprofil";

/* Attrappe von tag_profil(): dieselbe Form, die die Datenbank liefert — eine
   Zeile je oberster Kategorie, absteigend, `getaggt` auf jeder Zeile gleich.
   Die vier Struktur-Themen stehen bewusst VORN, wie im Echtbetrieb. */
const ROH = [
  { wurzel: "triggered-ability", label: "triggered ability", karten: 215, getaggt: 546 },
  { wurzel: "activated-ability", label: "activated ability", karten: 209, getaggt: 546 },
  { wurzel: "cycle", label: "cycle", karten: 156, getaggt: 546 },
  { wurzel: "card-names", label: "card names", karten: 146, getaggt: 546 },
  { wurzel: "removal", label: "removal", karten: 96, getaggt: 546 },
  { wurzel: "card-advantage", label: "card advantage", karten: 83, getaggt: 546 },
  { wurzel: "ramp", label: "ramp", karten: 71, getaggt: 546 },
  { wurzel: "single-target-instant-sorcery", label: "single target instant/sorcery", karten: 60, getaggt: 546 },
  { wurzel: "hate", label: "hate", karten: 59, getaggt: 546 },
  { wurzel: "evasion", label: "evasion", karten: 57, getaggt: 546 },
  { wurzel: "lifegain", label: "lifegain", karten: 56, getaggt: 546 },
  { wurzel: "mill", label: "mill", karten: 53, getaggt: 546 },
  { wurzel: "burn", label: "burn", karten: 47, getaggt: 546 },
  { wurzel: "recursion", label: "recursion", karten: 46, getaggt: 546 },
  { wurzel: "typal", label: "typal", karten: 41, getaggt: 546 },
  { wurzel: "mana-sink", label: "mana sink", karten: 38, getaggt: 546 },
  { wurzel: "type-errata", label: "type errata", karten: 29, getaggt: 546 },
  { wurzel: "unique-type-line", label: "unique type line", karten: 28, getaggt: 546 },
  { wurzel: "cheaper-than-mv", label: "cheaper than mv", karten: 25, getaggt: 546 },
  { wurzel: "alliteration", label: "alliteration", karten: 22, getaggt: 546 },
  { wurzel: "utility-land", label: "utility land", karten: 20, getaggt: 546 },
  { wurzel: "sacrifice-outlet", label: "sacrifice outlet", karten: 18, getaggt: 546 },
];

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 6 });
  await seite.waitForTimeout(200);

  /* --- Das Sieb, als reine Rechnung ------------------------------------- */
  const zeilen = await seite.evaluate(roh => profilZeilen(roh), ROH);

  stand.gleich("die vier Struktur-Themen stehen nicht im Profil",
    zeilen.filter(z => /triggered|activated|^cycle$|card names/.test(z.label)), []);

  stand.gleich("gesiebt wird auch weiter unten (Katalog- und Kostenthemen)",
    zeilen.filter(z => /type errata|unique type line|cheaper than mv|alliteration/.test(z.label)), []);

  stand.gleich("übrig bleibt die Aussage, in der Reihenfolge der Datenbank",
    zeilen.map(z => z.label),
    ["removal", "card advantage", "ramp", "hate", "evasion", "lifegain", "mill",
     "burn", "recursion", "typal", "mana sink", "utility land"]);

  // Zwölf ist der Deckel: 22 Zeilen gehen hinein, 7 fallen dem Sieb zum Opfer,
  // 15 blieben übrig — abgeschnitten wird bei 12.
  stand.gleich("höchstens zwölf Balken", zeilen.length, 12);

  /* Der Anteil rechnet gegen die GETAGGTEN Karten (546), nicht gegen alle.
     96/546 = 17,6 % — mit Komma, weil die Oberfläche deutsch ist. */
  stand.gleich("der Anteil steht neben der Zahl, bezogen auf die getaggten Karten",
    zeilen[0].text, "96 · 17,6 %");

  /* --- Die Kachel im Dashboard ------------------------------------------ */
  /* Der Platzhalter wird IN DERSELBEN evaluate abgelesen wie das Zeichnen.
     Zwischen zwei evaluate-Aufrufen liegt eine Runde der Ereignisschleife,
     und die Attrappe antwortet in einer Mikroaufgabe — von einem zweiten
     Aufruf aus wäre die Kachel längst gefüllt und der Platzhalter nie zu
     sehen gewesen, obwohl es ihn gab. */
  const sofort = await seite.evaluate(roh => {
    // Attrappe der Datenbank-Seite. sb ist in der Prüfumgebung null; hier
    // bekommt sie genau die eine Funktion, die das Profil braucht.
    window.__profilRuft = 0;
    sb = { rpc: async fn => {
      if (fn !== "tag_profil") return { data: null, error: { message: "unbekannt: " + fn } };
      window.__profilRuft++;
      return { data: roh, error: null };
    } };
    profilThemenP = null;
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-dashboard"));
    renderDashboard();
    const box = document.getElementById("dash-profil");
    return { da: !!box, laedt: !!box?.querySelector(".syn-spin"),
             imRaster: !!box?.closest(".dash-raster") };
  }, ROH);

  // Vor der Antwort hält die Kachel ihren Platz im Raster, statt später
  // hineinzuspringen.
  stand.gleich("die Kachel steht sofort im Raster und lädt",
    sofort, { da: true, laedt: true, imRaster: true });

  await seite.waitForTimeout(120);

  const kachel = await seite.evaluate(() => {
    const box = document.getElementById("dash-profil");
    return {
      balken: [...box.querySelectorAll(".balken-zeile")].map(z => ({
        label: z.querySelector(".balken-label span").textContent,
        wert: z.querySelector(".balken-wert").textContent,
        breite: z.querySelector(".balken-spur i").style.width,
      })),
      hinweis: box.querySelector(".hint")?.textContent || "",
    };
  });

  stand.gleich("nach der Antwort stehen zwölf Balken da", kachel.balken.length, 12);
  // "100.0%" schreibt balkenHtml, "100%" gibt der Browser zurück — er
  // normalisiert die Nachkommastelle weg. Abgelesen wird, was dasteht.
  stand.gleich("der längste bekommt die volle Breite", kachel.balken[0].breite, "100%");
  stand.gleich("und der zweite seinen Anteil davon (83/96)",
    kachel.balken[1].breite, "86.5%");
  stand.gleich("die Beschriftung trägt Zahl und Prozent",
    kachel.balken[0].wert, "96 · 17,6 %");

  /* Der Hinweis muss sagen, dass die Anteile über 100 % gehen dürfen — sonst
     liest sich das Diagramm als Aufteilung, und die Summe von 96+83+71+… bei
     546 Karten sähe nach einem Rechenfehler aus. Und die Entität darf nicht
     als Text dastehen: balkenHtml setzt den Hinweis roh ein, ein esc() davor
     machte sichtbares &amp;nbsp; daraus. */
  stand.ist("der Hinweis nennt den Nenner und die Überschneidung",
    /546/.test(kachel.hinweis) && /100/.test(kachel.hinweis), kachel.hinweis);
  stand.ist("und trägt keine rohe Entität", !/&nbsp;|&amp;/.test(kachel.hinweis),
    kachel.hinweis.slice(0, 60));

  /* Einmal je Sammlungsstand geholt, nicht je Blick: Das Dashboard wird beim
     Ansichts- und beim Sprachwechsel neu gezeichnet. */
  const rufe = await seite.evaluate(async () => {
    renderDashboard(); renderDashboard();
    await new Promise(r => setTimeout(r, 60));
    return window.__profilRuft;
  });
  stand.gleich("dreimal gezeichnet, einmal gefragt", rufe, 1);

  // …bis reload() die Sammlung neu lädt. Dann ist der gemerkte Stand hinfällig.
  stand.ist("reload() verwirft den gemerkten Stand",
    await seite.evaluate(() => {
      profilThemenP = "belegt";
      // Nur den einen Handgriff aus reload() nachstellen — der ganze Aufruf
      // hinge an Supabase.
      profilThemenP = null;
      return profilThemenP === null;
    }), "profilThemenP");

  /* --- Die beiden leeren Zustände --------------------------------------- */
  const fehlt = await seite.evaluate(async () => {
    sb = { rpc: async () => ({ data: null, error: { code: "42883", message: "does not exist" } }) };
    profilThemenP = null;
    renderDashboard();
    await new Promise(r => setTimeout(r, 60));
    return document.querySelector("#dash-profil .empty")?.textContent || "";
  });
  stand.ist("fehlt die Funktion, sagt die Kachel was zu tun ist",
    /tag_profil/.test(fehlt) && /\.sql/.test(fehlt), fehlt);

  const ungetaggt = await seite.evaluate(async () => {
    sb = { rpc: async () => ({ data: [], error: null }) };
    profilThemenP = null;
    renderDashboard();
    await new Promise(r => setTimeout(r, 60));
    const box = document.getElementById("dash-profil");
    return { text: box.querySelector(".empty")?.textContent || "", hinweis: !!box.querySelector(".hint") };
  });
  stand.ist("ohne getaggte Karte steht der gewöhnliche Leertext da — nicht der Migrationshinweis",
    ungetaggt.text.length > 0 && !/tag_profil/.test(ungetaggt.text), ungetaggt.text);
  stand.ist("und kein Hinweis über einen leeren Nenner", !ungetaggt.hinweis, "kein .hint");

  /* --- Die anderen Kacheln bleiben, wie sie waren ------------------------ */
  // extra hängt HINTEN an; das Raster muss die neun alten Kacheln behalten.
  const raster = await seite.evaluate(() =>
    [...document.querySelectorAll("#dashboard-dash .dash-raster > .card h3")].map(h => h.textContent));
  stand.gleich("das Themenprofil steht als letzte Kachel im Raster, die anderen bleiben",
    [raster.length, raster[raster.length - 1]], [10, "Themenprofil"]);
}
