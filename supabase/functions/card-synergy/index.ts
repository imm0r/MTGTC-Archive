// =====================================================================
//  Edge Function "card-synergy"
//
//  Schlägt zu einer Karte synergistische Karten vor — mit Schwerpunkt auf
//  IMPLIZITEN Synergien (Karten, die ohne gemeinsame Schlüsselwörter/Typen gut
//  zusammenspielen), die die heuristische Scryfall-Suche im Client nicht findet.
//
//  Wie scan-card existiert sie nur, weil der Anthropic-Schlüssel nicht in die
//  App darf. Das Modell nennt nur Kartennamen + Begründung; ob eine Karte
//  wirklich existiert, prüft der Client danach gegen Scryfall (kein Vertrauen
//  auf erfundene Namen).
// =====================================================================

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Implizite Synergie ist Reasoning-Arbeit — hier zählt Kartenkenntnis und
// Kontext, nicht Kosten wie beim reinen Ablesen. Wechsel ist diese eine Zeile.
const MODEL = "claude-sonnet-4-6";

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

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      description: "Die vorgeschlagenen Karten, stärkste Synergie zuerst.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exakter englischer Kartenname einer ECHTEN Magic-Karte." },
          reason: { type: "string", description: "Ein einziger, konkreter Satz: der Synergie-MECHANISMUS (nicht bloß 'starke Karte'). In der gewünschten Sprache." },
          replaces: { type: "string", description: "Nur wenn das Deck voll ist: der EXAKTE englische Name EINER Karte aus der übergebenen Deckliste, die für diesen Vorschlag weichen sollte. Nicht der Commander. Sonst leerer String." },
          replacesWhy: { type: "string", description: "Nur wenn replaces gesetzt ist: ein einziger, konkreter Satz, WARUM genau diese Karte weichen sollte — gestützt AUSSCHLIESSLICH auf den in der Kartenliste gelieferten Regeltext dieser Karte. Nicht 'sie ist schwächer', sondern der Grund. In der gewünschten Sprache. Sonst leerer String." },
        },
        required: ["name", "reason", "replaces", "replacesWhy"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

/* Verfahren C — der Beleg. Ein Zitat laesst sich pruefen, eine Behauptung
   nicht: deshalb ist die Textstelle WOERTLICH verlangt und wird hinterher
   gegen den gelieferten Regeltext gehalten. Findet sie sich dort nicht, hat
   das Modell erfunden.

   Der leere String ist ausdruecklich erlaubt: stuetzt sich die Begruendung
   auf das FEHLEN eines Effekts oder auf die Manakosten, gibt es keine Stelle
   zum Zitieren. Ohne diese Ausnahme wuerde das Modell eine erfinden — genau
   das Verhalten, das wir abstellen wollen. */
const SCHEMA_BELEG = structuredClone(SCHEMA) as Record<string, any>;
{
  const it = SCHEMA_BELEG.properties.suggestions.items;
  it.properties.replacesQuote = {
    type: "string",
    description: "Nur wenn replaces gesetzt ist: die WÖRTLICHE Textstelle aus dem oben gelieferten Regeltext GENAU DIESER Karte, auf die sich replacesWhy stützt — Zeichen für Zeichen kopiert, englisch wie geliefert, nicht übersetzt und nicht umformuliert. Höchstens ein Satz. Stützt sich die Begründung auf das FEHLEN eines Effekts oder allein auf die Manakosten, dann leerer String — erfinde in dem Fall keine Stelle.",
  };
  it.required = [...it.required, "replacesQuote"];
}

/* Verfahren A — das Urteil. Eigener, knapper Aufruf: hier wird geprueft,
   nicht formuliert. Vorgelegt werden nur die strittigen Karten mit ihrem
   Regeltext und der Behauptung. */
const SCHEMA_URTEIL = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          card: { type: "string", description: "Exakter englischer Name der geprüften Karte, wie vorgelegt." },
          supported: { type: "boolean", description: "true, wenn der vorgelegte Regeltext die Behauptung trägt. false, wenn die Begründung der Karte etwas zuschreibt, was ihr Regeltext nicht hergibt." },
          note: { type: "string", description: "Bei supported=false: in EINEM kurzen Satz, was die Begründung behauptet, das der Regeltext nicht deckt. Sonst leerer String." },
        },
        required: ["card", "supported", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

const SPRACHE: Record<string, string> = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  // Ohne gültige Anmeldung kein Zugriff — sonst könnte jeder mit der
  // Funktions-URL auf unsere Rechnung Vorschläge erzeugen.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Nicht angemeldet" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return json({ error: "Nicht angemeldet" }, 401);

  // Globaler Feature-Schalter: Nur wenn der Admin die KI-Synergien freigeschaltet
  // hat, laufen (kostenpflichtige) Anfragen — die echte Sperre sitzt HIER, nicht
  // nur im Ausblenden des Knopfes. Jeder Angemeldete darf feature_flags lesen.
  const { data: flag } = await sb.from("feature_flags").select("enabled").eq("key", "ki_synergy").maybeSingle();
  if (!flag?.enabled) return json({ error: "KI-Synergien sind derzeit deaktiviert.", code: "disabled" }, 403);

  // Stundenkontingent je Person. Wie beim Feature-Schalter sitzt die echte
  // Sperre HIER: wer angemeldet ist, könnte die Funktions-URL sonst unmittelbar
  // aufrufen und eine Zählung im Browser wäre in Sekunden umgangen.
  const { data: quota, error: quotaErr } = await sb.rpc("claim_ai_quota", {
    p_kind: "ki_synergy",
    p_limit: 5,
  });
  if (quotaErr) {
    return json({ error: "Kontingent konnte nicht geprüft werden.", code: "quota_error" }, 500);
  }
  if (!quota?.ok) {
    // reset_at bleibt roh — die lokale Uhrzeit rechnet der Browser aus, der
    // Server steht auf UTC und kennt die Zeitzone des Aufrufers nicht.
    return json({
      error: "Stundenlimit für KI-Synergien erreicht.",
      code: "quota",
      reset_at: quota?.reset_at ?? null,
    }, 429);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 500);

  let mode = "card", lang = "de", n = 10, colors = "";
  let name = "", typeLine = "", oracle = "";
  // Deckkarte fürs Modell: Name, Typzeile, Regeltext. Der Regeltext ist der
  // Punkt — ohne ihn muss das Modell über jede Karte raten, die es nicht aus
  // dem Training kennt, und rät bei neuen Sets aus dem Namen.
  type DeckKarte = { n: string; t?: string; o?: string; m?: string };
  let deckName = "", deckFormat = "", commander = "", deckCards: DeckKarte[] = [];
  let deckVoll = false;
  try {
    const body = await req.json();
    lang = SPRACHE[body.lang] ? String(body.lang) : "de";
    n = Math.max(3, Math.min(15, Number(body.n) || 10));
    if (body.deck) {
      // Deck-global: die ganze Deckliste ist der Kontext.
      mode = "deck";
      const d = body.deck;
      deckName = String(d.name ?? "").slice(0, 120);
      deckFormat = String(d.format ?? "").slice(0, 60);
      commander = String(d.commander ?? "").slice(0, 120);
      colors = String(d.colorIdentity ?? "").replace(/[^WUBRGC]/gi, "").toUpperCase();
      // Beide Formen annehmen: der ältere Client schickt blanke Namen, der
      // neuere Objekte mit Typzeile und Regeltext. Sonst bricht die Funktion
      // jeden Client, der noch nicht nachgezogen ist.
      deckCards = Array.isArray(d.cards)
        ? d.cards.map((x: unknown): DeckKarte => typeof x === "string"
            ? { n: x.slice(0, 80) }
            : {
                n: String((x as DeckKarte)?.n ?? "").slice(0, 80),
                t: String((x as DeckKarte)?.t ?? "").slice(0, 120),
                o: String((x as DeckKarte)?.o ?? "").slice(0, 300),
                m: String((x as DeckKarte)?.m ?? "").slice(0, 40),
              })
          .filter((c) => c.n).slice(0, 120)
        : [];
      deckVoll = !!d.full;
      if (!deckCards.length) throw new Error("Leere Deckliste");
    } else {
      const c = body.card ?? {};
      name = String(c.name ?? "").slice(0, 120);
      typeLine = String(c.type_line ?? "").slice(0, 200);
      oracle = String(c.oracle_text ?? "").slice(0, 1200);
      colors = String(body.colorIdentity ?? "").replace(/[^WUBRGC]/gi, "").toUpperCase();
      if (!name) throw new Error("Keine Karte übergeben");
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // Welche Prüfverfahren gelten für DIESE Person? effective_features() führt
  // den globalen Schalter und die Einzelfreigabe zusammen — dieselbe Abfrage,
  // die auch die Oberfläche stellt, damit beide nie Verschiedenes glauben.
  // Entscheidend ist, dass die Antwort HIER fällt und nicht im Client: sonst
  // könnte jeder ein Verfahren anfordern, für das er nicht freigeschaltet ist,
  // und die Kosten dafür auf unsere Rechnung auslösen.
  // Beide greifen nur beim vollen Deck — nur dort gibt es überhaupt eine
  // Schnitt-Begründung, die sich prüfen ließe.
  let features: string[] = [];
  try {
    const { data } = await sb.rpc("effective_features");
    features = Array.isArray(data) ? data : [];
  } catch { features = []; }
  const mitBeleg  = mode === "deck" && deckVoll && features.includes("verify_cite");
  const mitUrteil = mode === "deck" && deckVoll && features.includes("verify_model");
  // Zwei Datenlücken, die Falschpositive erzeugt haben, jeweils einzeln
  // zuschaltbar:
  //   verify_cost — Manakosten stehen nicht im Regeltext. Ohne sie kann der
  //                 Prüfer „kostet vier Mana" nicht bestätigen und verwirft
  //                 eine richtige Begründung.
  //   verify_pair — die vorgeschlagene Karte lag dem Prüfer gar nicht vor.
  //                 Ein Vergleichssatz war damit strukturell halb unbelegbar.
  const mitKosten = mode === "deck" && features.includes("verify_cost");
  const mitPaar   = mitUrteil && features.includes("verify_pair");

  const farbHinweis = colors
    ? `\n- Farbidentität: Jede genannte Karte muss in die Farbidentität {${colors}} passen (alle Mana-Symbole und Farbidentitäts-Anteile liegen innerhalb dieser Farben).`
    : "";

  const SYSTEM = mode === "deck"
    ? `Du bist ein Deckbau-Experte für Magic: The Gathering mit enzyklopädischer Kartenkenntnis. Zu einem gegebenen Deck nennst du Karten, die die GESAMTSTRATEGIE des Decks am besten ergänzen — mit ausdrücklichem Schwerpunkt auf NICHT offensichtlichen, IMPLIZITEN Synergien: Karten, die keine Schlüsselwörter teilen, aber mechanisch hervorragend ins Deck greifen (Enabler, Payoffs, Combos, Value-Engines, Schutz für Schlüsselkarten).

Strikte Regeln:
- Nenne ausschließlich ECHTE, existierende Magic-Karten mit ihrem exakten englischen Namen. Erfinde nichts. Bist du dir bei Existenz oder Schreibweise unsicher, lass die Karte weg.
- ZUM DECK SELBST: Die Kartenliste enthält Typzeile und Regeltext. Stütze JEDE Aussage über eine Karte aus dem Deck ausschließlich auf diesen Text — niemals auf Erinnerung. Das Deck enthält Karten aus Sets, die nach deinem Trainingsstand erschienen sind; deren Namen legen oft etwas völlig anderes nahe als ihr tatsächlicher Regeltext. Was im gelieferten Text nicht steht, behauptest du nicht.
- Keine Standardländer (Basic Lands). Schlage keine Karte vor, die bereits im Deck ist.${farbHinweis}
- Erkenne zuerst die Strategie und die Themen des Decks (Commander/Schlüsselkarten, wiederkehrende Mechaniken) und schlage Karten vor, die genau darauf einzahlen.
- Je Karte eine EINZIGE, konkrete Begründung, die den Synergie-Mechanismus MIT DEM DECK benennt, nicht bloß "gute Karte". Formuliere die Begründung auf ${SPRACHE[lang]}.
- Bevorzuge kluge, unerwartete Synergien. Sortiere die überzeugendsten nach oben.`
    : `Du bist ein Deckbau-Experte für Magic: The Gathering mit enzyklopädischer Kartenkenntnis. Zu einer gegebenen Karte nennst du Karten, die besonders gut mit ihr zusammenspielen — mit ausdrücklichem Schwerpunkt auf NICHT offensichtlichen, IMPLIZITEN Synergien: Karten, die keine Schlüsselwörter oder Kreaturentypen teilen, aber mechanisch hervorragend zusammenwirken (Enabler, Payoffs, Combos, Schutz für die Schlüsselkarte, Value-Engines, Kombinationen, die zusammen mehr sind als einzeln).

Strikte Regeln:
- Nenne ausschließlich ECHTE, existierende Magic-Karten mit ihrem exakten englischen Namen. Erfinde nichts. Bist du dir bei Existenz oder Schreibweise unsicher, lass die Karte weg — eine weggelassene Karte ist besser als eine erfundene.
- Keine Standardländer (Basic Lands). Schlage die Ausgangskarte nicht selbst vor.${farbHinweis}
- Je Karte eine EINZIGE, konkrete Begründung, die den Synergie-Mechanismus benennt (WARUM sie zusammen stark sind), nicht bloß "gute Karte". Formuliere die Begründung auf ${SPRACHE[lang]}.
- Bevorzuge unerwartete, kluge Synergien gegenüber offensichtlichen Kopien desselben Schlüsselworts. Sortiere die überzeugendsten Synergien nach oben.`;

  // Mit Regeltext eine Zeile je Karte, ohne (alter Client, Standardländer) nur
  // der Name. Zeilenumbrüche im Regeltext werden zu Leerzeichen, damit eine
  // Karte eine Zeile bleibt und die Liste lesbar ist.
  const kartenBlock = deckCards
    .map((c) => c.t || c.o
      ? `- ${c.n}${mitKosten && c.m ? ` ${c.m}` : ""}${c.t ? ` — ${c.t}` : ""}${c.o ? `: ${c.o.replace(/\s*\n\s*/g, " ")}` : ""}`
      : `- ${c.n}`)
    .join("\n");
  const hatText = deckCards.some((c) => c.o);
  const hatKosten = mitKosten && deckCards.some((c) => c.m);

  const USER = mode === "deck"
    ? `Deck: ${deckName || "(ohne Namen)"}${deckFormat ? ` — Format: ${deckFormat}` : ""}${commander ? `\nCommander/Schlüsselkarte: ${commander}` : ""}${colors ? `\nFarbidentität: {${colors}}` : ""}
Kartenliste (${deckCards.length})${hatText ? `${hatKosten ? " mit Manakosten, Typzeile" : " mit Typzeile"} und Regeltext` : ""}:
${kartenBlock}

Nenne ${n} Karten, die die Strategie dieses Decks am besten ergänzen.${deckVoll ? `\n\nDas Deck ist VOLL (100 Karten). Nenne deshalb je Vorschlag im Feld replaces den exakten englischen Namen EINER Karte aus der obigen Liste, die dafür weichen sollte — die schwächste oder am wenigsten zur Strategie passende. Niemals den Commander. Jede Karte höchstens einmal nennen.\n\nBegründe in replacesWhy in EINEM Satz, warum genau diese Karte weichen sollte: was sie in diesem Deck konkret schlechter leistet als der Vorschlag — zu langsam, redundant zu einer bereits vorhandenen Karte, passt nicht zur Farbidentität, zu hohe Kosten für den Effekt. Kein Allgemeinplatz wie 'sie ist schwächer'.\n\nDie Begründung muss sich auf den OBEN GELIEFERTEN Regeltext dieser Karte stützen. Schreibe der Karte nichts zu, was dort nicht steht — kein Effekt, kein Tokentyp, kein Zählmarken-Verhalten. Passt der gelieferte Text nicht zu dem, was du über den Namen zu wissen glaubst, gilt der Text.${mitBeleg ? "\n\nGib zusätzlich in replacesQuote die wörtliche Stelle aus dem oben gelieferten Regeltext an, auf die sich deine Begründung stützt — Zeichen für Zeichen kopiert, englisch wie geliefert. Stützt sich die Begründung auf das FEHLEN eines Effekts oder allein auf die Manakosten, lass das Feld leer; erfinde dann keine Stelle." : ""}` : ""}`
    : `Ausgangskarte:
Name: ${name}
Typzeile: ${typeLine}
Regeltext: ${oracle || "(kein Regeltext)"}

Nenne ${n} synergistische Karten.`;

  // Die Obergrenze muss mitwachsen, wenn die Antwort mehr Text trägt: im
  // Deck-Modus schreibt das Modell je Vorschlag ZWEI ganze Sätze (reason und,
  // bei vollem Deck, replacesWhy). Mit den früheren festen 1500 Tokens brach
  // die Antwort bei zwölf Vorschlägen mitten im String ab — JSON.parse
  // scheiterte dann mit „Unterminated string in JSON".
  // Die Grenze ist eine Decke, keine Vorgabe: bezahlt wird, was wirklich
  // geschrieben wird, nicht was erlaubt wäre.
  // Mit Beleg traegt jeder Vorschlag zusaetzlich ein Zitat — dieselbe Lehre
  // wie beim letzten Mal: waechst das Feld, muss das Budget mitwachsen.
  const maxTokens = mode === "deck"
    ? Math.min(8000, 1000 + n * (mitBeleg ? 300 : 220))
    : 1500;

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: mitBeleg ? SCHEMA_BELEG : SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: USER }] }],
    });

    if (res.stop_reason === "refusal")
      return json({ error: "Anfrage wurde abgelehnt" }, 422);
    // Abgeschnitten: sagen, was los ist, statt den Parser darüber stolpern zu
    // lassen. „Unterminated string in JSON at position 4337" ist für niemanden
    // eine brauchbare Auskunft.
    if (res.stop_reason === "max_tokens")
      return json({ error: "Die Antwort wurde abgeschnitten. Stelle unter „max. Vorschläge“ einen kleineren Wert ein und versuche es erneut.", code: "truncated" }, 502);
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      return json({ error: "Keine verwertbare Antwort" }, 502);

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(text.text);
    } catch {
      return json({ error: "Die Antwort war unvollständig und konnte nicht gelesen werden.", code: "bad_json" }, 502);
    }

    let inTok = res.usage.input_tokens, outTok = res.usage.output_tokens;
    const vorschlaege: Record<string, any>[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

    // ---- Verfahren C: den Beleg gegen den echten Regeltext halten ----------
    // Reiner Textvergleich, kostet nichts. Normalisiert wird grosszuegig
    // (Kleinschreibung, Satzzeichen, Mehrfach-Leerzeichen), damit das Modell
    // nicht an einem Gedankenstrich scheitert — geprueft wird, ob die Stelle
    // ueberhaupt aus dieser Karte stammt, nicht ob sie perfekt abgetippt ist.
    const norm = (s: string) => (s || "").toLowerCase()
      .replace(/[‐-―]/g, "-").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const textVon = new Map(deckCards.map((c) => [c.n.toLowerCase(), norm(c.o || "")]));

    if (mitBeleg) {
      for (const s of vorschlaege) {
        if (!s.replaces) continue;
        const quelle = textVon.get(String(s.replaces).toLowerCase()) ?? "";
        const zitat = norm(String(s.replacesQuote ?? ""));
        // Ohne Zitat bleibt es ungeprueft, nicht widerlegt: die Begruendung
        // darf sich auf das Fehlen eines Effekts oder die Kosten stuetzen.
        s.verify = !zitat
          ? { ok: null, method: "cite", note: "" }
          : { ok: quelle.includes(zitat), method: "cite", quote: String(s.replacesQuote), note: "" };
      }
    }

    // ---- Verfahren A: nur die strittigen Faelle dem Modell vorlegen --------
    // Eskalation, kein Rundumschlag: geprueft wird, was C durchfallen liess
    // (oder alles, wenn C nicht laeuft). Vorgelegt werden nur Regeltext und
    // Behauptung — nicht das ganze Deck, das braucht ein Urteil nicht.
    if (mitUrteil) {
      const strittig = vorschlaege.filter((s) =>
        s.replaces && s.replacesWhy && (!mitBeleg || s.verify?.ok === false || s.verify?.ok === null));
      if (strittig.length) {
        // Mit verify_pair bekommt der Prüfer auch die VORGESCHLAGENE Karte.
        // Ihr Text liegt hier nicht vor — das Modell hat sie nur benannt —,
        // also von Scryfall holen. Kostet keine Tokens, nur einen Request.
        const paarTexte = new Map<string, string>();
        if (mitPaar) {
          const namen = [...new Set(strittig.map((s) => String(s.name || "")).filter(Boolean))].slice(0, 40);
          if (namen.length) {
            try {
              const r = await fetch("https://api.scryfall.com/cards/collection", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ identifiers: namen.map((n) => ({ name: n })) }),
              });
              if (r.ok) {
                for (const c of (await r.json()).data || []) {
                  const txt = c.oracle_text ?? c.card_faces?.[0]?.oracle_text ?? "";
                  paarTexte.set(String(c.name).toLowerCase(),
                    `${c.mana_cost || ""} — ${c.type_line || ""}: ${String(txt).replace(/\s*\n\s*/g, " ").slice(0, 300)}`);
                }
              }
            } catch { /* ohne Vergleichstext prueft er eben nur die Deckkarte */ }
          }
        }
        const vorlage = strittig.map((s, i) => {
          const dk = deckCards.find((c) => c.n.toLowerCase() === String(s.replaces).toLowerCase());
          const paar = paarTexte.get(String(s.name || "").toLowerCase());
          return `${i + 1}. Karte: ${s.replaces}${mitKosten && dk?.m ? `\n   Manakosten: ${dk.m}` : ""}`
            + `\n   Regeltext: ${dk?.o || "(keiner geliefert)"}`
            + (paar ? `\n   Verglichen mit (Vorschlag): ${s.name} ${paar}` : "")
            + `\n   Behauptung: ${s.replacesWhy}`;
        }).join("\n\n");
        try {
          const pruef = await anthropic.messages.create({
            model: MODEL,
            max_tokens: Math.min(2000, 300 + strittig.length * 90),
            system: "Du prüfst Behauptungen über Magic-Karten gegen die vorgelegten Kartendaten. Für jede Karte entscheidest du allein anhand dessen, was MITGELIEFERT wurde, ob es die Behauptung trägt. Ziehe KEIN Wissen aus deinem Training heran — die Karte kann aus einem Set stammen, das du nicht kennst.\n\nGetragen ist eine Behauptung, solange die vorgelegten Daten ihr nicht widersprechen. Das gilt ausdrücklich auch für Aussagen über Manakosten (wenn Manakosten vorgelegt wurden), über das Fehlen eines Effekts, über die Rolle im Deck und für Vergleiche mit der vorgeschlagenen Karte (wenn diese vorgelegt wurde). Fehlt eine Angabe, die die Behauptung bräuchte, gilt sie als getragen — beurteile nur, was du prüfen kannst.\n\nNicht getragen ist allein: wenn der Karte ein Effekt, ein Tokentyp oder ein Verhalten zugeschrieben wird, das in ihrem Regeltext nicht vorkommt.",
            output_config: { format: { type: "json_schema", schema: SCHEMA_URTEIL } },
            messages: [{ role: "user", content: [{ type: "text", text: `Prüfe:\n\n${vorlage}` }] }],
          });
          inTok += pruef.usage.input_tokens; outTok += pruef.usage.output_tokens;
          const ut = pruef.content.find((b) => b.type === "text");
          if (ut && ut.type === "text" && pruef.stop_reason !== "max_tokens") {
            const urteile: Record<string, any>[] = JSON.parse(ut.text)?.verdicts ?? [];
            for (const u of urteile) {
              const ziel = strittig.find((s) => String(s.replaces).toLowerCase() === String(u.card).toLowerCase());
              if (ziel) ziel.verify = { ...(ziel.verify || {}), ok: !!u.supported, method: "model", note: String(u.note || "") };
            }
          }
        } catch {
          // Die Zweitpruefung ist eine Zugabe. Faellt sie aus, bleibt es beim
          // Ergebnis von C — lieber ungeprueft als gar keine Vorschlaege.
        }
      }
    }

    return json({
      ...parsed,
      verify: { cite: mitBeleg, model: mitUrteil },
      usage: { input: inTok, output: outTok, model: res.model },
    });
  } catch (e) {
    const m = (e as Error).message ?? "Unbekannter Fehler";
    if (/credit balance/i.test(m))
      return json({ error: "Anthropic-Guthaben aufgebraucht — unter Plans & Billing aufladen.", code: "no_credit" }, 402);
    if (/401|authentication/i.test(m))
      return json({ error: "Anthropic-Schlüssel ungültig oder widerrufen.", code: "bad_key" }, 502);
    if (/429|rate.?limit/i.test(m))
      return json({ error: "Zu viele Anfragen — kurz warten.", code: "rate_limit" }, 429);
    return json({ error: m.slice(0, 300), code: "unknown" }, 500);
  }
});
