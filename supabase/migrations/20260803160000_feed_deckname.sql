-- =====================================================================
-- „Deck geteilt" im Live-Feed: MIT NAMEN und anklickbar.
--
-- Bisher nannte die Zeile nur die Person und das Ereignis. Der Kopf von
-- 20260803010000_deck_geteilt_feed.sql führt dafür zwei Gründe an, und der
-- zweite ist der ernste:
--
--   1. Datensparsamkeit — „Private card, deck and event details never enter
--      this table" (Sprint 1).
--   2. Ein Deck kann später wieder privat gestellt werden; sein Name stünde
--      dann noch im Feed.
--
-- Beide bleiben gewahrt, indem NICHT der Name gespeichert wird, sondern die
-- DECK-ID — und der Name erst beim Lesen dazugeholt wird, aus `decks` und nur
-- solange `is_public` gilt:
--
--   * Grund 1: Eine Kennung auf etwas, das öffentlich ist, ist kein privates
--     Detail. Der Deckname landet nie in community_activity.
--   * Grund 2: Wird das Deck wieder privat, findet der Verbund nichts mehr —
--     die Zeile fällt von selbst auf den bisherigen, namenlosen Satz zurück.
--     Ein gespeicherter Name täte das nicht.
--
-- Nebenbei stimmt der Name dadurch immer: Wird das Deck umbenannt, zeigt der
-- Feed den neuen.
--
-- Bestehende Zeilen tragen keine deck_id und bleiben beim alten Satz. Das ist
-- richtig so — nachträglich lässt sich nicht feststellen, WELCHES Deck damals
-- geteilt wurde.
-- =====================================================================

-- ---- Der Trigger: die Kennung mitschreiben ---------------------------
-- Nur bei 'deck_public'. Ein privat angelegtes Deck ('deck_created') bekommt
-- KEINE Kennung mit: Sie wäre ein Griff auf etwas, das niemand sehen darf.
--
-- Die Sichtbarkeitsstufe der Person entscheidet weiterhin allein
-- record_community_activity — hier wird nichts davon wiederholt. Wer „privat"
-- gewählt hat, erzeugt gar keine Zeile, und dann auch keine Kennung.
create or replace function public.log_deck_created_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Genau eine Zeile, und zwar die zutreffende (siehe 20260803010000).
    if new.is_public then
      perform public.record_community_activity(new.user_id, 'deck_public',
        jsonb_build_object('deck_id', new.id));
    else
      perform public.record_community_activity(new.user_id, 'deck_created');
    end if;
  elsif coalesce(old.is_public, false) = false and new.is_public then
    perform public.record_community_activity(new.user_id, 'deck_public',
      jsonb_build_object('deck_id', new.id));
  end if;
  return new;
end;
$$;

-- ---- Der Feed: Namen dazuholen, solange das Deck öffentlich ist -------
-- Zwei zusätzliche Spalten ändern den Rückgabetyp; „create or replace" lässt
-- den nicht anfassen — erst weg, dann neu. Innerhalb der
-- Migrationstransaktion entsteht dabei keine Lücke.
--
-- `d.is_public` steht in der VERBUNDBEDINGUNG und nicht in einer
-- where-Klausel: Sonst fielen Feed-Zeilen zu wieder privaten Decks ganz aus
-- der Liste, statt bloß ihren Namen zu verlieren.
drop function if exists public.community_activity_feed(integer);
create function public.community_activity_feed(p_limit integer default 20)
returns table(
  id bigint,
  kind text,
  actor_id uuid,
  actor_name text,
  metadata jsonb,
  occurred_at timestamptz,
  deck_id uuid,
  deck_name text
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.kind, a.actor_id,
         nullif(trim(p.display_name), '') as actor_name,
         a.metadata, a.occurred_at,
         d.id as deck_id,
         nullif(trim(d.name), '') as deck_name
    from public.community_activity a
    left join public.profiles p on p.id = a.actor_id
    left join public.decks d
      on a.kind = 'deck_public'
     and d.is_public
     and d.id = (a.metadata ->> 'deck_id')::uuid
   order by a.occurred_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.community_activity_feed(integer) from public, anon;
grant execute on function public.community_activity_feed(integer) to authenticated;

-- ---- Eine einzelne Kachel --------------------------------------------
-- Der Klick im Feed führt in die Detailansicht, und die braucht die Kachel
-- (Name, Format, Commander, Bewertung, Erbauer). community_decks liefert
-- immer eine SEITE und filtert nach Namen — das Deck aus dem Feed steht dort
-- womöglich gar nicht drin, weil die Liste auf Seite 1 steht oder eine Suche
-- aktiv ist.
--
-- Deshalb dieselbe Zeile für genau ein Deck. Der Rumpf ist bewusst eine Kopie
-- von community_decks statt eines geteilten Bausteins: Beide sind stabile
-- SQL-Funktionen, und eine gemeinsame Hilfsfunktion müsste erneut als
-- security definer laufen und ihre Rechte gesondert verwalten. Ändert sich
-- die Kachel, sind es zwei Stellen — dafür kann keine von beiden die andere
-- unbemerkt mitverändern.
--
-- `is_public` steht auch hier: Ohne die Bedingung wäre das eine Abfrage auf
-- jedes fremde Deck, sobald man seine Kennung kennt.
drop function if exists public.community_deck_tile(uuid);
create function public.community_deck_tile(p_deck uuid)
returns table (id uuid, name text, format text, archetype text,
               commander text, commander_img text, karten bigint,
               owner_id uuid, owner_name text, owner_avatar text,
               created timestamptz, schnitt numeric, stimmen bigint,
               meine smallint)
language sql stable security definer set search_path = public as $$
  select d.id, d.name, d.format, d.archetype,
         cm.name, cm.img,
         (select coalesce(sum(de.qty), 0) from public.deck_entries de where de.deck_id = d.id),
         d.user_id, p.display_name, p.avatar_url, d.created,
         round((select coalesce(avg(r.stars), 0)::numeric from public.deck_ratings r
                 where r.deck_id = d.id), 2),
         (select count(*) from public.deck_ratings r where r.deck_id = d.id),
         (select r.stars from public.deck_ratings r
           where r.deck_id = d.id and r.user_id = auth.uid())
    from public.decks d
    left join public.cards cm on cm.id = d.main_card_id
    left join public.profiles p on p.id = d.user_id
   where auth.uid() is not null and d.is_public and d.id = p_deck;
$$;

revoke all on function public.community_deck_tile(uuid) from public, anon;
grant execute on function public.community_deck_tile(uuid) to authenticated;
