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

/* App-Version = der Cache-Buster ?v= des eigenen <script>-Tags. Eine einzige
   Quelle der Wahrheit: der Betreiber zählt sie ohnehin bei jeder Änderung in
   index.html hoch (siehe README), hier wird sie nur angezeigt. */
const APP_VERSION = (() => {
  try {
    const s = document.currentScript || document.querySelector('script[src*="app.js"]');
    const m = s && String(s.src).match(/[?&]v=([0-9]+)/);
    return m ? m[1] : "";
  } catch { return ""; }
})();

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

/* Klick außerhalb des Dialog-Fensters (auf den dunklen Backdrop) schließt es —
   zusätzlich zum Schließen-Knopf. Wir prüfen die Trefferfläche über die
   Dialog-Maße statt bloß e.target: so schließt weder ein Klick auf das Polster
   des Fensters noch ein im Inhalt begonnener Zug (z. B. Text markieren, dann
   außerhalb loslassen) versehentlich. pointerdown reagiert nur, wenn der Druck
   WIRKLICH auf dem Backdrop beginnt. Einmal je Dialog verdrahten. */
function dialogBackdropSchliesst(dlg) {
  if (!dlg) return;
  dlg.addEventListener("pointerdown", e => {
    if (e.target !== dlg) return;   // ein Kind (der Inhalt) wurde getroffen, nicht der Backdrop
    const r = dlg.getBoundingClientRect();
    const drin = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!drin) dlg.close();         // außerhalb der Fensterfläche = Backdrop
  });
}

/* ============================== Supabase ============================== */
let sb = null, USER = null, PROFILE = null;
let FLAGS = {}, IS_ADMIN = false;   // globale Feature-Schalter + ob der Nutzer Admin ist

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
    return t("err.noConn");
  if (e.code === "42P01" || e.message?.includes("does not exist"))
    return t("err.noTables");
  if (e.code === "PGRST301" || e.code === "42501")
    return t("err.noPerm");
  return e.message || t("err.unknown");
}

/* ------------------------------------------------------------ Datenlage */
let CARDS = [], DECKS = [];

async function reload() {
  // Ausdrücklich auf die EIGENEN Zeilen filtern. Seit dem Freunde-Feature
  // erlaubt die RLS auch das Lesen geteilter Freundes-Decks/-Karten — die
  // dürfen hier aber nicht in die eigene Sammlung/Deckliste sickern. Fremdes
  // wird nur gezielt beim Ansehen eines Freundes geladen.
  const [c, d, e] = await Promise.all([
    sb.from("cards").select("*").eq("user_id", USER.id).order("name"),
    sb.from("decks").select("*").eq("user_id", USER.id).order("created"),
    sb.from("deck_entries").select("*").eq("user_id", USER.id)
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

/* Marken-Logos in den Link-Pillen statt der Kürzel „CM"/„SF".
   Scryfall bleibt sein natives Farb-Logo als <img> (assets/). Cardmarket ist
   einfarbig navy und im dunklen UI unsichtbar → weiß dargestellt. Wichtig als
   Inline-SVG mit fill, NICHT per CSS-filter auf einem <img>: Chromium rastert
   ein gefiltertes SVG-<img> in einer <table>-Zelle (Listen-Ansicht) zu einem
   weißen Klotz. Die Pfaddaten stammen 1:1 aus assets/brandlogo_cardmarket.svg. */
const CM_LOGO = `<svg class="brandlogo" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label="Cardmarket"><title>Cardmarket</title><path d="M14.837.772c-.45 0-.6.255-.645.366-.044.11-.113.4.213.711l1.54 1.478a.124.124 0 0 1 .002.18L10.021 9.47a.934.934 0 0 0-.274.673.936.936 0 0 0 .289.669l3.977 3.82a.955.955 0 0 0 .664.267v.001c.259 0 .5-.1.68-.281l5.815-5.853a.142.142 0 0 1 .103-.042c.023 0 .065.005.1.04l1.54 1.478c.198.19.383.23.504.23.277 0 .577-.217.577-.691L24 1.726a.951.951 0 0 0-.95-.95zm-8.06.793-2.351.461s-.365.064-.606.428c-.192.286-.124.616-.124.616l3.082 14.66V1.566ZM2.843 4.907v.001L.52 5.752s-.308.106-.445.452c-.15.385-.03.634-.03.634L6.04 23.224h.86C6.559 21.8 2.843 4.907 2.843 4.907ZM23.31 12.63a.59.59 0 0 0-.417.175l-6.716 6.787a.976.976 0 0 0-.287.706c.004.267.11.515.303.7l1.084 1.046-7.668-.006.005-7.574 2.473 2.494a.592.592 0 0 0 .835.004.59.59 0 0 0 .004-.835l-3.2-3.227c-.246-.25-.562-.33-.843-.214-.282.116-.45.396-.45.747l-.006 8.794c0 .266.103.515.291.703a.986.986 0 0 0 .702.291l8.92.007v-.002c.354 0 .633-.168.747-.45.114-.283.03-.599-.224-.845l-1.708-1.647 6.578-6.648a.591.591 0 0 0-.005-.835.589.589 0 0 0-.418-.17z"/></svg>`;
const SF_LOGO = `<img class="brandlogo" src="assets/brandlogo_scryfall.svg?v=1" alt="Scryfall" width="15" height="15">`;

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

/* Regex-Sonderzeichen entschärfen — genutzt, um einen Schlüsselwort-Namen im
   Regeltext einer Kartenseite zu suchen. */
const escRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Zweiseitige Karten (Vorder-/Rückseite zum Umdrehen). Scryfall führt sie als
   card_faces, bei denen JEDE Seite ein eigenes Bild trägt — das unterscheidet
   sie von geteilten und Abenteuer-Karten, die zwar zwei Seiten, aber nur EIN
   Bild haben und sich nicht umdrehen lassen. Betroffene Layouts: transform,
   modal_dfc, double_faced_token, reversible_card. Rückgabe: ein Eintrag je
   Seite mit allem, was die Detailansicht je Seite zeigt (Name, Typ, Regeltext,
   Kosten, Stärke/Widerstand, Bild). Die Schlüsselwörter führt Scryfall nur
   gesammelt über beide Seiten — sie werden hier je Seite aus deren Regeltext
   herausgefiltert. null, wenn die Karte nicht umdrehbar ist. */
const facesOf = card => {
  const f = card?.card_faces;
  if (!Array.isArray(f) || f.length < 2) return null;
  if (!f[0]?.image_uris?.small || !f[1]?.image_uris?.small) return null;
  const kw = Array.isArray(card.keywords) ? card.keywords : [];
  return f.map(x => {
    const oracle = typeof x.oracle_text === "string" ? x.oracle_text : null;
    return {
      name: x.name ?? null,
      printed: x.printed_name ?? null,
      type_line: x.type_line ?? null,
      mana_cost: typeof x.mana_cost === "string" ? x.mana_cost : null,
      oracle_text: oracle,
      power: x.power ?? null,
      toughness: x.toughness ?? null,
      keywords: oracle
        ? kw.filter(k => new RegExp(`(^|[^A-Za-zÀ-ÿ])${escRx(k)}([^A-Za-zÀ-ÿ]|$)`, "i").test(oracle))
        : [],
      img: x.image_uris.small,
    };
  });
};

/* Erkennt an den GESPEICHERTEN Feldern, dass eine Karte mehrseitig sein könnte
   (Typzeile oder Regeltext mit „//"). Nur ein günstiger Vorfilter: OB sie
   wirklich umdrehbar ist (eigene Bilder je Seite), sagt erst facesOf nach einem
   Scryfall-Abruf. Für einseitige Karten immer falsch — sie lösen kein Nachladen
   aus. */
const looksMultiface = c => / \/\/ /.test(c?.type_line || "") || /\n\/\/\n/.test(c?.oracle_text || "");

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
      toast(msg || t("scan.tooMany"));
      return null;
    }
    // Alles andere ändert sich nicht von allein: für die Sitzung abschalten.
    // Ein Fehler OHNE Status ist kein Sonderfall, sondern der wichtigste —
    // er bedeutet CORS oder Netzwerk. Genau der ist mir hier stumm
    // durchgerutscht, weil ich nur bekannte Statuscodes behandelt habe.
    visionAus = true;
    toast(msg ? msg + t("scan.fallbackSuffix")
      : s ? t("scan.visionErr", { s })
          : t("scan.visionUnreach"));
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

/* Der Name einer KARTENSPRACHE in der Oberflächensprache (langname.<code>).
   Fällt auf den statischen deutschen Namen und zuletzt den Großcode zurück,
   falls keine Übersetzung vorliegt. Bewusst NUR für die Anzeige — die
   Kartensprache selbst (der Code) bleibt Kartendatum. */
function langName(code) {
  const c = (code || "").toLowerCase();
  if (!c) return "?";
  const key = "langname." + c, tr = t(key);
  return tr === key ? (LANG_NAMES[c] || c.toUpperCase()) : tr;
}

/* ---------------------------------------------- Kartenzustand -------- */
/* Cardmarket-Skala, sieben Stufen von best (MT) bis schlecht (PO), jede mit
   eigener Farbe wie das Badge-System auf cardmarket.com. Angezeigt wird ein
   farbiges Kürzel-Badge, der volle Name steht im Tooltip. Der Zustand ist
   Kartendatum — die Codes sind Fachtaxonomie und bleiben unübersetzt. */
const CONDITIONS = [
  { code: "MT", name: "Mint",         color: "#16b1c2" },
  { code: "NM", name: "Near Mint",    color: "#46a750" },
  { code: "EX", name: "Excellent",    color: "#7f8a33" },
  { code: "GD", name: "Good",         color: "#f0c018", dunkel: true },
  { code: "LP", name: "Light Played", color: "#f0911e" },
  { code: "PL", name: "Played",       color: "#e389a0" },
  { code: "PO", name: "Poor",         color: "#d43f54" },
];
const CONDITION_CODES = CONDITIONS.map(c => c.code);
const CONDITION_BY = Object.fromEntries(CONDITIONS.map(c => [c.code, c]));
const CONDITION_RANK = Object.fromEntries(CONDITIONS.map((c, i) => [c.code, i]));

/* Farbiges Zustands-Badge. Unbekannte Codes bekommen ein neutrales Grau,
   damit fremde/alte Werte sichtbar bleiben statt zu verschwinden. */
function condBadge(code) {
  const k = (code || "").toUpperCase();
  if (!k) return "";
  const c = CONDITION_BY[k];
  if (!c) return `<span class="cond-badge" style="background:#5b6070" title="${esc(k)}">${esc(k)}</span>`;
  return `<span class="cond-badge${c.dunkel ? " dunkel" : ""}" style="background:${c.color}" title="${esc(c.name)}">${c.code}</span>`;
}

/* Fremde Zustandsangaben (TCGplayer-Kürzel MP/HP/DMG, ausgeschriebene Namen)
   auf die Cardmarket-Skala normalisieren — vor allem für den CSV-Import. */
function normCond(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "NM";
  const up = s.toUpperCase();
  if (CONDITION_BY[up]) return up;
  const map = {
    mp: "GD", hp: "PL", dmg: "PO", dm: "PO", nmmt: "NM", "nm/m": "NM",
    mint: "MT", "near mint": "NM", excellent: "EX", good: "GD",
    "light played": "LP", "lightly played": "LP", "moderately played": "GD",
    "heavily played": "PL", played: "PL", poor: "PO", damaged: "PO",
  };
  return map[s] || "NM";
}

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
  onStep(t("scan.reading"));
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
        onStep(t("scan.searchingCode", { set: c.set, num: c.num, token: token ? t("scan.tokenSuffix") : "" }));
        const hit = await findByCode(c.set, c.num, l, token);
        if (hit) return { card: hit, guess: hit.printed_name || hit.name, candidates: [], vision: v, lang: l };
      }
      if (v.printed_name) {
        onStep(t("scan.searchingName", { name: v.printed_name }));
        const { card, candidates: cs } = await findCard(v.printed_name, l);
        if (card) return { card, guess: v.printed_name, candidates: [], vision: v, lang: l };
        if (cs.length) { best = cs; firstGuess = v.printed_name; }
      }
    }
  } catch { /* Bildmodell nicht erreichbar — weiter mit Texterkennung */ }

  const w = await ocrWorker();

  // 2. Auffangnetz: Setcode + Sammlernummer per Zeichenerkennung.
  onStep(t("scan.readingCode"));
  try {
    const { data } = await w.recognize(preprocessCorner(img));
    const c = parseCorner(data.text);
    if (c) {
      onStep(t("scan.searchingCode", { set: c.set, num: c.num, token: c.token ? t("scan.tokenSuffix") : "" }));
      const hit = await findByCode(c.set, c.num, lang, c.token);
      if (hit) return { card: hit, guess: hit.printed_name || hit.name, candidates: [] };
    }
  } catch { /* Ecke unlesbar — weiter über den Namen */ }

  for (const topOnly of [true, false]) {
    onStep(topOnly ? t("scan.readingName") : t("scan.secondTry"));
    const { data } = await w.recognize(preprocess(img, topOnly));
    const lines = candidates(data.text);
    if (topOnly) firstGuess = lines[0] || "";
    for (const line of lines) {
      onStep(t("scan.searchingName", { name: line }));
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
  im.onerror = () => rej(new Error(t("scan.imgUnreadable")));
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
    <div class="body"><div class="title">${esc(t("scan.processing"))}</div>
    <div class="meta" data-step>${esc(t("scan.reading"))}</div>
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
      `<div class="title">${esc(t("scan.failed"))}</div>
       <div class="meta"><span class="pill err">${esc(e.message)}</span></div>`;
  }
}

async function scanFile(file) {
  try {
    const img = await loadImg(file);
    await scanBild(img, URL.createObjectURL(file), $("#d-lang").value);
  } catch { toast(t("scan.imgUnreadable")); }
}

/* Ein Foto mit MEHREREN Karten: erst die Rechtecke vom Modell holen (detect),
   dann jede Karte ausschneiden und wie einen Einzelscan durch dieselbe Pipeline
   schicken — NACHEINANDER, um die Funktion und ihre Ratenbegrenzung nicht zu
   überrennen. Foil/Zustand/Sprache gelten wie beim Einzelscan aus den Dropdowns;
   Ausreißer korrigiert man je Karte in der Warteschlange. */
async function scanMultiFile(file) {
  let img;
  try { img = await loadImg(file); } catch { return toast(t("scan.imgUnreadable")); }
  toast(t("scan.searching"));
  let boxes;
  try { boxes = await detectCards(img); }
  catch (e) { return toast(e.message || t("scan.notFound")); }
  if (!boxes.length) return toast(t("scan.noneDetected"));
  toast(t("scan.detected", { n: boxes.length }));
  const lang = $("#d-lang").value;
  for (const box of boxes) {
    const cv = cropCanvas(img, box, 0.06);
    await scanBild(cv, cv.toDataURL("image/jpeg", 0.7), lang);
  }
}

/* Kartenrechtecke (Anteile 0..1) für ein Foto über die "detect"-Betriebsart.
   Unplausible/leere Rechtecke fliegen gleich raus. */
async function detectCards(img) {
  if (visionAus) throw new Error(t("scan.visionDisabled"));
  const ganz = { x: 0, y: 0, w: img.width, h: img.height };
  const { data, error } = await sb.functions.invoke("scan-card", {
    body: { mode: "detect", images: [{ b64: toJpegBase64(img, ganz, 1600), media_type: "image/jpeg" }] },
  });
  if (error) {
    let msg = "";
    try { msg = (await error.context.json()).error; } catch { /* kein JSON-Körper */ }
    throw new Error(msg || t("scan.detectUnreach"));
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

  // Zweiseitige Karten: die Seiten dieser Auflage festhalten, damit die
  // Detailansicht sie später ohne erneuten Scryfall-Abruf umdrehen kann.
  // Getrennt vom add_card-Aufruf, um dessen Signatur nicht zu erweitern.
  const row = Array.isArray(data) ? data[0] : data;
  const fc = facesOf(card);
  if (fc && row?.id) {
    try { await sb.from("cards").update({ faces: fc }).eq("id", row.id); }
    catch { /* Anzeige klappt auch ohne gespeicherte Seiten */ }
  }

  await reload(); renderAll();
  el.querySelector(".thumb").src = imgOf(card) || el.querySelector(".thumb").src;
  el.querySelector(".body").innerHTML = `
    <div class="title">${esc(card.printed_name || card.name)}</div>
    ${card.printed_name ? `<div class="meta">${esc(card.name)}</div>` : ""}
    <div class="meta">${esc(card.set_name)} &middot; #${esc(card.collector_number)} &middot; ${eur(price)}</div>
    <div class="meta" style="margin-top:6px">
      <span class="pill ok">${before ? esc(t("common.qtyLabel")) + ": " + (row?.qty ?? "+1") : esc(t("detail.added"))}</span>
      ${foil ? '<span class="pill foil">Foil</span>' : ""}
      <span class="pill">${esc(lang.toUpperCase())}</span>${condBadge(cond)}
      <button class="btn ghost sm" data-fix style="margin-left:6px">${esc(t("scan.wrongCard"))}</button>
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
    <div class="title">${esc(cs.length ? t("scan.whichCard") : t("scan.notSure"))}</div>
    <div class="meta">${cs.length
      ? t("scan.readMultiple", { guess: esc(guess) })
      : esc(t("scan.manualNameHint"))}</div>
    ${list}
    <div class="row" style="margin-top:8px">
      <div class="sugg"><input type="text" data-name value="${esc(guess)}" placeholder="${esc(t("scan.namePh"))}"></div>
      <div style="flex:none"><button class="btn sm" data-go>${esc(t("scan.search"))}</button></div>
    </div>
    <p class="hint" style="margin-top:6px">${t("scan.codeHint")}</p>`;

  el.querySelectorAll("[data-pick]").forEach(b => b.onclick = async () => {
    try { await addToCollection(cs[+b.dataset.pick], el); }
    catch (e) { toast(e.message); }
  });

  const inp = el.querySelector("[data-name]");
  attachSuggest(inp);
  const go = async () => {
    const v = inp.value.trim();
    if (!v) return;
    el.querySelector(".meta").textContent = t("scan.searchingShort");
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
        `<span class="pill err">${esc(t("scan.notExist", { set: m[1].toUpperCase(), num: m[2], token: m[3] ? t("scan.asToken") : "" }))}</span>`;

      const r = await findCard(v, $("#d-lang").value);
      if (r.card) await addToCollection(r.card, el);
      else if (r.candidates.length) renderManual(el, v, r.candidates);
      else el.querySelector(".meta").innerHTML =
        `<span class="pill err">${esc(t("scan.noNameMatch"))}</span>`;
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
/* Bestand einer AUFLAGE über alle Ausführungen hinweg: für „habe ich die
   Karte?" sind Sprache, Foil und Zustand egal — gezählt wird alles mit
   demselben Set + Sammlernummer. (Über Set+Nummer, nicht scryfall_id:
   verschiedene Sprachfassungen derselben Auflage tragen eigene IDs.)
   Ohne Set/Nummer (Uralt-Zeilen) zählt die einzelne Zeile. */
function bestandVon(c) {
  if (!c.set || !c.cn) return c.qty;
  return CARDS.reduce((s, x) => s + (x.set === c.set && x.cn === c.cn ? x.qty : 0), 0);
}

function sortWert(key, c, e) {
  const qty = e ? e.qty : c.qty;
  if (key === "name")  return c.disp;
  if (key === "mana")  return c.cmc;
  if (key === "qty")   return qty;
  if (key === "fehlt") return e ? Math.max(0, e.qty - bestandVon(c)) : 0;
  // Erscheinungsdatum liegt als "2024-07-05" vor. Da sortiert die
  // Zeichenkette schon chronologisch — Jahr, Monat, Tag stehen in genau der
  // Reihenfolge und mit fester Stellenzahl. Kein Date-Objekt nötig.
  // Das || "" hält den Typ stabil: mischten sich null und Zeichenkette,
  // liefen die beiden Zweige von cmpWert durcheinander.
  if (key === "released") return c.released || "";
  // Zustand nach Qualität sortieren (MT best … PO schlecht), nicht alphabetisch.
  if (key === "condition") return CONDITION_RANK[(c.condition || "").toUpperCase()] ?? 99;
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
  const fs = $("#f-set").value, ff = $("#f-foil").value, ft = $("#f-type").value;
  return CARDS.filter(c =>
    // qty 0 = „im Deck, aber nicht besessen" (aus einem Deck-Import). Gehört
    // NICHT in die Sammlung — nur ins Deck, wo es als „fehlen" erscheint.
    c.qty > 0 &&
    (!q || c.name.toLowerCase().includes(q) || c.disp.toLowerCase().includes(q) ||
           (c.set_name || "").toLowerCase().includes(q)) &&
    (!fs || c.set === fs) &&
    (ff === "" || String(c.foil ? 1 : 0) === ff) &&
    (!ft || typMatch(c.type_line, ft))
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

/* Preis-Zelle der Liste: €-Preis, darunter der Mini-Graph — gestapelt statt
   nebeneinander. Fehlt die Historie (spark liefert ""), bleibt nur der Preis,
   ohne Leerzeile darunter. */
function preisZelle(c) {
  const graph = spark(c.hist);
  return graph ? `${eur(c.price)}<br>${graph}` : eur(c.price);
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
    <th${s("name")}>${esc(t("th.card"))}</th>
    <th${s("mana")} class="num">${esc(t("th.mana"))}</th>
    <th${s("set_name")} class="hide-s">${esc(t("th.set"))}</th>
    <th${s("lang")} class="hide-s">${esc(t("th.langShort"))}</th>
    ${imDeck ? "" : `<th${s("condition")} class="hide-s">${esc(t("th.condShort"))}</th>
    <th${s("released")} class="hide-s">${esc(t("th.released"))}</th>
    <th${s("added")} class="hide-s">${esc(t("th.added"))}</th>`}
    <th${s("qty")} class="num">${esc(t("th.qty"))}</th>
    ${imDeck ? `<th${s("fehlt")} class="num">${esc(t("th.stock"))}</th>`
             : `<th${s("price")} class="num">${esc(t("th.price"))}</th>`}
    <th></th><th></th>
  </tr>`;
}

function cardRow(c, o = {}) {
  const imDeck = !!o.deckId;
  const qty = imDeck ? o.qty : c.qty;
  // Fehlbestand gegen den AUFLAGEN-Bestand (Sprache/Foil/Zustand egal), nicht
  // gegen die einzelne verknüpfte Zeile — wichtig bei importierten Decks.
  const fehlt = imDeck ? Math.max(0, qty - bestandVon(c)) : 0;
  return `
    <tr data-id="${c.id}"${imDeck ? ` data-deck="${esc(o.deckId)}"` : ""}>
      <td class="hide-s">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" data-view
             style="cursor:pointer" title="${esc(t("row.viewTitle"))}">` : ""}</td>
      <td><div data-view style="cursor:pointer" title="${esc(t("row.viewTitle"))}">${esc(c.disp)}</div>
          <div style="font-size:12px;color:var(--dim)">
            ${c.printed_name && c.printed_name !== c.name ? esc(c.name) + " &middot; " : ""}
            ${c.foil ? '<span class="pill foil">Foil</span> ' : ""}#${esc(c.cn)}</div></td>
      <td class="num mana-spalte" title="${c.mana_cost == null ? esc(t("row.manaNone"))
        : esc(t("row.manaValue", { n: c.cmc ?? "?" }))}">${manaHtml(c.mana_cost)}</td>
      <td class="hide-s">${esc(c.set_name || c.set || "")}
          ${c.rarity ? `<div style="margin-top:3px">${rarityPill(c.rarity)}</div>` : ""}</td>
      <td class="hide-s">${langHtml(c.lang)}</td>
      ${imDeck ? "" : `<td class="hide-s">${condBadge(c.condition)}</td>
      <td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap">${esc(datShort(c.released))}</td>
      <td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap;line-height:1.35">${dtStacked(c.added)}</td>`}
      <!-- 54 px ist die schmalste Breite, bei der drei Stellen noch ganz
           hineinpassen (gemessen, inklusive Spinner-Pfeilen; ab 50 px wird
           abgeschnitten). Zwei Stellen sind der Regelfall, aber 100 Wälder
           sind kein Sonderfall genug, um sie unlesbar zu machen. -->
      <td class="num"><input type="number" min="0" value="${qty}" data-qty
             style="width:54px;padding:4px 6px;text-align:right"></td>
      ${imDeck ? `<td class="num">${fehlt
        ? `<span class="pill err">${esc(t("row.missing", { n: fehlt }))}</span>`
        : `<span class="pill ok">${esc(t("row.present"))}</span>`}</td>`
      : `<td class="num" style="line-height:1.5">${preisZelle(c)}</td>`}
      <td class="num cm-cell" style="white-space:nowrap">${cmLink(c.cm_id)
        ? `<a class="cm cm-logo" href="${esc(cmLink(c.cm_id))}" target="_blank" rel="noopener noreferrer"
             title="${esc(t("row.cmTitle"))}">${CM_LOGO}</a>` : ""}${sfLink(c)
        ? `<a class="cm sf-logo" href="${esc(sfLink(c))}" target="_blank" rel="noopener noreferrer"
             title="${esc(t("row.sfTitle"))}">${SF_LOGO}</a>` : ""}</td>
      <td class="num" style="white-space:nowrap">
        ${imDeck
          // Bearbeiten und Preis stehen im Deck in der Detailansicht — hier
          // nur, was das Deck betrifft: Hauptkarte und Zuordnung lösen.
          // Der Stern erscheint nur bei möglichen Commandern; die Regel selbst
          // erzwingt ein Trigger in der Datenbank.
          ? (istCommanderFaehig(c)
            ? `<button class="btn ghost sm${o.istHaupt ? " star-on" : ""}" data-main
              title="${o.istHaupt ? esc(t("row.mainIsTitle"))
                                  : esc(t("row.mainSetTitle"))}">${o.istHaupt ? "&#9733;" : "&#9734;"}</button>`
            : "")
          : `<button class="btn ghost sm" data-edit title="${esc(t("row.editTitle"))}">&#9998;</button>
        <button class="btn ghost sm" data-price title="${esc(t("row.priceTitle"))}">&#8635;</button>
        <button class="btn ghost sm sell-toggle${c.for_sale ? " on" : ""}" data-sell title="${esc(t("row.sellTitle"))}">&#8364;</button>`}
        <button class="btn ghost sm" data-del title="${imDeck
          ? esc(t("row.removeFromDeck")) : esc(t("row.removeRow"))}">&times;</button>
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
        toast(p == null ? t("toast.noPrice") : t("toast.priceUpdated", { p: eur(p) }));
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

    const sl = tr.querySelector("[data-sell]");
    if (sl) sl.onclick = () => toggleSale(id, sl);

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
        toast(deck ? t("toast.removedFromDeck") : t("toast.cardRemoved"));
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

/* Sprachunabhängiger Typ-Test (type_line ist englisch): steht der Typ irgendwo in
   der — evtl. zweiseitigen — Typzeile? Gleiches Muster wie istLand und das Typen-
   Diagramm. typLabel liefert das lokalisierte Etikett zum englischen Schlüssel. */
const typMatch = (tl, en) => new RegExp(`(^|//\\s*)[^/]*\\b${en}\\b`, "i").test(tl || "");
const typLabel = en => t("type." + en.toLowerCase());

/* Reihenfolge der aufklappbaren Deck-Kategorien = zugleich Zuordnungspriorität
   (erste passende gewinnt → „Artifact Creature" zählt zu den Kreaturen). Ohne
   Treffer „Sonstige" (deckKatKey liefert dann ""). */
const DECK_KAT_ORDNUNG = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];
const deckKatKey = c => DECK_KAT_ORDNUNG.find(en => typMatch(c.type_line || "", en)) || "";

function balkenHtml(daten, hinweis) {
  if (!daten.length) return '<div class="empty" style="padding:14px">Nichts auszuwerten.</div>';
  const max = Math.max(1, ...daten.map(d => d.wert));
  return `<div class="balken">${daten.map(d => `
    <div class="balken-zeile" title="${esc(d.label)}: ${esc(String(d.text ?? d.wert))}">
      <div class="balken-spur"><i style="width:${(d.wert / max * 100).toFixed(1)}%${
        d.farbe ? `;background:${d.farbe}` : ""}"></i><span class="balken-label">${d.icon || ""}<span>${esc(d.label)}</span></span></div>
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
    [t("dash.total"), n],
    [t("dash.distinct"), new Set(rows.map(c => c.oracle_id)).size],
    [t("dash.marketValue"), eur(gesamtwert)],
    [t("dash.avgPerCard"), eur(n ? gesamtwert / n : 0)],
    [t("dash.foils"), stueck(rows.filter(c => c.foil))],
    [t("dash.sets"), new Set(rows.map(c => c.set)).size],
    // toFixed gibt "3.64" — im Deutschen gehört da ein Komma hin.
    [t("dash.avgMv"), mwAnzahl ? (mwSumme / mwAnzahl).toFixed(2).replace(".", ",") : "–"],
    [t("dash.years"), jahre.length ? `${jahre[0]}–${jahre[jahre.length - 1]}` : "–"],
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
    .map(l => ({ label: langName(l), icon: flaggeHtml(l, true),
                 wert: stueck(rows.filter(c => c.lang === l)) }))
    .sort((a, b) => b.wert - a.wert);

  const zustand = CONDITION_CODES
    .map(code => ({ code, wert: stueck(rows.filter(c => (c.condition || "").toUpperCase() === code)) }))
    .filter(d => d.wert)
    .map(d => ({ label: CONDITION_BY[d.code].name, icon: condBadge(d.code),
                 farbe: CONDITION_BY[d.code].color, wert: d.wert }));

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
      &#9432; ${esc(t("dash.filteredHint", { n }))}</p>` : ""}
    <div class="dash-raster">
      ${karte(t("dash.manaCurve"), saeulenHtml(kurve, t("dash.manaCurveHint")))}
      ${karte(t("dash.colors"), tortenHtml(farbTorte, t("dash.colorsHint")))}
      ${karte(t("dash.rarity"), tortenHtml(seltenheit))}
      ${karte(t("dash.cardTypes"), tortenHtml(typen, t("dash.typesHint")))}
      ${karte(t("dash.topValue"), balkenHtml(topWert))}
      ${karte(t("dash.yearsChart"), saeulenHtml(proJahr, "", true))}
      ${karte(t("dash.topSets"), balkenHtml(topSets))}
      ${karte(t("dash.languages"), balkenHtml(sprachen))}
      ${karte(t("dash.conditionChart"), balkenHtml(zustand))}
    </div>`;

  // Muss nach dem Einhängen passieren: vorher hat der Kasten keine Breite
  // und scrollLeft bliebe wirkungslos.
  ziel.querySelectorAll("[data-ans-ende]").forEach(el => el.scrollLeft = el.scrollWidth);
}

/* Aktuelle Seite der Sammlungstabelle (0-basiert). Nur im Speicher: eine
   Seitenzahl ist kein Dauerzustand. Filter, Suche und Sortierung springen
   zurück auf Seite 1. */
let collPage = 0;

/* Karten je Sammlungsseite aus dem Profil (Einstellungen): 0 = alles in einer
   Liste, NULL/fehlt = Voreinstellung 50. */
function seitenGroesse() {
  const n = Number(PROFILE?.page_size);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

function renderCollection() {
  const rows = filtered();
  // Das Dashboard sitzt jetzt in einer eigenen Ansicht (renderDashboard) und
  // nicht mehr über der Sammlungstabelle. qty-0-Zeilen (Import-Platzhalter)
  // sind nie Teil der Sammlung.
  const besessen = CARDS.filter(c => c.qty > 0);

  const sets = [...new Set(besessen.map(c => c.set))].filter(Boolean).sort();
  const cur = $("#f-set").value;
  $("#f-set").innerHTML = `<option value="">${esc(t("coll.all"))}</option>` +
    sets.map(s => `<option value="${esc(s)}"${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");
  // Typ-Filter: feste Liste mit lokalisierten Etiketten, Auswahl bleibt erhalten.
  const curTyp = $("#f-type").value;
  $("#f-type").innerHTML = `<option value="">${esc(t("coll.all"))}</option>` +
    TYPEN.map(([en]) => `<option value="${esc(en)}"${en === curTyp ? " selected" : ""}>${esc(typLabel(en))}</option>`).join("");

  $("#coll-empty").textContent = besessen.length
    ? t("coll.emptyFilter")
    : t("coll.empty");
  $("#coll-empty").style.display = rows.length ? "none" : "block";
  $("#tbl").style.display = rows.length ? "" : "none";

  // Seitenaufteilung — nur für die Tabelle. Die Seitenzahl klemmt sich fest,
  // falls Löschen oder ein engerer Filter sie über das Ende geschoben hat.
  const gr = seitenGroesse();
  const seiten = gr ? Math.max(1, Math.ceil(rows.length / gr)) : 1;
  collPage = Math.max(0, Math.min(collPage, seiten - 1));
  const seite = gr ? rows.slice(collPage * gr, (collPage + 1) * gr) : rows;

  $("#tbl thead").innerHTML = cardHead(false);
  $("#tbl tbody").innerHTML = seite.map(c => cardRow(c)).join("");
  wireCardRows($("#tbl"));
  renderPager(rows.length, seiten);
  aktualisiereVerkaufZaehler();

  // Die Kopfzeile wird bei jedem Rendern neu gebaut, also auch die
  // Sortier-Handler neu hängen.
  $$("#tbl th[data-s]").forEach(th => th.onclick = () => {
    const z = { key: sortKey, dir: sortDir };
    sortUm(z, th.dataset.s);
    sortKey = z.key; sortDir = z.dir;
    collPage = 0;                          // neue Ordnung: oben anfangen
    renderCollection();
  });
}

/* Blätterleiste unter der Sammlungstabelle. Erscheint erst ab zwei Seiten.
   Kompakte Seitenliste: erste, letzte und die Umgebung der aktuellen Seite,
   Lücken als „…". */
function renderPager(gesamt, seiten) {
  const el = $("#pager");
  if (!el) return;
  if (seiten <= 1) { el.innerHTML = ""; return; }
  const gr = seitenGroesse();
  const von = collPage * gr + 1, bis = Math.min(gesamt, (collPage + 1) * gr);
  const nums = [...new Set([0, seiten - 1, collPage - 1, collPage, collPage + 1])]
    .filter(n => n >= 0 && n < seiten).sort((a, b) => a - b);
  let knoepfe = "", prev = -1;
  for (const n of nums) {
    if (prev >= 0 && n - prev > 1) knoepfe += '<span class="pager-dots">&hellip;</span>';
    knoepfe += `<button class="btn ghost sm${n === collPage ? " pager-on" : ""}" data-page="${n}">${n + 1}</button>`;
    prev = n;
  }
  el.innerHTML = `
    <button class="btn ghost sm" data-page="${collPage - 1}"${collPage === 0 ? " disabled" : ""}>&lsaquo; ${esc(t("pager.back"))}</button>
    ${knoepfe}
    <button class="btn ghost sm" data-page="${collPage + 1}"${collPage >= seiten - 1 ? " disabled" : ""}>${esc(t("pager.next"))} &rsaquo;</button>
    <span class="hint" style="margin-left:auto">${esc(t("pager.range", { von, bis, gesamt }))}</span>`;
  el.querySelectorAll("[data-page]").forEach(b => b.onclick = () => {
    collPage = Math.max(0, Math.min(seiten - 1, parseInt(b.dataset.page)));
    renderCollection();
    // Beim Blättern an den Tabellenanfang — sonst steht man am Seitenfuß.
    // scroll-margin-top in der CSS hält den klebenden Kopf frei.
    $("#tbl").scrollIntoView({ behavior: "smooth", block: "start" });
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
  // Seiten einer zweiseitigen Karte nachtragen (fürs Umdrehen in der
  // Detailansicht). facesOf liefert nur bei echten Vorder-/Rückseiten-Karten
  // etwas — einseitige bleiben null und werden nicht angefasst.
  if (c.faces == null) {
    const fc = facesOf(fresh);
    if (fc != null) patch.faces = fc;
  }
  if (!Object.keys(patch).length) return;
  const { error } = await sb.from("cards").update(patch).eq("id", c.id);
  if (error) throw new Error(dbErr(error));
}

/* Preis einer einzelnen Karte neu holen. Zeile und Detailansicht teilen sich
   diesen Weg — sonst füllt nur einer von beiden die Lücken nach. */
async function preisNeuZiehen(c) {
  const fresh = await withPrice(await sfById(c.scryfall_id));
  if (!fresh) throw new Error(t("err.cardNotFound"));
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
    btn.textContent = t("coll.updatingProgress", { done: ++done, total: uniq.length });
    let fresh = null;
    // withPrice zieht bei fremdsprachigen Auflagen den Preis der englischen
    // Auflage nach — genau wie der Einzel-Weg (preisNeuZiehen). Ohne das blieben
    // deutsche Karten hier ohne eur-Preis und set_price schriebe price = null.
    try { fresh = await withPrice(await sfById(sid)); } catch { failed++; continue; }
    if (!fresh) { failed++; continue; }
    for (const c of CARDS.filter(x => x.scryfall_id === sid)) {
      const { error } = await sb.rpc("set_price", { p_card_id: c.id, p_price: priceOf(fresh, c.foil) });
      if (error) { failed++; continue; }
      try { await nachtragen(c, fresh); } catch { failed++; }
    }
  }
  try { await reload(); renderAll(); } catch (e) { toast(dbErr(e)); }
  btn.disabled = false; btn.textContent = t("coll.updatePrices");
  toast(failed ? t("toast.pricesUpdatedSome", { n: failed }) : t("toast.pricesUpdated"));
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
  const name = langName(l);
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
  if (LANG_NAMES[l]) return `<span class="pill" title="${esc(langName(l))} ${esc(t("flag.noFlagSuffix"))}"
                          >${esc(l.toUpperCase())}</span>`;
  return `<span class="pill err" title="${esc(t("flag.noLangCode", { code: l.toUpperCase() }))}"
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

/* Wie dtShort, aber Datum und Uhrzeit gestapelt (Datum oben, Uhrzeit darunter)
   — nur für die Tabellenspalte „Hinzugefügt". Die Detailansicht nutzt weiter
   dtShort in einer Zeile. Datum/Uhrzeit stammen aus dem ISO-Zeitstempel und
   sind reine Ziffern/Trenner, das <br> ist gewolltes Markup. */
const dtStacked = iso => {
  if (!iso) return "–";
  const d = new Date(iso);
  const tag = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${tag}<br>${uhr}`;
};

/* Preisverlauf als richtiger Graph: Gitterlinien mit Eurowerten, Datum an
   den Enden, ein Punkt pro Tag (bis 60, so weit reicht die Historie).
   Grün bei gestiegenem, rot bei gefallenem Kurs — wie die Mini-Kurve. */
function priceChart(hist, w = 560, h = 200) {
  const H = (hist || []).map(p => ({ d: p.d, v: Number(p.v) })).filter(p => !isNaN(p.v));
  if (!H.length) return `<p class="hint">${esc(t("detail.noHistory"))}</p>`;
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
    if (m) return { typ: "loyalty", name: "", kosten: m[1], effekt: m[2] };

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
      return { typ: "keyword", name: treffer,
               kosten: symbole ? symbole.join("") : "",
               effekt: rem ? rem[1] : "" };
    }

    // Aktiviert: "Kosten: Wirkung" — Kosten müssen wie Kosten aussehen (Symbol
    // oder ein einleitendes Kostenwort), sonst faengt die Regel Saetze mit
    // Doppelpunkt fälschlich ab.
    m = z.match(/^([^:]{1,60}):\s+(.+)$/);
    if (m && (/\{[^}]+\}/.test(m[1]) ||
              /^(Tap|Untap|Sacrifice|Discard|Pay|Exile|Remove|Return|Reveal)\b/i.test(m[1])))
      return { typ: "activated", name: "", kosten: m[1].trim(), effekt: m[2] };

    // Ausgelöst
    if (/^(When|Whenever|At )/i.test(z)) return { typ: "triggered", name: "", kosten: "", effekt: z };

    return { typ: "static", name: "", kosten: "", effekt: z };
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
        <summary>${esc(t("detail.abBreakdown"))} <span class="hint" style="display:inline">${esc(t("detail.abAuto"))}</span></summary>
        <table class="faehig-tbl"><thead><tr>
          <th>${esc(t("common.name"))}</th><th>${esc(t("detail.abType"))}</th><th>${esc(t("detail.abCost"))}</th><th>${esc(t("detail.abEffect"))}</th></tr></thead>
        <tbody>${ab.map(a => `<tr>
          <td>${a.name ? esc(a.name) : "—"}</td>
          <td>${esc(t("ab." + a.typ))}</td>
          <td class="num" style="white-space:nowrap">${a.kosten ? mitSymbolen(a.kosten) : "—"}</td>
          <td>${a.effekt ? mitSymbolen(a.effekt) : "—"}</td></tr>`).join("")}</tbody></table>
      </details>`);
  }
  if (!teile.length) return "";
  return `<div style="margin-top:10px"><label style="margin-bottom:4px">${esc(t("detail.abilities"))}</label>${teile.join("")}</div>`;
}

/* ------------------------------------------ Zweiseitige Karten ------ */
/* Sicht auf EINE Seite einer zweiseitigen Karte: dieselbe Form wie eine ganze
   Karte, aber Name/Typ/Kosten/Regeltext/Schlüsselwörter/Bild der gewählten
   Seite. So rendern die seitenabhängigen Teile der Detailansicht mit demselben
   Code wie bei einseitigen Karten. */
function faceView(c, i) {
  const f = (c.faces && c.faces[i]) || {};
  return { ...c,
    disp: f.printed || f.name || c.disp,
    name: f.name ?? c.name,
    printed_name: f.printed ?? null,
    mana_cost: f.mana_cost,
    type_line: f.type_line,
    oracle_text: f.oracle_text,
    keywords: f.keywords,
    img: f.img || c.img };
}

/* Seitenabhängiger Kopf (Name + Manakosten, darunter der englische Name bei
   fremdsprachigem Druck) und Rumpf (Typzeile + Fähigkeiten). Beim Umdrehen
   werden nur diese beiden Teile ersetzt — Auflagenzeile, Pillen und Werkzeuge
   bleiben stehen. */
function faceTopHtml(v) {
  return `<div class="name-zeile"><b style="font-size:17px">${esc(v.disp)}</b>${v.mana_cost
      ? `<span class="mana-kosten">${manaHtml(v.mana_cost)}</span>` : ""}</div>
    ${v.printed_name && v.printed_name !== v.name ? `<div class="hint" style="margin:0">${esc(v.name)}</div>` : ""}`;
}
function faceBottomHtml(v, hover) {
  return `${v.type_line ? `<div class="hint" style="margin-top:2px">${esc(v.type_line)}</div>` : ""}
    ${faehigkeitenHtml(v, hover)}`;
}

/* Umdrehbares Kartenbild: Vorder- und Rückseite im selben Rahmen, per 3D-Dreh
   umgeschlagen. Klick (oder Enter/Leertaste) auf das Bild dreht — verdrahtet in
   wireFlip. Die Bild-URLs tragen die Größe im Pfad, aus small wird normal. */
function flipHtml(c) {
  const norm = u => (u || "").replace("/small/", "/normal/");
  const front = norm(c.faces[0].img || c.img), back = norm(c.faces[1].img);
  return `<div class="detail-flip" id="dt-flip" role="button" tabindex="0"
      title="${esc(t("detail.flipHint"))}" aria-label="${esc(t("detail.flipHint"))}">
      <div class="detail-flip-inner">
        <img class="flip-face flip-front" src="${esc(front)}" alt="">
        <img class="flip-face flip-back" src="${esc(back)}" alt="">
      </div>
      <span class="flip-badge" aria-hidden="true">&#8635;</span>
    </div>`;
}

/* Gemeinsame Vorlage für Dialog und Hover-Vorschau. Der Preisgraph sitzt in
   der rechten Spalte unter dem Hinzugefügt-Datum — kompakt (320er-viewBox),
   damit die Beschriftung beim Skalieren lesbar bleibt. */
function detailHtml(c, hover) {
  // Zweiseitige Karte im Dialog: mit Seite 0 (Vorderseite) starten und das
  // Umdrehen ermöglichen. Die Hover-Vorschau bleibt schlicht bei der Vorderseite.
  const faced = !hover && Array.isArray(c.faces) && c.faces.length >= 2;
  const v = faced ? faceView(c, 0) : c;
  // Scryfall-Bild-URLs tragen die Größe im Pfad — aus small wird normal
  // (488×680), ohne einen weiteren API-Aufruf.
  const gross = (c.img || "").replace("/small/", "/normal/");
  // Kauf-/Scryfall-Logos: nur im Dialog, nicht in der Hover-Vorschau.
  const links = !hover
    ? `${cmLink(c.cm_id) ? `<a class="cm cm-logo" href="${esc(cmLink(c.cm_id))}" target="_blank" rel="noopener noreferrer" title="${esc(t("row.cmTitle"))}">${CM_LOGO}</a>` : ""}${sfLink(c) ? `<a class="cm sf-logo" href="${esc(sfLink(c))}" target="_blank" rel="noopener noreferrer" title="${esc(t("row.sfTitle"))}">${SF_LOGO}</a>` : ""}`
    : "";
  // Werkzeuge nur im Dialog: gruppiert und beschriftet (Verwaltung / Vorschläge
  // & Combos), Legalität und Preisverlauf aufklappbar. In der Hover-Vorschau
  // bleibt nur der schlichte Preisgraph.
  const block = !hover ? `
        <div class="sec-sep"></div>
        <div class="tool-group"><span class="tool-label">${esc(t("detail.groupManage"))}</span>
          <div class="tool-row">
            <button class="btn ghost sm" id="dt-edit" title="${esc(t("row.editTitle"))}">&#9998; ${esc(t("detail.edit"))}</button>
            <button class="btn ghost sm" id="dt-price" title="${esc(t("detail.priceBtnTitle"))}">&#8635; ${esc(t("detail.priceBtn"))}</button>
          </div>
        </div>
        <div class="sec-sep"></div>
        <details class="legal-det" id="dt-legal"><summary>&#9878; ${esc(t("legal.title"))}</summary>
          <div id="dt-legal-body"><div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("legal.loading"))}</div></div>
        </details>
        <div class="sec-sep"></div>
        <div class="tool-group"><span class="tool-label">${esc(t("detail.groupTools"))}</span>
          <div class="tool-row">
            <div class="field" style="width:118px"><label>${esc(t("deck.maxPerCard"))}</label>
              <input type="number" id="syn-cap" min="0" step="0.5" value="${prefWert("capDefault") ?? ""}"
                placeholder="${esc(t("syn.capPh"))}" title="${esc(t("syn.capTitle"))}"></div>
            <button class="btn ghost sm syn-std-btn" id="dt-syn" title="${esc(t("syn.findTitle"))}">&#128269; ${esc(t("syn.find"))}</button>
            <button class="btn ghost sm syn-ai-btn" id="dt-syn-ai" title="${esc(t("syn.aiTitle"))}">&#10024; ${esc(t("syn.ai"))}</button>
            <button class="btn ghost sm" id="dt-combos" title="${esc(t("combo.cardTitle"))}">&#128279; ${esc(t("combo.btn"))}</button>
          </div>
        </div>`
    : `<div style="margin-top:10px">
          <label style="margin-bottom:2px">${esc(t("detail.priceHistory"))}</label>
          ${priceChart(c.hist, 320, 150)}
        </div>`;
  return `
    <div class="detail">
      ${!hover ? `<div class="detail-added">${esc(t("detail.added"))}: ${esc(dtShort(c.added))} ${esc(t("detail.addedSuffix"))}</div>` : ""}
      ${faced ? flipHtml(c) : (gross ? `<img class="detail-img" src="${esc(gross)}" alt="">` : "")}
      <div class="detail-info">
        ${!hover ? `<div class="detail-face-top" id="dt-face-top">${faceTopHtml(v)}</div>` : faceTopHtml(v)}
        <div class="hint" style="margin-top:2px">${esc(c.set_name || c.set)} · #${esc(c.cn)}${
          c.released ? ` · erschienen ${esc(datShort(c.released))}` : ""}</div>
        ${!hover ? `<div class="detail-face-bottom" id="dt-face-bottom">${faceBottomHtml(v, hover)}</div>` : faceBottomHtml(v, hover)}
        <div class="detail-copy">
          ${rarityPill(c.rarity)}
          ${c.foil ? '<span class="pill foil">Foil</span>' : ""}
          <span class="pill">${flaggeHtml(c.lang, true)} ${esc(langName(c.lang))}</span>
          ${condBadge(c.condition)}
          <span class="pill">${esc(t("common.qtyLabel"))} ${c.qty}</span>
          <span class="detail-preis">${esc(t("detail.price"))}: <b>${eur(c.price)}</b></span>
          ${links}
        </div>
        ${block}
        ${hover ? `<div class="hint" style="margin-top:10px">${esc(t("detail.added"))}: ${esc(dtShort(c.added))} ${esc(t("detail.addedSuffix"))}</div>` : ""}
      </div>
    </div>
    ${!hover ? `<details class="legal-det dt-price-full"><summary>&#128200; ${esc(t("detail.priceHistory"))}</summary>
      <div style="margin-top:8px">${priceChart(c.hist, 900, 200)}</div>
    </details>
    <div id="syn-box" class="dt-results-full"></div>
    <div id="card-combo-box" class="dt-results-full"></div>` : ""}`;
}

function showCardDetail(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  renderDetail(c, id);
  // showModal wirft, wenn der Dialog schon offen ist — beim Neuzeichnen (nach
  // Preis-Update oder nachgeladenen Seiten) also nur den Inhalt ersetzen.
  if (!$("#detail-dlg").open) $("#detail-dlg").showModal();
}

/* Inhalt der Detailansicht zeichnen und verdrahten — getrennt vom Öffnen,
   damit dieselbe Ansicht bei offenem Dialog neu gezeichnet werden kann. */
function renderDetail(c, id) {
  $("#detail-body").innerHTML = detailHtml(c, false);
  wireFlip(c, id);

  // Erst schließen, dann bearbeiten: zwei gestapelte Dialoge wären fragil.
  $("#dt-edit").onclick = () => { $("#detail-dlg").close(); editCard(id); };
  const pb = $("#dt-price");
  pb.onclick = async () => {
    pb.disabled = true;
    try {
      const p = await preisNeuZiehen(c);
      await reload(); renderAll();
      toast(p == null ? t("toast.noPrice") : t("toast.priceUpdated", { p: eur(p) }));
      // Ansicht mit dem frischen Preis und dem neuen Kurvenpunkt neu zeichnen.
      if ($("#detail-dlg").open) showCardDetail(id);
    } catch (e) { pb.disabled = false; toast(e.message); }
  };
  // Synergien: passende Karten zu dieser Karte (nur die Karte selbst raus).
  const yb = $("#dt-syn");
  if (yb) yb.onclick = () => {
    const lbl = t("syn.find");
    synBtnBusy(yb, lbl, true);
    synGeschwister([$("#dt-syn-ai")], true);
    const weg = excludeVon([c]);   // nur die Ausgangskarte selbst raus, Besessenes darf auftauchen
    synergieAnzeigen($("#syn-box"), synergyHooks(c),
      { excludeIds: weg.ids, excludeNames: weg.names, limit: 18, maxPrice: numVal($("#syn-cap")) })
      .finally(() => { synBtnBusy(yb, lbl, false); synGeschwister([$("#dt-syn-ai")], false); });
  };
  // KI-Synergien: implizite Vorschläge über die Edge Function. Solange sie läuft,
  // ist der Standard-Synergien-Knopf gesperrt (Konflikt um denselben Kasten).
  const ab = $("#dt-syn-ai");
  if (ab) ab.onclick = () => {
    const lbl = t("syn.ai");
    synBtnBusy(ab, lbl, true, "&#10024;");
    synGeschwister([$("#dt-syn")], true);
    kiSynergien(c, $("#syn-box"), { maxPrice: numVal($("#syn-cap")) })
      .finally(() => { synBtnBusy(ab, lbl, false, "&#10024;"); synGeschwister([$("#dt-syn")], false); });
  };
  // Combos, in denen diese Karte vorkommt (Commander Spellbook) — eigener
  // Kasten, unabhängig von den Synergie-Knöpfen.
  const cb = $("#dt-combos");
  if (cb) cb.onclick = () => {
    const lbl = t("combo.btn");
    synBtnBusy(cb, lbl, true, "&#128279;");
    karteCombosAnzeigen($("#card-combo-box"), c)
      .finally(() => synBtnBusy(cb, lbl, false, "&#128279;"));
  };
  // Legalität: erst beim ersten Aufklappen von Scryfall laden (die Sammlung
  // speichert keine Legalitäten — sie wandern mit jeder Bannliste).
  const lg = $("#dt-legal");
  if (lg) lg.addEventListener("toggle", async () => {
    if (!lg.open || lg.dataset.geladen) return;
    lg.dataset.geladen = "1";
    const body = $("#dt-legal-body");
    try { body.innerHTML = legalGridHtml(await kartenLegalitaet(c.scryfall_id)); }
    catch { body.innerHTML = `<div class="empty">${esc(t("legal.error"))}</div>`; }
  });
}

/* Umdrehen verdrahten. Sind die Seiten bekannt, schaltet ein Klick (oder
   Enter/Leertaste) Bild und seitenabhängige Texte um. Fehlen die Seiten noch
   (Bestand von vor dieser Funktion), die Karte SIEHT aber zweiseitig aus, wird
   sie einmal von Scryfall nachgeladen, gespeichert und die Ansicht neu
   gezeichnet — danach ist das Umdrehen sofort verfügbar. */
function wireFlip(c, id) {
  const flip = $("#dt-flip");
  if (flip) {
    let hinten = false;
    const dreh = () => {
      hinten = !hinten;
      flip.classList.toggle("flipped", hinten);
      const v = faceView(c, hinten ? 1 : 0);
      $("#dt-face-top").innerHTML = faceTopHtml(v);
      $("#dt-face-bottom").innerHTML = faceBottomHtml(v, false);
    };
    flip.onclick = dreh;
    flip.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dreh(); } };
    return;
  }
  // Noch keine Seiten gespeichert: nur nachladen, wenn die Karte überhaupt
  // mehrseitig aussieht (einseitige lösen nie einen Abruf aus). Je Sitzung
  // höchstens ein Versuch.
  if (!looksMultiface(c) || c._facesTried) return;
  c._facesTried = true;
  (async () => {
    let fresh;
    try { fresh = await sfById(c.scryfall_id); } catch { return; }
    const fc = facesOf(fresh);
    if (!fc) return;                 // doch nur geteilt/Abenteuer — nicht umdrehbar
    c.faces = fc;
    try { await sb.from("cards").update({ faces: fc }).eq("id", c.id); }
    catch { /* Anzeige klappt auch ohne Speichern */ }
    if ($("#detail-dlg").open) renderDetail(c, id);
  })();
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

/* Commander-Vorschau: beim Hover über die kleine Commander-Karte in der
   Spielrunde eine große Kartenvorschau + Name schweben lassen (eigenes Element,
   nicht #hovercard — das ist 430px breit für die Sammlungs-Detailkarte). */
let cmdHoverEl = null;
function zeigeCmdHover(img, name, x, y) {
  if (!cmdHoverEl) { cmdHoverEl = document.createElement("div"); cmdHoverEl.className = "cmd-hover"; }
  // Ist ein modaler Dialog offen (Kartendetail via showModal → Top-Layer), muss
  // die Vorschau DARIN hängen — sonst rendert sie hinter dem Dialog, den kein
  // z-index überbietet. Sonst am body (z. B. Combos in der Deck-Ansicht).
  const ziel = document.querySelector("dialog[open]") || document.body;
  if (cmdHoverEl.parentElement !== ziel) ziel.appendChild(cmdHoverEl);
  const el = cmdHoverEl;
  el.innerHTML = `<img src="${esc(img)}" alt=""><div class="cmd-hover-nm">${esc(name)}</div>`;
  el.style.left = "0px"; el.style.top = "0px"; el.style.display = "block";
  const r = el.getBoundingClientRect();
  let l = x + 18, o = y + 14;
  if (l + r.width > innerWidth - 8) l = Math.max(8, x - r.width - 18);
  if (o + r.height > innerHeight - 8) o = Math.max(8, innerHeight - r.height - 8);
  el.style.left = l + "px"; el.style.top = o + "px";
}
function versteckeCmdHover() { if (cmdHoverEl) cmdHoverEl.style.display = "none"; }

/* ============================ Synergien ==============================
   Zu einer Karte (oder einem Deck) passende Karten über Fähigkeits-Synergien
   vorschlagen. Die „Haken" einer Karte sind ihre Schlüsselwörter, ihre
   Kreaturentypen (Tribal) und grobe Regeltext-Themen. Je Haken fragt Scryfall
   nach den beliebtesten passenden Karten (order:edhrec); wer von mehreren
   Haken getroffen wird, passt besser und steht oben. Bereits besessene Karten
   (und die Ausgangskarte) fallen raus — gesucht sind NEUE Karten. */
const SYNERGY_THEMES = [
  { key: "sacrifice", re: /\bsacrifice\b/i,                          q: "otag:sacrifice-outlet" },
  { key: "counters",  re: /\+1\/\+1 counter/i,                       q: "otag:counters-matter" },
  { key: "graveyard", re: /\bgraveyard\b/i,                          q: 'oracle:"from your graveyard"' },
  { key: "tokens",    re: /\bcreate\b[^.]*\btoken/i,                 q: 'oracle:"create" oracle:"token"' },
  { key: "lifegain",  re: /(gain[^.]*\blife\b|lifelink)/i,           q: "otag:lifegain" },
  { key: "mill",      re: /\bmill/i,                                 q: "oracle:mill" },
  { key: "discard",   re: /\bdiscard/i,                              q: "otag:discard-outlet" },
  { key: "ramp",      re: /(search your library for[^.]*\bland|add \{)/i, q: "otag:ramp" },
  { key: "equipment", re: /\bequip\b|\bequipment\b/i,                q: "type:equipment" },
  { key: "artifacts", re: /\bartifact\b/i,                           q: "oracle:artifact" },
];

/* Permanenten-Untertypen aus der Typzeile (nach dem Halbgeviertstrich „—"). */
function untertypen(typeLine) {
  const vorder = (typeLine || "").split("//")[0];
  const i = vorder.indexOf("—");
  return i < 0 ? [] : vorder.slice(i + 1).trim().split(/\s+/).filter(Boolean);
}

/* Gewicht je Hakenart: Fähigkeiten (Schlüsselwort, Regeltext-Thema) und
   Tribal-Payoffs — Karten, die einen Typ ausdrücklich belohnen („Elfen, die du
   kontrollierst …", die „wollen deinen Elf"-Richtung) — zählen deutlich mehr als
   bloße Typgleichheit („ist auch ein Elf"). Zwei Karten mit demselben Mechanismus
   passen besser zusammen als zwei, die nur denselben Kreaturentyp teilen. */
const HOOK_GEWICHT = { keyword: 3, theme: 3, payoff: 3, tribe: 1 };
const hookGewicht = kind => HOOK_GEWICHT[kind] || 1;

/* Plural eines Kreaturentyps: Tribal-Payoffs stehen im Text fast immer im Plural
   („Elves you control"); der Singular ist zu verrauscht (belegt per Scryfall). */
function pluralTyp(typ) {
  if (/^merfolk$/i.test(typ)) return typ;                 // unveränderlich
  if (/(s|x|z|ch|sh)$/i.test(typ)) return typ + "es";
  if (/f$/i.test(typ)) return typ.replace(/f$/i, "ves");  // Elf→Elves, Dwarf→Dwarves, Wolf→Wolves
  return typ + "s";
}

/* Synergie-Haken einer Karte: { kind, label, q }. Reihenfolge nach Aussagekraft
   (Schlüsselwörter, Themen, Tribal-Payoffs, zuletzt bloße Typgleichheit) — so
   bleiben beim Kappen (maxHooks) die stärksten Haken erhalten. */
function synergyHooks(card) {
  const hooks = [];
  (card.keywords || []).forEach(k => hooks.push({ kind: "keyword", label: k, q: `keyword:"${k}"` }));
  const text = card.oracle_text || "";
  SYNERGY_THEMES.forEach(th => { if (th.re.test(text)) hooks.push({ kind: "theme", label: th.key, q: th.q }); });
  const subs = /creature/i.test(card.type_line || "") ? untertypen(card.type_line) : [];
  subs.forEach(s => hooks.push({ kind: "payoff", label: s, q: `oracle:"${pluralTyp(s)}"` }));  // Karten, die den Typ belohnen
  subs.forEach(s => hooks.push({ kind: "tribe",  label: s, q: `type:${s.toLowerCase()}` }));     // weitere Karten des Typs
  return hooks;
}

/* Anzeige-Chip eines Hakens: Schlüsselwort/Tribe sind Kartendaten (bleiben),
   Themen werden übersetzt. */
function hookLabel(h) { return h.kind === "theme" ? t("syn.theme." + h.label) : h.label; }

/* Ausschlussmengen (oracle_id + Kleinschrift-Name) aus einer Kartenliste.
   Vorschläge dürfen jetzt AUCH besessene Karten enthalten — ausgeschlossen wird
   nur noch, was ohnehin schon da ist: bei Deck-Suchen die Karten DIESES Decks,
   bei der Kartensuche die Ausgangskarte selbst. */
function excludeVon(cards) {
  const ids = new Set(), names = new Set();
  for (const c of cards) {
    if (c && c.oracle_id) ids.add(c.oracle_id);
    if (c && c.name) names.add(c.name.toLowerCase());
  }
  return { ids, names };
}

/* Farbidentität einer Kartenliste als „WUBRG"-Teilmenge (für id<= bei Decks). */
function farbIdentitaet(cards) {
  const set = new Set();
  cards.forEach(c => (c.colors || []).forEach(f => set.add(f)));
  const s = ["W", "U", "B", "R", "G"].filter(f => set.has(f)).join("");
  return s || "c";
}

/* Preis einer Scryfall-Karte in Euro (Normal, sonst Foil), sonst null. */
function synPreis(card) {
  const r = card.prices?.eur || card.prices?.eur_foil;
  const n = r ? parseFloat(r) : NaN;
  return isFinite(n) ? n : null;
}

/* Positive Euro-Zahl aus einem Eingabefeld (Komma erlaubt), sonst null. */
function numVal(input) {
  if (!input) return null;
  const n = parseFloat(String(input.value || "").replace(",", "."));
  return isFinite(n) && n > 0 ? n : null;
}

let synergyLauf = 0;   // gegen veraltete Antworten bei schnellem erneuten Klick

/* Für eine Hakenliste die besten passenden Karten holen und mischen.
   opts: { excludeIds, excludeNames, colors, maxHooks, limit, maxPrice, totalBudget } */
async function synergieSuchen(hooks, opts = {}) {
  const excludeIds = opts.excludeIds || new Set();
  const excludeNames = opts.excludeNames || new Set();
  const idFilter = opts.colors ? ` id<=${opts.colors}` : "";
  const preisFilter = opts.maxPrice ? ` eur<=${opts.maxPrice}` : "";   // Höchstpreis je Karte
  const treffer = new Map();   // oracle_id -> { card, hooks:Map<label,kind> }
  for (const h of hooks.slice(0, opts.maxHooks || 6)) {
    const q = `${h.q} -is:token -is:funny game:paper${idFilter}${preisFilter}`;
    let data = [];
    try {
      const r = await fetch("https://api.scryfall.com/cards/search?order=edhrec&q=" + encodeURIComponent(q),
                            { headers: { Accept: "application/json" } });
      if (r.ok) data = (await r.json()).data || [];
    } catch { /* ein einzelner Haken darf scheitern */ }
    data.slice(0, 14).forEach(c => {
      if (!c.oracle_id || excludeIds.has(c.oracle_id) || excludeNames.has((c.name || "").toLowerCase())) return;
      const e = treffer.get(c.oracle_id) || { card: c, hooks: new Map() };
      e.hooks.set(h.kind + "|" + hookLabel(h), { kind: h.kind, label: hookLabel(h) });  // (Art,Label) je Treffer, entprellt
      treffer.set(c.oracle_id, e);
    });
    await new Promise(res => setTimeout(res, 110));   // Scryfall schonen
  }
  // Bewertung: Summe der Hakengewichte (Fähigkeiten > Tribal), erst danach der
  // EDHREC-Rang als Feinschliff. So steht eine Karte, die dieselbe Fähigkeit
  // teilt, über einer, die nur denselben Kreaturentyp hat.
  const punkte = e => [...e.hooks.values()].reduce((s, v) => s + hookGewicht(v.kind), 0);
  // Einstellung „nur eigene Sammlung": Vorschläge auf besessene Karten begrenzen
  // (besessenAnzahl gleicht über die oracle_id ab — Sprache/Foil egal).
  let kandidaten = [...treffer.values()];
  if (suchPrefs().onlyOwned) kandidaten = kandidaten.filter(e => besessenAnzahl(e.card) > 0);
  let rang = kandidaten
    .sort((a, b) => (punkte(b) - punkte(a)) ||
                    ((a.card.edhrec_rank ?? 9e9) - (b.card.edhrec_rank ?? 9e9)))
    // Die eingestellte Höchstzahl (Profil) schlägt die Voreinstellung des Aufrufers.
    .slice(0, prefWert("synLimit") || opts.limit || 18);
  // Gesamtbudget (Deck): beste Synergien zuerst aufnehmen, bis das Geld reicht.
  // Zu teure werden übersprungen (billigere weiter unten kommen noch rein);
  // Karten ohne Preis lassen sich nicht budgetieren und fallen dabei raus.
  if (opts.totalBudget) {
    let summe = 0; const gewaehlt = [];
    for (const e of rang) {
      const p = synPreis(e.card);
      if (p == null || summe + p > opts.totalBudget) continue;
      gewaehlt.push(e); summe += p;
    }
    rang = gewaehlt;
  }
  return rang;
}

/* Kurze Erklärung, warum die Karte passt: aus den getroffenen Haken (Typ,
   Schlüsselwort, Thema) plus einem Hinweis, wenn sie häufig gespielt wird. */
function synergyErklaerung(e) {
  const kw = [], th = [], po = [], tr = [];
  for (const { kind, label } of e.hooks.values())
    (kind === "keyword" ? kw : kind === "theme" ? th : kind === "payoff" ? po : tr).push(label);
  // „ist auch ein Elf" weglassen, wenn die Karte Elfen ohnehin belohnt.
  const poSet = new Set(po);
  const trOnly = tr.filter(l => !poSet.has(l));
  // Fähigkeiten und Payoffs zuerst nennen, den bloßen Typ zuletzt.
  const gruende = [];
  if (kw.length) gruende.push(t("syn.exp.keyword", { list: kw.join(", ") }));
  if (th.length) gruende.push(t("syn.exp.theme", { list: th.join(", ") }));
  if (po.length) gruende.push(t("syn.exp.payoff", { list: po.join(", ") }));
  if (trOnly.length) gruende.push(t("syn.exp.tribe", { list: trOnly.join(", ") }));
  const reasons = gruende.length <= 1 ? (gruende[0] || "")
    : gruende.slice(0, -1).join(", ") + " " + t("syn.exp.and") + " " + gruende[gruende.length - 1];
  return t(gruende.length >= 2 ? "syn.exp.multi" : "syn.exp.single", { reasons });
}

/* Eine Vorschlagskarte als Kachel: Bild, Name, Typ, Erklärung, Preis. */
/* Zuletzt gezeigte Vorschlags-Karten (Scryfall-Objekte, id→Objekt), damit der
   „Als Wunschkarte"-Knopf die vollen Daten zum Anlegen hat. */
const SYN_CACHE = new Map();

/* Wie oft besitzt man eine (Scryfall-)Karte? Abgleich über die oracle_id, denn
   alle Sprach-/Druck-/Foil-Fassungen teilen sie — eine deutsche Bolas' Zitadelle
   zählt also für den englischen Vorschlag. Name als Rückfall. Nur qty>0. */
function besessenAnzahl(card) {
  const oid = card.oracle_id, nm = (card.name || "").toLowerCase();
  let n = 0;
  for (const c of CARDS)
    if (c.qty > 0 && ((oid && c.oracle_id === oid) || (c.name || "").toLowerCase() === nm)) n += c.qty;
  return n;
}

/* Eine Vorschlagskachel. Bild/Name/Typ/Grund verlinken auf Scryfall; darunter
   der Preis und — NUR bei Deck-Vorschlägen (deckId gesetzt) — ein Knopf, der die
   Karte ins Deck legt. Besitzt man die Karte schon (irgendeine Auflage), zeigt
   die Kachel ein Häkchen und der Knopf heißt „+ Deck" (die Karte wird verknüpft),
   sonst „+ Wunsch" (fehlende Karte kommt mit Bestand 0 ins Deck). */
function synKachel(card, grundText, deckId) {
  const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || "";
  const p = synPreis(card);
  const besessen = besessenAnzahl(card);
  const badge = besessen > 0
    ? `<span class="syn-owned" title="${esc(t("syn.ownedTitle", { n: besessen }))}">&#10003;</span>` : "";
  let addBtn = "";
  if (deckId && card.id) {
    SYN_CACHE.set(card.id, card);
    const owned = besessen > 0;
    addBtn = `<button class="syn-add${owned ? " owned" : ""}" data-deck="${esc(deckId)}" data-sid="${esc(card.id)}"
      title="${esc(t(owned ? "syn.addOwnedTitle" : "syn.addWishTitle"))}">&#43;&#160;${
        esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`;
  }
  return `<div class="syn-card">
    <a class="syn-card-link" href="${esc(card.scryfall_uri || "#")}" target="_blank" rel="noopener noreferrer">
      <div class="syn-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="syn-noimg">&#9670;</div>`}${badge}</div>
      <div class="syn-name">${esc(card.name)}</div>
      <div class="syn-type">${esc(card.type_line || "")}</div>
      <div class="syn-exp" title="${esc(grundText)}">${esc(grundText)}</div>
    </a>
    <div class="syn-foot"><span class="syn-price">${p == null ? "–" : eur(p)}</span>${addBtn}</div>
  </div>`;
}

function synergyCardHtml(e, deckId) { return synKachel(e.card, synergyErklaerung(e), deckId); }

/* Eine Vorschlags-Scryfall-Karte als Wunschkarte ins Deck legen (RPC
   add_wish_to_deck): fehlt sie in der Sammlung, wird sie mit Bestand 0 angelegt,
   sonst die eigene Karte verknüpft. Gibt die verknüpfte card_id zurück. */
async function wunschkarteZumDeck(deckId, c) {
  const face = c.card_faces?.[0] || {};
  const { data, error } = await sb.rpc("add_wish_to_deck", {
    p_deck: deckId,
    p_scryfall_id: c.id, p_oracle_id: c.oracle_id || null, p_name: c.name,
    p_printed_name: c.printed_name || null,
    p_set_code: c.set || null, p_set_name: c.set_name || null, p_cn: c.collector_number || null,
    p_img: c.image_uris?.normal || c.image_uris?.small || face.image_uris?.normal || null,
    p_lang: c.lang || "en",
    p_price: c.prices?.eur ? parseFloat(c.prices.eur) : null,
    p_type_line: c.type_line || null, p_rarity: c.rarity || null,
    p_mana_cost: c.mana_cost ?? face.mana_cost ?? null,
    p_cmc: c.cmc ?? null, p_released: c.released_at || null,
    p_colors: c.colors || null, p_keywords: c.keywords || null,
    p_oracle_text: c.oracle_text ?? face.oracle_text ?? null,
  });
  if (error) throw error;
  return data;
}

/* Synergie-Knopf in den Ladezustand versetzen: Lupe → drehendes Zahnrad,
   Knopf gesperrt. Zurück auf die Lupe, wenn die Suche fertig ist. */
function synBtnBusy(btn, label, busy, icon) {
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = (busy ? `<span class="syn-spin">&#9881;</span>` : (icon || "&#128269;")) + " " + esc(label);
}

/* Konkurrierende Geschwister-Knöpfe während einer Suche sperren (Standard-,
   KI-Synergien und Deck-Analyse schreiben in denselben Kasten und teilen den
   Lauf-Zähler — ein Klick auf einen anderen würde das laufende, teils bezahlte
   Ergebnis verwerfen). Nur SPERREN, nicht verstecken; das dauerhafte
   Ein-/Ausblenden regelt der Synergie-Modus. */
function synGeschwister(btns, sperren) {
  for (const b of btns) if (b) b.disabled = sperren;
}

/* Synergie-Modus: welche Synergie-Suche überhaupt angezeigt wird. Gerätelokal
   (localStorage), wirkt über ein Attribut an <html> + CSS (keine Neuzeichnung
   nötig). "beide" = Standard und KI, "standard" = nur heuristisch, "ki" = nur KI. */
const SYN_MODES = ["beide", "standard", "ki"];
function synModus() {
  const m = localStorage.getItem("mtg-syn-mode");
  return SYN_MODES.includes(m) ? m : "beide";
}
function synModusAnwenden() { document.documentElement.dataset.synMode = synModus(); }
function synModusSetzen(m) {
  localStorage.setItem("mtg-syn-mode", SYN_MODES.includes(m) ? m : "beide");
  synModusAnwenden();
}

/* Globale Feature-Schalter + Admin-Status laden (nach Login). Setzt zusätzlich
   das Attribut data-ki-global an <html>: hat der Admin die KI-Synergien global
   ausgeschaltet, blendet CSS den KI-Knopf für ALLE aus (die harte Sperre sitzt
   in der Edge Function). */
async function ladeFlags() {
  try {
    const { data } = await sb.from("feature_flags").select("key,enabled");
    FLAGS = {}; (data || []).forEach(f => { FLAGS[f.key] = f.enabled; });
  } catch { FLAGS = {}; }
  try { const { data } = await sb.rpc("is_admin"); IS_ADMIN = !!data; } catch { IS_ADMIN = false; }
  document.documentElement.dataset.kiGlobal = FLAGS.ki_synergy ? "on" : "off";
}

/* Einen globalen Schalter umlegen — nur der Admin darf; die RLS auf
   feature_flags erzwingt es zusätzlich serverseitig. */
async function flagSetzen(key, enabled) {
  const { error } = await sb.from("feature_flags").update({ enabled }).eq("key", key);
  if (error) throw error;
  await ladeFlags();
}

/* Vorschläge in einen Container zeichnen (Lade-/Leer-Zustand inklusive). */
async function synergieAnzeigen(box, hooks, opts = {}) {
  if (!box) return;
  const lauf = ++synergyLauf;
  if (!hooks.length) { box.innerHTML = `<div class="empty">${esc(t("syn.noHooks"))}</div>`; return; }
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("syn.loading"))}</div>`;
  const res = await synergieSuchen(hooks, opts);
  if (lauf !== synergyLauf) return;                  // ein neuerer Lauf hat übernommen
  if (!res.length) { box.innerHTML = `<div class="empty">${esc(t("syn.none"))}</div>`; return; }
  let kopf = "";
  if (opts.totalBudget) {                            // Summenzeile beim Deck-Budget
    const summe = res.reduce((s, e) => s + (synPreis(e.card) || 0), 0);
    kopf = `<div class="meta">${esc(t("syn.budgetLine", { sum: eur(summe), budget: eur(opts.totalBudget) }))}</div>`;
  }
  box.innerHTML = kopf + `<div class="syn-grid">${res.map(e => synergyCardHtml(e, opts.deckId)).join("")}</div>`;
}

/* KI-Synergien: die Edge Function „card-synergy" fragt Claude nach — auch
   IMPLIZITEN — Synergien. Das Modell liefert nur Namen + Begründung; jeden Namen
   prüfen wir hier gegen Scryfall (ein Sammel-Request), erfundene fallen raus.
   opts.maxPrice filtert wie bei der heuristischen Suche. */
async function kiSynergien(card, box, opts = {}) {
  return kiSynergieLauf(box, {
    body: { card: { name: card.name, type_line: card.type_line, oracle_text: card.oracle_text }, lang: LANG, n: 10 },
    selfName: card.name,
    maxPrice: opts.maxPrice,
  });
}

/* Passt die Farbidentität einer Karte in die erlaubten Deckfarben (Teilmenge)? */
function farbIdentPasst(ci, erlaubt) { return (ci || []).every(f => erlaubt.has(f)); }

/* KI-Synergien fürs GANZE Deck: die Deckliste geht als Kontext an Claude, das
   auch implizite, aufs Deck bezogene Synergien vorschlägt. Zusätzlich filtern
   wir clientseitig auf die Farbidentität des Decks (falls das Modell danebenlangt)
   und auf Besessenes/Enthaltenes. */
async function kiSynergienDeck(deck, cards, box, opts = {}) {
  const colors = farbIdentitaet(cards);
  const commander = deck.main_card_id ? (CARDS.find(c => c.id === deck.main_card_id)?.name || "") : "";
  return kiSynergieLauf(box, {
    body: {
      deck: {
        name: deck.name, format: deck.format || "", commander, colorIdentity: colors,
        cards: [...new Set(cards.map(c => c.name).filter(Boolean))].slice(0, 120),
      },
      lang: LANG, n: 12,
    },
    colors,
    exclude: excludeVon(cards),   // nur Karten DIESES Decks raus, Besessenes darf auftauchen
    deckId: deck.id,              // ermöglicht den „Als Wunschkarte"-Knopf je Vorschlag
    maxPrice: opts.maxPrice,
  });
}

/* Anthropic-Listenpreise in USD je 1 Mio. Tokens [Input, Output]. Nur zur
   groben Kostenanzeige — Prompt-Caching o. Ä. nutzt die Function nicht. */
const KI_PREISE = {
  "claude-sonnet-4-6": [3, 15], "claude-sonnet-5": [3, 15],
  "claude-haiku-4-5": [1, 5], "claude-opus-4-8": [5, 25],
};

/* Kosten einer KI-Abfrage aus dem usage-Feld der Function schätzen. */
function kiKosten(u) {
  if (!u || u.input == null || u.output == null) return null;
  const [pin, pout] = KI_PREISE[u.model] || [3, 15];   // Fallback: Sonnet-Preise
  return { usd: u.input / 1e6 * pin + u.output / 1e6 * pout, input: u.input, output: u.output };
}

/* Kostenzeile fürs Ergebnis: „Diese Abfrage: ≈ $0,0176 · 2.148 → 782 Tokens". */
function kiKostenHtml(usage) {
  const k = kiKosten(usage);
  if (!k) return "";
  const usd = "$" + k.usd.toFixed(4).replace(".", ",");
  const zahl = n => (n || 0).toLocaleString(LANG);
  return `<div class="hint" style="margin:2px 0 8px">${
    esc(t("syn.aiCost", { cost: usd, in: zahl(k.input), out: zahl(k.output) }))}</div>`;
}

/* Gemeinsamer Kern: Edge Function „card-synergy" rufen, Namen gegen Scryfall
   prüfen (ein Sammel-Request; erfundene fallen raus) und die geprüften Karten
   als Kacheln zeigen. cfg: { body, selfName?, colors?, maxPrice? }. */
async function kiSynergieLauf(box, cfg) {
  if (!box) return;
  const lauf = ++synergyLauf;
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("syn.aiLoading"))}</div>`;

  let data, error;
  try {
    ({ data, error } = await sb.functions.invoke("card-synergy", { body: cfg.body }));
  } catch (e) { error = e; }
  if (lauf !== synergyLauf) return;

  if (error) {
    // supabase-js verpackt Non-2xx-Antworten in error; die Klartext-Meldung der
    // Function steckt in error.context (der rohen Response).
    let msg = t("syn.aiError");
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* generisch */ }
    box.innerHTML = `<div class="empty">${esc(msg)}</div>`;
    return;
  }
  if (data?.error) { box.innerHTML = `<div class="empty">${esc(data.error)}</div>`; return; }

  const sugg = (data?.suggestions || []).filter(s => s && s.name);
  if (!sugg.length) { box.innerHTML = `<div class="empty">${esc(t("syn.none"))}</div>`; return; }

  // Namen gegen Scryfall prüfen (POST /cards/collection, ein Request bis 75 Namen).
  let karten = [];
  try {
    const r = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identifiers: sugg.slice(0, 20).map(s => ({ name: s.name })) }),
    });
    if (r.ok) karten = (await r.json()).data || [];
  } catch { /* ohne Prüfung keine Anzeige */ }
  if (lauf !== synergyLauf) return;

  const byName = new Map(karten.map(c => [c.name.toLowerCase(), c]));
  const weg = cfg.exclude || { ids: new Set(), names: new Set() };   // Besessenes darf auftauchen
  const cap = cfg.maxPrice;
  const selfLower = (cfg.selfName || "").toLowerCase();
  const farbSet = cfg.colors ? new Set(cfg.colors.replace(/c/gi, "").toUpperCase().split("").filter(Boolean)) : null;
  const gesehen = new Set();
  const treffer = [];
  const lim = prefWert("synLimit");   // Profil-Einstellung „max. Vorschläge"
  for (const s of sugg) {                       // Reihenfolge des Modells behalten
    const c = byName.get(s.name.toLowerCase());
    if (!c || !c.oracle_id || gesehen.has(c.oracle_id)) continue;
    if (weg.ids.has(c.oracle_id) || weg.names.has((c.name || "").toLowerCase())) continue;
    if (selfLower && (c.name || "").toLowerCase() === selfLower) continue;
    if (farbSet && !farbIdentPasst(c.color_identity, farbSet)) continue;   // außerhalb der Deckfarben
    if (cap && (synPreis(c) ?? 9e9) > cap) continue;
    if (suchPrefs().onlyOwned && !besessenAnzahl(c)) continue;   // Einstellung „nur eigene Sammlung"
    gesehen.add(c.oracle_id);
    treffer.push(vorschlagCardHtml(c, s.reason, cfg.deckId));
    if (lim && treffer.length >= lim) break;
  }
  const kosten = kiKostenHtml(data?.usage);   // die Abfrage kostete unabhängig von der Trefferzahl
  box.innerHTML = treffer.length
    ? `<div class="meta">${esc(t("syn.aiNote"))}</div>${kosten}<div class="syn-grid">${treffer.join("")}</div>`
    : `${kosten}<div class="empty">${esc(t("syn.none"))}</div>`;
}

/* Haken eines ganzen Decks: über alle Karten sammeln, dann nach Häufigkeit MAL
   Gewicht sortieren — eine oft geteilte Fähigkeit schlägt einen oft geteilten
   Kreaturentyp, damit auch bei der Deck-Suche die Mechanik führt. */
function deckHooks(eintraege) {
  const zaehler = new Map();
  for (const { c } of eintraege)
    for (const h of synergyHooks(c)) {
      const k = h.kind + "|" + h.q;
      const cur = zaehler.get(k) || { hook: h, n: 0 };
      cur.n++; zaehler.set(k, cur);
    }
  return [...zaehler.values()]
    .sort((a, b) => b.n * hookGewicht(b.hook.kind) - a.n * hookGewicht(a.hook.kind))
    .map(x => x.hook);
}

/* ===================== Deck-Analyse („was fehlt?") ====================
   Grobe Funktions-Inventur nach dem 7-Kategorien-Gedanken aus „Building for
   Synergy": zählt (heuristisch am Regeltext) Ramp, Kartenvorteil, Entfernung und
   Boardwipes, vergleicht mit einer an die Deckgröße skalierten Richtzahl und
   schlägt für zu dünne Kategorien Karten in der Farbidentität vor (Scryfall-
   Funktionstags otag:). Die Zählung ist bewusst eine Schätzung. */
const AN_KATEGORIEN = [
  // Negativfilter halten die Kategorien sauber getrennt: Scryfalls Tagger führt
  // z. B. Path to Exile unter otag:ramp (verschafft dem Gegner ein Land), es ist
  // aber Entfernung — daher „-otag:removal" bei Ramp; Boardwipes zählen nicht als
  // einzelne Entfernung.
  { key: "ramp", ziel: 10, otag: "otag:ramp -otag:removal",
    test: c => !/\bland\b/i.test(c.type_line || "") &&
      /(\badd \{[wubrgc]|\{t\}:\s*add\b|search your library for (?:a|up to \w+|one|two|basic|any number of)[^.]{0,50}\bland|create[^.]{0,20}treasure)/i.test(c.oracle_text || "") },
  { key: "draw", ziel: 10, otag: "otag:card-advantage -otag:ramp",
    test: c => /(draw (?:two|three|four|five|six|seven|\w+) cards|(?:whenever|at the beginning of|\{t\}:)[^.]{0,80}draw)/i.test(c.oracle_text || "") },
  { key: "removal", ziel: 8, otag: "otag:removal -otag:board-wipe",
    test: c => /(destroy target|exile target|counter target|deals? \d+ damage to (?:target|any target|target creature|target planeswalker)|fights? target|target creature gets -\d)/i.test(c.oracle_text || "") },
  { key: "wipe", ziel: 3, otag: "otag:board-wipe",
    test: c => /(destroy all|exile all|destroy each|deals? \d+ damage to each|all creatures get -\d|each player sacrifices)/i.test(c.oracle_text || "") },
];

/* Anzahl einer Deckzeile (Platzhalter zählt als 1). */
function anzahlVon(c) { return Math.max(c.qty || 0, 1); }

/* Deck nach Kategorien inventarisieren; Richtzahl an die Deckgröße anpassen. */
function deckAnalyse(cards) {
  const groesse = cards.reduce((s, c) => s + anzahlVon(c), 0);
  const skala = Math.max(0.5, Math.min(1.2, groesse / 100));
  return AN_KATEGORIEN.map(k => {
    const ist = cards.filter(k.test).reduce((s, c) => s + anzahlVon(c), 0);
    const ziel = Math.max(k.key === "wipe" ? 1 : 3, Math.round(k.ziel * skala));
    return { key: k.key, otag: k.otag, ist, ziel };
  });
}

/* Kachel für einen Vorschlag mit Kategorie-Etikett (Ramp, Entfernung …) oder
   KI-Begründung statt Synergie-Erklärung. */
function vorschlagCardHtml(card, etikett, deckId) { return synKachel(card, etikett, deckId); }

/* ====================== Combos (Commander Spellbook) ==================
   Über die Edge Function „combos" (Proxy zu commanderspellbook.com — CSB
   sendet für uns kein CORS). Zurück kommen fertige (included) und fast
   fertige (almostIncluded) Combos, exakt über die Karten der Deckliste. */

/* Commander-Spellbook-Bracket-Kürzel (BracketTagEnum) → CSBs feste Klartext-
   Namen. Nur das Drumherum ist übersetzt, die Bracket-Namen selbst nicht —
   das sind die etablierten Begriffe der Commander-Szene. */
const BRACKET_NAMES = { R: "Ruthless", S: "Spicy", P: "Powerful", O: "Oddball", C: "Core", E: "Exhibition", B: "Banned" };

/* CSB-Tag → offizielle Commander-Bracket-Stufe (1–5). CSBs Schätzung reicht bis
   Ruthless ≈ Stufe 4 (Optimized/cEDH); „B" = enthält eine gebannte Karte, also
   keine Stufe. Grundlage: WotCs Bracket-System + CSBs estimate-bracket. */
const BRACKET_STUFE = { E: 1, C: 2, O: 2, P: 3, S: 3, R: 4 };

/* Aufklappbare Bracket-Begründung: Stufe + Name, die auslösenden Signale (Combos,
   Game Changer, gebannte Karten, Mass Land Denial, Extra-Turns) und eine Legende
   der fünf offiziellen Stufen. Fehlende Felder (ältere Edge Function) werden
   einfach weggelassen — der Client bleibt tolerant. */
function deckBracketAnzeigen(box, data) {
  const tag = data.bracketTag;
  const name = BRACKET_NAMES[tag] || tag || "?";
  const stufe = BRACKET_STUFE[tag];
  const two = data.twoCardCombos;
  const zeile = (cls, label, namen) => (namen && namen.length)
    ? `<div class="bracket-line"><span class="pill ${cls}">${namen.length}</span> <b>${esc(label)}:</b> ${esc(namen.join(", "))}</div>` : "";
  const kopf = tag === "B"
    ? `<div class="legal-note bad">&#9878; ${esc(t("bracket.badgeBanned"))}</div>`
    : `<div class="legal-note good">&#9878; ${esc(t("bracket.badge", { stufe: stufe ?? "?", name }))}</div>`;
  const combos = `<div class="bracket-line"><span class="pill">${data.comboCount ?? 0}</span> <b>${esc(t("bracket.rowCombos"))}</b>${
    two != null ? ` &middot; ${esc(t("bracket.rowTwoCard", { n: two }))}` : ""}</div>`;
  const grund = `<div class="bracket-reason">${combos}`
    + zeile("warn", t("bracket.rowGC"), data.gameChangers)
    + zeile("err", t("bracket.rowBanned"), data.banned)
    + zeile("warn", t("bracket.rowMLD"), data.massLandDenial)
    + zeile("warn", t("bracket.rowExtra"), data.extraTurn)
    + `</div>`;
  const legende = `<details class="legal-det" style="margin-top:8px"><summary>${esc(t("bracket.legendTitle"))}</summary>`
    + `<div class="bracket-legend">${[1, 2, 3, 4, 5].map(n =>
        `<div><b>${n}</b> ${esc(t("bracket.legend" + n))}</div>`).join("")}</div></details>`;
  box.innerHTML = kopf + grund + legende
    + `<div class="hint" style="margin-top:6px">${esc(t("bracket.footer"))}</div>`;
}

/* Ruft die Edge Function „combos" und wirft bei Fehlern mit der Klartext-
   Meldung der Function (wie kiSynergieLauf die Non-2xx-Antwort auspackt). */
async function combosApi(body) {
  let data, error;
  try {
    ({ data, error } = await sb.functions.invoke("combos", { body }));
  } catch (e) { error = e; }
  if (error) {
    let msg = t("combo.error");
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* generisch */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/* Alle in Combos vorkommenden Karten (nach Name) bei Scryfall zu vollen
   Objekten auflösen — für die Kachel-Darstellung (Bild/Typ/Preis) und den
   „+ Deck"/„+ Wunsch"-Knopf. Sammel-Requests in Blöcken zu 75. Map name→Karte. */
async function comboKartenLaden(namen) {
  const byLower = new Map();
  const uniq = [...new Set(namen.map(n => (n || "").trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 75) {
    try {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: uniq.slice(i, i + 75).map(name => ({ name })) }),
      });
      if (r.ok) for (const c of (await r.json()).data || []) byLower.set((c.name || "").toLowerCase(), c);
    } catch { /* ohne Auflösung Fallback-Text */ }
  }
  return byLower;
}

/* Zonen-Kürzel von Commander Spellbook → Klartext (für „Initial Card State").
   Die Zustandsnotizen selbst (u.state) kommen englisch von CSB. */
const ZONE_NAMES = { B: "Battlefield", H: "Hand", G: "Graveyard", E: "Exile", L: "Library", C: "Command Zone", S: "Stack" };

/* ------------------------- Legalität (Formate) -----------------------
   Combos: CSB liefert je Combo legalities (Boolean je Format). Karten:
   Scryfall liefert je Karte legalities (legal/not_legal/banned/restricted).
   Deck-Format → Schlüssel im legalities-Objekt; Draft/Casual haben keine
   Bannliste — Rückfall ist Commander (CSB ist eine Commander-Datenbank,
   auch Sammlungs- und Karten-Combos prüfen dagegen). */
const FORMAT_LEGAL_KEY = { commander: "commander", standard: "standard", pioneer: "pioneer",
  modern: "modern", legacy: "legacy", vintage: "vintage", pauper: "pauper", brawl: "brawl" };
const comboLegalKey = format => FORMAT_LEGAL_KEY[(format || "").toLowerCase()] || "commander";
const comboIstLegal = (combo, key) => combo.legalities ? combo.legalities[key] !== false : true;
const legalFmtName = key => key.charAt(0).toUpperCase() + key.slice(1);

/* Kartenlegalität fürs Detail: einmal je Auflage frisch von Scryfall (die
   Sammlung speichert keine Legalitäten — sie ändern sich mit jeder Bannliste,
   gespeichert wären sie veraltet). Gecacht je scryfall_id für die Sitzung. */
const LEGAL_CACHE = new Map();
async function kartenLegalitaet(sid) {
  if (LEGAL_CACHE.has(sid)) return LEGAL_CACHE.get(sid);
  const leg = (await sfById(sid)).legalities || {};
  LEGAL_CACHE.set(sid, leg);
  return leg;
}
const LEGAL_FORMATE = [["standard", "Standard"], ["pioneer", "Pioneer"], ["modern", "Modern"],
  ["legacy", "Legacy"], ["vintage", "Vintage"], ["commander", "Commander"], ["brawl", "Brawl"], ["pauper", "Pauper"]];
function legalPill(status) {
  const cls = status === "legal" ? " ok" : status === "banned" ? " err" : status === "restricted" ? " warn" : "";
  const key = status === "legal" ? "legal.legal" : status === "banned" ? "legal.banned"
    : status === "restricted" ? "legal.restricted" : "legal.notLegal";
  return `<span class="pill${cls}">${esc(t(key))}</span>`;
}
function legalGridHtml(leg) {
  return `<div class="legal-grid">${LEGAL_FORMATE.map(([k, name]) =>
    `<span class="legal-item">${esc(name)} ${legalPill(leg[k] || "not_legal")}</span>`).join("")}</div>`;
}

/* Legalitäten fürs ganze Deck in einem Rutsch: Sammel-Request an Scryfall
   (POST /cards/collection, je 75 scryfall_id). Was zurückkommt, landet im selben
   LEGAL_CACHE wie die Detail-Ansicht — ein zweiter Lauf und die Karten-Panels
   kommen dann ohne Netz aus. Rückgabe: Map scryfall_id → legalities | null. */
async function deckLegalitaeten(sids) {
  const uniq = [...new Set(sids.filter(Boolean))];
  const fehlend = uniq.filter(id => !LEGAL_CACHE.has(id));
  for (let i = 0; i < fehlend.length; i += 75) {
    try {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: fehlend.slice(i, i + 75).map(id => ({ id })) }),
      });
      if (r.ok) for (const c of (await r.json()).data || []) if (c.id) LEGAL_CACHE.set(c.id, c.legalities || {});
    } catch { /* Block fehlgeschlagen → diese Karten bleiben ungeprüft (null) */ }
  }
  return new Map(uniq.map(id => [id, LEGAL_CACHE.get(id) ?? null]));
}

/* Problemkarten-Zeilen (Name + Menge + Status-Pille) — geteilt vom Body-Panel
   und vom Header-Pillen-Tooltip. */
function legalProblemRows(probleme) {
  return probleme.map(p => {
    const menge = (p.c.qty || 1) > 1 ? ` <span class="legal-qty">&times;${p.c.qty}</span>` : "";
    const pill = p.tooMany
      ? `<span class="pill warn">${esc(t("legal.restricted"))} &middot; ${esc(t("legal.tooMany"))}</span>`
      : legalPill(p.st);
    return `<div class="legal-row"><span class="legal-name">${esc(p.c.disp || p.c.name)}${menge}</span>${pill}</div>`;
  }).join("");
}

/* Kernbefund: jede Deckkarte gegen das Deck-Format (Fallback Commander, wie bei
   den Combos). Meldet gebannte und nicht-legale Karten sowie restricted-Karten
   (nur Vintage) mit mehr als einem Exemplar. Bewusst NICHT geprüft: Bau-Regeln
   wie Singleton, Farbidentität oder Deckgröße — daher „gebannt/nicht legal", nicht
   „Deck ist legal". Kann werfen (Netzfehler); Problemkarten nach Schwere sortiert. */
async function deckLegalBefund(karten, deck) {
  const key = comboLegalKey(deck?.format);
  const fmt = legalFmtName(key);
  const legMap = await deckLegalitaeten(karten.map(c => c.scryfall_id));
  const probleme = [];
  let ungeprueft = 0;
  for (const c of karten) {
    const leg = legMap.get(c.scryfall_id);
    if (!leg) { ungeprueft++; continue; }
    const st = leg[key] || "not_legal";
    if (st === "banned") probleme.push({ c, st, rang: 0 });
    else if (st === "not_legal") probleme.push({ c, st, rang: 1 });
    else if (st === "restricted" && (c.qty || 1) > 1) probleme.push({ c, st, rang: 2, tooMany: true });
  }
  probleme.sort((a, b) => a.rang - b.rang);
  const gesamt = karten.length;
  return { key, fmt, probleme, gesamt, ungeprueft, geprueft: gesamt - ungeprueft };
}

/* Befund je Deck im Speicher (deckId → {sig, state, …befund}), damit die Header-
   Pille ihn zeigt und ein zweiter Blick nicht neu lädt. sig = Kartenliste+Mengen;
   ändert sich das Deck, stimmt die sig nicht mehr und es wird neu geprüft. */
const DECK_LEGAL = new Map();
const deckSig = d => (d.entries || []).map(e => e.cardId + ":" + e.qty).join(",");

/* Header-Pille (+ Hover-Tooltip mit den Problemkarten) aus dem gespeicherten
   Befund. Leerer String, solange nichts geprüft wurde (Pille bleibt unsichtbar). */
function deckLegalPillInner(res) {
  if (!res) return "";
  if (res.state === "checking")
    return `<span class="pill deck-legal-pill" title="${esc(t("legal.pillChecking"))}"><span class="syn-spin">&#9878;</span></span>`;
  if (res.state === "error")
    return `<span class="pill deck-legal-pill" title="${esc(t("legal.error"))}">&#9878; ?</span>`;
  if (!res.probleme.length)
    return `<span class="pill ok deck-legal-pill" title="${esc(t("legal.pillLegalTitle", { fmt: res.fmt }))}">&#10004; ${esc(t("legal.pillLegal", { fmt: res.fmt }))}</span>`;
  return `<span class="pill err deck-legal-pill" tabindex="0">&#9888; ${esc(t("legal.pillIllegal", { n: res.probleme.length }))}</span>`
    + `<span class="deck-legal-tip" role="tooltip"><span class="deck-legal-tiphd">${esc(t("legal.deckProblems", { m: res.probleme.length, n: res.gesamt, fmt: res.fmt }))}</span>${legalProblemRows(res.probleme)}</span>`;
}

/* Nur die eine Pille neu zeichnen (der Rest des Decks bleibt unberührt). */
function updateDeckLegalPill(id) {
  const el = $(`[data-legalpill="${id}"]`);
  if (el) el.innerHTML = deckLegalPillInner(DECK_LEGAL.get(id));
}

/* Prüfung anstoßen (Auto beim Öffnen ODER Handklick): Zustand „checking" setzen,
   Befund holen, Ergebnis merken und die Header-Pille aktualisieren. Gibt den
   gespeicherten Befund zurück (das Body-Panel rendert daraus weiter). */
async function deckLegalCheck(deck, karten, sig) {
  DECK_LEGAL.set(deck.id, { sig, state: "checking" });
  updateDeckLegalPill(deck.id);
  try {
    const b = await deckLegalBefund(karten, deck);
    DECK_LEGAL.set(deck.id, (!b.probleme.length && !b.geprueft)
      ? { sig, state: "error", fmt: b.fmt }        // nichts prüfbar (Netzfehler)
      : { sig, state: "done", ...b });
  } catch { DECK_LEGAL.set(deck.id, { sig, state: "error" }); }
  updateDeckLegalPill(deck.id);
  return DECK_LEGAL.get(deck.id);
}

/* Auto-Prüfung beim Öffnen, wenn die Einstellung an ist und der Befund fehlt oder
   veraltet ist (Deck geändert → sig stimmt nicht mehr). Läuft leise in die Pille. */
function deckLegalAutoTrigger(d) {
  if (!d || !suchPrefs().autoDeckLegal) return;
  const sig = deckSig(d);
  const cur = DECK_LEGAL.get(d.id);
  if (cur && cur.sig === sig) return;   // aktuell oder gerade in Arbeit
  const karten = (d.entries || []).map(e => {
    const c = CARDS.find(x => x.id === e.cardId);
    return c ? { ...c, qty: e.qty } : null;
  }).filter(Boolean);
  if (karten.length) deckLegalCheck(d, karten, sig);
}

/* „Deck-Legalität prüfen" (Handklick): volle Problemliste im Body-Panel — und
   über deckLegalCheck zugleich die Header-Pille. */
async function deckLegalPruefen(box, karten, deck) {
  const fmt0 = legalFmtName(comboLegalKey(deck?.format));
  box.innerHTML = `<div class="legal-note">${esc(t("legal.deckChecking", { fmt: fmt0 }))}</div>`;
  const res = await deckLegalCheck(deck, karten, deckSig(deck));
  if (res.state === "error") { box.innerHTML = `<div class="legal-note bad">${esc(t("legal.error"))}</div>`; return; }
  const { fmt, probleme, gesamt, ungeprueft, geprueft } = res;
  const kopf = probleme.length
    ? `<div class="legal-note bad">&#9888; ${esc(t("legal.deckProblems", { m: probleme.length, n: gesamt, fmt }))}</div>`
    : `<div class="legal-note good">&#10004; ${esc(t("legal.deckAllLegal", { n: geprueft, fmt }))}</div>`;
  const rest = ungeprueft
    ? `<div class="legal-note">${esc(t("legal.deckUnknown", { u: ungeprueft }))}</div>` : "";
  box.innerHTML = kopf + (probleme.length ? `<div class="legal-decklist">${legalProblemRows(probleme)}</div>` : "") + rest;
}

/* Eine Combo-Karte als reines Bild — mit ✓-Badge, falls besessen, und (nur bei
   im Deck fehlender Karte) dem „+ Deck"/„+ Wunsch"-Knopf. Volle Karte + Name
   erscheinen per Hover-Vorschau (data-cmd-img, siehe wireComboHover). Der
   Add-Weg ist derselbe wie bei den Synergien (SYN_CACHE + .syn-add). */
function comboCardMini(card, deckId, alsAktion) {
  const klein = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || "";
  const gross = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || klein;
  const besessen = besessenAnzahl(card);
  const badge = besessen > 0
    ? `<span class="syn-owned" title="${esc(t("syn.ownedTitle", { n: besessen }))}">&#10003;</span>` : "";
  let addBtn = "";
  if (alsAktion && card.id) {
    SYN_CACHE.set(card.id, card);
    const owned = besessen > 0;
    addBtn = `<button class="syn-add${owned ? " owned" : ""}" data-deck="${esc(deckId)}" data-sid="${esc(card.id)}"
      title="${esc(owned ? t("syn.addOwnedTitle") : t("syn.addWishTitle"))}">&#43;&#160;${esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`;
  }
  // Weder besessen noch (mangels Deck-Kontext) wünschbar — z. B. im
  // Kartendetail: direkt zum Kauf verlinken (Scryfalls Cardmarket-Link,
  // Rückfall über die cardmarket_id).
  let buy = "";
  if (!besessen && !addBtn) {
    const url = card.purchase_uris?.cardmarket || (card.cardmarket_id ? cmLink(card.cardmarket_id) : "");
    if (url) buy = `<a class="combo-buy" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
      title="${esc(t("combo.buyTitle"))}">&#128722;&#160;${esc(t("combo.buy"))}</a>`;
  }
  return `<div class="combo-mini">
    <div class="combo-mini-card" data-cmd-img="${esc(gross)}" data-cmd-name="${esc(card.name)}">
      ${klein ? `<img src="${esc(klein)}" alt="${esc(card.name)}" loading="lazy">` : `<div class="syn-noimg">&#9670;</div>`}${badge}
    </div>${addBtn}${buy}
  </div>`;
}

/* Die Hover-Vorschau (große Karte + Name) an die Combo-Kartenbilder hängen —
   dieselbe wie bei den Commander-Karten. Nur auf Hover-fähigen Geräten. */
function wireComboHover(box) {
  if (!HOVER_OK || !box) return;
  box.querySelectorAll(".combo-mini-card[data-cmd-img]").forEach(el => {
    el.addEventListener("mousemove", e => zeigeCmdHover(el.dataset.cmdImg, el.dataset.cmdName, e.clientX, e.clientY));
    el.addEventListener("mouseleave", versteckeCmdHover);
  });
}

/* „Komplett"/„Fast komplett" als Akkordeon: immer nur EINE Kategorie offen —
   klappt man eine auf, schließt sich die andere automatisch. */
function wireComboKategorien(box) {
  const kats = [...box.querySelectorAll(".combo-cat")];
  kats.forEach(det => det.addEventListener("toggle", () => {
    if (det.open) kats.forEach(o => { if (o !== det) o.open = false; });
  }));
}

/* Eine Combo als kompakter Block: Ergebnisse als Liste, die beteiligten Karten
   als reine Kartenbilder (✓ / „+ Deck" / „+ Wunsch"; volle Karte + Name per
   Hover), Details aufklappbar mit Ausgangszustand, Voraussetzungen und Ablauf.
   cardByName: Map name→Scryfall-Karte (aus comboKartenLaden). */
function comboKachel(combo, deckId, cardByName, legKey) {
  // Nicht legal im geprüften Format → rote Warn-Pille am Combo-Block (sichtbar
  // nur, wenn die Einstellung „ausblenden" aus ist — sonst ist sie schon weg).
  const warn = legKey && !comboIstLegal(combo, legKey)
    ? `<div><span class="pill err" title="${esc(t("legal.warnTitle", { fmt: legalFmtName(legKey) }))}">&#9888; ${esc(legalFmtName(legKey))}: ${esc(t("legal.notLegal"))}</span></div>` : "";
  const fehlt = new Set((combo.missing || []).map(m => (m.name || "").toLowerCase()));
  const karten = (combo.uses || []).map(u => {
    const sc = cardByName && cardByName.get((u.name || "").toLowerCase());
    if (!sc) return `<div class="combo-mini"><div class="combo-mini-card"><div class="syn-noimg">&#9670;</div></div><div class="combo-mini-nm">${esc(u.name)}</div></div>`;
    const alsAktion = deckId && fehlt.has((u.name || "").toLowerCase());
    return comboCardMini(sc, deckId, alsAktion);
  }).join("");

  const produces = combo.produces || [];
  const ergebnis = produces.length
    ? `<ul class="combo-results">${produces.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`
    : `<div class="combo-results-1">${esc(t("combo.result"))}</div>`;

  // Ausgangszustand je Karte: Zone(n) + evtl. Zustandsnotiz (beides von CSB).
  const zustand = (combo.uses || []).map(u => {
    const zonen = (u.zones || []).map(z => ZONE_NAMES[z] || z).join(" / ");
    const st = u.state ? ` (${u.state})` : "";
    return (zonen || st) ? `<li><b>${esc(u.name)}:</b> ${esc(zonen)}${esc(st)}</li>` : "";
  }).filter(Boolean).join("");
  const prereq = (combo.prerequisites || "").trim();
  const schritte = (combo.description || "").split("\n").map(s => s.trim()).filter(Boolean);
  const details = [
    zustand ? `<div><b>${esc(t("combo.cardState"))}:</b><ul class="combo-steps">${zustand}</ul></div>` : "",
    prereq ? `<div><b>${esc(t("combo.prereq"))}:</b> ${mitSymbolen(prereq)}</div>` : "",
    schritte.length ? `<div><b>${esc(t("combo.steps"))}:</b><ol class="combo-steps">${
      schritte.map(s => `<li>${mitSymbolen(s)}</li>`).join("")}</ol></div>` : "",
  ].filter(Boolean).join("");

  return `<div class="combo">
    ${warn}${ergebnis}
    <div class="combo-mini-grid">${karten}</div>
    ${details ? `<details class="combo-det"><summary>${esc(t("combo.details"))}</summary>
      <div class="combo-det-body">${details}</div></details>` : ""}
  </div>`;
}

/* Combos in einem Deck: Deckliste an „find-my-combos", fertige und fast fertige
   Combos zeigen. Eigener Lauf-Zähler gegen veraltete Antworten bei Doppelklick. */
let combosLauf = 0;
async function deckCombosAnzeigen(box, cards, deckId) {
  if (!box) return;
  const lauf = ++combosLauf;
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("combo.loading"))}</div>`;
  let data;
  try {
    data = await combosApi({ mode: "find-my-combos", cards: cards.map(c => ({ card: c.name, quantity: 1 })) });
  } catch (e) {
    if (lauf === combosLauf) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (lauf !== combosLauf) return;

  let included = data.included || [];
  // Einstellung „nur komplette Combos": die „Fast komplett"-Kategorie weglassen.
  let almost = suchPrefs().onlyComplete ? [] : (data.almostIncluded || []);
  if (!included.length && !almost.length) { box.innerHTML = `<div class="empty">${esc(t("combo.none"))}</div>`; return; }

  // Legalität im Deck-Format: erst zählen (für die Zusammenfassung), dann —
  // je nach Einstellung — die nicht legalen Combos ganz ausblenden.
  const legKey = comboLegalKey(DECKS.find(d => d.id === deckId)?.format);
  const gesamt = included.length + almost.length;
  const illegal = [...included, ...almost].filter(c => !comboIstLegal(c, legKey)).length;
  if (illegal && suchPrefs().hideBanned) {
    included = included.filter(c => comboIstLegal(c, legKey));
    almost = almost.filter(c => comboIstLegal(c, legKey));
  }

  // Alle Karten aller Combos (fertig + fast fertig) bei Scryfall auflösen —
  // für die Kacheln und die „+ Deck"/„+ Wunsch"-Knöpfe.
  const cardByName = await comboKartenLaden([...included, ...almost].flatMap(c => (c.uses || []).map(u => u.name)));
  if (lauf !== combosLauf) return;

  const teile = [`<div class="meta">${esc(t("combo.deckNote"))}</div>`];
  if (illegal) teile.push(`<div class="meta legal-note">&#9878; ${esc(t(
    suchPrefs().hideBanned ? "legal.hiddenNote" : "legal.warnNote",
    { n: illegal, total: gesamt, fmt: legalFmtName(legKey) }))}</div>`);
  const kats = [];
  if (included.length) kats.push([t("combo.have", { n: included.length }), included]);
  if (almost.length) kats.push([t("combo.almost", { n: almost.length }), almost]);
  if (!kats.length) teile.push(`<div class="empty">${esc(t("combo.none"))}</div>`);
  // Kategorien als aufklappbare Blöcke: die erste (Komplett) offen, die andere zu.
  kats.forEach(([label, combos], i) => teile.push(`<details class="combo-cat"${i === 0 ? " open" : ""}>
    <summary class="combo-h">${esc(label)}</summary>
    <div class="combo-grid">${combos.map(c => comboKachel(c, deckId, cardByName, legKey)).join("")}</div></details>`));
  box.innerHTML = teile.join("");
  wireComboHover(box);
  wireComboKategorien(box);
}

/* Combos in der GESAMTEN Sammlung: alle besessenen Karten (nach Name
   dedupliziert — dieselbe Karte in mehreren Auflagen zählt einmal) an
   „find-my-combos". Gezeigt werden die KOMPLETTEN Combos, die der Bestand
   hergibt. Ohne Deck-Kontext (deckId null), also ohne „+ Wunsch". */
async function sammlungCombosAnzeigen(box, cards) {
  if (!box) return;
  const lauf = ++combosLauf;
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("combo.loading"))}</div>`;
  let data;
  try {
    data = await combosApi({ mode: "find-my-combos", cards: cards.map(c => ({ card: c.name, quantity: 1 })) });
  } catch (e) {
    if (lauf === combosLauf) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (lauf !== combosLauf) return;
  let included = data.included || [];
  if (!included.length) { box.innerHTML = `<div class="empty">${esc(t("combo.collNone"))}</div>`; return; }
  // Legalität: ohne Deck-Kontext gegen Commander (siehe comboLegalKey).
  const gesamt = included.length;
  const illegal = included.filter(c => !comboIstLegal(c, "commander")).length;
  if (illegal && suchPrefs().hideBanned) included = included.filter(c => comboIstLegal(c, "commander"));
  const cardByName = await comboKartenLaden(included.flatMap(c => (c.uses || []).map(u => u.name)));
  if (lauf !== combosLauf) return;
  const note = illegal ? `<div class="meta legal-note">&#9878; ${esc(t(
    suchPrefs().hideBanned ? "legal.hiddenNote" : "legal.warnNote",
    { n: illegal, total: gesamt, fmt: "Commander" }))}</div>` : "";
  box.innerHTML = `<div class="meta">${esc(t("combo.collHave", { n: gesamt }))}</div>${note}
    ${included.length ? `<div class="combo-grid" style="margin-top:6px">${included.map(c => comboKachel(c, null, cardByName, "commander")).join("")}</div>` : `<div class="empty">${esc(t("combo.collNone"))}</div>`}`;
  wireComboHover(box);
}

/* Combos, in denen eine einzelne Karte vorkommt (Modus variants). Kein
   Deck-Kontext → ohne „+ Wunsch". Teilt sich den Lauf-Zähler mit den
   Deck-Combos; parallel läuft ohnehin höchstens eine Combo-Suche. */
async function karteCombosAnzeigen(box, card) {
  if (!box) return;
  const lauf = ++combosLauf;
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("combo.loading"))}</div>`;
  let data;
  try {
    // Anführungszeichen im Namen raus, sonst bricht die CSB-Suche card:"…".
    const q = `card:"${(card.name || "").replace(/"/g, "")}"`;
    data = await combosApi({ mode: "variants", q, limit: 12 });
  } catch (e) {
    if (lauf === combosLauf) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (lauf !== combosLauf) return;
  let combos = data.combos || [];
  if (!combos.length) { box.innerHTML = `<div class="empty">${esc(t("combo.cardNone"))}</div>`; return; }
  // Legalität: ohne Deck-Kontext gegen Commander (siehe comboLegalKey).
  const gesamt = combos.length;
  const illegal = combos.filter(c => !comboIstLegal(c, "commander")).length;
  if (illegal && suchPrefs().hideBanned) combos = combos.filter(c => comboIstLegal(c, "commander"));
  const cardByName = await comboKartenLaden(combos.flatMap(c => (c.uses || []).map(u => u.name)));
  if (lauf !== combosLauf) return;
  const note = illegal ? `<div class="meta legal-note">&#9878; ${esc(t(
    suchPrefs().hideBanned ? "legal.hiddenNote" : "legal.warnNote",
    { n: illegal, total: gesamt, fmt: "Commander" }))}</div>` : "";
  box.innerHTML = `<div class="meta">${esc(t("combo.cardNote", { n: gesamt }))}</div>${note}${
    combos.length ? `<div class="combo-grid">${combos.map(c => comboKachel(c, null, cardByName, "commander")).join("")}</div>` : `<div class="empty">${esc(t("combo.cardNone"))}</div>`}`;
  wireComboHover(box);
}

/* Analyse in einen Container zeichnen: Balken je Kategorie, darunter Vorschläge
   für die zu dünnen Kategorien (in Deckfarben, nicht besessen). */
async function deckAnalyseAnzeigen(box, cards, colors, deckId) {
  if (!box) return;
  const lauf = ++synergyLauf;   // teilt den Lauf-Zähler mit der Synergiesuche
  box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("an.loading"))}</div>`;
  const analyse = deckAnalyse(cards);

  const zeilen = analyse.map(a => {
    const pct = Math.min(100, Math.round(a.ist / a.ziel * 100));
    const klasse = a.ist >= a.ziel ? "gut" : a.ist >= a.ziel * 0.6 ? "ok" : "wenig";
    return `<div class="an-row">
      <span class="an-name">${esc(t("an.cat." + a.key))}</span>
      <span class="an-bar"><span class="an-fill ${klasse}" style="width:${pct}%"></span></span>
      <span class="an-count ${klasse}">${a.ist} / ${a.ziel}</span>
    </div>`;
  }).join("");

  box.innerHTML = `<div class="analyse">
    <div class="meta">${esc(t("an.intro"))}</div>
    ${zeilen}
    <div id="an-sugg" style="margin-top:6px"><div class="meta"><span class="syn-spin">&#9881;</span></div></div>
    <p class="hint" style="margin-top:8px">${esc(t("an.estimate"))}</p>
  </div>`;

  const duenn = analyse.filter(a => a.ist < a.ziel);
  const suggBox = box.querySelector("#an-sugg");
  if (!duenn.length) { suggBox.innerHTML = `<div class="meta ok">${esc(t("an.allGood"))}</div>`; return; }

  const weg = excludeVon(cards);   // nur Karten DIESES Decks raus, Besessenes darf auftauchen
  const teile = [];
  for (const a of duenn) {
    const q = `${a.otag} id<=${colors} -is:token -is:funny game:paper`;
    let data = [];
    try {
      const r = await fetch("https://api.scryfall.com/cards/search?order=edhrec&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } });
      if (r.ok) data = (await r.json()).data || [];
    } catch { /* Kategorie darf scheitern */ }
    if (lauf !== synergyLauf) return;   // ein neuerer Lauf hat übernommen
    const label = t("an.cat." + a.key);
    const treffer = data.filter(c => c.oracle_id && !weg.ids.has(c.oracle_id) && !weg.names.has((c.name || "").toLowerCase())).slice(0, 6);
    if (treffer.length) teile.push(`<div class="an-block">
      <h4>${esc(t("an.needMore", { cat: label }))}</h4>
      <div class="syn-grid">${treffer.map(c => vorschlagCardHtml(c, label, deckId)).join("")}</div>
    </div>`);
    await new Promise(res => setTimeout(res, 110));
  }
  if (lauf !== synergyLauf) return;
  suggBox.innerHTML = teile.join("") || `<div class="meta">${esc(t("syn.none"))}</div>`;
}

/* ---------------------------------------------- Karte bearbeiten ----- */
async function editCard(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  const langs = LANG_NAMES[c.lang] ? Object.keys(LANG_NAMES) : [c.lang, ...Object.keys(LANG_NAMES)];
  const ok = await confirmDlg(`
    <b>${esc(c.disp)}</b>
    <p class="hint" style="margin:2px 0 10px">${esc(c.set_name || c.set)} · #${esc(c.cn)} · ${esc(t("common.qtyLabel"))} ${c.qty}</p>
    <div class="row" style="margin-bottom:8px">
      <div><label>${esc(t("edit.setCode"))}</label><input type="text" id="ed-set" value="${esc(c.set || "")}"
        style="text-transform:uppercase" placeholder="MKM"></div>
      <div><label>${esc(t("edit.number"))}</label><input type="text" id="ed-cn" value="${esc(c.cn || "")}" placeholder="8"></div>
    </div>
    <div class="row">
      <div><label>${esc(t("cm.language"))}</label><select id="ed-lang">${langs.map(l =>
        `<option value="${esc(l)}"${l === c.lang ? " selected" : ""}>${esc(langName(l))}</option>`).join("")}</select></div>
      <div><label>${esc(t("cm.condition"))}</label><select id="ed-cond">${CONDITION_CODES.map(x =>
        `<option value="${x}"${x === c.condition ? " selected" : ""}>${x} · ${esc(CONDITION_BY[x].name)}</option>`).join("")}</select></div>
      <div><label>${esc(t("edit.finish"))}</label><select id="ed-foil">
        <option value="0"${!c.foil ? " selected" : ""}>${esc(t("edit.normal"))}</option>
        <option value="1"${c.foil ? " selected" : ""}>Foil</option></select></div>
    </div>
    <p class="hint">${t("edit.hint")}</p>`);
  if (!ok) return;
  const lang = $("#ed-lang").value, cond = $("#ed-cond").value, foil = $("#ed-foil").value === "1";
  const setIn = $("#ed-set").value.trim().toUpperCase();
  const cnIn  = $("#ed-cn").value.trim();
  const auflageNeu = setIn !== (c.set || "").toUpperCase() || cnIn !== String(c.cn || "");
  if (!auflageNeu && lang === c.lang && cond === c.condition && foil === c.foil) return;
  if (auflageNeu && (!setIn || !cnIn)) return toast(t("toast.setCnRequired"));
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
    if (!fresh) throw new Error(t("err.printingNotFound", { set: neu.set, cn: neu.cn }));
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
    toast(t("toast.mergedQty", { n: twin.qty + c.qty }));
  } else {
    const { error } = await sb.from("cards").update(patch).eq("id", c.id);
    if (error) throw new Error(dbErr(error));
    toast(neu
      ? t("toast.cardNow", { name: fresh.printed_name || fresh.name, set: patch.set_code, cn: patch.cn })
      : t("toast.cardUpdated"));
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

/* Zugeklappte Deck-Typ-Kategorien (Schlüssel „deckId|Typ"). Nur im Speicher,
   Standard alles aufgeklappt — wie die Statistik ein kurzer Blick, kein
   Dauerzustand. Ein neuer Seitenaufruf startet mit allen Kategorien offen. */
const deckCatZu = new Set();

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
      return toast(t("toast.columnMissing"));
    // Der Trigger lehnt ungeeignete Karten ab; seine Meldung ist bereits
    // für Menschen geschrieben, also unverändert durchreichen. (Sie enthält
    // selbst einen Doppelpunkt — ein Präfix-Abschneider fräße den halben Satz.)
    if (error.code === "23514" || /legendär|Typzeile|Hauptkarte/i.test(error.message || ""))
      return toast(error.message);
    return toast(dbErr(error));
  }
  await reload(); renderDecks();
  toast(neu ? t("toast.mainSet") : t("toast.mainUnset"));
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
    <b>${esc(t("deck.editTitle"))}</b>
    <div style="margin-top:10px">
      <label>${esc(t("common.name"))}</label>
      <input type="text" id="dn-name" value="${esc(d.name)}" autofocus>
    </div>
    <div class="row" style="margin-top:10px">
      <div><label>${esc(t("decks.format"))}</label><select id="dn-format">${deckOptions(DECK_FORMATE, d.format, "—")}</select></div>
      <div><label>${esc(t("decks.archetype"))}</label><select id="dn-arch">${deckOptions(DECK_ARCHETYPEN, d.archetype, "—")}</select></div>
    </div>
    <p class="hint">${esc(t("edit.deckHint"))}</p>`);
  if (!ok) return;
  const name = $("#dn-name").value.trim();
  if (!name) return toast(t("toast.deckNameRequired"));
  const format    = $("#dn-format").value || null;
  const archetype = $("#dn-arch").value   || null;
  // Nichts geändert? Dann nicht schreiben. NULL und "" gelten als gleich.
  if (name === d.name && format === (d.format || null) && archetype === (d.archetype || null)) return;
  try {
    const { error } = await sb.from("decks").update({ name, format, archetype }).eq("id", d.id);
    if (error) throw error;
    await reload(); renderDecks();
    toast(t("toast.deckSaved"));
  } catch (e) { toast(dbErr(e)); }
}

/* Deck für Freunde freigeben oder die Freigabe zurücknehmen. Nur der Schalter
   `shared` wird umgelegt; wer das Deck sehen darf, entscheidet die RLS
   (geteilt + befreundet). */
async function shareDeck(id) {
  const d = DECKS.find(x => x.id === id);
  if (!d) return;
  try {
    const { error } = await sb.from("decks").update({ shared: !d.shared }).eq("id", id);
    if (error) throw error;
    d.shared = !d.shared;
    toast(d.shared ? t("toast.deckShared") : t("toast.deckUnshared"));
    renderDecks();
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
  ff.innerHTML = deckOptions(fmt, deckFilter.format, t("decks.allFormats"));
  fa.innerHTML = deckOptions(arc, deckFilter.archetype, t("decks.allArch"));
  ff.onchange = () => { deckFilter.format = ff.value; renderDecks(); };
  fa.onchange = () => { deckFilter.archetype = fa.value; renderDecks(); };
  karte.style.display = "";
}

function renderDecks() {
  if (!DECKS.length) {
    $("#deck-list").innerHTML = `<div class="card"><div class="empty">${esc(t("deck.none"))}</div></div>`;
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
    // Deck-Karten in aufklappbare Typ-Kategorien (feste Reihenfolge; die Tabellen-
    // Sortierung bleibt je Kategorie erhalten). Jede Kategorie ist ein eigener
    // <tbody> mit anklickbarer Kopfzeile. `rows` = Kartenzahl, steuert nur die
    // Sichtbarkeit von Knöpfen/Tabelle (0 = leeres Deck).
    const rows = eintraege.length;
    const katGruppen = new Map();
    for (const x of eintraege) {
      const en = deckKatKey(x.c);
      if (!katGruppen.has(en)) katGruppen.set(en, []);
      katGruppen.get(en).push(x);
    }
    const deckKoerper = [...DECK_KAT_ORDNUNG, ""].filter(en => katGruppen.has(en)).map(en => {
      const items = katGruppen.get(en);
      const anz = items.reduce((s, x) => s + x.e.qty, 0);
      const zu = deckCatZu.has(`${d.id}|${en}`);
      // Die Commanderkarte steht immer ganz oben in ihrer Kategorie (Kreaturen),
      // unabhängig von der gewählten Sortierung. Stabiler Sort: nur der Commander
      // wandert nach vorn, alle anderen behalten ihre Reihenfolge.
      const geordnet = d.main_card_id
        ? [...items].sort((a, b) => (b.c.id === d.main_card_id) - (a.c.id === d.main_card_id))
        : items;
      const catRows = geordnet.map(({ e, c }) => cardRow(c, {
        deckId: d.id, qty: e.qty, istHaupt: d.main_card_id === c.id })).join("");
      return `<tbody class="deck-cat-body${zu ? " zu" : ""}">`
        + `<tr class="deck-cat-head" data-cattoggle="${d.id}|${en}"><td colspan="99">`
        + `<span class="deck-cat-arrow">${zu ? "&#9654;" : "&#9660;"}</span>`
        + `<span class="deck-cat-name">${esc(en ? typLabel(en) : t("type.other"))}</span>`
        + `<span class="deck-cat-count">${anz}</span></td></tr>${catRows}</tbody>`;
    }).join("");

    const n = eintraege.reduce((s, x) => s + x.e.qty, 0);
    const v = eintraege.reduce((s, x) => s + (x.c.price || 0) * x.e.qty, 0);
    const fehlt = eintraege.filter(x => x.e.qty > bestandVon(x.c)).length;
    const offen = deckOffen.ist(d.id);
    const dashOffen = deckDashOffen.has(d.id);
    if (dashOffen) deckDashRows.set(d.id, eintraege.map(({ e, c }) => ({ ...c, qty: e.qty })));
    const haupt = d.main_card_id ? CARDS.find(c => c.id === d.main_card_id) : null;

    return `<div class="card">
      <div class="deck-kopf" data-toggle="${d.id}" title="${offen ? t("common.collapse") : t("common.expand")}">
        <span class="deck-pfeil">${offen ? "&#9660;" : "&#9654;"}</span>
        ${haupt?.img ? `<img class="deck-haupt" src="${esc(haupt.img)}" alt=""
             title="${esc(haupt.disp)}"
             data-cmd-img="${esc((haupt.img || "").replace("/small/", "/normal/"))}"
             data-cmd-name="${esc(haupt.disp)}">` : ""}
        <div style="flex:1;min-width:0">
          <h3 style="margin:0">${esc(d.name)}</h3>
          <div class="deck-tags">${
            d.format ? `<span class="pill fmt">${esc(d.format)}</span>` : ""}${
            d.archetype ? `<span class="pill">${esc(d.archetype)}</span>` : ""
          }<span class="deck-legal-wrap" data-legalpill="${d.id}">${deckLegalPillInner(DECK_LEGAL.get(d.id))}</span></div>
          <div class="hint" style="margin:2px 0 0">${n} ${esc(t("common.cards"))} &middot; ${eur(v)}${
            d.shared ? ` &middot; <span style="color:var(--ok)">${esc(t("deck.shared"))}</span>` : ""}${
            fehlt ? ` &middot; <span style="color:var(--err)">${esc(t("deck.incomplete", { n: fehlt }))}</span>` : ""}</div>
        </div>
        <div class="deck-manage">
          <button class="btn ghost sm" data-share="${d.id}"
            title="${d.shared ? esc(t("deck.unshareTitle")) : esc(t("deck.shareTitle"))}">${d.shared ? "&#128101; " + esc(t("deck.sharedBtn")) : esc(t("deck.share"))}</button>
          <button class="btn ghost sm" data-ded="${d.id}"
            title="${esc(t("deck.editTitle"))}">&#9998; ${esc(t("deck.editBtn"))}</button>
          <button class="btn danger sm" data-dx="${d.id}">${esc(t("deck.delete"))}</button>
        </div>
      </div>
      <div class="deck-inhalt" style="display:${offen ? "block" : "none"}">
        <div class="deck-tools">
          <div class="tool-group">
            <span class="tool-label">${esc(t("deck.addCard"))}</span>
            <div class="tool-row">
              <div class="sugg" style="flex:1;min-width:220px"><input type="text" data-dadd="${d.id}" placeholder="${esc(t("deck.addCardPh"))}"></div>
              <div class="field" style="width:96px"><label>${esc(t("common.qtyLabel"))}</label>
                <input type="number" min="1" value="1" data-dqty="${d.id}"></div>
              <button class="btn ghost" data-daddbtn="${d.id}">${esc(t("deck.addBtn"))}</button>
            </div>
          </div>
          ${rows ? `<div class="tool-sep"></div>
          <div class="tool-cols">
            <div class="tool-group">
              <span class="tool-label">${esc(t("deck.groupOverview"))}</span>
              <div class="tool-row">
                <button class="btn ghost" data-dashtoggle="${d.id}"
                  title="${esc(dashOffen ? t("deck.statsHide") : t("deck.statsShow"))}">&#128202; ${esc(dashOffen ? t("deck.statsHide") : t("deck.statsShow"))}</button>
                <button class="btn ghost" data-bracketbtn="${d.id}"
                  title="${esc(t("bracket.title"))}">&#9878; ${esc(t("bracket.btn"))}</button>
                <button class="btn ghost" data-legalbtn="${d.id}"
                  title="${esc(t("legal.deckTitle"))}">&#9878; ${esc(t("legal.deckBtn"))}</button>
                ${fehlt ? `<button class="btn ghost" data-buybtn="${d.id}"
                  title="${esc(t("buy.deckTitle"))}">&#128722; ${esc(t("buy.deckBtn", { n: fehlt }))}</button>` : ""}
              </div>
            </div>
            <div class="tool-group">
              <span class="tool-label">${esc(t("deck.groupSuggest"))}</span>
              <div class="tool-row">
                <button class="btn ghost syn-std-btn" data-synbtn="${d.id}"
                  title="${esc(t("syn.deckTitle"))}">&#128269; ${esc(t("syn.deckBtn"))}</button>
                <button class="btn ghost" data-analysebtn="${d.id}"
                  title="${esc(t("an.btnTitle"))}">&#128295; ${esc(t("an.btn"))}</button>
                <button class="btn ghost syn-ai-btn" data-synaibtn="${d.id}"
                  title="${esc(t("syn.aiDeckTitle"))}">&#10024; ${esc(t("syn.ai"))}</button>
                <button class="btn ghost" data-combobtn="${d.id}"
                  title="${esc(t("combo.deckTitle"))}">&#128279; ${esc(t("combo.btn"))}</button>
              </div>
              <div class="tool-row" style="margin-top:8px">
                <div class="field" style="width:118px"><label>${esc(t("deck.maxPerCard"))}</label>
                  <input type="number" data-syncap="${d.id}" min="0" step="0.5" value="${prefWert("capDefault") ?? ""}"
                    placeholder="${esc(t("syn.capPh"))}" title="${esc(t("syn.capTitle"))}"></div>
                <div class="field syn-std-btn" style="width:118px"><label>${esc(t("deck.budget"))}</label>
                  <input type="number" data-synbudget="${d.id}" min="0" step="1" value="${prefWert("budgetDefault") ?? ""}"
                    placeholder="${esc(t("syn.budgetPh"))}" title="${esc(t("syn.budgetTitle"))}"></div>
                <span class="hint" style="align-self:center">${esc(t("deck.priceHint"))}</span>
              </div>
            </div>
          </div>` : ""}
        </div>
        <div class="deck-dash" data-dash="${d.id}" style="margin-top:12px"></div>
        ${rows ? `<div class="xscroll" style="overflow-x:auto"><table class="deck-tbl" style="margin-top:10px">
                    <thead>${cardHead(true)}</thead>${deckKoerper}</table></div>`
               : `<div class="empty">${esc(t("deck.emptyDeck"))}</div>`}
        <div class="deck-syn" data-synbox="${d.id}" style="margin-top:12px"></div>
        <div class="deck-combos" data-combobox="${d.id}" style="margin-top:12px"></div>
        <div class="deck-legal" data-legalbox="${d.id}" style="margin-top:12px"></div>
        <div class="deck-bracket" data-bracketbox="${d.id}" style="margin-top:12px"></div>
      </div>
    </div>`;
  }).join("");
  // Bei aktivem Filter kann die Auswahl leer sein — dann ein Hinweis statt
  // einer blanken Fläche.
  $("#deck-list").innerHTML = html ||
    `<div class="card"><div class="empty">${esc(t("deck.noMatch"))}</div></div>`;

  // Auto-Legalität für bereits offene Decks (Seiten-Neuaufbau, nach Bearbeitung):
  // die Klick-Handler decken nur frisch aufgeklappte Decks ab (Aufklappen löst
  // kein renderDecks aus). deckLegalAutoTrigger prüft Einstellung + Aktualität.
  if (suchPrefs().autoDeckLegal) sichtbar.forEach(d => { if (deckOffen.ist(d.id)) deckLegalAutoTrigger(d); });

  $$("#deck-list .deck-kopf").forEach(k => k.onclick = ev => {
    // Im Kopf sitzen Knöpfe (Umbenennen, Löschen) und die Legalitäts-Pille (nur
    // zum Hovern) — deren Klick darf nicht zuklappen.
    if (ev.target.closest("button, .deck-legal-wrap")) return;
    const offen = deckOffen.schalte(k.dataset.toggle);
    const karte = k.parentElement;
    karte.querySelector(".deck-inhalt").style.display = offen ? "block" : "none";
    k.querySelector(".deck-pfeil").innerHTML = offen ? "&#9660;" : "&#9654;";
    k.title = offen ? t("common.collapse") : t("common.expand");
    // Einstellung „Combos automatisch laden": beim Aufklappen die Combo-Suche
    // anstoßen — über den Knopf, damit Busy-Zustand und Anzeige identisch zum
    // Handklick laufen. Nur wenn der Kasten noch leer ist (kein Doppel-Laden).
    if (offen && suchPrefs().comboAuto) {
      const boxC = karte.querySelector(".deck-combos");
      const btnC = karte.querySelector(`[data-combobtn="${k.dataset.toggle}"]`);
      if (boxC && !boxC.childElementCount && btnC && !btnC.disabled) btnC.click();
    }
    // Einstellung „Deck-Legalität beim Öffnen prüfen": still nur in die Header-Pille.
    if (offen) deckLegalAutoTrigger(DECKS.find(x => x.id === k.dataset.toggle));
  });

  // Commanderkarte im Deck-Kopf: beim Hover die große Vorschau + Name schweben
  // lassen — dieselbe Vorschau wie bei den Commander-Karten in der Spielrunde.
  // Nur auf Hover-fähigen Geräten.
  if (HOVER_OK) $$("#deck-list .deck-haupt[data-cmd-img]").forEach(el => {
    el.addEventListener("mousemove", e => zeigeCmdHover(el.dataset.cmdImg, el.dataset.cmdName, e.clientX, e.clientY));
    el.addEventListener("mouseleave", versteckeCmdHover);
  });

  $$("#deck-list .deck-tbl").forEach(t => wireCardRows(t));

  // Typ-Kategorien im Deck auf-/zuklappen: nur die Kartenzeilen dieses <tbody>
  // ausblenden, Zustand in deckCatZu merken (übersteht das nächste renderDecks).
  $$("#deck-list .deck-cat-head").forEach(h => h.onclick = () => {
    const tb = h.closest(".deck-cat-body");
    const zu = tb.classList.toggle("zu");
    zu ? deckCatZu.add(h.dataset.cattoggle) : deckCatZu.delete(h.dataset.cattoggle);
    h.querySelector(".deck-cat-arrow").innerHTML = zu ? "&#9654;" : "&#9660;";
  });

  // Offene Deck-Statistiken füllen. Erst jetzt, weil renderDash in ein
  // reales, sichtbares Element schreibt — der data-ans-ende-Trick braucht
  // die Breite des Kastens.
  deckDashRows.forEach((rows, id) => {
    const ziel = $(`.deck-dash[data-dash="${id}"]`);
    if (ziel) renderDash(rows, ziel, false);
  });

  $$("[data-dashtoggle]").forEach(b => b.onclick = () => {
    const id = b.dataset.dashtoggle;
    const an = !deckDashOffen.has(id);
    an ? deckDashOffen.add(id) : deckDashOffen.delete(id);
    // Der Knopf sitzt jetzt im Deck-Kopf, die Statistik rendert aber im Körper.
    // Beim Einschalten das Deck aufklappen, sonst bliebe sie unsichtbar.
    if (an && !deckOffen.ist(id)) deckOffen.schalte(id);
    renderDecks();
  });

  // Synergien fürs Deck: häufigste Haken über alle Deckkarten, gefiltert auf
  // die Farbidentität des Decks; besessene/enthaltene Karten fallen raus.
  $$("[data-synbtn]").forEach(b => b.onclick = () => {
    const id = b.dataset.synbtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => CARDS.find(x => x.id === e.cardId)).filter(Boolean);
    const box = $(`.deck-syn[data-synbox="${id}"]`);
    if (!cards.length || !box) return;
    const lbl = t("syn.deckBtn");
    const gsw = [$(`[data-analysebtn="${id}"]`), $(`[data-synaibtn="${id}"]`)];
    synBtnBusy(b, lbl, true);
    synGeschwister(gsw, true);
    const weg = excludeVon(cards);   // nur Karten DIESES Decks raus, Besessenes darf auftauchen
    // Erst wenn die Suche fertig ist, nach unten zu den Ergebnissen springen —
    // vorher dreht sich das Zahnrad am Knopf, wo der Blick gerade ist.
    synergieAnzeigen(box, deckHooks(cards.map(c => ({ c }))),
      { excludeIds: weg.ids, excludeNames: weg.names, colors: farbIdentitaet(cards),
        maxHooks: 5, limit: 20, deckId: id,
        maxPrice: numVal($(`[data-syncap="${id}"]`)), totalBudget: numVal($(`[data-synbudget="${id}"]`)) })
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => { synBtnBusy(b, lbl, false); synGeschwister(gsw, false); });
  });

  // Deck-Analyse: welche Funktionsbausteine (Ramp, Kartenvorteil, Entfernung,
  // Boardwipes) fehlen? Ergebnis in denselben Kasten wie die Synergien.
  $$("[data-analysebtn]").forEach(b => b.onclick = () => {
    const id = b.dataset.analysebtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => {
      const c = CARDS.find(x => x.id === e.cardId);
      return c ? { ...c, qty: e.qty } : null;
    }).filter(Boolean);
    const box = $(`.deck-syn[data-synbox="${id}"]`);
    if (!cards.length || !box) return;
    const lbl = t("an.btn");
    const gsw = [$(`[data-synbtn="${id}"]`), $(`[data-synaibtn="${id}"]`)];
    synBtnBusy(b, lbl, true, "&#128295;");
    synGeschwister(gsw, true);
    deckAnalyseAnzeigen(box, cards, farbIdentitaet(cards), id)
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => { synBtnBusy(b, lbl, false, "&#128295;"); synGeschwister(gsw, false); });
  });

  // KI-Synergien fürs ganze Deck: die Deckliste als Kontext an Claude (implizite
  // Synergien), Vorschläge gegen Scryfall geprüft und auf die Deckfarben gefiltert.
  $$("[data-synaibtn]").forEach(b => b.onclick = () => {
    const id = b.dataset.synaibtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => CARDS.find(x => x.id === e.cardId)).filter(Boolean);
    const box = $(`.deck-syn[data-synbox="${id}"]`);
    if (!cards.length || !box) return;
    const lbl = t("syn.ai");
    // Standard-Synergien UND Deck-Analyse sperren, solange die (langsame, teils
    // bezahlte) KI-Suche läuft — sie würden denselben Kasten überschreiben.
    const gsw = [$(`[data-synbtn="${id}"]`), $(`[data-analysebtn="${id}"]`)];
    synBtnBusy(b, lbl, true, "&#10024;");
    synGeschwister(gsw, true);
    kiSynergienDeck(d, cards, box, { maxPrice: numVal($(`[data-syncap="${id}"]`)) })
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => { synBtnBusy(b, lbl, false, "&#10024;"); synGeschwister(gsw, false); });
  });

  // Combos im Deck über Commander Spellbook: fertige + „fast fertige" Combos in
  // einen EIGENEN Kasten (nicht den Synergie-Kasten), daher keine Geschwister-
  // Sperre nötig — die Synergie-Knöpfe schreiben woanders hin.
  $$("[data-combobtn]").forEach(b => b.onclick = () => {
    const id = b.dataset.combobtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => CARDS.find(x => x.id === e.cardId)).filter(Boolean);
    const box = $(`.deck-combos[data-combobox="${id}"]`);
    if (!cards.length || !box) return;
    const lbl = t("combo.btn");
    synBtnBusy(b, lbl, true, "&#128279;");
    deckCombosAnzeigen(box, cards, id)
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => synBtnBusy(b, lbl, false, "&#128279;"));
  });

  // Deck-Legalität: jede Deckkarte gegen das Deck-Format prüfen (gebannt /
  // nicht legal, Vintage-restricted mehrfach). Eigener Kasten, Karten MIT Menge
  // (die Mengen braucht die restricted-Prüfung).
  $$("[data-legalbtn]").forEach(b => b.onclick = () => {
    const id = b.dataset.legalbtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => {
      const c = CARDS.find(x => x.id === e.cardId);
      return c ? { ...c, qty: e.qty } : null;
    }).filter(Boolean);
    const box = $(`.deck-legal[data-legalbox="${id}"]`);
    if (!cards.length || !box) return;
    const lbl = t("legal.deckBtn");
    synBtnBusy(b, lbl, true, "&#9878;");
    deckLegalPruefen(box, cards, d)
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => synBtnBusy(b, lbl, false, "&#9878;"));
  });

  // Fehlende Karten kaufen: die (Deckmenge > Bestand) fehlenden Karten in einen
  // Dialog, dort als Cardmarket-Wants-Liste kopieren + Wants-Seite öffnen.
  $$("[data-buybtn]").forEach(b => b.onclick = () => oeffneKauf(b.dataset.buybtn));

  // Deck-Bracket (Power-Level) über Commander Spellbook (estimate-bracket mit
  // der Deckliste). Das Ergebnis ersetzt die Knopf-Beschriftung („Bracket:
  // Spicy"); der Knopf bleibt anklickbar zum Neuberechnen.
  $$("[data-bracketbtn]").forEach(b => b.onclick = async () => {
    const id = b.dataset.bracketbtn;
    const d = DECKS.find(x => x.id === id);
    if (!d) return;
    const cards = (d.entries || []).map(e => CARDS.find(x => x.id === e.cardId)).filter(Boolean);
    if (!cards.length) return;
    const box = $(`.deck-bracket[data-bracketbox="${id}"]`);
    const orig = b.innerHTML;
    b.disabled = true;
    b.innerHTML = `<span class="syn-spin">&#9881;</span> ${esc(t("bracket.btn"))}`;
    try {
      const data = await combosApi({ mode: "bracket", cards: cards.map(c => ({ card: c.name, quantity: 1 })) });
      const tag = data.bracketTag;
      const nm = BRACKET_NAMES[tag] || tag || "?";
      const stufe = BRACKET_STUFE[tag];
      // Knopf-Beschriftung: „Bracket 3 · Spicy" (bzw. „Banned"); der aufklappbare
      // Grund + die Legende landen im eigenen Kasten darunter.
      b.innerHTML = tag === "B"
        ? `&#9878; ${esc(t("bracket.badgeBanned"))}`
        : `&#9878; ${esc(t("bracket.badge", { stufe: stufe ?? "?", name: nm }))}`;
      b.title = t("bracket.resTitle", { n: data.comboCount });
      if (box) { deckBracketAnzeigen(box, data); box.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    } catch (e) {
      b.innerHTML = orig; toast(e.message);
    } finally { b.disabled = false; }
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
  $$("[data-share]").forEach(b => b.onclick = () => shareDeck(b.dataset.share));

  $$("[data-dx]").forEach(b => b.onclick = async () => {
    const d = DECKS.find(x => x.id === b.dataset.dx);
    if (!await confirmDlg(t("dlg.deckDelete", { name: esc(d.name) }))) return;
    try {
      const { error } = await sb.from("decks").delete().eq("id", d.id);
      if (error) throw error;
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); }
  });
  $$("[data-dadd]").forEach(inp => {
    attachLocalSuggest(inp);
    // Auswahl nur merken; ins Deck gelegt wird erst per „Hinzufügen"-Knopf.
    inp.addEventListener("deck-pick", ev => { inp.dataset.picked = ev.detail; });
    // Tippt man nach der Auswahl weiter, ist die gemerkte Karte hinfällig.
    inp.addEventListener("input", () => { delete inp.dataset.picked; });
  });
  $$("[data-daddbtn]").forEach(btn => btn.onclick = async () => {
    const deckId = btn.dataset.daddbtn;
    const inp = $(`[data-dadd="${deckId}"]`);
    const cardId = inp?.dataset.picked;
    if (!cardId) { toast(t("deck.addPick")); inp?.focus(); return; }   // nichts gewählt
    const d = DECKS.find(x => x.id === deckId);
    if (!d) return;
    const add = Math.max(1, parseInt($(`[data-dqty="${deckId}"]`).value) || 1);
    const ex = d.entries.find(e => e.cardId === cardId);
    btn.disabled = true;
    try {
      const { error } = await sb.from("deck_entries")
        .upsert({ deck_id: deckId, card_id: cardId, qty: (ex?.qty || 0) + add },
                { onConflict: "deck_id,card_id" });
      if (error) throw error;
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); btn.disabled = false; }
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
        // Auswahl übernehmen (das Feld zeigt die Karte), aber NICHT sofort ins Deck
        // legen — das macht erst der „Hinzufügen"-Knopf, sodass man die Menge in
        // Ruhe setzen und einen Fehlgriff noch korrigieren kann.
        e.preventDefault(); inp.value = c.disp; close();
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

/* ---- Cardmarket-Verkaufsliste -------------------------------------------
   Nicht die ganze Sammlung, sondern eine KURATIERTE Liste: einzelne Karten
   werden in der Sammlung mit dem €-Knopf markiert (DB-Spalte `for_sale`, damit
   es geräteübergreifend synchron bleibt). Aus dieser Liste entsteht die CSV
   (Format wie zuvor für die Bulk-Listing-Importer) UND eine kompakte JSON, die
   unser eigenes Bookmarklet auf der Cardmarket-Seite aus der Zwischenablage
   liest. Cardmarkets API ist für neue Zugänge geschlossen, ein Add-on nutzen
   wir bewusst nicht — das Bookmarklet ist unser eigener Code, kein Store. */
const CM_LANG = { en: "English", de: "German", fr: "French", es: "Spanish",
  it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean", ru: "Russian",
  zhs: "S-Chinese", zht: "T-Chinese" };
const CM_COLS = ["name", "set", "setCode", "collectorNumber", "language",
  "condition", "isFoil", "isSigned", "quantity", "price", "comment", "idProduct"];

/* Die markierten Karten (Bestand > 0). for_sale kommt über reload() mit. */
function sellList() {
  return CARDS.filter(c => c.for_sale && (c.qty | 0) > 0);
}

function cmRow(c) {
  return {
    name: c.name || c.disp || "",
    set: c.set_name || "",
    setCode: c.set || "",
    collectorNumber: c.cn || "",
    language: CM_LANG[(c.lang || "").toLowerCase()] || "",
    condition: c.condition || "NM",
    isFoil: c.foil ? "foil" : "",
    isSigned: "",
    quantity: c.qty | 0,
    price: c.price == null ? "" : Number(c.price).toFixed(2),
    comment: "",
    idProduct: c.cm_id ?? "",
  };
}
function cmSortRows(cards) {
  return cards.map(cmRow).sort((a, b) =>
    (a.set || "").localeCompare(b.set || "") || (a.name || "").localeCompare(b.name || ""));
}
function cmCsv(rows) {
  // KEIN BOM: csv-parse strippt keins, sonst wird die erste Überschrift
  // („﻿name") nicht als Spalte erkannt. Quoting über csvCell (RFC 4180).
  return CM_COLS.join(",") + "\r\n" +
    rows.map(r => CM_COLS.map(k => csvCell(r[k])).join(",")).join("\r\n");
}

/* Cardmarkets „mehrere Artikel einstellen" — lokalisiert, verifizierte URL. */
function massListingUrl() {
  const l = ["de", "en", "fr", "es", "it"].includes(LANG) ? LANG : "en";
  return `https://www.cardmarket.com/${l}/Magic/MassListing`;
}

/* Kompakte JSON für die Zwischenablage → das Bookmarklet liest sie drüben. */
function sellClipboardPayload(cards) {
  return JSON.stringify(cards.map(c => ({
    n: c.name || c.disp || "", s: c.set_name || "", sc: c.set || "", cn: c.cn || "",
    l: CM_LANG[(c.lang || "").toLowerCase()] || "", c: c.condition || "NM",
    f: !!c.foil, q: c.qty | 0, p: c.price == null ? "" : Number(c.price).toFixed(2),
    id: c.cm_id ?? "",
  })));
}

/* Markieren/Entmarkieren. Optimistisch lokal, dann DB; bei Fehler zurück. */
async function setSale(id, val, btn) {
  const c = CARDS.find(x => x.id === id);
  if (!c || c.for_sale === val) { syncSaleUI(id, val, btn); return true; }
  const prev = c.for_sale;
  c.for_sale = val;
  syncSaleUI(id, val, btn);
  const { error } = await sb.from("cards").update({ for_sale: val }).eq("id", id);
  if (error) { c.for_sale = prev; syncSaleUI(id, prev, btn); toast(dbErr(error)); return false; }
  return true;
}
function toggleSale(id, btn) {
  const c = CARDS.find(x => x.id === id);
  return setSale(id, !(c && c.for_sale), btn);
}
function syncSaleUI(id, val, btn) {
  const b = btn || document.querySelector(`#tbl tr[data-id="${CSS.escape(id)}"] [data-sell]`);
  if (b) b.classList.toggle("on", !!val);
  aktualisiereVerkaufZaehler();
}
function aktualisiereVerkaufZaehler() {
  const b = $("#sell-open");
  if (!b) return;
  const n = sellList().length;
  b.textContent = `\u{1F3F7} ${t("sell.list")} (${n})`;
  b.classList.toggle("has", n > 0);
}

/* Verkaufsliste-Dialog */
function oeffneVerkauf() { renderVerkauf(); $("#sell-dlg").showModal(); }

function renderVerkauf() {
  const body = $("#sell-body");
  if (!body) return;
  const list = sellList();
  const head = `<h3 style="margin:0 0 6px">${esc(t("sell.title"))} (${list.length})</h3>`;
  if (!list.length) {
    body.innerHTML = head + `<p class="hint">${esc(t("sell.emptyHint"))}</p>` + bookmarkletBoxHtml();
    wireVerkauf(); return;
  }
  const items = list.map(c => `
    <div class="sell-item" data-id="${esc(c.id)}">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : `<div class="sell-noimg"></div>`}
      <div class="sell-meta">
        <div class="sell-nm">${esc(c.name || c.disp)}</div>
        <div class="hint">${esc([c.set_name, CONDITION_BY[c.condition]?.name || c.condition,
          c.foil ? "Foil" : "", langName(c.lang)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="sell-pq">${c.qty}&times; ${c.price == null ? "&mdash;" : eur(c.price)}</div>
      <button class="btn ghost sm" data-unsell title="${esc(t("sell.remove"))}">&times;</button>
    </div>`).join("");
  const actions = `
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
      <div style="flex:none"><button class="btn" id="sell-go">${esc(t("sell.copyOpen"))}</button></div>
      <div style="flex:none"><button class="btn ghost" id="sell-csv">${esc(t("sell.csv"))}</button></div>
      <div style="flex:none"><button class="btn ghost" id="sell-clear">${esc(t("sell.clear"))}</button></div>
    </div>`;
  body.innerHTML = head + `<div class="sell-liste">${items}</div>` + actions + bookmarkletBoxHtml();
  wireVerkauf();
}

function bookmarkletBoxHtml() {
  return `
    <details class="bm-box" style="margin-top:16px">
      <summary>${esc(t("sell.bmSetup"))}</summary>
      <p class="hint" style="margin-top:8px">${esc(t("sell.bmHow"))}</p>
      <p style="margin:8px 0"><a id="bm-link" class="bm-link" draggable="true">&#8595; ${esc(t("sell.bmName"))}</a></p>
      <div class="row"><div style="flex:none"><button class="btn ghost sm" id="bm-copy">${esc(t("sell.bmCopy"))}</button></div></div>
      <p class="hint" style="margin-top:8px">${esc(t("sell.bmBeta"))}</p>
    </details>`;
}

function wireVerkauf() {
  const go = $("#sell-go"); if (go) go.onclick = verkaufKopierenUndOeffnen;
  const csv = $("#sell-csv"); if (csv) csv.onclick = verkaufCsv;
  const cl = $("#sell-clear"); if (cl) cl.onclick = verkaufLeeren;
  $$("#sell-body [data-unsell]").forEach(b => {
    b.onclick = async () => { await setSale(b.closest("[data-id]").dataset.id, false); renderVerkauf(); };
  });
  const link = $("#bm-link"); if (link) link.href = BOOKMARKLET;
  const bc = $("#bm-copy");
  if (bc) bc.onclick = async () => {
    try { await navigator.clipboard.writeText(BOOKMARKLET); toast(t("sell.bmCopied")); }
    catch (e) { toast(e.message); }
  };
}

async function verkaufKopierenUndOeffnen() {
  const list = sellList();
  if (!list.length) { toast(t("sell.empty")); return; }
  try { await navigator.clipboard.writeText(sellClipboardPayload(list)); toast(t("sell.copied")); }
  catch (e) { toast(t("sell.copyFail")); }
  // Auch bei Clipboard-Fehler die Seite öffnen — die Liste steht ja noch da.
  window.open(massListingUrl(), "_blank", "noopener");
}
function verkaufCsv() {
  const list = sellList();
  if (!list.length) { toast(t("sell.empty")); return; }
  download(`cardmarket-verkauf-${today()}.csv`, cmCsv(cmSortRows(list)), "text/csv");
}
async function verkaufLeeren() {
  const list = sellList();
  if (!list.length) return;
  if (!await confirmDlg(t("sell.clearConfirm", { n: list.length }))) return;
  const ids = list.map(c => c.id);
  const { error } = await sb.from("cards").update({ for_sale: false }).in("id", ids);
  if (error) { toast(dbErr(error)); return; }
  list.forEach(c => c.for_sale = false);
  renderVerkauf(); aktualisiereVerkaufZaehler(); renderCollection();
}

/* ---- Bookmarklet ---------------------------------------------------------
   Läuft NICHT in unserer App, sondern auf der Cardmarket-Seite (deshalb kein
   Zugriff auf unsere Variablen/i18n — alles selbstständig, Texte deutsch).
   v1 ist bewusst NUR eine Lese-Hilfe: es liest die Verkaufsliste aus der
   Zwischenablage und legt sie als verschiebbares Panel ÜBER die Seite, je
   Karte ein Klick = Name kopiert. Es schreibt NICHTS ins Verkaufsformular —
   ein blindes Auto-Ausfüllen einer echten (Geld-)Verkaufsmaske wäre fahrlässig;
   das echte Ausfüllen kalibrieren wir separat an der Live-Seite. */
function bookmarkletSource() {
  var H = location.hostname.replace(/^www\./, "");
  if (H !== "cardmarket.com") { alert("Bitte zuerst die Cardmarket-Seite öffnen (Verkaufen → mehrere Artikel einstellen)."); return; }
  function esc(s) { var d = document.createElement("div"); d.textContent = (s == null ? "" : String(s)); return d.innerHTML; }
  function build(items) {
    var old = document.getElementById("aa-sell-ov"); if (old) old.remove();
    var ov = document.createElement("div"); ov.id = "aa-sell-ov";
    ov.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;width:330px;max-height:86vh;overflow:auto;background:#12131a;color:#e9e9ee;font:13px/1.4 system-ui,Arial,sans-serif;border:1px solid #d4af37;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.55)";
    var rows = items.map(function (it, i) {
      var sub = [it.s, it.c, (it.f ? "Foil" : ""), it.l].filter(Boolean).join(" · ");
      return '<div class="aa-it" data-i="' + i + '" style="padding:8px 10px;border-top:1px solid #2a2c38;cursor:pointer">'
        + '<div style="display:flex;justify-content:space-between;gap:8px">'
        + '<b style="font-weight:600">' + esc(it.n) + '</b>'
        + '<span style="color:#d4af37;white-space:nowrap">' + (it.q || 1) + '× ' + (it.p ? esc(it.p) + " €" : "—") + '</span></div>'
        + '<div style="color:#99a;margin-top:2px">' + esc(sub) + '</div></div>';
    }).join("");
    ov.innerHTML = '<div id="aa-h" style="padding:10px 12px;background:#1b1d27;cursor:move;display:flex;justify-content:space-between;align-items:center;border-radius:10px 10px 0 0">'
      + '<b>Arcanum → Verkauf (' + items.length + ')</b>'
      + '<button id="aa-x" style="background:none;border:0;color:#e9e9ee;font-size:18px;cursor:pointer;line-height:1">×</button></div>'
      + '<div style="padding:8px 12px;color:#99a;border-bottom:1px solid #2a2c38">Karte antippen → Name ist kopiert, dann ins Cardmarket-Suchfeld einfügen. Preis/Zustand daneben ablesen.</div>'
      + rows;
    document.body.appendChild(ov);
    document.getElementById("aa-x").onclick = function () { ov.remove(); };
    var h = document.getElementById("aa-h"), dx = 0, dy = 0, drag = false;
    h.onmousedown = function (e) { drag = true; dx = e.clientX - ov.offsetLeft; dy = e.clientY - ov.offsetTop; e.preventDefault(); };
    document.addEventListener("mousemove", function (e) { if (!drag) return; ov.style.left = (e.clientX - dx) + "px"; ov.style.top = (e.clientY - dy) + "px"; ov.style.right = "auto"; });
    document.addEventListener("mouseup", function () { drag = false; });
    Array.prototype.forEach.call(ov.querySelectorAll(".aa-it"), function (el) {
      el.onclick = function () {
        navigator.clipboard.writeText(items[+el.dataset.i].n).then(function () { el.style.background = "#243024"; });
      };
    });
  }
  navigator.clipboard.readText().then(function (txt) {
    var items = null; try { items = JSON.parse(txt); } catch (e) { items = null; }
    if (!items || !items.length || !items[0] || !items[0].n) {
      alert("Keine Verkaufsliste in der Zwischenablage.\nIn Arcanum Archive erst „Liste kopieren + Cardmarket öffnen“ anklicken.");
      return;
    }
    build(items);
  }, function () { alert("Zwischenablage nicht lesbar – bitte die Leseberechtigung erlauben und erneut klicken."); });
}
const BOOKMARKLET = "javascript:(" + bookmarkletSource.toString().replace(/\s+/g, " ") + ")()";

/* ---- „Fehlende Karten kaufen" -------------------------------------------
   Aus einem (oft frisch importierten) Deck die Karten, die man NICHT genug
   besitzt: fehlt = Deckmenge − Bestand. Cardmarket hat keine offene API und
   keinen Warenkorb-Deeplink; am schnellsten kauft man dort über die „Wants"
   per Decklisten-Einfügung. Wir liefern die fehlenden Karten als Decklisten-
   Text (N Kartenname) zum Kopieren und öffnen die Wants-Seite; je Karte dazu
   ein Cardmarket-Link (frisch importierte Karten haben keine cm_id → Suche
   statt Produktseite). */
function fehlendeKarten(d) {
  return (d.entries || [])
    .map(e => { const c = CARDS.find(x => x.id === e.cardId);
                return c ? { c, fehlt: Math.max(0, e.qty - bestandVon(c)) } : null; })
    .filter(x => x && x.fehlt > 0);
}

/* Cardmarket-Kartenname: nur die Vorderseite (Cardmarkets Produktname), ohne
   „ // Rückseite" — sonst greift der Wants-/Such-Import bei Doppelkarten nicht. */
function cmName(c) { return (c.name || c.disp || "").split(" // ")[0].trim(); }

/* Wants-Import-Text: „N Kartenname" je Zeile — das Format, das Cardmarket unter
   Wants → „Decklist zu Wants hinzufügen" erwartet. */
function kaufWantlist(items) {
  return items.map(({ c, fehlt }) => `${fehlt} ${cmName(c)}`).join("\n");
}
function cmSprache() { return ["de", "en", "fr", "es", "it"].includes(LANG) ? LANG : "en"; }
function cmWantsUrl() { return `https://www.cardmarket.com/${cmSprache()}/Magic/Wants`; }
function cmKaufLink(c) {
  return c.cm_id ? cmLink(c.cm_id)
    : `https://www.cardmarket.com/${cmSprache()}/Magic/Products/Search?searchString=${encodeURIComponent(cmName(c))}`;
}

let KAUF_DECK_ID = null;   // Deck, dessen Fehlliste der Kauf-Dialog gerade zeigt

function oeffneKauf(deckId) {
  KAUF_DECK_ID = deckId;
  renderKauf();
  $("#buy-dlg").showModal();
}
function kaufDeck() { return DECKS.find(d => d.id === KAUF_DECK_ID) || null; }

function renderKauf() {
  const body = $("#buy-body");
  if (!body) return;
  const d = kaufDeck();
  const items = d ? fehlendeKarten(d) : [];
  const head = `<h3 style="margin:0 0 6px">${esc(t("buy.title"))}${d ? " – " + esc(d.name) : ""}</h3>`;
  if (!items.length) { body.innerHTML = head + `<p class="hint">${esc(t("buy.complete"))}</p>`; return; }
  const stueck = items.reduce((s, x) => s + x.fehlt, 0);
  const summe  = items.reduce((s, x) => s + (x.c.price || 0) * x.fehlt, 0);
  const sub = `<p class="hint" style="margin:0 0 10px">${esc(t("buy.summary", { n: items.length, s: stueck }))} · ~${eur(summe)}</p>`;
  const liste = items.map(({ c, fehlt }) => `
    <div class="sell-item">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : `<div class="sell-noimg"></div>`}
      <div class="sell-meta">
        <div class="sell-nm">${esc(c.disp || c.name)}</div>
        <div class="hint">${esc([c.set_name, cmName(c)].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="sell-pq">${fehlt}&times; ${c.price == null ? "&mdash;" : eur(c.price)}</div>
      <a class="cm cm-logo" href="${esc(cmKaufLink(c))}" target="_blank" rel="noopener noreferrer"
         title="${esc(t("buy.cmSearch"))}">${CM_LOGO}</a>
    </div>`).join("");
  const actions = `
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
      <div style="flex:none"><button class="btn" id="buy-go">${esc(t("buy.copyOpen"))}</button></div>
      <div style="flex:none"><button class="btn ghost" id="buy-txt">${esc(t("buy.txt"))}</button></div>
    </div>
    <p class="hint" style="margin-top:8px">${esc(t("buy.hint"))}</p>`;
  body.innerHTML = head + sub + `<div class="sell-liste">${liste}</div>` + actions;
  const go = $("#buy-go"); if (go) go.onclick = kaufKopierenUndOeffnen;
  const tx = $("#buy-txt"); if (tx) tx.onclick = kaufTxt;
}

async function kaufKopierenUndOeffnen() {
  const d = kaufDeck(); const items = d ? fehlendeKarten(d) : [];
  if (!items.length) return;
  try { await navigator.clipboard.writeText(kaufWantlist(items)); toast(t("buy.copied")); }
  catch { toast(t("buy.copyFail")); }
  // Auch bei Clipboard-Fehler öffnen — die Liste steht ja im Dialog.
  window.open(cmWantsUrl(), "_blank", "noopener");
}
function kaufTxt() {
  const d = kaufDeck(); const items = d ? fehlendeKarten(d) : [];
  if (!items.length) return;
  const nm = (d?.name || "deck").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "deck";
  download(`wants-${nm}-${today()}.txt`, kaufWantlist(items), "text/plain");
}

/* Einspielen einer alten lokalen Sicherung (aus der IndexedDB-Fassung). */
async function importJson(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.cards)) throw new Error(t("imp.badBackup"));
  if (!await confirmDlg(t("dlg.importCards", { n: data.cards.length }))) return;

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
  toast(bad ? t("toast.importedCardsSome", { ok, bad }) : t("toast.importedCards", { ok }));
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
  if (rows.length < 2) throw new Error(t("imp.noCardRows"));

  const col = csvColumns(rows[0]);
  if (col.name < 0 || (col.scryfall_id < 0 && (col.set_code < 0 || col.cn < 0)))
    throw new Error(t("imp.unknownCsv"));

  const data = rows.slice(1).filter(r => r.some(c => c.trim()));
  const decks = col.cname >= 0
    ? [...new Set(data.map(r => (r[col.cname] || "").trim()).filter(Boolean))] : [];

  const ok = await confirmDlg(t("dlg.importRows", {
    n: data.length, file: esc(file.name),
    deck: decks.length ? t("dlg.importRowsDeck", { names: esc(decks.join("“, „")) }) : ""
  }));
  if (!ok) return;

  const box = $("#import-status");
  const say = h => { if (box) box.innerHTML = h; };

  // Was schon in der Sammlung ist, kennen wir. Key wie der Eindeutigkeits-
  // schlüssel der Datenbank, damit "überspringen" dieselbe Karte trifft.
  const key = (sid, foil, lang, cond) => `${sid}|${foil ? 1 : 0}|${lang}|${cond}`;
  const known = new Map();
  for (const c of CARDS) known.set(key(c.scryfall_id, c.foil, c.lang, c.condition), c.id);

  let imported = 0, skipped = 0;
  const failed = [];
  const deckWants = [];   // { name, cardId, qty }

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const g = k => (col[k] >= 0 ? (r[col[k]] || "").trim() : "");
    const csvName = g("name");
    const lang = (g("lang") || "en").toLowerCase();
    const cond = normCond(g("condition"));
    // Exakt vergleichen: "nonfoil" enthält "foil" als Teilstring — ein
    // Substring-Test hielte deshalb JEDE Zeile für Foil. Scryfall kennt
    // genau drei Finishes: nonfoil, foil, etched.
    const fin = g("finish").toLowerCase();
    const foil = fin === "foil" || fin === "etched";
    const qty = Math.max(1, parseInt(g("qty")) || 1);

    say(t("imp.progress", { i: i + 1, n: data.length, name: esc(csvName),
      imported, skipped, failed: failed.length }));

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
    say(t("imp.creatingDecks"));
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
      deckMsg = error ? t("imp.deckPartFail")
                      : t("imp.deckCreated", { names: esc([...idByName.keys()].join("“, „")) });
    }
  }

  await reload(); renderAll();
  say(t("imp.done", {
    imported, skipped, deckMsg,
    failedLine: failed.length ? t("imp.failedList", {
      n: failed.length,
      list: esc(failed.slice(0, 8).join(", ")) + (failed.length > 8 ? " …" : "")
    }) : ""
  }));
  toast(t("toast.importedN", { n: imported }) +
        (skipped ? t("toast.importedSkippedSuffix", { n: skipped }) : ""));
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
    <td><select data-mi-foil><option value="0">${esc(t("edit.normal"))}</option><option value="1">Foil</option></select></td>
    <td><select data-mi-lang>${MI_LANGS.map(l =>
      `<option value="${l}">${l.toUpperCase()}</option>`).join("")}</select></td>
    <td class="num"><button class="btn ghost sm" data-mi-del title="${esc(t("mi.delRow"))}">&times;</button></td>
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
      if (!set || !num) { sag("✗ " + t("mi.needSetNum"), "var(--err)"); fail++; continue; }

      sag(t("mi.searching"));
      let card = null;
      try { card = await findByCode(set, num, lang, zei === "T"); } catch { /* unten melden */ }
      if (!card) { sag("✗ " + t("mi.notFound", { set: set.toUpperCase(), num }), "var(--err)"); fail++; continue; }

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
      if (error) { sag("✗ " + dbErr(error), "var(--err)"); fail++; continue; }   // dbErr ist bereits übersetzt

      // Erfolgreiche Zeilen bleiben sichtbar stehen (man sieht, was aus der
      // Eingabe wurde), sind aber gesperrt — ein zweites "Importieren"
      // würde sie sonst erneut einbuchen.
      tr.dataset.done = "1";
      tr.querySelectorAll("input,select,button").forEach(x => x.disabled = true);
      sag("✓ " + (card.printed_name || card.name) + (price != null ? " · " + eur(price) : ""), "var(--ok)");
      ok++;
    }
    await reload(); renderAll();
    toast(t("toast.importedN", { n: ok }) + (fail ? t("toast.importedFailedSuffix", { n: fail }) : ""));
  } finally { btn.disabled = false; }
}

/* =============================== Rendern ============================== */
function renderAll() { renderCollection(); renderDecks(); }

/* ============================ Login / Start =========================== */
function showGate(mode) {
  $("#gate").style.display = "block";
  $("#app").style.display = "none";
  $$("#gate .pane").forEach(p => p.style.display = p.dataset.pane === mode ? "block" : "none");
  if (mode === "auth") ladeBenutzerzahl();   // Nutzerzahl auf dem Login-Screen (anon)
}
function showApp() {
  $("#gate").style.display = "none";
  $("#app").style.display = "block";
  renderWho();
  ladeBenutzerzahl();                         // Nutzerzahl dauerhaft im Header
}

async function afterLogin(user) {
  USER = user;
  // Profil laden (bei Erstanmeldung anlegen). Nicht kritisch: schlägt es fehl
  // (z. B. Tabelle noch nicht angelegt), zeigt die App die E-Mail und läuft weiter.
  try { await ladeProfile(); } catch (e) { PROFILE = null; }
  await ladeFlags();   // globale Schalter + Admin-Status, bevor gezeichnet wird
  showApp();
  try { await reload(); renderAll(); }
  catch (e) { toast(dbErr(e)); }
  // Spielrunde: Einladungs-Badge + laufende Session live, auch ohne die Ansicht
  // zu öffnen. Nicht kritisch — schlägt es fehl, läuft der Rest weiter.
  try { await ladeSession(); subscribeInvites(); if (SESSION) subscribeSession(); }
  catch (e) { /* Realtime optional */ }
}

function wireAuth() {
  const msg = (t, cls) => { const m = $("#auth-msg"); m.textContent = t; m.className = "msg " + (cls || ""); };
  let mode = "in";
  $$("#auth-tabs button").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$("#auth-tabs button").forEach(x => x.classList.toggle("on", x === b));
    $("#auth-go").textContent = mode === "in" ? t("auth.signin") : t("auth.signup");
    msg("");
  });

  $("#auth-form").onsubmit = async ev => {
    ev.preventDefault();
    const email = $("#auth-email").value.trim(), pw = $("#auth-pw").value;
    if (!email || !pw) return msg(t("auth.emailPwRequired"), "err");
    if (mode === "up" && pw.length < 8) return msg(t("auth.pwMin8"), "err");
    $("#auth-go").disabled = true; msg(t("auth.moment"));
    try {
      const { data, error } = mode === "in"
        ? await sb.auth.signInWithPassword({ email, password: pw })
        : await sb.auth.signUp({ email, password: pw });
      if (error) throw error;
      if (!data.session) {
        msg(t("auth.accountCreated"), "ok");
      } else {
        await afterLogin(data.user);
      }
    } catch (e) {
      const m = e.message || "";
      msg(m.includes("Invalid login") ? t("auth.badLogin")
        : m.includes("already registered") ? t("auth.alreadyReg")
        : m.includes("Failed to fetch") ? t("auth.noConn")
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
      return $("#setup-msg").textContent = t("setup.urlFormat");
    if (key.length < 20)
      return $("#setup-msg").textContent = t("setup.keyShort");
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

/* Avatar als Bild (falls hochgeladen) oder als Initialen-Kreis. Nimmt ein
   Profil-Objekt {display_name, avatar_url} — Standard ist das eigene; für
   Freunde wird deren Profil übergeben. */
function avatarHtml(size, prof = PROFILE) {
  const s = `width:${size}px;height:${size}px`;
  const name = prof?.display_name?.trim() || (prof === PROFILE ? USER?.email : "") || "";
  if (prof?.avatar_url)
    return `<img class="avatar" src="${esc(prof.avatar_url)}" alt="" style="${s}">`;
  return `<span class="avatar avatar-init" style="${s};font-size:${Math.round(size * 0.4)}px">${esc(initialen(name))}</span>`;
}

/* Kopfzeile rechts: Avatar + Name (oder E-Mail). Dahinter klappt das Menü mit
   Profil, Freunde und Abmelden auf — per Hover am Desktop, per Klick auf
   Touch-Geräten (dort gibt es kein Hover). */
function renderWho() {
  const el = $("#who");
  if (!el) return;
  el.innerHTML = `${avatarHtml(26)}<span>${esc(profilName())}</span><span class="who-caret">&#9662;</span>`;
  el.title = t("who.menu");
  el.onclick = ev => { ev.stopPropagation(); $("#who-menu")?.classList.toggle("open"); };
}

/* Zwei persönliche Highlights über der Sammlungs-Statistik: die wertvollste
   Karte und die neueste Errungenschaft — je mit Mini-Bild und klickbar zur
   Detailansicht. Beides sind Einzel-Callouts, die das Dashboard so nicht zeigt. */
function profilHighlightsHtml() {
  const owned = CARDS.filter(c => c.qty > 0);   // nicht besessene Deck-Karten (qty 0) zählen nicht
  const mitPreis = owned.filter(c => c.price != null);
  const wertvollste = mitPreis.length ? mitPreis.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const mitDatum = owned.filter(c => c.added);
  // added ist ein ISO-Zeitstempel — String-Vergleich reicht für "das späteste".
  const neueste = mitDatum.length ? mitDatum.reduce((a, b) => (b.added > a.added ? b : a)) : null;
  const kachel = (label, c, sub) => c ? `
    <div class="profil-hl-item" data-hl="${c.id}" title="${esc(t("row.viewTitle"))}">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">`
              : '<div class="profil-hl-noimg">&#9670;</div>'}
      <div class="profil-hl-txt">
        <div class="k">${esc(label)}</div>
        <div class="v">${esc(c.disp)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
    </div>` : "";
  const tiles = [
    kachel(t("profile.hlValuable"), wertvollste, wertvollste ? eur(wertvollste.price) : ""),
    kachel(t("profile.hlNewest"), neueste, neueste ? datShort(neueste.added) : ""),
  ].filter(Boolean).join("");
  return tiles ? `<div class="profil-hl">${tiles}</div>` : "";
}

function renderProfile() {
  const el = $("#v-profile");
  if (!el) return;
  const seit = PROFILE?.created ? datShort(PROFILE.created) : "–";
  el.innerHTML = `
    <div class="card profil-kopf">
      <div class="profil-avatar">
        ${avatarHtml(96)}
        <div class="row" style="justify-content:center">
          <div style="flex:none"><button class="btn ghost sm" id="pf-avatar-btn">${esc(t("profile.avatarChange"))}</button></div>
          ${PROFILE?.avatar_url ? `<div style="flex:none"><button class="btn ghost sm" id="pf-avatar-del">${esc(t("profile.avatarRemove"))}</button></div>` : ""}
        </div>
        <input type="file" id="pf-avatar-file" accept="image/*" hidden>
      </div>
      <div class="profil-ident">
        <label>${esc(t("profile.displayName"))}</label>
        <div class="row" style="margin-bottom:8px">
          <div style="flex:1"><input type="text" id="pf-name" maxlength="40"
            value="${esc(PROFILE?.display_name || "")}" placeholder="${esc(t("profile.namePh"))}"></div>
          <div style="flex:none"><button class="btn" id="pf-name-save">${esc(t("common.save"))}</button></div>
        </div>
        <p class="hint" style="margin:0">${esc(t("profile.loggedInAs"))} <b>${esc(USER?.email || "")}</b> &middot; ${esc(t("profile.memberSince"))} ${esc(seit)}</p>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">${esc(t("profile.account"))}</h3>
      <label>${esc(t("profile.newPassword"))}</label>
      <div class="row" style="margin-bottom:6px">
        <div><input type="password" id="pf-pw1" autocomplete="new-password" placeholder="${esc(t("profile.pwMin"))}"></div>
        <div><input type="password" id="pf-pw2" autocomplete="new-password" placeholder="${esc(t("profile.pwRepeat"))}"></div>
        <div style="flex:none"><button class="btn ghost" id="pf-pw-save">${esc(t("profile.pwSave"))}</button></div>
      </div>
      <div class="msg" id="pf-pw-msg"></div>
      <div style="margin-top:14px"><button class="btn danger" id="pf-logout">${esc(t("nav.logout"))}</button></div>
    </div>`;

  $("#pf-avatar-btn").onclick = () => $("#pf-avatar-file").click();
  $("#pf-avatar-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) avatarHochladen(f); };
  const del = $("#pf-avatar-del"); if (del) del.onclick = avatarEntfernen;
  $("#pf-name-save").onclick = nameSpeichern;
  $("#pf-name").addEventListener("keydown", e => { if (e.key === "Enter") nameSpeichern(); });
  $("#pf-pw-save").onclick = passwortAendern;
  $("#pf-logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

/* Ansicht „Dashboard" — eigener Punkt im Benutzermenü. Zeigt die Highlights und
   die Statistik über den GESAMTEN Bestand (qty 0 = Import-Platzhalter zählt
   nicht). Steckte früher im Profil und über der Sammlungstabelle. */
function renderDashboard() {
  const el = $("#v-dashboard");
  if (!el) return;
  const decks = DECKS.length;
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("profile.yourCollection"))}</h3>
      <p class="hint" style="margin-top:-4px">${decks} ${esc(decks === 1 ? t("common.deckOne") : t("common.deckMany"))} &middot; ${esc(t("profile.statAll"))}</p>
      ${profilHighlightsHtml()}
      <div id="dashboard-dash" style="margin-top:12px"></div>
    </div>`;
  // Statistik über den GESAMTEN Bestand — dieselbe renderDash wie zuvor, nur in
  // eigener Ansicht statt im Profil.
  renderDash(CARDS.filter(c => c.qty > 0), $("#dashboard-dash"), false);
  // Highlight-Kacheln öffnen die Detailansicht der jeweiligen Karte.
  $$("#v-dashboard [data-hl]").forEach(k => k.onclick = () => showCardDetail(k.dataset.hl));
}

/* Ansicht „Einstellungen" — eigener Punkt im Benutzermenü hinter Avatar+Name.
   Baut beim Öffnen frisch; die Werte kommen aus dem Profil. */
function renderSettings() {
  const el = $("#v-settings");
  if (!el) return;
  const pageOpt = ([w, label]) =>
    `<option value="${w}"${w === seitenGroesse() ? " selected" : ""}>${esc(label)}</option>`;
  const synOpt = ([v, label]) =>
    `<option value="${v}"${v === synModus() ? " selected" : ""}>${esc(label)}</option>`;
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("settings.title"))}</h3>
      <label>${esc(t("settings.language"))}</label>
      <div class="row">
        <div style="flex:none">
          <div class="lang-select" id="lang-select">
            <button type="button" class="lang-trigger" id="lang-trigger" aria-haspopup="listbox">
              ${flaggeHtml(LANG, true)}<span class="lang-name">${esc(UI_LANGS[LANG])}</span>
              <span class="lang-caret" aria-hidden="true">&#9662;</span>
            </button>
            <ul class="lang-menu" role="listbox">${
              Object.entries(UI_LANGS).map(([code, name]) =>
                `<li role="option" class="lang-item${code === LANG ? " on" : ""}" data-lang="${code}"
                     aria-selected="${code === LANG}">${flaggeHtml(code, true)}<span>${esc(name)}</span></li>`).join("")
            }</ul>
          </div>
        </div>
      </div>
      <p class="hint">${esc(t("settings.langHint"))}</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">${esc(t("settings.pageSize"))}</h3>
      <div class="row">
        <div style="flex:none;min-width:220px"><select id="set-pagesize">${
          [[25, "25"], [50, t("settings.pageDefault")], [100, "100"], [250, "250"], [0, t("settings.pageAll")]]
            .map(pageOpt).join("")
        }</select></div>
      </div>
      <p class="hint">${esc(t("settings.pageHint"))}</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">${esc(t("settings.synTitle"))}</h3>
      <label>${esc(t("settings.synMode"))}</label>
      <div class="row">
        <div style="flex:none;min-width:220px"><select id="set-synmode">${
          [["beide", t("settings.synBoth")], ["standard", t("settings.synStandard")], ["ki", t("settings.synKi")]]
            .map(synOpt).join("")
        }</select></div>
      </div>
      <p class="hint">${esc(t("settings.synHint"))}</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">${esc(t("set.searchTitle"))}</h3>
      ${[["onlyOwned", "set.onlyOwned"], ["onlyComplete", "set.onlyComplete"], ["comboAuto", "set.comboAuto"],
         ["autoDeckLegal", "set.autoDeckLegal"], ["hideBanned", "set.hideBanned"]]
        .map(([k, key]) => `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt);margin-bottom:8px">
        <input type="checkbox" data-pref="${k}"${suchPrefs()[k] ? " checked" : ""} style="width:auto">
        <span>${esc(t(key))}</span>
      </label>`).join("")}
      <div class="row" style="margin-top:10px">
        <div style="flex:none"><label>${esc(t("set.capDefault"))}</label>
          <input type="number" data-prefnum="capDefault" min="0" step="0.5" style="width:150px"
            value="${prefWert("capDefault") ?? ""}" placeholder="–"></div>
        <div style="flex:none"><label>${esc(t("set.budgetDefault"))}</label>
          <input type="number" data-prefnum="budgetDefault" min="0" step="1" style="width:150px"
            value="${prefWert("budgetDefault") ?? ""}" placeholder="–"></div>
        <div style="flex:none"><label>${esc(t("set.synLimit"))}</label>
          <input type="number" data-prefnum="synLimit" min="1" max="60" step="1" style="width:150px"
            value="${prefWert("synLimit") ?? ""}" placeholder="18"></div>
      </div>
      <p class="hint">${esc(t("set.searchHint"))}</p>
    </div>${IS_ADMIN ? `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("admin.title"))}</h3>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt)">
        <input type="checkbox" id="flag-ki"${FLAGS.ki_synergy ? " checked" : ""} style="width:auto">
        <span>${esc(t("admin.kiFlag"))}</span>
      </label>
      <p class="hint">${esc(t("admin.hint"))}</p>
    </div>` : ""}
    <p class="hint app-version">${esc(t("settings.version", { v: APP_VERSION || "—" }))}</p>`;
  // Eigenes Sprach-Dropdown mit Flaggen (ein natives <option> kann kein SVG
  // tragen, und Windows zeigt Flaggen-Emoji nur als Buchstaben). Öffnen/Schließen
  // wie das Benutzermenü über die Klasse „open"; Außenklick schließt (wireApp).
  const ls = $("#lang-select");
  $("#lang-trigger").onclick = ev => { ev.stopPropagation(); ls.classList.toggle("open"); };
  ls.querySelectorAll("[data-lang]").forEach(li => li.onclick = () => {
    const code = li.dataset.lang;
    ls.classList.remove("open");
    if (code !== LANG) setLang(code);   // setLang → onLangChange → renderSettings baut neu
  });
  $("#set-pagesize").onchange = ev => pageSizeSpeichern(parseInt(ev.target.value));
  $("#set-synmode").onchange = ev => synModusSetzen(ev.target.value);
  // Such- & Vorschlags-Einstellungen: sofort speichern (Profil, alle Geräte).
  $$("#v-settings [data-pref]").forEach(cb => cb.onchange = async () => {
    cb.disabled = true;
    try { await suchPrefSpeichern({ [cb.dataset.pref]: cb.checked || null }); toast(t("set.saved")); }
    catch (e) { cb.checked = !cb.checked; toast(dbErr(e)); }
    finally { cb.disabled = false; }
  });
  $$("#v-settings [data-prefnum]").forEach(inp => inp.onchange = async () => {
    const v = inp.value === "" ? null : Math.max(0, parseFloat(inp.value));
    try { await suchPrefSpeichern({ [inp.dataset.prefnum]: Number.isFinite(v) && v > 0 ? v : null }); toast(t("set.saved")); }
    catch (e) { toast(dbErr(e)); }
  });
  const fk = $("#flag-ki");
  if (fk) fk.onchange = async ev => {
    const an = ev.target.checked;
    fk.disabled = true;
    try { await flagSetzen("ki_synergy", an); toast(t(an ? "admin.kiOn" : "admin.kiOff")); }
    catch (e) { fk.checked = !an; toast(dbErr(e)); }
    finally { fk.disabled = false; }
  };
}

/* ===================== Regel-Assistent =====================
   Klärt eine strittige Spielsituation gegen das OFFIZIELLE erweiterte Regelwerk.
   Die Edge Function „rules-question" schlägt zunächst per Modell die passenden
   Regeln vor, lädt deren Text WÖRTLICH aus der offiziellen Fassung und urteilt
   nur auf dieser Grundlage — die gezeigten Zitate stammen 1:1 aus dem Regelwerk,
   nicht aus dem Gedächtnis des Modells. Kein Datenbankbedarf, nur die Function. */
let RULES_LOG = [];          // geklärte Fragen (aus der DB geladen)
let rulesLauf = 0;           // wie synergyLauf: alte, überholte Läufe verwerfen
let RULES_DRAFT = "";        // Eingabe über einen Tab-Wechsel hinweg bewahren
let rulesGeladen = false;    // Verlauf aus der DB schon einmal geholt?
let rulesOpenKey = "";       // welcher Listeneintrag zuletzt aufgeklappt sein soll
let rulesTmp = 0;            // laufende Nummer für Einträge ohne DB-id (Speichern schlug fehl)

function renderRules() {
  const el = $("#v-rules");
  if (!el) return;
  const beispiele = [
    t("rules.ex1"), t("rules.ex2"), t("rules.ex3"), t("rules.ex4"),
  ].filter(Boolean);
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("rules.title"))}</h3>
      <p class="hint" style="margin-top:-4px">${esc(t("rules.intro"))}</p>
      <textarea id="rules-q" class="rules-input" rows="4"
        placeholder="${esc(t("rules.ph"))}">${esc(RULES_DRAFT)}</textarea>
      <div class="rules-ex">${beispiele.map(b =>
        `<button type="button" class="chip" data-ex="${esc(b)}">${esc(b)}</button>`).join("")}</div>
      <div class="row" style="margin-top:10px;align-items:center">
        <div style="flex:none"><button class="btn" id="rules-ask">${esc(t("rules.ask"))}</button></div>
        <div class="hint" style="flex:1">${esc(t("rules.disclaimer"))}</div>
      </div>
    </div>
    <div id="rules-out"></div>
    <div id="rules-log"></div>`;

  const ta = $("#rules-q");
  ta.oninput = () => { RULES_DRAFT = ta.value; };
  el.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => {
    ta.value = b.dataset.ex; RULES_DRAFT = ta.value; ta.focus();
  });
  $("#rules-ask").onclick = () => regelFrageStellen();
  // Strg/Cmd+Enter im Feld schickt ab — bequem am Spieltisch.
  ta.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); regelFrageStellen(); } };

  // Verlauf: beim ersten Öffnen einmal aus der DB holen, danach aus RULES_LOG
  // zeichnen (ein Sprachwechsel baut die Ansicht neu, soll aber nicht neu laden).
  if (rulesGeladen) zeichneRegelVerlauf();
  else { $("#rules-log").innerHTML = `<div class="card"><div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("rules.histLoading"))}</div></div>`; ladeRegelVerlauf(); }
}

/* Verlauf aus der DB laden (nur die eigenen Zeilen dank RLS), neueste zuerst. */
async function ladeRegelVerlauf() {
  try {
    const { data, error } = await sb.from("rules_rulings")
      .select("id,question,lang,payload,created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const geladen = (data || []).map(r => ({ id: r.id, q: r.question, created_at: r.created_at, ...(r.payload || {}) }));
    // Falls währenddessen schon eine Frage gestellt wurde (und noch nicht in der
    // Abfrage steckte), diese oben behalten statt zu verlieren — dedupliziert per id.
    const bekannt = new Set(geladen.map(e => e.id));
    const zusatz = RULES_LOG.filter(e => !e.id || !bekannt.has(e.id));
    RULES_LOG = [...zusatz, ...geladen];
    rulesGeladen = true;
  } catch { /* bei Fehler bleibt der bisherige (evtl. leere) Verlauf stehen */ }
  if ($(".view.on")?.id === "v-rules") zeichneRegelVerlauf();
}

/* Den Verlauf als kompakte, scrollbare Liste zeichnen: je Eintrag Datum/Uhrzeit
   + Schlagwort, chronologisch (älteste zuerst). Ein Klick klappt den vollen
   Eintrag auf (<details>). Der zuletzt geklärte Eintrag wird aufgeklappt und in
   den Blick gescrollt. */
function zeichneRegelVerlauf() {
  const log = $("#rules-log");
  if (!log) return;
  if (!RULES_LOG.length) { log.innerHTML = `<div class="card"><div class="empty">${esc(t("rules.histEmpty"))}</div></div>`; return; }
  const sortiert = RULES_LOG.slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  log.innerHTML = `<div class="regel-liste">${sortiert.map(regelItemHtml).join("")}</div>`;
  log.querySelectorAll("[data-del-ruling]").forEach(b => b.onclick = ev => {
    ev.preventDefault(); ev.stopPropagation(); regelVerlaufLoeschen(b.dataset.delRuling);
  });
  // Frisch geklärten Eintrag sichtbar machen.
  const offen = log.querySelector(".regel-item[open]");
  if (offen) offen.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* Schlagwort für die Listenzeile: die Frage in einer Zeile. Voll durchreichen
   (bis zu einer Sicherheitsgrenze fürs DOM) — die SICHTBARE Kürzung macht CSS
   per text-overflow, damit das Feld genau die verfügbare Breite bis zur
   Konfidenz-Pille füllt, statt schon früh mit „…" abzubrechen. */
function regelSchlagwort(e) {
  const s = String(e.q || "").replace(/\s+/g, " ").trim();
  return s.slice(0, 200) || t("rules.title");
}

/* Datum + Uhrzeit eines Eintrags in der Oberflächensprache. */
function regelZeit(e) {
  if (!e.created_at) return "";
  const d = new Date(e.created_at);
  if (isNaN(d)) return "";
  return d.toLocaleString(LANG, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* Eine Listenzeile: zugeklappt nur Zeit + Schlagwort + Konfidenz; aufgeklappt
   der volle Eintrag. rulesOpenKey markiert den zuletzt geklärten. */
function regelItemHtml(e) {
  const key = e.id || e.tmpKey || "";
  const confClass = { high: "conf-high", medium: "conf-medium", low: "conf-low" }[e.confidence] || "conf-medium";
  const conf = { high: "rules.confHigh", medium: "rules.confMedium", low: "rules.confLow" }[e.confidence] || "rules.confMedium";
  return `
    <details class="regel-item"${key && key === rulesOpenKey ? " open" : ""}>
      <summary class="regel-item-head">
        <span class="regel-item-time">${esc(regelZeit(e))}</span>
        <span class="regel-item-label">${esc(regelSchlagwort(e))}</span>
        <span class="regel-conf mini ${confClass}">${esc(t(conf))}</span>
      </summary>
      <div class="regel-item-body">${regelAntwortInner(e)}</div>
    </details>`;
}

/* Voller Inhalt eines Eintrags (ohne die Listen-Kopfzeile). Zitate kommen
   WÖRTLICH aus dem Regelwerk (die Function schlägt sie in ihrer geparsten
   Fassung nach), deshalb dürfen sie unverändert stehen — nur maskiert. */
function regelAntwortInner(e) {
  const cites = (e.citations || []).filter(c => c && c.text);
  const citeHtml = cites.length ? `
    <details class="regel-cites">
      <summary>${esc(t("rules.rulesN", { n: cites.length }))}</summary>
      <div class="regel-cite-list">${cites.map(c =>
        `<div class="regel-cite"><span class="regel-cite-num">${esc(c.rule)}</span><span class="regel-cite-txt">${esc(c.text.replace(/^\s*\S+\s/, ""))}</span></div>`).join("")}</div>
    </details>` : "";
  const dateLine = e.rulesDate ? `<div class="regel-date">${esc(t("rules.basis", { date: e.rulesDate }))}</div>` : "";
  return `
      <div class="regel-frage">&bdquo;${esc(e.q)}&ldquo;</div>
      ${e.degraded ? `<div class="regel-warn">${esc(t("rules.degraded"))}</div>` : ""}
      <div class="regel-ruling">${esc(e.ruling)}</div>
      ${e.reasoning ? `<div class="regel-reason">${esc(e.reasoning)}</div>` : ""}
      ${e.caveat ? `<div class="regel-caveat">&#9888; ${esc(e.caveat)}</div>` : ""}
      ${citeHtml}
      ${dateLine}
      ${kiKostenHtml(e.usage)}
      ${e.id ? `<div class="regel-actions"><button class="btn ghost sm" data-del-ruling="${esc(e.id)}">&#128465; ${esc(t("rules.delTitle"))}</button></div>` : ""}`;
}

/* Eine gespeicherte Regelfrage löschen (DB + Verlauf). */
async function regelVerlaufLoeschen(id) {
  if (!id) return;
  if (!await confirmDlg(esc(t("rules.delConfirm")))) return;
  try {
    const { error } = await sb.from("rules_rulings").delete().eq("id", id);
    if (error) throw error;
    RULES_LOG = RULES_LOG.filter(e => e.id !== id);
    zeichneRegelVerlauf();
    toast(t("rules.deleted"));
  } catch (e) { toast(dbErr(e)); }
}

function regelFrageStellen() {
  const ta = $("#rules-q"); if (!ta) return;
  const situation = ta.value.trim();
  if (situation.length < 5) { toast(t("rules.tooShort")); ta.focus(); return; }
  regelAbfragen(situation, 0);
}

/* Kernabfrage: schickt die Schilderung an die Function und zeigt ENTWEDER eine
   Rückfrage (wenn das Modell die Situation noch nicht eindeutig versteht) ODER
   das fertige Urteil. `situation` ist der aktuell gesendete Text inkl. bisheriger
   Ergänzungen — eine weitere Rückfrage baut darauf auf. `round` zählt die schon
   beantworteten Rückfrage-Runden mit; die Function deckelt daran die Anzahl der
   Rückfragen, damit keine langen Frage-Ketten entstehen. */
async function regelAbfragen(situation, round = 0) {
  const out = $("#rules-out");
  const lauf = ++rulesLauf;
  const btn = $("#rules-ask"); if (btn) btn.disabled = true;
  if (out) out.innerHTML = `<div class="card"><div class="meta"><span class="syn-spin">&#9881;</span> ${esc(t("rules.loading"))}</div></div>`;

  let data, error;
  try {
    ({ data, error } = await sb.functions.invoke("rules-question", { body: { situation, lang: LANG, round } }));
  } catch (e) { error = e; }
  if (lauf !== rulesLauf) return;                 // ein neuerer Lauf hat übernommen
  if (btn) btn.disabled = false;

  if (error) {
    // Wie bei den Synergien steckt die Klartext-Meldung der Function in error.context.
    let msg = t("rules.error");
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* generisch */ }
    if (out) out.innerHTML = `<div class="card"><div class="empty">${esc(msg)}</div></div>`;
    return;
  }
  if (data?.error) { if (out) out.innerHTML = `<div class="card"><div class="empty">${esc(data.error)}</div></div>`; return; }

  // Rückfrage: das Modell braucht erst noch Angaben. Fragen anzeigen, Antwortfeld
  // öffnen — nichts kommt in den Verlauf, das passiert erst mit dem Urteil.
  if (data?.clarify && Array.isArray(data.questions) && data.questions.length) {
    if (out) out.innerHTML = regelClarifyHtml(data.questions);
    wireClarify(situation, data.questions, round);
    return;
  }

  if (!data?.ruling) { if (out) out.innerHTML = `<div class="card"><div class="empty">${esc(t("rules.error"))}</div></div>`; return; }

  // Fertiges Urteil in der DB speichern, damit es nach dem Neuladen abrufbar
  // bleibt (RLS: nur die eigene Zeile). Scheitert das Speichern, bleibt die
  // Antwort wenigstens in dieser Sitzung sichtbar — dann ohne Löschknopf, weil
  // keine id vorliegt.
  const eintrag = { q: situation, ...data, tmpKey: "tmp-" + (++rulesTmp) };
  try {
    const { data: row, error: sErr } = await sb.from("rules_rulings")
      .insert({ question: situation, lang: LANG, payload: data })
      .select("id,created_at").single();
    if (sErr) throw sErr;
    eintrag.id = row.id;
    eintrag.created_at = row.created_at;
  } catch { toast(t("rules.saveError")); }
  if (!eintrag.created_at) eintrag.created_at = new Date().toISOString();  // Fallback, falls Speichern scheiterte
  RULES_LOG.unshift(eintrag);
  rulesOpenKey = eintrag.id || eintrag.tmpKey;   // den frisch geklärten Eintrag aufgeklappt zeigen
  if (out) out.innerHTML = "";
  zeichneRegelVerlauf();
  // Eingabe geleert: die geklärte Frage steht jetzt im Verlauf.
  const ta = $("#rules-q"); if (ta) ta.value = ""; RULES_DRAFT = "";
}

/* Rückfrage-Karte: die Fragen des Modells + ein Feld für die Antwort. */
function regelClarifyHtml(questions) {
  return `
    <div class="card regel-clarify">
      <div class="regel-clarify-head">&#128172; ${esc(t("rules.clarifyTitle"))}</div>
      <p class="hint" style="margin-top:2px">${esc(t("rules.clarifyIntro"))}</p>
      <ul class="regel-clarify-qs">${questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul>
      <textarea id="rules-answer" class="rules-input" rows="3" placeholder="${esc(t("rules.answersPh"))}"></textarea>
      <div class="row" style="margin-top:10px">
        <div style="flex:none"><button class="btn" id="rules-answer-go">${esc(t("rules.answerBtn"))}</button></div>
      </div>
    </div>`;
}

/* Antwort auf die Rückfragen: an die ursprüngliche Schilderung anhängen (samt der
   gestellten Fragen, damit das Modell den Bezug hat) und erneut abfragen — mit
   erhöhtem Rundenzähler, damit die Function die Rückfragen deckeln kann. Reicht
   die Ergänzung noch nicht, darf das Modell (bis zur Obergrenze) noch einmal
   nachfragen. */
function wireClarify(baseSituation, questions, round = 0) {
  const ans = $("#rules-answer"), go = $("#rules-answer-go");
  if (!ans || !go) return;
  ans.focus();
  const submit = () => {
    const a = ans.value.trim();
    if (a.length < 2) { toast(t("rules.tooShort")); ans.focus(); return; }
    const combined = `${baseSituation}\n\n${t("rules.clarifyLabel")}\n${questions.map(q => "- " + q).join("\n")}\n\n${t("rules.answersLabel")}\n${a}`;
    regelAbfragen(combined, round + 1);
  };
  go.onclick = submit;
  ans.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } };
}

/* Such- & Vorschlags-Einstellungen (profiles.search_prefs, jsonb): Schalter und
   Vorbelegungen für die Synergie- und Combo-Suchen. Ein jsonb-Beutel statt
   einzelner Spalten — neue Schalter brauchen keine Schemaänderung. Liegt im
   Profil, gilt also auf allen Geräten (RLS: nur das eigene Profil). */
function suchPrefs() { return PROFILE?.search_prefs || {}; }

/* Zahl-Einstellung lesen: gesetzt und > 0, sonst null. */
function prefWert(k) { const v = +suchPrefs()[k]; return Number.isFinite(v) && v > 0 ? v : null; }

async function suchPrefSpeichern(patch) {
  const neu = { ...suchPrefs(), ...patch };
  // Nicht gesetzt = Schlüssel weg (false/null/"" speichern wir nicht) — der
  // Beutel bleibt klein, und „aus" ist eindeutig die Abwesenheit.
  for (const k of Object.keys(neu)) if (neu[k] == null || neu[k] === false || neu[k] === "") delete neu[k];
  const { error } = await sb.from("profiles").update({ search_prefs: neu }).eq("id", USER.id);
  if (error) throw error;
  PROFILE.search_prefs = neu;
}

/* Karten je Sammlungsseite speichern (Profil-Einstellung, gilt damit auf allen
   Geräten). 0 = keine Seitenaufteilung. */
async function pageSizeSpeichern(n) {
  try {
    const { error } = await sb.from("profiles").update({ page_size: n }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.page_size = n;
    collPage = 0;
    renderCollection();
    toast(n ? t("toast.pageSetN", { n }) : t("toast.pageSetAll"));
  } catch (e) { toast(dbErr(e)); }
}

async function nameSpeichern() {
  const name = $("#pf-name").value.trim();
  try {
    const { error } = await sb.from("profiles").update({ display_name: name || null }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.display_name = name || null;
    renderWho();
    toast(t("toast.nameSaved"));
  } catch (e) { toast(dbErr(e)); }
}

/* Avatar clientseitig auf 256px quadratisch verkleinern und als Data-URI DIREKT
   in profiles.avatar_url ablegen — bewusst NICHT über Supabase Storage. Dessen
   Upload kam mit dem publishable-Key (sb_…) unauthentifiziert an (auth.uid()
   null → RLS „new row violates…"), während der Tabellen-Weg über dieselbe
   funktionierende Anmeldung läuft wie der ganze Rest der App. Ein 256er-JPEG
   ist mit ~20–30 KB klein genug für die Spalte. */
async function avatarHochladen(file) {
  if (!file.type.startsWith("image/")) return toast(t("toast.pickImage"));
  if (file.size > 12 * 1024 * 1024) return toast(t("toast.imgTooBig"));
  try {
    const dataUrl = await bildDataUrl(file, 256);
    const { error } = await sb.from("profiles").update({ avatar_url: dataUrl }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.avatar_url = dataUrl;
    renderWho(); renderProfile();
    toast(t("toast.avatarUpdated"));
  } catch (e) { toast(dbErr(e)); }
}

async function avatarEntfernen() {
  try {
    const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.avatar_url = null;
    renderWho(); renderProfile();
    toast(t("toast.avatarRemoved"));
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
    img.onerror = () => rej(new Error(t("scan.imgUnreadable")));
    img.src = URL.createObjectURL(file);
  });
}

async function passwortAendern() {
  const msg = (t, cls) => { const m = $("#pf-pw-msg"); m.textContent = t; m.className = "msg " + (cls || ""); };
  const a = $("#pf-pw1").value, b = $("#pf-pw2").value;
  if (a.length < 8) return msg(t("auth.pwMin8"), "err");
  if (a !== b) return msg(t("pw.mismatch"), "err");
  $("#pf-pw-save").disabled = true; msg(t("auth.moment"));
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) throw error;
    $("#pf-pw1").value = ""; $("#pf-pw2").value = "";
    msg(t("pw.changed"), "ok");
  } catch (e) { msg(e.message || t("pw.failed"), "err"); }
  finally { $("#pf-pw-save").disabled = false; }
}

/* ============================== Freunde ==============================
   Befreunden über Freundescodes (send_friend_request-RPC, beidseitige
   Zustimmung). Freunde sehen GETEILTE Decks nur lesend; die RLS erlaubt das,
   geladen wird fremdes Material aber ausschließlich hier gezielt. */
let FRIENDS = { accepted: [], incoming: [], outgoing: [] };
let USER_COUNT = null;   // Gesamtzahl registrierter Nutzer (Anzeige unter „Freunde")

async function ladeFreunde() {
  const { data: fr, error } = await sb.from("friendships").select("*");
  if (error) { FRIENDS = { accepted: [], incoming: [], outgoing: [] }; return; }
  const anderId = f => (f.requester === USER.id ? f.addressee : f.requester);
  const ids = [...new Set((fr || []).map(anderId))];
  const profById = {};
  if (ids.length) {
    const { data: profs } = await sb.from("profiles")
      .select("id, display_name, avatar_url, friend_code").in("id", ids);
    (profs || []).forEach(p => profById[p.id] = p);
  }
  const mit = f => ({ ...f, other: profById[anderId(f)] || { id: anderId(f), display_name: null } });
  FRIENDS = {
    accepted: (fr || []).filter(f => f.status === "accepted").map(mit),
    incoming: (fr || []).filter(f => f.status === "pending" && f.addressee === USER.id).map(mit),
    outgoing: (fr || []).filter(f => f.status === "pending" && f.requester === USER.id).map(mit),
  };
}

/* Gesamtzahl registrierter Nutzer laden (SECURITY-DEFINER-RPC, da RLS nur
   eigene + befreundete Profile sichtbar macht) und anschließend im Header
   und auf dem Login-Screen anzeigen. Anzeige ist optional — schlägt der
   Aufruf fehl, bleibt sie einfach leer. */
async function ladeBenutzerzahl() {
  try { const { data, error } = await sb.rpc("registered_user_count"); if (!error && data != null) USER_COUNT = Number(data); }
  catch { /* still ignorieren — Zahl ist nur informativ */ }
  zeigeBenutzerzahl();
}
function zeigeBenutzerzahl() {
  const n = USER_COUNT != null ? String(USER_COUNT) : null, lbl = t("stats.registeredUsers");
  const h = $("#user-count");
  if (h) { h.hidden = n == null; if (n != null) { h.innerHTML = `&#128101;&nbsp;<b>${esc(n)}</b>`; h.title = lbl; } }
  const g = $("#gate-user-count");
  if (g) { g.hidden = n == null; if (n != null) g.innerHTML = `&#128101; <b>${esc(n)}</b> ${esc(lbl)}`; }
}

async function oeffneFreunde() { await ladeFreunde(); renderFriends(); }

function renderFriends() {
  const el = $("#v-friends");
  if (!el) return;
  const code = PROFILE?.friend_code || "…";
  const zeile = (f, actions) => `
    <div class="freund-zeile">
      ${avatarHtml(34, f.other)}
      <div style="flex:1;min-width:0"><b>${esc(f.other?.display_name || t("friends.unknown"))}</b></div>
      ${actions}
    </div>`;
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("friends.yourCode"))}</h3>
      <div class="row" style="align-items:center">
        <div style="flex:none"><span class="freund-code" id="my-code">${esc(code)}</span></div>
        <div style="flex:none"><button class="btn ghost sm" id="code-copy">${esc(t("common.copy"))}</button></div>
      </div>
      <p class="hint" style="margin-bottom:10px">${esc(t("friends.codeHint"))}</p>
      <label>${esc(t("friends.add"))}</label>
      <div class="row">
        <div style="flex:1"><input type="text" id="add-code" maxlength="6" placeholder="${esc(t("friends.addPh"))}" style="text-transform:uppercase"></div>
        <div style="flex:none"><button class="btn" id="add-go">${esc(t("friends.sendReq"))}</button></div>
      </div>
    </div>

    ${FRIENDS.incoming.length ? `<div class="card">
      <h3 style="margin-top:0">${esc(t("friends.incoming"))}</h3>
      ${FRIENDS.incoming.map(f => zeile(f, `
        <div style="flex:none"><button class="btn sm" data-accept="${esc(f.requester)}">${esc(t("friends.accept"))}</button></div>
        <div style="flex:none"><button class="btn ghost sm" data-decline="${esc(f.requester)}">${esc(t("friends.decline"))}</button></div>`)).join("")}
    </div>` : ""}

    ${FRIENDS.outgoing.length ? `<div class="card">
      <h3 style="margin-top:0">${esc(t("friends.outgoing"))}</h3>
      ${FRIENDS.outgoing.map(f => zeile(f, `
        <div style="flex:none"><span class="pill">${esc(t("friends.waiting"))}</span></div>
        <div style="flex:none"><button class="btn ghost sm" data-cancel="${esc(f.other.id)}">${esc(t("friends.withdraw"))}</button></div>`)).join("")}
    </div>` : ""}

    <div class="card">
      <h3 style="margin-top:0">${esc(t("friends.title"))}${FRIENDS.accepted.length ? ` (${FRIENDS.accepted.length})` : ""}</h3>
      ${FRIENDS.accepted.length ? FRIENDS.accepted.map(f => zeile(f, `
        <div style="flex:none"><button class="btn ghost sm" data-viewdecks="${esc(f.other.id)}">${esc(t("friends.sharedDecks"))}</button></div>
        <div style="flex:none"><button class="btn ghost sm" data-unfriend="${esc(f.other.id)}">${esc(t("friends.remove"))}</button></div>`)).join("")
        : `<div class="empty">${esc(t("friends.none"))}</div>`}
    </div>

    <div id="friend-decks"></div>`;

  $("#code-copy").onclick = () => { navigator.clipboard?.writeText(code); toast("Code kopiert"); };
  $("#add-go").onclick = freundAnfragen;
  $("#add-code").addEventListener("keydown", e => { if (e.key === "Enter") freundAnfragen(); });
  $$("[data-accept]").forEach(b => b.onclick = () => freundAntwort(b.dataset.accept, true));
  $$("[data-decline]").forEach(b => b.onclick = () => freundAntwort(b.dataset.decline, false));
  $$("[data-cancel]").forEach(b => b.onclick = () => freundEntfernen(b.dataset.cancel));
  $$("[data-unfriend]").forEach(b => b.onclick = () => freundEntfernen(b.dataset.unfriend));
  $$("[data-viewdecks]").forEach(b => b.onclick = () => zeigeFreundDecks(b.dataset.viewdecks));
}

async function freundAnfragen() {
  const code = ($("#add-code").value || "").trim().toUpperCase();
  if (code.length < 6) return toast(t("toast.enterCode"));
  try {
    const { data, error } = await sb.rpc("send_friend_request", { p_code: code });
    if (error) throw error;
    toast({
      sent: t("fr.sent"), accepted: t("fr.accepted"), pending: t("fr.pending"),
      already: t("fr.already"), self: t("fr.self"),
      notfound: t("fr.notfound"), unauth: t("fr.unauth"),
    }[data] || t("fr.done"));
    $("#add-code").value = "";
    await ladeFreunde(); renderFriends();
  } catch (e) { toast(dbErr(e)); }
}

async function freundAntwort(requesterId, annehmen) {
  try {
    const q = sb.from("friendships");
    const { error } = annehmen
      ? await q.update({ status: "accepted" }).eq("requester", requesterId).eq("addressee", USER.id)
      : await q.delete().eq("requester", requesterId).eq("addressee", USER.id);
    if (error) throw error;
    toast(annehmen ? t("toast.accepted") : t("toast.declined"));
    await ladeFreunde(); renderFriends();
  } catch (e) { toast(dbErr(e)); }
}

/* Freundschaft in beliebiger Richtung lösen (Anfrage zurückziehen oder
   entfreunden) — die RLS erlaubt beiden Seiten das Löschen. */
async function freundEntfernen(otherId) {
  try {
    const { error } = await sb.from("friendships").delete().or(
      `and(requester.eq.${USER.id},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${USER.id})`);
    if (error) throw error;
    toast(t("toast.removed"));
    await ladeFreunde(); renderFriends();
  } catch (e) { toast(dbErr(e)); }
}

/* Geteilte Decks eines Freundes laden und READ-ONLY anzeigen. Decks, Einträge
   und Karten kommen über die erweiterten SELECT-Policies. */
async function zeigeFreundDecks(friendId) {
  const ziel = $("#friend-decks");
  if (!ziel) return;
  const name = FRIENDS.accepted.find(f => f.other.id === friendId)?.other?.display_name || t("friends.friendFallback");
  ziel.innerHTML = `<div class="card"><div class="meta">${esc(t("friends.loadingShared"))}</div></div>`;
  ziel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const { data: decks, error } = await sb.from("decks").select("*")
      .eq("user_id", friendId).eq("shared", true).order("created");
    if (error) throw error;
    if (!decks || !decks.length) {
      ziel.innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(t("deck.sharedFrom", { name }))}</h3>
        <div class="empty">${esc(t("deck.noShared"))}</div></div>`;
      return;
    }
    const deckIds = decks.map(d => d.id);
    const { data: entries } = await sb.from("deck_entries").select("*").in("deck_id", deckIds);
    const cardIds = [...new Set((entries || []).map(e => e.card_id))];
    const cardsById = {};
    if (cardIds.length) {
      const { data: cards } = await sb.from("cards").select("*").in("id", cardIds);
      (cards || []).forEach(c => cardsById[c.id] = { ...c, set: c.set_code, disp: c.printed_name || c.name });
    }
    ziel.innerHTML = `<h3 style="margin:14px 2px 4px">${esc(t("deck.sharedFrom", { name }))}</h3>` +
      decks.map(d => friendDeckHtml(d, (entries || []).filter(e => e.deck_id === d.id), cardsById)).join("");
    // Auf-/Zuklappen (der Import-Knopf im Kopf darf nicht mit-toggeln) + Import.
    ziel.querySelectorAll(".deck-kopf[data-ftoggle]").forEach(k => k.onclick = ev => {
      if (ev.target.closest("button")) return;
      const id = k.dataset.ftoggle;
      freundDeckOffen.has(id) ? freundDeckOffen.delete(id) : freundDeckOffen.add(id);
      const auf = freundDeckOffen.has(id);
      k.parentElement.querySelector(".deck-inhalt").style.display = auf ? "block" : "none";
      k.querySelector(".deck-pfeil").innerHTML = auf ? "&#9660;" : "&#9654;";
      k.title = auf ? t("common.collapse") : t("common.expand");
    });
    ziel.querySelectorAll("[data-fimport]").forEach(b => b.onclick = () => importFriendDeck(b.dataset.fimport));
  } catch (e) {
    ziel.innerHTML = `<div class="card"><div class="meta"><span class="pill err">${esc(e.message)}</span></div></div>`;
  }
}

/* Welche Freund-Decks aufgeklappt sind — nur im Speicher, wie deckDashOffen.
   Read-only-Blick, kein Dauerzustand. */
const freundDeckOffen = new Set();

/* Read-only Deck eines Freundes: auf-/zuklappbarer Kopf mit Kennzahlen (wie in
   der eigenen Deckliste) und eine einfache Kartenliste (Bild, Name, Set·#,
   Deckmenge, Preis). Keine Bearbeitung; ein Knopf übernimmt das Deck. */
function friendDeckHtml(d, entries, cardsById) {
  const rows = entries.map(e => ({ e, c: cardsById[e.card_id] })).filter(x => x.c)
    .sort((a, b) => a.c.disp.localeCompare(b.c.disp));
  const n = rows.reduce((s, x) => s + x.e.qty, 0);
  const v = rows.reduce((s, x) => s + (x.c.price || 0) * x.e.qty, 0);
  const haupt = d.main_card_id ? cardsById[d.main_card_id] : null;
  const offen = freundDeckOffen.has(d.id);
  const list = rows.map(({ e, c }) => `
    <tr>
      <td style="width:40px">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" style="width:34px;border-radius:3px;display:block">` : ""}</td>
      <td>${esc(c.disp)}</td>
      <td class="hide-s">${esc(c.set_name || c.set || "")} &middot; #${esc(c.cn)}</td>
      <td class="num">${e.qty}&times;</td>
      <td class="num">${eur(c.price)}</td>
    </tr>`).join("");
  return `<div class="card">
    <div class="deck-kopf" data-ftoggle="${esc(d.id)}" title="${offen ? t("common.collapse") : t("common.expand")}">
      <span class="deck-pfeil">${offen ? "&#9660;" : "&#9654;"}</span>
      ${haupt?.img ? `<img class="deck-haupt" src="${esc(haupt.img)}" alt="">` : ""}
      <div style="flex:1;min-width:0">
        <h3 style="margin:0">${esc(d.name)}</h3>
        ${d.format || d.archetype ? `<div class="deck-tags">${
          d.format ? `<span class="pill fmt">${esc(d.format)}</span>` : ""}${
          d.archetype ? `<span class="pill">${esc(d.archetype)}</span>` : ""}</div>` : ""}
        <div class="hint" style="margin:2px 0 0">${n} ${esc(t("common.cards"))} &middot; ${eur(v)}</div>
      </div>
      <button class="btn ghost sm" data-fimport="${esc(d.id)}" style="flex:none"
        title="${esc(t("deck.importTitle"))}">${esc(t("deck.importBtn"))}</button>
    </div>
    <div class="deck-inhalt" style="display:${offen ? "block" : "none"}">
      <div class="xscroll" style="overflow-x:auto"><table class="deck-tbl" style="margin-top:10px">
        <tbody>${list}</tbody></table></div>
    </div>
  </div>`;
}

/* Ein geteiltes Freund-Deck als neues, PRIVATES Deck in die eigenen übernehmen.
   Karten, die man nicht besitzt, kommen als Bestand-0-Zeilen ins Deck (dort
   „fehlen") — die eigene Sammlung ändert sich nicht. Macht die RPC atomar. */
async function importFriendDeck(deckId) {
  if (!await confirmDlg(t("dlg.importDeck"))) return;
  try {
    const { error } = await sb.rpc("import_shared_deck", { p_deck: deckId });
    if (error) throw error;
    await reload(); renderAll();
    toast(t("toast.deckImported"));
    const b = $('nav button[data-v="decks"]'); if (b) b.click();
  } catch (e) { toast(dbErr(e)); }
}

/* ============ Import einer Text-Deckliste (mtgsalvation & Co.) ==========
   mtgsalvation.com (und die meisten Deckbau-Seiten) exportieren Decks als Text:
   Deckname bzw. [deck=…]-BBCode oben, Abschnittsüberschriften (Commander,
   Creature, Land …) und Zeilen „N Kartenname". Wir parsen das, lösen die Namen
   bei Scryfall auf und legen ein neues Deck an; nicht besessene Karten entstehen
   wie beim „+ Deck"-Weg (add_wish_to_deck) als Bestand-0-Platzhalter. */
const IMP_SEKTIONEN = new Set(["commander", "commanders", "creature", "creatures", "land", "lands",
  "artifact", "artifacts", "enchantment", "enchantments", "instant", "instants", "sorcery", "sorceries",
  "planeswalker", "planeswalkers", "battle", "battles", "sideboard", "maybeboard", "companion",
  "token", "tokens", "spell", "spells", "other", "unsorted", "deck", "mainboard"]);

function parseDeckliste(text) {
  let deckName = "", sektion = "";
  const commanders = [], eintraege = new Map();
  const add = (name, qty) => {
    // Set-/Nummer-Suffixe abschneiden: „Sol Ring [C21]", „Sol Ring (C21) 263".
    name = name.replace(/\s*[[(]\s*[a-z0-9]{2,6}\s*[\])]\s*\d*\s*$/i, "").trim();
    if (!name) return;
    // Kommandeur = Zeile im Commander-Abschnitt (mtgsalvation schreibt ihn dort
    // OHNE Menge). Deckel gegen einen Export ohne weitere Abschnittsköpfe.
    if ((sektion === "commander" || sektion === "commanders") && commanders.length < 4) commanders.push(name);
    eintraege.set(name, (eintraege.get(name) || 0) + qty);
  };
  for (const roh of String(text || "").split(/\r?\n/)) {
    let z = roh.trim();
    if (!z) continue;
    const bb = z.match(/^\[deck=(.+?)\]$/i);
    if (bb) { if (!deckName) deckName = bb[1].trim(); continue; }
    if (/^\[/.test(z)) { z = z.replace(/\[[^\]]*\]/g, "").trim(); if (!z) continue; }   // sonstiges BBCode
    if (/^(\/\/|#)/.test(z)) continue;                                                  // Kommentar
    const m = z.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (m) { add(m[2], Math.max(1, Math.min(99, parseInt(m[1], 10)))); continue; }
    if (IMP_SEKTIONEN.has(z.toLowerCase())) { sektion = z.toLowerCase(); continue; }
    // Erste blanke Zeile VOR jedem Abschnitt = Deckname. Steht sie schon in einem
    // Abschnitt (z. B. der Kommandeur unter „Commander"), ist sie eine Karte.
    if (!deckName && !sektion) { deckName = z; continue; }
    add(z, 1);                                    // blanke Kartenzeile (z. B. Commander ohne Menge)
  }
  return { deckName, commanders, eintraege: [...eintraege].map(([name, qty]) => ({ name, qty })) };
}

/* Namen bei Scryfall auflösen: erst Sammel-Request (POST /cards/collection,
   75/Anfrage, EXAKTER Name), dann für nicht exakt Getroffene ein Fuzzy-Einzel-
   abruf. Map: angefragter Name (kleingeschrieben) → Scryfall-Karte. */
async function deckNamenAufloesen(namen) {
  const uniq = [...new Set(namen.map(n => n.trim()).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < uniq.length; i += 75) {
    try {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: uniq.slice(i, i + 75).map(name => ({ name })) }),
      });
      if (r.ok) for (const c of (await r.json()).data || [])
        for (const nm of [c.name, c.card_faces?.[0]?.name].filter(Boolean)) out.set(nm.toLowerCase(), c);
    } catch { /* Block scheitert → der Fuzzy-Fallback fängt diese Namen */ }
  }
  for (const n of uniq) {
    if (out.has(n.toLowerCase())) continue;
    try { const c = await sfNamed(n); if (c?.id) out.set(n.toLowerCase(), c); } catch { /* bleibt fehlend */ }
  }
  return out;
}

async function deckImportieren(text, btn) {
  const { deckName, commanders, eintraege } = parseDeckliste(text);
  if (!eintraege.length) return toast(t("imp.empty"));
  const busy = (an, txt) => { if (btn) { btn.disabled = an;
    btn.innerHTML = an ? `<span class="syn-spin">&#9881;</span> ${esc(txt || t("imp.busy"))}` : esc(t("imp.btn")); } };
  busy(true);
  try {
    const karten = await deckNamenAufloesen(eintraege.map(e => e.name));
    const { data: deck, error } = await sb.from("decks")
      .insert({ name: (deckName || t("imp.defaultName")).slice(0, 100), format: commanders.length ? "Commander" : null })
      .select("id").single();
    if (error) throw error;
    const istCmd = new Set(commanders.map(n => n.toLowerCase()));
    const fehlend = [], rows = [];
    let kommandeurId = null, fertig = 0;
    // In kleinen Blöcken parallel — 100 RPCs sequenziell wären zäh.
    for (let p = 0; p < eintraege.length; p += 8) {
      const res = await Promise.all(eintraege.slice(p, p + 8).map(async e => {
        const c = karten.get(e.name.toLowerCase());
        if (!c) { fehlend.push(e.name); return null; }
        try { return { e, cid: await wunschkarteZumDeck(deck.id, c) }; }
        catch { fehlend.push(e.name); return null; }
      }));
      for (const r of res) if (r) {
        rows.push({ deck_id: deck.id, card_id: r.cid, qty: r.e.qty });
        if (!kommandeurId && istCmd.has(r.e.name.toLowerCase())) kommandeurId = r.cid;
      }
      fertig = Math.min(fertig + 8, eintraege.length);
      busy(true, t("imp.progress", { i: fertig, n: eintraege.length }));
    }
    // Mengen in EINEM Rutsch setzen (add_wish_to_deck legt je 1 an).
    if (rows.length) { const { error: e2 } = await sb.from("deck_entries").upsert(rows, { onConflict: "deck_id,card_id" }); if (e2) throw e2; }
    if (kommandeurId) await sb.from("decks").update({ main_card_id: kommandeurId }).eq("id", deck.id);
    await reload(); renderAll();
    const b = $('nav button[data-v="decks"]'); if (b) b.click();
    toast(fehlend.length ? t("imp.doneSome", { n: rows.length, f: fehlend.length }) : t("imp.done", { n: rows.length }));
    if (fehlend.length) console.warn("Deck-Import — nicht gefunden:", fehlend);
  } catch (e) { toast(dbErr(e)); }
  finally { busy(false); }
}

/* Einfüge-Dialog: Deckliste reinkopieren, dann importieren. confirmDlg gibt nur
   ok/abbrechen zurück — den Text lesen wir danach aus dem (noch stehenden) Body. */
async function openDeckImport() {
  const ok = await confirmDlg(`
    <h3 style="margin:0 0 6px">${esc(t("imp.title"))}</h3>
    <p class="hint" style="margin:0 0 8px">${esc(t("imp.hint"))}</p>
    <textarea id="imp-text" class="imp-text" rows="12" placeholder="${esc(t("imp.ph"))}"></textarea>`);
  if (!ok) return;
  const text = $("#imp-text")?.value || "";
  if (text.trim()) deckImportieren(text, $("#deck-import"));
}

/* ======================= Spielrunde (live) ==========================
   Synchrone Session über Supabase Realtime: befreundete Nutzer einladen, jeder
   tritt auf seinem Gerät bei, Lebenspunkte + Würfelwürfe aktualisieren sich bei
   allen live. Tabellen game_sessions/session_players/session_events, RLS + RPCs
   in der DB; hier nur Laden, Zeichnen und die Realtime-Kanäle. */
let SESSION = null;            // aktive eigene Session {id, host, start_life, status}
let SESSION_PLAYERS = [];      // [{user_id, life, status, seat, profile}]
let SESSION_INVITES = [];      // offene Einladungen an mich [{...session, hostProfile}]
let SESSION_LOG = [];          // jüngste Events (Würfe) für die Anzeige
let sessionChannel = null, inviteChannel = null;
let SESSION_PLAYED = {};        // card_id → gespielt-Anzahl (privat, nur mein Deck)
const lifeTimers = {}, playedTimers = {};   // entprellt das Schreiben je Spieler/Karte
const meinSpieler = () => SESSION_PLAYERS.find(p => p.user_id === USER?.id);

function sessionBadge() {
  const b = $("#sess-badge");
  if (!b) return;
  b.textContent = SESSION_INVITES.length || "";
  b.hidden = !SESSION_INVITES.length;
}

/* Eigene aktive Session + offene Einladungen laden (zwei einfache Abfragen statt
   eingebetteter Filter). */
async function ladeSession() {
  SESSION = null; SESSION_PLAYERS = []; SESSION_INVITES = [];
  if (!USER) { sessionBadge(); return; }
  const sp = await sb.from("session_players").select("session_id,status")
    .eq("user_id", USER.id).in("status", ["joined", "invited"]);
  const rows = sp.data || [];
  if (rows.length) {
    const ids = [...new Set(rows.map(r => r.session_id))];
    const gs = await sb.from("game_sessions").select("*").in("id", ids).eq("status", "open");
    const byId = {}; (gs.data || []).forEach(g => byId[g.id] = g);
    const joined = rows.filter(r => r.status === "joined" && byId[r.session_id]).map(r => byId[r.session_id]);
    const invited = rows.filter(r => r.status === "invited" && byId[r.session_id]).map(r => byId[r.session_id]);
    const hostIds = [...new Set(invited.map(s => s.host))];
    const hostProf = {};
    if (hostIds.length) {
      const pr = await sb.from("profiles").select("id,display_name,avatar_url").in("id", hostIds);
      (pr.data || []).forEach(p => hostProf[p.id] = p);
    }
    SESSION_INVITES = invited.map(s => ({ ...s, hostProfile: hostProf[s.host] || { id: s.host, display_name: null } }));
    if (joined[0]) { SESSION = joined[0]; await ladeSpieler(); await ladeLog(); await ladePlayed(); }
  }
  sessionBadge();
}

/* Spielerliste über die SECURITY-DEFINER-RPC (Mitspieler müssen nicht
   untereinander befreundet sein, dürfen sich in der Runde aber sehen). */
async function ladeSpieler() {
  if (!SESSION) { SESSION_PLAYERS = []; return; }
  const { data } = await sb.rpc("session_roster", { p_session: SESSION.id });
  SESSION_PLAYERS = (data || []).map(r => ({
    user_id: r.user_id, life: r.life, status: r.status, seat: r.seat,
    deck_id: r.deck_id, deck_name: r.deck_name, commander: r.commander, commander_img: r.commander_img,
    profile: { id: r.user_id, display_name: r.display_name, avatar_url: r.avatar_url },
  }));
}

/* Eigener Karten-Tracker der Partie laden (privat: nur die eigenen Zeilen). */
async function ladePlayed() {
  SESSION_PLAYED = {};
  if (!SESSION || !USER) return;
  const { data } = await sb.from("session_played").select("card_id,qty")
    .eq("session_id", SESSION.id).eq("user_id", USER.id);
  (data || []).forEach(r => { if (r.qty > 0) SESSION_PLAYED[r.card_id] = r.qty; });
}

async function ladeLog() {
  if (!SESSION) { SESSION_LOG = []; return; }
  const { data } = await sb.from("session_events").select("*")
    .eq("session_id", SESSION.id).order("id", { ascending: false }).limit(30);
  SESSION_LOG = data || [];
}

async function oeffneSession() {
  DiceGL.load();   // three.js im Hintergrund holen, damit der erste 3D-Wurf bereit ist
  try { await ladeFreunde(); } catch { /* Freundeliste ist nur fürs Einladen */ }
  try { await ladeSession(); } catch (e) { toast(dbErr(e)); }
  if (SESSION) subscribeSession();
  renderSession();
}

/* =========================== Termine (Kalender) ===========================
   Geplante Spieleabende: Termin mit Titel/Datum/Beschreibung, Freunde einladen,
   Zu-/Absage, Monatskalender + Liste, und „Spielrunde starten" (erstellt die
   Live-Runde und übernimmt die Zusagenden als eingeladen). */
let EVENTS = [], eventsChannel = null, kalMonat = null, terminReloadT = null;
const terminOffen = new Set();                 // aufgeklappte Termine (id)
const eventForm = { offen: false, editId: null };
let terminInviteOffen = null;                  // Termin-id mit offener „weitere einladen"-Liste

async function ladeTermine() {
  EVENTS = [];
  if (!USER) return;
  const { data: evs } = await sb.from("game_events").select("*").order("starts_at");
  const ids = (evs || []).map(e => e.id);
  let rsvps = [];
  if (ids.length) { const r = await sb.from("event_rsvp").select("event_id,user_id,status").in("event_id", ids); rsvps = r.data || []; }
  EVENTS = (evs || []).map(e => {
    const rs = rsvps.filter(x => x.event_id === e.id);
    return { ...e, rsvps: rs, myStatus: rs.find(x => x.user_id === USER.id)?.status || null, isHost: e.host === USER.id };
  });
}

async function oeffneTermine() {
  try { await ladeFreunde(); } catch { /* nur für die Einladeliste */ }
  try { await ladeTermine(); } catch (e) { toast(dbErr(e)); }
  subscribeTermine();
  renderTermine();
}

function subscribeTermine() {
  if (eventsChannel || !USER) return;
  eventsChannel = sb.channel("events:" + USER.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "event_rsvp" }, onTerminChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_events" }, onTerminChange)
    .subscribe();
}
function onTerminChange() {
  clearTimeout(terminReloadT);
  terminReloadT = setTimeout(async () => { await ladeTermine(); if ($(".view.on")?.id === "v-events") renderTermine(); }, 350);
}

/* Profil (Name/Avatar) eines Beteiligten: ich selbst oder ein Freund. */
function terminProfil(userId) {
  if (userId === USER?.id) return { id: userId, display_name: PROFILE?.display_name || t("sess.you"), avatar_url: PROFILE?.avatar_url };
  const f = (FRIENDS?.accepted || []).find(x => x.other?.id === userId);
  return f?.other || { id: userId, display_name: t("friends.unknown"), avatar_url: null };
}

const zPad = n => String(n).padStart(2, "0");
function isoToLocalInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${zPad(d.getMonth() + 1)}-${zPad(d.getDate())}T${zPad(d.getHours())}:${zPad(d.getMinutes())}`;
}
function wannText(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(LANG, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
    + " · " + d.toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
}

function renderTermine() {
  const el = $("#v-events"); if (!el) return;
  el.innerHTML = terminFormHtml() + `<div class="termin-cols">${kalenderHtml()}${terminListeHtml()}</div>`;
  wireTermine();
}

/* -------- Anlege-/Bearbeiten-Formular -------- */
function terminFormHtml() {
  if (!eventForm.offen) return "";
  const ed = eventForm.editId ? EVENTS.find(e => e.id === eventForm.editId) : null;
  let defDt;
  if (ed) defDt = isoToLocalInput(ed.starts_at);
  else { const dd = new Date(); dd.setDate(dd.getDate() + 1); dd.setHours(20, 0, 0, 0); defDt = isoToLocalInput(dd.toISOString()); }
  const freunde = (FRIENDS?.accepted || []).map(f => f.other).filter(Boolean);
  return `<div class="card">
    <h3 style="margin-top:0">${esc(ed ? t("cal.editEvent") : t("cal.newEvent"))}</h3>
    <label>${esc(t("cal.fTitle"))}</label>
    <input type="text" id="ev-title" maxlength="120" value="${esc(ed?.title || "")}" placeholder="${esc(t("cal.fTitlePh"))}">
    <label style="margin-top:8px">${esc(t("cal.fWhen"))}</label>
    <input type="datetime-local" id="ev-when" value="${esc(defDt)}">
    <label style="margin-top:8px">${esc(t("cal.fDesc"))}</label>
    <textarea id="ev-desc" rows="2" maxlength="1000" placeholder="${esc(t("cal.fDescPh"))}">${esc(ed?.description || "")}</textarea>
    <label class="ev-serie-check" style="margin-top:10px"><input type="checkbox" id="ev-remind"${ed?.remind ? " checked" : ""}>${esc(t("cal.remind"))}</label>
    <div class="hint" style="margin:-2px 0 0">${esc(t("cal.remindHint"))}</div>
    ${!ed ? `<label style="margin-top:8px">${esc(t("cal.fInvite"))}</label>
      <div class="ev-invite-list">${freunde.length
        ? freunde.map(f => `<label class="ev-inv"><input type="checkbox" value="${esc(f.id)}">${avatarHtml(22, f)}<span>${esc(f.display_name || t("friends.unknown"))}</span></label>`).join("")
        : `<div class="hint">${esc(t("cal.noFriends"))}</div>`}</div>
      <label class="ev-serie-check"><input type="checkbox" id="ev-serie">${esc(t("cal.recurring"))}</label>
      <div id="ev-serie-opts" class="ev-serie-opts" hidden>
        <div class="row" style="gap:8px">
          <div><label>${esc(t("cal.recurFreq"))}</label>
            <select id="ev-serie-freq">
              <option value="weekly">${esc(t("cal.freqWeekly"))}</option>
              <option value="biweekly">${esc(t("cal.freqBiweekly"))}</option>
              <option value="monthly-date">${esc(t("cal.freqMonthly"))}</option>
              <option value="monthly-last">${esc(t("cal.freqMonthlyLast"))}</option>
              <option value="monthly-weekday">${esc(t("cal.freqMonthlyWeekday"))}</option>
              <option value="monthly-last-weekday">${esc(t("cal.freqMonthlyLastWeekday"))}</option>
            </select></div>
          <div><label>${esc(t("cal.recurCount"))}</label>
            <input type="number" id="ev-serie-count" min="2" max="52" value="4"></div>
        </div>
        <div id="ev-serie-preview" class="ev-serie-preview hint"></div>
      </div>` : ""}
    <div class="row" style="margin-top:12px;gap:8px">
      <div style="flex:none"><button class="btn" id="ev-save">${esc(ed ? t("common.save") : t("cal.create"))}</button></div>
      <div style="flex:none"><button class="btn ghost" id="ev-cancel">${esc(t("dlg.cancel"))}</button></div>
    </div>
  </div>`;
}

/* -------- Monatskalender -------- */
function kalAktuell() {
  if (kalMonat) return kalMonat;
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1);
}
function kalenderHtml() {
  const m = kalAktuell(), jahr = m.getFullYear(), monat = m.getMonth();
  const h = new Date();
  const istHeute = d => jahr === h.getFullYear() && monat === h.getMonth() && d === h.getDate();
  const ersterWT = (new Date(jahr, monat, 1).getDay() + 6) % 7;   // 0 = Montag
  const tage = new Date(jahr, monat + 1, 0).getDate();
  const proTag = {};
  EVENTS.forEach(e => { const d = new Date(e.starts_at); if (d.getFullYear() === jahr && d.getMonth() === monat) (proTag[d.getDate()] ||= []).push(e); });
  let zellen = "";
  for (let i = 0; i < ersterWT; i++) zellen += `<div class="kal-tag leer"></div>`;
  for (let d = 1; d <= tage; d++) {
    const evs = (proTag[d] || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const pills = evs.slice(0, 2).map(e => `<span class="kal-pill" data-ev="${esc(e.id)}" title="${esc(e.title)}">${esc(e.title)}</span>`).join("");
    const mehr = evs.length > 2 ? `<span class="kal-mehr" data-ev="${esc(evs[2].id)}">+${evs.length - 2}</span>` : "";
    zellen += `<div class="kal-tag${istHeute(d) ? " heute" : ""}"><span class="kal-nr">${d}</span>${pills}${mehr}</div>`;
  }
  const wt = t("cal.weekdays").split(",");
  return `<div class="card kal-card">
    <div class="kal-kopf">
      <button class="btn ghost sm" id="kal-prev" title="${esc(t("cal.prevMonth"))}">&#8249;</button>
      <h3 class="kal-titel">${esc(m.toLocaleDateString(LANG, { month: "long", year: "numeric" }))}</h3>
      <button class="btn ghost sm" id="kal-next" title="${esc(t("cal.nextMonth"))}">&#8250;</button>
      <button class="btn sm kal-neu" id="ev-neu">+ ${esc(t("cal.newEvent"))}</button>
    </div>
    <div class="kal-grid kal-head">${wt.map(w => `<div class="kal-wt">${esc(w)}</div>`).join("")}</div>
    <div class="kal-grid">${zellen}</div>
  </div>`;
}

/* -------- Terminliste (kommende) -------- */
function terminListeHtml() {
  const grenze = Date.now() - 3 * 3600 * 1000;   // 3h Kulanz für laufende Runden
  const kommend = EVENTS.filter(e => new Date(e.starts_at).getTime() >= grenze)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, 10);                               // höchstens die nächsten 10 Termine
  return `<div class="card termin-upcoming"><h3 style="margin-top:0">${esc(t("cal.upcoming"))}</h3>
    ${kommend.length ? kommend.map(terminRowHtml).join("") : `<div class="empty">${esc(t("cal.noneUpcoming"))}</div>`}</div>`;
}
function terminRowHtml(e) {
  const ja = e.rsvps.filter(r => r.status === "yes").length;
  const viel = e.rsvps.filter(r => r.status === "maybe").length;
  const nein = e.rsvps.filter(r => r.status === "no").length;
  return `<div class="termin" id="ev-${esc(e.id)}">
    <div class="termin-kopf" data-ev-toggle="${esc(e.id)}">
      <div class="termin-wann">${esc(wannText(e.starts_at))}</div>
      <div class="termin-titel">${esc(e.title)}${e.isHost ? ` <span class="termin-host" title="${esc(t("cal.youHost"))}">&#9733;</span>` : ""}</div>
      <div class="termin-zahlen">&#10003;&nbsp;${ja} · ?&nbsp;${viel} · &#10007;&nbsp;${nein}</div>
    </div>
    ${terminOffen.has(e.id) ? terminDetailHtml(e) : ""}
  </div>`;
}
function terminDetailHtml(e) {
  const atts = e.rsvps.map(r => { const p = terminProfil(r.user_id);
    return `<div class="ev-att">${avatarHtml(24, p)}<span class="ev-att-name">${esc(p.display_name || t("friends.unknown"))}</span><span class="ev-att-st st-${r.status}">${esc(t("cal.st." + r.status))}</span></div>`;
  }).join("");
  const rsvp = e.isHost ? "" : `<div class="row" style="gap:6px;margin-top:10px">${
    ["yes", "maybe", "no"].map(s => `<button class="btn ghost sm ev-rsvp${e.myStatus === s ? " on" : ""}" data-ev-rsvp="${esc(e.id)}" data-st="${s}">${esc(t("cal.set." + s))}</button>`).join("")}</div>`;
  // Host: weitere Freunde einladen (noch nicht im Termin)
  let inviteMore = "";
  if (e.isHost) {
    const drin = new Set(e.rsvps.map(r => r.user_id));
    const rest = (FRIENDS?.accepted || []).map(f => f.other).filter(o => o && !drin.has(o.id));
    inviteMore = `<div style="margin-top:10px"><button class="btn ghost sm" data-ev-invtoggle="${esc(e.id)}">${esc(t("cal.inviteMore"))}</button>
      ${terminInviteOffen === e.id ? `<div class="ev-invite-list" style="margin-top:8px">${
        rest.length ? rest.map(o => `<label class="ev-inv"><input type="checkbox" value="${esc(o.id)}">${avatarHtml(22, o)}<span>${esc(o.display_name || t("friends.unknown"))}</span></label>`).join("")
                    : `<div class="hint">${esc(t("cal.allInvited"))}</div>`}
        ${rest.length ? `<div style="margin-top:8px"><button class="btn sm" data-ev-invsave="${esc(e.id)}">${esc(t("cal.inviteSel"))}</button></div>` : ""}</div>` : ""}</div>`;
  }
  const hostAct = e.isHost ? `<div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
    <div style="flex:none"><button class="btn sm" data-ev-start="${esc(e.id)}">&#127922; ${esc(t("cal.startSession"))}</button></div>
    <div style="flex:none"><button class="btn ghost sm" data-ev-edit="${esc(e.id)}">${esc(t("detail.edit"))}</button></div>
    <div style="flex:none"><button class="btn danger sm" data-ev-del="${esc(e.id)}">${esc(t("cal.delete"))}</button></div>
  </div>` : "";
  return `<div class="termin-detail">
    ${e.description ? `<p class="termin-beschr">${esc(e.description)}</p>` : ""}
    <div class="ev-atts">${atts}</div>
    ${rsvp}${inviteMore}${hostAct}
  </div>`;
}

function wireTermine() {
  const neu = $("#ev-neu"); if (neu) neu.onclick = () => { eventForm.offen = true; eventForm.editId = null; renderTermine(); };
  const cancel = $("#ev-cancel"); if (cancel) cancel.onclick = () => { eventForm.offen = false; eventForm.editId = null; renderTermine(); };
  const save = $("#ev-save"); if (save) save.onclick = terminSpeichern;
  const serie = $("#ev-serie"); if (serie) serie.onchange = () => { const o = $("#ev-serie-opts"); if (o) o.hidden = !serie.checked; serieVorschauUpdate(); };
  ["ev-serie-freq", "ev-serie-count", "ev-when"].forEach(id => { const e = $("#" + id); if (e) e.addEventListener("input", serieVorschauUpdate); });
  const prev = $("#kal-prev"); if (prev) prev.onclick = () => { const m = kalAktuell(); kalMonat = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderTermine(); };
  const next = $("#kal-next"); if (next) next.onclick = () => { const m = kalAktuell(); kalMonat = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderTermine(); };

  $$("#v-events [data-ev]").forEach(el => el.onclick = () => {
    const id = el.dataset.ev; terminOffen.add(id); renderTermine();
    setTimeout(() => $(`#ev-${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  });
  $$("#v-events [data-ev-toggle]").forEach(el => el.onclick = () => {
    const id = el.dataset.evToggle; terminOffen.has(id) ? terminOffen.delete(id) : terminOffen.add(id); renderTermine();
  });
  $$("#v-events [data-ev-rsvp]").forEach(b => b.onclick = () => terminRsvp(b.dataset.evRsvp, b.dataset.st));
  $$("#v-events [data-ev-start]").forEach(b => b.onclick = () => terminSpielrunde(b.dataset.evStart));
  $$("#v-events [data-ev-del]").forEach(b => b.onclick = () => terminLoeschen(b.dataset.evDel));
  $$("#v-events [data-ev-edit]").forEach(b => b.onclick = () => { eventForm.offen = true; eventForm.editId = b.dataset.evEdit; renderTermine(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $$("#v-events [data-ev-invtoggle]").forEach(b => b.onclick = () => { const id = b.dataset.evInvtoggle; terminInviteOffen = terminInviteOffen === id ? null : id; renderTermine(); });
  $$("#v-events [data-ev-invsave]").forEach(b => b.onclick = () => terminEinladen(b.dataset.evInvsave));
}

/* N-ter (oder letzter) Wochentag in dem Monat, der `monthsAhead` nach dem
   Startmonat liegt — behält Uhrzeit des Starttermins. */
function nterWochentag(baseIso, monthsAhead, weekday, ord, last) {
  const base = new Date(baseIso);
  const anchor = new Date(base.getFullYear(), base.getMonth() + monthsAhead, 1);
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  let day;
  if (last || ord >= 5) {                        // letzter Wochentag des Monats
    const lastWd = new Date(y, m, dim).getDay();
    day = dim - ((lastWd - weekday + 7) % 7);
  } else {                                       // 1.–4. Wochentag (existiert immer)
    const firstWd = new Date(y, m, 1).getDay();
    day = 1 + ((weekday - firstWd + 7) % 7) + (ord - 1) * 7;
  }
  const d = new Date(base); d.setFullYear(y, m, day);
  return d;
}

/* Serientermin: erzeugt die Startzeitpunkte ausgehend vom ersten Termin.
   freq: weekly | biweekly | monthly-date | monthly-last | monthly-weekday |
   monthly-last-weekday (Alt-Wert "monthly" == monthly-date). */
function serienDaten(baseIso, freq, countRaw) {
  const count = Math.max(2, Math.min(52, parseInt(countRaw, 10) || 2));
  const base = new Date(baseIso), out = [];
  const wd = base.getDay(), ord = Math.ceil(base.getDate() / 7);
  for (let i = 0; i < count; i++) {
    let d = new Date(base);
    switch (freq) {
      case "biweekly": d.setDate(base.getDate() + 14 * i); break;
      case "monthly-date": case "monthly": {     // gleicher Tag, kurze Monate auf letzten Tag gekappt
        const dim = new Date(base.getFullYear(), base.getMonth() + i + 1, 0).getDate();
        d.setFullYear(base.getFullYear(), base.getMonth() + i, Math.min(base.getDate(), dim)); break;
      }
      case "monthly-last":                        // letzter Tag des Monats
        d.setFullYear(base.getFullYear(), base.getMonth() + i + 1, 0); break;
      case "monthly-weekday": d = nterWochentag(baseIso, i, wd, ord, false); break;
      case "monthly-last-weekday": d = nterWochentag(baseIso, i, wd, ord, true); break;
      default: d.setDate(base.getDate() + 7 * i); // weekly, inkl. „jeden <Wochentag>"
    }
    out.push(d.toISOString());
  }
  return out;
}

/* Kleine Live-Vorschau der ersten Termine unter den Serien-Optionen. */
function serieVorschauUpdate() {
  const el = $("#ev-serie-preview"); if (!el) return;
  const when = $("#ev-when")?.value;
  if (!$("#ev-serie")?.checked || !when) { el.textContent = ""; return; }
  const daten = serienDaten(new Date(when).toISOString(), $("#ev-serie-freq")?.value, $("#ev-serie-count")?.value);
  const fmt = s => new Date(s).toLocaleDateString(LANG, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  const liste = daten.slice(0, 4).map(fmt).join(" · ") + (daten.length > 4 ? " · +" + (daten.length - 4) : "");
  el.textContent = t("cal.seriePreview", { list: liste });
}

async function terminSpeichern() {
  const title = $("#ev-title")?.value.trim();
  const whenVal = $("#ev-when")?.value;
  const desc = $("#ev-desc")?.value || "";
  if (!title) { toast(t("cal.needTitle")); return; }
  if (!whenVal) { toast(t("cal.needWhen")); return; }
  const iso = new Date(whenVal).toISOString();
  const remind = $("#ev-remind")?.checked || false;
  try {
    if (eventForm.editId) {
      // reminded_at zurücksetzen: bei geändertem Zeitpunkt / neu gesetzter Option
      // soll die Erinnerung erneut greifen.
      const { error } = await sb.from("game_events")
        .update({ title, description: desc.trim() || null, starts_at: iso, remind, reminded_at: null })
        .eq("id", eventForm.editId);
      if (error) throw error;
    } else {
      const invitees = $$("#v-events .ev-invite-list input:checked").map(c => c.value);
      const daten = $("#ev-serie")?.checked
        ? serienDaten(iso, $("#ev-serie-freq")?.value, $("#ev-serie-count")?.value)
        : [iso];
      let ersteId = null;
      for (const startIso of daten) {
        const { data: eid, error } = await sb.rpc("create_event", { p_title: title, p_desc: desc, p_starts_at: startIso, p_invitees: invitees, p_remind: remind });
        if (error) throw error;
        if (!ersteId) ersteId = eid;
      }
      if (daten.length > 1) toast(t("cal.serieCreated", { n: daten.length }));
      // Einladungs-Mails verschicken (bei einer Serie einmal für den ersten Termin).
      if (invitees.length && ersteId) await mailEinladung(ersteId, invitees);
    }
    eventForm.offen = false; eventForm.editId = null;
    await ladeTermine(); renderTermine();
  } catch (e) { toast(dbErr(e)); }
}

/* Einladungs-Mails über die Edge Function „event-mail" verschicken. Schlägt der
   Versand fehl (z. B. SMTP noch nicht eingerichtet), bleibt der Termin trotzdem
   angelegt — nur ein Hinweis, kein harter Fehler. */
async function mailEinladung(eventId, ids) {
  if (!eventId || !ids?.length) return;
  try {
    const { data, error } = await sb.functions.invoke("event-mail", { body: { event: eventId, invitees: ids } });
    if (error) { let msg = ""; try { const c = await error.context?.json?.(); msg = c?.error; } catch { /* egal */ } throw new Error(msg || "mail"); }
    if (data?.error) throw new Error(data.error);
  } catch { toast(t("cal.mailFailed")); }
}
async function terminRsvp(eventId, status) {
  try {
    const { error } = await sb.from("event_rsvp").update({ status }).eq("event_id", eventId).eq("user_id", USER.id);
    if (error) throw error;
    await ladeTermine(); renderTermine();
  } catch (e) { toast(dbErr(e)); }
}
async function terminEinladen(eventId) {
  const ids = $$(`#ev-${CSS.escape(eventId)} .ev-invite-list input:checked`).map(c => c.value);
  if (!ids.length) return;
  try {
    const { error } = await sb.from("event_rsvp").insert(ids.map(id => ({ event_id: eventId, user_id: id, status: "invited" })));
    if (error) throw error;
    terminInviteOffen = null;
    await mailEinladung(eventId, ids);   // die neu Eingeladenen per Mail informieren
    await ladeTermine(); renderTermine();
  } catch (e) { toast(dbErr(e)); }
}
async function terminLoeschen(eventId) {
  const e = EVENTS.find(x => x.id === eventId);
  if (!await confirmDlg(t("cal.delConfirm", { title: e?.title || "" }))) return;
  try {
    const { error } = await sb.from("game_events").delete().eq("id", eventId);
    if (error) throw error;
    terminOffen.delete(eventId);
    await ladeTermine(); renderTermine();
  } catch (e2) { toast(dbErr(e2)); }
}
async function terminSpielrunde(eventId) {
  try {
    const { error } = await sb.rpc("start_session_from_event", { p_event: eventId, p_start_life: 40 });
    if (error) throw error;
    toast(t("cal.sessionStarted"));
    $('#who-menu [data-v="session"]')?.click();   // Session-Ansicht öffnen (lädt die neue Runde)
  } catch (e) { toast(dbErr(e)); }
}

function renderSession() {
  const el = $("#v-session");
  if (!el) return;
  el.innerHTML = SESSION ? sessionBoardHtml() : sessionLobbyHtml();
  wireSession();
}

function sessionLobbyHtml() {
  const inv = SESSION_INVITES.map(s => `
    <div class="freund-zeile">
      ${avatarHtml(34, s.hostProfile)}
      <div style="flex:1;min-width:0"><b>${esc(s.hostProfile?.display_name || t("friends.unknown"))}</b>
        <div class="hint">${esc(t("sess.invitedYou", { life: s.start_life }))}</div></div>
      <div style="flex:none"><button class="btn sm" data-sess-join="${esc(s.id)}">${esc(t("sess.join"))}</button></div>
      <div style="flex:none"><button class="btn ghost sm" data-sess-decline="${esc(s.id)}">${esc(t("sess.decline"))}</button></div>
    </div>`).join("");
  return `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("sess.newTitle"))}</h3>
      <p class="hint" style="margin-top:-4px">${esc(t("sess.newHint"))}</p>
      <label>${esc(t("sess.startLife"))}</label>
      <div class="row" style="align-items:center">
        <div style="flex:none"><input type="number" id="sess-life" min="1" max="999" value="40" style="width:100px"></div>
        <div style="flex:none">${[20, 40].map(v => `<button class="btn ghost sm" data-life-preset="${v}">${v}</button>`).join(" ")}</div>
        <div style="flex:none"><button class="btn" id="sess-create">${esc(t("sess.create"))}</button></div>
      </div>
    </div>
    ${inv ? `<div class="card"><h3 style="margin-top:0">${esc(t("sess.invitesTitle"))}</h3>${inv}</div>` : ""}`;
}

function sessionBoardHtml() {
  const istHost = SESSION.host === USER.id;
  const spieler = SESSION_PLAYERS.map(p => {
    const joined = p.status === "joined";
    const besiegt = joined && p.life <= 0;   // bei 0 Leben ausgeschieden
    const name = p.profile?.display_name
      || (p.user_id === USER.id ? (PROFILE?.display_name || t("sess.you")) : t("friends.unknown"));
    return `<div class="sp-card${joined ? "" : " wartet"}${besiegt ? " besiegt" : ""}">
      ${avatarHtml(48, p.profile)}
      <div class="sp-name">${esc(name)}${p.user_id === SESSION.host ? ` <span class="sp-host" title="${esc(t("sess.host"))}">&#9733;</span>` : ""}</div>
      ${p.deck_name ? `<div class="sp-deck"${p.commander_img ? ` data-cmd-img="${esc(p.commander_img)}" data-cmd-name="${esc(p.commander || p.deck_name)}"` : ""} title="${esc(p.commander || p.deck_name)}">${p.commander_img ? `<img class="sp-cmd" src="${esc(p.commander_img)}" alt="">` : ""}<span class="sp-deckname">${esc(p.deck_name)}</span></div>` : ""}
      ${joined
        ? `<div class="sp-life" data-u="${esc(p.user_id)}">${Math.max(0, p.life)}</div>
           <div class="sp-besiegt">&#9760; ${esc(t("sess.defeated"))}</div>`
        + `
           <div class="sp-ctrl">
             <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="-5">&minus;5</button>
             <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="-1">&minus;1</button>
             <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="1">+1</button>
             <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="5">+5</button>
           </div>`
        : `<div class="sp-wait">${esc(t("sess.waiting"))}</div>`}
    </div>`;
  }).join("");

  const drin = new Set(SESSION_PLAYERS.map(p => p.user_id));
  const einladbar = (FRIENDS?.accepted || []).map(f => f.other).filter(o => o && !drin.has(o.id));
  const inviteList = einladbar.map(o => `
    <div class="freund-zeile">
      ${avatarHtml(30, o)}
      <div style="flex:1;min-width:0">${esc(o.display_name || t("friends.unknown"))}</div>
      <div style="flex:none"><button class="btn ghost sm" data-sess-invite="${esc(o.id)}">${esc(t("sess.invite"))}</button></div>
    </div>`).join("");

  return `
    <div class="card">
      <div class="row" style="align-items:center;justify-content:space-between">
        <h3 style="margin:0">${esc(t("sess.roundTitle"))} <span class="hint">&middot; ${esc(t("sess.startLife"))} ${SESSION.start_life}</span></h3>
        <div class="row" style="flex:none;gap:6px">
          ${istHost ? `<button class="btn ghost sm" id="sess-reset">${esc(t("sess.reset"))}</button>` : ""}
          ${istHost ? `<button class="btn danger sm" id="sess-end">${esc(t("sess.end"))}</button>`
                    : `<button class="btn danger sm" id="sess-leave">${esc(t("sess.leave"))}</button>`}
        </div>
      </div>
      <div class="sp-grid">${spieler}</div>
      <div class="row" style="align-items:center;margin-top:12px">
        <div style="flex:none"><label style="margin:0">${esc(t("sess.myDeck"))}</label></div>
        <div style="flex:none;min-width:200px"><select id="sess-deck">
          <option value="">${esc(t("sess.noDeck"))}</option>
          ${(DECKS || []).map(d => `<option value="${esc(d.id)}"${d.id === (meinSpieler()?.deck_id || "") ? " selected" : ""}>${esc(d.name)}</option>`).join("")}
        </select></div>
      </div>
    </div>

    ${deckTrackerHtml()}

    <div class="card">
      <h3 style="margin-top:0">${esc(t("sess.dice"))}</h3>
      <div class="row" style="align-items:center">
        <div style="flex:none"><input type="number" id="dice-sides" min="2" max="1000" value="20" style="width:90px"></div>
        <div style="flex:none">${[4, 6, 8, 10, 12, 20].map(s => `<button class="btn ghost sm" data-dice="${s}">W${s}</button>`).join(" ")}</div>
        <div style="flex:none"><button class="btn" id="dice-roll">${esc(t("sess.roll"))}</button></div>
      </div>
      <div class="dice-stage" id="dice-stage">${diceStageHtml()}</div>
      <div class="sess-log" id="sess-log">${SESSION_LOG.slice(0, 30).map(logZeile).join("")}</div>
    </div>

    ${(FRIENDS?.accepted?.length) ? `<div class="card">
      <h3 style="margin-top:0">${esc(t("sess.inviteTitle"))}</h3>
      ${inviteList || `<div class="empty">${esc(t("sess.allInvited"))}</div>`}
    </div>` : ""}`;
}

function logZeile(ev) {
  const p = SESSION_PLAYERS.find(x => x.user_id === ev.user_id);
  const name = p?.profile?.display_name || (ev.user_id === USER?.id ? t("sess.you") : "?");
  if (ev.kind === "dice")
    return `<div class="log-zeile">&#127922; <b>${esc(name)}</b>: W${esc(String(ev.data?.sides))} &rarr; <b>${esc(String(ev.data?.result))}</b></div>`;
  return "";
}

/* Privater Karten-Tracker: die Karten des eigenen gewählten Decks, jede als
   „gespielt" abhakbar → Überblick, was noch in der Bibliothek liegt. Nur der
   Spieler selbst sieht das. */
function deckTrackerHtml() {
  const deckId = meinSpieler()?.deck_id;
  const deck = deckId && (DECKS || []).find(d => d.id === deckId);
  if (!deck) return "";
  return `<div class="card" id="trk-card">
    <div class="row" style="align-items:center;justify-content:space-between">
      <h3 style="margin:0">${esc(t("sess.trackerTitle", { deck: deck.name }))}</h3>
      <div style="flex:none"><button class="btn ghost sm" id="trk-reset">${esc(t("sess.trackerReset"))}</button></div>
    </div>
    <div class="row" style="margin-top:8px"><div style="flex:1"><input type="text" id="trk-search"
      placeholder="${esc(t("sess.trackerSearch"))}"></div></div>
    <div id="trk-panel">${trackerInnerHtml("")}</div>
  </div>`;
}

// Lesbarer Kartenname für den Tracker: sonst wie in der App der gedruckte Name,
// aber für Phyrexianisch (unlesbare Glyphen) der englische Name.
const trkName = c => ((c.lang === "ph" ? c.name : (c.disp || c.name)) || c.name || "");

function trackerInnerHtml(filter) {
  const deck = (DECKS || []).find(d => d.id === meinSpieler()?.deck_id);
  if (!deck) return "";
  const f = (filter || "").trim().toLowerCase();
  const entries = (deck.entries || []).map(e => {
    const card = CARDS.find(c => c.id === e.cardId);
    return card ? { card, cardId: e.cardId, total: e.qty, played: SESSION_PLAYED[e.cardId] || 0 } : null;
  }).filter(Boolean);
  let restN = 0, gespieltN = 0;
  entries.forEach(e => { restN += Math.max(0, e.total - e.played); gespieltN += Math.min(e.total, e.played); });
  // Noch in der Bibliothek zuerst, dann alphabetisch.
  entries.sort((a, b) => ((b.total - b.played > 0) - (a.total - a.played > 0))
    || trkName(a.card).localeCompare(trkName(b.card)));
  const rows = entries
    .filter(e => !f || trkName(e.card).toLowerCase().includes(f))
    .map(e => {
      const rest = e.total - e.played;
      return `<div class="trk-row${rest <= 0 ? " leer" : ""}">
        <span class="trk-q">${rest}${e.total > 1 ? `/${e.total}` : ""}</span>
        <span class="trk-n">${esc(trkName(e.card))}</span>
        <span class="trk-btns">
          ${e.played > 0 ? `<button class="btn ghost sm" data-trk-undo="${esc(e.cardId)}" title="${esc(t("sess.undoPlayed"))}">&#8617;</button>` : ""}
          <button class="btn ghost sm" data-trk-play="${esc(e.cardId)}"${rest <= 0 ? " disabled" : ""}>${esc(t("sess.markPlayed"))}</button>
        </span>
      </div>`;
    }).join("");
  return `<div class="trk-sum">${esc(t("sess.trackerSummary", { rest: restN, played: gespieltN }))}</div>
    <div class="trk-list">${rows || `<div class="empty">${esc(t("sess.trackerEmpty"))}</div>`}</div>`;
}

function renderTracker() {
  const panel = $("#trk-panel");
  if (panel) panel.innerHTML = trackerInnerHtml($("#trk-search")?.value || "");
}

/* Eine Karte als gespielt markieren (+1) oder zurücknehmen (−1). Lokal sofort,
   Schreiben entprellt. */
function trackerMark(cardId, delta) {
  const deck = (DECKS || []).find(d => d.id === meinSpieler()?.deck_id);
  const total = deck?.entries?.find(e => e.cardId === cardId)?.qty || 0;
  const next = Math.max(0, Math.min(total, (SESSION_PLAYED[cardId] || 0) + delta));
  if (next > 0) SESSION_PLAYED[cardId] = next; else delete SESSION_PLAYED[cardId];
  renderTracker();
  clearTimeout(playedTimers[cardId]);
  playedTimers[cardId] = setTimeout(async () => {
    const q = SESSION_PLAYED[cardId] || 0; delete playedTimers[cardId];
    try {
      if (q > 0) await sb.from("session_played")
        .upsert({ session_id: SESSION.id, user_id: USER.id, card_id: cardId, qty: q }, { onConflict: "session_id,user_id,card_id" });
      else await sb.from("session_played").delete()
        .eq("session_id", SESSION.id).eq("user_id", USER.id).eq("card_id", cardId);
    } catch (e) { toast(dbErr(e)); }
  }, 350);
}

async function trackerReset() {
  SESSION_PLAYED = {}; renderTracker();
  try { await sb.from("session_played").delete().eq("session_id", SESSION.id).eq("user_id", USER.id); }
  catch (e) { toast(dbErr(e)); }
}

/* Deck für die Runde wählen: an session_players (Realtime → Mitspieler sehen es),
   und den Tracker der alten Wahl leeren. */
async function sessDeckWaehlen(deckId) {
  try {
    await sb.from("session_players").update({ deck_id: deckId || null })
      .eq("session_id", SESSION.id).eq("user_id", USER.id);
    SESSION_PLAYED = {};
    await sb.from("session_played").delete().eq("session_id", SESSION.id).eq("user_id", USER.id);
    await ladeSpieler(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}

function wireSession() {
  const create = $("#sess-create");
  if (create) {
    $$("[data-life-preset]").forEach(b => b.onclick = () => { $("#sess-life").value = b.dataset.lifePreset; });
    create.onclick = () => sessionErstellen(parseInt($("#sess-life").value) || 40);
  }
  $$("[data-sess-join]").forEach(b => b.onclick = () => sessionBeitreten(b.dataset.sessJoin));
  $$("[data-sess-decline]").forEach(b => b.onclick = () => sessionAblehnen(b.dataset.sessDecline));
  $$("[data-life]").forEach(b => b.onclick = () => lebenAendern(b.dataset.life, parseInt(b.dataset.d)));
  $$("[data-sess-invite]").forEach(b => b.onclick = () => sessionEinladen(b.dataset.sessInvite, b));
  const reset = $("#sess-reset"); if (reset) reset.onclick = lebenReset;
  const end = $("#sess-end"); if (end) end.onclick = sessionBeenden;
  const leave = $("#sess-leave"); if (leave) leave.onclick = sessionVerlassen;
  const roll = $("#dice-roll");
  if (roll) {
    $$("[data-dice]").forEach(b => b.onclick = () => { $("#dice-sides").value = b.dataset.dice; wuerfeln(parseInt(b.dataset.dice)); });
    roll.onclick = () => wuerfeln(parseInt($("#dice-sides").value) || 20);
  }
  const deckSel = $("#sess-deck"); if (deckSel) deckSel.onchange = () => sessDeckWaehlen(deckSel.value);
  const trkReset = $("#trk-reset"); if (trkReset) trkReset.onclick = trackerReset;
  const trkSearch = $("#trk-search"); if (trkSearch) trkSearch.oninput = renderTracker;
  const trkPanel = $("#trk-panel");   // Delegation: die Reihen entstehen bei jedem Abhaken neu
  if (trkPanel) trkPanel.onclick = e => {
    const play = e.target.closest("[data-trk-play]"); if (play) return trackerMark(play.dataset.trkPlay, 1);
    const undo = e.target.closest("[data-trk-undo]"); if (undo) return trackerMark(undo.dataset.trkUndo, -1);
  };
  // Commander-Karten: beim Hover große Vorschau + Name.
  if (HOVER_OK) $$("#v-session .sp-deck[data-cmd-img]").forEach(el => {
    el.addEventListener("mousemove", e => zeigeCmdHover(el.dataset.cmdImg, el.dataset.cmdName, e.clientX, e.clientY));
    el.addEventListener("mouseleave", versteckeCmdHover);
  });
}

async function sessionErstellen(life) {
  try {
    const { error } = await sb.rpc("create_session", { p_start_life: Math.max(1, Math.min(999, life)) });
    if (error) throw error;
    await ladeSession(); subscribeSession(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}
async function sessionBeitreten(id) {
  try {
    const { error } = await sb.rpc("join_session", { p_session: id });
    if (error) throw error;
    await ladeSession(); subscribeSession(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}
async function sessionAblehnen(id) {
  try { await sb.rpc("leave_session", { p_session: id }); await ladeSession(); renderSession(); }
  catch (e) { toast(dbErr(e)); }
}
async function sessionEinladen(userId, btn) {
  if (btn) btn.disabled = true;
  try { const { error } = await sb.rpc("invite_to_session", { p_session: SESSION.id, p_user: userId }); if (error) throw error; toast(t("sess.invited")); }
  catch (e) { if (btn) btn.disabled = false; toast(dbErr(e)); }
}
async function sessionVerlassen() {
  try {
    await sb.rpc("leave_session", { p_session: SESSION.id });
    unsubscribeSession(); SESSION = null; SESSION_PLAYERS = [];
    await ladeSession(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}
async function sessionBeenden() {
  if (!await confirmDlg(t("sess.endConfirm"))) return;
  try {
    await sb.rpc("end_session", { p_session: SESSION.id });
    unsubscribeSession(); SESSION = null; SESSION_PLAYERS = [];
    await ladeSession(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}
async function lebenReset() {
  try {
    await sb.rpc("reset_lives", { p_session: SESSION.id });
    SESSION_PLAYED = {};   // eigener Tracker sofort leer; das reset-Event räumt die DB
    await ladeSpieler(); renderSession();
  } catch (e) { toast(dbErr(e)); }
}

/* Leben ändern: lokal sofort (optimistisch), Schreiben entprellt. Fremde
   Änderungen kommen per Realtime rein und überschreiben die Anzeige. */
function lebenAendern(userId, delta) {
  const p = SESSION_PLAYERS.find(x => x.user_id === userId);
  if (!p || p.status !== "joined") return;
  p.life = Math.max(0, Math.min(999, p.life + delta));   // 0 = besiegt, kein Minus
  const el = $(`.sp-life[data-u="${userId}"]`);
  if (el) { el.textContent = p.life; el.closest(".sp-card")?.classList.toggle("besiegt", p.life <= 0); }
  clearTimeout(lifeTimers[userId]);
  lifeTimers[userId] = setTimeout(async () => {
    const wert = p.life; delete lifeTimers[userId];
    try { await sb.from("session_players").update({ life: wert }).eq("session_id", SESSION.id).eq("user_id", userId); }
    catch (e) { toast(dbErr(e)); }
  }, 400);
}

/* Würfelanzeige: bei W6 die Augen-Glyphen, sonst die Zahl. */
const DICE_PIPS = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];   // ⚀⚁⚂⚃⚄⚅
const diceFace = (sides, v) => (sides === 6 && DICE_PIPS[v]) ? DICE_PIPS[v] : String(v);

/* ============================ 3D-Würfel (three.js) ====================
   Echte 3D-Würfel für W6 & W20: three.js wird beim Öffnen der Spielrunde per
   dynamischem import() nachgeladen (nur dann, ~1× je Sitzung). Der Würfel taumelt
   und dreht dann auf die ERGEBNIS-Fläche. Nicht geladen / andere Seitenzahl →
   2D-Rückfall (CSS-Würfel / SVG-W20). */
const DiceGL = {
  ready: false, THREE: null, renderer: null, scene: null, cam: null,
  cube: null, ico: null, canvas: null, _raf: null, _loading: null,

  load() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const T = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js");
        this.THREE = T;
        this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
        this.renderer.setSize(340, 150);   // breite Bühne: der Würfel rollt quer durch
        this.canvas = this.renderer.domElement; this.canvas.className = "dice-gl";
        this.scene = new T.Scene();
        this.cam = new T.PerspectiveCamera(32, 340 / 150, 0.1, 100); this.cam.position.set(0, 0, 6.6);
        this.scene.add(new T.AmbientLight(0xffffff, 0.85));
        const d1 = new T.DirectionalLight(0xffffff, 1.2); d1.position.set(3, 5, 6); this.scene.add(d1);
        const d2 = new T.DirectionalLight(0xffe9c0, 0.5); d2.position.set(-4, -2, 3); this.scene.add(d2);
        this.cube = this._buildCube(); this.cube.visible = false; this.scene.add(this.cube);
        this.ico = this._buildIco(); this.ico.visible = false; this.scene.add(this.ico);
        this.ready = true;
      } catch { this.ready = false; }
    })();
    return this._loading;
  },
  supports(sides) { return this.ready && (sides === 6 || sides === 20); },

  _faceTex(draw) {
    const c = document.createElement("canvas"); c.width = c.height = 160;
    const x = c.getContext("2d"); x.fillStyle = "#d9a52e"; x.fillRect(0, 0, 160, 160); draw(x);
    return new this.THREE.CanvasTexture(c);
  },
  _buildCube() {
    const T = this.THREE;
    const pip = v => this._faceTex(x => { x.fillStyle = "#241a00";
      const P = { TL: [45, 45], TR: [115, 45], ML: [45, 80], C: [80, 80], MR: [115, 80], BL: [45, 115], BR: [115, 115] };
      const L = { 1: ["C"], 2: ["TL", "BR"], 3: ["TL", "C", "BR"], 4: ["TL", "TR", "BL", "BR"], 5: ["TL", "TR", "C", "BL", "BR"], 6: ["TL", "TR", "ML", "MR", "BL", "BR"] };
      (L[v] || []).forEach(k => { x.beginPath(); x.arc(P[k][0], P[k][1], 15, 0, 7); x.fill(); }); });
    const mats = [3, 4, 2, 5, 1, 6].map(v => new T.MeshStandardMaterial({ map: pip(v), metalness: 0.25, roughness: 0.55 }));
    const m = new T.Mesh(new T.BoxGeometry(2.1, 2.1, 2.1), mats);
    m.scale.setScalar(0.62);   // klein genug, um mit Rand quer durchzurollen
    m.userData.norm = { 1: [0, 0, 1], 6: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, 1, 0], 5: [0, -1, 0] };
    return m;
  },
  _buildIco() {
    const T = this.THREE;
    // Zahlen auf TRANSPARENTEM Grund (kein goldenes Quadrat) → sie sitzen direkt
    // auf den Würfelflächen; heller Rand hebt sie vom facettierten Gold ab.
    const numTex = n => {
      const c = document.createElement("canvas"); c.width = c.height = 160;
      const x = c.getContext("2d");
      x.font = "bold 96px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 7; x.strokeStyle = "rgba(255,244,214,.55)"; x.strokeText(String(n), 80, 86);
      x.fillStyle = "#2a1e02"; x.fillText(String(n), 80, 86);
      if (n === 6 || n === 9) x.fillRect(50, 122, 60, 8);
      return new T.CanvasTexture(c);
    };
    const g = new T.IcosahedronGeometry(1.7, 0); g.computeVertexNormals();
    const grp = new T.Group();
    grp.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: 0xc9962b, metalness: 0.3, roughness: 0.5, flatShading: true })));
    const pos = g.getAttribute("position"), norm = {};
    for (let f = 0; f < pos.count; f += 3) {
      const a = new T.Vector3().fromBufferAttribute(pos, f), b = new T.Vector3().fromBufferAttribute(pos, f + 1), c = new T.Vector3().fromBufferAttribute(pos, f + 2);
      const cen = new T.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3), num = (f / 3) + 1;
      norm[num] = cen.clone().normalize().toArray();
      const pl = new T.Mesh(new T.PlaneGeometry(0.9, 0.9), new T.MeshBasicMaterial({ map: numTex(num), transparent: true }));
      pl.position.copy(cen.clone().multiplyScalar(1.03)); pl.lookAt(cen.clone().multiplyScalar(3)); grp.add(pl);
    }
    grp.scale.setScalar(0.62);   // klein genug, um mit Rand quer durchzurollen
    grp.userData.norm = norm;
    return grp;
  },
  _targetQuat(die, result) {
    const T = this.THREE, view = new T.Vector3(0.12, 0.2, 1).normalize();
    const n = new T.Vector3().fromArray(die.userData.norm[result]).normalize();
    return new T.Quaternion().setFromUnitVectors(n, view);
  },

  /* Taumeln → auf die Ergebnis-Fläche einrasten. */
  roll(sides, result) {
    if (!this.supports(sides)) return;
    const T = this.THREE;
    this.cube.visible = sides === 6; this.ico.visible = sides === 20;
    const die = sides === 6 ? this.cube : this.ico;
    const target = this._targetQuat(die, result);
    cancelAnimationFrame(this._raf); clearTimeout(this._safety);
    const t0 = performance.now(), tumble = 800, settle = 650, total = tumble + settle;
    const axis = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    // Quer durchrollen: von links herein (startX) nach rechts (endX), flacher Bogen.
    const startX = -3.0, endX = 0.9, arcH = 0.35;
    die.position.set(startX, 0, 0);
    let q0 = null, settling = false;
    const step = now => {
      const el = now - t0;
      const tp = Math.min(1, el / total), ez = 1 - Math.pow(1 - tp, 2);   // easeOut
      die.position.set(startX + (endX - startX) * ez, arcH * Math.sin(Math.PI * Math.min(1, tp * 1.1)), 0);
      if (el < tumble) { die.rotateOnWorldAxis(axis, 0.32); }
      else {
        if (!settling) { settling = true; q0 = die.quaternion.clone(); }
        const p = Math.min(1, (el - tumble) / settle), e = 1 - Math.pow(1 - p, 3);
        die.quaternion.copy(q0).slerp(target, e);
        if (p >= 1) { clearTimeout(this._safety); die.position.set(endX, 0, 0); this.renderer.render(this.scene, this.cam); this._raf = null; return; }
      }
      this.renderer.render(this.scene, this.cam);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
    // Sicherheitsnetz: falls requestAnimationFrame gedrosselt wird (Tab im
    // Hintergrund), sitzen Ergebnis-Fläche UND Endposition trotzdem garantiert.
    this._safety = setTimeout(() => {
      cancelAnimationFrame(this._raf); this._raf = null;
      die.position.set(endX, 0, 0); die.quaternion.copy(target); this.renderer.render(this.scene, this.cam);
    }, total + 350);
  },
};

/* Pips einer W6-Fläche als Punkte im 3×3-Raster. */
function pipDots(v) {
  const P = { TL: [27, 27], TR: [73, 27], ML: [27, 50], C: [50, 50], MR: [73, 50], BL: [27, 73], BR: [73, 73] };
  const L = { 1: ["C"], 2: ["TL", "BR"], 3: ["TL", "C", "BR"], 4: ["TL", "TR", "BL", "BR"],
              5: ["TL", "TR", "C", "BL", "BR"], 6: ["TL", "TR", "ML", "MR", "BL", "BR"] };
  return (L[v] || []).map(k => `<i class="pip" style="left:${P[k][0]}%;top:${P[k][1]}%"></i>`).join("");
}
/* Drehung, die die Augenzahl V nach vorne bringt (Flächenlage: 1 vorn, 6 hinten,
   3 rechts, 4 links, 2 oben, 5 unten). */
const CUBE_ROT = {
  1: "rotateX(0deg) rotateY(0deg)", 6: "rotateX(0deg) rotateY(180deg)",
  3: "rotateX(0deg) rotateY(-90deg)", 4: "rotateX(0deg) rotateY(90deg)",
  2: "rotateX(-90deg) rotateY(0deg)", 5: "rotateX(90deg) rotateY(0deg)",
};
/* Ergebnis-Fläche vorn, aber leicht gekippt — so bleibt der Würfel auch im
   Ruhezustand als 3D-Körper erkennbar (man sieht einen Streifen der Nachbarflächen). */
const cubeLand = v => `rotateX(-11deg) rotateY(-15deg) ${CUBE_ROT[v]}`;
function cubeHtml(faceVal) {
  const start = CUBE_ROT[faceVal] ? cubeLand(faceVal) : "rotateX(-18deg) rotateY(22deg)";
  return `<div class="dice-obj cube" style="transform:${start}">${
    [1, 2, 3, 4, 5, 6].map(v => `<div class="cf cf${v}">${pipDots(v)}</div>`).join("")}</div>`;
}

/* Der Würfelkörper: W6 als echter 3D-Würfel, W20 als SVG-Icosaeder (echte
   W20-Silhouette mit Facetten, Zahl in der Frontfläche), sonst der goldene
   Würfel mit Zahl. */
function diceObjHtml(sides, faceVal) {
  if (sides === 6) return cubeHtml(faceVal);
  if (sides === 20)
    return `<svg class="dice-obj d20" viewBox="0 0 100 100" aria-hidden="true">
      <polygon class="d20-body" points="50,3 90.7,26.5 90.7,73.5 50,97 9.3,73.5 9.3,26.5"/>
      <g class="d20-facet">
        <line x1="50" y1="32" x2="50" y2="3"/><line x1="50" y1="32" x2="9.3" y2="26.5"/>
        <line x1="50" y1="32" x2="90.7" y2="26.5"/><line x1="31" y1="63" x2="9.3" y2="26.5"/>
        <line x1="31" y1="63" x2="9.3" y2="73.5"/><line x1="31" y1="63" x2="50" y2="97"/>
        <line x1="69" y1="63" x2="90.7" y2="26.5"/><line x1="69" y1="63" x2="90.7" y2="73.5"/>
        <line x1="69" y1="63" x2="50" y2="97"/></g>
      <polygon class="d20-front" points="50,32 69,63 31,63"/>
      <text class="dice-val" x="50" y="53" text-anchor="middle" dominant-baseline="middle">${esc(String(faceVal ?? ""))}</text>
    </svg>`;
  return `<div class="dice-obj dice-die"><span class="dice-val">${esc(diceFace(sides, faceVal))}</span></div>`;
}

/* Statischer Bühnen-Zustand beim Rendern: letzter Wurf aus dem Log, sonst ruhend. */
function diceStageHtml() {
  const last = (SESSION_LOG || []).find(e => e.kind === "dice");
  if (!last) return `<div class="dice-obj dice-die idle"><span class="dice-val">&#127922;</span></div>`;
  const sides = last.data?.sides || 20;
  const p = SESSION_PLAYERS.find(x => x.user_id === last.user_id);
  const name = p?.profile?.display_name || (last.user_id === USER?.id ? t("sess.you") : "?");
  return `${diceObjHtml(sides, last.data?.result)}
    <div class="dice-cap"><b>${esc(name)}</b> · W${sides}</div>`;
}

let diceAnim = null;
/* Landerotation für echte 3D-Körper (W6-Würfel; W20-Icosaeder folgt): bringt die
   Ergebnis-Fläche nach vorn. null → Zahl-Flacker-Würfel. */
function landRot(sides, v) { return sides === 6 ? cubeLand(v) : null; }

/* Wurf animieren. Echter 3D-Körper: taumelt frei, friert kurz ein und dreht dann
   sanft auf die ERGEBNIS-Fläche. Sonst: Würfel wackelt, Zahl flackert, rastet mit
   „Plopp" ein. Das Ergebnis steht vorher fest — nur Show. */
function zeigeWurf(sides, result, name) {
  const stage = $("#dice-stage");
  if (!stage) return;
  const s = Math.max(2, sides | 0);
  if (diceAnim) { clearInterval(diceAnim.iv); clearTimeout(diceAnim.to); diceAnim = null; }

  // Echte 3D-Würfel (three.js) für W6 & W20, sobald geladen — sonst 2D-Rückfall.
  if (DiceGL.supports(s)) {
    stage.innerHTML = "";
    stage.appendChild(DiceGL.canvas);
    const cap = document.createElement("div"); cap.className = "dice-cap";
    cap.innerHTML = `<b>${esc(name || "?")}</b> · W${s}`;
    stage.appendChild(cap);
    DiceGL.roll(s, result);
    return;
  }

  stage.innerHTML = `${diceObjHtml(s, 1)}<div class="dice-cap"><b>${esc(name || "?")}</b> · W${s}</div>`;
  const dieEl = stage.querySelector(".dice-obj");

  const rot = landRot(s, result);
  if (rot) {                       // echter 3D-Würfel: taumeln → auf Fläche einrasten
    dieEl.classList.add("rolling");
    const to = setTimeout(() => {
      const jetzt = getComputedStyle(dieEl).transform;   // aktuelle Taumel-Lage einfrieren
      dieEl.style.transform = jetzt; dieEl.classList.remove("rolling"); void dieEl.offsetWidth;
      dieEl.style.transition = "transform .6s cubic-bezier(.2,.8,.25,1.25)";
      dieEl.style.transform = rot;
      diceAnim = null;
    }, 850);
    diceAnim = { iv: null, to };
    return;
  }

  const valEl = stage.querySelector(".dice-val");
  dieEl.classList.add("rolling");
  const iv = setInterval(() => { valEl.textContent = diceFace(s, 1 + Math.floor(Math.random() * s)); }, 60);
  const to = setTimeout(() => {
    clearInterval(iv);
    valEl.textContent = diceFace(s, result);
    dieEl.classList.remove("rolling"); dieEl.classList.add("landed");
    diceAnim = null;
  }, 900);
  diceAnim = { iv, to };
}

/* Würfel: Ergebnis lokal (Math.random) festlegen und animiert zeigen, als Event
   einfügen — die Runde sieht den Wurf (samt Animation) über Realtime. */
function wuerfeln(sides) {
  if (!SESSION) return;
  const s = Math.max(2, Math.min(1000, sides | 0));
  const result = 1 + Math.floor(Math.random() * s);
  zeigeWurf(s, result, meinSpieler()?.profile?.display_name || t("sess.you"));
  // Ergebnis als Event festhalten UND das Log SOFORT lokal ergänzen — NICHT auf
  // den Realtime-Echo warten: der kann bei wackliger Verbindung ausbleiben, dann
  // erschiene der eigene Wurf nie im Log. onEvent entprellt den Echo über die id.
  sb.from("session_events")
    .insert({ session_id: SESSION.id, user_id: USER.id, kind: "dice", data: { sides: s, result } })
    .select().single()
    .then(({ data, error }) => {
      if (error) { toast(dbErr(error)); return; }
      if (data && !SESSION_LOG.some(e => e.id === data.id)) logHinzu(data);
    });
}

/* Ein Event vorn ins Log hängen und die Anzeige (falls sichtbar) neu zeichnen. */
function logHinzu(ev) {
  SESSION_LOG.unshift(ev);
  SESSION_LOG = SESSION_LOG.slice(0, 30);
  const box = $("#sess-log");
  if (box) box.innerHTML = SESSION_LOG.slice(0, 30).map(logZeile).join("");
}

/* -------- Realtime -------- */
function subscribeInvites() {
  if (inviteChannel || !USER) return;
  inviteChannel = sb.channel(`inv:${USER.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "session_players", filter: `user_id=eq.${USER.id}` },
      async () => { await ladeSession(); if ($(".view.on")?.id === "v-session") renderSession(); })
    .subscribe();
}
function subscribeSession() {
  if (!SESSION) return;
  unsubscribeSession();
  const sid = SESSION.id;
  sessionChannel = sb.channel(`sess:${sid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "session_players", filter: `session_id=eq.${sid}` }, onSpielerChange)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_events", filter: `session_id=eq.${sid}` }, onEvent)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sid}` }, onSessionChange)
    .subscribe();
}
function unsubscribeSession() {
  if (sessionChannel) { sb.removeChannel(sessionChannel); sessionChannel = null; }
}
function onSpielerChange(payload) {
  if (!SESSION) return;
  if (payload.eventType === "UPDATE" && payload.new && payload.new.status === "joined") {
    const u = payload.new.user_id;
    if (lifeTimers[u]) return;   // eigener, noch nicht geschriebener Wert hat Vorrang
    const p = SESSION_PLAYERS.find(x => x.user_id === u);
    if (p) { p.life = payload.new.life; const el = $(`.sp-life[data-u="${u}"]`); if (el) el.textContent = p.life; return; }
  }
  ladeSpieler().then(() => { if ($(".view.on")?.id === "v-session") renderSession(); });
}
function onEvent(payload) {
  const ev = payload.new;
  if (!ev || !SESSION || ev.session_id !== SESSION.id) return;
  if (ev.kind === "reset") {   // „Neues Spiel" → eigenen Tracker leeren (lokal + DB)
    SESSION_PLAYED = {};
    sb.from("session_played").delete().eq("session_id", SESSION.id).eq("user_id", USER.id).then(() => {});
    if ($(".view.on")?.id === "v-session") renderTracker();
    return;
  }
  if (ev.id != null && SESSION_LOG.some(e => e.id === ev.id)) return;   // eigener Wurf schon lokal ergänzt
  logHinzu(ev);
  // Wurf eines MITSPIELERS animieren (den eigenen habe ich lokal schon gezeigt).
  if (ev.kind === "dice" && ev.user_id !== USER?.id && $(".view.on")?.id === "v-session") {
    const p = SESSION_PLAYERS.find(x => x.user_id === ev.user_id);
    zeigeWurf(ev.data?.sides, ev.data?.result, p?.profile?.display_name || "?");
  }
}
function onSessionChange(payload) {
  if (payload.new && payload.new.status === "ended") {
    unsubscribeSession();
    toast(t("sess.ended"));
    SESSION = null; SESSION_PLAYERS = [];
    ladeSession().then(() => { if ($(".view.on")?.id === "v-session") renderSession(); });
  }
}

function wireApp() {
  $$("nav button[data-v]").forEach(b => b.onclick = () => {
    $$("nav button[data-v]").forEach(x => x.classList.toggle("on", x === b));
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
    $("#who-menu")?.classList.remove("open");   // Menüauswahl klappt das Menü zu
    if (b.dataset.v === "profile") renderProfile();
    if (b.dataset.v === "dashboard") renderDashboard();
    if (b.dataset.v === "friends") oeffneFreunde();
    if (b.dataset.v === "session") oeffneSession();
    if (b.dataset.v === "events") oeffneTermine();
    if (b.dataset.v === "rules") renderRules();
    if (b.dataset.v === "settings") renderSettings();
  });
  // Klick irgendwo anders schließt das per Klick geöffnete Benutzermenü (Touch)
  // und das Sprach-Dropdown in den Einstellungen.
  document.addEventListener("click", e => {
    const m = $("#who-menu");
    if (m && !m.contains(e.target)) m.classList.remove("open");
    const ls = $("#lang-select");
    if (ls && !ls.contains(e.target)) ls.classList.remove("open");
  });

  // „Als Wunschkarte ins Deck" bei Synergie-/Analyse-Vorschlägen. Delegation, weil
  // die Kacheln bei jeder Suche neu entstehen. Nach dem Anlegen NICHT neu zeichnen,
  // damit die (teils bezahlten KI-) Vorschläge stehen bleiben — nur reload() für
  // frische Daten und ein Häkchen am Knopf.
  document.addEventListener("click", async e => {
    const btn = e.target.closest(".syn-add");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const card = SYN_CACHE.get(btn.dataset.sid);
    const deckId = btn.dataset.deck;
    if (!card || !deckId) return;
    btn.disabled = true;
    try {
      await wunschkarteZumDeck(deckId, card);
      await reload();
      btn.classList.add("done");
      btn.innerHTML = "&#10003;";
      const d = DECKS.find(x => x.id === deckId);
      toast(t("syn.addedWish", { name: card.name, deck: d?.name || "" }));
    } catch (err) { btn.disabled = false; toast(dbErr(err)); }
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

  // Suche/Filter ändern die Treffermenge — immer zurück auf Seite 1.
  $("#q").oninput = () => { collPage = 0; renderCollection(); };
  $("#f-set").onchange = () => { collPage = 0; renderCollection(); };
  $("#f-foil").onchange = () => { collPage = 0; renderCollection(); };
  $("#f-type").onchange = () => { collPage = 0; renderCollection(); };
  $("#upd").onclick = updatePrices;

  // „Deine Combos": komplette Combos quer über den ganzen Bestand. Karten nach
  // Namen dedupliziert (dieselbe Karte in mehreren Auflagen zählt einmal).
  $("#coll-combos").onclick = () => {
    const box = $("#coll-combo-box");
    const b = $("#coll-combos");
    if (!box) return;
    const seen = new Set(), cards = [];
    for (const c of CARDS) {
      if (c.qty <= 0) continue;
      const k = (c.name || "").toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); cards.push(c); }
    }
    if (!cards.length) { box.innerHTML = `<div class="empty">${esc(t("combo.collNone"))}</div>`; return; }
    b.disabled = true;
    sammlungCombosAnzeigen(box, cards)
      .then(() => box.scrollIntoView({ behavior: "smooth", block: "nearest" }))
      .finally(() => { b.disabled = false; });
  };

  // Anlege-Dropdowns aus demselben Vokabular wie Bearbeiten und Filter.
  $("#deck-format").innerHTML = deckOptions(DECK_FORMATE, "", "—");
  $("#deck-arch").innerHTML   = deckOptions(DECK_ARCHETYPEN, "", "—");
  $("#deck-add").onclick = async () => {
    const name = $("#deck-name").value.trim();
    if (!name) return toast(t("toast.deckNameRequired"));
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
  $("#deck-import").onclick = openDeckImport;

  $("#ex-json").onclick = () => download(`arcanum-archive-sicherung-${today()}.json`,
    JSON.stringify({ v: 2, exported: new Date().toISOString(), cards: CARDS, decks: DECKS }, null, 1),
    "application/json");
  $("#ex-csv").onclick = exportCsv;
  $("#ex-cardmarket").onclick = oeffneVerkauf;
  $("#sell-open").onclick = oeffneVerkauf;
  $("#sell-close").onclick = () => $("#sell-dlg").close();
  $("#buy-close").onclick = () => $("#buy-dlg").close();
  // Klick außerhalb schließt diese „Fenster" (zusätzlich zum Schließen-Knopf).
  ["#detail-dlg", "#sell-dlg", "#buy-dlg"].forEach(id => dialogBackdropSchliesst($(id)));
  $("#im-json").onclick = () => $("#im-file").click();
  $("#im-file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await importJson(f); } catch (err) { toast(t("toast.importFailed", { msg: err.message })); }
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
      toast(t("toast.importFailed", { msg: err.message }));
    }
  };
  $("#reset-cfg").onclick = async () => {
    if (!await confirmDlg(t("dlg.resetConn"))) return;
    localStorage.removeItem("mtg-cfg"); location.reload();
  };
}

/* Nach einem Sprachwechsel (Einstellungen): statischen Text hat i18n.js schon
   gesetzt, hier die dynamisch gebauten Ansichten neu zeichnen. */
function onLangChange() {
  if (typeof USER === "undefined" || !USER) return;   // vor Login nur statischer Text
  renderWho();
  renderAll();
  const aktiv = $(".view.on")?.id;
  if (aktiv === "v-profile") renderProfile();
  else if (aktiv === "v-dashboard") renderDashboard();
  else if (aktiv === "v-friends") renderFriends();
  else if (aktiv === "v-session") renderSession();
  else if (aktiv === "v-events") renderTermine();
  else if (aktiv === "v-rules") renderRules();
  else if (aktiv === "v-settings") renderSettings();
  aktualisiereVerkaufZaehler();
  if ($("#sell-dlg")?.open) renderVerkauf();
}

/* ================================ Start =============================== */
(async () => {
  applyI18n();          // statische Oberfläche in der gewählten Sprache
  synModusAnwenden();   // Synergie-Modus (welche Knöpfe sichtbar sind) früh setzen
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
