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

// Gemessen an einer Testkarte: 2304 Eingabe- + 63 Ausgabe-Tokens pro Scan.
// Haiku 4.5 = 0,26 ct, Opus 4.8 = 1,31 ct. Zwei kleine Zeilen abzulesen ist
// keine Aufgabe für das größte Modell; patzt Haiku, fängt Tesseract oder die
// Handeingabe es ab. Wechsel ist diese eine Zeile.
const MODEL = "claude-haiku-4-5";

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

/* Das Modell transkribiert nur — es zerlegt nichts. Welche Zeichenfolge der
   Setcode ist und welche ein Franchise-Kürzel, entscheidet parseCorner in der
   App: eine Regel in Code ist prüfbar, dieselbe Regel in Prosa ist eine Bitte.
   Alle Felder sind Pflicht und dürfen leer sein — einfacher als nullable
   Typen und umgeht die Schema-Beschränkungen der API. */
const SCHEMA = {
  type: "object",
  properties: {
    printed_name: {
      type: "string",
      description: "Kartenname aus dem Titelbalken ganz oben, exakt wie aufgedruckt. Leer, wenn unlesbar.",
    },
    corner_line_1: {
      type: "string",
      description: "Die OBERE der beiden kleinen Zeilen unten links, Zeichen für Zeichen wie abgedruckt, mit Leerzeichen zwischen den Blöcken. Nichts weglassen, nichts umsortieren, nichts umrechnen. Leer, wenn unlesbar.",
    },
    corner_line_2: {
      type: "string",
      description: "Die UNTERE der beiden kleinen Zeilen unten links, Zeichen für Zeichen wie abgedruckt. Leer, wenn unlesbar.",
    },
    type_line: {
      type: "string",
      description: "Die Typzeile in der Mitte der Karte, z. B. 'Spielsteinkreatur — Held'. Leer, wenn unlesbar.",
    },
    is_foil: {
      type: "boolean",
      description: "true, wenn die Karte sichtbar glänzt oder Regenbogenreflexionen zeigt.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high nur, wenn beide Eckzeilen sicher lesbar sind.",
    },
  },
  required: [
    "printed_name", "corner_line_1", "corner_line_2",
    "type_line", "is_foil", "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `Du transkribierst Magic-the-Gathering-Karten von Fotos. Deine Aufgabe
ist ausschließlich das Abschreiben dessen, was zu sehen ist. Du deutest nichts,
sortierst nichts um, rechnest nichts um und ergänzt nichts aus Vorwissen über
existierende Karten. Ist etwas nicht sicher lesbar, gib das Feld leer zurück —
ein leeres Feld ist brauchbar, ein geratenes richtet Schaden an.

Der wichtigste Bereich ist unten links. Dort stehen zwei kleine Zeilen. Schreibe
sie getrennt und wörtlich ab, jeden Block durch ein Leerzeichen getrennt, in der
Reihenfolge von links nach rechts. Beispiele, wie das aussehen kann:

  corner_line_1: "0008/013 T"        corner_line_2: "MKM • DE"
  corner_line_1: "T 0009 FFXIV"      corner_line_2: "FIN • DE Solan"
  corner_line_1: "0123/281 R"        corner_line_2: "BLB • EN Rovina Cai"

Beachte dabei:
  * Nichts weglassen, auch wenn es dir bedeutungslos erscheint. Kürzel wie
    FFXIV, Künstlernamen und Seltenheitsbuchstaben gehören mit in die Zeile.
  * Nichts umrechnen: "0008/013" bleibt "0008/013", nicht "8".
  * Die Reihenfolge nicht ändern. Steht das T vor der Nummer, schreib es vor
    die Nummer.
  * Das Trennzeichen zwischen Setcode und Sprache als • wiedergeben.

Welche Zeichenfolge welche Bedeutung hat, entscheidet nicht du — das macht ein
Programm anhand fester Regeln. Deine einzige Aufgabe ist eine treue Abschrift.

Ganz alte Karten haben diesen Aufdruck nicht. Dann bleiben beide Eckzeilen leer,
und nur der Kartenname oben zählt.`;

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
