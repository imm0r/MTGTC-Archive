-- =====================================================================
-- Community Foundation — Vorschläge tauchen auch im Aktivitätsstrom auf.
--
-- Bisher landeten Combo- und Synergie-Treffer nur in den Gesamtsummen. Sie
-- bekommen jetzt zusätzlich einen Eintrag:
--
--   „Sturmprophet hat sich 12 Combos vorschlagen lassen"
--   „Ein Mitglied hat sich 8 Synergien vorschlagen lassen"
--
-- Beides bleibt nebeneinander bestehen, und zwar mit Absicht:
--   * Die Summe ist kumulativ und personenlos. Sie überlebt die Aufbewahrungs-
--     frist, denn eine Gesamtzahl, die nach 90 Tagen schrumpft, wäre keine.
--   * Der Eintrag ist personenbezogen und vergänglich. Er läuft über
--     record_community_activity und fällt damit ohne weiteres Zutun unter die
--     Sichtbarkeitseinstellung: „privat" erzeugt keinen, „anonym" einen ohne
--     Urheber. Die Summe zählt in beiden Fällen weiter — sie verrät nichts
--     über eine einzelne Person.
--
-- Der Aufruf aus dem Browser bleibt derselbe; welche Ereignisart daraus wird,
-- entscheidet die Datenbank.
-- =====================================================================

-- Zwei neue Arten in die Erlaubnisliste der Tabelle.
alter table public.community_activity
  drop constraint if exists community_activity_kind_check;
alter table public.community_activity
  add constraint community_activity_kind_check check (kind in (
    'card_added', 'deck_created', 'session_started', 'session_joined',
    'session_ended', 'event_created', 'event_rsvp',
    'combo_search', 'synergy_search'
  ));

-- ... und in die des Schreibwegs.
create or replace function public.record_community_activity(
  p_actor_id uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sicht text;
begin
  if p_kind not in ('card_added', 'deck_created', 'session_started', 'session_joined',
                    'session_ended', 'event_created', 'event_rsvp',
                    'combo_search', 'synergy_search') then
    raise exception 'Unknown community activity kind';
  end if;

  select community_visibility into v_sicht from public.profiles where id = p_actor_id;
  v_sicht := coalesce(v_sicht, 'public');

  if v_sicht = 'private' then
    return;
  end if;

  insert into public.community_activity (actor_id, kind, metadata)
    values (case when v_sicht = 'anonymous' then null else p_actor_id end,
            p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

-- Ein Aufruf, zwei Wirkungen: Summe hoch und Eintrag schreiben.
create or replace function public.record_community_search(p_kind text, p_n integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_n integer;
begin
  if p_kind not in ('combos', 'synergies') then
    raise exception 'Unknown community counter';
  end if;

  -- Deckel gegen Ausreißer: eine einzelne Suche liefert nie hunderte Treffer,
  -- und der Aufruf kommt aus dem Browser — also nicht unbesehen übernehmen.
  v_n := greatest(0, least(coalesce(p_n, 0), 200));
  if v_n = 0 then
    return;
  end if;

  update public.community_counters
     set total = total + v_n
   where kind = p_kind;

  -- Der Eintrag geht über den üblichen Weg; die Sichtbarkeitsprüfung steckt
  -- dort und muss hier nicht wiederholt werden.
  perform public.record_community_activity(
    auth.uid(),
    case p_kind when 'combos' then 'combo_search' else 'synergy_search' end,
    jsonb_build_object('n', v_n));
end;
$$;

revoke all on function public.record_community_search(text, integer) from public, anon;
grant execute on function public.record_community_search(text, integer) to authenticated;
