-- =====================================================================
--  Tauschen: eine Karte aus dem Deck nehmen und den Vorschlag aufnehmen.
--
--  Die Synergie-Kachel sagt bei einem vollen Deck schon länger, welche Karte
--  dafür weichen könnte („dafür raus: X"). Ausführen musste man es von Hand:
--  Deck aufklappen, X suchen, herauswerfen, zurück zu den Vorschlägen, „+".
--  Diese Funktion ist der eine Handgriff dazu.
--
--  WARUM IN DER DATENBANK. Aus dem Browser wären es zwei Aufrufe, und beide
--  Reihenfolgen sind falsch:
--
--    erst aufnehmen  → das Deck hätte 101 Karten, der 100-Karten-Trigger
--                      (enforce_commander_deck_size) sagt ab, und getauscht
--                      wurde nichts.
--    erst herausnehmen → bricht der zweite Aufruf ab (Netz weg, Tab zu,
--                      Singleton-Trigger), fehlt die alte Karte und die neue
--                      ist nicht da. Das Deck hat 99 Karten, und niemand hat
--                      es gesagt.
--
--  Zusammen in einer Transaktion gibt es beides nicht: Das Deck ist vorher
--  und nachher gleich groß, und schlägt irgendetwas fehl, bleibt alles so,
--  wie es war. Dieselbe Überlegung wie bei fulfil_wish_in_deck.
--
--  DAS AUFNEHMEN MACHT add_wish_to_deck, unverändert: eigene Auflage
--  verknüpfen, sonst dieselbe Karte über die oracle_id, sonst mit Bestand 0
--  anlegen (das ist der Weg „bei Bedarf über die Wunschliste"). Diese Funktion
--  hier ist nur das Herausnehmen davor — abgeschrieben wird nichts.
-- =====================================================================

create or replace function public.swap_in_deck(
  p_deck uuid, p_cut_card uuid,
  p_scryfall_id text, p_oracle_id text, p_name text, p_printed_name text,
  p_set_code text, p_set_name text, p_cn text, p_img text,
  p_lang text, p_price numeric,
  p_type_line text default null, p_rarity text default null,
  p_mana_cost text default null, p_cmc numeric default null,
  p_released date default null, p_colors text[] default null,
  p_keywords text[] default null, p_oracle_text text default null
) returns uuid
language plpgsql
-- security invoker, genau wie add_wish_to_deck: Die RLS der eigenen Zeilen
-- gilt weiter, und es gibt hier nichts zu tun, wofür sie im Weg wäre.
security invoker
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  d      public.decks%rowtype;
  vorrat integer;
  neu    uuid;
begin
  if me is null then
    raise exception 'Nicht angemeldet' using hint = 'auth';
  end if;

  select * into d from public.decks where id = p_deck and user_id = me;
  if not found then
    raise exception 'Deck nicht gefunden' using hint = 'no_deck';
  end if;

  -- Der Commander bleibt liegen. decks.main_card_id zeigt auf einen ganz
  -- normalen Deck-Eintrag; nähme man den heraus, zeigte das Deck auf einen
  -- Commander, der nicht mehr darin steckt. Die Oberfläche schlägt ihn
  -- ohnehin nie vor (deckSchnittKandidat lässt beide aus) — das hier ist die
  -- Stelle, an der es auch für einen direkten API-Aufruf gilt.
  -- NULL-Vergleiche ergeben NULL und lösen das if nicht aus; ein Deck ohne
  -- Commander läuft also durch.
  if p_cut_card = d.main_card_id or p_cut_card = d.second_card_id then
    raise exception 'Der Commander bleibt im Deck' using hint = 'cut_commander';
  end if;

  select qty into vorrat
    from public.deck_entries
   where deck_id = p_deck and card_id = p_cut_card;
  if not found then
    raise exception 'Karte liegt nicht in diesem Deck' using hint = 'no_entry';
  end if;

  -- ERST abziehen, dann aufnehmen. So wächst das Deck zu keinem Zeitpunkt,
  -- und der 100-Karten-Trigger sieht beim Aufnehmen den freien Platz bereits.
  -- Abgezogen wird EIN Exemplar, nicht der ganze Eintrag: Im Commander ist
  -- das dasselbe (Singleton), in anderen Formaten wäre das Wegräumen von vier
  -- Kopien für einen Vorschlag nicht das, was „tauschen" heißt.
  if vorrat <= 1 then
    delete from public.deck_entries where deck_id = p_deck and card_id = p_cut_card;
  else
    update public.deck_entries set qty = qty - 1
     where deck_id = p_deck and card_id = p_cut_card;
  end if;

  neu := public.add_wish_to_deck(
    p_deck, p_scryfall_id, p_oracle_id, p_name, p_printed_name,
    p_set_code, p_set_name, p_cn, p_img, p_lang, p_price,
    p_type_line, p_rarity, p_mana_cost, p_cmc, p_released,
    p_colors, p_keywords, p_oracle_text);

  -- Beide Seiten sind dieselbe Sammlungszeile: Dann hat add_wish_to_deck den
  -- Eintrag, den wir gerade abgezogen haben, wieder gutgeschrieben — ein
  -- Tausch, der nichts tauscht. Welche Zeile es wird, entscheidet sich erst
  -- dort (scryfall_id, sonst oracle_id), deshalb steht die Prüfung hier
  -- hinten. Die Ausnahme rollt beides zurück.
  if neu = p_cut_card then
    raise exception 'Herausgenommene und aufgenommene Karte sind dieselbe Zeile'
      using hint = 'same_row';
  end if;

  return neu;
end $$;

revoke all on function public.swap_in_deck(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric,
  text, text, text, numeric, date, text[], text[], text) from public, anon;
grant execute on function public.swap_in_deck(
  uuid, uuid, text, text, text, text, text, text, text, text, text, numeric,
  text, text, text, numeric, date, text[], text[], text) to authenticated;
