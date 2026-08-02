/* Verlauf je Deck: Stände statt Ereignisse, und der Weg zurück.

   Der Verlauf wird nicht mitgeschrieben, sondern GERECHNET: Nach dem Laden
   entsteht aus dem Deck ein Stand, und nur wenn dessen Fingerabdruck sich
   geändert hat, gibt es einen neuen Eintrag. Was sich geändert hat, folgt aus
   dem Vergleich zweier Stände.

   Daran können vier Dinge still schiefgehen, und alle vier stehen hier:

   * Der FINGERABDRUCK muss von der Reihenfolge unabhängig sein. Gibt die
     Datenbank die Karten einmal anders sortiert zurück, entstünde sonst bei
     jedem Laden ein neuer Eintrag — der Verlauf liefe voll mit Ständen, in
     denen sich nichts geändert hat.
   * Er muss sich ändern, sobald sich etwas ändert. Sonst fehlt der Eintrag,
     und niemand merkt es: Es fehlt ja nur eine Zeile.
   * Der UNTERSCHIED zweier Stände ist der einzige Text, den der Nutzer liest.
     Steht dort das Falsche, springt jemand auf den falschen Stand zurück.
   * Der RÜCKSPRUNG muss Karten auslassen, die es nicht mehr gibt (der
     Fremdschlüssel zeigt in die Sammlung), Fächer über ihren NAMEN
     wiederfinden und die primäre Einordnung erhalten.

   Was hier NICHT geprüft werden kann, ist das Schreiben selbst — dafür bräuchte
   es eine Datenbank. Deshalb steht die Rechnung in ruecksprungPlan() für sich:
   Alles, was man falsch machen kann, ist dort und wird hier gemessen. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "verlauf";

/* Zwei Stände von Hand, dazwischen eine Handvoll Änderungen. Läuft IM BROWSER. */
const VORBEREITEN = () => {
  const d = DECKS[0];
  d.name = "Deck 0";
  d.kategorien = [{ id: "k1", name: "Ramp", pos: 0 }, { id: "k2", name: "Removal", pos: 1 }];
  d.entries = [
    { cardId: "d0c0", qty: 1, kats: [{ id: "k1", primaer: true }] },
    { cardId: "d0c1", qty: 2, kats: [] },
    { cardId: "d0c2", qty: 1, kats: [{ id: "k2", primaer: true }, { id: "k1", primaer: false }] },
  ];
  window.STAND_A = deckStand(d);

  // Jetzt umbauen: eine Karte raus, eine rein, eine Menge hoch, eine
  // umsortiert, das Deck umbenannt, ein Fach dazu.
  d.name = "Deck 0 v2";
  d.kategorien = [...d.kategorien, { id: "k3", name: "Karten ziehen", pos: 2 }];
  d.entries = [
    { cardId: "d0c1", qty: 3, kats: [] },
    { cardId: "d0c2", qty: 1, kats: [{ id: "k3", primaer: true }] },
    { cardId: "d0c3", qty: 1, kats: [] },
  ];
  window.STAND_B = deckStand(d);
  return { a: window.STAND_A, b: window.STAND_B };
};

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 6, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(VORBEREITEN);

  /* --- Der Stand: sortiert, vollständig, unabhängig von der Reihenfolge --- */
  const s = await seite.evaluate(() => {
    const d = DECKS[0];
    const a = deckStand(d);
    // Dieselben Daten, nur anders sortiert zurückgegeben — der Fingerabdruck
    // darf davon nicht abhängen.
    const gedreht = { ...d, entries: [...d.entries].reverse(),
                      kategorien: [...d.kategorien].reverse() };
    const b = deckStand(gedreht);
    // Und eine echte Änderung muss er sehen.
    const geaendert = { ...d, entries: d.entries.map((e, i) => i ? e : { ...e, qty: e.qty + 1 }) };
    return {
      gleich: fingerabdruck(JSON.stringify(a)) === fingerabdruck(JSON.stringify(b)),
      anders: fingerabdruck(JSON.stringify(a)) !== fingerabdruck(JSON.stringify(deckStand(geaendert))),
      // Die Fächer stehen über ihren NAMEN im Stand, nicht über ihre id.
      kats: a.kats,
      // Die primäre Einordnung trägt einen Stern.
      primaer: a.karten.find(k => k.id === "d0c2")?.kats,
      name: a.name,
    };
  });
  stand.ist("gleicher Stand, anders sortiert → gleicher Fingerabdruck", s.gleich);
  stand.ist("eine Mengenänderung → anderer Fingerabdruck", s.anders);
  stand.gleich("die Fächer stehen unter ihrem Namen im Stand", s.kats,
    ["Karten ziehen", "Ramp", "Removal"]);
  stand.gleich("und die primäre Einordnung trägt einen Stern", s.primaer, ["*Karten ziehen"]);

  /* --- Der Unterschied zweier Stände ------------------------------------ */
  const u = await seite.evaluate(() => ({
    erst: standUnterschied(null, window.STAND_A),
    umbau: standUnterschied(window.STAND_A, window.STAND_B),
    nichts: standUnterschied(window.STAND_A, window.STAND_A),
  }));
  stand.gleich("ohne Vorgänger ist es der Ausgangsstand", u.erst, ["Ausgangsstand"]);
  stand.ist("ein Umbau wird in Worten benannt", u.umbau.length >= 5, u.umbau.join(" · "));
  const hat = (w) => u.umbau.some(x => x.includes(w));
  stand.gleich("dazu, heraus, mehr, umsortiert, umbenannt, neues Fach",
    [hat("dazu"), hat("heraus"), hat("mehr"), hat("umsortiert"),
     hat("umbenannt"), hat("Fach")],
    [true, true, true, true, true, true]);
  // Zwei gleiche Stände kommen im Verlauf nicht vor (der Fingerabdruck
  // verhindert sie) — die Antwort darf trotzdem nicht leer sein.
  stand.ist("zwei gleiche Stände ergeben kein leeres Wort",
    u.nichts.length === 1 && u.nichts[0].length > 0, u.nichts.join("|"));

  /* --- Der Rücksprung: was geschrieben würde ---------------------------- */
  const p = await seite.evaluate(() => {
    const d = { id: "d0", name: "Jetzt", kategorien: [{ id: "k1", name: "Ramp" }] };
    const daten = {
      name: "Damals", format: "Commander", archetyp: "Aggro",
      haupt: "d0c0", zweit: "weg",
      kats: ["Ramp", "Removal"],
      karten: [
        { id: "d0c0", n: 1, kats: ["*Ramp"] },
        { id: "weg", n: 2, kats: ["*Removal"] },          // Karte gibt es nicht mehr
        { id: "d0c1", n: 0, kats: ["Removal", "*Ramp"] }, // Menge 0 wäre ungültig
      ],
    };
    const vorhanden = new Set(CARDS.map(c => c.id));
    const plan = ruecksprungPlan(d, daten, vorhanden);
    return {
      fehlend: plan.fehlend,
      karten: plan.karten,
      neueKats: plan.neueKats,
      zuord: plan.zuord,
      kopf: plan.kopf,
    };
  });
  stand.ist("Karten, die es nicht mehr gibt, werden gezählt und ausgelassen",
    p.fehlend === 1 && !p.karten.some(k => k.card_id === "weg"), JSON.stringify(p.karten));
  stand.gleich("die Mengen bleiben gültig (mindestens 1)",
    p.karten.map(k => k.qty), [1, 1]);
  stand.gleich("fehlende Fächer werden zum Anlegen gemeldet, vorhandene nicht",
    p.neueKats, ["Removal"]);
  stand.gleich("die Einordnungen tragen Fachnamen und Primär-Merkmal",
    p.zuord.filter(x => x.card_id === "d0c1"),
    [{ card_id: "d0c1", kat: "Removal", primaer: false },
     { card_id: "d0c1", kat: "Ramp", primaer: true }]);
  // Ein Commander, den es nicht mehr gibt, fällt weg — sonst schlüge der
  // Fremdschlüssel zu und der ganze Rücksprung liefe auf einen Fehler.
  stand.gleich("ein verschwundener Commander wird abgeräumt",
    [p.kopf.main_card_id, p.kopf.second_card_id], ["d0c0", null]);
  stand.gleich("Name und Einordnung kommen aus dem alten Stand",
    [p.kopf.name, p.kopf.format, p.kopf.archetype], ["Damals", "Commander", "Aggro"]);

  /* --- Die Anzeige ------------------------------------------------------ */
  /* Geladen wird über deckVerlaufLaden(); ohne Datenbank hängt hier eine
     Attrappe — dieselbe Aufteilung wie bei zoneSchreiben() und wurfSpeichern(). */
  await seite.evaluate(() => {
    window.deckVerlaufLaden = async () => ([
      { id: "e3", created: "2026-08-02T10:00:00Z", daten: window.STAND_B },
      { id: "e2", created: "2026-08-01T09:00:00Z", daten: window.STAND_A },
    ]);
    renderDecks();
  });
  await seite.waitForTimeout(200);

  stand.ist("jedes Deck trägt einen Verlaufsknopf",
    await seite.evaluate(() => document.querySelectorAll("[data-histbtn]").length === DECKS.length));
  stand.ist("und der Kasten ist zu",
    await seite.evaluate(() => document.querySelector("[data-histbox]").innerHTML === ""));

  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(300);
  const anzeige = await seite.evaluate(() => {
    const box = document.querySelector("[data-histbox]");
    const zeilen = [...box.querySelectorAll(".verlauf-zeile")];
    return {
      anzahl: zeilen.length,
      // Der jüngste Stand steht oben und ist der Bezugspunkt, kein Sprungziel.
      obenMarkiert: zeilen[0]?.classList.contains("jetzt"),
      obenOhneKnopf: !zeilen[0]?.querySelector("[data-histback]"),
      untenMitKnopf: !!zeilen[1]?.querySelector("[data-histback]"),
      // Jede Zeile sagt, was sich gegenüber der DARUNTER geändert hat.
      obenWas: zeilen[0]?.querySelector(".verlauf-was")?.textContent.trim(),
      untenWas: zeilen[1]?.querySelector(".verlauf-was")?.textContent.trim(),
      // Und wie groß das Deck damals war.
      zahlen: zeilen.map(z => z.querySelector(".verlauf-n")?.textContent.trim()),
      hinweis: !!box.querySelector(".verlauf-hinweis"),
    };
  });
  stand.gleich("ein Klick klappt den Verlauf auf", anzeige.anzahl, 2);
  stand.gleich("der jüngste Stand ist markiert und kein Sprungziel",
    [anzeige.obenMarkiert, anzeige.obenOhneKnopf], [true, true]);
  stand.ist("die älteren tragen einen Rücksprung-Knopf", anzeige.untenMitKnopf);
  stand.ist("die obere Zeile nennt den Umbau", /dazu|heraus/.test(anzeige.obenWas || ""),
    anzeige.obenWas);
  stand.gleich("die unterste ist der Ausgangsstand", anzeige.untenWas, "Ausgangsstand");
  stand.gleich("jede Zeile nennt die Deckgröße von damals", anzeige.zahlen,
    ["5 Karten", "4 Karten"]);
  stand.ist("und darunter steht, dass es rückwirkend keinen Verlauf gibt", anzeige.hinweis);

  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(200);
  stand.ist("ein zweiter Klick klappt ihn wieder zu",
    await seite.evaluate(() => document.querySelector("[data-histbox]").innerHTML === ""));

  /* Ein offener Verlauf überlebt das Neuzeichnen: Nach einem Rücksprung baut
     renderAll() die Kästen neu, und der eben benutzte stünde sonst leer da. */
  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(300);
  await seite.evaluate(() => renderDecks());
  await seite.waitForTimeout(400);
  stand.ist("und überlebt ein Neuzeichnen",
    await seite.evaluate(() => document.querySelectorAll("[data-histbox] .verlauf-zeile").length === 2));

  /* --- Der Kasten muss zu SEHEN sein ------------------------------------
     Gemeldet als „wenn ich auf Verlauf klicke passiert nichts": Der Kasten
     stand unter der Kartentabelle. Er füllte sich korrekt — nur eben bei einem
     großen Deck zweitausend Pixel weiter unten, außerhalb des Bildes. Geprüft
     wird deshalb mit einem Deck, das lang genug dafür ist. */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 60, kategorien: 3, decks: 1 });
  await seite.waitForTimeout(400);
  await seite.evaluate(() => {
    window.deckVerlaufLaden = async () => ([
      { id: "e1", created: "2026-08-02T10:00:00Z", daten: deckStand(DECKS[0]) },
    ]);
    renderDecks();
  });
  await seite.waitForTimeout(300);
  const lage = await seite.evaluate(() => {
    const box = document.querySelector("[data-histbox]");
    const karten = document.querySelector(".deck-tbl, .deck-stapel, .stapel-spalten, .deck-inhalt .xscroll");
    return {
      hoehe: document.querySelector(".deck-inhalt").getBoundingClientRect().height,
      vorKarten: !!karten &&
        !!(box.compareDocumentPosition(karten) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  stand.ist("das Deck ist lang genug für die Probe", lage.hoehe > 1200, Math.round(lage.hoehe) + " px hoch");
  stand.ist("der Verlaufskasten steht VOR den Karten, nicht darunter", lage.vorKarten);

  /* Und im schmalen Fenster reicht die Platzierung allein nicht: Dort bricht
     die Werkzeugleiste auf viele Zeilen um, und der Kasten liegt gemessen bei
     879 px — hinter dem unteren Rand eines 720 px hohen Fensters. Der Klick
     muss ihn also auch heranholen. */
  await seite.setViewportSize({ width: 420, height: 720 });
  await seite.waitForTimeout(400);
  const vorher = await seite.evaluate(() => {
    const r = document.querySelector("[data-histbox]").getBoundingClientRect();
    return { oben: Math.round(r.top), fenster: innerHeight };
  });
  stand.ist("im schmalen Fenster liegt er zunächst hinter dem unteren Rand",
    vorher.oben > vorher.fenster, `oben ${vorher.oben}, Fenster ${vorher.fenster}`);

  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(800);          // sanftes Scrollen abwarten
  stand.ist("nach dem Klick steht er im Bild",
    await seite.evaluate(() => {
      const r = document.querySelector("[data-histbox]").getBoundingClientRect();
      return r.height > 0 && r.top < innerHeight && r.bottom > 0;
    }),
    await seite.evaluate(() => {
      const r = document.querySelector("[data-histbox]").getBoundingClientRect();
      return `oben ${Math.round(r.top)}, Fenster ${innerHeight}`;
    }));
  await seite.setViewportSize({ width: 1400, height: 900 });
  await seite.waitForTimeout(300);

  /* --- Der Knopf sitzt im Deck-KOPF und wirkt auch am zugeklappten Deck ---
     Der Kasten liegt im Inhalt, und der ist am zugeklappten Deck
     display:none. Klappte der Knopf nicht selbst auf, sähe ein Klick aus, als
     geschähe nichts — genau die Meldung, die es hier schon einmal gab, damals
     wegen der Position des Kastens. */
  await seite.evaluate(() => {
    verlaufOffen.clear();
    window.deckVerlaufLaden = async () => ([
      { id: 1, at: new Date().toISOString(), size: 3, note: null, state: { e: [] } },
    ]);
    // Deck zuklappen und den Baum mitziehen — so, wie es der Kopf-Klick täte.
    if (deckOffen.ist(DECKS[0].id)) {
      deckOffen.schalte(DECKS[0].id);
      renderDecks();
    }
  });
  await seite.waitForTimeout(300);
  stand.ist("der Verlauf-Knopf steht im Deck-Kopf, nicht in der Werkzeugleiste",
    await seite.evaluate(() => !!document.querySelector(".deck-manage [data-histbtn]")
      && !document.querySelector(".deck-tools [data-histbtn]")));
  stand.ist("das Deck ist zugeklappt",
    await seite.evaluate(() => document.querySelector(".deck-inhalt").style.display === "none"));
  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(600);
  const auf = await seite.evaluate(() => {
    const box = document.querySelector("[data-histbox]");
    const r = box.getBoundingClientRect();
    return { inhalt: document.querySelector(".deck-inhalt").style.display,
             gefuellt: box.childElementCount > 0,
             sichtbar: r.height > 0 && r.top < innerHeight && r.bottom > 0,
             pfeil: document.querySelector(".deck-pfeil").textContent.trim() };
  });
  stand.ist("ein Klick klappt das Deck auf …", auf.inhalt === "block", auf.inhalt);
  stand.ist("… samt Pfeil im Kopf", auf.pfeil === "▼", auf.pfeil);
  stand.ist("… und der Verlauf steht gefüllt im Bild",
    auf.gefuellt && auf.sichtbar, JSON.stringify(auf));

  /* Zuklappen des VERLAUFS lässt das Deck offen — nur das Aufgehen klappt auf. */
  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(300);
  stand.ist("ein zweiter Klick schließt den Verlauf, nicht das Deck",
    await seite.evaluate(() => document.querySelector(".deck-inhalt").style.display === "block"
      && document.querySelector("[data-histbox]").childElementCount === 0));

  /* Und wenn die Datenbank die Tabelle nicht kennt, steht dort ein Satz, mit
     dem man etwas anfangen kann — nicht der rohe Fehler und schon gar nichts. */
  await seite.evaluate(() => {
    verlaufOffen.clear();
    window.deckVerlaufLaden = async () => {
      throw { code: "42P01", message: 'relation "public.deck_history" does not exist' };
    };
  });
  await seite.locator("[data-histbtn]").first().click();
  await seite.waitForTimeout(400);
  const fehlt = await seite.evaluate(() => document.querySelector("[data-histbox]").textContent.trim());
  stand.ist("fehlt die Tabelle, sagt der Kasten was zu tun ist",
    /deck_history/.test(fehlt) && /supabase-schema/.test(fehlt), fehlt);
}
