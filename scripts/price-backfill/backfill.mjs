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
//  Ablauf:
//    1. vorhandene scryfall_id aus public.cards holen (nur die brauchen wir),
//    2. AllIdentifiers streamen → scryfallId ↔ MTGJSON-uuid (nur Treffer),
//    3. AllPrices streamen → je uuid Cardmarket-EUR + TCGplayer-USD (retail,
//       normal + foil) als [{d,v}] herausziehen,
//    4. gebündelt in price_history upserten (Konflikt auf scryfall_id).
//
//  Beide Dateien werden GESTREAMT (gunzip → JSON-Token → je ein Eintrag),
//  nie vollständig in den Speicher geladen — nur die gebrauchten Karten
//  bleiben liegen.
//
//  Aufruf:
//    node backfill.mjs              echter Lauf (braucht SUPABASE_*-Env)
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

const MTGJSON_BASE = process.env.MTGJSON_BASE || "https://mtgjson.com/api/v5";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Wie viele Tage Historie je Reihe höchstens behalten. MTGJSON liefert ~90;
// der Schnitt ist nur eine Sicherung gegen künftige Formatänderungen.
const MAX_DAYS = 90;

// ------------------------------------------------------------ Umformung
// Reine Funktionen ohne Netz/DB — dieselben, die --self-test prüft.

// { "2024-05-01": 0.5, … } → [{ d:"2024-05-01", v:0.5 }, … ], nach Datum
// aufsteigend, ungültige Werte raus, auf die letzten MAX_DAYS gekürzt.
export function toSeries(dateMap) {
  if (!dateMap || typeof dateMap !== "object") return [];
  const out = [];
  for (const [d, raw] of Object.entries(dateMap)) {
    const v = Number(raw);
    if (Number.isFinite(v)) out.push({ d, v });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out.length > MAX_DAYS ? out.slice(-MAX_DAYS) : out;
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

// Alle vorhandenen scryfall_id aus public.cards, seitenweise über den
// Range-Header (PostgREST deckelt die Zeilen pro Antwort). Duplikate und
// NULL fallen in ein Set.
async function fetchScryfallIds() {
  const ids = new Set();
  let offset = 0, total = Infinity;
  while (offset < total) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?select=scryfall_id&order=scryfall_id`,
      { headers: { ...restHeaders, "Range-Unit": "items",
                   Range: `${offset}-${offset + 999}`, Prefer: "count=exact" } });
    if (!res.ok) throw new Error(`cards lesen → HTTP ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    const cr = res.headers.get("content-range");   // z. B. "0-999/5234"
    const m = cr && cr.match(/\/(\d+)$/);
    if (m) total = Number(m[1]);
    for (const r of rows) if (r.scryfall_id) ids.add(r.scryfall_id);
    if (rows.length === 0) break;
    offset += rows.length;
  }
  return ids;
}

// Zeilen gebündelt in price_history upserten (Konflikt auf scryfall_id →
// zusammenführen). return=minimal spart die Rückgabe der Zeilen.
async function upsert(rows) {
  const jetzt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map(r => ({ ...r, updated_at: jetzt }));
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/price_history?on_conflict=scryfall_id`,
      { method: "POST",
        headers: { ...restHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(batch) });
    if (!res.ok) throw new Error(`price_history schreiben → HTTP ${res.status}: ${await res.text()}`);
  }
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

  if (process.exitCode) throw new Error("Selbsttest fehlgeschlagen");
  console.log("Selbsttest bestanden.");
}

// ------------------------------------------------------------ Hauptlauf
async function main() {
  if (SELF_TEST) { selfTest(); return; }

  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");

  console.log("Vorhandene scryfall_id aus public.cards holen …");
  const wantedSids = await fetchScryfallIds();
  console.log(`  ${wantedSids.size} unterschiedliche Karten im Bestand.`);
  if (!wantedSids.size) { console.log("Nichts zu tun."); return; }

  // 1) AllIdentifiers: nur die gebrauchten scryfallId → uuid merken.
  console.log("AllIdentifiers streamen (scryfallId → uuid) …");
  const uuidToSid = new Map();
  await streamKeyed(`${MTGJSON_BASE}/AllIdentifiers.json.gz`, (uuid, value) => {
    const sid = value && value.identifiers && value.identifiers.scryfallId;
    if (sid && wantedSids.has(sid)) uuidToSid.set(uuid, sid);
  });
  console.log(`  ${uuidToSid.size} Karten in MTGJSON zugeordnet.`);
  if (!uuidToSid.size) { console.log("Keine Zuordnung — nichts zu schreiben."); return; }

  // 2) AllPrices: für die zugeordneten uuids die Reihen herausziehen. Wo eine
  //    Karte unter mehreren Auflagen dieselbe scryfall_id trägt, gewinnt der
  //    zuletzt gesehene Eintrag — für den EUR/USD-Verlauf ist das gleichwertig.
  console.log("AllPrices streamen (Cardmarket-EUR + TCGplayer-USD) …");
  const bySid = new Map();
  await streamKeyed(`${MTGJSON_BASE}/AllPrices.json.gz`, (uuid, value) => {
    const sid = uuidToSid.get(uuid);
    if (!sid) return;
    const prices = extractPrices(value);
    if (prices) bySid.set(sid, prices);
  });
  console.log(`  ${bySid.size} Karten mit Preisreihen gefunden.`);

  const rows = [...bySid.entries()].map(([scryfall_id, prices]) => ({ scryfall_id, prices }));

  if (DRY_RUN) {
    console.log("--dry-run: nicht geschrieben. Stichprobe:");
    console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    return;
  }

  console.log(`In price_history schreiben (${rows.length} Zeilen) …`);
  await upsert(rows);
  console.log("Fertig.");
}

// Nur bei direktem Aufruf loslaufen — als Modul (z. B. Tests, die
// extractPrices/toSeries importieren) bleibt main() still.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  main().catch(err => { console.error(err); process.exit(1); });
