-- =====================================================================
--  Wunschkarte einlösen: Setcode-Schreibweise und Abgleich über Set+Nummer
--
--  ZWEI DINGE, die zusammengehören.
--
--  1. Der Setcode wurde uneinheitlich geschrieben. Scryfall liefert ihn klein
--     ("ltr"), die Sammlungswege wandeln ihn gross ("LTR") — nur
--     wunschkarteZumDeck reichte ihn roh durch. Eine über „+ Wunsch" angelegte
--     Zeile trug deshalb "ltr" und traf per Set+Nummer nie auf ihre gescannte
--     Fassung. Betroffen war damit alles, was über Set+Nummer vergleicht:
--     bestandVon (der Fehlbestand im Deck), deckVorkommen (das Kontingent) und
--     der Set-Filter. Der Client schreibt jetzt überall gross; die Zeilen aus
--     der Zeit davor werden hier einmalig nachgezogen.
--
--  2. fulfil_wish_in_deck liess bisher nur oracle_id oder Name als Beleg dafür
--     gelten, dass zwei Zeilen dieselbe Karte sind. Set + Sammlernummer
--     bezeichnen aber genau eine Auflage — steht dort dasselbe Paar, IST es
--     dieselbe Karte, und was in oracle_id steht, kann dann nur falsch sein.
--     Der dritte Weg kommt dazu, buchstabenblind beim Setcode.
--
--  Sprache, Ausführung und Zustand spielten schon vorher keine Rolle und tun
--  es weiterhin nicht: eine Wunschkarte entsteht als englische Nicht-Foil-
--  Zeile, gekauft wird, was der Laden hergibt.
-- =====================================================================

-- Altbestand nachziehen. Setcodes sind Bezeichner ohne Gross-/Kleinschreibung;
-- das Grossschreiben ändert also keine Bedeutung, nur die Schreibweise. Die
-- where-Bedingung hält den Lauf wiederholbar und rührt nichts an, was passt.
update public.cards
   set set_code = upper(set_code)
 where set_code is not null and set_code <> upper(set_code);

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
  --
  -- Drei Wege, jeder genügt allein — dieselbe Regel wie selbeKarte() im Client,
  -- sonst liesse der eine zu, was der andere abweist:
  --   * Set + Sammlernummer bezeichnen EINE Auflage, und eine Auflage ist eine
  --     bestimmte Karte. Setcode buchstabenblind: Scryfall liefert ihn klein,
  --     die Sammlungswege schreiben ihn gross, Altbestand hat beides.
  --   * oracle_id — teilen alle Drucke, Sprachen und Foil-Fassungen.
  --   * Der englische Name, für Uralt-Zeilen ohne oracle_id.
  -- Sprache, Ausführung und Zustand bleiben bei allen dreien aussen vor: eine
  -- Wunschkarte entsteht als englische Nicht-Foil-Zeile, gekauft wird, was da
  -- ist. Ein Abgleich, der darauf bestünde, träfe nie zu.
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
end $$;
revoke all on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) to authenticated;
