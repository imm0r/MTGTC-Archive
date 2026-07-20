// =====================================================================
//  Edge Function "rules-question"
//
//  Klärt eine unklare Spielsituation anhand des OFFIZIELLEN erweiterten
//  Regelwerks (Comprehensive Rules) von Wizards of the Coast. Der Nutzer
//  schildert die Situation in ein paar Sätzen; die Funktion antwortet mit
//  einem klaren Urteil, einer Begründung und den WÖRTLICH zitierten Regeln.
//
//  Wie scan-card und card-synergy existiert sie nur, weil der Anthropic-
//  Schlüssel nicht in die App darf. Und wie dort gilt: das Modell erfindet
//  nichts, was hier geprüft würde. Der springende Punkt gegen „klingt
//  plausibel, ist aber falsch": Das Modell RÄT nur, welche Regeln relevant
//  sind — die ANTWORT stützt sich ausschließlich auf den echten, aus der
//  offiziellen Textfassung geladenen Regeltext, und die im Client gezeigten
//  Zitate stammen 1:1 aus dieser Datei, nicht aus dem Gedächtnis des Modells.
//
//  Ablauf (propose-then-ground):
//    1. Triage (kleines, günstiges Modell): liest die Schilderung in JEDER
//       Sprache und nennt englische Suchbegriffe, Glossarbegriffe und
//       Kandidaten-Regelnummern.
//    2. Retrieval: holt genau diese Regeln + Glossareinträge WÖRTLICH aus der
//       geladenen Textfassung, dazu per Stichwort gefundene weitere Regeln.
//    3. Urteil (stärkeres Modell): antwortet NUR auf Basis der übergebenen
//       Regelauszüge, in der Sprache des Nutzers, mit Regelnummern.
// =====================================================================

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Triage ist reines Ablesen von Suchbegriffen — kleinstes Modell reicht.
// Das Urteil ist Regel-Reasoning; dort zählt Genauigkeit, nicht Kosten.
// Wechsel ist je eine Zeile.
const MODEL_TRIAGE = "claude-haiku-4-5";
const MODEL_JUDGE = "claude-sonnet-4-6";

// Die offizielle Textfassung. Wizards datiert den Dateinamen bei jeder
// Aktualisierung — die alte URL bleibt eine Weile erreichbar. Bricht sie doch,
// setzt der Betreiber das Secret RULES_TXT_URL auf die aktuelle .txt von
// Magic.Wizards.com/Rules. Ohne Secret gilt die hier hinterlegte Vorgabe.
const DEFAULT_RULES_URL =
  "https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.txt";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SPRACHE: Record<string, string> = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano",
};

// ------------------------------------------------------------------ //
//  Regelwerk laden und zergliedern — einmal je warmer Instanz.
//  Ein geteiltes Promise verhindert doppeltes Laden bei parallelen
//  Anfragen kurz nach dem Kaltstart.
// ------------------------------------------------------------------ //
interface Rule { num: string; text: string; }
interface Gloss { term: string; def: string; }
interface Corpus {
  rules: Map<string, Rule>;
  order: string[];
  glossary: Map<string, Gloss>;
  effectiveDate: string;
}
let corpusPromise: Promise<Corpus> | null = null;

function ruleKeyOf(line: string): string | null {
  let m = line.match(/^(\d{3}\.\d+[a-z]?)(?=\.|\s|$)/);   // 100.1 / 100.1a / 704.5k
  if (m) return m[1];
  m = line.match(/^(\d{3})\.\s+\D/);                       // Abschnitt "509. Declare Blockers Step"
  if (m) return m[1];
  return null;
}

function lastIndexMatching(lines: string[], re: RegExp): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) idx = i;
  return idx;
}

function parseCorpus(text: string): Corpus {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);

  const dateM = clean.match(/effective as of ([^.\n]+)\./i);
  const effectiveDate = dateM ? dateM[1].trim() : "";

  // Der Regeltext liegt zwischen dem ZWEITEN "100. General" (das erste steht im
  // Inhaltsverzeichnis) und dem ECHTEN "Glossary"; danach folgt "Credits".
  // Beide Marker kommen genau zweimal vor — das letzte Vorkommen ist der Body.
  const rulesStart = lastIndexMatching(lines, /^100\.\s+General\s*$/);
  const glossStart = lastIndexMatching(lines, /^Glossary\s*$/);
  const creditsStart = lastIndexMatching(lines, /^Credits\s*$/);

  const rules = new Map<string, Rule>();
  const order: string[] = [];
  let cur: Rule | null = null;
  const end = glossStart > rulesStart ? glossStart : lines.length;
  for (let i = Math.max(0, rulesStart); i < end; i++) {
    const line = lines[i];
    const key = ruleKeyOf(line);
    if (key) {
      if (cur) cur.text = cur.text.trim();
      cur = { num: key, text: line };
      // Doppelte Nummern kann es nicht geben; falls doch, gewinnt das erste.
      if (!rules.has(key)) { rules.set(key, cur); order.push(key); }
    } else if (cur) {
      cur.text += "\n" + line;
    }
  }
  if (cur) cur.text = cur.text.trim();

  // Glossar: durch Leerzeilen getrennte Blöcke, erste Zeile = Begriff.
  const glossary = new Map<string, Gloss>();
  let block: string[] = [];
  const flush = () => {
    if (block.length) {
      const term = block[0].trim();
      const def = block.slice(1).join(" ").replace(/\s+/g, " ").trim();
      if (term && def) glossary.set(term.toLowerCase(), { term, def });
    }
    block = [];
  };
  if (glossStart >= 0) {
    const gend = creditsStart > glossStart ? creditsStart : lines.length;
    for (let i = glossStart + 1; i < gend; i++) {
      if (lines[i].trim() === "") flush();
      else block.push(lines[i]);
    }
    flush();
  }

  return { rules, order, glossary, effectiveDate };
}

async function ladeCorpus(): Promise<Corpus> {
  if (corpusPromise) return corpusPromise;
  corpusPromise = (async () => {
    const url = Deno.env.get("RULES_TXT_URL") || DEFAULT_RULES_URL;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const text = await r.text();
      const c = parseCorpus(text);
      if (c.rules.size < 500) throw new Error("Regeltext unerwartet klein/leer");
      return c;
    } finally {
      clearTimeout(to);
    }
  })();
  // Bei einem Fehlschlag nicht dauerhaft merken — nächster Aufruf darf neu laden.
  corpusPromise.catch(() => { corpusPromise = null; });
  return corpusPromise;
}

// ------------------------------------------------------------------ //
//  Retrieval: aus Triage-Vorschlägen den echten Regeltext zusammenstellen.
// ------------------------------------------------------------------ //
const STOP = new Set(
  ("the a an and or of to in is are be it its as with for on at by that this if then when " +
   "can cant does do you your they them may must will would could should have has had which " +
   "who whose what how why where into from than not no yes all any each some card cards").split(" "),
);

function expandRule(CR: Corpus, key: string, maxSub = 50): string[] {
  const out: string[] = [];
  if (CR.rules.has(key)) out.push(key);
  const sec = key.slice(0, 3);
  if (CR.rules.has(sec)) out.push(sec);
  const subRe = /^\d{3}\.\d+$/.test(key)
    ? new RegExp("^" + key.replace(".", "\\.") + "[a-z]$")
    : null;
  const sub: string[] = [];
  for (const k of CR.order) {
    if (k === key) continue;
    if (k.startsWith(key + ".") || (subRe && subRe.test(k)) ||
        (/^\d{3}$/.test(key) && k.startsWith(key + "."))) sub.push(k);
  }
  return [...new Set(out.concat(sub.slice(0, maxSub)))];
}

interface Triage {
  needsClarification?: boolean;
  clarifyingQuestions?: string[];
  keywords: string[];
  glossaryTerms: string[];
  candidateRules: string[];
}

function retrieve(CR: Corpus, tr: Triage, maxChars = 90000) {
  const picked = new Set<string>();
  const cites: Rule[] = [];
  const add = (key: string) => {
    if (!key || picked.has(key) || !CR.rules.has(key)) return;
    picked.add(key);
    cites.push(CR.rules.get(key)!);
  };
  for (const c of tr.candidateRules || []) {
    const key = String(c).trim().replace(/[^\d.a-z]/gi, "");
    for (const k of expandRule(CR, key)) add(k);
  }

  const gloss: Gloss[] = [];
  for (const term of tr.glossaryTerms || []) {
    const key = String(term).toLowerCase().trim();
    if (!key) continue;
    let g = CR.glossary.get(key);
    if (!g) for (const [k, v] of CR.glossary) if (k.startsWith(key)) { g = v; break; }
    if (g && !gloss.find((x) => x.term === g!.term)) gloss.push(g);
  }

  // Stichwort-Bewertung fängt, was das Modell nicht als Regelnummer nannte.
  const kw = [...new Set((tr.keywords || [])
    .map((s) => String(s).toLowerCase().trim())
    .filter((w) => w.length > 2 && !STOP.has(w)))];
  if (kw.length) {
    const scored: { key: string; s: number }[] = [];
    for (const key of CR.order) {
      if (picked.has(key)) continue;
      const low = CR.rules.get(key)!.text.toLowerCase();
      let s = 0;
      for (const w of kw) if (low.includes(w)) s++;
      if (s > 0) scored.push({ key, s });
    }
    scored.sort((a, b) => b.s - a.s);
    for (const { key } of scored.slice(0, 25)) add(key);
  }

  // Zusammenstellen, hart gedeckelt (Kostenschranke).
  let ctx = "";
  const used: string[] = [];
  for (const c of cites) {
    if (ctx.length + c.text.length > maxChars) break;
    ctx += c.text + "\n\n";
    used.push(c.num);
  }
  return { context: ctx, rules: used, glossary: gloss };
}

// ------------------------------------------------------------------ //
//  Schemata für die beiden Modell-Aufrufe.
// ------------------------------------------------------------------ //
const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    needsClarification: {
      type: "boolean",
      description: "true, wenn WESENTLICHE Angaben fehlen oder die Schilderung so mehrdeutig ist, dass sich die Situation nicht eindeutig klären lässt. false, wenn der Kern klar genug ist.",
    },
    clarifyingQuestions: {
      type: "array", items: { type: "string" },
      description: "Bei needsClarification=true: 1-3 kurze, gezielte Rückfragen in der Zielsprache, deren Beantwortung zur eindeutigen Klärung nötig ist. Sonst leer.",
    },
    keywords: {
      type: "array", items: { type: "string" },
      description: "5-12 englische Stichwörter aus der Regelsprache (z. B. 'deathtouch', 'combat damage', 'state-based action'), die zur Situation passen. Bei Rückfragen darf die Liste leer bleiben.",
    },
    glossaryTerms: {
      type: "array", items: { type: "string" },
      description: "Englische Glossarbegriffe der Comprehensive Rules, die hier einschlägig sind (z. B. 'Trample', 'Commander', 'First Strike'). Leer, wenn keiner passt.",
    },
    candidateRules: {
      type: "array", items: { type: "string" },
      description: "Vermutete Regelnummern der Comprehensive Rules als Zeichenketten (z. B. '509.1', '702.19', '704.5'). Grob raten ist erwünscht — der echte Text wird danach geladen, nicht deine Erinnerung.",
    },
  },
  required: ["needsClarification", "clarifyingQuestions", "keywords", "glossaryTerms", "candidateRules"],
  additionalProperties: false,
} as const;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    ruling: {
      type: "string",
      description: "Das Ergebnis in 1-3 klaren Sätzen: was in dieser Situation regeltechnisch gilt.",
    },
    reasoning: {
      type: "string",
      description: "Nachvollziehbare Begründung Schritt für Schritt, mit Regelnummern in Klammern. Nur auf die übergebenen Regelauszüge stützen.",
    },
    citedRules: {
      type: "array", items: { type: "string" },
      description: "Die Regelnummern (z. B. '509.1a'), auf die sich das Urteil tatsächlich stützt. Nur Nummern, die in den übergebenen Auszügen vorkommen.",
    },
    confidence: {
      type: "string", enum: ["high", "medium", "low"],
      description: "high nur, wenn die Auszüge die Frage eindeutig beantworten.",
    },
    caveat: {
      type: "string",
      description: "Annahmen, Sonderfälle oder wann eine offizielle Schiedsrichter-Klärung nötig ist. Leer, wenn nichts einzuschränken ist.",
    },
  },
  required: ["ruling", "reasoning", "citedRules", "confidence", "caveat"],
  additionalProperties: false,
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  // Ohne gültige Anmeldung kein Zugriff — sonst könnte jeder mit der
  // Funktions-URL auf unsere Rechnung Fragen stellen.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Nicht angemeldet" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return json({ error: "Nicht angemeldet" }, 401);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 500);

  let situation = "", lang = "de", context = "";
  try {
    const body = await req.json();
    lang = SPRACHE[body.lang] ? String(body.lang) : "de";
    situation = String(body.situation ?? "").trim().slice(0, 4000);
    context = String(body.context ?? "").trim().slice(0, 1000);
    if (situation.length < 5) throw new Error("Bitte die Situation kurz schildern.");
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const langName = SPRACHE[lang];
  const anthropic = new Anthropic({ apiKey: key });
  let usedIn = 0, usedOut = 0, model = MODEL_JUDGE;
  const track = (u: { input_tokens: number; output_tokens: number }) => {
    usedIn += u.input_tokens; usedOut += u.output_tokens;
  };

  // Das Regelwerk laden — scheitert es (Netz, veraltete URL), antworten wir im
  // abgesicherten Modus aus dem Modellwissen mit deutlichem Hinweis. Ein Ausfall
  // soll das Feature nicht hart brechen (wie scan-card auf Tesseract zurückfällt).
  let CR: Corpus | null = null;
  try { CR = await ladeCorpus(); } catch { CR = null; }

  const SITU = `Situation:\n${situation}${context ? `\n\nZusatzinfo: ${context}` : ""}`;

  try {
    let ctxText = "", usedRules: string[] = [], usedGloss: Gloss[] = [];

    // --- 1. Triage: verstehen, ob die Situation klar genug ist, und (wenn ja)
    //     die passenden Regeln vorschlagen. Läuft immer (auch im abgesicherten
    //     Modus ohne Regeltext), denn die Rückfrage-Entscheidung braucht nur die
    //     Schilderung, keinen Regeltext.
    const tri = await anthropic.messages.create({
      model: MODEL_TRIAGE,
      max_tokens: 700,
      system:
        `Du hilfst bei Magic: The Gathering-Regelfragen und hast ZWEI Aufgaben:

1) ENTSCHEIDEN, ob die geschilderte Situation klar genug ist, um sie eindeutig zu klären. Setze needsClarification=true und stelle 1-3 kurze, gezielte Rückfragen (Feld clarifyingQuestions, formuliert auf ${langName}), wenn WESENTLICHE Angaben fehlen oder die Schilderung mehrdeutig ist — etwa wenn unklar bleibt, welche Karten oder Fähigkeiten beteiligt sind, wer am Zug ist, in welcher Phase oder Zone es passiert, oder wenn die Frage zu allgemein gestellt ist, um sie konkret zu beantworten. Frage NUR nach, wenn die Antwort ohne diese Angabe wirklich anders ausfiele; ist der Kern klar, setze needsClarification=false und benenne offene Randannahmen lieber später im Urteil, statt unnötig nachzufragen.

2) Wenn klar genug (needsClarification=false): nenne Suchbegriffe, Glossarbegriffe und vermutete Regelnummern (englisch), damit der echte Regeltext geladen werden kann. Sei großzügig: lieber ein paar Kandidaten zu viel. Bei Rückfragen dürfen diese Felder leer bleiben.`,
      output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: SITU }] }],
    });
    track(tri.usage);
    let tr: Triage = { needsClarification: false, clarifyingQuestions: [], keywords: [], glossaryTerms: [], candidateRules: [] };
    const tt = tri.content.find((b) => b.type === "text");
    if (tt && tt.type === "text") { try { tr = JSON.parse(tt.text); } catch { /* leer lassen */ } }

    // Braucht das Modell erst eine Rückfrage, hört es HIER auf: keine
    // Regelsuche, kein (teures) Urteil, nur die Fragen zurück. Der Nutzer
    // ergänzt und fragt erneut.
    const fragen = (tr.clarifyingQuestions || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3);
    if (tr.needsClarification && fragen.length) {
      return json({
        clarify: true,
        questions: fragen,
        rulesDate: CR?.effectiveDate || "",
        usage: { input: usedIn, output: usedOut, model: tri.model },
      });
    }

    if (CR) {
      const r = retrieve(CR, tr);
      usedRules = r.rules;
      usedGloss = r.glossary;
      const glossBlock = usedGloss.length
        ? "Glossar:\n" + usedGloss.map((g) => `${g.term}: ${g.def}`).join("\n") + "\n\n"
        : "";
      ctxText = glossBlock + (r.context || "");
    }

    // --- 2. Urteil ---
    const grounded = !!CR && ctxText.trim().length > 0;
    const SYSTEM = grounded
      ? `Du bist ein erfahrener, neutraler Magic: The Gathering-Schiedsrichter. Du klärst eine strittige Spielsituation ausschließlich anhand der DIR ÜBERGEBENEN Auszüge aus den offiziellen Comprehensive Rules.

Strikte Regeln:
- Stütze dich NUR auf die übergebenen Regelauszüge. Erfinde keine Regelnummern und keine Regelinhalte. Reichen die Auszüge nicht aus, sag das offen und nenne, welche Regelbereiche zu prüfen wären.
- Nenne im Begründungstext die einschlägigen Regelnummern in Klammern, z. B. „(509.1a)".
- Gib ein klares, praxistaugliches Urteil. Wenn die Antwort von einer Annahme abhängt (z. B. genaue Karte, Reihenfolge, Timing), benenne die Annahme im Feld caveat.
- Antworte durchgehend auf ${langName}. Regelnummern und in Klammern zitierte Original-Formulierungen bleiben in der Originalsprache.`
      : `Du bist ein erfahrener, neutraler Magic: The Gathering-Schiedsrichter. Der offizielle Regeltext konnte GERADE NICHT geladen werden, du antwortest daher aus deinem Regelwissen — mit entsprechender Vorsicht.

Strikte Regeln:
- Antworte so genau wie möglich und nenne Regelnummern nur, wenn du dir sicher bist.
- Setze confidence höchstens auf "medium" und weise im Feld caveat darauf hin, dass ohne den offiziellen Regeltext geantwortet wurde und die Regelnummern zur Sicherheit im Comprehensive-Rulebook geprüft werden sollten.
- Antworte durchgehend auf ${langName}.`;

    const USER = grounded
      ? `${SITU}\n\n---\nRelevante Auszüge aus den Comprehensive Rules (WÖRTLICH, Originalsprache):\n\n${ctxText}\n---\nKläre die Situation auf Basis dieser Auszüge.`
      : `${SITU}\n\nKläre die Situation.`;

    const res = await anthropic.messages.create({
      model: MODEL_JUDGE,
      max_tokens: 1600,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: USER }] }],
    });
    track(res.usage);
    model = res.model;

    if (res.stop_reason === "refusal")
      return json({ error: "Anfrage wurde abgelehnt" }, 422);
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      return json({ error: "Keine verwertbare Antwort" }, 502);

    const out = JSON.parse(text.text) as {
      ruling: string; reasoning: string; citedRules: string[];
      confidence: string; caveat: string;
    };

    // Zitate NICHT vom Modell übernehmen, sondern den Regeltext 1:1 aus unserer
    // geparsten Fassung nachschlagen. Erfundene Nummern fallen dabei heraus —
    // gezeigt wird immer die echte Formulierung, nie eine Paraphrase.
    const citations: { rule: string; text: string }[] = [];
    if (CR) {
      const seen = new Set<string>();
      const wanted = [...(out.citedRules || []), ...usedRules];   // zusätzlich das Abgerufene
      for (const rnum of wanted) {
        const knum = String(rnum).trim().replace(/[^\d.a-z]/gi, "");
        if (!knum || seen.has(knum)) continue;
        const rule = CR.rules.get(knum);
        if (rule) { seen.add(knum); citations.push({ rule: rule.num, text: rule.text }); }
        if (citations.length >= 12) break;
      }
    }

    return json({
      ruling: out.ruling,
      reasoning: out.reasoning,
      confidence: out.confidence,
      caveat: out.caveat || "",
      citations,
      glossary: usedGloss,
      degraded: !grounded,
      rulesDate: CR?.effectiveDate || "",
      usage: { input: usedIn, output: usedOut, model },
    });
  } catch (e) {
    const m = (e as Error).message ?? "Unbekannter Fehler";
    if (/credit balance/i.test(m))
      return json({ error: "Anthropic-Guthaben aufgebraucht — unter Plans & Billing aufladen.", code: "no_credit" }, 402);
    if (/401|authentication/i.test(m))
      return json({ error: "Anthropic-Schlüssel ungültig oder widerrufen.", code: "bad_key" }, 502);
    if (/429|rate.?limit/i.test(m))
      return json({ error: "Zu viele Anfragen — kurz warten.", code: "rate_limit" }, 429);
    if (/invalid_request_error/i.test(m))
      return json({ error: "Anfrage wurde abgelehnt: " + m.slice(0, 200), code: "bad_request" }, 400);
    return json({ error: m.slice(0, 300), code: "unknown" }, 500);
  }
});
