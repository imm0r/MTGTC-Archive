-- =====================================================================
--  MTGJSON-uuid mitspeichern — damit der Tageslauf 5 MB statt 358 MB lädt
--
--  Der Job braucht zwei Dinge: die Zuordnung scryfallId → MTGJSON-uuid und
--  die Preise zu dieser uuid. Beides kam bisher aus Bulkdateien:
--
--      AllIdentifiers.json.gz   215 MB   (die Zuordnung)
--      AllPrices.json.gz        143 MB   (90 Tage Verlauf)
--
--  Für den täglichen Lauf ist das Verschwendung. Er soll nur EINEN Punkt je
--  Karte anhängen, und dafür gibt es AllPricesToday.json.gz mit 5,2 MB —
--  gleiche Struktur, nur eben ein Datum statt neunzig. Solange die Zuordnung
--  aber aus AllIdentifiers käme, bliebe es bei 220 MB und die Ersparnis wäre
--  dahin.
--
--  Deshalb merkt sich price_history die uuid, sobald ein voller Lauf sie
--  ohnehin ermittelt hat. Der Tageslauf liest sie dann aus der Datenbank und
--  fasst von MTGJSON nur noch die kleine Datei an:
--
--      voll / Lücken   AllIdentifiers + AllPrices      → schreibt die uuid mit
--      täglich         nur AllPricesToday (5,2 MB)     → liest die uuid hier
--
--  Die Spalte ist bewusst nachtragbar (add column if not exists) und darf
--  NULL sein: bestehende Zeilen haben sie noch nicht, und der Tageslauf
--  überspringt solche Karten einfach, bis der nächste volle Lauf sie nachträgt.
-- =====================================================================

alter table public.price_history add column if not exists mtgjson_uuid text;

comment on column public.price_history.mtgjson_uuid is
  'MTGJSON-uuid dieser Karte, aus AllIdentifiers. Erlaubt dem Tageslauf, allein '
  'AllPricesToday (5 MB) zu laden, statt AllIdentifiers (215 MB) erneut zu streamen. '
  'NULL heißt: noch kein voller Lauf hat sie ermittelt.';

-- merge_price_history nimmt die uuid jetzt entgegen und schreibt sie mit.
-- coalesce beim Konflikt: ein Lauf, der keine uuid mitschickt (etwa ein alter
-- Stand des Skripts), darf die vorhandene NICHT auf NULL zurücksetzen — sonst
-- fiele der Tageslauf still auf die große Datei zurück.
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
           coalesce(r -> 'prices', '{}'::jsonb)   as preise,
           r ->> 'mtgjson_uuid'                   as uuid_
      from jsonb_array_elements(p_rows) with ordinality t(r, i)
     where jsonb_typeof(r) = 'object'
       and r ->> 'scryfall_id' is not null
       and jsonb_typeof(coalesce(r -> 'prices', '{}'::jsonb)) = 'object'
     order by r ->> 'scryfall_id', i desc
  )
  -- merge_price_map auch auf dem EINFÜGE-Weg: eine neue Zeile durchliefe sonst
  -- nie das Mischen und behielte die Reihen genau so, wie MTGJSON sie geliefert
  -- hat — unsortiert und samt Punkten ohne Datum oder Zahlwert. Gegen '{}'
  -- gemischt heißt hier schlicht "normalisiert".
  insert into public.price_history as ph (scryfall_id, prices, mtgjson_uuid, updated_at)
  select sid, public.merge_price_map('{}'::jsonb, preise), uuid_, now() from eingang
  on conflict (scryfall_id) do update
     set prices       = public.merge_price_map(ph.prices, excluded.prices),
         mtgjson_uuid = coalesce(excluded.mtgjson_uuid, ph.mtgjson_uuid),
         updated_at   = now();

  get diagnostics anzahl = row_count;
  return anzahl;
end $$;

revoke execute on function public.merge_price_history(jsonb) from public, anon, authenticated;
grant  execute on function public.merge_price_history(jsonb) to service_role;
