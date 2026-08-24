-- RLS-Performance (Supabase-Advisor 0003_auth_rls_initplan).
--
-- In den Policies stand auth.uid() bisher direkt im Ausdruck und wurde damit
-- PRO ZEILE neu ausgewertet. In ( select auth.uid() ) verpackt, erkennt Postgres
-- einen InitPlan und wertet es EINMAL je Abfrage aus — auf großen Tabellen
-- (cards, deck_entries, deck_history) ein echter Gewinn bei jedem Lesen/Schreiben.
-- Semantisch identisch: der Wert ist innerhalb einer Anfrage konstant.
--
-- Betroffen sind 48 Policies über 26 Tabellen; im Bestand kommt ausschließlich
-- auth.uid() vor (kein auth.role()/auth.jwt()/current_setting()).
--
-- Umsetzung transkriptionsfrei und idempotent aus dem Katalog: das doppelte
-- replace (erst ent-, dann wieder verpacken) normalisiert, sodass ein zweiter
-- Lauf denselben Stand herstellt statt ( select ( select … ) ) zu verschachteln.
-- Postgres stellt den verpackten Ausdruck als „( SELECT auth.uid() AS uid)" dar
-- — dieselbe Bedeutung, nur die deparse-Schreibweise.
do $$
declare
  r record; new_qual text; new_check text;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and ( qual like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%' )
  loop
    new_qual := case when r.qual is not null
      then replace(replace(r.qual, '(select auth.uid())', 'auth.uid()'), 'auth.uid()', '(select auth.uid())')
      end;
    new_check := case when r.with_check is not null
      then replace(replace(r.with_check, '(select auth.uid())', 'auth.uid()'), 'auth.uid()', '(select auth.uid())')
      end;
    execute format('alter policy %I on public.%I%s%s',
      r.policyname, r.tablename,
      case when new_qual  is not null then ' using ('      || new_qual  || ')' else '' end,
      case when new_check is not null then ' with check (' || new_check || ')' else '' end);
  end loop;
end $$;
