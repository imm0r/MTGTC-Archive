-- =====================================================================
--  Singleton-Regel für Commander-Decks
--
--  Bis auf Standardländer darf ein Commander-Deck von jeder Karte nur ein
--  Exemplar enthalten — maßgeblich ist der englische KARTENNAME, nicht die
--  Auflage. Zwei Drucke derselben Karte sind zwei Zeilen in der Sammlung und
--  zwei Einträge im Deck, aber trotzdem zwei Kopien derselben Karte. Genau so
--  sind die Verstöße im Bestand entstanden (Sol Ring, Abundance).
--
--  Ausnahmen, die die Karten selbst aussprechen:
--    „A deck can have any number of cards named …“  (Relentless Rats,
--    Shadowborn Apostle, Rat Colony, Persistent Petitioners, Dragon's Approach)
--    „A deck can have up to seven/nine cards named …“ (Seven Dwarves, Nazgûl)
--  Scryfall liefert type_line und oracle_text auch bei fremdsprachigen Drucken
--  auf Englisch (die Landessprache steht in printed_*), die Erkennung ist also
--  sprachunabhängig verlässlich.
--
--  Wie bei der 100-Karten-Grenze sitzt die Durchsetzung in der Datenbank, weil
--  mehrere Wege ins Deck schreiben. Bestehende Verstöße bleiben unangetastet:
--  geprüft wird nur, was die Zahl ERHÖHT.
-- =====================================================================

create or replace function public.commander_max_copies(p_card uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when c.type_line ~* 'basic.*land' then 2147483647
    when c.oracle_text ~* 'a deck can have any number of cards named' then 2147483647
    when c.oracle_text ~* 'a deck can have up to (one|two|three|four|five|six|seven|eight|nine|ten) cards named'
      then case lower((regexp_match(c.oracle_text,
             'a deck can have up to (one|two|three|four|five|six|seven|eight|nine|ten) cards named', 'i'))[1])
             when 'one' then 1 when 'two'   then 2 when 'three' then 3 when 'four' then 4
             when 'five' then 5 when 'six'  then 6 when 'seven' then 7 when 'eight' then 8
             when 'nine' then 9 when 'ten'  then 10 else 1 end
    else 1
  end
  from public.cards c
 where c.id = p_card;
$$;

create or replace function public.enforce_commander_singleton()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format text;
  v_max    integer;
  v_name   text;
  v_andere integer;
begin
  select format into v_format from public.decks where id = new.deck_id;
  if coalesce(v_format, '') <> 'Commander' then return new; end if;

  -- Nur Erhöhungen prüfen. Wer abbaut, soll das auch in einem Deck können,
  -- das die Regel längst verletzt.
  if tg_op = 'UPDATE' and new.card_id = old.card_id and new.qty <= old.qty then
    return new;
  end if;

  v_max := public.commander_max_copies(new.card_id);
  if v_max >= 2147483647 then return new; end if;

  select name into v_name from public.cards where id = new.card_id;
  if v_name is null then return new; end if;

  -- Über den NAMEN zählen, nicht über card_id: andere Auflagen derselben Karte
  -- liegen als eigene Einträge im Deck und zählen trotzdem mit.
  select coalesce(sum(e.qty), 0) into v_andere
    from public.deck_entries e
    join public.cards c2 on c2.id = e.card_id
   where e.deck_id = new.deck_id
     and e.card_id <> new.card_id
     and lower(c2.name) = lower(v_name);

  if v_andere + new.qty > v_max then
    raise exception 'Singleton: % darf im Commander-Deck hoechstens %x vorkommen (waeren %)',
      v_name, v_max, v_andere + new.qty
      using hint = 'deck_singleton';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commander_singleton on public.deck_entries;
create trigger trg_commander_singleton
  before insert or update on public.deck_entries
  for each row execute function public.enforce_commander_singleton();
