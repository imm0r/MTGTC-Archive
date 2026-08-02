-- =====================================================================
-- Community-Decks: öffentlich statt nur mit Freunden geteilt, dazu Sterne.
--
-- `shared` gibt ein Deck den FREUNDEN frei. `is_public` gibt es allen frei.
-- Zwei Schalter, weil es zwei verschiedene Dinge sind: „meine Runde soll das
-- sehen" und „das darf jeder sehen". Wer nur den einen will, soll nicht den
-- anderen mitbekommen.
--
-- BESTEHENDE DECKS BLEIBEN PRIVAT. Die Spalte entsteht mit default false,
-- bekommt ihren Vorgabewert true erst DANACH — sonst wäre mit dieser Migration
-- jedes bereits angelegte Deck veröffentlicht, ohne dass jemand zugestimmt
-- hätte. Neue und importierte Decks sind öffentlich, so gewollt; die Richtung
-- „aus Versehen veröffentlicht" lässt sich nicht zurücknehmen, die Richtung
-- „muss einmal umgeschaltet werden" schon.
--
-- WAS ÖFFENTLICH HEISST: dieselben fünf Ebenen wie bei `shared` — Deck,
-- Einträge, Fächer, Zuordnungen und die Karten selbst. Ein Deck ohne seine
-- Einteilung wäre eine Liste, mit ihr ein Bauplan; und ohne die Karten hätte
-- niemand etwas zu sehen. Nur die Freundschaftsprüfung fällt weg.
--
-- STERNE: eine Zeile je Deck und Bewerter, 1 bis 5. Das EIGENE Deck lässt sich
-- nicht bewerten — Selbstlob ist keine Auskunft, und ohne diese Schranke wäre
-- die Rangliste ein Wettbewerb im Fünf-Sterne-Vergeben an sich selbst.
--
-- DIE RANGLISTE GLÄTTET (Bayes). Ein Deck mit einer einzigen 5 stünde sonst
-- über einem mit fünfzig 4,8ern, und die Liste zeigte nicht die besten Decks,
-- sondern die mit den wenigsten Bewertungen:
--
--     rang = (n/(n+m))·schnitt + (m/(n+m))·gesamtschnitt,  m = 3
--
-- Wer wenige Stimmen hat, wird zur Mitte gezogen; mit wachsender Zahl zählt
-- der eigene Schnitt immer mehr. Angezeigt wird trotzdem der ECHTE Schnitt —
-- geglättet wird nur sortiert, nicht behauptet.
-- =====================================================================

-- ---- Der Schalter ---------------------------------------------------
alter table public.decks add column if not exists is_public boolean not null default false;
-- Erst jetzt: Ab hier sind neue Decks öffentlich, die bestehenden bleiben es
-- nicht. Die Reihenfolge IST die Aussage.
alter table public.decks alter column is_public set default true;

create or replace function public.deck_public(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_public from public.decks where id = d), false);
$$;
create or replace function public.card_in_public_deck(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deck_entries de
    join public.decks d on d.id = de.deck_id
    where de.card_id = c and d.is_public);
$$;

drop policy if exists decks_select_public on public.decks;
create policy decks_select_public on public.decks for select to authenticated
  using (is_public);
drop policy if exists deck_entries_select_public on public.deck_entries;
create policy deck_entries_select_public on public.deck_entries for select to authenticated
  using (public.deck_public(deck_id));
drop policy if exists deck_categories_select_public on public.deck_categories;
create policy deck_categories_select_public on public.deck_categories for select to authenticated
  using (public.deck_public(deck_id));
drop policy if exists deck_entry_categories_select_public on public.deck_entry_categories;
create policy deck_entry_categories_select_public on public.deck_entry_categories for select to authenticated
  using (public.deck_public(deck_id));
drop policy if exists cards_select_public on public.cards;
create policy cards_select_public on public.cards for select to authenticated
  using (public.card_in_public_deck(id));

-- ---- Die Sterne -----------------------------------------------------
create table if not exists public.deck_ratings (
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stars   smallint not null check (stars between 1 and 5),
  created timestamptz not null default now(),
  primary key (deck_id, user_id)
);
create index if not exists deck_ratings_deck on public.deck_ratings(deck_id);
alter table public.deck_ratings enable row level security;
alter table public.deck_ratings force row level security;
revoke all on public.deck_ratings from anon;

-- Lesen darf jeder, was zu einem ÖFFENTLICHEN Deck gehört: Ohne das gäbe es
-- keinen Durchschnitt zu zeigen. Schreiben nur die eigene Zeile, nur zu einem
-- öffentlichen Deck, und nie zum eigenen.
drop policy if exists ratings_select on public.deck_ratings;
create policy ratings_select on public.deck_ratings for select to authenticated
  using (public.deck_public(deck_id));
drop policy if exists ratings_write on public.deck_ratings;
create policy ratings_write on public.deck_ratings for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and public.deck_public(deck_id)
              and not exists (select 1 from public.decks d
                               where d.id = deck_id and d.user_id = auth.uid()));

-- ---- Die Liste ------------------------------------------------------
-- sort: 'rang' (geglättet, Vorgabe), 'neu', 'stimmen'.
drop function if exists public.community_decks(text, text, integer, integer);
create function public.community_decks(q text default null,
                                       p_sort text default 'rang',
                                       p_limit integer default 12,
                                       p_offset integer default 0)
returns table (id uuid, name text, format text, archetype text,
               commander text, commander_img text, karten bigint,
               owner_id uuid, owner_name text, owner_avatar text,
               created timestamptz, schnitt numeric, stimmen bigint,
               meine smallint, gesamt bigint)
language sql stable security definer set search_path = public as $$
  with global as (
    -- Der Gesamtschnitt als Anker der Glättung. Ohne eine einzige Bewertung
    -- gibt es keinen — dann 3, die Mitte der Skala, damit die Formel auch am
    -- ersten Tag rechnet statt durch null zu teilen.
    select coalesce(avg(stars)::numeric, 3) as c from public.deck_ratings
  ),
  basis as (
    select d.id, d.name, d.format, d.archetype, d.user_id, d.created,
           cm.name as commander, cm.img as commander_img,
           (select coalesce(sum(de.qty), 0) from public.deck_entries de where de.deck_id = d.id) as karten,
           (select coalesce(avg(r.stars), 0)::numeric from public.deck_ratings r where r.deck_id = d.id) as schnitt,
           (select count(*) from public.deck_ratings r where r.deck_id = d.id) as stimmen,
           (select r.stars from public.deck_ratings r
             where r.deck_id = d.id and r.user_id = auth.uid()) as meine
      from public.decks d
      left join public.cards cm on cm.id = d.main_card_id
     where auth.uid() is not null and d.is_public
       and (nullif(btrim(coalesce(q, '')), '') is null
            or d.name ilike '%' || btrim(q) || '%'
            or coalesce(cm.name, '') ilike '%' || btrim(q) || '%')
  )
  select b.id, b.name, b.format, b.archetype, b.commander, b.commander_img, b.karten,
         b.user_id, p.display_name, p.avatar_url, b.created,
         round(b.schnitt, 2), b.stimmen, b.meine,
         count(*) over () as gesamt
    from basis b
    left join public.profiles p on p.id = b.user_id
    cross join global g
   order by case when coalesce(p_sort, 'rang') = 'neu' then null else
              -- Bayes: wenige Stimmen werden zum Gesamtschnitt gezogen.
              (b.stimmen::numeric / (b.stimmen + 3)) * b.schnitt
              + (3::numeric / (b.stimmen + 3)) * g.c
            end desc nulls last,
            case when coalesce(p_sort, 'rang') = 'stimmen' then b.stimmen else null end desc nulls last,
            b.created desc, b.id
   limit greatest(1, least(coalesce(p_limit, 12), 60))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.community_decks(text, text, integer, integer) from public, anon;
grant execute on function public.community_decks(text, text, integer, integer) to authenticated;

-- ---- Bewerten -------------------------------------------------------
-- Eine RPC statt eines rohen upsert: Sie gibt zurück, was danach dasteht
-- (Schnitt und Stimmen), sodass die Kachel sofort stimmt, ohne die ganze
-- Liste neu zu holen. 0 Sterne nimmt die Bewertung zurück.
drop function if exists public.rate_deck(uuid, smallint);
create function public.rate_deck(p_deck uuid, p_stars smallint)
returns table (schnitt numeric, stimmen bigint, meine smallint)
language plpgsql security invoker set search_path = public as $$
begin
  if p_stars is null or p_stars = 0 then
    delete from public.deck_ratings where deck_id = p_deck and user_id = auth.uid();
  elsif p_stars between 1 and 5 then
    insert into public.deck_ratings (deck_id, user_id, stars)
      values (p_deck, auth.uid(), p_stars)
      on conflict (deck_id, user_id) do update set stars = excluded.stars, created = now();
  else
    raise exception 'Sterne muessen zwischen 1 und 5 liegen';
  end if;
  return query
    select round(coalesce(avg(r.stars), 0)::numeric, 2), count(r.*),
           max(case when r.user_id = auth.uid() then r.stars end)::smallint
      from public.deck_ratings r where r.deck_id = p_deck;
end $$;
revoke all on function public.rate_deck(uuid, smallint) from public, anon;
grant execute on function public.rate_deck(uuid, smallint) to authenticated;
