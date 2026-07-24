-- =====================================================================
-- Community Foundation (Sprint 1)
-- A deliberately small, public-safe event stream. Private card, deck and
-- event details never enter this table; consumers only receive the action,
-- actor and timestamp.
-- =====================================================================

create table public.community_activity (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in (
    'card_added', 'deck_created', 'session_started', 'session_joined',
    'session_ended', 'event_created', 'event_rsvp'
  )),
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index community_activity_occurred_at_idx
  on public.community_activity (occurred_at desc);
create index community_activity_actor_occurred_at_idx
  on public.community_activity (actor_id, occurred_at desc);

alter table public.community_activity enable row level security;
revoke all on public.community_activity from anon, authenticated;
grant select on public.community_activity to authenticated;

create policy community_activity_read_authenticated
  on public.community_activity for select to authenticated using (true);

-- Activity service: internal-only write entry point used by database triggers.
-- It keeps the feed free of user-controlled names, IDs and other private data.
create or replace function public.record_community_activity(
  p_actor_id uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_kind not in ('card_added', 'deck_created', 'session_started', 'session_joined',
                    'session_ended', 'event_created', 'event_rsvp') then
    raise exception 'Unknown community activity kind';
  end if;

  insert into public.community_activity (actor_id, kind, metadata)
    values (p_actor_id, p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.log_card_added_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.qty > old.qty then
    perform public.record_community_activity(new.user_id, 'card_added');
  end if;
  return new;
end;
$$;

create or replace function public.log_deck_created_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_community_activity(new.user_id, 'deck_created');
  return new;
end;
$$;

create or replace function public.log_session_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_community_activity(new.host, 'session_started');
  elsif old.status is distinct from 'ended' and new.status = 'ended' then
    perform public.record_community_activity(new.host, 'session_ended');
  end if;
  return new;
end;
$$;

create or replace function public.log_session_joined_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from 'joined' and new.status = 'joined' then
    perform public.record_community_activity(new.user_id, 'session_joined');
  end if;
  return new;
end;
$$;

create or replace function public.log_event_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_community_activity(new.host, 'event_created');
  end if;
  return new;
end;
$$;

create or replace function public.log_event_rsvp_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('yes', 'maybe') and old.status is distinct from new.status then
    perform public.record_community_activity(new.user_id, 'event_rsvp',
      jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists community_activity_cards on public.cards;
create trigger community_activity_cards
after insert or update of qty on public.cards
for each row execute function public.log_card_added_activity();

drop trigger if exists community_activity_decks on public.decks;
create trigger community_activity_decks
after insert on public.decks
for each row execute function public.log_deck_created_activity();

drop trigger if exists community_activity_sessions on public.game_sessions;
create trigger community_activity_sessions
after insert or update of status on public.game_sessions
for each row execute function public.log_session_activity();

drop trigger if exists community_activity_session_players on public.session_players;
create trigger community_activity_session_players
after update of status on public.session_players
for each row execute function public.log_session_joined_activity();

drop trigger if exists community_activity_events on public.game_events;
create trigger community_activity_events
after insert on public.game_events
for each row execute function public.log_event_activity();

drop trigger if exists community_activity_rsvp on public.event_rsvp;
create trigger community_activity_rsvp
after update of status on public.event_rsvp
for each row execute function public.log_event_rsvp_activity();

-- Statistics service: aggregates only counts that are safe for every signed-in
-- member to see. SECURITY DEFINER avoids exposing the underlying private tables.
create or replace function public.community_statistics()
returns table(
  member_count bigint,
  deck_count bigint,
  card_count bigint,
  active_session_count bigint,
  upcoming_event_count bigint,
  activity_7d_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.decks),
    (select coalesce(sum(qty), 0) from public.cards where qty > 0),
    (select count(*) from public.game_sessions where status = 'open'),
    (select count(*) from public.game_events where starts_at >= now()),
    (select count(*) from public.community_activity where occurred_at >= now() - interval '7 days');
$$;
revoke all on function public.community_statistics() from public, anon;
grant execute on function public.community_statistics() to authenticated;

-- Feed service: profiles remain private under their own RLS policy. This
-- narrowly scoped projection exposes only a display label for an activity.
create or replace function public.community_activity_feed(p_limit integer default 20)
returns table(
  id bigint,
  kind text,
  actor_id uuid,
  actor_name text,
  metadata jsonb,
  occurred_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.kind, a.actor_id,
         coalesce(nullif(trim(p.display_name), ''), 'Ein Mitglied') as actor_name,
         a.metadata, a.occurred_at
    from public.community_activity a
    left join public.profiles p on p.id = a.actor_id
   order by a.occurred_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke all on function public.community_activity_feed(integer) from public, anon;
grant execute on function public.community_activity_feed(integer) to authenticated;

alter table public.community_activity replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'community_activity'
  ) then
    alter publication supabase_realtime add table public.community_activity;
  end if;
end;
$$;
