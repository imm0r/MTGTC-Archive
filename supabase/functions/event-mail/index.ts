// =====================================================================
//  Edge Function "event-mail"
//
//  Verschickt die Terminplaner-Mails über ein normales Postfach (SMTP):
//    1. Einladung — vom Gastgeber ausgelöst, wenn ein Termin mit
//       eingeladenen Nutzern angelegt (oder später erweitert) wird.
//    2. Erinnerung — rund 3 Stunden vor dem Start, per pg_cron-Sweep an
//       alle auf der Gästeliste außer Absagen. Nur wenn der Termin die
//       Option "erinnern" gesetzt hat.
//
//  Zwei Betriebsarten, jeweils eigen abgesichert (verify_jwt ist AUS, die
//  Prüfung sitzt hier im Code):
//    • Cron:  Header x-cron-secret == CRON_SECRET  → Erinnerungs-Sweep.
//    • Nutzer: gültiges Bearer-Token → Einladung; nur der Gastgeber des
//              Termins darf für ihn Mails auslösen.
//
//  E-Mail-Adressen liegen in auth.users und sind nur mit dem Service-Role-
//  Schlüssel lesbar (den Supabase der Function automatisch bereitstellt).
// =====================================================================

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// SMTP-Fehler (z. B. abgelehnte Zugangsdaten) lösen in denomailer eine
// unbehandelte Rejection im Hintergrund-Leseloop aus, die die Function sonst
// abstürzen lässt (503 statt sauberer Meldung). Abfangen, damit unser
// try/catch greift und Fehlversuche als „failed" gezählt werden.
self.addEventListener("unhandledrejection", (e) => { try { e.preventDefault(); } catch { /* egal */ } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = Deno.env.get("EVENT_TZ") || "Europe/Berlin";
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") || "Arcanum Archive";
const APP_URL = Deno.env.get("APP_URL") || "";

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: TZ,
    }).format(new Date(iso)) + " Uhr";
  } catch { return iso; }
}

interface EventRow { id: string; title: string; description: string | null; starts_at: string; host: string; }

function buildMail(kind: "invite" | "reminder", ev: EventRow, hostName: string) {
  const when = fmtWhen(ev.starts_at);
  const subject = kind === "invite"
    ? `Einladung: ${ev.title}`
    : `Erinnerung: ${ev.title} — in etwa 3 Stunden`;
  const lead = kind === "invite"
    ? `${hostName} lädt dich zu einem Spieleabend ein.`
    : `Kurze Erinnerung an deinen Spieleabend — es geht bald los.`;
  const descText = ev.description ? `\n\n${ev.description}` : "";
  const linkText = APP_URL ? `\n\nZu- oder absagen kannst du in Arcanum Archive: ${APP_URL}` : "";
  const text =
    `${lead}\n\n${ev.title}\nWann: ${when}${descText}${linkText}\n\n— Arcanum Archive`;

  const descHtml = ev.description
    ? `<p style="margin:0 0 14px;color:#c9ccd8;white-space:pre-wrap">${esc(ev.description)}</p>` : "";
  const linkHtml = APP_URL
    ? `<p style="margin:18px 0 0"><a href="${esc(APP_URL)}" style="color:#e3bf4a">In Arcanum Archive öffnen</a></p>` : "";
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#12131a;color:#e8e9f0;padding:24px">
      <div style="max-width:520px;margin:0 auto;background:#1b1d27;border:1px solid #31364a;border-radius:12px;padding:22px">
        <p style="margin:0 0 14px;color:#9aa0b8">${esc(lead)}</p>
        <h2 style="margin:0 0 6px;color:#e3bf4a;font-size:19px">${esc(ev.title)}</h2>
        <p style="margin:0 0 14px;font-size:15px"><b>Wann:</b> ${esc(when)}</p>
        ${descHtml}${linkHtml}
        <p style="margin:20px 0 0;color:#6a7089;font-size:12px">Arcanum Archive · Terminplaner</p>
      </div>
    </div>`;
  return { subject, text, html };
}

function smtpClient(): SMTPClient {
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass || !Deno.env.get("SMTP_FROM")) throw new Error("SMTP ist nicht konfiguriert");
  const port = Number(Deno.env.get("SMTP_PORT") || "465");
  return new SMTPClient({
    connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } },
  });
}
const fromAddr = () => `${FROM_NAME} <${Deno.env.get("SMTP_FROM")}>`;

// Eine Mail robust verschicken: eigene Verbindung je Mail, Fehler werden
// abgefangen (nie ein Absturz), Verbindung wird immer geschlossen. Gibt true
// bei Erfolg, false bei Fehlschlag zurück.
async function sendMail(to: string, mail: { subject: string; text: string; html: string }): Promise<boolean> {
  let client: SMTPClient | null = null;
  try {
    client = smtpClient();
    await client.send({ from: fromAddr(), to, subject: mail.subject, content: mail.text, html: mail.html });
    return true;
  } catch { return false; }
  finally { try { await client?.close(); } catch { /* egal */ } }
}

// E-Mail-Adressen zu Nutzer-IDs (aus auth.users, nur mit Service-Role).
async function emailsOf(admin: ReturnType<typeof createClient>, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const em = data?.user?.email;
      if (em) out.set(id, em);
    } catch { /* einzelne Adresse fehlt — überspringen */ }
  }
  return out;
}
async function hostName(admin: ReturnType<typeof createClient>, host: string): Promise<string> {
  try {
    const { data } = await admin.from("profiles").select("display_name").eq("id", host).maybeSingle();
    return (data?.display_name as string) || "Ein Freund";
  } catch { return "Ein Freund"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // trim(): häufige Copy-&-Paste-Falle sind unsichtbare Leerzeichen/Zeilenumbrüche
  // am Ende des Secrets — die sollen den Abgleich nicht scheitern lassen.
  const cronSecret = (req.headers.get("x-cron-secret") || "").trim();
  const CRON = (Deno.env.get("CRON_SECRET") || "").trim();
  const istCron = !!cronSecret && !!CRON && cronSecret === CRON;

  // ---------------- Nutzer-Modus: Einladung ----------------
  if (!istCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Nicht angemeldet" }, 401);
    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authErr } = await asUser.auth.getUser();
    if (authErr || !user) return json({ error: "Nicht angemeldet" }, 401);

    let eventId = "", wanted: string[] = [];
    try {
      const body = await req.json();
      eventId = String(body.event ?? "");
      wanted = Array.isArray(body.invitees) ? body.invitees.map((x: unknown) => String(x)) : [];
      if (!eventId) throw new Error("Kein Termin angegeben");
    } catch (e) { return json({ error: (e as Error).message }, 400); }

    const { data: ev } = await admin.from("game_events")
      .select("id,title,description,starts_at,host").eq("id", eventId).maybeSingle();
    if (!ev) return json({ error: "Termin nicht gefunden" }, 404);
    if (ev.host !== user.id) return json({ error: "Nur der Gastgeber darf einladen" }, 403);

    // Nur wirklich Eingeladene dieses Termins bedienen (kein Versand an beliebige IDs).
    const { data: rs } = await admin.from("event_rsvp").select("user_id").eq("event_id", eventId);
    const erlaubt = new Set((rs || []).map((r) => r.user_id as string));
    const ids = [...new Set(wanted)].filter((id) => id !== ev.host && erlaubt.has(id));
    if (!ids.length) return json({ sent: 0, failed: 0 });

    try {
      smtpClient();   // frühe, klare Meldung, falls SMTP gar nicht konfiguriert ist
    } catch (e) { return json({ error: (e as Error).message.slice(0, 300) }, 500); }
    const emails = await emailsOf(admin, ids);
    const mail = buildMail("invite", ev as EventRow, await hostName(admin, ev.host));
    let sent = 0, failed = 0;
    for (const [, addr] of emails) { if (await sendMail(addr, mail)) sent++; else failed++; }
    return json({ sent, failed });
  }

  // ---------------- Cron-Modus: Erinnerungen ----------------
  try {
    const now = new Date();
    const in3h = new Date(now.getTime() + 3 * 3600 * 1000);
    const { data: evs } = await admin.from("game_events")
      .select("id,title,description,starts_at,host")
      .eq("remind", true).is("reminded_at", null)
      .gt("starts_at", now.toISOString()).lte("starts_at", in3h.toISOString());

    const faellig = evs || [];
    if (!faellig.length) return json({ events: 0, sent: 0 });

    let sent = 0, failed = 0, done = 0;
    for (const ev of faellig) {
      const { data: rs } = await admin.from("event_rsvp")
        .select("user_id,status").eq("event_id", ev.id).neq("status", "no");
      const ids = (rs || []).map((r) => r.user_id as string);
      const emails = await emailsOf(admin, ids);
      const mail = buildMail("reminder", ev as EventRow, await hostName(admin, ev.host));
      let evSent = 0;
      for (const [, addr] of emails) { if (await sendMail(addr, mail)) { sent++; evSent++; } else failed++; }
      // Nur als erinnert markieren, wenn mindestens eine Mail rausging — sonst
      // (z. B. SMTP vorübergehend kaputt) beim nächsten Sweep erneut versuchen.
      // Nach dem Start fällt der Termin ohnehin aus dem Zeitfenster.
      if (evSent > 0) await admin.from("game_events").update({ reminded_at: new Date().toISOString() }).eq("id", ev.id);
      done++;
    }
    return json({ events: done, sent, failed });
  } catch (e) {
    return json({ error: (e as Error).message.slice(0, 300) }, 500);
  }
});
