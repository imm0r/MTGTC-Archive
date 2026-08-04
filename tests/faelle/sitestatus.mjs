/* Site Status: was ein Klick auf „Aktualisieren" kostet — und was er anrichtet,
   wenn das Kontingent alle ist.

   ANLASS. Gemeldet als „ich kann nicht mehr auf Aktualisieren klicken". Der
   Knopf ging, aber nach ein paar Klicks stand statt Graph, Tagesbalken und
   Störungsliste nur noch „das Stundenkontingent der GitHub-API ist erschöpft".

   Der Knopf hatte sich selbst kaputtgeladen. Ein voller Abruf kostete SECHS
   Anfragen an die GitHub-API — einmal die Störungen, je Dienst einmal den
   Commit-Verlauf. Unangemeldet sind 60 je Stunde und IP erlaubt: nach zehn
   Klicks war Schluss. Und im Fehlerfall wurde der Verlauf GELEERT, sodass der
   Klick Daten wegnahm, die vorher dastanden.

   Drei Zusagen hält dieser Fall fest:

     1. EIN KLICK KOSTET IM REGELFALL NICHTS. Die Zusammenfassung kommt von
        raw.githubusercontent (kein Kontingent); der teure Teil wird nur geholt,
        wenn er fehlt oder älter als zehn Minuten ist.
     2. WAS DA WAR, BLEIBT DA. Scheitert der teure Teil, bleiben Verlauf und
        Störungen stehen — mit dem Hinweis, von wann sie sind.
     3. DER KNOPF KOMMT IMMER ZURÜCK. Auch wenn der Abruf weder gelingt noch
        scheitert. fetch hat von sich aus keine Zeitgrenze; freigegeben wurde
        vorher nur im catch, ein hängender Abruf sperrte den Knopf für immer.

   Gefälscht wird dafür fetch: Die echten Adressen brauchen Netz, ein
   Kontingent und ein fremdes Repository — und keines davon prüft, worum es
   hier geht, nämlich wie oft gefragt wird und was bei Absage passiert. */

export const name = "sitestatus";

const DIENSTE = [
  { name: "Arcanum Archive App", url: "https://imm0r.github.io/MTGTC-Archive/",
    slug: "arcanum-archive-app", status: "up", uptime: "100.00%", uptimeWeek: "100.00%",
    time: 110, timeWeek: 132, dailyMinutesDown: {} },
  { name: "Scryfall API", url: "https://api.scryfall.com/", slug: "scryfall-api",
    status: "up", uptime: "100.00%", uptimeWeek: "100.00%",
    time: 126, timeWeek: 126, dailyMinutesDown: {} },
];

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(() => {
    document.getElementById("gate").style.display = "none";
    document.getElementById("app").style.display = "block";
    if (typeof setLang === "function") setLang("de");
  });

  const erg = await seite.evaluate(async (dienste) => {
    const el = document.getElementById("v-status");
    el.classList.add("on");

    /* Die Attrappe zählt mit, wohin gefragt wird, und kann die GitHub-API auf
       Kommando mit 403 plus Reset-Kopf ablehnen — genau so, wie GitHub es bei
       erschöpftem Kontingent tut. */
    const echt = window.fetch;
    let ruf = [], apiSperrt = false, apiHaengt = false;
    const reset = Math.floor((Date.now() + 42 * 60 * 1000) / 1000);
    window.fetch = (url) => {
      const u = String(url);
      ruf.push(u);
      if (u.includes("raw.githubusercontent"))
        return Promise.resolve(new Response(JSON.stringify(dienste), { status: 200 }));
      if (apiHaengt) return new Promise(() => {});          // kommt nie zurück
      if (apiSperrt)
        return Promise.resolve(new Response("{}", { status: 403,
          headers: { "x-ratelimit-reset": String(reset) } }));
      const leer = u.includes("/issues") ? [] : [];
      return Promise.resolve(new Response(JSON.stringify(leer), { status: 200 }));
    };
    const nurApi = () => ruf.filter(u => u.includes("api.github.com")).length;
    const zeichen = () => document.querySelector("#v-status .st-api-hinweis")?.textContent || "";

    // --- Erster Aufbau: der teure Teil wird geholt ------------------------
    ruf = [];
    await renderStatus();
    await new Promise(r => setTimeout(r, 60));
    const ersterAufbau = { api: nurApi(), knopf: !!document.getElementById("st-neu") };

    // --- Klick, während der Verlauf noch frisch ist: nichts kostet ---------
    ruf = [];
    document.getElementById("st-neu").click();
    await new Promise(r => setTimeout(r, 120));
    const zweiterKlick = { api: nurApi(), roh: ruf.filter(u => u.includes("raw.")).length };

    // --- Kontingent erschöpft, Verlauf künstlich veraltet ------------------
    STATUS_DATEN.apiStand = Date.now() - 30 * 60 * 1000;
    apiSperrt = true;
    ruf = [];
    document.getElementById("st-neu").click();
    await new Promise(r => setTimeout(r, 150));
    const beiSperre = {
      api: nurApi(),
      verlaufDa: Object.keys(STATUS_DATEN.verlauf || {}).length,
      apiOk: STATUS_DATEN.apiOk,
      sperreGesetzt: STATUS_DATEN.apiSperre > Date.now(),
      hinweis: zeichen(),
    };

    // --- Noch ein Klick: die Sperre verhindert weitere Anfragen ------------
    ruf = [];
    document.getElementById("st-neu").click();
    await new Promise(r => setTimeout(r, 120));
    const beiSperreNochmal = { api: nurApi() };

    // --- Ein Abruf, der hängt: der Knopf muss trotzdem zurückkommen --------
    apiSperrt = false; apiHaengt = true;
    STATUS_DATEN.apiStand = Date.now() - 30 * 60 * 1000;
    STATUS_DATEN.apiSperre = 0;
    const k = document.getElementById("st-neu");
    k.click();
    const sofort = k.disabled;
    // STATUS_GEDULD ist 12 s; hier reicht der Blick, dass die Zeitgrenze da ist.
    const geduld = STATUS_GEDULD;

    window.fetch = echt;
    return { ersterAufbau, zweiterKlick, beiSperre, beiSperreNochmal, sofort, geduld };
  }, DIENSTE);

  /* Beim ersten Aufbau MUSS der teure Teil geholt werden — sonst gäbe es nie
     einen Verlauf. Sechs Anfragen bei zwei Diensten: einmal Störungen, zweimal
     Commits. */
  stand.gleich("der erste Aufbau holt Störungen und Verlauf",
    [erg.ersterAufbau.api, erg.ersterAufbau.knopf], [3, true]);

  /* Der Kern der Meldung: Der Knopf lud sich selbst kaputt. */
  stand.gleich("ein Klick auf Aktualisieren kostet kein Kontingent",
    erg.zweiterKlick.api, 0);
  stand.ist("er frischt trotzdem auf — über die kontingentfreie Quelle",
    erg.zweiterKlick.roh >= 1, `${erg.zweiterKlick.roh} Abruf(e) an raw.githubusercontent`);

  /* Vorher wurde hier geleert: Der Klick nahm Daten weg, die dastanden. */
  stand.ist("bei erschöpftem Kontingent bleibt der Verlauf stehen",
    erg.beiSperre.verlaufDa > 0 && erg.beiSperre.apiOk,
    `${erg.beiSperre.verlaufDa} Dienste im Verlauf, apiOk=${erg.beiSperre.apiOk}`);
  stand.ist("und der Hinweis nennt beide Zeiten statt nur „erschöpft“",
    /\d\d[:.]\d\d/.test(erg.beiSperre.hinweis) &&
    (erg.beiSperre.hinweis.match(/\d\d[:.]\d\d/g) || []).length >= 2,
    erg.beiSperre.hinweis);

  // Die Sperrzeit aus dem Kopf der Absage wird gemerkt und respektiert —
  // sonst rennt jeder weitere Klick in dieselbe Wand.
  stand.ist("die Sperrzeit aus der Absage wird gemerkt",
    erg.beiSperre.sperreGesetzt);
  stand.gleich("und weitere Klicks fragen bis dahin gar nicht erst",
    erg.beiSperreNochmal.api, 0);

  /* Der Grund, aus dem der Knopf vorher dauerhaft gesperrt blieb. */
  stand.ist("ein hängender Abruf sperrt den Knopf nur vorübergehend",
    erg.sofort === true && erg.geduld > 0 && erg.geduld <= 30000,
    `gesperrt=${erg.sofort}, Zeitgrenze=${erg.geduld} ms`);
}
