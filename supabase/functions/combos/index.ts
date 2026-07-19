// =====================================================================
//  Edge Function "combos"
//
//  Proxy zu Commander Spellbook (backend.commanderspellbook.com). CSB sendet
//  für fremde Origins KEIN CORS — ein Direktaufruf aus dem Browser scheitert.
//  Wie card-synergy und scan-card läuft der Aufruf daher über eine Edge
//  Function. CSB ist öffentlich und kostenlos (kein API-Key); Anmeldung ist
//  trotzdem Pflicht, damit nicht jeder mit der Funktions-URL unsere
//  Invocations verbraucht.
//
//  Drei Modi:
//   - "find-my-combos": Kartenliste -> Combos, die man KOMPLETT besitzt
//     (included) und solche, denen Karten fehlen (almostIncluded, jeweils mit
//     der Liste der fehlenden Karten — für den „+ Wunschkarte"-Weg).
//   - "bracket": Kartenliste -> geschätzter Power-Bracket (bracketTag).
//   - "variants": Suchstring (z. B. card:"Sol Ring") -> Combos mit dieser Karte.
//
//  CSB-Antworten sind groß (viele Bild-URLs je Karte); wir kürzen serverseitig
//  auf das, was der Client wirklich braucht (trimCombo).
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CSB = "https://backend.commanderspellbook.com";

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

type Any = Record<string, any>;

// Ein CSB-Combo (Variant) auf das Nötige kürzen: Karten (Name + oracleId als
// exakter Abgleich gegen unsere Sammlung), Ergebnis, Farbidentität, Preis-Info.
function trimCombo(v: Any) {
  return {
    id: v.id,
    uses: (v.uses ?? []).map((u: Any) => ({
      name: u.card?.name ?? "",
      oracleId: u.card?.oracleId ?? null,
      // Ausgangszustand der Karte in der Combo: Zone(n) + evtl. Zustandsnotiz.
      zones: u.zoneLocations ?? [],
      state: [u.battlefieldCardState, u.exileCardState, u.graveyardCardState,
              u.libraryCardState, u.handCardState, u.commandZoneCardState]
        .filter(Boolean).join("; "),
    })),
    produces: (v.produces ?? []).map((p: Any) => p.feature?.name).filter(Boolean),
    // Je Format ein Boolean (commander, modern, …) — für Filter und Warnhinweis.
    legalities: v.legalities ?? null,
    identity: v.identity ?? "",
    popularity: v.popularity ?? null,
    manaNeeded: v.manaNeeded ?? "",
    prerequisites: v.notablePrerequisites ?? v.easyPrerequisites ?? "",
    description: v.description ?? "",
    bracketTag: v.bracketTag ?? null,
    prices: v.prices ?? null,
  };
}

async function csb(path: string, init?: RequestInit) {
  const r = await fetch(CSB + path, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Commander Spellbook HTTP ${r.status}`);
  return r.json();
}

// Kartenliste normalisieren auf das CSB-Format [{card, quantity}].
function toList(arr: unknown) {
  return (Array.isArray(arr) ? arr : [])
    .map((x: Any) => ({
      card: String(x?.card ?? x?.name ?? x ?? "").slice(0, 200),
      quantity: Math.max(1, Math.min(99, Number(x?.quantity) || 1)),
    }))
    .filter((x) => x.card)
    .slice(0, 1000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  // Anmeldung Pflicht (siehe Kopf). Wie bei card-synergy sitzt die echte Sperre
  // hier, nicht nur im Ausblenden der Knöpfe.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Nicht angemeldet" }, 401);
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return json({ error: "Nicht angemeldet" }, 401);

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültiger Body" }, 400);
  }
  const mode = String(body.mode ?? "");

  try {
    if (mode === "find-my-combos") {
      const cards = toList(body.cards);
      if (!cards.length) return json({ error: "Leere Kartenliste" }, 400);
      const commanders = toList(body.commanders);
      const data = await csb("/find-my-combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: cards, commanders }),
      });
      const res = data.results ?? {};
      const owned = new Set(cards.map((c) => c.card.toLowerCase()));
      const included = (res.included ?? []).map(trimCombo);
      const almostIncluded = (res.almostIncluded ?? [])
        .map(trimCombo)
        .map((t: Any) => ({
          ...t,
          missing: t.uses.filter((u: Any) => !owned.has((u.name ?? "").toLowerCase())),
        }))
        // Wenige fehlende Karten zuerst — „fast geschafft" nach oben.
        .sort((a: Any, b: Any) => a.missing.length - b.missing.length)
        .slice(0, 40);
      return json({ identity: res.identity ?? "", included, almostIncluded });
    }

    if (mode === "bracket") {
      const cards = toList(body.cards);
      if (!cards.length) return json({ error: "Leere Kartenliste" }, 400);
      const data = await csb("/estimate-bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: cards }),
      });
      const list = Array.isArray(data.cards) ? data.cards : [];
      const combos = Array.isArray(data.combos) ? data.combos : [];
      // Karten mit einer Bracket-relevanten Eigenschaft -> Namensliste (die
      // „Begründung": Game Changer, gebannt, Mass Land Denial, Extra-Turn).
      const namen = (flag: string) =>
        list.filter((c: Any) => c[flag]).map((c: Any) => c.card?.name).filter(Boolean);
      return json({
        bracketTag: data.bracketTag ?? null,
        comboCount: combos.length,
        twoCardCombos: combos.filter((c: Any) => c.definitelyTwoCard).length,
        gameChangers: namen("gameChanger"),
        banned: namen("banned"),
        massLandDenial: namen("massLandDenial"),
        extraTurn: namen("extraTurn"),
      });
    }

    if (mode === "variants") {
      const q = String(body.q ?? "").slice(0, 300);
      if (!q) return json({ error: "Leere Suche" }, 400);
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
      const data = await csb(`/variants?limit=${limit}&q=${encodeURIComponent(q)}`);
      const combos = (data.results ?? []).map(trimCombo);
      return json({ count: data.count ?? combos.length, combos });
    }

    return json({ error: "Unbekannter Modus" }, 400);
  } catch (e) {
    return json(
      { error: (e as Error).message?.slice(0, 300) ?? "Fehler", code: "csb_error" },
      502,
    );
  }
});
