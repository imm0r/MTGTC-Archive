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
        },
        required: ["name", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
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

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 500);

  let name = "", typeLine = "", oracle = "", colors = "", lang = "de", n = 10;
  try {
    const body = await req.json();
    const c = body.card ?? {};
    name = String(c.name ?? "").slice(0, 120);
    typeLine = String(c.type_line ?? "").slice(0, 200);
    oracle = String(c.oracle_text ?? "").slice(0, 1200);
    colors = String(body.colorIdentity ?? "").replace(/[^WUBRGC]/gi, "").toUpperCase();
    lang = SPRACHE[body.lang] ? String(body.lang) : "de";
    n = Math.max(3, Math.min(15, Number(body.n) || 10));
    if (!name) throw new Error("Keine Karte übergeben");
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const farbHinweis = colors
    ? `\n- Farbidentität: Jede genannte Karte muss in die Farbidentität {${colors}} passen (alle Mana-Symbole und Farbidentitäts-Anteile liegen innerhalb dieser Farben).`
    : "";

  const SYSTEM = `Du bist ein Deckbau-Experte für Magic: The Gathering mit enzyklopädischer Kartenkenntnis. Zu einer gegebenen Karte nennst du Karten, die besonders gut mit ihr zusammenspielen — mit ausdrücklichem Schwerpunkt auf NICHT offensichtlichen, IMPLIZITEN Synergien: Karten, die keine Schlüsselwörter oder Kreaturentypen teilen, aber mechanisch hervorragend zusammenwirken (Enabler, Payoffs, Combos, Schutz für die Schlüsselkarte, Value-Engines, Kombinationen, die zusammen mehr sind als einzeln).

Strikte Regeln:
- Nenne ausschließlich ECHTE, existierende Magic-Karten mit ihrem exakten englischen Namen. Erfinde nichts. Bist du dir bei Existenz oder Schreibweise unsicher, lass die Karte weg — eine weggelassene Karte ist besser als eine erfundene.
- Keine Standardländer (Basic Lands). Schlage die Ausgangskarte nicht selbst vor.${farbHinweis}
- Je Karte eine EINZIGE, konkrete Begründung, die den Synergie-Mechanismus benennt (WARUM sie zusammen stark sind), nicht bloß "gute Karte". Formuliere die Begründung auf ${SPRACHE[lang]}.
- Bevorzuge unerwartete, kluge Synergien gegenüber offensichtlichen Kopien desselben Schlüsselworts. Sortiere die überzeugendsten Synergien nach oben.`;

  const USER = `Ausgangskarte:
Name: ${name}
Typzeile: ${typeLine}
Regeltext: ${oracle || "(kein Regeltext)"}

Nenne ${n} synergistische Karten.`;

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: USER }] }],
    });

    if (res.stop_reason === "refusal")
      return json({ error: "Anfrage wurde abgelehnt" }, 422);
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      return json({ error: "Keine verwertbare Antwort" }, 502);

    return json({
      ...JSON.parse(text.text),
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens, model: res.model },
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
