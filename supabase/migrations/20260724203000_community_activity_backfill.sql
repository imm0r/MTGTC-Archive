-- =====================================================================
-- Community Foundation — einmaliger Rückstand für den Aktivitätsstrom.
--
-- Die Trigger aus 20260724115531 wirken erst ab ihrer Installation. Ohne
-- diesen Nachtrag startet der Feed leer, obwohl es Sammlungen, Decks und
-- Termine längst gibt.
--
-- Nicht 1:1 nachgetragen: der Bestand entstand größtenteils in Importen —
-- eine Person hat an einem Tag 614 Karten erfasst. Einzelzeilen daraus
-- würden die zwanzig Feed-Plätze mit derselben Meldung füllen. Deshalb wird
-- pro Person, Tag und Art EIN Eintrag geschrieben, mit der Anzahl in
-- metadata->>'n'. Die Oberfläche formuliert daraus die Mehrzahl.
--
-- Der Zeitstempel ist der jeweils späteste der Gruppe, damit die
-- Reihenfolge im Feed der tatsächlichen Aktivität entspricht.
--
-- Bewusst NICHT nachgetragen: session_started/joined/ended und event_rsvp.
-- Spielrunden sind zeitgebundene Ereignisse; sie Wochen später als frische
-- Aktivität auszugeben wäre irreführend.
--
-- Geschrieben wird direkt in die Tabelle, nicht über
-- record_community_activity(): die Funktion setzt occurred_at auf now() und
-- kann historische Zeitpunkte nicht abbilden.
-- =====================================================================

do $$
declare
  v_neu bigint;
begin
  -- Nur einmal. Der Marker in metadata macht den Nachtrag erkennbar und
  -- verhindert doppelte Einträge, falls die Migration erneut läuft.
  if exists (select 1 from public.community_activity where metadata ? 'backfill') then
    raise notice 'Rückstand bereits eingetragen — übersprungen.';
    return;
  end if;

  with gruppen as (
    select 'card_added' as kind, c.user_id as actor_id,
           max(c.added) as occurred_at, count(*) as n
      from public.cards c
     where c.qty > 0 and c.added is not null and c.user_id is not null
     group by c.user_id, date_trunc('day', c.added)

    union all

    select 'deck_created', d.user_id, max(d.created), count(*)
      from public.decks d
     where d.created is not null and d.user_id is not null
     group by d.user_id, date_trunc('day', d.created)

    union all

    select 'event_created', e.host, max(e.created), count(*)
      from public.game_events e
     where e.created is not null and e.host is not null
     group by e.host, date_trunc('day', e.created)
  )
  insert into public.community_activity (actor_id, kind, metadata, occurred_at)
  select g.actor_id, g.kind,
         jsonb_build_object('n', g.n, 'backfill', true),
         g.occurred_at
    from gruppen g
    -- Verwaiste Bestände ohne gültigen Account übergehen: die Spalte erlaubt
    -- zwar NULL, ein Feed-Eintrag ohne Urheber hätte aber keinen Wert.
   where exists (select 1 from auth.users u where u.id = g.actor_id);

  get diagnostics v_neu = row_count;
  raise notice 'Rückstand eingetragen: % Feed-Einträge.', v_neu;
end;
$$;
