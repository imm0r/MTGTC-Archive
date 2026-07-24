-- =====================================================================
-- Community Foundation — Nachtrag: Anzeigename nicht mehr in der Datenbank
-- übersetzen.
--
-- Die erste Sprint-1-Fassung von community_activity_feed() lieferte für
-- Mitglieder ohne Anzeigenamen das deutsche Literal 'Ein Mitglied'. Die
-- Oberfläche gibt es aber in fünf Sprachen, und die Datenbank weiß nicht,
-- welche der Aufrufer gerade benutzt. Ab hier liefert die Funktion NULL und
-- der Client setzt die Übersetzung ein (community.anonMember).
--
-- Signatur und Rechte bleiben unverändert; bestehende Aufrufer brechen nicht.
-- =====================================================================

create or replace function public.community_activity_feed(p_limit integer default 20)
returns table(
  id bigint,
  kind text,
  actor_id uuid,
  actor_name text,
  metadata jsonb,
  occurred_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.kind, a.actor_id,
         nullif(trim(p.display_name), '') as actor_name,
         a.metadata, a.occurred_at
    from public.community_activity a
    left join public.profiles p on p.id = a.actor_id
   order by a.occurred_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.community_activity_feed(integer) from public, anon;
grant execute on function public.community_activity_feed(integer) to authenticated;
