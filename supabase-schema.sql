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
  name        text not null,   -- englischer (kanonischer) Name
  printed_name text,           -- Name wie auf der Karte gedruckt, z. B. deutsch
  set_code    text,
  set_name    text,
  cn          text,
  img         text,
  cm_id       integer,       -- Cardmarket-Produkt-ID für den Direktlink
  -- Typzeile, von Scryfall IMMER englisch ("Legendary Creature — Alien"),
  -- auch bei fremdsprachigen Auflagen. Deshalb ist die Prüfung auf
  -- "legendary" sprachunabhängig; die gedruckte Fassung wäre es nicht.
  type_line   text,
  -- common, uncommon, rare, mythic, special, bonus. Bewusst ohne CHECK:
  -- käme eine siebte Stufe dazu, soll das Einbuchen nicht scheitern.
  rarity      text,
  -- Manakosten wie aufgedruckt, in Scryfall-Schreibweise: "{2}{G}{G}",
  -- "{1}{G/W}", "{X}{R}". Bei geteilten Karten beide Hälften: "{1}{R} // {1}{U}".
  -- WICHTIG: '' heißt "kostet nichts" (Länder, Tokens) und ist ein gültiger
  -- Wert — nur NULL bedeutet "noch nicht erfasst".
  mana_cost   text,
  -- Manawert (Scryfalls cmc), Sortierschlüssel der Mana-Spalte. Eigene Spalte
  -- und NICHT aus mana_cost gerechnet: der Wert folgt nicht aus der
  -- Zeichenkette. "Picnic Ruiner // Stolen Goodies" kostet "{1}{R} // {3}{G}"
  -- und hat Wert 2 (Abenteuer: nur die Kreatur zählt), eine echte geteilte
  -- Karte mit derselben Schreibweise hätte 6. Das entscheidet die Bauart, die
  -- wir nicht speichern. numeric, nicht integer: Unhinged kennt halbe Kosten.
  cmc         numeric,
  -- Erscheinungsdatum der Auflage: Scryfalls released_at der KARTE, nicht des
  -- Sets. Meist identisch — von 208 Auflagen im Bestand stimmten 206 überein.
  -- Auseinander gehen sie bei laufenden Sammlungen und Promo-Reihen: „Frozen
  -- Aether" auf The List trägt 2020-03-13, das Set 2020-09-26. Die Karte weiß
  -- es genauer.
  released    date,
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
  -- Aushängeschild des Decks (Kommandeur o. ä.). "set null" beim Löschen:
  -- verschwindet die Karte aus der Sammlung, verliert das Deck nur sein
  -- Bild — es darf auf keinen Fall mitgelöscht werden.
  main_card_id uuid references public.cards(id) on delete set null,
  created timestamptz not null default now()
);

create table if not exists public.deck_entries (
  deck_id uuid not null references public.decks(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  qty     integer not null default 1 check (qty > 0),
  primary key (deck_id, card_id)
);

-- Für Bestände, die vor diesen Spalten angelegt wurden:
alter table public.cards add column if not exists printed_name text;
alter table public.cards add column if not exists cm_id integer;
alter table public.decks add column if not exists main_card_id uuid
  references public.cards(id) on delete set null;
alter table public.cards add column if not exists type_line text;
alter table public.cards add column if not exists rarity text;
alter table public.cards add column if not exists mana_cost text;
alter table public.cards add column if not exists cmc numeric;
alter table public.cards add column if not exists released date;

create index if not exists cards_user_idx        on public.cards(user_id);
create index if not exists decks_user_idx        on public.decks(user_id);
create index if not exists deck_entries_deck_idx on public.deck_entries(deck_id);

-- ------------------------------------------------- Row Level Security
-- Ohne diesen Block könnte jeder mit dem öffentlichen Schlüssel alle Daten
-- lesen. Jede Zeile ist ausschließlich für ihren Eigentümer sichtbar.
alter table public.cards        enable row level security;
alter table public.decks        enable row level security;
alter table public.deck_entries enable row level security;

-- "force" gilt zusätzlich für den Tabelleneigentümer, "revoke" nimmt anon
-- alle direkt vergebenen Rechte. Ohne Anmeldung ist auf diesen Tabellen
-- nichts zu suchen — der öffentliche Schlüssel steht im Repository.
alter table public.cards        force row level security;
alter table public.decks        force row level security;
alter table public.deck_entries force row level security;
revoke all on public.cards        from anon;
revoke all on public.decks        from anon;
revoke all on public.deck_entries from anon;

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
-- Die Fassung ohne p_printed_name muss weg: ein zusätzlicher Parameter
-- ergibt in Postgres eine zweite Funktion gleichen Namens statt eines
-- Ersatzes, und PostgREST kann dann nicht mehr entscheiden, welche gemeint
-- ist ("Could not choose the best candidate function").
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, text, boolean, numeric);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, text, text, boolean, numeric);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text, text);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text, text, text);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text, text, text, numeric);

create or replace function public.add_card(
  p_scryfall_id text, p_oracle_id text, p_name text, p_printed_name text,
  p_set_code text, p_set_name text, p_cn text, p_img text, p_cm_id integer,
  p_lang text, p_condition text, p_foil boolean, p_price numeric,
  p_type_line text default null, p_rarity text default null,
  p_mana_cost text default null, p_cmc numeric default null,
  p_released date default null
) returns public.cards
language plpgsql
security invoker
set search_path = public
as $$
declare r public.cards;
begin
  insert into public.cards as c
    (scryfall_id, oracle_id, name, printed_name, set_code, set_name, cn, img,
     cm_id, lang, condition, foil, qty, price, hist, type_line, rarity,
     mana_cost, cmc, released)
  values
    (p_scryfall_id, p_oracle_id, p_name, p_printed_name, p_set_code, p_set_name,
     p_cn, p_img, p_cm_id, p_lang, p_condition, p_foil, 1, p_price,
     case when p_price is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
                 'd', to_char(current_date, 'YYYY-MM-DD'), 'v', p_price)) end,
     p_type_line, p_rarity, p_mana_cost, p_cmc, p_released)
  on conflict on constraint cards_unique_printing do update
    set qty       = c.qty + 1,
        price     = coalesce(excluded.price, c.price),
        cm_id     = coalesce(excluded.cm_id, c.cm_id),
        -- Bestandskarten ohne diese Angaben bekommen sie beim nächsten Scan mit.
        type_line = coalesce(excluded.type_line, c.type_line),
        rarity    = coalesce(excluded.rarity, c.rarity),
        -- coalesce, nicht "nur wenn leer": '' bzw. 0 sind gültige Werte
        -- ("kostet nichts"), nur NULL ist eine Lücke.
        mana_cost = coalesce(excluded.mana_cost, c.mana_cost),
        cmc       = coalesce(excluded.cmc, c.cmc),
        released  = coalesce(excluded.released, c.released)
  returning * into r;
  return r;
end $$;

-- ------------- Hauptkarte muss legendäre Kreatur oder Planeswalker sein
-- Die Regel steht in der Datenbank, nicht in der App: eine Regel in der
-- Datenbank ist prüfbar, dieselbe Regel im Client ist eine Bitte. Kein
-- Import und kein direkter Zugriff kann sie umgehen.
--
-- Geprüft wird nur die VORDERSEITE (alles vor "//"): Mit ihr startet der
-- Commander. "Legendary Enchantment — Aura // Legendary Land" ist deshalb
-- keiner, obwohl die Rückseite legendär ist.
--
-- "Legendary Artifact Creature — Wizard" (Memnarch) besteht dagegen: er ist
-- eine Kreatur. Deshalb ilike '%creature%' statt eines Präfix-Vergleichs.
create or replace function public.check_main_card_legendary()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  tl text;
  vorderseite text;
begin
  if new.main_card_id is null then return new; end if;

  select type_line into tl from public.cards where id = new.main_card_id;

  -- Typzeile noch nicht bekannt: nicht raten, sondern ablehnen.
  if tl is null then
    raise exception 'Typzeile dieser Karte ist unbekannt — Preis neu ziehen, dann erneut versuchen'
      using errcode = 'check_violation';
  end if;

  vorderseite := split_part(tl, '//', 1);

  if vorderseite not ilike '%legendary%' then
    raise exception 'Nur legendäre Karten können Hauptkarte sein (diese ist: %)', tl
      using errcode = 'check_violation';
  end if;

  if vorderseite not ilike '%creature%' and vorderseite not ilike '%planeswalker%' then
    raise exception 'Eine Hauptkarte muss eine legendäre Kreatur oder ein legendärer Planeswalker sein (diese ist: %)', tl
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists decks_main_card_legendary on public.decks;
create trigger decks_main_card_legendary
  before insert or update of main_card_id on public.decks
  for each row execute function public.check_main_card_legendary();

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
