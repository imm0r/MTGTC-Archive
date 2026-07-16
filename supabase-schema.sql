-- =====================================================================
--  MTG Sammlung — Datenbankschema
--  Einmalig ausführen: Supabase → SQL Editor → einfügen → "Run".
--  Das Skript ist wiederholbar; ein zweiter Lauf richtet keinen Schaden an.
-- =====================================================================

-- ---------------------------------------------------------------- Karten
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scryfall_id text not null,
  oracle_id   text,
  name        text not null,
  set_code    text,
  set_name    text,
  cn          text,
  img         text,
  lang        text not null default 'en',
  condition   text not null default 'NM',
  foil        boolean not null default false,
  qty         integer not null default 1 check (qty > 0),
  price       numeric(10,2),
  hist        jsonb not null default '[]'::jsonb,
  added       timestamptz not null default now(),
  -- Dieselbe Karte in derselben Ausführung ist EINE Zeile mit Anzahl.
  -- Die Datenbank erzwingt das, nicht nur die App.
  constraint cards_unique_printing unique (user_id, scryfall_id, foil, lang, condition)
);

-- --------------------------------------------------------------- Decks
create table if not exists public.decks (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name    text not null,
  created timestamptz not null default now()
);

create table if not exists public.deck_entries (
  deck_id uuid not null references public.decks(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  qty     integer not null default 1 check (qty > 0),
  primary key (deck_id, card_id)
);

create index if not exists cards_user_idx        on public.cards(user_id);
create index if not exists decks_user_idx        on public.decks(user_id);
create index if not exists deck_entries_deck_idx on public.deck_entries(deck_id);

-- ------------------------------------------------- Row Level Security
-- Ohne diesen Block könnte jeder mit dem öffentlichen Schlüssel alle Daten
-- lesen. Jede Zeile ist ausschließlich für ihren Eigentümer sichtbar.
alter table public.cards        enable row level security;
alter table public.decks        enable row level security;
alter table public.deck_entries enable row level security;

drop policy if exists "eigene karten" on public.cards;
create policy "eigene karten" on public.cards
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "eigene decks" on public.decks;
create policy "eigene decks" on public.decks
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "eigene deck-eintraege" on public.deck_entries;
create policy "eigene deck-eintraege" on public.deck_entries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------ Karte einbuchen
-- Anlegen oder Anzahl erhöhen in einem einzigen, atomaren Schritt.
-- Zwei Geräte, die dieselbe Karte gleichzeitig scannen, können sich so
-- nicht gegenseitig überschreiben.
create or replace function public.add_card(
  p_scryfall_id text, p_oracle_id text, p_name text, p_set_code text,
  p_set_name text, p_cn text, p_img text, p_lang text, p_condition text,
  p_foil boolean, p_price numeric
) returns public.cards
language plpgsql
security invoker
set search_path = public
as $$
declare r public.cards;
begin
  insert into public.cards as c
    (scryfall_id, oracle_id, name, set_code, set_name, cn, img,
     lang, condition, foil, qty, price, hist)
  values
    (p_scryfall_id, p_oracle_id, p_name, p_set_code, p_set_name, p_cn, p_img,
     p_lang, p_condition, p_foil, 1, p_price,
     case when p_price is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
                 'd', to_char(current_date, 'YYYY-MM-DD'), 'v', p_price)) end)
  on conflict on constraint cards_unique_printing do update
    set qty   = c.qty + 1,
        price = coalesce(excluded.price, c.price)
  returning * into r;
  return r;
end $$;

-- ------------------------------------------------- Preis fortschreiben
-- Schreibt den Tagespreis in die Historie: ein Eintrag pro Tag, die
-- letzten 60 Tage. Ersetzt den Wert, falls heute schon einer da ist.
create or replace function public.set_price(p_card_id uuid, p_price numeric)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  h     jsonb;
  d_txt text := to_char(current_date, 'YYYY-MM-DD');
begin
  select hist into h from public.cards where id = p_card_id;
  if h is null then return; end if;             -- fremde oder gelöschte Zeile

  if jsonb_array_length(h) > 0
     and h -> (jsonb_array_length(h) - 1) ->> 'd' = d_txt then
    h := jsonb_set(h, array[(jsonb_array_length(h) - 1)::text, 'v'], to_jsonb(p_price));
  elsif p_price is not null then
    h := h || jsonb_build_array(jsonb_build_object('d', d_txt, 'v', p_price));
  end if;

  -- auf die letzten 60 Einträge kürzen. Das "order by i" muss in der
  -- Aggregatfunktion stehen: eine sortierte Unterabfrage allein garantiert
  -- die Reihenfolge im Ergebnis nicht.
  if jsonb_array_length(h) > 60 then
    select jsonb_agg(e order by i) into h
    from (select e, i from jsonb_array_elements(h) with ordinality t(e, i)
          order by i offset jsonb_array_length(h) - 60) s;
  end if;

  update public.cards set price = p_price, hist = h where id = p_card_id;
end $$;
