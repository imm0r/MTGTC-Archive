/* Ein übernommenes Deck darf erst öffentlich werden, wenn es auch ein eigenes
   geworden ist.

   ANLASS. Übernehmen ist ein Klick. Ohne Sperre entstünde aus einem beliebten
   Deck in kurzer Zeit ein Dutzend Kopien in der Community-Liste — dieselbe
   Kartenliste unter zwölf Namen, und die Rangliste wäre eine Liste desselben
   Decks.

   Vier Dinge daran gehen still daneben, und keines davon sieht wie ein Fehler
   aus:

   * OHNE SCHNAPPSCHUSS KEINE SPERRE. Trägt die Übernahme `import_baseline`
     nicht ein, ist jedes übernommene Deck von der Prüfung AUSGENOMMEN — der
     Trigger läuft, findet NULL und lässt durch. Es gäbe keinen Fehler,
     nirgends; die Sperre wäre einfach wirkungslos.
   * DIE VEREINIGUNG DER SCHLÜSSEL. Wer nur über die Karten von HEUTE läuft,
     zählt das Entfernte nicht mit; wer nur über die von DAMALS läuft, das
     Hinzugefügte nicht. Ein komplett ausgetauschtes Deck käme dann auf null
     Abweichung und bliebe für immer gesperrt (oder, andersherum, wäre sofort
     frei).
   * DIE AUFLAGE IST KEINE ÄNDERUNG. Dieselbe Karte in einer schöneren
     Ausgabe ist ein Kauf, kein Deckbau. Zählte die Auflage, ließe sich die
     Sperre umgehen, ohne eine einzige Karte auszutauschen.
   * NUR DER ÜBERGANG WIRD GEPRÜFT. Privat stellen muss immer gehen, sonst
     säße man in einem versehentlich gezeigten Deck fest.

   Die Zahlen stehen an ZWEI Stellen — im Trigger (maßgeblich) und in app.js
   (damit die Anzeige sagen kann, wie viel noch fehlt). Beide werden hier
   gegen dieselbe Tabelle gemessen; laufen sie auseinander, fällt es auf. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "uebernommen";

const MIGRATION = "supabase/migrations/20260803140000_uebernommen_sperre.sql";

/* Ein übernommenes Deck bauen: 10 Karten, Schnappschuss = Ausgangszustand.
   Schwelle also max(4, ceil(10/10)) = 4. */
const ATTRAPPE = () => {
  USER = { id: "u0", email: "ich@example.invalid" };
  CARDS = []; DECKS = [];
  const mk = (id, oracle, name, qty) =>
    ({ id, oracle_id: oracle, name, disp: name, set: "one", set_code: "one",
       cn: id, qty, price: 1, img: "", type_line: "Artifact", oracle_text: "" });
  // Vier verschiedene Karten, zusammen zehn Exemplare.
  CARDS.push(mk("c1", "o-1", "Alpha", 9), mk("c2", "o-2", "Beta", 9),
             mk("c3", "o-3", "Gamma", 9), mk("c4", "o-4", "Delta", 9));
  // Dieselbe Oracle-Identität wie c1, andere Auflage — der Umstieg darauf
  // darf NICHT als Änderung zählen.
  CARDS.push({ ...mk("c1b", "o-1", "Alpha", 9), set: "lea", set_code: "lea", cn: "999" });
  // Eine Karte ohne oracle_id: dann tritt der kleingesetzte Name an ihre Stelle.
  CARDS.push({ ...mk("c5", null, "Epsilon", 9) });

  const basis = { "o-1": 4, "o-2": 3, "o-3": 2, "o-4": 1 };   // zusammen 10
  DECKS.push({
    id: "d-kopie", name: "Übernommenes Deck", format: "Modern", kategorien: [],
    is_public: false, shared: false,
    imported_from: "d-quelle", import_baseline: basis,
    entries: [{ cardId: "c1", qty: 4, kats: [] }, { cardId: "c2", qty: 3, kats: [] },
              { cardId: "c3", qty: 2, kats: [] }, { cardId: "c4", qty: 1, kats: [] }],
  });
  DECKS.push({
    id: "d-eigen", name: "Eigenes Deck", format: "Modern", kategorien: [],
    is_public: false, shared: false, imported_from: null, import_baseline: null,
    entries: [{ cardId: "c1", qty: 4, kats: [] }],
  });

  window.GESCHRIEBEN = []; window.TOASTS = [];
  sb = { from: () => ({ update: (patch) => ({ eq: async (_s, id) => {
    window.GESCHRIEBEN.push({ id, patch }); return { error: null }; } }) }) };
  toast = (txt) => { window.TOASTS.push(txt); };

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-decks"));
  renderDecks();
};

/* Die Entscheidungstabelle. Jede Zeile ändert das übernommene Deck und sagt,
   welche Abweichung dabei herauskommen MUSS. Sie ist der Kern des Falls:
   Steht sie, steht die Regel. */
const FAELLE = [
  { was: "unverändert", entries: [["c1", 4], ["c2", 3], ["c3", 2], ["c4", 1]], soll: 0 },
  { was: "eine Karte weniger", entries: [["c1", 3], ["c2", 3], ["c3", 2], ["c4", 1]], soll: 1 },
  { was: "eine Karte mehr", entries: [["c1", 5], ["c2", 3], ["c3", 2], ["c4", 1]], soll: 1 },
  { was: "eine ganz herausgenommen", entries: [["c1", 4], ["c2", 3], ["c3", 2]], soll: 1 },
  { was: "zwei getauscht (raus und rein zählt doppelt)",
    entries: [["c1", 2], ["c2", 3], ["c3", 2], ["c4", 1], ["c5", 2]], soll: 4 },
  { was: "komplett ausgetauscht", entries: [["c5", 10]], soll: 20 },
  { was: "andere AUFLAGE derselben Karte — keine Änderung",
    entries: [["c1b", 4], ["c2", 3], ["c3", 2], ["c4", 1]], soll: 0 },
  { was: "halb auf die andere Auflage — immer noch keine",
    entries: [["c1", 2], ["c1b", 2], ["c2", 3], ["c3", 2], ["c4", 1]], soll: 0 },
];

export default async function ({ seite, adresse, stand, wurzel }) {
  /* --- Die Migration -------------------------------------------------- */
  const datei = await readFile(join(wurzel, MIGRATION), "utf8");
  /* Erst ab der ersten ausführbaren Anweisung: Der Kopfkommentar erklärt die
     Migration und zitiert sie dabei — sonst fände die Suche ihre eigene
     Beschreibung und jede Sabotage bliebe grün. */
  const sql = datei.slice(datei.indexOf("alter table public.decks add column if not exists imported_from"));

  stand.ist("es gibt eine Spalte für den Schnappschuss",
    /add column if not exists import_baseline jsonb/.test(sql));
  stand.ist("und eine für die Herkunft",
    /add column if not exists imported_from uuid/.test(sql));
  /* Der Fall, den kein Fehler meldet: Ohne diesen Eintrag greift die Sperre
     nie, und nichts sähe ungewöhnlich aus. */
  stand.ist("die Übernahme trägt Herkunft UND Schnappschuss ein",
    /insert into public\.decks \([\s\S]{0,180}?imported_from, import_baseline\)/.test(sql)
    && /p_deck, public\.deck_stand\(p_deck\)\)/.test(sql));
  stand.ist("und nimmt den Schnappschuss von der QUELLE, nicht von der Kopie",
    /public\.deck_stand\(p_deck\)/.test(sql) && !/public\.deck_stand\(newid\)/.test(sql));

  stand.ist("gezählt wird über die Oracle-Identität, nicht die Auflage",
    /coalesce\(c\.oracle_id::text, lower\(c\.name\)\)/.test(sql));
  stand.ist("die Abweichung läuft über die VEREINIGUNG beider Schlüsselmengen",
    /jsonb_object_keys\(b\)[\s\S]{0,60}union[\s\S]{0,60}jsonb_object_keys\(j\)/.test(sql));
  stand.ist("die Schwelle ist ein Zehntel, mindestens aber vier",
    /greatest\(4, ceil\([\s\S]{0,120}?\/ 10\.0\)::int\)/.test(sql));

  stand.ist("ein Deck ohne Schnappschuss darf immer",
    /when \(select import_baseline from public\.decks where id = d\) is null then true/.test(sql));
  stand.ist("der Trigger hängt am UPDATE von is_public",
    /before update of is_public on public\.decks/.test(sql));
  stand.ist("und greift NUR beim Übergang nach öffentlich",
    /new\.is_public and not coalesce\(old\.is_public, false\)/.test(sql));
  stand.ist("die Hilfsfunktionen sind nicht frei aufrufbar",
    ["deck_stand", "deck_abweichung", "deck_darf_oeffentlich"].every(f =>
      new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(sql)));

  /* --- Die Rechnung --------------------------------------------------- */
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 2, kategorien: 1, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(ATTRAPPE);
  await seite.waitForTimeout(300);

  stand.gleich("die Schwelle wächst mit dem Deck und hat eine Untergrenze",
    await seite.evaluate(() => [
      deckSchwelle({ a: 100 }), deckSchwelle({ a: 60 }), deckSchwelle({ a: 40 }),
      deckSchwelle({ a: 10 }), deckSchwelle({ a: 1 }), deckSchwelle(null),
    ]), [10, 6, 4, 4, 4, 4]);

  const gemessen = await seite.evaluate((faelle) => faelle.map(f => {
    const d = DECKS.find(x => x.id === "d-kopie");
    d.entries = f.entries.map(([cardId, qty]) => ({ cardId, qty, kats: [] }));
    return { was: f.was, ist: deckAbweichung(d), fehlt: deckNochAendern(d) };
  }), FAELLE);
  for (let i = 0; i < FAELLE.length; i++) {
    stand.gleich(`Abweichung: ${FAELLE[i].was}`, gemessen[i].ist, FAELLE[i].soll);
  }
  stand.gleich("und daraus, was noch fehlt (Schwelle 4)",
    gemessen.map(g => g.fehlt), FAELLE.map(f => Math.max(0, 4 - f.soll)));

  stand.gleich("ein selbst angelegtes Deck muss gar nichts ändern",
    await seite.evaluate(() => deckNochAendern(DECKS.find(x => x.id === "d-eigen"))), 0);

  /* --- Der Knopf ------------------------------------------------------ */
  await seite.evaluate(() => {
    const d = DECKS.find(x => x.id === "d-kopie");
    d.entries = [{ cardId: "c1", qty: 4, kats: [] }, { cardId: "c2", qty: 3, kats: [] },
                 { cardId: "c3", qty: 2, kats: [] }, { cardId: "c4", qty: 1, kats: [] }];
    renderDecks();
  });
  await seite.waitForTimeout(250);
  const gesperrt = await seite.evaluate(() => {
    const b = document.querySelector('[data-public="d-kopie"]');
    const eigen = document.querySelector('[data-public="d-eigen"]');
    return { aus: b?.disabled, titel: b?.title || "",
             eigenAus: eigen?.disabled,
             hinweis: document.querySelector(".deck-uebernommen")?.textContent || "" };
  });
  stand.ist("am übernommenen Deck ist der Öffentlich-Knopf gesperrt", gesperrt.aus);
  stand.ist("und sagt im Titel, wie viel fehlt", /4/.test(gesperrt.titel), gesperrt.titel);
  stand.ist("die Deckzeile sagt es auch", /noch 4/.test(gesperrt.hinweis), gesperrt.hinweis);
  stand.ist("am eigenen Deck ist er offen", gesperrt.eigenAus === false);

  /* Auch ohne den Knopf: Der Weg selbst muss abweisen — ein gesperrter Knopf
     ist eine Anzeige, keine Sperre. */
  await seite.evaluate(() => publicDeck("d-kopie"));
  await seite.waitForTimeout(250);
  stand.gleich("der Weg schreibt nichts, wenn noch zu wenig geändert ist",
    await seite.evaluate(() => window.GESCHRIEBEN), []);
  stand.ist("und sagt, woran es liegt",
    await seite.evaluate(() => /4/.test((window.TOASTS[0] || ""))),
    await seite.evaluate(() => window.TOASTS[0]));

  /* --- Genug geändert ------------------------------------------------- */
  await seite.evaluate(() => {
    const d = DECKS.find(x => x.id === "d-kopie");
    // Zwei Tausche: c1 von 4 auf 2, dafür zwei Epsilon dazu → Abweichung 4.
    d.entries = [{ cardId: "c1", qty: 2, kats: [] }, { cardId: "c2", qty: 3, kats: [] },
                 { cardId: "c3", qty: 2, kats: [] }, { cardId: "c4", qty: 1, kats: [] },
                 { cardId: "c5", qty: 2, kats: [] }];
    renderDecks();
  });
  await seite.waitForTimeout(250);
  stand.ist("nach zwei Tauschen ist der Knopf offen",
    await seite.evaluate(() => document.querySelector('[data-public="d-kopie"]')?.disabled === false));
  stand.ist("und der Hinweis in der Deckzeile ist weg",
    await seite.evaluate(() => !document.querySelector(".deck-uebernommen")));
  await seite.evaluate(() => { window.GESCHRIEBEN = []; publicDeck("d-kopie"); });
  await seite.waitForTimeout(250);
  stand.gleich("jetzt schreibt der Weg auch",
    await seite.evaluate(() => window.GESCHRIEBEN), [{ id: "d-kopie", patch: { is_public: true } }]);

  /* --- Zurücknehmen geht immer ---------------------------------------- */
  /* Sonst säße fest, wer ein übernommenes Deck versehentlich gezeigt hat —
     und genau dieser Weg zurück ist der Grund, warum die Sperre überhaupt
     zumutbar ist. */
  await seite.evaluate(() => {
    const d = DECKS.find(x => x.id === "d-kopie");
    d.is_public = true;
    d.entries = [{ cardId: "c1", qty: 4, kats: [] }, { cardId: "c2", qty: 3, kats: [] },
                 { cardId: "c3", qty: 2, kats: [] }, { cardId: "c4", qty: 1, kats: [] }];
    window.GESCHRIEBEN = [];
    renderDecks();
  });
  await seite.waitForTimeout(250);
  await seite.evaluate(() => publicDeck("d-kopie"));
  await seite.waitForTimeout(250);
  stand.gleich("privat stellen darf man immer, auch unter der Schwelle",
    await seite.evaluate(() => window.GESCHRIEBEN), [{ id: "d-kopie", patch: { is_public: false } }]);
}
