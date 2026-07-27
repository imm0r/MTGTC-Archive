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

/* App-Version aus <meta name="app-version"> in index.html, nach Semantic
   Versioning (Major.Minor.Patch — siehe README). Hier wird sie nur angezeigt.

   Früher stand hier der Cache-Buster ?v= des eigenen <script>-Tags. Das war
   bequem, aber falsch: ?v= wandert je Datei einzeln, damit Browser genau die
   geänderte Datei neu holen. Eine reine CSS-Korrektur hätte app.js also nicht
   angefasst — und die Anzeige wäre stehengeblieben, obwohl eine Fehlerbehebung
   ausgeliefert wurde.

   Nur wohlgeformte Angaben werden übernommen. Steht dort Unsinn oder fehlt das
   Element, bleibt die Version leer, und die Anzeige lässt die Zeile weg
   (zeigeKopfVersion). Lieber gar keine Version als eine erfundene.

   Der Ausdruck bildet Semver genau ab: höchstens EIN Vorabteil (-alpha.1) und
   danach höchstens EIN Bauteil (+abc). Ein wiederholbares ([-+]…)* wäre nicht
   nur falsch — es ließe 1.0.0-a+b-c+d durchgehen —, sondern gefährlich: die
   Zeichenklasse enthält selbst ein „-", also dasselbe Zeichen, mit dem die
   Gruppe beginnt. Bei „9.9.9+" gefolgt von vielen „--" kann die Engine jedes
   Zeichen auf zwei Arten zuordnen, und die Laufzeit wächst exponentiell (bei
   22 Wiederholungen gemessene 11,9 s statt Mikrosekunden). Hier trennt jedes
   Zeichen die beiden Teile eindeutig, es gibt nichts zurückzuverfolgen. */
const APP_VERSION = (() => {
  try {
    const v = document.querySelector('meta[name="app-version"]')?.content?.trim() || "";
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v) ? v : "";
  } catch { return ""; }
})();

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}
/* Meldung für ein erreichtes Stundenkontingent. Die Funktion schickt den
   Freigabezeitpunkt roh mit; in die lokale Uhrzeit rechnet ihn der Browser —
   der Server steht auf UTC und kennt die Zeitzone des Aufrufers nicht. */
function limitMeldung(ctx) {
  const z = Date.parse(ctx?.reset_at);
  if (!Number.isFinite(z)) return t("quota.reached");
  return t("quota.reachedAt", {
    zeit: new Date(z).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" }),
  });
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

/* ------------------------------------------- Eigener Zahlen-Steller ---
   Jedes Zahlenfeld bekommt eine Hülle und darin zwei eigene Pfeile; die CSS
   dazu hängt an .num-wrap. Die Browser-Pfeile sind ein Fremdkörper, dessen
   Form sich nicht gestalten lässt — nur wegnehmen und selbst zeichnen hilft.

   Die Breite wandert vom Feld auf die Hülle. Ohne das säße der Steller am
   rechten Rand der Hülle statt am rechten Rand des Feldes: die schmalen
   Mengenfelder der Tabelle tragen ihre 54 px als Inline-Angabe, die Hülle
   hingegen ist von Haus aus 100 % breit.

   Idempotent über data-num-fertig — die Funktion darf beliebig oft über
   denselben Baum laufen. */
function zahlenfelderAufwerten(root = document) {
  root.querySelectorAll("input[type=number]:not([data-num-fertig])").forEach(inp => {
    inp.dataset.numFertig = "1";
    const huelle = document.createElement("span");
    huelle.className = "num-wrap";
    if (inp.style.width) { huelle.style.width = inp.style.width; inp.style.width = ""; }
    inp.replaceWith(huelle);
    huelle.appendChild(inp);
    // Den Platz für den Steller inline freihalten. Aus dem Stylesheet allein
    // reicht es nicht: mehrere Felder bringen ihr Polster als Kurzform im
    // style-Attribut mit (cardRow: padding:4px 6px), und die schlägt jede
    // Regel. Die Breite kommt aus der CSS-Variablen, damit sie nur an einer
    // Stelle steht.
    inp.style.paddingRight = "calc(var(--num-step-breite) + 5px)";
    // aria-hidden und tabindex -1: die Pfeile sind reine Mausbedienung. Über
    // die Tastatur zählt das Feld selbst hoch und runter, ein zweiter Weg
    // dorthin wäre für Screenreader und Tabulator nur Ballast.
    huelle.insertAdjacentHTML("beforeend",
      `<span class="num-step" aria-hidden="true">
         <button type="button" tabindex="-1" data-num="1">&#9650;</button>
         <button type="button" tabindex="-1" data-num="-1">&#9660;</button>
       </span>`);
  });
}

/* Einmal verdrahten: Klicks auf die Pfeile (delegiert, die Felder entstehen
   ja bei jedem Neuzeichnen neu) und ein Beobachter, der neue Zahlenfelder
   aufwertet. Der Beobachter statt Aufrufen in jeder Render-Funktion: es gibt
   zwölf Zahlenfelder in sieben davon, und ein vergessener Aufruf fiele erst
   auf, wenn jemand das Feld sucht. Seine eigenen Einfügungen lösen ihn zwar
   erneut aus, aber der zweite Durchlauf findet nichts mehr und endet. */
function wireZahlenfelder() {
  // Nur einmal, wie initTooltip. Ein zweiter Aufruf hinge einen zweiten
  // Klick-Horcher an — jeder Pfeil zählte dann zwei Schritte auf einmal und
  // schriebe zweimal in die Datenbank.
  if (wireZahlenfelder._steht) return;
  wireZahlenfelder._steht = true;

  document.addEventListener("click", e => {
    const b = e.target.closest?.(".num-step button[data-num]");
    if (!b) return;
    const inp = b.closest(".num-wrap")?.querySelector("input[type=number]");
    if (!inp || inp.disabled || inp.readOnly) return;
    // stepUp/stepDown achten von sich aus auf min, max und step — deshalb sie
    // und keine eigene Rechnung. Bei leerem oder unlesbarem Feld werfen sie;
    // dann bleibt es eben stehen.
    try { (+b.dataset.num > 0 ? inp.stepUp() : inp.stepDown()); }
    catch { return; }
    // Von Hand ausgelöst: stepUp/stepDown melden nichts von selbst, und die
    // Mengenfelder speichern auf change.
    inp.dispatchEvent(new Event("input",  { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  });

  zahlenfelderAufwerten();
  let geplant = false;
  new MutationObserver(() => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; zahlenfelderAufwerten(); });
  }).observe(document.body, { childList: true, subtree: true });
}

/* ============================== Supabase ============================== */
let sb = null, USER = null, PROFILE = null;
let FLAGS = {}, IS_ADMIN = false;   // globale Feature-Schalter + ob der Nutzer Admin ist
// Was für DIESE Person gilt: global Eingeschaltetes plus die persönlichen
// Freigaben, zusammengeführt von effective_features(). Dieselbe Abfrage stellt
// die Edge Function — hier steht sie nur, damit die Oberfläche weiß, was sie
// anzeigen darf. Entschieden wird serverseitig.
let FEATURES = new Set();
const hatFeature = k => FEATURES.has(k);
/* Zeigt diese Person Prüfergebnisse? Nur wer eines der Verfahren freigeschaltet
   hat, soll verworfene Begründungen samt Grund sehen — das ist die Arbeit der
   Tester. Für alle anderen verschwindet eine unbelegte Begründung wortlos. */
const zeigtPruefung = () => hatFeature("verify_cite") || hatFeature("verify_model");
let AI_LIMITS = {};                 // Stundenkontingente je KI-Funktion (0 = unbegrenzt)
let COMMUNITY_STATS = null, COMMUNITY_FEED = [], communityChannel = null;
let COMMUNITY_HIGHLIGHTS = null;

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
/* Wahr, solange public.deck_categories in dieser Datenbank fehlt (Schema noch
   nicht nachgezogen). Die App läuft dann vollständig weiter, nur ohne eigene
   Kategorien — gemeldet wird es dort, wo man sie sucht, statt beim Start. */
let DECK_KAT_TABELLE_FEHLT = false;

async function reload() {
  // Ausdrücklich auf die EIGENEN Zeilen filtern. Seit dem Freunde-Feature
  // erlaubt die RLS auch das Lesen geteilter Freundes-Decks/-Karten — die
  // dürfen hier aber nicht in die eigene Sammlung/Deckliste sickern. Fremdes
  // wird nur gezielt beim Ansehen eines Freundes geladen.
  const [c, d, e, k, z] = await Promise.all([
    sb.from("cards").select("*").eq("user_id", USER.id).order("name"),
    sb.from("decks").select("*").eq("user_id", USER.id).order("created"),
    sb.from("deck_entries").select("*").eq("user_id", USER.id),
    // Eigene Deck-Kategorien. Zweite Sortierung nach created: bei gleichem pos
    // (frisch angelegt, noch nicht sortiert) soll die Reihenfolge wenigstens
    // stabil sein und nicht bei jedem Laden springen.
    sb.from("deck_categories").select("*").eq("user_id", USER.id)
      .order("pos").order("created"),
    // Die Zuordnungen Karte → Kategorie. Eine Karte darf in mehreren stehen,
    // genau eine davon ist die primäre.
    sb.from("deck_entry_categories").select("*").eq("user_id", USER.id)
  ]);
  for (const r of [c, d, e]) if (r.error) throw r.error;
  // Die Kategorien werden NICHT mitgeworfen: Wer das Schema noch nicht
  // nachgezogen hat, soll seine Sammlung trotzdem sehen. Fehlt eine der beiden
  // Tabellen, bleibt es bei der Gruppierung nach Kartentyp, und der erste
  // Versuch, etwas einzuordnen, sagt in Klartext, was zu tun ist.
  DECK_KAT_TABELLE_FEHLT = !!(k.error || z.error);
  const kats = k.error ? [] : k.data;
  // Zuordnungen einmal nach "Deck|Karte" bündeln, statt sie je Eintrag erneut
  // zu durchsuchen — bei 30 Decks à 100 Karten wäre das sonst eine Suche über
  // Tausende Zeilen je Eintrag.
  const zuord = new Map();
  for (const x of (z.error ? [] : z.data)) {
    const s = x.deck_id + "|" + x.card_id;
    if (!zuord.has(s)) zuord.set(s, []);
    zuord.get(s).push({ id: x.category_id, primaer: !!x.is_primary });
  }
  // disp = was auf der Karte steht; name bleibt der englische Name, unter
  // dem man die Karte überall sonst wiederfindet.
  CARDS = c.data.map(x => ({ ...x, set: x.set_code, disp: x.printed_name || x.name }));
  DECKS = d.data.map(dk => ({ ...dk,
    entries: e.data.filter(en => en.deck_id === dk.id)
                   .map(en => ({ cardId: en.card_id, qty: en.qty,
                                 kats: zuord.get(dk.id + "|" + en.card_id) || [] })),
    kategorien: kats.filter(x => x.deck_id === dk.id) }));

  // Preisarchiv für neu dazugekommene Karten nachladen. Das lief früher nur
  // EINMAL beim Start — eine während der Sitzung erfasste Karte fragte das
  // Archiv also nie ab und zeigte bis zum nächsten Start nur die eigene
  // Vorwärts-Historie, selbst wenn die 90 Tage längst dort lagen (weil ein
  // anderer Nutzer die Karte schon hatte). Hier ist die einzige Stelle, an der
  // CARDS neu befüllt wird, also deckt der Aufruf jeden Weg ab: Scan,
  // Handeingabe, Import, Deck-Übernahme.
  //
  // Billig bei jedem Aufruf: ladePreisHistorie fragt nur scryfall_id ab, die
  // es noch nicht kennt, und kehrt sofort zurück, wenn nichts übrig bleibt.
  // Bewusst ohne await — die Sammlung soll nicht auf das Archiv warten.
  ladePreisHistorie().catch(() => {});
}

/* ============================== Scryfall ============================== */
/* Scryfall bittet um max. ~10 Anfragen/Sekunde. Alle Aufrufe laufen daher
   durch diese Warteschlange, die 120 ms Abstand erzwingt. */
const sf = (() => {
  let chain = Promise.resolve(), last = 0;
  // Geduldsgrenze je Abruf. Gemessener Anlass: /cards/search antwortete für
  // manche Anfragen erst nach 30 s (teils mit 503), während die Punktzugriffe
  // /cards/<set>/<nr> in 200–500 ms zurückkamen. Ohne Grenze hängt daran die
  // ganze Warteschlange — und mit ihr ein Zieh-Import, der längst hätte
  // weiterlaufen können. Lieber ein abgebrochener Weg als eine Oberfläche,
  // die minutenlang steht: Jeder Aufrufer behandelt null/Fehler ohnehin.
  const GEDULD_MS = 7000;
  const run = async (path, init) => {
    const wait = 120 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const stop = new AbortController();
    const uhr = setTimeout(() => stop.abort(), GEDULD_MS);
    let r;
    try { r = await fetch("https://api.scryfall.com" + path, { ...init, signal: stop.signal }); }
    catch (e) {
      throw new Error(stop.signal.aborted ? "Scryfall antwortet nicht" : e.message);
    } finally { clearTimeout(uhr); }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Scryfall HTTP " + r.status);
    return r.json();
  };
  const getInit = { headers: { Accept: "application/json" } };
  const get = path => (chain = chain.then(() => run(path, getInit), () => run(path, getInit)));
  // Gleiche Warteschlange (Scryfall bittet um ~10 Anfragen/Sekunde) auch für
  // POST — z. B. /cards/collection zum Sammel-Nachladen der Farbidentität.
  get.post = (path, body) => {
    const init = { method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body) };
    return (chain = chain.then(() => run(path, init), () => run(path, init)));
  };
  return get;
})();

const sfNamed = name => sf("/cards/named?fuzzy=" + encodeURIComponent(name));
// encodeURIComponent auch hier: seit dem Zieh-Import kann die ID aus einer
// fremden Adresse stammen, und unkodiert könnte sie den Pfad verlassen
// („../…"). Für die ohnehin gültigen UUIDs ändert die Kodierung nichts.
const sfById  = id   => sf("/cards/" + encodeURIComponent(id));

/* Sammel-Abruf mehrerer Karten über ihre scryfall_id (max. 75 je Aufruf).
   Scryfalls /cards/collection liefert die vollen Kartenobjekte auf einen
   Schlag — viel sparsamer als 75 Einzelabrufe. */
async function sfCollection(ids) {
  const r = await sf.post("/cards/collection", { identifiers: ids.map(id => ({ id })) });
  return r?.data || [];
}

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
    const exact = hits.find(c => norm(printedNameOf(c)) === norm(t));
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
  const exact = hits.find(c => norm(c.name) === norm(t) || norm(printedNameOf(c)) === norm(t));
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
  return hits.map(c => {
    const gedruckt = printedNameOf(c);
    return {
      label: (gedruckt || c.name) + (gedruckt ? ` — ${c.name}` : ""),
      value: gedruckt || c.name
    };
  });
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
      // Landessprachige Fassung je Seite. Führt Scryfall nur bei
      // fremdsprachigen Drucken; bei englischen bleiben beide null.
      printed_type_line: x.printed_type_line ?? null,
      printed_text: typeof x.printed_text === "string" ? x.printed_text : null,
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

/* Passt der über den Eckcode gefundene Treffer zum abgelesenen Kartennamen?
   Der Treffer trägt den englischen (name) und ggf. den gedruckten Namen
   (printed_name); der abgelesene Name kann in jeder Sprache sein. Verglichen
   wird normalisiert und beidseitig teilstring-tolerant (gegen kleine Lese-
   fehler und Teilnamen); zweiseitige Karten ("A // B") zählen je Seite. Ohne
   abgelesenen Namen gibt es nichts zu prüfen → true, der Eckcode bleibt
   maßgeblich. Zweck: einen Eckcode-Falschtreffer (misslesener Set/Nummer trifft
   eine fremde Karte) verwerfen, damit stattdessen der Namensweg greift. */
function nameHitMatchesRead(hit, readName) {
  const rn = norm(readName);
  if (!rn) return true;
  for (const raw of [printedNameOf(hit), hit?.name]) {
    if (!raw) continue;
    for (const teil of String(raw).split("//")) {
      const hn = norm(teil);
      if (hn && (hn === rn || hn.includes(rn) || rn.includes(hn))) return true;
    }
  }
  return false;
}

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
      // Sprache der Karte in dieser Reihenfolge: der gedruckte Eckcode, sofern
      // parseCorner ihn sicher gelesen hat; sonst die vom Modell gemeldete
      // Sprache (aus Name/Regeltext bestimmt, für gemischtsprachige Fotos der
      // entscheidende Fallback); zuletzt die Dropdown-Voreinstellung. sprachCode
      // übersetzt den gedruckten Code (DE→de, JP→ja) und filtert Unbekanntes.
      const l = c?.lang || sprachCode(v.lang) || lang;
      if (c) {
        // Die Typzeile ist ein zweiter, unabhängiger Token-Hinweis: steht dort
        // "Spielsteinkreatur", ist es eines, auch wenn das winzige T entging.
        const token = c.token || /spielstein|\btoken\b|emblem/i.test(v.type_line || "");
        onStep(t("scan.searchingCode", { set: c.set, num: c.num, token: token ? t("scan.tokenSuffix") : "" }));
        const hit = await findByCode(c.set, c.num, l, token);
        // Der Eckcode ist verlässlich — WENN die Ecke stimmt. Ein misslesener
        // Setcode oder eine misslesene Nummer trifft aber leicht eine ganz
        // ANDERE existierende Karte (real beobachtet: Rußbolds Ecke landete auf
        // Sorin, MH3 #245). Ein solcher Falschtreffer würde den korrekt
        // gelesenen Namen überstimmen. Deshalb gegenprüfen: Passt der Name des
        // Treffers nicht zum abgelesenen Namen, war die Ecke wohl falsch — dann
        // NICHT zurückgeben, sondern unten über den Namen weitersuchen (der
        // findet die Karte, sofern der Name gelesen wurde). Ohne gelesenen Namen
        // gibt es nichts gegenzuprüfen, dann bleibt der Eckcode maßgeblich —
        // das betrifft eine MODERNE Karte, deren Titel unlesbar war, NICHT alte
        // Karten: Karten ohne Setcode/Sammlernummer (vor Exodus/Tempest und in
        // der Nummern-Lücke ~2000–2014, z. B. Rußbold) erreichen findByCode nie,
        // weil parseCorner dort null liefert und der Namensweg allein greift.
        if (hit && nameHitMatchesRead(hit, v.printed_name))
          return { card: hit, guess: printedNameOf(hit) || hit.name, candidates: [], vision: v, lang: l };
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
      if (hit) return { card: hit, guess: printedNameOf(hit) || hit.name, candidates: [] };
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

/* Erkannten Treffer sofort in die Sammlung schreiben — oder erst bestätigen
   lassen? Gerätelokal (localStorage). Vorgabe: bestätigen. Die Bilderkennung
   liest sehr gut, trifft aber nicht jede Karte; eine falsch erkannte gehört
   nicht ungefragt in die Sammlung, sondern vor dem Schreiben korrigiert. Wer
   der Erkennung vertraut, schaltet das direkte Übernehmen im Scan-Bereich ein. */
function autoUebernehmen() { return localStorage.getItem("mtg-scan-auto") === "1"; }
function autoUebernehmenSetzen(an) { localStorage.setItem("mtg-scan-auto", an ? "1" : "0"); }

/* Ein Job in der Warteschlange: identifizieren und Ergebnis anzeigen. img ist
   ein <img> ODER ein <canvas> — beide lassen sich gleich zeichnen und messen.
   Genutzt vom Einzelscan (ein Foto = eine Karte) UND vom Mehrfach-Scan (ein
   Foto = mehrere Karten, je Ausschnitt ein Aufruf hierher). */
async function scanBild(img, thumbSrc, lang, ziel) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `<img class="thumb" src="${esc(thumbSrc)}" alt="">
    <div class="body"><div class="title">${esc(t("scan.processing"))}</div>
    <div class="meta" data-step>${esc(t("scan.reading"))}</div>
    <div class="bar"><i style="width:35%"></i></div></div>`;
  (ziel || $("#queue")).prepend(el);
  const step = t => { const n = el.querySelector("[data-step]"); if (n) n.textContent = t; };
  const prog = p => { const n = el.querySelector(".bar i"); if (n) n.style.width = p + "%"; };
  try {
    const r = await identify(img, lang, s => { step(s); prog(70); });
    prog(100);
    // Nur die Sprache stammt von der Karte — Foil und Zustand bleiben beim
    // Nutzer. Standardmäßig wird der Treffer erst gezeigt und muss bestätigt
    // werden: So landet eine falsch erkannte Karte gar nicht erst in der
    // Sammlung, sondern lässt sich vorher korrigieren. Nur wer das direkte
    // Übernehmen eingeschaltet hat, schreibt sofort (der alte Weg).
    if (r.card) {
      const detected = r.vision ? { lang: r.lang } : null;
      if (autoUebernehmen()) await addToCollection(r.card, el, detected);
      else renderConfirm(r.card, el, detected);
    } else renderManual(el, r.guess, r.candidates);
  } catch (e) {
    el.querySelector(".body").innerHTML =
      `<div class="title">${esc(t("scan.failed"))}</div>
       <div class="meta"><span class="pill err">${esc(e.message)}</span></div>`;
  }
}

async function scanFile(file, ziel) {
  try {
    const img = await loadImg(file);
    await scanBild(img, URL.createObjectURL(file), $("#d-lang").value, ziel);
  } catch { toast(t("scan.imgUnreadable")); }
}

/* Bild um 0/90/180/270 Grad im Uhrzeigersinn drehen (in ein neues Canvas). Bei
   90/270 tauschen Breite und Höhe. Basis der automatischen Ausrichtung. */
function rotateCanvas(img, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return img;
  const w = img.width, h = img.height, swap = d === 90 || d === 270;
  const cv = document.createElement("canvas");
  cv.width = swap ? h : w; cv.height = swap ? w : h;
  const cx = cv.getContext("2d");
  cx.imageSmoothingQuality = "high";
  if (d === 90) { cx.translate(h, 0); cx.rotate(Math.PI / 2); }
  else if (d === 180) { cx.translate(w, h); cx.rotate(Math.PI); }
  else { cx.translate(0, w); cx.rotate(-Math.PI / 2); }   // 270
  cx.drawImage(img, 0, 0);
  return cv;
}

/* Handyfotos einer quer liegenden Kartenreihe kommen oft gedreht im Upload an
   (der Nutzer musste sie bisher von Hand 3× drehen). Ein kleiner Modell-Aufruf
   sagt, wie weit das Bild gedreht werden muss, damit die Karten aufrecht stehen
   — festgemacht am KARTENTEXT, nicht an der Bildform, damit hochkant-korrekte
   Layouts (z. B. 3 Zeilen à 2 Karten) unangetastet bei 0 bleiben. Verkleinertes
   Bild genügt, es geht nur um die Textrichtung. Fällt der Aufruf aus oder ist
   das Vision-Modell abgeschaltet, wird nicht gedreht und der Scan läuft wie
   bisher weiter — die Ausrichtung ist Komfort, kein Muss. */
async function orientImage(img) {
  if (visionAus) return img;
  const ganz = { x: 0, y: 0, w: img.width, h: img.height };
  try {
    const { data, error } = await sb.functions.invoke("scan-card", {
      body: { mode: "orient", images: [{ b64: toJpegBase64(img, ganz, 1400), media_type: "image/jpeg" }] },
    });
    if (error) return img;
    // Das Modell nennt die aktuelle Lage des Titelbalkens (top/bottom/left/right);
    // die Drehung IM UHRZEIGERSINN, die ihn nach oben bringt, folgt daraus
    // eindeutig: links → 90°, unten → 180°, rechts → 270°, oben → keine. So
    // muss das Modell die fehleranfällige Uhrzeigersinn-Richtung nicht raten.
    const grad = { left: 90, bottom: 180, right: 270 }[data?.orient?.title_side] || 0;
    return grad ? rotateCanvas(img, grad) : img;
  } catch { return img; }
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
  // Zuerst aufrichten: quer fotografierte Reihen kommen oft gedreht im Upload
  // an. Danach den leeren Rand ums Karten-Motiv wegschneiden — dann füllen die
  // Karten den Rahmen und werden im (fest verkleinerten) detect-Bild groß genug,
  // dass das Modell alle findet. Findet sich kein klarer Rand, bleibt das ganze
  // Bild. Detect UND der Zuschnitt je Karte arbeiten auf demselben aufgerichteten,
  // getrimmten Bild, damit die zurückgegebenen Rechtecke ohne Umrechnung passen.
  const aufrecht = await orientImage(img);
  const base = trimToContent(aufrecht) || aufrecht;
  let boxes;
  try { boxes = await detectCards(base); }
  catch (e) { return toast(e.message || t("scan.notFound")); }
  if (!boxes.length) return toast(t("scan.noneDetected"));
  toast(t("scan.detected", { n: boxes.length }));
  const lang = $("#d-lang").value;
  for (const box of boxes) {
    // Großzügiger Rand (12 %): die detect-Rechtecke sitzen mal etwas zu eng und
    // schneiden dann die Karte an — gerade die untere linke Ecke mit Setcode und
    // Sammlernummer, dem wichtigsten Identifier. Lieber etwas Umgebung mitnehmen;
    // die exakte Kartenlage holt findCardBounds anschließend aus dem Ausschnitt.
    // Die Karten liegen mit klaren Lücken, daher ragt der Rand kaum in Nachbarn.
    const cv = cropCanvas(base, box, 0.12);
    await scanBild(cv, cv.toDataURL("image/jpeg", 0.7), lang);
  }
}

/* Schneidet den leeren Rand rings ums Karten-Motiv weg, BEVOR das Foto zum
   detect-Modell geht. Das Bild wird dort auf eine feste Größe heruntergerechnet;
   je mehr Rand, desto kleiner die Karten darin, desto eher übersieht das Modell
   welche — ein Nutzer belegte das direkt (dasselbe Motiv mit Rand fand zwei
   Karten weniger als zugeschnitten). Wir ermitteln nur die EINE äußere Hülle des
   Inhalts: von jeder Bildkante nach innen, bis eine Zeile/Spalte nicht mehr
   gleichförmiger Hintergrund ist. Das ist robust — es entfernt nur randständige,
   gleichförmige Streifen; eine Karte bricht die Gleichförmigkeit und stoppt den
   Schnitt. Bewusst NICHT die Karten-Segmentierung aus #52: hier fällt genau ein
   Rechteck, keine Formfilter, kein Zusammenwachsen. Fällt kein klarer Rand an
   (Karte berührt die Kante) oder wäre der Schnitt unplausibel, kommt null und
   das ganze Bild geht wie bisher raus. Rückgabe: ein Canvas in Originalauflösung
   des Ausschnitts, oder null. */
function trimToContent(img) {
  const W = 320, H = Math.max(1, Math.round(img.height * (W / img.width)));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H).data;
  const lum = p => 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];

  // Hintergrund = Median der Randhelligkeit (Tisch/Papier am Bildrand).
  const rand = [];
  for (let x = 0; x < W; x++) { rand.push(lum(x)); rand.push(lum((H - 1) * W + x)); }
  for (let y = 0; y < H; y++) { rand.push(lum(y * W)); rand.push(lum(y * W + W - 1)); }
  rand.sort((a, b) => a - b);
  const bg = rand[rand.length >> 1];

  // Je Zeile/Spalte zählen, wie viele Pixel deutlich vom Rand-Hintergrund
  // abweichen. Eine Karte (Illustration, Text) liefert reichlich solche Pixel.
  const zeile = new Array(H).fill(0), spalte = new Array(W).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (Math.abs(lum(y * W + x) - bg) > 34) { zeile[y]++; spalte[x]++; }

  // Von außen nach innen bis zur ersten "Inhalts"-Zeile/Spalte (>4 % abweichend).
  const zMin = W * 0.04, sMin = H * 0.04;
  let top = 0; while (top < H && zeile[top] < zMin) top++;
  let bot = H - 1; while (bot > top && zeile[bot] < zMin) bot--;
  let left = 0; while (left < W && spalte[left] < sMin) left++;
  let right = W - 1; while (right > left && spalte[right] < sMin) right--;
  if (top >= bot || left >= right) return null;

  // Etwas Luft lassen, damit keine Kartenkante wegfällt — und damit die
  // Randkarten im getrimmten Bild noch Umgebung haben, in die der Ausschnitt
  // je Karte hineinpaddet (sonst klemmt sein Rand direkt an der Bildkante).
  const pad = 0.03;
  const x0 = Math.max(0, left / W - pad), y0 = Math.max(0, top / H - pad);
  const x1 = Math.min(1, (right + 1) / W + pad), y1 = Math.min(1, (bot + 1) / H + pad);
  const fw = x1 - x0, fh = y1 - y0;
  if (fw > 0.93 && fh > 0.93) return null;   // kaum Rand da — nichts gewonnen
  if (fw < 0.25 || fh < 0.25) return null;   // unplausibel klein — lieber ganzes Bild

  const sx = Math.round(x0 * img.width), sy = Math.round(y0 * img.height);
  const sw = Math.round(fw * img.width), sh = Math.round(fh * img.height);
  const out = document.createElement("canvas");
  out.width = sw; out.height = sh;
  out.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/* Kartenrechtecke (Anteile 0..1) für ein Foto mit mehreren Karten, über die
   "detect"-Betriebsart der Edge Function. Eine browserseitige Segmentierung
   gab es hier kurz (#52) — sie war nur an synthetischen Fotos verifiziert und
   scheiterte am ersten echten: Blatt Papier auf dunkler Couch, der Bildrand
   ist Couch, also hielt der Rand-Median das ganze Blatt für Vordergrund und
   lieferte Fragmente statt Karten. Schlimmer: weil IRGENDWAS zurückkam, kam
   der Modell-Weg nie zum Zug. Gelernt: der Bildweg kennt seine eigenen
   Grenzfälle nicht — also wieder ausschließlich das Sehmodell, dessen
   Rechtecke dedupeBoxes und je Ausschnitt findCardBounds nachschärfen.
   2400 px Kantenlänge (statt 1600): Das Foto wird für den detect-Schritt auf
   diese feste Größe heruntergerechnet — je mehr leerer Rand ums Karten-Raster,
   desto kleiner landen die Karten darin und desto eher übersieht das Modell
   welche. Ein Nutzer belegte das direkt: dasselbe Motiv einmal mit Rand (zwei
   Karten fehlten) und einmal zugeschnitten (alle acht gefunden). Höher auflösen
   macht die Karten auch im ungeschnittenen Bild groß genug; Sonnet 5
   verarbeitet bis 2576 px nativ (keine Kachelung). Die Denkschritte bleiben
   AUS — die verschlechterten die Rechtecke (#53), nicht die Auflösung. */
async function detectCards(img) {
  if (visionAus) throw new Error(t("scan.visionDisabled"));
  const ganz = { x: 0, y: 0, w: img.width, h: img.height };
  const { data, error } = await sb.functions.invoke("scan-card", {
    body: { mode: "detect", images: [{ b64: toJpegBase64(img, ganz, 2400), media_type: "image/jpeg" }] },
  });
  if (error) {
    let msg = "";
    try { msg = (await error.context.json()).error; } catch { /* kein JSON-Körper */ }
    throw new Error(msg || t("scan.detectUnreach"));
  }
  const cards = Array.isArray(data?.detect?.cards) ? data.detect.cards : [];
  const gefiltert = cards
    .map(b => ({ x: +b.x, y: +b.y, w: +b.w, h: +b.h }))
    .filter(b => [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
                 b.w > 0.03 && b.h > 0.03 && b.x >= 0 && b.y >= 0 && b.x < 1 && b.y < 1);
  return dedupeBoxes(gefiltert);
}

/* Karten liegen auf dem Foto getrennt nebeneinander. Überlappen sich zwei
   Rechtecke deutlich, ist es zweimal DIESELBE Karte — das Modell hat sie
   doppelt gefasst. Ohne diesen Schritt landet sie zweimal in der Warteschlange
   (das Doppel-Ergebnis „Wegefinder"/„Mind's Desire" aus dem Nutzer-Feedback).
   Zwei Rechtecke gelten als Dublette, wenn sie sich stark überschneiden (IoU
   über 0,5) ODER das kleinere großteils im größeren steckt (über 0,6 seiner
   Fläche) — Letzteres fängt auch versetzte oder verschachtelte Doppel-Rahmen,
   die eine reine IoU-Schwelle verfehlt. Getrennt liegende Karten überschneiden
   sich kaum (Schnittfläche ~0) und bleiben beide erhalten; das größere
   Rechteck gewinnt, die ursprüngliche Reihenfolge bleibt gewahrt. */
function dedupeBoxes(boxes) {
  const flaeche = b => b.w * b.h;
  const schnittFlaeche = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  };
  const dublette = (a, b) => {
    const s = schnittFlaeche(a, b);
    if (s === 0) return false;
    const iou = s / (flaeche(a) + flaeche(b) - s);
    const enthalten = s / Math.min(flaeche(a), flaeche(b));
    return iou > 0.5 || enthalten > 0.6;
  };
  // Greedy: nach Fläche absteigend prüfen, damit das größere Rechteck gewinnt.
  const behalten = new Set();
  for (const b of [...boxes].sort((a, c) => flaeche(c) - flaeche(a)))
    if (![...behalten].some(k => dublette(k, b))) behalten.add(b);
  return boxes.filter(b => behalten.has(b));
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

/* Was add_card nicht kennt, in einem zweiten Schreibvorgang hinterher:
   • faces          — Seiten zweiseitiger Karten (fürs Umdrehen in den Details)
   • color_identity — Grundlage des Farbidentitäts-Filters in der Sammlung
   • printed_text / printed_type_line — die gedruckte, landessprachige Fassung
   Bewusst getrennt statt als weitere RPC-Parameter: jede Erweiterung der
   add_card-Signatur zieht in Postgres ein weiteres "drop function" nach sich
   (siehe die Liste im Schema), und diese Felder sind reine Anzeige.
   Ein Fehlschlag ist gutartig — die Detailansicht fällt auf die englischen
   Felder zurück, und der nächste Preisabruf trägt es über nachtragen() nach.
   `row` ist die von add_card zurückgegebene Zeile (die RPC gibt public.cards
   zurück), `card` die Scryfall-Karte, aus der geschrieben wurde. */
async function addCardNachtrag(row, card) {
  if (!row?.id) return;
  const patch = {};
  const fc = facesOf(card);
  if (fc) patch.faces = fc;
  const ci = farbIdentOf(card);
  if (ci) patch.color_identity = ci;
  // "!= null" und nicht "truthy": '' ist ein gültiger gedruckter Text
  // (Vanilla-Kreatur), null heißt "gibt es nicht" (englische Auflage).
  const pt = printedTextOf(card);
  if (pt != null) patch.printed_text = pt;
  const pty = printedTypeOf(card);
  if (pty != null) patch.printed_type_line = pty;
  if (!Object.keys(patch).length) return;
  try { await sb.from("cards").update(patch).eq("id", row.id); }
  catch { /* Anzeige klappt auch ohne die Nachträge */ }
}

/* Die pro Karte gewählten Werte (opts) schlagen die globalen Scan-Dropdowns.
   Die Sprache steht auf der Karte; Foil und Zustand wählt man im Bestätigungs-
   schritt bewusst je Karte. Fehlt ein Wert — beim direkten Übernehmen oder aus
   der Handkorrektur wird nichts mitgegeben —, gilt die globale Voreinstellung
   aus den Dropdowns. Foil bleibt eine physische Eigenschaft, die kein Foto
   verrät (Glanz erzeugt auch jede Lampe über einer normalen Karte, und ein
   Fehlurteil legt eine eigene Zeile mit falschem Preis an): Vorgabe „Normal",
   bis der Nutzer im Dropdown etwas anderes wählt. */
async function addToCollection(card, el, opts) {
  const lang = opts?.lang || $("#d-lang").value;
  const cond = opts?.cond || $("#d-cond").value;
  const foil = opts?.foil != null ? opts.foil : $("#d-foil").value === "1";
  const price = priceOf(card, foil);
  const before = CARDS.find(c => c.scryfall_id === card.id && c.foil === foil &&
                                 c.lang === lang && c.condition === cond);

  const { data, error } = await sb.rpc("add_card", {
    p_scryfall_id: card.id, p_oracle_id: card.oracle_id, p_name: card.name,
    p_printed_name: printedNameOf(card),
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

  const row = Array.isArray(data) ? data[0] : data;
  await addCardNachtrag(row, card);

  // Neu in der Sammlung heißt womöglich: nicht mehr auf der Wunschliste. Der
  // Abgleich hängt den Deckplatz um und räumt den Platzhalter weg.
  const meldung = wunschMeldung(await reloadMitWunschAbgleich());
  renderAll();
  el.classList.remove("pending");   // war es ein bestätigter Treffer, ist er nun geschrieben
  el.querySelector(".thumb").src = imgOf(card) || el.querySelector(".thumb").src;
  const gedruckt = printedNameOf(card);
  el.querySelector(".body").innerHTML = `
    <div class="title">${esc(gedruckt || card.name)}</div>
    ${gedruckt ? `<div class="meta">${esc(card.name)}</div>` : ""}
    <div class="meta">${esc(card.set_name)} &middot; #${esc(card.collector_number)} &middot; ${eur(price)}</div>
    <div class="meta" style="margin-top:6px">
      <span class="pill ok">${before ? esc(t("common.qtyLabel")) + ": " + (row?.qty ?? "+1") : esc(t("detail.added"))}</span>
      ${foil ? '<span class="pill foil">Foil</span>' : ""}
      <span class="pill">${esc(lang.toUpperCase())}</span>${condBadge(cond)}
      <button class="btn ghost sm" data-fix style="margin-left:6px">${esc(t("scan.wrongCard"))}</button>
    </div>`;
  el.querySelector("[data-fix]").onclick = () => renderManual(el, card.name);
  // Im schwebenden Zieh-Kasten ist mit dem Schreiben alles gesagt: Kachel
  // sofort weg (der leere Kasten mit), als Quittung genügt die Toast-Zeile.
  // Selbst die fünf Sekunden Quittung aus #118 lasen sich noch als weiteres
  // Popup. Wer die falsche Karte erwischt hat, korrigiert in der Sammlung.
  // Die Scan-Warteschlange behält ihre Quittungen samt „Falsche Karte?" —
  // dort ist die Liste der Beleg über einen ganzen Stapel.
  // Bei eingeschalteter Diagnose bleibt die Kachel stehen: dort hängt gleich
  // die Aufschlüsselung, und die wäre mit der Kachel fort, bevor man sie liest.
  if (el.closest("#dropbox-list") && !ziehDiagnose()) {
    ziehKachelWeg(el);
    toast(meldung || t("drag.added", { name: gedruckt || card.name }));
  } else if (meldung) toast(meldung);
  // Die geschriebene Zeile — der Zieh-Import springt anschließend dorthin.
  return row?.id || null;
}

/* Erkannt, aber noch NICHT gespeichert. Erst zeigen, was gelesen wurde —
   mit Bild, damit es sich mit der Karte in der Hand vergleichen lässt —, dann
   erst per „Übernehmen" schreiben. Sprache, Ausführung und Zustand lassen sich
   hier je Karte anpassen (Vorauswahl: die erkannte Sprache bzw. die globalen
   Scan-Dropdowns); „Übernehmen" reicht genau diese Werte an addToCollection.
   „Falsche Karte?" führt vor dem Schreiben in die Handkorrektur, „Verwerfen"
   wirft den Treffer weg. So kommt eine falsch erkannte Karte gar nicht erst in
   die Sammlung. */
function renderConfirm(card, el, detected) {
  const lang0 = detected?.lang || $("#d-lang").value;
  const cond0 = $("#d-cond").value;
  const foil0 = $("#d-foil").value === "1";
  // Sprachliste wie im Bearbeiten-Dialog: alle geführten Sprachen, eine
  // unbekannte Vorauswahl vorneweg, damit sie nicht verlorengeht.
  const langs = LANG_NAMES[lang0] ? Object.keys(LANG_NAMES) : [lang0, ...Object.keys(LANG_NAMES)];

  el.classList.add("pending");
  el.querySelector(".thumb").src = imgOf(card) || el.querySelector(".thumb").src;
  el.querySelector(".body").innerHTML = `
    <div class="confirm">
      <div class="c-info">
        <div class="title">${esc(printedNameOf(card) || card.name)}</div>
        ${printedNameOf(card) ? `<div class="meta">${esc(card.name)}</div>` : ""}
        <div class="meta">${esc(card.set_name)} &middot; #${esc(card.collector_number)} &middot; <span data-price>${eur(priceOf(card, foil0))}</span></div>
        <div class="meta" style="margin-top:6px"><span class="pill warn">${esc(t("scan.pendingBadge"))}</span></div>
      </div>
      <div class="c-opts">
        <div><label>${esc(t("cm.language"))}</label><select data-lang>${langs.map(l =>
          `<option value="${esc(l)}"${l === lang0 ? " selected" : ""}>${esc(langName(l))}</option>`).join("")}</select></div>
        <div><label>${esc(t("cm.finish"))}</label><select data-foil>
          <option value="0"${!foil0 ? " selected" : ""}>${esc(t("cm.normal"))}</option>
          <option value="1"${foil0 ? " selected" : ""}>Foil</option></select></div>
        <div><label>${esc(t("cm.condition"))}</label><select data-cond>${CONDITION_CODES.map(x =>
          `<option value="${x}"${x === cond0 ? " selected" : ""}>${x} · ${esc(CONDITION_BY[x].name)}</option>`).join("")}</select></div>
      </div>
      <div class="c-actions">
        <button class="btn sm c-ok" data-take>${esc(t("scan.confirmAdd"))}</button>
        <button class="btn sm c-warn" data-fix>${esc(t("scan.wrongCard"))}</button>
        <button class="btn sm c-danger" data-drop>${esc(t("scan.discard"))}</button>
      </div>
    </div>`;

  const selLang = el.querySelector("[data-lang]");
  const selFoil = el.querySelector("[data-foil]");
  const selCond = el.querySelector("[data-cond]");
  // Der Preis hängt an der Ausführung — Foil kostet anders. Anzeige mitführen.
  selFoil.onchange = () => {
    const p = el.querySelector("[data-price]");
    if (p) p.textContent = eur(priceOf(card, selFoil.value === "1"));
  };
  el.querySelector("[data-take]").onclick = async () => {
    try {
      await addToCollection(card, el, {
        lang: selLang.value, cond: selCond.value, foil: selFoil.value === "1",
      });
    } catch (e) { toast(e.message); }
  };
  el.querySelector("[data-fix]").onclick = () => renderManual(el, card.name);
  el.querySelector("[data-drop]").onclick = () => ziehKachelWeg(el);
}

function renderManual(el, guess, candidates) {
  const cs = candidates || [];
  const list = cs.length ? `
    <div class="picks">${cs.map((c, i) => `
      <button class="pick" data-pick="${i}">
        ${c.image_uris?.small ? `<img src="${esc(c.image_uris.small)}" alt="" loading="lazy">` : ""}
        <span><b>${esc(printedNameOf(c) || c.name)}</b>
        ${printedNameOf(c) ? `<i>${esc(c.name)}</i>` : ""}
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

/* ==================== Karte per Ziehen übernehmen =====================
   Zwei Fenster nebeneinander: links diese App, rechts Scryfall, Cardmarket
   oder Gatherer. Das Kartenbild von dort herüberziehen — die Karte landet in
   derselben Warteschlange wie ein Scan und wird genauso bestätigt.

   Ein Bild aus einem FREMDEN Fenster kommt nicht als Datei an, sondern als
   Adresse (text/uri-list) samt HTML-Schnipsel des <img> (text/html). Genau
   darin steckt aber schon alles Nötige: Scryfall trägt die Kartenkennung im
   Dateinamen, Gatherer Setcode und Sammlernummer im Pfad, Cardmarket die
   Produktnummer. Erkannt wird deshalb NICHT das Bild, sondern die Adresse —
   ohne Modellaufruf, ohne Ratequote, und die Auflage stimmt auf Anhieb statt
   nur der Name. Erst wenn keine Adresse trägt, zählt der Name aus alt/title
   des Bildes oder der mitgezogene Text; das ist derselbe Namensweg wie in der
   Handkorrektur, mit Auswahlliste bei Mehrdeutigkeit.

   Die Bildpixel rührt dieser Weg nie an. Ein Herunterladen des fremden Bildes
   scheitert ohnehin meist an CORS, und die Bilderkennung darauf loszulassen
   würde KI-Kontingent für eine Frage verbrauchen, die die Adresse längst
   beantwortet. */

/* Sprachen, die Scryfall in seinen Adressen führt. Gebraucht, um in
   /card/<set>/<nr>/<x> zu entscheiden, ob <x> die Sprache ist oder schon der
   Namensteil ("…/8/de/mord-im-hause-karlov" gegen "…/8/anzrag"). */
const SF_URL_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "ja", "ko",
                              "ru", "zhs", "zht", "he", "la", "grc", "ar", "sa", "ph"]);

/* Gatherers Gebietsschema (en-us, de-de, zh-tw …) auf Scryfalls Sprachkürzel.
   Chinesisch ist der einzige Fall, in dem die ersten zwei Zeichen nicht
   reichen: Scryfall trennt vereinfacht (zhs) und traditionell (zht). */
function gathererLang(gebiet) {
  const g = String(gebiet || "").toLowerCase();
  if (g.startsWith("zh")) return /tw|hant|hk/.test(g) ? "zht" : "zhs";
  const zwei = g.slice(0, 2);
  return SF_URL_LANGS.has(zwei) ? zwei : "en";
}

/* Cardmarket schreibt Namen in seine Adressen mit Bindestrich statt Leerzeichen
   und hängt bei mehreren Motiven derselben Karte eine Fassung an ("Forest-V3").
   Beides zurückdrehen; die Bindestriche echter Namen ("Quake-Mole") schadet das
   nicht, weil Scryfalls unscharfe Namenssuche darüber hinwegsieht. */
const cmSlugName = s => String(s || "").replace(/-V\d+$/i, "").replace(/[-_]+/g, " ")
  .replace(/\s+/g, " ").trim();

/* Die Fassungsnummer aus einem Cardmarket-Slug („Anzrag-the-Quake-Mole-V2").
   Cardmarket führt je ABWEICHENDEM ARTWORK ein eigenes Produkt und hängt ab
   dem zweiten ein -V2, -V3 … an. Welche Sammlernummer damit gemeint ist, sagt
   die Adresse aber nicht — und raten verbietet sich hier: Showcase- und
   Sonderrahmen sind im Handel oft ein Vielfaches der regulären Auflage wert.
   null = ohne Kürzel, also der Normaldruck. */
const cmVariante = s => {
  const m = String(s || "").match(/-V(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
};

/* Cardmarkets Sprachnummern (der „?language=N"-Filter auf Produktseiten) auf
   Scryfalls Kürzel. Die Nummer ist die verlässlichste Sprachangabe, die
   Cardmarket überhaupt macht: Sie benennt die gesuchte KARTE, während der
   Pfadteil (/de/) nur die Anzeigesprache der Seite meint. */
const CM_SPRACHE = { 1: "en", 2: "fr", 3: "de", 4: "es", 5: "it",
                     6: "zhs", 7: "ja", 8: "pt", 9: "ru", 10: "ko", 11: "zht" };

/* Sprachen, in denen ein gezogener alt-Text stehen kann — die, die Cardmarket
   führt, nach Häufigkeit geordnet. Gebraucht für die Gegenprobe eines aus dem
   Bilddateinamen geratenen Produkts. */
const CM_PRUEF_LANGS = ["de", "fr", "it", "es", "ja", "pt", "ru", "ko", "zhs", "zht"];

/* Setnamen wortblind vergleichen: Cardmarket sagt „Commander: Outlaws of
   Thunder Junction", Scryfall „Outlaws of Thunder Junction Commander" —
   dieselben Worte, andere Reihenfolge. Sortiert verglichen treffen sie sich;
   das bloße norm()-Gleich davor scheiterte genau daran (ein gezogener
   Sonnenring landete im falschen Set). */
const setWorte = s => norm(s).split(" ").filter(Boolean).sort().join(" ");

/* Eine Adresse auf eine Kennung abklopfen. REINE TEXTARBEIT, kein Netz —
   deshalb einzeln prüfbar. Rückgabe: { art, quelle, … } oder null. Die
   Reihenfolge hier drin ist gleichgültig, eine Adresse trifft höchstens eines
   der Muster; über den Vorrang entscheidet ziehRang. */
function ziehKennung(adresse) {
  let u;
  try { u = new URL(adresse); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = d => u.hostname === d || u.hostname.endsWith("." + d);
  let teile;
  try { teile = u.pathname.split("/").filter(Boolean).map(decodeURIComponent); }
  catch { teile = u.pathname.split("/").filter(Boolean); }   // kaputte %-Folge
  const param = n => {
    for (const [k, v] of u.searchParams) if (k.toLowerCase() === n) return v;
    return null;
  };

  // Scryfall-Bild oder -API: die Kartenkennung steht als Dateiname bzw. im
  // Pfad. Die exakteste Angabe überhaupt — sie meint GENAU diese Auflage in
  // GENAU dieser Sprache, auch bei Rückseiten und Ausschnitten (alle Bilder
  // einer Karte laufen unter derselben Kennung).
  if (host("scryfall.io") || host("scryfall.com")) {
    const m = u.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return { art: "sfid", quelle: "Scryfall", id: m[0].toLowerCase() };
  }
  // Scryfall-Kartenseite: /card/<set>/<nummer>[/<sprache>]/<name>. Setcode und
  // Nummer streng prüfen — sie wandern in einen API-Pfad und sollen nichts
  // anderes sein können als ein Setcode und eine Sammlernummer.
  if (host("scryfall.com") && teile[0] === "card" &&
      /^[a-z0-9]{2,6}$/i.test(teile[1] || "") && /^[0-9a-z★†.\-]{1,10}$/i.test(teile[2] || "")) {
    const dritt = (teile[3] || "").toLowerCase();
    return { art: "druck", quelle: "Scryfall", set: teile[1], cn: teile[2],
             lang: SF_URL_LANGS.has(dritt) ? dritt : "en" };
  }
  // Gatherer seit dem Umbau 2024: /<SET>/<gebiet>/<nummer>/<name>. Die alten
  // Details.aspx-Adressen leiten selbst hierher um, tragen aber auch weiterhin
  // die Multiverse-ID — die fängt der nächste Block.
  if (host("gatherer.wizards.com") && teile.length >= 3 &&
      /^[a-z0-9]{2,6}$/i.test(teile[0]) && /^[a-z]{2}(-[a-z]{2,4})?$/i.test(teile[1]) &&
      /^\d{1,4}[a-z★]?$/i.test(teile[2]))
    return { art: "druck", quelle: "Gatherer", set: teile[0], cn: teile[2],
             lang: gathererLang(teile[1]) };
  // Multiverse-ID: Gatherers alte Kennung, die Scryfall mitführt. Der Name ist
  // eindeutig genug, dass er auf jedem Wirt gelten darf (verlinkt wird Gatherer
  // von überall her).
  const mv = param("multiverseid");
  if (mv && /^\d+$/.test(mv)) return { art: "multiverse", quelle: "Gatherer", id: mv };

  if (host("cardmarket.com")) {
    // Die Seitensprache steht vorn im Pfad (/de/Magic/…). Sie benennt Produkt
    // und Set in dieser Sprache und ist zugleich die beste Vorauswahl für die
    // Sprache der Karte. Bilder von den S3-Wirten tragen sie nicht.
    const erst = (teile[0] || "").toLowerCase();
    // Zwei Quellen, die stärkere zuerst: Cardmarket hängt an gefilterte
    // Produktseiten „?language=N" — DAS ist die Sprache der gesuchten Karte.
    // Der Pfadteil (/de/) sagt nur, in welcher Sprache die Seite angezeigt
    // wird; ein deutscher Nutzer sieht dort auch englische Karten.
    const lang = CM_SPRACHE[param("language")] ||
      (["de", "en", "fr", "es", "it"].includes(erst) ? erst : null);
    // Produktnummer im Fragezeichenteil — so verlinkt auch Scryfall dorthin.
    const pid = param("idproduct");
    if (pid && /^\d+$/.test(pid)) return { art: "cmid", quelle: "Cardmarket", id: pid, lang };
    // Sprechende Produktadresse: /de/Magic/Products/Singles/<Set>/<Karte>.
    const i = teile.findIndex(x => x.toLowerCase() === "singles");
    if (i >= 0 && teile[i + 2])
      return { art: "cmname", quelle: "Cardmarket", lang,
               name: cmSlugName(teile[i + 2]), setName: cmSlugName(teile[i + 1]),
               variante: cmVariante(teile[i + 2]) };
    // Produktbild: …/<Produktnummer>.jpg. Dass diese Zahl die Produktnummer
    // ist, ist GERATEN — deshalb „unsicher": der Treffer gilt erst, wenn der
    // mitgezogene Name dazu passt (siehe karteAusKennung).
    const bild = (teile[teile.length - 1] || "").match(/^(\d{2,9})\.(?:jpe?g|png|webp|gif)$/i);
    if (bild) return { art: "cmid", quelle: "Cardmarket", id: bild[1], unsicher: true, lang };
  }
  return null;
}

/* Vorrang der Wege: eine Kennung, die GENAU EINE Auflage bezeichnet, schlägt
   jede Namenssuche — und unter den Kennungen die exakteste zuerst. Geraten
   Gelesenes kommt in jedem Fall zuletzt. */
const ZIEH_ARTEN = ["sfid", "druck", "multiverse", "cmid", "cmname"];
const ziehRang = k => (k.unsicher ? 10 : 0) + ZIEH_ARTEN.indexOf(k.art);

/* Kennung → Scryfall-Karte. Hier liegt das Netz; die Textarbeit steckt oben in
   ziehKennung. `nameHinweis` dient der Gegenprobe unsicherer Kennungen. */
/* Dieselbe Auflage in einer anderen Sprache, sofern Scryfall sie darin führt.
   Sonst bleibt die gefundene — eine Sprache, die es nicht gibt, ist kein Grund,
   die Karte fallenzulassen.

   Warum das gebraucht wird: Cardmarket führt je Auflage EIN Produkt für alle
   Sprachen; die Sprache ist dort eine Eigenschaft des einzelnen Angebots, nicht
   des Produkts. Über die cardmarket_id landet man deshalb immer beim
   ENGLISCHEN Druck — und der trägt auch das englische Artwork. Für eine
   deutsche Karte ist das die falsche Zeile: anderes Bild, anderer gedruckter
   Name, eigene scryfall_id. */
async function inSprache(card, lang) {
  if (!card || !lang || card.lang === lang) return card;
  const genau = await sfCode(card.set, card.collector_number, lang);
  if (genau) return genau;
  // Scryfall führt diese AUFLAGE nicht in der Sprache — bei ganzen Sets kommt
  // das vor (Innistrad Remastered hat dort keine einzige deutsche Karte),
  // obwohl es die Karte gedruckt sehr wohl auf Deutsch gibt. Dann wenigstens
  // den gedruckten NAMEN retten: Der gehört zur KARTE, nicht zur Auflage, und
  // steht bei jeder anderen Auflage derselben Karte in dieser Sprache.
  const schwester = await schwesterAuflage(card, lang);
  if (!schwester) return card;   // gar keine Fassung (typisch für Tokens)
  // Bild und Kennung bleiben die gefundenen — etwas Besseres hat Scryfall
  // nicht. Sprache und gedruckte Texte kommen von der Schwester: Die Karte im
  // Regal IST in dieser Sprache, und so heißt sie darauf.
  return { ...card, lang,
    printed_name: schwester.printed_name ?? null,
    printed_type_line: schwester.printed_type_line ?? null,
    printed_text: schwester.printed_text ?? null };
}

/* Irgendeine Auflage DERSELBEN Karte in der gewünschten Sprache. Gesucht wird
   über den englischen Namen und gegen die oracle_id gegengeprüft, damit nicht
   eine gleichnamige andere Karte einspringt. */
async function schwesterAuflage(card, lang) {
  if (!card?.name) return null;
  let hits = [];
  try { hits = await sfSearch(`!"${card.name.replace(/"/g, "")}" lang:${lang}`, 8); }
  catch { return null; }
  return hits.find(c => c.lang === lang && c.oracle_id && c.oracle_id === card.oracle_id) || null;
}

/* `standardLang` ist die Sprache aus dem Scan-Dropdown. Sie greift NUR dort,
   wo die Quelle selbst nichts sagt — bei Scryfall und Gatherer steht die
   Sprache in der Adresse und schlägt alles. */
async function karteAusKennung(k, nameHinweis, standardLang) {
  if (!k) return null;
  if (k.art === "sfid") return withPrice(await sfById(k.id));
  if (k.art === "multiverse")
    return withPrice(await sf("/cards/multiverse/" + encodeURIComponent(k.id)));
  if (k.art === "cmid") {
    const hit = await sf("/cards/cardmarket/" + encodeURIComponent(k.id));
    if (!hit) return null;
    // Woher die Sprache kommt, in dieser Reihenfolge: der gedruckte Name aus
    // dem alt-Text (weiter unten, der beste Beleg), sonst der Sprachteil der
    // Cardmarket-Adresse, sonst das Scan-Dropdown. Letzteres ist nötig, weil
    // die BILDadresse (product-images.s3…) gar keinen Sprachteil hat — und das
    // Bild ist genau das, was man zieht.
    let sprache = k.lang || standardLang || null;
    // Aus einem Dateinamen geratene Nummer: nur gelten lassen, wenn der
    // mitgezogene Name dazu passt. Eine falsche Karte still in die Sammlung zu
    // schreiben wäre schlimmer als gar keine — ohne Namen fällt der Weg durch
    // und der Namensweg bekommt seine Chance.
    if (k.unsicher) {
      if (!nameHinweis) return null;
      if (!nameHitMatchesRead(hit, nameHinweis)) {
        // Der Vergleich muss SPRACHBLIND sein: auf cardmarket.com/de heißt
        // das gezogene Bild „Sonnenring", die Produkt-Auflösung liefert aber
        // den englischen Druck („Sol Ring") — wörtlich verglichen flog so der
        // RICHTIGE Treffer raus, und die Namenssuche danach fand irgendeine
        // andere Auflage.
        //
        // Geprüft wird deshalb über PUNKTZUGRIFFE auf dieselbe Auflage:
        // /cards/<set>/<nr>/<sprache> kostet 200–500 ms, während /cards/search
        // für Namensanfragen schon mal 30 Sekunden braucht (gemessen). Das ist
        // obendrein der schärfere Beleg — verglichen wird die Auflage mit sich
        // selbst statt mit einer Schwester. Die vermutete Sprache zuerst, dann
        // die übrigen Cardmarket-Sprachen.
        const reihe = [...new Set([sprache, ...CM_PRUEF_LANGS].filter(Boolean))];
        let passt = null;
        for (const l of reihe) {
          if (l === "en") continue;                 // war schon der Ausgangspunkt
          let uebers = null;
          try { uebers = await sfCode(hit.set, hit.collector_number, l); }
          catch { /* nächste Sprache */ }
          if (uebers && nameHitMatchesRead(uebers, nameHinweis)) { passt = uebers; break; }
        }
        if (!passt) return null;
        // Treffer IST bereits die richtige Auflage in der richtigen Sprache.
        return withPrice(passt);
      }
    }
    return withPrice(await inSprache(hit, sprache));
  }
  if (k.art === "druck") {
    // Der Setcode aus einer Adresse ist bereits Scryfalls eigener — der direkte
    // Abruf trifft. findByCode mit seinen t-/p-Präfixen bleibt als Netz für den
    // Fall, dass die Sprache in dieser Auflage nicht geführt wird.
    const genau = await sfCode(k.set, k.cn, k.lang);
    return genau ? withPrice(genau) : findByCode(k.set, k.cn, k.lang);
  }
  if (k.art === "cmname") return cmKarteAusNamen(k.name, k.setName, k.lang || standardLang, k.variante);
  return null;
}

/* Cardmarket nennt in seinen Adressen Set und Karte im Klartext, aber keine
   Sammlernummer — und auf cardmarket.com/de/… stehen beide in der Sprache der
   Seite. Der Name läuft deshalb durch findCard, das auch gedruckte Namen
   fremder Sprachen auflöst (die unscharfe Namenssuche kennt nur Englisch);
   der Setname wählt danach unter den Auflagen die passende aus. Findet sich
   keine — Cardmarket schneidet Sets teils anders zu und benennt sie anders —,
   bleibt es beim Treffer der Namenssuche: dieselbe Karte, nur womöglich eine
   andere Auflage. */
async function cmKarteAusNamen(name, setName, lang, variante) {
  if (!name) return null;
  let hit = null;
  try { hit = (await findCard(name, lang)).card; } catch { /* unten null */ }
  if (!hit) return null;
  const gesucht = setWorte(setName);
  if (!gesucht) return withPrice(hit);
  // Alle Auflagen der Karte, EINE je Druck (unique=prints, OHNE Sprach-
  // fassungen): mit include_multilingual multipliziert sich die Liste mit den
  // Sprachen, und bei viel Gedrucktem wie einem Sol Ring schöbe die Deckelung
  // das gesuchte Set aus dem Fenster. Eine Seite (175) reicht für alles außer
  // Standardländern — und wer die zieht, dem genügt auch der Namenstreffer.
  let drucke = [];
  try {
    const r = await sf("/cards/search?unique=prints&order=released&dir=desc&q=" +
                       encodeURIComponent(`!"${hit.name.replace(/"/g, "")}"`));
    drucke = r?.data || [];
  } catch { /* dann eben die Auflage der Namenssuche */ }
  // Unter den Auflagen des Sets die REGULÄRE: Cardmarket hängt an Showcase-
  // und Sonderrahmen ein "-V2"/"-V3" an — die nackte Adresse meint den
  // Normaldruck, und der trägt die niedrigste Sammlernummer.
  const nr = c => parseInt(String(c.collector_number).replace(/\D/g, ""), 10) || 1e9;
  const imSet = drucke.filter(c => setWorte(c.set_name) === gesucht);
  // Trägt die Adresse ein Fassungskürzel, ist der Normaldruck NICHT gemeint —
  // welche der übrigen Auflagen aber schon, sagt sie nicht. Dann wird nicht
  // geraten, sondern gefragt: Die Auflagen des Sets gehen als Auswahlliste
  // zurück, und der Nutzer erkennt am Bild, welche er in der Hand hält. Ein
  // still eingetragenes Standard-Artwork wäre hier der teuerste Fehler — im
  // Handel trennen Showcase und Normaldruck oft ein Vielfaches des Preises.
  if (variante && imSet.length > 1) return { kandidaten: imSet };
  const regulaer = imSet.sort((a, b) => nr(a) - nr(b))[0];
  if (!regulaer) return withPrice(await inSprache(hit, lang));
  // Sprache der Cardmarket-Seite bzw. des Scan-Dropdowns, sofern Scryfall die
  // Auflage in ihr führt (ein Cardmarket-Produkt führt alle Sprachen).
  return withPrice(await inSprache(regulaer, lang));
}

/* Zuletzt der Name: alt/title des gezogenen Bildes oder mitgezogener Text.
   Erst die Setcode-Schreibweise ("MKM 8"), dann die Namenssuche — dieselben
   zwei Wege wie in der Handkorrektur. */
async function karteAusText(text, lang) {
  const v = String(text || "").trim();
  if (!v) return { card: null, candidates: [] };
  const m = v.match(/^([a-z0-9]{3,5})[\s\-\/·•]+(\d{1,4}[a-z★]?)(?:\s+(t))?$/i);
  if (m) {
    const c = await findByCode(m[1], m[2], lang, !!m[3]);
    if (c) return { card: c, candidates: [] };
  }
  return findCard(v, lang);
}

/* Was ein Ziehen mitbringt, auf Adressen und Namen eindampfen. Welcher Browser
   welchen Typ füllt, ist verschieden (Firefox text/x-moz-url, Chromium
   text/html mit dem <img> im Original), deshalb alles einsammeln statt sich auf
   einen Typ zu verlassen. Reihenfolge der Namen ist Rangfolge: alt und title
   eines Bildes benennen die Karte, ein markierter Kartenname kommt als
   text/plain. */
const ZIEH_TYPEN = ["text/uri-list", "text/html", "text/plain", "text/x-moz-url", "Files"];

/* Die wenigen HTML-Entitäten, die in Adressen und Kartennamen vorkommen —
   allen voran &amp; in Abfrageteilen und &#39; in Namen. &amp; zuletzt, sonst
   würde „&amp;lt;" zweistufig zu „<". */
const entEsc = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* Attribute aus dem HTML-Schnipsel lesen — mit Mustern statt DOMParser.
   Bewusst KEIN echtes Parsen: der Schnipsel ist fremder, unvertrauter Inhalt,
   und auch wenn ein per DOMParser erzeugtes Dokument träge ist (nichts lädt,
   nichts läuft), bliebe das Parsen ein Verdachtsfall für die statische
   Sicherheitsanalyse. Nötig ist es auch nicht: den Schnipsel serialisiert der
   ziehende Browser selbst — wohlgeformt, Attribute stets in Anführungszeichen
   —, dafür reicht ein Muster je Tag. `je` bekommt je Fund die gewünschten
   Attribute als Objekt. */
function tagAttribute(html, tag, attrs, je) {
  const tagRx = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  for (let m; (m = tagRx.exec(html)); ) {
    const werte = {};
    for (const a of attrs) {
      const w = m[1].match(new RegExp(`\\b${a}\\s*=\\s*"([^"]*)"`, "i")) ||
                m[1].match(new RegExp(`\\b${a}\\s*=\\s*'([^']*)'`, "i"));
      werte[a] = w ? entEsc(w[1]) : null;
    }
    je(werte);
  }
}

/* Diagnose des Zieh-Imports: zeigt neben der erkannten Karte alles, was auf dem
   Weg dorthin gelesen wurde — die rohe Nutzlast des Ablegens, die daraus
   gewonnenen Adressen und Namen, jede erkannte Kennung mit ihrem Rang, welcher
   Weg zog, und die Felder der Karte, die dabei herauskam. Gerätelokal
   einschaltbar (localStorage, wie „Treffer sofort übernehmen"): im Alltag
   interessiert das niemanden, beim Nachstellen eines Fehlers ist es alles —
   „welche Auflage hat er gefunden und woran?" beantwortet sonst nur Raten.

   Solange sie an ist, bleibt die Kachel im Zieh-Kasten stehen, auch wenn die
   Karte längst geschrieben ist: Die Diagnose gehört zum Vorgang und wäre mit
   der Kachel weg, bevor man sie lesen kann.

   Der Schalter steht in den Einstellungen unter „Verwaltung" und ist damit
   der Adminrolle vorbehalten. Geprüft wird IS_ADMIN aber auch hier, nicht nur
   beim Zeichnen des Hakens: Sonst liefe die Diagnose bei jemandem weiter, der
   sie als Admin eingeschaltet hatte und die Rolle später verlor — der Eintrag
   im Gerätespeicher überdauert das. Eine Sicherheitsgrenze ist das nicht und
   soll es nicht sein: Gezeigt wird ausschließlich, was der Nutzer selbst
   gerade herübergezogen hat, plus die öffentliche Scryfall-Antwort darauf. */
function ziehDiagnose() {
  return IS_ADMIN && localStorage.getItem("mtg-zieh-diag") === "1";
}
function ziehDiagnoseSetzen(an) { localStorage.setItem("mtg-zieh-diag", an ? "1" : "0"); }

function ziehNutzlast(dt, mitRoh) {
  const urls = [], namen = [], gesehen = new Set();
  const addUrl = x => {
    const s = String(x || "").trim();
    if (/^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s);
  };
  const addName = x => {
    const s = String(x || "").replace(/\s+/g, " ").trim();
    const k = s.toLowerCase();
    if (s.length < 2 || s.length > 80 || /^https?:\/\//i.test(s) || gesehen.has(k)) return;
    gesehen.add(k); namen.push(s);
  };
  const daten = typ => { try { return dt.getData(typ) || ""; } catch { return ""; } };

  // text/uri-list: eine Adresse je Zeile, mit # beginnende Zeilen sind Kommentar.
  daten("text/uri-list").split(/\r?\n/).forEach(z => { if (!z.startsWith("#")) addUrl(z); });
  // Firefox: Adresse und Beschriftung im Wechsel.
  daten("text/x-moz-url").split(/\r?\n/).forEach((z, i) => (i % 2 ? addName(z) : addUrl(z)));
  const roh = daten("text/plain").trim();
  if (/^https?:\/\//i.test(roh)) addUrl(roh); else addName(roh);

  // Der HTML-Schnipsel ist das gezogene Element im Original — beim Bild also
  // das <img> mit src, srcset und dem Kartennamen in alt.
  const html = daten("text/html");
  if (html) {
    tagAttribute(html, "img", ["src", "srcset", "alt", "title"], w => {
      addUrl(w.src);
      // srcset führt oft eine andere (größere) Fassung — und manchmal die
      // einzige, die die Kennung im Dateinamen trägt.
      (w.srcset || "").split(",").forEach(s => addUrl(s.trim().split(/\s+/)[0]));
      addName(w.alt);
      addName(w.title);
    });
    tagAttribute(html, "a", ["href", "title"], w => { addUrl(w.href); addName(w.title); });
  }
  // Für die Diagnose zusätzlich das Rohe: welche Typen der ziehende Browser
  // überhaupt beigelegt hat und was in ihnen stand. Nur auf Anforderung, denn
  // der HTML-Schnipsel kann etliche Kilobyte umfassen.
  const rohdaten = mitRoh
    ? [...(dt.types || [])].map(typ => ({ typ, wert: typ === "Files"
        ? [...(dt.files || [])].map(f => `${f.name} (${f.type}, ${f.size} B)`).join(", ")
        : daten(typ) }))
    : null;
  return { urls, namen, roh: rohdaten, typen: [...(dt.types || [])] };
}

/* Adressen vor Namen, exakte Kennungen vor geratenen. Meldet über `schritt`,
   welcher Weg gerade läuft — bei bis zu drei Scryfall-Abrufen ist das keine
   Zierde, sondern die einzige Rückmeldung während der Wartezeit. */
async function ziehErkennen(nutzlast, lang, schritt, diag) {
  const kennungen = nutzlast.urls.map(ziehKennung).filter(Boolean)
    .sort((a, b) => ziehRang(a) - ziehRang(b));
  const nameHinweis = nutzlast.namen[0] || "";
  if (diag) {
    diag.kennungen = kennungen.map(k => ({ ...k, rang: ziehRang(k) }));
    diag.nameHinweis = nameHinweis;
    // Welche Sprache das Dropdown vorgibt, gehört in die Diagnose: bei
    // Cardmarket entscheidet sie mit, welche Auflage herauskommt.
    diag.standardLang = lang;
  }

  // `sicher` heißt: die ADRESSE hat die Karte benannt, nicht ein Namensraten.
  // Jede Kennung hier bezeichnet eine bestimmte Auflage (Scryfall-Kennung,
  // Set+Nummer, Multiverse- oder Produktnummer) — geraten wird daran nichts,
  // und die aus einem Bilddateinamen gelesene Nummer hat ihre Gegenprobe
  // bereits bestanden. Nur der Namensweg unten kann die falsche Karte finden.
  const notiz = (weg, wert, fehler) => {
    if (diag) diag.versuche.push({ weg, ergebnis: wert, fehler: fehler || null });
  };
  for (const k of kennungen) {
    schritt(t("drag.stepUrl", { q: k.quelle }));
    let card = null, fehler = null;
    try { card = await karteAusKennung(k, nameHinweis, lang); }
    catch (e) { fehler = e.message; }   /* Abruf fehlgeschlagen — nächster Weg */
    // Mehrere Auflagen kommen in Frage (Cardmarket-Fassungskürzel): nicht
    // raten, sondern die Auswahlliste zeigen — am Bild erkennt der Nutzer
    // seine Auflage sofort.
    if (card?.kandidaten) {
      notiz(`${k.art} · ${k.quelle}`, `${card.kandidaten.length} Auflagen zur Auswahl`, fehler);
      return { card: null, guess: k.name || nameHinweis, candidates: card.kandidaten };
    }
    notiz(`${k.art} · ${k.quelle}`, card ? `${card.name} [${card.set}/${card.collector_number}/${card.lang}]` : "—", fehler);
    if (card) return { card, quelle: k.quelle, sicher: true };
  }
  for (const n of nutzlast.namen) {
    schritt(t("drag.stepName"));
    let r = null, fehler = null;
    try { r = await karteAusText(n, lang); } catch (e) { fehler = e.message; }
    notiz(`name · ${n}`, r?.card ? `${r.card.name} [${r.card.set}/${r.card.collector_number}/${r.card.lang}]`
      : r?.candidates.length ? `${r.candidates.length} Kandidaten` : "—", fehler);
    if (!r) continue;
    if (r.card) return { card: r.card, quelle: t("drag.viaName"), sicher: false };
    if (r.candidates.length) return { card: null, guess: n, candidates: r.candidates };
  }
  return { card: null, guess: nameHinweis, candidates: [] };
}

/* Die Warteschlange für gezogene Karten schwebt über der Oberfläche: gezogen
   wird auf der Sammlungsseite, gezeigt werden muss der Treffer aber trotzdem —
   und zwar dort, wo die Karte gerade abgelegt wurde. Die Einträge sind
   dieselben .job-Kacheln wie beim Scan, samt Bestätigungsschritt. */
function ziehKasten() {
  const box = $("#dropbox");
  if (box) box.hidden = false;
  return $("#dropbox-list") || $("#queue");
}

/* Kachel entfernen — und einen dadurch leer gewordenen schwebenden Kasten
   gleich mit. Vorher blieb nach „Verwerfen" die leere Kopfzeile „Gezogene
   Karten" stehen und wollte per „Schließen" extra weggeklickt werden — genau
   das zweite Popup, das keiner braucht. Kacheln in der Scan-Warteschlange
   betrifft das nicht (closest findet dort keinen Kasten). */
function ziehKachelWeg(el) {
  const kasten = el.closest("#dropbox-list");
  el.remove();
  if (kasten && !kasten.children.length) {
    const b = $("#dropbox");
    if (b) b.hidden = true;
  }
}

/* Die Kachel startet mit leerem Vorschaubild; das Kartenbild setzen erst
   Bestätigung bzw. Übernahme aus dem Scryfall-Treffer. Das gezogene Bild
   selbst wird bewusst NICHT eingebunden: eine fremde Adresse gehört nicht
   ungeprüft in ein src (und viele Wirte sperren Hotlinks ohnehin aus). */
function ziehJob(ziel) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `<img class="thumb" alt="">
    <div class="body"><div class="title">${esc(t("drag.reading"))}</div>
    <div class="meta" data-step>${esc(t("drag.stepStart"))}</div>
    <div class="bar"><i style="width:35%"></i></div></div>`;
  ziel.prepend(el);
  return el;
}

/* Die Felder der Scryfall-Karte, die für diesen Weg zählen: was die Auflage
   bezeichnet, was in die Sammlung geschrieben wird, und was den Preis erklärt.
   Bewusst eine feste Liste statt des ganzen Objekts — eine Scryfall-Karte hat
   über siebzig Felder, und die Diagnose soll lesbar bleiben. */
const DIAG_KARTE = ["id", "oracle_id", "name", "printed_name", "lang", "set", "set_name",
  "collector_number", "rarity", "layout", "cardmarket_id", "released_at", "type_line"];

const diagWert = v =>
  v == null ? "—"
  : typeof v === "boolean" ? (v ? "ja" : "nein")
  : Array.isArray(v) ? (v.length ? v.join(", ") : "—")
  : typeof v === "object" ? JSON.stringify(v)
  : String(v) || "—";

const diagTabelle = paare => `<table class="diag-t">${paare.map(([k, v]) =>
  `<tr><th>${esc(k)}</th><td>${esc(diagWert(v))}</td></tr>`).join("")}</table>`;

/* Die gesammelte Diagnose als aufklappbarer Block unter der Kachel. Alles
   läuft durch esc: Der Inhalt stammt aus einem fremden Fenster, und gerade
   das Rohe zeigt ihn unverändert. */
function ziehDiagnoseHtml(d) {
  const kurz = s => { const x = String(s ?? ""); return x.length > 800 ? x.slice(0, 800) + " …" : x; };
  const teil = (titel, inhalt) => `<div class="diag-a"><h5>${esc(titel)}</h5>${inhalt}</div>`;
  const leer = `<p class="diag-leer">${esc(t("diag.none"))}</p>`;
  const liste = xs => xs?.length
    ? `<ol class="diag-l">${xs.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : leer;

  const roh = d.roh?.length
    ? d.roh.map(r => `<div class="diag-roh"><b>${esc(r.typ)}</b><pre>${esc(kurz(r.wert)) || "—"}</pre></div>`).join("")
    : leer;
  const kennungen = d.kennungen?.length
    ? d.kennungen.map((k, i) => diagTabelle([
        [t("diag.rank"), `${i + 1}. — ${k.rang}`],
        ...Object.entries(k).filter(([f]) => f !== "rang"),
      ])).join("")
    : leer;
  const versuche = d.versuche?.length
    ? diagTabelle(d.versuche.map(v => [v.weg, v.ergebnis + (v.fehler ? ` (${v.fehler})` : "")]))
    : leer;

  return `<details class="diag" open>
    <summary>${esc(t("diag.title"))}</summary>
    ${teil(t("diag.payload"), roh)}
    ${teil(t("diag.urls"), liste(d.urls))}
    ${teil(t("diag.names"), liste(d.namen))}
    ${teil(t("diag.ids"), kennungen)}
    ${teil(t("diag.tries"), versuche)}
    ${teil(t("diag.result"), diagTabelle([
      [t("diag.source"), d.quelle], [t("diag.sure"), d.sicher],
      ...(d.karte ? DIAG_KARTE.map(f => [f, d.karte[f]])
            .concat([["prices", d.karte.prices], ["image", imgOf(d.karte)]]) : []),
    ]))}
    ${d.geschrieben ? teil(t("diag.written"), diagTabelle(Object.entries(d.geschrieben))) : ""}
    ${d.fehler ? teil(t("diag.error"), `<p class="diag-fehler">${esc(d.fehler)}</p>`) : ""}
    <button class="btn ghost sm" data-diag-copy>${esc(t("diag.copy"))}</button>
  </details>`;
}

/* Diagnose an die Kachel hängen. Der Kopierknopf gibt alles als JSON in die
   Zwischenablage — zum Weitergeben ist das brauchbarer als ein Bildschirmfoto
   der Tabelle. */
function ziehDiagnoseZeigen(el, d) {
  if (!el || !d) return;
  const body = el.querySelector(".body") || el;
  body.insertAdjacentHTML("beforeend", ziehDiagnoseHtml(d));
  const knopf = body.querySelector("[data-diag-copy]");
  if (knopf) knopf.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
      toast(t("diag.copied"));
    } catch { toast(t("diag.copyFail")); }
  };
}

/* „Bild doch auslesen": Hängt die Bilddatei am Ablegen, bleibt die
   Bilderkennung über diesen Knopf erreichbar — sie läuft nur nicht mehr von
   selbst an. Der Hinweis auf die Dauer steht in der Beschriftung, damit die
   Wartezeit niemanden überrascht; gedrückt wird die Kachel durch die des
   Scans ersetzt, der Weg ist von da an der gewohnte.

   Warum überhaupt anbieten: In der Praxis las die Erkennung den Namen fast
   richtig („Agent of Erebos" mit einer verirrten Ziffer). Ein Weg, der beinahe
   trägt, gehört nicht weggeworfen — nur nicht ungefragt bezahlt. */
function ziehScanKnopf(el, dateien, ziel) {
  const body = el.querySelector(".body");
  if (!body || !dateien.length) return;
  body.insertAdjacentHTML("beforeend",
    `<button class="btn ghost sm" data-scan style="margin-top:8px">${esc(t("drag.scanBtn"))}</button>`);
  const b = body.querySelector("[data-scan]");
  if (b) b.onclick = () => { el.remove(); dateien.forEach(f => scanFile(f, ziel)); };
}

/* Ein abgelegtes Etwas übernehmen. `ziel` ist der Behälter für die Kachel:
   im Scan-Bereich die dortige Warteschlange, sonst der schwebende Kasten.
   WICHTIG: dt (der DataTransfer) ist nur während des drop-Ereignisses lesbar —
   alles wird deshalb VOR dem ersten await herausgezogen. */
async function ziehImport(dt, ziel) {
  // Chromium legt beim Ziehen eines Bildes aus einem anderen Browserfenster
  // oft ZUSÄTZLICH die Bilddatei bei. Die Adresse geht vor (exakt, ohne
  // Modellaufruf); die Datei ist der Hauptweg für Bilder aus dem Dateimanager,
  // die gar keine Adresse tragen.
  //
  // ABER: Kam das Ablegen von einer Webseite (es lagen Adressen bei) und keine
  // davon trug, läuft die Bilderkennung nicht mehr UNGEFRAGT an. Nicht, weil
  // sie nichts könnte — beobachtet hat sie „Agent of Erebos" durchaus gelesen,
  // nur mit einer verirrten Ziffer dahinter. Sondern weil sie teuer ist: ein
  // Modellaufruf kostet KI-Kontingent, und ihre Namenssuchen dauerten in einem
  // gemessenen Fall über zwei Minuten, an deren Ende doch die Handkorrektur
  // stand. Diese Kosten ungefragt auszulösen, nachdem der Nutzer nur ein Bild
  // herübergezogen hat, ist die falsche Vorgabe.
  //
  // Also: sofort in die Handkorrektur — und dort ein Knopf, der die
  // Bilderkennung auf Wunsch doch noch anwirft (ziehScanKnopf). Ohne jede
  // Adresse im Ablegen bleibt es beim Scan-Weg: dann kommt das Bild aus dem
  // Dateimanager und ist vermutlich ein echtes Foto, wo er hingehört.
  const dateien = [...(dt.files || [])].filter(f => f.type.startsWith("image/"));
  const diagAn = ziehDiagnose();
  const nutzlast = ziehNutzlast(dt, diagAn);
  if (!nutzlast.urls.length && !nutzlast.namen.length) {
    if (dateien.length) { dateien.forEach(f => scanFile(f, ziel)); return; }
    return toast(t("drag.nothing"));
  }

  const lang = $("#d-lang").value;
  const el = ziehJob(ziel);
  const schritt = s => { const n = el.querySelector("[data-step]"); if (n) n.textContent = s; };
  // Der Merker wandert durch die ganze Kette und wird am Ende an die Kachel
  // gehängt — auch im Fehlerfall, denn dann ist er am meisten wert.
  const diag = diagAn ? { typen: nutzlast.typen, roh: nutzlast.roh,
    urls: nutzlast.urls, namen: nutzlast.namen, kennungen: [], versuche: [] } : null;
  try {
    const r = await ziehErkennen(nutzlast, lang, schritt, diag);
    if (diag) { diag.quelle = r.quelle || null; diag.sicher = !!r.sicher; diag.karte = r.card || null; }
    const bar = el.querySelector(".bar i");
    if (bar) bar.style.width = "100%";
    if (!r.card) {
      // Kein Treffer: sofort die Handkorrektur, wo man den Namen tippt oder
      // Setcode und Nummer einträgt — und, wenn eine Bilddatei mitkam, der
      // Knopf für die Bilderkennung. Angeboten statt aufgedrängt (siehe oben).
      renderManual(el, r.guess || "", r.candidates);
      if (dateien.length) ziehScanKnopf(el, dateien, ziel);
      return ziehDiagnoseZeigen(el, diag);
    }
    // Die Sprache steht in der Auflage, die die Adresse bezeichnet — sie
    // schlägt das Dropdown, genau wie die vom Foto gelesene beim Scan. Foil
    // und Zustand bleiben beim Nutzer, die verrät auch eine Adresse nicht.
    //
    // Bei einem SICHEREN Treffer wird ohne Rückfrage geschrieben und
    // stattdessen die Zeile in der Sammlung aufgeschlagen. Die Rückfrage bot
    // dort nur Sprache (steht schon fest), Ausführung und Zustand an — beides
    // ändert die Zeile über „Bearbeiten" genauso, und dort steht die Karte im
    // Bestand statt in einem Kasten davor. Eine Rückfrage, die nichts fragt,
    // was danach nicht besser zu beantworten wäre, ist bloß ein Klick.
    if (r.sicher || autoUebernehmen()) {
      const id = await addToCollection(r.card, el, { lang: r.card.lang });
      if (diag) diag.geschrieben = { id, lang: r.card.lang, zustand: $("#d-cond").value,
        foil: $("#d-foil").value === "1", preis: priceOf(r.card, $("#d-foil").value === "1") };
      if (r.sicher) await zeigeKarteInSammlung(id);
    } else {
      renderConfirm(r.card, el, { lang: r.card.lang });
      const info = el.querySelector(".c-info");
      // Woran es erkannt wurde, gehört sichtbar dazu: bei einem Namenstreffer
      // lohnt der Blick aufs Bild mehr als bei einer eindeutigen Kennung.
      if (info && r.quelle) info.insertAdjacentHTML("beforeend",
        `<div class="meta">${esc(t("drag.via", { q: r.quelle }))}</div>`);
    }
    ziehDiagnoseZeigen(el, diag);
  } catch (e) {
    el.querySelector(".body").innerHTML =
      `<div class="title">${esc(t("scan.failed"))}</div>
       <div class="meta"><span class="pill err">${esc(e.message)}</span></div>`;
    if (diag) { diag.fehler = e.message; ziehDiagnoseZeigen(el, diag); }
  }
}

/* Verdrahtung: Schleier beim Überziehen, Übernahme beim Ablegen. Liegt in einer
   eigenen Funktion, weil sie an window hängt und nicht an einem Bereich. */
function wireZiehImport() {
  const schleier = $("#dragveil");
  const kasten = $("#dropbox");
  const zu = $("#dropbox-close");
  if (zu) zu.onclick = () => {
    $("#dropbox-list").innerHTML = "";
    if (kasten) kasten.hidden = true;
  };

  // Ein Ziehen AUS der App heraus (der Verkaufs-Bookmarklet an der
  // Lesezeichenleiste) darf den Schleier nicht auslösen — sonst legt sich beim
  // Zugriff darauf ein Ablagefeld über die halbe Seite.
  let eigenerZug = false;
  document.addEventListener("dragstart", () => { eigenerZug = true; }, true);
  document.addEventListener("dragend", () => { eigenerZug = false; }, true);

  // Beim Betreten JEDES Kindelements feuert dragenter erneut und beim Verlassen
  // dragleave — gezählt statt geschaltet, sonst flackert der Schleier über
  // jeder Zeile. Der Zähler allein reicht aber nicht: ein mit Escape
  // abgebrochener Zug lässt ihn hängen. Deshalb zusätzlich eine Wache über
  // dragover — das feuert während des Ziehens fortlaufend (auch im Stillstand
  // alle ~350 ms); bleibt es aus, ist der Zug vorbei und der Schleier fällt.
  let tiefe = 0, wache = 0;
  const traegtKarte = e =>
    [...(e.dataTransfer?.types || [])].some(x => ZIEH_TYPEN.includes(x));
  // In ein Textfeld gezogener Text soll dort landen — das ist die Erwartung und
  // obendrein nützlich (Kartenname ins Suchfeld). Dort halten wir uns heraus.
  //
  // NUR dort. Ein <select> stand hier ebenfalls in der Liste, und das war ein
  // Fehler mit Folgen: Aufnehmen kann es einen Text nicht, also griff die
  // Browser-Vorgabe für eine abgelegte Adresse — HINNAVIGIEREN. Wer eine Karte
  // knapp neben das Set- oder Ausführungs-Dropdown der Sammlung fallen ließ,
  // verlor die App und landete auf der Fehlerseite des fremden Bildwirts
  // (Cardmarkets CDN antwortet auf Fremdzugriffe mit 403). Dasselbe gälte für
  // jedes andere Element, das keinen Text annimmt. Deshalb: ausschließlich
  // echte Eingabefelder — und bei denen auch nur die textannehmenden Arten.
  const TEXTARTEN = ["text", "search", "url", "email", "tel", "password", "number"];
  const imFeld = e => {
    const el = e.target?.closest?.("input,textarea,[contenteditable]");
    if (!el) return false;
    if (el.tagName !== "INPUT") return true;          // textarea, contenteditable
    return TEXTARTEN.includes((el.type || "text").toLowerCase());
  };
  const aus = () => { tiefe = 0; clearTimeout(wache); if (schleier) schleier.hidden = true; };
  const wachauf = () => { clearTimeout(wache); wache = setTimeout(aus, 900); };

  window.addEventListener("dragenter", e => {
    if (eigenerZug || !traegtKarte(e)) return;
    tiefe++;
    wachauf();
    if (schleier) schleier.hidden = false;
  });
  window.addEventListener("dragleave", () => { if (--tiefe <= 0) aus(); });
  window.addEventListener("dragover", e => {
    if (eigenerZug || !traegtKarte(e) || imFeld(e)) return;
    e.preventDefault();
    wachauf();
  });
  window.addEventListener("drop", e => {
    const eigen = eigenerZug;
    aus();
    eigenerZug = false;   // dragend bleibt aus, wenn die Quelle woanders lag
    if (eigen || !traegtKarte(e) || imFeld(e)) return;
    e.preventDefault();
    // Im Scan-Bereich abgelegt: dort steht die Warteschlange schon sichtbar,
    // der schwebende Kasten wäre dann nur ein zweiter Ort für dieselbe Sache.
    ziehImport(e.dataTransfer, e.target?.closest?.("#drop") ? $("#queue") : ziehKasten());
  });
}

/* ================= Sammlung- und Wunschlisten-Ansicht =================
   Zwei Ansichten, eine Mechanik. Die Sammlung zeigt, was im Regal liegt
   (Bestand > 0); die Wunschliste, was in einem Deck eingeplant ist, aber fehlt
   (Bestand 0) — dieselbe Tabelle über der jeweils anderen Hälfte derselben
   Zeilen. Filter, Tabelle, Sortierung und Blätterleiste sind deshalb gemeinsam
   und werden nur über einen BEREICHSSCHLÜSSEL auseinandergehalten ("coll" /
   "wish"). Zwei fast gleiche Ansichten getrennt zu pflegen, hieße sie driften
   zu lassen — genau das vermeidet cardRow schon zwischen Sammlung und Deck.

   Die Elemente in index.html heißen in der Wunschliste wie in der Sammlung, nur
   mit vorangestelltem „w" (#q → #wq). So gibt es keine zweite ID-Liste. */
const LISTE = {
  coll: { pre: "",  karten: () => CARDS.filter(c => c.qty > 0) },
  // Bestand 0 heißt „im Deck eingeplant, aber nicht besessen" — angelegt von
  // add_wish_to_deck oder einem Deck-Import. Genau das ist die Wunschliste.
  wish: { pre: "w", karten: () => CARDS.filter(c => c.qty === 0) },
};
const lid = (bereich, name) => "#" + LISTE[bereich].pre + name;
const lel = (bereich, name) => $(lid(bereich, name));

/* Sortierung, Seite und Set-Filter je Bereich: wer die Wunschliste sortiert,
   meint nicht die Sammlung (gleiche Überlegung wie bei deckSort unten). */
const listSort = { coll: { key: "name", dir: 1 }, wish: { key: "name", dir: 1 } };
const listPage = { coll: 0, wish: 0 };
const listSet  = { coll: "", wish: "" };

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
/* Set + Sammlernummer bezeichnen GENAU EINE Auflage — und zwar unabhängig von
   Sprache, Ausführung und Zustand. Zwei Zeilen mit demselben Paar sind also
   dieselbe Karte, egal was sonst in ihnen steht.

   Der Setcode wird dabei buchstabenblind verglichen, und das ist kein
   vorsorglicher Luxus: Scryfall liefert ihn klein ("ltr"), die Sammlungswege
   schreiben ihn groß ("LTR"), und wunschkarteZumDeck reichte ihn lange roh
   durch. Eine über „+ Wunsch" angelegte Zeile trug deshalb "ltr" und traf per
   Set+Nummer nie auf ihre gescannte Fassung. Geschrieben wird jetzt überall
   groß; hier wird trotzdem verglichen, ohne darauf zu bauen — Altbestand aus
   der Zeit davor liegt ja weiter in der Datenbank. */
const gleicherDruck = (a, b) =>
  !!(a && b && a.set && a.cn && b.set && b.cn) &&
  a.set.toUpperCase() === b.set.toUpperCase() && a.cn === b.cn;

function bestandVon(c) {
  if (!c.set || !c.cn) return c.qty;
  return CARDS.reduce((s, x) => s + (gleicherDruck(x, c) ? x.qty : 0), 0);
}

/* Zwei Sammlungszeilen sind „dieselbe Karte" — fürs Deck-Kontingent und die
   Deck-Zugehörigkeit — über Set + Sammlernummer, genau wie bestandVon (sprach-,
   foil- und zustandsunabhängig). Ohne Set/Nummer (Uralt-Zeilen) zählt die ID. */
function gleicheKarte(a, b) {
  if (a.set && a.cn && b.set && b.cn) return gleicherDruck(a, b);
  return a.id === b.id;
}

/* In welchen Decks steckt diese Karte (nach Set+Nummer) — je Deck mit Deckmenge.
   Grundlage für „in welchem Deck" (Kartendetails) und das Kontingent (eine
   besessene Karte darf nicht in mehr Decks als vorhanden). exceptId nimmt ein
   Deck aus (fürs „in ANDEREN Decks"). */
function deckVorkommen(c, exceptId) {
  const byId = new Map(CARDS.map(x => [x.id, x]));
  const out = [];
  for (const d of DECKS) {
    if (exceptId && d.id === exceptId) continue;
    let q = 0;
    for (const e of d.entries) {
      const card = byId.get(e.cardId);
      if (card && gleicheKarte(card, c)) q += e.qty;
    }
    if (q > 0) out.push({ id: d.id, name: d.name, qty: q });
  }
  return out;
}

/* In welchen Decks ist diese WUNSCHZEILE eingeplant, je Deck mit Deckmenge.
   Bewusst über die Zeilen-ID und nicht wie deckVorkommen über Set + Nummer:
   eine Wunschzeile ist genau ein Platzhalter, und nur die Deckplätze, die an
   ihr hängen, verschwinden mit ihr wieder (ON DELETE CASCADE). Über Set+Nummer
   käme auch ein besessenes Exemplar derselben Auflage mit in die Liste, das von
   ihrem Löschen gar nicht betroffen ist. */
function wunschDecks(c) {
  const out = [];
  for (const d of DECKS) {
    const e = (d.entries || []).find(x => x.cardId === c.id);
    if (e) out.push({ id: d.id, name: d.name, qty: e.qty });
  }
  return out;
}

/* Wie viele Exemplare dieser Wunschkarte insgesamt eingeplant sind. Ohne Deck
   (Platzhalter, dessen Deck gelöscht wurde) bleibt es bei einem Exemplar —
   sonst stünde in der Anzahl-Spalte eine 0 für eine Karte, die man will. */
const wunschAnzahl = c => wunschDecks(c).reduce((s, x) => s + x.qty, 0) || 1;

function sortWert(key, c, e) {
  const qty = e ? e.qty : c.qty;
  if (key === "name")  return c.disp;
  if (key === "mana")  return c.cmc;
  if (key === "qty")   return qty;
  if (key === "wunsch") return wunschAnzahl(c);
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

/* Farbidentitäts-Filter: EXAKTE Übereinstimmung. Die angehakten Farbfelder
   sind genau die gewünschte Identität. Eine farblose Identität ([]) wird als
   „C" dargestellt, damit „nur Farblos angehakt" ≠ „nichts angehakt" ist. Noch
   nicht erfasste Karten (color_identity == null) passen zu keiner Auswahl. */
function farbidentPasst(c, sel) {
  const ci = c.color_identity;
  if (!Array.isArray(ci)) return false;
  const sig = ci.length ? ci : ["C"];
  if (sig.length !== sel.length) return false;
  const s = new Set(sig);
  return sel.every(x => s.has(x));
}

/* Aktuell angehakte Farbidentitäts-Felder (W/U/B/R/G/C) des Bereichs. */
const ciAuswahl = bereich => $$(lid(bereich, "ci-filter") + " input[data-ci]:checked").map(i => i.dataset.ci);

/* Angehakte Kartentypen des Typ-Filters (englische Schlüssel wie in TYPEN). */
const typAuswahl = bereich => $$(lid(bereich, "type-filter") + " input[data-typ]:checked").map(i => i.dataset.typ);

/* Gewähltes Set steht je Bereich in listSet ("" = Alle). Kein natives <select>,
   deshalb hält eine Variable den Zustand; renderSetFilter zeichnet ihn. */
function filtered(bereich = "coll") {
  const q = lel(bereich, "q").value.trim().toLowerCase();
  // Die Wunschliste hat keinen Ausführungs-Filter (jede Wunschkarte entsteht
  // als „Normal"), deshalb hier nicht auf sein Vorhandensein bestehen.
  const foilEl = lel(bereich, "f-foil");
  const ff = foilEl ? foilEl.value : "";
  const typen = typAuswahl(bereich);
  const ci = ciAuswahl(bereich);
  const set = listSet[bereich];
  const s = listSort[bereich];
  // Welche Hälfte der Zeilen überhaupt in Frage kommt, entscheidet LISTE:
  // besessen (Bestand > 0) für die Sammlung, eingeplant-aber-fehlend
  // (Bestand 0) für die Wunschliste.
  return LISTE[bereich].karten().filter(c =>
    (!q || c.name.toLowerCase().includes(q) || c.disp.toLowerCase().includes(q) ||
           (c.set_name || "").toLowerCase().includes(q)) &&
    (!set || c.set === set) &&
    (ff === "" || String(c.foil ? 1 : 0) === ff) &&
    // Typen als ODER-Mehrfachauswahl: eine Karte reicht, wenn sie einen der
    // angehakten Typen trägt ("Artifact Creature" passt zu Artefakt UND Kreatur).
    (!typen.length || typen.some(en => typMatch(c.type_line, en))) &&
    (!ci.length || farbidentPasst(c, ci))
  ).sort((a, b) => cmpWert(sortWert(s.key, a), sortWert(s.key, b), s.dir));
}

/* Farbidentität für Altbestand einmalig nachladen: Karten ohne color_identity
   sammelweise über Scryfalls /cards/collection holen (75 je Anfrage) und in
   WENIGEN Sammel-Updates speichern (nach Identität gruppiert). Läuft im
   Hintergrund beim ersten Laden; ist alles erfasst, tut die Funktion nichts. */
/* --------------------------------------- Fremdsprachige Zeilen geraderücken
   Altbestand: Zeilen, die eine Fremdsprache behaupten, aber den ENGLISCHEN
   Druck halten — erkennbar daran, dass der gedruckte Name fehlt (den führt
   Scryfall bei jeder fremdsprachigen Auflage). So entstanden sie über den
   Scan-Weg, wo die Sprache aus dem Dropdown kommt, die Karte aber über
   findByCode aufgelöst wird: Kennt Scryfall die Auflage in der Sprache nicht,
   fällt findByCode auf Englisch zurück — geschrieben wird trotzdem die
   gewünschte Sprache. Dasselbe konnte der Zieh-Import über Cardmarket liefern.

   Aufgeräumt wird in zwei Stufen, genau wie beim Import (inSprache):
   1. Gibt es die AUFLAGE in der Sprache, wird sie übernommen — dann stimmt
      auch das Bild.
   2. Sonst wenigstens der gedruckte Name aus einer Schwester-Auflage.
   Findet sich beides nicht (typisch für Tokens), bleibt die Zeile unberührt.

   Angefasst werden ausschließlich Anzeigefelder. Menge, Zustand, Ausführung,
   Sprache und Preis bleiben, wie der Nutzer sie erfasst hat. */
/* Gedächtnis für Auflagen, die in einer Sprache nichts hergeben. Gerätelokal
   und bewusst gedeckelt: Es ist eine Sparmaßnahme, kein Datenbestand — geht es
   verloren, wird eben einmal mehr nachgefragt. Schlüssel ist scryfall_id +
   Sprache, denn dieselbe Auflage kann auf Deutsch leer ausgehen und auf
   Japanisch nicht. */
const TAUB_MAX = 400;
function ziehTaubeAuflagen() {
  try { return new Set(JSON.parse(localStorage.getItem("mtg-ohne-druckname") || "[]")); }
  catch { return new Set(); }
}
function taubVermerken(schluessel) {
  const s = ziehTaubeAuflagen();
  if (s.has(schluessel)) return;
  s.add(schluessel);
  // Beim Überlaufen die ältesten fallen lassen (Set behält die Einfügefolge).
  const liste = [...s].slice(-TAUB_MAX);
  try { localStorage.setItem("mtg-ohne-druckname", JSON.stringify(liste)); } catch { /* voll */ }
}

async function backfillGedruckteNamen() {
  if (backfillGedruckteNamen._laeuft) return;
  // Was einmal nichts hergab, gibt bei nächster Gelegenheit wieder nichts her:
  // Tokens und Karten, die Scryfall in dieser Sprache schlicht nicht führt.
  // Ohne dieses Gedächtnis fragte JEDER App-Start sie erneut ab — für immer.
  const taub = ziehTaubeAuflagen();
  const offen = CARDS.filter(c => c.lang && c.lang !== "en" && !c.printed_name &&
                                  c.scryfall_id && !taub.has(c.scryfall_id + "/" + c.lang));
  if (!offen.length) return;
  backfillGedruckteNamen._laeuft = true;
  let geaendert = 0;
  try {
    for (const zeile of offen) {
      let alt = null;
      try { alt = await sfById(zeile.scryfall_id); } catch { continue; }
      if (!alt) continue;
      let neu = null;
      try { neu = await inSprache(alt, zeile.lang); } catch { continue; }
      if (!neu || !neu.printed_name) {              // nichts gewonnen
        taubVermerken(zeile.scryfall_id + "/" + zeile.lang);
        continue;
      }

      const patch = { printed_name: neu.printed_name };
      const pty = printedTypeOf(neu); if (pty != null) patch.printed_type_line = pty;
      const pt  = printedTextOf(neu); if (pt  != null) patch.printed_text = pt;
      // Nur wenn Scryfall die Auflage wirklich in dieser Sprache führt, wandert
      // auch die Kennung mit — und damit das Bild. Der geliehene Name allein
      // ändert die Auflage nicht.
      const echteAuflage = neu.id && neu.id !== alt.id;
      if (echteAuflage) {
        patch.scryfall_id = neu.id;
        patch.img = imgOf(neu) || zeile.img;
        const fc = facesOf(neu); if (fc) patch.faces = fc;
      }
      try {
        const { error } = await sb.from("cards").update(patch)
          .eq("id", zeile.id).eq("user_id", USER.id);
        // Die Auflage kann schon als eigene Zeile liegen (unique über
        // user_id+scryfall_id+foil+lang+condition). Dann ohne Kennung erneut:
        // der Name allein ist immer noch besser als nichts.
        if (error && echteAuflage) {
          delete patch.scryfall_id; delete patch.img; delete patch.faces;
          await sb.from("cards").update(patch).eq("id", zeile.id).eq("user_id", USER.id);
        } else if (error) continue;
      } catch { continue; }
      Object.assign(zeile, patch);
      zeile.disp = zeile.printed_name || zeile.name;
      geaendert++;
    }
  } finally { backfillGedruckteNamen._laeuft = false; }
  if (geaendert) { zeichneOffeneKartenliste(); toast(t("fix.printedNames", { n: geaendert })); }
}

async function backfillFarbident() {
  if (backfillFarbident._laeuft) return;
  const fehlen = CARDS.filter(c => c.color_identity == null && c.scryfall_id);
  if (!fehlen.length) return;
  backfillFarbident._laeuft = true;
  try {
    const sids = [...new Set(fehlen.map(c => c.scryfall_id))];
    const ciBySid = new Map();
    for (let i = 0; i < sids.length; i += 75) {
      let cards = [];
      try { cards = await sfCollection(sids.slice(i, i + 75)); } catch { continue; }
      for (const card of cards) ciBySid.set(card.id, farbIdentOf(card) || []);
    }
    if (!ciBySid.size) return;
    // Nach Identitätswert gruppieren → höchstens ~32 Sammel-Updates statt
    // Hunderter Einzelschreibungen.
    const grp = new Map();
    for (const [sid, ci] of ciBySid) {
      const key = JSON.stringify(ci);
      if (!grp.has(key)) grp.set(key, { ci, sids: [] });
      grp.get(key).sids.push(sid);
    }
    for (const { ci, sids: gs } of grp.values()) {
      for (let i = 0; i < gs.length; i += 150) {   // .in()-Liste kurz halten (URL-Länge)
        const chunk = gs.slice(i, i + 150);
        try {
          await sb.from("cards").update({ color_identity: ci })
            .in("scryfall_id", chunk).eq("user_id", USER.id).is("color_identity", null);
          const set = new Set(chunk);
          for (const c of CARDS) if (set.has(c.scryfall_id) && c.color_identity == null) c.color_identity = ci;
        } catch { /* beim nächsten Laden erneut versuchen */ }
      }
    }
    zeichneOffeneKartenliste();
  } finally { backfillFarbident._laeuft = false; }
}

/* ------------------------------------------- Geteiltes Preisarchiv (MTGJSON)
   Scryfall kennt nur den Tagespreis — einen Verlauf gibt es dort nicht.
   MTGJSON liefert je Lauf ~90 Tage, die ein Backfill-Job (GitHub Action, siehe
   scripts/price-backfill) in die geteilte Tabelle price_history legt: dieselben
   Werte für alle Nutzer, deshalb je scryfall_id nur einmal. Hier laden wir die
   EUR-Reihen für den eigenen Bestand nach und legen sie beim Anzeigen UNTER die
   persönliche Vorwärts-Historie (cards.hist).

   Wie WEIT die Reihen zurückreichen, hängt daran, wie lange der Job schon
   läuft: er mischt sein 90-Tage-Fenster in den Bestand, statt ihn zu ersetzen
   (merge_price_history), also wächst das Archiv mit jedem Lauf über die 90
   Tage hinaus. Für die App ändert das nichts außer der Länge der Reihe —
   deshalb rechnet der Graph mit einer echten Zeitachse (siehe priceChart).

   Fehlt die Tabelle (Schema noch nicht nachgezogen) oder lief der Job nie,
   bleibt alles beim Alten — die App zeigt dann nur die eigenen Punkte. */
let HISTMKT = new Map();   // scryfall_id → { normal:[{d,v}], foil:[{d,v}] } (EUR)

async function ladePreisHistorie() {
  if (ladePreisHistorie._laeuft) return;
  const sids = [...new Set(CARDS.map(c => c.scryfall_id).filter(Boolean))]
    .filter(s => !HISTMKT.has(s));
  if (!sids.length) return;
  ladePreisHistorie._laeuft = true;
  try {
    for (let i = 0; i < sids.length; i += 200) {   // .in()-Liste kurz halten (URL-Länge)
      const chunk = sids.slice(i, i + 200);
      const { data, error } = await sb.from("price_history")
        .select("scryfall_id, prices").in("scryfall_id", chunk);
      if (error) return;   // Tabelle fehlt o. Ä.: still bleiben, nicht den Start stören
      for (const row of data || []) {
        const eur = row.prices && row.prices.eur;
        HISTMKT.set(row.scryfall_id, {
          normal: Array.isArray(eur?.normal) ? eur.normal : [],
          foil:   Array.isArray(eur?.foil) ? eur.foil : [],
        });
      }
      // Karten ohne Treffer als „nachgeschaut, nichts da" vermerken, damit ein
      // zweiter Lauf sie nicht erneut abfragt.
      for (const s of chunk) if (!HISTMKT.has(s)) HISTMKT.set(s, { normal: [], foil: [] });
    }
    zeichneOffeneKartenliste();
  } finally { ladePreisHistorie._laeuft = false; }
}

/* Die persönliche Historie (cards.hist) über das MTGJSON-Fundament legen:
   MTGJSON deckt die ~90 Tage bis gestern ab, die eigenen Punkte den aktuellen
   Rand — und gewinnen bei gleichem Datum, denn sie sind der Preis, den die
   Liste zeigt. Ergebnis nach Datum sortiert, ohne Dubletten. Ohne MTGJSON-Daten
   (oder bei leerer Foil-/Normal-Reihe) kommt unverändert cards.hist zurück, das
   bisherige Verhalten. Foil und Normal sind getrennte Reihen — passend zu
   priceOf(c, foil), aus dem die eigenen Punkte stammen. */
function mergedHist(c) {
  const mkt  = HISTMKT.get(c.scryfall_id);
  const base = mkt ? (c.foil ? mkt.foil : mkt.normal) : null;
  const pers = Array.isArray(c.hist) ? c.hist : [];
  if (!base || !base.length) return pers;
  const byDate = new Map();
  for (const p of base) if (p && p.d != null) byDate.set(p.d, Number(p.v));
  for (const p of pers) if (p && p.d != null) byDate.set(p.d, Number(p.v));
  return [...byDate.entries()]
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([d, v]) => ({ d, v }));
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
  const graph = spark(mergedHist(c));
  return graph ? `${eur(c.price)}<br>${graph}` : eur(c.price);
}

/* --------------------------- Gemeinsame Kartentabelle -----------------
   Sammlung, Deck und Wunschliste zeigen dieselben Zeilen. Drei Dinge
   unterscheiden sich im Deck: die Anzahl ist die Deck-Menge (deck_entries.qty,
   nicht der Sammlungsbestand), eine Spalte zeigt den Fehlbestand, und das Kreuz
   löst nur die Zuordnung — die Karte bleibt in der Sammlung. */
/* Das Deck zeigt bewusst weniger: Zustand, Erscheinungsdatum, Hinzugefügt
   und Preis stehen in der Detailansicht — hier zählt, welche Karte wie oft
   drin ist und ob sie da ist. Bild, Name, Mana, Set und Sprache stehen
   dagegen an derselben Stelle wie in der Sammlung, und sortierbar sind beide.
   Eine Spalte "Wert" (Preis × Anzahl) gibt es nicht mehr: sie wiederholte je
   Zeile eine Multiplikation, die man im Kopf macht. Summiert wird weiterhin —
   oben als Marktwert der Sammlung und je Deck im Deckkopf. */
/* Die Wunschliste lässt weg, was an einer Karte hängt, die man noch gar nicht
   in der Hand hatte: Zustand (immer die Vorgabe NM) und Erscheinungsdatum.
   Statt der Bestandszahl — die ist per Definition 0 — steht dort, in welchen
   Decks der Platz schon vergeben ist und wie viele Exemplare das zusammen sind.
   Der Preis bleibt: an eine Wunschliste stellt man genau diese Frage. */
function cardHead(modus) {
  const imDeck = modus === "deck";
  const wunsch = modus === "wish";
  const s = k => ` data-s="${k}"`;
  return `<tr>
    <th class="hide-s"></th>
    <th${s("name")}>${esc(t("th.card"))}</th>
    <th${s("mana")} class="num">${esc(t("th.mana"))}</th>
    <th${s("set_name")} class="hide-s">${esc(t("th.set"))}</th>
    <th${s("lang")} class="hide-s">${esc(t("th.langShort"))}</th>
    ${imDeck || wunsch ? "" : `<th${s("condition")} class="hide-s">${esc(t("th.condShort"))}</th>
    <th${s("released")} class="hide-s">${esc(t("th.released"))}</th>`}
    ${imDeck ? "" : `<th${s("added")} class="hide-s">${esc(t("th.added"))}</th>`}
    <!-- Eigene Kategorie: nur im Deck, denn sie gehört dem Deckplatz und nicht
         der Karte. Ohne data-s, also nicht sortierbar — danach zu sortieren
         hieße, die Gruppen zu wiederholen, die genau daraus entstehen. -->
    ${imDeck ? `<th>${esc(t("kat.col"))}</th>` : ""}
    ${wunsch ? `<th class="hide-s">${esc(t("th.plannedIn"))}</th>` : ""}
    ${wunsch ? `<th${s("wunsch")} class="num">${esc(t("th.qty"))}</th>`
             : `<th${s("qty")} class="num">${esc(t("th.qty"))}</th>`}
    ${imDeck ? `<th${s("fehlt")} class="num">${esc(t("th.stock"))}</th>`
             : `<th${s("price")} class="num">${esc(t("th.price"))}</th>`}
    <th></th><th></th>
  </tr>`;
}

function cardRow(c, o = {}) {
  const imDeck = !!o.deckId;
  const wunsch = !!o.wunsch;
  const decks = wunsch ? wunschDecks(c) : [];
  const qty = imDeck ? o.qty : (wunsch ? wunschAnzahl(c) : c.qty);
  // Fehlbestand gegen den AUFLAGEN-Bestand (Sprache/Foil/Zustand egal), nicht
  // gegen die einzelne verknüpfte Zeile — wichtig bei importierten Decks.
  const fehlt = imDeck ? Math.max(0, qty - bestandVon(c)) : 0;
  return `
    <!-- Im Deck ist die Zeile ziehbar: Anfassen blendet die Fächer als
         Ablageflächen ein (katDropAn). Die Gruppe, aus der gezogen wurde, steht
         in data-vonkat — nur so lässt sich "verschieben" von "hinzufügen"
         unterscheiden; leer heißt "aus keiner". -->
    <tr data-id="${c.id}"${imDeck ? ` data-deck="${esc(o.deckId)}" data-vonkat="${esc(o.vonKat || "")}"` : ""}${wunsch ? " data-wish" : ""}>
      <!-- Erste Zelle: im Deck zusätzlich der Griff zum Ziehen. Er steht sichtbar
           da, weil man einer Zeile sonst nicht ansieht, dass sie sich anfassen
           lässt — das war der eigentliche Fehler des ersten Anlaufs. -->
      <td class="hide-s">${imDeck ? `<span class="zieh-griff" data-ziehgriff
             title="${esc(t("katdrop.handle"))}" aria-hidden="true">&#8942;&#8942;</span>` : ""}${
        c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" data-view
             style="cursor:pointer" title="${esc(t("row.viewTitle"))}">` : ""}</td>
      <td><div data-view style="cursor:pointer" title="${esc(t("row.viewTitle"))}">${esc(c.disp)}</div>
          <div style="font-size:12px;color:var(--dim)">
            ${c.printed_name && c.printed_name !== c.name ? esc(c.name) + " &middot; " : ""}
            ${c.foil ? '<span class="pill foil">Foil</span> ' : ""}#${esc(c.cn)}</div></td>
      <td class="num mana-spalte" title="${c.mana_cost == null ? esc(t("row.manaNone"))
        : esc(t("row.manaValue", { n: c.cmc ?? "?" }))}">${manaHtml(c.mana_cost)}</td>
      <td class="hide-s set-spalte" title="${esc(c.set_name || c.set || "")}">${
        setSymbol(c.set, c.rarity)}${esc((c.set || "").toUpperCase())}</td>
      <td class="hide-s">${langHtml(c.lang)}</td>
      ${imDeck || wunsch ? "" : `<td class="hide-s">${condBadge(c.condition)}</td>
      <td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap">${esc(datShort(c.released))}</td>`}
      ${imDeck ? "" : `<td class="hide-s" style="font-size:12px;color:var(--dim);white-space:nowrap;line-height:1.35">${dtStacked(c.added)}</td>`}
      <!-- Zuordnung zu eigenen Kategorien. Kein <select>, seit eine Karte in
           mehreren stehen darf: Ein Auswahlfeld kennt genau einen Wert, und
           ein Mehrfach-select ist auf dem Handy unbedienbar. Stattdessen zeigt
           die Zelle die Fächer als Marken und öffnet auf Klick die Auswahl —
           die primäre steht vorn und ist hervorgehoben. -->
      ${imDeck ? `<td class="kat-zelle">${katZelleHtml(o.kategorien, o.kats)}</td>` : ""}
      ${wunsch ? `<td class="hide-s wunsch-decks">${decks.length
        // Deckname und Anzahl in eigenen Elementen: nur der NAME wird bei
        // Platzmangel gekürzt, die Anzahl steht immer da — sie ist die
        // eigentliche Aussage der Spalte. Der Titel trägt den ganzen Namen,
        // damit das Kürzen nichts verschluckt.
        ? decks.map(d => `<button class="deck-chip" data-godeck="${esc(d.id)}"
             title="${esc(d.name)} &middot; ${d.qty}&times; — ${esc(t("detail.inDeckGo"))}"><span
             class="dc-nm">${esc(d.name)}</span><span class="dc-n">&middot; ${d.qty}&times;</span></button>`).join("")
        : `<span class="hint">${esc(t("wish.noDeck"))}</span>`}</td>` : ""}
      <!-- 62 px ist die schmalste Breite, bei der drei Stellen noch ganz
           hineinpassen (gemessen; darunter wird abgeschnitten). Zwei Stellen
           sind der Regelfall, aber 100 Wälder sind kein Sonderfall genug, um
           sie unlesbar zu machen. Vorher waren es 54 px — der eigene Steller
           ist ein paar Pixel breiter als die Browser-Pfeile, die dort früher
           standen, und die Differenz ging genau von der dritten Stelle ab.
           In der Wunschliste steht dort keine Eingabe: die Menge gehört dem
           Deckplatz, nicht dem Platzhalter — geändert wird sie im Deck. -->
      <td class="num">${wunsch
        ? `<b>${qty}</b>`
        : `<input type="number" min="0" value="${qty}" data-qty
             style="width:62px;padding:4px 6px;text-align:right">`}</td>
      ${imDeck ? `<td class="num">${fehlt
        ? `<span class="pill err">${esc(t("row.missing", { n: fehlt }))}</span>`
        : `<span class="pill ok">${esc(t("row.present"))}</span>`}</td>`
      : `<td class="num" style="line-height:1.5">${preisZelle(c)}</td>`}
      <!-- Cardmarket: In der Wunschliste über cmKaufLink statt über die cm_id.
           Eine Wunschkarte hat nämlich keine: add_wish_to_deck legt die Zeile
           mit cm_id = NULL an (die Produkt-ID kommt sonst vom Scan, und
           gescannt wurde hier nichts). Ohne Rückfall fehlte im Wunsch-Zeile
           ausgerechnet der Link zum Kaufen — der Grund, die Liste zu führen.
           cmKaufLink nimmt die cm_id, wenn es sie doch gibt (Deck-Import
           bringt sie mit), sonst die Cardmarket-Suche nach dem Kartennamen. -->
      <td class="num cm-cell" style="white-space:nowrap">${(wunsch ? cmKaufLink(c) : cmLink(c.cm_id))
        ? `<a class="cm cm-logo" href="${esc(wunsch ? cmKaufLink(c) : cmLink(c.cm_id))}" target="_blank" rel="noopener noreferrer"
             title="${esc(t(wunsch && !c.cm_id ? "buy.cmSearch" : "row.cmTitle"))}">${CM_LOGO}</a>` : ""}${sfLink(c)
        ? `<a class="cm sf-logo" href="${esc(sfLink(c))}" target="_blank" rel="noopener noreferrer"
             title="${esc(t("row.sfTitle"))}">${SF_LOGO}</a>` : ""}</td>
      <td class="num" style="white-space:nowrap">
        ${imDeck
          // Bearbeiten und Preis stehen im Deck in der Detailansicht — hier
          // nur, was das Deck betrifft: Hauptkarte und Zuordnung lösen.
          // Der Stern erscheint nur bei möglichen Commandern; die Regel selbst
          // erzwingt ein Trigger in der Datenbank.
          ? `${istCommanderFaehig(c)
              ? `<button class="btn ghost sm${o.istHaupt ? " star-on" : ""}" data-main
                title="${o.istHaupt ? esc(t("row.mainIsTitle")) : esc(t("row.mainSetTitle"))}">${o.istHaupt ? "&#9733;" : "&#9734;"}</button>`
              : ""}${(o.istZweit || o.partnerOk)
              ? `<button class="btn ghost sm${o.istZweit ? " star2-on" : ""}" data-second
                title="${o.istZweit ? esc(t("row.second2IsTitle")) : esc(t("row.second2SetTitle"))}">${o.istZweit ? "&#10022;" : "&#10023;"}</button>`
              : ""}`
          // Die Wunschliste kennt weder Bearbeiten (Sprache, Zustand und
          // Ausführung entscheidet man beim Kauf, nicht beim Wünschen) noch die
          // Verkaufsliste — verkaufen lässt sich nur, was man hat. Der Preis
          // bleibt: er ist der Grund, eine Wunschliste zu führen.
          : wunsch
          ? `<button class="btn ghost sm" data-price title="${esc(t("row.priceTitle"))}">&#8635;</button>`
          : `<button class="btn ghost sm" data-edit title="${esc(t("row.editTitle"))}">&#9998;</button>
        <button class="btn ghost sm" data-price title="${esc(t("row.priceTitle"))}">&#8635;</button>
        <button class="btn ghost sm sell-toggle${c.for_sale ? " on" : ""}" data-sell title="${esc(t("row.sellTitle"))}">&#8364;</button>`}
        <button class="btn ghost sm" data-del title="${imDeck
          ? esc(t("row.removeFromDeck"))
          : wunsch ? esc(t("wish.removeTitle")) : esc(t("row.removeRow"))}">&times;</button>
      </td>
    </tr>`;
}

function wireCardRows(root) {
  root.querySelectorAll("tbody tr[data-id]").forEach(tr => {
    const id = tr.dataset.id, deck = tr.dataset.deck;
    const wunsch = "wish" in tr.dataset;

    tr.querySelectorAll("[data-godeck]").forEach(ch =>
      ch.onclick = () => zeigeDeck(ch.dataset.godeck));

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

    // Die Wunschliste hat kein Mengenfeld — dort steht die Zahl nur da.
    const qb = tr.querySelector("[data-qty]");
    if (qb) qb.onchange = async ev => {
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

    // Eigene Kategorien zuordnen (nur im Deck) — der Dialog erledigt alles
    // Weitere, weil eine Karte in mehreren Fächern stehen darf. Auf Touch der
    // einzige Weg, am Rechner die Alternative zum Ziehen.
    const kat = tr.querySelector("[data-kat]");
    if (kat) kat.onclick = () => kategorienZuordnen(deck, id);

    if (deck) {
      // Der Griff ist das verlässliche Ziel: Er trägt touch-action:none, also
      // rollt die Seite unter dem Finger nicht weg, während man zieht.
      const griff = tr.querySelector("[data-ziehgriff]");
      griff?.addEventListener("pointerdown", e => katZiehAnfassen(e, tr, deck, id));
      // Mit der Maus darf man die Zeile auch irgendwo sonst anfassen — dort ist
      // Rollen keine konkurrierende Geste. Mit dem Finger nur am Griff.
      tr.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse") katZiehAnfassen(e, tr, deck, id);
      });
      tr.addEventListener("pointermove", katZiehBewegt);
      tr.addEventListener("pointerup", katZiehLos);
    }

    const sl = tr.querySelector("[data-sell]");
    if (sl) sl.onclick = () => toggleSale(id, sl);

    const mb = tr.querySelector("[data-main]");
    if (mb) mb.onclick = () => setMainCard(deck, id);

    const s2 = tr.querySelector("[data-second]");
    if (s2) s2.onclick = () => setSecondCard(deck, id);

    const db = tr.querySelector("[data-del]");
    if (db) db.onclick = async () => {
      // Ein Wunsch zieht Deckplätze nach sich — das wird gefragt, nicht getan.
      if (wunsch) return wunschEntfernen(id);
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

/* ======================= Wunschliste ↔ Sammlung =======================
   Eine Wunschkarte ist keine eigene Tabelle, sondern eine Sammlungszeile mit
   BESTAND 0: „im Deck eingeplant, aber nicht besessen". Damit liegt sie genau
   dort, wo sie hingehört — der Deckplatz hängt an ihr wie an jeder anderen
   Karte, und Bild, Preis und Kartendaten sind dieselben. Die Sammlung blendet
   diese Zeilen aus (filtered), die Wunschliste zeigt genau sie. */

/* Karte von der Wunschliste nehmen. Sie ist nur ein Platzhalter — mit ihr
   verschwindet auch der Deckplatz, den sie belegt (deck_entries hängt per
   ON DELETE CASCADE an der Kartenzeile). Genau das ist gewollt: den Wunsch zu
   streichen und die Lücke im Deck stehen zu lassen, hieße einen Platz für
   nichts zu reservieren. Weil das mehr als eine Zeile trifft, wird gefragt —
   und zwar mit den Namen der betroffenen Decks. */
async function wunschEntfernen(id) {
  const c = CARDS.find(x => x.id === id);
  if (!c) return;
  const decks = wunschDecks(c);
  const name = c.disp || c.name;
  // Ein noch nicht besessener Commander ist möglich (die Regel prüft nur die
  // Typzeile). Sein Wegfall löscht kein Deck, nimmt ihm aber die Hauptkarte —
  // das gehört vor die Entscheidung, nicht danach in einen Fehlerton.
  const alsCmd = DECKS.filter(d => d.main_card_id === id || d.second_card_id === id);
  const ok = await confirmDlg(`<b>${esc(t("wish.removeTitle"))}</b>
    <p style="margin:8px 0 0">${decks.length
      ? t("wish.removeAsk", { name: esc(name), decks: esc(decks.map(d => d.name).join(", ")) })
      : t("wish.removeAskNoDeck", { name: esc(name) })}</p>
    ${alsCmd.length ? `<p class="hint" style="margin:8px 0 0;color:var(--err)">${
      esc(t("wish.removeCommander", { decks: alsCmd.map(d => d.name).join(", ") }))}</p>` : ""}`);
  if (!ok) return;
  try {
    const { error } = await sb.from("cards").delete().eq("id", id);
    if (error) throw error;
    await reload(); renderAll();
    toast(t("wish.removed", { name }));
  } catch (e) { toast(dbErr(e)); }
}

/* Wunschliste gegen den Bestand abgleichen — läuft nach JEDEM Zugang zur
   Sammlung (Scan, Handeingabe, beide Importe).

   Der Fall: Man plant eine Karte ins Deck, die man nicht hat; es entsteht eine
   Wunschzeile mit Bestand 0, die den Deckplatz hält. Später kauft man die Karte
   und scannt sie — meist in einer ANDEREN Auflage, also als eigene Zeile. Jetzt
   steht dieselbe Karte zweimal in der Datenbank: der Platzhalter mit dem
   Deckplatz und das echte Exemplar ohne.

   Richtig ist dann nicht, das Exemplar zusätzlich ins Deck zu legen — der Platz
   ist längst vergeben, die Karte wäre die 101. und im Commander zugleich eine
   zweite Kopie derselben Karte. Richtig ist, den Deckplatz UMZUHÄNGEN und den
   Platzhalter fallen zu lassen. Das Umhängen erledigt fulfil_wish_in_deck in
   einem Schritt in der Datenbank, damit das Deck zwischendurch weder zu groß
   noch zu klein ist.

   Die Funktion ist wiederholbar und arbeitet über den ganzen Bestand, nicht nur
   über die eben gescannte Karte: Gibt es zu einer Wunschzeile keine besessene
   Auflage, tut sie nichts. So heilt sie auch Wünsche, die aus anderen Gründen
   stehen geblieben sind. Gibt die Namen der eingelösten Karten zurück. */
async function wunschAbgleich() {
  const erfuellt = [];
  for (const w of CARDS.filter(c => c.qty === 0)) {
    // Die besessene Auflage derselben Karte — zuletzt erfasste zuerst, das ist
    // bei mehreren die eben hinzugefügte.
    const eigen = CARDS
      .filter(c => c.qty > 0 && c.id !== w.id && selbeKarte(c, w))
      .sort((a, b) => String(b.added || "").localeCompare(String(a.added || "")))[0];
    if (!eigen) continue;
    try {
      for (const d of DECKS) {
        const e = (d.entries || []).find(x => x.cardId === w.id);
        if (!e) continue;
        const { error } = await sb.rpc("fulfil_wish_in_deck", {
          p_deck: d.id, p_from_card: w.id, p_to_card: eigen.id, p_n: e.qty });
        if (error) throw error;
      }
      // War der Wunsch der Commander des Decks, muss auch dieser Verweis mit
      // umziehen. Sonst nähme das Löschen der Wunschzeile dem Deck still seine
      // Hauptkarte (decks.main_card_id ist ON DELETE SET NULL).
      for (const d of DECKS) {
        const patch = {};
        if (d.main_card_id === w.id) patch.main_card_id = eigen.id;
        if (d.second_card_id === w.id) patch.second_card_id = eigen.id;
        if (!Object.keys(patch).length) continue;
        const { error } = await sb.from("decks").update(patch).eq("id", d.id);
        if (error) throw error;
      }
      // Jetzt hängt nichts mehr an ihr: kein Bestand, kein Deckplatz.
      const { error } = await sb.from("cards").delete().eq("id", w.id);
      if (error) throw error;
      erfuellt.push(w.disp || w.name);
    } catch (e) {
      // Ein misslungener Abgleich darf den Zugang nicht mitreißen: die Karte
      // IST in der Sammlung, nur der Platzhalter blieb stehen. Der nächste
      // Zugang versucht es erneut.
      toast(dbErr(e));
    }
  }
  return erfuellt;
}

/* Neu laden nach einem Zugang zur Sammlung — mit Wunschabgleich. Bewusst
   getrennt von reload(): das läuft an Dutzenden Stellen und liest nur; eine
   Funktion, die beim Lesen schreibt, wäre an keiner davon zu erwarten. */
async function reloadMitWunschAbgleich() {
  // Vor dem Neuladen festhalten, was gerade noch Wunsch war. Traf der Zugang
  // die Wunschzeile SELBST (gleiche Auflage, Sprache, Zustand und Ausführung),
  // hat add_card sie schlicht auf Bestand 1 gesetzt: nichts umzuhängen, der
  // Deckplatz sitzt schon richtig — erfüllt ist der Wunsch trotzdem.
  const vorher = new Map(CARDS.filter(c => c.qty === 0).map(c => [c.id, c.disp || c.name]));
  await reload();
  const erfuellt = await wunschAbgleich();
  if (erfuellt.length) await reload();
  for (const [id, name] of vorher)
    if ((CARDS.find(c => c.id === id)?.qty ?? 0) > 0) erfuellt.push(name);
  return erfuellt;
}

/* Meldung über eingelöste Wünsche. Leer, wenn keiner dabei war. */
function wunschMeldung(erfuellt) {
  const namen = [...new Set(erfuellt || [])];
  if (!namen.length) return "";
  return namen.length === 1
    ? t("wish.fulfilled", { name: namen[0] })
    : t("wish.fulfilledN", { n: namen.length });
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

/* Karten je Sammlungsseite aus dem Profil (Einstellungen): 0 = alles in einer
   Liste, NULL/fehlt = Voreinstellung 50. Gilt für Sammlung und Wunschliste. */
function seitenGroesse() {
  const n = Number(PROFILE?.page_size);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

/* Zeichnet das eigene Set-Dropdown neu: „Alle" plus jedes vorkommende Set, jeweils
   mit neutralem Keyrune-Icon und Setcode. Der aktuelle Filter (listSet) bleibt
   erhalten; zeigt die Liste das gewählte Set nicht mehr (letztes Exemplar
   verkauft/gelöscht, Wunsch erfüllt), fällt er auf „Alle" zurück. Trigger zeigt
   die Auswahl. Klicks liegen delegiert auf dem Menü (in wireApp), deshalb genügt
   hier das Neusetzen des innerHTML. */
function renderSetFilter(karten, bereich = "coll") {
  const sets = [...new Set(karten.map(c => c.set))].filter(Boolean).sort();
  if (listSet[bereich] && !sets.includes(listSet[bereich])) listSet[bereich] = "";
  const gewaehlt = listSet[bereich];
  const eintrag = (code, label) =>
    `<li role="option" class="set-item${code === gewaehlt ? " on" : ""}" data-set="${esc(code)}"
         aria-selected="${code === gewaehlt}">${code ? setIcon(code) : ""}<span>${esc(label)}</span></li>`;
  lel(bereich, "set-menu").innerHTML =
    eintrag("", t("coll.all")) + sets.map(s => eintrag(s, s.toUpperCase())).join("");
  lel(bereich, "set-trigger-inner").innerHTML = gewaehlt
    ? `${setIcon(gewaehlt)}<span>${esc(gewaehlt.toUpperCase())}</span>`
    : esc(t("coll.all"));
}

/* Sammlung und Wunschliste in einem: Filter zeichnen, Treffer zählen, Tabelle
   und Blätterleiste bauen. Was die beiden unterscheidet, steckt in LISTE
   (welche Zeilen) und im Tabellenmodus (welche Spalten und Knöpfe). */
/* ------------------------------------------- Eben hinzugefügte Zeile zeigen
   Gemerkt wird die ID, NICHT das <tr>. Der Grund ist handfest: reload() stößt
   im Hintergrund Preisarchiv und Farbidentität an, und deren Nachträge zeichnen
   die Liste neu (zeichneOffeneKartenliste). Eine Klasse, die direkt am Element
   hing, war damit nach wenigen hundert Millisekunden fort — mitten in der
   Animation und regelmäßig, bevor der Blick nach dem Scrollen überhaupt ankam.
   Über die ID findet jedes Neuzeichnen die Markierung wieder.

   Damit das Neuzeichnen die Animation nicht von vorn beginnen lässt (was als
   Stottern zu sehen wäre), bekommt sie eine negative Verzögerung in Höhe der
   schon verstrichenen Zeit — sie läuft dann dort weiter, wo sie war. */
const TREFFER_MS = 2800;
let trefferZeile = null, trefferStart = 0, trefferUhr = 0;

function trefferMarkieren(id) {
  clearTimeout(trefferUhr);
  trefferZeile = id || null;
  trefferStart = Date.now();
  if (!trefferZeile) return;
  trefferUhr = setTimeout(() => {
    trefferZeile = null;
    $$("tr.treffer").forEach(tr => {
      tr.classList.remove("treffer");
      tr.style.removeProperty("--treffer-ab");
    });
  }, TREFFER_MS);
}

/* Nach jedem Zeichnen der Liste die Markierung wieder anlegen. Die verstrichene
   Zeit geht als NEGATIVE Verzögerung mit: die Animation setzt dort fort, wo sie
   beim Verwerfen der alten Zeile stand, statt neu aufzuleuchten. Als CSS-
   Variable, weil animation-delay nicht vererbt, die Animation aber an den
   Zellen hängt und die Markierung an der Zeile. */
function trefferAnwenden(tbl) {
  if (!trefferZeile || !tbl) return;
  const tr = tbl.querySelector(`tr[data-id="${CSS.escape(String(trefferZeile))}"]`);
  if (!tr) return;
  tr.style.setProperty("--treffer-ab", `-${Math.max(0, Date.now() - trefferStart)}ms`);
  tr.classList.add("treffer");
}

function renderKartenliste(bereich) {
  const wunsch = bereich === "wish";
  const rows = filtered(bereich);
  // Das Dashboard sitzt in einer eigenen Ansicht (renderDashboard) und nicht
  // mehr über der Sammlungstabelle.
  const alle = LISTE[bereich].karten();

  renderSetFilter(alle, bereich);

  // Trefferzähler: wie viele Zeilen die aktuellen Filter zeigen, von allen des
  // Bereichs. Ohne Filter nur die Gesamtzahl (kein „318 von 318"). Die
  // hervorgehobene Zahl baut die CSS (.coll-count b). In der Wunschliste steht
  // dahinter, was die angezeigten Karten zusammen kosten — die Frage, die man
  // an eine Wunschliste stellt.
  const cc = lel(bereich, "coll-count");
  if (cc) {
    const zahl = rows.length === alle.length
      ? t("coll.countAll", { total: `<b>${alle.length}</b>` })
      : t("coll.count", { n: `<b>${rows.length}</b>`, total: alle.length });
    const summe = wunsch
      ? rows.reduce((s, c) => s + (c.price || 0) * wunschAnzahl(c), 0) : 0;
    cc.innerHTML = zahl + (wunsch && rows.length
      ? ` &middot; ${t("wish.sum", { p: `<b>${eur(summe)}</b>` })}` : "");
  }

  const leer = lel(bereich, "coll-empty");
  leer.textContent = alle.length
    ? t("coll.emptyFilter")
    : t(wunsch ? "wish.empty" : "coll.empty");
  leer.style.display = rows.length ? "none" : "block";
  const tbl = lel(bereich, "tbl");
  tbl.style.display = rows.length ? "" : "none";

  // Seitenaufteilung — nur für die Tabelle. Die Seitenzahl klemmt sich fest,
  // falls Löschen oder ein engerer Filter sie über das Ende geschoben hat.
  const gr = seitenGroesse();
  const seiten = gr ? Math.max(1, Math.ceil(rows.length / gr)) : 1;
  listPage[bereich] = Math.max(0, Math.min(listPage[bereich], seiten - 1));
  const p = listPage[bereich];
  const seite = gr ? rows.slice(p * gr, (p + 1) * gr) : rows;

  tbl.querySelector("thead").innerHTML = cardHead(bereich);
  tbl.querySelector("tbody").innerHTML =
    seite.map(c => cardRow(c, wunsch ? { wunsch: true } : {})).join("");
  wireCardRows(tbl);
  trefferAnwenden(tbl);
  renderPager(rows.length, seiten, bereich);
  // Jeder Bereich führt seinen eigenen Zähler: die Sammlung den der
  // Verkaufsliste in der Filterzeile, die Wunschliste den am Navigationspunkt.
  if (wunsch) zeigeWunschZaehler(); else aktualisiereVerkaufZaehler();

  // Die Kopfzeile wird bei jedem Rendern neu gebaut, also auch die
  // Sortier-Handler neu hängen.
  tbl.querySelectorAll("th[data-s]").forEach(th => th.onclick = () => {
    sortUm(listSort[bereich], th.dataset.s);
    listPage[bereich] = 0;                 // neue Ordnung: oben anfangen
    renderKartenliste(bereich);
  });
}

function renderCollection() { renderKartenliste("coll"); }
function renderWunschliste() { renderKartenliste("wish"); }

/* Alle Filter der Sammlung räumen. Gebraucht, wenn der Blick auf eine BESTIMMTE
   Zeile springen soll, die gerade herausgefiltert ist — ein Sprung auf etwas
   Unsichtbares wäre keiner. */
function sammlungFilterZuruecksetzen() {
  const q = lel("coll", "q"); if (q) q.value = "";
  const foil = lel("coll", "f-foil"); if (foil) foil.value = "";
  listSet.coll = "";
  $$(lid("coll", "ci-filter") + " input[data-ci], " +
     lid("coll", "type-filter") + " input[data-typ]").forEach(i => { i.checked = false; });
  listPage.coll = 0;
}

/* In die Sammlung wechseln und auf EINE Zeile zeigen: richtige Seite
   aufschlagen, hinscrollen, kurz hervorheben.

   Das ist die Quittung des Zieh-Imports für sichere Treffer — statt einer
   Rückfrage, die nichts fragt, was die Zeile nicht besser beantwortet: dort
   stehen Bearbeiten und Entfernen ohnehin, und dort sieht man die Karte im
   Bestand statt in einem Kasten davor. Verdecken die Filter die Zeile gerade,
   werden sie geräumt — sonst zeigte der Sprung ins Leere. */
async function zeigeKarteInSammlung(id) {
  if (!id) return;
  $('nav button[data-v="coll"]')?.click();
  if (!filtered("coll").some(c => c.id === id)) sammlungFilterZuruecksetzen();
  const rows = filtered("coll");
  const idx = rows.findIndex(c => c.id === id);
  if (idx < 0) return;                       // z. B. sofort wieder entfernt
  const gr = seitenGroesse();
  listPage.coll = gr ? Math.floor(idx / gr) : 0;
  // Erst merken, dann zeichnen: renderKartenliste legt die Markierung selbst
  // an — und tut das bei jedem weiteren Zeichnen wieder, auch wenn ein
  // Nachtrag aus dem Hintergrund die Tabelle zwischendurch ersetzt.
  trefferMarkieren(id);
  renderKartenliste("coll");
  $(`#tbl tr[data-id="${CSS.escape(String(id))}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* Die gerade offene der beiden Kartenlisten neu zeichnen — für Nachträge, die
   im Hintergrund eintreffen (Farbidentität, Preisarchiv). Ist keine von beiden
   offen, gibt es nichts zu tun; beim Wechsel dorthin wird ohnehin gezeichnet. */
function zeichneOffeneKartenliste() {
  const id = $(".view.on")?.id;
  if (id === "v-coll") renderCollection();
  else if (id === "v-wish") renderWunschliste();
}

/* Zahl offener Wünsche am Navigationspunkt. Eine Wunschliste ist nur nützlich,
   wenn man sieht, dass etwas darauf steht, ohne sie zu öffnen. */
function zeigeWunschZaehler() {
  const el = $("#wish-badge");
  if (!el) return;
  const n = LISTE.wish.karten().length;
  el.textContent = n;
  el.hidden = !n;
}

/* Blätterleiste unter der Tabelle. Erscheint erst ab zwei Seiten. Kompakte
   Seitenliste: erste, letzte und die Umgebung der aktuellen Seite, Lücken
   als „…". */
function renderPager(gesamt, seiten, bereich = "coll") {
  const el = lel(bereich, "pager");
  if (!el) return;
  if (seiten <= 1) { el.innerHTML = ""; return; }
  const gr = seitenGroesse();
  const p = listPage[bereich];
  const von = p * gr + 1, bis = Math.min(gesamt, (p + 1) * gr);
  const nums = [...new Set([0, seiten - 1, p - 1, p, p + 1])]
    .filter(n => n >= 0 && n < seiten).sort((a, b) => a - b);
  let knoepfe = "", prev = -1;
  for (const n of nums) {
    if (prev >= 0 && n - prev > 1) knoepfe += '<span class="pager-dots">&hellip;</span>';
    knoepfe += `<button class="btn ghost sm${n === p ? " pager-on" : ""}" data-page="${n}">${n + 1}</button>`;
    prev = n;
  }
  el.innerHTML = `
    <button class="btn ghost sm" data-page="${p - 1}"${p === 0 ? " disabled" : ""}>&lsaquo; ${esc(t("pager.back"))}</button>
    ${knoepfe}
    <button class="btn ghost sm" data-page="${p + 1}"${p >= seiten - 1 ? " disabled" : ""}>${esc(t("pager.next"))} &rsaquo;</button>
    <span class="hint" style="margin-left:auto">${esc(t("pager.range", { von, bis, gesamt }))}</span>`;
  el.querySelectorAll("[data-page]").forEach(b => b.onclick = () => {
    listPage[bereich] = Math.max(0, Math.min(seiten - 1, parseInt(b.dataset.page)));
    renderKartenliste(bereich);
    // Beim Blättern an den Tabellenanfang — sonst steht man am Seitenfuß.
    // scroll-margin-top in der CSS hält den klebenden Kopf frei.
    lel(bereich, "tbl").scrollIntoView({ behavior: "smooth", block: "start" });
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

/* Farbidentität einer Karte (Scryfalls color_identity): die Farben aus Kosten,
   Farbindikator UND Regeltext-Mana-Symbolen. Anders als colors ist sie IMMER
   oben geführt (auch bei doppelseitigen Karten) und für Länder aussagekräftig
   (z. B. eine Zweifarben-Zulande trägt colors=[], aber color_identity=[U,R]).
   Deshalb ist SIE die richtige Grundlage für den Farbidentitäts-Filter. []
   heißt farblose Identität (eine Aussage), null „noch nicht erfasst". */
const farbIdentOf = card => Array.isArray(card?.color_identity) ? [...card.color_identity].sort() : null;

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

/* Der GEDRUCKTE Regeltext und die GEDRUCKTE Typzeile — die Fassung, die
   wirklich auf der Karte steht. Scryfall führt sie in printed_text /
   printed_type_line und liefert sie NUR bei fremdsprachigen Drucken; bei
   lang="en" fehlen die Felder ganz, denn dort IST der Oracle-Text das
   Gedruckte. Deshalb ist null hier kein Fehler, sondern der Normalfall — die
   Anzeige fällt dann auf oracle_text/type_line zurück.

   Warum das überhaupt eigene Spalten braucht: oracle_text und type_line sind
   bei JEDEM Druck englisch. Eine deutsche Karte lieferte darüber bisher einen
   deutschen Namen (printed_name nutzen wir seit je) und englische Fähigkeiten
   — genau die Mischung, die in der Detailansicht auffiel.

   WICHTIG: Diese beiden Felder sind reine ANZEIGE. Jede Regel-, Filter- und
   Typprüfung (Land, legendär, Deck-Kategorie, Commander-Singleton) läuft
   weiter über type_line/oracle_text — die sind sprachunabhängig vergleichbar,
   die gedruckte Fassung wäre es nicht. Aufbau wie oracleOf: einseitig oben,
   doppelseitig je Seite zusammengefügt. */
const printedTextOf = card => {
  if (typeof card?.printed_text === "string") return card.printed_text;
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.printed_text).filter(x => typeof x === "string");
  if (!angaben.length) return null;
  return angaben.join("\n//\n");
};

// Die Typzeile trennt Scryfall bei geteilten Karten mit " // " in EINER Zeile
// (nicht mit Zeilenumbruch wie den Regeltext) — hier genauso.
const printedTypeOf = card => {
  if (typeof card?.printed_type_line === "string") return card.printed_type_line;
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.printed_type_line).filter(x => typeof x === "string");
  if (!angaben.length) return null;
  return angaben.join(" // ");
};

/* Der gedruckte NAME. Denselben Rückfall braucht auch er: bei Abenteuer-,
   geteilten und Umdreh-Karten (adventure, split, flip) führt Scryfall Name,
   Typzeile und Regeltext AUSSCHLIESSLICH je Seite und bildet oben keine
   zusammengesetzte Fassung — card.printed_name ist dort undefined, obwohl
   card_faces[0].printed_name „Knochenmalmer-Riese" sagt. Ohne den Rückfall
   blieb der Name dieser Karten dauerhaft englisch, während Typzeile und
   Regeltext längst übersetzt waren.

   Strenger als die beiden Helfer darüber: hier müssen ALLE Seiten einen
   gedruckten Namen haben, sonst null. Eine halbe Typzeile ist unvollständig,
   ein halber Name ist falsch — er wird zu `disp` und damit zum Schlüssel für
   Anzeige, Sortierung und Suche. Lieber ganz englisch als "Knochenmalmer-Riese"
   für eine Karte, die "Knochenmalmer-Riese // Stampfen" heißt. */
const printedNameOf = card => {
  if (typeof card?.printed_name === "string") return card.printed_name;
  const seiten = card?.card_faces;
  if (!Array.isArray(seiten) || !seiten.length) return null;
  const angaben = seiten.map(f => f.printed_name).filter(x => typeof x === "string");
  if (angaben.length !== seiten.length) return null;
  return angaben.join(" // ");
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
  // Gedruckte (landessprachige) Fassung von Regeltext und Typzeile. Wieder
  // "== null": '' wäre gültig. Bei englischen Auflagen liefert Scryfall die
  // Felder gar nicht — dann bleibt die Spalte leer und die Anzeige nimmt
  // oracle_text/type_line. Das ist der Weg, über den BESTANDSKARTEN die
  // Übersetzung bekommen: "Preis neu ziehen" und der Sammel-Preisabruf laufen
  // beide hier durch, und sfById holt die sprachgenaue Auflage (die deutsche
  // Karte trägt eine eigene scryfall_id).
  // Der gedruckte Name. Bisher trug ihn nur der Einbuch-Weg ein, nie dieser —
  // bei Abenteuer-/geteilten Karten stand er deshalb dauerhaft englisch da.
  // Nicht nur bei NULL nachziehen, sondern auch, wenn dort der englische Name
  // steht: den setzt der CSV-Import als Notlösung ein (`csvName`, wenn Scryfall
  // kein printed_name lieferte). Das ist kein gedruckter Name, sondern eine
  // Platzhalter-Kopie von `name` — die darf der echte ersetzen.
  // "pn !== c.printed_name" ist nicht bloß Sparsamkeit, sondern nötig: bei
  // manchen Karten IST der gedruckte Name gleich dem englischen (Eigennamen,
  // z. B. „Kuja, Genome Sorcerer" auch auf der deutschen Auflage). Ohne diesen
  // Vergleich bliebe die Bedingung dort für immer wahr und jeder Preisabruf
  // schriebe denselben Wert erneut — bei Karten ohne sonstige Lücke sogar ein
  // UPDATE, das es ohne dies gar nicht gäbe.
  const pn = printedNameOf(fresh);
  if (pn != null && pn !== c.printed_name
      && (c.printed_name == null || c.printed_name === c.name))
    patch.printed_name = pn;
  if (c.printed_text == null) {
    const pt = printedTextOf(fresh);
    if (pt != null) patch.printed_text = pt;
  }
  if (c.printed_type_line == null) {
    const pty = printedTypeOf(fresh);
    if (pty != null) patch.printed_type_line = pty;
  }
  // Seiten einer zweiseitigen Karte nachtragen (fürs Umdrehen in der
  // Detailansicht). facesOf liefert nur bei echten Vorder-/Rückseiten-Karten
  // etwas — einseitige bleiben null und werden nicht angefasst.
  // Auch dann neu schreiben, wenn die gespeicherten Seiten noch aus der Zeit
  // VOR printed_text stammen (der Schlüssel fehlt in keiner Seite): sonst
  // bliebe die Rückseite einer fremdsprachigen Karte für immer englisch,
  // während die Vorderseite übersetzt ist. Der Schlüssel wird auch bei
  // englischen Karten gesetzt (auf null), das greift also genau einmal.
  const seitenOhneDruck = Array.isArray(c.faces)
                       && !c.faces.some(f => f && "printed_text" in f);
  if (c.faces == null || seitenOhneDruck) {
    const fc = facesOf(fresh);
    if (fc != null) patch.faces = fc;
  }
  // Farbidentität nachtragen (Grundlage des Farbidentitäts-Filters).
  if (c.color_identity == null) {
    const ci = farbIdentOf(fresh);
    if (ci != null) patch.color_identity = ci;
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

/* ------------------------------------------------- Set-Symbol -------- */
/* Das Set-Zeichen als Keyrune-Icon (assets/keyrune), gefärbt nach Seltenheit —
   genau wie auf der Karte, wo die Farbe des Symbols die Rarität verrät.

   Wie bei den Flaggen wird NICHT geraten: kennt Keyrune den Setcode nicht,
   bleibt es beim Klartextnamen daneben. Keyrune hätte zwar ein generisches
   Ersatzglyph, aber das wäre eine Aussage über das Set, die wir nicht treffen
   können. Deshalb der Abgleich gegen KEYRUNE_SETS — die Liste aller Codes, zu
   denen die Schrift wirklich ein Glyph führt (aus keyrune.css gezogen; beim
   Aktualisieren der Schrift neu ziehen).

   Die Farbe kommt aus RARITY (fürs dunkle Layout abgestimmt), NICHT aus
   Keyrunes eigenen Rarity-Klassen: deren "common" ist fast schwarz und
   verschwände hier. So stimmt das Symbol farblich mit der Rarity-Pille daneben
   überein. Das Symbol ist Schmuck — der Setname steht immer daneben —, also
   aria-hidden. */
const KEYRUNE_SETS = new Set(`
  10e 1e 2e 2ed 2u 2x2 2xm 30a 3e 3ed 40k 4ed 5dn 5ed 6ed 7ed 8ed 9ed a25 acr aer afc afr akh
  akr ala all ann apc arb arc arn ath atq avr azorius bbd bcore bfz big blb blc bng bok boros
  bot br brb brc bro brr btd c13 c14 c15 c16 c17 c18 c19 c20 c21 cc1 cc2 chk chr clb clu cm1
  cm2 cma cmc cmd cmm cmr cn2 cns con csp dd2 ddc ddd dde ddf ddg ddh ddi ddj ddk ddl ddm ddn
  ddo ddp ddq ddr dds ddt ddu dft dgm dimir dis dka dkm dmc dmr dmu dom dpa drb drc drk dsc
  dsk dst dtk duels dvk e01 e02 ea1 ecc ecl eld ema emn eoc eoe eos eve evg exo exp fca fdc
  fdn fem fic fin fra frf fut gk1 gk2 gn2 gn3 gnt golgari gpt grn gruul gs1 gtc h09 h17 ha1
  hbg hml hob hoc hop hou htr htr17 ice ice2 iko ima inr inv isd izzet j20 j21 j22 j25 j25a
  jmp jou jud khc khm kld klr ktk lcc lci lea leb leg lgn lrw ltc ltr m10 m11 m12 m13 m14 m15
  m19 m20 m21 m3c mar mat mb1 mb2 mbs md1 me1 me2 me3 me4 med mh1 mh2 mh3 mic mid mir mkc mkm
  mm2 mm3 mma mmq moc modo mom mor mp1 mp2 mps mrd msc msh mul ncc nec nem neo nms nph ody
  ogw om1 omb onc one ons ori orzhov otc otj otp p02 papac parl parl2 parl3 past pbook pc2
  pca pcy pd2 pd3 pdep pdrc peuro pfnm pgru pheart pidw pio pip plc pleaf pls pm2 pma pmei
  pmodo pmps pmpu pmtg1 pmtg2 po2 por psalvat05 psalvat11 psega psld psum ptg ptk ptsa pxbox
  pz1 pz2 pza rakdos rav ren rex rin rix rna roe rtr rvr s00 s99 scd scg selesnya shm simic
  sir sis sld sld2 slu snc soa soc soi sok som sos spe spg spm ss1 ss2 ss3 sta sth stx tce
  td2 tdc tdm thb ths tla tle tmc tmp tmt tor tpr tsp tsr uds ugl ulg uma una und unf unh usg
  ust v09 v0x v10 v11 v12 v13 v14 v15 v16 v17 van vis vma voc vow w16 w17 war who woc woe wot
  wth wwk x2ps x4ea xcle xdnd xduels xice xkld xlcu xln xmods xren xrin xssm y22 y23 y24 y25
  y26 yblb ybro ydft ydmu ydsk yeoe ylci ymid ymkm yneo yone yotj ysnc ytdm ywoe zen znc zne
  znr
`.trim().split(/\s+/));

/* Beste Keyrune-Klasse zu einem Setcode, oder null. Erst der Code selbst; kennt
   Keyrune ihn nicht, wird ein führendes p/t (Promo- bzw. Token-Ausgabe) abgeworfen
   und das Stammset probiert: PTHS → THS, TMKM → MKM. So erben Sonderausgaben das
   Symbol ihres Sets. Abgeworfen wird NUR, wenn der volle Code unbekannt ist —
   echte p-Sets (por, plc, pca …) behalten damit ihr eigenes Glyph. */
function keyruneKlasse(code) {
  const c = (code || "").toLowerCase();
  if (KEYRUNE_SETS.has(c)) return c;
  if ((c[0] === "p" || c[0] === "t") && KEYRUNE_SETS.has(c.slice(1))) return c.slice(1);
  return null;
}

/* Set-Symbol für die Sammlungsspalte, gefärbt nach Seltenheit. Findet sich kein
   passendes Glyph (auch nicht über das Stammset), tritt das Keyrune-Standard-
   zeichen (Kreis-M) als Platzhalter ein — WICHTIG: immer noch in der Rarity-Farbe,
   denn die Seltenheit soll in jedem Fall an der Farbe ablesbar bleiben. */
function setSymbol(code, rarity) {
  const farbe = (RARITY[rarity] || {}).farbe || "var(--dim)";
  const kl = keyruneKlasse(code);
  return `<i class="ss${kl ? ` ss-${kl}` : ""} ss-fw" style="color:${farbe}" aria-hidden="true"></i>`;
}

/* Dasselbe Glyph, aber neutral (ohne Seltenheitsfarbe) — für Stellen, an denen
   kein einzelnes Rarity gemeint ist: das Set-Dropdown listet ganze Sets, die
   alle Raritäten enthalten. currentColor greift, damit es beim Hover mitfärbt.
   Auch hier das Standardzeichen als Rückfall, damit die Liste bündig bleibt. */
function setIcon(code) {
  if (!code) return "";
  const kl = keyruneKlasse(code);
  return `<i class="ss${kl ? ` ss-${kl}` : ""} ss-fw" aria-hidden="true"></i>`;
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
/* Scryfall liefert die Kosten als Zeichenkette ("{2}{G/W}{X}"). Gezeichnet
   werden die Symbole mit der selbst gehosteten Mana-Schrift (assets/mana):
   je Symbol ein <i class="ms ms-… ms-cost">. Das löst die früheren
   Einzelbild-Abrufe von der Scryfall-CDN ab — ein Fremdanbieter weniger und
   ein Font-Download statt vieler Bilder, dieselbe Überlegung wie bei den
   selbst gezeichneten Flaggen.

   Vom Scryfall-Token zur Klasse: Klammern weg, Schrägstriche weg, klein.
   {G/W} → gw → ms-gw, {2/W} → 2w → ms-2w, {G/P} → gp → ms-gp. Die
   Reihenfolge der Hybridbuchstaben ist bei Scryfall dieselbe wie in der
   Schrift (wu, wb, ub … gu), deshalb passt das direkt. Fünf Symbole heißen
   in der Schrift anders als ihr Token und bekommen unten eine feste Zuordnung.

   ms-cost gibt jedem Symbol den runden, farbigen Hintergrund wie auf der
   Karte. Kennt die Schrift ein Symbol nicht, bleibt der leere Kreis stehen —
   das aria-label/title mit dem Rohtoken ("{G}") sagt trotzdem, was gemeint
   ist. Alles ausserhalb der Klammern (bei geteilten Karten das " // ") wird
   escaped durchgereicht, nicht als HTML. */
const MANA_SONDER = { T: "tap", Q: "untap", A: "acorn", "½": "half", "∞": "infinity" };
const manaKlasse = inhalt =>
  MANA_SONDER[inhalt] || inhalt.replace(/\//g, "").toLowerCase();

function mitSymbolen(text) {
  const re = /\{([^}]+)\}/g;
  let out = "", last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const roh = `{${m[1]}}`;
    out += `<i class="ms ms-${esc(manaKlasse(m[1]))} ms-cost" role="img"
               aria-label="${esc(roh)}" title="${esc(roh)}"></i>`;
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

/* ---------------------------------------------------- Preisverlauf --------
   Der Graph im Zuschnitt von Cardmarket: waagerechte Gitterlinien auf runden
   Eurobeträgen, senkrechte an den Datumsmarken, schräg gestellte Datums-
   beschriftung, eine helle Kurve mit einem Punkt je Messwert — und beim
   Überfahren ein heller Kasten, der auf den nächstgelegenen Punkt einrastet
   und dessen Datum und Preis zeigt.

   Die Zeitachse ist ZEITgetreu, nicht laufnummerngetreu. Solange die Historie
   90 lückenlose Tage umfasste, war das dasselbe; seit price_history ein Archiv
   ist (siehe merge_price_history), kann eine Reihe Jahre umspannen und Lücken
   haben — Punkte gleichmäßig zu verteilen würde diese Lücken verschweigen und
   den Verlauf verzerren.

   Der Median liegt als dünne gestrichelte Waagerechte darin: er sagt auf einen
   Blick, ob der heutige Kurs über oder unter dem üblichen Niveau liegt.
   Bewusst zurückhaltend gezeichnet und in Gold — er soll die Kurve begleiten,
   nicht mit ihr wetteifern, und darf mit ihrem Grün/Rot nicht verwechselbar
   sein.

   Die Kurve bleibt grün bei gestiegenem, rot bei gefallenem Kurs (Endpunkt
   gegen Anfangspunkt des gezeigten Bereichs) — wie die Mini-Kurve in der
   Liste. Cardmarket zeichnet neutral weiß; die Richtung auf einen Blick zu
   sehen ist uns mehr wert als die Farbtreue zur Vorlage. Der Farbtupfer im
   Zeigerkasten trägt dieselbe Farbe, damit er als Legende zur Kurve lesbar
   bleibt und nicht als eigene Aussage. */

let PCHART_NR = 0;
const PCHART_GEO = new Map();   // id → { pts:[{x,y,d,v}], w } in SVG-Einheiten

/* Runder Schrittabstand für die Werteachse: 1 / 2 / 2,5 / 5 / 10 mal eine
   Zehnerpotenz. Damit steht auf den Linien 0,40 € und nicht 0,4137 €. */
function niceStep(spanne, ziele) {
  const roh = spanne / Math.max(1, ziele);
  if (!(roh > 0)) return 1;
  const p10 = Math.pow(10, Math.floor(Math.log10(roh)));
  for (const m of [1, 2, 2.5, 5, 10]) if (roh <= m * p10) return m * p10;
  return 10 * p10;
}

function medianOf(vs) {
  if (!vs.length) return null;
  const s = [...vs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const dmyAusIso = s => (s && s.length >= 10)
  ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : (s || "");

function priceChart(hist, w = 560, h = 200) {
  // Datum mitrechnen (Zeitachse) und ungültige Punkte verwerfen. Sortiert wird
  // hier noch einmal: mergedHist liefert sortiert, aber der Graph verlässt sich
  // nicht darauf — eine unsortierte Reihe zeichnete sonst Zickzack.
  const H = (hist || [])
    .map(p => ({ d: p.d, v: Number(p.v), t: Date.parse(`${p.d}T00:00:00Z`) }))
    .filter(p => Number.isFinite(p.v) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (!H.length) return `<p class="hint">${esc(t("detail.noHistory"))}</p>`;

  const schmal = w <= 400;
  const fs = schmal ? 10 : 11;

  // Die Datumsangaben stehen um 45° gekippt (wie bei Cardmarket). Gekippt
  // braucht eine Beschriftung der Breite b nach unten UND nach links je
  // b·cos45° Platz — die Fußhöhe muss also aus der Schriftgröße folgen und
  // darf nicht geraten sein, sonst schneidet der viewBox die Beschriftung ab.
  // "01.01.2026" sind 10 Zeichen; 0,58·Schriftgröße je Zeichen trifft die
  // Breite der hier verwendeten Systemschrift dicht genug.
  const lblB = fs * 0.58 * 10;
  const kipp = Math.ceil(lblB * 0.7071);
  const pl = schmal ? 46 : 56, pr = 12, pt = 12, pb = kipp + 8;
  const iw = w - pl - pr, ih = h - pt - pb;

  // Wertebereich auf runde Schritte aufziehen. Kein Spread über das Array:
  // eine Reihe über Jahre kann tausende Punkte haben, und Math.min(...vs)
  // kippt bei sehr langen Argumentlisten.
  const vs = H.map(p => p.v);
  let lo = vs[0], hi = vs[0];
  for (const v of vs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === hi) { const d = Math.max(0.05, Math.abs(lo) * 0.1); lo -= d; hi += d; }
  const schritt = niceStep(hi - lo, schmal ? 4 : 6);
  const yLo = Math.floor(lo / schritt) * schritt;
  const yHi = Math.ceil(hi / schritt) * schritt;
  const yN  = Math.max(1, Math.round((yHi - yLo) / schritt));

  const t0 = H[0].t, t1 = H[H.length - 1].t, dt = (t1 - t0) || 1;
  const X = p => H.length === 1 ? pl + iw / 2 : pl + (p.t - t0) / dt * iw;
  const Y = v => pt + ih * (1 - (v - yLo) / ((yHi - yLo) || 1));

  // Datumsmarken gleichmäßig über die ZEIT, nicht über die Punkte: bei Lücken
  // säßen sonst mehrere Beschriftungen dicht beieinander.
  const xN = Math.max(2, Math.min(7, Math.floor(iw / (schmal ? 78 : 112))));
  const xMarken = H.length === 1 ? [t0]
    : Array.from({ length: xN }, (_, i) => t0 + dt * i / (xN - 1));
  const dmy = ms => {
    const d = new Date(ms), p = n => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  };

  // Punkte nur zeichnen, solange sie auseinanderliegen. Bei einem Jahresverlauf
  // auf 900 Einheiten stünden sie sonst Kante an Kante und würden die Kurve zu
  // einem Band verschmieren.
  const abst   = H.length > 1 ? iw / (H.length - 1) : iw;
  const punkte = abst >= 5;
  const r      = abst >= 14 ? 3.2 : 2.4;

  // Zwei Bezugslinien: der Median (mittlerer Wert, gegen Ausreißer robust) und
  // der Durchschnitt. Beide zusammen sagen mehr als jeder allein — liegt der
  // Durchschnitt deutlich über dem Median, hat die Karte einzelne Ausschläge
  // nach oben gehabt, die den Mittelwert ziehen, der typische Preis aber lag
  // tiefer. Nur auf dem breiten Graphen; im schmalen Hover-Format bliebe für
  // die Beschriftung kein Platz, und zwei unbeschriftete Linien wären dort
  // nicht deutbar — deshalb zeigt er weiterhin allein den Median.
  const med = H.length >= 3 ? medianOf(vs) : null;
  const avg = H.length >= 3 && !schmal
    ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  const linie = H.map(p => `${X(p).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const farbe = H[H.length - 1].v >= H[0].v ? "var(--ok)" : "var(--err)";

  // Platz für ein Etikett an einer waagerechten Bezugslinie suchen. Eine feste
  // Position ginge nicht: Median und Durchschnitt liegen per Definition mitten
  // im Wertebereich, also kreuzt die Kurve sie HÄUFIG, und eine feste Stelle
  // trifft früher oder später genau darauf.
  //
  // Deshalb wird das Kästchen über die Breite geschoben und, ober- wie
  // unterhalb der Linie, der Platz mit dem größten Abstand zur Kurve gewählt.
  // Bereits gesetzte Etiketten (belegt) sind Ausschlusskriterium, nicht bloß
  // Abzug: eine Überdeckung von Kurve und Kästchen ist verschmerzbar — die
  // Füllung deckt sie ab —, zwei Kästchen übereinander sind schlicht unlesbar.
  // Median und Durchschnitt liegen oft dicht beieinander, der Fall tritt also
  // wirklich ein.
  const sucheEtikett = (wert, text, belegt) => {
    if (wert == null) return null;
    const efs = fs - 1;
    const eb  = text.length * efs * 0.55 + 8;       // Breite samt Innenabstand
    const eh  = efs + 6;
    const yL  = Y(wert);
    const von = pl + 3, bis = w - pr - 3;
    if (bis - von < eb) return null;

    let beste = null;
    for (let i = 0; i <= 14; i++) {
      const ex = von + (bis - von - eb) * i / 14;
      for (const seite of [-1, 1]) {                // -1 = über, 1 = unter der Linie
        const ey = seite < 0 ? yL - 4 - eh : yL + 4;
        if (ey < pt || ey + eh > pt + ih) continue;  // muss im Feld bleiben
        if (belegt.some(o => ex < o.x + o.b + 3 && ex + eb + 3 > o.x
                          && ey < o.y + o.h + 2 && ey + eh + 2 > o.y)) continue;
        let abstand = Infinity;
        for (const p of H) {
          const px = X(p);
          if (px < ex - 2 || px > ex + eb + 2) continue;
          const py = Y(p.v);
          abstand = Math.min(abstand,
            py < ey ? ey - py : (py > ey + eh ? py - (ey + eh) : 0));
        }
        if (!beste || abstand > beste.abstand)
          beste = { x: ex, y: ey, b: eb, h: eh, text, abstand };
      }
    }
    return beste;
  };

  // Der Median zuerst — er war zuerst da und behält den besten Platz.
  const etiketten = [];
  if (!schmal) {
    const eMed = sucheEtikett(med, `${t("detail.median")} ${eur(med)}`, etiketten);
    if (eMed) etiketten.push({ ...eMed, farbe: "var(--acc)" });
    const eAvg = sucheEtikett(avg, `${t("detail.average")} ${eur(avg)}`, etiketten);
    if (eAvg) etiketten.push({ ...eAvg, farbe: "var(--dim)" });
  }

  const id = ++PCHART_NR;
  PCHART_GEO.set(id, { pts: H.map(p => ({ x: X(p), y: Y(p.v), d: p.d, v: p.v })), w });
  // Aufräumen: alles wegwerfen, was nicht mehr im Dokument hängt. Ohne das
  // wüchse die Map mit jedem geöffneten Kartendetail weiter.
  if (PCHART_GEO.size > 12)
    for (const k of [...PCHART_GEO.keys()])
      if (k !== id && !document.querySelector(`.pchart[data-pc="${k}"]`)) PCHART_GEO.delete(k);

  return `<div class="pchart" data-pc="${id}">
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      ${Array.from({ length: yN + 1 }, (_, i) => {
        const v = yLo + i * schritt, y = Y(v).toFixed(1);
        return `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="var(--line)" stroke-width="1"/>
          <text x="${pl - 8}" y="${(Y(v) + fs * 0.36).toFixed(1)}" text-anchor="end"
            font-size="${fs}" fill="var(--dim)">${esc(eur(v))}</text>`;
      }).join("")}
      ${xMarken.map(ms => {
        const x = (H.length === 1 ? pl + iw / 2 : pl + (ms - t0) / dt * iw).toFixed(1);
        // Ankerpunkt knapp unter der Achse: von hier läuft die gekippte
        // Beschriftung nach unten-links und endet bei h-2, also gerade noch
        // im Bild (pb ist genau darauf berechnet).
        const yb = h - pb + 6;
        return `<line x1="${x}" y1="${pt}" x2="${x}" y2="${pt + ih}" stroke="var(--line)" stroke-width="1"/>
          <text x="${x}" y="${yb}" text-anchor="end" font-size="${fs}" fill="var(--dim)"
            transform="rotate(-45 ${x} ${yb})">${esc(dmy(ms))}</text>`;
      }).join("")}
      ${med != null ? `<line x1="${pl}" y1="${Y(med).toFixed(1)}" x2="${w - pr}" y2="${Y(med).toFixed(1)}"
          stroke="var(--acc)" stroke-width="1" stroke-dasharray="4 4" opacity=".38"/>` : ""}
      ${/* Der Durchschnitt in gedecktem Blaugrau und mit kürzerem Strichmuster:
            unterscheidbar vom Median auch ohne Farbe (Ausdruck, Farbfehlsicht)
            und ohne mit dem Grün/Rot der Kurve verwechselbar zu sein. */""}
      ${avg != null ? `<line x1="${pl}" y1="${Y(avg).toFixed(1)}" x2="${w - pr}" y2="${Y(avg).toFixed(1)}"
          stroke="var(--dim)" stroke-width="1" stroke-dasharray="2 3" opacity=".42"/>` : ""}
      ${H.length > 1 ? `<polyline points="${linie}" fill="none" stroke="${farbe}"
          stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
      ${punkte ? H.map(p => `<circle cx="${X(p).toFixed(1)}" cy="${Y(p.v).toFixed(1)}"
          r="${r}" fill="${farbe}"/>`).join("") : ""}
      ${/* Das Etikett ZULETZT, nach Kurve und Punkten. Stand es davor, malte die
            Kurve darüber und zerschnitt die Schrift — im Fehlerbericht lief die
            rote Linie mitten durch "Median 1,45 €". Im SVG gilt allein die
            Dokumentreihenfolge, es gibt kein z-index. Die gestrichelte
            Medianlinie bleibt dagegen bewusst UNTER der Kurve: sie ist
            Hintergrundmaßstab, nicht Beschriftung. */""}
      ${etiketten.map(e => `<rect x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}"
          width="${e.b.toFixed(1)}" height="${e.h.toFixed(1)}" rx="2"
          fill="var(--panel)" opacity=".94"/>
        <text x="${(e.x + e.b / 2).toFixed(1)}"
          y="${(e.y + e.h - (fs - 1) * 0.28).toFixed(1)}" text-anchor="middle"
          font-size="${fs - 1}" fill="${e.farbe}" opacity=".9">${esc(e.text)}</text>`).join("")}
      <circle class="pchart-marke" r="4.5" fill="${farbe}" stroke="var(--panel)"
        stroke-width="2" style="display:none"/>
    </svg>
    <div class="pchart-tip" hidden>
      <div class="pchart-tip-d"></div>
      <div class="pchart-tip-v"><i style="background:${farbe}"></i><span></span></div>
    </div>
  </div>`;
}

/* Zeigerkasten wie bei Cardmarket: er rastet auf den nächstgelegenen Punkt ein
   (nicht auf die freie Zeigerposition) und weicht zur anderen Seite aus, wenn
   er am Rand anstieße. Ein einziger Zuhörer am Dokument bedient alle Graphen —
   die Detailansicht baut ihr HTML als Zeichenkette, da gibt es beim Erzeugen
   kein Element, an das man etwas hängen könnte. */
let PCHART_OFFEN = null;

function pchartAus() {
  if (!PCHART_OFFEN) return;
  const tip = PCHART_OFFEN.querySelector(".pchart-tip");
  const mk  = PCHART_OFFEN.querySelector(".pchart-marke");
  if (tip) tip.hidden = true;
  if (mk)  mk.style.display = "none";
  PCHART_OFFEN = null;
}

function pchartZeige(e) {
  const box = e.target.closest && e.target.closest(".pchart");
  if (!box) { pchartAus(); return; }
  if (PCHART_OFFEN && PCHART_OFFEN !== box) pchartAus();

  const geo = PCHART_GEO.get(Number(box.dataset.pc));
  const tip = box.querySelector(".pchart-tip");
  if (!geo || !geo.pts.length || !tip) return;
  const rect = box.getBoundingClientRect();
  if (!rect.width) return;

  const sk = rect.width / geo.w;                   // SVG-Einheiten → Bildschirmpixel
  const mx = (e.clientX - rect.left) / sk;         // Zeiger in SVG-Einheiten

  // Binäre Suche: die Punkte liegen nach x sortiert, und ein Jahresverlauf
  // bringt schnell vierstellig viele mit.
  const pts = geo.pts;
  let a = 0, b = pts.length - 1;
  while (a < b) { const m = (a + b) >> 1; if (pts[m].x < mx) a = m + 1; else b = m; }
  let treffer = pts[a];
  if (a > 0 && Math.abs(pts[a - 1].x - mx) < Math.abs(treffer.x - mx)) treffer = pts[a - 1];

  tip.querySelector(".pchart-tip-d").textContent = dmyAusIso(treffer.d);
  tip.querySelector(".pchart-tip-v span").textContent = eur(treffer.v);
  tip.hidden = false;

  const mk = box.querySelector(".pchart-marke");
  if (mk) { mk.setAttribute("cx", treffer.x); mk.setAttribute("cy", treffer.y); mk.style.display = ""; }

  const px = treffer.x * sk, py = treffer.y * sk;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let l = px + 14;
  if (l + tw > rect.width) l = px - 14 - tw;                     // rechts kein Platz → links
  l = Math.max(0, Math.min(rect.width - tw, l));
  let o = py - th - 12;
  if (o < 0) o = py + 14;                                        // oben kein Platz → darunter
  o = Math.max(0, Math.min(rect.height - th, o));
  tip.style.left = l + "px";
  tip.style.top  = o + "px";
  PCHART_OFFEN = box;
}

document.addEventListener("pointermove", pchartZeige, { passive: true });
document.addEventListener("pointerdown", pchartZeige, { passive: true });
// Scrollen/Verlassen räumt auf: der Kasten steht absolut im Graphen und bliebe
// sonst am letzten Punkt kleben, wenn der Zeiger den Dialog verlässt.
document.addEventListener("pointercancel", pchartAus, { passive: true });
window.addEventListener("blur", pchartAus);

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
  // Die Schlüsselwort-Tags bleiben englisch: Scryfalls keywords-Liste ist die
  // kanonische Fassung und hat KEIN landessprachiges Gegenstück (auch auf der
  // deutschen Karte steht dort "Storm", nicht "Sturm"). Erfunden wird hier
  // nichts — lieber ein englisches verbürgtes Wort als eine geratene
  // Übersetzung.
  if (Array.isArray(c.keywords) && c.keywords.length)
    teile.push(`<div class="kw-tags">${c.keywords.map(k => `<span class="pill">${esc(k)}</span>`).join("")}</div>`);
  // Gedruckt vor Oracle: bei einer fremdsprachigen Auflage steht hier der
  // Text, der wirklich auf der Karte steht. Fehlt er — englische Auflage, oder
  // eine, die Scryfall nur englisch führt —, bleibt es beim Oracle-Text.
  // "|| null" und NICHT "!= null": für die Anzeige sind '' und null dasselbe —
  // beides heißt "kein gedruckter Text zu zeigen". Beim SPEICHERN ist der
  // Unterschied wichtig ('' = geprüft, es gibt keinen), beim Anzeigen nicht:
  // stünde hier ein leeres '' vor einem gefüllten oracle_text, bliebe der
  // Kasten leer statt auf Englisch zu zeigen.
  const gedruckt = c.printed_text || null;
  const anzeige = gedruckt ?? c.oracle_text;
  if (anzeige)
    teile.push(`<div class="regeltext">${mitSymbolen(anzeige)}</div>`);
  if (!kompakt && c.oracle_text) {
    // Aufgeschlüsselt wird WEITER der englische Oracle-Text, nicht der
    // gedruckte: er ist regeltechnisch verbindlich, und die Muster in
    // parseAbilities (When/Whenever/Sacrifice …) sowie der Abgleich gegen die
    // englische keywords-Liste sind es ebenfalls. Auf deutschem Text fiele
    // alles als "statisch" durch und kein Schlüsselwort träfe.
    const ab = parseAbilities(c.oracle_text, c.keywords) || [];
    // Weicht der gedruckte Text ab, ist die Tabelle sichtbar in einer anderen
    // Sprache als der Kasten darüber. Das sagt die Zusammenfassung — den
    // englischen Text dazu NICHT noch einmal als Ganzes zeigen: die Spalte
    // "Wirkung" enthält ihn bereits vollständig, nur eben zerlegt. Ein Kasten
    // darüber wäre dieselbe Zeichenkette ein zweites Mal.
    const abweichend = gedruckt != null && gedruckt !== c.oracle_text;
    if (ab.length) teile.push(`
      <details class="faehig">
        <summary>${esc(t("detail.abBreakdown"))} <span class="hint" style="display:inline">${
          esc(t(abweichend ? "detail.abAutoOracle" : "detail.abAuto"))}</span></summary>
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
    // Immer setzen, auch auf null: der Spread oben trägt die Werte der GANZEN
    // Karte herein, und die gehören der Vorderseite. Ohne das zeigte die
    // Rückseite den gedruckten Text der Vorderseite.
    printed_text: f.printed_text ?? null,
    printed_type_line: f.printed_type_line ?? null,
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
  // Gedruckte Typzeile vor der englischen — dieselbe Regel wie beim Regeltext.
  // Nur hier in der Anzeige: gefiltert und geprüft wird weiter über type_line.
  const typ = v.printed_type_line || v.type_line;
  return `${typ ? `<div class="hint" style="margin-top:2px">${esc(typ)}</div>` : ""}
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

/* Deck-Zugehörigkeit für die Kartendetails: in welchen Decks steckt diese Karte
   (nach Set+Nummer) und mit welcher Deckmenge. Jede Nennung ist ein Knopf, der
   zum Deck springt. Leer, wenn die Karte in keinem Deck liegt. */
function deckMembershipHtml(c) {
  const vork = deckVorkommen(c);
  if (!vork.length) return "";
  const chips = vork.map(v =>
    `<button class="deck-chip" data-godeck="${esc(v.id)}" title="${esc(t("detail.inDeckGo"))}">${esc(v.name)} &middot; ${v.qty}&times;</button>`).join("");
  return `<div class="detail-decks"><span class="detail-decks-lbl">${esc(t("detail.inDecks"))}</span>${chips}</div>`;
}

/* Von den Kartendetails zum Deck springen: Dialog schließen, Deck-Ansicht öffnen,
   das Deck aufklappen und hinscrollen. */
function zeigeDeck(deckId) {
  $("#detail-dlg")?.close();
  const nav = $('nav button[data-v="decks"]'); if (nav) nav.click();
  if (!deckOffen.ist(deckId)) deckOffen.schalte(deckId);
  renderDecks();
  requestAnimationFrame(() => {
    const el = $(`.deck-kopf[data-toggle="${deckId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* Gemeinsame Vorlage für Dialog und Hover-Vorschau. Der Preisgraph sitzt in
   der rechten Spalte unter dem Hinzugefügt-Datum — kompakt (320er-viewBox),
   damit die Beschriftung beim Skalieren lesbar bleibt. */
/* ------------------------------------------------ Eigenes Kartenbild ---
   Scryfall hat nicht zu jeder Auflage ein Foto: bei fremdsprachigen Drucken
   steht image_status oft auf "placeholder", angezeigt wird dann ein grauer
   Ersatz. Hier lässt sich ein eigenes Bild hinterlegen.

   ZWEI WEGE, und der Unterschied ist keine Geschmacksfrage:
   • Eine Adresse kostet die Datenbank NICHTS.
   • Eine hochgeladene Datei landet als data:-URI in der Spalte — und die
     Spalte img wird bei JEDEM reload() für ALLE Karten mitgeladen, also nach
     jedem Einbuchen und Bearbeiten. Deshalb wird verkleinert (400 px breit,
     rund 85 KB) und die Größe im Dialog offen ausgewiesen, statt sie zu
     verschweigen.

   Geschrieben wird über die scryfall_id, nicht über die Zeilen-ID: das Bild
   gehört zur AUFLAGE, nicht zum einzelnen Exemplar. Wer dieselbe Karte
   zweimal hat (Foil und normal), will nicht zweimal dasselbe hinterlegen. */
const SCRYFALL_BILD = /^https:\/\/cards\.scryfall\.io\//;
const eigenesBild = c => !!c.img && !SCRYFALL_BILD.test(c.img);

/* Datei → verkleinertes JPEG als data:-URI. 400 px Breite deckt die
   Detailansicht (230 CSS-px, also 460 px auf 2x-Displays) knapp ab und bleibt
   deutlich unter dem, was ein voller Scan kostet. */
function bildAlsDataUri(datei, maxBreite = 400, qualitaet = 0.82) {
  return new Promise((fertig, fehler) => {
    const leser = new FileReader();
    leser.onerror = () => fehler(new Error(t("img.readFailed")));
    leser.onload = () => {
      const bild = new Image();
      bild.onerror = () => fehler(new Error(t("img.notAnImage")));
      bild.onload = () => {
        const skal = Math.min(1, maxBreite / bild.width);      // nie hochskalieren
        const cv = document.createElement("canvas");
        cv.width = Math.round(bild.width * skal);
        cv.height = Math.round(bild.height * skal);
        const cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(bild, 0, 0, cv.width, cv.height);
        fertig(cv.toDataURL("image/jpeg", qualitaet));
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  });
}

/* Das Scryfall-Bild zurückholen. Die Adresse wird nicht geraten, sondern beim
   Abruf der Auflage mitgeliefert — sie trägt einen Zeitstempel, den man aus
   der scryfall_id allein nicht rekonstruieren kann. */
async function scryfallBild(c) {
  const frisch = await sfById(c.scryfall_id);
  return imgOf(frisch) || null;
}

async function bildDlg(c) {
  const kb = s => Math.round((s.length * 3 / 4) / 1024);        // base64 → KB
  let neu = null;                                              // null = unverändert

  const zeichne = () => {
    const zeigt = neu ?? c.img ?? "";
    const eigen = neu ? !SCRYFALL_BILD.test(neu) : eigenesBild(c);
    $("#bild-vorschau").innerHTML = zeigt
      ? `<img src="${esc(zeigt.replace("/small/", "/normal/"))}" alt="">`
      : `<div class="detail-img-leer"></div>`;
    $("#bild-groesse").textContent = zeigt.startsWith("data:")
      ? t("img.sizeInline", { kb: kb(zeigt) })
      : (eigen ? t("img.sizeUrl") : t("img.sizeScryfall"));
    $("#bild-zuruecksetzen").hidden = !eigen;
  };

  $("#dlg-body").innerHTML = `
    <h3 style="margin:0 0 10px">${esc(t("img.dlgTitle"))}</h3>
    <div class="bild-dlg">
      <div class="bild-vorschau" id="bild-vorschau"></div>
      <div class="bild-felder">
        <div class="field">
          <label for="bild-url">${esc(t("img.urlLabel"))}</label>
          <input id="bild-url" type="url" placeholder="https://…" value="${
            esc(eigenesBild(c) && !String(c.img).startsWith("data:") ? c.img : "")}">
          <div class="hint" style="margin:4px 0 0">${esc(t("img.urlHint"))}</div>
        </div>
        <div class="field" style="margin-top:12px">
          <label for="bild-datei">${esc(t("img.fileLabel"))}</label>
          <input id="bild-datei" type="file" accept="image/*">
          <div class="hint" style="margin:4px 0 0">${esc(t("img.fileHint"))}</div>
        </div>
        <div class="hint" id="bild-groesse" style="margin-top:12px"></div>
        <button class="btn ghost sm" id="bild-zuruecksetzen" style="margin-top:8px" hidden>${
          esc(t("img.reset"))}</button>
      </div>
    </div>`;
  zeichne();

  $("#bild-url").oninput = e => {
    const v = e.target.value.trim();
    neu = v || null;
    zeichne();
  };
  $("#bild-datei").onchange = async e => {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    try {
      neu = await bildAlsDataUri(datei);
      $("#bild-url").value = "";
      zeichne();
    } catch (err) { toast(err.message); }
  };
  $("#bild-zuruecksetzen").onclick = async () => {
    const knopf = $("#bild-zuruecksetzen");
    knopf.disabled = true;
    try { neu = await scryfallBild(c) || ""; $("#bild-url").value = ""; zeichne(); }
    catch { toast(t("img.resetFailed")); }
    finally { knopf.disabled = false; }
  };

  const dlg = $("#dlg");
  const antwort = await new Promise(res => {
    const zu = v => { dlg.close(); res(v); };
    $("#dlg-yes").onclick = () => zu(true);
    $("#dlg-no").onclick  = () => zu(false);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
  if (!antwort || neu === null) return showCardDetail(c.id);

  const { error } = await sb.from("cards")
    .update({ img: neu || null })
    .eq("scryfall_id", c.scryfall_id);          // alle Ausführungen dieser Auflage
  if (error) { toast(dbErr(error)); return showCardDetail(c.id); }
  await reload(); renderAll();
  toast(t("img.saved"));
  showCardDetail(c.id);
}

/* Kartenbild samt Werkzeugleiste darunter.

   Die Leiste sitzt in DERSELBEN Spalte wie das Bild und rechtsbündig, damit
   sie mit dessen rechter Kante abschließt. Deshalb die eigene Spalte statt
   eines Knopfs irgendwo im Textteil: `.detail` ist eine Flex-Zeile aus Bild
   und Infoteil, ein Kind darunter läge sonst unter beidem.

   In der Hover-Vorschau entfällt sie — dort wird nichts bearbeitet. Fehlt das
   Bild ganz, bleibt ein leerer Rahmen stehen: genau dann will man ja eines
   nachtragen können, und ohne Rahmen hinge der Knopf im Nichts. */
function bildSpalteHtml(c, faced, gross, hover) {
  const bild = faced ? flipHtml(c)
             : (gross ? `<img class="detail-img" src="${esc(gross)}" alt="">` : "");
  if (hover) return bild;
  return `<div class="detail-bildspalte">
    ${bild || `<div class="detail-img detail-img-leer" aria-hidden="true"></div>`}
    <div class="detail-bildtools">
      <button class="btn ghost sm" id="dt-bild" title="${esc(t("img.replaceTitle"))}">${
        esc(t("img.replace"))}</button>
    </div>
  </div>`;
}

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
          ${priceChart(mergedHist(c), 320, 150)}
        </div>`;
  return `
    <div class="detail">
      ${!hover ? `<div class="detail-added">${esc(t("detail.added"))}: ${esc(dtShort(c.added))} ${esc(t("detail.addedSuffix"))}</div>` : ""}
      ${bildSpalteHtml(c, faced, gross, hover)}
      <div class="detail-info">
        ${!hover ? `<div class="detail-face-top" id="dt-face-top">${faceTopHtml(v)}</div>` : faceTopHtml(v)}
        <div class="hint" style="margin-top:2px">${setSymbol(c.set, c.rarity)}${esc(c.set_name || c.set)} · #${esc(c.cn)}${
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
        ${!hover ? deckMembershipHtml(c) : ""}
        ${block}
        ${hover ? `<div class="hint" style="margin-top:10px">${esc(t("detail.added"))}: ${esc(dtShort(c.added))} ${esc(t("detail.addedSuffix"))}</div>` : ""}
      </div>
    </div>
    ${!hover ? `<details class="legal-det dt-price-full"><summary>&#128200; ${esc(t("detail.priceHistory"))}</summary>
      <div style="margin-top:8px">${priceChart(mergedHist(c), 900, 200)}</div>
    </details>
    <div id="syn-box" class="dt-results-full"></div>
    <div id="card-combo-box" class="dt-results-full"></div>` : ""}`;
}

/* Detailansicht einer fremden Karte (Community-Kachel). Dieselbe Ansicht,
   nur ohne die Knöpfe, die dem Besitzer vorbehalten sind. */
function zeigeFremdeKarte(c) {
  if (!c) return;
  renderDetail(c, null, true);
  if (!$("#detail-dlg").open) $("#detail-dlg").showModal();
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
function renderDetail(c, id, fremd) {
  $("#detail-body").innerHTML = detailHtml(c, false);
  wireFlip(c, id);

  // Fremde Karte (Community-Kachel): Bearbeiten und Preis-Aktualisieren
  // gehören dem Besitzer, nicht dem Betrachter. Synergien und Combos bleiben —
  // die arbeiten nur mit der Karte selbst und stehen jedem offen.
  const eb = $("#dt-edit"), pb0 = $("#dt-price"), bb = $("#dt-bild");
  if (eb) eb.hidden = !!fremd;
  if (pb0) pb0.hidden = !!fremd;
  // Das Bild gehört zur Karte des Besitzers — bei einer fremden Karte
  // (Community-Kachel) verschwindet der Knopf wie Bearbeiten und Preis.
  if (bb) bb.hidden = !!fremd;
  if (fremd) return wireDetailSynergien(c);

  // Erst schließen, dann den Bild-Dialog — wie bei „Bearbeiten": zwei
  // gestapelte Dialoge wären fragil. bildDlg öffnet die Detailansicht danach
  // wieder, egal ob gespeichert oder abgebrochen.
  if (bb) bb.onclick = () => { $("#detail-dlg").close(); bildDlg(c); };

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
  wireDetailSynergien(c);
}

/* Alles, was nur die Karte selbst braucht und keinen Besitz voraussetzt:
   Synergien, KI-Synergien, Combos, Legalität, Deck-Sprünge. Eigener Abschnitt,
   damit auch die Ansicht einer fremden Karte ihn bekommt. */
function wireDetailSynergien(c) {
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

  // Deck-Zugehörigkeit: Klick auf eine Deck-Nennung springt zum Deck.
  $$("#detail-body .deck-chip[data-godeck]").forEach(ch =>
    ch.onclick = () => zeigeDeck(ch.dataset.godeck));
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
  if (c) zeigeHoverKarte(c, x, y);
}

/* Dieselbe Vorschau, aber für ein Kartenobjekt statt einer ID — die
   Community-Kacheln zeigen fremde Karten, die in CARDS nie zu finden sind. */
function zeigeHoverKarte(c, x, y) {
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
/* zusatz ist optional (z. B. der Preis im Community-Feed) — die bisherigen
   Aufrufer übergeben ihn nicht und bekommen unverändert nur Bild und Name. */
function zeigeCmdHover(img, name, x, y, zusatz) {
  if (!cmdHoverEl) { cmdHoverEl = document.createElement("div"); cmdHoverEl.className = "cmd-hover"; }
  // Ist ein modaler Dialog offen (Kartendetail via showModal → Top-Layer), muss
  // die Vorschau DARIN hängen — sonst rendert sie hinter dem Dialog, den kein
  // z-index überbietet. Sonst am body (z. B. Combos in der Deck-Ansicht).
  const ziel = document.querySelector("dialog[open]") || document.body;
  if (cmdHoverEl.parentElement !== ziel) ziel.appendChild(cmdHoverEl);
  const el = cmdHoverEl;
  el.innerHTML = `<img src="${esc(img)}" alt=""><div class="cmd-hover-nm">${esc(name)}</div>` +
    (zusatz ? `<div class="cmd-hover-zus">${esc(zusatz)}</div>` : "");
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
function synKachel(card, grundText, deckId, schnitt) {
  const img = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || "";
  const p = synPreis(card);
  const besessen = besessenAnzahl(card);
  const badge = besessen > 0
    ? `<span class="syn-owned" title="${esc(t("syn.ownedTitle", { n: besessen }))}">&#10003;</span>` : "";
  let addBtn = "", cut = "";
  if (deckId && card.id) {
    SYN_CACHE.set(card.id, card);
    const owned = besessen > 0;
    const deck = DECKS.find(d => d.id === deckId);
    // Zwei Gründe, den Knopf ruhen zu lassen — der speziellere zuerst: liegt die
    // Karte schon im Deck, hilft auch kein Schnitt, denn ein zweites Exemplar
    // wäre im Commander ohnehin nicht erlaubt.
    const schonDrin = singletonFrei(deck, card) === 0;
    const voll = !schonDrin && deckFrei(deck) === 0;
    addBtn = (schonDrin || voll)
      ? `<button class="syn-add voll" disabled title="${esc(t(schonDrin ? "deck.singletonBtnTitle" : "deck.fullBtnTitle"))}">&#43;&#160;${esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`
      : `<button class="syn-add${owned ? " owned" : ""}" data-deck="${esc(deckId)}" data-sid="${esc(card.id)}"
      title="${esc(t(owned ? "syn.addOwnedTitle" : "syn.addWishTitle"))}">&#43;&#160;${
        esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`;
    if (voll) cut = schnittHinweisHtml(schnitt || deckSchnittKandidat(deck, card));
  }
  return `<div class="syn-card">
    <a class="syn-card-link" href="${esc(card.scryfall_uri || "#")}" target="_blank" rel="noopener noreferrer">
      <div class="syn-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="syn-noimg">&#9670;</div>`}${badge}</div>
      <div class="syn-name">${esc(card.name)}</div>
      <div class="syn-type">${esc(card.type_line || "")}</div>
      <div class="syn-exp" title="${esc(grundText)}">${esc(grundText)}</div>
    </a>
    ${cut}
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
    p_printed_name: printedNameOf(c),
    // Setcode GROSS, wie auf allen Sammlungswegen (add_card macht es genauso).
    // Scryfall liefert ihn klein; ungewandelt trug eine Wunschzeile "ltr", wo die
    // gescannte Karte "LTR" trägt — und jeder Vergleich über Set+Nummer ging ins Leere.
    p_set_code: (c.set || "").toUpperCase() || null, p_set_name: c.set_name || null,
    p_cn: c.collector_number || null,
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
  // Global + persönlich freigeschaltete Funktionen in einem Zug.
  try {
    const { data } = await sb.rpc("effective_features");
    FEATURES = new Set(Array.isArray(data) ? data : []);
  } catch { FEATURES = new Set(); }
  // Stundenkontingente der KI-Funktionen. Jede angemeldete Person darf sie
  // lesen; ändern darf sie nur der Admin (Policy in der Datenbank).
  try {
    const { data } = await sb.from("ai_limits").select("kind,per_hour");
    AI_LIMITS = {}; (data || []).forEach(l => { AI_LIMITS[l.kind] = l.per_hour; });
  } catch { AI_LIMITS = {}; }
  document.documentElement.dataset.kiGlobal = FLAGS.ki_synergy ? "on" : "off";
}

/* Kontingent einer KI-Funktion setzen. 0 = unbegrenzt. Nur der Admin kommt
   durch — die Datenbank weist andere ab, der Knopf ist bloß die Bequemlichkeit. */
async function aiLimitSetzen(kind, n) {
  const wert = Math.max(0, Math.min(1000, Math.floor(Number(n) || 0)));
  const { error } = await sb.from("ai_limits").update({ per_hour: wert }).eq("kind", kind);
  if (error) throw error;
  AI_LIMITS[kind] = wert;
  return wert;
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
  zaehleCommunitySuche("synergies", res.length);
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
    // Das eingestellte Maximum ans Modell durchreichen, statt die Antwort
    // hinterher zu kürzen: Wer weniger Vorschläge will, soll auch weniger
    // Ausgabe-Tokens bezahlen. Die Function klemmt selbst auf 3..15.
    body: { card: { name: card.name, type_line: card.type_line, oracle_text: card.oracle_text },
            lang: LANG, n: prefWert("synLimit") || 10 },
    selfName: card.name,
    maxPrice: opts.maxPrice,
  });
}

/* Passt die Farbidentität einer Karte in die erlaubten Deckfarben (Teilmenge)? */
function farbIdentPasst(ci, erlaubt) { return (ci || []).every(f => erlaubt.has(f)); }

/* Die Deckliste, wie sie das Modell braucht: Name, Typzeile, Regeltext.

   Lange gingen nur die NAMEN raus. Das reicht, solange das Modell die Karten
   kennt — aber jedes neue Set kennt es nicht, und dann rät es aus dem Namen.
   „Topiary Lecturer" klingt nach Pflanzen, macht aber +1/+1-Zählmarken; die
   Begründung wurde damit nicht bloß vage, sondern sachlich falsch. Mit dem
   Regeltext muss nichts geraten werden.

   Standardländer tragen keinen Regeltext, der etwas erklären würde, und der
   Rest wird bei 300 Zeichen gekappt: das deckt auch lange Karten ab, ohne
   dass 100 Karten die Anfrage sprengen. */
function deckKartenFuersModell(cards) {
  // Manakosten nur, wenn das Verfahren an ist. Sie stehen NICHT im Regeltext,
  // deshalb konnte der Prüfer eine Aussage wie „kostet vier Mana" nie
  // bestätigen und hat sie als unbelegt verworfen — ein Falschpositiver, der
  // nicht am Urteil lag, sondern an fehlenden Daten. Kostet etwa ein Token je
  // Karte, deshalb zuschaltbar statt immer.
  const mitKosten = hatFeature("verify_cost");
  const gesehen = new Set();
  const raus = [];
  for (const c of cards) {
    const nm = c?.name;
    if (!nm || gesehen.has(nm)) continue;
    gesehen.add(nm);
    const typ = c.type_line || "";
    if (/basic/i.test(typ) && /land/i.test(typ)) { raus.push({ n: nm }); }
    else {
      const k = { n: nm, t: typ, o: (c.oracle_text || "").slice(0, 300) };
      if (mitKosten && c.mana_cost) k.m = String(c.mana_cost).slice(0, 40);
      raus.push(k);
    }
    if (raus.length >= 120) break;
  }
  return raus;
}

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
        cards: deckKartenFuersModell(cards),
        // Ist das Deck voll, soll das Modell zu jedem Vorschlag gleich sagen,
        // welche Karte dafür weichen sollte — es kennt die Liste ohnehin.
        full: deckFrei(deck) === 0,
      },
      // Wie bei der Einzelkarte: das eingestellte Maximum geht ans Modell,
      // damit die Einstellung Ausgabe-Tokens spart und nicht nur die Anzeige
      // kürzt. Ohne Einstellung bleibt es beim bisherigen Wert.
      lang: LANG, n: prefWert("synLimit") || 12,
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
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
      if (ctx?.code === "quota") msg = limitMeldung(ctx);
    } catch { /* generisch */ }
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
    treffer.push(vorschlagCardHtml(c, s.reason, cfg.deckId, schnittAusModell(cfg.deckId, s, c)));
    if (lim && treffer.length >= lim) break;
  }
  // Erst hier zählen: „treffer" ist, was tatsächlich angezeigt wird — nach
  // Scryfall-Prüfung, Farb- und Preisfilter und dem eingestellten Höchstwert.
  // Die Rohliste des Modells ist regelmäßig länger und wäre die falsche Zahl.
  zaehleCommunitySuche("synergies", treffer.length);
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
function vorschlagCardHtml(card, etikett, deckId, schnitt) { return synKachel(card, etikett, deckId, schnitt); }

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

/* Der Name der VORDERSEITE: alles vor dem „//". Zweiteilige Namen tragen
   Doppelkarten, Abenteuer, geteilte und umklappbare Karten
   („Jidoor, Aristocratic Capital // Overture"). */
const vorderName = n => (n || "").split("//")[0].trim();

/* Alle in Combos vorkommenden Karten (nach Name) bei Scryfall zu vollen
   Objekten auflösen — für die Kachel-Darstellung (Bild/Typ/Preis) und den
   „+ Deck"/„+ Wunsch"-Knopf. Sammel-Requests in Blöcken zu 75. Map name→Karte.

   GEFRAGT WIRD MIT DER VORDERSEITE. Der Namens-Bezeichner von /cards/collection
   nimmt nur sie: „Jidoor, Aristocratic Capital" findet die Karte,
   „Jidoor, Aristocratic Capital // Overture" landet in not_found. Commander
   Spellbook liefert aber genau die lange Form — jede zweiteilige Karte blieb
   deshalb unaufgelöst und erschien als grauer Platzhalter mit Namen darunter.
   (Am Bild lag es nie: Scryfall gibt bei diesen Karten sehr wohl ein
   image_uris aus, es kam nur nie eine Karte an.)

   ABGELEGT WIRD UNTER JEDER SCHREIBWEISE. Zurück kommt der lange Name, gesucht
   wird mal so, mal so — je nachdem, welche Form die Combo-Quelle nennt.
   Deshalb landet jede Karte unter ihrem vollen Namen, ihrer Vorderseite und
   jedem einzelnen Gesichtsnamen in der Map. */
async function comboKartenLaden(namen) {
  const byLower = new Map();
  const uniq = [...new Set(namen.map(n => (n || "").trim()).filter(Boolean))];
  const fragen = [...new Set(uniq.map(vorderName).filter(Boolean))];
  const merke = c => {
    for (const n of [c.name, vorderName(c.name), ...(c.card_faces || []).map(f => f.name)])
      if (n) byLower.set(n.toLowerCase(), c);
  };
  for (let i = 0; i < fragen.length; i += 75) {
    try {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ identifiers: fragen.slice(i, i + 75).map(name => ({ name })) }),
      });
      if (r.ok) for (const c of (await r.json()).data || []) merke(c);
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
  let addBtn = "", cut = "";
  if (alsAktion && card.id) {
    SYN_CACHE.set(card.id, card);
    const owned = besessen > 0;
    // Volles Deck bzw. schon im Deck: derselbe gesperrte Zustand wie bei den
    // Synergie-Kacheln — der Knopf soll überall gleich aussehen und gleich
    // erklären.
    const deck = DECKS.find(d => d.id === deckId);
    const schonDrin = singletonFrei(deck, card) === 0;
    const voll = !schonDrin && deckFrei(deck) === 0;
    addBtn = (schonDrin || voll)
      ? `<button class="syn-add voll" disabled title="${esc(t(schonDrin ? "deck.singletonBtnTitle" : "deck.fullBtnTitle"))}">&#43;&#160;${esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`
      : `<button class="syn-add${owned ? " owned" : ""}" data-deck="${esc(deckId)}" data-sid="${esc(card.id)}"
      title="${esc(owned ? t("syn.addOwnedTitle") : t("syn.addWishTitle"))}">&#43;&#160;${esc(t(owned ? "syn.addDeck" : "syn.addWish"))}</button>`;
    if (voll) cut = schnittHinweisHtml(deckSchnittKandidat(deck, card));
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
    </div>${addBtn}${cut}${buy}
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

  // „max. Anzahl Vorschläge" gilt laut Einstellung auch für Combo-Suchen —
  // bisher kam sie hier nie an.
  const cLim = prefWert("synLimit");
  let included = (data.included || []).slice(0, cLim || undefined);
  // Einstellung „nur komplette Combos": die „Fast komplett"-Kategorie weglassen.
  let almost = suchPrefs().onlyComplete ? [] : (data.almostIncluded || []).slice(0, cLim || undefined);
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
  // Nach dem Filtern zählen — gezeigt wird, was übrig bleibt.
  zaehleCommunitySuche("combos", included.length + almost.length);

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
  let included = (data.included || []).slice(0, prefWert("synLimit") || undefined);
  if (!included.length) { box.innerHTML = `<div class="empty">${esc(t("combo.collNone"))}</div>`; return; }
  // Legalität: ohne Deck-Kontext gegen Commander (siehe comboLegalKey).
  const gesamt = included.length;
  const illegal = included.filter(c => !comboIstLegal(c, "commander")).length;
  if (illegal && suchPrefs().hideBanned) included = included.filter(c => comboIstLegal(c, "commander"));
  // Nach dem Filtern zählen — gezeigt wird, was übrig bleibt.
  zaehleCommunitySuche("combos", included.length);
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
    data = await combosApi({ mode: "variants", q, limit: prefWert("synLimit") || 12 });
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
  // Nach dem Filtern zählen — gezeigt wird, was übrig bleibt.
  zaehleCommunitySuche("combos", combos.length);
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

  // Die am staerksten ueberbesetzte Kategorie: aus ihr wuerde man am ehesten
  // schneiden, wenn eine andere zu duenn ist. Nur die Analyse weiss das.
  const ueber = analyse.filter(a => a.ist > a.ziel)
    .sort((x, y) => (y.ist / y.ziel) - (x.ist / x.ziel))[0];
  const ueberKategorie = ueber ? AN_KATEGORIEN.find(k => k.key === ueber.key) : null;
  const dAn = DECKS.find(x => x.id === deckId);
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
      <div class="syn-grid">${treffer.map(c => vorschlagCardHtml(c, label, deckId,
        deckFrei(dAn) === 0 ? deckSchnittKandidat(dAn, c, { ueberKategorie }) : null)).join("")}</div>
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
    patch.printed_name = printedNameOf(fresh);
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
    // Gedruckte Fassung der NEUEN Auflage — ohne "|| c.…": ist die neue
    // Auflage englisch, muss der alte deutsche Text weg, sonst stünde er unter
    // einer englischen Karte. Gleiche Logik wie bei printed_name darüber.
    patch.printed_text = printedTextOf(fresh);
    patch.printed_type_line = printedTypeOf(fresh);
    // Seiten gehören zur Auflage (eigene Bilder, eigener gedruckter Text) und
    // müssen mitwandern. facesOf ist bei einseitigen Karten null — dann bleibt
    // die Spalte, wie sie war (auch sie null).
    const fcNeu = facesOf(fresh);
    if (fcNeu) patch.faces = fcNeu;
  } else if (lang !== c.lang) {
    // Sprachwechsel: die sprachgenaue Auflage hat eine eigene Scryfall-ID,
    // eigenen gedruckten Namen und eigenes Bild. Gibt es sie nicht (viele
    // Karten führt Scryfall nur englisch), bleibt die bisherige Auflage
    // stehen und nur das Sprachfeld wechselt.
    fresh = await withPrice(await sfCode(c.set, c.cn, lang));
    if (fresh) {
      patch.scryfall_id = fresh.id;
      patch.printed_name = printedNameOf(fresh);
      // Auch hier ohne Rückfall auf den alten Wert: beim Wechsel DE → EN
      // liefert Scryfall keine printed_*-Felder, und genau dann muss der
      // deutsche Text verschwinden.
      patch.printed_text = printedTextOf(fresh);
      patch.printed_type_line = printedTypeOf(fresh);
      const fcNeu = facesOf(fresh);
      if (fcNeu) patch.faces = fcNeu;
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
      // Die Einordnung der verschwindenden Zeile merken, BEVOR sie gelöscht
      // wird: Die Zuordnungen hängen am Deckplatz und gehen mit ihm verloren
      // (on delete cascade). Dieselbe Regel wie beim Einlösen eines Wunsches.
      const zu = DECK_KAT_TABELLE_FEHLT ? { data: [] }
        : await sb.from("deck_entry_categories").select("category_id, is_primary")
            .eq("deck_id", en.deck_id).eq("card_id", c.id);
      const merge = await sb.from("deck_entries").upsert(
        [{ deck_id: en.deck_id, card_id: twin.id, qty: (ex.data?.qty || 0) + en.qty }],
        { onConflict: "deck_id,card_id" });
      if (!merge.error) {
        // Die Zielzeile behält ihre eigene Einteilung, falls sie eine hat; die
        // der verschwindenden springt nur ein, wo dort noch nichts steht.
        const hat = DECK_KAT_TABELLE_FEHLT ? { data: [1] }
          : await sb.from("deck_entry_categories").select("category_id")
              .eq("deck_id", en.deck_id).eq("card_id", twin.id).limit(1);
        if (!hat.error && !(hat.data || []).length && (zu.data || []).length)
          await sb.from("deck_entry_categories").insert((zu.data).map(x => ({
            deck_id: en.deck_id, card_id: twin.id,
            category_id: x.category_id, is_primary: x.is_primary })));
        await sb.from("deck_entries").delete().eq("deck_id", en.deck_id).eq("card_id", c.id);
      }
    }
    const del = await sb.from("cards").delete().eq("id", c.id);
    if (del.error) throw new Error(dbErr(del.error));
    toast(t("toast.mergedQty", { n: twin.qty + c.qty }));
  } else {
    const { error } = await sb.from("cards").update(patch).eq("id", c.id);
    if (error) throw new Error(dbErr(error));
    toast(neu
      ? t("toast.cardNow", { name: printedNameOf(fresh) || fresh.name, set: patch.set_code, cn: patch.cn })
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
/* ==================== Commander: 100-Karten-Grenze ====================
   Die offiziellen Regeln erlauben genau 100 Karten EINSCHLIESSLICH des
   Commanders. Der ist hier kein Sonderfall: main_card_id markiert nur eine
   Karte, die ohnehin als Eintrag im Deck liegt — die Summe über qty ist
   also bereits die Zahl, um die es geht.

   Durchgesetzt wird die Grenze in der Datenbank (Trigger auf deck_entries),
   weil vier Wege ins Deck schreiben. Was hier steht, ist die Vorwarnung:
   Knöpfe sperren und erklären, statt den Nutzer in eine Absage laufen zu
   lassen. */
const DECK_MAX = 100;

const istCommanderDeck = d => (d?.format || "") === "Commander";
const deckGroesse = d => (d?.entries || []).reduce((s, e) => s + e.qty, 0);

/* Wie viele Karten noch hineinpassen. Unbegrenzt für alles außer Commander.
   Altbestände über 100 (die gab es, bevor es die Regel gab) geben 0, nicht
   negativ — sie nehmen nichts mehr auf, blockieren aber nichts anderes. */
function deckFrei(d) {
  if (!istCommanderDeck(d)) return Infinity;
  return Math.max(0, DECK_MAX - deckGroesse(d));
}
const deckFreiById = id => deckFrei(DECKS.find(d => d.id === id));

/* Die Absage des Triggers erkennen. Sie trägt den hint „deck_full"; die
   Meldung formuliert die Oberfläche selbst, damit sie übersetzt ist. */
const istDeckVollFehler = e =>
  e?.hint === "deck_full" || /deck_full/.test(e?.hint || e?.message || "");

const istSingletonFehler = e =>
  e?.hint === "deck_singleton" || /deck_singleton/.test(e?.hint || e?.message || "");

/* ---- Singleton-Regel ----------------------------------------------------
   Ein Commander-Deck darf von jeder Karte nur ein Exemplar enthalten.
   Maßgeblich ist der englische KARTENNAME, nicht die Auflage: zwei Drucke
   derselben Karte sind zwei Zeilen in der Sammlung, aber trotzdem zweimal
   dieselbe Karte.

   Ausnahmen sprechen die Karten selbst aus, deshalb steht die Erkennung im
   Regeltext und nicht in einer gepflegten Liste — eine Liste wäre mit dem
   nächsten Set veraltet. type_line und oracle_text liefert Scryfall auch bei
   fremdsprachigen Drucken auf Englisch (die Landessprache steht in printed_*),
   die Prüfung ist also sprachunabhängig.

   Durchgesetzt wird auch das im Trigger; hier steht die Vorwarnung. */
const ZAHLWORT = { one: 1, two: 2, three: 3, four: 4, five: 5,
                   six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function commanderMaxKopien(card) {
  const typ = card?.type_line || "";
  if (/basic/i.test(typ) && /land/i.test(typ)) return Infinity;   // Standardländer
  const txt = card?.oracle_text || card?.card_faces?.[0]?.oracle_text || "";
  if (/a deck can have any number of cards named/i.test(txt)) return Infinity;
  const m = txt.match(/a deck can have up to (\w+) cards named/i);
  if (m) return ZAHLWORT[m[1].toLowerCase()] || 1;
  return 1;
}

/* Wie oft liegt diese Karte — über alle Auflagen — schon im Deck? */
function deckKopien(d, card) {
  const nm = (card?.name || "").toLowerCase();
  if (!d || !nm) return 0;
  let n = 0;
  for (const e of d.entries || []) {
    const c = CARDS.find(x => x.id === e.cardId);
    if (c && (c.name || "").toLowerCase() === nm) n += e.qty;
  }
  return n;
}

/* Passt noch ein Exemplar dieser Karte ins Deck? Nur für Commander relevant. */
function singletonFrei(d, card) {
  if (!istCommanderDeck(d)) return Infinity;
  return Math.max(0, commanderMaxKopien(card) - deckKopien(d, card));
}

/* Einheitliche Absage, wenn jemand trotz gesperrter Knöpfe durchkommt. */
function deckVollMelden(d) {
  toast(t("deck.fullToast", { n: deckGroesse(d), max: DECK_MAX }));
}

/* Dieselbe KARTE, egal welche Auflage. Hier geht es ums Spielen, und dafür ist
   jede Auflage dieselbe Karte — anders als bei gleicheKarte(), das die einzelne
   Auflage meint (welches Exemplar aus dem Regal steckt in welchem Deck).

   Drei Wege, und jeder darf allein genügen:

   1. Set + Sammlernummer. Das Paar bezeichnet eine Auflage, und eine Auflage
      IST eine bestimmte Karte — was in oracle_id oder name steht, kann dann
      nur falsch sein. Zuerst geprüft, weil es die Angabe ist, die auf der
      Karte steht und die man selbst nachschlagen kann.
   2. oracle_id — teilen alle Drucke, Sprachen und Foil-Fassungen. Greift auch
      dann, wenn man eine ANDERE Auflage gekauft hat als die gewünschte.
   3. Der englische Name, für Uralt-Zeilen ohne oracle_id.

   Sprache, Ausführung und Zustand spielen bei keinem der drei eine Rolle: Wer
   sich eine Karte wünscht, bekommt sie standardmäßig als englische, nicht-foil
   Zeile eingetragen und kauft dann, was der Laden hergibt. Ein Abgleich, der
   darauf bestünde, würde nie zutreffen. */
function selbeKarte(a, b) {
  if (!a || !b) return false;
  if (gleicherDruck(a, b)) return true;
  if (a.oracle_id && b.oracle_id) return a.oracle_id === b.oracle_id;
  return (a.name || "").toLowerCase() === (b.name || "").toLowerCase();
}

/* Liegt dieselbe Karte bereits als UNERFÜLLTER Wunsch im Deck — in einer
   anderen Auflage als der jetzt gewählten? Dann ist der Deckplatz längst
   vergeben und der Wunsch mit der neu besessenen Auflage schlicht erfüllt.
   Ohne diesen Fall stünde man vor einer Absage („Deck voll"), obwohl das Deck
   gar nicht wachsen soll: die Karte war schon eingeplant. */
function deckWunschEintrag(d, pick) {
  if (!d || !pick) return null;
  for (const e of d.entries || []) {
    if (e.cardId === pick.id) continue;                 // dieselbe Zeile, kein Umhängen
    const c = CARDS.find(x => x.id === e.cardId);
    if (!c || !selbeKarte(c, pick)) continue;
    if (e.qty > bestandVon(c)) return { eintrag: e, karte: c };   // fehlt noch
  }
  return null;
}

/* Welche Karte im Deck würde man für einen Vorschlag am ehesten schneiden?
   Die Reihenfolge der Argumente, vom stärksten zum schwächsten:

     1. Eine Karte, die gar nicht besessen wird. Das Deck ist mit ihr ohnehin
        nicht spielbar — der schmerzloseste Schnitt, und er erklärt sich selbst.
     2. Eine Karte aus einer überbesetzten Kategorie. Nur die Deck-Analyse
        weiß das; sie reicht sie über opts.ueberKategorie herein.
     3. Gleicher Kartentyp wie der Vorschlag, teuerste zuerst — Gleiches
        gegen Gleiches zu tauschen hält die Kurve stabil.
     4. Sonst schlicht die teuerste Karte.

   Commander und Zweit-Commander bleiben immer außen vor, Länder ebenfalls:
   an der Manabasis herumzuschneiden ist selten das, was jemand will. */
const HAUPT_TYPEN = ["Creature", "Instant", "Sorcery", "Artifact",
                     "Enchantment", "Planeswalker", "Battle", "Land"];
const hauptTyp = tl => HAUPT_TYPEN.find(x => new RegExp(`\\b${x}\\b`, "i").test(tl || "")) || "";

function deckSchnittKandidat(d, vorschlag, opts = {}) {
  if (!d) return null;
  const tabu = new Set([d.main_card_id, d.second_card_id].filter(Boolean));
  const karten = (d.entries || [])
    .filter(e => !tabu.has(e.cardId))
    .map(e => CARDS.find(c => c.id === e.cardId))
    .filter(c => c && !istLand(c));
  if (!karten.length) return null;

  const teuerst = liste => [...liste].sort((a, b) => (Number(b.cmc) || 0) - (Number(a.cmc) || 0))[0];
  const mit = (karte, grund) => karte ? { karte, grund } : null;

  const nichtBesessen = karten.filter(c => bestandVon(c) < 1);
  if (nichtBesessen.length) return mit(teuerst(nichtBesessen), "unowned");

  if (opts.ueberKategorie) {
    const drin = karten.filter(opts.ueberKategorie.test);
    if (drin.length) return mit(teuerst(drin), "category");
  }

  const typ = hauptTyp(vorschlag?.type_line);
  if (typ) {
    const gleich = karten.filter(c => hauptTyp(c.type_line) === typ);
    if (gleich.length) return mit(teuerst(gleich), "sameType");
  }

  return mit(teuerst(karten), "highCmc");
}

/* Der Schnitt-Vorschlag des Modells, gegen die Deckliste geprüft. Ein Name,
   der dort nicht steht oder der Commander ist, wird verworfen — dann greift
   die Heuristik. Das Modell schlägt vor, die Deckliste entscheidet; genauso
   wie bei den Kartennamen selbst wird nichts ungeprüft übernommen. */
function schnittAusModell(deckId, vorschlag, karte) {
  const d = DECKS.find(x => x.id === deckId);
  if (!d || deckFrei(d) !== 0) return null;
  const name = String(vorschlag?.replaces || "").trim().toLowerCase();
  if (name) {
    const tabu = new Set([d.main_card_id, d.second_card_id].filter(Boolean));
    const treffer = (d.entries || [])
      .filter(e => !tabu.has(e.cardId))
      .map(e => CARDS.find(c => c.id === e.cardId))
      .find(c => c && (c.name || "").toLowerCase() === name);
    // Die Begründung des Modells gilt NUR für die Karte, die es selbst genannt
    // hat. Fällt der Name durch die Prüfung, greift unten die Heuristik — dann
    // wäre der Satz eine Begründung für eine ganz andere Karte.
    if (treffer) {
      const warum = String(vorschlag?.replacesWhy || "").trim();
      const pruef = vorschlag?.verify;
      // Vom Server als unbelegt erkannt (ok === false; null heißt „nicht
      // prüfbar", nicht „widerlegt"). Wer ein Prüfverfahren freigeschaltet hat,
      // sieht die Begründung markiert samt Grund — genau das soll beurteilt
      // werden. Für alle anderen fällt sie wortlos weg und der feste Satz
      // greift, damit niemand eine Behauptung liest, die nicht trägt.
      if (pruef?.ok === false) {
        return zeigtPruefung()
          ? { karte: treffer, grund: "model", warum, unbelegt: true,
              hinweis: String(pruef.note || ""), verfahren: pruef.method || "" }
          : { karte: treffer, grund: "model", warum: "" };
      }
      return { karte: treffer, grund: "model", warum };
    }
  }
  return deckSchnittKandidat(d, karte);
}

/* Die Zeile unter einem Vorschlag, wenn das Deck voll ist.

   Die vier heuristischen Gründe tragen ihr Argument schon im Namen und werden
   übersetzt. Beim Modell sagt der feste Satz nur, DASS die KI es so wollte —
   das ist keine Begründung. Liefert es einen eigenen Satz, steht der hier;
   fehlt er, bleibt der feste Satz als ehrlicher Rückfall. */
function schnittHinweisHtml(schnitt) {
  if (!schnitt?.karte) return "";
  const warum = schnitt.warum || t("deck.cutWhy." + schnitt.grund);
  // Als unbelegt erkannt: durchgestrichen, damit auf einen Blick klar ist, dass
  // dieser Satz NICHT gilt, plus der Befund der Prüfung. Sieht nur, wer ein
  // Verfahren freigeschaltet hat — schnittAusModell entscheidet das vorher.
  const marke = schnitt.unbelegt
    ? `<span class="syn-cut-bad" title="${esc(schnitt.hinweis || t("deck.cutUnverifiedHint"))}">
        &#9888; ${esc(t("deck.cutUnverified"))}${schnitt.hinweis ? " — " + esc(schnitt.hinweis) : ""}</span>` : "";
  return `<div class="syn-cut" title="${esc(warum)}">
    &#9986; ${esc(t("deck.cutFor", { name: schnitt.karte.disp || schnitt.karte.name }))}
    <span class="syn-cut-why${schnitt.unbelegt ? " strich" : ""}">${esc(warum)}</span>${marke}</div>`;
}

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

/* Kann diese Karte ZWEITER Commander sein? Wie istCommanderFaehig, aber
   zusätzlich legendäre Backgrounds (Verzauberungen) — nur so bringt die
   „Choose a Background"-Variante zwei Commander zusammen. */
const istZweitCommanderFaehig = c => {
  const vorderseite = (c?.type_line || "").split("//")[0];
  if (!/legendary/i.test(vorderseite)) return false;
  return /creature|planeswalker/i.test(vorderseite) || /\bbackground\b/i.test(vorderseite);
};

/* ------------------------------------------------ Partner-Mechanik ----
   Zwei Karten dürfen nur dann gemeinsam Commander sein, wenn ihre Partner-
   Fähigkeiten zusammenpassen. Die fünf Varianten (Partner, Partner mit [Name],
   Friends forever, Choose a Background, Doctor's companion) liest partnerInfo
   aus Schlüsselwörtern (Scryfalls keywords, verbürgt) mit Rückfall auf den
   Regeltext bzw. die Typzeile. WICHTIG (regeltreu): „Partner with [Name]" trägt
   AUCH das schlichte „Partner", darf also mit jeder Partner-Karte kombiniert
   werden — der genannte Name gibt nur einen Bonus. Scryfall führt „Partner with"-
   Karten deshalb auch unter dem Schlüsselwort „Partner". */
function partnerInfo(c) {
  const kw = Array.isArray(c?.keywords) ? c.keywords.map(k => k.toLowerCase()) : [];
  const ot = c?.oracle_text || "";
  const front = (c?.type_line || "").split("//")[0];
  const has = k => kw.includes(k);
  return {
    partner:      has("partner") || has("partner with") || /(^|\n)partner\b/i.test(ot),
    friends:      has("friends forever") || /friends forever/i.test(ot),
    chooseBg:     has("choose a background") || /choose a background/i.test(ot),
    isBackground: /\bbackground\b/i.test(front),
    docCompanion: has("doctor's companion") || /doctor.?s companion/i.test(ot),
    isDoctor:     /creature/i.test(front) && /\bdoctor\b/i.test(front),
  };
}

/* Passen die Partner-Fähigkeiten zweier Karten zusammen? Verschiedene Varianten
   lassen sich NICHT mischen. Kein Zusammenspiel erlaubt je mehr als zwei
   Commander — hier geht es nur um EIN Paar. */
function sindPartner(a, b) {
  const A = partnerInfo(a), B = partnerInfo(b);
  if (A.partner && B.partner) return true;                                  // Partner (inkl. „Partner with")
  if (A.friends && B.friends) return true;                                  // Friends forever
  if ((A.chooseBg && B.isBackground) || (B.chooseBg && A.isBackground)) return true;   // Choose a Background
  if ((A.docCompanion && B.isDoctor) || (B.docCompanion && A.isDoctor)) return true;   // Doctor's companion
  return false;
}

async function setMainCard(deckId, cardId) {
  const d = DECKS.find(x => x.id === deckId);
  // Nochmal auf dieselbe Karte: Hauptkarte (ersten Commander) wieder abwählen —
  // dann fällt auch der zweite weg (ohne ersten ergibt er keinen Sinn).
  const abwaehlen = d?.main_card_id === cardId;
  const patch = abwaehlen ? { main_card_id: null, second_card_id: null } : { main_card_id: cardId };
  // Beim WECHSEL des ersten Commanders einen nun unpassenden zweiten lösen.
  if (!abwaehlen && d?.second_card_id) {
    const neuHaupt = CARDS.find(x => x.id === cardId);
    const zweit = CARDS.find(x => x.id === d.second_card_id);
    if (!zweit || zweit.id === cardId || !neuHaupt || !sindPartner(neuHaupt, zweit))
      patch.second_card_id = null;
  }
  const { error } = await sb.from("decks").update(patch).eq("id", deckId);
  if (error) {
    // Fehlt die Spalte, ist das Schema älter als die App.
    if (error.code === "42703" || /main_card_id/.test(error.message || ""))
      return toast(t("toast.columnMissing"));
    // Der Trigger lehnt ungeeignete Karten ab; seine Meldung ist bereits
    // für Menschen geschrieben, also unverändert durchreichen. (Sie enthält
    // selbst einen Doppelpunkt — ein Präfix-Abschneider fräße den halben Satz.)
    if (error.code === "23514" || /legendär|Typzeile|Hauptkarte|Commander/i.test(error.message || ""))
      return toast(error.message);
    return toast(dbErr(error));
  }
  await reload(); renderDecks();
  toast(abwaehlen ? t("toast.mainUnset") : t("toast.mainSet"));
}

/* Zweiten Commander (Partner) setzen/lösen. Voraussetzungen: erster Commander
   gesetzt, andere Karte, geeigneter Typ UND passende Partner-Fähigkeit. */
async function setSecondCard(deckId, cardId) {
  const d = DECKS.find(x => x.id === deckId);
  if (!d) return;
  const abwaehlen = d.second_card_id === cardId;
  if (!abwaehlen) {
    if (!d.main_card_id) return toast(t("toast.needMainFirst"));
    const haupt = CARDS.find(x => x.id === d.main_card_id);
    const c = CARDS.find(x => x.id === cardId);
    if (!c || cardId === d.main_card_id || !istZweitCommanderFaehig(c) || !haupt || !sindPartner(haupt, c))
      return toast(t("toast.notPartner"));
  }
  const { error } = await sb.from("decks").update({ second_card_id: abwaehlen ? null : cardId }).eq("id", deckId);
  if (error) {
    if (error.code === "42703" || /second_card_id/.test(error.message || ""))
      return toast(t("toast.columnMissing"));
    if (error.code === "23514" || /legendär|Typzeile|Commander/i.test(error.message || ""))
      return toast(error.message);
    return toast(dbErr(error));
  }
  await reload(); renderDecks();
  toast(abwaehlen ? t("toast.secondUnset") : t("toast.secondSet"));
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

/* Commander-Kärtchen im Deck-Kopf: kleines Bild mit Hover-Vorschau (data-cmd-*
   wie in der Spielrunde). Für ersten und — bei Partnern — zweiten Commander. */
function deckHauptImg(c) {
  return `<img class="deck-haupt" src="${esc(c.img)}" alt="" title="${esc(c.disp)}"
     data-cmd-img="${esc((c.img || "").replace("/small/", "/normal/"))}"
     data-cmd-name="${esc(c.disp)}">`;
}

/* ==================== Eigene Kategorien je Deck =======================
   Die Deck-Tabelle gruppierte lange allein nach Kartentyp. Diese Ordnung
   bringt die Karte mit, nicht der Spieler: sie sagt, WAS eine Karte ist, aber
   nicht, WOZU sie im Deck steht. Ein Sol Ring ist ein Artefakt, gespielt wird
   er als Ramp; ein Swords to Plowshares ist eine Spontanzauberei, im Deck ist
   es Removal. Wer ein Deck baut, denkt in der zweiten Ordnung — und rechnet in
   ihr: "acht Ramp, zehn Removal, elf Kartenziehen" ist die Frage, die man an
   eine Deckliste stellt, nicht "wie viele Spontanzauber".

   Beides bleibt nebeneinander bestehen, umgeschaltet wird je Deck. Das ist
   nicht Unentschlossenheit: Ein halb eingeordnetes Deck ist der Regelfall
   (100 Karten ordnet niemand in einem Zug ein), und solange das so ist, sagt
   die Typ-Ansicht mehr. Wer nie eine Kategorie anlegt, merkt von alldem
   nichts. */

/* Welche Ordnung ein Deck gerade zeigt. Reine Ansichtssache wie der
   Aufklapp-Zustand — deshalb im Browser und nicht in der Datenbank.

   Die Voreinstellung ist bewusst kein fester Wert, sondern eine Frage an das
   Deck: Hat es eigene Kategorien, zeigt es sie. So wirkt die erste angelegte
   Kategorie sofort und auf JEDEM Gerät, ohne dass irgendwo etwas gesetzt sein
   müsste — und ein Deck ohne Kategorien sieht aus wie immer. Erst wer den
   Schalter anfasst, legt für dieses Deck etwas fest. */
const deckGruppe = {
  lies() { try { return JSON.parse(localStorage.getItem("mtg-deck-gruppe") || "{}") || {}; }
           catch { return {}; } },
  nachKat(d) {
    const w = this.lies()[d.id];
    return w === "kat" || (w !== "typ" && !!d.kategorien?.length);
  },
  setze(id, wert) {
    const m = this.lies(); m[id] = wert;
    try { localStorage.setItem("mtg-deck-gruppe", JSON.stringify(m)); } catch { /* voll */ }
  },
};

/* Die Gruppen eines Decks in Anzeigereihenfolge: [{ key, label, items }].

   `key` wandert in den Aufklapp-Zustand (deckCatZu) und muss deshalb zwischen
   den beiden Ordnungen unterscheidbar sein — daher die Präfixe "t:" und "k:".
   Ohne sie stünde eine Kategorie namens "Land" auf demselben Schlüssel wie die
   Typgruppe der Länder und klappte mit ihr zusammen zu.

   LEERE GRUPPEN: Eine eigene Kategorie bleibt stehen, auch wenn noch keine
   Karte darin liegt — sie ist eine Aussage des Nutzers, und wer gerade "Ramp"
   angelegt hat, soll es sehen. Eine leere Typgruppe fällt weg: sie ist
   abgeleitet, und "0 Planeswalker" hat niemand behauptet.

   MEHRFACH: Eine Karte steht in JEDER Kategorie, der sie zugeordnet ist — ein
   Sol Ring erscheint unter Ramp und unter Artefakt-Paket. Die Summe der Gruppen
   ist damit nicht mehr die Deckgröße; das ist der Preis dafür, dass beide
   Rechnungen stimmen. Die Zahl über der Tabelle zählt weiter jede Karte einmal. */
function deckGruppen(d, eintraege) {
  const gruppen = new Map();
  const leg = (key, x) => {
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(x);
  };
  if (deckGruppe.nachKat(d)) {
    const kats = d.kategorien || [];
    const bekannt = new Set(kats.map(k => k.id));
    for (const x of eintraege) {
      // Zuordnungen auf eine gelöschte Kategorie fallen beim Löschen weg
      // (on delete cascade) — die Prüfung deckt den kurzen Moment ab, in dem
      // die Anzeige älter ist als die Datenbank.
      const meine = (x.e.kats || []).filter(zu => bekannt.has(zu.id));
      if (!meine.length) leg("k:", x);
      else for (const zu of meine) leg("k:" + zu.id, x);
    }
    const rest = gruppen.get("k:") || [];
    return kats.map(k => ({ key: "k:" + k.id, label: k.name, items: gruppen.get("k:" + k.id) || [] }))
      .concat(rest.length ? [{ key: "k:", label: t("kat.none"), items: rest }] : []);
  }
  for (const x of eintraege) leg("t:" + deckKatKey(x.c), x);
  return [...DECK_KAT_ORDNUNG, ""]
    .filter(en => gruppen.has("t:" + en))
    .map(en => ({ key: "t:" + en, label: en ? typLabel(en) : t("type.other"),
                  items: gruppen.get("t:" + en) }));
}

/* Leiste über der Deck-Tabelle: Umschalter und Zugang zur Verwaltung. Sie
   sitzt dort und nicht in der Werkzeugleiste darüber, weil sie genau das
   steuert, was direkt darunter steht. */
function deckGruppeLeisteHtml(d) {
  const nachKat = deckGruppe.nachKat(d);
  const n = (d.kategorien || []).length;
  return `<div class="deck-gruppe-leiste">
    <span class="tool-label" style="margin:0">${esc(t("kat.groupBy"))}</span>
    <div class="gruppe-schalter" role="group">
      <button class="btn ghost sm${nachKat ? "" : " on"}" data-gruppe="typ" data-deck="${d.id}"
        title="${esc(t("kat.byTypeTitle"))}">${esc(t("kat.byType"))}</button>
      <button class="btn ghost sm${nachKat ? " on" : ""}" data-gruppe="kat" data-deck="${d.id}"
        title="${esc(t("kat.byOwnTitle"))}">${esc(t("kat.byOwn"))}${n ? ` <span class="gruppe-zahl">${n}</span>` : ""}</button>
    </div>
    <button class="btn ghost sm" data-katverw="${d.id}"
      title="${esc(t("kat.manageTitle"))}">&#127991; ${esc(t("kat.manage"))}</button>
  </div>`;
}

/* Die Kategorien einer Karte als Marken für die Tabellenzelle. Die primäre
   steht vorn und ist hervorgehoben, der Rest folgt in der Reihenfolge des
   Decks. Ohne Zuordnung bleibt ein stilles Pluszeichen — es lädt zum Einordnen
   ein, ohne wie ein Fehler auszusehen. */
function katZelleHtml(kategorien, zuord) {
  const liste = kategorien || [];
  const rang = new Map(liste.map((k, i) => [k.id, i]));
  const name = new Map(liste.map(k => [k.id, k.name]));
  const meine = (zuord || []).filter(z => name.has(z.id)).sort((a, b) =>
    (b.primaer - a.primaer) || (rang.get(a.id) - rang.get(b.id)));
  const inhalt = meine.length
    ? meine.map(z => `<span class="kat-chip${z.primaer ? " prim" : ""}">${esc(name.get(z.id))}</span>`).join("")
    : `<span class="kat-leer">&plus;</span>`;
  return `<button type="button" class="kat-knopf" data-kat title="${esc(
    meine.length ? t("kat.assignEdit") : t("kat.assignAdd"))}">${inhalt}</button>`;
}

/* Die Kategorien EINER Karte in EINEM Deck festlegen: mehrere erlaubt, genau
   eine davon primär.

   Wie in der Verwaltung wird auf einer Kopie gearbeitet und erst bei OK
   geschrieben — auch neu angelegte Kategorien entstehen erst dann. Abbrechen
   soll wirklich abbrechen, und ein halb angelegtes Fach wäre das Gegenteil. */
async function kategorienZuordnen(deckId, cardId) {
  const d = DECKS.find(x => x.id === deckId);
  if (!d) return;
  if (DECK_KAT_TABELLE_FEHLT) return toast(t("kat.needSchema"));
  const eintrag = (d.entries || []).find(en => en.cardId === cardId);
  const karte = CARDS.find(x => x.id === cardId);
  if (!eintrag || !karte) return;

  const alt = eintrag.kats || [];
  const gewaehlt = new Set(alt.map(z => z.id));
  let primaer = alt.find(z => z.primaer)?.id || null;
  // Im Dialog angelegte Kategorien, solange ohne ID. Der Schlüssel "neu:0"
  // steht bis zum Schreiben stellvertretend für sie.
  const neue = [];
  const zeilen = () => [
    ...(d.kategorien || []).map(k => ({ key: k.id, name: k.name })),
    ...neue.map((n, i) => ({ key: "neu:" + i, name: n })),
  ];

  const zeichne = () => {
    const box = $("#katz-liste");
    if (!box) return;
    const rs = zeilen();
    // Eine primäre gibt es nur, wenn überhaupt etwas angehakt ist — und sie
    // muss unter dem Angehakten sein. Sonst rutscht sie auf das erste.
    if (!gewaehlt.size) primaer = null;
    else if (!primaer || !gewaehlt.has(primaer)) primaer = rs.find(r => gewaehlt.has(r.key))?.key || null;
    box.innerHTML = rs.length ? rs.map(r => `
      <label class="katz-zeile${gewaehlt.has(r.key) ? " an" : ""}">
        <input type="checkbox" data-katz="${esc(r.key)}"${gewaehlt.has(r.key) ? " checked" : ""}>
        <span class="katz-name">${esc(r.name)}</span>
        <button type="button" class="katz-stern${primaer === r.key ? " on" : ""}"
          data-katprim="${esc(r.key)}" title="${esc(t("kat.primaryTitle"))}"
          ${gewaehlt.has(r.key) ? "" : "disabled"}>${primaer === r.key ? "&#9733;" : "&#9734;"}</button>
      </label>`).join("") : `<div class="empty">${esc(t("kat.empty"))}</div>`;

    box.querySelectorAll("[data-katz]").forEach(cb => cb.onchange = () => {
      cb.checked ? gewaehlt.add(cb.dataset.katz) : gewaehlt.delete(cb.dataset.katz);
      zeichne();
    });
    box.querySelectorAll("[data-katprim]").forEach(b => b.onclick = ev => {
      ev.preventDefault();                       // sonst schaltet das <label> das Häkchen um
      primaer = b.dataset.katprim;
      zeichne();
    });
  };

  $("#dlg-body").innerHTML = `
    <b>${esc(t("kat.assignTitle", { name: karte.disp }))}</b>
    <p class="hint" style="margin:8px 0 10px">${esc(t("kat.assignHint"))}</p>
    <div id="katz-liste" class="katz-liste"></div>
    <div class="row" style="margin-top:10px;align-items:flex-end">
      <div style="flex:1"><label>${esc(t("kat.addLabel"))}</label>
        <input type="text" id="katz-neu" maxlength="40" placeholder="${esc(t("kat.addPh"))}"></div>
      <div style="flex:none"><button class="btn ghost" id="katz-add">${esc(t("kat.add"))}</button></div>
    </div>`;
  zeichne();

  $("#katz-add").onclick = () => {
    const n = $("#katz-neu").value.trim();
    if (!n) return;
    const doppelt = zeilen().some(r => r.name.toLowerCase() === n.toLowerCase());
    if (doppelt) return toast(t("kat.dup", { name: n }));
    neue.push(n);
    gewaehlt.add("neu:" + (neue.length - 1));    // frisch angelegt heißt gemeint
    $("#katz-neu").value = "";
    zeichne();
    $("#katz-neu").focus();
  };
  $("#katz-neu").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#katz-add").click(); } };

  const dlg = $("#dlg");
  const ok = await new Promise(res => {
    const zu = v => { dlg.close(); res(v); };
    $("#dlg-yes").onclick = () => zu(true);
    $("#dlg-no").onclick  = () => zu(false);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
  if (!ok) return;

  // Angelegt wird auch, was am Ende nicht angehakt ist: Wer den Namen eintippt,
  // will das Fach — ob diese eine Karte hineingehört, ist eine zweite Frage.
  try {
    // Erst die neuen Kategorien anlegen, dann sind alle Schlüssel echte IDs.
    const echt = new Map();
    if (neue.length) {
      const start = (d.kategorien || []).length;
      const { data, error } = await sb.from("deck_categories")
        .insert(neue.map((n, i) => ({ deck_id: d.id, name: n, pos: start + i })))
        .select("id, name");
      if (error) throw error;
      neue.forEach((n, i) => {
        const treffer = data.find(x => x.name === n);
        if (treffer) echt.set("neu:" + i, treffer.id);
      });
    }
    const alsId = key => (key.startsWith("neu:") ? echt.get(key) : key);
    const soll = [...gewaehlt].map(alsId).filter(Boolean);
    const geschrieben = await katsSchreiben(d.id, cardId, soll, primaer ? alsId(primaer) : null);
    if (geschrieben || neue.length) await katsFertig(d.id, cardId);
  } catch (e) { toast(dbErr(e)); }
}

/* Die Kategorien EINER Karte auf einen SOLL-Stand bringen: Was fehlt, kommt
   dazu, was übrig ist, fällt weg, und genau eine trägt das Kennzeichen. Der
   gemeinsame Schreibweg von Dialog und Ablagefläche — zwei Wege zu derselben
   Datenbank, die auseinanderliefen, wären zwei Fehlerquellen.

   Rückgabe: ob überhaupt etwas geschrieben wurde. Wirft bei Fehlern; die
   Aufrufer melden. */
async function katsSchreiben(deckId, cardId, zielIds, primaerId) {
  const d = DECKS.find(x => x.id === deckId);
  if (!d) return false;
  const alt  = ((d.entries || []).find(en => en.cardId === cardId)?.kats) || [];
  const soll = [...new Set(zielIds.filter(Boolean))];
  // Die primäre muss unter dem Soll sein; sonst rutscht sie auf das erste Fach.
  const primNeu = soll.includes(primaerId) ? primaerId : (soll[0] || null);
  const primAlt = alt.find(z => z.primaer)?.id || null;
  const weg  = alt.filter(z => !soll.includes(z.id)).map(z => z.id);
  const dazu = soll.filter(id => !alt.some(z => z.id === id));
  if (!weg.length && !dazu.length && primNeu === primAlt) return false;

  if (weg.length) {
    const { error } = await sb.from("deck_entry_categories").delete()
      .eq("deck_id", deckId).eq("card_id", cardId).in("category_id", weg);
    if (error) throw error;
  }
  // Das alte Kennzeichen räumen, BEVOR ein neues gesetzt wird: Der Teilindex
  // lässt nur eine primäre je Karte zu, und zwei Anweisungen laufen
  // nacheinander, nicht gleichzeitig.
  if (primAlt && primAlt !== primNeu) {
    const { error } = await sb.from("deck_entry_categories").update({ is_primary: false })
      .eq("deck_id", deckId).eq("card_id", cardId).eq("category_id", primAlt);
    if (error) throw error;
  }
  if (dazu.length) {
    const { error } = await sb.from("deck_entry_categories")
      .insert(dazu.map(id => ({ deck_id: deckId, card_id: cardId, category_id: id, is_primary: false })));
    if (error) throw error;
  }
  if (primNeu && primNeu !== primAlt) {
    const { error } = await sb.from("deck_entry_categories").update({ is_primary: true })
      .eq("deck_id", deckId).eq("card_id", cardId).eq("category_id", primNeu);
    if (error) throw error;
  }
  return true;
}

/* Nachbereitung beider Wege: neu laden, zeichnen, auf die Zeile zeigen und den
   Stand melden — den NACH dem Neuladen, nicht die Absicht davor. Bei genau
   einem Fach ist sein Name die klarere Auskunft als die Zahl 1. */
async function katsFertig(deckId, cardId) {
  await reload(); renderDecks();
  zeigeDeckZeile(deckId, cardId);
  const d = DECKS.find(x => x.id === deckId);
  const jetzt = (d?.entries || []).find(en => en.cardId === cardId)?.kats || [];
  toast(jetzt.length === 0 ? t("kat.unassigned")
      : jetzt.length === 1
        ? t("kat.assigned", { name: (d.kategorien || []).find(k => k.id === jetzt[0].id)?.name || "" })
        : t("kat.assignedN", { n: jetzt.length }));
}

/* Nach dem Umsortieren auf die Zeile zeigen: In der Kategorie-Ansicht springt
   sie in eine andere Gruppe, und ohne diesen Hinweis sucht man sie dort. */
function zeigeDeckZeile(deckId, cardId) {
  const tr = $(`.deck-tbl tr[data-deck="${CSS.escape(deckId)}"][data-id="${CSS.escape(cardId)}"]`);
  if (!tr) return;                       // Gruppe zugeklappt oder Deck zu
  tr.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // Dieselbe Markierung wie beim Sprung aus dem Zieh-Import in die Sammlung —
  // eine zweite Art, "hier ist sie" zu sagen, bräuchte niemand.
  tr.classList.add("treffer");
  setTimeout(() => tr.classList.remove("treffer"), TREFFER_MS);
}

/* ---- Einordnen durch Ziehen ------------------------------------------
   Eine Kartenzeile anfassen, und die Fächer erscheinen als Flächen ÜBER der
   Oberfläche. Der Vorteil ist nicht bloß Schauwert: Ablageflächen, die
   schweben, brauchen im Layout keinen Platz — sie funktionieren bei jeder
   Auflösung gleich, in der Tabelle wie später in der Spaltenansicht, und
   ersparen das Einordnen Karte für Karte über einen Dialog.

   Der Zieh-IMPORT (Karten aus einem zweiten Fenster) kommt sich damit nicht in
   die Quere: Der merkt sich in `eigenerZug`, ob ein Zug innerhalb der App
   begann, und hält sich dann vollständig heraus — genau für diesen Fall gebaut.

   Auf Touch-Geräten gibt es kein HTML5-Ziehen. Dort bleibt der Weg über die
   Marken in der Zeile, der dieselbe Arbeit erledigt; deshalb wird er nicht
   ersetzt, sondern ergänzt. */
/* WARUM NICHT HTML5-ZIEHEN: Der erste Anlauf hing an draggable="true" samt
   dragstart/drop. Das ist die naheliegende Wahl und die falsche:

   • Auf Touch-Geräten gibt es es schlicht nicht — kein Finger löst je ein
     dragstart aus.
   • Safari behandelt ziehbare Tabellenzeilen eigenwillig.
   • Am Rechner konkurriert es mit der Textmarkierung: Wer auf einem Kartennamen
     drückt und zieht, markiert vielleicht nur Text.
   • Und vor allem: Man SIEHT einer Zeile nicht an, dass sie ziehbar ist.

   Zeigereignisse haben keines dieser Probleme. Sie sind für Maus, Finger und
   Stift dieselben, sie liefern die Bewegung selbst (kein Browser-Zugbild, das
   je nach Programm anders aussieht), und sie lassen sich an einem sichtbaren
   Griff aufhängen. Dass der Zieh-Import nicht mehr in die Quere kommen kann,
   ist ein Nebenertrag: Es feuert gar kein Zieh-Ereignis mehr. */

/* Erst ab dieser Strecke ist es ein Zug und kein Klick. Sechs Pixel sind genug,
   um ein Zittern der Hand nicht als Zug zu lesen, und wenig genug, dass der Zug
   sofort einsetzt, wenn er gemeint war. */
const ZIEH_SCHWELLE = 6;
let ziehKat = null;          // {deckId, cardId, vonKat} während eines Zuges
let ziehAnsatz = null;       // gedrückt, aber noch unter der Schwelle
let ziehGeist = null;        // das mitwandernde Schild am Zeiger

/* Anfassen — noch kein Zug. Erst die Bewegung entscheidet, ob daraus einer
   wird; sonst wäre jeder Klick auf eine Zeile einer. */
function katZiehAnfassen(e, tr, deckId, cardId) {
  if (e.button != null && e.button !== 0) return;      // nur die Haupttaste
  if (DECK_KAT_TABELLE_FEHLT) return;
  if (e.target?.closest?.("input, button, select, textarea, a")) return;
  ziehAnsatz = { x: e.clientX, y: e.clientY, tr, deckId, cardId,
                 vonKat: tr.dataset.vonkat || null, id: e.pointerId };
}

function katZiehBewegt(e) {
  if (ziehAnsatz && !ziehKat) {
    if (Math.hypot(e.clientX - ziehAnsatz.x, e.clientY - ziehAnsatz.y) < ZIEH_SCHWELLE) return;
    const a = ziehAnsatz;
    ziehKat = { deckId: a.deckId, cardId: a.cardId, vonKat: a.vonKat };
    // Der Zeiger gehört ab jetzt der Zeile: Auch wenn er über andere Elemente
    // fährt, kommen ihre Ereignisse weiter hier an — ohne das reißt der Zug ab,
    // sobald man die Tabelle verlässt.
    try { a.tr.setPointerCapture(a.id); } catch { /* Zeiger schon weg */ }
    a.tr.classList.add("zieht");
    document.body.classList.add("zieht-gerade");   // nichts markieren während des Zuges
    hideHover();                     // die Vorschau schwebt höher als die Flächen
    katGeistAn(a.cardId);
    katDropAn(a.deckId, a.cardId);
  }
  if (!ziehKat) return;
  e.preventDefault();                // kein Textmarkieren, kein Wegrollen
  katGeistBewegen(e.clientX, e.clientY);
  katZielHervorheben(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
}

/* Loslassen. Was unter dem Zeiger liegt, entscheidet — nicht, wo der Zug begann.
   elementFromPoint statt eines Ablage-Ereignisses: Das Schild am Zeiger ist für
   Zeigeereignisse durchlässig, also trifft die Prüfung die Fläche darunter. */
function katZiehLos(e) {
  const zug = ziehKat;
  const ansatz = ziehAnsatz;
  ziehAnsatz = null;
  if (!zug) return;                                   // war doch nur ein Klick
  const feld = katFeldUnter(e.clientX, e.clientY);
  katZiehAus();
  // Ein Klick, der aus einem Zug entstand, darf die Detailansicht nicht öffnen.
  katKlickSchlucken();
  try { ansatz?.tr.releasePointerCapture(ansatz.id); } catch { /* egal */ }
  if (feld) katAbgelegt(zug, feld.dataset.katdrop, e.ctrlKey || e.metaKey);
}

function katZiehAus() {
  ziehKat = null;
  ziehAnsatz = null;
  document.body.classList.remove("zieht-gerade");
  $$("tr.zieht").forEach(tr => tr.classList.remove("zieht"));
  katGeistAus();
  katDropAus();
}

function katFeldUnter(x, y) {
  return document.elementFromPoint(x, y)?.closest?.("[data-katdrop]") || null;
}

function katZielHervorheben(x, y, zusatz) {
  const feld = katFeldUnter(x, y);
  $$("#kat-drop .katdrop-feld").forEach(f => f.classList.toggle("ueber", f === feld));
  const box = $("#kat-drop");
  if (!box) return;
  box.classList.toggle("zusatz", !!zusatz);
  // Der Hinweis wechselt mit der Taste, damit man VOR dem Loslassen sieht, was
  // passieren wird — und nicht erst danach.
  const fuss = $("#katdrop-fuss");
  if (fuss) fuss.textContent = t(zusatz ? "katdrop.hintAdd" : "katdrop.hint");
}

/* Das Schild am Zeiger: das Kartenbild, sonst nichts. Der Name steht schon in
   der Überschrift über den Flächen — ihn hier zu wiederholen kostete Breite und
   verdeckte damit gerade das, worauf man zielt. Fehlt das Bild (Scryfall führt
   nicht zu jeder Auflage eines), springt der Name ein: ein leeres Schild wäre
   schlechter als ein wortreiches. */
function katGeistAn(cardId) {
  const c = CARDS.find(x => x.id === cardId);
  katGeistAus();
  ziehGeist = document.createElement("div");
  ziehGeist.className = "zieh-geist" + (c?.img ? " bild" : "");
  if (c?.img) ziehGeist.innerHTML = `<img src="${esc(c.img)}" alt="">`;
  else ziehGeist.textContent = c?.disp || "";
  document.body.appendChild(ziehGeist);
}
function katGeistBewegen(x, y) {
  if (ziehGeist) { ziehGeist.style.left = x + "px"; ziehGeist.style.top = y + "px"; }
}
function katGeistAus() { ziehGeist?.remove(); ziehGeist = null; }

/* Den einen Klick abfangen, der dem Loslassen folgt. Ohne das öffnete jeder
   Zug, der auf dem Kartenbild begann, hinterher die Detailansicht. */
function katKlickSchlucken() {
  const h = ev => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener("click", h, true);
  setTimeout(() => document.removeEventListener("click", h, true), 0);
}

/* Abbruch mit Escape — und mit dem Zeiger, den das System uns wegnimmt
   (Anruf, Fensterwechsel). Einmal für die ganze Sitzung verdrahtet. */
addEventListener("keydown", e => { if (e.key === "Escape" && ziehKat) katZiehAus(); });
addEventListener("pointercancel", () => { if (ziehKat) katZiehAus(); });

/* Die Ablagefläche entsteht einmal und bleibt danach im Baum — sie wird nur
   neu gefüllt. Ein bei jedem Zug neu gebautes Element verlöre den Zug in dem
   Moment, in dem es eingehängt wird. */
function katDropBox() {
  let el = $("#kat-drop");
  if (el) return el;
  el = document.createElement("div");
  el.id = "kat-drop";
  el.hidden = true;
  el.innerHTML = `<div class="katdrop-innen">
      <div class="katdrop-kopf" id="katdrop-kopf"></div>
      <div class="katdrop-felder" id="katdrop-felder"></div>
      <div class="katdrop-fuss" id="katdrop-fuss"></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function katDropAus() {
  ziehKat = null;
  const el = $("#kat-drop");
  if (el) { el.hidden = true; el.classList.remove("zusatz"); }
}

/* Die Flächen aufbauen und einblenden. Schon belegte Fächer sind erkennbar —
   sonst zöge man eine Karte dorthin, wo sie längst liegt. */
function katDropAn(deckId, cardId) {
  const d = DECKS.find(x => x.id === deckId);
  const karte = CARDS.find(x => x.id === cardId);
  if (!d || !karte) return;
  const drin = new Set((((d.entries || []).find(en => en.cardId === cardId)?.kats) || []).map(z => z.id));
  const box = katDropBox();
  $("#katdrop-kopf").textContent = t("katdrop.title", { name: karte.disp });
  $("#katdrop-felder").innerHTML = [
    ...(d.kategorien || []).map(k =>
      `<button type="button" class="katdrop-feld${drin.has(k.id) ? " drin" : ""}" data-katdrop="${esc(k.id)}">
         <span class="katdrop-name">${esc(k.name)}</span>
         ${drin.has(k.id) ? `<span class="katdrop-marke">${esc(t("katdrop.already"))}</span>` : ""}
       </button>`),
    `<button type="button" class="katdrop-feld leer" data-katdrop="">
       <span class="katdrop-name">${esc(t("kat.none"))}</span></button>`,
    `<button type="button" class="katdrop-feld neu" data-katdrop="+">
       <span class="katdrop-name">&plus; ${esc(t("kat.addLabel"))}</span></button>`,
  ].join("");
  $("#katdrop-fuss").textContent = t("katdrop.hint");
  box.hidden = false;
  // Die Flächen brauchen keine eigenen Ereignisse: Welche gemeint ist, ergibt
  // sich beim Loslassen aus der Zeigerposition (katFeldUnter). Ein Zug, der
  // unterwegs "verloren" geht, weil ein Element dazwischenkommt, kann es so
  // nicht geben.
}

/* Was ein Ablegen bedeutet — eine Regel, in einem Satz erklärbar:

   • Loslassen ordnet in das Fach ein und nimmt die Karte aus dem Fach heraus,
     aus dem sie GEZOGEN wurde. Kam sie aus keinem (Typ-Ansicht oder "Ohne
     Kategorie"), kommt das Ziel schlicht hinzu.
   • Mit Strg (bzw. Cmd) kommt es immer nur hinzu, es fällt nichts weg.
   • Auf "Ohne Kategorie" abgelegt, fallen alle Zuordnungen weg.

   Das Kennzeichen "primär" wandert mit: Es geht ans Ziel, wenn die Karte noch
   keines hatte oder wenn ausgerechnet das ersetzte Fach es trug. Sonst bleibt
   es, wo es war.

   Eigene Funktion ohne Netz und ohne DOM, weil hier die ganze Bedeutung des
   Zuges steckt — der Rest ist Schreiben und Zeichnen. */
function katDropSoll(alt, vonKat, zielId, zusatz) {
  const altIds = (alt || []).map(z => z.id);
  const primAlt = (alt || []).find(z => z.primaer)?.id || null;
  if (!zielId) return { soll: [], prim: null };                 // "Ohne Kategorie"
  if (zusatz)  return { soll: [...altIds, zielId], prim: primAlt || zielId };
  return {
    soll: altIds.filter(id => id !== vonKat).concat(zielId),
    prim: (!primAlt || primAlt === vonKat) ? zielId : primAlt,
  };
}

async function katAbgelegt(zug, ziel, zusatz) {
  const { deckId, cardId, vonKat } = zug;
  const d = DECKS.find(x => x.id === deckId);
  if (!d) return;
  if (DECK_KAT_TABELLE_FEHLT) return toast(t("kat.needSchema"));
  const alt = ((d.entries || []).find(en => en.cardId === cardId)?.kats) || [];

  try {
    let zielId = ziel;
    if (ziel === "+") {
      const name = await katNameFragen();
      if (!name) return;
      const { data, error } = await sb.from("deck_categories")
        .insert({ deck_id: deckId, name, pos: (d.kategorien || []).length })
        .select("id").single();
      if (error) throw error;
      zielId = data.id;
    }
    const { soll, prim } = katDropSoll(alt, vonKat, zielId, zusatz);
    const geschrieben = await katsSchreiben(deckId, cardId, soll, prim);
    if (geschrieben || ziel === "+") await katsFertig(deckId, cardId);
  } catch (e) { toast(dbErr(e)); }
}

/* Nach einem Namen fragen — für die Fläche "Neue Kategorie". Eigener Dialog
   statt window.prompt: der sieht auf jedem Browser anders aus, lässt sich nicht
   übersetzen und wird auf manchen Geräten unterdrückt. */
async function katNameFragen() {
  const ok = await confirmDlg(`
    <b>${esc(t("kat.addLabel"))}</b>
    <div style="margin-top:10px">
      <input type="text" id="kat-neu-name" maxlength="40"
        placeholder="${esc(t("kat.addPh"))}" autofocus>
    </div>`);
  if (!ok) return null;
  return $("#kat-neu-name")?.value.trim() || null;
}

/* Verwaltung der Kategorien eines Decks: anlegen, umbenennen, umsortieren,
   löschen — und die Liste eines anderen Decks übernehmen.

   Gearbeitet wird auf einer KOPIE, geschrieben erst bei OK. Zwischenschritte
   ("Ramp" anlegen, gleich wieder umbenennen) sollen keine Spuren hinterlassen,
   und Abbrechen soll wirklich abbrechen. Die Datenbank sieht am Ende nur die
   Unterschiede: gelöscht, umbenannt, verschoben, neu. */
async function kategorienVerwalten(deckId) {
  const d = DECKS.find(x => x.id === deckId);
  if (!d) return;
  if (DECK_KAT_TABELLE_FEHLT) return toast(t("kat.needSchema"));

  const alt = d.kategorien || [];
  let arbeit = alt.map(k => ({ id: k.id, name: k.name }));
  // Decks, aus denen sich etwas übernehmen lässt — leere braucht die Auswahl
  // nicht anzubieten.
  const quellen = DECKS.filter(x => x.id !== d.id && (x.kategorien || []).length);

  const zeichne = () => {
    const liste = $("#kat-liste");
    if (!liste) return;
    liste.innerHTML = arbeit.length ? arbeit.map((a, i) => `
      <div class="kat-zeile">
        <button class="btn ghost sm" data-kup="${i}" title="${esc(t("kat.up"))}" ${i === 0 ? "disabled" : ""}>&#9650;</button>
        <button class="btn ghost sm" data-kdown="${i}" title="${esc(t("kat.down"))}" ${i === arbeit.length - 1 ? "disabled" : ""}>&#9660;</button>
        <input type="text" data-kname="${i}" maxlength="40" value="${esc(a.name)}">
        <span class="kat-zahl">${(d.entries || [])
          .filter(e => a.id && (e.kats || []).some(z => z.id === a.id))
          .reduce((s, e) => s + e.qty, 0)}</span>
        <button class="btn danger sm" data-kdel="${i}" title="${esc(t("kat.del"))}">&times;</button>
      </div>`).join("") : `<div class="empty">${esc(t("kat.empty"))}</div>`;

    liste.querySelectorAll("[data-kname]").forEach(inp => inp.oninput = () => {
      arbeit[+inp.dataset.kname].name = inp.value;
    });
    liste.querySelectorAll("[data-kdel]").forEach(b => b.onclick = () => {
      arbeit.splice(+b.dataset.kdel, 1); zeichne();
    });
    const tausch = (i, j) => { [arbeit[i], arbeit[j]] = [arbeit[j], arbeit[i]]; zeichne(); };
    liste.querySelectorAll("[data-kup]").forEach(b => b.onclick = () => tausch(+b.dataset.kup, +b.dataset.kup - 1));
    liste.querySelectorAll("[data-kdown]").forEach(b => b.onclick = () => tausch(+b.dataset.kdown, +b.dataset.kdown + 1));
  };

  // Namen sind je Deck eindeutig (die Datenbank erzwingt es). Hier wird
  // dasselbe schon vor dem Schreiben geprüft, damit die Meldung sagt, WAS
  // doppelt ist, statt einen Fehlercode zu zeigen. Groß-/Kleinschreibung
  // zählt dabei nicht: "Ramp" und "ramp" nebeneinander wären ein Versehen.
  const schonDa = name => arbeit.some(a => a.name.trim().toLowerCase() === name.toLowerCase());
  const anhaengen = name => {
    const n = name.trim();
    if (!n) return false;
    if (schonDa(n)) { toast(t("kat.dup", { name: n })); return false; }
    arbeit.push({ id: null, name: n });
    return true;
  };

  $("#dlg-body").innerHTML = `
    <b>${esc(t("kat.dlgTitle", { deck: d.name }))}</b>
    <p class="hint" style="margin:8px 0 10px">${esc(t("kat.dlgHint"))}</p>
    <div id="kat-liste" class="kat-liste"></div>
    <div class="row" style="margin-top:10px;align-items:flex-end">
      <div style="flex:1"><label>${esc(t("kat.addLabel"))}</label>
        <input type="text" id="kat-neu" maxlength="40" placeholder="${esc(t("kat.addPh"))}"></div>
      <div style="flex:none"><button class="btn ghost" id="kat-add">${esc(t("kat.add"))}</button></div>
    </div>
    ${quellen.length ? `<div class="row" style="margin-top:10px;align-items:flex-end">
      <div style="flex:1"><label>${esc(t("kat.copyLabel"))}</label>
        <select id="kat-quelle">${quellen.map(x =>
          `<option value="${esc(x.id)}">${esc(x.name)} (${x.kategorien.length})</option>`).join("")}</select></div>
      <div style="flex:none"><button class="btn ghost" id="kat-copy">${esc(t("kat.copyBtn"))}</button></div>
    </div>` : ""}`;
  zeichne();

  $("#kat-add").onclick = () => {
    if (anhaengen($("#kat-neu").value)) { $("#kat-neu").value = ""; zeichne(); }
    $("#kat-neu").focus();
  };
  // Enter im Feld soll hinzufügen, nicht den Dialog bestätigen.
  $("#kat-neu").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#kat-add").click(); } };
  const copyBtn = $("#kat-copy");
  if (copyBtn) copyBtn.onclick = () => {
    const q = DECKS.find(x => x.id === $("#kat-quelle").value);
    if (!q) return;
    // Was es hier schon gibt, wird übersprungen statt gemeldet — beim
    // Übernehmen einer ganzen Liste ist eine Dublette kein Fehler, sondern
    // genau das, was man ohnehin nicht doppelt haben will.
    const vorher = arbeit.length;
    q.kategorien.forEach(k => { if (!schonDa(k.name)) arbeit.push({ id: null, name: k.name }); });
    zeichne();
    toast(t("kat.copied", { n: arbeit.length - vorher }));
  };

  const dlg = $("#dlg");
  const ok = await new Promise(res => {
    const zu = v => { dlg.close(); res(v); };
    $("#dlg-yes").onclick = () => zu(true);
    $("#dlg-no").onclick  = () => zu(false);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
  if (!ok) return;

  // Leergeräumte Namen sind kein Löschbefehl — dafür ist das ×. Sie fielen
  // sonst still weg, samt der Zuordnungen darunter.
  arbeit = arbeit.filter(a => a.name.trim());
  const namen = arbeit.map(a => a.name.trim().toLowerCase());
  if (new Set(namen).size !== namen.length) return toast(t("kat.dupSave"));

  const weg = alt.filter(k => !arbeit.some(a => a.id === k.id)).map(k => k.id);
  const geaendert = arbeit
    .map((a, i) => ({ a, i, k: alt.find(x => x.id === a.id) }))
    .filter(({ a, i, k }) => k && (k.name !== a.name.trim() || k.pos !== i));
  const neu = arbeit.map((a, i) => ({ a, i })).filter(({ a }) => !a.id)
    .map(({ a, i }) => ({ deck_id: d.id, name: a.name.trim(), pos: i }));
  if (!weg.length && !geaendert.length && !neu.length) return;

  try {
    // Reihenfolge der drei Schritte ist gleichgültig: sie fassen getrennte
    // Zeilen an. Gelöscht wird zuerst, damit ein frei gewordener Name im
    // selben Zug neu vergeben werden kann (unique (deck_id, name)).
    if (weg.length) {
      const { error } = await sb.from("deck_categories").delete().in("id", weg);
      if (error) throw error;
    }
    for (const { a, i } of geaendert) {
      const { error } = await sb.from("deck_categories")
        .update({ name: a.name.trim(), pos: i }).eq("id", a.id);
      if (error) throw error;
    }
    if (neu.length) {
      const { error } = await sb.from("deck_categories").insert(neu);
      if (error) throw error;
    }
    await reload(); renderDecks();
    toast(t("kat.saved"));
  } catch (e) { toast(dbErr(e)); }
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
    // Deck-Karten in aufklappbare Gruppen (die Tabellen-Sortierung bleibt je
    // Gruppe erhalten). Jede Gruppe ist ein eigener <tbody> mit anklickbarer
    // Kopfzeile. Wonach gruppiert wird — Kartentyp oder eigene Kategorien —
    // entscheidet deckGruppen(). `rows` = Kartenzahl, steuert nur die
    // Sichtbarkeit von Knöpfen/Tabelle (0 = leeres Deck).
    const rows = eintraege.length;
    // Erster Commander als Kartenobjekt: Grundlage der Partner-Prüfung je Zeile.
    const mainCard = d.main_card_id ? CARDS.find(x => x.id === d.main_card_id) : null;
    const deckKoerper = deckGruppen(d, eintraege).map(g => {
      const items = g.items;
      const anz = items.reduce((s, x) => s + x.e.qty, 0);
      const zu = deckCatZu.has(`${d.id}|${g.key}`);
      // Beide Commander (erster + Partner) stehen immer oben in ihrer Kategorie,
      // unabhängig von der gewählten Sortierung. Stabiler Sort: erst der erste
      // Commander, dann der zweite, dann der Rest in bisheriger Reihenfolge.
      const rang = x => x.c.id === d.main_card_id ? 0 : x.c.id === d.second_card_id ? 1 : 2;
      const geordnet = (d.main_card_id || d.second_card_id)
        ? [...items].sort((a, b) => rang(a) - rang(b))
        : items;
      const catRows = geordnet.map(({ e, c }) => cardRow(c, {
        deckId: d.id, qty: e.qty,
        // Eigene Kategorien des Decks samt aktueller Zuordnung: daraus baut die
        // Zeile ihr Auswahlfeld. Leere Liste = das Feld bietet nur "—" und
        // "Neu…" an, was zugleich der Einstieg ohne Umweg über die Verwaltung ist.
        kategorien: d.kategorien || [], kats: e.kats || [],
        // Aus welchem Fach diese Zeile gerade stammt — Grundlage dafür, dass
        // ein Ablegen VERSCHIEBT statt nur hinzuzufügen. In der Typ-Ansicht
        // und in der Restgruppe gibt es keins.
        vonKat: g.key.startsWith("k:") ? (g.key.slice(2) || null) : null,
        istHaupt: d.main_card_id === c.id,
        istZweit: d.second_card_id === c.id,
        // Partner-Stern anbieten, wenn ein erster Commander steht, diese Karte
        // ein tauglicher zweiter Commander ist und die Partner-Fähigkeiten passen.
        partnerOk: !!mainCard && c.id !== mainCard.id && d.second_card_id !== c.id &&
                   istZweitCommanderFaehig(c) && sindPartner(mainCard, c),
      })).join("");
      return `<tbody class="deck-cat-body${zu ? " zu" : ""}">`
        + `<tr class="deck-cat-head" data-cattoggle="${d.id}|${g.key}"><td colspan="99">`
        + `<span class="deck-cat-arrow">${zu ? "&#9654;" : "&#9660;"}</span>`
        + `<span class="deck-cat-name">${esc(g.label)}</span>`
        + `<span class="deck-cat-count">${anz}</span></td></tr>${catRows}</tbody>`;
    }).join("");

    const n = eintraege.reduce((s, x) => s + x.e.qty, 0);
    const v = eintraege.reduce((s, x) => s + (x.c.price || 0) * x.e.qty, 0);
    const fehlt = eintraege.filter(x => x.e.qty > bestandVon(x.c)).length;
    const offen = deckOffen.ist(d.id);
    const dashOffen = deckDashOffen.has(d.id);
    if (dashOffen) deckDashRows.set(d.id, eintraege.map(({ e, c }) => ({ ...c, qty: e.qty })));
    const haupt = mainCard;
    const zweit = d.second_card_id ? CARDS.find(c => c.id === d.second_card_id) : null;

    return `<div class="card">
      <div class="deck-kopf" data-toggle="${d.id}" title="${offen ? t("common.collapse") : t("common.expand")}">
        <span class="deck-pfeil">${offen ? "&#9660;" : "&#9654;"}</span>
        ${(haupt?.img || zweit?.img)
          ? `<span class="deck-cmds">${haupt?.img ? deckHauptImg(haupt) : ""}${zweit?.img ? deckHauptImg(zweit) : ""}</span>`
          : ""}
        <div style="flex:1;min-width:0">
          <h3 style="margin:0">${esc(d.name)}</h3>
          <div class="deck-tags">${
            d.format ? `<span class="pill fmt">${esc(d.format)}</span>` : ""}${
            d.archetype ? `<span class="pill">${esc(d.archetype)}</span>` : ""
          }<span class="deck-legal-wrap" data-legalpill="${d.id}">${deckLegalPillInner(DECK_LEGAL.get(d.id))}</span></div>
          <div class="hint" style="margin:2px 0 0">${n} ${esc(t("common.cards"))} &middot; ${eur(v)}${
            istCommanderDeck(d) && deckFrei(d) === 0
              ? ` &middot; <span class="deck-full-note">${esc(t("deck.fullShort", { n, max: DECK_MAX }))}</span>` : ""}${
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
        ${rows ? `${deckGruppeLeisteHtml(d)}
                  <div class="xscroll" style="overflow-x:auto"><table class="deck-tbl">
                    <thead>${cardHead("deck")}</thead>${deckKoerper}</table></div>`
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

  // Umschalter der Gruppierung. Neu gezeichnet wird das ganze Deck-Panel —
  // die Tabelle wird ja umgebaut. Ein Klick auf die schon gewählte Ordnung
  // schreibt sie trotzdem fest: dann steht sie fortan gegen die
  // Voreinstellung, was genau die Absicht ist, wenn jemand sie anklickt.
  $$("#deck-list [data-gruppe]").forEach(b => b.onclick = () => {
    deckGruppe.setze(b.dataset.deck, b.dataset.gruppe);
    renderDecks();
  });
  $$("#deck-list [data-katverw]").forEach(b => b.onclick = () => kategorienVerwalten(b.dataset.katverw));

  // Gruppen im Deck auf-/zuklappen: nur die Kartenzeilen dieses <tbody>
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
    const pick = CARDS.find(x => x.id === cardId);

    // Wunschkarte einlösen: Steht dieselbe Karte schon als fehlender Eintrag im
    // Deck, nur in einer anderen Auflage, dann will man sie nicht ZUSÄTZLICH
    // einplanen — man hat sie inzwischen gekauft und der Wunsch ist erfüllt. Der
    // Eintrag wird umgehängt, das Deck bleibt gleich groß. Muss VOR der
    // Voll-Prüfung stehen: gerade im vollen Deck ist das der einzige Weg, eine
    // Wunschkarte noch zu ersetzen.
    const wunsch = deckWunschEintrag(d, pick);
    if (wunsch) {
      const n = Math.min(add, wunsch.eintrag.qty);
      btn.disabled = true;
      try {
        const { error } = await sb.rpc("fulfil_wish_in_deck", {
          p_deck: deckId, p_from_card: wunsch.karte.id, p_to_card: cardId, p_n: n,
        });
        if (error) throw error;
        // Der Abgleich räumt die zurückbleibende Wunschzeile weg (sie hat jetzt
        // weder Bestand noch Deckplatz) und hängt sie, liegt sie noch in
        // weiteren Decks, auch dort um. Ohne ihn stünde sie weiter auf der
        // Wunschliste, obwohl die Karte längst im Regal liegt.
        await reloadMitWunschAbgleich(); renderAll();
        toast(t("deck.wishFilled", { name: pick.disp || pick.name, n }));
      } catch (e) { toast(dbErr(e)); btn.disabled = false; }
      return;
    }

    // Singleton: Im Commander-Deck ist jede Karte nur einmal erlaubt (Ausnahmen
    // stehen im Regeltext der Karte). Das gilt unabhängig davon, ob noch Platz
    // ist — und es ist die richtige Auskunft, wo vorher pauschal „Deck voll"
    // stand: der Platz ist nicht weg, sondern an genau diese Karte vergeben.
    // Fehlt sie einem noch, führt der Weg über die Sammlung, nicht übers Deck.
    if (pick && add > singletonFrei(d, pick)) {
      const name = pick.disp || pick.name;
      toast(ex && ex.qty > bestandVon(pick)
        ? t("deck.alreadyInWish", { name })
        : t("deck.singleton", { name, max: commanderMaxKopien(pick), n: deckKopien(d, pick) }));
      return;
    }

    // Commander-Grenze: lieber hier erklären als den Trigger absagen lassen.
    const frei = deckFrei(d);
    if (add > frei) { deckVollMelden(d); return; }

    // Kontingent: eine besessene Karte, deren Exemplare bereits alle in ANDEREN
    // Decks stecken, lässt sich nicht zusätzlich hier einbauen — außer sie ist in
    // diesem Deck schon drin (dann ist es ein Erhöhen, das als Wunsch/„fehlt"
    // gilt und erlaubt bleibt). Nur besessene Karten (Bestand ≥ 1) sind betroffen;
    // reine Wunschkarten (Bestand 0) dürfen in beliebig viele Decks.
    const c = CARDS.find(x => x.id === cardId);
    if (c) {
      const owned = bestandVon(c);
      const vork = deckVorkommen(c);
      const inDiesem = vork.filter(x => x.id === deckId).reduce((s, x) => s + x.qty, 0);
      const andere = vork.filter(x => x.id !== deckId);
      const belegtAnderswo = andere.reduce((s, x) => s + x.qty, 0);
      if (owned >= 1 && inDiesem === 0 && belegtAnderswo >= owned) {
        toast(t("deck.allocFull", { n: owned, decks: andere.map(x => x.name).join(", ") }));
        return;
      }
    }

    btn.disabled = true;
    try {
      const { error } = await sb.from("deck_entries")
        .upsert({ deck_id: deckId, card_id: cardId, qty: (ex?.qty || 0) + add },
                { onConflict: "deck_id,card_id" });
      if (error) throw error;
      await reload(); renderAll();
    } catch (e) {
      // Der Trigger ist die letzte Instanz — etwa wenn ein zweites Gerät
      // parallel Karten hinzugefügt hat, seit diese Ansicht gezeichnet wurde.
      if (istDeckVollFehler(e)) { await reload(); renderAll(); deckVollMelden(DECKS.find(x => x.id === deckId)); }
      else if (istSingletonFehler(e)) {
        await reload(); renderAll();
        const dd = DECKS.find(x => x.id === deckId);
        toast(t("deck.singleton", { name: pick?.disp || pick?.name || "",
          max: pick ? commanderMaxKopien(pick) : 1, n: pick ? deckKopien(dd, pick) : 0 }));
      }
      else { toast(dbErr(e)); btn.disabled = false; }
    }
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

// Eine Cardmarket-Wants-Liste fasst höchstens 150 Karten; man kann aber beliebig
// viele Listen anlegen. Längere Listen zerlegen wir daher in 150er-Teile, die
// nacheinander (je Teil eine neue Wants-Liste) eingefügt werden.
const CM_WANTS_MAX = 150;
function kaufChunks(items) {
  const out = [];
  for (let i = 0; i < items.length; i += CM_WANTS_MAX) out.push(items.slice(i, i + CM_WANTS_MAX));
  return out;
}
const KAUF_CHUNK_DONE = new Set();   // welche Teile im offenen Dialog schon kopiert sind

let KAUF_DECK_ID = null;   // Deck, dessen Fehlliste der Kauf-Dialog gerade zeigt
let KAUF_WUNSCH = false;   // statt eines Decks: die ganze Wunschliste

function oeffneKauf(deckId) {
  KAUF_WUNSCH = false;
  KAUF_DECK_ID = deckId;
  KAUF_CHUNK_DONE.clear();
  renderKauf();
  $("#buy-dlg").showModal();
}
/* Derselbe Dialog über der ganzen Wunschliste statt über einem Deck: der
   Einkaufszettel ist derselbe, nur die Quelle ist eine andere. */
function oeffneKaufWunschliste() {
  KAUF_WUNSCH = true;
  KAUF_DECK_ID = null;
  KAUF_CHUNK_DONE.clear();
  renderKauf();
  $("#buy-dlg").showModal();
}
function kaufDeck() { return DECKS.find(d => d.id === KAUF_DECK_ID) || null; }

/* Was der Dialog gerade zeigt, in der Form { c, fehlt } — damit Liste,
   Wants-Text und Datei nichts davon wissen müssen, woher die Posten kommen. */
function kaufPosten() {
  if (KAUF_WUNSCH) return LISTE.wish.karten().map(c => ({ c, fehlt: wunschAnzahl(c) }));
  const d = kaufDeck();
  return d ? fehlendeKarten(d) : [];
}

function renderKauf() {
  const body = $("#buy-body");
  if (!body) return;
  const d = kaufDeck();
  const items = kaufPosten();
  const titel = KAUF_WUNSCH ? t("nav.wishlist") : t("buy.title");
  const head = `<h3 style="margin:0 0 6px">${esc(titel)}${d ? " – " + esc(d.name) : ""}</h3>`;
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
  // Cardmarket nimmt höchstens 150 Karten je Wants-Liste. Bis 150: ein Knopf, der
  // alles kopiert und die Wants-Seite öffnet. Darüber: je 150er-Teil ein Knopf,
  // der nur diesen Teil kopiert (auf Cardmarket je Teil eine neue Wants-Liste).
  const chunks = kaufChunks(items);
  const cmBtn = (id, tag, label, extra = "") =>
    `<${tag} class="btn cm-btn" id="${id}"${extra}><span class="cm-btn-logo">${CM_LOGO}</span><span>${esc(label)}</span></${tag}>`;
  let actions;
  if (chunks.length <= 1) {
    actions = `
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
      <div style="flex:none">${cmBtn("buy-go", "button", t("wish.buyBtn"))}</div>
      <div style="flex:none"><button class="btn ghost" id="buy-txt">${esc(t("buy.txt"))}</button></div>
    </div>
    <p class="hint" style="margin-top:8px">${esc(t("buy.hint"))}</p>`;
  } else {
    const grid = chunks.map((ch, i) => {
      const done = KAUF_CHUNK_DONE.has(i);
      return `<button class="btn ghost sm chunk-btn${done ? " done" : ""}" data-chunk="${i}">${
        esc(t("buy.chunkBtn", { i: i + 1, m: chunks.length, n: ch.length }))}${done ? " ✓" : ""}</button>`;
    }).join("");
    actions = `
    <p class="hint" style="margin:12px 0 6px">${esc(t("buy.chunkInfo", { n: items.length, m: chunks.length, max: CM_WANTS_MAX }))}</p>
    <div class="chunk-grid">${grid}</div>
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
      <div style="flex:none">${cmBtn("buy-open-cm", "a", t("buy.openWants"), ` href="${esc(cmWantsUrl())}" target="_blank" rel="noopener noreferrer"`)}</div>
      <div style="flex:none"><button class="btn ghost" id="buy-txt">${esc(t("buy.txt"))}</button></div>
    </div>
    <p class="hint" style="margin-top:8px">${esc(t("buy.chunkHint"))}</p>`;
  }
  body.innerHTML = head + sub + `<div class="sell-liste">${liste}</div>` + actions;
  const tx = $("#buy-txt"); if (tx) tx.onclick = kaufTxt;
  if (chunks.length <= 1) {
    const go = $("#buy-go"); if (go) go.onclick = kaufKopierenUndOeffnen;
  } else {
    $$("#buy-body .chunk-btn").forEach(b => b.onclick = async () => {
      const i = +b.dataset.chunk;
      try { await navigator.clipboard.writeText(kaufWantlist(chunks[i])); }
      catch { toast(t("buy.copyFail")); return; }
      KAUF_CHUNK_DONE.add(i);
      b.classList.add("done");
      b.textContent = t("buy.chunkBtn", { i: i + 1, m: chunks.length, n: chunks[i].length }) + " ✓";
      toast(t("buy.chunkCopied", { i: i + 1, m: chunks.length }));
    });
  }
}

async function kaufKopierenUndOeffnen() {
  const items = kaufPosten();
  if (!items.length) return;
  try { await navigator.clipboard.writeText(kaufWantlist(items)); toast(t("buy.copied")); }
  catch { toast(t("buy.copyFail")); }
  // Auch bei Clipboard-Fehler öffnen — die Liste steht ja im Dialog.
  window.open(cmWantsUrl(), "_blank", "noopener");
}
function kaufTxt() {
  const items = kaufPosten();
  if (!items.length) return;
  const nm = KAUF_WUNSCH ? "wishlist"
    : (kaufDeck()?.name || "deck").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "deck";
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
        // Aus einer alten Sicherung — Schreibweise des Setcodes unbekannt, deshalb
        // hier vereinheitlichen statt sie in die Datenbank durchzureichen.
        p_set_code: (c.set || c.set_code || "").toUpperCase() || null,
        p_set_name: c.set_name, p_cn: c.cn, p_img: c.img,
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
  // Auch der Import ist ein Zugang: was hier ankommt, kann längst gewünscht
  // gewesen sein. Die eigene Meldung des Imports bleibt stehen — im Stapel
  // interessiert die Summe, den Rest zeigen Wunschliste und Deck.
  const erfuellt = await reloadMitWunschAbgleich();
  renderAll();
  toast((bad ? t("toast.importedCardsSome", { ok, bad }) : t("toast.importedCards", { ok })) +
        (erfuellt.length ? " · " + t("wish.fulfilledN", { n: new Set(erfuellt).size }) : ""));
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
        printed_name: printedNameOf(card) || (lang !== "en" ? csvName : null),
        set_code: (card.set || "").toUpperCase(), set_name: card.set_name,
        cn: card.collector_number, img: imgOf(card),
        cm_id: card.cardmarket_id ?? null,
        type_line: card.type_line ?? null, rarity: card.rarity ?? null,
        mana_cost: manaOf(card), cmc: card.cmc ?? null,
        released: card.released_at ?? null, colors: farbenOf(card),
        keywords: keywordsOf(card), oracle_text: oracleOf(card),
        // Gedruckte Fassung gleich mit: hier wird direkt in die Tabelle
        // geschrieben (kein add_card), also ohne Umweg über addCardNachtrag.
        printed_text: printedTextOf(card), printed_type_line: printedTypeOf(card),
        faces: facesOf(card), color_identity: farbIdentOf(card),
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

  const erfuellt = await reloadMitWunschAbgleich();
  renderAll();
  say(t("imp.done", {
    imported, skipped, deckMsg,
    failedLine: failed.length ? t("imp.failedList", {
      n: failed.length,
      list: esc(failed.slice(0, 8).join(", ")) + (failed.length > 8 ? " …" : "")
    }) : ""
  }));
  toast(t("toast.importedN", { n: imported }) +
        (skipped ? t("toast.importedSkippedSuffix", { n: skipped }) : "") +
        (erfuellt.length ? " · " + t("wish.fulfilledN", { n: new Set(erfuellt).size }) : ""));
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
      const { data, error } = await sb.rpc("add_card", {
        p_scryfall_id: card.id, p_oracle_id: card.oracle_id, p_name: card.name,
        p_printed_name: printedNameOf(card),
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
      // Derselbe Nachtrag wie beim Scan — sonst käme eine hier eingetippte
      // deutsche Karte ohne gedruckten Regeltext in die Sammlung.
      await addCardNachtrag(Array.isArray(data) ? data[0] : data, card);

      // Erfolgreiche Zeilen bleiben sichtbar stehen (man sieht, was aus der
      // Eingabe wurde), sind aber gesperrt — ein zweites "Importieren"
      // würde sie sonst erneut einbuchen.
      tr.dataset.done = "1";
      tr.querySelectorAll("input,select,button").forEach(x => x.disabled = true);
      sag("✓ " + (printedNameOf(card) || card.name) + (price != null ? " · " + eur(price) : ""), "var(--ok)");
      ok++;
    }
    const erfuellt = await reloadMitWunschAbgleich();
    renderAll();
    toast(t("toast.importedN", { n: ok }) + (fail ? t("toast.importedFailedSuffix", { n: fail }) : "") +
          (erfuellt.length ? " · " + t("wish.fulfilledN", { n: new Set(erfuellt).size }) : ""));
  } finally { btn.disabled = false; }
}

/* =============================== Rendern ============================== */
/* Die Wunschliste gehört dazu: sie zeigt die andere Hälfte derselben Zeilen,
   und fast jede Änderung an Sammlung oder Deck verschiebt etwas zwischen den
   beiden. */
function renderAll() { renderCollection(); renderWunschliste(); renderDecks(); }

/* ============================ Login / Start =========================== */
function showGate(mode) {
  $("#gate").style.display = "block";
  $("#app").style.display = "none";
  $$("#gate .pane").forEach(p => p.style.display = p.dataset.pane === mode ? "block" : "none");
  if (mode === "auth") { ladeBenutzerzahl(); ladeDeckzahl(); }   // Statistiken auf dem Login-Screen (anon)
}
function showApp() {
  $("#gate").style.display = "none";
  $("#app").style.display = "block";
  renderWho();
  zeigeKopfVersion();                         // Version dauerhaft im Header
  zeigeKopfLage();                            // Gesamtlage als Beschriftung daneben
}

/* Versionsnummer im Kopf, unter dem Verweis auf die Statusseite. Quelle ist
   APP_VERSION aus dem <meta name="app-version"> in index.html; fehlt sie oder
   ist sie unbrauchbar, bleibt die Zeile weg statt „—“ zu zeigen. Läuft beim
   Anzeigen der App und nach jedem Sprachwechsel. */
function zeigeKopfVersion() {
  const el = $("#header-version");
  if (!el) return;
  el.hidden = !APP_VERSION;
  if (!APP_VERSION) return;
  el.textContent = t("header.version", { v: APP_VERSION });
  el.title = t("settings.version", { v: APP_VERSION });
}

/* Der Verweis im Kopf traegt die Gesamtlage als Beschriftung — „Alle Systeme
   betriebsbereit" statt „Site Status". Die Farbe wiederholt dabei nur, was der
   Text ohnehin sagt: wer sie nicht unterscheiden kann, verliert nichts.

   Solange keine Daten vorliegen — vor dem ersten Abruf oder wenn er scheitert —
   bleibt die neutrale Beschriftung stehen. Lieber „Site Status" als eine Lage
   behaupten, die wir gerade nicht kennen; ein gruenes „Alle Systeme
   betriebsbereit", weil der Abruf fehlschlug, waere die schlechteste aller
   Anzeigen. */
function kopfLageSetzen(lage) {
  const el = $("#header-status");
  if (!el) return;
  el.classList.remove("ok", "warn", "err");
  el.textContent = lage ? lage.text : t("nav.status");
  el.title = lage ? t("nav.status") : "";
  if (lage) el.classList.add(lage.art);
}

function zeigeKopfLage() {
  if (!$("#header-status")) return;
  kopfLageSetzen(STATUS_KURZ ? statusLage(STATUS_KURZ.dienste) : null);
  statusKurzHolen()
    .then(dienste => kopfLageSetzen(statusLage(dienste)))
    .catch(() => kopfLageSetzen(null));
}

async function afterLogin(user) {
  USER = user;
  // Profil laden (bei Erstanmeldung anlegen). Nicht kritisch: schlägt es fehl
  // (z. B. Tabelle noch nicht angelegt), zeigt die App die E-Mail und läuft weiter.
  try { await ladeProfile(); } catch (e) { PROFILE = null; }
  await ladeFlags();   // globale Schalter + Admin-Status, bevor gezeichnet wird
  // Anwesenheit und Postfach: beides nebenher, beides ohne Auswirkung auf den
  // Start. Schlägt es fehl, fehlt höchstens die Zahl am Navigationseintrag.
  //
  // WICHTIG: sb.rpc() liefert einen Query-Builder, kein Promise. Er ist zwar
  // await-bar (er hat then), aber er hat KEIN .catch — ein `.catch()` daran
  // wirft TypeError. Weil das hier im Startpfad steht, riss es die ganze Seite
  // mit: kein Zeichnen, keine Anmeldung, weiße Seite. Deshalb await in einem
  // try, wie überall sonst im Code auch.
  (async () => {
    try { await sb.rpc("touch_last_seen"); } catch { /* Anwesenheit ist entbehrlich */ }
    try { await dmBadgeAktualisieren(); } catch { /* Abzeichen ist entbehrlich */ }
  })();
  showApp();
  try { await reload(); renderAll(); }
  catch (e) { toast(dbErr(e)); }
  // Farbidentität für Altbestand einmalig im Hintergrund nachladen (Grundlage
  // des Farbidentitäts-Filters). Nicht kritisch, blockiert den Start nicht; ist
  // alles erfasst, kehrt es sofort zurück.
  backfillFarbident().catch(() => {});
  // Fremdsprachige Zeilen, die den englischen Druck halten, einmalig
  // geraderücken (siehe backfillGedruckteNamen). Ebenfalls im Hintergrund.
  backfillGedruckteNamen().catch(() => {});
  // Die geteilte MTGJSON-Preishistorie lädt reload() selbst nach — dort, wo
  // CARDS befüllt wird, und damit auch für später erfasste Karten. Hier steht
  // deshalb kein eigener Aufruf mehr.
  // Spielrunde: Einladungs-Badge + laufende Session live, auch ohne die Ansicht
  // zu öffnen. Nicht kritisch — schlägt es fehl, läuft der Rest weiter.
  try { await ladeSession(); subscribeInvites(); if (SESSION) subscribeSession(); }
  catch (e) { /* Realtime optional */ }
  // Community Foundation: optionale, öffentliche Community-Zahlen und ein
  // datensparsamer Live-Feed. Fehler hier dürfen den persönlichen Archivstart
  // niemals blockieren, falls die Sprint-1-Migration noch nicht installiert ist.
  // Der try umschließt bewusst auch den Aufruf selbst: ein synchroner Fehler
  // (fehlende Funktion, kein Realtime) käme am .catch() vorbei und würde sonst
  // afterLogin abbrechen — samt allem, was danach am Aufrufer noch folgt.
  try { ladeCommunityFoundation().catch(() => {}); subscribeCommunityActivity(); }
  catch (e) { /* Community optional */ }
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

  $("#logout").onclick = async () => {
    unsubscribeCommunityActivity();   // Websocket sauber schließen, bevor neu geladen wird
    await sb.auth.signOut(); location.reload();
  };
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
      <h3 style="margin-top:0">${esc(t("profile.aboutTitle"))}</h3>
      <p class="hint" style="margin-top:-4px">${esc(t("profile.aboutHint"))}</p>
      <label>${esc(t("profile.bio"))}</label>
      <textarea id="pf-bio" rows="3" maxlength="600" placeholder="${esc(t("profile.bioPh"))}">${esc(PROFILE?.bio || "")}</textarea>
      <div class="row" style="margin-top:8px">
        <div><label>${esc(t("profile.location"))}</label>
          <input type="text" id="pf-location" maxlength="80" value="${esc(PROFILE?.location || "")}"></div>
        <div><label>${esc(t("profile.favFormat"))}</label>
          <input type="text" id="pf-favformat" maxlength="40" value="${esc(PROFILE?.favourite_format || "")}"
            placeholder="${esc(t("profile.favFormatPh"))}"></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div style="flex:1"><label>${esc(t("profile.website"))}</label>
          <input type="url" id="pf-website" maxlength="200" value="${esc(PROFILE?.website || "")}" placeholder="https://"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt);margin-top:12px">
        <input type="checkbox" id="pf-findable"${PROFILE?.findable === false ? "" : " checked"} style="width:auto">
        <span>${esc(t("profile.findable"))}</span>
      </label>
      <p class="hint">${esc(t("profile.findableHint"))}</p>
      <div class="row" style="margin-top:8px">
        <div style="flex:none"><button class="btn" id="pf-about-save">${esc(t("common.save"))}</button></div>
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
  const ab = $("#pf-about-save");
  if (ab) ab.onclick = profilTextSpeichern;
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
    </div>
    <div class="card">
      <h3 style="margin-top:0">${esc(t("community.vis.title"))}</h3>
      <div class="row">
        <div style="flex:none;min-width:260px"><select id="set-community-vis">${
          SICHTBARKEITEN.map(v =>
            `<option value="${v}"${v === communitySichtbarkeit() ? " selected" : ""}>${esc(t("community.vis." + v))}</option>`).join("")
        }</select></div>
      </div>
      <p class="hint">${esc(t("community.vis." + communitySichtbarkeit() + "Hint"))}</p>
      <p class="hint">${esc(t("community.vis.note"))}</p>
    </div>${IS_ADMIN ? `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("admin.title"))}</h3>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt)">
        <input type="checkbox" id="flag-ki"${FLAGS.ki_synergy ? " checked" : ""} style="width:auto">
        <span>${esc(t("admin.kiFlag"))}</span>
      </label>
      <p class="hint">${esc(t("admin.hint"))}</p>
      <label style="margin-top:12px">${esc(t("admin.limitsTitle"))}</label>
      <div class="row">
        ${[["ki_synergy", "admin.limitKiSyn"], ["rules_question", "admin.limitRules"]].map(([k, lbl]) => `
        <div style="flex:none"><label>${esc(t(lbl))}</label>
          <input type="number" data-ailimit="${k}" min="0" max="1000" step="1" style="width:150px"
            value="${AI_LIMITS[k] ?? 5}"></div>`).join("")}
      </div>
      <p class="hint">${esc(t("admin.limitHint"))}</p>
      <div class="sec-sep"></div>
      <label>${esc(t("admin.verifyTitle"))}</label>
      ${[["verify_cite", "admin.verifyCite"], ["verify_model", "admin.verifyModel"],
          ["verify_cost", "admin.verifyCost"], ["verify_pair", "admin.verifyPair"]].map(([k, lbl]) => `
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt);margin-top:6px">
        <input type="checkbox" data-flag="${k}"${FLAGS[k] ? " checked" : ""} style="width:auto">
        <span>${esc(t(lbl))}</span>
      </label>`).join("")}
      <p class="hint">${esc(t("admin.verifyHint"))}</p>
      <div class="sec-sep"></div>
      <label>${esc(t("admin.accessTitle"))}</label>
      <div id="admin-access"><div class="meta"><span class="syn-spin">&#9881;</span></div></div>
      <p class="hint">${esc(t("admin.accessHint"))}</p>
      <div class="sec-sep"></div>
      <label>${esc(t("admin.rolesTitle"))}</label>
      <div id="admin-rechte"><div class="meta"><span class="syn-spin">&#9881;</span></div></div>
      <p class="hint">${esc(t("admin.rolesHint"))}</p>
      <div class="sec-sep"></div>
      <label>${esc(t("diag.adminTitle"))}</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:14px;color:var(--txt);margin-top:6px">
        <input type="checkbox" id="d-diag"${ziehDiagnose() ? " checked" : ""} style="width:auto">
        <span>${esc(t("diag.toggle"))}</span>
      </label>
      <p class="hint">${esc(t("diag.adminHint"))}</p>
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
  $("#set-community-vis").onchange = ev => communitySichtbarkeitSpeichern(ev.target.value);
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
  $$("#v-settings [data-ailimit]").forEach(inp => inp.onchange = async () => {
    const kind = inp.dataset.ailimit;
    inp.disabled = true;
    try {
      const wert = await aiLimitSetzen(kind, inp.value);
      inp.value = wert;   // auf den tatsächlich gespeicherten Wert zurückschreiben
      toast(wert === 0 ? t("admin.limitOff") : t("admin.limitSaved", { n: wert }));
    } catch (e) { inp.value = AI_LIMITS[kind] ?? 5; toast(dbErr(e)); }
    finally { inp.disabled = false; }
  });
  const fk = $("#flag-ki");
  if (fk) fk.onchange = async ev => {
    const an = ev.target.checked;
    fk.disabled = true;
    try { await flagSetzen("ki_synergy", an); toast(t(an ? "admin.kiOn" : "admin.kiOff")); }
    catch (e) { fk.checked = !an; toast(dbErr(e)); }
    finally { fk.disabled = false; }
  };
  // Die Prüfverfahren global schalten. Nach dem Umlegen die Personenliste neu
  // zeichnen: was global an ist, braucht dort keine Einzelfreigabe mehr.
  $$("#v-settings [data-flag]").forEach(cb => cb.onchange = async () => {
    const an = cb.checked;
    cb.disabled = true;
    try { await flagSetzen(cb.dataset.flag, an); toast(t("set.saved")); await zeichneFreigaben(); }
    catch (e) { cb.checked = !an; toast(dbErr(e)); }
    finally { cb.disabled = false; }
  });
  // Zieh-Diagnose: gerätelokal wie „Treffer sofort übernehmen", deshalb ohne
  // Datenbank und ohne Toast — der Haken selbst ist die Rückmeldung.
  const dg = $("#d-diag");
  if (dg) dg.onchange = () => ziehDiagnoseSetzen(dg.checked);
  if (IS_ADMIN) { zeichneFreigaben(); zeichneRechte(); }
}

/* Die Personenliste der Admin-Ansicht: wer ist für welches Verfahren einzeln
   freigeschaltet. Steht ein Verfahren global an, ist das Kästchen fest
   angehakt und gesperrt — die Einzelfreigabe wäre dann wirkungslos, und ein
   klickbares Kästchen würde etwas anderes behaupten. */
async function zeichneFreigaben() {
  const box = $("#admin-access");
  if (!box) return;
  const VERFAHREN = [["verify_cite", "admin.verifyCiteShort"], ["verify_model", "admin.verifyModelShort"],
                     ["verify_cost", "admin.verifyCostShort"], ["verify_pair", "admin.verifyPairShort"]];
  let leute = [];
  try {
    const { data, error } = await sb.rpc("admin_feature_access");
    if (error) throw error;
    leute = data || [];
  } catch (e) { box.innerHTML = `<div class="empty">${esc(dbErr(e))}</div>`; return; }
  if (!leute.length) { box.innerHTML = `<div class="empty">${esc(t("admin.accessNone"))}</div>`; return; }

  box.innerHTML = `<table class="tbl"><thead><tr>
      <th>${esc(t("admin.accessPerson"))}</th>
      ${VERFAHREN.map(([, l]) => `<th class="num">${esc(t(l))}</th>`).join("")}
    </tr></thead><tbody>${leute.map(p => `
    <tr><td>${esc(p.display_name || t("community.anonMember"))}</td>
      ${VERFAHREN.map(([k]) => {
        const global = !!FLAGS[k];
        const an = global || (p.keys || []).includes(k);
        return `<td class="num"><input type="checkbox" style="width:auto"
          data-grant="${esc(k)}" data-user="${esc(p.user_id)}"${an ? " checked" : ""}${global ? " disabled" : ""}
          title="${esc(t(global ? "admin.accessGlobalOn" : "admin.accessToggle"))}"></td>`;
      }).join("")}
    </tr>`).join("")}</tbody></table>`;

  box.querySelectorAll("[data-grant]").forEach(cb => cb.onchange = async () => {
    const { grant, user } = cb.dataset;
    const an = cb.checked;
    cb.disabled = true;
    try {
      const { error } = an
        ? await sb.from("feature_access").insert({ user_id: user, key: grant })
        : await sb.from("feature_access").delete().eq("user_id", user).eq("key", grant);
      if (error) throw error;
      toast(t(an ? "admin.accessGranted" : "admin.accessRevoked"));
    } catch (e) { cb.checked = !an; toast(dbErr(e)); }
    finally { cb.disabled = false; }
  });
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
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
      if (ctx?.code === "quota") msg = limitMeldung(ctx);
    } catch { /* generisch */ }
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

/* Sichtbarkeit im Community-Feed (profiles.community_visibility). Durchgesetzt
   wird sie in der Datenbank beim Schreiben — hier steht nur die Auswahl. */
const SICHTBARKEITEN = ["public", "anonymous", "private"];
function communitySichtbarkeit() {
  const v = PROFILE?.community_visibility;
  return SICHTBARKEITEN.includes(v) ? v : "public";
}

async function communitySichtbarkeitSpeichern(wert) {
  if (!SICHTBARKEITEN.includes(wert)) return;
  const vorher = communitySichtbarkeit();
  if (wert === vorher) return;
  // „anonym" und „privat" räumen die bisherigen Einträge mit auf; das lässt
  // sich nicht zurücknehmen. Deshalb vorher fragen.
  if (wert !== "public") {
    const ok = await confirmDlg(`<p>${esc(t("community.vis.confirm" + (wert === "private" ? "Private" : "Anon")))}</p>`);
    if (!ok) { renderSettings(); return; }
  }
  try {
    const { error } = await sb.from("profiles").update({ community_visibility: wert }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.community_visibility = wert;
    // Der Feed sieht danach anders aus — frisch holen statt raten.
    await ladeCommunityFoundation();
    toast(t("community.vis.saved"));
  } catch (e) { toast(dbErr(e)); renderSettings(); }
}

/* Karten je Sammlungsseite speichern (Profil-Einstellung, gilt damit auf allen
   Geräten). 0 = keine Seitenaufteilung. Betrifft beide Kartenlisten. */
async function pageSizeSpeichern(n) {
  try {
    const { error } = await sb.from("profiles").update({ page_size: n }).eq("id", USER.id);
    if (error) throw error;
    PROFILE.page_size = n;
    listPage.coll = 0; listPage.wish = 0;
    renderCollection(); renderWunschliste();
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
let USER_COUNT = null;   // Gesamtzahl registrierter Nutzer (Anzeige auf dem Login-Screen)
let DECK_COUNT = null;   // Gesamtzahl erstellter Decks (Anzeige auf dem Login-Screen)

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
   eigene + befreundete Profile sichtbar macht) und auf dem Login-Screen
   anzeigen. In der angemeldeten Ansicht steht die Zahl unter „Community“;
   der Login-Screen kennt diesen Weg nicht und zeigt sie deshalb hier.
   Anzeige ist optional — schlägt der Aufruf fehl, bleibt sie einfach leer. */
async function ladeBenutzerzahl() {
  try { const { data, error } = await sb.rpc("registered_user_count"); if (!error && data != null) USER_COUNT = Number(data); }
  catch { /* still ignorieren — Zahl ist nur informativ */ }
  zeigeBenutzerzahl();
}
function zeigeBenutzerzahl() {
  const n = USER_COUNT != null ? String(USER_COUNT) : null, lbl = t("stats.registeredUsers");
  const g = $("#gate-user-count");
  if (g) { g.hidden = n == null; if (n != null) g.innerHTML = `&#128101; <b>${esc(n)}</b> ${esc(lbl)}`; }
}

/* Gesamtzahl erstellter Decks laden (SECURITY-DEFINER-RPC, da RLS nur
   eigene Decks sichtbar macht) und auf dem Login-Screen anzeigen — wie bei
   der Nutzerzahl liegt die Zahl in der App selbst unter „Community“.
   Anzeige ist optional — schlägt der Aufruf fehl, bleibt sie einfach leer. */
async function ladeDeckzahl() {
  try { const { data, error } = await sb.rpc("total_deck_count"); if (!error && data != null) DECK_COUNT = Number(data); }
  catch { /* still ignorieren — Zahl ist nur informativ */ }
  zeigeDeckzahl();
}
function zeigeDeckzahl() {
  const n = DECK_COUNT != null ? String(DECK_COUNT) : null, lbl = t("stats.totalDecks");
  const g = $("#gate-deck-count");
  if (g) { g.hidden = n == null; if (n != null) g.innerHTML = `&#127136; <b>${esc(n)}</b> ${esc(lbl)}`; }
}

/* ========================= Community Foundation ======================= *
   Sprint 1: die öffentliche, datensparsame Community-Ebene. Alle Zahlen und
   Feed-Zeilen kommen aus SECURITY-DEFINER-RPCs (community_statistics,
   community_activity_feed) — private Sammlungs-, Deck- und Termindaten
   verlassen die Datenbank dabei nie, der Feed kennt nur Aktion, Akteur und
   Zeitpunkt. Fehlt die Sprint-1-Migration, bleiben die Werte leer und der
   Block zeigt einen Hinweis statt zu scheitern. */

const COMMUNITY_FEED_LIMIT = 20;
let communityFeedTimer = null;
/* Realtime liefert nur die rohe Zeile — ohne Anzeigenamen. Eingehende
   Ereignisse warten deshalb im Puffer, bis der gebündelte Neuabruf die Namen
   nachgeliefert hat; erst dann entsteht eine Meldung. Die fertigen Meldungen
   wandern in eine Schlange und werden nacheinander gezeigt, damit bei
   gleichzeitiger Aktivität mehrerer Leute keine verloren geht. */
let communityEventPuffer = [], communityToastSchlange = [], communityToastTimer = null;
let communityToastLaeuft = false;   // eine Meldung steht gerade — auch beim Anhalten per Hover

async function ladeCommunityStats() {
  try {
    const { data, error } = await sb.rpc("community_statistics");
    if (error) throw error;
    // returns table(...) → PostgREST liefert ein Array mit genau einer Zeile.
    COMMUNITY_STATS = Array.isArray(data) ? (data[0] || null) : (data || null);
  } catch { COMMUNITY_STATS = null; }
}

/* Gefundene Combos und Synergien für die Community-Kacheln mitzählen. Beides
   entsteht außerhalb der Datenbank (Commander Spellbook bzw. Scryfall), also
   führt kein Weg an einer eigenen Zählung vorbei. Gespeichert wird nur eine
   Gesamtsumme je Art — keine Zeile je Suche, keine Kennung, nichts, was sich
   einer Person zuordnen ließe. Schlägt der Aufruf fehl, ist das folgenlos:
   eine Kachel ist keinen Fehler wert. */
function zaehleCommunitySuche(art, n) {
  if (!sb || !USER || !(n > 0)) return;
  // Die Zählung ist Beiwerk und darf die Suche unter keinen Umständen
  // abbrechen — sie steht mitten in den Anzeigefunktionen, VOR dem Rendern.
  // sb.rpc() liefert einen Builder, der then() kennt, aber kein catch(); ein
  // .catch() daran wirft synchron. Deshalb erst in ein echtes Promise heben
  // und zusätzlich synchron absichern.
  try {
    Promise.resolve(sb.rpc("record_community_search", { p_kind: art, p_n: n }))
      .catch(() => {});
  } catch { /* nebensächlich */ }
}

async function ladeCommunityHighlights() {
  try {
    const { data, error } = await sb.rpc("community_highlights");
    if (error) throw error;
    COMMUNITY_HIGHLIGHTS = data || null;
  } catch { COMMUNITY_HIGHLIGHTS = null; }
}

async function ladeCommunityFeed() {
  try {
    const { data, error } = await sb.rpc("community_activity_feed", { p_limit: COMMUNITY_FEED_LIMIT });
    if (error) throw error;
    COMMUNITY_FEED = Array.isArray(data) ? data : [];
  } catch { COMMUNITY_FEED = []; }
}

/* Beide RPCs parallel — sie hängen nicht voneinander ab. Danach nur neu
   zeichnen, wenn das Dashboard gerade offen ist; sonst holt renderDashboard()
   die Werte beim nächsten Wechsel ohnehin aus den Globals. */
async function ladeCommunityFoundation() {
  await Promise.all([ladeCommunityStats(), ladeCommunityFeed(), ladeCommunityHighlights()]);
  if ($(".view.on")?.id === "v-community") zeigeCommunity();
}

/* Realtime: jeder neue Eintrag in community_activity frischt Feed und Zahlen
   auf. Mehrere Inserts kurz hintereinander (ein CSV-Import löst pro Karte einen
   Trigger aus!) werden zu einem einzigen Nachladen gebündelt. */
function subscribeCommunityActivity() {
  if (communityChannel || !USER) return;
  communityChannel = sb.channel("community:activity")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_activity" }, payload => {
      if (payload.new) communityEventPuffer.push(payload.new);
      if (communityFeedTimer) clearTimeout(communityFeedTimer);
      communityFeedTimer = setTimeout(() => {
        communityFeedTimer = null;
        ladeCommunityFoundation().then(meldeCommunityEreignisse).catch(() => {});
      }, 1500);
    })
    .subscribe();
}
function unsubscribeCommunityActivity() {
  if (communityFeedTimer) { clearTimeout(communityFeedTimer); communityFeedTimer = null; }
  if (communityToastTimer) { clearTimeout(communityToastTimer); communityToastTimer = null; }
  communityToastLaeuft = false;
  communityEventPuffer = []; communityToastSchlange = [];
  $("#community-toast")?.classList.remove("on");
  versteckeCmdHover();
  if (communityChannel) { sb.removeChannel(communityChannel); communityChannel = null; }
}

/* Aus dem Puffer Meldungen bauen: pro Person eine, egal wie viele Ereignisse
   sie ausgelöst hat. Sind mehrere Leute gleichzeitig aktiv, kommen alle in die
   Schlange und werden nacheinander gezeigt — nichts fällt hinten runter. */
function meldeCommunityEreignisse() {
  if (!communityEventPuffer.length) return;
  const puffer = communityEventPuffer;
  communityEventPuffer = [];
  // Die Anzeigenamen stehen erst im frisch geladenen Feed, nicht in der
  // Realtime-Zeile. Fehlt einer (Feed schon weitergerückt), greift der
  // anonyme Fallback.
  const namen = new Map(COMMUNITY_FEED.map(r => [r.actor_id, r.actor_name]));
  const proPerson = new Map();
  for (const row of puffer) {
    const k = row.actor_id || "";
    if (!proPerson.has(k)) proPerson.set(k, { actor_id: row.actor_id, zeilen: [] });
    proPerson.get(k).zeilen.push(row);
  }
  for (const g of proPerson.values())
    communityToastSchlange.push(communityMeldung(g, namen.get(g.actor_id)));
  zeigeNaechsteCommunityMeldung();
}

/* Eine Person, eine Art → der gewohnte Satz, bei mehreren Ereignissen mit
   Anzahl. Gemischte Arten lassen sich nicht in einen Satz gießen, dafür gibt
   es die neutrale Zählform. */
function communityMeldung(gruppe, name) {
  const anzeige = (name || "").trim() || t("community.anonMember");
  const arten = new Set(gruppe.zeilen.map(r => r.kind));
  if (arten.size === 1) {
    const n = gruppe.zeilen.reduce((s, r) => s + (Number(r.metadata?.n) || 1), 0);
    const meta = { n };
    // Genau ein Ereignis: den Kartennamen mitnehmen, damit der Toast ihn nennt.
    // Bei mehreren wäre die Auswahl eines einzelnen Namens willkürlich.
    if (gruppe.zeilen.length === 1 && gruppe.zeilen[0].metadata?.name) {
      meta.name = gruppe.zeilen[0].metadata.name;
      meta.img = gruppe.zeilen[0].metadata.img;
    }
    // Als HTML, damit der Kartenname im Toast dieselbe Vorschau trägt wie im Feed.
    return aktivitaetHtml({ kind: [...arten][0], actor_name: anzeige, metadata: meta });
  }
  return esc(t("community.toast.multi", { name: anzeige, n: gruppe.zeilen.length }));
}

/* Die Schlange nacheinander abarbeiten. Erst wenn eine Meldung abgelaufen ist,
   kommt die nächste — sonst überschriebe eine die andere. */
const COMMUNITY_TOAST_DAUER = 3000;

function zeigeNaechsteCommunityMeldung() {
  if (communityToastLaeuft || !communityToastSchlange.length) return;
  const el = $("#community-toast");
  if (!el) { communityToastSchlange = []; return; }   // Markup fehlt — nicht sammeln
  communityToastLaeuft = true;
  el.innerHTML = communityToastSchlange.shift();
  el.classList.add("on");
  wireCommunityKartenHover(el);
  // Wer auf den Kartennamen zeigt, will die Vorschau ansehen — solange hält die
  // Meldung an, sonst verschwände sie unter dem Mauszeiger. Danach läuft die
  // Zeit von vorn, statt sofort abzubrechen.
  el.querySelectorAll(".cf-card").forEach(k => {
    k.addEventListener("mouseenter", () => clearTimeout(communityToastTimer));
    k.addEventListener("mouseleave", communityToastUhr);
  });
  communityToastUhr();
}

function communityToastUhr() {
  clearTimeout(communityToastTimer);
  communityToastTimer = setTimeout(() => {
    $("#community-toast")?.classList.remove("on");
    versteckeCmdHover();   // Vorschau nicht über die Meldung hinaus stehen lassen
    // Kurze Lücke, damit zwei Meldungen nicht ineinander blenden.
    communityToastTimer = setTimeout(() => {
      communityToastTimer = null;
      communityToastLaeuft = false;
      zeigeNaechsteCommunityMeldung();
    }, 300);
  }, COMMUNITY_TOAST_DAUER);
}

/* Relative Zeit in Worten. Bewusst grob — auf die Minute genau zu sein wäre für
   einen Aktivitätsstrom weder nötig noch lesbarer. */
function relativeZeit(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const sek = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sek < 60) return t("community.justNow");
  const min = Math.round(sek / 60);
  if (min < 60) return t("community.minutesAgo", { n: min });
  const std = Math.round(min / 60);
  if (std < 24) return t("community.hoursAgo", { n: std });
  const tage = Math.round(std / 24);
  return tage === 1 ? t("community.dayAgo") : t("community.daysAgo", { n: tage });
}

/* Eine Feed-Zeile in Worte fassen. Unbekannte Arten (spätere Sprints bringen
   z. B. Achievements) fallen auf eine neutrale Formulierung zurück, statt den
   rohen Schlüssel anzuzeigen. */
function aktivitaetText(row) {
  const name = (row.actor_name || "").trim();
  // Die Feed-RPC liefert für Mitglieder ohne Anzeigenamen NULL; die erste
  // Sprint-1-Fassung lieferte stattdessen ein deutsches Literal. Beides wird
  // hier in die aktuelle Oberflächensprache übersetzt.
  const anzeige = (!name || name === "Ein Mitglied") ? t("community.anonMember") : name;
  // Der einmalige Rückstand fasst pro Person und Tag zusammen und legt die
  // Anzahl in metadata.n ab. Solche Zeilen bekommen einen Mehrzahl-Text;
  // laufende Trigger-Einträge haben kein n und bleiben in der Einzahl.
  const n = Number(row.metadata?.n) || 1;
  const karte = (row.metadata?.name || "").trim();
  const params = { name: anzeige, n, karte };
  const kandidaten = [
    ...(n > 1 ? ["community.kind." + row.kind + "_n"] : []),
    // Einzelnes Ereignis mit Kartenname → die Fassung, die die Karte nennt.
    ...(karte && n === 1 ? ["community.kind." + row.kind + "_named"] : []),
    "community.kind." + row.kind,
    "community.kind.unknown",
  ];
  for (const key of kandidaten) {
    const txt = t(key, params);
    if (txt !== key) return txt;   // t() gibt den Schlüssel zurück, wenn er fehlt
  }
  return t("community.kind.unknown", params);
}

function communityStatsHtml() {
  const s = COMMUNITY_STATS;
  if (!s) return "";
  const zahl = v => Number(v ?? 0).toLocaleString(LANG);
  return `<div class="stats" style="margin-bottom:14px">${[
    [t("community.members"), s.member_count],
    [t("community.decks"), s.deck_count],
    [t("community.cards"), s.card_count],
    [t("community.activeSessions"), s.active_session_count],
    [t("community.upcomingEvents"), s.upcoming_event_count],
    [t("community.activity7d"), s.activity_7d_count],
    [t("community.combos"), s.combo_count],
    [t("community.synergies"), s.synergy_count],
  ].map(([k, v]) =>
    `<div class="stat"><div class="v">${esc(zahl(v))}</div><div class="k">${esc(k)}</div></div>`).join("")}</div>`;
}

/* Wie aktivitaetText, nur als HTML: Ist ein Kartenname hinterlegt, wird er zu
   einem eigenen Element mit Hover-Vorschau. Der Name kommt aus fremden Daten
   und darf kein Markup einschleusen — deshalb steht im Text zunächst ein
   Platzhalter, der die Maskierung unbeschadet übersteht (esc() fasst nur
   & < > " ' an) und erst danach durch das fertige Element ersetzt wird. */
const KARTEN_PLATZHALTER = " karte ";

function aktivitaetHtml(row) {
  const karte = (row.metadata?.name || "").trim();
  const n = Number(row.metadata?.n) || 1;
  // Ohne Namen, bei anderer Art oder bei zusammengefassten Einträgen (die
  // stehen für viele Karten) bleibt es beim bisherigen Satz.
  if (!karte || row.kind !== "card_added" || n > 1) return esc(aktivitaetText(row));

  const name = (row.actor_name || "").trim();
  const anzeige = (!name || name === "Ein Mitglied") ? t("community.anonMember") : name;
  const schluessel = "community.kind.card_added_named";
  const text = t(schluessel, { name: anzeige, karte: KARTEN_PLATZHALTER });
  if (text === schluessel) return esc(aktivitaetText(row));   // Übersetzung fehlt

  // Gespeichert ist die kleine Scryfall-Fassung (146px). Auf 220px hochgezogen
  // wäre der Regeltext unlesbar — dieselbe Umschaltung wie bei Combo- und
  // Deck-Karten. Bewusst hier und nicht beim Schreiben, damit auch die bereits
  // erfassten Einträge davon profitieren.
  const img = (row.metadata?.img || "").replace("/small/", "/normal/");
  const preis = row.metadata?.price;
  const el = `<span class="cf-card"${img ? ` data-cmd-img="${esc(img)}" data-cmd-name="${esc(karte)}"` : ""}` +
    `${img && preis != null ? ` data-cmd-preis="${esc(eur(preis))}"` : ""}>${esc(karte)}</span>`;
  return esc(text).split(KARTEN_PLATZHALTER).join(el);
}

/* Höhepunkte der Community. Die drei Kartenkacheln verhalten sich wie die
   Sammlung: kleines Bild, Vorschau beim Draufzeigen, Detailansicht beim Klick.
   Die Karten gehören anderen, deshalb reisen sie als vollständiges Objekt aus
   der RPC mit — in CARDS wären sie nicht zu finden. */
function communityHighlightsHtml() {
  const h = COMMUNITY_HIGHLIGHTS;
  if (!h) return "";

  const person = (wert, schluessel, zusatz) => {
    if (!wert) return "";
    const name = (wert.name || "").trim() || t("community.anonMember");
    return `<div class="ch-tile"><div class="ch-k">${esc(t(schluessel))}</div>
      <div class="ch-v">${esc(name)}</div>
      <div class="ch-z">${esc(zusatz(wert))}</div></div>`;
  };

  const karte = (k, schluessel, zusatz) => {
    if (!k) return "";
    // Der Index zeigt auf die Karte in COMMUNITY_HIGHLIGHTS — das Objekt selbst
    // gehört nicht ins Markup.
    return `<div class="ch-tile ch-card" data-ch="${esc(schluessel)}" tabindex="0" role="button">
      <div class="ch-k">${esc(t("community.hl." + schluessel))}</div>
      <div class="ch-card-row">
        ${k.img ? `<img class="ch-img" src="${esc(k.img)}" alt="" loading="lazy">` : ""}
        <div class="ch-card-txt">
          <div class="ch-v">${esc(k.name || "")}</div>
          <div class="ch-z">${esc(zusatz(k))}</div>
        </div>
      </div></div>`;
  };

  const besitzer = k => {
    const n = (k.owner || "").trim() || t("community.anonMember");
    return t("community.hl.owner", { name: n });
  };
  const datum = d => { const z = Date.parse(d); return Number.isFinite(z) ? new Date(z).toLocaleDateString(LANG) : "–"; };

  const kacheln = [
    person(h.newest_member, "community.hl.newestMember",
      w => t("community.hl.since", { d: datum(w.since) })),
    h.biggest_collection ? `<div class="ch-tile"><div class="ch-k">${esc(t("community.hl.biggestCollection"))}</div>
      <div class="ch-v">${esc((h.biggest_collection.name || "").trim() || t("community.anonMember"))}</div>
      <div class="ch-z">${esc(t("community.hl.cardsN", { n: Number(h.biggest_collection.cards || 0).toLocaleString(LANG) }))}</div></div>` : "",
    karte(h.newest_card, "newestCard", besitzer),
    karte(h.oldest_card, "oldestCard", k => `${datum(k.released)} · ${besitzer(k)}`),
    karte(h.priciest_card, "priciestCard", k => `${eur(k.price)} · ${besitzer(k)}`),
  ].filter(Boolean).join("");

  return kacheln ? `<h4 class="cf-title" style="margin-top:14px">${esc(t("community.hl.title"))}</h4>
    <div class="ch-grid">${kacheln}</div>` : "";
}

/* Vorschau und Detailansicht an die Kartenkacheln hängen — wie in der
   Sammlung, nur mit dem Kartenobjekt statt einer ID. */
function wireCommunityHighlights(root) {
  if (!root || !COMMUNITY_HIGHLIGHTS) return;
  const feld = { newestCard: "newest_card", oldestCard: "oldest_card", priciestCard: "priciest_card" };
  root.querySelectorAll(".ch-card[data-ch]").forEach(el => {
    const k = COMMUNITY_HIGHLIGHTS[feld[el.dataset.ch]];
    if (!k) return;
    el.onclick = () => { hideHover(); zeigeFremdeKarte(k); };
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    if (!HOVER_OK) return;
    el.addEventListener("mouseenter", e => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => zeigeHoverKarte(k, e.clientX, e.clientY), 300);
    });
    el.addEventListener("mouseleave", hideHover);
  });
}

function communityFeedHtml() {
  if (!COMMUNITY_FEED.length)
    return `<p class="hint" style="margin:0">${esc(t("community.feedEmpty"))}</p>`;
  return `<ul class="community-feed">${COMMUNITY_FEED.map(r =>
    `<li><span class="cf-text">${aktivitaetHtml(r)}</span>` +
    `<span class="cf-time">${esc(relativeZeit(r.occurred_at))}</span></li>`).join("")}</ul>`;
}

/* Kartenvorschau an die Namen im Feed hängen — dieselbe schwebende Vorschau
   wie bei Commander- und Combo-Karten. Nicht showHover(): das sucht in CARDS,
   also der EIGENEN Sammlung, und fremde Karten stehen da nicht drin. */
function wireCommunityKartenHover(root) {
  if (!HOVER_OK || !root) return;
  root.querySelectorAll(".cf-card[data-cmd-img]").forEach(el => {
    el.addEventListener("mousemove", e =>
      zeigeCmdHover(el.dataset.cmdImg, el.dataset.cmdName, e.clientX, e.clientY, el.dataset.cmdPreis));
    el.addEventListener("mouseleave", versteckeCmdHover);
  });
}

/* Der Feed lässt sich zuklappen; die Wahl überlebt den Ansichtswechsel — wie
   bei den offenen Decks. */
function feedOffen() {
  try { return localStorage.getItem("mtg-community-feed") !== "0"; }
  catch { return true; }   // localStorage gesperrt — dann eben immer offen
}
function feedOffenSetzen(an) {
  try { localStorage.setItem("mtg-community-feed", an ? "1" : "0"); } catch { /* gesperrt */ }
}

function communityBodyHtml() {
  if (!COMMUNITY_STATS && !COMMUNITY_FEED.length)
    return `<p class="hint" style="margin:0">${esc(t("community.unavailable"))}</p>`;
  const offen = feedOffen();
  return `${communityStatsHtml()}
    ${communityHighlightsHtml()}
    <button type="button" class="cf-toggle" id="cf-toggle" aria-expanded="${offen}" aria-controls="cf-list">
      <span class="cf-caret" aria-hidden="true">${offen ? "&#9662;" : "&#9656;"}</span>
      <span>${esc(t("community.feedTitle"))}</span>
      <span class="cf-count">${COMMUNITY_FEED.length}</span>
    </button>
    <div id="cf-list"${offen ? "" : " hidden"}>${communityFeedHtml()}</div>`;
}

function wireCommunityFeedToggle() {
  const b = $("#cf-toggle");
  if (b) b.onclick = () => { feedOffenSetzen(!feedOffen()); zeigeCommunity(); };
}

/* Nur den Inhalt neu zeichnen. Ein Realtime-Update soll nicht die ganze
   Ansicht samt Kennzahlen-Kacheln neu aufbauen. */
function zeigeCommunity() {
  const el = $("#community-body");
  if (!el) return;
  el.innerHTML = communityBodyHtml();
  wireCommunityFeedToggle();
  wireCommunityKartenHover(el);
  wireCommunityHighlights(el);
}

/* Eigene Ansicht statt Anhängsel am Dashboard: das Dashboard beantwortet „was
   habe ich", die Community „was passiert bei den anderen". */
function renderCommunity() {
  const el = $("#v-community");
  if (!el) return;
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${esc(t("community.title"))}</h3>
      <p class="hint" style="margin-top:-4px">${esc(t("community.hint"))}</p>
      <div id="community-body">${communityBodyHtml()}</div>
    </div>`;
  wireCommunityFeedToggle();
  wireCommunityKartenHover(el);
  wireCommunityHighlights(el);
  // Beim Login geladen; war das erfolglos oder steht die Ansicht früher, hier
  // nachziehen. Kein Kreislauf: ladeCommunityFoundation() ruft nur zeigeCommunity().
  if (!COMMUNITY_STATS && !COMMUNITY_FEED.length) ladeCommunityFoundation().catch(() => {});
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

    <div class="card">
      <h3 style="margin-top:0">${esc(t("friends.searchTitle"))}</h3>
      <p class="hint" style="margin-top:-4px">${esc(t("friends.searchHint"))}</p>
      <div class="row">
        <div style="flex:1"><input type="search" id="people-q" placeholder="${esc(t("friends.searchPh"))}" autocomplete="off"></div>
      </div>
      <div id="people-res"></div>
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
        <div style="flex:none"><button class="btn ghost sm" data-dmwith="${esc(f.other.id)}">${esc(t("dm.write"))}</button></div>
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
  $$("[data-dmwith]").forEach(b => b.onclick = () => dmMitPerson(b.dataset.dmwith));
  wirePersonensuche();
}

/* Personensuche: der eigentliche Ersatz fuer die Weitergabe des Codes.
   Serverseitig (search_people) kommt zu jedem Treffer gleich mit, wie das
   Verhaeltnis steht — so zeigt die Zeile direkt den richtigen Knopf, statt
   erst auf einen Klick hin nachzufragen. */
let personenSuchLauf = 0;
function wirePersonensuche() {
  const feld = $("#people-q"), box = $("#people-res");
  if (!feld || !box) return;
  let timer = 0;
  const suchen = async () => {
    const q = (feld.value || "").trim();
    const lauf = ++personenSuchLauf;
    if (q.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="meta"><span class="syn-spin">&#9881;</span></div>`;
    try {
      const { data, error } = await sb.rpc("search_people", { q });
      if (error) throw error;
      if (lauf !== personenSuchLauf) return;   // veraltete Antwort verwerfen
      const treffer = data || [];
      box.innerHTML = treffer.length ? treffer.map(p => {
        const knopf = {
          friend:   `<button class="btn ghost sm" data-dmwith="${esc(p.id)}">${esc(t("dm.write"))}</button>`,
          sent:     `<span class="pill">${esc(t("friends.waiting"))}</span>`,
          incoming: `<button class="btn sm" data-accept2="${esc(p.id)}">${esc(t("friends.accept"))}</button>`,
          none:     `<button class="btn sm" data-req="${esc(p.id)}">${esc(t("friends.sendReq"))}</button>`,
        }[p.status] || "";
        return `<div class="freund-zeile">
          ${avatarHtml(34, p)}
          <div style="flex:1;min-width:0"><b>${esc(p.display_name || t("friends.unknown"))}</b></div>
          <div style="flex:none">${knopf}</div>
        </div>`;
      }).join("") : `<div class="empty">${esc(t("friends.searchNone"))}</div>`;
      box.querySelectorAll("[data-req]").forEach(b => b.onclick = () => freundAnfragenAn(b.dataset.req));
      box.querySelectorAll("[data-accept2]").forEach(b => b.onclick = () => freundAntwort(b.dataset.accept2, true));
      box.querySelectorAll("[data-dmwith]").forEach(b => b.onclick = () => dmMitPerson(b.dataset.dmwith));
    } catch (e) { box.innerHTML = `<div class="empty">${esc(dbErr(e))}</div>`; }
  };
  feld.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(suchen, 250); });
}

/* Anfrage an eine gefundene Person. Gleiche Rueckmeldungen wie beim Code —
   die Datenbank benutzt fuer beide Wege dieselben Rueckgabewerte. */
async function freundAnfragenAn(userId) {
  try {
    const { data, error } = await sb.rpc("send_friend_request_to", { p_user: userId });
    if (error) throw error;
    toast({
      sent: t("fr.sent"), accepted: t("fr.accepted"), pending: t("fr.pending"),
      already: t("fr.already"), self: t("fr.self"),
      notfound: t("fr.notfound"), unauth: t("fr.unauth"),
    }[data] || t("fr.done"));
    await ladeFreunde(); renderFriends();
  } catch (e) { toast(dbErr(e)); }
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
  // Commander-Grenze VOR dem Anlegen prüfen: der Trigger würde die Liste
  // mittendrin abweisen und ein halb gefülltes Deck hinterlassen — schlimmer
  // als gar keins.
  if (commanders.length) {
    const gesamt = eintraege.reduce((s, e) => s + (e.qty || 1), 0);
    if (gesamt > DECK_MAX)
      return toast(t("deck.importTooBig", { n: gesamt, max: DECK_MAX }));
  }
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
// card_id → {hand, field, grave, exile, cast} (privat, nur mein Deck). Was in
// keiner dieser Zonen liegt, ist der Rest: Bibliothek bzw. Kommandozone.
let SESSION_ZONEN = {};
let ZONEN_SPALTEN = true;       // false, sobald die DB die Zonen-Spalten nicht kennt
let wuerfelOffen = false;       // Würfelkasten auf-/zugeklappt (überlebt Neuzeichnen)
let einladenOffen = false;      // Einladeliste auf-/zugeklappt
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

/* Eigenen Zonenstand der Partie laden (privat: nur die eigenen Zeilen). Eine
   Zeile hält alle Zonen einer Karte. Kennt die Datenbank die Zonen-Spalten noch
   nicht (Schema älter als die App), läuft die Partie im Browser trotzdem — die
   alte Spalte qty zählte „gespielt" und wird als Schlachtfeld gelesen, damit
   eine laufende Runde nichts verliert. */
const fehltZonenSpalte = e => e?.code === "42703" || /\b(field|graveyard|exile|cast_count|field_state)\b/.test(e?.message || "");
async function ladePlayed() {
  SESSION_ZONEN = {};
  if (!SESSION || !USER) return;
  let { data, error } = await sb.from("session_played")
    .select("card_id,qty,hand,field,graveyard,exile,cast_count,field_state")
    .eq("session_id", SESSION.id).eq("user_id", USER.id);
  if (error && fehltZonenSpalte(error)) {
    ZONEN_SPALTEN = false;
    ({ data } = await sb.from("session_played").select("card_id,qty,hand")
      .eq("session_id", SESSION.id).eq("user_id", USER.id));
  }
  (data || []).forEach(r => {
    const st = {
      hand:  r.hand || 0,
      field: r.field != null ? r.field : (r.qty || 0),   // Altbestand: „gespielt" lag auf dem Feld
      grave: r.graveyard || 0, exile: r.exile || 0, cast: r.cast_count || 0,
    };
    // Exemplarliste des Feldes; feldListe() rückt sie später ohnehin auf die
    // richtige Länge, hier reicht die Prüfung auf „ist überhaupt eine Liste".
    if (Array.isArray(r.field_state) && r.field_state.length) st.fs = r.field_state;
    if (st.hand || st.field || st.grave || st.exile || st.cast) SESSION_ZONEN[r.card_id] = st;
  });
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

/* Eine Spielerkachel: Avatar, Name/Deck und Lebenspunkte NEBENeinander.
   Gestapelt füllten vier Mitspieler den halben Schirm, bevor die eigenen Karten
   überhaupt anfingen. In der Matte stehen dieselben Kacheln schmal untereinander
   im Feld „Lebenspunkte" — deshalb eine Funktion für beide Anordnungen. */
function spielerKachelHtml(p) {
  const joined = p.status === "joined";
  const besiegt = joined && p.life <= 0;   // bei 0 Leben ausgeschieden
  const name = p.profile?.display_name
    || (p.user_id === USER.id ? (PROFILE?.display_name || t("sess.you")) : t("friends.unknown"));
  return `<div class="sp-card${joined ? "" : " wartet"}${besiegt ? " besiegt" : ""}">
    ${avatarHtml(38, p.profile)}
    <div class="sp-mitte">
      <div class="sp-name">${esc(name)}${p.user_id === SESSION.host ? ` <span class="sp-host" title="${esc(t("sess.host"))}">&#9733;</span>` : ""}</div>
      ${p.deck_name ? `<div class="sp-deck"${p.commander_img ? ` data-cmd-img="${esc(p.commander_img)}" data-cmd-name="${esc(p.commander || p.deck_name)}"` : ""} title="${esc(p.commander || p.deck_name)}">${p.commander_img ? `<img class="sp-cmd" src="${esc(p.commander_img)}" alt="">` : ""}<span class="sp-deckname">${esc(p.deck_name)}</span></div>` : ""}
      <div class="sp-besiegt">&#9760; ${esc(t("sess.defeated"))}</div>
    </div>
    ${joined
      ? `<div class="sp-life" data-u="${esc(p.user_id)}">${Math.max(0, p.life)}</div>
         <div class="sp-ctrl">
           <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="-5">&minus;5</button>
           <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="-1">&minus;1</button>
           <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="1">+1</button>
           <button class="btn ghost sm" data-life="${esc(p.user_id)}" data-d="5">+5</button>
         </div>`
      : `<div class="sp-wait">${esc(t("sess.waiting"))}</div>`}
  </div>`;
}

function sessionBoardHtml() {
  const istHost = SESSION.host === USER.id;
  const spieler = SESSION_PLAYERS.map(spielerKachelHtml).join("");

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
      <!-- In der Matte stehen die Spieler im Feld „Lebenspunkte"; hier wäre
           dieselbe Reihe ein zweites Mal. -->
      ${MAT_AN ? "" : `<div class="sp-grid">${spieler}</div>`}
      <div class="row" style="align-items:center;margin-top:12px">
        <div style="flex:none"><label style="margin:0">${esc(t("sess.myDeck"))}</label></div>
        <div style="flex:none;min-width:200px"><select id="sess-deck">
          <option value="">${esc(t("sess.noDeck"))}</option>
          ${(DECKS || []).map(d => `<option value="${esc(d.id)}"${d.id === (meinSpieler()?.deck_id || "") ? " selected" : ""}>${esc(d.name)}</option>`).join("")}
        </select></div>
      </div>
    </div>

    ${deckTrackerHtml()}

    <!-- Würfel und Einladeliste sind Zubehör: die Bühne braucht man beim Wurf,
         die Freundeliste einmal zu Beginn. Zugeklappt bleibt von beiden nur
         eine Zeile, statt dauerhaft ein paar hundert Pixel zu belegen. Beim
         Wurf (auch dem eines Mitspielers) klappt der Kasten von selbst auf. -->
    <details class="card sess-klapp" id="dice-box"${wuerfelOffen ? " open" : ""}>
      <summary><span>${esc(t("sess.dice"))}</span>${
        SESSION_LOG.length ? `<span class="klapp-n">${SESSION_LOG.length}</span>` : ""}</summary>
      <div class="row" style="align-items:center;margin-top:10px">
        <div style="flex:none"><input type="number" id="dice-sides" min="2" max="1000" value="20" style="width:90px"></div>
        <div style="flex:none">${[4, 6, 8, 10, 12, 20].map(s => `<button class="btn ghost sm" data-dice="${s}">W${s}</button>`).join(" ")}</div>
        <div style="flex:none"><button class="btn" id="dice-roll">${esc(t("sess.roll"))}</button></div>
      </div>
      <div class="dice-stage" id="dice-stage">${diceStageHtml()}</div>
      <div class="sess-log" id="sess-log">${SESSION_LOG.slice(0, 30).map(logZeile).join("")}</div>
    </details>

    ${(FRIENDS?.accepted?.length) ? `<details class="card sess-klapp" id="invite-box"${einladenOffen ? " open" : ""}>
      <summary><span>${esc(t("sess.inviteTitle"))}</span>${
        einladbar.length ? `<span class="klapp-n">${einladbar.length}</span>` : ""}</summary>
      <div style="margin-top:8px">${inviteList || `<div class="empty">${esc(t("sess.allInvited"))}</div>`}</div>
    </details>` : ""}`;
}

function logZeile(ev) {
  const p = SESSION_PLAYERS.find(x => x.user_id === ev.user_id);
  const name = p?.profile?.display_name || (ev.user_id === USER?.id ? t("sess.you") : "?");
  if (ev.kind === "dice")
    return `<div class="log-zeile">&#127922; <b>${esc(name)}</b>: W${esc(String(ev.data?.sides))} &rarr; <b>${esc(String(ev.data?.result))}</b></div>`;
  return "";
}

/* ==================== Zonen der eigenen Partie ======================
   Der private Kartenüberblick einer Partie. Nur der Spieler selbst sieht ihn;
   Mitspieler sehen weiterhin bloß Deckname und Commander.

   Eine Karte liegt immer in genau EINER Zone, und die Zonen stehen
   untereinander wie am Tisch: das Feld weit vorn, die Hand direkt vor einem,
   die Bibliothek zuunterst.

       ★  Kommandozone     (nur bei Commander-Decks)
       ⚔  Schlachtfeld
       ⚰  Friedhof
       ✖  Exil
       ✋  Hand
       ☰  Bibliothek

   Aufgeklappt ist immer genau eine Zone — die, über der die Maus steht (auf
   Touch: die zuletzt angetippte). Dadurch bleibt die Ansicht kurz, statt sechs
   Listen untereinander zu stapeln. Die zugeklappten Kopfzeilen zeigen Anzahl
   und ein paar Miniaturen, damit man auch ohne Aufklappen sieht, was drinliegt.

   Gespeichert werden nur vier Zahlen je Karte (hand/field/graveyard/exile).
   Bibliothek und Kommandozone sind der REST aus der Deckmenge: eine normale
   Karte, die nirgends sonst liegt, ist in der Bibliothek; der Commander eines
   Decks in der Kommandozone. So kann kein Exemplar doppelt existieren und keine
   Zeile der Deckmenge widersprechen. cast_count zählt daneben, wie oft der
   Commander schon aus der Kommandozone gewirkt wurde — daraus ergibt sich die
   Commander-Steuer (je Mal zwei Mana mehr). */

/* Reihenfolge = Anzeige von oben nach unten. „gespeichert: false" heißt: diese
   Zone ist der Rest und steht in keiner Spalte. */
/* Die Zeichen tragen auf den Zielknöpfen die ganze Bedeutung — dort steht kein
   Text daneben, nur der Tooltip. Deshalb bewusst die farbigen Emoji-Formen:
   die schmalen Textvarianten (⚔ ⚰ als Strichzeichnung) sind bei 15 px kaum
   auseinanderzuhalten. Der Stern bleibt einfarbig — er steht in dieser App
   überall für den Commander. */
const ZONEN = [
  { key: "cmd",   icon: "&#9733;",            gespeichert: false, nurCommander: true },
  { key: "field", icon: "&#9876;&#xFE0F;",    gespeichert: true },
  { key: "grave", icon: "&#9904;&#xFE0F;",    gespeichert: true },
  { key: "exile", icon: "&#128683;",          gespeichert: true },
  { key: "hand",  icon: "&#9995;",            gespeichert: true },
  { key: "lib",   icon: "&#128218;",          gespeichert: false },
];
const zoneDef = k => ZONEN.find(z => z.key === k);

let ZONE_OFFEN = "hand";        // welche Zone gerade aufgeklappt ist
let zoneHoverT = null;          // entprellt das Aufklappen per Maus
let zoneSperre = 0;             // bis wann Hover ignoriert wird (Layout beruhigen)
let libAlle = false;            // „ganze Bibliothek anzeigen" ein/aus

// Lesbarer Kartenname: sonst wie in der App der gedruckte Name, aber für
// Phyrexianisch (unlesbare Glyphen) der englische Name.
const trkName = c => ((c.lang === "ph" ? c.name : (c.disp || c.name)) || c.name || "");

const trkDeck  = () => (DECKS || []).find(d => d.id === meinSpieler()?.deck_id);
const trkTotal = id => trkDeck()?.entries?.find(e => e.cardId === id)?.qty || 0;
const zStand   = id => SESSION_ZONEN[id] || {};
const zVon     = (id, k) => zStand(id)[k] || 0;
/* Rest = Deckmenge minus alles, was in einer gespeicherten Zone liegt. */
const zRest    = id => Math.max(0, trkTotal(id) - zVon(id, "hand") - zVon(id, "field")
                                 - zVon(id, "grave") - zVon(id, "exile"));
/* Commander (erster und Partner): ihr Rest liegt in der Kommandozone, nicht in
   der Bibliothek — dort starten sie und dorthin kehren sie zurück. */
const istCmdKarte = id => { const d = trkDeck(); return !!d && (d.main_card_id === id || d.second_card_id === id); };
const hatCmdZone  = () => { const d = trkDeck(); return !!(d && (d.main_card_id || d.second_card_id)); };

function zAnzahl(id, zone) {
  if (zone === "lib") return istCmdKarte(id) ? 0 : zRest(id);
  if (zone === "cmd") return istCmdKarte(id) ? zRest(id) : 0;
  return zVon(id, zone);
}

/* Die sichtbaren Zonen: die Kommandozone nur, wenn das Deck einen Commander hat. */
const sichtbareZonen = () => ZONEN.filter(z => !z.nurCommander || hatCmdZone());

/* Wohin eine Karte aus ihrer Zone wandern darf: alle anderen Zonen, aber die
   Bibliothek nur für normale Karten und die Kommandozone nur für Commander. */
const zieleFuer = (id, von) => sichtbareZonen().map(z => z.key).filter(k =>
  k !== von && (k === "cmd" ? istCmdKarte(id) : k === "lib" ? !istCmdKarte(id) : true));

/* Karten einer Zone, je Karte einmal mit ihrer Anzahl. Alphabetisch, damit die
   Reihenfolge beim Hin- und Herschieben nicht springt. */
function zoneKarten(zone) {
  const deck = trkDeck();
  if (!deck) return [];
  return (deck.entries || [])
    .map(e => ({ card: CARDS.find(c => c.id === e.cardId), n: zAnzahl(e.cardId, zone) }))
    .filter(x => x.card && x.n > 0)
    .sort((a, b) => trkName(a.card).localeCompare(trkName(b.card)));
}
const zoneSumme = zone => zoneKarten(zone).reduce((s, x) => s + x.n, 0);

/* ---- Schlachtfeld: die einzelnen Exemplare ---------------------------
   Überall sonst genügt eine Zahl je Karte — im Friedhof ist eine Karte eine
   Karte. Auf dem Feld nicht: von zwei gleichen Kreaturen kann eine getappt
   sein und die andere zwei Marken tragen. Deshalb führt allein diese Zone eine
   Liste je Exemplar, `fs`:

       [{t:1, c:0}, {t:0, c:2}]   →  eine getappt, eine mit +2/+2

   Die Liste ist genau so lang wie `field`. Weicht sie ab — Karte anderswohin
   geschoben, Datenbank älter als die App —, rückt feldListe() sie beim Lesen
   zurecht, statt sich auf eine Zusicherung zu verlassen, die niemand erzwingt.
   Sind alle Exemplare ungetappt und ohne Marken, entfällt `fs` ganz; der
   Regelfall kostet also kein Byte. */
const feldStandard = fs => fs.every(x => !x.t && !x.c);

function feldListe(id) {
  const n = zVon(id, "field");
  const roh = Array.isArray(zStand(id).fs) ? zStand(id).fs : [];
  const fs = roh.slice(0, n).map(x => ({ t: x?.t ? 1 : 0, c: Math.max(0, x?.c | 0) }));
  while (fs.length < n) fs.push({ t: 0, c: 0 });   // neu dazugekommene: ungetappt, ohne Marken
  return fs;
}

/* Gleiche Exemplare zu einem Stapel zusammenfassen: fünf ungetappte Wälder sind
   ein Bild mit „×5", tappt man einen, spaltet sich „×4" und „×1 getappt" ab.
   `idx` zeigt auf das erste Exemplar des Stapels — daran hängen die Aktionen. */
function feldStapel(id) {
  const gruppen = new Map();
  feldListe(id).forEach((x, i) => {
    const k = x.t + "|" + x.c;
    if (!gruppen.has(k)) gruppen.set(k, { t: x.t, c: x.c, n: 0, idx: i });
    gruppen.get(k).n++;
  });
  return [...gruppen.values()].sort((a, b) => a.t - b.t || b.c - a.c);
}

/* Exemplarliste zurückschreiben (ohne Neuzeichnen — die Aufrufer tun das). */
function feldSetzen(id, fs) {
  const st = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0, ...(SESSION_ZONEN[id] || {}) };
  if (fs.length && !feldStandard(fs)) st.fs = fs; else delete st.fs;
  SESSION_ZONEN[id] = st;
  return st;
}

/* Ein einzelnes Exemplar tappen/enttappen bzw. seine Marken ändern. */
function feldTap(cardId, idx) {
  const fs = feldListe(cardId);
  if (!fs[idx]) return;
  fs[idx].t = fs[idx].t ? 0 : 1;
  feldSetzen(cardId, fs); renderZonen(); zoneSchreiben(cardId);
}
function feldMarke(cardId, idx, delta) {
  const fs = feldListe(cardId);
  if (!fs[idx]) return;
  fs[idx].c = Math.max(0, Math.min(999, fs[idx].c + delta));
  feldSetzen(cardId, fs); renderZonen(); zoneSchreiben(cardId);
}

/* Enttappen-Schritt: alles auf dem eigenen Feld auf einmal aufrichten. */
function feldAlleEnttappen() {
  let geaendert = false;
  zoneKarten("field").forEach(({ card }) => {
    const fs = feldListe(card.id);
    if (!fs.some(x => x.t)) return;
    fs.forEach(x => x.t = 0);
    feldSetzen(card.id, fs); zoneSchreiben(card.id); geaendert = true;
  });
  if (geaendert) renderZonen();
}

/* ---- Verschieben ---------------------------------------------------- */
/* Ein Exemplar von einer Zone in die andere. Die Bibliothek und die
   Kommandozone speichern nichts — sie wachsen und schrumpfen als Rest von
   selbst, wenn die Gegenseite sich ändert.
   `idx` sagt beim Verlassen des Feldes, WELCHES Exemplar geht — sonst nähme
   eine sterbende Kreatur womöglich die Marken ihrer Zwillingsschwester mit. */
function zoneMove(cardId, von, nach, idx) {
  if (von === nach || zAnzahl(cardId, von) < 1) return;
  const st = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0, ...(SESSION_ZONEN[cardId] || {}) };
  const fs = feldListe(cardId);
  if (von === "field") fs.splice(Number.isInteger(+idx) && fs[idx] ? +idx : 0, 1);
  if (nach === "field") fs.push({ t: 0, c: 0 });   // frisch ausgespielt: ungetappt, ohne Marken
  if (zoneDef(von)?.gespeichert)  st[von]  -= 1;
  if (zoneDef(nach)?.gespeichert) st[nach] += 1;
  // Jedes Wirken aus der Kommandozone erhöht die Commander-Steuer um zwei Mana.
  if (von === "cmd" && nach === "field") st.cast += 1;
  if (fs.length && !feldStandard(fs)) st.fs = fs; else delete st.fs;
  if (st.hand || st.field || st.grave || st.exile || st.cast) SESSION_ZONEN[cardId] = st;
  else delete SESSION_ZONEN[cardId];
  renderZonen();
  zoneSchreiben(cardId);
}

/* Commander-Steuer von Hand nachstellen (verzählt, Regeländerung am Tisch). */
function cmdSteuer(cardId, delta) {
  const st = { hand: 0, field: 0, grave: 0, exile: 0, cast: 0, ...(SESSION_ZONEN[cardId] || {}) };
  st.cast = Math.max(0, st.cast + delta);
  if (st.hand || st.field || st.grave || st.exile || st.cast) SESSION_ZONEN[cardId] = st;
  else delete SESSION_ZONEN[cardId];
  renderZonen();
  zoneSchreiben(cardId);
}

/* Eine Zeile hält alle Zonen einer Karte; ist überall 0, verschwindet sie. */
function zoneSchreiben(cardId) {
  clearTimeout(playedTimers[cardId]);
  playedTimers[cardId] = setTimeout(async () => {
    delete playedTimers[cardId];
    const st = zStand(cardId);
    const leer = !(st.hand || st.field || st.grave || st.exile || st.cast);
    const zeile = { session_id: SESSION.id, user_id: USER.id, card_id: cardId, qty: 0 };
    if (ZONEN_SPALTEN) Object.assign(zeile, {
      hand: st.hand || 0, field: st.field || 0, graveyard: st.grave || 0,
      exile: st.exile || 0, cast_count: st.cast || 0,
      field_state: st.fs || [],
    });
    try {
      const { error } = leer
        ? await sb.from("session_played").delete()
            .eq("session_id", SESSION.id).eq("user_id", USER.id).eq("card_id", cardId)
        : await sb.from("session_played").upsert(zeile, { onConflict: "session_id,user_id,card_id" });
      if (error) throw error;
    } catch (e) {
      // Fehlen die Spalten, ist das Schema älter als die App: die Partie läuft
      // im Browser weiter, gespeichert wird sie erst nach der Migration.
      if (ZONEN_SPALTEN && fehltZonenSpalte(e)) { ZONEN_SPALTEN = false; toast(t("toast.columnMissing")); return; }
      toast(dbErr(e));
    }
  }, 350);
}

async function trackerReset() {
  SESSION_ZONEN = {};
  // Noch offene Einzelschreiber verwerfen, sonst tragen sie ihre Karte wieder ein.
  Object.keys(playedTimers).forEach(k => { clearTimeout(playedTimers[k]); delete playedTimers[k]; });
  renderZonen();
  try { await sb.from("session_played").delete().eq("session_id", SESSION.id).eq("user_id", USER.id); }
  catch (e) { toast(dbErr(e)); }
}

/* ---- Aufbau ---------------------------------------------------------
   Zwei Anordnungen derselben Zonen:

   • Die SPIELMATTE ab MAT_AB Pixeln Breite — die Felder liegen wie auf der
     offiziellen Matte: Schlachtfeld groß links, Länder als Streifen darunter,
     rechts die schmalen Spalten (Steuer, Kommandozone, Bibliothek, Exil) und
     ganz rechts Lebenspunkte und Friedhof. Die Hand liegt als Fächer darunter,
     da, wo man sie am Tisch hält.
   • Darunter das AKKORDEON — eine Zone auf einmal. Auf einem hochkant
     gehaltenen Handy blieben von den schmalen Mattenspalten rund 50 px übrig;
     eine Kartenminiatur ist 62 px breit. Die Matte ist dort schlicht nicht
     bedienbar, deshalb wird sie nicht gezeigt.

   Gemeinsam ist beiden alles außer der Anordnung: dieselben Zonen, dieselben
   Zielknöpfe, derselbe Zustand. */
const MAT_AB = 820;   // ab hier passt die Matte (Handy quer erreicht das)
let MAT_AN = matchMedia(`(min-width:${MAT_AB}px)`).matches;
/* Wechselt der Schirm über die Schwelle (Gerät gedreht, Fenster gezogen), die
   Ansicht einmal neu bauen — die beiden Anordnungen unterscheiden sich zu sehr
   für reines CSS. Steht hier und nicht weiter oben: MAT_AB muss vorher stehen,
   sonst liefe die Zeile beim Laden in die temporale Totzone. */
matchMedia(`(min-width:${MAT_AB}px)`).addEventListener("change", e => {
  MAT_AN = e.matches;
  if (SESSION && $(".view.on")?.id === "v-session") renderSession();
});

function deckTrackerHtml() {
  const deck = trkDeck();
  if (!deck) return "";
  if (!sichtbareZonen().some(z => z.key === ZONE_OFFEN)) ZONE_OFFEN = "hand";
  return `<div class="card" id="trk-card">
    <div class="row" style="align-items:center;justify-content:space-between">
      <h3 style="margin:0">${esc(t("sess.trackerTitle", { deck: deck.name }))}</h3>
      <div style="flex:none"><button class="btn ghost sm" id="trk-reset">${esc(t("sess.trackerReset"))}</button></div>
    </div>
    ${querHinweisHtml()}<div class="${MAT_AN ? "mat" : "zonen"}" id="zonen">${zonenInnerHtml()}</div>
  </div>`;
}

/* Hochkant auf einem Gerät, das quer breit genug WÄRE: ein Hinweis, kein Knopf.
   Drehen kann eine Webseite das Gerät nicht — screen.orientation.lock() gibt es
   nur im Vollbild und nur auf Android, auf iOS gar nicht. Ein Knopf, der dort
   still nichts täte, wäre schlechter als der Satz. */
function querHinweisHtml() {
  const laengsteSeite = Math.max(screen?.width || 0, screen?.height || 0);
  if (laengsteSeite < MAT_AB || innerWidth > innerHeight) return "";
  return `<div class="quer-hinweis">&#8635; ${esc(t("mat.rotateHint"))}</div>`;
}

/* Die Matte. Jedes Feld ist derselbe Zonenkorb wie im Akkordeon, nur ohne
   Kopfzeile zum Aufklappen — hier ist alles gleichzeitig offen. */
function matInnerHtml() {
  const feld = (key, titel, inhalt, extra = "") => `
    <section class="mat-feld${extra}" data-zone="${esc(key)}">
      <div class="mat-titel">${zoneDef(key)?.icon || ""} ${esc(titel)}
        <span class="mat-n">${inhalt.n}</span></div>
      <div class="mat-korb">${inhalt.html}</div>
    </section>`;

  // Schlachtfeld ohne Länder — die stehen im eigenen Streifen darunter.
  const feldKarten = zoneKarten("field");
  const bleibend = feldKarten.filter(x => !istLand(x.card));
  const laender  = feldKarten.filter(x => istLand(x.card));
  const stapelHtml = liste => liste.length
    ? `<div class="zone-gitter">${liste.flatMap(({ card }) => feldStapel(card.id)
        .map(s => zoneKarteHtml(card, "field", s.n, s))).join("")}</div>`
    : `<div class="zone-leer">${esc(t("zone.empty"))}</div>`;
  const summe = liste => liste.reduce((s, x) => s + x.n, 0);

  const cmdKarte = zoneKarten("cmd")[0]?.card;
  const steuer = cmdKarte ? (zStand(cmdKarte.id).cast || 0) : 0;
  const getappt = feldKarten.some(({ card }) => feldListe(card.id).some(x => x.t));

  return `
    <div class="mat-links">
      ${feld("field", t("zone.field"), { n: summe(bleibend), html:
        `${getappt ? `<div class="feld-werkzeug"><button class="btn ghost sm" id="feld-enttappen"
            title="${esc(t("zone.untapAllTitle"))}">&#8635; ${esc(t("zone.untapAll"))}</button></div>` : ""}
         ${stapelHtml(bleibend)}` }, " mat-gross")}
      ${feld("field", t("mat.lands"), { n: summe(laender), html: stapelHtml(laender) }, " mat-laender")}
    </div>
    <div class="mat-mitte">
      <section class="mat-feld mat-steuer">
        <div class="mat-titel">${esc(t("mat.tax"))}</div>
        <div class="mat-korb">${cmdKarte
          ? `<button class="mat-steuerwert" data-steuer="${esc(cmdKarte.id)}" data-d="-1"
               title="${esc(t("sess.cmdTaxTitle", { mana: steuer * 2, n: steuer }))}">+${steuer * 2}</button>`
          : `<span class="mat-steuerwert leer">&ndash;</span>`}</div>
      </section>
      ${feld("cmd", t("zone.cmd"), { n: zoneSumme("cmd"), html: zoneKorbHtml("cmd") })}
      ${feld("lib", t("zone.lib"), { n: zoneSumme("lib"), html: zoneKorbHtml("lib") }, " mat-lib")}
      ${feld("exile", t("zone.exile"), { n: zoneSumme("exile"), html: zoneKorbHtml("exile") })}
    </div>
    <div class="mat-rechts">
      <section class="mat-feld mat-leben">
        <div class="mat-titel">${esc(t("mat.life"))}</div>
        <div class="mat-korb"><div class="sp-grid schmal">${SESSION_PLAYERS.map(spielerKachelHtml).join("")}</div></div>
      </section>
      ${feld("grave", t("zone.grave"), { n: zoneSumme("grave"), html: zoneKorbHtml("grave") })}
    </div>
    ${feld("hand", t("zone.hand"), { n: zoneSumme("hand"), html: zoneKorbHtml("hand") }, " mat-hand")}
    ${SPK_SPALTE ? `<section class="mat-feld mat-vorschau">
      <div class="mat-titel">${esc(t("spk.slot"))}</div>
      <div class="spk" id="spk-feld"><div class="spk-leer">${esc(t("spk.slotEmpty"))}</div></div>
    </section>` : ""}`;
}

function zonenInnerHtml() {
  if (MAT_AN) return matInnerHtml();
  return sichtbareZonen().map(z => `
    <section class="zone${z.key === ZONE_OFFEN ? " offen" : ""}" data-zone="${z.key}">
      ${zoneKopfHtml(z)}
      <div class="zone-korb">${zoneKorbHtml(z.key)}</div>
    </section>`).join("");
}

/* Kopfzeile: immer sichtbar, auch zugeklappt. Die Miniaturen verraten auf einen
   Blick, was in der Zone liegt — bei der Bibliothek wären 90 Bilder sinnlos,
   dort steht nur die Zahl. */
function zoneKopfHtml(z) {
  const n = zoneSumme(z.key);
  const thumbs = z.key === "lib" ? "" : zoneKarten(z.key).flatMap(x =>
    Array.from({ length: Math.min(x.n, 3) }, () => x.card)).slice(0, 8)
    .map(c => c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : "").join("");
  return `<div class="zone-kopf" tabindex="0" role="button" aria-expanded="${z.key === ZONE_OFFEN}">
    <span class="zone-icon">${z.icon}</span>
    <span class="zone-name">${esc(t("zone." + z.key))}</span>
    <span class="zone-n${n ? "" : " null"}">${n}</span>
    <span class="zone-thumbs">${thumbs}</span>
  </div>`;
}

function zoneKorbHtml(zone) {
  if (zone === "hand") return zoneHandHtml();
  if (zone === "lib")  return zoneLibHtml();
  const karten = zoneKarten(zone);
  if (!karten.length) return `<div class="zone-leer">${esc(t("zone.empty"))}</div>`;
  if (zone === "field") return zoneFeldHtml(karten);
  return `<div class="zone-gitter">${karten.map(x => zoneKarteHtml(x.card, zone, x.n)).join("")}</div>`;
}

/* Das Schlachtfeld zeigt Stapel gleicher Exemplare: gleiche Karte, gleicher
   Tapp-Zustand, gleiche Marken. „Alle enttappen" steht nur da, wenn überhaupt
   etwas getappt ist — der Enttappen-Schritt in einem Klick. */
function zoneFeldHtml(karten) {
  const getappt = karten.some(({ card }) => feldListe(card.id).some(x => x.t));
  // Länder stehen hinten, unter eigener Überschrift — dieselbe Zweiteilung wie
  // in der Matte, wo sie ihren eigenen Streifen haben. Eine Zone bleibt es
  // trotzdem: eine Karte wandert nicht „aufs Land", sondern aufs Schlachtfeld.
  const gitter = liste => `<div class="zone-gitter">${liste.flatMap(({ card }) =>
    feldStapel(card.id).map(s => zoneKarteHtml(card, "field", s.n, s))).join("")}</div>`;
  const bleibend = karten.filter(x => !istLand(x.card));
  const laender  = karten.filter(x => istLand(x.card));
  return `${getappt ? `<div class="feld-werkzeug"><button class="btn ghost sm" id="feld-enttappen"
      title="${esc(t("zone.untapAllTitle"))}">&#8635; ${esc(t("zone.untapAll"))}</button></div>` : ""}
    ${bleibend.length ? gitter(bleibend) : ""}
    ${laender.length ? `<div class="feld-trenner">${esc(t("mat.lands"))}
      <span class="feld-trenner-n">${laender.reduce((s, x) => s + x.n, 0)}</span></div>${gitter(laender)}` : ""}`;
}

/* Eine Karte in Feld/Friedhof/Exil/Kommandozone: ein Bild je KARTE mit Anzahl —
   anders als die Hand, wo jedes Exemplar einzeln liegt, weil man sie einzeln
   hält. Drei Wälder im Friedhof sind ein Bild mit „×3".
   Auf dem Feld ist `st` der Stapel (getappt + Marken + Startindex); dort steht
   das Bild gedreht, wenn getappt, und trägt seine Marken als Abzeichen. */
function zoneKarteHtml(c, zone, n, st) {
  const nm = trkName(c);
  const steuer = zone === "cmd" ? (zStand(c.id).cast || 0) : 0;
  const idx = st ? st.idx : 0;
  return `<div class="zk${st?.t ? " getappt" : ""}" tabindex="0" data-id="${esc(c.id)}" data-zone="${esc(zone)}"
       data-idx="${idx}" data-spk="${esc(c.id)}" data-spk-zone="${esc(zone)}"
       title="${esc(nm)}${st?.t ? " · " + t("zone.tapped") : ""}">
    ${c.img ? `<img src="${esc(c.img)}" alt="${esc(nm)}" loading="lazy">`
            : `<div class="zk-ohnebild">${esc(nm)}</div>`}
    ${n > 1 ? `<span class="zk-n">&times;${n}</span>` : ""}
    ${st?.c ? `<span class="zk-marke" title="${esc(t("zone.counters", { n: st.c }))}">+${st.c}/+${st.c}</span>` : ""}
    ${zone === "cmd" && !MAT_AN ? `<button class="zk-steuer" data-steuer="${esc(c.id)}" data-d="-1"
         title="${esc(t("sess.cmdTaxTitle", { mana: steuer * 2, n: steuer }))}">+${steuer * 2}</button>` : ""}
    ${zone === "field" ? `<div class="zk-akt"><div class="zk-akt-reihe">
        <button class="btn ghost sm" data-tap="${esc(c.id)}" data-idx="${idx}"
          title="${esc(st?.t ? t("zone.untapTitle") : t("zone.tapTitle"))}">&#8635;</button>
        <button class="btn ghost sm" data-marke="${esc(c.id)}" data-idx="${idx}" data-d="1"
          title="${esc(t("zone.counterAdd"))}">&plus;</button>
        ${st?.c ? `<button class="btn ghost sm" data-marke="${esc(c.id)}" data-idx="${idx}" data-d="-1"
          title="${esc(t("zone.counterRemove"))}">&minus;</button>` : ""}
      </div><div class="zk-akt-reihe">${zoneAktHtml(c.id, zone, idx)}</div></div>` : ""}
  </div>`;
}

/* Die Zielknöpfe einer Karte: für jede erlaubte Zone einer, mit ihrem Zeichen.
   Der Name steht im Tooltip — sechs beschriftete Knöpfe passten unter keine
   Karte, und die Zeichen stehen daneben in jeder Kopfzeile. */
function zoneAktHtml(id, von, idx) {
  return zieleFuer(id, von).map(k => `<button class="btn ghost sm" data-move="${esc(id)}"
    data-von="${esc(von)}" data-nach="${esc(k)}" data-idx="${idx || 0}"
    title="${esc(t("zone.moveTo", { zone: t("zone." + k) }))}">${zoneDef(k).icon}</button>`).join("");
}

/* ---- Hand: aufgefächert wie in der echten Hand ---------------------- */
/* Je Exemplar eine Karte. Der Fächer entsteht aus zwei Größen, die mit der
   Kartenzahl schrumpfen: dem Winkel je Karte und dem Versatz zur nächsten.
   Beides ist gedeckelt, damit sieben Karten großzügig liegen und zwanzig
   trotzdem in den Kasten passen. Gerechnet wird hier, zusammengesetzt in CSS
   (--rot dreht, --dy senkt die Ränder ab) — so behält der Hover-Zustand den
   Grundwinkel und hebt die Karte nur an. */
function zoneHandHtml() {
  const karten = zoneKarten("hand").flatMap(x => Array.from({ length: x.n }, () => x.card));
  if (!karten.length) return `<div class="zone-leer">${esc(t("zone.emptyHand"))}</div>`;

  const n = karten.length;
  const spanne = n > 1 ? Math.min(44, n * 7) : 0;          // Gesamtwinkel des Fächers
  const schritt = n > 1 ? spanne / (n - 1) : 0;
  // Sichtbarer Anteil je Karte, gemessen in KARTENBREITEN statt in Pixeln: die
  // Breite steckt als --hk-b im CSS und schrumpft auf schmalen Schirmen mit,
  // der Fächer bleibt dabei von selbst stimmig.
  const anteil = n > 1 ? Math.min(0.54, Math.max(0.17, 4.1 / (n - 1))) : 1;
  const bogen = 18;                                        // wie tief die Ränder hängen
  const fan = karten.map((c, i) => {
    const rel = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;   // −1 … +1
    const rot = (-spanne / 2 + i * schritt).toFixed(2);
    const dy = (rel * rel * bogen).toFixed(1);
    const nm = trkName(c);
    return `<div class="hand-karte" tabindex="0" style="--rot:${rot}deg;--dy:${dy}px;--z:${i + 1};${
      i ? `margin-left:calc(var(--hk-b,104px) * ${(anteil - 1).toFixed(3)})` : ""}"
         data-spk="${esc(c.id)}" data-spk-zone="hand" title="${esc(nm)}">
      ${c.img ? `<img src="${esc(c.img)}" alt="${esc(nm)}" loading="lazy">`
              : `<div class="hand-ohnebild">${esc(nm)}</div>`}
      <div class="hand-akt">${zoneAktHtml(c.id, "hand")}</div>
    </div>`;
  }).join("");
  return `<div class="hand-fan">${fan}</div>`;
}

/* ---- Bibliothek: suchen statt scrollen ------------------------------
   Am Tisch ziehst du physisch und musst der App nur sagen, WELCHE Karte es
   war — dafür ist ein Suchfeld der kürzeste Weg. Die ganze Liste steht
   trotzdem einen Klick entfernt, wenn man sehen will, was noch drin ist. */
function zoneLibHtml() {
  const rest = zoneKarten("lib");
  const gesamt = rest.reduce((s, x) => s + x.n, 0);
  const f = (libFilter() || "").trim().toLowerCase();
  const treffer = f ? rest.filter(x => trkName(x.card).toLowerCase().includes(f))
                    : (libAlle ? rest : []);
  const liste = treffer.length
    ? treffer.map(x => libZeileHtml(x.card, x.n)).join("")
    : `<div class="zone-leer">${esc(f ? t("lib.noHits") : t("lib.hint"))}</div>`;
  return `<div class="lib-suchzeile">
      <input type="text" id="lib-suche" value="${esc(libFilter())}" placeholder="${esc(t("sess.trackerSearch"))}">
    </div>
    <div class="lib-liste">${liste}</div>
    ${f ? "" : `<button class="btn ghost sm lib-alle" id="lib-alle">${
      esc(libAlle ? t("lib.hideAll") : t("lib.showAll", { n: gesamt }))}</button>`}`;
}
const libFilter = () => $("#lib-suche")?.value || "";

/* Eine Bibliothekszeile: NUR Name und Anzahl.
   Alles andere — Bild, Manakosten, Typ, Regeltext und die Zielknöpfe — steht in
   der Kartenansicht, die beim Zeigen aufgeht und beim Klick stehen bleibt. Eine
   Bibliothek hat schnell 90 Zeilen; jede davon mit Bild, Set und vier Knöpfen
   zu bestücken machte sie in der schmalen Mattenspalte unlesbar und auf dem
   Handy unbedienbar. Der Name ist das, wonach man sucht — der Rest ist einen
   Zeiger entfernt. */
function libZeileHtml(c, n) {
  return `<div class="lib-zeile" data-id="${esc(c.id)}" data-spk="${esc(c.id)}" tabindex="0"
       role="button" title="${esc(t("spk.openHint"))}">
    <span class="lib-nm">${esc(trkName(c))}</span>
    <span class="lib-n">${n}</span>
  </div>`;
}

/* ---- Kartenansicht für den Spielmodus -------------------------------
   Eine eigene Ansicht, nicht die aus der Sammlung: am Tisch zählt, was auf der
   Karte steht — Bild, Kosten, Typ, Regeltext. Preis, Preisverlauf, Zustand und
   Deckzugehörigkeit sind hier ohne Belang und stünden nur im Weg.

   Zwei Zustände: beim Zeigen schwebt sie neben dem Zeiger und ist für Klicks
   durchlässig; beim Klick friert sie an Ort und Stelle ein, wird bedienbar und
   trägt dann die Zielknöpfe. So kostet Nachschlagen nichts und Verschieben
   einen zweiten Klick — an einer Stelle, an der man die Karte gerade ohnehin
   ansieht. */
/* Ab dieser Breite hat die Matte eine eigene Spalte für die Kartenansicht: Was
   man anzeigt, erscheint immer an DERSELBEN Stelle rechts, statt als Fenster
   über dem Spielfeld. Darunter (und im Akkordeon) schwebt sie wie bisher am
   Zeiger — auf einem Handy gibt es für eine feste Spalte keinen Platz. */
const SPK_SPALTE_AB = 1200;
let SPK_SPALTE = matchMedia(`(min-width:${SPK_SPALTE_AB}px)`).matches;
matchMedia(`(min-width:${SPK_SPALTE_AB}px)`).addEventListener("change", e => {
  SPK_SPALTE = e.matches;
  if (SESSION && $(".view.on")?.id === "v-session") renderSession();
});

let spkEl = null, spkFest = null, spkTimer = null;
/* Die feste Spalte, falls die Matte sie gerade hat — sonst das schwebende
   Fenster. Beide zeigen dasselbe, nur an anderem Ort. */
const spkFeldEl = () => (MAT_AN && SPK_SPALTE) ? $("#spk-feld") : null;

function spkHuelle() {
  if (!spkEl) {
    spkEl = document.createElement("div");
    spkEl.className = "spk";
    document.body.appendChild(spkEl);
    // Die angeheftete Ansicht hängt am body, nicht in #zonen — die Delegation
    // dort greift also nicht, sie braucht ihren eigenen Klickfänger.
    spkEl.onclick = e => {
      const mv = e.target.closest("[data-move]");
      if (mv) { versteckeSpielKarte(true); return zoneMove(mv.dataset.move, mv.dataset.von, mv.dataset.nach, mv.dataset.idx); }
      const tap = e.target.closest("[data-tap]");
      if (tap) { versteckeSpielKarte(true); return feldTap(tap.dataset.tap, +tap.dataset.idx); }
      const mk = e.target.closest("[data-marke]");
      if (mk) { versteckeSpielKarte(true); return feldMarke(mk.dataset.marke, +mk.dataset.idx, parseInt(mk.dataset.d, 10)); }
      if (e.target.closest("[data-spk-zu]")) versteckeSpielKarte(true);
    };
  }
  return spkEl;
}

function spielKarteHtml(c, zone, fest, idx) {
  // Scryfall-Bild-URLs tragen die Größe im Pfad — aus small wird normal.
  const gross = (c.img || "").replace("/small/", "/normal/");
  // Der Regeltext steht bereits auf dem Bild — ihn darunter zu wiederholen war
  // doppelt gemoppelt. Was bleibt, ist das, was auf dem Bild klein oder gar
  // nicht zu lesen ist: die Manakosten, der fremdsprachige Name und der Typ.
  const marken = zone === "field" ? `<div class="zk-akt-reihe">
      <button class="btn ghost sm" data-tap="${esc(c.id)}" data-idx="${idx || 0}"
        title="${esc(t("zone.tapTitle"))}">&#8635;</button>
      <button class="btn ghost sm" data-marke="${esc(c.id)}" data-idx="${idx || 0}" data-d="1"
        title="${esc(t("zone.counterAdd"))}">&plus;</button>
      <button class="btn ghost sm" data-marke="${esc(c.id)}" data-idx="${idx || 0}" data-d="-1"
        title="${esc(t("zone.counterRemove"))}">&minus;</button>
    </div>` : "";
  return `${fest ? `<button class="spk-zu" data-spk-zu title="${esc(t("dlg.close"))}">&times;</button>` : ""}
    ${gross ? `<img class="spk-bild" src="${esc(gross)}" alt="">` : ""}
    <div class="spk-text">
      ${faceTopHtml(c)}
      ${(c.printed_type_line || c.type_line)
        ? `<div class="hint" style="margin-top:2px">${esc(c.printed_type_line || c.type_line)}</div>` : ""}
    </div>
    ${fest ? `<div class="spk-akt">${marken}<div class="zk-akt-reihe">${
                zoneAktHtml(c.id, zone, idx)}</div></div>`
           : `<div class="spk-tipp">${esc(t("spk.clickHint"))}</div>`}`;
}

function zeigeSpielKarte(id, x, y, zone, fest, idx) {
  const c = CARDS.find(k => k.id === id);
  if (!c) return;
  // Gibt es die feste Spalte, geht alles dorthin — kein Fenster über dem Feld.
  const feld = spkFeldEl();
  if (feld) {
    feld.innerHTML = spielKarteHtml(c, zone, fest, idx);
    feld.classList.toggle("fest", !!fest);
    spkFest = fest ? { id, zone } : null;
    return;
  }
  const el = spkHuelle();
  el.innerHTML = spielKarteHtml(c, zone, fest, idx);
  el.classList.toggle("fest", !!fest);
  el.style.display = "block";
  spkFest = fest ? { id, zone } : null;
  // Erst einblenden, dann messen und in den Schirm rücken.
  el.style.left = "0px"; el.style.top = "0px";
  const r = el.getBoundingClientRect();
  let l = x + 18, o = y + 12;
  if (l + r.width > innerWidth - 8) l = Math.max(8, x - r.width - 18);
  if (o + r.height > innerHeight - 8) o = Math.max(8, innerHeight - r.height - 8);
  el.style.left = l + "px"; el.style.top = o + "px";
}

/* Kartenansicht aus einem angeklickten Element heraus öffnen — Zone und
   Exemplar stehen am Element, damit sie die richtigen Knöpfe trägt. */
function spkAusElement(el) {
  const r = el.getBoundingClientRect();
  zeigeSpielKarte(el.dataset.spk, r.right, r.top, el.dataset.spkZone || "lib", true, +el.dataset.idx || 0);
}

function versteckeSpielKarte(auchFest) {
  clearTimeout(spkTimer);
  if (spkFest && !auchFest) return;   // Angeheftetes bleibt stehen
  spkFest = null;
  // Die feste Spalte behält die zuletzt gezeigte Karte: sie bei jedem
  // Mausaustritt zu leeren, ließe die Fläche im Spiel dauernd flackern. Nur
  // die Knöpfe verschwinden, denn die gehören zum Festhalten.
  const feld = spkFeldEl();
  if (feld) { feld.classList.remove("fest"); feld.querySelector(".spk-akt")?.remove();
              feld.querySelector(".spk-zu")?.remove(); return; }
  if (spkEl) { spkEl.style.display = "none"; spkEl.classList.remove("fest"); }
}

/* ---- Zeichnen und Verdrahten ---------------------------------------- */
function renderZonen() {
  // Die Vorschauen hängen an Elementen, die es gleich nicht mehr gibt.
  hideHover(); versteckeCmdHover(); versteckeSpielKarte(true);
  // Und der Fokus auch: eine angehobene Karte bleibt sonst über :focus-within
  // angehoben, obwohl der Zeiger längst woanders ist — genau das Bild, in dem
  // mehrere Karten gleichzeitig „aufgenommen" aussehen.
  if ($("#zonen")?.contains(document.activeElement)) document.activeElement.blur();
  const el = $("#zonen");
  if (!el) return;
  const suchtext = libFilter(), fokus = document.activeElement?.id === "lib-suche";
  el.className = MAT_AN ? "mat" : "zonen";
  el.innerHTML = zonenInnerHtml();
  wireSpielerKacheln();
  const suche = $("#lib-suche");
  if (suche) { suche.value = suchtext; if (fokus) { suche.focus(); suche.selectionStart = suche.selectionEnd = suchtext.length; } }
  wireZonenHover();
}

/* Aufklappen: immer genau eine Zone. Nach dem Wechsel verschiebt sich das
   Layout unter dem Zeiger — deshalb eine kurze Sperre, sonst klappt die Zone
   weiter, über der der Zeiger dann zufällig landet. */
function zoneOeffnen(key, sofort) {
  if (!sofort && Date.now() < zoneSperre) return;
  if (ZONE_OFFEN === key) return;
  ZONE_OFFEN = key;
  zoneSperre = Date.now() + 320;
  $$("#zonen .zone").forEach(s => {
    const an = s.dataset.zone === key;
    s.classList.toggle("offen", an);
    s.querySelector(".zone-kopf")?.setAttribute("aria-expanded", String(an));
  });
}

function wireZonenHover() {
  $$("#zonen .zone-kopf").forEach(k => {
    const key = k.closest(".zone").dataset.zone;
    // Klick/Tipp öffnet sofort — der einzige Weg auf Geräten ohne Maus.
    k.onclick = () => zoneOeffnen(key, true);
    k.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); zoneOeffnen(key, true); } };
    if (!HOVER_OK) return;
    k.onmouseenter = () => { clearTimeout(zoneHoverT); zoneHoverT = setTimeout(() => zoneOeffnen(key), 140); };
    k.onmouseleave = () => clearTimeout(zoneHoverT);
  });
  if (!HOVER_OK) return;
  // Kartenvorschau wie überall in der Spielrunde: Bild + Name schwebend.
  // JEDE Karte behält ihren Hover — Zonenkacheln sind teils nur 48 px breit,
  // da erkennt man ohne Vorschau nicht, welche Karte man vor sich hat, und
  // müsste sich durchklicken. Überall dieselbe volle Kartenansicht statt des
  // früheren kleinen Bild-plus-Name; in der Matte landet sie in der festen
  // Spalte, sonst schwebt sie am Zeiger.
  $$("#zonen [data-spk]").forEach(el => {
    const id = el.dataset.spk, zone = el.dataset.spkZone || "lib", idx = +el.dataset.idx || 0;
    // Ohne feste Spalte erst nach kurzem Verweilen einblenden, damit nicht bei
    // jedem Überstreichen ein Fenster aufpoppt. In der Spalte stört nichts.
    const zoegern = spkFeldEl() ? 0 : 250;
    el.addEventListener("mouseenter", e => {
      if (spkFest) return;
      clearTimeout(spkTimer);
      const x = e.clientX, y = e.clientY;
      spkTimer = setTimeout(() => zeigeSpielKarte(id, x, y, zone, false, idx), zoegern);
    });
    el.addEventListener("mouseleave", () => versteckeSpielKarte());
  });
}

/* Nur die Trefferliste der Bibliothek neu zeichnen: das Suchfeld selbst bleibt
   stehen und behält Fokus und Cursorposition. */
function renderLibListe() {
  // Über die Liste selbst suchen, nicht über den Korb: der heißt im Akkordeon
  // .zone-korb und in der Matte .mat-korb — ein Selektor auf einen der beiden
  // ließ die Suche in der anderen Anordnung wirkungslos ins Leere greifen.
  const korb = $('#zonen [data-zone="lib"] .lib-liste')?.parentElement;
  if (!korb) return;
  // Nur Trefferliste und „ganze Bibliothek"-Knopf tauschen — das Suchfeld
  // selbst bleibt dasselbe Element und damit Fokus und Cursor unberührt.
  const neu = document.createElement("div");
  neu.innerHTML = zoneLibHtml();
  korb.querySelector(".lib-liste")?.replaceWith(neu.querySelector(".lib-liste"));
  korb.querySelector("#lib-alle")?.remove();
  const knopf = neu.querySelector("#lib-alle");
  if (knopf) korb.appendChild(knopf);
  wireZonenHover();
}

function wireZonen() {
  const zonen = $("#zonen");
  if (!zonen) return;
  // Delegation: die Körbe entstehen bei jedem Zug neu.
  zonen.onclick = e => {
    const mv = e.target.closest("[data-move]");
    if (mv) return zoneMove(mv.dataset.move, mv.dataset.von, mv.dataset.nach, mv.dataset.idx);
    const tap = e.target.closest("[data-tap]");
    if (tap) return feldTap(tap.dataset.tap, +tap.dataset.idx);
    const mk = e.target.closest("[data-marke]");
    if (mk) return feldMarke(mk.dataset.marke, +mk.dataset.idx, parseInt(mk.dataset.d, 10));
    if (e.target.closest("#feld-enttappen")) return feldAlleEnttappen();
    const st = e.target.closest("[data-steuer]");
    if (st) return cmdSteuer(st.dataset.steuer, parseInt(st.dataset.d, 10));
    const alle = e.target.closest("#lib-alle");
    if (alle) { libAlle = !libAlle; return renderZonen(); }
    const spk = e.target.closest("[data-spk]");
    if (spk) return spkAusElement(spk);
  };
  zonen.onkeydown = e => {
    const spk = e.target.closest?.("[data-spk]");
    if (spk && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); spkAusElement(spk); }
  };
  zonen.oninput = e => { if (e.target.id === "lib-suche") renderLibListe(); };
  // Verlässt der Zeiger den ganzen Bereich, alle schwebenden Vorschauen weg.
  // Das mouseleave einer einzelnen Karte bleibt aus, wenn sie unter dem Zeiger
  // aus dem DOM verschwindet (jeder Zug zeichnet neu) — dann hinge die
  // Vorschau, bis man sie zufällig wieder auslöst.
  zonen.onmouseleave = () => { versteckeCmdHover(); clearTimeout(spkTimer); versteckeSpielKarte(); };
  wireZonenHover();
}

/* Deck für die Runde wählen: an session_players (Realtime → Mitspieler sehen es),
   und den Tracker der alten Wahl leeren. */
async function sessDeckWaehlen(deckId) {
  try {
    await sb.from("session_players").update({ deck_id: deckId || null })
      .eq("session_id", SESSION.id).eq("user_id", USER.id);
    SESSION_ZONEN = {};
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
  wireZonen();
  // Auf-/Zugeklappt merken, damit ein Neuzeichnen (Realtime) es nicht aufreißt.
  const dbox = $("#dice-box"); if (dbox) dbox.ontoggle = () => wuerfelOffen = dbox.open;
  const ibox = $("#invite-box"); if (ibox) ibox.ontoggle = () => einladenOffen = ibox.open;
  wireSpielerKacheln();
}

/* Lebenspunkt-Knöpfe und Commander-Vorschau der Spielerkacheln. Steht für sich,
   weil die Kacheln in der Matte im Zonenbehälter sitzen und dort bei jedem Zug
   neu entstehen — renderZonen() ruft das deshalb ebenfalls auf. */
function wireSpielerKacheln() {
  $$("#v-session [data-life]").forEach(b => b.onclick = () => lebenAendern(b.dataset.life, parseInt(b.dataset.d)));
  if (!HOVER_OK) return;
  $$("#v-session .sp-deck[data-cmd-img]").forEach(el => {
    if (el.dataset.cmdWired) return;   // addEventListener stapelt sich sonst
    el.dataset.cmdWired = "1";
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
    SESSION_ZONEN = {};   // eigener Zonenstand sofort leer; das reset-Event räumt die DB
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
  // Der Würfelkasten ist normalerweise zugeklappt — ein Wurf (auch der eines
  // Mitspielers) fährt ihn auf, sonst würfelte man ins Verborgene.
  const box = $("#dice-box");
  if (box && !box.open) { box.open = true; wuerfelOffen = true; }
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
    SESSION_ZONEN = {};
    Object.keys(playedTimers).forEach(k => { clearTimeout(playedTimers[k]); delete playedTimers[k]; });
    sb.from("session_played").delete().eq("session_id", SESSION.id).eq("user_id", USER.id).then(() => {});
    if ($(".view.on")?.id === "v-session") renderZonen();
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

/* ---------------------------------------------------- Tooltip -------- */
/* Globaler Tooltip statt der nativen title-Tooltips: die lassen sich weder
   umplatzieren (sie landen unter dem Zeiger) noch gestalten. Beim Überfahren
   wird der native Hinweis ausgehängt (unterdrückt den nativen Tooltip),
   gemerkt und stattdessen unser gestaltetes Feld gezeigt — an der Zeigerposition,
   aber nach rechts unten versetzt, damit es nie unter dem Zeiger liegt.

   Erfasst wird BEIDES: das HTML-title-Attribut (Knöpfe, Zellen, Symbole) UND das
   SVG-<title>-Kind (Sprachflaggen, Chart-Punkte, Marken-Logos) — Letzteres fiel
   früher durch und blieb nativ. Delegiert am document, überlebt also jedes
   Neuzeichnen; verschwindet das Ziel, schließt der Tooltip von selbst.

   Elemente mit großer Hover-Vorschau (data-view / data-cmd-img) bekommen KEINEN
   Tooltip — die Vorschau sagt schon alles —, ihr nativer title wird aber trotzdem
   unterdrückt. In Ruhe bleibt der Hinweis am Element (für Screenreader); nur
   während des Überfahrens ist er kurz ausgehängt. Auf Touch (pointerType "touch")
   bleibt alles aus, dort gibt es kein Hover. */
function initTooltip() {
  if (document.getElementById("aa-tip")) return;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const tip = document.createElement("div");
  tip.className = "aa-tip";
  tip.id = "aa-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let ziel = null, text = "", timer = 0, raf = 0, px = 0, py = 0;

  // Text zum überfahrenen Element: erst ein title-Attribut (auch am Vorfahren),
  // sonst ein SVG-<title>-Kind an der Form oder einem ihrer SVG-Vorfahren (bei
  // der Flagge hängt <title> am <svg>, beim Chart-Punkt am <circle>).
  const holeTip = tgt => {
    if (!tgt || !tgt.closest) return null;
    const a = tgt.closest("[title]");
    if (a && a.getAttribute("title")) return { el: a, node: null, text: a.getAttribute("title") };
    let n = tgt;
    while (n && n.namespaceURI === SVG_NS) {
      const ti = n.querySelector?.(":scope > title");
      if (ti && ti.textContent.trim()) return { el: n, node: ti, text: ti.textContent };
      n = n.parentNode;
    }
    return null;
  };

  // Nativen Hinweis aushängen (Attribut ODER <title>-Kind) und am Element merken.
  const aushaengen = (el, node, txt) => {
    if (node) { el._aaNode = node; node.remove(); }
    else { el.dataset.aaTitle = txt; el.removeAttribute("title"); }
  };
  // … und beim Verlassen zurückgeben, sofern der Code nicht selbst einen neuen
  // gesetzt hat (z. B. der Auf-/Zuklappen-Knopf beim Klick).
  const einhaengen = el => {
    if (el._aaNode) {
      if (!el.querySelector(":scope > title")) el.appendChild(el._aaNode);
      delete el._aaNode;
    } else if (el.dataset.aaTitle != null) {
      if (!el.hasAttribute("title")) el.setAttribute("title", el.dataset.aaTitle);
      delete el.dataset.aaTitle;
    }
  };

  const platziere = () => {
    const tw = tip.offsetWidth, th = tip.offsetHeight, rand = 6, dx = 16, dy = 24;
    let links = px + dx;                                   // wie der native: rechts unter dem Zeiger …
    if (links + tw > innerWidth - rand) links = px - dx - tw;   // … rechts kein Platz → nach links
    links = Math.max(rand, Math.min(links, innerWidth - tw - rand));
    let oben = py + dy;                                    // … nur weit genug weg, nie unter dem Zeiger
    if (oben + th > innerHeight - rand) oben = py - 12 - th;    // unten kein Platz → nach oben
    oben = Math.max(rand, Math.min(oben, innerHeight - th - rand));
    tip.style.left = Math.round(links) + "px";
    tip.style.top = Math.round(oben) + "px";
  };

  const zeige = () => {
    if (!ziel || !ziel.isConnected) return;
    tip.textContent = text;
    // Steckt das Ziel in einem MODALEN Dialog, muss der Tooltip mit hinein.
    // showModal() hebt den Dialog in die Top-Layer, und die liegt über allem,
    // was im normalen Baum steht — auch über z-index:9999. Am body hängend war
    // der Tooltip in jedem Dialog unsichtbar: er wurde erzeugt und richtig
    // platziert, nur eben dahinter gezeichnet. Aufgefallen ist das an den
    // KI-Begründungen in der Kartenansicht, wo der Text auf vier Zeilen
    // gekürzt ist und der Tooltip die einzige Stelle war, an der er ganz
    // stand. Betroffen war aber jeder Tooltip in jedem Dialog.
    //
    // Umhängen statt aufstocken: einen z-index gibt es gegen die Top-Layer
    // nicht. position:fixed bleibt dabei am Viewport ausgerichtet — kein
    // Dialog der App setzt transform, filter oder backdrop-filter, was einen
    // eigenen Bezugsrahmen aufspannen würde. platziere() rechnet unverändert.
    const wirt = ziel.closest?.("dialog[open]") || document.body;
    if (tip.parentElement !== wirt) wirt.appendChild(tip);
    tip.classList.add("on");
    platziere();
    cancelAnimationFrame(raf);
    const tick = () => {                                   // Ziel verschwindet (Neuzeichnen) → schließen
      if (!ziel) return;
      if (!ziel.isConnected) return verstecke();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  function verstecke() {
    clearTimeout(timer); cancelAnimationFrame(raf);
    tip.classList.remove("on");
    // Zurück an den body. Sonst bliebe der Tooltip Kind eines Dialogs, der
    // sich womöglich schliesst, ohne dass ein pointerout kam — er hinge dann
    // in einem display:none-Baum und tauchte beim nächsten Umhängen ohne die
    // übliche Verzögerung sofort wieder auf.
    if (tip.parentElement !== document.body) document.body.appendChild(tip);
    if (ziel) einhaengen(ziel);
    ziel = null; text = "";
  }

  // Zeigerposition mitführen (Maus/Stift), damit der Tooltip nach der kurzen
  // Verzögerung dort erscheint, wo der Zeiger dann steht.
  document.addEventListener("pointermove", e => {
    if (e.pointerType !== "touch") { px = e.clientX; py = e.clientY; }
  }, { passive: true });

  // Pointer- statt Maus-Events: e.pointerType trennt Maus/Stift von Touch. Auf
  // Touch gibt es kein Hover — dort bleibt der Tooltip aus (wie der native title
  // auf dem Handy nie erschien). Sonst zeigte ihn jedes Tippen und er bliebe bis
  // zum nächsten Tipp hängen.
  document.addEventListener("pointerover", e => {
    if (e.pointerType === "touch") return;
    const hit = holeTip(e.target);
    if (!hit || hit.el === ziel) return;
    verstecke();                                          // altes Ziel sauber schließen
    ziel = hit.el; text = hit.text; px = e.clientX; py = e.clientY;
    aushaengen(ziel, hit.node, hit.text);                 // nativen Tooltip immer unterdrücken
    // Wo schon die große Kartenvorschau greift: kein zusätzlicher Tooltip.
    if (ziel.closest?.("[data-view],[data-cmd-img]")) return;
    timer = setTimeout(zeige, 320);
  });

  document.addEventListener("pointerout", e => {
    if (e.pointerType === "touch" || !ziel) return;
    if (e.relatedTarget && ziel.contains(e.relatedTarget)) return;   // noch im Ziel
    verstecke();
  });

  addEventListener("scroll", verstecke, true);
  addEventListener("wheel", verstecke, { passive: true });
  // Sicherheitsnetz: hat die Maus einen Tooltip offen und es folgt eine Berührung
  // (Hybridgerät), schließt ihn die Berührung.
  addEventListener("touchstart", verstecke, { passive: true });
}

/* ========================= Site Status (Upptime) =========================
   Die vollständige Statusseite, hier im Haus statt als Auswärtslink. Die
   Zahlen kommen aus dem Upptime-Repo MTGTC-Archive-Status, wo GitHub Actions
   alle fünf Minuten misst und das Ergebnis festschreibt. Zwei Quellen, weil
   Upptime sie getrennt führt:

     • history/summary.json über raw.githubusercontent — Momentaufnahme je
       Dienst: Status, Verfügbarkeit und Antwortzeit je Zeitraum sowie die
       Ausfallminuten je Tag. Kein Kontingent, das ist die Pflicht.
     • Störungen (Issues) und Antwortzeit-Verlauf (Commit-Meldungen) über die
       GitHub-API. Unangemeldet sind das 60 Anfragen je Stunde und IP — daher
       der Zwischenspeicher unten, und daher ist das die Kür: fällt sie aus,
       fehlen Graph, Tagesbalken und Störungsliste, alles Übrige steht.

   Vorher stand hier ein HEAD-Fetch mit mode:"no-cors" je Endpunkt. Der kann
   gar nicht fehlschlagen — eine undurchsichtige Antwort zählt als Erfolg, und
   selbst ein 500er löst das Promise. Die Ansicht meldete also „UP", solange
   überhaupt Netz da war. Gemessen wird jetzt dort, wo wirklich gemessen wird. */

const STATUS_ROH  = "https://raw.githubusercontent.com/imm0r/MTGTC-Archive-Status/main";
const STATUS_API  = "https://api.github.com/repos/imm0r/MTGTC-Archive-Status";
const STATUS_FRISCH = 5 * 60 * 1000;   // so lange gilt der Zwischenspeicher

/* tage:null = „gesamt". Die Feldnamen in summary.json heißen uptime/uptimeDay/
   uptimeWeek/… — „gesamt" ist der Sonderfall ohne Endung. */
const STATUS_ZEITRAEUME = [
  { id: "day", tage: 1 }, { id: "week", tage: 7 }, { id: "month", tage: 30 },
  { id: "year", tage: 365 }, { id: "all", tage: null }
];

let STATUS_ZEIT  = "week";
let STATUS_DATEN = null;

/* Was uns gehoert: die eigene Auslieferung auf GitHub Pages und die eigene
   Datenbank. Alles andere sind fremde Datenquellen. Die Unterscheidung ist
   nicht kosmetisch — bei einem Ausfall links kann man selbst eingreifen,
   rechts bleibt nur abwarten. Gepruft wird der Host und nicht der Name: Namen
   aendern sich beim Umbenennen in der .upptimerc.yml, Hosts nicht. */
const STATUS_EIGENE_HOSTS = ["imm0r.github.io", "api.supabase.com"];
const statusIstEigen = s => {
  try { return STATUS_EIGENE_HOSTS.includes(new URL(s.url).hostname); }
  catch { return false; }   // unbrauchbare URL gilt als fremd, nicht als eigen
};

const statusFeld = (d, feld, zeit) =>
  d[zeit === "all" ? feld : feld + zeit[0].toUpperCase() + zeit.slice(1)];

const STATUS_TAG = 86400000;
const statusMitternacht = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const statusIso = ms => { const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/* Upptime schreibt Status und Antwortzeit in die COMMIT-MELDUNG, nicht in die
   Datei — die trägt immer nur den letzten Stand. Der Verlauf steckt also in der
   Historie: "🟩 Mana Font is up (200 in 158 ms) [skip ci] [upptime]". Messungen
   mit 0 ms sind Fehlversuche ohne Antwort und fliegen aus den Punkten raus,
   genau wie bei Upptime selbst — sonst zöge jeder Ausfall die Durchschnittszeit
   nach unten, statt sie ehrlich auszulassen.

   „seit" zählt dagegen JEDEN Commit, auch die Ausfälle. Es beantwortet eine
   andere Frage: ab wann wurde überhaupt gemessen. Beides zu vermischen wäre ein
   Fehler mit Ansage — ein Dienst, der von Anfang an lag, hätte seinen ersten
   Messpunkt erst am Tag der Erholung, und der Tagesbalken würde genau die
   Ausfalltage verschlucken, die er zeigen soll. */
function statusVerlauf(commits) {
  const punkte = [];
  let seit = Infinity;
  for (const c of commits || []) {
    const zeit = Date.parse(c?.commit?.author?.date || "");
    if (!Number.isFinite(zeit)) continue;
    if (zeit < seit) seit = zeit;
    const teil = String(c?.commit?.message || "").split(" in ")[1];
    if (!teil) continue;
    const ms = parseInt(teil.split("ms")[0].trim(), 10);
    if (!ms) continue;
    punkte.push({ zeit, ms });
  }
  punkte.sort((a, b) => a.zeit - b.zeit);
  return { punkte, seit: Number.isFinite(seit) ? seit : null };
}

/* Gesamtlage aus den Einzelzustaenden. Eine Stelle fuer Kopfzeile und Ansicht,
   damit beide nie Widerspruechliches behaupten. */
function statusLage(dienste) {
  const aus  = dienste.filter(s => s.status === "down").length;
  const teil = dienste.filter(s => s.status === "degraded").length;
  if (aus)  return { art: "err",  text: t("status.someDown", { n: aus, total: dienste.length }) };
  if (teil) return { art: "warn", text: t("status.degraded") };
  return { art: "ok", text: t("status.allUp") };
}

/* Nur die Zusammenfassung, ohne Stoerungen und Antwortzeit-Verlauf. Die
   Kopfzeile braucht genau eine Zeile — der volle Abruf kostet zusaetzlich
   fuenf Anfragen an die GitHub-API, die am Stundenkontingent haengen, und die
   waeren dafuer verschwendet. raw.githubusercontent hat keins. */
let STATUS_KURZ = null;

async function statusKurzHolen() {
  if (STATUS_KURZ && Date.now() - STATUS_KURZ.stand < STATUS_FRISCH) return STATUS_KURZ.dienste;
  const r = await fetch(`${STATUS_ROH}/history/summary.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  STATUS_KURZ = { stand: Date.now(), dienste: await r.json() };
  return STATUS_KURZ.dienste;
}

async function statusHolen(neu) {
  if (!neu && STATUS_DATEN && Date.now() - STATUS_DATEN.stand < STATUS_FRISCH) return STATUS_DATEN;

  const json = async url => {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };

  const dienste = await json(`${STATUS_ROH}/history/summary.json`);   // Pflicht
  STATUS_KURZ = { stand: Date.now(), dienste };   // die Kopfzeile lebt davon mit

  let stoerungen = [], verlauf = {}, apiOk = true;
  try {
    const [issues, ...reihen] = await Promise.all([
      json(`${STATUS_API}/issues?labels=status&state=all&per_page=100`),
      ...dienste.map(d => json(`${STATUS_API}/commits?path=history/${encodeURIComponent(d.slug)}.yml&per_page=100`))
    ]);
    // /issues liefert auch Pull Requests mit; die sind hier keine Störung.
    stoerungen = (issues || []).filter(i => !i.pull_request);
    dienste.forEach((d, i) => { verlauf[d.slug] = statusVerlauf(reihen[i]); });
  } catch { apiOk = false; verlauf = {}; }

  STATUS_DATEN = { stand: Date.now(), dienste, stoerungen, verlauf, apiOk };
  return STATUS_DATEN;
}

/* Ein Balken je Tag. dailyMinutesDown verzeichnet NUR Tage mit Ausfall, ein
   fehlender Eintrag heißt also „lief". Das gilt aber erst ab dem Tag, an dem
   nachweislich gemessen wurde — davor wäre Grün frei erfunden. Der Balken
   beginnt darum beim ältesten bekannten Messpunkt, und ohne Verlaufsdaten
   entfällt er ganz, statt Betriebsbereitschaft zu behaupten. */
function statusTagesbalken(dienst, verlauf, tage) {
  if (!verlauf?.seit) return "";
  const heute = statusMitternacht(Date.now());
  const start = Math.max(statusMitternacht(verlauf.seit),
                         tage ? heute - (tage - 1) * STATUS_TAG : -Infinity);
  const n = Math.round((heute - start) / STATUS_TAG) + 1;
  if (!Number.isFinite(n) || n < 1) return "";

  const balken = Array.from({ length: n }, (_, i) => {
    const tagMs = start + i * STATUS_TAG, iso = statusIso(tagMs);
    const min = Math.round(Number(dienst.dailyMinutesDown?.[iso]) || 0);
    const art = min === 0 ? "ok" : min >= 1380 ? "aus" : "teil";
    const datum = new Date(tagMs).toLocaleDateString(LANG, { day: "2-digit", month: "2-digit", year: "numeric" });
    const titel = min === 0 ? t("status.dayUp", { d: datum }) : t("status.dayDown", { d: datum, min });
    return `<i class="st-tag ${art}" title="${esc(titel)}"></i>`;
  }).join("");

  const vonBis = `${new Date(start).toLocaleDateString(LANG, { day: "2-digit", month: "2-digit" })} – ${t("status.today")}`;
  return `<div class="st-balken" role="img" aria-label="${esc(t("status.daysLabel"))}">${balken}</div>
    <div class="st-balken-fuss"><span>${esc(vonBis)}</span><span>${esc(t("status.daysLabel"))}</span></div>`;
}

/* Antwortzeit als Linie. Bewusst schlicht gehalten: keine Achsen, keine
   Tooltips — die Zahl selbst steht schon als Kachel daneben, hier geht es nur
   um den Verlauf. Die gestrichelte Linie ist der Durchschnitt, wie im
   Preisgraph, damit beide Graphen der App dieselbe Sprache sprechen. */
function statusGraph(punkte, tage) {
  const grenze = tage ? Date.now() - tage * STATUS_TAG : -Infinity;
  const P = (punkte || []).filter(p => p.zeit >= grenze);
  if (P.length < 2) return `<p class="hint st-kein-graph">${esc(t("status.noChart"))}</p>`;

  const w = 620, h = 96, pl = 4, pr = 4, pt = 10, pb = 10;
  const iw = w - pl - pr, ih = h - pt - pb;
  const werte = P.map(p => p.ms);
  const lo = Math.min(...werte), hi = Math.max(...werte), spanne = hi - lo || 1;
  const t0 = P[0].zeit, dt = (P[P.length - 1].zeit - t0) || 1;
  const X = p => pl + (p.zeit - t0) / dt * iw;
  const Y = v => pt + ih - (v - lo) / spanne * ih;
  const avg = Math.round(werte.reduce((a, b) => a + b, 0) / werte.length);
  const linie = P.map(p => `${X(p).toFixed(1)},${Y(p.ms).toFixed(1)}`).join(" ");

  return `<svg class="st-graph" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
       xmlns="http://www.w3.org/2000/svg" role="img"
       aria-label="${esc(t("status.chartAria", { min: lo, max: hi, avg }))}">
      <polyline points="${linie} ${(w - pr).toFixed(1)},${h} ${pl},${h}" fill="var(--acc)" opacity=".10" stroke="none"/>
      <line x1="${pl}" y1="${Y(avg).toFixed(1)}" x2="${w - pr}" y2="${Y(avg).toFixed(1)}"
        stroke="var(--dim)" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>
      <polyline points="${linie}" fill="none" stroke="var(--acc)" stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="st-graph-fuss">
      <span>${esc(t("status.min", { n: lo }))}</span>
      <span>${esc(t("status.avg", { n: avg }))}</span>
      <span>${esc(t("status.max", { n: hi }))}</span>
    </div>`;
}

const statusDauer = ms => {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return t("status.durMin", { n: min });
  if (min < 1440) return t("status.durStd", { n: Math.round(min / 60) });
  return t("status.durTag", { n: Math.round(min / 1440) });
};

function statusStoerungen(liste) {
  if (!liste.length) return `<p class="hint">${esc(t("status.noIncidents"))}</p>`;
  const datum = s => new Date(s).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" });
  return `<div class="st-vorfaelle">${liste.slice(0, 12).map(i => {
    const offen = i.state === "open";
    const bis = i.closed_at ? Date.parse(i.closed_at) : Date.now();
    return `<div class="st-vorfall">
      <span class="pill ${offen ? "err" : "ok"}">${esc(offen ? t("status.ongoing") : t("status.resolved"))}</span>
      <div class="st-vorfall-txt">
        <a href="${esc(i.html_url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
        <div class="st-vorfall-zeit">${esc(datum(i.created_at))} · ${esc(statusDauer(bis - Date.parse(i.created_at)))}</div>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function renderStatus() {
  const el = $("#v-status");
  if (!el) return;
  el.innerHTML = `<div class="card"><p class="hint">${esc(t("status.loading"))}</p></div>`;
  statusHolen()
    .then(d => statusZeichnen(el, d))
    .catch(() => {
      el.innerHTML = `<div class="card">
        <h3 class="st-titel">${esc(t("status.title"))}</h3>
        <p class="hint">${esc(t("status.error"))}</p>
      </div>`;
    });
}

function statusZeichnen(el, d) {
  const zeit = STATUS_ZEIT;
  const tage = (STATUS_ZEITRAEUME.find(z => z.id === zeit) || {}).tage;
  const lage = statusLage(d.dienste);
  kopfLageSetzen(lage);   // dieselbe Lage im Kopf, ohne erneuten Abruf

  const karte = s => {
    const art = s.status === "down" ? "err" : s.status === "degraded" ? "warn" : "ok";
    const txt = s.status === "down" ? t("status.down")
              : s.status === "degraded" ? t("status.degradedShort") : t("status.up");
    return `<div class="card st-dienst">
      <div class="st-dienst-kopf">
        <div class="st-dienst-name">
          <span>${esc(s.name)}</span>
          <a class="st-dienst-url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>
        </div>
        <span class="pill ${art}">${esc(txt)}</span>
      </div>
      <div class="stats st-kacheln">
        <div class="stat"><div class="v">${esc(statusFeld(s, "uptime", zeit) ?? "–")}</div>
          <div class="k">${esc(t("status.uptime"))}</div></div>
        <div class="stat"><div class="v">${esc(statusFeld(s, "time", zeit) ?? "–")} ms</div>
          <div class="k">${esc(t("status.responseTime"))}</div></div>
      </div>
      ${statusTagesbalken(s, d.verlauf[s.slug], tage)}
      ${d.apiOk ? statusGraph(d.verlauf[s.slug]?.punkte, tage) : ""}
    </div>`;
  };

  // Links das Eigene, rechts das Fremde — die Trennung, die im Ernstfall zählt:
  // links kann man selbst etwas tun, rechts nur abwarten. Die Zuordnung haengt
  // am Host und nicht an der Reihenfolge in summary.json, damit ein neu
  // eingetragener Dienst von selbst in der richtigen Spalte landet, statt die
  // Aufteilung stillschweigend zu verschieben.
  const eigene = d.dienste.filter(statusIstEigen);
  const fremde = d.dienste.filter(s => !statusIstEigen(s));
  const spalte = liste => liste.length
    ? `<div class="st-spalte">${liste.map(karte).join("")}</div>` : "";
  const raster = `<div class="st-raster">${spalte(eigene)}${spalte(fremde)}</div>`;

  el.innerHTML = `
    <div class="card st-kopf">
      <div class="st-kopf-txt">
        <h3 class="st-titel">${esc(t("status.title"))}</h3>
        <p class="hint st-lead">${esc(t("status.lead"))}</p>
      </div>
      <div class="st-kopf-tat">
        <button class="btn ghost sm" id="st-neu">${esc(t("status.refresh"))}</button>
        <span class="st-stand">${esc(t("status.updated", {
          zeit: new Date(d.stand).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" }) }))}</span>
      </div>
    </div>

    <div class="card st-lage ${lage.art}">
      <span class="st-lage-punkt"></span>
      <span class="st-lage-txt">${esc(lage.text)}</span>
    </div>

    <div class="tabs st-zeit">${STATUS_ZEITRAEUME.map(z =>
      `<button type="button" data-zeit="${z.id}" class="${z.id === zeit ? "on" : ""}">${esc(t("status.period." + z.id))}</button>`
    ).join("")}</div>

    ${d.apiOk ? "" : `<div class="card"><p class="hint">${esc(t("status.rateLimit"))}</p></div>`}

    ${raster}

    <div class="card">
      <h3 class="st-titel">${esc(t("status.incidents"))}</h3>
      ${d.apiOk ? statusStoerungen(d.stoerungen) : `<p class="hint">${esc(t("status.rateLimit"))}</p>`}
    </div>

    <div class="card">
      <p class="hint" style="margin:0">${esc(t("status.checkNote"))}</p>
    </div>`;

  // Zeitraumwechsel zeichnet nur neu — die Daten für alle Zeiträume liegen
  // schon da, ein erneuter Abruf wäre reine Kontingentverschwendung.
  el.querySelectorAll(".st-zeit button").forEach(b => b.onclick = () => {
    STATUS_ZEIT = b.dataset.zeit;
    statusZeichnen(el, d);
  });
  const neu = el.querySelector("#st-neu");
  if (neu) neu.onclick = () => {
    neu.disabled = true;
    statusHolen(true).then(f => statusZeichnen(el, f)).catch(() => { neu.disabled = false; });
  };
}

function wireApp() {
  initTooltip();
  wireZahlenfelder();
  $$("nav button[data-v]").forEach(b => b.onclick = () => {
    $$("nav button[data-v]").forEach(x => x.classList.toggle("on", x === b));
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
    // Wie breit die Seite sein darf, hängt an der offenen Ansicht — das
    // entscheidet jetzt CSS über :has(.view.on) und nicht mehr eine Klasse von
    // hier aus. Grund: Die Startansicht ist schon offen, bevor je ein Klick
    // fiel; ein Umschalter an dieser Stelle allein ließe sie aus.
    $("#who-menu")?.classList.remove("open");   // Menüauswahl klappt das Menü zu
    if (b.dataset.v === "profile") renderProfile();
    if (b.dataset.v === "dashboard") renderDashboard();
    if (b.dataset.v === "community") renderCommunity();
    if (b.dataset.v === "friends") oeffneFreunde();
    if (b.dataset.v === "messages") oeffneNachrichten();
    if (b.dataset.v === "session") oeffneSession();
    if (b.dataset.v === "events") oeffneTermine();
    if (b.dataset.v === "rules") renderRules();
    if (b.dataset.v === "status") renderStatus();
    if (b.dataset.v === "settings") renderSettings();
    if (b.dataset.v === "wish") renderWunschliste();
  });
  // Der Verweis neben dem Logo drückt den gleichnamigen Knopf im Benutzermenü:
  // Umschalten, Markierung und Nachladen bleiben so an einer einzigen Stelle.
  const kopfStatus = $("#header-status");
  if (kopfStatus) kopfStatus.onclick = () => $('nav button[data-v="status"]')?.click();
  // Angeheftete Spielmodus-Karte: Escape und ein Klick daneben schließen sie.
  document.addEventListener("keydown", e => { if (e.key === "Escape") versteckeSpielKarte(true); });
  document.addEventListener("click", e => {
    if (spkFest && !e.target.closest(".spk") && !e.target.closest("[data-spk]")) versteckeSpielKarte(true);
  });

  // Klick irgendwo anders schließt das per Klick geöffnete Benutzermenü (Touch)
  // und das Sprach-Dropdown in den Einstellungen.
  document.addEventListener("click", e => {
    const m = $("#who-menu");
    if (m && !m.contains(e.target)) m.classList.remove("open");
    const ls = $("#lang-select");
    if (ls && !ls.contains(e.target)) ls.classList.remove("open");
    // Beide Set-Dropdowns (Sammlung und Wunschliste) über die Klasse, nicht
    // über die ID: sonst bliebe das zweite offen stehen.
    $$(".set-select").forEach(ss => {
      if (ss.contains(e.target)) return;
      ss.classList.remove("open");
      ss.querySelector(".set-trigger")?.setAttribute("aria-expanded", "false");
    });
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
    } catch (err) {
      // Der Trigger kann trotz gesperrter Kachel absagen — etwa wenn die Karte
      // seit der Suche von einem zweiten Gerät ins Deck gelegt wurde.
      if (istSingletonFehler(err)) {
        await reload();
        const d = DECKS.find(x => x.id === deckId);
        toast(t("deck.singleton", { name: card.name,
          max: commanderMaxKopien(card), n: deckKopien(d, card) }));
        btn.classList.add("voll");
      } else if (istDeckVollFehler(err)) {
        await reload(); deckVollMelden(DECKS.find(x => x.id === deckId));
        btn.classList.add("voll");
      } else { btn.disabled = false; toast(dbErr(err)); }
    }
  });

  // Treffer direkt übernehmen oder erst bestätigen (gerätelokal gemerkt).
  const auto = $("#d-auto");
  if (auto) {
    auto.checked = autoUebernehmen();
    auto.onchange = () => autoUebernehmenSetzen(auto.checked);
  }

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
  // Das Ablegen selbst (Dateien wie gezogene Kartenbilder) fängt der
  // fensterweite Zieh-Import — auch hier über dem Feld (wireZiehImport).
  wireZiehImport();

  // Filterleiste von Sammlung UND Wunschliste — dieselbe Verdrahtung, einmal je
  // Bereich. Suche/Filter ändern die Treffermenge, also immer zurück auf Seite 1.
  for (const bereich of Object.keys(LISTE)) {
    const neu = () => { listPage[bereich] = 0; renderKartenliste(bereich); };
    lel(bereich, "q").oninput = neu;
    const foil = lel(bereich, "f-foil");
    if (foil) foil.onchange = neu;          // die Wunschliste hat keinen
    // Eigenes Set-Dropdown: Trigger klappt auf/zu, Klick auf einen Eintrag setzt
    // den Filter. Klicks liegen delegiert auf dem Menü, weil renderSetFilter die
    // Einträge neu baut. Außenklick schließt (Handler weiter oben).
    const setSel = lel(bereich, "set-select");
    const setTrg = lel(bereich, "set-trigger");
    setTrg.onclick = ev => {
      ev.stopPropagation();
      setTrg.setAttribute("aria-expanded", setSel.classList.toggle("open"));
    };
    lel(bereich, "set-menu").onclick = ev => {
      const li = ev.target.closest("[data-set]");
      if (!li) return;
      listSet[bereich] = li.dataset.set;
      setSel.classList.remove("open");
      setTrg.setAttribute("aria-expanded", "false");
      neu();
    };
    // Farbidentitäts- und Typ-Filter: jede Checkbox zeichnet die Liste neu.
    $$(lid(bereich, "ci-filter") + " input[data-ci], " +
       lid(bereich, "type-filter") + " input[data-typ]").forEach(inp => inp.onchange = neu);
  }
  $("#upd").onclick = updatePrices;
  // Einkaufszettel über die ganze Wunschliste — derselbe Dialog wie „Fehlende
  // Karten kaufen" am einzelnen Deck.
  const wKauf = $("#wish-buy");
  if (wKauf) wKauf.onclick = oeffneKaufWunschliste;
  const wKaufLogo = $("#wish-buy-cm"); if (wKaufLogo) wKaufLogo.innerHTML = CM_LOGO;   // Cardmarket-Logo vor „in Wants übertragen"

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
  zeigeKopfVersion();
  zeigeKopfLage();
  renderAll();
  const aktiv = $(".view.on")?.id;
  if (aktiv === "v-profile") renderProfile();
  else if (aktiv === "v-dashboard") renderDashboard();
  else if (aktiv === "v-friends") renderFriends();
  else if (aktiv === "v-session") renderSession();
  else if (aktiv === "v-events") renderTermine();
  else if (aktiv === "v-rules") renderRules();
  else if (aktiv === "v-settings") renderSettings();
  else if (aktiv === "v-status") renderStatus();
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

/* =====================================================================
   Nachrichten

   Ein internes Postfach statt Umwegen über Karten-Kommentare oder das
   Weitergeben von Kontaktdaten. Bewusst schlicht: ein Gespräch je Person,
   Verlauf chronologisch, Ungelesenes als Zahl in der Navigation.

   Die Sichtbarkeit erzwingt die Datenbank (RLS auf dm_threads/dm_messages);
   der Client zeichnet nur, was er ohnehin lesen dürfte.
   ===================================================================== */
let DM_INBOX = [], DM_OFFEN = null, DM_NACHRICHTEN = [], DM_UNREAD = 0;

/* Die Zahl am Navigationseintrag. Wird nach jedem Laden und nach jedem
   Senden/Lesen neu gesetzt — eine Abfrage, kein Abonnement. */
async function dmBadgeAktualisieren() {
  try {
    const { data } = await sb.rpc("dm_unread_total");
    DM_UNREAD = Number(data) || 0;
  } catch { DM_UNREAD = 0; }
  const b = $("#dm-badge");
  if (!b) return;
  b.textContent = DM_UNREAD > 99 ? "99+" : String(DM_UNREAD);
  b.hidden = DM_UNREAD === 0;
}

async function oeffneNachrichten() {
  await ladeInbox();
  renderMessages();
}

async function ladeInbox() {
  try {
    const { data, error } = await sb.rpc("dm_inbox");
    if (error) throw error;
    DM_INBOX = data || [];
  } catch { DM_INBOX = []; }
  await dmBadgeAktualisieren();
}

/* Ein Gespräch öffnen: Verlauf holen und sofort als gelesen markieren. Das
   Markieren läuft absichtlich VOR dem Zeichnen, damit die Zahl in der
   Navigation nicht noch kurz das Gegenteil behauptet. */
async function dmOeffnen(threadId) {
  DM_OFFEN = threadId;
  try {
    await sb.rpc("dm_mark_read", { p_thread: threadId });
    const { data, error } = await sb
      .from("dm_messages")
      .select("id,sender,body,created,deleted")
      .eq("thread_id", threadId)
      .order("created", { ascending: true })
      .limit(500);
    if (error) throw error;
    DM_NACHRICHTEN = data || [];
  } catch (e) { DM_NACHRICHTEN = []; toast(dbErr(e)); }
  await ladeInbox();
  renderMessages();
  const v = $("#dm-verlauf");
  if (v) v.scrollTop = v.scrollHeight;
}

async function dmSenden() {
  const feld = $("#dm-text");
  const text = (feld?.value || "").trim();
  if (!text || !DM_OFFEN) return;
  feld.disabled = true;
  try {
    const { error } = await sb.from("dm_messages")
      .insert({ thread_id: DM_OFFEN, sender: USER.id, body: text.slice(0, 4000) });
    if (error) throw error;
    feld.value = "";
    await dmOeffnen(DM_OFFEN);
  } catch (e) { toast(dbErr(e)); }
  finally { feld.disabled = false; feld.focus?.(); }
}

/* Ein Gespräch mit einer Person öffnen — legt es an, falls es noch keines
   gibt. Von der Freundesliste und vom Profil aus benutzt. */
async function dmMitPerson(userId) {
  try {
    const { data, error } = await sb.rpc("dm_thread_with", { p_other: userId });
    if (error) throw error;
    $$('nav button[data-v], #who-menu button[data-v]').forEach(x => x.classList.toggle("on", x.dataset.v === "messages"));
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-messages"));
    $("#who-menu")?.classList.remove("open");
    await ladeInbox();
    await dmOeffnen(Number(data));
  } catch (e) { toast(dbErr(e)); }
}

function dmZeitKurz(iso) {
  const d = new Date(iso), jetzt = new Date();
  const gleicherTag = d.toDateString() === jetzt.toDateString();
  return gleicherTag
    ? d.toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(LANG, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function renderMessages() {
  const el = $("#v-messages");
  if (!el) return;
  const offen = DM_INBOX.find(x => x.thread_id === DM_OFFEN);

  const liste = DM_INBOX.length ? DM_INBOX.map(g => `
    <button class="dm-eintrag${g.thread_id === DM_OFFEN ? " on" : ""}" data-dm="${g.thread_id}">
      ${avatarHtml(34, { display_name: g.other_name, avatar_url: g.other_avatar })}
      <div class="dm-eintrag-txt">
        <div class="dm-eintrag-kopf">
          <b>${esc(g.other_name || t("friends.unknown"))}</b>
          ${g.last_created ? `<span class="dm-zeit">${esc(dmZeitKurz(g.last_created))}</span>` : ""}
        </div>
        <div class="dm-vorschau">${esc(g.last_body || t("dm.noMessages"))}</div>
      </div>
      ${Number(g.unread) > 0 ? `<span class="dm-unread">${Number(g.unread)}</span>` : ""}
    </button>`).join("") : `<div class="empty">${esc(t("dm.empty"))}</div>`;

  const verlauf = !DM_OFFEN
    ? `<div class="empty">${esc(t("dm.pick"))}</div>`
    : `<div class="dm-verlauf" id="dm-verlauf">${
        DM_NACHRICHTEN.length ? DM_NACHRICHTEN.map(m => `
          <div class="dm-blase${m.sender === USER.id ? " eigen" : ""}">
            <div class="dm-blase-txt">${m.deleted ? `<i>${esc(t("dm.deleted"))}</i>` : esc(m.body)}</div>
            <div class="dm-blase-zeit">${esc(dmZeitKurz(m.created))}</div>
          </div>`).join("") : `<div class="empty">${esc(t("dm.noMessages"))}</div>`
      }</div>
      <div class="dm-senden">
        <textarea id="dm-text" rows="2" maxlength="4000" placeholder="${esc(t("dm.placeholder"))}"></textarea>
        <button class="btn" id="dm-go">${esc(t("dm.send"))}</button>
      </div>`;

  el.innerHTML = `
    <div class="dm-raster">
      <div class="card dm-liste">
        <h3 style="margin-top:0">${esc(t("dm.title"))}</h3>
        ${liste}
      </div>
      <div class="card dm-fenster">
        <h3 style="margin-top:0">${offen ? esc(offen.other_name || t("friends.unknown")) : esc(t("dm.title"))}</h3>
        ${verlauf}
      </div>
    </div>`;

  $$("[data-dm]").forEach(b => b.onclick = () => dmOeffnen(Number(b.dataset.dm)));
  const go = $("#dm-go");
  if (go) go.onclick = dmSenden;
  const feld = $("#dm-text");
  // Enter sendet, Shift+Enter macht einen Absatz — wie in jedem Messenger.
  if (feld) feld.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); dmSenden(); }
  });
  const v = $("#dm-verlauf");
  if (v) v.scrollTop = v.scrollHeight;
}

/* =====================================================================
   Rechte: Rollen und Gruppen

   Drei Ebenen, absichtlich flach gehalten:
     Rolle   trägt Berechtigungen   (admin, moderator, tester, member)
     Gruppe  trägt Rollen           (wer drin ist, erbt sie)
     Person  trägt Rollen direkt    und/oder über Gruppen

   Damit lässt sich „alle Tester bekommen die Vorschau" in einem Zug regeln,
   statt Person für Person. Die Berechtigungen selbst prüft ausschließlich die
   Datenbank (has_perm); hier wird nur zugewiesen.

   is_admin() bleibt daneben als harter Rückfall auf den Eigentümer — sonst
   könnte eine falsch gesetzte Rolle den Betreiber aus der eigenen Instanz
   aussperren.
   ===================================================================== */
let RECHTE = { rollen: [], gruppen: [], leute: [] };

async function ladeRechte() {
  try {
    const [r, g, l] = await Promise.all([
      sb.from("roles").select("key,name,rang").order("rang", { ascending: false }),
      sb.from("groups").select("key,name").order("key"),
      sb.rpc("admin_people"),
    ]);
    RECHTE = { rollen: r.data || [], gruppen: g.data || [], leute: l.data || [] };
  } catch { RECHTE = { rollen: [], gruppen: [], leute: [] }; }
}

async function zeichneRechte() {
  const box = $("#admin-rechte");
  if (!box) return;
  await ladeRechte();
  if (!RECHTE.leute.length) { box.innerHTML = `<div class="empty">${esc(t("admin.accessNone"))}</div>`; return; }

  box.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr>
      <th>${esc(t("admin.accessPerson"))}</th>
      ${RECHTE.rollen.map(r => `<th class="num" title="${esc(r.key)}">${esc(r.name)}</th>`).join("")}
      ${RECHTE.gruppen.map(g => `<th class="num" title="${esc(g.key)}">${esc(g.name)}</th>`).join("")}
    </tr></thead><tbody>${RECHTE.leute.map(p => `
    <tr><td>${esc(p.display_name || t("community.anonMember"))}</td>
      ${RECHTE.rollen.map(r => `<td class="num"><input type="checkbox" style="width:auto"
          data-role="${esc(r.key)}" data-user="${esc(p.user_id)}"${(p.roles || []).includes(r.key) ? " checked" : ""}></td>`).join("")}
      ${RECHTE.gruppen.map(g => `<td class="num"><input type="checkbox" style="width:auto"
          data-group="${esc(g.key)}" data-user="${esc(p.user_id)}"${(p.groups || []).includes(g.key) ? " checked" : ""}></td>`).join("")}
    </tr>`).join("")}</tbody></table></div>`;

  const schalten = async (cb, tabelle, spalte, wert) => {
    const an = cb.checked, user = cb.dataset.user;
    cb.disabled = true;
    try {
      const { error } = an
        ? await sb.from(tabelle).insert({ user_id: user, [spalte]: wert })
        : await sb.from(tabelle).delete().eq("user_id", user).eq(spalte, wert);
      if (error) throw error;
      toast(t(an ? "admin.accessGranted" : "admin.accessRevoked"));
    } catch (e) { cb.checked = !an; toast(dbErr(e)); }
    finally { cb.disabled = false; }
  };
  box.querySelectorAll("[data-role]").forEach(cb =>
    cb.onchange = () => schalten(cb, "user_roles", "role_key", cb.dataset.role));
  box.querySelectorAll("[data-group]").forEach(cb =>
    cb.onchange = () => schalten(cb, "group_members", "group_key", cb.dataset.group));
}

/* Die frei formulierbaren Profilfelder in einem Zug speichern.

   Die Webseite wird beim Speichern auf http/https eingegrenzt: ein Feld, in
   das jeder schreiben kann und das andere später anklicken, darf kein
   javascript:-Ziel tragen. Beim Anzeigen wird zusätzlich escaped — geprüft
   wird an beiden Enden, nicht nur an einem. */
async function profilTextSpeichern() {
  const url = ($("#pf-website")?.value || "").trim();
  if (url && !/^https?:\/\//i.test(url)) return toast(t("profile.websiteBad"));
  const felder = {
    bio: ($("#pf-bio")?.value || "").trim().slice(0, 600) || null,
    location: ($("#pf-location")?.value || "").trim().slice(0, 80) || null,
    favourite_format: ($("#pf-favformat")?.value || "").trim().slice(0, 40) || null,
    website: url.slice(0, 200) || null,
    findable: !!$("#pf-findable")?.checked,
  };
  const btn = $("#pf-about-save");
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.from("profiles").update(felder).eq("id", USER.id);
    if (error) throw error;
    Object.assign(PROFILE, felder);
    toast(t("set.saved"));
  } catch (e) { toast(dbErr(e)); }
  finally { if (btn) btn.disabled = false; }
}
