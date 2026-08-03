-- =====================================================================
-- Ein Community-Deck ansehen und übernehmen.
--
-- ANSEHEN braucht hier nichts. Die SELECT-Policies aus
-- 20260803000000_community_decks.sql geben decks, deck_entries,
-- deck_categories, deck_entry_categories und cards für öffentliche Decks
-- bereits frei; die App liest sie direkt, genau wie beim geteilten
-- Freundes-Deck. Was fehlte, war der Weg ins EIGENE Regal.
--
-- ÜBERNEHMEN geht über import_shared_deck. Die Funktion gibt es seit
-- 20260726180000_printed_text.sql, sie kannte aber nur einen einzigen Weg
-- zum Deck: „geteilt UND befreundet". Ein öffentliches Deck erfüllt das
-- nicht — man ist mit dem Erbauer ja gerade nicht befreundet. Deshalb
-- prüft sie jetzt BEIDE Wege.
--
-- DREI ÄNDERUNGEN, sonst unverändert übernommen:
--
--   1. Die Zugangsprüfung nimmt `is_public` dazu.
--   2. Die Kopie bleibt privat — dazu unten mehr.
--   3. Die Einteilung des Erbauers kommt mit.
--
-- ZU 2: DIE KOPIE BLEIBT PRIVAT. Seit der Community-Decks-Migration steht
-- der Vorgabewert von decks.is_public auf true, und der INSERT hier nannte
-- die Spalte nicht — eine übernommene Kopie wäre also sofort selbst
-- öffentlich gewesen. Drei Gründe dagegen:
--
--   * Der Bestätigungsdialog verspricht seit jeher „als neues, PRIVATES
--     Deck" (dlg.importDeck, in allen fünf Sprachen). Text und Verhalten
--     müssen dasselbe sagen.
--   * Es geht um das Deck eines ANDEREN. Es unter eigenem Namen weiter zu
--     veröffentlichen, ohne dass jemand danach gefragt hat, ist nicht das,
--     was „übernehmen" heißt.
--   * Die Richtung ist einseitig: „muss einmal veröffentlicht werden" holt
--     man mit einem Klick nach, „war aus Versehen öffentlich" nicht.
--
-- Selbst angelegte und aus einer Textliste eingelesene Decks bleiben davon
-- unberührt — die sind weiterhin von sich aus öffentlich.
--
-- ZU 3: DIE EINTEILUNG KOMMT MIT. „Ein Deck ohne seine Einteilung wäre
-- eine Liste, mit ihr ein Bauplan" — das steht so schon bei den geteilten
-- Freundes-Decks, und die Ansicht zeigt sie auch. Wer danach übernahm,
-- bekam bis jetzt die Liste. Die Zuordnung braucht zwei Übersetzungen:
-- fremde Karten-IDs auf eigene (die entstehen in der Schleife) und fremde
-- Kategorie-IDs auf frisch angelegte. Beide werden als jsonb mitgeführt.
-- =====================================================================

create or replace function public.import_shared_deck(p_deck uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  src public.decks%rowtype;
  fname text; newid uuid; e record; mycard uuid; mymain uuid;
  k record; newkat uuid;
  -- fremde card_id → eigene card_id, fremde category_id → eigene
  v_karte jsonb := '{}'::jsonb;
  v_kat   jsonb := '{}'::jsonb;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  select * into src from public.decks where id = p_deck;
  if not found then raise exception 'Deck nicht gefunden'; end if;
  -- Zwei Wege zum selben Deck: der Freundeskreis oder die Community.
  if not (coalesce(src.is_public, false)
          or (src.shared and public.are_friends(me, src.user_id))) then
    raise exception 'Kein Zugriff auf dieses Deck';
  end if;
  select display_name into fname from public.profiles where id = src.user_id;

  -- is_public ausdrücklich false, nicht dem Spaltenvorgabewert überlassen
  -- (siehe Kopf).
  insert into public.decks (user_id, name, format, archetype, shared, is_public)
    values (me, left(src.name || ' (von ' || coalesce(fname, 'Freund') || ')', 120),
            src.format, src.archetype, false, false)
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
    v_karte := v_karte || jsonb_build_object(e.id::text, mycard::text);
    insert into public.deck_entries (deck_id, card_id, user_id, qty)
      values (newid, mycard, me, e.deck_qty)
      on conflict (deck_id, card_id) do update set qty = excluded.qty;
  end loop;

  -- ---- Die Einteilung ------------------------------------------------
  -- Die Fächer in der Reihenfolge des Erbauers; pos wandert unverändert
  -- mit, denn die Reihenfolge trägt selbst eine Aussage.
  for k in
    select * from public.deck_categories where deck_id = p_deck order by pos, created
  loop
    insert into public.deck_categories (deck_id, user_id, name, pos)
      values (newid, me, k.name, k.pos)
      on conflict (deck_id, name) do nothing
      returning id into newkat;
    if newkat is null then
      select id into newkat from public.deck_categories where deck_id = newid and name = k.name;
    end if;
    v_kat := v_kat || jsonb_build_object(k.id::text, newkat::text);
  end loop;

  -- Nur Zuordnungen, für die BEIDE Übersetzungen vorliegen. Zwei fremde
  -- Karten können auf dieselbe eigene fallen (dieselbe Auflage, andere
  -- Ausführung) — dann bleibt es bei einer Zuordnung statt eines Fehlers.
  insert into public.deck_entry_categories (deck_id, card_id, category_id, user_id, is_primary)
    select newid, (v_karte ->> zc.card_id::text)::uuid,
           (v_kat ->> zc.category_id::text)::uuid, me, zc.is_primary
      from public.deck_entry_categories zc
     where zc.deck_id = p_deck
       and v_karte ? zc.card_id::text
       and v_kat ? zc.category_id::text
    on conflict do nothing;

  if mymain is not null then update public.decks set main_card_id = mymain where id = newid; end if;
  return newid;
end $$;
revoke execute on function public.import_shared_deck(uuid) from anon;
