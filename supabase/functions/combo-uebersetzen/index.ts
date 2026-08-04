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

Du bekommst die GANZE Combo als Zusammenhang, aber übersetzt nur die Sätze, die ausdrücklich angefragt sind. Die übrigen stehen nur da, damit der Faden erkennbar ist.

EINE ZEILE, EIN EINTRAG. Daran halte dich streng:

· Zu JEDER nummerierten Zeile gehört genau ein Eintrag mit ihrer Nummer. Auch dann, wenn zwei Zeilen fast gleich lauten („Cast [[1]] by paying its mana cost." und „Cast the nontoken permanent returned in step 2 by paying its mana cost.") — das sind zwei Schritte, und beide werden gebraucht. Fasse nichts zusammen und lass nichts weg.
· Übersetze NUR den Inhalt der eigenen Zeile. Nimm nichts aus der Zeile davor oder danach mit hinein, auch wenn es inhaltlich dazugehört. Ein angehängtes „Wiederhole." in Schritt 2, das eigentlich Schritt 3 ist, macht die Anleitung falsch.
· Ein Satz bleibt ein Satz. Steht in der Zeile ein Satz, gib einen zurück, keine zwei.`;

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
  let angefragt = 0;
  try {
    const body = await req.json();
    lang = SPRACHE[body.lang] ? String(body.lang) : "de";
    angefragt = Array.isArray(body.teile) ? body.teile.length : 0;
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

  /* Wie viele Sätze der Client übersetzt haben wollte. Steht in JEDER Antwort,
     denn erst im Verhältnis dazu sagt `neu` etwas: „12 neu" ist bei 12 Sätzen
     ein voller Modellaufruf und bei 90 der Rest, den der Speicher nicht
     hergab. */
  const gefragt = teile.filter(t => t.frage).length;

  // Alles schon da: keine Kosten, kein Kontingent, keine Wartezeit. Das ist
  // der Regelfall, sobald eine Combo einmal jemand angesehen hat.
  if (!offen.length) return json({ texte: antwort(), neu: 0, gesamt: gefragt });

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
    return json({ texte: antwort(), code: "quota", reset_at: quota?.reset_at ?? null,
                  neu: 0, gesamt: gefragt }, 200);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY ist nicht gesetzt" }, 500);

  const anthropic = new Anthropic({ apiKey: key });
  /* Was die Aufrufe zusammen gekostet haben. Geht an den Client, der daraus
     dieselbe Zeile baut wie bei den KI-Synergien und der Regelfrage — die
     Zahlen dafür kann nur der Server kennen. Bleibt null, wenn gar kein Aufruf
     nötig war; genau das ist dort die Aussage „hat nichts gekostet". */
  let usage: { input: number; output: number; model: string } | null = null;

  type Antwortzeile = { nr: number; text: string };

  /* Einen Schwung Sätze übersetzen lassen. Eigene Funktion, weil sie ZWEIMAL
     gebraucht wird — siehe „Nachfassen" weiter unten.

     Die ganze Combo geht immer mit: Die angefragten Zeilen tragen eine Nummer,
     die übrigen stehen eingerückt daneben. So sieht das Modell den Faden, ohne
     in Versuchung zu geraten, sie mitzuliefern. */
  async function fragen(liste: typeof offen): Promise<{ zeilen?: Antwortzeile[]; code?: string }> {
    const nummer = new Map(liste.map((t, k) => [t.i, k + 1]));
    const kontext = teile.map((t, i) =>
      nummer.has(i) ? `[${nummer.get(i)}] ${t.text}` : `    ${t.text}`).join("\n");

    /* Das Budget wächst mit der Arbeit, wie bei card-synergy. Gemessen an 50
       Combos von Spellbook: 40 Teile sind zusammen 1673 Zeichen. Deutsch ist
       rund 15 % länger, ein Token fasst dort etwa drei Zeichen, und je Eintrag
       kommen ~22 Zeichen JSON-Gerüst dazu — macht für diese 40 Teile knapp 950
       Token. Eine feste Zahl wäre entweder für kurze Combos verschwendet oder
       für lange zu knapp; abgeschnitten wird die Antwort unbrauchbar. */
    const zeichen = liste.reduce((a, t) => a + t.text.length, 0);
    const maxTokens = Math.min(8000, 500 + Math.ceil((zeichen * 1.15 + liste.length * 22) / 3));

    /* output_config statt tools/tool_choice — so rufen scan-card, card-synergy
       und rules-question das Modell auch auf. Ein Weg für alle vier: Wer den
       einen kennt, kennt sie alle, und was dort erprobt ist, gilt hier mit. */
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: anweisung(SPRACHE[lang]),
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `Die vollständige Combo-Anleitung. Übersetze NUR die ${liste.length} Zeilen mit Nummer in eckigen Klammern — zu jeder genau einen Eintrag mit ihrer Nummer, also ${liste.length} Einträge.\n\n${kontext}`,
      }],
    });

    /* Abgelehnt oder abgeschnitten: beides endet mit einer unbrauchbaren
       Antwort, und beides soll im Protokoll stehen statt lautlos zu nichts zu
       werden. Der Client bekommt trotzdem 200 und das englische Original — an
       einer fehlgeschlagenen Übersetzung ist für ihn nichts zu tun. */
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.error(`combo-uebersetzen: Antwort unbrauchbar (${res.stop_reason}), ` +
        `lang=${lang} liste=${liste.length} max_tokens=${maxTokens}`);
      return { code: res.stop_reason };
    }
    const block = res.content.find(b => b.type === "text");
    if (!block || block.type !== "text") {
      console.error(`combo-uebersetzen: kein Textblock in der Antwort, stop_reason=${res.stop_reason}`);
      return { code: "ki_fehler" };
    }
    // Aufsummiert, denn beim Nachfassen kommt ein zweiter Aufruf dazu. Der
    // Nutzer soll sehen, was der Klick INSGESAMT gekostet hat.
    usage = {
      input: (usage?.input ?? 0) + res.usage.input_tokens,
      output: (usage?.output ?? 0) + res.usage.output_tokens,
      model: res.model,
    };
    const zeilen: Antwortzeile[] = JSON.parse(block.text).texte ?? [];
    /* `angefragt` steht mit im Protokoll, weil MAX_TEILE oben stillschweigend
       kappt: In einer Ansicht mit vielen Combos schickt der Client leicht
       neunzig Teile, und die dahinter bleiben englisch. Ohne diese Zahl sähe
       ein solcher Lauf aus wie ein vollständiger. */
    console.log(`combo-uebersetzen: lang=${lang} angefragt=${angefragt} teile=${teile.length} ` +
      `liste=${liste.length} zurück=${zeilen.length} ` +
      `token=${res.usage.input_tokens}/${res.usage.output_tokens} von ${maxTokens}`);
    return { zeilen };
  }

  /* ---- Der Wächter, bevor irgendetwas gespeichert wird -------------------
     Was hier durchgeht, landet im GEMEINSAMEN Speicher und wird von da an
     allen ausgeliefert — dauerhaft. Im Zweifel also verwerfen: Der Satz bleibt
     dann englisch, und Englisch ist eine vollständige Auskunft.

     PLATZHALTER. Verliert eine Übersetzung ein [[n]] oder erfindet eines dazu,
     fehlt mitten in der Anleitung eine Karte oder steht eine falsche darin.

     WAS HIER BEWUSST NICHT STEHT: eine Prüfung auf die Satzzahl. Sie lag nahe,
     weil das Modell nachweislich eine Nachbarzeile mit hineingezogen hat —
     „Activate [[1]] by paying {3} and untapping it, giving it +2/+2 until end
     of turn." kam zurück als „… +2/+2. Wiederhole dies.", und dieses
     „Wiederhole dies." WAR der nächste Schritt.

     Gemessen an den 54 damals gespeicherten deutschen Zeilen hätte die Prüfung
     aber SECHS verworfen, und fünf davon zu Unrecht: Ein langer englischer
     Satz wird im Deutschen zu Recht zu zweien („Activate [[1]] by paying {1}
     and tapping it, causing you to add …" → „Aktiviere [[1]], indem du {1}
     bezahlst und es tappst. Dadurch fügst du …"). Fünf gute Übersetzungen
     wegzuwerfen, um eine schlechte zu fangen, ist der schlechtere Tausch —
     zumal die verworfenen bei jedem Nachfassen erneut Geld kosten würden.

     Gegen das Hineinziehen hilft deshalb die Anweisung („EINE ZEILE, EIN
     EINTRAG"), nicht ein Filter. Das ist schwächer, und es steht hier, damit
     der Nächste nicht dieselbe Prüfung noch einmal einbaut. */
  const platz = (s: string) => (s.match(/\[\[\d+\]\]/g) ?? []).sort().join(",");

  const neueZeilen: { hash: string; lang: string; muster: string; text: string }[] = [];
  let verworfen = 0;
  const uebernehmen = (zeilen: Antwortzeile[], liste: typeof offen) => {
    for (const e of zeilen) {
      const t = liste[Number(e?.nr) - 1];
      if (!t || typeof e?.text !== "string" || !e.text.trim()) continue;
      // Schon vergeben: Gibt das Modell dieselbe Nummer zweimal, gilt die
      // erste. Sonst überschriebe der zweite Eintrag stillschweigend.
      if (speicher.has(hashes[t.i])) continue;
      if (platz(e.text) !== platz(t.text)) { verworfen++; continue; }
      speicher.set(hashes[t.i], e.text);
      neueZeilen.push({ hash: hashes[t.i], lang, muster: t.text, text: e.text });
    }
  };

  try {
    const erste = await fragen(offen);
    if (erste.code) return json({ texte: antwort(), code: erste.code, neu: 0, gesamt: gefragt }, 200);
    uebernehmen(erste.zeilen ?? [], offen);

    /* NACHFASSEN — genau einmal.

       Das Modell lässt Zeilen aus. Nachgewiesen an einer Combo mit sieben
       Sätzen: zwei lagen im Speicher, fünf gingen raus, VIER kamen zurück.
       Ausgelassen wurde „Cast the nontoken permanent returned in step 2 by
       paying its mana cost." — offenbar, weil es aussieht wie der schon
       übersetzte Schritt 1. Der Satz blieb englisch, mitten in einer sonst
       deutschen Anleitung, und nichts wies darauf hin.

       Gefragt wird nur noch nach dem, was fehlt (auch nach dem, was ein
       Wächter verworfen hat — vielleicht klappt es im zweiten Anlauf). Ein
       Nachschlag, nicht mehr: Sonst könnte ein Satz, an dem das Modell
       beständig scheitert, beliebig oft Geld kosten. Ein zweites Kontingent
       wird dafür NICHT beansprucht — bezahlt war eine vollständige Antwort. */
    const fehlend = offen.filter(t => !speicher.has(hashes[t.i]));
    if (fehlend.length) {
      console.warn(`combo-uebersetzen: ${fehlend.length} von ${offen.length} Sätzen fehlten, frage nach`);
      const zweite = await fragen(fehlend);
      if (!zweite.code) uebernehmen(zweite.zeilen ?? [], fehlend);
    }
    const offenGeblieben = offen.filter(t => !speicher.has(hashes[t.i])).length;
    if (offenGeblieben) {
      console.error(`combo-uebersetzen: ${offenGeblieben} von ${offen.length} Sätzen bleiben englisch ` +
        `(davon ${verworfen} verworfen)`);
    }
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
    return json({ texte: antwort(), code: "ki_fehler", neu: 0, gesamt: gefragt }, 200);
  }

  if (neueZeilen.length) {
    // onConflict: Zwei Leute können dieselbe Combo gleichzeitig aufklappen.
    // Der zweite Schreibvorgang darf nicht scheitern — das Ergebnis ist ja
    // dasselbe.
    await dienst.from("combo_saetze")
      .upsert(neueZeilen, { onConflict: "hash,lang", ignoreDuplicates: true });
  }

  return json({ texte: antwort(), neu: neueZeilen.length, gesamt: gefragt, usage });
});
