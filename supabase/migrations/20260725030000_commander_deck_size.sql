-- =====================================================================
-- Commander-Decks auf 100 Karten begrenzen.
--
-- Die offiziellen Regeln erlauben genau 100 Karten einschließlich des
-- Commanders. Der Commander ist hier kein Sonderfall: decks.main_card_id
-- markiert nur eine Karte, die ohnehin als deck_entry im Deck liegt. Die
-- Summe über qty ist also bereits die Zahl, um die es geht.
--
-- Die Regel sitzt am Trigger und nicht in der Oberfläche, weil VIER Wege
-- ins Deck schreiben: aus der Sammlung (deck_entries.upsert), aus den
-- Vorschlägen (add_wish_to_deck), die Mengenänderung in der Deck-Tabelle
-- und der Import. Vier Prüfungen im Client wären vier Stellen zum
-- Vergessen — und keine davon hielte jemanden auf, der direkt gegen die
-- API schreibt. Die Oberfläche warnt vorher, die Datenbank entscheidet.
--
-- Nur VERGRÖSSERN wird abgewiesen. Bestehende Decks über 100 (die gab es,
-- bevor es diese Regel gab) lassen sich weiter bearbeiten, solange sie
-- dabei kleiner werden — sonst wären sie eingefroren.
--
-- Erkennungszeichen für den Client ist der hint 'deck_full'; die Meldung
-- selbst formuliert die Oberfläche in der Sprache des Nutzers.
-- =====================================================================

create or replace function public.enforce_commander_deck_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_format text;
  v_alt    integer := 0;
  v_andere integer;
begin
  select format into v_format from public.decks where id = new.deck_id;
  if coalesce(v_format, '') <> 'Commander' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_alt := old.qty;
  end if;

  -- Gleich bleiben oder schrumpfen ist immer erlaubt.
  if new.qty <= v_alt then
    return new;
  end if;

  select coalesce(sum(qty), 0) into v_andere
    from public.deck_entries
   where deck_id = new.deck_id and card_id <> new.card_id;

  if v_andere + new.qty > 100 then
    raise exception 'Commander-Deck ist voll: % von 100', v_andere + v_alt
      using hint = 'deck_full';
  end if;

  return new;
end;
$$;

drop trigger if exists deck_entries_commander_size on public.deck_entries;
create trigger deck_entries_commander_size
before insert or update of qty on public.deck_entries
for each row execute function public.enforce_commander_deck_size();
