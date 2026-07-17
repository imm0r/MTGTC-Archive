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
let sb = null, USER = null;

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

async function findByCode(code, num, lang, isToken) {
  const n = String(num).replace(/^0+/, "") || "0";   // führende Nullen ergeben 404
  const base = code.toLowerCase();
  // Achtung: "mkm/8" und "tmkm/8" existieren beide und sind verschiedene
  // Karten. Das T-Zeichen auf der Karte entscheidet, welche gemeint ist.
  const codes = [...new Set(isToken ? ["t" + base, base] : [base, "t" + base])];
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

/* Verkleinern vor dem Versand: Ein 12-Megapixel-Handyfoto kostet ein
   Vielfaches an Tokens, ohne dass der Aufdruck dadurch lesbarer würde. */
function toJpegBase64(img, maxEdge = 1400, quality = 0.85) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  const cx = cv.getContext("2d");
  cx.imageSmoothingQuality = "high";
  cx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", quality).split(",")[1];
}

let visionAus = false;   // nach einem harten Fehler nicht bei jeder Karte erneut versuchen

async function readWithVision(img) {
  if (visionAus) return null;
  const { data, error } = await sb.functions.invoke("scan-card", {
    body: { image_b64: toJpegBase64(img), media_type: "image/jpeg" },
  });
  if (error) {
    // 404 = Funktion nicht ausgerollt, 500 = Schlüssel fehlt. Beides ändert
    // sich nicht von allein, also für diese Sitzung abschalten.
    const s = error.context?.status;
    if (s === 404 || s === 500) {
      visionAus = true;
      toast("Bilderkennung nicht verfügbar — weiter mit Texterkennung");
    }
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

/* Erwartet zwei Zeilen wie "0008/013 T" und "MKM • DE". Der Trennpunkt wird
   von der Erkennung gern als *, . oder ° gelesen, die Null als O. */
function parseCorner(text) {
  const T = text.toUpperCase().replace(/[|]/g, " ");
  const code = T.match(/\b([A-Z0-9]{3,5})\s*[•·*.,°\-]\s*([A-Z]{2})\b/);
  const numT = T.match(/\b(\d{1,4})\s*\/\s*\d{1,4}\s*([A-Z])?/) || T.match(/\b(\d{2,4})\b/);
  if (!code || !numT) return null;
  return {
    set: code[1],
    lang: code[2].toLowerCase(),
    num: numT[1],
    // Der Buchstabe hinter der Nummer ist die Seltenheit; T steht für Token.
    token: (numT[2] || "") === "T" || /\bT\b/.test(T.split("\n")[0] || "")
  };
}

const candidates = text => text.split("\n")
  .map(l => l.replace(/[^A-Za-zÀ-ÿ0-9',\- ]/g, " ").replace(/\s+/g, " ").trim())
  .filter(l => l.length >= 3 && /[A-Za-z]{3}/.test(l))
  .slice(0, 6);

async function identify(img, lang, onStep) {
  let firstGuess = "", best = [];

  // 1. Bildmodell: liest Setcode, Nummer, Sprache, Token- und Foil-Zeichen
  //    in einem Zug. Deutlich robuster bei Schräglage, Foil und winzigem
  //    Aufdruck als eine Zeichenerkennung.
  onStep("Karte wird gelesen…");
  try {
    const v = await readWithVision(img);
    if (v) {
      // Die vom Modell gelesene Sprache schlägt die Voreinstellung — auf
      // der Karte steht, was sie ist.
      const l = v.lang || lang;
      if (v.set_code && v.collector_number) {
        onStep(`Suche ${v.set_code} #${v.collector_number}${v.is_token ? " (Token)" : ""}…`);
        const hit = await findByCode(v.set_code, v.collector_number, l, v.is_token);
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

async function scanFile(file) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `<img class="thumb" src="${URL.createObjectURL(file)}" alt="">
    <div class="body"><div class="title">Wird verarbeitet…</div>
    <div class="meta" data-step>Bild wird geladen…</div>
    <div class="bar"><i style="width:15%"></i></div></div>`;
  $("#queue").prepend(el);
  const step = t => { const n = el.querySelector("[data-step]"); if (n) n.textContent = t; };
  const prog = p => { const n = el.querySelector(".bar i"); if (n) n.style.width = p + "%"; };

  try {
    const img = await loadImg(file);
    prog(35);
    // Sprache jetzt festhalten: der Nutzer kann das Feld umstellen,
    // während dieser Scan noch läuft.
    const lang = $("#d-lang").value;
    const r = await identify(img, lang, s => { step(s); prog(70); });
    prog(100);
    if (r.card) {
      // Nur übernehmen, was das Modell wirklich gesehen hat.
      await addToCollection(r.card, el, r.vision
        ? { lang: r.lang, is_foil: r.vision.is_foil }
        : null);
    } else renderManual(el, r.guess, r.candidates);
  } catch (e) {
    el.querySelector(".body").innerHTML =
      `<div class="title">Fehlgeschlagen</div>
       <div class="meta"><span class="pill err">${esc(e.message)}</span></div>`;
  }
}

/* detected: was das Bildmodell auf der Karte gesehen hat. Es schlägt die
   Dropdowns — auf der Karte steht, was sie ist. Der Zustand bleibt beim
   Dropdown: den sieht man einem Foto nicht zuverlässig an. */
async function addToCollection(card, el, detected) {
  const lang = detected?.lang || $("#d-lang").value;
  const cond = $("#d-cond").value;
  const foil = detected?.is_foil ?? ($("#d-foil").value === "1");
  const price = priceOf(card, foil);
  const before = CARDS.find(c => c.scryfall_id === card.id && c.foil === foil &&
                                 c.lang === lang && c.condition === cond);

  const { data, error } = await sb.rpc("add_card", {
    p_scryfall_id: card.id, p_oracle_id: card.oracle_id, p_name: card.name,
    p_printed_name: card.printed_name || null,
    p_set_code: (card.set || "").toUpperCase(), p_set_name: card.set_name,
    p_cn: card.collector_number, p_img: imgOf(card),
    p_cm_id: card.cardmarket_id ?? null,
    p_lang: lang, p_condition: cond, p_foil: foil, p_price: price
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
      links auf der Karte, z. B. <code>MKM 8</code> — bei einem Token mit <code>T</code> dahinter.</p>`;

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
      // "MKM 8", "mkm/8 T" oder "TMKM 8": Eingabe von Setcode und Nummer,
      // wie sie unten links auf der Karte stehen.
      const m = v.match(/^([a-z0-9]{3,5})[\s\-\/·•]+(\d{1,4})\s*(t)?$/i);
      const card = m
        ? await findByCode(m[1], m[2], $("#d-lang").value, !!m[3])
        : null;
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

function filtered() {
  const q = $("#q").value.trim().toLowerCase();
  const fs = $("#f-set").value, ff = $("#f-foil").value;
  return CARDS.filter(c =>
    (!q || c.name.toLowerCase().includes(q) || c.disp.toLowerCase().includes(q) ||
           (c.set_name || "").toLowerCase().includes(q)) &&
    (!fs || c.set === fs) &&
    (ff === "" || String(c.foil ? 1 : 0) === ff)
  ).sort((a, b) => {
    const g = c => sortKey === "value" ? (c.price || 0) * c.qty : c[sortKey];
    const x = g(a), y = g(b);
    if (typeof x === "string") return x.localeCompare(y) * sortDir;
    return ((x ?? 0) - (y ?? 0)) * sortDir;
  });
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

function renderCollection() {
  const rows = filtered();
  $("#s-total").textContent = CARDS.reduce((s, c) => s + c.qty, 0);
  $("#s-uniq").textContent  = new Set(CARDS.map(c => c.oracle_id)).size;
  $("#s-val").textContent   = eur(CARDS.reduce((s, c) => s + (c.price || 0) * c.qty, 0));
  $("#s-foil").textContent  = CARDS.filter(c => c.foil).reduce((s, c) => s + c.qty, 0);

  const sets = [...new Set(CARDS.map(c => c.set))].filter(Boolean).sort();
  const cur = $("#f-set").value;
  $("#f-set").innerHTML = '<option value="">Alle</option>' +
    sets.map(s => `<option value="${esc(s)}"${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");

  $("#coll-empty").textContent = CARDS.length
    ? "Keine Karte passt zu diesem Filter."
    : "Noch keine Karten. Fotografiere deine erste Karte im Tab „Scannen“.";
  $("#coll-empty").style.display = rows.length ? "none" : "block";
  $("#tbl").style.display = rows.length ? "" : "none";

  $("#tbl tbody").innerHTML = rows.map(c => `
    <tr data-id="${c.id}">
      <td class="hide-s">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : ""}</td>
      <td><div>${esc(c.disp)}</div>
          <div style="font-size:12px;color:var(--dim)">
            ${c.printed_name && c.printed_name !== c.name ? esc(c.name) + " &middot; " : ""}
            ${c.foil ? '<span class="pill foil">Foil</span> ' : ""}#${esc(c.cn)}</div></td>
      <td class="hide-s">${esc(c.set_name || c.set || "")}</td>
      <td class="hide-s">${esc((c.lang || "").toUpperCase())}</td>
      <td class="hide-s">${esc(c.condition || "")}</td>
      <td class="num"><input type="number" min="0" value="${c.qty}" data-qty
             style="width:62px;padding:4px 6px;text-align:right"></td>
      <td class="num">${eur(c.price)} ${spark(c.hist)}</td>
      <td class="num">${eur(c.price == null ? null : c.price * c.qty)}</td>
      <td class="num">${cmLink(c.cm_id)
        ? `<a class="cm" href="${esc(cmLink(c.cm_id))}" target="_blank" rel="noopener noreferrer"
             title="Angebote auf Cardmarket ansehen">CM</a>` : ""}</td>
      <td class="num"><button class="btn ghost sm" data-del>&times;</button></td>
    </tr>`).join("");

  $$("#tbl tbody [data-qty]").forEach(inp => inp.onchange = async () => {
    const id = inp.closest("tr").dataset.id;
    const q = Math.max(0, parseInt(inp.value) || 0);
    try {
      const { error } = q === 0
        ? await sb.from("cards").delete().eq("id", id)
        : await sb.from("cards").update({ qty: q }).eq("id", id);
      if (error) throw error;
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); }
  });
  $$("#tbl tbody [data-del]").forEach(b => b.onclick = async () => {
    try {
      const { error } = await sb.from("cards").delete().eq("id", b.closest("tr").dataset.id);
      if (error) throw error;
      await reload(); renderAll(); toast("Karte entfernt");
    } catch (e) { toast(dbErr(e)); }
  });
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
      if (error) failed++;
    }
  }
  try { await reload(); renderAll(); } catch (e) { toast(dbErr(e)); }
  btn.disabled = false; btn.textContent = "Preise aktualisieren";
  toast(failed ? `Preise aktualisiert, ${failed} nicht abrufbar` : "Preise aktualisiert");
}

/* ============================= Decks-Ansicht ========================== */
function renderDecks() {
  if (!DECKS.length) {
    $("#deck-list").innerHTML = '<div class="card"><div class="empty">Noch keine Decks angelegt.</div></div>';
    return;
  }
  $("#deck-list").innerHTML = DECKS.map(d => {
    const rows = d.entries.map(e => {
      const c = CARDS.find(x => x.id === e.cardId);
      if (!c) return "";
      const short = c.qty < e.qty;
      return `<tr>
        <td>${esc(c.disp)} ${c.foil ? '<span class="pill foil">Foil</span>' : ""}</td>
        <td class="hide-s">${esc(c.set || "")}</td>
        <td class="num">${e.qty}&times;</td>
        <td class="num">${short ? `<span class="pill err">${e.qty - c.qty} fehlen</span>`
                                : '<span class="pill ok">vorhanden</span>'}</td>
        <td class="num"><button class="btn ghost sm" data-dd="${d.id}" data-cc="${c.id}">&times;</button></td>
      </tr>`;
    }).join("");
    const n = d.entries.reduce((s, e) => s + e.qty, 0);
    const v = d.entries.reduce((s, e) =>
      s + (CARDS.find(x => x.id === e.cardId)?.price || 0) * e.qty, 0);
    return `<div class="card">
      <div class="row" style="align-items:center">
        <div><h3 style="margin:0">${esc(d.name)}</h3>
          <div class="hint" style="margin:2px 0 0">${n} Karten &middot; ${eur(v)}</div></div>
        <div style="flex:none"><button class="btn danger sm" data-dx="${d.id}">Deck löschen</button></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="sugg"><input type="text" data-dadd="${d.id}" placeholder="Karte aus der Sammlung hinzufügen…"></div>
        <div style="flex:none;min-width:80px"><input type="number" min="1" value="1" data-dqty="${d.id}"></div>
      </div>
      ${rows ? `<table style="margin-top:10px"><tbody>${rows}</tbody></table>`
             : '<div class="empty">Noch keine Karten in diesem Deck.</div>'}
    </div>`;
  }).join("");

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
  $$("[data-dd]").forEach(b => b.onclick = async () => {
    try {
      const { error } = await sb.from("deck_entries").delete()
        .eq("deck_id", b.dataset.dd).eq("card_id", b.dataset.cc);
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
  const head = ["Name", "Name (englisch)", "Set", "Set-Code", "Nummer", "Sprache",
                "Zustand", "Foil", "Anzahl", "Preis EUR", "Wert EUR"];
  const rows = CARDS.map(c => [c.disp, c.name, c.set_name, c.set, c.cn, c.lang, c.condition,
    c.foil ? "ja" : "nein", c.qty, c.price ?? "",
    c.price == null ? "" : (c.price * c.qty).toFixed(2)]);
  download(`mtg-sammlung-${today()}.csv`,
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
        p_foil: !!c.foil, p_price: c.price ?? null
      });
      if (error) { bad++; break; } else ok++;
    }
  }
  await reload(); renderAll();
  toast(bad ? `${ok} Karten eingespielt, ${bad} fehlgeschlagen` : `${ok} Karten eingespielt`);
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
  $("#who").textContent = USER?.email || "";
}

async function afterLogin(user) {
  USER = user;
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

function wireApp() {
  $$("nav button[data-v]").forEach(b => b.onclick = () => {
    $$("nav button[data-v]").forEach(x => x.classList.toggle("on", x === b));
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
  });

  $("#drop").onclick = () => $("#file").click();
  $("#file").onchange = e => { [...e.target.files].forEach(scanFile); e.target.value = ""; };
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
  $$("#tbl th[data-s]").forEach(th => th.onclick = () => {
    sortDir = (sortKey === th.dataset.s) ? -sortDir : 1;
    sortKey = th.dataset.s; renderCollection();
  });

  $("#deck-add").onclick = async () => {
    const name = $("#deck-name").value.trim();
    if (!name) return toast("Bitte einen Decknamen eingeben");
    try {
      const { error } = await sb.from("decks").insert({ name });
      if (error) throw error;
      $("#deck-name").value = "";
      await reload(); renderAll();
    } catch (e) { toast(dbErr(e)); }
  };

  $("#ex-json").onclick = () => download(`mtg-sicherung-${today()}.json`,
    JSON.stringify({ v: 2, exported: new Date().toISOString(), cards: CARDS, decks: DECKS }, null, 1),
    "application/json");
  $("#ex-csv").onclick = exportCsv;
  $("#im-json").onclick = () => $("#im-file").click();
  $("#im-file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await importJson(f); } catch (err) { toast("Import fehlgeschlagen: " + err.message); }
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
