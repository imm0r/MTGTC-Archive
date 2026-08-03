/* Die Auflage wird gewählt, nicht geraten.

   Die Panne, aus der dieser Fall entstand: Beim Import über ein Foto ist der
   Kartenname fast immer lesbar, der kleine Aufdruck unten links oft nicht —
   verdeckt, unscharf, im Schatten, oder die Karte ist so alt, dass sie gar
   keinen trägt. Ohne Setcode und Sammlernummer bleibt nur der Name, und der
   benennt die KARTE, nicht den Druck. Die App nahm dann stillschweigend die
   Auflage, die Scryfalls Namenssuche zufällig zuerst nannte. Bei einer Karte
   mit dreißig Drucken ist das in neunundzwanzig von dreißig Fällen die
   falsche — mit falschem Set, falschem Bild und vor allem falschem Wert.

   Nichts daran wurde je rot: Eine Karte WAR ja gefunden, sie stand in der
   Sammlung, sie hatte ein Bild. Auffallen konnte es nur dem, der die Karte in
   der Hand hielt und mit der Zeile verglich.

   Geprüft wird deshalb beides: dass bei unklarer Auflage gefragt wird (auch
   bei eingeschaltetem „Treffer sofort übernehmen" — was die Erkennung nicht
   gelesen hat, kann sie nicht bestätigen), und dass bei GELESENEM Eckcode
   weiterhin niemand gefragt wird. Eine Rückfrage, die immer kommt, ist
   genauso unbrauchbar wie eine, die nie kommt. */

export const name = "auflagenwahl";

/* Attrappe einer Scryfall-Antwort. Vier Auflagen derselben Karte, absteigend
   nach Erscheinen wie bei order=released&dir=desc. Die Preise gehen weit
   auseinander — genau darum geht es: Eine still gewählte Auflage schreibt
   nicht nur den falschen Setnamen, sondern auch den falschen Wert. */
const BILD = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const GROSS = "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const druck = (set, setName, cn, jahr, preis, rarity = "uncommon", extra = {}) => ({
  object: "card", id: `sf-${set}-${cn}`, oracle_id: "orc-solring",
  name: "Sol Ring", lang: "en", set, set_name: setName, collector_number: cn,
  released_at: `${jahr}-01-01`, rarity, type_line: "Artifact",
  // klein UND groß: Die Zeile nimmt das kleine, die Hover-Vorschau das große.
  // Verschiedene Daten-URIs, damit die Prüfung merkt, wenn die Vorschau das
  // Daumennagelbild zeigt — das wäre der ganze Sinn der Vorschau dahin.
  image_uris: { small: BILD, normal: GROSS }, prices: { eur: preis }, cardmarket_id: 42,
  artist: extra.artist || "Mike Bierek", frame: extra.frame || "2015",
  finishes: extra.finishes || ["nonfoil", "foil"],
  border_color: extra.border_color || "black",
  frame_effects: extra.frame_effects, full_art: extra.full_art,
});
// Preise mit PUNKT als Trennzeichen — so liefert Scryfall sie, und priceOf
// zieht sie durch parseFloat. Mit Komma käme aus "1,80" eine glatte 1.
const DRUCKE = [
  druck("blc", "Bloomburrow Commander", "230", 2024, "1.80"),
  druck("ltc", "Tales of Middle-earth Commander", "284", 2023, "2.40"),
  // Die Sonderauflage: randlos, Vollbild, Showcase, nur als Foil, eigener
  // Illustrator — an ihr hängen die Merkmalszeilen der Vorschau.
  druck("sld", "Secret Lair Drop", "1518", 2022, "38.00", "rare",
    { artist: "Anna Steinbauer", border_color: "borderless", full_art: true,
      frame_effects: ["showcase"], finishes: ["foil"] }),
  // Alter Rahmen: die einzige Auflage, bei der die Vorschau ihn nennen soll.
  druck("cmr", "Commander Legends", "472", 2020, "3.10", "uncommon", { frame: "1997" }),
];
// Was die Namenssuche geliefert hätte: irgendeine davon. Bewusst NICHT die
// erste der Liste — sonst bestünde die Prüfung auch, wenn weiter geraten wird.
const NAMENSTREFFER = DRUCKE[2];

export default async function ({ seite, adresse, stand }) {
  /* --- Scryfall abfangen ------------------------------------------------- */
  const gefragt = [];
  await seite.route("https://api.scryfall.com/**", route => {
    const url = route.request().url();
    gefragt.push(url);
    const liste = koerper =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(koerper) });
    if (url.includes("/cards/search"))
      return liste({ object: "list", total_cards: DRUCKE.length, has_more: false, data: DRUCKE });
    return route.fulfill({ status: 404, contentType: "application/json",
      body: JSON.stringify({ object: "error" }) });
  });

  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(() => {
    document.getElementById("gate").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-more"));
    // Oberflächensprache festnageln: Ohne das entscheidet die Spracheinstellung
    // des Prüfrechners, welchen Text die Kachel zeigt — auf dem Läufer
    // Englisch, hier Deutsch, und die Prüfung wäre je nach Maschine rot.
    if (typeof setLang === "function") setLang("de");
    // Englisch: Dann liefert inSprache die gewählte Auflage unverändert
    // zurück, und die Prüfung misst die Wahl, nicht das Nachladen.
    document.getElementById("d-lang").value = "en";
    // Ohne Datenbank kann nichts geschrieben werden — also abfangen und
    // festhalten, WAS geschrieben worden wäre. Genau das ist der Befund.
    window.GESCHRIEBEN = null;
    window.addToCollection = async (card) => {
      window.GESCHRIEBEN = { set: card.set, cn: card.collector_number, name: card.set_name };
      return "zeile-1";
    };
  });

  /* --- Die Liste erscheint und ist vollständig ---------------------------- */
  await seite.evaluate(async (t) => {
    window.KACHEL = (() => {
      const el = document.createElement("div");
      el.className = "job";
      el.innerHTML = `<img class="thumb" src="" alt="">
        <div class="body"><div class="title">…</div>
        <div class="meta" data-step>…</div>
        <div class="bar"><i style="width:35%"></i></div></div>`;
      document.getElementById("queue").appendChild(el);
      return el;
    })();
    await renderAuflagen(window.KACHEL, t, null);
  }, NAMENSTREFFER);

  const liste = seite.locator(".job [data-liste]");
  stand.gleich("alle Auflagen stehen zur Wahl",
    await liste.locator("[data-druck]").count(), DRUCKE.length);

  stand.ist("Scryfall wurde nach den Drucken EINER Karte gefragt (oracle_id, unique=prints)",
    gefragt.some(u => u.includes("unique=prints") && u.includes("oracleid")),
    gefragt.join(" | ").slice(0, 200));

  const beschriftung = await liste.locator("[data-druck]").first().innerText();
  stand.ist("jede Zeile nennt Set, Nummer, Jahr und Preis",
    /Bloomburrow/.test(beschriftung) && /#230/.test(beschriftung) &&
    /BLC/.test(beschriftung) && /2024/.test(beschriftung) && /1,80/.test(beschriftung),
    beschriftung.replace(/\n/g, " · "));

  stand.ist("das Set-Zeichen steht in der Zeile",
    await liste.locator("[data-druck] b .ss").count() === DRUCKE.length,
    await liste.locator("[data-druck] b .ss").count() + " Zeichen");

  stand.gleich("die Auflage der Namenssuche ist markiert, aber nicht vorgewählt",
    await seite.evaluate(() => [...document.querySelectorAll("[data-druck][data-treffer]")]
      .map(b => b.dataset.druck)),
    ["2"]);

  stand.gleich("der Zähler nennt die Zahl der Auflagen",
    (await seite.locator(".job [data-zaehler]").innerText()).trim(), "4 Auflagen");

  /* --- Der Filter grenzt ein --------------------------------------------- */
  // „commander" steckt in drei der vier Setnamen — der Filter sucht im ganzen
  // Namen, nicht nur am Anfang, und genau das soll er.
  await seite.locator(".job [data-filter]").fill("commander");
  stand.gleich("der Filter zeigt nur noch die passenden Auflagen",
    await seite.evaluate(() => [...document.querySelectorAll("[data-druck]")]
      .filter(b => !b.hidden).map(b => b.querySelector("b").textContent.trim())),
    ["Bloomburrow Commander", "Tales of Middle-earth Commander", "Commander Legends"]);
  stand.gleich("der Zähler zählt mit", (await seite.locator(".job [data-zaehler]").innerText()).trim(),
    "3 Auflagen");

  await seite.locator(".job [data-filter]").fill("middle-earth");
  stand.gleich("auch mehrteilige Wörter und Bindestriche finden ihre Auflage",
    await seite.evaluate(() => [...document.querySelectorAll("[data-druck]")]
      .filter(b => !b.hidden).map(b => b.querySelector("b").textContent.trim())),
    ["Tales of Middle-earth Commander"]);

  await seite.locator(".job [data-filter]").fill("sld");
  stand.gleich("auch der Setcode filtert — und die Einzahl stimmt",
    [await seite.evaluate(() => [...document.querySelectorAll("[data-druck]")].filter(b => !b.hidden).length),
     (await seite.locator(".job [data-zaehler]").innerText()).trim()],
    [1, "1 Auflage"]);

  await seite.locator(".job [data-filter]").fill("2020");
  stand.gleich("und das Jahr",
    await seite.evaluate(() => [...document.querySelectorAll("[data-druck]")]
      .filter(b => !b.hidden).map(b => b.querySelector("b").textContent.trim())),
    ["Commander Legends"]);

  await seite.locator(".job [data-filter]").fill("");

  /* --- Hover: die ganze Karte, groß, mit dem was die Auflagen trennt ------ */
  /* Die Zeile ist schmal und ihr Bild daumennagelgroß — dass zwei Auflagen
     verschiedene Illustrationen tragen, sieht man darin nicht. Beim Überfahren
     schwebt deshalb die große Karte daneben, samt der Angaben, die tatsächlich
     auseinandergehen. Regeltext und Manakosten gehören NICHT dazu: Die sind bei
     allen Auflagen derselben Karte gleich und beantworten die Frage nicht. */
  await seite.locator('.job [data-druck="2"]').hover();
  await seite.waitForTimeout(200);
  const vorschau = await seite.evaluate(() => {
    const el = document.querySelector(".cmd-hover");
    if (!el || el.style.display === "none") return null;
    return { bild: el.querySelector("img")?.getAttribute("src") || "",
             name: el.querySelector(".cmd-hover-nm")?.textContent.trim() || "",
             zeilen: [...el.querySelectorAll(".cmd-hover-zus")].map(z => z.textContent.trim()) };
  });
  stand.ist("beim Überfahren erscheint die Vorschau", !!vorschau);
  if (vorschau) {
    stand.ist("sie zeigt das GROSSE Bild, nicht den Daumennagel",
      vorschau.bild.startsWith("data:image/gif") && vorschau.bild !== BILD, vorschau.bild.slice(0, 40));
    stand.gleich("mit Name und den Angaben, die die Auflagen trennen",
      [vorschau.name, ...vorschau.zeilen],
      ["Sol Ring", "Secret Lair Drop · #1518 · 2022", "Rare",
       "Illustration: Anna Steinbauer", "Randlos · Vollbild · Showcase",
       "Ausführungen: Foil", "38,00 €"]);
  }

  // Der heutige Rahmen (2015) steht auf fast jeder Karte — ihn zu nennen wäre
  // Füllung. Ein alter ist eine Auskunft und gehört hin.
  await seite.locator('.job [data-druck="3"]').hover();
  await seite.waitForTimeout(200);
  stand.gleich("ein ALTER Rahmen wird genannt, der heutige nicht",
    await seite.evaluate(() => [...document.querySelectorAll(".cmd-hover-zus")]
      .map(z => z.textContent.trim()).filter(z => /Rahmen|Uncommon|Rare/.test(z))),
    ["Uncommon · Rahmen 1997"]);
  await seite.locator('.job [data-druck="0"]').hover();
  await seite.waitForTimeout(200);
  stand.gleich("beim heutigen Rahmen bleibt nur die Seltenheit stehen",
    await seite.evaluate(() => [...document.querySelectorAll(".cmd-hover-zus")]
      .map(z => z.textContent.trim()).filter(z => /Rahmen|Uncommon|Rare/.test(z))),
    ["Uncommon"]);

  // Nach dem Verlassen darf nichts stehenbleiben — die Vorschau hängt am body
  // und würde sonst über der halben Seite kleben.
  await seite.locator(".job [data-filter]").hover();
  await seite.waitForTimeout(200);
  stand.ist("beim Verlassen verschwindet sie wieder",
    await seite.evaluate(() => document.querySelector(".cmd-hover")?.style.display === "none"));

  /* --- Die Wahl geht in die Bestätigung, mit der GEWÄHLTEN Auflage -------- */
  // Bewusst die letzte Zeile: Sie ist weder der Namenstreffer noch die erste
  // der Liste. Landet sie in der Bestätigung, ist tatsächlich die Wahl
  // maßgeblich und nicht irgendeine Voreinstellung.
  await seite.locator('.job [data-druck="3"]').click();
  await seite.waitForTimeout(200);
  const info = (await seite.locator(".job .c-info").innerText()).replace(/\n/g, " · ");
  stand.ist("bestätigt wird die gewählte Auflage",
    /Commander Legends/.test(info) && /#472/.test(info), info);
  stand.ist("nicht die der Namenssuche", !/Secret Lair/.test(info), info);
  stand.gleich("und geschrieben wurde dabei noch nichts",
    await seite.evaluate(() => window.GESCHRIEBEN), null);

  /* --- Nur EINE Auflage: keine Rückfrage ---------------------------------- */
  await seite.unroute("https://api.scryfall.com/**");
  await seite.route("https://api.scryfall.com/**", route =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ object: "list", total_cards: 1, has_more: false, data: [DRUCKE[0]] }) }));

  await seite.evaluate(async (t) => {
    const el = document.createElement("div");
    el.className = "job einzeln";
    el.innerHTML = `<img class="thumb" src="" alt="">
      <div class="body"><div class="title">…</div><div class="meta" data-step>…</div></div>`;
    document.getElementById("queue").appendChild(el);
    await renderAuflagen(el, t, null);
  }, DRUCKE[0]);
  stand.gleich("gibt es nur eine Auflage, wird nicht gefragt",
    await seite.evaluate(() => ({
      liste: !!document.querySelector(".job.einzeln [data-liste]"),
      bestaetigung: !!document.querySelector(".job.einzeln .confirm") })),
    { liste: false, bestaetigung: true });

  /* --- Der Weg dorthin: scanBild fragt genau dann, wenn die Ecke fehlte --- */
  await seite.unroute("https://api.scryfall.com/**");
  await seite.route("https://api.scryfall.com/**", route =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ object: "list", total_cards: DRUCKE.length, has_more: false, data: DRUCKE }) }));

  // „Treffer sofort übernehmen" AN. Genau hier lag der teuerste Fall: Wer der
  // Erkennung vertraut, bekam die geratene Auflage ohne jede Rückfrage.
  await seite.evaluate(() => {
    localStorage.setItem("mtg-scan-auto", "1");
    document.getElementById("queue").innerHTML = "";
    window.GESCHRIEBEN = null;
  });

  await seite.evaluate(async (t) => {
    window.identify = async () => ({ card: t, guess: "Sol Ring", candidates: [], genau: false });
    await scanBild({ width: 100, height: 140 }, "", "en", document.getElementById("queue"));
  }, NAMENSTREFFER);
  stand.gleich("ohne gelesenen Eckcode wird gefragt — auch bei „sofort übernehmen“",
    await seite.evaluate(() => ({
      liste: !!document.querySelector("#queue [data-liste]"),
      geschrieben: window.GESCHRIEBEN })),
    { liste: true, geschrieben: null });

  await seite.evaluate(() => { document.getElementById("queue").innerHTML = ""; });
  await seite.evaluate(async (t) => {
    window.identify = async () => ({ card: t, guess: "Sol Ring", candidates: [], genau: true });
    await scanBild({ width: 100, height: 140 }, "", "en", document.getElementById("queue"));
  }, NAMENSTREFFER);
  stand.gleich("mit gelesenem Eckcode steht die Auflage fest und wird sofort geschrieben",
    await seite.evaluate(() => ({
      liste: !!document.querySelector("#queue [data-liste]"),
      geschrieben: window.GESCHRIEBEN })),
    { liste: false, geschrieben: { set: "sld", cn: "1518", name: "Secret Lair Drop" } });

  /* --- Viele Auflagen: geblättert wird, aber nicht endlos ----------------- */
  /* Eine Seite fasst bei Scryfall 175 Einträge. Ein Sol Ring passt hinein (137
     gemessen), ein Wald nicht — 946 Auflagen. Ohne Blättern zeigte die Liste
     die ersten 175 und behauptete, das seien alle; die gesuchte Auflage konnte
     schlicht fehlen. Geblättert wird deshalb bis zu sechs Seiten weit — und
     wenn danach noch etwas fehlt, sagt der Zähler das, statt eine gedeckelte
     Liste als die ganze auszugeben.

     Hier mit kleinen Zahlen nachgestellt: 30 Auflagen, 4 je Seite. Sechs
     Seiten ergeben 24 — der Deckel greift, und die Prüfung sieht beides. */
  const VIELE = Array.from({ length: 30 }, (_, i) =>
    druck(`s${i}`, `Erfundenes Set ${i}`, String(100 + i), 2000 + i, "1.00"));
  const seitenAbrufe = [];
  await seite.unroute("https://api.scryfall.com/**");
  await seite.route("https://api.scryfall.com/**", route => {
    const url = new URL(route.request().url());
    const nr = Number(url.searchParams.get("page") || 1);
    seitenAbrufe.push(nr);
    const teil = VIELE.slice((nr - 1) * 4, nr * 4);
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ object: "list", total_cards: VIELE.length,
        has_more: nr * 4 < VIELE.length, data: teil }) });
  });

  await seite.evaluate(() => { document.getElementById("queue").innerHTML = ""; });
  await seite.evaluate(async (t) => {
    const el = document.createElement("div");
    el.className = "job viele";
    el.innerHTML = `<img class="thumb" src="" alt="">
      <div class="body"><div class="title">…</div><div class="meta" data-step>…</div></div>`;
    document.getElementById("queue").appendChild(el);
    await renderAuflagen(el, t, null);
  }, VIELE[0]);

  stand.gleich("geblättert wird bis zum Deckel — sechs Seiten, nicht mehr",
    seitenAbrufe, [1, 2, 3, 4, 5, 6]);
  stand.gleich("und alle geladenen Auflagen stehen in der Liste",
    await seite.evaluate(() => document.querySelectorAll(".job.viele [data-druck]").length), 24);
  stand.gleich("der Zähler verschweigt nicht, dass welche fehlen",
    (await seite.locator(".job.viele [data-zaehler]").innerText()).trim(),
    "24 von 30 Auflagen — für den Rest den Setcode eintippen.");
}
