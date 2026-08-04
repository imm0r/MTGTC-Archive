// =====================================================================
//  Themen-Index (Scryfall Tagger → Supabase)
//
//  Holt Scryfalls Oracle-Tags und legt sie umgedreht bei uns ab. Warum
//  umgedreht: Scryfalls Such-API kann nur `otag:sacrifice-outlet` — die Karten
//  zu einem Thema. Die Gegenrichtung, „welche Themen hat DIESE Karte?",
//  bietet sie nicht an, und genau die braucht die Detailansicht.
//
//  Die Quelle ist eine einzige Datei: bulk-data, Typ `oracle_tags`, 5,9 MB
//  gepackt (18,3 MB entpackt), von Scryfall TÄGLICH neu gebaut. Gemessen am
//  Stand vom 03.08.2026 enthält sie 4509 Themen und 230.993 Zuordnungen auf
//  35.825 Karten — im Mittel 6,4 Themen je Karte.
//
//  WARUM NICHT ÜBER DIE SUCHE. Der erste Entwurf wollte je Thema eine
//  `otag:`-Suche fahren und die Treffer einsammeln. Gemessen an hundert
//  Zufallsthemen wären das rund 4300 Anfragen und 2 GB übertragen gewesen.
//  Die Bulk-Datei erledigt dasselbe mit EINEM Abruf und 5,9 MB — und bringt
//  obendrein die Beschreibungen und die Ober-/Unterthemen-Hierarchie mit, die
//  über die Suche gar nicht zu bekommen sind.
//
//  Der Lauf ersetzt den ganzen Bestand, denn Scryfall liefert ihn nur ganz:
//  welche Zuordnung seit gestern verschwunden ist, sagt niemand. Getauscht
//  wird über ein Zwischenlager in einer Transaktion (siehe die Migration
//  20260803180000_themen_index.sql) — wer währenddessen liest, sieht den alten
//  Stand, nie einen halben.
//
//  Der service_role-Key gehört NIE in den Browser; hier liegt er als
//  Actions-Secret. Deshalb läuft das als GitHub Action, nicht in der App.
//
//  Aufruf:
//    node themen.mjs                 einspielen, wenn Scryfall Neues hat
//    node themen.mjs --force         auch bei unverändertem Stand einspielen
//    node themen.mjs --dry-run       alles lesen und rechnen, nichts schreiben
//    node themen.mjs --self-test     nur die Zerlegung prüfen, ohne Netz
// =====================================================================

import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const ARGS      = new Set(process.argv.slice(2));
const DRY_RUN   = ARGS.has("--dry-run");
const FORCE     = ARGS.has("--force");
const SELF_TEST = ARGS.has("--self-test");

const SCRYFALL_BASE = process.env.SCRYFALL_BASE || "https://api.scryfall.com";
const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Bündelgrößen. Die Zuordnungen sind das Gros (231.000); 5000 je Aufruf ergibt
// rund 47 Anfragen — klein genug für PostgREST, groß genug, dass der
// Netz-Aufschlag je Aufruf nicht dominiert.
const BUENDEL_TAGS = 1000;
const BUENDEL_ZUO  = 5000;

const restHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// --------------------------------------------------------------- Zerlegung
/* Eine JSONL-Zeile auf das eindampfen, was gebraucht wird. Alles andere —
   `uri`, `child_ids`, `aliases`, `object` — bleibt liegen: Die Kinder ergeben
   sich beim Lesen aus den Eltern (siehe cards_with_tag in der Migration), und
   was niemand liest, muss auch nicht durchs Netz.

   `weight` je Zuordnung wird bewusst VERWORFEN. Die Quelle kennt drei Stufen,
   aber gemessen tragen 230.391 von 230.993 Zuordnungen dieselbe („median") —
   als Rangfolge taugt das nicht, und eine Spalte, die überall gleich ist,
   erweckt nur den Eindruck einer Aussage.

   Gibt null zurück für Zeilen, die kein Oracle-Tag sind. */
export function zeileLesen(roh) {
  let t;
  try { t = JSON.parse(roh); } catch { return null; }
  if (!t || t.type !== "oracle" || !t.slug) return null;
  const zuo = Array.isArray(t.taggings) ? t.taggings : [];
  return {
    id: t.id,
    slug: t.slug,
    label: t.label || t.slug,
    description: t.description || null,
    elternIds: Array.isArray(t.parent_ids) ? t.parent_ids : [],
    karten: [...new Set(zuo.map(x => x && x.oracle_id).filter(Boolean))],
  };
}

/* Die Eltern kommen als Kennungen; gespeichert werden Kürzel — die sind
   lesbar und überleben, falls Scryfall eine Kennung neu vergibt. Aufgelöst
   wird erst NACH dem Einlesen aller Zeilen: Die Datei ist nicht so sortiert,
   dass ein Elternteil vor seinem Kind stünde.

   Ein Verweis ins Leere wird still übergangen. Nachgemessen kommt das im
   echten Bestand nicht vor (null offene Verweise), aber ein einzelner
   kaputter Verweis darf keinen Lauf kosten. */
export function elternAufloesen(tags) {
  const kuerzel = new Map(tags.map(t => [t.id, t.slug]));
  for (const t of tags)
    t.parents = t.elternIds.map(id => kuerzel.get(id)).filter(Boolean);
  return tags;
}

// --------------------------------------------------------------- Scryfall
/* Scryfall bittet nicht nur um einen sprechenden User-Agent — es besteht
   darauf: Ohne den antwortet die API mit HTTP 400, nachgemessen. Node schickt
   von sich aus keinen, anders als curl oder ein Browser. Derselbe Kopf steht
   im Preis-Backfill. */
const sfHeaders = {
  Accept: "application/json",
  "User-Agent": "ArcanumArchive-TagIndex/1.0 (+https://github.com/imm0r/MTGTC-Archive)",
};

async function bulkEintrag() {
  const res = await fetch(`${SCRYFALL_BASE}/bulk-data`, { headers: sfHeaders });
  if (!res.ok) throw new Error(`bulk-data → HTTP ${res.status}`);
  const d = await res.json();
  const e = (d.data || []).find(x => x.type === "oracle_tags");
  if (!e) throw new Error("bulk-data führt keinen Eintrag „oracle_tags“");
  // jsonl_download_uri, nicht download_uri: Der Eintrag führt bei diesem Typ
  // ausschließlich die zeilenweise Fassung, und die lässt sich strömen.
  if (!e.jsonl_download_uri) throw new Error("oracle_tags ohne jsonl_download_uri");
  return e;
}

/* Die gepackte JSONL-Datei strömen, nicht am Stück laden. 18 MB entpackt wären
   verkraftbar, aber der Weg über einen Strom kostet nichts und hält den
   Speicherbedarf auch dann klein, wenn der Bestand wächst. */
async function tagsHolen(url) {
  const res = await fetch(url, { headers: sfHeaders });
  if (!res.ok) throw new Error(`Tag-Datei → HTTP ${res.status}`);
  const zeilen = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  const tags = [];
  for await (const z of zeilen) {
    if (!z.trim()) continue;
    const t = zeileLesen(z);
    if (t) tags.push(t);
  }
  return elternAufloesen(tags);
}

// --------------------------------------------------------------- Supabase
async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,
    { method: "POST", headers: restHeaders, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(`${name} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function letzterStand() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tag_import?id=eq.oracle_tags&select=bulk_id,bulk_updated_at,taggings`,
    { headers: restHeaders });
  if (!res.ok) return null;          // Tabelle fehlt noch → einfach einspielen
  const rows = await res.json();
  return rows[0] || null;
}

async function inBuendeln(zeilen, groesse, fn, was) {
  for (let i = 0; i < zeilen.length; i += groesse) {
    await fn(zeilen.slice(i, i + groesse));
    const fertig = Math.min(i + groesse, zeilen.length);
    if (fertig % (groesse * 10) === 0 || fertig === zeilen.length)
      console.log(`  ${was}: ${fertig}/${zeilen.length}`);
  }
}

// --------------------------------------------------------------- Selbsttest
function selfTest() {
  const fehler = [];
  const ist = (ok, msg) => { if (!ok) fehler.push(msg); };

  const zeilen = [
    // Ein gewöhnliches Thema mit Elternteil und zwei Karten.
    JSON.stringify({ object: "tag", id: "A", slug: "sacrifice-outlet-creature",
      label: "sacrifice-outlet-creature", type: "oracle", description: "Opfert Kreaturen.",
      parent_ids: ["B"], child_ids: [], aliases: ["sac-creature"],
      taggings: [{ oracle_id: "o1", weight: "median" }, { oracle_id: "o2", weight: "very_strong" }] }),
    // Das Oberthema: KEINE eigenen Karten. Genau der Fall, der die Hierarchie
    // nötig macht — im echten Bestand ist sacrifice-outlet exakt so.
    JSON.stringify({ object: "tag", id: "B", slug: "sacrifice-outlet",
      label: "sacrifice-outlet", type: "oracle", parent_ids: [], taggings: [] }),
    // Ein Illustrations-Tag: gehört nicht hierher.
    JSON.stringify({ object: "tag", id: "C", slug: "artist-signature", type: "illustration",
      parent_ids: [], taggings: [{ oracle_id: "o9" }] }),
    // Doppelte Karte in derselben Zuordnung.
    JSON.stringify({ object: "tag", id: "D", slug: "doppelt", type: "oracle",
      parent_ids: ["Z"], taggings: [{ oracle_id: "o3" }, { oracle_id: "o3" }] }),
    "kein JSON",
    "",
  ];
  const tags = elternAufloesen(zeilen.map(zeileLesen).filter(Boolean));

  ist(tags.length === 3, `drei Oracle-Tags erwartet, ${tags.length} bekommen`);
  ist(!tags.some(t => t.slug === "artist-signature"), "Illustrations-Tag fällt raus");
  ist(tags[0].parents.join() === "sacrifice-outlet", "Elternteil zu Kürzel aufgelöst");
  ist(tags[1].karten.length === 0, "Oberthema ohne eigene Karten bleibt erhalten");
  ist(tags[0].karten.length === 2, "beide Karten übernommen");
  ist(tags[0].description === "Opfert Kreaturen.", "Beschreibung übernommen");
  ist(tags[2].karten.length === 1, "doppelte Karte nur einmal");
  ist(tags[2].parents.length === 0, "Verweis ins Leere still übergangen");
  ist(zeileLesen("kein JSON") === null, "kaputte Zeile → null");
  // Das Gewicht wird verworfen: Übrig bleibt je Karte die nackte oracle_id,
  // kein Objekt. Sonst wanderte eine Angabe mit, die überall gleich ist.
  ist(tags[0].karten.every(k => typeof k === "string"), "je Karte nur die oracle_id");

  // Ein Thema ohne label muss eins bekommen — die Spalte ist not null.
  const ohne = zeileLesen(JSON.stringify({ id: "X", slug: "nur-slug", type: "oracle" }));
  ist(ohne.label === "nur-slug", "fehlendes label fällt auf das Kürzel zurück");
  ist(ohne.karten.length === 0, "fehlende taggings → leere Liste");

  if (fehler.length) {
    for (const f of fehler) console.error("FEHLGESCHLAGEN:", f);
    throw new Error(`Selbsttest fehlgeschlagen (${fehler.length})`);
  }
  console.log("Selbsttest bestanden.");
}

// --------------------------------------------------------------- Hauptlauf
async function main() {
  if (SELF_TEST) return selfTest();
  if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY))
    throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");

  const eintrag = await bulkEintrag();
  console.log(`Scryfall: oracle_tags vom ${eintrag.updated_at}, ` +
              `${(eintrag.compressed_size / 1e6).toFixed(1)} MB gepackt`);

  // Täglich laufen, aber nur arbeiten, wenn es etwas zu tun gibt. Scryfall baut
  // die Datei einmal am Tag; fällt ein Lauf mit demselben Stand zusammen, ist
  // ein zweites Einspielen reine Last auf der Datenbank.
  if (!DRY_RUN && !FORCE) {
    const stand = await letzterStand();
    if (stand && stand.bulk_id === eintrag.id &&
        new Date(stand.bulk_updated_at).getTime() === new Date(eintrag.updated_at).getTime()) {
      console.log(`Unverändert seit dem letzten Lauf (${stand.taggings} Zuordnungen) — nichts zu tun.`);
      return;
    }
  }

  const tags = await tagsHolen(eintrag.jsonl_download_uri);
  const zuordnungen = [];
  for (const t of tags) for (const o of t.karten) zuordnungen.push({ oracle_id: o, tag: t.slug });
  const karten = new Set(zuordnungen.map(z => z.oracle_id));
  console.log(`Gelesen: ${tags.length} Themen, ${zuordnungen.length} Zuordnungen ` +
              `auf ${karten.size} Karten (${(zuordnungen.length / karten.size).toFixed(1)} je Karte)`);

  if (DRY_RUN) {
    const gross = [...tags].sort((a, b) => b.karten.length - a.karten.length).slice(0, 5);
    console.log("Größte Themen: " + gross.map(t => `${t.slug} (${t.karten.length})`).join(", "));
    console.log("Probelauf — nichts geschrieben.");
    return;
  }

  await rpc("tag_import_begin");
  await inBuendeln(
    tags.map(t => ({ slug: t.slug, label: t.label, description: t.description,
                     parents: t.parents, cards: t.karten.length })),
    BUENDEL_TAGS, b => rpc("tag_import_tags", { p: b }), "Themen");
  await inBuendeln(zuordnungen, BUENDEL_ZUO,
    b => rpc("tag_import_taggings", { p: b }), "Zuordnungen");

  const erg = await rpc("tag_import_commit",
    { p_bulk_id: eintrag.id, p_bulk_updated: eintrag.updated_at });
  console.log(`Übernommen: ${erg?.tags} Themen, ${erg?.taggings} Zuordnungen.`);

  /* Die wirksame Kartenzahl je Thema — Karten einschließlich aller
     Unterbegriffe. Sie steht an den Chips in der Kartenansicht und muss
     dasselbe sagen wie die Trefferliste, die ein Klick darauf liefert.

     NACH dem Tausch, nicht darin: Gemessen dauert das Hochrollen rund zehn
     Sekunden (11.609 Vorfahr-Paare, verbunden mit 231.000 Zuordnungen ergibt
     472.000 Zeilen zum Zählen). Zehn Sekunden täglich sind belanglos — zehn
     Sekunden innerhalb von tag_import_commit wären es nicht: Diese
     Transaktion hält den ganzen Bestand gesperrt, und solange sähe die App
     eine Sammlung ohne Themen.

     Scheitert es, bleibt der Rest trotzdem stehen. Die Zahlen sind dann einen
     Lauf alt — eine Abweichung, die niemandem auffällt und die der nächste
     Lauf von selbst behebt. Den ganzen Einspielvorgang dafür rot zu machen,
     wäre unverhältnismäßig. */
  try {
    const n = await rpc("tag_rollup_berechnen");
    console.log(`Wirksame Kartenzahlen gerechnet: ${n} Themen.`);
  } catch (e) {
    console.warn(`Hochrollen übersprungen (${e.message}) — die Zahlen bleiben vom letzten Lauf.`);
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
