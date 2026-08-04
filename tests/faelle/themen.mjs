/* Themen-Index in der Oberfläche: Detailansicht und Sammlungsfilter.

   Die Daten liegen seit 20260803180000_themen_index.sql in der Datenbank
   (Scryfall Tagger, 4509 Themen). Diese Prüfung stellt sicher, dass die App
   sie richtig LIEST — und dass sie ohne sie nicht bricht:

   * Die Detailansicht zeigt die Themen einer Karte erst beim Aufklappen
     (dasselbe Muster wie die Legalität), direkt und geerbt getrennt.
   * Der Sammlungsfilter zeigt nur Karten, deren oracle_id im gewählten Thema
     steckt — und Karten OHNE oracle_id (Altbestand) fallen bei gesetztem
     Thema heraus, statt als „vielleicht" stehenzubleiben.
   * Fehlt der Index (Migration nicht eingespielt, Tabelle leer), bleibt die
     Themen-Gruppe versteckt und die Detailansicht sagt „keine Themen",
     statt dass irgendetwas wirft. Genau wie Deck-Verlauf und Kategorien:
     eine fehlende Tabelle hält den Rest der App nicht auf. */

import { AUFBAU } from "../hilfen.mjs";

export const name = "themen";

/* Attrappe der Datenbank-Seite: dieselben Formen, die tags_of_card,
   cards_with_tag und die tags-Tabelle liefern. */
const STUB = `
  sb = {
    rpc: async (fn, args) => {
      if (fn === "tag_groups_of_card") {
        if (args.p_oracle_id !== "orc-solring") return { data: [], error: null };
        /* Die drei Fälle, die es zu unterscheiden gilt — in der Reihenfolge,
           in der die Datenbank sie sortiert: ohne Oberbegriff zuerst.
           mana-rock haengt unter ZWEI Sammeltags; das ist kein Fehler,
           sondern kommt bei 684 der 4509 Tags vor. */
        return { data: [
          { wurzel: null, wurzel_label: null, slug: "full-refund", label: "full-refund",
            description: null, cards: 103, cards_total: 103 },
          { wurzel: "artifact", wurzel_label: "artifact", slug: "mana-rock", label: "mana-rock",
            description: "Artefakt, das Mana erzeugt.", cards: 109, cards_total: 240 },
          { wurzel: "ramp", wurzel_label: "ramp", slug: "mana-rock", label: "mana-rock",
            description: "Artefakt, das Mana erzeugt.", cards: 109, cards_total: 240 },
        ], error: null };
      }
      if (fn === "cards_with_tag") {
        if (args.p_slug !== "mana-rock") return { data: [], error: null };
        return { data: [ { oracle_id: "orc-solring" }, { oracle_id: "orc-anderswo" } ], error: null };
      }
      return { data: null, error: { message: "unbekannt: " + fn } };
    },
    from: (tabelle) => tabelle === "card_tags"
      // Direkte Tags je Karte, für themenFuerKarten. Absichtlich MIT Müll:
      // Was die Kuratierung aussieben muss, muss die Attrappe erst liefern.
      ? { select: () => ({ in: async (spalte, ids) => ({ error: null, data: [
          { oracle_id: "orc-solring", tag: "mana-rock" },
          { oracle_id: "orc-solring", tag: "ramp" },
          { oracle_id: "orc-solring", tag: "removal" },        // zu groß (4200)
          { oracle_id: "orc-solring", tag: "cycle-lea-moxen" },// Set-Zyklus
          { oracle_id: "orc-solring", tag: "alliteration" },   // Sperrliste
          { oracle_id: "orc-solring", tag: "winzling" },       // unter der Schwelle
          { oracle_id: "orc-fremd", tag: "ramp" },
        ].filter(r => ids.includes(r.oracle_id)) }) }) }
      : {
      // .order() sortiert WIRKLICH, wie PostgREST es täte — die App verlässt
      // sich auf die Reihenfolge aus der Datenbank, also muss die Attrappe
      // den Vertrag einhalten, nicht nur die Form.
      select: () => ({ gte: () => ({ order: async (spalte, opts) => {
        const rows = [
          { slug: "mana-rock", label: "mana-rock", description: "Artefakt, das Mana erzeugt.", cards: 109 },
          { slug: "removal", label: "removal", description: null, cards: 4200 },
          { slug: "ramp", label: "ramp", description: null, cards: 562 },
          { slug: "alliteration", label: "alliteration", description: null, cards: 800 },
          { slug: "cycle-lea-moxen", label: "cycle-lea-moxen", description: null, cards: 30 },
        ].sort((a, b) => (opts && opts.ascending ? 1 : -1) * (a[spalte] - b[spalte]));
        return { data: rows, error: null };
      } }) }),
    },
  };`;

export default async function ({ seite, adresse, stand }) {
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 4 });
  await seite.waitForTimeout(250);

  /* --- Ohne Index: nichts bricht, nichts erscheint ------------------------ */
  // sb ist in der Prüfumgebung null — jeder Zugriff wirft, jede Hilfsfunktion
  // muss das schlucken. Genau der Zustand „Migration nicht eingespielt".
  const ohne = await seite.evaluate(async () => ({
    themen: await themenVonKarte("orc-x"),
    vokabular: await themenVokabular(),
    gruppeVersteckt: document.getElementById("thema-gruppe").hidden,
  }));
  stand.gleich("ohne Datenbank: leere Themen, leeres Vokabular, Gruppe versteckt",
    [ohne.themen.length, ohne.vokabular.length, ohne.gruppeVersteckt], [0, 0, true]);

  /* --- Mit Daten: Detailansicht ------------------------------------------- */
  await seite.evaluate(STUB + `
    // Vokabular-Cache der ersten (leeren) Antwort verwerfen, sonst bliebe die
    // Gruppe trotz Stub leer — einmal je Sitzung ist im Betrieb richtig, im
    // Test steht die Sitzung für zwei Zustände.
    themenVokabularP = null;
    themenCache.clear(); themenKartenCache.clear();
  `);

  // Eine Kachel mit der Detail-Struktur direkt bauen: renderDetail hängt an
  // CARDS/DECKS samt Dialog; für die Themen zählt nur der details-Kasten.
  await seite.evaluate(async () => {
    const el = document.createElement("div");
    el.id = "themen-probe";
    el.innerHTML = `
      <details class="legal-det" id="dt-themen"><summary>Themen</summary>
        <div id="dt-themen-body">…</div>
      </details>`;
    document.body.appendChild(el);
    wireDetailThemen({ oracle_id: "orc-solring" });
    document.getElementById("dt-themen").open = true;
    document.getElementById("dt-themen").dispatchEvent(new Event("toggle"));
    await new Promise(r => setTimeout(r, 50));
  });

  /* Die Gruppierung ist der Kern des Umbaus: Der Sammeltag trägt die Zeile,
     darunter stehen die Tags, die ihn begründen. Vorher standen alle flach in
     zwei Reihen, und welcher geerbte aus welchem direkten folgte, musste man
     raten. */
  const gruppen = await seite.evaluate(() =>
    [...document.querySelectorAll("#dt-themen-body .thema-gruppe")].map(g => ({
      ober: g.querySelector(".thema-ober")?.textContent ?? null,
      tags: [...g.querySelectorAll(".thema-chip")].map(c => c.textContent.replace(/\d+$/, "")),
      zahlen: [...g.querySelectorAll(".thema-chip i")].map(i => i.textContent),
    })));
  /* Die Gruppe OHNE Oberbegriff steht ZULETZT und heißt „Unkategorisiert":
     Sie ist der Rest, nicht die Spitze — oben stehend (so kam es aus der
     Datenbank) las sie sich wie das Wichtigste, und ganz ohne Kopf sah die
     Zeile neben den beschrifteten aus wie ein Versehen. */
  stand.gleich("die Tags stehen unter ihrem Sammeltag, Unkategorisiert zuletzt",
    gruppen.map(g => [g.ober, g.tags.join(",")]),
    [["artifact", "mana-rock"], ["ramp", "mana-rock"], ["Unkategorisiert", "full-refund"]]);

  // Ein Tag mit zwei Wegen nach oben erscheint unter beiden. Keine Doppelung,
  // sondern zwei richtige Aussagen — 684 der 4509 Tags haben mehrere Eltern.
  stand.gleich("ein Tag mit zwei Sammeltags steht unter beiden",
    gruppen.filter(g => g.tags.includes("mana-rock")).map(g => g.ober), ["artifact", "ramp"]);

  /* Am Sammeltag steht KEINE Zahl. Seine direkte wäre 0 — der Tagger klebt
     Oberbegriffe nie an Karten — und läse sich als „trifft auf keine Karte
     zu", obwohl die Kategorie voll ist. */
  stand.ist("der Sammeltag trägt keine Zahl",
    await seite.evaluate(() =>
      ![...document.querySelectorAll("#dt-themen-body .thema-ober")].some(o => /\d/.test(o.textContent))),
    await seite.evaluate(() => [...document.querySelectorAll("#dt-themen-body .thema-ober")].map(o => o.textContent).join(" | ")));

  /* An den Tags steht die WIRKSAME Zahl, nicht die direkte. Nur die deckt sich
     mit dem, was ein Klick darauf liefert: Die Suche steigt die Hierarchie
     hinab. `mana-rock` hat 109 direkte Zuordnungen und 240 mit Unterbegriffen. */
  stand.gleich("die Zahl am Chip ist die wirksame, nicht die direkte",
    gruppen.flatMap(g => g.zahlen), ["240", "240", "103"]);

  /* Die Beschreibung hängt am Chip, nicht am Sammeltag — und nur dort, wo der
     Tagger eine führt (29 % der Tags). Geprüft wird deshalb gezielt der Chip
     MIT Beschreibung: Der erste in der Liste hat keine, und ein „title ist
     leer" wäre dort das richtige Ergebnis. */
  const titel = await seite.evaluate(() => {
    const chips = [...document.querySelectorAll("#dt-themen-body .thema-chip")];
    const mit = chips.find(c => c.textContent.startsWith("mana-rock"));
    const ohne = chips.find(c => c.textContent.startsWith("full-refund"));
    return { mit: mit?.title ?? null, ohne: ohne?.title ?? null };
  });
  stand.gleich("die Beschreibung hängt als title am Chip, und nur wo es eine gibt",
    titel, { mit: "Artefakt, das Mana erzeugt.", ohne: "" });

  // Karte ohne Themen: der Kasten sagt es, statt leer zu bleiben.
  const leerText = await seite.evaluate(async () => {
    document.getElementById("themen-probe").remove();
    const el = document.createElement("div");
    el.id = "themen-probe";
    el.innerHTML = `
      <details id="dt-themen"><summary>Themen</summary><div id="dt-themen-body">…</div></details>`;
    document.body.appendChild(el);
    wireDetailThemen({ oracle_id: "orc-unbekannt" });
    document.getElementById("dt-themen").open = true;
    document.getElementById("dt-themen").dispatchEvent(new Event("toggle"));
    await new Promise(r => setTimeout(r, 50));
    return document.querySelector("#dt-themen-body .empty")?.textContent || "";
  });
  stand.ist("Karte ohne Themen: der Kasten sagt es", leerText.length > 0, leerText);

  /* --- Mit Daten: Sammlungsfilter ------------------------------------------ */
  // Die Attrappen-Karten tragen keine oracle_id; zwei bekommen eine, eine
  // davon liegt im Thema. Erwartung: Thema gesetzt → genau diese eine bleibt.
  const filter = await seite.evaluate(async () => {
    CARDS[0].oracle_id = "orc-solring";     // im Thema
    CARDS[1].oracle_id = "orc-fremd";       // nicht im Thema
    // CARDS[2..3] ohne oracle_id — Altbestand
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-coll"));
    await themaFilterSetzen("mana-rock", "mana-rock");
    const zeilen = filtered("coll").map(c => c.id);
    const trigger = document.getElementById("thema-trigger-inner").textContent;
    await themaFilterSetzen("", "");
    return { zeilen, trigger, danach: filtered("coll").length };
  });
  stand.gleich("Thema gesetzt: nur die Karte im Thema bleibt (Altbestand ohne oracle_id fällt raus)",
    filter.zeilen, ["d0c0"]);
  stand.gleich("der Trigger zeigt das gewählte Thema", filter.trigger, "mana-rock");
  stand.gleich("Thema gelöscht: alle Karten zurück", filter.danach, 4);

  /* --- Dropdown: Vokabular, Suche, Deckel ---------------------------------- */
  const menu = await seite.evaluate(async () => {
    wireThemaFilter();
    await new Promise(r => setTimeout(r, 50));
    const gruppe = document.getElementById("thema-gruppe");
    document.getElementById("thema-trigger").click();
    await new Promise(r => setTimeout(r, 50));
    const alle = [...document.querySelectorAll("#thema-liste [data-thema]")].map(li => li.dataset.thema);
    document.getElementById("thema-suche").value = "rock";
    document.getElementById("thema-suche").dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 50));
    const gefiltert = [...document.querySelectorAll("#thema-liste [data-thema]")].map(li => li.dataset.thema);
    return { sichtbar: !gruppe.hidden, alle, gefiltert };
  });
  stand.ist("mit Daten erscheint die Filter-Gruppe", menu.sichtbar);
  stand.gleich("das Menü führt „Alle“ und die Themen nach Größe",
    menu.alle, ["", "removal", "alliteration", "ramp", "mana-rock", "cycle-lea-moxen"]);
  stand.gleich("die Suche grenzt ein (Alle bleibt stehen)",
    menu.gefiltert, ["", "mana-rock"]);

  /* --- Themen als Synergie-Haken ------------------------------------------- */
  /* Die Synergie-Suche zieht ihre Themen-Haken aus denselben Tags. Kuratiert:
     Set-Zyklen, Sperrlisten-Themen, zu große (sagen nichts) und zu kleine
     (geben keine Auswahl her) fliegen raus. Fällt der Index aus, raten die
     alten Regexe weiter — die Suche verstummt nicht. */
  const haken = await seite.evaluate(async () => {
    const karte = { oracle_id: "orc-solring", name: "Sol Ring",
      oracle_text: "{T}: Add {C}{C}.", type_line: "Artifact", keywords: [] };
    const tm = await themenFuerKarten([karte]);
    const mit = synergyHooks(karte, tm ? (tm.get(karte.oracle_id) || []) : null);
    // Karte ohne Kennung im selben Lauf: bekommt keine Themen, bricht nichts.
    const ohneId = synergyHooks({ name: "Alt", oracle_text: "Sacrifice a creature.", type_line: "Sorcery" },
      tm ? [] : null);
    return { tm: tm ? [...tm.get("orc-solring")] : null,
             mit: mit.map(h => h.kind + ":" + h.q),
             ohneId: ohneId.map(h => h.kind + ":" + h.label) };
  });
  stand.gleich("kuratiert: Zyklus, Sperrliste, zu groß und zu klein fliegen raus — kleinste zuerst",
    haken.tm, ["mana-rock", "ramp"]);
  stand.gleich("die Haken suchen über otag:",
    haken.mit, ["thema:otag:mana-rock", "thema:otag:ramp"]);
  stand.gleich("Karte ohne Tags bekommt KEINE geratenen Themen untergemischt",
    haken.ohneId, []);

  const rueckfall = await seite.evaluate(async () => {
    // Index weg: Vokabular-Cache leeren und die Datenbank wegnehmen — genau
    // der Zustand „Migration nicht eingespielt".
    themenVokabularP = null; sb = null;
    const karte = { name: "Ashnod's Altar", type_line: "Artifact",
      oracle_text: "Sacrifice a creature: Add {C}{C}." };
    const tm = await themenFuerKarten([karte]);
    return { tm, hooks: synergyHooks(karte, tm).map(h => h.kind + ":" + h.label) };
  });
  stand.gleich("ohne Index: themenFuerKarten sagt null (nicht leer)", rueckfall.tm, null);
  stand.gleich("und die Regex-Rückfallebene rät wie bisher",
    rueckfall.hooks, ["theme:sacrifice", "theme:ramp"]);
}
