"use strict";

/* =====================================================================
   Konfiguration
   Beide Werte sind für den Browser gedacht und dürfen öffentlich sein —
   der Schutz der Daten kommt aus der Row Level Security in Supabase,
   nicht aus der Geheimhaltung dieses Schlüssels.
   Leer lassen: dann fragt die App beim ersten Start danach.
   ===================================================================== */
const CONFIG = {
  url: "https://kuhlwcifesyqmmzoivyi.supabase.co",   // MTGTC Archive, eu-central-1
  key: "sb_publishable_MVdkzqnXTvzECbdgM3JIow_1MxFOZwd"
};

/* ---------------------------------------------------------------- Helfer */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur = n => (n == null ? "–" : Number(n).toFixed(2).replace(".", ",") + " €");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => { const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}
function confirmDlg(html) {
  return new Promise(res => {
    $("#dlg-body").innerHTML = html;
    const dlg = $("#dlg");
    const done = v => { dlg.close(); res(v); };
    $("#dlg-yes").onclick = () => done(true);
    $("#dlg-no").onclick  = () => done(false);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
}

/* ============================== Supabase ============================== */
let sb = null, USER = null, PROFILE = null;

function cfg() {
  if (CONFIG.url && CONFIG.key) return CONFIG;
  try {
    const s = JSON.parse(localStorage.getItem("mtg-cfg") || "null");
    if (s?.url && s?.key) return s;
  } catch { /* kaputter Eintrag — als "nicht konfiguriert" behandeln */ }
  return null;
}

function connect(c) {
  sb = supabase.createClient(c.url, c.key);
  return sb;
}

/* Fehler der Datenbank in Klartext übersetzen statt roher Codes. */
function dbErr(e) {
  if (!e) return "";
  if (e.message?.includes("Failed to fetch"))
    return "Keine Verbindung zur Datenbank. Internet prüfen.";
  if (e.code === "42P01" || e.message?.includes("does not exist"))
    return "Tabellen fehlen — bitte supabase-schema.sql im SQL Editor ausführen.";
  if (e.code === "PGRST301" || e.code === "42501")
    return "Keine Berechtigung. Bist du noch angemeldet?";
  return e.message || "Unbekannter Datenbankfehler";
}

/* ------------------------------------------------------------ Datenlage */
let CARDS = [], DECKS = [];

async function reload() {
  const [c, d, e] = await Promise.all([
    sb.from("cards").select("*").order("name"),
    sb.from("decks").select("*").order("created"),
    sb.from("deck_entries").select("*")
  ]);
  for (const r of [c, d, e]) if (r.error) throw r.error;
  // disp = was auf der Karte steht; name bleibt der englische Name, unter
  // dem man die Karte überall sonst wiederfindet.
  CARDS = c.data.map(x => ({ ...x, set: x.set_code, disp: x.printed_name || x.name }));
  DECKS = d.data.map(dk => ({ ...dk,
    entries: e.data.filter(en => en.deck_id === dk.id)
                   .map(en => ({ cardId: en.card_id, qty: en.qty })) }));
}

/* ============================== Scryfall ============================== */
/* Scryfall bittet um max. ~10 Anfragen/Sekunde. Alle Aufrufe laufen daher
   durch diese Warteschlange, die 120 ms Abstand erzwingt. */
const sf = (() => {
  let chain = Promise.resolve(), last = 0;
  const call = async path => {
    const wait = 120 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const r = await fetch("https://api.scryfall.com" + path, { headers: { Accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Scryfall HTTP " + r.status);
    return r.json();
  };
  return path => (chain = chain.then(() => call(path), () => call(path)));
})();

const sfNamed = name => sf("/cards/named?fuzzy=" + encodeURIComponent(name));
const sfById  = id   => sf("/cards/" + id);

/* Volltextsuche. include_multilingual findet gedruckte Namen anderer
   Sprachen, include_extras auch Tokens — beides ist standardmäßig aus. */
async function sfSearch(q, max = 12) {
  const r = await sf("/cards/search?include_multilingual=true&include_extras=true" +
                     "&unique=prints&order=released&dir=desc&q=" + encodeURIComponent(q));
  return r?.data ? r.data.slice(0, max) : [];
}

const norm = s => (s || "").toLowerCase()
  .replace(/[’']/g, "").replace(/[^a-zà-ÿ0-9]+/g, " ").trim();

/* ------------------------------------------------- Suche über Setcode
   Unten links steht auf jeder modernen Karte die Sammlernummer und darunter
   Setcode und Sprache ("0008/013 T" / "MKM • DE"). Das identifiziert eine
   Auflage eindeutig — sprachunabhängig und auch für Tokens. Verlässlicher
   als jeder Namensabgleich, wenn die Ecke lesbar ist. */
const sfCode = async (code, num, lang) => {
  try {
    return await sf(`/cards/${encodeURIComponent(code.toLowerCase())}/${encodeURIComponent(num)}` +
                    (lang && lang !== "en" ? `/${lang}` : ""));
  } catch { return null; }
};

/* Scryfalls eur-Preise stammen von Cardmarket. Fremdsprachige Auflagen tragen
   dort weder Preis noch cardmarket_id, weil Cardmarket pro Auflage nur EIN
   Produkt führt und die Sprache lediglich einzelne Angebote filtert. Der Wert
   der englischen Auflage ist deshalb der Produktpreis dieser Karte — keine
   Schätzung. Von dort holen wir auch die ID für den Cardmarket-Link. */
async function withPrice(card) {
  if (!card) return card;
  const p = card.prices || {};
  const hatPreis = p.eur || p.eur_foil || p.usd || p.usd_foil;
  if (card.lang === "en" || (hatPreis && card.cardmarket_id)) return card;
  const en = await sfCode(card.set, card.collector_number, "en");
  if (!en) return card;
  if (!hatPreis && en.prices) card.prices = en.prices;
  if (!card.cardmarket_id && en.cardmarket_id) card.cardmarket_id = en.cardmarket_id;
  return card;
}

const cmLink = id => id
  ? `https://www.cardmarket.com/de/Magic/Products?idProduct=${id}`
  : null;

/* Scryfall-Seite der Karte: Regeltext, Legalitäten, alle Auflagen. Die
   Adresse folgt dem Muster /card/<set>/<nummer>, das brauchen wir nicht
   abzurufen — Setcode und Nummer stehen längst in der Zeile. Die Sprache
   hängt hinten an, sofern Scryfall die Auflage in ihr führt. */
const sfLink = c => c?.set && c?.cn
  ? `https://scryfall.com/card/${encodeURIComponent(String(c.set).toLowerCase())}/${encodeURIComponent(c.cn)}`
    + (c.printed_name && c.lang && c.lang !== "en" ? `/${encodeURIComponent(c.lang)}` : "")
  : null;

async function findByCode(code, num, lang, isToken) {
  const n = String(num).replace(/^0+/, "") || "0";   // führende Nullen ergeben 404
  const base = code.toLowerCase();
  // Achtung: "mkm/8" und "tmkm/8" existieren beide und sind verschiedene
  // Karten. Das T-Zeichen auf der Karte entscheidet, welche gemeint ist.
  // Zuletzt das p-Präfix: Promo-Karten führt Scryfall in eigenen Sets
  // (pemn, pdft, …), auf der Karte selbst steht aber der normale Setcode.
  // Als letzter Kandidat ist es ungefährlich — es greift nur, wenn wörtlich
  // und t-Präfix beide ins Leere laufen.
  const codes = [...new Set(isToken
    ? ["t" + base, base, "p" + base]
    : [base, "t" + base, "p" + base])];
  const langs = lang && lang !== "en" ? [lang, "en"] : ["en"];
  for (const c of codes)
    for (const l of langs) {
      const hit = await sfCode(c, n, l);
      if (hit) return withPrice(hit);
    }
  return null;
}

/* Die Suche liefert jede Auflage einzeln. Für eine Auswahlliste zählt aber
   die Karte, nicht die Auflage — sonst steht derselbe Name mehrfach da.
   Die Reihenfolge (neueste zuerst) bleibt erhalten. */
const byCard = hits => {
  const seen = new Set();
  return hits.filter(c => {
    const k = c.oracle_id || c.name;
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

/* Scryfalls Namenssuche (/cards/named) kennt ausschließlich englische
   Namen und keine Tokens. Für alles andere brauchen wir /cards/search.
   Rückgabe: eine Karte, eine Auswahlliste oder nichts. */
async function findCard(text, lang) {
  const t = text.trim();
  if (!t) return { card: null, candidates: [] };
  // Auch der Namensweg braucht Preis und Cardmarket-ID nachgeladen.
  const ok = async c => ({ card: await withPrice(c), candidates: [] });

  // 1. Nicht-englische Karten: gedruckten Namen in der gewählten Sprache suchen.
  if (lang && lang !== "en") {
    let hits = [];
    try { hits = await sfSearch(`name:"${t.replace(/"/g, "")}" lang:${lang}`); } catch { /* weiter */ }
    const exact = hits.find(c => norm(c.printed_name) === norm(t));
    if (exact) return ok(exact);
    const uniq = byCard(hits);
    if (uniq.length === 1) return ok(uniq[0]);
    if (uniq.length > 1) return { card: null, candidates: uniq };
  }

  // 2. Englischer Weg: verzeiht Tippfehler, deckt aber keine Tokens ab.
  try {
    const hit = await sfNamed(t);
    if (hit) return ok(hit);
  } catch { /* z. B. "Too many cards match" — unten weitersuchen */ }

  // 3. Auffangnetz: Volltextsuche inkl. Tokens, egal in welcher Sprache.
  let hits = [];
  try { hits = await sfSearch(`name:"${t.replace(/"/g, "")}"`); } catch { /* nichts gefunden */ }
  const exact = hits.find(c => norm(c.name) === norm(t) || norm(c.printed_name) === norm(t));
  if (exact) return ok(exact);
  const uniq = byCard(hits);
  if (uniq.length === 1) return ok(uniq[0]);
  return { card: null, candidates: uniq.length > 1 ? uniq : [] };
}

/* Für die Vorschlagsliste: autocomplete kann kein Deutsch (liefert auch mit
   include_multilingual nichts), daher für andere Sprachen die Volltextsuche. */
async function sfSuggest(q, lang) {
  if (!lang || lang === "en") {
    const r = await sf("/cards/autocomplete?q=" + encodeURIComponent(q));
    return (r?.data || []).map(n => ({ label: n, value: n }));
  }
  const hits = byCard(await sfSearch(`name:${JSON.stringify(q)} lang:${lang}`, 24)).slice(0, 8);
  return hits.map(c => ({
    label: (c.printed_name || c.name) + (c.printed_name ? ` — ${c.name}` : ""),
    value: c.printed_name || c.name
  }));
}

const priceOf = (c, foil) => {
  const p = c.prices || {};
  const pick = foil ? [p.eur_foil, p.eur, p.usd_foil, p.usd] : [p.eur, p.eur_foil, p.usd, p.usd_foil];
  const v = pick.find(x => x != null);
  return v == null ? null : parseFloat(v);
};
const imgOf = c => c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || "";

/* ============================ Bildmodell ==============================
   Die Edge Function hält den Anthropic-Schlüssel. Sie liest die Karte nur
   ab; der Abgleich gegen Scryfall bleibt hier in der App. Fällt sie aus,
   übernimmt Tesseract weiter unten. */

/* Ausschnitt in ein JPEG umrechnen. Ohne Ausschnittsangabe das ganze Bild. */
function toJpegBase64(img, box, maxEdge = 1100, quality = 0.85) {
  const b = box || { x: 0, y: 0, w: img.width, h: img.height };
  const scale = Math.min(3, maxEdge / Math.max(b.w, b.h));   // kleine Ausschnitte dürfen hochskaliert werden
  const cv = document.createElement("canvas");
  cv.width = Math.round(b.w * scale);
  cv.height = Math.round(b.h * scale);
  const cx = cv.getContext("2d");
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", quality).split(",")[1];
}

/* Die Karte im Foto finden. Auf Benjamins Bild liegt sie mittig auf hellem
   Grund und füllt den Rahmen nicht — verkleinert man das ganze Foto, bleiben
   vom Eckaufdruck 11 Pixel übrig und er wird unlesbar. Also erst die Karte
   freistellen, dann hat der Ausschnitt die Auflösung, auf die es ankommt.

   Verfahren: Randfarbe als Hintergrund annehmen, alle abweichenden Pixel
   markieren, deren Bereich über Zeilen- und Spaltenprojektionen eingrenzen.
   Schlägt es fehl (Karte füllt den Rahmen schon, oder Hintergrund ähnelt der
   Karte), gibt es null zurück und wir nehmen das ganze Bild. */
function findCardBounds(img) {
  const W = 160, H = Math.max(1, Math.round(img.height * (W / img.width)));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Hintergrund = Median der Randpixel
  const rand = [];
  for (let x = 0; x < W; x++) { rand.push(lum((0 * W + x) * 4)); rand.push(lum(((H - 1) * W + x) * 4)); }
  for (let y = 0; y < H; y++) { rand.push(lum((y * W + 0) * 4)); rand.push(lum((y * W + W - 1) * 4)); }
  rand.sort((a, b) => a - b);
  const bg = rand[rand.length >> 1];

  const spalte = new Array(W).fill(0), zeile = new Array(H).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (Math.abs(lum((y * W + x) * 4) - bg) > 40) { spalte[x]++; zeile[y]++; }

  // Grenze: eine Spalte/Zeile zählt, wenn 25 % ihrer Pixel abweichen
  const grenze = (arr, len) => {
    const min = len * 0.25;
    let a = arr.findIndex(v => v >= min);
    let b = arr.length - 1 - [...arr].reverse().findIndex(v => v >= min);
    return a < 0 ? null : [a, b];
  };
  const gx = grenze(spalte, H), gy = grenze(zeile, W);
  if (!gx || !gy) return null;

  const f = img.width / W;
  const box = {
    x: Math.max(0, Math.round(gx[0] * f)),
    y: Math.max(0, Math.round(gy[0] * f)),
    w: Math.min(img.width, Math.round((gx[1] - gx[0] + 1) * f)),
    h: Math.min(img.height, Math.round((gy[1] - gy[0] + 1) * f)),
  };

  // Plausibel? Magic-Karten sind hochkant, Seitenverhältnis ~0,72. Passt es
  // nicht, war die Erkennung Unsinn — lieber das ganze Bild nehmen.
  const anteil = (box.w * box.h) / (img.width * img.height);
  const verhaeltnis = box.w / box.h;
  if (anteil < 0.15 || verhaeltnis < 0.55 || verhaeltnis > 0.95) return null;
  return box;
}

let visionAus = false;   // nach einem harten Fehler nicht bei jeder Karte erneut versuchen

async function readWithVision(img) {
  if (visionAus) return null;

  // Karte freistellen, wenn sie den Rahmen nicht füllt.
  const karte = findCardBounds(img) || { x: 0, y: 0, w: img.width, h: img.height };

  // Zweites Bild: die untere linke Ecke der Karte, kräftig vergrößert. Dort
  // stehen Setcode und Nummer, und nur darauf kommt es an.
  const ecke = {
    x: karte.x,
    y: karte.y + Math.round(karte.h * 0.86),
    w: Math.round(karte.w * 0.62),
    h: Math.round(karte.h * 0.14),
  };

  const { data, error } = await sb.functions.invoke("scan-card", {
    body: {
      images: [
        { b64: toJpegBase64(img, karte, 1100), media_type: "image/jpeg" },
        { b64: toJpegBase64(img, ecke, 1100), media_type: "image/jpeg" },
      ],
    },
  });
  if (error) {
    const s = error.context?.status;
    let msg = "";
    try { msg = (await error.context.json()).error; } catch { /* kein JSON-Körper */ }

    if (s === 429) {
      // Vorübergehend — nicht abschalten, nur diese Karte anders lösen.
      toast(msg || "Zu viele Anfragen — diese Karte über Texterkennung.");
      return null;
    }
    // Alles andere ändert sich nicht von allein: für die Sitzung abschalten.
    // Ein Fehler OHNE Status ist kein Sonderfall, sondern der wichtigste —
    // er bedeutet CORS oder Netzwerk. Genau der ist mir hier stumm
    // durchgerutscht, weil ich nur bekannte Statuscodes behandelt habe.
    visionAus = true;
    toast(msg ? msg + " Weiter mit Texterkennung."
      : s ? `Bilderkennung nicht verfügbar (Fehler ${s}) — weiter mit Texterkennung.`
          : "Bilderkennung nicht erreichbar (CORS oder Netzwerk) — weiter mit Texterkennung.");
    return null;
  }
  return data?.card || null;
}

/* ================================= OCR ================================ */
let workerP = null;
const ocrWorker = () => (workerP = workerP || Tesseract.createWorker("eng", 1));

/* Der Kartenname steht im oberen Streifen. Wir schneiden ihn heraus,
   skalieren hoch und erhöhen den Kontrast — das hebt die Trefferquote
   gegenüber dem Rohfoto deutlich. */
function preprocess(img, topOnly) {
  const cv = document.createElement("canvas");
  const sw = img.width, sh = topOnly ? Math.round(img.height * 0.22) : img.height;
  const scale = Math.min(3, Math.max(1, 1400 / sw));
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, sw, sh, 0, 0, cv.width, cv.height);
  const d = cx.getImageData(0, 0, cv.width, cv.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    g = (g - 128) * 1.9 + 128;
    a[i] = a[i + 1] = a[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
  }
  cx.putImageData(d, 0, 0);
  return cv;
}

/* Ausschnitt der unteren linken Ecke. Der Aufdruck dort ist sehr klein,
   deshalb deutlich stärker vergrößert als beim Titel. */
function preprocessCorner(img) {
  const sx = 0, sy = Math.round(img.height * 0.85);
  const sw = Math.round(img.width * 0.55), sh = img.height - sy;
  const cv = document.createElement("canvas");
  const scale = Math.min(6, Math.max(2, 1600 / sw));
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const d = cx.getImageData(0, 0, cv.width, cv.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    g = (g - 120) * 3.2 + 128;                      // harter Kontrast: weiß auf schwarz
    a[i] = a[i + 1] = a[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
  }
  cx.putImageData(d, 0, 0);
  return cv;
}

/* ------------------------------------------------- Sprachcodes ------- */
/* Die Sprachen, die die App führt. Der Schlüssel ist IMMER der
   Scryfall-Code, nicht der auf der Karte gedruckte — die beiden gehen
   auseinander, siehe unten. Steht hier oben, weil parseCorner es braucht:
   const wird nicht hochgezogen, ein Zugriff vor der Deklaration stürzt ab.
   Diese Liste ist die einzige Quelle dafür, welche Sprache wir kennen: sie
   speist die Namen, die Auswahl beim Bearbeiten und die Prüfung in
   sprachCode(). */
const LANG_NAMES = { de: "Deutsch", en: "Englisch", fr: "Französisch", it: "Italienisch",
  es: "Spanisch", ja: "Japanisch", pt: "Portugiesisch", ru: "Russisch", ko: "Koreanisch",
  zhs: "Chinesisch (vereinfacht)", zht: "Chinesisch (traditionell)",
  // Phyrexianisch gibt es wirklich — 49 Karten bei Scryfall, gedruckt "PH".
  // Ein Land ist Phyrexia nicht, ein Wappen hat es trotzdem: siehe FLAGGEN.
  ph: "Phyrexianisch" };

/* Der auf die Karte GEDRUCKTE Sprachcode ist nicht immer Scryfalls Code.
   Belegt an Scryfall selbst: "lang:jp" und "lang:ja" liefern dieselben 30049
   Karten, "lang:cs" und "lang:zhs" dieselben 23988, "lang:ct" und "lang:zht"
   dieselben 17525 — es sind Aliasse derselben Sprache. Die Kartensuche
   akzeptiert beide Schreibweisen, der Endpunkt /cards/:set/:num/:lang aber
   NUR den kanonischen Code: /c16/32/ja liefert die Karte, /c16/32/jp einen
   404. In dieser Lücke ging es bisher verloren — eine japanische Karte lief
   in den 404, fiel still auf die englische Auflage zurück und wurde trotzdem
   als "jp" gespeichert.
   Alle übrigen Codes (EN, DE, FR, IT, ES, PT, RU, KO) sind gedruckt und bei
   Scryfall identisch. */
const GEDRUCKT_ZU_SCRYFALL = { jp: "ja", cs: "zhs", ct: "zht" };

/* Die Sprachen, die wir zu deuten wagen — genau die aus LANG_NAMES, keine
   zweite Liste daneben. Liest die Erkennung etwas anderes aus der Ecke
   (verwackelt, verkratzt, oder eine Sprache, die wir nicht führen), kommt
   null zurück und identify() nimmt die im Dropdown gewählte Sprache. Lieber
   die Angabe des Nutzers als ein erfundener Code in der Datenbank. */
const SCRYFALL_LANGS = new Set(Object.keys(LANG_NAMES));

function sprachCode(gedruckt) {
  const l = (gedruckt || "").toLowerCase();
  const s = GEDRUCKT_ZU_SCRYFALL[l] || l;
  return SCRYFALL_LANGS.has(s) ? s : null;
}

/* Der Aufbau der Ecke schwankt je nach Set — mal "0008/013 T", mal
   "T 0009 FFXIV". Deshalb keine feste Schablone, sondern Regeln:
   Der Setcode steht immer vor dem Trennzeichen in der Sprachzeile, die
   Nummer ist die erste Ziffernfolge der anderen Zeile, und ein einzelnes
   T darauf bedeutet Token — egal an welcher Stelle. */
function parseCorner(text) {
  const lines = text.toUpperCase().replace(/[|]/g, " ")
    .split("\n").map(l => l.trim()).filter(Boolean);

  // Sprachzeile finden: CODE <Trennzeichen> SPRACHE. Die Erkennung liest den
  // Punkt gern als *, . oder °.
  let set = null, lang = null, setLine = -1;
  lines.forEach((l, i) => {
    if (set) return;
    const m = l.match(/\b([A-Z0-9]{3,6})\s*[•·*.,°\-]\s*([A-Z]{2})\b/);
    // sprachCode übersetzt den gedruckten Code (JP) in Scryfalls (ja) und
    // gibt null, wenn wir ihn nicht kennen — dann gilt das Dropdown.
    if (m) { set = m[1]; lang = sprachCode(m[2]); setLine = i; }
  });
  if (!set) return null;

  // Nummernzeile: die erste andere Zeile, die eine Ziffernfolge enthält.
  for (let i = 0; i < lines.length; i++) {
    if (i === setLine) continue;
    const n = lines[i].match(/(\d{1,4})/);
    if (!n) continue;
    return {
      set, lang,
      num: n[1],
      // Alleinstehendes T = Token. Buchstabengruppen wie FFXIV enthalten
      // zwar ein T, matchen aber \bT\b nicht.
      token: /\bT\b/.test(lines[i]),
    };
  }
  return null;
}

const candidates = text => text.split("\n")
  .map(l => l.replace(/[^A-Za-zÀ-ÿ0-9',\- ]/g, " ").replace(/\s+/g, " ").trim())
  .filter(l => l.length >= 3 && /[A-Za-z]{3}/.test(l))
  .slice(0, 6);

async function identify(img, lang, onStep) {
  let firstGuess = "", best = [];

  // 1. Bildmodell: liefert eine wörtliche Abschrift der beiden Eckzeilen.
  //    Zerlegt wird sie hier mit parseCorner — dieselbe geprüfte Regel wie
  //    beim Tesseract-Weg. Das Modell soll lesen, nicht deuten.
  onStep("Karte wird gelesen…");
  try {
    const v = await readWithVision(img);
    if (v) {
      const c = parseCorner(`${v.corner_line_1 || ""}\n${v.corner_line_2 || ""}`);
      // Die Sprache von der Karte schlägt die Voreinstellung.
      const l = c?.lang || lang;
      if (c) {
        // Die Typzeile ist ein zweiter, unabhängiger Token-Hinweis: steht dort
        // "Spielsteinkreatur", ist es eines, auch wenn das winzige T entging.
        const token = c.token || /spielstein|\btoken\b|emblem/i.test(v.type_line || "");
        onStep(`Suche ${c.set} #${c.num}${token ? " (Token)" : ""}…`);
        const hit = await findByCode(c.set, c.num, l, token);
        if (hit) return { card: hit, guess: hit.printed_name || hit.name, candidates: [], vision: v, lang: l };
      }
      if (v.printed_name) {
        onStep(`Suche „${v.printed_name}“…`);
        const { card, candidates: cs } = await findCard(v.printed_name, l);
        if (card) return { card, guess: v.printed_name, candidates: [], vision: v, lang: l };
        if (cs.length) { best = cs; firstGuess = v.printed_name; }
      }
    }
  } catch { /* Bildmodell nicht erreichbar — weiter mit Texterkennung */ }

  const w = await ocrWorker();

  // 2. Auffangnetz: Setcode + Sammlernummer per Zeichenerkennung.
  onStep("Lese Setcode und Nummer…");
  try {
    const { data } = await w.recognize(preprocessCorner(img));
    const c = parseCorner(data.text);
    if (c) {
      onStep(`Suche ${c.set} #${c.num}${c.token ? " (Token)" : ""}…`);
      const hit = await findByCode(c.set, c.num, lang, c.token);
      if (hit) return { card: hit, guess: hit.printed_name || hit.name, candidates: [] };
    }
  } catch { /* Ecke unlesbar — weiter über den Namen */ }

  for (const topOnly of [true, false]) {
    onStep(topOnly ? "Lese Kartennamen…" : "Zweiter Versuch am ganzen Bild…");
    const { data } = await w.recognize(preprocess(img, topOnly));
    const lines = candidates(data.text);
    if (topOnly) firstGuess = lines[0] || "";
    for (const line of lines) {
      onStep("Suche „" + line + "“…");
      const { card, candidates: cs } = await findCard(line, lang);
      if (card) return { card, guess: line, candidates: [] };
      // Mehrdeutig: merken, aber weitersuchen — vielleicht trifft eine
      // andere Zeile eindeutig.
      if (cs.length && !best.length) { best = cs; firstGuess = line; }
    }
  }
  return { card: null, guess: firstGuess, candidates: best };
}

/* ============================ Scan-Ablauf ============================= */
const loadImg = file => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => rej(new Error("Bild nicht lesbar"));
  im.src = URL.createObjectURL(file);
});

/* Ein Job in der Warteschlange: identifizieren und Ergebnis anzeigen. img ist
   ein <img> ODER ein <canvas> — beide lassen sich gleich zeichnen und messen.
   Genutzt vom Einzelscan (ein Foto = eine Karte) UND vom Mehrfach-Scan (ein
   Foto = mehrere Karten, je Ausschnitt ein Aufruf hierher). */
async function scanBild(img, thumbSrc, lang) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `<img class="thumb" src="${esc(thumbSrc)}" alt="">
    <div class="body"><div class="title">Wird verarbeitet…</div>
    <div class="meta" data-step>Karte wird gelesen…</div>
    <div class="bar"><i style="width:35%"></i></div></div>`;
  $("#queue").prepend(el);
  const step = t => { const n = el.querySelector("[data-step]"); if (n) n.textContent = t; };
  const prog = p => { const n = el.querySelector(".bar i"); if (n) n.style.width = p + "%"; };
  try {
    const r = await identify(img, lang, s => { step(s); prog(70); });
    prog(100);
    // Nur die Sprache übernehmen — sie steht auf der Karte. Foil und Zustand
    // bleiben beim Nutzer.
    if (r.card) await addToCollection(r.card, el, r.vision ? { lang: r.lang } : null);
    else renderManual(el, r.guess, r.candidates);
  } catch (e) {
    el.querySelector(".body").innerHTML =
      `<div class="title">Fehlgeschlagen</div>
       <div class="meta"><span class="pill err">${esc(e.message)}</span></div>`;
  }
}

async function scanFile(file) {
  try {
    const img = await loadImg(file);
    await scanBild(img, URL.createObjectURL(file), $("#d-lang").value);
  } catch { toast("Bild nicht lesbar"); }
}

/* Ein Foto mit MEHREREN Karten: erst die Rechtecke vom Modell holen (detect),
   dann jede Karte ausschneiden und wie einen Einzelscan durch dieselbe Pipeline
   schicken — NACHEINANDER, um die Funktion und ihre Ratenbegrenzung nicht zu
   überrennen. Foil/Zustand/Sprache gelten wie beim Einzelscan aus den Dropdowns;
   Ausreißer korrigiert man je Karte in der Warteschlange. */
async function scanMultiFile(file) {
  let img;
  try { img = await loadImg(file); } catch { return toast("Bild nicht lesbar"); }
  toast("Karten werden gesucht…");
  let boxes;
  try { boxes = await detectCards(img); }
  catch (e) { return toast(e.message || "Karten konnten nicht gefunden werden."); }
  if (!boxes.length) return toast("Keine Karten erkannt — näher/heller fotografieren oder einzeln scannen.");
  toast(`${boxes.length} ${boxes.length === 1 ? "Karte" : "Karten"} erkannt — werden gelesen…`);
  const lang = $("#d-lang").value;
  for (const box of boxes) {
    const cv = cropCanvas(img, box, 0.06);
    await scanBild(cv, cv.toDataURL("image/jpeg", 0.7), lang);
  }
}

/* Kartenrechtecke (Anteile 0..1) für ein Foto über die "detect"-Betriebsart.
   Unplausible/leere Rechtecke fliegen gleich raus. */
async function detectCards(img) {
  if (visionAus) throw new Error("Bilderkennung ist für diese Sitzung deaktiviert.");
  const ganz = { x: 0, y: 0, w: img.width, h: img.height };
  const { data, error } = await sb.functions.invoke("scan-card", {
    body: { mode: "detect", images: [{ b64: toJpegBase64(img, ganz, 1600), media_type: "image/jpeg" }] },
  });
  if (error) {
    let msg = "";
    try { msg = (await error.context.json()).error; } catch { /* kein JSON-Körper */ }
    throw new Error(msg || "Bilderkennung nicht erreichbar (CORS oder Netzwerk).");
  }
  const cards = Array.isArray(data?.detect?.cards) ? data.detect.cards : [];
  return cards
    .map(b => ({ x: +b.x, y: +b.y, w: +b.w, h: +b.h }))
    .filter(b => [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
                 b.w > 0.03 && b.h > 0.03 && b.x >= 0 && b.y >= 0 && b.x < 1 && b.y < 1);
}

/* Schneidet ein Kartenrechteck mit etwas Rand aus dem Foto in ein eigenes
   Canvas. Der Rand gibt findCardBounds beim Einzelscan Luft, die Karte exakt zu
   fassen. */
function cropCanvas(img, box, padFrac) {
  const px = box.x * img.width, py = box.y * img.height;
  const pw = box.w * img.width, ph = box.h * img.height;
  const padX = pw * padFrac, padY = ph * padFrac;
  const x = Math.max(0, Math.round(px - padX)), y = Math.max(0, Math.round(py - padY));
  const x2 = Math.min(img.width, Math.round(px + pw + padX));
  const y2 = Math.min(img.height, Math.round(py + ph + padY));
  const cw = Math.max(1, x2 - x), ch = Math.max(1, y2 - y);
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  cv.getContext("2d").drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
  return cv;
}

/* detected.lang schlägt das Dropdown: Die Sprache ist auf die Karte gedruckt,
   eindeutig und ablesbar.
   Foil und Zustand kommen dagegen IMMER aus den Dropdowns. Beides sind
   physische Eigenschaften, die man einem Foto nicht ansieht: Glanz erzeugt
   auch jede Lampe über einer normalen Karte, und ein Fehlurteil legt eine
   eigene Zeile mit falschem Preis an. Wer scannt, weiß, was er in der Hand
   hält — eine ausdrückliche Auswahl überstimmt man nicht. */
async function addToCollection(card, el, detected) {
  const lang = detected?.lang || $("#d-lang").value;
  const cond = $("#d-cond").value;
  const foil = $("#d-foil").value === "1";
  const price = priceOf(card, foil);
  const before = CARDS.find(c => c.scryfall_id === card.id && c.foil === foil &&
                                 c.lang === lang && c.condition === cond);

  const { data, error } = await sb.rpc("add_card", {
    p_scryfall_id: card.id, p_oracle_id: card.oracle_id, p_name: card.name,
    p_printed_name: card.printed_name || null,
    p_set_code: (card.set || "").toUpperCase(), p_set_name: card.set_name,
    p_cn: card.collector_number, p_img: imgOf(card),
    p_cm_id: card.cardmarket_id ?? null,
    p_lang: lang, p_condition: cond, p_foil: foil, p_price: price,
    p_type_line: card.type_line ?? null, p_rarity: card.rarity ?? null,
    p_mana_cost: manaOf(card), p_cmc: card.cmc ?? null,
    p_released: card.released_at ?? null, p_colors: farbenOf(card),
    p_keywords: keywordsOf(card), p_oracle_text: oracleOf(card)
  });
  if (error) throw new Error(dbErr(error));

  await reload(); renderAll();
  const row = Array.isArray(data) ? data[0] : data;
  el.querySelector(".thumb").src = imgOf(card) || el.querySelector(".thumb").src;
  el.querySelector(".body").innerHTML = `
    <div class="title">${esc(card.printed_name || card.name)}</div>
    ${card.printed_name ? `<div class="meta">${esc(card.name)}</div>` : ""}
    <div class="meta">${esc(card.set_name)} &middot; #${esc(card.collector_number)} &middot; ${eur(price)}</div>
    <div class="meta" style="margin-top:6px">
      <span class="pill ok">${before ? "Anzahl: " + (row?.qty ?? "+1") : "Hinzugefügt"}</span>
      ${foil ? '<span class="pill foil">Foil</span>' : ""}
      <span class="pill">${esc(lang.toUpperCase())}</span><span class="pill">${esc(cond)}</span>
      <button class="btn ghost sm" data-fix style="margin-left:6px">Falsche Karte?</button>
    </div>`;
  el.querySelector("[data-fix]").onclick = () => renderManual(el, card.name);
}

function renderManual(el, guess, candidates) {
  const cs = candidates || [];
  const list = cs.length ? `
    <div class="picks">${cs.map((c, i) => `
      <button class="pick" data-pick="${i}">
        ${c.image_uris?.small ? `<img src="${esc(c.image_uris.small)}" alt="" loading="lazy">` : ""}
        <span><b>${esc(c.printed_name || c.name)}</b>
        ${c.printed_name ? `<i>${esc(c.name)}</i>` : ""}
        <i>${esc(c.set_name)} · #${esc(c.collector_number)}</i></span>
      </button>`).join("")}</div>` : "";

  el.querySelector(".body").innerHTML = `
    <div class="title">${cs.length ? "Welche Karte ist es?" : "Nicht sicher erkannt"}</div>
    <div class="meta">${cs.length
      ? `Gelesen wurde „${esc(guess)}“ — das passt auf mehrere Karten.`
      : "Kartenname eingeben — Vorschläge erscheinen beim Tippen."}</div>
    ${list}
    <div class="row" style="margin-top:8px">
      <div class="sugg"><input type="text" data-name value="${esc(guess)}" placeholder="Kartenname oder z. B. „MKM 8 T“"></div>
      <div style="flex:none"><button class="btn sm" data-go>Suchen</button></div>
    </div>
    <p class="hint" style="margin-top:6px">Immer eindeutig: Setcode und Sammlernummer von unten
      links auf der Karte, z. B. <code>MKM 8</code> — bei einem Token ein <code>T</code> anhängen
      (<code>FIN 9 T</code>), bei Promos den Setcode mit <code>P</code> davor (<code>PEMN 1Z</code>).
      Der Setcode steht in der Zeile mit dem Sprachkürzel.</p>`;

  el.querySelectorAll("[data-pick]").forEach(b => b.onclick = async () => {
    try { await addToCollection(cs[+b.dataset.pick], el); }
    catch (e) { toast(e.message); }
  });

  const inp = el.querySelector("[data-name]");
  attachSuggest(inp);
  const go = async () => {
    const v = inp.value.trim();
    if (!v) return;
    el.querySelector(".meta").textContent = "Suche…";
    try {
      // "MKM 8", "FIN 9 T" oder "PEMN 1Z": Eingabe von Setcode und Nummer,
      // wie sie unten links auf der Karte stehen. Die Nummer darf einen
      // Buchstaben tragen (1Z, 173p, 251★) — Promos und Sonderdrucke.
      const m = v.match(/^([a-z0-9]{3,5})[\s\-\/·•]+(\d{1,4}[a-z★]?)(?:\s+(t))?$/i);
      let card = m
        ? await findByCode(m[1], m[2], $("#d-lang").value, !!m[3])
        : null;
      // "FIN 9T" ohne Leerzeichen: erst als Nummer "9T" versucht (eben
      // fehlgeschlagen), jetzt als Nummer 9 mit Token-Zeichen.
      if (!card && m && !m[3] && /^\d+t$/i.test(m[2]))
        card = await findByCode(m[1], m[2].slice(0, -1), $("#d-lang").value, true);
      if (card) return addToCollection(card, el);
      if (m) return el.querySelector(".meta").innerHTML =
        `<span class="pill err">${esc(m[1].toUpperCase())} #${esc(m[2])} gibt es nicht${m[3] ? " als Token" : ""}</span>`;

      const r = await findCard(v, $("#d-lang").value);
      if (r.card) await addToCollection(r.card, el);
      else if (r.candidates.length) renderManual(el, v, r.candidates);
      else el.querySelector(".meta").innerHTML =
        '<span class="pill err">Keine Karte mit diesem Namen gefunden</span>';
    } catch (e) {
      el.querySelector(".meta").innerHTML = `<span class="pill err">${esc(e.message)}</span>`;
    }
  };
  el.querySelector("[data-go]").onclick = go;
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !el.querySelector(".sugg ul")) go();
  });
  if (!cs.length) { inp.focus(); inp.select(); }
}

function attachSuggest(inp) {
  const box = inp.parentElement;
  let list = null, sel = -1, timer;
  const close = () => { list?.remove(); list = null; sel = -1; };
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    const v = inp.value.trim();
    if (v.length < 3) return close();
    timer = setTimeout(async () => {
      let items = [];
      try { items = await sfSuggest(v, $("#d-lang").value); } catch { return close(); }
      close();
      if (!items.length) return;
      list = document.createElement("ul");
      items.forEach(it => {
        const li = document.createElement("li");
        li.textContent = it.label;
        li.dataset.value = it.value;
        li.onmousedown = e => { e.preventDefault(); inp.value = it.value; close(); };
        list.appendChild(li);
      });
      box.appendChild(list);
    }, 220);
  });
  inp.addEventListener("keydown", e => {
    if (!list) return;
    const items = [...list.children];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter" && sel >= 0) {
      // dataset.value, nicht textContent: die Beschriftung enthält bei
      // fremdsprachigen Karten zusätzlich den englischen Namen.
      e.preventDefault(); inp.value = items[sel].dataset.value; close();
    } else if (e.key === "Escape") close();
  });
  inp.addEventListener("blur", () => setTimeout(close, 150));
}

/* =========================== Sammlung-Ansicht ========================= */
let sortKey = "name", sortDir = 1;

/* Sortierung je Deck: wer eine Deck-Tabelle sortiert, meint diese eine und
   nicht alle. Der Zustand hängt deshalb am Deck. Voreinstellung wie in der
   Sammlung. */
const deckSort = {};

/* Der Wert, nach dem eine Spalte sortiert. Sammlung und Decks teilen sich
   diese Regel — sonst driften zwei fast gleiche Tabellen auseinander.
   Sie teilen sich aber NICHT die Daten: im Deck ist "Anz." die Deckmenge
   (deck_entries.qty), nicht der Sammlungsbestand, und "Bestand" ist, wie
   viele fehlen. Deshalb der Eintrag e als zweites Argument.
   Sortiert wird nach dem ANGEZEIGTEN Namen (disp), nicht nach dem
   englischen: eine sichtbare Liste nach einem unsichtbaren Schlüssel zu
   ordnen, verwirrt nur — "Überfluss" gehört unter Ü, nicht unter A
   (Abundance). */
function sortWert(key, c, e) {
  const qty = e ? e.qty : c.qty;
  if (key === "name")  return c.disp;
  if (key === "mana")  return c.cmc;
  if (key === "qty")   return qty;
  if (key === "fehlt") return e ? Math.max(0, e.qty - c.qty) : 0;
  // Erscheinungsdatum liegt als "2024-07-05" vor. Da sortiert die
  // Zeichenkette schon chronologisch — Jahr, Monat, Tag stehen in genau der
  // Reihenfolge und mit fester Stellenzahl. Kein Date-Objekt nötig.
  // Das || "" hält den Typ stabil: mischten sich null und Zeichenkette,
  // liefen die beiden Zweige von cmpWert durcheinander.
  if (key === "released") return c.released || "";
  return c[key];
}

const cmpWert = (x, y, dir) =>
  (typeof x === "string" ? x.localeCompare(y) : (x ?? 0) - (y ?? 0)) * dir;

/* Klick auf eine Spaltenüberschrift: dieselbe Spalte kehrt die Richtung um,
   eine neue beginnt aufsteigend. */
function sortUm(zustand, key) {
  zustand.dir = zustand.key === key ? -zustand.dir : 1;
  zustand.key = key;
}

function filtered() {
  const q = $("#q").value.trim().toLowerCase();
  const fs = $("#f-set").value, ff = $("#f-foil").value;
  return CARDS.filter(c =>
    (!q || c.name.toLowerCase().includes(q) || c.disp.toLowerCase().includes(q) ||
           (c.set_name || "").toLowerCase().includes(q)) &&
    (!fs || c.set === fs) &&
    (ff === "" || String(c.foil ? 1 : 0) === ff)
  ).sort((a, b) => cmpWert(sortWert(sortKey, a), sortWert(sortKey, b), sortDir));
}

function spark(hist) {
  if (!hist || hist.length < 2) return "";
  const vs = hist.slice(-12).map(h => Number(h.v)), mn = Math.min(...vs), mx = Math.max(...vs);
  const rng = mx - mn || 1, w = 46, h = 14;
  const pts = vs.map((v, i) =>
    `${(i / (vs.length - 1) * w).toFixed(1)},${(h - (v - mn) / rng * h).toFixed(1)}`).join(" ");
  return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pts}" fill="none"
          stroke="${vs[vs.length - 1] >= vs[0] ? "#4caf7d" : "#e0605e"}" stroke-width="1.5"/></svg>`;
}

/* --------------------------- Gemeinsame Kartentabelle -----------------
   Sammlung und Decks zeigen dieselben Zeilen. Drei Dinge unterscheiden
   sich im Deck: die Anzahl ist die Deck-Menge (deck_entries.qty, nicht der
   Sammlungsbestand), eine Spalte zeigt den Fehlbestand, und das Kreuz löst
   nur die Zuordnung — die Karte bleibt in der Sammlung. */
/* Das Deck zeigt bewusst weniger: Zustand, Erscheinungsdatum, Hinzugefügt
   und Preis stehen in der Detailansicht — hier zählt, welche Karte wie oft
   drin ist und ob sie da ist. Bild, Name, Mana, Set und Sprache stehen
   dagegen an derselben Stelle wie in der Sammlung, und sortierbar sind beide.
   Eine Spalte "Wert" (Preis × Anzahl) gibt es nicht mehr: sie wiederholte je
   Zeile eine Multiplikation, die man im Kopf macht. Summiert wird weiterhin —
   oben als Marktwert der Sammlung und je Deck im Deckkopf. */
function cardHead(imDeck) {
  const s = k => ` data-s="${k}"`;
  return `<tr>
    <th class="hide-s"></th>
    <th${s("name")}>Karte</th>
    <th${s("mana")} class="num">Mana</th>
    <th${s("set_name")} class="hide-s">Set</th>
    <th${s("lang")} class="hide-s">Spr.</th>
    ${imDeck ? "" : `<th${s("condition")} class="hide-s">Zust.</th>
    <th${s("released")} class="hide-s">Erschienen</th>
    <th${s("added")} class="hide-s">Hinzugefügt</th>`}
    <th${s("qty")} class="num">Anz.</th>
    ${imDeck ? `<th${s("fehlt")} class="num">Bestand</th>`
             : `<th${s("price")} class="num">Preis</th>`}
    <th></th><th></th>
  </tr>`;
}

function cardRow(c, o = {}) {
  const imDeck = !!o.deckId;
  const qty = imDeck ? o.qty : c.qty;
  const fehlt = imDeck ? Math.max(0, qty - c.qty) : 0;
  return `
    <tr data-id="${c.id}"${imDeck ? ` data-deck="${esc(o.deckId)}"` : ""}>
      <td class="hide-s">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" data-view
             style="cursor:pointer" title="Großansicht &amp; Preisverlauf">` : ""}</td>
      <td><div data-view style="cursor:pointer" title="Großansicht &amp; Preisverlauf">${esc(c.disp)}</div>
          <div style="font-size:12px;color:var(--dim)">
            ${c.printed_name && c.printed_name !== c.name ? esc(c.name) + " &middot; " : ""}
            ${c.foil ? '<span class="pill foil">Foil</span> ' : ""}#${esc(c.cn)}</div></td>
      <td class="num mana-spalte" title="${c.mana_cost == null ? "Manakosten nicht erfasst"
        : `Manawert ${c.cmc ?? "?"}`}">${manaHtml(c.mana_cost)}</td>
      <td class="hide-s">${esc(c.set_name || c.set || "")}
          ${c.rarity ? `<div style="margin-top:3px">${rarityPill(c.rarity)}</div>` : ""}</td>
      <td class="hide-s">${langHtml(c.lang)}</td>
      ${imDeck ? "" : `<td class="hide-s">${esc(c.condition || "")}</td>
      <td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap">${esc(datShort(c.released))}</td>
      <td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap">${dtShort(c.added)}</td>`}
      <!-- 54 px ist die schmalste Breite, bei der drei Stellen noch ganz
           hineinpassen (gemessen, inklusive Spinner-Pfeilen; ab 50 px wird
           abgeschnitten). Zwei Stellen sind der Regelfall, aber 100 Wälder
           sind kein Sonderfall genug, um sie unlesbar zu machen. -->
      <td class="num"><input type="number" min="0" value="${qty}" data-qty
             style="width:54px;padding:4px 6px;text-align:right"></td>
      ${imDeck ? `<td class="num">${fehlt
        ? `<span class="pill err">${fehlt} fehlen</span>`
        : '<span class="pill ok">vorhanden</span>'}</td>`
      : `<td class="num">${eur(c.price)} ${spark(c.hist)}</td>`}
      <td class="num" style="white-space:nowrap">${cmLink(c.cm_id)
        ? `<a class="cm" href="${esc(cmLink(c.cm_id))}" target="_blank" rel="noopener noreferrer"
             title="Angebote auf Cardmarket ansehen">CM</a>` : ""}${sfLink(c)
        ? ` <a class="cm" href="${esc(sfLink(c))}" target="_blank" rel="noopener noreferrer"
             title="Kartentext und alle Auflagen auf Scryfall">SF</a>` : ""}</td>
      <td class="num" style="white-space:nowrap">
        ${imDeck
          // Bearbeiten und Preis stehen im Deck in der Detailansicht — hier
          // nur, was das Deck betrifft: Hauptkarte und Zuordnung lösen.
          // Der Stern erscheint nur bei möglichen Commandern; die Regel selbst
          // erzwingt ein Trigger in der Datenbank.
          ? (istCommanderFaehig(c)
            ? `<button class="btn ghost sm${o.istHaupt ? " star-on" : ""}" data-main
              title="${o.istHaupt ? "Ist die Hauptkarte — nochmal klicken zum Entfernen"
                                  : "Als Hauptkarte des Decks setzen"}">${o.istHaupt ? "&#9733;" : "&#9734;"}</button>`
            : "")
          : `<button class="btn ghost sm" data-edit title="Sprache, Zustand oder Ausführung ändern">&#9998;</button>
        <button class="btn ghost sm" data-price title="Preis dieser Karte neu von Scryfall holen">&#8635;</button>`}
        <button class="btn ghost sm" data-del title="${imDeck
          ? "Aus dem Deck entfernen (Karte bleibt in der Sammlung)" : "Zeile löschen"}">&times;</button>
      </td>
    </tr>`;
}

function wireCardRows(root) {
  root.querySelectorAll("tbody tr[data-id]").forEach(tr => {
    const id = tr.dataset.id, deck = tr.dataset.deck;

    tr.querySelectorAll("[data-view]").forEach(el => {
      el.onclick = () => { hideHover(); showCardDetail(id); };
      if (HOVER_OK) {
        el.addEventListener("mouseenter", e => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => showHover(id, e.clientX, e.clientY), 300);
        });
        el.addEventListener("mouseleave", hideHover);
      }
    });

    // Nicht jede Ansicht hat jeden Knopf: im Deck fehlen Bearbeiten und
    // Preis (die stehen dort in der Detailansicht), in der Sammlung der
    // Hauptkarten-Stern. Deshalb überall prüfen, bevor verdrahtet wird.
    const eb = tr.querySelector("[data-edit]");
    if (eb) eb.onclick = () => editCard(id);

    const pb = tr.querySelector("[data-price]");
    if (pb) pb.onclick = async () => {
      const c = CARDS.find(x => x.id === id);
      if (!c) return;
      pb.disabled = true;
      try {
        const p = await preisNeuZiehen(c);
        await reload(); renderAll();
        toast(p == null ? "Scryfall führt keinen Preis für diese Auflage" : "Preis aktualisiert: " + eur(p));
      } catch (e) { pb.disabled = false; toast(e.message); }
    };

    tr.querySelector("[data-qty]").onchange = async ev => {
      const q = Math.max(0, parseInt(ev.target.value) || 0);
      try {
        const { error } = deck
          ? (q === 0
              ? await sb.from("deck_entries").delete().eq("deck_id", deck).eq("card_id", id)
              : await sb.from("deck_entries").update({ qty: q }).eq("deck_id", deck).eq("card_id", id))
          : (q === 0
              ? await sb.from("cards").delete().eq("id", id)
              : await sb.from("cards").update({ qty: q }).eq("id", id));
        if (error) throw error;
        await reload(); renderAll();
      } catch (e) { toast(dbErr(e)); }
    };

    const mb = tr.querySelector("[data-main]");
    if (mb) mb.onclick = () => setMainCard(deck, id);

    const db = tr.querySelector("[data-del]");
    if (db) db.onclick = async () => {
      try {
        const { error } = deck
          ? await sb.from("deck_entries").delete().eq("deck_id", deck).eq("card_id", id)
          : await sb.from("cards").delete().eq("id", id);
        if (error) throw error;
        await reload(); renderAll();
        toast(deck ? "Aus dem Deck entfernt" : "Karte entfernt");
      } catch (e) { toast(dbErr(e)); }
    };
  });
}

/* ============================== Dashboard ============================= */
/* Alle Auswertungen folgen dem Filter der Tabelle darunter. Ohne Filter ist
   das die ganze Sammlung; mit Filter sieht man die Statistik genau der
   Karten, die man gerade betrachtet ("Manakurve meiner grünen Karten").
   Damit niemand über eine gesunkene Summe erschrickt, sagt eine Zeile
   ausdrücklich, wenn gefiltert wird.
   Gezählt werden STÜCK (qty), nicht Zeilen: vier Wälder sind vier Karten. */

const FARB_INFO = {
  W: { name: "Weiß",    farbe: "#f7e7b8" },
  U: { name: "Blau",    farbe: "#8ec7ea" },
  B: { name: "Schwarz", farbe: "#9d93a3" },
  R: { name: "Rot",     farbe: "#ee8b6f" },
  G: { name: "Grün",    farbe: "#79c497" },
};

/* Die Kartentypen, die auf der Vorderseite stehen können. Eine Karte kann
   mehrere haben ("Legendary Artifact Creature") und zählt dann überall mit —
   die Summe ist deshalb größer als die Kartenzahl, was am Diagramm steht.
   type_line ist immer englisch, die Prüfung also sprachunabhängig. */
const TYPEN = [
  ["Creature", "Kreaturen"], ["Land", "Länder"], ["Instant", "Spontanzauber"],
  ["Sorcery", "Hexereien"], ["Artifact", "Artefakte"], ["Enchantment", "Verzauberungen"],
  ["Planeswalker", "Planeswalker"], ["Battle", "Schlachten"],
];

const istLand = c => /(^|\/\/\s*)[^/]*\bland\b/i.test(c.type_line || "");

function balkenHtml(daten, hinweis) {
  if (!daten.length) return '<div class="empty" style="padding:14px">Nichts auszuwerten.</div>';
  const max = Math.max(1, ...daten.map(d => d.wert));
  return `<div class="balken">${daten.map(d => `
    <div class="balken-zeile" title="${esc(d.label)}: ${esc(String(d.text ?? d.wert))}">
      <div class="balken-label">${d.icon || ""}<span>${esc(d.label)}</span></div>
      <div class="balken-spur"><i style="width:${(d.wert / max * 100).toFixed(1)}%${
        d.farbe ? `;background:${d.farbe}` : ""}"></i></div>
      <div class="balken-wert">${esc(String(d.text ?? d.wert))}</div>
    </div>`).join("")}</div>${hinweis ? `<p class="hint">${hinweis}</p>` : ""}`;
}

/* ans_ende: bei vielen Säulen rollt der Kasten waagerecht. Die Jahrgänge
   sollen dann beim NEUESTEN stehen — dort liegt fast die ganze Sammlung,
   und links stünden sonst 1994 bis 2004 mit je ein paar Karten im Bild,
   während der volle Teil unsichtbar bleibt. */
function saeulenHtml(daten, hinweis, ans_ende) {
  if (!daten.length) return '<div class="empty" style="padding:14px">Nichts auszuwerten.</div>';
  const max = Math.max(1, ...daten.map(d => d.wert));
  return `<div class="saeulen"${ans_ende ? " data-ans-ende" : ""}>${daten.map(d => `
    <div class="saeule" title="${esc(d.label)}: ${d.wert}">
      <div class="saeule-zahl">${d.wert || ""}</div>
      <div class="saeule-spur"><i style="height:${d.wert ? Math.max(2, d.wert / max * 100) : 0}%"></i></div>
      <div class="saeule-label">${esc(d.label)}</div>
    </div>`).join("")}</div>${hinweis ? `<p class="hint">${hinweis}</p>` : ""}`;
}

/* Tortendiagramm: Kreissegmente + Legende mit Wert und Prozent. Eine Torte
   ist nur ehrlich, wenn die Kategorien ein Ganzes bilden und die Anteile sich
   zu 100 % summieren — wer sie fuellt, muss also eine Aufteilung uebergeben,
   in der jede Karte GENAU EINMAL zaehlt. Der Prozentwert bezieht sich immer
   auf die Summe der Segmente.
   Ein einzelnes Segment (100 %) wird als voller Kreis gezeichnet: ein
   360°-Bogen ist entartet (Anfang = Ende) und bliebe unsichtbar.
   Die Segmente tragen einen Rand in der Hintergrundfarbe der Karte (per CSS),
   damit auch zwei helle Nachbarn (Weiß neben Farblos) getrennt bleiben. */
function tortenHtml(daten, hinweis) {
  const total = daten.reduce((s, d) => s + d.wert, 0);
  if (!total) return '<div class="empty" style="padding:14px">Nichts auszuwerten.</div>';
  const r = 16, cx = 18, cy = 18;
  let a = -Math.PI / 2;                       // oben beginnen
  const segmente = daten.length === 1
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${daten[0].farbe}"/>`
    : daten.map(d => {
        const a2 = a + (d.wert / total) * 2 * Math.PI;
        const p = (w) => `${(cx + r * Math.cos(w)).toFixed(3)},${(cy + r * Math.sin(w)).toFixed(3)}`;
        const gross = d.wert / total > 0.5 ? 1 : 0;
        const path = `<path d="M${cx},${cy} L${p(a)} A${r},${r} 0 ${gross} 1 ${p(a2)} Z" fill="${d.farbe}"/>`;
        a = a2;
        return path;
      }).join("");
  const legende = daten.map(d => `
    <div class="torte-leg">
      <span class="torte-punkt" style="background:${d.farbe}"></span>
      <span class="torte-name">${esc(d.label)}</span>
      <span class="torte-wert">${d.wert} &middot; ${Math.round(d.wert / total * 100)}&nbsp;%</span>
    </div>`).join("");
  return `<div class="torte">
      <svg viewBox="0 0 36 36" class="torte-svg" role="img" aria-label="Tortendiagramm">${segmente}</svg>
      <div class="torte-legende">${legende}</div>
    </div>${hinweis ? `<p class="hint">${hinweis}</p>` : ""}`;
}

/* Farbpalette für Kategorien ohne eigene Farbe (Kartentypen). Bewusst
   unterscheidbare Töne, in der Reihenfolge der größten Segmente vergeben. */
const TORTE_PALETTE = ["#79c497", "#8ec7ea", "#c9a76a", "#ee8b6f", "#b58ad1",
                       "#e6cf5a", "#9d93a3", "#6fbfb0"];

const karte = (titel, inhalt) =>
  `<div class="card"><h3 style="margin:0 0 10px">${esc(titel)}</h3>${inhalt}</div>`;

/* Baut das Dashboard aus einer Kartenliste, deren qty die zu ZÄHLENDE Menge
   ist: in der Sammlung der Bestand, im Deck die Deckmenge (dort werden die
   Karten vorher mit {...c, qty: eintrag.qty} umgehängt). So rechnet dieselbe
   Funktion beide Ansichten richtig — ein Deck mit 4 Wäldern zeigt 4, auch
   wenn 20 im Besitz sind.
   ziel ist das Element, in das geschrieben wird; gefiltert steuert nur den
   Hinweis "zeigt nur die gefilterten Karten" (im Deck immer false). */
function renderDash(rows, ziel = $("#dash"), gefiltert = false) {
  const stueck = cs => cs.reduce((s, c) => s + c.qty, 0);
  const wert   = cs => cs.reduce((s, c) => s + (c.price || 0) * c.qty, 0);
  const n = stueck(rows), gesamtwert = wert(rows);

  // ---- Kennzahlen
  const ohneLand = rows.filter(c => !istLand(c) && c.cmc != null);
  const mwSumme = ohneLand.reduce((s, c) => s + Number(c.cmc) * c.qty, 0);
  const mwAnzahl = stueck(ohneLand);
  const jahre = rows.map(c => c.released && c.released.slice(0, 4)).filter(Boolean).sort();
  const teuerste = [...rows].filter(c => c.price != null).sort((a, b) => b.price - a.price);

  const kennzahlen = [
    ["Karten gesamt", n],
    ["Verschiedene", new Set(rows.map(c => c.oracle_id)).size],
    ["Marktwert", eur(gesamtwert)],
    ["Ø je Karte", eur(n ? gesamtwert / n : 0)],
    ["Foils", stueck(rows.filter(c => c.foil))],
    ["Sets", new Set(rows.map(c => c.set)).size],
    // toFixed gibt "3.64" — im Deutschen gehört da ein Komma hin.
    ["Ø Manawert", mwAnzahl ? (mwSumme / mwAnzahl).toFixed(2).replace(".", ",") : "–"],
    ["Jahrgänge", jahre.length ? `${jahre[0]}–${jahre[jahre.length - 1]}` : "–"],
  ];

  // ---- Manakurve: ohne Länder, denn die kosten nichts und würden die
  //      Kurve bei 0 aufblähen. So macht man es in Magic überall.
  const maxCmc = Math.max(0, ...ohneLand.map(c => Number(c.cmc)));
  const kurve = [];
  for (let i = 0; i <= Math.min(maxCmc, 9); i++)
    kurve.push({ label: String(i), wert: stueck(ohneLand.filter(c => Number(c.cmc) === i)) });
  if (maxCmc > 9) kurve.push({ label: "10+", wert: stueck(ohneLand.filter(c => Number(c.cmc) >= 10)) });

  // ---- Farben als Torte: jede Karte zählt GENAU EINMAL, sonst summieren die
  //      Segmente über 100 %. Einfarbige nach ihrer Farbe, alles ab zwei Farben
  //      in "Mehrfarbig", der Rest "Farblos". Das ist die Aufteilung nach
  //      Farbidentität — eine andere Frage als "wie viel Schwarz steckt drin",
  //      aber die einzige, die eine Torte ehrlich beantwortet.
  const mitFarbe = rows.filter(c => Array.isArray(c.colors));
  const farbTorte = [
    ...Object.entries(FARB_INFO).map(([k, v]) => ({
      label: v.name, farbe: v.farbe,
      wert: stueck(mitFarbe.filter(c => c.colors.length === 1 && c.colors[0] === k)) })),
    { label: "Mehrfarbig", farbe: "#d9b64e", wert: stueck(mitFarbe.filter(c => c.colors.length > 1)) },
    { label: "Farblos",    farbe: "#b9bdc9", wert: stueck(mitFarbe.filter(c => c.colors.length === 0)) },
  ].filter(d => d.wert);

  // ---- Seltenheit: jede Karte hat genau eine — schon eine Aufteilung.
  const seltenheit = Object.entries(RARITY)
    .map(([k, v]) => ({ label: v.text, farbe: v.farbe, wert: stueck(rows.filter(c => c.rarity === k)) }))
    .filter(d => d.wert);

  // ---- Kartentypen: eine Karte kann mehrere haben (Artefaktkreatur) und zählt
  //      dann in jedem Segment. Die Torte zeigt also den Anteil an allen
  //      Typnennungen, nicht an den Karten — steht so im Hinweis. Farben aus
  //      der Palette, nach Größe vergeben.
  const typen = TYPEN
    .map(([en, de]) => ({ label: de,
      wert: stueck(rows.filter(c => new RegExp(`(^|//\\s*)[^/]*\\b${en}\\b`, "i").test(c.type_line || ""))) }))
    .filter(d => d.wert).sort((a, b) => b.wert - a.wert)
    .map((d, i) => ({ ...d, farbe: TORTE_PALETTE[i % TORTE_PALETTE.length] }));

  const sprachen = [...new Set(rows.map(c => c.lang))]
    .map(l => ({ label: LANG_NAMES[l] || (l || "?").toUpperCase(), icon: flaggeHtml(l, true),
                 wert: stueck(rows.filter(c => c.lang === l)) }))
    .sort((a, b) => b.wert - a.wert);

  const zustand = ["NM", "LP", "MP", "HP", "DMG"]
    .map(z => ({ label: z, wert: stueck(rows.filter(c => c.condition === z)) })).filter(d => d.wert);

  const topSets = Object.entries(rows.reduce((m, c) => {
      const k = c.set_name || c.set || "?"; m[k] = (m[k] || 0) + c.qty; return m;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, wert]) => ({ label, wert }));

  const proJahr = Object.entries(rows.reduce((m, c) => {
      if (!c.released) return m;
      const j = c.released.slice(0, 4); m[j] = (m[j] || 0) + c.qty; return m;
    }, {})).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, wert]) => ({ label, wert }));

  const topWert = teuerste.slice(0, 10).map(c => ({
    label: c.disp, wert: c.price * c.qty,
    text: c.qty > 1 ? `${eur(c.price)} × ${c.qty}` : eur(c.price) }));

  // ---- Zusammenbauen
  ziel.innerHTML = `
    <div class="stats" style="margin-bottom:14px">
      ${kennzahlen.map(([k, v]) =>
        `<div class="stat"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`).join("")}
    </div>
    ${gefiltert ? `<p class="hint" style="margin:-6px 0 12px">
      &#9432; Alle Auswertungen zeigen nur die ${n} gefilterten Karten — Filter leeren für die ganze Sammlung.</p>` : ""}
    <div class="dash-raster">
      ${karte("Manakurve", saeulenHtml(kurve,
        "Ohne Länder — sie kosten nichts und würden die Null aufblähen. X zählt als 0."))}
      ${karte("Farben", tortenHtml(farbTorte,
        "Nach Farbidentität — jede Karte zählt einmal, ab zwei Farben als „Mehrfarbig“."))}
      ${karte("Seltenheit", tortenHtml(seltenheit))}
      ${karte("Kartentypen", tortenHtml(typen,
        "Anteil an allen Typnennungen: eine Karte mit mehreren Typen (z.&nbsp;B. Artefaktkreatur) zählt in jedem Segment."))}
      ${karte("Wertvollste Karten", balkenHtml(topWert))}
      ${karte("Erscheinungsjahre", saeulenHtml(proJahr, "", true))}
      ${karte("Größte Sets", balkenHtml(topSets))}
      ${karte("Sprachen", balkenHtml(sprachen))}
      ${karte("Zustand", balkenHtml(zustand))}
    </div>`;

  // Muss nach dem Einhängen passieren: vorher hat der Kasten keine Breite
  // und scrollLeft bliebe wirkungslos.
  ziel.querySelectorAll("[data-ans-ende]").forEach(el => el.scrollLeft = el.scrollWidth);
}

function renderCollection() {
  const rows = filtered();
  renderDash(rows, $("#dash"), rows.length !== CARDS.length);

  const sets = [...new Set(CARDS.map(c => c.set))].filter(Boolean).sort();
  const cur = $("#f-set").value;
  $("#f-set").innerHTML = '<option value="">Alle</option>' +
    sets.map(s => `<option value="${esc(s)}"${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");

  $("#coll-empty").textContent = CARDS.length
    ? "Keine Karte passt zu diesem Filter."
    : "Noch keine Karten. Fotografiere deine erste Karte unter „Card Management“.";
  $("#coll-empty").style.display = rows.length ? "none" : "block";
  $("#tbl").style.display = rows.length ? "" : "none";

  $("#tbl thead").innerHTML = cardHead(false);
  $("#tbl tbody").innerHTML = rows.map(c => cardRow(c)).join("");
  wireCardRows($("#tbl"));

  // Die Kopfzeile wird bei jedem Rendern neu gebaut, also auch die
  // Sortier-Handler neu hängen.
  $$("#tbl th[data-s]").forEach(th => th.onclick = () => {
    const z = { key: sortKey, dir: sortDir };
    sortUm(z, th.dataset.s);
    sortKey = z.key; sortDir = z.dir;
    renderCollection();
  });
}

/* Manakosten einer Scryfall-Karte, oben rechts auf der Karte aufgedruckt.
   Zwei Fallen:
   * Bei doppelseitigen und geteilten Karten fehlt mana_cost OBEN ganz — die
     Kosten stehen je Seite in card_faces. "Journey to Eternity" ergibt so
     "{1}{B}{G}" (die Rückseite kostet nichts), "Fire // Ice" beide Hälften.
   * "" ist kein leerer Wert, sondern die Aussage "kostet nichts" (Länder,
     Tokens). Nur wenn wir gar nichts wissen, kommt null zurück — sonst
     behaupteten wir von jedem Land, es sei unerfasst.
   Beides trifft zusammen bei doppelseitigen Tokens ("Snake // Zombie"): dort
   ist mana_cost oben nicht da UND beide Seiten kosten "". Deshalb wird auf
   "ist eine Zeichenkette" geprüft und nicht auf "ist nicht leer" — sonst
   fielen beide Seiten weg und die Karte gälte fälschlich als unerfasst. */
const manaOf = card => {
  if (typeof card?.mana_cost === "string") return card.mana_cost;
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.mana_cost).filter(x => typeof x === "string");
  if (!angaben.length) return null;                    // keine Seite sagt etwas
  const echte = angaben.filter(x => x !== "");
  return echte.length ? echte.join(" // ") : "";       // alle Seiten frei = kostet nichts
};

/* Farben einer Scryfall-Karte. Wie bei manaOf: einseitige Karten tragen
   colors oben, doppelseitige je Seite. [] heißt farblos (eine Aussage),
   null heißt "wissen wir nicht".
   Bei mehreren Seiten wird VEREINIGT: "Westvale Abbey // Ormendahl" ist vorn
   ein farbloses Land und hinten eine schwarze Kreatur. Für die Frage "wie
   viel Schwarz habe ich?" zählt sie als schwarz — sie kann Schwarz auf den
   Tisch bringen.
   Abgeleitet wird hier nichts: die Farbe folgt nicht aus den Manakosten
   (Devoid, Tokens, Abenteuer), das steht in add_colors ausführlich. */
const farbenOf = card => {
  if (Array.isArray(card?.colors)) return [...card.colors].sort();
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.colors).filter(Array.isArray);
  if (!angaben.length) return null;
  return [...new Set(angaben.flat())].sort();
};

/* Schlüsselwörter einer Scryfall-Karte. Scryfall führt sie OBEN gesammelt über
   alle Seiten — anders als mana_cost/colors nicht je Seite. [] heißt "keine"
   (gültig), null "noch nicht erfasst". Diese Liste ist die verbürgte Quelle
   für die Namen der Schlüsselwort-Fähigkeiten; geraten wird nichts. */
const keywordsOf = card => Array.isArray(card?.keywords) ? card.keywords : null;

/* Voller Regeltext. Wie manaOf: einseitig oben, doppelseitig je Seite (dann
   mit "//" getrennt, damit man beide Hälften sieht). "" ist gültig (Vanilla-
   Kreaturen, viele Tokens), null eine Lücke. */
const oracleOf = card => {
  if (typeof card?.oracle_text === "string") return card.oracle_text;
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.oracle_text).filter(x => typeof x === "string");
  if (!angaben.length) return null;
  return angaben.join("\n//\n");
};

/* Trägt nach, was der Karte fehlt. Bestände aus der Zeit vor den Spalten
   type_line/rarity/mana_cost haben sie leer — und ohne Typzeile lehnt der
   Trigger die Karte als Hauptkarte ab und verweist dafür genau hierher
   ("Preis neu ziehen"). Dieser Weg muss sie also wirklich füllen, sonst
   schickt die App in eine Sackgasse.
   Nur LEERE Felder werden gesetzt: eine bereits erfasste Auflage behält ihre
   Angaben. Der Preis ist tagesaktuell, die Typzeile ist es nicht.
   Bei den Manakosten wird auf null geprüft statt auf "leer": "" ist ein
   gültiger Wert, und !"" wäre wahr — jedes Land würde bei jedem Preisabruf
   erneut geschrieben. */
async function nachtragen(c, fresh) {
  const patch = {};
  if (!c.type_line && fresh.type_line) patch.type_line = fresh.type_line;
  if (!c.rarity && fresh.rarity) patch.rarity = fresh.rarity;
  if (c.mana_cost == null) {
    const m = manaOf(fresh);
    if (m != null) patch.mana_cost = m;
  }
  // Auch hier "== null" und nicht "leer": Manawert 0 ist gültig (Länder).
  if (c.cmc == null && fresh.cmc != null) patch.cmc = fresh.cmc;
  if (!c.released && fresh.released_at) patch.released = fresh.released_at;
  // Wieder "== null" und nicht "leer": [] ist gültig (farblose Karte).
  if (c.colors == null) {
    const f = farbenOf(fresh);
    if (f != null) patch.colors = f;
  }
  // [] bzw. "" sind gültig (keine Schlüsselwörter / kein Regeltext), nur null
  // ist eine Lücke — daher == null.
  if (c.keywords == null) {
    const k = keywordsOf(fresh);
    if (k != null) patch.keywords = k;
  }
  if (c.oracle_text == null) {
    const o = oracleOf(fresh);
    if (o != null) patch.oracle_text = o;
  }
  if (!Object.keys(patch).length) return;
  const { error } = await sb.from("cards").update(patch).eq("id", c.id);
  if (error) throw new Error(dbErr(error));
}

/* Preis einer einzelnen Karte neu holen. Zeile und Detailansicht teilen sich
   diesen Weg — sonst füllt nur einer von beiden die Lücken nach. */
async function preisNeuZiehen(c) {
  const fresh = await withPrice(await sfById(c.scryfall_id));
  if (!fresh) throw new Error("Karte bei Scryfall nicht gefunden");
  const p = priceOf(fresh, c.foil);
  // set_price schreibt in die Preishistorie: ein Punkt pro Tag, 60 bleiben.
  const { error } = await sb.rpc("set_price", { p_card_id: c.id, p_price: p });
  if (error) throw new Error(dbErr(error));
  await nachtragen(c, fresh);
  return p;
}

async function updatePrices() {
  const btn = $("#upd");
  btn.disabled = true;
  const uniq = [...new Set(CARDS.map(c => c.scryfall_id))];
  let done = 0, failed = 0;
  for (const sid of uniq) {
    btn.textContent = `Preise… ${++done}/${uniq.length}`;
    let fresh = null;
    try { fresh = await sfById(sid); } catch { failed++; continue; }
    if (!fresh) { failed++; continue; }
    for (const c of CARDS.filter(x => x.scryfall_id === sid)) {
      const { error } = await sb.rpc("set_price", { p_card_id: c.id, p_price: priceOf(fresh, c.foil) });
      if (error) { failed++; continue; }
      try { await nachtragen(c, fresh); } catch { failed++; }
    }
  }
  try { await reload(); renderAll(); } catch (e) { toast(dbErr(e)); }
  btn.disabled = false; btn.textContent = "Preise aktualisieren";
  toast(failed ? `Preise aktualisiert, ${failed} nicht abrufbar` : "Preise aktualisiert");
}

/* ---------------------------------------------------- Seltenheit ----- */
/* Scryfall kennt sechs Stufen. Die Farben folgen den Symbolen auf der Karte:
   Silber, Gold, Orange. Unbekannte Werte (falls Wizards eine siebte Stufe
   einführt) erscheinen neutral statt zu verschwinden. */
const RARITY = {
  common:   { text: "Common",   farbe: "#b9bdc9" },
  uncommon: { text: "Uncommon", farbe: "#8fa3b8" },
  rare:     { text: "Rare",     farbe: "#c9a227" },
  mythic:   { text: "Mythic",   farbe: "#e0603a" },
  special:  { text: "Special",  farbe: "#a678c4" },
  bonus:    { text: "Bonus",    farbe: "#a678c4" },
};
function rarityPill(r) {
  if (!r) return "";
  const d = RARITY[r] || { text: r, farbe: "var(--dim)" };
  return `<span class="pill" style="border-color:${d.farbe};color:${d.farbe}">${esc(d.text)}</span>`;
}

/* ----------------------------------------------------- Sprache ------- */
/* Flaggen als eingebettetes SVG. Zwei Wege scheiden aus:
   * Emoji-Flaggen (🇩🇪) zeigt Windows NICHT — gemessen: die beiden Regional
     Indicators verschmelzen dort nicht zu einem Glyph, es erscheinen zwei
     Buchstabenkästen. Auf Benjamins Rechner wäre die Spalte also unbrauchbar.
   * Ein Flaggen-CDN wäre ein weiterer Fremdanbieter für etwas, das sich in
     wenigen Zeilen selbst zeichnen lässt und sich nie ändert.
   Einheitlich 3:2, damit die Spalte ruhig bleibt — echte Seitenverhältnisse
   schwanken (Union Jack 2:1, Japan 3:2), das fällt bei 14 px nicht auf.
   Eine Sprache ist kein Land; die Zuordnung folgt der in Magic üblichen:
   Englisch → Vereinigtes Königreich, Portugiesisch → Brasilien (dort werden
   die portugiesischen Auflagen gedruckt). */
const FLAGGEN = {
  de: `<rect width="60" height="13.3" fill="#000"/><rect width="60" height="13.4" y="13.3" fill="#DD0000"/>
       <rect width="60" height="13.3" y="26.7" fill="#FFCE00"/>`,
  fr: `<rect width="20" height="40" fill="#002395"/><rect width="20" height="40" x="20" fill="#fff"/>
       <rect width="20" height="40" x="40" fill="#ED2939"/>`,
  it: `<rect width="20" height="40" fill="#009246"/><rect width="20" height="40" x="20" fill="#fff"/>
       <rect width="20" height="40" x="40" fill="#CE2B37"/>`,
  es: `<rect width="60" height="40" fill="#AA151B"/><rect width="60" height="20" y="10" fill="#F1BF00"/>`,
  ja: `<rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#BC002D"/>`,
  ru: `<rect width="60" height="13.3" fill="#fff"/><rect width="60" height="13.4" y="13.3" fill="#0039A6"/>
       <rect width="60" height="13.3" y="26.7" fill="#D52B1E"/>`,
  // Vereinfacht: der rote Schrägbalken sitzt hier mittig statt versetzt.
  // Bei 14 px ist der Unterschied nicht zu sehen, spart aber sechs Pfade.
  en: `<rect width="60" height="40" fill="#012169"/>
       <path d="M0,0 60,40 M60,0 0,40" stroke="#fff" stroke-width="8"/>
       <path d="M0,0 60,40 M60,0 0,40" stroke="#C8102E" stroke-width="4.8"/>
       <path d="M30,0 V40 M0,20 H60" stroke="#fff" stroke-width="13.3"/>
       <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" stroke-width="8"/>`,
  // Vereinfacht: ohne Sternbild und Spruchband — bei 14 px unsichtbar.
  pt: `<rect width="60" height="40" fill="#009C3B"/>
       <path d="M30,4 56,20 30,36 4,20Z" fill="#FFDF00"/><circle cx="30" cy="20" r="7" fill="#002776"/>`,
  /* Phyrexianisch hat kein Land und damit keine Flagge — aber ein Wappen:
     das Phyrexia-Zeichen. Nach Benjamins Vorlage gezeichnet, nicht von
     Scryfall geliehen: dort gibt es das Zeichen nur eingebettet in farbige
     Manasymbole ({W/P} & Co.), und {P} allein ist laut Symbologie ein
     "modal budget pawprint" — eine Pfote.
     Der Ring ist links dicker als rechts; das macht der nach rechts
     versetzte innere Kreis. Der Strich steht oben und unten über. */
  ph: `<rect width="60" height="40" fill="#333"/>
       <circle cx="30" cy="20" r="15" fill="#fff"/>
       <circle cx="31.4" cy="20" r="10.2" fill="#333"/>
       <rect x="28.8" y="1.5" width="2.4" height="37" fill="#fff"/>`,
  // Vereinfacht: Taegeuk als zwei Halbkreise, Trigramme als vier Balken.
  ko: `<rect width="60" height="40" fill="#fff"/>
       <path d="M30,10a10,10 0 0,1 0,20a10,10 0 0,1 0,-20Z" fill="#CD2E3A"/>
       <path d="M30,30a10,10 0 0,1 0,-20a5,5 0 0,1 0,10a5,5 0 0,0 0,10Z" fill="#0047A0"/>
       <g fill="#000"><rect x="6" y="7" width="10" height="1.8"/><rect x="6" y="10" width="10" height="1.8"/>
       <rect x="44" y="7" width="10" height="1.8"/><rect x="44" y="10" width="10" height="1.8"/>
       <rect x="6" y="29" width="10" height="1.8"/><rect x="6" y="32" width="10" height="1.8"/>
       <rect x="44" y="29" width="10" height="1.8"/><rect x="44" y="32" width="10" height="1.8"/></g>`,
};

/* Nur die Flagge, oder "" wenn wir den Code nicht kennen.
   Steht der Klartextname daneben (Detailansicht), ist die Flagge bloß
   Schmuck und wird stummgeschaltet — sonst liest ein Screenreader
   "Deutsch Deutsch". Steht sie allein (Tabellenspalte), trägt sie den Namen
   in aria-label und title: eine Flagge ohne Text ist für Screenreader
   wertlos, und nicht jeder erkennt jede. */
function flaggeHtml(lang, dekorativ = false) {
  const l = (lang || "").toLowerCase();
  const f = FLAGGEN[l];
  if (!f) return "";
  if (dekorativ)
    return `<svg class="flagge" viewBox="0 0 60 40" aria-hidden="true">${f}</svg>`;
  const name = LANG_NAMES[l] || l.toUpperCase();
  return `<svg class="flagge" viewBox="0 0 60 40" role="img"
               aria-label="${esc(name)}"><title>${esc(name)}</title>${f}</svg>`;
}

/* Die Sprache für die Tabellenspalte. Drei Fälle, und sie auseinanderzuhalten
   ist der Punkt:
   1. Sprache mit Flagge (oder Wappen, siehe Phyrexianisch) → Bild.
   2. Sprache OHNE Bild (Chinesisch, dessen Flaggen noch keiner gebraucht
      hat) → neutrale Pille mit dem Code. Die Angabe ist richtig, uns fehlt
      nur das Bild. Eine geratene Flagge wäre hier falsch, eine rote
      Fehlerpille eine Lüge über die Daten.
   3. Kein Scryfall-Code (z. B. das ungültige "JP") → rote Pille. Hier stimmt
      wirklich etwas nicht, und das soll man sehen. */
function langHtml(lang) {
  const l = (lang || "").toLowerCase();
  const flagge = flaggeHtml(l);
  if (flagge) return flagge;
  const name = LANG_NAMES[l];
  if (name) return `<span class="pill" title="${esc(name)} — dafür haben wir keine Flagge"
                          >${esc(l.toUpperCase())}</span>`;
  return `<span class="pill err" title="Kein Scryfall-Sprachcode: ${esc(l.toUpperCase())}"
                >${esc(l.toUpperCase() || "?")}</span>`;
}

/* --------------------------------------------------- Manakosten ------ */
/* Scryfall liefert die Kosten als Zeichenkette ("{2}{G/W}{X}") und hostet zu
   jedem Symbol ein SVG. Im Dateinamen entfallen Klammern und Schrägstrich:
   {G/W} → GW, {2} → 2, {G/P} → GP.
   Warum nicht selbst in CSS zeichnen: Hybrid- und Phyrexia-Mana sind geteilte
   Kreise mit zwei Zeichen darin — das SVG ist die richtige Darstellung und
   kommt von derselben CDN wie die Kartenbilder. Fällt sie aus, bleibt das
   alt-Attribut ("{G}") lesbar stehen.
   Alles ausserhalb der Klammern (bei geteilten Karten das " // ") wird
   escaped durchgereicht, nicht als HTML. */
function mitSymbolen(text) {
  const re = /\{([^}]+)\}/g;
  let out = "", last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const datei = encodeURIComponent(m[1].replace(/\//g, "").toUpperCase());
    const roh = `{${m[1]}}`;
    out += `<img class="mana" src="https://svgs.scryfall.io/card-symbols/${datei}.svg"
                 alt="${esc(roh)}" title="${esc(roh)}" loading="lazy">`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function manaHtml(cost) {
  return cost ? mitSymbolen(cost) : "";   // "" = kostet nichts, null = unbekannt
}

/* ------------------------------------------- Karten-Detailansicht ---- */
/* Erscheinungsdatum ("2023-08-04" → "04.08.2023"). Bewusst per split statt
   new Date(): "2023-08-04" gilt als UTC-Mitternacht, und toLocaleDateString
   rechnet in die Ortszeit um — westlich von Greenwich stünde dort der 3.
   August. Ein reines Datum hat keine Uhrzeit, also wird es auch nicht
   umgerechnet, sondern nur umsortiert. */
const datShort = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};

const dtShort = iso => {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

/* Preisverlauf als richtiger Graph: Gitterlinien mit Eurowerten, Datum an
   den Enden, ein Punkt pro Tag (bis 60, so weit reicht die Historie).
   Grün bei gestiegenem, rot bei gefallenem Kurs — wie die Mini-Kurve. */
function priceChart(hist, w = 560, h = 200) {
  const H = (hist || []).map(p => ({ d: p.d, v: Number(p.v) })).filter(p => !isNaN(p.v));
  if (!H.length) return '<p class="hint">Noch keine Preishistorie — sie wächst mit jedem Preis-Update um einen Punkt pro Tag.</p>';
  const pl = w > 400 ? 62 : 54, pr = 14, pt = 12, pb = 26;
  let min = Math.min(...H.map(p => p.v)), max = Math.max(...H.map(p => p.v));
  if (min === max) { const d = Math.max(0.05, min * 0.1); min -= d; max += d; }
  const X = i => H.length === 1 ? pl + (w - pl - pr) / 2 : pl + i * (w - pl - pr) / (H.length - 1);
  const Y = v => pt + (h - pt - pb) * (1 - (v - min) / (max - min));
  const fmtD = s => s ? s.slice(8, 10) + "." + s.slice(5, 7) + "." : "";
  const farbe = H[H.length - 1].v >= H[0].v ? "var(--ok)" : "var(--err)";
  const ticks = [min, (min + max) / 2, max];
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${ticks.map(v => `<line x1="${pl}" y1="${Y(v).toFixed(1)}" x2="${w - pr}" y2="${Y(v).toFixed(1)}"
        stroke="var(--line)" stroke-width="1"/>
      <text x="${pl - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11"
        fill="var(--dim)">${eur(v)}</text>`).join("")}
    ${H.length > 1 ? `<polyline points="${H.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}"
        fill="none" stroke="${farbe}" stroke-width="2"/>` : ""}
    ${H.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}"
        r="${H.length > 30 ? 2 : 3.5}" fill="${farbe}"><title>${p.d}: ${eur(p.v)}</title></circle>`).join("")}
    <text x="${pl}" y="${h - 6}" font-size="11" fill="var(--dim)">${fmtD(H[0].d)}</text>
    <text x="${w - pr}" y="${h - 6}" text-anchor="end" font-size="11" fill="var(--dim)">${fmtD(H[H.length - 1].d)}</text>
  </svg>`;
}

/* ---------------------------------------------------- Fähigkeiten ---- */
/* Scryfall liefert Fähigkeiten NICHT als Name/Typ/Kosten — nur die keywords-
   Liste und den vollen oracle_text. Diese Funktion zerlegt den Regeltext
   heuristisch in Zeilen und rät je Zeile den Typ; die Namen der
   Schlüsselwörter kommen dagegen aus der verbürgten keywords-Liste, nicht aus
   dem Raten. Das Ergebnis ist ausdrücklich "automatisch bestimmt" und kann bei
   Sonderfällen (Erinnerungstext, mehrzeilige Fähigkeiten) danebenliegen —
   deshalb steht der volle Regeltext unverändert darüber.
   Reihenfolge der Prüfung ist Absicht: Loyalität und Schlüsselwort zuerst,
   damit ihre Doppelpunkte/Muster nicht als aktivierte Fähigkeit durchgehen. */
function parseAbilities(text, keywords) {
  if (text == null) return null;
  const kw = keywords || [];
  return text.split("\n").map(z => z.trim()).filter(Boolean).map(z => {
    // Loyalität: +N / −N / −X / 0. Scryfall nutzt das echte Minus (U+2212).
    let m = z.match(/^([+−][0-9X]+|0):\s+(.+)$/);
    if (m) return { typ: "Loyalität", name: "", kosten: m[1], effekt: m[2] };

    // Schlüsselwort: das erste Wort steht in der verbürgten Liste. Wert wie
    // "Ward {2}" wird als Kosten mitgenommen, Erinnerungstext als Wirkung.
    const ohneKlammer = z.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const treffer = kw.find(k => {
      const l = ohneKlammer.toLowerCase(), n = k.toLowerCase();
      return l === n || l.startsWith(n + " ") || l.startsWith(n + ",");
    });
    if (treffer && ohneKlammer.length < 40) {
      const symbole = ohneKlammer.match(/\{[^}]+\}/g);
      const rem = z.match(/\(([^)]*)\)\s*$/);
      return { typ: "Schlüsselwort", name: treffer,
               kosten: symbole ? symbole.join("") : "",
               effekt: rem ? rem[1] : "" };
    }

    // Aktiviert: "Kosten: Wirkung" — Kosten müssen wie Kosten aussehen (Symbol
    // oder ein einleitendes Kostenwort), sonst faengt die Regel Saetze mit
    // Doppelpunkt fälschlich ab.
    m = z.match(/^([^:]{1,60}):\s+(.+)$/);
    if (m && (/\{[^}]+\}/.test(m[1]) ||
              /^(Tap|Untap|Sacrifice|Discard|Pay|Exile|Remove|Return|Reveal)\b/i.test(m[1])))
      return { typ: "Aktiviert", name: "", kosten: m[1].trim(), effekt: m[2] };

    // Ausgelöst
    if (/^(When|Whenever|At )/i.test(z)) return { typ: "Ausgelöst", name: "", kosten: "", effekt: z };

    return { typ: "Statisch", name: "", kosten: "", effekt: z };
  });
}

/* Fähigkeiten-Block für die Detailansicht: verbürgte Schlüsselwörter als Tags,
   der volle Regeltext (mit Symbolen), und — nur im Dialog, eingeklappt — die
   geratene Aufschlüsselung. Die Reihenfolge ist die Ehrlichkeit: was Scryfall
   sagt, steht offen; was wir raten, liegt unter einem Klick. */
function faehigkeitenHtml(c, kompakt) {
  const teile = [];
  if (Array.isArray(c.keywords) && c.keywords.length)
    teile.push(`<div class="kw-tags">${c.keywords.map(k => `<span class="pill">${esc(k)}</span>`).join("")}</div>`);
  if (c.oracle_text)
    teile.push(`<div class="regeltext">${mitSymbolen(c.oracle_text)}</div>`);
  if (!kompakt && c.oracle_text) {
    const ab = parseAbilities(c.oracle_text, c.keywords) || [];
    if (ab.length) teile.push(`
      <details class="faehig">
        <summary>Aufgeschlüsselt <span class="hint" style="display:inline">(automatisch bestimmt)</span></summary>
        <table class="faehig-tbl"><thead><tr>
          <th>Name</th><th>Typ</th><th>Kosten</th><th>Wirkung</th></tr></thead>
        <tbody>${ab.map(a => `<tr>
          <td>${a.name ? esc(a.name) : "—"}</td>
          <td>${esc(a.typ)}</td>
          <td class="num" style="white-space:nowrap">${a.kosten ? mitSymbolen(a.kosten) : "—"}</td>
          <td>${a.effekt ? mitSymbolen(a.effekt) : "—"}</td></tr>`).join("")}</tbody></table>
      </details>`);
  }
  if (!teile.length) return "";
  return `<div style="margin-top:10px"><label style="margin-bottom:4px">Fähigkeiten</label>${teile.join("")}</div>`;
}

/* Gemeinsame Vorlage für Dialog und Hover-Vorschau. Der Preisgraph sitzt in
   der rechten Spalte unter dem Hinzugefügt-Datum — kompakt (320er-viewBox),
   damit die Beschriftung beim Skalieren lesbar bleibt. */
function detailHtml(c, hover) {
  // Scryfall-Bild-URLs tragen die Größe im Pfad — aus small wird normal
  // (488×680), ohne einen weiteren API-Aufruf.
  const gross = (c.img || "").replace("/small/", "/normal/");
  return `
    <div class="detail">
      ${gross ? `<img class="detail-img" src="${esc(gross)}" alt="">` : ""}
      <div class="detail-info">
        <div class="name-zeile"><b style="font-size:17px">${esc(c.disp)}</b>${c.mana_cost
          ? `<span class="mana-kosten">${manaHtml(c.mana_cost)}</span>` : ""}</div>
        ${c.printed_name && c.printed_name !== c.name ? `<div class="hint" style="margin:0">${esc(c.name)}</div>` : ""}
        <div class="hint" style="margin-top:2px">${esc(c.set_name || c.set)} · #${esc(c.cn)}${
          c.released ? ` · erschienen ${esc(datShort(c.released))}` : ""}</div>
        ${c.type_line ? `<div class="hint" style="margin-top:2px">${esc(c.type_line)}</div>` : ""}
        ${faehigkeitenHtml(c, hover)}
        <div style="margin:10px 0">
          ${rarityPill(c.rarity)}
          ${c.foil ? '<span class="pill foil">Foil</span> ' : ""}
          <span class="pill">${flaggeHtml(c.lang, true)} ${esc(LANG_NAMES[c.lang]
            || (c.lang || "").toUpperCase() || "?")}</span>
          <span class="pill">${esc(c.condition || "")}</span>
          <span class="pill">Anzahl ${c.qty}</span>
        </div>
        <div>Preis: <b>${eur(c.price)}</b></div>
        ${!hover ? `<div style="margin-top:8px">
          ${cmLink(c.cm_id) ? `<a class="cm" href="${esc(cmLink(c.cm_id))}" target="_blank"
            rel="noopener noreferrer" title="Angebote auf Cardmarket">CM</a> ` : ""}
          ${sfLink(c) ? `<a class="cm" href="${esc(sfLink(c))}" target="_blank"
            rel="noopener noreferrer" title="Kartentext und alle Auflagen auf Scryfall">SF</a>` : ""}
        </div>
        <div class="row" style="margin-top:10px">
          <div style="flex:none"><button class="btn ghost sm" id="dt-edit"
            title="Sprache, Zustand oder Ausführung ändern">&#9998; Bearbeiten</button></div>
          <div style="flex:none"><button class="btn ghost sm" id="dt-price"
            title="Preis neu von Scryfall holen">&#8635; Preis</button></div>
        </div>` : ""}
        <div class="hint" style="margin-top:10px">Hinzugefügt: ${dtShort(c.added)} Uhr</div>
        <div style="margin-top:10px">
          <label style="margin-bottom:2px">Preisverlauf</label>
          ${priceChart(c.hist, 320, 150)}
        </div>
      </div>
    </div>`;
}

function showCardDetail(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  $("#detail-body").innerHTML = detailHtml(c, false);
  $("#detail-dlg").showModal();

  // Erst schließen, dann bearbeiten: zwei gestapelte Dialoge wären fragil.
  $("#dt-edit").onclick = () => { $("#detail-dlg").close(); editCard(id); };
  const pb = $("#dt-price");
  pb.onclick = async () => {
    pb.disabled = true;
    try {
      const p = await preisNeuZiehen(c);
      await reload(); renderAll();
      toast(p == null ? "Scryfall führt keinen Preis für diese Auflage" : "Preis aktualisiert: " + eur(p));
      // Ansicht mit dem frischen Preis und dem neuen Kurvenpunkt neu zeichnen.
      if ($("#detail-dlg").open) showCardDetail(id);
    } catch (e) { pb.disabled = false; toast(e.message); }
  };
}

/* Hover-Vorschau: dieselben Details schweben neben dem Mauszeiger, ohne
   Klick. Nur auf Geräten mit echtem Hover — auf dem Handy bleibt der Tipp
   aufs Bild bzw. den Namen der Weg zur Detailansicht. */
const HOVER_OK = matchMedia("(hover: hover)").matches;
let hoverTimer = null;

function hideHover() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  const hc = $("#hovercard");
  if (hc) hc.style.display = "none";
}

function showHover(id, x, y) {
  const c = CARDS.find(k => k.id === id);
  if (!c) return;
  const hc = $("#hovercard");
  hc.innerHTML = detailHtml(c, true);
  hc.style.left = "0px"; hc.style.top = "0px";   // erst einblenden, dann messen
  hc.style.display = "block";
  const r = hc.getBoundingClientRect();
  let links = x + 18, oben = y + 14;
  if (links + r.width > innerWidth - 8) links = Math.max(8, x - r.width - 18);
  if (oben + r.height > innerHeight - 8) oben = Math.max(8, innerHeight - r.height - 8);
  hc.style.left = links + "px";
  hc.style.top = oben + "px";
}

/* ---------------------------------------------- Karte bearbeiten ----- */
async function editCard(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  const langs = LANG_NAMES[c.lang] ? Object.keys(LANG_NAMES) : [c.lang, ...Object.keys(LANG_NAMES)];
  const CONDS = ["NM", "LP", "MP", "HP", "DMG"];
  const ok = await confirmDlg(`
    <b>${esc(c.disp)}</b>
    <p class="hint" style="margin:2px 0 10px">${esc(c.set_name || c.set)} · #${esc(c.cn)} · Anzahl ${c.qty}</p>
    <div class="row" style="margin-bottom:8px">
      <div><label>Set-Code</label><input type="text" id="ed-set" value="${esc(c.set || "")}"
        style="text-transform:uppercase" placeholder="MKM"></div>
      <div><label>Nummer</label><input type="text" id="ed-cn" value="${esc(c.cn || "")}" placeholder="8"></div>
    </div>
    <div class="row">
      <div><label>Sprache</label><select id="ed-lang">${langs.map(l =>
        `<option value="${esc(l)}"${l === c.lang ? " selected" : ""}>${esc(LANG_NAMES[l] || l)}</option>`).join("")}</select></div>
      <div><label>Zustand</label><select id="ed-cond">${CONDS.map(x =>
        `<option${x === c.condition ? " selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label>Ausführung</label><select id="ed-foil">
        <option value="0"${!c.foil ? " selected" : ""}>Normal</option>
        <option value="1"${c.foil ? " selected" : ""}>Foil</option></select></div>
    </div>
    <p class="hint">Geänderter Set-Code oder Nummer löst die Karte neu auf — Name, Bild und Preis
      kommen dann von der neuen Auflage; Anzahl, Zustand und Deck-Zuordnung bleiben.
      Bei Tokens beginnt der Set-Code mit T (z.&nbsp;B. TFIN), bei Promos mit P (PEMN).
      Gibt es dieselbe Karte in der Ziel-Ausprägung schon, werden die Anzahlen zusammengelegt.</p>`);
  if (!ok) return;
  const lang = $("#ed-lang").value, cond = $("#ed-cond").value, foil = $("#ed-foil").value === "1";
  const setIn = $("#ed-set").value.trim().toUpperCase();
  const cnIn  = $("#ed-cn").value.trim();
  const auflageNeu = setIn !== (c.set || "").toUpperCase() || cnIn !== String(c.cn || "");
  if (!auflageNeu && lang === c.lang && cond === c.condition && foil === c.foil) return;
  if (auflageNeu && (!setIn || !cnIn)) return toast("Set-Code und Nummer dürfen nicht leer sein");
  try { await applyCardEdit(c, lang, cond, foil, auflageNeu ? { set: setIn, cn: cnIn } : null); }
  catch (e) { toast(e.message); }
}

async function applyCardEdit(c, lang, cond, foil, neu) {
  const patch = { lang, condition: cond, foil };

  let fresh = null;
  if (neu) {
    // Andere Auflage: komplett neu auflösen. findByCode probiert den Code
    // wörtlich und mit t-Präfix, tippt man TFIN direkt ein, trifft es sofort.
    fresh = await findByCode(neu.set, neu.cn, lang, false);
    if (!fresh) throw new Error(`${neu.set} #${neu.cn} bei Scryfall nicht gefunden`);
    patch.scryfall_id = fresh.id;
    patch.name = fresh.name;
    patch.printed_name = fresh.printed_name || null;
    patch.set_code = (fresh.set || "").toUpperCase();
    patch.set_name = fresh.set_name;
    patch.cn = fresh.collector_number;
    patch.img = imgOf(fresh);
    patch.cm_id = fresh.cardmarket_id ?? null;
    patch.type_line = fresh.type_line ?? null;
    // Dieselbe Karte kann je Auflage anders selten sein — mitziehen.
    patch.rarity = fresh.rarity ?? null;
    patch.mana_cost = manaOf(fresh);
    patch.cmc = fresh.cmc ?? null;
    // Andere Auflage = anderes Set = anderes Erscheinungsdatum.
    patch.released = fresh.released_at ?? null;
    patch.colors = farbenOf(fresh);
    patch.keywords = keywordsOf(fresh);
    patch.oracle_text = oracleOf(fresh);
  } else if (lang !== c.lang) {
    // Sprachwechsel: die sprachgenaue Auflage hat eine eigene Scryfall-ID,
    // eigenen gedruckten Namen und eigenes Bild. Gibt es sie nicht (viele
    // Karten führt Scryfall nur englisch), bleibt die bisherige Auflage
    // stehen und nur das Sprachfeld wechselt.
    fresh = await withPrice(await sfCode(c.set, c.cn, lang));
    if (fresh) {
      patch.scryfall_id = fresh.id;
      patch.printed_name = fresh.printed_name || null;
      patch.img = imgOf(fresh) || c.img;
      patch.cm_id = fresh.cardmarket_id ?? c.cm_id;
    }
  }

  // Andere Ausführung oder andere Auflage → Preis passend dazu, Historie
  // beginnt neu (die alte gehörte zur anderen Ausprägung).
  if (foil !== c.foil || fresh) {
    const src = fresh || await withPrice(await sfById(c.scryfall_id));
    if (src) {
      const p = priceOf(src, foil);
      patch.price = p;
      patch.hist = p == null ? [] : [{ d: today(), v: p }];
    }
  }

  // Kollidiert die Ziel-Ausprägung mit einer vorhandenen Zeile, wird
  // zusammengelegt: Anzahl addieren, Deck-Einträge umhängen, alte Zeile weg.
  const sid = patch.scryfall_id || c.scryfall_id;
  const twin = CARDS.find(x => x.id !== c.id && x.scryfall_id === sid &&
                               x.lang === lang && x.condition === cond && x.foil === foil);
  if (twin) {
    const up = await sb.from("cards").update({ qty: twin.qty + c.qty }).eq("id", twin.id);
    if (up.error) throw new Error(dbErr(up.error));
    const de = await sb.from("deck_entries").select("*").eq("card_id", c.id);
    for (const en of (de.data || [])) {
      const ex = await sb.from("deck_entries").select("qty")
        .eq("deck_id", en.deck_id).eq("card_id", twin.id).maybeSingle();
      const merge = await sb.from("deck_entries").upsert(
        [{ deck_id: en.deck_id, card_id: twin.id, qty: (ex.data?.qty || 0) + en.qty }],
        { onConflict: "deck_id,card_id" });
      if (!merge.error)
        await sb.from("deck_entries").delete().eq("deck_id", en.deck_id).eq("card_id", c.id);
    }
    const del = await sb.from("cards").delete().eq("id", c.id);
    if (del.error) throw new Error(dbErr(del.error));
    toast(`Mit vorhandener Zeile zusammengelegt — Anzahl jetzt ${twin.qty + c.qty}`);
  } else {
    const { error } = await sb.from("cards").update(patch).eq("id", c.id);
    if (error) throw new Error(dbErr(error));
    toast(neu
      ? `Jetzt: ${fresh.printed_name || fresh.name} · ${patch.set_code} #${patch.cn}`
      : "Karte aktualisiert");
  }
  await reload(); renderAll();
}

/* ============================= Decks-Ansicht ==========================
   Der Auf-/Zuklapp-Zustand ist reine Ansichtssache und bleibt deshalb im
   Browser, nicht in der Datenbank — auf dem Handy will man andere Decks
   offen haben als am großen Bildschirm. Voreinstellung: zugeklappt, sonst
   scrollt man bei 90 Karten pro Deck ewig. */
const deckOffen = {
  lies() { try { return new Set(JSON.parse(localStorage.getItem("mtg-decks-offen") || "[]")); }
           catch { return new Set(); } },
  ist(id) { return this.lies().has(id); },
  schalte(id) {
    const s = this.lies();
    s.has(id) ? s.delete(id) : s.add(id);
    localStorage.setItem("mtg-decks-offen", JSON.stringify([...s]));
    return s.has(id);
  },
};

/* Welche Deck-Statistik gerade aufgeklappt ist. Nur im Speicher, nicht
   persistiert: die Statistik ist ein kurzer Blick, kein Dauerzustand wie das
   aufgeklappte Deck. Ein neuer Seitenaufruf startet ohne offene Dashboards. */
const deckDashOffen = new Set();

/* Filter der Deck-Ansicht nach Klassifizierung. Nur im Speicher wie die
   Statistik — ein neuer Seitenaufruf zeigt wieder alle Decks. "" heißt "egal". */
let deckFilter = { format: "", archetype: "" };

/* Klassifizierung der Decks. Festes Vokabular an einer Stelle, damit Anlegen,
   Bearbeiten und Filter dieselbe Liste teilen und nichts auseinanderläuft.
   Format = in welchem Rahmen gespielt wird, Archetyp = wie das Deck gewinnt.
   Reihenfolge ist Absicht (Geläufigstes zuerst); danach richtet sich auch die
   Sortierung im Filter. Frei lassbar — kein Deck MUSS eingeordnet sein. */
const DECK_FORMATE = ["Commander", "Standard", "Pioneer", "Modern", "Legacy",
                      "Vintage", "Pauper", "Draft", "Brawl", "Casual"];
const DECK_ARCHETYPEN = ["Aggro", "Midrange", "Control", "Combo", "Tempo",
                         "Ramp", "Tribal"];

/* <option>-Liste für die Auswahlfelder. leer ist die erste, wertlose Option
   ("—" im Formular für „nicht eingeordnet", "Alle …" im Filter); sel wird
   vorausgewählt. */
const deckOptions = (werte, sel, leer) =>
  `<option value="">${esc(leer)}</option>` +
  werte.map(w => `<option value="${esc(w)}"${w === sel ? " selected" : ""}>${esc(w)}</option>`).join("");

/* Ein Commander muss eine legendäre Kreatur oder ein legendärer Planeswalker
   sein — legendäre Artefakte, Länder und Hexereien zählen nicht.

   Geprüft wird nur die Vorderseite (alles vor "//"): mit ihr startet der
   Commander. "Legendary Enchantment — Aura // Legendary Land" ist deshalb
   keiner, "Legendary Artifact Creature — Wizard" (Memnarch) dagegen schon.

   Scryfalls type_line ist immer englisch, auch bei deutschen Auflagen —
   deshalb prüfen diese Wörter sprachunabhängig. Karten ohne bekannte
   Typzeile fallen durch: nicht raten.

   Dieselbe Regel erzwingt ein Trigger in der Datenbank; hier steuert sie
   nur, ob der Stern überhaupt erscheint. */
const istCommanderFaehig = c => {
  const vorderseite = (c?.type_line || "").split("//")[0];
  return /legendary/i.test(vorderseite) &&
         /creature|planeswalker/i.test(vorderseite);
};

async function setMainCard(deckId, cardId) {
  const d = DECKS.find(x => x.id === deckId);
  // Nochmal auf dieselbe Karte: Hauptkarte wieder abwählen.
  const neu = d?.main_card_id === cardId ? null : cardId;
  const { error } = await sb.from("decks").update({ main_card_id: neu }).eq("id", deckId);
  if (error) {
    // Fehlt die Spalte, ist das Schema älter als die App.
    if (error.code === "42703" || /main_card_id/.test(error.message || ""))
      return toast("Spalte fehlt — bitte supabase-schema.sql neu ausführen.");
    // Der Trigger lehnt ungeeignete Karten ab; seine Meldung ist bereits
    // für Menschen geschrieben, also unverändert durchreichen. (Sie enthält
    // selbst einen Doppelpunkt — ein Präfix-Abschneider fräße den halben Satz.)
    if (error.code === "23514" || /legendär|Typzeile|Hauptkarte/i.test(error.message || ""))
      return toast(error.message);
    return toast(dbErr(error));
  }
  await reload(); renderDecks();
  toast(neu ? "Als Hauptkarte gesetzt" : "Hauptkarte entfernt");
}

/* ============================= Decks-Ansicht ========================== */
/* Deck bearbeiten: Name und Klassifizierung (Format, Archetyp) in einem
   Dialog. Wie beim Anlegen wird der Name getrimmt und darf nicht leer sein;
   Format und Archetyp sind frei lassbar ("" wird zu NULL). Hat sich nichts
   geändert, wird gar nicht erst geschrieben — OK ohne Änderung tut nichts.
   Name und Einordnung gehören dem Deck, nicht seinen Karten: die Zuordnungen
   hängen an der Deck-ID und bleiben unberührt. */
async function editDeck(id) {
  const d = DECKS.find(x => x.id === id);
  if (!d) return;
  const ok = await confirmDlg(`
    <b>Deck bearbeiten</b>
    <div style="margin-top:10px">
      <label>Name</label>
      <input type="text" id="dn-name" value="${esc(d.name)}" autofocus>
    </div>
    <div class="row" style="margin-top:10px">
      <div><label>Format</label><select id="dn-format">${deckOptions(DECK_FORMATE, d.format, "—")}</select></div>
      <div><label>Archetyp</label><select id="dn-arch">${deckOptions(DECK_ARCHETYPEN, d.archetype, "—")}</select></div>
    </div>
    <p class="hint">Die Karten im Deck bleiben unverändert.</p>`);
  if (!ok) return;
  const name = $("#dn-name").value.trim();
  if (!name) return toast("Bitte einen Decknamen eingeben");
  const format    = $("#dn-format").value || null;
  const archetype = $("#dn-arch").value   || null;
  // Nichts geändert? Dann nicht schreiben. NULL und "" gelten als gleich.
  if (name === d.name && format === (d.format || null) && archetype === (d.archetype || null)) return;
  try {
    const { error } = await sb.from("decks").update({ name, format, archetype }).eq("id", d.id);
    if (error) throw error;
    await reload(); renderDecks();
    toast("Deck gespeichert");
  } catch (e) { toast(dbErr(e)); }
}

/* Füllt die Filterleiste der Deck-Ansicht und blendet sie ein oder aus.
   Angeboten werden nur TATSÄCHLICH vergebene Werte (in kanonischer
   Reihenfolge) — man soll nicht auf ein Format filtern können, das kein Deck
   trägt. Kein Filter, wenn kaum etwas zu filtern ist: unter zwei Decks oder
   solange nichts eingeordnet ist. In beiden Fällen wird ein etwaiger Filter
   geräumt, sonst versteckte er die sichtbaren Decks heimlich. */
function deckFilterUi() {
  const karte = $("#deck-filter");
  if (!karte) return;
  const inGebrauch = (feld, reihenfolge) =>
    [...new Set(DECKS.map(d => d[feld]).filter(Boolean))]
      .sort((a, b) => reihenfolge.indexOf(a) - reihenfolge.indexOf(b));
  const fmt = inGebrauch("format", DECK_FORMATE);
  const arc = inGebrauch("archetype", DECK_ARCHETYPEN);
  if (DECKS.length < 2 || (!fmt.length && !arc.length)) {
    deckFilter = { format: "", archetype: "" };
    karte.style.display = "none";
    return;
  }
  // Ein weggefallener Wert (letztes Deck dieses Formats gelöscht oder
  // umklassiert) darf nicht als toter Filter hängenbleiben.
  if (deckFilter.format && !fmt.includes(deckFilter.format)) deckFilter.format = "";
  if (deckFilter.archetype && !arc.includes(deckFilter.archetype)) deckFilter.archetype = "";
  const ff = $("#fd-format"), fa = $("#fd-arch");
  ff.innerHTML = deckOptions(fmt, deckFilter.format, "Alle Formate");
  fa.innerHTML = deckOptions(arc, deckFilter.archetype, "Alle Archetypen");
  ff.onchange = () => { deckFilter.format = ff.value; renderDecks(); };
  fa.onchange = () => { deckFilter.archetype = fa.value; renderDecks(); };
  karte.style.display = "";
}

function renderDecks() {
  if (!DECKS.length) {
    $("#deck-list").innerHTML = '<div class="card"><div class="empty">Noch keine Decks angelegt.</div></div>';
    deckFilterUi();
    return;
  }
  deckFilterUi();
  // Nach der Klassifizierung filtern (leerer Filter = alle Decks). Die
  // Filterleiste sitzt in einer eigenen Karte darüber; deckFilterUi() füllt
  // ihre Auswahlfelder und blendet sie ein, sobald es etwas zu filtern gibt.
  const sichtbar = DECKS.filter(d =>
    (!deckFilter.format    || d.format    === deckFilter.format) &&
    (!deckFilter.archetype || d.archetype === deckFilter.archetype));

  // Für jedes Deck mit offener Statistik die Karten mit ihrer DECKMENGE als
  // qty — damit renderDash die Deckmenge zählt, nicht den Sammlungsbestand.
  // Nach dem Einhängen der HTML gefüllt, weil renderDash in ein reales
  // Element schreibt.
  const deckDashRows = new Map();
  const html = sichtbar.map(d => {
    // Nach Namen sortiert wie die Sammlung in ihrer Voreinstellung, bis
    // jemand eine Spaltenüberschrift dieses Decks anklickt.
    const ds = deckSort[d.id] ||= { key: "name", dir: 1 };
    const eintraege = d.entries
      .map(e => ({ e, c: CARDS.find(x => x.id === e.cardId) }))
      .filter(x => x.c)
      .sort((a, b) => cmpWert(sortWert(ds.key, a.c, a.e),
                              sortWert(ds.key, b.c, b.e), ds.dir));
    const rows = eintraege.map(({ e, c }) => cardRow(c, {
      deckId: d.id, qty: e.qty, istHaupt: d.main_card_id === c.id })).join("");

    const n = eintraege.reduce((s, x) => s + x.e.qty, 0);
    const v = eintraege.reduce((s, x) => s + (x.c.price || 0) * x.e.qty, 0);
    const fehlt = eintraege.filter(x => x.e.qty > x.c.qty).length;
    const offen = deckOffen.ist(d.id);
    const dashOffen = deckDashOffen.has(d.id);
    if (dashOffen) deckDashRows.set(d.id, eintraege.map(({ e, c }) => ({ ...c, qty: e.qty })));
    const haupt = d.main_card_id ? CARDS.find(c => c.id === d.main_card_id) : null;

    return `<div class="card">
      <div class="deck-kopf" data-toggle="${d.id}" title="${offen ? "Zuklappen" : "Aufklappen"}">
        <span class="deck-pfeil">${offen ? "&#9660;" : "&#9654;"}</span>
        ${haupt?.img ? `<img class="deck-haupt" src="${esc(haupt.img)}" alt=""
             title="Hauptkarte: ${esc(haupt.disp)}">` : ""}
        <div style="flex:1;min-width:0">
          <h3 style="margin:0">${esc(d.name)}</h3>
          ${d.format || d.archetype ? `<div class="deck-tags">${
            d.format ? `<span class="pill fmt">${esc(d.format)}</span>` : ""}${
            d.archetype ? `<span class="pill">${esc(d.archetype)}</span>` : ""}</div>` : ""}
          <div class="hint" style="margin:2px 0 0">${n} Karten &middot; ${eur(v)}${
            fehlt ? ` &middot; <span style="color:var(--err)">${fehlt} unvollständig</span>` : ""}</div>
        </div>
        <button class="btn ghost sm" data-ded="${d.id}" style="flex:none"
          title="Deck bearbeiten">&#9998;</button>
        <button class="btn danger sm" data-dx="${d.id}" style="flex:none">Deck löschen</button>
      </div>
      <div class="deck-inhalt" style="display:${offen ? "block" : "none"}">
        <div class="row" style="margin-top:10px">
          <div class="sugg"><input type="text" data-dadd="${d.id}" placeholder="Karte aus der Sammlung hinzufügen…"></div>
          <div style="flex:none;min-width:80px"><input type="number" min="1" value="1" data-dqty="${d.id}"></div>
          ${rows ? `<div style="flex:none"><button class="btn ghost" data-dashtoggle="${d.id}"
            >&#128202; Statistik ${dashOffen ? "ausblenden" : "anzeigen"}</button></div>` : ""}
        </div>
        <div class="deck-dash" data-dash="${d.id}" style="margin-top:12px"></div>
        ${rows ? `<div class="xscroll" style="overflow-x:auto"><table class="deck-tbl" style="margin-top:10px">
                    <thead>${cardHead(true)}</thead><tbody>${rows}</tbody></table></div>`
               : '<div class="empty">Noch keine Karten in diesem Deck.</div>'}
      </div>
    </div>`;
  }).join("");
  // Bei aktivem Filter kann die Auswahl leer sein — dann ein Hinweis statt
  // einer blanken Fläche.
  $("#deck-list").innerHTML = html ||
    '<div class="card"><div class="empty">Kein Deck passt zum Filter.</div></div>';

  $$("#deck-list .deck-kopf").forEach(k => k.onclick = ev => {
    // Im Kopf sitzen Knöpfe (Umbenennen, Löschen) — ihr Klick darf nicht
    // zuklappen. Bewusst alle Knöpfe statt einer Liste einzelner Auswahlen:
    // die wäre beim nächsten Knopf wieder unvollständig.
    if (ev.target.closest("button")) return;
    const offen = deckOffen.schalte(k.dataset.toggle);
    const karte = k.parentElement;
    karte.querySelector(".deck-inhalt").style.display = offen ? "block" : "none";
    k.querySelector(".deck-pfeil").innerHTML = offen ? "&#9660;" : "&#9654;";
    k.title = offen ? "Zuklappen" : "Aufklappen";
  });

  $$("#deck-list .deck-tbl").forEach(t => wireCardRows(t));

  // Offene Deck-Statistiken füllen. Erst jetzt, weil renderDash in ein
  // reales, sichtbares Element schreibt — der data-ans-ende-Trick braucht
  // die Breite des Kastens.
  deckDashRows.forEach((rows, id) => {
    const ziel = $(`.deck-dash[data-dash="${id}"]`);
    if (ziel) renderDash(rows, ziel, false);
  });

  $$("[data-dashtoggle]").forEach(b => b.onclick = () => {
    const id = b.dataset.dashtoggle;
    deckDashOffen.has(id) ? deckDashOffen.delete(id) : deckDashOffen.add(id);
    renderDecks();
  });

  // Sortier-Handler je Deck. renderDecks() baut alles neu, aber der
  // Auf-/Zugeklappt-Zustand hängt an deckOffen und übersteht das.
  $$("#deck-list .card").forEach(karte => {
    const deckId = karte.querySelector(".deck-kopf")?.dataset.toggle;
    if (!deckId) return;
    karte.querySelectorAll(".deck-tbl th[data-s]").forEach(th => th.onclick = () => {
      sortUm(deckSort[deckId], th.dataset.s);
      renderDecks();
    });
  });

  $$("[data-ded]").forEach(b => b.onclick = () => editDeck(b.dataset.ded));

  $$("[data-dx]").forEach(b => b.onclick = async () => {
    const d = DECKS.find(x => x.id === b.dataset.dx);
    if (!await confirmDlg(`<b>Deck „${esc(d.name)}“ löschen?</b>
      <p class="hint">Die Karten selbst bleiben in deiner Sammlung.</p>`)) return;
    try {
      const { error } = await sb.from("decks").delete().eq("id", d.id);
      if (error) throw error;
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); }
  });
  $$("[data-dadd]").forEach(inp => {
    attachLocalSuggest(inp);
    inp.addEventListener("deck-pick", async ev => {
      const deckId = inp.dataset.dadd;
      const d = DECKS.find(x => x.id === deckId);
      const add = Math.max(1, parseInt($(`[data-dqty="${deckId}"]`).value) || 1);
      const ex = d.entries.find(e => e.cardId === ev.detail);
      try {
        const { error } = await sb.from("deck_entries")
          .upsert({ deck_id: deckId, card_id: ev.detail, qty: (ex?.qty || 0) + add },
                  { onConflict: "deck_id,card_id" });
        if (error) throw error;
        await reload(); renderAll();
      } catch (e) { toast(dbErr(e)); }
    });
  });
}

/* Vorschläge aus der eigenen Sammlung (nicht aus Scryfall). */
function attachLocalSuggest(inp) {
  const box = inp.parentElement;
  let list = null;
  const close = () => { list?.remove(); list = null; };
  inp.addEventListener("input", () => {
    close();
    const v = inp.value.trim().toLowerCase();
    if (v.length < 2) return;
    const hits = CARDS.filter(c => c.name.toLowerCase().includes(v) ||
                                   c.disp.toLowerCase().includes(v)).slice(0, 8);
    if (!hits.length) return;
    list = document.createElement("ul");
    hits.forEach(c => {
      const li = document.createElement("li");
      li.textContent = `${c.disp} · ${c.set}${c.foil ? " · Foil" : ""} (${c.qty}×)`;
      li.onmousedown = e => {
        e.preventDefault(); inp.value = ""; close();
        inp.dispatchEvent(new CustomEvent("deck-pick", { detail: c.id }));
      };
      list.appendChild(li);
    });
    box.appendChild(list);
  });
  inp.addEventListener("blur", () => setTimeout(close, 150));
}

/* ============================ Export / Import ========================= */
function download(name, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

function exportCsv() {
  const head = ["Name", "Name (englisch)", "Set", "Set-Code", "Nummer", "Seltenheit",
                "Erschienen", "Typzeile", "Schlüsselwörter", "Regeltext",
                "Manakosten", "Manawert", "Sprache",
                "Zustand", "Foil", "Anzahl", "Preis EUR", "Wert EUR"];
  const rows = CARDS.map(c => [c.disp, c.name, c.set_name, c.set, c.cn, c.rarity ?? "",
    c.released ?? "", c.type_line ?? "", (c.keywords || []).join(", "), c.oracle_text ?? "",
    c.mana_cost ?? "", c.cmc ?? "", c.lang, c.condition,
    c.foil ? "ja" : "nein", c.qty, c.price ?? "",
    c.price == null ? "" : (c.price * c.qty).toFixed(2)]);
  download(`arcanum-archive-${today()}.csv`,
    "﻿" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n"), "text/csv");
}

/* Einspielen einer alten lokalen Sicherung (aus der IndexedDB-Fassung). */
async function importJson(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.cards)) throw new Error("Keine gültige Sicherungsdatei");
  if (!await confirmDlg(`<b>${data.cards.length} Karten einspielen?</b>
    <p class="hint">Sie werden zu deiner Sammlung <b>hinzugefügt</b>. Bereits vorhandene
    Karten erhöhen ihre Anzahl statt doppelt aufzutauchen.</p>`)) return;

  let ok = 0, bad = 0;
  for (const c of data.cards) {
    for (let i = 0; i < (c.qty || 1); i++) {
      const { error } = await sb.rpc("add_card", {
        p_scryfall_id: c.scryfall_id, p_oracle_id: c.oracle_id, p_name: c.name,
        p_printed_name: c.printed_name || null,
        p_set_code: c.set || c.set_code, p_set_name: c.set_name, p_cn: c.cn, p_img: c.img,
        p_cm_id: c.cm_id ?? null,
        p_lang: c.lang || "en", p_condition: c.condition || "NM",
        p_foil: !!c.foil, p_price: c.price ?? null,
        p_type_line: c.type_line ?? null, p_rarity: c.rarity ?? null,
        // Aus der Sicherung, nicht von Scryfall: hier stehen die Werte schon
        // fertig in der Zeile — manaOf() erwartet eine Scryfall-Karte.
        p_mana_cost: c.mana_cost ?? null, p_cmc: c.cmc ?? null,
        p_released: c.released ?? null, p_colors: c.colors ?? null,
        p_keywords: c.keywords ?? null, p_oracle_text: c.oracle_text ?? null
      });
      if (error) { bad++; break; } else ok++;
    }
  }
  await reload(); renderAll();
  toast(bad ? `${ok} Karten eingespielt, ${bad} fehlgeschlagen` : `${ok} Karten eingespielt`);
}

/* ==================== Import aus Mythic Tools (CSV) ===================
   Mythic Tools exportiert reichhaltiger als unser eigener Export: mit
   Scryfall-ID, Sprache, Finish und über die Container-Spalte sogar der
   Deck-Zuordnung. Wir werten das voll aus. */

/* CSV nach RFC 4180 zerlegen — Kartennamen und Set-Namen enthalten Kommas
   ("Warhammer 40,000 Commander", "Reyhan, Last of the Abzan"), deshalb kein
   naives split. Anführungszeichen schützen das Trennzeichen, "" ist ein
   literales ". */
function parseCsv(text, delim) {
  const s = text.replace(/^﻿/, "");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* Spalten über ihre Überschrift finden, nicht über die Position — so
   übersteht der Import eine geänderte Spaltenreihenfolge. */
const CSV_ALIASES = {
  name: ["card name", "name"],
  set_code: ["set code", "set-code"],
  cn: ["collector number", "nummer"],
  lang: ["language", "sprache"],
  qty: ["quantity", "anzahl"],
  condition: ["condition", "zustand"],
  finish: ["finish", "ausführung"],
  scryfall_id: ["scryfall id"],
  cname: ["container name"],
  ctype: ["container type"],
};
function csvColumns(header) {
  const H = header.map(h => h.trim().toLowerCase());
  const idx = {};
  for (const [key, al] of Object.entries(CSV_ALIASES)) idx[key] = H.findIndex(h => al.includes(h));
  return idx;
}

/* Eine CSV-Zeile zu einer Scryfall-Karte auflösen. Reihenfolge nach
   Zuverlässigkeit: die auflagen- und sprachgenaue ID zuerst; sonst Setcode +
   Nummer in der Kartensprache; sonst englisch (viele Karten gibt es bei
   Scryfall nur auf Englisch). Kein t-Präfix — der Import kennt keine Tokens. */
async function resolveImportCard(set_code, cn, lang, scryfall_id) {
  let card = null;
  if (scryfall_id) { try { card = await sfById(scryfall_id); } catch { /* weiter */ } }
  if (!card && set_code && cn) {
    const n = String(cn).replace(/^0+/, "") || "0";
    try { card = await sfCode(set_code, n, lang); } catch { /* weiter */ }
    if (!card && lang !== "en") { try { card = await sfCode(set_code, n, "en"); } catch { /* weiter */ } }
  }
  return card ? withPrice(card) : null;
}

async function importCsv(file) {
  const text = await file.text();
  // Trennzeichen erraten: Mythic Tools nutzt Komma, unser Export Semikolon.
  const first = text.replace(/^﻿/, "").split("\n")[0] || "";
  const delim = (first.split(";").length > first.split(",").length) ? ";" : ",";
  const rows = parseCsv(text, delim);
  if (rows.length < 2) throw new Error("Die Datei enthält keine Kartenzeilen.");

  const col = csvColumns(rows[0]);
  if (col.name < 0 || (col.scryfall_id < 0 && (col.set_code < 0 || col.cn < 0)))
    throw new Error("Unbekanntes CSV-Format — weder Scryfall-ID noch Setcode/Nummer gefunden.");

  const data = rows.slice(1).filter(r => r.some(c => c.trim()));
  const decks = col.cname >= 0
    ? [...new Set(data.map(r => (r[col.cname] || "").trim()).filter(Boolean))] : [];

  const ok = await confirmDlg(`<b>${data.length} Zeilen aus „${esc(file.name)}“ importieren?</b>
    <p class="hint">Karten werden zu deiner Sammlung hinzugefügt; bereits vorhandene
    werden <b>übersprungen</b>. Preise kommen frisch von Scryfall.
    ${decks.length ? `Angelegt wird außerdem das Deck „${esc(decks.join("“, „"))}“.` : ""}
    Das dauert einen Moment.</p>`);
  if (!ok) return;

  const box = $("#import-status");
  const say = h => { if (box) box.innerHTML = h; };

  // Was schon in der Sammlung ist, kennen wir. Key wie der Eindeutigkeits-
  // schlüssel der Datenbank, damit "überspringen" dieselbe Karte trifft.
  const key = (sid, foil, lang, cond) => `${sid}|${foil ? 1 : 0}|${lang}|${cond}`;
  const known = new Map();
  for (const c of CARDS) known.set(key(c.scryfall_id, c.foil, c.lang, c.condition), c.id);

  const CONDS = ["NM", "LP", "MP", "HP", "DMG"];
  let imported = 0, skipped = 0;
  const failed = [];
  const deckWants = [];   // { name, cardId, qty }

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const g = k => (col[k] >= 0 ? (r[col[k]] || "").trim() : "");
    const csvName = g("name");
    const lang = (g("lang") || "en").toLowerCase();
    const cond = (() => { const c = g("condition").toUpperCase(); return CONDS.includes(c) ? c : "NM"; })();
    // Exakt vergleichen: "nonfoil" enthält "foil" als Teilstring — ein
    // Substring-Test hielte deshalb JEDE Zeile für Foil. Scryfall kennt
    // genau drei Finishes: nonfoil, foil, etched.
    const fin = g("finish").toLowerCase();
    const foil = fin === "foil" || fin === "etched";
    const qty = Math.max(1, parseInt(g("qty")) || 1);

    say(`<p class="hint">Karte ${i + 1} von ${data.length} … ${esc(csvName)}
      <br>${imported} neu · ${skipped} schon vorhanden · ${failed.length} nicht gefunden</p>`);

    let card;
    try { card = await resolveImportCard(g("set_code"), g("cn"), lang, g("scryfall_id")); }
    catch { card = null; }
    if (!card) { failed.push(csvName); continue; }

    const k = key(card.id, foil, lang, cond);
    let cardId = known.get(k);
    if (cardId) { skipped++; }
    else {
      const price = priceOf(card, foil);
      const row = {
        scryfall_id: card.id, oracle_id: card.oracle_id, name: card.name,
        // Fehlt Scryfall der fremdsprachige Name, nimm den aus der CSV.
        printed_name: card.printed_name || (lang !== "en" ? csvName : null),
        set_code: (card.set || "").toUpperCase(), set_name: card.set_name,
        cn: card.collector_number, img: imgOf(card),
        cm_id: card.cardmarket_id ?? null,
        type_line: card.type_line ?? null, rarity: card.rarity ?? null,
        mana_cost: manaOf(card), cmc: card.cmc ?? null,
        released: card.released_at ?? null, colors: farbenOf(card),
        keywords: keywordsOf(card), oracle_text: oracleOf(card),
        lang, condition: cond, foil, qty, price,
        hist: price == null ? [] : [{ d: today(), v: price }],
      };
      const { data: ins, error } = await sb.from("cards").insert(row).select("id").single();
      if (error) {
        // 23505 = Karte doch schon da (parallel), kein Fehler, sondern Duplikat.
        if (error.code === "23505") { skipped++; }
        else { failed.push(csvName); continue; }
      } else { cardId = ins.id; known.set(k, cardId); imported++; }
    }
    if (cardId && col.ctype >= 0 && g("ctype") === "deck" && g("cname"))
      deckWants.push({ name: g("cname"), cardId, qty });
  }

  // Decks anlegen (bestehende gleichen Namens wiederverwenden) und zuordnen.
  let deckMsg = "";
  if (deckWants.length) {
    say(`<p class="hint">Decks werden angelegt …</p>`);
    const idByName = new Map();
    for (const name of new Set(deckWants.map(w => w.name))) {
      let d = DECKS.find(x => x.name === name);
      if (!d) {
        const { data: nd, error } = await sb.from("decks").insert({ name }).select("id").single();
        if (error) continue;
        idByName.set(name, nd.id);
      } else idByName.set(name, d.id);
    }
    // Pro (Deck, Karte) ein Eintrag; eine Karte kann in der CSV mehrfach dem
    // Deck zugeordnet sein — dann die Mengen summieren.
    const merged = new Map();
    for (const w of deckWants) {
      const did = idByName.get(w.name); if (!did) continue;
      const mk = did + "|" + w.cardId;
      merged.set(mk, { deck_id: did, card_id: w.cardId, qty: (merged.get(mk)?.qty || 0) + w.qty });
    }
    const entries = [...merged.values()];
    if (entries.length) {
      const { error } = await sb.from("deck_entries").upsert(entries, { onConflict: "deck_id,card_id" });
      deckMsg = error ? " · Deck-Zuordnung teilweise fehlgeschlagen"
                      : ` · Deck „${[...idByName.keys()].join("“, „")}“ angelegt`;
    }
  }

  await reload(); renderAll();
  say(`<p class="hint"><b>Fertig.</b> ${imported} neu importiert,
    ${skipped} schon vorhanden${deckMsg}.
    ${failed.length ? `<br>${failed.length} nicht gefunden: ${esc(failed.slice(0, 8).join(", "))}${failed.length > 8 ? " …" : ""}` : ""}</p>`);
  toast(`${imported} Karten importiert${skipped ? `, ${skipped} übersprungen` : ""}`);
}

/* ================= Manueller Import (Set + Nummer) ====================
   Tabelleneingabe für Karten, deren Ecke man abliest oder kennt:
   Set, Nummer, Zeichen (T = Token), Ausführung, Sprache. Die Auflösung
   läuft über findByCode — denselben Weg wie Scan und Handeingabe. */
const MI_LANGS = ["de", "en", "fr", "it", "es", "ja", "pt", "ru", "ko"];

function miAddRow() {
  const tb = $("#mi-rows");
  // Neue Zeilen erben Ausführung und Sprache der vorigen — wer einen Stapel
  // deutscher Karten eintippt, soll das nicht 30-mal wählen müssen.
  const prev = tb.lastElementChild;
  const pFoil = prev?.querySelector("[data-mi-foil]")?.value ?? "0";
  const pLang = prev?.querySelector("[data-mi-lang]")?.value ?? "de";

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" data-mi-set placeholder="MKM" style="width:80px;text-transform:uppercase"></td>
    <td><input type="text" data-mi-num placeholder="8" style="width:72px"></td>
    <td><input type="text" data-mi-let placeholder="T" maxlength="2" style="width:52px;text-transform:uppercase"></td>
    <td><select data-mi-foil><option value="0">Normal</option><option value="1">Foil</option></select></td>
    <td><select data-mi-lang>${MI_LANGS.map(l =>
      `<option value="${l}">${l.toUpperCase()}</option>`).join("")}</select></td>
    <td class="num"><button class="btn ghost sm" data-mi-del title="Zeile entfernen">&times;</button></td>
    <td data-mi-status style="white-space:nowrap;font-size:13px"></td>`;
  tr.querySelector("[data-mi-foil]").value = pFoil;
  tr.querySelector("[data-mi-lang]").value = pLang;
  tr.querySelector("[data-mi-del]").onclick = () => {
    tr.remove();
    if (!tb.children.length) miAddRow();
  };
  // Tippen in der letzten Zeile hängt automatisch eine leere neue an.
  tr.querySelectorAll("input[type=text]").forEach(i => i.addEventListener("input", () => {
    if (tr === tb.lastElementChild && i.value.trim()) miAddRow();
  }));
  tb.appendChild(tr);
  return tr;
}

async function miImport() {
  const btn = $("#mi-import");
  const cond = $("#mi-cond").value;
  const rows = [...$("#mi-rows").children];
  let ok = 0, fail = 0;
  btn.disabled = true;
  try {
    for (const tr of rows) {
      if (tr.dataset.done) continue;                       // schon importiert
      const set  = tr.querySelector("[data-mi-set]").value.trim();
      const num  = tr.querySelector("[data-mi-num]").value.trim();
      const zei  = tr.querySelector("[data-mi-let]").value.trim().toUpperCase();
      const foil = tr.querySelector("[data-mi-foil]").value === "1";
      const lang = tr.querySelector("[data-mi-lang]").value;
      const status = tr.querySelector("[data-mi-status]");
      const sag = (t, farbe) => { status.textContent = t; status.style.color = farbe || ""; };

      if (!set && !num) continue;                          // leere Zeile
      if (!set || !num) { sag("✗ Set und Nummer nötig", "var(--err)"); fail++; continue; }

      sag("sucht…");
      let card = null;
      try { card = await findByCode(set, num, lang, zei === "T"); } catch { /* unten melden */ }
      if (!card) { sag(`✗ ${set.toUpperCase()} #${num} nicht gefunden`, "var(--err)"); fail++; continue; }

      const price = priceOf(card, foil);
      const { error } = await sb.rpc("add_card", {
        p_scryfall_id: card.id, p_oracle_id: card.oracle_id, p_name: card.name,
        p_printed_name: card.printed_name || null,
        p_set_code: (card.set || "").toUpperCase(), p_set_name: card.set_name,
        p_cn: card.collector_number, p_img: imgOf(card),
        p_cm_id: card.cardmarket_id ?? null,
        p_lang: lang, p_condition: cond, p_foil: foil, p_price: price,
        p_type_line: card.type_line ?? null, p_rarity: card.rarity ?? null,
        p_mana_cost: manaOf(card), p_cmc: card.cmc ?? null,
        p_released: card.released_at ?? null, p_colors: farbenOf(card),
        p_keywords: keywordsOf(card), p_oracle_text: oracleOf(card),
      });
      if (error) { sag("✗ " + dbErr(error), "var(--err)"); fail++; continue; }

      // Erfolgreiche Zeilen bleiben sichtbar stehen (man sieht, was aus der
      // Eingabe wurde), sind aber gesperrt — ein zweites "Importieren"
      // würde sie sonst erneut einbuchen.
      tr.dataset.done = "1";
      tr.querySelectorAll("input,select,button").forEach(x => x.disabled = true);
      sag("✓ " + (card.printed_name || card.name) + (price != null ? " · " + eur(price) : ""), "var(--ok)");
      ok++;
    }
    await reload(); renderAll();
    toast(`${ok} Karten importiert${fail ? `, ${fail} fehlgeschlagen` : ""}`);
  } finally { btn.disabled = false; }
}

/* =============================== Rendern ============================== */
function renderAll() { renderCollection(); renderDecks(); }

/* ============================ Login / Start =========================== */
function showGate(mode) {
  $("#gate").style.display = "block";
  $("#app").style.display = "none";
  $$("#gate .pane").forEach(p => p.style.display = p.dataset.pane === mode ? "block" : "none");
}
function showApp() {
  $("#gate").style.display = "none";
  $("#app").style.display = "block";
  renderWho();
}

async function afterLogin(user) {
  USER = user;
  // Profil laden (bei Erstanmeldung anlegen). Nicht kritisch: schlägt es fehl
  // (z. B. Tabelle noch nicht angelegt), zeigt die App die E-Mail und läuft weiter.
  try { await ladeProfile(); } catch (e) { PROFILE = null; }
  showApp();
  try { await reload(); renderAll(); }
  catch (e) { toast(dbErr(e)); }
}

function wireAuth() {
  const msg = (t, cls) => { const m = $("#auth-msg"); m.textContent = t; m.className = "msg " + (cls || ""); };
  let mode = "in";
  $$("#auth-tabs button").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$("#auth-tabs button").forEach(x => x.classList.toggle("on", x === b));
    $("#auth-go").textContent = mode === "in" ? "Anmelden" : "Konto anlegen";
    msg("");
  });

  $("#auth-form").onsubmit = async ev => {
    ev.preventDefault();
    const email = $("#auth-email").value.trim(), pw = $("#auth-pw").value;
    if (!email || !pw) return msg("Bitte E-Mail und Passwort eingeben.", "err");
    if (mode === "up" && pw.length < 8) return msg("Das Passwort braucht mindestens 8 Zeichen.", "err");
    $("#auth-go").disabled = true; msg("Moment…");
    try {
      const { data, error } = mode === "in"
        ? await sb.auth.signInWithPassword({ email, password: pw })
        : await sb.auth.signUp({ email, password: pw });
      if (error) throw error;
      if (!data.session) {
        msg("Konto angelegt. Bitte bestätige zuerst die E-Mail, dann anmelden.", "ok");
      } else {
        await afterLogin(data.user);
      }
    } catch (e) {
      const m = e.message || "";
      msg(m.includes("Invalid login") ? "E-Mail oder Passwort stimmt nicht."
        : m.includes("already registered") ? "Für diese E-Mail gibt es schon ein Konto — bitte anmelden."
        : m.includes("Failed to fetch") ? "Keine Verbindung. Stimmen Project URL und Schlüssel?"
        : m, "err");
    } finally { $("#auth-go").disabled = false; }
  };

  $("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

function wireSetup() {
  $("#setup-form").onsubmit = ev => {
    ev.preventDefault();
    const url = $("#cfg-url").value.trim().replace(/\/+$/, ""), key = $("#cfg-key").value.trim();
    if (!/^https:\/\/.+\.supabase\.(co|in)$/.test(url))
      return $("#setup-msg").textContent = "Die Project URL sieht so aus: https://xxxx.supabase.co";
    if (key.length < 20)
      return $("#setup-msg").textContent = "Der Schlüssel sieht zu kurz aus.";
    localStorage.setItem("mtg-cfg", JSON.stringify({ url, key }));
    location.reload();
  };
}

/* ============================== Profil ===============================
   Ein Profil je Konto (Tabelle public.profiles, RLS: nur das eigene). Fehlt es
   bei der Erstanmeldung, wird es einmal angelegt. Der Avatar liegt im
   öffentlichen Storage-Bucket "avatars" unter {uid}/avatar — schreiben darf man
   nur den eigenen Ordner. */
async function ladeProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", USER.id).maybeSingle();
  if (error) throw error;
  if (data) { PROFILE = data; return; }
  const ins = await sb.from("profiles").insert({ id: USER.id }).select("*").single();
  if (ins.error) throw ins.error;
  PROFILE = ins.data;
}

const profilName = () => PROFILE?.display_name?.trim() || USER?.email || "";

/* Initialen aus dem Namen: erster + letzter Wortanfang, sonst der erste Buchstabe. */
function initialen(name) {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/* Avatar als Bild (falls hochgeladen) oder als Initialen-Kreis. */
function avatarHtml(size, name = profilName()) {
  const s = `width:${size}px;height:${size}px`;
  if (PROFILE?.avatar_url)
    return `<img class="avatar" src="${esc(PROFILE.avatar_url)}" alt="" style="${s}">`;
  return `<span class="avatar avatar-init" style="${s};font-size:${Math.round(size * 0.4)}px">${esc(initialen(name))}</span>`;
}

/* Kopfzeile rechts: Avatar + Name (oder E-Mail), klickbar zum Profil. */
function renderWho() {
  const el = $("#who");
  if (!el) return;
  el.innerHTML = `${avatarHtml(26)}<span>${esc(profilName())}</span>`;
  el.title = "Profil öffnen";
  el.onclick = () => { const b = $('nav button[data-v="profile"]'); if (b) b.click(); };
}

/* Zwei persönliche Highlights über der Sammlungs-Statistik: die wertvollste
   Karte und die neueste Errungenschaft — je mit Mini-Bild und klickbar zur
   Detailansicht. Beides sind Einzel-Callouts, die das Dashboard so nicht zeigt. */
function profilHighlightsHtml() {
  const mitPreis = CARDS.filter(c => c.price != null);
  const wertvollste = mitPreis.length ? mitPreis.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const mitDatum = CARDS.filter(c => c.added);
  // added ist ein ISO-Zeitstempel — String-Vergleich reicht für "das späteste".
  const neueste = mitDatum.length ? mitDatum.reduce((a, b) => (b.added > a.added ? b : a)) : null;
  const kachel = (label, c, sub) => c ? `
    <div class="profil-hl-item" data-hl="${c.id}" title="Großansicht &amp; Preisverlauf">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">`
              : '<div class="profil-hl-noimg">&#9670;</div>'}
      <div class="profil-hl-txt">
        <div class="k">${esc(label)}</div>
        <div class="v">${esc(c.disp)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
    </div>` : "";
  const tiles = [
    kachel("Wertvollste Karte", wertvollste, wertvollste ? eur(wertvollste.price) : ""),
    kachel("Neueste Errungenschaft", neueste, neueste ? datShort(neueste.added) : ""),
  ].filter(Boolean).join("");
  return tiles ? `<div class="profil-hl">${tiles}</div>` : "";
}

function renderProfile() {
  const el = $("#v-profile");
  if (!el) return;
  const seit = PROFILE?.created ? datShort(PROFILE.created) : "–";
  const decks = DECKS.length;
  el.innerHTML = `
    <div class="card profil-kopf">
      <div class="profil-avatar">
        ${avatarHtml(96)}
        <div class="row" style="justify-content:center">
          <div style="flex:none"><button class="btn ghost sm" id="pf-avatar-btn">Bild ändern</button></div>
          ${PROFILE?.avatar_url ? '<div style="flex:none"><button class="btn ghost sm" id="pf-avatar-del">Entfernen</button></div>' : ""}
        </div>
        <input type="file" id="pf-avatar-file" accept="image/*" hidden>
      </div>
      <div class="profil-ident">
        <label>Anzeigename</label>
        <div class="row" style="margin-bottom:8px">
          <div style="flex:1"><input type="text" id="pf-name" maxlength="40"
            value="${esc(PROFILE?.display_name || "")}" placeholder="z. B. Benjamin"></div>
          <div style="flex:none"><button class="btn" id="pf-name-save">Speichern</button></div>
        </div>
        <p class="hint" style="margin:0">Angemeldet als <b>${esc(USER?.email || "")}</b> &middot; Mitglied seit ${esc(seit)}</p>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Deine Sammlung</h3>
      <p class="hint" style="margin-top:-4px">${decks} ${decks === 1 ? "Deck" : "Decks"} &middot; Statistik über den gesamten Bestand.</p>
      ${profilHighlightsHtml()}
      <div id="profile-dash" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Konto</h3>
      <label>Neues Passwort</label>
      <div class="row" style="margin-bottom:6px">
        <div><input type="password" id="pf-pw1" autocomplete="new-password" placeholder="mind. 8 Zeichen"></div>
        <div><input type="password" id="pf-pw2" autocomplete="new-password" placeholder="wiederholen"></div>
        <div style="flex:none"><button class="btn ghost" id="pf-pw-save">Passwort ändern</button></div>
      </div>
      <div class="msg" id="pf-pw-msg"></div>
      <div style="margin-top:14px"><button class="btn danger" id="pf-logout">Abmelden</button></div>
    </div>`;

  // Statistik über den GESAMTEN Bestand — dieselbe Funktion wie das
  // Sammlungs-Dashboard, nur ungefiltert und in ein eigenes Ziel.
  renderDash(CARDS, $("#profile-dash"), false);

  // Highlight-Kacheln öffnen die Detailansicht der jeweiligen Karte.
  $$("#v-profile [data-hl]").forEach(k => k.onclick = () => showCardDetail(k.dataset.hl));

  $("#pf-avatar-btn").onclick = () => $("#pf-avatar-file").click();
  $("#pf-avatar-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) avatarHochladen(f); };
  const del = $("#pf-avatar-del"); if (del) del.onclick = avatarEntfernen;
  $("#pf-name-save").onclick = nameSpeichern;
  $("#pf-name").addEventListener("keydown", e => { if (e.key === "Enter") nameSpeichern(); });
  $("#pf-pw-save").onclick = passwortAendern;
  $("#pf-logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

async function nameSpeichern() {
  const name = $("#pf-name").value.trim();
  try {
    const { error } = await sb.from("profiles").update({ display_name: name || null }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.display_name = name || null;
    renderWho();
    toast("Name gespeichert");
  } catch (e) { toast(dbErr(e)); }
}

/* Avatar clientseitig auf 256px quadratisch verkleinern und als Data-URI DIREKT
   in profiles.avatar_url ablegen — bewusst NICHT über Supabase Storage. Dessen
   Upload kam mit dem publishable-Key (sb_…) unauthentifiziert an (auth.uid()
   null → RLS „new row violates…"), während der Tabellen-Weg über dieselbe
   funktionierende Anmeldung läuft wie der ganze Rest der App. Ein 256er-JPEG
   ist mit ~20–30 KB klein genug für die Spalte. */
async function avatarHochladen(file) {
  if (!file.type.startsWith("image/")) return toast("Bitte ein Bild wählen.");
  if (file.size > 12 * 1024 * 1024) return toast("Bild ist zu groß (max. 12 MB).");
  try {
    const dataUrl = await bildDataUrl(file, 256);
    const { error } = await sb.from("profiles").update({ avatar_url: dataUrl }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.avatar_url = dataUrl;
    renderWho(); renderProfile();
    toast("Avatar aktualisiert");
  } catch (e) { toast(dbErr(e)); }
}

async function avatarEntfernen() {
  try {
    const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.avatar_url = null;
    renderWho(); renderProfile();
    toast("Avatar entfernt");
  } catch (e) { toast(dbErr(e)); }
}

/* Bild mittig quadratisch beschneiden, auf kante×kante zeichnen und als
   JPEG-Data-URI zurückgeben. Das mittige Beschneiden füllt das Quadrat ganz,
   daher entsteht keine Transparenz, die JPEG schwärzen würde. */
function bildDataUrl(file, kante) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const seite = Math.min(img.width, img.height);
      const sx = (img.width - seite) / 2, sy = (img.height - seite) / 2;
      const cv = document.createElement("canvas");
      cv.width = cv.height = kante;
      cv.getContext("2d").drawImage(img, sx, sy, seite, seite, 0, 0, kante, kante);
      res(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => rej(new Error("Bild konnte nicht gelesen werden."));
    img.src = URL.createObjectURL(file);
  });
}

async function passwortAendern() {
  const msg = (t, cls) => { const m = $("#pf-pw-msg"); m.textContent = t; m.className = "msg " + (cls || ""); };
  const a = $("#pf-pw1").value, b = $("#pf-pw2").value;
  if (a.length < 8) return msg("Das Passwort braucht mindestens 8 Zeichen.", "err");
  if (a !== b) return msg("Die Passwörter stimmen nicht überein.", "err");
  $("#pf-pw-save").disabled = true; msg("Moment…");
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    $("#pf-pw1").value = ""; $("#pf-pw2").value = "";
    msg("Passwort geändert.", "ok");
  } catch (e) { msg(e.message || "Änderung fehlgeschlagen.", "err"); }
  finally { $("#pf-pw-save").disabled = false; }
}

function wireApp() {
  $$("nav button[data-v]").forEach(b => b.onclick = () => {
    $$("nav button[data-v]").forEach(x => x.classList.toggle("on", x === b));
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
    if (b.dataset.v === "profile") renderProfile();
  });

  $("#drop").onclick = () => $("#file").click();
  $("#file").onchange = e => { [...e.target.files].forEach(scanFile); e.target.value = ""; };
  $("#multi-btn").onclick = () => $("#multi-file").click();
  $("#multi-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) scanMultiFile(f); };
  ["dragenter", "dragover"].forEach(ev => $("#drop").addEventListener(ev, e => {
    e.preventDefault(); $("#drop").classList.add("hot");
  }));
  ["dragleave", "drop"].forEach(ev => $("#drop").addEventListener(ev, e => {
    e.preventDefault(); $("#drop").classList.remove("hot");
  }));
  $("#drop").addEventListener("drop", e =>
    [...e.dataTransfer.files].filter(f => f.type.startsWith("image/")).forEach(scanFile));

  $("#q").oninput = renderCollection;
  $("#f-set").onchange = renderCollection;
  $("#f-foil").onchange = renderCollection;
  $("#upd").onclick = updatePrices;

  // Anlege-Dropdowns aus demselben Vokabular wie Bearbeiten und Filter.
  $("#deck-format").innerHTML = deckOptions(DECK_FORMATE, "", "—");
  $("#deck-arch").innerHTML   = deckOptions(DECK_ARCHETYPEN, "", "—");
  $("#deck-add").onclick = async () => {
    const name = $("#deck-name").value.trim();
    if (!name) return toast("Bitte einen Decknamen eingeben");
    const format    = $("#deck-format").value || null;
    const archetype = $("#deck-arch").value   || null;
    try {
      const { error } = await sb.from("decks").insert({ name, format, archetype });
      if (error) throw error;
      $("#deck-name").value = "";
      $("#deck-format").value = "";
      $("#deck-arch").value = "";
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); }
  };

  $("#ex-json").onclick = () => download(`arcanum-archive-sicherung-${today()}.json`,
    JSON.stringify({ v: 2, exported: new Date().toISOString(), cards: CARDS, decks: DECKS }, null, 1),
    "application/json");
  $("#ex-csv").onclick = exportCsv;
  $("#im-json").onclick = () => $("#im-file").click();
  $("#im-file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await importJson(f); } catch (err) { toast("Import fehlgeschlagen: " + err.message); }
  };
  $("#detail-close").onclick = () => $("#detail-dlg").close();
  // Beim Scrollen (auch innerhalb der Tabelle) verrutscht die Vorschau —
  // lieber ausblenden. capture:true erwischt auch innere Scroller.
  addEventListener("scroll", hideHover, true);
  $("#mi-toggle").onclick = () => {
    const s = $("#manual-import");
    const zeigen = s.style.display === "none";
    s.style.display = zeigen ? "block" : "none";
    if (zeigen && !$("#mi-rows").children.length) miAddRow();
  };
  $("#mi-add").onclick = () => miAddRow();
  $("#mi-import").onclick = miImport;
  $("#im-csv").onclick = () => $("#csv-file").click();
  $("#csv-file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await importCsv(f); }
    catch (err) {
      $("#import-status").innerHTML = `<span class="pill err">${esc(err.message)}</span>`;
      toast("Import fehlgeschlagen: " + err.message);
    }
  };
  $("#reset-cfg").onclick = async () => {
    if (!await confirmDlg(`<b>Verbindung zurücksetzen?</b>
      <p class="hint">Nur die Zugangsdaten zur Datenbank werden aus diesem Browser entfernt.
      Deine Sammlung bleibt in Supabase unangetastet.</p>`)) return;
    localStorage.removeItem("mtg-cfg"); location.reload();
  };
}

/* ================================ Start =============================== */
(async () => {
  wireSetup();
  const c = cfg();
  if (!c) return showGate("setup");

  connect(c);
  wireAuth(); wireApp();

  const { data } = await sb.auth.getSession();
  if (data.session) await afterLogin(data.session.user);
  else showGate("auth");

  sb.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_OUT") location.reload();
  });
})();
