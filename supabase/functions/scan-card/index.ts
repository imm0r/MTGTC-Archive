// =====================================================================
//  Edge Function "scan-card"
//
//  Liest Setcode, Sammlernummer, Sprache und Kartenname aus einem Foto.
//  Sie existiert aus einem einzigen Grund: Der Anthropic-Schlüssel darf
//  nicht in die App. Hier liegt er serverseitig als Secret.
//
//  Diese Funktion identifiziert die Karte NICHT selbst — sie liest nur ab.
//  Der Abgleich gegen Scryfall bleibt in der App, wo er schon sitzt.
// =====================================================================

// Bewusst ohne feste Version: output_config gibt es erst in neueren
// Fassungen des SDK, und eine geratene Nummer wäre schlimmer als "aktuell".
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Modell in einer Konstante: Wechsel ist eine Zeile. Siehe README zu Kosten.
const MODEL = "claude-opus-4-8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/* Alle Felder sind Pflicht und dürfen leer sein — das ist einfacher als
   nullable Typen und umgeht die Schema-Beschränkungen der API. */
const SCHEMA = {
  type: "object",
  properties: {
    printed_name: {
      type: "string",
      description: "Kartenname exakt wie aufgedruckt, in der Sprache der Karte. Leer, wenn unlesbar.",
    },
    set_code: {
      type: "string",
      description: "Setcode unten links, z. B. MKM. Nur der Code, ohne Sprachkürzel. Leer, wenn unlesbar.",
    },
    collector_number: {
      type: "string",
      description: "Sammlernummer unten links, ohne führende Nullen und ohne den Teil nach dem Schrägstrich. Leer, wenn unlesbar.",
    },
    lang: {
      type: "string",
      description: "Sprachkürzel der Karte in Kleinbuchstaben: de, en, fr, it, es, ja, pt, ru, ko, zhs, zht. Leer, wenn nicht erkennbar.",
    },
    is_token: {
      type: "boolean",
      description: "true, wenn die Zeile mit der Sammlernummer ein T als Seltenheitszeichen trägt oder die Karte erkennbar ein Token ist.",
    },
    is_foil: {
      type: "boolean",
      description: "true, wenn die Karte sichtbar glänzt oder Regenbogenreflexionen zeigt.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high nur, wenn Setcode UND Nummer sicher lesbar sind.",
    },
  },
  required: [
    "printed_name", "set_code", "collector_number",
    "lang", "is_token", "is_foil", "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `Du liest Magic-the-Gathering-Karten von Fotos ab. Gib ausschließlich
wieder, was tatsächlich zu sehen ist — rate nichts und ergänze nichts aus Vorwissen
über existierende Karten. Ist ein Feld nicht sicher lesbar, gib es leer zurück; ein
leeres Feld ist brauchbar, ein falsches nicht.

Der wichtigste Bereich ist unten links. Dort stehen zwei kleine Zeilen:
  0008/013 T
  MKM • DE
Die erste Zeile ist Sammlernummer/Gesamtzahl und danach das Seltenheitszeichen
(C, U, R, M oder T). T bedeutet Token — dieses Zeichen ist entscheidend, weil
Karte und Token dieselbe Nummer tragen können und trotzdem verschieden sind.
Die zweite Zeile ist Setcode und Sprache.

Gib die Sammlernummer ohne führende Nullen und ohne den Teil nach dem Schrägstrich
zurück: aus "0008/013" wird "8". Beim Setcode nur der Code selbst, ohne Sprachkürzel.

Sehr alte Karten haben diesen Aufdruck nicht. Dann bleiben set_code und
collector_number leer, und nur der Kartenname oben zählt.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  // Ohne gültige Anmeldung kein Zugriff — sonst könnte jeder mit der
  // Funktions-URL auf unsere Rechnung scannen.
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

  let image_b64: string, media_type: string;
  try {
    const body = await req.json();
    image_b64 = body.image_b64;
    media_type = body.media_type ?? "image/jpeg";
    if (!image_b64) throw new Error("image_b64 fehlt");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(media_type))
      throw new Error("Bildformat nicht unterstützt: " + media_type);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,          // die Antwort ist ein kleines JSON-Objekt
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: image_b64 } },
          { type: "text", text: "Lies diese Karte ab." },
        ],
      }],
    });

    // Sicherheitsabfrage vor dem Zugriff auf content: eine Ablehnung liefert
    // ein leeres content-Array, kein Fehler.
    if (res.stop_reason === "refusal")
      return json({ error: "Anfrage wurde abgelehnt" }, 422);

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      return json({ error: "Keine verwertbare Antwort" }, 502);

    return json({
      card: JSON.parse(text.text),
      usage: {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        model: res.model,
      },
    });
  } catch (e) {
    // Die Fehler des Clients tragen die rohe API-Antwort im Text. Wer sie
    // durchreicht, zeigt dem Nutzer einen JSON-Klumpen — also übersetzen
    // wir die Fälle, die man tatsächlich beheben kann.
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
