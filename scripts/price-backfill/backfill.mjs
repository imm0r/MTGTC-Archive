// =====================================================================
//  Preishistorie-Backfill (MTGJSON → Supabase)
//
//  Scryfall liefert nur den Tagespreis; einen Verlauf gibt es dort nicht.
//  MTGJSON bündelt ~90 Tage Preishistorie, aber ausschließlich als eine
//  große Bulk-Datei (AllPrices, ~1 GB entpackt) — viel zu groß für eine
//  Supabase Edge Function. Deshalb läuft der Import hier, auf einem GitHub-
//  Runner mit genug RAM/Disk, und schreibt die Werte mit dem service_role-
//  Key in die geteilte Tabelle public.price_history. Der Key gehört NIE in
//  den Browser — hier liegt er als Actions-Secret.
//
//  price_history ist ein ARCHIV, kein Zwischenspeicher: MTGJSON liefert je
//  Lauf nur die letzten ~90 Tage, und die werden über den vorhandenen Verlauf
//  GELEGT, nicht an seine Stelle gesetzt. Sonst wäre das Gespeicherte ein
//  gleitendes 90-Tage-Fenster und ein Jahresverlauf könnte nie entstehen.
//
//  Gemischt wird in der Datenbank (RPC merge_price_history, siehe
//  supabase-schema.sql), nicht hier. Andernfalls müsste dieser Job täglich
//  das gesamte Archiv herunterladen, im Speicher mischen und vollständig
//  zurückschreiben — eine Datenmenge, die mit jedem Jahr wächst. So überträgt
//  er immer nur das frische Fenster, egal wie lang der Verlauf schon ist.
//
//  Ablauf:
//    1. herausfinden, welche Karten gebraucht werden, und ihre uuid besorgen —
//       entweder aus AllIdentifiers oder (im Tagesmodus) aus der Datenbank,
//    2. die passende Preisdatei streamen → je uuid Cardmarket-EUR +
//       TCGplayer-USD (retail, normal + foil) als [{d,v}] herausziehen,
//    3. gebündelt an merge_price_history schicken (mischt je scryfall_id).
//
//  Die Bulkdateien werden GESTREAMT (gunzip → JSON-Token → je ein Eintrag),
//  nie vollständig in den Speicher geladen — nur die gebrauchten Karten
//  bleiben liegen.
//
//  MTGJSON kennt keinen Abruf für eine einzelne Karte — Preise gibt es nur als
//  Bulkdateien, und die sind unterschiedlich teuer:
//
//    AllIdentifiers.json.gz   215 MB   scryfallId → uuid
//    AllPrices.json.gz        143 MB   90 Tage Verlauf
//    AllPricesToday.json.gz   5,2 MB   nur der Tagespreis, gleicher Aufbau
//
//  Daraus drei Betriebsarten, jede so sparsam wie ihre Aufgabe es zulässt:
//
//    --only-gaps      nur Karten OHNE Archivzeile. Sind keine offen, endet der
//    (stündlich)      Lauf nach EINER Abfrage, ohne eine Bulkdatei anzufassen.
//                     Nur so lässt sich der Job stündlich fahren; eine neu
//                     erfasste Karte bekommt ihre 90 Tage binnen einer Stunde.
//
//    --today          hängt einen Punkt je Karte an. Lädt allein
//    (täglich)        AllPricesToday (5,2 MB) — die uuid-Zuordnung kommt aus
//                     price_history.mtgjson_uuid statt aus AllIdentifiers.
//
//    voll             alle Karten, volle 90 Tage. Fängt Korrekturen ein, die
//    (wöchentlich,    MTGJSON nachträglich an zurückliegenden Tagen vornimmt,
//     und von Hand)   und heilt Tage, an denen der Tageslauf ausfiel — die
//                     kleine Datei kennt ja immer nur ihr eigenes Datum.
//                     Schreibt dabei die uuid mit, von der --today lebt.
//
//  Aufruf:
//    node backfill.mjs              voller Lauf (braucht SUPABASE_*-Env)
//    node backfill.mjs --today      nur der Tagespreis, kleine Datei
//    node backfill.mjs --only-gaps  nur fehlende Karten, sonst Frühausstieg
//    node backfill.mjs --dry-run    alles außer dem Schreiben, mit Stichprobe
//    node backfill.mjs --self-test  reine Umform-Logik gegen ein Fixture
// =====================================================================

import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";

const ARGS      = new Set(process.argv.slice(2));
const DRY_RUN   = ARGS.has("--dry-run");
const SELF_TEST = ARGS.has("--self-test");
// Lückenmodus: nur Karten bearbeiten, die noch GAR KEINEN Verlauf haben.
// Gibt es keine, endet der Lauf, ohne die Bulkdatei anzufassen — nur so lässt
// sich der Job stündlich fahren, statt stündlich 1 GB zu ziehen.
const ONLY_GAPS = ARGS.has("--only-gaps");
// Tagesmodus: nur AllPricesToday (5 MB) statt AllPrices (143 MB) + AllIdentifiers
// (215 MB). Hängt einen Punkt je Karte an; die uuid-Zuordnung kommt aus der
// Datenbank, wo ein voller Lauf sie hinterlassen hat.
const TODAY_ONLY = ARGS.has("--today");

const MTGJSON_BASE = process.env.MTGJSON_BASE || "https://mtgjson.com/api/v5";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ------------------------------------------------------------ Umformung
// Reine Funktionen ohne Netz/DB — dieselben, die --self-test prüft.

// { "2024-05-01": 0.5, … } → [{ d:"2024-05-01", v:0.5 }, … ], nach Datum
// aufsteigend, ungültige Werte raus.
//
// Hier wird NICHT gekürzt. Früher schnitt diese Funktion auf 90 Tage — was
// harmlos aussah, weil MTGJSON ohnehin nur so viel liefert, aber zusammen mit
// dem überschreibenden Upsert dafür sorgte, dass der gespeicherte Verlauf nie
// älter als 90 Tage werden konnte. Was hereinkommt, geht auch hinaus; über
// Alter und Bestand entscheidet allein die Datenbank, und die hebt alles auf.
export function toSeries(dateMap) {
  if (!dateMap || typeof dateMap !== "object") return [];
  const out = [];
  for (const [d, raw] of Object.entries(dateMap)) {
    const v = Number(raw);
    if (Number.isFinite(v)) out.push({ d, v });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out;
}

// Ein AllPrices-Eintrag (Wert zu einer uuid) → { eur:{normal,foil},
// usd:{normal,foil} }. EUR kommt von Cardmarket, USD von TCGplayer, beides
// aus dem paper-Zweig und nur der retail-Preis (was man zahlt). Leere Reihen
// werden weggelassen; hat ein Eintrag gar nichts, kommt null zurück.
export function extractPrices(entry) {
  const paper = entry && entry.paper;
  if (!paper) return null;

  const cm = paper.cardmarket && paper.cardmarket.retail;
  const tp = paper.tcgplayer && paper.tcgplayer.retail;

  const eur = {
    normal: toSeries(cm && cm.normal),
    foil:   toSeries(cm && cm.foil),
  };
  const usd = {
    normal: toSeries(tp && tp.normal),
    foil:   toSeries(tp && tp.foil),
  };

  const prune = o => {
    const r = {};
    if (o.normal.length) r.normal = o.normal;
    if (o.foil.length)   r.foil = o.foil;
    return r;
  };
  const prices = {};
  const e = prune(eur), u = prune(usd);
  if (Object.keys(e).length) prices.eur = e;
  if (Object.keys(u).length) prices.usd = u;
  return Object.keys(prices).length ? prices : null;
}

// ------------------------------------------------------------ Supabase (REST)
const restHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Eine Tabelle seitenweise über den Range-Header lesen (PostgREST deckelt die
// Zeilen pro Antwort) und je Zeile onRow aufrufen.
async function fetchSeitenweise(pfad, was, onRow) {
  let offset = 0, total = Infinity;
  while (offset < total) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`,
      { headers: { ...restHeaders, "Range-Unit": "items",
                   Range: `${offset}-${offset + 999}`, Prefer: "count=exact" } });
    if (!res.ok) throw new Error(`${was} lesen → HTTP ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    const cr = res.headers.get("content-range");   // z. B. "0-999/5234"
    const m = cr && cr.match(/\/(\d+)$/);
    if (m) total = Number(m[1]);
    for (const r of rows) onRow(r);
    if (rows.length === 0) break;
    offset += rows.length;
  }
}

// Alle vorhandenen scryfall_id aus public.cards. Duplikate und NULL fallen
// in ein Set.
async function fetchScryfallIds() {
  const ids = new Set();
  await fetchSeitenweise("cards?select=scryfall_id&order=scryfall_id", "cards",
    r => { if (r.scryfall_id) ids.add(r.scryfall_id); });
  return ids;
}

// Wie fetchScryfallIds, aber mit Sprache, Setcode und Sammlernummer — die
// braucht das Auflösen fremdsprachiger Auflagen (siehe loeseEnglischAuf).
// Dieselbe Auflage steht je Zustand, Foil und Nutzer mehrfach in cards; je
// scryfall_id genügt ein Eintrag.
async function fetchKarten() {
  const out = [], gesehen = new Set();
  await fetchSeitenweise("cards?select=scryfall_id,lang,set_code,cn&order=scryfall_id", "cards",
    r => {
      if (!r.scryfall_id || gesehen.has(r.scryfall_id)) return;
      gesehen.add(r.scryfall_id);
      out.push(r);
    });
  return out;
}

// scryfall_id → mtgjson_uuid aus dem Archiv, soweit schon bekannt.
async function fetchArchivUuids() {
  const paare = new Map();
  await fetchSeitenweise(
    "price_history?select=scryfall_id,mtgjson_uuid&mtgjson_uuid=not.is.null&order=scryfall_id",
    "price_history",
    r => { if (r.mtgjson_uuid) paare.set(r.scryfall_id, r.mtgjson_uuid); });
  return paare;
}

// uuid → Menge eigener scryfall_id, für den Tagesmodus. Das erspart ihm
// AllIdentifiers (215 MB) — die Zuordnung hat ein voller Lauf längst ermittelt
// und in price_history.mtgjson_uuid hinterlegt.
//
// Eine MENGE, kein einzelner Wert: seit fremdsprachige Auflagen über die
// englische aufgelöst werden, tragen mehrere unserer scryfall_id dieselbe uuid
// (die deutsche und die englische Auflage derselben Karte). Eine gewöhnliche
// Zuordnung uuid → sid würde alle bis auf eine verschlucken.
//
// Beschränkt auf Karten, die auch jemand im Bestand hat: das Archiv behält
// Zeilen zu Karten, die niemand mehr besitzt, und die sollen nicht täglich
// weiter fortgeschrieben werden.
async function fetchUuidMap() {
  const imBestand = await fetchScryfallIds();
  const map = new Map();
  if (!imBestand.size) return map;
  for (const [sid, uuid] of await fetchArchivUuids()) {
    if (!imBestand.has(sid)) continue;
    if (!map.has(uuid)) map.set(uuid, new Set());
    map.get(uuid).add(sid);
  }
  return map;
}

// Karten, zu denen price_history noch KEINE Zeile führt — die Vorfrage des
// Lückenmodus, in einer Abfrage statt zweier voller Listen (die Funktion macht
// den Anti-Join in der Datenbank, siehe supabase-schema.sql).
async function fetchLuecken() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cards_missing_price_history`,
    { method: "POST", headers: restHeaders, body: "{}" });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || /PGRST202/.test(text) || /cards_missing_price_history/.test(text))
      throw new Error(
        "public.cards_missing_price_history fehlt in der Datenbank — der Lückenmodus " +
        "kann nicht prüfen, ob etwas fehlt, und bricht ab, statt blind 1 GB zu laden.\n" +
        "Abhilfe: supabase-schema.sql erneut ausführen oder die Migration " +
        "supabase/migrations/20260726140000_price_history_luecken.sql einspielen.");
    throw new Error(`Lücken abfragen → HTTP ${res.status}: ${text}`);
  }
  // Die Funktion gibt setof text zurück; PostgREST liefert das als Liste von
  // Zeichenketten (oder, je nach Fassung, als Objekte mit einer Eigenschaft).
  const roh = await res.json();
  const ids = new Set();
  for (const r of roh || []) {
    const v = typeof r === "string" ? r : r && Object.values(r)[0];
    if (v) ids.add(v);
  }
  return ids;
}

// Zeilen gebündelt an merge_price_history schicken. Die Funktion legt jede
// Reihe ÜBER die vorhandene (je Datum ein Punkt, der neue gewinnt), statt sie
// zu ersetzen — deshalb der Umweg über RPC und nicht der direkte Upsert auf
// die Tabelle, der die Spalte überschreiben würde.
//
// Bündelgröße bleibt bei 500: übertragen wird weiterhin nur das ~90-Tage-
// Fenster je Karte, unabhängig davon, wie lang der Verlauf in der Datenbank
// schon ist.
// Bündelgröße. Bewusst klein: das Mischen ist KEIN einfacher Upsert. Je Zeile
// läuft merge_price_map durch bis zu vier Reihen à ~90 Punkte, jede mit
// jsonb_agg und einer Fensterfunktion. Mit 500 Zeilen je Aufruf lief genau das
// in Supabases statement_timeout (Fehler 57014, "canceling statement due to
// statement timeout") und riss den ganzen Lauf mit — beobachtet am 26.07. beim
// ersten vollen Lauf mit 535 Zeilen. Die 500 stammten noch vom alten,
// überschreibenden Upsert, der pro Zeile fast nichts zu tun hatte.
const BUENDEL = 50;

async function mergeInDb(rows) {
  let beruehrt = 0;
  // Ein Stapel wird bei Zeitüberschreitung halbiert und erneut versucht, statt
  // den Lauf zu verlieren. Der Bestand wächst mit der Zeit, und ein fester Wert
  // wäre irgendwann wieder zu groß; so passt sich der Lauf selbst an.
  const schicke = async (batch, tiefe = 0) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/merge_price_history`,
      { method: "POST",
        headers: restHeaders,
        body: JSON.stringify({ p_rows: batch }) });

    if (!res.ok) {
      const text = await res.text();
      // PGRST202 = Funktion nicht gefunden. Hier NICHT auf den alten,
      // überschreibenden Upsert ausweichen: das würde den Verlauf, den wir
      // gerade sammeln wollen, still auf 90 Tage zurückstutzen. Lieber
      // abbrechen, ohne etwas angefasst zu haben.
      if (res.status === 404 || /PGRST202/.test(text) || /merge_price_history/.test(text))
        throw new Error(
          "public.merge_price_history fehlt in der Datenbank — es wurde NICHTS " +
          "geschrieben, der vorhandene Verlauf bleibt unangetastet.\n" +
          "Abhilfe: supabase-schema.sql erneut ausführen oder die Migration " +
          "supabase/migrations/20260726120000_price_history_langzeit.sql einspielen.");

      // 57014 = statement timeout. Halbieren und erneut versuchen. Das ist
      // gefahrlos wiederholbar: das Mischen ist additiv, ein Stapel, der schon
      // teilweise durchlief, wird durch dieselben Werte nicht verfälscht.
      if (/57014/.test(text) && batch.length > 1 && tiefe < 8) {
        const mitte = Math.ceil(batch.length / 2);
        console.log(`  Zeitüberschreitung bei ${batch.length} Zeilen — halbiert auf ${mitte}.`);
        return (await schicke(batch.slice(0, mitte), tiefe + 1))
             + (await schicke(batch.slice(mitte), tiefe + 1));
      }
      throw new Error(`price_history zusammenführen → HTTP ${res.status}: ${text}`);
    }
    const n = Number(await res.text());
    return Number.isFinite(n) ? n : 0;
  };

  for (let i = 0; i < rows.length; i += BUENDEL)
    beruehrt += await schicke(rows.slice(i, i + BUENDEL));
  return beruehrt;
}

// ------------------------------------------------------- Scryfall (Auflösung)
// MTGJSONs identifiers.scryfallId zeigt IMMER auf die englische Auflage. Eine
// deutsche Karte trägt eine eigene Scryfall-ID, die in AllIdentifiers nie
// vorkommt — ohne Umweg bekäme sie deshalb nie einen Verlauf.
//
// Denselben Umweg geht die App beim TAGESpreis längst (withPrice in app.js):
// Scryfall führt für fremdsprachige Auflagen gar keine Preise, alle Felder sind
// null; der Preis hängt an der englischen Auflage desselben Sets und derselben
// Sammlernummer. Hier gilt dasselbe für den VERLAUF, damit Liste und Graph
// dieselbe Quelle haben.
//
// Der Wert ist also bewusst der Preis der ENGLISCHEN Auflage. Deutsche Karten
// handeln auf Cardmarket oft etwas günstiger — eine Näherung, aber dieselbe,
// die schon in der Preisspalte steht.
const SCRYFALL_BASE = process.env.SCRYFALL_BASE || "https://api.scryfall.com";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sfGet(pfad) {
  const res = await fetch(`${SCRYFALL_BASE}${pfad}`, {
    headers: {
      Accept: "application/json",
      // Scryfall bittet ausdrücklich um einen sprechenden User-Agent.
      "User-Agent": "ArcanumArchive-PriceBackfill/1.0 (+https://github.com/imm0r/MTGTC-Archive)",
    },
  });
  if (res.status === 404) return null;                 // Auflage gibt es nicht
  if (!res.ok) throw new Error(`Scryfall ${pfad} → HTTP ${res.status}`);
  return res.json();
}

// [{scryfall_id, set_code, cn}] → Map(eigene sid → englische sid).
// Scryfall bittet um höchstens ~10 Anfragen/Sekunde; 110 ms Abstand hält das
// mit Luft ein. Ein einzelner Fehlschlag darf den Lauf nicht kippen — die Karte
// bleibt dann unaufgelöst und bekommt einen leeren Vermerk wie bisher.
async function loeseEnglischAuf(karten) {
  const map = new Map();
  let nr = 0, fehlgeschlagen = 0;
  for (const k of karten) {
    if (nr++) await sleep(110);
    const pfad = `/cards/${encodeURIComponent(String(k.set_code).toLowerCase())}`
               + `/${encodeURIComponent(k.cn)}/en`;
    let en = null;
    try { en = await sfGet(pfad); } catch { fehlgeschlagen++; }
    if (en && en.id) map.set(k.scryfall_id, en.id);
    if (nr % 100 === 0) console.log(`    … ${nr}/${karten.length} aufgelöst`);
  }
  if (fehlgeschlagen) console.log(`    ${fehlgeschlagen} Abrufe fehlgeschlagen (bleiben offen).`);
  return map;
}

// ------------------------------------------------------------ MTGJSON (Stream)
// Eine nach Schlüssel indexierte MTGJSON-Datei ({meta,data:{key:value,…}})
// streamen und je Eintrag onEntry(key, value) aufrufen. stream-json wird
// lazy geladen, damit --self-test/--check ohne installierte Abhängigkeit läuft.
async function streamKeyed(url, onEntry) {
  const parserMod = await import("stream-json");
  const pickMod   = await import("stream-json/filters/Pick.js");
  const soMod     = await import("stream-json/streamers/StreamObject.js");
  const parser       = parserMod.parser ?? parserMod.default?.parser ?? parserMod.default;
  const pick         = pickMod.pick ?? pickMod.default?.pick ?? pickMod.default;
  const streamObject = soMod.streamObject ?? soMod.default?.streamObject ?? soMod.default;

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);

  const sink = new Writable({
    objectMode: true,
    write({ key, value }, _enc, cb) {
      try { onEntry(key, value); cb(); } catch (e) { cb(e); }
    },
  });

  // Pick("data") schneidet den data-Teilbaum heraus, StreamObject setzt daraus
  // je Eigenschaft ein {key,value} zusammen — immer nur eine Karte auf einmal.
  await pipeline(
    Readable.fromWeb(res.body),
    createGunzip(),
    parser(),
    pick({ filter: "data" }),
    streamObject(),
    sink);
}

// ------------------------------------------------------------ Selbsttest
function selfTest() {
  const fixture = {
    paper: {
      cardmarket: {
        currency: "EUR",
        retail: {
          normal: { "2024-05-02": 0.55, "2024-05-01": 0.50, "2024-05-03": "0.6" },
          foil:   { "2024-05-01": 1.20 },
        },
        buylist: { normal: { "2024-05-01": 0.30 } },   // muss ignoriert werden
      },
      tcgplayer: {
        currency: "USD",
        retail: { normal: { "2024-05-01": 0.70, "2024-05-02": "oops" } },
      },
    },
    mtgo: { cardhoarder: { retail: { normal: { "2024-05-01": 0.01 } } } },
  };
  const p = extractPrices(fixture);
  const assert = (ok, msg) => { if (!ok) { console.error("FEHLGESCHLAGEN:", msg); process.exitCode = 1; } };

  assert(p.eur.normal.length === 3, "EUR normal: drei gültige Punkte");
  assert(p.eur.normal[0].d === "2024-05-01" && p.eur.normal[0].v === 0.50, "EUR normal aufsteigend sortiert");
  assert(p.eur.normal[2].v === 0.6, "EUR normal: String '0.6' wird zu Zahl");
  assert(p.eur.foil.length === 1, "EUR foil: ein Punkt");
  assert(p.usd.normal.length === 1 && p.usd.normal[0].v === 0.70, "USD: ungültiger Wert 'oops' fällt raus");
  assert(p.usd.foil === undefined, "USD foil fehlt → nicht gesetzt");
  assert(extractPrices({}) === null, "leerer Eintrag → null");
  assert(extractPrices({ paper: { cardmarket: { retail: {} } } }) === null, "keine Reihen → null");
  assert(toSeries(undefined).length === 0, "toSeries(undefined) → []");

  // Kernzusage dieses Jobs: es wird nichts abgeschnitten. Eine Reihe über
  // zwei Jahre muss vollständig und sortiert herauskommen — hier stand
  // früher ein 90-Tage-Schnitt, der den Langzeitverlauf unmöglich machte.
  const lang = {};
  const t0 = Date.UTC(2023, 0, 1);
  for (let i = 0; i < 730; i++)
    lang[new Date(t0 + i * 86400000).toISOString().slice(0, 10)] = i / 100;
  const reihe = toSeries(lang);
  assert(reihe.length === 730, `lange Reihe ungekürzt (${reihe.length} statt 730)`);
  assert(reihe[0].d === "2023-01-01", "lange Reihe beginnt am ältesten Tag");
  assert(reihe[729].d === "2024-12-30", "lange Reihe endet am jüngsten Tag");
  assert(reihe.every((p, i) => i === 0 || reihe[i - 1].d < p.d), "lange Reihe streng aufsteigend");

  if (process.exitCode) throw new Error("Selbsttest fehlgeschlagen");
  console.log("Selbsttest bestanden.");
}

// ------------------------------------------------------------ Hauptlauf
async function main() {
  if (SELF_TEST) { selfTest(); return; }

  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");

  // ---- 1) Zuordnung uuid → scryfall_id besorgen ------------------------
  // Tagesmodus holt sie aus der Datenbank (ein voller Lauf hat sie dort
  // hinterlegt) und spart damit AllIdentifiers — 215 MB, die größte der drei
  // Dateien. Die anderen Betriebsarten ermitteln sie aus AllIdentifiers und
  // schreiben sie unten mit, damit der Tagesmodus sie künftig vorfindet.
  // uuidToSids ist eine Zuordnung uuid → MENGE eigener scryfall_id, nicht auf
  // eine einzelne. Fremdsprachige Auflagen werden über die englische aufgelöst,
  // also tragen die deutsche und die englische Auflage derselben Karte dieselbe
  // uuid — eine Zuordnung auf einen Einzelwert würde eine von beiden
  // verschlucken, und zwar stillschweigend.
  let uuidToSids;
  let wantedSids = null;        // im Tagesmodus nicht gebraucht

  if (TODAY_ONLY) {
    console.log("Tagesmodus: uuid-Zuordnung aus price_history holen …");
    uuidToSids = await fetchUuidMap();
    console.log(`  ${uuidToSids.size} uuids mit bekannter Zuordnung im Bestand.`);
    if (!uuidToSids.size) {
      console.log("Keine bekannte uuid — es muss erst ein voller Lauf durch " +
                  "(node backfill.mjs ohne --today). Nichts geladen, nichts geschrieben.");
      return;
    }
  } else {
    // Lückenmodus (stündlich): erst die billige Vorfrage. Ist nichts offen,
    // endet der Lauf hier — ohne eine einzige Bulkdatei anzufassen.
    // Voller Modus (wöchentlich, und von Hand): alle Karten, damit auch
    // Korrekturen und verpasste Tage nachgezogen werden.
    let gebraucht;
    if (ONLY_GAPS) {
      console.log("Lückenmodus: Karten ohne Archivzeile suchen …");
      const luecken = await fetchLuecken();
      console.log(`  ${luecken.size} Karten ohne Verlauf.`);
      if (!luecken.size) {
        console.log("Keine Lücken — fertig, ohne die Bulkdatei zu laden.");
        return;
      }
      // Aus cards brauchen wir Sprache, Setcode und Nummer — ohne die lässt
      // sich eine fremdsprachige Auflage nicht auflösen. Der Umweg kostet eine
      // kleine Abfrage; die Lückenliste allein trägt nur die scryfall_id.
      gebraucht = (await fetchKarten()).filter(k => luecken.has(k.scryfall_id));
      // Beide Quellen leiten sich aus cards ab, sollten also übereinstimmen.
      // Gehen sie es doch nicht, bekäme die Differenz keinen Vermerk und bliebe
      // ewig Lücke — genau der Dauerlauf, der hier abgestellt wurde. Also
      // sichtbar machen statt verschweigen.
      if (gebraucht.length !== luecken.size)
        console.log(`  Hinweis: ${luecken.size - gebraucht.length} der gemeldeten Lücken ` +
                    `stehen nicht mehr in cards (zwischenzeitlich gelöscht?) — übersprungen.`);
    } else {
      console.log("Karten aus public.cards holen …");
      gebraucht = await fetchKarten();
      console.log(`  ${gebraucht.length} unterschiedliche Karten im Bestand.`);
    }
    wantedSids = new Set(gebraucht.map(k => k.scryfall_id));
    if (!wantedSids.size) { console.log("Nichts zu tun."); return; }

    // Wessen uuid schon im Archiv steht, braucht weder Scryfall noch einen
    // Treffer in AllIdentifiers — die Auflösung ist damit eine Einmalarbeit
    // je Karte, nicht eine je Lauf.
    const bekannt = await fetchArchivUuids();

    // Fremdsprachige Auflagen ohne bekannte uuid über die englische auflösen.
    const zuLoesen = gebraucht.filter(k =>
      k.lang && k.lang !== "en" && k.set_code && k.cn && !bekannt.has(k.scryfall_id));
    let enSid = new Map();
    if (zuLoesen.length) {
      console.log(`Fremdsprachige Auflagen über die englische auflösen ` +
                  `(${zuLoesen.length} Karten, ~110 ms Abstand) …`);
      enSid = await loeseEnglischAuf(zuLoesen);
      console.log(`  ${enSid.size} von ${zuLoesen.length} aufgelöst.`);
    }

    // Suchziel je Karte: die eigene scryfall_id (englisch) oder die der
    // englischen Auflage (fremdsprachig). Mehrere eigene Karten dürfen auf
    // dasselbe Ziel zeigen.
    uuidToSids = new Map();
    const merke = (uuid, sid) => {
      if (!uuidToSids.has(uuid)) uuidToSids.set(uuid, new Set());
      uuidToSids.get(uuid).add(sid);
    };
    const zielToSids = new Map();
    let ausArchiv = 0;
    for (const k of gebraucht) {
      const u = bekannt.get(k.scryfall_id);
      if (u) { merke(u, k.scryfall_id); ausArchiv++; continue; }
      const ziel = (k.lang && k.lang !== "en") ? enSid.get(k.scryfall_id) : k.scryfall_id;
      if (!ziel) continue;                          // unauflösbar → leerer Vermerk
      if (!zielToSids.has(ziel)) zielToSids.set(ziel, new Set());
      zielToSids.get(ziel).add(k.scryfall_id);
    }
    if (ausArchiv) console.log(`  ${ausArchiv} Karten mit uuid direkt aus dem Archiv.`);

    // AllIdentifiers nur streamen, wenn danach überhaupt noch etwas offen ist.
    if (zielToSids.size) {
      console.log(`AllIdentifiers streamen (scryfallId → uuid, ~215 MB) für ` +
                  `${zielToSids.size} offene Zuordnungen …`);
      await streamKeyed(`${MTGJSON_BASE}/AllIdentifiers.json.gz`, (uuid, value) => {
        const sid = value && value.identifiers && value.identifiers.scryfallId;
        const meine = sid && zielToSids.get(sid);
        if (!meine) return;
        for (const s of meine) merke(uuid, s);
      });
    } else {
      console.log("Alle Zuordnungen schon bekannt — AllIdentifiers wird nicht geladen.");
    }
    let zugeordnet = 0;
    for (const s of uuidToSids.values()) zugeordnet += s.size;
    console.log(`  ${zugeordnet} Karten in MTGJSON zugeordnet.`);
    if (!uuidToSids.size) { console.log("Keine Zuordnung — nichts zu schreiben."); return; }
  }

  // ---- 2) Preise streamen ----------------------------------------------
  // Beide Dateien tragen denselben Aufbau ({meta,data:{uuid:{paper:…}}}) und
  // dieselben Zweige — AllPricesToday führt je Reihe bloß ein Datum statt
  // neunzig. Deshalb genügt hier ein anderer Dateiname; extractPrices bleibt
  // unverändert. Wo eine Karte unter mehreren Auflagen dieselbe scryfall_id
  // trägt, gewinnt der zuletzt gesehene Eintrag — für den Verlauf gleichwertig.
  //
  // Eine uuid kann jetzt MEHRERE eigene Karten versorgen: die englische Auflage
  // und jede fremdsprachige, die über sie aufgelöst wurde. Alle bekommen
  // dieselbe Reihe.
  const datei = TODAY_ONLY ? "AllPricesToday.json.gz" : "AllPrices.json.gz";
  console.log(`${datei} streamen (Cardmarket-EUR + TCGplayer-USD) …`);
  const bySid = new Map();
  await streamKeyed(`${MTGJSON_BASE}/${datei}`, (uuid, value) => {
    const meine = uuidToSids.get(uuid);
    if (!meine) return;
    const prices = extractPrices(value);
    if (!prices) return;
    for (const sid of meine) bySid.set(sid, { prices, uuid });
  });
  console.log(`  ${bySid.size} Karten mit Preisreihen gefunden.`);

  const rows = [...bySid.entries()].map(([scryfall_id, o]) =>
    ({ scryfall_id, prices: o.prices, mtgjson_uuid: o.uuid }));

  // Nachgeschaut und nichts gefunden — das muss FESTGEHALTEN werden, sonst
  // dreht der Lückenmodus für immer im Kreis.
  //
  // MTGJSONs identifiers.scryfallId zeigt auf die ENGLISCHE Auflage. Eine
  // fremdsprachige Auflage trägt eine eigene Scryfall-ID, die dort nie
  // vorkommt — sie ist dauerhaft nicht zuordenbar. Ohne Vermerk bliebe sie
  // ewig eine "Lücke": die stündliche Prüfung fände immer dieselben Karten,
  // stiege nie früh aus und zöge jede Stunde 358 MB.
  //
  // Deshalb bekommt jede angefragte Karte eine Zeile, auch eine leere. Das ist
  // verlustfrei: merge_price_map läuft über die Schlüssel der NEUEN Seite, und
  // {} hat keine — eine vorhandene Reihe bleibt also unangetastet, und die uuid
  // hält das coalesce. Findet MTGJSON die Karte später doch (etwa eine
  // brandneue Auflage), trägt der wöchentliche Vollauf sie nach; er fragt
  // ohnehin jedes Mal den ganzen Bestand ab.
  if (wantedSids) {
    let ohneDaten = 0;
    for (const sid of wantedSids)
      if (!bySid.has(sid)) { rows.push({ scryfall_id: sid, prices: {} }); ohneDaten++; }
    if (ohneDaten)
      console.log(`  ${ohneDaten} Karten liefert MTGJSON nicht (meist fremdsprachige ` +
                  `Auflagen) — als nachgeschaut vermerkt, damit sie nicht ewig neu geladen werden.`);
  }

  if (DRY_RUN) {
    console.log("--dry-run: nicht geschrieben. Stichprobe:");
    console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    return;
  }

  console.log(`Mit price_history zusammenführen (${rows.length} Zeilen) …`);
  const beruehrt = await mergeInDb(rows);
  console.log(`Fertig — ${beruehrt} Zeilen berührt. Ältere Punkte blieben erhalten.`);
}

// Nur bei direktem Aufruf loslaufen — als Modul (z. B. Tests, die
// extractPrices/toSeries importieren) bleibt main() still.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  main().catch(err => { console.error(err); process.exit(1); });
