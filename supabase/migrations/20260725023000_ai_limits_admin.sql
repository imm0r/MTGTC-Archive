-- =====================================================================
-- Stundenkontingente je Funktion vom Admin einstellbar machen.
--
-- Bisher standen die 5 fest im Quelltext der Edge Functions — jede Änderung
-- hätte einen Deploy gebraucht. Der Wert gehört in die Datenbank, wo der
-- Admin ihn wie den KI-Schalter umstellen kann.
--
--   0 = unbegrenzt. Dann wird gar nichts gebucht: kein Zählstand, keine
--   Zeile in ai_quota. Wer die Schranke ausschaltet, soll auch nicht dafür
--   Buch führen lassen.
--
-- Der Parameter p_limit von claim_ai_quota bleibt erhalten und dient nur
-- noch als Rückfall, falls für eine Art keine Zeile existiert. Damit
-- funktionieren die bereits ausgerollten Edge Functions unverändert weiter
-- — sie übergeben weiterhin 5, das die Tabelle schlicht überstimmt. Ein
-- erneuter Deploy ist für diese Änderung NICHT nötig.
-- =====================================================================

create table if not exists public.ai_limits (
  kind     text primary key check (kind in ('ki_synergy', 'rules_question')),
  per_hour integer not null default 5 check (per_hour >= 0)
);

insert into public.ai_limits (kind, per_hour)
     values ('ki_synergy', 5), ('rules_question', 5)
on conflict (kind) do nothing;

alter table public.ai_limits enable row level security;
revoke all on public.ai_limits from anon, authenticated;

-- Lesen darf jede angemeldete Person: die Oberfläche zeigt dem Admin die
-- aktuellen Werte, und ein Kontingent ist nichts Geheimes.
grant select on public.ai_limits to authenticated;
-- Ändern nur die Zahl, nicht die Art — die Spaltenrechte schließen aus, dass
-- über die Oberfläche neue Schlüssel entstehen.
grant update (per_hour) on public.ai_limits to authenticated;

drop policy if exists ai_limits_read on public.ai_limits;
create policy ai_limits_read on public.ai_limits
  for select to authenticated using (true);

-- Schreiben nur der Admin. is_admin() ist stable und security definer,
-- lässt sich hier also gefahrlos aufrufen.
drop policy if exists ai_limits_admin on public.ai_limits;
create policy ai_limits_admin on public.ai_limits
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.claim_ai_quota(p_kind text, p_limit integer default 5)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_grenze integer;
  v_n      integer;
  v_frei   timestamptz;
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;
  if p_kind not in ('ki_synergy', 'rules_question') then
    raise exception 'Unknown quota kind';
  end if;

  -- Die Tabelle ist maßgeblich; p_limit greift nur, wenn dort nichts steht.
  select per_hour into v_grenze from public.ai_limits where kind = p_kind;
  v_grenze := coalesce(v_grenze, greatest(0, coalesce(p_limit, 5)));

  if v_grenze = 0 then
    return jsonb_build_object('ok', true, 'remaining', null, 'reset_at', null);
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
