-- =====================================================================
-- Ein übernommenes Deck darf erst öffentlich werden, wenn es auch ein
-- eigenes geworden ist.
--
-- WARUM ÜBERHAUPT. Übernehmen ist ein Klick. Ohne Sperre entstünde aus
-- einem beliebten Deck in kurzer Zeit ein Dutzend Kopien in der
-- Community-Liste — dieselbe Kartenliste unter zwölf Namen, und die
-- Rangliste wäre eine Liste desselben Decks. Der Erbauer stünde daneben.
--
-- WAS „GEÄNDERT" HEISST. Gemessen wird gegen einen SCHNAPPSCHUSS des
-- Zustands beim Übernehmen (import_baseline), nicht gegen das Quelldeck:
-- Das darf sich später ändern oder verschwinden, und dann wäre die Frage
-- „wie weit bist du davon weg" plötzlich anders beantwortet, ohne dass
-- jemand etwas getan hätte.
--
-- Der Schlüssel ist die ORACLE-IDENTITÄT, nicht die Auflage. Wer dieselbe
-- Karte in einer schöneren Ausgabe einsetzt, hat das Deck nicht geändert —
-- er hat es neu gekauft. (Fällt die oracle_id aus, tritt der kleingesetzte
-- Kartenname an ihre Stelle; ohne das zählte eine Karte ohne oracle_id
-- gar nicht mit und das Deck sähe unveränderter aus, als es ist.)
--
-- Gezählt werden EXEMPLARE, nicht Zeilen: |jetzt − damals| über alle
-- Karten. Ein Tausch (eine raus, eine rein) zählt damit zwei.
--
-- DIE SCHWELLE: ein Zehntel des übernommenen Decks, mindestens aber vier.
--
--   100 Karten → 10 → fünf Tausche
--    60 Karten →  6 → drei Tausche
--    kleiner   →  4 → zwei Tausche
--
-- Ein Zehntel, weil es mit der Deckgröße mitwächst; die Untergrenze,
-- damit ein Deck aus zehn Karten nicht mit einem einzigen Tausch
-- durchrutscht. Die Zahlen stehen HIER und noch einmal in app.js (die
-- Anzeige rechnet mit, um sagen zu können, wie viel noch fehlt) — die
-- Datenbank ist die maßgebliche Stelle, die Anzeige die bequeme.
--
-- NUR DER ÜBERGANG WIRD GEPRÜFT, private→öffentlich. Wer die Schwelle
-- erreicht, veröffentlicht und danach zurückbaut, bleibt öffentlich. Das
-- ist Absicht: Ein Deck, das von sich aus wieder verschwindet, weil man
-- zwei Karten herausgenommen hat, wäre schlimmer als die Lücke.
-- =====================================================================

alter table public.decks add column if not exists imported_from uuid
  references public.decks(id) on delete set null;
alter table public.decks add column if not exists import_baseline jsonb;

comment on column public.decks.imported_from is
  'Quelldeck, falls dieses Deck übernommen wurde. on delete set null: Die '
  'Sperre hängt an import_baseline und überlebt das Löschen der Quelle.';
comment on column public.decks.import_baseline is
  'Zusammensetzung beim Übernehmen als {oracle-Schlüssel: Exemplare}. '
  'NULL bei selbst angelegten Decks — die sind jederzeit veröffentlichbar.';

-- ---- Der Stand eines Decks als {Schlüssel: Exemplare} -----------------
create or replace function public.deck_stand(d uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.schluessel, x.n), '{}'::jsonb)
    from (select coalesce(c.oracle_id::text, lower(c.name)) as schluessel,
                 sum(de.qty)::int as n
            from public.deck_entries de
            join public.cards c on c.id = de.card_id
           where de.deck_id = d
           group by coalesce(c.oracle_id::text, lower(c.name))) x;
$$;

-- ---- Wie weit ist es weg ----------------------------------------------
-- Summe der Beträge über die VEREINIGUNG beider Schlüsselmengen. Nur über
-- die eine zu laufen zählte entweder das Entfernte oder das Hinzugefügte
-- nicht mit — und dann käme ein komplett ausgetauschtes Deck auf null.
create or replace function public.deck_abweichung(d uuid) returns integer
language sql stable security definer set search_path = public as $$
  with basis as (select coalesce(import_baseline, '{}'::jsonb) as b from public.decks where id = d),
       jetzt as (select public.deck_stand(d) as j)
  select coalesce(sum(abs(coalesce((j -> k)::int, 0) - coalesce((b -> k)::int, 0))), 0)::int
    from basis, jetzt,
         lateral (select jsonb_object_keys(b) as k
                  union
                  select jsonb_object_keys(j)) s;
$$;

create or replace function public.deck_schwelle(basis jsonb) returns integer
language sql immutable set search_path = public as $$
  select greatest(4, ceil(coalesce((select sum(value::int) from jsonb_each_text(coalesce(basis, '{}'::jsonb))), 0) / 10.0)::int);
$$;

-- ---- Darf es öffentlich werden ----------------------------------------
create or replace function public.deck_darf_oeffentlich(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (select import_baseline from public.decks where id = d) is null then true
    else public.deck_abweichung(d)
         >= public.deck_schwelle((select import_baseline from public.decks where id = d))
  end;
$$;

-- Nur der Trigger braucht sie. Frei aufrufbar wären es drei Funktionen,
-- mit denen sich die Zusammensetzung eines fremden Decks abfragen ließe,
-- ohne es je gesehen zu haben.
revoke all on function public.deck_stand(uuid) from public, anon, authenticated;
revoke all on function public.deck_abweichung(uuid) from public, anon, authenticated;
revoke all on function public.deck_darf_oeffentlich(uuid) from public, anon, authenticated;

-- ---- Die Sperre selbst -------------------------------------------------
create or replace function public.pruefe_deck_oeffentlich()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Nur der Übergang nach öffentlich. Wer schon öffentlich ist, bleibt es;
  -- wer privat stellt, darf das immer.
  if new.is_public and not coalesce(old.is_public, false)
     and new.import_baseline is not null
     and not public.deck_darf_oeffentlich(new.id) then
    raise exception 'Uebernommenes Deck erst aendern (% von % Karten)',
      public.deck_abweichung(new.id), public.deck_schwelle(new.import_baseline)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_deck_oeffentlich_pruefen on public.decks;
create trigger trg_deck_oeffentlich_pruefen
  before update of is_public on public.decks
  for each row execute function public.pruefe_deck_oeffentlich();

-- ---- Übernehmen schreibt den Schnappschuss mit ------------------------
-- Sonst hinge die Sperre in der Luft: Ohne import_baseline ist jedes
-- übernommene Deck von der Prüfung ausgenommen.
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

  -- is_public ausdrücklich false, nicht dem Spaltenvorgabewert überlassen.
  -- Dazu Herkunft und Schnappschuss: Der Schnappschuss wird VOR dem Kopieren
  -- von der QUELLE genommen — die eigene Kopie gibt es noch nicht, und die
  -- Quelle darf sich später ändern, ohne dass die Sperre mitwandert.
  insert into public.decks (user_id, name, format, archetype, shared, is_public,
                            imported_from, import_baseline)
    values (me, left(src.name || ' (von ' || coalesce(fname, 'Freund') || ')', 120),
            src.format, src.archetype, false, false,
            p_deck, public.deck_stand(p_deck))
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
