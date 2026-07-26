-- =====================================================================
--  Preisverlauf ohne Ende: zusammenführen statt überschreiben
--
--  Bisher schrieb der Backfill-Job die MTGJSON-Reihen mit einem gewöhnlichen
--  Upsert in public.price_history. Ein Upsert ERSETZT die Spalte — und weil
--  MTGJSON immer nur die letzten ~90 Tage ausliefert, war der gespeicherte
--  Verlauf ein gleitendes 90-Tage-Fenster: was älter wurde, fiel bei jedem
--  Lauf wieder heraus. Ein Jahresverlauf konnte so nie entstehen, egal wie
--  oft der Job lief.
--
--  Ab hier ist die Tabelle ein ARCHIV. Der Job schickt weiterhin nur das
--  frische ~90-Tage-Fenster; zusammengeführt wird HIER, in der Datenbank:
--
--      alt  ──┐
--             ├─→ je Datum ein Punkt, der neue gewinnt ─→ prices
--      neu  ──┘
--
--  Warum serverseitig und nicht im Job: sonst müsste der Job jeden Tag das
--  gesamte Archiv lesen, im Speicher mischen und vollständig zurückschreiben.
--  Das wächst mit jedem Jahr, während der Weg über merge_price_history immer
--  gleich viel überträgt — nur das Fenster, das MTGJSON gerade liefert.
--
--  Der neue Punkt gewinnt bei gleichem Datum bewusst: MTGJSON korrigiert
--  Tageswerte gelegentlich nach, und die spätere Lieferung ist die bessere.
--  Ältere Daten fasst der Vorgang nie an — es gibt keinen Weg, auf dem ein
--  Lauf Geschichte verlieren kann.
--
--  Schreiben darf weiterhin allein der Job: die Funktion läuft als
--  security invoker, RLS bleibt also zuständig, und price_history hat nach
--  wie vor keine Schreib-Policy. Nur der service_role-Key umgeht RLS.
-- =====================================================================

-- ------------------------------------------------- eine Reihe mischen
-- Zwei Reihen [{d,v}, …] zu einer verschmelzen: je Datum ein Punkt, bei
-- Gleichstand gewinnt "neu", Ergebnis nach Datum aufsteigend. Punkte ohne
-- Datum oder ohne Zahlwert fallen still heraus — die Reihe soll auch dann
-- lesbar bleiben, wenn irgendwann Unfug in der Spalte landet.
-- Das Datum ist 'YYYY-MM-DD', da ist die Textsortierung die zeitliche.
create or replace function public.merge_price_series(alt jsonb, neu jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('d', d, 'v', v) order by d), '[]'::jsonb)
    from (
      select p ->> 'd'          as d,
             (p -> 'v')         as v,
             row_number() over (partition by p ->> 'd' order by rang desc) as platz
        from (
          select 0 as rang, e as p from jsonb_array_elements(coalesce(alt, '[]'::jsonb)) e
          union all
          select 1 as rang, e as p from jsonb_array_elements(coalesce(neu, '[]'::jsonb)) e
        ) beide
       where jsonb_typeof(p) = 'object'
         and p ->> 'd' is not null
         and jsonb_typeof(p -> 'v') = 'number'
    ) s
   where platz = 1
$$;

-- ------------------------------------------------- ganzen Preisbaum mischen
-- { "eur": { "normal": […], "foil": […] }, "usd": { … } } — je Währung und
-- Ausführung eine Reihe. Gemischt wird über die Schlüssel von "neu"; was nur
-- in "alt" steht (etwa eine Währung, die MTGJSON heute nicht liefert), bleibt
-- unangetastet stehen. Genau das macht den Vorgang verlustfrei.
create or replace function public.merge_price_map(alt jsonb, neu jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  waehrung text;
  art      text;
  ergebnis jsonb := coalesce(alt, '{}'::jsonb);
  zweig    jsonb;
begin
  if jsonb_typeof(ergebnis) is distinct from 'object' then ergebnis := '{}'::jsonb; end if;
  if jsonb_typeof(neu)      is distinct from 'object' then return ergebnis;        end if;

  for waehrung in select jsonb_object_keys(neu) loop
    if jsonb_typeof(neu -> waehrung) is distinct from 'object' then continue; end if;

    zweig := coalesce(ergebnis -> waehrung, '{}'::jsonb);
    if jsonb_typeof(zweig) is distinct from 'object' then zweig := '{}'::jsonb; end if;

    for art in select jsonb_object_keys(neu -> waehrung) loop
      zweig := jsonb_set(zweig, array[art],
                 public.merge_price_series(zweig -> art, neu -> waehrung -> art), true);
    end loop;

    ergebnis := jsonb_set(ergebnis, array[waehrung], zweig, true);
  end loop;

  return ergebnis;
end $$;

-- ------------------------------------------------- Eintrittspunkt für den Job
-- Erwartet [{ "scryfall_id": "…", "prices": { … } }, …] und legt jede Reihe
-- über die vorhandene. Rückgabe ist die Zahl der berührten Zeilen.
--
-- distinct on: käme dieselbe scryfall_id zweimal im selben Aufruf vor, bräche
-- Postgres den ganzen Stapel ab ("cannot affect row a second time"). Der
-- letzte Eintrag gewinnt — dieselbe Regel wie in der Map, aus der der Job die
-- Zeilen baut.
create or replace function public.merge_price_history(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  anzahl integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'merge_price_history erwartet ein JSON-Array, bekam %',
      coalesce(jsonb_typeof(p_rows), 'null');
  end if;

  with eingang as (
    select distinct on (r ->> 'scryfall_id')
           r ->> 'scryfall_id'                    as sid,
           coalesce(r -> 'prices', '{}'::jsonb)   as preise
      from jsonb_array_elements(p_rows) with ordinality t(r, i)
     where jsonb_typeof(r) = 'object'
       and r ->> 'scryfall_id' is not null
       and jsonb_typeof(coalesce(r -> 'prices', '{}'::jsonb)) = 'object'
     order by r ->> 'scryfall_id', i desc
  )
  -- merge_price_map auch auf dem EINFUEGE-Weg: eine neue Zeile durchliefe
  -- sonst nie das Mischen und behielte die Reihen genau so, wie MTGJSON sie
  -- geliefert hat -- unsortiert und samt Punkten ohne Datum oder Zahlwert.
  -- Gegen '{}' gemischt heisst hier schlicht "normalisiert".
  insert into public.price_history as ph (scryfall_id, prices, updated_at)
  select sid, public.merge_price_map('{}'::jsonb, preise), now() from eingang
  on conflict (scryfall_id) do update
     set prices     = public.merge_price_map(ph.prices, excluded.prices),
         updated_at = now();

  get diagnostics anzahl = row_count;
  return anzahl;
end $$;

-- Aufrufbar allein für den Job. Angemeldete kämen ohnehin nicht durch (keine
-- Schreib-Policy, security invoker), aber eine Funktion, die niemand braucht,
-- soll auch niemand sehen.
revoke execute on function public.merge_price_series(jsonb, jsonb)  from public, anon, authenticated;
revoke execute on function public.merge_price_map(jsonb, jsonb)     from public, anon, authenticated;
revoke execute on function public.merge_price_history(jsonb)        from public, anon, authenticated;
grant  execute on function public.merge_price_series(jsonb, jsonb)  to service_role;
grant  execute on function public.merge_price_map(jsonb, jsonb)     to service_role;
grant  execute on function public.merge_price_history(jsonb)        to service_role;

comment on function public.merge_price_history(jsonb) is
  'Legt MTGJSON-Preisreihen über die vorhandenen in public.price_history, statt sie zu ersetzen. '
  'Bei gleichem Datum gewinnt der neue Wert; ältere Punkte bleiben für immer erhalten.';

-- ------------------------------------------------- persönliche Historie
-- Dieselbe Frage eine Ebene tiefer: set_price kürzte cards.hist auf die
-- letzten 60 Punkte. Für Karten, die MTGJSON kennt, war das verschmerzbar —
-- das Fundament trug die alten Tage. Für alles andere (seltene Auflagen,
-- Karten ohne Cardmarket-Reihe) war die eigene Historie die einzige, und die
-- endete nach zwei Monaten. Der Schnitt fällt weg.
--
-- Unbegrenzt heißt hier nicht unbegrenzt schnell: es bleibt bei EINEM Punkt
-- pro Tag und Karte (ein zweiter Aufruf am selben Tag ersetzt den Wert), also
-- höchstens ~365 kleine Objekte im Jahr.
create or replace function public.set_price(p_card_id uuid, p_price numeric)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  h     jsonb;
  d_txt text := to_char(current_date, 'YYYY-MM-DD');
begin
  select hist into h from public.cards where id = p_card_id;
  if h is null then return; end if;             -- fremde oder gelöschte Zeile

  if jsonb_array_length(h) > 0
     and h -> (jsonb_array_length(h) - 1) ->> 'd' = d_txt then
    h := jsonb_set(h, array[(jsonb_array_length(h) - 1)::text, 'v'], to_jsonb(p_price));
  elsif p_price is not null then
    h := h || jsonb_build_array(jsonb_build_object('d', d_txt, 'v', p_price));
  end if;

  update public.cards set price = p_price, hist = h where id = p_card_id;
end $$;
