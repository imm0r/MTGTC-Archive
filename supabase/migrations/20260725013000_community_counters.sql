-- =====================================================================
-- Community Foundation — Zähler für gefundene Combos und Synergien.
--
-- Beides entsteht außerhalb der Datenbank: Combos kommen über die Edge
-- Function von Commander Spellbook, Synergien aus Scryfall-Abfragen. Es
-- gibt also keine Tabelle, aus der sich eine Anzahl ableiten ließe — ohne
-- eine eigene Zählung bleibt die Kachel leer.
--
-- Bewusst OHNE Bezug zur Person. Gespeichert wird nur eine Summe je Art,
-- keine Zeile je Suche und keine Kennung. Damit gibt es nichts zu
-- anonymisieren, nichts aufzuräumen und nichts, was die
-- Sichtbarkeitseinstellung abdecken müsste — die schützt Zuordenbarkeit,
-- und hier ist von vornherein nichts zuzuordnen.
--
-- Das ist auch der Grund, warum die Einstellung hier NICHT gilt: eine reine
-- Gesamtsumme verrät über eine einzelne Person nichts. Genauso hält es
-- community_statistics() bereits mit Karten-, Deck- und Mitgliederzahlen.
--
-- Gezählt werden gefundene Treffer, nicht Suchvorgänge — „Anzahl der
-- erzeugten Combos" meint die Combos, nicht die Klicks.
-- =====================================================================

create table if not exists public.community_counters (
  kind  text primary key check (kind in ('combos', 'synergies')),
  total bigint not null default 0 check (total >= 0)
);

insert into public.community_counters (kind, total)
     values ('combos', 0), ('synergies', 0)
on conflict (kind) do nothing;

alter table public.community_counters enable row level security;
revoke all on public.community_counters from anon, authenticated;
grant select on public.community_counters to authenticated;

drop policy if exists community_counters_read_authenticated on public.community_counters;
create policy community_counters_read_authenticated
  on public.community_counters for select to authenticated using (true);

-- Der einzige Schreibweg. Direktes UPDATE bleibt der Oberfläche verwehrt,
-- sonst könnte ein Client die Summen beliebig setzen statt nur erhöhen.
create or replace function public.record_community_search(p_kind text, p_n integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_kind not in ('combos', 'synergies') then
    raise exception 'Unknown community counter';
  end if;

  -- Deckel gegen Ausreißer: eine einzelne Suche liefert nie hunderte Treffer,
  -- und der Aufruf kommt aus dem Browser — also nicht unbesehen übernehmen.
  update public.community_counters
     set total = total + greatest(0, least(coalesce(p_n, 0), 200))
   where kind = p_kind;
end;
$$;

revoke all on function public.record_community_search(text, integer) from public, anon;
grant execute on function public.record_community_search(text, integer) to authenticated;

-- Die beiden Summen wandern in die Statistik, damit die Oberfläche sie mit
-- den übrigen Kennzahlen in einem Aufruf bekommt.
--
-- Zwei zusätzliche OUT-Parameter ändern den Rückgabetyp, und den lässt
-- „create or replace" nicht anfassen — die Funktion muss erst weg. Innerhalb
-- der Migrationstransaktion entsteht dabei keine Lücke, in der sie fehlte.
drop function if exists public.community_statistics();

create or replace function public.community_statistics()
returns table(
  member_count bigint,
  deck_count bigint,
  card_count bigint,
  active_session_count bigint,
  upcoming_event_count bigint,
  activity_7d_count bigint,
  combo_count bigint,
  synergy_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.decks),
    (select coalesce(sum(qty), 0) from public.cards where qty > 0),
    (select count(*) from public.game_sessions where status = 'open'),
    (select count(*) from public.game_events where starts_at >= now()),
    (select count(*) from public.community_activity where occurred_at >= now() - interval '7 days'),
    (select coalesce(total, 0) from public.community_counters where kind = 'combos'),
    (select coalesce(total, 0) from public.community_counters where kind = 'synergies');
$$;
revoke all on function public.community_statistics() from public, anon;
grant execute on function public.community_statistics() to authenticated;
