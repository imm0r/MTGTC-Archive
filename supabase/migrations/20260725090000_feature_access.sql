-- =====================================================================
--  Freischaltung einzelner Funktionen: global ODER für einzelne Personen
--
--  feature_flags gibt es schon: ein Schalter je Funktion, für alle. Was
--  fehlte, ist die Freischaltung für EINZELNE — die Tester kennen sich mit
--  den Magic-Feinheiten besser aus und sollen Verfahren beurteilen können,
--  die für alle anderen noch nicht laufen.
--
--  Beides greift additiv: eine Funktion ist für jemanden aktiv, wenn der
--  globale Schalter an ist ODER diese Person einen Eintrag hat. Damit kann
--  der Admin ein Verfahren erst mit den Testern fahren und es später mit
--  einem Klick für alle anschalten, ohne die Einzelfreigaben aufzuräumen.
-- =====================================================================

-- Die zwei Prüfverfahren für die Schnitt-Begründungen. Beide zunächst aus:
-- ohne Freischaltung ändert sich für niemanden etwas.
insert into feature_flags (key, enabled) values
  ('verify_cite',  false),   -- C: Modell muss die Belegstelle zitieren
  ('verify_model', false)    -- A: Zweitprüfung per Modell, nur bei Verdacht
on conflict (key) do nothing;

create table if not exists feature_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null,
  granted timestamptz not null default now(),
  primary key (user_id, key)
);

comment on table feature_access is
  'Freischaltung einer Funktion für EINZELNE Personen, zusätzlich zum globalen Schalter in feature_flags. Wirkt additiv, nie einschränkend.';

alter table feature_access enable row level security;

-- Jede Person darf sehen, was für sie freigeschaltet ist — sonst könnte die
-- Oberfläche es nicht anzeigen. Ändern darf nur der Admin.
drop policy if exists feature_access_select_own on feature_access;
create policy feature_access_select_own on feature_access
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists feature_access_admin_write on feature_access;
create policy feature_access_admin_write on feature_access
  for all using (is_admin()) with check (is_admin());

-- Die eine Abfrage, die beides zusammenführt. Client UND Edge Function
-- fragen sie — damit gibt es genau eine Stelle, an der die Regel steht,
-- und die Oberfläche kann nicht etwas anderes glauben als der Server tut.
create or replace function effective_features()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k), array[]::text[])
  from (
    select key as k from feature_flags where enabled
    union
    select key from feature_access where user_id = auth.uid()
  ) s;
$$;

comment on function effective_features is
  'Alle Funktions-Schlüssel, die für die aufrufende Person aktiv sind: global eingeschaltet ODER einzeln freigeschaltet.';

revoke all on function effective_features() from public;
grant execute on function effective_features() to authenticated;

-- Für die Admin-Oberfläche: wer ist wofür freigeschaltet. Nur der Admin
-- bekommt Daten; alle anderen eine leere Menge statt eines Fehlers, damit
-- ein versehentlicher Aufruf die Oberfläche nicht zerlegt.
create or replace function admin_feature_access()
returns table (user_id uuid, display_name text, keys text[])
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name,
         coalesce(array_agg(fa.key order by fa.key) filter (where fa.key is not null), array[]::text[])
  from profiles p
  left join feature_access fa on fa.user_id = p.id
  where is_admin()
  group by p.id, p.display_name
  order by p.display_name nulls last;
$$;

revoke all on function admin_feature_access() from public;
grant execute on function admin_feature_access() to authenticated;
