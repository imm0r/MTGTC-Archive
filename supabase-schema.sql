-- =====================================================================
--  Arcanum Archive — Datenbankschema
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
  -- Farben der Karte (Scryfalls colors), Grundlage der Farbverteilung im
  -- Dashboard. Gespeichert und NICHT aus mana_cost abgeleitet: von 598
  -- Auflagen im Bestand wären 8 falsch gewesen. Devoid („Corrupted
  -- Shapeshifter") kostet {3}{U} und ist farblos; Tokens haben Farben, aber
  -- gar keine Manakosten (alle wären fälschlich farblos gewesen); bei
  -- Abenteuern zählt nur die Kreatur. Die Farbe folgt nicht aus den Kosten.
  -- {} heißt farblos (eine Aussage), NULL heißt „noch nicht erfasst".
  colors      text[],
  -- Schlüsselwörter (Scryfalls keywords: Fliegend, Bedrohlich …) und der volle
  -- Regeltext. Beides ist, was Scryfall VERBÜRGT — ein strukturiertes
  -- „Fähigkeit = Name/Typ/Kosten" gibt es dort nicht; diese Aufteilung
  -- berechnet die App beim Anzeigen aus oracle_text. keywords: {} = keine
  -- (gültig), NULL = unerfasst. oracle_text: '' gültig (Vanilla), NULL Lücke.
  keywords    text[],
  oracle_text text,
  lang        text not null default 'en',
  condition   text not null default 'NM',
  foil        boolean not null default false,
  -- qty 0 ist erlaubt und bedeutet „im Deck, aber nicht besessen" (aus einem
  -- Deck-Import, siehe import_shared_deck). Die Sammlungsansicht blendet solche
  -- Zeilen aus (Filter qty > 0), im Deck erscheinen sie als „fehlen".
  qty         integer not null default 1 check (qty >= 0),
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
  -- Klassifizierung aus festem Vokabular (die Listen stehen in app.js): format
  -- etwa Commander/Modern, archetype etwa Aggro/Control. Beides darf leer sein
  -- (NULL = nicht eingeordnet). Bewusst text und kein enum — das Vokabular
  -- wächst in der App, ohne dass die Datenbank mitwandern muss.
  format    text,
  archetype text,
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
alter table public.decks add column if not exists format text;
alter table public.decks add column if not exists archetype text;
alter table public.cards add column if not exists type_line text;
alter table public.cards add column if not exists rarity text;
alter table public.cards add column if not exists mana_cost text;
alter table public.cards add column if not exists cmc numeric;
alter table public.cards add column if not exists released date;
alter table public.cards add column if not exists colors text[];
alter table public.cards add column if not exists keywords text[];
alter table public.cards add column if not exists oracle_text text;

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
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text, text, text, numeric, date);
drop function if exists public.add_card(
  text, text, text, text, text, text, text, text, integer, text, text, boolean, numeric, text, text, text, numeric, date, text[]);

create or replace function public.add_card(
  p_scryfall_id text, p_oracle_id text, p_name text, p_printed_name text,
  p_set_code text, p_set_name text, p_cn text, p_img text, p_cm_id integer,
  p_lang text, p_condition text, p_foil boolean, p_price numeric,
  p_type_line text default null, p_rarity text default null,
  p_mana_cost text default null, p_cmc numeric default null,
  p_released date default null, p_colors text[] default null,
  p_keywords text[] default null, p_oracle_text text default null
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
     mana_cost, cmc, released, colors, keywords, oracle_text)
  values
    (p_scryfall_id, p_oracle_id, p_name, p_printed_name, p_set_code, p_set_name,
     p_cn, p_img, p_cm_id, p_lang, p_condition, p_foil, 1, p_price,
     case when p_price is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
                 'd', to_char(current_date, 'YYYY-MM-DD'), 'v', p_price)) end,
     p_type_line, p_rarity, p_mana_cost, p_cmc, p_released, p_colors,
     p_keywords, p_oracle_text)
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
        released  = coalesce(excluded.released, c.released),
        colors    = coalesce(excluded.colors, c.colors),
        keywords  = coalesce(excluded.keywords, c.keywords),
        oracle_text = coalesce(excluded.oracle_text, c.oracle_text)
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

-- =====================================================================
--  Profil je Konto: Anzeigename und Avatar. Ein Datensatz pro Nutzer
--  (id = auth.uid), angelegt beim ersten Anmelden aus der App heraus.
--
--  avatar_url hält das Avatarbild als Data-URI (256px-JPEG, ~20-30 KB) DIREKT
--  in der Spalte — bewusst NICHT über Supabase Storage: mit dem publishable-Key
--  (sb_…) kam der Storage-Upload unauthentifiziert an (auth.uid() null → RLS
--  lehnte ab), während der Weg über diese Tabelle dieselbe funktionierende
--  Anmeldung nutzt wie der Rest der App.
-- =====================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  -- Karten je Sammlungsseite (Profil-Einstellung). NULL = Voreinstellung (50),
  -- 0 = alles auf einer Seite.
  page_size    integer,
  created      timestamptz not null default now()
);

-- Für Bestände, die vor dieser Spalte angelegt wurden:
alter table public.profiles add column if not exists page_size integer;
alter table public.profiles drop constraint if exists profiles_page_size_check;
alter table public.profiles add constraint profiles_page_size_check
  check (page_size is null or (page_size >= 0 and page_size <= 1000));

alter table public.profiles enable row level security;

-- Jeder sieht und ändert ausschließlich sein eigenes Profil.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- =====================================================================
--  Freunde und Deck-Teilen
--
--  Befreunden über kurze Freundescodes (beidseitige Zustimmung). Freunde
--  sehen GETEILTE Decks nur lesend — NICHT die ganze Sammlung, nur die Karten
--  in geteilten Decks. Umgesetzt über zusätzliche SELECT-Policies (ODER-
--  verknüpft mit den "eigene …"-Policies) und SECURITY-DEFINER-Helfer, damit
--  die Cross-User-Prüfung nicht an der RLS der geprüften Tabelle scheitert.
-- =====================================================================

-- Freundescode je Profil (global eindeutig, ohne 0/O/1/I).
alter table public.profiles add column if not exists friend_code text unique;

create or replace function public.gen_friend_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end $$;

create or replace function public.set_friend_code() returns trigger
language plpgsql as $$
begin
  if new.friend_code is null then new.friend_code := public.gen_friend_code(); end if;
  return new;
end $$;

drop trigger if exists profiles_friend_code on public.profiles;
create trigger profiles_friend_code before insert on public.profiles
  for each row execute function public.set_friend_code();

do $$
declare r record;
begin
  for r in select id from public.profiles where friend_code is null loop
    update public.profiles set friend_code = public.gen_friend_code() where id = r.id;
  end loop;
end $$;

-- Freundschaften: eine Zeile je Beziehung, pending -> accepted.
create table if not exists public.friendships (
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status    text not null default 'pending' check (status in ('pending','accepted')),
  created   timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
alter table public.friendships force row level security;
revoke all on public.friendships from anon;

drop policy if exists friendships_select on public.friendships;
drop policy if exists friendships_insert on public.friendships;
drop policy if exists friendships_update on public.friendships;
drop policy if exists friendships_delete on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);
create policy friendships_insert on public.friendships for insert to authenticated
  with check (auth.uid() = requester and status = 'pending');
create policy friendships_update on public.friendships for update to authenticated
  using (auth.uid() = addressee) with check (auth.uid() = addressee and status = 'accepted');
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

-- Deck-Freigabe.
alter table public.decks add column if not exists shared boolean not null default false;

-- Helfer (nur lesend, SECURITY DEFINER gegen RLS-Rekursion).
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;
create or replace function public.has_friend_link(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
    where (requester = auth.uid() and addressee = other)
       or (addressee = auth.uid() and requester = other));
$$;
create or replace function public.deck_shared(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select shared from public.decks where id = d), false);
$$;
create or replace function public.card_in_shared_deck(c uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.deck_entries de
    join public.decks d on d.id = de.deck_id
    where de.card_id = c and d.shared and public.are_friends(viewer, d.user_id));
$$;

-- Zusätzliche SELECT-Policies: Freunde lesen mit (eigene Zeilen deckt jeweils
-- die bestehende "eigene …"-Policy ab).
drop policy if exists profiles_select_friends on public.profiles;
create policy profiles_select_friends on public.profiles for select to authenticated
  using (public.has_friend_link(id));
drop policy if exists decks_select_shared on public.decks;
create policy decks_select_shared on public.decks for select to authenticated
  using (shared and public.are_friends(auth.uid(), user_id));
drop policy if exists deck_entries_select_shared on public.deck_entries;
create policy deck_entries_select_shared on public.deck_entries for select to authenticated
  using (public.deck_shared(deck_id) and public.are_friends(auth.uid(), user_id));
drop policy if exists cards_select_shared on public.cards;
create policy cards_select_shared on public.cards for select to authenticated
  using (public.card_in_shared_deck(id, auth.uid()));

-- Anfrage per Code: nachschlagen, Selbst-/Doppelanfrage abfangen, Gegenanfrage
-- automatisch annehmen, sonst pending anlegen. requester ist immer auth.uid().
create or replace function public.send_friend_request(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid;
begin
  if me is null then return 'unauth'; end if;
  select id into target from public.profiles where friend_code = upper(trim(p_code));
  if target is null then return 'notfound'; end if;
  if target = me then return 'self'; end if;
  if exists (select 1 from public.friendships where status='accepted'
      and ((requester=me and addressee=target) or (requester=target and addressee=me)))
    then return 'already'; end if;
  if exists (select 1 from public.friendships where requester=target and addressee=me and status='pending') then
    update public.friendships set status='accepted' where requester=target and addressee=me;
    return 'accepted';
  end if;
  if exists (select 1 from public.friendships where requester=me and addressee=target and status='pending') then
    return 'pending';
  end if;
  insert into public.friendships(requester, addressee, status) values (me, target, 'pending');
  return 'sent';
end $$;
revoke execute on function public.send_friend_request(text) from anon;

-- Bestehende DB: qty-Check von "> 0" auf ">= 0" lockern (siehe cards.qty).
alter table public.cards drop constraint if exists cards_qty_check;
alter table public.cards add constraint cards_qty_check check (qty >= 0);

-- Ein geteiltes Freund-Deck als neues, privates Deck übernehmen — NUR das Deck.
-- Fehlende Karten kommen als Bestand-0-Zeilen (im Deck „fehlen", nicht in der
-- Sammlung). Prüft geteilt + befreundet; schreibt nur eigene Zeilen.
-- Für „besitze ich die Karte?" zählt die AUFLAGE (Set + Nummer): Sprache, Foil
-- und Zustand sind für den Bestand egal. Über set_code + cn statt scryfall_id,
-- weil verschiedene Sprachfassungen derselben Auflage eigene IDs tragen.
create or replace function public.import_shared_deck(p_deck uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  src public.decks%rowtype;
  fname text; newid uuid; e record; mycard uuid; mymain uuid;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  select * into src from public.decks where id = p_deck;
  if not found then raise exception 'Deck nicht gefunden'; end if;
  if not (src.shared and public.are_friends(me, src.user_id)) then
    raise exception 'Kein Zugriff auf dieses Deck';
  end if;
  select display_name into fname from public.profiles where id = src.user_id;

  insert into public.decks (user_id, name, format, archetype, shared)
    values (me, left(src.name || ' (von ' || coalesce(fname, 'Freund') || ')', 120),
            src.format, src.archetype, false)
    returning id into newid;

  for e in
    select de.qty as deck_qty, c.*
    from public.deck_entries de join public.cards c on c.id = de.card_id
    where de.deck_id = p_deck
  loop
    -- 1. exakt dieselbe Ausführung; 2. dieselbe Auflage in beliebiger
    -- Ausführung — besessene mit größtem Bestand zuerst, notfalls ein
    -- vorhandener Bestand-0-Platzhalter (statt einen zweiten anzulegen).
    select id into mycard from public.cards
      where user_id = me and scryfall_id = e.scryfall_id and foil = e.foil
        and lang = e.lang and condition = e.condition;
    if mycard is null and e.set_code is not null and e.cn is not null then
      select id into mycard from public.cards
        where user_id = me
          and upper(set_code) = upper(e.set_code) and cn = e.cn
        order by (qty > 0) desc, qty desc
        limit 1;
    end if;
    if mycard is null then
      insert into public.cards (user_id, scryfall_id, oracle_id, name, printed_name, set_code,
        set_name, cn, img, cm_id, type_line, rarity, mana_cost, cmc, released, colors,
        keywords, oracle_text, lang, condition, foil, qty, price)
      values (me, e.scryfall_id, e.oracle_id, e.name, e.printed_name, e.set_code,
        e.set_name, e.cn, e.img, e.cm_id, e.type_line, e.rarity, e.mana_cost, e.cmc, e.released, e.colors,
        e.keywords, e.oracle_text, e.lang, e.condition, e.foil, 0, e.price)
      returning id into mycard;
    end if;
    if e.id = src.main_card_id then mymain := mycard; end if;
    insert into public.deck_entries (deck_id, card_id, user_id, qty)
      values (newid, mycard, me, e.deck_qty)
      on conflict (deck_id, card_id) do update set qty = excluded.qty;
  end loop;

  if mymain is not null then update public.decks set main_card_id = mymain where id = newid; end if;
  return newid;
end $$;
revoke execute on function public.import_shared_deck(uuid) from anon;

-- ---------------- Wunschkarte aus einem Synergie-Vorschlag ins Deck ------
-- Eine (Scryfall-)Vorschlagskarte einem Deck hinzufügen. Zuerst die eigene
-- Karte verknüpfen — exakte Auflage über scryfall_id, sonst dieselbe Karte über
-- oracle_id (besessene zuerst) —, damit keine Dublette entsteht, wenn man die
-- Karte schon in anderer Auflage hat. Fehlt sie ganz, wird sie mit BESTAND 0
-- angelegt (qty 0 = „im Deck, aber nicht besessen"). Danach Deck-Eintrag (+1).
create or replace function public.add_wish_to_deck(
  p_deck uuid,
  p_scryfall_id text, p_oracle_id text, p_name text, p_printed_name text,
  p_set_code text, p_set_name text, p_cn text, p_img text,
  p_lang text, p_price numeric,
  p_type_line text default null, p_rarity text default null,
  p_mana_cost text default null, p_cmc numeric default null,
  p_released date default null, p_colors text[] default null,
  p_keywords text[] default null, p_oracle_text text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mycard uuid;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  if not exists (select 1 from public.decks where id = p_deck and user_id = me) then
    raise exception 'Deck nicht gefunden';
  end if;

  select id into mycard from public.cards
   where user_id = me and scryfall_id = p_scryfall_id
   limit 1;
  if mycard is null and p_oracle_id is not null then
    select id into mycard from public.cards
     where user_id = me and oracle_id = p_oracle_id
     order by (qty > 0) desc, qty desc
     limit 1;
  end if;
  if mycard is null then
    insert into public.cards (user_id, scryfall_id, oracle_id, name, printed_name,
      set_code, set_name, cn, img, cm_id, lang, condition, foil, qty, price, hist,
      type_line, rarity, mana_cost, cmc, released, colors, keywords, oracle_text)
    values (me, p_scryfall_id, p_oracle_id, p_name, p_printed_name,
      p_set_code, p_set_name, p_cn, p_img, null, coalesce(p_lang,'en'), 'NM', false, 0, p_price,
      case when p_price is null then '[]'::jsonb
           else jsonb_build_array(jsonb_build_object('d', to_char(current_date,'YYYY-MM-DD'), 'v', p_price)) end,
      p_type_line, p_rarity, p_mana_cost, p_cmc, p_released, p_colors, p_keywords, p_oracle_text)
    returning id into mycard;
  end if;

  insert into public.deck_entries (deck_id, card_id, user_id, qty)
    values (p_deck, mycard, me, 1)
    on conflict (deck_id, card_id) do update set qty = public.deck_entries.qty + 1;

  return mycard;
end $$;
revoke execute on function public.add_wish_to_deck(
  uuid, text, text, text, text, text, text, text, text, text, numeric,
  text, text, text, numeric, date, text[], text[], text) from anon;

-- ---------------- Admin + globale Feature-Schalter --------------------
-- Nur Benjamin (m0nsum@hotmail.com) ist Admin — die user_id ist HART
-- hinterlegt, damit sich kein Nutzer über ein beschreibbares Feld selbst
-- befördern kann. security definer, damit die Prüfung unabhängig von RLS greift.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select auth.uid() = 'db4f0a25-1b8d-468d-8654-16f2339572d8'::uuid $$;
revoke execute on function public.is_admin() from anon;

-- Globale Feature-Schalter: eine Zeile je Funktion, gilt für ALLE Nutzer.
-- Alle Angemeldeten dürfen LESEN (um zu wissen, was aktiv ist); NUR der Admin
-- schreibt. Die echte Durchsetzung teurer Funktionen (KI) sitzt ZUSÄTZLICH in
-- der Edge Function card-synergy, nicht nur in der Sichtbarkeit im Client.
create table if not exists public.feature_flags (
  key     text primary key,
  enabled boolean not null default false
);
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from anon;

drop policy if exists "flags lesbar" on public.feature_flags;
create policy "flags lesbar" on public.feature_flags
  for select to authenticated using (true);

drop policy if exists "flags nur admin" on public.feature_flags;
create policy "flags nur admin" on public.feature_flags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.feature_flags (key, enabled) values ('ki_synergy', true)
  on conflict (key) do nothing;
