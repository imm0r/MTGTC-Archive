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
      if (fn === "tags_of_card") {
        if (args.p_oracle_id !== "orc-solring") return { data: [], error: null };
        return { data: [
          { slug: "mana-rock", label: "mana-rock", description: "Artefakt, das Mana erzeugt.", cards: 109, direkt: true },
          { slug: "full-refund", label: "full-refund", description: null, cards: 103, direkt: true },
          { slug: "ramp", label: "ramp", description: null, cards: 562, direkt: false },
        ], error: null };
      }
      if (fn === "cards_with_tag") {
        if (args.p_slug !== "mana-rock") return { data: [], error: null };
        return { data: [ { oracle_id: "orc-solring" }, { oracle_id: "orc-anderswo" } ], error: null };
      }
      return { data: null, error: { message: "unbekannt: " + fn } };
    },
    from: (tabelle) => ({
      // .order() sortiert WIRKLICH, wie PostgREST es täte — die App verlässt
      // sich auf die Reihenfolge aus der Datenbank, also muss die Attrappe
      // den Vertrag einhalten, nicht nur die Form.
      select: () => ({ gte: () => ({ order: async (spalte, opts) => {
        const rows = [
          { slug: "mana-rock", label: "mana-rock", description: "Artefakt, das Mana erzeugt.", cards: 109 },
          { slug: "removal", label: "removal", description: null, cards: 4200 },
          { slug: "ramp", label: "ramp", description: null, cards: 562 },
        ].sort((a, b) => (opts && opts.ascending ? 1 : -1) * (a[spalte] - b[spalte]));
        return { data: rows, error: null };
      } }) }),
    }),
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

  stand.gleich("direkte Themen als Chips, geerbte gedimmt dahinter",
    await seite.evaluate(() => ({
      direkt: [...document.querySelectorAll("#dt-themen-body .thema-chip:not(.geerbt)")].map(c => c.textContent.replace(/\d+$/, "")),
      geerbt: [...document.querySelectorAll("#dt-themen-body .thema-chip.geerbt")].map(c => c.textContent.replace(/\d+$/, "")),
      trenner: !!document.querySelector("#dt-themen-body .thema-trenner"),
    })),
    { direkt: ["mana-rock", "full-refund"], geerbt: ["ramp"], trenner: true });

  stand.ist("die Beschreibung hängt als title am Chip",
    await seite.evaluate(() =>
      document.querySelector("#dt-themen-body .thema-chip")?.title || ""),
    await seite.evaluate(() => document.querySelector("#dt-themen-body .thema-chip")?.title));

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
    menu.alle, ["", "removal", "ramp", "mana-rock"]);
  stand.gleich("die Suche grenzt ein (Alle bleibt stehen)",
    menu.gefiltert, ["", "mana-rock"]);
}
