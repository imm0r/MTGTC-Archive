-- =====================================================================
-- Stundenkontingent für die Funktionen, die Modellaufrufe kosten.
--
-- Betroffen sind nur die tatsächlichen Kostenträger:
--   ki_synergy      card-synergy  -> Claude
--   rules_question  rules-question -> Claude (Triage + Urteil)
--
-- BEWUSST NICHT gedeckelt:
--   * Combos — die Edge Function ist ein Proxy zu Commander Spellbook,
--     öffentlich und ohne API-Key. Kostet nichts.
--   * Heuristische Synergien — laufen direkt gegen Scryfall, ohne Modell.
--   * Kartenscan — der Einstiegsweg für neue Mitglieder, gerade solche mit
--     großen Sammlungen. Ihn zu deckeln würde die Gewinnung behindern; die
--     Kosten sind an dieser Stelle die Investition wert.
--
-- Die Sperre gehört auf den Server, nicht in die Oberfläche: Wer angemeldet
-- ist, kann die Funktions-URL unmittelbar aufrufen. Deshalb prüft die Edge
-- Function selbst, bevor sie das Modell befragt — dieselbe Überlegung wie
-- beim vorhandenen Feature-Schalter.
-- =====================================================================

create table if not exists public.ai_quota (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null check (kind in ('ki_synergy', 'rules_question')),
  at      timestamptz not null default now()
);

create index if not exists ai_quota_user_kind_at_idx
  on public.ai_quota (user_id, kind, at desc);

alter table public.ai_quota enable row level security;
-- Niemand liest oder schreibt das direkt; alles läuft über claim_ai_quota.
revoke all on public.ai_quota from anon, authenticated;

/* Einen Aufruf verbuchen, wenn noch Kontingent frei ist.

   Rückgabe: { ok, remaining, reset_at }
   reset_at ist der Zeitpunkt, zu dem der älteste Aufruf im Fenster herausfällt
   — also wann wieder etwas frei wird. Als ISO-Zeitstempel, damit der Browser
   ihn in die lokale Zeitzone rechnen kann; der Server steht auf UTC und wüsste
   sie nicht.

   Bei zwei exakt gleichzeitigen Aufrufen kann einer zu viel durchgehen. Für ein
   Stundenkontingent ist das bedeutungslos und eine Sperre wäre teurer als der
   Fehler, den sie verhindert. */
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
  if p_kind not in ('ki_synergy', 'rules_question') then
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
