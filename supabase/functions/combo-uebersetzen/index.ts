// =====================================================================
//  Edge Function "combo-uebersetzen"
//
//  Übersetzt die Anleitungen von Commander Spellbook. CSB liefert
//  ausschließlich Englisch — Ergebnis, Voraussetzungen und die Schritte.
//
//  WARUM EINE KI UND KEIN ÜBERSETZER. Das ist Regeltext, und daran scheitert
//  eine allgemeine Übersetzung an drei Stellen gleichzeitig:
//
//    · Fachvokabular. „exile" heißt „ins Exil schicken", nicht „Exil";
//      „untap" ist „enttappen", „target" ist „Ziel". Wer das frei übersetzt,
//      schreibt Anleitungen, die beim Nachspielen nicht aufgehen.
//    · Manasymbole. {C}, {3}, {T} müssen ZEICHENGENAU durchlaufen — der
//      Client rendert sie als Symbole, und ein übersetztes „{Farblos}" wäre
//      dort ein kaputtes Icon.
//    · Platzhalter. [[1]], [[2]] stehen für Kartennamen und werden erst beim
//      Anzeigen ersetzt, mit dem gedruckten Namen aus der Sammlung des
//      Betrachters. Verschwindet einer, fehlt mitten in der Anleitung eine
//      Karte.
//
//  WARUM JE SATZ GESPEICHERT WIRD. Combo-Anleitungen sind formelhaft. In einer
//  Stichprobe von 600 Combos mit 3210 Sätzen kam „Repeat." 296-mal vor; mit
//  Platzhaltern bleiben 1638 verschiedene Muster übrig, also 49 % weniger.
//  Jedes Muster wird je Sprache genau EINMAL übersetzt — für alle Nutzer und
//  dauerhaft. Deshalb liegt der Zwischenspeicher in einer gemeinsamen Tabelle
//  und nicht beim einzelnen Nutzer.
//
//  ÜBERSETZT WIRD TROTZDEM IM ZUSAMMENHANG. Nur die noch unbekannten Sätze
//  gehen ans Modell — aber MIT der ganzen Combo davor und dahinter. „Resolve
//  the copy of its last ability, untapping it." ist ohne den Faden davor nicht
//  richtig zu übersetzen. Kontext für die Qualität, Satzspeicher für die
//  Kosten.
// =====================================================================

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Regeltext-Übersetzung ist Fachübersetzung: Kartenkenntnis und offizielles
// Vokabular zählen mehr als Geschwindigkeit. Wechsel ist diese eine Zeile.
const MODEL = "claude-sonnet-4-6";

const SPRACHE: Record<string, string> = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano",
};

// Grenzen gegen missbräuchliche Aufrufe. Eine Combo hat in der Praxis unter
// zwanzig Zeilen; wer hundert schickt, will etwas anderes.
const MAX_TEILE = 40;
const MAX_LAENGE = 600;

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

/* Derselbe Hash wie in der Tabelle: sha256 des Musters, hex. Die Sprache geht
   NICHT ein — sie ist die zweite Hälfte des Primärschlüssels. */
async function hashVon(muster: string): Promise<string> {
  const roh = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(muster));
  return [...new Uint8Array(roh)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const SCHEMA = {
  type: "object",
  properties: {
    texte: {
      type: "array",
      description:
        "Die Übersetzungen, in derselben Reihenfolge und Anzahl wie die angefragten Sätze.",
      items: {
        type: "object",
        properties: {
          nr: { type: "integer", description: "Die Nummer des angefragten Satzes, wie in der Anfrage angegeben." },
          text: { type: "string", description: "Die Übersetzung. Platzhalter [[n]] und Symbole in geschweiften Klammern zeichengenau übernommen." },
        },
        required: ["nr", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["texte"],
  additionalProperties: false,
} as const;

const anweisung = (ziel: string) => `Du übersetzt Anleitungen für Magic-the-Gathering-Combos aus dem Englischen nach ${ziel}.

Das ist Regeltext. Halte dich an das offizielle Vokabular von Magic in ${ziel} — so, wie es auf gedruckten Karten dieser Sprache steht. Nicht frei formulieren.

DREI DINGE ÜBERNIMMST DU ZEICHENGENAU, ohne sie zu übersetzen, zu übersetzen zu versuchen oder umzustellen:

1. Platzhalter der Form [[1]], [[2]], [[3]] — sie stehen für Kartennamen und werden später ersetzt. Anzahl und Nummern bleiben exakt wie im Original. Erfinde keine dazu und lass keinen weg.
2. Alles in geschweiften Klammern: {C}, {3}, {T}, {U/R}, {X} und so weiter. Das sind Mana- und Symbolangaben.
3. Zahlen, Zonennamen und Schrittverweise („step 2") übernimmst du sinngemäß, aber vollständig.

Der Satz kann grammatisch um einen Platzhalter herum gebaut sein. Stelle den Satz so um, dass er in ${ziel} natürlich klingt, und lass den Platzhalter dabei an der grammatisch richtigen Stelle stehen.

Du bekommst die GANZE Combo als Zusammenhang, aber übersetzt nur die Sätze, die ausdrücklich angefragt sind. Die übrigen stehen nur da, damit der Faden erkennbar ist.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Nicht angemeldet" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return json({ error: "Nicht angemeldet" }, 401);

  // Schalter. Steht er aus, zeigt der Client weiter das englische Original —
  // das ist kein Fehlerfall, sondern der Ausgangszustand.
  const { data: flag } = await sb.from("feature_flags")
    .select("enabled").eq("key", "ki_combo_text").maybeSingle();
  if (!flag?.enabled) {
    return json({ error: "Combo-Übersetzung ist derzeit deaktiviert.", code: "disabled" }, 403);
  }

  let lang = "de";
  type Teil = { text: string; frage: boolean };
  let teile: Teil[] = [];
  try {
    const body = await req.json();
    lang = SPRACHE[body.lang] ? String(body.lang) : "de";
    teile = (Array.isArray(body.teile) ? body.teile : [])
      .slice(0, MAX_TEILE)
      .map((x: { text?: unknown; frage?: unknown }) => ({
        text: String(x?.text ?? "").slice(0, MAX_LAENGE),
        frage: x?.frage !== false,
      }))
      .filter((x: Teil) => x.text.trim().length > 0);
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }
  if (!teile.length) return json({ texte: [] });

  // Englisch braucht keine Übersetzung — das Original IST Englisch. Der Client
  // fragt in dem Fall gar nicht erst, aber die Sperre gehört trotzdem hierher.
  if (lang === "en") return json({ texte: teile.map(t => t.text) });

  // ---- Was liegt schon im Speicher? -------------------------------------
  // Der service_role-Client geht an RLS vorbei. Für das LESEN bräuchte es ihn
  // nicht, fürs Schreiben schon — und zwei Clients für eine Tabelle wären
  // eine Quelle für Verwechslungen.
  const dienst = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const hashes = await Promise.all(teile.map(t => hashVon(t.text)));
  const { data: bekannt } = await dienst.from("combo_saetze")
    .select("hash, text").eq("lang", lang).in("hash", [...new Set(hashes)]);
  const speicher = new Map<string, string>((bekannt ?? []).map(z => [z.hash, z.text]));

  // Gefragt sind nur Teile, die der Client übersetzt haben will UND die noch
  // nicht im Speicher stehen.
  const offen = teile
    .map((t, i) => ({ ...t, i }))
    .filter(t => t.frage && !speicher.has(hashes[t.i]));

  const antwort = () => teile.map((t, i) => speicher.get(hashes[i]) ?? null);

  // Alles schon da: keine Kosten, kein Kontingent, keine Wartezeit. Das ist
  // der Regelfall, sobald eine Combo einmal jemand angesehen hat.
  if (!offen.length) return json({ texte: antwort(), neu: 0 });

  // ---- Erst jetzt kostet es etwas ---------------------------------------
  // Das Kontingent wird bewusst NICHT beansprucht, wenn alles aus dem Speicher
  // kam. Sonst verbrauchte das bloße Ansehen bereits übersetzter Combos ein
  // Guthaben, das gar nichts angestoßen hat.
  const { data: quota, error: quotaErr } = await sb.rpc("claim_ai_quota", {
    p_kind: "combo_text", p_limit: 20,
  });
  if (quotaErr) return json({ error: "Kontingent konnte nicht geprüft werden.", code: "quota_error" }, 500);
  if (!quota?.ok) {
    // Was schon im Speicher lag, geht trotzdem zurück — eine halb übersetzte
    // Anleitung ist besser als eine gar nicht übersetzte.
    return json({ texte: antwort(), code: "quota", reset_at: quota?.reset_at ?? null, neu: 0 }, 200);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 500);

  /* Die ganze Combo als Zusammenhang, die angefragten Sätze nummeriert. Die
     übrigen stehen ohne Nummer da — so sieht das Modell den Faden, ohne in
     Versuchung zu geraten, sie mitzuliefern. */
  const nummer = new Map(offen.map((t, k) => [t.i, k + 1]));
  const kontext = teile.map((t, i) =>
    nummer.has(i) ? `[${nummer.get(i)}] ${t.text}` : `    ${t.text}`).join("\n");

  const anthropic = new Anthropic({ apiKey: key });
  let ergebnis: { nr: number; text: string }[] = [];
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: anweisung(SPRACHE[lang]),
      tools: [{ name: "uebersetzung", description: "Die Übersetzungen zurückgeben.", input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "uebersetzung" },
      messages: [{
        role: "user",
        content: `Die vollständige Combo-Anleitung. Übersetze NUR die Zeilen mit Nummer in eckigen Klammern, und gib zu jeder ihre Nummer zurück.\n\n${kontext}`,
      }],
    });
    const block = res.content.find(c => c.type === "tool_use");
    ergebnis = block && "input" in block ? (block.input as { texte: typeof ergebnis }).texte ?? [] : [];
  } catch (e) {
    /* Die Meldung bleibt HIER. Sie kann enthalten, was ein Aufrufer nicht
       wissen soll — Anthropic legt in Fehlern schon mal Endpunkte, Modellnamen
       und Teile der Anfrage offen, und ein Stack zeigt Dateipfade des Servers.
       CodeQL hat genau das an dieser Zeile gemeldet, und zu Recht: Der Client
       hatte von der Meldung ohnehin nichts, er liest nur `texte`.

       In die Funktionsprotokolle gehört sie trotzdem, sonst sucht man einen
       Ausfall im Dunkeln. */
    console.error("combo-uebersetzen: Modellaufruf fehlgeschlagen", e);
    // Was aus dem Speicher kam, geht trotzdem zurück.
    return json({ texte: antwort(), code: "ki_fehler", neu: 0 }, 200);
  }

  /* Prüfen, bevor gespeichert wird. Eine Übersetzung, die einen Platzhalter
     verliert, ist unbrauchbar UND dauerhaft: Sie läge im gemeinsamen Speicher
     und würde allen anderen ausgeliefert. Deshalb wird sie hier verworfen und
     der Satz bleibt englisch, statt kaputt zu werden. */
  const platz = (s: string) => (s.match(/\[\[\d+\]\]/g) ?? []).sort().join(",");
  const neueZeilen: { hash: string; lang: string; muster: string; text: string }[] = [];
  for (const e of ergebnis) {
    const t = offen[Number(e?.nr) - 1];
    if (!t || typeof e?.text !== "string" || !e.text.trim()) continue;
    if (platz(e.text) !== platz(t.text)) continue;      // Platzhalter verloren oder erfunden
    speicher.set(hashes[t.i], e.text);
    neueZeilen.push({ hash: hashes[t.i], lang, muster: t.text, text: e.text });
  }

  if (neueZeilen.length) {
    // onConflict: Zwei Leute können dieselbe Combo gleichzeitig aufklappen.
    // Der zweite Schreibvorgang darf nicht scheitern — das Ergebnis ist ja
    // dasselbe.
    await dienst.from("combo_saetze")
      .upsert(neueZeilen, { onConflict: "hash,lang", ignoreDuplicates: true });
  }

  return json({ texte: antwort(), neu: neueZeilen.length });
});
