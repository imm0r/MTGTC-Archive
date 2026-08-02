-- Die Matte eines Mitspielers ansehen — aber NICHT dessen Hand und Bibliothek.
--
-- session_played ist privat (Policy played_own: user_id = auth.uid()). Das ist
-- richtig so und bleibt: Die Zeilen enthalten die HAND, und die geht niemanden
-- etwas an. Was am Tisch dagegen offen liegt — Schlachtfeld, Friedhof, Exil,
-- Kommandozone —, ist öffentliche Information, die man nur deshalb nicht sehen
-- konnte, weil sie in derselben Zeile steht.
--
-- Diese Funktion trennt beides an der Quelle, nicht in der Anzeige:
--
--   * hand steht in KEINER Rückgabespalte. Nicht ausgeblendet, nicht auf null
--     gesetzt — nicht ausgewählt. Was nicht abgefragt wird, kann kein Client
--     aus der Antwort ziehen.
--   * Zeilen, in denen NUR hand steht, fallen ganz heraus. Sonst verriete
--     allein ihre Anzahl, wie viele verschiedene Karten jemand auf der Hand
--     hält.
--   * Die BIBLIOTHEK steht nirgends in dieser Tabelle: Sie ist der Rest aus
--     der Deckmenge (Deckmenge − hand − field − graveyard − exile). Berechnen
--     ließe sie sich also nur mit der Deckliste — und die gibt diese Funktion
--     nicht heraus. Deshalb bleibt cmd_qty für alle Karten leer AUSSER den
--     Commandern (siehe unten): eine einzige mitgelieferte Deckmenge wäre eine
--     Karte, deren Bibliotheksanteil ein Mitspieler ausrechnen könnte.
--
-- DIE KOMMANDOZONE ist der einzige Rest, der mitkommt, und sie muss es: Sie
-- liegt am Tisch offen, und wer dort steht, kann nicht aus den vier Zonen
-- gefolgert werden — eine Karte, die nirgends liegt, ist entweder in der
-- Bibliothek oder in der Kommandozone. Für die beiden Commander-Karten des
-- Decks (main_card_id, second_card_id) kommt deshalb die Deckmenge als
-- cmd_qty mit; daraus rechnet die App
--
--     Kommandozone = cmd_qty − field − graveyard − exile
--
-- und weiß damit über den Rest des Decks weiterhin nichts. Diese beiden Karten
-- sind ohnehin schon öffentlich: session_roster liefert Name und Bild des
-- Commanders seit jeher an alle Mitspieler.
--
-- SECURITY DEFINER mit in_session(): Mitspieler müssen nicht befreundet sein,
-- dürfen sich in der Runde aber sehen — dieselbe Begründung wie bei
-- session_roster. Wer nicht in der Partie sitzt, bekommt null Zeilen.
--
-- Das DROP davor ist Pflicht: CREATE OR REPLACE kann den Rückgabetyp nicht
-- ändern, und dieses Skript soll jederzeit wiederholbar sein.
drop function if exists public.session_board(uuid, uuid);
create function public.session_board(p_session uuid, p_user uuid)
returns table(card_id uuid, field integer, graveyard integer, exile integer,
              cast_count integer, field_state jsonb,
              name text, printed_name text, lang text, img text, type_line text,
              is_cmd boolean, cmd_qty integer)
language sql stable security definer set search_path = public as $$
  with sichtbar as (
    -- Nur wenn der Aufrufer selbst in der Partie sitzt UND der Gefragte
    -- ebenfalls (und nicht gegangen ist).
    select pl.deck_id
      from public.session_players pl
     where pl.session_id = p_session and pl.user_id = p_user and pl.status <> 'left'
       and public.in_session(p_session)
  ),
  cmds as (
    select unnest(array_remove(array[d.main_card_id, d.second_card_id], null)) as card_id,
           d.id as deck_id
      from public.decks d join sichtbar s on s.deck_id = d.id
     where d.user_id = p_user
  ),
  offen as (
    select sp.card_id, sp.field, sp.graveyard, sp.exile, sp.cast_count, sp.field_state
      from public.session_played sp
     where sp.session_id = p_session and sp.user_id = p_user
       and exists (select 1 from sichtbar)
       -- hand steht bewusst NICHT in dieser Bedingung: eine Karte, die allein
       -- auf der Hand liegt, taucht hier gar nicht erst auf.
       and (sp.field > 0 or sp.graveyard > 0 or sp.exile > 0 or sp.cast_count > 0)
  ),
  alle as (
    select card_id from offen
    union
    select card_id from cmds
  )
  select a.card_id,
         coalesce(o.field, 0), coalesce(o.graveyard, 0), coalesce(o.exile, 0),
         coalesce(o.cast_count, 0), coalesce(o.field_state, '[]'::jsonb),
         c.name, c.printed_name, c.lang, c.img, c.type_line,
         (cm.card_id is not null),
         case when cm.card_id is not null then coalesce(de.qty, 1) end
    from alle a
    join public.cards c on c.id = a.card_id
    left join offen o on o.card_id = a.card_id
    left join cmds  cm on cm.card_id = a.card_id
    left join public.deck_entries de on de.deck_id = cm.deck_id and de.card_id = a.card_id
   order by c.name;
$$;
revoke execute on function public.session_board(uuid, uuid) from anon;
