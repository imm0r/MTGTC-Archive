-- =====================================================================
--  Gedruckter (landessprachiger) Regeltext und Typzeile
--  ------------------------------------------------------------------
--  Scryfall führt zu jedem Druck ZWEI Textsätze:
--    • name / type_line / oracle_text        — IMMER englisch, kanonisch
--    • printed_name / printed_type_line /
--      printed_text                          — wie auf der Karte gedruckt,
--                                              nur bei lang <> 'en' vorhanden
--
--  printed_name nutzten wir seit je, die beiden anderen nicht. Ergebnis in
--  der Detailansicht: deutscher Kartenname über englischen Fähigkeiten und
--  einem englischen "Sorcery". Diese Migration legt die fehlenden Spalten an.
--
--  ANZEIGE, NICHT LOGIK. Alle Regel- und Filterprüfungen (Land, legendär,
--  Deck-Kategorie, Commander-Singleton, Suche, Sortierung) lesen weiter
--  type_line/oracle_text — die sind bei jedem Druck englisch und damit
--  sprachunabhängig vergleichbar. Genau deshalb bekommen sie eigene Spalten,
--  statt die bestehenden zu überschreiben.
--
--  NULL heißt "gibt es nicht" (englische Auflage), nicht "noch nicht
--  erfasst" — die App fällt dann auf oracle_text/type_line zurück. '' bleibt
--  ein gültiger Wert (Vanilla-Kreatur ohne Regeltext).
--
--  Bestandskarten füllen sich von selbst: nachtragen() in der App schreibt
--  beide Felder beim nächsten Preisabruf ("Preis neu ziehen" je Karte oder
--  "Preise aktualisieren" für alles). Ein Backfill in SQL ist nicht möglich —
--  die Texte stehen nur bei Scryfall.
--
--  Wiederholbar: add column if not exists / create or replace.
-- =====================================================================

alter table public.cards add column if not exists printed_text text;
alter table public.cards add column if not exists printed_type_line text;

comment on column public.cards.printed_text is
  'Gedruckter Regeltext in der Sprache der Auflage (Scryfall printed_text). '
  'NULL bei englischen Auflagen — dort ist oracle_text das Gedruckte. '
  'Nur Anzeige; Regel- und Filterprüfungen lesen oracle_text.';
comment on column public.cards.printed_type_line is
  'Gedruckte Typzeile in der Sprache der Auflage (Scryfall printed_type_line). '
  'NULL bei englischen Auflagen. Nur Anzeige; geprüft wird type_line.';

-- Die Seiten zweiseitiger Karten (Spalte faces, JSON je Seite) tragen die
-- gedruckte Fassung ab jetzt ebenfalls — sonst bliebe die Rückseite einer
-- deutschen Karte englisch, während die Vorderseite übersetzt ist. Auch das
-- schreibt die App nach (nachtragen() erkennt Seiten ohne den Schlüssel
-- printed_text und holt sie neu). Hier ist nichts zu ändern: faces ist jsonb
-- und braucht kein Schema.

-- ------------------------------------------------------------------
-- Geteiltes Freund-Deck übernehmen: die beiden neuen Felder mitkopieren.
-- Ohne das stünden übernommene Karten bis zum nächsten Preisabruf auf
-- Englisch, obwohl der Text in der Quellzeile längst da ist.
-- (Unverändert gegenüber dem Original bis auf die Spaltenliste im INSERT.)
-- ------------------------------------------------------------------
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
        keywords, oracle_text, printed_text, printed_type_line,
        lang, condition, foil, qty, price)
      values (me, e.scryfall_id, e.oracle_id, e.name, e.printed_name, e.set_code,
        e.set_name, e.cn, e.img, e.cm_id, e.type_line, e.rarity, e.mana_cost, e.cmc, e.released, e.colors,
        e.keywords, e.oracle_text, e.printed_text, e.printed_type_line,
        e.lang, e.condition, e.foil, 0, e.price)
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
