/* Die Matte eines Mitspielers ansehen — und dabei NICHTS von dessen Hand oder
   Bibliothek preisgeben.

   Das ist der Fall, bei dem ein Fehler nicht wie ein Fehler aussieht. Eine
   Zone, die versehentlich mitkommt, sieht aus wie eine Zone. Eine Karte zu
   viel im Friedhof fällt auf; eine Handkarte, die dort auftaucht, sieht
   genauso aus wie eine, die dort hingehört — nur der Besitzer wüsste es
   besser, und der sieht diese Ansicht nie.

   Deshalb prüft dieser Fall die Zusage von beiden Seiten:

   * AN DER QUELLE. Die Abfrage session_board wählt die Spalte `hand` nicht
     aus und überspringt Zeilen, in denen nur sie steht. Das steht in SQL und
     lässt sich im Browser nicht ausführen — also wird der Text der Datei
     gelesen. Eine Textprüfung ist schwach, aber sie fängt genau den Weg, auf
     dem so etwas hereinkäme: jemand ergänzt die Rückgabeliste um ein Feld.
   * IN DER ANZEIGE. Die Attrappe liefert absichtlich MEHR, als die echte
     Abfrage hergäbe — eine Handkarte und eine Handzahl. Kommt beides nicht
     durch, liest die App das Feld gar nicht erst, statt sich darauf zu
     verlassen, dass der Server es weglässt. Zwei Schlösser, nicht eines.

   Dazu das Übrige, was still schiefgehen kann: das Auge auf der eigenen Kachel
   (man sähe „seine eigene" Matte, die niemand geladen hat), Handgriffe auf
   fremden Karten (verschieben, was einem nicht gehört), ein Takt, der nach dem
   Schließen weiterfragt, und die Kommandozone — der einzige Rest, der
   mitkommt, und damit der einzige Ort, an dem sich eine Bibliothek
   einschleichen könnte. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUFBAU } from "../hilfen.mjs";

export const name = "fremdmatte";

/* three.js kommt in der App vom CDN; ohne Netz schlüge der Ladeversuch fehl und
   hinterließe einen Fehler, der mit diesem Fall nichts zu tun hat. */
const dreiDBereitstellen = (seite) => seite.route("https://cdn.jsdelivr.net/npm/three@**", r =>
  r.fulfill({ path: new URL("../node_modules/three/build/three.module.js", import.meta.url).pathname,
              headers: { "content-type": "text/javascript" } }));

/* Eine Partie mit vier Spielern, wie in „spielrunde". Die Abfrage der fremden
   Matte wird abgefangen: gezählt wird, WIE OFT gefragt wurde, und geliefert
   wird eine Antwort, die absichtlich zu viel enthält. */
const PARTIE = () => {
  const d = DECKS[0];
  const ids = d.entries.map(e => e.cardId);
  d.main_card_id = ids[0];

  USER = { id: "u0" };
  PROFILE = { display_name: "Ich" };
  SESSION = { id: "s0", host: "u0", start_life: 40, status: "open" };
  SESSION_PLAYERS = ["Ich", "Mira", "Jonas", "Ada"].map((n, i) => ({
    user_id: "u" + i, life: 40 - i, status: "joined", seat: i,
    deck_id: d.id, deck_name: d.name, commander: null, commander_img: null,
    profile: { id: "u" + i, display_name: n },
  }));
  SESSION_ZONEN = {};
  window.GESCHRIEBEN = [];
  window.zoneSchreiben = id => window.GESCHRIEBEN.push(id);
  window.wurfSpeichern = () => {};

  /* Was die echte Abfrage NIE liefern würde: `hand` an einer Karte, die sonst
     nirgends liegt, und eine Handzahl an einer, die auf dem Feld steht. Beides
     muss unsichtbar bleiben — sonst liest die App Felder, auf deren Fehlen sie
     sich nicht verlassen darf. */
  window.ABFRAGEN = [];
  window.ANTWORT = [
    { card_id: "f-wald", field: 3, graveyard: 0, exile: 0, cast_count: 0,
      field_state: [{ t: 1, c: 0 }, { t: 0, c: 2 }, { t: 0, c: 0 }],
      name: "Fremder Wald", printed_name: null, lang: "en",
      img: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", type_line: "Basic Land — Forest",
      is_cmd: false, cmd_qty: null, hand: 4 },
    { card_id: "f-baer", field: 1, graveyard: 0, exile: 0, cast_count: 0, field_state: [],
      name: "Fremder Bär", printed_name: null, lang: "en",
      img: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", type_line: "Creature — Bear",
      is_cmd: false, cmd_qty: null },
    { card_id: "f-grab", field: 0, graveyard: 2, exile: 0, cast_count: 0, field_state: [],
      name: "Fremdes Grab", printed_name: null, lang: "en", img: "", type_line: "Instant",
      is_cmd: false, cmd_qty: null },
    { card_id: "f-exil", field: 0, graveyard: 0, exile: 1, cast_count: 0, field_state: [],
      name: "Fremdes Exil", printed_name: null, lang: "en", img: "", type_line: "Sorcery",
      is_cmd: false, cmd_qty: null },
    // Commander: Deckmenge 1, liegt nirgends → Kommandozone 1, Steuer 2× cast.
    { card_id: "f-cmd", field: 0, graveyard: 0, exile: 0, cast_count: 2, field_state: [],
      name: "Fremder Anführer", printed_name: null, lang: "en", img: "",
      type_line: "Legendary Creature — Human", is_cmd: true, cmd_qty: 1 },
    // Eine Karte, die NUR auf der Hand liegt. Die echte Abfrage überspränge sie
    // ganz; kommt sie doch, darf sie in keiner Zone auftauchen.
    { card_id: "f-hand", field: 0, graveyard: 0, exile: 0, cast_count: 0, field_state: [],
      name: "Fremde Handkarte", printed_name: null, lang: "en", img: "", type_line: "Instant",
      is_cmd: false, cmd_qty: null, hand: 1 },
  ];
  window.fremdMatteLaden = async (uid) => { window.ABFRAGEN.push(uid); return window.ANTWORT; };

  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-session"));
  renderSession();
};

export default async function ({ seite, adresse, stand, wurzel }) {
  await dreiDBereitstellen(seite);
  await seite.goto(adresse, { waitUntil: "domcontentloaded" });
  await seite.evaluate(AUFBAU, { karten: 10, kategorien: 2, decks: 1 });
  await seite.waitForTimeout(250);
  await seite.evaluate(PARTIE);
  await seite.waitForTimeout(300);

  /* --- Die Quelle: hand kommt nicht mit ------------------------------- */
  const sql = await readFile(join(wurzel, "supabase-schema.sql"), "utf8");
  const funktion = sql.slice(sql.indexOf("create function public.session_board"),
                             sql.indexOf("revoke execute on function public.session_board"));
  stand.ist("session_board steht im Schema", funktion.length > 200, funktion.length + " Zeichen");
  const rueckgabe = funktion.slice(funktion.indexOf("returns table"), funktion.indexOf("language sql"));
  stand.ist("die Rückgabeliste kennt kein Feld „hand“",
    !/\bhand\b/.test(rueckgabe), rueckgabe.replace(/\s+/g, " ").slice(0, 120));
  stand.ist("Zeilen ohne offene Zone fallen heraus",
    /sp\.field\s*>\s*0\s+or\s+sp\.graveyard\s*>\s*0\s+or\s+sp\.exile\s*>\s*0\s+or\s+sp\.cast_count\s*>\s*0/.test(funktion));
  stand.ist("die Deckmenge kommt nur für Commander mit",
    /case when cm\.card_id is not null then coalesce\(de\.qty/.test(funktion));

  /* --- Das Auge: auf den anderen, nicht auf mir ----------------------- */
  const augen = await seite.evaluate(() => ({
    alle: [...document.querySelectorAll("#v-session [data-matte]")].map(b => b.dataset.matte),
    kacheln: document.querySelectorAll("#v-session .sp-card").length,
  }));
  stand.gleich("ein Auge je Mitspieler, keines auf der eigenen Kachel", augen.alle, ["u1", "u2", "u3"]);
  stand.ist("vier Kacheln stehen da", augen.kacheln === 4, augen.kacheln);

  /* Die Bühne liegt vorher nicht herum — sonst wäre sie kein Aufklappen. */
  stand.ist("ohne Klick keine Bühne",
    await seite.evaluate(() => !document.querySelector("#fremd-buehne")));

  /* --- Aufmachen ------------------------------------------------------ */
  await seite.click('#v-session [data-matte="u1"]');
  await seite.waitForTimeout(250);

  const auf = await seite.evaluate(() => {
    const b = document.querySelector("#fremd-buehne");
    if (!b) return null;
    const r = b.getBoundingClientRect(), m = document.querySelector("#zonen").getBoundingClientRect();
    const feld = [...b.querySelectorAll(".mat-feld")].map(s => ({
      titel: s.querySelector(".mat-titel")?.textContent.replace(/\s+/g, " ").trim(),
      n: s.querySelector(".mat-n")?.textContent,
      karten: s.querySelectorAll(".zk").length,
    }));
    // Die Lebensreihe muss FREI bleiben: Von dort wird die fremde Matte
    // geöffnet, und dorthin geht der Weg zum nächsten Mitspieler.
    const leben = document.querySelector("#zonen .mat-leben").getBoundingClientRect();
    return {
      wer: b.querySelector(".fremd-wer")?.textContent.trim(),
      abfragen: window.ABFRAGEN.slice(),
      // Deckt sie die Matte — oben und seitlich bündig, unten über der
      // Lebensreihe? Auf 1 px genau reicht, sie hängt an inset.
      deckt: Math.abs(r.left - m.left) < 2 && Math.abs(r.top - m.top) < 2
          && Math.abs(r.width - m.width) < 2,
      ueberLeben: Math.round(leben.top - r.bottom),
      // Was liegt in der Mitte der ersten Spielerkachel obenauf? Steckt die
      // Bühne davor, ist der Klick dorthin nicht möglich.
      obenAufKachel: (() => {
        const k = document.querySelectorAll("#zonen .sp-card")[1].getBoundingClientRect();
        const el = document.elementFromPoint(k.left + k.width / 2, k.top + 8);
        return el?.closest("#fremd-buehne") ? "buehne" : "kachel";
      })(),
      z: getComputedStyle(b).zIndex,
      feld,
      text: b.textContent,
      // Handgriffe, die es hier nicht geben darf.
      griffe: b.querySelectorAll("[data-move],[data-tap],[data-marke],[data-spk],[data-zonedrop]").length,
      getappt: b.querySelectorAll(".zk.getappt").length,
      marken: [...b.querySelectorAll(".zk-marke")].map(x => x.textContent),
      steuer: b.querySelector(".fremd-steuer")?.textContent,
    };
  });

  stand.ist("die Bühne steht", !!auf);
  stand.ist("sie nennt den Mitspieler beim Namen", /Mira/.test(auf?.wer || ""), auf?.wer);
  stand.gleich("genau einmal gefragt, und zwar nach u1", auf?.abfragen, ["u1"]);
  stand.ist("sie deckt die Matte in Breite und Höhe", auf?.deckt);
  stand.ist("sie endet über der Lebensreihe", auf?.ueberLeben >= 0 && auf?.ueberLeben < 20,
    auf?.ueberLeben + " px Abstand");
  stand.ist("die Spielerkacheln bleiben anklickbar", auf?.obenAufKachel === "kachel", auf?.obenAufKachel);
  stand.ist("sie liegt über Laden (40) und Würfel (30)", Number(auf?.z) > 40, auf?.z);

  /* --- Die Zonen ------------------------------------------------------ */
  stand.gleich("fünf Zonen: Schlachtfeld, Länder, Kommandozone, Friedhof, Exil",
    (auf?.feld || []).map(f => f.n),
    // Schlachtfeld 1 (Bär), Länder 3 (Wald ×3), Kommandozone 1, Friedhof 2, Exil 1
    ["1", "3", "1", "2", "1"]);
  /* Drei Exemplare EINER Karte, aber in drei Zuständen — getappt, mit zwei
     Marken, blank. Sie müssen als drei Bilder dastehen und nicht als „×3":
     Genau dafür führt das Schlachtfeld seine Exemplarliste. */
  stand.gleich("der Wald steht als drei Stapel, nicht als ein ×3",
    (auf?.feld || []).map(f => f.karten), [1, 3, 1, 1, 1]);
  stand.ist("ein Exemplar steht gedreht", auf?.getappt === 1, auf?.getappt);
  stand.gleich("ein Exemplar trägt seine Marken", auf?.marken, ["+2/+2"]);
  stand.ist("die Commander-Steuer steht als Zahl (2 Würfe = +4)",
    auf?.steuer === "+4", auf?.steuer);

  /* --- Die Zusage: Hand und Bibliothek bleiben weg -------------------- */
  stand.ist("keine Handkarte des Mitspielers zu sehen",
    !/Fremde Handkarte/.test(auf?.text || ""));
  stand.ist("kein Feld „Hand“ und kein Feld „Bibliothek“",
    !/Hand|Bibliothek/.test((auf?.feld || []).map(f => f.titel).join(" ")),
    (auf?.feld || []).map(f => f.titel).join(" · "));
  /* Die Antwort der Attrappe TRUG ein Feld `hand`. Dass es die Anzeige nicht
     erreicht, ist die eine Hälfte; die andere ist, dass es gar nicht erst
     übernommen wird. Sonst hinge die Zusage daran, dass niemand später eine
     Zone „hand“ ergänzt — das Feld läge ja bereit. */
  stand.ist("die geladenen Karten tragen kein Feld „hand“",
    await seite.evaluate(() => FREMD.karten.every(k => !("hand" in k))),
    await seite.evaluate(() => Object.keys(FREMD.karten[0]).join(",")));
  stand.ist("dass beides verdeckt ist, steht ausdrücklich da",
    /verdeckt/.test(auf?.text || ""));

  /* --- Nur ansehen ---------------------------------------------------- */
  stand.ist("keine Handgriffe auf fremden Karten", auf?.griffe === 0, auf?.griffe);

  /* --- Auffrischen im Takt -------------------------------------------- */
  await seite.evaluate(() => {
    // Der Mitspieler legt seinen Bären in den Friedhof.
    window.ANTWORT = window.ANTWORT.map(r =>
      r.card_id === "f-baer" ? { ...r, field: 0, graveyard: 1 } : r);
  });
  await seite.waitForTimeout(4600);
  const nach = await seite.evaluate(() => ({
    abfragen: window.ABFRAGEN.length,
    zahlen: [...document.querySelectorAll("#fremd-buehne .mat-n")].map(x => x.textContent),
  }));
  stand.ist("der Takt fragt von selbst nach", nach.abfragen >= 2, nach.abfragen + " Abfragen");
  stand.gleich("der Zug des Mitspielers steht da (Bär vom Feld ins Grab)",
    nach.zahlen, ["0", "3", "1", "3", "1"]);

  /* --- Umschalten auf einen anderen Mitspieler ------------------------ */
  await seite.click('#v-session [data-matte="u2"]');
  await seite.waitForTimeout(250);
  stand.ist("das Auge des anderen schaltet um, statt zu schließen",
    await seite.evaluate(() => !!document.querySelector("#fremd-buehne")
      && /Jonas/.test(document.querySelector(".fremd-wer")?.textContent || "")));

  /* --- Zumachen ------------------------------------------------------- */
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(200);
  stand.ist("Escape macht zu",
    await seite.evaluate(() => !document.querySelector("#fremd-buehne")));

  const vorher = await seite.evaluate(() => window.ABFRAGEN.length);
  await seite.waitForTimeout(4600);
  stand.ist("nach dem Zumachen fragt niemand mehr",
    await seite.evaluate(v => window.ABFRAGEN.length === v, vorher),
    await seite.evaluate(() => window.ABFRAGEN.length));
  /* Und der Takt selbst ist abgeräumt, nicht bloß wirkungslos. fremdHolen()
     kehrt ohne FREMD sofort um — deshalb fällt ein weiterlaufendes Intervall
     an den Abfragen oben NICHT auf (nachgemessen: die Prüfung blieb grün, als
     das clearInterval entfernt war). Es tickte dann bis zum Seitenende weiter. */
  stand.ist("das Intervall selbst ist abgeräumt",
    await seite.evaluate(() => fremdTakt === null), await seite.evaluate(() => String(fremdTakt)));

  /* --- Dasselbe Auge macht wieder zu ---------------------------------- */
  await seite.click('#v-session [data-matte="u1"]');
  await seite.waitForTimeout(200);
  await seite.click('#v-session [data-matte="u1"]');
  await seite.waitForTimeout(200);
  stand.ist("ein zweiter Klick aufs selbe Auge macht zu",
    await seite.evaluate(() => !document.querySelector("#fremd-buehne")));

  /* --- Hochkant: das Akkordeon statt der Matte ------------------------
     #zonen fängt dort weit unten an — gemessen bei 560 × 860 px erst auf Höhe
     576. Eine daran gehängte Lade klappte außerhalb des Blickfelds auf: Man
     klickt oben auf das Auge, und „nichts passiert". Genau diese Meldung gab
     es in dieser App schon einmal, beim Deck-Verlauf. */
  await seite.setViewportSize({ width: 560, height: 860 });
  await seite.waitForTimeout(300);
  stand.ist("schmal steht das Akkordeon", await seite.evaluate(() => !MAT_AN));
  await seite.click('#v-session [data-matte="u1"]');
  await seite.waitForTimeout(300);
  const schmal = await seite.evaluate(() => {
    const el = document.querySelector("#fremd-buehne");
    if (!el) return null;
    const r = el.getBoundingClientRect(), i = document.querySelector("#fremd-inhalt");
    return { pos: getComputedStyle(el).position,
             imBild: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
             oben: Math.round(r.top), karten: el.querySelectorAll(".zk").length,
             quer: i.scrollWidth - i.clientWidth };
  });
  stand.ist("die Lade hängt dort fest am Schirm", schmal?.pos === "fixed", schmal?.pos);
  stand.ist("und steht im Blickfeld statt weit unten", schmal?.imBild, "oben bei " + schmal?.oben + " px");
  stand.ist("die Karten stehen auch dort", schmal?.karten > 0, schmal?.karten);
  stand.ist("nichts läuft seitlich hinaus", schmal?.quer === 0, schmal?.quer);

  /* --- Zuschauen ohne eigenes Deck ------------------------------------
     Ohne gewähltes Deck gibt es keine Matte, und die Spielerreihe stand bisher
     NUR in der Matte — auf einem breiten Schirm sah man dann weder
     Lebenspunkte noch Mitspieler. Wer bloß zusieht, hat kein Deck und braucht
     beides am meisten. */
  await seite.setViewportSize({ width: 1600, height: 900 });
  await seite.evaluate(() => {
    fremdMatteSchliessen();
    SESSION_PLAYERS[0].deck_id = null;
    renderSession();
  });
  await seite.waitForTimeout(300);
  const ohne = await seite.evaluate(() => ({
    matte: !!document.querySelector("#zonen"),
    kacheln: document.querySelectorAll("#v-session .sp-card").length,
    augen: document.querySelectorAll("#v-session [data-matte]").length,
  }));
  stand.ist("ohne eigenes Deck gibt es keine Matte", !ohne.matte);
  stand.ist("die Mitspieler stehen trotzdem da", ohne.kacheln === 4, ohne.kacheln);
  stand.ist("und ihre Augen auch", ohne.augen === 3, ohne.augen);
  await seite.click('#v-session [data-matte="u1"]');
  await seite.waitForTimeout(300);
  stand.ist("die fremde Matte lässt sich auch als Zuschauer öffnen",
    await seite.evaluate(() => !!document.querySelector("#fremd-buehne")
      && document.querySelectorAll("#fremd-buehne .zk").length > 0));
}
