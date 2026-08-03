-- =====================================================================
-- „Deck mit der Community geteilt" im Live-Feed, dazu die Kachel dafür.
--
-- EIN EREIGNIS, NICHT ZWEI. Ein neu angelegtes Deck ist seit der letzten
-- Migration von sich aus öffentlich. Schriebe man dafür `deck_created` UND
-- `deck_public`, stünden im Feed zwei Zeilen für denselben Augenblick.
-- Deshalb ENTSCHEIDET der Trigger beim Anlegen, welche der beiden es ist:
--
--   neues Deck, öffentlich   → deck_public   („mit der Community geteilt")
--   neues Deck, privat       → deck_created  („ein Deck erstellt")
--   bestehendes, false→true  → deck_public
--
-- So sagt jede Zeile genau, was geschehen ist, und es bleibt bei einer.
--
-- OHNE DECKNAMEN. Der Feed ist bewusst datensparsam — „Private card, deck and
-- event details never enter this table" steht seit Sprint 1 im Kopf der
-- Foundation-Migration. Ein Deck kann außerdem später wieder privat gestellt
-- werden; sein Name stünde dann noch im Feed. Die Zeile nennt also die Person
-- und das Ereignis, nicht das Deck.
-- =====================================================================

-- ---- Die neue Art -----------------------------------------------------
alter table public.community_activity drop constraint if exists community_activity_kind_check;
alter table public.community_activity add constraint community_activity_kind_check
  check (kind in ('card_added', 'deck_created', 'deck_public', 'session_started',
                  'session_joined', 'session_ended', 'event_created', 'event_rsvp'));

create or replace function public.record_community_activity(
  p_actor_id uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_kind not in ('card_added', 'deck_created', 'deck_public', 'session_started',
                    'session_joined', 'session_ended', 'event_created', 'event_rsvp') then
    raise exception 'Unknown community activity kind';
  end if;

  insert into public.community_activity (actor_id, kind, metadata)
    values (p_actor_id, p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

-- ---- Der Trigger ------------------------------------------------------
create or replace function public.log_deck_created_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Genau eine Zeile, und zwar die zutreffende (siehe Kopf).
    perform public.record_community_activity(new.user_id,
      case when new.is_public then 'deck_public' else 'deck_created' end);
  elsif coalesce(old.is_public, false) = false and new.is_public then
    perform public.record_community_activity(new.user_id, 'deck_public');
  end if;
  return new;
end;
$$;

-- Der bestehende Trigger hängt nur an INSERT; für den Wechsel braucht es das
-- UPDATE dazu. Ein eigener zweiter Trigger und nicht „insert or update" am
-- alten: Der alte wird von der Foundation-Migration angelegt, und die soll
-- weiterhin für sich lauffähig bleiben.
drop trigger if exists trg_deck_public_activity on public.decks;
create trigger trg_deck_public_activity
  after update of is_public on public.decks
  for each row execute function public.log_deck_created_activity();

-- ---- Die Kachel -------------------------------------------------------
-- Ein weiterer OUT-Parameter ändert den Rückgabetyp, und den lässt
-- „create or replace" nicht anfassen — erst weg, dann neu. Innerhalb der
-- Migrationstransaktion entsteht dabei keine Lücke, in der sie fehlte.
drop function if exists public.community_statistics();

create or replace function public.community_statistics()
returns table(
  member_count bigint,
  deck_count bigint,
  public_deck_count bigint,
  card_count bigint,
  active_session_count bigint,
  upcoming_event_count bigint,
  activity_7d_count bigint,
  combo_count bigint,
  synergy_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.decks),
    (select count(*) from public.decks where is_public),
    (select coalesce(sum(qty), 0) from public.cards where qty > 0),
    (select count(*) from public.game_sessions where status = 'open'),
    (select count(*) from public.game_events where starts_at >= now()),
    (select count(*) from public.community_activity where occurred_at >= now() - interval '7 days'),
    (select coalesce(total, 0) from public.community_counters where kind = 'combos'),
    (select coalesce(total, 0) from public.community_counters where kind = 'synergies');
$$;
revoke all on function public.community_statistics() from public, anon;
grant execute on function public.community_statistics() to authenticated;
