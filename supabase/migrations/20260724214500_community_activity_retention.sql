-- =====================================================================
-- Community Foundation — Aufbewahrung begrenzen.
--
-- Die Tabelle wächst mit jeder erfassten Karte: ein einziger CSV-Import
-- schreibt hunderte Zeilen. Ohne Begrenzung wächst sie unbegrenzt, obwohl
-- der Feed nie mehr als die letzten 50 Einträge zeigt.
--
-- Zwei Bedingungen zusammen, nicht nur das Alter: alles älter als 90 Tage
-- fliegt raus, aber die 200 neuesten Einträge bleiben immer erhalten. Sonst
-- stünde der Feed nach einer ruhigen Phase leer da — und ein leerer Feed
-- sieht aus wie ein Fehler, nicht wie Ruhe.
-- =====================================================================

create or replace function public.prune_community_activity(
  p_keep_days integer default 90,
  p_keep_min  integer default 200
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_weg bigint;
begin
  with behalten as (
    select id from public.community_activity
     order by occurred_at desc
     limit greatest(0, p_keep_min)
  )
  delete from public.community_activity a
   where a.occurred_at < now() - make_interval(days => greatest(0, p_keep_days))
     and not exists (select 1 from behalten b where b.id = a.id);

  get diagnostics v_weg = row_count;
  return v_weg;
end;
$$;

-- Aufräumen ist Sache des Servers, nicht der Oberfläche.
revoke all on function public.prune_community_activity(integer, integer)
  from public, anon, authenticated;

-- Täglich um 03:17 UTC — abseits der vollen Stunde, damit der Job nicht mit
-- allem anderen zusammenfällt, was zur selben Zeit läuft.
do $$
begin
  perform cron.unschedule('community-activity-retention')
    where exists (select 1 from cron.job where jobname = 'community-activity-retention');

  perform cron.schedule('community-activity-retention', '17 3 * * *',
                        $job$select public.prune_community_activity();$job$);
end;
$$;
