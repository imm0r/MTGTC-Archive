-- =====================================================================
--  Wunschkarte einlösen: einen Deck-Eintrag von einer Auflage auf eine
--  andere umhängen.
--
--  Warum überhaupt: Eine Wunschkarte ist ein ganz normaler Deck-Eintrag,
--  dessen Karte man (noch) nicht besitzt — sie belegt also bereits einen
--  der 100 Plätze. Kauft man sie später, ist das oft eine ANDERE Auflage
--  als die, die der Vorschlag angelegt hat. Der Bestand wird über Set +
--  Sammlernummer ermittelt, die alte Zeile bleibt damit auf Bestand 0 und
--  das Deck gilt weiter als unvollständig. Die besessene Auflage zusätzlich
--  ins Deck zu legen wäre falsch (sie wäre Karte 101 und eine zweite Kopie
--  derselben Karte); richtig ist, den vorhandenen Eintrag umzuhängen.
--
--  Warum in der Datenbank: Abziehen und Gutschreiben müssen zusammen
--  passieren. Zwei getrennte Aufrufe aus dem Browser könnten zwischendrin
--  abbrechen und das Deck um eine Karte kürzen — und in der falschen
--  Reihenfolge liefe das Gutschreiben in den 100-Karten-Trigger.
-- =====================================================================

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
    (v_from.oracle_id is not null and v_from.oracle_id = v_to.oracle_id)
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

  return v_n;
end;
$$;

revoke all on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) to authenticated;
