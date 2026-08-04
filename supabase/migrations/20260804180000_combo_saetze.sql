-- Zwischenspeicher für übersetzte Combo-Sätze.
--
-- ANLASS. Commander Spellbook liefert seine Anleitungen ausschließlich auf
-- Englisch. Übersetzt werden sie von der Edge Function „combo-uebersetzen";
-- diese Tabelle sorgt dafür, dass jeder Satz das nur EINMAL durchmachen muss.
--
-- WARUM JE SATZ UND NICHT JE COMBO. Combo-Anleitungen sind formelhaft. In einer
-- Stichprobe von 600 Combos mit 3210 Sätzen kam „Repeat." allein 296-mal vor.
-- Ersetzt man die Kartennamen durch Platzhalter ([[1]], [[2]] …) und
-- nummeriert sie je Satz nach erstem Auftreten, bleiben 1638 verschiedene
-- Muster übrig — 49 % weniger als Sätze. Der Anteil wächst weiter, je mehr
-- Combos über die Zeit angesehen werden.
--
-- WARUM DER SCHLÜSSEL EIN HASH IST. Das Muster selbst ist bis zu mehreren
-- hundert Zeichen lang; ein Primärschlüssel darüber wäre in Postgres bei
-- längeren Sätzen an der Indexgrenze (2704 Bytes für btree). Der Hash ist
-- fest 64 Zeichen, das Muster steht daneben — les- und nachvollziehbar, aber
-- nicht indextragend.
create table if not exists public.combo_saetze (
  -- sha256(muster) als Hex, in der Edge Function gebildet.
  hash    text not null,
  -- Sprachkürzel wie in i18n.js: de, en, fr, es, it.
  lang    text not null,
  -- Das englische Muster mit Platzhaltern, unübersetzt. Steht hier, damit man
  -- der Tabelle ansieht, was drinsteht, und damit ein Wiederaufbau möglich
  -- bleibt, falls die Hash-Bildung je wechselt.
  muster  text not null,
  -- Die Übersetzung, ebenfalls mit Platzhaltern. Die Namen setzt erst die
  -- Anzeige ein — mit dem gedruckten Namen aus der Sammlung des Betrachters.
  text    text not null,
  erstellt timestamptz not null default now(),
  primary key (hash, lang)
);

alter table public.combo_saetze enable row level security;

-- LESEN DÜRFEN ALLE ANGEMELDETEN. Der Inhalt ist kein Besitz von irgendwem:
-- Es sind übersetzte Regeltexte einer öffentlichen Datenbank. Genau darin
-- liegt der Nutzen — was ein Nutzer übersetzen ließ, spart allen anderen den
-- Aufruf.
drop policy if exists "combo-saetze lesen" on public.combo_saetze;
create policy "combo-saetze lesen" on public.combo_saetze
  for select to authenticated
  using (true);

-- SCHREIBEN DARF NUR DIE EDGE FUNCTION. Sie läuft mit dem service_role-Key und
-- geht damit an RLS vorbei; hier steht bewusst KEINE insert-Regel für
-- angemeldete Nutzer. Sonst könnte jeder beliebigen Text als „Übersetzung"
-- hinterlegen, und alle anderen bekämen ihn ausgeliefert.

-- Suche nach Sprache: Die Anzeige holt immer einen Schwung Hashes für EINE
-- Sprache. Der Primärschlüssel beginnt mit dem Hash und hilft dabei nicht.
create index if not exists combo_saetze_lang_idx on public.combo_saetze (lang);


-- =====================================================================
--  Kontingent und Schalter
-- =====================================================================

-- Der Schalter steht auf AUS. Die Edge Function „combo-uebersetzen" wird in
-- diesem Repository von keinem Workflow ausgeliefert — sie muss von Hand
-- hochgeladen werden. Stünde der Schalter auf an, liefe die App bis dahin
-- gegen eine Funktion, die es nicht gibt. Andersherum ist der Rückfall
-- lautlos: Ohne Schalter zeigt sie weiter das englische Original.
insert into public.feature_flags (key, enabled) values ('ki_combo_text', false)
  on conflict (key) do nothing;

-- Kontingent wie bei den anderen KI-Wegen. NÖTIG, obwohl der Zwischenspeicher
-- die Kosten schon drückt: Er greift nur bei Sätzen, die es schon gibt. Wer
-- der Funktion beliebige Zeichenketten schickt, erzeugt lauter neue Muster —
-- jedes davon ein Aufruf. Die Grenze sitzt deshalb am Nutzer, nicht am Satz.
alter table public.ai_quota drop constraint if exists ai_quota_kind_check;
alter table public.ai_quota add constraint ai_quota_kind_check
  check (kind in ('ki_synergy', 'rules_question', 'combo_text'));

create or replace function public.claim_ai_quota(p_kind text, p_limit integer default 5)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_grenze integer := greatest(1, coalesce(p_limit, 5));
  v_n     integer;
  v_frei  timestamptz;
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;
  if p_kind not in ('ki_synergy', 'rules_question', 'combo_text') then
    raise exception 'Unknown quota kind';
  end if;

  -- Nur die eigenen Altlasten wegräumen: ein Rundumschlag über die ganze
  -- Tabelle würde bei jedem Aufruf mit allen anderen konkurrieren.
  delete from public.ai_quota
   where user_id = v_user and at < now() - interval '1 hour';

  select count(*) into v_n from public.ai_quota
   where user_id = v_user and kind = p_kind and at > now() - interval '1 hour';

  if v_n >= v_grenze then
    select min(at) + interval '1 hour' into v_frei from public.ai_quota
     where user_id = v_user and kind = p_kind and at > now() - interval '1 hour';
    return jsonb_build_object('ok', false, 'remaining', 0, 'reset_at', v_frei);
  end if;

  insert into public.ai_quota (user_id, kind) values (v_user, p_kind);
  return jsonb_build_object('ok', true, 'remaining', v_grenze - v_n - 1, 'reset_at', null);
end;
$$;

revoke all on function public.claim_ai_quota(text, integer) from public, anon;
grant execute on function public.claim_ai_quota(text, integer) to authenticated;
