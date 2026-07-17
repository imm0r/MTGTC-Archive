-- =====================================================================
--  REPARATUR: Row Level Security wiederherstellen
--
--  Anlass: Ohne jede Anmeldung liessen sich Karten lesen, schreiben und
--  loeschen. Der Schutz der Daten haengt allein an RLS — der oeffentliche
--  Schluessel steht per Definition im Browser und im Repository.
--
--  Zuerst den DIAGNOSE-Block ausfuehren und das Ergebnis ansehen, dann
--  den REPARATUR-Block. Beide sind gefahrlos und veraendern keine Daten.
-- =====================================================================

-- ------------------------------------------------------- 1. DIAGNOSE
-- Ist RLS ueberhaupt eingeschaltet?
select relname            as tabelle,
       relrowsecurity     as rls_an,
       relforcerowsecurity as rls_erzwungen
from pg_class
where oid in ('public.cards'::regclass,
              'public.decks'::regclass,
              'public.deck_entries'::regclass);

-- Welche Policies existieren, und fuer welche Rolle gelten sie?
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Steht der Standardwert von user_id noch auf auth.uid()?
-- Ein fest eingetragener Wert waere ein Fehler: dann bekaeme jeder
-- Schreibzugriff die ID desselben Kontos.
select table_name, column_name, column_default
from information_schema.columns
where table_schema = 'public'
  and column_name = 'user_id'
order by table_name;

-- Wurden Rechte direkt an anon vergeben? (Sollte leer bzw. nur
-- authenticated/service_role sein.)
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'public')
order by table_name, privilege_type;


-- ------------------------------------------------------ 2. REPARATUR
-- Standardwert zurueck auf den angemeldeten Nutzer.
alter table public.cards        alter column user_id set default auth.uid();
alter table public.decks        alter column user_id set default auth.uid();
alter table public.deck_entries alter column user_id set default auth.uid();

-- Direkt vergebene Rechte an anon zuruecknehmen. RLS greift sonst zwar
-- trotzdem, aber anon hat auf diesen Tabellen nichts zu suchen.
revoke all on public.cards        from anon;
revoke all on public.decks        from anon;
revoke all on public.deck_entries from anon;

-- RLS einschalten und erzwingen. "force" gilt zusaetzlich fuer den
-- Tabelleneigentuemer selbst.
alter table public.cards        enable row level security;
alter table public.decks        enable row level security;
alter table public.deck_entries enable row level security;
alter table public.cards        force row level security;
alter table public.decks        force row level security;
alter table public.deck_entries force row level security;

-- Policies neu setzen. Alles Fremde auf diesen Tabellen faellt dabei weg —
-- eine zu weit gefasste Policy waere genau die Ursache, die wir suchen.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('cards', 'decks', 'deck_entries')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "eigene karten" on public.cards
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "eigene decks" on public.decks
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "eigene deck-eintraege" on public.deck_entries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ------------------------------------------------- 3. GEGENPROBE
-- Muss jetzt wieder rls_an = true und je eine Policy fuer {authenticated}
-- zeigen. Danach in der App pruefen: abmelden, Seite neu laden — es darf
-- keine Karte mehr sichtbar sein.
select relname as tabelle, relrowsecurity as rls_an, relforcerowsecurity as rls_erzwungen
from pg_class
where oid in ('public.cards'::regclass, 'public.decks'::regclass, 'public.deck_entries'::regclass);

select tablename, policyname, roles, cmd from pg_policies
where schemaname = 'public' order by tablename;
