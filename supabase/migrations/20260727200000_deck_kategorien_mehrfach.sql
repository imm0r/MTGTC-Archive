-- Eine Karte darf in MEHREREN Kategorien ihres Decks stehen.
--
-- 0.23.0 hielt die Zuordnung als deck_entries.category_id, also genau eine je
-- Karte. Das hielt die Aussage "Summe der Gruppen = Deckgröße" wahr, zwingt
-- beim Deckbau aber zu einer Entscheidung, die niemand treffen will: Ein Sol
-- Ring ist Ramp UND Teil des Artefakt-Pakets, ein Solemn Simulacrum ist Ramp
-- UND Kartenziehen. Wer rechnet, will ihn in beiden Rechnungen sehen.
--
-- Verlustfrei: Jede vorhandene Zuordnung wird zur PRIMÄREN der neuen Tabelle —
-- eine einzige ist immer auch die erste.

create table if not exists public.deck_entry_categories (
  deck_id     uuid not null,
  card_id     uuid not null,
  category_id uuid not null references public.deck_categories(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Genau EINE Zuordnung je Karte ist die primäre. Sie beantwortet die Frage,
  -- die eine Mehrfachzuordnung offen lässt: Wo steht die Karte, wenn jede nur
  -- einmal vorkommen darf — etwa in einer Ausgabe der Deckliste.
  is_primary  boolean not null default false,
  primary key (deck_id, card_id, category_id),
  -- Auf den Deckplatz selbst: Fliegt die Karte aus dem Deck, fliegen ihre
  -- Zuordnungen mit. Eine verwaiste Einordnung für eine Karte, die gar nicht
  -- mehr drinliegt, kann es so nicht geben.
  foreign key (deck_id, card_id)
    references public.deck_entries(deck_id, card_id) on delete cascade
);

-- Höchstens eine primäre je Karte und Deck. Teilindex statt Bedingung, weil
-- eine Bedingung nur die eigene Zeile sieht — "genau eine unter allen Zeilen
-- dieser Karte" ist eine Aussage über die Menge.
create unique index if not exists deck_entry_categories_primaer_idx
  on public.deck_entry_categories(deck_id, card_id) where is_primary;
create index if not exists deck_entry_categories_deck_idx
  on public.deck_entry_categories(deck_id);
create index if not exists deck_entry_categories_kat_idx
  on public.deck_entry_categories(category_id);

-- "on delete cascade" auf deck_categories: Wer eine Kategorie löscht, will das
-- Fach loswerden, NICHT die Karten darin. Weggeräumt wird nur die Zuordnung —
-- die Karte bleibt im Deck und steht wieder unter "Ohne Kategorie".

-- Dieselbe Prüfung wie zuvor, nur an der neuen Tabelle: Eine Zuordnung darf nur
-- auf eine Kategorie DESSELBEN Decks zeigen. Die Funktion bleibt unverändert —
-- beide Tabellen führen deck_id und category_id, der Rumpf passt auf beide.
create or replace function public.deck_entry_kategorie_passt() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.category_id is not null and not exists (
       select 1 from public.deck_categories k
       where k.id = new.category_id and k.deck_id = new.deck_id) then
    raise exception 'Kategorie % gehört nicht zu Deck %', new.category_id, new.deck_id;
  end if;
  return new;
end $$;

drop trigger if exists deck_entry_categories_kategorie_passt on public.deck_entry_categories;
create trigger deck_entry_categories_kategorie_passt
  before insert or update of category_id, deck_id on public.deck_entry_categories
  for each row execute function public.deck_entry_kategorie_passt();

-- ------------------------------------------------- Row Level Security
alter table public.deck_entry_categories enable row level security;
alter table public.deck_entry_categories force row level security;
revoke all on public.deck_entry_categories from anon;

drop policy if exists "eigene deck-zuordnungen" on public.deck_entry_categories;
create policy "eigene deck-zuordnungen" on public.deck_entry_categories
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists deck_entry_categories_select_shared on public.deck_entry_categories;
create policy deck_entry_categories_select_shared on public.deck_entry_categories for select to authenticated
  using (public.deck_shared(deck_id) and public.are_friends(auth.uid(), user_id));

-- ------------------------------------------------- Umzug der Bestandsdaten
-- Läuft nur, solange die alte Spalte da ist, und ist wiederholbar.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'deck_entries'
                and column_name = 'category_id') then
    insert into public.deck_entry_categories (deck_id, card_id, category_id, user_id, is_primary)
      select deck_id, card_id, category_id, user_id, true
        from public.deck_entries where category_id is not null
      on conflict do nothing;
  end if;
end $$;

drop trigger if exists deck_entries_kategorie_passt on public.deck_entries;
alter table public.deck_entries drop column if exists category_id;

-- ------------------------------------------------- Wunsch einlösen
-- fulfil_wish_in_deck hängt den Deckplatz einer Wunschkarte auf das gekaufte
-- Exemplar um. Die Zuordnungen hängen jetzt am Deckplatz und würden mit ihm
-- verschwinden — gemerkt wird deshalb VOR dem Abziehen, geschrieben NACH dem
-- Gutschreiben (der Fremdschlüssel verlangt den Deckplatz).
create or replace function public.fulfil_wish_in_deck(
  p_deck      uuid,
  p_from_card uuid,
  p_to_card   uuid,
  p_n         integer default 1
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_from public.cards%rowtype;
  v_to   public.cards%rowtype;
  v_have integer;
  v_n    integer;
  v_kats uuid[];
  v_prim uuid;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using hint = 'auth';
  end if;
  if p_from_card = p_to_card then
    raise exception 'Quelle und Ziel sind dieselbe Zeile' using hint = 'same_row';
  end if;

  -- security definer umgeht RLS, deshalb hier jede Zugehörigkeit selbst
  -- prüfen: Deck und BEIDE Kartenzeilen müssen dem Aufrufer gehören.
  perform 1 from public.decks where id = p_deck and user_id = v_uid;
  if not found then
    raise exception 'Deck nicht gefunden' using hint = 'no_deck';
  end if;

  select * into v_from from public.cards where id = p_from_card and user_id = v_uid;
  if not found then
    raise exception 'Wunschkarte nicht gefunden' using hint = 'no_card';
  end if;
  select * into v_to from public.cards where id = p_to_card and user_id = v_uid;
  if not found then
    raise exception 'Zielkarte nicht gefunden' using hint = 'no_card';
  end if;

  -- Nur Auflagen DERSELBEN Karte dürfen getauscht werden, sonst wäre das hier
  -- ein Weg, am 100-Karten-Trigger vorbei beliebig umzubauen.
  if not (
    (v_from.set_code is not null and v_from.cn is not null
       and upper(v_from.set_code) = upper(v_to.set_code) and v_from.cn = v_to.cn)
    or (v_from.oracle_id is not null and v_from.oracle_id = v_to.oracle_id)
    or lower(v_from.name) = lower(v_to.name)
  ) then
    raise exception 'Andere Karte — Umhängen nur zwischen Auflagen derselben Karte'
      using hint = 'not_same_card';
  end if;

  select qty into v_have
    from public.deck_entries
   where deck_id = p_deck and card_id = p_from_card;
  if not found then
    raise exception 'Karte liegt nicht in diesem Deck' using hint = 'no_entry';
  end if;

  select array_agg(category_id), max(category_id) filter (where is_primary)
    into v_kats, v_prim
    from public.deck_entry_categories
   where deck_id = p_deck and card_id = p_from_card;

  v_n := least(greatest(coalesce(p_n, 1), 1), v_have);

  -- Reihenfolge ist nicht beliebig: erst abziehen, dann gutschreiben. So wächst
  -- das Deck zu keinem Zeitpunkt, und der 100-Karten-Trigger sieht beim Insert
  -- bereits den verringerten Rest.
  if v_have = v_n then
    delete from public.deck_entries where deck_id = p_deck and card_id = p_from_card;
  else
    update public.deck_entries set qty = qty - v_n
     where deck_id = p_deck and card_id = p_from_card;
  end if;

  insert into public.deck_entries (deck_id, card_id, user_id, qty)
       values (p_deck, p_to_card, v_uid, v_n)
  on conflict (deck_id, card_id)
    do update set qty = public.deck_entries.qty + excluded.qty;

  -- Lag die gekaufte Auflage schon im Deck und ist selbst eingeordnet, behält
  -- sie ihre eigene Einteilung: Die der Wunschzeile ist der Ersatz, nicht die
  -- Ansage.
  if v_kats is not null and not exists (
       select 1 from public.deck_entry_categories
        where deck_id = p_deck and card_id = p_to_card) then
    insert into public.deck_entry_categories (deck_id, card_id, category_id, user_id, is_primary)
      select p_deck, p_to_card, k, v_uid, (k = v_prim) from unnest(v_kats) as k
      on conflict do nothing;
  end if;

  return v_n;
end $$;
revoke all on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) to authenticated;
