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

// Das Ablesen je Karte (zwei kleine Zeilen) bleibt bei Haiku. Die
// Lokalisierung mehrerer Karten auf einem Foto ist perceptuell deutlich
// schwerer — Haiku fasste dieselbe Karte doppelt, übersprang Nachbarn und
// erfand leere Flächen als Karte. Dafür ein stärkeres Sehmodell. Läuft nur
// EINMAL je Foto, die Mehrkosten (~1 ct statt ~0,3 ct) fallen also je Import
// an, nicht je Karte. Wechsel ist diese eine Zeile.
const DETECT_MODEL = "claude-sonnet-5";

// x-client-info schickt supabase-js bei JEDEM invoke mit. Fehlt er hier,
// scheitert schon der Preflight und die Anfrage erreicht die Funktion nie —
// der Browser meldet dann nur einen Netzwerkfehler ohne Status. Von file://
// fällt das nicht auf, erst von einer echten Web-Herkunft wie GitHub Pages.
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
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "high nur, wenn beide Eckzeilen sicher lesbar sind.",
    },
  },
  // Kein is_foil: Glanz auf einem Foto beweist kein Foil — jede Lampe über
  // einer normalen Karte erzeugt denselben Eindruck. Ein Fehlurteil legt eine
  // eigene Zeile mit falschem Preis an. Diese Angabe macht der Nutzer.
  required: ["printed_name", "corner_line_1", "corner_line_2", "type_line", "confidence"],
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

/* Betriebsart "detect": Auf EINEM Foto liegen mehrere Karten. Das Modell soll
   sie nur LOKALISIEREN — je Karte ein achsenparalleles Rechteck in Bild-Anteilen
   (0..1). Die genaue Ecke liest danach der Einzelscan je Ausschnitt; das Modell
   muss also nur grob sagen, wo und wie viele Karten liegen. */
const DETECT_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      description: "Ein Eintrag je sichtbarer Magic-Karte. Leer, wenn keine zu sehen ist.",
      items: {
        type: "object",
        properties: {
          x: { type: "number", description: "Linke Kante als Anteil der Bildbreite, 0..1." },
          y: { type: "number", description: "Obere Kante als Anteil der Bildhöhe, 0..1." },
          w: { type: "number", description: "Breite als Anteil der Bildbreite, 0..1." },
          h: { type: "number", description: "Höhe als Anteil der Bildhöhe, 0..1." },
        },
        required: ["x", "y", "w", "h"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

const DETECT_SYSTEM = `Du bekommst ein Foto, auf dem MEHRERE Magic-the-Gathering-Karten
liegen, in der Regel nebeneinander. Deine einzige Aufgabe ist, JEDE einzelne Karte
zu lokalisieren — nicht zu lesen, nicht zu benennen.

Gib für jede Karte ein achsenparalleles Rechteck an, das die GANZE Karte umschließt,
als Anteile der Bildmaße: x und y sind die linke obere Ecke, w und h Breite und Höhe,
alle Werte zwischen 0 und 1 (x+w und y+h also höchstens 1).

  * Zähle nur echte Magic-Karten. Ignoriere Hintergrund, Tisch, Hände, Hüllen.
  * Jede Karte genau einmal. Lieber ein etwas zu großes Rechteck als ein zu kleines.
  * Liegt keine Karte im Bild, gib eine leere Liste. Erfinde nichts.`;

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

  const ERLAUBT = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  let images: { b64: string; media_type: string }[];
  let mode = "transcribe";
  try {
    const body = await req.json();
    // "detect": mehrere Karten auf einem Foto lokalisieren. Sonst wie bisher
    // eine Karte transkribieren.
    if (body.mode === "detect") mode = "detect";
    // Neu: images[] (Karte + Eckausschnitt). Alt: image_b64 — bleibt
    // erlaubt, damit eine ältere App-Fassung nicht bricht.
    images = Array.isArray(body.images) && body.images.length
      ? body.images
      : body.image_b64
        ? [{ b64: body.image_b64, media_type: body.media_type ?? "image/jpeg" }]
        : [];
    if (!images.length) throw new Error("Kein Bild übergeben");
    if (images.length > 2) throw new Error("Höchstens zwei Bilder");
    for (const im of images) {
      if (!im.b64) throw new Error("Bild ohne Daten");
      if (!ERLAUBT.includes(im.media_type)) throw new Error("Bildformat nicht unterstützt: " + im.media_type);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  try {
    const anthropic = new Anthropic({ apiKey: key });

    // Betriebsart "detect": nur die Kartenrechtecke zurückgeben. Das genaue
    // Ablesen je Karte macht danach der Einzelscan im Client.
    if (mode === "detect") {
      const det = await anthropic.messages.create({
        model: DETECT_MODEL,
        max_tokens: 1024,
        // temperature entfällt: Sonnet 5 lehnt den Parameter ab (400). Statt-
        // dessen die Denkschritte aus — fürs bloße Verorten reicht ein schneller,
        // stabiler Durchlauf, das hält Latenz (liegt vor jedem Einzelscan) und
        // Kosten niedrig. Die Genauigkeit kommt hier vom stärkeren Sehmodell,
        // nicht vom Nachdenken.
        thinking: { type: "disabled" },
        system: DETECT_SYSTEM,
        output_config: { format: { type: "json_schema", schema: DETECT_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "text" as const, text: "Finde alle Karten im Bild und gib ihre Rechtecke." },
            { type: "image" as const, source: { type: "base64" as const, media_type: images[0].media_type, data: images[0].b64 } },
          ],
        }],
      });
      if (det.stop_reason === "refusal") return json({ error: "Anfrage wurde abgelehnt" }, 422);
      const dtext = det.content.find((b) => b.type === "text");
      if (!dtext || dtext.type !== "text") return json({ error: "Keine verwertbare Antwort" }, 502);
      return json({
        detect: JSON.parse(dtext.text),
        usage: { input: det.usage.input_tokens, output: det.usage.output_tokens, model: det.model },
      });
    }

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,          // die Antwort ist ein kleines JSON-Objekt
      // temperature 0: eine treue Abschrift ist keine kreative Aufgabe. Ohne
      // Angabe (Default 1,0) las dieselbe Karte von Lauf zu Lauf verschieden —
      // mal die richtige Ecke, mal ein geratener Nachbar-Setcode. Fixiert man
      // das Sampling, bleibt die Ablesung über Durchläufe hinweg stabil.
      temperature: 0,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...images.map((im, i) => ([
            { type: "text" as const, text: i === 0
              ? "Bild 1 — die ganze Karte:"
              : "Bild 2 — die untere linke Ecke derselben Karte, stark vergrößert. Lies die beiden Eckzeilen aus DIESEM Bild ab, es zeigt sie deutlich größer:" },
            { type: "image" as const, source: { type: "base64" as const, media_type: im.media_type, data: im.b64 } },
          ])).flat(),
          { type: "text", text: "Schreib ab, was du siehst." },
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
